import { initializeApp } from 'firebase/app';
import {
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';

const $ = id => document.getElementById(id);
const state = { auth: null, user: null, leads: [], selected: null, nextCursor: null, rangeDays: 30 };

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

async function api(path, options = {}) {
  if (!state.user) throw new Error('Sign in is required.');
  const token = await state.user.getIdToken();
  const response = await fetch(path, {
    ...options,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(options.headers || {}) }
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
  $('pageHeading').textContent = name === 'leads' ? 'Leads & follow-up' : 'Website analytics';
  $('pageEyebrow').textContent = name === 'leads' ? 'Client pipeline' : 'Engagement & lead intent';
  if (name === 'analytics' && !$('analyticsContent').dataset.loaded) loadAnalytics();
}

function leadStatus(lead) {
  if (['received', 'unparsed'].includes(lead.feedbackStatus)) return ['Feedback received', 'success'];
  if (lead.feedbackEmailLastError) return ['Email issue', 'danger'];
  if (lead.feedbackEmailSentAt) return ['Feedback requested', 'warm'];
  if (lead.immediateEmailSentAt) return ['Confirmation sent', 'success'];
  return ['New lead', 'neutral'];
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
  const confirmed = state.leads.filter(lead => lead.immediateEmailSentAt).length;
  const feedback = state.leads.filter(lead => ['received', 'unparsed'].includes(lead.feedbackStatus)).length;
  const pending = state.leads.filter(lead => !lead.immediateEmailSentAt).length;
  $('leadStats').innerHTML = [
    ['Total leads', total, 'All captured inquiries'],
    ['Showing confirmed', confirmed, 'Confirmation email recorded'],
    ['Feedback received', feedback, 'Review or reply captured'],
    ['Needs attention', pending, 'No confirmation on record']
  ].map(([label, value, caption]) => `<article class="metric-card"><span>${label}</span><strong>${number(value)}</strong><small>${caption}</small></article>`).join('');
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
    ['Confirmation', lead.immediateEmailSentAt ? formatDate(lead.immediateEmailSentAt) : 'Not sent'],
    ['Feedback due', formatDate(lead.feedbackEmailDueAt)],
    ['Feedback status', lead.feedbackStatus || 'Pending'], ['Message', lead.message]
  ];
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
    <dl class="detail-grid">${detailRows(lead).map(([label, value]) => `<div class="detail-item ${label === 'Message' ? 'wide' : ''}"><dt>${label}</dt><dd>${escapeHtml(value || '—')}</dd></div>`).join('')}</dl>
    <section class="subsection"><div class="section-heading"><div><span class="eyebrow">Customer voice</span><h3>Feedback</h3></div></div>${(data.feedback || []).length ? `<div class="timeline">${data.feedback.map(item => `<article><span class="timeline-dot"></span><div><strong>${item.rating ? `${item.rating}/5` : 'Unrated'} · ${escapeHtml(item.source || 'Feedback')}</strong><time>${escapeHtml(formatDate(item.receivedAt))}</time><p>${escapeHtml(item.comment || 'No written comment.')}</p></div></article>`).join('')}</div>` : '<p class="quiet">No feedback has been received yet.</p>'}</section>
    <section class="subsection"><div class="section-heading"><div><span class="eyebrow">Communication</span><h3>Email history</h3></div></div>${eventRows.length ? `<div class="timeline">${eventRows.map(item => `<article><span class="timeline-dot"></span><div><strong>${escapeHtml(item.title)}</strong><time>${escapeHtml(formatDate(item.date))}</time><p>${escapeHtml(item.text || 'No additional details.')}</p></div></article>`).join('')}</div>` : '<p class="quiet">No email events recorded.</p>'}</section>`;
  $('composeEmail').addEventListener('click', () => {
    $('emailPanel').hidden = false;
    previewEmail();
  });
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
  return `<div class="table-scroll"><table><thead><tr><th>CTA</th><th>Page / placement</th><th>Type</th><th>Impressions</th><th>Clicks</th><th>CTR</th><th>Unique CTR</th></tr></thead><tbody>${rows.slice(0, 30).map(row => `<tr><td><strong>${escapeHtml(row.ctaLabel)}</strong>${row.targetLabel ? `<small>${escapeHtml(row.targetLabel)}</small>` : ''}</td><td>${escapeHtml(row.pagePath)}<small>${escapeHtml(row.placement)}</small></td><td><span class="status-pill neutral">${escapeHtml(row.ctaType)}</span></td><td>${number(row.impressions)}</td><td>${number(row.clicks)}</td><td>${percent(row.ctr)}</td><td>${percent(row.uniqueCtr)}</td></tr>`).join('')}</tbody></table></div>`;
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

function renderAnalytics(analytics, search) {
  const t = analytics.totals, p = analytics.comparison.totals;
  $('analyticsMetrics').innerHTML = [
    analyticsCard('Sessions', number(t.sessions), t.sessions, p.sessions, 'Anonymous 30-minute visits'),
    analyticsCard('Page views', number(t.pageViews), t.pageViews, p.pageViews, 'Pages viewed across the site'),
    analyticsCard('Estimate submissions', number(t.formSubmissions), t.formSubmissions, p.formSubmissions, 'Server-confirmed requests'),
    analyticsCard('High-intent actions', number(t.highIntentActions), t.highIntentActions, p.highIntentActions, 'Calls, directions, email, text & estimates')
  ].join('');
  $('ctaChart').innerHTML = lineChart(analytics.daily);
  $('ctaSummary').textContent = `${number(t.ctaClicks)} clicks from ${number(t.ctaImpressions)} impressions · ${percent(t.ctr)} raw CTR`;
  $('ctaTable').innerHTML = renderCtaTable(analytics.ctas);
  const intents = intentBreakdown(analytics.ctas);
  $('intentGrid').innerHTML = intents.map(item => `<article class="intent-card"><span class="intent-icon">${({ phone:'☎',map:'↗',sms:'•••',email:'@',estimate:'◇' })[item.type]}</span><div><strong>${number(item.clicks)}</strong><span>${({ phone:'Phone link clicks',map:'Directions intent',sms:'Text link clicks',email:'Email link clicks',estimate:'Estimate CTA clicks' })[item.type]}</span></div></article>`).join('');
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
      api(`/api/admin/analytics?${params}`),
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
  const toolbar = document.querySelector('.analytics-toolbar');
  if (toolbar?.dataset.bound) return;
  if (toolbar) toolbar.dataset.bound = 'true';
  document.querySelectorAll('[data-range]').forEach(button => {
    button.addEventListener('click', () => {
      state.rangeDays = Number(button.dataset.range);
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
  }
}

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
updateComposer();
renderEmptyLead();
initialize();
