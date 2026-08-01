/* Paperclip Drift — procedural sprite factory.
   Every prop is painted once into an offscreen canvas (layered gradients,
   rim light from the upper-left sun, soft outline) and cached by
   kind/variant/decay-bucket/palette. Per-frame cost is a drawImage.
   Sprites carry an anchor at bottom-centre plus optional `lights`, which the
   renderer glows at night.                                                  */
'use strict';
var PD = globalThis.PD || (globalThis.PD = {});

(function () {
  const G = PD.Gfx;
  const { css, mix, shade, drain, makeCanvas, roundRect, mulberry32 } = G;

  const cache = new Map();
  const DECAY_STEPS = 7;               // decay buckets per sprite

  function sprite(w, h, ax, ay, draw) {
    const cv = makeCanvas(w, h);
    const ctx = cv.getContext('2d');
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const lights = [];
    draw(ctx, w, h, lights);
    cv.ax = ax; cv.ay = ay; cv.lights = lights;
    return cv;
  }

  /* Painterly blob: a radial gradient lit from the upper-left with a cool
     under-shadow. The workhorse for foliage and rounded forms. */
  function blob(ctx, x, y, rx, ry, base, litAmt, rot) {
    const hi = shade(mix(base, [255, 244, 208], 0.42), 1.0);
    const lo = shade(base, 0.56);
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(-rx * 0.34, -rx * 0.36, rx * 0.05, 0, 0, rx);
    g.addColorStop(0, css(mix(base, hi, litAmt === undefined ? 0.8 : litAmt)));
    g.addColorStop(0.52, css(base));
    g.addColorStop(1, css(lo));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, 7); ctx.fill();
    ctx.restore();
  }

  function outline(ctx, w, h, alpha) {
    // cheap dark contour: redraw existing alpha slightly offset, behind
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.globalAlpha = alpha === undefined ? 0.3 : alpha;
    ctx.filter = 'blur(1.6px)';
    ctx.drawImage(ctx.canvas, 0, 1.5);
    ctx.filter = 'none';
    ctx.restore();
  }

  /* ---------------- flora ---------------- */
  function drawBroadleaf(ctx, w, h, lights, base, d, variant, rnd) {
    const trunkC = drain([104, 74, 46], d * 0.55);
    const bx = w / 2, by = h;
    const th = h * (0.30 + variant * 0.03);
    // trunk, tapered, with a fork
    ctx.fillStyle = css(trunkC);
    ctx.beginPath();
    ctx.moveTo(bx - w * 0.055, by);
    ctx.quadraticCurveTo(bx - w * 0.03, by - th * 0.6, bx - w * 0.022, by - th);
    ctx.lineTo(bx + w * 0.022, by - th);
    ctx.quadraticCurveTo(bx + w * 0.03, by - th * 0.6, bx + w * 0.055, by);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = css(trunkC); ctx.lineWidth = w * 0.032;
    ctx.beginPath();
    ctx.moveTo(bx, by - th * 0.75);
    ctx.lineTo(bx - w * 0.16, by - th * 1.15);
    ctx.moveTo(bx, by - th * 0.86);
    ctx.lineTo(bx + w * 0.15, by - th * 1.2);
    ctx.stroke();
    // trunk light side
    ctx.fillStyle = css(shade(trunkC, 1.3), 0.5);
    ctx.fillRect(bx - w * 0.05, by - th, w * 0.028, th);

    // canopy clumps
    const cy = h * (0.30 - variant * 0.02);
    const clumps = 5 + (variant % 2);
    const spread = w * 0.30;
    for (let i = 0; i < clumps; i++) {
      const a = (i / clumps) * Math.PI * 2 + variant;
      const r = w * (0.17 + rnd() * 0.07);
      const cx = bx + Math.cos(a) * spread * (0.45 + rnd() * 0.55);
      const yy = cy + Math.sin(a) * spread * 0.42 + (rnd() - 0.5) * h * 0.05;
      const tone = mix(base, i % 2 ? shade(base, 1.22) : shade(base, 0.82), 0.6);
      blob(ctx, cx, yy, r, r * 0.88, drain(tone, d), 0.55);
    }
    blob(ctx, bx - w * 0.06, cy - h * 0.06, w * 0.22, w * 0.19,
      drain(shade(base, 1.28), d), 0.95);
    // leaf specks catching sun
    ctx.fillStyle = css(drain(mix(base, [255, 246, 200], 0.6), d), 0.55);
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2, rr = rnd() * spread;
      ctx.fillRect(bx + Math.cos(a) * rr - w * 0.02, cy + Math.sin(a) * rr * 0.55, w * 0.028, w * 0.02);
    }
    outline(ctx, w, h, 0.26);
  }

  function drawPine(ctx, w, h, lights, base, d, variant, rnd) {
    const trunkC = drain([92, 66, 42], d * 0.55);
    const bx = w / 2, by = h;
    ctx.fillStyle = css(trunkC);
    ctx.fillRect(bx - w * 0.04, by - h * 0.24, w * 0.08, h * 0.24);
    const tiers = 4 + (variant % 2);
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers;
      const yTop = h * (0.06 + t * 0.56);
      const yBot = yTop + h * 0.26;
      const half = w * (0.10 + t * 0.30);
      const tone = drain(shade(base, 1.14 - t * 0.22), d);
      ctx.fillStyle = css(tone);
      ctx.beginPath();
      ctx.moveTo(bx, yTop);
      ctx.quadraticCurveTo(bx - half * 0.7, yBot - h * 0.06, bx - half, yBot);
      ctx.quadraticCurveTo(bx, yBot - h * 0.05, bx + half, yBot);
      ctx.quadraticCurveTo(bx + half * 0.7, yBot - h * 0.06, bx, yTop);
      ctx.closePath(); ctx.fill();
      // sunlit left edge
      ctx.fillStyle = css(drain(mix(base, [246, 240, 200], 0.5), d), 0.4);
      ctx.beginPath();
      ctx.moveTo(bx, yTop);
      ctx.quadraticCurveTo(bx - half * 0.7, yBot - h * 0.06, bx - half, yBot);
      ctx.lineTo(bx - half * 0.72, yBot);
      ctx.quadraticCurveTo(bx - half * 0.45, yBot - h * 0.07, bx, yTop + h * 0.02);
      ctx.closePath(); ctx.fill();
    }
    outline(ctx, w, h, 0.24);
  }

  function drawShrub(ctx, w, h, lights, base, d, variant, rnd) {
    const bx = w / 2, by = h * 0.96;
    for (let i = 0; i < 4; i++) {
      const cx = bx + (rnd() - 0.5) * w * 0.6;
      const cy = by - h * (0.16 + rnd() * 0.34);
      const r = w * (0.15 + rnd() * 0.10);
      blob(ctx, cx, cy, r, r * 0.8, drain(shade(base, 0.9 + rnd() * 0.4), d), 0.6);
    }
    ctx.fillStyle = css(drain(shade(base, 1.35), d), 0.5);
    for (let i = 0; i < 8; i++) {
      ctx.fillRect(bx + (rnd() - 0.5) * w * 0.5, by - h * (0.2 + rnd() * 0.3), w * 0.04, w * 0.03);
    }
    outline(ctx, w, h, 0.22);
  }

  function drawGrassTuft(ctx, w, h, lights, base, d, variant, rnd) {
    const bx = w / 2, by = h;
    ctx.lineWidth = Math.max(1, w * 0.05);
    for (let i = 0; i < 7; i++) {
      const lean = (rnd() - 0.5) * w * 0.5;
      const tall = h * (0.5 + rnd() * 0.5);
      ctx.strokeStyle = css(drain(shade(base, 0.8 + rnd() * 0.6), d), 0.9);
      ctx.beginPath();
      ctx.moveTo(bx + (rnd() - 0.5) * w * 0.4, by);
      ctx.quadraticCurveTo(bx + lean * 0.5, by - tall * 0.6, bx + lean, by - tall);
      ctx.stroke();
    }
  }

  function drawFlowers(ctx, w, h, lights, base, d, variant, rnd) {
    const petals = [[214, 196, 118], [206, 146, 138], [196, 178, 210], [232, 216, 190]];
    const by = h;
    for (let i = 0; i < 7; i++) {
      const x = w * (0.15 + rnd() * 0.7), y = by - h * (0.1 + rnd() * 0.55);
      ctx.strokeStyle = css(drain([104, 132, 74], d), 0.8);
      ctx.lineWidth = Math.max(1, w * 0.035);
      ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x, y); ctx.stroke();
      const c = drain(petals[(variant + i) % petals.length], d * 0.9);
      ctx.fillStyle = css(c);
      ctx.beginPath(); ctx.arc(x, y, w * 0.06, 0, 7); ctx.fill();
      ctx.fillStyle = css(shade(c, 1.35), 0.85);
      ctx.beginPath(); ctx.arc(x - w * 0.015, y - w * 0.015, w * 0.028, 0, 7); ctx.fill();
    }
  }

  function drawRock(ctx, w, h, lights, base, d, variant, rnd) {
    const by = h, bx = w / 2;
    const facets = 5 + (variant % 3);
    const pts = [];
    for (let i = 0; i < facets; i++) {
      const a = Math.PI + (i / (facets - 1)) * Math.PI;
      pts.push([bx + Math.cos(a) * w * (0.32 + rnd() * 0.14),
      by - h * (0.05 + Math.abs(Math.sin(a)) * (0.55 + rnd() * 0.3))]);
    }
    const stone = drain(base, d * 0.35);
    ctx.fillStyle = css(stone);
    ctx.beginPath();
    ctx.moveTo(bx - w * 0.38, by);
    for (const p of pts) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(bx + w * 0.38, by);
    ctx.closePath(); ctx.fill();
    // lit facet
    ctx.fillStyle = css(shade(stone, 1.3), 0.85);
    ctx.beginPath();
    ctx.moveTo(bx - w * 0.38, by);
    for (const p of pts.slice(0, Math.ceil(facets / 2))) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(bx - w * 0.05, by);
    ctx.closePath(); ctx.fill();
    // shadow facet
    ctx.fillStyle = css(shade(stone, 0.62), 0.7);
    ctx.beginPath();
    ctx.moveTo(bx + w * 0.38, by);
    for (const p of pts.slice(Math.ceil(facets / 2)).reverse()) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(bx + w * 0.08, by);
    ctx.closePath(); ctx.fill();
    outline(ctx, w, h, 0.3);
  }

  function drawStump(ctx, w, h, lights, base, d, variant, rnd) {
    const bx = w / 2, by = h;
    const bark = drain([96, 68, 44], d * 0.5);
    ctx.fillStyle = css(bark);
    ctx.beginPath();
    ctx.ellipse(bx, by - h * 0.28, w * 0.3, h * 0.16, 0, 0, 7); ctx.fill();
    ctx.fillRect(bx - w * 0.3, by - h * 0.3, w * 0.6, h * 0.3);
    ctx.fillStyle = css(shade(bark, 0.7));
    ctx.beginPath(); ctx.ellipse(bx, by, w * 0.3, h * 0.15, 0, 0, 7); ctx.fill();
    const ring = drain([166, 136, 96], d * 0.5);
    ctx.fillStyle = css(ring);
    ctx.beginPath(); ctx.ellipse(bx, by - h * 0.3, w * 0.29, h * 0.15, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = css(shade(ring, 0.78), 0.8);
    ctx.lineWidth = Math.max(1, w * 0.02);
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.ellipse(bx, by - h * 0.3, w * 0.29 * (i / 4), h * 0.15 * (i / 4), 0, 0, 7);
      ctx.stroke();
    }
    outline(ctx, w, h, 0.25);
  }

  function drawDeer(ctx, w, h, lights, base, d, variant, rnd) {
    const c = drain([150, 112, 76], d * 0.5);
    const bx = w / 2, by = h;
    ctx.strokeStyle = css(shade(c, 0.7)); ctx.lineWidth = w * 0.055;
    for (const lx of [-0.22, -0.08, 0.12, 0.26]) {
      ctx.beginPath();
      ctx.moveTo(bx + lx * w, by - h * 0.34);
      ctx.lineTo(bx + lx * w + (rnd() - 0.5) * w * 0.04, by);
      ctx.stroke();
    }
    blob(ctx, bx, by - h * 0.46, w * 0.28, w * 0.17, c, 0.55);
    ctx.strokeStyle = css(c); ctx.lineWidth = w * 0.11;
    ctx.beginPath();
    ctx.moveTo(bx + w * 0.16, by - h * 0.5);
    ctx.lineTo(bx + w * 0.3, by - h * 0.74);
    ctx.stroke();
    blob(ctx, bx + w * 0.33, by - h * 0.78, w * 0.10, w * 0.07, c, 0.7);
    if (variant % 2) { // antlers
      ctx.strokeStyle = css(drain([206, 190, 160], d * 0.4));
      ctx.lineWidth = w * 0.035;
      ctx.beginPath();
      ctx.moveTo(bx + w * 0.3, by - h * 0.84);
      ctx.lineTo(bx + w * 0.24, by - h * 0.98);
      ctx.moveTo(bx + w * 0.28, by - h * 0.9);
      ctx.lineTo(bx + w * 0.36, by - h * 0.97);
      ctx.stroke();
    }
    ctx.fillStyle = css(shade(c, 1.5), 0.6);
    ctx.beginPath(); ctx.ellipse(bx - w * 0.16, by - h * 0.42, w * 0.07, w * 0.05, 0, 0, 7); ctx.fill();
    outline(ctx, w, h, 0.25);
  }

  /* ---------------- built forms ---------------- */
  /* isoPrism: a box in 2:1 isometric space. hw = half width in screen px,
     hd = half depth, ht = height. Anchored at the bottom centre vertex. */
  function isoPrism(ctx, x, y, hw, hd, ht, top, left, right) {
    ctx.fillStyle = css(left);
    ctx.beginPath();
    ctx.moveTo(x - hw, y - hd);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y - ht);
    ctx.lineTo(x - hw, y - hd - ht);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = css(right);
    ctx.beginPath();
    ctx.moveTo(x + hw, y - hd);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y - ht);
    ctx.lineTo(x + hw, y - hd - ht);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = css(top);
    ctx.beginPath();
    ctx.moveTo(x, y - hd * 2 - ht);
    ctx.lineTo(x + hw, y - hd - ht);
    ctx.lineTo(x, y - ht);
    ctx.lineTo(x - hw, y - hd - ht);
    ctx.closePath(); ctx.fill();
  }

  function drawHouse(ctx, w, h, lights, base, d, variant, rnd) {
    const wall = drain([206, 188, 156], d * 0.45);
    const roofC = drain([150, 84, 60], d * 0.5);
    const bx = w / 2, by = h * 0.90;
    const hw = w * 0.34, hd = w * 0.17, ht = h * 0.44;
    isoPrism(ctx, bx, by, hw, hd, ht, shade(wall, 1.06), shade(wall, 1.0), shade(wall, 0.74));
    // timber frame lines
    ctx.strokeStyle = css(shade(wall, 0.62), 0.5);
    ctx.lineWidth = Math.max(1, w * 0.012);
    ctx.beginPath();
    ctx.moveTo(bx - hw, by - hd - ht * 0.5); ctx.lineTo(bx, by - ht * 0.5);
    ctx.lineTo(bx + hw, by - hd - ht * 0.5);
    ctx.stroke();
    // gable roof: two slopes meeting at a ridge
    const rTop = by - hd - ht - h * 0.16;
    ctx.fillStyle = css(roofC);
    ctx.beginPath();
    ctx.moveTo(bx - hw * 1.08, by - hd - ht + h * 0.012);
    ctx.lineTo(bx, by - ht + h * 0.012);
    ctx.lineTo(bx, rTop + hd * 0.5);
    ctx.lineTo(bx - hw * 1.08, rTop - hd * 0.5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = css(shade(roofC, 0.7));
    ctx.beginPath();
    ctx.moveTo(bx + hw * 1.08, by - hd - ht + h * 0.012);
    ctx.lineTo(bx, by - ht + h * 0.012);
    ctx.lineTo(bx, rTop + hd * 0.5);
    ctx.lineTo(bx + hw * 1.08, rTop - hd * 0.5);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = css(shade(roofC, 1.3), 0.7);
    ctx.lineWidth = Math.max(1, w * 0.018);
    ctx.beginPath();
    ctx.moveTo(bx - hw * 1.08, rTop - hd * 0.5); ctx.lineTo(bx, rTop + hd * 0.5);
    ctx.stroke();
    // chimney
    ctx.fillStyle = css(shade(roofC, 0.55));
    ctx.fillRect(bx - hw * 0.68, rTop - h * 0.10, w * 0.075, h * 0.14);
    // door
    ctx.fillStyle = css(drain([92, 66, 46], d * 0.4));
    ctx.fillRect(bx - hw * 0.26, by - hd * 0.5 - ht * 0.52, w * 0.12, ht * 0.52);
    // windows are recorded so night can light them
    const wsz = w * 0.10;
    const wins = [[bx - hw * 0.76, by - hd * 0.9 - ht * 0.72],
    [bx + hw * 0.34, by - hd * 0.22 - ht * 0.72]];
    for (const [wx, wy] of wins) {
      ctx.fillStyle = css([48, 44, 46]);
      ctx.fillRect(wx, wy, wsz, wsz * 0.9);
      ctx.strokeStyle = css(shade(wall, 0.68), 0.9);
      ctx.lineWidth = Math.max(1, w * 0.012);
      ctx.strokeRect(wx, wy, wsz, wsz * 0.9);
      lights.push({ x: wx + wsz / 2, y: wy + wsz * 0.45, r: wsz * 0.9 });
    }
    outline(ctx, w, h, 0.24);
  }

  function drawWorks(ctx, w, h, lights, base, d, variant, rnd) {
    const wall = drain([172, 132, 104], d * 0.4);
    const roofC = drain([96, 92, 96], d * 0.35);
    const bx = w / 2, by = h * 0.9;
    const hw = w * 0.36, hd = w * 0.18, ht = h * 0.28;
    isoPrism(ctx, bx, by, hw, hd, ht, shade(wall, 1.05), shade(wall, 1.0), shade(wall, 0.72));
    // sawtooth roof — the industrial read
    const rY = by - hd - ht;
    for (let i = 0; i < 3; i++) {
      const seg = (hw * 2) / 3;
      const x0 = bx - hw + i * seg;
      ctx.fillStyle = css(shade(roofC, 0.9 - i * 0.04));
      ctx.beginPath();
      ctx.moveTo(x0, rY + (hd * (i / 3)) * 2 * 0);
      ctx.lineTo(x0 + seg, rY);
      ctx.lineTo(x0 + seg, rY - h * 0.1);
      ctx.lineTo(x0, rY - h * 0.06);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = css(drain([150, 178, 190], d * 0.5), 0.65);
      ctx.beginPath();
      ctx.moveTo(x0, rY - h * 0.06);
      ctx.lineTo(x0 + seg, rY - h * 0.1);
      ctx.lineTo(x0 + seg * 0.92, rY - h * 0.15);
      ctx.lineTo(x0 + seg * 0.06, rY - h * 0.11);
      ctx.closePath(); ctx.fill();
    }
    // big doorway + loading bay
    ctx.fillStyle = css(shade(wall, 0.42));
    ctx.fillRect(bx - hw * 0.5, by - hd * 0.55 - ht * 0.82, w * 0.2, ht * 0.82);
    ctx.fillStyle = css([40, 34, 32]);
    ctx.fillRect(bx - hw * 0.46, by - hd * 0.5 - ht * 0.74, w * 0.17, ht * 0.74);
    lights.push({ x: bx - hw * 0.38, y: by - hd * 0.5 - ht * 0.38, r: w * 0.16 });
    // windows band
    const wsz = w * 0.06;
    for (let i = 0; i < 4; i++) {
      const wx = bx + hw * 0.12 + i * w * 0.07, wy = by - hd * 0.1 - ht * 0.68 + i * hd * 0.16;
      ctx.fillStyle = css([44, 42, 46]);
      ctx.fillRect(wx, wy, wsz, wsz);
      lights.push({ x: wx + wsz / 2, y: wy + wsz / 2, r: wsz * 1.1 });
    }
    // stack
    const sx = bx + hw * 0.66;
    ctx.fillStyle = css(shade(wall, 0.66));
    ctx.beginPath();
    ctx.moveTo(sx - w * 0.032, by - hd - ht);
    ctx.lineTo(sx - w * 0.024, by - hd - ht - h * 0.42);
    ctx.lineTo(sx + w * 0.024, by - hd - ht - h * 0.42);
    ctx.lineTo(sx + w * 0.032, by - hd - ht);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = css(drain([196, 132, 74], d * 0.3), 0.85);
    ctx.fillRect(sx - w * 0.026, by - hd - ht - h * 0.30, w * 0.052, h * 0.02);
    cv_meta(ctx, { stackX: sx, stackY: by - hd - ht - h * 0.44 });
    outline(ctx, w, h, 0.22);
  }

  // stash extra anchor points on the canvas being drawn
  function cv_meta(ctx, meta) { Object.assign(ctx.canvas, meta); }

  function drawSilo(ctx, w, h, lights, base, d, variant, rnd) {
    const body = drain([186, 178, 166], d * 0.3);
    const bx = w / 2, by = h * 0.94;
    const r = w * 0.26, ht = h * 0.62;
    const g = ctx.createLinearGradient(bx - r, 0, bx + r, 0);
    g.addColorStop(0, css(shade(body, 0.72)));
    g.addColorStop(0.32, css(shade(body, 1.14)));
    g.addColorStop(1, css(shade(body, 0.6)));
    ctx.fillStyle = g;
    ctx.fillRect(bx - r, by - ht, r * 2, ht);
    ctx.beginPath(); ctx.ellipse(bx, by, r, r * 0.4, 0, 0, 7); ctx.fill();
    ctx.fillStyle = css(shade(body, 1.2));
    ctx.beginPath(); ctx.ellipse(bx, by - ht, r, r * 0.4, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = css(shade(body, 0.55), 0.55);
    ctx.lineWidth = Math.max(1, w * 0.014);
    for (let i = 1; i < 4; i++) {
      const yy = by - ht * (i / 4);
      ctx.beginPath(); ctx.ellipse(bx, yy, r, r * 0.4, 0, 0.1, Math.PI - 0.1); ctx.stroke();
    }
    // conical cap
    ctx.fillStyle = css(drain([124, 118, 112], d * 0.3));
    ctx.beginPath();
    ctx.moveTo(bx - r, by - ht);
    ctx.lineTo(bx, by - ht - h * 0.16);
    ctx.lineTo(bx + r, by - ht);
    ctx.closePath(); ctx.fill();
    outline(ctx, w, h, 0.22);
  }

  function drawHeadframe(ctx, w, h, lights, base, d, variant, rnd) {
    const wood = drain([118, 86, 56], d * 0.45);
    const bx = w / 2, by = h * 0.96;
    ctx.strokeStyle = css(wood);
    ctx.lineWidth = w * 0.062;
    ctx.beginPath();
    ctx.moveTo(bx - w * 0.28, by); ctx.lineTo(bx - w * 0.06, by - h * 0.74);
    ctx.moveTo(bx + w * 0.28, by); ctx.lineTo(bx + w * 0.06, by - h * 0.74);
    ctx.stroke();
    ctx.lineWidth = w * 0.038;
    for (let i = 1; i <= 3; i++) {
      const t = i / 4, yy = by - h * 0.74 * t;
      const half = w * (0.28 - 0.22 * t);
      ctx.beginPath(); ctx.moveTo(bx - half, yy); ctx.lineTo(bx + half, yy); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx - half, yy); ctx.lineTo(bx + half * 0.8, yy - h * 0.185);
      ctx.stroke();
    }
    // back-brace
    ctx.lineWidth = w * 0.045;
    ctx.beginPath();
    ctx.moveTo(bx + w * 0.06, by - h * 0.7); ctx.lineTo(bx + w * 0.42, by);
    ctx.stroke();
    // sheave wheel — the renderer spins spokes over this
    ctx.strokeStyle = css(drain([92, 92, 100], d * 0.3));
    ctx.lineWidth = w * 0.05;
    ctx.beginPath(); ctx.arc(bx, by - h * 0.8, w * 0.14, 0, 7); ctx.stroke();
    cv_meta(ctx, { wheelX: bx, wheelY: h * 0.96 - h * 0.8, wheelR: w * 0.14 });
    outline(ctx, w, h, 0.28);
  }

  function drawCart(ctx, w, h, lights, base, d, variant, rnd) {
    const metal = drain([96, 90, 92], d * 0.3);
    const bx = w / 2, by = h * 0.86;
    isoPrism(ctx, bx, by, w * 0.3, w * 0.15, h * 0.34,
      shade(metal, 1.08), shade(metal, 0.95), shade(metal, 0.68));
    // ore heap
    const ore = drain(base, d * 0.3);
    blob(ctx, bx, by - h * 0.42, w * 0.22, w * 0.1, ore, 0.7);
    ctx.fillStyle = css(shade(ore, 1.3), 0.7);
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(bx + (rnd() - 0.5) * w * 0.34, by - h * (0.42 + rnd() * 0.06), w * 0.05, w * 0.035);
    }
    // wheels
    ctx.fillStyle = css([46, 42, 44]);
    ctx.beginPath(); ctx.arc(bx - w * 0.16, by + h * 0.06, w * 0.07, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(bx + w * 0.16, by + h * 0.06, w * 0.07, 0, 7); ctx.fill();
    outline(ctx, w, h, 0.25);
  }

  function drawTruck(ctx, w, h, lights, base, d, variant, rnd) {
    const body = drain([196, 154, 62], d * 0.35);
    const bx = w / 2, by = h * 0.84;
    // dump bed
    isoPrism(ctx, bx + w * 0.06, by, w * 0.30, w * 0.14, h * 0.30,
      shade(body, 1.02), shade(body, 0.92), shade(body, 0.64));
    const ore = drain(base, d * 0.3);
    blob(ctx, bx + w * 0.06, by - h * 0.36, w * 0.24, w * 0.09, ore, 0.7);
    // cab
    isoPrism(ctx, bx - w * 0.26, by - h * 0.02, w * 0.13, w * 0.08, h * 0.34,
      shade(body, 1.12), shade(body, 1.0), shade(body, 0.7));
    ctx.fillStyle = css([56, 66, 74]);
    ctx.fillRect(bx - w * 0.34, by - h * 0.3, w * 0.12, h * 0.1);
    ctx.fillStyle = css([40, 38, 40]);
    for (const wx of [-0.3, -0.02, 0.24]) {
      ctx.beginPath(); ctx.arc(bx + wx * w, by + h * 0.08, w * 0.08, 0, 7); ctx.fill();
      ctx.fillStyle = css([64, 62, 64]);
      ctx.beginPath(); ctx.arc(bx + wx * w, by + h * 0.08, w * 0.034, 0, 7); ctx.fill();
      ctx.fillStyle = css([40, 38, 40]);
    }
    lights.push({ x: bx - w * 0.38, y: by - h * 0.16, r: w * 0.1 });
    outline(ctx, w, h, 0.25);
  }

  function drawWorker(ctx, w, h, lights, base, d, variant, rnd) {
    const shirts = [[86, 116, 146], [150, 106, 78], [104, 130, 96], [154, 138, 92]];
    const shirt = shirts[variant % shirts.length];
    const bx = w / 2, by = h;
    ctx.fillStyle = css([58, 56, 62]);
    ctx.fillRect(bx - w * 0.16, by - h * 0.34, w * 0.13, h * 0.34);
    ctx.fillRect(bx + w * 0.03, by - h * 0.34, w * 0.13, h * 0.34);
    ctx.fillStyle = css(shirt);
    roundRect(ctx, bx - w * 0.2, by - h * 0.66, w * 0.4, h * 0.34, w * 0.08);
    ctx.fill();
    ctx.fillStyle = css(shade(shirt, 1.28), 0.6);
    roundRect(ctx, bx - w * 0.19, by - h * 0.65, w * 0.14, h * 0.32, w * 0.06);
    ctx.fill();
    ctx.fillStyle = css([214, 178, 148]);
    ctx.beginPath(); ctx.arc(bx, by - h * 0.75, w * 0.15, 0, 7); ctx.fill();
    // hard hat
    ctx.fillStyle = css(drain([222, 176, 62], d * 0.2));
    ctx.beginPath(); ctx.arc(bx, by - h * 0.79, w * 0.16, Math.PI, 0); ctx.fill();
    ctx.fillRect(bx - w * 0.2, by - h * 0.8, w * 0.4, h * 0.025);
    outline(ctx, w, h, 0.28);
  }

  function drawRobot(ctx, w, h, lights, base, d, variant, rnd) {
    const bx = w / 2, by = h;
    ctx.fillStyle = css([74, 78, 88]);
    roundRect(ctx, bx - w * 0.26, by - h * 0.16, w * 0.52, h * 0.16, w * 0.05); ctx.fill();
    const g = ctx.createLinearGradient(bx - w * 0.2, 0, bx + w * 0.2, 0);
    g.addColorStop(0, css([176, 180, 190]));
    g.addColorStop(0.4, css([138, 142, 152]));
    g.addColorStop(1, css([88, 92, 102]));
    ctx.strokeStyle = g;
    ctx.lineWidth = w * 0.15;
    ctx.beginPath();
    ctx.moveTo(bx, by - h * 0.16);
    ctx.lineTo(bx - w * 0.12, by - h * 0.56);
    ctx.lineTo(bx + w * 0.22, by - h * 0.78);
    ctx.stroke();
    ctx.fillStyle = css([64, 68, 78]);
    ctx.beginPath(); ctx.arc(bx - w * 0.12, by - h * 0.56, w * 0.1, 0, 7); ctx.fill();
    ctx.fillStyle = css([196, 118, 62]);
    roundRect(ctx, bx + w * 0.16, by - h * 0.86, w * 0.14, h * 0.1, w * 0.03); ctx.fill();
    lights.push({ x: bx - w * 0.2, y: by - h * 0.1, r: w * 0.09 });
    outline(ctx, w, h, 0.3);
  }

  function drawFurnace(ctx, w, h, lights, base, d, variant, rnd) {
    const body = drain([146, 104, 82], d * 0.3);
    const bx = w / 2, by = h * 0.9;
    isoPrism(ctx, bx, by, w * 0.34, w * 0.17, h * 0.46,
      shade(body, 1.06), shade(body, 0.98), shade(body, 0.7));
    // ribbed shell
    ctx.strokeStyle = css(shade(body, 0.66), 0.5);
    ctx.lineWidth = Math.max(1, w * 0.014);
    for (let i = 1; i < 4; i++) {
      const yy = by - h * 0.46 * (i / 4);
      ctx.beginPath();
      ctx.moveTo(bx - w * 0.34, yy - w * 0.17); ctx.lineTo(bx, yy);
      ctx.lineTo(bx + w * 0.34, yy - w * 0.17);
      ctx.stroke();
    }
    // mouth (glows at runtime)
    ctx.fillStyle = css([40, 32, 30]);
    roundRect(ctx, bx - w * 0.26, by - h * 0.42, w * 0.22, h * 0.18, w * 0.03); ctx.fill();
    cv_meta(ctx, { mouthX: bx - w * 0.15, mouthY: h * 0.9 - h * 0.33, stackX: bx + w * 0.2, stackY: h * 0.9 - h * 0.86 });
    // stack
    ctx.fillStyle = css(shade(body, 0.6));
    ctx.fillRect(bx + w * 0.16, by - h * 0.86, w * 0.08, h * 0.42);
    ctx.fillStyle = css(shade(body, 0.9));
    ctx.fillRect(bx + w * 0.14, by - h * 0.88, w * 0.12, h * 0.03);
    outline(ctx, w, h, 0.24);
  }

  function drawPress(ctx, w, h, lights, base, d, variant, rnd) {
    const body = drain([86, 92, 104], d * 0.24);
    const steel = drain([132, 138, 150], d * 0.22);
    const bx = w / 2, by = h * 0.9;
    // heavy machine body
    isoPrism(ctx, bx, by, w * 0.36, w * 0.18, h * 0.44,
      shade(body, 1.16), shade(body, 1.0), shade(body, 0.64));
    // control face
    ctx.fillStyle = css(shade(body, 0.52));
    ctx.fillRect(bx - w * 0.27, by - h * 0.46, w * 0.2, h * 0.16);
    ctx.fillStyle = css(drain([118, 168, 152], d * 0.3), 0.9);
    ctx.fillRect(bx - w * 0.24, by - h * 0.43, w * 0.14, h * 0.07);
    // gantry columns rising off the body
    for (const cx of [-0.29, 0.21]) {
      const g = ctx.createLinearGradient(bx + cx * w, 0, bx + cx * w + w * 0.08, 0);
      g.addColorStop(0, css(shade(steel, 0.6)));
      g.addColorStop(0.4, css(shade(steel, 1.1)));
      g.addColorStop(1, css(shade(steel, 0.54)));
      ctx.fillStyle = g;
      ctx.fillRect(bx + cx * w, by - h * 0.82, w * 0.08, h * 0.36);
    }
    // crown beam
    ctx.fillStyle = css(shade(body, 0.82));
    ctx.fillRect(bx - w * 0.36, by - h * 0.9, w * 0.72, h * 0.1);
    ctx.fillStyle = css(shade(steel, 1.2), 0.7);
    ctx.fillRect(bx - w * 0.36, by - h * 0.9, w * 0.72, h * 0.02);
    // die table with an accent stripe
    ctx.fillStyle = css(shade(body, 0.66));
    ctx.fillRect(bx - w * 0.32, by - h * 0.5, w * 0.64, h * 0.055);
    ctx.fillStyle = css(drain([202, 146, 52], d * 0.25));
    ctx.fillRect(bx - w * 0.32, by - h * 0.45, w * 0.64, h * 0.026);
    // hazard chevrons on the plinth
    ctx.fillStyle = css(drain([214, 176, 72], d * 0.3), 0.85);
    for (let i = 0; i < 5; i++) ctx.fillRect(bx - w * 0.26 + i * w * 0.11, by - h * 0.1, w * 0.05, h * 0.03);
    cv_meta(ctx, { headX: bx, headY: h * 0.9 - h * 0.68, headW: w * 0.2, headH: h * 0.2 });
    outline(ctx, w, h, 0.3);
  }

  function drawCrate(ctx, w, h, lights, base, d, variant, rnd) {
    const wood = drain([182, 150, 104], d * 0.35);
    const bx = w / 2, by = h * 0.9;
    isoPrism(ctx, bx, by, w * 0.36, w * 0.18, h * 0.44,
      shade(wood, 1.08), shade(wood, 0.98), shade(wood, 0.7));
    ctx.strokeStyle = css(shade(wood, 0.66), 0.65);
    ctx.lineWidth = Math.max(1, w * 0.026);
    ctx.beginPath();
    ctx.moveTo(bx - w * 0.36, by - w * 0.18 - h * 0.22); ctx.lineTo(bx, by - h * 0.22);
    ctx.lineTo(bx + w * 0.36, by - w * 0.18 - h * 0.22);
    ctx.stroke();
    outline(ctx, w, h, 0.24);
  }

  function drawLamp(ctx, w, h, lights, base, d, variant, rnd) {
    const post = drain([76, 74, 78], d * 0.2);
    const bx = w / 2, by = h;
    ctx.strokeStyle = css(post);
    ctx.lineWidth = w * 0.1;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx, by - h * 0.86);
    ctx.quadraticCurveTo(bx, by - h * 0.96, bx + w * 0.22, by - h * 0.94);
    ctx.stroke();
    ctx.fillStyle = css(shade(post, 1.2));
    ctx.beginPath();
    ctx.moveTo(bx + w * 0.1, by - h * 0.94);
    ctx.lineTo(bx + w * 0.36, by - h * 0.94);
    ctx.lineTo(bx + w * 0.3, by - h * 0.86);
    ctx.lineTo(bx + w * 0.16, by - h * 0.86);
    ctx.closePath(); ctx.fill();
    lights.push({ x: bx + w * 0.23, y: by - h * 0.86, r: w * 0.4 });
    outline(ctx, w, h, 0.3);
  }

  const KINDS = {
    tree: { w: 132, h: 172, ay: 1, fn: drawBroadleaf },
    pine: { w: 120, h: 190, ay: 1, fn: drawPine },
    shrub: { w: 84, h: 62, ay: 1, fn: drawShrub },
    grass: { w: 56, h: 40, ay: 1, fn: drawGrassTuft },
    flower: { w: 72, h: 46, ay: 1, fn: drawFlowers },
    rock: { w: 92, h: 62, ay: 1, fn: drawRock },
    stump: { w: 72, h: 46, ay: 1, fn: drawStump },
    deer: { w: 96, h: 92, ay: 1, fn: drawDeer },
    house: { w: 168, h: 176, ay: 1, fn: drawHouse },
    works: { w: 300, h: 260, ay: 1, fn: drawWorks },
    silo: { w: 104, h: 168, ay: 1, fn: drawSilo },
    headframe: { w: 156, h: 210, ay: 1, fn: drawHeadframe },
    cart: { w: 96, h: 76, ay: 1, fn: drawCart },
    truck: { w: 168, h: 108, ay: 1, fn: drawTruck },
    worker: { w: 46, h: 78, ay: 1, fn: drawWorker },
    robot: { w: 78, h: 96, ay: 1, fn: drawRobot },
    furnace: { w: 150, h: 168, ay: 1, fn: drawFurnace },
    press: { w: 142, h: 150, ay: 1, fn: drawPress },
    crate: { w: 92, h: 92, ay: 1, fn: drawCrate },
    lamp: { w: 60, h: 150, ay: 1, fn: drawLamp },
  };

  /* base colour per kind, taken from the product palette where it matters */
  function baseFor(kind, palette, variant) {
    const P = palette;
    switch (kind) {
      case 'tree': {
        const greens = [[86, 124, 62], [104, 138, 68], [74, 110, 58], [118, 144, 74]];
        return greens[variant % greens.length];
      }
      case 'pine': return [62, 98, 66];
      case 'shrub': return [98, 132, 70];
      case 'grass': return G.hex2rgb(P.grass);
      case 'rock': return G.hex2rgb(P.rock);
      case 'cart': case 'truck': return G.hex2rgb(P.rock);
      default: return [150, 150, 150];
    }
  }

  function get(kind, variant, decay, palette, paletteId) {
    const bucket = Math.max(0, Math.min(DECAY_STEPS - 1, Math.round(decay * (DECAY_STEPS - 1))));
    const key = `${kind}|${variant}|${bucket}|${paletteId}`;
    let cv = cache.get(key);
    if (cv) return cv;
    const def = KINDS[kind];
    if (!def) return null;
    const d = bucket / (DECAY_STEPS - 1);
    const rnd = mulberry32(0x9e37 + variant * 7919 + kind.length * 131);
    cv = sprite(def.w, def.h, def.w / 2, def.h * def.ay,
      (ctx, w, h, lights) => def.fn(ctx, w, h, lights, baseFor(kind, palette, variant), d, variant, rnd));
    cache.set(key, cv);
    return cv;
  }

  /* Draw a cached sprite anchored at bottom-centre, scaled to `scale`. */
  function draw(ctx, cv, x, y, scale, alpha, flip) {
    if (!cv) return;
    const w = cv.width * scale, h = cv.height * scale;
    ctx.save();
    if (alpha !== undefined && alpha < 1) ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(cv, -w / 2, -h, w, h);
    ctx.restore();
  }

  PD.Art = { get, draw, KINDS, DECAY_STEPS, isoPrism, blob, clearCache: () => cache.clear() };
})();
