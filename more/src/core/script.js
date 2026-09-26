// MORE. — cutscene scripting
// Story beats are written as generator functions that `yield` commands:
//
//   function* (S) {
//     yield S.say('dale', "So you're the computer.");
//     const pick = yield S.choose('pip', 'i found a faster way.', ['CUT SHORTER', 'KEEP SIZE']);
//     if (pick === 0) yield S.call(() => { ... });
//   }
//
// A command is any object with update(dt) -> true when finished. Its `result`
// is sent back into the generator. The Runner advances one command at a time.
(function (M) {
  'use strict';

  M.scenes = M.scenes || {};

  class Runner {
    constructor(genFn, api) {
      this.it = genFn(api);
      this.cur = null;
      this.done = false;
      this.advance(undefined);
    }

    advance(val) {
      const r = this.it.next(val);
      if (r.done) {
        this.done = true;
        this.cur = null;
      } else {
        this.cur = r.value;
      }
    }

    update(dt) {
      let guard = 0;
      while (!this.done && guard++ < 64) {
        const c = this.cur;
        if (c == null) {
          // bare `yield` waits exactly one frame
          this.advance(undefined);
          return;
        }
        if (!c._started) {
          c._started = true;
          if (c.start) c.start();
        }
        if (c.update(dt)) {
          this.advance(c.result);
          dt = 0;
          continue;
        }
        return;
      }
    }

    draw() {
      if (this.cur && this.cur.draw) this.cur.draw();
    }

    get busy() {
      return !this.done;
    }
  }

  // --- generic commands ----------------------------------------------------------
  const cmd = {
    wait(sec) {
      let t = 0;
      return { update: (dt) => (t += dt) >= sec };
    },
    call(fn) {
      return {
        update() {
          this.result = fn();
          return true;
        },
      };
    },
    until(pred) {
      return { update: () => !!pred() };
    },
    // Tween obj[key] linearly to `to` over `dur` seconds.
    tween(obj, key, to, dur) {
      let t = 0;
      let from = null;
      return {
        update(dt) {
          if (from === null) from = obj[key];
          t += dt;
          const k = dur <= 0 ? 1 : Math.min(1, t / dur);
          obj[key] = from + (to - from) * k;
          return k >= 1;
        },
      };
    },
    // Run several commands together; finishes when all are done.
    all(list) {
      const live = list.slice();
      return {
        update(dt) {
          for (let i = live.length - 1; i >= 0; i--) {
            const c = live[i];
            if (!c._started) {
              c._started = true;
              if (c.start) c.start();
            }
            if (c.update(dt)) live.splice(i, 1);
          }
          return live.length === 0;
        },
        draw() {
          for (const c of live) if (c.draw) c.draw();
        },
      };
    },
    // Wait for the player to press A (optionally showing nothing).
    press(btn) {
      return { update: () => M.input.pressed(btn || 'a') };
    },
  };

  M.Runner = Runner;
  M.cmd = cmd;
})(window.MORE = window.MORE || {});
