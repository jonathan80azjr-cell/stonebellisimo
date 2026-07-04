import { createHash, createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import 'dotenv/config';

const DEFAULT_INPUT = 'STONE BELLISIMO WEBSITE EMAILS - Sheet1.csv';
const DEFAULT_OUTPUT = '.wrangler/imports/stonebellisimo-leads-import.sql';
const DEFAULT_FEEDBACK_DELAY_DAYS = 7;
const DEFAULT_TOKEN_TTL_DAYS = 90;

const FIELD_LIMITS = {
  firstName: 80,
  lastName: 80,
  email: 254,
  phone: 30,
  projectType: 120,
  material: 80,
  source: 80,
  message: 1000
};

function readArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function parsePositiveInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function normalizeText(value, maxLength, { preserveLines = false } = {}) {
  if (typeof value !== 'string') return '';

  const controlChars = preserveLines ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
  return value
    .replace(controlChars, ' ')
    .replace(preserveLines ? /[ \t]+/g : /\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((value) => value.trim()));
}

function csvObjects(rows) {
  const headers = rows[0]?.map((header) => header.trim()) || [];
  return rows.slice(1).map((cells) => Object.fromEntries(
    headers.map((header, index) => [header, cells[index] || ''])
  ));
}

function parseDateSent(value) {
  const normalized = normalizeText(value, 32);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid Date Sent value: ${value}`);
  }
  return new Date(`${normalized}T12:00:00.000Z`);
}

function sha256Hex(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function createFeedbackTokenHash(leadId, expiresAt, secret) {
  const expiresEpoch = Math.floor(new Date(expiresAt).getTime() / 1000);
  const data = `v1.${leadId}.${expiresEpoch}`;
  const signature = createHmac('sha256', secret).update(data).digest('base64url');
  return sha256Hex(`${data}.${signature}`);
}

function toLead(row) {
  const submittedAtDate = parseDateSent(row['Date Sent']);
  const submittedAt = submittedAtDate.toISOString();
  const delayDays = parsePositiveInteger(
    process.env.FEEDBACK_DELAY_DAYS,
    DEFAULT_FEEDBACK_DELAY_DAYS,
    1,
    30
  );
  const tokenTtlDays = parsePositiveInteger(
    process.env.FEEDBACK_TOKEN_TTL_DAYS,
    DEFAULT_TOKEN_TTL_DAYS,
    7,
    365
  );
  const idSeed = [
    row['First Name'],
    row['Last Name'],
    row.Email,
    row.Phone,
    row['Project Type'],
    row.Material,
    row.Message,
    row['Date Sent']
  ].join('\x1f');
  const id = `lead_csv_${sha256Hex(idSeed).slice(0, 32)}`;
  const firstName = normalizeText(row['First Name'], FIELD_LIMITS.firstName);
  const lastName = normalizeText(row['Last Name'], FIELD_LIMITS.lastName);
  const execution = normalizeText(row.Execution, 30);
  const replyTokenExpiresAt = addDays(submittedAtDate, tokenTtlDays).toISOString();

  return {
    id,
    firstName,
    lastName,
    customerName: `${firstName} ${lastName}`.trim(),
    email: normalizeText(row.Email, FIELD_LIMITS.email).toLowerCase(),
    phone: normalizeText(row.Phone, FIELD_LIMITS.phone),
    projectType: normalizeText(row['Project Type'], FIELD_LIMITS.projectType) || 'Not specified',
    material: normalizeText(row.Material, FIELD_LIMITS.material) || 'Not specified',
    source: normalizeText(`Imported Website Email${execution ? ` (${execution})` : ''}`, FIELD_LIMITS.source),
    message: normalizeText(row.Message, FIELD_LIMITS.message, { preserveLines: true }),
    submittedAt,
    immediateEmailSentAt: submittedAt,
    feedbackEmailDueAt: addDays(submittedAtDate, delayDays).toISOString(),
    feedbackStatus: 'pending',
    feedbackEmailAttemptCount: 0,
    replyTokenExpiresAt,
    createdAt: submittedAt,
    updatedAt: submittedAt,
    importExecution: execution
  };
}

function validateLead(lead) {
  for (const field of ['firstName', 'lastName', 'email', 'phone']) {
    if (!lead[field]) throw new Error(`Imported lead ${lead.id} is missing ${field}.`);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
    throw new Error(`Imported lead ${lead.id} has an invalid email address.`);
  }
}

function leadInsertSql(lead, feedbackTokenSecret) {
  const replyTokenHash = createFeedbackTokenHash(lead.id, lead.replyTokenExpiresAt, feedbackTokenSecret);
  const values = [
    lead.id,
    lead.firstName,
    lead.lastName,
    lead.customerName,
    lead.email,
    lead.phone,
    lead.projectType,
    lead.material,
    lead.source,
    lead.message,
    lead.submittedAt,
    lead.immediateEmailSentAt,
    lead.feedbackEmailDueAt,
    null,
    null,
    lead.feedbackStatus,
    lead.feedbackEmailAttemptCount,
    null,
    null,
    null,
    null,
    null,
    replyTokenHash,
    lead.replyTokenExpiresAt,
    null,
    'csv-import',
    lead.createdAt,
    lead.updatedAt
  ].map(sqlString).join(', ');

  return `INSERT INTO leads (
  id, firstName, lastName, customerName, email, phone, projectType, material, source, message,
  submittedAt, immediateEmailSentAt, feedbackEmailDueAt, feedbackEmailSentAt, feedbackEmailClaimedAt,
  feedbackStatus, feedbackEmailAttemptCount, feedbackEmailLastError, rating, feedbackComment,
  feedbackReceivedAt, feedbackSource, replyTokenHash, replyTokenExpiresAt, ipHash, userAgent,
  createdAt, updatedAt
) VALUES (${values})
ON CONFLICT(id) DO UPDATE SET
  firstName = excluded.firstName,
  lastName = excluded.lastName,
  customerName = excluded.customerName,
  email = excluded.email,
  phone = excluded.phone,
  projectType = excluded.projectType,
  material = excluded.material,
  source = excluded.source,
  message = excluded.message,
  submittedAt = excluded.submittedAt,
  immediateEmailSentAt = COALESCE(leads.immediateEmailSentAt, excluded.immediateEmailSentAt),
  feedbackEmailDueAt = excluded.feedbackEmailDueAt,
  replyTokenHash = excluded.replyTokenHash,
  replyTokenExpiresAt = excluded.replyTokenExpiresAt,
  updatedAt = excluded.updatedAt;`;
}

function emailEventInsertSql(lead) {
  const eventId = `email_event_import_${sha256Hex(lead.id).slice(0, 32)}`;
  const payloadJson = JSON.stringify({
    source: 'csv_import',
    execution: lead.importExecution || null
  });
  const values = [
    eventId,
    lead.id,
    'imported_confirmation',
    lead.email,
    'Imported website email record',
    'sent',
    null,
    null,
    null,
    payloadJson,
    lead.submittedAt
  ].map(sqlString).join(', ');

  return `INSERT INTO email_events (
  id, leadId, eventType, recipient, subject, status, messageStream, postmarkMessageId, error, payloadJson, createdAt
) VALUES (${values})
ON CONFLICT(id) DO UPDATE SET
  leadId = excluded.leadId,
  recipient = excluded.recipient,
  status = excluded.status,
  payloadJson = excluded.payloadJson,
  createdAt = excluded.createdAt;`;
}

function main() {
  const input = readArg('input', DEFAULT_INPUT);
  const output = readArg('output', DEFAULT_OUTPUT);
  const feedbackTokenSecret = process.env.FEEDBACK_TOKEN_SECRET;

  if (!feedbackTokenSecret) {
    throw new Error('FEEDBACK_TOKEN_SECRET is required to generate dashboard-compatible imported leads.');
  }

  const rows = csvObjects(parseCsv(readFileSync(input, 'utf8')));
  const leads = rows.map(toLead);
  leads.forEach(validateLead);

  const ids = new Set();
  for (const lead of leads) {
    if (ids.has(lead.id)) throw new Error(`Duplicate deterministic import id: ${lead.id}`);
    ids.add(lead.id);
  }

  const sql = [
    '-- Generated by scripts/generate-csv-lead-import-sql.mjs',
    '-- Customer data import artifact; keep this file out of git.',
    ...leads.flatMap((lead) => [
      leadInsertSql(lead, feedbackTokenSecret),
      emailEventInsertSql(lead)
    ]),
    ''
  ].join('\n\n');

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, sql);
  console.log(`Wrote ${leads.length} imported leads to ${output}`);
}

main();
