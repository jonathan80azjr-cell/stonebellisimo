# Stone Bellisimo — baseline and 90-day measurement sheet

## Baseline freeze

Freeze screenshots/exports before changes, dated and access-controlled: GBP rating `4.9`, review count `132`, unreplied-review count, GBP calls/website/directions/actions; IG followers `393` and last visible post `2025-06-06`; FB followers `144` and last visible post `2024-06-20`; profile phone differences. These are starting observations, not conversion proof.

Manually classify every prior-90-day Firebase lead. Preserve `businessStatus`; do not map `in_progress` to qualified. Review existing `completed` records manually before mapping to Job Completed or Invoice Collected.

## Metric table

| Metric | Baseline numerator / denominator | Day-90 result | Rule |
|---|---|---|---|
| Qualified estimate requests | staff-confirmed qualified requests / prior 90 days |  | Target ≥20% growth; a form, comment, DM, or automated reply alone never qualifies |
| Qualification rate | qualified / all new leads |  | Report spam/unqualified change alongside growth |
| Source/content coverage | qualified with source + content ID / qualified |  | Target ≥90% |
| Staffed-hours claim SLA | claimed ≤30m / staffed-hours inquiries |  | Target ≥95%; automated acknowledgement is separate |
| Publishing completion | approved posts published / planned posts |  | Target ≥90% |
| New review handling | drafted ≤1 business hour and approved/replied ≤1 business day / new reviews |  | Target 100% |
| Review backlog coverage | approved replies / backlog, segmented 1–3 then positive |  | Report, no false completion |
| GBP actions | calls, website clicks, directions |  | Aggregate actions only; calls do not equal qualified/completed |
| Social-assisted conversions | staff-confirmed qualified with eligible social assist |  | Separate from direct and untracked |
| Duplicate rate | duplicate posts, contacts, opportunities, review requests / total |  | Target zero |

## Attribution and UTM audit

For each controlled link, record source, medium, campaign, content, landing URL, form receipt, Firebase lead ID, and HighLevel mirror ID. Values must retain: `google|instagram|facebook`; `organic_local|organic_social`; `sb_organic_YYYYMM`; `<content-id>-<placement>`. Reconcile Firebase as canonical; HighLevel is an operational mirror. Calls stay aggregate until staff creates or matches a lead.

Report Day 90 as `DONE == false` unless all acceptance thresholds have evidence. Do not claim causal revenue or a posted review from a click.
