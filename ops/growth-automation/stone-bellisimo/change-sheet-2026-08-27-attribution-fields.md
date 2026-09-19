# SB-20260826-ATTRIBUTION — GBP and website lead attribution

Status: **applied 2026-08-27; readback verified. Owner countersignature still pending.**

| Field | Entry |
|---|---|
| Change ID / date / implementer | `SB-20260826-ATTRIBUTION` / 2026-08-27 / Claude Code session, operator-directed |
| Authorized action and envelope reference | Foundation provisioning of custom fields and tags. Directed by the operator in-session; this is the same class of change as `SB-20260826-FOUNDATION-POSTHOC`. It is **not** a customer-facing action and does not draw on `permitted_actions`, which remains empty. |
| Exact target / verification | HighLevel location `rB7WMB7KbqDC4eLCCfyX`; verified against the pinned location constant before every request |
| Before value | 18 custom fields, 6 tags. No field could record which channel produced a lead. |
| Proposed value | 27 custom fields, 10 tags. Nine attribution fields plus four credit tags. |
| Reason | The pipeline could show that a lead arrived but not which channel produced it, so managed-channel performance was unprovable. Without these fields there is no defensible answer to "did this lead come from the work we are paying for". |
| Expected effect | Every lead reaching HighLevel carries a source platform, first- and last-touch channel, campaign, placement, confidence, and a managed/unmanaged verdict. |
| Risk / blast radius | Location custom fields and tags only. Purely additive — no contact, opportunity, or pipeline data was read or modified. |
| Guardrails / dry run | Dry run executed first and showed all nine fields absent with no name collisions. The provisioner refuses to update an existing field and halts on any collision or readback mismatch. |
| Rollback | Fields can be hidden from the contact view. HighLevel field keys are not safely deletable once populated, so removal is not a clean rollback — this is why the dry run gated the write. |
| Irreversible effects | Field keys persist once created. No customer-visible effect. |
| Post-change readback | Verified. `field-ledger.json` readback `2026-08-27T02:12:54.701Z` shows 27 fields; all ten keys the code writes are present and every channel value is storable. Guarded by two tests in `tests/growth-attribution.test.mjs`. |
| Owner approval | Pending Jensy or Jonathan countersignature. |

## Objects created

Tags: `bs:managed-credit`, `bs:channel:gbp`, `bs:channel:instagram`, `bs:channel:facebook`.

| Creation name | Derived key | Type |
|---|---|---|
| BS Source Platform | `contact.bs_source_platform` | single option |
| BS Source Content ID | `contact.bs_source_content_id` | text |
| BS Source Campaign | `contact.bs_source_campaign` | text |
| BS Attribution Confidence | `contact.bs_attribution_confidence` | single option |
| BS Managed Credit | `contact.bs_managed_credit` | single option |
| BS First Touch At | `contact.bs_first_touch_at` | date |
| BS First Touch Source | `contact.bs_first_touch_source` | single option |
| BS Last Touch At | `contact.bs_last_touch_at` | date |
| BS Last Touch Source | `contact.bs_last_touch_source` | single option |

## In-session correction

The three channel option lists were first created with a single `social` value. That collapsed Instagram and Facebook, which `growth-store.mjs` and the publishing schedule treat as distinct channels, and it broke an existing test. The lists were widened to the corrected seven-channel vocabulary and read back before any contact data existed. The stale `bs:channel:social` tag remains in the location, unused and unreferenced by any code path; it is harmless and was left rather than deleted.

## Attribution rules this encodes

Only a link we tagged earns managed credit. An untagged visit from Google Maps is recorded as profile traffic with `confidence: inferred` and `managed: false`, because a Maps click and an ordinary search click arrive with the same referrer and cannot be separated after the fact. A tagged link whose campaign does not match `sb_organic_YYYYMM` is reported as a build defect rather than quietly upgraded to credit.

First touch wins. The profile click that introduced the customer earns the lead even when they return days later and submit directly. Where only the later visit is tagged, credit is still granted but recorded as `last_touch_only` so the weaker basis stays visible.
