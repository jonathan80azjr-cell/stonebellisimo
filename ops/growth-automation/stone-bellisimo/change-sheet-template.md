# Stone Bellisimo — change sheet

Status: draft. A completed sheet plus append-only log row is required before any authorized mutation.

| Field | Required entry |
|---|---|
| Change ID / date / implementer | `REQUIRED_UNSET` |
| Authorized action and envelope reference | One allowed action; exact signed authorization reference |
| Exact target IDs / verified evidence | `REQUIRED_UNSET` |
| Before value / capture reference | `REQUIRED_UNSET` — `unknown` is not allowed |
| Change and reason | `REQUIRED_UNSET` |
| Expected effect / measurement window | `REQUIRED_UNSET` |
| Risk / blast radius / stop condition | `REQUIRED_UNSET` |
| Guardrails / test fixture / dry-run evidence | `REQUIRED_UNSET` |
| Rollback steps / tested evidence | `REQUIRED_UNSET` |
| Irreversible effects | `REQUIRED_UNSET` — `none` is acceptable only when true |
| Post-change readback / owner approval | `REQUIRED_UNSET` |

Never use this file to store credentials, messages, customer data, or screenshots containing them.
