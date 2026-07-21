import {
  BUSINESS_INFO,
  renderCustomBrandedEmail,
  renderFeedbackRequestEmail,
  renderImmediateConfirmationEmail
} from './email/render.mjs';
import {
  createFeedbackToken,
  getEnv,
  getFeedbackReplyTo,
  getStore,
  html,
  json,
  methodNotAllowed,
  normalizeText,
  nowIso,
  readJson,
  safeJsonStringify,
  sendAndRecordEmail,
  sha256Hex
} from './lead-automation.mjs';

const ADMIN_COOKIE = 'sb_admin_session';
const ADMIN_SESSION_SECONDS = 8 * 60 * 60;
const ADMIN_BODY_LIMIT = 64 * 1024;
const ADMIN_SEARCH_LIMIT = 48;
const encoder = new TextEncoder();

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseCookies(request) {
  const cookies = {};
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

function timingSafeEqual(a = '', b = '') {
  const left = encoder.encode(String(a));
  const right = encoder.encode(String(b));
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
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
  const bytes = new Uint8Array(signature);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function adminUsername(env) {
  return getEnv(env, 'ADMIN_USERNAME', 'admin');
}

function adminPassword(env) {
  return getEnv(env, 'ADMIN_PASSWORD');
}

function sessionSecret(env) {
  return getEnv(env, 'ADMIN_SESSION_SECRET') || getEnv(env, 'FEEDBACK_TOKEN_SECRET');
}

async function createSessionCookie(request, env) {
  const secret = sessionSecret(env);
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is not configured.');

  const expires = Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS;
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = [...nonceBytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const payload = `v1.${expires}.${nonce}`;
  const signature = await hmacBase64Url(secret, payload);
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${ADMIN_COOKIE}=${encodeURIComponent(`${payload}.${signature}`)}; Path=/; Max-Age=${ADMIN_SESSION_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

async function verifyAdminSession(request, env) {
  const secret = sessionSecret(env);
  if (!secret) return false;

  const token = parseCookies(request)[ADMIN_COOKIE] || '';
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;

  const [, expiresRaw] = parts;
  const expires = Number(expiresRaw);
  if (!Number.isInteger(expires) || Date.now() > expires * 1000) return false;

  const payload = parts.slice(0, 3).join('.');
  const expected = await hmacBase64Url(secret, payload);
  return timingSafeEqual(parts[3], expected);
}

async function requireAdmin(request, env) {
  if (await verifyAdminSession(request, env)) return null;
  return json({ success: false, message: 'Unauthorized.' }, 401);
}

async function handleLogin(request, env) {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  const { body, error, status } = await readJson(request, ADMIN_BODY_LIMIT);
  if (error) return json({ success: false, message: error }, status);

  const expectedPassword = adminPassword(env);
  if (!expectedPassword) {
    return json({ success: false, message: 'Admin password is not configured.' }, 503);
  }

  const username = normalizeText(body?.username, 120);
  const password = typeof body?.password === 'string' ? body.password : '';
  const userOk = timingSafeEqual(username, adminUsername(env));
  const passOk = timingSafeEqual(await sha256Hex(password), await sha256Hex(expectedPassword));
  if (!userOk || !passOk) {
    return json({ success: false, message: 'Invalid username or password.' }, 401);
  }

  return json(
    { success: true, username: adminUsername(env) },
    200,
    { 'set-cookie': await createSessionCookie(request, env) }
  );
}

async function handleLogout(request) {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  return json({ success: true }, 200, { 'set-cookie': clearSessionCookie(request) });
}

function leadListWhere(search, status) {
  const where = [];
  const params = [];

  if (search) {
    const like = `%${search}%`;
    where.push('(customerName LIKE ? OR email LIKE ? OR phone LIKE ? OR projectType LIKE ? OR material LIKE ?)');
    params.push(like, like, like, like, like);
  }

  if (status === 'needs_feedback') {
    where.push("COALESCE(feedbackStatus, 'pending') IN ('pending', 'sending') AND feedbackEmailSentAt IS NULL");
  } else if (status === 'feedback_sent') {
    where.push("feedbackEmailSentAt IS NOT NULL AND COALESCE(feedbackStatus, 'pending') NOT IN ('received', 'unparsed')");
  } else if (status === 'feedback_received') {
    where.push("COALESCE(feedbackStatus, 'pending') IN ('received', 'unparsed')");
  } else if (status === 'email_failed') {
    where.push(`EXISTS (
      SELECT 1 FROM email_events e
      WHERE e.leadId = leads.id AND e.status = 'failed'
    )`);
  }

  return {
    sql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params
  };
}

function toPositiveInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function readLeadListParams(request) {
  const url = new URL(request.url);
  const search = normalizeText(url.searchParams.get('search') || '', ADMIN_SEARCH_LIMIT);
  const status = normalizeText(url.searchParams.get('status') || 'all', 40);
  const limit = toPositiveInteger(url.searchParams.get('limit'), 25, 1, 75);
  const cursor = normalizeText(url.searchParams.get('cursor') || '', 300);
  const offset = toPositiveInteger(url.searchParams.get('offset'), 0, 0, 10000);
  return { search, status, limit, cursor, offset };
}

async function listLeads(request, env, options = {}) {
  const params = readLeadListParams(request);
  if (options.adminStore?.listLeads) {
    const result = await options.adminStore.listLeads(params);
    return json({
      success: true,
      count: result.count,
      leads: result.leads,
      nextCursor: result.nextCursor || null
    });
  }

  const db = env?.LEADS_DB;
  if (!db) return json({ success: false, message: 'LEADS_DB binding is not configured.' }, 503);

  const { search, status, limit, offset } = params;
  const where = leadListWhere(search, status);

  const countStatement = db.prepare(`SELECT COUNT(*) AS count FROM leads ${where.sql}`);
  const countRow = where.params.length
    ? await countStatement.bind(...where.params).first()
    : await countStatement.first();

  const result = await db.prepare(`
    SELECT
      id, customerName, firstName, lastName, email, phone, projectType, material, source, message,
      submittedAt, immediateEmailSentAt, feedbackEmailDueAt, feedbackEmailSentAt,
      feedbackStatus, feedbackEmailAttemptCount, feedbackEmailLastError, rating,
      feedbackComment, feedbackReceivedAt, feedbackSource, postmarkImmediateMessageId,
      postmarkFeedbackMessageId,
      (
        SELECT eventType || '|' || status || '|' || COALESCE(createdAt, '')
        FROM email_events
        WHERE leadId = leads.id
        ORDER BY createdAt DESC
        LIMIT 1
      ) AS latestEmailEvent,
      (
        SELECT COALESCE(eventType, '') || '|' || COALESCE(receivedAt, '')
        FROM postmark_delivery_events
        WHERE leadId = leads.id
        ORDER BY receivedAt DESC
        LIMIT 1
      ) AS latestDeliveryEvent
    FROM leads
    ${where.sql}
    ORDER BY submittedAt DESC
    LIMIT ? OFFSET ?
  `).bind(...where.params, limit, offset).all();

  return json({
    success: true,
    count: Number(countRow?.count || 0),
    leads: result.results || []
  });
}

async function getLeadDetail(request, env, leadId, options = {}) {
  if (options.adminStore?.getLeadDetail) {
    const detail = await options.adminStore.getLeadDetail(leadId);
    if (!detail?.lead) return json({ success: false, message: 'Lead not found.' }, 404);
    return json({ success: true, ...detail });
  }

  const db = env?.LEADS_DB;
  if (!db) return json({ success: false, message: 'LEADS_DB binding is not configured.' }, 503);

  const lead = await db.prepare('SELECT * FROM leads WHERE id = ? LIMIT 1').bind(leadId).first();
  if (!lead) return json({ success: false, message: 'Lead not found.' }, 404);

  const [emailEvents, feedback, deliveryEvents, inboundEvents] = await Promise.all([
    db.prepare('SELECT eventType, recipient, subject, status, messageStream, postmarkMessageId, error, createdAt FROM email_events WHERE leadId = ? ORDER BY createdAt DESC LIMIT 25').bind(leadId).all(),
    db.prepare('SELECT rating, comment, source, status, rawMetadataJson, receivedAt, createdAt FROM feedback WHERE leadId = ? ORDER BY createdAt DESC LIMIT 25').bind(leadId).all(),
    db.prepare('SELECT eventType, messageId, recipient, receivedAt, createdAt FROM postmark_delivery_events WHERE leadId = ? ORDER BY receivedAt DESC LIMIT 25').bind(leadId).all(),
    db.prepare('SELECT fromEmail, subject, rating, status, receivedAt, createdAt FROM postmark_inbound_events WHERE leadId = ? ORDER BY receivedAt DESC LIMIT 25').bind(leadId).all()
  ]);

  return json({
    success: true,
    lead,
    emailEvents: emailEvents.results || [],
    feedback: feedback.results || [],
    deliveryEvents: deliveryEvents.results || [],
    inboundEvents: inboundEvents.results || []
  });
}

async function renderAdminEmail({ env, lead, body }) {
  const template = normalizeText(body?.template, 40);
  const baseUrl = getEnv(env, 'PUBLIC_SITE_URL', BUSINESS_INFO.website);

  if (template === 'immediate_confirmation') {
    return {
      eventType: 'admin_confirmation',
      email: renderImmediateConfirmationEmail({ lead })
    };
  }

  if (template === 'feedback_request') {
    if (!lead?.id) throw new Error('Choose a lead before previewing the feedback email.');
    if (['received', 'unparsed'].includes(lead.feedbackStatus)) {
      throw new Error('This lead already submitted feedback.');
    }

    const token = await createFeedbackToken(lead.id, lead.replyTokenExpiresAt, env);
    const tokenHash = await sha256Hex(token);
    if (!lead.replyTokenHash || !timingSafeEqual(lead.replyTokenHash, tokenHash)) {
      throw new Error('Feedback token hash mismatch for this lead.');
    }

    return {
      eventType: 'admin_feedback_request',
      email: renderFeedbackRequestEmail({ lead, token, baseUrl }),
      replyTo: getFeedbackReplyTo(env, lead)
    };
  }

  if (template === 'custom') {
    const subject = normalizeText(body?.subject, 160);
    const message = normalizeText(body?.message, 6000, { preserveLines: true });
    const ctaLabel = normalizeText(body?.ctaLabel, 80);
    const ctaUrl = normalizeText(body?.ctaUrl, 500);
    if (!subject) throw new Error('Subject is required.');
    if (!message) throw new Error('Message is required.');

    return {
      eventType: 'admin_custom',
      email: renderCustomBrandedEmail({ lead, subject, message, ctaLabel, ctaUrl })
    };
  }

  throw new Error('Choose a valid email template.');
}

async function getLeadForAdmin(env, leadId, options = {}) {
  if (!leadId) return null;
  if (options.adminStore?.getLeadById) {
    const lead = await options.adminStore.getLeadById(leadId);
    if (!lead) throw new Error('Lead not found.');
    return lead;
  }

  const lead = await env.LEADS_DB.prepare('SELECT * FROM leads WHERE id = ? LIMIT 1').bind(leadId).first();
  if (!lead) throw new Error('Lead not found.');
  return lead;
}

async function previewEmail(request, env, options = {}) {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  const { body, error, status } = await readJson(request, ADMIN_BODY_LIMIT);
  if (error) return json({ success: false, message: error }, status);

  try {
    const leadId = normalizeText(body?.leadId, 140);
    const lead = await getLeadForAdmin(env, leadId, options);
    const rendered = await renderAdminEmail({ env, lead: lead || {}, body });
    return json({
      success: true,
      subject: rendered.email.subject,
      html: rendered.email.html,
      text: rendered.email.text,
      to: lead?.email || ''
    });
  } catch (error) {
    return json({ success: false, message: error?.message || 'Could not preview email.' }, 400);
  }
}

async function sendEmail(request, env, options = {}) {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  const { body, error, status } = await readJson(request, ADMIN_BODY_LIMIT);
  if (error) return json({ success: false, message: error }, status);

  try {
    const leadId = normalizeText(body?.leadId, 140);
    const lead = await getLeadForAdmin(env, leadId, options);
    if (!lead) throw new Error('Choose a lead before sending.');

    const rendered = await renderAdminEmail({ env, lead, body });
    const store = options.store || getStore(env);
    const result = await sendAndRecordEmail({
      env,
      store,
      lead,
      eventType: rendered.eventType,
      email: {
        ...rendered.email,
        to: lead.email,
        replyTo: rendered.replyTo || getEnv(env, 'BUSINESS_REPLY_TO_EMAIL', BUSINESS_INFO.email),
        metadata: {
          lead_id: lead.id,
          email_type: rendered.eventType,
          source: 'admin_dashboard'
        }
      }
    });

    if (rendered.eventType === 'admin_feedback_request') {
      await store.markFeedbackSent(lead.id, nowIso(), result.messageId);
    } else if (rendered.eventType === 'admin_confirmation') {
      await store.markImmediateEmailSent(lead.id, nowIso(), result.messageId);
    }

    return json({
      success: true,
      message: 'Email sent.',
      messageId: result.messageId,
      mock: Boolean(result.mock)
    });
  } catch (error) {
    try {
      const leadId = normalizeText(body?.leadId, 140);
      const store = options.store || getStore(env);
      await store.saveEmailEvent({
        leadId,
        eventType: 'admin_send_failed',
        recipient: null,
        subject: normalizeText(body?.subject, 160),
        status: 'failed',
        error: error?.message || 'Admin send failed.',
        payloadJson: safeJsonStringify({ template: body?.template, source: 'admin_dashboard' }),
        createdAt: nowIso()
      });
    } catch (logError) {
      console.error('Failed to record admin email failure:', logError?.message || logError);
    }
    return json({ success: false, message: error?.message || 'Could not send email.' }, 400);
  }
}

function adminPage() {
  return html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Admin | Stone Bellisimo LLC</title>
  <style>
    *,*::before,*::after{box-sizing:border-box}
    :root{color-scheme:light;--ink:#191816;--muted:#68645d;--line:#ded6ca;--soft:#f6f3ec;--paper:#fff;--gold:#ad8b52;--good:#246a45;--bad:#9b2c1e;--warn:#8a5b13}
    body{margin:0;min-height:100vh;background:#f7f5ef;color:var(--ink);font-family:Inter,Arial,sans-serif}
    button,input,select,textarea{font:inherit}
    button{border:0;cursor:pointer}
    .login{min-height:100vh;display:grid;place-items:center;padding:24px}
    .login form{width:min(100%,390px);background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:26px;box-shadow:0 18px 50px rgba(25,24,22,.09)}
    .logo{width:138px;height:auto;display:block;margin:0 0 24px}
    h1,h2,h3,p{margin-top:0}
    h1{font-family:Georgia,serif;font-size:30px;font-weight:400;line-height:1.1;margin-bottom:8px}
    h2{font-size:17px;margin-bottom:14px}
    h3{font-size:14px;margin-bottom:10px}
    .muted{color:var(--muted);font-size:13px;line-height:1.5}
    label{display:block;font-size:12px;font-weight:700;margin:14px 0 7px}
    input,select,textarea{width:100%;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);padding:10px 11px}
    textarea{min-height:156px;resize:vertical;line-height:1.45}
    .btn{display:inline-flex;align-items:center;justify-content:center;min-height:38px;border-radius:6px;background:var(--ink);color:#fff;font-weight:700;padding:0 14px}
    .btn.gold{background:var(--gold)}
    .btn.ghost{background:#fff;color:var(--ink);border:1px solid var(--line)}
    .btn.bad{background:var(--bad)}
    .btn:disabled{opacity:.55;cursor:not-allowed}
    .error{margin-top:12px;color:var(--bad);font-size:13px}
    .shell{display:grid;grid-template-columns:330px minmax(0,1fr);min-height:100vh}
    aside{border-right:1px solid var(--line);background:#fff;display:flex;flex-direction:column;min-height:100vh}
    header{height:72px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:16px;padding:0 18px}
    header img{width:116px;height:auto}
    .filters{display:grid;grid-template-columns:1fr 128px;gap:8px;padding:14px;border-bottom:1px solid var(--line)}
    .list{overflow:auto;min-height:0}
    .lead{width:100%;text-align:left;background:#fff;border:0;border-bottom:1px solid var(--line);padding:13px 14px}
    .lead:hover,.lead.active{background:var(--soft)}
    .lead strong{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .lead span{display:block;margin-top:4px;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    main{min-width:0;display:grid;grid-template-rows:auto minmax(0,1fr)}
    .topbar{height:72px;border-bottom:1px solid var(--line);background:#fff;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 20px}
    .content{overflow:auto;padding:18px 20px 30px}
    .grid{display:grid;grid-template-columns:minmax(0,1fr) 430px;gap:16px;align-items:start}
    .panel{background:#fff;border:1px solid var(--line);border-radius:8px;padding:16px}
    .stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px}
    .stat{border:1px solid var(--line);background:#fff;border-radius:8px;padding:12px}
    .stat b{display:block;font-size:18px}
    .kv{display:grid;grid-template-columns:132px minmax(0,1fr);gap:9px 12px;font-size:13px}
    .kv div:nth-child(odd){font-weight:700;color:var(--ink)}
    .kv div:nth-child(even){color:var(--muted);overflow-wrap:anywhere}
    .badge{display:inline-flex;align-items:center;min-height:24px;border-radius:999px;padding:0 9px;background:var(--soft);font-size:12px;font-weight:700;color:var(--muted)}
    .badge.good{background:#e9f5ee;color:var(--good)}
    .badge.bad{background:#fff0ec;color:var(--bad)}
    .badge.warn{background:#fff7e6;color:var(--warn)}
    .events{display:grid;gap:8px}
    .event{border:1px solid var(--line);border-radius:6px;padding:10px;font-size:13px}
    .event strong{display:block;margin-bottom:4px}
    .event span{color:var(--muted)}
    .composer{display:grid;gap:10px}
    .previewFrame{width:100%;height:560px;border:1px solid var(--line);border-radius:8px;background:#fff}
    .actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .hidden{display:none!important}
    @media(max-width:980px){.shell{grid-template-columns:1fr}.topbar{position:sticky;top:0;z-index:2}aside{min-height:auto;border-right:0}.list{max-height:360px}.grid{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}}
  </style>
</head>
<body>
  <section id="login" class="login hidden">
    <form id="loginForm">
      <img class="logo" src="/assets/img/logo-280.png" alt="Stone Bellisimo LLC">
      <h1>Admin sign in</h1>
      <p class="muted">Use the dashboard credentials configured on the Worker.</p>
      <label for="username">Username</label>
      <input id="username" name="username" autocomplete="username" required>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <div style="height:16px"></div>
      <button class="btn gold" type="submit">Sign In</button>
      <div id="loginError" class="error"></div>
    </form>
  </section>

  <section id="app" class="shell hidden">
    <aside>
      <header>
        <img src="/assets/img/logo-280.png" alt="Stone Bellisimo LLC">
      </header>
      <div class="filters">
        <input id="search" placeholder="Search leads">
        <select id="status">
          <option value="all">All</option>
          <option value="needs_feedback">Needs feedback</option>
          <option value="feedback_sent">Feedback sent</option>
          <option value="feedback_received">Feedback received</option>
          <option value="email_failed">Email failed</option>
        </select>
      </div>
      <div id="leadList" class="list"></div>
    </aside>
    <main>
      <div class="topbar">
        <div>
          <h2 id="pageTitle">Form submissions</h2>
          <div id="count" class="muted"></div>
        </div>
        <button id="logout" class="btn ghost" type="button">Sign Out</button>
      </div>
      <div class="content">
        <div class="stats" id="stats"></div>
        <div class="grid">
          <div class="panel">
            <h2 id="leadTitle">Choose a lead</h2>
            <div id="leadDetail" class="kv"></div>
            <div style="height:18px"></div>
            <h2>Feedback</h2>
            <div id="feedback" class="events"></div>
            <div style="height:18px"></div>
            <h2>Email history</h2>
            <div id="events" class="events"></div>
          </div>
          <div class="panel">
            <h2>Email composer</h2>
            <div class="composer">
              <label for="template">Template</label>
              <select id="template">
                <option value="custom">Custom branded message</option>
                <option value="feedback_request">Feedback request</option>
                <option value="immediate_confirmation">Confirmation</option>
              </select>
              <label for="subject">Subject</label>
              <input id="subject" value="A note from Stone Bellisimo">
              <label for="message">Message</label>
              <textarea id="message">Thank you for reaching out to Stone Bellisimo. We wanted to follow up and see if there is anything else our team can help with.</textarea>
              <label for="ctaLabel">Button label</label>
              <input id="ctaLabel" placeholder="Optional">
              <label for="ctaUrl">Button URL</label>
              <input id="ctaUrl" placeholder="https://stonebellisimollc.com/contact-us/">
              <div class="actions">
                <button id="preview" class="btn ghost" type="button">Preview</button>
                <button id="send" class="btn gold" type="button">Send</button>
                <span id="composerStatus" class="muted"></span>
              </div>
              <iframe id="previewFrame" class="previewFrame" title="Email preview"></iframe>
            </div>
          </div>
        </div>
      </div>
    </main>
  </section>

  <script>
    const state = { leads: [], selected: null, selectedDetail: null };
    const $ = id => document.getElementById(id);

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: { 'content-type': 'application/json', ...(options.headers || {}) }
      });
      const data = await response.json().catch(() => ({ success: false, message: 'Invalid response.' }));
      if (!response.ok || data.success === false) {
        throw new Error(data.message || 'Request failed.');
      }
      return data;
    }

    function fmt(value) {
      if (!value) return '';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
    }

    function badge(text, type = '') {
      return '<span class="badge ' + type + '">' + escapeHtml(text || 'Unknown') + '</span>';
    }

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
    }

    function leadEmailState(lead) {
      if (lead.feedbackStatus === 'received' || lead.feedbackStatus === 'unparsed') return badge('Feedback received', 'good');
      if (lead.feedbackEmailLastError) return badge('Feedback failed', 'bad');
      if (lead.feedbackEmailSentAt) return badge('Feedback sent', 'warn');
      if (lead.immediateEmailSentAt) return badge('Confirmation sent', 'good');
      return badge('No email record');
    }

    function renderStats() {
      const total = state.leads.length;
      const confirmed = state.leads.filter(lead => lead.immediateEmailSentAt).length;
      const feedbackSent = state.leads.filter(lead => lead.feedbackEmailSentAt).length;
      const feedbackReceived = state.leads.filter(lead => ['received', 'unparsed'].includes(lead.feedbackStatus)).length;
      $('stats').innerHTML = [
        ['Showing', total],
        ['Confirmed', confirmed],
        ['Feedback sent', feedbackSent],
        ['Feedback received', feedbackReceived]
      ].map(([label, value]) => '<div class="stat"><b>' + value + '</b><span class="muted">' + label + '</span></div>').join('');
    }

    function renderLeadList() {
      $('leadList').innerHTML = state.leads.map(lead => {
        const active = state.selected === lead.id ? ' active' : '';
        return '<button class="lead' + active + '" data-id="' + escapeHtml(lead.id) + '"><strong>' + escapeHtml(lead.customerName) + '</strong><span>' + escapeHtml(lead.email) + '</span><span>' + leadEmailState(lead) + '</span></button>';
      }).join('') || '<div style="padding:16px" class="muted">No leads found.</div>';
      for (const button of document.querySelectorAll('.lead')) {
        button.addEventListener('click', () => selectLead(button.dataset.id));
      }
    }

    async function loadLeads() {
      const params = new URLSearchParams({
        search: $('search').value.trim(),
        status: $('status').value,
        limit: '50'
      });
      const data = await api('/api/admin/leads?' + params.toString());
      state.leads = data.leads || [];
      $('count').textContent = data.count + ' total record' + (data.count === 1 ? '' : 's');
      renderStats();
      renderLeadList();
      if (!state.selected && state.leads[0]) await selectLead(state.leads[0].id);
    }

    async function selectLead(id) {
      state.selected = id;
      renderLeadList();
      const data = await api('/api/admin/leads/' + encodeURIComponent(id));
      state.selectedDetail = data;
      const lead = data.lead;
      $('leadTitle').textContent = lead.customerName || 'Lead';
      $('leadDetail').innerHTML = [
        ['Email', lead.email],
        ['Phone', lead.phone],
        ['Submitted', fmt(lead.submittedAt)],
        ['Project', lead.projectType],
        ['Material', lead.material],
        ['Source', lead.source],
        ['Confirmation', lead.immediateEmailSentAt ? fmt(lead.immediateEmailSentAt) : 'Not sent'],
        ['Feedback due', fmt(lead.feedbackEmailDueAt)],
        ['Feedback sent', lead.feedbackEmailSentAt ? fmt(lead.feedbackEmailSentAt) : 'Not sent'],
        ['Feedback status', lead.feedbackStatus],
        ['Message', lead.message]
      ].map(([k,v]) => '<div>' + escapeHtml(k) + '</div><div>' + escapeHtml(v || '') + '</div>').join('');
      $('feedback').innerHTML = (data.feedback || []).map(item => '<div class="event"><strong>' + escapeHtml((item.rating ? item.rating + '/5 ' : '') + (item.source || 'Feedback')) + '</strong><span>' + fmt(item.receivedAt) + '</span><p>' + escapeHtml(item.comment || 'No comment provided.') + '</p></div>').join('') || '<p class="muted">No feedback yet.</p>';
      $('events').innerHTML = [
        ...(data.emailEvents || []).map(item => ({ title: item.eventType + ' - ' + item.status, meta: fmt(item.createdAt), body: item.subject || item.error || item.postmarkMessageId || '' })),
        ...(data.deliveryEvents || []).map(item => ({ title: 'Postmark ' + (item.eventType || 'event'), meta: fmt(item.receivedAt), body: item.messageId || item.recipient || '' })),
        ...(data.inboundEvents || []).map(item => ({ title: 'Inbound reply - ' + item.status, meta: fmt(item.receivedAt), body: item.subject || item.fromEmail || '' }))
      ].map(item => '<div class="event"><strong>' + escapeHtml(item.title) + '</strong><span>' + escapeHtml(item.meta) + '</span><p>' + escapeHtml(item.body) + '</p></div>').join('') || '<p class="muted">No email events yet.</p>';
      await previewEmail();
    }

    function composerPayload() {
      return {
        leadId: state.selected,
        template: $('template').value,
        subject: $('subject').value,
        message: $('message').value,
        ctaLabel: $('ctaLabel').value,
        ctaUrl: $('ctaUrl').value
      };
    }

    function updateComposerFields() {
      const custom = $('template').value === 'custom';
      $('subject').disabled = !custom;
      $('message').disabled = !custom;
      $('ctaLabel').disabled = !custom;
      $('ctaUrl').disabled = !custom;
    }

    async function previewEmail() {
      if (!state.selected) return;
      $('composerStatus').textContent = 'Rendering...';
      try {
        const data = await api('/api/admin/email/preview', { method: 'POST', body: JSON.stringify(composerPayload()) });
        $('previewFrame').srcdoc = data.html;
        $('composerStatus').textContent = 'Preview ready for ' + data.to;
      } catch (error) {
        $('composerStatus').textContent = error.message;
      }
    }

    async function sendEmail() {
      if (!state.selected) return;
      if (!confirm('Send this email to the selected client?')) return;
      $('send').disabled = true;
      $('composerStatus').textContent = 'Sending...';
      try {
        const data = await api('/api/admin/email/send', { method: 'POST', body: JSON.stringify(composerPayload()) });
        $('composerStatus').textContent = data.mock ? 'Mock email recorded.' : 'Email sent.';
        await selectLead(state.selected);
        await loadLeads();
      } catch (error) {
        $('composerStatus').textContent = error.message;
      } finally {
        $('send').disabled = false;
      }
    }

    async function boot() {
      try {
        await api('/api/admin/session');
        $('login').classList.add('hidden');
        $('app').classList.remove('hidden');
        await loadLeads();
      } catch {
        $('app').classList.add('hidden');
        $('login').classList.remove('hidden');
      }
    }

    $('loginForm').addEventListener('submit', async event => {
      event.preventDefault();
      $('loginError').textContent = '';
      const form = new FormData(event.currentTarget);
      try {
        await api('/api/admin/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(form.entries())) });
        await boot();
      } catch (error) {
        $('loginError').textContent = error.message;
      }
    });
    $('logout').addEventListener('click', async () => {
      await api('/api/admin/logout', { method: 'POST', body: '{}' }).catch(() => null);
      location.reload();
    });
    $('search').addEventListener('input', () => {
      clearTimeout(window.__leadSearchTimer);
      window.__leadSearchTimer = setTimeout(loadLeads, 250);
    });
    $('status').addEventListener('change', loadLeads);
    $('template').addEventListener('change', () => { updateComposerFields(); previewEmail(); });
    $('preview').addEventListener('click', previewEmail);
    $('send').addEventListener('click', sendEmail);
    updateComposerFields();
    boot();
  </script>
</body>
</html>`);
}

export async function handleAdminRequest(request, env, options = {}) {
  const url = new URL(request.url);

  if (url.pathname === '/admin' || url.pathname === '/admin/') {
    return adminPage();
  }

  if (url.pathname === '/api/admin/login') return handleLogin(request, env);
  if (url.pathname === '/api/admin/logout') return handleLogout(request);
  if (url.pathname === '/api/admin/session') {
    const unauthorized = await requireAdmin(request, env);
    if (unauthorized) return unauthorized;
    return json({ success: true, username: adminUsername(env) });
  }

  const unauthorized = options.firebaseAuthorized ? null : await requireAdmin(request, env);
  if (unauthorized) return unauthorized;

  if (url.pathname === '/api/admin/leads' && request.method === 'GET') {
    return listLeads(request, env, options);
  }

  const leadMatch = url.pathname.match(/^\/api\/admin\/leads\/([^/]+)$/);
  if (leadMatch && request.method === 'GET') {
    return getLeadDetail(request, env, decodeURIComponent(leadMatch[1]), options);
  }

  if (url.pathname === '/api/admin/email/preview') return previewEmail(request, env, options);
  if (url.pathname === '/api/admin/email/send') return sendEmail(request, env, options);

  return json({ success: false, message: 'Admin endpoint not found.' }, 404);
}
