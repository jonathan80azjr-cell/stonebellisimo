const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

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

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

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

function getWebhookUrl(env) {
  const rawUrl = env.N8N_WEBHOOK_URL;
  if (!rawUrl || rawUrl === 'YOUR_N8N_WEBHOOK_URL_HERE') return null;

  try {
    const webhookUrl = new URL(rawUrl);
    if (webhookUrl.protocol !== 'https:') return null;
    return webhookUrl.toString();
  } catch (error) {
    return null;
  }
}

function methodNotAllowed(allowed) {
  return json(
    { success: false, message: 'Method not allowed.' },
    405,
    { allow: allowed.join(', ') }
  );
}

async function readJson(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 20 * 1024) {
    return { error: 'Request is too large.', status: 413 };
  }

  try {
    return { body: await request.json() };
  } catch (error) {
    return { error: 'Invalid JSON request.', status: 400 };
  }
}

async function forwardContact(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return methodNotAllowed(['POST', 'OPTIONS']);

  const webhookUrl = getWebhookUrl(env);
  if (!webhookUrl) {
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

  const payload = {
    ...contact,
    source: contact.source || 'Website Contact Form',
    dateCreated: new Date().toISOString().split('T')[0]
  };

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
      return json(
        { success: false, message: 'We could not submit your request. Please call us directly.' },
        502
      );
    }

    return json({ success: true, message: 'Thank you for your request! We will be in touch shortly.' });
  } catch (error) {
    return json(
      { success: false, message: 'We could not submit your request. Please call us directly.' },
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/contact') {
      return forwardContact(request, env);
    }

    if (url.pathname === '/favicon.ico') {
      return Response.redirect(new URL('/assets/img/logo-280.png', url), 302);
    }

    if (url.pathname === '/api/performance') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
      if (request.method !== 'POST') return methodNotAllowed(['POST', 'OPTIONS']);
      return new Response(null, { status: 204 });
    }

    return json({ success: false, message: 'Not found.' }, 404);
  }
};
