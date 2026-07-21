import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const TABLES = [
  { table: 'leads', collection: 'leads', checkpoint: 'updatedAt' },
  { table: 'feedback', collection: 'feedback', checkpoint: 'createdAt' },
  { table: 'email_events', collection: 'email_events', checkpoint: 'createdAt' },
  { table: 'postmark_inbound_events', collection: 'postmark_inbound_events', checkpoint: 'createdAt' },
  { table: 'postmark_delivery_events', collection: 'postmark_delivery_events', checkpoint: 'createdAt' }
];

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const [key, inline] = argv[index].slice(2).split('=', 2);
    output[key] = inline ?? (argv[index + 1]?.startsWith('--') ? true : argv[++index]);
  }
  return output;
}

function sqlQuote(value) { return String(value || '').replaceAll("'", "''"); }

function parseWranglerJson(output) {
  const start = output.indexOf('[');
  if (start < 0) throw new Error('Wrangler did not return JSON.');
  const payload = JSON.parse(output.slice(start));
  const operation = Array.isArray(payload) ? payload[0] : payload;
  if (!operation?.success) throw new Error(operation?.error || 'D1 query failed.');
  return operation.results || [];
}

function d1Query(database, sql, local) {
  const executable = resolve('node_modules/.bin/wrangler');
  const result = spawnSync(executable, ['d1', 'execute', database, local ? '--local' : '--remote', '--command', sql, '--json'], {
    cwd: process.cwd(), encoding: 'utf8', maxBuffer: 50 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Wrangler exited ${result.status}.`);
  return parseWranglerJson(result.stdout);
}

function sourceFromFile(path) {
  const body = JSON.parse(readFileSync(path, 'utf8'));
  return Object.fromEntries(TABLES.map(item => [item.table, Array.isArray(body[item.table]) ? body[item.table] : []]));
}

function fullSource(database, local, checkpoints, phase) {
  return Object.fromEntries(TABLES.map(item => {
    const last = phase === 'delta' ? checkpoints[item.table] : '';
    const where = last ? ` WHERE ${item.checkpoint} > '${sqlQuote(last)}'` : '';
    return [item.table, d1Query(database, `SELECT * FROM ${item.table}${where} ORDER BY ${item.checkpoint} ASC;`, local)];
  }));
}

function latestValue(rows, field, fallback = '') {
  return rows.reduce((latest, row) => String(row[field] || '') > latest ? String(row[field]) : latest, fallback);
}

const args = parseArgs(process.argv.slice(2));
const projectId = String(args.project || process.env.SB_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '').trim();
const database = String(args.database || 'stonebellisimo-leads');
const phase = String(args.phase || 'backfill');
const dryRun = Boolean(args['dry-run']);
const local = Boolean(args.local);
const checkpointPath = resolve(String(args.checkpoint || '.data/migration-checkpoint.json'));
if (!['backfill', 'delta'].includes(phase)) throw new Error('--phase must be backfill or delta.');
if (!dryRun && !projectId) throw new Error('Pass --project PROJECT_ID unless using --dry-run.');

const checkpoint = existsSync(checkpointPath) ? JSON.parse(readFileSync(checkpointPath, 'utf8')) : { tables: {} };
if (phase === 'delta' && !Object.keys(checkpoint.tables || {}).length) throw new Error('Run the initial backfill before the delta phase.');
const source = args.input
  ? sourceFromFile(resolve(String(args.input)))
  : fullSource(database, local, checkpoint.tables || {}, phase);

console.info(`${dryRun ? 'DRY RUN' : 'MIGRATION'} · ${phase} phase`);
for (const item of TABLES) console.info(`${item.table}: ${source[item.table].length} source record(s)`);
if (dryRun) process.exit(0);

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
for (const item of TABLES) {
  const rows = source[item.table];
  for (let index = 0; index < rows.length; index += 400) {
    const batch = db.batch();
    for (const row of rows.slice(index, index + 400)) {
      if (!row.id) throw new Error(`${item.table} contains a record without an id.`);
      batch.set(db.collection(item.collection).doc(String(row.id)), row, { merge: true });
    }
    await batch.commit();
  }
  checkpoint.tables[item.table] = latestValue(rows, item.checkpoint, checkpoint.tables[item.table]);
}

checkpoint.phase = phase;
checkpoint.projectId = projectId;
checkpoint.database = database;
checkpoint.updatedAt = new Date().toISOString();
await db.collection('migration_checkpoints').doc('d1_cutover').set(checkpoint, { merge: true });
writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });

let verified = true;
for (const item of TABLES) {
  const firestoreCount = Number((await db.collection(item.collection).count().get()).data().count || 0);
  const sourceCountRows = args.input ? source[item.table] : d1Query(database, `SELECT COUNT(*) AS count FROM ${item.table};`, local);
  const sourceCount = args.input ? source[item.table].length : Number(sourceCountRows[0]?.count || 0);
  const representativeIds = source[item.table].length
    ? [source[item.table][0].id, source[item.table].at(-1).id].filter(Boolean)
    : [];
  const representative = representativeIds.length
    ? await db.getAll(...representativeIds.map(id => db.collection(item.collection).doc(String(id))))
    : [];
  const recordsPresent = representative.every(snapshot => snapshot.exists);
  const countOk = phase === 'backfill' ? firestoreCount >= sourceCount : true;
  verified = verified && recordsPresent && countOk;
  console.info(`${item.table}: D1=${sourceCount}, Firestore=${firestoreCount}, representative records=${recordsPresent ? 'verified' : 'missing'}`);
}
if (!verified) throw new Error('Migration verification failed. D1 remains authoritative; do not cut over.');
console.info(`Migration ${phase} complete. Checkpoint: ${checkpointPath}`);
console.info('Keep the D1 database read-only for at least 30 days after the final delta and production validation.');
