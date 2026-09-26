// MORE. — audio
// A tiny WebAudio chiptune engine: pulse/triangle/"sample-ish" voices, a noise
// channel and a feedback echo bus standing in for the SNES DSP echo.
// Also plays Ruth's voicemail through a telephone band-pass.
(function (M) {
  'use strict';

  let ctx = null;
  let master, musicBus, sfxBus, voiceBus, echoIn;
  let noiseBuf = null;
  const waves = {};
  let muted = false;
  try {
    muted = localStorage.getItem('more.muted') === '1';
  } catch (e) {
    /* storage unavailable */
  }

  function midi(note) {
    // "A4", "C#3", "Bb2"
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(note);
    if (!m) return null;
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
    const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    return 12 * (parseInt(m[3], 10) + 1) + base + acc;
  }
  const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);

  function periodic(real, imag) {
    return ctx.createPeriodicWave(new Float32Array(real), new Float32Array(imag), { disableNormalization: false });
  }

  function pulseWave(duty) {
    const n = 48;
    const real = [0];
    const imag = [0];
    for (let k = 1; k < n; k++) {
      real.push((2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty));
      imag.push(0);
    }
    return periodic(real, imag);
  }

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);

    musicBus = ctx.createGain();
    musicBus.gain.value = 0.32;
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.42;
    voiceBus = ctx.createGain();
    voiceBus.gain.value = 1.4;
    musicBus.connect(master);
    sfxBus.connect(master);
    voiceBus.connect(master);

    // Echo: delay -> lowpass -> feedback, like the S-DSP's FIR-filtered echo.
    echoIn = ctx.createGain();
    echoIn.gain.value = 1;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.21;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    echoIn.connect(delay);
    delay.connect(lp);
    lp.connect(fb);
    fb.connect(delay);
    lp.connect(wet);
    wet.connect(master);

    waves.pulse50 = pulseWave(0.5);
    waves.pulse25 = pulseWave(0.25);
    waves.pulse12 = pulseWave(0.125);
    // Soft "sampled" tones: a mellow electric-piano-ish and a round bass.
    waves.soft = periodic([0, 0, 0, 0, 0, 0, 0], [0, 1, 0.35, 0.12, 0.06, 0.03, 0.01]);
    waves.bass = periodic([0, 0, 0, 0, 0, 0], [0, 1, 0.5, 0.05, 0.1, 0.02]);
    waves.organ = periodic([0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 1, 0.6, 0.0, 0.3, 0, 0.15, 0, 0.08]);

    const len = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  function unlock() {
    init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    if (ctx && !voicemail.buffer && !voicemail.loading) voicemail.load();
  }

  function setMuted(v) {
    muted = v;
    try {
      localStorage.setItem('more.muted', v ? '1' : '0');
    } catch (e) {
      /* ignore */
    }
    if (master) master.gain.setTargetAtTime(v ? 0 : 0.8, ctx.currentTime, 0.02);
  }

  // --- voices -----------------------------------------------------------------
  // Play one tone. opts: wave, freq, t, dur, vol, a, d, s, r, echo, slide, vib, bus, detune
  function tone(o) {
    if (!ctx) return;
    const t = o.t != null ? o.t : ctx.currentTime;
    const osc = ctx.createOscillator();
    const w = waves[o.wave] || null;
    if (w) osc.setPeriodicWave(w);
    else osc.type = o.wave || 'square';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t + (o.slideTime || o.dur));
    if (o.detune) osc.detune.value = o.detune;
    if (o.vib) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = o.vibRate || 5.5;
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(o.freq * o.vib, t + 0.25);
      lfo.connect(lg);
      lg.connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + o.dur + (o.r || 0.05) + 0.05);
    }
    const g = ctx.createGain();
    const vol = o.vol != null ? o.vol : 0.3;
    const a = o.a != null ? o.a : 0.005;
    const dcy = o.d != null ? o.d : 0.08;
    const s = o.s != null ? o.s : 0.6;
    const r = o.r != null ? o.r : 0.06;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.linearRampToValueAtTime(vol * s, t + a + dcy);
    g.gain.setValueAtTime(vol * s, t + Math.max(a + dcy, o.dur));
    g.gain.linearRampToValueAtTime(0, t + Math.max(a + dcy, o.dur) + r);
    osc.connect(g);
    g.connect(o.bus || sfxBus);
    if (o.echo) {
      const e = ctx.createGain();
      e.gain.value = o.echo;
      g.connect(e);
      e.connect(echoIn);
    }
    osc.start(t);
    osc.stop(t + Math.max(a + dcy, o.dur) + r + 0.02);
  }

  function noise(o) {
    if (!ctx) return;
    const t = o.t != null ? o.t : ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 3000, t);
    if (o.slide) f.frequency.exponentialRampToValueAtTime(o.slide, t + o.dur);
    f.Q.value = o.q || 1;
    const g = ctx.createGain();
    const vol = o.vol != null ? o.vol : 0.3;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + o.dur);
    src.connect(f);
    f.connect(g);
    g.connect(o.bus || sfxBus);
    if (o.echo) {
      const e = ctx.createGain();
      e.gain.value = o.echo;
      g.connect(e);
      e.connect(echoIn);
    }
    src.start(t, Math.random() * 0.5);
    src.stop(t + o.dur + 0.02);
  }

  // --- sound effects ------------------------------------------------------------
  const SFX = {
    blip: (p) => tone({ wave: 'pulse25', freq: p || 740, dur: 0.018, vol: 0.12, d: 0.01, s: 0.5, r: 0.01 }),
    move: () => tone({ wave: 'pulse12', freq: 1320, dur: 0.012, vol: 0.06, r: 0.01 }),
    cursor: () => tone({ wave: 'pulse25', freq: 988, dur: 0.03, vol: 0.12, r: 0.02 }),
    place: () => {
      tone({ wave: 'pulse25', freq: 523, dur: 0.035, vol: 0.18 });
      tone({ wave: 'pulse25', freq: 784, dur: 0.05, vol: 0.18, t: ctx.currentTime + 0.035 });
    },
    belt: () => tone({ wave: 'pulse12', freq: 660, dur: 0.03, vol: 0.12, slide: 880 }),
    remove: () => tone({ wave: 'pulse25', freq: 440, dur: 0.09, vol: 0.18, slide: 180 }),
    rotate: () => tone({ wave: 'pulse12', freq: 880, dur: 0.03, vol: 0.14 }),
    error: () => tone({ wave: 'pulse50', freq: 110, dur: 0.16, vol: 0.16, s: 0.9 }),
    clip: () => {
      tone({ wave: 'triangle', freq: 2093, dur: 0.02, vol: 0.14, d: 0.04, s: 0.2, r: 0.08 });
      tone({ wave: 'sine', freq: 3136, dur: 0.02, vol: 0.06, d: 0.03, s: 0.1, r: 0.06 });
    },
    cut: () => noise({ freq: 5200, dur: 0.05, vol: 0.12, q: 2 }),
    bend: () => tone({ wave: 'pulse12', freq: 300, dur: 0.05, vol: 0.06, slide: 220 }),
    confirm: () => {
      const t = ctx.currentTime;
      tone({ wave: 'pulse25', freq: 880, dur: 0.05, vol: 0.16, t });
      tone({ wave: 'pulse25', freq: 1319, dur: 0.08, vol: 0.16, t: t + 0.05, echo: 0.3 });
    },
    cancel: () => {
      const t = ctx.currentTime;
      tone({ wave: 'pulse25', freq: 659, dur: 0.05, vol: 0.14, t });
      tone({ wave: 'pulse25', freq: 440, dur: 0.07, vol: 0.14, t: t + 0.05 });
    },
    fanfare: () => {
      const t = ctx.currentTime;
      ['C5', 'E5', 'G5', 'C6'].forEach((n, i) =>
        tone({ wave: 'pulse25', freq: hz(midi(n)), dur: i === 3 ? 0.4 : 0.08, vol: 0.16, t: t + i * 0.09, echo: 0.4, vib: i === 3 ? 0.01 : 0 })
      );
    },
    unlock: () => {
      const t = ctx.currentTime;
      ['A4', 'D5', 'F#5', 'A5'].forEach((n, i) =>
        tone({ wave: 'soft', freq: hz(midi(n)), dur: 0.12, vol: 0.2, t: t + i * 0.07, echo: 0.5 })
      );
    },
    whistle: () => {
      const t = ctx.currentTime;
      [440, 554, 659].forEach((f) =>
        tone({ wave: 'triangle', freq: f * 0.97, slide: f, slideTime: 0.4, dur: 1.9, vol: 0.12, a: 0.25, d: 0.1, s: 1, r: 0.6, t, echo: 0.5 })
      );
      noise({ freq: 1800, dur: 2.2, vol: 0.05, q: 0.6, t });
    },
    clunk: () => {
      noise({ freq: 400, dur: 0.12, vol: 0.3, q: 0.8 });
      tone({ wave: 'pulse50', freq: 90, dur: 0.06, vol: 0.2, slide: 50 });
    },
    door: () => {
      noise({ freq: 700, dur: 0.25, vol: 0.18, q: 0.5, slide: 300 });
      tone({ wave: 'triangle', freq: 70, dur: 0.12, vol: 0.3, slide: 45, t: ctx.currentTime + 0.18 });
    },
    key: () => noise({ freq: 3800 + Math.random() * 1200, dur: 0.03, vol: 0.12, q: 3, filter: 'bandpass' }),
    enter: () => {
      noise({ freq: 2200, dur: 0.06, vol: 0.2, q: 2 });
      tone({ wave: 'pulse50', freq: 140, dur: 0.05, vol: 0.12, slide: 80 });
    },
    boot: () => {
      const t = ctx.currentTime;
      ['C4', 'G4', 'C5', 'E5', 'G5', 'C6'].forEach((n, i) =>
        tone({ wave: 'pulse12', freq: hz(midi(n)), dur: 0.05, vol: 0.12, t: t + i * 0.06, echo: 0.3 })
      );
      tone({ wave: 'soft', freq: hz(midi('C3')), dur: 0.8, vol: 0.22, t: t + 0.36, a: 0.05, s: 0.8, r: 0.5, echo: 0.5 });
    },
    powerDown: () => {
      tone({ wave: 'pulse50', freq: 330, slide: 35, dur: 1.2, vol: 0.12, a: 0.01, d: 0.1, s: 0.9, r: 0.2 });
      noise({ freq: 1200, slide: 120, dur: 1.2, vol: 0.08, q: 0.7 });
    },
    powerUp: () => {
      tone({ wave: 'pulse50', freq: 40, slide: 330, dur: 1.0, vol: 0.1, a: 0.05, d: 0.1, s: 0.9, r: 0.2 });
      noise({ freq: 150, slide: 1600, dur: 1.0, vol: 0.06, q: 0.7 });
    },
    phoneBeep: () => tone({ wave: 'sine', freq: 1400, dur: 0.35, vol: 0.18, a: 0.01, s: 1, r: 0.02 }),
    tick: () => tone({ wave: 'pulse12', freq: 2637, dur: 0.008, vol: 0.05, r: 0.01 }),
  };

  function sfx(name, arg) {
    if (!ctx || muted) return;
    const f = SFX[name];
    if (f) f(arg);
  }

  // --- music ------------------------------------------------------------------------
  const INSTR = {
    lead: { wave: 'pulse25', vol: 0.18, a: 0.004, d: 0.1, s: 0.55, r: 0.08, echo: 0.35, vib: 0.006 },
    lead2: { wave: 'pulse12', vol: 0.12, a: 0.004, d: 0.08, s: 0.4, r: 0.05, echo: 0.3 },
    arp: { wave: 'pulse12', vol: 0.07, a: 0.002, d: 0.05, s: 0.25, r: 0.03, echo: 0.25 },
    bass: { wave: 'bass', vol: 0.34, a: 0.004, d: 0.12, s: 0.7, r: 0.05 },
    pad: { wave: 'soft', vol: 0.14, a: 0.12, d: 0.3, s: 0.8, r: 0.5, echo: 0.6 },
    ep: { wave: 'soft', vol: 0.16, a: 0.006, d: 0.35, s: 0.35, r: 0.3, echo: 0.45 },
    bell: { wave: 'sine', vol: 0.12, a: 0.002, d: 0.3, s: 0.1, r: 0.5, echo: 0.7 },
    organ: { wave: 'organ', vol: 0.1, a: 0.02, d: 0.2, s: 0.7, r: 0.2, echo: 0.4 },
  };

  const DRUM = {
    k: (t) => tone({ wave: 'sine', freq: 150, slide: 42, slideTime: 0.12, dur: 0.12, vol: 0.5, d: 0.08, s: 0.3, r: 0.05, t, bus: musicBus }),
    s: (t) => noise({ freq: 1800, dur: 0.14, vol: 0.22, q: 0.6, t, bus: musicBus, echo: 0.15 }),
    h: (t) => noise({ freq: 8000, dur: 0.035, vol: 0.09, q: 1.5, t, bus: musicBus, filter: 'highpass' }),
    o: (t) => noise({ freq: 7000, dur: 0.16, vol: 0.07, q: 1, t, bus: musicBus, filter: 'highpass' }),
    c: (t) => noise({ freq: 5000, dur: 0.02, vol: 0.12, q: 4, t, bus: musicBus }), // metal click
  };

  // Tracks are defined in M.MUSIC (story/music.js). Each channel is a string of
  // space-separated tokens, one per step: note ("A4"), "-" hold, "." rest.
  // Drum channels use k/s/h/o/c.
  function parse(pattern) {
    const toks = pattern.trim().split(/\s+/);
    const ev = [];
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (tk === '.' || tk === '-') continue;
      let len = 1;
      while (toks[i + len] === '-') len++;
      ev.push({ step: i, tok: tk, len });
    }
    return { len: toks.length, ev };
  }

  const player = {
    track: null,
    name: null,
    chans: [],
    step: 0,
    nextTime: 0,
    timer: null,
    bpm: 100,
    gain: null,
  };

  function playMusic(name, opts) {
    if (!ctx) return;
    if (player.name === name && player.timer) return;
    stopMusic(0.25);
    const tr = M.MUSIC && M.MUSIC[name];
    if (!tr) return;
    player.name = name;
    player.track = tr;
    player.bpm = (opts && opts.bpm) || tr.bpm;
    player.chans = tr.channels.map((c) => ({ instr: c.instr, drum: !!c.drum, oct: c.oct || 0, pat: parse(c.pattern) }));
    player.step = 0;
    player.gain = ctx.createGain();
    player.gain.gain.value = 1;
    player.gain.connect(musicBus);
    player.nextTime = ctx.currentTime + 0.08;
    player.timer = setInterval(schedule, 25);
    schedule();
  }

  function setTempo(bpm) {
    player.bpm = bpm;
  }

  function stopMusic(fade) {
    if (player.timer) clearInterval(player.timer);
    player.timer = null;
    if (player.gain && ctx) {
      const g = player.gain;
      const f = fade != null ? fade : 0.4;
      g.gain.setTargetAtTime(0, ctx.currentTime, f / 3 + 0.001);
      setTimeout(() => g.disconnect(), f * 1000 + 400);
    }
    player.gain = null;
    player.name = null;
  }

  function schedule() {
    if (!ctx || !player.track) return;
    const stepDur = 60 / player.bpm / (player.track.stepsPerBeat || 4);
    while (player.nextTime < ctx.currentTime + 0.12) {
      const s = player.step;
      for (const ch of player.chans) {
        const local = s % ch.pat.len;
        for (const e of ch.pat.ev) {
          if (e.step !== local) continue;
          if (ch.drum) {
            for (const d of e.tok) if (DRUM[d]) DRUM[d](player.nextTime);
          } else {
            const n = midi(e.tok);
            if (n == null) continue;
            const ins = INSTR[ch.instr] || INSTR.lead;
            tone(Object.assign({}, ins, { freq: hz(n + ch.oct * 12), t: player.nextTime, dur: e.len * stepDur * 0.92, bus: player.gain }));
          }
        }
      }
      player.step++;
      if (player.track.once && player.step >= player.chans.reduce((m, c) => Math.max(m, c.pat.len), 0)) {
        const g = player.gain;
        clearInterval(player.timer);
        player.timer = null;
        player.name = null;
        setTimeout(() => g && g.disconnect(), 4000);
        return;
      }
      player.nextTime += stepDur;
    }
  }

  // --- voicemail ------------------------------------------------------------------------
  const voicemail = {
    buffer: null,
    loading: false,
    src: null,
    startedAt: 0,
    load() {
      if (!ctx || this.loading || this.buffer || !M.VOICEMAIL_B64) return;
      this.loading = true;
      const bin = atob(M.VOICEMAIL_B64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const done = (buf) => {
        this.buffer = buf;
        this.loading = false;
      };
      const fail = () => {
        this.loading = false;
      };
      const p = ctx.decodeAudioData(bytes.buffer, done, fail);
      if (p && p.catch) p.catch(fail);
    },
    get ready() {
      return !!this.buffer;
    },
    get duration() {
      return this.buffer ? this.buffer.duration : 13.56;
    },
    play() {
      if (!ctx || !this.buffer) return false;
      this.stop();
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      // Telephone band: 300 Hz – 3.4 kHz, a little grit.
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 320;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3400;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = i / 128 - 1;
        curve[i] = Math.tanh(x * 1.6);
      }
      shaper.curve = curve;
      src.connect(hp);
      hp.connect(lp);
      lp.connect(shaper);
      shaper.connect(voiceBus);
      src.start();
      this.src = src;
      this.startedAt = ctx.currentTime;
      return true;
    },
    stop() {
      if (this.src) {
        try {
          this.src.stop();
        } catch (e) {
          /* already stopped */
        }
      }
      this.src = null;
    },
    get time() {
      return this.src && ctx ? ctx.currentTime - this.startedAt : 0;
    },
  };

  M.audio = {
    unlock,
    sfx,
    playMusic,
    stopMusic,
    setTempo,
    voicemail,
    get ready() {
      return !!ctx;
    },
    get muted() {
      return muted;
    },
    setMuted,
    get musicName() {
      return player.name;
    },
  };
})(window.MORE = window.MORE || {});
