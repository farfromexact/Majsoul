# TODO.md

## P0 - Must

### Decode Unity `ActionNewRound`

- Goal: recover initial hand, dora indicators, scores, seat, round, honba, riichi sticks, wall count, and round wind from real Unity payloads.
- Modules: `src/adapter/messageParser.js`, `src/core/gameState.js`, `tests/messageParser.test.js`, replay fixtures.
- Complexity: High.

### Capture Fresh Current-Version Evidence

- Goal: collect/import a safe `0.2.13` real-page capture from round start and use it as the main verification artifact.
- Modules: `scripts/import-capture.mjs`, `scripts/replay-capture.mjs`, `scripts/validate-captures.mjs`, `docs/real-page-sampling.md`.
- Complexity: Medium.

### Fix Capture Validation Drift

- Goal: make `npm run validate-captures -- --summary` and direct `npm run replay -- <capture>` agree on readiness and failure causes.
- Modules: `scripts/validate-captures.mjs`, `scripts/replay-capture.mjs`, `scripts/capture-doctor.mjs`, tests.
- Complexity: Medium.

### Prevent Partial-State Misleading UI

- Goal: clearly distinguish "observed rivers/draws only" from "full reliable hand/table state" in overlay and exported diagnostics.
- Status: Partially improved in `0.2.11` through `0.2.13`; unknown starting hands no longer get synthesized from own draw/discard traffic, long encrypted deal payloads no longer synthesize false riichi state, replay skips stale live parsed events from raw samples that can be replayed, and decoded Record-style NewRound fields can restore `tiles0..tiles3` when a self seat is known.
- Modules: `src/core/gameState.js`, `src/ui/overlay.js`, `src/core/realPageReadiness.js`, tests.
- Complexity: Medium.

## P1 - Important

### Decode More Unity Action Shapes

- Goal: map longer discard/deal variants, calls, closed/add kan, hule, exhaustive draw, game restore, and sync payloads.
- Modules: `src/adapter/messageParser.js`, `src/core/events.js`, `src/core/gameState.js`, replay tests.
- Complexity: High.

### Add Decoder Fixture Corpus

- Goal: create small sanitized byte fixtures for each known Unity action shape with expected standardized events.
- Modules: `tests/fixtures`, `tests/messageParser.test.js`, `tests/replayCapture.test.js`.
- Complexity: Medium.

### Refactor Large Modules

- Goal: split parser codecs, adapter capture plumbing, and overlay sections to reduce regression risk.
- Modules: `src/adapter/messageParser.js`, `src/adapter/majsoulAdapter.js`, `src/ui/overlay.js`.
- Complexity: Medium.

### Align Readiness Gates

- Goal: centralize real-page readiness criteria so overlay, replay, validate, and audit use the same logic.
- Modules: `src/core/realPageReadiness.js`, `scripts/goal-audit.mjs`, `scripts/replay-capture.mjs`, `src/ui/overlay.js`.
- Complexity: Medium.

### Clean User-Facing Text Encoding

- Goal: remove mojibake from hand-input examples and punctuation cleanup text.
- Modules: `README.md`, `src/core/tile.js`, `src/ui/overlay.js`, tests.
- Complexity: Low.

## P2 - Optimization

### Improve Overlay Performance

- Goal: reduce full DOM re-render cost during high-frequency live capture.
- Modules: `src/ui/overlay.js`, `src/ui/styles.js`, UI tests.
- Complexity: Medium.

### Better Capture Controls

- Goal: make capture limit and binary sample byte inputs robust across Tampermonkey/browser quirks, including keyboard editing.
- Modules: `src/ui/overlay.js`, `src/main.js`, tests.
- Complexity: Low.

### Add Developer Handoff Fixtures

- Goal: commit sanitized minimal captures or synthetic replay fixtures that prove real-page parser behavior without leaking raw live data.
- Modules: `captures/README.md`, `tests/fixtures`, replay tests.
- Complexity: Medium.

### Improve Documentation Workflow

- Goal: document exact install/update/capture/replay loop for future agents and testers.
- Modules: `README.md`, `docs/real-page-sampling.md`, `docs/PROJECT_STATE.md`.
- Complexity: Low.

### Add Analyzer Edge-Case Tests

- Goal: broaden coverage for open hands, red-five duplicate visibility, dead-wall dora accounting, and invalid known tile counts.
- Modules: `src/core/analyzer.js`, `src/core/ukeire.js`, `tests/shanten.test.js`, `tests/ukeire.test.js`.
- Complexity: Low.
