// Sends one real staff notification email so the branded internal alert and the
// Postmark credentials can be verified end to end. Like scripts/send-test-email.mjs
// this always performs a live send and ignores POSTMARK_MOCK_MODE. To avoid
// paging the three real admins on the allowlist, it delivers to POSTMARK_TEST_EMAIL
// only and prefixes the subject with [Test].
import dotenv from 'dotenv';
import { buildNewLeadAlert } from '../src/admin-notifications.mjs';

dotenv.config();

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Add it to your .env file.`);
  }
  return value;
}

function optionalEnv(name, fallback) {
  return process.env[name] || fallback;
}

async function sendTestAdminNotification() {
  const token = requiredEnv('POSTMARK_SERVER_TOKEN');
  const to = requiredEnv('POSTMARK_TEST_EMAIL');
  const from = optionalEnv('POSTMARK_FROM_EMAIL', 'admin@stonebellisimollc.com');
  const messageStream = optionalEnv('POSTMARK_MESSAGE_STREAM', 'outbound');

  const alert = buildNewLeadAlert({
    id: `test_${Date.now()}`,
    customerName: 'Test Customer',
    phone: '201.553.1919',
    email: 'test.customer@example.com',
    projectType: 'Kitchen Countertops',
    material: 'Quartz',
    message: 'This is a test staff notification from send-test-admin-notification.mjs.',
    submittedAt: new Date().toISOString(),
    source: 'Website Contact Form',
    attribution: { landingPage: '/', utmSource: 'test', deviceCategory: 'desktop' }
  }, process.env);

  const payload = {
    From: from,
    To: to,
    Subject: `[Test] ${alert.subject}`,
    HtmlBody: alert.html,
    TextBody: alert.text,
    MessageStream: messageStream,
    TrackOpens: false,
    Metadata: {
      email_type: 'admin_new_lead_test',
      source: 'npm_run_email_test_admin'
    }
  };

  const response = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-postmark-server-token': token
    },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();
  let responseJson = null;
  try {
    responseJson = responseText ? JSON.parse(responseText) : null;
  } catch (error) {
    responseJson = null;
  }

  if (!response.ok) {
    throw new Error(`Postmark returned ${response.status}: ${responseText}`);
  }

  console.log(`Sent test admin notification to ${to}`);
  if (responseJson?.MessageID || responseJson?.MessageId) {
    console.log(`Message ID: ${responseJson.MessageID || responseJson.MessageId}`);
  }
}

sendTestAdminNotification().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
