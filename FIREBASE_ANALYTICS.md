# Firebase Dashboard and Analytics Runbook

The production website stays on Cloudflare. Cloudflare serves `public/` and streams `/api/*` plus `/feedback` to the Firebase `siteApi` Function after cutover. Firestore owns leads, email and feedback history, raw analytics, summaries, and Search Console imports. The dashboard uses Firebase Authentication with Google sign-in and Email/Password, and requires an `admin: true` custom claim.

Do not remove the D1 bindings or Cloudflare Cron until the final migration delta and production validation are complete. Retain D1 read-only for 30 days.

## Provisioned foundation

The Firebase project is `stone-bellisimo-dashboard`. Its web app, default `nam5` Firestore database, deny-by-default rules, indexes, Email/Password provider, strong password policy, email-enumeration protection, and approved authentication domains are already configured. Google sign-in and the allowlist blocking functions ship with the steps below. Billing, production secrets, App Check, the initial administrator, Search Console access, Functions deployment, D1 migration, and Cloudflare cutover remain deliberate production steps below.

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

The blocking functions never reject sign-in inside the emulator, so local QA accounts keep working, but they only grant `admin: true` to allowlisted addresses. Set the claim with the Admin SDK for local test accounts, as `tests/browser-smoke.mjs` does. Google sign-in against the emulator opens the Auth emulator's provider window instead of Google's.

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
3. Deploy the sign-in providers, then apply the hardened Auth policy with Application Default Credentials:

   ```sh
   npm run firebase:deploy:functions   # blocking functions must exist first
   npm run firebase:deploy:auth        # Email/Password plus Google sign-in
   gcloud auth application-default login
   npm run firebase:auth:configure -- --project <project-id>
   ```

   This enables strong-password enforcement and email privacy, blocks account deletion, and authorizes the Stone Bellisimo site, localhost, and the `firebaseapp.com`/`web.app` domains that host the Google sign-in handler.

   Account creation is no longer disabled project-wide, because Google sign-in has to create the account on an approved administrator's first visit. The `restrictAdminSignUp` blocking function is what keeps registration closed, so deploy Functions before running the configure step. Pass `--disable-signup` to the configure script to return to password-only intake.

   The `googleSignIn` block in `firebase.json` sets the OAuth consent support email to `jensyjimenez723@gmail.com`. Google requires that address to be a project owner or a group it owns; change it there if ownership moves.
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

### Functions runtime service account

All functions run as a dedicated least-privilege identity,
`functions-runtime@stone-bellisimo-dashboard.iam.gserviceaccount.com`, replacing
the default compute account (which held `roles/editor`). Its grants:

- `roles/datastore.user` — Firestore read/write
- `roles/secretmanager.secretAccessor` — granted per-secret on each of the eight
  secrets the functions use, so an unrelated future secret is not exposed
- `roles/logging.logWriter`
- `roles/eventarc.eventReceiver` and `roles/run.invoker` — so Firestore triggers
  and scheduled functions can fire

The account is selected in `firebase-functions.mjs` through a `defineString`
param, not a raw `process.env` read: the runtime service account is a
deploy-time option resolved during the CLI's code-analysis phase, where a plain
`process.env` value is not populated and `param.value()` returns a deferred
sentinel. The `FUNCTIONS_SERVICE_ACCOUNT` param object is therefore passed to
`setGlobalOptions` directly, and its default is the dedicated email.

Override `FUNCTIONS_SERVICE_ACCOUNT` in `functions/.env.stone-bellisimo-dashboard`
to point elsewhere. **Rollback:** set it to
`1087968800883-compute@developer.gserviceaccount.com` and redeploy; that account
retains `roles/editor`, so functions immediately regain full access. Do not grant
broad Owner or Editor to the dedicated account.

## Administrator provisioning

There is no public registration. `src/admin-accounts.mjs` holds the allowlist and is the single source of truth:

- `jensyjimenez723@gmail.com`
- `jonathan80azjr@gmail.com`
- `stonebellisimollc@outlook.com`

The `restrictAdminSignUp` and `restrictAdminSignIn` blocking functions enforce it on every sign-up and sign-in. An allowlisted address that signs in with Google is created and granted `admin: true` automatically on first visit; anyone else is rejected before an account exists. Sign-in re-applies the claim, so it repairs itself if the claim is ever lost. `SB_ADMIN_EMAILS` (comma-separated) extends the list without a code change; it can never shrink it.

Google sign-in only works for addresses that are Google accounts. `stonebellisimollc@outlook.com` is not a Gmail address, so it either has to be registered as a Google account or keep using the email/password form. Create that password account with a temporary password kept only in the current shell:

```sh
FIREBASE_ADMIN_INITIAL_PASSWORD='<temporary-strong-password>' \
  npm run firebase:admins -- --project <project-id> --create
```

Run the same command without `--create` any time to audit and repair claims. It grants `admin: true` to every allowlisted account that exists, reports the ones still awaiting a first Google sign-in, and warns about accounts holding the claim that are not on the allowlist. Add `--revoke` to strip those. Claim changes revoke existing refresh tokens.

`npm run firebase:admin -- --project <id> --email <address> [--create]` still handles a single arbitrary address, but an address that is not on the allowlist loses the claim again on its next sign-in.

The browser uses session-only persistence, verifies the `admin` claim before showing the dashboard, and signs out anyone without it. Every admin API independently verifies a non-revoked Firebase ID token plus the claim.

## Search Console

Verify `sc-domain:stonebellisimollc.com` in Google Search Console and grant the Functions runtime service-account email read-only access to that property. The daily Function imports recent data after Google's normal reporting delay. Backfill available history with:

```sh
npm run firebase:search:backfill -- --project <project-id>
```

The dashboard reports total and branded impressions, clicks, CTR, average position, queries, and landing pages. The branded view matches `Stone Bellisimo`, spacing/case variations, and `StoneBellisimo`. Search Console measures this site's appearances in Google; it does not expose every global search, and Google may omit anonymized or low-volume queries.

### Granting the service account access

This is the step that is easy to skip and produces no visible error on the site.
The import runs, fails with HTTP 403, and the dashboard simply shows nothing.

The import authenticates as the Functions runtime service account, which is now
the dedicated least-privilege identity:

```text
functions-runtime@stone-bellisimo-dashboard.iam.gserviceaccount.com
```

1. In Search Console, open **Settings → Users and permissions** for the
   `sc-domain:stonebellisimollc.com` property, choose **Add user**, paste that
   email, and give it **Full** (or **Restricted** — the importer only reads).
2. Wait for the next 5:15 AM America/New_York run, or backfill immediately.

A service account can only be added by a property **owner**. Ownership follows
the `google-site-verification` DNS TXT record on `stonebellisimollc.com`, which
is managed in Cloudflare.

Do **not** grant a service account from a different project (for example one in
the `stone-bellisimo` project). The import can only authenticate as the identity
its own function runs as; a grant on any other account is inert. Confirm the live
runtime identity if in doubt:

```sh
gcloud run services describe importsearchconsoleschedule \
  --region us-east1 --project stone-bellisimo-dashboard \
  --format='value(spec.template.spec.serviceAccountName)'
```

### Import health

`syncRecentSearchConsole` records every attempt to `analytics_health/search_console`:
`lastAttemptAt`, `lastSuccessAt`, `latestDataDate`, `rowsWritten`, `lastErrorCode`,
and `consecutiveFailures`. Only the HTTP status is stored, never the response
body, because Google echoes the site URL and token metadata in errors.

`GET /api/admin/search-console` returns this as a `health` object and the
dashboard renders it as a banner above the Search Console metrics:

| Status | Meaning |
| --- | --- |
| `pending` | The scheduled import has never run. Nothing is wrong yet. |
| `healthy` | Last run succeeded; the banner names the newest data date. |
| `stale` | No error, but no success in 36 hours — a run never fired. |
| `failed` | The last run errored. The banner names the status code and the fix. |

A failure also emails the admin allowlist through `admin_search_console_failure`,
rate limited to one message every three days so a permission grant nobody has
completed yet cannot become daily noise. The dashboard banner carries the live
state in between.

Diagnose a failing import without waiting for the schedule:

```sh
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="importsearchconsoleschedule"
   AND severity>=ERROR' \
  --project stone-bellisimo-dashboard --limit 10 --freshness 7d \
  --format='value(timestamp,textPayload)'
```

## Google Analytics 4

GA4 is a **secondary** verification layer. The first-party tracker in
`src/client/site-analytics.js` remains the source of truth for leads and
conversions: it is server-confirmed and survives ad blockers, which GA4 does not.

The measurement ID lives in exactly one place, `src/client/google-analytics.js`,
and is bundled to `public/assets/js/analytics.js` by `npm run build`. Every page
loads that one file. Do not set `window.STONE_BELLISIMO_GA_ID` inline in page
markup; that pattern put the ID in four pages, left six without it, and shipped a
`G-XXXXXXXXXX` placeholder to production.

To enable it, set `MEASUREMENT_ID` in `src/client/google-analytics.js` and run
`npm run build`. The loader validates the ID against `/^G-[A-Z0-9]+$/` and does
nothing at all when it is empty, so an unset ID is inert rather than broken.

**Any page that loads the tag also needs `https://www.googletagmanager.com` in
its CSP `script-src`, and `https://www.google-analytics.com`,
`https://region1.google-analytics.com`, plus `https://www.googletagmanager.com`
in `connect-src`.** The per-page CSP is inline in each HTML file's
`<meta http-equiv="Content-Security-Policy">`. A missing entry blocks GA silently
— the page still renders and only the browser console shows the violation.

Pages that intentionally carry no analytics: `public/admin/index.html` (the
dashboard itself), `public/service-areas/index.html` (a meta-refresh redirect
stub — tagging it would double-count the page it redirects to), and
`public/components/bitesites-banner.html` (a fragment, not a page).

## Bing Webmaster Tools

Bing feeds Bing, Yahoo, DuckDuckGo, and Copilot answers, so it is worth the few
minutes even though volume is far below Google.

The fastest path is **import from Google Search Console**, which requires no code
and no DNS change:

1. Sign in at <https://www.bing.com/webmasters> with an account that owns the
   Search Console property.
2. Choose **Import your site from Google Search Console** and authorize.
3. Select `sc-domain:stonebellisimollc.com`.

Ownership, sitemaps, and settings carry over. If import is unavailable, verify
manually by adding a second DNS TXT record in Cloudflare — do **not** replace the
existing `google-site-verification` record, or Search Console ownership is lost
and the importer starts returning 403.

Bing data is not imported into Firestore. There is no Bing equivalent of
`search_console_daily`; read it in the Bing UI. Adding an importer would need a
Bing API key stored as a Firebase secret.

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

5. Verify a real contact submission, Firestore lead write, immediate Postmark email, feedback link, Postmark webhooks, dashboard email send, analytics ingestion, and Search Console status.
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
- **Likely off-site calls**: a desktop session held a phone number at least half in view for several seconds and then stopped driving the page. This is the weakest signal on the dashboard and proves nothing on its own — see below.

These are engagement and lead-intent measures. To calculate financial ROI, add closed-deal status and revenue to the sales process, then connect those outcomes to the captured lead ID and attribution.

## Off-site call signals (`phone_dwell`)

A visitor on a phone taps the number and that tap is recorded as a `cta_click`. A visitor on a desktop reads the number off the screen and dials on a handset, which produces no click at all — so the entire desktop side of phone demand was previously invisible.

The tracker infers it. On desktop only, it measures how long each `tel:`/`sms:` element stays at least 50% in the viewport with the tab visible, and emits one `phone_dwell` event per number per page per session when the dwell ends. `exitReason` records how it ended, ordered strongest to weakest as evidence:

| Reason | Meaning | Floor |
| --- | --- | --- |
| `blur` | The browser window lost focus with the number on screen. | 4s |
| `hidden` | The tab was hidden with the number on screen. | 4s |
| `idle` | No pointer, key, or scroll for 45s with the number on screen. | 4s |
| `dwell` | The number scrolled out of view or the page unloaded. | 8s |

Deliberate limits:

- Signals are excluded from `highIntentActions` and the gallery-to-contact funnel. They are inferred from a timer rather than an action the visitor took, and folding them in would silently change what every historical number on those charts means.
- `phoneDwellSessions` counts sessions, not numbers. One visitor lingering over the office line and then the owner's line is one likely call.
- Dwell stops accumulating after 45s without input, so a tab abandoned on the contact section does not read as an hour-long call.
- A number the visitor went on to click is suppressed, so one contact attempt is not reported as both a click and a dwell.
- Mobile and tablet sessions are rejected server-side; so are durations, CTA types, and exit reasons the browser would not have produced.

Read the number as a floor on desktop phone interest, never as a call count. Confirming it means asking callers where they found the number, or routing a distinct tracking number per placement.

## Test traffic classification

QA visits are separated from business traffic so production monitoring never inflates the numbers.

Tag a QA session on the landing URL:

```text
https://stonebellisimollc.com/?utm_source=qa&utm_medium=test&utm_campaign=roi_validation&utm_content=<run-id>
```

`utm_source` values `qa`, `test`, `staging`, `synthetic`, and `lighthouse`, and `utm_medium` values `test`, `qa`, `synthetic`, and `monitoring`, mark a visit as test. The rule lives in `classifyTrafficClass` in `src/analytics.mjs` and is deliberately kept out of the browser bundle. Never use these values on a real marketing link: the traffic disappears from default reporting.

Behavior:

- `trafficClass` is derived server-side in `sanitizeAttribution`. A browser-supplied `trafficClass` is ignored, so a visitor can neither hide real traffic nor promote QA traffic into business reporting.
- The tracker stores campaign tags for the whole 30-minute session, so every event in a tagged session — including the server-confirmed `form_submit` — classifies as test. The lead document inherits it at `attribution.trafficClass`.
- Test events aggregate into parallel documents suffixed `__test` (`analytics_daily/<date>__test`, and the same suffix in `analytics_cta_daily`, `analytics_dimension_daily`, `analytics_session_daily`, `analytics_unique_daily`). Production document IDs are unchanged, so no migration is required and historical rows stay correct.
- `GET /api/admin/analytics` excludes test traffic by default. `?trafficClass=all` includes it and `?trafficClass=test` shows only QA. The response always reports excluded test volume in `testTraffic`, which the dashboard shows above the metrics.
- Aggregate documents written before this feature carry no `trafficClass` and are read as production.

Limitations:

- Classification is per session. If a QA session lapses past 30 minutes and the tester continues without the tag, later events count as production.
- Test records are kept for debugging and are never deleted automatically.
