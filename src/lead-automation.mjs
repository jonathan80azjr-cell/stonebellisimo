import {
  BUSINESS_INFO,
  renderFeedbackRequestEmail,
  renderImmediateConfirmationEmail,
  renderInternalFeedbackNotificationEmail
} from './email/render.mjs';

export const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

export const SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin'
};

const FIELD_LIMITS = {
  firstName: 80,
  lastName: 80,
  email: 254,
  phone: 30,
  projectType: 120,
  material: 80,
  source: 80,
  message: 1000,
  comment: 2000
};

const CONTACT_BODY_LIMIT = 20 * 1024;
const POSTMARK_BODY_LIMIT = 256 * 1024;
const DEFAULT_FEEDBACK_DELAY_DAYS = 3;
const DEFAULT_TOKEN_TTL_DAYS = 90;
const DEFAULT_CONTACT_RATE_LIMIT = 8;
const DEFAULT_FEEDBACK_BATCH_LIMIT = 25;
const DEFAULT_FEEDBACK_MAX_ATTEMPTS = 8;
const FEEDBACK_PREVIEW_TOKEN = 'preview-token-only-links-will-not-submit';

const encoder = new TextEncoder();

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...SECURITY_HEADERS, ...extraHeaders }
  });
}

export function html(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...SECURITY_HEADERS,
      ...extraHeaders
    }
  });
}

export function methodNotAllowed(allowed) {
  return json(
    { success: false, message: 'Method not allowed.' },
    405,
    { allow: allowed.join(', ') }
  );
}

export function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function normalizeText(value, maxLength, { preserveLines = false } = {}) {
  if (typeof value !== 'string') return '';

  const controlChars = preserveLines ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
  return value
    .replace(controlChars, ' ')
    .replace(preserveLines ? /[ \t]+/g : /\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function stripSubmissionMetadata(value) {
  if (typeof value !== 'string') return '';

  return value
    .replace(/\r\n?/g, '\n')
    .replace(/(?:^|\n)\s*---\s*Metadata\s*---[\s\S]*$/i, '')
    .trim();
}

export function validateContact(body) {
  const payload = {
    firstName: normalizeText(body?.firstName, FIELD_LIMITS.firstName),
    lastName: normalizeText(body?.lastName, FIELD_LIMITS.lastName),
    email: normalizeText(body?.email, FIELD_LIMITS.email).toLowerCase(),
    phone: normalizeText(body?.phone, FIELD_LIMITS.phone),
    projectType: normalizeText(body?.projectType, FIELD_LIMITS.projectType),
    material: normalizeText(body?.material, FIELD_LIMITS.material),
    source: normalizeText(body?.source, FIELD_LIMITS.source),
    message: normalizeText(stripSubmissionMetadata(body?.message), FIELD_LIMITS.message, { preserveLines: true })
  };

  if (!payload.firstName || !payload.lastName || !payload.email || !payload.phone) {
    return { error: 'Please fill out all required fields.' };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return { error: 'Please enter a valid email address.' };
  }

  if (hasSpamTrap(body)) {
    return { error: 'We could not submit your request. Please call us directly.' };
  }

  return { payload };
}

function hasSpamTrap(body = {}) {
  return Boolean(
    normalizeText(body.website, 200) ||
    normalizeText(body.company, 200) ||
    normalizeText(body._gotcha, 200)
  );
}

export async function readJson(request, limit = CONTACT_BODY_LIMIT) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > limit) {
    return { error: 'Request is too large.', status: 413 };
  }

  try {
    return { body: await request.json() };
  } catch (error) {
    return { error: 'Invalid JSON request.', status: 400 };
  }
}

async function readForm(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > CONTACT_BODY_LIMIT) {
    return { error: 'Request is too large.', status: 413 };
  }

  try {
    const form = await request.formData();
    return { body: Object.fromEntries(form.entries()) };
  } catch (error) {
    return { error: 'Invalid form request.', status: 400 };
  }
}

export function getEnv(env, name, fallback = '') {
  const value = env?.[name];
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function isProductionEnv(env) {
  return getEnv(env, 'ENVIRONMENT').toLowerCase() === 'production';
}

function parsePositiveInteger(value, fallback, min = 1, max = 365) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  if (crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${prefix}_${bytesToHex(bytes)}`;
}

function bytesToHex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return bytesToHex(new Uint8Array(digest));
}

async function hmacBase64Url(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return arrayBufferToBase64Url(signature);
}

function timingSafeEqual(a, b) {
  const aBytes = encoder.encode(String(a));
  const bBytes = encoder.encode(String(b));
  let diff = aBytes.length ^ bBytes.length;
  const length = Math.max(aBytes.length, bBytes.length);

  for (let index = 0; index < length; index += 1) {
    diff |= (aBytes[index] || 0) ^ (bBytes[index] || 0);
  }

  return diff === 0;
}

function getFeedbackDelayDays(env) {
  return parsePositiveInteger(
    getEnv(env, 'FEEDBACK_DELAY_DAYS'),
    DEFAULT_FEEDBACK_DELAY_DAYS,
    1,
    30
  );
}

function getTokenTtlDays(env) {
  return parsePositiveInteger(
    getEnv(env, 'FEEDBACK_TOKEN_TTL_DAYS'),
    DEFAULT_TOKEN_TTL_DAYS,
    7,
    365
  );
}

function getFeedbackTokenSecret(env) {
  const explicit = getEnv(env, 'FEEDBACK_TOKEN_SECRET');
  if (explicit) return explicit;
  if (!isProductionEnv(env)) return 'local-development-feedback-token-secret';
  throw new Error('FEEDBACK_TOKEN_SECRET is not configured.');
}

export async function createFeedbackToken(leadId, expiresAt, env) {
  const secret = getFeedbackTokenSecret(env);
  const expiresEpoch = Math.floor(new Date(expiresAt).getTime() / 1000);
  const data = `v1.${leadId}.${expiresEpoch}`;
  const signature = await hmacBase64Url(secret, data);
  return `${data}.${signature}`;
}

async function verifyFeedbackToken(token, env) {
  const normalized = normalizeText(token, 512);
  const parts = normalized.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    return { ok: false, reason: 'invalid' };
  }

  const [, leadId, expiresEpochRaw, signature] = parts;
  const expiresEpoch = Number(expiresEpochRaw);
  if (!leadId || !Number.isInteger(expiresEpoch)) {
    return { ok: false, reason: 'invalid' };
  }

  if (Date.now() > expiresEpoch * 1000) {
    return { ok: false, reason: 'expired', leadId };
  }

  const secret = getFeedbackTokenSecret(env);
  const expectedSignature = await hmacBase64Url(secret, `v1.${leadId}.${expiresEpoch}`);
  if (!timingSafeEqual(signature, expectedSignature)) {
    return { ok: false, reason: 'invalid' };
  }

  return {
    ok: true,
    leadId,
    expiresAt: new Date(expiresEpoch * 1000).toISOString(),
    tokenHash: await sha256Hex(normalized)
  };
}

async function hashIp(ip, env) {
  const secret = getEnv(env, 'FEEDBACK_TOKEN_SECRET') || getEnv(env, 'POSTMARK_INBOUND_SECRET') || 'stonebellisimo-local-ip-hash';
  return sha256Hex(`${secret}:${ip}`);
}

function getClientIp(request) {
  const forwarded = request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    '';
  return forwarded.split(',')[0].trim();
}

function getUserAgent(request) {
  return normalizeText(request.headers.get('user-agent') || '', 240);
}

function getBaseUrl(request, env) {
  const configured = getEnv(env, 'PUBLIC_SITE_URL') || getEnv(env, 'APP_BASE_URL');
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch (error) {
      // Fall through to request origin.
    }
  }
  return new URL(request.url).origin;
}

function getWebhookUrl(env, { allowLocal = false } = {}) {
  const rawUrl = getEnv(env, 'N8N_WEBHOOK_URL');
  if (!rawUrl || rawUrl === 'YOUR_N8N_WEBHOOK_URL_HERE') return null;

  try {
    const webhookUrl = new URL(rawUrl);
    const isLocalWebhook = ['localhost', '127.0.0.1', '::1'].includes(webhookUrl.hostname);

    if (webhookUrl.protocol !== 'https:' && !(allowLocal && webhookUrl.protocol === 'http:' && isLocalWebhook)) {
      return null;
    }

    return webhookUrl.toString();
  } catch (error) {
    return null;
  }
}

async function forwardToWebhook(payload, env, { allowLocal = false } = {}) {
  const webhookUrl = getWebhookUrl(env, { allowLocal });
  if (!webhookUrl) return { skipped: true };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: `Webhook returned ${response.status} ${response.statusText}`
      };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, message: error?.message || 'Webhook request failed.' };
  } finally {
    clearTimeout(timeout);
  }
}

function d1Changes(result) {
  return Number(result?.meta?.changes || result?.changes || 0);
}

export function safeJsonStringify(value, maxLength = 12000) {
  try {
    return JSON.stringify(value).slice(0, maxLength);
  } catch (error) {
    return JSON.stringify({ error: 'Could not serialize payload.' });
  }
}

export function createD1Store(db) {
  if (!db) throw new Error('LEADS_DB binding is not configured.');

  return {
    async countRecentByIpHash(ipHash, sinceIso) {
      const row = await db
        .prepare('SELECT COUNT(*) AS count FROM leads WHERE ipHash = ? AND submittedAt >= ?')
        .bind(ipHash, sinceIso)
        .first();
      return Number(row?.count || 0);
    },

    async createLead(lead) {
      await db.prepare(`
        INSERT INTO leads (
          id, firstName, lastName, customerName, email, phone, projectType, material, source, message,
          submittedAt, immediateEmailSentAt, feedbackEmailDueAt, feedbackEmailSentAt, feedbackEmailClaimedAt,
          feedbackStatus, feedbackEmailAttemptCount, feedbackEmailLastError, rating, feedbackComment,
          feedbackReceivedAt, feedbackSource, replyTokenHash, replyTokenExpiresAt, ipHash, userAgent,
          createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        lead.id,
        lead.firstName,
        lead.lastName,
        lead.customerName,
        lead.email,
        lead.phone,
        lead.projectType,
        lead.material,
        lead.source,
        lead.message,
        lead.submittedAt,
        lead.immediateEmailSentAt,
        lead.feedbackEmailDueAt,
        lead.feedbackEmailSentAt,
        lead.feedbackEmailClaimedAt,
        lead.feedbackStatus,
        lead.feedbackEmailAttemptCount,
        lead.feedbackEmailLastError,
        lead.rating,
        lead.feedbackComment,
        lead.feedbackReceivedAt,
        lead.feedbackSource,
        lead.replyTokenHash,
        lead.replyTokenExpiresAt,
        lead.ipHash,
        lead.userAgent,
        lead.createdAt,
        lead.updatedAt
      ).run();
      return lead;
    },

    async getLeadById(id) {
      return db.prepare('SELECT * FROM leads WHERE id = ? LIMIT 1').bind(id).first();
    },

    async markImmediateEmailSent(id, sentAt, messageId) {
      await db.prepare(`
        UPDATE leads
        SET immediateEmailSentAt = ?, updatedAt = ?
        WHERE id = ?
      `).bind(sentAt, sentAt, id).run();

      if (messageId) {
        await db.prepare(`
          UPDATE leads
          SET postmarkImmediateMessageId = ?
          WHERE id = ?
        `).bind(messageId, id).run();
      }
    },

    async getDueFeedbackLeads(now, staleBefore, limit, maxAttempts) {
      const result = await db.prepare(`
        SELECT * FROM leads
        WHERE feedbackEmailDueAt <= ?
          AND feedbackEmailSentAt IS NULL
          AND COALESCE(feedbackStatus, 'pending') NOT IN ('received', 'unparsed')
          AND COALESCE(feedbackEmailAttemptCount, 0) < ?
          AND (feedbackEmailClaimedAt IS NULL OR feedbackEmailClaimedAt <= ?)
        ORDER BY feedbackEmailDueAt ASC
        LIMIT ?
      `).bind(now, maxAttempts, staleBefore, limit).all();
      return result.results || [];
    },

    async claimFeedbackLead(id, claimedAt, staleBefore) {
      const result = await db.prepare(`
        UPDATE leads
        SET feedbackEmailClaimedAt = ?, feedbackStatus = 'sending', updatedAt = ?
        WHERE id = ?
          AND feedbackEmailSentAt IS NULL
          AND COALESCE(feedbackStatus, 'pending') NOT IN ('received', 'unparsed')
          AND (feedbackEmailClaimedAt IS NULL OR feedbackEmailClaimedAt <= ?)
      `).bind(claimedAt, claimedAt, id, staleBefore).run();
      return d1Changes(result) > 0;
    },

    async markFeedbackSent(id, sentAt, messageId) {
      await db.prepare(`
        UPDATE leads
        SET feedbackEmailSentAt = ?,
            feedbackEmailClaimedAt = NULL,
            feedbackStatus = 'sent',
            feedbackEmailLastError = NULL,
            postmarkFeedbackMessageId = ?,
            updatedAt = ?
        WHERE id = ?
      `).bind(sentAt, messageId || null, sentAt, id).run();
    },

    async markFeedbackSendFailed(id, failedAt, errorMessage) {
      await db.prepare(`
        UPDATE leads
        SET feedbackEmailClaimedAt = NULL,
            feedbackStatus = 'pending',
            feedbackEmailAttemptCount = COALESCE(feedbackEmailAttemptCount, 0) + 1,
            feedbackEmailLastError = ?,
            updatedAt = ?
        WHERE id = ?
      `).bind(errorMessage.slice(0, 1000), failedAt, id).run();
    },

    async saveFeedback(feedback) {
      const result = await db.prepare(`
        UPDATE leads
        SET rating = ?,
            feedbackComment = ?,
            feedbackReceivedAt = ?,
            feedbackStatus = 'received',
            feedbackSource = ?,
            updatedAt = ?
        WHERE id = ?
          AND COALESCE(feedbackStatus, 'pending') != 'received'
      `).bind(
        feedback.rating,
        feedback.comment,
        feedback.receivedAt,
        feedback.source,
        feedback.receivedAt,
        feedback.leadId
      ).run();

      const accepted = d1Changes(result) > 0;
      await db.prepare(`
        INSERT INTO feedback (id, leadId, rating, comment, source, status, rawMetadataJson, receivedAt, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        randomId('feedback'),
        feedback.leadId,
        feedback.rating,
        feedback.comment,
        feedback.source,
        accepted ? 'accepted' : 'duplicate',
        feedback.rawMetadataJson || null,
        feedback.receivedAt,
        feedback.receivedAt
      ).run();

      return { accepted };
    },

    async saveUnparsedFeedback(feedback) {
      const result = await db.prepare(`
        UPDATE leads
        SET feedbackComment = ?,
            feedbackReceivedAt = ?,
            feedbackStatus = 'unparsed',
            feedbackSource = ?,
            updatedAt = ?
        WHERE id = ?
          AND COALESCE(feedbackStatus, 'pending') != 'received'
      `).bind(
        feedback.comment,
        feedback.receivedAt,
        feedback.source,
        feedback.receivedAt,
        feedback.leadId
      ).run();

      const accepted = d1Changes(result) > 0;
      await db.prepare(`
        INSERT INTO feedback (id, leadId, rating, comment, source, status, rawMetadataJson, receivedAt, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        randomId('feedback'),
        feedback.leadId,
        null,
        feedback.comment,
        feedback.source,
        accepted ? 'unparsed' : 'duplicate',
        feedback.rawMetadataJson || null,
        feedback.receivedAt,
        feedback.receivedAt
      ).run();

      return { accepted };
    },

    async saveEmailEvent(event) {
      await db.prepare(`
        INSERT INTO email_events (
          id, leadId, eventType, recipient, subject, status, messageStream,
          postmarkMessageId, error, payloadJson, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        event.id || randomId('email_event'),
        event.leadId || null,
        event.eventType,
        event.recipient || null,
        event.subject || null,
        event.status,
        event.messageStream || null,
        event.postmarkMessageId || null,
        event.error || null,
        event.payloadJson || null,
        event.createdAt || nowIso()
      ).run();
    },

    async saveInboundEvent(event) {
      await db.prepare(`
        INSERT INTO postmark_inbound_events (
          id, leadId, postmarkMessageId, fromEmail, mailboxHash, subject, rating,
          status, rawJson, receivedAt, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        event.id || randomId('inbound_event'),
        event.leadId || null,
        event.postmarkMessageId || null,
        event.fromEmail || null,
        event.mailboxHash || null,
        event.subject || null,
        event.rating || null,
        event.status,
        event.rawJson || null,
        event.receivedAt || nowIso(),
        event.createdAt || nowIso()
      ).run();
    },

    async saveDeliveryEvent(event) {
      await db.prepare(`
        INSERT INTO postmark_delivery_events (
          id, leadId, eventType, messageId, recipient, receivedAt, rawJson, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        event.id || randomId('delivery_event'),
        event.leadId || null,
        event.eventType || null,
        event.messageId || null,
        event.recipient || null,
        event.receivedAt || nowIso(),
        event.rawJson || null,
        event.createdAt || nowIso()
      ).run();
    }
  };
}

export function getStore(env, options = {}) {
  if (options.store) return options.store;
  return createD1Store(env?.LEADS_DB);
}

function postmarkMessageStream(env) {
  return getEnv(env, 'POSTMARK_MESSAGE_STREAM', 'outbound');
}

function isPostmarkMockMode(env) {
  const explicit = getEnv(env, 'POSTMARK_MOCK_MODE').toLowerCase();
  if (explicit === 'true' || explicit === '1') return true;
  if (explicit === 'false' || explicit === '0') return false;
  return !isProductionEnv(env) && !getEnv(env, 'POSTMARK_SERVER_TOKEN');
}

async function sendPostmarkEmail(env, email) {
  const fromEmail = getEnv(env, 'POSTMARK_FROM_EMAIL', 'admin@stonebellisimollc.com');
  const messageStream = postmarkMessageStream(env);
  const payload = {
    From: fromEmail,
    To: email.to,
    Subject: email.subject,
    HtmlBody: email.html,
    TextBody: email.text,
    MessageStream: messageStream,
    TrackOpens: false,
    Metadata: email.metadata || {}
  };

  if (email.replyTo) payload.ReplyTo = email.replyTo;

  if (isPostmarkMockMode(env)) {
    console.info('Mock Postmark email:', {
      to: payload.To,
      subject: payload.Subject,
      stream: payload.MessageStream,
      metadata: payload.Metadata
    });
    return {
      ok: true,
      mock: true,
      messageId: `mock_${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`
    };
  }

  const token = getEnv(env, 'POSTMARK_SERVER_TOKEN');
  if (!token) {
    throw new Error('POSTMARK_SERVER_TOKEN is not configured.');
  }

  const response = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      'x-postmark-server-token': token
    },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();
  let responseJson = null;
  try {
    responseJson = responseText ? JSON.parse(responseText) : null;
  } catch (error) {
    responseJson = null;
  }

  if (!response.ok) {
    throw new Error(`Postmark returned ${response.status}: ${responseText.slice(0, 500)}`);
  }

  return {
    ok: true,
    mock: false,
    messageId: responseJson?.MessageID || responseJson?.MessageId || null,
    response: responseJson
  };
}

export async function sendAndRecordEmail({ env, store, lead, eventType, email }) {
  const createdAt = nowIso();
  try {
    const result = await sendPostmarkEmail(env, email);
    await store.saveEmailEvent({
      leadId: lead?.id,
      eventType,
      recipient: email.to,
      subject: email.subject,
      status: result.mock ? 'mock_sent' : 'sent',
      messageStream: postmarkMessageStream(env),
      postmarkMessageId: result.messageId,
      payloadJson: safeJsonStringify({ response: result.response || null, metadata: email.metadata || {} }),
      createdAt
    });
    return result;
  } catch (error) {
    await store.saveEmailEvent({
      leadId: lead?.id,
      eventType,
      recipient: email.to,
      subject: email.subject,
      status: 'failed',
      messageStream: postmarkMessageStream(env),
      error: error?.message || 'Unknown Postmark error.',
      payloadJson: safeJsonStringify({ metadata: email.metadata || {} }),
      createdAt
    });
    throw error;
  }
}

function createLeadPayload(contact, request, env) {
  const submittedAt = new Date();
  const feedbackEmailDueAt = addDays(submittedAt, getFeedbackDelayDays(env));
  const replyTokenExpiresAt = addDays(submittedAt, getTokenTtlDays(env));
  const id = randomId('lead');
  const customerName = `${contact.firstName} ${contact.lastName}`.trim();

  return {
    id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    customerName,
    email: contact.email,
    phone: contact.phone,
    projectType: contact.projectType || 'Not specified',
    material: contact.material || 'Not specified',
    source: contact.source || 'Website Contact Form',
    message: contact.message || '',
    submittedAt: submittedAt.toISOString(),
    immediateEmailSentAt: null,
    feedbackEmailDueAt: feedbackEmailDueAt.toISOString(),
    feedbackEmailSentAt: null,
    feedbackEmailClaimedAt: null,
    feedbackStatus: 'pending',
    feedbackEmailAttemptCount: 0,
    feedbackEmailLastError: null,
    rating: null,
    feedbackComment: null,
    feedbackReceivedAt: null,
    feedbackSource: null,
    replyTokenHash: null,
    replyTokenExpiresAt: replyTokenExpiresAt.toISOString(),
    ipHash: null,
    userAgent: getUserAgent(request),
    createdAt: submittedAt.toISOString(),
    updatedAt: submittedAt.toISOString()
  };
}

async function prepareLead(contact, request, env) {
  const lead = createLeadPayload(contact, request, env);
  const token = await createFeedbackToken(lead.id, lead.replyTokenExpiresAt, env);
  lead.replyTokenHash = await sha256Hex(token);

  const clientIp = getClientIp(request);
  if (clientIp) {
    lead.ipHash = await hashIp(clientIp, env);
  }

  return { lead, token };
}

async function enforceContactRateLimit(store, request, env) {
  const clientIp = getClientIp(request);
  if (!clientIp || !store.countRecentByIpHash) return null;

  const ipHash = await hashIp(clientIp, env);
  const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const recentCount = await store.countRecentByIpHash(ipHash, windowStart);
  const limit = parsePositiveInteger(getEnv(env, 'CONTACT_RATE_LIMIT'), DEFAULT_CONTACT_RATE_LIMIT, 1, 50);

  if (recentCount >= limit) {
    return json(
      { success: false, message: 'Too many requests. Please wait a few minutes and try again.' },
      429
    );
  }

  return null;
}

export async function handleContactRequest(request, env, options = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return methodNotAllowed(['POST', 'OPTIONS']);

  const webhookUrl = getWebhookUrl(env, { allowLocal: options.allowLocalWebhook });
  const requireWebhook = options.requireWebhook ?? true;
  if (requireWebhook && !webhookUrl) {
    return json(
      { success: false, message: 'Contact form is temporarily unavailable. Please call us directly.' },
      503
    );
  }

  const { body, error, status } = await readJson(request);
  if (error) {
    return json({ success: false, message: error }, status);
  }

  const { payload: contact, error: validationError } = validateContact(body || {});
  if (validationError) {
    return json({ success: false, message: validationError }, 400);
  }

  const attribution = options.sanitizeAttribution
    ? options.sanitizeAttribution(body?.attribution || {})
    : null;
  const store = getStore(env, options);
  const rateLimitResponse = await enforceContactRateLimit(store, request, env);
  if (rateLimitResponse) return rateLimitResponse;

  const { lead } = await prepareLead(contact, request, env);
  if (attribution) lead.attribution = attribution;
  const createWithAnalytics = options.createLeadWithAnalytics && attribution
    ? options.createLeadWithAnalytics
    : null;
  if (!createWithAnalytics) await store.createLead(lead);

  const webhookPayload = {
    ...contact,
    source: lead.source,
    customerName: lead.customerName,
    leadId: lead.id,
    submittedAt: lead.submittedAt,
    feedbackEmailDueAt: lead.feedbackEmailDueAt,
    dateCreated: lead.submittedAt.split('T')[0]
  };

  const webhookResult = await forwardToWebhook(webhookPayload, env, { allowLocal: options.allowLocalWebhook });
  if (webhookResult.ok === false) {
    console.error('Failed to forward contact request to webhook:', webhookResult);
    if (requireWebhook) {
      return json(
        { success: false, message: 'We could not submit your request. Please call us directly.' },
        502
      );
    }
  }

  if (createWithAnalytics) {
    await createWithAnalytics(lead, {
      id: `conversion_${lead.id}`,
      ...attribution,
      pagePath: attribution.landingPage || '/',
      ctaId: normalizeText(contact.source || 'website-form', 160),
      ctaType: 'estimate',
      ctaLabel: 'Estimate form submission',
      placement: normalizeText(contact.source || 'website', 120)
    });
  }

  const confirmationEmail = renderImmediateConfirmationEmail({ lead });
  try {
    const result = await sendAndRecordEmail({
      env,
      store,
      lead,
      eventType: 'immediate_confirmation',
      email: {
        ...confirmationEmail,
        to: lead.email,
        replyTo: getEnv(env, 'BUSINESS_REPLY_TO_EMAIL', BUSINESS_INFO.email),
        metadata: {
          lead_id: lead.id,
          email_type: 'immediate_confirmation'
        }
      }
    });
    await store.markImmediateEmailSent(lead.id, nowIso(), result.messageId);
  } catch (error) {
    console.error('Immediate Postmark email failed:', error?.message || error);
  }

  if (!createWithAnalytics && options.recordAnalytics && attribution) {
    try {
      await options.recordAnalytics({
        id: `conversion_${lead.id}`,
        ...attribution,
        pagePath: attribution.landingPage || '/',
        ctaId: normalizeText(contact.source || 'website-form', 160),
        ctaType: 'estimate',
        ctaLabel: 'Estimate form submission',
        placement: normalizeText(contact.source || 'website', 120)
      });
    } catch (analyticsError) {
      console.error('Failed to record contact conversion:', analyticsError?.message || analyticsError);
    }
  }

  return json({ success: true, message: 'Thank you for your request! We will be in touch shortly.' });
}

function getFeedbackReplyDomain(env) {
  const configured = getEnv(env, 'POSTMARK_FEEDBACK_REPLY_DOMAIN');
  if (configured) return configured.replace(/^@/, '');

  const fromEmail = getEnv(env, 'POSTMARK_FROM_EMAIL', 'admin@stonebellisimollc.com');
  return fromEmail.split('@')[1] || 'stonebellisimollc.com';
}

export function getFeedbackReplyTo(env, lead) {
  const tokenRef = String(lead.replyTokenHash || '').slice(0, 24);
  const domain = getFeedbackReplyDomain(env);
  return `feedback+${lead.id}.${tokenRef}@${domain}`;
}

async function getLeadForFeedbackToken(token, env, store) {
  let verification;
  try {
    verification = await verifyFeedbackToken(token, env);
  } catch (error) {
    console.error('Feedback token verification failed:', error?.message || error);
    return { ok: false, reason: 'invalid' };
  }

  if (!verification.ok) return verification;

  const lead = await store.getLeadById(verification.leadId);
  if (!lead || !lead.replyTokenHash || !timingSafeEqual(lead.replyTokenHash, verification.tokenHash)) {
    return { ok: false, reason: 'invalid' };
  }

  if (lead.replyTokenExpiresAt && Date.now() > new Date(lead.replyTokenExpiresAt).getTime()) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, lead, tokenHash: verification.tokenHash };
}

function isValidRating(value) {
  const rating = Number(value);
  return Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

function isFeedbackPreviewToken(token) {
  return token === FEEDBACK_PREVIEW_TOKEN;
}

function feedbackPageShell({ title, body, status = 200 }) {
  return html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${escapeForPage(title)} | Stone Bellisimo LLC</title>
  <style>
    *,*::before,*::after{box-sizing:border-box}
    body{margin:0;min-height:100vh;font-family:Inter,Arial,sans-serif;background:#faf9f4;color:#171614;line-height:1.65;display:flex;align-items:center;justify-content:center;padding:28px}
    main{width:min(100%,680px);background:#fff;border:1px solid #e7dfd2;border-radius:18px;overflow:hidden;box-shadow:0 20px 60px rgba(23,22,20,.11)}
    .head{background:#171614;padding:28px 30px 24px}
    .head img{width:142px;height:auto;display:block;filter:brightness(0) invert(1)}
    .body{padding:34px 30px}
    .eyebrow{margin:22px 0 8px;color:#b39158;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}
    h1{margin:0;font-family:Georgia,serif;font-size:clamp(34px,8vw,52px);font-weight:400;line-height:1.05;color:#fff}
    h2{margin:0 0 12px;font-family:Georgia,serif;font-size:34px;font-weight:400;line-height:1.08;color:#171614}
    p{margin:0 0 18px;color:#6f6b63;font-size:15px}
    .ratings{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:24px 0}
    .rating{display:flex;align-items:center;justify-content:center;min-height:56px;border-radius:999px;background:#171614;color:#fff;text-decoration:none;font-size:20px;font-weight:700;border:1px solid #171614}
    .rating.selected{background:#b39158;border-color:#b39158}
    .rating-option{position:relative;display:block;min-width:0}
    .rating-option input{position:absolute;opacity:0;pointer-events:none}
    .rating-option span{display:flex;align-items:center;justify-content:center;min-height:56px;border-radius:999px;background:#171614;color:#fff;text-decoration:none;font-size:20px;font-weight:700;border:1px solid #171614;cursor:pointer}
    .rating-option input:checked+span{background:#b39158;border-color:#b39158}
    .rating-option input:focus-visible+span{outline:3px solid rgba(179,145,88,.35);outline-offset:3px}
    label{display:block;margin:18px 0 8px;font-size:13px;font-weight:700;color:#171614}
    textarea{width:100%;min-height:138px;resize:vertical;border:1px solid #d9cdbd;border-radius:12px;padding:14px 15px;font:400 15px/1.5 Inter,Arial,sans-serif;color:#171614;background:#fcfbf8}
    button,.button{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:999px;background:#b39158;color:#fff;text-decoration:none;padding:14px 24px;font-size:14px;font-weight:700;cursor:pointer}
    .muted{font-size:13px;color:#8b877f}
    .error{padding:12px 14px;border-radius:10px;background:#fff5f2;border:1px solid #edc5ba;color:#7c2417}
    .actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px}
    @media(max-width:520px){body{padding:0;align-items:stretch}main{border-radius:0;min-height:100vh}.body,.head{padding-left:22px;padding-right:22px}.ratings{gap:8px}.rating,.rating-option span{min-height:50px}}
  </style>
</head>
<body>
  <main>
    ${body}
  </main>
</body>
</html>`, status);
}

function escapeForPage(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderFeedbackHeader(title, eyebrow = 'Stone Bellisimo feedback') {
  return `<div class="head">
    <img src="/assets/img/logo-280.png" alt="Stone Bellisimo LLC">
    <div class="eyebrow">${escapeForPage(eyebrow)}</div>
    <h1>${escapeForPage(title)}</h1>
  </div>`;
}

function renderInvalidFeedbackPage(reason) {
  const copy = reason === 'expired'
    ? 'This feedback link has expired. You can still call, text, or email Stone Bellisimo if you would like to share anything with our team.'
    : 'This feedback link is not valid. For privacy, we cannot show project details from an invalid link.';

  return feedbackPageShell({
    title: 'Feedback Link',
    status: reason === 'expired' ? 410 : 400,
    body: `${renderFeedbackHeader('Feedback link')}
      <div class="body">
        <h2>We could not open that link.</h2>
        <p>${copy}</p>
        <div class="actions">
          <a class="button" href="tel:+12015531919">Call Office</a>
          <a class="button" href="mailto:${BUSINESS_INFO.email}">Email Stone Bellisimo</a>
        </div>
      </div>`
  });
}

function renderAlreadyReceivedPage() {
  return feedbackPageShell({
    title: 'Thank You',
    body: `${renderFeedbackHeader('Thank you')}
      <div class="body">
        <h2>We already received your feedback.</h2>
        <p>Thank you for taking the time to help Stone Bellisimo improve. If you need anything else, our team is here to help.</p>
        <div class="actions">
          <a class="button" href="/">Return to Website</a>
        </div>
      </div>`
  });
}

function renderFeedbackSubmissionPage(token, rating = '', errorMessage = '') {
  const selectedRating = isValidRating(rating) ? Number(rating) : null;
  const buttons = [1, 2, 3, 4, 5].map(value => {
    const checked = value === selectedRating ? ' checked' : '';
    return `<label class="rating-option" aria-label="Rate ${value} out of 5">
      <input type="radio" name="rating" value="${value}"${checked}>
      <span>${value}</span>
    </label>`;
  }).join('');

  const heading = selectedRating
    ? `Your rating: ${selectedRating} out of 5`
    : 'Share your feedback';

  return feedbackPageShell({
    title: 'Share Feedback',
    body: `${renderFeedbackHeader('Thank you')}
      <div class="body">
        <h2>${escapeForPage(heading)}</h2>
        <p>Thank you for reaching out to Stone Bellisimo. You can choose a rating, type a comment, or do both.</p>
        ${errorMessage ? `<p class="error">${escapeForPage(errorMessage)}</p>` : ''}
        <form method="post" action="/feedback">
          <input type="hidden" name="token" value="${escapeForPage(token)}">
          <div class="ratings" role="radiogroup" aria-label="Experience rating">${buttons}</div>
          <p class="muted">1 means poor. 5 means excellent. A rating is helpful, but your written feedback is welcome either way.</p>
          <label for="comment">Your feedback</label>
          <textarea id="comment" name="comment" maxlength="${FIELD_LIMITS.comment}" placeholder="Tell us what went well or what we could improve."></textarea>
          <div class="actions">
            <button type="submit">Submit Feedback</button>
          </div>
        </form>
      </div>`
  });
}

function renderPreviewFeedbackPage(token, rating = '') {
  const selectedRating = isValidRating(rating) ? Number(rating) : null;
  const buttons = [1, 2, 3, 4, 5].map(value => {
    const selected = value === selectedRating ? ' selected' : '';
    const href = `/feedback?token=${encodeURIComponent(token)}&rating=${value}`;
    return `<a class="rating${selected}" href="${href}" aria-label="Preview rate ${value} out of 5">${value}</a>`;
  }).join('');
  const heading = selectedRating ? `Preview rating: ${selectedRating} out of 5` : 'Preview feedback link';

  return feedbackPageShell({
    title: 'Feedback Preview',
    body: `${renderFeedbackHeader('Feedback preview')}
      <div class="body">
        <h2>${escapeForPage(heading)}</h2>
        <p>This is a test email preview, so no feedback was submitted. Real customer feedback emails include private signed links that open the live submission form.</p>
        <div class="ratings">${buttons}</div>
        <p class="muted">To test a real submission, create a test lead and send the scheduled feedback email for that lead.</p>
        <div class="actions">
          <a class="button" href="/">Return to Website</a>
        </div>
      </div>`
  });
}

function renderThanksPage() {
  return feedbackPageShell({
    title: 'Feedback Received',
    body: `${renderFeedbackHeader('Feedback received')}
      <div class="body">
        <h2>Thank you.</h2>
        <p>Your feedback was received by Stone Bellisimo. We appreciate you helping our team keep improving.</p>
        <div class="actions">
          <a class="button" href="/">Return to Website</a>
        </div>
      </div>`
  });
}

async function notifyBusinessOfFeedback({ env, store, lead, feedback, request }) {
  const to = getEnv(env, 'BUSINESS_NOTIFICATION_EMAIL', BUSINESS_INFO.email);
  if (!to) return;

  const notification = renderInternalFeedbackNotificationEmail({
    lead,
    feedback,
    baseUrl: getBaseUrl(request, env)
  });

  try {
    await sendAndRecordEmail({
      env,
      store,
      lead,
      eventType: 'internal_feedback_notification',
      email: {
        ...notification,
        to,
        replyTo: lead.email || BUSINESS_INFO.email,
        metadata: {
          lead_id: lead.id,
          email_type: 'internal_feedback_notification',
          feedback_source: feedback.source
        }
      }
    });
  } catch (error) {
    console.error('Internal feedback notification failed:', error?.message || error);
  }
}

export async function handleFeedbackRequest(request, env, options = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!['GET', 'POST'].includes(request.method)) return methodNotAllowed(['GET', 'POST', 'OPTIONS']);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const token = normalizeText(url.searchParams.get('token') || '', 512);
    const rating = normalizeText(url.searchParams.get('rating') || '', 2);

    if (!token) return renderInvalidFeedbackPage('invalid');
    if (isFeedbackPreviewToken(token)) return renderPreviewFeedbackPage(token, rating);

    const store = getStore(env, options);
    const result = await getLeadForFeedbackToken(token, env, store);
    if (!result.ok) return renderInvalidFeedbackPage(result.reason);

    if (['received', 'unparsed'].includes(result.lead.feedbackStatus)) return renderAlreadyReceivedPage();
    if (rating && !isValidRating(rating)) return renderFeedbackSubmissionPage(token);

    return renderFeedbackSubmissionPage(token, rating);
  }

  const { body, error, status } = await readForm(request);
  if (error) return feedbackPageShell({ title: 'Feedback Error', status, body: `${renderFeedbackHeader('Feedback error')}<div class="body"><h2>We could not read that submission.</h2><p>${escapeForPage(error)}</p></div>` });

  const token = normalizeText(body.token, 512);
  const rawRating = normalizeText(body.rating, 2);
  const rating = rawRating ? Number(rawRating) : null;
  const comment = normalizeText(body.comment, FIELD_LIMITS.comment, { preserveLines: true });

  if (!token) return renderInvalidFeedbackPage('invalid');
  if (rawRating && !isValidRating(rating)) return renderInvalidFeedbackPage('invalid');
  if (!rawRating && !comment) {
    return renderFeedbackSubmissionPage(token, '', 'Please choose a rating or type a quick comment before submitting.');
  }
  if (isFeedbackPreviewToken(token)) return renderPreviewFeedbackPage(token, rating);

  const store = getStore(env, options);
  const result = await getLeadForFeedbackToken(token, env, store);
  if (!result.ok) return renderInvalidFeedbackPage(result.reason);
  if (['received', 'unparsed'].includes(result.lead.feedbackStatus)) return renderAlreadyReceivedPage();

  const feedback = {
    leadId: result.lead.id,
    rating,
    comment,
    source: rating ? 'landing_page' : 'landing_page_unrated',
    receivedAt: nowIso(),
    rawMetadataJson: null
  };
  const saved = rating
    ? await store.saveFeedback(feedback)
    : await store.saveUnparsedFeedback(feedback);
  if (!saved.accepted) return renderAlreadyReceivedPage();

  await notifyBusinessOfFeedback({ env, store, lead: result.lead, feedback, request });
  return renderThanksPage();
}

async function authorizePostmarkWebhook(request, env, secretName = 'POSTMARK_INBOUND_SECRET') {
  const expected = getEnv(env, secretName) || (secretName !== 'POSTMARK_INBOUND_SECRET' ? getEnv(env, 'POSTMARK_INBOUND_SECRET') : '');
  if (!expected) return false;

  const url = new URL(request.url);
  const candidates = [
    request.headers.get('x-postmark-webhook-secret'),
    request.headers.get('x-postmark-inbound-secret'),
    request.headers.get('x-webhook-secret'),
    url.searchParams.get('secret')
  ].filter(Boolean);

  return candidates.some(candidate => timingSafeEqual(candidate, expected));
}

function parseLeadReference(payload) {
  const candidates = [];
  const mailboxHash = normalizeText(payload.MailboxHash, 240);
  if (mailboxHash) candidates.push(mailboxHash);

  const recipientFields = [
    payload.To,
    payload.OriginalRecipient,
    payload.DeliveredTo,
    payload.Recipient
  ];

  for (const recipient of recipientFields) {
    if (typeof recipient === 'string') candidates.push(recipient);
  }

  if (Array.isArray(payload.Recipients)) {
    for (const recipient of payload.Recipients) {
      if (typeof recipient === 'string') candidates.push(recipient);
      if (recipient?.Email) candidates.push(recipient.Email);
    }
  }

  const pattern = /feedback\+([a-zA-Z0-9_-]+(?:-[a-zA-Z0-9_-]+)*)\.([a-f0-9]{12,64})@|^([a-zA-Z0-9_-]+(?:-[a-zA-Z0-9_-]+)*)\.([a-f0-9]{12,64})$/i;
  for (const candidate of candidates) {
    const match = String(candidate).match(pattern);
    if (match) {
      return {
        leadId: match[1] || match[3],
        tokenRef: (match[2] || match[4]).toLowerCase(),
        mailboxHash
      };
    }
  }

  return { mailboxHash };
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractInboundText(payload) {
  return normalizeText(
    payload.StrippedTextReply ||
      payload.TextBody ||
      stripHtml(payload.HtmlBody || ''),
    FIELD_LIMITS.comment,
    { preserveLines: true }
  );
}

function extractRatingAndComment(text) {
  const normalized = normalizeText(text, FIELD_LIMITS.comment, { preserveLines: true });
  const match = normalized.match(/(?:^|[\s:>-])([1-5])(?:\s*(?:\/\s*5|out\s+of\s+5|stars?)|\b)/i);
  if (!match) return { rating: null, comment: normalized };

  const rating = Number(match[1]);
  const before = normalized.slice(0, match.index).trim();
  const after = normalized.slice(match.index + match[0].length).trim();
  const comment = [before, after].filter(Boolean).join('\n\n').trim();
  return { rating, comment };
}

export async function handlePostmarkInboundRequest(request, env, options = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return methodNotAllowed(['POST', 'OPTIONS']);

  if (!(await authorizePostmarkWebhook(request, env, 'POSTMARK_INBOUND_SECRET'))) {
    return json({ success: false, message: 'Unauthorized.' }, 401);
  }

  const { body: payload, error, status } = await readJson(request, POSTMARK_BODY_LIMIT);
  if (error) return json({ success: false, message: error }, status);

  const store = getStore(env, options);
  const receivedAt = nowIso();
  const rawJson = safeJsonStringify(payload, 60000);
  const reference = parseLeadReference(payload || {});
  const inboundBase = {
    postmarkMessageId: payload?.MessageID || payload?.MessageId || null,
    fromEmail: payload?.FromFull?.Email || payload?.From || null,
    mailboxHash: reference.mailboxHash || null,
    subject: payload?.Subject || null,
    rawJson,
    receivedAt,
    createdAt: receivedAt
  };

  if (!reference.leadId || !reference.tokenRef) {
    await store.saveInboundEvent({ ...inboundBase, status: 'unmatched' });
    return json({ success: true, message: 'Inbound message acknowledged.' });
  }

  const lead = await store.getLeadById(reference.leadId);
  if (!lead || !String(lead.replyTokenHash || '').toLowerCase().startsWith(reference.tokenRef)) {
    await store.saveInboundEvent({ ...inboundBase, leadId: reference.leadId, status: 'invalid_reference' });
    return json({ success: true, message: 'Inbound message acknowledged.' });
  }

  if (lead.replyTokenExpiresAt && Date.now() > new Date(lead.replyTokenExpiresAt).getTime()) {
    await store.saveInboundEvent({ ...inboundBase, leadId: lead.id, status: 'expired_reference' });
    return json({ success: true, message: 'Inbound message acknowledged.' });
  }

  const inboundText = extractInboundText(payload || {});
  const parsed = extractRatingAndComment(inboundText);

  if (parsed.rating) {
    const feedback = {
      leadId: lead.id,
      rating: parsed.rating,
      comment: parsed.comment,
      source: 'email_reply',
      receivedAt,
      rawMetadataJson: safeJsonStringify({
        postmarkMessageId: inboundBase.postmarkMessageId,
        fromEmail: inboundBase.fromEmail,
        subject: inboundBase.subject
      })
    };
    const saved = await store.saveFeedback(feedback);
    await store.saveInboundEvent({ ...inboundBase, leadId: lead.id, rating: parsed.rating, status: saved.accepted ? 'parsed' : 'duplicate' });
    if (saved.accepted) await notifyBusinessOfFeedback({ env, store, lead, feedback, request });
    return json({ success: true, message: 'Feedback reply received.' });
  }

  const feedback = {
    leadId: lead.id,
    rating: null,
    comment: inboundText,
    source: 'email_reply_unparsed',
    receivedAt,
    rawMetadataJson: safeJsonStringify({
      postmarkMessageId: inboundBase.postmarkMessageId,
      fromEmail: inboundBase.fromEmail,
      subject: inboundBase.subject
    })
  };
  const saved = await store.saveUnparsedFeedback(feedback);
  await store.saveInboundEvent({ ...inboundBase, leadId: lead.id, status: saved.accepted ? 'unparsed' : 'duplicate' });
  if (saved.accepted) await notifyBusinessOfFeedback({ env, store, lead, feedback, request });
  return json({ success: true, message: 'Feedback reply received for review.' });
}

export async function handlePostmarkWebhookRequest(request, env, options = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return methodNotAllowed(['POST', 'OPTIONS']);

  if (!(await authorizePostmarkWebhook(request, env, 'POSTMARK_WEBHOOK_SECRET'))) {
    return json({ success: false, message: 'Unauthorized.' }, 401);
  }

  const { body: payload, error, status } = await readJson(request, POSTMARK_BODY_LIMIT);
  if (error) return json({ success: false, message: error }, status);

  try {
    const store = getStore(env, options);
    const receivedAt = nowIso();
    await store.saveDeliveryEvent({
      leadId: payload?.Metadata?.lead_id || payload?.Metadata?.leadId || null,
      eventType: payload?.RecordType || payload?.Type || payload?.Event || null,
      messageId: payload?.MessageID || payload?.MessageId || null,
      recipient: payload?.Recipient || payload?.Email || null,
      receivedAt,
      rawJson: safeJsonStringify(payload, 60000),
      createdAt: receivedAt
    });
  } catch (error) {
    console.error('Failed to store Postmark delivery event:', error?.message || error);
  }

  return json({ success: true, message: 'Postmark event acknowledged.' });
}

export async function processDueFeedbackEmails(env, options = {}) {
  const store = getStore(env, options);
  const current = nowIso();
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const limit = parsePositiveInteger(getEnv(env, 'FEEDBACK_BATCH_LIMIT'), DEFAULT_FEEDBACK_BATCH_LIMIT, 1, 100);
  const maxAttempts = parsePositiveInteger(getEnv(env, 'FEEDBACK_MAX_ATTEMPTS'), DEFAULT_FEEDBACK_MAX_ATTEMPTS, 1, 25);
  const dueLeads = await store.getDueFeedbackLeads(current, staleBefore, limit, maxAttempts);
  const summary = { checked: dueLeads.length, sent: 0, skipped: 0, failed: 0 };

  for (const lead of dueLeads) {
    const claimed = await store.claimFeedbackLead(lead.id, current, staleBefore);
    if (!claimed) {
      summary.skipped += 1;
      continue;
    }

    try {
      const freshLead = await store.getLeadById(lead.id);
      if (!freshLead || ['received', 'unparsed'].includes(freshLead.feedbackStatus) || freshLead.feedbackEmailSentAt) {
        summary.skipped += 1;
        continue;
      }

      const token = await createFeedbackToken(freshLead.id, freshLead.replyTokenExpiresAt, env);
      const tokenHash = await sha256Hex(token);
      if (!freshLead.replyTokenHash || !timingSafeEqual(freshLead.replyTokenHash, tokenHash)) {
        throw new Error('Feedback token hash mismatch.');
      }

      const feedbackEmail = renderFeedbackRequestEmail({
        lead: freshLead,
        token,
        baseUrl: getEnv(env, 'PUBLIC_SITE_URL', BUSINESS_INFO.website)
      });
      const replyTo = getFeedbackReplyTo(env, freshLead);
      const result = await sendAndRecordEmail({
        env,
        store,
        lead: freshLead,
        eventType: 'feedback_request',
        email: {
          ...feedbackEmail,
          to: freshLead.email,
          replyTo,
          metadata: {
            lead_id: freshLead.id,
            email_type: 'feedback_request'
          }
        }
      });

      await store.markFeedbackSent(freshLead.id, nowIso(), result.messageId);
      summary.sent += 1;
    } catch (error) {
      summary.failed += 1;
      await store.markFeedbackSendFailed(lead.id, nowIso(), error?.message || 'Feedback email failed.');
      console.error('Feedback email failed:', lead.id, error?.message || error);
    }
  }

  return summary;
}
