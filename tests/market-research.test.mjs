import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarketReport, marketForLead, leadAcquisition, localDate } from '../src/market-research.mjs';
import { campaignFields, handleMarketingRequest } from '../src/marketing-admin.mjs';

const range={start:'2026-10-01',end:'2026-10-24'}, now=new Date('2026-10-24T16:00:00Z');
const lead=(fields={})=>({submittedAt:'2026-10-10T16:00:00Z',salesStatus:'New Lead',...fields});
test('job location uses explicit project evidence and keeps ambiguous locations unknown',()=>{
  assert.equal(marketForLead({postalCode:'07087'}).key,'Hudson, NJ');
  assert.equal(marketForLead({message:'Address: Hoboken, NJ\nNotes: kitchen'}).key,'Hudson, NJ');
  assert.equal(marketForLead({message:'Address: Springfield'}).key,'Unknown area');
  assert.equal(marketForLead({attribution:{landingPage:'/areas-we-serve/new-jersey/hoboken/'}}).key,'Unknown area');
  assert.equal(marketForLead({marketing:{market:'Bergen, NJ'},postalCode:'07087'}).key,'Bergen, NJ');
});
test('campaign tags, reported sources, and referrers are distinct from form placement',()=>{
  assert.equal(leadAcquisition({source:'Website Wizard - Hero'}).label,'Direct / unknown');
  assert.equal(leadAcquisition({attribution:{utmSource:'facebook',utmMedium:'paid_social',utmCampaign:'test_campaign'}}).campaign,'test_campaign');
  assert.equal(leadAcquisition({discoverySource:'referral'}).label,'Customer referral (reported)');
  assert.equal(leadAcquisition({attribution:{referrerHost:'www.stonebellisimollc.com'}}).known,false);
});
test('research excludes QA and undated records, counts each project once, and recognizes collected revenue only',()=>{
  const r=buildMarketReport({leads:[lead({salesStatus:'Estimate Scheduled'}),lead({salesStatus:'Job Completed',clientChargeCents:100000}),lead({salesStatus:'Invoice Collected',clientChargeCents:250000}),lead({source:'Codex production E2E test'}),{salesStatus:'Invoice Collected',clientChargeCents:999999}]},range,now);
  assert.deepEqual(r.totals,{leads:3,qualified:3,completed:2,collected:1,revenueCents:250000});
  assert.equal(r.coverage.excludedTestLeads,1);assert.equal(r.coverage.undatedLeads,1);
  assert.equal(r.coverage.located,0);assert.equal(r.budget.monthlyBudgetCents,10000);
});
test('comparison uses equal Eastern-time cohorts and does not call page views jobs or sessions',()=>{
  const r=buildMarketReport({leads:[lead({submittedAt:'2026-10-01T01:00:00Z'})],dimensions:[{date:'2026-10-20',dimension:'referrer',label:'google.com',count:17},{date:'2026-10-20',dimension:'page',label:'/areas-we-serve/new-jersey/',count:8}]},range,now);
  assert.equal(localDate('2026-10-01T01:00:00Z'),'2026-09-30');
  assert.equal(r.totals.leads,0);assert.equal(r.comparison.leads,1);
  assert.equal(r.website.referrers[0].pageViews,17);assert.equal(r.website.areaPages[0].pageViews,8);
});
test('recorded campaign costs are not guessed and campaign credit does not duplicate a lead',()=>{
  const campaigns=[{id:'campaign_one',utmCampaign:'sb_campaign_one',status:'tracking',budgetCents:10000,startDate:'2026-10-01'}];
  const leads=[lead({salesStatus:'Invoice Collected',clientChargeCents:200000,attribution:{utmCampaign:'sb_campaign_one'},marketing:{campaignId:'campaign_one'}})];
  let r=buildMarketReport({leads,campaigns},range,now);
  assert.equal(r.campaigns[0].metrics.leads,1);assert.equal(r.campaigns[0].recordedSpendCents,null);assert.equal(r.campaigns[0].recordedRoas,null);
  r=buildMarketReport({leads,campaigns,spend:[{campaignId:'campaign_one',date:'2026-10-10',amountCents:10000}]},range,now);
  assert.equal(r.campaigns[0].recordedRoas,20);assert.equal(r.budget.remainingCents,0);
  assert.equal(r.campaigns[0].costPerQualifiedCents,10000);
});
test('thin samples are exploratory and high-interest queries are suggestions with visible thresholds',()=>{
  const r=buildMarketReport({leads:[lead({postalCode:'07087',salesStatus:'Job Completed'})],searchRows:[{date:'2026-10-15',query:'quartz countertops',impressions:50,clicks:1}]},range,now);
  assert.match(r.recommendations.find(r=>r.market).evidence,/too small/);
  assert.equal(r.search.opportunities[0].query,'quartz countertops');
});
test('campaign input validation protects the budget, geography, dates, and actor',async()=>{
  const valid={name:'Local test',platform:'facebook',market:'Hudson, NJ',budget:'100',startDate:'2026-10-01',endDate:'2026-10-14'};
  assert.equal(campaignFields(valid,null,10000,now).budgetCents,10000);
  for(const patch of [{budget:'100.01'},{market:'invented'},{platform:'unsupported'},{endDate:'2026-11-01'},{budget:'NaN'}]) assert.throws(()=>campaignFields({...valid,...patch},null,10000,now));
  const response=await handleMarketingRequest(new Request('https://example.com/api/admin/marketing/report'),null);
  assert.equal(response.status,401);
});
