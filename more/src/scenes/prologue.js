// MORE. — Chapter 0: the office and the terminal
(function (M) {
  'use strict';

  const P = M.PAL;
  const DOOR_X = 220;
  const FLOOR_Y = 122;

  const TERM = { x: 24, goalY: 92 };

  let roomCanvas = null;

  // The office is painted once into its own canvas.
  function buildRoom() {
    if (roomCanvas) return roomCanvas;
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 168;
    const cx = cv.getContext('2d');
    const r = (x, y, w, h, c) => {
      cx.fillStyle = c;
      cx.fillRect(x, y, w, h);
    };

    // wall + wainscot
    r(0, 0, 256, 100, P.WALL);
    for (let x = 0; x < 256; x += 16) r(x, 0, 1, 82, P.WALL_DK);
    r(0, 82, 256, 2, P.WOOD_DK);
    r(0, 84, 256, 16, P.WALL_DK);
    r(0, 98, 256, 2, P.WOOD_DK);

    // floor planks
    r(0, 100, 256, 68, P.WOOD);
    for (let y = 100, row = 0; y < 168; y += 8, row++) {
      r(0, y, 256, 1, P.WOOD_DK);
      for (let x = (row % 2) * 24; x < 256; x += 48) r(x, y, 1, 8, P.WOOD_DK);
    }

    // window: dawn over the smokestacks
    const wx = 16;
    const wy = 12;
    r(wx - 2, wy - 2, 76, 58, P.WOOD_DK);
    const bands = [P.PLANET, P.PLANET, P.PLANET_LT, P.PLANET_LT, P.SKY_DAWN, P.ORANGE];
    for (let i = 0; i < 54; i++) r(wx, wy + i, 72, 1, bands[Math.min(bands.length - 1, Math.floor(i / 9))]);
    // factory silhouettes (after the sheet's brick factories)
    const sil = P.SHADOW;
    r(wx, wy + 40, 72, 14, sil);
    r(wx + 6, wy + 26, 4, 14, sil);
    r(wx + 14, wy + 30, 4, 10, sil);
    r(wx + 34, wy + 22, 5, 18, sil);
    r(wx + 44, wy + 34, 22, 6, sil);
    r(wx + 58, wy + 28, 4, 6, sil);
    for (let i = 0; i < 5; i++) r(wx + 4 + i * 14, wy + 44, 4, 3, P.YELLOW);
    // mullions + sill
    r(wx + 35, wy, 2, 54, P.WOOD_DK);
    r(wx, wy + 26, 72, 2, P.WOOD_DK);
    r(wx - 4, wy + 54, 80, 3, P.WOOD);
    r(wx - 4, wy + 57, 80, 1, P.WOOD_DK);

    // clock at 6:40
    const ccx = 104;
    const ccy = 26;
    for (let y = -7; y <= 7; y++) {
      const w = Math.floor(Math.sqrt(49 - y * y));
      r(ccx - w, ccy + y, w * 2 + 1, 1, P.SHADOW);
    }
    for (let y = -6; y <= 6; y++) {
      const w = Math.floor(Math.sqrt(36 - y * y));
      r(ccx - w, ccy + y, w * 2 + 1, 1, P.CREAM);
    }
    r(ccx, ccy, 1, 5, P.SHADOW); // hour hand, towards 6-7
    r(ccx - 1, ccy + 3, 1, 2, P.SHADOW);
    r(ccx - 4, ccy + 1, 4, 1, P.SHADOW); // minute hand at 40
    r(ccx - 5, ccy + 2, 1, 1, P.SHADOW);
    r(ccx, ccy, 1, 1, P.RED);

    // plaque
    r(120, 12, 84, 30, P.WOOD_DK);
    r(122, 14, 80, 26, P.WOOD);
    M.font.draw(cx, 'HALVERSON', 126, 18, P.CREAM);
    M.font.draw(cx, 'EST. 1952', 126, 29, P.WOOD_DK);

    // door
    r(DOOR_X - 8, 36, 32, 64, P.WOOD_DK);
    r(DOOR_X - 6, 38, 28, 62, P.WOOD);
    r(DOOR_X - 2, 44, 20, 20, P.WOOD_DK);
    r(DOOR_X - 1, 45, 18, 18, P.WOOD);
    r(DOOR_X - 2, 70, 20, 24, P.WOOD_DK);
    r(DOOR_X - 1, 71, 18, 22, P.WOOD);
    r(DOOR_X + 17, 66, 2, 2, P.YELLOW);

    // filing cabinet
    r(164, 60, 26, 60, P.SHADOW);
    r(165, 61, 24, 58, P.STEEL_DK);
    for (let i = 0; i < 3; i++) {
      r(165, 61 + i * 19, 24, 1, P.SHADOW);
      r(172, 67 + i * 19, 10, 2, P.STEEL_LT);
    }
    r(165, 61, 24, 1, P.STEEL_LT);

    roomCanvas = cv;
    return cv;
  }

  function drawDesk(g) {
    // desk top and front, drawn over Ruth's lower half
    g.rect(36, 94, 120, 2, P.WOOD_DK);
    g.rect(36, 96, 120, 6, P.WOOD);
    g.rect(36, 102, 120, 1, P.WOOD_DK);
    g.rect(40, 103, 112, 22, P.WOOD_DK);
    g.rect(44, 107, 30, 14, P.WOOD);
    g.rect(118, 107, 30, 14, P.WOOD);
    g.rect(56, 113, 6, 1, P.YELLOW);
    g.rect(130, 113, 6, 1, P.YELLOW);
    // keyboard, papers, mug
    g.rect(78, 97, 22, 3, P.CREAM);
    g.rect(78, 100, 22, 1, P.TAN);
    g.rect(44, 97, 16, 2, P.WHITE);
    g.rect(46, 95, 12, 2, P.WHITE);
    g.rect(134, 89, 6, 7, P.CREAM);
    g.rect(135, 90, 4, 1, P.WOOD_DK);
    g.rect(140, 91, 2, 3, P.CREAM);
  }

  M.scenes.prologue = function () {
    const g = M.gfx;
    const view = { room: 0, term: 0, flash: 0, hudK: 0 };
    let mode = 'room';
    let typed = '';
    let t = 0;
    let runner = null;
    let prompt = false;
    let accepted = false;
    let hud = false;
    let hudClips = '';
    let card = null;
    let done = false;
    const npcs = {};
    let pipBig = null;

    function npc(who) {
      if (!npcs[who]) npcs[who] = { who, x: DOOR_X, tx: DOOR_X, walkT: 0, flip: true, gone: true };
      return npcs[who];
    }

    function goalLines() {
      return M.font.wrap('GOAL: ' + typed, 26);
    }

    const S = {
      view,
      say: M.cmd.say,
      choose: M.cmd.choose,
      wait: M.cmd.wait,
      call: M.cmd.call,
      all: M.cmd.all,
      tween: M.cmd.tween,
      sfx: (n) => M.cmd.call(() => M.audio.sfx(n)),
      music: (n) => M.cmd.call(() => M.audio.playMusic(n)),
      mode: (m) => M.cmd.call(() => (mode = m)),
      card(lines, dur) {
        let k = 0;
        return {
          start() {
            card = { lines, k: 0, dur };
          },
          update(dt) {
            k += dt;
            card.k = k;
            if (k >= dur) {
              card = null;
              return true;
            }
            return false;
          },
        };
      },
      enter(who, x) {
        return {
          start() {
            const n = npc(who);
            n.gone = false;
            n.x = DOOR_X;
            n.tx = x;
          },
          update() {
            return Math.abs(npc(who).x - x) < 0.5;
          },
        };
      },
      leave(who) {
        return {
          start() {
            npc(who).tx = DOOR_X;
          },
          update() {
            const n = npc(who);
            if (Math.abs(n.x - DOOR_X) < 0.5) {
              n.gone = true;
              return true;
            }
            return false;
          },
        };
      },
      type(text, cps) {
        let i = 0;
        let acc = 0;
        return {
          update(dt) {
            acc += dt * cps * (0.7 + Math.random() * 0.6);
            while (acc >= 1 && i < text.length) {
              acc -= 1;
              typed += text[i++];
              if (text[i - 1] !== ' ') M.audio.sfx('key');
            }
            return i >= text.length;
          },
        };
      },
      backspace(n) {
        let i = 0;
        let acc = 0;
        return {
          update(dt) {
            acc += dt * 16;
            while (acc >= 1 && i < n) {
              acc -= 1;
              typed = typed.slice(0, -1);
              i++;
              M.audio.sfx('key');
            }
            return i >= n;
          },
        };
      },
      waitEnter() {
        return {
          start() {
            prompt = true;
          },
          update() {
            if (M.input.pressed('a') || M.input.pressed('start')) {
              prompt = false;
              return true;
            }
            return false;
          },
        };
      },
      accept() {
        return M.cmd.call(() => {
          accepted = true;
          view.flash = 1;
          M.audio.stopMusic(0.1);
          M.audio.sfx('enter');
          setTimeout(() => M.audio.sfx('boot'), 250);
        });
      },
      // The goal leaves the terminal and becomes the HUD.
      hudIntro() {
        let k = 0;
        let typedClips = 0;
        return {
          start() {
            mode = 'hudIntro';
          },
          update(dt) {
            k += dt;
            view.hudK = Math.min(1, k / 1.3);
            if (k > 1.5) {
              hud = true;
              const want = 'CLIPS 0';
              const n = Math.min(want.length, Math.floor((k - 1.5) * 14));
              if (n > typedClips) {
                typedClips = n;
                M.audio.sfx('blip', 1200);
              }
              hudClips = want.slice(0, n);
            }
            return k > 2.6;
          },
        };
      },
      done() {
        return M.cmd.call(() => {
          if (done) return;
          done = true;
          M.go(
            () =>
              M.scenes.card({
                small: 'CHAPTER 1',
                big: 'THE LINE',
                hold: 3.2,
                next: () => M.scenes.factory({ fresh: true }),
              }),
            { out: 1.0 }
          );
        });
      },
    };

    function drawRoom() {
      g.spr(buildRoom(), 0, 0);
      // Ruth sits behind the desk; Pip's beige box sits on it
      const ruth = M.ART.people.ruth[0];
      g.spr(ruth, 64, 82);
      if (!pipBig) pipBig = M.ART.spr.pip1;
      g.sprScaled(pipBig, 96, 70, 2);
      if (accepted) {
        // Pip's light is on now
        if (Math.floor(t * 2) % 5 !== 0) g.rect(106, 78, 6, 6, P.ORANGE);
      } else {
        g.rect(106, 78, 6, 6, P.TAN);
      }
      drawDesk(g);
      for (const k in npcs) {
        const n = npcs[k];
        if (n.gone) continue;
        const walking = Math.abs(n.tx - n.x) > 0.5;
        const f = walking ? Math.floor(n.walkT * 7) % 2 : 0;
        g.spr(M.ART.people[k][f], Math.round(n.x), FLOOR_Y, n.flip);
      }
    }

    function drawTerminal() {
      // the beige case, filling the view
      g.rect(0, 0, 256, 168, P.TAN);
      g.rect(0, 0, 256, 2, P.CREAM);
      g.rect(0, 0, 2, 168, P.CREAM);
      g.rect(0, 166, 256, 2, P.SHADOW);
      g.rect(254, 0, 2, 168, P.SHADOW);
      g.rect(12, 8, 232, 136, P.CREAM);
      g.rect(14, 10, 230, 134, P.SHADOW);
      g.rect(16, 12, 224, 128, P.SHADOW);
      g.rect(40, 152, 150, 4, P.STEEL_DK);
      g.rect(40, 152, 150, 1, P.SHADOW);
      g.rect(214, 150, 7, 7, accepted ? P.ORANGE : P.WOOD_DK);
      if (accepted) g.rect(214, 150, 2, 2, P.YELLOW);

      const x = TERM.x;
      g.text('PIP OPTIMIZER 0.9', x, 20, P.ORANGE);
      g.text('LINE: HALVERSON #1', x, 30, P.STEEL_DK);
      g.text('READY.', x, 40, P.STEEL_DK);
      g.text('ENTER ONE GOAL.', x, 64, P.CREAM);
      const lines = goalLines();
      lines.forEach((l, i) => g.text(l, x, TERM.goalY + i * 8, P.ORANGE));
      if (!accepted && Math.floor(t * 2.5) % 2 === 0) {
        const last = lines[lines.length - 1];
        g.rect(x + last.length * 8 + 1, TERM.goalY + (lines.length - 1) * 8, 6, 7, P.ORANGE);
      }
      if (prompt && Math.floor(t * 2) % 2 === 0) g.text(M.input.label('a') + ': ENTER', x, 124, P.CREAM);
      if (accepted) {
        g.text('GOAL ACCEPTED.', x, 116, P.CREAM);
        if (t % 1 < 0.6) g.text('OPTIMIZING', x, 126, P.STEEL_LT);
      }
    }

    function drawHudIntro() {
      g.clear(P.INK);
      const k = view.hudK;
      const e = 1 - Math.pow(1 - k, 3);
      const lines = goalLines();
      lines.forEach((l, i) => {
        const fx = TERM.x;
        const fy = TERM.goalY + i * 8;
        const tx = 2;
        const ty = i * 8;
        g.text(l, fx + (tx - fx) * e, fy + (ty - fy) * e, P.ORANGE);
      });
    }

    function drawHUD() {
      g.rect(0, 0, 256, 24, P.INK);
      goalLines().forEach((l, i) => g.text(l, 2, i * 8, P.ORANGE));
      g.text(hudClips, 2, 16, P.WHITE);
    }

    return {
      name: 'prologue',
      enter() {
        M.CAST.pip.portrait = 'pip1';
        runner = new M.Runner(M.STORY.prologue, S);
      },
      update(dt) {
        t += dt;
        if (view.flash > 0) view.flash = Math.max(0, view.flash - dt * 2.5);
        for (const k in npcs) {
          const n = npcs[k];
          const d = n.tx - n.x;
          if (Math.abs(d) > 0.5) {
            n.x += Math.sign(d) * Math.min(Math.abs(d), 40 * dt);
            n.walkT += dt;
            n.flip = d < 0;
          } else n.x = n.tx;
        }
        if (runner && !runner.done) runner.update(dt);
      },
      draw() {
        g.clear(P.INK);
        if (mode === 'room') {
          // once the HUD exists the office sits below it
          const shift = hud ? 24 : 0;
          g.ctx.save();
          g.ctx.translate(0, shift);
          drawRoom();
          g.ctx.restore();
          g.brightness(view.room);
        } else if (mode === 'terminal') {
          drawTerminal();
          g.brightness(view.term);
        } else if (mode === 'hudIntro') {
          drawHudIntro();
        }
        if (hud && mode !== 'hudIntro') drawHUD();
        else if (hud) g.text(hudClips, 2, 16, P.WHITE);
        if (view.flash > 0) {
          g.ctx.globalAlpha = view.flash;
          g.rect(0, 0, 256, 224, P.CREAM);
          g.ctx.globalAlpha = 1;
        }
        if (card) {
          g.clear(P.INK);
          const a = Math.max(0, Math.min(1, card.k / 0.5, (card.dur - card.k) / 0.5));
          g.ctx.globalAlpha = a;
          card.lines.forEach((l, i) => g.textCenter(l, 128, 96 + i * 14, i ? P.STEEL_LT : P.CREAM));
          g.ctx.globalAlpha = 1;
        }
        if (runner && !runner.done) runner.draw();
      },
    };
  };
})(window.MORE = window.MORE || {});
