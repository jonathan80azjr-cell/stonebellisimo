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

export function markImpressionOnce(seen, key) {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}
