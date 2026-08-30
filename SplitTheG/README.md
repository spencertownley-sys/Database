# Split the G

A native iPhone game about the craft of pouring and drinking a stout — for
**Griffin's Extra Stout**, a fictional brand with a griffin emblem and a big
serif **G** on the glass. No real beverage brands appear anywhere in the code,
assets, or copy.

## Three modes

| Mode | What it is |
|---|---|
| **The Perfect Pour** | Photoreal-track two-part pour driven by device tilt: hold 45°, ease off at the griffin line, wait out the (compressed, 4-second) cascade, top off to a 15 mm head. Five-component score. |
| **Split the G** | The bar challenge, blind: physically raise the phone to your lips and tip it like a glass. Audio + haptics are the whole feedback channel; land the liquid line dead on the G. Scored in millimetres, with a quarter-speed replay. |
| **The Rush** | Landscape cartoon arcade mode: 3–5 taps, an accelerating queue of pub customers, patience meters, combos, three walkouts and you're done. |

## Ground rules (from the build prompt)

- No real-world beverage brands, anywhere, including asset names and fixtures.
- No realistic settle time — the cascade resolves in `Balance.cascadeSettleDuration` (4s).
- No consumption or intoxication mechanics. Ships 17+ behind a local age gate.
- **Zero network requests.** No accounts, no analytics, no third-party SDKs.
  `PrivacyInfo.xcprivacy` declares no data collection and no tracking.
- Game rules live in the pure Swift engines (`Engines/`), never in an `SKScene`.
- Every tunable lives in `Config/Balance.swift` or `Config/GlassGeometry.swift`.

## Project layout

- `SplitTheG.xcodeproj` — the app (Xcode 16+, iOS 17.0+, iPhone only).
- `SplitTheG/Engines` + `SplitTheG/Config` — pure, platform-free game logic.
- `SplitTheG/Scenes` — SpriteKit rendering (greybox-tier art, feel-first).
- `SplitTheG/Services` — motion, haptics, audio, persistence, replay.
- `SplitTheG/Views` — SwiftUI shell, HUDs, results, stats, settings, age gate.
- `SplitTheGTests` — XCTest suites for the engines + recorded motion-trace fixtures.
- `Package.swift` — compiles **only** the engines and their tests, so the game
  logic can be tested on any platform with a Swift toolchain:

```sh
swift test   # runs the full engine suite (works on Linux/CI, no Xcode needed)
```

## Development notes

- Audio is synthesized in code (`AudioSynth`) so the MVP needs no sound assets;
  see `Resources/Audio/README.md`.
- `Customers.atlas` currently holds generated placeholder sprites; real cartoon
  art replaces the PNGs 1:1 (`customer_<archetype>@2x.png`).
- CoreMotion and CoreHaptics don't exist in the Simulator: use the touch
  fallback in Split mode, and verify motion/haptics on hardware.
- DEBUG builds include a Balance tuner and a motion-trace recorder
  (Home → "Balance Tuner (debug)"); both are compiled out of Release.
