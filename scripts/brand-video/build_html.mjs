import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const b64 = (p) => readFileSync(p).toString('base64');

const LOGO = b64('/Users/maxj/Documents/stonebellisimo-main/public/logo.png');
const CG = b64(join(here, 'fonts/CormorantGaramond-500.woff2'));
const INTER = b64(join(here, 'fonts/Inter-400.woff2'));

// Shared logo artwork component: measured from public/logo.png (1536x594)
// frame: left x=47, top y=77.5, right x=1499.5, bottom y=498.5 (center lines), stroke ~6
// bottom line gap starts x=969; right border ends y=368
// "Stone Bellisimo" bbox (184,201)-(1318,327); "Countertops" (1071,458)-(1507,535)
const ART = `
<div class="art">
  <svg viewBox="0 0 1536 594" xmlns="http://www.w3.org/2000/svg">
    <path id="framepath" d="M 969 498.5 H 63 Q 47 498.5 47 482.5 V 93.5 Q 47 77.5 63 77.5 H 1483.5 Q 1499.5 77.5 1499.5 93.5 V 368"
      fill="none" stroke-width="6" stroke-linecap="round"/>
  </svg>
  <div id="sbWrap"><canvas id="sb"></canvas></div>
  <div id="ctWrap"><canvas id="ct"></canvas></div>
</div>`;

const ART_JS = `
const LOGO_SRC = 'data:image/png;base64,${LOGO}';
function hexToRgb(h){ return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]; }
async function colorize(canvas, sx, sy, sw, sh, rgb, img){
  canvas.width = sw; canvas.height = sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const id = ctx.getImageData(0, 0, sw, sh); const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const L = 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
    let a = (232 - L) / (232 - 58);
    a = Math.max(0, Math.min(1, a));
    d[i] = rgb[0]; d[i+1] = rgb[1]; d[i+2] = rgb[2]; d[i+3] = Math.round(a * 255);
  }
  ctx.putImageData(id, 0, 0);
}
async function initArt(colorHex){
  const rgb = hexToRgb(colorHex);
  const img = new Image(); img.src = LOGO_SRC; await img.decode();
  await colorize(document.getElementById('sb'), 176, 193, 1151, 143, rgb, img);
  await colorize(document.getElementById('ct'), 1063, 450, 453, 94, rgb, img);
  const p = document.getElementById('framepath');
  p.setAttribute('stroke', '#' + colorHex);
  const len = Math.ceil(p.getTotalLength()) + 2;
  p.style.strokeDasharray = len;
  p.style.setProperty('--plen', len);
  await document.fonts.ready;
}
window.seek = (ms) => { document.getAnimations().forEach(a => { a.currentTime = ms; }); };
`;

const ART_CSS = `
.art { position: absolute; width: 1536px; height: 594px; transform-origin: 0 0; }
.art svg { position: absolute; inset: 0; width: 100%; height: 100%; }
#sbWrap { position: absolute; left: 176px; top: 193px; }
#ctWrap { position: absolute; left: 1063px; top: 450px; }
* { animation-play-state: paused !important; }

#framepath {
  stroke-dashoffset: var(--plen, 4000);
  animation: draw 2.2s cubic-bezier(0.65, 0, 0.35, 1) 0.2s both;
}
@keyframes draw { from { stroke-dashoffset: var(--plen, 4000); } to { stroke-dashoffset: 0; } }

#sbWrap {
  opacity: 0;
  animation: bloomUp 2.0s cubic-bezier(0.22, 1, 0.36, 1) 0.8s both;
}
#ctWrap {
  opacity: 0;
  animation: bloomSide 1.4s cubic-bezier(0.22, 1, 0.36, 1) 2.0s both;
}
@keyframes bloomUp {
  from { opacity: 0; filter: blur(12px); transform: translateY(16px) scale(1.015); }
  60% { opacity: 1; }
  to { opacity: 1; filter: blur(0); transform: translateY(0) scale(1); }
}
@keyframes bloomSide {
  from { opacity: 0; filter: blur(8px); transform: translateX(-12px); }
  to { opacity: 1; filter: blur(0); transform: translateX(0); }
}
`;

// ---------- logo overlay page (1920x1080, transparent) ----------
const logoHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Cormorant Garamond'; font-weight: 300 700; src: url(data:font/woff2;base64,${CG}) format('woff2'); }
html, body { margin: 0; background: transparent; overflow: hidden; }
#stage { position: relative; width: 1920px; height: 1080px; animation: stageOut 0.9s cubic-bezier(0.4, 0, 0.2, 1) 5.9s both; }
@keyframes stageOut {
  from { opacity: 1; filter: blur(0); }
  to { opacity: 0; filter: blur(8px); }
}
.logo { position: absolute; left: 50%; top: 50%; width: 1440px; height: 557px; margin-left: -720px; margin-top: -279px; }
.logo.shadow { filter: drop-shadow(0 3px 16px rgba(0, 0, 0, 0.30)); }
.logo .art { transform: scale(0.9375); }
${ART_CSS}
</style></head><body>
<div id="stage"><div class="logo" id="logobox">${ART}</div></div>
<script>
${ART_JS}
const q = new URLSearchParams(location.search);
const color = q.get('c') || 'f5f1e7';
if (q.get('shadow') === '1') document.getElementById('logobox').classList.add('shadow');
initArt(color).then(() => { window.__ready = true; });
</script>
</body></html>`;

// ---------- end card page (1080x1920) ----------
const endHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Cormorant Garamond'; font-weight: 300 700; src: url(data:font/woff2;base64,${CG}) format('woff2'); }
@font-face { font-family: 'Inter'; font-weight: 100 900; src: url(data:font/woff2;base64,${INTER}) format('woff2'); }
html, body { margin: 0; background: #14100d; overflow: hidden; }
#stage { position: relative; width: 1080px; height: 1920px; background: #14100d; }
#glow {
  position: absolute; inset: -10%;
  background: radial-gradient(ellipse 70% 42% at 50% 30%, rgba(58, 45, 33, 0.85), rgba(20, 16, 13, 0) 68%);
  animation: glowDrift 8s cubic-bezier(0.4, 0, 0.6, 1) 0s both;
}
@keyframes glowDrift { from { transform: scale(1.08) translateY(12px); } to { transform: scale(1) translateY(0); } }
#grain { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0.05; }
#hairframe {
  position: absolute; inset: 48px; border: 1px solid rgba(209, 177, 122, 0.30);
  animation: fadeIn 1.6s ease-out 0.15s both;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.logo { position: absolute; left: 50%; top: 540px; width: 830px; height: 321px; margin-left: -415px; }
.logo .art { transform: scale(0.5404); }
${ART_CSS}

.stack { position: absolute; left: 0; right: 0; top: 985px; text-align: center; color: #f5f1e7; }
.rule { width: 150px; height: 1px; background: linear-gradient(90deg, transparent, #b39158 20%, #b39158 80%, transparent); margin: 0 auto; position: relative; }
.rule::after {
  content: ''; position: absolute; left: 50%; top: 50%; width: 7px; height: 7px;
  background: #b39158; transform: translate(-50%, -50%) rotate(45deg);
}
.tag { margin-top: 54px; font: 400 27px/1.9 'Inter', sans-serif; letter-spacing: 0.34em; color: #d1b68e; text-transform: uppercase; }
.tag .sub { font-size: 22px; letter-spacing: 0.30em; color: rgba(209, 182, 142, 0.72); }
.phone { margin-top: 74px; font: 500 104px/1 'Cormorant Garamond', Georgia, serif; letter-spacing: 0.045em; color: #f5f1e7; font-feature-settings: 'lnum' 1; }
.site { margin-top: 44px; font: 400 30px/1 'Inter', sans-serif; letter-spacing: 0.2em; color: rgba(245, 241, 231, 0.68); }
.cta { margin-top: 64px; font: 400 22px/1 'Inter', sans-serif; letter-spacing: 0.3em; text-transform: uppercase; color: rgba(179, 145, 88, 0.85); }

.in { opacity: 0; animation: riseIn 1.3s cubic-bezier(0.22, 1, 0.36, 1) both; }
.rule.in { animation-delay: 2.5s; }
.tag.in { animation-delay: 2.8s; }
.phone.in { animation-delay: 3.15s; }
.site.in { animation-delay: 3.5s; }
.cta.in { animation-delay: 3.9s; }
@keyframes riseIn {
  from { opacity: 0; filter: blur(6px); transform: translateY(26px); }
  to { opacity: 1; filter: blur(0); transform: translateY(0); }
}
</style></head><body>
<div id="stage">
  <div id="glow"></div>
  <canvas id="grain" width="1080" height="1920"></canvas>
  <div id="hairframe"></div>
  <div class="logo">${ART}</div>
  <div class="stack">
    <div class="rule in"></div>
    <div class="tag in">Custom Countertops<br><span class="sub">Hudson County &middot; New Jersey</span></div>
    <div class="phone in">201.553.1919</div>
    <div class="site in">stonebellisimollc.com</div>
    <div class="cta in">Call or Text &middot; Free Estimates</div>
  </div>
</div>
<script>
${ART_JS}
(() => {
  const g = document.getElementById('grain');
  const ctx = g.getContext('2d');
  const id = ctx.createImageData(1080, 1920);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.floor(Math.random() * 255);
    d[i] = v; d[i+1] = v; d[i+2] = v; d[i+3] = 255;
  }
  ctx.putImageData(id, 0, 0);
})();
initArt('f5f1e7').then(() => { window.__ready = true; });
</script>
</body></html>`;

writeFileSync(join(here, 'logo.html'), logoHtml);
writeFileSync(join(here, 'endcard.html'), endHtml);
console.log('written logo.html + endcard.html');
