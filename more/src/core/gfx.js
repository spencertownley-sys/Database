// MORE. — graphics
// Everything renders into a 256x224 canvas (SNES NTSC), scaled up by CSS
// with nearest-neighbour filtering. Sprites are authored as rows of palette
// characters (see palette.js) and baked into small canvases once.
(function (M) {
  'use strict';

  const W = 256;
  const H = 224;
  let canvas = null;
  let ctx = null;

  function init(cv) {
    canvas = cv;
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = false;
    resize();
    window.addEventListener('resize', resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas.parentElement);
    M.gfx.ctx = ctx;
  }

  // Largest scale that is a whole number of *device* pixels per game pixel, so
  // the image stays crisp on desktop (1x, 2x, 3x...) and fills phones (e.g. 4/3).
  function resize() {
    const host = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const fit = Math.min(host.clientWidth / W, host.clientHeight / H);
    const dev = Math.max(1, Math.floor(fit * dpr));
    const s = dev / dpr;
    canvas.style.width = W * s + 'px';
    canvas.style.height = H * s + 'px';
  }

  // --- sprites --------------------------------------------------------------
  function make(rows, map) {
    const h = rows.length;
    let w = 0;
    for (const r of rows) w = Math.max(w, r.length);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, w);
    cv.height = Math.max(1, h);
    const cx = cv.getContext('2d');
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        const col = (map && map[ch]) || M.PALKEY[ch];
        if (!col) continue;
        cx.fillStyle = col;
        cx.fillRect(x, y, 1, 1);
      }
    }
    return cv;
  }

  // Parse a template-literal block into rows (drops blank first/last lines, trims indent).
  function rows(block) {
    const lines = block.split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines.map((l) => l.trim());
  }

  function spr(img, x, y, flip) {
    if (!img) return;
    x = Math.round(x);
    y = Math.round(y);
    if (flip) {
      ctx.save();
      ctx.translate(x + img.width, y);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(img, x, y);
    }
  }

  function sprScaled(img, x, y, s) {
    ctx.drawImage(img, Math.round(x), Math.round(y), img.width * s, img.height * s);
  }

  function rect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function outline(x, y, w, h, color) {
    rect(x, y, w, 1, color);
    rect(x, y + h - 1, w, 1, color);
    rect(x, y, 1, h, color);
    rect(x + w - 1, y, 1, h, color);
  }

  function text(str, x, y, color, scale) {
    return M.font.draw(ctx, str, Math.round(x), Math.round(y), color || M.PAL.CREAM, scale);
  }

  function textCenter(str, cx, y, color, scale) {
    const w = M.font.width(str, scale);
    return text(str, Math.round(cx - w / 2), y, color, scale);
  }

  function textRight(str, rx, y, color, scale) {
    const w = M.font.width(str, scale);
    return text(str, rx - w, y, color, scale);
  }

  // Double-bordered box, exactly like the mockup dialog window.
  function box(x, y, w, h) {
    const P = M.PAL;
    rect(x, y, w, h, P.SHADOW);
    outline(x + 1, y + 1, w - 2, h - 2, P.CREAM);
    outline(x + 3, y + 3, w - 6, h - 6, P.CREAM);
  }

  // SNES-style master brightness: 0 = black, 1 = full. Quantized to 16 steps.
  function brightness(level) {
    const q = Math.round(Math.max(0, Math.min(1, level)) * 15) / 15;
    if (q >= 1) return;
    ctx.globalAlpha = 1 - q;
    rect(0, 0, W, H, '#000');
    ctx.globalAlpha = 1;
  }

  // Colour-math style tint (multiply). amount 0..1.
  function tint(color, amount) {
    if (amount <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = Math.min(1, amount);
    rect(0, 0, W, H, color);
    ctx.restore();
  }

  function clear(color) {
    rect(0, 0, W, H, color || M.PAL.INK);
  }

  M.gfx = {
    W,
    H,
    init,
    resize,
    make,
    rows,
    spr,
    sprScaled,
    rect,
    outline,
    text,
    textCenter,
    textRight,
    box,
    brightness,
    tint,
    clear,
    get canvas() {
      return canvas;
    },
  };
})(window.MORE = window.MORE || {});
