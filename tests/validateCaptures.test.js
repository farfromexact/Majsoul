import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REAL_PAGE_PREFLIGHT_VERSION, REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS } from "../src/core/realPageReadiness.js";

describe("validate-captures script", () => {
  it("reports an empty capture directory without failing by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-captures-"));
    const result = runValidate(["--dir", dir]);
    const output = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(output.capturesFound).toBe(0);
    expect(output.readyCaptures).toBe(0);
    expect(output.realPageReadyCaptures).toBe(0);
    expect(output.recommendations[0]).toContain("No capture JSON files were found");
    expect(output.recommendations[0]).toContain("npm run import-capture -- path/to/majsoul-helper-capture.json");
  });

  it("can print a concise summary for an empty capture directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-captures-"));
    const result = runValidate(["--dir", dir, "--summary"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Capture validation:");
    expect(result.stdout).toContain("capturesFound=0");
    expect(result.stdout).toContain("No capture JSON files were found.");
    expect(result.stdout).toContain("Next: npm run import-capture -- path/to/majsoul-helper-capture.json");
    expect(() => JSON.parse(result.stdout)).toThrow();
  });

  it("summarizes ready and non-ready captures in one batch", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-captures-"));
    copyFileSync("tests/fixtures/capture-ready.json", join(dir, "ready.json"));
    copyFileSync("tests/fixtures/capture-action-discard.json", join(dir, "action-discard.json"));

    const result = runValidate(["--dir", dir]);
    const output = JSON.parse(result.stdout);
    const ready = output.results.find((entry) => entry.file.endsWith("ready.json"));
    const notReady = output.results.find((entry) => entry.file.endsWith("action-discard.json"));

    expect(result.status).toBe(0);
    expect(output.capturesFound).toBe(2);
    expect(output.readyCaptures).toBe(1);
    expect(output.realPageReadyCaptures).toBe(0);
    expect(output.replayFailures).toBe(0);
    expect(ready.readyForRealPageMvp).toBe(true);
    expect(ready.realPageReady).toBe(false);
    expect(ready.realPageMissing).toContain("captureMetadata.page is not a Mahjong Soul web page");
    expect(ready.missing).toEqual([]);
    expect(notReady.readyForRealPageMvp).toBe(false);
    expect(notReady.missing.length).toBeGreaterThan(0);
  });

  it("can print a concise summary for mixed capture readiness", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-captures-"));
    copyFileSync("tests/fixtures/capture-ready.json", join(dir, "ready.json"));
    copyFileSync("tests/fixtures/capture-action-discard.json", join(dir, "action-discard.json"));

    const result = runValidate(["--dir", dir, "--summary"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Capture validation: capturesFound=2 ready=1 realPageReady=0 failures=0");
    expect(result.stdout).toContain("ready.json");
    expect(result.stdout).toContain("action-discard.json");
    expect(result.stdout).toContain("replay: ready");
    expect(result.stdout).toContain("real-page: not ready");
    expect(result.stdout).toContain("liveSafetySettings snapshot is missing");
    expect(result.stdout).toContain("captureMetadata.page is not a Mahjong Soul web page");
    expect(result.stdout).toContain("Recommendations:");
    expect(result.stdout).toContain("safe liveSafetySettings");
    expect(result.stdout).toContain("npm run real-page-gate");
  });

  it("fails strict mode when any checked capture is not ready", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-captures-"));
    copyFileSync("tests/fixtures/capture-action-discard.json", join(dir, "action-discard.json"));

    const result = runValidate(["--dir", dir, "--strict"]);
    const output = JSON.parse(result.stdout);

    expect(result.status).toBe(2);
    expect(output.strict).toBe(true);
    expect(output.capturesFound).toBe(1);
    expect(output.readyCaptures).toBe(0);
  });

  it("can require at least one ready capture", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-captures-"));
    const result = runValidate(["--dir", dir, "--require-ready"]);
    const output = JSON.parse(result.stdout);

    expect(result.status).toBe(2);
    expect(output.requireReady).toBe(true);
    expect(output.readyCaptures).toBe(0);
  });

  it("can require a real-page-ready capture", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-captures-"));
    copyFileSync("tests/fixtures/capture-ready.json", join(dir, "ready-fixture.json"));

    const result = runValidate(["--dir", dir, "--require-real-page-ready"]);
    const output = JSON.parse(result.stdout);

    expect(result.status).toBe(2);
    expect(output.requireRealPageReady).toBe(true);
    expect(output.readyCaptures).toBe(1);
    expect(output.realPageReadyCaptures).toBe(0);
    expect(output.results[0].realPageMissing).toContain("captureMetadata.page is not a Mahjong Soul web page");
    expect(output.recommendations[0]).toContain("safe liveSafetySettings");
    expect(output.recommendations[0]).toContain("npm run real-page-gate");
  });

  it("recognizes real-page-ready captures with page metadata and live snapshot comparison", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-captures-"));
    writeRealPageReadyCapture(join(dir, "ready-real-page.json"));

    const result = runValidate(["--dir", dir, "--require-real-page-ready"]);
    const output = JSON.parse(result.stdout);
    const ready = output.results[0];

    expect(result.status).toBe(0);
    expect(output.realPageReadyCaptures).toBe(1);
    expect(ready.readyForRealPageMvp).toBe(true);
    expect(ready.realPageReady).toBe(true);
    expect(ready.mahjongSoulPage).toBe(true);
    expect(ready.liveOverlayAvailable).toBe(true);
    expect(ready.liveStateSnapshotMatches).toBe(true);
    expect(ready.liveRealPagePreflightReady).toBe(true);
    expect(ready.liveRealPagePreflightMissing).toEqual([]);
    expect(ready.liveRealPagePreflightHints).toEqual([]);
    expect(ready.liveSafetyReady).toBe(true);
    expect(ready.liveSafetyMissing).toEqual([]);
    expect(ready.realPageMissing).toEqual([]);
  });

  it("requires safe liveSafetySettings for real-page-ready captures", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-captures-"));
    const capturePath = join(dir, "unsafe-real-page.json");
    writeRealPageReadyCapture(capturePath);
    const capture = JSON.parse(readFileSync(capturePath, "utf8"));
    capture.liveSafetySettings.realtimeAdviceEnabled = true;
    capture.liveSafetySettings.realtimeAdviceMode = "manual opt-in";
    writeFileSync(capturePath, `${JSON.stringify(capture, null, 2)}\n`, "utf8");

    const result = runValidate(["--dir", dir, "--require-real-page-ready"]);
    const output = JSON.parse(result.stdout);
    const checked = output.results[0];

    expect(result.status).toBe(2);
    expect(output.realPageReadyCaptures).toBe(0);
    expect(checked.realPageReady).toBe(false);
    expect(checked.liveSafetyReady).toBe(false);
    expect(checked.liveSafetyMissing).toContain("liveSafetySettings.realtimeAdviceEnabled is not false");
    expect(checked.realPageMissing).toContain("liveSafetySettings.realtimeAdviceEnabled is not false");
  });

  it("requires the full current liveRealPagePreflight checklist for real-page-ready captures", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-captures-"));
    const capturePath = join(dir, "stale-preflight-real-page.json");
    writeRealPageReadyCapture(capturePath);
    const capture = JSON.parse(readFileSync(capturePath, "utf8"));
    delete capture.liveRealPagePreflight.checks.realtimeAdviceOff;
    capture.liveRealPagePreflight.requiredChecks = capture.liveRealPagePreflight.requiredChecks.filter((key) => key !== "realtimeAdviceOff");
    capture.liveRealPagePreflight.passed = 14;
    capture.liveRealPagePreflight.total = 15;
    writeFileSync(capturePath, `${JSON.stringify(capture, null, 2)}\n`, "utf8");

    const result = runValidate(["--dir", dir, "--require-real-page-ready"]);
    const output = JSON.parse(result.stdout);
    const checked = output.results[0];

    expect(result.status).toBe(2);
    expect(output.realPageReadyCaptures).toBe(0);
    expect(checked.realPageReady).toBe(false);
    expect(checked.liveRealPagePreflightReady).toBe(false);
    expect(checked.liveRealPagePreflightMissing).toContain("liveRealPagePreflight.requiredChecks is missing realtimeAdviceOff");
    expect(checked.liveRealPagePreflightMissing).toContain("liveRealPagePreflight.checks.realtimeAdviceOff is not true");
    expect(checked.realPageMissing).toContain("liveRealPagePreflight.requiredChecks is missing realtimeAdviceOff");
    expect(checked.realPageMissing).toContain("liveRealPagePreflight.checks.realtimeAdviceOff is not true");
  });

  it("requires the current liveRealPagePreflight version for real-page-ready captures", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-captures-"));
    const capturePath = join(dir, "old-preflight-version-real-page.json");
    writeRealPageReadyCapture(capturePath);
    const capture = JSON.parse(readFileSync(capturePath, "utf8"));
    capture.liveRealPagePreflight.preflightVersion = 0;
    writeFileSync(capturePath, `${JSON.stringify(capture, null, 2)}\n`, "utf8");

    const result = runValidate(["--dir", dir, "--require-real-page-ready"]);
    const output = JSON.parse(result.stdout);
    const checked = output.results[0];

    expect(result.status).toBe(2);
    expect(output.realPageReadyCaptures).toBe(0);
    expect(checked.liveRealPagePreflightMissing).toContain(`liveRealPagePreflight.preflightVersion is not ${REAL_PAGE_PREFLIGHT_VERSION}`);
    expect(checked.realPageMissing).toContain(`liveRealPagePreflight.preflightVersion is not ${REAL_PAGE_PREFLIGHT_VERSION}`);
  });
});

function runValidate(args) {
  return spawnSync(process.execPath, ["scripts/validate-captures.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
}

function writeRealPageReadyCapture(path) {
  const capture = JSON.parse(readFileSync("tests/fixtures/capture-ready.json", "utf8"));
  capture.page = {
    origin: "https://mahjongsoul.game.yo-star.com",
    host: "mahjongsoul.game.yo-star.com",
    pathname: "/",
    sanitizedUrl: "https://mahjongsoul.game.yo-star.com/"
  };
  capture.liveGameState = {
    hand: ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "1z"]
  };
  capture.liveMvpGate = {
    checks: {
      rawMessagesCaptured: true,
      binaryEnvelopeDecoded: true,
      actionPrototypeDecoded: true,
      drawTileParsed: true,
      drawTileSeatParsed: true,
      discardTileParsed: true,
      discardTileSeatParsed: true,
      gameStateHandUpdated: true,
      gameStateRoundMetadataUpdated: true,
      gameStateDrawnTileUpdated: true,
      gameStateDiscardsUpdated: true,
      gameStateDoraIndicatorsUpdated: true,
      gameStateScoresUpdated: true,
      gameStateVisibleTilesUpdated: true,
      gameStateWarningsClear: true
    },
    passed: 15,
    total: 15,
    missing: []
  };
  capture.liveRealPagePreflight = {
    preflightVersion: REAL_PAGE_PREFLIGHT_VERSION,
    requiredChecks: [...REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS],
    checks: {
      mahjongSoulPage: true,
      hookInstalled: true,
      captureRunning: true,
      liveSnapshotsIncluded: true,
      liveMvpGateReady: true,
      eventBufferComplete: true,
      noTruncatedSamples: true,
      noCaptureErrors: true,
      liveSafetySettingsIncluded: true,
      realtimeAdviceOff: true,
      realtimeAdviceDefaultOff: true,
      manualInputInactive: true,
      automationDisabled: true,
      clickAutomationDisabled: true,
      messageMutationDisabled: true
    },
    passed: 15,
    total: 15,
    missing: [],
    hints: [],
    readyToExport: true,
    offlineValidationRequired: true,
    doctorCommand: "npm run capture-doctor -- captures/capture-real.json",
    offlineCommand: "npm run real-page-gate"
  };
  capture.liveSafetySettings = {
    realtimeAdviceEnabled: false,
    realtimeAdviceDefault: false,
    realtimeAdviceMode: "off",
    manualInputActive: false,
    capturePaused: false,
    automationDisabled: true,
    clickAutomationDisabled: true,
    messageMutationDisabled: true
  };
  writeFileSync(path, `${JSON.stringify(capture, null, 2)}\n`, "utf8");
}
