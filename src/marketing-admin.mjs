import { randomUUID } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import { json, readJson, normalizeText, methodNotAllowed } from './lead-automation.mjs';
import { buildMarketReport, CHANNELS, DISCOVERY_SOURCES, MARKETS, localDate, shiftDate, validDate } from './market-research.mjs';
import { evaluateSearchConsoleHealth } from './search-console.mjs';

const clean = (value, max = 120) => normalizeText(value, max);
const marketKeys = new Set(MARKETS.map(m => m.key));
const statuses = new Set(['draft', 'tracking', 'paused', 'completed']);
const website = 'https://stonebellisimollc.com';
const settingsRef = db => db.collection('marketing_settings').doc('main');
const cents = (value, name, max = 10000000) => {
  const raw = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || Number(raw) > max) throw new Error(`${name} must be a non-negative dollar amount with up to two decimal places.`);
  return Math.round(Number(raw) * 100);
};
function reportRange(request, now = new Date()) {
  const params = new URL(request.url).searchParams;
  const end = params.get('end') || localDate(now);
  const start = params.get('start') || shiftDate(end, -89);
  if (!validDate(start) || !validDate(end) || start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 365 || end > localDate(now)) throw new Error('Choose a valid date range of up to one year, ending today or earlier.');
  return { start, end };
}
async function readAll(query) {
  const output = [];
  let cursor;
  for (;;) {
    let pageQuery = query.orderBy(FieldPath.documentId()).limit(500);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const page = await pageQuery.get();
    output.push(...page.docs.map(doc => ({ ...doc.data(), id: doc.id })));
    if (page.size < 500) return output;
    cursor = page.docs.at(-1);
  }
}
async function datedRows(db, collection, start, end) {
  // Single date index; no additional production index deployment is needed.
  const snapshot = await db.collection(collection).where('date', '>=', start).where('date', '<=', end).get();
  return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
}
export async function loadMarketReport(db, range, { force = false, now = new Date() } = {}) {
  const cacheRef = db.collection('marketing_report_cache').doc(`${range.start}_${range.end}`);
  const [settingsDoc, cached] = await Promise.all([settingsRef(db).get(), cacheRef.get()]);
  const settings = settingsDoc.data() || { monthlyBudgetCents: 10000 };
  const cache = cached.data();
  if (!force && cache?.report && now.getTime() - Date.parse(cache.generatedAt) < 15 * 60000 && (!settings.updatedAt || settings.updatedAt <= cache.generatedAt)) return cache.report;
  const monthStart = localDate(now).slice(0,7) + '-01';
  const spendStart = range.start < monthStart ? range.start : monthStart;
  const spendEnd = range.end > localDate(now) ? range.end : localDate(now);
  const [leads, daily, dimensions, searchRows, searchDaily, campaigns, spend, history, health] = await Promise.all([
    readAll(db.collection('leads').select('submittedAt','salesStatus','businessStatus','clientChargeCents','stageTimestamps','attribution','city','state','postalCode','source','message','marketing','discoverySource')),
    datedRows(db, 'analytics_daily', range.start, range.end),
    datedRows(db, 'analytics_dimension_daily', range.start, range.end),
    datedRows(db, 'search_console_queries', range.start, range.end),
    datedRows(db, 'search_console_daily', range.start, range.end),
    readAll(db.collection('marketing_campaigns')),
    datedRows(db, 'marketing_spend', spendStart, spendEnd),
    db.collection('marketing_snapshots').orderBy('date','desc').limit(14).get(),
    db.collection('analytics_health').doc('search_console').get()
  ]);
  const report = buildMarketReport({leads, daily, dimensions, searchRows, searchDaily, campaigns, spend, settings,
    snapshots: history.docs.map(doc=>doc.data()), searchHealth: evaluateSearchConsoleHealth(health.data(), now.getTime())}, range, now);
  // No contact details or raw addresses are included in a report or snapshot.
  await cacheRef.set({ report, generatedAt: report.generatedAt });
  return report;
}
export async function refreshMarketingSnapshot(db, now = new Date()) {
  const date = localDate(now);
  const report = await loadMarketReport(db, { start: shiftDate(date,-89), end: date }, { force: true, now });
  await db.collection('marketing_snapshots').doc(date).set({ date, generatedAt: report.generatedAt, range: report.range, totals: report.totals, coverage: report.coverage, budget: report.budget, recommendations: report.recommendations });
  return report;
}
async function touch(tx, db, actor, now) {
  tx.set(settingsRef(db), { updatedAt: now, updatedBy: actor }, { merge: true });
}
export function campaignFields(body, existing, budgetCents, now = new Date()) {
  const value = { ...existing, ...body };
  const name = clean(value.name, 100);
  const platform = clean(value.platform, 30);
  const market = clean(value.market, 100);
  const status = clean(value.status || 'draft',20);
  if (!name || !CHANNELS[platform] || !marketKeys.has(market) || !statuses.has(status)) throw new Error('Enter a campaign name, a supported platform, a service area, and a valid tracking status.');
  const amount = body.budget !== undefined ? cents(body.budget,'Campaign budget') : existing?.budgetCents ?? budgetCents;
  if (amount > budgetCents) throw new Error('A campaign budget cannot exceed the monthly planning budget.');
  const startDate = value.startDate || localDate(now), endDate = value.endDate || shiftDate(startDate,13);
  if (!validDate(startDate) || !validDate(endDate) || endDate < startDate || startDate.slice(0,7) !== endDate.slice(0,7)) throw new Error('Choose campaign dates within the same calendar month so the monthly budget stays clear.');
  return { name, platform, market, status, budgetCents: amount, startDate, endDate, notes: clean(value.notes,1000) };
}
function campaignBrief(campaign) {
  return {
    headline: 'Beautiful countertops. A clear next step.',
    text: `Planning a kitchen or bathroom project in ${campaign.market}? Explore quartz, granite, and marble with Stone Bellisimo. Request a free estimate from our Union City team.`,
    callToAction: 'Get a free estimate',
    imagePath: '/assets/img/portfolio_island_view-800.jpg',
    measurement: 'Use this tracked link. Record daily spend, update booked estimates and completed jobs, then compare costs and collected revenue.'
  };
}

export async function handleMarketingRequest(request, db, { actor = '' } = {}) {
  // The only public caller is the existing Firebase admin-authorized route.
  if (!actor) return json({success:false,message:'Administrator access is required.'},401);
  const url = new URL(request.url), path = url.pathname;
  try {
    if (path === '/api/admin/marketing/report' && request.method === 'GET') {
      return json({ success: true, report: await loadMarketReport(db, reportRange(request), {force:url.searchParams.get('refresh')==='1'}) });
    }
    if (path === '/api/admin/marketing/options' && request.method === 'GET') {
      const campaigns = await readAll(db.collection('marketing_campaigns'));
      return json({success:true,markets:MARKETS.map(({key,state})=>({key,state})),discoverySources:DISCOVERY_SOURCES,campaigns:campaigns.map(({id,name})=>({id,name}))});
    }
    if (request.method !== 'POST' && request.method !== 'PATCH') return methodNotAllowed(['GET','POST','PATCH']);
    const { body, error, status: errorStatus } = await readJson(request, 16 * 1024);
    if (error) return json({success:false,message:error},errorStatus);
    const now = new Date().toISOString();
    if (path === '/api/admin/marketing/offline-leads' && request.method === 'POST') {
      const customerName=clean(body.customerName,160), market=clean(body.market,100), discoverySource=clean(body.discoverySource,40), campaignId=clean(body.campaignId,70);
      const acquiredDate=clean(body.acquiredDate,10), salesStatus=clean(body.salesStatus,40), phone=clean(body.phone,30);
      if(!customerName||!phone) throw new Error('Enter a customer name and contact phone.');
      if(!validDate(acquiredDate)||acquiredDate>localDate()) throw new Error('Choose the date the inquiry was first received, today or earlier.');
      if(!marketKeys.has(market)||!DISCOVERY_SOURCES[discoverySource]) throw new Error('Choose a project area and discovery source.');
      if(!['','Estimate Scheduled','Job Completed','Invoice Collected'].includes(salesStatus)) throw new Error('Choose a valid project outcome.');
      const clientChargeCents=body.clientCharge?cents(body.clientCharge,'Client charge'):null;
      if(salesStatus==='Invoice Collected'&&!clientChargeCents) throw new Error('Enter the collected invoice amount.');
      const id=clean(body.id||`manual_${randomUUID()}`,80);
      if(!/^manual_[a-z0-9-]{8,60}$/.test(id)) throw new Error('Invalid lead ID.');
      await db.runTransaction(async tx=>{
        const reference=db.collection('leads').doc(id), existing=await tx.get(reference);
        if(existing.exists) return;
        if(campaignId&&!(await tx.get(db.collection('marketing_campaigns').doc(campaignId))).exists) throw new Error('Campaign not found.');
        const completed=['Job Completed','Invoice Collected'].includes(salesStatus);
        tx.create(reference,{id,customerName,phone,email:'',projectType:clean(body.projectType,120)||'Not specified',source:'Staff-recorded inquiry',submittedAt:acquiredDate+'T16:00:00.000Z',createdAt:now,updatedAt:now,
          salesStatus:salesStatus||'New Lead',businessStatus:completed?'completed':salesStatus?'in_progress':'new',designation:null,clientChargeCents,biteSitesShareCents:clientChargeCents===null?null:Math.round(clientChargeCents*.1),biteSitesRateBps:1000,
          completedAt:completed?now:null,feedbackStatus:'not_requested',feedbackEmailDueAt:null,marketing:{market,discoverySource,campaignId,updatedAt:now,updatedBy:actor}});
        await touch(tx,db,actor,now);
      });
      return json({success:true,id});
    }
    if (path === '/api/admin/marketing/settings' && request.method === 'PATCH') {
      const monthlyBudgetCents = cents(body.monthlyBudget, 'Monthly budget', 100000);
      await db.runTransaction(async tx => {
        const active = await tx.get(db.collection('marketing_campaigns').where('status','==','tracking'));
        const allocated = active.docs.filter(d=>d.data().startDate?.startsWith(localDate().slice(0,7))).reduce((sum,d)=>sum+d.data().budgetCents,0);
        if (monthlyBudgetCents < allocated) throw new Error('Pause or reduce tracked campaigns before lowering the budget below their allocation.');
        tx.set(settingsRef(db), {monthlyBudgetCents,updatedAt:now,updatedBy:actor},{merge:true});
      });
      return json({success:true});
    }
    const campaignMatch = path.match(/^\/api\/admin\/marketing\/campaigns(?:\/([a-z0-9_-]+))?$/);
    if (campaignMatch) {
      if ((!campaignMatch[1] && request.method !== 'POST') || (campaignMatch[1] && request.method !== 'PATCH')) return methodNotAllowed([campaignMatch[1]?'PATCH':'POST']);
      const id = campaignMatch[1] || clean(body.id || `campaign_${randomUUID()}`,70);
      if (!/^campaign_[a-z0-9-]{8,60}$/.test(id)) throw new Error('Invalid campaign ID.');
      const reference = db.collection('marketing_campaigns').doc(id);
      const result = await db.runTransaction(async tx => {
        const [current, settings, active] = await Promise.all([tx.get(reference),tx.get(settingsRef(db)),tx.get(db.collection('marketing_campaigns').where('status','==','tracking'))]);
        if (!campaignMatch[1] && current.exists) return {id,...current.data()};
        if (campaignMatch[1] && !current.exists) throw new Error('Campaign not found.');
        const monthly = settings.data()?.monthlyBudgetCents ?? 10000;
        const fields = campaignFields(body, current.data(), monthly);
        if (current.exists && (fields.platform !== current.data().platform || fields.market !== current.data().market)) throw new Error('Create a separate campaign to change the platform or area so its results remain comparable.');
        const other = active.docs.filter(d=>d.id!==id && d.data().startDate?.slice(0,7)===fields.startDate.slice(0,7)).reduce((sum,d)=>sum+d.data().budgetCents,0);
        if (fields.status==='tracking' && fields.budgetCents+other>monthly) throw new Error('Tracked campaigns would exceed the monthly budget. Pause or reduce another campaign first.');
        const utmCampaign = current.data()?.utmCampaign || `sb_${id}`;
        const link = new URL('/contact-us/', website);
        link.search = new URLSearchParams({utm_source:fields.platform,utm_medium:fields.platform==='google'?'cpc':fields.platform==='lead_provider'?'paid_lead':'paid_social',utm_campaign:utmCampaign,utm_content:fields.market.toLowerCase().replace(/[^a-z0-9]+/g,'_')}).toString();
        const saved={...fields,utmCampaign,trackingUrl:link.href,createdAt:current.data()?.createdAt||now,updatedAt:now,updatedBy:actor};
        saved.brief=campaignBrief(saved);
        tx.set(reference,saved); await touch(tx,db,actor,now);
        return {id,...saved};
      });
      return json({success:true,campaign:result});
    }
    const spendMatch=path.match(/^\/api\/admin\/marketing\/campaigns\/(campaign_[a-z0-9-]{8,60})\/spend$/);
    if (spendMatch && request.method==='POST') {
      const campaignId=spendMatch[1], date=clean(body.date,10), amountCents=cents(body.amount,'Recorded spend');
      if(!validDate(date)||date>localDate()) throw new Error('Spend must have a valid date today or earlier.');
      await db.runTransaction(async tx=>{
        const campaign=await tx.get(db.collection('marketing_campaigns').doc(campaignId));
        if(!campaign.exists) throw new Error('Campaign not found.');
        if(date<campaign.data().startDate||date>campaign.data().endDate) throw new Error('Spend date must be within the campaign dates.');
        tx.set(db.collection('marketing_spend').doc(`${campaignId}_${date}`),{campaignId,date,amountCents,source:'staff_recorded',updatedAt:now,updatedBy:actor});
        await touch(tx,db,actor,now);
      });
      return json({success:true});
    }
    const leadMatch=path.match(/^\/api\/admin\/marketing\/leads\/([^/]+)$/);
    if(leadMatch && request.method==='PATCH') {
      const market=clean(body.market,100), discoverySource=clean(body.discoverySource,40), campaignId=clean(body.campaignId,70);
      if(market&&!marketKeys.has(market)) throw new Error('Choose an area from the service-area directory.');
      if(discoverySource&&!DISCOVERY_SOURCES[discoverySource]) throw new Error('Choose a valid discovery source.');
      await db.runTransaction(async tx=>{
        const reference=db.collection('leads').doc(decodeURIComponent(leadMatch[1]));
        const lead=await tx.get(reference);
        if(!lead.exists) throw new Error('Lead not found.');
        if(campaignId && !(await tx.get(db.collection('marketing_campaigns').doc(campaignId))).exists) throw new Error('Campaign not found.');
        tx.update(reference,{marketing:{market,discoverySource,campaignId,updatedAt:now,updatedBy:actor}});
        await touch(tx,db,actor,now);
      });
      return json({success:true});
    }
    return json({success:false,message:'Marketing endpoint not found.'},404);
  } catch(error) {
    return json({success:false,message:error?.message||'Could not update marketing data.'},400);
  }
}
