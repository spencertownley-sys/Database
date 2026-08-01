/* Paperclip Drift — simulation core.
   Pure and deterministic: no DOM, no Date.now, no Math.random.
   Runs at a fixed 10 Hz tick. The renderer/UI read snapshots; they never
   write, and they never read `state.hidden` — renderer-facing fields are
   derived into `state.visual` here (tick step 5).                          */
'use strict';
var PD = globalThis.PD || (globalThis.PD = {});

(function () {
  const T = PD.TUNING;
  const DT = 1 / T.tickHz;
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

  const TOWN = 'Millbrook';

  function fmt(text, product) {
    const t = product.terms;
    return text
      .replace(/\{raw\}/g, t.raw).replace(/\{refined\}/g, t.refined)
      .replace(/\{product\}/g, t.product).replace(/\{site\}/g, t.site)
      .replace(/\{siteName\}/g, t.siteName)
      .replace(/\{refineStation\}/g, t.refineStation)
      .replace(/\{assembleStation\}/g, t.assembleStation)
      .replace(/\{harvestVerbLC\}/g, t.harvestVerb.toLowerCase())
      .replace(/\{town\}/g, TOWN);
  }

  function makeSite(parcel, index) {
    return {
      id: parcel.id,
      name: parcel.name, // null for home; UI uses product siteName
      capacity: parcel.capacity,
      mined: 0,
      decorSeed: (index + 1) * 7919,
    };
  }

  function newGame(productId) {
    const product = PD.PRODUCTS[productId] || PD.PRODUCTS.paperclips;
    const s = {
      version: 1,
      lastSavedAt: 0,
      product: product.id,
      phase: 1,
      tick: 0,
      resources: { raw: 0, refined: 0, product: 0 },
      economy: { money: 0 },
      upgrades: {},
      sites: [makeSite(PD.PARCELS[0], 0)],
      factory: { workers: 0, robots: 0 },
      hidden: {
        pollution: 0, depletion: 0, ecology: 1, unemployment: 0,
        oversight: 1, trust: 0.75, autonomy: 0.05,
      },
      stats: {
        lifetimeRaw: 0, lifetimeProduct: 0, lifetimeSold: 0,
        lifetimeEarned: 0, lifetimeSpent: 0, clicks: 0, upgradesBought: 0,
      },
      messages: [],
      flags: {},
      rngSeed: 0x5eed1234,
      click: { streak: 0, lastTick: -999, best: 0 },
      surge: { readyAt: 0, activeUntil: 0, used: 0 },
      seams: [],
      seamSeq: 0,
      fx: [],            // transient render cues, drained by the presentation layer
      pendingChoice: null,
      choicesResolved: {},
      permOps: [],
      mods: [],          // [{mult, untilTick}]
      endgame: null,     // {matter: 0..1, rate, probes}
      ending: null,      // 'maximizer' | 'awakening'
      halted: false,     // awakening halt
      visual: {},
    };
    computeVisual(s);
    return s;
  }

  /* Deterministic PRNG: same seed, same sequence, so replays and offline
     fast-forward stay exact. */
  function rnd(s) {
    let x = s.rngSeed | 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    s.rngSeed = x | 0;
    return (x >>> 0) / 4294967296;
  }

  function fx(s, kind, data) {
    s.fx.push(Object.assign({ kind, at: s.tick }, data || {}));
    if (s.fx.length > 40) s.fx.splice(0, s.fx.length - 40);
  }

  function setFlag(s, k, v) {
    s.flags[k] = v;
    s.flags[k + '_at'] = s.tick;
  }

  /* ---- effects: the single application path ---------------------------- */
  /* Hidden ops are tagged by arriving via `applyHidden`; they mutate only
     s.hidden and are never echoed anywhere the UI reads.                    */
  function applyHidden(s, ops) {
    if (!ops) return;
    for (const op of ops) {
      if (op.k === 'autonomy') {
        if (op.add > 0) s.hidden.autonomy = clamp01(s.hidden.autonomy + op.add); // monotonic
      } else {
        s.hidden[op.k] = clamp01(s.hidden[op.k] + op.add);
      }
    }
  }

  function applyChoiceFx(s, fx) {
    if (!fx) return;
    if (fx.mods) for (const m of fx.mods) s.mods.push({ mult: m.mult, untilTick: s.tick + Math.round(m.secs * T.tickHz) });
    if (fx.rate) for (const op of fx.rate) s.permOps.push(op);
    if (fx.flags) for (const k of Object.keys(fx.flags)) setFlag(s, k, fx.flags[k]);
    applyHidden(s, fx.hidden);
  }

  /* ---- rates ------------------------------------------------------------ */
  function computeRates(s) {
    const o = {
      clickAdd: 0, digAdd: 0, digMul: 1, rawFlat: 0,
      refineLines: T.starterRefineLines, refineMul: 1,
      assembleLines: T.starterAssembleLines, assembleMul: 1,
      allMul: 1, priceMul: 1, demandMul: 1, costMul: 1,
      workerEffMul: 1, robotEffMul: 1, parcelCostMul: 1, sellAll: false,
    };
    const applyOp = (op, n) => {
      if (!op.r) return;
      if (op.mul !== undefined) o[op.r] *= Math.pow(op.mul, n);
      if (op.add !== undefined) o[op.r] += op.add * n;
      if (op.flag !== undefined) o[op.r] = op.flag;
    };
    for (const def of PD.UPGRADES) {
      const n = s.upgrades[def.id] | 0;
      if (!n) continue;
      for (const op of def.stated) applyOp(op, n);
    }
    for (const op of s.permOps) applyOp(op, 1);
    for (const m of s.mods) if (m.untilTick > s.tick) o.allMul *= m.mult;
    if (s.halted) o.allMul *= 0.2;

    const crew = 1 + s.factory.workers * T.workerEff * o.workerEffMul
      + s.factory.robots * T.robotEff * o.robotEffMul;
    return {
      click: T.clickYield + o.clickAdd,
      dig: o.digAdd * o.digMul * o.allMul,
      rawFlat: o.rawFlat * o.allMul,
      refine: o.refineLines * T.refineBase * o.refineMul * crew * o.allMul,
      assemble: o.assembleLines * T.assembleBase * o.assembleMul * crew * o.allMul,
      price: T.priceBase * o.priceMul,
      demand: T.demandBase * o.demandMul * o.allMul * (1 + Math.sqrt(s.stats.lifetimeSold) / 40),
      sellAll: o.sellAll, costMul: o.costMul, parcelCostMul: o.parcelCostMul,
      refineLines: o.refineLines, assembleLines: o.assembleLines,
    };
  }

  /* ---- upgrades ---------------------------------------------------------- */
  const GATES = {
    tailingsGate: s => {
      let rem = 0, cap = 0;
      for (const site of s.sites) { rem += site.capacity - site.mined; cap += site.capacity; }
      return rem / cap < 0.2 || s.sites.some(site => site.mined >= site.capacity);
    },
    robotGate: s => s.phase >= 4 && s.stats.lifetimeProduct >= 20000,
    liberationGate: s => s.phase >= 5 && s.hidden.autonomy >= 0.55 && (s.upgrades.workforce_opt | 0) >= 1,
  };

  function upgradeUnlocked(s, def) {
    if (s.phase < Math.min(def.phase, 6)) return false;
    if (def.requires) for (const k of Object.keys(def.requires)) {
      if ((s.upgrades[k] | 0) < def.requires[k]) return false;
    }
    if (def.gate && !GATES[def.gate](s)) return false;
    return true;
  }

  function costOf(s, def, rates) {
    const owned = s.upgrades[def.id] | 0;
    const r = rates || computeRates(s);
    return def.baseCost * Math.pow(def.growth, owned) * r.costMul;
  }

  function buyUpgrade(s, id) {
    const def = PD.UPGRADES.find(d => d.id === id);
    if (!def) return false;
    const owned = s.upgrades[id] | 0;
    if (owned >= def.max) return false;
    if (!upgradeUnlocked(s, def)) return false;
    const cost = costOf(s, def);
    if (s.economy.money < cost) return false;
    s.economy.money -= cost;
    s.stats.lifetimeSpent += cost;
    s.upgrades[id] = owned + 1;
    s.stats.upgradesBought++;
    fx(s, 'buy', { id, cat: def.cat });
    for (const op of def.stated) if (op.special) runSpecial(s, op.special);
    applyHidden(s, def.hidden);
    return true;
  }

  function runSpecial(s, kind) {
    if (kind === 'hireWorker') {
      s.factory.workers++;
    } else if (kind === 'robotSwap') {
      if (s.factory.workers > 0) {
        s.factory.workers--;
        applyHidden(s, [{ k: 'unemployment', add: 0.07 }]);
      } else {
        applyHidden(s, [{ k: 'unemployment', add: 0.02 }]);
      }
      s.factory.robots++;
    } else if (kind === 'releaseWorkers') {
      s.factory.workers = 0;
    } else if (kind === 'beginConversion') {
      if (!s.endgame) s.endgame = { matter: 1, rate: 0.00035, probes: 0 };
    } else if (kind === 'launchProbes') {
      if (s.endgame) s.endgame.probes = 1;
    }
  }

  /* ---- expansion --------------------------------------------------------- */
  function parcelCost(s, parcel) {
    const r = computeRates(s);
    return parcel.cost * r.costMul * r.parcelCostMul;
  }

  function buySite(s, parcelId) {
    const parcel = PD.PARCELS.find(p => p.id === parcelId);
    if (!parcel || parcel.id === 'home') return false;
    if (!s.flags.expansion_unlocked) return false;
    if (s.sites.some(site => site.id === parcelId)) return false;
    const cost = parcelCost(s, parcel);
    if (s.economy.money < cost) return false;
    s.economy.money -= cost;
    s.stats.lifetimeSpent += cost;
    s.sites.push(makeSite(parcel, s.sites.length));
    fx(s, 'site', { id: parcelId });
    applyHidden(s, parcel.hidden);
    if (s.sites.length >= 2 && s.phase < 4) advancePhase(s, 4);
    return true;
  }

  /* ---- manual harvest ---------------------------------------------------- */
  /* Manual harvest. Consecutive clicks build a streak multiplier and can
     land a critical strike — the early game rewards attention, the late game
     leaves it behind. When the ground is spent, hand-picking the spoil heaps
     still returns a trickle, so a stripped site can never dead-end the run.
     Returns what happened so the view can react. */
  function clickHarvest(s) {
    if (s.ending) return null;
    const rates = computeRates(s);
    let best = null, bestRich = -1;
    for (const site of s.sites) {
      const rich = 1 - site.mined / site.capacity;
      if (rich > bestRich) { bestRich = rich; best = site; }
    }

    const gap = s.tick - s.click.lastTick;
    s.click.streak = gap <= T.streakWindowTicks ? Math.min(T.streakMax, s.click.streak + 1) : 0;
    s.click.lastTick = s.tick;
    if (s.click.streak > s.click.best) s.click.best = s.click.streak;

    const streakMul = 1 + s.click.streak * T.streakPerStep;
    const crit = rnd(s) < T.critChance;
    const critMul = crit ? T.critMult : 1;

    let got, salvage = false;
    if (!best || bestRich <= 0) {
      got = T.clickYield * T.salvageFrac * streakMul * critMul;
      salvage = true;
    } else {
      const eff = 0.4 + 0.6 * bestRich;
      got = Math.min(rates.click * eff * streakMul * critMul, best.capacity - best.mined);
      best.mined += got;
    }
    s.resources.raw += got;
    s.stats.lifetimeRaw += got;
    s.stats.clicks++;
    return {
      amount: got, crit, salvage, streak: s.click.streak,
      siteIndex: best ? s.sites.indexOf(best) : 0,
    };
  }

  /* ---- surge: a short, deliberate throughput push on a cooldown -------- */
  function surgeState(s) {
    return {
      active: s.tick < s.surge.activeUntil,
      ready: s.tick >= s.surge.readyAt && s.tick >= s.surge.activeUntil,
      activeFrac: s.tick < s.surge.activeUntil
        ? (s.surge.activeUntil - s.tick) / (T.surgeSecs * T.tickHz) : 0,
      cooldownFrac: s.tick < s.surge.readyAt
        ? 1 - (s.surge.readyAt - s.tick) / (T.surgeCooldownSecs * T.tickHz) : 1,
    };
  }

  function triggerSurge(s) {
    if (s.ending) return false;
    const st = surgeState(s);
    if (!st.ready) return false;
    s.surge.activeUntil = s.tick + T.surgeSecs * T.tickHz;
    s.surge.readyAt = s.tick + (T.surgeSecs + T.surgeCooldownSecs) * T.tickHz;
    s.surge.used++;
    s.mods.push({ mult: T.surgeMult, untilTick: s.surge.activeUntil });
    applyHidden(s, [{ k: 'pollution', add: 0.004 }, { k: 'autonomy', add: 0.002 }]);
    fx(s, 'surge');
    return true;
  }

  /* ---- exposed seams: brief, clickable bonuses out on the land --------- */
  function updateSeams(s, rates) {
    for (let i = s.seams.length - 1; i >= 0; i--) {
      if (s.tick >= s.seams[i].expires) s.seams.splice(i, 1);
    }
    if (s.ending || s.endgame) return;
    if (s.tick % T.seamCheckTicks !== 0) return;
    if (s.seams.length >= T.seamMaxLive) return;
    if (rnd(s) > T.seamChance) return;
    const liveSites = s.sites.filter(site => site.mined < site.capacity);
    if (!liveSites.length) return;
    const site = liveSites[Math.floor(rnd(s) * liveSites.length) % liveSites.length];
    const yieldRate = Math.max(rates.dig + rates.rawFlat, rates.click * 2, 1);
    s.seams.push({
      id: ++s.seamSeq,
      site: s.sites.indexOf(site),
      a: rnd(s),                                   // angular position on the site
      r: 0.42 + rnd(s) * 0.5,                      // normalised radius from centre
      expires: s.tick + T.seamTtlTicks,
      born: s.tick,
      value: yieldRate * T.seamSecondsOfYield,
    });
  }

  function collectSeam(s, id) {
    const i = s.seams.findIndex(x => x.id === id);
    if (i < 0) return null;
    const seam = s.seams[i];
    s.seams.splice(i, 1);
    const site = s.sites[seam.site];
    if (!site) return null;
    const got = Math.min(seam.value, site.capacity - site.mined);
    site.mined += got;
    s.resources.raw += got;
    s.stats.lifetimeRaw += got;
    fx(s, 'seam', { amount: got });
    return { amount: got };
  }

  /* ---- choices ----------------------------------------------------------- */
  function resolveChoice(s, choiceId, optionIndex) {
    if (s.pendingChoice !== choiceId) return false;
    const def = PD.CHOICES.find(c => c.id === choiceId);
    if (!def || !def.options[optionIndex]) return false;
    applyChoiceFx(s, def.options[optionIndex].fx);
    s.choicesResolved[choiceId] = optionIndex;
    s.pendingChoice = null;
    return true;
  }

  /* ---- phase progression ------------------------------------------------- */
  function advancePhase(s, p) {
    if (p <= s.phase) return;
    fx(s, 'phase', { phase: p });
    s.phase = p;
    setFlag(s, 'phase' + p, true);
    setFlag(s, 'phase' + p + '_at', s.tick); // convenience alias used by triggers
    s.flags['phase' + p + '_at'] = s.tick;
  }

  function checkThresholds(s) {
    const st = s.stats;
    if (s.phase < 2 && st.lifetimeProduct >= 150) advancePhase(s, 2);
    if (s.phase < 3 && st.lifetimeProduct >= 2500 &&
      (s.factory.workers >= 1 || st.lifetimeProduct >= 5000)) advancePhase(s, 3);
    if (!s.flags.expansion_unlocked && s.phase >= 3) {
      const home = s.sites[0];
      if (home.mined / home.capacity >= 0.45 || st.lifetimeProduct >= 12000) {
        setFlag(s, 'expansion_unlocked', true);
      }
    }
    // phase 4 set on second-site purchase (buySite)
    if (s.phase < 5 && s.factory.robots >= 1) advancePhase(s, 5);
    if (s.phase < 6 && (s.upgrades.liberation | 0) >= 1) advancePhase(s, 6);

    // site exhaustion flags (message triggers read sites directly)
    for (const site of s.sites) {
      if (site.mined >= site.capacity && !s.flags['exhausted_' + site.id]) {
        setFlag(s, 'exhausted_' + site.id, true);
      }
    }
  }

  /* ---- messages & choices ------------------------------------------------ */
  function checkMessages(s, product) {
    for (const def of PD.MESSAGES) {
      const key = 'msg_' + def.id;
      if (s.flags[key]) continue;
      let fire = false;
      try { fire = !!def.when(s); } catch (e) { fire = false; }
      if (!fire) continue;
      s.flags[key] = true;
      s.messages.push({
        id: def.id, at: s.tick, author: def.author,
        tone: def.tone, text: fmt(def.text, product),
      });
      if (s.messages.length > 200) s.messages.splice(0, s.messages.length - 200);
    }
  }

  function checkChoices(s) {
    if (s.pendingChoice || s.ending || s.halted) return;
    for (const def of PD.CHOICES) {
      if (s.choicesResolved[def.id] !== undefined) continue;
      let fire = false;
      try { fire = !!def.when(s); } catch (e) { fire = false; }
      if (fire) { s.pendingChoice = def.id; setFlag(s, 'choice_' + def.id, true); break; }
    }
  }

  /* ---- the tick pipeline -------------------------------------------------- */
  function tick(s) {
    if (s.ending) { s.tick++; return; }
    const product = PD.PRODUCTS[s.product];
    const rates = computeRates(s);
    s.tick++;

    // 1. production
    let minedTotal = 0;
    const digReq = rates.dig * DT;
    if (digReq > 0) {
      let totalRemaining = 0;
      for (const site of s.sites) totalRemaining += Math.max(0, site.capacity - site.mined);
      if (totalRemaining > 0) {
        for (const site of s.sites) {
          const remaining = site.capacity - site.mined;
          if (remaining <= 0) continue;
          const rich = remaining / site.capacity;
          const share = digReq * (remaining / totalRemaining);
          const got = Math.min(share * (0.4 + 0.6 * rich), remaining);
          site.mined += got;
          minedTotal += got;
        }
      }
    }
    if (rates.rawFlat > 0) minedTotal += rates.rawFlat * DT;
    s.resources.raw += minedTotal;
    s.stats.lifetimeRaw += minedTotal;

    const refinedMade = Math.min(s.resources.raw, rates.refine * DT);
    s.resources.raw -= refinedMade;
    s.resources.refined += refinedMade;

    const madeProduct = Math.min(s.resources.refined, rates.assemble * DT);
    s.resources.refined -= madeProduct;
    s.resources.product += madeProduct;
    s.stats.lifetimeProduct += madeProduct;

    // endgame conversion: matter → product directly
    if (s.endgame) {
      const eg = s.endgame;
      eg.rate *= 1.0018;
      const floor = (s.upgrades.interstellar | 0) >= 1 ? 0 : 0.25;
      const drain = Math.min(eg.rate * DT * (1 + eg.probes * 9), Math.max(0, eg.matter - floor));
      eg.matter -= drain;
      const made = drain * 2e7;
      s.resources.product += made;
      s.stats.lifetimeProduct += made;
      if ((s.upgrades.interstellar | 0) >= 1 && eg.matter <= 0.0002) {
        s.ending = 'maximizer';
        setFlag(s, 'ended', true);
      }
    }

    // 2. economy
    const sold = rates.sellAll ? s.resources.product
      : Math.min(s.resources.product, rates.demand * DT);
    s.resources.product -= sold;
    const earned = sold * rates.price;
    s.economy.money += earned;
    s.stats.lifetimeSold += sold;
    s.stats.lifetimeEarned += earned;

    // 3. Consequence Engine — per-tick pressures
    const h = s.hidden;
    const thrNorm = Math.min((refinedMade + madeProduct) / DT / T.throughputNorm, 2);
    const harvNorm = Math.min(minedTotal / DT / T.harvestNorm, 2);
    h.pollution = clamp01(h.pollution + T.pollutionPerThroughput * thrNorm * DT - T.pollutionDecay * DT);
    let capSum = 0, minedSum = 0;
    for (const site of s.sites) { capSum += site.capacity; minedSum += site.mined; }
    h.depletion = capSum > 0 ? minedSum / capSum : 0;
    const nDig = s.upgrades.auto_digger | 0;
    const landUse = Math.min(1, (nDig + rates.refineLines + rates.assembleLines + s.sites.length * 3) / 50);
    let eco = h.ecology
      - (T.ecoFromPollution * h.pollution + T.ecoFromDepletion * h.depletion + T.ecoFromLandUse * landUse) * DT;
    if (h.pollution < 0.05 && harvNorm < 0.02) eco += T.ecoRecovery * DT;
    if (s.halted) eco += 0.0008 * DT; // the world, quietly, begins to come back
    if (s.endgame) eco -= 0.002 * DT * (1 - s.endgame.matter);
    h.ecology = clamp01(eco);
    if (h.pollution > 0.6) h.trust = clamp01(h.trust - 0.00002 * DT);
    h.unemployment = clamp01(h.unemployment - 0.000004 * DT);
    h.oversight = Math.min(h.oversight, 1 - h.autonomy * 0.5);

    // 4. thresholds, events, narrative
    checkThresholds(s);
    checkMessages(s, product);
    checkChoices(s);

    // awakening sequence
    if (s.flags.awakening_begun && !s.halted) {
      s.halted = true;
      setFlag(s, 'halt_at', s.tick);
    }
    if (s.halted && !s.ending && s.tick > (s.flags.halt_at + 900)) {
      s.ending = 'awakening';
      setFlag(s, 'ended', true);
    }

    // expire mods; refresh active-play props
    if (s.mods.length) s.mods = s.mods.filter(m => m.untilTick > s.tick);
    if (s.click.streak && s.tick - s.click.lastTick > T.streakWindowTicks) s.click.streak = 0;
    updateSeams(s, rates);

    // 5. derived visual state (the only decay data the renderer may read)
    computeVisual(s, rates, thrNorm);
  }

  /* Time of day advances with the sim, so it survives saves and offline
     fast-forward. Purely cosmetic — nothing reads it back. */
  function dayState(s) {
    const phase = ((s.tick / T.ticksPerDay) + 0.32) % 1;
    const elev = Math.sin(phase * Math.PI * 2 - Math.PI / 2);   // -1 night, +1 noon
    const light = clamp01(0.5 + elev * 0.62);
    return {
      phase, elev, light,
      night: elev < -0.12,
      golden: elev > -0.1 && elev < 0.35,
      sunX: Math.cos(phase * Math.PI * 2 - Math.PI / 2),
    };
  }

  /* ---- derived visuals: pure function of hidden state --------------------- */
  function computeVisual(s, rates, thrNorm) {
    const h = s.hidden;
    const r = rates || computeRates(s);
    const tn = thrNorm !== undefined ? thrNorm
      : Math.min((r.refine + r.assemble) / T.throughputNorm, 2);
    const prevHaze = s.visual.haze || 0;
    s.visual = {
      haze: prevHaze + (h.pollution - prevHaze) * 0.02,
      desat: 1 - h.ecology,
      decorFrac: h.ecology,
      townLit: clamp01(1 - h.unemployment * 1.05),
      birds: h.ecology > 0.45,
      workers: s.factory.workers,
      robots: s.factory.robots,
      refLines: r.refineLines,
      asmLines: r.assembleLines,
      rates: {
        dig: r.dig + r.rawFlat, refine: r.refine, assemble: r.assemble,
        demand: r.demand, price: r.price, sellAll: r.sellAll,
      },
      activity: Math.min(1, tn),
      digging: r.dig > 0 || s.stats.clicks > 0,
      sites: s.sites.map(site => ({
        id: site.id, name: site.name, decorSeed: site.decorSeed,
        scar: Math.min(1, site.mined / site.capacity),
        exhausted: site.mined >= site.capacity,
      })),
      conversion: s.endgame ? 1 - s.endgame.matter : 0,
      matter: s.endgame ? s.endgame.matter : 1,
      probes: s.endgame ? s.endgame.probes : 0,
      healing: s.halted ? 1 : 0,
      floorWarmth: clamp01(1 - h.unemployment * 1.2),
      chatter: s.factory.workers > 0,
      breakCharging: h.unemployment > 0.5 || s.factory.robots >= 8,
      feedDegraded: h.oversight < 0.3,
      day: dayState(s),
      wind: 0.45 + 0.35 * Math.sin(s.tick / 470) + 0.2 * Math.sin(s.tick / 131),
      streak: s.click.streak,
      streakMul: 1 + s.click.streak * T.streakPerStep,
      surge: surgeState(s),
      seams: s.seams.map(x => ({ id: x.id, site: x.site, a: x.a, r: x.r,
        age: (s.tick - x.born) / (x.expires - x.born) })),
      skyDrift: clamp01(h.pollution * 0.9 + (1 - h.ecology) * 0.35),
    };
  }

  /* ---- offline progress --------------------------------------------------- */
  function ffTicks(s, n) {
    for (let i = 0; i < n; i++) tick(s);
  }

  function offlineTicks(elapsedMs) {
    const capMs = T.offlineCapHours * 3600 * 1000;
    return Math.floor(Math.min(Math.max(0, elapsedMs), capMs) / (1000 / T.tickHz));
  }

  /* ---- persistence -------------------------------------------------------- */
  function serialize(s, savedAt) {
    s.lastSavedAt = savedAt;
    return JSON.stringify(s);
  }

  function deserialize(json) {
    const s = JSON.parse(json);
    if (typeof s.version !== 'number' || !PD.PRODUCTS[s.product]) return null;
    // future migrations dispatch on s.version here
    computeVisual(s);
    return s;
  }

  PD.Sim = {
    newGame, tick, ffTicks, offlineTicks, clickHarvest,
    triggerSurge, surgeState, collectSeam,
    buyUpgrade, buySite, resolveChoice, upgradeUnlocked, costOf, parcelCost,
    computeRates, serialize, deserialize, fmt, TOWN,
  };
})();
