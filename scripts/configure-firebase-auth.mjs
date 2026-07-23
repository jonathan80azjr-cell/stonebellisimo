import { GoogleAuth } from 'google-auth-library';

function readArg(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : '';
}

const projectId = readArg('project') || process.env.SB_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
if (!projectId) {
  console.error('Usage: npm run firebase:auth:configure -- --project PROJECT_ID');
  process.exit(1);
}

// Google sign-in has to create the account on an approved administrator's first
// visit, so project-wide signup blocking is replaced by the restrictAdminSignUp
// blocking function. Pass --disable-signup to go back to password-only intake.
const lockSignup = process.argv.includes('--disable-signup');

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const client = await auth.getClient();
const result = await client.getAccessToken();
const token = typeof result === 'string' ? result : result?.token;
if (!token) throw new Error('Could not obtain Google credentials. Configure Application Default Credentials first.');

const updateMask = [
  'signIn.email',
  'client.permissions',
  'passwordPolicyConfig',
  'emailPrivacyConfig',
  'authorizedDomains'
].join(',');
const response = await fetch(
  `https://identitytoolkit.googleapis.com/admin/v2/projects/${encodeURIComponent(projectId)}/config?updateMask=${encodeURIComponent(updateMask)}`,
  {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-goog-user-project': projectId
    },
    body: JSON.stringify({
      signIn: { email: { enabled: true, passwordRequired: true } },
      client: { permissions: { disabledUserSignup: lockSignup, disabledUserDeletion: true } },
      passwordPolicyConfig: {
        passwordPolicyEnforcementState: 'ENFORCE',
        forceUpgradeOnSignin: false,
        passwordPolicyVersions: [{
          customStrengthOptions: {
            minPasswordLength: 12,
            containsLowercaseCharacter: true,
            containsUppercaseCharacter: true,
            containsNumericCharacter: true,
            containsNonAlphanumericCharacter: true
          }
        }]
      },
      emailPrivacyConfig: { enableImprovedEmailPrivacy: true },
      // The last two domains host the Google sign-in handler at /__/auth/handler.
      authorizedDomains: [
        'stonebellisimollc.com',
        'www.stonebellisimollc.com',
        'localhost',
        `${projectId}.firebaseapp.com`,
        `${projectId}.web.app`
      ]
    })
  }
);
if (!response.ok) throw new Error(`Identity Toolkit configuration failed (${response.status}): ${await response.text()}`);
const body = await response.json();
console.info(`Firebase Auth secured for ${projectId}: strong passwords and email-enumeration protection enabled.`);
console.info(lockSignup
  ? 'Account creation is disabled project-wide. Google sign-in can only reach accounts that already exist.'
  : 'Account creation is gated by the restrictAdminSignUp blocking function. Deploy Functions before relying on it.');
console.info(`Authorized domains: ${(body.authorizedDomains || []).join(', ')}`);
