import { initializeApp } from 'firebase/app';
import {
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from 'firebase/auth';

const $ = id => document.getElementById(id);
const LEAD_DESIGNATIONS = Object.freeze([
  ['', 'Auto-detected'],
  ['new', 'New'],
  ['progress_completed', 'Progress Completed'],
  ['needs_feedback', 'Needs Feedback'],
  ['feedback_sent', 'Feedback Sent'],
  ['feedback_received', 'Feedback Received'],
  ['email_issue', 'Email Issue']
]);
const state = {
  auth: null, user: null, leads: [], selected: null, nextCursor: null, leadTotal: 0,
  rangeDays: 30, trafficClass: 'production', growthLoaded: false, growthContent: [],
  growthInquiries: [], growthHealth: [], growthControls: null, growthConfig: null
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function number(value) { return new Intl.NumberFormat().format(Number(value || 0)); }
function percent(value) { return `${(Number(value || 0) * 100).toFixed(1)}%`; }
function seconds(milliseconds) { return `${Math.round(Number(milliseconds || 0) / 1000)}s`; }
function moneyFromCents(value) {
  if (value === null || value === undefined || value === '') return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) / 100);
}

function leadDesignation(lead) {
  const explicit = String(lead.designation || '').toLowerCase();
  if (LEAD_DESIGNATIONS.some(([value]) => value && value === explicit)) return explicit;
  if (lead.feedbackEmailLastError || lead.emailIssue) return 'email_issue';
  if (['received', 'unparsed'].includes(lead.feedbackStatus)) return 'feedback_received';
  if (lead.feedbackEmailSentAt) return 'feedback_sent';
  if (lead.businessStatus === 'completed') return 'progress_completed';
  if (['pending', 'sending'].includes(lead.feedbackStatus) && lead.feedbackEmailDueAt && !lead.feedbackEmailSentAt) return 'needs_feedback';
  return 'new';
}

function leadDesignationLabel(value) {
  return LEAD_DESIGNATIONS.find(([key]) => key === value)?.[1] || 'New';
}

function leadMatchesFilter(lead, filter) {
  if (filter === 'all') return true;
  if (['new', 'progress_completed', 'needs_feedback', 'feedback_sent', 'feedback_received', 'email_issue'].includes(filter)) return leadDesignation(lead) === filter;
  return [lead.businessStatus, lead.salesStatus].includes(filter) || (filter === 'email_failed' && Boolean(lead.feedbackEmailLastError));
}

async function api(path, options = {}) {
  if (!state.user) throw new Error('Sign in is required.');
  const token = await state.user.getIdToken();
  const headers = { authorization: `Bearer ${token}`, ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers['content-type']) headers['content-type'] = 'application/json';
  const response = await fetch(path, {
    ...options,
    headers
  });
  const data = await response.json().catch(() => ({ success: false, message: 'The server returned an invalid response.' }));
  if (!response.ok || data.success === false) {
    if (response.status === 401) await signOut(state.auth).catch(() => {});
    throw new Error(data.message || 'Request failed.');
  }
  return data;
}

function setLoading(container, message = 'Loading…') {
  container.innerHTML = `<div class="loading-state"><span class="spinner" aria-hidden="true"></span><p>${escapeHtml(message)}</p></div>`;
}

function showToast(message, type = 'good') {
  const toast = $('toast');
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => toast.classList.remove('show'), 4200);
}

function showView(name) {
  document.querySelectorAll('[data-view]').forEach(view => view.hidden = view.dataset.view !== name);
  document.querySelectorAll('[data-tab]').forEach(tab => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  const headings = {
    leads: ['Leads & follow-up', 'Client pipeline'],
    analytics: ['Website analytics', 'Engagement & lead intent'],
    growth: ['Google & social growth', 'Reviewed automation pilot']
  };
  $('pageHeading').textContent = headings[name]?.[0] || 'Dashboard';
  $('pageEyebrow').textContent = headings[name]?.[1] || 'Stone Bellisimo';
  if (name === 'analytics' && !$('analyticsContent').dataset.loaded) loadAnalytics();
  if (name === 'growth' && !state.growthLoaded) loadGrowth();
}

function leadStatus(lead) {
  const designation = leadDesignation(lead);
  const tone = designation === 'email_issue' ? 'danger' : ['progress_completed', 'feedback_received'].includes(designation) ? 'success' : ['needs_feedback', 'feedback_sent'].includes(designation) ? 'warm' : 'neutral';
  return [leadDesignationLabel(designation), tone];
}

function renderLeadList(append = false) {
  const list = $('leadList');
  const markup = state.leads.map(lead => {
    const [label, tone] = leadStatus(lead);
    return `<button class="lead-row ${state.selected === lead.id ? 'active' : ''}" data-lead-id="${escapeHtml(lead.id)}" type="button">
      <span class="lead-avatar">${escapeHtml((lead.customerName || '?').split(/\s+/).map(part => part[0]).join('').slice(0, 2))}</span>
      <span class="lead-copy"><strong>${escapeHtml(lead.customerName || 'Unnamed lead')}</strong><small>${escapeHtml(lead.projectType || lead.email || 'Website inquiry')}</small><span class="status-pill ${tone}">${label}</span></span>
      <time>${escapeHtml(formatDate(lead.submittedAt).split(',')[0])}</time>
    </button>`;
  }).join('');
  list.innerHTML = markup || '<div class="empty-state"><h3>No leads found</h3><p>Try a different search or status filter.</p></div>';
  list.querySelectorAll('[data-lead-id]').forEach(button => button.addEventListener('click', () => selectLead(button.dataset.leadId)));
  $('loadMoreLeads').hidden = !state.nextCursor;
  $('loadMoreLeads').dataset.cursor = state.nextCursor || '';
}

async function loadLeads({ append = false } = {}) {
  if (!append) setLoading($('leadList'), 'Loading client inquiries…');
  const params = new URLSearchParams({ search: $('leadSearch').value.trim(), status: $('leadStatus').value, limit: '40' });
  if (append && state.nextCursor) params.set('cursor', state.nextCursor);
  try {
    const data = await api(`/api/admin/leads?${params}`);
    state.leads = append ? [...state.leads, ...(data.leads || [])] : (data.leads || []);
    state.nextCursor = data.nextCursor || null;
    state.leadTotal = Number(data.count || 0);
    $('leadCount').textContent = `${number(data.count)} total lead${data.count === 1 ? '' : 's'}`;
    renderLeadList(append);
    renderLeadStats(data.count);
    if (!append && state.leads[0] && !state.selected) await selectLead(state.leads[0].id);
    if (!state.leads.length) renderEmptyLead();
  } catch (error) {
    $('leadList').innerHTML = `<div class="error-state"><h3>Leads could not load</h3><p>${escapeHtml(error.message)}</p><button class="button secondary" data-retry-leads>Try again</button></div>`;
    $('[data-retry-leads]')?.addEventListener('click', () => loadLeads());
  }
}

function renderLeadStats(total) {
  const qualified = state.leads.filter(lead => ['Qualified', 'Estimate Scheduled', 'Job Completed', 'Invoice Collected', 'Repeat / Review'].includes(lead.salesStatus)).length;
  const completed = state.leads.filter(lead => ['Job Completed', 'Invoice Collected', 'Repeat / Review'].includes(lead.salesStatus) || (!lead.salesStatus && lead.businessStatus === 'completed')).length;
  const biteSitesShare = state.leads
    .filter(lead => lead.businessStatus === 'completed')
    .reduce((sum, lead) => sum + Number(lead.biteSitesShareCents || 0), 0);
  $('leadStats').innerHTML = [
    ['Total leads', total, 'All captured inquiries'],
    ['Qualified', qualified, 'Staff-confirmed among those showing'],
    ['Jobs completed', completed, 'Completion-based review trigger'],
    ['Bite Sites share', moneyFromCents(biteSitesShare), '10% of completed charges showing']
  ].map(([label, value, caption]) => `<article class="metric-card"><span>${label}</span><strong>${typeof value === 'string' ? escapeHtml(value) : number(value)}</strong><small>${caption}</small></article>`).join('');
}

function renderEmptyLead() {
  $('leadDetail').innerHTML = '<div class="empty-state large"><span class="empty-mark">SB</span><h3>Select a lead</h3><p>Client details, feedback, and email history will appear here.</p></div>';
}

async function selectLead(id) {
  state.selected = id;
  renderLeadList();
  setLoading($('leadDetail'), 'Loading lead details…');
  try {
    const data = await api(`/api/admin/leads/${encodeURIComponent(id)}`);
    renderLeadDetail(data);
    $('emailRecipient').textContent = data.lead.email || 'No email address';
  } catch (error) {
    $('leadDetail').innerHTML = `<div class="error-state"><h3>Lead could not load</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function detailRows(lead) {
  return [
    ['Email', lead.email], ['Phone', lead.phone], ['Submitted', formatDate(lead.submittedAt)],
    ['Project', lead.projectType], ['Material', lead.material], ['Source', lead.source],
    ['Source platform', lead.sourcePlatform], ['Source content', lead.sourceContentId],
    ['Consent', lead.consentState ? `${lead.consentState}${lead.consentVersion ? ` · ${lead.consentVersion}` : ''}` : 'Not recorded'],
    ['HighLevel contact', lead.highLevelContactId], ['HighLevel opportunity', lead.highLevelOpportunityId],
    ['Confirmation', lead.immediateEmailSentAt ? formatDate(lead.immediateEmailSentAt) : 'Not sent'],
    ['Feedback due', formatDate(lead.feedbackEmailDueAt)],
    ['Feedback status', lead.feedbackStatus || 'Pending'], ['Message', lead.message]
  ];
}

function chargeInputValue(cents) {
  return cents === null || cents === undefined ? '' : (Number(cents) / 100).toFixed(2);
}

function previewBiteSitesShare() {
  const output = $('biteSitesSharePreview');
  if (!output) return;
  const raw = $('clientCharge').value.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(?:\.\d{0,2})?$/.test(raw)) {
    output.textContent = '—';
    return;
  }
  const cents = Math.round(Number(raw) * 100);
  output.textContent = moneyFromCents(Math.round(cents * 0.1));
}

async function saveBusinessUpdate(detail) {
  const button = $('saveBusiness');
  button.disabled = true;
  $('businessSaveStatus').textContent = 'Saving…';
  try {
    const data = await api(`/api/admin/leads/${encodeURIComponent(state.selected)}`, {
      method: 'PATCH',
      body: JSON.stringify({ salesStatus: $('salesStatus').value, designation: $('leadDesignation').value, businessStatus: detail.lead.businessStatus || 'new', clientCharge: $('clientCharge').value })
    });
    detail.lead = data.lead;
    if (!leadMatchesFilter(data.lead, $('leadStatus').value)) {
      $('leadStatus').value = 'all';
    }
    await loadLeads();
    renderLeadDetail(detail);
    showToast(`Lead updated. Bite Sites share: ${moneyFromCents(data.lead.biteSitesShareCents)}.`);
  } catch (error) {
    $('businessSaveStatus').textContent = error.message;
    showToast(error.message, 'bad');
  } finally {
    if ($('saveBusiness')) $('saveBusiness').disabled = false;
  }
}

function renderLeadDetail(data) {
  const lead = data.lead;
  const [status, tone] = leadStatus(lead);
  const eventRows = [
    ...(data.emailEvents || []).map(item => ({ title: `${item.eventType || 'Email'} · ${item.status || 'recorded'}`, date: item.createdAt, text: item.subject || item.error || item.postmarkMessageId })),
    ...(data.deliveryEvents || []).map(item => ({ title: `Postmark · ${item.eventType || 'delivery'}`, date: item.receivedAt, text: item.recipient || item.messageId })),
    ...(data.inboundEvents || []).map(item => ({ title: `Inbound reply · ${item.status || 'received'}`, date: item.receivedAt, text: item.subject || item.fromEmail }))
  ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  $('leadDetail').innerHTML = `<div class="detail-head"><div><span class="eyebrow">Lead profile</span><h2>${escapeHtml(lead.customerName || 'Unnamed lead')}</h2><span class="status-pill ${tone}">${status}</span></div><div class="detail-actions">${lead.phone ? `<a class="icon-button" href="tel:${escapeHtml(lead.phone)}">Call</a>` : ''}<button class="icon-button" id="composeEmail" type="button">Follow up</button></div></div>
    <section class="subsection business-panel"><div class="section-heading"><div><span class="eyebrow">Project outcome</span><h3>Qualified pipeline &amp; revenue</h3><p>Staff can assign a targeting designation independently from the sales stage. Job Completed starts the honest Google review request; Invoice Collected requires the client charge.</p></div></div><div class="business-fields"><label>Lead designation<select id="leadDesignation">${LEAD_DESIGNATIONS.map(([value, label]) => `<option value="${value}" ${value === (lead.designation || '') ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Growth outcome<select id="salesStatus"><option value="New Lead" ${lead.salesStatus === 'New Lead' ? 'selected' : ''}>New Lead</option><option value="Qualified" ${lead.salesStatus === 'Qualified' ? 'selected' : ''}>Qualified</option><option value="Estimate Scheduled" ${lead.salesStatus === 'Estimate Scheduled' ? 'selected' : ''}>Estimate Scheduled</option><option value="Job Completed" ${lead.salesStatus === 'Job Completed' ? 'selected' : ''}>Job Completed</option><option value="Invoice Collected" ${lead.salesStatus === 'Invoice Collected' ? 'selected' : ''}>Invoice Collected</option><option value="Repeat / Review" ${lead.salesStatus === 'Repeat / Review' ? 'selected' : ''}>Repeat / Review</option><option value="Lost" ${lead.salesStatus === 'Lost' ? 'selected' : ''}>Lost</option><option value="" ${!lead.salesStatus ? 'selected' : ''}>Unclassified legacy record</option></select></label><label>Amount charged to client<div class="currency-input"><span>$</span><input id="clientCharge" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${escapeHtml(chargeInputValue(lead.clientChargeCents))}"></div></label><div class="share-card"><span>Bite Sites · 10%</span><strong id="biteSitesSharePreview">${escapeHtml(moneyFromCents(lead.biteSitesShareCents))}</strong></div></div><div class="business-actions"><button id="saveBusiness" class="button primary" type="button">Save project update</button><span id="businessSaveStatus">${lead.completedAt ? `Completed ${escapeHtml(formatDate(lead.completedAt))}` : ''}</span></div></section>
    <dl class="detail-grid">${detailRows(lead).map(([label, value]) => `<div class="detail-item ${label === 'Message' ? 'wide' : ''}"><dt>${label}</dt><dd>${escapeHtml(value || '—')}</dd></div>`).join('')}</dl>
    <section class="subsection"><div class="section-heading"><div><span class="eyebrow">Customer voice</span><h3>Feedback</h3></div></div>${(data.feedback || []).length ? `<div class="timeline">${data.feedback.map(item => `<article><span class="timeline-dot"></span><div><strong>${item.rating ? `${item.rating}/5` : 'Unrated'} · ${escapeHtml(item.source || 'Feedback')}</strong><time>${escapeHtml(formatDate(item.receivedAt))}</time><p>${escapeHtml(item.comment || 'No written comment.')}</p></div></article>`).join('')}</div>` : '<p class="quiet">No feedback has been received yet.</p>'}</section>
    <section class="subsection"><div class="section-heading"><div><span class="eyebrow">Communication</span><h3>Email history</h3></div></div>${eventRows.length ? `<div class="timeline">${eventRows.map(item => `<article><span class="timeline-dot"></span><div><strong>${escapeHtml(item.title)}</strong><time>${escapeHtml(formatDate(item.date))}</time><p>${escapeHtml(item.text || 'No additional details.')}</p></div></article>`).join('')}</div>` : '<p class="quiet">No email events recorded.</p>'}</section>`;
  $('composeEmail').addEventListener('click', () => {
    $('emailPanel').hidden = false;
    previewEmail();
  });
  $('clientCharge').addEventListener('input', previewBiteSitesShare);
  $('saveBusiness').addEventListener('click', () => saveBusinessUpdate(data));
}

function composerPayload() {
  return { leadId: state.selected, template: $('emailTemplate').value, subject: $('emailSubject').value, message: $('emailMessage').value, ctaLabel: $('emailCtaLabel').value, ctaUrl: $('emailCtaUrl').value };
}

function updateComposer() {
  const custom = $('emailTemplate').value === 'custom';
  ['emailSubject', 'emailMessage', 'emailCtaLabel', 'emailCtaUrl'].forEach(id => $(id).disabled = !custom);
}

async function previewEmail() {
  if (!state.selected) return;
  $('emailStatus').textContent = 'Rendering preview…';
  try {
    const data = await api('/api/admin/email/preview', { method: 'POST', body: JSON.stringify(composerPayload()) });
    $('emailPreview').srcdoc = data.html;
    $('emailStatus').textContent = `Ready for ${data.to}`;
  } catch (error) { $('emailStatus').textContent = error.message; }
}

async function sendEmail() {
  if (!state.selected || !confirm('Send this email to the selected client?')) return;
  $('sendEmail').disabled = true;
  $('emailStatus').textContent = 'Sending securely…';
  try {
    const data = await api('/api/admin/email/send', { method: 'POST', body: JSON.stringify(composerPayload()) });
    showToast(data.mock ? 'Mock email recorded.' : 'Email sent successfully.');
    await selectLead(state.selected);
    await loadLeads();
  } catch (error) { showToast(error.message, 'bad'); }
  finally { $('sendEmail').disabled = false; }
}

function iso(date) { return date.toISOString().slice(0, 10); }
function selectedRange() {
  const end = new Date();
  const start = new Date(end.getTime() - (state.rangeDays - 1) * 86400000);
  return { start: iso(start), end: iso(end) };
}

function delta(current, previous) {
  if (!previous) return current ? '<span class="delta up">New</span>' : '<span class="delta flat">—</span>';
  const change = (current - previous) / Math.abs(previous);
  const tone = change > 0.001 ? 'up' : change < -0.001 ? 'down' : 'flat';
  return `<span class="delta ${tone}">${change > 0 ? '+' : ''}${(change * 100).toFixed(0)}% vs prior</span>`;
}

function analyticsCard(label, value, current, previous, note) {
  return `<article class="metric-card analytics-metric"><span>${label}</span><strong>${value}</strong>${delta(current, previous)}<small>${note}</small></article>`;
}

function lineChart(rows) {
  if (!rows.length) return '<div class="chart-empty">No activity in this date range yet.</div>';
  const width = 900, height = 250, pad = 26;
  const max = Math.max(1, ...rows.flatMap(row => [Number(row.ctaImpressions || 0), Number(row.ctaClicks || 0)]));
  const point = (row, index, field) => `${pad + index * ((width - pad * 2) / Math.max(1, rows.length - 1))},${height - pad - (Number(row[field] || 0) / max) * (height - pad * 2)}`;
  const impressions = rows.map((row, index) => point(row, index, 'ctaImpressions')).join(' ');
  const clicks = rows.map((row, index) => point(row, index, 'ctaClicks')).join(' ');
  return `<div class="chart-wrap"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily CTA impressions and clicks"><defs><linearGradient id="goldFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8955c" stop-opacity=".28"/><stop offset="1" stop-color="#b8955c" stop-opacity="0"/></linearGradient></defs><line x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}" class="axis"/><polyline points="${impressions}" class="line impressions"/><polyline points="${clicks}" class="line clicks"/>${rows.map((row, index) => `<circle cx="${point(row,index,'ctaClicks').split(',')[0]}" cy="${point(row,index,'ctaClicks').split(',')[1]}" r="4" class="click-dot"><title>${escapeHtml(row.date)}: ${number(row.ctaClicks)} clicks, ${number(row.ctaImpressions)} impressions</title></circle>`).join('')}</svg><div class="chart-legend"><span><i class="gold"></i>Impressions</span><span><i class="ink"></i>Clicks</span></div></div>`;
}

function renderCtaTable(rows) {
  if (!rows.length) return '<div class="empty-state"><h3>No CTA activity yet</h3><p>Impressions and clicks will appear as visitors engage with the site.</p></div>';
  return `<div class="table-scroll"><table><thead><tr><th>CTA</th><th>Page / placement</th><th>Type</th><th>Impressions</th><th>Clicks</th><th>CTR</th><th>Unique CTR</th><th>Read &amp; dialed</th></tr></thead><tbody>${rows.slice(0, 30).map(row => `<tr><td><strong>${escapeHtml(row.ctaLabel)}</strong>${row.targetLabel ? `<small>${escapeHtml(row.targetLabel)}</small>` : ''}</td><td>${escapeHtml(row.pagePath)}<small>${escapeHtml(row.placement)}</small></td><td><span class="status-pill neutral">${escapeHtml(row.ctaType)}</span></td><td>${number(row.impressions)}</td><td>${number(row.clicks)}</td><td>${percent(row.ctr)}</td><td>${percent(row.uniqueCtr)}</td><td>${row.dwellSignals ? `${number(row.dwellSignals)}<small>${seconds(row.averageDwellMs)} average</small>` : '—'}</td></tr>`).join('')}</tbody></table></div>`;
}

function breakdown(title, rows) {
  const max = Math.max(1, ...rows.map(row => Number(row.count || 0)));
  return `<article class="breakdown-card"><h3>${title}</h3>${rows.length ? `<ol>${rows.slice(0, 8).map(row => `<li><div><span>${escapeHtml(row.label || row.key)}</span><strong>${number(row.count)}</strong></div><i style="width:${Math.max(3, Number(row.count || 0) / max * 100)}%"></i></li>`).join('')}</ol>` : '<p class="quiet">No data in this range.</p>'}</article>`;
}

function searchTable(title, rows) {
  const firstColumn = title.toLowerCase().includes('queries') ? 'Query' : 'Landing page';
  return `<article class="panel search-table"><div class="section-heading"><div><span class="eyebrow">Google Search</span><h3>${title}</h3></div></div>${rows.length ? `<div class="table-scroll"><table><thead><tr><th>${firstColumn}</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.key)}</td><td>${number(row.clicks)}</td><td>${number(row.impressions)}</td><td>${percent(row.ctr)}</td><td>${Number(row.position || 0).toFixed(1)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="quiet">No Search Console rows imported for this range.</p>'}</article>`;
}

function intentBreakdown(ctas) {
  const types = ['phone', 'map', 'sms', 'email', 'estimate'];
  return types.map(type => ({ type, clicks: ctas.filter(row => row.ctaType === type).reduce((sum, row) => sum + Number(row.clicks || 0), 0) }));
}

const SOCIAL_LABELS = { instagram: 'Instagram', facebook: 'Facebook', x: 'X (Twitter)', pinterest: 'Pinterest', houzz: 'Houzz', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', yelp: 'Yelp', other: 'Other social' };
const SOCIAL_ICONS = { instagram: 'IG', facebook: 'f', x: '𝕏', pinterest: 'P', houzz: 'Hz', tiktok: 'TT', youtube: '▶', linkedin: 'in', yelp: 'Y', other: '•' };

function renderSocialBreakdown(rows) {
  if (!rows.length) return '<p class="quiet">No social profile clicks in this range yet.</p>';
  return rows.map(row => {
    const label = SOCIAL_LABELS[row.platform] || (row.platform ? row.platform.replace(/\b\w/g, character => character.toUpperCase()) : 'Other social');
    const icon = SOCIAL_ICONS[row.platform] || '•';
    return `<article class="intent-card"><span class="intent-icon">${escapeHtml(icon)}</span><div><strong>${number(row.clicks)}</strong><span>${escapeHtml(label)} · ${number(row.impressions)} impressions</span></div></article>`;
  }).join('');
}

function renderTrafficNotice(analytics) {
  const notice = $('trafficNotice');
  if (!notice) return;
  const test = analytics.testTraffic || {};
  const sessions = Number(test.sessions || 0);
  if (analytics.trafficClass === 'production') {
    notice.hidden = !sessions;
    notice.textContent = sessions
      ? `Business traffic only. ${number(sessions)} QA test ${sessions === 1 ? 'session is' : 'sessions are'} excluded from these numbers.`
      : '';
    return;
  }
  notice.hidden = false;
  notice.textContent = sessions
    ? `Including QA test traffic: ${number(sessions)} test ${sessions === 1 ? 'session is' : 'sessions are'} counted below and these totals are not business results.`
    : 'Including QA test traffic. No test sessions were recorded in this range.';
}

// A green tick with no date is what let a broken import look fine for days, so
// the healthy state still states when the data was last refreshed.
function renderSearchHealth(health) {
  const banner = $('searchHealth');
  if (!banner) return;
  if (!health || !health.status) {
    banner.hidden = true;
    return;
  }

  const timestamp = health.lastSuccessAt || health.lastAttemptAt;
  banner.hidden = false;
  banner.dataset.status = health.status;
  banner.textContent = timestamp
    ? `${health.message} Last checked ${new Date(timestamp).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`
    : health.message;
}

function renderAnalytics(analytics, search) {
  const t = analytics.totals, p = analytics.comparison.totals;
  renderTrafficNotice(analytics);
  $('analyticsMetrics').innerHTML = [
    analyticsCard('Sessions', number(t.sessions), t.sessions, p.sessions, 'Anonymous 30-minute visits'),
    analyticsCard('Page views', number(t.pageViews), t.pageViews, p.pageViews, 'Pages viewed across the site'),
    analyticsCard('Estimate submissions', number(t.formSubmissions), t.formSubmissions, p.formSubmissions, 'Server-confirmed requests'),
    analyticsCard('High-intent actions', number(t.highIntentActions), t.highIntentActions, p.highIntentActions, 'Calls, directions, email, text & estimates'),
    analyticsCard('Likely off-site calls', number(t.phoneDwellSessions), t.phoneDwellSessions, p.phoneDwellSessions, 'Desktop sessions that sat on a number, then stopped')
  ].join('');
  $('ctaChart').innerHTML = lineChart(analytics.daily);
  $('ctaSummary').textContent = `${number(t.ctaClicks)} clicks from ${number(t.ctaImpressions)} impressions · ${percent(t.ctr)} raw CTR`;
  $('ctaTable').innerHTML = renderCtaTable(analytics.ctas);
  const intents = intentBreakdown(analytics.ctas);
  $('offlineCallNote').textContent = t.phoneDwellSignals
    ? `${number(t.phoneDwellSessions)} desktop ${t.phoneDwellSessions === 1 ? 'session' : 'sessions'} held a phone number on screen for ${seconds(t.averagePhoneDwellMs)} on average and then went quiet or left the browser, across ${number(t.phoneDwellSignals)} ${t.phoneDwellSignals === 1 ? 'number' : 'numbers'}. Desktop visitors dial from a handset, so these calls leave no click behind — treat this as a floor on interest, not a call count.`
    : 'No desktop visitor lingered on a phone number long enough to suggest they dialled it from another device in this range.';
  $('intentGrid').innerHTML = intents.map(item =>`<article class="intent-card"><span class="intent-icon">${({ phone:'☎',map:'↗',sms:'•••',email:'@',estimate:'◇' })[item.type]}</span><div><strong>${number(item.clicks)}</strong><span>${({ phone:'Phone link clicks',map:'Directions intent',sms:'Text link clicks',email:'Email link clicks',estimate:'Estimate CTA clicks' })[item.type]}</span></div></article>`).join('');
  $('socialGrid').innerHTML = renderSocialBreakdown(analytics.social || []);
  $('galleryFunnel').innerHTML = `<div class="funnel"><div style="--size:100%"><strong>${number(t.gallerySessions)}</strong><span>Gallery-engaged sessions</span></div><div style="--size:${t.gallerySessions ? Math.max(28, t.galleryToIntentRate * 100) : 28}%"><strong>${number(t.galleryToIntentSessions)}</strong><span>Later high-intent actions</span></div></div><p class="funnel-note">${percent(t.galleryToIntentRate)} of gallery-engaged sessions later clicked a phone, map, text, email, or estimate action during the same visit.</p>`;
  $('breakdownGrid').innerHTML = [breakdown('Top landing pages', analytics.breakdowns.page || []), breakdown('Referrers', analytics.breakdowns.referrer || []), breakdown('Campaigns', analytics.breakdowns.campaign || []), breakdown('Devices', analytics.breakdowns.device || [])].join('');

  $('searchMetrics').innerHTML = [
    analyticsCard('Google impressions', number(search.totals.impressions), search.totals.impressions, search.comparison?.totals?.impressions, 'Times this site appeared in Google'),
    analyticsCard('Google clicks', number(search.totals.clicks), search.totals.clicks, search.comparison?.totals?.clicks, 'Visits attributed by Search Console'),
    analyticsCard('Search CTR', percent(search.totals.ctr), search.totals.ctr, search.comparison?.totals?.ctr, 'Clicks divided by impressions'),
    analyticsCard('Average position', Number(search.totals.position || 0).toFixed(1), search.totals.position, search.comparison?.totals?.position, 'Impression-weighted average'),
    analyticsCard('“Stone Bellisimo” impressions', number(search.branded.impressions), search.branded.impressions, search.comparison?.branded?.impressions, 'Includes spacing/case variants'),
    analyticsCard('Branded clicks', number(search.branded.clicks), search.branded.clicks, search.comparison?.branded?.clicks, 'Clicks on visible branded queries')
  ].join('');
  $('searchTables').innerHTML = searchTable('“Stone Bellisimo” queries', search.brandedQueries || []) + searchTable('Top queries', search.topQueries || []) + searchTable('Top landing pages', search.topPages || []);
  $('searchNotice').textContent = search.configured ? search.limitations : 'Search Console is connected in code but has not imported data yet. Verify the domain property and grant the Functions service account read-only access.';
  renderSearchHealth(search.health);
  $('analyticsContent').dataset.loaded = 'true';
}

async function loadAnalytics() {
  setLoading($('analyticsContent'), 'Building your performance view…');
  const range = state.rangeDays === 'custom'
    ? { start: $('rangeStart').value, end: $('rangeEnd').value }
    : selectedRange();
  const params = new URLSearchParams(range);
  try {
    const [analytics, search] = await Promise.all([
      api(`/api/admin/analytics?${params}&trafficClass=${state.trafficClass}`),
      api(`/api/admin/search-console?${params}`)
    ]);
    $('analyticsContent').innerHTML = $('analyticsTemplate').innerHTML;
    renderAnalytics(analytics, search);
    bindAnalyticsControls();
  } catch (error) {
    $('analyticsContent').innerHTML = `<div class="error-state large"><h3>Analytics could not load</h3><p>${escapeHtml(error.message)}</p><button class="button secondary" id="retryAnalytics">Try again</button></div>`;
    $('retryAnalytics')?.addEventListener('click', loadAnalytics);
  }
}

function bindAnalyticsControls() {
  document.querySelectorAll('[data-range]').forEach(button => {
    button.classList.toggle('active', String(button.dataset.range) === String(state.rangeDays));
  });
  document.querySelectorAll('[data-traffic]').forEach(button => {
    button.classList.toggle('active', button.dataset.traffic === state.trafficClass);
  });
  const toolbar = document.querySelector('.analytics-toolbar');
  if (toolbar?.dataset.bound) return;
  if (toolbar) toolbar.dataset.bound = 'true';
  document.querySelectorAll('[data-range]').forEach(button => {
    button.addEventListener('click', () => {
      state.rangeDays = Number(button.dataset.range);
      loadAnalytics();
    });
  });
  document.querySelectorAll('[data-traffic]').forEach(button => {
    button.addEventListener('click', () => {
      state.trafficClass = button.dataset.traffic;
      loadAnalytics();
    });
  });
  $('customRangeButton')?.addEventListener('click', () => {
    state.rangeDays = 'custom';
    $('customRange').hidden = false;
  });
  $('applyRange')?.addEventListener('click', () => {
    if (!$('rangeStart').value || !$('rangeEnd').value) return showToast('Choose both custom dates.', 'bad');
    loadAnalytics();
  });
}

const CONTENT_NEXT_STATUS = {
  discovered: 'needs_review',
  needs_review: 'approved',
  approved: 'optimized',
  optimized: 'uploaded'
};

const CONTENT_STATUS_LABEL = {
  discovered: 'Send to review',
  needs_review: 'Approve package',
    approved: 'Confirm optimized media',
  optimized: 'Mark upload-ready'
};

function currentMonth() {
  const timezone = state.growthConfig?.timezone || 'America/New_York';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit' })
    .formatToParts(new Date());
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  return `${year}-${month}`;
}

function dateTimeInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function renderGrowthMetrics() {
  const minimums = state.growthConfig?.publishing?.minimumMonthlyMedia || {
    content_packages: 12, usable_project_photos: 18, vertical_clips: 6
  };
  const assets = state.growthContent.flatMap(item => item.assets || []);
  const photos = assets.filter(asset => String(asset.mimeType).startsWith('image/')).length;
  const clips = assets.filter(asset => String(asset.mimeType).startsWith('video/') && asset.verticalApproved === true).length;
  const published = state.growthContent.filter(item => item.status === 'published').length;
  const unclaimed = state.growthInquiries.filter(item => !item.claimedAt && item.status === 'open').length;
  $('growthMetrics').innerHTML = [
    ['Monthly packages', `${state.growthContent.length}/${minimums.content_packages}`, 'Rights-cleared content manifests'],
    ['Usable photos', `${photos}/${minimums.usable_project_photos}`, 'Rights and privacy recorded'],
    ['Vertical clips', `${clips}/${minimums.vertical_clips}`, 'Video files in this intake'],
    ['Published', published, `${unclaimed} unclaimed social inquiries`]
  ].map(([label, value, caption]) => `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(caption)}</small></article>`).join('');
}

function renderGrowthControls() {
  const controls = state.growthControls || { outboundPaused: true, draftingDisabled: false, disconnectedPlatforms: [] };
  const disconnected = controls.disconnectedPlatforms || [];
  const banner = $('growthControlStatus');
  banner.dataset.status = controls.outboundPaused ? 'stale' : 'healthy';
  banner.textContent = `L1 outbound ${controls.outboundPaused ? 'PAUSED' : 'enabled'} · L2 drafting ${controls.draftingDisabled ? 'disabled' : 'enabled'} · L3 disconnected: ${disconnected.length ? disconnected.join(', ') : 'none'}.`;
  $('toggleL1').textContent = controls.outboundPaused ? 'Release L1 pause' : 'Activate L1 pause';
  $('toggleL2').textContent = controls.draftingDisabled ? 'Release L2 drafting block' : 'Activate L2 drafting block';
  const platform = $('l3Platform').value;
  $('toggleL3').textContent = disconnected.includes(platform) ? `Reconnect ${platform} flag` : `Disconnect ${platform} flag`;
}

function renderGrowthHealth() {
  $('growthHealth').innerHTML = state.growthHealth.length
    ? state.growthHealth.map(item => `<div class="health-row"><strong>${escapeHtml(item.component || item.id)}</strong><span class="${item.status === 'healthy' ? 'healthy' : 'failed'}">${escapeHtml(item.status || 'unknown')}</span><span>${escapeHtml(item.message || `Updated ${formatDate(item.updatedAt)}`)}</span></div>`).join('')
    : '<p class="quiet">No live health signals yet. This is expected while authorization and account IDs remain blocked.</p>';
}

function renderChannelPackage(content, channel) {
  const channelPackage = content.channelPackages?.[channel] || {};
  return `<details class="channel-package" data-content-id="${escapeHtml(content.id)}" data-channel="${channel}">
    <summary>${channel} · ${escapeHtml(channelPackage.remoteStatus || channelPackage.status || 'not prepared')}</summary>
    <label>Caption<textarea data-package-caption maxlength="4000" placeholder="Channel-specific, owner-reviewed copy">${escapeHtml(channelPackage.caption || '')}</textarea></label>
    <label>Post type<select data-package-type><option value="post" ${channelPackage.postType !== 'reel' && channelPackage.postType !== 'story' ? 'selected' : ''}>Post</option><option value="reel" ${channelPackage.postType === 'reel' ? 'selected' : ''}>Reel</option><option value="story" ${channelPackage.postType === 'story' ? 'selected' : ''}>Story</option></select></label>
    <label>Schedule<input data-package-schedule type="datetime-local" value="${escapeHtml(dateTimeInputValue(channelPackage.scheduledAt))}"></label>
    <label>Tracked landing URL<input data-package-url type="url" value="${escapeHtml(channelPackage.trackedUrl || '')}" placeholder="https://…?utm_source=${channel}&utm_medium=${channel === 'google' ? 'organic_local' : 'organic_social'}&…"></label>
    <small>Remote account and post IDs are written only by exact-account reconciliation.</small>
    <button class="button secondary" data-save-package type="button">Save &amp; approve package</button>
  </details>`;
}

function renderGrowthContent() {
  const container = $('growthContentList');
  if (!state.growthContent.length) {
    container.innerHTML = '<div class="empty-state"><h3>No packages for this month</h3><p>Create the first project-media manifest above.</p></div>';
    return;
  }
  container.innerHTML = state.growthContent.map(content => {
    const next = CONTENT_NEXT_STATUS[content.status];
    const approval = content.approvalEvidence?.actor ? `Approved by ${content.approvalEvidence.actor}` : 'Approval not recorded';
    return `<article class="growth-card">
      <div class="growth-card-head"><div><h3>${escapeHtml(content.projectType || 'Project package')} · ${escapeHtml(content.material || 'Material')}</h3><p>${escapeHtml(content.city || 'City not set')} · ${escapeHtml(content.projectId || content.id)}</p></div><span class="status-pill ${content.status === 'published' ? 'success' : 'warm'}">${escapeHtml(content.status)}</span></div>
      <div class="growth-card-meta"><span>${escapeHtml(content.contentPillar)}</span><span>${number((content.assets || []).length)} assets</span><span>${content.rightsApproved ? 'rights approved' : 'rights blocked'}</span><span>${content.privacyCleared ? 'privacy cleared' : 'privacy blocked'}</span><span>${escapeHtml(approval)}</span></div>
      <div class="growth-card-actions">
        ${next ? `<button class="button ${next === 'approved' ? 'primary' : 'secondary'}" data-transition-content="${escapeHtml(content.id)}" data-next-status="${next}" type="button">${CONTENT_STATUS_LABEL[content.status]}</button>` : ''}
        <div class="channel-packages">${['instagram', 'facebook', 'google'].map(channel => renderChannelPackage(content, channel)).join('')}</div>
      </div>
    </article>`;
  }).join('');
  container.querySelectorAll('[data-transition-content]').forEach(button => button.addEventListener('click', () => transitionGrowthContent(button)));
  container.querySelectorAll('[data-save-package]').forEach(button => button.addEventListener('click', () => saveChannelPackage(button.closest('[data-channel]'))));
}

function renderGrowthInquiries() {
  const container = $('growthInquiryList');
  if (!state.growthInquiries.length) {
    container.innerHTML = '<div class="empty-state"><h3>No structured inquiries</h3><p>Signed, exact-account Instagram and Facebook events will appear here without message bodies.</p></div>';
    return;
  }
  container.innerHTML = state.growthInquiries.map(inquiry => {
    const urgent = ['complaint', 'safety_urgent'].includes(inquiry.category);
    return `<article class="growth-card ${urgent ? 'inquiry-urgent' : ''}">
      <div class="growth-card-head"><div><h3>${escapeHtml(inquiry.platform)} · ${escapeHtml(inquiry.category)}</h3><p>${escapeHtml([inquiry.projectType, inquiry.material, inquiry.city, inquiry.postalCode].filter(Boolean).join(' · ') || 'No structured project details yet')}</p></div><span class="status-pill ${inquiry.status === 'qualified' ? 'success' : 'warm'}">${escapeHtml(inquiry.status)}</span></div>
      <div class="growth-card-meta"><span>received ${escapeHtml(formatDate(inquiry.createdAt))}</span><span>${inquiry.claimedAt ? `claimed by ${escapeHtml(inquiry.claimedBy)}` : 'unclaimed'}</span><span>consent: ${escapeHtml(inquiry.consentState || 'not requested')}</span><span>content: ${escapeHtml(inquiry.contentId || 'untracked')}</span></div>
      <div class="growth-card-actions">
        ${!inquiry.claimedAt ? `<button class="button primary" data-claim-inquiry="${escapeHtml(inquiry.id)}" type="button">Claim conversation</button>` : ''}
        ${inquiry.status !== 'qualified' && inquiry.claimedAt ? `<button class="button secondary" data-qualify-inquiry="${escapeHtml(inquiry.id)}" type="button">Confirm qualification</button>` : ''}
      </div>
    </article>`;
  }).join('');
  container.querySelectorAll('[data-claim-inquiry]').forEach(button => button.addEventListener('click', () => claimGrowthInquiry(button.dataset.claimInquiry)));
  container.querySelectorAll('[data-qualify-inquiry]').forEach(button => button.addEventListener('click', () => qualifyGrowthInquiry(button.dataset.qualifyInquiry)));
}

async function loadGrowth() {
  setLoading($('growthContentList'), 'Loading content manifests…');
  setLoading($('growthInquiryList'), 'Loading social inquiries…');
  const month = $('growthMonthFilter').value || currentMonth();
  $('growthMonthFilter').value = month;
  $('contentMonth').value = $('contentMonth').value || month;
  try {
    const [content, inquiries, health, controls, config] = await Promise.all([
      api(`/api/admin/growth/content?month=${encodeURIComponent(month)}`),
      api('/api/admin/growth/inquiries?limit=100'),
      api('/api/admin/growth/health'),
      api('/api/admin/growth/controls'),
      api('/api/admin/growth/config')
    ]);
    state.growthContent = content.content || [];
    state.growthInquiries = inquiries.inquiries || [];
    state.growthHealth = health.health || [];
    state.growthControls = controls.controls || null;
    state.growthConfig = config.config || null;
    state.growthLoaded = true;
    renderGrowthMetrics();
    renderGrowthControls();
    renderGrowthHealth();
    renderGrowthContent();
    renderGrowthInquiries();
  } catch (error) {
    $('growthContentList').innerHTML = `<div class="error-state"><h3>Growth pilot data could not load</h3><p>${escapeHtml(error.message)}</p></div>`;
    $('growthInquiryList').innerHTML = '';
  }
}

async function submitContentIntake(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const files = [...$('contentFiles').files];
  if (!files.length) return showToast('Choose at least one media file.', 'bad');
  const data = new FormData(form);
  if (files.some(file => String(file.type).startsWith('video/')) && data.get('verticalApproved') !== 'on') {
    return showToast('Verify that every selected video is vertical before uploading.', 'bad');
  }
  const payload = {
    month: data.get('month'), projectId: data.get('projectId'), material: data.get('material'),
    projectType: data.get('projectType'), city: data.get('city'), contentPillar: data.get('contentPillar'),
    priorPostStatus: data.get('priorPostStatus'), rightsApproved: data.get('rightsApproved') === 'on',
    privacyCleared: data.get('privacyCleared') === 'on', includesOffer: data.get('includesOffer') === 'on',
    offerApproved: data.get('offerApproved') === 'on', offerExpiresAt: data.get('offerExpiresAt') || null,
    notes: data.get('notes')
  };
  $('submitContent').disabled = true;
  try {
    $('contentUploadStatus').textContent = 'Creating manifest…';
    const created = await api('/api/admin/growth/content', { method: 'POST', body: JSON.stringify(payload) });
    for (let index = 0; index < files.length; index += 1) {
      $('contentUploadStatus').textContent = `Uploading ${index + 1} of ${files.length}…`;
      const upload = new FormData();
      upload.set('file', files[index]);
      if (String(files[index].type).startsWith('video/')) upload.set('verticalApproved', 'true');
      await api(`/api/admin/growth/content/${encodeURIComponent(created.content.id)}/assets`, { method: 'POST', body: upload });
    }
    form.reset();
    $('contentMonth').value = $('growthMonthFilter').value || currentMonth();
    showToast('Content manifest and private assets recorded.');
    await loadGrowth();
  } catch (error) {
    showToast(error.message, 'bad');
  } finally {
    $('submitContent').disabled = false;
    $('contentUploadStatus').textContent = '';
  }
}

async function transitionGrowthContent(button) {
  const next = button.dataset.nextStatus;
  const message = next === 'approved'
    ? 'Approve this package? This records your rights, privacy, prior-post, and offer decision.'
    : `Move this package to ${next}?`;
  if (!confirm(message)) return;
  button.disabled = true;
  try {
    await api(`/api/admin/growth/content/${encodeURIComponent(button.dataset.transitionContent)}/transition`, {
      method: 'PATCH', body: JSON.stringify({
        status: next,
        note: next === 'optimized' ? 'Media format and channel readiness confirmed in Firebase admin dashboard.' : 'Approved in Firebase admin dashboard.',
        optimizationConfirmed: next === 'optimized',
        specId: next === 'optimized' ? 'sb-social-media-v1' : null
      })
    });
    await loadGrowth();
  } catch (error) { showToast(error.message, 'bad'); }
  finally { button.disabled = false; }
}

async function saveChannelPackage(container) {
  const caption = container.querySelector('[data-package-caption]').value.trim();
  const scheduledAt = container.querySelector('[data-package-schedule]').value;
  const postType = container.querySelector('[data-package-type]').value;
  const trackedUrl = container.querySelector('[data-package-url]').value.trim();
  if (!caption || !scheduledAt) return showToast('Add a caption and schedule before saving a channel package.', 'bad');
  if (!confirm(`Approve this exact ${container.dataset.channel} caption, media package, post type, tracked link, and schedule?`)) return;
  const button = container.querySelector('[data-save-package]');
  button.disabled = true;
  try {
    await api(`/api/admin/growth/content/${encodeURIComponent(container.dataset.contentId)}/packages/${container.dataset.channel}`, {
      method: 'PATCH',
      body: JSON.stringify({ caption, captionVersion: 'v1', postType, trackedUrl, scheduledAt: new Date(scheduledAt).toISOString(), approve: true })
    });
    showToast(`${container.dataset.channel} review package saved.`);
    await loadGrowth();
  } catch (error) { showToast(error.message, 'bad'); }
  finally { button.disabled = false; }
}

async function claimGrowthInquiry(id) {
  try {
    await api(`/api/admin/growth/inquiries/${encodeURIComponent(id)}/claim`, { method: 'POST', body: '{}' });
    showToast('Conversation claimed. Later SLA alerts are stopped.');
    await loadGrowth();
  } catch (error) { showToast(error.message, 'bad'); }
}

async function qualifyGrowthInquiry(id) {
  const inquiry = state.growthInquiries.find(item => item.id === id);
  const handoffOwner = state.growthConfig?.salesHandoffOwner || 'the sales owner';
  if (!inquiry || !confirm(`Confirm service fit, service area, genuine project intent, a usable contact method, and consent? This assigns the lead to ${handoffOwner}.`)) return;
  try {
    await api(`/api/admin/growth/inquiries/${encodeURIComponent(id)}/qualify`, {
      method: 'POST',
      body: JSON.stringify({
        serviceFit: true, serviceAreaFit: true, genuineProjectIntent: true,
        usableContactMethod: inquiry.usableContactMethod || 'platform_dm',
        consentState: inquiry.consentState,
        consentVersion: inquiry.consentVersion,
        version: state.growthConfig?.programCode
      })
    });
    showToast(`Inquiry marked qualified and assigned to ${handoffOwner}.`);
    await loadGrowth();
  } catch (error) { showToast(error.message, 'bad'); }
}

async function setGrowthControl(level, input = {}) {
  if (!confirm(`Apply ${level} kill-switch change? This action is recorded with your administrator identity.`)) return;
  try {
    await api('/api/admin/growth/controls', { method: 'PATCH', body: JSON.stringify({ level, ...input }) });
    await loadGrowth();
    showToast(`${level} control updated.`);
  } catch (error) { showToast(error.message, 'bad'); }
}

// Signing in is not the same as being an administrator: the account also needs
// the admin custom claim the Auth blocking functions grant to the allowlist.
async function adminClaimState(user) {
  try {
    const result = await user.getIdTokenResult(true);
    return result.claims.admin === true ? 'admin' : 'denied';
  } catch {
    return 'unverified';
  }
}

const CLAIM_MESSAGES = {
  denied: 'That account is not approved for the Stone Bellisimo dashboard.',
  unverified: 'Your access could not be verified. Check your connection and sign in again.'
};

function googleSignInMessage(error) {
  const code = error?.code || '';
  if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'].includes(code)) return '';
  if (code === 'auth/popup-blocked') return 'Your browser blocked the Google window. Allow pop-ups for this site and try again.';
  if (code === 'auth/account-exists-with-different-credential') {
    return 'This email already signs in with a password. Use the email form below, then link Google from your account.';
  }
  if (code === 'auth/unauthorized-domain') return 'This domain is not authorized for Google sign-in yet.';
  return 'This Google account is not approved for the Stone Bellisimo dashboard.';
}

async function initialize() {
  try {
    const response = await fetch('/api/firebase-config', { headers: { accept: 'application/json' } });
    const config = await response.json();
    if (!config.configured) throw new Error('Firebase web configuration is incomplete.');
    const app = initializeApp(config.firebaseConfig, 'stone-bellisimo-admin');
    state.auth = getAuth(app);
    if (config.emulator && config.authEmulatorUrl) connectAuthEmulator(state.auth, config.authEmulatorUrl, { disableWarnings: true });
    await setPersistence(state.auth, browserSessionPersistence);
    onAuthStateChanged(state.auth, async user => {
      const claim = user ? await adminClaimState(user) : 'admin';
      if (user && claim !== 'admin') {
        await signOut(state.auth).catch(() => {});
        $('loginError').textContent = CLAIM_MESSAGES[claim];
        return;
      }
      state.user = user;
      $('authLoading').hidden = true;
      $('loginView').hidden = Boolean(user);
      $('dashboard').hidden = !user;
      if (user) {
        $('adminEmail').textContent = user.email || 'Administrator';
        try { await loadLeads(); } catch {}
      }
    });
  } catch (error) {
    $('authLoading').hidden = true;
    $('loginView').hidden = false;
    $('loginError').textContent = error.message;
    $('signIn').disabled = true;
    $('signInGoogle').disabled = true;
  }
}

$('signInGoogle').addEventListener('click', async () => {
  $('loginError').textContent = '';
  $('signInGoogle').disabled = true;
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(state.auth, provider);
  } catch (error) {
    $('loginError').textContent = googleSignInMessage(error);
  } finally {
    $('signInGoogle').disabled = false;
  }
});

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('loginError').textContent = '';
  $('signIn').disabled = true;
  $('signIn').textContent = 'Signing in…';
  try { await signInWithEmailAndPassword(state.auth, $('loginEmail').value.trim(), $('loginPassword').value); }
  catch { $('loginError').textContent = 'Email or password is incorrect, or this account is not authorized.'; }
  finally { $('signIn').disabled = false; $('signIn').textContent = 'Sign in securely'; }
});

document.querySelectorAll('[data-tab]').forEach(tab => tab.addEventListener('click', () => showView(tab.dataset.tab)));
$('signOut').addEventListener('click', () => signOut(state.auth));
$('leadSearch').addEventListener('input', () => { clearTimeout(window.__leadSearch); window.__leadSearch = setTimeout(() => { state.selected = null; loadLeads(); }, 280); });
$('leadStatus').addEventListener('change', () => { state.selected = null; loadLeads(); });
$('loadMoreLeads').addEventListener('click', () => loadLeads({ append: true }));
$('emailTemplate').addEventListener('change', () => { updateComposer(); previewEmail(); });
$('previewEmail').addEventListener('click', previewEmail);
$('sendEmail').addEventListener('click', sendEmail);
$('closeEmail').addEventListener('click', () => $('emailPanel').hidden = true);
$('contentIntakeForm').addEventListener('submit', submitContentIntake);
$('growthMonthFilter').addEventListener('change', () => { state.growthLoaded = false; loadGrowth(); });
$('toggleL1').addEventListener('click', () => setGrowthControl('L1', { active: !state.growthControls?.outboundPaused }));
$('toggleL2').addEventListener('click', () => setGrowthControl('L2', { active: !state.growthControls?.draftingDisabled }));
$('toggleL3').addEventListener('click', () => {
  const platform = $('l3Platform').value;
  const active = !(state.growthControls?.disconnectedPlatforms || []).includes(platform);
  setGrowthControl('L3', { platform, active });
});
$('activateL4').addEventListener('click', () => {
  const targetId = $('l4TargetId').value.trim();
  if (!targetId) return showToast('Enter the exact Firebase lead or social inquiry ID.', 'bad');
  setGrowthControl('L4', { targetType: $('l4TargetType').value, targetId, active: true });
});
$('l3Platform').addEventListener('change', renderGrowthControls);
updateComposer();
renderEmptyLead();
initialize();
