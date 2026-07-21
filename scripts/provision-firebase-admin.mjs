import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

function argumentsMap(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const [key, inline] = argv[index].slice(2).split('=', 2);
    const next = argv[index + 1];
    values[key] = inline ?? (next === undefined || next.startsWith('--') ? true : argv[++index]);
  }
  return values;
}

const args = argumentsMap(process.argv.slice(2));
const projectId = String(args.project || process.env.SB_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '').trim();
const email = String(args.email || process.env.FIREBASE_ADMIN_EMAIL || '').trim().toLowerCase();
const password = String(process.env.FIREBASE_ADMIN_INITIAL_PASSWORD || '');
const create = Boolean(args.create);

if (!projectId || !email) {
  console.error('Usage: npm run firebase:admin -- --project PROJECT_ID --email admin@example.com [--create]');
  process.exit(1);
}
if (create && password.length < 12) {
  console.error('Set FIREBASE_ADMIN_INITIAL_PASSWORD to at least 12 characters before using --create.');
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth();
let user;
try {
  user = await auth.getUserByEmail(email);
} catch (error) {
  if (error?.code !== 'auth/user-not-found' || !create) throw error;
  user = await auth.createUser({ email, password, emailVerified: true, disabled: false });
  console.info(`Created Firebase Auth user ${email}.`);
}

await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), admin: true });
await auth.revokeRefreshTokens(user.uid);
console.info(`Granted admin:true to ${email} (${user.uid}). Existing sessions were revoked.`);
