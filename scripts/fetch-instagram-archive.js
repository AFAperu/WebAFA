#!/usr/bin/env node
/**
 * Copies the AFA's own Instagram posts into the same Airtable table that holds
 * the WhatsApp messages we send, so there is one chronological record of
 * everything published.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS
 * -----------------------------------
 * The WhatsApp archive is full of announcements: things we said we WOULD do. An
 * announcement cannot tell you whether an activity actually happened, let alone
 * how it went. Instagram is where the AFA posts afterwards, with photos — so an
 * Instagram caption is us describing the outcome in our own words. That is the
 * only outcome evidence in this system that nobody has to remember to maintain.
 *
 * Reading uses the SAME credentials that send-instagram-eventos.js already uses
 * to publish. Publishing needs the instagram_basic and instagram_content_publish
 * permissions; reading your own media needs only instagram_basic, so no new app,
 * permission review or secret is required.
 *
 * DIFFERENT FROM THE WHATSAPP CAPTURE: green-api hands out each notification
 * once and forgets it, so duplicates were impossible. This endpoint returns the
 * same posts on every single run, so deduplication is this script's main job. It
 * reads back the Instagram ids already stored and skips them. If that read
 * fails, the script refuses to write rather than risk duplicating the table.
 *
 * Environment variables:
 *   INSTAGRAM_ACCESS_TOKEN    — the long-lived token already used for publishing
 *   INSTAGRAM_ACCOUNT_ID      — Instagram Business Account ID
 *   AIRTABLE_ARCHIVE_BASE_ID  — base holding the "Mensajes enviados" table
 *   AIRTABLE_ARCHIVE_TOKEN    — OPTIONAL, defaults to AIRTABLE_INTAKE_TOKEN
 *   AIRTABLE_INTAKE_TOKEN     — write-scoped Airtable PAT (the existing one)
 *   AIRTABLE_ARCHIVE_TABLE    — OPTIONAL, defaults to "Mensajes enviados"
 *   INSTAGRAM_LOOKBACK_DAYS   — OPTIONAL, defaults to 90
 *   DRY_RUN                   — "true" to list what would be stored and write
 *                               nothing. Prints the captions, which is the point
 *                               of the first run: it shows what raw material a
 *                               summary could actually be built from.
 */

const IG_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const IG_ACCOUNT = process.env.INSTAGRAM_ACCOUNT_ID;
const AIRTABLE_TOKEN = process.env.AIRTABLE_ARCHIVE_TOKEN || process.env.AIRTABLE_INTAKE_TOKEN;
const BASE_ID = process.env.AIRTABLE_ARCHIVE_BASE_ID;
const TABLE_NAME = process.env.AIRTABLE_ARCHIVE_TABLE || 'Mensajes enviados';
const DRY_RUN = process.env.DRY_RUN === 'true';

const LOOKBACK_DAYS = Number(process.env.INSTAGRAM_LOOKBACK_DAYS) || 90;

const GRAPH_API = 'https://graph.facebook.com/v25.0';
const AIRTABLE_API = 'https://api.airtable.com/v0';

/** Same column names the WhatsApp archive writes, so both share one table. */
const FIELD_SUMMARY = 'Resumen';
const FIELD_MESSAGE = 'Mensaje';
const FIELD_SENT_AT = 'Enviado el';
const FIELD_CHAT = 'Chat';
const FIELD_SOURCE = 'Origen';
const FIELD_ATTACHMENTS = 'Adjuntos';
const FIELD_MESSAGE_ID = 'ID mensaje';
/** Instagram-only: the public link to the post. */
const FIELD_LINK = 'Enlace';

/** Marks these rows as Instagram in the shared "Origen" single-select. */
const SOURCE_INSTAGRAM = 'Instagram';

const MEDIA_FIELDS = [
  'id',
  'caption',
  'media_type',
  'media_url',
  'permalink',
  'timestamp',
  'thumbnail_url',
  'children{media_url,media_type}',
].join(',');

/** Posts per page. An AFA account posts a few times a month, so one page is plenty. */
const PAGE_SIZE = 50;
/** Hard stop, so a paging bug can never loop forever. */
const MAX_PAGES = 10;
/** Airtable accepts 10 records per create call; fewer calls, and Free caps them monthly. */
const AIRTABLE_BATCH = 10;
const API_PAUSE_MS = 400;

if (!IG_TOKEN || !IG_ACCOUNT) {
  console.error(
    'Missing required env vars. Need: INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_ACCOUNT_ID'
  );
  process.exit(1);
}

// A dry run only reads, so it is useful even before the Airtable side exists.
if (!DRY_RUN && (!AIRTABLE_TOKEN || !BASE_ID)) {
  console.error(
    'Missing required env vars. Need: AIRTABLE_ARCHIVE_BASE_ID and ' +
      'AIRTABLE_ARCHIVE_TOKEN (or AIRTABLE_INTAKE_TOKEN). Use DRY_RUN=true to read only.'
  );
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Raised when a call could not be made at all, as opposed to being refused. */
class NetworkError extends Error {}

const MAX_FETCH_ATTEMPTS = 4;

/**
 * Node reports every connection-level problem as the unhelpfully terse "fetch
 * failed", hiding the real reason in err.cause. Dig it out for the log.
 */
function networkDetail(err) {
  return err?.cause?.code || err?.cause?.message || err?.message || 'unknown';
}

/**
 * fetch, but tolerant of the transient blips a shared CI runner throws. Only
 * connection failures are retried; an HTTP error response goes back to the
 * caller untouched, because "403 forbidden" will not fix itself.
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
 * Graph API errors are JSON and say exactly what is wrong — an expired token and
 * a missing permission look nothing alike, so quote the message rather than the
 * status. Never log the URL: paging links carry the access token.
 */
/**
 * Turn a Graph API error into something actionable.
 *
 * Code 190 covers two completely different problems and the distinction decides
 * what you do next, so split on the message: "could not be decrypted" means the
 * stored VALUE is mangled (truncated on copy, wrapped in quotes, a stray space
 * or newline), while the rest of code 190 means a real token that is no longer
 * accepted. Treating the first as expiry sends you off to generate another
 * perfectly good token and paste it in just as badly.
 */
function graphHint(err) {
  if (err.code === 190) {
    if (/could not be decrypted|malformed/i.test(err.message || '')) {
      return (
        ' — the token VALUE looks mangled, not expired. Check the secret for a ' +
        'truncated copy, surrounding quotes, or a stray space or line break'
      );
    }
    return ' — the access token has expired or been invalidated; regenerate it';
  }

  if (err.code === 10 || err.code === 200) {
    return ' — the token is missing a permission for this call (instagram_basic)';
  }

  return '';
}

async function graphError(res, label) {
  const body = await res.json().catch(() => ({}));
  const err = body?.error || {};

  return new Error(
    `${label} ${res.status}: ${err.message || 'unknown error'}${
      err.code ? ` (code ${err.code})` : ''
    }${graphHint(err)}`
  );
}

/** The account's @handle, used as the "Chat" value. Cosmetic, so never fatal. */
async function accountHandle() {
  try {
    const url = new URL(`${GRAPH_API}/${IG_ACCOUNT}`);
    url.searchParams.set('fields', 'username');
    url.searchParams.set('access_token', IG_TOKEN);

    const res = await fetchWithRetry(url.toString(), {}, 'Instagram account');
    if (!res.ok) {
      console.warn(`  ⚠️  Could not read the account handle: ${res.status}`);
      return 'Instagram';
    }

    const data = await res.json();
    return data?.username ? `@${data.username}` : 'Instagram';
  } catch (err) {
    console.warn(`  ⚠️  Could not read the account handle: ${err.message}`);
    return 'Instagram';
  }
}

/**
 * Walk the account's own media, newest first, stopping once a page is entirely
 * older than the window.
 *
 * The endpoint takes no date filter, so the cutoff is applied here. Posts come
 * back newest first, so the first post older than the cutoff means everything
 * after it is older too.
 */
async function fetchRecentPosts(cutoffMs) {
  const first = new URL(`${GRAPH_API}/${IG_ACCOUNT}/media`);
  first.searchParams.set('fields', MEDIA_FIELDS);
  first.searchParams.set('limit', String(PAGE_SIZE));
  first.searchParams.set('access_token', IG_TOKEN);

  const posts = [];
  let next = first.toString();

  for (let page = 1; next && page <= MAX_PAGES; page++) {
    const res = await fetchWithRetry(next, {}, `Instagram media page ${page}`);
    if (!res.ok) throw await graphError(res, 'Instagram media');

    const data = await res.json();
    const batch = data?.data || [];
    console.log(`  Page ${page}: ${batch.length} post(s).`);

    let reachedCutoff = false;
    for (const post of batch) {
      const ts = Date.parse(post.timestamp);
      if (!Number.isFinite(ts)) {
        console.warn(`  ⚠️  Post ${post.id} has an unreadable timestamp, skipping.`);
        continue;
      }
      if (ts < cutoffMs) {
        reachedCutoff = true;
        continue;
      }
      posts.push({ ...post, timestampMs: ts });
    }

    if (reachedCutoff) break;
    // Paging links already carry the token and cursor, so follow them verbatim.
    next = data?.paging?.next || null;
    if (next) await sleep(API_PAUSE_MS);
  }

  // Oldest first, so the rows land in the table in the order things happened.
  return posts.sort((a, b) => a.timestampMs - b.timestampMs);
}

/**
 * Collect the Instagram ids already stored, so a post is never archived twice.
 *
 * Only the id column is requested: the table also holds every WhatsApp message
 * ever sent, and pulling full rows to compare one field would get slower every
 * month.
 */
async function storedInstagramIds() {
  const ids = new Set();
  let offset = null;
  let calls = 0;

  do {
    const url = new URL(`${AIRTABLE_API}/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`);
    url.searchParams.set('filterByFormula', `{${FIELD_SOURCE}} = '${SOURCE_INSTAGRAM}'`);
    url.searchParams.append('fields[]', FIELD_MESSAGE_ID);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetchWithRetry(
      url.toString(),
      { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } },
      'Airtable read'
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      /*
       * Airtable returns the same 403 for "your token lacks the scope" and "that
       * table does not exist", so name the likely cause first. The intake token
       * was created with data.records:write only — enough for the WhatsApp
       * archive, which just writes, but this script has to READ to deduplicate.
       */
      const hint =
        res.status === 403
          ? '\n  Most likely the token is missing the data.records:READ scope. ' +
            'AIRTABLE_INTAKE_TOKEN was created write-only, which is fine for writing ' +
            'rows but not for the duplicate check.\n' +
            '  Add data.records:read to it at airtable.com/create/tokens, or set ' +
            'AIRTABLE_ARCHIVE_TOKEN to a token that has both.\n' +
            `  Failing that, check the table "${TABLE_NAME}" exists in that base and has ` +
            `the columns "${FIELD_SOURCE}" and "${FIELD_MESSAGE_ID}".`
          : '';

      throw new Error(
        `Airtable read ${res.status}: ${err?.error?.message || res.statusText}${hint}`
      );
    }

    const data = await res.json();
    for (const record of data.records || []) {
      const id = record.fields?.[FIELD_MESSAGE_ID];
      if (id) ids.add(String(id).trim());
    }

    offset = data.offset || null;
    calls++;
  } while (offset && calls < 20);

  return ids;
}

/**
 * Which single image to attach.
 *
 * One image per post on purpose: the Free plan allows 1 GB of attachments per
 * base, shared with everything else in it, and a carousel of ten photos would
 * spend that budget for no extra editorial value. The permalink is stored too,
 * so the rest of the post is always one click away. Videos contribute their
 * poster frame rather than the video itself, for the same reason.
 */
function pickImage(post) {
  if (post.media_type === 'CAROUSEL_ALBUM') {
    const firstImage = (post.children?.data || []).find(
      child => child.media_type === 'IMAGE' && child.media_url
    );
    if (firstImage) return firstImage.media_url;
    return post.thumbnail_url || null;
  }

  if (post.media_type === 'IMAGE') return post.media_url || null;

  return post.thumbnail_url || null;
}

function postFields(post, handle) {
  const caption = (post.caption || '').trim();
  const sentAt = Number.isFinite(post.timestampMs)
    ? new Date(post.timestampMs).toISOString()
    : post.timestamp;

  const fields = {
    [FIELD_SUMMARY]: caption ? caption.replace(/\s+/g, ' ').slice(0, 60) : '(sin texto)',
    [FIELD_MESSAGE]: caption,
    [FIELD_SENT_AT]: sentAt,
    [FIELD_CHAT]: handle,
    [FIELD_SOURCE]: SOURCE_INSTAGRAM,
    [FIELD_MESSAGE_ID]: post.id,
    [FIELD_LINK]: post.permalink || '',
  };

  const image = pickImage(post);
  if (image) {
    fields[FIELD_ATTACHMENTS] = [{ url: image, filename: `instagram-${post.id}.jpg` }];
  }

  return fields;
}

async function createRecords(records, label) {
  const res = await fetchWithRetry(
    `${AIRTABLE_API}/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records, typecast: true }),
    },
    label
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`${label} ${res.status}: ${err?.error?.message || res.statusText}`);
  }

  return res.json();
}

/**
 * Store the new posts, batching to keep the Airtable call count down.
 *
 * A batched create is all-or-nothing, so one malformed post would take nine good
 * ones with it. On a batch failure the records are retried one at a time, which
 * costs more calls but only in the rare case where something is actually wrong —
 * and it names the post that caused it.
 */
async function archivePosts(posts, handle) {
  let created = 0;
  let failed = 0;

  for (let i = 0; i < posts.length; i += AIRTABLE_BATCH) {
    const slice = posts.slice(i, i + AIRTABLE_BATCH);
    const records = slice.map(post => ({ fields: postFields(post, handle) }));

    try {
      await createRecords(records, 'Airtable create');
      created += records.length;
    } catch (batchError) {
      if (batchError instanceof NetworkError) throw batchError;
      console.warn(`  ⚠️  Batch of ${records.length} rejected: ${batchError.message}`);
      console.warn('     Retrying them one by one to find the culprit.');

      for (const post of slice) {
        try {
          await createRecords([{ fields: postFields(post, handle) }], 'Airtable create');
          created++;
        } catch (singleError) {
          if (singleError instanceof NetworkError) throw singleError;
          console.warn(`  ⚠️  Could not store ${post.permalink || post.id}: ${singleError.message}`);
          failed++;
        }
        await sleep(API_PAUSE_MS);
      }
    }

    await sleep(API_PAUSE_MS);
  }

  return { created, failed };
}

function describe(post, index) {
  const date = new Date(post.timestampMs).toLocaleDateString('es-ES', {
    timeZone: 'Europe/Madrid',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const caption = (post.caption || '').replace(/\s+/g, ' ').trim();
  const type = post.media_type === 'CAROUSEL_ALBUM' ? 'carrusel' : post.media_type.toLowerCase();

  console.log(`\n  ${index}. ${date} · ${type} · ${post.permalink || post.id}`);
  console.log(`     ${caption ? caption.slice(0, 300) : '(sin texto)'}`);
  if (caption.length > 300) console.log(`     …(${caption.length} caracteres en total)`);
}

async function main() {
  const cutoffMs = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const cutoffLabel = new Date(cutoffMs).toISOString().slice(0, 10);

  console.log(
    `Reading our own Instagram posts since ${cutoffLabel} (${LOOKBACK_DAYS} days)` +
      `${DRY_RUN ? ' — DRY RUN, nothing will be written' : ''}...`
  );

  const posts = await fetchRecentPosts(cutoffMs);
  console.log(`Found ${posts.length} post(s) in the window.`);

  if (posts.length === 0) {
    console.log('Nothing to archive. Done.');
    return;
  }

  // Deduplication is the whole safety story here, so a failed read must stop the
  // run: writing blind would duplicate every post on every single day.
  let known = new Set();
  const canDedup = Boolean(AIRTABLE_TOKEN && BASE_ID);

  if (canDedup) {
    known = await storedInstagramIds();
    console.log(`Already stored: ${known.size} Instagram post(s).`);
  } else {
    console.log('Airtable not configured — listing only, no duplicate check possible.');
  }

  const fresh = posts.filter(post => !known.has(String(post.id)));
  console.log(`New since last run: ${fresh.length}.`);

  if (DRY_RUN) {
    const handle = await accountHandle();
    console.log(`\nThese would be stored in "${TABLE_NAME}" as ${handle}:`);
    fresh.forEach((post, i) => describe(post, i + 1));
    console.log(
      `\nDRY RUN — nothing written. ${fresh.length} row(s) would be created, ` +
        `${posts.length - fresh.length} skipped as already stored.`
    );
    return;
  }

  if (fresh.length === 0) {
    console.log('Everything is already archived. Done.');
    return;
  }

  const handle = await accountHandle();
  const { created, failed } = await archivePosts(fresh, handle);

  console.log(
    `Stored ${created} new post(s)${failed ? `, ${failed} failed` : ''} ` +
      `in "${TABLE_NAME}" as ${handle}.`
  );

  // A post we could not store is still on Instagram and will be retried on the
  // next run, so this is worth a warning rather than a red build.
  if (failed > 0) {
    console.warn(`⚠️  ${failed} post(s) could not be stored. They will be retried tomorrow.`);
  }

  console.log('Done.');
}

main().catch(err => {
  if (err instanceof NetworkError) {
    console.error(`Failed: ${err.message}`);
  } else {
    console.error('Failed:', err.message);
  }
  process.exit(1);
});
