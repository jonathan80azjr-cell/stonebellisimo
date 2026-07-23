import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { adminAllowlist, isAdminEmail, normalizeEmail } from '../src/admin-accounts.mjs';

function readArg(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && !String(process.argv[index + 1] || '--').startsWith('--') ? process.argv[index + 1] : '';
}

const projectId = readArg('project') || process.env.SB_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '';
const create = process.argv.includes('--create');
const revoke = process.argv.includes('--revoke');
const password = process.env.FIREBASE_ADMIN_INITIAL_PASSWORD || '';

if (!projectId) {
  console.error('Usage: npm run firebase:admins -- --project PROJECT_ID [--create] [--revoke]');
  process.exit(1);
}
if (create && password.length < 12) {
  console.error('Set FIREBASE_ADMIN_INITIAL_PASSWORD to at least 12 characters before using --create.');
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth();
const allowlist = adminAllowlist(process.env);
const pending = [];

for (const email of allowlist) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
    if (!create) {
      pending.push(email);
      console.info(`○ ${email} has no account yet. It is provisioned automatically on the first Google sign-in.`);
      continue;
    }
    user = await auth.createUser({ email, password, emailVerified: true, disabled: false });
    console.info(`+ ${email} created with a password sign-in.`);
  }
  if (user.customClaims?.admin === true) {
    console.info(`= ${email} already holds admin (${user.uid}).`);
    continue;
  }
  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), admin: true });
  await auth.revokeRefreshTokens(user.uid);
  console.info(`✓ ${email} granted admin (${user.uid}). Existing sessions were revoked.`);
}

// Anything holding the claim outside the allowlist is drift: report it always,
// and strip it when the operator explicitly asks with --revoke.
let page = await auth.listUsers(1000);
const strays = [];
while (true) {
  strays.push(...page.users.filter(user => user.customClaims?.admin === true && !isAdminEmail(user.email, allowlist)));
  if (!page.pageToken) break;
  page = await auth.listUsers(1000, page.pageToken);
}
for (const user of strays) {
  if (!revoke) {
    console.warn(`! ${normalizeEmail(user.email) || user.uid} holds admin but is not on the allowlist. Re-run with --revoke to remove it.`);
    continue;
  }
  const { admin, ...rest } = user.customClaims || {};
  await auth.setCustomUserClaims(user.uid, rest);
  await auth.revokeRefreshTokens(user.uid);
  console.info(`- ${normalizeEmail(user.email) || user.uid} had admin removed.`);
}

console.info(`\nAllowlist (${allowlist.length}): ${allowlist.join(', ')}`);
if (pending.length) console.info(`Awaiting first Google sign-in: ${pending.join(', ')}`);
