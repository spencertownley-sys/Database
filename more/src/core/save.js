// MORE. — save data (browser localStorage; the game runs fine without it)
(function (M) {
  'use strict';

  const KEY = 'more.save.v1';

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function write(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(Object.assign({ v: 1, savedAt: Date.now() }, data)));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clear() {
    try {
      localStorage.removeItem(KEY);
    } catch (e) {
      /* ignore */
    }
  }

  M.save = { load, write, clear, has: () => !!load() };
})(window.MORE = window.MORE || {});
