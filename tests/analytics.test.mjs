import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCtr, sanitizeAttribution, validateAnalyticsEvent } from '../src/analytics.mjs';
import { classifyCta, markImpressionOnce } from '../src/analytics-classification.mjs';
import { isBrandedQuery } from '../src/search-console.mjs';

test('analytics validates supported events and rejects stale or malformed metrics', () => {
  const valid = validateAnalyticsEvent({
    id: 'click_1', eventName: 'cta_click', occurredAt: Date.now(), pagePath: '/gallery/',
    visitorId: 'visitor_1', sessionId: 'session_1', ctaType: 'phone'
  });
  assert.equal(valid.event.eventName, 'cta_click');
  assert.equal(valid.event.pagePath, '/gallery/');
  assert.equal(validateAnalyticsEvent({ eventName: 'made_up' }).error, 'Unsupported analytics event.');
  const identity = { id: 'event_test', visitorId: 'visitor_test', sessionId: 'session_test' };
  assert.match(validateAnalyticsEvent({ ...identity, eventName: 'performance', metricName: 'NOPE', metricValue: 2 }).error, /Invalid/);
  assert.match(validateAnalyticsEvent({ ...identity, eventName: 'page_view', occurredAt: Date.now() - 8 * 86400000 }).error, /timestamp/);
  assert.match(validateAnalyticsEvent({ eventName: 'page_view', visitorId: 'visitor_test', sessionId: 'session_test' }).error, /event ID/);
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
  assert.deepEqual(classifyCta({ href: 'tel:+12015531919' }), { type: 'phone', targetLabel: '+12015531919' });
  assert.equal(classifyCta({ href: 'https://maps.google.com/?q=showroom' }).type, 'map');
  assert.equal(
    classifyCta({ href: 'https://www.google.com/maps/example', label: 'See all reviews' }).type,
    'review',
  );
  assert.equal(classifyCta({ href: 'mailto:hello@example.com?subject=Quote' }).targetLabel, 'hello@example.com');
  assert.equal(classifyCta({ onclick: "openWizard('Hero')" }).type, 'estimate');
  assert.equal(classifyCta({ href: 'https://instagram.com/stonebellisimo' }).type, 'social');
  assert.equal(classifyCta({ href: '/future-page/' }).type, 'other');
  assert.equal(classifyCta({ explicitType: 'gallery' }).type, 'gallery');
});

test('impressions are deduplicated per stable session/page/CTA key', () => {
  const seen = new Set();
  assert.equal(markImpressionOnce(seen, '/|estimate-hero'), true);
  assert.equal(markImpressionOnce(seen, '/|estimate-hero'), false);
  assert.equal(markImpressionOnce(seen, '/gallery/|estimate-hero'), true);
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
