# Stone Bellisimo — launch, operations, and rollback runbook

This is a human-approved pilot, not autopilot. Posts and review replies require Jensy or Jonathan approval for all 90 days. Either may act independently for approvals, privacy incidents, kill switches, or native post removal.

## Release sequence

| Phase | Scope | Gate |
|---|---|---|
| Days 0–5 | Freeze GBP/social/lead baselines; reconcile truth; classify prior 90-day leads; sign envelope | exact IDs/read-only capability proofs, baseline retained |
| Days 6–14 | GBP optimization, monthly batch, W-10/W-7 drafts, review-backlog drafts, bridge fixture | required copy/IDs, structural tests |
| Weeks 3–4 | one approved test post/channel; opt-out/kill-switch and staff fixture tests | evidence passes; wrong-account events rejected |
| 14-day reviewed pilot | approved social/GBP cadence and human queue | daily health review; no stop incident |
| Days 31–90 | full reviewed cadence | health daily, business metrics weekly |
| Day 90 | compare against manual baseline | owners separately decide any future autopilot |

## Daily operations

- New reviews: draft in one business hour; approve/reply in one business day. Process 1–3-star backlog first, then newest-first positive backlog.
- Inquiries: send both owners an immediate alert; 15 minutes = internal reminder; 30 minutes = SLA breach + overdue task. Claim stops remaining escalations. Staff-only qualification assigns Cesar after fit, area, intent, usable contact method, and consent.
- Review requests: Firebase-confirmed `Job Completed` only; identical honest request after 3 days; one reminder at +7 days only if neither clicked nor answered. Never gate by private rating, incentivize, or infer review completion.
- Check `automation_health`: connections, publishing/readback, webhook freshness, review freshness, and SLA freshness.

## Kill switches and incidents

| Level | Action | Owner / verification |
|---|---|---|
| L1 | Pause all outbound replies and publishing; keep W-10 active | Jensy or Jonathan; verify no new sends/posts |
| L2 | Disable drafting/AI assistance; retain human routing | Jensy or Jonathan; verify routing remains |
| L3 | Disconnect affected platform | Jensy or Jonathan; record exact asset and reconnection owner |
| L4 | Suppress one contact immediately | Jensy or Jonathan; add opt-out/DND; retain original opt-out timestamp |

Immediate L1 + owner incident review: opted-out send, privacy concern, unapproved price/availability/offer copy, urgent escalation miss, duplicate contact/opportunity/review request/post. Wrong account/page/location: L3. Remove a published post natively by Jensy or Jonathan if API deletion cannot retract it; a sent message cannot be recalled.

Rollback: revert workflow to Draft and explicitly drain enrolments; deprecate rather than delete populated fields; move opportunities before retiring a stage; keep prior draft/copy version. Every live change needs a change sheet before execution and an append-only log afterward; record before-state and irreversible effects.
