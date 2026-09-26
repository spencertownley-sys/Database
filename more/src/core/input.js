// MORE. — input
// Buttons follow the SNES pad: D-pad, A, B, SELECT, START, L, R.
// Keyboard, standard gamepads and on-screen touch buttons all feed the same state.
(function (M) {
  'use strict';

  const BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b', 'sel', 'start', 'l', 'r'];

  const KEYMAP = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    KeyZ: 'a', KeyJ: 'a', Space: 'a',
    KeyX: 'b', KeyK: 'b', Backspace: 'b',
    ShiftLeft: 'sel', ShiftRight: 'sel', Tab: 'sel', KeyC: 'sel',
    Enter: 'start', Escape: 'start', KeyP: 'start',
    KeyQ: 'l', KeyE: 'r',
  };

  const keyDown = {}; // from keyboard
  const tapped = {}; // latched presses, so a tap shorter than one frame still counts
  const touchDown = {}; // from on-screen buttons
  const padDown = {}; // from gamepad
  const held = {}; // frames held
  const pressedNow = {};
  let anyPressed = false;
  let lastSource = 'keyboard';

  function onKey(e, down) {
    const b = KEYMAP[e.code];
    if (!b) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    if (down && !keyDown[b]) tapped[b] = true;
    keyDown[b] = down;
    lastSource = 'keyboard';
  }

  function bindTouch(root) {
    if (!root) return;
    const els = root.querySelectorAll('[data-btn]');
    els.forEach((el) => {
      const b = el.getAttribute('data-btn');
      const set = (v) => (e) => {
        e.preventDefault();
        if (v && !touchDown[b]) tapped[b] = true;
        touchDown[b] = v;
        el.classList.toggle('on', v);
        lastSource = 'touch';
      };
      el.addEventListener('pointerdown', (e) => {
        try {
          el.setPointerCapture(e.pointerId);
        } catch (err) {
          /* older browsers */
        }
        set(true)(e);
      });
      el.addEventListener('pointerup', set(false));
      el.addEventListener('pointercancel', set(false));
      el.addEventListener('lostpointercapture', () => {
        touchDown[b] = false;
        el.classList.remove('on');
      });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  function pollPad() {
    for (const b of BUTTONS) padDown[b] = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const btn = (i) => p.buttons[i] && p.buttons[i].pressed;
      const ax = p.axes[0] || 0;
      const ay = p.axes[1] || 0;
      padDown.a = padDown.a || btn(0);
      padDown.b = padDown.b || btn(1);
      padDown.sel = padDown.sel || btn(2) || btn(3) || btn(8);
      padDown.start = padDown.start || btn(9);
      padDown.l = padDown.l || btn(4) || btn(6);
      padDown.r = padDown.r || btn(5) || btn(7);
      padDown.up = padDown.up || btn(12) || ay < -0.5;
      padDown.down = padDown.down || btn(13) || ay > 0.5;
      padDown.left = padDown.left || btn(14) || ax < -0.5;
      padDown.right = padDown.right || btn(15) || ax > 0.5;
      if (p.buttons.some((x) => x.pressed)) lastSource = 'gamepad';
    }
  }

  // Called once per fixed update, before scenes read input.
  function update() {
    pollPad();
    anyPressed = false;
    for (const b of BUTTONS) {
      const d = !!(keyDown[b] || touchDown[b] || padDown[b] || tapped[b]);
      tapped[b] = false;
      if (d) held[b] = (held[b] || 0) + 1;
      else held[b] = 0;
      pressedNow[b] = held[b] === 1;
      if (pressedNow[b]) anyPressed = true;
    }
  }

  const down = (b) => held[b] > 0;
  const pressed = (b) => !!pressedNow[b];
  // Auto-repeat: fires on press, then after `delay` frames every `rate` frames.
  function repeat(b, delay, rate) {
    const h = held[b] || 0;
    if (h === 1) return true;
    const d = delay || 14;
    const r = rate || 5;
    return h > d && (h - d) % r === 0;
  }

  // Swallow everything currently held so a press can't leak into the next scene.
  function consume() {
    for (const b of BUTTONS) {
      pressedNow[b] = false;
      held[b] = held[b] ? 2 : 0;
    }
    anyPressed = false;
  }

  function init(touchRoot) {
    window.addEventListener('keydown', (e) => onKey(e, true));
    window.addEventListener('keyup', (e) => onKey(e, false));
    window.addEventListener('blur', () => {
      for (const b of BUTTONS) keyDown[b] = touchDown[b] = false;
    });
    bindTouch(touchRoot);
  }

  M.input = {
    init,
    update,
    down,
    pressed,
    repeat,
    consume,
    get any() {
      return anyPressed;
    },
    get source() {
      return lastSource;
    },
    // Label for the confirm button in on-screen prompts.
    label(b) {
      if (lastSource === 'touch' || lastSource === 'gamepad') {
        return { a: 'A', b: 'B', sel: 'SELECT', start: 'START', l: 'L', r: 'R' }[b];
      }
      return { a: 'Z', b: 'X', sel: 'SHIFT', start: 'ENTER', l: 'Q', r: 'E' }[b];
    },
  };
})(window.MORE = window.MORE || {});
