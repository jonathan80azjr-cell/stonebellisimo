import { createHash, randomUUID } from 'node:crypto';
import { json, readJson } from './lead-automation.mjs';
import { normalizeContentManifest, qualificationErrors } from './growth-store.mjs';
import { GROWTH_CLIENT, publicGrowthConfig } from './growth-client-config.mjs';

const JSON_BODY_LIMIT = 64 * 1024;
const ASSET_BODY_LIMIT = 25 * 1024 * 1024;
const ALLOWED_ASSET_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['video/mp4', 'mp4'],
  ['video/quicktime', 'mov']
]);
const GROWTH_OWNER_EMAILS = new Set(GROWTH_CLIENT.ownerEmails);

export function isGrowthOwnerEmail(value) {
  return GROWTH_OWNER_EMAILS.has(String(value || '').trim().toLowerCase());
}

function actorName(options) {
  return String(options.actor || '').trim().slice(0, 200) || 'firebase-admin';
}

function requireStore(options) {
  if (!options.growthStore) return json({ success: false, message: 'Growth automation store is not configured.' }, 503);
  return null;
}

function cleanPathId(value) {
  const decoded = decodeURIComponent(value || '');
  return /^[A-Za-z0-9._:@-]{1,180}$/.test(decoded) ? decoded : '';
}

async function createContent(request, options) {
  const { body, error, status } = await readJson(request, JSON_BODY_LIMIT);
  if (error) return json({ success: false, message: error }, status);
  try {
    const manifest = normalizeContentManifest(body);
    const content = await options.growthStore.createContentManifest(manifest, actorName(options));
    return json({ success: true, content }, 201);
  } catch (error) {
    return json({ success: false, message: error?.message || 'Content manifest could not be created.' }, 400);
  }
}

async function listContent(request, options) {
  const url = new URL(request.url);
  const content = await options.growthStore.listContent({
    month: url.searchParams.get('month') || '',
    status: url.searchParams.get('status') || '',
    limit: url.searchParams.get('limit') || 100
  });
  return json({ success: true, content });
}

async function uploadAsset(request, contentId, options) {
  if (!options.bucket) return json({ success: false, message: 'Firebase Storage is not configured.' }, 503);
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > ASSET_BODY_LIMIT) return json({ success: false, message: 'Each asset must be 25 MB or smaller.' }, 413);

  const manifest = await options.growthStore.getContent(contentId);
  if (!manifest) return json({ success: false, message: 'Content manifest not found.' }, 404);
  if (!['discovered', 'needs_review', 'approved'].includes(manifest.status)) {
    return json({ success: false, message: 'Assets cannot be changed after upload reconciliation begins.' }, 409);
  }

  let form;
  try { form = await request.formData(); }
  catch { return json({ success: false, message: 'Upload one valid media file.' }, 400); }
  const upload = form.get('file');
  if (!upload || typeof upload.arrayBuffer !== 'function') return json({ success: false, message: 'Choose a media file.' }, 400);
  const mimeType = String(upload.type || '').toLowerCase();
  const extension = ALLOWED_ASSET_TYPES.get(mimeType);
  if (!extension) return json({ success: false, message: 'Use JPEG, PNG, WebP, MP4, or MOV media.' }, 415);
  if (!upload.size || upload.size > ASSET_BODY_LIMIT) return json({ success: false, message: 'Each asset must be 25 MB or smaller.' }, 413);

  const buffer = Buffer.from(await upload.arrayBuffer());
  if (!buffer.length || buffer.length > ASSET_BODY_LIMIT) return json({ success: false, message: 'Each asset must be 25 MB or smaller.' }, 413);
  const id = randomUUID();
  const storagePath = `growth/social-content/${contentId}/${id}.${extension}`;
  const object = options.bucket.file(storagePath);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const createdAt = new Date().toISOString();
  const asset = {
    id,
    storagePath,
    originalName: String(upload.name || 'asset').replace(/[^A-Za-z0-9._ -]/g, '').slice(0, 160),
    mimeType,
    size: buffer.length,
    sha256,
    verticalApproved: mimeType.startsWith('video/') ? form.get('verticalApproved') === 'true' : null,
    createdAt,
    uploadedBy: actorName(options)
  };

  try {
    await object.save(buffer, {
      resumable: false,
      validation: 'crc32c',
      contentType: mimeType,
      metadata: {
        cacheControl: 'private, no-store',
        metadata: { clientCode: GROWTH_CLIENT.code, program: GROWTH_CLIENT.programCode, contentId, assetId: id }
      }
    });
    const content = await options.growthStore.addContentAsset(contentId, asset, actorName(options));
    if (!content) throw new Error('Content manifest no longer exists.');
    return json({ success: true, asset, content }, 201);
  } catch (error) {
    await object.delete({ ignoreNotFound: true }).catch(() => {});
    return json({ success: false, message: error?.message || 'Asset upload could not be recorded.' }, 400);
  }
}

async function transitionContent(request, contentId, options) {
  const { body, error, status } = await readJson(request, JSON_BODY_LIMIT);
  if (error) return json({ success: false, message: error }, status);
  try {
    const content = await options.growthStore.transitionContent(contentId, body?.status, actorName(options), {
      note: body?.note,
      optimizationConfirmed: body?.optimizationConfirmed === true,
      specId: body?.specId
    });
    if (!content) return json({ success: false, message: 'Content manifest not found.' }, 404);
    return json({ success: true, content });
  } catch (error) {
    return json({ success: false, message: error?.message || 'Content status could not be changed.' }, 409);
  }
}

async function updateChannelPackage(request, contentId, channel, options) {
  const { body, error, status } = await readJson(request, JSON_BODY_LIMIT);
  if (error) return json({ success: false, message: error }, status);
  try {
    const content = await options.growthStore.updateChannelPackage(contentId, channel, body || {}, actorName(options));
    return content
      ? json({ success: true, content })
      : json({ success: false, message: 'Content manifest not found.' }, 404);
  } catch (error) {
    return json({ success: false, message: error?.message || 'Channel package could not be updated.' }, 400);
  }
}

async function listInquiries(request, options) {
  const url = new URL(request.url);
  const inquiries = await options.growthStore.listInquiries({
    status: url.searchParams.get('status') || '',
    limit: url.searchParams.get('limit') || 100
  });
  return json({ success: true, inquiries });
}

async function claimInquiry(inquiryId, options) {
  const inquiry = await options.growthStore.claimInquiry(inquiryId, actorName(options));
  if (!inquiry) return json({ success: false, message: 'Inquiry not found.' }, 404);
  if (inquiry.claimAccepted === false && inquiry.claimedBy !== actorName(options)) {
    return json({ success: false, message: `This conversation is already claimed by ${inquiry.claimedBy || 'another owner'}.` }, 409);
  }
  return json({ success: true, inquiry });
}

async function qualifyInquiry(request, inquiryId, options) {
  const { body, error, status } = await readJson(request, JSON_BODY_LIMIT);
  if (error) return json({ success: false, message: error }, status);
  const errors = qualificationErrors(body);
  if (errors.length) return json({ success: false, message: errors.join(' ') }, 400);
  try {
    const current = await options.growthStore.getInquiry(inquiryId);
    if (!current) return json({ success: false, message: 'Inquiry not found.' }, 404);
    const result = await options.growthStore.recordQualificationEvent(`admin:${inquiryId}:${GROWTH_CLIENT.programCode}`, {
      type: 'qualification',
      inquiryDocumentId: inquiryId,
      inquiryId,
      platform: current.platform,
      accountId: current.accountId,
      occurredAt: new Date().toISOString(),
      claimedBy: actorName(options),
      contactId: current.highLevelContactId,
      opportunityId: current.highLevelOpportunityId,
      projectType: current.projectType,
      material: current.material,
      serviceFit: body.serviceFit === true,
      serviceAreaFit: body.serviceAreaFit === true,
      genuineProjectIntent: body.genuineProjectIntent === true,
      usableContactMethod: body.usableContactMethod,
      consentStatus: body.consentState,
      consentVersion: body.consentVersion,
      qualificationVersion: body.version || GROWTH_CLIENT.programCode
    });
    return result.inquiry
      ? json({ success: true, inquiry: result.inquiry, lead: result.lead || null, duplicate: result.duplicate === true })
      : json({ success: false, message: 'Inquiry not found.' }, 404);
  } catch (error) {
    return json({ success: false, message: error?.message || 'Inquiry could not be qualified.' }, 400);
  }
}

async function restoreInquiryConsent(request, inquiryId, options) {
  const { body, error, status } = await readJson(request, JSON_BODY_LIMIT);
  if (error) return json({ success: false, message: error }, status);
  try {
    const result = await options.growthStore.recordHumanConsentEvent(inquiryId, body?.consentVersion, actorName(options));
    if (result?.missing) return json({ success: false, message: 'Inquiry not found.' }, 404);
    return json({ success: true, inquiry: result?.inquiry || null, duplicate: result?.duplicate === true });
  } catch (error) {
    return json({ success: false, message: error?.message || 'Consent could not be restored.' }, 400);
  }
}

export async function handleGrowthAdminRequest(request, options = {}) {
  const missing = requireStore(options);
  if (missing) return missing;
  const url = new URL(request.url);

  if (url.pathname === '/api/admin/growth/content' && request.method === 'GET') return listContent(request, options);
  if (url.pathname === '/api/admin/growth/content' && request.method === 'POST') return createContent(request, options);
  if (url.pathname === '/api/admin/growth/config' && request.method === 'GET') {
    return json({ success: true, config: publicGrowthConfig() });
  }

  const assetMatch = url.pathname.match(/^\/api\/admin\/growth\/content\/([^/]+)\/assets$/);
  if (assetMatch && request.method === 'POST') {
    const id = cleanPathId(assetMatch[1]);
    return id ? uploadAsset(request, id, options) : json({ success: false, message: 'Invalid content ID.' }, 400);
  }

  const transitionMatch = url.pathname.match(/^\/api\/admin\/growth\/content\/([^/]+)\/transition$/);
  if (transitionMatch && request.method === 'PATCH') {
    const id = cleanPathId(transitionMatch[1]);
    return id ? transitionContent(request, id, options) : json({ success: false, message: 'Invalid content ID.' }, 400);
  }

  const packageMatch = url.pathname.match(/^\/api\/admin\/growth\/content\/([^/]+)\/packages\/(google|instagram|facebook)$/);
  if (packageMatch && request.method === 'PATCH') {
    const id = cleanPathId(packageMatch[1]);
    return id ? updateChannelPackage(request, id, packageMatch[2], options) : json({ success: false, message: 'Invalid content ID.' }, 400);
  }

  if (url.pathname === '/api/admin/growth/inquiries' && request.method === 'GET') return listInquiries(request, options);
  const claimMatch = url.pathname.match(/^\/api\/admin\/growth\/inquiries\/([^/]+)\/claim$/);
  if (claimMatch && request.method === 'POST') {
    const id = cleanPathId(claimMatch[1]);
    return id ? claimInquiry(id, options) : json({ success: false, message: 'Invalid inquiry ID.' }, 400);
  }
  const qualifyMatch = url.pathname.match(/^\/api\/admin\/growth\/inquiries\/([^/]+)\/qualify$/);
  if (qualifyMatch && request.method === 'POST') {
    const id = cleanPathId(qualifyMatch[1]);
    return id ? qualifyInquiry(request, id, options) : json({ success: false, message: 'Invalid inquiry ID.' }, 400);
  }
  const consentMatch = url.pathname.match(/^\/api\/admin\/growth\/inquiries\/([^/]+)\/consent$/);
  if (consentMatch && request.method === 'PATCH') {
    const id = cleanPathId(consentMatch[1]);
    return id ? restoreInquiryConsent(request, id, options) : json({ success: false, message: 'Invalid inquiry ID.' }, 400);
  }

  if (url.pathname === '/api/admin/growth/health' && request.method === 'GET') {
    return json({ success: true, health: await options.growthStore.listHealth() });
  }

  if (url.pathname === '/api/admin/growth/controls' && request.method === 'GET') {
    return json({ success: true, controls: await options.growthStore.getControls() });
  }
  if (url.pathname === '/api/admin/growth/controls' && request.method === 'PATCH') {
    const { body, error, status } = await readJson(request, JSON_BODY_LIMIT);
    if (error) return json({ success: false, message: error }, status);
    try {
      return json({ success: true, controls: await options.growthStore.setControl(body || {}, actorName(options)) });
    } catch (error) {
      return json({ success: false, message: error?.message || 'Kill switch could not be changed.' }, 400);
    }
  }

  return json({ success: false, message: 'Growth automation endpoint not found.' }, 404);
}

export const GROWTH_ASSET_LIMIT_BYTES = ASSET_BODY_LIMIT;
export const GROWTH_ASSET_TYPES = Object.freeze([...ALLOWED_ASSET_TYPES.keys()]);
