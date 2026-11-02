import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTwilioTransferXml,
  buildTwilioVoiceXml,
  enqueueLeadFollowup,
  handleTwilioInboundSms,
  handleTwilioVoiceWebhook,
  nextPermittedCallTime,
  placeAiLeadCall,
  sendLeadSms,
  twilioSignature,
  verifyTwilioSignature
} from '../src/twilio-automation.mjs';

const callEnv = {
  PUBLIC_SITE_URL: 'https://stonebellisimollc.com',
  AI_CALLING_ENABLED: 'true',
  AI_CALL_CONSENT_APPROVED_VERSION: 'ai_call_transcript_v1',
  TWILIO_CALLER_ID: '+15512928353',
  TWILIO_CALLER_ID_VERIFIED: 'true',
  // Fake SID, assembled so secret scanners don't mistake the fixture for a real account.
  TWILIO_ACCOUNT_SID: `AC${'0123456789abcdef'.repeat(2)}`,
  TWILIO_AUTH_TOKEN: 'unit-test-token',
  AI_CALL_TRANSFER_NUMBER: '+12012816423',
  OPENAI_VOICE_AGENT_WEBSOCKET_URL: 'wss://voice.example.com/twilio-media'
};

test('AI callbacks are deferred to 9 a.m. and never placed after 8 p.m. local time', () => {
  const afterHours = nextPermittedCallTime('2026-11-02T02:00:00.000Z', 'America/New_York');
  assert.equal(afterHours.toISOString(), '2026-11-02T14:00:00.000Z');

  const beforeHours = nextPermittedCallTime('2026-11-02T12:00:00.000Z', 'America/New_York');
  assert.equal(beforeHours.toISOString(), '2026-11-02T14:00:00.000Z');

  const withinHours = new Date('2026-11-02T16:30:00.000Z');
  assert.equal(nextPermittedCallTime(withinHours, 'America/New_York').toISOString(), withinHours.toISOString());
});

test('Twilio webhook signatures include the full URL and sorted POST parameters', () => {
  const url = 'https://stonebellisimollc.com/api/twilio/voice?leadId=lead_123';
  const params = { CallSid: 'CA123', CallStatus: 'in-progress' };
  const signature = twilioSignature(url, params, callEnv.TWILIO_AUTH_TOKEN);
  assert.equal(verifyTwilioSignature(url, params, signature, callEnv.TWILIO_AUTH_TOKEN), true);
  assert.equal(verifyTwilioSignature(url, { ...params, CallSid: 'CA456' }, signature, callEnv.TWILIO_AUTH_TOKEN), false);
  assert.equal(verifyTwilioSignature(url, params, signature, ''), false);
});

test('TwiML connects a lead to a secure stream and escapes transfer destinations', () => {
  assert.match(buildTwilioVoiceXml({ leadId: 'lead_123', streamUrl: callEnv.OPENAI_VOICE_AGENT_WEBSOCKET_URL }), /wss:\/\/voice\.example\.com\/twilio-media/);
  assert.match(buildTwilioVoiceXml({ leadId: 'lead_123', streamUrl: callEnv.OPENAI_VOICE_AGENT_WEBSOCKET_URL }), /name="leadId" value="lead_123"/);
  assert.throws(() => buildTwilioVoiceXml({ leadId: 'lead_123', streamUrl: 'http://voice.example.com' }), /secure voice-stream URL/);
  assert.match(buildTwilioTransferXml('+12012816423'), /<Dial>\+12012816423<\/Dial>/);
  assert.throws(() => buildTwilioTransferXml('12012816423'), /E.164/);
});

test('consented leads are queued only after the explicit enablement and approval gates', async () => {
  const lead = {
    id: 'lead_123',
    phone: '(201) 555-0101',
    firstName: 'Ada',
    preferredContactMethod: 'call',
    phoneContactConsent: true,
    aiCallConsent: true,
    aiCallConsentTextVersion: 'ai_call_transcript_v1',
    contactTimezone: 'America/New_York',
    submittedAt: '2026-11-02T14:00:00.000Z'
  };
  let saved;
  const db = {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: true, data: () => ({ aiCallStatus: 'pending_approval' }) }),
        update: async update => { saved = update; }
      })
    })
  };
  assert.deepEqual(await enqueueLeadFollowup(db, lead, { ...callEnv, AI_CALLING_ENABLED: 'false' }), {
    queued: false,
    reason: 'disabled_or_unapproved'
  });
  assert.equal(saved, undefined);

  const queued = await enqueueLeadFollowup(db, lead, callEnv, new Date('2026-11-02T14:00:00.000Z'));
  assert.deepEqual(queued, { queued: true, kinds: ['call'] });
  assert.equal(saved.aiCallStatus, 'queued');
  assert.equal(saved.aiCallDueAt, '2026-11-02T14:05:00.000Z');
});

test('Twilio call creation is consent-gated and submits the five-minute lead callback URL', async () => {
  let submitted;
  const lead = {
    id: 'lead_123',
    phone: '(201) 555-0101',
    phoneE164: '+12015550101',
    phoneContactConsent: true,
    aiCallConsent: true,
    aiCallConsentTextVersion: 'ai_call_transcript_v1'
  };
  const result = await placeAiLeadCall(lead, callEnv, async (url, options) => {
    submitted = { url, options };
    return new Response(JSON.stringify({ sid: 'CA0123456789abcdef0123456789abcdef' }), { status: 201 });
  });
  assert.equal(result.sid, 'CA0123456789abcdef0123456789abcdef');
  assert.match(submitted.url, /\/Calls\.json$/);
  const body = new URLSearchParams(submitted.options.body);
  assert.equal(body.get('To'), '+12015550101');
  assert.equal(body.get('From'), '+15512928353');
  assert.equal(body.get('Url'), 'https://stonebellisimollc.com/api/twilio/voice?leadId=lead_123');
  await assert.rejects(() => placeAiLeadCall({ ...lead, aiCallConsent: false }, callEnv, () => {
    throw new Error('must not send without consent');
  }), /required current AI-call consent/);
});

test('consented SMS is scheduled and uses a STOP-enabled callback message', async () => {
  const lead = {
    id: 'lead_sms',
    phone: '(201) 555-0101',
    phoneE164: '+12015550101',
    firstName: 'Ada',
    projectType: 'Kitchen',
    preferredContactMethod: 'text',
    phoneContactConsent: true,
    smsConsent: true,
    smsConsentTextVersion: 'sms_inquiry_v1'
  };
  let submitted;
  const sms = await sendLeadSms(lead, {
    ...callEnv,
    SMS_FOLLOWUP_ENABLED: 'true',
    SMS_CONSENT_APPROVED_VERSION: 'sms_inquiry_v1'
  }, async (url, options) => {
    submitted = { url, body: new URLSearchParams(options.body) };
    return new Response(JSON.stringify({ sid: 'SM0123456789abcdef0123456789abcdef' }), { status: 201 });
  });
  assert.equal(sms.sid, 'SM0123456789abcdef0123456789abcdef');
  assert.equal(submitted.body.get('To'), '+12015550101');
  assert.match(submitted.body.get('Body'), /Reply STOP to opt out/);
  await assert.rejects(() => sendLeadSms({ ...lead, smsConsent: false }, {
    ...callEnv,
    SMS_FOLLOWUP_ENABLED: 'true',
    SMS_CONSENT_APPROVED_VERSION: 'sms_inquiry_v1'
  }), /required current SMS consent/);
});

test('inbound STOP texts revoke stored SMS consent and are not retained as ordinary message content', async () => {
  const messageSid = 'SM0123456789abcdef0123456789abcdef';
  const url = 'https://stonebellisimollc.com/api/twilio/sms';
  const params = {
    MessageSid: messageSid,
    From: '+12015550101',
    To: '+15512928353',
    Body: 'STOP'
  };
  const signature = twilioSignature(url, params, callEnv.TWILIO_AUTH_TOKEN);
  let leadUpdate;
  let eventSaved;
  const document = {
    id: 'lead_sms',
    data: () => ({ phone: '(201) 555-0101', smsConsent: true, aiCallConsent: false }),
    ref: { update: async update => { leadUpdate = update; } }
  };
  const db = {
    collection(name) {
      if (name === 'leads') {
        return { orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [document] }) }) }) };
      }
      return { doc: () => ({ create: async event => { eventSaved = event; } }) };
    }
  };
  const response = await handleTwilioInboundSms(new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signature
    },
    body: new URLSearchParams(params)
  }), callEnv, { db });

  assert.equal(response.status, 200);
  assert.equal(leadUpdate.smsConsent, false);
  assert.equal(leadUpdate.smsStatus, 'opted_out');
  assert.equal(eventSaved.status, 'opt_out');
  assert.equal(eventSaved.body, '[Customer opted out of SMS.]');
});

test('Twilio voice webhook returns streaming TwiML only for signed, consented calls', async () => {
  const url = 'https://stonebellisimollc.com/api/twilio/voice?leadId=lead_123';
  const params = { CallSid: 'CA0123456789abcdef0123456789abcdef' };
  const signature = twilioSignature(url, params, callEnv.TWILIO_AUTH_TOKEN);
  const request = new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signature
    },
    body: new URLSearchParams(params)
  });
  const result = await handleTwilioVoiceWebhook(request, callEnv, {
    store: {
      getLeadById: async () => ({
        id: 'lead_123',
        aiCallSid: params.CallSid,
        aiCallConsent: true,
        aiCallConsentTextVersion: 'ai_call_transcript_v1',
        phoneContactConsent: true
      })
    }
  });
  assert.equal(result.status, 200);
  assert.match(result.body, /<Connect><Stream/);
  assert.match(result.body, /wss:\/\/voice\.example\.com\/twilio-media/);

  const invalid = await handleTwilioVoiceWebhook(new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  }), callEnv, { store: { getLeadById: async () => null } });
  assert.equal(invalid.status, 403);
});

test('scheduled AI callbacks use the validated callback time zone, not an unvalidated browser zone', async () => {
  let saved;
  const db = {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: true, data: () => ({ aiCallStatus: 'pending_approval' }) }),
        update: async update => { saved = update; }
      })
    })
  };
  const lead = {
    id: 'lead_456',
    preferredContactMethod: 'scheduled_call',
    phoneContactConsent: true,
    aiCallConsent: true,
    aiCallConsentTextVersion: 'ai_call_transcript_v1',
    contactTimezone: 'Not/AZone',
    preferredCallbackAt: '2026-11-03T15:30:00.000Z',
    preferredCallbackTimezone: 'America/Los_Angeles'
  };

  const queued = await enqueueLeadFollowup(db, lead, callEnv, new Date('2026-11-02T14:00:00.000Z'));
  assert.deepEqual(queued, { queued: true, kinds: ['call'] });
  // 7:30 a.m. Pacific is before the calling window, so it moves to 9 a.m. Pacific.
  assert.equal(saved.aiCallDueAt, '2026-11-03T17:00:00.000Z');
});
