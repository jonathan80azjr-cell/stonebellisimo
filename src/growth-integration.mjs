import { json } from './lead-automation.mjs';
import { normalizeHighLevelEvent, verifyHighLevelSignature } from './growth-automation.mjs';
import { normalizeSocialInquiry } from './growth-store.mjs';

const BODY_LIMIT = 64 * 1024;

function configuredAccountIds(env = {}) {
  return [
    env.HIGHLEVEL_GBP_ACCOUNT_ID,
    env.HIGHLEVEL_INSTAGRAM_ACCOUNT_ID,
    env.HIGHLEVEL_FACEBOOK_ACCOUNT_ID,
    env.HIGHLEVEL_INSTAGRAM_MESSAGING_ACCOUNT_ID,
    env.HIGHLEVEL_FACEBOOK_MESSAGING_ACCOUNT_ID
  ].map(value => String(value || '').trim()).filter(Boolean);
}

function header(request, ...names) {
  for (const name of names) {
    const value = request.headers.get(name);
    if (value) return value;
  }
  return '';
}

function resultResponse(result) {
  if (result?.missing) return json({ success: false, message: 'Referenced canonical record was not found.' }, 404);
  return json({ success: true, duplicate: result?.duplicate === true });
}

export async function handleHighLevelEvents(request, env = {}, options = {}) {
  if (request.method !== 'POST') return json({ success: false, message: 'Method not allowed.' }, 405, { allow: 'POST' });
  if (!options.growthStore) return json({ success: false, message: 'Growth automation store is not configured.' }, 503);
  const locationId = String(env.HIGHLEVEL_LOCATION_ID || '').trim();
  const accountIds = configuredAccountIds(env);
  const secret = String(env.HIGHLEVEL_WEBHOOK_SECRET || '');
  if (!locationId || !accountIds.length || !secret) {
    return json({ success: false, message: 'HighLevel integration is not configured.' }, 503);
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > BODY_LIMIT) return json({ success: false, message: 'Request body is too large.' }, 413);
  const rawBuffer = Buffer.from(await request.arrayBuffer());
  if (!rawBuffer.length || rawBuffer.length > BODY_LIMIT) return json({ success: false, message: 'Request body is invalid.' }, rawBuffer.length > BODY_LIMIT ? 413 : 400);
  const rawBody = rawBuffer.toString('utf8');
  const signature = header(request, 'x-highlevel-signature', 'x-signature');
  const timestamp = header(request, 'x-highlevel-timestamp', 'x-signature-timestamp');
  if (!verifyHighLevelSignature({ rawBody, signature, timestamp, secret })) {
    return json({ success: false, message: 'Invalid webhook signature.' }, 401);
  }

  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { return json({ success: false, message: 'Request body must be valid JSON.' }, 400); }
  const normalized = normalizeHighLevelEvent(payload, { locationId, accountIds });
  if (normalized.error === 'wrong_location' || normalized.error === 'wrong_account') {
    return json({ success: false, message: 'Webhook target does not match the configured client.' }, 403);
  }
  if (normalized.error) return json({ success: false, message: 'Unsupported HighLevel event.' }, 400);
  const event = normalized.event;
  event.inquiryDocumentId = event.inquiryId?.includes(':')
    ? event.inquiryId
    : `${event.platform || ''}:${event.inquiryId || event.conversationId || event.commentId || ''}`;

  try {
    if (event.type === 'social_inquiry') {
      const controls = options.growthStore.getControls ? await options.growthStore.getControls() : {};
      if ((controls.disconnectedPlatforms || []).includes(event.platform)) {
        return json({ success: false, message: 'The affected platform is disabled by the L3 kill switch.' }, 503);
      }
      const inquiry = normalizeSocialInquiry({
        platform: event.platform,
        accountId: event.accountId,
        remoteInquiryId: event.inquiryId || event.conversationId || event.commentId,
        remoteContactId: event.contactId,
        sourcePostId: event.postId,
        contentId: event.contentId,
        category: event.category,
        projectType: event.projectType,
        material: event.material,
        city: event.city,
        postalCode: event.postalCode,
        timeframe: event.timeframe,
        usableContactMethod: event.usableContactMethod,
        consentState: event.consentStatus || 'not_requested',
        consentVersion: event.consentVersion,
        consentRecordedAt: event.consentRecordedAt,
        highLevelContactId: event.contactId,
        highLevelOpportunityId: event.opportunityId,
        createdAt: event.occurredAt
      });
      return resultResponse(await options.growthStore.recordInquiryEvent(normalized.id, inquiry));
    }
    if (event.type === 'consent') return resultResponse(await options.growthStore.recordConsentEvent(normalized.id, event));
    if (event.type === 'claim') return resultResponse(await options.growthStore.recordClaimEvent(normalized.id, event));
    if (event.type === 'qualification') {
      if (event.qualified !== true) return json({ success: false, message: 'Qualification must be explicitly staff-confirmed.' }, 400);
      return resultResponse(await options.growthStore.recordQualificationEvent(normalized.id, event));
    }
    if (event.type === 'estimate_scheduled' || event.type === 'outcome') {
      return resultResponse(await options.growthStore.recordOutcomeEvent(normalized.id, event));
    }
    return json({ success: false, message: 'Unsupported HighLevel event.' }, 400);
  } catch (error) {
    return json({ success: false, message: error?.message || 'HighLevel event could not be applied.' }, 400);
  }
}

export const HIGHLEVEL_EVENT_BODY_LIMIT = BODY_LIMIT;
