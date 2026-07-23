import { createHash, timingSafeEqual } from 'node:crypto';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { beforeUserCreated, beforeUserSignedIn, HttpsError } from 'firebase-functions/v2/identity';
import { defineSecret, defineString } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  handleContactRequest,
  handleFeedbackRequest,
  handlePostmarkInboundRequest,
  handlePostmarkWebhookRequest,
  json,
  processDueFeedbackEmails,
  SECURITY_HEADERS
} from './src/lead-automation.mjs';
import { handleAdminRequest } from './src/admin-dashboard.mjs';
import { handleGoogleReviewsRequest } from './src/google-reviews.mjs';
import { createFirestoreStore } from './src/firebase-store.mjs';
import {
  handleAdminAnalytics,
  aggregateAnalyticsEvent,
  createLeadWithServerConversion,
  handleAnalyticsEvents,
  recordServerConversion,
  sanitizeAttribution
} from './src/analytics.mjs';
import {
  handleAdminSearchConsole,
  readSearchConsoleHealth,
  syncRecentSearchConsole
} from './src/search-console.mjs';
import { authorizeAdminRequest, verifyAppCheckRequest, verifyPublicOrigin } from './src/firebase-security.mjs';
import { adminAllowlist, evaluateAdminSignIn } from './src/admin-accounts.mjs';
import {
  buildCustomerReplyAlert,
  buildDeliveryProblemAlert,
  buildEmailFailureAlert,
  buildNewLeadAlert,
  buildNoLeadsAlert,
  buildSearchConsoleFailureAlert,
  buildWeeklyDigestAlert,
  claimNotificationSlot,
  COOLDOWNS,
  isAdminNotificationEvent,
  isDeliveryProblem,
  isUnansweredReply,
  NOTIFICATION_TYPES,
  sendAdminNotification,
  summarizeLeadWindow
} from './src/admin-notifications.mjs';

const SECRET_NAMES = [
  'SB_PROXY_SECRET',
  'N8N_WEBHOOK_URL',
  'POSTMARK_SERVER_TOKEN',
  'FEEDBACK_TOKEN_SECRET',
  'POSTMARK_INBOUND_SECRET',
  'POSTMARK_WEBHOOK_SECRET',
  'GOOGLE_MAPS_API_KEY',
  'GOOGLE_MAPS_BROWSER_API_KEY'
];
const SECRETS = Object.fromEntries(SECRET_NAMES.map(name => [name, defineSecret(name)]));
const SECRET_PARAMETERS = Object.values(SECRETS);

// The runtime service account is a deploy-time option resolved during the CLI's
// code-analysis phase, not at container runtime. A plain process.env read here
// is not populated at analysis time, and calling .value() on a param in a
// config returns a deferred sentinel rather than the literal — so the Param
// object is passed to setGlobalOptions directly and firebase-functions resolves
// it from .env.<project> when building the deploy manifest. The default is the
// dedicated least-privilege runtime identity; override it in .env to roll back
// to the platform default compute account.
const runtimeServiceAccount = defineString('FUNCTIONS_SERVICE_ACCOUNT', {
  default: 'functions-runtime@stone-bellisimo-dashboard.iam.gserviceaccount.com'
});

if (!getApps().length) initializeApp();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
const store = createFirestoreStore(db);

setGlobalOptions({
  region: 'us-east1',
  maxInstances: 10,
  memory: '256MiB',
  serviceAccount: runtimeServiceAccount
});

function secretValue(name) {
  try {
    return SECRETS[name]?.value() || process.env[name] || '';
  } catch {
    return process.env[name] || '';
  }
}

function runtimeEnv() {
  return {
    ...process.env,
    ENVIRONMENT: process.env.ENVIRONMENT || 'production',
    PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL || 'https://stonebellisimollc.com',
    POSTMARK_FROM_EMAIL: process.env.POSTMARK_FROM_EMAIL || 'admin@stonebellisimollc.com',
    POSTMARK_MESSAGE_STREAM: process.env.POSTMARK_MESSAGE_STREAM || 'outbound',
    POSTMARK_FEEDBACK_REPLY_DOMAIN: process.env.POSTMARK_FEEDBACK_REPLY_DOMAIN || 'stonebellisimollc.com',
    BUSINESS_NOTIFICATION_EMAIL: process.env.BUSINESS_NOTIFICATION_EMAIL || 'cesaryunda@hotmail.com',
    BUSINESS_REPLY_TO_EMAIL: process.env.BUSINESS_REPLY_TO_EMAIL || 'cesaryunda@hotmail.com',
    FEEDBACK_DELAY_DAYS: process.env.FEEDBACK_DELAY_DAYS || '7',
    GOOGLE_PLACE_ID: process.env.GOOGLE_PLACE_ID || 'ChIJVbaFyYZXwokRgfG3kFqd5MY',
    GOOGLE_REVIEWS_LIMIT: process.env.GOOGLE_REVIEWS_LIMIT || '5',
    GOOGLE_REVIEWS_CACHE_SECONDS: process.env.GOOGLE_REVIEWS_CACHE_SECONDS || '900',
    SEARCH_CONSOLE_SITE_URL: process.env.SEARCH_CONSOLE_SITE_URL || 'sc-domain:stonebellisimollc.com',
    ...Object.fromEntries(SECRET_NAMES.map(name => [name, secretValue(name)]))
  };
}

function fixedHash(value) {
  return createHash('sha256').update(String(value || '')).digest();
}

function safeEqual(left, right) {
  return timingSafeEqual(fixedHash(left), fixedHash(right));
}

function isEmulator() {
  return Boolean(process.env.FUNCTIONS_EMULATOR || process.env.FIRESTORE_EMULATOR_HOST);
}

function requireProxy(request) {
  const expected = secretValue('SB_PROXY_SECRET');
  const provided = request.headers.get('x-sb-proxy-secret') || '';
  // Firebase Hosting's local rewrite calls the Functions emulator directly;
  // there is no Cloudflare Worker available to attach the production secret.
  if (isEmulator() && !provided) return null;
  if (!expected && isEmulator()) return null;
  if (!expected) return json({ success: false, message: 'Backend proxy is not configured.' }, 503);
  return safeEqual(provided, expected)
    ? null
    : json({ success: false, message: 'Unauthorized proxy request.' }, 401);
}

async function requireFirebaseAdmin(request) {
  const result = await authorizeAdminRequest(request, (...args) => getAuth().verifyIdToken(...args));
  return result.ok ? { token: result.token } : { response: json({ success: false, message: result.message }, result.status) };
}

async function requireAppCheck(request, env) {
  const enforced = String(env.APP_CHECK_ENFORCED || '').toLowerCase() === 'true';
  const result = await verifyAppCheckRequest(request, token => getAppCheck().verifyToken(token), enforced);
  if (result.monitored) {
    console.warn(JSON.stringify({ message: 'App Check monitor-mode request', path: new URL(request.url).pathname }));
  }
  return result.ok ? null : json({ success: false, message: result.message }, result.status);
}

function requireTrustedOrigin(request, env) {
  const site = env.PUBLIC_SITE_URL || 'https://stonebellisimollc.com';
  let www = 'https://www.stonebellisimollc.com';
  try {
    const url = new URL(site);
    if (!url.hostname.startsWith('www.')) {
      url.hostname = `www.${url.hostname}`;
      www = url.origin;
    }
  } catch {}
  const configured = String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  const result = verifyPublicOrigin(request, [site, www, ...configured], isEmulator());
  return result.ok ? null : json({ success: false, message: result.message }, result.status);
}

function toFetchRequest(request) {
  const forwardedHost = request.get('x-forwarded-host') || request.get('host') || 'stonebellisimollc.com';
  const forwardedProto = request.get('x-forwarded-proto') || 'https';
  const url = new URL(request.originalUrl || request.url || '/', `${forwardedProto}://${forwardedHost}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) headers.set(name, value.join(', '));
    else if (value !== undefined) headers.set(name, String(value));
  }
  const init = { method: request.method, headers };
  if (!['GET', 'HEAD'].includes(request.method) && request.rawBody?.length) init.body = request.rawBody;
  return new Request(url, init);
}

async function sendFetchResponse(response, result) {
  response.status(result.status);
  for (const [name, value] of result.headers) response.setHeader(name, value);
  if (!result.body) {
    response.end();
    return;
  }
  response.send(Buffer.from(await result.arrayBuffer()));
}

function firebaseClientConfig(env) {
  let runtimeConfig = {};
  try { runtimeConfig = JSON.parse(process.env.FIREBASE_CONFIG || '{}'); } catch {}
  const projectId = process.env.GCLOUD_PROJECT || process.env.SB_FIREBASE_PROJECT_ID || runtimeConfig.projectId || '';
  const emulator = isEmulator();
  const apiKey = process.env.SB_FIREBASE_WEB_API_KEY || (emulator ? 'demo-api-key' : '');
  const appId = process.env.SB_FIREBASE_APP_ID || (emulator ? '1:123456789:web:demo' : '');
  return {
    configured: Boolean(apiKey && projectId),
    emulator,
    authEmulatorUrl: emulator ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}` : '',
    firebaseConfig: {
      apiKey,
      authDomain: process.env.SB_FIREBASE_AUTH_DOMAIN || (projectId ? `${projectId}.firebaseapp.com` : ''),
      projectId,
      appId
    },
    appCheckSiteKey: process.env.SB_FIREBASE_APPCHECK_SITE_KEY || ''
  };
}

async function routeRequest(request) {
  const env = runtimeEnv();
  const url = new URL(request.url);

  if (url.pathname === '/api/firebase-config') return json({ success: true, ...firebaseClientConfig(env) });

  if (url.pathname.startsWith('/api/admin/')) {
    const admin = await requireFirebaseAdmin(request);
    if (admin.response) return admin.response;
    if (['/api/admin/login', '/api/admin/logout', '/api/admin/session'].includes(url.pathname)) {
      return json({ success: false, message: 'This endpoint was replaced by Firebase Authentication.' }, 404);
    }
    if (url.pathname === '/api/admin/analytics') return handleAdminAnalytics(request, db);
    if (url.pathname === '/api/admin/search-console') return handleAdminSearchConsole(request, db, env);
    return handleAdminRequest(request, env, { firebaseAuthorized: true, store, adminStore: store });
  }

  if (url.pathname === '/api/analytics/events') {
    const origin = requireTrustedOrigin(request, env);
    if (origin) return origin;
    const appCheck = await requireAppCheck(request, env);
    if (appCheck) return appCheck;
    return handleAnalyticsEvents(request, db);
  }

  if (url.pathname === '/api/contact') {
    const origin = requireTrustedOrigin(request, env);
    if (origin) return origin;
    const appCheck = await requireAppCheck(request, env);
    if (appCheck) return appCheck;
    return handleContactRequest(request, env, {
      store,
      requireWebhook: true,
      sanitizeAttribution,
      recordAnalytics: event => recordServerConversion(db, event),
      createLeadWithAnalytics: (lead, event) => createLeadWithServerConversion(db, lead, event)
    });
  }

  if (url.pathname === '/api/google-reviews') return handleGoogleReviewsRequest(request, env);
  if (url.pathname === '/api/google-map-config') {
    const apiKey = env.GOOGLE_MAPS_BROWSER_API_KEY || '';
    return json({ configured: Boolean(apiKey), apiKey }, 200, {
      'cache-control': apiKey ? 'public, max-age=300' : 'no-store'
    });
  }
  if (url.pathname === '/feedback') return handleFeedbackRequest(request, env, { store });
  if (url.pathname === '/api/postmark/inbound') return handlePostmarkInboundRequest(request, env, { store });
  if (url.pathname === '/api/postmark/webhook') return handlePostmarkWebhookRequest(request, env, { store });
  if (url.pathname === '/api/performance') return new Response(null, { status: 204, headers: SECURITY_HEADERS });
  return json({ success: false, message: 'Endpoint not found.' }, 404);
}

export const siteApi = onRequest({ secrets: SECRET_PARAMETERS }, async (request, response) => {
  try {
    const fetchRequest = toFetchRequest(request);
    const proxyError = requireProxy(fetchRequest);
    const result = proxyError || await routeRequest(fetchRequest);
    await sendFetchResponse(response, result);
  } catch (error) {
    console.error(JSON.stringify({ message: 'Firebase API request failed', error: error?.message || String(error) }));
    await sendFetchResponse(response, json({ success: false, message: 'An internal error occurred.' }, 500));
  }
});

// Google and password sign-in both pass through these blocking functions, so an
// approved administrator is provisioned on first sign-in and everyone else is
// rejected before an account exists. They replace manual claim provisioning.
function enforceAdminAllowlist(event, eventType) {
  const email = event.data?.email || event.additionalUserInfo?.profile?.email || '';
  const decision = evaluateAdminSignIn(email, { allowlist: adminAllowlist(process.env), emulator: isEmulator() });
  if (!decision.allowed) {
    console.warn(JSON.stringify({ message: 'Blocked non-administrator authentication', eventType, email }));
    throw new HttpsError('permission-denied', decision.message);
  }
  if (!decision.admin) return;
  return { customClaims: { ...(event.data?.customClaims || {}), admin: true } };
}

export const restrictAdminSignUp = beforeUserCreated(event => enforceAdminAllowlist(event, 'beforeCreate'));

export const restrictAdminSignIn = beforeUserSignedIn(event => enforceAdminAllowlist(event, 'beforeSignIn'));

export const summarizeAnalyticsEvent = onDocumentCreated('analytics_events/{eventId}', async event => {
  if (!event.data) return;
  await aggregateAnalyticsEvent(db, event.params.eventId, event.data.data());
});

// Staff alerts below. Firestore delivers these triggers at least once, so each
// one claims a slot keyed by the document it reacts to before sending; a
// redelivered event finds the slot taken and sends nothing.
const HOUR_MS = 60 * 60 * 1000;

export const notifyNewLead = onDocumentCreated({
  document: 'leads/{leadId}',
  secrets: SECRET_PARAMETERS
}, async event => {
  const data = event.data?.data();
  if (!data) return;
  // QA submissions are already hidden from reporting; they should not ring phones either.
  if (data.attribution?.trafficClass === 'test') return;
  if (!await claimNotificationSlot(db, `lead:${event.params.leadId}`, COOLDOWNS.perDocument, Date.now())) return;

  const env = runtimeEnv();
  const lead = { ...data, id: event.params.leadId };
  await sendAdminNotification({
    env,
    store,
    type: NOTIFICATION_TYPES.newLead,
    alert: buildNewLeadAlert(lead, env),
    lead,
    // Replying to the alert reaches the customer, not the alert system.
    replyTo: lead.email || ''
  });
});

export const notifyUnansweredReply = onDocumentCreated({
  document: 'postmark_inbound_events/{eventId}',
  secrets: SECRET_PARAMETERS
}, async event => {
  const data = event.data?.data();
  // Replies that matched a lead already notified through the feedback path.
  if (!data || !isUnansweredReply(data)) return;
  if (!await claimNotificationSlot(db, `inbound:${event.params.eventId}`, COOLDOWNS.perDocument, Date.now())) return;

  const env = runtimeEnv();
  await sendAdminNotification({
    env,
    store,
    type: NOTIFICATION_TYPES.customerReply,
    alert: buildCustomerReplyAlert(data, env),
    replyTo: data.fromEmail || ''
  });
});

export const notifyDeliveryProblem = onDocumentCreated({
  document: 'postmark_delivery_events/{eventId}',
  secrets: SECRET_PARAMETERS
}, async event => {
  const data = event.data?.data();
  if (!data || !isDeliveryProblem(data)) return;
  if (!await claimNotificationSlot(db, `delivery:${event.params.eventId}`, COOLDOWNS.perDocument, Date.now())) return;

  const env = runtimeEnv();
  await sendAdminNotification({
    env,
    store,
    type: NOTIFICATION_TYPES.deliveryProblem,
    alert: buildDeliveryProblemAlert(data, env),
    metadata: { delivery_event: data.eventType || '' }
  });
});

export const notifyEmailFailure = onDocumentCreated({
  document: 'email_events/{eventId}',
  secrets: SECRET_PARAMETERS
}, async event => {
  const data = event.data?.data();
  if (!data || data.status !== 'failed') return;
  // The guard that stops a failing alert from alerting about itself forever.
  if (isAdminNotificationEvent(data.eventType)) return;
  if (!await claimNotificationSlot(db, 'email_failure', COOLDOWNS.emailFailure, Date.now())) return;

  const env = runtimeEnv();
  await sendAdminNotification({
    env,
    store,
    type: NOTIFICATION_TYPES.emailFailure,
    alert: buildEmailFailureAlert(data, env),
    metadata: { failed_event: data.eventType || '' }
  });
});

// A broken contact form produces no errors at all, only silence. This is the
// only check that treats silence itself as the symptom.
export const leadWatchdogSchedule = onSchedule({
  schedule: '0 9 * * *',
  timeZone: 'America/New_York',
  secrets: SECRET_PARAMETERS
}, async () => {
  const env = runtimeEnv();
  const hours = Number(env.NO_LEADS_ALERT_HOURS || 72);
  const latest = await store.getLatestLead();
  const lastMs = latest?.submittedAt ? new Date(latest.submittedAt).getTime() : 0;
  if (lastMs && Date.now() - lastMs < hours * HOUR_MS) return;
  if (!await claimNotificationSlot(db, 'no_leads', COOLDOWNS.noLeads, Date.now())) return;

  await sendAdminNotification({
    env,
    store,
    type: NOTIFICATION_TYPES.noLeads,
    alert: buildNoLeadsAlert({ hours, lastLead: latest }, env)
  });
});

export const weeklyDigestSchedule = onSchedule({
  schedule: '0 8 * * 1',
  timeZone: 'America/New_York',
  secrets: SECRET_PARAMETERS
}, async () => {
  const env = runtimeEnv();
  const until = new Date();
  const since = new Date(until.getTime() - 7 * 24 * HOUR_MS);
  const leads = await store.listLeadsSince(since.toISOString(), 1000);
  const summary = summarizeLeadWindow(leads);
  if (!await claimNotificationSlot(db, `digest:${since.toISOString().slice(0, 10)}`, 6 * 24 * HOUR_MS, Date.now())) return;

  await sendAdminNotification({
    env,
    store,
    type: NOTIFICATION_TYPES.weeklyDigest,
    alert: buildWeeklyDigestAlert({ summary, since: since.toISOString(), until: until.toISOString() }, env),
    metadata: { lead_count: summary.total }
  });
});

export const processFeedbackSchedule = onSchedule({
  schedule: '0 * * * *',
  timeZone: 'America/New_York',
  secrets: SECRET_PARAMETERS
}, async event => {
  const result = await processDueFeedbackEmails(runtimeEnv(), { store });
  console.info(JSON.stringify({ message: 'Feedback schedule processed', scheduleTime: event.scheduleTime, ...result }));
});

export const importSearchConsoleSchedule = onSchedule({
  schedule: '15 5 * * *',
  timeZone: 'America/New_York',
  // Needed to send the failure alert; the import itself uses the runtime
  // service account's Application Default Credentials.
  secrets: SECRET_PARAMETERS
}, async event => {
  const env = runtimeEnv();
  try {
    const result = await syncRecentSearchConsole(db, env);
    console.info(JSON.stringify({ message: 'Search Console import completed', scheduleTime: event.scheduleTime, ...result }));
  } catch (error) {
    console.error(JSON.stringify({ message: 'Search Console import failed', error: error?.message || String(error) }));

    // This ran unnoticed for days before anyone read a log, which is the exact
    // failure this alert exists to prevent.
    const health = await readSearchConsoleHealth(db);
    if (await claimNotificationSlot(db, 'search_console_failure', COOLDOWNS.searchConsoleFailure, Date.now())) {
      await sendAdminNotification({
        env,
        store,
        type: NOTIFICATION_TYPES.searchConsoleFailure,
        alert: buildSearchConsoleFailureAlert({
          errorCode: error?.status || null,
          consecutiveFailures: Number(health?.consecutiveFailures || 1),
          lastSuccessAt: health?.lastSuccessAt || null,
          siteUrl: env.SEARCH_CONSOLE_SITE_URL || 'sc-domain:stonebellisimollc.com',
          serviceAccount: env.FUNCTIONS_SERVICE_ACCOUNT || 'the Functions runtime service account'
        }, env),
        metadata: { error_code: error?.status || 'error' }
      });
    }
    throw error;
  }
});
