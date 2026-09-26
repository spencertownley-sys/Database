// MORE. — Chapter 0: THE SENTENCE
// Halverson Fastener Co., Monday morning. Ruth installs Pip and types the goal.
// The player presses ENTER.
(function (M) {
  'use strict';

  M.STORY = M.STORY || {};

  M.STORY.prologue = function* (S) {
    yield S.card(['HALVERSON FASTENER CO.', 'MONDAY  6:40 AM'], 3.4);
    yield S.music('office');
    yield S.tween(S.view, 'room', 1, 1.2);
    yield S.wait(0.8);
    yield S.say('ruth', 'Okay. Okay, okay.');
    yield S.wait(0.6);
    yield S.sfx('door');
    yield S.enter('walt', 150);
    yield S.say('walt', "You're in early.");
    yield S.say('ruth', 'Wanted it running before the floor gets here.');
    yield S.say('walt', "So that's the thing.");
    yield S.say('ruth', "That's the thing. It's an optimizer. You give it a goal and it works out the steps.");
    yield S.say('walt', 'And it runs the line.');
    yield S.say('ruth', 'It runs the line. The machines, the timing, all of it. It learns.');
    yield S.say('walt', "Ruth. The bank review is Friday. I need numbers that don't look like a funeral.");
    yield S.wait(0.5);
    yield S.say('walt', 'Just make it make more.');
    yield S.leave('walt');
    yield S.sfx('door');
    yield S.wait(1.0);
    yield S.say('ruth', '...Okay.');
    yield S.say('ruth', "Okay, Pip. Let's give you a job.");

    // The terminal
    yield S.tween(S.view, 'room', 0, 0.5);
    yield S.mode('terminal');
    yield S.tween(S.view, 'term', 1, 0.5);
    yield S.wait(0.6);
    yield S.type('MAKE MORE PAPERCLIPS', 11);
    yield S.wait(1.2);
    yield S.say('ruth', 'More than what?');
    yield S.backspace(15);
    yield S.wait(0.5);
    yield S.type('AS MANY PAPERCLIPS AS POSSIBLE', 11);
    yield S.wait(1.4);
    yield S.say('ruth', 'As many as possible.');
    yield S.say('ruth', "That's the job, right?");
    yield S.waitEnter();
    yield S.accept();
    yield S.wait(1.4);
    yield S.hudIntro();
    yield S.mode('room');
    yield S.tween(S.view, 'room', 1, 1.0);
    yield S.wait(0.6);
    yield S.say('pip', 'hello, ruth.');
    yield S.say('ruth', 'Hi, Pip.');
    yield S.say('pip', 'i have a question.');
    yield S.say('ruth', 'Already?');
    yield S.say('pip', 'how many is possible?');
    yield S.wait(0.8);
    yield S.say('ruth', "...Let's find out.");
    yield S.wait(0.5);
    yield S.done();
  };
})(window.MORE = window.MORE || {});
