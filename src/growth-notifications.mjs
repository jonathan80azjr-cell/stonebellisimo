import { renderInternalAlertEmail } from './email/render.mjs';
import { getEnv, sendAndRecordEmail } from './lead-automation.mjs';
import { GROWTH_CLIENT } from './growth-client-config.mjs';

const DEFAULT_OWNER_EMAILS = Object.freeze([...GROWTH_CLIENT.ownerEmails]);
const STAFFED_TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: GROWTH_CLIENT.timezone,
  weekday: 'long',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function staffedAt(timestamp) {
  const parts = Object.fromEntries(STAFFED_TIME_FORMAT.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  const day = String(parts.weekday || '').toLowerCase();
  const schedule = GROWTH_CLIENT.businessHours?.[day];
  if (!schedule || schedule === 'closed') return false;
  const [start, end] = schedule.split('-').map(value => {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  });
  const minuteOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  return minuteOfDay >= start && minuteOfDay < end;
}

export function staffedMinutesElapsed(startValue, endValue = Date.now(), cap = Number.POSITIVE_INFINITY) {
  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.POSITIVE_INFINITY;
  if (end <= start) return 0;
  let elapsed = 0;
  for (let cursor = start; cursor < end && elapsed < cap; cursor += 60_000) {
    if (staffedAt(cursor)) elapsed += 1;
  }
  return elapsed;
}

export function growthOwnerRecipients(env = {}) {
  const configured = String(env.GROWTH_NOTIFY_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  return [...new Set(configured.length ? configured : DEFAULT_OWNER_EMAILS)];
}

function dashboardUrl(env) {
  return `${getEnv(env, 'PUBLIC_SITE_URL', 'https://stonebellisimollc.com').replace(/\/+$/, '')}/admin/`;
}

export function buildGrowthInquiryAlert(inquiry = {}, env = {}, milestone = 'new') {
  const urgent = ['complaint', 'safety_urgent'].includes(inquiry.category) || milestone === 'breach30';
  const titles = {
    new: `New ${inquiry.platform || 'social'} inquiry`,
    reminder15: `Social inquiry is still unclaimed after ${GROWTH_CLIENT.sla.inbound_reminder_minutes} minutes`,
    breach30: `SLA breach: social inquiry unclaimed after ${GROWTH_CLIENT.sla.inbound_breach_minutes} minutes`
  };
  return renderInternalAlertEmail({
    eyebrow: milestone === 'new' ? 'Social inquiry' : 'SLA escalation',
    tone: urgent ? 'urgent' : 'default',
    title: titles[milestone] || titles.new,
    intro: milestone === 'new'
      ? `${GROWTH_CLIENT.ownerNames.join(' and ')} were notified together. The first owner to claim this conversation owns it.`
      : 'Automated acknowledgement time does not count as a staff response. Open the Firebase dashboard and claim the conversation.',
    rows: [
      ['Platform', inquiry.platform],
      ['Category', inquiry.category],
      ['Project', inquiry.projectType],
      ['Material', inquiry.material],
      ['City / ZIP', [inquiry.city, inquiry.postalCode].filter(Boolean).join(' ')],
      ['Timeframe', inquiry.timeframe],
      ['Content ID', inquiry.contentId],
      ['Received', inquiry.createdAt],
      ['Consent', inquiry.consentState]
    ],
    ctaLabel: 'Open growth inbox',
    ctaUrl: dashboardUrl(env),
    note: 'No social message body is stored or included in this alert.'
  });
}

export async function sendGrowthOwnerAlert({ env, store, inquiry, milestone = 'new' }) {
  if (String(env.GROWTH_NOTIFICATIONS_ENABLED || '').toLowerCase() !== 'true') {
    return { sent: false, reason: 'disabled' };
  }
  const recipients = growthOwnerRecipients(env);
  try {
    await sendAndRecordEmail({
      env,
      store,
      eventType: `admin_growth_inquiry_${milestone}`,
      email: {
        ...buildGrowthInquiryAlert(inquiry, env, milestone),
        to: recipients.join(', '),
        metadata: {
          email_type: `admin_growth_inquiry_${milestone}`,
          inquiry_id: inquiry.id || '',
          platform: inquiry.platform || '',
          category: inquiry.category || ''
        }
      }
    });
    return { sent: true, recipients };
  } catch (error) {
    return { sent: false, reason: error?.message || 'send_failed' };
  }
}

export async function processGrowthSla(env, { growthStore, emailStore, now = Date.now() }) {
  if (!growthStore) throw new Error('Growth automation store is required.');
  if (String(env.GROWTH_NOTIFICATIONS_ENABLED || '').toLowerCase() !== 'true') {
    await growthStore.setHealth('social_sla', { status: 'paused', message: 'Owner alerts remain disabled until pilot authorization.' });
    return { checked: 0, reminders: 0, breaches: 0, paused: true };
  }
  const inquiries = await growthStore.listOpenInquiries(250);
  const summary = { checked: inquiries.length, reminders: 0, breaches: 0, paused: false };
  for (const inquiry of inquiries) {
    if (inquiry.claimedAt) continue;
    const ageMinutes = GROWTH_CLIENT.claimSlaBasis === 'staffed_hours'
      ? staffedMinutesElapsed(inquiry.createdAt, now, GROWTH_CLIENT.sla.inbound_breach_minutes)
      : (now - new Date(inquiry.createdAt).getTime()) / 60000;
    if (ageMinutes >= GROWTH_CLIENT.sla.inbound_breach_minutes && !inquiry.slaBreachedAt) {
      if (await growthStore.markSlaMilestone(inquiry.id, 'breach30', new Date(now).toISOString())) {
        await sendGrowthOwnerAlert({ env, store: emailStore, inquiry, milestone: 'breach30' });
        summary.breaches += 1;
      }
      continue;
    }
    if (ageMinutes >= GROWTH_CLIENT.sla.inbound_reminder_minutes && !inquiry.reminder15At) {
      if (await growthStore.markSlaMilestone(inquiry.id, 'reminder15', new Date(now).toISOString())) {
        await sendGrowthOwnerAlert({ env, store: emailStore, inquiry, milestone: 'reminder15' });
        summary.reminders += 1;
      }
    }
  }
  await growthStore.setHealth('social_sla', {
    status: 'healthy',
    message: `Checked ${summary.checked} open inquiries; ${summary.breaches} current breach alerts.`,
    lastSuccessAt: new Date(now).toISOString()
  });
  return summary;
}
