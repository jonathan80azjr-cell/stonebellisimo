# Stone Bellisimo Postmark Lead Automation

> Firebase Functions and Firestore are now the target production backend. See [FIREBASE_ANALYTICS.md](./FIREBASE_ANALYTICS.md) for deployment, migration, and cutover. The Cloudflare Cron/D1 flow below remains the rollback path during the 30-day stabilization period.

This repo implements the lead email automation in the Cloudflare Worker because production already routes the website and `/api/contact` through Workers. Postmark sends the emails, but the delay is handled by Cloudflare Worker Cron plus D1.

## What Happens

1. The website submits the free estimate form to `/api/contact`.
2. The Worker validates and normalizes the form fields.
3. A durable D1 lead record is created in `LEADS_DB`.
4. The existing `N8N_WEBHOOK_URL` forwarding still runs with the lead payload.
5. Postmark sends the immediate confirmation email from `admin@stonebellisimollc.com`.
6. The lead is scheduled with `feedbackEmailDueAt = submittedAt + FEEDBACK_DELAY_DAYS`.
7. The hourly Worker Cron finds due leads and sends the feedback email exactly once per successful send.
8. Feedback can arrive from `/feedback` rating links or from Postmark Inbound email replies.
9. Feedback is stored and an internal notification is sent to `BUSINESS_NOTIFICATION_EMAIL`.

`FEEDBACK_DELAY_DAYS` defaults to `3` to match the current acceptance criteria. Set it to `7` if the business wants a one-week delay.

## D1 Setup

Create the D1 database:

```sh
npm run worker:d1:create
```

Copy the returned database id into `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "LEADS_DB",
    "database_name": "stonebellisimo-leads",
    "database_id": "PASTE_D1_DATABASE_ID_HERE",
    "migrations_dir": "migrations"
  }
]
```

Apply the migration:

```sh
npm run worker:d1:migrate
```

For local Wrangler D1 testing:

```sh
npm run worker:d1:migrate:local
npm run worker:dev
```

The Express dev server uses `.data/lead-automation.json` instead of D1 so local development works without extra native dependencies.

## Worker Secrets

Set these with Wrangler. Do not place real values in `wrangler.jsonc`, frontend code, or committed files.

```sh
npm run worker:secret
npm run worker:secret:postmark
npm run worker:secret:feedback
npm run worker:secret:inbound
npm run worker:secret:webhook
npm run worker:secret:admin-password
npm run worker:secret:admin-session
```

Required secrets:

- `N8N_WEBHOOK_URL`: existing n8n workflow webhook.
- `POSTMARK_SERVER_TOKEN`: Postmark server API token.
- `FEEDBACK_TOKEN_SECRET`: long random secret for signed feedback links.
- `POSTMARK_INBOUND_SECRET`: shared secret for `/api/postmark/inbound`.
- `POSTMARK_WEBHOOK_SECRET`: optional separate shared secret for delivery/bounce events. If omitted, the code falls back to `POSTMARK_INBOUND_SECRET`.
- `ADMIN_PASSWORD`: password for `/admin`.
- `ADMIN_SESSION_SECRET`: long random secret for signed admin session cookies.

Non-secret Worker vars are in `wrangler.jsonc`:

- `POSTMARK_FROM_EMAIL=admin@stonebellisimollc.com`
- `POSTMARK_MESSAGE_STREAM=outbound`
- `POSTMARK_FEEDBACK_REPLY_DOMAIN=stonebellisimollc.com`
- `BUSINESS_NOTIFICATION_EMAIL=cesaryunda@hotmail.com`
- `BUSINESS_REPLY_TO_EMAIL=cesaryunda@hotmail.com`
- `ADMIN_USERNAME=admin`
- `FEEDBACK_DELAY_DAYS=7`

## Admin Dashboard

The Worker serves an authenticated dashboard at:

```text
https://stonebellisimollc.com/admin
```

Before using it in production, set the admin secrets:

```sh
npm run worker:secret:admin-password
npm run worker:secret:admin-session
```

Use a strong random value for `ADMIN_SESSION_SECRET`. The dashboard lets you:

- View form submissions from D1.
- Confirm immediate and feedback email send records.
- See feedback ratings, comments, inbound replies, and Postmark delivery events.
- Preview the confirmation template, feedback request template, or a custom branded client email.
- Send a selected template directly to a lead through Postmark.

Sending a feedback request from the dashboard creates a real signed feedback link for that lead and records the send in `email_events`. If the lead already submitted feedback, the dashboard will not render or send another feedback request.

## Manual Postmark Setup

1. Verify the sender signature or sending domain for `admin@stonebellisimollc.com`.
2. Create or confirm the outbound Message Stream named `outbound`.
3. Create or confirm an inbound Message Stream.
4. Configure an inbound forwarding domain or inbound address that supports replies to:

   ```text
   feedback+<leadId>.<tokenRef>@stonebellisimollc.com
   ```

5. Set the inbound webhook URL to:

   ```text
   https://stonebellisimollc.com/api/postmark/inbound?secret=<POSTMARK_INBOUND_SECRET>
   ```

   If Postmark custom headers are available in the dashboard, you can send the secret as one of:

   ```text
   X-Postmark-Webhook-Secret
   X-Postmark-Inbound-Secret
   X-Webhook-Secret
   ```

6. Optionally configure delivery, bounce, open, or click event webhooks to:

   ```text
   https://stonebellisimollc.com/api/postmark/webhook?secret=<POSTMARK_WEBHOOK_SECRET>
   ```

7. Remember: the 3-day or 7-day delay is not configured inside Postmark. It is handled by the Worker Cron trigger in `wrangler.jsonc`.

## Local Development

Use Postmark mock mode by default:

```sh
cp .env.example .env
npm run dev
```

Submit the form at `http://localhost:3000`. The server stores leads in `.data/lead-automation.json` and logs mock Postmark sends instead of sending real email.

Useful local endpoints:

- `POST /api/contact`
- `GET /feedback?token=<token>&rating=<1-5>`
- `POST /feedback`
- `POST /api/postmark/inbound?secret=local-dev-inbound-secret`
- `POST /api/postmark/webhook?secret=local-dev-inbound-secret`
- `POST /api/dev/run-feedback-cron`

To test real Postmark locally, set:

```env
POSTMARK_MOCK_MODE=false
POSTMARK_SERVER_TOKEN=...
POSTMARK_FROM_EMAIL=admin@stonebellisimollc.com
POSTMARK_TEST_EMAIL=you@example.com
```

Then send a branded test confirmation email:

```sh
npm run email:test
```

This command reads `.env`, sends to `POSTMARK_TEST_EMAIL`, and uses the configured `POSTMARK_FROM_EMAIL`, `POSTMARK_MESSAGE_STREAM`, and `BUSINESS_REPLY_TO_EMAIL`.

## Testing the Reminder Email

Generate local HTML and text previews for both customer emails:

```sh
npm run email:preview
```

Open these files in a browser or text editor:

- `.data/email-previews/confirmation.html`
- `.data/email-previews/feedback.html`
- `.data/email-previews/confirmation.txt`
- `.data/email-previews/feedback.txt`

To send the seven-day feedback/reminder email template to yourself through Postmark, set `POSTMARK_TEST_EMAIL` and `POSTMARK_SERVER_TOKEN` in `.env`, then run:

```sh
npm run email:test:feedback
```

That proves the email design and Postmark credentials work. The rating buttons use a preview-only token; clicking them opens a preview page and does not submit feedback. This command does not prove the delayed scheduling path by itself.

For a local end-to-end test of the scheduler:

1. Keep `POSTMARK_MOCK_MODE=true` in `.env`.
2. Run `npm run dev`.
3. Submit the website form with your own email.
4. Confirm `.data/lead-automation.json` contains a lead with `feedbackEmailDueAt` seven days after `submittedAt`.
5. For that test lead only, edit `feedbackEmailDueAt` in `.data/lead-automation.json` to a timestamp in the past.
6. Trigger the local scheduler:

   ```sh
   curl -X POST http://localhost:3000/api/dev/run-feedback-cron
   ```

7. Confirm the response has `"sent":1`, the lead has `feedbackEmailSentAt`, and `emailEvents` contains a successful `feedback_request` event.

For a production smoke test:

1. Submit the live website form using an email address you control.
2. Find the newest test lead in remote D1:

   ```sh
   npx wrangler d1 execute stonebellisimo-leads --remote --command "SELECT id, email, submittedAt, feedbackEmailDueAt, feedbackEmailSentAt, feedbackStatus FROM leads WHERE email = 'you@example.com' ORDER BY submittedAt DESC LIMIT 3;"
   ```

3. Confirm `feedbackEmailDueAt` is exactly seven days after `submittedAt`.
4. To avoid waiting seven days, move only that test lead into the due queue:

   ```sh
   npx wrangler d1 execute stonebellisimo-leads --remote --command "UPDATE leads SET feedbackEmailDueAt = strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute'), feedbackEmailSentAt = NULL, feedbackEmailClaimedAt = NULL, feedbackStatus = 'pending', feedbackEmailAttemptCount = 0, feedbackEmailLastError = NULL WHERE id = 'lead_REPLACE_WITH_TEST_ID';"
   ```

5. The deployed Worker cron runs hourly at minute `0` UTC. After the next run, confirm send state:

   ```sh
   npx wrangler d1 execute stonebellisimo-leads --remote --command "SELECT id, email, feedbackEmailDueAt, feedbackEmailSentAt, feedbackStatus, postmarkFeedbackMessageId, feedbackEmailLastError FROM leads WHERE id = 'lead_REPLACE_WITH_TEST_ID';"
   ```

6. Confirm the send event:

   ```sh
   npx wrangler d1 execute stonebellisimo-leads --remote --command "SELECT eventType, recipient, subject, status, postmarkMessageId, error, createdAt FROM email_events WHERE leadId = 'lead_REPLACE_WITH_TEST_ID' ORDER BY createdAt DESC LIMIT 5;"
   ```

You can also run `npm run worker:dev` and visit `http://localhost:8787/__scheduled` to test the Worker scheduled handler locally with Wrangler.

## n8n Payload

The existing n8n webhook still receives the original contact fields plus automation metadata:

```json
{
  "firstName": "Jane",
  "lastName": "Client",
  "email": "jane@example.com",
  "phone": "201.555.0100",
  "projectType": "Kitchen Countertops",
  "material": "Quartz",
  "source": "Website Wizard - Hero",
  "message": "Project details...",
  "customerName": "Jane Client",
  "leadId": "lead_...",
  "submittedAt": "2026-07-01T12:00:00.000Z",
  "feedbackEmailDueAt": "2026-07-04T12:00:00.000Z",
  "dateCreated": "2026-07-01"
}
```

## Data Tables

The migration creates:

- `leads`: normalized lead data, email schedule state, token hash, rating summary.
- `email_events`: Postmark send attempts and outcomes.
- `feedback`: accepted, duplicate, and unparsed feedback submissions.
- `postmark_inbound_events`: inbound reply metadata and raw debugging payload.
- `postmark_delivery_events`: optional delivery/bounce/open/click webhook events.

Feedback tokens are signed and hashed server-side. Raw feedback tokens are not stored in D1.
