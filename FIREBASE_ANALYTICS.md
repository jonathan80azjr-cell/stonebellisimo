# Firebase Dashboard and Analytics Runbook

The production website stays on Cloudflare. Cloudflare serves `public/` and streams `/api/*` plus `/feedback` to the Firebase `siteApi` Function after cutover. Firestore owns leads, email and feedback history, raw analytics, summaries, and Search Console imports. The dashboard uses Firebase Email/Password Authentication and requires an `admin: true` custom claim.

Do not remove the D1 bindings or Cloudflare Cron until the final migration delta and production validation are complete. Retain D1 read-only for 30 days.

## Provisioned foundation

The Firebase project is `stone-bellisimo-dashboard`. Its web app, default `nam5` Firestore database, deny-by-default rules, indexes, Email/Password provider, no-public-signup policy, strong password policy, email-enumeration protection, and approved authentication domains are already configured. Billing, production secrets, App Check, the initial administrator, Search Console access, Functions deployment, D1 migration, and Cloudflare cutover remain deliberate production steps below.

## Local development

Use Node 22, then install and run the complete Firebase Emulator Suite:

```sh
npm install
npm run dev
```

The local site is `http://127.0.0.1:5002`, the dashboard is `http://127.0.0.1:5002/admin/`, and Emulator UI is `http://127.0.0.1:4001`. Local secrets belong in the ignored `functions/.secret.local`; use `functions/.env.example` and `.env.example` as field lists.

The Firebase Auth emulator test administrator is:

- Email: `admin@local.test`
- Password: `AdminTest123!`

This account exists only in the local emulator and has the required `admin: true` custom claim. It must never be created or used in production.

Validation commands:

```sh
npm run check
npm test
npm run test:emulators
npm run test:browser
```

## Production project setup

1. Create or select a Firebase project, attach a billing account so it is on Blaze, and enable Firestore in a United States multi-region. Cloud Functions deployment requires Blaze.
2. Create a Firebase web app and record its public values as `SB_FIREBASE_WEB_API_KEY`, `SB_FIREBASE_AUTH_DOMAIN`, `SB_FIREBASE_PROJECT_ID`, and `SB_FIREBASE_APP_ID` Function environment parameters.
3. Deploy the Email/Password provider configuration, then apply the hardened Auth policy with Application Default Credentials:

   ```sh
   npm run firebase:deploy:auth
   gcloud auth application-default login
   npm run firebase:auth:configure -- --project <project-id>
   ```

   This enables strong-password enforcement and email privacy, disables public signup/deletion, and limits authorized domains to the Stone Bellisimo site and localhost.
4. Create a reCAPTCHA Enterprise App Check web app for `stonebellisimollc.com` and `www.stonebellisimollc.com`. Set its public site key as `SB_FIREBASE_APPCHECK_SITE_KEY`.
5. Deploy Firestore rules, indexes, and Node 22 Functions:

   ```sh
   firebase use <project-id>
   npm run firebase:deploy
   ```

Direct Firestore client reads and writes are denied by `firestore.rules`; all access goes through authenticated Functions.

## Configuration and secrets

Set these non-secret Function values without committing a production `.env` file:

- `ENVIRONMENT=production`
- `PUBLIC_SITE_URL=https://stonebellisimollc.com`
- Firebase web app fields from `.env.example`
- `APP_CHECK_ENFORCED=false` for the initial monitoring period
- `SEARCH_CONSOLE_SITE_URL=sc-domain:stonebellisimollc.com`
- Postmark sender/routing values from `.env.example`

Store the following with Firebase Secret Manager:

```sh
firebase functions:secrets:set SB_PROXY_SECRET --project <project-id>
firebase functions:secrets:set N8N_WEBHOOK_URL --project <project-id>
firebase functions:secrets:set POSTMARK_SERVER_TOKEN --project <project-id>
firebase functions:secrets:set FEEDBACK_TOKEN_SECRET --project <project-id>
firebase functions:secrets:set POSTMARK_INBOUND_SECRET --project <project-id>
firebase functions:secrets:set POSTMARK_WEBHOOK_SECRET --project <project-id>
firebase functions:secrets:set GOOGLE_MAPS_API_KEY --project <project-id>
firebase functions:secrets:set GOOGLE_MAPS_BROWSER_API_KEY --project <project-id>
```

Use one strong random value for `SB_PROXY_SECRET` in both Firebase and Cloudflare:

```sh
npm run worker:secret:firebase-proxy
```

After the Function deploy, set `FIREBASE_API_ORIGIN` in `wrangler.jsonc` to the full `siteApi` URL, for example `https://us-east1-<project-id>.cloudfunctions.net/siteApi`. Do not include a trailing slash.

For least privilege, run Functions as a dedicated service account with Firestore data-user, logging-writer, and only the necessary Secret Manager accessor grants. Set `FUNCTIONS_SERVICE_ACCOUNT` during deployment if a dedicated runtime account is used. Do not grant broad Owner or Editor access.

## Administrator provisioning

There is no public registration. Create the first account with a temporary password kept only in the current shell, or grant the claim to an existing Firebase Auth user:

```sh
FIREBASE_ADMIN_INITIAL_PASSWORD='<temporary-strong-password>' \
  npm run firebase:admin -- --project <project-id> --email <admin-email> --create
```

Without `--create`, the script only grants `admin: true` to an existing user. It revokes existing refresh tokens after changing claims. The browser uses session-only persistence, and every admin API verifies a non-revoked Firebase ID token plus the custom claim.

## Search Console

Verify `sc-domain:stonebellisimollc.com` in Google Search Console and grant the Functions runtime service-account email read-only access to that property. The daily Function imports recent data after Google's normal reporting delay. Backfill available history with:

```sh
npm run firebase:search:backfill -- --project <project-id>
```

The dashboard reports total and branded impressions, clicks, CTR, average position, queries, and landing pages. The branded view matches `Stone Bellisimo`, spacing/case variations, and `StoneBellisimo`. Search Console measures this site's appearances in Google; it does not expose every global search, and Google may omit anonymized or low-volume queries. Bing is intentionally deferred.

## D1 migration and cutover

First validate what the migration will read:

```sh
npm run firebase:migrate:d1 -- --dry-run --phase backfill
```

With Application Default Credentials configured, perform the idempotent backfill:

```sh
npm run firebase:migrate:d1 -- --project <project-id> --phase backfill
```

The tool preserves record IDs, relationships, JSON payload fields, token hashes, and timestamps in `leads`, `feedback`, `email_events`, `postmark_inbound_events`, and `postmark_delivery_events`. It writes an ignored local checkpoint and a `migration_checkpoints/d1_cutover` document, compares collection counts, and verifies representative records.

Cutover order:

1. Deploy Firebase while Cloudflare still uses D1.
2. Run the initial backfill and inspect representative leads, feedback, and email histories.
3. Set the matching proxy secrets and the Function origin, then deploy Cloudflare.
4. Immediately run the delta import:

   ```sh
   npm run firebase:migrate:d1 -- --project <project-id> --phase delta
   ```

5. Verify a real contact submission, n8n delivery, immediate Postmark email, feedback link, Postmark webhooks, dashboard email send, analytics ingestion, and Search Console status.
6. Watch App Check monitor-mode logs. When legitimate production requests consistently carry valid tokens, set `APP_CHECK_ENFORCED=true` and redeploy Functions.
7. Leave D1 and the old Worker code path available but read-only for 30 days. Only then remove the D1 bindings and Cloudflare Cron.

Rollback is to restore the prior Worker deployment, clear `FIREBASE_API_ORIGIN`, and return D1 to its pre-cutover role. Do not delete Firestore or D1 during stabilization.

## Analytics meaning and privacy

Raw events are retained in `analytics_events` without a TTL. Each event has a client-generated idempotency ID; duplicate IDs do not double-count. Firestore-triggered summaries power date-range and previous-period charts. The tracker uses an anonymous first-party visitor ID, a 30-minute session ID, sanitized campaign values, referrer hostname, page path, and coarse device category. It does not store raw IP addresses in analytics, full user-agent strings, precise location, or personal browsing identity.

The dashboard intentionally uses these labels:

- **Phone link clicks**: a visitor activated a `tel:` link; this does not prove a completed call.
- **Directions intent**: a visitor activated a map or directions entry point; this does not prove a showroom visit.
- **Estimate submissions**: the server accepted a lead and atomically created its conversion event.
- **Gallery-to-contact intent**: a gallery-engaged session later performed a phone, map, text, email, or estimate action.

These are engagement and lead-intent measures. To calculate financial ROI, add closed-deal status and revenue to the sales process, then connect those outcomes to the captured lead ID and attribution.
