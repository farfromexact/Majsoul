import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { REAL_PAGE_PREFLIGHT_VERSION, REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS } from "../src/core/realPageReadiness.js";

describe("smoke check script", () => {
  it("validates the built userscript hook and capture path", () => {
    const output = execFileSync("node", ["scripts/smoke-check.mjs"], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.ok).toBe(true);
    expect(parsed.checks).toMatchObject({
      helperLoaded: true,
      overlayMounted: true,
      hookInstalled: true,
      rawInboundCaptured: true,
      rawOutboundCaptured: true,
      actionEnvelopeDecoded: true,
      roundStartParsed: true,
      drawParsed: true,
      discardParsed: true,
      stateUpdated: true,
      stateHandUpdated: true,
      stateRoundUpdated: true,
      stateDoraUpdated: true,
      stateScoresKnown: true,
      liveMvpGateReady: true,
      liveRealPagePreflightReady: true,
      captureHasLiveState: true,
      captureHasLiveDebugSummary: true,
      captureHasLiveMvpGate: true,
      captureHasLiveSafetySettings: true,
      captureHasLiveRealPagePreflight: true,
      captureSanitized: true
    });
    expect(parsed.eventTypes).toEqual(["discard_tile", "raw_message", "draw_tile", "raw_message", "round_start", "raw_message", "raw_message"]);
    expect(parsed.install.recentSocketUrls).toEqual(["wss://smoke.local/socket"]);
    expect(parsed.liveMvpGate).toMatchObject({
      passed: 16,
      total: 16,
      missing: []
    });
    expect(parsed.liveSafetySettings).toMatchObject({
      realtimeAdviceEnabled: false,
      realtimeAdviceDefault: false,
      realtimeAdviceMode: "off",
      capturePaused: false,
      automationDisabled: true,
      clickAutomationDisabled: true,
      messageMutationDisabled: true
    });
    expect(parsed.liveRealPagePreflight).toMatchObject({
      preflightVersion: REAL_PAGE_PREFLIGHT_VERSION,
      requiredChecks: [...REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS],
      passed: 15,
      total: 15,
      checks: {
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
      hints: [],
      readyToExport: true,
      doctorCommand: "npm run capture-doctor -- captures/capture-real.json",
      offlineCommand: "npm run real-page-gate"
    });
    expect(parsed.gameState.hand).toHaveLength(13);
    expect(parsed.gameState.drawnTile).toBe("5m");
    expect(parsed.gameState.discards[1]).toEqual(["9s"]);
    expect(parsed.gameState.doraIndicators).toEqual(["4p"]);
    expect(parsed.gameState).toMatchObject({
      round: "0-1",
      chang: 0,
      ju: 1,
      warnings: []
    });
  });
});
