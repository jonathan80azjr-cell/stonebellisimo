export function readBearerToken(request) {
  const authorization = request.headers.get('authorization') || '';
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '';
}

export async function authorizeAdminRequest(request, verifyIdToken) {
  const token = readBearerToken(request);
  if (!token) return { ok: false, status: 401, message: 'Sign in is required.' };
  try {
    const decoded = await verifyIdToken(token, true);
    if (decoded.admin !== true) return { ok: false, status: 403, message: 'Administrator access is required.' };
    return { ok: true, token: decoded };
  } catch {
    return { ok: false, status: 401, message: 'Your session is invalid or expired.' };
  }
}

export async function verifyAppCheckRequest(request, verifyToken, enforced = false) {
  const token = request.headers.get('x-firebase-appcheck') || '';
  if (!token) return enforced ? { ok: false, status: 401, message: 'App verification is required.' } : { ok: true, monitored: true };
  try {
    await verifyToken(token);
    return { ok: true };
  } catch {
    return enforced ? { ok: false, status: 401, message: 'App verification failed.' } : { ok: true, monitored: true };
  }
}

export function verifyPublicOrigin(request, allowedOrigins = [], emulator = false) {
  if (emulator) return { ok: true };
  const origin = request.headers.get('origin') || '';
  if (!origin) return { ok: false, status: 403, message: 'A trusted site origin is required.' };
  let normalized;
  try { normalized = new URL(origin).origin; }
  catch { return { ok: false, status: 403, message: 'The request origin is invalid.' }; }
  const allowed = new Set(allowedOrigins.map(value => {
    try { return new URL(value).origin; } catch { return ''; }
  }).filter(Boolean));
  return allowed.has(normalized)
    ? { ok: true }
    : { ok: false, status: 403, message: 'The request origin is not allowed.' };
}
