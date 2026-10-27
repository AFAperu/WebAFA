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
 *   CLOUDFLARE_ACCOUNT_ID     — OPTIONAL, preferred transcriber for voice notes
 *   CLOUDFLARE_API_TOKEN        (Workers AI, needs Read AND Edit). Cloudflare
 *                               states it does not use Customer Content to train
 *                               models or improve services, which is why this is
 *                               tried first.
 *   GEMINI_API_KEY            — OPTIONAL fallback transcriber. Note that on
 *                               Google's FREE tier, prompts and responses ARE
 *                               used to improve Google products.
 *
 *   With neither set, voice notes still reach Airtable: the audio is attached to
 *   the row and the text flags it for someone to listen to.
 *   DRY_RUN                   — "true" to read the queue and print what WOULD
 *                               happen, without writing to Airtable, replying,
 *                               or deleting anything from the queue
 *
 *   AIRTABLE_ARCHIVE_BASE_ID  — OPTIONAL. Turns on the archive of messages the
 *                               AFA SENDS to the WhatsApp group (see below).
 *                               Unset, outgoing messages are discarded exactly
 *                               as they were before this existed.
 *   AIRTABLE_ARCHIVE_TOKEN    — OPTIONAL. Defaults to AIRTABLE_INTAKE_TOKEN, so
 *                               the simplest setup is to give that token access
 *                               to the archive base too.
 *   AIRTABLE_ARCHIVE_TABLE    — OPTIONAL. Defaults to "Mensajes enviados".
 *
 * ARCHIVE OF SENT MESSAGES
 * ------------------------
 * The same green-api queue also carries our OWN outgoing messages, which this
 * script used to throw away as noise. With AIRTABLE_ARCHIVE_BASE_ID set, the
 * ones sent to a WhatsApp GROUP are copied into a separate base first, giving a
 * searchable record of everything the AFA has published.
 *
 * Only group messages. One-to-one chats are deliberately excluded: those are
 * private conversations with families, and the acknowledgements this very
 * script sends ("Recibido, ¡gracias!") would otherwise be archived too.
 *
 * It runs INSIDE this script on purpose. Green-api serves one notification at a
 * time and only moves on once it is deleted, so a second script polling the
 * same instance would race this one and delete messages it still needed.
 */

const AIRTABLE_TOKEN = process.env.AIRTABLE_INTAKE_TOKEN;
const BASE_ID = process.env.AIRTABLE_EVENTOS_BASE_ID;
const GREEN_INSTANCE = process.env.GREENAPI_INSTANCE_ID;
const GREEN_TOKEN = process.env.GREENAPI_TOKEN;
const ALLOWLIST_RAW = process.env.WHATSAPP_ALLOWLIST || '';
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const DRY_RUN = process.env.DRY_RUN === 'true';

const CF_CONFIGURED = Boolean(CF_ACCOUNT_ID && CF_API_TOKEN);
const TRANSCRIPTION_AVAILABLE = CF_CONFIGURED || Boolean(GEMINI_API_KEY);

const TABLE_NAME = 'Eventos colegio Perú';
const AIRTABLE_API = 'https://api.airtable.com/v0';
const GREEN_API = `https://api.green-api.com/waInstance${GREEN_INSTANCE}`;

const FIELD_RAW_MESSAGE = 'Mensaje WhatsApp';
const FIELD_SENDER = 'Remitente';
const FIELD_RECEIVED_AT = 'Recibido el';
const FIELD_ATTACHMENTS = 'Imágenes u otros documentos que quieras para la comunicación';

/* ─── Archive of messages we SEND (optional, off unless the base is set) ─── */

const ARCHIVE_BASE_ID = process.env.AIRTABLE_ARCHIVE_BASE_ID || '';
/** Reusing the intake token keeps this to one new secret; override if you prefer. */
const ARCHIVE_TOKEN = process.env.AIRTABLE_ARCHIVE_TOKEN || AIRTABLE_TOKEN;
const ARCHIVE_TABLE_NAME = process.env.AIRTABLE_ARCHIVE_TABLE || 'Mensajes enviados';
/**
 * The archive may live in its own base or in a new table of the events base —
 * both work, since only the base id and the table name decide where rows go.
 *
 * But sharing the base makes one misconfiguration possible that a separate base
 * made impossible: pointing the archive at the INTAKE table, which would drop
 * copies of our own broadcasts in among the event drafts a human reviews. So
 * refuse that combination and carry on with the archive switched off — intake is
 * the path that matters, and it must not fail over a nice-to-have.
 */
const ARCHIVE_COLLIDES_WITH_INTAKE =
  ARCHIVE_BASE_ID === BASE_ID && ARCHIVE_TABLE_NAME === TABLE_NAME;
const ARCHIVE_ENABLED = Boolean(ARCHIVE_BASE_ID) && !ARCHIVE_COLLIDES_WITH_INTAKE;

const ARCHIVE_FIELD_SUMMARY = 'Resumen';
const ARCHIVE_FIELD_MESSAGE = 'Mensaje';
const ARCHIVE_FIELD_SENT_AT = 'Enviado el';
const ARCHIVE_FIELD_CHAT = 'Chat';
const ARCHIVE_FIELD_SOURCE = 'Origen';
const ARCHIVE_FIELD_ATTACHMENTS = 'Adjuntos';
const ARCHIVE_FIELD_MESSAGE_ID = 'ID mensaje';

/**
 * The two webhook types that mean "we sent this", and what to record as its
 * origin. Green-api distinguishes them, and the distinction is worth keeping:
 * one is send-whatsapp-eventos.js, the other is a person typing on the phone.
 *
 * Delivery receipts (outgoingMessageStatus) are NOT here. They are pure noise
 * and there are several per message, so leave that notification switched off in
 * the green-api console rather than paying to drain them.
 */
const OUTGOING_SOURCES = {
  outgoingAPIMessageReceived: 'Automático (web)',
  outgoingMessageReceived: 'Manual (teléfono)',
};

/** Consecutive messages from the same sender within this window become one row. */
const GROUP_WINDOW_MS = 10 * 60 * 1000;
/**
 * Messages younger than this are left in the queue for the next run.
 *
 * Grouping can only merge messages handled in the SAME run, so without a delay
 * a text and the photo a minute later could straddle two runs and produce two
 * rows. The queue is FIFO and the youngest message is always last, so stopping
 * early simply leaves the tail for next time.
 *
 * Kept SHORT on purpose. GitHub's scheduler is unreliable enough that runs land
 * every 3-4 hours rather than hourly, and this delay compounds with that gap: a
 * message that misses one run waits for the next. What actually makes grouping
 * work is that both messages sit in the queue until a run happens, not the
 * length of this window.
 */
const SETTLE_MS = 5 * 60 * 1000;
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
/** Workers AI model, overridable the same way. Full-size Whisper, good Spanish. */
const CF_MODEL = process.env.CLOUDFLARE_WHISPER_MODEL || '@cf/openai/whisper-large-v3-turbo';

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

/**
 * Resolve each allowlisted phone number to its @lid identifier, once per run.
 *
 * WhatsApp is phasing out phone numbers as chat identifiers in favour of opaque
 * lids, which are NOT derived from the number — so a phone-number allowlist
 * cannot match a lid by itself. CheckWhatsapp takes a phone number and returns
 * that contact's lid, which lets us keep the allowlist readable (real phone
 * numbers a human can audit) while still recognising migrated senders.
 *
 * Deliberately lazy: nothing calls this until a lid actually shows up, so today
 * it costs zero API calls. Deliberately not cached between runs either, because
 * a chat can move from one lid to another at WhatsApp's discretion.
 */
let allowedLidsPromise = null;

function allowedLids() {
  if (allowedLidsPromise) return allowedLidsPromise;

  allowedLidsPromise = (async () => {
    const lids = new Set();
    let complete = true;
    console.log('  Resolving allowlisted numbers to @lid identifiers...');

    for (const phone of ALLOWLIST) {
      try {
        const res = await fetchWithRetry(
          `${GREEN_API}/checkWhatsapp/${GREEN_TOKEN}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: phone }),
          },
          'checkWhatsapp'
        );

        if (!res.ok) {
          console.warn(`  ⚠️  checkWhatsapp ${res.status} for ${maskPhone(phone)}`);
          complete = false;
          continue;
        }

        const data = await res.json();
        const resolved = toDigits(data?.chatId);
        if (data?.existsWhatsapp && resolved) lids.add(resolved);
      } catch (err) {
        console.warn(`  ⚠️  Could not resolve ${maskPhone(phone)}: ${err.message}`);
        complete = false;
      }
      await sleep(API_PAUSE_MS);
    }

    return { lids, complete };
  })();

  return allowedLidsPromise;
}

/**
 * May this sender create rows? Returns 'allowed', 'denied' or 'unknown'.
 *
 * The three-way answer matters. Fails CLOSED on 'denied' because this is access
 * control. But 'unknown' — meaning the lid lookup itself failed, so we could not
 * check — must not be treated as 'denied': discarding then would silently throw
 * away a real submission from someone who got no reply and no way to know.
 * 'unknown' leaves the message queued for the next run instead.
 */
async function senderVerdict(sender, chatId) {
  const digits = toDigits(sender);
  if (ALLOWLIST.includes(digits)) return 'allowed';

  // Only reach for the network when the identifier actually looks like a lid.
  const looksLikeLid = sender.endsWith('@lid') || chatId.endsWith('@lid');
  if (!looksLikeLid) return 'denied';

  const { lids, complete } = await allowedLids();

  if (lids.has(digits)) {
    console.log('  Sender recognised via @lid lookup.');
    return 'allowed';
  }

  if (!complete) return 'unknown';

  console.warn(
    `  ⚠️  @lid sender ${maskPhone(sender)} did not match any allowlisted number. ` +
      'If this is a legitimate submitter, WhatsApp may have moved their chat to a new lid.'
  );
  return 'denied';
}

/** Show only the last 3 digits in logs — GitHub Actions logs are readable by collaborators. */
function maskPhone(value) {
  const digits = toDigits(value);
  return digits.length <= 3 ? '***' : `***${digits.slice(-3)}`;
}

/**
 * Mask every long digit run inside a block of text, for logging messages that
 * come from green-api and embed phone numbers (the quota warning lists them).
 */
function maskNumbersIn(text) {
  return String(text).replace(/\d{7,}/g, match => `***${match.slice(-3)}`);
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

/** Fetch the voice note itself. Returns null if it cannot be used. */
async function downloadAudio(audio) {
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

  return buffer;
}

/**
 * Transcribe with Cloudflare Workers AI (full-size Whisper).
 *
 * Preferred over Gemini because Cloudflare's documented position is that it does
 * not use Customer Content — which explicitly includes audio — to train models
 * or improve services. Google's free tier does the opposite.
 *
 * Returns null on any failure so the caller can fall back.
 */
async function transcribeWithCloudflare(buffer) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;

  const res = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio: buffer.toString('base64'),
        task: 'transcribe',
        language: 'es',
        // Repetition loops are the classic Whisper failure on near-silent audio.
        vad_filter: true,
        condition_on_previous_text: false,
      }),
    },
    'Cloudflare transcription'
  );

  if (!res.ok) {
    const body = await res.text();
    const hint = res.status === 403 ? ' (token needs Workers AI Read AND Edit)' : '';
    console.warn(`  ⚠️  Cloudflare transcription failed ${res.status}${hint}: ${body.slice(0, 300)}`);
    return null;
  }

  const data = await res.json();
  if (!data?.success) {
    const problems = (data?.errors || []).map(e => e.message).join('; ');
    console.warn(`  ⚠️  Cloudflare transcription rejected: ${problems || 'unknown reason'}`);
    return null;
  }

  const text = (data?.result?.text || '').trim();
  return text || null;
}

/**
 * Transcribe with the Gemini API. Kept as a fallback so there is no lock-in,
 * but note that Google's free tier uses the audio to improve its products.
 * Returns null on any failure.
 */
async function transcribeWithGemini(buffer, audio) {
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
 * Try each configured transcriber in privacy order: Cloudflare first (no
 * training on your audio), Gemini second (free tier trains on it). Whichever
 * answers first wins; if one is down the next gets a turn.
 */
async function transcribe(audio) {
  if (!TRANSCRIPTION_AVAILABLE) return null;

  const buffer = await downloadAudio(audio);
  if (!buffer) return null;

  const providers = [];
  if (CF_CONFIGURED) providers.push(['Cloudflare', () => transcribeWithCloudflare(buffer)]);
  if (GEMINI_API_KEY) providers.push(['Gemini', () => transcribeWithGemini(buffer, audio)]);

  for (const [name, attempt] of providers) {
    try {
      const text = await attempt();
      if (text) {
        console.log(`  Transcribed by ${name}: ${text.length} characters.`);
        return text;
      }
    } catch (err) {
      console.warn(`  ⚠️  ${name} transcription error: ${err.message}`);
    }
  }

  return null;
}

/**
 * Replace a voice note with its transcription, keeping the audio file attached
 * either way so a human can always check what was actually said.
 */
async function transcribeIfVoiceNote(message) {
  if (!message.audio) return;

  console.log(`  Voice note from ${maskPhone(message.sender)} — transcribing...`);
  const transcript = await transcribe(message.audio);

  if (transcript) {
    message.text = [message.text, `🎙️ Nota de voz transcrita:\n${transcript}`]
      .filter(Boolean)
      .join('\n\n');
  } else {
    message.text = [
      message.text,
      TRANSCRIPTION_AVAILABLE
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
  const stats = {
    seen: 0,
    discarded: 0,
    created: 0,
    appended: 0,
    archived: 0,
    leftQueued: 0,
    abortedBy: null,
  };

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

    /*
     * Work out how old this notification is — carefully.
     *
     * This used to read `body.timestamp || Date.now()/1000`, which looks
     * harmless and is not: when green-api omits the timestamp, "now" makes the
     * notification look brand new on EVERY run, so the settle delay defers it
     * forever and, because the queue is strictly oldest-first, it blocks
     * everything behind it. The giveaway in the log was the same notification
     * reported as "0 min old" in runs hours apart.
     *
     * So an unknown or impossible age means "process it now". Deferring is only
     * ever correct when we positively know the message is recent.
     */
    const rawTimestamp = Number(body?.timestamp);
    const hasTimestamp = Number.isFinite(rawTimestamp) && rawTimestamp > 0;
    const timestampMs = hasTimestamp ? rawTimestamp * 1000 : Date.now();
    const ageMs = hasTimestamp ? Date.now() - timestampMs : null;
    const ageMin = ageMs === null ? null : Math.round(ageMs / 60000);

    if (!hasTimestamp) {
      console.warn(
        `  ⚠️  ${receiptId} has no usable timestamp (raw: ${JSON.stringify(body?.timestamp)}). ` +
          'Processing it now rather than deferring it forever.'
      );
    } else if (ageMs < 0) {
      console.warn(
        `  ⚠️  ${receiptId} is timestamped ${Math.abs(ageMin)} min in the future (clock skew). ` +
          'Processing it now.'
      );
    }

    // Too fresh: a follow-up photo or voice note may still be on its way. Leave
    // it queued (do NOT delete) and stop — the queue is FIFO, so everything
    // after this is newer still.
    if (ageMs !== null && ageMs >= 0 && ageMs < SETTLE_MS) {
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
          `chat ${maskPhone(chatId)}${chatId.endsWith('@g.us') ? ' (group)' : ''}, ` +
          `${ageMin === null ? 'age unknown' : `${ageMin} min old`}.`
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

    /*
     * The green-api Developer (free) plan only lets an instance talk to THREE
     * chats per month — the WhatsApp group counts as one — and silently blocks
     * every other chat, sending this webhook instead of the message. A submitter
     * outside those three never reaches the queue at all, so from our side their
     * messages simply do not exist.
     *
     * This carries the list of chats that ARE allowed, so print it rather than
     * discarding it as just another webhook type. It is the only place the real
     * reason for a missing submission appears.
     */
    if (typeWebhook === 'quotaExceeded') {
      const quota = body?.quotaData || {};
      console.warn(
        '  ⚠️  GREEN-API PLAN LIMIT REACHED — this is why some submitters never arrive.'
      );
      console.warn(
        `     ${quota.used ?? '?'}/${quota.total ?? '?'} ${quota.method || 'chats'} used this month` +
          `${quota.status ? ` (${quota.status})` : ''}.`
      );
      if (quota.description) console.warn(`     ${maskNumbersIn(quota.description)}`);
      await discard('plan quota exceeded (see warning above)');
      continue;
    }

    /*
     * A message WE sent. Everything the AFA publishes goes to the group, so
     * archive those and ignore one-to-one chats — which also skips this
     * script's own "Recibido" replies, since those are always DMs.
     */
    const outgoingSource = OUTGOING_SOURCES[typeWebhook];
    if (outgoingSource) {
      if (!ARCHIVE_ENABLED) {
        await discard(`webhook type ${typeWebhook} (archive not configured)`);
        continue;
      }

      const sentChatId = body?.senderData?.chatId || '';
      if (!sentChatId.endsWith('@g.us')) {
        await discard('message we sent to a private chat, not archived');
        continue;
      }

      const sentParsed = parseMessage(body);
      if (!sentParsed.text && !sentParsed.attachment) {
        await discard(`message we sent with no usable content (${sentParsed.type})`);
        continue;
      }

      const sentPreview = (sentParsed.text || '(solo adjunto)').slice(0, 60).replace(/\s+/g, ' ');
      console.log(`Sent to ${body?.senderData?.chatName || 'group'}: "${sentPreview}"`);

      const archived = await archiveSentMessage({
        ...sentParsed,
        chatId: sentChatId,
        chatName: body?.senderData?.chatName || '',
        idMessage: body?.idMessage || '',
        source: outgoingSource,
        timestampMs,
      });

      if (archived) {
        console.log('  Archived.');
        stats.archived++;
      }

      // Cleared either way — see archiveSentMessage for why a failure here must
      // not hold up the queue.
      await deleteNotification(receiptId);
      await sleep(API_PAUSE_MS);
      continue;
    }

    if (typeWebhook !== 'incomingMessageReceived') {
      await discard(`webhook type ${typeWebhook}`);
      continue;
    }

    const chatId = body?.senderData?.chatId || '';
    const sender = body?.senderData?.sender || '';

    // Group chats end in @g.us. Everything else is a one-to-one chat: today
    // that means @c.us, but WhatsApp is replacing phone numbers with opaque
    // @lid identifiers, so we must NOT require @c.us — that would silently drop
    // real submissions once a contact migrates. Identifying the group form and
    // treating the rest as direct is the check that survives the migration.
    if (chatId.endsWith('@g.us')) {
      await discard('group message, not a direct one');
      continue;
    }

    const verdict = await senderVerdict(sender, chatId);

    if (verdict === 'unknown') {
      console.warn(
        `  ⚠️  Cannot verify sender ${maskPhone(sender)}: the @lid lookup failed. ` +
          'Leaving the message queued for the next run rather than discarding it.'
      );
      stats.leftQueued++;
      break;
    }

    if (verdict === 'denied') {
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

/**
 * One row per message sent, with no grouping.
 *
 * Grouping was considered and rejected: send-whatsapp-eventos.js pauses 2s
 * between the images of one event and 3s between events, so a time window
 * cannot tell "another photo of the same announcement" from "the next
 * announcement" and would silently merge two unrelated publications.
 */
function sentMessageFields(sent) {
  const text = sent.text || '';
  const fields = {
    [ARCHIVE_FIELD_SUMMARY]: text ? text.replace(/\s+/g, ' ').slice(0, 60) : '(solo adjunto)',
    [ARCHIVE_FIELD_MESSAGE]: text,
    [ARCHIVE_FIELD_SENT_AT]: new Date(sent.timestampMs).toISOString(),
    [ARCHIVE_FIELD_CHAT]: sent.chatName || sent.chatId,
    [ARCHIVE_FIELD_SOURCE]: sent.source,
    [ARCHIVE_FIELD_MESSAGE_ID]: sent.idMessage,
  };

  if (sent.attachment) {
    fields[ARCHIVE_FIELD_ATTACHMENTS] = [
      { url: sent.attachment.url, filename: sent.attachment.filename },
    ];
  }

  return fields;
}

/**
 * Copy a sent message into the archive base. Returns true on success.
 *
 * DELIBERATELY NOT FATAL, unlike the intake write. The queue is strictly
 * oldest-first and nothing moves until the head is acknowledged, so refusing to
 * delete a message we failed to archive would stall the queue and stop real
 * submissions from families arriving — a far worse outcome than losing a copy of
 * a broadcast we already sent. So on failure this warns, prints enough of the
 * message to re-enter it by hand, and lets the caller clear the notification.
 */
async function archiveSentMessage(sent) {
  const url = `${AIRTABLE_API}/${ARCHIVE_BASE_ID}/${encodeURIComponent(ARCHIVE_TABLE_NAME)}`;

  try {
    const res = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ARCHIVE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records: [{ fields: sentMessageFields(sent) }], typecast: true }),
      },
      'Airtable archive'
    );

    if (res.ok) return true;

    const err = await res.json().catch(() => ({}));
    console.warn(
      `  ⚠️  Could not archive the sent message: Airtable ${res.status} ` +
        `${err?.error?.message || res.statusText}`
    );
  } catch (archiveError) {
    console.warn(`  ⚠️  Could not archive the sent message: ${archiveError.message}`);
  }

  console.warn(`     Text was: ${(sent.text || '(solo adjunto)').slice(0, 200)}`);
  return false;
}

async function main() {
  console.log(
    `Reading green-api queue${DRY_RUN ? ' (DRY RUN — inspect only, nothing is changed)' : ''}...`
  );
  console.log(`Allowlist: ${ALLOWLIST.map(maskPhone).join(', ')}`);

  const transcribers = [
    CF_CONFIGURED ? 'Cloudflare' : null,
    GEMINI_API_KEY ? 'Gemini' : null,
  ].filter(Boolean);
  console.log(
    `Voice notes: ${transcribers.length ? transcribers.join(', then ') : 'no transcriber configured — audio will be attached for a human'}`
  );
  if (ARCHIVE_COLLIDES_WITH_INTAKE) {
    console.warn(
      `⚠️  Sent-message archive: OFF — it is pointed at "${TABLE_NAME}", the intake table ` +
        'itself. Set AIRTABLE_ARCHIVE_TABLE to a different table.'
    );
  } else {
    console.log(
      ARCHIVE_ENABLED
        ? `Sent-message archive: ON — group messages are copied to "${ARCHIVE_TABLE_NAME}"`
        : 'Sent-message archive: off (set AIRTABLE_ARCHIVE_BASE_ID to turn it on)'
    );
  }

  const stats = await processQueue();

  console.log(
    `Read ${stats.seen} notification(s): ${stats.created} row(s) created, ` +
      `${stats.appended} follow-up(s) merged, ${stats.archived} sent message(s) archived, ` +
      `${stats.discarded} discarded, ${stats.leftQueued} left queued.`
  );

  if (stats.created === 0 && stats.appended === 0) {
    console.log('No new submissions.');
  }

  if (stats.abortedBy) {
    const progress = stats.created + stats.appended + stats.archived + stats.discarded;

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
