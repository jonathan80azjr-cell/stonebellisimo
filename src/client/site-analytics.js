import { initializeApp } from 'firebase/app';
import { ReCaptchaEnterpriseProvider, getToken, initializeAppCheck } from 'firebase/app-check';
import { PHONE_DWELL, classifyCta, markImpressionOnce, slugAnalyticsValue } from '../analytics-classification.mjs';

const STORAGE = {
  visitor: 'sb_analytics_visitor',
  session: 'sb_analytics_session',
  queue: 'sb_analytics_queue',
  impressions: 'sb_analytics_impressions'
};
const SESSION_TIMEOUT = 30 * 60 * 1000;
const MAX_QUEUE = 100;
const pagePath = location.pathname || '/';
// Phone and text CTAs the visitor actually used. A dwell on a number they went
// on to click is the same contact attempt reported twice.
const clickedContactCtas = new Set();
let appCheck = null;
let configReady = false;
let flushing = false;
let flushTimer = 0;

function uuid(prefix) {
  if (crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

// JSON.parse(null) does not throw: it stringifies null to "null" and returns
// the JS value null, so a missing storage key would slip past the fallback and
// hand callers a null where they asked for {} or []. setupCtas() then read a
// sessionId key off that null, threw, and aborted boot() before page_view and
// the CTA click listener were ever wired up. Treat a null/undefined input or
// parse result as absent so every caller gets the shape it requested.
function safeParse(value, fallback) {
  if (value === null || value === undefined) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch { return fallback; }
}

function clean(value, max = 160) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function storageGet(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}

function storageSet(storage, key, value) {
  try { storage.setItem(key, value); } catch {}
}

function visitorId() {
  let id = storageGet(localStorage, STORAGE.visitor);
  if (!id) {
    id = uuid('visitor');
    storageSet(localStorage, STORAGE.visitor, id);
  }
  return id;
}

function currentSession() {
  const now = Date.now();
  let session = safeParse(storageGet(sessionStorage, STORAGE.session), null);
  if (!session || !session.id || now - Number(session.lastSeen || 0) > SESSION_TIMEOUT) {
    const params = new URLSearchParams(location.search);
    let referrerHost = '';
    try { referrerHost = document.referrer ? new URL(document.referrer).hostname : ''; } catch {}
    session = {
      id: uuid('session'),
      startedAt: now,
      lastSeen: now,
      landingPage: pagePath,
      referrerHost: clean(referrerHost, 160).toLowerCase(),
      utmSource: clean(params.get('utm_source'), 100),
      utmMedium: clean(params.get('utm_medium'), 100),
      utmCampaign: clean(params.get('utm_campaign'), 120),
      utmTerm: clean(params.get('utm_term'), 120),
      utmContent: clean(params.get('utm_content'), 120)
    };
  } else {
    session.lastSeen = now;
  }
  storageSet(sessionStorage, STORAGE.session, JSON.stringify(session));
  return session;
}

function deviceCategory() {
  const width = Math.min(screen.width || innerWidth, innerWidth || screen.width);
  if (width < 768) return 'mobile';
  if (width < 1100 && navigator.maxTouchPoints > 0) return 'tablet';
  return 'desktop';
}

function attribution() {
  const session = currentSession();
  return {
    visitorId: visitorId(),
    sessionId: session.id,
    landingPage: session.landingPage,
    referrerHost: session.referrerHost,
    utmSource: session.utmSource,
    utmMedium: session.utmMedium,
    utmCampaign: session.utmCampaign,
    utmTerm: session.utmTerm,
    utmContent: session.utmContent,
    deviceCategory: deviceCategory()
  };
}

function readQueue() {
  const queue = safeParse(storageGet(localStorage, STORAGE.queue), []);
  return Array.isArray(queue) ? queue.slice(-MAX_QUEUE) : [];
}

function writeQueue(queue) {
  storageSet(localStorage, STORAGE.queue, JSON.stringify(queue.slice(-MAX_QUEUE)));
}

function eventPayload(eventName, detail = {}) {
  return {
    id: clean(detail.id, 120) || uuid('event'),
    eventName,
    occurredAt: Date.now(),
    pagePath,
    pageTitle: clean(document.title, 180),
    ...attribution(),
    ...detail
  };
}

function track(eventName, detail = {}) {
  const queue = readQueue();
  queue.push(eventPayload(eventName, detail));
  writeQueue(queue);
  scheduleFlush();
}

function scheduleFlush(delay = 450) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, delay);
}

async function appCheckHeader() {
  if (!appCheck) return {};
  try {
    const result = await getToken(appCheck, false);
    return result?.token ? { 'X-Firebase-AppCheck': result.token } : {};
  } catch {
    return {};
  }
}

async function flush() {
  if (flushing || !navigator.onLine) return;
  const queue = readQueue();
  if (!queue.length) return;
  flushing = true;
  const batch = queue.slice(0, 20);
  try {
    const headers = { 'Content-Type': 'application/json', ...(await appCheckHeader()) };
    const response = await fetch('/api/analytics/events', {
      method: 'POST',
      headers,
      body: JSON.stringify({ events: batch }),
      keepalive: true,
      credentials: 'same-origin'
    });
    if (!response.ok) throw new Error(`Analytics endpoint returned ${response.status}`);
    writeQueue(readQueue().slice(batch.length));
    if (readQueue().length) scheduleFlush(25);
  } catch {
    scheduleFlush(15000);
  } finally {
    flushing = false;
  }
}

function slug(value) {
  return slugAnalyticsValue(value);
}

function textLabel(element) {
  return clean(element.getAttribute('aria-label') || element.dataset.analyticsLabel || element.textContent, 160) || 'Unlabelled CTA';
}

function placement(element) {
  if (element.dataset.analyticsPlacement) return clean(element.dataset.analyticsPlacement, 120);
  const container = element.closest('[data-analytics-placement],section,nav,header,footer,[role="dialog"],.modal,.mob-menu,.chat-panel');
  if (!container) return 'page';
  return clean(container.dataset?.analyticsPlacement || container.id || container.className, 120) || container.tagName.toLowerCase();
}

function classify(element) {
  const href = element.getAttribute('href') || '';
  const onclick = element.getAttribute('onclick') || '';
  const label = textLabel(element);
  const classified = classifyCta({
    href,
    onclick,
    explicitType: element.dataset.analyticsType,
    label,
    dataCta: element.dataset.cta
  });
  const { type, platform, targetLabel } = classified;
  const ctaId = clean(element.dataset.analyticsId || element.dataset.cta, 160) ||
    `${slug(type)}-${slug(placement(element))}-${slug(targetLabel || label)}`;
  return { ctaId, ctaType: type, ctaLabel: label, placement: placement(element), targetLabel: clean(targetLabel, 120), platform };
}

function ctaElements() {
  return [...document.querySelectorAll('a[href],button,[role="button"],[data-cta],[data-analytics-id]')]
    .filter(element => !element.closest('[data-no-analytics]'));
}

function setupCtas() {
  const impressionState = safeParse(storageGet(sessionStorage, STORAGE.impressions), {});
  const sessionId = currentSession().id;
  const seen = new Set(Array.isArray(impressionState[sessionId]) ? impressionState[sessionId] : []);
  const observed = new WeakSet();
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
      const detail = classify(entry.target);
      const key = `${pagePath}|${detail.ctaId}`;
      if (markImpressionOnce(seen, key)) {
        impressionState[sessionId] = [...seen].slice(-300);
        storageSet(sessionStorage, STORAGE.impressions, JSON.stringify(impressionState));
        track('cta_impression', detail);
      }
      observer.unobserve(entry.target);
    }
  }, { threshold: [0.5] }) : null;
  const observeElement = element => {
    if (!observer || observed.has(element) || element.closest('[data-no-analytics]')) return;
    observed.add(element);
    observer.observe(element);
  };
  if (observer) {
    ctaElements().forEach(observeElement);
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('a[href],button,[role="button"],[data-cta],[data-analytics-id]')) observeElement(node);
          node.querySelectorAll?.('a[href],button,[role="button"],[data-cta],[data-analytics-id]').forEach(observeElement);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('click', event => {
    const element = event.target.closest?.('a[href],button,[role="button"],[data-cta],[data-analytics-id]');
    if (!element || element.closest('[data-no-analytics]')) return;
    const detail = classify(element);
    track('cta_click', detail);
    if (['phone', 'sms'].includes(detail.ctaType)) clickedContactCtas.add(detail.ctaId);
    const galleryCall = element.getAttribute('onclick') || '';
    if (/openGalleryModal/.test(galleryCall)) {
      track('gallery_item_open', { galleryItem: element.querySelector('img')?.alt || detail.ctaLabel, placement: 'homepage-gallery' });
    }
  }, { capture: true });
}

// Desktop only: on a phone, tapping the number is the call, and that tap is
// already a cta_click. On a desktop the visitor reads the number off the screen
// and dials on a separate handset, which leaves no click to count. What is
// observable is the number holding the viewport while the visitor stops driving
// the page — a proxy for an off-site call, never proof of one.
function setupPhoneDwell() {
  if (deviceCategory() !== 'desktop' || !('IntersectionObserver' in window)) return;
  const elements = [...document.querySelectorAll('a[href^="tel:"],a[href^="sms:"],[data-analytics-phone]')]
    .filter(element => !element.closest('[data-no-analytics]'));
  if (!elements.length) return;

  const states = new Map(elements.map(element => [element, { visible: false, dwellMs: 0, reported: false }]));
  let lastInputAt = Date.now();
  let tickAt = Date.now();
  let ticker = 0;

  const report = (element, exitReason) => {
    const state = states.get(element);
    if (!state || state.reported) return;
    const dwellMs = Math.min(Math.round(state.dwellMs), PHONE_DWELL.maxMs);
    if (dwellMs < (exitReason === 'dwell' ? PHONE_DWELL.activeMs : PHONE_DWELL.minMs)) return;
    state.reported = true;
    const detail = classify(element);
    if (!clickedContactCtas.has(detail.ctaId)) track('phone_dwell', { ...detail, dwellMs, exitReason });
    if ([...states.values()].every(item => item.reported)) {
      clearInterval(ticker);
      ticker = 0;
    }
  };

  const reportVisible = exitReason => {
    for (const [element, state] of states) if (state.visible) report(element, exitReason);
  };

  const tick = () => {
    const now = Date.now();
    // A throttled background timer or a sleeping machine can skip minutes at a
    // time; only credit dwell the visitor could plausibly have been present for.
    const elapsed = Math.min(now - tickAt, PHONE_DWELL.tickMs * 3);
    tickAt = now;
    if (document.visibilityState !== 'visible') return;
    if (now - lastInputAt >= PHONE_DWELL.idleMs) return reportVisible('idle');
    for (const state of states.values()) if (state.visible && !state.reported) state.dwellMs += elapsed;
  };

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const state = states.get(entry.target);
      if (!state) continue;
      const visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      // Scrolling the number out of view ends the dwell either way.
      if (state.visible && !visible) report(entry.target, 'dwell');
      state.visible = visible;
    }
  }, { threshold: [0.5] });
  for (const element of states.keys()) observer.observe(element);

  for (const type of ['pointerdown', 'pointermove', 'keydown', 'scroll', 'wheel']) {
    addEventListener(type, () => { lastInputAt = Date.now(); }, { passive: true });
  }
  // Window blur, not element blur: leaving the browser with the number on
  // screen is the strongest evidence available that the call moved off-site.
  addEventListener('blur', () => reportVisible('blur'));
  // The page may never run script again after these, so send rather than leave
  // the signal to the debounced flush timer.
  addEventListener('pagehide', () => { reportVisible('dwell'); flush(); }, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      reportVisible('hidden');
      flush();
      return;
    }
    tickAt = Date.now();
    lastInputAt = Date.now();
  });
  ticker = setInterval(tick, PHONE_DWELL.tickMs);
}

function setupGallery() {
  const gallery = document.querySelector('#gallery,[data-analytics-gallery]');
  if (gallery && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.25)) return;
      track('gallery_view', { placement: pagePath === '/' ? 'homepage-gallery' : 'gallery-page' });
      observer.disconnect();
    }, { threshold: [0.25] });
    observer.observe(gallery);
  }
  document.querySelectorAll('video').forEach(video => {
    video.addEventListener('play', () => track('gallery_video_play', {
      galleryItem: clean(video.currentSrc || video.getAttribute('src'), 180),
      placement: video.closest('#gallery') ? 'homepage-gallery' : placement(video)
    }), { once: true });
  });
}

function observePerformance() {
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  const values = { CLS: 0, LCP: 0, INP: 0 };
  const observe = (type, callback, options = {}) => {
    if (!('PerformanceObserver' in window)) return;
    try { new PerformanceObserver(callback).observe({ type, buffered: true, ...options }); } catch {}
  };
  observe('paint', list => list.getEntries().forEach(entry => {
    if (entry.name === 'first-contentful-paint') track('performance', { metricName: 'FCP', metricValue: entry.startTime, navigationType: nav?.type || 'navigate' });
  }));
  observe('layout-shift', list => list.getEntries().forEach(entry => { if (!entry.hadRecentInput) values.CLS += entry.value; }));
  observe('largest-contentful-paint', list => { const last = list.getEntries().at(-1); if (last) values.LCP = last.startTime; });
  observe('event', list => list.getEntries().forEach(entry => { if (entry.interactionId) values.INP = Math.max(values.INP, entry.duration); }), { durationThreshold: 40 });
  addEventListener('load', () => {
    if (nav) track('performance', { metricName: 'TTFB', metricValue: nav.responseStart, navigationType: nav.type });
  }, { once: true });
  let finalSent = false;
  const final = () => {
    if (finalSent) return;
    finalSent = true;
    if (values.LCP) track('performance', { metricName: 'LCP', metricValue: values.LCP, navigationType: nav?.type || 'navigate' });
    track('performance', { metricName: 'CLS', metricValue: values.CLS, navigationType: nav?.type || 'navigate' });
    if (values.INP) track('performance', { metricName: 'INP', metricValue: values.INP, navigationType: nav?.type || 'navigate' });
    flush();
  };
  addEventListener('pagehide', final, { once: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') final(); });
}

function preserveExistingEnhancements() {
  window.__avifSupported = false;
  const banners = [...document.querySelectorAll('.bitesites-banner')];
  if (!banners.length || !matchMedia) return;
  const update = () => {
    const doc = document.documentElement;
    const atBottom = matchMedia('(max-width: 520px)').matches &&
      (scrollY + innerHeight >= Math.max(doc.scrollHeight, document.body?.scrollHeight || 0) - 80);
    banners.forEach(banner => banner.classList.toggle('is-at-page-bottom', atBottom));
  };
  update();
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
}

async function configureAppCheck() {
  try {
    const response = await fetch('/api/firebase-config', { headers: { accept: 'application/json' } });
    const data = await response.json();
    if (data.configured && data.appCheckSiteKey) {
      const app = initializeApp(data.firebaseConfig, 'stone-bellisimo-site');
      appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(data.appCheckSiteKey),
        isTokenAutoRefreshEnabled: true
      });
    }
  } catch {}
  configReady = true;
  flush();
}

// One broken enhancement must never take the rest of analytics down with it.
// setupCtas() throwing on a fresh session is what silently dropped every page
// view and CTA click for the life of the site; isolating each step guarantees
// the visit is still recorded and the surviving observers still run.
function runSafely(label, fn) {
  try { fn(); } catch (error) {
    try { console.warn(`Analytics setup step "${label}" failed`, error); } catch {}
  }
}

function boot() {
  currentSession();
  // Record the visit first, before any observer wiring that could throw.
  track('page_view');
  runSafely('preserveExistingEnhancements', preserveExistingEnhancements);
  runSafely('setupCtas', setupCtas);
  runSafely('setupPhoneDwell', setupPhoneDwell);
  runSafely('setupGallery', setupGallery);
  runSafely('observePerformance', observePerformance);
  configureAppCheck();
  addEventListener('online', flush);
}

window.StoneBellisimoAnalytics = {
  track,
  flush,
  attribution,
  appCheckHeader,
  isConfigured: () => configReady
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
