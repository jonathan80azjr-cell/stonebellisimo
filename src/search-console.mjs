import { createHash } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import { json, methodNotAllowed } from './lead-automation.mjs';

const SEARCH_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const DEFAULT_SITE = 'sc-domain:stonebellisimollc.com';
const BRAND_PATTERN = /stone\s*bellisimo|stonebellisimo/i;

// Health is stored per source so later importers (ad spend, call tracking) can
// share the collection without a schema change.
const HEALTH_COLLECTION = 'analytics_health';
const HEALTH_DOC = 'search_console';

// Google returns the same two statuses for the two mistakes that actually
// happen here, and neither is self-explanatory in a log line at 5am.
const REQUEST_HINTS = Object.freeze({
  401: ' The runtime credentials were rejected.',
  403: ' The Functions service account is not a user on this Search Console property.',
  404: ' The property does not exist under this exact site URL.'
});

// The scheduled import runs daily, so anything past two days means at least one
// run failed or never fired. Google itself lags ~2 days, hence the offset.
const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

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
    if (!response.ok) {
      // The status is what tells an operator whether this is a permission
      // problem they can fix or a Google outage they must wait out, so carry it
      // on the error rather than only in the message. The response body is
      // deliberately not read: it can echo the site URL and token metadata.
      const error = new Error(`Search Console request failed with ${response.status}.${REQUEST_HINTS[response.status] || ''}`);
      error.status = response.status;
      throw error;
    }
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

// Health writes never throw. A failed import must surface as its own error, not
// as a bookkeeping error that masks the original cause.
async function recordHealth(db, patch) {
  if (!db) return;
  try {
    await db.collection(HEALTH_COLLECTION).doc(HEALTH_DOC).set({
      ...patch,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    console.error(JSON.stringify({
      message: 'Search Console health write failed',
      error: error?.message || String(error)
    }));
  }
}

export async function readSearchConsoleHealth(db) {
  if (!db) return null;
  try {
    const snapshot = await db.collection(HEALTH_COLLECTION).doc(HEALTH_DOC).get();
    return snapshot.exists ? snapshot.data() : null;
  } catch (error) {
    console.error(JSON.stringify({
      message: 'Search Console health read failed',
      error: error?.message || String(error)
    }));
    return null;
  }
}

// Three states, because "not working" and "not set up yet" need different
// instructions: one is a regression, the other has never run.
export function evaluateSearchConsoleHealth(health, nowMs = Date.now()) {
  if (!health || !health.lastAttemptAt) {
    return {
      status: 'pending',
      message: 'The scheduled Search Console import has not run yet. It runs daily at 5:15 AM Eastern.'
    };
  }

  const lastSuccessMs = health.lastSuccessAt ? new Date(health.lastSuccessAt).getTime() : 0;
  if (!lastSuccessMs) {
    return {
      status: 'failed',
      message: `The Search Console import has never succeeded. Last attempt failed with ${health.lastErrorCode || 'an error'}.${REQUEST_HINTS[health.lastErrorCode] || ''}`,
      lastErrorCode: health.lastErrorCode || null,
      consecutiveFailures: Number(health.consecutiveFailures || 0)
    };
  }

  if (Number(health.consecutiveFailures || 0) > 0) {
    return {
      status: 'failed',
      message: `The last ${health.consecutiveFailures} Search Console import(s) failed with ${health.lastErrorCode || 'an error'}. Data is stale since ${health.latestDataDate || 'the last success'}.${REQUEST_HINTS[health.lastErrorCode] || ''}`,
      lastErrorCode: health.lastErrorCode || null,
      consecutiveFailures: Number(health.consecutiveFailures || 0)
    };
  }

  if (nowMs - lastSuccessMs > STALE_AFTER_MS) {
    return {
      status: 'stale',
      message: `The Search Console import last succeeded on ${health.lastSuccessAt}. A daily run appears to have been skipped.`
    };
  }

  return {
    status: 'healthy',
    message: `Search Console data is current through ${health.latestDataDate || 'the last import'}. Google publishes results about two days behind.`
  };
}

export async function syncRecentSearchConsole(db, env = {}) {
  const lagDays = Math.max(2, Math.min(7, Number(env.SEARCH_CONSOLE_LAG_DAYS) || 2));
  const end = new Date(Date.now() - lagDays * 86400000);
  const start = new Date(end.getTime() - 6 * 86400000);
  const attemptedAt = new Date().toISOString();

  try {
    const result = await syncSearchConsole({
      db,
      siteUrl: env.SEARCH_CONSOLE_SITE_URL || DEFAULT_SITE,
      startDate: isoDate(start),
      endDate: isoDate(end)
    });
    await recordHealth(db, {
      lastAttemptAt: attemptedAt,
      lastSuccessAt: result.syncedAt,
      latestDataDate: result.endDate,
      rowsWritten: result.totals + result.queries,
      lastErrorCode: null,
      consecutiveFailures: 0
    });
    return result;
  } catch (error) {
    const previous = await readSearchConsoleHealth(db);
    await recordHealth(db, {
      lastAttemptAt: attemptedAt,
      // A status code is safe to store; the raw message can carry the site URL.
      lastErrorCode: error?.status || 'error',
      consecutiveFailures: Number(previous?.consecutiveFailures || 0) + 1
    });
    throw error;
  }
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

  const [dailySnapshot, querySnapshot, comparisonDailySnapshot, comparisonQuerySnapshot, healthRecord] = await Promise.all([
    db.collection('search_console_daily').where('date', '>=', start).where('date', '<=', end).orderBy('date').get(),
    db.collection('search_console_queries').where('date', '>=', start).where('date', '<=', end).get(),
    db.collection('search_console_daily').where('date', '>=', comparison.start).where('date', '<=', comparison.end).orderBy('date').get(),
    db.collection('search_console_queries').where('date', '>=', comparison.start).where('date', '<=', comparison.end).get(),
    readSearchConsoleHealth(db)
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
    health: {
      ...evaluateSearchConsoleHealth(healthRecord),
      lastAttemptAt: healthRecord?.lastAttemptAt || null,
      lastSuccessAt: healthRecord?.lastSuccessAt || null,
      latestDataDate: healthRecord?.latestDataDate || null
    },
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
