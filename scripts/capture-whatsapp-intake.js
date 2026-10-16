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
const MAX_NOTIFICATIONS_PER_RUN = 200;
/** Pause between green-api calls, to stay under its per-second rate limit. */
const API_PAUSE_MS = 400;
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

/** Raised when a call could not be made at all, as opposed to being refused. */
class NetworkError extends Error {}

/** How many times to retry a call that failed at the connection level. */
const MAX_FETCH_ATTEMPTS = 4;

/**
 * Node reports every connection-level problem as the unhelpfully terse "fetch
 * failed", hiding the real reason in err.cause. Dig it out for the log.
 */
function networkDetail(err) {
  return err?.cause?.code || err?.cause?.message || err?.message || 'unknown';
}

/**
 * fetch, but tolerant of the transient blips you get on a shared CI runner.
 * One dropped connection used to abort the whole run and leave the rest of the
 * queue unprocessed; now it backs off and tries again.
 *
 * Only connection failures are retried. An HTTP error response is returned to
 * the caller untouched, because "403 forbidden" will not fix itself.
 */
async function fetchWithRetry(url, options = {}, label = 'request') {
  let lastError;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastError = err;
      console.warn(
        `  ⚠️  ${label}: connection failed (${networkDetail(err)}), ` +
          `attempt ${attempt}/${MAX_FETCH_ATTEMPTS}`
      );
      if (attempt < MAX_FETCH_ATTEMPTS) await sleep(attempt * 1500);
    }
  }

  throw new NetworkError(
    `${label}: could not connect after ${MAX_FETCH_ATTEMPTS} attempts (${networkDetail(lastError)})`
  );
}

/**
 * Pull the next notification off the green-api queue.
 * Returns null when the queue is empty (the call simply times out).
 */
async function receiveNotification() {
  const res = await fetchWithRetry(
    `${GREEN_API}/receiveNotification/${GREEN_TOKEN}?receiveTimeout=5`,
    {},
    'receiveNotification'
  );

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
    const res = await fetchWithRetry(
      `${GREEN_API}/deleteNotification/${GREEN_TOKEN}/${receiptId}`,
      { method: 'DELETE' },
      `deleteNotification ${receiptId}`
    );
    if (res.ok) return;
    if (attempt === 3) {
      const body = await res.text();
      throw new Error(`Green-api deleteNotification ${res.status}: ${body}`);
    }
    await sleep(API_PAUSE_MS);
  }
}

/**
 * Send the acknowledgement back to whoever submitted.
 * Never fatal: the submission is already safely in Airtable by this point, so a
 * missing "Recibido" is a nuisance, not a reason to fail the run.
 */
async function sendReply(chatId, message) {
  try {
    const res = await fetchWithRetry(
      `${GREEN_API}/sendMessage/${GREEN_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, message }),
      },
      'sendMessage'
    );
    if (!res.ok) {
      console.warn(`  ⚠️  Could not send reply to ${maskPhone(chatId)}: ${res.status}`);
      return;
    }
    console.log(`  Reply sent to ${maskPhone(chatId)}`);
  } catch (err) {
    console.warn(`  ⚠️  Could not send reply to ${maskPhone(chatId)}: ${err.message}`);
  }
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

  const fileRes = await fetchWithRetry(audio.url, {}, 'voice note download');
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

  const res = await fetchWithRetry(url, {
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
 * Replace a voice note with its transcription, keeping the audio file attached
 * either way so a human can always check what was actually said.
 */
async function transcribeIfVoiceNote(message) {
  if (!message.audio) return;

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

/**
 * Walk the queue once, handling each notification before asking for the next.
 *
 * WHY ONE AT A TIME: green-api re-serves the SAME notification on every
 * receiveNotification call until it is deleted. Collecting a batch and deleting
 * afterwards does not work — the loop just re-reads the head of the queue until
 * it hits the cap, which is exactly the bug this replaced. So every
 * notification must be acknowledged (or deliberately left) before the next read.
 *
 * Noise (group messages, strangers, delivery receipts, our own outgoing
 * messages) is deleted straight away; it is not an error, just not for us.
 *
 * Keepers are written to Airtable FIRST and deleted only once the write
 * succeeded, so a failure leaves the message queued for the next run rather
 * than losing it. Follow-up messages from the same sender update the row that
 * was just created instead of making a second one.
 */
async function processQueue() {
  /** sender digits -> { recordId, chatId, texts, attachments, lastTimestampMs } */
  const openRows = new Map();
  const stats = { seen: 0, discarded: 0, created: 0, appended: 0, leftQueued: 0, abortedBy: null };

  try {
    await drainLoop(openRows, stats);
  } catch (err) {
    // A connection that stays down after several retries stops this run, but
    // everything handled so far is already written AND acknowledged, and the
    // rest is still queued for 24 hours. So this is a pause, not a loss.
    if (!(err instanceof NetworkError)) throw err;
    stats.abortedBy = err.message;
  }

  if (stats.seen >= MAX_NOTIFICATIONS_PER_RUN) {
    console.warn(
      `⚠️  Hit the ${MAX_NOTIFICATIONS_PER_RUN}-notification cap. The rest stay queued; ` +
        'run again to continue draining.'
    );
  }

  return stats;
}

async function drainLoop(openRows, stats) {
  while (stats.seen < MAX_NOTIFICATIONS_PER_RUN) {
    const notification = await receiveNotification();
    if (!notification) break;
    stats.seen++;

    const { receiptId, body } = notification;
    const typeWebhook = body?.typeWebhook;
    const timestampMs = (body?.timestamp || Math.floor(Date.now() / 1000)) * 1000;
    const ageMin = Math.round((Date.now() - timestampMs) / 60000);

    // Too fresh: a follow-up photo or voice note may still be on its way. Leave
    // it queued (do NOT delete) and stop — the queue is FIFO, so everything
    // after this is newer still.
    if (Date.now() - timestampMs < SETTLE_MS) {
      console.log(
        `  Leaving ${receiptId} queued: only ${ageMin} min old, waiting for any follow-ups.`
      );
      stats.leftQueued++;
      break;
    }

    // Dry run cannot acknowledge anything, and an unacknowledged notification
    // is served again forever, so there is no way to look past the head of the
    // queue. Report what is there and stop rather than spinning.
    if (DRY_RUN) {
      const chatId = body?.senderData?.chatId || '(none)';
      console.log(
        `  DRY RUN — head of queue is receipt ${receiptId}: ${typeWebhook}, ` +
          `chat ${maskPhone(chatId)}${chatId.endsWith('@g.us') ? ' (group)' : ''}, ${ageMin} min old.`
      );
      console.log(
        '  Stopping here: a dry run cannot acknowledge notifications, so it cannot see past this one.'
      );
      break;
    }

    const discard = async why => {
      console.log(`  Discarding ${receiptId}: ${why}`);
      await deleteNotification(receiptId);
      stats.discarded++;
      await sleep(API_PAUSE_MS);
    };

    if (typeWebhook !== 'incomingMessageReceived') {
      await discard(`webhook type ${typeWebhook}`);
      continue;
    }

    const chatId = body?.senderData?.chatId || '';
    const sender = body?.senderData?.sender || '';

    // Group chats end in @g.us; direct messages end in @c.us.
    if (!chatId.endsWith('@c.us')) {
      await discard('not a direct message');
      continue;
    }

    if (!ALLOWLIST.includes(toDigits(sender))) {
      await discard(`sender ${maskPhone(sender)} not allowlisted`);
      continue;
    }

    const parsed = parseMessage(body);
    if (!parsed.text && !parsed.attachment) {
      await discard(`no usable content (${parsed.type})`);
      continue;
    }

    const message = {
      receiptId,
      chatId,
      sender,
      senderName: body?.senderData?.senderName || body?.senderData?.senderContactName || '',
      timestampMs,
      ...parsed,
    };

    await transcribeIfVoiceNote(message);

    const key = toDigits(sender);
    const open = openRows.get(key);
    const preview = (message.text || '(sin texto)').slice(0, 60).replace(/\s+/g, ' ');
    // A second submission from the same sender much later is a NEW row, so it
    // needs its own acknowledgement. Deciding that from `open` alone was wrong:
    // `open` is still set from the earlier submission even when the time gap
    // means we are starting a fresh row, which silently swallowed the reply.
    const isFollowUp = Boolean(open) && message.timestampMs - open.lastTimestampMs <= GROUP_WINDOW_MS;

    if (isFollowUp) {
      // Same sender, moments later: treat it as part of the same submission.
      if (message.text) open.texts.push(message.text);
      if (message.attachment) open.attachments.push(message.attachment);
      open.lastTimestampMs = message.timestampMs;

      await appendToIntakeRecord(open);
      console.log(`  Added to ${open.recordId}: "${preview}"`);
      stats.appended++;
    } else {
      console.log(
        `From ${maskPhone(sender)}: "${preview}" (${message.attachment ? 1 : 0} attachment(s))`
      );

      const row = {
        chatId,
        senderName: message.senderName,
        sender,
        firstTimestampMs: message.timestampMs,
        lastTimestampMs: message.timestampMs,
        texts: message.text ? [message.text] : [],
        attachments: message.attachment ? [message.attachment] : [],
      };
      const record = await createIntakeRecord(row);
      row.recordId = record.id;
      openRows.set(key, row);
      console.log(`  Created record ${record.id}`);
      stats.created++;
    }

    // Only now is it safe to acknowledge: the content is in Airtable.
    await deleteNotification(receiptId);

    // One acknowledgement per submission: a follow-up photo should not trigger
    // a second "Recibido", but a genuinely new submission must get its own.
    if (!isFollowUp) await sendReply(chatId, REPLY_TEXT);
    await sleep(API_PAUSE_MS);
  }
}

/**
 * Create the draft row. Only the intake fields are set; the AI automation in
 * Airtable fills Name / Fecha evento / Hora / Lugar / Descripción / Texto para
 * redes from "Mensaje WhatsApp", and a human sets "Dónde publicar" to approve.
 */
function intakeFields(row) {
  const fields = {
    [FIELD_RAW_MESSAGE]: row.texts.join('\n\n'),
    [FIELD_SENDER]: row.senderName
      ? `${row.senderName} (${toDigits(row.sender)})`
      : toDigits(row.sender),
    [FIELD_RECEIVED_AT]: new Date(row.firstTimestampMs).toISOString(),
  };

  if (row.attachments.length > 0) {
    fields[FIELD_ATTACHMENTS] = row.attachments.map(a => ({
      url: a.url,
      filename: a.filename,
    }));
  }

  return fields;
}

async function createIntakeRecord(row) {
  const url = `${AIRTABLE_API}/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;
  const res = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records: [{ fields: intakeFields(row) }], typecast: true }),
    },
    'Airtable create'
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Airtable create ${res.status}: ${err?.error?.message || res.statusText}`);
  }

  const data = await res.json();
  return data.records[0];
}

/**
 * Fold a follow-up message into the row already created for this sender.
 * The full merged value is sent every time, so no read-back is needed.
 */
async function appendToIntakeRecord(row) {
  const url = `${AIRTABLE_API}/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}/${row.recordId}`;
  const res = await fetchWithRetry(
    url,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: intakeFields(row), typecast: true }),
    },
    'Airtable update'
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Airtable update ${res.status}: ${err?.error?.message || res.statusText}`);
  }

  return res.json();
}

async function main() {
  console.log(
    `Reading green-api queue${DRY_RUN ? ' (DRY RUN — inspect only, nothing is changed)' : ''}...`
  );
  console.log(`Allowlist: ${ALLOWLIST.map(maskPhone).join(', ')}`);

  const stats = await processQueue();

  console.log(
    `Read ${stats.seen} notification(s): ${stats.created} row(s) created, ` +
      `${stats.appended} follow-up(s) merged, ${stats.discarded} discarded, ` +
      `${stats.leftQueued} left queued.`
  );

  if (stats.created === 0 && stats.appended === 0) {
    console.log('No new submissions.');
  }

  if (stats.abortedBy) {
    const progress = stats.created + stats.appended + stats.discarded;

    // A blip partway through a run cost nothing: anything remaining is still in
    // the queue and the next run picks it up. Failing the build for that would
    // train everyone to ignore red runs. But never reaching green-api at all is
    // worth shouting about.
    if (progress > 0) {
      console.warn(`⚠️  Stopped early: ${stats.abortedBy}`);
      console.warn('   Nothing was lost. The remaining messages stay queued for the next run.');
      console.log('Done.');
      return;
    }

    throw new Error(`Could not reach green-api at all. ${stats.abortedBy}`);
  }

  console.log('Done.');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
