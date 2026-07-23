// The dashboard has no public registration. This allowlist is the single source
// of truth for who may hold the `admin: true` custom claim, and it is enforced
// by the Firebase Authentication blocking functions in firebase-functions.mjs.
export const ADMIN_EMAILS = Object.freeze([
  'jensyjimenez723@gmail.com',
  'jonathan80azjr@gmail.com',
  'stonebellisimollc@outlook.com'
]);

export const ADMIN_DENIED_MESSAGE = 'This account is not an approved Stone Bellisimo administrator.';

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

// SB_ADMIN_EMAILS adds administrators without a code change. It only extends
// the list above; it can never replace or shrink it.
export function adminAllowlist(env = {}) {
  const extra = String(env.SB_ADMIN_EMAILS || '').split(',').map(normalizeEmail).filter(Boolean);
  return [...new Set([...ADMIN_EMAILS.map(normalizeEmail), ...extra])];
}

export function isAdminEmail(email, allowlist = ADMIN_EMAILS) {
  const normalized = normalizeEmail(email);
  return Boolean(normalized) && allowlist.map(normalizeEmail).includes(normalized);
}

// Staff alerts go to whoever can actually sign in and act on them, so the
// allowlist doubles as the notification list. SB_NOTIFY_EMAILS replaces that
// default outright for the case where alerts belong somewhere else (a shared
// inbox, a phone-to-SMS gateway), and disabling notifications yields no
// recipients at all rather than a silent fallback.
export function notificationRecipients(env = {}) {
  if (String(env.ADMIN_NOTIFICATIONS_ENABLED ?? 'true').toLowerCase() === 'false') return [];
  const override = String(env.SB_NOTIFY_EMAILS || '').split(',').map(normalizeEmail).filter(Boolean);
  return override.length ? [...new Set(override)] : adminAllowlist(env);
}

// Decides what happens when someone signs up or signs in. Emulator sessions are
// never blocked so local QA accounts keep working, but they are not granted the
// claim either: only the allowlist can do that.
export function evaluateAdminSignIn(email, { allowlist = ADMIN_EMAILS, emulator = false } = {}) {
  if (isAdminEmail(email, allowlist)) return { allowed: true, admin: true };
  if (emulator) return { allowed: true, admin: false };
  return { allowed: false, admin: false, message: ADMIN_DENIED_MESSAGE };
}
