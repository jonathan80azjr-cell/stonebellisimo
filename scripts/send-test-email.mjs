import dotenv from 'dotenv';
import { renderImmediateConfirmationEmail } from '../src/email/render.mjs';

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

async function sendPostmarkTestEmail() {
  const token = requiredEnv('POSTMARK_SERVER_TOKEN');
  const to = requiredEnv('POSTMARK_TEST_EMAIL');
  const from = optionalEnv('POSTMARK_FROM_EMAIL', 'admin@stonebellisimollc.com');
  const messageStream = optionalEnv('POSTMARK_MESSAGE_STREAM', 'outbound');
  const replyTo = optionalEnv('BUSINESS_REPLY_TO_EMAIL', 'cesaryunda@hotmail.com');

  const email = renderImmediateConfirmationEmail({
    lead: {
      id: `test_${Date.now()}`,
      firstName: 'Test',
      lastName: 'Customer',
      customerName: 'Test Customer',
      email: to,
      phone: '201.553.1919',
      projectType: 'Kitchen Countertops',
      material: 'Quartz',
      message: 'This is a development test email from the Stone Bellisimo Postmark automation command.'
    }
  });

  const payload = {
    From: from,
    To: to,
    ReplyTo: replyTo,
    Subject: `[Test] ${email.subject}`,
    HtmlBody: email.html,
    TextBody: email.text,
    MessageStream: messageStream,
    TrackOpens: false,
    Metadata: {
      email_type: 'development_test',
      source: 'npm_run_email_test'
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

  console.log(`Sent Postmark test email to ${to}`);
  if (responseJson?.MessageID || responseJson?.MessageId) {
    console.log(`Message ID: ${responseJson.MessageID || responseJson.MessageId}`);
  }
}

sendPostmarkTestEmail().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
