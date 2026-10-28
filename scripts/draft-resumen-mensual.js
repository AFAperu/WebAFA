#!/usr/bin/env node
/**
 * Drafts the monthly newsletter from everything the AFA published, and leaves it
 * in Airtable for a human to edit and approve.
 *
 * WHERE THE CONTENT COMES FROM
 * ----------------------------
 * The "Mensajes enviados" table holds what we actually published: messages sent
 * to the WhatsApp group (announcements, mostly) and Instagram captions (written
 * after the fact, so they describe how things went). The rule that makes this
 * trustworthy is the user's: if it was published, it happened — unless a later
 * message said otherwise.
 *
 * WHY ONLY HALF OF THIS IS AI
 * ---------------------------
 * The "lo que viene" section is built in code from the events table: real dates,
 * real names, weekdays computed rather than guessed. That is the half readers act
 * on, so it carries no risk of invention. The model only writes the recap, where
 * grouping and rewriting genuinely need judgement.
 *
 * SAFETY — the draft row deliberately leaves "Dónde publicar", "Fecha
 * comunicación" and "Hora publicación" EMPTY. Those three are what make
 * send-email-eventos.js pick a row up and mail every family, so leaving them
 * blank is what keeps an unreviewed draft unsent. A human fills them in to
 * approve. Nothing here may ever write them.
 *
 * The row has no "Fecha evento" either, which keeps it off the website:
 * fetch-eventos.js only exports rows tagged "Web", and /calendario/ skips
 * dateless entries anyway.
 *
 * Environment variables:
 *   AIRTABLE_TOKEN            — read-only PAT (reads the archive and the events)
 *   AIRTABLE_INTAKE_TOKEN     — write-scoped PAT (creates the draft row)
 *   AIRTABLE_EVENTOS_BASE_ID  — base holding "Eventos colegio Perú"
 *   AIRTABLE_ARCHIVE_BASE_ID  — OPTIONAL, defaults to the eventos base
 *   AIRTABLE_ARCHIVE_TABLE    — OPTIONAL, defaults to "Mensajes enviados"
 *   CLOUDFLARE_ACCOUNT_ID     — Workers AI. Chosen over Gemini because
 *   CLOUDFLARE_API_TOKEN        Cloudflare states it does not use Customer
 *                               Content to train models. Needs Workers AI
 *                               Read AND Edit.
 *   CLOUDFLARE_TEXT_MODEL     — OPTIONAL, defaults to llama-3.3-70b-instruct-fp8-fast
 *   MONTH                     — OPTIONAL "YYYY-MM". Defaults to last month.
 *   DRY_RUN                   — "true" to print the draft and write nothing
 */

const READ_TOKEN = process.env.AIRTABLE_TOKEN;
const WRITE_TOKEN = process.env.AIRTABLE_INTAKE_TOKEN;
const EVENTOS_BASE_ID = process.env.AIRTABLE_EVENTOS_BASE_ID;
const ARCHIVE_BASE_ID = process.env.AIRTABLE_ARCHIVE_BASE_ID || EVENTOS_BASE_ID;
const ARCHIVE_TABLE = process.env.AIRTABLE_ARCHIVE_TABLE || 'Mensajes enviados';
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_MODEL = process.env.CLOUDFLARE_TEXT_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const DRY_RUN = process.env.DRY_RUN === 'true';

const EVENTOS_TABLE = 'Eventos colegio Perú';
const AIRTABLE_API = 'https://api.airtable.com/v0';
const CALENDAR_URL = 'https://afaceipperu.org/calendario';

/** Columns of the archive table. */
const A_MESSAGE = 'Mensaje';
const A_SENT_AT = 'Enviado el';
const A_SOURCE = 'Origen';
const A_LINK = 'Enlace';

/** Columns of the events table. */
const E_NAME = 'Name';
const E_DATE = 'Fecha evento';
const E_DATE_END = 'Fecha fin de evento';
const E_TIME = 'Hora (hh:mm)';
const E_TIME_END = 'Hora fin (hh:mm)';
const E_WHERE = 'Dónde publicar';
const E_DESC = 'Descripción o info extra';
const E_BODY = 'Texto para redes';

/**
 * The draft is tagged in "Descripción o info extra" so a re-run can find it
 * instead of making a second copy. That column is safe for this: the email path
 * reads only Name, Texto para redes, Dónde publicar and Imagen para redes, and
 * the website never sees a row that is not tagged "Web".
 */
const DRAFT_MARKER = 'resumen-mensual';

/** How many upcoming activities to list. Beyond this the section stops being read. */
const MAX_UPCOMING = 8;
/**
 * "Lo que viene" covers the month AFTER the one being summarised. But a floor
 * matters more than the rule: this calendar is empty in July and August, and a
 * June summary whose only forward-looking section is blank is a worse email than
 * one that peeks into September. So if the next month has fewer than this many
 * activities, keep going down the calendar until it does.
 */
const MIN_UPCOMING = 4;
/** Guardrail on the prompt size: the model's context is 24k tokens. */
const MAX_ENTRIES = 80;

const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const missing = [
  ['AIRTABLE_TOKEN', READ_TOKEN],
  ['AIRTABLE_EVENTOS_BASE_ID', EVENTOS_BASE_ID],
  ['CLOUDFLARE_ACCOUNT_ID', CF_ACCOUNT_ID],
  ['CLOUDFLARE_API_TOKEN', CF_API_TOKEN],
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (!DRY_RUN && !WRITE_TOKEN) missing.push('AIRTABLE_INTAKE_TOKEN');

if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class NetworkError extends Error {}

const MAX_FETCH_ATTEMPTS = 4;

function networkDetail(err) {
  return err?.cause?.code || err?.cause?.message || err?.message || 'unknown';
}

/** fetch, retrying only connection failures. HTTP errors go back untouched. */
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

/* ───────────────────────────── dates ───────────────────────────── */

/** Calendar day in Madrid for an ISO timestamp, as "YYYY-MM-DD". */
function madridDay(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function todayMadrid() {
  return madridDay(new Date().toISOString());
}

/** The month to summarise: the one just finished, unless MONTH overrides it. */
function targetMonth() {
  const override = (process.env.MONTH || '').trim();
  if (override) {
    if (!/^\d{4}-\d{2}$/.test(override)) {
      console.error(`MONTH must look like "2026-10", got "${override}".`);
      process.exit(1);
    }
    return override;
  }

  const [year, month] = todayMadrid().split('-').map(Number);
  const previous = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  return `${previous.y}-${String(previous.m).padStart(2, '0')}`;
}

function monthLabel(monthKey) {
  const [year, month] = monthKey.split('-');
  return `${MONTH_NAMES[Number(month) - 1]} de ${year}`;
}

function nextMonthKey(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  return `${next.y}-${String(next.m).padStart(2, '0')}`;
}

/**
 * "viernes 13 de noviembre". Parsed at midday so that a date-only string cannot
 * slide to the previous day when converted through a timezone.
 */
function longDate(isoDay) {
  const date = new Date(`${isoDay}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDay;

  const formatted = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);

  /*
   * es-ES produces "viernes, 13 de noviembre". Drop that comma: a time phrase
   * gets appended after the date, and "sábado, 21 de noviembre, de 9:30 a 13:30"
   * reads like a list of three things rather than one date.
   */
  return formatted.replace(/^(\p{L}+),\s/u, '$1 ');
}

function timePhrase(start, end) {
  if (!start) return '';
  if (end) return `, de ${start} a ${end}`;
  return `, a las ${start}`;
}

/* ───────────────────────────── Airtable ───────────────────────────── */

async function airtableList(baseId, table, { token, formula, fields, sort } = {}) {
  const records = [];
  let offset = null;
  let calls = 0;

  do {
    const url = new URL(`${AIRTABLE_API}/${baseId}/${encodeURIComponent(table)}`);
    if (formula) url.searchParams.set('filterByFormula', formula);
    for (const field of fields || []) url.searchParams.append('fields[]', field);
    if (sort) {
      url.searchParams.set('sort[0][field]', sort.field);
      url.searchParams.set('sort[0][direction]', sort.direction || 'asc');
    }
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetchWithRetry(
      url.toString(),
      { headers: { Authorization: `Bearer ${token}` } },
      `Airtable read ${table}`
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const hint =
        res.status === 403
          ? ` Check the token has data.records:read on that base, and that the table "${table}" exists.`
          : '';
      throw new Error(
        `Airtable read ${res.status} on "${table}": ${err?.error?.message || res.statusText}.${hint}`
      );
    }

    const data = await res.json();
    records.push(...(data.records || []));
    offset = data.offset || null;
    calls++;
  } while (offset && calls < 20);

  return records;
}

/**
 * Everything published in the target month.
 *
 * Airtable pre-filters roughly (a couple of days wide, to stay clear of timezone
 * edges) and the exact month boundary is applied here in Madrid time, where it
 * is easy to reason about.
 */
async function fetchPublished(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const cutoff = new Date(Date.UTC(year, month - 1, 1));
  cutoff.setUTCDate(cutoff.getUTCDate() - 2);
  const cutoffDay = cutoff.toISOString().slice(0, 10);

  const records = await airtableList(ARCHIVE_BASE_ID, ARCHIVE_TABLE, {
    token: READ_TOKEN,
    formula: `IS_AFTER({${A_SENT_AT}}, "${cutoffDay}")`,
    fields: [A_MESSAGE, A_SENT_AT, A_SOURCE, A_LINK],
    sort: { field: A_SENT_AT, direction: 'asc' },
  });

  return records
    .map(record => {
      const f = record.fields;
      return {
        day: madridDay(f[A_SENT_AT]),
        source: f[A_SOURCE] || '',
        text: (f[A_MESSAGE] || '').trim(),
        link: f[A_LINK] || '',
      };
    })
    .filter(entry => entry.day.startsWith(monthKey) && entry.text);
}

/** Upcoming activities, from the events table. Only "Web" rows, as agreed. */
async function fetchUpcoming() {
  const today = todayMadrid();

  const records = await airtableList(EVENTOS_BASE_ID, EVENTOS_TABLE, {
    token: READ_TOKEN,
    fields: [E_NAME, E_DATE, E_DATE_END, E_TIME, E_TIME_END, E_WHERE, E_DESC],
    sort: { field: E_DATE, direction: 'asc' },
  });

  return records
    .map(record => {
      const f = record.fields;
      return {
        name: (f[E_NAME] || '').trim(),
        date: f[E_DATE] || '',
        dateEnd: f[E_DATE_END] || '',
        time: f[E_TIME] || '',
        timeEnd: f[E_TIME_END] || '',
        where: f[E_WHERE] || [],
        description: (f[E_DESC] || '').trim(),
      };
    })
    .filter(e => e.name && e.date && e.date >= today && e.where.includes('Web'));
}

/* ───────────────────────────── the model ───────────────────────────── */

const SYSTEM_PROMPT = `Eres quien redacta las comunicaciones del AFA del CEIP Perú (Carabanchel, Madrid). Escribes para las familias del colegio: cercano, tuteando, sin solemnidad. Respondes SIEMPRE con un único objeto JSON válido, sin texto alrededor y sin bloques de código.`;

function buildUserPrompt(monthKey, entries) {
  const material = entries
    .map((entry, i) => {
      const channel = entry.source === 'Instagram' ? 'Instagram' : 'WhatsApp';
      return `[${i + 1}] ${entry.day} · ${channel}\n${entry.text}`;
    })
    .join('\n\n');

  return `Esto es todo lo que el AFA publicó en ${monthLabel(monthKey)}.

MATERIAL DEL MES:
${material}

Devuelve un JSON con esta forma exacta:
{"asunto": "...", "entradilla": "...", "hechos": ["...", "..."]}

- asunto: línea de asunto de correo, máximo 60 caracteres. Nombra 2 o 3 cosas
  reales del mes. Nunca "Newsletter", "Boletín" ni "Resumen mensual".
- entradilla: una o dos frases para abrir. Empieza por el gancho, no por
  "Os informamos de que".
- hechos: entre 5 y 8 líneas, una por actividad. Cada línea empieza por un
  emoji, luego el nombre de la actividad entre ** y ** y una frase corta.

REGLAS SOBRE LOS HECHOS — esto es lo importante:

1. Solo lo que YA HA PASADO. Una publicación escrita en futuro ("el sábado que
   viene", "¿te apuntas?") es un anuncio: la actividad cuenta, pero no copies la
   invitación, porque cuando se lea el correo ya habrá pasado.

2. NO INVENTES RESULTADOS. Puedes decir que algo se organizó, se celebró o
   arrancó. No digas cuánta gente fue, que fue un éxito ni que gustó mucho, a
   menos que el texto original lo diga. Si lo dice, puedes recogerlo.

3. AGRUPA lo repetido. Cuatro sesiones del club de lectura son UNA línea que
   menciona los cursos, no cuatro líneas.

4. SIN FECHAS NI HORAS. Ya ha pasado; el día exacto no le sirve a nadie.

5. RESPETA QUIÉN ORGANIZA. Si el texto dice que organiza otra entidad y el AFA
   colabora, no lo cambies por "organizamos". Si menciona una comisión o a las
   personas que lo hicieron, mantenlo: es lo que anima a otras a apuntarse.

6. Quita hashtags, @menciones y asteriscos sueltos de Instagram. Reescribe, no
   copies: el tono de Instagram no es el de un correo.

7. Las movilizaciones y huelgas en defensa de la educación pública se resumen en
   UNA SOLA línea, al final, por muchas publicaciones que haya.

No añadas despedida, ni enlaces, ni nada sobre actividades futuras: de eso se
encarga el programa.`;
}

/**
 * Pull the JSON object out of a model response.
 * Models wrap JSON in prose or code fences often enough that insisting on a
 * clean response is not worth a failed run.
 */
function extractJson(text) {
  const withoutFences = String(text || '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(withoutFences.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Normalise whatever Workers AI put in `result.response`.
 *
 * Most models return a string there. Some return the JSON already parsed, and a
 * few nest the text one level deeper. The first version of this assumed a string
 * and called String() on it, which turned a perfectly good object into
 * "[object Object]" and failed the run with a diagnostic that told you nothing.
 */
function parseModelOutput(raw) {
  if (typeof raw === 'string') return extractJson(raw);
  if (!raw || typeof raw !== 'object') return null;

  // Already the object we asked for.
  if (raw.asunto || raw.hechos) return raw;

  const nested = raw.response ?? raw.content ?? raw.text ?? raw.output;
  if (typeof nested === 'string') return extractJson(nested);
  if (nested && typeof nested === 'object') return nested;

  return null;
}

async function writeRecap(monthKey, entries) {
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
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(monthKey, entries) },
        ],
        max_tokens: 1500,
        temperature: 0.4,
      }),
    },
    'Cloudflare text generation'
  );

  if (!res.ok) {
    const body = await res.text();
    const hint =
      res.status === 403
        ? ' (the API token needs Workers AI Read AND Edit)'
        : res.status === 404
          ? ` (model "${CF_MODEL}" not found — set CLOUDFLARE_TEXT_MODEL to a current one)`
          : '';
    throw new Error(`Cloudflare ${res.status}${hint}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  if (!data?.success) {
    const problems = (data?.errors || []).map(e => e.message).join('; ');
    throw new Error(`Cloudflare rejected the request: ${problems || 'unknown reason'}`);
  }

  const parsed = parseModelOutput(data?.result?.response);

  if (!parsed || !parsed.asunto || !Array.isArray(parsed.hechos) || parsed.hechos.length === 0) {
    console.error('The model did not return the expected JSON. What came back:');
    // JSON.stringify, not String: an object logged with String() reads
    // "[object Object]" and hides the very thing you need to see.
    console.error(JSON.stringify(data?.result, null, 2).slice(0, 1000));
    throw new Error('Unusable response from the model. Nothing was written.');
  }

  return {
    asunto: String(parsed.asunto).trim().slice(0, 120),
    entradilla: String(parsed.entradilla || '').trim(),
    hechos: parsed.hechos.map(h => String(h).trim()).filter(Boolean).slice(0, 10),
  };
}

/* ───────────────────────────── assembly ───────────────────────────── */

/**
 * The forward section, built here rather than by the model.
 *
 * Repeats of the same activity collapse into one line with both dates, which is
 * how a reader wants to see "club de lectura de 1º" twice in two months. A
 * grouped line drops the description, since two dates can have different ones.
 */
/**
 * Narrow the upcoming events to the month after the one summarised.
 *
 * `events` arrives sorted by date and already filtered to today or later, so no
 * future event can precede the scope month and taking a prefix is enough. When
 * the scope month is quiet — or in the past, which happens when MONTH is used to
 * backfill an old month — the prefix grows until MIN_UPCOMING is met.
 */
function selectUpcoming(events, monthKey) {
  const scope = nextMonthKey(monthKey);
  const inScope = events.filter(event => event.date.startsWith(scope)).length;
  const limit = Math.min(MAX_UPCOMING, Math.max(MIN_UPCOMING, inScope));

  return { scope, events: events.slice(0, limit), inScope };
}

function upcomingLines(events) {
  const byName = new Map();
  for (const event of events) {
    if (!byName.has(event.name)) byName.set(event.name, []);
    byName.get(event.name).push(event);
  }

  const lines = [];
  for (const [name, group] of byName) {
    const dates = group
      .map(e => `${longDate(e.date)}${e.dateEnd && e.dateEnd !== e.date ? ` al ${longDate(e.dateEnd)}` : ''}${timePhrase(e.time, e.timeEnd)}`)
      .join(' y ');

    let line = `- **${name}** — ${dates}`;

    if (group.length === 1 && group[0].description) {
      const description = group[0].description.replace(/\s+/g, ' ').trim();
      line += `. ${description.length > 220 ? `${description.slice(0, 220)}…` : description}`;
    }

    lines.push(line);
  }

  return lines;
}

/**
 * Up to three Instagram links, so the recap can point at the photos instead of
 * attaching them. Attachments on this row would arrive as files rather than
 * appearing in the email body, and they would spend the base's 1 GB allowance.
 */
function photoLinks(entries) {
  return entries
    .filter(entry => entry.source === 'Instagram' && entry.link)
    .slice(-3)
    .map(entry => entry.link);
}

function buildBody(monthKey, recap, upcoming, links) {
  const parts = [];

  if (recap.entradilla) parts.push(recap.entradilla);

  parts.push(`## Esto hemos hecho en ${monthLabel(monthKey).replace(/ de \d{4}$/, '')}`);
  parts.push(recap.hechos.map(h => (h.startsWith('-') ? h : `- ${h}`)).join('\n'));

  if (links.length > 0) {
    parts.push(
      `📸 Las fotos están en Instagram: ${links.map((l, i) => `[${i + 1}](${l})`).join(' · ')}`
    );
  }

  if (upcoming.length > 0) {
    parts.push('## Lo que viene');
    parts.push(upcoming.join('\n'));
  }

  parts.push(`Calendario completo en [afaceipperu.org/calendario](${CALENDAR_URL}).`);
  parts.push('¿Te apetece echar una mano en alguna? Responde a este correo y te contamos.');

  return parts.join('\n\n');
}

/* ───────────────────────────── writing the draft ───────────────────────────── */

async function existingDraft(monthKey) {
  const records = await airtableList(EVENTOS_BASE_ID, EVENTOS_TABLE, {
    token: READ_TOKEN,
    formula: `FIND("${DRAFT_MARKER}:${monthKey}", {${E_DESC}})`,
    fields: [E_NAME],
  });

  return records[0] || null;
}

async function createDraft(monthKey, asunto, body) {
  /*
   * Only four fields. "Dónde publicar", "Fecha comunicación" and "Hora
   * publicación" stay empty on purpose — they are the switch that sends this to
   * every family, and only a human may flip it.
   */
  const fields = {
    [E_NAME]: asunto,
    [E_BODY]: body,
    [E_DESC]: `${DRAFT_MARKER}:${monthKey} · borrador generado automáticamente, revísalo antes de publicar`,
  };

  const res = await fetchWithRetry(
    `${AIRTABLE_API}/${EVENTOS_BASE_ID}/${encodeURIComponent(EVENTOS_TABLE)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WRITE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records: [{ fields }], typecast: true }),
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

async function main() {
  const monthKey = targetMonth();
  console.log(
    `Drafting the summary for ${monthLabel(monthKey)}` +
      `${DRY_RUN ? ' (DRY RUN — nothing will be written)' : ''}...`
  );

  const published = await fetchPublished(monthKey);
  const whatsapp = published.filter(e => e.source !== 'Instagram').length;
  const instagram = published.length - whatsapp;
  console.log(
    `Published that month: ${published.length} item(s) — ${whatsapp} on WhatsApp, ${instagram} on Instagram.`
  );

  if (published.length === 0) {
    console.log(
      'Nothing was published that month, so there is nothing to summarise. Done.'
    );
    return;
  }

  if (!DRY_RUN) {
    const existing = await existingDraft(monthKey);
    if (existing) {
      console.log(
        `A draft for ${monthLabel(monthKey)} already exists (${existing.id}: ` +
          `"${existing.fields?.[E_NAME] || 'sin título'}").`
      );
      console.log('Delete it first if you want a fresh one. Done.');
      return;
    }
  }

  const allUpcoming = await fetchUpcoming();
  const upcoming = selectUpcoming(allUpcoming, monthKey);
  console.log(
    `Upcoming: ${upcoming.inScope} activity(ies) in ${monthLabel(upcoming.scope)}, ` +
      `listing ${upcoming.events.length}.` +
      (upcoming.events.length > upcoming.inScope
        ? ` ${monthLabel(upcoming.scope)} was thin, so later dates were added.`
        : '')
  );

  const entries = published.slice(0, MAX_ENTRIES);
  if (published.length > MAX_ENTRIES) {
    console.warn(`⚠️  Only the first ${MAX_ENTRIES} items are sent to the model.`);
  }

  console.log(`Asking ${CF_MODEL} for the recap...`);
  const recap = await writeRecap(monthKey, entries);
  console.log(`Got ${recap.hechos.length} line(s). Subject: "${recap.asunto}"`);

  const body = buildBody(monthKey, recap, upcomingLines(upcoming.events), photoLinks(entries));

  if (DRY_RUN) {
    console.log(`\n${'─'.repeat(70)}\nAsunto: ${recap.asunto}\n${'─'.repeat(70)}`);
    console.log(body);
    console.log(`${'─'.repeat(70)}\nDRY RUN — no row was created.`);
    return;
  }

  const record = await createDraft(monthKey, recap.asunto, body);

  console.log(`\nDraft created: ${record.id}`);
  console.log(
    'It will NOT be sent until a human sets "Dónde publicar" to an Email option ' +
      'and "Fecha comunicación" to the day it should go out.'
  );
  console.log('Done.');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
