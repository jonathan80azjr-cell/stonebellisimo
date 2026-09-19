import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CHANNELS,
  HIGHLEVEL_ATTRIBUTION_FIELD_KEYS,
  buildGbpTrackedUrl,
  campaignForMonth,
  classifyLeadSource,
  resolveAttributionCredit,
  toHighLevelAttribution
} from '../src/growth-attribution.mjs';

test('a fully tagged Google Business Profile link earns managed credit', () => {
  const result = classifyLeadSource({
    utmSource: 'google', utmMedium: 'organic_local', utmCampaign: 'sb_organic_202608', utmContent: 'gbp-website-button'
  });
  assert.equal(result.channel, 'gbp');
  assert.equal(result.managed, true);
  assert.equal(result.confidence, 'tagged');
  assert.equal(result.placement, 'gbp-website-button');
});

test('a tagged profile link with a malformed campaign is reported as a build defect, not credit', () => {
  const result = classifyLeadSource({ utmSource: 'google', utmMedium: 'organic_local', utmCampaign: 'august-2026' });
  assert.equal(result.channel, 'gbp');
  assert.equal(result.confidence, 'tagged');
  assert.equal(result.managed, false, 'a non-conforming campaign must never be counted as managed');
  assert.match(result.evidence, /non-conforming campaign/);
});

test('a bare google.com referrer is organic search, never profile credit', () => {
  const result = classifyLeadSource({ referrerHost: 'www.google.com' });
  assert.equal(result.channel, 'organic_search');
  assert.equal(result.managed, false);
  assert.equal(result.confidence, 'inferred');
});

test('tagged social links keep their specific network, not a generic social bucket', () => {
  // growth-store.mjs and the publishing schedule both distinguish Instagram from
  // Facebook, so collapsing them here would break the downstream vocabulary.
  const instagram = classifyLeadSource({ utmSource: 'instagram', utmMedium: 'organic_social', utmCampaign: 'sb_organic_202608' });
  assert.equal(instagram.channel, 'instagram');
  assert.equal(instagram.managed, true);
  const facebook = classifyLeadSource({ utmSource: 'facebook', utmMedium: 'organic_social', utmCampaign: 'sb_organic_202608' });
  assert.equal(facebook.channel, 'facebook');
  assert.equal(classifyLeadSource({ referrerHost: 'l.instagram.com' }).channel, 'instagram');
  assert.equal(classifyLeadSource({ referrerHost: 'm.facebook.com' }).channel, 'facebook');
});

test('an untagged maps referrer resolves to the profile but earns no credit', () => {
  const result = classifyLeadSource({ referrerHost: 'maps.google.com' });
  assert.equal(result.channel, 'gbp');
  assert.equal(result.managed, false, 'an inferred profile visit is not proof of managed work');
  assert.equal(result.confidence, 'inferred');
});

test('a visit with no referrer and no tags is direct', () => {
  const result = classifyLeadSource({});
  assert.equal(result.channel, 'direct');
  assert.equal(result.managed, false);
});

test('first touch wins credit even when the visitor returns directly to submit', () => {
  const credit = resolveAttributionCredit({
    firstTouch: { utmSource: 'google', utmMedium: 'organic_local', utmCampaign: 'sb_organic_202608', utmContent: 'gbp-website-button' },
    lastTouch: {}
  });
  assert.equal(credit.creditedChannel, 'gbp');
  assert.equal(credit.managed, true);
  assert.equal(credit.creditBasis, 'first_touch');
  assert.equal(credit.lastTouchChannel, 'direct');
});

test('an untagged first visit followed by a tagged one is credited but flagged as last touch only', () => {
  const credit = resolveAttributionCredit({
    firstTouch: { referrerHost: 'example.com' },
    lastTouch: { utmSource: 'google', utmMedium: 'organic_local', utmCampaign: 'sb_organic_202608' }
  });
  assert.equal(credit.managed, true);
  assert.equal(credit.creditBasis, 'last_touch_only', 'the earlier untagged visit must stay visible in the basis');
  assert.equal(credit.firstTouchChannel, 'referral');
});

test('a lead with no managed touch anywhere is uncredited', () => {
  const credit = resolveAttributionCredit({ firstTouch: { referrerHost: 'www.google.com' }, lastTouch: {} });
  assert.equal(credit.managed, false);
  assert.equal(credit.creditBasis, 'uncredited');
});

test('tracked profile links carry the approved campaign vocabulary', () => {
  const url = buildGbpTrackedUrl('https://stonebellisimollc.com/contact-us/', {
    campaign: 'sb_organic_202608', placement: 'gbp-website-button'
  });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('utm_source'), 'google');
  assert.equal(parsed.searchParams.get('utm_medium'), 'organic_local');
  assert.equal(parsed.searchParams.get('utm_campaign'), 'sb_organic_202608');
  assert.equal(parsed.searchParams.get('utm_content'), 'gbp-website-button');
});

test('tracked profile links reject unknown placements, bad campaigns, and plaintext HTTP', () => {
  const base = 'https://stonebellisimollc.com/contact-us/';
  assert.throws(() => buildGbpTrackedUrl(base, { campaign: 'sb_organic_202608', placement: 'facebook-bio' }), /Unsupported GBP placement/);
  assert.throws(() => buildGbpTrackedUrl(base, { campaign: 'august', placement: 'gbp-website-button' }), /sb_organic_YYYYMM/);
  assert.throws(() => buildGbpTrackedUrl('http://stonebellisimollc.com/', { campaign: 'sb_organic_202608', placement: 'gbp-website-button' }), /HTTPS/);
});

test('placement detail is slugified into a single reportable content id', () => {
  const url = buildGbpTrackedUrl('https://stonebellisimollc.com/', {
    campaign: 'sb_organic_202608', placement: 'gbp-post', detail: 'Quartz Kitchen — Jersey City'
  });
  assert.equal(new URL(url).searchParams.get('utm_content'), 'gbp-post-quartz-kitchen-jersey-city');
});

test('campaign month is derived in the client timezone, not UTC', () => {
  // 2026-09-01T02:00Z is still 2026-08-31 in America/New_York; a UTC-derived
  // campaign would misfile the lead into the following reporting month.
  assert.equal(campaignForMonth(new Date('2026-09-01T02:00:00Z')), 'sb_organic_202608');
  assert.equal(campaignForMonth(new Date('2026-08-15T12:00:00Z')), 'sb_organic_202608');
});

test('managed leads carry credit tags and unmanaged leads do not', () => {
  const managed = toHighLevelAttribution({
    credit: resolveAttributionCredit({ firstTouch: { utmSource: 'google', utmMedium: 'organic_local', utmCampaign: 'sb_organic_202608' } }),
    firebaseLeadId: 'lead_abc'
  });
  assert.ok(managed.tags.includes('bs:managed-credit'));
  assert.ok(managed.tags.includes('bs:channel:gbp'));
  assert.equal(managed.customFields['contact.bs_managed_credit'], 'managed');
  assert.equal(managed.customFields['contact.bs_firebase_lead_id'], 'lead_abc');

  const unmanaged = toHighLevelAttribution({ credit: resolveAttributionCredit({ firstTouch: { referrerHost: 'www.google.com' } }) });
  assert.ok(!unmanaged.tags.includes('bs:managed-credit'));
  assert.equal(unmanaged.customFields['contact.bs_managed_credit'], 'unmanaged');
});

test('every field key the mapper writes exists in the live HighLevel field ledger', () => {
  // Drift guard. HighLevel derives field keys from creation names, so a renamed
  // or unprovisioned field silently drops attribution instead of erroring.
  const ledger = JSON.parse(readFileSync('ops/growth-automation/stone-bellisimo/field-ledger.json', 'utf8'));
  const live = new Set(ledger.fields.map(field => field.fieldKey));
  for (const key of Object.values(HIGHLEVEL_ATTRIBUTION_FIELD_KEYS)) {
    assert.ok(live.has(key), `${key} is not provisioned in the live location`);
  }
});

test('every channel the resolver can emit is storable in the provisioned option lists', () => {
  // A channel the resolver emits but the SINGLE_OPTIONS field cannot store would
  // be dropped by HighLevel without an error, losing the credit silently.
  const ledger = JSON.parse(readFileSync('ops/growth-automation/stone-bellisimo/field-ledger.json', 'utf8'));
  for (const key of ['contact.bs_source_platform', 'contact.bs_first_touch_source', 'contact.bs_last_touch_source']) {
    const field = ledger.fields.find(item => item.fieldKey === key);
    assert.ok(field, `${key} is missing from the ledger`);
    for (const channel of CHANNELS) {
      assert.ok(field.picklistOptions.includes(channel), `${key} cannot store channel "${channel}"`);
    }
  }
});
