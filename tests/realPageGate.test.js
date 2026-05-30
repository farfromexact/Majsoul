import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REAL_PAGE_PREFLIGHT_VERSION, REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS } from "../src/core/realPageReadiness.js";

describe("real-page-gate script", () => {
  it("fails with an actionable import hint when no captures exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-real-gate-empty-"));
    const result = runGate(["--dir", dir]);

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("Capture validation: capturesFound=0");
    expect(result.stdout).toContain("Next: npm run import-capture -- path/to/majsoul-helper-capture.json");
    expect(result.stderr).toContain("Real-page gate failed at validate-captures.");
  });

  it("passes only when validate-captures and goal-audit strict both pass", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-real-gate-ready-"));
    writeRealPageReadyCapture(join(dir, "ready-real-page.json"));

    const result = runGate(["--dir", dir]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Capture validation: capturesFound=1 ready=1 realPageReady=1 failures=0");
    expect(result.stdout).toContain('"complete": true');
    expect(result.stdout).toContain("Real-page gate passed.");
  });
});

function runGate(args) {
  return spawnSync(process.execPath, ["scripts/real-page-gate.mjs", ...args], {
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
