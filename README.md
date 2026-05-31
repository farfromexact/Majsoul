# Majsoul Helper

Tampermonkey helper script for the web version of Mahjong Soul. The MVP focuses on visible state capture, debug inspection, manual hand analysis, shanten, ukeire, and discard candidates.

## Boundaries

- No auto discard.
- No auto click.
- No message mutation.
- No hidden execution.
- No anti-cheat bypass.
- Realtime advice is off by default and marked as training/review use.

## Install

1. Install Tampermonkey.
2. Run `npm run build`.
3. Open `install.html` and click `Open userscript`, or create a new userscript and paste `majsoul-helper.user.js`.
4. Open Mahjong Soul web.

Before using a real game page, open `smoke.html` and click `Emit sample traffic`. This local harness defines a fake page WebSocket, loads the generated userscript directly, and should produce a decoded local MVP sample: `round_start`, `draw_tile`, `discard_tile`, updated hand/round/dora/discards, and `MVP gate: 16/16` in the overlay debug section.

The generated userscript uses `@run-at document-start` and `@inject-into page` so the WebSocket hook is installed in the game page context as early as possible. It targets common Mahjong Soul web hosts including `mahjongsoul.game.yo-star.com`, `mahjongsoul.com`, and `maj-soul.com`. If the debug panel never shows `raw_message` entries after joining a table, confirm Tampermonkey supports page injection and that the generated metadata header is intact.

If the page context does not expose `WebSocket` at the first document-start tick, the helper retries hook installation every 250 ms until it succeeds. The helper also passively checks read-only page decode hooks for older JS/Laya builds: `net.MessageWrapper.decodeMessage` when the Mahjong Soul client exposes it, and `Laya.EventDispatcher.event` when decoded game actions are dispatched through the page runtime. These hooks observe already-decoded visible fields without mutating messages or event payloads. On Unity WebGL builds they are marked as not applicable instead of being treated as the current capture path. The debug panel shows install attempts, whether `WebSocket` is currently available, whether client decode or page dispatch is hooked/not applicable, and the binary sample size used for capture exports. Increase `Binary sample bytes` before collecting a new capture if replay diagnostics report truncated raw binary samples.

Current `https://game.maj-soul.com/1/` builds load as Unity WebGL rather than the older JS/Laya runtime. In that case the debug panel's `Runtime` line should show `Unity WebGL detected`; `client decode` and `page dispatch` are not the expected path. Seeing `.lq.ActionPrototype` action names but no usable action payload fields means the helper has reached the passive raw layer, but state restoration still needs a Unity runtime decoded hook or an action payload decoder. The helper passively observes `createUnityInstance` so captures can confirm whether the Unity instance and Module are visible for the next decoder-mapping step. Newer captures also include a bounded, read-only shape summary of Unity instance/Module property names and function names; this is meant for choosing the next decoded-message hook without dumping memory or calling runtime functions.

The current Unity field mapping includes narrow decoders for the short encoded `ActionDiscardTile` payload shape and two `ActionDealTile` shapes observed on `game.maj-soul.com/1/`, allowing replay to recover discard seat/tile/tsumogiri, draw seat, and self-draw tile for many actions. It intentionally does not guess long discard payloads, new-round hand data, meld details, or score changes until those encodings are mapped from real samples.

The debug panel also shows how many WebSocket instances were created after the hook installed and the most recent socket URLs. This helps distinguish an installation problem from a page state where the game client has not opened live traffic yet.

The script injects a draggable right-side panel. Use debug/manual input first, for example:

```text
123m456p789s11z
```

Red fives are accepted as `0m`, `0p`, and `0s`; they are normalized to ordinary fives for analysis. Spaces and common separators are ignored in manual input, so `123m 456p,789s、11z` is equivalent to `123m456p789s11z`.

## Development

```bash
npm install
npm test
npm run audit
npm run build
npm run smoke
npm run import-capture -- path/to/downloaded-capture.json
npm run capture-doctor -- path/to/capture.json
npm run replay -- path/to/capture.json
npm run validate-captures
npm run validate-captures -- --summary
npm run real-page-gate
npm run verify
```

Core modules live under `src/` and are tested independently from the userscript shell. `majsoul-helper.user.js` is generated from `src/main.js` and the source modules by `npm run build`; edit `src/` first, then rebuild the Tampermonkey file.

The test suite includes core algorithm tests, protocol parser tests, capture replay tests, and jsdom overlay tests. Overlay tests assert that realtime advice is off by default, manual input can trigger analysis, and debug copy actions remain available.

Use `npm run audit` to see requirement-level status for the original goal; it stays incomplete until a real Mahjong Soul page capture has matching page metadata, overlay live state, replayed `gameState`, and `acceptance.readyForRealPageMvp`. Use `npm run smoke` after building to run a command-line preflight of the generated userscript hook, parser, overlay, sanitized capture export, and live `gameState` update path. Use `npm run import-capture -- path/to/downloaded-capture.json` to copy a browser-downloaded overlay export into `captures/capture-real.json` without hand-renaming; with no source path it searches the default Downloads folder for the newest `majsoul-helper-capture*.json`. The importer may print non-blocking `Import notice` lines when the file is copied but lacks overlay snapshots, Mahjong Soul page metadata, ready preflight/safety data, or inbound raw WebSocket traffic. Use `npm run capture-doctor -- captures/capture-real.json` for the first single-file diagnosis after exporting a real sample; it prints replay readiness, real-page proof gaps, page/preflight/hook/event-buffer/safety status, truncation counts, traffic/action summaries, state-update status, live/replay mismatches, and next-step recommendations without opening the full JSON. Use `npm run validate-captures` after saving real-page exports under `captures/` to batch-check replay readiness, or add `-- --summary` for a concise triage view before reading full JSON. Use `npm run real-page-gate` for final acceptance; it runs `validate-captures --require-real-page-ready` and `goal-audit --strict` against `captures/`. Use `npm run verify` before sharing changes. It runs build, MVP checks, smoke preflight, tests, userscript syntax checks, the requirement audit, replay strict fixture validation, and capture batch validation against fixtures.

Safety boundary tests also assert that source modules do not introduce page click/keyboard automation, outbound game-action helpers, anti-detection behavior, or WebSocket payload mutation.

The generated userscript itself is also smoke-tested in jsdom and by the local `smoke.html` harness: the built file is evaluated as a page script, mounts the overlay, hooks a fake page WebSocket, records outbound/inbound traffic, and emits a parsed standard event.

The debug panel includes `Clear debug`, which clears the helper's captured event cache and parsed event history without uninstalling hooks or changing page traffic.

The hand section renders the base hand and `drawnTile` separately, and shows a compact `visibleTiles` summary used by ukeire counting. Manual input mode intentionally ignores captured visible tiles so algorithm tests remain isolated from live table state.

Hook diagnostics include WebSocket constructor static-property copy counts, whether `prototype.constructor` was patched, and whether the optional decoded-message/page-dispatch hooks are active. This helps catch page compatibility issues where the game client expects constants such as `WebSocket.OPEN` or `socket.constructor === WebSocket`, or where the current Mahjong Soul runtime no longer exposes the decode path we are observing.

The debug panel includes `Self-test`, which runs a local parser/diagnostics check without creating WebSocket connections, sending messages, recording fake traffic, or updating `gameState`. Use it after installation to confirm the overlay, adapter, and parser are wired before relying on live page samples.

The debug panel also shows a live `MVP gate` that mirrors the important replay acceptance checks: raw inbound traffic, decoded binary envelopes, ActionPrototype names, parsed draw/discard seats, state updates for hand/round/draw/discards/dora/scores/visible tiles/current turn, and clear warnings. When optional events appear, such as melds, claimed discards, `ActionAnGangAddGang` kan events, riichi, or round ends, their seat and state-update checks are promoted into the live gate too. Kan samples also require a known kan type, a four-tile visible kan meld, and own kan tile removal from hand/`drawnTile` when applicable. Treat missing gate items as the next thing to fix or resample before trusting realtime state restoration. A separate `Real-page preflight` line checks whether the current page looks like Mahjong Soul, capture is running, the hook is installed, live snapshots will be exported, the live MVP gate is complete, the retained event buffer has not dropped earlier traffic, no samples are truncated, no capture errors occurred, realtime advice is off, manual input is clear, and the no-automation/no-message-mutation boundary is recorded; when something is missing it shows a next-step hint. After export, run `npm run capture-doctor -- captures/capture-real.json` first, then `npm run real-page-gate`, which repeats the strict real-page checks and confirms replay/live-state agreement through the audit.

The debug panel also includes a capture limit input. The default retained event buffer is 10000 events, and changing it also changes the adapter's retained event buffer and is saved locally. Older saved values below 10000 are automatically upgraded so real-page samples are less likely to drop early round traffic. `Copy capture` and `Download capture` export only the most recent N helper events, which keeps real-page samples smaller and easier to share.

If the browser denies clipboard access, the overlay shows a selectable fallback text area containing the same JSON.

## Current MVP Notes

The WebSocket adapter records realtime inbound/outbound message summaries and exposes them in the debug panel. It also performs conservative parsing for readable JSON messages whose names clearly match known round/tile actions. On JS/Laya client builds, it can also observe `net.MessageWrapper.decodeMessage` or `Laya.EventDispatcher.event` after the page has decoded a message; this records only a sanitized decoded-message summary plus standardized visible game events. On the current Unity WebGL build, those globals may never appear, so raw ActionPrototype names can be visible while the inner action payload remains encoded or unmapped.

For binary frames, the helper parses the public outer Liqi-style envelope shape: frame type byte (`Notify`, `Request`, `Response`), request id when present, protobuf length-delimited method name, and a bounded payload hex sample. It recognizes `.lq.ActionPrototype`, extracts the inner `Action*` name, and conservatively reads simple visible fields for discard/draw-style actions when they are present. If the binary method itself is a direct `.lq.Action*` method, the helper also treats that method payload as an action payload for the same conservative field extraction and diagnostics.

The currently mapped binary `Action*` field numbers are aligned with the public generated Liqi schema for the visible state fields used by the MVP: `ActionNewRound` round metadata, starting hand, dora indicators, packed scores, riichi sticks, and wall count; `ActionDealTile` seat/tile/wall count/doras plus nested `LiQiSuccess`; `ActionDiscardTile` seat/tile/riichi/moqie/doras; `ActionChiPengGang` seat/type/tiles plus nested `LiQiSuccess`; `ActionAnGangAddGang` seat/type/tile/doras; `ActionBaBei` as a visible north reveal; `ActionLiqiSuccess` seat/score/riichi sticks; `ActionHule`/`RecordHule` packed `scores` field 5, nested `GameEnd.scores` fallback field 6, and doras field 7; `ActionLiuJu` nested `LiQiSuccess` plus `GameEnd.scores`; and `ActionNoTile`/`RecordNoTile` nested `NoTileScoreInfo` seat/score/doras fields. Dora-like action names without a dedicated mapping conservatively use tile-like payload strings as standard `dora` events. `ActionAnGangAddGang` type `2` is treated as added kan and upgrades an existing visible triplet when present; type `3` is treated as concealed kan and expanded to four visible tiles. Nested or direct `LiQiSuccess` is emitted as a standard `riichi` event so the state can update riichi flags, riichi sticks, and the declaring player's visible score. Direct replay-oriented `RecordNewRound`, `RecordDealTile`, `RecordDiscardTile`, `RecordChiPengGang`, `RecordAnGangAddGang`, `RecordBaBei`, `RecordHule`, `RecordLiuJu`, and `RecordNoTile` methods are mapped to the same standard event model for training/review workflows.

`GameRestore` snapshots are also decoded into a standard `round_start` event when present, including when they arrive inside `.lq.ResEnterGame` or `.lq.ResSyncGame` responses after entering, refreshing, or reconnecting to a table. This lets replay and the overlay restore visible state from snapshot fields such as current hand, dora indicators, wall count, scores, rivers, melds, and current turn. Nested restored `ActionPrototype` entries are replayed after the snapshot and counted in diagnostics.

Full gameplay protobuf decoding is still intentionally incremental. Unknown or incomplete payloads stay visible in debug output instead of being guessed.

The request/response id is decoded as little-endian, matching the public majsoul_wrapper protocol notes. Action payloads are read by protobuf field id for the currently supported visible fields instead of positional guessing.

## Capturing Real Page Samples

1. Install `majsoul-helper.user.js` in Tampermonkey and confirm the overlay title shows `Majsoul Helper v0.2.11`.
2. Open Mahjong Soul and enter a non-ranked or training-friendly room.
3. Keep realtime advice off unless explicitly testing it.
4. Use the overlay debug panel to confirm `raw_message` entries are appearing.
   The `Install` line should read `installed`, `v0.2.11`, and the `Runtime` line should identify whether the page is JS/Laya or Unity WebGL. On older JS/Laya builds, either `client decode hooked` or `page dispatch hooked` is the best signal that decoded visible fields are available. On current Unity WebGL builds, expect the legacy decode hooks to become `not-applicable-unity`; if the capture health says Unity Action names are captured but payload fields are encoded or unmapped, export the capture and treat the next task as finding a Unity runtime decoded hook or action payload decoder. Binary sample bytes default to 65536 in current builds.
5. Click `Download capture` for a local JSON file, or `Copy capture` if you prefer the clipboard path.
6. Import the downloaded file with `npm run import-capture -- path/to/majsoul-helper-capture.json`, or run `npm run import-capture` to use the newest matching file in your Downloads folder.
7. Run `npm run capture-doctor -- captures/capture-real.json` for a compact first diagnosis, then run `npm run real-page-gate` for the strict final real-page check.

The capture export contains sanitized page origin/path metadata, message direction, sanitized WebSocket URL, type, length, preview, bounded samples, `helperVersion`, `helperDiagnostics` for hook/config/runtime state at export time, a `verification` block with the recommended doctor/replay/real-page-gate commands, and `liveGameState`, `liveDebugSummary`, `liveMvpGate`, `liveSafetySettings`, `liveRealPagePreflight`, and `liveCaptureHealth` snapshots when exported from the overlay. `liveRealPagePreflight` includes a preflight version and the required check names so offline validation can reject stale exports from older helper builds. `liveSafetySettings` records whether realtime advice was manually enabled at export time and repeats the no-automation/no-mutation boundary. `helperDiagnostics.paused` records whether capture was paused when the file was copied. Query strings and hashes are not included in page or socket URL metadata. `helperDiagnostics.runtime.unityInstanceShape` and `unityModuleShape` list only bounded property/function/accessor names and counts, not values or heap contents. For binary messages it stores a bounded hex prefix, 65536 bytes by default, to support protocol mapping without exporting full traffic. The helper does not modify messages or issue game actions.

Capture exports may contain `raw_message` entries, live parsed standard events, and helper diagnostic events such as `capture_error`. Diagnostic events are kept in capture summaries but are not counted as parsed game events and are not replayed into `gameState`. New exports include a monotonic `eventId` on helper events so offline replay can restore capture order even when several entries share the same timestamp; older exports without `eventId` are still replayed with the original newest-first fallback. Offline replay parses raw samples first and de-duplicates parsed events that came from replayable raw messages; if a raw sample is truncated or cannot be replayed, the live parsed event is kept as a fallback. The replay output's `replayDedupe` section reports the ordering mode, how many raw-parsed events were produced, how many duplicate live parsed events were skipped, how many fallback parsed events were retained, and how many helper diagnostic events were ignored for state replay.

`helperDiagnostics.eventBuffer` records how many helper events were retained, the oldest/newest retained event ids, and how many older events were dropped before export. Replay recommendations will point this out when the buffer has already discarded earlier traffic, which usually means increasing `Capture limit` and collecting from the start of a round.

The WebSocket hook observes both `addEventListener("message")` and `onmessage`. It suppresses duplicate raw entries only when the same inbound `MessageEvent` is seen through both paths, so repeated messages with identical payloads are still retained in captures.

If the page delivers binary WebSocket data as `Blob`, the helper first records a non-truncated `blob` placeholder and then asynchronously reads a `blob-arraybuffer` copy for capture and parsing. It does not change the socket `binaryType`; use the `blob-arraybuffer` event for replay diagnostics.

Capture exports include a `summary` section with counts by source, raw kind, parsed event type, method name, ActionPrototype action name, and unparsed ActionPrototype action name. Use this first to see which live message families still need mapping.

Useful fields to inspect after copying a sample:

- `payload.envelope.frameTypeName`
- `payload.envelope.methodName`
- `payload.envelope.payloadSample`
- parsed standard events such as `discard_tile` when a method name is recognized

To iterate on protocol mapping outside the browser, paste a copied capture into a JSON file and run:

```bash
npm run capture-doctor -- capture.json
npm run replay -- capture.json
```

The capture doctor command is the quickest human-readable view for one file. It reports whether replay acceptance and real-page readiness pass, page/preflight/hook/event-buffer status, truncation counts, which replay checks are missing, whether the overlay live snapshot is present, whether live and replayed state disagree, and the first recommendations to follow before collecting another sample. The replay command prints full JSON with parsed event types and the resulting `gameState`, which is useful for validating new message mappings without opening Mahjong Soul repeatedly.

For batch readiness checks across exported files, run:

```bash
npm run validate-captures
npm run validate-captures -- --summary
npm run validate-captures -- --require-ready
npm run validate-captures -- --require-real-page-ready
npm run real-page-gate
npm run audit -- --strict
```

The summary command keeps the same replay checks but prints one compact line per capture with replay readiness, real-page readiness, missing checks, and the first next-step recommendation. `--require-ready` exits non-zero until at least one capture has `acceptance.readyForRealPageMvp: true`. `--require-real-page-ready` is stricter: it also requires Mahjong Soul page metadata, the current versioned `Real-page preflight` checklist at `15/15`, overlay live snapshots, safe `liveSafetySettings`, and `liveStateSnapshotMatches=true`. `npm run real-page-gate` runs that strict capture check and then the audit strict command before claiming real-page MVP readiness.

Replay output also includes `captureMetadata`, `captureIntegrity`, `topMethods`, `topActions`, `topParsedTypes`, `topReplayedParsedTypes`, `replayDedupe`, `diagnostics`, `actionDiagnostics`, `stateDiagnostics`, `liveStateComparison`, `liveOverlay`, `recommendations`, and `acceptance`. On real captures, inspect these first to find high-volume message families that still need parser coverage. `captureIntegrity` reports whether the file contains the expected overlay-export structure: page metadata, helper diagnostics, `liveGameState`, `liveDebugSummary`, `liveMvpGate`, `liveRealPagePreflight`, `liveSafetySettings`, verification commands, and event ids. `captureMetadata.page` records the sanitized page origin/path, `captureMetadata.verification` repeats the recommended offline commands embedded by the overlay export, while `captureMetadata.helperDiagnostics` records whether the hook was installed, whether capture was paused, whether WebSocket constructor compatibility checks passed, which page runtime was detected, and what binary sample size was used when the capture was copied. If `helperDiagnostics.paused` is true, replay recommendations will tell you to resume capture and collect fresh in-table traffic before trusting missing-event diagnostics. `captureMetadata.liveSafetySettings` records whether realtime advice was manually enabled and repeats the no-automation/no-mutation boundary. `liveOverlay` echoes overlay-exported `liveDebugSummary`, `liveMvpGate`, and `liveCaptureHealth` snapshots and compares common live gate checks with replay acceptance. `captureSummary.byDiagnosticType.capture_error` reports helper-side capture failures separately from parser coverage. `actionDiagnostics` lists captured ActionPrototype names, including those nested inside `GameRestore`, parse counts, debug-sample truncation flags, and grouped `actionPayloadFields` where available so new mappings can be investigated without hand-searching raw messages. `stateDiagnostics` reports replayed meld counts, whether `ActionChiPengGang` claimed discards were transferred out of rivers instead of double-counted, and whether `ActionAnGangAddGang`/`RecordAnGangAddGang` restored a four-tile kan meld and removed own kan tiles from hand or `drawnTile`. If a capture includes `liveGameState`, `liveStateComparison` compares the browser snapshot with the replayed state and lists mismatched keys; `acceptance.checks.liveStateSnapshotMatches` is then required for the real-page gate. `summary.byUnparsedActionName` and `diagnostics.unparsedActions` are the most direct lists of captured ActionPrototype names that did not replay into a standardized event; unsupported non-action responses such as auth-only methods remain under `diagnostics.unparsedMethods` instead of being replayed as empty state events. The overlay debug panel also surfaces these names and a compact action diagnostic summary after live traffic arrives. Check `diagnostics.truncatedRawMessages` before treating a missing parse as a protocol-mapping bug; `diagnostics.truncatedEnvelopes` and `diagnostics.truncatedActionPayloads` narrow that raw truncation count to samples whose envelope/action could still be identified. `recommendations` explains the next debugging step, including helper `capture_error` events, constructor static-property and `prototype.constructor` failures, and `acceptance.readyForRealPageMvp` gives a quick machine-readable pass/fail signal for the sampled actions.

The replay acceptance gate is intentionally stricter than simply seeing event names. A usable capture must parse draw and discard events with valid seats (`drawTileSeatParsed` and `discardTileSeatParsed`), update round metadata plus `gameState.hand`, own draw handling, `gameState.discards`, `gameState.doraIndicators`, `gameState.scores`, and `gameState.visibleTiles`, and leave `gameState.warnings` empty. If the final event stream implies an active player from a draw or call, `gameState.currentTurn` must match that seat. If the capture includes optional events such as `call_meld`, `riichi`, or `round_end`, those events become conditional acceptance checks too: seats must parse, melds/riichi/round-end reason must update, claimed chi/peng/gang discards must transfer out of rivers when claimable, `ActionAnGangAddGang` kan type must be known, kan melds must restore four visible tiles, own kan tiles must leave hand/`drawnTile`, and round-end scores must match parsed score payloads when present. If the player has already discarded after drawing, final `gameState.drawnTile` may correctly be `null`; check `stateDiagnostics.ownDrawTileEventsWithValidTile`, `stateDiagnostics.drawnTileRetained`, and `stateDiagnostics.stateUpdated.drawnTile`. If a seat gate fails, inspect the corresponding action payload sample and adjust field mapping before trusting state restoration.

Round-end parsing recognizes conservative `ActionHule`, `ActionLiuJu`, and `ActionNoTile` samples. `ActionNoTile` is treated as an exhaustive-draw `round_end`; when its `NoTileScoreInfo` entries include seat fields, scores are restored by seat rather than by message order, and the first visible doras list is merged into dora indicators. Complex settlement details should still be validated from a real capture before relying on score restoration. Three-player `ActionBaBei` is represented as a visible `4z` reveal so ukeire counts can treat that north tile as known.

For a step-by-step real page capture workflow, see `docs/real-page-sampling.md`.

After reviewing a real capture, `npm run replay -- captures/capture-real.json --fixture-out tests/fixtures/name.json` can create a sanitized parsed fixture for regression tests. Generated fixtures include `fixtureKind: "sanitized-replay"` and a small `sourceSummary` so they are distinguishable from raw overlay exports.

Current `gameState` includes hand, drawn tile, melds, discards, dora indicators, round metadata, riichi sticks, current turn, remaining wall tile count, parsed action step, riichi flags, scores, recent parsed events, and derived `visibleTiles`.

`gameState.warnings` reports non-blocking consistency issues such as impossible hand size, a known tile count above four, or invalid tile names ignored from parsed events. These warnings help identify protocol mapping mistakes during real-page sampling.

## MVP Acceptance Status

Implemented and locally verified:

- Modular source layout for adapter, state, tile parsing, shanten, ukeire, analyzer, overlay, and generated userscript.
- Tampermonkey metadata for document-start page-context injection.
- Draggable/collapsible overlay with manual hand input, game state display, debug messages, capture copy/download, and gameState copy.
- Realtime discard-candidate advice remains off by default and must be manually enabled.
- Shanten, ukeire, candidate discard analysis, red-five normalization, and state updates are covered by tests.
- WebSocket send/message hooks record traffic summaries and pass outbound payloads through unchanged.
- Readable JSON and Liqi-style binary ActionPrototype samples can be parsed conservatively into standard events.
- Offline capture replay can turn copied debug samples into parsed events and a final gameState.
- Safety tests guard against auto-clicking, auto-discard helpers, anti-detection behavior, and WebSocket payload mutation.

Still requires real Mahjong Soul page validation:

- Confirm Tampermonkey page injection captures live `raw_message` entries and records the current page runtime in capture diagnostics.
- On Unity WebGL builds, map a decoded Unity runtime hook or implement an action payload decoder so `ActionDealTile`, `ActionDiscardTile`, `ActionNewRound`, and related actions produce seats, tiles, scores, dora, and hand fields.
- Collect a fresh real capture after the Unity decode path or field mapping change and verify new round, hand, draw, discard, call, riichi, dora, round end, win, and draw-game events.
- Validate automatic gameState restoration against an actual non-ranked/training-friendly table.
