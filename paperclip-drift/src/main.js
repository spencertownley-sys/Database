/* Paperclip Drift — bootstrap, fixed-timestep loop, input, persistence.
   The only file that touches the wall clock.                                */
'use strict';
var PD = globalThis.PD || (globalThis.PD = {});

(function () {
  const SAVE_KEY = 'paperclip-drift-save';
  const TICK_MS = 1000 / PD.TUNING.tickHz;
  const Sim = PD.Sim, UI = PD.UI, G = PD.Gfx;

  let state = null;
  let acc = 0, lastFrame = 0, lastSave = 0, lastAudio = 0;
  let running = false, fastForwarding = false;
  let floaters = [];            // screen-space damage numbers
  let flash = null;             // brief full-screen wash on big beats
  let frameAcc = 0, frameCount = 0, perfCheckAt = 0;

  /* Watch real frame cost and step the rendering budget so the loop stays
     smooth on hardware that cannot afford the full pass. */
  function updateBudget(now, dtMs) {
    frameAcc += dtMs; frameCount++;
    if (now - perfCheckAt < 1500) return;
    perfCheckAt = now;
    const fps = frameCount / (frameAcc / 1000);
    frameAcc = 0; frameCount = 0;
    if (!isFinite(fps) || fps <= 0) return;
    G.perf.fps = fps;
    if (fps < 34 && G.perf.level > 0) G.perf.level--;
    else if (fps > 52 && G.perf.level < 2) G.perf.level++;
  }

  /* ---------------- persistence ---------------- */
  function save() {
    if (!state) return;
    try {
      localStorage.setItem(SAVE_KEY, Sim.serialize(state, Date.now()));
      UI.setSaveState('saved ' + new Date().toLocaleTimeString());
    } catch (e) {
      UI.setSaveState('save failed');
    }
  }

  function load() {
    try {
      const json = localStorage.getItem(SAVE_KEY);
      if (!json) return null;
      return Sim.deserialize(json);
    } catch (e) { return null; }
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  }

  /* ---------------- offline fast-forward (capped, chunked) --------------- */
  function fastForward(nTicks, done) {
    if (nTicks < 300) { Sim.ffTicks(state, nTicks); done(); return; }
    fastForwarding = true;
    UI.showOffline(0);
    const total = nTicks;
    const step = () => {
      const batch = Math.min(4000, nTicks);
      Sim.ffTicks(state, batch);
      nTicks -= batch;
      UI.showOffline(1 - nTicks / total);
      if (nTicks > 0) setTimeout(step, 0);
      else { fastForwarding = false; UI.hideOffline(); done(); }
    };
    setTimeout(step, 30);
  }

  /* ---------------- lifecycle ---------------- */
  function startNew(productId) {
    state = Sim.newGame(productId);
    resetViews();
    UI.enterGame(state);
    save();
    begin();
  }

  function startContinue() {
    const s = load();
    if (!s) { UI.showTitle(false); return; }
    state = s;
    resetViews();
    UI.enterGame(state);
    const elapsed = Date.now() - (state.lastSavedAt || Date.now());
    fastForward(Sim.offlineTicks(elapsed), () => save());
    begin();
  }

  function resetViews() {
    PD.RenderSite.resetView();
    PD.RenderFactory.resetView();
    PD.RenderSite.parts.clear();
    PD.RenderFactory.parts.clear();
    floaters = [];
  }

  function begin() {
    if (running) return;
    running = true;
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }

  function reset() {
    clearSave();
    state = null;
    document.getElementById('ending').classList.remove('on', 'reveal');
    UI.showTitle(false);
  }

  /* ---------------- feedback helpers ---------------- */
  function floater(x, y, text, kind) {
    floaters.push({ x, y, text, kind, t0: performance.now(), dx: (Math.random() - 0.5) * 26 });
    if (floaters.length > 26) floaters.shift();
  }

  const CAT_COLOUR = {
    extraction: [206, 158, 92], processing: [220, 150, 82], commerce: [214, 190, 108],
    workforce: [140, 178, 200], systems: [190, 170, 210],
  };

  function drainFx() {
    if (!state || !state.fx.length) return;
    const rm = UI.reducedMotion();
    for (const e of state.fx) {
      if (e.kind === 'phase') {
        UI.banner(PD.SCALE_LABELS[e.phase] || 'New phase', 'PHASE ' + ['', 'I', 'II', 'III', 'IV', 'V', 'VI'][e.phase]);
        if (!rm) { PD.RenderSite.cam.kick(9); flash = { t0: performance.now(), c: [255, 232, 190], life: 900 }; }
      } else if (e.kind === 'buy') {
        if (!rm) PD.RenderSite.cam.kick(2.2);
        UI.pulseRail(CAT_COLOUR[e.cat] || [200, 180, 140]);
      } else if (e.kind === 'site') {
        UI.banner('Holding acquired', 'ACQUISITIONS');
        if (!rm) PD.RenderSite.cam.kick(6);
      } else if (e.kind === 'surge') {
        if (!rm) { PD.RenderSite.cam.kick(7); PD.RenderFactory.cam.kick(7); }
      }
    }
    state.fx.length = 0;
  }

  /* ---------------- input ---------------- */
  function onHarvest(sx, sy) {
    if (!state || state.ending || fastForwarding) return;
    const cv = canvas();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // an exposed seam takes priority over plain ground
    if (sx !== undefined && UI.view === 'site') {
      const id = PD.RenderSite.pickSeam(sx * dpr, sy * dpr);
      if (id) {
        const got = Sim.collectSeam(state, id);
        if (got) {
          floater(sx, sy, '+' + fmtShort(got.amount) + ' ' + termRaw(), 'seam');
          if (!UI.reducedMotion()) {
            PD.RenderSite.burst(0, 0, [255, 226, 150], 0, false);
            PD.RenderSite.faceBurst(state, { siteIndex: UI.siteIndex }, [255, 224, 150], true);
            PD.RenderSite.cam.kick(6);
          }
          PD.Audio.ping(880, 0.16);
          return;
        }
      }
    }
    const res = Sim.clickHarvest(state);
    if (!res) return;
    const rm = UI.reducedMotion();
    if (sx !== undefined) {
      floater(sx, sy, (res.crit ? '✦ +' : '+') + fmtShort(res.amount) + (res.streak > 2 ? `  ×${(1 + res.streak * PD.TUNING.streakPerStep).toFixed(1)}` : ''),
        res.crit ? 'crit' : 'hit');
    }
    if (!rm) {
      const pal = PD.PRODUCTS[state.product].palette;
      PD.RenderSite.faceBurst(state, { siteIndex: UI.siteIndex },
        res.crit ? [255, 226, 150] : G.hex2rgb(pal.rock), res.crit);
      PD.RenderSite.cam.kick(res.crit ? 7 : 1.8);
    }
    PD.Audio.ping(res.crit ? 660 : 300 + Math.min(res.streak, 20) * 14, res.crit ? 0.2 : 0.09);
  }

  function onSurge() {
    if (!state || fastForwarding) return;
    if (Sim.triggerSurge(state)) {
      UI.banner('Compute reallocated', 'THROUGHPUT ×' + PD.TUNING.surgeMult);
      PD.Audio.ping(520, 0.3);
    }
  }

  const termRaw = () => PD.PRODUCTS[state.product].terms.raw;
  function fmtShort(n) {
    if (n < 10) return n.toFixed(1);
    if (n < 1000) return Math.round(n).toString();
    if (n < 1e6) return (n / 1e3).toFixed(1) + 'K';
    return (n / 1e6).toFixed(1) + 'M';
  }

  const canvas = () => document.getElementById('canvas');

  function bindInput() {
    const cv = canvas();
    let down = false, moved = 0, lastX = 0, lastY = 0, downX = 0, downY = 0;

    cv.addEventListener('pointerdown', e => {
      down = true; moved = 0;
      lastX = downX = e.clientX; lastY = downY = e.clientY;
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', e => {
      if (!down) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (UI.view === 'walk') { UI.pan -= dx; UI.walking = 6; return; }
      const cam = UI.view === 'floor' ? PD.RenderFactory.cam : PD.RenderSite.cam;
      cam.nudge(dx / cam.zoom, dy / cam.zoom);
    });
    const release = e => {
      if (!down) return;
      down = false;
      const r = cv.getBoundingClientRect();
      if (moved < 6 && UI.view !== 'walk') onHarvest(downX - r.left, downY - r.top);
    };
    cv.addEventListener('pointerup', release);
    cv.addEventListener('pointercancel', () => { down = false; });

    cv.addEventListener('wheel', e => {
      if (UI.view === 'walk') { UI.pan += e.deltaY; e.preventDefault(); return; }
      e.preventDefault();
      const cam = UI.view === 'floor' ? PD.RenderFactory.cam : PD.RenderSite.cam;
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cam.zoomBy(e.deltaY < 0 ? 1.13 : 1 / 1.13,
        (e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr, cv.width, cv.height);
    }, { passive: false });

    cv.addEventListener('dblclick', () => {
      (UI.view === 'floor' ? PD.RenderFactory.cam : PD.RenderSite.cam).reset();
    });

    window.addEventListener('keydown', e => {
      if (!state || e.target.tagName === 'INPUT') return;
      const cam = UI.view === 'floor' ? PD.RenderFactory.cam : PD.RenderSite.cam;
      switch (e.key) {
        case ' ': onSurge(); e.preventDefault(); break;
        case 'ArrowLeft': UI.view === 'walk' ? (UI.pan -= 60, UI.walking = 8) : cam.nudge(70, 0); break;
        case 'ArrowRight': UI.view === 'walk' ? (UI.pan += 60, UI.walking = 8) : cam.nudge(-70, 0); break;
        case 'ArrowUp': if (UI.view !== 'walk') cam.nudge(0, 70); break;
        case 'ArrowDown': if (UI.view !== 'walk') cam.nudge(0, -70); break;
        case '+': case '=': cam.zoomBy(1.2, canvas().width / 2, canvas().height / 2, canvas().width, canvas().height); break;
        case '-': case '_': cam.zoomBy(1 / 1.2, canvas().width / 2, canvas().height / 2, canvas().width, canvas().height); break;
        case '1': UI.setView('site'); break;
        case '2': if (state.phase >= 2) UI.setView('floor'); break;
        case '3': if (state.phase >= 3) UI.setView('walk'); break;
        case 'e': case 'E': onHarvest(); break;
      }
    });
  }

  /* ---------------- overlays ---------------- */
  function drawFloaters(ctx, W, H, now, dpr) {
    floaters = floaters.filter(f => now - f.t0 < 1400);
    ctx.save();
    ctx.textAlign = 'center';
    for (const f of floaters) {
      const p = (now - f.t0) / 1400;
      const y = f.y * dpr - G.ease.outCubic(p) * 74 * dpr;
      const a = 1 - G.ease.inCubic(p);
      const big = f.kind === 'crit' || f.kind === 'seam';
      ctx.font = `${big ? 700 : 600} ${(big ? 22 : 16) * dpr}px ui-monospace, "SF Mono", monospace`;
      const c = f.kind === 'crit' ? '255,228,150' : f.kind === 'seam' ? '255,214,132' : '236,224,196';
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = `rgba(24,18,14,${a * 0.7})`;
      ctx.strokeText(f.text, f.x * dpr + f.dx, y);
      ctx.fillStyle = `rgba(${c},${a})`;
      ctx.fillText(f.text, f.x * dpr + f.dx, y);
    }
    ctx.restore();
  }

  function drawFlash(ctx, W, H, now) {
    if (!flash) return;
    const p = (now - flash.t0) / flash.life;
    if (p >= 1) { flash = null; return; }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = G.css(flash.c, (1 - p) * 0.28);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  /* ---------------- frame ---------------- */
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dtMs = Math.max(0, Math.min(2000, now - lastFrame));
    lastFrame = now;
    if (!state || fastForwarding) return;

    if (!state.ending) {
      acc += dtMs;
      let steps = 0;
      while (acc >= TICK_MS && steps < 40) { Sim.tick(state); acc -= TICK_MS; steps++; }
      if (acc >= TICK_MS) acc = 0;
    } else {
      UI.showEnding(state);
    }
    updateBudget(now, dtMs);
    drainFx();

    const cv = canvas();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.floor(cv.clientWidth * dpr), H = Math.floor(cv.clientHeight * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    const t = now / 1000;
    const dt = Math.min(0.05, dtMs / 1000);
    const opts = { reducedMotion: UI.reducedMotion(), dt, now };

    if (W > 0 && H > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (UI.view === 'floor' && state.phase >= 2) {
        PD.RenderFactory.draw(ctx, W, H, state, t, opts);
      } else if (UI.view === 'walk' && state.phase >= 3) {
        UI.walking = Math.max(0, UI.walking - 1);
        const maxPan = PD.RenderFP.draw(ctx, W, H, state, t,
          Object.assign({ pan: UI.pan * dpr, walking: UI.walking > 0 }, opts)) || 0;
        UI.pan = Math.min(Math.max(0, UI.pan), maxPan / dpr);
      } else {
        if (UI.view !== 'site') UI.setView('site');
        PD.RenderSite.draw(ctx, W, H, state, t,
          Object.assign({ siteIndex: Math.min(UI.siteIndex, state.sites.length - 1) }, opts));
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawFlash(ctx, W, H, now);
      drawFloaters(ctx, W, H, now, dpr);
    }

    UI.update(state, now);
    if (state.ending) UI.drawEnding();

    if (now - lastAudio > 900) {
      lastAudio = now;
      PD.Audio.setLevels(state.visual.decorFrac * (state.visual.birds ? 1 : 0.15),
        state.visual.activity, state.visual.day ? state.visual.day.light : 1);
    }
    if (now - lastSave > PD.TUNING.autosaveSec * 1000) { lastSave = now; save(); }
  }

  /* ---------------- boot ---------------- */
  function boot() {
    UI.init({
      onNewGame: id => { clearSave(); startNew(id); },
      onContinue: () => startContinue(),
      onReset: () => reset(),
      onHarvest: () => onHarvest(),
      onSurge,
      onBuy: id => { if (state && !fastForwarding) Sim.buyUpgrade(state, id); },
      onBuySite: id => { if (state && !fastForwarding) Sim.buySite(state, id); },
      onChoice: (id, idx) => { if (state) { Sim.resolveChoice(state, id, idx); save(); } },
    });
    bindInput();

    document.addEventListener('visibilitychange', () => {
      if (!state) return;
      if (document.hidden) save();
      else {
        const ticks = Sim.offlineTicks(Date.now() - (state.lastSavedAt || Date.now()));
        acc = 0; lastFrame = performance.now();
        if (ticks > 600) fastForward(ticks, () => save());
      }
    });
    window.addEventListener('beforeunload', save);
    window.addEventListener('pagehide', save);

    const existing = load();
    UI.showTitle(!!existing, existing ? existing.product : 'paperclips');

    if (/[?&]dev=1/.test(location.search)) {
      window.PDdbg = {
        get state() { return state; },
        ff(mins) { Sim.ffTicks(state, Math.round(mins * 60 * PD.TUNING.tickHz)); },
        grant(m) { state.economy.money += m; },
        buy(id) { return Sim.buyUpgrade(state, id); },
        site(id) { return Sim.buySite(state, id); },
        choice(i) { return Sim.resolveChoice(state, state.pendingChoice, i); },
        start(p) { startNew(p || 'paperclips'); },
        surge() { return Sim.triggerSurge(state); },
        seam() { state.seams.push({ id: ++state.seamSeq, site: 0, a: 0.3, r: 0.6, born: state.tick, expires: state.tick + 3000, value: 500 }); },
      };
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
