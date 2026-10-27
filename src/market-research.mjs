import { readFileSync } from 'node:fs';
import { projectOutcome } from './lead-outcomes.mjs';

export const MARKETS = JSON.parse(readFileSync(new URL('./market-areas.json', import.meta.url), 'utf8'));
export const CHANNELS = Object.freeze({ google: 'Google Ads', facebook: 'Facebook', instagram: 'Instagram', lead_provider: 'Paid lead provider' });
export const DISCOVERY_SOURCES = Object.freeze({ google: 'Google', facebook: 'Facebook', instagram: 'Instagram', referral: 'Customer referral', lead_provider: 'Paid lead provider', showroom: 'Showroom / walk-in', other: 'Other' });
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const marketByKey = new Map(MARKETS.map(m => [m.key, m]));
const zipMarkets = new Map();
for (const market of MARKETS) for (const zip of market.zips) {
  const values = zipMarkets.get(zip) || new Set();
  values.add(market.key);
  zipMarkets.set(zip, values);
}
const stateNames = { NJ: 'new jersey', NY: 'new york', CT: 'connecticut', PA: 'pennsylvania', MA: 'massachusetts' };
const validMoney = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
export function localDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
export function shiftDate(value, days) {
  const date = new Date(value + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value)) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
}
export function marketForLead(lead) {
  if (marketByKey.has(lead.marketing?.market)) return { key: lead.marketing.market, evidence: 'Staff-confirmed project area' };
  const address = String(lead.message || '').match(/(?:^|\n)Address:\s*([^\n]+)/i)?.[1] || '';
  const zip = String(lead.postalCode || lead.marketing?.postalCode || '').match(/^\d{5}(?:-\d{4})?$/)?.[0]?.slice(0, 5)
    || address.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1];
  if (zipMarkets.get(zip)?.size === 1) return { key: [...zipMarkets.get(zip)][0], evidence: 'Customer project ZIP / postal area' };
  const text = ` ${normalize([lead.city, lead.state, address].filter(Boolean).join(' '))} `;
  const matches = MARKETS.filter(m => (text.includes(` ${m.state.toLowerCase()} `) || text.includes(` ${stateNames[m.state]} `))
    && m.cities.some(city => text.includes(` ${normalize(city)} `)));
  if (matches.length === 1) return { key: matches[0].key, evidence: 'Customer-entered project city and state' };
  return { key: 'Unknown area', evidence: 'Project location not recorded or ambiguous' };
}

export function isBusinessLead(lead) {
  const a = lead.attribution || {};
  return a.trafficClass !== 'test' && !['qa', 'codex', 'test', 'browser'].includes(String(a.utmSource || '').toLowerCase())
    && !/codex production e2e test|browser smoke|test submission/i.test(lead.source || '');
}

export function leadAcquisition(lead) {
  const a = lead.attribution || {};
  const campaign = lead.marketing?.campaignId || a.utmCampaign || '';
  const source = String(a.utmSource || '').toLowerCase();
  const medium = String(a.utmMedium || '').toLowerCase();
  if (source) return { label: `${source}${medium ? ' / ' + medium : ''}`, known: true, campaign, evidence: 'Tracked submission-session campaign' };
  const discovery = lead.marketing?.discoverySource || lead.discoverySource;
  if (DISCOVERY_SOURCES[discovery]) return { label: DISCOVERY_SOURCES[discovery] + ' (reported)', known: true, campaign, evidence: 'Customer or staff reported' };
  const host = String(a.referrerHost || '').toLowerCase().replace(/^www\./, '');
  if (host && !['direct', 'stonebellisimollc.com'].includes(host)) return { label: host, known: true, campaign, evidence: 'Website referrer; paid/organic not determined' };
  return { label: 'Direct / unknown', known: false, campaign, evidence: 'No external referrer or campaign tag' };
}

function emptyMetrics() { return { leads: 0, qualified: 0, completed: 0, collected: 0, revenueCents: 0 }; }
function addLead(metrics, lead) {
  const outcome = projectOutcome(lead);
  metrics.leads += 1;
  if (outcome) metrics.qualified += 1;
  if (['Job Completed', 'Invoice Collected'].includes(outcome)) metrics.completed += 1;
  if (outcome === 'Invoice Collected') {
    metrics.collected += 1;
    metrics.revenueCents += validMoney(lead.clientChargeCents);
  }
}
const sorted = map => [...map.values()].sort((a, b) => b.completed - a.completed || b.qualified - a.qualified || b.leads - a.leads || a.label.localeCompare(b.label));

export function buildMarketReport({ leads = [], daily = [], dimensions = [], searchRows = [], searchDaily = [], campaigns = [], spend = [], settings = {}, snapshots = [], searchHealth = null }, range, now = new Date()) {
  const days = Math.round((Date.parse(range.end) - Date.parse(range.start)) / 86400000) + 1;
  const previousRange = { start: shiftDate(range.start, -days), end: shiftDate(range.start, -1) };
  const business = leads.filter(isBusinessLead);
  const dateOf = lead => { try { return lead.submittedAt ? localDate(lead.submittedAt) : ''; } catch { return ''; } };
  const within = (date, r = range) => date >= r.start && date <= r.end;
  const selected = business.filter(l => within(dateOf(l)));
  const previous = business.filter(l => within(dateOf(l), previousRange));
  const totals = emptyMetrics(), comparison = emptyMetrics();
  const sources = new Map(), areas = new Map(), weeks = new Map();
  let located = 0, attributed = 0;
  for (const lead of selected) {
    addLead(totals, lead);
    const source = leadAcquisition(lead), area = marketForLead(lead);
    if (source.known) attributed += 1;
    if (area.key !== 'Unknown area') located += 1;
    for (const [map, label, evidence] of [[sources, source.label, source.evidence], [areas, area.key, area.evidence]]) {
      const row = map.get(label) || { label, evidence, ...emptyMetrics() };
      addLead(row, lead); map.set(label, row);
    }
    const day = dateOf(lead);
    const week = shiftDate(day, -(new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7);
    const row = weeks.get(week) || { label: week, ...emptyMetrics() };
    addLead(row, lead); weeks.set(week, row);
  }
  for (const lead of previous) addLead(comparison, lead);
  const groupTraffic = dimension => {
    const groups = new Map();
    for (const row of dimensions.filter(d => d.dimension === dimension && d.trafficClass !== 'test' && within(d.date))) {
      const label = String(row.label || row.value || 'Unknown');
      const item = groups.get(label) || { label, pageViews: 0 };
      item.pageViews += Number(row.count || 0);
      groups.set(label, item);
    }
    return [...groups.values()].sort((a, b) => b.pageViews - a.pageViews);
  };
  const traffic = daily.filter(d => d.trafficClass !== 'test' && within(d.date));
  const queries = new Map();
  for (const row of searchRows.filter(r => within(r.date))) {
    const key = String(row.query || '');
    if (!key) continue;
    const item = queries.get(key) || { query: key, clicks: 0, impressions: 0 };
    item.clicks += Number(row.clicks || 0); item.impressions += Number(row.impressions || 0); queries.set(key, item);
  }
  const queryRows = [...queries.values()].sort((a, b) => b.impressions - a.impressions);
  const monthlyBudgetCents = settings.monthlyBudgetCents ?? 10000;
  const month = localDate(now).slice(0, 7);
  const monthSpend = spend.filter(s => s.date?.startsWith(month)).reduce((sum, s) => sum + validMoney(s.amountCents), 0);
  const campaignRows = campaigns.map(c => {
    const metrics = emptyMetrics();
    for (const lead of selected.filter(l => leadAcquisition(l).campaign === c.id || leadAcquisition(l).campaign === c.utmCampaign)) addLead(metrics, lead);
    const entries = spend.filter(s => s.campaignId === c.id && within(s.date));
    const recordedSpendCents = entries.reduce((sum, s) => sum + validMoney(s.amountCents), 0);
    return { ...c, metrics, spendEntries: entries.sort((a,b) => b.date.localeCompare(a.date)), recordedSpendCents: entries.length ? recordedSpendCents : null,
      costPerQualifiedCents: entries.length && metrics.qualified ? Math.round(recordedSpendCents / metrics.qualified) : null,
      recordedRoas: recordedSpendCents > 0 ? metrics.revenueCents / recordedSpendCents : null };
  });
  const rankedAreas = sorted(areas);
  const knownAreas = rankedAreas.filter(a => a.label !== 'Unknown area');
  const strongest = knownAreas[0];
  const recommendations = [];
  if (selected.length - located > 0) recommendations.push({ title: 'Fill in project locations', tone: 'attention', evidence: `${selected.length - located} of ${selected.length} leads have no clear project area.`, action: 'Add the job county or ZIP to existing leads before judging geographic demand.' });
  if (strongest?.completed >= 2 && strongest.leads >= 5) recommendations.push({ title: `Test ${strongest.label} first`, tone: 'positive', market: strongest.label, evidence: `${strongest.completed} completed jobs and ${strongest.qualified} booked-or-completed projects from ${strongest.leads} leads.`, action: 'Use one measured campaign. Check qualified leads and costs before expanding.' });
  else recommendations.push({ title: strongest ? `Explore ${strongest.label}` : 'Start with the showroom’s local market', tone: 'neutral', market: strongest?.label || 'Hudson, NJ', evidence: strongest ? `${strongest.leads} leads and ${strongest.completed} completed jobs; the sample is too small to call this a proven market.` : 'Union City is the showroom base. There is not enough recorded job-location evidence to name a winning market.', action: 'Treat this as an exploratory test, not a proven return. Keep the monthly plan within $' + (monthlyBudgetCents / 100).toFixed(0) + '.' });
  const weak = knownAreas.find(a => a.leads >= 5 && a.qualified === 0);
  if (weak) recommendations.push({ title: `Review follow-up in ${weak.label}`, tone: 'attention', evidence: `${weak.leads} leads have no booked estimate or completion recorded.`, action: 'Check lead quality and update outcomes before buying more leads in this area.' });
  const untagged = selected.length - attributed;
  if (untagged) recommendations.push({ title: 'Make the next campaign measurable', tone: 'attention', evidence: `${untagged} leads are direct or have no identifiable discovery source.`, action: 'Use the campaign’s tracked link and record phone, referral, and lead-provider sources.' });
  for (const campaign of campaignRows) {
    if (campaign.recordedSpendCents > 0 && campaign.metrics.qualified === 0) recommendations.push({ title: `Review ${campaign.name}`, tone: 'attention', evidence: `$${(campaign.recordedSpendCents / 100).toFixed(2)} recorded spend with no booked estimate in this lead cohort.`, action: 'Check campaign age, lead follow-up, and tracking before adding spend; this is a review signal, not proof the ads failed.' });
  }
  const report = {
    generatedAt: now.toISOString(), range, previousRange, totals, comparison,
    coverage: { located, attributed, leads: selected.length, excludedTestLeads: leads.length - business.length, allTimeLeads: business.length, undatedLeads: business.filter(l => !dateOf(l)).length },
    sources: sorted(sources), areas: rankedAreas, weeks: [...weeks.values()].sort((a,b) => a.label.localeCompare(b.label)),
    website: { sessions: traffic.reduce((sum,r) => sum + Number(r.sessions || 0),0), referrers: groupTraffic('referrer').slice(0,12), areaPages: groupTraffic('page').filter(r => /areas-we-serve/.test(r.label)).slice(0,12), latestDate: daily.map(r=>r.date).sort().at(-1) || null },
    search: { latestDate: searchDaily.map(r=>r.date).sort().at(-1) || null, health: searchHealth, queries: queryRows.slice(0,12), opportunities: queryRows.filter(r=>r.impressions >= 20 && r.clicks / r.impressions < .03).slice(0,5) },
    budget: { monthlyBudgetCents, recordedMonthSpendCents: monthSpend, remainingCents: Math.max(0, monthlyBudgetCents - monthSpend), month, allocatedCents: campaigns.filter(c=>c.status==='tracking'&&c.startDate?.startsWith(month)).reduce((sum,c)=>sum+validMoney(c.budgetCents),0) },
    campaigns: campaignRows, recommendations: recommendations.slice(0,6), markets: MARKETS.map(({key,state})=>({key,state})), channels: CHANNELS, discoverySources: DISCOVERY_SOURCES,
    suggestion: { market: strongest?.label || 'Hudson, NJ', platform: 'facebook', budgetCents: Math.max(0, monthlyBudgetCents - monthSpend), basis: 'Exploratory social campaign; platform preference and account performance are not yet confirmed.' },
    snapshots: snapshots.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,14),
    methodology: 'Outcomes are current results for leads first recorded in each date range (Eastern time). Older cohorts have had more time to close. Revenue includes only Invoice Collected amounts. Campaign credit uses the tracked submission session or a staff-assigned campaign; it does not prove incremental lift. Direct traffic, phone calls, ad-platform lead forms, and missing project locations can be undercounted. Search and area-page interest do not establish a customer’s job location. ROAS uses recorded costs only and is not profit.'
  };
  return report;
}
