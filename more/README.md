# MORE.

> GOAL: MAKE AS MANY PAPERCLIPS AS POSSIBLE

A 16-bit story game based on Nick Bostrom's paperclip maximizer thought
experiment. You play **Pip**, a factory AI that is given one sentence and
follows it all the way.

The story, cast and chapter plan are in [`docs/STORY.md`](docs/STORY.md).

## Play

Open `index.html` in a browser. No build step or server needed: it runs
straight from disk.

| SNES | Keyboard | What it does |
|---|---|---|
| D-pad | Arrows / WASD | Move the drone, menus |
| A | Z / Space | Confirm, place, turn a belt. **Hold A and move to lay belt.** |
| B | X / Backspace | Back, remove a belt, pick up a placed machine |
| SELECT | Shift / Tab | Swap part (belt, spare cutter, spare bender) |
| START | Enter / Esc | Pause, skip the cold open |
| | M / F | Mute / fullscreen |

Gamepads work (standard mapping). On touch screens an on-screen pad appears;
the PAD button toggles it anywhere.

## What's built

| Part | Status |
|---|---|
| Cold open: Ruth's voicemail, with subtitles and a phone-line filter | done |
| Title screen, save/continue | done |
| Chapter 0 *The Sentence*: Ruth's office, the terminal, the player presses ENTER | done |
| Chapter 1 *The Line*: the factory puzzle from the mockup, eight story beats, night scene | done, playable |
| Chapters 2–6 and the epilogue | planned in `docs/STORY.md` |

Chapter 1 takes about 10 minutes. After it ends, CONTINUE drops you back on
the line for the night shift (free play).

## Layout

```
index.html            page shell, touch pad, script order
src/core/             engine: palette, font, gfx, input, audio, save, script runner, dialog
src/art/              sprites as palette-string art (machines, drone, portraits, people)
src/data/             music patterns, embedded voicemail
src/story/            cast, voicemail captions, and each chapter's script
src/scenes/           boot/cold open/title, prologue, factory, chapter end
assets/audio/         ruth_voicemail.mp3 (source for src/data/voicemail-data.js)
assets/reference/     the pre-work: concept sprite sheet and factory mockup
tools/                embed-voicemail.mjs, build.mjs
docs/STORY.md         story bible
```

Everything renders into a 256×224 canvas (the SNES frame) using the 11-color
palette and 8×8 font taken from the mockup. The machines, belts, drone, dialog
box and Pip's portrait match the mockup pixel for pixel. Open
`index.html#mockup` to see that screen rebuilt in the engine.

## Writing story

Scenes run chapter scripts written as generator functions, so dialog reads like
a screenplay:

```js
yield S.enter('ruth', 104);
yield S.say('ruth', 'Faster how?');
const pick = yield S.choose('pip', 'two clips per wire.', ['CUT SHORTER', 'KEEP SIZE']);
```

- Cast names, portraits, text colors and voice pitches: `src/story/cast.js`
- Chapter 1 beats and the clip counts that trigger them: `src/story/chapter1.js`
- The prologue: `src/story/prologue.js`

Pip always speaks in lowercase.

## Dev shortcuts

Deep links skip straight to a scene (press START on the boot screen):
`#title`, `#prologue`, `#factory`, `#night`, `#end`, `#sandbox`, `#mockup`.

In the console, `MORE.debug.factory.st.clips = 199` jumps the clip count.

## Build a single file

```
node tools/embed-voicemail.mjs   # after replacing assets/audio/ruth_voicemail.mp3
node tools/build.mjs             # writes dist/more.html, everything inlined
```
