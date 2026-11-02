# Stone Bellisimo high-speed lead response

## Implemented flow

The homepage and contact-page estimate forms collect a follow-up choice: AI call as soon as possible, AI callback at a requested time, text, or email only. The AI-call option has a separate unchecked consent box that discloses the AI assistant and transcription. The text option has separate SMS consent. Callback times must be within 9 a.m.–8 p.m. in the submitted IANA time zone.

Every lead continues to be stored in Firestore and immediately emailed to the existing staff list and `BUSINESS_NOTIFICATION_EMAIL`. With the explicit runtime enablement and matching approved-consent version, the lead-created trigger queues a call or SMS for five minutes after submission, or an AI call for the requested callback time. A Firebase scheduler checks the due queue every minute. Automated calls are deferred to the next permitted local window; lead submissions and callback requests are still emailed immediately. Requested times are not confirmed calendar appointments.

Twilio places the call and streams audio to the separate `voice-agent` Cloud Run service. OpenAI Realtime (default model `gpt-realtime-2.1`, voice `marin`) powers the conversational AI; the voice is a natural option, not a clone of Bella. The agent identifies itself as AI, discloses transcription, confirms the inquiry, asks whether the lead wants a team member, and only transfers after an explicit yes. Twilio status, call transcript, transfer outcome, inbound texts, and opt-outs are recorded/notified. An uncertain Twilio API result is not automatically retried, to avoid duplicate calls or texts.

## Fail-closed launch state

Live voice and SMS are **off by default**:

- `AI_CALLING_ENABLED=false`
- `SMS_FOLLOWUP_ENABLED=false`
- `AI_CALL_CONSENT_APPROVED_VERSION=` (unset)
- `SMS_CONSENT_APPROVED_VERSION=` (unset)
- `TWILIO_CALLER_ID_VERIFIED=false`
- `TWILIO_CALLER_ID=` (unset)
- `AI_CALL_TRANSFER_NUMBER=` (unset)
- `OPENAI_VOICE_AGENT_WEBSOCKET_URL=` (unset)

The public website lists Bella at `+1-551-292-8353`, but this code does not assume that it is an outbound-enabled Twilio number. Verify Twilio ownership and voice/SMS capability before setting `TWILIO_CALLER_ID_VERIFIED=true`. Confirm the team's transfer number too. Do not enable either channel until the required configuration and approvals below are complete.

## Approval, privacy, and calling hours

The AI-call checkbox text is implementation copy, not a legal determination or legal approval. U.S. rules for AI/artificial-voice calls, marketing, recording/transcription, consent, and quiet hours vary by call purpose, recipient, and location. Have qualified counsel approve the exact copy and policy before setting `AI_CALL_CONSENT_APPROVED_VERSION=ai_call_transcript_v1`. Similarly approve the SMS copy before setting `SMS_CONSENT_APPROVED_VERSION=sms_inquiry_v1`. The system is designed to require consent; it does not determine legal compliance.

Automated calls are restricted to 9 a.m.–8 p.m. in the lead's submitted time zone. This avoids treating “any time” as permission for 24/7 calling; stricter local rules or business policy should narrow the window. SMS follows the selected preference and consent, supports `STOP` opt-out handling, and inbound texts notify staff. The call transcript is stored with the lead and sent to the staff list after the call. Keep transcript access limited to authorized staff and establish an appropriate retention policy before activation.

## Deployment prerequisites

1. Provision `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` as Firebase/Cloud Run secrets; provision `OPENAI_API_KEY` as a Cloud Run secret. Never put credential values in `.env.example`, source control, or this file. `siteApi` and the follow-up scheduler bind the two Twilio secrets, so `firebase deploy --only functions` fails until both exist in Secret Manager — even while calling and texting stay disabled. If the form changes must ship before Twilio is set up, create both secrets with placeholder values; webhooks then reject every request and nothing is sent.
2. Verify an outbound-capable Twilio number and configure `TWILIO_CALLER_ID`; verify a live team number and configure `AI_CALL_TRANSFER_NUMBER`.
3. Deploy `voice-agent/` to Cloud Run in `us-east1` with Node.js 22, the existing Functions runtime service account (or another service account authorized to read/write the required Firestore lead documents), and secret access. Set `AI_CALLING_ENABLED=false` initially. Use the resulting service URL as `OPENAI_VOICE_AGENT_WEBSOCKET_URL=wss://<service-host>/twilio-media` in the Functions environment. The voice agent reads its own environment, so set the same values on the Cloud Run service: secrets `OPENAI_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`; variables `AI_CALLING_ENABLED`, `AI_CALL_CONSENT_APPROVED_VERSION`, `AI_CALL_TRANSFER_NUMBER`, `OPENAI_VOICE_AGENT_WEBSOCKET_URL` (the exact URL Twilio connects to — it is part of the stream signature check), and optionally `OPENAI_REALTIME_MODEL` / `OPENAI_REALTIME_VOICE`. Calls only connect when both the Functions and Cloud Run enablement flags are on.
4. Configure the Twilio number's inbound-message webhook to `https://stonebellisimollc.com/api/twilio/sms`; the voice/status/message callbacks are supplied by the call/message APIs.
5. Deploy Firebase Functions and the Firestore indexes. Ensure the per-minute scheduler can run and Cloud Scheduler is enabled.
6. Use test numbers, test credentials, and the browser/unit fixtures. Confirm consent rejection, quiet-hour deferral, Twilio signature rejection, opt-out, transfer confirmation, transcript notification, and no duplicate on uncertain writes.
7. Only after counsel/business approval and all test readbacks, set the exact approved copy versions and enable the desired channel. The number and callback destination must be explicitly configured first.

HighLevel is not used for this flow; its growth workflows remain draft-only pending separate authorization.

## Validation

Run `npm test` for API validation, consent, Twilio queue/webhook, notification, and existing lead-flow tests. Run `npm run build` to build the website. `npm run test:browser` requires Java for Firebase emulators; the form flow can also be exercised with the local Playwright browser checks.
