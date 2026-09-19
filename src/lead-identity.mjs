import { createHash } from 'node:crypto';

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function normalizeLeadEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

export function normalizeLeadPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return '';
}

export function normalizeLeadSurname(value) {
  return String(value || '').normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase().slice(0, 80);
}

export function leadIdentityKeys({ email, phone, lastName, surname, platform, accountId, remoteContactId } = {}) {
  const keys = [];
  const normalizedEmail = normalizeLeadEmail(email);
  const normalizedPhone = normalizeLeadPhone(phone);
  const normalizedSurname = normalizeLeadSurname(lastName || surname);
  // The safe matching waterfall: a platform identity is strongest, followed by
  // household-safe phone + surname, then normalized email.
  if (platform && accountId && remoteContactId) {
    keys.push({ type: 'platform', id: `platform_${hash(`${String(platform).toLowerCase()}:${accountId}:${remoteContactId}`)}` });
  }
  if (normalizedPhone && normalizedSurname) keys.push({ type: 'phone_surname', id: `phone_surname_${hash(`${normalizedPhone}:${normalizedSurname}`)}` });
  if (normalizedEmail) keys.push({ type: 'email', id: `email_${hash(normalizedEmail)}` });
  return keys;
}

export function deterministicIdentityLeadId(identity) {
  return `lead_${hash(identity).slice(0, 32)}`;
}
