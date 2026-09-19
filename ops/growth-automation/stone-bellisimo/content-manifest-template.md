# Stone Bellisimo — monthly content intake and manifest

Admin-only Firebase dashboard intake; files live in Firebase Storage and metadata in `social_content`. No generated project imagery, unlicensed customer work, missing privacy clearance, or expired offer may advance.

## Required batch

At least 18 usable project photos and 6 vertical clips, across 4 projects where possible. Per asset capture: asset/storage ID, project ID, material, project type, city only, rights approval, privacy clearance, pillar, offer expiration (or null), uploader, timestamps, prior-post check, and source hash. No street address or customer message body.

State machine (no skipped transition): `discovered → needs_review → approved → optimized → uploaded → scheduled → published`. `approved` requires rights + privacy + owner approval; `needs_review` cannot advance while `previously_posted` is unknown; offers require a current explicit approval.

## 12 monthly packages

| Count | Pillar | Required channel adaptations |
|---:|---|---|
| 4 | project reveal / before-and-after | IG, FB, GBP adapted package |
| 3 | fabrication or installation process | IG includes Reel where selected; FB video/Reel |
| 2 | material education | channel-specific caption/media |
| 2 | local service area or FAQ | city only; no unsupported availability/price |
| 1 | testimonial or currently approved offer | proof/expiration retained; offers block on expiry |

Cadence: IG three/week (≥1 Reel); FB three/week (≥1 video/Reel); GBP two/week. Use HighLevel Best Time only after enough history; otherwise IG/FB Tue/Thu/Sat noon ET and GBP Tue/Fri 10 AM ET. Every post begins `in_review`; a human approves before scheduling.

## Publish record template

| content_id | channel | asset_ids | caption_version | tracked_url | state | approval_by/at | scheduled_at_ET | remote_account_id | remote_post_id | idempotency_key | remote_readback | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `REQUIRED_UNSET` | `instagram|facebook|google` | `REQUIRED_UNSET` | `REQUIRED_UNSET` | `REQUIRED_UNSET` | discovered | `REQUIRED_UNSET` | `REQUIRED_UNSET` | `REQUIRED_UNSET` | `REQUIRED_UNSET` | `REQUIRED_UNSET` | `REQUIRED_UNSET` | |

Controlled links use `utm_source=google|instagram|facebook`, `utm_medium=organic_local|organic_social`, `utm_campaign=sb_organic_YYYYMM`, `utm_content=<content-id>-<placement>`. Before create, reconcile both local ledger and remote posts. Any HTTP write response makes the write uncertain; do not create again until readback proves absence.
