import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { isMahjongSoulPage, summarizeLiveRealPagePreflight, summarizeLiveSafetySettings } from "../src/core/realPageReadiness.js";

const options = parseArgs(process.argv.slice(2));
const source = resolveSource(options);
const destination = resolve(process.cwd(), options.out);

const capture = validateSource(source);
const importWarnings = buildImportWarnings(capture);

if (existsSync(destination) && !options.force) {
  fail(`Refusing to overwrite ${formatPath(destination)}. Pass --force or choose another --out path.`);
}

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);

const relativeDestination = formatPath(destination);
console.log(`Imported capture: ${formatPath(source)} -> ${relativeDestination}`);
console.log(`Next: npm run capture-doctor -- ${relativeDestination}`);
console.log(`Next: npm run replay -- ${relativeDestination}`);
console.log("Next: npm run real-page-gate");
if (importWarnings.length) {
  console.log("Import notice: this file was copied, but final real-page readiness still has obvious gaps:");
  for (const warning of importWarnings) {
    console.log(`- ${warning}`);
  }
}

function parseArgs(args) {
  const parsed = {
    source: null,
    from: null,
    out: join("captures", "capture-real.json"),
    force: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    if (arg === "--out") {
      const value = args[index + 1];
      if (!value) failUsage("Missing path after --out");
      parsed.out = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      parsed.out = arg.slice("--out=".length);
      if (!parsed.out) failUsage("Missing path after --out=");
      continue;
    }
    if (arg === "--from") {
      const value = args[index + 1];
      if (!value) failUsage("Missing directory after --from");
      parsed.from = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--from=")) {
      parsed.from = arg.slice("--from=".length);
      if (!parsed.from) failUsage("Missing directory after --from=");
      continue;
    }
    if (!arg.startsWith("-")) {
      if (parsed.source) failUsage(`Unexpected extra source path: ${arg}`);
      parsed.source = arg;
      continue;
    }
    failUsage(`Unknown option: ${arg}`);
  }

  if (parsed.source && parsed.from) {
    failUsage("Use either a source path or --from, not both.");
  }

  return parsed;
}

function resolveSource({ source, from }) {
  if (source) return resolve(process.cwd(), source);

  const directory = resolve(process.cwd(), from || join(homedir(), "Downloads"));
  const candidate = findLatestDownloadedCapture(directory);
  if (!candidate) {
    fail(`No majsoul-helper-capture*.json files found in ${formatPath(directory)}. Pass a source path or use --from <download-dir>.`);
  }
  return candidate;
}

function findLatestDownloadedCapture(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && /^majsoul-helper-capture.*\.json$/i.test(entry.name))
    .map((entry) => {
      const path = join(directory, entry.name);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs || basename(right.path).localeCompare(basename(left.path)))
    [0]?.path || null;
}

function validateSource(sourcePath) {
  if (!existsSync(sourcePath)) {
    fail(`Source capture does not exist: ${formatPath(sourcePath)}`);
  }
  if (!sourcePath.toLowerCase().endsWith(".json")) {
    fail(`Source capture must be a JSON file: ${formatPath(sourcePath)}`);
  }

  let capture;
  try {
    capture = JSON.parse(readFileSync(sourcePath, "utf8"));
  } catch (error) {
    fail(`Source capture is not valid JSON: ${error.message}`);
  }

  if (!capture || typeof capture !== "object" || !Array.isArray(capture.events)) {
    fail("Source JSON does not look like a Majsoul Helper capture export: missing events array.");
  }
  return capture;
}

function buildImportWarnings(capture) {
  const warnings = [];
  const events = Array.isArray(capture.events) ? capture.events : [];
  const requiredOverlayFields = [
    "page",
    "helperDiagnostics",
    "verification",
    "liveGameState",
    "liveDebugSummary",
    "liveMvpGate",
    "liveRealPagePreflight",
    "liveSafetySettings",
    "liveCaptureHealth"
  ];
  const missingFields = requiredOverlayFields.filter((field) => capture[field] === undefined || capture[field] === null);
  if (missingFields.length) {
    warnings.push(`missing overlay export fields: ${missingFields.join(", ")}`);
  }

  if (!events.length) {
    warnings.push("capture events array is empty");
  } else if (!events.some((event) => event?.type === "raw_message")) {
    warnings.push("capture has no raw WebSocket message events");
  } else if (!events.some((event) => event?.type === "raw_message" && event?.source === "ws_in")) {
    warnings.push("capture has no inbound raw WebSocket message events");
  }

  if (capture.helperDiagnostics?.paused || capture.liveSafetySettings?.capturePaused) {
    warnings.push("capture was exported while capture was paused");
  }

  const droppedBeforeRetained = Number(capture.helperDiagnostics?.eventBuffer?.droppedBeforeRetained || 0);
  if (droppedBeforeRetained > 0) {
    warnings.push(`capture event buffer dropped ${droppedBeforeRetained} earlier events before export`);
  }

  if (events.some((event) => event?.type === "capture_error")) {
    warnings.push("capture includes helper capture_error events");
  }

  if (events.some((event) => isTruncatedRawEvent(event))) {
    warnings.push("capture includes truncated raw WebSocket samples");
  }

  if (!isMahjongSoulPage(capture.page || null)) {
    warnings.push("capture page metadata is not recognized as Mahjong Soul");
  }

  const preflight = summarizeLiveRealPagePreflight(capture.liveRealPagePreflight || null);
  if (!preflight.ready) {
    warnings.push(`real-page preflight is not ready: ${preflight.missing.slice(0, 4).join(", ")}`);
  }

  const safety = summarizeLiveSafetySettings(capture.liveSafetySettings || null);
  if (!safety.ready) {
    warnings.push(`live safety settings are not ready: ${safety.missing.slice(0, 4).join(", ")}`);
  }

  return warnings;
}

function isTruncatedRawEvent(event) {
  if (event?.type !== "raw_message") return false;
  const payload = event.payload || {};
  const envelope = payload.envelope || {};
  return Boolean(
    payload.truncated
    || envelope.payloadTruncated
    || envelope.actionPayloadTruncated
    || envelope.gameRestorePayloadTruncated
    || envelope.snapshotPayloadTruncated
  );
}

function formatPath(path) {
  return relative(process.cwd(), path) || ".";
}

function printUsage() {
  console.error("Usage: node scripts/import-capture.mjs [downloaded-capture.json] [--from <download-dir>] [--out captures/capture-real.json] [--force]");
}

function failUsage(message) {
  console.error(message);
  printUsage();
  process.exit(1);
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
