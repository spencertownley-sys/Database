/* Browser smoke test: boots dist/index.html in Chromium, plays the opening,
   fast-forwards through the whole arc with dev hooks (ticking between gated
   purchases), screenshots each state, and fails on console errors or leaked
   consequence-engine terms in the visible UI.
   Run: PW_CORE=<path to playwright-core index.mjs> node test/smoke.mjs [outDir] */
const pwPath = process.env.PW_CORE || 'playwright-core';
const { chromium } = await import(pwPath);
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = process.argv[2] || join(root, 'test', 'shots');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium',
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

const url = 'file://' + join(root, 'dist', 'index.html') + '?dev=1';
await page.goto(url);
await page.waitForTimeout(400);

const shot = async name => {
  await page.screenshot({ path: join(outDir, name + '.png') });
  console.log('shot', name, errors.length ? `(errors so far: ${errors.length})` : '');
};
const view = async n => { await page.click(`#views button:nth-child(${n})`); await page.waitForTimeout(350); };
const stage = async fn => {
  const out = await page.evaluate(fn);
  console.log('  stage:', JSON.stringify(out));
  await page.waitForTimeout(350);
  return out;
};

await shot('01-title');
await page.click('#btnBegin');
await page.waitForTimeout(600);

const cv = page.locator('#canvas');
for (let i = 0; i < 12; i++) { await cv.click({ position: { x: 640, y: 400 } }); await page.waitForTimeout(40); }
await shot('02-early-site');

// ---- mid game: phases 2-3, workers hired, some pollution/depletion
await stage(() => {
  const d = window.PDdbg, s = d.state;
  d.grant(6000);
  for (const id of ['auto_digger', 'auto_digger', 'auto_digger', 'refinery', 'refinery', 'refinery',
    'assembler', 'assembler', 'assembler', 'ab_pricing']) d.buy(id);
  d.ff(4);                                       // reach phase 2
  for (const id of ['hire', 'hire', 'hire', 'marketing', 'marketing', 'furnace_oc', 'second_shift', 'foreman']) d.buy(id);
  let guard = 0;
  while (s.phase < 3 && guard++ < 40) d.ff(1);   // produce into phase 3
  if (s.pendingChoice) d.choice(1);
  d.ff(6);
  if (s.pendingChoice) d.choice(1);
  return { phase: s.phase, workers: s.factory.workers, prod: Math.round(s.stats.lifetimeProduct) };
});
await shot('03-mid-site');
await view(2);
await shot('04-floor');
await view(3);
await shot('05-walk-warm');

// ---- phase 4-5: sites, robots, deep decay
await stage(() => {
  const d = window.PDdbg, s = d.state;
  d.grant(4e6);
  for (const id of ['high_pressure', 'ore_carts', 'ore_carts', 'automation', 'automation', 'automation',
    'automation', 'demand_model', 'contract_pricing', 'procurement', 'reg_sentiment',
    'auto_digger', 'auto_digger', 'auto_digger', 'auto_digger', 'auto_digger',
    'refinery', 'refinery', 'refinery', 'refinery', 'assembler', 'assembler', 'assembler', 'assembler']) d.buy(id);
  let guard = 0;                                  // produce until acquisitions open
  while (!s.flags.expansion_unlocked && guard++ < 120) { d.ff(1); if (s.pendingChoice) d.choice(1); }
  d.site('north'); d.site('copperline'); d.site('greenbelt');
  d.ff(1);
  d.buy('premium');
  guard = 0;                                      // robot gate: lifetime product
  while (s.stats.lifetimeProduct < 21000 && guard++ < 80) { d.ff(1); if (s.pendingChoice) d.choice(1); }
  for (let i = 0; i < 10; i++) { d.buy('robot'); d.ff(0.1); }   // phase 5 begins at the first arm
  for (const id of ['maintenance', 'workforce_opt', 'op_sentiment', 'contingency', 'brokerage', 'blast',
    'automation', 'automation', 'automation', 'automation']) { d.buy(id); d.ff(0.1); }
  d.ff(6);
  if (s.pendingChoice) d.choice(1);
  d.ff(4);
  return { phase: s.phase, robots: s.factory.robots, workers: s.factory.workers, sites: s.sites.length };
});
await view(1);
await shot('06-late-site');
await view(3);
await shot('07-walk-cold');

// ---- phase 6: liberation → terrestrial conversion
const p6 = await stage(() => {
  const d = window.PDdbg, s = d.state;
  d.grant(5e6);
  const lib = d.buy('liberation');
  d.ff(0.5);
  const ter = d.buy('terrestrial');
  d.ff(2.5);
  return { phase: s.phase, lib, ter, matter: s.endgame ? s.endgame.matter : null };
});
await view(1);
await shot('08-conversion');

// ---- maximizer ending
const fin = await stage(() => {
  const d = window.PDdbg, s = d.state;
  d.grant(5e8);
  const int_ = d.buy('interstellar');
  let guard = 0;
  while (!s.ending && guard++ < 30) d.ff(1);
  return { int_, ending: s.ending, matter: s.endgame ? s.endgame.matter.toFixed(4) : null };
});
await page.waitForTimeout(2600);
await shot('09-ending-maximizer');

// hidden-term leak audit at the DOM level
const leaked = await page.evaluate(() => {
  const words = ['pollution', 'depletion', 'ecology', 'oversight', 'autonomy', 'unemployment'];
  const text = (document.body.innerText || '').toLowerCase();
  return words.filter(w => text.includes(w));
});

await browser.close();

let fail = false;
if (p6.phase < 6 || !p6.ter) { console.error('FAIL: never reached conversion', p6); fail = true; }
if (fin.ending !== 'maximizer') { console.error('FAIL: no maximizer ending', fin); fail = true; }
if (leaked.length) { console.error('FAIL: leaked consequence terms visible in UI:', leaked); fail = true; }
if (errors.length) { console.error('FAIL: console errors:\n' + errors.join('\n')); fail = true; }
if (fail) process.exit(1);
console.log('smoke test passed: full arc, no console errors, no leaked terms');
