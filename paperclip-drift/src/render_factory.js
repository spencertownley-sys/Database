/* Paperclip Drift — factory floor.
   The management view: stations you own, material actually moving between
   them, and the bottleneck visible as a starved machine or a growing pile.
   Reads stated resources and state.visual only.                            */
'use strict';
var PD = globalThis.PD || (globalThis.PD = {});

(function () {
  const G = PD.Gfx, Art = PD.Art;
  const { css, mix, shade, drain, hex2rgb, hash2, clamp, clamp01, lerp, mulberry32 } = G;

  const FN = 12, FM = 8;
  const TW = 62, TH = 31;
  const PAD = 90;
  const SS = 1.3;
  const WORLD_W = FN * TW + PAD * 2 + 120;
  const WORLD_H = FM * TH + PAD * 2 + 260;
  const OX = WORLD_W / 2, OY = PAD + 170;

  const cam = new G.Camera();
  const parts = new G.Particles(520);
  const bloom = new G.Bloom();
  const layer = new G.LayerCache();
  let belt = [];                 // animated items on the line

  const sx_ = (x, y) => OX + (x - y) * (TW / 2);
  const sy_ = (x, y) => OY + (x + y) * (TH / 2);

  const REF_ROW = 1.5, ASM_ROW = 5.6, BELT_ROW = 3.55;

  function buildFloor(ctx, w, h, o) {
    const { warm, desat, pal } = o;
    ctx.save();
    ctx.scale(SS, SS);
    const slab = mix([132, 124, 116], [104, 106, 114], 1 - warm);

    for (let ty = 0; ty < FM; ty++) {
      for (let tx = 0; tx < FN; tx++) {
        const x0 = sx_(tx, ty), y0 = sy_(tx, ty);
        const x1 = sx_(tx + 1, ty), y1 = sy_(tx + 1, ty);
        const x2 = sx_(tx + 1, ty + 1), y2 = sy_(tx + 1, ty + 1);
        const x3 = sx_(tx, ty + 1), y3 = sy_(tx, ty + 1);
        const jit = (hash2(tx, ty, 4242) - 0.5) * 0.09;
        const col = shade(drain(slab, desat * 0.25), 1 + jit);
        ctx.fillStyle = css(col);
        ctx.beginPath();
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = css(shade(col, 0.9), 0.5);
        ctx.lineWidth = 1; ctx.stroke();
        // scuffs
        const rn = mulberry32(tx * 8191 + ty * 131);
        if (rn() > 0.65) {
          ctx.fillStyle = css(shade(col, 0.86), 0.4);
          const a = rn(), b = rn();
          ctx.fillRect(x0 + (x1 - x0) * a + (x3 - x0) * b, y0 + (y1 - y0) * a + (y3 - y0) * b, 7, 3);
        }
      }
    }

    // painted safety lanes flanking the belt
    const laneC = drain(hex2rgb(pal.accent), desat * 0.5);
    ctx.strokeStyle = css(laneC, 0.5);
    ctx.lineWidth = 4;
    for (const row of [BELT_ROW - 1.15, BELT_ROW + 1.15]) {
      ctx.beginPath();
      ctx.moveTo(sx_(0.3, row), sy_(0.3, row));
      ctx.lineTo(sx_(FN - 0.3, row), sy_(FN - 0.3, row));
      ctx.stroke();
    }
    // pipe rack along the north edge
    {
      const pipeCols = [[146, 108, 84], [104, 122, 138], [128, 132, 120]];
      for (let k = 0; k < 3; k++) {
        const row = -0.35 - k * 0.16;
        ctx.strokeStyle = css(drain(pipeCols[k], desat * 0.4));
        ctx.lineWidth = 9 - k * 1.4;
        ctx.beginPath();
        ctx.moveTo(sx_(0.2, row), sy_(0.2, row) - 26 - k * 13);
        ctx.lineTo(sx_(FN - 0.2, row), sy_(FN - 0.2, row) - 26 - k * 13);
        ctx.stroke();
        ctx.strokeStyle = css(shade(drain(pipeCols[k], desat * 0.4), 1.4), 0.5);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx_(0.2, row), sy_(0.2, row) - 29 - k * 13);
        ctx.lineTo(sx_(FN - 0.2, row), sy_(FN - 0.2, row) - 29 - k * 13);
        ctx.stroke();
      }
      // pipe stanchions
      ctx.fillStyle = css(shade(slab, 0.55));
      for (let i = 0; i <= 4; i++) {
        const f = i / 4;
        const px = lerp(sx_(0.4, -0.35), sx_(FN - 0.4, -0.35), f);
        const py = lerp(sy_(0.4, -0.35), sy_(FN - 0.4, -0.35), f);
        ctx.fillRect(px - 4, py - 54, 8, 54);
      }
    }
    // control booth in the east corner
    {
      const bx = sx_(FN - 1.3, 0.7), by = sy_(FN - 1.3, 0.7);
      const wallB = drain([160, 148, 132], desat * 0.35);
      Art.isoPrism(ctx, bx, by, 46, 23, 60,
        shade(wallB, 1.06), shade(wallB, 0.98), shade(wallB, 0.7));
      ctx.fillStyle = css(drain([120, 158, 176], desat * 0.4), 0.85);
      ctx.fillRect(bx - 38, by - 78, 34, 24);
      ctx.strokeStyle = css(shade(wallB, 0.6));
      ctx.lineWidth = 2;
      ctx.strokeRect(bx - 38, by - 78, 34, 24);
    }
    // safety railing along the south edge
    {
      ctx.strokeStyle = css(drain(hex2rgb(pal.accent), desat * 0.5), 0.75);
      ctx.lineWidth = 3;
      const y0 = FM + 0.25;
      for (let i = 0; i <= 10; i++) {
        const f = i / 10;
        const px = lerp(sx_(0.2, y0), sx_(FN - 0.2, y0), f);
        const py = lerp(sy_(0.2, y0), sy_(FN - 0.2, y0), f);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 22); ctx.stroke();
      }
      for (const off of [22, 12]) {
        ctx.beginPath();
        ctx.moveTo(sx_(0.2, y0), sy_(0.2, y0) - off);
        ctx.lineTo(sx_(FN - 0.2, y0), sy_(FN - 0.2, y0) - off);
        ctx.stroke();
      }
    }
    // slab skirt so the platform reads as solid
    const skirt = shade(slab, 0.62);
    const sw = [sx_(0, FM), sy_(0, FM)], se = [sx_(FN, FM), sy_(FN, FM)], ne = [sx_(FN, 0), sy_(FN, 0)];
    ctx.fillStyle = css(skirt);
    ctx.beginPath();
    ctx.moveTo(sw[0], sw[1]); ctx.lineTo(se[0], se[1]);
    ctx.lineTo(se[0], se[1] + 16); ctx.lineTo(sw[0], sw[1] + 16);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = css(shade(skirt, 0.78));
    ctx.beginPath();
    ctx.moveTo(se[0], se[1]); ctx.lineTo(ne[0], ne[1]);
    ctx.lineTo(ne[0], ne[1] + 16); ctx.lineTo(se[0], se[1] + 16);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawPile(ctx, x, y, amount, colour, cap) {
    const n = clamp(Math.round(Math.log10(amount + 1) * 8), 0, cap || 30);
    if (!n) return;
    G.dropShadow(ctx, x, y + 3, 40, 12, 0.32);
    const rn = mulberry32(1337);
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n);
      const px = x + (rn() - 0.5) * 52 * (1 - t * 0.6);
      const py = y - t * 22;
      Art.blob(ctx, px, py, 7.6, 4.6, shade(colour, 0.9 + rn() * 0.3), 0.7);
    }
  }

  function draw(ctx, W, H, state, t, opts) {
    const v = state.visual;
    const product = PD.PRODUCTS[state.product];
    const pal = product.palette;
    const rm = !!opts.reducedMotion;
    const dt = Math.min(0.05, opts.dt || 0.016);
    const day = v.day;
    const warm = v.floorWarmth;
    const nightAmt = clamp01(1 - day.light * 1.5);

    cam.update(dt, rm);

    /* sky backdrop — the same weather as outside, seen over the slab */
    const skyBase = mix(hex2rgb(pal.sky), hex2rgb(pal.skyDecay), v.skyDrift);
    const top = mix([28, 34, 56], skyBase, clamp01(day.light * 1.25));
    const bot = mix([46, 50, 72], mix(skyBase, [240, 230, 206], 0.5), clamp01(day.light * 1.3));
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, css(top)); g.addColorStop(1, css(bot));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const key = [Math.round(warm * 8), Math.round(v.desat * 10), state.product].join('|');
    const fCv = layer.get(key, (WORLD_W * SS) | 0, (WORLD_H * SS) | 0,
      (c, w, h) => buildFloor(c, w, h, { warm, desat: v.desat, pal }));

    const base = Math.min(W / (WORLD_W * 0.80), H / (WORLD_H * 0.80));
    const S = base * cam.zoom;
    const tx = W / 2 + cam.shakeX - (WORLD_W / 2 - cam.x) * S;
    const ty = H / 2 + cam.shakeY - (WORLD_H / 2 - cam.y) * S;

    ctx.save();
    ctx.setTransform(S, 0, 0, S, tx, ty);
    ctx.drawImage(fCv, 0, 0, WORLD_W, WORLD_H);

    const showRef = clamp(v.refLines, 0, 6);
    const showAsm = clamp(v.asmLines, 0, 6);
    // A station is starved when the stage feeding it cannot keep up — that is
    // the real bottleneck, and every number behind it is one the player sees.
    const rr = v.rates;
    const rawFed = state.resources.raw > 0.5 || rr.dig >= rr.refine * 0.98;
    const refFed = state.resources.refined > 0.5 || rr.refine >= rr.assemble * 0.98;
    const furnaceStarved = rr.dig < rr.refine * 0.9 && state.resources.raw < 1;
    const pressStarved = rr.refine < rr.assemble * 0.9 && state.resources.refined < 1;
    const activity = v.activity;
    const lights = [];
    const decay = v.desat;

    /* ---- the belt: material actually travelling the floor ---- */
    const beltX0 = 0.6, beltX1 = FN - 0.6;
    const targetItems = clamp(Math.round(2 + activity * 26), 0, 34);
    if (!rm) {
      while (belt.length < targetItems) belt.push({ p: Math.random(), lane: Math.random() < 0.5 ? -0.16 : 0.16 });
      while (belt.length > targetItems) belt.pop();
      const speed = 0.06 + activity * 0.22;
      for (const it of belt) {
        it.p += speed * dt;
        if (it.p > 1) it.p -= 1;
      }
    } else if (belt.length !== targetItems) {
      belt = Array.from({ length: targetItems }, (_, i) => ({ p: i / Math.max(1, targetItems), lane: i % 2 ? 0.16 : -0.16 }));
    }

    // belt structure: legs, frame rails, then the running surface
    const bx0 = sx_(beltX0, BELT_ROW), by0 = sy_(beltX0, BELT_ROW);
    const bx1 = sx_(beltX1, BELT_ROW), by1 = sy_(beltX1, BELT_ROW);
    const LEGS = 7;
    for (let i = 0; i <= LEGS; i++) {
      const f = i / LEGS;
      const lx = lerp(bx0, bx1, f), ly = lerp(by0, by1, f);
      G.dropShadow(ctx, lx, ly + 6, 12, 5, 0.3);
      ctx.fillStyle = css(mix([70, 66, 68], [86, 88, 98], 1 - warm));
      ctx.fillRect(lx - 3.5, ly - 16, 7, 20);
    }
    ctx.strokeStyle = css(mix([96, 90, 88], [104, 106, 116], 1 - warm));
    ctx.lineWidth = 22;
    ctx.beginPath(); ctx.moveTo(bx0, by0 - 16); ctx.lineTo(bx1, by1 - 16); ctx.stroke();
    ctx.strokeStyle = css([48, 44, 46]);
    ctx.lineWidth = 15;
    ctx.beginPath(); ctx.moveTo(bx0, by0 - 16); ctx.lineTo(bx1, by1 - 16); ctx.stroke();
    ctx.strokeStyle = css(drain(hex2rgb(pal.accent), v.desat * 0.5), 0.75);
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(bx0, by0 - 25); ctx.lineTo(bx1, by1 - 25); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx0, by0 - 7); ctx.lineTo(bx1, by1 - 7); ctx.stroke();
    // rollers scrolling
    ctx.strokeStyle = 'rgba(150,146,150,0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 16]);
    ctx.lineDashOffset = rm ? 0 : -t * (40 + activity * 260);
    ctx.beginPath(); ctx.moveTo(bx0, by0 - 16); ctx.lineTo(bx1, by1 - 16); ctx.stroke();
    ctx.setLineDash([]);

    const prodC = drain(hex2rgb(pal.accent), decay * 0.4);
    for (const it of belt) {
      const x = lerp(beltX0, beltX1, it.p);
      const px = sx_(x, BELT_ROW + it.lane), py = sy_(x, BELT_ROW + it.lane) - 23;
      ctx.fillStyle = css(shade(prodC, 0.55), 0.35);
      ctx.beginPath(); ctx.ellipse(px, py + 5, 6, 2.4, 0, 0, 7); ctx.fill();
      ctx.fillStyle = css(prodC);
      G.roundRect(ctx, px - 6, py - 5, 12, 9, 3); ctx.fill();
      ctx.fillStyle = css(shade(prodC, 1.45), 0.85);
      ctx.fillRect(px - 4.4, py - 3.6, 4.5, 2.4);
    }

    /* ---- stations, workers, robots, piles: depth sorted ---- */
    const draws = [];
    for (let i = 0; i < showRef; i++) {
      draws.push({ d: (0.9 + i * 1.9) + REF_ROW, kind: 'furnace', x: 0.9 + i * 1.9, y: REF_ROW, i });
    }
    for (let i = 0; i < showAsm; i++) {
      draws.push({ d: (1.5 + i * 1.9) + ASM_ROW, kind: 'press', x: 1.5 + i * 1.9, y: ASM_ROW, i });
    }
    // crew: robots take the front posts, humans the rest
    const posts = showRef + showAsm;
    let unit = 0;
    const postPos = [];
    for (let i = 0; i < showRef; i++) postPos.push([0.9 + i * 1.9 + 0.86, REF_ROW + 0.9]);
    for (let i = 0; i < showAsm; i++) postPos.push([1.5 + i * 1.9 + 0.86, ASM_ROW + 0.9]);
    const robots = clamp(v.robots, 0, posts);
    const humans = clamp(v.workers, 0, Math.max(0, posts - robots));
    for (const [px, py] of postPos) {
      if (unit < robots) draws.push({ d: px + py + 0.01, kind: 'robot', x: px, y: py, i: unit });
      else if (unit < robots + humans) draws.push({ d: px + py + 0.01, kind: 'worker', x: px, y: py, i: unit });
      unit++;
    }
    draws.push({ d: 0.6 + 7.2, kind: 'rawPile', x: 0.6, y: 7.2 });
    draws.push({ d: 5.4 + 7.4, kind: 'refPile', x: 5.4, y: 7.4 });
    draws.push({ d: 10.4 + 7.2, kind: 'crates', x: 10.4, y: 7.2 });
    draws.sort((a, b) => a.d - b.d);

    for (const it of draws) {
      const px = sx_(it.x, it.y), py = sy_(it.x, it.y);
      if (it.kind === 'furnace' || it.kind === 'press') {
        const isFur = it.kind === 'furnace';
        const cv = Art.get(isFur ? 'furnace' : 'press', 0, decay, pal, state.product);
        const sc = 0.48;
        const fed = isFur ? rawFed : refFed;
        const running = fed && activity > 0.015;
        G.dropShadow(ctx, px + 3, py + 2, cv.width * sc * 0.36, cv.height * sc * 0.09, 0.32);
        Art.draw(ctx, cv, px, py, sc);
        if (isFur) {
          // mouth glow, brighter with throughput
          const mx = px + (cv.mouthX - cv.ax) * sc, my = py + (cv.mouthY - cv.ay) * sc;
          const flick = rm ? 1 : 0.82 + 0.18 * Math.sin(t * 11 + it.i * 2);
          if (running) {
            ctx.fillStyle = `rgba(248,158,64,${0.9 * flick})`;
            G.roundRect(ctx, mx - 7, my - 5, 14, 10, 3); ctx.fill();
            lights.push({ x: mx, y: my, r: 30, c: [255, 150, 60], on: true });
            if (!rm && Math.random() < 0.28) {
              parts.spawn({
                kind: 'spark', x: mx, y: my, vx: (Math.random() - 0.5) * 50, vy: -30 - Math.random() * 50,
                g: 130, life: 0.5 + Math.random() * 0.4, size: 2.6, add: true,
                c: [255, 196, 108], drag: 0.97,
              });
            }
            if (!rm && Math.random() < 0.12 + activity * 0.2) {
              const stx = px + (cv.stackX - cv.ax) * sc, sty = py + (cv.stackY - cv.ay) * sc;
              parts.spawn({
                kind: 'smoke', x: stx, y: sty, vx: 5, vy: -18, g: -3,
                life: 2.6, size: 2.6, c: mix([180, 174, 168], [104, 98, 96], v.haze), drag: 0.995,
              });
            }
          } else {
            ctx.fillStyle = 'rgba(38,32,32,0.92)';
            G.roundRect(ctx, mx - 7, my - 5, 14, 10, 3); ctx.fill();
          }
        } else {
          const hy = py + (cv.headY - cv.ay) * sc;
          const stroke = (running && !rm) ? Math.abs(Math.sin(t * 6 + it.i)) : 0.5;
          ctx.fillStyle = css(mix([120, 118, 128], [92, 94, 104], 1 - warm));
          ctx.fillRect(px - 7, hy + stroke * 14, 14, 20);
          if (running && !rm && stroke > 0.94 && Math.random() < 0.4) {
            parts.spawn({
              kind: 'spark', x: px, y: hy + 26, vx: (Math.random() - 0.5) * 70, vy: -20 - Math.random() * 30,
              g: 150, life: 0.35, size: 2, add: true, c: [255, 226, 170], drag: 0.96,
            });
          }
        }
        // starved marker: a slow amber pulse under a station the line cannot feed
        if ((isFur ? furnaceStarved : pressStarved) && activity > 0.01) {
          const pulse = rm ? 0.5 : 0.4 + 0.35 * Math.sin(t * 3 + it.i);
          ctx.strokeStyle = `rgba(226,150,64,${pulse})`;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(px, py + 3, 22, 11, 0, 0, 7); ctx.stroke();
        }
      } else if (it.kind === 'worker') {
        const cv = Art.get('worker', it.i % 4, decay, pal, state.product);
        const bob = rm ? 0 : Math.abs(Math.sin(t * 3.4 + it.i * 1.7)) * 2.6;
        G.dropShadow(ctx, px + 1, py + 1, cv.width * 0.44 * 0.34, cv.height * 0.44 * 0.08, 0.3);
        Art.draw(ctx, cv, px, py - bob, 0.44);
      } else if (it.kind === 'robot') {
        const cv = Art.get('robot', 0, decay, pal, state.product);
        G.dropShadow(ctx, px + 1, py + 1, cv.width * 0.44 * 0.32, cv.height * 0.44 * 0.08, 0.3);
        ctx.save();
        ctx.translate(px, py);
        const swing = (rm || activity < 0.02) ? 0 : Math.sin(t * 2.4 + it.i) * 0.09;
        ctx.rotate(swing);
        ctx.translate(-px, -py);
        Art.draw(ctx, cv, px, py, 0.44);
        ctx.restore();
        for (const L of cv.lights) {
          lights.push({ x: px + (L.x - cv.ax) * 0.44, y: py + (L.y - cv.ay) * 0.44, r: 22, c: [120, 220, 150], on: true });
        }
      } else if (it.kind === 'rawPile') {
        drawPile(ctx, px, py, state.resources.raw, drain(hex2rgb(pal.rock), decay * 0.3), 30);
      } else if (it.kind === 'refPile') {
        drawPile(ctx, px, py, state.resources.refined, drain(hex2rgb(pal.accent), decay * 0.3), 30);
      } else if (it.kind === 'crates') {
        const n = clamp(Math.round(Math.log10(state.resources.product + 1) * 2.2), 0, 7);
        const cv = Art.get('crate', 0, decay, pal, state.product);
        for (let i = 0; i < n; i++) {
          const cx = px + (i % 3) * 24 - 24, cy = py - Math.floor(i / 3) * 18;
          Art.draw(ctx, cv, cx, cy, 0.36);
        }
      }
    }

    // overflow note when more lines exist than the floor shows
    if (v.refLines > showRef || v.asmLines > showAsm) {
      ctx.fillStyle = 'rgba(232,222,200,0.6)';
      ctx.font = '15px ui-monospace, monospace';
      ctx.fillText(`+${(v.refLines - showRef) + (v.asmLines - showAsm)} more lines running off-floor`,
        sx_(0.4, FM - 0.4), sy_(0.4, FM - 0.4) + 40);
    }

    if (!rm) parts.update(dt);
    parts.draw(ctx);
    ctx.restore();

    /* lights + atmosphere */
    let anyLight = false;
    if (G.perf.level >= 2 || (G.perf.level >= 1 && nightAmt > 0.25)) {
      for (const L of lights) if (L.on) { anyLight = true; break; }
    }
    if (anyLight) {
      const bctx = bloom.begin(W, H);
      bctx.setTransform(S * 0.5, 0, 0, S * 0.5, tx * 0.5, ty * 0.5);
      for (const L of lights) {
        if (!L.on) continue;
        const gg = bctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
        gg.addColorStop(0, css(L.c, 0.9));
        gg.addColorStop(0.4, css(L.c, 0.3));
        gg.addColorStop(1, css(L.c, 0));
        bctx.fillStyle = gg;
        bctx.beginPath(); bctx.arc(L.x, L.y, L.r, 0, 7); bctx.fill();
      }
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bloom.composite(ctx, W, H, 0.6 + nightAmt * 0.5);
    }

    if (v.haze > 0.02) {
      ctx.fillStyle = `rgba(200,166,126,${Math.min(0.4, v.haze * 0.36)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (nightAmt > 0.02) G.grade(ctx, W, H, [96, 112, 170], nightAmt * 0.4, [40, 60, 120], nightAmt * 0.28);
    // a cold cast once the floor empties of people
    if (warm < 0.6) G.grade(ctx, W, H, [150, 170, 210], (0.6 - warm) * 0.32, [80, 110, 170], (0.6 - warm) * 0.3);
    G.vignette(ctx, W, H, 0.32 + nightAmt * 0.2, [10, 8, 14]);
    if (G.perf.level >= 2) G.grain(ctx, W, H, 0.06, t * 33, t * 21);
  }

  PD.RenderFactory = { draw, cam, parts, resetView() { cam.reset(); } };
})();
