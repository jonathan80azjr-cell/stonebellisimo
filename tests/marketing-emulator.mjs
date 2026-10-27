import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { handleMarketingRequest, refreshMarketingSnapshot } from '../src/marketing-admin.mjs';
import { localDate, shiftDate } from '../src/market-research.mjs';
if(!process.env.FIRESTORE_EMULATOR_HOST)throw new Error('Emulator required.');
initializeApp({projectId:process.env.GCLOUD_PROJECT||'demo-stonebellisimo'});
const db=getFirestore(),date=localDate();
async function api(path,method='GET',body){const response=await handleMarketingRequest(new Request('http://localhost/api/admin/marketing/'+path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),db,{actor:'qa@example.com'});return {status:response.status,data:await response.json()};}
try{
 const body={id:'campaign_emulatortest',name:'Local test',platform:'facebook',market:'Hudson, NJ',budget:'100',startDate:date,endDate:date};
 assert.equal((await api('campaigns','POST',body)).status,200);
 assert.equal((await api('campaigns','POST',body)).status,200);
 assert.equal((await db.collection('marketing_campaigns').get()).size,1);
 assert.equal((await api('campaigns/'+body.id,'PATCH',{status:'tracking'})).status,200);
 await api('campaigns','POST',{...body,id:'campaign_secondtest'});
 assert.equal((await api('campaigns/campaign_secondtest','PATCH',{status:'tracking'})).status,400);
 assert.equal((await api('settings','PATCH',{monthlyBudget:'50'})).status,400);
 const offline={id:'manual_emulatortest',customerName:'Test customer',phone:'2015550199',acquiredDate:date,market:'Hudson, NJ',discoverySource:'facebook',campaignId:body.id,salesStatus:'Invoice Collected',clientCharge:'2000'};
 assert.equal((await api('offline-leads','POST',offline)).status,200);
 await api('offline-leads','POST',offline);
 assert.equal((await db.collection('leads').get()).size,1);
 for(let i=0;i<2;i++)assert.equal((await api('campaigns/'+body.id+'/spend','POST',{date,amount:'25.00'})).status,200);
 assert.equal((await db.collection('marketing_spend').get()).size,1);
 const report=(await api('report?refresh=1')).data.report;
 assert.equal(report.totals.completed,1);assert.equal(report.totals.revenueCents,200000);assert.equal(report.budget.recordedMonthSpendCents,2500);
 assert.equal(report.campaigns.find(c=>c.id===body.id).recordedRoas,80);
 assert.equal((await api('leads/manual_emulatortest','PATCH',{market:'Bergen, NJ',discoverySource:'referral'})).status,200);
 const revised=(await api('report')).data.report;
 assert.equal(revised.areas[0].label,'Bergen, NJ');
 assert.equal((await api('report?start=invalid')).status,400);
 await refreshMarketingSnapshot(db);await refreshMarketingSnapshot(db);
 assert.equal((await db.collection('marketing_snapshots').get()).size,1);
 console.log('Marketing persistence, idempotency, budget limits, snapshots, and source corrections passed.');
}finally{
 for(const collection of ['marketing_campaigns','marketing_spend','marketing_settings','marketing_report_cache','marketing_snapshots','leads']){
  const writer=db.bulkWriter();for(const doc of (await db.collection(collection).get()).docs)writer.delete(doc.ref);await writer.close();
 }
 await db.terminate();
}
