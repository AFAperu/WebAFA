#!/usr/bin/env node
/**
 * Fetches today's events from Airtable where "Dónde publicar" includes
 * "Email socios" or "Email socios y no socios", fetches contacts from the
 * "Socios" table, and sends an email via Gmail.
 *
 * Logic:
 *   - "Email socios" → only contacts where "Estado de membresía" = "Socio"
 *   - "Email socios y no socios" → all contacts in the table
 *
 * Environment variables:
 *   AIRTABLE_TOKEN            — Personal Access Token
 *   AIRTABLE_EVENTOS_BASE_ID  — Base ID (same base for Eventos and Socios)
 *   GMAIL_USER                — Gmail address (afaceipperu@gmail.com)
 *   GMAIL_APP_PASSWORD        — Gmail App Password (16 chars)
 */

import nodemailer from 'nodemailer';
import { marked } from 'marked';

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_EVENTOS_BASE_ID;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;

const EVENTOS_TABLE = 'Eventos colegio Perú';
const SOCIOS_TABLE = 'Socios';
const AIRTABLE_API = 'https://api.airtable.com/v0';

if (!TOKEN || !BASE_ID || !GMAIL_USER || !GMAIL_PASS) {
  console.error('Missing required env vars. Need: AIRTABLE_TOKEN, AIRTABLE_EVENTOS_BASE_ID, GMAIL_USER, GMAIL_APP_PASSWORD');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS,
  },
});

/**
 * Get today's date in YYYY-MM-DD format (Madrid timezone)
 */
function getTodayMadrid() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
}

/**
 * Fetch all records from an Airtable table with optional filter formula
 */
async function fetchAirtableRecords(tableName, filterFormula) {
  const allRecords = [];
  let offset = null;

  do {
    const url = new URL(`${AIRTABLE_API}/${BASE_ID}/${encodeURIComponent(tableName)}`);
    if (filterFormula) url.searchParams.set('filterByFormula', filterFormula);
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
 * Fetch today's events marked for email
 */
async function fetchEmailEvents() {
  const today = getTodayMadrid();

  const formula = `AND(
    OR(
      FIND("Email socios", ARRAYJOIN({Dónde publicar}, ",")),
      FIND("Email socios y no socios", ARRAYJOIN({Dónde publicar}, ","))
    ),
    IS_SAME({Fecha comunicación}, "${today}", "day")
  )`;

  return fetchAirtableRecords(EVENTOS_TABLE, formula);
}

/**
 * Fetch contacts from Socios table
 * @param {boolean} sociosOnly - if true, only fetch contacts with "Estado de membresía" = "Socio"
 */
async function fetchContacts(sociosOnly) {
  const formula = sociosOnly ? `{Estado de membresía} = "Socio"` : '';
  const records = await fetchAirtableRecords(SOCIOS_TABLE, formula);

  const emails = new Set();
  for (const record of records) {
    const f = record.fields;
    if (f['Email 1']) emails.add(f['Email 1'].trim().toLowerCase());
    if (f['Email 2']) emails.add(f['Email 2'].trim().toLowerCase());
  }

  return [...emails];
}

/**
 * Determine the audience for an event based on "Dónde publicar"
 */
function getAudience(dondePublicar) {
  if (dondePublicar.includes('Email socios y no socios')) {
    return 'all';
  }
  if (dondePublicar.includes('Email socios')) {
    return 'socios';
  }
  return null;
}

/**
 * Convert Markdown text to a styled HTML email body
 */
function markdownToHtmlEmail(markdownText) {
  const htmlContent = marked.parse(markdownText);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    h1, h2, h3 { color: #2c3e50; }
    a { color: #3498db; }
    ul, ol { padding-left: 20px; }
    p { margin: 0.8em 0; }
    blockquote { border-left: 4px solid #3498db; margin: 1em 0; padding: 0.5em 1em; background: #f8f9fa; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    pre { background: #f4f4f4; padding: 12px; border-radius: 6px; overflow-x: auto; }
    hr { border: none; border-top: 1px solid #eee; margin: 1.5em 0; }
  </style>
</head>
<body>
  ${htmlContent}
  <hr>
  <p style="font-size: 0.85em; color: #888;">AFA CEIP Perú</p>
</body>
</html>`;
}

/**
 * Send email to a list of recipients using BCC (in batches of 90 to stay under Gmail's limit)
 */
async function sendEmail(subject, textBody, recipients, imageAttachments) {
  const BATCH_SIZE = 90;
  const batches = [];

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    batches.push(recipients.slice(i, i + BATCH_SIZE));
  }

  console.log(`  Sending to ${recipients.length} addresses in ${batches.length} batch(es)...`);

  const htmlBody = markdownToHtmlEmail(textBody);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const mailOptions = {
      from: `AFA Perú <${GMAIL_USER}>`,
      bcc: batch.join(', '),
      subject,
      text: textBody,
      html: htmlBody,
      attachments: imageAttachments,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`  Batch ${i + 1}/${batches.length} sent (${batch.length} recipients). Message ID: ${info.messageId}`);

    // Delay between batches to avoid rate limiting
    if (i < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

async function main() {
  console.log(`Checking events for today (${getTodayMadrid()}) marked for email...`);

  const records = await fetchEmailEvents();

  if (records.length === 0) {
    console.log('No events to email today. Done.');
    return;
  }

  console.log(`Found ${records.length} event(s) to email.`);

  for (const record of records) {
    const fields = record.fields;
    const texto = (fields['Texto para redes'] || '').trim();
    const nombre = fields['Name'] || 'Evento AFA Perú';
    const dondePublicar = fields['Dónde publicar'] || [];
    const imagenes = fields['Imagen para redes'] || [];

    if (!texto) {
      console.log(`Skipping "${nombre}" — no text content.`);
      continue;
    }

    const audience = getAudience(dondePublicar);
    if (!audience) continue;

    const sociosOnly = audience === 'socios';
    console.log(`Sending "${nombre}" to ${sociosOnly ? 'socios only' : 'all contacts'}...`);

    const recipients = await fetchContacts(sociosOnly);

    if (recipients.length === 0) {
      console.log(`  No email addresses found. Skipping.`);
      continue;
    }

    // Prepare image attachments (if any)
    const attachments = [];
    for (const img of imagenes) {
      attachments.push({
        filename: img.filename,
        path: img.url,
      });
    }

    await sendEmail(nombre, texto, recipients, attachments);

    // Delay between emails if multiple events
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
