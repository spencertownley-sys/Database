/* Paperclip Drift — bootstrap, fixed-timestep loop, persistence, offline
   progress. The only file that touches the wall clock.                      */
'use strict';
var PD = globalThis.PD || (globalThis.PD = {});

(function () {
  const SAVE_KEY = 'paperclip-drift-save';
  const TICK_MS = 1000 / PD.TUNING.tickHz;
  const Sim = PD.Sim, UI = PD.UI;

  let state = null;
  let acc = 0, lastFrame = 0, lastSave = 0, lastAudio = 0;
  let running = false, fastForwarding = false;
  let motes = [];   // harvest feedback

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

  /* ---------------- game lifecycle ---------------- */
  function startNew(productId) {
    state = Sim.newGame(productId);
    UI.enterGame(state);
    save();
    begin();
  }

  function startContinue() {
    const s = load();
    if (!s) { UI.showTitle(false); return; }
    state = s;
    UI.enterGame(state);
    const elapsed = Date.now() - (state.lastSavedAt || Date.now());
    const ticks = Sim.offlineTicks(elapsed);
    fastForward(ticks, () => { save(); });
    begin();
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

  /* ---------------- input handlers ---------------- */
  function onHarvest() {
    if (!state || state.ending || fastForwarding) return;
    const got = Sim.clickHarvest(state);
    if (got > 0 && !UI.reducedMotion()) {
      motes.push({ t0: performance.now(), n: got });
      if (motes.length > 14) motes.shift();
    }
  }

  /* ---------------- render ---------------- */
  const canvas = () => document.getElementById('canvas');

  function drawMotes(ctx, W, H, now) {
    motes = motes.filter(m => now - m.t0 < 900);
    ctx.font = '600 15px ui-monospace, monospace';
    for (const m of motes) {
      const p = (now - m.t0) / 900;
      const seed = (m.t0 % 1000) / 1000;
      ctx.fillStyle = `rgba(232,214,170,${1 - p})`;
      ctx.fillText('+' + (m.n < 10 ? m.n.toFixed(0) : Math.round(m.n)),
        W * (0.42 + seed * 0.16), H * 0.5 - p * 46);
    }
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(2000, now - lastFrame);
    lastFrame = now;
    if (!state || fastForwarding) return;

    // fixed-timestep sim
    if (!state.ending) {
      acc += dt;
      let steps = 0;
      while (acc >= TICK_MS && steps < 40) { Sim.tick(state); acc -= TICK_MS; steps++; }
      if (acc >= TICK_MS) acc = 0; // dropped time after long stalls
    } else {
      UI.showEnding(state);
    }

    // render current view
    const cv = canvas();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.floor(cv.clientWidth * dpr), H = Math.floor(cv.clientHeight * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    const t = now / 1000;
    const opts = { reducedMotion: UI.reducedMotion() };
    if (W > 0 && H > 0) {
      if (UI.view === 'floor' && state.phase >= 2) {
        PD.RenderIso.drawFactory(ctx, W, H, state, t, opts);
      } else if (UI.view === 'walk' && state.phase >= 3) {
        UI.walking = Math.max(0, UI.walking - 1);
        const maxPan = PD.RenderFP.drawWalkthrough(ctx, W, H, state, t,
          { ...opts, pan: UI.pan * dpr, walking: UI.walking > 0 }) || 0;
        UI.pan = Math.min(Math.max(0, UI.pan), maxPan / dpr);
      } else {
        UI.view = UI.view === 'floor' || UI.view === 'walk' ? UI.view : 'site';
        PD.RenderIso.drawSite(ctx, W, H, state, t,
          { ...opts, siteIndex: Math.min(UI.siteIndex, state.sites.length - 1) });
      }
      drawMotes(ctx, W, H, now);
    }

    UI.update(state, now);
    if (state.ending) UI.drawEnding();

    // audio follows the world
    if (now - lastAudio > 1000) {
      lastAudio = now;
      PD.Audio.setLevels(state.visual.decorFrac * (state.visual.birds ? 1 : 0.15),
        state.visual.activity);
    }

    // autosave cadence
    if (now - lastSave > PD.TUNING.autosaveSec * 1000) { lastSave = now; save(); }
  }

  /* ---------------- boot ---------------- */
  function boot() {
    UI.init({
      onNewGame: id => { clearSave(); startNew(id); },
      onContinue: () => startContinue(),
      onReset: () => reset(),
      onHarvest,
      onBuy: id => { if (state && !fastForwarding) Sim.buyUpgrade(state, id); },
      onBuySite: id => { if (state && !fastForwarding) Sim.buySite(state, id); },
      onChoice: (id, idx) => { if (state) { Sim.resolveChoice(state, id, idx); save(); } },
    });

    document.addEventListener('visibilitychange', () => {
      if (!state) return;
      if (document.hidden) { save(); }
      else {
        const idleMs = Date.now() - (state.lastSavedAt || Date.now());
        const ticks = Sim.offlineTicks(idleMs);
        acc = 0; lastFrame = performance.now();
        if (ticks > 600) fastForward(ticks, () => save());
      }
    });
    window.addEventListener('beforeunload', () => save());
    window.addEventListener('pagehide', () => save());

    const existing = load();
    UI.showTitle(!!existing, existing ? existing.product : 'paperclips');

    // dev hooks (only with ?dev=1)
    if (/[?&]dev=1/.test(location.search)) {
      window.PDdbg = {
        get state() { return state; },
        ff(mins) { Sim.ffTicks(state, Math.round(mins * 60 * PD.TUNING.tickHz)); },
        grant(m) { state.economy.money += m; },
        buy(id) { return Sim.buyUpgrade(state, id); },
        site(id) { return Sim.buySite(state, id); },
        choice(i) { return Sim.resolveChoice(state, state.pendingChoice, i); },
        start(p) { startNew(p || 'paperclips'); },
      };
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
