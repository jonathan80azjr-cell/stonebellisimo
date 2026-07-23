// Copies production Firestore data into the local emulator so the admin
// dashboard, analytics rollups, and lead automation can be exercised against
// realistic volumes and shapes.
//
// Customer records are pseudonymised by default. Real names, emails, and phone
// numbers never reach the snapshot on disk unless --raw is passed, because the
// snapshot lives in the working tree (.data/ is gitignored, but a stray copy or
// backup should still not leak customer PII).
//
// Usage: npm run firebase:pull -- [options]
//   --project ID           production project (default: .firebaserc default)
//   --collections a,b      restrict to these collections
//   --limit N              cap documents pulled per collection
//   --snapshot PATH        snapshot file (default: .data/prod-snapshot.json)
//   --export-only          read production, write the snapshot, stop
//   --import-only          load an existing snapshot into the emulator
//   --raw                  keep real customer PII (avoid unless debugging it)
//   --keep                 merge into the emulator instead of clearing first
//   --subcollections       walk subcollections (this schema is flat; costs 1 read/doc)
//   --no-auth              skip seeding emulator administrator accounts
//   --emulator HOST        Firestore emulator (default: 127.0.0.1:8080)
//   --auth-emulator HOST   Auth emulator (default: 127.0.0.1:9099)
//   --emulator-project ID  emulator project (default: demo-stonebellisimo)

import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { DocumentReference, GeoPoint, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { ADMIN_EMAILS, adminAllowlist } from '../src/admin-accounts.mjs';

const DEFAULT_COLLECTIONS = [
  'leads',
  'feedback',
  'email_events',
  'postmark_inbound_events',
  'postmark_delivery_events',
  'analytics_events',
  'analytics_aggregations',
  'analytics_daily',
  'analytics_cta_daily',
  'analytics_dimension_daily',
  'analytics_session_daily',
  'analytics_unique_daily',
  'search_console_daily',
  'search_console_queries',
  'migration_checkpoints'
];

// Free-text fields carry names that no regex can find, so they are replaced
// wholesale rather than scrubbed.
const REDACTED_TEXT = {
  leads: ['message', 'userAgent'],
  feedback: ['comment']
};

// Opaque digests that identify a person across submissions. Rehashed with the
// local salt so rate-limit and reply-token logic still sees stable values.
const REHASHED = {
  leads: ['ipHash', 'replyTokenHash']
};

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Deliberately narrow: a loose digit run also matches the numeric halves of a
// UUID, which would rewrite message IDs and break lead/event joins.
const PHONE_PATTERN = /(?<![A-Za-z0-9])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?![A-Za-z0-9])/g;
// UUIDs and long hex digests are masked out before scrubbing so no pattern can
// chew through an identifier.
const OPAQUE_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}/gi;
// Identifiers and timestamps never hold customer PII, and rewriting one would
// silently desync a document from the collections that reference it.
const OPAQUE_FIELD = /(^id$|Id$|Hash$|Token$|At$|^date$|^occurredAt$)/;
const FIRST_NAMES = ['Avery', 'Blake', 'Casey', 'Devon', 'Emerson', 'Finley', 'Harper', 'Jordan', 'Kendall', 'Logan', 'Morgan', 'Parker', 'Quinn', 'Reese', 'Sawyer', 'Tatum'];
const LAST_NAMES = ['Alvarez', 'Bennett', 'Carver', 'Delgado', 'Ellison', 'Fowler', 'Garrison', 'Holloway', 'Iverson', 'Jennings', 'Kirby', 'Lowry', 'Merrick', 'Norwood', 'Ortega', 'Prescott'];

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const [key, inline] = argv[index].slice(2).split('=', 2);
    output[key] = inline ?? (String(argv[index + 1] ?? '--').startsWith('--') ? true : argv[++index]);
  }
  return output;
}

function defaultProjectId() {
  const fromEnv = process.env.SB_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  if (fromEnv) return fromEnv.trim();
  const path = resolve('.firebaserc');
  if (!existsSync(path)) return '';
  return String(JSON.parse(readFileSync(path, 'utf8'))?.projects?.default || '').trim();
}

// A persisted salt keeps pseudonyms stable across pulls, so a lead that looked
// like "Avery Bennett" yesterday still does today and local test expectations
// built on the snapshot keep passing.
function loadSalt(snapshotPath) {
  const path = resolve(dirname(snapshotPath), '.pseudonym-salt');
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  const salt = randomBytes(32).toString('hex');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${salt}\n`, { mode: 0o600 });
  return salt;
}

function digest(salt, kind, value) {
  return createHmac('sha256', salt).update(`${kind}:${String(value).toLowerCase()}`).digest('hex');
}

function pick(list, hex) {
  return list[parseInt(hex.slice(0, 8), 16) % list.length];
}

function pseudonym(salt, kind, value) {
  const hex = digest(salt, kind, value);
  if (kind === 'first') return pick(FIRST_NAMES, hex);
  if (kind === 'last') return pick(LAST_NAMES, hex);
  if (kind === 'email') return `${pick(FIRST_NAMES, hex).toLowerCase()}.${pick(LAST_NAMES, hex.slice(8)).toLowerCase()}.${hex.slice(0, 4)}@example.test`;
  // 555-01xx is the reserved fictional range, so a stray dial reaches nobody.
  if (kind === 'phone') return `+1555555${String(parseInt(hex.slice(0, 6), 16) % 10000).padStart(4, '0')}`;
  return hex;
}

function encode(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Timestamp) return { __type: 'timestamp', value: value.toDate().toISOString() };
  if (value instanceof GeoPoint) return { __type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  if (value instanceof DocumentReference) return { __type: 'reference', path: value.path };
  if (Buffer.isBuffer(value)) return { __type: 'bytes', value: value.toString('base64') };
  // JSON.stringify turns these into null, which would silently corrupt the round trip.
  if (typeof value === 'number' && !Number.isFinite(value)) return { __type: 'number', value: String(value) };
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  return value;
}

function decode(value, db) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => decode(item, db));
  switch (value.__type) {
    case 'timestamp': return Timestamp.fromDate(new Date(value.value));
    case 'geopoint': return new GeoPoint(value.latitude, value.longitude);
    case 'reference': return db.doc(value.path);
    case 'bytes': return Buffer.from(value.value, 'base64');
    case 'number': return Number(value.value);
    default: return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item, db)]));
  }
}

// Emails and phone numbers are also embedded in subjects and raw webhook JSON,
// so every string is swept rather than only the known PII columns.
function scrubString(text, salt) {
  const opaque = [];
  const masked = text.replace(OPAQUE_PATTERN, match => `\u0000${opaque.push(match) - 1}\u0000`);
  return masked
    .replace(EMAIL_PATTERN, match => pseudonym(salt, 'email', match))
    .replace(PHONE_PATTERN, match => pseudonym(salt, 'phone', match.replace(/\D/g, '').slice(-10)))
    .replace(/\u0000(\d+)\u0000/g, (_, index) => opaque[Number(index)]);
}

function scrub(value, salt, key = '') {
  if (typeof value === 'string') return OPAQUE_FIELD.test(key) ? value : scrubString(value, salt);
  if (Array.isArray(value)) return value.map(item => scrub(item, salt, key));
  if (value && typeof value === 'object' && !value.__type) {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, scrub(item, salt, name)]));
  }
  return value;
}

function redactDocument(collection, data, salt, names) {
  const output = scrub(data, salt);
  for (const field of REDACTED_TEXT[collection] || []) {
    if (typeof output[field] === 'string' && output[field]) output[field] = `[redacted ${field}, ${output[field].length} chars]`;
  }
  for (const field of REHASHED[collection] || []) {
    if (typeof output[field] === 'string' && output[field]) output[field] = digest(salt, field, output[field]);
  }
  if (collection === 'leads') {
    const first = output.firstName ? pseudonym(salt, 'first', names.first || output.firstName) : output.firstName;
    const last = output.lastName ? pseudonym(salt, 'last', names.last || output.lastName) : output.lastName;
    if (output.firstName) output.firstName = first;
    if (output.lastName) output.lastName = last;
    if (output.customerName) output.customerName = `${first || 'Avery'} ${last || 'Bennett'}`.trim();
  }
  return output;
}

async function readCollection(reference, options) {
  const query = options.limit ? reference.limit(options.limit) : reference;
  const snapshot = await query.get();
  const documents = [];
  for (const document of snapshot.docs) {
    const record = { id: document.id, data: encode(document.data()) };
    if (options.subcollections) {
      const children = await document.ref.listCollections();
      if (children.length) {
        record.subcollections = {};
        for (const child of children) record.subcollections[child.id] = await readCollection(child, options);
      }
    }
    documents.push(record);
  }
  return documents;
}

async function writeCollection(db, reference, documents, keep) {
  if (!keep) await db.recursiveDelete(reference);
  for (let index = 0; index < documents.length; index += 400) {
    const batch = db.batch();
    for (const record of documents.slice(index, index + 400)) {
      batch.set(reference.doc(record.id), decode(record.data, db), { merge: keep });
    }
    await batch.commit();
  }
  for (const record of documents) {
    for (const [name, children] of Object.entries(record.subcollections || {})) {
      await writeCollection(db, reference.doc(record.id).collection(name), children, keep);
    }
  }
}

async function exportSnapshot(args, salt, redact) {
  const projectId = String(args.project || defaultProjectId());
  if (!projectId) throw new Error('Pass --project PROJECT_ID; no default was found in .firebaserc.');
  if (projectId.startsWith('demo-')) throw new Error(`"${projectId}" is an emulator project. Pass the real --project to export from production.`);

  // firebase-admin honours these globally. They must be gone before the
  // production client is built or the "export" silently reads the emulator.
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

  const app = initializeApp({ credential: applicationDefault(), projectId }, 'production');
  const db = getFirestore(app);
  const requested = args.collections ? String(args.collections).split(',').map(name => name.trim()).filter(Boolean) : null;
  const available = (await db.listCollections()).map(reference => reference.id);
  const names = (requested || DEFAULT_COLLECTIONS).filter(name => available.includes(name));

  for (const name of requested || []) {
    if (!available.includes(name)) console.warn(`! ${name} does not exist in ${projectId}; skipping.`);
  }

  const options = { limit: Number(args.limit) || 0, subcollections: Boolean(args.subcollections) };
  const collections = {};
  for (const name of names) {
    collections[name] = await readCollection(db.collection(name), options);
    console.info(`↓ ${name}: ${collections[name].length} document(s)`);
  }

  if (redact) {
    for (const [name, documents] of Object.entries(collections)) {
      for (const record of documents) record.data = redactDocument(name, record.data, salt, {});
    }
    console.info('· Customer names, emails, and phone numbers replaced with stable pseudonyms.');
  } else {
    console.warn('! --raw: real customer PII is being written to disk. Delete the snapshot when finished.');
  }

  await deleteApp(app);
  return {
    meta: {
      sourceProject: projectId,
      exportedAt: new Date().toISOString(),
      redacted: redact,
      limit: options.limit || null,
      counts: Object.fromEntries(Object.entries(collections).map(([name, documents]) => [name, documents.length]))
    },
    collections
  };
}

async function importSnapshot(snapshot, args) {
  const projectId = String(args['emulator-project'] || 'demo-stonebellisimo');
  const host = String(args.emulator || process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080');
  const authHost = String(args['auth-emulator'] || process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099');
  const keep = Boolean(args.keep);

  const app = initializeApp({ projectId }, 'emulator');
  const db = getFirestore(app);
  // Set explicitly rather than through the environment so this can never be
  // pointed at production by a stray shell variable.
  db.settings({ host, ssl: false, ignoreUndefinedProperties: true });

  try {
    await db.listCollections();
  } catch (error) {
    throw new Error(`Cannot reach the Firestore emulator at ${host}. Start it with "npm run dev" first. (${error?.message || error})`);
  }

  for (const [name, documents] of Object.entries(snapshot.collections)) {
    await writeCollection(db, db.collection(name), documents, keep);
    console.info(`↑ ${name}: ${documents.length} document(s)`);
  }

  if (!args['no-auth']) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = authHost;
    const auth = getAuth(app);
    const password = process.env.FIREBASE_ADMIN_INITIAL_PASSWORD || 'stone-bellisimo-local';
    try {
      for (const email of adminAllowlist(process.env)) {
        const user = await auth.getUserByEmail(email).catch(error => {
          if (error?.code !== 'auth/user-not-found') throw error;
          return auth.createUser({ email, password, emailVerified: true });
        });
        await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), admin: true });
      }
      console.info(`⚿ ${adminAllowlist(process.env).length} administrator account(s) ready. Password: ${password}`);
    } catch (error) {
      console.warn(`! Auth emulator seeding skipped (${error?.message || error}). Pass --no-auth to silence this.`);
    }
  }

  await deleteApp(app);
}

const args = parseArgs(process.argv.slice(2));
const snapshotPath = resolve(String(args.snapshot || '.data/prod-snapshot.json'));
const salt = loadSalt(snapshotPath);
const redact = !args.raw;

let snapshot;
if (args['import-only']) {
  if (!existsSync(snapshotPath)) throw new Error(`No snapshot at ${snapshotPath}. Run without --import-only first.`);
  snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  console.info(`Loaded snapshot from ${snapshot.meta.sourceProject} taken ${snapshot.meta.exportedAt}${snapshot.meta.redacted ? '' : ' (raw PII)'}.`);
} else {
  snapshot = await exportSnapshot(args, salt, redact);
  mkdirSync(dirname(snapshotPath), { recursive: true });
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  console.info(`Snapshot written to ${snapshotPath}`);
}

if (args['export-only']) {
  console.info('Export complete. Re-run with --import-only once the emulator is running.');
} else {
  await importSnapshot(snapshot, args);
  console.info(`\nEmulator loaded. Sign in at http://127.0.0.1:5002/admin/ as ${ADMIN_EMAILS[0]}.`);
}
