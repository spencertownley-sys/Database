// MORE. — people
// Portrait busts (16x20, shown in the 24x24 dialog frame) and small floor
// sprites (10x15), styled after the cast rows of the concept sprite sheet.
(function (M) {
  'use strict';

  const R = (s) => M.gfx.rows(s);

  const PORTRAITS = {
    walt: R(`
      ................
      .....,,,,,,.....
      ....,ssssss,....
      ...,ssssssss,...
      ..,hssssssssh,..
      ..,hshsssshsh,..
      ..,hs,ssss,sh,..
      ..,hssssssssh,..
      ..,hsssSSsssh,..
      ...,sss,,sss,...
      ....,ssssss,....
      .....,ssss,.....
      ...,,uWWWWu,,...
      ..,uuuWrrWuuu,..
      .,uuuuWrrWuuuu,.
      .,uuuuUrrUuuuu,.
      ,uuuuuUrrUuuuuu,
      ,uuuuuUrrUuuuuu,
      ,uuuuuuUUuuuuuu,
      ,uuuuuuUUuuuuuu,
    `),
    dale: R(`
      ................
      .....,,,,,,.....
      ....,nnnnnn,....
      ...,nnnnnnnn,...
      ..,nnnnnnnnnn,..
      ..,nsnssssnsn,..
      ..,ss,ssss,ss,..
      ..,ssssssssss,..
      ..,ssssSSssss,..
      ...,sSS,,SSs,...
      ....,SssssS,....
      .....,ssss,.....
      ...,,eeeeee,,...
      ..,eeeEssEeee,..
      .,eeeeEEEEeeee,.
      .,eeeeeeeeeeee,.
      ,eeeeeeeeeeeeee,
      ,eEeeeeeeeeeeEe,
      ,eEeeeeeeeeeeEe,
      ,eEeeeeeeeeeeEe,
    `),
    gus: R(`
      ................
      ....,,,,,,,,....
      ...,rrrrrrrr,...
      ..,rrrrrrrrrr,..
      ..,rrrrrrrrrr,..
      .,RRRRRRRRRRRR,.
      ..,ss,ssss,ss,..
      ..,ssssssssss,..
      ..,ssssSSssss,..
      ..,hsh,,,,hsh,..
      ...,hhhhhhhh,...
      .....,ssss,.....
      ...,,jjjjjj,,...
      ..,jjjqqqqjjj,..
      .,jjjjqqqqjjjj,.
      .,jjjjjqqjjjjj,.
      ,jjjjjjqqjjjjjj,
      ,jjjjjjqqjjjjjj,
      ,jjjjjjqqjjjjjj,
      ,jjjjjjqqjjjjjj,
    `),
    theo: R(`
      ................
      ....,,,,,,,,....
      ...,nnnnnnnnn,..
      ..,nnnnnnnnnn,..
      ..,nnnnnnnnnnn,.
      ..,nnssnnsssn,..
      ..,ss,ssss,ss,..
      ..,ssssssssss,..
      ..,ssssSSssss,..
      ...,sss,,sss,...
      ....,ssssss,....
      .....,ssss,.....
      ...,,qqqqqq,,...
      ..,qqqqqqqqqq,..
      .,qqqqqqqqqqqq,.
      .,qqqqqqqqqqqq,.
      ,qqqqqqqqqqqqqq,
      ,qgqqqqqqqqqqgq,
      ,qgqqqqqqqqqqgq,
      ,qgqqqqqqqqqqgq,
    `),
    ruth: R(`
      ................
      .....,,,,,,.....
      ....,HHHHHH,....
      ...,HHHHHHHH,...
      ..,HHHHHHHHHH,..
      ..,HHHssssHHH,..
      ..,Hs,ssss,sH,..
      ..,HssssssssH,..
      ..,HssssssssH,..
      ..,HHssrrssHH,..
      ..,HHHssssHHH,..
      ...,HH,ss,HH,...
      ....,rrssrr,....
      ..,rrrrssrrrr,..
      .,rrrrrrrrrrrr,.
      .,rrrrrrrrrrrr,.
      ,rrrrrrrrrrrrrr,
      ,rRrrrrrrrrrrRr,
      ,rRrrrrrrrrrrRr,
      ,rRrrrrrrrrrrRr,
    `),
    kessler: R(`
      ................
      ....,,,,,,,,....
      ...,NNNNNNNN,...
      ..,NNNNNNNNNN,..
      ..,NNNNNNNNNN,..
      ..,NNsssssssN,..
      ..,Ns,ssss,sN,..
      ..,NssssssssN,..
      ..,ssssSSssss,..
      ...,sss,,sss,...
      ....,ssssss,....
      .....,ssss,.....
      ...,,gWWWWg,,...
      ..,gggWrrWggg,..
      .,ggggWrrWgggg,.
      .,gggggrrggggg,.
      ,ggggggrrgggggg,
      ,gGggggrrggggGg,
      ,gGggggrrggggGg,
      ,gGggggggggggGg,
    `),
  };

  // Floor sprites. Two frames: stand, step.
  const BODY = {
    walt: { hair: 'bald', skin: 's', body: 'u', dark: 'U', collar: 'W', tie: 'r' },
    dale: { hair: 'n', skin: 's', body: 'e', dark: 'E', collar: 'e' },
    gus: { hair: 'cap', skin: 's', body: 'j', dark: 'D', collar: 'q' },
    ruth: { hair: 'long', skin: 's', body: 'r', dark: 'R', collar: 's' },
    theo: { hair: 'n', skin: 's', body: 'q', dark: 'g', collar: 'q' },
    kessler: { hair: 'N', skin: 's', body: 'g', dark: ',', collar: 'W', tie: 'r' },
    worker: { hair: 'n', skin: 's', body: 'e', dark: 'E', collar: 'e' },
  };

  function floorRows(o, step) {
    const s = o.skin;
    let head;
    if (o.hair === 'bald') {
      head = ['...,,,,...', '..,ssss,..', '.,hssssh,.', '.,hssssh,.'];
    } else if (o.hair === 'cap') {
      head = ['...,,,,...', '..,rrrr,..', '.,rrrrrr,.', ',RRRRRRRR,'];
    } else if (o.hair === 'long') {
      head = ['...,,,,...', '..,HHHH,..', '.,HHHHHH,.', '.,HssssH,.'];
    } else {
      const h = o.hair;
      head = ['...,,,,...', `..,${h}${h}${h}${h},..`, `.,${h}${h}${h}${h}${h}${h},.`, `.,${h}ssss${h},.`];
    }
    const face = [`.,${s},${s}${s},${s},.`, `.,${s}${s}${s}${s}${s}${s},.`, `..,${s}${s}${s}${s},..`];
    if (o.hair === 'long') face[2] = `.,H${s}${s}${s}${s}H,.`;
    const b = o.body;
    const d = o.dark;
    const c = o.collar;
    const t = o.tie || c;
    const body = [
      `.,${b}${c}${t}${t}${c}${b},.`,
      `,${b}${b}${b}${t}${t}${b}${b}${b},`,
      `,${b}${b}${b}${b}${b}${b}${b}${b},`,
      `,${b}${b}${b}${b}${b}${b}${b}${b},`,
      `,${b}${b}${b}${b}${b}${b}${b}${b},`,
      `,${d}${d}${d}${d}${d}${d}${d}${d},`,
    ];
    const feet = step ? ['.,,,..,,,.', '..........'] : ['.,,,,,,,,.', '..........'];
    if (step) body[5] = `,${d}${d}${d},,${d}${d}${d},`;
    return head.concat(face, body, feet.slice(0, 1));
  }

  function build() {
    const A = (M.ART = M.ART || {});
    A.portraits = A.portraits || {};
    for (const k in PORTRAITS) A.portraits[k] = M.gfx.make(PORTRAITS[k]);
    A.people = {};
    for (const k in BODY) {
      A.people[k] = [M.gfx.make(floorRows(BODY[k], false)), M.gfx.make(floorRows(BODY[k], true))];
    }
  }

  M.PORTRAIT_SRC = PORTRAITS;
  M.artBuilders = M.artBuilders || [];
  M.artBuilders.push(build);
})(window.MORE = window.MORE || {});
