# CHANGELOG.md

## v0.2.11

### Changed

- `GameState.hand` now represents a decoded base hand only. Own draw/discard traffic collected before a complete `ActionNewRound` or `deal_hand` no longer invents a partial base hand.
- Replay/live readiness uses the stricter known-hand signal, reducing false `gameStateHandUpdated` positives on Unity captures where `ActionNewRound` is still encoded.

## v0.1

### Added

- Initial Tampermonkey userscript architecture for Mahjong Soul web.
- Modular source layout for adapter, parser, game state, tile utilities, shanten, ukeire, analyzer, and overlay.
- Generated `majsoul-helper.user.js` build pipeline.
- Draggable and collapsible debug/training overlay.
- Manual hand input for algorithm testing.
- Current-hand display, dora display, table-state sections, debug events, and capture export controls.
- Standard shanten, seven-pairs shanten, thirteen-orphans shanten, ukeire, and discard-candidate analysis.
- Standardized game event types and normalized `GameState`.
- WebSocket observation and bounded raw capture recording.
- Unity WebGL runtime diagnostics and applicability detection.
- Partial Unity encoded payload decoding for selected draw/discard action shapes.
- Replay, capture doctor, validation, audit, smoke, build, and full verify scripts.
- Safety tests for no autoplay, no simulated clicks, no outbound message mutation, and no anti-cheat bypass behavior.

### Changed

- Shifted real-page capture strategy from legacy JS/Laya hooks toward Unity WebGL raw traffic and runtime diagnostics.
- Raised default capture limits to support larger live samples.
- Realtime discard-candidate advice is explicitly opt-in and disabled by default.
- Debug exports now include live state, runtime diagnostics, safety settings, and readiness information.

### Known Issues

- Full real-page game-state restoration is not complete.
- Unity `ActionNewRound` payloads are not yet decoded enough to recover initial hand, dora, scores, seat, and round metadata reliably.
- Several longer Unity action payloads remain encoded or unmapped.
- Current local ignored capture evidence is stale and not from version `0.2.11`.
- Batch capture validation and direct replay disagree on the stale local capture's readiness.
- Large parser/adapter/overlay modules should be split once decoder behavior stabilizes.
- Some user-facing text contains mojibake around punctuation examples.
