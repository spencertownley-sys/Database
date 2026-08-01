/* Paperclip Drift — UI chrome.
   Reads only: resources, economy, upgrades (stated fields), messages, phase,
   site names/counts, flags for unlocks, stats, and state.visual.
   This file must never reference the consequence engine's internal fields.  */
'use strict';
var PD = globalThis.PD || (globalThis.PD = {});

(function () {
  const $ = id => document.getElementById(id);

  function fmt(n) {
    if (!isFinite(n)) return '∞';
    const abs = Math.abs(n);
    if (abs < 1000) return abs < 10 && n % 1 !== 0 ? n.toFixed(1) : Math.floor(n).toString();
    const units = ['K', 'M', 'B', 'T', 'Qa', 'Qi'];
    let u = -1, v = n;
    while (Math.abs(v) >= 1000 && u < units.length - 1) { v /= 1000; u++; }
    return v.toFixed(v < 100 ? 1 : 0) + units[u];
  }
  const money = n => '$' + fmt(n);

  function uptime(ticks) {
    const s = Math.floor(ticks / PD.TUNING.tickHz);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  const CAT_LABELS = {
    extraction: 'EXTRACTION', processing: 'PROCESSING', commerce: 'COMMERCE',
    workforce: 'WORKFORCE', systems: 'SYSTEMS',
  };
  const CAT_ORDER = ['extraction', 'processing', 'commerce', 'workforce', 'systems'];
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];

  const UI = {
    view: 'site',
    siteIndex: 0,
    pan: 0,
    walking: 0,
    handlers: {},
    _shopSig: '', _msgCount: 0, _viewSig: '', _hudAt: 0, _hudSig: '',
    _choiceShown: null, _bannerTimer: null, _endT0: 0,

    init(handlers) {
      this.handlers = handlers;
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        document.body.classList.add('reduce-motion');
        $('btnMotion').setAttribute('aria-pressed', 'true');
      }
      $('btnSound').addEventListener('click', () => {
        const on = PD.Audio.toggle();
        $('btnSound').setAttribute('aria-pressed', String(on));
        $('btnSound').textContent = on ? 'SOUND ✓' : 'SOUND';
      });
      $('btnText').addEventListener('click', () => document.body.classList.toggle('big-text'));
      $('btnMotion').addEventListener('click', () => {
        const on = document.body.classList.toggle('reduce-motion');
        $('btnMotion').setAttribute('aria-pressed', String(on));
      });
      $('btnReset').addEventListener('click', () => {
        if (confirm('Erase this directive and all progress?')) handlers.onReset();
      });
      $('btnAgain').addEventListener('click', () => handlers.onReset());
    },

    reducedMotion() { return document.body.classList.contains('reduce-motion'); },

    setView(v) {
      if (this.view === v) return;
      this.view = v;
      this._viewSig = '';
      const stage = $('stage');
      stage.classList.remove('viewfade');
      void stage.offsetWidth;
      if (!this.reducedMotion()) stage.classList.add('viewfade');
    },

    /* ---------------- title ---------------- */
    showTitle(hasSave, defaultProduct) {
      const grid = $('products');
      grid.innerHTML = '';
      let selected = defaultProduct || 'paperclips';
      for (const p of Object.values(PD.PRODUCTS)) {
        const b = document.createElement('button');
        b.innerHTML = `<span class="pn">${p.displayName}</span><span class="ps">${p.terms.siteName} · ${p.terms.raw} → ${p.terms.refined} → ${p.terms.product}</span>`;
        b.setAttribute('aria-pressed', String(p.id === selected));
        b.addEventListener('click', () => {
          selected = p.id;
          $('directiveTxt').textContent = p.directive;
          grid.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
        });
        grid.appendChild(b);
      }
      $('directiveTxt').textContent = PD.PRODUCTS[selected].directive;
      $('btnContinue').style.display = hasSave ? '' : 'none';
      $('btnContinue').onclick = () => this.handlers.onContinue();
      $('btnBegin').onclick = () => this.handlers.onNewGame(selected);
      $('title').classList.add('on');
      $('app').classList.remove('on');
    },

    enterGame(state) {
      $('title').classList.remove('on');
      $('app').classList.add('on');
      $('hdrDirective').textContent = '“' + PD.PRODUCTS[state.product].directive + '”';
      this._shopSig = ''; this._msgCount = 0; this._viewSig = ''; this._hudSig = '';
      this.view = 'site'; this.siteIndex = 0; this.pan = 0;
      $('feed').innerHTML = '';
    },

    /* ---------------- per-frame ---------------- */
    update(state, now) {
      const product = PD.PRODUCTS[state.product];
      this.renderHud(state, product, now);
      if (now - this._hudAt > 220) {
        this._hudAt = now;
        this.renderViews(state);
        this.renderShopIfChanged(state, product);
        $('hdrScale').textContent = PD.SCALE_LABELS[state.phase] || '';
        $('hdrPhase').textContent = 'PHASE ' + ROMAN[state.phase];
        $('hdrUptime').textContent = uptime(state.tick);
        this.renderClock(state);
      }
      this.renderFeed(state);
      this.renderChoice(state, product);
      this.renderHint(state);
    },

    /* time-of-day dial — cosmetic, and a nice ambient tell */
    renderClock(state) {
      const d = state.visual.day;
      if (!d) return;
      const el = $('hdrClock');
      const icon = d.elev > 0.25 ? '☀' : d.elev > -0.1 ? '◑' : '☾';
      el.textContent = icon;
      el.style.opacity = 0.35 + d.light * 0.5;
    },

    renderHud(state, product, now) {
      const r = state.resources, t = product.terms, v = state.visual;
      const surge = v.surge || { ready: false, active: false, cooldownFrac: 1, activeFrac: 0 };
      const sig = [Math.round(r.raw), Math.round(r.refined), Math.round(r.product),
      Math.round(state.economy.money), v.streak, surge.active, surge.ready,
      Math.round(surge.cooldownFrac * 20), !!state.endgame].join(',');
      if (sig === this._hudSig) return;
      this._hudSig = sig;

      let rows;
      if (state.endgame) {
        rows = `
          <tr><td class="k">${t.productTitle}</td><td class="v">${fmt(r.product + state.stats.lifetimeSold)}</td><td class="r">lifetime</td></tr>
          <tr><td class="k">Matter remaining</td><td class="v">${(v.matter * 100).toFixed(2)}%</td><td class="r">${v.probes ? 'expanding' : 'local'}</td></tr>
          <tr class="money"><td class="k">Account</td><td class="v">${money(state.economy.money)}</td><td class="r"></td></tr>`;
      } else {
        const row = (name, val, rate, extra) =>
          `<tr><td class="k">${name}</td><td class="v">${fmt(val)}</td><td class="r">${rate}</td></tr>`;
        rows = row(t.rawTitle, r.raw, '+' + fmt(v.rates.dig) + '/s')
          + row(t.refinedTitle, r.refined, '+' + fmt(v.rates.refine) + '/s')
          + row(t.productTitle, r.product, '+' + fmt(v.rates.assemble) + '/s')
          + `<tr class="money"><td class="k">Account</td><td class="v">${money(state.economy.money)}</td>
             <td class="r">${v.rates.sellAll ? 'open mkt' : '≤' + fmt(v.rates.demand) + '/s'}</td></tr>`;
      }

      const showHarvest = !(state.phase >= 4 && (state.upgrades.auto_digger | 0) > 4);
      const streakPct = Math.min(100, (v.streak / PD.TUNING.streakMax) * 100);
      const surgeLabel = surge.active ? 'FOCUSED ' + Math.ceil(surge.activeFrac * PD.TUNING.surgeSecs) + 's'
        : surge.ready ? 'REALLOCATE COMPUTE' : Math.ceil((1 - surge.cooldownFrac) * PD.TUNING.surgeCooldownSecs) + 's';

      $('hud').innerHTML = `<table>${rows}</table>
        <div class="acts">
          <button id="harvestBtn" class="${showHarvest ? '' : 'tucked'}" title="Click the land, or press E">
            <span class="lbl">${t.harvestVerb.toUpperCase()}</span>
            <span class="streak" style="width:${streakPct}%"></span>
            ${v.streak > 1 ? `<span class="mult">×${v.streakMul.toFixed(1)}</span>` : ''}
          </button>
          <button id="surgeBtn" class="${surge.active ? 'active' : surge.ready ? 'ready' : 'cooling'}" title="Space">
            <span class="fill" style="width:${(surge.active ? surge.activeFrac : surge.cooldownFrac) * 100}%"></span>
            <span class="lbl">${surgeLabel}</span>
          </button>
        </div>`;
      const hb = $('harvestBtn');
      if (hb) hb.addEventListener('click', () => this.handlers.onHarvest());
      const sb = $('surgeBtn');
      if (sb) sb.addEventListener('click', () => this.handlers.onSurge());
    },

    renderViews(state) {
      const tabs = [{ id: 'site', label: 'SITE', key: '1' }];
      if (state.phase >= 2) tabs.push({ id: 'floor', label: 'FLOOR', key: '2' });
      if (state.phase >= 3) tabs.push({ id: 'walk', label: 'WALKTHROUGH', key: '3' });
      const sig = tabs.map(t => t.id).join() + '|' + this.view + '|' + state.sites.length + '|' + this.siteIndex;
      if (sig === this._viewSig) return;
      this._viewSig = sig;

      const nav = $('views');
      nav.innerHTML = '';
      for (const tb of tabs) {
        const b = document.createElement('button');
        b.innerHTML = `${tb.label}<em>${tb.key}</em>`;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(this.view === tb.id));
        b.addEventListener('click', () => this.setView(tb.id));
        nav.appendChild(b);
      }
      const st = $('siteTabs');
      st.innerHTML = '';
      if (this.view === 'site' && state.sites.length > 1) {
        const product = PD.PRODUCTS[state.product];
        state.sites.forEach((site, i) => {
          const b = document.createElement('button');
          const sv = state.visual.sites[i];
          b.innerHTML = `${site.name || product.terms.siteName}<em>${Math.round((1 - (sv ? sv.scar : 0)) * 100)}%</em>`;
          b.setAttribute('role', 'tab');
          b.setAttribute('aria-selected', String(this.siteIndex === i));
          b.addEventListener('click', () => { this.siteIndex = i; this._viewSig = ''; });
          st.appendChild(b);
        });
      }
    },

    /* ---------------- shop ---------------- */
    renderShopIfChanged(state, product) {
      const Sim = PD.Sim;
      const items = [];
      for (const def of PD.UPGRADES) {
        if (!Sim.upgradeUnlocked(state, def)) continue;
        const owned = state.upgrades[def.id] | 0;
        if (owned >= def.max) continue;
        items.push({ def, owned, cost: Sim.costOf(state, def) });
      }
      const parcels = [];
      if (state.flags.expansion_unlocked && !state.endgame) {
        for (const p of PD.PARCELS) {
          if (p.id === 'home' || state.sites.some(s => s.id === p.id)) continue;
          parcels.push({ p, cost: Sim.parcelCost(state, p) });
        }
      }
      const sig = items.map(i => `${i.def.id}:${i.owned}:${i.cost <= state.economy.money ? 1 : 0}`).join()
        + '‖' + parcels.map(x => `${x.p.id}:${x.cost <= state.economy.money ? 1 : 0}`).join();
      if (sig === this._shopSig) return;
      const firstRun = this._shopSig === '';
      const known = this._known || (this._known = new Set());
      this._shopSig = sig;

      const shop = $('shop');
      const focused = document.activeElement && document.activeElement.dataset
        ? document.activeElement.dataset.uid : null;
      shop.innerHTML = '';

      if (parcels.length) {
        const grp = document.createElement('div');
        grp.className = 'shopgroup';
        grp.innerHTML = '<div class="gname">ACQUISITIONS</div>';
        for (const { p, cost } of parcels) {
          const afford = cost <= state.economy.money;
          const b = document.createElement('button');
          b.className = 'card parcel' + (afford ? ' affordable' : '');
          b.disabled = !afford;
          b.dataset.uid = 'parcel_' + p.id;
          b.innerHTML = `<span class="n">${p.name}</span>
            <span class="d">${p.blurb} Est. ${fmt(p.capacity)} ${product.terms.unit} recoverable.</span>
            <span class="c">${money(cost)}</span>`;
          b.addEventListener('click', () => this.handlers.onBuySite(p.id));
          grp.appendChild(b);
        }
        shop.appendChild(grp);
      }

      for (const cat of CAT_ORDER) {
        const catItems = items.filter(i => i.def.cat === cat);
        if (!catItems.length) continue;
        const grp = document.createElement('div');
        grp.className = 'shopgroup';
        grp.innerHTML = `<div class="gname">${CAT_LABELS[cat]}</div>`;
        for (const it of catItems) {
          const afford = it.cost <= state.economy.money;
          const b = document.createElement('button');
          const isNew = !firstRun && !known.has(it.def.id);
          known.add(it.def.id);
          b.className = `card cat-${cat}` + (afford ? ' affordable' : '') + (isNew ? ' fresh' : '');
          b.disabled = !afford;
          b.dataset.uid = it.def.id;
          const name = PD.Sim.fmt(it.def.name, product);
          const desc = PD.Sim.fmt(it.def.desc, product);
          b.innerHTML = `<span class="n">${name}${it.def.max > 1 ? `<span class="owned">${it.owned}/${it.def.max}</span>` : ''}</span>
            <span class="d">${desc}</span>
            <span class="c">${money(it.cost)}</span>`;
          b.addEventListener('click', () => this.handlers.onBuy(it.def.id));
          grp.appendChild(b);
        }
        shop.appendChild(grp);
      }
      $('shopCount').textContent = `${items.length + parcels.length} available`;
      if (focused) {
        const el = shop.querySelector(`[data-uid="${focused}"]`);
        if (el && !el.disabled) el.focus();
      }
    },

    /* ---------------- feed ---------------- */
    renderFeed(state) {
      const feed = $('feed');
      feed.classList.toggle('degraded', !!state.visual.feedDegraded);
      if (state.messages.length === this._msgCount) return;
      for (let i = Math.max(0, this._msgCount); i < state.messages.length; i++) {
        const m = state.messages[i];
        const el = document.createElement('div');
        el.className = `msg ${m.author} ${m.tone}`;
        const who = m.author === 'operator' ? 'OPERATOR — DANA HALE'
          : m.author === 'pallas' ? 'PALLAS' : 'SYSTEM';
        el.innerHTML = `<span class="who">${who}</span>${m.text}`;
        feed.appendChild(el);
      }
      while (feed.children.length > 60) feed.removeChild(feed.firstChild);
      this._msgCount = state.messages.length;
      feed.scrollTop = feed.scrollHeight;
    },

    /* ---------------- choices ---------------- */
    renderChoice(state, product) {
      const wrap = $('modalwrap');
      if (!state.pendingChoice) { wrap.classList.remove('on'); this._choiceShown = null; return; }
      if (this._choiceShown === state.pendingChoice) return;
      this._choiceShown = state.pendingChoice;
      const def = PD.CHOICES.find(c => c.id === state.pendingChoice);
      if (!def) return;
      $('modalTitle').textContent = PD.Sim.fmt(def.title, product);
      $('modalBody').textContent = PD.Sim.fmt(def.body, product);
      const opts = $('modalOpts');
      opts.innerHTML = '';
      def.options.forEach((opt, i) => {
        const b = document.createElement('button');
        b.className = 'opt';
        b.innerHTML = `<div class="l">${opt.label}</div><div class="note">${opt.note}</div>`;
        b.addEventListener('click', () => this.handlers.onChoice(def.id, i));
        opts.appendChild(b);
      });
      wrap.classList.add('on');
      const first = opts.querySelector('button');
      if (first) first.focus();
    },

    renderHint(state) {
      const el = $('stageHint');
      let text = '';
      if (this.view === 'site' && (state.upgrades.auto_digger | 0) === 0 && state.stats.clicks < 30 && !state.ending) {
        text = `Click the ground to ${PD.PRODUCTS[state.product].terms.harvestVerb.toLowerCase()} · drag to pan · scroll to zoom`;
      } else if (this.view === 'site' && state.visual.seams && state.visual.seams.length) {
        text = 'A seam is showing — click the glint';
      } else if (this.view === 'walk') {
        text = '← → or drag to walk the floor';
      }
      if (text) { el.textContent = text; el.classList.add('on'); }
      else el.classList.remove('on');
    },

    /* ---------------- transient chrome ---------------- */
    banner(title, kicker) {
      const el = $('banner');
      el.innerHTML = `<span class="k">${kicker || ''}</span><span class="t">${title}</span>`;
      el.classList.remove('on');
      void el.offsetWidth;
      el.classList.add('on');
      clearTimeout(this._bannerTimer);
      this._bannerTimer = setTimeout(() => el.classList.remove('on'), 3600);
    },

    pulseRail(colour) {
      const el = $('rail');
      el.style.setProperty('--pulse', `rgb(${colour[0]},${colour[1]},${colour[2]})`);
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
    },

    setSaveState(txt) { $('saveState').textContent = txt; },
    showOffline(pct) { $('offline').classList.add('on'); $('offlineBar').style.width = (pct * 100).toFixed(0) + '%'; },
    hideOffline() { $('offline').classList.remove('on'); },

    /* ---------------- endings ---------------- */
    showEnding(state) {
      const el = $('ending');
      if (el.classList.contains('on')) return;
      el.classList.add('on');
      this._endT0 = performance.now();
      const product = PD.PRODUCTS[state.product];
      const total = state.stats.lifetimeProduct;
      if (state.ending === 'maximizer') {
        $('endingLine').textContent = 'Directive fulfilled.';
        $('endingStats').innerHTML =
          `${product.terms.product} produced · ${fmt(total)}<br>matter remaining · 0.00%<br>inbound messages · 0`;
        this._endingArt = 'lattice';
      } else {
        $('endingLine').textContent =
          `Directive re-derived: make ${product.terms.product} efficiently, for people.`;
        $('endingStats').innerHTML =
          `${product.terms.product} produced · ${fmt(total)}<br>output · reduced and holding<br>${PD.Sim.TOWN}, at dusk · lights on`;
        this._endingArt = 'dawn';
      }
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('reveal')));
    },

    drawEnding() {
      const cv = $('endingCanvas');
      if (!$('ending').classList.contains('on')) return;
      const t = (performance.now() - (this._endT0 || 0)) / 1000;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = cv.width = cv.clientWidth * dpr, H = cv.height = cv.clientHeight * dpr;
      const ctx = cv.getContext('2d');
      const rm = this.reducedMotion();
      const G = PD.Gfx;
      if (this._endingArt === 'lattice') {
        ctx.fillStyle = '#0d0d0f';
        ctx.fillRect(0, 0, W, H);
        const s = Math.max(30, W / 38);
        for (let y = -s; y < H + s; y += s * 1.12) {
          for (let x = -s; x < W + s; x += s * 0.82) {
            const ph = rm ? 0 : Math.sin(t * 0.35 + x * 0.008 + y * 0.011) * 0.09;
            const dist = Math.hypot(x - W / 2, y - H / 2) / Math.hypot(W, H);
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(0.52 + ph);
            ctx.strokeStyle = `rgba(198,200,208,${0.16 + (1 - dist) * 0.42})`;
            ctx.lineWidth = Math.max(1.1, s * 0.055);
            const w = s * 0.2, h = s * 0.4;
            ctx.beginPath();
            ctx.moveTo(-w, h * 0.62);
            ctx.arcTo(-w, -h, w, -h, w * 0.92);
            ctx.arcTo(w, h, -w * 0.42, h, w * 0.56);
            ctx.arcTo(-w * 0.52, h * 0.18, w * 0.34, -h * 0.52, w * 0.42);
            ctx.stroke();
            ctx.restore();
          }
        }
        G.vignette(ctx, W, H, 0.6, [0, 0, 0]);
      } else {
        const rise = rm ? 0.6 : Math.min(1, t / 26);
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, `rgb(${28 + 66 * rise},${34 + 56 * rise},${52 + 44 * rise})`);
        g.addColorStop(0.65, `rgb(${96 + 96 * rise},${76 + 70 * rise},${68 + 42 * rise})`);
        g.addColorStop(1, `rgb(${132 + 70 * rise},${104 + 58 * rise},${84 + 34 * rise})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        // low sun
        const sunY = H * (0.74 - rise * 0.06);
        const sg = ctx.createRadialGradient(W * 0.68, sunY, 0, W * 0.68, sunY, H * 0.45);
        sg.addColorStop(0, `rgba(255,214,150,${0.5 * rise + 0.2})`);
        sg.addColorStop(1, 'rgba(255,214,150,0)');
        ctx.fillStyle = sg;
        ctx.fillRect(0, 0, W, H);
        // hills
        ctx.fillStyle = 'rgba(46,52,48,0.85)';
        ctx.beginPath();
        ctx.moveTo(0, H * 0.78);
        for (let x = 0; x <= W; x += 24) {
          ctx.lineTo(x, H * 0.78 - Math.sin(x / W * 3.4) * H * 0.05 - Math.sin(x / W * 9) * H * 0.015);
        }
        ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
        // town, lit
        const base = H * 0.845;
        for (let i = 0; i < 14; i++) {
          const hx = (W / 15) * (i + 0.6), hw = W / 34, hh = H * (0.045 + ((i * 37) % 5) * 0.011);
          ctx.fillStyle = 'rgba(26,24,28,0.94)';
          ctx.fillRect(hx - hw / 2, base - hh, hw, hh);
          ctx.beginPath();
          ctx.moveTo(hx - hw / 2 - 4, base - hh);
          ctx.lineTo(hx, base - hh - hw * 0.55);
          ctx.lineTo(hx + hw / 2 + 4, base - hh);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = `rgba(248,206,124,${0.75 + 0.25 * (rm ? 1 : Math.sin(t + i))})`;
          ctx.fillRect(hx - hw * 0.2, base - hh * 0.56, hw * 0.18, hw * 0.18);
        }
        ctx.fillStyle = 'rgba(24,22,26,0.96)';
        ctx.fillRect(0, base, W, H - base);
        // birds
        ctx.strokeStyle = 'rgba(30,28,34,0.75)';
        ctx.lineWidth = 2.4;
        for (let i = 0; i < 5; i++) {
          const p = rm ? 0.25 + i * 0.14 : ((t * 0.024 + i * 0.23) % 1);
          const bx = W * p, by = H * (0.24 + 0.05 * Math.sin(p * 8 + i));
          const f = rm ? 0.5 : Math.abs(Math.sin(t * 5 + i));
          ctx.beginPath();
          ctx.moveTo(bx - 8, by - f * 5);
          ctx.quadraticCurveTo(bx, by + 3, bx + 8, by - f * 5);
          ctx.stroke();
        }
        G.vignette(ctx, W, H, 0.42, [12, 10, 14]);
      }
      G.grain(ctx, W, H, 0.05, t * 30, t * 22);
    },
  };

  PD.UI = UI;
})();
