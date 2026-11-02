import { createHmac, timingSafeEqual } from 'node:crypto';
import { AI_CALL_CONSENT_VERSION, SMS_CONSENT_VERSION } from './lead-automation.mjs';

const CALL_WINDOW_START_MINUTE = 9 * 60;
const CALL_WINDOW_END_MINUTE = 20 * 60;
const CALL_DELAY_MS = 5 * 60 * 1000;

function isEnabled(value) {
  return String(value || '').toLowerCase() === 'true';
}

function xmlEscape(value = '') {
  return String(value).replace(/[<>&'"]/g, character => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
  })[character]);
}

function siteUrl(env, pathname, query = '') {
  return `${String(env.PUBLIC_SITE_URL || 'https://stonebellisimollc.com').replace(/\/+$/, '')}${pathname}${query}`;
}

function validTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function utcOffsetAt(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute)
  );
  return localAsUtc - date.getTime();
}

function localStartAsUtc(year, month, day, hour, timeZone) {
  const approximate = new Date(Date.UTC(year, month - 1, day, hour));
  let adjusted = new Date(approximate.getTime() - utcOffsetAt(approximate, timeZone));
  adjusted = new Date(approximate.getTime() - utcOffsetAt(adjusted, timeZone));
  return adjusted;
}

export function nextPermittedCallTime(value, timeZone = 'America/New_York') {
  const due = new Date(value);
  if (Number.isNaN(due.valueOf()) || !validTimeZone(timeZone)) {
    throw new TypeError('A valid call time and IANA time zone are required.');
  }

  const parts = zonedParts(due, timeZone);
  const minuteOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  if (minuteOfDay >= CALL_WINDOW_START_MINUTE && minuteOfDay < CALL_WINDOW_END_MINUTE) return due;

  const startToday = localStartAsUtc(Number(parts.year), Number(parts.month), Number(parts.day), 9, timeZone);
  if (minuteOfDay < CALL_WINDOW_START_MINUTE && startToday > due) return startToday;
  const nextDay = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1));
  return localStartAsUtc(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), 9, timeZone);
}

export function twilioSignature(url, params, authToken) {
  if (!authToken) return '';
  const data = Object.keys(params || {}).sort().reduce((value, key) => {
    const entries = Array.isArray(params[key]) ? params[key].slice().sort() : [params[key]];
    return value + entries.map(entry => `${key}${entry}`).join('');
  }, String(url));
  return createHmac('sha1', authToken).update(data).digest('base64');
}

export function verifyTwilioSignature(url, params, signature, authToken) {
  if (!signature || !authToken) return false;
  const expected = Buffer.from(twilioSignature(url, params, authToken));
  const actual = Buffer.from(String(signature));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function twilioRequestUrl(request, env) {
  const parsed = new URL(request.url);
  const origin = new URL(env.PUBLIC_SITE_URL || 'https://stonebellisimollc.com');
  parsed.protocol = origin.protocol;
  parsed.host = origin.host;
  return parsed.toString();
}

export async function readTwilioForm(request) {
  if (!String(request.headers.get('content-type') || '').toLowerCase().includes('application/x-www-form-urlencoded')) {
    return { error: 'Expected a Twilio form-encoded request.' };
  }
  try {
    const form = await request.formData();
    return { params: Object.fromEntries(form.entries()) };
  } catch {
    return { error: 'Could not read the Twilio webhook request.' };
  }
}

export async function verifyTwilioRequest(request, params, env) {
  return verifyTwilioSignature(
    twilioRequestUrl(request, env),
    params,
    request.headers.get('x-twilio-signature'),
    env.TWILIO_AUTH_TOKEN
  );
}

function twilioAuthorization(env) {
  const accountSid = env.TWILIO_ACCOUNT_SID || '';
  const authToken = env.TWILIO_AUTH_TOKEN || '';
  if (!/^AC[a-f\d]{32}$/i.test(accountSid) || !authToken) {
    throw new Error('Twilio account credentials are not configured.');
  }
  return {
    accountSid,
    authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`
  };
}

async function postTwilioResource(path, fields, env, fetchImpl) {
  const { accountSid, authorization } = twilioAuthorization(env);
  const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/${path}.json`, {
    method: 'POST',
    headers: {
      authorization,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(fields)
  });
  let body = {};
  try {
    body = await response.json();
  } catch {
    // The status code remains authoritative when Twilio returns no JSON.
  }
  if (!response.ok) {
    throw new Error(`Twilio request failed (${response.status}): ${String(body.message || body.code || 'request rejected').slice(0, 200)}`);
  }
  return body;
}

// Spoken by Twilio before the AI connects, so the disclosure never depends on the model.
export const AI_CALL_DISCLOSURE = 'Hello, this is an automated call from Stone Bellisimo’s AI assistant about the estimate request you submitted. This call is transcribed and shared with our team.';

export function buildTwilioVoiceXml({ leadId, streamUrl }) {
  if (!leadId || !String(streamUrl || '').startsWith('wss://')) throw new TypeError('A lead ID and secure voice-stream URL are required.');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">${xmlEscape(AI_CALL_DISCLOSURE)}</Say><Connect><Stream url="${xmlEscape(streamUrl)}"><Parameter name="leadId" value="${xmlEscape(leadId)}"/></Stream></Connect></Response>`;
}

export function buildTwilioTransferXml(phoneNumber) {
  if (!/^\+[1-9]\d{7,14}$/.test(String(phoneNumber || ''))) throw new TypeError('A valid E.164 transfer number is required.');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">Please hold while I connect you with our team.</Say><Dial>${xmlEscape(phoneNumber)}</Dial></Response>`;
}

export async function placeAiLeadCall(lead, env, fetchImpl = fetch) {
  const { phoneContactConsent, aiCallConsent, aiCallConsentTextVersion } = lead;
  if (!phoneContactConsent || !aiCallConsent || aiCallConsentTextVersion !== AI_CALL_CONSENT_VERSION) {
    throw new Error('Lead does not have the required current AI-call consent.');
  }
  if (!isEnabled(env.AI_CALLING_ENABLED) || env.AI_CALL_CONSENT_APPROVED_VERSION !== AI_CALL_CONSENT_VERSION) {
    throw new Error('AI calling is disabled or its consent copy has not been approved.');
  }
  if (env.TWILIO_CALLER_ID_VERIFIED !== 'true' || !/^\+[1-9]\d{7,14}$/.test(env.TWILIO_CALLER_ID || '')) {
    throw new Error('A verified Twilio caller ID is required before calls can be placed.');
  }
  if (!/^\+[1-9]\d{7,14}$/.test(env.AI_CALL_TRANSFER_NUMBER || '')) {
    throw new Error('A team transfer phone number is required before calls can be placed.');
  }
  if (!String(env.OPENAI_VOICE_AGENT_WEBSOCKET_URL || '').startsWith('wss://')) {
    throw new Error('The secure OpenAI voice-agent WebSocket URL is not configured.');
  }

  return postTwilioResource('Calls', {
    To: lead.phoneE164 || lead.phone,
    From: env.TWILIO_CALLER_ID,
    Url: siteUrl(env, '/api/twilio/voice', `?leadId=${encodeURIComponent(lead.id)}`),
    Method: 'POST',
    StatusCallback: siteUrl(env, '/api/twilio/status', `?leadId=${encodeURIComponent(lead.id)}`),
    StatusCallbackMethod: 'POST',
    StatusCallbackEvent: 'initiated ringing answered completed',
    Timeout: '25'
  }, env, fetchImpl);
}

export async function sendLeadSms(lead, env, fetchImpl = fetch) {
  if (!lead.phoneContactConsent || !lead.smsConsent || lead.smsConsentTextVersion !== SMS_CONSENT_VERSION) {
    throw new Error('Lead does not have the required current SMS consent.');
  }
  if (!isEnabled(env.SMS_FOLLOWUP_ENABLED) || env.SMS_CONSENT_APPROVED_VERSION !== SMS_CONSENT_VERSION) {
    throw new Error('SMS follow-up is disabled or its consent copy has not been approved.');
  }
  if (env.TWILIO_CALLER_ID_VERIFIED !== 'true' || !/^\+[1-9]\d{7,14}$/.test(env.TWILIO_CALLER_ID || '')) {
    throw new Error('A verified Twilio messaging number is required before texts can be sent.');
  }

  const name = String(lead.firstName || 'there').replace(/[<>&]/g, '').slice(0, 60);
  const project = String(lead.projectType || 'project inquiry').replace(/[<>&]/g, '').slice(0, 100);
  const message = `Stone Bellisimo LLC: Hi ${name}, we received your ${project}. Reply here with details or to have a team member follow up. Msg frequency varies. Msg & data rates may apply. Reply HELP for help. Reply STOP to opt out.`;
  return postTwilioResource('Messages', {
    To: lead.phoneE164 || lead.phone,
    From: env.TWILIO_CALLER_ID,
    Body: message,
    StatusCallback: siteUrl(env, '/api/twilio/message-status', `?leadId=${encodeURIComponent(lead.id)}`)
  }, env, fetchImpl);
}

async function dueLeadSnapshots(db, statusField, dueField, now, limit) {
  const snapshot = await db.collection('leads')
    .where(statusField, '==', 'queued')
    .where(dueField, '<=', now.toISOString())
    .orderBy(dueField, 'asc')
    .limit(limit)
    .get();
  return snapshot.docs;
}

async function markStaleFollowupClaims(db, statusField, now, staleAfterMs = 5 * 60 * 1000) {
  const claimedAtField = `${statusField}ClaimedAt`;
  const staleBefore = new Date(now.getTime() - staleAfterMs).toISOString();
  const snapshot = await db.collection('leads')
    .where(statusField, '==', 'starting')
    .where(claimedAtField, '<=', staleBefore)
    .orderBy(claimedAtField, 'asc')
    .limit(50)
    .get();
  for (const document of snapshot.docs) {
    await db.runTransaction(async transaction => {
      const fresh = await transaction.get(document.ref);
      if (!fresh.exists) return;
      const data = fresh.data();
      if (data[statusField] !== 'starting' || data[claimedAtField] > staleBefore) return;
      transaction.update(document.ref, {
        [statusField]: 'uncertain',
        [`${statusField}LastError`]: 'The provider request outcome was not recorded before the processing claim expired.',
        updatedAt: now.toISOString()
      });
    });
  }
}

async function claimLeadFollowup(db, leadId, statusField, dueField, now) {
  const reference = db.collection('leads').doc(leadId);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) return null;
    const lead = snapshot.data();
    if (lead[statusField] !== 'queued' || !lead[dueField] || new Date(lead[dueField]).getTime() > now.getTime()) return null;
    transaction.update(reference, {
      [statusField]: 'starting',
      [`${statusField}ClaimedAt`]: now.toISOString(),
      updatedAt: now.toISOString()
    });
    return { ...lead, id: leadId };
  });
}

async function runFollowupBatch({ db, env, now, statusField, dueField, send, kind, enabled, limit, fetchImpl }) {
  await markStaleFollowupClaims(db, statusField, now);
  const documents = await dueLeadSnapshots(db, statusField, dueField, now, limit);
  const result = { checked: documents.length, started: 0, failed: 0, uncertain: 0, paused: !isEnabled(enabled) };
  if (result.paused) return result;

  for (const document of documents) {
    const lead = await claimLeadFollowup(db, document.id, statusField, dueField, now);
    if (!lead) continue;
    let remote;
    try {
      remote = await send(lead, env, fetchImpl);
    } catch (error) {
      const uncertain = /fetch failed|timeout|socket|network/i.test(error?.message || '');
      const failure = {
        [statusField]: uncertain ? 'uncertain' : 'failed',
        [`${statusField}LastError`]: String(error?.message || 'Twilio request failed').slice(0, 300),
        updatedAt: now.toISOString()
      };
      await db.collection('leads').doc(lead.id).update(failure);
      console.error(JSON.stringify({ message: `Twilio ${kind} follow-up failed`, leadId: lead.id, uncertain, error: error?.message || String(error) }));
      if (uncertain) result.uncertain += 1;
      else result.failed += 1;
      continue;
    }

    const saved = kind === 'call'
      ? { aiCallStatus: 'initiated', aiCallSid: remote.sid || null, aiCallInitiatedAt: now.toISOString() }
      : { smsStatus: 'sent', smsMessageSid: remote.sid || null, smsSentAt: now.toISOString() };
    try {
      await db.collection('leads').doc(lead.id).update({ ...saved, updatedAt: now.toISOString() });
      result.started += 1;
    } catch (error) {
      result.uncertain += 1;
      console.error(JSON.stringify({
        message: `Twilio ${kind} was accepted but its lead status could not be saved; automatic retry is prevented.`,
        leadId: lead.id,
        error: error?.message || String(error)
      }));
    }
  }
  return result;
}

export async function enqueueLeadFollowup(db, lead, env, now = new Date()) {
  if (lead.attribution?.trafficClass === 'test') return { queued: false, reason: 'test_traffic' };
  const reference = db.collection('leads').doc(lead.id);
  const queued = [];
  const snapshot = await reference.get();
  if (!snapshot.exists) return { queued: false, reason: 'lead_missing' };
  const existing = snapshot.data();
  const update = { updatedAt: now.toISOString() };
  const due = new Date(now.getTime() + CALL_DELAY_MS);

  if (
    isEnabled(env.AI_CALLING_ENABLED) &&
    env.AI_CALL_CONSENT_APPROVED_VERSION === AI_CALL_CONSENT_VERSION &&
    lead.aiCallConsent === true &&
    lead.phoneContactConsent === true &&
    lead.aiCallConsentTextVersion === AI_CALL_CONSENT_VERSION &&
    ['call', 'scheduled_call'].includes(lead.preferredContactMethod) &&
    !['queued', 'starting', 'initiated', 'answered', 'completed'].includes(existing.aiCallStatus)
  ) {
    if (
      env.TWILIO_CALLER_ID_VERIFIED !== 'true' ||
      !/^\+[1-9]\d{7,14}$/.test(env.TWILIO_CALLER_ID || '') ||
      !/^\+[1-9]\d{7,14}$/.test(env.AI_CALL_TRANSFER_NUMBER || '') ||
      !String(env.OPENAI_VOICE_AGENT_WEBSOCKET_URL || '').startsWith('wss://')
    ) {
      console.warn(JSON.stringify({ message: 'Consented AI call held: Twilio caller ID, transfer number, or secure voice service is not configured.', leadId: lead.id }));
      return { queued: false, reason: 'voice_configuration_incomplete' };
    }
    const scheduled = lead.preferredContactMethod === 'scheduled_call';
    const requested = scheduled ? new Date(lead.preferredCallbackAt) : due;
    // The callback was validated in its own zone; the browser zone is unvalidated for other methods.
    const timeZone = (scheduled
      ? [lead.preferredCallbackTimezone, lead.contactTimezone]
      : [lead.contactTimezone, lead.preferredCallbackTimezone]
    ).find(value => value && validTimeZone(value)) || 'America/New_York';
    const callAt = nextPermittedCallTime(Number.isNaN(requested.valueOf()) ? due : requested, timeZone);
    update.aiCallDueAt = callAt.toISOString();
    update.aiCallStatus = 'queued';
    queued.push('call');
  }

  if (
    isEnabled(env.SMS_FOLLOWUP_ENABLED) &&
    env.SMS_CONSENT_APPROVED_VERSION === SMS_CONSENT_VERSION &&
    lead.smsConsent === true &&
    lead.phoneContactConsent === true &&
    lead.smsConsentTextVersion === SMS_CONSENT_VERSION &&
    lead.preferredContactMethod === 'text' &&
    !['queued', 'starting', 'sent'].includes(existing.smsStatus)
  ) {
    if (env.TWILIO_CALLER_ID_VERIFIED !== 'true' || !/^\+[1-9]\d{7,14}$/.test(env.TWILIO_CALLER_ID || '')) {
      console.warn(JSON.stringify({ message: 'Consented SMS held: verified Twilio messaging number is not configured.', leadId: lead.id }));
      return { queued: false, reason: 'sms_configuration_incomplete' };
    }
    update.smsDueAt = due.toISOString();
    update.smsStatus = 'queued';
    queued.push('sms');
  }

  if (!queued.length) return { queued: false, reason: 'disabled_or_unapproved' };
  await reference.update(update);
  return { queued: true, kinds: queued };
}

export async function processDueTwilioFollowups({ db, env, now = new Date(), fetchImpl = fetch }) {
  if (!db) throw new TypeError('Firestore is required to process lead follow-ups.');
  const results = [];
  if (isEnabled(env.AI_CALLING_ENABLED)) {
    results.push(await runFollowupBatch({
      db, env, now, statusField: 'aiCallStatus', dueField: 'aiCallDueAt',
      send: placeAiLeadCall, kind: 'call', enabled: env.AI_CALLING_ENABLED, limit: 20, fetchImpl
    }));
  }
  if (isEnabled(env.SMS_FOLLOWUP_ENABLED)) {
    results.push(await runFollowupBatch({
      db, env, now, statusField: 'smsStatus', dueField: 'smsDueAt',
      send: sendLeadSms, kind: 'sms', enabled: env.SMS_FOLLOWUP_ENABLED, limit: 20, fetchImpl
    }));
  }
  return {
    checked: results.reduce((sum, result) => sum + result.checked, 0),
    started: results.reduce((sum, result) => sum + result.started, 0),
    failed: results.reduce((sum, result) => sum + result.failed, 0),
    uncertain: results.reduce((sum, result) => sum + result.uncertain, 0),
    paused: results.length === 0
  };
}

export async function handleTwilioVoiceWebhook(request, env, { store }) {
  if (request.method !== 'POST') return { status: 405, body: 'Method not allowed.' };
  const form = await readTwilioForm(request);
  if (form.error) return { status: 400, body: form.error };
  if (!await verifyTwilioRequest(request, form.params, env)) return { status: 403, body: 'Invalid Twilio signature.' };

  const leadId = new URL(request.url).searchParams.get('leadId') || '';
  const lead = await store.getLeadById(leadId);
  if (!lead || !lead.aiCallConsent || !lead.phoneContactConsent || lead.aiCallConsentTextVersion !== AI_CALL_CONSENT_VERSION) {
    return { status: 404, body: 'Lead or consent not found.' };
  }
  if (lead.aiCallSid && lead.aiCallSid !== form.params.CallSid) {
    return { status: 409, body: 'Call does not match the saved lead.' };
  }
  if (!isEnabled(env.AI_CALLING_ENABLED) || env.AI_CALL_CONSENT_APPROVED_VERSION !== AI_CALL_CONSENT_VERSION) {
    return { status: 410, body: 'AI calling is disabled.' };
  }
  const streamUrl = buildTwilioVoiceXml({ leadId, streamUrl: env.OPENAI_VOICE_AGENT_WEBSOCKET_URL });
  return { status: 200, contentType: 'application/xml; charset=utf-8', body: streamUrl };
}

export async function handleTwilioCallStatusWebhook(request, env, { store }) {
  if (request.method !== 'POST') return { status: 405, body: 'Method not allowed.' };
  const form = await readTwilioForm(request);
  if (form.error) return { status: 400, body: form.error };
  if (!await verifyTwilioRequest(request, form.params, env)) return { status: 403, body: 'Invalid Twilio signature.' };

  const leadId = new URL(request.url).searchParams.get('leadId') || '';
  const lead = await store.getLeadById(leadId);
  if (!lead || (lead.aiCallSid && lead.aiCallSid !== form.params.CallSid)) {
    return { status: 404, body: 'Lead or call not found.' };
  }
  await store.updateLeadFields?.(leadId, {
    aiCallSid: form.params.CallSid || lead.aiCallSid || null,
    aiCallProviderStatus: String(form.params.CallStatus || '').slice(0, 40),
    aiCallLastStatusAt: new Date().toISOString(),
    ...(lead.aiCallStatus !== 'transferred' && ['busy', 'no-answer', 'failed', 'canceled'].includes(String(form.params.CallStatus || '').toLowerCase())
      ? { aiCallStatus: String(form.params.CallStatus).toLowerCase() }
      : {}),
    ...(lead.aiCallStatus === 'initiated' && String(form.params.CallStatus || '').toLowerCase() === 'in-progress'
      ? { aiCallStatus: 'in_progress' }
      : {}),
    updatedAt: new Date().toISOString()
  });
  return { status: 204, body: '' };
}

export async function handleTwilioMessageStatusWebhook(request, env, { store }) {
  if (request.method !== 'POST') return { status: 405, body: 'Method not allowed.' };
  const form = await readTwilioForm(request);
  if (form.error) return { status: 400, body: form.error };
  if (!await verifyTwilioRequest(request, form.params, env)) return { status: 403, body: 'Invalid Twilio signature.' };

  const leadId = new URL(request.url).searchParams.get('leadId') || '';
  const lead = await store.getLeadById(leadId);
  if (!lead || (lead.smsMessageSid && lead.smsMessageSid !== form.params.MessageSid)) {
    return { status: 404, body: 'Lead or message not found.' };
  }
  await store.updateLeadFields?.(leadId, {
    smsMessageSid: form.params.MessageSid || lead.smsMessageSid || null,
    smsProviderStatus: String(form.params.MessageStatus || '').slice(0, 40),
    smsLastStatusAt: new Date().toISOString(),
    ...(['failed', 'undelivered'].includes(String(form.params.MessageStatus || '').toLowerCase())
      ? { smsStatus: String(form.params.MessageStatus).toLowerCase() }
      : {}),
    updatedAt: new Date().toISOString()
  });
  return { status: 204, body: '' };
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(value || '').startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return '';
}

export async function handleTwilioInboundSms(request, env, { db }) {
  if (request.method !== 'POST') return { status: 405, body: 'Method not allowed.' };
  const form = await readTwilioForm(request);
  if (form.error) return { status: 400, body: form.error };
  if (!await verifyTwilioRequest(request, form.params, env)) return { status: 403, body: 'Invalid Twilio signature.' };

  const messageSid = String(form.params.MessageSid || '');
  const from = String(form.params.From || '');
  const body = String(form.params.Body || '').slice(0, 4000);
  if (!/^SM[a-f\d]{32}$/i.test(messageSid) || !normalizePhone(from)) return { status: 400, body: 'Invalid inbound message.' };
  const leads = await db.collection('leads').orderBy('submittedAt', 'desc').limit(200).get();
  const normalizedFrom = normalizePhone(from);
  const matchingLeads = leads.docs.filter(document => normalizePhone(document.data().phoneE164 || document.data().phone) === normalizedFrom);
  const matchingLead = matchingLeads[0];
  const receivedAt = new Date().toISOString();
  // Carrier keywords plus plain-language revocations; an opt-out covers every inquiry from that phone.
  const isOptOut = /^(stop|stop all|stopall|unsubscribe|cancel|end|quit|revoke|opt out|optout|opt-out)[.!]?$/i.test(body.trim());
  if (isOptOut) {
    for (const document of matchingLeads) {
      await document.ref.update({
        smsConsent: false,
        phoneContactConsent: document.data().aiCallConsent === true,
        smsOptedOutAt: receivedAt,
        smsStatus: 'opted_out',
        updatedAt: receivedAt
      });
    }
  }
  await db.collection('twilio_sms_events').doc(messageSid).create({
    messageSid,
    leadId: matchingLead?.id || null,
    from,
    body: isOptOut ? '[Customer opted out of SMS.]' : body,
    status: isOptOut ? 'opt_out' : 'received',
    receivedAt
  }).catch(error => {
    if (error?.code !== 6) throw error;
  });
  return { status: 200, contentType: 'application/xml; charset=utf-8', body: '<?xml version="1.0" encoding="UTF-8"?><Response/>' };
}

export async function handleTwilioTransfer({ callSid, phoneNumber, env, fetchImpl = fetch }) {
  if (!/^CA[a-f\d]{32}$/i.test(String(callSid || ''))) throw new TypeError('A valid Twilio call SID is required.');
  const xml = buildTwilioTransferXml(phoneNumber || env.AI_CALL_TRANSFER_NUMBER);
  return postTwilioResource(`Calls/${encodeURIComponent(callSid)}`, { Twiml: xml }, env, fetchImpl);
}
