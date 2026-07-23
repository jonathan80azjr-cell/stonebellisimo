// End-to-end check of the staff-notification path. Unlike send-test-admin-notification.mjs
// (which renders a template and posts to Postmark directly, to POSTMARK_TEST_EMAIL only),
// this drives the REAL sendAdminNotification() code path: it resolves recipients through
// notificationRecipients(), records the send through a store, and performs a live Postmark
// send with POSTMARK_MOCK_MODE forced off.
//
// Because notificationRecipients() resolves to the real admin allowlist, this can page the
// actual staff. The alert content is therefore unmistakably marked as a test, and the live
// send to real recipients is gated behind --yes-send-to-admins. Without that flag the send
// is redirected to POSTMARK_TEST_EMAIL via SB_NOTIFY_EMAILS.
//
// A store is required by sendAdminNotification (it records every send). To avoid writing a
// synthetic row into production email_events, this uses an in-memory store and prints the
// event that would have been recorded, so the record step is still exercised and verified.
import dotenv from 'dotenv';
import {
  NOTIFICATION_TYPES,
  sendAdminNotification
} from '../src/admin-notifications.mjs';
import { notificationRecipients } from '../src/admin-accounts.mjs';
import { renderInternalAlertEmail } from '../src/email/render.mjs';

dotenv.config();

const sendToAdmins = process.argv.includes('--yes-send-to-admins');

function buildTestAlert() {
  return renderInternalAlertEmail({
    eyebrow: 'System test',
    title: 'TEST — staff notification pipeline check',
    intro:
      'This is an automated end-to-end test of the Stone Bellisimo staff notification system. ' +
      'No customer submitted anything and no action is needed — please ignore this message. ' +
      'It confirms that alerts render correctly and that Postmark delivery is working.',
    rows: [
      ['Purpose', 'Verify sendAdminNotification -> Postmark delivery'],
      ['Sent at', new Date().toISOString()],
      ['Action needed', 'None — safe to delete']
    ],
    note: 'Sent by scripts/send-e2e-admin-notification.mjs.'
  });
}

async function main() {
  const testEmail = process.env.POSTMARK_TEST_EMAIL;

  // Force a live send regardless of the .env default, and pick recipients.
  const env = { ...process.env, POSTMARK_MOCK_MODE: 'false' };
  if (!sendToAdmins) {
    if (!testEmail) {
      throw new Error('POSTMARK_TEST_EMAIL is required unless --yes-send-to-admins is passed.');
    }
    // Redirect the real path to the test inbox instead of the admin allowlist.
    env.SB_NOTIFY_EMAILS = testEmail;
  }

  const recipients = notificationRecipients(env);
  if (!recipients.length) {
    throw new Error('No notification recipients resolved. Check ADMIN_NOTIFICATIONS_ENABLED / SB_NOTIFY_EMAILS.');
  }

  console.log(`Mode: ${sendToAdmins ? 'LIVE -> real admin allowlist' : 'redirected -> POSTMARK_TEST_EMAIL'}`);
  console.log(`Recipients: ${recipients.join(', ')}`);

  const recorded = [];
  const store = { saveEmailEvent: async event => { recorded.push(event); } };

  const result = await sendAdminNotification({
    env,
    store,
    type: NOTIFICATION_TYPES.newLead,
    alert: buildTestAlert(),
    metadata: { test: 'true', trigger: 'e2e_script' }
  });

  console.log('sendAdminNotification result:', result);
  console.log(`email_events rows recorded: ${recorded.length}`);
  if (recorded[0]) {
    const { eventType, recipient, subject, status, postmarkMessageId } = recorded[0];
    console.log('Recorded event:', { eventType, recipient, subject, status, postmarkMessageId });
  }

  if (!result.sent) {
    throw new Error(`Notification not sent: ${result.reason || 'unknown'}`);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
