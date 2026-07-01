export const BUSINESS_INFO = {
  name: 'Stone Bellisimo LLC',
  website: 'https://stonebellisimollc.com',
  logoUrl: 'https://stonebellisimollc.com/assets/img/logo-280.png',
  officePhone: '201.553.1919',
  officePhoneHref: '+12015531919',
  bellaPhone: '551.292.8353',
  bellaPhoneHref: '+15512928353',
  ownerPhone: '201.281.6423',
  ownerPhoneHref: '+12012816423',
  salesPhone: '201.443.7405',
  salesPhoneHref: '+12014437405',
  email: 'cesaryunda@hotmail.com',
  showroom: '618 23rd Street, Union City, NJ 07087'
};

const COLORS = {
  ink: '#171614',
  muted: '#6f6b63',
  cream: '#faf9f4',
  sand: '#fcfbf8',
  gold: '#b39158',
  goldDark: '#967744',
  goldPale: '#f4eedf',
  border: '#e7dfd2'
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeBaseUrl(baseUrl) {
  try {
    return new URL(baseUrl || BUSINESS_INFO.website).origin;
  } catch (error) {
    return BUSINESS_INFO.website;
  }
}

function telHref(phone) {
  return `tel:${phone}`;
}

function mailtoHref(email) {
  return `mailto:${email}`;
}

function nl2br(value = '') {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function summaryRows(lead) {
  const rows = [
    ['Project type', lead.projectType],
    ['Material', lead.material],
    ['Phone', lead.phone],
    ['Email', lead.email],
    ['Message', lead.message]
  ].filter(([, value]) => value && value !== 'Not specified' && value !== 'None');

  if (!rows.length) return '';

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:24px 0 4px;border:1px solid ${COLORS.border};border-radius:12px;overflow:hidden;">
      ${rows.map(([label, value]) => `
        <tr>
          <td style="padding:13px 16px;background:${COLORS.sand};border-bottom:1px solid ${COLORS.border};font:600 13px Arial,sans-serif;color:${COLORS.ink};width:138px;vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:13px 16px;border-bottom:1px solid ${COLORS.border};font:400 14px/1.55 Arial,sans-serif;color:${COLORS.muted};vertical-align:top;">${label === 'Message' ? nl2br(value) : escapeHtml(value)}</td>
        </tr>
      `).join('')}
    </table>
  `;
}

function contactGridHtml() {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:24px;">
      <tr>
        <td style="padding:14px 0;border-top:1px solid ${COLORS.border};font:600 13px Arial,sans-serif;color:${COLORS.ink};">Office</td>
        <td align="right" style="padding:14px 0;border-top:1px solid ${COLORS.border};font:400 13px Arial,sans-serif;color:${COLORS.muted};"><a href="${telHref(BUSINESS_INFO.officePhoneHref)}" style="color:${COLORS.goldDark};text-decoration:none;">${BUSINESS_INFO.officePhone}</a></td>
      </tr>
      <tr>
        <td style="padding:14px 0;border-top:1px solid ${COLORS.border};font:600 13px Arial,sans-serif;color:${COLORS.ink};">Bella AI Voice Agent</td>
        <td align="right" style="padding:14px 0;border-top:1px solid ${COLORS.border};font:400 13px Arial,sans-serif;color:${COLORS.muted};"><a href="${telHref(BUSINESS_INFO.bellaPhoneHref)}" style="color:${COLORS.goldDark};text-decoration:none;">${BUSINESS_INFO.bellaPhone}</a></td>
      </tr>
      <tr>
        <td style="padding:14px 0;border-top:1px solid ${COLORS.border};font:600 13px Arial,sans-serif;color:${COLORS.ink};">Email</td>
        <td align="right" style="padding:14px 0;border-top:1px solid ${COLORS.border};font:400 13px Arial,sans-serif;color:${COLORS.muted};"><a href="${mailtoHref(BUSINESS_INFO.email)}" style="color:${COLORS.goldDark};text-decoration:none;">${BUSINESS_INFO.email}</a></td>
      </tr>
      <tr>
        <td style="padding:14px 0;border-top:1px solid ${COLORS.border};font:600 13px Arial,sans-serif;color:${COLORS.ink};">Showroom</td>
        <td align="right" style="padding:14px 0;border-top:1px solid ${COLORS.border};font:400 13px/1.5 Arial,sans-serif;color:${COLORS.muted};">${BUSINESS_INFO.showroom}</td>
      </tr>
    </table>
  `;
}

function emailShell({ preheader, eyebrow, title, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.cream};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.cream};border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:28px 14px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;border-collapse:collapse;background:#ffffff;border:1px solid ${COLORS.border};border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:30px 34px 22px;background:${COLORS.ink};">
              <img src="${BUSINESS_INFO.logoUrl}" width="140" alt="Stone Bellisimo LLC" style="display:block;width:140px;height:auto;filter:brightness(0) invert(1);">
              <div style="margin-top:22px;font:700 11px Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:${COLORS.gold};">${escapeHtml(eyebrow)}</div>
              <h1 style="margin:10px 0 0;font:400 34px/1.08 Georgia,serif;color:#ffffff;">${escapeHtml(title)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 34px 34px;">
              ${bodyHtml}
            </td>
          </tr>
        </table>
        <div style="max-width:640px;margin:16px auto 0;font:400 12px/1.6 Arial,sans-serif;color:${COLORS.muted};">
          Stone Bellisimo LLC - ${BUSINESS_INFO.showroom}<br>
          <a href="${BUSINESS_INFO.website}" style="color:${COLORS.goldDark};text-decoration:none;">${BUSINESS_INFO.website}</a>
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function renderImmediateConfirmationEmail({ lead }) {
  const customerName = lead.customerName || `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'there';
  const subject = 'We received your Stone Bellisimo request';
  const bodyHtml = `
    <p style="margin:0 0 16px;font:400 16px/1.75 Arial,sans-serif;color:${COLORS.ink};">Hi ${escapeHtml(customerName)}, thank you for reaching out to Stone Bellisimo. We received your project request and our team will review it shortly. Cesar, Cristian, or Bella may contact you to help schedule your free estimate and answer any questions.</p>
    <p style="margin:0;font:400 15px/1.75 Arial,sans-serif;color:${COLORS.muted};">We are a family-owned stone fabrication team specializing in quartz, granite, marble, quartzite, porcelain, and custom countertop work throughout Union City and nearby New Jersey communities.</p>
    ${summaryRows(lead)}
    <div style="margin-top:26px;padding:22px;border-radius:14px;background:${COLORS.goldPale};border:1px solid ${COLORS.border};">
      <div style="font:600 14px Arial,sans-serif;color:${COLORS.ink};margin-bottom:8px;">Need help sooner?</div>
      <div style="font:400 14px/1.65 Arial,sans-serif;color:${COLORS.muted};">Call the office, reach Bella anytime, email Cesar, or visit the Union City showroom.</div>
      ${contactGridHtml()}
    </div>
  `;

  const text = [
    `Hi ${customerName},`,
    '',
    'Thank you for reaching out to Stone Bellisimo. We received your project request and our team will review it shortly. Cesar, Cristian, or Bella may contact you to help schedule your free estimate and answer any questions.',
    '',
    'Project summary:',
    lead.projectType ? `Project type: ${lead.projectType}` : '',
    lead.material ? `Material: ${lead.material}` : '',
    lead.phone ? `Phone: ${lead.phone}` : '',
    lead.email ? `Email: ${lead.email}` : '',
    lead.message ? `Message: ${lead.message}` : '',
    '',
    'Contact options:',
    `Office: ${BUSINESS_INFO.officePhone}`,
    `Bella AI Voice Agent: ${BUSINESS_INFO.bellaPhone}`,
    `Email: ${BUSINESS_INFO.email}`,
    `Showroom: ${BUSINESS_INFO.showroom}`,
    '',
    'Thank you,',
    BUSINESS_INFO.name
  ].filter(line => line !== '').join('\n');

  return {
    subject,
    html: emailShell({
      preheader: 'Stone Bellisimo received your project request and will be in touch shortly.',
      eyebrow: 'Request received',
      title: subject,
      bodyHtml
    }),
    text
  };
}

export function renderFeedbackRequestEmail({ lead, token, baseUrl }) {
  const customerName = lead.customerName || `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'there';
  const origin = normalizeBaseUrl(baseUrl);
  const subject = 'How was your experience with Stone Bellisimo?';
  const ratingButtons = [1, 2, 3, 4, 5].map(rating => {
    const href = new URL('/feedback', origin);
    href.searchParams.set('token', token);
    href.searchParams.set('rating', String(rating));
    return `<td align="center" style="padding:4px;"><a href="${href.toString()}" style="display:inline-block;width:54px;padding:15px 0;border-radius:999px;background:${COLORS.ink};color:#ffffff;font:700 18px Arial,sans-serif;text-decoration:none;border:1px solid ${COLORS.ink};">${rating}</a></td>`;
  }).join('');

  const bodyHtml = `
    <p style="margin:0 0 16px;font:400 16px/1.75 Arial,sans-serif;color:${COLORS.ink};">Hi ${escapeHtml(customerName)},</p>
    <p style="margin:0 0 16px;font:400 15px/1.75 Arial,sans-serif;color:${COLORS.muted};">This is Stone Bellisimo checking in. Thank you for reaching out to us about your project.</p>
    <p style="margin:0 0 22px;font:400 15px/1.75 Arial,sans-serif;color:${COLORS.muted};">Whether we completed your project, were unable to meet your needs, or you did not receive the response you were looking for, your feedback helps us improve how we serve every homeowner, designer, and contractor who contacts us.</p>
    <div style="margin:24px 0;padding:24px;border-radius:14px;background:${COLORS.goldPale};border:1px solid ${COLORS.border};text-align:center;">
      <div style="font:600 14px Arial,sans-serif;color:${COLORS.ink};margin-bottom:14px;">How would you rate your experience?</div>
      <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 auto;">
        <tr>${ratingButtons}</tr>
      </table>
      <p style="margin:16px 0 0;font:400 13px/1.6 Arial,sans-serif;color:${COLORS.muted};">You can click a rating above, or simply reply to this email with a number from 1 to 5 and any comments.</p>
    </div>
    <p style="margin:0;font:400 15px/1.75 Arial,sans-serif;color:${COLORS.muted};">Thank you for helping a family-owned stone shop keep improving.</p>
    ${contactGridHtml()}
  `;

  const ratingLinks = [1, 2, 3, 4, 5].map(rating => {
    const href = new URL('/feedback', origin);
    href.searchParams.set('token', token);
    href.searchParams.set('rating', String(rating));
    return `${rating}: ${href.toString()}`;
  }).join('\n');

  const text = [
    `Hi ${customerName},`,
    '',
    'This is Stone Bellisimo checking in. Thank you for reaching out to us about your project.',
    '',
    'We wanted to ask for a quick piece of feedback about your experience. Whether we completed your project, were unable to meet your needs, or you did not receive the response you were looking for, your feedback would really help us improve.',
    '',
    'Please choose a rating from 1 to 5:',
    ratingLinks,
    '',
    'You can click a rating above, or simply reply to this email with a number from 1 to 5 and any comments.',
    '',
    'Thank you,',
    BUSINESS_INFO.name,
    '',
    `Office: ${BUSINESS_INFO.officePhone}`,
    `Bella AI Voice Agent: ${BUSINESS_INFO.bellaPhone}`,
    `Email: ${BUSINESS_INFO.email}`,
    `Showroom: ${BUSINESS_INFO.showroom}`
  ].join('\n');

  return {
    subject,
    html: emailShell({
      preheader: 'Share a quick 1 to 5 rating for your Stone Bellisimo experience.',
      eyebrow: 'A quick favor',
      title: subject,
      bodyHtml
    }),
    text
  };
}

export function renderInternalFeedbackNotificationEmail({ lead, feedback, baseUrl }) {
  const ratingLabel = feedback.rating ? `${feedback.rating}/5` : 'Needs review';
  const subject = feedback.rating
    ? `New Stone Bellisimo feedback: ${ratingLabel}`
    : 'Stone Bellisimo feedback reply needs review';
  const bodyHtml = `
    <p style="margin:0 0 16px;font:400 16px/1.75 Arial,sans-serif;color:${COLORS.ink};">A customer submitted feedback through ${escapeHtml(feedback.source || 'the feedback system')}.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${COLORS.border};border-radius:12px;overflow:hidden;">
      ${[
        ['Customer', lead.customerName],
        ['Rating', ratingLabel],
        ['Phone', lead.phone],
        ['Email', lead.email],
        ['Project type', lead.projectType],
        ['Material', lead.material],
        ['Comments', feedback.comment || 'No comment provided.']
      ].map(([label, value]) => `
        <tr>
          <td style="padding:12px 14px;background:${COLORS.sand};border-bottom:1px solid ${COLORS.border};font:600 13px Arial,sans-serif;color:${COLORS.ink};width:132px;vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:12px 14px;border-bottom:1px solid ${COLORS.border};font:400 14px/1.55 Arial,sans-serif;color:${COLORS.muted};vertical-align:top;">${nl2br(value || '')}</td>
        </tr>
      `).join('')}
    </table>
    <p style="margin:18px 0 0;font:400 13px/1.65 Arial,sans-serif;color:${COLORS.muted};">Source: ${escapeHtml(feedback.source || 'unknown')} - ${escapeHtml(feedback.receivedAt || '')}</p>
  `;

  const text = [
    subject,
    '',
    `Customer: ${lead.customerName || ''}`,
    `Rating: ${ratingLabel}`,
    `Phone: ${lead.phone || ''}`,
    `Email: ${lead.email || ''}`,
    `Project type: ${lead.projectType || ''}`,
    `Material: ${lead.material || ''}`,
    '',
    `Comments: ${feedback.comment || 'No comment provided.'}`,
    '',
    `Source: ${feedback.source || 'unknown'}`,
    `Received: ${feedback.receivedAt || ''}`,
    `Site: ${normalizeBaseUrl(baseUrl)}`
  ].join('\n');

  return {
    subject,
    html: emailShell({
      preheader: subject,
      eyebrow: 'Customer feedback',
      title: subject,
      bodyHtml
    }),
    text
  };
}
