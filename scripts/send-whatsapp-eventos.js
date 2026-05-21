#!/usr/bin/env node
/**
 * Fetches today's events from Airtable where "Dónde publicar" includes "WhatsApp",
 * and sends the "Texto para redes" content (with optional image) to a WhatsApp group via Green-api.
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

  const formula = `AND(
    FIND("WhatsApp", ARRAYJOIN({Dónde publicar}, ",")),
    IS_SAME({Fecha comunicación}, "${today}", "day")
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
 * Send a text-only message to the WhatsApp group
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
    throw new Error(`Green-api sendMessage ${res.status}: ${err}`);
  }

  const result = await res.json();
  console.log(`  Text message sent. ID: ${result.idMessage}`);
  return result;
}

/**
 * Send an image (by URL) with caption to the WhatsApp group
 */
async function sendWhatsAppImage(imageUrl, fileName, caption) {
  const url = `${GREEN_API}/sendFileByUrl/${GREEN_TOKEN}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chatId: GROUP_ID,
      urlFile: imageUrl,
      fileName: fileName || 'image.jpg',
      caption: caption || '',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Green-api sendFileByUrl ${res.status}: ${err}`);
  }

  const result = await res.json();
  console.log(`  Image sent. ID: ${result.idMessage}`);
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
    const texto = (fields['Texto para redes'] || '').trim();
    const imagenes = fields['Imagen para redes'] || [];

    if (!texto && imagenes.length === 0) {
      console.log(`Skipping "${fields['Name']}" — no text or image.`);
      continue;
    }

    console.log(`Sending: "${fields['Name']}"...`);

    if (imagenes.length > 0) {
      // Send first image with the text as caption
      const firstImage = imagenes[0];
      await sendWhatsAppImage(firstImage.url, firstImage.filename, texto);

      // Send additional images without caption (if any)
      for (let i = 1; i < imagenes.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        await sendWhatsAppImage(imagenes[i].url, imagenes[i].filename, '');
      }
    } else {
      // No image, send text only
      await sendWhatsAppMessage(texto);
    }

    // Delay between events to avoid rate limiting
    if (records.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  console.log('Done.');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
