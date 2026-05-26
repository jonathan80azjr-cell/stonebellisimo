const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

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

const FIELD_LIMITS = {
  firstName: 80,
  lastName: 80,
  email: 254,
  phone: 30,
  projectType: 120,
  material: 80,
  source: 80,
  message: 1000
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

function validateContact(body) {
  const payload = {
    firstName: normalizeText(body.firstName, FIELD_LIMITS.firstName),
    lastName: normalizeText(body.lastName, FIELD_LIMITS.lastName),
    email: normalizeText(body.email, FIELD_LIMITS.email).toLowerCase(),
    phone: normalizeText(body.phone, FIELD_LIMITS.phone),
    projectType: normalizeText(body.projectType, FIELD_LIMITS.projectType),
    material: normalizeText(body.material, FIELD_LIMITS.material),
    source: normalizeText(body.source, FIELD_LIMITS.source),
    message: normalizeText(body.message, FIELD_LIMITS.message, { preserveLines: true })
  };

  if (!payload.firstName || !payload.lastName || !payload.email || !payload.phone) {
    return { error: 'Please fill out all required fields.' };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return { error: 'Please enter a valid email address.' };
  }

  return { payload };
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

function getWebhookUrl() {
  const rawUrl = process.env.N8N_WEBHOOK_URL;
  if (!rawUrl || rawUrl === 'YOUR_N8N_WEBHOOK_URL_HERE') return null;

  try {
    const webhookUrl = new URL(rawUrl);
    const isLocalWebhook = ['localhost', '127.0.0.1', '::1'].includes(webhookUrl.hostname);

    if (webhookUrl.protocol !== 'https:' && !(webhookUrl.protocol === 'http:' && isLocalWebhook && !isProduction)) {
      throw new Error('Webhook URL must use HTTPS outside local development.');
    }

    return webhookUrl.toString();
  } catch (error) {
    console.error('Invalid N8N_WEBHOOK_URL:', error.message);
    return null;
  }
}

app.post('/api/performance', performanceLimiter, (req, res) => {
  const { payload: metric, error } = validatePerformanceMetric(req.body || {});

  if (error) {
    return res.status(400).json({ success: false, message: error });
  }

  console.info('Performance metric:', metric);
  res.status(204).send();
});

// API Endpoint for Contact Form
app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    const { payload: contact, error } = validateContact(req.body);

    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    // Generic webhook payload
    const payload = {
      ...contact,
      source: contact.source || 'Website Contact Form',
      dateCreated: new Date().toISOString().split('T')[0]
    };

    const webhookUrl = getWebhookUrl();

    if (webhookUrl) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      // Forward to n8n (or any generic webhook)
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        console.error('Failed to forward contact request to webhook:', response.status, response.statusText);
        return res.status(502).json({ success: false, message: 'We could not submit your request. Please call us directly.' });
      } else {
        console.log('Contact request forwarded to webhook.');
      }
    } else {
      console.warn('No valid webhook URL configured.');
      if (isProduction) {
        return res.status(503).json({ success: false, message: 'Contact form is temporarily unavailable. Please call us directly.' });
      }
    }

    res.status(200).json({ success: true, message: 'Thank you for your request! We will be in touch shortly.' });
  } catch (error) {
    console.error('Error handling contact form submission:', error);
    res.status(500).json({ success: false, message: 'An internal error occurred. Please try again later.' });
  }
});

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
