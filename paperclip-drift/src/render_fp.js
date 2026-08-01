/* Paperclip Drift — the walkthrough.
   Ground level, inside the hall. Nothing to manage here; it exists to be
   looked at. Parallax layers, light shafts from the windows, and an
   occupancy that quietly changes who is standing at the benches.
   Reads state.visual only.                                                  */
'use strict';
var PD = globalThis.PD || (globalThis.PD = {});

(function () {
  const G = PD.Gfx;
  const { css, mix, shade, drain, hex2rgb, hash2, clamp, clamp01, lerp } = G;

  const HALL_W = 3000, HALL_H = 620;
  const BAYS = 9, BAY_W = 290, BAY0 = 150;
  const bloom = new G.Bloom();
  const parts = new G.Particles(320);

  function draw(ctx, W, H, state, t, opts) {
    const v = state.visual;
    const pal = PD.PRODUCTS[state.product].palette;
    const rm = !!opts.reducedMotion;
    const dt = Math.min(0.05, opts.dt || 0.016);
    const scale = H / HALL_H;
    const maxPan = Math.max(0, HALL_W * scale - W);
    const pan = clamp(opts.pan || 0, 0, maxPan);
    const bob = rm ? 0 : Math.sin(t * 1.9) * (opts.walking ? 3.2 : 0.9);

    const day = v.day;
    const warm = v.floorWarmth;
    const nightAmt = clamp01(1 - day.light * 1.5);
    const humans = clamp(v.workers, 0, BAYS);
    const robots = clamp(v.robots, 0, BAYS - humans);
    const lights = [];

    // only the stretch of hall actually on screen is worth drawing
    const viewL = pan / scale - 160, viewR = (pan + W) / scale + 160;
    const visible = (x0, x1) => x1 > viewL && x0 < viewR;

    ctx.save();
    ctx.translate(-pan, bob);
    ctx.scale(scale, scale);

    /* ---- back wall ---- */
    const wallHi = mix([164, 142, 122], [102, 104, 114], 1 - warm);
    const wallLo = mix([118, 100, 86], [78, 80, 90], 1 - warm);
    let g = ctx.createLinearGradient(0, 0, 0, 430);
    g.addColorStop(0, css(shade(wallHi, 0.86)));
    g.addColorStop(0.45, css(wallHi));
    g.addColorStop(1, css(wallLo));
    ctx.fillStyle = g;
    ctx.fillRect(-200, -60, HALL_W + 400, 490);
    // brick courses
    ctx.strokeStyle = css(shade(wallLo, 0.9), 0.25);
    ctx.lineWidth = 1.5;
    for (let y = 20; y < 430; y += 26) {
      ctx.beginPath(); ctx.moveTo(-200, y); ctx.lineTo(HALL_W + 200, y); ctx.stroke();
    }

    /* ---- windows: the outside world, drifting ---- */
    const skyBase = mix(hex2rgb(pal.sky), hex2rgb(pal.skyDecay), v.skyDrift);
    const sky = mix(mix([30, 36, 60], skyBase, clamp01(day.light * 1.3)),
      [232, 168, 118], clamp01(1 - Math.abs(day.elev + 0.02) * 3.2) * 0.5);
    const scar = v.sites[0] ? v.sites[0].scar : 0;
    for (let i = 0; i < BAYS + 1; i++) {
      const wx = 70 + i * BAY_W;
      if (!visible(wx, wx + 128)) continue;
      const wg = ctx.createLinearGradient(0, 55, 0, 190);
      wg.addColorStop(0, css(sky));
      wg.addColorStop(1, css(mix(sky, [228, 216, 194], 0.45 * day.light)));
      ctx.fillStyle = wg;
      ctx.fillRect(wx, 55, 128, 135);
      // hills and the working face beyond
      const hill = mix(mix(hex2rgb(pal.grass), hex2rgb(pal.grassDecay), v.desat), sky, 0.2);
      ctx.fillStyle = css(hill);
      ctx.beginPath();
      ctx.moveTo(wx, 190);
      ctx.quadraticCurveTo(wx + 64, 190 - 46 * (1 - scar * 0.75), wx + 128, 190);
      ctx.closePath(); ctx.fill();
      if (scar > 0.1) {
        ctx.fillStyle = css(shade(hex2rgb(pal.pit), 0.92), 0.9);
        ctx.beginPath();
        ctx.ellipse(wx + 64, 188, 42 * scar, 8 + 6 * scar, 0, 0, 7);
        ctx.fill();
      }
      if (v.haze > 0.05) {
        ctx.fillStyle = `rgba(202,168,124,${v.haze * 0.45})`;
        ctx.fillRect(wx, 55, 128, 135);
      }
      if (nightAmt > 0.3) {
        ctx.fillStyle = `rgba(20,26,48,${nightAmt * 0.45})`;
        ctx.fillRect(wx, 55, 128, 135);
      }
      // frame
      ctx.strokeStyle = css(shade(wallLo, 0.75));
      ctx.lineWidth = 7;
      ctx.strokeRect(wx, 55, 128, 135);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(wx + 64, 55); ctx.lineTo(wx + 64, 190);
      ctx.moveTo(wx, 122); ctx.lineTo(wx + 128, 122);
      ctx.stroke();
      // daylight shaft on the floor
      if (day.light > 0.35) {
        const sg = ctx.createLinearGradient(wx + 64, 190, wx + 130, 470);
        sg.addColorStop(0, `rgba(255,240,206,${0.16 * day.light})`);
        sg.addColorStop(1, 'rgba(255,240,206,0)');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.moveTo(wx + 6, 190); ctx.lineTo(wx + 122, 190);
        ctx.lineTo(wx + 190, 470); ctx.lineTo(wx + 40, 470);
        ctx.closePath(); ctx.fill();
      }
    }

    /* ---- floor ---- */
    g = ctx.createLinearGradient(0, 430, 0, HALL_H);
    g.addColorStop(0, css(mix([112, 100, 92], [88, 90, 100], 1 - warm)));
    g.addColorStop(1, css(mix([70, 62, 58], [54, 56, 66], 1 - warm)));
    ctx.fillStyle = g;
    ctx.fillRect(-200, 430, HALL_W + 400, HALL_H - 430 + 40);
    ctx.strokeStyle = 'rgba(38,34,36,0.45)';
    ctx.lineWidth = 2.5;
    for (let i = -2; i < 34; i++) {
      const fx = i * 105;
      ctx.beginPath(); ctx.moveTo(fx, 430); ctx.lineTo(fx - 90, HALL_H + 40); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(38,34,36,0.28)';
    ctx.lineWidth = 2;
    for (const yy of [470, 520, 580]) {
      ctx.beginPath(); ctx.moveTo(-200, yy); ctx.lineTo(HALL_W + 200, yy); ctx.stroke();
    }

    /* ---- bays ---- */
    for (let i = 0; i < BAYS; i++) {
      const bx = BAY0 + i * BAY_W;
      if (!visible(bx - 30, bx + 250)) continue;
      const occ = i < robots ? 'robot' : (i < robots + humans ? 'human' : 'empty');
      drawBay(ctx, bx, t + i * 1.7, occ, warm, rm, v, lights, nightAmt);
    }

    /* ---- the end room ---- */
    if (visible(HALL_W - 380, HALL_W - 50)) drawEndRoom(ctx, HALL_W - 380, t, v, warm, rm, lights);

    /* ---- ceiling trusses + hanging lamps (parallax above) ---- */
    ctx.save();
    ctx.translate(pan * 0.10, 0);
    ctx.strokeStyle = css(shade(wallLo, 0.6), 0.9);
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(-200, -6); ctx.lineTo(HALL_W + 200, -6);
    ctx.stroke();
    for (let i = 0; i < BAYS + 2; i++) {
      const bx = 60 + i * BAY_W;
      if (!visible(bx - pan * 0.10 - 20, bx - pan * 0.10 + 140)) continue;
      ctx.strokeStyle = css(shade(wallLo, 0.55), 0.85);
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(bx, -6); ctx.lineTo(bx + 60, 44); ctx.lineTo(bx + 120, -6);
      ctx.moveTo(bx + 60, 44); ctx.lineTo(bx + 60, -6);
      ctx.stroke();
    }
    ctx.restore();

    /* ---- foreground pillars, closest layer ---- */
    ctx.save();
    ctx.translate(-pan * 0.34, 0);
    for (let i = 0; i < 7; i++) {
      const px = 240 + i * 520;
      if (!visible(px + pan * 0.34 - 30, px + pan * 0.34 + 74)) continue;
      const pg = ctx.createLinearGradient(px, 0, px + 44, 0);
      pg.addColorStop(0, css(shade(wallLo, 0.5)));
      pg.addColorStop(0.4, css(shade(wallLo, 0.78)));
      pg.addColorStop(1, css(shade(wallLo, 0.42)));
      ctx.fillStyle = pg;
      ctx.fillRect(px, -70, 44, HALL_H + 120);
      ctx.fillStyle = css(shade(wallLo, 0.4), 0.5);
      ctx.fillRect(px - 10, -70, 64, 22);
    }
    ctx.restore();

    /* ---- airborne dust in the light ---- */
    if (!rm) {
      if (Math.random() < 0.5) {
        parts.spawn({
          kind: 'dot', x: pan / scale + Math.random() * (W / scale), y: 180 + Math.random() * 300,
          vx: (Math.random() - 0.5) * 8, vy: -2 - Math.random() * 5, g: 1.5,
          life: 4 + Math.random() * 3, size: 1.5, add: true,
          c: mix([255, 238, 200], [150, 170, 220], nightAmt), drag: 0.999,
        });
      }
      parts.update(dt);
    }
    parts.draw(ctx);

    ctx.restore();

    /* ---- lights ---- */
    if (lights.length && (G.perf.level >= 2 || nightAmt > 0.25)) {
      const bctx = bloom.begin(W, H);
      bctx.setTransform(scale * 0.5, 0, 0, scale * 0.5, -pan * 0.5, bob * 0.5);
      for (const L of lights) {
        if (!L.on) continue;
        const gg = bctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
        gg.addColorStop(0, css(L.c, 0.85));
        gg.addColorStop(0.4, css(L.c, 0.28));
        gg.addColorStop(1, css(L.c, 0));
        bctx.fillStyle = gg;
        bctx.beginPath(); bctx.arc(L.x, L.y, L.r, 0, 7); bctx.fill();
      }
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bloom.composite(ctx, W, H, 0.55 + nightAmt * 0.55);
    }

    /* ---- atmosphere ---- */
    if (v.haze > 0.03) {
      ctx.fillStyle = `rgba(198,168,130,${Math.min(0.34, v.haze * 0.3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (warm < 0.62) G.grade(ctx, W, H, [140, 164, 210], (0.62 - warm) * 0.42, [70, 100, 165], (0.62 - warm) * 0.34);
    else G.grade(ctx, W, H, [255, 226, 186], 0.12, [255, 196, 130], 0.14);
    if (nightAmt > 0.02) G.grade(ctx, W, H, [96, 112, 170], nightAmt * 0.3, [40, 60, 120], nightAmt * 0.2);
    G.vignette(ctx, W, H, 0.42, [8, 6, 10]);
    if (G.perf.level >= 2) G.grain(ctx, W, H, 0.07, t * 51, t * 37);

    return maxPan;
  }

  function drawBay(ctx, bx, t, occ, warm, rm, v, lights, nightAmt) {
    const lampWarm = occ === 'human';
    const lampOn = occ !== 'empty' || warm > 0.7 || nightAmt > 0.3;
    // pendant lamp
    ctx.strokeStyle = 'rgb(52,48,50)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(bx + 70, 40); ctx.lineTo(bx + 70, 96); ctx.stroke();
    ctx.fillStyle = 'rgb(64,60,60)';
    ctx.beginPath(); ctx.arc(bx + 70, 104, 19, Math.PI, 0); ctx.fill();
    if (lampOn) {
      const flick = rm ? 1 : (warm < 0.35 ? 0.78 + 0.22 * Math.sin(t * 14 + bx) : 1);
      const c = lampWarm ? [255, 206, 132] : [168, 194, 232];
      ctx.fillStyle = css(c, 0.14 * flick);
      ctx.beginPath();
      ctx.moveTo(bx + 52, 106); ctx.lineTo(bx + 88, 106);
      ctx.lineTo(bx + 156, 470); ctx.lineTo(bx - 16, 470);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = css(mix(c, [255, 255, 255], 0.4), 0.95 * flick);
      ctx.beginPath(); ctx.ellipse(bx + 70, 106, 15, 6, 0, 0, 7); ctx.fill();
      lights.push({ x: bx + 70, y: 106, r: 78, c, on: true });
    }

    // bench
    G.dropShadow(ctx, bx + 72, 452, 96, 16, 0.34);
    ctx.fillStyle = 'rgb(104,84,62)';
    G.roundRect(ctx, bx, 356, 148, 16, 3); ctx.fill();
    ctx.fillStyle = 'rgba(255,238,200,0.18)';
    ctx.fillRect(bx, 356, 148, 4);
    ctx.fillStyle = 'rgb(74,60,46)';
    ctx.fillRect(bx + 10, 372, 12, 78);
    ctx.fillRect(bx + 126, 372, 12, 78);
    // machine on the bench
    ctx.fillStyle = 'rgb(112,108,116)';
    G.roundRect(ctx, bx + 92, 314, 48, 42, 4); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(bx + 95, 317, 16, 36);
    const running = v.activity > 0.03;
    ctx.fillStyle = running ? 'rgba(240,172,80,0.95)' : 'rgba(46,44,48,0.95)';
    G.roundRect(ctx, bx + 100, 324, 12, 9, 2); ctx.fill();
    if (running) lights.push({ x: bx + 106, y: 328, r: 26, c: [255, 176, 84], on: true });

    if (occ === 'human') {
      const bobY = rm ? 0 : Math.sin(t * 2.6) * 2.4;
      ctx.fillStyle = 'rgb(58,56,64)';
      ctx.fillRect(bx + 38, 356, 14, 92);
      ctx.fillRect(bx + 58, 356, 14, 92);
      const shirt = warm > 0.4 ? [88, 116, 144] : [92, 98, 110];
      ctx.fillStyle = css(shirt);
      G.roundRect(ctx, bx + 32, 272, 46, 88, 12); ctx.fill();
      ctx.fillStyle = css(shade(shirt, 1.3), 0.5);
      G.roundRect(ctx, bx + 34, 274, 16, 84, 8); ctx.fill();
      ctx.fillStyle = 'rgb(216,182,152)';
      ctx.beginPath(); ctx.arc(bx + 55, 254, 17, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgb(92,72,54)';
      ctx.beginPath(); ctx.arc(bx + 55, 247, 16, Math.PI, 0); ctx.fill();
      // working arm
      const arm = rm ? 0.5 : 0.5 + 0.5 * Math.sin(t * 4);
      ctx.strokeStyle = css(shirt);
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(bx + 72, 292 + bobY);
      ctx.lineTo(bx + 96, 322 + arm * 10);
      ctx.stroke();
      if (v.chatter && !rm && Math.sin(t * 0.8) > 0.9) {
        ctx.fillStyle = 'rgba(244,238,224,0.9)';
        G.roundRect(ctx, bx + 78, 206, 62, 32, 10); ctx.fill();
        ctx.fillStyle = 'rgb(96,90,84)';
        for (let k = 0; k < 3; k++) ctx.fillRect(bx + 88 + k * 13, 220, 8, 4);
      }
    } else if (occ === 'robot') {
      G.dropShadow(ctx, bx + 56, 452, 46, 12, 0.34);
      ctx.fillStyle = 'rgb(72,76,86)';
      G.roundRect(ctx, bx + 28, 412, 58, 30, 5); ctx.fill();
      const a = (rm || v.activity < 0.02) ? 0.7 : 0.42 + 0.42 * Math.sin(t * 2.1);
      const gg = ctx.createLinearGradient(bx + 40, 300, bx + 110, 420);
      gg.addColorStop(0, 'rgb(182,186,196)');
      gg.addColorStop(1, 'rgb(96,100,110)');
      ctx.strokeStyle = gg;
      ctx.lineWidth = 15;
      ctx.beginPath();
      ctx.moveTo(bx + 56, 414);
      ctx.lineTo(bx + 56 + Math.cos(-1.15 + a * 0.5) * 74, 414 + Math.sin(-1.15 + a * 0.5) * 74);
      ctx.lineTo(bx + 96, 318 + a * 16);
      ctx.stroke();
      ctx.fillStyle = 'rgb(74,78,88)';
      ctx.beginPath(); ctx.arc(bx + 56, 414, 11, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgb(212,120,60)';
      G.roundRect(ctx, bx + 90, 314 + a * 16, 14, 12, 3); ctx.fill();
      const led = rm ? true : Math.sin(t * 3.1) > 0;
      ctx.fillStyle = led ? 'rgb(122,206,138)' : 'rgb(58,90,68)';
      ctx.fillRect(bx + 34, 418, 6, 6);
      if (led) lights.push({ x: bx + 37, y: 421, r: 14, c: [122, 206, 138], on: true });
    } else {
      // dust sheet over a bench nobody works
      ctx.fillStyle = 'rgba(202,196,186,0.30)';
      ctx.beginPath();
      ctx.moveTo(bx + 4, 356);
      ctx.quadraticCurveTo(bx + 70, 318, bx + 144, 356);
      ctx.lineTo(bx + 138, 382);
      ctx.quadraticCurveTo(bx + 70, 366, bx + 10, 382);
      ctx.closePath(); ctx.fill();
    }

    // wall props thin out with the floor's warmth
    if (warm > 0.55) {
      ctx.fillStyle = 'rgb(208,190,152)';
      ctx.fillRect(bx + 196, 232, 46, 60);
      ctx.fillStyle = 'rgb(162,122,82)';
      ctx.fillRect(bx + 203, 240, 32, 24);
      ctx.fillStyle = 'rgb(122,126,112)';
      ctx.fillRect(bx + 203, 270, 32, 3);
      ctx.fillRect(bx + 203, 277, 22, 3);
    } else if (warm > 0.28) {
      ctx.save();
      ctx.translate(bx + 218, 236);
      ctx.rotate(0.48);
      ctx.fillStyle = 'rgba(206,188,150,0.75)';
      ctx.fillRect(-23, 0, 46, 60);
      ctx.restore();
    }
    if (warm > 0.5) {
      G.dropShadow(ctx, bx + 186, 452, 26, 8, 0.3);
      ctx.fillStyle = 'rgb(150,98,72)';
      G.roundRect(ctx, bx + 172, 424, 28, 24, 3); ctx.fill();
      ctx.fillStyle = 'rgb(98,132,74)';
      ctx.beginPath(); ctx.ellipse(bx + 186, 416, 19, 14, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgb(118,152,88)';
      ctx.beginPath(); ctx.ellipse(bx + 180, 410, 11, 8, 0, 0, 7); ctx.fill();
    }
  }

  function drawEndRoom(ctx, rx, t, v, warm, rm, lights) {
    const charging = v.breakCharging;
    ctx.fillStyle = 'rgb(44,40,40)';
    ctx.fillRect(rx, 120, 330, 330);
    const glow = charging ? [104, 128, 176] : [238, 198, 132];
    const gg = ctx.createLinearGradient(rx, 130, rx, 440);
    gg.addColorStop(0, css(glow, charging ? 0.20 : 0.30));
    gg.addColorStop(1, css(glow, charging ? 0.10 : 0.16));
    ctx.fillStyle = gg;
    ctx.fillRect(rx + 12, 132, 306, 306);
    lights.push({ x: rx + 165, y: 250, r: 190, c: glow, on: true });

    if (!charging) {
      ctx.fillStyle = 'rgb(112,88,64)';
      G.roundRect(ctx, rx + 74, 318, 156, 14, 3); ctx.fill();
      ctx.fillStyle = 'rgb(88,70,52)';
      ctx.fillRect(rx + 90, 332, 12, 66);
      ctx.fillRect(rx + 204, 332, 12, 66);
      ctx.fillStyle = 'rgb(96,76,56)';
      G.roundRect(ctx, rx + 40, 330, 26, 60, 4); ctx.fill();
      G.roundRect(ctx, rx + 240, 330, 26, 60, 4); ctx.fill();
      // coffee machine + steam
      ctx.fillStyle = 'rgb(72,68,72)';
      G.roundRect(ctx, rx + 258, 228, 34, 50, 4); ctx.fill();
      ctx.fillStyle = 'rgb(196,150,96)';
      ctx.fillRect(rx + 266, 258, 18, 12);
      if (!rm) {
        ctx.strokeStyle = 'rgba(236,232,226,0.5)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        const sxp = rx + 275, syp = 222;
        ctx.moveTo(sxp, syp);
        ctx.quadraticCurveTo(sxp + 7, syp - 12 - 4 * Math.sin(t * 2), sxp, syp - 26);
        ctx.quadraticCurveTo(sxp - 7, syp - 38, sxp + 3, syp - 50);
        ctx.stroke();
      }
      // corkboard
      ctx.fillStyle = 'rgb(154,116,76)';
      ctx.fillRect(rx + 62, 176, 132, 78);
      for (let k = 0; k < 6; k++) {
        ctx.fillStyle = k % 2 ? 'rgb(230,224,200)' : 'rgb(204,218,190)';
        ctx.save();
        ctx.translate(rx + 76 + (k % 3) * 40, 188 + Math.floor(k / 3) * 34);
        ctx.rotate((hash2(k, 1, 9) - 0.5) * 0.2);
        ctx.fillRect(0, 0, 26, 24);
        ctx.restore();
      }
      ctx.fillStyle = 'rgb(214,200,172)';
      ctx.font = '18px Georgia, serif';
      ctx.fillText('BREAK ROOM', rx + 98, 158);
    } else {
      for (let k = 0; k < 3; k++) {
        const dx = rx + 54 + k * 92;
        G.dropShadow(ctx, dx + 30, 392, 34, 10, 0.4);
        ctx.fillStyle = 'rgb(64,68,78)';
        G.roundRect(ctx, dx, 262, 60, 122, 5); ctx.fill();
        ctx.fillStyle = 'rgb(96,100,112)';
        G.roundRect(ctx, dx + 9, 276, 42, 66, 4); ctx.fill();
        const on = rm ? k !== 1 : Math.sin(t * 1.3 + k * 2) > -0.3;
        ctx.fillStyle = on ? 'rgb(112,196,132)' : 'rgb(54,64,58)';
        ctx.fillRect(dx + 26, 248, 9, 9);
        if (on) lights.push({ x: dx + 30, y: 252, r: 30, c: [112, 196, 132], on: true });
        ctx.strokeStyle = 'rgb(42,44,50)';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(dx + 30, 384);
        ctx.quadraticCurveTo(dx + 44, 412, dx + 76, 416);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgb(170,176,188)';
      ctx.font = '18px Georgia, serif';
      ctx.fillText('CHARGING', rx + 112, 158);
    }
    ctx.strokeStyle = 'rgb(84,70,58)';
    ctx.lineWidth = 12;
    ctx.strokeRect(rx, 120, 330, 330);
  }

  PD.RenderFP = { draw, HALL_W, parts };
})();
