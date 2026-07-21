import { createHash } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import { json, methodNotAllowed } from './lead-automation.mjs';

const SEARCH_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const DEFAULT_SITE = 'sc-domain:stonebellisimollc.com';
const BRAND_PATTERN = /stone\s*bellisimo|stonebellisimo/i;

function hash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 32);
}

function isoDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function validateDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

export function isBrandedQuery(query) {
  return BRAND_PATTERN.test(String(query || ''));
}

export async function syncSearchConsole({
  db,
  siteUrl = DEFAULT_SITE,
  startDate,
  endDate,
  fetchImpl = fetch,
  auth = new GoogleAuth({ scopes: [SEARCH_SCOPE] })
}) {
  if (!db) throw new Error('Firestore is not configured.');
  if (!validateDate(startDate) || !validateDate(endDate) || startDate > endDate) {
    throw new Error('A valid Search Console date range is required.');
  }

  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const accessToken = typeof token === 'string' ? token : token?.token;
  if (!accessToken) throw new Error('Could not obtain a Search Console access token.');

  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const headers = {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json'
  };

  async function query(body) {
    const response = await fetchImpl(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Search Console request failed with ${response.status}.`);
    return response.json();
  }

  const totalsBody = await query({ startDate, endDate, dimensions: ['date'], type: 'web', rowLimit: 25000 });
  const searchRows = [];
  for (let startRow = 0; ; startRow += 25000) {
    const page = await query({
      startDate,
      endDate,
      dimensions: ['date', 'query', 'page'],
      type: 'web',
      rowLimit: 25000,
      startRow
    });
    const rows = page.rows || [];
    searchRows.push(...rows);
    if (rows.length < 25000) break;
  }
  const syncedAt = new Date().toISOString();
  const writes = [];

  for (const row of totalsBody.rows || []) {
    const [date] = row.keys || [];
    if (!validateDate(date)) continue;
    writes.push({
      reference: db.collection('search_console_daily').doc(date),
      data: {
        date,
        clicks: Number(row.clicks || 0),
        impressions: Number(row.impressions || 0),
        ctr: Number(row.ctr || 0),
        position: Number(row.position || 0),
        siteUrl,
        syncedAt
      }
    });
  }

  for (const row of searchRows) {
    const [date, query, page] = row.keys || [];
    if (!validateDate(date) || !query) continue;
    const id = `${date}__${hash(`${query}|${page || ''}`)}`;
    writes.push({
      reference: db.collection('search_console_queries').doc(id),
      data: {
        date,
        query: String(query).slice(0, 500),
        page: String(page || '').slice(0, 1000),
        branded: isBrandedQuery(query),
        clicks: Number(row.clicks || 0),
        impressions: Number(row.impressions || 0),
        ctr: Number(row.ctr || 0),
        position: Number(row.position || 0),
        siteUrl,
        syncedAt
      }
    });
  }

  for (let index = 0; index < writes.length; index += 400) {
    const batch = db.batch();
    for (const write of writes.slice(index, index + 400)) batch.set(write.reference, write.data, { merge: true });
    await batch.commit();
  }

  return {
    startDate,
    endDate,
    totals: (totalsBody.rows || []).length,
    queries: searchRows.length,
    syncedAt
  };
}

export async function syncRecentSearchConsole(db, env = {}) {
  const lagDays = Math.max(2, Math.min(7, Number(env.SEARCH_CONSOLE_LAG_DAYS) || 2));
  const end = new Date(Date.now() - lagDays * 86400000);
  const start = new Date(end.getTime() - 6 * 86400000);
  return syncSearchConsole({
    db,
    siteUrl: env.SEARCH_CONSOLE_SITE_URL || DEFAULT_SITE,
    startDate: isoDate(start),
    endDate: isoDate(end)
  });
}

export async function handleAdminSearchConsole(request, db, env = {}) {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  const url = new URL(request.url);
  const end = validateDate(url.searchParams.get('end'))
    ? url.searchParams.get('end')
    : isoDate(new Date());
  const start = validateDate(url.searchParams.get('start'))
    ? url.searchParams.get('start')
    : isoDate(new Date(Date.now() - 89 * 86400000));
  if (start > end || new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`) > 366 * 86400000) {
    return json({ success: false, message: 'Choose a valid Search Console range of 367 days or fewer.' }, 400);
  }

  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  const days = Math.round((endDate - startDate) / 86400000) + 1;
  const previousEnd = new Date(startDate.getTime() - 86400000);
  const previousStart = new Date(previousEnd.getTime() - (days - 1) * 86400000);
  const comparison = { start: isoDate(previousStart), end: isoDate(previousEnd) };

  const [dailySnapshot, querySnapshot, comparisonDailySnapshot, comparisonQuerySnapshot] = await Promise.all([
    db.collection('search_console_daily').where('date', '>=', start).where('date', '<=', end).orderBy('date').get(),
    db.collection('search_console_queries').where('date', '>=', start).where('date', '<=', end).get(),
    db.collection('search_console_daily').where('date', '>=', comparison.start).where('date', '<=', comparison.end).orderBy('date').get(),
    db.collection('search_console_queries').where('date', '>=', comparison.start).where('date', '<=', comparison.end).get()
  ]);
  const daily = dailySnapshot.docs.map(document => document.data());
  const rows = querySnapshot.docs.map(document => document.data());
  const totals = summarize(daily);
  const branded = summarize(rows.filter(row => row.branded));
  const comparisonRows = comparisonQuerySnapshot.docs.map(document => document.data());
  const topQueries = groupRows(rows, 'query').slice(0, 12);
  const brandedQueries = groupRows(rows.filter(row => row.branded), 'query').slice(0, 12);
  const topPages = groupRows(rows, 'page').slice(0, 12);

  return json({
    success: true,
    configured: daily.length > 0,
    siteUrl: env.SEARCH_CONSOLE_SITE_URL || DEFAULT_SITE,
    range: { start, end },
    totals,
    branded,
    comparison: {
      range: comparison,
      totals: summarize(comparisonDailySnapshot.docs.map(document => document.data())),
      branded: summarize(comparisonRows.filter(row => row.branded))
    },
    daily,
    topQueries,
    brandedQueries,
    topPages,
    limitations: 'Search Console reports appearances and clicks for this site; anonymized or low-volume queries may be omitted.'
  });
}

function summarize(rows) {
  const result = rows.reduce((total, row) => {
    total.clicks += Number(row.clicks || 0);
    total.impressions += Number(row.impressions || 0);
    total.positionWeighted += Number(row.position || 0) * Number(row.impressions || 0);
    return total;
  }, { clicks: 0, impressions: 0, positionWeighted: 0 });
  return {
    clicks: result.clicks,
    impressions: result.impressions,
    ctr: result.impressions ? result.clicks / result.impressions : 0,
    position: result.impressions ? result.positionWeighted / result.impressions : 0
  };
}

function groupRows(rows, field) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row[field] || '(not provided)';
    const item = grouped.get(key) || { key, clicks: 0, impressions: 0, positionWeighted: 0 };
    item.clicks += Number(row.clicks || 0);
    item.impressions += Number(row.impressions || 0);
    item.positionWeighted += Number(row.position || 0) * Number(row.impressions || 0);
    grouped.set(key, item);
  }
  return [...grouped.values()]
    .map(item => ({
      key: item.key,
      clicks: item.clicks,
      impressions: item.impressions,
      ctr: item.impressions ? item.clicks / item.impressions : 0,
      position: item.impressions ? item.positionWeighted / item.impressions : 0
    }))
    .sort((left, right) => right.clicks - left.clicks || right.impressions - left.impressions);
}
