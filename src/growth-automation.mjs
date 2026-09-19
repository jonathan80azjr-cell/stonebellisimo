import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { GROWTH_CLIENT } from './growth-client-config.mjs';

export const SOCIAL_EVENT_TYPES = new Set(['social_inquiry', 'consent', 'claim', 'qualification', 'estimate_scheduled', 'outcome']);
export const CONTENT_STATES = [...GROWTH_CLIENT.publishing.state_machine];
const FORWARD = new Map(CONTENT_STATES.slice(0, -1).map((state, index) => [state, CONTENT_STATES[index + 1]]));

export function eventDocumentId({ eventId, rawBody }) {
  const stable = eventId || rawBody;
  if (!stable) throw new TypeError('eventId or rawBody is required');
  return `hl_${createHash('sha256').update(String(stable)).digest('hex')}`;
}

export function verifyHighLevelSignature({ rawBody, signature, timestamp, secret, now = Date.now(), toleranceMs = 5 * 60 * 1000 }) {
  if (!rawBody || !signature || !timestamp || !secret) return false;
  const stamp = Number(timestamp);
  if (!Number.isFinite(stamp) || Math.abs(now - stamp * 1000) > toleranceMs) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const provided = signature.replace(/^sha256=/i, '');
  if (!/^[a-f0-9]{64}$/i.test(provided) || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function clean(value, max = 160) { return typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max) : undefined; }
export function normalizeHighLevelEvent(payload, { locationId, accountIds = [] } = {}) {
  if (!payload || !SOCIAL_EVENT_TYPES.has(payload.type)) return { error: 'unsupported_event_type' };
  if (locationId && payload.locationId !== locationId) return { error: 'wrong_location' };
  if (accountIds.length && !accountIds.includes(payload.accountId)) return { error: 'wrong_account' };
  const event = {
    type: payload.type, eventId: clean(payload.eventId, 256), locationId: clean(payload.locationId), accountId: clean(payload.accountId), occurredAt: clean(payload.occurredAt, 64), inquiryId: clean(payload.inquiryId, 256), contactId: clean(payload.contactId, 256), opportunityId: clean(payload.opportunityId, 256),
    platform: clean(payload.platform || payload.sourcePlatform, 32), category: clean(payload.category, 48), channel: clean(payload.channel, 32), placement: clean(payload.placement, 48), conversationId: clean(payload.conversationId, 256), commentId: clean(payload.commentId, 256), responseWindowExpiresAt: clean(payload.responseWindowExpiresAt, 64),
    contentId: clean(payload.contentId, 256), postId: clean(payload.postId, 256), consentStatus: clean(payload.consentStatus, 24), consentVersion: clean(payload.consentVersion, 64), consentRecordedAt: clean(payload.consentRecordedAt, 64), claimedBy: clean(payload.claimedBy, 128), qualified: payload.qualified === true, outcome: clean(payload.outcome, 64),
    projectType: clean(payload.projectType, 120), material: clean(payload.material, 120), city: clean(payload.city, 100), postalCode: clean(payload.postalCode, 16), timeframe: clean(payload.timeframe, 80), usableContactMethod: clean(payload.usableContactMethod, 32),
    serviceFit: payload.serviceFit === true, serviceAreaFit: payload.serviceAreaFit === true, genuineProjectIntent: payload.genuineProjectIntent === true,
    firstName: clean(payload.firstName, 80), lastName: clean(payload.lastName, 80), email: clean(payload.email, 240), phone: clean(payload.phone, 40),
    firebaseLeadId: clean(payload.firebaseLeadId, 256), qualificationVersion: clean(payload.qualificationVersion, 80), outcomeVersion: clean(payload.outcomeVersion, 80), estimateScheduledAt: clean(payload.estimateScheduledAt, 64)
  };
  // Deliberately no message/comment/body fields: this collection is pre-consent metadata only.
  return { event, id: eventDocumentId({ eventId: event.eventId, rawBody: JSON.stringify(event) }) };
}

export function classifyInquiry(text = '') {
  const value = String(text).toLowerCase();
  if (/\b(911|emergency|urgent|hurt|danger)\b/.test(value)) return 'safety_urgent';
  if (/\b(complaint|angry|terrible|refund|lawsuit)\b/.test(value)) return 'complaint';
  if (/\b(price|cost|quote|estimate|install|countertop|kitchen|vanity)\b/.test(value)) return 'estimate_intent';
  if (/\b(quartz|granite|marble|quartzite|porcelain|material)\b/.test(value)) return 'material_question';
  if (/\b(hour|open|showroom)\b/.test(value)) return 'showroom_hours';
  if (/\b(area|serve|zip|city|union city)\b/.test(value)) return 'service_area';
  if (/\b(spam|crypto|followers|click here)\b/.test(value)) return 'spam';
  if (/\b(thank|love|beautiful|great)\b/.test(value)) return 'compliment';
  if (/\b(existing|already|job|repair)\b/.test(value)) return 'existing_customer_issue';
  return 'other';
}

export function applyInquiryTransition(current = {}, event, now = new Date().toISOString()) {
  const next = { ...current, updatedAt: now };
  if (event.type === 'consent') { next.consent = { status: event.consentStatus, version: event.consentVersion, at: now }; }
  if (event.type === 'claim' && !current.claimedBy) { next.claimedBy = event.claimedBy; next.claimedAt = now; }
  if (event.type === 'qualification' && event.qualified === true) {
    if (!current.serviceFit || !current.serviceArea || !current.genuineIntent || !current.usableContact || current.consent?.status !== 'granted') return { error: 'qualification_requirements_missing' };
    next.status = 'Qualified'; next.qualifiedAt = now;
  }
  return { inquiry: next };
}

export function slaStatus({ receivedAt, claimedAt, now = Date.now() }) {
  const elapsedMinutes = Math.max(0, (Number(now) - new Date(receivedAt).valueOf()) / 60000);
  const reminderMinutes = GROWTH_CLIENT.sla.inbound_reminder_minutes;
  const breachMinutes = GROWTH_CLIENT.sla.inbound_breach_minutes;
  return { elapsedMinutes, reminderDue: !claimedAt && elapsedMinutes >= reminderMinutes, breachDue: !claimedAt && elapsedMinutes >= breachMinutes, claimedWithinThirty: Boolean(claimedAt) && (new Date(claimedAt).valueOf() - new Date(receivedAt).valueOf()) <= breachMinutes * 60000 };
}

export function canTransitionContent(content, to) {
  const from = content?.state;
  if (FORWARD.get(from) !== to) return { ok: false, reason: 'invalid_transition' };
  const required = {
    needs_review: ['assetId', 'sourceHash', 'sourcePath', 'pillar'],
    approved: ['privacyCleared', 'rightsConfirmed', 'musicRightsConfirmed', 'subjectApproved', 'brandApproved', 'previouslyPosted', 'approver', 'approvedAt', 'finalCaption'],
    optimized: ['derivativePath', 'derivativeHash', 'specId'], uploaded: ['mediaId', 'mediaUrl', 'accountId'],
    scheduled: ['postId', 'scheduledAt', 'idempotencyKey', 'acceptedStatus'], published: ['publishedAt', 'remoteStatus']
  }[to] || [];
  if (to === 'approved' && content.previouslyPosted !== false) return { ok: false, reason: 'previously_posted_unknown_or_true' };
  if (to === 'approved' && content.offerExpiration && (!content.offerApproved || new Date(content.offerExpiration).valueOf() <= Date.now())) return { ok: false, reason: 'offer_unapproved_or_expired' };
  if (to === 'uploaded' && content.uncertainWrite) return { ok: false, reason: 'uncertain_write' };
  const missing = required.filter((key) => {
    if (key === 'previouslyPosted') return content[key] !== false;
    return content[key] === undefined || content[key] === null || content[key] === '' || content[key] === false;
  });
  return missing.length ? { ok: false, reason: 'missing_guard_fields', missing } : { ok: true };
}

export function buildUtm({ source, contentId, placement, date = new Date() }) {
  if (!['google', 'instagram', 'facebook'].includes(source)) throw new TypeError('unsupported source');
  if (!contentId || !placement) throw new TypeError('contentId and placement are required');
  const yyyymm = date.toISOString().slice(0, 7).replace('-', '');
  return new URLSearchParams({ utm_source: source, utm_medium: source === 'google' ? 'organic_local' : 'organic_social', utm_campaign: `${GROWTH_CLIENT.code.toLowerCase()}_organic_${yyyymm}`, utm_content: `${contentId}-${placement}` }).toString();
}

export function automationHealth({ connections = {}, lastWebhookAt, lastPublishAt, lastReviewAt, now = Date.now(), staleMinutes = 60 }) {
  const fresh = (at) => Boolean(at) && Number(now) - new Date(at).valueOf() <= staleMinutes * 60000;
  return { healthy: Object.values(connections).every(Boolean), connections, webhookFresh: fresh(lastWebhookAt), publishingFresh: fresh(lastPublishAt), reviewFresh: fresh(lastReviewAt), checkedAt: new Date(now).toISOString() };
}
