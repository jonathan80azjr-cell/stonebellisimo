import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCtr, classifyTrafficClass, sanitizeAttribution, validateAnalyticsEvent } from '../src/analytics.mjs';
import { classifyCta, markImpressionOnce } from '../src/analytics-classification.mjs';
import { evaluateSearchConsoleHealth, isBrandedQuery } from '../src/search-console.mjs';

test('analytics validates supported events and rejects stale or malformed metrics', () => {
  const valid = validateAnalyticsEvent({
    id: 'click_1', eventName: 'cta_click', occurredAt: Date.now(), pagePath: '/gallery/',
    visitorId: 'visitor_1', sessionId: 'session_1', ctaType: 'phone'
  });
  assert.equal(valid.event.eventName, 'cta_click');
  assert.equal(valid.event.pagePath, '/gallery/');
  const social = validateAnalyticsEvent({
    id: 'click_2', eventName: 'cta_click', occurredAt: Date.now(), pagePath: '/',
    visitorId: 'visitor_1', sessionId: 'session_1', ctaType: 'social', platform: 'Instagram'
  });
  assert.equal(social.event.platform, 'instagram', 'the platform tag survives validation and is normalised');
  assert.equal(validateAnalyticsEvent({ eventName: 'made_up' }).error, 'Unsupported analytics event.');
  const identity = { id: 'event_test', visitorId: 'visitor_test', sessionId: 'session_test' };
  assert.match(validateAnalyticsEvent({ ...identity, eventName: 'performance', metricName: 'NOPE', metricValue: 2 }).error, /Invalid/);
  assert.match(validateAnalyticsEvent({ ...identity, eventName: 'page_view', occurredAt: Date.now() - 8 * 86400000 }).error, /timestamp/);
  assert.match(validateAnalyticsEvent({ eventName: 'page_view', visitorId: 'visitor_test', sessionId: 'session_test' }).error, /event ID/);
});

test('phone dwell is only accepted for desktop phone CTAs with a credible duration', () => {
  const base = {
    id: 'dwell_1', eventName: 'phone_dwell', occurredAt: Date.now(), pagePath: '/contact-us/',
    visitorId: 'visitor_1', sessionId: 'session_1', ctaType: 'phone', ctaId: 'phone-office',
    deviceCategory: 'desktop', dwellMs: 12000, exitReason: 'blur'
  };
  const valid = validateAnalyticsEvent(base);
  assert.equal(valid.event.dwellMs, 12000);
  assert.equal(valid.event.exitReason, 'blur');
  // A tap on mobile is already a cta_click, so a mobile dwell is double counting.
  assert.match(validateAnalyticsEvent({ ...base, deviceCategory: 'mobile' }).error, /desktop/);
  assert.match(validateAnalyticsEvent({ ...base, ctaType: 'estimate' }).error, /phone or text/);
  assert.match(validateAnalyticsEvent({ ...base, dwellMs: 900 }).error, /outside the accepted window/);
  assert.match(validateAnalyticsEvent({ ...base, dwellMs: 4 * 3600000 }).error, /outside the accepted window/);
  assert.match(validateAnalyticsEvent({ ...base, exitReason: 'guessed' }).error, /exit reason/);
  // Scrolling past a number is weaker evidence than leaving the browser, so it
  // has to clear the higher bar the browser applies before reporting.
  assert.match(validateAnalyticsEvent({ ...base, exitReason: 'dwell', dwellMs: 5000 }).error, /outside the accepted window/);
  assert.equal(validateAnalyticsEvent({ ...base, exitReason: 'dwell', dwellMs: 9000 }).event.exitReason, 'dwell');
});

test('attribution retains coarse first-party fields and strips dangerous detail', () => {
  const clean = sanitizeAttribution({
    visitorId: 'visitor <script>', sessionId: 'session/id', landingPage: 'https://evil.example',
    referrerHost: ' GOOGLE.COM ', utmCampaign: 'summer\u0000sale', deviceCategory: 'mobile',
    userAgent: 'must not survive', ip: '203.0.113.1'
  });
  assert.equal(clean.visitorId, 'visitorscript');
  assert.equal(clean.sessionId, 'sessionid');
  assert.equal(clean.landingPage, '/');
  assert.equal(clean.referrerHost, 'google.com');
  assert.equal(clean.utmCampaign, 'summer sale');
  assert.equal(clean.deviceCategory, 'mobile');
  assert.equal('userAgent' in clean, false);
  assert.equal('ip' in clean, false);
});

test('CTA classification covers phone, map, email, estimate, social, and future fallbacks', () => {
  assert.deepEqual(classifyCta({ href: 'tel:+12015531919' }), { type: 'phone', platform: '', targetLabel: '+12015531919' });
  assert.equal(classifyCta({ href: 'https://maps.google.com/?q=showroom' }).type, 'map');
  assert.equal(
    classifyCta({ href: 'https://www.google.com/maps/example', label: 'See all reviews' }).type,
    'review',
  );
  assert.equal(classifyCta({ href: 'mailto:hello@example.com?subject=Quote' }).targetLabel, 'hello@example.com');
  assert.equal(classifyCta({ onclick: "openWizard('Hero')" }).type, 'estimate');
  assert.equal(classifyCta({ href: '/future-page/' }).type, 'other');
  assert.equal(classifyCta({ explicitType: 'gallery' }).type, 'gallery');
});

test('social CTAs are classified per platform, including X/Twitter', () => {
  const instagram = classifyCta({ href: 'https://instagram.com/stonebellisimo' });
  assert.equal(instagram.type, 'social');
  assert.equal(instagram.platform, 'instagram');
  assert.equal(classifyCta({ href: 'https://www.facebook.com/StoneBellisimoLLC' }).platform, 'facebook');
  assert.equal(classifyCta({ href: 'https://www.houzz.com/pro/stone-bellisimo' }).platform, 'houzz');
  // x.com was previously dropped to "other" because it was absent from the regex.
  const twitter = classifyCta({ href: 'https://x.com/Stonebellisimo' });
  assert.equal(twitter.type, 'social');
  assert.equal(twitter.platform, 'x');
  assert.equal(classifyCta({ href: 'https://twitter.com/Stonebellisimo' }).platform, 'x');
  // A host that merely ends in "x.com" must not read as Twitter.
  assert.equal(classifyCta({ href: 'https://netflix.com/browse' }).type, 'other');
  // Non-social CTAs carry no platform tag.
  assert.equal(classifyCta({ href: 'tel:+12015531919' }).platform, '');
});

test('impressions are deduplicated per stable session/page/CTA key', () => {
  const seen = new Set();
  assert.equal(markImpressionOnce(seen, '/|estimate-hero'), true);
  assert.equal(markImpressionOnce(seen, '/|estimate-hero'), false);
  assert.equal(markImpressionOnce(seen, '/gallery/|estimate-hero'), true);
});

test('QA campaign tags classify traffic as test without catching real campaigns', () => {
  assert.equal(classifyTrafficClass({ utmSource: 'qa', utmMedium: 'test' }), 'test');
  assert.equal(classifyTrafficClass({ utmSource: ' QA ' }), 'test');
  assert.equal(classifyTrafficClass({ utmMedium: 'Monitoring' }), 'test');
  assert.equal(classifyTrafficClass({ utmSource: 'google', utmMedium: 'cpc' }), 'production');
  assert.equal(classifyTrafficClass({ utmCampaign: 'test_kitchen_remodel' }), 'production');
  assert.equal(classifyTrafficClass({}), 'production');
});

test('traffic class is derived server-side and never accepted from the browser', () => {
  const spoofed = sanitizeAttribution({
    visitorId: 'visitor_1', sessionId: 'session_1', utmSource: 'google', utmMedium: 'cpc',
    trafficClass: 'test'
  });
  assert.equal(spoofed.trafficClass, 'production', 'a browser must not hide real traffic from reports');

  const qa = sanitizeAttribution({ visitorId: 'visitor_1', sessionId: 'session_1', utmSource: 'qa', trafficClass: 'production' });
  assert.equal(qa.trafficClass, 'test', 'a browser must not promote QA traffic into business reporting');

  const event = validateAnalyticsEvent({
    id: 'view_qa', eventName: 'page_view', visitorId: 'visitor_1', sessionId: 'session_1',
    utmSource: 'qa', utmMedium: 'test', trafficClass: 'production'
  });
  assert.equal(event.event.trafficClass, 'test');
});

test('CTR is safe for empty impression counts', () => {
  assert.equal(calculateCtr(2, 8), 0.25);
  assert.equal(calculateCtr(4, 0), 0);
});

test('branded search matches Stone Bellisimo spacing and case variants', () => {
  assert.equal(isBrandedQuery('Stone Bellisimo countertops'), true);
  assert.equal(isBrandedQuery('stonebellisimo'), true);
  assert.equal(isBrandedQuery('quartz countertops union city'), false);
});

test('search console health separates never-configured from broken from stale', () => {
  const now = Date.parse('2026-07-22T12:00:00.000Z');
  const hoursAgo = hours => new Date(now - hours * 3600000).toISOString();

  // Never run is not a failure: nobody has done anything wrong yet.
  assert.equal(evaluateSearchConsoleHealth(null, now).status, 'pending');
  assert.equal(evaluateSearchConsoleHealth({}, now).status, 'pending');

  // The live production case: scheduled, attempted, never once succeeded.
  const neverWorked = evaluateSearchConsoleHealth(
    { lastAttemptAt: hoursAgo(3), lastErrorCode: 403, consecutiveFailures: 2 },
    now
  );
  assert.equal(neverWorked.status, 'failed');
  assert.match(neverWorked.message, /never succeeded/);
  assert.match(neverWorked.message, /not a user on this Search Console property/);

  // A working import that started failing must not read as healthy just
  // because a previous run left data behind.
  const regressed = evaluateSearchConsoleHealth(
    { lastAttemptAt: hoursAgo(2), lastSuccessAt: hoursAgo(26), latestDataDate: '2026-07-19', lastErrorCode: 500, consecutiveFailures: 1 },
    now
  );
  assert.equal(regressed.status, 'failed');
  assert.equal(regressed.consecutiveFailures, 1);

  // No error, but a run silently never fired.
  assert.equal(evaluateSearchConsoleHealth(
    { lastAttemptAt: hoursAgo(40), lastSuccessAt: hoursAgo(40), consecutiveFailures: 0 },
    now
  ).status, 'stale');

  const healthy = evaluateSearchConsoleHealth(
    { lastAttemptAt: hoursAgo(5), lastSuccessAt: hoursAgo(5), latestDataDate: '2026-07-20', consecutiveFailures: 0 },
    now
  );
  assert.equal(healthy.status, 'healthy');
  assert.match(healthy.message, /2026-07-20/);
});
