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
| `sim.js` | Pure deterministic 10 Hz sim: tick pipeline, Consequence Engine, phases, endings, day/night, offline progress |
| `gfx.js` | Render toolkit: value noise, colour, easing, pooled particles, pan/zoom camera, layer cache, bloom, post pass, quality budget |
| `art.js` | Procedural sprite factory — every prop painted once into an offscreen canvas, cached per decay bucket |
| `render_site.js` | Heightmap source site: terraced pit, slope lighting + AO, water table, weather, agents, seams |
| `render_factory.js` | Factory floor: stations, a belt that actually carries material, bottleneck signalling |
| `render_fp.js` | Ground-level walkthrough of the hall |
| `audio.js` | Optional procedural ambience (birdsong / machine hum cross-fade) plus click cues |
| `ui.js` | HUD, shop, message feed, choice modals, title + ending screens |
| `main.js` | Fixed-timestep loop, input, persistence, offline fast-forward, quality budget |

## Playing it

Click the ground to harvest — consecutive clicks build a streak multiplier and
can land a critical strike. Drag to pan, scroll to zoom, `1`/`2`/`3` switch
views, `Space` reallocates compute for a burst of throughput, and a glinting
seam on the land is worth clicking before it closes. Everything keeps running
while you are away.

The world runs a day/night cycle, so the same site reads differently at noon
and at midnight — and differently again a few hours of play later. Rendering
detail scales itself down automatically if the frame rate drops.

## The one structural rule

Upgrades are data records with a `stated` effect (shown, applied) and an
optional `hidden` effect (applied, never shown). The UI layer and the renderers
never read the Consequence Engine's internal fields — they see only derived
visual state (`state.visual`). `test/sim-test.mjs` plus a grep audit in CI
keep it that way. If you contribute, keep it that way too: the game never
tells; the world shows.
