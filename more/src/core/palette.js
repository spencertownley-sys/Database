// MORE. — palette
// The first eleven colors are sampled exactly from the factory mockup
// (assets/reference/mockup_factory_native.png). The rest extend it for
// people, offices and the sky, keeping the same warm, low-saturation feel.
(function (M) {
  'use strict';

  const PAL = {
    // --- mockup palette -------------------------------------------------
    INK: '#000000',
    SHADOW: '#1a0f0f',
    FLOOR: '#3d2b2b',
    GRID: '#6b4a3a',
    STEEL_DK: '#7a7a8a',
    STEEL_LT: '#c0c0cc',
    CREAM: '#f2d3ab',
    ORANGE: '#e8a02a',
    WHITE: '#fff3e0',
    TAN: '#d9a066',
    YELLOW: '#ffd45c',
    // --- extensions -----------------------------------------------------
    SKIN: '#e8b07a',
    SKIN_DK: '#b87a4b',
    HAIR_GREY: '#c9c3c0',
    HAIR_BLONDE: '#f5d06a',
    HAIR_BROWN: '#7a4a2a',
    HAIR_DARK: '#2e1f1f',
    SUIT_BLUE: '#3d6db5',
    SUIT_BLUE_DK: '#25467e',
    SHIRT_GREEN: '#5a9e3c',
    SHIRT_GREEN_DK: '#35682a',
    RED: '#c8403a',
    RED_DK: '#842a28',
    JACKET_BROWN: '#8a5a34',
    GREY_SHIRT: '#8f8f9f',
    WOOD: '#9c6b3f',
    WOOD_DK: '#6b4426',
    WALL: '#5a4040',
    WALL_DK: '#46302f',
    SKY: '#6aa7d8',
    SKY_DAWN: '#d98a6a',
    PLANET: '#3a4766',
    PLANET_LT: '#56668e',
    NIGHT: '#1c2340',
    GREEN_GLOW: '#7ec850',
  };

  // Single-character keys used by the string-art sprites.
  // '.' and ' ' are always transparent.
  const KEY = {
    k: PAL.INK,
    ',': PAL.SHADOW,
    f: PAL.FLOOR,
    b: PAL.GRID,
    g: PAL.STEEL_DK,
    G: PAL.STEEL_LT,
    c: PAL.CREAM,
    o: PAL.ORANGE,
    W: PAL.WHITE,
    t: PAL.TAN,
    y: PAL.YELLOW,
    s: PAL.SKIN,
    S: PAL.SKIN_DK,
    h: PAL.HAIR_GREY,
    H: PAL.HAIR_BLONDE,
    n: PAL.HAIR_BROWN,
    N: PAL.HAIR_DARK,
    u: PAL.SUIT_BLUE,
    U: PAL.SUIT_BLUE_DK,
    e: PAL.SHIRT_GREEN,
    E: PAL.SHIRT_GREEN_DK,
    r: PAL.RED,
    R: PAL.RED_DK,
    j: PAL.JACKET_BROWN,
    q: PAL.GREY_SHIRT,
    d: PAL.WOOD,
    D: PAL.WOOD_DK,
    w: PAL.WALL,
    v: PAL.WALL_DK,
    x: PAL.SKY,
    X: PAL.SKY_DAWN,
    p: PAL.PLANET,
    P: PAL.PLANET_LT,
    i: PAL.GREEN_GLOW,
  };

  M.PAL = PAL;
  M.PALKEY = KEY;
})(window.MORE = window.MORE || {});
