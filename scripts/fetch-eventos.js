#!/usr/bin/env node
/**
 * Fetches eventos (calendar) data from Airtable and writes it to data/eventos.json.
 * 
 * Usage:
 *   AIRTABLE_TOKEN=pat... AIRTABLE_EVENTOS_BASE_ID=app... node scripts/fetch-eventos.js
 * 
 * Environment variables:
 *   AIRTABLE_TOKEN            — Personal Access Token (read-only scope)
 *   AIRTABLE_EVENTOS_BASE_ID  — Base ID for eventos (starts with "app...")
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_EVENTOS_BASE_ID;
const TABLE_NAME = 'Eventos colegio Perú';
const API_URL = 'https://api.airtable.com/v0';
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'eventos.json');

if (!TOKEN || !BASE_ID) {
  console.error('Missing required env vars: AIRTABLE_TOKEN and AIRTABLE_EVENTOS_BASE_ID');
  process.exit(1);
}

async function fetchAllRecords() {
  const allRecords = [];
  let offset = null;

  do {
    const url = new URL(`${API_URL}/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`);
    url.searchParams.set('sort[0][field]', 'Fecha evento');
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

function transformRecord(record) {
  const f = record.fields;
  return {
    id: record.id,
    nombre: f['Name'] || '',
    fecha: f['Fecha evento'] || '',
    hora: f['Hora (hh:mm)'] || '',
    dondePublicar: f['Dónde publicar'] || [],
    descripcion: f['Descripción o info extra'] || '',
    status: f['Status'] || '',
  };
}

async function main() {
  console.log('Fetching eventos from Airtable...');

  const records = await fetchAllRecords();
  const eventos = records
    .map(transformRecord)
    .filter(e => e.nombre && e.dondePublicar.includes('Web'));

  const dataDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const output = {
    lastUpdated: new Date().toISOString(),
    count: eventos.length,
    eventos,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Wrote ${eventos.length} events to ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error('Failed to fetch data:', err.message);
  process.exit(1);
});
