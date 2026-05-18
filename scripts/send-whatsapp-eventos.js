#!/usr/bin/env node
/**
 * Fetches today's events from Airtable where "Dónde publicar" includes "WhatsApp",
 * and sends the "Texto para redes" content to a WhatsApp group via Green-api.
 *
 * Environment variables:
 *   AIRTABLE_TOKEN            — Personal Access Token
 *   AIRTABLE_EVENTOS_BASE_ID  — Base ID for eventos
 *   GREENAPI_INSTANCE_ID      — Green-api instance ID
 *   GREENAPI_TOKEN            — Green-api API token
 *   GREENAPI_GROUP_ID         — WhatsApp group chat ID (120363XXX@g.us)
 */

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_EVENTOS_BASE_ID;
const GREEN_INSTANCE = process.env.GREENAPI_INSTANCE_ID;
const GREEN_TOKEN = process.env.GREENAPI_TOKEN;
const GROUP_ID = process.env.GREENAPI_GROUP_ID;

const TABLE_NAME = 'Eventos colegio Perú';
const AIRTABLE_API = 'https://api.airtable.com/v0';
const GREEN_API = `https://api.green-api.com/waInstance${GREEN_INSTANCE}`;

if (!TOKEN || !BASE_ID || !GREEN_INSTANCE || !GREEN_TOKEN || !GROUP_ID) {
  console.error('Missing required env vars. Need: AIRTABLE_TOKEN, AIRTABLE_EVENTOS_BASE_ID, GREENAPI_INSTANCE_ID, GREENAPI_TOKEN, GREENAPI_GROUP_ID');
  process.exit(1);
}

/**
 * Get today's date in YYYY-MM-DD format (Madrid timezone)
 */
function getTodayMadrid() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
}

/**
 * Fetch events from Airtable that should be published to WhatsApp today
 */
async function fetchWhatsAppEvents() {
  const today = getTodayMadrid();

  // Use filterByFormula to get only today's events marked for WhatsApp
  const formula = `AND(
    FIND("WhatsApp", ARRAYJOIN({Dónde publicar}, ",")),
    IS_SAME({Fecha evento}, "${today}", "day")
  )`;

  const url = new URL(`${AIRTABLE_API}/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`);
  url.searchParams.set('filterByFormula', formula);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Airtable API ${res.status}: ${err?.error?.message || res.statusText}`);
  }

  const data = await res.json();
  return data.records;
}

/**
 * Send a message to the WhatsApp group via Green-api
 */
async function sendWhatsAppMessage(message) {
  const url = `${GREEN_API}/sendMessage/${GREEN_TOKEN}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chatId: GROUP_ID,
      message,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Green-api ${res.status}: ${err}`);
  }

  const result = await res.json();
  console.log(`Message sent. ID: ${result.idMessage}`);
  return result;
}

async function main() {
  console.log(`Checking events for today (${getTodayMadrid()}) marked for WhatsApp...`);

  const records = await fetchWhatsAppEvents();

  if (records.length === 0) {
    console.log('No events to send today. Done.');
    return;
  }

  console.log(`Found ${records.length} event(s) to send.`);

  for (const record of records) {
    const fields = record.fields;
    const texto = fields['Texto para redes'];

    if (!texto || texto.trim() === '') {
      console.log(`Skipping "${fields['Name']}" — no "Texto para redes" content.`);
      continue;
    }

    console.log(`Sending: "${fields['Name']}"...`);
    await sendWhatsAppMessage(texto.trim());

    // Small delay between messages to avoid rate limiting
    if (records.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('Done.');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
