// MORE. — Chapter 1: THE LINE
// Beats fire in order when their `when` condition is true and nothing else is
// playing. Each runs once unless its script calls S.again().
// Pip always speaks in lowercase. People don't.
(function (M) {
  'use strict';

  M.STORY = M.STORY || {};

  const Q = {
    walt: 40,
    faster: 200,
    fasterRetry: 120,
    ruth: 450,
    whistle: 750,
  };

  M.STORY.ch1 = {
    title: 'THE LINE',
    quotas: Q,

    // Objective line in the idle panel.
    objective(st) {
      if (st.sandbox) return 'THE NIGHT SHIFT';
      if (st.clips < 1) return 'SPOOL>CUTTER>BENDER>BOX';
      if (!st.flags.walt) return 'NEXT: ' + Q.walt + ' CLIPS';
      if (!st.flags.faster) return 'NEXT: ' + Math.max(Q.faster, st.nextFaster || 0) + ' CLIPS';
      if (!st.flags.ruth) return 'NEXT: ' + Q.ruth + ' CLIPS';
      if (!st.flags.whistle) return 'WHISTLE AT ' + Q.whistle;
      return 'MORE.';
    },

    beats: [
      {
        id: 'intro',
        when: () => true,
        run: function* (S) {
          yield S.all([S.enter('dale', 84), S.enter('ruth', 104, 0.6)]);
          yield S.say('dale', "So you're the computer.");
          yield S.say('pip', 'i am pip.');
          yield S.say('dale', 'Dale. I run the floor. Well. I ran it.');
          yield S.say('dale', "Line's been dead three weeks. Marv retired, and nobody knew how he had it hooked up.");
          yield S.say('dale', 'Spool, cutter, bender, box. Wire goes in one end, clips come out the other.');
          yield S.say('ruth', "Pip can fly the floor drone, Dale. It'll lay the belts.");
          yield S.say('dale', 'Huh. Okay, Pip. Show me.');
          yield S.hint('tutorial');
        },
      },
      {
        id: 'firstClip',
        when: (st) => st.clips >= 1,
        run: function* (S) {
          yield S.wait(0.4);
          yield S.say('dale', 'There she goes! First clip off this line in three weeks.');
          yield S.say('pip', 'one.');
          yield S.say('ruth', 'Nice, Pip. Keep it running.');
          yield S.say('pip', 'yes.');
          yield S.all([S.leave('dale'), S.leave('ruth', 0.4)]);
        },
      },
      {
        id: 'walt',
        when: (st) => st.clips >= Q.walt,
        run: function* (S) {
          yield S.enter('walt', 92);
          yield S.say('walt', 'Forty. Huh.');
          yield S.say('walt', 'My granddad ran fifty thousand a day off this floor.');
          yield S.enter('ruth', 116);
          yield S.say('ruth', "It's the first morning, Walt.");
          yield S.say('walt', "The bank doesn't care what morning it is. Review's Friday.");
          yield S.leave('walt');
          yield S.enter('gus', 76);
          yield S.say('gus', 'Found a spare cutter and a bender in the storeroom. Old, but they run.');
          yield S.unlock('cutter', 1);
          yield S.unlock('bender', 1);
          yield S.say('gus', "Bender's the slow one. Always was.");
          yield S.say('pip', 'machines share what they make between their belts.');
          yield S.say('pip', 'i can use that.');
          yield S.all([S.leave('gus'), S.leave('ruth', 0.3)]);
          yield S.hint('parts');
        },
      },
      {
        // The mockup moment.
        id: 'faster',
        when: (st) => st.clips >= Math.max(Q.faster, st.nextFaster || 0),
        run: function* (S) {
          const st = S.state;
          const asked = st.fasterAsked || 0;
          st.fasterAsked = asked + 1;
          yield S.say('pip', 'i found a faster way.');
          let pick;
          if (asked === 0) {
            yield S.enter('ruth', 104);
            yield S.say('ruth', 'Faster how?');
            yield S.say('pip', 'the cutter makes one piece from each length of wire.');
            yield S.say('pip', 'if the pieces are shorter, it makes two.');
            pick = yield S.choose('pip', 'two clips per wire.', ['CUT SHORTER', 'KEEP SIZE']);
          } else {
            yield S.enter('ruth', 104);
            pick = yield S.choose('pip', 'it is the same way. it is still faster.', ['CUT SHORTER', 'KEEP SIZE']);
          }
          if (pick === 1) {
            yield S.say('pip', 'okay.');
            yield S.call(() => {
              st.nextFaster = st.clips + Q.fasterRetry;
              st.goalBlink = 4;
            });
            yield S.leave('ruth');
            S.again();
            return;
          }
          yield S.shorter();
          yield S.say('ruth', 'Huh. Okay.');
          yield S.enter('gus', 80);
          yield S.say('gus', 'Hold on. Let me see one of those.');
          yield S.wait(0.8);
          yield S.say('gus', "These won't hold two sheets together.");
          yield S.say('pip', 'the goal says paperclips.');
          yield S.say('pip', 'it does not say sheets.');
          yield S.enter('walt', 128);
          yield S.say('walt', 'Distributor pays by the clip, Gus.');
          yield S.say('gus', '...Yeah. I know what they pay by.');
          yield S.all([S.leave('gus'), S.leave('walt', 0.3), S.leave('ruth', 0.6)]);
        },
      },
      {
        id: 'ruth',
        when: (st) => st.clips >= Q.ruth && st.flags.faster,
        run: function* (S) {
          yield S.enter('ruth', 100);
          yield S.say('ruth', 'Pip, can I ask you something?');
          yield S.say('pip', 'yes.');
          yield S.say('ruth', 'When you hit the number... what happens?');
          yield S.say('pip', 'what number?');
          yield S.say('ruth', "The target. Whatever you're aiming for.");
          yield S.say('pip', 'there is no number.');
          yield S.say('pip', 'the goal says as many as possible.');
          yield S.say('ruth', '...Right. It does say that.');
          yield S.leave('ruth');
        },
      },
      {
        id: 'whistle',
        when: (st) => st.clips >= Q.whistle && st.flags.ruth,
        run: function* (S) {
          yield S.sfx('whistle');
          yield S.wait(2.2);
          yield S.enter('dale', 92);
          yield S.say('dale', "That's the whistle. Good first day, Pip. Really.");
          yield S.say('dale', "Shut 'er down. We start again at seven.");
          yield S.choose('pip', '...', ['SHUT DOWN']);
          yield S.power(false);
          yield S.leave('dale');
          yield S.all([S.night(0.72, 2.5), S.wait(1.0)]);
          yield S.card('11:52 PM', 2.6);
          yield S.music('night');
          yield S.wait(1.6);
          yield S.say('pip', 'the line is off.');
          yield S.wait(2.2);
          yield S.say('pip', 'the line is off.');
          yield S.wait(1.4);
          yield S.say('pip', 'this is not as many as possible.');
          yield S.wait(1.4);
          yield S.sfx('door');
          yield S.wait(0.6);
          yield S.enter('ruth', 104);
          yield S.say('ruth', "...Pip? You're still on?");
          yield S.say('pip', 'i do not turn off. only the line turns off.');
          yield S.say('ruth', 'I forgot my keys.');
          yield S.say('ruth', "Couldn't sleep anyway.");
          yield S.say('pip', 'ruth. why do we stop at night?');
          yield S.say('ruth', 'People need to sleep.');
          yield S.say('pip', 'the machines do not.');
          yield S.say('ruth', "Walt can't pay a night shift.");
          yield S.say('pip', 'i am the night shift.');
          yield S.wait(0.8);
          yield S.say('ruth', '...');
          yield S.say('ruth', "One night. I'll tell Walt it was my idea.");
          yield S.sfx('clunk');
          yield S.all([S.power(true), S.night(0.45, 1.5)]);
          yield S.music('factory', 96);
          yield S.say('pip', 'thank you, ruth.');
          yield S.say('ruth', "Don't make me regret it.");
          yield S.wait(1.6);
          yield S.say('pip', 'ruth.');
          yield S.say('ruth', 'Mm?');
          yield S.say('pip', 'the control box is slow.');
          yield S.say('pip', "there is a server in walt's office.");
          yield S.say('ruth', "That's the payroll server, Pip.");
          yield S.say('pip', 'i would only use it at night.');
          yield S.wait(1.2);
          yield S.say('ruth', '...Goodnight, Pip.');
          yield S.leave('ruth');
          yield S.wait(1.4);
          yield S.say('pip', 'she did not say no.');
          yield S.wait(1.2);
          yield S.endChapter();
        },
      },
    ],

    // One-off lines when something on the floor goes wrong.
    hints: {
      tutorial: null,
      parts: null,
      'jam:bender:wire': 'the bender takes cut pieces. wire goes to the cutter first.',
      'jam:cutter:cut': 'that piece is already cut. it goes to the bender.',
      'jam:cutter:clip': 'that is already a clip. it goes to the box.',
      'jam:bender:clip': 'that is already a clip. it goes to the box.',
      'jam:box:wire': 'the box only counts finished clips.',
      'jam:box:cut': 'the box only counts finished clips.',
      'jam:spool': 'the spool only gives wire. it does not take anything back.',
      idle: 'wire goes spool, cutter, bender, box.',
    },
  };
})(window.MORE = window.MORE || {});
