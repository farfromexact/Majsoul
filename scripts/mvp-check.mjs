import { existsSync, readFileSync } from "node:fs";

const requiredFiles = [
  "majsoul-helper.user.js",
  "smoke.html",
  "src/main.js",
  "src/adapter/majsoulAdapter.js",
  "src/adapter/messageParser.js",
  "src/core/gameState.js",
  "src/core/realPageReadiness.js",
  "src/core/tile.js",
  "src/core/shanten.js",
  "src/core/ukeire.js",
  "src/core/analyzer.js",
  "src/ui/overlay.js",
  "src/ui/styles.js",
  "tests/shanten.test.js",
  "tests/ukeire.test.js",
  "tests/realPageReadiness.test.js",
  "tests/replayCapture.test.js",
  "scripts/capture-doctor.mjs",
  "scripts/goal-audit.mjs",
  "scripts/import-capture.mjs",
  "scripts/real-page-gate.mjs",
  "scripts/validate-captures.mjs",
  "install.html",
  "docs/real-page-sampling.md",
  "README.md"
];

const checks = [
  {
    name: "required MVP files exist",
    run: () => requiredFiles.filter((file) => !existsSync(file)).map((file) => `missing ${file}`)
  },
  {
    name: "userscript installs early in page context",
    run: () => {
      const source = read("majsoul-helper.user.js");
      return [
        ["@run-at document-start", source.includes("// @run-at       document-start")],
        ["@inject-into page", source.includes("// @inject-into  page")],
        ["@grant none", source.includes("// @grant        none")]
      ].filter(([, ok]) => !ok).map(([label]) => `missing ${label}`);
    }
  },
  {
    name: "realtime advice is explicit and off by default",
    run: () => {
      const overlay = read("src/ui/overlay.js");
      return [
        ["this.realtimeAdvice = false", overlay.includes("this.realtimeAdvice = false")],
        ["training warning", overlay.includes("Training/review use only")],
        ["manual enable copy", overlay.includes("Enable realtime discard-candidate advice manually")]
      ].filter(([, ok]) => !ok).map(([label]) => `missing ${label}`);
    }
  },
  {
    name: "capture export includes field diagnostics",
    run: () => {
      const adapter = read("src/adapter/majsoulAdapter.js");
      const parser = read("src/adapter/messageParser.js");
      const replay = read("scripts/replay-capture.mjs");
      return [
        ["helperDiagnostics", adapter.includes("helperDiagnostics: this.getInstallDiagnostics")],
        ["page diagnostics", adapter.includes("page: getPageDiagnostics()")],
        ["hook diagnostics", adapter.includes("hooks: { ...this.hookDiagnostics }")],
        ["constructor static diagnostics", adapter.includes("constructorStatics") && replay.includes("constructor static properties failed to copy")],
        ["prototype constructor diagnostics", adapter.includes("prototypeConstructor") && replay.includes("prototype.constructor was not patched")],
        ["actionPayloadFields", parser.includes("actionPayloadFields")],
        ["stateUpdated diagnostics", replay.includes("stateUpdated")],
        ["action diagnostics", replay.includes("actionDiagnostics")],
        ["live state comparison", replay.includes("liveStateComparison")],
        ["replay dedupe diagnostics", replay.includes("replayDedupe")],
        ["smoke check script", existsSync("scripts/smoke-check.mjs")]
      ].filter(([, ok]) => !ok).map(([label]) => `missing ${label}`);
    }
  },
  {
    name: "install page exposes real-page sampling steps",
    run: () => {
      const installPage = read("install.html");
      return [
        ["userscript link", installPage.includes("./majsoul-helper.user.js")],
        ["smoke test link", installPage.includes("./smoke.html")],
        ["self-test step", installPage.includes("Self-test")],
        ["hook diagnostics step", installPage.includes("hook diagnostics")],
        ["MVP gate step", installPage.includes("MVP gate")],
        ["real-page preflight count", installPage.includes("15/15")],
        ["safety snapshot step", installPage.includes("liveSafetySettings")],
        ["download capture step", installPage.includes("Download capture")],
        ["copy capture step", installPage.includes("Copy capture")],
        ["import capture command", installPage.includes("npm run import-capture -- path/to/majsoul-helper-capture.json")],
        ["replay command", installPage.includes("npm run replay -- captures/capture-real.json")],
        ["capture doctor command", installPage.includes("npm run capture-doctor -- captures/capture-real.json")],
        ["real page gate command", installPage.includes("npm run real-page-gate")]
      ].filter(([, ok]) => !ok).map(([label]) => `missing ${label}`);
    }
  },
  {
    name: "real-page replay docs explain raw parsed fallback",
    run: () => {
      const docs = `${read("README.md")}\n${read("docs/real-page-sampling.md")}`;
      return [
        ["raw source of truth", docs.includes("raw samples as the source of truth")],
        ["parsed duplicate de-duplication", docs.includes("de-duplicates parsed events") || docs.includes("skips matching parsed duplicates")],
        ["parsed fallback", docs.includes("parsed fallback events") || docs.includes("live parsed event is kept as a fallback")]
      ].filter(([, ok]) => !ok).map(([label]) => `missing ${label}`);
    }
  },
  {
    name: "safety boundary keywords are absent from runtime source",
    run: () => {
      const source = [
        "src/main.js",
        "src/adapter/majsoulAdapter.js",
        "src/adapter/messageParser.js",
        "src/core/analyzer.js",
        "src/core/gameState.js",
        "src/ui/overlay.js"
      ].map(read).join("\n");
      const forbidden = [
        [/\.click\s*\(/, "page click automation"],
        [/dispatchEvent\s*\(\s*new\s+(MouseEvent|KeyboardEvent|PointerEvent)/, "synthetic input automation"],
        [/actionDiscardTile|inputOperation|FastTest\.inputOperation/, "outbound game action helper"],
        [/anti[-_ ]?cheat|stealth|evade|bypass/i, "anti-detection wording"]
      ];
      return forbidden.filter(([pattern]) => pattern.test(source)).map(([, label]) => `found ${label}`);
    }
  }
];

const failures = [];
for (const check of checks) {
  const messages = check.run();
  if (messages.length) failures.push({ name: check.name, messages });
}

if (failures.length) {
  console.error("MVP check failed:");
  for (const failure of failures) {
    console.error(`- ${failure.name}: ${failure.messages.join(", ")}`);
  }
  process.exit(1);
}

console.log(`MVP check passed (${checks.length} checks).`);

function read(file) {
  return readFileSync(file, "utf8");
}
