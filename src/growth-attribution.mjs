// Source attribution for the Stone Bellisimo growth program.
//
// The business question this answers is narrow and adversarial: when a lead
// lands, can we prove it arrived through work BiteSites performed, or did it
// merely arrive while BiteSites happened to be engaged? Those are different
// claims and only the first one is billable. Every rule below is written so a
// guess can never be reported as proof.

const CAMPAIGN_PATTERN = /^sb_organic_\d{6}$/;

// Channels a lead can be resolved to. `gbp` is the Google Business Profile /
// Maps surface; `organic_search` is the classic blue-link result. They share a
// referrer host, which is exactly why an untagged Google visit can never be
// credited to profile work.
// Instagram and Facebook stay distinct rather than collapsing into a `social`
// bucket: the publishing schedule, the growth store's inquiry vocabulary, and
// the owner's own reporting all treat them as separate channels.
export const CHANNELS = Object.freeze(['gbp', 'instagram', 'facebook', 'organic_search', 'referral', 'direct', 'unknown']);

// Confidence is a first-class output, not a footnote. `tagged` means a link we
// control carried the campaign parameters end to end. `inferred` means a
// heuristic matched. Only `tagged` may be reported as managed credit.
export const CONFIDENCE = Object.freeze(['tagged', 'inferred', 'unknown']);

export const GBP_MEDIUM = 'organic_local';
export const SOCIAL_MEDIUM = 'organic_social';

// The controlled placements on the Google Business Profile. A profile link that
// is not in this list is untagged, and an untagged link is unattributable — so
// this list doubles as the build checklist for the profile itself.
export const GBP_PLACEMENTS = Object.freeze([
  'gbp-website-button',
  'gbp-appointment-link',
  'gbp-review-link',
  'gbp-post',
  'gbp-service',
  'gbp-product',
  'gbp-photo-caption'
]);

const SOCIAL_REFERRERS = new Map([
  ['instagram.com', 'instagram'], ['www.instagram.com', 'instagram'], ['l.instagram.com', 'instagram'],
  ['facebook.com', 'facebook'], ['www.facebook.com', 'facebook'], ['m.facebook.com', 'facebook'],
  ['l.facebook.com', 'facebook'], ['lm.facebook.com', 'facebook']
]);

// Maps-specific hosts. A bare `google.com` referrer is deliberately absent:
// organic search and the local pack both send it, so treating it as profile
// traffic would silently inflate the profile's numbers.
const MAPS_REFERRERS = new Set(['maps.google.com', 'maps.app.goo.gl', 'g.page']);

const SEARCH_REFERRERS = new Set([
  'google.com', 'www.google.com', 'bing.com', 'www.bing.com',
  'duckduckgo.com', 'search.yahoo.com', 'yahoo.com'
]);

function clean(value, max = 160) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function host(value) {
  return clean(value, 160).toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/**
 * Resolve one touch into a channel plus an explicit confidence and evidence
 * string. Callers must branch on `managed` before counting a lead as program
 * credit; `channel` alone says where traffic came from, not who earned it.
 */
export function classifyLeadSource({ utmSource, utmMedium, utmCampaign, utmContent, referrerHost } = {}) {
  const source = clean(utmSource, 100).toLowerCase();
  const medium = clean(utmMedium, 100).toLowerCase();
  const campaign = clean(utmCampaign, 120);
  const content = clean(utmContent, 180).toLowerCase();
  const referrer = host(referrerHost);
  const campaignValid = CAMPAIGN_PATTERN.test(campaign);

  // A tagged link is the only thing that earns managed credit, and it only
  // earns it when the campaign matches the approved pattern. A half-tagged link
  // is a build defect, so it is surfaced as such rather than quietly upgraded.
  if (source === 'google' && medium === GBP_MEDIUM) {
    return {
      channel: 'gbp',
      placement: content,
      managed: campaignValid,
      confidence: 'tagged',
      campaign,
      evidence: campaignValid
        ? `utm_source=google&utm_medium=${GBP_MEDIUM}&utm_campaign=${campaign}`
        : `tagged GBP link with non-conforming campaign "${campaign}"; expected sb_organic_YYYYMM`
    };
  }

  if ((source === 'instagram' || source === 'facebook') && medium === SOCIAL_MEDIUM) {
    return {
      channel: source,
      placement: content,
      managed: campaignValid,
      confidence: 'tagged',
      campaign,
      evidence: campaignValid
        ? `utm_source=${source}&utm_medium=${SOCIAL_MEDIUM}&utm_campaign=${campaign}`
        : `tagged social link with non-conforming campaign "${campaign}"; expected sb_organic_YYYYMM`
    };
  }

  // Untagged traffic. Nothing below this line may be reported as managed.
  if (MAPS_REFERRERS.has(referrer)) {
    return { channel: 'gbp', placement: '', managed: false, confidence: 'inferred', campaign: '', evidence: `maps referrer ${referrer}; link was not tagged` };
  }
  if (SEARCH_REFERRERS.has(referrer)) {
    return { channel: 'organic_search', placement: '', managed: false, confidence: 'inferred', campaign: '', evidence: `search referrer ${referrer}; local pack and blue link are indistinguishable here` };
  }
  if (SOCIAL_REFERRERS.has(referrer)) {
    return { channel: SOCIAL_REFERRERS.get(referrer), placement: '', managed: false, confidence: 'inferred', campaign: '', evidence: `social referrer ${referrer}; link was not tagged` };
  }
  if (referrer) {
    return { channel: 'referral', placement: '', managed: false, confidence: 'inferred', campaign: '', evidence: `referrer ${referrer}` };
  }
  if (source || medium) {
    return { channel: 'unknown', placement: content, managed: false, confidence: 'unknown', campaign, evidence: `unrecognized campaign tags source="${source}" medium="${medium}"` };
  }
  return { channel: 'direct', placement: '', managed: false, confidence: 'unknown', campaign: '', evidence: 'no referrer and no campaign tags' };
}

/**
 * Build a tracked Google Business Profile link. Every outbound link on the
 * profile must be produced here — the profile is the one surface where an
 * untagged link is indistinguishable from organic search forever after.
 */
export function buildGbpTrackedUrl(destination, { campaign, placement, detail = '' } = {}) {
  const url = new URL(destination);
  if (url.protocol !== 'https:') throw new Error('Tracked destinations must be HTTPS.');
  if (!CAMPAIGN_PATTERN.test(campaign || '')) throw new Error('Campaign must use sb_organic_YYYYMM.');
  const base = clean(placement, 60).toLowerCase();
  if (!GBP_PLACEMENTS.includes(base)) throw new Error(`Unsupported GBP placement "${base}".`);
  const suffix = clean(detail, 120).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const content = suffix ? `${base}-${suffix}` : base;
  url.searchParams.set('utm_source', 'google');
  url.searchParams.set('utm_medium', GBP_MEDIUM);
  url.searchParams.set('utm_campaign', campaign);
  url.searchParams.set('utm_content', content);
  return url.toString();
}

/** `sb_organic_YYYYMM` for a given date, in the client's reporting month. */
export function campaignForMonth(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.valueOf())) throw new TypeError('A valid date is required.');
  // The program reports in America/New_York; deriving the month from UTC would
  // misfile every lead in the first hours of the month.
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).formatToParts(value);
  const year = parts.find(part => part.type === 'year').value;
  const month = parts.find(part => part.type === 'month').value;
  return `sb_organic_${year}${month}`;
}

/**
 * Decide which touch earns the credit. First touch wins: the profile click that
 * introduced the customer is the work that produced the lead, even when they
 * return later by typing the domain directly.
 */
export function resolveAttributionCredit({ firstTouch, lastTouch } = {}) {
  const first = firstTouch ? classifyLeadSource(firstTouch) : null;
  const last = lastTouch ? classifyLeadSource(lastTouch) : null;
  const credited = first?.managed ? first : last?.managed ? last : first || last || classifyLeadSource({});
  return {
    creditedChannel: credited.channel,
    creditedPlacement: credited.placement || '',
    creditedCampaign: credited.campaign || '',
    managed: Boolean(credited.managed),
    confidence: credited.confidence,
    creditBasis: first?.managed ? 'first_touch' : last?.managed ? 'last_touch_only' : 'uncredited',
    evidence: credited.evidence,
    firstTouchChannel: first?.channel || 'unknown',
    lastTouchChannel: last?.channel || 'unknown'
  };
}

// HighLevel custom-field keys this module writes. Keys are derived by HighLevel
// from the field's creation name, so these are expectations until a live
// readback confirms them — see ops/.../field-ledger.json for what exists today.
export const HIGHLEVEL_ATTRIBUTION_FIELD_KEYS = Object.freeze({
  sourcePlatform: 'contact.bs_source_platform',
  sourceContentId: 'contact.bs_source_content_id',
  sourceCampaign: 'contact.bs_source_campaign',
  attributionConfidence: 'contact.bs_attribution_confidence',
  managedCredit: 'contact.bs_managed_credit',
  firstTouchAt: 'contact.bs_first_touch_at',
  firstTouchSource: 'contact.bs_first_touch_source',
  lastTouchAt: 'contact.bs_last_touch_at',
  lastTouchSource: 'contact.bs_last_touch_source',
  firebaseLeadId: 'contact.bs_firebase_lead_id'
});

/**
 * Map a resolved credit onto the HighLevel contact payload that carries it into
 * the pipeline. Returns the field map plus the tags that make managed leads
 * filterable in the HighLevel UI without opening each record.
 */
export function toHighLevelAttribution({ credit, firebaseLeadId, firstTouchAt, lastTouchAt } = {}) {
  if (!credit) throw new TypeError('A resolved credit is required.');
  const keys = HIGHLEVEL_ATTRIBUTION_FIELD_KEYS;
  const customFields = {
    [keys.sourcePlatform]: credit.creditedChannel,
    [keys.sourceContentId]: credit.creditedPlacement,
    [keys.sourceCampaign]: credit.creditedCampaign,
    [keys.attributionConfidence]: credit.confidence,
    [keys.managedCredit]: credit.managed ? 'managed' : 'unmanaged',
    [keys.firstTouchSource]: credit.firstTouchChannel,
    [keys.lastTouchSource]: credit.lastTouchChannel
  };
  if (firstTouchAt) customFields[keys.firstTouchAt] = new Date(firstTouchAt).toISOString();
  if (lastTouchAt) customFields[keys.lastTouchAt] = new Date(lastTouchAt).toISOString();
  if (firebaseLeadId) customFields[keys.firebaseLeadId] = clean(firebaseLeadId, 120);

  const tags = ['bs:client:sb', 'bs:program:sb-growth-v1'];
  if (credit.managed) tags.push('bs:managed-credit', `bs:channel:${credit.creditedChannel}`);
  return { customFields, tags };
}

// Fields above that are NOT present in the live HighLevel field ledger as of the
// 2026-08-26 readback. Provisioning these is a prerequisite for pipeline-level
// attribution; until then the mapper's output has nowhere to land.
export const UNPROVISIONED_ATTRIBUTION_FIELDS = Object.freeze([
  'BS Source Platform', 'BS Source Content ID', 'BS Source Campaign',
  'BS Attribution Confidence', 'BS Managed Credit',
  'BS First Touch At', 'BS First Touch Source', 'BS Last Touch At', 'BS Last Touch Source'
]);
