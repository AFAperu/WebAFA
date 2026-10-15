#!/usr/bin/env node
/**
 * Captures WhatsApp direct messages sent to the AFA number and turns them into
 * draft rows in the Airtable events table, to be reviewed by a human.
 *
 * How it works
 * ------------
 * Green-api parks every incoming message in a queue for 24 hours. This script
 * drains that queue (receiveNotification), writes the raw message into Airtable,
 * and then confirms each one (deleteNotification) so it is not processed twice.
 *
 * IMPORTANT — this requires the "pull" mode of green-api: the instance's
 * webhookUrl must be EMPTY and incomingWebhook must be "yes". If a webhook URL
 * is configured, receiveNotification refuses to return anything.
 * Sending messages (send-whatsapp-eventos.js) is unaffected either way.
 *
 * SAFETY — this script writes ONLY these fields:
 *   "Mensaje WhatsApp", "Remitente", "Recibido el",
 *   "Imágenes u otros documentos que quieras para la comunicación"
 * It deliberately never writes "Dónde publicar", "Fecha comunicación" or
 * "Hora publicación". Those three are what make a row public:
 *   - fetch-eventos.js publishes to the website only rows whose
 *     "Dónde publicar" includes "Web"
 *   - send-{whatsapp,email,instagram}-eventos.js broadcast only rows whose
 *     "Dónde publicar" includes WhatsApp/Email AND whose "Fecha comunicación"
 *     is today
 * Leaving them blank is therefore the interlock that stops a draft row from
 * reaching the website or the member mailing list before a human approves it.
 *
 * Environment variables:
 *   AIRTABLE_INTAKE_TOKEN     — Airtable PAT with data.records:write on the eventos base
 *   AIRTABLE_EVENTOS_BASE_ID  — Base ID for eventos ("app...")
 *   GREENAPI_INSTANCE_ID      — Green-api instance ID
 *   GREENAPI_TOKEN            — Green-api API token
 *   WHATSAPP_ALLOWLIST        — Comma-separated phone numbers allowed to submit,
 *                               international format without "+", e.g.
 *                               "34600111222,34600333444"
 *   GEMINI_API_KEY            — OPTIONAL. If set, voice notes are transcribed so
 *                               the Airtable AI automation can read them. If not
 *                               set, the audio is still attached to the row and
 *                               flagged for someone to listen to.
 *   DRY_RUN                   — "true" to read the queue and print what WOULD
 *                               happen, without writing to Airtable, replying,
 *                               or deleting anything from the queue
 */

const AIRTABLE_TOKEN = process.env.AIRTABLE_INTAKE_TOKEN;
const BASE_ID = process.env.AIRTABLE_EVENTOS_BASE_ID;
const GREEN_INSTANCE = process.env.GREENAPI_INSTANCE_ID;
const GREEN_TOKEN = process.env.GREENAPI_TOKEN;
const ALLOWLIST_RAW = process.env.WHATSAPP_ALLOWLIST || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const DRY_RUN = process.env.DRY_RUN === 'true';

const TABLE_NAME = 'Eventos colegio Perú';
const AIRTABLE_API = 'https://api.airtable.com/v0';
const GREEN_API = `https://api.green-api.com/waInstance${GREEN_INSTANCE}`;

const FIELD_RAW_MESSAGE = 'Mensaje WhatsApp';
const FIELD_SENDER = 'Remitente';
const FIELD_RECEIVED_AT = 'Recibido el';
const FIELD_ATTACHMENTS = 'Imágenes u otros documentos que quieras para la comunicación';

/** Consecutive messages from the same sender within this window become one row. */
const GROUP_WINDOW_MS = 10 * 60 * 1000;
/**
 * Messages younger than this are left in the queue for the next run.
 *
 * Grouping can only merge messages that arrive in the SAME run, so without this
 * delay a text at 10:59 and its photo at 11:01 would straddle two runs and
 * produce two rows. The queue is FIFO and the youngest message is always last,
 * so stopping early simply leaves the tail for next time. Keep this comfortably
 * larger than GROUP_WINDOW_MS.
 */
const SETTLE_MS = 15 * 60 * 1000;
/** Hard stop, so a flooded queue can never loop forever. */
const MAX_NOTIFICATIONS_PER_RUN = 60;
/** Pause between green-api calls, to stay under its per-second rate limit. */
const API_PAUSE_MS = 600;
/** Refuse to transcribe anything bigger than this (voice notes are tiny). */
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
/**
 * Gemini model used for transcription. Overridable with the GEMINI_MODEL env
 * var, because Google retires model names periodically — when that happens the
 * fix is a new secret value, not a code change. Check what your key can see:
 *   curl "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY"
 */
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const REPLY_TEXT =
  '✅ Recibido, ¡gracias! Lo revisamos y lo dejamos preparado para publicar. ' +
  'Si quieres añadir algo (fecha, hora, lugar o una foto), mándalo en este mismo chat.';

if (!AIRTABLE_TOKEN || !BASE_ID || !GREEN_INSTANCE || !GREEN_TOKEN) {
  console.error(
    'Missing required env vars. Need: AIRTABLE_INTAKE_TOKEN, AIRTABLE_EVENTOS_BASE_ID, ' +
      'GREENAPI_INSTANCE_ID, GREENAPI_TOKEN'
  );
  process.exit(1);
}

/**
 * Normalise a phone number or chatId to bare digits, so that "623 17 37 88",
 * "+34623173788" and "34623173788@c.us" all compare equal.
 */
function toDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

const ALLOWLIST = ALLOWLIST_RAW.split(',')
  .map(entry => toDigits(entry))
  .filter(Boolean);

if (ALLOWLIST.length === 0) {
  console.error(
    'WHATSAPP_ALLOWLIST is empty. Refusing to run: without an allowlist, anyone ' +
      'who messages the number could create Airtable rows.'
  );
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Pull the next notification off the green-api queue.
 * Returns null when the queue is empty (the call simply times out).
 */
async function receiveNotification() {
  const res = await fetch(`${GREEN_API}/receiveNotification/${GREEN_TOKEN}?receiveTimeout=5`);

  if (!res.ok) {
    const body = await res.text();
    // The most common misconfiguration has a very specific message; surface it clearly.
    if (body.includes('webhook url is set')) {
      throw new Error(
        'Green-api is in push mode: a webhook URL is configured on this instance, so the ' +
          'queue cannot be read. Clear the webhook URL in the green-api console, wait a ' +
          'minute, and try again.'
      );
    }
    throw new Error(`Green-api receiveNotification ${res.status}: ${body}`);
  }

  const text = await res.text();
  if (!text || text.trim() === '' || text.trim() === 'null') return null;

  const data = JSON.parse(text);
  return data && data.receiptId ? data : null;
}

/** Confirm a notification so green-api drops it from the queue. */
async function deleteNotification(receiptId) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${GREEN_API}/deleteNotification/${GREEN_TOKEN}/${receiptId}`, {
      method: 'DELETE',
    });
    if (res.ok) return;
    if (attempt === 3) {
      const body = await res.text();
      throw new Error(`Green-api deleteNotification ${res.status}: ${body}`);
    }
    await sleep(API_PAUSE_MS);
  }
}

/** Send the acknowledgement back to whoever submitted. */
async function sendReply(chatId, message) {
  const res = await fetch(`${GREEN_API}/sendMessage/${GREEN_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message }),
  });
  if (!res.ok) {
    // A failed acknowledgement must not lose the submission, so log and carry on.
    console.warn(`  ⚠️  Could not send reply to ${maskPhone(chatId)}: ${res.status}`);
    return;
  }
  console.log(`  Reply sent to ${maskPhone(chatId)}`);
}

/** Show only the last 3 digits in logs — GitHub Actions logs are readable by collaborators. */
function maskPhone(value) {
  const digits = toDigits(value);
  return digits.length <= 3 ? '***' : `***${digits.slice(-3)}`;
}

/**
 * Pull the text and any attachment out of a green-api incoming message payload.
 * Green-api uses a different sub-object per message type.
 */
function parseMessage(body) {
  const messageData = body.messageData || {};
  const type = messageData.typeMessage || '';

  if (messageData.textMessageData) {
    return { type, text: messageData.textMessageData.textMessage || '', attachment: null };
  }

  if (messageData.extendedTextMessageData) {
    return {
      type,
      text:
        messageData.extendedTextMessageData.text ||
        messageData.extendedTextMessageData.description ||
        '',
      attachment: null,
    };
  }

  if (messageData.fileMessageData) {
    const file = messageData.fileMessageData;
    const mimeType = file.mimeType || '';
    // WhatsApp voice notes arrive as audioMessage with an ogg/opus mime type.
    const isAudio = type === 'audioMessage' || mimeType.startsWith('audio/');
    return {
      type,
      text: file.caption || '',
      attachment: file.downloadUrl
        ? {
            url: file.downloadUrl,
            filename: file.fileName || (isAudio ? 'nota-de-voz.oga' : 'adjunto'),
          }
        : null,
      audio: isAudio && file.downloadUrl ? { url: file.downloadUrl, mimeType } : null,
    };
  }

  return { type, text: '', attachment: null, audio: null };
}

/**
 * Turn a WhatsApp voice note into text with the Gemini API, so the Airtable AI
 * automation has something to read. Returns null if transcription is not
 * possible — the caller then falls back to flagging the audio for a human.
 */
async function transcribeAudio(audio) {
  if (!GEMINI_API_KEY) return null;

  const fileRes = await fetch(audio.url);
  if (!fileRes.ok) {
    console.warn(`  ⚠️  Could not download the voice note: ${fileRes.status}`);
    return null;
  }

  const buffer = Buffer.from(await fileRes.arrayBuffer());
  if (buffer.byteLength > MAX_AUDIO_BYTES) {
    console.warn(`  ⚠️  Voice note too large to transcribe (${buffer.byteLength} bytes).`);
    return null;
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent` +
    `?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text:
                'Transcribe literalmente esta nota de voz en español. ' +
                'Devuelve solo la transcripción, sin comentarios ni introducción. ' +
                'Si el audio está vacío o no se entiende nada, responde exactamente: SIN_AUDIO',
            },
            {
              inline_data: {
                mime_type: audio.mimeType || 'audio/ogg',
                data: buffer.toString('base64'),
              },
            },
          ],
        },
      ],
      generationConfig: { temperature: 0 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.warn(`  ⚠️  Gemini transcription failed ${res.status}: ${body.slice(0, 300)}`);
    return null;
  }

  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map(part => part.text || '')
    .join('')
    .trim();

  if (!text || text === 'SIN_AUDIO') return null;
  return text;
}

/**
 * Replace each voice note with its transcription, keeping the audio file
 * attached either way so a human can always check what was actually said.
 */
async function transcribeVoiceNotes(messages) {
  for (const message of messages) {
    if (!message.audio) continue;

    console.log(`  Voice note from ${maskPhone(message.sender)} — transcribing...`);
    let transcript = null;
    try {
      transcript = await transcribeAudio(message.audio);
    } catch (err) {
      console.warn(`  ⚠️  Transcription error: ${err.message}`);
    }

    if (transcript) {
      message.text = [message.text, `🎙️ Nota de voz transcrita:\n${transcript}`]
        .filter(Boolean)
        .join('\n\n');
      console.log(`  Transcribed ${transcript.length} characters.`);
    } else {
      message.text = [
        message.text,
        GEMINI_API_KEY
          ? '🎙️ Nota de voz recibida, no se ha podido transcribir. Escucha el audio adjunto.'
          : '🎙️ Nota de voz recibida. Escucha el audio adjunto (transcripción no configurada).',
      ]
        .filter(Boolean)
        .join('\n\n');
    }
  }
}

/**
 * Drain the queue, keeping only direct messages from allowlisted senders.
 * Everything else (group messages, strangers, delivery receipts, our own
 * outgoing messages) is acknowledged and dropped — it is noise, not an error.
 *
 * Note: the queue is FIFO and a notification keeps coming back until it is
 * deleted, so a message cannot be skipped and revisited later. Anything we
 * choose not to keep has to be deleted now.
 */
async function drainQueue() {
  const kept = [];
  const discardedReceipts = [];
  let seen = 0;

  while (seen < MAX_NOTIFICATIONS_PER_RUN) {
    const notification = await receiveNotification();
    if (!notification) break;
    seen++;

    const { receiptId, body } = notification;
    const typeWebhook = body?.typeWebhook;
    const timestampMs = (body?.timestamp || Math.floor(Date.now() / 1000)) * 1000;

    // Too fresh: a follow-up photo or voice note may still be on its way. Leave
    // this one queued (do NOT delete it) and stop — the queue is FIFO, so
    // everything after this is even newer.
    if (Date.now() - timestampMs < SETTLE_MS) {
      console.log(
        `  Leaving ${receiptId} queued: only ${Math.round(
          (Date.now() - timestampMs) / 60000
        )} min old, waiting for any follow-up messages.`
      );
      break;
    }

    if (typeWebhook !== 'incomingMessageReceived') {
      discardedReceipts.push({ receiptId, why: `webhook type ${typeWebhook}` });
      await sleep(API_PAUSE_MS);
      continue;
    }

    const chatId = body?.senderData?.chatId || '';
    const sender = body?.senderData?.sender || '';

    // Group chats end in @g.us; direct messages end in @c.us.
    if (!chatId.endsWith('@c.us')) {
      discardedReceipts.push({ receiptId, why: 'not a direct message' });
      await sleep(API_PAUSE_MS);
      continue;
    }

    if (!ALLOWLIST.includes(toDigits(sender))) {
      discardedReceipts.push({ receiptId, why: `sender ${maskPhone(sender)} not allowlisted` });
      await sleep(API_PAUSE_MS);
      continue;
    }

    const parsed = parseMessage(body);
    if (!parsed.text && !parsed.attachment) {
      discardedReceipts.push({ receiptId, why: `no usable content (${parsed.type})` });
      await sleep(API_PAUSE_MS);
      continue;
    }

    kept.push({
      receiptId,
      chatId,
      sender,
      senderName: body?.senderData?.senderName || body?.senderData?.senderContactName || '',
      timestampMs,
      ...parsed,
    });

    await sleep(API_PAUSE_MS);
  }

  if (seen >= MAX_NOTIFICATIONS_PER_RUN) {
    console.warn(
      `⚠️  Hit the ${MAX_NOTIFICATIONS_PER_RUN}-notification cap. The rest stay queued for the next run.`
    );
  }

  return { kept, discardedReceipts, seen };
}

/**
 * Merge consecutive messages from the same sender that arrived close together,
 * so "here's the event" followed by a photo becomes one row rather than two.
 * A message sent much later is treated as a new submission.
 */
function groupSubmissions(messages) {
  const groups = [];

  for (const message of messages) {
    const open = groups.find(
      group =>
        group.sender === message.sender &&
        message.timestampMs - group.lastTimestampMs <= GROUP_WINDOW_MS
    );

    if (open) {
      if (message.text) open.texts.push(message.text);
      if (message.attachment) open.attachments.push(message.attachment);
      open.receiptIds.push(message.receiptId);
      open.lastTimestampMs = message.timestampMs;
      continue;
    }

    groups.push({
      sender: message.sender,
      chatId: message.chatId,
      senderName: message.senderName,
      firstTimestampMs: message.timestampMs,
      lastTimestampMs: message.timestampMs,
      texts: message.text ? [message.text] : [],
      attachments: message.attachment ? [message.attachment] : [],
      receiptIds: [message.receiptId],
    });
  }

  return groups;
}

/**
 * Create the draft row. Only the intake fields are set; the AI automation in
 * Airtable fills Name / Fecha evento / Hora / Lugar / Descripción / Texto para
 * redes from "Mensaje WhatsApp", and a human sets "Dónde publicar" to approve.
 */
async function createIntakeRecord(group) {
  const fields = {
    [FIELD_RAW_MESSAGE]: group.texts.join('\n\n'),
    [FIELD_SENDER]: group.senderName
      ? `${group.senderName} (${toDigits(group.sender)})`
      : toDigits(group.sender),
    [FIELD_RECEIVED_AT]: new Date(group.firstTimestampMs).toISOString(),
  };

  if (group.attachments.length > 0) {
    fields[FIELD_ATTACHMENTS] = group.attachments.map(a => ({
      url: a.url,
      filename: a.filename,
    }));
  }

  const url = `${AIRTABLE_API}/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records: [{ fields }], typecast: true }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Airtable create ${res.status}: ${err?.error?.message || res.statusText}`);
  }

  const data = await res.json();
  return data.records[0];
}

async function main() {
  console.log(
    `Draining green-api queue${DRY_RUN ? ' (DRY RUN — nothing will be written or deleted)' : ''}...`
  );
  console.log(`Allowlist: ${ALLOWLIST.map(maskPhone).join(', ')}`);

  const { kept, discardedReceipts, seen } = await drainQueue();
  console.log(`Read ${seen} notification(s): ${kept.length} to keep, ${discardedReceipts.length} to discard.`);

  for (const discarded of discardedReceipts) {
    console.log(`  Discarding ${discarded.receiptId}: ${discarded.why}`);
    if (!DRY_RUN) await deleteNotification(discarded.receiptId);
  }

  if (kept.length === 0) {
    console.log('No new submissions. Done.');
    return;
  }

  // Transcribe before grouping, so a voice note's text joins the same row as
  // any typed message that came with it.
  await transcribeVoiceNotes(kept);

  const groups = groupSubmissions(kept);
  console.log(`Creating ${groups.length} draft row(s) in "${TABLE_NAME}".`);

  for (const group of groups) {
    const preview = group.texts.join(' ').slice(0, 60).replace(/\s+/g, ' ');
    console.log(
      `From ${maskPhone(group.sender)}: "${preview}${preview.length === 60 ? '…' : ''}" ` +
        `(${group.attachments.length} attachment(s))`
    );

    if (DRY_RUN) {
      console.log('  DRY RUN — skipping Airtable write, reply and queue delete.');
      continue;
    }

    // Order matters: write to Airtable FIRST, and only then delete from the
    // queue. If the write fails the messages stay queued (24h) and the next
    // run retries them, instead of being silently lost.
    const record = await createIntakeRecord(group);
    console.log(`  Created record ${record.id}`);

    for (const receiptId of group.receiptIds) {
      await deleteNotification(receiptId);
    }

    await sendReply(group.chatId, REPLY_TEXT);
    await sleep(API_PAUSE_MS);
  }

  console.log('Done.');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
