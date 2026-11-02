# Legal review checklist: AI calls, texts, privacy, and terms

> **This is not legal advice.** It is a working checklist prepared for Stone Bellisimo LLC and its New Jersey attorney. The Privacy Policy (`public/privacy/index.html`) and Terms of Use (`public/terms/index.html`) are **drafts pending attorney review**. Nothing in this repo has been determined to comply with any law. Every statement of law below is an item for counsel to confirm, not a conclusion.

Prepared November 1, 2026. Related: [HIGH_SPEED_TO_LEAD.md](./HIGH_SPEED_TO_LEAD.md) (call/text flow and launch gates), [POSTMARK_AUTOMATION.md](./POSTMARK_AUTOMATION.md) (email).

## (a) What is in place in code

| Control | Where | Notes |
| --- | --- | --- |
| Separate, unchecked consent checkbox per channel (AI call; text) shown only for the chosen follow-up option | `public/index.html`, `public/contact-us/index.html`; server check in `src/lead-automation.mjs` `validateContact` | Server rejects a call/text preference without the matching consent. Email-only needs no phone consent. |
| Versioned consent copy | `AI_CALL_CONSENT_VERSION = 'ai_call_transcript_v1'`, `SMS_CONSENT_VERSION = 'sms_inquiry_v1'` in `src/lead-automation.mjs` | The exact consent text shown is stored on the lead (`aiCallConsentText`, `smsConsentText`). |
| Consent records | `createLeadPayload` / `prepareLead` in `src/lead-automation.mjs` | Consent version, consent text, timestamp (`aiCallConsentRecordedAt`, `smsConsentRecordedAt`), salted SHA-256 hash of the IP address, browser user agent, browser time zone. |
| AI disclosure at the start of every call | `AI_CALL_DISCLOSURE` in `src/twilio-automation.mjs` | Spoken by Twilio text-to-speech before the AI connects, so it does not depend on the AI model. The assistant ("Bella") is also instructed to identify itself as AI and never imply it is human (`voice-agent/server.mjs`). |
| 9 a.m.–8 p.m. local calling window | `CALL_WINDOW_START_MINUTE` / `CALL_WINDOW_END_MINUTE` in `src/twilio-automation.mjs` | Uses the time zone submitted with the lead. Calls due outside the window are deferred to the next window. |
| Transfer to a human only on request | `voice-agent/server.mjs` (`transfer_to_team`) | Transfers only after the caller clearly asks and confirms. |
| One automated attempt per request; no retry on uncertain sends | `src/twilio-automation.mjs` | An uncertain Twilio API result is marked `uncertain` and not retried, to avoid duplicate calls/texts. |
| STOP handling for texts | `handleTwilioInboundSms` in `src/twilio-automation.mjs` | STOP, STOP ALL, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, and OPT OUT set `smsConsent: false` and `smsOptedOutAt` on every recent lead with that phone number (latest 200 leads searched); Twilio's own keyword handling also blocks further texts from that number. |
| Twilio webhook signature checks | `verifyTwilioSignature` in `src/twilio-automation.mjs`; stream signature check in `voice-agent/` | Unsigned or mis-signed requests are rejected (403). |
| No audio recording saved | `src/twilio-automation.mjs` call parameters | Calls are not created with a Twilio recording option; only a text transcript is stored (`aiCallTranscript`). |
| Fail-closed launch | `AI_CALLING_ENABLED`, `SMS_FOLLOWUP_ENABLED`, `*_CONSENT_APPROVED_VERSION` | Nothing is sent until the channel is enabled **and** the approved-version variable matches the code's consent version. |
| Public Privacy Policy and Terms | `public/privacy/`, `public/terms/`, linked from the consent text and site footers; listed in `public/sitemap.xml` | Drafts. Terms quote the exact consent wording, first-text wording, and spoken disclosure. |

## (b) Items that need the attorney's approval

1. **Exact consent copy.** Approve or revise both checkbox texts (quoted verbatim in the Terms), the first automated text, and the spoken disclosure. Any change to the wording must bump the consent version in `src/lead-automation.mjs` and the Terms.
2. **Privacy Policy and Terms of Use.** Review both drafts in full. Specific points to confirm:
   - Whether the New Jersey Truth-in-Consumer Contract, Warranty and Notice Act (TCCWNA) affects the disclaimer, limitation-of-liability, and governing-law sections. The drafts avoid "void where prohibited" phrasing and arbitration/class-waiver terms; counsel decides whether to add any dispute-resolution terms.
   - Whether the New Jersey Data Privacy Act or other state privacy laws (NY, CT, MA, PA, CA) apply to the business, given their thresholds, and whether the policy needs state-specific rights language. The draft only says additional rights may apply depending on where the person lives.
   - Whether the draft's "does not respond to Do Not Track" statement and the analytics/cookie disclosures are adequate, including whether Global Privacy Control should be honored.
   - The general retention statement (see item 7).
3. **Are AI calls "telemarketing," and what consent level is needed?** Confirm whether an AI call about the customer's own estimate request is informational or telemarketing/solicitation under the TCPA and state law, and therefore whether *prior express consent* or *prior express written consent* (with E-SIGN-compliant signature and specific disclosures) is required. To confirm: the FCC's February 2024 Declaratory Ruling treated AI-generated voices as "artificial" voice under the TCPA, which would make these artificial-voice calls. Confirm whether the checkbox plus stored record satisfies the applicable standard, including for calls to wireless numbers and to numbers on the National or state Do-Not-Call lists. Also confirm whether any FCC AI-call disclosure rules proposed since 2024 have taken effect.
4. **Call recording/transcription consent in all-party-consent states.** The business serves NJ, NY, CT, MA, and the site also has a Pennsylvania service-area page. Confirm whether real-time AI processing and transcription of a call is "recording" or "interception" under state wiretap laws, and whether the checkbox plus the opening disclosure is sufficient consent where all parties must consent (for example MA, CT, PA, CA, and others). Confirm the implications of the AI vendor (OpenAI) receiving the audio, given ongoing wiretap litigation against AI vendors.
5. **State telemarketing / "mini-TCPA" laws.** Confirm the rules that apply to calls and texts reaching NJ, NY, CT, MA, PA, and any other state where a lead's phone number or location is (for example FL, OK, MD, WA). Check calling-hour limits (the code uses 9 a.m.–8 p.m. local), registration requirements, caller-ID and disclosure rules, and per-day/attempt limits. Confirm what to do when the area code and the submitted time zone disagree.
6. **Revocation of consent.** To confirm: FCC rules adopted in 2024 (effective in 2025) let people revoke consent by any reasonable means, require honoring revocations within a set period, and allow a single confirmation text; parts of those rules were delayed. Confirm current requirements and whether our handling is adequate: STOP-style keywords (including "revoke" and "opt out") are recognized, but free-text requests such as "please don't text me anymore" are not, and verbal "don't call me again" during an AI call depends on staff reading the transcript (see section d).
7. **Transcript and lead retention period.** No retention period is defined. Decide how long to keep leads, consent records, opt-out records, AI-call transcripts (in Firestore and in staff email inboxes), and SMS logs, and whether transcripts should be deleted sooner than other records. Confirm OpenAI and Twilio data-retention settings for this account.
8. **Insurance.** TCPA and privacy claims are often excluded from general liability policies. Ask the insurance broker whether the business has, or should add, coverage (for example cyber/privacy or media liability with a TCPA endorsement) before enabling calls or texts.

## (c) Owner actions outside the code

- **Twilio A2P 10DLC registration.** Register the brand (Stone Bellisimo LLC, EIN, address) and an SMS campaign. Use `https://stonebellisimollc.com/privacy/` and `https://stonebellisimollc.com/terms/` as the privacy and terms URLs, the exact SMS consent text as the opt-in description, the first automated text as a sample message, and a screenshot of the form's consent checkbox as proof of opt-in. Registration will be rejected if the policy pages are not live; publish only after counsel approves.
- **Custom HELP/STOP responses.** Configure a HELP reply in Twilio (Advanced Opt-Out on the Messaging Service) that names Stone Bellisimo LLC and gives 201.553.1919 / the contact email, since campaign reviewers check this.
- **Trust Hub.** Complete the Twilio Trust Hub business profile, register caller name (CNAM), and confirm SHAKEN/STIR attestation for the outbound number so calls do not display as "Spam Likely."
- **Emergency address.** Set the emergency (E911) address on +1 551-214-2103 in Twilio.
- **Confirm which number calls and texts.** The site lists Bella at +1-551-292-8353; the code uses `TWILIO_CALLER_ID`. Decide which number is the outbound caller ID and texting number and keep the A2P campaign, CNAM, and public listings consistent.
- **Vendor terms.** Review Twilio's Acceptable Use Policy and messaging policy, and OpenAI's usage policies and API data-use terms (including whether to request zero data retention) for this use.
- **Separate Twilio subaccount.** The Twilio account also holds other businesses' numbers. Consider a dedicated subaccount for Stone Bellisimo so its A2P registration, opt-out lists, logs, billing, and credentials are isolated.
- **Staff procedure.** Write down who reads transcripts and inbound texts, how quickly a "don't call/text me" request is honored, and where the request is recorded.

## (d) Known gaps

- **No cross-lead do-not-call list.** If a caller says "don't call me again" during an AI call, nothing in code records it; staff must read the transcript and act. A new estimate request from the same number would be treated as a fresh consent.
- **SMS opt-out covers recent leads only.** An opt-out updates every matching lead among the latest 200, and only the listed keywords are recognized; free-text requests need staff action. Twilio's own STOP blocking also prevents further texts from the same Twilio number.
- **HELP relies on Twilio's default keyword handling.** There is no custom HELP reply in code.
- **No automatic transcript deletion.** Transcripts remain on the lead in Firestore and in staff email until someone deletes them.
- **Analytics disclosures need a final check.** In the current source, the Google Analytics measurement ID is blank (so GA does not load), no Microsoft Clarity script was found, and no Cloudflare Web Analytics beacon tag appears in the HTML (the Content-Security-Policy allows it, so it may be injected by Cloudflare at the edge). The Privacy Policy lists GA "when enabled" and Cloudflare Web Analytics and omits Clarity. Update the policy before go-live if any of this changes.

## (e) Go-live gate

Nothing is enabled. Calling and texting stay off (`AI_CALLING_ENABLED=false`, `SMS_FOLLOWUP_ENABLED=false`, approved-version variables unset) until:

1. Counsel approves the consent copy, Privacy Policy, Terms of Use, and the call/text practices above, in writing.
2. Any wording changes are made in code and the drafts, and the consent version is bumped if the checkbox text changed.
3. The owner actions in section (c) are complete and the test steps in HIGH_SPEED_TO_LEAD.md pass.

Then set `AI_CALL_CONSENT_APPROVED_VERSION=ai_call_transcript_v1` and/or `SMS_CONSENT_APPROVED_VERSION=sms_inquiry_v1` (or the new approved versions) and enable only the approved channel(s).
