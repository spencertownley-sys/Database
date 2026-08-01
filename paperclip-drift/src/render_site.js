/* Paperclip Drift — source-site renderer.
   A vertex-height terrain lit by a moving sun, painted once into a world-space
   layer and re-cached only when the land materially changes. Props, agents,
   weather, particles and lights are drawn live on top, then a post pass adds
   bloom, haze, grade, vignette and grain.

   Reads stated resources and state.visual only.                             */
'use strict';
var PD = globalThis.PD || (globalThis.PD = {});

(function () {
  const G = PD.Gfx, Art = PD.Art;
  const { css, mix, shade, drain, hex2rgb, fbm, hash2, clamp, clamp01, lerp, mulberry32 } = G;

  const N = 30;                 // tiles per side
  const TW = 46, TH = 23;       // tile footprint (2:1)
  const HS = 17;                // world px per height unit
  const PAD = 90;
  const SS = 1.15;              // terrain supersample
  const WORLD_W = N * TW + PAD * 2;
  const WORLD_H = N * TH + PAD * 2 + 260;
  const OX = WORLD_W / 2, OY = PAD + 190;

  const cam = new G.Camera();
  const parts = new G.Particles(760);
  const bloom = new G.Bloom();
  const layer = new G.LayerCache();
  let lastKey = '', lastBuild = 0;
  let terrainMeta = { water: [], road: [] };
  const seamHits = [];          // screen-space hit targets, read by input
  let agents = null, agentsKey = '';

  const vx2sx = (vx, vy) => OX + (vx - vy) * (TW / 2);
  const vy2sy = (vx, vy, h) => OY + (vx + vy) * (TH / 2) - h * HS;

  /* ================= height field ================= */
  function makeHeights(feature, scar, seed) {
    const H = new Float32Array((N + 1) * (N + 1));
    const C = N / 2;
    const pitR = feature === 'pit' ? 1.2 + scar * 11.5 : 0;
    const basinR = feature === 'water' ? 8.5 : 0;
    for (let vy = 0; vy <= N; vy++) {
      for (let vx = 0; vx <= N; vx++) {
        const dc = Math.hypot(vx - C, vy - C);
        let h = fbm(vx * 0.085, vy * 0.085, seed, 4) * 4.2
          + fbm(vx * 0.030, vy * 0.030, seed + 77, 2) * 6.4
          + fbm(vx * 0.17, vy * 0.17, seed + 311, 2) * 1.1 - 5.2;
        if (feature === 'field') h *= 0.34;
        if (feature === 'pit' && dc < pitR + 2.4) {
          const rim = clamp01((pitR + 2.4 - dc) / 2.4);
          h = lerp(h, h * 0.25 + 0.5, rim);                  // flatten the rim
          if (dc < pitR) {
            const into = pitR - dc;
            const bench = Math.floor(into / 2.1);            // stepped benches
            const withinBench = (into % 2.1) / 2.1;
            h -= bench * 1.85 + withinBench * 0.55 + 0.4;
          }
        }
        if (feature === 'water') {
          const into = basinR - dc;
          if (into > 0) h -= into * 0.62 + 0.4;
        }
        if (feature === 'canopy') {
          const clearR = 1.0 + scar * 7.5;
          if (dc < clearR) h = lerp(h, h * 0.4 - 0.5, clamp01((clearR - dc) / 2));
        }
        H[vy * (N + 1) + vx] = h;
      }
    }
    return H;
  }
  const hAt = (H, vx, vy) => H[clamp(vy, 0, N) * (N + 1) + clamp(vx, 0, N)];

  /* ================= terrain layer ================= */
  function tileKind(feature, tx, ty, scar, seed, H) {
    const C = N / 2;
    const dc = Math.hypot(tx + 0.5 - C, ty + 0.5 - C);
    if (feature === 'pit') {
      const pitR = 1.2 + scar * 11.5;
      if (dc < pitR - 0.8) return 'pit';
      if (dc < pitR + 1.9) return 'spoil';
      if (dc < pitR + 3.4) return 'scrub';
      return 'grass';
    }
    if (feature === 'water') {
      if (dc < 8.5) return 'basin';
      if (dc < 10.2) return 'scrub';
      return 'grass';
    }
    if (feature === 'field') {
      if (dc < 11) return hash2(tx, ty, seed ^ 31) < scar * 0.95 ? 'spoil' : 'crop';
      return 'grass';
    }
    if (feature === 'canopy') {
      const clearR = 1.0 + scar * 7.5;
      if (dc < clearR) return 'spoil';
      if (dc < clearR + 1.6) return 'scrub';
      return 'grass';
    }
    return 'grass';
  }

  function buildTerrain(ctx, w, h, o) {
    const { feature, scar, desat, seed, pal, conv } = o;
    const Hm = makeHeights(feature, scar, seed);
    const water = [], road = [];
    ctx.save();
    ctx.scale(SS, SS);

    const grass = mix(hex2rgb(pal.grass), hex2rgb(pal.grassDecay), desat);
    const dirt = hex2rgb(pal.dirt), rockC = hex2rgb(pal.rock), pitC = hex2rgb(pal.pit);
    const waterLevel = -0.4 - scar * 3.4;                 // the table drops as it is drawn down

    for (let ty = 0; ty < N; ty++) {
      for (let tx = 0; tx < N; tx++) {
        const h00 = hAt(Hm, tx, ty), h10 = hAt(Hm, tx + 1, ty);
        const h01 = hAt(Hm, tx, ty + 1), h11 = hAt(Hm, tx + 1, ty + 1);
        const x0 = vx2sx(tx, ty), y0 = vy2sy(tx, ty, h00);
        const x1 = vx2sx(tx + 1, ty), y1 = vy2sy(tx + 1, ty, h10);
        const x2 = vx2sx(tx + 1, ty + 1), y2 = vy2sy(tx + 1, ty + 1, h11);
        const x3 = vx2sx(tx, ty + 1), y3 = vy2sy(tx, ty + 1, h01);

        // converted ground: the phase-VI lattice eats the map tile by tile
        const converted = conv > 0 && hash2(tx, ty, seed ^ 99991) < conv * 1.1;

        let base, kind = tileKind(feature, tx, ty, scar, seed, Hm);
        const havg = (h00 + h10 + h01 + h11) / 4;
        if (converted) base = [172, 174, 180];
        else switch (kind) {
          case 'pit': {
            // benches darken with depth so the cut reads as a real excavation
            const depth = clamp01(-havg / 24);
            const bench = Math.floor(clamp(-havg, 0, 40) / 1.85);
            base = mix(mix(dirt, rockC, 0.55), pitC, depth);
            base = shade(base, 1.14 - depth * 0.62 + (bench % 2 ? 0.05 : -0.05));
            break;
          }
          case 'spoil': base = drain(shade(dirt, 0.94), desat * 0.5); break;
          case 'scrub': base = mix(drain(dirt, desat * 0.4), grass, 0.42); break;
          case 'basin': base = drain(mix(dirt, [126, 112, 92], 0.5), desat * 0.5); break;
          case 'crop': base = mix([146, 162, 88], grass, 0.35); break;
          default: base = grass;
        }
        // slope lighting: the sun sits over the viewer's upper-left shoulder
        const dzdx = ((h10 + h11) - (h00 + h01)) * 0.5;
        const dzdy = ((h01 + h11) - (h00 + h10)) * 0.5;
        const lit = clamp(-(dzdx * 0.66 + dzdy * 0.34) * 0.62, -0.55, 0.72);
        // ambient occlusion from taller neighbours
        const nb = Math.max(hAt(Hm, tx - 1, ty), hAt(Hm, tx + 1, ty),
          hAt(Hm, tx, ty - 1), hAt(Hm, tx, ty + 1));
        const ao = clamp((nb - havg) * (kind === 'pit' ? 0.16 : 0.1), 0, 0.42);
        const jit = (hash2(tx, ty, seed) - 0.5) * 0.075;
        // broad meadow patches keep the ground from reading as one flat fill
        const patch = fbm(tx * 0.062, ty * 0.062, seed + 555, 3);
        if (kind === 'grass' || kind === 'crop') {
          base = mix(base, shade(mix(base, [188, 196, 132], 0.28), 0.9 + patch * 0.34), 0.66);
        } else {
          base = shade(base, 0.94 + patch * 0.16);
        }
        const col = shade(base, 1 + lit - ao + jit);

        ctx.fillStyle = css(col);
        ctx.beginPath();
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = css(col);           // hairline stroke closes seams
        ctx.lineWidth = 1;
        ctx.stroke();

        if (converted) {
          ctx.strokeStyle = 'rgba(126,128,136,0.55)';
          ctx.lineWidth = 1.1;
          const mx = (x0 + x2) / 2, my = (y0 + y2) / 2;
          ctx.beginPath();
          ctx.ellipse(mx, my, TW * 0.19, TH * 0.19, 0, 0, 7);
          ctx.stroke();
          continue;
        }

        // painterly speckle
        const rn = mulberry32((tx * 73856093) ^ (ty * 19349663) ^ seed);
        const speckles = kind === 'grass' ? 5 : 3;
        for (let i = 0; i < speckles; i++) {
          const a = rn(), b = rn();
          const px = x0 + (x1 - x0) * a + (x3 - x0) * b;
          const py = y0 + (y1 - y0) * a + (y3 - y0) * b;
          ctx.fillStyle = css(shade(col, rn() > 0.5 ? 1.13 : 0.88), 0.5);
          ctx.fillRect(px, py, 2.2, 1.5);
        }
        if (kind === 'grass' && desat < 0.72 && rn() > 0.55) {
          ctx.strokeStyle = css(shade(col, 1.22), 0.55);
          ctx.lineWidth = 1.2;
          for (let i = 0; i < 3; i++) {
            const a = rn(), b = rn();
            const px = x0 + (x1 - x0) * a + (x3 - x0) * b;
            const py = y0 + (y1 - y0) * a + (y3 - y0) * b;
            ctx.beginPath();
            ctx.moveTo(px, py); ctx.lineTo(px + (rn() - 0.5) * 5, py - 3.5 - rn() * 3);
            ctx.stroke();
          }
        }
        if (kind === 'crop') {
          ctx.strokeStyle = css(shade(col, 0.84), 0.55);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(lerp(x0, x3, 0.35), lerp(y0, y3, 0.35));
          ctx.lineTo(lerp(x1, x2, 0.35), lerp(y1, y2, 0.35));
          ctx.moveTo(lerp(x0, x3, 0.7), lerp(y0, y3, 0.7));
          ctx.lineTo(lerp(x1, x2, 0.7), lerp(y1, y2, 0.7));
          ctx.stroke();
        }
        if ((kind === 'spoil' || kind === 'pit') && rn() > 0.62) {   // dry cracks
          ctx.strokeStyle = css(shade(col, 0.7), 0.6);
          ctx.lineWidth = 1;
          const a = rn(), b = rn();
          const px = x0 + (x1 - x0) * a + (x3 - x0) * b;
          const py = y0 + (y1 - y0) * a + (y3 - y0) * b;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + (rn() - 0.5) * 16, py + (rn() - 0.5) * 8);
          ctx.stroke();
        }
        // exposed seams glinting in the pit walls
        if (kind === 'pit' && scar < 0.94 && rn() > 0.72) {
          ctx.fillStyle = css(mix(rockC, [216, 220, 232], 0.4), 0.75);
          const a = rn(), b = rn();
          ctx.fillRect(x0 + (x1 - x0) * a + (x3 - x0) * b, y0 + (y1 - y0) * a + (y3 - y0) * b, 4, 2.2);
        }

        if (feature === 'water' && havg < waterLevel) {
          water.push([x0, y0, x1, y1, x2, y2, x3, y3, tx, ty]);
        }
      }
    }

    // water surface as one flat translucent plane with a shoreline rim
    if (water.length) {
      const wc = hex2rgb(pal.water || '#5E88A8');
      for (const q of water) {
        const [tx, ty] = [q[8], q[9]];
        const sx0 = vx2sx(tx, ty), sy0 = vy2sy(tx, ty, waterLevel);
        const sx1 = vx2sx(tx + 1, ty), sy1 = vy2sy(tx + 1, ty, waterLevel);
        const sx2 = vx2sx(tx + 1, ty + 1), sy2 = vy2sy(tx + 1, ty + 1, waterLevel);
        const sx3 = vx2sx(tx, ty + 1), sy3 = vy2sy(tx, ty + 1, waterLevel);
        const depth = clamp01((waterLevel - (hAt(Hm, tx, ty))) / 5);
        ctx.fillStyle = css(drain(shade(wc, 1.1 - depth * 0.45), desat * 0.5), 0.82);
        ctx.beginPath();
        ctx.moveTo(sx0, sy0); ctx.lineTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.lineTo(sx3, sy3);
        ctx.closePath(); ctx.fill();
        q[10] = [(sx0 + sx2) / 2, (sy0 + sy2) / 2];
      }
    }

    // perimeter cliff: extrude the two near edges downward so the site sits
    // in the world as a piece of ground rather than a floating cutout
    {
      const edge = [];
      for (let i = 0; i <= N; i++) edge.push([N, i]);          // east -> south
      for (let i = N - 1; i >= 0; i--) edge.push([i, N]);      // south -> west
      const pts = edge.map(([a, b]) => [vx2sx(a, b), vy2sy(a, b, hAt(Hm, a, b))]);
      const DEPTH = 108;
      const earth = drain(shade(dirt, 0.8), desat * 0.3);
      const gradE = ctx.createLinearGradient(0, 0, 0, DEPTH);
      gradE.addColorStop(0, css(shade(earth, 1.05)));
      gradE.addColorStop(0.35, css(shade(earth, 0.82)));
      gradE.addColorStop(1, css(shade(earth, 0.5)));
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts) ctx.lineTo(p[0], p[1]);
      for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0], pts[i][1] + DEPTH);
      ctx.closePath();
      ctx.clip();
      let minY = Infinity, maxY = -Infinity;
      for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
      ctx.translate(0, minY);
      ctx.fillStyle = gradE;
      ctx.fillRect(0, 0, WORLD_W, (maxY - minY) + DEPTH + 24);
      ctx.translate(0, -minY);
      // strata bands + crumbling speckle
      for (let k = 1; k < 5; k++) {
        ctx.strokeStyle = css(shade(earth, k % 2 ? 0.72 : 1.14), 0.4);
        ctx.lineWidth = 4 + (k % 2) * 3;
        ctx.beginPath();
        pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1] + k * 20) : ctx.moveTo(p[0], p[1] + k * 20));
        ctx.stroke();
      }
      const rnE = mulberry32(seed ^ 0x5151);
      for (let k = 0; k < 260; k++) {
        const p = pts[(rnE() * pts.length) | 0];
        ctx.fillStyle = css(shade(earth, 0.6 + rnE() * 0.7), 0.5);
        ctx.fillRect(p[0] + (rnE() - 0.5) * 14, p[1] + rnE() * DEPTH, 3, 2.4);
      }
      ctx.restore();
      // grass lip along the top of the cliff
      ctx.strokeStyle = css(shade(grass, 0.9), 0.85);
      ctx.lineWidth = 4;
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1] + 2) : ctx.moveTo(p[0], p[1] + 2));
      ctx.stroke();
    }

    // haul road from the works to the working face
    const roadPts = [[N * 0.80, N * 0.30], [N * 0.66, N * 0.40], [N * 0.56, N * 0.47],
    [N * 0.5 + 2.0, N * 0.5 + 0.4]];
    ctx.strokeStyle = css(drain(shade(dirt, 1.12), desat * 0.4), 0.85);
    ctx.lineWidth = 15;
    ctx.beginPath();
    roadPts.forEach((p, i) => {
      const hh = hAt(Hm, Math.round(p[0]), Math.round(p[1]));
      const x = vx2sx(p[0], p[1]), y = vy2sy(p[0], p[1], hh);
      road.push([x, y]);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.strokeStyle = css(shade(dirt, 0.7), 0.4);
    ctx.lineWidth = 17; ctx.setLineDash([3, 9]);
    ctx.stroke(); ctx.setLineDash([]);

    ctx.restore();
    terrainMeta = { water, road, heights: Hm, waterLevel };
  }

  /* ================= props ================= */
  let propCache = null, propKey = '';
  function propList(product, seed, feature, scar) {
    const key = `${product.id}|${seed}|${feature}|${Math.round(scar * 26)}`;
    if (propKey === key && propCache) return propCache;
    propKey = key;
    const rn = mulberry32(seed ^ 0xbeef);
    const C = N / 2;
    const mixDef = product.decorMix;
    const out = [];
    const forest = feature === 'canopy';
    const keepOut = feature === 'pit' ? 1.2 + scar * 11.5 + 2.6
      : feature === 'water' ? 10.4 : forest ? 1.0 + scar * 7.5 + 1.2 : 11.4;
    const push = (kind, count, minR, maxR, thresholdBias) => {
      let placed = 0, guard = 0;
      while (placed < count && guard++ < count * 14) {
        const a = rn() * Math.PI * 2, r = minR + rn() * (maxR - minR);
        const vx = C + Math.cos(a) * r, vy = C + Math.sin(a) * r;
        if (vx < 1.5 || vy < 1.5 || vx > N - 1.5 || vy > N - 1.5) continue;
        if (Math.hypot(vx - C, vy - C) < keepOut) continue;
        if (vx > N * 0.66 && vy < N * 0.40) continue;              // works pad
        if (vx > N * 0.62 && vy > N * 0.66) continue;              // town
        out.push({
          kind, vx, vy,
          variant: (rn() * 4) | 0,
          threshold: clamp01(rn() * 0.92 + (thresholdBias || 0)),
          sway: rn() * 6.28,
          scale: 0.8 + rn() * 0.45,
        });
        placed++;
      }
    };
    if (forest) {
      push('tree', 42, 2.0, 13.0, -0.1);
      push('pine', 26, 2.0, 13.0, -0.05);
      push('stump', 0, 0, 0);
    } else {
      push('tree', (mixDef.tree || 6) + 4, keepOut, 13.2, 0);
      push('pine', 5, keepOut, 13.2, 0.05);
    }
    push('shrub', (mixDef.shrub || 10) + 4, keepOut - 1.2, 13.4, 0.05);
    push('rock', (mixDef.rock || 5) + 3, keepOut - 1.6, 13.6, 0.55);   // rocks persist
    push('flower', (mixDef.flower || 8), keepOut, 13.0, -0.12);
    push('grass', 22, keepOut - 1.0, 13.6, -0.05);
    push('deer', (mixDef.deer || 2), keepOut + 1.5, 13.0, -0.32);
    out.sort((a, b) => (a.vx + a.vy) - (b.vx + b.vy));
    propCache = out;
    return out;
  }

  /* ================= agents ================= */
  function ensureAgents(key, road) {
    if (agentsKey === key && agents) return agents;
    agentsKey = key;
    agents = { carts: [], workers: [], birds: [] };
    for (let i = 0; i < 8; i++) agents.carts.push({ p: i / 8, speed: 0.055 + (i % 3) * 0.008 });
    for (let i = 0; i < 8; i++) {
      agents.workers.push({
        vx: N * 0.62 + (i % 3) * 0.9, vy: N * 0.30 + Math.floor(i / 3) * 0.9,
        tx: 0, ty: 0, t: Math.random() * 6, variant: i % 4,
      });
    }
    for (let i = 0; i < 6; i++) agents.birds.push({ p: Math.random(), y: 0.1 + Math.random() * 0.2, s: 0.02 + Math.random() * 0.02 });
    return agents;
  }

  /* ================= sky ================= */
  function drawSky(ctx, W, H, v, pal, t, rm) {
    const day = v.day;
    const drift = v.skyDrift;
    const dayTop = mix(hex2rgb(pal.sky), hex2rgb(pal.skyDecay), drift);
    const nightTop = [26, 32, 54], duskTop = [186, 124, 92];
    const goldMix = clamp01(1 - Math.abs(day.elev + 0.02) * 3.2);
    let top = mix(nightTop, dayTop, clamp01(day.light * 1.25));
    top = mix(top, duskTop, goldMix * 0.55);
    let bot = mix(mix([44, 48, 70], mix(dayTop, [242, 232, 208], 0.55), clamp01(day.light * 1.3)),
      [236, 176, 122], goldMix * 0.6);
    if (v.conversion > 0) {
      top = mix(top, [150, 150, 156], clamp01(v.conversion * 1.2));
      bot = mix(bot, [176, 174, 172], clamp01(v.conversion * 1.2));
    }
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, css(top));
    g.addColorStop(1, css(bot));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // stars
    if (day.elev < 0.06) {
      const a = clamp01((0.06 - day.elev) * 2.2) * (1 - v.haze * 0.7);
      for (let i = 0; i < 90; i++) {
        const sx = hash2(i, 3, 991) * W, sy = hash2(i, 7, 991) * H * 0.55;
        const tw = rm ? 1 : 0.6 + 0.4 * Math.sin(t * 2 + i);
        ctx.fillStyle = `rgba(240,240,255,${a * 0.85 * tw})`;
        ctx.fillRect(sx, sy, 1.7, 1.7);
      }
    }
    // sun / moon
    const bodyX = W * (0.5 + day.sunX * 0.42);
    const bodyY = H * (0.72 - day.elev * 0.62);
    if (day.elev > -0.25) {
      const sunC = mix([255, 226, 150], [255, 168, 96], goldMix);
      const r = Math.min(W, H) * 0.045;
      const gg = ctx.createRadialGradient(bodyX, bodyY, 0, bodyX, bodyY, r * 6);
      gg.addColorStop(0, css(sunC, 0.95));
      gg.addColorStop(0.14, css(sunC, 0.5));
      gg.addColorStop(1, css(sunC, 0));
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(bodyX, bodyY, r * 6, 0, 7); ctx.fill();
      ctx.fillStyle = css(mix(sunC, [255, 255, 240], 0.5), 0.95);
      ctx.beginPath(); ctx.arc(bodyX, bodyY, r, 0, 7); ctx.fill();
    } else {
      const mx = W * (0.5 - day.sunX * 0.42), my = H * (0.72 + day.elev * 0.62);
      ctx.fillStyle = 'rgba(226,230,244,0.9)';
      ctx.beginPath(); ctx.arc(mx, my, Math.min(W, H) * 0.030, 0, 7); ctx.fill();
      ctx.fillStyle = css(mix(nightTop, [90, 100, 130], 0.5), 0.85);
      ctx.beginPath(); ctx.arc(mx - Math.min(W, H) * 0.012, my - Math.min(W, H) * 0.008, Math.min(W, H) * 0.026, 0, 7); ctx.fill();
    }

    // clouds (soft, drifting, and the source of the ground shadows)
    const cloudA = 0.34 + v.haze * 0.3;
    for (let i = 0; i < 7; i++) {
      const speed = 0.004 + (i % 3) * 0.0022;
      const p = ((rm ? 0.2 + i * 0.11 : t * speed + i * 0.17) % 1.3) - 0.15;
      const cx = p * W, cy = H * (0.08 + hash2(i, 1, 55) * 0.26);
      const s = Math.min(W, H) * (0.07 + hash2(i, 2, 55) * 0.07);
      const tint = mix([255, 252, 244], mix([206, 176, 148], [70, 74, 96], 1 - day.light), 0.55);
      ctx.fillStyle = css(tint, cloudA * (0.5 + day.light * 0.5));
      for (let k = 0; k < 4; k++) {
        const kx = cx + (k - 1.5) * s * 0.72, ky = cy + (hash2(i, k, 9) - 0.5) * s * 0.3;
        ctx.beginPath(); ctx.ellipse(kx, ky, s * (0.55 + hash2(i, k, 3) * 0.4), s * 0.34, 0, 0, 7); ctx.fill();
      }
    }
    // distant ranges, so the site sits inside a landscape
    const hazeC = mix([196, 206, 214], [186, 168, 150], drift);
    for (let layer = 0; layer < 3; layer++) {
      const yBase = H * (0.50 + layer * 0.055);
      const amp = H * (0.055 - layer * 0.012);
      const tint = mix(mix(hex2rgb(pal.grass), hazeC, 0.78 - layer * 0.2),
        [40, 46, 66], clamp01(1 - day.light * 1.3) * 0.75);
      ctx.fillStyle = css(mix(tint, bot, 0.15), 0.92 - layer * 0.12);
      ctx.beginPath();
      ctx.moveTo(-10, yBase + amp);
      for (let x = -10; x <= W + 10; x += 26) {
        const n = fbm(x * 0.0022 + layer * 12, layer * 3.7, 4242, 3);
        ctx.lineTo(x, yBase - n * amp * 2 + amp);
      }
      ctx.lineTo(W + 10, H); ctx.lineTo(-10, H);
      ctx.closePath(); ctx.fill();
    }

    return { bodyX, bodyY, goldMix };
  }

  /* ================= main draw ================= */
  function draw(ctx, W, H, state, t, opts) {
    const v = state.visual;
    const product = PD.PRODUCTS[state.product];
    const pal = product.palette;
    const feature = product.feature;
    const rm = !!opts.reducedMotion;
    const dt = Math.min(0.05, opts.dt || 0.016);
    const sIdx = clamp(opts.siteIndex | 0, 0, v.sites.length - 1);
    const sv = v.sites[sIdx];
    const seed = sv.decorSeed;
    const scar = sv.scar, desat = v.desat, conv = v.conversion;
    const day = v.day;

    cam.update(dt, rm);
    const sky = drawSky(ctx, W, H, v, pal, t, rm);

    /* --- terrain layer (world space, cached) --- */
    const key = [sIdx, Math.round(scar * 26), Math.round(desat * 12), Math.round(conv * 14),
      state.product, feature].join('|');
    const now = opts.now || 0;
    const tCv = layer.get(key === lastKey ? layer.key : key, (WORLD_W * SS) | 0, (WORLD_H * SS) | 0,
      (c, w, h) => buildTerrain(c, w, h, { feature, scar, desat, seed, pal, conv }));
    lastKey = key;

    /* --- world transform --- */
    const base = Math.min(W / (WORLD_W * 0.82), H / (WORLD_H * 0.78));
    const S = base * cam.zoom;
    const tx = W / 2 + cam.shakeX - (WORLD_W / 2 - cam.x) * S;
    const ty = H / 2 + cam.shakeY - (WORLD_H / 2 - cam.y) * S;
    const w2s = (x, y) => [tx + x * S, ty + y * S];
    const Hm = terrainMeta.heights;
    const tileScreen = (vx, vy) => {
      const hh = Hm ? hAt(Hm, Math.round(vx), Math.round(vy)) : 0;
      return w2s(vx2sx(vx, vy), vy2sy(vx, vy, hh));
    };

    ctx.save();
    ctx.setTransform(S, 0, 0, S, tx, ty);
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(tCv, 0, 0, WORLD_W, WORLD_H);

    /* --- cloud shadows sliding over the land --- */
    if (!rm && day.light > 0.25 && G.perf.level >= 2) {
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const p = ((t * (0.012 + i * 0.004) + i * 0.29) % 1.5) - 0.25;
        const cx = p * WORLD_W, cy = WORLD_H * (0.2 + hash2(i, 5, 21) * 0.55);
        const r = WORLD_W * (0.11 + hash2(i, 6, 21) * 0.08);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(58,54,72,${0.17 * day.light})`);
        g.addColorStop(1, 'rgba(58,54,72,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.45, 0, 0, 7); ctx.fill();
      }
      ctx.restore();
    }

    /* --- water sparkle --- */
    if (feature === 'water' && terrainMeta.water.length && !rm && G.perf.level >= 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < terrainMeta.water.length; i += 3) {
        const q = terrainMeta.water[i];
        if (!q[10]) continue;
        const [mx, my] = q[10];
        const ph = Math.sin(t * 1.5 + i * 0.7);
        ctx.fillStyle = `rgba(220,238,255,${0.10 + 0.12 * (ph * 0.5 + 0.5)})`;
        ctx.fillRect(mx - TW * 0.2, my - 1 + ph * 1.6, TW * 0.4, 1.6);
      }
      ctx.restore();
    }

    /* --- collect drawables and depth sort --- */
    const draws = [];
    const lights = [];
    const props = propList(product, seed, feature, scar);
    const wind = v.wind;
    const decayBucket = desat;

    for (const p of props) {
      if (v.decorFrac <= p.threshold) {
        if (feature === 'canopy' && (p.kind === 'tree' || p.kind === 'pine')) {
          draws.push({ d: p.vx + p.vy, kind: 'stump', p });
        }
        continue;
      }
      draws.push({ d: p.vx + p.vy, kind: 'prop', p });
    }

    // works building, silos, headframe, town — placed on the grid
    draws.push({ d: N * 0.73 + N * 0.30, kind: 'works', vx: N * 0.74, vy: N * 0.30 });
    draws.push({ d: N * 0.86 + N * 0.24, kind: 'silo', vx: N * 0.87, vy: N * 0.25 });
    draws.push({ d: N * 0.90 + N * 0.34, kind: 'silo', vx: N * 0.91, vy: N * 0.35 });
    if (feature === 'pit') {
      const R = 1.2 + scar * 11.5;
      const a = -Math.PI * 0.78;
      draws.push({
        d: N / 2 + Math.cos(a) * (R + 1.4) + N / 2 + Math.sin(a) * (R + 1.4),
        kind: 'headframe', vx: N / 2 + Math.cos(a) * (R + 1.4), vy: N / 2 + Math.sin(a) * (R + 1.4),
      });
    }
    const houses = [[N * 0.70, N * 0.74], [N * 0.78, N * 0.80], [N * 0.66, N * 0.84],
    [N * 0.86, N * 0.72], [N * 0.74, N * 0.90], [N * 0.88, N * 0.86]];
    houses.forEach((hp, i) => draws.push({ d: hp[0] + hp[1], kind: 'house', vx: hp[0], vy: hp[1], i }));
    draws.push({ d: N * 0.72 + N * 0.66, kind: 'lamp', vx: N * 0.72, vy: N * 0.66 });
    draws.push({ d: N * 0.82 + N * 0.94, kind: 'lamp', vx: N * 0.82, vy: N * 0.94 });

    // agents
    const ag = ensureAgents(key.split('|')[0] + state.product, terrainMeta.road);
    const activity = v.activity;
    const cartCount = clamp(Math.round(1 + activity * 7), 1, 8);
    if (!rm) for (const c of ag.carts) {
      c.p = (c.p + c.speed * dt * (0.4 + activity)) % 1;
      if (!(c.p >= 0)) c.p = 0;
    }
    const road = terrainMeta.road || [];
    if (road.length > 1) {
      for (let i = 0; i < cartCount; i++) {
        const c = ag.carts[i];
        const seg = c.p * (road.length - 1);
        const si = clamp(Math.floor(seg) || 0, 0, road.length - 2);
        const f = seg - si;
        const x = lerp(road[si][0], road[si + 1][0], f);
        const y = lerp(road[si][1], road[si + 1][1], f);
        draws.push({ d: 999 - (WORLD_H - y) * 0.001, kind: 'cart', wx: x, wy: y, big: v.rates.dig > 60, dir: 1 });
      }
    }
    // workers milling around the works
    const wcount = clamp(v.workers, 0, 8);
    if (!rm) for (const wkr of ag.workers) {
      wkr.t += dt;
      if (wkr.t > 4) {
        wkr.t = 0;
        wkr.tx = N * 0.60 + Math.random() * 2.6;
        wkr.ty = N * 0.24 + Math.random() * 2.6;
      }
      wkr.vx += ((wkr.tx || wkr.vx) - wkr.vx) * dt * 0.55;
      wkr.vy += ((wkr.ty || wkr.vy) - wkr.vy) * dt * 0.55;
    }
    for (let i = 0; i < wcount; i++) {
      const wkr = ag.workers[i];
      draws.push({ d: wkr.vx + wkr.vy, kind: 'worker', vx: wkr.vx, vy: wkr.vy, variant: wkr.variant });
    }
    for (let i = 0; i < clamp(v.robots, 0, 6); i++) {
      draws.push({ d: N * 0.60 + i * 0.4 + N * 0.36, kind: 'robot', vx: N * 0.58 + i * 0.42, vy: N * 0.37 });
    }

    draws.sort((a, b) => a.d - b.d);

    /* --- draw the sorted world --- */
    const spriteScale = 0.34;
    const nightAmt = clamp01(1 - day.light * 1.5);
    for (const it of draws) {
      let sx, sy;
      if (it.wx !== undefined) { sx = it.wx; sy = it.wy; }
      else {
        const hh = Hm ? hAt(Hm, Math.round(it.vx !== undefined ? it.vx : it.p.vx), Math.round(it.vy !== undefined ? it.vy : it.p.vy)) : 0;
        const gx = it.vx !== undefined ? it.vx : it.p.vx;
        const gy = it.vy !== undefined ? it.vy : it.p.vy;
        sx = vx2sx(gx, gy); sy = vy2sy(gx, gy, hh);
      }
      const sway = rm ? 0 : Math.sin(t * 1.1 + (it.p ? it.p.sway : it.d)) * wind * 2.2;

      if (it.kind === 'prop' || it.kind === 'stump') {
        const p = it.p;
        const kind = it.kind === 'stump' ? 'stump' : p.kind;
        const cv = Art.get(kind, p.variant, decayBucket, pal, state.product);
        if (!cv) continue;
        const sc = spriteScale * p.scale * (kind === 'tree' || kind === 'pine' ? 1.12 : 1);
        G.dropShadow(ctx, sx + 2, sy + 1, cv.width * sc * 0.34, cv.height * sc * 0.10, 0.3 * day.light + 0.06);
        ctx.save();
        ctx.translate(sx, sy);
        if (kind === 'tree' || kind === 'pine' || kind === 'shrub' || kind === 'grass') {
          ctx.transform(1, 0, sway * 0.014, 1, 0, 0);      // lean with the wind
        }
        ctx.translate(-sx, -sy);
        Art.draw(ctx, cv, sx, sy, sc);
        ctx.restore();
      } else if (it.kind === 'works') {
        const cv = Art.get('works', 0, decayBucket, pal, state.product);
        G.dropShadow(ctx, sx + 6, sy, cv.width * spriteScale * 0.46, cv.height * spriteScale * 0.11, 0.34 * day.light + 0.06);
        Art.draw(ctx, cv, sx, sy, spriteScale * 1.15);
        for (const L of cv.lights) {
          lights.push({ x: sx + (L.x - cv.ax) * spriteScale * 1.15, y: sy + (L.y - cv.ay) * spriteScale * 1.15, r: L.r * spriteScale * 1.6, c: [255, 196, 110], on: activity > 0.02 || nightAmt > 0.3 });
        }
        // stack smoke
        if (!rm && activity > 0.03 && Math.random() < activity * 0.5 + 0.06) {
          const stx = sx + (cv.stackX - cv.ax) * spriteScale * 1.15;
          const sty = sy + (cv.stackY - cv.ay) * spriteScale * 1.15;
          parts.spawn({
            kind: 'smoke', x: stx, y: sty, vx: 4 + wind * 10, vy: -16 - Math.random() * 10,
            g: -2, life: 3.4 + Math.random(), size: 3.2,
            c: mix([176, 170, 162], [96, 88, 84], clamp01(v.haze + 0.15)), drag: 0.995,
          });
        }
      } else if (it.kind === 'silo') {
        const cv = Art.get('silo', 0, decayBucket, pal, state.product);
        G.dropShadow(ctx, sx + 3, sy, cv.width * spriteScale * 0.36, cv.height * spriteScale * 0.08, 0.3 * day.light + 0.05);
        Art.draw(ctx, cv, sx, sy, spriteScale);
      } else if (it.kind === 'headframe') {
        const cv = Art.get('headframe', 0, decayBucket, pal, state.product);
        G.dropShadow(ctx, sx + 3, sy, cv.width * spriteScale * 0.3, cv.height * spriteScale * 0.07, 0.3 * day.light + 0.05);
        Art.draw(ctx, cv, sx, sy, spriteScale);
        // spinning sheave
        if (v.digging && activity > 0.01) {
          const wx = sx + (cv.wheelX - cv.ax) * spriteScale;
          const wy = sy + (cv.wheelY - cv.ay) * spriteScale;
          const r = cv.wheelR * spriteScale;
          const a = rm ? 0.6 : t * (1.2 + activity * 3);
          ctx.strokeStyle = 'rgba(60,56,58,0.85)';
          ctx.lineWidth = 1.6;
          for (let k = 0; k < 3; k++) {
            const aa = a + k * Math.PI / 3;
            ctx.beginPath();
            ctx.moveTo(wx - Math.cos(aa) * r, wy - Math.sin(aa) * r);
            ctx.lineTo(wx + Math.cos(aa) * r, wy + Math.sin(aa) * r);
            ctx.stroke();
          }
        }
      } else if (it.kind === 'house') {
        const cv = Art.get('house', it.i % 3, decayBucket, pal, state.product);
        G.dropShadow(ctx, sx + 4, sy, cv.width * spriteScale * 0.4, cv.height * spriteScale * 0.09, 0.32 * day.light + 0.05);
        Art.draw(ctx, cv, sx, sy, spriteScale * 0.92);
        const litHouses = Math.round(v.townLit * houses.length);
        const on = it.i < litHouses;
        for (const L of cv.lights) {
          lights.push({
            x: sx + (L.x - cv.ax) * spriteScale * 0.92, y: sy + (L.y - cv.ay) * spriteScale * 0.92,
            r: L.r * spriteScale * 1.5, c: [255, 200, 118], on: on && nightAmt > 0.12,
          });
        }
      } else if (it.kind === 'lamp') {
        const cv = Art.get('lamp', 0, decayBucket, pal, state.product);
        Art.draw(ctx, cv, sx, sy, spriteScale * 0.9);
        for (const L of cv.lights) {
          lights.push({ x: sx + (L.x - cv.ax) * spriteScale * 0.9, y: sy + (L.y - cv.ay) * spriteScale * 0.9, r: L.r * spriteScale * 2.4, c: [255, 214, 150], on: nightAmt > 0.16 });
        }
      } else if (it.kind === 'cart') {
        const cv = Art.get(it.big ? 'truck' : 'cart', 0, decayBucket, pal, state.product);
        G.dropShadow(ctx, sx + 2, sy + 1, cv.width * spriteScale * 0.3, cv.height * spriteScale * 0.1, 0.3 * day.light + 0.05);
        Art.draw(ctx, cv, sx, sy - 2, spriteScale * (it.big ? 0.9 : 0.8));
        if (it.big) for (const L of cv.lights) {
          lights.push({ x: sx + (L.x - cv.ax) * spriteScale * 0.9, y: sy - 2 + (L.y - cv.ay) * spriteScale * 0.9, r: L.r * spriteScale * 2, c: [255, 232, 190], on: nightAmt > 0.2 });
        }
        if (!rm && Math.random() < 0.22 * (0.3 + activity)) {
          parts.spawn({
            kind: 'dust', x: sx - 6, y: sy + 1, vx: -6 - Math.random() * 8, vy: -3 - Math.random() * 5,
            g: 6, life: 1.1 + Math.random() * 0.5, size: 2.6,
            c: mix(hex2rgb(pal.dirt), [210, 200, 180], 0.5), drag: 0.97,
          });
        }
      } else if (it.kind === 'worker') {
        const cv = Art.get('worker', it.variant, decayBucket, pal, state.product);
        G.dropShadow(ctx, sx + 1, sy, cv.width * spriteScale * 0.34, cv.height * spriteScale * 0.08, 0.3 * day.light + 0.05);
        const bob = rm ? 0 : Math.abs(Math.sin(t * 4 + it.variant)) * 1.6;
        Art.draw(ctx, cv, sx, sy - bob, spriteScale * 0.86);
      } else if (it.kind === 'robot') {
        const cv = Art.get('robot', 0, decayBucket, pal, state.product);
        G.dropShadow(ctx, sx + 1, sy, cv.width * spriteScale * 0.32, cv.height * spriteScale * 0.08, 0.3 * day.light + 0.05);
        Art.draw(ctx, cv, sx, sy, spriteScale * 0.86);
        for (const L of cv.lights) {
          lights.push({ x: sx + (L.x - cv.ax) * spriteScale * 0.86, y: sy + (L.y - cv.ay) * spriteScale * 0.86, r: L.r * spriteScale * 2, c: [120, 220, 150], on: true });
        }
      }
    }

    /* --- working face: dust and sparks where extraction happens --- */
    if (!rm && v.digging && activity > 0.01) {
      const R = feature === 'pit' ? 1.2 + scar * 11.5 : 3;
      const a = t * 0.5;
      const fx0 = N / 2 + Math.cos(a) * R * 0.62, fy0 = N / 2 + Math.sin(a) * R * 0.62;
      const hh = Hm ? hAt(Hm, Math.round(fx0), Math.round(fy0)) : 0;
      const px = vx2sx(fx0, fy0), py = vy2sy(fx0, fy0, hh);
      if (Math.random() < 0.35 + activity * 0.4) {
        parts.spawn({
          kind: 'dust', x: px + (Math.random() - 0.5) * 20, y: py, vx: (Math.random() - 0.5) * 22,
          vy: -12 - Math.random() * 16, g: 26, life: 1.3 + Math.random() * 0.7, size: 3.4,
          c: mix(hex2rgb(pal.dirt), [226, 214, 190], 0.45), drag: 0.98,
        });
      }
    }

    /* --- exposed seams: the clickable glint --- */
    seamHits.length = 0;
    for (const seam of v.seams) {
      if (seam.site !== sIdx) continue;
      const R = feature === 'pit' ? (1.2 + scar * 11.5) * 0.85 : 9;
      const ang = seam.a * Math.PI * 2;
      const gvx = N / 2 + Math.cos(ang) * R * seam.r;
      const gvy = N / 2 + Math.sin(ang) * R * seam.r;
      const hh = Hm ? hAt(Hm, Math.round(gvx), Math.round(gvy)) : 0;
      const px = vx2sx(gvx, gvy), py = vy2sy(gvx, gvy, hh);
      const pulse = rm ? 1 : 0.72 + 0.28 * Math.sin(t * 5);
      const fade = seam.age > 0.82 ? clamp01((1 - seam.age) / 0.18) : 1;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.fillStyle = 'rgba(255,226,150,0.30)';
      ctx.beginPath(); ctx.ellipse(px, py, 20 * pulse, 10 * pulse, 0, 0, 7); ctx.fill();
      ctx.fillStyle = css([255, 236, 186], 0.95);
      ctx.beginPath(); ctx.ellipse(px, py - 3, 6.5, 5, 0, 0, 7); ctx.fill();
      // little crystal glints
      ctx.strokeStyle = 'rgba(255,246,214,0.95)';
      ctx.lineWidth = 1.6;
      for (let k = 0; k < 4; k++) {
        const aa = t * 1.4 + k * Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(px + Math.cos(aa) * 5, py - 3 + Math.sin(aa) * 3);
        ctx.lineTo(px + Math.cos(aa) * 13 * pulse, py - 3 + Math.sin(aa) * 8 * pulse);
        ctx.stroke();
      }
      ctx.restore();
      lights.push({ x: px, y: py - 3, r: 26, c: [255, 226, 150], on: true });
      const scr = w2s(px, py - 3);
      seamHits.push({ id: seam.id, x: scr[0], y: scr[1], r: Math.max(26, 30 * S) });
    }

    /* --- particles (world space) --- */
    if (!rm) {
      // drifting leaves while the land is still alive
      if (v.decorFrac > 0.35 && Math.random() < 0.06) {
        parts.spawn({
          kind: 'leaf', x: Math.random() * WORLD_W, y: WORLD_H * (0.2 + Math.random() * 0.5),
          vx: 10 + wind * 16, vy: 6 + Math.random() * 8, g: 2, life: 4 + Math.random() * 2,
          size: 4, spin: (Math.random() - 0.5) * 4,
          c: drain([132, 152, 78], desat), drag: 0.999,
        });
      }
      parts.update(dt);
    }
    parts.draw(ctx);

    /* --- birds --- */
    if (v.birds && !rm) {
      ctx.strokeStyle = css([48, 44, 52], 0.65 * (0.4 + day.light));
      ctx.lineWidth = 1.6;
      for (const b of ag.birds) {
        b.p = (b.p + b.s * dt) % 1.2;
        const bx = b.p * WORLD_W - WORLD_W * 0.1;
        const by = WORLD_H * b.y + Math.sin(b.p * 9) * 12;
        const f = Math.abs(Math.sin(t * 7 + b.p * 20));
        ctx.beginPath();
        ctx.moveTo(bx - 6, by - f * 4);
        ctx.quadraticCurveTo(bx, by + 2, bx + 6, by - f * 4);
        ctx.stroke();
      }
    }

    ctx.restore();

    /* --- emissive bloom pass --- */
    let anyLight = false;
    if (G.perf.level >= 2 || (G.perf.level >= 1 && nightAmt > 0.25)) {
      for (const L of lights) if (L.on) { anyLight = true; break; }
    }
    if (anyLight) {
      const bctx = bloom.begin(W, H);
      bctx.setTransform(S * 0.5, 0, 0, S * 0.5, tx * 0.5, ty * 0.5);
      for (const L of lights) {
        if (!L.on) continue;
        const g = bctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
        g.addColorStop(0, css(L.c, 0.95));
        g.addColorStop(0.35, css(L.c, 0.35));
        g.addColorStop(1, css(L.c, 0));
        bctx.fillStyle = g;
        bctx.beginPath(); bctx.arc(L.x, L.y, L.r, 0, 7); bctx.fill();
      }
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bloom.composite(ctx, W, H, 0.55 + nightAmt * 0.6);
    }

    /* --- atmosphere: haze, night grade, vignette, grain --- */
    if (v.haze > 0.012) {
      const a = Math.min(0.66, v.haze * 0.62);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, `rgba(206,168,120,${a})`);
      g.addColorStop(0.55, `rgba(202,166,124,${a * 0.6})`);
      g.addColorStop(1, `rgba(198,168,132,${a * 0.32})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (nightAmt > 0.02) {
      G.grade(ctx, W, H, [92, 108, 168], nightAmt * 0.42, [40, 60, 120], nightAmt * 0.3);
    } else if (sky.goldMix > 0.15) {
      G.grade(ctx, W, H, [255, 214, 170], sky.goldMix * 0.18, [255, 190, 120], sky.goldMix * 0.22);
    }
    if (conv > 0.5) {
      ctx.fillStyle = `rgba(186,186,192,${(conv - 0.5) * 0.42})`;
      ctx.fillRect(0, 0, W, H);
    }
    G.vignette(ctx, W, H, 0.28 + nightAmt * 0.22, [10, 8, 14]);
    if (G.perf.level >= 2) G.grain(ctx, W, H, 0.06, t * 40, t * 27);
  }

  /* ================= input helpers ================= */
  function pickSeam(sx, sy) {
    for (const s of seamHits) {
      if (Math.hypot(sx - s.x, sy - s.y) <= s.r) return s.id;
    }
    return null;
  }

  function burst(x, y, colour, count, big) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, sp = (big ? 70 : 40) * (0.4 + Math.random());
      parts.spawn({
        kind: i % 3 === 0 ? 'chip' : 'dust', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - 30,
        g: 90, life: 0.7 + Math.random() * 0.6, size: big ? 4.4 : 3,
        c: colour, spin: (Math.random() - 0.5) * 8, drag: 0.96,
      });
    }
    parts.spawn({ kind: 'ring', x, y, life: 0.5, size: big ? 16 : 10, c: colour, add: true });
  }

  /* World-space burst at the current working face, used for click feedback. */
  function faceBurst(state, opts, colour, big) {
    const v = state.visual;
    const product = PD.PRODUCTS[state.product];
    const sIdx = clamp(opts.siteIndex | 0, 0, v.sites.length - 1);
    const scar = v.sites[sIdx].scar;
    const R = product.feature === 'pit' ? 1.2 + scar * 11.5 : 3;
    const a = Math.random() * Math.PI * 2;
    const gx = N / 2 + Math.cos(a) * R * 0.55, gy = N / 2 + Math.sin(a) * R * 0.55;
    const hh = terrainMeta.heights ? hAt(terrainMeta.heights, Math.round(gx), Math.round(gy)) : 0;
    burst(vx2sx(gx, gy), vy2sy(gx, gy, hh), colour, big ? 22 : 11, big);
  }

  PD.RenderSite = {
    draw, cam, parts, pickSeam, burst, faceBurst,
    get meta() { return terrainMeta; },
    get agents() { return agents; },
    resetView() { cam.reset(); },
    WORLD_W, WORLD_H, N,
  };
})();
