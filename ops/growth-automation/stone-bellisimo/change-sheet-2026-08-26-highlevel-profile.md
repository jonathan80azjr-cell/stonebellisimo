# SB-20260826-01 — HighLevel profile consistency

Status: **draft; no mutation authorized or performed.**

| Field | Entry |
|---|---|
| Change ID / date / implementer | `SB-20260826-01` / 2026-08-26 / pending authorized implementer |
| Authorized action and envelope reference | `profile_update`; signed envelope reference pending |
| Exact target / verification | HighLevel location `rB7WMB7KbqDC4eLCCfyX`; authenticated read-only agency list and Business Profile readback on 2026-08-26 |
| Before value | Business website: `http://www.stonebellisimollc.com/` |
| Proposed value | Business website: `https://stonebellisimollc.com` |
| Reason | Match the live canonical website and avoid an unnecessary HTTP/www hop in profile data |
| Expected effect | 100% website-field consistency between HighLevel and the canonical website after readback |
| Risk / blast radius | Location profile only. Stop if the target ID, business name, address, or phone differs from the verified values immediately before the write. |
| Guardrails / dry run | Preflight must pass for `profile_update`; signed owner scope, read-only before capture, and exact-target check are still pending. |
| Rollback | Restore `http://www.stonebellisimollc.com/` only if the approved HTTPS URL fails readback or HighLevel validation. Re-read the same location after rollback. |
| Irreversible effects | None expected for this field update; audit history may remain. |
| Post-change readback | Pending. Must show `https://stonebellisimollc.com` on location `rB7WMB7KbqDC4eLCCfyX`. |
| Owner approval | Pending Jensy or Jonathan. |

Do not execute this sheet until the authorization envelope explicitly permits `profile_update` and identifies this exact target.
