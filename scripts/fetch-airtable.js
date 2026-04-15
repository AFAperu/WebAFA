#!/usr/bin/env node
/**
 * Fetches extraescolares data from Airtable and writes it to data/extraescolares.json.
 * 
 * Usage:
 *   AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=app... node scripts/fetch-airtable.js
 * 
 * Environment variables:
 *   AIRTABLE_TOKEN   — Personal Access Token (read-only scope)
 *   AIRTABLE_BASE_ID — Base ID (starts with "app...")
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = 'extraescolares';
const API_URL = 'https://api.airtable.com/v0';
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'extraescolares.json');
const IMAGES_DIR = path.join(__dirname, '..', 'images', 'photos', 'extraescolares');

if (!TOKEN || !BASE_ID) {
  console.error('Missing required env vars: AIRTABLE_TOKEN and AIRTABLE_BASE_ID');
  process.exit(1);
}

async function fetchAllRecords() {
  const allRecords = [];
  let offset = null;

  do {
    const url = new URL(`${API_URL}/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`);
    url.searchParams.set('sort[0][field]', 'EXTRAESCOLAR');
    url.searchParams.set('sort[0][direction]', 'asc');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Airtable API ${res.status}: ${err?.error?.message || res.statusText}`);
    }

    const data = await res.json();
    allRecords.push(...data.records);
    offset = data.offset || null;
  } while (offset);

  return allRecords;
}

/**
 * Downloads an image from a URL and saves it locally.
 * Returns the local path relative to the project root (for use in HTML/JSON).
 */
async function downloadImage(url, filename) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const localPath = path.join(IMAGES_DIR, filename);
    fs.writeFileSync(localPath, buffer);
    // Return path relative to project root for use from /extraescolares/listado/
    return `images/photos/extraescolares/${filename}`;
  } catch (err) {
    console.warn(`  ⚠ Could not download image ${filename}: ${err.message}`);
    return null;
  }
}

/**
 * Slugifies a name for use as a filename.
 */
function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function transformRecord(record) {
  const f = record.fields;
  return {
    id: record.id,
    nombre: f['EXTRAESCOLAR'] || '',
    dias: f['Días'] || '',
    participantes: f['PARTICIPANTES'] || '',
    horario: f['Horario'] || '',
    vecesPorSemana: f['VECES POR SEMANA'] || '',
    precioSocio: f['Precio socia/o'] ?? null,
    precioNoSocio: f['Precio NO socia/o'] ?? null,
    empresa: f['Empresa'] || '',
    otrosDatos: f['Otros datos'] || '',
    ubicacion: f['Ubicación'] || '',
    foto: f['Foto'] || null,
    enlace: f['Enlace'] || '',
    activo: f['Activo'] === 'Sí',
    publicado: typeof f['Publicado'] === 'boolean' ? f['Publicado'] : f['Publicado'] !== 'No',
  };
}

async function downloadPhotos(actividades) {
  // Track which names we've already downloaded to avoid duplicates
  const downloaded = new Map();
  let count = 0;

  for (const act of actividades) {
    if (!act.foto || !Array.isArray(act.foto) || act.foto.length === 0) continue;

    const attachment = act.foto[0];
    const remoteUrl = attachment.thumbnails?.large?.url || attachment.url;
    if (!remoteUrl) continue;

    // Build a unique filename from the activity name + attachment id
    const ext = (attachment.filename || 'photo.jpg').split('.').pop();
    const slug = slugify(act.nombre);
    const filename = `${slug}-${attachment.id}.${ext}`;

    if (downloaded.has(filename)) {
      // Reuse already-downloaded path
      act.fotoLocal = downloaded.get(filename);
      continue;
    }

    const localPath = await downloadImage(remoteUrl, filename);
    if (localPath) {
      downloaded.set(filename, localPath);
      act.fotoLocal = localPath;
      count++;
    }
  }

  console.log(`Downloaded ${count} images to ${IMAGES_DIR}`);
}

async function main() {
  console.log('Fetching extraescolares from Airtable...');

  const records = await fetchAllRecords();
  const actividades = records.map(transformRecord).filter(a => a.nombre);

  // Ensure directories exist
  const dataDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

  // Download images locally
  await downloadPhotos(actividades);

  const output = {
    lastUpdated: new Date().toISOString(),
    count: actividades.length,
    actividades,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Wrote ${actividades.length} activities to ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error('Failed to fetch data:', err.message);
  process.exit(1);
});
