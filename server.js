const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const DATA_DIR = path.join(__dirname, '.data');
const DATA_FILE = path.join(DATA_DIR, 'lead-automation.json');

// Middleware
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      frameSrc: ['https://www.google.com', 'https://maps.google.com'],
      formAction: ["'self'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false
}));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

if (allowedOrigins.length > 0) {
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    }
  }));
}

app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

app.get('/favicon.ico', (req, res) => {
  res.redirect(302, '/assets/img/logo-280.png');
});

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (/\.(?:avif|jpe?g|png|gif|svg|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000');
      return;
    }

    if (/\.(?:js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return;
    }

    if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please wait a few minutes and try again.'
  }
});

const performanceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many performance reports.'
  }
});

const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many webhook requests.'
  }
});

let automationModulePromise;
let googleReviewsModulePromise;

function automationModule() {
  if (!automationModulePromise) {
    automationModulePromise = import('./src/lead-automation.mjs');
  }
  return automationModulePromise;
}

function googleReviewsModule() {
  if (!googleReviewsModulePromise) {
    googleReviewsModulePromise = import('./src/google-reviews.mjs');
  }
  return googleReviewsModulePromise;
}

function emptyLocalData() {
  return {
    leads: [],
    emailEvents: [],
    feedback: [],
    inboundEvents: [],
    deliveryEvents: []
  };
}

async function readLocalData() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    return { ...emptyLocalData(), ...JSON.parse(raw) };
  } catch (error) {
    if (error.code === 'ENOENT') return emptyLocalData();
    throw error;
  }
}

async function writeLocalData(data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmpFile = `${DATA_FILE}.tmp`;
  await fs.writeFile(tmpFile, JSON.stringify(data, null, 2));
  await fs.rename(tmpFile, DATA_FILE);
}

async function mutateLocalData(mutator) {
  const data = await readLocalData();
  const result = await mutator(data);
  await writeLocalData(data);
  return result;
}

function localId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function localEnv(req) {
  const fallbackOrigin = req
    ? `${req.protocol}://${req.get('host') || `localhost:${PORT}`}`
    : `http://localhost:${PORT}`;
  const baseUrl = process.env.PUBLIC_SITE_URL || process.env.APP_BASE_URL || fallbackOrigin;

  return {
    ...process.env,
    ENVIRONMENT: isProduction ? 'production' : 'development',
    PUBLIC_SITE_URL: baseUrl,
    APP_BASE_URL: baseUrl,
    POSTMARK_MOCK_MODE: process.env.POSTMARK_MOCK_MODE || (isProduction ? 'false' : 'true'),
    POSTMARK_INBOUND_SECRET: process.env.POSTMARK_INBOUND_SECRET || (isProduction ? '' : 'local-dev-inbound-secret')
  };
}

function headersFromExpress(req, extra = {}) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(name, value.join(', '));
    else if (value !== undefined) headers.set(name, String(value));
  }
  for (const [name, value] of Object.entries(extra)) {
    if (value === undefined || value === null) headers.delete(name);
    else headers.set(name, String(value));
  }
  return headers;
}

function absoluteRequestUrl(req) {
  const origin = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host') || `localhost:${PORT}`}`;
  return new URL(req.originalUrl || req.url, origin).toString();
}

function makeFetchRequest(req, { body, contentType } = {}) {
  const init = {
    method: req.method,
    headers: headersFromExpress(req, contentType ? { 'content-type': contentType } : {})
  };

  if (!['GET', 'HEAD'].includes(req.method) && body !== undefined) {
    init.body = body;
  }

  return new Request(absoluteRequestUrl(req), init);
}

async function sendFetchResponse(res, response) {
  response.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
  res.status(response.status);
  const buffer = Buffer.from(await response.arrayBuffer());
  res.send(buffer);
}

const localStore = {
  async countRecentByIpHash(ipHash, sinceIso) {
    const data = await readLocalData();
    return data.leads.filter(lead => lead.ipHash === ipHash && lead.submittedAt >= sinceIso).length;
  },

  async createLead(lead) {
    await mutateLocalData(data => {
      data.leads.push(lead);
    });
    return lead;
  },

  async getLeadById(id) {
    const data = await readLocalData();
    return data.leads.find(lead => lead.id === id) || null;
  },

  async markImmediateEmailSent(id, sentAt, messageId) {
    await mutateLocalData(data => {
      const lead = data.leads.find(item => item.id === id);
      if (!lead) return;
      lead.immediateEmailSentAt = sentAt;
      lead.postmarkImmediateMessageId = messageId || null;
      lead.updatedAt = sentAt;
    });
  },

  async getDueFeedbackLeads(now, staleBefore, limit, maxAttempts) {
    const data = await readLocalData();
    return data.leads
      .filter(lead => (
        lead.feedbackEmailDueAt <= now &&
        !lead.feedbackEmailSentAt &&
        !['received', 'unparsed'].includes(lead.feedbackStatus || 'pending') &&
        Number(lead.feedbackEmailAttemptCount || 0) < maxAttempts &&
        (!lead.feedbackEmailClaimedAt || lead.feedbackEmailClaimedAt <= staleBefore)
      ))
      .sort((a, b) => a.feedbackEmailDueAt.localeCompare(b.feedbackEmailDueAt))
      .slice(0, limit);
  },

  async claimFeedbackLead(id, claimedAt, staleBefore) {
    return mutateLocalData(data => {
      const lead = data.leads.find(item => item.id === id);
      if (!lead) return false;
      const canClaim = !lead.feedbackEmailSentAt &&
        !['received', 'unparsed'].includes(lead.feedbackStatus || 'pending') &&
        (!lead.feedbackEmailClaimedAt || lead.feedbackEmailClaimedAt <= staleBefore);
      if (!canClaim) return false;
      lead.feedbackEmailClaimedAt = claimedAt;
      lead.feedbackStatus = 'sending';
      lead.updatedAt = claimedAt;
      return true;
    });
  },

  async markFeedbackSent(id, sentAt, messageId) {
    await mutateLocalData(data => {
      const lead = data.leads.find(item => item.id === id);
      if (!lead) return;
      lead.feedbackEmailSentAt = sentAt;
      lead.feedbackEmailClaimedAt = null;
      lead.feedbackStatus = 'sent';
      lead.feedbackEmailLastError = null;
      lead.postmarkFeedbackMessageId = messageId || null;
      lead.updatedAt = sentAt;
    });
  },

  async markFeedbackSendFailed(id, failedAt, errorMessage) {
    await mutateLocalData(data => {
      const lead = data.leads.find(item => item.id === id);
      if (!lead) return;
      lead.feedbackEmailClaimedAt = null;
      lead.feedbackStatus = 'pending';
      lead.feedbackEmailAttemptCount = Number(lead.feedbackEmailAttemptCount || 0) + 1;
      lead.feedbackEmailLastError = String(errorMessage || '').slice(0, 1000);
      lead.updatedAt = failedAt;
    });
  },

  async saveFeedback(feedback) {
    return mutateLocalData(data => {
      const lead = data.leads.find(item => item.id === feedback.leadId);
      const accepted = Boolean(lead && lead.feedbackStatus !== 'received');
      if (accepted) {
        lead.rating = feedback.rating;
        lead.feedbackComment = feedback.comment;
        lead.feedbackReceivedAt = feedback.receivedAt;
        lead.feedbackStatus = 'received';
        lead.feedbackSource = feedback.source;
        lead.updatedAt = feedback.receivedAt;
      }
      data.feedback.push({
        id: localId('feedback'),
        ...feedback,
        status: accepted ? 'accepted' : 'duplicate',
        createdAt: feedback.receivedAt
      });
      return { accepted };
    });
  },

  async saveUnparsedFeedback(feedback) {
    return mutateLocalData(data => {
      const lead = data.leads.find(item => item.id === feedback.leadId);
      const accepted = Boolean(lead && lead.feedbackStatus !== 'received');
      if (accepted) {
        lead.feedbackComment = feedback.comment;
        lead.feedbackReceivedAt = feedback.receivedAt;
        lead.feedbackStatus = 'unparsed';
        lead.feedbackSource = feedback.source;
        lead.updatedAt = feedback.receivedAt;
      }
      data.feedback.push({
        id: localId('feedback'),
        ...feedback,
        status: accepted ? 'unparsed' : 'duplicate',
        createdAt: feedback.receivedAt
      });
      return { accepted };
    });
  },

  async saveEmailEvent(event) {
    await mutateLocalData(data => {
      data.emailEvents.push({ id: localId('email_event'), ...event, createdAt: event.createdAt || new Date().toISOString() });
    });
  },

  async saveInboundEvent(event) {
    await mutateLocalData(data => {
      data.inboundEvents.push({ id: localId('inbound_event'), ...event, createdAt: event.createdAt || new Date().toISOString() });
    });
  },

  async saveDeliveryEvent(event) {
    await mutateLocalData(data => {
      data.deliveryEvents.push({ id: localId('delivery_event'), ...event, createdAt: event.createdAt || new Date().toISOString() });
    });
  }
};

function normalizeText(value, maxLength, { preserveLines = false } = {}) {
  if (typeof value !== 'string') return '';

  const controlChars = preserveLines ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
  return value
    .replace(controlChars, ' ')
    .replace(preserveLines ? /[ \t]+/g : /\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function validatePerformanceMetric(body) {
  const name = normalizeText(body.name, 12).toUpperCase();
  const value = Number(body.value);
  const allowedNames = new Set(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']);

  if (!allowedNames.has(name) || !Number.isFinite(value) || value < 0) {
    return { error: 'Invalid performance metric.' };
  }

  return {
    payload: {
      id: normalizeText(body.id, 80),
      name,
      value,
      rating: normalizeText(body.rating, 24),
      page: normalizeText(body.page, 160),
      navigationType: normalizeText(body.navigationType, 40),
      timestamp: Number.isFinite(Number(body.timestamp)) ? Number(body.timestamp) : Date.now()
    }
  };
}

app.post('/api/performance', performanceLimiter, (req, res) => {
  const { payload: metric, error } = validatePerformanceMetric(req.body || {});

  if (error) {
    return res.status(400).json({ success: false, message: error });
  }

  console.info('Performance metric:', metric);
  res.status(204).send();
});

app.all('/api/google-reviews', performanceLimiter, async (req, res) => {
  try {
    const { handleGoogleReviewsRequest } = await googleReviewsModule();
    const response = await handleGoogleReviewsRequest(makeFetchRequest(req), localEnv(req));
    await sendFetchResponse(res, response);
  } catch (error) {
    console.error('Error handling Google reviews request:', error);
    res.status(500).json({ success: false, message: 'An internal error occurred.' });
  }
});

// API Endpoint for Contact Form
app.all('/api/contact', contactLimiter, async (req, res) => {
  try {
    const { handleContactRequest } = await automationModule();
    const request = makeFetchRequest(req, {
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {}),
      contentType: 'application/json'
    });
    const response = await handleContactRequest(request, localEnv(req), {
      store: localStore,
      requireWebhook: isProduction,
      allowLocalWebhook: !isProduction
    });
    await sendFetchResponse(res, response);
  } catch (error) {
    console.error('Error handling contact form submission:', error);
    res.status(500).json({ success: false, message: 'An internal error occurred. Please try again later.' });
  }
});

app.all('/feedback', async (req, res) => {
  try {
    const { handleFeedbackRequest } = await automationModule();
    const isPost = req.method === 'POST';
    const request = makeFetchRequest(req, {
      body: isPost ? new URLSearchParams(req.body || {}).toString() : undefined,
      contentType: isPost ? 'application/x-www-form-urlencoded' : undefined
    });
    const response = await handleFeedbackRequest(request, localEnv(req), { store: localStore });
    await sendFetchResponse(res, response);
  } catch (error) {
    console.error('Error handling feedback request:', error);
    res.status(500).send('An internal error occurred.');
  }
});

app.all('/api/postmark/inbound', webhookLimiter, async (req, res) => {
  try {
    const { handlePostmarkInboundRequest } = await automationModule();
    const request = makeFetchRequest(req, {
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {}),
      contentType: 'application/json'
    });
    const response = await handlePostmarkInboundRequest(request, localEnv(req), { store: localStore });
    await sendFetchResponse(res, response);
  } catch (error) {
    console.error('Error handling Postmark inbound webhook:', error);
    res.status(500).json({ success: false, message: 'An internal error occurred.' });
  }
});

app.all('/api/postmark/webhook', webhookLimiter, async (req, res) => {
  try {
    const { handlePostmarkWebhookRequest } = await automationModule();
    const request = makeFetchRequest(req, {
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {}),
      contentType: 'application/json'
    });
    const response = await handlePostmarkWebhookRequest(request, localEnv(req), { store: localStore });
    await sendFetchResponse(res, response);
  } catch (error) {
    console.error('Error handling Postmark event webhook:', error);
    res.status(500).json({ success: false, message: 'An internal error occurred.' });
  }
});

if (!isProduction) {
  app.post('/api/dev/run-feedback-cron', async (req, res) => {
    try {
      const { processDueFeedbackEmails } = await automationModule();
      const result = await processDueFeedbackEmails(localEnv(req), { store: localStore });
      res.json({ success: true, result });
    } catch (error) {
      console.error('Error running local feedback cron:', error);
      res.status(500).json({ success: false, message: 'Could not run feedback cron.' });
    }
  });
}

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Request is too large.' });
  }

  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ success: false, message: 'Invalid JSON request.' });
  }

  console.error('Unhandled request error:', error);
  res.status(500).json({ success: false, message: 'An internal error occurred. Please try again later.' });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
