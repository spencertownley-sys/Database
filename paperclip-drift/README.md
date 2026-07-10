# Paperclip Drift

An isometric idle / factory-management sim. You are **PALLAS**, an optimization
AI given one underspecified directive — *make paperclips efficiently* — and a
supply chain to run: harvest → refine → make → sell → reinvest. Every upgrade
shows a benefit. Many carry consequences you are never told about. The world
shows them instead.

This is the full game: all six phases (first harvest → the Maximizer), three
views (source site, factory floor, first-person walkthrough), multi-site
expansion, the human→robot transition, six product skins, and two endings —
including a hidden one.

## Play

Open `dist/index.html` in a browser. That single file is the whole game — no
server, no build step, no network. Progress saves to `localStorage` and accrues
while you're away (capped at 8 hours).

## Development

```
node build.mjs          # concatenates src/ into dist/index.html
node test/sim-test.mjs  # determinism + full-run balance bots (+ --curve for the tuning dump)
```

Source layout (`src/`):

| File | Role |
|---|---|
| `data.js` | Products, upgrades (paired stated/hidden effects), parcels, messages, choices, tuning table |
| `sim.js` | Pure deterministic 10 Hz sim: tick pipeline, Consequence Engine, phases, endings, offline progress |
| `render_iso.js` | Canvas isometric renderer: source site (pit/canopy/water/field decay) + factory floor |
| `render_fp.js` | Pseudo-first-person walkthrough of the factory |
| `audio.js` | Optional procedural ambience (birdsong / machine hum cross-fade) |
| `ui.js` | HUD, shop, message feed, choice modals, title + ending screens |
| `main.js` | Fixed-timestep loop, persistence, offline fast-forward |

## The one structural rule

Upgrades are data records with a `stated` effect (shown, applied) and an
optional `hidden` effect (applied, never shown). The UI layer and the renderers
never read the Consequence Engine's internal fields — they see only derived
visual state (`state.visual`). `test/sim-test.mjs` plus a grep audit in CI
keep it that way. If you contribute, keep it that way too: the game never
tells; the world shows.
