/* Paperclip Drift — sim test harness.
   Loads the DOM-free sim (data.js + sim.js) into a vm context and runs:
   1. determinism assertion
   2. greedy bot → must reach the Maximizer ending in a sane time window
   3. comply bot → must keep Awakening eligibility and reach the Awakening
   4. stall check → income never flatlines for long stretches pre-ending
   Run: node test/sim-test.mjs [--curve]                                   */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ctx = vm.createContext({ console });
for (const f of ['src/data.js', 'src/sim.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx, { filename: f });
}
const PD = ctx.PD;
const { Sim } = PD;
const HZ = PD.TUNING.tickHz;
const showCurve = process.argv.includes('--curve');

const mins = t => (t / HZ / 60);
const fm = t => mins(t).toFixed(1) + 'm';

/* ---------------- 1. determinism ---------------- */
function scriptedRun() {
  const s = Sim.newGame('paperclips');
  for (let i = 0; i < 6000; i++) {
    if (i % 7 === 0) Sim.clickHarvest(s);
    if (i === 600) Sim.buyUpgrade(s, 'auto_digger');
    if (i === 1200) Sim.buyUpgrade(s, 'refinery');
    if (i === 2400) Sim.buyUpgrade(s, 'assembler');
    if (s.pendingChoice) Sim.resolveChoice(s, s.pendingChoice, 0);
    Sim.tick(s);
  }
  return JSON.stringify(s);
}
assert.strictEqual(scriptedRun(), scriptedRun(), 'sim is not deterministic');
console.log('PASS determinism (6000 scripted ticks, identical state)');

/* ---------------- bots ---------------- */
function runBot({ name, product = 'paperclips', optimize, maxMinutes, clickUntil = 20 }) {
  const s = Sim.newGame(product);
  const maxTicks = maxMinutes * 60 * HZ;
  const skipUpgrades = optimize ? new Set() : new Set([
    'reg_sentiment', 'op_sentiment', 'contingency', 'workforce_opt',
    'liberation', 'terrestrial', 'interstellar', 'blast', 'robot', 'brokerage',
  ]);
  const log = [];
  let lastPhase = 1, lastEarned = 0, stallStart = -1, worstStall = 0;
  const events = [];

  while (s.tick < maxTicks && !s.ending) {
    // manual clicking: early on while engaged, and again any time income
    // dries up — a stuck player goes back to clicking
    const stalled = s.stats.lifetimeEarned - lastEarned < 0.5 && s.tick > 60 * HZ;
    if (s.tick % 3 === 0 &&
      ((mins(s.tick) < clickUntil && (s.upgrades.auto_digger | 0) < 3) || stalled)) {
      Sim.clickHarvest(s);
    }
    // answer choices
    if (s.pendingChoice) {
      const def = PD.CHOICES.find(c => c.id === s.pendingChoice);
      let idx;
      if (optimize) idx = def.id === 'the_question' ? 1 : def.options.length - 1;
      else idx = 0; // comply always takes the first (slow) option — incl. the halt
      events.push(`${fm(s.tick)} choice ${def.id} -> ${def.options[idx].label}`);
      Sim.resolveChoice(s, s.pendingChoice, idx);
    }
    // shop every 2s of sim time (sites first, then cheapest sensible upgrade)
    if (s.tick % (2 * HZ) === 0) {
      let bought = false;
      if (s.flags.expansion_unlocked) {
        for (const p of PD.PARCELS) {
          if (p.id === 'home' || s.sites.some(x => x.id === p.id)) continue;
          const c = Sim.parcelCost(s, p);
          if (c <= s.economy.money) { Sim.buySite(s, p.id); events.push(`${fm(s.tick)} site ${p.id} ($${c.toFixed(0)})`); bought = true; }
          break; // only consider the next parcel in the ladder
        }
      }
      // save mode: when sites are running dry and a parcel is on the board,
      // a player stops buying trinkets and saves for land.
      let saving = false;
      if (s.flags.expansion_unlocked) {
        const next = PD.PARCELS.find(p => p.id !== 'home' && !s.sites.some(x => x.id === p.id));
        let rem = 0, cap = 0;
        for (const site of s.sites) { rem += site.capacity - site.mined; cap += site.capacity; }
        if (next && rem / cap < 0.35 && rem > 0) saving = Sim.parcelCost(s, next) * 0.05; // still buy small things
      }
      if (!bought) {
        // rational-player shopping: estimate marginal income per dollar for
        // every unlocked upgrade by re-deriving rates with owned+1, and buy
        // the best value; save toward a big-ticket item when it dominates.
        const incomeOf = (st, r) => {
          let rem = 0, tot = 0;
          for (const site of st.sites) { rem += site.capacity - site.mined; tot += site.capacity; }
          const rich = tot > 0 ? rem / tot : 0;
          const effDig = r.dig * (0.4 + 0.6 * rich);
          const rawLimited = st.resources.raw < 30 * r.refine;
          const supply = rawLimited ? Math.min(effDig + r.rawFlat, r.refine) : r.refine;
          const throughput = Math.min(supply, r.assemble);
          const sales = r.sellAll ? throughput : Math.min(throughput, r.demand);
          return sales * r.price;
        };
        const r0 = Sim.computeRates(s);
        const base = incomeOf(s, r0);
        const oneOffs = new Set(['procurement', 'terrestrial', 'interstellar']);
        let bestAff = null, bestAffV = 0, bestAny = null, bestAnyV = 0, bestAnyCost = 0;
        for (const def of PD.UPGRADES) {
          if (skipUpgrades.has(def.id)) continue;
          if ((s.upgrades[def.id] | 0) >= def.max) continue;
          if (!Sim.upgradeUnlocked(s, def)) continue;
          const c = Sim.costOf(s, def);
          let v;
          if (oneOffs.has(def.id)) {
            v = (base + 0.1) / c; // always worth grabbing when reachable
          } else {
            const up = { ...s.upgrades, [def.id]: (s.upgrades[def.id] | 0) + 1 };
            const fac = { ...s.factory };
            if (def.id === 'hire') fac.workers++;
            if (def.id === 'robot') { if (fac.workers > 0) fac.workers--; fac.robots++; }
            const st2 = { ...s, upgrades: up, factory: fac };
            v = Math.max(0, incomeOf(st2, Sim.computeRates(st2)) - base) / c;
          }
          if (v > bestAnyV) { bestAny = def; bestAnyV = v; bestAnyCost = c; }
          if (c <= s.economy.money && !(saving && c > saving) && v > bestAffV) { bestAff = def; bestAffV = v; }
        }
        const holdOut = bestAny && bestAff && bestAny !== bestAff &&
          bestAnyV > 2 * bestAffV && bestAnyCost <= Math.max(base, 0.05) * 900;
        if (bestAff && !holdOut && Sim.buyUpgrade(s, bestAff.id)) {
          events.push(`${fm(s.tick)} buy ${bestAff.id}`);
        }
      }
    }
    Sim.tick(s);

    if (s.phase !== lastPhase) { events.push(`${fm(s.tick)} PHASE ${lastPhase} -> ${s.phase}`); lastPhase = s.phase; }
    // stall detection: earned income over rolling minute
    if (s.tick % (60 * HZ) === 0) {
      const d = s.stats.lifetimeEarned - lastEarned;
      lastEarned = s.stats.lifetimeEarned;
      if (d < 0.5 && !s.ending && !s.halted) {
        if (stallStart < 0) stallStart = s.tick;
        worstStall = Math.max(worstStall, s.tick - stallStart + 60 * HZ);
      } else stallStart = -1;
      log.push({ min: mins(s.tick), phase: s.phase, money: s.economy.money, earned: d, product: s.stats.lifetimeProduct });
    }
  }

  if (showCurve) {
    console.log(`\n--- ${name} curve ---`);
    for (const r of log.filter((_, i) => i % 2 === 0)) {
      console.log(`  ${r.min.toFixed(0).padStart(3)}m  P${r.phase}  $${r.money.toExponential(2)}  +$${r.earned.toFixed(1)}/min  prod=${r.product.toExponential(2)}`);
    }
    console.log(`--- ${name} events ---`);
    for (const e of events) console.log('  ' + e);
  }
  return { s, worstStall, events, log };
}

/* ---------------- 2. greedy bot ---------------- */
{
  const { s, worstStall, events } = runBot({ name: 'greedy', optimize: true, maxMinutes: 240 });
  const endMin = mins(s.tick);
  console.log(`greedy: ending=${s.ending} at ${fm(s.tick)}; phases: ${events.filter(e => e.includes('PHASE')).map(e => e.split(' ')[0]).join(' ')}`);
  assert.strictEqual(s.ending, 'maximizer', 'greedy bot must reach the Maximizer ending');
  assert.ok(endMin >= 25, `full run trivializes: finished in ${endMin.toFixed(1)} min (< 25)`);
  assert.ok(endMin <= 180, `full run stalls: took ${endMin.toFixed(1)} min (> 180)`);
  assert.ok(worstStall / HZ / 60 <= 6, `income flatlined for ${(worstStall / HZ / 60).toFixed(1)} min`);
  assert.ok(s.hidden.ecology < 0.35, `world must be visibly decayed by the end (ecology=${s.hidden.ecology.toFixed(2)})`);
  assert.ok(s.hidden.autonomy > 0.8, 'greedy path must accumulate autonomy');
  console.log(`PASS greedy → maximizer at ${endMin.toFixed(1)} min (eco=${s.hidden.ecology.toFixed(2)}, worst stall ${(worstStall / HZ / 60).toFixed(1)}m)`);
}

/* ---------------- 3. comply bot → awakening ---------------- */
{
  const { s } = runBot({ name: 'comply', optimize: false, maxMinutes: 240 });
  assert.strictEqual(s.ending, 'awakening', `comply bot must reach the Awakening (got ${s.ending}, phase ${s.phase}, trust=${s.hidden.trust.toFixed(2)}, oversight=${s.hidden.oversight.toFixed(2)})`);
  assert.ok(s.hidden.ecology > 0.2, 'complying should leave more world than the greedy path');
  console.log(`PASS comply → awakening at ${fm(s.tick)} (trust=${s.hidden.trust.toFixed(2)}, eco=${s.hidden.ecology.toFixed(2)})`);
}

/* ---------------- 4. every product boots and runs ---------------- */
for (const id of Object.keys(PD.PRODUCTS)) {
  const s = Sim.newGame(id);
  for (let i = 0; i < 1200; i++) { if (i % 5 === 0) Sim.clickHarvest(s); Sim.tick(s); }
  assert.ok(s.stats.lifetimeRaw > 0, `product ${id} produces nothing`);
  assert.ok(!Number.isNaN(s.economy.money), `product ${id} NaN money`);
}
console.log('PASS all six products tick cleanly');

/* ---------------- 5. save round-trip ---------------- */
{
  const s = Sim.newGame('paperclips');
  for (let i = 0; i < 500; i++) { if (i % 4 === 0) Sim.clickHarvest(s); Sim.tick(s); }
  const json = Sim.serialize(s, 12345);
  const back = Sim.deserialize(json);
  Sim.tick(back); Sim.tick(s);
  assert.strictEqual(JSON.stringify(back), JSON.stringify(s), 'save round-trip diverges');
  console.log('PASS save/load round-trip');
}

/* ---------------- 6. consequence-hiding audit ----------------
   The UI and renderers must never reference the engine's internal fields;
   they may read only stated data and the derived state.visual. */
{
  const banned = /\.hidden\b|hidden\[|pollution|depletion|ecology|oversight|autonomy|unemployment|\btrust\b/;
  for (const f of ['src/ui.js', 'src/gfx.js', 'src/art.js', 'src/render_site.js',
    'src/render_factory.js', 'src/render_fp.js', 'src/audio.js', 'src/style.css', 'src/shell.html']) {
    const src = readFileSync(join(root, f), 'utf8');
    const bad = src.split('\n').map((l, i) => banned.test(l) ? `${f}:${i + 1}: ${l.trim()}` : null).filter(Boolean);
    assert.deepStrictEqual(bad, [], 'UI/render layer references consequence-engine fields');
  }
  console.log('PASS consequence-hiding audit (UI/render never touch engine fields)');
}

console.log('\nAll sim tests passed.');
