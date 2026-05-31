import { analyzeHand } from "../core/analyzer.js";
import { isStandardGameEvent } from "../core/events.js";
import { buildLiveRealPagePreflight, CAPTURE_VERIFICATION } from "../core/realPageReadiness.js";
import { doraFromIndicator, normalizeTile, parseTiles, sortTiles } from "../core/tile.js";
import { overlayStyles } from "./styles.js";

const STORAGE_KEY = "majsoul-helper-config";
const OVERLAY_CAPTURE_NOTE = "Majsoul Helper capture export. Contains message summaries/samples plus liveGameState, liveDebugSummary, liveMvpGate, liveSafetySettings, and liveRealPagePreflight snapshots copied from the overlay; no messages were modified by the helper.";
const DEFAULT_BINARY_SAMPLE_BYTES = 4096;
const DEFAULT_CAPTURE_LIMIT = 3000;
const MAX_CAPTURE_LIMIT = 3000;
const OVERLAY_EVENT_SHIELD_TYPES = [
  "pointerdown",
  "pointerup",
  "pointermove",
  "mousedown",
  "mouseup",
  "click",
  "dblclick",
  "touchstart",
  "touchmove",
  "touchend",
  "wheel",
  "keydown",
  "keypress",
  "keyup",
  "beforeinput",
  "input",
  "change",
  "paste",
  "copy",
  "cut",
  "compositionstart",
  "compositionupdate",
  "compositionend"
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderTiles(tiles) {
  return (tiles || []).map((tile) => `<span class="mh-tile">${escapeHtml(tile)}</span>`).join("");
}

function renderDoraIndicators(indicators) {
  if (!indicators?.length) return "-";
  return indicators.map((indicator) => {
    try {
      return `${indicator}->${doraFromIndicator(indicator)}`;
    } catch {
      return `${indicator}->?`;
    }
  }).join(" ");
}

function renderCompactTileSummary(tiles = [], limit = 24) {
  if (!tiles?.length) return "0 tiles";
  const sorted = sortTiles(tiles);
  const shown = sorted.slice(0, limit);
  const hidden = Math.max(0, sorted.length - shown.length);
  return `${sorted.length} tiles ${renderTiles(shown)}${hidden ? ` <span class="mh-muted">+${hidden} more</span>` : ""}`;
}

function safeJson(value) {
  return JSON.stringify(value, null, 2);
}

function toCaptureStateSnapshot(state) {
  const { events, ...snapshot } = state || {};
  return snapshot;
}

function buildLiveSafetySettings({ realtimeAdvice, manualInput, installDiagnostics, adapter }) {
  return {
    realtimeAdviceEnabled: Boolean(realtimeAdvice),
    realtimeAdviceDefault: false,
    realtimeAdviceMode: realtimeAdvice ? "manual opt-in" : "off",
    manualInputActive: Boolean(String(manualInput || "").trim()),
    capturePaused: Boolean(installDiagnostics?.paused || adapter?.paused),
    automationDisabled: true,
    clickAutomationDisabled: true,
    messageMutationDisabled: true
  };
}

function getCurrentPageDiagnostics() {
  const location = globalThis.location;
  if (!location) {
    return {
      origin: "",
      host: "",
      pathname: "",
      sanitizedUrl: ""
    };
  }
  const origin = String(location.origin || "");
  const host = String(location.host || "");
  const pathname = String(location.pathname || "");
  return {
    origin,
    host,
    pathname,
    sanitizedUrl: `${origin}${pathname}`
  };
}

function readConfig() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeConfig(patch) {
  try {
    const next = { ...readConfig(), ...patch };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in restricted page contexts; runtime config still applies.
  }
}

function normalizeCaptureLimit(value, fallback = DEFAULT_CAPTURE_LIMIT) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(1, Math.min(MAX_CAPTURE_LIMIT, Math.floor(number)));
}

function normalizeBinarySampleBytes(value, fallback = DEFAULT_BINARY_SAMPLE_BYTES) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(16, Math.min(4096, Math.floor(number)));
}

function renderSeatState(state) {
  return [0, 1, 2, 3].map((seat) => {
    const discards = state.discards?.[seat] || [];
    const melds = state.melds?.[seat] || [];
    const score = state.scores?.[seat] ?? "-";
    const riichi = state.riichi?.[seat] ? " riichi" : "";
    const turn = state.currentTurn === seat ? " turn" : "";
    const meldText = melds.length
      ? melds.map((meld) => (meld || []).join(" ")).join(" / ")
      : "-";
    return `
      <div class="mh-seat">
        <div class="mh-seat-head">Seat ${seat}${turn}${riichi} / ${escapeHtml(score)}</div>
        <div class="mh-muted">River</div>
        <div class="mh-row">${discards.length ? renderTiles(discards) : `<span class="mh-muted">-</span>`}</div>
        <div class="mh-muted">Melds: ${escapeHtml(meldText)}</div>
      </div>
    `;
  }).join("");
}

function summarizeDebugEvents(events) {
  const summary = {
    raw: 0,
    parsed: 0,
    captureErrors: 0,
    diagnostics: 0,
    truncated: 0,
    inbound: 0,
    outbound: 0,
    envelopes: 0,
    methods: 0,
    actions: 0,
    unparsedActions: {}
  };
  const methods = new Set();
  const actions = new Set();
  const rawActions = {};
  const parsedActions = {};

  for (const event of events || []) {
    if (event.type === "raw_message") {
      summary.raw += 1;
      if (event.source === "ws_in") summary.inbound += 1;
      if (event.source === "ws_out") summary.outbound += 1;
      if (event.payload?.truncated) summary.truncated += 1;
      const methodName = event.payload?.envelope?.methodName;
      const actionNames = envelopeActionNames(event.payload?.envelope);
      if (event.payload?.envelope) summary.envelopes += 1;
      if (methodName) methods.add(methodName);
      for (const actionName of actionNames) {
        actions.add(actionName);
        rawActions[actionName] = (rawActions[actionName] || 0) + 1;
      }
    } else if (isStandardGameEvent(event.type)) {
      summary.parsed += 1;
      const methodName = event.payload?.binaryEnvelope?.methodName;
      const actionNames = [event.payload?.binaryEnvelope?.actionName].filter(Boolean);
      if (methodName) methods.add(methodName);
      for (const actionName of actionNames) {
        actions.add(actionName);
        parsedActions[actionName] = (parsedActions[actionName] || 0) + 1;
      }
    } else {
      summary.diagnostics += 1;
      if (event.type === "capture_error") summary.captureErrors += 1;
    }
  }

  summary.methods = methods.size;
  summary.actions = actions.size;
  for (const [actionName, count] of Object.entries(rawActions)) {
    const missing = count - (parsedActions[actionName] || 0);
    if (missing > 0) summary.unparsedActions[actionName] = missing;
  }
  return summary;
}

function envelopeActionNames(envelope = {}) {
  return [
    envelope?.actionName,
    ...(envelope?.restoreActionNames || [])
  ].filter(Boolean);
}

function renderUnparsedActions(unparsedActions) {
  const entries = Object.entries(unparsedActions || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!entries.length) return "";
  return `<div class="mh-warning">Unparsed actions: ${escapeHtml(entries.map(([name, count]) => `${name} x${count}`).join(", "))}</div>`;
}

function summarizeActionDiagnostics(events) {
  const actions = new Map();
  const parsedCounts = {};

  for (const event of events || []) {
    if (event.type === "raw_message") {
      const envelope = event.payload?.envelope;
      const actionNames = envelopeActionNames(envelope);
      if (!actionNames.length) continue;
      for (const actionName of actionNames) {
        if (!actions.has(actionName)) {
          actions.set(actionName, {
            name: actionName,
            methodName: envelope.methodName,
            count: 0,
            parsedCount: 0,
            unparsedCount: 0,
            sample: {
              kind: event.payload?.kind || "unknown",
              messageLength: event.payload?.length ?? null,
              payloadLength: envelope.payloadLength ?? null,
              actionPayloadLength: envelope.actionPayloadLength ?? null,
              payloadTruncated: Boolean(event.payload?.truncated || envelope.payloadTruncated),
              actionPayloadTruncated: Boolean(envelope.actionPayloadTruncated),
              actionPayloadFields: envelope.actionPayloadFields || { varints: [], strings: [], tileStrings: [] }
            }
          });
        }
        actions.get(actionName).count += 1;
      }
      continue;
    }

    if (isStandardGameEvent(event.type)) {
      const actionName = event.payload?.binaryEnvelope?.actionName;
      if (actionName) parsedCounts[actionName] = (parsedCounts[actionName] || 0) + 1;
    }
  }

  return Array.from(actions.values())
    .map((entry) => ({
      ...entry,
      parsedCount: parsedCounts[entry.name] || 0,
      unparsedCount: Math.max(0, entry.count - (parsedCounts[entry.name] || 0))
    }))
    .sort((a, b) => b.unparsedCount - a.unparsedCount || b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 8);
}

function formatFieldGroup(entries) {
  if (!entries?.length) return "-";
  return entries.map((entry) => `f${entry.field}:${(entry.values || []).join("/")}`).join(" ");
}

function formatActionFields(fields = {}) {
  return [
    `varints ${formatFieldGroup(fields.varints)}`,
    `tiles ${formatFieldGroup(fields.tileStrings)}`,
    `strings ${formatFieldGroup(fields.strings)}`
  ].join(" / ");
}

function renderActionDiagnostics(entries) {
  if (!entries.length) {
    return `<div class="mh-muted" data-role="action-diagnostics">Action diagnostics: -</div>`;
  }
  return `
    <div data-role="action-diagnostics">
      <div class="mh-muted">Action diagnostics</div>
      ${entries.map((entry) => {
        const sample = entry.sample || {};
        const truncated = sample.payloadTruncated || sample.actionPayloadTruncated ? " / truncated" : "";
        return `
          <div class="${entry.unparsedCount ? "mh-warning" : "mh-muted"}">
            ${escapeHtml(entry.name)} raw ${entry.count} / parsed ${entry.parsedCount} / unparsed ${entry.unparsedCount}${truncated}
            <br>sample ${escapeHtml(sample.kind || "unknown")} msg ${escapeHtml(sample.messageLength ?? "-")} / payload ${escapeHtml(sample.payloadLength ?? "-")} / action ${escapeHtml(sample.actionPayloadLength ?? "-")}
            <br>${escapeHtml(formatActionFields(sample.actionPayloadFields))}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderUkeireBreakdown(candidate) {
  const entries = candidate.ukeireBreakdown?.length
    ? candidate.ukeireBreakdown
    : (candidate.ukeireTiles || []).map((tile) => ({ tile, remaining: "?" }));
  if (!entries.length) return "-";
  return entries.map((entry) => `${entry.tile} x${entry.remaining}`).join(" ");
}

function formatHookDiagnostics(hooks = {}) {
  const constructorStatics = hooks.constructorStatics;
  const staticFailures = constructorStatics?.failed?.length || 0;
  const parts = [
    `constructor ${hooks.constructor ? "ok" : "off"}`,
    constructorStatics
      ? `statics ${constructorStatics.copied ?? 0} copied${staticFailures ? ` / ${staticFailures} failed` : ""}`
      : null,
    `prototype.constructor ${hooks.prototypeConstructor || "unknown"}`,
    `send ${hooks.send ? "ok" : "off"}`,
    `addEventListener ${hooks.addEventListener ? "ok" : "off"}`,
    `removeEventListener ${hooks.removeEventListener ? "ok" : "off"}`,
    `onmessage ${hooks.onmessage ? "ok" : "off"} (${hooks.onmessageMode || "unknown"})`,
    `client decode ${hooks.decodedMessage ? "ok" : "waiting"} (${hooks.decodedMessageMode || "unknown"})`,
    `page dispatch ${hooks.decodedDispatcher ? "ok" : "waiting"} (${hooks.decodedDispatcherMode || "unknown"})`
  ].filter(Boolean);
  return parts.join(" / ");
}

function formatRuntimeDiagnostics(runtime = {}) {
  const scriptName = runtime.unityBuildScript
    ? String(runtime.unityBuildScript).split("/").filter(Boolean).at(-1)
    : "";
  const instanceShape = formatRuntimeShapeSummary("instance", runtime.unityInstanceShape);
  const moduleShape = formatRuntimeShapeSummary("Module", runtime.unityModuleShape);
  const parts = [
    `Unity WebGL ${runtime.unityWebGL ? "detected" : "not detected"}`,
    scriptName ? `build ${scriptName}` : null,
    `loader observer ${runtime.createUnityInstanceLoadObserver ? "on" : "off"}`,
    `loader loads ${runtime.createUnityInstanceLoadEvents ?? 0}`,
    `createUnityInstance ${runtime.createUnityInstanceHook ? "hooked" : "waiting"} (${runtime.createUnityInstanceMode || "unknown"})`,
    `calls ${runtime.createUnityInstanceCalls ?? 0}`,
    `resolved ${runtime.createUnityInstanceResolved ? "yes" : "no"}`,
    `unityInstance ${runtime.hasUnityInstance ? "ok" : "missing"}`,
    `Module ${runtime.hasUnityModule ? "ok" : "missing"}`,
    `heap ${runtime.heapU8 ? "ok" : "missing"}`,
    instanceShape,
    moduleShape,
    `global net ${runtime.netMessageWrapperGlobal ? "ok" : "missing"}`,
    `global Laya ${runtime.layaGlobal ? "ok" : "missing"}`
  ].filter(Boolean);
  return parts.join(" / ");
}

function formatRuntimeShapeSummary(label, shape = {}) {
  if (!shape || typeof shape !== "object") return "";
  const keyCount = shape.keyCount ?? 0;
  const functionCount = shape.functionKeyCount ?? 0;
  const prototypeFunctionCount = shape.prototypeFunctionKeyCount ?? 0;
  if (!keyCount && !functionCount && !prototypeFunctionCount && !shape.unavailableReason) return "";
  const error = shape.unavailableReason ? ` / shape error ${shape.unavailableReason}` : "";
  return `${label} keys ${keyCount} / funcs ${functionCount} / proto funcs ${prototypeFunctionCount}${error}`;
}

function formatEventBufferDiagnostics(eventBuffer = {}) {
  if (!eventBuffer || typeof eventBuffer !== "object") return "Event buffer: unavailable";
  const retained = eventBuffer.retainedEvents ?? "-";
  const total = eventBuffer.totalEventsSinceClear ?? "-";
  const dropped = eventBuffer.droppedBeforeRetained ?? 0;
  const maxEvents = eventBuffer.maxEvents ?? "-";
  const oldest = eventBuffer.oldestEventId ?? "-";
  const newest = eventBuffer.newestEventId ?? "-";
  return `Event buffer: retained ${retained}/${total} / max ${maxEvents} / dropped ${dropped} / ids ${oldest}-${newest}`;
}

function stateHasTableData(state = {}) {
  return Boolean(
    state.hand?.length
    || state.drawnTile
    || state.discards?.some((tiles) => tiles.length)
    || state.melds?.some((melds) => melds.length)
    || state.doraIndicators?.length
    || state.visibleTiles?.length
    || state.chang !== null && state.chang !== undefined
    || state.ju !== null && state.ju !== undefined
    || state.round !== null && state.round !== undefined
  );
}

function captureHealth(adapter, summary, installDiagnostics = {}, state = {}) {
  if (adapter.paused) {
    return "Paused. Resume capture before sampling live traffic.";
  }
  if (!adapter.installed) {
    return "Hook not installed. Reload the page after installing the userscript.";
  }
  if (summary.raw === 0) {
    if (!installDiagnostics.socketsCreated) {
      return "Hook installed, but no WebSocket instance has been observed yet. Open or reload the game client.";
    }
    return "Waiting for WebSocket traffic. Join a table and watch for raw messages.";
  }
  if (summary.inbound === 0) {
    if (installDiagnostics.hooks?.onmessage === false && installDiagnostics.hooks?.onmessageMode === "non-configurable") {
      return "Only outbound traffic captured. The onmessage descriptor is non-configurable, so rely on addEventListener coverage and capture more traffic.";
    }
    return "Only outbound traffic captured. Wait for server messages or check message listener hook coverage.";
  }
  if (summary.envelopes === 0) {
    return "Inbound traffic captured, but no Liqi envelope decoded yet.";
  }
  if (summary.parsed === 0) {
    return "Liqi envelopes captured, but no standard game events parsed yet.";
  }
  if (!stateHasTableData(state)) {
    if (installDiagnostics.runtime?.unityWebGL) {
      return "Unity WebGL Action names are captured, but action payload fields are still encoded or unmapped. State restoration needs a Unity runtime hook or payload decoder.";
    }
    return "Standard game event names parsed, but no usable gameState fields updated yet. Inspect action payload field diagnostics.";
  }
  return "Standard game events parsed. Compare gameState with the visible table.";
}

function isValidSeat(seat) {
  const value = Number(seat);
  return Number.isInteger(value) && value >= 0 && value <= 3;
}

function isValidTile(tile) {
  try {
    normalizeTile(tile);
    return true;
  } catch {
    return false;
  }
}

function hasEventWithValidSeat(events, type) {
  return events.some((event) => event.type === type && isValidSeat(event.payload?.seat));
}

function hasOwnDrawTileWithValidTile(events) {
  return events.some((event) => (
    event.type === "draw_tile"
    && Number(event.payload?.seat) === 0
    && isValidTile(event.payload?.tile)
  ));
}

function stableJson(value) {
  return JSON.stringify(value);
}

function isChiPengGangAction(actionName) {
  return actionName === "ActionChiPengGang" || actionName === "RecordChiPengGang";
}

function isAnGangAddGangAction(actionName) {
  return actionName === "ActionAnGangAddGang" || actionName === "RecordAnGangAddGang";
}

function normalizeMeld(meld) {
  if (!meld) return [];
  return Array.isArray(meld) ? meld : [meld];
}

function chronologicalEvents(events) {
  const entries = [...(events || [])];
  if (entries.every((event) => Number.isFinite(Number(event.ts)))) {
    return entries.sort((left, right) => Number(left.ts) - Number(right.ts));
  }
  return entries.reverse();
}

function removeLatestClaimedDiscard(discards, meld, callerSeat) {
  if (!isValidSeat(callerSeat) || !meld.length) return false;
  for (let seat = 0; seat < discards.length; seat += 1) {
    if (seat === callerSeat) continue;
    const river = discards[seat];
    const lastTile = river[river.length - 1];
    if (lastTile && meld.includes(lastTile)) {
      river.pop();
      return true;
    }
  }
  return false;
}

function discardsEqual(left, right) {
  return left.length === right.length && left.every((river, index) => (
    river.length === (right[index] || []).length
    && river.every((tile, tileIndex) => tile === right[index][tileIndex])
  ));
}

function buildClaimedDiscardDiagnostics(events, state) {
  const expectedDiscards = [[], [], [], []];
  const chiPengGangEvents = (events || []).filter((event) => (
    isChiPengGangAction(event.payload?.binaryEnvelope?.actionName)
  ));
  let claimableChiPengGangEvents = 0;

  for (const event of chronologicalEvents(events)) {
    if (event.type === "discard_tile" && isValidSeat(event.payload?.seat) && event.payload?.tile) {
      expectedDiscards[Number(event.payload.seat)].push(event.payload.tile);
    }
    if (isChiPengGangAction(event.payload?.binaryEnvelope?.actionName)) {
      const removed = removeLatestClaimedDiscard(
        expectedDiscards,
        normalizeMeld(event.payload?.meld),
        Number(event.payload?.seat)
      );
      if (removed) claimableChiPengGangEvents += 1;
    }
  }

  return {
    chiPengGangEvents: chiPengGangEvents.length,
    claimableChiPengGangEvents,
    claimedDiscardTransferred: chiPengGangEvents.length
      ? discardsEqual(expectedDiscards, state.discards || [])
      : null
  };
}

function buildKanDiagnostics(events, state) {
  const anGangAddGangEvents = (events || []).filter((event) => (
    isAnGangAddGangAction(event.payload?.binaryEnvelope?.actionName)
  ));
  const anGangAddGangEventsWithSeat = anGangAddGangEvents.filter((event) => isValidSeat(event.payload?.seat));
  const unknownKanTypeEvents = anGangAddGangEvents.filter((event) => {
    const type = Number(event.payload?.type);
    return type !== 2 && type !== 3;
  });
  const ownAnGangAddGangEvents = anGangAddGangEvents.filter((event) => Number(event.payload?.seat) === 0);
  const kanMeldMismatches = buildKanMeldMismatches(state, anGangAddGangEvents);
  const ownKanTilesStillInHand = buildOwnKanTilesStillInHand(state, ownAnGangAddGangEvents);
  return {
    anGangAddGangEvents: anGangAddGangEvents.length,
    anGangAddGangEventsWithSeat: anGangAddGangEventsWithSeat.length,
    unknownKanTypeEvents: unknownKanTypeEvents.length,
    ownAnGangAddGangEvents: ownAnGangAddGangEvents.length,
    kanTypeKnown: anGangAddGangEvents.length ? unknownKanTypeEvents.length === 0 : null,
    kanMeldTileCountsOk: anGangAddGangEvents.length ? kanMeldMismatches.length === 0 : null,
    ownKanTilesRemoved: ownAnGangAddGangEvents.length ? ownKanTilesStillInHand.length === 0 : null
  };
}

function buildKanMeldMismatches(state, events) {
  const mismatches = [];
  for (const event of events) {
    const seat = Number(event.payload?.seat);
    const tile = eventKanTile(event);
    const actualCopies = isValidSeat(seat) && tile ? maxMeldCopies(state, seat, tile) : 0;
    if (actualCopies < 4) {
      mismatches.push({ seat, tile, actualCopies });
    }
  }
  return mismatches;
}

function buildOwnKanTilesStillInHand(state, events) {
  const ownKnownTiles = [
    ...(state.hand || []),
    state.drawnTile
  ].filter(Boolean).filter(isValidTile).map((tile) => normalizeTile(tile));
  const counts = {};
  for (const tile of ownKnownTiles) {
    counts[tile] = (counts[tile] || 0) + 1;
  }
  return events
    .map((event) => eventKanTile(event))
    .filter(Boolean)
    .filter((tile, index, tiles) => tiles.indexOf(tile) === index)
    .filter((tile) => counts[tile] > 0)
    .map((tile) => ({ tile, count: counts[tile] }));
}

function eventKanTile(event) {
  const normalizedTiles = normalizeMeld(event.payload?.meld)
    .filter(isValidTile)
    .map((tile) => normalizeTile(tile));
  return normalizedTiles[0] || null;
}

function maxMeldCopies(state, seat, tile) {
  let maxCopies = 0;
  for (const meld of state.melds?.[seat] || []) {
    const copies = normalizeMeld(meld)
      .filter(isValidTile)
      .map((meldTile) => normalizeTile(meldTile))
      .filter((meldTile) => meldTile === tile)
      .length;
    maxCopies = Math.max(maxCopies, copies);
  }
  return maxCopies;
}

function latestRoundEndScores(events) {
  const entries = chronologicalEvents(events);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const event = entries[index];
    if (event.type === "round_end" && event.payload?.scores?.length) {
      return event.payload.scores;
    }
  }
  return null;
}

function inferExpectedCurrentTurn(events) {
  let expectedCurrentTurn = null;
  for (const event of chronologicalEvents(events)) {
    if (event.type === "round_start" && isValidSeat(event.payload?.currentTurn)) {
      expectedCurrentTurn = Number(event.payload.currentTurn);
    }
    if (event.type === "draw_tile" && isValidSeat(event.payload?.seat)) {
      expectedCurrentTurn = Number(event.payload.seat);
    }
    if (event.type === "discard_tile" && isValidSeat(event.payload?.seat)) {
      expectedCurrentTurn = null;
    }
    if (event.type === "call_meld" && isValidSeat(event.payload?.seat)) {
      expectedCurrentTurn = Number(event.payload.seat);
    }
    if (event.type === "round_end") {
      expectedCurrentTurn = null;
    }
  }
  return expectedCurrentTurn;
}

function buildLiveMvpGate(events, state, summary) {
  const eventTypes = events.map((event) => event.type);
  const rawEvents = events.filter((event) => event.type === "raw_message");
  const claimedDiscardDiagnostics = buildClaimedDiscardDiagnostics(events, state);
  const kanDiagnostics = buildKanDiagnostics(events, state);
  const expectedCurrentTurn = inferExpectedCurrentTurn(events);
  const checks = {
    rawMessagesCaptured: summary.raw > 0,
    inboundRawMessagesCaptured: summary.inbound > 0,
    binaryEnvelopeDecoded: summary.envelopes > 0,
    actionPrototypeDecoded: rawEvents.some((event) => envelopeActionNames(event.payload?.envelope).length > 0),
    drawTileParsed: events.some((event) => event.type === "draw_tile"),
    drawTileSeatParsed: hasEventWithValidSeat(events, "draw_tile"),
    discardTileParsed: events.some((event) => event.type === "discard_tile"),
    discardTileSeatParsed: hasEventWithValidSeat(events, "discard_tile"),
    gameStateHandUpdated: Boolean(state.hand?.length),
    gameStateRoundMetadataUpdated: state.chang !== null || state.ju !== null || state.round !== null,
    gameStateDrawnTileUpdated: Boolean(state.drawnTile) || hasOwnDrawTileWithValidTile(events),
    gameStateDiscardsUpdated: Boolean(state.discards?.some((tiles) => tiles.length)),
    gameStateDoraIndicatorsUpdated: Boolean(state.doraIndicators?.length),
    gameStateScoresUpdated: Boolean(state.scoresKnown || state.scores?.some((score) => score !== 25000)),
    gameStateVisibleTilesUpdated: Boolean(state.visibleTiles?.length),
    gameStateWarningsClear: !(state.warnings?.length)
  };
  if (eventTypes.includes("call_meld")) {
    checks.callMeldSeatParsed = hasEventWithValidSeat(events, "call_meld");
    checks.gameStateMeldsUpdated = Boolean(state.melds?.some((melds) => melds.length));
  }
  if (claimedDiscardDiagnostics.claimableChiPengGangEvents > 0) {
    checks.claimedDiscardTransferred = claimedDiscardDiagnostics.claimedDiscardTransferred === true;
  }
  if (kanDiagnostics.anGangAddGangEvents > 0) {
    checks.anGangAddGangSeatParsed = kanDiagnostics.anGangAddGangEventsWithSeat === kanDiagnostics.anGangAddGangEvents;
    checks.kanTypeKnown = kanDiagnostics.kanTypeKnown === true;
    checks.kanMeldTileCountsOk = kanDiagnostics.kanMeldTileCountsOk === true;
  }
  if (kanDiagnostics.ownAnGangAddGangEvents > 0) {
    checks.ownKanTilesRemoved = kanDiagnostics.ownKanTilesRemoved === true;
  }
  if (expectedCurrentTurn !== null) {
    checks.gameStateCurrentTurnUpdated = Number(state.currentTurn) === expectedCurrentTurn;
  }
  if (eventTypes.includes("riichi")) {
    checks.riichiSeatParsed = hasEventWithValidSeat(events, "riichi");
    checks.gameStateRiichiUpdated = Boolean(state.riichi?.some(Boolean));
  }
  if (eventTypes.includes("round_end")) {
    checks.roundEndReasonUpdated = state.roundEndReason !== null;
    const roundEndScores = latestRoundEndScores(events);
    if (roundEndScores) {
      checks.roundEndScoresUpdated = stableJson(state.scores) === stableJson(roundEndScores);
    }
  }
  const entries = Object.entries(checks);
  return {
    checks,
    passed: entries.filter(([, value]) => value).length,
    total: entries.length,
    missing: entries.filter(([, value]) => !value).map(([key]) => key)
  };
}

function renderLiveMvpGate(gate) {
  const ready = gate.passed === gate.total;
  const missing = gate.missing.length
    ? `Missing: ${gate.missing.join(", ")}`
    : "Ready for replay strict validation; compare against visible table.";
  return `
    <div class="${ready ? "mh-muted" : "mh-warning"}" data-role="mvp-gate">
      MVP gate: ${gate.passed}/${gate.total}. ${escapeHtml(missing)}
    </div>
  `;
}

function renderLiveRealPagePreflight(preflight) {
  const ready = preflight.readyToExport;
  const commandHint = `After export: run ${preflight.doctorCommand}, then ${preflight.offlineCommand} to confirm replay/liveStateSnapshotMatches.`;
  const message = ready
    ? `Ready to export. ${commandHint}`
    : `Missing before export: ${preflight.missing.join(", ")}. Next: ${preflight.hints.join(" ")} ${commandHint}`;
  return `
    <div class="${ready ? "mh-muted" : "mh-warning"}" data-role="real-page-preflight">
      Real-page preflight: ${preflight.passed}/${preflight.total}. ${escapeHtml(message)}
    </div>
  `;
}

function safeAnalyzeHand(input) {
  try {
    return { analysis: analyzeHand(input), error: "" };
  } catch (error) {
    return {
      analysis: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export class Overlay {
  constructor({ adapter, gameState }) {
    this.adapter = adapter;
    this.gameState = gameState;
    this.manualTiles = [];
    this.manualInput = "";
    this.manualError = "";
    this.realtimeAdvice = false;
    this.captureLimitDraft = null;
    this.binarySampleBytesDraft = null;
    const config = readConfig();
    const storedCaptureLimit = normalizeCaptureLimit(config.captureLimit ?? DEFAULT_CAPTURE_LIMIT, DEFAULT_CAPTURE_LIMIT);
    const adapterCaptureLimit = normalizeCaptureLimit(adapter.maxEvents ?? DEFAULT_CAPTURE_LIMIT, DEFAULT_CAPTURE_LIMIT);
    this.captureLimit = Math.max(DEFAULT_CAPTURE_LIMIT, storedCaptureLimit, adapterCaptureLimit);
    if (typeof adapter.setMaxEvents === "function") {
      this.captureLimit = adapter.setMaxEvents(this.captureLimit);
    }
    const storedBinarySampleBytes = normalizeBinarySampleBytes(config.binarySampleBytes ?? DEFAULT_BINARY_SAMPLE_BYTES, DEFAULT_BINARY_SAMPLE_BYTES);
    const adapterBinarySampleBytes = normalizeBinarySampleBytes(adapter.binarySampleBytes ?? DEFAULT_BINARY_SAMPLE_BYTES, DEFAULT_BINARY_SAMPLE_BYTES);
    this.binarySampleBytes = Math.max(DEFAULT_BINARY_SAMPLE_BYTES, storedBinarySampleBytes, adapterBinarySampleBytes);
    if (typeof adapter.setBinarySampleBytes === "function") {
      this.binarySampleBytes = adapter.setBinarySampleBytes(this.binarySampleBytes);
    }
    if (config.captureLimit !== this.captureLimit || config.binarySampleBytes !== this.binarySampleBytes) {
      writeConfig({
        captureLimit: this.captureLimit,
        binarySampleBytes: this.binarySampleBytes
      });
    }
    this.copyError = "";
    this.copyFallbackText = "";
    this.downloadUrl = "";
    this.selfTestResult = null;
    this.root = null;
    this.overlayEventShieldBound = false;
  }

  mount() {
    if (this.root) return;
    const style = document.createElement("style");
    style.textContent = overlayStyles;
    document.documentElement.appendChild(style);

    this.root = document.createElement("div");
    this.root.id = "majsoul-helper-overlay";
    document.documentElement.appendChild(this.root);
    this.bindOverlayEventShield();
    this.bindAdapter();
    this.render();
  }

  bindOverlayEventShield() {
    if (this.overlayEventShieldBound || !this.root) return;
    const stopAtOverlay = (event) => {
      event.stopPropagation();
    };
    for (const type of OVERLAY_EVENT_SHIELD_TYPES) {
      this.root.addEventListener(type, stopAtOverlay);
    }
    this.overlayEventShieldBound = true;
  }

  bindAdapter() {
    this.adapter.addEventListener("majsoul-helper:event", (event) => {
      this.gameState.applyEvent(event.detail);
      this.render();
    });
    this.adapter.addEventListener("majsoul-helper:clear", () => {
      this.gameState.clearEvents();
      this.render();
    });
    this.adapter.addEventListener("majsoul-helper:install", () => {
      this.render();
    });
    this.adapter.addEventListener("majsoul-helper:config", () => {
      if (this.captureLimitDraft === null && Number.isFinite(this.adapter.maxEvents)) {
        this.captureLimit = this.adapter.maxEvents;
      }
      if (this.binarySampleBytesDraft === null) {
        this.binarySampleBytes = this.adapter.binarySampleBytes;
      }
      this.render();
    });
    this.adapter.addEventListener("majsoul-helper:socket", () => {
      this.render();
    });
    this.adapter.addEventListener("majsoul-helper:self-test", (event) => {
      this.selfTestResult = event.detail;
      this.render();
    });
  }

  render() {
    if (!this.root) return;
    const focusSnapshot = this.captureFocusSnapshot();
    const state = this.gameState.getVisibleState();
    const usingManualInput = this.manualInput.trim().length > 0;
    const hasValidManualTiles = usingManualInput && !this.manualError && this.manualTiles.length > 0;
    const handForAnalysis = usingManualInput ? this.manualTiles : state.hand;
    const drawnTileForAnalysis = usingManualInput ? null : state.drawnTile;
    const visibleTilesForAnalysis = usingManualInput ? [] : (state.visibleTiles || []);
    const openMeldsForAnalysis = usingManualInput ? 0 : (state.melds?.[0]?.length || 0);
    const shouldAnalyze = hasValidManualTiles || (!usingManualInput && this.realtimeAdvice);
    const analysisResult = shouldAnalyze && handForAnalysis.length
      ? safeAnalyzeHand({ hand: handForAnalysis, drawnTile: drawnTileForAnalysis, visibleTiles: visibleTilesForAnalysis, openMelds: openMeldsForAnalysis })
      : { analysis: null, error: "" };
    const analysis = analysisResult.analysis;
    const recentEvents = this.adapter.getRecentEvents();
    const debugSummary = summarizeDebugEvents(recentEvents);
    const actionDiagnostics = summarizeActionDiagnostics(recentEvents);
    const installDiagnostics = typeof this.adapter.getInstallDiagnostics === "function"
      ? this.adapter.getInstallDiagnostics()
      : { installed: this.adapter.installed, webSocketAvailable: typeof WebSocket !== "undefined" };
    const helperVersion = installDiagnostics.helperVersion || this.adapter.helperVersion || "";
    const liveMvpGate = buildLiveMvpGate(recentEvents, state, debugSummary);
    const liveSafetySettings = buildLiveSafetySettings({
      realtimeAdvice: this.realtimeAdvice,
      manualInput: this.manualInput,
      installDiagnostics,
      adapter: this.adapter
    });
    const liveRealPagePreflight = buildLiveRealPagePreflight({
      adapter: this.adapter,
      page: getCurrentPageDiagnostics(),
      installDiagnostics,
      liveMvpGate,
      liveGameState: toCaptureStateSnapshot(state),
      liveDebugSummary: debugSummary,
      liveSafetySettings
    });
    const captureLimitValue = this.captureLimitDraft ?? this.captureLimit;
    const binarySampleValue = this.binarySampleBytesDraft
      ?? this.binarySampleBytes
      ?? installDiagnostics.binarySampleBytes
      ?? DEFAULT_BINARY_SAMPLE_BYTES;

    this.root.innerHTML = `
      <div class="mh-header">
        <div class="mh-title">Majsoul Helper${helperVersion ? ` <span class="mh-muted">v${escapeHtml(helperVersion)}</span>` : ""}</div>
        <div class="mh-actions">
          <button class="mh-button" data-action="toggle-capture">${this.adapter.paused ? "Resume" : "Pause"}</button>
          <button class="mh-button" data-action="collapse">Collapse</button>
        </div>
      </div>
      <div class="mh-body">
        <div class="mh-warning">Training/review use only. Realtime advice is off by default. No auto discard, no clicking, no message mutation.</div>
        <label class="mh-row">
          <input type="checkbox" data-action="realtime-advice" ${this.realtimeAdvice ? "checked" : ""}>
          <span>Enable realtime discard-candidate advice manually</span>
        </label>
        ${this.realtimeAdvice ? `<div class="mh-warning" data-role="realtime-risk">Risk feature active: realtime discard-candidate advice is for training/review only.</div>` : ""}
        <div class="mh-section">
          <div class="mh-section-title">Manual Input</div>
          <div class="mh-row">
            <input class="mh-input mh-manual-input" data-role="manual-input" placeholder="123m456p789s11z or 0m0p0s" value="${escapeHtml(this.manualInput || "")}">
            <button class="mh-button" data-action="clear-manual-input">Clear</button>
          </div>
          ${this.manualError ? `<div class="mh-warning">${escapeHtml(this.manualError)}</div>` : ""}
        </div>
        <div class="mh-section">
          <div class="mh-section-title">Current Hand</div>
          <div class="mh-muted" data-role="analysis-source">Analysis source: ${usingManualInput ? "manual input" : "captured state"}</div>
          <div class="mh-row" data-role="current-hand">${renderTiles(handForAnalysis)}</div>
          <div class="mh-muted" data-role="drawn-tile">Drawn tile: ${drawnTileForAnalysis ? renderTiles([drawnTileForAnalysis]) : "-"}</div>
          <div class="mh-muted">Open melds for analysis: ${escapeHtml(openMeldsForAnalysis)}</div>
          <div class="mh-muted">Dora indicators: ${escapeHtml(renderDoraIndicators(state.doraIndicators))}</div>
          <div class="mh-muted" data-role="visible-tiles-for-analysis">Visible known tiles for ukeire: ${usingManualInput ? "manual input ignores captured visible tiles" : renderCompactTileSummary(visibleTilesForAnalysis)}</div>
          <div class="mh-muted" data-role="round-metadata">Round: ${escapeHtml(state.round ?? "-")} / Chang ${escapeHtml(state.chang ?? "-")} / Ju ${escapeHtml(state.ju ?? "-")} / Round wind ${escapeHtml(state.roundWind ?? "-")} / Seat wind ${escapeHtml(state.seatWind ?? "-")}</div>
          <div class="mh-muted" data-role="counter-metadata">Honba ${escapeHtml(state.honba ?? "-")} / Riichi sticks ${escapeHtml(state.riichiSticks ?? "-")}</div>
          <div class="mh-muted" data-role="turn-metadata">Turn: ${escapeHtml(state.currentTurn ?? "-")} / Wall: ${escapeHtml(state.leftTileCount ?? "-")} / Step: ${escapeHtml(state.lastStep ?? "-")}</div>
          <div class="mh-muted" data-role="riichi-round-end">Riichi: ${escapeHtml(state.riichi.map((value, index) => value ? index : null).filter((value) => value !== null).join(" ") || "-")} / End: ${escapeHtml(state.roundEndReason ?? "-")}</div>
          ${state.warnings?.length ? `<div class="mh-warning">State warnings: ${escapeHtml(state.warnings.join("; "))}</div>` : ""}
        </div>
        <div class="mh-section">
          <div class="mh-section-title">Table State</div>
          <div class="mh-seat-grid">${renderSeatState(state)}</div>
        </div>
        <div class="mh-section">
          <div class="mh-section-title">Analysis</div>
          ${analysis ? this.renderAnalysis(analysis) : this.renderAnalysisPlaceholder(usingManualInput, analysisResult.error)}
        </div>
        <div class="mh-section">
          <div class="mh-section-title">Debug</div>
          <div class="mh-row">
            <button class="mh-button" data-action="copy-state">Copy gameState</button>
            <button class="mh-button" data-action="copy-capture">Copy capture</button>
            <a class="mh-button" data-action="download-capture" href="#" download="majsoul-helper-capture.json">Download capture</a>
            <button class="mh-button" data-action="clear-debug">Clear debug</button>
            <button class="mh-button" data-action="self-test">Self-test</button>
          </div>
          ${this.selfTestResult ? this.renderSelfTest(this.selfTestResult) : ""}
          <label class="mh-muted">Capture limit <input class="mh-input" data-role="capture-limit" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" spellcheck="false" aria-label="Capture limit, 1 to 3000" value="${escapeHtml(captureLimitValue)}"></label>
          <label class="mh-muted">Binary sample bytes <input class="mh-input" data-role="binary-sample-bytes" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" spellcheck="false" aria-label="Binary sample bytes, 16 to 4096" value="${escapeHtml(binarySampleValue)}"></label>
          <div class="mh-muted" data-role="install-diagnostics">Install: ${installDiagnostics.installed ? "installed" : "not installed"}${helperVersion ? ` / v${escapeHtml(helperVersion)}` : ""} / capture ${installDiagnostics.paused || this.adapter.paused ? "paused" : "running"} / attempts ${escapeHtml(installDiagnostics.installAttempts ?? "-")} / WebSocket ${installDiagnostics.webSocketAvailable ? "available" : "missing"} / sockets ${escapeHtml(installDiagnostics.socketsCreated ?? 0)} / sample ${escapeHtml(installDiagnostics.binarySampleBytes ?? "-")} bytes / client decode ${installDiagnostics.hooks?.decodedMessage ? "hooked" : "waiting"} / page dispatch ${installDiagnostics.hooks?.decodedDispatcher ? "hooked" : "waiting"}</div>
          <div class="mh-muted" data-role="hook-diagnostics">Hooks: ${escapeHtml(formatHookDiagnostics(installDiagnostics.hooks))}</div>
          <div class="mh-muted" data-role="runtime-diagnostics">Runtime: ${escapeHtml(formatRuntimeDiagnostics(installDiagnostics.runtime))}</div>
          <div class="${Number(installDiagnostics.eventBuffer?.droppedBeforeRetained || 0) > 0 ? "mh-warning" : "mh-muted"}" data-role="event-buffer-diagnostics">${escapeHtml(formatEventBufferDiagnostics(installDiagnostics.eventBuffer))}</div>
          ${installDiagnostics.recentSocketUrls?.length ? `<div class="mh-muted">Recent sockets: ${escapeHtml(installDiagnostics.recentSocketUrls.join(" / "))}</div>` : ""}
          ${installDiagnostics.installFailureReason ? `<div class="mh-warning">${escapeHtml(installDiagnostics.installFailureReason)}</div>` : ""}
          <div class="mh-muted" data-role="capture-health">Capture health: ${escapeHtml(captureHealth(this.adapter, debugSummary, installDiagnostics, state))}</div>
          ${renderLiveMvpGate(liveMvpGate)}
          ${renderLiveRealPagePreflight(liveRealPagePreflight)}
          <div class="mh-muted">Capture summary: raw ${debugSummary.raw} / inbound ${debugSummary.inbound} / outbound ${debugSummary.outbound} / parsed ${debugSummary.parsed} / errors ${debugSummary.captureErrors} / diagnostics ${debugSummary.diagnostics} / envelopes ${debugSummary.envelopes} / truncated ${debugSummary.truncated} / methods ${debugSummary.methods} / actions ${debugSummary.actions}</div>
          ${debugSummary.truncated ? `<div class="mh-warning">Some captured samples are truncated. Increase capture quality by replaying diagnostics before mapping fields.</div>` : ""}
          ${renderUnparsedActions(debugSummary.unparsedActions)}
          ${renderActionDiagnostics(actionDiagnostics)}
          <div class="mh-muted">Recent messages</div>
          ${this.copyError ? `<div class="mh-warning">${escapeHtml(this.copyError)}</div><textarea class="mh-input" data-role="copy-fallback" rows="5">${escapeHtml(this.copyFallbackText)}</textarea>` : ""}
          <pre class="mh-code">${escapeHtml(safeJson(recentEvents.slice(0, 8)))}</pre>
          <div class="mh-muted">gameState</div>
          <pre class="mh-code">${escapeHtml(safeJson(state))}</pre>
        </div>
      </div>
    `;
    this.bindDomEvents();
    this.restoreFocus(focusSnapshot);
  }

  renderAnalysis(analysis) {
    return `
      <div>Current shanten: <strong>${analysis.shanten}</strong></div>
      ${analysis.canDiscard ? `
        <div>
          ${analysis.candidates.map((candidate) => `
            <div class="mh-candidate">
              <div>${renderTiles([candidate.discard])}</div>
              <div>
                <div>After discard shanten: ${candidate.shantenAfterDiscard}</div>
                <div>Ukeire: ${escapeHtml(renderUkeireBreakdown(candidate))} (${candidate.ukeireTypes} types / ${candidate.ukeireCount} tiles)</div>
              </div>
            </div>
          `).join("")}
        </div>
      ` : `
        <div class="mh-muted">Discard candidates are shown only with 3n+2 tiles. Wait for a draw or enter a complete 14-tile hand.</div>
      `}
    `;
  }

  renderAnalysisPlaceholder(usingManualInput, error = "") {
    const message = error
      ? `Analysis failed: ${error}`
      : usingManualInput
      ? "Fix manual input to show analysis."
      : "Enter a hand or enable realtime advice to show analysis.";
    return `<div class="${error ? "mh-warning" : "mh-muted"}">${escapeHtml(message)}</div>`;
  }

  renderSelfTest(result) {
    return `
      <div class="${result.ok ? "mh-muted" : "mh-warning"}" data-role="self-test-result">
        Self-test: ${result.ok ? "ok" : "failed"} /
        install ${result.installed ? "installed" : "not installed"} /
        WebSocket ${result.webSocketAvailable ? "available" : "missing"} /
        readable ${escapeHtml(result.readableParsedTypes.join(",") || "-")} /
        binary ${escapeHtml(result.binaryEnvelope?.actionName || "-")} -> ${escapeHtml(result.binaryParsedTypes.join(",") || "-")}
      </div>
    `;
  }

  bindDomEvents() {
    this.root.querySelector('[data-action="collapse"]').onclick = () => {
      this.root.classList.toggle("mh-collapsed");
    };
    this.root.querySelector('[data-action="toggle-capture"]').onclick = () => {
      this.adapter.setPaused(!this.adapter.paused);
      this.render();
    };
    this.root.querySelector('[data-action="realtime-advice"]').onchange = (event) => {
      this.realtimeAdvice = event.target.checked;
      this.render();
    };
    this.root.querySelector('[data-action="copy-state"]').onclick = async () => {
      await this.copyText(safeJson(this.gameState.getVisibleState()));
    };
    this.root.querySelector('[data-action="copy-capture"]').onclick = async () => {
      await this.copyText(safeJson(this.buildOverlayCapture()));
    };
    this.root.querySelector('[data-action="download-capture"]').onclick = (event) => {
      if (!this.prepareCaptureDownload(event.currentTarget)) event.preventDefault();
    };
    this.root.querySelector('[data-action="clear-debug"]').onclick = () => {
      this.adapter.clearEvents();
    };
    this.root.querySelector('[data-action="self-test"]').onclick = () => {
      if (typeof this.adapter.runSelfTest === "function") {
        this.selfTestResult = this.adapter.runSelfTest();
      } else {
        this.selfTestResult = {
          ok: false,
          installed: this.adapter.installed,
          webSocketAvailable: typeof WebSocket !== "undefined",
          readableParsedTypes: [],
          binaryEnvelope: null,
          binaryParsedTypes: []
        };
        this.render();
      }
    };
    this.bindNumericInput(this.root.querySelector('[data-role="capture-limit"]'), {
      setDraft: (value) => {
        this.captureLimitDraft = value;
      },
      commit: (value) => this.commitCaptureLimit(value),
      reset: () => {
        this.captureLimitDraft = null;
        this.render();
      }
    });
    this.bindNumericInput(this.root.querySelector('[data-role="binary-sample-bytes"]'), {
      setDraft: (value) => {
        this.binarySampleBytesDraft = value;
      },
      commit: (value) => this.commitBinarySampleBytes(value),
      reset: () => {
        this.binarySampleBytesDraft = null;
        this.render();
      }
    });
    const manualInput = this.root.querySelector('[data-role="manual-input"]');
    manualInput.oninput = (event) => {
      this.updateManualInput(event.target.value, {
        refocus: true,
        selectionStart: event.target.selectionStart,
        selectionEnd: event.target.selectionEnd
      });
    };
    manualInput.onchange = (event) => {
      if (event.target.value !== this.manualInput) {
        this.updateManualInput(event.target.value);
      }
    };
    this.root.querySelector('[data-action="clear-manual-input"]').onclick = () => {
      this.updateManualInput("", { refocus: true });
    };
    this.enableDrag();
  }

  bindNumericInput(input, { setDraft, commit, reset }) {
    input.oninput = (event) => {
      event.stopPropagation();
      setDraft(event.target.value.replace(/[^\d]/g, ""));
      if (event.target.value !== event.target.value.replace(/[^\d]/g, "")) {
        event.target.value = event.target.value.replace(/[^\d]/g, "");
      }
    };
    input.onchange = (event) => {
      event.stopPropagation();
      commit(event.target.value);
    };
    input.onblur = (event) => {
      commit(event.target.value);
    };
    input.onkeydown = (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        commit(event.currentTarget.value);
        event.currentTarget.blur();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        reset();
      }
    };
  }

  commitCaptureLimit(value) {
    const nextValue = normalizeCaptureLimit(value, this.captureLimit);
    this.captureLimitDraft = null;
    this.captureLimit = nextValue;
    if (typeof this.adapter.setMaxEvents === "function") {
      this.captureLimit = this.adapter.setMaxEvents(nextValue);
    }
    writeConfig({ captureLimit: this.captureLimit });
    this.render();
  }

  commitBinarySampleBytes(value) {
    const nextValue = normalizeBinarySampleBytes(value, this.binarySampleBytes ?? DEFAULT_BINARY_SAMPLE_BYTES);
    this.binarySampleBytesDraft = null;
    if (typeof this.adapter.setBinarySampleBytes === "function") {
      this.binarySampleBytes = this.adapter.setBinarySampleBytes(nextValue);
    } else {
      this.binarySampleBytes = nextValue;
    }
    writeConfig({ binarySampleBytes: this.binarySampleBytes });
    this.render();
  }

  captureFocusSnapshot() {
    const active = document.activeElement;
    if (!active || !this.root.contains(active)) return null;
    const role = active.getAttribute("data-role");
    if (!role) return null;
    return {
      role,
      selectionStart: typeof active.selectionStart === "number" ? active.selectionStart : null,
      selectionEnd: typeof active.selectionEnd === "number" ? active.selectionEnd : null
    };
  }

  restoreFocus(snapshot) {
    if (!snapshot?.role) return;
    const input = this.root.querySelector(`[data-role="${snapshot.role}"]`);
    if (!input || typeof input.focus !== "function") return;
    input.focus({ preventScroll: true });
    if (typeof input.setSelectionRange === "function" && snapshot.selectionStart !== null) {
      const length = String(input.value || "").length;
      const start = Math.min(snapshot.selectionStart, length);
      const end = Math.min(snapshot.selectionEnd ?? start, length);
      input.setSelectionRange(start, end);
    }
  }

  updateManualInput(value, { refocus = false, selectionStart = null, selectionEnd = null } = {}) {
    this.manualInput = value;
    try {
      this.manualTiles = parseTiles(value);
      this.manualError = "";
    } catch (error) {
      this.manualTiles = [];
      this.manualError = error.message;
    }
    this.render();
    if (!refocus) return;
    const input = this.root?.querySelector('[data-role="manual-input"]');
    if (!input) return;
    input.focus();
    if (typeof input.setSelectionRange === "function") {
      const start = Math.min(selectionStart ?? value.length, value.length);
      const end = Math.min(selectionEnd ?? start, value.length);
      input.setSelectionRange(start, end);
    }
  }

  async copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.copyError = "";
      this.copyFallbackText = "";
    } catch (error) {
      this.copyError = "Clipboard write failed. Select and copy the text below.";
      this.copyFallbackText = text;
    }
    this.render();
    const fallback = this.root.querySelector('[data-role="copy-fallback"]');
    if (fallback) {
      fallback.focus();
      fallback.select();
    }
  }

  buildOverlayCapture() {
    const capture = this.adapter.exportCapture({ limit: this.captureLimit });
    const recentEvents = this.adapter.getRecentEvents().slice(0, this.captureLimit);
    const liveGameState = toCaptureStateSnapshot(this.gameState.getVisibleState());
    const liveDebugSummary = summarizeDebugEvents(recentEvents);
    const installDiagnostics = capture.helperDiagnostics || (
      typeof this.adapter.getInstallDiagnostics === "function"
        ? this.adapter.getInstallDiagnostics({ events: recentEvents })
        : {}
    );
    const liveMvpGate = buildLiveMvpGate(recentEvents, liveGameState, liveDebugSummary);
    const liveSafetySettings = buildLiveSafetySettings({
      realtimeAdvice: this.realtimeAdvice,
      manualInput: this.manualInput,
      installDiagnostics,
      adapter: this.adapter
    });
    return {
      ...capture,
      note: OVERLAY_CAPTURE_NOTE,
      verification: CAPTURE_VERIFICATION,
      liveGameState,
      liveDebugSummary,
      liveMvpGate,
      liveSafetySettings,
      liveRealPagePreflight: buildLiveRealPagePreflight({
        adapter: this.adapter,
        page: capture.page || getCurrentPageDiagnostics(),
        installDiagnostics,
        liveMvpGate,
        liveGameState,
        liveDebugSummary,
        liveSafetySettings
      }),
      liveCaptureHealth: captureHealth(this.adapter, liveDebugSummary, installDiagnostics, liveGameState)
    };
  }

  prepareCaptureDownload(link) {
    const text = safeJson(this.buildOverlayCapture());
    if (typeof Blob === "undefined" || !globalThis.URL?.createObjectURL) {
      this.copyError = "Capture download is unavailable in this browser context. Select and copy the text below.";
      this.copyFallbackText = text;
      this.render();
      return false;
    }
    if (this.downloadUrl && globalThis.URL?.revokeObjectURL) {
      globalThis.URL.revokeObjectURL(this.downloadUrl);
    }
    const blob = new Blob([text], { type: "application/json" });
    this.downloadUrl = globalThis.URL.createObjectURL(blob);
    link.href = this.downloadUrl;
    link.download = `majsoul-helper-capture-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    this.copyError = "";
    this.copyFallbackText = "";
    return true;
  }

  enableDrag() {
    const header = this.root.querySelector(".mh-header");
    let start = null;
    header.onpointerdown = (event) => {
      if (event.target.closest("button")) return;
      start = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: this.root.offsetLeft,
        top: this.root.offsetTop
      };
      header.setPointerCapture(event.pointerId);
    };
    header.onpointermove = (event) => {
      if (!start || event.pointerId !== start.pointerId) return;
      const left = Math.max(0, Math.min(window.innerWidth - this.root.offsetWidth, start.left + event.clientX - start.x));
      const top = Math.max(0, Math.min(window.innerHeight - 48, start.top + event.clientY - start.y));
      this.root.style.left = `${left}px`;
      this.root.style.right = "auto";
      this.root.style.top = `${top}px`;
    };
    header.onpointerup = () => {
      start = null;
    };
  }
}
