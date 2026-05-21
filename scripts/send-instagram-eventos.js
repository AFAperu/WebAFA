#!/usr/bin/env node
/**
 * Fetches today's events from Airtable where "Dónde publicar" includes "Instagram",
 * and publishes them as Instagram posts via the Graph API.
 *
 * Instagram requires an image for every post. Events without an image are skipped.
 *
 * Environment variables:
 *   AIRTABLE_TOKEN            — Personal Access Token
 *   AIRTABLE_EVENTOS_BASE_ID  — Base ID for eventos
 *   INSTAGRAM_ACCESS_TOKEN    — Long-lived Instagram/Facebook access token
 *   INSTAGRAM_ACCOUNT_ID      — Instagram Business Account ID
 */

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_EVENTOS_BASE_ID;
const IG_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const IG_ACCOUNT = process.env.INSTAGRAM_ACCOUNT_ID;

const TABLE_NAME = 'Eventos colegio Perú';
const AIRTABLE_API = 'https://api.airtable.com/v0';
const GRAPH_API = 'https://graph.facebook.com/v25.0';

if (!TOKEN || !BASE_ID || !IG_TOKEN || !IG_ACCOUNT) {
  console.error('Missing required env vars. Need: AIRTABLE_TOKEN, AIRTABLE_EVENTOS_BASE_ID, INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_ACCOUNT_ID');
  process.exit(1);
}

/**
 * Get today's date in YYYY-MM-DD format (Madrid timezone)
 */
function getTodayMadrid() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
}

/**
 * Fetch events from Airtable that should be published to Instagram today
 */
async function fetchInstagramEvents() {
  const today = getTodayMadrid();

  const formula = `AND(
    FIND("Instagram", ARRAYJOIN({Dónde publicar}, ",")),
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
 * Create a media container on Instagram (step 1 of publishing)
 */
async function createMediaContainer(imageUrl, caption) {
  const url = `${GRAPH_API}/${IG_ACCOUNT}/media`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      caption: caption || '',
      access_token: IG_TOKEN,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Instagram create media ${res.status}: ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  console.log(`  Media container created: ${data.id}`);
  return data.id;
}

/**
 * Create a carousel container for multiple images (step 1 for carousels)
 */
async function createCarouselItemContainer(imageUrl) {
  const url = `${GRAPH_API}/${IG_ACCOUNT}/media`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      is_carousel_item: true,
      access_token: IG_TOKEN,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Instagram create carousel item ${res.status}: ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  return data.id;
}

/**
 * Create a carousel container (step 2 for carousels)
 */
async function createCarouselContainer(childrenIds, caption) {
  const url = `${GRAPH_API}/${IG_ACCOUNT}/media`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'CAROUSEL',
      children: childrenIds,
      caption: caption || '',
      access_token: IG_TOKEN,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Instagram create carousel ${res.status}: ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  console.log(`  Carousel container created: ${data.id}`);
  return data.id;
}

/**
 * Wait for media container to be ready, then publish (step 2/3)
 */
async function publishMedia(containerId) {
  // Wait a bit for Instagram to process the image
  await new Promise(resolve => setTimeout(resolve, 5000));

  const url = `${GRAPH_API}/${IG_ACCOUNT}/media_publish`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: containerId,
      access_token: IG_TOKEN,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Instagram publish ${res.status}: ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  console.log(`  Published! Post ID: ${data.id}`);
  return data.id;
}

async function main() {
  console.log(`Checking events for today (${getTodayMadrid()}) marked for Instagram...`);

  const records = await fetchInstagramEvents();

  if (records.length === 0) {
    console.log('No events to post today. Done.');
    return;
  }

  console.log(`Found ${records.length} event(s) to post.`);

  for (const record of records) {
    const fields = record.fields;
    const textoInstagram = (fields['Texto Instagram'] || '').trim();
    const textoRedes = (fields['Texto para redes'] || '').trim();
    const texto = textoInstagram || textoRedes;
    const imagenes = fields['Imagen para redes'] || [];

    if (imagenes.length === 0) {
      console.log(`Skipping "${fields['Name']}" — Instagram requires an image.`);
      continue;
    }

    console.log(`Posting: "${fields['Name']}"...`);

    let containerId;

    if (imagenes.length === 1) {
      // Single image post
      containerId = await createMediaContainer(imagenes[0].url, texto);
    } else {
      // Carousel post (multiple images)
      console.log(`  Creating carousel with ${imagenes.length} images...`);
      const childrenIds = [];
      for (const img of imagenes) {
        const childId = await createCarouselItemContainer(img.url);
        childrenIds.push(childId);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      containerId = await createCarouselContainer(childrenIds, texto);
    }

    await publishMedia(containerId);

    // Delay between posts
    if (records.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }

  console.log('Done.');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
