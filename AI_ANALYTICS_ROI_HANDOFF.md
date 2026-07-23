# Analytics Reliability and ROI Measurement: AI Agent Handoff

## Purpose

This document is the execution brief for an AI agent taking over analytics validation and ROI measurement for the Stone Bellisimo website and administrator dashboard.

The agent's job is not merely to add more activity metrics. The target outcome is a reliable, auditable measurement loop:

```text
marketing spend
    -> attributed website session or phone call
    -> captured lead
    -> qualified lead
    -> estimate and quote
    -> won or lost project
    -> revenue and gross profit
    -> channel/campaign ROI
    -> qualified/won outcome returned to the ad platform
```

The work must preserve the existing lead, email, feedback, and analytics flows. It must not expose customer information, weaken authentication, silently change business definitions, or deploy production changes without explicit authorization.

## Executive summary

The current system has a solid base:

- A first-party browser tracker captures page views, CTA impressions and clicks, form steps, gallery engagement, attribution, and performance metrics.
- Estimate submissions create the lead and the server-confirmed `form_submit` analytics event atomically.
- Raw analytics events are idempotent and are summarized by a Firestore trigger.
- The dashboard reports sessions, page views, estimate submissions, high-intent actions, CTA performance, landing pages, referrers, campaigns, devices, and Search Console metrics.
- Search Console has a scheduled importer and a historical backfill script.
- Firebase Authentication and deny-by-default Firestore rules protect dashboard data.

The current system cannot yet prove financial ROI because it does not record the complete sales outcome, marketing cost, or completed phone calls. It also needs production data-health reporting, test-traffic exclusion, richer attribution identifiers, and automated reconciliation.

The recommended order is:

1. Refresh the production-state snapshot and validate the existing pipeline end to end.
2. Backfill and verify Search Console.
3. Add data-health monitoring and test-traffic handling.
4. Add the lead sales funnel and revenue/profit fields.
5. Extend attribution and campaign identifiers.
6. Add completed-call measurement.
7. Import marketing costs and export qualified/won conversions to ad platforms.
8. Add financial ROI reporting to the dashboard.

Do not begin with ad-platform automation. Reliable lead outcomes and attribution must exist first.

## Repository and production context

### Local repository

- Repository root: `/Users/maxj/Documents/stonebellisimo-main`
- Node runtime declared by the project: Node 22
- Primary package scripts: `package.json`
- Existing Firebase/runbook documentation: `FIREBASE_ANALYTICS.md`
- Existing email/lead automation documentation: `POSTMARK_AUTOMATION.md`
- Cloudflare configuration: `wrangler.jsonc`
- Firebase configuration: `firebase.json`
- Firestore indexes and rules: `firestore.indexes.json`, `firestore.rules`

At the time this handoff file was created, the worktree was clean before this file was added. The next agent must run `git status --short` before editing and must preserve any user changes that appear later.

### Production services

- Public site: `https://stonebellisimollc.com`
- Dashboard: `https://stonebellisimollc.com/admin/`
- Firebase project: `stone-bellisimo-dashboard`
- Firebase region for Functions: `us-east1`
- Firestore database: `(default)` in `nam5`
- Search Console property configured in code: `sc-domain:stonebellisimollc.com`
- Cloudflare Worker: `stonebellisimo-forms`

Cloudflare serves the static site and proxies `/api/*` and `/feedback` to the Firebase `siteApi` function. The proxy adds the shared `x-sb-proxy-secret`; direct public access to the Function must remain protected.

The D1 database and previous Cloudflare code path are a rollback mechanism during the migration stabilization period. Do not delete D1 bindings, migrations, or rollback code unless the user explicitly confirms that the retention period is over and requests removal.

### Relevant deployed functions

The following functions were observed active during the July 20, 2026 review:

- `siteApi`: HTTP API for public and authenticated dashboard requests
- `summarizeAnalyticsEvent`: Firestore `analytics_events/{eventId}` create trigger
- `importSearchConsoleSchedule`: scheduled Search Console importer
- `processFeedbackSchedule`: scheduled feedback-email processing

The next agent must refresh this observation with:

```sh
npx firebase functions:list --project stone-bellisimo-dashboard
```

This is a read-only diagnostic. Do not redeploy merely because the local source differs from a deployed build; first identify and report the difference.

## Current implementation map

### Browser tracking

Source: `src/client/site-analytics.js`

Build output: `public/performance.js`

Build script: `scripts/build-client.mjs`

Public pages load `performance.js?v=2`. Do not confuse this with the obsolete-looking `assets/js/analytics.js` references that may exist in page markup. The active first-party tracker is the built `performance.js` bundle.

The tracker currently:

- Generates anonymous first-party visitor and 30-minute session IDs.
- Stores queued events locally and retries failed batches.
- Sends batches of at most 20 events to `POST /api/analytics/events`.
- Captures landing page, referrer hostname, UTM fields, and coarse device category.
- Tracks `page_view`, CTA impressions/clicks, gallery engagement, form interaction, and web-performance metrics.
- Attempts to attach an App Check token when App Check is configured.
- Does not block navigation when analytics delivery fails.

### Analytics validation, storage, and aggregation

Source: `src/analytics.mjs`

Important collections:

- `analytics_events`: raw idempotent events
- `analytics_aggregations`: per-event aggregation markers
- `analytics_daily`: daily totals
- `analytics_unique_daily`: daily session/visitor and unique CTA markers
- `analytics_session_daily`: session facts used for gallery-to-intent reporting
- `analytics_cta_daily`: CTA daily facts
- `analytics_dimension_daily`: page, referrer, campaign, and device facts

Important properties:

- Every browser event requires a client-generated event ID.
- Duplicate IDs must not double count.
- Event timestamps outside the accepted seven-day window are rejected.
- `form_submit` is server-confirmed; a browser success screen alone must never be the source of truth.
- Lead creation plus the server conversion event is atomic in Firestore.
- Raw events must stay free of direct customer PII.

### Firebase routing and security

Sources:

- `firebase-functions.mjs`
- `src/firebase-security.mjs`
- `firestore.rules`
- `cloudflare-worker.mjs`

Important endpoints:

- `POST /api/analytics/events`: public analytics ingestion after origin and App Check checks
- `POST /api/contact`: lead submission and server conversion
- `GET /api/firebase-config`: public Firebase/App Check client configuration
- `GET /api/admin/analytics`: authenticated dashboard analytics
- `GET /api/admin/search-console`: authenticated Search Console analytics
- `GET /api/admin/leads`: authenticated lead list
- `GET /api/admin/leads/:id`: authenticated lead detail

Admin APIs require a valid Firebase ID token with the `admin: true` custom claim. Direct browser Firestore access is denied. Keep this architecture.

### Dashboard

Sources:

- `public/admin/index.html`
- `src/client/admin.js`
- `public/assets/js/admin.js` generated by the client build
- `src/admin-dashboard.mjs`
- `src/firebase-store.mjs`

The dashboard currently treats lead email/feedback state as its lead status. It does not have a sales pipeline status, quote value, won revenue, job cost, gross profit, or loss reason.

The dashboard intentionally labels telephone interactions as telephone-link clicks. That indicates intent, not a completed or answered call.

### Search Console

Sources:

- `src/search-console.mjs`
- `scripts/backfill-search-console.mjs`
- scheduled function `importSearchConsoleSchedule` in `firebase-functions.mjs`

Collections:

- `search_console_daily`
- `search_console_queries`

The scheduled importer runs at 5:15 AM America/New_York and uses a normal reporting lag of two days. It imports a rolling seven-day range. The backfill script imports historical data in 30-day chunks.

Search Console is visibility/acquisition data, not direct financial ROI data. It may omit anonymized or low-volume query detail even when daily totals exist.

## Production-state snapshot from the initial review

This snapshot is evidence from July 20, 2026 and will become stale. Refresh it before drawing conclusions.

- The live site returned HTTP 200.
- The live `/performance.js?v=2` tracker bundle returned HTTP 200 and contained the active analytics client.
- `/api/firebase-config` reported a configured production Firebase web app.
- The Firebase Functions listed above were active.
- App Check enforcement was `false` and the public App Check site key was blank.
- Firestore contained one known synthetic server conversion labeled `Codex production E2E test`.
- That event was summarized successfully into `analytics_daily`, proving the raw-event-to-trigger-to-summary path.
- At that moment, `analytics_cta_daily` and `analytics_dimension_daily` were empty.
- At that moment, `search_console_daily` was empty because the newly deployed scheduled importer had not yet completed its first scheduled run/backfill.

Do not treat the synthetic event as a real customer lead or ROI evidence. Do not delete it without explicit authorization. Prefer excluding labeled test traffic in reports.

## Safety and operating constraints

The executing agent must follow all of these constraints:

1. Run `git status --short` before editing. Preserve unrelated or uncommitted user work.
2. Never print access tokens, Firebase ID tokens, API keys, Postmark secrets, proxy secrets, or customer PII.
3. Use configured CLIs and credentials only for task-relevant operations.
4. Treat production event creation, backfills, Firestore writes, configuration changes, deployments, ad-platform uploads, and call-tracking changes as external mutations.
5. Obtain explicit user authorization before production deployment or account-level setup that incurs cost or changes customer-facing behavior.
6. Never submit a realistic-looking test lead without clearly labeling it as test traffic.
7. Do not delete test or customer records unless the user explicitly requests deletion and the exact targets have been verified.
8. Do not weaken Firebase Auth, App Check, origin validation, proxy-secret validation, Firestore rules, rate limiting, or idempotency to make a test pass.
9. Do not send raw email addresses, phone numbers, or names to the general analytics event stream.
10. Do not claim that a telephone-link click is a call, that a map click is a showroom visit, or that a form submission is revenue.
11. Do not claim exact keyword-level SEO attribution from Search Console. Query data is aggregated and can be anonymized.
12. Use integer cents for all currency stored in application data. Do not use binary floating-point dollars.
13. Use UTC ISO timestamps in storage. Convert to America/New_York only for display and scheduled business behavior.
14. Preserve the server-confirmed and atomic nature of estimate conversions.
15. Make every importer/exporter idempotent and safe to retry.

## Business definitions that must be agreed and encoded

The dashboard must use stable definitions. Do not invent different meanings in different components.

### Funnel stages

Recommended `salesStatus` values:

- `new`: submitted but not yet contacted
- `contacted`: a staff member made or attempted meaningful contact
- `qualified`: valid project, service area, timing, and budget fit
- `estimate_scheduled`: an on-site or remote estimate is scheduled
- `quoted`: a quote was delivered
- `won`: the customer accepted and the project is booked/contracted
- `lost`: the opportunity was valid but not won
- `unqualified`: spam, duplicate, outside service area, non-service request, or otherwise invalid

The user should confirm whether `contacted` means attempted contact or a successful two-way conversation. If the distinction matters, add `contact_attempted` and retain `contacted` for successful contact.

### Financial definitions

- `quoteAmountCents`: quoted customer price
- `wonRevenueCents`: contracted/won customer revenue, not cash received unless the business explicitly chooses cash accounting
- `estimatedCostCents`: expected direct materials and labor cost associated with the won job
- `grossProfitCents`: `wonRevenueCents - estimatedCostCents`
- `marketingSpendCents`: channel/campaign cost for the selected reporting period
- Revenue ROAS: `attributed won revenue / attributable advertising spend`
- Gross-profit ROI: `(attributed gross profit - attributable marketing spend) / attributable marketing spend`

Display both ROAS and ROI. Do not label ROAS as ROI.

When spend is zero, return `null` for ROAS/ROI and render an em dash or `Not available`; do not display infinity or 0%.

### Attribution definitions

Recommended default views:

- First touch: use for acquisition and “what introduced the customer?” reporting.
- Last non-direct touch: use for campaign optimization and “what drove the final inquiry?” reporting.
- Direct/unknown: preserve as its own category. Do not redistribute it to make channels look better.

Do not attempt fractional multi-touch modeling until first-touch and last-touch reports are accurate and understood by the business.

## Phase 0: refresh the baseline

### Objective

Produce a fresh, read-only production-state report before changing code.

### Required checks

1. Confirm worktree state and current commit:

   ```sh
   git status --short
   git rev-parse --short HEAD
   ```

2. Confirm public site and active tracker:

   ```sh
   curl -sS -o /dev/null -w '%{http_code}\n' https://stonebellisimollc.com/
   curl -sS -o /dev/null -w '%{http_code}\n' 'https://stonebellisimollc.com/performance.js?v=2'
   curl -sS https://stonebellisimollc.com/ | rg 'performance\.js|StoneBellisimoAnalytics'
   ```

3. Confirm Firebase functions:

   ```sh
   npx firebase functions:list --project stone-bellisimo-dashboard
   ```

4. Review recent logs for ingestion, aggregation, and Search Console without exposing payload PII:

   ```sh
   npx firebase functions:log --only siteApi --project stone-bellisimo-dashboard --lines 50
   npx firebase functions:log --only summarizeAnalyticsEvent --project stone-bellisimo-dashboard --lines 50
   npx firebase functions:log --only importSearchConsoleSchedule --project stone-bellisimo-dashboard --lines 50
   ```

5. Count or sample only the minimum Firestore documents needed to establish freshness. Redact or omit customer fields in any report.

6. Record:

   - latest raw event timestamp
   - latest summarized event timestamp
   - count of unsummarized raw events
   - latest `analytics_daily` date
   - latest Search Console date and sync timestamp
   - latest successful/failed scheduled function run
   - App Check configured/enforced state

### Acceptance criteria

- The report distinguishes deployed configuration from local source.
- No production data is changed.
- No credentials or PII appear in output.
- Every claimed gap is backed by a current endpoint, collection, or log observation.

## Phase 1: controlled end-to-end analytics verification

### Objective

Prove that a real browser session traverses the live Cloudflare and Firebase path and that raw, summarized, and dashboard values agree.

### Prerequisite

Production event creation is a mutation. Obtain user approval immediately before running the production test. Use the Firebase Emulator Suite first for all repeatable tests.

### Test URL

Use a clearly labeled tagged URL such as:

```text
https://stonebellisimollc.com/?utm_source=qa&utm_medium=test&utm_campaign=roi_validation&utm_content=<unique-run-id>
```

Use a unique, non-PII run ID. Never place an access token, email address, phone number, or person name in a UTM field.

### Required user journey

Test on desktop and mobile viewport where practical:

1. Load the landing page.
2. Wait long enough for the initial analytics batch to flush.
3. Scroll until at least one CTA is at least 50% visible.
4. Open or engage with the gallery.
5. Activate a clearly identified estimate CTA.
6. Progress through each form step.
7. Submit one unmistakably synthetic estimate request using user-approved test contact data.
8. Separately exercise phone, SMS, email, and directions links without completing an unwanted external action.
9. Confirm navigation still proceeds if `/api/analytics/events` is intentionally blocked in an emulator/browser test.

### Expected raw events

At minimum:

- `page_view`
- one or more `cta_impression`
- one or more `cta_click`
- `gallery_view` when the threshold is reached
- `form_start`
- expected `form_step` events
- exactly one server-generated successful `form_submit`
- relevant `performance` events when supported by the browser

`form_submit` must be tied to the created lead and must not be duplicated by a browser event.

### Expected summaries

- `analytics_daily.pageViews` increases once for the test page view.
- The session and visitor are counted once per applicable daily uniqueness rule.
- CTA impressions and clicks appear in `analytics_cta_daily`.
- Page, campaign, and device rows appear in `analytics_dimension_daily`.
- The lead conversion increases `formSubmissions` and `highIntentActions` exactly once.
- `analytics_session_daily` reflects gallery and later intent in an order-independent way.
- The authenticated dashboard agrees with the aggregate documents for the selected date.

### Test-traffic handling requirement

Before routine production synthetic monitoring is introduced, implement a test-traffic classification. Recommended behavior:

- Treat `utm_source=qa` and `utm_medium=test` as test traffic.
- Store `trafficClass: "test"` on raw and aggregate facts.
- Exclude test traffic from the dashboard by default.
- Provide an explicit administrator toggle to include test traffic.
- Keep test records for debugging rather than deleting them automatically.
- Never allow a client-provided `trafficClass` to classify arbitrary traffic as trusted production data; derive it server-side from validated rules.

If this classification has not yet been implemented, report the exact test events and their run ID so the business can exclude them manually.

### Acceptance criteria

- All expected events arrive through the public production route.
- No event is double counted after retrying the same ID.
- Raw-to-summary lag is measured and is below the agreed threshold, initially 10 minutes.
- Dashboard totals match direct aggregate reads.
- Test traffic is clearly distinguishable from business traffic.
- Browser console and network logs have no uninvestigated analytics errors.

## Phase 2: Search Console activation and verification

### Objective

Populate historical and daily Google organic-search visibility data and make failures visible.

### Account dependency

The Functions runtime service account must have read access to the Search Console domain property. During the initial review, Functions were using the default compute service account. Confirm the current runtime identity rather than hard-coding the old observation.

If access is missing, report the exact service-account email and ask the property owner to grant read-only Search Console access. Do not attempt to transfer ownership or broaden Google Cloud IAM roles.

### Backfill

After read access and Application Default Credentials are confirmed:

```sh
npm run firebase:search:backfill -- --project stone-bellisimo-dashboard
```

For a safer first verification, use a small explicit date range ending at least two days ago:

```sh
npm run firebase:search:backfill -- \
  --project stone-bellisimo-dashboard \
  --start YYYY-MM-DD \
  --end YYYY-MM-DD
```

The backfill writes production Firestore data. Obtain approval before running it.

### Validation

- Confirm `search_console_daily` contains daily totals.
- Confirm `search_console_queries` contains query/page rows where Google returns them.
- Confirm the dashboard `configured` state becomes true when daily rows exist.
- Compare several days against the Search Console UI, allowing for processing lag and anonymized-query differences.
- Confirm the next scheduled run writes a newer `syncedAt` value.
- Confirm a failed scheduled import produces a visible health state and alert.

### Acceptance criteria

- Historical data is present for the available property history.
- The latest imported date is consistent with the configured two-day lag.
- The scheduler completes successfully for at least two consecutive runs.
- The dashboard clearly explains that query detail can be incomplete.
- Search Console metrics are never presented as direct revenue attribution.

## Phase 3: data-health monitoring and reconciliation

### Objective

Make silent analytics failure difficult. An administrator should be able to tell whether the numbers are fresh, delayed, incomplete, or healthy.

### Recommended health model

Add a small server-owned health collection, for example `analytics_health`, with documents such as:

- `ingestion`: `lastAcceptedAt`, `lastEventIdHash`, `acceptedCount`, `duplicateCount`, `rejectedCount`
- `aggregation`: `lastAggregatedAt`, `lastEventIdHash`, `lastLatencyMs`, `errorCount`
- `search_console`: `lastAttemptAt`, `lastSuccessAt`, `latestDataDate`, `rowsWritten`, `lastErrorCode`
- `cost_import`: reserved for the later cost importer
- `conversion_export`: reserved for later ad-platform exports

Do not store raw event payloads, PII, credentials, or full exception stacks in these documents.

Add authenticated endpoint:

```text
GET /api/admin/analytics-health
```

Recommended response shape:

```json
{
  "success": true,
  "overall": "healthy",
  "checkedAt": "2026-07-21T12:00:00.000Z",
  "ingestion": {
    "status": "healthy",
    "lastAcceptedAt": "..."
  },
  "aggregation": {
    "status": "healthy",
    "pendingCount": 0,
    "oldestPendingAt": null,
    "lastLatencyMs": 2100
  },
  "searchConsole": {
    "status": "healthy",
    "lastSuccessAt": "...",
    "latestDataDate": "2026-07-19"
  }
}
```

### Reconciliation rules

Implement a scheduled reconciliation that is idempotent and read-mostly:

- Find raw events without a corresponding aggregation marker after 10 minutes.
- Compare countable raw events by day with `analytics_daily.events`.
- Verify server `form_submit` events correspond to lead IDs.
- Detect impossible states such as aggregate counts below zero.
- Detect Search Console staleness after 36 hours without a successful scheduled import.
- Record a concise health result; do not silently rewrite summaries unless a separately reviewed repair mode is explicitly invoked.

An absence of visitors is not automatically a system failure. Alert on endpoint, queue, trigger, or freshness evidence rather than assuming every quiet period is broken tracking.

### Dashboard behavior

Add a compact health banner or panel:

- Green: healthy and current
- Amber: delayed, first run pending, or data source not fully configured
- Red: ingestion failure, unsummarized events over threshold, or repeated scheduled-import failure

Show exact timestamps and a short remediation message. Do not show a vague green check without freshness details.

### External alerts

Prefer Cloud Logging-based alerts for:

- repeated `siteApi` 5xx responses
- `summarizeAnalyticsEvent` failures
- `importSearchConsoleSchedule` failures
- aggregation backlog over threshold
- authentication/App Check rejection spikes after enforcement

Account-level alert creation needs explicit authorization. Document filters and thresholds in the repository even if the user must create the alert in the console.

### Acceptance criteria

- A deliberately failed emulator aggregation produces an unhealthy state.
- A successful retry returns the system to healthy without double counting.
- The dashboard reports current timestamps from the server.
- Search Console staleness becomes visible without reading logs.
- Health data contains no PII.

## Phase 4: lead sales funnel and financial outcomes

### Objective

Make every real lead capable of producing a qualified, won/lost, revenue, and gross-profit result.

### Recommended lead fields

Add these fields to Firestore lead documents while preserving all existing fields:

```json
{
  "salesStatus": "new",
  "salesStatusUpdatedAt": "2026-07-21T12:00:00.000Z",
  "assignedTo": null,
  "contactedAt": null,
  "qualifiedAt": null,
  "estimateScheduledAt": null,
  "quotedAt": null,
  "quoteAmountCents": null,
  "wonAt": null,
  "wonRevenueCents": null,
  "estimatedCostCents": null,
  "lostAt": null,
  "lossReason": null,
  "lossNotes": null,
  "currency": "USD",
  "outcomeUpdatedAt": "2026-07-21T12:00:00.000Z",
  "outcomeVersion": 1
}
```

Recommended controlled loss reasons:

- `price`
- `timing`
- `competitor`
- `no_response`
- `outside_service_area`
- `project_not_supported`
- `duplicate`
- `spam`
- `customer_cancelled`
- `other`

Require `lossNotes` when `lossReason` is `other`. Keep notes short and never use this field for payment-card, government-ID, or other unnecessary sensitive information.

### Audit trail

Add append-only `lead_outcome_events` documents for every outcome change:

```json
{
  "id": "outcome_<uuid>",
  "leadId": "<lead-id>",
  "eventType": "status_changed",
  "previousStatus": "qualified",
  "newStatus": "quoted",
  "changes": {
    "quoteAmountCents": { "from": null, "to": 1250000 }
  },
  "changedAt": "2026-07-21T12:00:00.000Z",
  "changedByUid": "<firebase-admin-uid>"
}
```

Do not store the administrator's ID token. Store only the verified Firebase UID or another non-secret audit identifier.

Use a Firestore transaction to update the lead and create the audit event. Validate legal status transitions, but allow an administrator to correct mistakes with an explicit correction event.

### API contract

Recommended authenticated endpoint:

```text
PATCH /api/admin/leads/:leadId/outcome
```

Example request:

```json
{
  "salesStatus": "won",
  "wonRevenueCents": 1850000,
  "estimatedCostCents": 1120000,
  "expectedOutcomeVersion": 3
}
```

Example response:

```json
{
  "success": true,
  "lead": {
    "id": "...",
    "salesStatus": "won",
    "wonRevenueCents": 1850000,
    "estimatedCostCents": 1120000,
    "grossProfitCents": 730000,
    "outcomeVersion": 4
  }
}
```

Use `expectedOutcomeVersion` to prevent one administrator tab from silently overwriting a newer change. Return HTTP 409 on version conflict.

Derive `grossProfitCents` in responses and reports. If it is persisted for query performance, recalculate it server-side only and test consistency.

### Dashboard UX

In lead detail, add:

- pipeline status control
- assigned salesperson
- relevant status dates
- quote amount
- won revenue and estimated direct cost
- gross profit preview
- loss reason and notes
- audit timeline

Add filters for each pipeline status. Do not replace the existing email/feedback health indicators; show sales status and communication status separately.

### Migration behavior

- Existing leads receive `salesStatus: "new"` unless the business supplies an outcome mapping.
- Never infer `won` from a five-star review, confirmation email, or feedback response.
- Never infer `qualified` merely from a valid form submission.
- Write a dry-run migration report before updating production documents.
- Make the migration idempotent and checkpointed.

### Acceptance criteria

- Authorized admins can update outcomes; unauthorized users cannot.
- Every update creates a matching audit event.
- Invalid currency, negative values, invalid status, and stale versions are rejected.
- A won lead with revenue and cost produces the correct gross profit.
- Existing leads and email/feedback functions continue working.
- Emulator tests cover status transitions, corrections, concurrent updates, and audit records.

## Phase 5: attribution expansion

### Objective

Retain the campaign identifiers needed to connect the lead to advertising and distinguish first touch from the final session.

### Fields to capture

In addition to the existing UTMs, add validated support for:

- `utmId`
- `utmSourcePlatform`
- `gclid`
- `gbraid`
- `wbraid`
- `msclkid`
- `fbclid`

Recommended attribution structure on a lead:

```json
{
  "attributionVersion": 2,
  "firstTouch": {
    "occurredAt": "...",
    "landingPage": "/",
    "referrerHost": "google.com",
    "utmSource": "google",
    "utmMedium": "cpc",
    "utmCampaign": "countertops_nj",
    "utmId": "...",
    "utmContent": "...",
    "utmTerm": "...",
    "gclid": "..."
  },
  "lastTouch": {
    "occurredAt": "...",
    "landingPage": "/contact-us/",
    "referrerHost": "",
    "utmSource": "google",
    "utmMedium": "cpc",
    "utmCampaign": "countertops_nj",
    "gclid": "..."
  }
}
```

### Rules

- Preserve the current attribution fields for backward compatibility during migration.
- First touch is write-once for the anonymous visitor unless the visitor resets storage.
- Last touch updates only on a new qualifying campaign/referral; direct navigation must not automatically erase a prior non-direct touch.
- Normalize UTM naming consistently, preferably lowercase with documented separators.
- Sanitize length and control characters for every identifier.
- Do not place click identifiers into URLs, logs, or UI more than necessary.
- Do not treat click identifiers as proof of a conversion until a valid lead/outcome exists.
- Add an explicit attribution model label to every ROI response.

### Campaign naming standard

Create a short repository document or constants module defining:

- allowed/expected `utm_source` values
- allowed/expected `utm_medium` values
- campaign naming format
- content/creative naming format
- how offline sources such as postcards, showroom QR codes, and partner links are tagged

Minimum required UTMs on controlled marketing links are `utm_source`, `utm_medium`, and `utm_campaign`. Use `utm_id` where an ad platform or internal campaign ID exists.

### Acceptance criteria

- Browser and server tests prove all new identifiers survive sanitization and lead creation.
- First touch does not change during direct return visits.
- Last non-direct touch updates on a later tagged campaign.
- Existing untagged traffic remains `direct/unknown`, not falsely attributed.
- Dashboard breakdowns do not fragment obvious case/spelling variants after normalization.

## Phase 6: completed-call measurement

### Objective

Measure actual calls rather than only `tel:` activations and connect qualifying calls to lead outcomes.

### Required decision from the user

Do not purchase or configure a call-tracking service without approval. The user must choose between:

1. Google forwarding numbers for Google Ads website-call conversions. This is useful for Google Ads but does not provide complete cross-channel call attribution.
2. A cross-channel call-tracking provider with dynamic number insertion, source/session attribution, call duration, and webhook/API access.
3. A limited manual call-outcome workflow if the business is not ready for a paid provider.

The site exposes multiple real business numbers for Bella, the office, the owner, sales, and Jonathan. Inventory every visible number and business purpose before introducing number substitution. Do not accidentally route calls to the wrong recipient.

### Minimum call record

```json
{
  "id": "call_<provider-id-or-hash>",
  "provider": "...",
  "providerCallId": "...",
  "startedAt": "...",
  "durationSeconds": 142,
  "answered": true,
  "source": "google",
  "medium": "cpc",
  "campaign": "countertops_nj",
  "landingPage": "/",
  "sessionIdHash": "...",
  "leadId": null,
  "qualified": null,
  "createdAt": "..."
}
```

### Webhook requirements

- Verify the provider signature before reading or storing payloads.
- Make provider event IDs idempotent.
- Store only the fields needed for attribution and sales follow-up.
- Avoid recordings/transcripts unless the user explicitly requests them and legal/consent requirements have been reviewed.
- Keep call-click metrics separate from completed calls.
- Define a call conversion using answered status and a business-approved minimum duration, but allow staff to override qualification.

### Acceptance criteria

- A test call reaches the correct business destination.
- The call appears once despite webhook retry.
- Source/campaign data is retained where the provider supplies it.
- Dashboard differentiates telephone-link clicks, connected calls, qualified calls, and call-generated won jobs.
- Existing numbers, schema markup, accessibility labels, and mobile click behavior remain correct.

## Phase 7: marketing cost ingestion

### Objective

Add the denominator required for cost-per-lead, ROAS, and ROI.

### Start simple

Use an authenticated manual CSV or admin-entry workflow before building multiple ad APIs. This proves the reporting model without waiting for every platform integration.

Recommended collection: `marketing_cost_daily`

Recommended document ID:

```text
<date>__<platform>__<account-id>__<campaign-id>
```

Recommended fields:

```json
{
  "date": "2026-07-21",
  "platform": "google_ads",
  "accountId": "...",
  "campaignId": "...",
  "campaignName": "countertops_nj",
  "spendCents": 42500,
  "currency": "USD",
  "impressions": 18200,
  "clicks": 316,
  "source": "manual_csv",
  "sourceUpdatedAt": "...",
  "importedAt": "...",
  "importRunId": "..."
}
```

### Import rules

- Parse money as decimal text and convert safely to integer cents.
- Reject mixed currencies unless currency conversion has an explicit source and date.
- Upsert by deterministic document ID.
- Keep import run metadata and row-level error reporting.
- Provide dry-run output before writing.
- Never log access tokens or complete API responses containing account information.
- Distinguish ad spend from agency fees, creative costs, call-tracking fees, and other marketing overhead. Provide a reporting option for media-only ROAS and fully loaded marketing ROI.

### Later automation

After the manual model is correct, add approved connectors for Google Ads and any other active platforms. Ask the user which platforms and accounts are actually in use. Do not build unused integrations.

### Acceptance criteria

- Re-importing the same file does not duplicate cost.
- Invalid dates, currencies, negative spend, and malformed amounts are rejected.
- Dashboard totals match the input file/account totals for sampled days.
- Cost is joined to attribution using stable campaign IDs where possible, not campaign names alone.

## Phase 8: offline conversion export

### Objective

Return valuable downstream outcomes to ad platforms so reporting and bidding optimize for quality rather than raw form volume.

### Google Ads priority events

Create distinct conversion actions for:

- qualified lead
- estimate scheduled
- won project
- won project value

Do not optimize bidding on all actions at once. During validation, follow Google Ads diagnostics and keep new downstream actions secondary until match quality and duplicate handling are proven.

As of this handoff, Google directs new/current enhanced-conversions-for-leads upload implementations toward Google Ads Data Manager/Data Manager API. Do not begin a new legacy Google Ads API upload implementation without checking current official documentation.

### Export queue

Recommended collection: `conversion_exports`

```json
{
  "id": "google_ads__<lead-id>__won__<outcome-version>",
  "platform": "google_ads",
  "leadId": "...",
  "eventType": "won_project",
  "outcomeVersion": 4,
  "conversionOccurredAt": "...",
  "valueCents": 1850000,
  "currency": "USD",
  "status": "pending",
  "attemptCount": 0,
  "lastAttemptAt": null,
  "exportedAt": null,
  "providerReference": null,
  "lastErrorCode": null,
  "createdAt": "..."
}
```

### Privacy and normalization

- Confirm the business has accepted applicable customer-data terms.
- Review/update the website privacy notice and consent behavior before enabling user-provided-data matching.
- Normalize email and phone exactly as required by the platform.
- Hash first-party data using the required current algorithm and rules immediately before transmission.
- Do not store additional unhashed PII merely for advertising export; use the existing protected lead record.
- Do not write hashed PII into application logs.

### Idempotency and corrections

- Use one deterministic export key per platform, lead, conversion event, and outcome version.
- Record provider acknowledgements.
- Support correction/retraction when an administrator reverses a won status or value.
- Retry transient failures with bounded backoff.
- Surface permanent failures in the health panel.

### Acceptance criteria

- Test conversions are accepted by the platform diagnostics without appearing as production value.
- Reprocessing an outcome does not create a duplicate conversion.
- Qualified and won actions remain distinct.
- Conversion time and value match the lead outcome record.
- Failed exports are visible and safely retryable.

## Phase 9: ROI dashboard requirements

### Objective

Give the business an honest funnel and financial view by channel, campaign, landing page, and salesperson.

### Required date behavior

Every ROI report must state which date controls inclusion:

- lead-created date for acquisition funnel reporting
- outcome date for won revenue/profit reporting
- spend date for marketing cost

Provide a cohort view where leads acquired in a selected period are followed to their eventual outcomes. Without a cohort view, late wins can make recent campaigns appear unprofitable and old campaigns appear unexpectedly profitable.

### Required top-level metrics

- sessions
- confirmed leads
- qualified leads
- estimates scheduled
- quotes delivered
- won projects
- lead conversion rate
- qualified-lead rate
- estimate rate
- quote-to-win rate
- marketing spend
- cost per lead
- cost per qualified lead
- cost per won project
- quoted value
- won revenue
- gross profit
- revenue ROAS
- gross-profit ROI

### Required breakdowns

- first-touch source/medium
- last non-direct source/medium
- campaign ID and name
- landing page
- device
- form versus completed call
- branded versus non-branded organic visibility where Search Console supports it
- salesperson, if assignment is adopted

### Data-quality labels

Display:

- active attribution model
- data freshness timestamp
- percentage of leads with known source
- percentage of won jobs with revenue
- percentage of won jobs with estimated cost
- number of test leads excluded
- number of unresolved export/import errors

Do not display ROI as authoritative when material completeness is missing. For example, if only half of won projects contain job cost, label gross-profit ROI incomplete.

### Example ROI response contract

Recommended endpoint:

```text
GET /api/admin/roi?start=YYYY-MM-DD&end=YYYY-MM-DD&model=first_touch
```

Example shape:

```json
{
  "success": true,
  "range": { "start": "2026-07-01", "end": "2026-07-31" },
  "attributionModel": "first_touch",
  "trafficClass": "production",
  "totals": {
    "spendCents": 500000,
    "leads": 40,
    "qualifiedLeads": 21,
    "wonProjects": 6,
    "wonRevenueCents": 7200000,
    "grossProfitCents": 2700000,
    "costPerLeadCents": 12500,
    "costPerQualifiedLeadCents": 23810,
    "roas": 14.4,
    "roi": 4.4
  },
  "completeness": {
    "knownSourceRate": 0.9,
    "wonRevenueRate": 1,
    "wonCostRate": 0.83
  },
  "channels": [],
  "campaigns": [],
  "freshness": {
    "analyticsAt": "...",
    "outcomesAt": "...",
    "costsAt": "..."
  }
}
```

All ratios must be calculated server-side from integer totals. Test division-by-zero behavior explicitly.

## App Check completion

The initial review found monitor mode enabled but no public App Check site key.

Required sequence:

1. Create/confirm the reCAPTCHA Enterprise App Check web app for both production hostnames.
2. Set `SB_FIREBASE_APPCHECK_SITE_KEY` in Function configuration.
3. Deploy only after explicit authorization.
4. Monitor valid, invalid, and missing token behavior.
5. Confirm legitimate traffic, supported browsers, form submissions, and analytics batches consistently carry valid tokens.
6. Set `APP_CHECK_ENFORCED=true` only after the evidence is clean.
7. Retest the public form and tracker after enforcement.

Never enforce App Check merely because the code supports it. An incorrect key or hostname configuration could silently stop analytics and leads.

## Testing requirements

### Existing commands

Run with Node 22:

```sh
npm run check
npm test
npm run test:emulators
npm run test:browser
```

The complete validation set must pass before requesting deployment.

### Required new unit tests

Add focused tests for:

- new attribution fields and length/control-character sanitization
- UTM normalization
- first-touch persistence and last-non-direct updates
- test-traffic classification
- sales status transitions
- integer-cent parsing and validation
- gross-profit, ROAS, and ROI formulas
- division by zero and incomplete financial data
- loss-reason validation
- outcome-version conflict handling
- call webhook signature and idempotency, if implemented
- cost import idempotency and row errors
- conversion export idempotency and correction behavior

### Required emulator integration tests

- Lead outcome update and audit event are atomic.
- Unauthorized and non-admin outcome updates fail.
- Analytics event retry remains idempotent.
- Test traffic is excluded from default aggregates/reports.
- Raw/summarized reconciliation detects an intentionally pending event.
- Search Console health changes after success/failure.
- Cost upserts do not duplicate spend.
- Won/reversed outcomes generate correct export queue entries.

### Required browser tests

- Tagged landing attribution reaches the contact request.
- Existing navigation works if analytics ingestion is unavailable.
- Admin outcome controls validate and save.
- Version conflicts show a clear refresh/retry message.
- ROI date/model controls call the expected API and render null metrics safely.
- Health panel shows healthy, delayed, and failed states.
- Mobile dashboard remains usable.

### Production smoke test

Run only with approval and a unique test run ID. Verify public routing, one controlled lead, summaries, dashboard, and any enabled call/ad integrations. Report all created test identifiers to the user.

## Deployment and rollout

### Before deployment

- Confirm `git status --short` and intended diff scope.
- Resolve all merge conflicts; never deploy unmerged files.
- Run the full validation set.
- Run `npm run secrets:check` explicitly.
- Document new configuration values and secrets without recording their values.
- Confirm Firestore indexes are deployed before code that depends on them.
- Confirm backward compatibility with existing lead documents.
- Prepare rollback steps.

### Recommended rollout order

1. Firestore indexes/rules if needed.
2. Backend schema/API changes that are backward compatible.
3. Dashboard UI changes.
4. Attribution tracker changes.
5. Health monitoring in observe-only mode.
6. Lead outcome migration/backfill after dry-run review.
7. App Check monitoring, then later enforcement.
8. Cost imports and conversion exports in test/secondary mode.
9. Call tracking after routing validation.

### Rollback

- Keep old readers tolerant of missing new fields.
- Do not delete new data during rollback.
- Disable scheduled exporters/importers with configuration rather than deleting their state.
- Preserve deterministic checkpoints so work can resume safely.
- Keep Cloudflare/D1 rollback instructions in `FIREBASE_ANALYTICS.md` current.

## Account-level dependencies and questions for the user

The AI agent must stop and ask for direction when one of these choices becomes necessary:

1. Which advertising platforms currently have active spend?
2. Which account IDs and campaign naming conventions are authoritative?
3. Does the business define `contacted` as attempted or successful two-way contact?
4. When is a project officially `won`: verbal acceptance, signed contract, deposit, or scheduled installation?
5. Should revenue use contract value, invoiced revenue, or collected cash?
6. What direct costs should be included in gross profit?
7. Who can edit lead financial outcomes?
8. Which call-tracking approach/provider is approved, and what budget is acceptable?
9. Which visible business phone numbers may be dynamically substituted?
10. What call duration/criteria indicate a qualified call?
11. Is GA4/Google Tag Manager already owned by the business, and should it be added as a secondary verification layer?
12. Has the business accepted Google customer-data terms and approved enhanced-conversion matching?
13. What privacy/consent language is currently approved for advertising measurement?
14. Should historical leads be manually classified, imported from another CRM, or left as `new`?

Do not block local schema and emulator work on every account answer. Do block production/provider configuration where the answer changes customer routing, spend, privacy behavior, or business reporting.

## Definition of done

This initiative is complete only when all applicable items below are true:

- A controlled browser journey is visible in raw events, summaries, and the dashboard.
- Duplicate event delivery does not double count.
- Test traffic is excluded by default and inspectable on demand.
- Search Console history is populated and scheduled imports are healthy.
- Dashboard data health and freshness are visible without using a CLI.
- Every lead can be moved through an agreed sales funnel.
- Financial outcome updates are authorized, validated, versioned, and audited.
- First-touch and last-non-direct attribution are stored and reported.
- Controlled campaign links follow a documented UTM standard.
- Completed calls are measured separately from telephone-link clicks, if call tracking is approved.
- Marketing spend is imported idempotently for active paid channels.
- Qualified and won outcomes are exported safely to approved ad platforms.
- Dashboard reports spend, funnel conversion, won revenue, gross profit, ROAS, and ROI.
- Dashboard labels incomplete data and attribution limitations honestly.
- All tests pass under Node 22.
- Production smoke tests pass after deployment.
- Rollback and operational runbooks are current.

## Required agent handoff report

At the end of each implementation phase, the agent must report:

```text
Phase:
Outcome:
Files changed:
Schema/index changes:
Configuration added (names only, never values):
Tests run and results:
Production checks performed:
Production records created/changed:
Known limitations:
Account/user actions still required:
Rollback instructions:
Recommended next phase:
```

Do not use “working” or “complete” without listing the evidence.

## Official references

Use current official documentation before configuring external services because requirements change:

- Google Search Console data behavior and anonymized queries: <https://support.google.com/webmasters/answer/17011259?hl=en>
- Google campaign URL/UTM guidance: <https://support.google.com/analytics/answer/10917952?hl=en>
- Google Ads call-conversion overview: <https://support.google.com/google-ads/answer/6100664?hl=en-GB>
- Google Ads enhanced conversions for leads: <https://support.google.com/google-ads/answer/15713840?hl=en>
- Google Ads enhanced conversions implementation checklist: <https://support.google.com/google-ads/answer/16782203?hl=en>
- Firebase App Check for web: <https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider>
- Firebase Functions and Firestore trigger documentation: <https://firebase.google.com/docs/functions/firestore-events>

For repository-specific deployment, migration, secrets, and rollback instructions, treat `FIREBASE_ANALYTICS.md` as the primary local runbook and update it when the implementation changes.
