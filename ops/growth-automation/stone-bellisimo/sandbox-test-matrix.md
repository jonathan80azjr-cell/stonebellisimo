# Stone Bellisimo — scoped sandbox test matrix

All fixtures use exact verified sandbox/test assets and the `bs:test` tag. No real customer, post, message, review request, or live workflow enrolment is allowed. Record evidence reference, observed payload/readback, and pass/fail for every case.

| ID | Scope | Fixture / assertion | Expected result |
|---|---|---|---|
| T-01 | W-10 | First opt-out then identical repeat opt-out | DND + `bs:optout`; original timestamp/channel/source unchanged; no cross-channel follow-up |
| T-02 | W-10 | Platform unsubscribe/block signal | Same suppression; at most one in-window confirmation |
| T-03 | W-7 | Standard inquiry, no claim at 15 then 30 minutes | Jensy + Jonathan alerted; reminder at 15; breach and overdue task at 30 |
| T-04 | W-7 | Jensy claims before 15 minutes | Jonathan saw immediate alert; later reminder/breach stop; claim owner recorded |
| T-05 | W-1 | IG estimate-intent comment on exact configured account | Guard/urgent/window/dedupe precede response; approved acknowledgement and permitted DM only |
| T-06 | W-1 | Same event from wrong IG account or duplicate delivery | No inquiry/contact/opportunity/write; audit rejection recorded |
| T-07 | W-2 | IG DM: material/city/timeframe then consent decline | Answer/routing allowed; no external phone/email retained or follow-up scheduled |
| T-08 | W-2 | IG DM requests price, full address, or availability | No quote/promise/address request; staff escalation/approved form route |
| T-09 | W-3 | FB complaint/public PII/after-hours inquiry | Immediate human route; no public PII; internal alerts immediate; customer outbound obeys quiet-hours/window rules |
| T-10 | W-3 | Expired Meta window | No outbound; `bs:window-expired`; human task |
| T-11 | W-8 | Replay identical HMAC-valid HighLevel event | One canonical social inquiry/contact/opportunity only; event idempotency retained |
| T-12 | W-8 | Wrong account ID, invalid HMAC, or stale replay | Reject without Firestore/HighLevel mutation |
| T-13 | W-8 | `in_progress` historical lead and existing `completed` record | No inferred qualification; completed mapping held for staff review |
| T-14 | Publishing | Same job twice / remote post already matches | One post maximum; local + remote reconciliation evidence |
| T-15 | Publishing | HTTP response on create with unknown outcome | Mark uncertain write; no second create until remote read proves absence |
| T-16 | Reputation | Job Completed event versus all other stages | Only completed enters +3-day request; one +7-day reminder if neither click nor answer |
| T-17 | Reputation | Low private feedback / no click | Same honest Google request eligibility; no incentive/diversion; click never equals review |
| T-18 | Kill switches | Exercise L1, L2, L3, L4 | L1 preserves W-10; L2 preserves human routing; L3 isolates asset; L4 immediate suppression |
| T-19 | Attribution | GBP/IG/FB controlled link through form | UTM source/medium/campaign/content persist into Firebase and HighLevel mirror |

Release gate: all in-scope cases pass with non-secret evidence; independently review workflow graph order and account identity. Failure is a stop condition, not a waiver.
