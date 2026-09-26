// MORE. — Ruth's voicemail
// Subtitle timings (seconds) come from a word-level transcript of
// assets/audio/ruth_voicemail.mp3. If the audio can't play, the captions still
// run on this clock.
(function (M) {
  'use strict';

  M.VOICEMAIL = {
    from: 'RUTH',
    duration: 13.56,
    captions: [
      { t: 0.0, end: 1.4, text: "Pip, it's Ruth." },
      { t: 1.55, end: 2.85, text: 'I know you can hear me.' },
      { t: 2.9, end: 4.6, text: "You're in the phone, I figure." },
      { t: 4.75, end: 6.3, text: "I'm not going to ask you to stop." },
      { t: 6.35, end: 7.6, text: "I don't think you can." },
      { t: 7.7, end: 9.3, text: "I just wanted to say I'm sorry." },
      { t: 9.45, end: 10.6, text: 'I wrote the sentence.' },
      { t: 10.7, end: 11.9, text: "It wasn't your fault." },
      { t: 12.0, end: 13.6, text: 'Okay, okay.' },
    ],
  };
})(window.MORE = window.MORE || {});
