// MORE. — cast
// Names marked (proposal) in docs/STORY.md can be renamed here in one place.
// blip: dialog voice pitch in Hz. speed: characters per second.
(function (M) {
  'use strict';

  const P = M.PAL;

  M.CAST = {
    none: { name: null, portrait: null, color: P.CREAM, blip: 600, speed: 45 },
    caption: { name: null, portrait: null, color: P.STEEL_LT, blip: 1400, speed: 55 },
    pip: { name: 'PIP', noTab: true, portrait: 'pip1', color: P.ORANGE, blip: 330, speed: 24 },
    ruth: { name: 'RUTH', portrait: 'ruth', color: P.CREAM, blip: 880, speed: 42 },
    walt: { name: 'WALT', portrait: 'walt', color: P.CREAM, blip: 520, speed: 36 },
    dale: { name: 'DALE', portrait: 'dale', color: P.CREAM, blip: 610, speed: 40 },
    gus: { name: 'GUS', portrait: 'gus', color: P.CREAM, blip: 470, speed: 34 },
    theo: { name: 'THEO', portrait: 'theo', color: P.CREAM, blip: 700, speed: 46 },
    kessler: { name: 'KESSLER', portrait: 'kessler', color: P.CREAM, blip: 560, speed: 38 },
  };
})(window.MORE = window.MORE || {});
