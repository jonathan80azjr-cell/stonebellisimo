import { chromium } from '/Users/maxj/Documents/stonebellisimo-main/node_modules/playwright/index.mjs';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const [, , mode] = process.argv; // 'still' | 'logo' | 'endcard'

const FPS = 30;
const browser = await chromium.launch();

async function openPage(file, query, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`file://${join(here, file)}?${query}`);
  await page.waitForFunction('window.__ready === true', null, { timeout: 20000 });
  return page;
}

async function renderSeq(page, dir, seconds, { alpha }) {
  mkdirSync(join(here, 'frames', dir), { recursive: true });
  const total = Math.round(seconds * FPS);
  for (let f = 0; f < total; f++) {
    await page.evaluate((ms) => window.seek(ms), (f / FPS) * 1000);
    await page.screenshot({
      path: join(here, 'frames', dir, `f_${String(f).padStart(4, '0')}.png`),
      omitBackground: alpha,
    });
    if (f % 30 === 0) console.log(`${dir}: ${f}/${total}`);
  }
  console.log(`${dir}: done (${total} frames)`);
}

if (mode === 'still') {
  // fidelity check stills
  const p1 = await openPage('logo.html', 'c=4c3631', 1920, 1080);
  await p1.evaluate(() => window.seek(5000));
  await p1.screenshot({ path: join(here, 'still_logo_brown.png') });
  await p1.evaluate(() => window.seek(1200));
  await p1.screenshot({ path: join(here, 'still_logo_mid.png') });
  await p1.close();
  const p2 = await openPage('endcard.html', '', 1080, 1920);
  await p2.evaluate(() => window.seek(7000));
  await p2.screenshot({ path: join(here, 'still_endcard.png') });
  await p2.close();
} else if (mode === 'logo') {
  const white = await openPage('logo.html', 'c=f5f1e7&shadow=1', 1920, 1080);
  await renderSeq(white, 'logo_white', 7, { alpha: true });
  await white.close();
  const brown = await openPage('logo.html', 'c=4c3631', 1920, 1080);
  await renderSeq(brown, 'logo_brown', 7, { alpha: true });
  await brown.close();
} else if (mode === 'endcard') {
  const page = await openPage('endcard.html', '', 1080, 1920);
  await renderSeq(page, 'endcard', 8, { alpha: false });
  // static poster
  await page.evaluate(() => window.seek(7500));
  await page.screenshot({ path: join(here, 'out', 'endcard_poster.png') });
  await page.close();
}

await browser.close();
console.log('render complete');
