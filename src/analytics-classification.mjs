function clean(value, max = 160) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

export function slugAnalyticsValue(value) {
  return clean(value, 90).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cta';
}

export function classifyCta({ href = '', onclick = '', explicitType = '', label = '', dataCta = '' } = {}) {
  let type = clean(explicitType, 40).toLowerCase() || 'other';
  let targetLabel = '';
  if (!explicitType && href.startsWith('tel:')) type = 'phone';
  else if (!explicitType && href.startsWith('sms:')) type = 'sms';
  else if (!explicitType && href.startsWith('mailto:')) type = 'email';
  else if (!explicitType && /review/i.test(`${href} ${label}`)) type = 'review';
  else if (!explicitType && /maps\.google|google\.com\/maps|directions/i.test(href)) type = 'map';
  else if (!explicitType && /openWizard|estimate/i.test(`${onclick} ${dataCta} ${label}`)) type = 'estimate';
  else if (!explicitType && /(instagram|facebook|houzz|youtube|tiktok|pinterest)\.com/i.test(href)) type = 'social';
  else if (!explicitType && /contact-us/i.test(href)) type = 'contact';
  else if (!explicitType && /areas-we-serve|service-area/i.test(href)) type = 'service_area';

  if (['phone', 'sms'].includes(type)) targetLabel = href.split(':')[1]?.replace(/[^+\d]/g, '') || '';
  else if (type === 'email') targetLabel = href.split(':')[1]?.split('?')[0] || '';
  else if (type === 'map') targetLabel = 'Stone Bellisimo showroom';
  return { type, targetLabel: clean(targetLabel, 120) };
}

// A desktop visitor who dials from a handset never touches the tel: link, so
// the only observable trace is the number sitting on screen while they stop
// interacting with the page. These thresholds are shared so the browser timer
// and the server validator can never drift apart and admit signals the client
// would not have produced.
export const PHONE_DWELL = Object.freeze({
  // Floor for a signal that ended in a handoff (window blur, tab hidden, idle).
  minMs: 4000,
  // Floor for a signal that only ended because the number scrolled away — the
  // visitor was still driving the page, so it needs more time to mean anything.
  activeMs: 8000,
  // No pointer, key, or scroll for this long ends the dwell. Without it an
  // abandoned tab left on the contact section reads as an hour-long call.
  idleMs: 45000,
  maxMs: 600000,
  tickMs: 1000
});

// Ordered strongest to weakest as evidence that the visitor left the page to dial.
export const PHONE_DWELL_REASONS = Object.freeze(['blur', 'hidden', 'idle', 'dwell']);

export function markImpressionOnce(seen, key) {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}
