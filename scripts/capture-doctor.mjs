import { spawnSync } from "node:child_process";
import { isMahjongSoulPage, summarizeLiveRealPagePreflight, summarizeLiveSafetySettings } from "../src/core/realPageReadiness.js";

const args = process.argv.slice(2);
const capturePath = args.find((arg) => !arg.startsWith("--"));
const requireReady = args.includes("--require-ready");
const requireRealPageReady = args.includes("--require-real-page-ready");

if (!capturePath) {
  console.error("Usage: node scripts/capture-doctor.mjs <capture.json> [--require-ready] [--require-real-page-ready]");
  process.exit(1);
}

const replay = spawnSync(process.execPath, ["scripts/replay-capture.mjs", capturePath], {
  encoding: "utf8"
});

if (replay.error) {
  console.error(`Replay failed: ${replay.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(replay.stdout);
} catch {
  console.error("Replay failed before producing JSON diagnostics.");
  if (replay.stderr) console.error(replay.stderr.trim());
  process.exit(1);
}

const realPage = summarizeRealPageReadiness(report);
const verification = report.captureMetadata?.verification || null;
const page = report.captureMetadata?.page || null;
const helperDiagnostics = report.captureMetadata?.helperDiagnostics || null;
const preflight = report.captureMetadata?.liveRealPagePreflight || null;
const safetySettings = report.captureMetadata?.liveSafetySettings || null;
const lines = [
  `Capture doctor: ${capturePath}`,
  `Replay acceptance: ${report.acceptance?.readyForRealPageMvp ? "ready" : "not ready"} (${countPassing(report.acceptance?.checks)}/${Object.keys(report.acceptance?.checks || {}).length} checks)`,
  `Real-page readiness: ${realPage.ready ? "ready" : "not ready"}`,
  `Capture export: ${formatCaptureIntegrity(report.captureIntegrity)}`,
  `Page: ${formatPage(page)}`,
  `Preflight: ${formatPreflight(preflight)}`,
  `Hook: ${formatHook(helperDiagnostics)}`,
  `Safety: ${formatSafetySettings(safetySettings)}`,
  `Event buffer: ${formatEventBuffer(helperDiagnostics?.eventBuffer)}`,
  `Traffic: raw ${report.diagnostics?.rawMessages ?? 0} / inbound ${report.diagnostics?.inboundRawMessages ?? 0} / outbound ${report.diagnostics?.outboundRawMessages ?? 0} / envelopes ${report.diagnostics?.rawMessagesWithEnvelope ?? 0} / actions ${report.diagnostics?.rawActionTotal ?? 0} / replayed ${report.eventCount ?? 0}`,
  `Truncation: raw ${report.diagnostics?.truncatedRawMessages ?? 0} / envelopes ${report.diagnostics?.truncatedEnvelopes ?? 0} / action payloads ${report.diagnostics?.truncatedActionPayloads ?? 0}`,
  `Parsed events: ${formatCounts(report.replaySummary?.byParsedType)}`,
  `Top actions: ${formatTop(report.topActions)}`,
  `State updates: ${formatStateUpdates(report.stateDiagnostics?.stateUpdated)}`,
  `Live snapshot: ${report.liveStateComparison?.available ? `available (${report.liveStateComparison.mismatches?.length || 0} mismatches)` : "missing"}`,
  `Live overlay: ${report.liveOverlay?.available ? "available" : "missing"}`
];

if (report.acceptance?.missing?.length) {
  lines.push(`Missing replay checks: ${report.acceptance.missing.join(", ")}`);
}
if (realPage.missing.length) {
  lines.push(`Missing real-page proof: ${realPage.missing.join(", ")}`);
}
if (report.captureIntegrity?.requiredMissing?.length) {
  lines.push(`Missing capture export fields: ${report.captureIntegrity.requiredMissing.join(", ")}`);
}
if (report.captureIntegrity?.recommendedMissing?.length) {
  lines.push(`Recommended capture export fields: ${report.captureIntegrity.recommendedMissing.join(", ")}`);
}
if (report.liveStateComparison?.mismatches?.length) {
  lines.push(`Live/replay mismatches: ${report.liveStateComparison.mismatches.map((entry) => entry.key).join(", ")}`);
}
if (report.diagnostics?.unparsedActions?.length) {
  lines.push(`Unparsed actions: ${report.diagnostics.unparsedActions.map((entry) => `${entry.name} x${entry.count}`).join(", ")}`);
}
if (report.stateDiagnostics?.kanMeldMismatches?.length) {
  lines.push(`Kan mismatches: ${report.stateDiagnostics.kanMeldMismatches.map((entry) => `${entry.tile || "?"}@${entry.seat ?? "?"} ${entry.actualCopies}/${entry.expectedCopies}`).join(", ")}`);
}
if (report.stateDiagnostics?.ownKanTilesStillInHand?.length) {
  lines.push(`Own kan tiles still in hand: ${report.stateDiagnostics.ownKanTilesStillInHand.map((entry) => `${entry.tile} x${entry.count}`).join(", ")}`);
}
if (verification?.commands) {
  lines.push(`Verification commands: ${Object.values(verification.commands).join(" / ")}`);
}

lines.push("Next steps:");
for (const recommendation of report.recommendations?.length ? report.recommendations : ["No recommendation was produced. Inspect replay JSON directly."]) {
  lines.push(`- ${recommendation}`);
}
lines.push(`Offline gate: ${verification?.commands?.realPageGate || "npm run real-page-gate"}`);

console.log(lines.join("\n"));

if (requireRealPageReady && !realPage.ready) {
  process.exit(3);
}
if (requireReady && !report.acceptance?.readyForRealPageMvp) {
  process.exit(2);
}

function countPassing(checks = {}) {
  return Object.values(checks).filter(Boolean).length;
}

function formatCounts(counts = {}) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length ? entries.map(([name, count]) => `${name} x${count}`).join(", ") : "-";
}

function formatTop(entries = []) {
  return entries.length ? entries.slice(0, 5).map((entry) => `${entry.name} x${entry.count}`).join(", ") : "-";
}

function formatStateUpdates(stateUpdated = {}) {
  const keys = [
    "hand",
    "drawnTile",
    "discards",
    "melds",
    "doraIndicators",
    "roundMetadata",
    "riichi",
    "roundEndReason",
    "currentTurn",
    "scores",
    "visibleTiles",
    "warningsClear"
  ];
  return keys
    .filter((key) => Object.prototype.hasOwnProperty.call(stateUpdated, key))
    .map((key) => `${key}=${formatValue(stateUpdated[key])}`)
    .join(" / ") || "-";
}

function formatCaptureIntegrity(integrity) {
  if (!integrity) return "missing";
  const status = integrity.readyForRealPageExport ? "real-page fields complete" : "incomplete";
  const requiredTotal = integrity.requiredForRealPageExport?.length || 0;
  const requiredPassed = requiredTotal - (integrity.requiredMissing?.length || 0);
  const recommendedTotal = integrity.recommendedForOverlayExport?.length || 0;
  const recommendedPassed = recommendedTotal - (integrity.recommendedMissing?.length || 0);
  return `${status} (required ${requiredPassed}/${requiredTotal}, recommended ${recommendedPassed}/${recommendedTotal}, events ${integrity.eventCount ?? "?"})`;
}

function formatValue(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  if (value === null || value === undefined) return "-";
  return String(value);
}

function formatPage(page) {
  if (!page) return "missing";
  const label = page.sanitizedUrl || page.origin || page.host || "unknown";
  return `${label}${isMahjongSoulPage(page) ? " (Mahjong Soul)" : " (not Mahjong Soul)"}`;
}

function formatPreflight(preflight) {
  if (!preflight) return "missing";
  const status = preflight.readyToExport ? "ready" : "not ready";
  const base = `${status} (${preflight.passed ?? 0}/${preflight.total ?? 0})`;
  const missing = preflight.missing?.length ? ` missing ${preflight.missing.join(", ")}` : "";
  const hints = preflight.hints?.length ? ` next ${preflight.hints.join(" ")}` : "";
  return `${base}${missing}${hints}`;
}

function formatHook(helperDiagnostics) {
  if (!helperDiagnostics) return "missing";
  const hook = helperDiagnostics.hooks || {};
  return [
    helperDiagnostics.installed ? "installed" : "not installed",
    helperDiagnostics.paused ? "capture paused" : "capture running",
    helperDiagnostics.webSocketAvailable ? "WebSocket available" : "WebSocket missing",
    `sockets ${helperDiagnostics.socketsCreated ?? "-"}`,
    `sample ${helperDiagnostics.binarySampleBytes ?? "-"} bytes`,
    `onmessage ${hook.onmessage === undefined ? "unknown" : hook.onmessage ? "ok" : "off"} (${hook.onmessageMode || "unknown"})`
  ].join(" / ");
}

function formatSafetySettings(settings) {
  if (!settings || typeof settings !== "object") return "missing";
  const realtime = settings.realtimeAdviceEnabled ? "enabled" : "off";
  const mode = settings.realtimeAdviceMode || (settings.realtimeAdviceEnabled ? "manual opt-in" : "off");
  const capture = settings.capturePaused ? "paused" : "running";
  const automation = settings.automationDisabled === true && settings.clickAutomationDisabled === true ? "disabled" : "unknown";
  const mutation = settings.messageMutationDisabled === true ? "disabled" : "unknown";
  return `realtime advice ${realtime} (${mode}) / capture ${capture} / automation ${automation} / message mutation ${mutation}`;
}

function formatEventBuffer(eventBuffer) {
  if (!eventBuffer) return "missing";
  return [
    `retained ${eventBuffer.retainedEvents ?? "-"}/${eventBuffer.totalEventsSinceClear ?? "-"}`,
    `dropped ${eventBuffer.droppedBeforeRetained ?? 0}`,
    `ids ${eventBuffer.oldestEventId ?? "-"}-${eventBuffer.newestEventId ?? "-"}`,
    `max ${eventBuffer.maxEvents ?? "-"}`
  ].join(" / ");
}

function summarizeRealPageReadiness(report) {
  const page = report.captureMetadata?.page || null;
  const safety = summarizeLiveSafetySettings(report.captureMetadata?.liveSafetySettings || null);
  const preflight = summarizeLiveRealPagePreflight(report.captureMetadata?.liveRealPagePreflight || null);
  const missing = [];
  if (report.acceptance?.readyForRealPageMvp !== true) {
    missing.push("acceptance.readyForRealPageMvp is not true");
  }
  if (!isMahjongSoulPage(page)) {
    missing.push("captureMetadata.page is not a Mahjong Soul web page");
  }
  if (!report.liveOverlay?.available) {
    missing.push("overlay live debug/gate snapshot is missing");
  }
  if (!preflight.ready) {
    missing.push(...preflight.missing);
  }
  if (!safety.ready) {
    missing.push(...safety.missing);
  }
  if (report.acceptance?.checks?.liveStateSnapshotMatches !== true) {
    missing.push("liveStateSnapshotMatches is not true");
  }
  return {
    ready: missing.length === 0,
    missing
  };
}
