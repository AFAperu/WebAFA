#!/usr/bin/env node
/**
 * Fetches the "Necesitamos" table from Airtable and writes it to data/necesitamos.json.
 *
 * The table lives in the same base as extraescolares, so it reuses AIRTABLE_BASE_ID.
 *
 * Usage:
 *   AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=app... node scripts/fetch-necesitamos.js
 *
 * Environment variables:
 *   AIRTABLE_TOKEN               — Personal Access Token (read-only scope)
 *   AIRTABLE_BASE_ID             — Base ID (starts with "app...")
 *   AIRTABLE_NECESITAMOS_TABLE   — Optional table name override (default "Necesitamos")
 *
 * Airtable table columns:
 *   Descripción — Qué necesitamos, en un párrafo corto
 *   Contacto    — Persona responsable
 *   Email       — Destinatario del botón de contacto
 *   Publicado   — "Sí" / "No". Solo las filas con "Sí" llegan a la web.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = process.env.AIRTABLE_NECESITAMOS_TABLE || 'Necesitamos';
const API_URL = 'https://api.airtable.com/v0';
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'necesitamos.json');

if (!TOKEN || !BASE_ID) {
  console.error('Missing required env vars: AIRTABLE_TOKEN and AIRTABLE_BASE_ID');
  process.exit(1);
}

async function fetchAllRecords() {
  const allRecords = [];
  let offset = null;

  do {
    const url = new URL(`${API_URL}/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`);
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

/** Reads the first field present from a list of possible column labels. */
function field(fields, names) {
  for (const name of names) {
    const value = fields[name];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

/**
 * True only for an explicit affirmative. An empty "Publicado" cell counts as
 * not published, so nothing goes live by accident. Booleans are accepted too,
 * in case the column is ever switched to a checkbox.
 */
function isPublicado(value) {
  if (typeof value === 'boolean') return value;
  return /^s[ií]$/i.test(String(value).trim());
}

function transformRecord(record) {
  const f = record.fields;
  return {
    id: record.id,
    descripcion: String(field(f, ['Descripción', 'Descripcion'])).trim(),
    contacto: String(field(f, ['Contacto'])).trim(),
    email: String(field(f, ['Email', 'Correo'])).trim(),
    publicado: isPublicado(field(f, ['Publicado', 'Publicar'])),
  };
}

async function main() {
  console.log(`Fetching "${TABLE_NAME}" from Airtable...`);

  const records = await fetchAllRecords();
  // Keep Airtable's own row order. Skip empty rows and anything not marked
  // "Publicado = Sí", so unpublished drafts never reach the public repo.
  const publicadas = records
    .map(transformRecord)
    .filter(n => n.descripcion && n.publicado);

  // "publicado" is an editorial flag, not page content: drop it from the output.
  const necesidades = publicadas.map(({ publicado, ...rest }) => rest);

  console.log(`${records.length} rows in Airtable, ${necesidades.length} published`);

  const dataDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const output = {
    lastUpdated: new Date().toISOString(),
    count: necesidades.length,
    necesidades,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Wrote ${necesidades.length} necesidades to ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error('Failed to fetch data:', err.message);
  process.exit(1);
});
