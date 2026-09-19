# Stone Bellisimo — build sheets (draft only)

## Pipeline and tags

Live readback: `Stone Bellisimo Growth Outcomes` exists as pipeline `hrvoCFYthFHT08tNPtfZ`; its stage IDs are in [pipeline-ledger.json](pipeline-ledger.json). The expected sequence is `New Lead` → `Qualified` → `Estimate Scheduled` → `Job Completed` → `Invoice Collected` → `Repeat / Review` → `Lost`. The live ledger shows funnel enabled for stages 1–6 and disabled for Lost, but pie-chart flags are currently false for every stage and default stage probabilities remain populated. This does **not** satisfy the intended funnel/pie/probability settings; correct only under a separately authorized profile/pipeline change.

Live readback (2026-08-27): ten tags exist in [tag-ledger.json](tag-ledger.json). The six original tags plus `bs:managed-credit`, `bs:channel:gbp`, `bs:channel:instagram`, and `bs:channel:facebook`, which mark leads a tagged link produced. `bs:channel:social` also exists from an in-session correction and is unused by any code path.

Superseded note: six tags exist in [tag-ledger.json](tag-ledger.json): `bs:client:sb`, `bs:program:sb-growth-v1`, `bs:optout`, `bs:escalated`, `bs:urgent-language`, and `bs:test`. All other design tags remain uncreated and are not implied by the plan.

## Field contract

The authoritative, provisionable table is [field-contract.csv](field-contract.csv). It gives every relevant field its creation name, expected derived key, type, object, populated-by, sensitivity, ad-platform-export, retention, write mode, options, and notes. The summary below is navigational only; never bind a workflow from expected keys until authorized post-create readback produces the live field ledger.

Create fields with the exact names below; HighLevel derives keys. Every generated key must be reread into the ledger before a workflow binds it.

| Creation name | Expected key | Type | Write mode | Sensitivity / export | Owner |
|---|---|---|---|---|---|
| BS Managed Client | `contact.bs_managed_client` | text | once | none / no | all flows |
| BS Managed Program | `contact.bs_managed_program` | single option | once | none / no | all flows |
| BS Source Platform | `contact.bs_source_platform` | single option | once | none / no | intake |
| BS Source Account | `contact.bs_source_account` | text | once | identifier / no | intake |
| BS Source Post ID | `contact.bs_source_post_id` | text | once | none / no | intake |
| BS Source Content ID | `contact.bs_source_content_id` | text | once | none / no | intake |
| BS First Touch At | `contact.bs_first_touch_at` | date | once | none / no | intake |
| BS First Touch Source | `contact.bs_first_touch_source` | text | once | none / no | intake |
| BS Last Touch At | `contact.bs_last_touch_at` | date | overwrite | none / no | intake |
| BS Last Touch Source | `contact.bs_last_touch_source` | text | overwrite | none / no | intake |
| BS Consent Status | `contact.bs_consent_status` | single option | overwrite | none / no | consent |
| BS Consent At | `contact.bs_consent_at` | date | overwrite | none / no | consent |
| BS Consent Channel | `contact.bs_consent_channel` | text | overwrite | none / no | consent |
| BS Consent Text Version | `contact.bs_consent_text_version` | text | overwrite | none / no | consent |
| BS Optout Status | `contact.bs_optout_status` | single option | overwrite | none / no | W-10 |
| BS Optout At | `contact.bs_optout_at` | date | once | none / no | W-10 |
| BS Optout Channel | `contact.bs_optout_channel` | text | once | none / no | W-10 |
| BS Optout Source | `contact.bs_optout_source` | single option | once | none / no | W-10 |
| BS Intent | `contact.bs_intent` | single option | overwrite | none / no | routing |
| BS Intent Captured At | `contact.bs_intent_captured_at` | date | overwrite | none / no | routing |
| BS Escalation Reason | `contact.bs_escalation_reason` | single option | overwrite | none / no | W-7 |
| BS Escalated At | `contact.bs_escalated_at` | date | overwrite | none / no | W-7 |
| BS Assigned User | `contact.bs_assigned_user` | text | overwrite | none / no | W-7 |
| BS Staff Response At | `contact.bs_staff_response_at` | date | once | none / no | staff |
| BS Messaging Window Status | `contact.bs_messaging_window_status` | single option | overwrite | none / no | routing |
| BS Dedupe Match Method | `contact.bs_dedupe_match_method` | single option | overwrite | none / no | intake |
| BS HighLevel Contact ID | `contact.bs_highlevel_contact_id` | text | overwrite | identifier / no | bridge |
| BS Firebase Lead ID | `contact.bs_firebase_lead_id` | text | once | identifier / no | bridge |
| BS Outcome Version | `contact.bs_outcome_version` | text | overwrite | none / no | reconciliation |
| BS Opportunity ID | `opportunity.bs_opportunity_id` | text | once | identifier / no | reconciliation |
| BS Estimate Scheduled At | `opportunity.bs_estimate_scheduled_at` | date | overwrite | none / no | reconciliation |
| BS Job Completed At | `opportunity.bs_job_completed_at` | date | overwrite | none / no | reconciliation |
| BS Invoice Collected At | `opportunity.bs_invoice_collected_at` | date | overwrite | none / no | reconciliation |
| BS Review Requested At | `opportunity.bs_review_requested_at` | date | overwrite | none / no | reputation |

Do not create free-text message-body, full street-address, price, or promise fields. Live readback has now produced [field-ledger.json](field-ledger.json) with 27 created fields — the original 18 plus the nine attribution fields listed in [change-sheet-2026-08-27-attribution-fields.md](change-sheet-2026-08-27-attribution-fields.md). `BS First Touch Source` and `BS Last Touch Source` were created as single-option rather than the text type this table originally specified, so the channel vocabulary is filterable in HighLevel smart lists; `tests/growth-attribution.test.mjs` asserts every channel the resolver emits is storable. The field, pipeline, and tag ledgers — not the expected keys in this design table — are binding authority. The remaining field-contract rows are uncreated unless they appear in the ledger.

## Workflow build order and gates

UI readback on 2026-08-27: `W-10 · All · Consent / Opt-out Guardrail` (`13013c62-20f3-410e-b22f-b11c1bb37069`), `W-7 · All · Staff Escalation` (`e68fc50d-534c-42b4-85af-196f667ceaa0`), and `W-8 · Firebase · Outcome Reconciliation` (`413a9700-5d79-4c97-aced-58532027feeb`) are all Draft with 0 total and 0 active enrolled. No trigger/action is live and no sends occurred. W-10's graph is empty because prior UI edits were unsaved and did not persist; W-7 and W-8 are empty shells. Editor instability blocked safe reconstruction. HighLevel is readback-verified; GBP Social Planner is connected (publishing connection only); Meta is pending. None of this grants activation or customer-facing authority.

| Order | Draft workflow | Required behavior before next workflow | Blockers |
|---|---|---|---|
| 1 | W-10 · All · Consent / Opt-out Guardrail | read opt-out before write; DND all channels; preserve first timestamp; no clear branch | field ledger |
| 2 | W-7 · All · Staff Escalation | notify Jensy+Jonathan; 15m reminder; 30m breach/task; first claim stops escalation | enabled IDs, approved escalation copy |
| 3 | W-1 · IG · Comment to DM | guard → urgent → 24h window → dedupe → first touch; no price/address collection | IG messaging authorization |
| 4 | W-2 · IG · Inbound DM Routing | classify; consent before external contact retention; qualified only after staff confirmation | IG messaging authorization/copy |
| 5 | W-3 · FB · Comment / Messenger | same IG safety ordering and exact-page protection | FB messaging authorization |
| 6 | W-8 · Firebase · Outcome Reconciliation | report-only first; HMAC/idempotent events; only Firebase-confirmed outcomes advance stages | Firebase route/HMAC variable |

All workflows remain Draft with zero enrolments through the reviewed 90-day pilot except individually released stages after their test suite. W-10 remains active through L1; if W-7 pauses, W-1/W-2/W-3 pause too.
