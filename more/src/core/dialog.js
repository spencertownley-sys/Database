// MORE. — dialog window
// Layout matches the mockup exactly: a double-bordered box at y=168, a 24x24
// cream-framed portrait at (8,176), text from x=40. Pip speaks in orange;
// people speak in cream and get a name tab.
(function (M) {
  'use strict';

  const BOX_Y = 168;
  const LINE_H = 12;
  const LINES = 3;

  // Pause after punctuation, in seconds.
  const PAUSE = { '.': 0.22, ',': 0.1, '?': 0.24, '!': 0.2, ':': 0.12, '…': 0.3, '—': 0.1 };

  function drawFrame() {
    M.gfx.box(0, BOX_Y, 256, 56);
  }

  function drawPortrait(key, x, y) {
    const P = M.PAL;
    M.gfx.rect(x, y, 24, 24, P.FLOOR);
    M.gfx.outline(x, y, 24, 24, P.CREAM);
    const img = key && M.ART.portraits[key];
    if (!img) return;
    // bottom-aligned busts, centred small icons (Pip)
    const ix = x + Math.floor((24 - img.width) / 2);
    const iy = img.height >= 18 ? y + 23 - img.height : y + Math.floor((24 - img.height) / 2);
    M.gfx.spr(img, ix, iy);
  }

  class Dialog {
    constructor() {
      this.active = false;
      this.result = undefined;
    }

    open(who, text, opts) {
      opts = opts || {};
      this.who = who;
      this.cast = (M.CAST && M.CAST[who]) || M.CAST.none;
      this.opts = opts;
      const portrait = opts.portrait || this.cast.portrait;
      this.portrait = portrait;
      this.tx = portrait ? 40 : 16;
      this.cols = portrait ? 26 : 29;
      const lines = M.font.wrap(text, this.cols);
      // Balance pages so a long line never leaves one orphaned word on its own page.
      this.pages = [];
      const nPages = Math.max(1, Math.ceil(lines.length / LINES));
      const per = Math.ceil(lines.length / nPages);
      for (let i = 0; i < lines.length; i += per) this.pages.push(lines.slice(i, i + per));
      this.page = 0;
      this.chars = 0;
      this.hold = 0;
      this.blip = 0;
      this.choices = opts.choices || null;
      this.sel = opts.defaultChoice || 0;
      this.speed = opts.speed || this.cast.speed || 40;
      this.color = opts.color || this.cast.color || M.PAL.CREAM;
      this.t = 0;
      this.autoT = 0;
      this.active = true;
      this.result = undefined;
    }

    close() {
      this.active = false;
    }

    pageLen() {
      return this.pages[this.page].reduce((n, l) => n + l.length, 0);
    }

    charAt(i) {
      for (const l of this.pages[this.page]) {
        if (i < l.length) return l[i];
        i -= l.length;
      }
      return '';
    }

    // Returns true when the player has dismissed the message (or chosen).
    update(dt) {
      if (!this.active) return true;
      this.t += dt;
      const I = M.input;
      const total = this.pageLen();
      if (this.chars < total) {
        if (I.pressed('a') || I.pressed('b')) {
          this.chars = total;
          this.hold = 0;
          return false;
        }
        if (this.hold > 0) {
          this.hold -= dt;
          return false;
        }
        const before = Math.floor(this.chars);
        this.chars = Math.min(total, this.chars + this.speed * dt);
        const after = Math.floor(this.chars);
        for (let i = before; i < after; i++) {
          const ch = this.charAt(i);
          if (ch !== ' ' && ++this.blip % 2 === 1 && !this.opts.silent) M.audio.sfx('blip', this.cast.blip);
          if (PAUSE[ch] && i < total - 1) {
            this.hold = PAUSE[ch] * (this.opts.pauseScale || 1);
            this.chars = i + 1;
            break;
          }
        }
        return false;
      }

      const last = this.page >= this.pages.length - 1;
      if (last && this.choices) {
        if (I.repeat('up')) {
          this.sel = (this.sel + this.choices.length - 1) % this.choices.length;
          M.audio.sfx('cursor');
        }
        if (I.repeat('down')) {
          this.sel = (this.sel + 1) % this.choices.length;
          M.audio.sfx('cursor');
        }
        if (I.pressed('a')) {
          M.audio.sfx('confirm');
          M.input.consume();
          this.result = this.sel;
          this.active = false;
          return true;
        }
        return false;
      }

      if (this.opts.auto != null) {
        this.autoT += dt;
        if (this.autoT >= this.opts.auto) return this.advance();
      }
      if (I.pressed('a') && !this.opts.noSkip) return this.advance();
      return false;
    }

    advance() {
      M.input.consume(); // the press that closes this box must not skip the next one
      if (this.page < this.pages.length - 1) {
        this.page++;
        this.chars = 0;
        this.autoT = 0;
        return false;
      }
      this.active = false;
      return true;
    }

    draw() {
      if (!this.active) return;
      const P = M.PAL;
      drawFrame();
      if (this.portrait) drawPortrait(this.portrait, 8, 176);

      // name tab for people (Pip has none, as in the mockup)
      if (this.cast.name && !this.cast.noTab) {
        const w = this.cast.name.length * 8 + 9;
        M.gfx.rect(6, 156, w + 2, 14, P.SHADOW);
        M.gfx.outline(7, 157, w, 13, P.CREAM);
        M.gfx.text(this.cast.name, 12, 160, P.ORANGE);
      }

      let left = Math.floor(this.chars);
      const lines = this.pages[this.page];
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const shown = l.slice(0, Math.max(0, left));
        left -= l.length;
        M.gfx.text(shown, this.tx, 178 + i * LINE_H, this.color);
      }

      const typed = this.chars >= this.pageLen();
      const last = this.page >= this.pages.length - 1;
      if (typed && !(last && this.choices) && this.opts.auto == null && !this.opts.noSkip) {
        if (Math.floor(this.t * 3) % 2 === 0) M.gfx.text('▼', 238, 208, P.CREAM);
      }
      if (typed && last && this.choices) this.drawChoices();
    }

    drawChoices() {
      const P = M.PAL;
      const n = this.choices.length;
      const maxLen = this.choices.reduce((m, c) => Math.max(m, c.length), 0);
      const w = maxLen * 8 + 30;
      const h = n * LINE_H + 12;
      const x = 252 - w;
      const y = BOX_Y - h + 3;
      M.gfx.box(x, y, w, h);
      for (let i = 0; i < n; i++) {
        const ty = y + 7 + i * LINE_H;
        const on = i === this.sel;
        if (on && Math.floor(this.t * 4) % 4 !== 3) M.gfx.text('▶', x + 7, ty, P.ORANGE);
        M.gfx.text(this.choices[i], x + 18, ty, on ? P.ORANGE : P.CREAM);
      }
    }
  }

  M.dialog = new Dialog();
  M.drawDialogFrame = drawFrame;
  M.drawPortrait = drawPortrait;

  // Script commands --------------------------------------------------------------
  M.cmd.say = function (who, text, opts) {
    return {
      start() {
        M.dialog.open(who, text, opts);
      },
      update(dt) {
        return M.dialog.update(dt);
      },
      draw() {
        M.dialog.draw();
      },
    };
  };

  M.cmd.choose = function (who, text, choices, opts) {
    return {
      start() {
        M.dialog.open(who, text, Object.assign({}, opts, { choices }));
      },
      update(dt) {
        if (M.dialog.update(dt)) {
          this.result = M.dialog.result;
          return true;
        }
        return false;
      },
      draw() {
        M.dialog.draw();
      },
    };
  };
})(window.MORE = window.MORE || {});
