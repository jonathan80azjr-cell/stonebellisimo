# Stone Bellisimo Postmark Lead Automation

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
```

Required secrets:

- `N8N_WEBHOOK_URL`: existing n8n workflow webhook.
- `POSTMARK_SERVER_TOKEN`: Postmark server API token.
- `FEEDBACK_TOKEN_SECRET`: long random secret for signed feedback links.
- `POSTMARK_INBOUND_SECRET`: shared secret for `/api/postmark/inbound`.
- `POSTMARK_WEBHOOK_SECRET`: optional separate shared secret for delivery/bounce events. If omitted, the code falls back to `POSTMARK_INBOUND_SECRET`.

Non-secret Worker vars are in `wrangler.jsonc`:

- `POSTMARK_FROM_EMAIL=admin@stonebellisimollc.com`
- `POSTMARK_MESSAGE_STREAM=outbound`
- `POSTMARK_FEEDBACK_REPLY_DOMAIN=stonebellisimollc.com`
- `BUSINESS_NOTIFICATION_EMAIL=cesaryunda@hotmail.com`
- `BUSINESS_REPLY_TO_EMAIL=cesaryunda@hotmail.com`
- `FEEDBACK_DELAY_DAYS=3`

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
