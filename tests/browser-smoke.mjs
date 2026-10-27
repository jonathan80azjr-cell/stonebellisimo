import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { chromium } from 'playwright';

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Run browser smoke tests through the Firebase Emulator Suite.');
}
const projectId = process.env.GCLOUD_PROJECT || 'demo-stonebellisimo';
initializeApp({ projectId });
const auth = getAuth();
const db = getFirestore();
const site = process.env.SB_SMOKE_BASE_URL || 'http://127.0.0.1:5002';
const email = 'dashboard.admin@example.com';
const password = 'Secure!Dashboard123';
let user;
try { user = await auth.getUserByEmail(email); }
catch { user = await auth.createUser({ email, password, emailVerified: true }); }
await auth.setCustomUserClaims(user.uid, { admin: true });
await db.collection('leads').doc('browser_lead').set({
  id: 'browser_lead', customerName: 'Browser Test Client', firstName: 'Browser', lastName: 'Client',
  email: 'client@example.com', phone: '2015550199', projectType: 'Kitchen Countertops', material: 'Quartz',
  source: 'Browser Smoke', message: 'Responsive dashboard test', submittedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), feedbackEmailDueAt: new Date(Date.now() + 86400000).toISOString(),
  feedbackStatus: 'pending', feedbackEmailAttemptCount: 0
});

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${site}/admin/`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Welcome back.' }).waitFor();
  assert.equal(await page.locator('.login-logo').getAttribute('alt'), 'Stone Bellisimo LLC');
  assert.equal(await page.locator('#signInGoogle').isVisible(), true, 'Google sign-in must be offered');
  await page.locator('#loginEmail').fill(email);
  await page.locator('#loginPassword').fill(password);
  await page.locator('#signIn').click();
  await page.getByRole('heading', { name: 'Leads & follow-up' }).waitFor();
  await page.locator('.lead-row', { hasText: 'Browser Test Client' }).waitFor();
  await page.locator('.lead-row', { hasText: 'Browser Test Client' }).click();
  await page.locator('#salesStatus').waitFor();
  assert.deepEqual(await page.locator('#salesStatus option:not([disabled])').allTextContents(), ['Estimate Scheduled', 'Job Completed', 'Invoice Collected']);
  assert.equal(await page.locator('#leadDesignation').count(), 0);
  assert.equal(await page.locator('#salesStatus').inputValue(), '');
  await page.locator('#saveBusiness').click();
  await page.getByText('Choose a growth outcome before saving.', { exact: true }).waitFor();

  const metric = label => page.locator('#leadStats .metric-card').filter({ has: page.locator('span', { hasText: new RegExp(`^${label}$`) }) }).locator('strong');
  const initialQualified = Number((await metric('Qualified').textContent()).replace(/,/g, ''));
  const initialCompleted = Number((await metric('Jobs completed').textContent()).replace(/,/g, ''));
  const initialShare = Number((await metric('Bite Sites share').textContent()).replace(/[$,]/g, ''));
  async function saveOutcome(outcome) {
    await page.locator('#salesStatus').selectOption(outcome);
    const saved = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/api/admin/leads/browser_lead'));
    const refreshed = page.waitForResponse(response => response.request().method() === 'GET' && response.url().includes('/api/admin/leads?'));
    await page.locator('#saveBusiness').click();
    assert.equal((await saved).status(), 200);
    await refreshed;
    await page.waitForFunction(() => !document.getElementById('saveBusiness')?.disabled);
  }
  await saveOutcome('Estimate Scheduled');
  assert.equal(await metric('Qualified').textContent(), String(initialQualified + 1));
  assert.equal(await metric('Jobs completed').textContent(), String(initialCompleted));
  assert.equal((await db.collection('leads').doc('browser_lead').get()).data().designation, null);

  await saveOutcome('Job Completed');
  assert.equal(await metric('Qualified').textContent(), String(initialQualified + 1));
  assert.equal(await metric('Jobs completed').textContent(), String(initialCompleted + 1));

  await page.locator('#salesStatus').selectOption('Invoice Collected');
  await page.locator('#saveBusiness').click();
  await page.getByText('Enter the amount charged to the client before marking this lead completed.', { exact: true }).first().waitFor();
  assert.equal((await db.collection('leads').doc('browser_lead').get()).data().salesStatus, 'Job Completed');
  assert.equal(await metric('Jobs completed').textContent(), String(initialCompleted + 1));

  await page.locator('#clientCharge').fill('12345.67');
  await saveOutcome('Invoice Collected');
  await saveOutcome('Invoice Collected');
  assert.equal(await metric('Qualified').textContent(), String(initialQualified + 1));
  assert.equal(await metric('Jobs completed').textContent(), String(initialCompleted + 1));
  assert.equal(Number((await metric('Bite Sites share').textContent()).replace(/[$,]/g, '')), initialShare + 1234.57);

  const cards = await page.locator('#leadStats').innerText();
  await page.locator('#leadStatus').selectOption('Estimate Scheduled');
  await page.locator('#leadList .empty-state').waitFor();
  assert.equal(await page.locator('#leadStats').innerText(), cards, 'filters must not change the dashboard totals');
  await page.locator('#leadStatus').selectOption('all');
  await page.locator('#salesStatus').waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#salesStatus').waitFor();
  assert.equal(await page.locator('#salesStatus').inputValue(), 'Invoice Collected');
  assert.equal(await page.locator('#leadStats').innerText(), cards);
  if (process.env.SB_SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.SB_SMOKE_SCREENSHOT, fullPage: true });
  await page.locator('[data-tab="analytics"]').first().click();
  await page.getByRole('heading', { name: 'Website analytics' }).waitFor();
  await page.getByRole('heading', { name: 'CTA impressions, clicks & CTR' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.mobile-tabs').evaluate(element => getComputedStyle(element).display), 'grid');
  await page.locator('.mobile-tabs [data-tab="leads"]').click();
  await page.locator('.lead-row', { hasText: 'Browser Test Client' }).waitFor();

  let submittedPayload;
  await page.route('**/api/contact', async route => {
    submittedPayload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await page.goto(`${site}/?utm_source=browser&utm_campaign=dashboard-test`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    window.openWizard('Browser Smoke');
    window.selectOpt(document.querySelector('#wz1 .wz-opt'), 'project', 'Kitchen Countertops');
    window.nextStep(2);
    window.selectOpt(document.querySelector('#wz2 .wz-opt'), 'material', 'Granite');
    window.nextStep(3);
    window.selectOpt(document.querySelector('#wz3 .wz-opt'), 'size', 'Under 30 sqft');
    window.nextStep(4);
    window.selectOpt(document.querySelector('#wz4 .wz-opt'), 'timeline', 'As soon as possible');
    window.nextStep(5);
  });
  await page.locator('#wzFirst').fill('Browser');
  await page.locator('#wzLast').fill('Lead');
  await page.locator('#wzPhone').fill('2015550123');
  await page.locator('#wzEmail').fill('browser.lead@example.com');
  await page.locator('#wzZip').fill('07087');
  await page.locator('#wzDiscovery').selectOption('google');
  await page.locator('#wz5submit').click();
  await page.getByRole('heading', { name: 'Request sent!' }).waitFor();
  assert.equal(submittedPayload.postalCode, '07087');
  assert.equal(submittedPayload.discoverySource, 'google');
  assert.ok(submittedPayload.attribution.visitorId);
  assert.ok(submittedPayload.attribution.sessionId);
  assert.equal(submittedPayload.attribution.utmSource, 'browser');
  assert.equal(submittedPayload.attribution.utmCampaign, 'dashboard-test');

  await page.unroute('**/api/contact');
  await page.route('**/api/analytics/events', route => route.abort());
  await page.goto(`${site}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('a[href="./contact-us/"]:visible').first().click();
  await page.waitForURL('**/contact-us/');
  assert.match(page.url(), /\/contact-us\/$/, 'navigation must proceed even when analytics ingestion fails');
  console.info('Dashboard and site browser smoke checks passed.');
} finally {
  await browser.close();
}
