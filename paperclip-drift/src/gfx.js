/* Paperclip Drift — graphics toolkit.
   Render-side only: noise, colour, easing, pooled particles, a pan/zoom
   camera, offscreen layer caching, an emissive bloom buffer and a post pass.
   Nothing here reads game state; callers pass in plain numbers.            */
'use strict';
var PD = globalThis.PD || (globalThis.PD = {});

(function () {
  /* ---------------- math / noise ---------------- */
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = t => t * t * (3 - 2 * t);

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function valueNoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smoothstep(x - xi), yf = smoothstep(y - yi);
    const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
    const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
    return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
  }

  function fbm(x, y, seed, oct) {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < (oct || 4); i++) {
      sum += valueNoise(x * f, y * f, seed + i * 1013) * amp;
      norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  }

  /* ---------------- easing ---------------- */
  const ease = {
    outCubic: t => 1 - Math.pow(1 - t, 3),
    inCubic: t => t * t * t,
    inOut: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    outBack: t => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
    outElastic: t => t === 0 || t === 1 ? t
      : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1,
    outQuint: t => 1 - Math.pow(1 - t, 5),
  };

  /* ---------------- colour ---------------- */
  function hex2rgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const css = (c, a) => a === undefined
    ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
    : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const shade = (c, f) => [clamp(c[0] * f, 0, 255), clamp(c[1] * f, 0, 255), clamp(c[2] * f, 0, 255)];
  const lum = c => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
  /* Drains chroma toward warm ash while holding value — decay stays legible
     without relying on hue, which colour-blind players can't lean on. */
  function drain(c, d) {
    if (d <= 0) return c;
    const l = lum(c);
    return mix(c, [l * 1.06, l * 1.0, l * 0.9], clamp01(d));
  }

  /* ---------------- canvases ---------------- */
  function makeCanvas(w, h) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, w | 0); cv.height = Math.max(1, h | 0);
    return cv;
  }

  /* Keyed offscreen cache — expensive layers are redrawn only when their key
     changes (decay is quantised into buckets so this actually hits).        */
  class LayerCache {
    constructor() { this.key = null; this.cv = null; }
    get(key, w, h, draw) {
      if (this.key === key && this.cv && this.cv.width === w && this.cv.height === h) return this.cv;
      if (!this.cv || this.cv.width !== w || this.cv.height !== h) this.cv = makeCanvas(w, h);
      const ctx = this.cv.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      draw(ctx, w, h);
      this.key = key;
      return this.cv;
    }
  }

  /* ---------------- particles ---------------- */
  /* One pooled array, drawn in a single pass. Types are cheap shapes; the
     look comes from colour, additive blending and easing curves.            */
  class Particles {
    constructor(max) {
      this.max = max || 900;
      this.pool = [];
      for (let i = 0; i < this.max; i++) {
        this.pool.push({ live: false, kind: '', x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 0, age: 0, size: 0, c: [255, 255, 255], spin: 0, rot: 0, add: false, drag: 1 });
      }
      this.cursor = 0;
      this.count = 0;
    }
    spawn(o) {
      let p = null;
      for (let i = 0; i < this.max; i++) {
        const q = this.pool[(this.cursor + i) % this.max];
        if (!q.live) { p = q; this.cursor = (this.cursor + i + 1) % this.max; break; }
      }
      if (!p) return null;
      p.live = true; p.age = 0;
      p.kind = o.kind || 'dot';
      p.x = o.x; p.y = o.y;
      p.vx = o.vx || 0; p.vy = o.vy || 0;
      p.g = o.g === undefined ? 0 : o.g;
      p.life = o.life || 1;
      p.size = o.size || 3;
      p.c = o.c || [255, 255, 255];
      p.spin = o.spin || 0; p.rot = o.rot || 0;
      p.add = !!o.add;
      p.drag = o.drag === undefined ? 1 : o.drag;
      p.z = o.z || 0;
      this.count++;
      return p;
    }
    update(dt) {
      for (const p of this.pool) {
        if (!p.live) continue;
        p.age += dt;
        if (p.age >= p.life) { p.live = false; this.count--; continue; }
        p.vy += p.g * dt;
        p.vx *= Math.pow(p.drag, dt * 60);
        p.vy *= Math.pow(p.drag, dt * 60);
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.rot += p.spin * dt;
      }
    }
    draw(ctx) {
      let addPass = false;
      for (let pass = 0; pass < 2; pass++) {
        addPass = pass === 1;
        if (addPass) ctx.globalCompositeOperation = 'lighter';
        for (const p of this.pool) {
          if (!p.live || p.add !== addPass) continue;
          const t = p.age / p.life;
          const fade = p.kind === 'smoke' ? (1 - t) * 0.55
            : p.kind === 'spark' ? (1 - t)
              : ease.outCubic(1 - t);
          ctx.globalAlpha = clamp01(fade);
          const s = p.kind === 'smoke' ? p.size * (0.6 + t * 1.9)
            : p.kind === 'ring' ? p.size * (0.4 + t * 2.4)
              : p.size * (1 - t * 0.35);
          if (p.kind === 'ring') {
            ctx.strokeStyle = css(p.c);
            ctx.lineWidth = Math.max(0.6, 2.2 * (1 - t));
            ctx.beginPath(); ctx.ellipse(p.x, p.y, s, s * 0.5, 0, 0, 7); ctx.stroke();
          } else if (p.kind === 'chip' || p.kind === 'leaf') {
            ctx.save();
            ctx.translate(p.x, p.y); ctx.rotate(p.rot);
            ctx.fillStyle = css(p.c);
            const w = s, h = p.kind === 'leaf' ? s * 0.5 : s * 0.8;
            ctx.fillRect(-w / 2, -h / 2, w, h);
            ctx.restore();
          } else if (p.kind === 'spark') {
            ctx.strokeStyle = css(p.c);
            ctx.lineWidth = Math.max(0.8, s * 0.35);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
            ctx.stroke();
          } else {
            ctx.fillStyle = css(p.c);
            ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.4, s), 0, 7); ctx.fill();
          }
        }
        if (addPass) ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = 1;
    }
    clear() { for (const p of this.pool) p.live = false; this.count = 0; }
  }

  /* ---------------- camera ---------------- */
  class Camera {
    constructor() {
      this.x = 0; this.y = 0; this.zoom = 1;
      this.tx = 0; this.ty = 0; this.tzoom = 1;
      this.shake = 0; this.shakeX = 0; this.shakeY = 0;
      this.minZoom = 0.55; this.maxZoom = 2.6;
      this.bound = 900;
    }
    nudge(dx, dy) { this.tx += dx; this.ty += dy; }
    zoomBy(f, cx, cy, W, H) {
      const before = this.tzoom;
      this.tzoom = clamp(this.tzoom * f, this.minZoom, this.maxZoom);
      // keep the point under the cursor anchored
      const k = this.tzoom / before - 1;
      this.tx += (cx - W / 2) * k / this.tzoom;
      this.ty += (cy - H / 2) * k / this.tzoom;
    }
    kick(amount) { this.shake = Math.min(28, this.shake + amount); }
    update(dt, reduced) {
      const k = 1 - Math.pow(0.0012, dt);
      this.tx = clamp(this.tx, -this.bound, this.bound);
      this.ty = clamp(this.ty, -this.bound, this.bound);
      this.x = lerp(this.x, this.tx, k);
      this.y = lerp(this.y, this.ty, k);
      this.zoom = lerp(this.zoom, this.tzoom, k);
      this.shake *= Math.pow(0.0009, dt);
      if (this.shake < 0.05) this.shake = 0;
      if (reduced) { this.shakeX = this.shakeY = 0; return; }
      this.shakeX = (Math.random() * 2 - 1) * this.shake;
      this.shakeY = (Math.random() * 2 - 1) * this.shake * 0.6;
    }
    apply(ctx, W, H) {
      ctx.save();
      ctx.translate(W / 2 + this.shakeX, H / 2 + this.shakeY);
      ctx.scale(this.zoom, this.zoom);
      ctx.translate(-W / 2 + this.x, -H / 2 + this.y);
    }
    /* screen px -> the coordinate space used inside apply() */
    toWorld(sx, sy, W, H) {
      return [(sx - W / 2 - this.shakeX) / this.zoom + W / 2 - this.x,
      (sy - H / 2 - this.shakeY) / this.zoom + H / 2 - this.y];
    }
    reset() { this.x = this.y = this.tx = this.ty = 0; this.zoom = this.tzoom = 1; this.shake = 0; }
  }

  /* ---------------- emissive bloom ---------------- */
  /* Lights are drawn into a quarter-res buffer, blurred by repeated
     downscale/upscale, then added back. Cheap, and only lights glow.        */
  class Bloom {
    constructor() { this.buf = null; this.small = null; this.small2 = null; }
    begin(W, H) {
      const w = Math.max(2, W >> 1), h = Math.max(2, H >> 1);
      if (!this.buf || this.buf.width !== w || this.buf.height !== h) {
        this.buf = makeCanvas(w, h);
        this.small = makeCanvas(Math.max(2, w >> 2), Math.max(2, h >> 2));
        this.small2 = makeCanvas(Math.max(2, w >> 3), Math.max(2, h >> 3));
      }
      const ctx = this.buf.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.scale(0.5, 0.5);
      return ctx;
    }
    composite(ctx, W, H, strength) {
      if (!this.buf || strength <= 0) return;
      const s1 = this.small.getContext('2d'), s2 = this.small2.getContext('2d');
      s1.setTransform(1, 0, 0, 1, 0, 0);
      s1.clearRect(0, 0, this.small.width, this.small.height);
      s1.drawImage(this.buf, 0, 0, this.small.width, this.small.height);
      s2.setTransform(1, 0, 0, 1, 0, 0);
      s2.clearRect(0, 0, this.small2.width, this.small2.height);
      s2.drawImage(this.small, 0, 0, this.small2.width, this.small2.height);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 * strength;
      ctx.drawImage(this.buf, 0, 0, W, H);
      ctx.globalAlpha = 0.42 * strength;
      ctx.drawImage(this.small, 0, 0, W, H);
      ctx.globalAlpha = 0.36 * strength;
      ctx.drawImage(this.small2, 0, 0, W, H);
      ctx.restore();
    }
  }

  /* ---------------- post ---------------- */
  let grainTile = null;
  function makeGrain() {
    const size = 128;
    const cv = makeCanvas(size, size);
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size);
    const rnd = mulberry32(7717);
    for (let i = 0; i < img.data.length; i += 4) {
      const up = rnd() > 0.5;
      const v = up ? 255 : 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.round(rnd() * 90);
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  const patCache = new WeakMap();
  function grain(ctx, W, H, amount, offX, offY) {
    if (amount <= 0) return;
    if (!grainTile) grainTile = makeGrain();
    let pat = patCache.get(ctx);
    if (!pat) { pat = ctx.createPattern(grainTile, 'repeat'); patCache.set(ctx, pat); }
    ctx.save();
    ctx.globalAlpha = amount;
    ctx.translate((offX | 0) % 128, (offY | 0) % 128);
    ctx.fillStyle = pat;
    ctx.fillRect(-128, -128, W + 128, H + 128);
    ctx.restore();
  }

  let vigCache = null, vigKey = '';
  function vignette(ctx, W, H, amount, colour) {
    if (amount <= 0) return;
    const c = colour || [8, 6, 10];
    const key = `${W}x${H}|${amount.toFixed(2)}|${c.join()}`;
    if (vigKey !== key) {
      vigKey = key;
      vigCache = makeCanvas(W, H);
      const vc = vigCache.getContext('2d');
      const g = vc.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.32,
        W / 2, H * 0.5, Math.max(W, H) * 0.78);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, css(c, amount));
      vc.fillStyle = g;
      vc.fillRect(0, 0, W, H);
    }
    ctx.drawImage(vigCache, 0, 0);
  }

  /* A cheap two-stop grade: multiply the shadows toward a tint, then screen
     the highlights toward another. Reads as filmic without touching pixels. */
  function grade(ctx, W, H, shadowTint, shadowAmt, lightTint, lightAmt) {
    if (shadowAmt > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = css(shadowTint, shadowAmt);
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    if (lightAmt > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = css(lightTint, lightAmt * 0.42);
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  /* ---------------- shapes ---------------- */
  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /* Soft contact shadow. Painted once into a sprite and blitted thereafter —
     a gradient per prop per frame is the single most expensive thing a scene
     this dense can do. */
  let shadowSprite = null;
  function makeShadowSprite() {
    const S = 96, cv = makeCanvas(S, S), c = cv.getContext('2d');
    const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(24,20,18,1)');
    g.addColorStop(0.62, 'rgba(24,20,18,0.55)');
    g.addColorStop(1, 'rgba(24,20,18,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, S, S);
    return cv;
  }
  function dropShadow(ctx, x, y, rx, ry, alpha) {
    if (alpha <= 0.01) return;
    if (!shadowSprite) shadowSprite = makeShadowSprite();
    const w = Math.max(2, rx * 2), h = Math.max(1.5, ry * 2);
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(shadowSprite, x - w / 2, y - h / 2, w, h);
    ctx.restore();
  }

  /* Rendering budget. main.js measures frame time and steps this down; the
     renderers shed the most expensive passes first so a slow machine keeps a
     smooth loop instead of a pretty slideshow. */
  const perf = { level: 2, fps: 60 };

  PD.Gfx = {
    perf,
    clamp, clamp01, lerp, smoothstep, mulberry32, hash2, valueNoise, fbm,
    ease, hex2rgb, css, mix, shade, drain, lum, makeCanvas,
    LayerCache, Particles, Camera, Bloom,
    grain, vignette, grade, roundRect, dropShadow,
  };
})();
