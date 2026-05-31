# PROJECT_STATE.md

## Current Version

- Project version: `0.2.13`.
- Generated userscript: `majsoul-helper.user.js`.
- Main source entry: `src/main.js`.
- Target site: `https://game.maj-soul.com/1/`.

## One-Line State

The project has a working modular helper shell, analysis engine, debug overlay, WebSocket/Unity capture layer, and partial Unity action decoding, but full real-page game-state restoration is not complete because several Unity WebGL payloads remain encoded or unmapped.

## Implemented Features

- Tampermonkey userscript generation and install metadata.
- Draggable, collapsible overlay with training/review warning.
- Manual hand input for shanten, ukeire, and discard-candidate analysis.
- Realtime discard advice toggle is present and off by default.
- Normalized tile utilities with red-five support.
- Shanten calculation:
  - standard 4 melds + pair
  - seven pairs
  - thirteen orphans
  - open-meld standard handling
- Ukeire calculation over 34 tile types with visible-tile exclusion.
- Candidate discard analysis sorted by after-discard shanten and ukeire.
- Standardized `GameState` model and event application.
- WebSocket observation without outbound message mutation.
- Raw text/binary/blob capture with bounded sample bytes and event limits.
- Unity WebGL runtime diagnostics:
  - loader observation
  - `createUnityInstance` shape checks
  - Unity/applicability markers
- Message parser for readable JSON, decoded objects, Liqi-style binary envelopes, and selected Unity encoded action payloads.
- Replay, capture doctor, capture validation, audit, smoke, and full verify scripts.
- Safety tests that reject autoplay/click/anti-cheat patterns.

## Current Development Status

- Local goal audit is not fully complete.
- `npm run audit` proves most static/MVP requirements but still reports real-page validation as needing capture evidence.
- `captures/capture-real.json` is an ignored local sample from helper `0.2.6`, not current `0.2.13`.
- The latest ignored live capture from helper `0.2.11` preserved 1227 events with no buffer drop and parsed draw/discard traffic, but still lacked decoded `ActionNewRound` hand, dora, score, and round metadata.
- Replay now reports unmapped Unity payload families explicitly, long encrypted `ActionDealTile` payloads no longer create false riichi state, stale live parsed events from replayable raw samples are skipped, and decoded Record-style NewRound objects understand the mjai-reviewer `tiles0..tiles3` field contract.

## Architecture

- `src/main.js`
  - Initializes adapter, state, analyzer, and overlay.
  - Persists safe UI/capture config in `localStorage`.
  - Exposes `window.__majsoulHelper` for debug.
- `src/adapter/majsoulAdapter.js`
  - Installs WebSocket and runtime hooks.
  - Records raw samples and parsed events.
  - Exports capture diagnostics.
- `src/adapter/messageParser.js`
  - Converts raw/decoded traffic into standardized events.
  - Contains current Unity payload decoder knowledge.
- `src/core/gameState.js`
  - Applies standardized events.
  - Produces visible state and consistency warnings.
- `src/core/analyzer.js`
  - Runs shanten, ukeire, and discard simulation.
- `src/core/tile.js`
  - Tile parsing, normalization, indices, dora mapping.
- `src/core/shanten.js`
  - Shanten algorithms.
- `src/core/ukeire.js`
  - Ukeire enumeration and remaining-count logic.
- `src/core/realPageReadiness.js`
  - Real-page gate and safety/readiness checks.
- `src/ui/overlay.js`
  - DOM rendering, controls, copy/download, debug panels.
- `src/ui/styles.js`
  - Overlay CSS.
- `scripts/`
  - Build, replay, import, validation, audit, smoke, and verification utilities.
- `tests/`
  - Unit, integration, parser, UI, safety, build, docs, replay, and runtime tests.

## Data Flow

1. Tampermonkey injects the generated userscript at document start.
2. `src/main.js` initializes `MajsoulAdapter`, `GameState`, `Analyzer`, and `Overlay`.
3. `MajsoulAdapter` observes WebSocket/runtime traffic and stores bounded raw samples.
4. `messageParser` parses supported messages into normalized events.
5. `GameState.applyEvent()` updates hand/table state.
6. `Overlay` reads visible state and optional analyzer output.
7. Debug export includes raw capture, parsed events, live state, runtime diagnostics, safety settings, and readiness checks.

## Known Issues

- Full Unity WebGL state restoration is incomplete.
  - `ActionNewRound` initial hand, dora, scores, and round metadata are not reliably decoded from current Unity payloads.
  - Some longer `ActionDiscardTile`, `ActionDealTile`, `ActionChiPengGang`, `ActionAnGangAddGang`, `ActionHule`, and restore/sync payloads remain unmapped.
- The current blocker is mostly interpretation, not raw capture. WebSocket traffic and action names are visible; important payload fields are still encoded or unknown.
- `GameState.hand` is now treated as a decoded base hand; own draw/discard traffic without a decoded initial hand no longer invents a partial hand. Unity captures still need `ActionNewRound` decoding before full hand analysis can be trusted.
- Local ignored capture data is diagnostic-only. `captures/capture-real.json` is helper `0.2.6`; the latest user-supplied live capture was helper `0.2.11` and remains not ready.
- `npm run validate-captures -- --summary` reports the local capture as failed/not ready, while direct replay can produce diagnostics. This validation path needs investigation before being used as a release gate.
- `messageParser.js`, `majsoulAdapter.js`, and `overlay.js` are large modules with multiple responsibilities. Future decoder work risks regressions unless tested narrowly.
- Acceptance/readiness logic exists in both UI/runtime exports and replay/audit scripts, creating drift risk.
- Overlay render is mostly full re-render on updates. Event buffers are capped, but high-frequency live sessions could still expose UI performance issues.
- Some text/regex examples show mojibake around punctuation cleanup in hand parsing examples. Clean before user-facing release.
- Safety boundary tests are regex-based and may need tuning if legitimate code triggers false positives.

## Current Priorities

1. Capture a fresh `0.2.13` real-page session from round start with safe settings and large binary samples, then import/replay it.
2. Decode Unity payload fields for `ActionNewRound` first, especially initial hand, dora indicators, scores, seat, round, honba, riichi sticks, and wall count.
3. Use `diagnostics.unmappedUnityPayloads` from replay/doctor to choose the next action family instead of trusting accidental protobuf-looking bytes.
4. Make capture validation and replay agree on readiness/failure reasons.
5. Add regression tests for every newly decoded Unity action shape.
6. Keep no-automation safety boundaries intact while expanding live-state parsing.

## Risk Assessment

- Biggest product risk: without `ActionNewRound` and restore/sync decoding, the overlay cannot reliably know the player's full current hand after page refresh, reconnect, or mid-round start.
- Biggest engineering risk: overfitting decoders to one capture shape and silently producing plausible but wrong game state.
- Biggest compliance/safety risk: realtime advice could be misused. It is currently opt-in; keep it disabled by default and clearly labeled.
