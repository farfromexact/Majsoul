import { readFile, writeFile } from "node:fs/promises";
import { replayCaptureWithDiagnostics, summarizeCaptureEvents } from "../src/adapter/majsoulAdapter.js";
import { parseBinaryEnvelope } from "../src/adapter/messageParser.js";
import { GameState } from "../src/core/gameState.js";
import { REAL_PAGE_PREFLIGHT_VERSION, REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS } from "../src/core/realPageReadiness.js";
import { indexToTile, normalizeTile, tilesToCounts } from "../src/core/tile.js";

const args = process.argv.slice(2);
const capturePath = args[0];
const fixtureOutIndex = args.indexOf("--fixture-out");
const fixtureOutPath = fixtureOutIndex >= 0 ? args[fixtureOutIndex + 1] : null;
const strictMode = args.includes("--strict");

if (!capturePath) {
  console.error("Usage: node scripts/replay-capture.mjs <capture.json> [--strict] [--fixture-out tests/fixtures/name.json]");
  process.exit(1);
}

if (fixtureOutIndex >= 0 && !fixtureOutPath) {
  console.error("Missing path after --fixture-out");
  process.exit(1);
}

const capture = JSON.parse(await readFile(capturePath, "utf8"));
const replayReport = replayCaptureWithDiagnostics(capture);
const { events, replayDedupe } = replayReport;
const gameState = new GameState();

for (const event of events) {
  gameState.applyEvent(event);
}
const visibleState = gameState.getVisibleState();

const captureSummary = capture.summary || summarizeCaptureEvents(capture.events || []);
const replaySummary = summarizeCaptureEvents(events);
const diagnostics = buildReplayDiagnostics(capture.events || [], events);
const stateDiagnostics = buildStateDiagnostics(events, visibleState);
const actionDiagnostics = buildActionDiagnostics(capture.events || [], events);
const liveStateComparison = compareLiveGameState(capture.liveGameState || null, visibleState);
const captureIntegrity = buildCaptureIntegrity(capture);
const acceptance = buildAcceptance({ diagnostics, events, gameState: visibleState, liveStateComparison, stateDiagnostics });
const stateCoverage = buildStateCoverage(acceptance, stateDiagnostics);
const liveOverlay = buildLiveOverlaySnapshot(capture, acceptance);
const recommendations = buildRecommendations(diagnostics, replaySummary, acceptance, stateDiagnostics, capture.helperDiagnostics || null, liveStateComparison, captureSummary);

const output = {
  captureMetadata: {
    exportedAt: capture.exportedAt,
    formatVersion: capture.formatVersion,
    limit: capture.limit,
    page: capture.page || null,
    helperDiagnostics: capture.helperDiagnostics || null,
    liveRealPagePreflight: capture.liveRealPagePreflight || null,
    verification: capture.verification || null,
    liveSafetySettings: capture.liveSafetySettings || null
  },
  captureIntegrity,
  captureSummary,
  replaySummary,
  topMethods: sortCounts(captureSummary.byMethodName),
  topActions: sortCounts(captureSummary.byActionName),
  topParsedTypes: sortCounts(captureSummary.byParsedType),
  topReplayedParsedTypes: sortCounts(replaySummary.byParsedType),
  replayDedupe,
  diagnostics,
  actionDiagnostics,
  stateDiagnostics,
  liveStateComparison,
  liveOverlay,
  stateCoverage,
  recommendations,
  acceptance,
  eventCount: events.length,
  eventTypes: events.map((event) => event.type),
  warnings: visibleState.warnings,
  gameState: visibleState
};

if (fixtureOutPath) {
  await writeFile(fixtureOutPath, `${JSON.stringify(toFixture(output, events), null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(output, null, 2));

if (strictMode && !acceptance.readyForRealPageMvp) {
  process.exit(2);
}

function sortCounts(counts = {}) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
}

function buildLiveOverlaySnapshot(capture, acceptance) {
  const liveMvpGate = capture?.liveMvpGate || null;
  const liveDebugSummary = capture?.liveDebugSummary || null;
  const commonGateKeys = liveMvpGate?.checks && acceptance?.checks
    ? Object.keys(liveMvpGate.checks).filter((key) => Object.prototype.hasOwnProperty.call(acceptance.checks, key))
    : [];
  const gateMismatches = commonGateKeys
    .filter((key) => Boolean(liveMvpGate.checks[key]) !== Boolean(acceptance.checks[key]))
    .map((key) => ({
      key,
      live: Boolean(liveMvpGate.checks[key]),
      replayed: Boolean(acceptance.checks[key])
    }));
  return {
    available: Boolean(liveMvpGate || liveDebugSummary || capture?.liveCaptureHealth),
    debugSummary: liveDebugSummary,
    mvpGate: liveMvpGate,
    captureHealth: capture?.liveCaptureHealth || null,
    gateComparison: {
      available: Boolean(liveMvpGate?.checks),
      comparedKeys: commonGateKeys,
      mismatches: gateMismatches
    }
  };
}

function buildCaptureIntegrity(capture) {
  const events = Array.isArray(capture?.events) ? capture.events : [];
  const verification = capture?.verification || {};
  const commands = verification.commands || {};
  const requirements = verification.realPageReadyRequires || [];
  const liveRealPagePreflight = capture?.liveRealPagePreflight || null;
  const preflightRequiredChecks = Array.isArray(liveRealPagePreflight?.requiredChecks)
    ? liveRealPagePreflight.requiredChecks
    : [];
  const checks = {
    formatVersionPresent: capture?.formatVersion !== undefined,
    eventsArrayPresent: Array.isArray(capture?.events),
    pageMetadataPresent: Boolean(capture?.page?.host || capture?.page?.origin || capture?.page?.sanitizedUrl),
    helperDiagnosticsPresent: Boolean(capture?.helperDiagnostics && typeof capture.helperDiagnostics === "object"),
    liveGameStatePresent: Boolean(capture?.liveGameState && typeof capture.liveGameState === "object"),
    liveDebugSummaryPresent: Boolean(capture?.liveDebugSummary && typeof capture.liveDebugSummary === "object"),
    liveMvpGatePresent: Boolean(capture?.liveMvpGate && typeof capture.liveMvpGate === "object"),
    liveRealPagePreflightPresent: Boolean(liveRealPagePreflight && typeof liveRealPagePreflight === "object"),
    liveRealPagePreflightVersionCurrent: liveRealPagePreflight?.preflightVersion === REAL_PAGE_PREFLIGHT_VERSION,
    liveRealPagePreflightRequiredChecksPresent: REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS.every((key) => preflightRequiredChecks.includes(key)),
    liveSafetySettingsPresent: Boolean(capture?.liveSafetySettings && typeof capture.liveSafetySettings === "object"),
    overlayNotePresent: typeof capture?.note === "string" && capture.note.includes("Majsoul Helper capture export"),
    verificationCommandsPresent: Boolean(commands.doctor && commands.replay && commands.realPageGate),
    verificationRequirementsPresent: Array.isArray(requirements)
      && requirements.includes("Mahjong Soul page metadata")
      && requirements.includes("overlay live snapshots")
      && requirements.includes("liveRealPagePreflight.readyToExport=true")
      && requirements.includes("safe liveSafetySettings")
      && requirements.includes("acceptance.readyForRealPageMvp=true")
      && requirements.includes("liveStateSnapshotMatches=true"),
    liveCaptureHealthPresent: typeof capture?.liveCaptureHealth === "string" && capture.liveCaptureHealth.length > 0,
    eventIdsPresent: events.length === 0 ? null : events.every((event) => Number.isFinite(Number(event.eventId)))
  };
  const requiredForRealPageExport = [
    "formatVersionPresent",
    "eventsArrayPresent",
    "pageMetadataPresent",
    "helperDiagnosticsPresent",
    "liveGameStatePresent",
    "liveDebugSummaryPresent",
    "liveMvpGatePresent",
    "liveRealPagePreflightPresent",
    "liveRealPagePreflightVersionCurrent",
    "liveRealPagePreflightRequiredChecksPresent"
  ];
  const recommendedForOverlayExport = [
    "overlayNotePresent",
    "verificationCommandsPresent",
    "verificationRequirementsPresent",
    "liveSafetySettingsPresent",
    "liveCaptureHealthPresent",
    "eventIdsPresent"
  ];
  const countableEntries = Object.entries(checks).filter(([, value]) => value !== null);
  const requiredMissing = requiredForRealPageExport.filter((key) => checks[key] !== true);
  const recommendedMissing = recommendedForOverlayExport.filter((key) => checks[key] !== true);
  return {
    checks,
    passed: countableEntries.filter(([, value]) => value === true).length,
    total: countableEntries.length,
    readyForRealPageExport: requiredMissing.length === 0,
    requiredForRealPageExport,
    requiredMissing,
    recommendedForOverlayExport,
    recommendedMissing,
    eventCount: events.length
  };
}

function buildReplayDiagnostics(rawEvents, replayedEvents) {
  const rawMessages = rawEvents.filter((event) => event.type === "raw_message");
  const rawMessagesWithEnvelope = rawMessages.filter((event) => getRawEnvelope(event));
  const rawActionMessages = rawMessages.filter(rawMessageHasAction);
  const rawActions = countRawEnvelopeField(rawMessages, "actionName");
  const rawMethods = countRawEnvelopeField(rawMessages, "methodName");
  const parsedActions = countParsedEnvelopeField(replayedEvents, "actionName");
  const parsedMethods = countParsedEnvelopeField(replayedEvents, "methodName");
  const unparsedActions = subtractCounts(rawActions, parsedActions);
  const unparsedMethods = subtractCounts(rawMethods, parsedMethods);
  const rawActionTotal = sumCounts(rawActions);
  const parsedActionTotal = Math.min(rawActionTotal, sumCounts(parsedActions));

  return {
    rawMessages: rawMessages.length,
    inboundRawMessages: rawMessages.filter((event) => event.source === "ws_in").length,
    outboundRawMessages: rawMessages.filter((event) => event.source === "ws_out").length,
    rawMessagesWithEnvelope: rawMessagesWithEnvelope.length,
    truncatedRawMessages: rawMessages.filter(rawSampleTruncated).length,
    truncatedEnvelopes: rawMessagesWithEnvelope.filter(rawSampleTruncated).length,
    truncatedActionPayloads: rawActionMessages.filter(rawSampleTruncated).length,
    rawActionTotal,
    parsedActionTotal,
    parsedActionCoverage: rawActionTotal === 0 ? null : Number((parsedActionTotal / rawActionTotal).toFixed(3)),
    unparsedActions: sortCounts(unparsedActions),
    unparsedMethods: sortCounts(unparsedMethods)
  };
}

function buildActionDiagnostics(rawEvents, replayedEvents) {
  const parsedActions = countParsedEnvelopeField(replayedEvents, "actionName");
  const actionMap = new Map();

  for (const event of rawEvents || []) {
    if (event.type !== "raw_message") continue;
    const envelope = getRawEnvelope(event);
    const actionNames = rawEnvelopeFieldValues(event, "actionName");
    if (!actionNames.length) continue;

    for (const actionName of actionNames) {
      if (!actionMap.has(actionName)) {
        actionMap.set(actionName, {
          name: actionName,
          methodName: envelope.methodName,
          count: 0,
          parsedCount: 0,
          unparsedCount: 0,
          sample: buildActionSample(event, envelope)
        });
      }
      actionMap.get(actionName).count += 1;
    }
  }

  return Array.from(actionMap.values())
    .map((entry) => ({
      ...entry,
      parsedCount: parsedActions[entry.name] || 0,
      unparsedCount: Math.max(0, entry.count - (parsedActions[entry.name] || 0))
    }))
    .sort((a, b) => b.unparsedCount - a.unparsedCount || b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 20);
}

function buildActionSample(event, envelope) {
  const payload = event.payload || {};
  return {
    source: event.source || "unknown",
    kind: payload.kind || "unknown",
    messageLength: payload.length ?? null,
    payloadLength: envelope.payloadLength ?? null,
    actionPayloadLength: envelope.actionPayloadLength ?? null,
    payloadTruncated: Boolean(payload.truncated || envelope.payloadTruncated),
    actionPayloadTruncated: Boolean(envelope.actionPayloadTruncated),
    actionPayloadFields: envelope.actionPayloadFields || {
      varints: [],
      strings: [],
      tileStrings: []
    }
  };
}

function buildStateDiagnostics(events, gameState) {
  const chiPengGangEvents = events.filter((event) => isChiPengGangAction(event.payload?.binaryEnvelope?.actionName));
  const anGangAddGangEvents = events.filter((event) => isAnGangAddGangAction(event.payload?.binaryEnvelope?.actionName));
  const callMeldEvents = events.filter((event) => event.type === "call_meld");
  const callMeldEventsWithSeat = callMeldEvents.filter((event) => isValidSeat(event.payload?.seat));
  const anGangAddGangEventsWithSeat = anGangAddGangEvents.filter((event) => isValidSeat(event.payload?.seat));
  const closedKanEvents = anGangAddGangEvents.filter((event) => Number(event.payload?.type) === 3);
  const addedKanEvents = anGangAddGangEvents.filter((event) => Number(event.payload?.type) === 2);
  const unknownKanTypeEvents = anGangAddGangEvents.filter((event) => {
    const type = Number(event.payload?.type);
    return type !== 2 && type !== 3;
  });
  const ownAnGangAddGangEvents = anGangAddGangEvents.filter((event) => Number(event.payload?.seat) === 0);
  const kanMeldMismatches = buildKanMeldMismatches(gameState, anGangAddGangEvents);
  const ownKanTilesStillInHand = buildOwnKanTilesStillInHand(gameState, ownAnGangAddGangEvents);
  const riichiEvents = events.filter((event) => event.type === "riichi");
  const riichiEventsWithSeat = riichiEvents.filter((event) => isValidSeat(event.payload?.seat));
  const roundEndEvents = events.filter((event) => event.type === "round_end");
  const roundEndEventsWithScores = roundEndEvents.filter((event) => event.payload?.scores?.length);
  const ownDrawTileEvents = events.filter((event) => event.type === "draw_tile" && Number(event.payload?.seat) === 0);
  const ownDrawTileEventsWithValidTile = ownDrawTileEvents.filter((event) => isValidTile(event.payload?.tile));
  const meldCount = (gameState.melds || []).reduce((sum, melds) => sum + melds.length, 0);
  const knownTileCounts = countKnownTiles(gameState);
  const eventCounts = countEventTypes(events);
  const expectedCurrentTurn = inferExpectedCurrentTurn(events);
  const currentTurnMatchesExpected = expectedCurrentTurn === null
    ? null
    : Number(gameState.currentTurn) === expectedCurrentTurn;
  const expectedDiscards = [[], [], [], []];
  let claimableChiPengGangEvents = 0;
  for (const event of chronologicalEvents(events)) {
    if (event.type === "discard_tile" && isValidSeat(event.payload?.seat) && event.payload?.tile) {
      expectedDiscards[Number(event.payload.seat)].push(event.payload.tile);
    }
    if (isChiPengGangAction(event.payload?.binaryEnvelope?.actionName)) {
      const meld = normalizeMeld(event.payload?.meld);
      const callerSeat = Number(event.payload?.seat);
      const removed = removeLatestClaimedDiscard(expectedDiscards, meld, callerSeat);
      if (removed) claimableChiPengGangEvents += 1;
    }
  }
  const claimedDiscardTransferred = chiPengGangEvents.length
    ? discardsEqual(expectedDiscards, gameState.discards || [])
    : null;

  return {
    eventCounts,
    stateUpdated: {
      hand: Boolean(gameState.hand?.length),
      drawnTile: Boolean(gameState.drawnTile) || ownDrawTileEventsWithValidTile.length > 0,
      discards: Boolean(gameState.discards?.some((tiles) => tiles.length)),
      melds: meldCount > 0,
      doraIndicators: Boolean(gameState.doraIndicators?.length),
      roundMetadata: gameState.chang !== null || gameState.ju !== null || gameState.round !== null,
      riichi: Boolean(gameState.riichi?.some(Boolean)),
      roundEndReason: gameState.roundEndReason !== null,
      currentTurn: currentTurnMatchesExpected,
      scores: Boolean(gameState.scoresKnown || gameState.scores?.some((score) => score !== 25000)),
      visibleTiles: Boolean(gameState.visibleTiles?.length),
      warningsClear: !(gameState.warnings?.length)
    },
    callMeldEvents: callMeldEvents.length,
    callMeldEventsWithSeat: callMeldEventsWithSeat.length,
    riichiEvents: riichiEvents.length,
    riichiEventsWithSeat: riichiEventsWithSeat.length,
    roundEndEvents: roundEndEvents.length,
    roundEndEventsWithScores: roundEndEventsWithScores.length,
    ownDrawTileEvents: ownDrawTileEvents.length,
    ownDrawTileEventsWithValidTile: ownDrawTileEventsWithValidTile.length,
    drawnTileRetained: Boolean(gameState.drawnTile),
    chiPengGangEvents: chiPengGangEvents.length,
    claimableChiPengGangEvents,
    anGangAddGangEvents: anGangAddGangEvents.length,
    anGangAddGangEventsWithSeat: anGangAddGangEventsWithSeat.length,
    closedKanEvents: closedKanEvents.length,
    addedKanEvents: addedKanEvents.length,
    unknownKanTypeEvents: unknownKanTypeEvents.length,
    ownAnGangAddGangEvents: ownAnGangAddGangEvents.length,
    kanTypeKnown: anGangAddGangEvents.length ? unknownKanTypeEvents.length === 0 : null,
    kanMeldTileCountsOk: anGangAddGangEvents.length ? kanMeldMismatches.length === 0 : null,
    closedKanVisibleTileCountsOk: closedKanEvents.length
      ? kanMeldMismatches.every((entry) => Number(entry.type) !== 3)
      : null,
    addedKanVisibleTileCountsOk: addedKanEvents.length
      ? kanMeldMismatches.every((entry) => Number(entry.type) !== 2)
      : null,
    ownKanTilesRemoved: ownAnGangAddGangEvents.length ? ownKanTilesStillInHand.length === 0 : null,
    kanMeldMismatches,
    ownKanTilesStillInHand,
    meldCount,
    invalidTiles: gameState.invalidTiles || [],
    overKnownTileLimit: knownTileCounts.filter((entry) => entry.count > 4),
    expectedCurrentTurn,
    currentTurnMatchesExpected,
    claimedDiscardTransferred: chiPengGangEvents.length ? claimedDiscardTransferred : null
  };
}

function isChiPengGangAction(actionName) {
  return actionName === "ActionChiPengGang" || actionName === "RecordChiPengGang";
}

function isAnGangAddGangAction(actionName) {
  return actionName === "ActionAnGangAddGang" || actionName === "RecordAnGangAddGang";
}

function chronologicalEvents(events) {
  const entries = [...(events || [])];
  if (entries.every((event) => Number.isFinite(Number(event.ts)))) {
    return entries.sort((left, right) => Number(left.ts) - Number(right.ts));
  }
  return entries;
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

function buildStateCoverage(acceptance, stateDiagnostics) {
  const checks = acceptance.checks || {};
  const requiredKeys = [
    "rawMessagesCaptured",
    "binaryEnvelopeDecoded",
    "actionPrototypeDecoded",
    "drawTileParsed",
    "drawTileSeatParsed",
    "discardTileParsed",
    "discardTileSeatParsed",
    "gameStateHandUpdated",
    "gameStateRoundMetadataUpdated",
    "gameStateDrawnTileUpdated",
    "gameStateDiscardsUpdated",
    "gameStateDoraIndicatorsUpdated",
    "gameStateScoresUpdated",
    "gameStateVisibleTilesUpdated",
    "gameStateWarningsClear"
  ];
  if (Object.prototype.hasOwnProperty.call(checks, "liveStateSnapshotMatches")) {
    requiredKeys.push("liveStateSnapshotMatches");
  }
  for (const conditionalKey of [
    "callMeldSeatParsed",
    "gameStateMeldsUpdated",
    "claimedDiscardTransferred",
    "anGangAddGangSeatParsed",
    "kanTypeKnown",
    "kanMeldTileCountsOk",
    "ownKanTilesRemoved",
    "gameStateCurrentTurnUpdated",
    "riichiSeatParsed",
    "gameStateRiichiUpdated",
    "roundEndReasonUpdated",
    "roundEndScoresUpdated"
  ]) {
    if (Object.prototype.hasOwnProperty.call(checks, conditionalKey)) {
      requiredKeys.push(conditionalKey);
    }
  }
  const required = Object.fromEntries(requiredKeys.map((key) => [key, Boolean(checks[key])]));
  const eventCounts = stateDiagnostics.eventCounts || {};
  const stateUpdated = stateDiagnostics.stateUpdated || {};
  const optional = {
    melds: {
      observed: Number(eventCounts.call_meld || 0) > 0,
      seatParsed: Number(stateDiagnostics.callMeldEventsWithSeat || 0) > 0,
      updated: Boolean(stateUpdated.melds),
      eventCount: Number(eventCounts.call_meld || 0),
      note: "Required when the capture includes call_meld events."
    },
    kan: {
      observed: Number(stateDiagnostics.anGangAddGangEvents || 0) > 0,
      seatParsed: Number(stateDiagnostics.anGangAddGangEventsWithSeat || 0) > 0,
      closedEvents: Number(stateDiagnostics.closedKanEvents || 0),
      addedEvents: Number(stateDiagnostics.addedKanEvents || 0),
      unknownTypeEvents: Number(stateDiagnostics.unknownKanTypeEvents || 0),
      typeKnown: stateDiagnostics.kanTypeKnown,
      visibleTileCountsOk: stateDiagnostics.kanMeldTileCountsOk,
      ownTilesRemoved: stateDiagnostics.ownKanTilesRemoved,
      mismatches: stateDiagnostics.kanMeldMismatches || [],
      ownTilesStillInHand: stateDiagnostics.ownKanTilesStillInHand || [],
      eventCount: Number(stateDiagnostics.anGangAddGangEvents || 0),
      note: "Required when the capture includes ActionAnGangAddGang or RecordAnGangAddGang events."
    },
    riichi: {
      observed: Number(eventCounts.riichi || 0) > 0,
      seatParsed: Number(stateDiagnostics.riichiEventsWithSeat || 0) > 0,
      updated: Boolean(stateUpdated.riichi),
      eventCount: Number(eventCounts.riichi || 0),
      note: "Required when the capture includes riichi events."
    },
    roundEnd: {
      observed: Number(eventCounts.round_end || 0) > 0,
      reasonUpdated: Boolean(stateUpdated.roundEndReason),
      scoreEvents: Number(stateDiagnostics.roundEndEventsWithScores || 0),
      scoresUpdated: Number(stateDiagnostics.roundEndEventsWithScores || 0) > 0
        ? Boolean(checks.roundEndScoresUpdated)
        : null,
      eventCount: Number(eventCounts.round_end || 0),
      note: "Round-end reason is required when round_end appears; score updates are required when parsed round_end events include scores."
    },
    roundEndScores: {
      observed: Number(eventCounts.round_end || 0) > 0,
      updated: Boolean(stateUpdated.scores),
      eventCount: Number(eventCounts.round_end || 0),
      note: "Legacy summary: true when any round_end appears; use optional.roundEnd.scoreEvents for score payload presence."
    },
    currentTurn: {
      expected: stateDiagnostics.expectedCurrentTurn,
      updated: stateDiagnostics.expectedCurrentTurn === null ? null : Boolean(stateUpdated.currentTurn),
      note: "Required when the final replayed event implies a non-empty current turn."
    }
  };
  const requiredMissing = Object.entries(required)
    .filter(([, passed]) => !passed)
    .map(([key]) => key);
  return {
    required,
    requiredPassed: requiredMissing.length === 0,
    requiredMissing,
    optional
  };
}

function compareLiveGameState(liveGameState, replayedState) {
  const keys = [
    "hand",
    "drawnTile",
    "melds",
    "discards",
    "doraIndicators",
    "round",
    "chang",
    "ju",
    "honba",
    "riichiSticks",
    "roundWind",
    "seatWind",
    "currentTurn",
    "leftTileCount",
    "lastStep",
    "roundEndReason",
    "riichi",
    "scores",
    "scoresKnown",
    "visibleTiles",
    "warnings"
  ];

  if (!liveGameState || typeof liveGameState !== "object") {
    return {
      available: false,
      comparedKeys: [],
      matchingKeys: [],
      mismatches: []
    };
  }

  const mismatches = [];
  const matchingKeys = [];
  const comparedKeys = [];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(liveGameState, key)) continue;
    comparedKeys.push(key);
    const liveValue = liveGameState[key];
    const replayValue = replayedState?.[key];
    if (stableJson(liveValue) === stableJson(replayValue)) {
      matchingKeys.push(key);
    } else {
      mismatches.push({ key, live: liveValue, replayed: replayValue });
    }
  }

  return {
    available: true,
    comparedKeys,
    matchingKeys,
    mismatches
  };
}

function stableJson(value) {
  return JSON.stringify(value);
}

function countEventTypes(events) {
  const counts = {};
  for (const event of events) {
    counts[event.type] = (counts[event.type] || 0) + 1;
  }
  return counts;
}

function countKnownTiles(gameState) {
  const knownTiles = [
    ...(gameState.hand || []),
    gameState.drawnTile,
    ...((gameState.visibleTiles || []))
  ].filter(Boolean);
  const counts = tilesToCounts(knownTiles);
  return counts
    .map((count, index) => ({ tile: indexToTile(index), count }))
    .filter((entry) => entry.count > 0);
}

function countRawEnvelopeField(events, field) {
  const counts = {};
  for (const event of events) {
    for (const value of rawEnvelopeFieldValues(event, field)) {
      counts[value] = (counts[value] || 0) + 1;
    }
  }
  return counts;
}

function rawEnvelopeFieldValues(event, field) {
  const envelope = getRawEnvelope(event);
  if (!envelope) return [];
  const values = [];
  if (envelope[field]) values.push(envelope[field]);
  if (field === "actionName" && Array.isArray(envelope.restoreActionNames)) {
    values.push(...envelope.restoreActionNames);
  }
  return values.filter(Boolean);
}

function rawMessageHasAction(event) {
  return rawEnvelopeFieldValues(event, "actionName").length > 0;
}

function rawSampleTruncated(event) {
  return Boolean(event?.payload?.truncated);
}

function getRawEnvelope(event) {
  const payload = event.payload || {};
  if (payload.envelope) return payload.envelope;
  if (!payload.sample || payload.kind === "text") return null;
  return parseBinaryEnvelope(hexToBytes(payload.sample));
}

function hexToBytes(hex) {
  return new Uint8Array(hex.split(/\s+/).filter(Boolean).map((part) => Number.parseInt(part, 16)));
}

function countParsedEnvelopeField(events, field) {
  const counts = {};
  for (const event of events) {
    const value = event.payload?.binaryEnvelope?.[field];
    if (value) counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function subtractCounts(left, right) {
  const result = {};
  for (const [name, count] of Object.entries(left)) {
    const remaining = count - (right[name] || 0);
    if (remaining > 0) result[name] = remaining;
  }
  return result;
}

function sumCounts(counts) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function buildRecommendations(diagnostics, replaySummary, acceptance, stateDiagnostics, helperDiagnostics = null, liveStateComparison = null, captureSummary = null) {
  const recommendations = [];
  const captureErrors = Number(captureSummary?.byDiagnosticType?.capture_error || 0);
  if (captureErrors > 0) {
    recommendations.push(`Capture contains ${captureErrors} helper capture_error event${captureErrors === 1 ? "" : "s"}. Inspect recent debug events before trusting missing parser/state diagnostics.`);
  }
  if (helperDiagnostics?.paused) {
    recommendations.push("Capture was exported while capture was paused. Resume capture and collect fresh in-table traffic before trusting missing-event diagnostics.");
  }
  const eventBuffer = helperDiagnostics?.eventBuffer;
  if (Number(eventBuffer?.droppedBeforeRetained || 0) > 0) {
    recommendations.push(`Capture retained ${eventBuffer.retainedEvents} of ${eventBuffer.totalEventsSinceClear} helper events; ${eventBuffer.droppedBeforeRetained} older events were dropped before export. Increase Capture limit and collect from round start if round metadata or hand state is missing.`);
  }
  if (diagnostics.rawMessages === 0) {
    if (helperDiagnostics && !helperDiagnostics.installed) {
      const reason = helperDiagnostics.installFailureReason ? ` Reason: ${helperDiagnostics.installFailureReason}` : "";
      recommendations.push(`No raw WebSocket messages were captured because the helper hook was not installed.${reason}`);
    } else if (
      helperDiagnostics
      && Object.prototype.hasOwnProperty.call(helperDiagnostics, "socketsCreated")
      && Number(helperDiagnostics.socketsCreated) === 0
    ) {
      recommendations.push("No raw WebSocket messages were captured and no WebSocket instances were observed. Reload the game client after enabling the userscript, then join a table.");
    } else {
      recommendations.push("No raw WebSocket messages were captured. Confirm Tampermonkey page injection and join a table before copying capture.");
    }
  }
  if (diagnostics.rawMessages > 0 && diagnostics.inboundRawMessages === 0) {
    if (helperDiagnostics?.hooks?.onmessage === false && helperDiagnostics.hooks.onmessageMode === "non-configurable") {
      recommendations.push("Only outbound WebSocket messages were captured, and onmessage could not be patched because its descriptor is non-configurable. Confirm whether the client uses addEventListener(\"message\", ...) or collect a browser console hook diagnostic before changing parser mappings.");
    } else {
      recommendations.push("Only outbound WebSocket messages were captured. Keep the table open longer or inspect message listener hook coverage before changing parser mappings.");
    }
  }
  const constructorStaticFailures = helperDiagnostics?.hooks?.constructorStatics?.failed || [];
  if (constructorStaticFailures.length > 0) {
    recommendations.push(`WebSocket constructor static properties failed to copy: ${constructorStaticFailures.join(", ")}. Inspect hook compatibility before trusting the live page capture.`);
  }
  const prototypeConstructorStatus = helperDiagnostics?.hooks?.prototypeConstructor || "";
  if (typeof prototypeConstructorStatus === "string" && prototypeConstructorStatus.startsWith("failed")) {
    recommendations.push(`WebSocket prototype.constructor was not patched (${prototypeConstructorStatus}). Inspect hook compatibility before trusting the live page capture.`);
  }
  if (diagnostics.rawMessages > 0 && diagnostics.rawMessagesWithEnvelope === 0) {
    recommendations.push("Raw messages were captured but no Liqi-style envelope was decoded. Inspect payload.kind/sample and confirm the traffic is Mahjong Soul game WebSocket traffic.");
  }
  if (diagnostics.truncatedRawMessages > 0) {
    recommendations.push("Some raw binary capture samples are truncated. Increase Binary sample bytes and collect a fresh capture before mapping missing fields.");
  }
  if (diagnostics.unparsedActions.length > 0) {
    recommendations.push(`Map unparsed ActionPrototype events: ${diagnostics.unparsedActions.map((entry) => entry.name).join(", ")}.`);
  }
  if (
    helperDiagnostics?.runtime?.unityWebGL
    && diagnostics.rawActionTotal > 0
    && helperDiagnostics?.hooks?.decodedMessage === false
    && helperDiagnostics?.hooks?.decodedDispatcher === false
    && !acceptance.readyForRealPageMvp
  ) {
    recommendations.push("Unity WebGL runtime detected: raw ActionPrototype names are captured, but the old JS decode hooks are not available. Map a Unity runtime hook or decode the action payload before expecting seats, tiles, and hand state to update.");
  }
  if (stateDiagnostics.invalidTiles?.length > 0) {
    recommendations.push("Invalid tile names were ignored while replaying state. Inspect stateDiagnostics.invalidTiles contexts before trusting field mapping.");
  }
  for (const recommendation of buildStateUpdateRecommendations(stateDiagnostics)) {
    recommendations.push(recommendation);
  }
  if (liveStateComparison?.available && liveStateComparison.mismatches?.length > 0) {
    recommendations.push(`Replay state differs from liveGameState snapshot for: ${liveStateComparison.mismatches.map((entry) => entry.key).join(", ")}. Increase capture limit or collect from round start before trusting replayed state.`);
  }
  if (diagnostics.rawActionTotal > 0 && diagnostics.parsedActionTotal === 0 && diagnostics.unparsedActions.length === 0) {
    recommendations.push("ActionPrototype messages were found but produced no standard events. Inspect action payload samples and event type mapping.");
  }
  if (
    replaySummary.parsedEvents === 0
    && diagnostics.rawMessagesWithEnvelope > 0
    && diagnostics.rawActionTotal === 0
    && diagnostics.unparsedMethods.length > 0
  ) {
    const methods = diagnostics.unparsedMethods.map((entry) => entry.name).slice(0, 5).join(", ");
    recommendations.push(`Only non-action Liqi methods were captured (${methods}). Wait for ActionPrototype or game_restore traffic from an in-table hand before changing parser mappings.`);
  }
  if (replaySummary.parsedEvents === 0 && diagnostics.rawMessages > 0 && recommendations.length === 0) {
    recommendations.push("No standard events replayed from this capture. Capture more in-table actions such as draw/discard or inspect unknown method names.");
  }
  if (!acceptance.readyForRealPageMvp && recommendations.length === 0) {
    recommendations.push(`Capture does not yet satisfy real-page MVP acceptance. Missing: ${acceptance.missing.join(", ")}.`);
  }
  if (recommendations.length === 0) {
    recommendations.push("Capture looks usable for current parser coverage. Validate gameState against the visible table state.");
  }
  return recommendations;
}

function buildStateUpdateRecommendations(stateDiagnostics) {
  const eventCounts = stateDiagnostics.eventCounts || {};
  const stateUpdated = stateDiagnostics.stateUpdated || {};
  const recommendations = [];
  if (eventCounts.round_start > 0 && !stateUpdated.roundMetadata) {
    recommendations.push("round_start events replayed, but round metadata did not update. Inspect ActionNewRound chang/ju/round fields in actionPayloadFields before trusting table state.");
  }
  if (eventCounts.round_start > 0 && !stateUpdated.hand) {
    recommendations.push("round_start events replayed, but no hand tiles were restored. Inspect ActionNewRound hand tile fields before using captured analysis.");
  }
  if (eventCounts.call_meld > 0 && !stateUpdated.melds) {
    recommendations.push("call_meld events replayed, but meld state did not update. Inspect call seat and meld tile fields in actionPayloadFields.");
  }
  if (eventCounts.call_meld > 0 && Number(stateDiagnostics.callMeldEventsWithSeat || 0) === 0) {
    recommendations.push("call_meld events replayed, but no valid caller seat was parsed. Inspect ActionChiPengGang/ActionAnGangAddGang seat fields before trusting meld state.");
  }
  if (Number(stateDiagnostics.claimableChiPengGangEvents || 0) > 0 && stateDiagnostics.claimedDiscardTransferred === false) {
    recommendations.push("ActionChiPengGang events replayed, but claimed discards were not removed from rivers. Inspect meld tile fields before trusting visible-tile counts.");
  }
  if (Number(stateDiagnostics.anGangAddGangEvents || 0) > 0 && Number(stateDiagnostics.anGangAddGangEventsWithSeat || 0) === 0) {
    recommendations.push("ActionAnGangAddGang events replayed, but no valid kan caller seat was parsed. Inspect seat field mapping before trusting kan state.");
  }
  if (Number(stateDiagnostics.unknownKanTypeEvents || 0) > 0) {
    recommendations.push("ActionAnGangAddGang events replayed with unknown type values. Confirm whether the payload is closed kan, added kan, or a changed protocol field.");
  }
  if (Number(stateDiagnostics.closedKanEvents || 0) > 0 && stateDiagnostics.closedKanVisibleTileCountsOk === false) {
    recommendations.push("ActionAnGangAddGang closed-kan events replayed, but no four-tile concealed kan meld was visible. Inspect type/tile fields before trusting visible-tile counts.");
  }
  if (Number(stateDiagnostics.addedKanEvents || 0) > 0 && stateDiagnostics.addedKanVisibleTileCountsOk === false) {
    recommendations.push("ActionAnGangAddGang added-kan events replayed, but no four-tile upgraded kan meld was visible. Capture from the earlier pon or inspect type/tile fields before trusting meld state.");
  }
  if (Number(stateDiagnostics.ownAnGangAddGangEvents || 0) > 0 && stateDiagnostics.ownKanTilesRemoved === false) {
    recommendations.push("Own ActionAnGangAddGang events replayed, but matching tiles still remain in hand or drawnTile. Inspect own-kan tile removal before trusting hand state.");
  }
  if (stateDiagnostics.expectedCurrentTurn !== null && stateDiagnostics.currentTurnMatchesExpected === false) {
    recommendations.push(`Parsed events imply currentTurn seat ${stateDiagnostics.expectedCurrentTurn}, but gameState.currentTurn did not match. Inspect draw/call/discard ordering before trusting turn display.`);
  }
  if (eventCounts.dora > 0 && !stateUpdated.doraIndicators) {
    recommendations.push("dora events replayed, but dora indicators did not update. Inspect parsed dora tile fields before trusting ukeire counts.");
  }
  if (eventCounts.riichi > 0 && !stateUpdated.riichi) {
    recommendations.push("riichi events replayed, but riichi state did not update. Inspect parsed riichi seat fields.");
  }
  if (eventCounts.riichi > 0 && Number(stateDiagnostics.riichiEventsWithSeat || 0) === 0) {
    recommendations.push("riichi events replayed, but no valid riichi seat was parsed. Inspect LiQiSuccess or ActionLiqi seat fields.");
  }
  if (eventCounts.round_end > 0 && !stateUpdated.roundEndReason) {
    recommendations.push("round_end events replayed, but roundEndReason did not update. Inspect ActionHule/ActionLiuJu/ActionNoTile event mapping.");
  }
  if (eventCounts.round_end > 0 && !stateUpdated.scores) {
    recommendations.push("round_end events replayed, but scores did not change. Inspect ActionHule/ActionLiuJu/ActionNoTile score fields before trusting score state.");
  }
  return recommendations;
}

function buildAcceptance({ diagnostics, events, gameState, liveStateComparison = null, stateDiagnostics = null }) {
  const eventTypes = events.map((event) => event.type);
  const checks = {
    rawMessagesCaptured: diagnostics.rawMessages > 0,
    binaryEnvelopeDecoded: diagnostics.rawMessagesWithEnvelope > 0,
    actionPrototypeDecoded: diagnostics.rawActionTotal > 0,
    drawTileParsed: eventTypes.includes("draw_tile"),
    drawTileSeatParsed: hasEventWithValidSeat(events, "draw_tile"),
    discardTileParsed: eventTypes.includes("discard_tile"),
    discardTileSeatParsed: hasEventWithValidSeat(events, "discard_tile"),
    gameStateHandUpdated: Boolean(gameState.hand?.length),
    gameStateRoundMetadataUpdated: gameState.chang !== null || gameState.ju !== null || gameState.round !== null,
    gameStateDrawnTileUpdated: Boolean(gameState.drawnTile) || hasOwnDrawTileWithValidTile(events),
    gameStateDiscardsUpdated: Boolean(gameState.discards?.some((tiles) => tiles.length)),
    gameStateDoraIndicatorsUpdated: Boolean(gameState.doraIndicators?.length),
    gameStateScoresUpdated: Boolean(gameState.scoresKnown || gameState.scores?.some((score) => score !== 25000)),
    gameStateVisibleTilesUpdated: Boolean(gameState.visibleTiles?.length),
    gameStateWarningsClear: !(gameState.warnings?.length)
  };
  if (eventTypes.includes("call_meld")) {
    checks.callMeldSeatParsed = hasEventWithValidSeat(events, "call_meld");
    checks.gameStateMeldsUpdated = Boolean(gameState.melds?.some((melds) => melds.length));
  }
  if (Number(stateDiagnostics?.claimableChiPengGangEvents || 0) > 0) {
    checks.claimedDiscardTransferred = stateDiagnostics.claimedDiscardTransferred === true;
  }
  if (Number(stateDiagnostics?.anGangAddGangEvents || 0) > 0) {
    checks.anGangAddGangSeatParsed = Number(stateDiagnostics.anGangAddGangEventsWithSeat || 0) === Number(stateDiagnostics.anGangAddGangEvents || 0);
    checks.kanTypeKnown = stateDiagnostics.kanTypeKnown === true;
    checks.kanMeldTileCountsOk = stateDiagnostics.kanMeldTileCountsOk === true;
  }
  if (Number(stateDiagnostics?.ownAnGangAddGangEvents || 0) > 0) {
    checks.ownKanTilesRemoved = stateDiagnostics.ownKanTilesRemoved === true;
  }
  if (stateDiagnostics?.expectedCurrentTurn !== null && stateDiagnostics?.expectedCurrentTurn !== undefined) {
    checks.gameStateCurrentTurnUpdated = Number(gameState.currentTurn) === Number(stateDiagnostics.expectedCurrentTurn);
  }
  if (eventTypes.includes("riichi")) {
    checks.riichiSeatParsed = hasEventWithValidSeat(events, "riichi");
    checks.gameStateRiichiUpdated = Boolean(gameState.riichi?.some(Boolean));
  }
  if (eventTypes.includes("round_end")) {
    checks.roundEndReasonUpdated = gameState.roundEndReason !== null;
    const roundEndScores = latestRoundEndScores(events);
    if (roundEndScores) {
      checks.roundEndScoresUpdated = stableJson(gameState.scores) === stableJson(roundEndScores);
    }
  }
  if (liveStateComparison?.available) {
    checks.liveStateSnapshotMatches = liveStateComparison.mismatches.length === 0;
  }
  return {
    readyForRealPageMvp: Object.values(checks).every(Boolean),
    checks,
    missing: Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name)
  };
}

function hasEventWithValidSeat(events, type) {
  return events.some((event) => event.type === type && isValidSeat(event.payload?.seat));
}

function hasOwnDrawTileWithValidTile(events) {
  return events.some((event) => event.type === "draw_tile" && Number(event.payload?.seat) === 0 && isValidTile(event.payload?.tile));
}

function latestRoundEndScores(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "round_end" && event.payload?.scores?.length) {
      return event.payload.scores;
    }
  }
  return null;
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

function normalizeMeld(meld) {
  if (!meld) return [];
  return Array.isArray(meld) ? meld : [meld];
}

function buildKanMeldMismatches(gameState, events) {
  const mismatches = [];
  for (const event of events) {
    const seat = Number(event.payload?.seat);
    const tile = eventKanTile(event);
    if (!isValidSeat(seat) || !tile) {
      mismatches.push({
        seat: isValidSeat(seat) ? seat : null,
        type: event.payload?.type ?? null,
        tile,
        expectedCopies: 4,
        actualCopies: 0,
        reason: "missing valid seat or tile"
      });
      continue;
    }
    const actualCopies = maxMeldCopies(gameState, seat, tile);
    if (actualCopies < 4) {
      mismatches.push({
        seat,
        type: event.payload?.type ?? null,
        tile,
        expectedCopies: 4,
        actualCopies,
        reason: "no four-tile kan meld in final state"
      });
    }
  }
  return mismatches;
}

function buildOwnKanTilesStillInHand(gameState, events) {
  const ownKnownTiles = [
    ...(gameState.hand || []),
    gameState.drawnTile
  ].filter(Boolean).map((tile) => normalizeTile(tile));
  const counts = {};
  for (const tile of ownKnownTiles) {
    counts[tile] = (counts[tile] || 0) + 1;
  }
  const leftovers = [];
  for (const event of events) {
    const tile = eventKanTile(event);
    if (tile && counts[tile] > 0 && !leftovers.some((entry) => entry.tile === tile)) {
      leftovers.push({ tile, count: counts[tile] });
    }
  }
  return leftovers;
}

function eventKanTile(event) {
  const normalizedTiles = normalizeMeld(event.payload?.meld)
    .filter((tile) => isValidTile(tile))
    .map((tile) => normalizeTile(tile));
  return normalizedTiles[0] || null;
}

function maxMeldCopies(gameState, seat, tile) {
  const melds = gameState.melds?.[seat] || [];
  let maxCopies = 0;
  for (const meld of melds) {
    const copies = normalizeMeld(meld)
      .filter((meldTile) => isValidTile(meldTile))
      .map((meldTile) => normalizeTile(meldTile))
      .filter((meldTile) => meldTile === tile)
      .length;
    maxCopies = Math.max(maxCopies, copies);
  }
  return maxCopies;
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

function toFixture(output, events) {
  return {
    fixtureVersion: 1,
    fixtureKind: "sanitized-replay",
    generatedBy: "scripts/replay-capture.mjs --fixture-out",
    sourceSummary: {
      readyForRealPageMvp: Boolean(output.acceptance?.readyForRealPageMvp),
      eventCount: output.eventCount,
      eventTypes: output.eventTypes,
      warnings: output.warnings || []
    },
    eventTypes: output.eventTypes,
    events: events.map((event) => ({
      type: event.type,
      source: event.source,
      payload: stripRawSamples(event.payload || {})
    })),
    gameState: stripRawSamples(output.gameState)
  };
}

function stripRawSamples(value) {
  if (Array.isArray(value)) {
    return value.map(stripRawSamples);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const result = {};
  for (const [key, nested] of Object.entries(value)) {
    if (["rawSummary", "sample", "payloadSample", "actionPayloadSample"].includes(key)) continue;
    result[key] = stripRawSamples(nested);
  }
  return result;
}
