import { createHash, randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { json, methodNotAllowed, normalizeText, readJson } from './lead-automation.mjs';

const MAX_BATCH = 20;
const MAX_BODY = 96 * 1024;
const ALLOWED_EVENTS = new Set([
  'page_view',
  'cta_impression',
  'cta_click',
  'form_start',
  'form_step',
  'form_submit',
  'form_error',
  'gallery_view',
  'gallery_item_open',
  'gallery_video_play',
  'performance'
]);
const HIGH_INTENT_TYPES = new Set(['estimate', 'phone', 'sms', 'email', 'map']);
const PERFORMANCE_NAMES = new Set(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']);

function clean(value, max = 160) {
  return normalizeText(value, max);
}

function cleanPath(value) {
  const path = clean(value, 240) || '/';
  return path.startsWith('/') ? path : '/';
}

function cleanId(value, prefix = 'event') {
  const normalized = clean(value, 120).replace(/[^a-zA-Z0-9_.:-]/g, '');
  return normalized || `${prefix}_${randomUUID()}`;
}

function hash(value, length = 28) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);
}

function metricField(eventName) {
  return {
    page_view: 'pageViews',
    cta_impression: 'ctaImpressions',
    cta_click: 'ctaClicks',
    form_start: 'formStarts',
    form_step: 'formSteps',
    form_submit: 'formSubmissions',
    form_error: 'formErrors',
    gallery_view: 'galleryViews',
    gallery_item_open: 'galleryOpens',
    gallery_video_play: 'galleryVideoPlays',
    performance: 'performanceSamples'
  }[eventName];
}

export function sanitizeAttribution(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    visitorId: cleanId(source.visitorId, 'visitor'),
    sessionId: cleanId(source.sessionId, 'session'),
    referrerHost: clean(source.referrerHost, 160).toLowerCase(),
    landingPage: cleanPath(source.landingPage),
    utmSource: clean(source.utmSource, 100),
    utmMedium: clean(source.utmMedium, 100),
    utmCampaign: clean(source.utmCampaign, 120),
    utmTerm: clean(source.utmTerm, 120),
    utmContent: clean(source.utmContent, 120),
    deviceCategory: ['mobile', 'tablet', 'desktop'].includes(source.deviceCategory)
      ? source.deviceCategory
      : 'unknown'
  };
}

export function validateAnalyticsEvent(input = {}) {
  const eventName = clean(input.eventName, 40);
  if (!ALLOWED_EVENTS.has(eventName)) return { error: 'Unsupported analytics event.' };
  const suppliedId = clean(input.id, 120).replace(/[^a-zA-Z0-9_.:-]/g, '');
  if (!suppliedId) return { error: 'A client-generated analytics event ID is required.' };
  if (!clean(input.visitorId, 120) || !clean(input.sessionId, 120)) {
    return { error: 'Anonymous visitor and session IDs are required.' };
  }

  const attribution = sanitizeAttribution(input);
  const occurredAt = Number.isFinite(Number(input.occurredAt)) ? Number(input.occurredAt) : Date.now();
  if (occurredAt < Date.now() - 7 * 86400000 || occurredAt > Date.now() + 5 * 60000) {
    return { error: 'Analytics event timestamp is outside the accepted window.' };
  }

  const event = {
    id: suppliedId,
    eventName,
    occurredAt,
    pagePath: cleanPath(input.pagePath),
    pageTitle: clean(input.pageTitle, 180),
    ...attribution,
    ctaId: clean(input.ctaId, 160),
    ctaType: clean(input.ctaType, 40).toLowerCase(),
    ctaLabel: clean(input.ctaLabel, 160),
    placement: clean(input.placement, 120),
    targetLabel: clean(input.targetLabel, 120),
    galleryItem: clean(input.galleryItem, 180),
    formStep: Math.max(0, Math.min(10, Number(input.formStep) || 0)),
    result: clean(input.result, 40),
    metricName: clean(input.metricName, 12).toUpperCase(),
    metricValue: Number.isFinite(Number(input.metricValue)) ? Number(input.metricValue) : null,
    navigationType: clean(input.navigationType, 40)
  };

  if (eventName === 'performance') {
    if (!PERFORMANCE_NAMES.has(event.metricName) || event.metricValue === null || event.metricValue < 0) {
      return { error: 'Invalid performance metric.' };
    }
  }

  return { event };
}

export async function handleAnalyticsEvents(request, db) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return methodNotAllowed(['POST', 'OPTIONS']);

  const { body, error, status } = await readJson(request, MAX_BODY);
  if (error) return json({ success: false, message: error }, status);
  if (!Array.isArray(body?.events) || body.events.length < 1 || body.events.length > MAX_BATCH) {
    return json({ success: false, message: `Send between 1 and ${MAX_BATCH} events.` }, 400);
  }

  const events = [];
  for (const candidate of body.events) {
    const validated = validateAnalyticsEvent(candidate);
    if (validated.error) return json({ success: false, message: validated.error }, 400);
    events.push(validated.event);
  }

  let accepted = 0;
  for (const event of events) {
    if (await storeAnalyticsEvent(db, event)) accepted += 1;
  }
  return json({ success: true, accepted, duplicates: events.length - accepted }, 202);
}

export async function recordServerConversion(db, input = {}) {
  const validated = validateAnalyticsEvent({
    ...input,
    id: input.id || `conversion_${randomUUID()}`,
    eventName: 'form_submit',
    result: 'success',
    occurredAt: Date.now()
  });
  if (validated.error) return false;
  return storeAnalyticsEvent(db, validated.event);
}

export async function createLeadWithServerConversion(db, lead, input = {}) {
  const validated = validateAnalyticsEvent({
    ...input,
    id: input.id || `conversion_${lead.id}`,
    eventName: 'form_submit',
    result: 'success',
    occurredAt: Date.now()
  });
  if (validated.error) throw new Error(validated.error);
  const storedEvent = analyticsEventDocument(validated.event);
  const leadReference = db.collection('leads').doc(lead.id);
  const eventReference = db.collection('analytics_events').doc(validated.event.id);
  await db.runTransaction(async transaction => {
    const [leadSnapshot, eventSnapshot] = await transaction.getAll(leadReference, eventReference);
    if (leadSnapshot.exists || eventSnapshot.exists) throw new Error('Lead or conversion already exists.');
    transaction.create(leadReference, { ...lead });
    transaction.create(eventReference, storedEvent);
  });
  return true;
}

function analyticsEventDocument(event) {
  return {
    ...event,
    receivedAt: new Date().toISOString(),
    date: new Date(event.occurredAt).toISOString().slice(0, 10),
    sessionHash: hash(event.sessionId),
    visitorHash: hash(event.visitorId),
    summarized: false
  };
}

async function storeAnalyticsEvent(db, event) {
  const eventReference = db.collection('analytics_events').doc(event.id);
  const storedEvent = analyticsEventDocument(event);

  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(eventReference);
    if (snapshot.exists) return false;
    transaction.create(eventReference, storedEvent);
    return true;
  });
}

export async function aggregateAnalyticsEvent(db, eventId, eventInput) {
  const eventReference = db.collection('analytics_events').doc(eventId);
  const markerReference = db.collection('analytics_aggregations').doc(eventId);

  return db.runTransaction(async transaction => {
    const markerSnapshot = await transaction.get(markerReference);
    if (markerSnapshot.exists) return false;

    let event = eventInput;
    if (!event) {
      const eventSnapshot = await transaction.get(eventReference);
      if (!eventSnapshot.exists) return false;
      event = eventSnapshot.data();
    }

    const receivedAt = new Date().toISOString();
    const date = event.date || new Date(event.occurredAt || Date.now()).toISOString().slice(0, 10);
    const sessionHash = event.sessionHash || hash(event.sessionId);
    const visitorHash = event.visitorHash || hash(event.visitorId);
    const dailyReference = db.collection('analytics_daily').doc(date);
    const sessionReference = db.collection('analytics_unique_daily').doc(`${date}__session__${sessionHash}`);
    const visitorReference = db.collection('analytics_unique_daily').doc(`${date}__visitor__${visitorHash}`);
    const sessionFactReference = db.collection('analytics_session_daily').doc(`${date}__${sessionHash}`);
    const isCta = ['cta_impression', 'cta_click'].includes(event.eventName);
    const ctaKey = event.ctaId || `${event.ctaType}:${event.ctaLabel}:${event.placement}:${event.pagePath}`;
    const ctaHash = hash(ctaKey);
    const ctaReference = db.collection('analytics_cta_daily').doc(`${date}__${ctaHash}`);
    const ctaUniqueReference = db.collection('analytics_unique_daily')
      .doc(`${date}__cta__${event.eventName}__${ctaHash}__${sessionHash}`);
    const references = [sessionReference, visitorReference, sessionFactReference];
    if (isCta) references.push(ctaUniqueReference);
    const snapshots = await transaction.getAll(...references);
    const sessionIsNew = !snapshots[0].exists;
    const visitorIsNew = !snapshots[1].exists;
    const sessionFact = snapshots[2].exists ? snapshots[2].data() : {};
    const ctaUniqueIsNew = isCta ? !snapshots[3].exists : false;
    const isGalleryEngagement = ['gallery_view', 'gallery_item_open', 'gallery_video_play'].includes(event.eventName);
    const isHighIntent = (event.eventName === 'cta_click' && HIGH_INTENT_TYPES.has(event.ctaType)) ||
      (event.eventName === 'form_submit' && event.result === 'success');
    const eventTime = Number(event.occurredAt) || Date.now();
    const priorGalleryAt = Number(sessionFact.galleryEngagedAt) || 0;
    const priorLatestHighIntentAt = Number(sessionFact.latestHighIntentAt || sessionFact.highIntentAt) || 0;
    const galleryAt = isGalleryEngagement
      ? (priorGalleryAt ? Math.min(priorGalleryAt, eventTime) : eventTime)
      : priorGalleryAt;
    const latestHighIntentAt = isHighIntent
      ? Math.max(priorLatestHighIntentAt, eventTime)
      : priorLatestHighIntentAt;
    const gallerySessionIsNew = isGalleryEngagement && !sessionFact.galleryEngagedAt;
    // Firestore triggers can arrive out of order. Compare event timestamps so a
    // high-intent action is attributed when it happened after gallery engagement,
    // regardless of which event the trigger summarized first.
    const galleryToIntentIsNew = Boolean(galleryAt && latestHighIntentAt > galleryAt) &&
      !sessionFact.highIntentAfterGalleryAt;

    const field = metricField(event.eventName);
    const dailyUpdate = { date, updatedAt: receivedAt, events: FieldValue.increment(1) };
    if (field) dailyUpdate[field] = FieldValue.increment(1);
    if (sessionIsNew) dailyUpdate.sessions = FieldValue.increment(1);
    if (visitorIsNew) dailyUpdate.visitors = FieldValue.increment(1);
    if (isHighIntent) dailyUpdate.highIntentActions = FieldValue.increment(1);
    if (gallerySessionIsNew) dailyUpdate.gallerySessions = FieldValue.increment(1);
    if (galleryToIntentIsNew) dailyUpdate.galleryToIntentSessions = FieldValue.increment(1);
    transaction.set(dailyReference, dailyUpdate, { merge: true });
    if (sessionIsNew) transaction.create(sessionReference, { date, kind: 'session', createdAt: receivedAt });
    if (visitorIsNew) transaction.create(visitorReference, { date, kind: 'visitor', createdAt: receivedAt });

    const sessionUpdate = { date, sessionHash, updatedAt: receivedAt };
    if (isGalleryEngagement && galleryAt !== priorGalleryAt) sessionUpdate.galleryEngagedAt = galleryAt;
    if (isHighIntent && !sessionFact.highIntentAt) sessionUpdate.highIntentAt = eventTime;
    if (isHighIntent && latestHighIntentAt !== priorLatestHighIntentAt) sessionUpdate.latestHighIntentAt = latestHighIntentAt;
    if (galleryToIntentIsNew) sessionUpdate.highIntentAfterGalleryAt = latestHighIntentAt;
    transaction.set(sessionFactReference, sessionUpdate, { merge: true });

    if (isCta) {
      const ctaUpdate = {
        date,
        ctaId: event.ctaId || ctaHash,
        ctaType: event.ctaType || 'other',
        ctaLabel: event.ctaLabel || 'Untitled CTA',
        targetLabel: event.targetLabel || '',
        placement: event.placement || 'page',
        pagePath: event.pagePath,
        updatedAt: receivedAt,
        [event.eventName === 'cta_click' ? 'clicks' : 'impressions']: FieldValue.increment(1)
      };
      if (ctaUniqueIsNew) {
        ctaUpdate[event.eventName === 'cta_click' ? 'uniqueClicks' : 'uniqueImpressions'] = FieldValue.increment(1);
        transaction.create(ctaUniqueReference, { date, kind: event.eventName, createdAt: receivedAt });
      }
      transaction.set(ctaReference, ctaUpdate, { merge: true });
    }

    if (event.eventName === 'page_view') {
      addDimension(transaction, db, date, 'page', event.pagePath, event.pagePath, receivedAt);
      addDimension(transaction, db, date, 'referrer', event.referrerHost || 'Direct', event.referrerHost || 'Direct', receivedAt);
      addDimension(transaction, db, date, 'device', event.deviceCategory, event.deviceCategory, receivedAt);
      if (event.utmCampaign) addDimension(transaction, db, date, 'campaign', event.utmCampaign, event.utmCampaign, receivedAt);
    }

    transaction.create(markerReference, { eventId, date, summarizedAt: receivedAt });
    transaction.set(eventReference, { summarized: true, summarizedAt: receivedAt }, { merge: true });
    return true;
  });
}

function addDimension(transaction, db, date, dimension, key, label, receivedAt) {
  const reference = db.collection('analytics_dimension_daily').doc(`${date}__${dimension}__${hash(key)}`);
  transaction.set(reference, {
    date,
    dimension,
    key: clean(key, 240),
    label: clean(label, 240),
    count: FieldValue.increment(1),
    updatedAt: receivedAt
  }, { merge: true });
}

function parseRange(request) {
  const url = new URL(request.url);
  const endCandidate = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('end') || '')
    ? url.searchParams.get('end')
    : new Date().toISOString().slice(0, 10);
  const end = new Date(`${endCandidate}T00:00:00.000Z`);
  const startCandidate = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('start') || '')
    ? url.searchParams.get('start')
    : new Date(end.getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const start = new Date(`${startCandidate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start > end || end - start > 366 * 86400000) {
    throw new Error('Choose a valid date range of 367 days or fewer.');
  }
  return { start: startCandidate, end: endCandidate };
}

function previousRange({ start, end }) {
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  const days = Math.round((endDate - startDate) / 86400000) + 1;
  const previousEnd = new Date(startDate.getTime() - 86400000);
  const previousStart = new Date(previousEnd.getTime() - (days - 1) * 86400000);
  return { start: previousStart.toISOString().slice(0, 10), end: previousEnd.toISOString().slice(0, 10) };
}

function sumRows(rows, fields) {
  const output = Object.fromEntries(fields.map(field => [field, 0]));
  for (const row of rows) {
    for (const field of fields) output[field] += Number(row[field] || 0);
  }
  return output;
}

export async function handleAdminAnalytics(request, db) {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  try {
    const { start, end } = parseRange(request);
    const comparisonRange = previousRange({ start, end });
    const [dailySnapshot, comparisonSnapshot, ctaSnapshot, dimensionSnapshot] = await Promise.all([
      db.collection('analytics_daily').where('date', '>=', start).where('date', '<=', end).orderBy('date').get(),
      db.collection('analytics_daily').where('date', '>=', comparisonRange.start).where('date', '<=', comparisonRange.end).orderBy('date').get(),
      db.collection('analytics_cta_daily').where('date', '>=', start).where('date', '<=', end).get(),
      db.collection('analytics_dimension_daily').where('date', '>=', start).where('date', '<=', end).get()
    ]);
    const daily = dailySnapshot.docs.map(document => document.data());
    const comparisonDaily = comparisonSnapshot.docs.map(document => document.data());
    const ctas = ctaSnapshot.docs.map(document => document.data());
    const dimensions = dimensionSnapshot.docs.map(document => document.data());
    const totalFields = [
      'sessions', 'visitors', 'pageViews', 'ctaImpressions', 'ctaClicks', 'formStarts',
      'formSubmissions', 'formErrors', 'highIntentActions', 'galleryViews', 'galleryOpens',
      'galleryVideoPlays', 'gallerySessions', 'galleryToIntentSessions'
    ];
    const totals = sumRows(daily, totalFields);
    const comparisonTotals = sumRows(comparisonDaily, totalFields);
    totals.ctr = calculateCtr(totals.ctaClicks, totals.ctaImpressions);
    totals.formConversionRate = totals.sessions ? totals.formSubmissions / totals.sessions : 0;
    totals.galleryToIntentRate = totals.gallerySessions ? totals.galleryToIntentSessions / totals.gallerySessions : 0;
    comparisonTotals.ctr = calculateCtr(comparisonTotals.ctaClicks, comparisonTotals.ctaImpressions);
    comparisonTotals.formConversionRate = comparisonTotals.sessions ? comparisonTotals.formSubmissions / comparisonTotals.sessions : 0;
    comparisonTotals.galleryToIntentRate = comparisonTotals.gallerySessions
      ? comparisonTotals.galleryToIntentSessions / comparisonTotals.gallerySessions
      : 0;

    const ctaRows = aggregateCtas(ctas);
    const breakdowns = {};
    for (const dimension of ['page', 'referrer', 'campaign', 'device']) {
      breakdowns[dimension] = aggregateDimensions(dimensions.filter(row => row.dimension === dimension));
    }

    return json({
      success: true,
      range: { start, end },
      totals,
      comparison: { range: comparisonRange, totals: comparisonTotals },
      daily,
      ctas: ctaRows,
      breakdowns
    });
  } catch (error) {
    return json({ success: false, message: error?.message || 'Could not load analytics.' }, 400);
  }
}

function aggregateCtas(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.ctaId}|${row.ctaType}|${row.pagePath}|${row.placement}`;
    const item = grouped.get(key) || {
      ctaId: row.ctaId,
      ctaType: row.ctaType,
      ctaLabel: row.ctaLabel,
      targetLabel: row.targetLabel,
      pagePath: row.pagePath,
      placement: row.placement,
      impressions: 0,
      clicks: 0,
      uniqueImpressions: 0,
      uniqueClicks: 0
    };
    for (const field of ['impressions', 'clicks', 'uniqueImpressions', 'uniqueClicks']) {
      item[field] += Number(row[field] || 0);
    }
    grouped.set(key, item);
  }
  return [...grouped.values()]
    .map(item => ({
      ...item,
      ctr: calculateCtr(item.clicks, item.impressions),
      uniqueCtr: calculateCtr(item.uniqueClicks, item.uniqueImpressions)
    }))
    .sort((left, right) => right.clicks - left.clicks);
}

export function calculateCtr(clicks, impressions) {
  return Number(impressions || 0) > 0 ? Number(clicks || 0) / Number(impressions) : 0;
}

function aggregateDimensions(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const item = grouped.get(row.key) || { key: row.key, label: row.label, count: 0 };
    item.count += Number(row.count || 0);
    grouped.set(row.key, item);
  }
  return [...grouped.values()].sort((left, right) => right.count - left.count).slice(0, 12);
}

export const ANALYTICS_EVENT_NAMES = Object.freeze([...ALLOWED_EVENTS]);
