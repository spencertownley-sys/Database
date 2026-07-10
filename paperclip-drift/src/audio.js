/* Paperclip Drift — ambient audio (optional, off until the player enables it).
   Two beds that cross-fade as the world drifts: procedural birdsong whose
   density follows the decor fraction, and a machine hum that follows
   throughput. No samples; everything is synthesized.                        */
'use strict';
var PD = globalThis.PD || (globalThis.PD = {});

(function () {
  let ac = null, humGain = null, humOsc = null, humNoise = null;
  let birdGain = null, enabled = false, birdTimer = null;
  let levels = { birds: 0, hum: 0 };

  function ensure() {
    if (ac) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ac = new AC();

    // hum: detuned saws through a lowpass + slow amplitude wobble
    humGain = ac.createGain(); humGain.gain.value = 0;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    humOsc = ac.createOscillator(); humOsc.type = 'sawtooth'; humOsc.frequency.value = 55;
    const o2 = ac.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 55.7;
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.13;
    const lfoG = ac.createGain(); lfoG.gain.value = 0.15;
    lfo.connect(lfoG); lfoG.connect(humGain.gain);
    humOsc.connect(lp); o2.connect(lp); lp.connect(humGain); humGain.connect(ac.destination);
    humOsc.start(); o2.start(); lfo.start();

    // noise floor for the hum (belt/vent texture)
    const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.4;
    humNoise = ac.createBufferSource(); humNoise.buffer = buf; humNoise.loop = true;
    const nf = ac.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 700; nf.Q.value = 0.6;
    const ng = ac.createGain(); ng.gain.value = 0.25;
    humNoise.connect(nf); nf.connect(ng); ng.connect(humGain);
    humNoise.start();

    birdGain = ac.createGain(); birdGain.gain.value = 0;
    birdGain.connect(ac.destination);
    scheduleBirds();
    return true;
  }

  function chirp() {
    if (!ac || levels.birds <= 0.02) return;
    const t0 = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    const f0 = 2200 + Math.random() * 1800;
    const notes = 2 + (Math.random() * 3 | 0);
    for (let i = 0; i < notes; i++) {
      const nt = t0 + i * 0.09;
      o.frequency.setValueAtTime(f0 * (1 + Math.random() * 0.25), nt);
      o.frequency.exponentialRampToValueAtTime(f0 * (0.8 + Math.random() * 0.5), nt + 0.07);
      g.gain.setValueAtTime(0, nt);
      g.gain.linearRampToValueAtTime(0.16, nt + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, nt + 0.08);
    }
    o.connect(g); g.connect(birdGain);
    o.start(t0); o.stop(t0 + notes * 0.09 + 0.1);
  }

  function scheduleBirds() {
    clearTimeout(birdTimer);
    const density = Math.max(0.02, levels.birds);
    const wait = 400 + Math.random() * 4200 / density;
    birdTimer = setTimeout(() => { chirp(); scheduleBirds(); }, wait);
  }

  PD.Audio = {
    get enabled() { return enabled; },
    toggle() {
      if (!enabled) {
        if (!ensure()) return false;
        if (ac.state === 'suspended') ac.resume();
        enabled = true;
      } else {
        enabled = false;
      }
      this.apply();
      return enabled;
    },
    setLevels(birds, hum) {
      levels = { birds, hum };
      this.apply();
    },
    apply() {
      if (!ac) return;
      const t = ac.currentTime;
      const b = enabled ? levels.birds * 0.5 : 0;
      const h = enabled ? Math.min(0.08, levels.hum * 0.08) : 0;
      birdGain.gain.setTargetAtTime(b, t, 0.8);
      humGain.gain.setTargetAtTime(h, t, 0.8);
    },
  };
})();
