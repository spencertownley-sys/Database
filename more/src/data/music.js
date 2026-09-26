// MORE. — music
// One token per step (16th notes unless stepsPerBeat says otherwise).
// Notes: "A4", "Bb2", "C#5". "-" holds the previous note, "." is a rest.
// Drum tokens: k kick, s snare, h hat, o open hat, c metal click.
(function (M) {
  'use strict';

  const rest = (n) => Array(n).fill('.').join(' ');
  const hold = (n) => Array(n).fill('-').join(' ');
  const join = (...bars) => bars.join(' ');

  M.MUSIC = {
    // Title: A minor, slow. Am | F | C | G, melody over eight bars.
    title: {
      bpm: 76,
      stepsPerBeat: 4,
      channels: [
        {
          instr: 'lead',
          pattern: join(
            'A4 - - - C5 - - - E5 - - - - - - -',
            'F5 - - - E5 - - - C5 - - - - - - -',
            'G5 - - - E5 - - - C5 - - - D5 - - -',
            'B4 - - - - - - - - - - - . . . .',
            'A4 - - - C5 - - - E5 - - - A5 - - -',
            'A5 - - - G5 - - - F5 - - - E5 - - -',
            'E5 - - - D5 - - - C5 - - - D5 - - -',
            'E5 - - - - - - - - - - - . . . .'
          ),
        },
        {
          instr: 'ep',
          pattern: join(
            'A4 . E4 . C5 . E4 . A4 . E4 . C5 . E4 .',
            'F4 . C4 . A4 . C4 . F4 . C4 . A4 . C4 .',
            'E4 . C4 . G4 . C4 . E4 . C4 . G4 . C4 .',
            'D4 . B3 . G4 . B3 . D4 . B3 . G4 . B3 .'
          ),
        },
        {
          instr: 'bass',
          pattern: join(
            'A2 - - - - - - - A2 - - - E2 - - -',
            'F2 - - - - - - - F2 - - - C3 - - -',
            'C2 - - - - - - - C2 - - - G2 - - -',
            'G2 - - - - - - - G2 - - - D2 - - -'
          ),
        },
        { instr: 'pad', pattern: join('C4 ' + hold(15), 'A3 ' + hold(15), 'E4 ' + hold(15), 'B3 ' + hold(15)) },
      ],
    },

    // Prologue office: F major, gentle. Fmaj7 | Em7 | Dm7 | C
    office: {
      bpm: 88,
      stepsPerBeat: 4,
      channels: [
        {
          instr: 'ep',
          pattern: join(
            'F4 . A4 . C5 . E5 . C5 . A4 . F4 . A4 .',
            'E4 . G4 . B4 . D5 . B4 . G4 . E4 . G4 .',
            'D4 . F4 . A4 . C5 . A4 . F4 . D4 . F4 .',
            'C4 . E4 . G4 . C5 . G4 . E4 . C4 . E4 .'
          ),
        },
        {
          instr: 'bass',
          pattern: join(
            'F2 - - - - - - - F2 - - - C3 - - -',
            'E2 - - - - - - - E2 - - - B2 - - -',
            'D2 - - - - - - - D2 - - - A2 - - -',
            'C2 - - - - - - - C2 - - - G2 - - -'
          ),
        },
        { drum: true, pattern: 'h . . . c . . . h . . . c . . .' },
      ],
    },

    // The line: D minor, mechanical. Dm | Dm | Bb | C. Lead enters on bar 5.
    factory: {
      bpm: 104,
      stepsPerBeat: 4,
      channels: [
        {
          instr: 'arp',
          pattern: join(
            'D5 A4 F4 A4 D5 A4 F4 A4 D5 A4 F4 A4 D5 A4 F4 A4',
            'D5 A4 F4 A4 D5 A4 F4 A4 E5 A4 F4 A4 D5 A4 F4 A4',
            'D5 Bb4 F4 Bb4 D5 Bb4 F4 Bb4 D5 Bb4 F4 Bb4 D5 Bb4 F4 Bb4',
            'E5 C5 G4 C5 E5 C5 G4 C5 E5 C5 G4 C5 G5 E5 C5 G4'
          ),
        },
        {
          instr: 'bass',
          pattern: join(
            'D2 . D2 . D3 . D2 . D2 . D2 . D3 . C3 .',
            'D2 . D2 . D3 . D2 . D2 . D2 . D3 . A2 .',
            'Bb1 . Bb1 . Bb2 . Bb1 . Bb1 . Bb1 . Bb2 . A2 .',
            'C2 . C2 . C3 . C2 . C2 . C2 . C3 . E2 .'
          ),
        },
        {
          instr: 'lead',
          pattern: join(
            rest(64),
            'D5 - . F5 . A5 . . G5 - . F5 . E5 . .',
            'D5 - . F5 . A5 . . C6 - - A5 - - . .',
            'Bb5 - . A5 . F5 . . D5 - . F5 . G5 . .',
            'G5 - - E5 - - C5 - - E5 - - G5 - A5 -'
          ),
        },
        { drum: true, pattern: 'kc . h . s . hc . k . h k s . h h' },
      ],
    },

    // Night: the line is off. A clock and a hum.
    night: {
      bpm: 60,
      stepsPerBeat: 4,
      channels: [
        { instr: 'pad', pattern: join('D3 ' + hold(31), 'C3 ' + hold(31)) },
        { instr: 'bell', pattern: join('A5 ' + rest(31), 'F5 ' + rest(15), 'E5 ' + rest(15)) },
        { drum: true, pattern: 'c . . . c . . . c . . . c . . .' },
      ],
    },

    // Chapter end sting (plays once): Dm | Bb | C | D
    end: {
      bpm: 66,
      stepsPerBeat: 4,
      once: true,
      channels: [
        { instr: 'pad', pattern: join('D4 ' + hold(15), 'D4 ' + hold(15), 'E4 ' + hold(15), 'F#4 ' + hold(15)) },
        { instr: 'pad', pattern: join('F4 ' + hold(15), 'F4 ' + hold(15), 'G4 ' + hold(15), 'A4 ' + hold(15)) },
        { instr: 'bass', pattern: join('D2 ' + hold(15), 'Bb1 ' + hold(15), 'C2 ' + hold(15), 'D2 ' + hold(15)) },
        {
          instr: 'bell',
          pattern: join('A5 . . . . . . . D6 . . . . . . .', 'F5 . . . . . . . Bb5 . . . . . . .', 'G5 . . . . . . . C6 . . . . . . .', 'A5 ' + rest(15)),
        },
      ],
    },
  };
})(window.MORE = window.MORE || {});
