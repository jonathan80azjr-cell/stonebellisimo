# Stone Bellisimo — access and authorization intake

Status: **not complete; no external writes are authorized.** Complete this in one owner session. Store credentials only in Firebase Secret Manager or HighLevel's secure integration store; record variable names, never values.

## Exact identities and separate capabilities

| System / capability | Expected identity | Exact ID | Non-destructive proof | State |
|---|---|---|---|---|
| HighLevel location | Stone Bellisimo | `rB7WMB7KbqDC4eLCCfyX` | Authenticated read-only agency list and Business Profile confirmed name, address, phone, and timezone on 2026-08-26 | verified |
| HighLevel private integration | Stone Bellisimo location | Secret name only: `HIGHLEVEL_PRIVATE_TOKEN` | Private Integrations showed `No integrations found` on 2026-08-26; creation and scope grant are external mutations | blocked — verified absent |
| Growth pipeline / workflows / fields | Stone Bellisimo location | Pipeline/field/tag ledgers now present; workflow IDs recorded in client config | UI readback 2026-08-27: W-10/W-7/W-8 are Draft with zero enrolments; W-10 empty after unsaved edits and W-7/W-8 empty shells; no trigger/action live and no sends | blocked — drafts require safe reconstruction before any activation |
| Native GBP account and location | Stone Bellisimo storefront | `accounts.native_gbp_account.id`, `accounts.native_gbp_location.id` | User reported integration on 2026-08-26 after the earlier audit; reread listing/reviews and record IDs | pending post-integration readback |
| Social Planner GBP publishing account | Same verified GBP asset | `accounts.social_planner_gbp_account.id` | User reported GBP integration on 2026-08-26; reread Social Planner/GBP Optimization and record account ID/capabilities | pending post-integration readback |
| Native Instagram account | Stone Bellisimo | `accounts.native_instagram_account.id` | Read connected asset | blocked |
| Social Planner Instagram publishing account | Same verified IG asset | `accounts.social_planner_instagram_account.id` | Social Planner showed `+ Connect` on 2026-08-26 | blocked — verified not connected |
| Instagram messaging capability | Same verified IG asset | `accounts.instagram_messaging_account.id` | Read messaging capability / fixture only | blocked |
| Native Facebook Page | Stone Bellisimo Page | `accounts.native_facebook_page.id` | List pages | blocked |
| Social Planner Facebook publishing account | Same verified FB Page | `accounts.social_planner_facebook_account.id` | Social Planner showed `+ Connect` on 2026-08-26 | blocked — verified not connected |
| Facebook Messenger/comment capability | Same verified FB Page | `accounts.facebook_messaging_page.id` | Read messaging capability / fixture only | blocked |
| Firebase canonical project | Existing dashboard project | `stone-bellisimo-dashboard` | `.firebaserc` plus authenticated read-only `firebase projects:list --json` on 2026-08-26; project ACTIVE, project number `1087968800883` | verified |
| Website estimate form + UTM persistence | Existing website | `https://stonebellisimollc.com/contact-us/#wizard-section` | Read-only production browser fixture retained all controlled UTMs in `window.StoneBellisimoAnalytics.attribution()` on 2026-08-26; no submission | verified |

Publishing, reviews, and messaging are separate grants. Exact account/location IDs must be copied into `client-config.json` only after a readback confirms the public identity. A wrong-account event is a stop condition, not a degraded mode.

## Owner decisions and approvals

| Decision | Required evidence | State |
|---|---|---|
| Storefront/signage name supports any GBP `LLC` addition | Photograph or owner confirmation; do not rename without it | blocked |
| Website truth (only) | Website, office phone, address, weekday hours, directions URL, estimate-form anchor | verified from `public/contact-us/index.html:10-18,225,232-237,250,259-395` and public retrieval on 2026-08-26; GBP/IG/FB reconciliation remains blocked |
| HighLevel business website consistency | HighLevel currently contains `http://www.stonebellisimollc.com/`; canonical is `https://stonebellisimollc.com` | blocked pending authorized `profile_update`; recorded as a change-sheet item, not silently changed |
| Cesar direct number retained only as sales handoff | Confirm no listing/caption phone stuffing | pending |
| Approved consent wording/version | Verbatim approved text and version | blocked |
| Approved public acknowledgement, DM, review request/replies, offers | Verbatim text/version; no pricing or availability promises | blocked |
| Jensy/Jonathan enabled HighLevel user IDs | Readback proves each is enabled | blocked |
| Cesar enabled HighLevel user ID | Readback proves assignment target | blocked |
| Authorization envelope | Signer, permitted actions, test/dry-run evidence, rollback owner | blocked |

## Authorization envelope — mandatory before a write

1. `signed == true` in client config.
2. Requested action is enumerated in `permitted_actions`.
3. Target exact ID equals the client-config ID.
4. Action-specific dry run is recorded.
5. Change sheet exists with before-value, stop condition, rollback, and irreversible effects.

Until all five pass, allowed work is read-only configuration design and local test fixtures only.

## Per-action authorization record

`authorization_envelope.action_authorizations.<action>` must contain `dry_run_at` (ISO), `dry_run_evidence_reference`, `change_sheet_reference`, and `exact_target_ids`. The only allowed actions are `profile_update`, `draft_workflows`, `create_in_review_post`, `schedule_approved_post`, `draft_review_reply`, and `send_review_request`. Each is allowed only when it is also in both `permitted_actions` and `live_write_action_scope`.

| Action | Exact configured target IDs required |
|---|---|
| profile_update | HighLevel location, native GBP location |
| draft_workflows | HighLevel location |
| create_in_review_post / schedule_approved_post | all three Social Planner channel accounts |
| draft_review_reply | HighLevel location, native GBP location |
| send_review_request | HighLevel location, Firebase project |

## Foreseeable preflight defects

| Date | Missing decision/access | Blocks | Repair / intake update | Owner | Status |
|---|---|---|---|---|---|
| 2026-08-25 | Exact GBP/IG/FB IDs and channel connections | channel-specific builds and event acceptance | HighLevel location and Firebase project are verified; connect each channel, then read back every native and Social Planner ID | Jensy/Jonathan | open |
| 2026-08-26 | HighLevel business website uses the old HTTP/www form | profile consistency | After signed `profile_update` authorization, change to `https://stonebellisimollc.com`, read back, and record rollback evidence | Jensy/Jonathan | open |
| 2026-08-26 | No HighLevel private integration exists | API publishing, field/pipeline provisioning, and reconciliation | After signed action scope, create a narrowly scoped private integration; store the token only as `HIGHLEVEL_PRIVATE_TOKEN` in the approved secret store | Jensy/Jonathan | open |
| 2026-08-25 | Approved consent/review/DM/comment copy and versions | any customer-facing draft or retention | Approve in one owner session | Jensy/Jonathan | open |
| 2026-08-25 | Signed, narrow live-write envelope | every external mutation | Sign after review of build/test/rollback sheets | Jensy/Jonathan | open |
