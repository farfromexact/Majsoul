import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

const options = parseArgs(process.argv.slice(2));
const captureValidation = runValidateCaptures(options.captureDir);
const items = buildAuditItems(captureValidation);
const complete = items.every((item) => item.status === "proved");
const counts = countStatuses(items);

const output = {
  generatedAt: new Date().toISOString(),
  complete,
  captureDir: options.captureDir,
  counts,
  realPageCaptures: summarizeRealPageCaptures(captureValidation),
  items
};

console.log(JSON.stringify(output, null, 2));

if (options.strict && !complete) {
  process.exit(2);
}

function parseArgs(args) {
  const parsed = {
    captureDir: "captures",
    strict: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--capture-dir") {
      const value = args[index + 1];
      if (!value) failUsage("Missing path after --capture-dir");
      parsed.captureDir = value;
      index += 1;
      continue;
    }
    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }
    failUsage(`Unknown option: ${arg}`);
  }
  return parsed;
}

function printUsage() {
  console.error("Usage: node scripts/goal-audit.mjs [--capture-dir captures] [--strict]");
}

function failUsage(message) {
  console.error(message);
  printUsage();
  process.exit(1);
}

function buildAuditItems(validation) {
  const userscript = readIfExists("majsoul-helper.user.js");
  const packageJson = JSON.parse(readIfExists("package.json") || "{}");
  const overlay = readIfExists("src/ui/overlay.js");
  const gameState = readIfExists("src/core/gameState.js");
  const adapter = readIfExists("src/adapter/majsoulAdapter.js");
  const adapterTest = readIfExists("tests/majsoulAdapter.test.js");
  const parser = readIfExists("src/adapter/messageParser.js");
  const safetyTest = readIfExists("tests/safetyBoundaries.test.js");
  const smokeTest = readIfExists("tests/smokeCheck.test.js");
  const replay = readIfExists("scripts/replay-capture.mjs");
  const validate = readIfExists("scripts/validate-captures.mjs");
  const importCapture = readIfExists("scripts/import-capture.mjs");
  const realPageGate = readIfExists("scripts/real-page-gate.mjs");

  const srcFiles = [
    "src/adapter/majsoulAdapter.js",
    "src/adapter/messageParser.js",
    "src/core/gameState.js",
    "src/core/realPageReadiness.js",
    "src/core/tile.js",
    "src/core/shanten.js",
    "src/core/ukeire.js",
    "src/core/analyzer.js",
    "src/ui/overlay.js",
    "src/ui/styles.js"
  ];
  const coreTests = [
    "tests/shanten.test.js",
    "tests/ukeire.test.js",
    "tests/gameState.test.js",
    "tests/messageParser.test.js",
    "tests/majsoulAdapter.test.js",
    "tests/realPageReadiness.test.js",
    "tests/overlay.test.js",
    "tests/replayCapture.test.js",
    "tests/safetyBoundaries.test.js"
  ];

  return [
    item({
      id: "tampermonkey-userscript",
      requirement: "Generated Tampermonkey userscript exists, installs early in page context, and targets Mahjong Soul web hosts.",
      passed: Boolean(userscript)
        && includesAll(userscript, [
          "// @run-at       document-start",
          "// @inject-into  page",
          "// @grant        none",
          "mahjongsoul.game.yo-star.com",
          "maj-soul.com"
        ]),
      evidence: ["majsoul-helper.user.js metadata header"],
      missing: ["userscript file or required metadata"]
    }),
    item({
      id: "module-boundaries",
      requirement: "Page capture, message parsing, state management, tile/shanten/ukeire analysis, and UI rendering are separated into modules.",
      passed: srcFiles.every((file) => existsSync(join(repoRoot, file))),
      evidence: srcFiles,
      missing: srcFiles.filter((file) => !existsSync(join(repoRoot, file)))
    }),
    item({
      id: "tile-shanten-ukeire-analysis",
      requirement: "Tile parser supports m/p/s/z notation and red fives; analyzer calculates shanten, ukeire, and discard candidates with tests.",
      passed: existsSync(join(repoRoot, "src/core/tile.js"))
        && includesAll(readIfExists("src/core/tile.js"), ["parseTiles", "normalizeTile", "0[mps]"])
        && existsSync(join(repoRoot, "src/core/shanten.js"))
        && existsSync(join(repoRoot, "src/core/ukeire.js"))
        && includesAll(readIfExists("src/core/analyzer.js"), ["analyzeHand", "candidates"])
        && existsSync(join(repoRoot, "tests/shanten.test.js"))
        && existsSync(join(repoRoot, "tests/ukeire.test.js")),
      evidence: ["src/core/tile.js", "src/core/shanten.js", "src/core/ukeire.js", "src/core/analyzer.js", "tests/shanten.test.js", "tests/ukeire.test.js"],
      missing: ["tile/shanten/ukeire/analyzer source or tests"]
    }),
    item({
      id: "standard-game-state",
      requirement: "gameState maintains current hand, drawn tile, melds, rivers, dora indicators, round metadata, winds, turn, riichi, scores, and visible tiles.",
      passed: includesAll(gameState, [
        "hand",
        "drawnTile",
        "melds",
        "discards",
        "doraIndicators",
        "chang",
        "ju",
        "honba",
        "riichiSticks",
        "seatWind",
        "roundWind",
        "currentTurn",
        "riichi",
        "scores",
        "visibleTiles"
      ]) && existsSync(join(repoRoot, "tests/gameState.test.js")),
      evidence: ["src/core/gameState.js", "tests/gameState.test.js"],
      missing: ["required gameState fields or state tests"]
    }),
    item({
      id: "overlay-debug-ui",
      requirement: "Overlay is draggable/collapsible, supports manual input, shows state/analysis/debug data, and can copy state/capture while capture can pause/resume.",
      passed: includesAll(overlay, [
        "data-action=\"collapse\"",
        "data-role=\"manual-input\"",
        "Current shanten",
        "After discard shanten",
        "Dora indicators",
        "data-action=\"copy-state\"",
        "data-action=\"copy-capture\"",
        "data-action=\"download-capture\"",
        "data-action=\"toggle-capture\"",
        "data-action=\"self-test\"",
        "onpointerdown",
        "onpointermove"
      ]) && existsSync(join(repoRoot, "tests/overlay.test.js")),
      evidence: ["src/ui/overlay.js", "tests/overlay.test.js"],
      missing: ["overlay controls, display sections, drag handlers, or overlay tests"]
    }),
    item({
      id: "websocket-capture-exploration",
      requirement: "Adapter passively hooks WebSocket send/addEventListener/onmessage, records raw messages, parses standard events, and exposes diagnostics.",
      passed: includesAll(adapter, [
        "WebSocket",
        "patchedSend",
        "patchedAddEventListener",
        "onmessage",
        "raw_message",
        "helperDiagnostics",
        "summarizeCaptureEvents",
        "replayCaptureWithDiagnostics"
      ]) && includesAll(parser, ["parseBinaryEnvelope", "ActionPrototype"]) && existsSync(join(repoRoot, "tests/majsoulAdapter.test.js")),
      evidence: ["src/adapter/majsoulAdapter.js", "src/adapter/messageParser.js", "tests/majsoulAdapter.test.js"],
      missing: ["WebSocket hooks, raw capture, parser, diagnostics, or adapter tests"]
    }),
    item({
      id: "safety-boundaries",
      requirement: "No auto discard, no click or keyboard automation, no message mutation, no hidden overlay, and no anti-cheat bypass behavior.",
      passed: includesAll(safetyTest, [
        "does not automate page clicks",
        "does not hide the overlay",
        "does not introduce outbound game action helpers"
      ]) && includesAll(adapterTest, [
        "passes outbound payloads through unchanged"
      ]) && includesAll(overlay, [
        "Realtime advice is off by default",
        "No auto discard",
        "no message mutation"
      ]),
      evidence: ["src/ui/overlay.js", "tests/safetyBoundaries.test.js", "tests/majsoulAdapter.test.js"],
      missing: ["explicit safety copy or safety boundary tests"]
    }),
    item({
      id: "local-runtime-gates",
      requirement: "Local smoke/replay/validation gates exercise hook installation, capture export, parser output, live gate, and offline replay.",
      passed: hasPackageScript(packageJson, "smoke")
        && hasPackageScript(packageJson, "replay")
        && hasPackageScript(packageJson, "import-capture")
        && hasPackageScript(packageJson, "real-page-gate")
        && hasPackageScript(packageJson, "validate-captures")
        && includesAll(smokeTest, ["liveMvpGateReady", "captureHasLiveState", "captureSanitized"])
        && includesAll(replay, ["acceptance", "readyForRealPageMvp"])
        && includesAll(validate, ["readyCaptures", "requireReady"])
        && includesAll(importCapture, ["majsoul-helper-capture", "captures", "capture-real.json"])
        && includesAll(realPageGate, ["validate-captures.mjs", "goal-audit.mjs", "--require-real-page-ready", "--strict"]),
      evidence: ["package.json scripts", "tests/smokeCheck.test.js", "scripts/import-capture.mjs", "scripts/real-page-gate.mjs", "scripts/replay-capture.mjs", "scripts/validate-captures.mjs"],
      missing: ["smoke/import/replay/validate/real-page-gate command or tests"]
    }),
    realPageValidationItem(validation),
    item({
      id: "test-suite-coverage",
      requirement: "Core algorithms, state, adapter, replay, UI, metadata, docs, safety, and capture validation have automated tests.",
      passed: coreTests.every((file) => existsSync(join(repoRoot, file))) && hasPackageScript(packageJson, "verify"),
      evidence: coreTests.concat(["package.json scripts.verify"]),
      missing: coreTests.filter((file) => !existsSync(join(repoRoot, file)))
    })
  ];
}

function realPageValidationItem(validation) {
  const readyRealCaptures = (validation?.results || []).filter((result) => (
    result.realPageReady
  ));

  const evidence = [
    `capturesFound=${validation?.capturesFound ?? 0}`,
    `readyCaptures=${validation?.readyCaptures ?? 0}`,
    `realPageReadyCaptures=${validation?.realPageReadyCaptures ?? readyRealCaptures.length}`
  ];
  const missing = [];
  if (!validation || validation.capturesFound === 0) {
    missing.push("no capture JSON files found; run npm run import-capture -- path/to/majsoul-helper-capture.json after exporting from the overlay");
  }
  if (!readyRealCaptures.length) {
    missing.push("no ready capture with Mahjong Soul page metadata, full current versioned overlay preflight, safe liveSafetySettings, overlay live snapshot, and liveStateSnapshotMatches=true");
  }
  return {
    id: "real-page-validation",
    requirement: "A real Mahjong Soul page capture proves raw live traffic, parsing, safe liveSafetySettings, live overlay snapshot, replayed gameState, and acceptance.readyForRealPageMvp agree.",
    status: readyRealCaptures.length ? "proved" : "needs_real_capture",
    evidence,
    missing,
    files: ["captures/*.json", "scripts/import-capture.mjs", "scripts/validate-captures.mjs", "scripts/real-page-gate.mjs"],
    readyRealPageCaptureFiles: readyRealCaptures.map((result) => result.file)
  };
}

function item({ id, requirement, passed, evidence, missing }) {
  return {
    id,
    requirement,
    status: passed ? "proved" : "incomplete",
    evidence,
    missing: passed ? [] : missing
  };
}

function summarizeRealPageCaptures(validation) {
  const results = validation?.results || [];
  const readyRealPageResults = results.filter((result) => (
    result.realPageReady
  ));
  return {
    capturesFound: validation?.capturesFound ?? 0,
    readyCaptures: validation?.readyCaptures ?? 0,
    realPageReadyCaptures: validation?.realPageReadyCaptures ?? readyRealPageResults.length,
    files: readyRealPageResults.map((result) => result.file)
  };
}

function countStatuses(items) {
  const counts = {};
  for (const item of items) {
    counts[item.status] = (counts[item.status] || 0) + 1;
  }
  return counts;
}

function runValidateCaptures(captureDir) {
  const result = spawnSync(process.execPath, [join(scriptDir, "validate-captures.mjs"), "--dir", captureDir], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0 || result.error) {
    return {
      capturesFound: 0,
      readyCaptures: 0,
      results: [],
      error: result.error?.message || result.stderr || "validate-captures failed"
    };
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return {
      capturesFound: 0,
      readyCaptures: 0,
      results: [],
      error: "validate-captures did not output JSON"
    };
  }
}

function hasPackageScript(packageJson, name) {
  return Boolean(packageJson?.scripts?.[name]);
}

function includesAll(source, snippets) {
  return snippets.every((snippet) => source.includes(snippet));
}

function readIfExists(file) {
  const path = join(repoRoot, file);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}
