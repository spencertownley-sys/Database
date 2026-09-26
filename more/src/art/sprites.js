// MORE. — factory sprites
// Machines, the drone and Pip's beige box are transcribed pixel-for-pixel from
// the factory mockup (assets/reference/mockup_factory_native.png). Second
// animation frames and items are new, drawn in the same palette.
// Key: see palette.js. 'f' = floor-coloured hole, '.' = transparent.
(function (M) {
  'use strict';

  const R = (s) => M.gfx.rows(s);

  const SRC = {};

  // --- machines (22x22) --------------------------------------------------------
  SRC.spool0 = R(`
    .,,,,,,,,,,,,,,,,,,,,.
    ,gggggggggggggggggggg,
    ,gGGGGGGGGGGGGGGGGGGg,
    ,gGGGGGGGGGbGGGGGGGGg,
    ,gggggggbbbbbbbgggggg,
    ,gggggbbbbbbbbbbbgggg,
    ,ggggbbbbbbbbbbbbbggg,
    ,ggggbbbbbbtbbbbbbggg,
    ,gggbbbbbtttttbbbbbgg,
    ,gggbbbbtttttttbbbbgg,
    ,gggbbbbtttGGGGGGGGGG,
    ,ggbbbbtttttttttbbbbg,
    ,gggbbbbtttttttbbbbgg,
    ,gggbbbbtttttttbbbbgg,
    ,gggbbbbbtttttbbbbbgg,
    ,ggggbbbbbbtbbbbbbggg,
    ,ggggbbbbbbbbbbbbbggg,
    ,gggggbbbbbbbbbbbgggg,
    ,gggggggbbbbbbbgggggg,
    ,ggggggggggbggggggggg,
    ,gggggggggggggggggggg,
    .,,,,,,,,,,,,,,,,,,,,.
  `);
  SRC.spool1 = R(`
    .,,,,,,,,,,,,,,,,,,,,.
    ,gggggggggggggggggggg,
    ,gGGGGGGGGGGGGGGGGGGg,
    ,gGGGGGGGGGbGGGGGGGGg,
    ,gggggggbbbbbbbgggggg,
    ,gggggbbbbbbbbbbbgggg,
    ,ggggbbbbbbbbbbbbbggg,
    ,ggggbbbbbbbbbbbbbggg,
    ,gggbbbbbtttttbbbbbgg,
    ,gggbbbbtttttttbbbbgg,
    ,gggbbtttttGGGGGGGGGG,
    ,ggbbbbtttttttttbbbbg,
    ,gggbbbbtttttttbbbbgg,
    ,gggbbbbtttttttbbbbgg,
    ,gggbbbbbtttttbbbbbgg,
    ,ggggbbbbbbbbbbbbbggg,
    ,ggggbbbbbbbbbbbbbggg,
    ,gggggbbbbbbbbbbbgggg,
    ,gggggggbbbbbbbgggggg,
    ,ggggggggggbggggggggg,
    ,gggggggggggggggggggg,
    .,,,,,,,,,,,,,,,,,,,,.
  `);
  SRC.cutter0 = R(`
    .,,,,,,,,,,,,,,,,,,,,.
    ,gggggggggggggggggggg,
    ,gGGGGGGGGGGGGGGGGGGg,
    ,gGGGGGGGGGGGGGGGGGGg,
    ,gggGgggggggggggggggg,
    ,ggggGggggggggggggggg,
    ,gggggGgggggggggggggg,
    ,ggggggGggggggggggggg,
    ,gggggggGgggggggggggg,
    ,ggggggggGggggggggggg,
    ,gggggggggGgggggggggg,
    ,ggggggggggGggggggggg,
    ,gggggggggggGgggggggg,
    ,ggggggggggggGggggggg,
    ,gggggggggggggGgggggg,
    ,gggffffffffffffffggg,
    ,gggffffffffffffffggg,
    ,gggffffffffffffffggg,
    ,gggggggggggggggggggg,
    ,gggggggggggggggggggg,
    ,gggggggggggggggggggg,
    .,,,,,,,,,,,,,,,,,,,,.
  `);
  SRC.cutter1 = R(`
    .,,,,,,,,,,,,,,,,,,,,.
    ,gggggggggggggggggggg,
    ,gGGGGGGGGGGGGGGGGGGg,
    ,gGGGGGGGGGGGGGGGGGGg,
    ,gggggggggggggggggggg,
    ,gggggggggggggggggggg,
    ,gggggggggggggggggggg,
    ,gggGgggggggggggggggg,
    ,ggggGggggggggggggggg,
    ,gggggGgggggggggggggg,
    ,ggggggGggggggggggggg,
    ,gggggggGgggggggggggg,
    ,ggggggggGggggggggggg,
    ,gggggggggGgggggggggg,
    ,ggggggggggGggggggggg,
    ,gggffffffffGfffffggg,
    ,gggfffffffffGffffggg,
    ,gggffffffffffGfffggg,
    ,gggggggggggggggggggg,
    ,gggggggggggggggggggg,
    ,gggggggggggggggggggg,
    .,,,,,,,,,,,,,,,,,,,,.
  `);
  SRC.bender0 = R(`
    .,,,,,,,,,,,,,,,,,,,,.
    ,gggggggggggggggggggg,
    ,gGGGGGGGGGGGGGGGGGGg,
    ,gGGGGGGGGGGGGGGGGGGg,
    ,gggggggggggggggggggg,
    ,ggggggGGGggggggggggg,
    ,ggggggGGGggggggggggg,
    ,ggggggGGGggggggggggg,
    ,ggggggGGGggggggggggg,
    ,ggggggGGGggggggggggg,
    ,ggggggGGGggggggggggg,
    ,ggggggGGGggggggggggg,
    ,ggggggGGGggggggggggg,
    ,ggggggGGGgggggGGGggg,
    ,ggggggGGGgggggGGGggg,
    ,ggggggGGGgggggGGGggg,
    ,ggggggGGGgggggGGGggg,
    ,ggggggGGGGGGGGGGGggg,
    ,ggggggGGGGGGGGGGGggg,
    ,ggggggGGGGGGGGGGgggg,
    ,gggggggggggggggggggg,
    .,,,,,,,,,,,,,,,,,,,,.
  `);
  SRC.bender1 = R(`
    .,,,,,,,,,,,,,,,,,,,,.
    ,gggggggggggggggggggg,
    ,gGGGGGGGGGGGGGGGGGGg,
    ,gGGGGGGGGGGGGGGGGGGg,
    ,gggggggggggggggggggg,
    ,ggggggGGGggggggggggg,
    ,ggggggGGGggggggggggg,
    ,ggggggGGGggggggggggg,
    ,ggggggGGGggggggggggg,
    ,ggggggGGGgggggGGGggg,
    ,ggggggGGGgggggGGGggg,
    ,ggggggGGGgggggGGGggg,
    ,ggggggGGGgggggGGGggg,
    ,ggggggGGGgggggGGGggg,
    ,ggggggGGGgggggGGGggg,
    ,ggggggGGGgggggGGGggg,
    ,ggggggGGGgggggGGGggg,
    ,ggggggGGGGGGGGGGGggg,
    ,ggggggGGGGGGGGGGGggg,
    ,ggggggGGGGGGGGGGgggg,
    ,gggggggggggggggggggg,
    .,,,,,,,,,,,,,,,,,,,,.
  `);
  SRC.box0 = R(`
    .,,,,,,,,,,,,,,,,,,,,.
    ,gggggggggggggggggggg,
    ,gGGGGGGGGGGGGGGGGGGg,
    ,gGGGGGGGGGGGGGGGGGGg,
    ,gggggggggggggggggggg,
    ,gggggggggggggggggggg,
    ,gggggggggggggggggggg,
    ,ggffffffffffffffffgg,
    ,ggffffffffffffffffgg,
    ,ggffGGGGGGGGGGGGffgg,
    ,ggffGGGGGGGGGGGGffgg,
    ,ggffGGGGGGGGGGGGffgg,
    ,ggffffffffffffffffgg,
    ,ggffffffffffffffffgg,
    ,ggffffffffffffffffgg,
    ,ggffffffffffffffffgg,
    ,ggffffffffffffffffgg,
    ,ggffffffffffffffffgg,
    ,ggffffffffffffffffgg,
    ,gggggggggggggggggggg,
    ,gggggggggggggggggggg,
    .,,,,,,,,,,,,,,,,,,,,.
  `);
  SRC.box1 = R(`
    .,,,,,,,,,,,,,,,,,,,,.
    ,gggggggggggggggggggg,
    ,gGGGGGGGGGGGGGGGGGGg,
    ,gGGGGGGGGGGGGGGGGGGg,
    ,gggggggggggggggggggg,
    ,gggggggggggggggggggg,
    ,gggggggggggggggggggg,
    ,ggffffffffffffffffgg,
    ,ggffffffffffffffffgg,
    ,ggffffffffffffffffgg,
    ,ggffGGGGGGGGGGGGffgg,
    ,ggffGGGGGGGGGGGGffgg,
    ,ggffGGGGGGGGGGGGffgg,
    ,ggffffffffffffffffgg,
    ,ggffffffffffffffffgg,
    ,ggffffffffffffffffgg,
    ,ggffffffffffffffffgg,
    ,ggffffffffffffffffgg,
    ,ggffffffffffffffffgg,
    ,gggggggggggggggggggg,
    ,gggggggggggggggggggg,
    .,,,,,,,,,,,,,,,,,,,,.
  `);

  // --- Pip's floor drone (12x11) and its shadow ------------------------------------
  SRC.drone = R(`
    .,,,,,,,,,,.
    ,gggggggggg,
    ,gGGGGGGGGg,
    ,gGGGGGGGGg,
    ,gggggggggg,
    ,gggyoogggg,
    ,gggooogggg,
    ,gggooogggg,
    ,gggggggggg,
    ,gggggggggg,
    .,,,,,,,,,,.
  `);
  SRC.droneBlink = R(`
    .,,,,,,,,,,.
    ,gggggggggg,
    ,gGGGGGGGGg,
    ,gGGGGGGGGg,
    ,gggggggggg,
    ,gggggggggg,
    ,gggooogggg,
    ,gggggggggg,
    ,gggggggggg,
    ,gggggggggg,
    .,,,,,,,,,,.
  `);
  SRC.droneShadow = R(`
    ..,......,..
    ...,,,,,,...
  `);
  SRC.droneEye = R(`
    yoo
    ooo
    ooo
  `);

  // --- items on belts ----------------------------------------------------------------
  SRC.wire = R(`
    .,,,,,.
    ,ttttt,
    ,t,,,t,
    ,ttttt,
    .,,,,,.
  `);
  SRC.cut = R(`
    ,,,,,,,,
    ,WWWWWW,
    ,,,,,,,,
  `);
  SRC.cutSmall = R(`
    ,,,,,
    ,WWW,
    ,,,,,
  `);
  SRC.clip = R(`
    ,,,,,,,,,.
    ,WWWWWWWW,
    ,W,,,,,,W,
    ,W,WWWW,W,
    ,W,,,,,WW,
    ,WWWWWWW,.
    ,,,,,,,,..
  `);
  SRC.clipSmall = R(`
    ,,,,,,.
    ,WWWWW,
    ,W,WW,W
    ,WWWW,,
    ,,,,,,.
  `);

  // --- Pip portraits ------------------------------------------------------------------
  // v1: the beige line computer (exact from the mockup dialog portrait)
  SRC.pip1 = R(`
    .,,,,,,,,,,,,.
    ,cccccccccccc,
    ,cttttttttttc,
    ,cttttttttttc,
    ,ctttyoottttc,
    ,ctttooottttc,
    ,ctttooottttc,
    ,cttttttttttc,
    ,ctggggggggtc,
    ,cttttttttttc,
    ,cccccccccccc,
    .,,,,,,,,,,,,.
  `);
  SRC.pip1Blink = R(`
    .,,,,,,,,,,,,.
    ,cccccccccccc,
    ,cttttttttttc,
    ,cttttttttttc,
    ,cttttttttttc,
    ,ctttooottttc,
    ,cttttttttttc,
    ,cttttttttttc,
    ,ctggggggggtc,
    ,cttttttttttc,
    ,cccccccccccc,
    .,,,,,,,,,,,,.
  `);
  // v2: the payroll server (dark case, from the sprite sheet)
  SRC.pip2 = R(`
    .,,,,,,,,,,,,.
    ,GGGGGGGGGGGG,
    ,G,,,,,,,,,,G,
    ,G,gggggggg,G,
    ,G,ggyooggg,G,
    ,G,ggoooggg,G,
    ,G,ggoooggg,G,
    ,G,gggggggg,G,
    ,G,,,,,,,,,,G,
    ,GGGGGGGGGGGG,
    ,gg,gg,gg,ggg,
    .,,,,,,,,,,,,.
  `);
  // final: the sun
  SRC.pipSun = R(`
    ....,,,,,,....
    ..,,oooooo,,..
    .,oooyyyyooo,.
    .,ooyyyyyyoo,.
    ,oooyyWWyyooo,
    ,ooyyWWWWyyoo,
    ,ooyyWWWWyyoo,
    ,oooyyWWyyooo,
    .,ooyyyyyyoo,.
    .,oooyyyyooo,.
    ..,,oooooo,,..
    ....,,,,,,....
  `);

  // --- UI ------------------------------------------------------------------------------
  SRC.jam = R(`
    rr...rr
    .rr.rr.
    ..rrr..
    .rr.rr.
    rr...rr
  `);
  SRC.check = R(`
    .....ii
    ....ii.
    ii.ii..
    .iii...
    ..i....
  `);
  SRC.lock = R(`
    .,,,,.
    ,,..,,
    ,,..,,
    ,cccc,
    ,cooc,
    ,cccc,
  `);

  function build() {
    const A = (M.ART = M.ART || {});
    A.src = SRC;
    A.spr = {};
    for (const k in SRC) A.spr[k] = M.gfx.make(SRC[k]);
    A.portraits = A.portraits || {};
    A.portraits.pip1 = A.spr.pip1;
    A.portraits.pip1Blink = A.spr.pip1Blink;
    A.portraits.pip2 = A.spr.pip2;
    A.portraits.pipSun = A.spr.pipSun;
  }

  M.artBuilders = M.artBuilders || [];
  M.artBuilders.push(build);
})(window.MORE = window.MORE || {});
