/* Paperclip Drift — isometric renderer (source site + factory floor).
   Reads ONLY state.visual (derived fields), stated resources, and product
   art data. Decay is a pure function of the derived fields; animation uses
   wall-clock time for flavor only.                                          */
'use strict';
var PD = globalThis.PD || (globalThis.PD = {});

(function () {
  const TW = 64, TH = 32, N = 18;         // tile size, grid size
  const CX = (N - 1) / 2, CY = (N - 1) / 2;

  /* ---- small utils ------------------------------------------------------ */
  function h32(x, y, seed) {
    let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0);
  }
  const h01 = (x, y, s) => h32(x, y, s) / 4294967296;

  function hexRgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const rgbStr = (c, a) => a === undefined ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
    : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const shade = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
  function desat(c, d) { // toward warm ash, value preserved-ish (colorblind-safe)
    const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    return mix(c, [l * 1.04, l * 0.99, l * 0.9], d);
  }

  /* ---- iso helpers ------------------------------------------------------- */
  function isoPt(tx, ty, ox, oy, sc) {
    return [ox + (tx - ty) * (TW / 2) * sc, oy + (tx + ty) * (TH / 2) * sc];
  }

  function diamond(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x, y - h / 2);
    ctx.lineTo(x + w / 2, y);
    ctx.lineTo(x, y + h / 2);
    ctx.lineTo(x - w / 2, y);
    ctx.closePath();
  }

  /* ======================================================================= */
  /*  SOURCE SITE                                                            */
  /* ======================================================================= */

  function drawSite(ctx, W, H, state, t, opts) {
    const v = state.visual;
    const product = PD.PRODUCTS[state.product];
    const pal = product.palette;
    const sIdx = Math.min(opts.siteIndex | 0, v.sites.length - 1);
    const sv = v.sites[sIdx];
    const seed = sv.decorSeed;
    const rm = !!opts.reducedMotion;

    const sc = Math.min(W / ((N + 1.5) * TW), H / ((N + 2.5) * TH));
    const ox = W / 2, oy = (H - (N - 1) * TH * sc) / 2 + 8;

    // sky
    const sky = mix(hexRgb(pal.sky), hexRgb(pal.skyDecay), v.skyDrift);
    const conv = v.conversion;
    const skyC = mix(sky, [168, 166, 160], Math.min(1, conv * 1.3));
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgbStr(skyC));
    g.addColorStop(1, rgbStr(mix(skyC, [235, 228, 210], 0.45)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    drawBirds(ctx, W, H, v, t, rm, seed);

    const grass = hexRgb(pal.grass), grassD = hexRgb(pal.grassDecay);
    const dirt = hexRgb(pal.dirt), rock = hexRgb(pal.rock), pit = hexRgb(pal.pit);
    const d = v.desat;
    const feature = product.feature;
    const scar = sv.scar;

    // per-tile classification + draw back-to-front
    for (let ty = 0; ty < N; ty++) {
      for (let tx = 0; tx < N; tx++) {
        const [x, y] = isoPt(tx, ty, ox, oy, sc);
        const dc = Math.hypot(tx - CX, ty - CY);
        const jit = (h01(tx, ty, seed) - 0.5) * 0.14;

        // phase-VI conversion consumes tiles in deterministic order
        if (conv > 0 && h01(tx, ty, seed ^ 99991) < conv * 1.12) {
          drawLatticeTile(ctx, x, y, sc, tx, ty, seed);
          continue;
        }

        let base, kind = 'grass';
        if (feature === 'pit') {
          const R = 0.6 + scar * 6.4;
          if (dc <= R - 1.2) { kind = 'pitfloor'; }
          else if (dc <= R) { kind = 'pitwall'; }
          else if (dc <= R + 1.15) { kind = 'cracked'; }
        } else if (feature === 'water') {
          const WR = 3.9 * (1 - scar * 0.78);
          if (dc <= WR) kind = 'water';
          else if (dc <= 4.15) kind = 'mud';
          else if (dc <= 4.9) kind = 'cracked';
        } else if (feature === 'field') {
          if (dc <= 6.2) kind = ((tx + ty * 2) % 3 === 0) ? 'tilled' : 'crop';
          if (dc <= 6.2 && h01(tx, ty, seed ^ 777) < scar * 1.05) kind = 'dust';
        } else if (feature === 'canopy') {
          if (dc <= 1.6 + scar * 2.2 && scar > 0.02) kind = 'cleared';
        }

        switch (kind) {
          case 'grass': {
            base = mix(grass, grassD, d);
            base = shade(base, 1 + jit);
            paintTile(ctx, x, y, sc, base);
            // grass speckle
            if (h01(tx, ty, seed ^ 5) > 0.4 && d < 0.75) {
              ctx.fillStyle = rgbStr(shade(base, 1.18), 0.5 * (1 - d));
              for (let i = 0; i < 3; i++) {
                const fx = x + (h01(tx, ty, seed ^ (10 + i)) - 0.5) * TW * 0.5 * sc;
                const fy = y + (h01(tx, ty, seed ^ (20 + i)) - 0.5) * TH * 0.5 * sc;
                ctx.fillRect(fx, fy, 2 * sc, 1.4 * sc);
              }
            }
            break;
          }
          case 'cracked': case 'mud': case 'dust': case 'cleared': case 'tilled': {
            let c = kind === 'mud' ? shade(dirt, 0.82) : dirt;
            if (kind === 'dust') c = mix(dirt, [154, 146, 124], 0.55);
            if (kind === 'tilled') c = shade(dirt, 0.94);
            base = shade(desat(c, d * 0.5), 1 + jit);
            paintTile(ctx, x, y, sc, base);
            if (kind === 'cracked' || kind === 'dust') {
              ctx.strokeStyle = rgbStr(shade(base, 0.72), 0.8);
              ctx.lineWidth = 1;
              crackLines(ctx, x, y, sc, tx, ty, seed);
            }
            if (kind === 'tilled') {
              ctx.strokeStyle = rgbStr(shade(base, 0.8), 0.6);
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(x - TW * 0.3 * sc, y);
              ctx.lineTo(x + TW * 0.3 * sc, y);
              ctx.stroke();
            }
            break;
          }
          case 'crop': {
            const alive = mix([138, 158, 84], grassD, d);
            base = shade(alive, 1 + jit);
            paintTile(ctx, x, y, sc, base);
            ctx.fillStyle = rgbStr(shade(base, 1.22), 0.8);
            for (let i = 0; i < 3; i++) {
              const fx = x + (i - 1) * TW * 0.22 * sc;
              ctx.fillRect(fx - 1.2 * sc, y - 2 * sc, 2.4 * sc, 3.6 * sc);
            }
            break;
          }
          case 'water': {
            const wc = hexRgb(pal.water || '#5E88A8');
            base = desat(wc, d * 0.6);
            paintTile(ctx, x, y, sc, base);
            if (!rm) {
              const ph = Math.sin(t * 1.4 + tx * 1.1 + ty * 0.7);
              ctx.fillStyle = rgbStr(shade(base, 1.3), 0.25 + 0.12 * ph);
              ctx.fillRect(x - TW * 0.2 * sc, y - 1, TW * 0.4 * sc, 1.6);
            }
            break;
          }
          case 'pitwall': {
            base = shade(desat(mix(dirt, rock, 0.55), d * 0.4), 0.68 + jit);
            paintTile(ctx, x, y, sc, base);
            break;
          }
          case 'pitfloor': {
            const R = 0.6 + scar * 6.4;
            const depth = Math.min(3, Math.max(1, Math.floor(R - dc)));
            const dp = depth * 6 * sc;
            base = shade(desat(pit, d * 0.3), (0.95 - depth * 0.12) + jit);
            paintTile(ctx, x, y, sc, shade(base, 0.5)); // backfill the opening
            // side walls for the depression
            ctx.fillStyle = rgbStr(shade(base, 0.62));
            ctx.beginPath();
            ctx.moveTo(x - TW / 2 * sc, y);
            ctx.lineTo(x, y + TH / 2 * sc);
            ctx.lineTo(x, y + TH / 2 * sc + dp);
            ctx.lineTo(x - TW / 2 * sc, y + dp);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = rgbStr(shade(base, 0.5));
            ctx.beginPath();
            ctx.moveTo(x + TW / 2 * sc, y);
            ctx.lineTo(x, y + TH / 2 * sc);
            ctx.lineTo(x, y + TH / 2 * sc + dp);
            ctx.lineTo(x + TW / 2 * sc, y + dp);
            ctx.closePath(); ctx.fill();
            paintTile(ctx, x, y + dp, sc, base);
            // ore flecks thin out as the vein depletes
            const veins = (1 - scar) * 0.9;
            if (h01(tx, ty, seed ^ 31) < veins) {
              ctx.fillStyle = rgbStr(mix(rock, [200, 205, 215], 0.35), 0.9);
              for (let i = 0; i < 3; i++) {
                const fx = x + (h01(tx, ty, seed ^ (40 + i)) - 0.5) * TW * 0.4 * sc;
                const fy = y + dp + (h01(tx, ty, seed ^ (50 + i)) - 0.5) * TH * 0.4 * sc;
                ctx.fillRect(fx, fy, 2.4 * sc, 1.8 * sc);
              }
            }
            break;
          }
        }
      }
    }

    // canopy feature: dense trees that fall in deterministic order with scar
    if (feature === 'canopy') drawCanopy(ctx, ox, oy, sc, seed, scar, d, grass, t, rm);

    drawDecorations(ctx, ox, oy, sc, seed, product, v, d, t, rm, feature, scar);
    drawTown(ctx, ox, oy, sc, v, d, t);
    drawWorksBuilding(ctx, ox, oy, sc, v, d, t, rm, pal);
    if (feature === 'pit') drawHeadframe(ctx, ox, oy, sc, scar, d, v, t, rm);
    if (feature === 'field') drawShed(ctx, ox, oy, sc, d);

    // conversion: probes departing (phase VI, after interstellar)
    if (v.probes > 0 && !rm) {
      ctx.fillStyle = 'rgba(235,235,240,0.9)';
      for (let i = 0; i < 3; i++) {
        const p = ((t * 0.08 + i * 0.33) % 1);
        const px = W * (0.3 + i * 0.2), py = H * (0.9 - p * 0.9);
        ctx.fillRect(px, py, 2, 8);
        ctx.fillStyle = `rgba(240,200,140,${0.5 * (1 - p)})`;
        ctx.fillRect(px, py + 8, 2, 12);
        ctx.fillStyle = 'rgba(235,235,240,0.9)';
      }
    }

    hazeOverlay(ctx, W, H, v.haze, conv);
  }

  function paintTile(ctx, x, y, sc, c) {
    ctx.fillStyle = rgbStr(c);
    diamond(ctx, x, y, (TW + 1.6) * sc, (TH + 1.0) * sc);
    ctx.fill();
  }

  function crackLines(ctx, x, y, sc, tx, ty, seed) {
    ctx.beginPath();
    for (let i = 0; i < 2; i++) {
      const a = h01(tx, ty, seed ^ (60 + i)) * Math.PI * 2;
      const l = (4 + h01(tx, ty, seed ^ (70 + i)) * 8) * sc;
      const fx = x + (h01(tx, ty, seed ^ (80 + i)) - 0.5) * TW * 0.4 * sc;
      const fy = y + (h01(tx, ty, seed ^ (90 + i)) - 0.5) * TH * 0.4 * sc;
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + Math.cos(a) * l, fy + Math.sin(a) * l * 0.5);
    }
    ctx.stroke();
  }

  function drawLatticeTile(ctx, x, y, sc, tx, ty, seed) {
    const c = [176, 178, 184];
    paintTile(ctx, x, y, sc, shade(c, 0.96 + (h01(tx, ty, seed) - 0.5) * 0.05));
    ctx.strokeStyle = 'rgba(120,122,130,0.7)';
    ctx.lineWidth = 0.8;
    diamond(ctx, x, y, (TW - 1) * sc * 0.6, (TH - 0.5) * sc * 0.6);
    ctx.stroke();
    diamond(ctx, x, y, (TW - 1) * sc * 0.28, (TH - 0.5) * sc * 0.28);
    ctx.stroke();
  }

  /* ---- decorations ------------------------------------------------------- */
  function decorSpots(seed, count, minR, maxR) {
    const spots = [];
    let placed = 0, i = 0;
    while (placed < count && i < count * 8) {
      i++;
      const a = h01(i, 1, seed) * Math.PI * 2;
      const r = minR + h01(i, 2, seed) * (maxR - minR);
      const tx = CX + Math.cos(a) * r, ty = CY + Math.sin(a) * r;
      if (tx < 0.8 || ty < 0.8 || tx > N - 1.2 || ty > N - 1.2) continue;
      // keep clear of town (SE corner) and works building (NE)
      if (tx > 11.6 && ty > 11.6) continue;
      if (tx > 12.4 && ty < 6.5) continue;
      spots.push({ tx, ty, o: h01(i, 3, seed) });
      placed++;
    }
    return spots;
  }

  function drawDecorations(ctx, ox, oy, sc, seed, product, v, d, t, rm, feature, scar) {
    const mixDef = product.decorMix;
    const minR = feature === 'pit' ? 7.6 : (feature === 'water' ? 5.2 : 6.8);
    const items = [];
    let idx = 0;
    for (const type of ['tree', 'shrub', 'rock', 'flower', 'deer']) {
      const n = (type === 'tree' && feature === 'canopy') ? 0 : (mixDef[type] || 0);
      for (const sp of decorSpots(seed ^ (type.length * 131), n, minR, 8.4)) {
        items.push({ type, ...sp, th: h01(idx, 9, seed) * 0.92 });
        idx++;
      }
    }
    items.sort((a, b) => (a.tx + a.ty) - (b.tx + b.ty));
    for (const it of items) {
      if (v.decorFrac <= it.th) continue;               // gone, one by one
      const [x, y] = isoPt(it.tx, it.ty, ox, oy, sc);
      drawDecor(ctx, x, y, sc, it, d, t, rm);
    }
  }

  function drawDecor(ctx, x, y, sc, it, d, t, rm) {
    const sway = rm ? 0 : Math.sin(t * 0.9 + it.o * 9) * 1.2 * sc;
    switch (it.type) {
      case 'tree': {
        const trunk = desat([106, 76, 48], d * 0.5);
        const leaf1 = desat([84, 122, 62], d);
        const leaf2 = desat([104, 142, 74], d);
        ctx.fillStyle = rgbStr(trunk);
        ctx.fillRect(x - 1.6 * sc, y - 10 * sc, 3.2 * sc, 10 * sc);
        ctx.fillStyle = rgbStr(leaf1);
        ctx.beginPath(); ctx.ellipse(x + sway * 0.4, y - 15 * sc, 8.5 * sc, 7 * sc, 0, 0, 7); ctx.fill();
        ctx.fillStyle = rgbStr(leaf2);
        ctx.beginPath(); ctx.ellipse(x + sway * 0.6 - 2 * sc, y - 18 * sc, 5.5 * sc, 4.5 * sc, 0, 0, 7); ctx.fill();
        break;
      }
      case 'shrub': {
        ctx.fillStyle = rgbStr(desat([96, 130, 70], d));
        ctx.beginPath(); ctx.ellipse(x, y - 3 * sc, 5 * sc, 3.4 * sc, 0, 0, 7); ctx.fill();
        ctx.fillStyle = rgbStr(desat([112, 146, 82], d));
        ctx.beginPath(); ctx.ellipse(x + 2 * sc, y - 4.5 * sc, 3 * sc, 2.2 * sc, 0, 0, 7); ctx.fill();
        break;
      }
      case 'rock': {
        ctx.fillStyle = rgbStr(desat([124, 124, 130], d * 0.3));
        ctx.beginPath();
        ctx.moveTo(x - 4 * sc, y);
        ctx.lineTo(x - 1 * sc, y - 4 * sc);
        ctx.lineTo(x + 3.4 * sc, y - 2.6 * sc);
        ctx.lineTo(x + 4.4 * sc, y);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'flower': {
        for (let i = 0; i < 4; i++) {
          const fx = x + (h01(i, 1, (it.o * 1e4) | 0) - 0.5) * 10 * sc;
          const fy = y + (h01(i, 2, (it.o * 1e4) | 0) - 0.5) * 5 * sc;
          ctx.fillStyle = rgbStr(desat(i % 2 ? [214, 196, 120] : [206, 148, 140], d));
          ctx.fillRect(fx, fy - 2 * sc, 1.8 * sc, 1.8 * sc);
        }
        break;
      }
      case 'deer': {
        const b = desat([140, 104, 70], d * 0.6);
        ctx.fillStyle = rgbStr(b);
        ctx.beginPath(); ctx.ellipse(x, y - 4.5 * sc, 5 * sc, 2.6 * sc, 0, 0, 7); ctx.fill();
        ctx.fillRect(x + 3.4 * sc, y - 8.5 * sc, 1.8 * sc, 4.5 * sc);       // neck
        ctx.beginPath(); ctx.ellipse(x + 4.8 * sc, y - 9 * sc, 2 * sc, 1.3 * sc, 0, 0, 7); ctx.fill();
        for (const lx of [-3, -1, 1.6, 3.4]) ctx.fillRect(x + lx * sc, y - 2.5 * sc, 1 * sc, 3.4 * sc);
        break;
      }
    }
  }

  function drawCanopy(ctx, ox, oy, sc, seed, scar, d, grass, t, rm) {
    // 46 trees felled one by one in deterministic order; stumps remain
    const spots = decorSpots(seed ^ 4242, 46, 1.2, 8.2)
      .sort((a, b) => (a.tx + a.ty) - (b.tx + b.ty));
    // felling order: hash order, not draw order
    const order = spots.map((s, i) => ({ i, k: h01(i, 7, seed) })).sort((a, b) => a.k - b.k);
    const cut = new Set(order.slice(0, Math.round(scar * spots.length)).map(o => o.i));
    spots.forEach((sp, i) => {
      const [x, y] = isoPt(sp.tx, sp.ty, ox, oy, sc);
      if (cut.has(i)) {
        ctx.fillStyle = rgbStr(desat([122, 92, 58], d * 0.4));
        ctx.beginPath(); ctx.ellipse(x, y - 1.4 * sc, 3 * sc, 1.8 * sc, 0, 0, 7); ctx.fill();
        ctx.fillStyle = rgbStr(desat([156, 128, 88], d * 0.4));
        ctx.beginPath(); ctx.ellipse(x, y - 2 * sc, 2.2 * sc, 1.2 * sc, 0, 0, 7); ctx.fill();
      } else {
        drawDecor(ctx, x, y, sc, { type: 'tree', o: sp.o }, d, t, rm);
      }
    });
  }

  /* ---- built things ------------------------------------------------------ */
  function isoBox(ctx, x, y, w, dpt, hgt, cTop, cL, cR) {
    // w,dpt in half-tile units already scaled; hgt in px
    ctx.fillStyle = rgbStr(cL);
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.lineTo(x, y + dpt);
    ctx.lineTo(x, y + dpt - hgt);
    ctx.lineTo(x - w, y - hgt);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgbStr(cR);
    ctx.beginPath();
    ctx.moveTo(x + w, y);
    ctx.lineTo(x, y + dpt);
    ctx.lineTo(x, y + dpt - hgt);
    ctx.lineTo(x + w, y - hgt);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgbStr(cTop);
    ctx.beginPath();
    ctx.moveTo(x, y - hgt - dpt);
    ctx.lineTo(x + w, y - hgt);
    ctx.lineTo(x, y - hgt + dpt);
    ctx.lineTo(x - w, y - hgt);
    ctx.closePath(); ctx.fill();
  }

  function drawTown(ctx, ox, oy, sc, v, d, t) {
    // small cluster, SW corner; windows go dark house by house
    const houses = [[12.6, 13.0], [13.8, 13.9], [12.8, 15.1], [15.0, 12.6], [14.2, 15.7], [15.6, 14.4]];
    const litWindows = Math.round(v.townLit * houses.length * 2);
    let wIdx = 0;
    houses.forEach((hp, i) => {
      const [x, y] = isoPt(hp[0], hp[1], ox, oy, sc);
      const wall = desat([196, 176, 148], d * 0.55);
      const wallD = shade(wall, 0.8);
      const roof = desat([148, 84, 62], d * 0.55);
      isoBox(ctx, x, y, 11 * sc, 6 * sc, 10 * sc, shade(wall, 1.05), wall, wallD);
      // gable roof
      ctx.fillStyle = rgbStr(roof);
      ctx.beginPath();
      ctx.moveTo(x - 11 * sc, y - 10 * sc);
      ctx.lineTo(x, y - 17 * sc);
      ctx.lineTo(x + 11 * sc, y - 10 * sc);
      ctx.lineTo(x, y - 10 * sc + 6 * sc);
      ctx.closePath(); ctx.fill();
      // two windows
      for (let k = 0; k < 2; k++) {
        const lit = wIdx < litWindows;
        wIdx++;
        ctx.fillStyle = lit ? 'rgba(236,196,110,0.95)' : 'rgba(52,50,54,0.9)';
        ctx.fillRect(x - 7 * sc + k * 9 * sc, y - 7.5 * sc + k * 2.5 * sc, 3.4 * sc, 3.4 * sc);
      }
    });
  }

  function drawWorksBuilding(ctx, ox, oy, sc, v, d, t, rm, pal) {
    const [x, y] = isoPt(14.6, 3.6, ox, oy, sc);
    const wall = desat([158, 118, 92], d * 0.4);
    const accent = hexRgb(pal.accent);
    isoBox(ctx, x, y, 22 * sc, 12 * sc, 20 * sc, shade(wall, 1.06), wall, shade(wall, 0.78));
    // door + windows (warm while active)
    ctx.fillStyle = rgbStr(shade(accent, 0.8));
    ctx.fillRect(x - 5 * sc, y - 8 * sc, 7 * sc, 8 * sc);
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = v.activity > 0.05 ? 'rgba(240,204,120,0.9)' : 'rgba(60,58,60,0.9)';
      ctx.fillRect(x + 6 * sc + k * 5 * sc, y - 13 * sc + k * 1.4 * sc, 3 * sc, 3 * sc);
    }
    // chimney + smoke ∝ activity & haze
    ctx.fillStyle = rgbStr(shade(wall, 0.7));
    ctx.fillRect(x + 10 * sc, y - 34 * sc, 5 * sc, 16 * sc);
    const puffs = rm ? 2 : 4;
    if (v.activity > 0.03) {
      for (let i = 0; i < puffs; i++) {
        const p = rm ? (i + 1) / (puffs + 1) : ((t * 0.22 + i / puffs) % 1);
        const px = x + 12.5 * sc + Math.sin(p * 5) * 4 * sc;
        const py = y - 36 * sc - p * 26 * sc;
        ctx.fillStyle = `rgba(120,112,104,${(0.34 + v.haze * 0.35) * (1 - p)})`;
        ctx.beginPath(); ctx.arc(px, py, (3 + p * 7) * sc, 0, 7); ctx.fill();
      }
    }
  }

  function drawHeadframe(ctx, ox, oy, sc, scar, d, v, t, rm) {
    const R = 0.6 + scar * 6.4;
    const a = -Math.PI * 0.72;
    const tx = CX + Math.cos(a) * (R + 1.6), ty = CY + Math.sin(a) * (R + 1.6);
    const [x, y] = isoPt(tx, ty, ox, oy, sc);
    const wood = desat([112, 82, 54], d * 0.4);
    ctx.strokeStyle = rgbStr(wood);
    ctx.lineWidth = 2.6 * sc;
    ctx.beginPath();
    ctx.moveTo(x - 7 * sc, y); ctx.lineTo(x, y - 22 * sc);
    ctx.moveTo(x + 7 * sc, y); ctx.lineTo(x, y - 22 * sc);
    ctx.moveTo(x - 4 * sc, y - 9 * sc); ctx.lineTo(x + 4 * sc, y - 9 * sc);
    ctx.stroke();
    // wheel
    ctx.beginPath(); ctx.arc(x, y - 24 * sc, 4.5 * sc, 0, 7);
    ctx.lineWidth = 1.6 * sc; ctx.stroke();
    if (!rm && v.digging && v.activity > 0.02) {
      const sp = t * 2.2;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(sp) * 4.5 * sc, y - 24 * sc - Math.sin(sp) * 4.5 * sc);
      ctx.lineTo(x + Math.cos(sp) * 4.5 * sc, y - 24 * sc + Math.sin(sp) * 4.5 * sc);
      ctx.stroke();
    }
    // ore cart trundles toward the works
    const p = rm ? 0.4 : ((t * 0.1) % 1);
    const cx0 = tx + 0.5, cy0 = ty - 0.5;
    const [cx, cy] = isoPt(cx0 + p * (14.0 - cx0), cy0 + p * (4.2 - cy0), ox, oy, sc);
    ctx.fillStyle = rgbStr(desat([88, 84, 88], d * 0.3));
    ctx.fillRect(cx - 4 * sc, cy - 5 * sc, 8 * sc, 4 * sc);
    ctx.beginPath(); ctx.arc(cx - 2.4 * sc, cy - 0.6 * sc, 1.4 * sc, 0, 7); ctx.arc(cx + 2.4 * sc, cy - 0.6 * sc, 1.4 * sc, 0, 7); ctx.fill();
  }

  function drawShed(ctx, ox, oy, sc, d) {
    const [x, y] = isoPt(13.8, 4.2, ox, oy, sc);
    const wall = desat([176, 156, 120], d * 0.5);
    isoBox(ctx, x, y, 13 * sc, 7 * sc, 12 * sc, shade(wall, 1.05), wall, shade(wall, 0.8));
  }

  function drawBirds(ctx, W, H, v, t, rm, seed) {
    if (!v.birds) return;
    ctx.strokeStyle = 'rgba(70,72,80,0.75)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      const p = rm ? (0.25 + i * 0.22) : ((t * 0.03 + i * 0.31 + h01(i, 3, seed) * 0.4) % 1);
      const bx = W * p, by = H * (0.13 + 0.07 * Math.sin(p * 9 + i));
      const f = rm ? 0.5 : Math.abs(Math.sin(t * 7 + i * 2));
      ctx.beginPath();
      ctx.moveTo(bx - 4, by - f * 3);
      ctx.quadraticCurveTo(bx, by + 1.5, bx + 4, by - f * 3);
      ctx.stroke();
    }
  }

  function hazeOverlay(ctx, W, H, haze, conv) {
    if (haze > 0.01) {
      const a = Math.min(0.62, haze * 0.6);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, `rgba(201,166,122,${a})`);
      g.addColorStop(0.55, `rgba(201,166,122,${a * 0.55})`);
      g.addColorStop(1, `rgba(201,166,122,${a * 0.28})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (conv > 0.6) {
      ctx.fillStyle = `rgba(190,190,196,${(conv - 0.6) * 0.5})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ======================================================================= */
  /*  FACTORY FLOOR                                                          */
  /* ======================================================================= */

  function drawFactory(ctx, W, H, state, t, opts) {
    const v = state.visual;
    const product = PD.PRODUCTS[state.product];
    const pal = product.palette;
    const rm = !!opts.reducedMotion;
    const FN = 16, FM = 11;
    const sc = Math.min(W / ((FN + 1.5) * TW), H / ((FM + 6.5) * TH));
    const ox = W / 2, oy = (H - (FM - 1) * TH * sc) / 2 + 34 * sc;

    // outdoor backdrop shared with the site view — the drift follows you here
    const warm = v.floorWarmth;
    const sky = mix(hexRgb(pal.sky), hexRgb(pal.skyDecay), v.skyDrift);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgbStr(sky));
    g.addColorStop(1, rgbStr(mix(sky, [235, 228, 210], 0.45)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // slab skirt along the south + east edges
    const skirt = mix([86, 80, 74], [72, 74, 80], 1 - warm);
    const swC = isoPt(-0.5, FM - 0.5, ox, oy, sc);
    const seC = isoPt(FN - 0.5, FM - 0.5, ox, oy, sc);
    const neC = isoPt(FN - 0.5, -0.5, ox, oy, sc);
    ctx.fillStyle = rgbStr(skirt);
    ctx.beginPath();
    ctx.moveTo(swC[0], swC[1]); ctx.lineTo(seC[0], seC[1]);
    ctx.lineTo(seC[0], seC[1] + 12 * sc); ctx.lineTo(swC[0], swC[1] + 12 * sc);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgbStr(shade(skirt, 0.8));
    ctx.beginPath();
    ctx.moveTo(seC[0], seC[1]); ctx.lineTo(neC[0], neC[1]);
    ctx.lineTo(neC[0], neC[1] + 12 * sc); ctx.lineTo(seC[0], seC[1] + 12 * sc);
    ctx.closePath(); ctx.fill();

    // floor
    for (let ty = 0; ty < FM; ty++) {
      for (let tx = 0; tx < FN; tx++) {
        const [x, y] = isoPt(tx, ty, ox, oy, sc);
        const base = shade(mix([124, 116, 108], [104, 106, 112], 1 - warm),
          0.96 + (h01(tx, ty, 12) - 0.5) * 0.07);
        paintTile(ctx, x, y, sc, base);
      }
    }

    // material piles (stated resources; log scale)
    drawPile(ctx, ...isoPt(1.4, 9.2, ox, oy, sc), sc, state.resources.raw, hexRgb(pal.rock), 'raw');
    drawPile(ctx, ...isoPt(8.0, 9.6, ox, oy, sc), sc, state.resources.refined, hexRgb(pal.accent), 'refined');
    drawCrates(ctx, ...isoPt(14.2, 9.4, ox, oy, sc), sc, state.resources.product);

    // stations: refine row (upper), assemble row (lower)
    const showRef = Math.min(10, v.refLines);
    const showAsm = Math.min(10, v.asmLines);
    const rawOk = state.resources.raw > 0.5;
    const refOk = state.resources.refined > 0.5;

    // conveyor between rows
    const [c1x, c1y] = isoPt(1, 5.5, ox, oy, sc);
    const [c2x, c2y] = isoPt(FN - 2, 5.5, ox, oy, sc);
    ctx.strokeStyle = 'rgba(60,56,54,0.9)';
    ctx.lineWidth = 7 * sc;
    ctx.beginPath(); ctx.moveTo(c1x, c1y); ctx.lineTo(c2x, c2y); ctx.stroke();
    if (!rm && v.activity > 0.02) {
      ctx.strokeStyle = 'rgba(196,170,110,0.7)';
      ctx.lineWidth = 2 * sc;
      ctx.setLineDash([8 * sc, 12 * sc]);
      ctx.lineDashOffset = -t * 40 * sc;
      ctx.beginPath(); ctx.moveTo(c1x, c1y); ctx.lineTo(c2x, c2y); ctx.stroke();
      ctx.setLineDash([]);
    }

    let unit = 0; // worker/robot slots fill stations in order
    for (let i = 0; i < showRef; i++) {
      const [x, y] = isoPt(1.6 + i * 1.5, 2.6, ox, oy, sc);
      drawFurnace(ctx, x, y, sc, t, rm, v.activity, rawOk, warm);
      unit = drawOperator(ctx, x + 10 * sc, y + 8 * sc, sc, v, unit, t, rm, warm);
    }
    for (let i = 0; i < showAsm; i++) {
      const [x, y] = isoPt(2.2 + i * 1.5, 7.6, ox, oy, sc);
      drawPress(ctx, x, y, sc, t, rm, v.activity, refOk, warm);
      unit = drawOperator(ctx, x + 10 * sc, y + 8 * sc, sc, v, unit, t, rm, warm);
    }
    if (v.refLines > showRef || v.asmLines > showAsm) {
      ctx.fillStyle = 'rgba(226,214,190,0.55)';
      ctx.font = '12px ui-monospace, monospace';
      ctx.fillText(`+${Math.max(0, v.refLines - showRef) + Math.max(0, v.asmLines - showAsm)} lines off-view`, 12, H - 14);
    }

    // spare workers walk the aisle
    const placed = Math.min(unit, v.workers + v.robots);
    const spareHumans = Math.max(0, v.workers - Math.max(0, placed - v.robots));
    for (let i = 0; i < Math.min(4, spareHumans); i++) {
      const p = rm ? (0.2 + i * 0.2) : ((t * 0.05 + i * 0.27) % 1);
      const q = p < 0.5 ? p * 2 : (1 - p) * 2;
      const [x, y] = isoPt(2 + q * 11, 5.0, ox, oy, sc);
      drawHuman(ctx, x, y, sc, t + i * 3, rm, warm, true);
    }

    // lighting mood wash
    ctx.fillStyle = warm > 0.5
      ? `rgba(255,196,120,${0.08 * warm})`
      : `rgba(90,110,150,${0.10 * (1 - warm)})`;
    ctx.fillRect(0, 0, W, H);
    hazeOverlay(ctx, W, H, v.haze * 0.35, 0);
  }

  function drawPile(ctx, x, y, sc, amount, c, kind) {
    const n = Math.min(26, Math.round(Math.log10(amount + 1) * 8));
    ctx.fillStyle = rgbStr(shade(c, 0.9));
    for (let i = 0; i < n; i++) {
      const px = x + (h01(i, 1, 77) - 0.5) * 26 * sc * (1 - i / 40);
      const py = y - (i / n) * 12 * sc;
      ctx.beginPath(); ctx.arc(px, py, 2.6 * sc, 0, 7); ctx.fill();
    }
  }

  function drawCrates(ctx, x, y, sc, amount) {
    const n = Math.min(6, Math.round(Math.log10(amount + 1) * 1.6));
    for (let i = 0; i < n; i++) {
      const cx = x + (i % 3) * 12 * sc - 12 * sc, cy = y - Math.floor(i / 3) * 10 * sc;
      isoBox(ctx, cx, cy, 6 * sc, 3.5 * sc, 8 * sc, [188, 162, 118], [168, 142, 100], [140, 118, 84]);
    }
  }

  function drawFurnace(ctx, x, y, sc, t, rm, activity, fed, warm) {
    const body = mix([132, 108, 96], [108, 108, 114], 1 - warm);
    isoBox(ctx, x, y, 17 * sc, 10 * sc, 28 * sc, shade(body, 1.05), body, shade(body, 0.75));
    const glow = fed && activity > 0.02;
    const flick = rm ? 1 : (0.85 + 0.15 * Math.sin(t * 9 + x));
    ctx.fillStyle = glow ? `rgba(238,150,70,${0.85 * flick})` : 'rgba(50,46,48,0.95)';
    ctx.fillRect(x - 10 * sc, y - 14 * sc, 11 * sc, 9 * sc);
    ctx.fillStyle = rgbStr(shade(body, 0.7));
    ctx.fillRect(x + 6 * sc, y - 42 * sc, 4.4 * sc, 16 * sc); // stack
    if (glow && !rm) {
      ctx.fillStyle = `rgba(150,140,132,${0.4 * flick})`;
      ctx.beginPath(); ctx.arc(x + 8.2 * sc, y - 46 * sc, 3.6 * sc, 0, 7); ctx.fill();
    }
  }

  function drawPress(ctx, x, y, sc, t, rm, activity, fed, warm) {
    const body = mix([120, 116, 124], [104, 108, 118], 1 - warm);
    isoBox(ctx, x, y, 15 * sc, 9 * sc, 18 * sc, shade(body, 1.08), body, shade(body, 0.78));
    // reciprocating head
    const ph = (fed && activity > 0.02 && !rm) ? Math.abs(Math.sin(t * 5 + x * 0.3)) : 0.5;
    ctx.fillStyle = rgbStr(shade(body, 0.6));
    ctx.fillRect(x - 3 * sc, y - 34 * sc + ph * 8 * sc, 6 * sc, 13 * sc);
    ctx.fillStyle = rgbStr([192, 138, 46]);
    ctx.fillRect(x - 8 * sc, y - 19 * sc, 16 * sc, 2.6 * sc);
  }

  function drawOperator(ctx, x, y, sc, v, unit, t, rm, warm) {
    const stations = Math.min(10, v.refLines) + Math.min(10, v.asmLines);
    const humansAtStations = Math.min(v.workers, Math.max(0, stations - v.robots));
    if (unit < v.robots) drawRobot(ctx, x, y, sc, t, rm, v.activity);
    else if (unit < v.robots + humansAtStations) drawHuman(ctx, x, y, sc, t + unit, rm, warm, false);
    return unit + 1;
  }

  function drawHuman(ctx, x, y, sc, t, rm, warm, walking) {
    const bob = rm ? 0 : Math.sin(t * (walking ? 6 : 2.4)) * 1.2 * sc;
    const shirt = warm > 0.4 ? [92, 118, 142] : [96, 102, 112];
    ctx.fillStyle = rgbStr(shirt);
    ctx.fillRect(x - 2.6 * sc, y - 12 * sc + bob, 5.2 * sc, 7.5 * sc);
    ctx.fillStyle = 'rgb(212,178,148)';
    ctx.beginPath(); ctx.arc(x, y - 14.5 * sc + bob, 2.6 * sc, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgb(64,60,66)';
    ctx.fillRect(x - 2.4 * sc, y - 4.5 * sc + bob, 2 * sc, 4.5 * sc);
    ctx.fillRect(x + 0.4 * sc, y - 4.5 * sc + bob, 2 * sc, 4.5 * sc);
  }

  function drawRobot(ctx, x, y, sc, t, rm, activity) {
    ctx.fillStyle = 'rgb(88,92,102)';
    ctx.fillRect(x - 3.5 * sc, y - 4 * sc, 7 * sc, 4 * sc); // pedestal
    const a = (rm || activity < 0.02) ? 0.6 : (0.35 + 0.5 * Math.abs(Math.sin(t * 2.2 + x * 0.1)));
    ctx.strokeStyle = 'rgb(150,154,164)';
    ctx.lineWidth = 3 * sc;
    ctx.beginPath();
    ctx.moveTo(x, y - 4 * sc);
    ctx.lineTo(x + Math.cos(-a) * 9 * sc, y - 4 * sc + Math.sin(-a) * 9 * sc);
    ctx.lineTo(x + Math.cos(-a) * 9 * sc + Math.cos(-a * 2) * 7 * sc,
      y - 4 * sc + Math.sin(-a) * 9 * sc + Math.sin(-a * 2) * 7 * sc);
    ctx.stroke();
    ctx.fillStyle = 'rgba(200,120,60,0.9)';
    ctx.fillRect(x + Math.cos(-a) * 9 * sc + Math.cos(-a * 2) * 7 * sc - 1.2 * sc,
      y - 4 * sc + Math.sin(-a) * 9 * sc + Math.sin(-a * 2) * 7 * sc - 1.2 * sc, 2.4 * sc, 2.4 * sc);
  }

  PD.RenderIso = { drawSite, drawFactory };
})();
