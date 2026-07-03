import dotenv from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderFeedbackRequestEmail,
  renderImmediateConfirmationEmail
} from '../src/email/render.mjs';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const previewDir = path.join(repoRoot, '.data', 'email-previews');

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const match = process.argv.find(arg => arg === name || arg.startsWith(prefix));
  if (!match) return fallback;
  if (match === name) return 'true';
  return match.slice(prefix.length);
}

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

function sampleLead(to) {
  return {
    id: `preview_${Date.now()}`,
    firstName: 'Test',
    lastName: 'Customer',
    customerName: 'Test Customer',
    email: to || 'test.customer@example.com',
    phone: '201.553.1919',
    projectType: 'Kitchen Countertops',
    material: 'Quartz',
    source: 'Email preview script',
    message: 'This is a safe preview of the Stone Bellisimo email automation.'
  };
}

async function writePreview(name, email) {
  await mkdir(previewDir, { recursive: true });
  const htmlPath = path.join(previewDir, `${name}.html`);
  const textPath = path.join(previewDir, `${name}.txt`);
  await writeFile(htmlPath, email.html, 'utf8');
  await writeFile(textPath, email.text, 'utf8');
  return { htmlPath, textPath };
}

async function sendPostmarkEmail(email, { to, tag }) {
  const token = requiredEnv('POSTMARK_SERVER_TOKEN');
  const from = optionalEnv('POSTMARK_FROM_EMAIL', 'admin@stonebellisimollc.com');
  const replyTo = optionalEnv('BUSINESS_REPLY_TO_EMAIL', 'cesaryunda@hotmail.com');
  const messageStream = optionalEnv('POSTMARK_MESSAGE_STREAM', 'outbound');

  const response = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-postmark-server-token': token
    },
    body: JSON.stringify({
      From: from,
      To: to,
      ReplyTo: replyTo,
      Subject: `[Test] ${email.subject}`,
      HtmlBody: email.html,
      TextBody: email.text,
      MessageStream: messageStream,
      TrackOpens: false,
      Metadata: {
        email_type: tag,
        source: 'email_preview_script'
      }
    })
  });

  const responseText = await response.text();
  let responseJson = null;
  try {
    responseJson = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseJson = null;
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        'Postmark rejected POSTMARK_SERVER_TOKEN. Copy the Server API token from the same Postmark server that owns the outbound message stream, then update .env and rerun this command.'
      );
    }

    throw new Error(`Postmark returned ${response.status}: ${responseText}`);
  }

  return responseJson;
}

async function main() {
  const type = argValue('--type', 'both');
  const shouldSend = process.argv.includes('--send');
  const to = process.env.POSTMARK_TEST_EMAIL || '';
  const lead = sampleLead(to);
  const baseUrl = optionalEnv('PUBLIC_SITE_URL', optionalEnv('APP_BASE_URL', 'https://stonebellisimollc.com'));

  const emails = {
    confirmation: renderImmediateConfirmationEmail({ lead }),
    feedback: renderFeedbackRequestEmail({
      lead,
      token: 'preview-token-only-links-will-not-submit',
      baseUrl
    })
  };

  const selected = type === 'both' ? Object.entries(emails) : [[type, emails[type]]];
  if (selected.some(([, email]) => !email)) {
    throw new Error('--type must be confirmation, feedback, or both.');
  }

  for (const [name, email] of selected) {
    const paths = await writePreview(name, email);
    console.log(`${name}: ${email.subject}`);
    console.log(`HTML preview: ${paths.htmlPath}`);
    console.log(`Text preview: ${paths.textPath}`);

    if (shouldSend) {
      const recipient = requiredEnv('POSTMARK_TEST_EMAIL');
      const result = await sendPostmarkEmail(email, {
        to: recipient,
        tag: name === 'feedback' ? 'feedback_request_test' : 'immediate_confirmation_test'
      });
      console.log(`Sent ${name} test email to ${recipient}`);
      if (result?.MessageID || result?.MessageId) {
        console.log(`Message ID: ${result.MessageID || result.MessageId}`);
      }
    }
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
