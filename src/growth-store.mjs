import { createHash, randomUUID } from 'node:crypto';
import { GROWTH_CLIENT } from './growth-client-config.mjs';
import { deterministicIdentityLeadId, leadIdentityKeys } from './lead-identity.mjs';

const CONTENT_STATUSES = Object.freeze([
  'discovered',
  'needs_review',
  'approved',
  'optimized',
  'uploaded',
  'scheduled',
  'published'
]);

const CONTENT_TRANSITIONS = Object.freeze({
  discovered: new Set(['needs_review']),
  needs_review: new Set(['approved']),
  approved: new Set(['optimized']),
  optimized: new Set(['uploaded']),
  uploaded: new Set(['scheduled']),
  scheduled: new Set(['published']),
  published: new Set()
});

const INQUIRY_CATEGORIES = new Set([
  'estimate_intent',
  'material_question',
  'showroom_hours',
  'service_area',
  'compliment',
  'existing_customer_issue',
  'complaint',
  'spam',
  'safety_urgent'
]);

const PLATFORMS = new Set(['instagram', 'facebook']);
const CONTENT_PILLARS = new Set(['project_reveal', 'process', 'material_education', 'local_faq', 'testimonial_offer']);
const CHANNELS = new Set(['google', 'instagram', 'facebook']);
const CONSENT_STATES = new Set(['not_requested', 'requested', 'granted', 'declined', 'revoked']);
const SENSITIVE_EVENT_KEYS = new Set([
  'body', 'message', 'messageBody', 'rawMessage', 'text', 'transcript', 'fullAddress', 'streetAddress'
]);

const COLLECTIONS = Object.freeze({
  socialContent: 'social_content',
  socialInquiries: 'social_inquiries',
  reviewRequests: 'review_requests',
  automationHealth: 'automation_health',
  integrationEvents: 'integration_events',
  automationAudit: 'automation_audit',
  automationControls: 'automation_controls',
  automationTasks: 'automation_tasks',
  leads: 'leads'
});

const SALES_STAGES = Object.freeze([...GROWTH_CLIENT.stages]);

function cleanText(value, limit = 180) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, limit);
}

function cleanId(value, limit = 160) {
  const normalized = cleanText(value, limit);
  if (!normalized || !/^[A-Za-z0-9._:@-]+$/.test(normalized)) return '';
  return normalized;
}

function cleanIso(value, required = false) {
  if (!value) {
    if (required) throw new Error('A date is required.');
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Choose a valid date.');
  return parsed.toISOString();
}

function cleanBoolean(value) {
  return value === true;
}

function rows(snapshot) {
  return snapshot.docs.map(document => ({ ...document.data(), id: document.id }));
}

function newestFirst(left, right) {
  return String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || ''));
}

function inquiryDocumentId(event = {}) {
  const supplied = cleanId(event.inquiryDocumentId || event.inquiryId, 180);
  if (supplied.includes(':')) return supplied;
  const platform = cleanText(event.platform, 30).toLowerCase();
  return platform && supplied ? `${platform}:${supplied}` : '';
}

export function contentTransitionAllowed(from, to) {
  return Boolean(CONTENT_TRANSITIONS[from]?.has(to));
}

export function validateContentApproval(content) {
  const errors = [];
  if (!content.rightsApproved) errors.push('Media rights approval is required.');
  if (!content.privacyCleared) errors.push('Customer privacy clearance is required.');
  if (!['new', 'not_posted', 'approved_reuse'].includes(content.priorPostStatus)) {
    errors.push('Prior-post status must be reviewed.');
  }
  if (content.contentPillar === 'testimonial_offer' && content.includesOffer && !content.offerApproved) {
    errors.push('An offer must be approved before this item advances.');
  }
  if (content.offerExpiresAt && new Date(content.offerExpiresAt).getTime() <= Date.now()) {
    errors.push('Expired offers cannot advance.');
  }
  return errors;
}

export function contentRemoteTransitionErrors(content, nextStatus) {
  if (!['scheduled', 'published'].includes(nextStatus)) return [];
  const errors = [];
  for (const channel of CHANNELS) {
    const channelPackage = content.channelPackages?.[channel];
    const allowedStatus = nextStatus === 'published' ? ['published'] : ['scheduled', 'published'];
    if (!channelPackage?.remotePostId || !channelPackage.remoteAccountId || !channelPackage.idempotencyKey ||
      channelPackage.uncertainWrite === true || !allowedStatus.includes(channelPackage.remoteStatus) || !channelPackage.remoteReadAt) {
      errors.push(`${channel} requires an exact-account ${nextStatus} readback.`);
    }
  }
  return errors;
}

export function monthlyContentReadiness(items = []) {
  const minimums = GROWTH_CLIENT.publishing.minimum_monthly_media;
  const minimumMix = GROWTH_CLIENT.publishing.minimum_monthly_mix;
  const eligible = items.filter(item => item.rightsApproved === true && item.privacyCleared === true);
  const assets = eligible.flatMap(item => item.assets || []);
  const photos = assets.filter(asset => String(asset.mimeType || '').startsWith('image/')).length;
  const verticalClips = assets.filter(asset => String(asset.mimeType || '').startsWith('video/') && asset.verticalApproved === true).length;
  const projects = new Set(eligible.map(item => item.projectId).filter(Boolean)).size;
  const counts = { packages: eligible.length, photos, verticalClips, projects };
  const mix = Object.fromEntries(Object.keys(minimumMix).map(pillar => [
    pillar,
    eligible.filter(item => item.contentPillar === pillar).length
  ]));
  const errors = [];
  if (counts.packages < minimums.content_packages) errors.push(`${minimums.content_packages} rights-cleared content packages are required.`);
  if (photos < minimums.usable_project_photos) errors.push(`${minimums.usable_project_photos} usable project photos are required.`);
  if (verticalClips < minimums.vertical_clips) errors.push(`${minimums.vertical_clips} owner-verified vertical clips are required.`);
  for (const [pillar, minimum] of Object.entries(minimumMix)) {
    if (mix[pillar] < minimum) errors.push(`${minimum} ${pillar.replaceAll('_', ' ')} package${minimum === 1 ? '' : 's'} are required.`);
  }
  return {
    ready: errors.length === 0,
    errors,
    warnings: projects < minimums.projects_where_possible
      ? [`Only ${projects} project${projects === 1 ? '' : 's'} represented; target ${minimums.projects_where_possible} where possible.`]
      : [],
    counts,
    mix,
    minimums: { ...minimums },
    minimumMix: { ...minimumMix }
  };
}

export function normalizeContentManifest(input = {}, now = new Date().toISOString()) {
  const contentPillar = cleanText(input.contentPillar, 40);
  if (!CONTENT_PILLARS.has(contentPillar)) throw new Error('Choose a valid content pillar.');
  const month = cleanText(input.month, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Choose a valid content month.');
  const includesOffer = cleanBoolean(input.includesOffer);
  const offerExpiresAt = input.offerExpiresAt ? cleanIso(input.offerExpiresAt) : null;
  if (includesOffer && !offerExpiresAt) throw new Error('Offers require an expiration date.');

  return {
    clientCode: GROWTH_CLIENT.code,
    program: GROWTH_CLIENT.programCode,
    month,
    projectId: cleanId(input.projectId, 120),
    sourceType: cleanText(input.sourceType || 'owner_project_media', 40),
    material: cleanText(input.material, 120),
    projectType: cleanText(input.projectType, 120),
    city: cleanText(input.city, 100),
    contentPillar,
    rightsApproved: cleanBoolean(input.rightsApproved),
    privacyCleared: cleanBoolean(input.privacyCleared),
    priorPostStatus: cleanText(input.priorPostStatus, 30),
    includesOffer,
    offerApproved: includesOffer ? cleanBoolean(input.offerApproved) : false,
    offerExpiresAt,
    notes: cleanText(input.notes, 1000),
    status: 'discovered',
    assets: [],
    channelPackages: {},
    version: 1,
    createdAt: now,
    updatedAt: now
  };
}

export function normalizeSocialInquiry(input = {}, now = new Date().toISOString()) {
  for (const key of SENSITIVE_EVENT_KEYS) {
    if (input[key]) throw new Error(`Structured inquiry events must not include ${key}.`);
  }
  const platform = cleanText(input.platform, 30).toLowerCase();
  if (!PLATFORMS.has(platform)) throw new Error('Unsupported inquiry platform.');
  const category = cleanText(input.category, 50);
  if (!INQUIRY_CATEGORIES.has(category)) throw new Error('Unsupported inquiry category.');
  const accountId = cleanId(input.accountId);
  const remoteInquiryId = cleanId(input.remoteInquiryId);
  if (!accountId || !remoteInquiryId) throw new Error('Account and inquiry IDs are required.');
  const consentState = cleanText(input.consentState || 'not_requested', 30);
  if (!CONSENT_STATES.has(consentState)) throw new Error('Unsupported consent state.');

  return {
    clientCode: GROWTH_CLIENT.code,
    program: GROWTH_CLIENT.programCode,
    platform,
    accountId,
    remoteInquiryId,
    remoteContactId: cleanId(input.remoteContactId),
    sourcePostId: cleanId(input.sourcePostId),
    contentId: cleanId(input.contentId),
    category,
    projectType: cleanText(input.projectType, 120),
    material: cleanText(input.material, 120),
    city: cleanText(input.city, 100),
    postalCode: cleanText(input.postalCode, 16),
    timeframe: cleanText(input.timeframe, 80),
    consentState,
    consentVersion: cleanText(input.consentVersion, 80),
    consentRecordedAt: consentState === 'granted' ? cleanIso(input.consentRecordedAt || now, true) : null,
    usableContactMethod: cleanText(input.usableContactMethod, 30),
    highLevelContactId: cleanId(input.highLevelContactId),
    highLevelOpportunityId: cleanId(input.highLevelOpportunityId),
    status: ['open', 'claimed', 'qualified', 'closed'].includes(input.status) ? input.status : 'open',
    createdAt: cleanIso(input.createdAt || now, true),
    updatedAt: now
  };
}

export function qualificationErrors(input = {}) {
  const errors = [];
  if (!input.serviceFit) errors.push('Service fit is not confirmed.');
  if (!input.serviceAreaFit) errors.push('Service area is not confirmed.');
  if (!input.genuineProjectIntent) errors.push('Genuine project intent is not confirmed.');
  if (!cleanText(input.usableContactMethod, 30)) errors.push('A usable contact method is required.');
  if (input.consentState !== 'granted') errors.push('Contact consent is required.');
  if (!cleanText(input.consentVersion, 80)) errors.push('The approved consent wording version is required.');
  return errors;
}

export function buildTrackedUrl(destination, { source, medium, campaign, content }) {
  const url = new URL(destination);
  const allowedSource = ['google', 'instagram', 'facebook'].includes(source) ? source : '';
  const allowedMedium = ['organic_local', 'organic_social'].includes(medium) ? medium : '';
  if (!allowedSource || !allowedMedium) throw new Error('Choose a supported UTM source and medium.');
  if (!/^sb_organic_\d{6}$/.test(campaign || '')) throw new Error('Campaign must use sb_organic_YYYYMM.');
  const normalizedContent = cleanId(content, 180).toLowerCase();
  if (!normalizedContent) throw new Error('A content and placement identifier is required.');
  url.searchParams.set('utm_source', allowedSource);
  url.searchParams.set('utm_medium', allowedMedium);
  url.searchParams.set('utm_campaign', campaign);
  url.searchParams.set('utm_content', normalizedContent);
  return url.toString();
}

export function containsPhoneNumber(value) {
  return /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/.test(String(value || ''));
}

export function createGrowthStore(db) {
  if (!db) throw new Error('Firestore is not configured.');
  const content = db.collection(COLLECTIONS.socialContent);
  const inquiries = db.collection(COLLECTIONS.socialInquiries);
  const integrationEvents = db.collection(COLLECTIONS.integrationEvents);
  const health = db.collection(COLLECTIONS.automationHealth);
  const audit = db.collection(COLLECTIONS.automationAudit);
  const controls = db.collection(COLLECTIONS.automationControls);
  const tasks = db.collection(COLLECTIONS.automationTasks);
  const leads = db.collection(COLLECTIONS.leads);

  return {
    async createContentManifest(manifest, actor = '') {
      const reference = content.doc();
      const value = { ...manifest, id: reference.id, createdBy: cleanText(actor, 200) };
      await reference.create(value);
      return value;
    },

    async getContent(id) {
      const snapshot = await content.doc(id).get();
      return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
    },

    async listContent({ month = '', status = '', limit = 100 } = {}) {
      let query = content;
      if (month) query = query.where('month', '==', month);
      if (status) query = query.where('status', '==', status);
      const snapshot = await query.limit(Math.min(Math.max(Number(limit) || 100, 1), 250)).get();
      return rows(snapshot).sort(newestFirst);
    },

    async addContentAsset(id, asset, actor = '') {
      const reference = content.doc(id);
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) return null;
        const current = snapshot.data();
        if (!['discovered', 'needs_review', 'approved'].includes(current.status)) {
          throw new Error('Assets cannot be changed after upload reconciliation begins.');
        }
        const assets = [...(current.assets || []), asset];
        const now = new Date().toISOString();
        transaction.update(reference, { assets, version: Number(current.version || 0) + 1, updatedAt: now });
        transaction.create(audit.doc(), { type: 'content_asset_added', contentId: id, actor: cleanText(actor, 200), assetId: asset.id, createdAt: now });
        return { ...current, assets, id, updatedAt: now };
      });
    },

    async transitionContent(id, nextStatus, actor = '', evidence = {}) {
      if (!CONTENT_STATUSES.includes(nextStatus)) throw new Error('Unsupported content status.');
      const reference = content.doc(id);
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) return null;
        const current = snapshot.data();
        if (!contentTransitionAllowed(current.status, nextStatus)) {
          throw new Error(`Content cannot move from ${current.status} to ${nextStatus}.`);
        }
        if (nextStatus === 'approved') {
          const errors = validateContentApproval(current);
          if (errors.length) throw new Error(errors.join(' '));
        }
        if (nextStatus === 'uploaded' && !(current.assets || []).length) {
          throw new Error('At least one uploaded asset is required.');
        }
        if (nextStatus === 'optimized' && (!evidence.optimizationConfirmed || !cleanText(evidence.specId, 120))) {
          throw new Error('Optimization confirmation and a specification ID are required.');
        }
        const remoteErrors = contentRemoteTransitionErrors(current, nextStatus);
        if (remoteErrors.length) throw new Error(remoteErrors.join(' '));
        const now = new Date().toISOString();
        const update = {
          status: nextStatus,
          version: Number(current.version || 0) + 1,
          updatedAt: now,
          [`${nextStatus}At`]: now,
          approvalEvidence: nextStatus === 'approved' ? {
            actor: cleanText(actor, 200),
            recordedAt: now,
            rightsApproved: current.rightsApproved === true,
            privacyCleared: current.privacyCleared === true,
            offerApproved: current.includesOffer ? current.offerApproved === true : null,
            note: cleanText(evidence.note, 500)
          } : current.approvalEvidence || null,
          optimizationEvidence: nextStatus === 'optimized' ? {
            actor: cleanText(actor, 200), recordedAt: now, specId: cleanText(evidence.specId, 120),
            note: cleanText(evidence.note, 500)
          } : current.optimizationEvidence || null
        };
        transaction.update(reference, update);
        transaction.create(audit.doc(), {
          type: 'content_transition', contentId: id, from: current.status, to: nextStatus,
          actor: cleanText(actor, 200), createdAt: now
        });
        return { ...current, ...update, id };
      });
    },

    async updateChannelPackage(id, channel, channelPackage, actor = '') {
      if (!CHANNELS.has(channel)) throw new Error('Unsupported publishing channel.');
      const reference = content.doc(id);
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) return null;
        const current = snapshot.data();
        const existing = current.channelPackages?.[channel] || {};
        if (existing.remotePostId || existing.uncertainWrite) throw new Error('A reconciled or uncertain remote package cannot be edited.');
        const now = new Date().toISOString();
        const postType = ['post', 'reel', 'story'].includes(channelPackage.postType) ? channelPackage.postType : 'post';
        const caption = cleanText(channelPackage.caption, 4000);
        if (channel === 'google' && containsPhoneNumber(caption)) {
          throw new Error('Google post copy cannot contain a phone number; use the verified action button.');
        }
        let trackedUrl = '';
        if (channelPackage.trackedUrl) {
          const parsed = new URL(channelPackage.trackedUrl);
          const expectedMedium = channel === 'google' ? 'organic_local' : 'organic_social';
          if (parsed.protocol !== 'https:' || parsed.searchParams.get('utm_source') !== channel || parsed.searchParams.get('utm_medium') !== expectedMedium ||
            !/^sb_organic_\d{6}$/.test(parsed.searchParams.get('utm_campaign') || '') || !parsed.searchParams.get('utm_content')) {
            throw new Error('Tracked URL does not match the required channel UTM contract.');
          }
          trackedUrl = parsed.toString();
        }
        const approved = channelPackage.approve === true;
        const packages = { ...(current.channelPackages || {}), [channel]: {
          caption,
          captionVersion: cleanText(channelPackage.captionVersion || 'v1', 40),
          postType,
          trackedUrl,
          actionType: ['BOOK', 'LEARN_MORE', 'CALL'].includes(channelPackage.actionType) ? channelPackage.actionType : 'LEARN_MORE',
          remoteAccountId: existing.remoteAccountId || '',
          remotePostId: existing.remotePostId || '',
          status: approved ? 'ready_for_review' : 'draft',
          scheduledAt: channelPackage.scheduledAt ? cleanIso(channelPackage.scheduledAt) : null,
          approvedBy: approved ? cleanText(actor, 200) : null,
          approvedAt: approved ? now : null,
          updatedAt: now
        } };
        transaction.update(reference, { channelPackages: packages, version: Number(current.version || 0) + 1, updatedAt: now });
        transaction.create(audit.doc(), { type: 'channel_package_updated', contentId: id, channel, actor: cleanText(actor, 200), createdAt: now });
        return { ...current, channelPackages: packages, updatedAt: now, id };
      });
    },

    async recordInquiryEvent(eventId, inquiry) {
      const safeEventId = cleanId(eventId, 180);
      if (!safeEventId) throw new Error('A stable event ID is required.');
      const eventReference = integrationEvents.doc(safeEventId);
      const inquiryReference = inquiries.doc(`${inquiry.platform}:${inquiry.remoteInquiryId}`);
      return db.runTransaction(async transaction => {
        const eventSnapshot = await transaction.get(eventReference);
        if (eventSnapshot.exists) return { duplicate: true, inquiry: null };
        const inquirySnapshot = await transaction.get(inquiryReference);
        const current = inquirySnapshot.exists ? inquirySnapshot.data() : {};
        const createdAt = current.createdAt || inquiry.createdAt;
        const saved = {
          ...current,
          ...inquiry,
          id: inquiryReference.id,
          createdAt,
          // A subsequent comment/DM event may enrich structured metadata, but
          // must never reopen a claimed conversation or clear consent/DND.
          status: ['claimed', 'qualified', 'closed'].includes(current.status) ? current.status : inquiry.status,
          claimedBy: current.claimedBy || inquiry.claimedBy || '',
          claimedAt: current.claimedAt || inquiry.claimedAt || null,
          consentState: current.consentState || inquiry.consentState,
          consentVersion: current.consentVersion || inquiry.consentVersion,
          consentRecordedAt: current.consentRecordedAt || inquiry.consentRecordedAt,
          optedOutAt: current.optedOutAt || inquiry.optedOutAt || null,
          dnd: current.dnd === true || inquiry.dnd === true
        };
        transaction.create(eventReference, { id: safeEventId, type: 'social_inquiry', receivedAt: new Date().toISOString() });
        transaction.set(inquiryReference, saved, { merge: true });
        return { duplicate: false, inquiry: saved };
      });
    },

    async getInquiry(id) {
      const snapshot = await inquiries.doc(id).get();
      return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
    },

    async recordConsentEvent(eventId, event) {
      const safeEventId = cleanId(eventId, 180);
      const id = inquiryDocumentId(event);
      if (!safeEventId || !id) throw new Error('Stable event and inquiry IDs are required.');
      const eventReference = integrationEvents.doc(safeEventId);
      const reference = inquiries.doc(id);
      return db.runTransaction(async transaction => {
        const [eventSnapshot, inquirySnapshot] = await Promise.all([transaction.get(eventReference), transaction.get(reference)]);
        if (eventSnapshot.exists) return { duplicate: true, inquiry: inquirySnapshot.exists ? { ...inquirySnapshot.data(), id } : null };
        if (!inquirySnapshot.exists) return { missing: true, inquiry: null };
        const current = inquirySnapshot.data();
        const linkedLeadReference = current.firebaseLeadId ? leads.doc(current.firebaseLeadId) : null;
        const linkedLeadSnapshot = linkedLeadReference ? await transaction.get(linkedLeadReference) : null;
        const consentState = cleanText(event.consentStatus, 30);
        if (!CONSENT_STATES.has(consentState)) throw new Error('Unsupported consent state.');
        const humanOverride = event.humanOverride === true && cleanText(event.claimedBy, 200);
        if (current.dnd === true && consentState === 'granted' && !humanOverride) {
          throw new Error('An opted-out inquiry can only be restored by a named human.');
        }
        const now = cleanIso(event.occurredAt || new Date().toISOString(), true);
        const update = {
          consentState,
          consentVersion: cleanText(event.consentVersion, 80),
          consentRecordedAt: now,
          updatedAt: now
        };
        if (['declined', 'revoked'].includes(consentState)) {
          update.optedOutAt = current.optedOutAt || now;
          update.dnd = true;
        }
        if (consentState === 'granted' && humanOverride) {
          update.dnd = false;
          update.consentRestoredAt = now;
          update.consentRestoredBy = cleanText(event.claimedBy, 200);
        }
        transaction.create(eventReference, { id: safeEventId, type: 'consent', inquiryId: id, receivedAt: now });
        transaction.update(reference, update);
        if (linkedLeadSnapshot?.exists) {
          const linkedLead = linkedLeadSnapshot.data();
          const leadUpdate = {
            consentState,
            consentVersion: update.consentVersion,
            consentRecordedAt: now,
            updatedAt: now
          };
          if (['declined', 'revoked'].includes(consentState)) {
            leadUpdate.optedOutAt = linkedLead.optedOutAt || now;
            leadUpdate.dnd = true;
          }
          if (consentState === 'granted' && humanOverride) {
            leadUpdate.dnd = false;
            leadUpdate.consentRestoredAt = now;
            leadUpdate.consentRestoredBy = update.consentRestoredBy;
          }
          transaction.update(linkedLeadReference, leadUpdate);
        }
        return { duplicate: false, inquiry: { ...current, ...update, id } };
      });
    },

    async recordHumanConsentEvent(id, consentVersion, actor) {
      const version = cleanText(consentVersion, 80);
      const human = cleanText(actor, 200);
      if (!version || !human) throw new Error('A named human and approved consent wording version are required.');
      // A fresh affirmative consent is a new audit fact even when the owner
      // uses the same approved wording version after a later opt-out.
      const eventId = `admin_consent_${randomUUID()}`;
      return this.recordConsentEvent(eventId, {
        inquiryDocumentId: id,
        consentStatus: 'granted',
        consentVersion: version,
        occurredAt: new Date().toISOString(),
        humanOverride: true,
        claimedBy: human
      });
    },

    async recordClaimEvent(eventId, event) {
      const safeEventId = cleanId(eventId, 180);
      const id = inquiryDocumentId(event);
      if (!safeEventId || !id) throw new Error('Stable event and inquiry IDs are required.');
      const eventReference = integrationEvents.doc(safeEventId);
      const reference = inquiries.doc(id);
      return db.runTransaction(async transaction => {
        const [eventSnapshot, inquirySnapshot] = await Promise.all([transaction.get(eventReference), transaction.get(reference)]);
        if (eventSnapshot.exists) return { duplicate: true, inquiry: inquirySnapshot.exists ? { ...inquirySnapshot.data(), id } : null };
        if (!inquirySnapshot.exists) return { missing: true, inquiry: null };
        const current = inquirySnapshot.data();
        const now = cleanIso(event.occurredAt || new Date().toISOString(), true);
        const update = current.claimedAt ? {} : {
          status: 'claimed',
          claimedBy: cleanText(event.claimedBy, 200),
          claimedAt: now,
          updatedAt: now
        };
        transaction.create(eventReference, { id: safeEventId, type: 'claim', inquiryId: id, receivedAt: now });
        if (Object.keys(update).length) transaction.update(reference, update);
        return { duplicate: false, inquiry: { ...current, ...update, id } };
      });
    },

    async recordQualificationEvent(eventId, event) {
      const safeEventId = cleanId(eventId, 180);
      const inquiryId = inquiryDocumentId(event);
      if (!safeEventId || !inquiryId) throw new Error('Stable event and inquiry IDs are required.');
      const eventReference = integrationEvents.doc(safeEventId);
      const inquiryReference = inquiries.doc(inquiryId);
      return db.runTransaction(async transaction => {
        const [eventSnapshot, inquirySnapshot] = await Promise.all([transaction.get(eventReference), transaction.get(inquiryReference)]);
        if (eventSnapshot.exists) return { duplicate: true, inquiry: inquirySnapshot.exists ? { ...inquirySnapshot.data(), id: inquiryId } : null };
        if (!inquirySnapshot.exists) return { missing: true, inquiry: null };
        const current = inquirySnapshot.data();
        const evidence = {
          serviceFit: event.serviceFit === true,
          serviceAreaFit: event.serviceAreaFit === true,
          genuineProjectIntent: event.genuineProjectIntent === true,
          usableContactMethod: cleanText(event.usableContactMethod || current.usableContactMethod, 30),
          consentState: current.consentState,
          consentVersion: current.consentVersion,
          version: event.qualificationVersion || GROWTH_CLIENT.programCode
        };
        if (current.dnd === true) throw new Error('Opted-out inquiries cannot be qualified.');
        if (!current.consentRecordedAt) throw new Error('A recorded consent event is required before qualification.');
        const errors = qualificationErrors(evidence);
        if (errors.length) throw new Error(errors.join(' '));
        const now = cleanIso(event.occurredAt || new Date().toISOString(), true);
        const platformIdentity = current.remoteContactId
          ? `${current.platform}:${current.accountId}:${current.remoteContactId}`
          : inquiryId;
        const requestedLeadId = cleanId(event.firebaseLeadId, 180) || current.firebaseLeadId || '';
        const identities = leadIdentityKeys({
          email: event.email,
          phone: event.phone,
          lastName: event.lastName,
          platform: current.platform,
          accountId: current.accountId,
          remoteContactId: current.remoteContactId
        });
        const identityReferences = identities.map(identity => db.collection('lead_identities').doc(identity.id));
        const identitySnapshots = identityReferences.length ? await transaction.getAll(...identityReferences) : [];
        const mappedLeadIds = [...new Set(identitySnapshots.filter(snapshot => snapshot.exists).map(snapshot => snapshot.data().leadId).filter(Boolean))];
        if (mappedLeadIds.length > 1 || (requestedLeadId && mappedLeadIds.some(id => id !== requestedLeadId))) {
          throw new Error('Lead identity conflict requires staff reconciliation.');
        }
        const leadId = requestedLeadId || mappedLeadIds[0] || deterministicIdentityLeadId(platformIdentity);
        const leadReference = leads.doc(leadId);
        const leadSnapshot = await transaction.get(leadReference);
        const existingLead = leadSnapshot.exists ? leadSnapshot.data() : {};
        if (existingLead.dnd === true) throw new Error('A cross-channel opted-out lead cannot be qualified.');
        const qualifiedAt = current.qualifiedAt || now;
        const inquiryUpdate = {
          status: 'qualified',
          qualifiedAt,
          assignedTo: GROWTH_CLIENT.salesHandoffOwner,
          firebaseLeadId: leadId,
          highLevelContactId: cleanId(event.contactId, 160) || current.highLevelContactId || '',
          highLevelOpportunityId: cleanId(event.opportunityId, 160) || current.highLevelOpportunityId || '',
          usableContactMethod: evidence.usableContactMethod,
          serviceFit: true,
          serviceAreaFit: true,
          genuineProjectIntent: true,
          updatedAt: now,
          qualification: {
            ...evidence,
            consentState: 'granted',
            confirmedBy: cleanText(event.claimedBy, 200),
            confirmedAt: qualifiedAt
          }
        };
        const name = [cleanText(event.firstName, 80), cleanText(event.lastName, 80)].filter(Boolean).join(' ');
        const lead = {
          ...existingLead,
          id: leadId,
          firstName: cleanText(event.firstName, 80) || existingLead.firstName || '',
          lastName: cleanText(event.lastName, 80) || existingLead.lastName || '',
          customerName: name || existingLead.customerName || 'Social inquiry',
          email: cleanText(event.email, 240).toLowerCase() || existingLead.email || '',
          phone: cleanText(event.phone, 40) || existingLead.phone || '',
          projectType: cleanText(event.projectType, 120) || current.projectType || existingLead.projectType || 'Not specified',
          material: cleanText(event.material, 120) || current.material || existingLead.material || 'Not specified',
          source: existingLead.source || `${current.platform === 'facebook' ? 'Facebook' : 'Instagram'} inquiry`,
          message: existingLead.message || '',
          submittedAt: existingLead.submittedAt || current.createdAt || now,
          businessStatus: existingLead.businessStatus || 'new',
          salesStatus: 'Qualified',
          stageTimestamps: { ...(existingLead.stageTimestamps || {}), newLeadAt: existingLead.stageTimestamps?.newLeadAt || current.createdAt || now, qualifiedAt },
          qualificationVersion: evidence.version,
          outcomeVersion: GROWTH_CLIENT.programCode,
          highLevelContactId: inquiryUpdate.highLevelContactId,
          highLevelOpportunityId: inquiryUpdate.highLevelOpportunityId,
          sourcePlatform: existingLead.sourcePlatform || current.platform,
          sourceAccountId: existingLead.sourceAccountId || current.accountId,
          sourcePostId: existingLead.sourcePostId || current.sourcePostId || '',
          sourceContentId: existingLead.sourceContentId || current.contentId || '',
          consentState: 'granted',
          consentVersion: evidence.consentVersion,
          consentRecordedAt: current.consentRecordedAt || now,
          dnd: existingLead.dnd === true,
          firstTouch: existingLead.firstTouch || { platform: current.platform, accountId: current.accountId, postId: current.sourcePostId || '', contentId: current.contentId || '', at: current.createdAt || now },
          lastTouch: { platform: current.platform, accountId: current.accountId, postId: current.sourcePostId || '', contentId: current.contentId || '', at: now },
          sourceHistory: [
            ...(existingLead.sourceHistory || []),
            { source: current.platform, accountId: current.accountId, postId: current.sourcePostId || '', contentId: current.contentId || '', at: now }
          ],
          createdAt: existingLead.createdAt || now,
          updatedAt: now
        };
        transaction.create(eventReference, { id: safeEventId, type: 'qualification', inquiryId, leadId, receivedAt: now });
        transaction.update(inquiryReference, inquiryUpdate);
        transaction.set(leadReference, lead, { merge: true });
        for (const [index, identity] of identities.entries()) {
          if (!identitySnapshots[index].exists) {
            transaction.create(identityReferences[index], { type: identity.type, leadId, createdAt: now });
          }
        }
        transaction.create(audit.doc(), { type: 'inquiry_qualified', inquiryId, leadId, actor: cleanText(event.claimedBy, 200), createdAt: now });
        return { duplicate: false, inquiry: { ...current, ...inquiryUpdate, id: inquiryId }, lead };
      });
    },

    async recordOutcomeEvent(eventId, event) {
      const safeEventId = cleanId(eventId, 180);
      const leadId = cleanId(event.firebaseLeadId, 180);
      if (!safeEventId || !leadId) throw new Error('Stable event and Firebase lead IDs are required.');
      const eventReference = integrationEvents.doc(safeEventId);
      const leadReference = leads.doc(leadId);
      return db.runTransaction(async transaction => {
        const [eventSnapshot, leadSnapshot] = await Promise.all([transaction.get(eventReference), transaction.get(leadReference)]);
        if (eventSnapshot.exists) return { duplicate: true, lead: leadSnapshot.exists ? { ...leadSnapshot.data(), id: leadId } : null };
        if (!leadSnapshot.exists) return { missing: true, lead: null };
        const current = leadSnapshot.data();
        const target = event.type === 'estimate_scheduled' ? 'Estimate Scheduled' : cleanText(event.outcome, 40);
        if (!SALES_STAGES.includes(target)) throw new Error('Unsupported outcome stage.');
        const currentStage = SALES_STAGES.includes(current.salesStatus) ? current.salesStatus : 'New Lead';
        const targetIndex = SALES_STAGES.indexOf(target);
        const currentIndex = SALES_STAGES.indexOf(currentStage);
        if (target !== 'Lost' && currentStage !== 'Lost' && targetIndex < currentIndex) throw new Error('Outcome stages cannot move backward automatically.');
        const now = cleanIso(event.occurredAt || new Date().toISOString(), true);
        const timestampField = {
          'New Lead': 'newLeadAt', Qualified: 'qualifiedAt', 'Estimate Scheduled': 'estimateScheduledAt',
          'Job Completed': 'jobCompletedAt', 'Invoice Collected': 'invoiceCollectedAt', 'Repeat / Review': 'repeatReviewAt', Lost: 'lostAt'
        }[target];
        const update = {
          salesStatus: target,
          outcomeVersion: cleanText(event.outcomeVersion || GROWTH_CLIENT.programCode, 80),
          highLevelContactId: cleanId(event.contactId, 160) || current.highLevelContactId || '',
          highLevelOpportunityId: cleanId(event.opportunityId, 160) || current.highLevelOpportunityId || '',
          stageTimestamps: { ...(current.stageTimestamps || {}), [timestampField]: current.stageTimestamps?.[timestampField] || now },
          updatedAt: now
        };
        if (target === 'Job Completed') {
          update.businessStatus = 'completed';
          update.completedAt = current.completedAt || now;
          if (!current.reviewRequestDueAt) {
            update.reviewRequestDueAt = new Date(new Date(now).getTime() + GROWTH_CLIENT.reputation.initial_request_delay_days * 24 * 60 * 60 * 1000).toISOString();
            update.reviewRequestStatus = 'pending';
            update.reviewRequestAttemptCount = 0;
            transaction.set(db.collection(COLLECTIONS.reviewRequests).doc(`${leadId}_request`), {
              id: `${leadId}_request`, leadId, kind: 'request', state: 'pending', dueAt: update.reviewRequestDueAt,
              claimedAt: null, sentAt: null, failedAt: null, leaseExpiresAt: null, createdAt: now, updatedAt: now
            }, { merge: true });
          }
        }
        transaction.create(eventReference, { id: safeEventId, type: event.type, leadId, outcome: target, receivedAt: now });
        transaction.update(leadReference, update);
        transaction.create(audit.doc(), { type: 'lead_outcome', leadId, from: currentStage, to: target, createdAt: now });
        return { duplicate: false, lead: { ...current, ...update, id: leadId } };
      });
    },

    async claimInquiry(id, actor) {
      const reference = inquiries.doc(id);
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) return null;
        const current = snapshot.data();
        if (current.claimedAt) return { ...current, id, claimAccepted: false };
        const claimedAt = new Date().toISOString();
        const update = { status: 'claimed', claimedBy: cleanText(actor, 200), claimedAt, updatedAt: claimedAt };
        transaction.update(reference, update);
        transaction.create(audit.doc(), { type: 'inquiry_claimed', inquiryId: id, actor: cleanText(actor, 200), createdAt: claimedAt });
        return { ...current, ...update, id, claimAccepted: true };
      });
    },

    async qualifyInquiry(id, evidence, actor) {
      const errors = qualificationErrors(evidence);
      if (errors.length) throw new Error(errors.join(' '));
      const reference = inquiries.doc(id);
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) return null;
        const current = snapshot.data();
        const qualifiedAt = current.qualifiedAt || new Date().toISOString();
        const update = {
          status: 'qualified', qualifiedAt, assignedTo: GROWTH_CLIENT.salesHandoffOwner, updatedAt: new Date().toISOString(),
          qualification: {
            serviceFit: true, serviceAreaFit: true, genuineProjectIntent: true,
            usableContactMethod: cleanText(evidence.usableContactMethod, 30),
            consentState: 'granted', consentVersion: cleanText(evidence.consentVersion, 80),
            confirmedBy: cleanText(actor, 200), confirmedAt: qualifiedAt,
            version: cleanText(evidence.version || GROWTH_CLIENT.programCode, 80)
          }
        };
        transaction.update(reference, update);
        transaction.create(audit.doc(), { type: 'inquiry_qualified', inquiryId: id, actor: cleanText(actor, 200), createdAt: qualifiedAt });
        return { ...current, ...update, id };
      });
    },

    async listInquiries({ status = '', limit = 100 } = {}) {
      let query = inquiries;
      if (status) query = query.where('status', '==', status);
      const snapshot = await query.limit(Math.min(Math.max(Number(limit) || 100, 1), 250)).get();
      return rows(snapshot).sort(newestFirst);
    },

    async listOpenInquiries(limit = 250) {
      const snapshot = await inquiries.where('status', 'in', ['open', 'claimed']).limit(Math.min(limit, 250)).get();
      return rows(snapshot).sort(newestFirst);
    },

    async markSlaMilestone(id, milestone, recordedAt = new Date().toISOString()) {
      if (!['reminder15', 'breach30'].includes(milestone)) throw new Error('Unsupported SLA milestone.');
      const field = milestone === 'reminder15' ? 'reminder15At' : 'slaBreachedAt';
      const reference = inquiries.doc(id);
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) return false;
        const current = snapshot.data();
        if (current.claimedAt || current[field]) return false;
        transaction.update(reference, { [field]: recordedAt, updatedAt: recordedAt });
        transaction.create(audit.doc(), { type: `sla_${milestone}`, inquiryId: id, createdAt: recordedAt });
        if (milestone === 'breach30') {
          const taskId = `sla_${createHash('sha256').update(id).digest('hex').slice(0, 32)}`;
          transaction.set(tasks.doc(taskId), {
            id: taskId, type: 'inquiry_sla_breach', inquiryId: id, status: 'overdue',
            assignedTo: [...GROWTH_CLIENT.ownerNames], dueAt: recordedAt, createdAt: recordedAt, updatedAt: recordedAt
          }, { merge: true });
        }
        return true;
      });
    },

    async reservePublishingAttempt(id, channel, reservation) {
      if (!CHANNELS.has(channel)) throw new Error('Unsupported publishing channel.');
      const reference = content.doc(id);
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) return { missing: true };
        const current = snapshot.data();
        const channelPackage = current.channelPackages?.[channel];
        if (!channelPackage) return { missing: true };
        if (channelPackage.remotePostId) return { action: 'readback', package: channelPackage };
        if (channelPackage.idempotencyKey && channelPackage.idempotencyKey !== reservation.idempotencyKey) {
          throw new Error('Publishing idempotency key changed after reservation.');
        }
        if (channelPackage.uncertainWrite && !reservation.remoteAbsenceProven) return { action: 'reconcile', package: channelPackage };
        const now = new Date().toISOString();
        const savedPackage = {
          ...channelPackage,
          idempotencyKey: reservation.idempotencyKey,
          createAttemptedAt: now,
          uncertainWrite: true,
          status: 'creating_in_review',
          updatedAt: now
        };
        transaction.update(reference, {
          [`channelPackages.${channel}`]: savedPackage,
          version: Number(current.version || 0) + 1,
          updatedAt: now
        });
        return { action: 'create', package: savedPackage };
      });
    },

    async recordPublishingReadback(id, channel, readback) {
      if (!CHANNELS.has(channel)) throw new Error('Unsupported publishing channel.');
      const reference = content.doc(id);
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) return null;
        const current = snapshot.data();
        const existing = current.channelPackages?.[channel] || {};
        const now = new Date().toISOString();
        const savedPackage = {
          ...existing,
          remotePostId: cleanId(readback.remotePostId || existing.remotePostId, 180),
          remoteAccountId: cleanId(readback.remoteAccountId || existing.remoteAccountId, 180),
          remoteStatus: cleanText(readback.remoteStatus, 40),
          status: cleanText(readback.status || readback.remoteStatus || existing.status, 40),
          uncertainWrite: readback.uncertainWrite === true,
          remoteReadAt: readback.remoteReadAt || now,
          updatedAt: now
        };
        transaction.update(reference, { [`channelPackages.${channel}`]: savedPackage, version: Number(current.version || 0) + 1, updatedAt: now });
        return { ...current, channelPackages: { ...(current.channelPackages || {}), [channel]: savedPackage }, id, updatedAt: now };
      });
    },

    async getControls() {
      const snapshot = await controls.doc('global').get();
      const defaults = {
        outboundPaused: true,
        draftingDisabled: false,
        disconnectedPlatforms: [],
        updatedAt: null
      };
      return snapshot.exists ? { ...defaults, ...snapshot.data() } : defaults;
    },

    async setControl(input, actor = '') {
      const level = cleanText(input.level, 4).toUpperCase();
      if (!['L1', 'L2', 'L3', 'L4'].includes(level)) throw new Error('Unsupported kill-switch level.');
      const now = new Date().toISOString();
      const update = { updatedAt: now, updatedBy: cleanText(actor, 200), lastLevel: level };
      if (level === 'L1') update.outboundPaused = input.active !== false;
      if (level === 'L2') update.draftingDisabled = input.active !== false;
      if (level === 'L3') {
        const platform = cleanText(input.platform, 30).toLowerCase();
        if (!['google', 'instagram', 'facebook'].includes(platform)) throw new Error('Choose the affected platform.');
        const current = await this.getControls();
        const platforms = new Set(current.disconnectedPlatforms || []);
        if (input.active === false) platforms.delete(platform); else platforms.add(platform);
        update.disconnectedPlatforms = [...platforms];
      }
      if (level === 'L4') {
        if (input.active === false) throw new Error('L4 suppression can only be cleared through a new named-human consent event.');
        const targetType = cleanText(input.targetType || (input.inquiryId ? 'inquiry' : 'lead'), 20).toLowerCase();
        const targetId = cleanId(input.targetId || input.inquiryId || input.firebaseLeadId || input.contactId, 180);
        if (!['lead', 'inquiry'].includes(targetType) || !targetId) throw new Error('Choose a Firebase lead or inquiry to suppress.');
        const targetReference = targetType === 'inquiry' ? inquiries.doc(targetId) : leads.doc(targetId);
        const controlReference = controls.doc(`contact_${createHash('sha256').update(`${targetType}:${targetId}`).digest('hex')}`);
        await db.runTransaction(async transaction => {
          const [targetSnapshot, controlSnapshot] = await Promise.all([
            transaction.get(targetReference), transaction.get(controlReference)
          ]);
          if (!targetSnapshot.exists) throw new Error(`The selected ${targetType} does not exist.`);
          const current = targetSnapshot.data();
          const linkedLeadReference = targetType === 'inquiry' && current.firebaseLeadId ? leads.doc(current.firebaseLeadId) : null;
          const linkedLeadSnapshot = linkedLeadReference ? await transaction.get(linkedLeadReference) : null;
          const suppression = {
            dnd: true,
            optedOutAt: current.optedOutAt || now,
            optOutSource: 'admin_l4',
            updatedAt: now
          };
          transaction.update(targetReference, suppression);
          if (linkedLeadSnapshot?.exists) {
            const linkedLead = linkedLeadSnapshot.data();
            transaction.update(linkedLeadReference, {
              dnd: true,
              optedOutAt: linkedLead.optedOutAt || current.optedOutAt || now,
              optOutSource: 'admin_l4',
              updatedAt: now
            });
          }
          transaction.set(controlReference, {
            targetType,
            targetId,
            suppressed: true,
            firstSuppressedAt: controlSnapshot.exists ? controlSnapshot.data().firstSuppressedAt || now : now,
            updatedAt: now,
            updatedBy: cleanText(actor, 200)
          }, { merge: true });
        });
        update.lastTargetType = targetType;
        update.lastTargetId = targetId;
      }
      await controls.doc('global').set(update, { merge: true });
      await audit.doc().create({ type: 'kill_switch', level, ...update, createdAt: now });
      return this.getControls();
    },

    async setHealth(component, value) {
      const id = cleanId(component, 120);
      if (!id) throw new Error('A health component is required.');
      const updatedAt = new Date().toISOString();
      const saved = { component: id, ...value, updatedAt };
      await health.doc(id).set(saved, { merge: true });
      return saved;
    },

    async listHealth() {
      return rows(await health.limit(100).get()).sort(newestFirst);
    }
  };
}

export const GROWTH_COLLECTIONS = COLLECTIONS;
export const SOCIAL_CONTENT_STATUSES = CONTENT_STATUSES;
