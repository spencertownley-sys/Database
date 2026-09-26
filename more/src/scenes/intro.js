// MORE. — boot screen, voicemail cold open, title, title cards
(function (M) {
  'use strict';

  const P = M.PAL;
  const G = () => M.gfx;

  // Small deterministic RNG so starfields and planets look the same every time.
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function route(start) {
    switch (start) {
      case 'title':
        return M.scenes.title();
      case 'prologue':
        return M.scenes.prologue();
      case 'factory':
        return M.scenes.factory({ fresh: true });
      case 'night':
        return M.scenes.factory({ debugNight: true });
      case 'end':
        return M.scenes.chapterEnd({ clips: 1024 });
      case 'sandbox':
        return M.scenes.factory({ sandbox: true });
      case 'mockup':
        return M.scenes.factory({ mockup: true });
      default:
        return M.scenes.coldOpen();
    }
  }

  // --- boot: "press start" (browsers need a gesture before audio) ------------
  M.scenes.boot = function (start) {
    let t = 0;
    return {
      name: 'boot',
      update(dt) {
        t += dt;
        if (t > 0.3 && (M.input.any || M.pointerTapped)) {
          M.pointerTapped = false;
          M.audio.unlock();
          M.audio.sfx('confirm');
          M.go(() => route(start), { out: 0.5 });
        }
      },
      draw() {
        const g = G();
        g.clear(P.INK);
        if (Math.floor(t * 2) % 2 === 0) g.textCenter('PRESS START', 128, 84, P.CREAM);
        g.textCenter('HEADPHONES ON', 128, 100, P.GRID);
        const rows = [
          ['ARROWS', 'MOVE'],
          ['Z', 'A  CONFIRM'],
          ['X', 'B  BACK'],
          ['SHIFT', 'SELECT'],
          ['ENTER', 'START'],
        ];
        rows.forEach((r, i) => {
          g.textRight(r[0], 116, 136 + i * 11, P.STEEL_DK);
          g.text(r[1], 132, 136 + i * 11, P.STEEL_LT);
        });
        g.textCenter('M MUTE   F FULLSCREEN', 128, 200, P.GRID);
      },
    };
  };

  // --- cold open: the voicemail --------------------------------------------------------
  function makePlanet(seed, n) {
    const r = rng(seed);
    const pts = [];
    for (let i = 0; i < n; i++) {
      pts.push({ lon: r() * Math.PI * 2, lat: Math.asin(r() * 2 - 1), dash: r() < 0.5, lit: r() < 0.04 });
    }
    return pts;
  }

  function drawPlanet(cx, cy, rad, rot, pts, t) {
    const g = G();
    // body, one span per row for a clean pixel circle
    for (let y = -rad; y <= rad; y++) {
      const w = Math.floor(Math.sqrt(rad * rad - y * y));
      g.rect(cx - w, cy + y, w * 2 + 1, 1, P.PLANET);
    }
    // lit limb
    for (let y = -rad; y <= rad; y++) {
      const w = Math.floor(Math.sqrt(rad * rad - y * y));
      if (y < rad * 0.6) g.rect(cx - w, cy + y, 1, 1, P.PLANET_LT);
    }
    for (const p of pts) {
      const a = p.lon + rot;
      const z = Math.cos(p.lat) * Math.cos(a);
      if (z <= 0.05) continue;
      const x = Math.round(cx + rad * Math.cos(p.lat) * Math.sin(a));
      const y = Math.round(cy - rad * Math.sin(p.lat));
      if (p.lit) {
        if (Math.floor(t * 2 + p.lon * 5) % 3 !== 0) g.rect(x, y, 1, 1, P.ORANGE);
        continue;
      }
      const col = z > 0.45 ? P.WHITE : P.STEEL_DK;
      g.rect(x, y, p.dash && z > 0.3 ? 2 : 1, 1, col);
    }
  }

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  M.scenes.coldOpen = function () {
    const V = M.VOICEMAIL;
    const pts = makePlanet(7, 520);
    const r = rng(3);
    const stars = Array.from({ length: 70 }, () => ({ x: Math.floor(r() * 256), y: Math.floor(r() * 120), p: r() * 6 }));
    let t = 0;
    let phase = 'ring';
    let playT = 0;
    let usedAudio = false;
    let waitT = 0;
    let endT = 0;
    let beeps = 0;

    function finish() {
      M.audio.voicemail.stop();
      phase = 'done';
      M.go(() => M.scenes.title(), { out: 1.4, in: 1.0 });
    }

    return {
      name: 'coldOpen',
      update(dt) {
        t += dt;
        if (phase !== 'done' && t > 0.5 && M.input.pressed('start')) {
          finish();
          return;
        }
        if (phase === 'ring') {
          if (beeps === 0 && t > 0.8) {
            M.audio.sfx('phoneBeep');
            beeps++;
          }
          if (beeps === 1 && t > 1.4) {
            M.audio.sfx('phoneBeep');
            beeps++;
          }
          if (t > 2.6) phase = 'wait';
        } else if (phase === 'wait') {
          waitT += dt;
          if (M.audio.voicemail.ready && M.audio.voicemail.play()) {
            usedAudio = true;
            phase = 'play';
          } else if (waitT > 2.5) {
            phase = 'play';
          }
        } else if (phase === 'play') {
          playT = usedAudio ? M.audio.voicemail.time : playT + dt;
          if (playT > V.duration + 0.3) {
            phase = 'after';
            endT = 0;
          }
        } else if (phase === 'after') {
          endT += dt;
          if (endT > 2.2) finish();
        }
      },

      draw() {
        const g = G();
        g.clear(P.INK);
        for (const s of stars) {
          if (Math.floor(t * 1.5 + s.p) % 5 !== 0) g.rect(s.x, s.y, 1, 1, (s.p | 0) % 2 ? P.GRID : P.STEEL_DK);
        }
        drawPlanet(128, 64, 42, t * 0.05, pts, t);

        // phone card
        const x = 40;
        const y = 122;
        g.box(x, y, 176, 38);
        g.text('VOICEMAIL', x + 9, y + 8, P.STEEL_LT);
        g.textRight(V.from, x + 167, y + 8, P.CREAM);
        const dur = V.duration;
        const cur = phase === 'play' ? playT : phase === 'after' || phase === 'done' ? dur : 0;
        if (phase === 'ring' || phase === 'wait') {
          if (Math.floor(t * 2.5) % 2 === 0) g.text('1 NEW MESSAGE', x + 9, y + 22, P.ORANGE);
        } else {
          g.text(fmtTime(cur), x + 9, y + 22, P.CREAM);
          const bx = x + 50;
          const bw = 76;
          g.rect(bx, y + 25, bw, 2, P.GRID);
          const fw = Math.round((bw * Math.min(cur, dur)) / dur);
          g.rect(bx, y + 25, fw, 2, P.ORANGE);
          g.rect(bx + fw - 1, y + 23, 3, 6, P.YELLOW);
          g.textRight(fmtTime(dur), x + 167, y + 22, P.STEEL_DK);
        }

        // captions
        if (phase === 'play') {
          let cap = null;
          for (const c of V.captions) if (playT >= c.t && playT < c.end + 0.25) cap = c;
          if (cap) {
            const n = Math.floor((playT - cap.t) * 45);
            const lines = M.font.wrap(cap.text, 30);
            let left = n;
            lines.forEach((l, i) => {
              const shown = l.slice(0, Math.max(0, left));
              left -= l.length;
              const w = l.length * 8;
              g.text(shown, 128 - w / 2, 180 + i * 12, P.CREAM);
            });
          }
        }
        if (phase !== 'done' && t > 3) g.textRight('START SKIP', 250, 212, P.GRID);
      },
    };
  };

  // --- title ------------------------------------------------------------------------
  M.scenes.title = function () {
    let t = 0;
    let sel = 0;
    let confirming = false;
    let confirmSel = 1;
    const save = M.save.load();
    const r = rng(11);
    const dimClip = M.gfx.make(M.ART.src.clip, { W: P.FLOOR, ',': P.SHADOW });
    const drift = Array.from({ length: 22 }, () => ({ x: r() * 256, y: r() * 224, v: 3 + r() * 6, flip: r() < 0.5 }));
    const items = () => [
      { id: 'new', label: 'NEW GAME' },
      { id: 'cont', label: 'CONTINUE', off: !save },
      { id: 'sound', label: 'SOUND ' + (M.audio.muted ? 'OFF' : 'ON') },
    ];
    if (save) sel = 1;

    function begin() {
      M.save.clear();
      M.audio.stopMusic(0.8);
      M.go(() => M.scenes.prologue(), { out: 0.8 });
    }

    function cont() {
      M.audio.stopMusic(0.8);
      const s = M.save.load();
      if (s && s.chapter1Done) M.go(() => M.scenes.factory({ sandbox: true, save: s }), { out: 0.8 });
      else if (s && s.chapter === 1) M.go(() => M.scenes.factory({ save: s }), { out: 0.8 });
      else M.go(() => M.scenes.prologue(), { out: 0.8 });
    }

    return {
      name: 'title',
      enter() {
        M.audio.playMusic('title');
      },
      update(dt) {
        t += dt;
        for (const d of drift) {
          d.y += d.v * dt;
          if (d.y > 230) {
            d.y = -10;
            d.x = Math.random() * 256;
          }
        }
        const I = M.input;
        if (confirming) {
          if (I.repeat('up') || I.repeat('down')) {
            confirmSel = 1 - confirmSel;
            M.audio.sfx('cursor');
          }
          if (I.pressed('b')) {
            confirming = false;
            M.audio.sfx('cancel');
          }
          if (I.pressed('a') || I.pressed('start')) {
            if (confirmSel === 0) {
              M.audio.sfx('confirm');
              begin();
            } else {
              confirming = false;
              M.audio.sfx('cancel');
            }
          }
          return;
        }
        const list = items();
        if (I.repeat('up')) {
          do sel = (sel + list.length - 1) % list.length;
          while (list[sel].off);
          M.audio.sfx('cursor');
        }
        if (I.repeat('down')) {
          do sel = (sel + 1) % list.length;
          while (list[sel].off);
          M.audio.sfx('cursor');
        }
        if (I.pressed('a') || I.pressed('start')) {
          const it = list[sel];
          if (it.id === 'new') {
            if (save) {
              confirming = true;
              confirmSel = 1;
              M.audio.sfx('cursor');
            } else {
              M.audio.sfx('confirm');
              begin();
            }
          } else if (it.id === 'cont') {
            M.audio.sfx('confirm');
            cont();
          } else if (it.id === 'sound') {
            M.audio.setMuted(!M.audio.muted);
            M.audio.sfx('cursor');
          }
        }
      },
      draw() {
        const g = G();
        g.clear(P.SHADOW);
        for (const d of drift) g.spr(dimClip, d.x, d.y, d.flip);

        g.text('MORE', 48, 48, P.CREAM, 4);
        if (t % 1.1 < 0.7) g.text('.', 176, 48, P.ORANGE, 4);

        const list = items();
        list.forEach((it, i) => {
          const y = 116 + i * 14;
          const on = i === sel && !confirming;
          const col = it.off ? P.GRID : on ? P.ORANGE : P.CREAM;
          if (on) g.text('▶', 80, y, P.ORANGE);
          g.text(it.label, 94, y, col);
        });

        g.textCenter("AFTER NICK BOSTROM'S", 128, 194, P.GRID);
        g.textCenter('PAPERCLIP MAXIMIZER', 128, 205, P.GRID);

        if (confirming) {
          g.box(48, 100, 160, 56);
          g.textCenter('ERASE SAVE AND', 128, 110, P.CREAM);
          g.textCenter('START OVER?', 128, 121, P.CREAM);
          ['YES', 'NO'].forEach((l, i) => {
            const y = 136;
            const x = i === 0 ? 84 : 148;
            if (i === confirmSel) g.text('▶', x - 12, y, P.ORANGE);
            g.text(l, x, y, i === confirmSel ? P.ORANGE : P.CREAM);
          });
        }
      },
    };
  };

  // --- title card ("CHAPTER 1 / THE LINE") --------------------------------------------
  M.scenes.card = function (opts) {
    let t = 0;
    let leaving = false;
    return {
      name: 'card',
      enter() {
        if (opts.sfx) M.audio.sfx(opts.sfx);
      },
      update(dt) {
        t += dt;
        if (leaving) return;
        if (t > (opts.hold || 3) || (t > 0.8 && M.input.pressed('a'))) {
          leaving = true;
          M.go(opts.next, { out: 0.6 });
        }
      },
      draw() {
        const g = G();
        g.clear(P.INK);
        if (opts.small) g.textCenter(opts.small, 128, 84, P.STEEL_DK);
        if (opts.big && t > 0.4) g.textCenter(opts.big, 128, 100, P.CREAM, 2);
        if (opts.sub && t > 1.0) g.textCenter(opts.sub, 128, 130, P.ORANGE);
      },
    };
  };

  M.drawPlanet = drawPlanet;
  M.makePlanet = makePlanet;
  M.rng = rng;
})(window.MORE = window.MORE || {});
