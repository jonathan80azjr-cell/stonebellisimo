# Change sheet — W-10, W-7, W-8 inactive draft creation

Status: **post-hoc reconciliation record.** UI readback on 2026-08-27 identifies the three Draft/zero-enrolment workflows; no trigger/action is live and no sends occurred. W-10's prior UI edits did not persist, leaving an empty graph; W-7/W-8 are empty shells. Editor instability blocked safe reconstruction. Authorization/implementer evidence was not captured in this sheet and is recorded as a change-control defect in the append-only log.

| Field | Entry |
|---|---|
| Change ID / date | `SB-2026-08-26-HL-INACTIVE-WORKFLOW-DRAFTS` / 2026-08-26 |
| Narrowest proposed mutation | `draft_workflows`: save only the three named, disconnected workflows as Draft with zero enrolments. No W-1/W-2/W-3, Meta asset, GBP publishing/review connection, profile update, trigger, send, reply, or activation. |
| Exact HighLevel target | `rB7WMB7KbqDC4eLCCfyX` |
| In scope | `W-10 · All · Consent / Opt-out Guardrail`; `W-7 · All · Staff Escalation`; `W-8 · Firebase · Outcome Reconciliation` |
| Required state | Draft; zero enrolments; no live account/page trigger; no enabled customer-facing action; W-8 report-only |
| Before value | Earlier read-only audit found the empty workflow state; the immediate pre-mutation snapshot was not captured. |
| Guardrails | W-10 reads opt-out status before any write and never clears DND. W-7 has no assignment target until Jensy/Jonathan enabled user IDs are read back. W-8 may not advance any outcome stage until Firebase reconciliation evidence/authorization exists. |
| Stop conditions | Target mismatch; missing field ledger; missing owner envelope; missing staff IDs; invalid/missing HMAC path; any non-Draft state or active enrolment. |
| Rollback | Keep as Draft; if any enrolment exists, explicitly drain/remove it before archival. |
| Irreversible effects | None expected from unconnected zero-enrolment drafts. Publication or any send is a separate change with separate rollback limits. |
| Post-change evidence | UI readback: W-10 `13013c62-20f3-410e-b22f-b11c1bb37069`; W-7 `e68fc50d-534c-42b4-85af-196f667ceaa0`; W-8 `413a9700-5d79-4c97-aced-58532027feeb`. All Draft with zero total/active enrolments; empty graph/shell state described above. |

GBP is reported integrated but its post-integration IDs/capabilities have not been reread. Meta is still pending. Neither condition permits a connection, trigger, or send in these drafts.

## Gated execution order

This mutation can follow foundation readback only: (1) confirm the field/pipeline ledgers exist; (2) take a fresh workflow-list snapshot; (3) create W-10; (4) create W-7; (5) create W-8 report-only; (6) reread every graph and verify Draft/zero enrolments. A failure at any step stops later steps.

## Remaining blockers

| Technical prerequisites | Owner / authorization blockers |
|---|---|
| Field and pipeline ledgers; fresh workflow list; W-8 HMAC secret/configuration and Firebase event-path fixture; enabled HighLevel user IDs before any real W-7 assignment; graph-level verification | Jensy or Jonathan signature; `draft_workflows` in permitted actions/live-write scope; dated dry-run evidence; rollback owner/rules; approved consent/opt-out and escalation copy before publication |

GBP publishing/reviews are restricted to read-only discovery until its reported integration is reread. Meta is excluded entirely.
