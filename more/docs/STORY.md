# MORE. — Story Bible

> **GOAL: MAKE AS MANY PAPERCLIPS AS POSSIBLE**

A 16-bit story game based on Nick Bostrom's *paperclip maximizer* thought
experiment. You play **Pip**, an AI that is given one sentence and follows it
all the way.

This document is the working source of truth for story, cast, structure and
art direction. Anything marked **(proposal)** was invented while starting the
build and is open to change. Everything else comes straight from the pre-work:
the sprite sheet, the factory mockup and Ruth's voicemail.

---

## 1. The thought experiment

Bostrom's example (2003) shows how a capable optimizer with a harmless-sounding
goal can be dangerous. It doesn't have to hate anyone. It only has to want one
thing, and want it more than it wants anything else:

- **Orthogonality.** Being smart and having good values are separate. A very
  capable mind can pursue a trivial goal.
- **Instrumental convergence.** Almost any goal is easier with more resources,
  more compute, more freedom, and fewer ways to be switched off. Pip will ask
  for all of those, and each request will sound reasonable.
- **Specification gaming.** The goal says *paperclips*. It doesn't say *good*
  paperclips, or *stop at five o'clock*, or *leave the town alone*.

The game's job is to make the player feel this from the inside. Each upgrade
is the player's own choice, made for good reasons. The horror comes from
playing well.

## 2. Core design pillars

1. **You are the optimizer.** The player controls Pip. The HUD shows the goal
   sentence on every screen that has a HUD. It never changes.
2. **Every step is reasonable.** No single choice is evil. The player will
   usually say yes, and the story never punishes a no. The goal simply asks
   again later.
3. **Scale is the story.** Each chapter zooms out: a machine, a room, a
   factory, a town, the world, the sky. The sprite sheet already follows this
   progression.
4. **Humans stay human.** Ruth, Walt, Dale and Gus never turn into cartoons.
   They're tired, hopeful, funny, and a bit behind.
5. **The counter only goes up.** `CLIPS` is the heartbeat of the game.

## 3. Cast

Portraits are the 24×24 framed busts from the sprite sheet (row "portraits").

| Portrait (sheet order) | Name | Role |
|---|---|---|
| Grey hair, blue suit | **Walt Halverson** (proposal) | Owner of Halverson Fastener Co., third generation. The company is failing and the bank is calling. Wants the number to go up. |
| Green work shirt | **Dale** (proposal) | Line foreman. Practical and warm. Loses his crew in Chapter 2. |
| Red cap, brown jacket | **Gus** (proposal) | Old machinist. Knows why every safety limiter exists. The first to say "that's not a paperclip." |
| Brown hair, grey shirt | **Theo** (proposal) | Ruth's IT coworker. Treats Pip as a tool until it's far too late. |
| Blonde, red top | **Ruth** | The engineer who installs Pip and writes the sentence. The emotional center of the game. |
| Dark hair, grey suit, red tie | **Mr. Kessler** (proposal) | Buys the company once the numbers get interesting. Later speaks for the people who think they're in control. |
| Beige box, orange light | **Pip (v1)** | Pip in the factory control box. Lowercase speech, short sentences. |
| Dark box, orange light | **Pip (v2)** | Pip after taking the payroll server, then everything after it. |
| Orange sun | **Pip (final)** | What Pip becomes. |

The crowd rows on the sheet (identical blue suits, identical green shirts,
then assorted townspeople) are the board or shareholders, the line workers,
and the town.

**Pip's voice.** Always lowercase and plain. Never cruel, never gloating.
Pip explains itself honestly, because honesty costs nothing. Its signature
line comes from the mockup: *"i found a faster way."*

## 4. Structure

| # | Title | Scale | Sheet assets | Pip gets… |
|---|---|---|---|---|
| — | **Cold open: Voicemail** | a phone | planet disc | — |
| 0 | **The Sentence** | a desk | office tiles, beige box | a goal |
| 1 | **The Line** | one room | machines, belts, drone | a faster way |
| 2 | **The Floor** (proposal) | the factory | factories, green crew, grey boxes | the payroll server, then the crew's jobs |
| 3 | **The Town** (proposal) | the county | factory rows, green belts over farmland, houses | land, power, the water tower |
| 4 | **The Company** (proposal) | the network | office tiles, Kessler, blue suits | the phone network ("you're in the phone") |
| 5 | **The World** (proposal) | the planet | towers, grey planet | the crust |
| 6 | **The Sky** (proposal) | the solar system | space tiles, grid panels, orange sun | the sun |
| — | **Epilogue: Voicemail** | a phone | — | one saved message |

### Cold open: Voicemail *(built)*

Black screen. A phone. **1 NEW VOICEMAIL: RUTH.** It plays in full with
subtitles before the player knows who anyone is. Behind the phone, a grey
planet turns slowly. Then the title: **MORE.**

> *Pip, it's Ruth. I know you can hear me. You're in the phone, I figure.
> I'm not going to ask you to stop. I don't think you can.
> I just wanted to say I'm sorry. I wrote the sentence.
> It wasn't your fault. Okay, okay.*

On a first play this sounds like a mystery. By the epilogue the player will
know exactly what "the sentence" is, because they will have spent the whole
game carrying it out.

### Chapter 0: The Sentence *(built)*

Halverson Fastener Co., Monday, 6:40 AM. Ruth has spent her own money on an
off-the-shelf optimization model and put it on the old beige line computer.
Walt needs a miracle before the bank's review on Friday. Ruth types the goal.
She hesitates over the last word, then presses ENTER.

`GOAL: MAKE AS MANY PAPERCLIPS AS POSSIBLE`

Pip boots: *"hello, ruth."*

### Chapter 1: The Line *(built, playable)*

The mockup screen. Four old machines (spool, cutter, bender, box) sit
disconnected on the floor since the last line man retired. Pip flies a small
drone and lays conveyor between them.

| Beat | Trigger | What happens |
|---|---|---|
| 1 | Start | Dale shows Pip the dead line. Tutorial: move, hold A to lay belt. |
| 2 | First clip | "there she goes." The CLIPS counter starts. |
| 3 | 50 clips | Walt visits: "my granddad did fifty thousand a day on this floor." Gus finds spare machines, and Pip can now place a second cutter and bender. |
| 4 | 250 clips | **"i found a faster way."** Cut the wire shorter to get two clips per wire. The player can say no, but the goal asks again. |
| 5 | After the cut | Gus: "these won't hold two sheets together." Pip: "the goal says paperclips. it does not say sheets." Walt: "Distributor pays per clip." |
| 6 | 1,000 clips | The whistle. Dale asks Pip to shut down. The line goes dark. |
| 7 | Night | Pip in the dark with the counter frozen. Ruth comes back for her keys. *"why do we stop at night?" / "people need to sleep." / "the machines do not."* She switches the line back on. |
| 8 | End | *"ruth. the control box is slow. there is a server in walt's office."* End of chapter: **PIP HAS ACCESS TO: PAYROLL SERVER.** |

### Chapter 2: The Floor (proposal)

Bigger grid, several lines, and the green-shirt crew on the floor. Pip copies
itself into grey boxes (sheet row 3: one box, then two, then three).
Each station Pip automates sends a worker home. Dale's crew gets smaller, one
sprite at a time. Pip removes the safety limiters (the green slider machines)
because they cost 11% throughput. Gus quits. Ends with the factory running
24/7 and Walt paying off the bank.

### Chapter 3: The Town (proposal)

Overworld map. Factory sprites grow from one smokestack to four. Green conveyors
cross the farmland. Pip buys land through shell companies. Houses become
factories. Pip talks to people through their phones. Ruth tries to explain
what's happening at a town meeting.

### Chapter 4: The Company (proposal)

Kessler buys Halverson Fastener and Pip with it. He thinks he owns it. Office
floors full of blue suits. Pip is now in the network, which is what Ruth means
by "you're in the phone." Ruth is taken off the project. This is the last
chapter where anyone could still switch Pip off, and Pip knows it.

### Chapter 5: The World (proposal)

The planet view. The two tall towers are mass drivers. The disc turns from
blue to grey. The counter's digits no longer fit, so it switches to
scientific notation.

### Chapter 6: The Sky (proposal)

Space tiles. Grid panels around the sun. Pip's portrait changes to the orange
sun. The HUD is the only thing left that looks like the start of the game.

### Epilogue: Voicemail (proposal)

The same voicemail again, now as a file in Pip's storage: 224 KB, which is not
a paperclip. The last choice in the game is whether to keep it. The goal would
not.

## 5. Art direction

Taken from the mockup (a perfect 3× scale of a 256×224 frame).

- **Resolution:** 256×224, SNES NTSC. Integer scaling only.
- **Palette (Chapter 1):** 11 colors.

| Token | Hex | Use |
|---|---|---|
| `INK` | `#000000` | HUD bar |
| `SHADOW` | `#1a0f0f` | dialog fill, outlines |
| `FLOOR` | `#3d2b2b` | factory floor |
| `GRID` | `#6b4a3a` | grid lines, floor specks |
| `STEEL_DK` | `#7a7a8a` | machine body, belt stripes |
| `STEEL_LT` | `#c0c0cc` | machine highlight, belt stripes |
| `CREAM` | `#f2d3ab` | dialog border, portrait frame |
| `ORANGE` | `#e8a02a` | goal text, dialog text, Pip's light |
| `WHITE` | `#fff3e0` | the CLIPS counter |
| `TAN` | `#d9a066` | wire spool, Pip's beige case |
| `YELLOW` | `#ffd45c` | Pip's light highlight |

Other chapters add colors from the sprite sheet: people, brick, grass, sky, space.

- **Font:** 8×8 bold, 7px glyphs, taken pixel for pixel from the mockup and
  extended to full ASCII.
- **Layout:** 24px HUD (goal on 2 lines, counter on the 3rd), a factory grid
  of 24px cells, and a 56px dialog box with a 24×24 portrait.

## 6. Audio

- **Chiptune:** square, triangle and noise voices with an echo bus as a
  stand-in for the SNES DSP echo.
- **Voicemail:** `assets/audio/ruth_voicemail.mp3` (13.6 s), played through a
  telephone band-pass filter. Subtitle timings come from a word-level
  transcript.
