import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeAdminRequest, readBearerToken, verifyAppCheckRequest, verifyPublicOrigin } from '../src/firebase-security.mjs';
import { ADMIN_EMAILS, adminAllowlist, evaluateAdminSignIn, isAdminEmail } from '../src/admin-accounts.mjs';

test('Firebase bearer authorization requires the admin custom claim', async () => {
  const missing = new Request('https://example.com/api/admin/leads');
  assert.equal(readBearerToken(missing), '');
  assert.equal((await authorizeAdminRequest(missing, async () => ({}))).status, 401);

  const request = new Request('https://example.com/api/admin/leads', { headers: { authorization: 'Bearer valid-token' } });
  const nonAdmin = await authorizeAdminRequest(request, async () => ({ uid: 'user' }));
  assert.equal(nonAdmin.status, 403);
  const admin = await authorizeAdminRequest(request, async (token, checkRevoked) => ({ uid: 'admin', admin: token === 'valid-token' && checkRevoked }));
  assert.equal(admin.ok, true);
  const invalid = await authorizeAdminRequest(request, async () => { throw new Error('expired'); });
  assert.equal(invalid.status, 401);
});

test('only allowlisted administrators may sign in or receive the admin claim', () => {
  assert.deepEqual(ADMIN_EMAILS.slice(), [
    'jensyjimenez723@gmail.com',
    'jonathan80azjr@gmail.com',
    'stonebellisimollc@outlook.com'
  ]);
  assert.equal(isAdminEmail('  JensyJimenez723@Gmail.com '), true);
  assert.equal(isAdminEmail('jensyjimenez723@gmail.com.attacker.example'), false);
  assert.equal(isAdminEmail(''), false);
  assert.equal(isAdminEmail(undefined), false);

  for (const email of ADMIN_EMAILS) {
    assert.deepEqual(evaluateAdminSignIn(email), { allowed: true, admin: true });
  }
  const stranger = evaluateAdminSignIn('stranger@gmail.com');
  assert.equal(stranger.allowed, false);
  assert.equal(stranger.admin, false);

  // Emulator accounts sign in for local QA but never earn the claim from here.
  assert.deepEqual(evaluateAdminSignIn('dashboard.admin@example.com', { emulator: true }), { allowed: true, admin: false });

  const extended = adminAllowlist({ SB_ADMIN_EMAILS: ' Owner@Example.com , jensyjimenez723@gmail.com ' });
  assert.deepEqual(extended, [...ADMIN_EMAILS, 'owner@example.com']);
  assert.equal(evaluateAdminSignIn('owner@example.com', { allowlist: extended }).admin, true);
});

test('App Check rejects missing and invalid tokens only after enforcement', async () => {
  const missing = new Request('https://example.com/api/contact');
  assert.equal((await verifyAppCheckRequest(missing, async () => {}, false)).ok, true);
  assert.equal((await verifyAppCheckRequest(missing, async () => {}, true)).status, 401);

  const invalid = new Request('https://example.com/api/contact', { headers: { 'x-firebase-appcheck': 'invalid' } });
  assert.equal((await verifyAppCheckRequest(invalid, async () => { throw new Error('bad'); }, true)).status, 401);
  assert.equal((await verifyAppCheckRequest(invalid, async token => assert.equal(token, 'invalid'), true)).ok, true);
});

test('public APIs accept only configured browser origins outside the emulator', () => {
  const allowed = new Request('https://backend.example/api/contact', { headers: { origin: 'https://stonebellisimollc.com' } });
  const rejected = new Request('https://backend.example/api/contact', { headers: { origin: 'https://attacker.example' } });
  const missing = new Request('https://backend.example/api/contact');
  assert.equal(verifyPublicOrigin(allowed, ['https://stonebellisimollc.com']).ok, true);
  assert.equal(verifyPublicOrigin(rejected, ['https://stonebellisimollc.com']).status, 403);
  assert.equal(verifyPublicOrigin(missing, ['https://stonebellisimollc.com']).status, 403);
  assert.equal(verifyPublicOrigin(missing, [], true).ok, true);
});
