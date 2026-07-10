/* Paperclip Drift — pseudo-first-person walkthrough of the factory floor.
   Not a management view: there is nothing to do here but look.
   Same geometry across the whole game; only occupancy, light and warmth
   change, all driven by state.visual.                                       */
'use strict';
var PD = globalThis.PD || (globalThis.PD = {});

(function () {
  const WORLD_W = 2400;         // scene width in px at scale 1
  const BAYS = 8;
  const BAY_W = 250;
  const BAY0 = 130;

  const lerp = (a, b, t) => a + (b - a) * t;
  const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const rgb = (c, a) => a === undefined ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
    : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const hexRgb = h => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };

  function drawWalkthrough(ctx, W, H, state, t, opts) {
    const v = state.visual;
    const pal = PD.PRODUCTS[state.product].palette;
    const rm = !!opts.reducedMotion;
    const scale = H / 560;
    const maxPan = Math.max(0, WORLD_W * scale - W);
    const pan = Math.min(Math.max(opts.pan || 0, 0), maxPan);
    const bobY = rm ? 0 : Math.sin(t * 1.7) * 2 * (opts.walking ? 1.6 : 0.4);

    const warm = v.floorWarmth;
    const humans = Math.min(BAYS, v.workers);
    const robots = Math.min(BAYS - humans, v.robots);

    ctx.save();
    ctx.translate(-pan, bobY);
    ctx.scale(scale, scale);
    const Wl = WORLD_W;

    // ---- back wall
    const wallHi = mixc([158, 138, 120], [104, 106, 112], 1 - warm);
    const wallLo = mixc([120, 102, 88], [84, 86, 94], 1 - warm);
    let grad = ctx.createLinearGradient(0, 0, 0, 400);
    grad.addColorStop(0, rgb(wallHi));
    grad.addColorStop(1, rgb(wallLo));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, Wl, 400);

    // ---- windows: the land outside shows the drift
    const sky = mixc(hexRgb(pal.sky), hexRgb(pal.skyDecay), v.skyDrift);
    for (let i = 0; i < BAYS + 1; i++) {
      const wx = 60 + i * BAY_W;
      const g2 = ctx.createLinearGradient(0, 60, 0, 170);
      g2.addColorStop(0, rgb(sky));
      g2.addColorStop(1, rgb(mixc(sky, [225, 214, 190], 0.4)));
      ctx.fillStyle = g2;
      ctx.fillRect(wx, 60, 110, 110);
      // distant land: green hill that scars with the home site
      const scar = v.sites[0] ? v.sites[0].scar : 0;
      const hill = mixc(mixc(hexRgb(pal.grass), hexRgb(pal.grassDecay), v.desat), sky, 0.15);
      ctx.fillStyle = rgb(hill);
      ctx.beginPath();
      ctx.moveTo(wx, 170);
      ctx.quadraticCurveTo(wx + 55, 170 - 38 * (1 - scar * 0.8), wx + 110, 170);
      ctx.closePath(); ctx.fill();
      if (v.haze > 0.05) {
        ctx.fillStyle = `rgba(201,166,122,${v.haze * 0.35})`;
        ctx.fillRect(wx, 60, 110, 110);
      }
      if (scar > 0.12) { // the pit, visible from the floor
        ctx.fillStyle = rgb(hexRgb(pal.pit), 0.85);
        ctx.beginPath();
        ctx.ellipse(wx + 55, 168, 34 * scar, 7 + 5 * scar, 0, 0, 7);
        ctx.fill();
      }
      ctx.strokeStyle = rgb(wallLo);
      ctx.lineWidth = 5;
      ctx.strokeRect(wx, 60, 110, 110);
      ctx.beginPath();
      ctx.moveTo(wx + 55, 60); ctx.lineTo(wx + 55, 170);
      ctx.moveTo(wx, 115); ctx.lineTo(wx + 110, 115);
      ctx.stroke();
    }

    // ---- floor
    grad = ctx.createLinearGradient(0, 400, 0, 560);
    grad.addColorStop(0, rgb(mixc([106, 96, 90], [88, 90, 98], 1 - warm)));
    grad.addColorStop(1, rgb(mixc([76, 68, 64], [58, 60, 68], 1 - warm)));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 400, Wl, 160);
    ctx.strokeStyle = 'rgba(40,38,40,0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 30; i++) {
      const fx = i * 90;
      ctx.beginPath(); ctx.moveTo(fx, 400); ctx.lineTo(fx - 60, 560); ctx.stroke();
    }

    // ---- bays
    for (let i = 0; i < BAYS; i++) {
      const bx = BAY0 + i * BAY_W;
      const occupant = i < robots ? 'robot' : (i < robots + humans ? 'human' : 'empty');
      drawBay(ctx, bx, t + i * 1.7, occupant, warm, rm, v);
    }

    // ---- break room / charging bay at the far end
    drawEndRoom(ctx, WORLD_W - 330, t, v, warm, rm);

    // ---- warm/cold light wash + vignette
    ctx.fillStyle = warm > 0.5
      ? `rgba(255,190,110,${0.10 * warm})`
      : `rgba(80,100,140,${0.12 * (1 - warm)})`;
    ctx.fillRect(0, 0, Wl, 560);
    ctx.restore();

    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(10,8,10,0.42)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    return maxPan; // so the UI can clamp panning
  }

  function drawBay(ctx, bx, t, occupant, warm, rm, v) {
    // overhead lamp
    const lampWarm = occupant === 'human';
    const lampOn = occupant !== 'empty' || warm > 0.7;
    ctx.strokeStyle = 'rgb(58,54,56)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(bx + 60, 0); ctx.lineTo(bx + 60, 52); ctx.stroke();
    ctx.fillStyle = 'rgb(70,66,66)';
    ctx.beginPath(); ctx.arc(bx + 60, 60, 16, Math.PI, 0); ctx.fill();
    if (lampOn) {
      const flick = rm ? 1 : (warm < 0.35 ? 0.8 + 0.2 * Math.sin(t * 13) : 1);
      const lc = lampWarm ? `rgba(255,204,130,${0.16 * flick})` : `rgba(150,180,220,${0.10 * flick})`;
      ctx.fillStyle = lc;
      ctx.beginPath();
      ctx.moveTo(bx + 44, 62);
      ctx.lineTo(bx + 76, 62);
      ctx.lineTo(bx + 130, 430);
      ctx.lineTo(bx - 10, 430);
      ctx.closePath(); ctx.fill();
    }

    // workbench
    ctx.fillStyle = 'rgb(96,78,58)';
    ctx.fillRect(bx, 330, 130, 14);
    ctx.fillStyle = 'rgb(72,58,44)';
    ctx.fillRect(bx + 8, 344, 10, 70);
    ctx.fillRect(bx + 112, 344, 10, 70);
    // machine on the bench
    ctx.fillStyle = 'rgb(108,104,112)';
    ctx.fillRect(bx + 84, 296, 42, 34);
    ctx.fillStyle = v.activity > 0.03 ? 'rgba(236,170,80,0.9)' : 'rgba(48,46,50,0.9)';
    ctx.fillRect(bx + 92, 304, 10, 8);

    if (occupant === 'human') {
      const bob = rm ? 0 : Math.sin(t * 2.6) * 2;
      // body
      ctx.fillStyle = 'rgb(86,112,138)';
      ctx.fillRect(bx + 34, 258 + bob, 34, 74);
      // head
      ctx.fillStyle = 'rgb(214,180,150)';
      ctx.beginPath(); ctx.arc(bx + 51, 244 + bob, 15, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgb(94,74,56)';
      ctx.beginPath(); ctx.arc(bx + 51, 238 + bob, 14, Math.PI, 0); ctx.fill();
      // working arm
      const arm = rm ? 0.5 : (0.5 + 0.5 * Math.sin(t * 4));
      ctx.strokeStyle = 'rgb(86,112,138)';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(bx + 64, 272 + bob);
      ctx.lineTo(bx + 82, 300 + arm * 10);
      ctx.stroke();
      // legs
      ctx.fillStyle = 'rgb(60,58,64)';
      ctx.fillRect(bx + 36, 332, 12, 82);
      ctx.fillRect(bx + 54, 332, 12, 82);
      // chatter, sometimes (flavor only)
      if (v.chatter && !rm && Math.sin(t * 0.9) > 0.86) {
        ctx.fillStyle = 'rgba(240,234,220,0.85)';
        ctx.beginPath(); ctx.ellipse(bx + 86, 218, 20, 12, 0, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgb(90,84,78)';
        for (let k = 0; k < 3; k++) ctx.fillRect(bx + 78 + k * 8, 216, 3.4, 3.4);
      }
    } else if (occupant === 'robot') {
      // articulated arm bolted where a chair used to be
      ctx.fillStyle = 'rgb(74,78,88)';
      ctx.fillRect(bx + 28, 390, 48, 24);
      const a = (rm || v.activity < 0.02) ? 0.7 : (0.4 + 0.45 * Math.sin(t * 2.1));
      ctx.strokeStyle = 'rgb(148,152,162)';
      ctx.lineWidth = 13;
      ctx.beginPath();
      ctx.moveTo(bx + 52, 392);
      ctx.lineTo(bx + 52 + Math.cos(-1.2 + a * 0.5) * 62, 392 + Math.sin(-1.2 + a * 0.5) * 62);
      ctx.lineTo(bx + 84, 306 + a * 16);
      ctx.stroke();
      ctx.fillStyle = 'rgba(210,120,60,0.95)';
      ctx.fillRect(bx + 80, 302 + a * 16, 9, 9);
      // small status LED
      ctx.fillStyle = rm ? 'rgb(120,200,140)' : (Math.sin(t * 3.1) > 0 ? 'rgb(120,200,140)' : 'rgb(60,90,70)');
      ctx.fillRect(bx + 34, 396, 5, 5);
    } else {
      // empty: dust sheet over the bench where someone worked
      ctx.fillStyle = 'rgba(196,190,180,0.28)';
      ctx.beginPath();
      ctx.moveTo(bx + 6, 330);
      ctx.quadraticCurveTo(bx + 60, 296, bx + 126, 330);
      ctx.lineTo(bx + 120, 348);
      ctx.lineTo(bx + 10, 348);
      ctx.closePath(); ctx.fill();
    }

    // wall props fade with warmth
    if (warm > 0.55) { // poster
      ctx.fillStyle = 'rgb(206,188,150)';
      ctx.fillRect(bx + 170, 210, 40, 52);
      ctx.fillStyle = 'rgb(160,120,80)';
      ctx.fillRect(bx + 176, 218, 28, 20);
      ctx.fillStyle = 'rgb(120,124,110)';
      ctx.fillRect(bx + 176, 244, 28, 3);
      ctx.fillRect(bx + 176, 250, 20, 3);
    } else if (warm > 0.3) { // poster hanging by a corner
      ctx.save();
      ctx.translate(bx + 190, 214);
      ctx.rotate(0.5);
      ctx.fillStyle = 'rgba(206,188,150,0.8)';
      ctx.fillRect(-20, 0, 40, 52);
      ctx.restore();
    }
    if (warm > 0.5) { // plant
      ctx.fillStyle = 'rgb(146,96,70)';
      ctx.fillRect(bx + 152, 396, 22, 18);
      ctx.fillStyle = 'rgb(96,130,72)';
      ctx.beginPath(); ctx.ellipse(bx + 163, 388, 16, 12, 0, 0, 7); ctx.fill();
    }
  }

  function drawEndRoom(ctx, rx, t, v, warm, rm) {
    // door frame + room beyond
    ctx.fillStyle = 'rgb(52,46,44)';
    ctx.fillRect(rx, 120, 300, 300);
    const charging = v.breakCharging;
    const glow = charging ? [110, 130, 170] : [232, 196, 130];
    ctx.fillStyle = rgb(glow, charging ? 0.22 : 0.3);
    ctx.fillRect(rx + 10, 130, 280, 280);

    if (!charging) {
      // break room: table, chairs, coffee, corkboard
      ctx.fillStyle = 'rgb(110,86,62)';
      ctx.fillRect(rx + 70, 300, 140, 12);
      ctx.fillRect(rx + 84, 312, 10, 60);
      ctx.fillRect(rx + 186, 312, 10, 60);
      ctx.fillStyle = 'rgb(88,70,52)';
      ctx.fillRect(rx + 40, 320, 22, 52);   // chair
      ctx.fillRect(rx + 218, 320, 22, 52);  // chair
      // coffee machine + steam
      ctx.fillStyle = 'rgb(70,66,70)';
      ctx.fillRect(rx + 236, 216, 30, 44);
      if (!rm) {
        ctx.strokeStyle = 'rgba(230,230,230,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const sx = rx + 251, sy = 210;
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(sx + 5, sy - 10 - 3 * Math.sin(t * 2), sx, sy - 20);
        ctx.stroke();
      }
      // corkboard with pinned notes
      ctx.fillStyle = 'rgb(150,112,74)';
      ctx.fillRect(rx + 60, 170, 120, 70);
      for (let k = 0; k < 5; k++) {
        ctx.fillStyle = k % 2 ? 'rgb(226,220,196)' : 'rgb(200,214,186)';
        ctx.fillRect(rx + 70 + (k % 3) * 36, 180 + Math.floor(k / 3) * 30, 24, 22);
      }
      // sign
      ctx.fillStyle = 'rgb(210,196,168)';
      ctx.font = '16px Georgia, serif';
      ctx.fillText('BREAK ROOM', rx + 96, 152);
    } else {
      // charging bay: docks, cables, LEDs — same room
      for (let k = 0; k < 3; k++) {
        const dx = rx + 50 + k * 84;
        ctx.fillStyle = 'rgb(66,70,80)';
        ctx.fillRect(dx, 260, 56, 110);
        ctx.fillStyle = 'rgb(96,100,112)';
        ctx.fillRect(dx + 8, 272, 40, 62); // docked unit
        const on = rm ? k !== 1 : Math.sin(t * 1.3 + k * 2) > -0.3;
        ctx.fillStyle = on ? 'rgb(110,190,130)' : 'rgb(56,64,58)';
        ctx.fillRect(dx + 24, 246, 8, 8);
        ctx.strokeStyle = 'rgb(46,48,54)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(dx + 28, 370);
        ctx.quadraticCurveTo(dx + 40, 396, dx + 70, 400);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgb(168,172,182)';
      ctx.font = '16px Georgia, serif';
      ctx.fillText('CHARGING', rx + 104, 152);
    }
    // door frame
    ctx.strokeStyle = 'rgb(88,74,60)';
    ctx.lineWidth = 10;
    ctx.strokeRect(rx, 120, 300, 300);
  }

  PD.RenderFP = { drawWalkthrough, WORLD_W };
})();
