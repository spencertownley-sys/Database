// MORE. — boot, main loop and scene switching
(function (M) {
  'use strict';

  const STEP = 1 / 60;
  let scene = null;
  let acc = 0;
  let last = 0;
  M.time = 0;

  // Global fader (SNES master brightness). Scenes switch at full black.
  const fader = { level: 0, target: 1, speed: 3, pending: null };

  M.setScene = function (s) {
    if (scene && scene.exit) scene.exit();
    scene = s;
    M.debug = M.debug || {};
    M.debug.scene = s.name || '?';
    M.input.consume();
    if (scene.enter) scene.enter();
  };

  // Fade to black, swap scene, fade back in.
  M.go = function (makeScene, opts) {
    opts = opts || {};
    fader.target = 0;
    fader.speed = 1 / (opts.out != null ? opts.out : 0.35);
    fader.pending = { makeScene, inSpeed: 1 / (opts.in != null ? opts.in : 0.35) };
    if (opts.stopMusic) M.audio.stopMusic(opts.out != null ? opts.out : 0.35);
  };

  M.fading = () => !!fader.pending || fader.level < 1;

  function tick(dt) {
    M.time += dt;
    if (fader.level !== fader.target) {
      const d = fader.speed * dt;
      fader.level = fader.target > fader.level ? Math.min(fader.target, fader.level + d) : Math.max(fader.target, fader.level - d);
    }
    if (fader.pending && fader.level <= 0) {
      const p = fader.pending;
      fader.pending = null;
      M.setScene(p.makeScene());
      fader.target = 1;
      fader.speed = p.inSpeed;
    }
    if (scene && !fader.pending) scene.update(dt);
  }

  function draw() {
    if (scene) scene.draw();
    M.gfx.brightness(fader.level);
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    if (!last) last = ts;
    let dt = (ts - last) / 1000;
    last = ts;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n++ < 8) {
      M.input.update();
      tick(STEP);
      acc -= STEP;
    }
    draw();
  }

  function boot() {
    const canvas = document.getElementById('screen');
    M.gfx.init(canvas);
    for (const b of M.artBuilders) b();
    M.input.init(document.getElementById('pad'));

    // Any click/tap on the screen counts as START on the boot screen.
    canvas.addEventListener('pointerdown', () => {
      M.pointerTapped = true;
      M.audio.unlock();
    });

    window.addEventListener('keydown', (e) => {
      M.audio.unlock();
      if (e.code === 'KeyM' && !e.repeat) M.audio.setMuted(!M.audio.muted);
      if (e.code === 'KeyF' && !e.repeat) toggleFullscreen();
    });

    const fs = document.getElementById('fullscreen');
    if (fs) fs.addEventListener('click', toggleFullscreen);
    const padToggle = document.getElementById('pad-toggle');
    if (padToggle) {
      padToggle.addEventListener('click', () => {
        document.body.classList.toggle('show-pad');
        M.gfx.resize();
      });
    }

    // Debug/deep links: index.html#title, #prologue, #factory, #night, #end
    const start = (location.hash || '').slice(1);
    M.setScene(M.scenes.boot(start));
    requestAnimationFrame(frame);
  }

  function toggleFullscreen() {
    const el = document.getElementById('stage');
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    } catch (e) {
      /* not available here */
    }
  }

  M.scenes = M.scenes || {};
  window.addEventListener('DOMContentLoaded', boot);
})(window.MORE = window.MORE || {});
