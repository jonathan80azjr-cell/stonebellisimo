import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { syncSearchConsole } from '../src/search-console.mjs';

function readArg(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : '';
}

function iso(date) { return date.toISOString().slice(0, 10); }

const projectId = readArg('project') || process.env.SB_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
const siteUrl = readArg('site') || process.env.SEARCH_CONSOLE_SITE_URL || 'sc-domain:stonebellisimollc.com';
const endDate = readArg('end') || iso(new Date(Date.now() - 2 * 86400000));
const startDate = readArg('start') || iso(new Date(Date.now() - 16 * 30 * 86400000));
if (!projectId) throw new Error('Usage: npm run firebase:search:backfill -- --project PROJECT_ID [--start YYYY-MM-DD] [--end YYYY-MM-DD]');

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
for (let cursor = new Date(`${startDate}T00:00:00Z`); cursor <= new Date(`${endDate}T00:00:00Z`);) {
  const chunkStart = iso(cursor);
  const chunkEndDate = new Date(Math.min(cursor.getTime() + 29 * 86400000, new Date(`${endDate}T00:00:00Z`).getTime()));
  const chunkEnd = iso(chunkEndDate);
  const result = await syncSearchConsole({ db, siteUrl, startDate: chunkStart, endDate: chunkEnd });
  console.info(`Imported ${chunkStart} through ${chunkEnd}: ${result.totals} daily rows, ${result.queries} query/page rows.`);
  cursor = new Date(chunkEndDate.getTime() + 86400000);
}
