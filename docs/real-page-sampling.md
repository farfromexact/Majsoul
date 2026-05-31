# Real Page Sampling Checklist

Use this checklist to collect a useful Mahjong Soul capture for protocol mapping. Prefer a non-ranked, friendly, or training-friendly table.

## Before Opening Mahjong Soul

1. Run `npm run build`.
2. Run `npm run smoke` and confirm it prints `"ok": true`.
3. Install or update `majsoul-helper.user.js` in Tampermonkey.
4. Open `smoke.html` and click `Emit sample traffic`. Confirm the overlay appears and the debug section shows a decoded local MVP sample: `round_start`, `draw_tile`, `discard_tile`, updated hand/round/dora/discards, and `MVP gate: 16/16` from the fake WebSocket traffic.
5. Confirm the userscript header contains:
   - `@run-at document-start`
   - `@inject-into page`
   - `@grant none`
   - a `@match` entry for the server you are sampling, including `mahjongsoul.game.yo-star.com`, `mahjongsoul.com`, or `maj-soul.com`
6. Keep realtime advice off unless explicitly testing it.

## In The Browser

1. Open Mahjong Soul web.
2. Confirm the `Majsoul Helper` overlay appears.
3. Open the overlay debug section and click `Self-test`. It should report `Self-test: ok`; this only checks local parser wiring and does not send WebSocket messages or modify `gameState`.
4. Join a safe testing room.
5. Confirm the `Install` line reads `installed`, `capture running`, `WebSocket available`, and ideally `client decode hooked` after the game code has loaded.
6. Check the `Hooks` line. `constructor`, `send`, and `addEventListener` should read `ok`; the constructor static-property copy count should not show failures; and `prototype.constructor` should read `patched`. `onmessage` may use `accessor` or a fallback mode; if it reads `non-configurable`, continue sampling but pay close attention to whether inbound traffic appears. On current Mahjong Soul builds, the passive client-decode hook is important because raw `ActionPrototype.data` may not be plain protobuf even though the action name is visible.
7. Check the `sockets` count. If it remains `0`, reload the game client after the userscript is enabled and wait for Mahjong Soul to open its WebSocket.
8. Wait for `raw_message` entries.
9. Perform normal visible game actions only: draw, discard, call if the table naturally offers it, riichi if the test situation naturally reaches it.
10. Do not use any auto-clicking or auto-discard tool.
11. Watch the live `MVP gate` line in the debug panel. Missing items such as `drawTileSeatParsed`, `gameStateHandUpdated`, or `gameStateDoraIndicatorsUpdated` tell you whether to collect from the start of a round, wait for more normal play, increase sample bytes, or inspect protocol fields. If the sample includes optional events such as `call_meld`, `ActionAnGangAddGang`, `riichi`, or `round_end`, their seat and state-update checks are promoted into the same gate.
12. Watch the `Real-page preflight` line. It should reach `15/15` before export; if not, follow the next-step hint shown in the same line. It checks the Mahjong Soul page, hook/capture status, live snapshots, live MVP gate, retained event buffer, truncated samples, capture errors, and the safety snapshot used by the real-page gate. After export, run the displayed `capture-doctor` command first, then `npm run real-page-gate` because only replay and strict audit can confirm `liveStateSnapshotMatches=true` and the exported `liveSafetySettings` safety boundary.
13. Leave `Capture limit` at the 500-event default for a first real sample, or raise it toward 1000 before collecting from the start of a noisy round. The helper also expands its retained in-page event buffer to match this value.
14. Leave `Binary sample bytes` at the 2048-byte default for first pass. If replay later reports truncated raw binary samples, raise it toward 4096 and collect a fresh sample.
15. Click `Download capture`, then import the downloaded JSON with `npm run import-capture -- path/to/majsoul-helper-capture.json`; if it is still in the default Downloads folder, `npm run import-capture` will pick the newest matching `majsoul-helper-capture*.json`. You can also use `Copy capture` and paste the JSON into a local file under `captures/`.

## Save And Replay

1. Save or paste the exported JSON into a local file, for example `captures/capture-real.json`. For downloaded overlay exports, use:

   ```bash
   npm run import-capture -- path/to/majsoul-helper-capture.json
   ```

   The importer validates that the JSON has a helper capture `events` array, creates `captures/` when needed, and refuses to overwrite `captures/capture-real.json` unless you pass `--force` or choose another `--out` path. `Import notice` lines are non-blocking early warnings for files that were copied but lack overlay snapshots, Mahjong Soul page metadata, ready preflight/safety data, inbound raw WebSocket traffic, or show obvious sampling problems such as paused capture, dropped event-buffer entries, helper `capture_error` events, or truncated raw samples; still run the doctor and real-page gate after import.

2. Run:

   ```bash
   npm run capture-doctor -- captures/capture-real.json
   npm run replay -- captures/capture-real.json
   ```

   Start with `capture-doctor` for one file. It prints replay readiness, real-page proof gaps, page/preflight/hook/event-buffer/safety status, truncation counts, traffic/action summaries, state-update status, live/replay mismatches, and the next recommendations without opening the full JSON. To batch-check every JSON export under `captures/`, run:

   ```bash
   npm run validate-captures
   npm run validate-captures -- --summary
   npm run validate-captures -- --require-ready
   npm run validate-captures -- --require-real-page-ready
   npm run real-page-gate
   npm run audit -- --strict
   ```

   Use the summary form first when several captures are present. It keeps the machine-readable JSON mode unchanged for automation, but prints each file's replay readiness, real-page readiness, missing checks, and first recommendation in a short text view.

3. Inspect:
   - `captureMetadata.helperDiagnostics`
   - `captureMetadata.page`
   - `captureMetadata.verification`
   - `captureMetadata.liveSafetySettings`
   - `captureMetadata.helperDiagnostics.hooks`
   - `captureMetadata.helperDiagnostics.paused`
   - `topMethods`
   - `topActions`
   - `captureSummary.byUnparsedActionName`
   - `topParsedTypes`
   - `topReplayedParsedTypes`
   - `captureIntegrity`
   - `diagnostics.unparsedActions`
   - `actionDiagnostics`
   - `diagnostics.truncatedRawMessages`
   - `diagnostics.truncatedActionPayloads`
   - `stateDiagnostics`
   - `liveStateComparison`
   - `liveOverlay`
   - `stateDiagnostics.eventCounts`
   - `stateDiagnostics.stateUpdated`
   - `stateCoverage`
   - `recommendations`
   - `acceptance`
   - `gameState`

The overlay debug section also shows `Unparsed actions` and a compact `Action diagnostics` block while sampling live traffic. Treat those action names as the next parser mapping candidates after checking that raw capture samples are not truncated. In replay output, `actionDiagnostics` gives one compact sample per ActionPrototype name, including parse counts, debug-sample truncation flags, payload lengths, and grouped `actionPayloadFields`.

When the browser delivers WebSocket data as `Blob`, captures include a small `blob` placeholder followed by an async `blob-arraybuffer` sample. The placeholder is not a truncation signal; replay diagnostics and parser mapping should use the `blob-arraybuffer` entry.

If `acceptance.missing` includes `drawTileSeatParsed` or `discardTileSeatParsed`, the parser found a draw/discard action but did not recover a valid seat number. First check whether `captureMetadata.helperDiagnostics.hooks.decodedMessage` is true and whether the capture has `client_decode` events; if not, collect again after the install line says `client decode hooked`. If client decode is present but seat is still missing, inspect the corresponding `ActionDealTile` or `ActionDiscardTile` decoded payload summary or `payload.binaryEnvelope.actionPayloadSample` in replay output, then adjust field mapping before trusting any automatic table state.

If `acceptance.missing` includes `gameStateHandUpdated`, collect a sample that includes the start of a round or inspect `ActionNewRound` hand tile fields before treating the capture as a complete MVP state-restoration pass.

If `acceptance.missing` includes `gameStateRoundMetadataUpdated`, inspect `ActionNewRound` `chang`, `ju`, or round fields before trusting wind/round display.

If `acceptance.missing` includes `gameStateDoraIndicatorsUpdated`, inspect `ActionNewRound`, `ActionDealTile`, `ActionAnGangAddGang`, or parsed `dora` payload fields before trusting ukeire counts.

If `acceptance.missing` includes `gameStateScoresUpdated`, inspect `ActionNewRound`, `ActionHule`, `ActionLiuJu`, or `ActionNoTile` score fields before trusting point display.

The current parser maps the visible MVP fields from the public generated Liqi schema: `ActionNewRound` uses `tiles` field 4, `dora` field 5, packed `scores` field 6, `liqibang` field 8, `left_tile_count` field 13, and `doras` field 14; `ActionDealTile` uses `doras` field 6 and nested `LiQiSuccess` field 5; `ActionDiscardTile` uses `is_liqi` field 3, `moqie` field 5, and `doras` field 8; `ActionChiPengGang` uses `seat` field 1, `type` field 2, and nested `LiQiSuccess` field 5; `ActionAnGangAddGang` uses `seat` field 1, `type` field 2, tile field 3, and `doras` field 6; `ActionLiqiSuccess` uses `seat` field 1, `score` field 2, and `liqibang` field 3; `ActionHule`/`RecordHule` use packed `scores` field 5, nested `GameEnd` fallback field 6 with packed `scores` field 1, and `doras` field 7; `ActionLiuJu` checks nested `GameEnd` field 2 for packed `scores` field 1 and nested `LiQiSuccess` field 5; `ActionNoTile`/`RecordNoTile` use `scores` field 3, then nested `NoTileScoreInfo.seat` field 1, `doras` field 6, and `score` field 7. Dora-like action names without a dedicated mapping use tile-like payload strings as standard `dora` events. If real captures disagree with these assumptions, trust the capture diagnostics and update tests with a sanitized fixture.

Replay-oriented direct methods are also normalized when captured: `RecordNewRound`, `RecordDealTile`, `RecordDiscardTile`, `RecordChiPengGang`, `RecordAnGangAddGang`, `RecordBaBei`, `RecordHule`, `RecordLiuJu`, and `RecordNoTile` map into the same standard round, draw, discard, meld, and round-end events. This is useful when validating training/review pages as well as live table traffic.

If the capture contains `.lq.GameRestore`, or a `.lq.ResEnterGame`/`.lq.ResSyncGame` response with nested `game_restore`, replay should emit a `round_start` snapshot before any restored actions. Check that this snapshot restores hand, dora indicators, wall count, scores, rivers, melds, current turn, and riichi flags from the visible table. Nested `ActionPrototype` entries inside restore payloads are counted in `topActions`, `diagnostics.rawActionTotal`, and `actionDiagnostics`.

For field mapping, also inspect `payload.binaryEnvelope.actionPayloadFields`. It groups observed protobuf varints, printable strings, and tile-like strings by field number, which is usually faster and safer than reading the hex sample first.

For unparsed action families, start with `actionDiagnostics[].sample.actionPayloadFields`. It is the same field grouping lifted into a top-level replay section, sorted so unparsed and high-count action names appear first.

If `acceptance.missing` includes `gameStateWarningsClear`, inspect `warnings` and compare `gameState.hand`, `gameState.drawnTile`, `gameState.discards`, and `gameState.visibleTiles` against the visible table. This usually means the parser has enough event names to run but not enough reliable fields to restore state safely.

The overlay hand section shows `drawnTile` separately from the base hand and a compact visible-tile summary used for ukeire. During real-page sampling, compare those lines with the table before trusting candidate discard remaining-tile counts.

Use `stateDiagnostics.stateUpdated` as a quick checklist for live state restoration. It reports whether hand, drawn tile, discards, melds, dora indicators, round metadata, riichi, current turn, scores, visible tiles, and warnings have been updated after replay. `stateUpdated.drawnTile` means a valid own draw was observed and applied; `stateDiagnostics.drawnTileRetained` tells you whether a drawn tile is still present in the final state. It is normal for `drawnTileRetained` to be `false` after the player has already discarded.

When `Download capture` or `Copy capture` is used from the overlay, the export includes `verification`, `liveGameState`, `liveDebugSummary`, `liveMvpGate`, `liveSafetySettings`, `liveRealPagePreflight`, and `liveCaptureHealth` snapshots. `liveRealPagePreflight` includes a preflight version and the required check names; if these are missing or stale, `validate-captures` and `real-page-gate` will ask for a fresh export from the current helper build. `liveSafetySettings.realtimeAdviceEnabled` should normally be `false` for real-page sampling unless you are explicitly testing training-mode advice, and `capture-doctor` prints the same safety line for quick review. Replay output then includes `captureIntegrity`, which checks whether those overlay-export fields are present, `liveStateComparison`, which compares that browser state snapshot with the replayed state and lists mismatched keys, plus `liveOverlay`, which echoes the live debug/gate snapshot and compares common live gate checks with replay acceptance. Use these before manually reading the full JSON when checking whether state restoration matches the visible table. If a state snapshot is present, `acceptance.checks.liveStateSnapshotMatches` must be `true`; otherwise increase `Capture limit`, collect from the start of a round, or inspect the mismatched keys before trusting replayed state.

Captured helper events can include both raw WebSocket samples and live parsed standard events. The replay command treats raw samples as the source of truth when they are complete enough to parse, skips matching parsed duplicates, and preserves parsed fallback events when the raw sample was truncated or otherwise unreplayable. Check `replayDedupe.skippedLiveParsedEvents` and `replayDedupe.fallbackLiveParsedEvents` before interpreting a difference between captured event count and replayed event count as data loss.

Newer live exports can also include `decoded_message` diagnostics and standard events with `source: "client_decode"`. These come from the page's own `net.MessageWrapper.decodeMessage` return value after the original function has run. The helper stores only sanitized decoded-message metadata and standardized visible fields; it does not modify the decoded object or the WebSocket payload.

New capture exports include `eventId` on helper events. Replay uses `replayDedupe.ordering: "eventId"` when every event has one; older captures without `eventId` use `newestFirstFallback`.

The live hook de-duplicates only the same inbound `MessageEvent` observed through both `addEventListener("message")` and `onmessage`. If the game sends two separate messages with identical payloads, both should remain in the capture.

Check `captureMetadata.helperDiagnostics.eventBuffer`. If `droppedBeforeRetained` is greater than `0`, earlier helper events were already outside the retained capture window; increase `Capture limit` and collect from the start of a round.

Use `stateCoverage.required` and `stateCoverage.requiredMissing` for the strict MVP gate. Events that may not occur in every sample, such as melds, kan upgrades/closed kan, riichi, and round ends, are listed under `stateCoverage.optional`; once one of those events is observed, its seat/state checks are promoted into the required gate so a capture cannot be marked ready while a parsed optional event fails to update `gameState`.

Use `npm run real-page-gate` for the final real-page gate. It runs `npm run validate-captures -- --require-real-page-ready` first, then `npm run audit -- --strict` against the same capture directory. Unlike plain `--require-ready`, these do not treat synthetic fixtures as final real-page proof; the real-page item requires Mahjong Soul page metadata, the current versioned `Real-page preflight` checklist at `15/15`, overlay live snapshot data, safe `liveSafetySettings` with realtime advice off and no automation/message mutation, `liveStateSnapshotMatches=true`, and replay acceptance.

When parsed events appear but the corresponding state remains unchanged, `recommendations` will point at the likely field group to inspect, such as `ActionNewRound` round fields, riichi seat fields, or hule/liuju score fields.

If a capture only contains non-action Liqi methods such as auth or lobby responses, replay leaves them under `diagnostics.unparsedMethods` and does not treat them as empty `round_start` state updates. Keep the table open until `ActionPrototype` or `game_restore` traffic appears before changing parser mappings.

If `recommendations` says the capture was exported while paused, click `Resume`, wait for fresh in-table traffic, and export a new capture before interpreting missing event diagnostics.

If `recommendations` reports helper `capture_error` events, inspect the recent debug events first. These are capture-layer diagnostics, not parsed game events, and they are ignored by offline state replay.

If `diagnostics.truncatedRawMessages` is non-zero, increase `Binary sample bytes` in the overlay debug section and collect a new capture before mapping fields from the old sample. `diagnostics.truncatedEnvelopes` and `diagnostics.truncatedActionPayloads` show how many of those truncated raw samples still decoded far enough to identify an envelope or action payload.

If `recommendations` reports WebSocket constructor static-property copy failures, treat it as a hook compatibility problem before trusting live capture behavior. Confirm constants such as `WebSocket.OPEN` remain visible in the page context and collect the hook diagnostics with the capture.

If `recommendations` reports that `prototype.constructor` was not patched, treat it as a hook compatibility problem before trusting live capture behavior. Confirm whether `socket.constructor === WebSocket` remains true in the page context and collect the hook diagnostics with the capture.

If the sample includes `ActionChiPengGang`, check `stateDiagnostics.claimedDiscardTransferred`. It should be `true`; otherwise a called tile may still be counted in both a river and a meld, which will understate remaining ukeire.

If the sample includes `ActionAnGangAddGang` or `RecordAnGangAddGang`, type `2` should upgrade an existing triplet into four visible tiles, while type `3` should show four visible concealed-kan tiles. Replay now reports this under `stateDiagnostics.kanMeldTileCountsOk`, `stateDiagnostics.addedKanVisibleTileCountsOk`, `stateDiagnostics.closedKanVisibleTileCountsOk`, and `stateCoverage.optional.kan`; for own kan events, `stateDiagnostics.ownKanTilesRemoved` should be `true` and `stateDiagnostics.ownKanTilesStillInHand` should be empty.

If the sample includes `ActionBaBei`, confirm the replayed state adds a visible `4z` reveal and, for own north reveal, removes one `4z` from the hand or drawn tile. This is represented as a meld-like visible tile in the MVP state model.

Check `stateDiagnostics.overKnownTileLimit` when `warnings` is non-empty. It lists concrete tile names and counts, which is usually faster to debug than reading raw tile indexes.

Check `stateDiagnostics.invalidTiles` when warnings mention ignored invalid tiles. Those entries identify which parsed event field produced an impossible tile name, which usually means the corresponding payload field mapping is wrong.

To create a sanitized parsed fixture from a real capture after reviewing it:

```bash
npm run replay -- captures/capture-real.json --fixture-out tests/fixtures/capture-real-sanitized.json
```

Only commit sanitized fixtures that are useful as regression tests. Capture exports remove page and WebSocket query strings and hashes, but do not commit raw real-page captures.
Fixtures generated with `--fixture-out` are marked with `fixtureKind: "sanitized-replay"` and `sourceSummary`; raw overlay exports contain capture metadata, raw message summaries, and should stay under ignored `captures/` files.

## What To Report Back

Share the replay output plus the capture JSON when possible. If the capture is too large, share:

- `captureSummary`
- `captureMetadata`
- `topMethods`
- `topActions`
- `diagnostics`
- `diagnostics.inboundRawMessages`
- `diagnostics.outboundRawMessages`
- `actionDiagnostics`
- `stateDiagnostics`
- `liveStateComparison`
- `liveOverlay`
- `stateCoverage`
- `recommendations`
- `acceptance`
- the first 5 `raw_message` entries with `payload.envelope`
- the final `gameState`

## Acceptance Signals

The current MVP is working on the real page when:

- `raw_message` appears after joining a table.
- `payload.envelope.methodName` appears for binary messages.
- `payload.envelope.actionName` appears for `.lq.ActionPrototype` messages.
- `discard_tile` and `draw_tile` events appear during normal play.
- `acceptance.checks.drawTileSeatParsed` and `acceptance.checks.discardTileSeatParsed` are `true`.
- round metadata plus `gameState.hand`, own draw handling, `gameState.discards`, `gameState.doraIndicators`, `gameState.scores`, and `gameState.visibleTiles` update without manual input. If the player has already discarded after drawing, `gameState.drawnTile` may correctly be `null`; check `stateDiagnostics.ownDrawTileEventsWithValidTile` and `stateDiagnostics.stateUpdated.drawnTile`.
- If the final sampled action implies an active player, such as a draw or call, `acceptance.checks.gameStateCurrentTurnUpdated` is `true`.
- `warnings` is empty and `acceptance.checks.gameStateWarningsClear` is `true`.
- If the capture includes `liveGameState`, `acceptance.checks.liveStateSnapshotMatches` is `true` and `liveStateComparison.mismatches` is empty.
- `acceptance.readyForRealPageMvp` is `true` in replay output for the sampled table actions.

If no `raw_message` appears, check Tampermonkey page injection support and confirm the metadata header was not removed.

If only outbound traffic appears, check `captureMetadata.helperDiagnostics.hooks`. A non-configurable `onmessage` descriptor means the helper could not wrap that property directly, so confirm whether the client also uses `addEventListener("message", ...)`; otherwise collect the hook diagnostics before changing parser mappings.

Replay output now reports `diagnostics.inboundRawMessages` and `diagnostics.outboundRawMessages`. If `outboundRawMessages` is positive but `inboundRawMessages` is `0`, treat the problem as hook coverage or sampling timing before changing message parser code.
