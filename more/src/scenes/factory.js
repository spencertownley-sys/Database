// MORE. — Chapter 1: the factory floor
// The screen from the mockup: HUD, an 8x4 grid of 24px cells, four machines,
// belts laid by Pip's drone, and the dialog window. Wire flows
// spool > cutter > bender > box and every clip that reaches a box counts.
(function (M) {
  'use strict';

  const P = M.PAL;
  const GX = 32;
  const GY = 48;
  const CELL = 24;
  const COLS = 8;
  const ROWS = 4;
  const DX = [0, 1, 0, -1];
  const DY = [-1, 0, 1, 0];
  const DIRBTN = ['up', 'right', 'down', 'left'];
  const opp = (d) => (d + 2) % 4;

  const BELT_SPEED = 2.0; // cells per second
  const GAP = 0.45; // minimum spacing between items, in cells

  const MACH = {
    spool: { name: 'SPOOL', period: 0.5, makes: 'wire', info: 'SPOOL: MAKES WIRE' },
    cutter: { name: 'CUTTER', period: 0.5, takes: 'wire', makes: 'cut', info: 'CUTTER: WIRE > PIECES' },
    bender: { name: 'BENDER', period: 0.8, takes: 'cut', makes: 'clip', info: 'BENDER: PIECES > CLIPS' },
    box: { name: 'BOX', sink: true, takes: 'clip', info: 'BOX: COUNTS CLIPS' },
  };

  // Where the old line's machines sit (matches the mockup).
  const START_LAYOUT = [
    ['spool', 0, 0],
    ['cutter', 4, 1],
    ['bender', 2, 3],
    ['box', 7, 3],
  ];

  const MOCK_BELTS = [
    [1, 0, 1], [2, 0, 2], [2, 1, 1], [3, 1, 1], [5, 1, 2], [5, 2, 3], [4, 2, 3], [3, 2, 3], [2, 2, 3],
    [1, 2, 3], [0, 2, 2], [0, 3, 1], [1, 3, 1], [3, 3, 1], [4, 3, 1], [5, 3, 1], [6, 3, 1],
  ];

  const fmt = (n) => Math.floor(n).toLocaleString('en-US');

  // --- static art -------------------------------------------------------------------
  let floorCanvas = null;
  function buildFloor() {
    if (floorCanvas) return floorCanvas;
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 144;
    const cx = cv.getContext('2d');
    cx.fillStyle = P.FLOOR;
    cx.fillRect(0, 0, 256, 144);
    // 16x16 speck tile, sampled from the mockup floor
    cx.fillStyle = P.GRID;
    for (let ty = 0; ty < 224; ty += 16) {
      for (let tx = 0; tx < 256; tx += 16) {
        for (const [sx, sy, h] of [
          [10, 3, 1],
          [8, 9, 2],
          [2, 12, 1],
        ]) {
          const y = ty + sy - 24;
          if (y >= 0 && y < 144) cx.fillRect(tx + sx, y, 1, h);
        }
      }
    }
    // cell outlines (adjacent cells make the 2px lines)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = GX + c * CELL;
        const y = GY + r * CELL - 24;
        cx.fillRect(x, y, CELL, 1);
        cx.fillRect(x, y + CELL - 1, CELL, 1);
        cx.fillRect(x, y, 1, CELL);
        cx.fillRect(x + CELL - 1, y, 1, CELL);
      }
    }
    floorCanvas = cv;
    return cv;
  }

  function transpose(rows) {
    const h = rows.length;
    const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const out = [];
    for (let x = 0; x < w; x++) {
      let s = '';
      for (let y = 0; y < h; y++) s += rows[y][x] || '.';
      out.push(s);
    }
    return out;
  }

  let itemArt = null;
  function buildItems() {
    if (itemArt) return itemArt;
    const S = M.ART.src;
    const mk = (r) => M.gfx.make(r);
    itemArt = {
      wire: { h: mk(S.wire), v: mk(transpose(S.wire)) },
      cut: { h: mk(S.cut), v: mk(transpose(S.cut)) },
      cutSmall: { h: mk(S.cutSmall), v: mk(transpose(S.cutSmall)) },
      clip: { h: mk(S.clip), v: mk(transpose(S.clip)) },
      clipSmall: { h: mk(S.clipSmall), v: mk(transpose(S.clipSmall)) },
      ghost: {},
    };
    return itemArt;
  }

  // --- belt rendering (procedural, matches the mockup's belts) ---------------------------
  function beltColor(coord, sign, off) {
    return (((coord - sign * off) % 4) + 4) % 4 < 2 ? P.STEEL_LT : P.STEEL_DK;
  }

  function drawHalf(g, x0, y0, side, moveDir, off) {
    const sign = moveDir === 1 || moveDir === 2 ? 1 : -1;
    if (side === 1 || side === 3) {
      const xs = side === 1 ? x0 + 12 : x0;
      g.rect(xs, y0 + 6, 12, 1, P.SHADOW);
      g.rect(xs, y0 + 17, 12, 1, P.SHADOW);
      for (let x = xs; x < xs + 12; x++) g.rect(x, y0 + 7, 1, 10, beltColor(x, sign, off));
    } else {
      const ys = side === 2 ? y0 + 12 : y0;
      g.rect(x0 + 6, ys, 1, 12, P.SHADOW);
      g.rect(x0 + 17, ys, 1, 12, P.SHADOW);
      for (let y = ys; y < ys + 12; y++) g.rect(x0 + 7, y, 10, 1, beltColor(y, sign, off));
    }
  }

  function drawJunction(g, x0, y0) {
    const x = x0 + 6;
    const y = y0 + 6;
    g.outline(x, y, 12, 12, P.SHADOW);
    for (let r = 0; r < 10; r++) {
      const pat = (r + 1) % 4 < 2;
      for (let c = 0; c < 10; c++) {
        const col = pat && (c % 4 === 0 || c % 4 === 3) ? P.STEEL_DK : P.STEEL_LT;
        g.rect(x + 1 + c, y + 1 + r, 1, 1, col);
      }
    }
  }

  // --- the scene ------------------------------------------------------------------------
  M.scenes.factory = function (opts) {
    opts = opts || {};
    const g = M.gfx;
    const I = M.input;
    const story = M.STORY.ch1;
    const saved = opts.save || null;

    const st = {
      clips: 0,
      time: 0,
      flags: {},
      inv: { cutter: 0, bender: 0 },
      tool: 'belt',
      facing: 1,
      shorter: false,
      powered: true,
      night: 0,
      goalBlink: 0,
      fasterAsked: 0,
      nextFaster: 0,
      sandbox: !!opts.sandbox,
      chapter1Done: false,
      clipTimes: [],
      jams: {},
      boxCount: 0,
    };

    const cells = new Array(COLS * ROWS).fill(null);
    const at = (c, r) => (c < 0 || r < 0 || c >= COLS || r >= ROWS ? undefined : cells[r * COLS + c]);
    const put = (c, r, v) => {
      cells[r * COLS + c] = v;
    };

    function newMachine(kind, fixed) {
      return { t: 'm', kind, fixed, inBuf: 0, busy: 0, timer: 0, out: [], rr: 0, frame: 0, flash: 0, count: 0 };
    }

    START_LAYOUT.forEach(([k, c, r]) => put(c, r, newMachine(k, true)));

    // restore
    if (saved) {
      Object.assign(st, {
        clips: saved.clips || 0,
        flags: saved.flags || {},
        inv: saved.inv || { cutter: 0, bender: 0 },
        shorter: !!saved.shorter,
        fasterAsked: saved.fasterAsked || 0,
        nextFaster: saved.nextFaster || 0,
        chapter1Done: !!saved.chapter1Done,
        boxCount: saved.clips || 0,
      });
      for (const e of saved.layout || []) {
        if (e.t === 'belt') put(e.c, e.r, { t: 'belt', dir: e.dir, items: [] });
        else if (e.t === 'm' && !e.fixed) put(e.c, e.r, newMachine(e.kind, false));
      }
    }
    if (opts.debugNight || opts.mockup) {
      // The belt route drawn in the mockup.
      MOCK_BELTS.forEach(([c, r, d]) => put(c, r, { t: 'belt', dir: d, items: [] }));
    }
    if (opts.debugNight) {
      st.clips = story.quotas.whistle - 3;
      Object.assign(st.flags, { intro: true, firstClip: true, walt: true, faster: true, ruth: true });
      st.shorter = true;
    }
    if (opts.mockup) {
      st.clips = 1204;
      st.flags = { intro: true, firstClip: true, walt: true };
    }
    if (st.sandbox || st.chapter1Done) {
      st.sandbox = true;
      st.night = 0.45;
      M.CAST.pip.portrait = 'pip2';
    } else {
      M.CAST.pip.portrait = 'pip1';
    }

    const drone = { c: 2, r: 1, x: 0, y: 0, move: null, queued: -1, blink: 0 };
    // For playtesting from the console: MORE.debug.factory.st.clips = 199
    M.debug = M.debug || {};
    M.debug.factory = { st, cells };
    const cellCenter = (c, r) => [GX + c * CELL + 12, GY + r * CELL + 12];
    [drone.x, drone.y] = cellCenter(drone.c, drone.r);

    const npcs = {};
    const toasts = [];
    let runner = null;
    let beat = null;
    let repeatBeat = false;
    let pendingRotate = false;
    let beltOff = 0;
    let pause = null;
    let saveT = 0;
    let idleT = 0;
    let t = 0;
    let ended = false;

    // --- helpers ---------------------------------------------------------------------
    function toast(text, color) {
      toasts.push({ text, color: color || P.ORANGE, t: 0 });
    }

    function serialize() {
      const layout = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const e = at(c, r);
          if (!e) continue;
          if (e.t === 'belt') layout.push({ c, r, t: 'belt', dir: e.dir });
          else if (!e.fixed) layout.push({ c, r, t: 'm', kind: e.kind });
        }
      }
      return layout;
    }

    function save() {
      if (opts.debugNight) return;
      M.save.write({
        chapter: 1,
        clips: st.clips,
        flags: st.flags,
        inv: st.inv,
        shorter: st.shorter,
        fasterAsked: st.fasterAsked,
        nextFaster: st.nextFaster,
        chapter1Done: st.chapter1Done,
        layout: serialize(),
      });
    }

    function tools() {
      const list = ['belt'];
      if (st.inv.cutter > 0) list.push('cutter');
      if (st.inv.bender > 0) list.push('bender');
      return list;
    }

    function placeBelt(c, r, dir) {
      put(c, r, { t: 'belt', dir, items: [] });
      M.audio.sfx('belt');
    }

    // Does any neighbouring belt flow into this one?
    function hasBeltInput(c, r, b) {
      for (let d = 0; d < 4; d++) {
        if (d === b.dir) continue;
        const n = at(c + DX[d], r + DY[d]);
        if (n && n.t === 'belt' && n.dir === opp(d)) return true;
      }
      return false;
    }

    // A machine feeds a neighbouring belt only when that belt starts at the
    // machine: it doesn't point into the machine and nothing else flows into it.
    // Belts that merely pass by a machine are left alone (as in the mockup).
    function machineFeeds(m, bc, br, b, sideToMachine) {
      return !!m && m.t === 'm' && !MACH[m.kind].sink && b.dir !== sideToMachine && !hasBeltInput(bc, br, b);
    }

    // Can this belt take a new item at its entry right now?
    function hasRoom(b) {
      const last = b.items[b.items.length - 1];
      return !last || last.p >= GAP;
    }

    // --- simulation ------------------------------------------------------------------------
    function machineAccept(m, it) {
      const def = MACH[m.kind];
      if (def.sink) {
        if (it.k !== 'clip') return 'jam:box:' + it.k;
        st.clips++;
        st.boxCount++;
        m.flash = 0.12;
        st.clipTimes.push(st.time);
        M.audio.sfx('clip');
        return true;
      }
      if (!def.takes) return 'jam:spool';
      if (it.k !== def.takes) return 'jam:' + m.kind + ':' + it.k;
      if (m.inBuf >= 2) return false;
      m.inBuf++;
      return true;
    }

    function updateMachine(c, r, m, dt) {
      const def = MACH[m.kind];
      if (m.flash > 0) m.flash -= dt;
      if (def.sink) return;
      if (def.takes == null) {
        // spool: unwinds wire as long as it can hand it off
        if (m.out.length === 0) {
          m.timer += dt;
          if (m.timer >= def.period) {
            m.timer = 0;
            m.out.push({ k: 'wire' });
          }
        }
        if (m.out.length === 0 || m.timer > 0) m.frame += dt * 6;
      } else {
        if (m.busy > 0) {
          m.busy -= dt;
          m.frame += dt * 7;
          if (m.busy <= 0) {
            m.busy = 0;
            const n = m.kind === 'cutter' && st.shorter ? 2 : 1;
            for (let i = 0; i < n; i++) m.out.push({ k: def.makes, small: st.shorter });
            if (m.kind === 'cutter') M.audio.sfx('cut');
          }
        } else if (m.inBuf > 0 && m.out.length === 0) {
          m.inBuf--;
          m.busy = def.period;
        }
      }
      // hand finished items to neighbouring belts, round-robin
      if (m.out.length) {
        for (let k = 0; k < 4; k++) {
          const d = (m.rr + k) % 4;
          const bc = c + DX[d];
          const br = r + DY[d];
          const b = at(bc, br);
          if (!b || b.t !== 'belt' || !machineFeeds(m, bc, br, b, opp(d)) || !hasRoom(b)) continue;
          const it = m.out.shift();
          b.items.push({ k: it.k, small: !!it.small, p: 0, from: opp(d), jam: null });
          m.rr = (d + 1) % 4;
          break;
        }
      }
    }

    function updateBelt(c, r, b, dt) {
      const v = BELT_SPEED * dt;
      for (let i = 0; i < b.items.length; i++) {
        const it = b.items[i];
        const target = it.p + v;
        if (i > 0) {
          it.p = Math.max(it.p, Math.min(target, b.items[i - 1].p - GAP));
          continue;
        }
        if (target < 1) {
          it.p = target;
          it.jam = null;
          continue;
        }
        const nc = c + DX[b.dir];
        const nr = r + DY[b.dir];
        const nx = at(nc, nr);
        if (nx && nx.t === 'belt' && nx.dir !== opp(b.dir) && hasRoom(nx)) {
          b.items.shift();
          i--;
          const last = nx.items[nx.items.length - 1];
          const over = target - 1;
          it.p = last ? Math.min(over, last.p - GAP) : over;
          it.from = opp(b.dir);
          it.jam = null;
          nx.items.push(it);
          continue;
        }
        if (nx && nx.t === 'm') {
          const res = machineAccept(nx, it);
          if (res === true) {
            b.items.shift();
            i--;
            continue;
          }
          it.jam = typeof res === 'string' ? res : null;
        }
        it.p = 1;
      }
    }

    function simulate(dt) {
      if (!st.powered) return;
      st.time += dt;
      beltOff += BELT_SPEED * CELL * dt;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const e = at(c, r);
        if (e && e.t === 'm') updateMachine(c, r, e, dt);
      }
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const e = at(c, r);
        if (e && e.t === 'belt') updateBelt(c, r, e, dt);
      }
      while (st.clipTimes.length && st.clipTimes[0] < st.time - 8) st.clipTimes.shift();
    }

    function rate() {
      const span = Math.min(8, st.time);
      return span > 1 ? st.clipTimes.length / span : 0;
    }

    function findJam() {
      for (const e of cells) {
        if (!e || e.t !== 'belt') continue;
        for (const it of e.items) if (it.jam) return it.jam;
      }
      return null;
    }

    // --- NPCs ------------------------------------------------------------------------------
    function npc(who) {
      if (!npcs[who]) npcs[who] = { who, x: -14, tx: -14, walkT: 0, flip: false };
      return npcs[who];
    }

    // --- script API --------------------------------------------------------------------------
    const S = {
      state: st,
      say: M.cmd.say,
      choose: M.cmd.choose,
      wait: M.cmd.wait,
      call: M.cmd.call,
      all: M.cmd.all,
      until: M.cmd.until,
      enter(who, x, delay) {
        let d = delay || 0;
        return {
          start() {
            const n = npc(who);
            if (n.gone || n.x < -10) n.x = -14;
            n.gone = false;
          },
          update(dt) {
            if ((d -= dt) > 0) return false;
            const n = npc(who);
            n.tx = x;
            return Math.abs(n.x - x) < 0.5;
          },
        };
      },
      leave(who, delay) {
        let d = delay || 0;
        return {
          update(dt) {
            if ((d -= dt) > 0) return false;
            const n = npcs[who];
            if (!n) return true;
            n.tx = -16;
            if (n.x <= -15.5) {
              n.gone = true;
              return true;
            }
            return false;
          },
        };
      },
      unlock(kind, n) {
        return M.cmd.call(() => {
          st.inv[kind] = (st.inv[kind] || 0) + n;
          M.audio.sfx('unlock');
          toast('+' + n + ' ' + MACH[kind].name);
        });
      },
      hint(name) {
        return M.cmd.call(() => {
          st.flags['hint_' + name] = true;
        });
      },
      sfx(name) {
        return M.cmd.call(() => M.audio.sfx(name));
      },
      music(name, bpm) {
        return M.cmd.call(() => {
          M.audio.stopMusic(0.2);
          M.audio.playMusic(name, bpm ? { bpm } : null);
        });
      },
      power(on) {
        return M.cmd.call(() => {
          st.powered = on;
          M.audio.sfx(on ? 'powerUp' : 'powerDown');
          if (!on) M.audio.stopMusic(1.0);
        });
      },
      night(to, dur) {
        return M.cmd.tween(st, 'night', to, dur);
      },
      card(text, dur) {
        let k = 0;
        return {
          update(dt) {
            k += dt;
            return k >= dur;
          },
          draw() {
            const a = Math.min(1, k / 0.4, (dur - k) / 0.4);
            g.ctx.globalAlpha = Math.max(0, a);
            g.rect(0, 84, 256, 28, P.INK);
            g.textCenter(text, 128, 94, P.CREAM);
            g.ctx.globalAlpha = 1;
          },
        };
      },
      shorter() {
        return M.cmd.call(() => {
          st.shorter = true;
          M.audio.sfx('cut');
          M.audio.setTempo(120);
          toast('CUT LENGTH: 50%');
        });
      },
      endChapter() {
        return M.cmd.call(() => {
          if (ended) return;
          ended = true;
          st.chapter1Done = true;
          save();
          M.audio.stopMusic(1.5);
          M.go(() => M.scenes.chapterEnd({ clips: st.clips }), { out: 1.6, in: 0.8 });
        });
      },
      again() {
        repeatBeat = true;
      },
    };

    function runBeat(b) {
      beat = b;
      repeatBeat = false;
      runner = new M.Runner(b.run, S);
    }

    function runLine(text) {
      beat = null;
      runner = new M.Runner(function* () {
        yield S.say('pip', text);
      }, S);
    }

    function checkBeats() {
      if (runner || st.sandbox || opts.mockup) return;
      const next = story.beats.find((b) => !st.flags[b.id]);
      if (next && next.when(st)) {
        runBeat(next);
        return;
      }
      const jam = findJam();
      if (jam) {
        st.jams[jam] = (st.jams[jam] || 0) + 1 / 60;
        if (st.jams[jam] > 1.2 && !st.flags['said_' + jam] && story.hints[jam]) {
          st.flags['said_' + jam] = true;
          runLine(story.hints[jam]);
          return;
        }
      }
      if (st.clips === 0 && idleT > 70 && !st.flags.said_idle) {
        st.flags.said_idle = true;
        runLine(story.hints.idle);
      }
    }

    // --- player control --------------------------------------------------------------------
    function startMove(d) {
      const nc = drone.c + DX[d];
      const nr = drone.r + DY[d];
      st.facing = d;
      if (at(nc, nr) === undefined) return;
      if (I.down('a') && st.tool === 'belt') {
        const cur = at(drone.c, drone.r);
        if (cur && cur.t === 'belt') cur.dir = d;
        if (!at(nc, nr)) placeBelt(nc, nr, d);
        pendingRotate = false;
      }
      const [fx, fy] = cellCenter(drone.c, drone.r);
      drone.move = { fx, fy, t: 0 };
      drone.c = nc;
      drone.r = nr;
      M.audio.sfx('move');
    }

    function control() {
      if (drone.move) {
        for (let d = 0; d < 4; d++) if (I.pressed(DIRBTN[d])) drone.queued = d;
      } else {
        let moved = false;
        if (drone.queued >= 0) {
          startMove(drone.queued);
          drone.queued = -1;
          moved = true;
        }
        for (let d = 0; d < 4 && !moved; d++) {
          if (I.repeat(DIRBTN[d], 9, 5)) {
            startMove(d);
            moved = true;
          }
        }
      }

      const cur = at(drone.c, drone.r);
      if (I.pressed('a') && !drone.move) {
        if (!cur) {
          if (st.tool === 'belt') placeBelt(drone.c, drone.r, st.facing);
          else if (st.inv[st.tool] > 0) {
            put(drone.c, drone.r, newMachine(st.tool, false));
            st.inv[st.tool]--;
            M.audio.sfx('place');
            if (st.inv[st.tool] <= 0) st.tool = 'belt';
          }
        } else if (cur.t === 'belt') {
          pendingRotate = true;
        }
      }
      if (!I.down('a') && pendingRotate) {
        pendingRotate = false;
        const b = at(drone.c, drone.r);
        if (b && b.t === 'belt') {
          b.dir = (b.dir + 1) % 4;
          M.audio.sfx('rotate');
        }
      }
      if (I.pressed('b') && cur) {
        if (cur.t === 'belt') {
          put(drone.c, drone.r, null);
          M.audio.sfx('remove');
        } else if (!cur.fixed) {
          put(drone.c, drone.r, null);
          st.inv[cur.kind]++;
          M.audio.sfx('remove');
          toast(MACH[cur.kind].name + ' PICKED UP', P.CREAM);
        } else {
          M.audio.sfx('error');
          toast('BOLTED DOWN', P.CREAM);
        }
      }
      const list = tools();
      if (list.length > 1 && (I.pressed('sel') || I.pressed('r') || I.pressed('l'))) {
        const i = list.indexOf(st.tool);
        const step = I.pressed('l') ? list.length - 1 : 1;
        st.tool = list[((i < 0 ? 0 : i) + step) % list.length];
        M.audio.sfx('cursor');
      }
      if (!list.includes(st.tool)) st.tool = 'belt';
    }

    // --- pause menu ------------------------------------------------------------------------------
    function pauseItems() {
      return ['RESUME', 'SOUND ' + (M.audio.muted ? 'OFF' : 'ON'), 'SAVE AND QUIT'];
    }

    function updatePause() {
      const n = pauseItems().length;
      if (I.repeat('up')) {
        pause.sel = (pause.sel + n - 1) % n;
        M.audio.sfx('cursor');
      }
      if (I.repeat('down')) {
        pause.sel = (pause.sel + 1) % n;
        M.audio.sfx('cursor');
      }
      if (I.pressed('start') || I.pressed('b')) {
        pause = null;
        M.audio.sfx('cancel');
        return;
      }
      if (I.pressed('a')) {
        if (pause.sel === 0) {
          pause = null;
          M.audio.sfx('cancel');
        } else if (pause.sel === 1) {
          M.audio.setMuted(!M.audio.muted);
          M.audio.sfx('cursor');
        } else {
          if (!runner) save();
          M.audio.sfx('confirm');
          M.audio.stopMusic(0.6);
          M.go(() => M.scenes.title(), { out: 0.6 });
          pause = null;
          ended = true;
        }
      }
    }

    // --- drawing -----------------------------------------------------------------------------------
    function beltSides(c, r, b) {
      const s = [false, false, false, false];
      s[b.dir] = true;
      for (let d = 0; d < 4; d++) {
        if (d === b.dir) continue;
        const n = at(c + DX[d], r + DY[d]);
        if (!n) continue;
        if (n.t === 'belt' && n.dir === opp(d)) s[d] = true;
        else if (machineFeeds(n, c, r, b, d)) s[d] = true;
      }
      return s;
    }

    function drawBelts() {
      const off = Math.floor(beltOff);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const b = at(c, r);
        if (!b || b.t !== 'belt') continue;
        const x0 = GX + c * CELL;
        const y0 = GY + r * CELL;
        const s = beltSides(c, r, b);
        const straight = (s[1] && s[3] && !s[0] && !s[2]) || (s[0] && s[2] && !s[1] && !s[3]);
        for (let d = 0; d < 4; d++) if (s[d]) drawHalf(g, x0, y0, d, d === b.dir ? d : opp(d), off);
        if (!straight) drawJunction(g, x0, y0);
      }
    }

    function drawItems() {
      const art = buildItems();
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const b = at(c, r);
        if (!b || b.t !== 'belt') continue;
        const [cx, cy] = cellCenter(c, r);
        for (const it of b.items) {
          let x;
          let y;
          let axis;
          if (it.p < 0.5) {
            const k = it.p * 2;
            x = cx + DX[it.from] * 12 * (1 - k);
            y = cy + DY[it.from] * 12 * (1 - k);
            axis = it.from % 2 === 1 ? 'h' : 'v';
          } else {
            const k = (it.p - 0.5) * 2;
            x = cx + DX[b.dir] * 12 * k;
            y = cy + DY[b.dir] * 12 * k;
            axis = b.dir % 2 === 1 ? 'h' : 'v';
          }
          const key = it.k === 'wire' ? 'wire' : it.small ? it.k + 'Small' : it.k;
          const img = art[key][axis];
          g.spr(img, Math.round(x - img.width / 2), Math.round(y - img.height / 2));
          if (it.jam && Math.floor(t * 4) % 2 === 0) g.spr(M.ART.spr.jam, Math.round(x - 3), Math.round(y - 9));
        }
      }
    }

    const BOX_PILE = [];
    {
      const r = M.rng(5);
      for (let i = 0; i < 48; i++) BOX_PILE.push([4 + Math.floor(r() * 14), 17 - Math.floor(r() * (1 + i / 10))]);
    }

    function drawMachines() {
      const A = M.ART.spr;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const m = at(c, r);
        if (!m || m.t !== 'm') continue;
        const x = GX + c * CELL + 1;
        const y = GY + r * CELL + 1;
        let f = Math.floor(m.frame) % 2;
        if (m.kind === 'box') f = m.flash > 0 ? 1 : 0;
        if (!st.powered) f = 0;
        g.spr(A[m.kind + f], x, y);
        if (m.kind === 'box') {
          const n = Math.min(BOX_PILE.length, Math.floor(st.boxCount / 12));
          for (let i = 0; i < n; i++) g.rect(x + BOX_PILE[i][0], y + BOX_PILE[i][1], 2, 1, i % 3 ? P.STEEL_LT : P.WHITE);
        }
        if (!m.fixed) {
          // placed spares get a small cream rivet so they read as movable
          g.rect(x + 19, y + 18, 1, 1, P.CREAM);
        }
      }
    }

    function drawCursor() {
      const x0 = GX + drone.c * CELL;
      const y0 = GY + drone.r * CELL;
      const col = Math.floor(t * 3) % 2 ? P.ORANGE : P.YELLOW;
      const L = 4;
      for (const [cx, cy, sx, sy] of [
        [x0, y0, 1, 1],
        [x0 + 23, y0, -1, 1],
        [x0, y0 + 23, 1, -1],
        [x0 + 23, y0 + 23, -1, -1],
      ]) {
        g.rect(sx > 0 ? cx : cx - L + 1, cy, L, 1, col);
        g.rect(cx, sy > 0 ? cy : cy - L + 1, 1, L, col);
      }
      const cur = at(drone.c, drone.r);
      if (!cur && !drone.move) {
        if (st.tool === 'belt') {
          // facing arrow on the cell edge
          const d = st.facing;
          const ax = x0 + 12 + DX[d] * 9;
          const ay = y0 + 12 + DY[d] * 9;
          for (let i = 0; i < 3; i++) {
            if (d % 2 === 1) g.rect(ax - DX[d] * i, ay - i, 1, i * 2 + 1, P.ORANGE);
            else g.rect(ax - i, ay - DY[d] * i, i * 2 + 1, 1, P.ORANGE);
          }
        } else {
          g.ctx.globalAlpha = 0.45;
          g.spr(M.ART.spr[st.tool + '0'], x0 + 1, y0 + 1);
          g.ctx.globalAlpha = 1;
        }
      }
    }

    function drawDrone(eyeOnly) {
      const A = M.ART.spr;
      const bob = Math.round(Math.sin(t * 3.2) * 0.8) - 0;
      const x = Math.round(drone.x) - 6;
      const y = Math.round(drone.y) - 6;
      if (eyeOnly) {
        if (drone.blink <= 0) g.spr(A.droneEye, x + 4, y + 5 + bob);
        return;
      }
      g.spr(A.droneShadow, x, y + 12);
      g.spr(drone.blink > 0 ? A.droneBlink : A.drone, x, y + bob);
    }

    function drawNPCs() {
      for (const k in npcs) {
        const n = npcs[k];
        if (n.gone) continue;
        const frames = M.ART.people[k] || M.ART.people.worker;
        const walking = Math.abs(n.tx - n.x) > 0.5;
        const f = walking ? Math.floor(n.walkT * 7) % 2 : 0;
        const talking = runner && M.dialog.active && M.dialog.who === k && M.dialog.chars < M.dialog.pageLen();
        const by = talking && Math.floor(t * 8) % 2 ? -1 : 0;
        g.spr(frames[f], Math.round(n.x), 149 + by, n.flip);
      }
    }

    function drawHUD() {
      g.rect(0, 0, 256, 24, P.INK);
      g.text('GOAL: MAKE AS MANY', 2, 0, P.ORANGE);
      const hide = st.goalBlink > 0 && Math.floor(t * 5) % 2 === 0;
      g.text(hide ? 'PAPERCLIPS AS' : 'PAPERCLIPS AS POSSIBLE', 2, 8, P.ORANGE);
      g.text('CLIPS ' + fmt(st.clips), 2, 16, P.WHITE);
      const rt = rate();
      if (!st.powered) g.textRight('LINE OFF', 254, 16, P.GRID);
      else if (rt > 0) g.textRight(rt.toFixed(1) + '/S', 254, 16, P.STEEL_DK);
    }

    function hintLine(cur) {
      const A = M.input.label('a');
      const B = M.input.label('b');
      if (!cur) {
        if (st.tool === 'belt') return 'HOLD ' + A + ' + MOVE: LAY BELT';
        return A + ': PLACE ' + MACH[st.tool].name;
      }
      if (cur.t === 'belt') return A + ': TURN   ' + B + ': REMOVE';
      if (!cur.fixed) return MACH[cur.kind].name + '  ' + B + ': PICK UP';
      return MACH[cur.kind].info;
    }

    function drawPanel() {
      M.drawDialogFrame();
      const blink = Math.floor(t * 10) % 37 === 0;
      const key = M.CAST.pip.portrait;
      M.drawPortrait(key === 'pip1' && blink ? 'pip1Blink' : key, 8, 176);
      const list = tools();
      let l1 = 'PART: ' + (st.tool === 'belt' ? 'BELT' : MACH[st.tool].name + ' ×' + st.inv[st.tool]);
      g.text(l1, 40, 178, P.ORANGE);
      if (list.length > 1) g.textRight(M.input.label('sel'), 244, 178, P.STEEL_DK);
      g.text(hintLine(at(drone.c, drone.r)), 40, 190, P.CREAM);
      g.text(story.objective(st), 40, 202, P.STEEL_LT);
    }

    function drawToasts() {
      toasts.forEach((to, i) => {
        const a = Math.min(1, (2.2 - to.t) / 0.4);
        g.ctx.globalAlpha = Math.max(0, a);
        const y = 155 - Math.min(3, to.t * 12) - i * 11;
        const w = to.text.length * 8 + 8;
        g.rect(252 - w, y - 2, w, 11, P.SHADOW);
        g.textRight(to.text, 248, y, to.color);
        g.ctx.globalAlpha = 1;
      });
    }

    function drawPause() {
      const items = pauseItems();
      g.box(64, 72, 128, 72);
      g.textCenter('PAUSED', 128, 82, P.STEEL_LT);
      items.forEach((l, i) => {
        const y = 100 + i * 13;
        if (i === pause.sel) g.text('▶', 74, y, P.ORANGE);
        g.text(l, 86, y, i === pause.sel ? P.ORANGE : P.CREAM);
      });
    }

    return {
      name: 'factory',
      enter() {
        buildFloor();
        buildItems();
        if (opts.mockup) runner = new M.Runner(function* () {
          yield S.say('pip', 'i found a faster way.');
        }, S);
        if (!opts.debugNight) M.audio.playMusic('factory', st.sandbox ? { bpm: 96 } : st.shorter ? { bpm: 120 } : null);
      },
      exit() {
        M.dialog.close();
      },
      update(dt) {
        t += dt;
        if (ended) return;
        if (pause) {
          updatePause();
          return;
        }
        if (I.pressed('start') && !runner) {
          pause = { sel: 0 };
          M.audio.sfx('cursor');
          return;
        }

        simulate(dt);
        if (st.goalBlink > 0) st.goalBlink -= dt;
        drone.blink = drone.blink > 0 ? drone.blink - dt : Math.random() < dt / 3 ? 0.12 : 0;

        if (drone.move) {
          drone.move.t += dt / 0.075;
          const [tx, ty] = cellCenter(drone.c, drone.r);
          const k = Math.min(1, drone.move.t);
          drone.x = drone.move.fx + (tx - drone.move.fx) * k;
          drone.y = drone.move.fy + (ty - drone.move.fy) * k;
          if (k >= 1) drone.move = null;
        }

        for (const k in npcs) {
          const n = npcs[k];
          const d = n.tx - n.x;
          if (Math.abs(d) > 0.5) {
            n.x += Math.sign(d) * Math.min(Math.abs(d), 46 * dt);
            n.walkT += dt;
            n.flip = d < 0;
          } else {
            n.x = n.tx;
            n.flip = false;
          }
        }

        for (let i = toasts.length - 1; i >= 0; i--) {
          toasts[i].t += dt;
          if (toasts[i].t > 2.2) toasts.splice(i, 1);
        }

        if (runner) {
          runner.update(dt);
          if (runner.done) {
            runner = null;
            if (beat) {
              if (!repeatBeat) st.flags[beat.id] = true;
              beat = null;
            }
            if (!ended) save();
          }
        } else {
          control();
          if (st.clips === 0) idleT += dt;
          saveT += dt;
          if (saveT > 12) {
            saveT = 0;
            save();
          }
        }
        if (!ended) checkBeats();
      },
      draw() {
        g.clear(P.FLOOR);
        g.spr(floorCanvas, 0, 24);
        drawBelts();
        drawItems();
        drawMachines();
        if (!runner) drawCursor();
        drawDrone(false);
        drawNPCs();
        if (st.night > 0) {
          g.tint(P.NIGHT, st.night);
          drawDrone(true);
        }
        drawHUD();
        if (runner && M.dialog.active) runner.draw();
        else {
          drawPanel();
          if (runner) runner.draw();
        }
        drawToasts();
        if (pause) drawPause();
      },
    };
  };
})(window.MORE = window.MORE || {});
