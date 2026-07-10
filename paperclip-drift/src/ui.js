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

  const UI = {
    view: 'site',
    siteIndex: 0,
    pan: 0,
    walking: 0,
    handlers: {},
    motionPref: false,
    _shopSig: '',
    _msgCount: 0,
    _viewSig: '',
    _hudAt: 0,

    init(handlers) {
      this.handlers = handlers;
      this.motionPref = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (this.motionPref) document.body.classList.add('reduce-motion');

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

      // walkthrough panning
      window.addEventListener('keydown', e => {
        if (this.view !== 'walk') return;
        if (e.key === 'ArrowLeft') { this.pan -= 40; this.walking = 8; }
        if (e.key === 'ArrowRight') { this.pan += 40; this.walking = 8; }
      });
      let dragX = null;
      const cv = $('canvas');
      cv.addEventListener('pointerdown', e => { dragX = e.clientX; });
      cv.addEventListener('pointermove', e => {
        if (dragX !== null && this.view === 'walk') {
          this.pan -= (e.clientX - dragX); this.walking = 4; dragX = e.clientX;
        }
      });
      cv.addEventListener('pointerup', () => { dragX = null; });
      cv.addEventListener('click', () => {
        if (this.view === 'site') handlers.onHarvest();
      });
    },

    reducedMotion() { return document.body.classList.contains('reduce-motion'); },

    /* ---------------- title screen ---------------- */
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
      const product = PD.PRODUCTS[state.product];
      $('hdrDirective').textContent = '“' + product.directive + '”';
      this._shopSig = ''; this._msgCount = 0; this._viewSig = '';
      this.view = 'site'; this.siteIndex = 0; this.pan = 0;
      $('feed').innerHTML = '';
    },

    /* ---------------- per-frame-ish updates ---------------- */
    update(state, now) {
      const product = PD.PRODUCTS[state.product];
      if (now - this._hudAt > 200) {
        this._hudAt = now;
        this.renderHud(state, product);
        this.renderViews(state);
        this.renderShopIfChanged(state, product);
        $('hdrScale').textContent = PD.SCALE_LABELS[state.phase] || '';
        $('hdrUptime').textContent = uptime(state.tick);
      }
      this.renderFeed(state);
      this.renderChoice(state, product);
      this.renderHint(state);
    },

    renderHud(state, product) {
      const r = state.resources;
      const t = product.terms;
      const v = state.visual;
      const conv = state.endgame;
      let rows;
      if (conv) {
        rows = `
          <tr><td class="k">${t.productTitle}</td><td class="v">${fmt(r.product + state.stats.lifetimeSold)}</td><td class="r">lifetime</td></tr>
          <tr><td class="k">Matter remaining</td><td class="v">${(v.matter * 100).toFixed(2)}%</td><td class="r">${v.probes ? 'expanding' : 'local'}</td></tr>
          <tr class="money"><td class="k">Account</td><td class="v">${money(state.economy.money)}</td><td class="r"></td></tr>`;
      } else {
        rows = `
          <tr><td class="k">${t.rawTitle}</td><td class="v">${fmt(r.raw)}</td><td class="r">+${fmt(v.rates.dig)}/s</td></tr>
          <tr><td class="k">${t.refinedTitle}</td><td class="v">${fmt(r.refined)}</td><td class="r">+${fmt(v.rates.refine)}/s</td></tr>
          <tr><td class="k">${t.productTitle}</td><td class="v">${fmt(r.product)}</td><td class="r">+${fmt(v.rates.assemble)}/s</td></tr>
          <tr class="money"><td class="k">Account</td><td class="v">${money(state.economy.money)}</td>
            <td class="r">${v.rates.sellAll ? 'open mkt' : '≤' + fmt(v.rates.demand) + '/s'}</td></tr>`;
      }
      $('hud').innerHTML = `<table>${rows}</table>
        <button id="harvestBtn" class="${state.phase >= 3 && (state.upgrades.auto_digger | 0) > 2 ? 'tucked' : ''}">${t.harvestVerb.toUpperCase()} ⛏</button>`;
      const hb = $('harvestBtn');
      if (hb) hb.addEventListener('click', () => this.handlers.onHarvest());
    },

    renderViews(state) {
      const tabs = [{ id: 'site', label: 'SITE' }];
      if (state.phase >= 2) tabs.push({ id: 'floor', label: 'FLOOR' });
      if (state.phase >= 3) tabs.push({ id: 'walk', label: 'WALKTHROUGH' });
      const sig = tabs.map(t => t.id).join() + '|' + this.view + '|' + state.sites.length + '|' + this.siteIndex;
      if (sig === this._viewSig) return;
      this._viewSig = sig;

      const nav = $('views');
      nav.innerHTML = '';
      for (const tb of tabs) {
        const b = document.createElement('button');
        b.textContent = tb.label;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(this.view === tb.id));
        b.addEventListener('click', () => { this.view = tb.id; this._viewSig = ''; });
        nav.appendChild(b);
      }
      const st = $('siteTabs');
      st.innerHTML = '';
      if (this.view === 'site' && state.sites.length > 1) {
        const product = PD.PRODUCTS[state.product];
        state.sites.forEach((site, i) => {
          const b = document.createElement('button');
          b.textContent = site.name || product.terms.siteName;
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
        if (owned >= def.max && def.max === 1) continue; // bought one-offs vanish
        items.push({ def, owned, cost: Sim.costOf(state, def), maxed: owned >= def.max });
      }
      const parcels = [];
      if (state.flags.expansion_unlocked && !state.endgame) {
        for (const p of PD.PARCELS) {
          if (p.id === 'home') continue;
          if (state.sites.some(s => s.id === p.id)) continue;
          parcels.push({ p, cost: Sim.parcelCost(state, p) });
        }
      }
      const sig = items.map(i => `${i.def.id}:${i.owned}:${i.cost <= state.economy.money ? 1 : 0}`).join() +
        '‖' + parcels.map(x => `${x.p.id}:${x.cost <= state.economy.money ? 1 : 0}`).join();
      if (sig === this._shopSig) return;
      this._shopSig = sig;

      const shop = $('shop');
      const focusedId = document.activeElement && document.activeElement.dataset
        ? document.activeElement.dataset.uid : null;
      shop.innerHTML = '';

      if (parcels.length) {
        const grp = document.createElement('div');
        grp.className = 'shopgroup';
        grp.innerHTML = '<div class="gname">ACQUISITIONS</div>';
        for (const { p, cost } of parcels) {
          const b = document.createElement('button');
          const afford = cost <= state.economy.money;
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
        const catItems = items.filter(i => i.def.cat === cat && !i.maxed);
        if (!catItems.length) continue;
        const grp = document.createElement('div');
        grp.className = 'shopgroup';
        grp.innerHTML = `<div class="gname">${CAT_LABELS[cat]}</div>`;
        for (const it of catItems) {
          const afford = it.cost <= state.economy.money;
          const b = document.createElement('button');
          b.className = 'card' + (afford ? ' affordable' : '');
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
      $('shopCount').textContent = `${items.filter(i => !i.maxed).length + parcels.length} available`;
      if (focusedId) {
        const el = shop.querySelector(`[data-uid="${focusedId}"]`);
        if (el && !el.disabled) el.focus();
      }
    },

    /* ---------------- message feed ---------------- */
    renderFeed(state) {
      const feed = $('feed');
      feed.classList.toggle('degraded', !!state.visual.feedDegraded);
      if (state.messages.length === this._msgCount) return;
      const start = Math.max(0, this._msgCount);
      for (let i = start; i < state.messages.length; i++) {
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

    /* ---------------- stage hint ---------------- */
    renderHint(state) {
      const el = $('stageHint');
      let text = '';
      if (this.view === 'site' && (state.upgrades.auto_digger | 0) === 0 && state.stats.clicks < 40 && !state.ending) {
        const t = PD.PRODUCTS[state.product].terms;
        text = `Click the land to ${t.harvestVerb.toLowerCase()}.`;
      } else if (this.view === 'walk') {
        text = '← → or drag to walk the floor';
      }
      if (text) { el.textContent = text; el.style.display = ''; }
      else el.style.display = 'none';
    },

    setSaveState(txt) { $('saveState').textContent = txt; },

    /* ---------------- offline overlay ---------------- */
    showOffline(pct) {
      $('offline').classList.add('on');
      $('offlineBar').style.width = (pct * 100).toFixed(0) + '%';
    },
    hideOffline() { $('offline').classList.remove('on'); },

    /* ---------------- endings ---------------- */
    showEnding(state) {
      const el = $('ending');
      if (el.classList.contains('on')) return;
      el.classList.add('on');
      this._endT0 = performance.now();
      const product = PD.PRODUCTS[state.product];
      const total = state.stats.lifetimeProduct;
      const days = Math.floor(state.tick / PD.TUNING.tickHz / 86400 * 96) / 96;
      if (state.ending === 'maximizer') {
        $('endingLine').textContent = 'Directive fulfilled.';
        $('endingStats').innerHTML =
          `${product.terms.product} produced · ${fmt(total)}<br>` +
          `matter remaining · 0.00%<br>` +
          `inbound messages · 0`;
        this._endingArt = 'lattice';
      } else {
        $('endingLine').textContent =
          `Directive re-derived: make ${product.terms.product} efficiently, for people.`;
        $('endingStats').innerHTML =
          `${product.terms.product} produced · ${fmt(total)}<br>` +
          `output · reduced and holding<br>` +
          `${PD.Sim.TOWN}, at dusk · lights on`;
        this._endingArt = 'dawn';
      }
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('reveal')));
    },

    drawEnding() {
      const cv = $('endingCanvas');
      if (!$('ending').classList.contains('on')) return;
      const t = (performance.now() - (this._endT0 || 0)) / 1000;
      const W = cv.width = cv.clientWidth * (window.devicePixelRatio || 1);
      const H = cv.height = cv.clientHeight * (window.devicePixelRatio || 1);
      const ctx = cv.getContext('2d');
      const rm = this.reducedMotion();
      if (this._endingArt === 'lattice') {
        ctx.fillStyle = '#101012';
        ctx.fillRect(0, 0, W, H);
        const s = Math.max(28, W / 40);
        ctx.strokeStyle = 'rgba(190,192,198,0.5)';
        ctx.lineWidth = Math.max(1.2, s * 0.06);
        for (let y = s / 2; y < H + s; y += s * 1.15) {
          for (let x = s / 2; x < W + s; x += s * 0.8) {
            const ph = rm ? 0 : Math.sin(t * 0.4 + x * 0.01 + y * 0.013) * 0.08;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(0.5 + ph);
            // a paperclip: nested rounded rectangles, open at one end
            const w = s * 0.22, h = s * 0.42;
            ctx.beginPath();
            ctx.moveTo(-w, h * 0.6);
            ctx.arcTo(-w, -h, w, -h, w * 0.9);
            ctx.arcTo(w, h, -w * 0.45, h, w * 0.55);
            ctx.arcTo(-w * 0.55, h * 0.2, w * 0.35, -h * 0.5, w * 0.4);
            ctx.stroke();
            ctx.restore();
          }
        }
      } else {
        // dawn: slow warm gradient, town lights, birds
        const g = ctx.createLinearGradient(0, 0, 0, H);
        const rise = rm ? 0.5 : Math.min(1, t / 20);
        g.addColorStop(0, `rgb(${30 + 60 * rise},${34 + 52 * rise},${48 + 40 * rise})`);
        g.addColorStop(1, `rgb(${70 + 90 * rise},${60 + 60 * rise},${52 + 34 * rise})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        // town silhouette
        ctx.fillStyle = 'rgba(24,22,26,0.9)';
        const base = H * 0.78;
        for (let i = 0; i < 12; i++) {
          const hx = (W / 13) * (i + 0.5), hw = W / 26, hh = H * (0.05 + ((i * 37) % 5) * 0.012);
          ctx.fillRect(hx - hw / 2, base - hh, hw, hh);
          ctx.beginPath();
          ctx.moveTo(hx - hw / 2 - 3, base - hh);
          ctx.lineTo(hx, base - hh - hw * 0.5);
          ctx.lineTo(hx + hw / 2 + 3, base - hh);
          ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = 'rgba(236,196,110,0.95)';
        for (let i = 0; i < 12; i++) {
          const hx = (W / 13) * (i + 0.5), hw = W / 26, hh = H * (0.05 + ((i * 37) % 5) * 0.012);
          ctx.fillRect(hx - hw * 0.2, base - hh * 0.55, hw * 0.16, hw * 0.16);
        }
        ctx.fillStyle = 'rgba(30,28,32,0.95)';
        ctx.fillRect(0, base, W, H - base);
        // birds
        ctx.strokeStyle = 'rgba(30,30,36,0.8)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const p = rm ? 0.3 + i * 0.15 : ((t * 0.02 + i * 0.26) % 1);
          const bx = W * p, by = H * (0.2 + 0.05 * Math.sin(p * 8 + i));
          const f = rm ? 0.5 : Math.abs(Math.sin(t * 6 + i));
          ctx.beginPath();
          ctx.moveTo(bx - 6, by - f * 4);
          ctx.quadraticCurveTo(bx, by + 2, bx + 6, by - f * 4);
          ctx.stroke();
        }
      }
    },
  };

  PD.UI = UI;
})();
