import { describe, expect, it } from "vitest";
import {
  buildLiveRealPagePreflight,
  CAPTURE_VERIFICATION,
  isMahjongSoulPage,
  REAL_PAGE_PREFLIGHT_VERSION,
  REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS,
  summarizeLiveRealPagePreflight,
  summarizeLiveSafetySettings
} from "../src/core/realPageReadiness.js";

describe("real page readiness helpers", () => {
  it("builds a versioned ready preflight snapshot from live overlay state", () => {
    const preflight = buildLiveRealPagePreflight({
      adapter: { installed: true, paused: false },
      page: { host: "mahjongsoul.game.yo-star.com", origin: "https://mahjongsoul.game.yo-star.com", sanitizedUrl: "https://mahjongsoul.game.yo-star.com/" },
      installDiagnostics: {
        installed: true,
        paused: false,
        eventBuffer: { droppedBeforeRetained: 0 }
      },
      liveMvpGate: { passed: 16, total: 16 },
      liveGameState: { hand: ["1m"] },
      liveDebugSummary: { truncated: 0, captureErrors: 0 },
      liveSafetySettings: {
        realtimeAdviceEnabled: false,
        realtimeAdviceDefault: false,
        manualInputActive: false,
        automationDisabled: true,
        clickAutomationDisabled: true,
        messageMutationDisabled: true
      }
    });

    expect(preflight).toMatchObject({
      preflightVersion: REAL_PAGE_PREFLIGHT_VERSION,
      requiredChecks: [...REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS],
      passed: REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS.length,
      total: REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS.length,
      missing: [],
      hints: [],
      readyToExport: true,
      doctorCommand: CAPTURE_VERIFICATION.commands.doctor,
      offlineCommand: CAPTURE_VERIFICATION.commands.realPageGate
    });
    expect(Object.keys(preflight.checks)).toEqual([...REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS]);
  });

  it("summarizes stale or incomplete preflight snapshots as not ready", () => {
    const summary = summarizeLiveRealPagePreflight({
      preflightVersion: 0,
      requiredChecks: REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS.filter((key) => key !== "realtimeAdviceOff"),
      checks: Object.fromEntries(REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS.map((key) => [key, true])),
      readyToExport: true
    });

    expect(summary.ready).toBe(false);
    expect(summary.missing).toContain(`liveRealPagePreflight.preflightVersion is not ${REAL_PAGE_PREFLIGHT_VERSION}`);
    expect(summary.missing).toContain("liveRealPagePreflight.requiredChecks is missing realtimeAdviceOff");
  });

  it("summarizes unsafe live safety settings as not ready", () => {
    const summary = summarizeLiveSafetySettings({
      realtimeAdviceEnabled: true,
      realtimeAdviceDefault: false,
      manualInputActive: true,
      capturePaused: true,
      automationDisabled: true,
      clickAutomationDisabled: true,
      messageMutationDisabled: false
    });

    expect(summary.ready).toBe(false);
    expect(summary.missing).toEqual([
      "liveSafetySettings.realtimeAdviceEnabled is not false",
      "liveSafetySettings.manualInputActive is not false",
      "liveSafetySettings.capturePaused is not false",
      "liveSafetySettings.messageMutationDisabled is not true"
    ]);
  });

  it("recognizes Mahjong Soul web hosts without accepting unrelated pages", () => {
    expect(isMahjongSoulPage({ host: "game.maj-soul.com" })).toBe(true);
    expect(isMahjongSoulPage({ sanitizedUrl: "https://mahjongsoul.game.yo-star.com/" })).toBe(true);
    expect(isMahjongSoulPage({ host: "example.com", sanitizedUrl: "https://example.com/" })).toBe(false);
  });
});
