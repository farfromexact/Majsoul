import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REAL_PAGE_PREFLIGHT_VERSION, REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS } from "../src/core/realPageReadiness.js";

describe("goal audit script", () => {
  it("keeps the goal incomplete when no real-page capture is available", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-audit-empty-"));
    const result = runAudit(["--capture-dir", dir]);
    const output = JSON.parse(result.stdout);
    const realPageItem = output.items.find((item) => item.id === "real-page-validation");

    expect(result.status).toBe(0);
    expect(output.complete).toBe(false);
    expect(realPageItem.status).toBe("needs_real_capture");
    expect(realPageItem.requirement).toContain("safe liveSafetySettings");
    expect(realPageItem.missing.some((entry) => entry.includes("no capture JSON files found"))).toBe(true);
    expect(realPageItem.missing.some((entry) => entry.includes("npm run import-capture -- path/to/majsoul-helper-capture.json"))).toBe(true);
    expect(realPageItem.missing).toContain("no ready capture with Mahjong Soul page metadata, full current versioned overlay preflight, safe liveSafetySettings, overlay live snapshot, and liveStateSnapshotMatches=true");
    expect(realPageItem.files).toContain("scripts/import-capture.mjs");
    expect(realPageItem.files).toContain("scripts/real-page-gate.mjs");
    expect(output.items.find((item) => item.id === "tampermonkey-userscript").status).toBe("proved");
    expect(output.items.find((item) => item.id === "safety-boundaries").status).toBe("proved");
  });

  it("fails strict mode while real-page proof is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-audit-empty-"));
    const result = runAudit(["--capture-dir", dir, "--strict"]);
    const output = JSON.parse(result.stdout);

    expect(result.status).toBe(2);
    expect(output.complete).toBe(false);
  });

  it("recognizes a ready Mahjong Soul page capture with matching live state", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-audit-ready-"));
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
      readyToExport: true
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
    writeFileSync(join(dir, "ready-real-page.json"), `${JSON.stringify(capture, null, 2)}\n`, "utf8");

    const result = runAudit(["--capture-dir", dir]);
    const output = JSON.parse(result.stdout);
    const realPageItem = output.items.find((item) => item.id === "real-page-validation");

    expect(result.status).toBe(0);
    expect(output.complete).toBe(true);
    expect(output.realPageCaptures.realPageReadyCaptures).toBe(1);
    expect(realPageItem.status).toBe("proved");
    expect(realPageItem.readyRealPageCaptureFiles[0]).toContain("ready-real-page.json");
  });
});

function runAudit(args) {
  return spawnSync(process.execPath, ["scripts/goal-audit.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
}
