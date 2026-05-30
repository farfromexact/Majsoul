import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REAL_PAGE_PREFLIGHT_VERSION, REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS } from "../src/core/realPageReadiness.js";

describe("import-capture script", () => {
  it("imports an explicit downloaded capture into the validation directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-import-"));
    const source = join(dir, "majsoul-helper-capture.json");
    const output = join(dir, "captures", "capture-real.json");
    copyFileSync("tests/fixtures/capture-ready.json", source);

    const result = runImport([source, "--out", output]);

    expect(result.status).toBe(0);
    expect(existsSync(output)).toBe(true);
    expect(JSON.parse(readFileSync(output, "utf8")).events.length).toBeGreaterThan(0);
    expect(result.stdout).toContain("Imported capture:");
    expect(result.stdout).toContain("npm run capture-doctor --");
    expect(result.stdout).toContain("npm run replay --");
    expect(result.stdout).toContain("npm run real-page-gate");
  });

  it("prints non-blocking notices for captures that cannot satisfy real-page readiness", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-import-"));
    const source = join(dir, "majsoul-helper-capture.json");
    const output = join(dir, "captures", "capture-real.json");
    copyFileSync("tests/fixtures/capture-ready.json", source);

    const result = runImport([source, "--out", output]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Import notice: this file was copied");
    expect(result.stdout).toContain("missing overlay export fields:");
    expect(result.stdout).toContain("capture page metadata is not recognized as Mahjong Soul");
    expect(result.stdout).toContain("real-page preflight is not ready:");
    expect(result.stdout).toContain("live safety settings are not ready:");
  });

  it("prints non-blocking notices when imported captures do not include inbound raw traffic", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-import-"));
    const emptySource = join(dir, "majsoul-helper-capture-empty.json");
    const parsedOnlySource = join(dir, "majsoul-helper-capture-parsed.json");
    const outboundOnlySource = join(dir, "majsoul-helper-capture-outbound.json");
    writeFileSync(emptySource, JSON.stringify({ events: [] }));
    writeFileSync(parsedOnlySource, JSON.stringify({ events: [{ type: "discard_tile", source: "ws_in", payload: { seat: 1, tile: "9s" } }] }));
    writeFileSync(outboundOnlySource, JSON.stringify({ events: [{ type: "raw_message", source: "ws_out", payload: { kind: "text" } }] }));

    const empty = runImport([emptySource, "--out", join(dir, "captures", "empty.json")]);
    const parsedOnly = runImport([parsedOnlySource, "--out", join(dir, "captures", "parsed.json")]);
    const outboundOnly = runImport([outboundOnlySource, "--out", join(dir, "captures", "outbound.json")]);

    expect(empty.status).toBe(0);
    expect(empty.stdout).toContain("capture events array is empty");
    expect(parsedOnly.status).toBe(0);
    expect(parsedOnly.stdout).toContain("capture has no raw WebSocket message events");
    expect(outboundOnly.status).toBe(0);
    expect(outboundOnly.stdout).toContain("capture has no inbound raw WebSocket message events");
  });

  it("prints non-blocking notices for paused, dropped, errored, or truncated exports", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-import-"));
    const source = join(dir, "majsoul-helper-capture-problematic.json");
    const output = join(dir, "captures", "problematic.json");
    const capture = buildOverlayShapedCapture();
    capture.helperDiagnostics.paused = true;
    capture.helperDiagnostics.eventBuffer.droppedBeforeRetained = 12;
    capture.liveSafetySettings.capturePaused = true;
    capture.events.push(
      { type: "capture_error", source: "ws_in", payload: { message: "sample failed" } },
      {
        type: "raw_message",
        source: "ws_in",
        payload: {
          kind: "Uint8Array",
          truncated: true,
          envelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDealTile", actionPayloadTruncated: true }
        }
      }
    );
    writeFileSync(source, JSON.stringify(capture));

    const result = runImport([source, "--out", output]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("capture was exported while capture was paused");
    expect(result.stdout).toContain("capture event buffer dropped 12 earlier events before export");
    expect(result.stdout).toContain("capture includes helper capture_error events");
    expect(result.stdout).toContain("capture includes truncated raw WebSocket samples");
    expect(result.stdout).toContain("live safety settings are not ready:");
  });

  it("does not warn for an overlay-shaped Mahjong Soul capture with ready preflight and safety snapshots", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-import-"));
    const source = join(dir, "majsoul-helper-capture.json");
    const output = join(dir, "captures", "capture-real.json");
    writeFileSync(source, JSON.stringify(buildOverlayShapedCapture()));

    const result = runImport([source, "--out", output]);

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("Import notice:");
  });

  it("refuses to overwrite an imported capture unless forced", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-import-"));
    const source = join(dir, "majsoul-helper-capture.json");
    const output = join(dir, "captures", "capture-real.json");
    copyFileSync("tests/fixtures/capture-ready.json", source);

    expect(runImport([source, "--out", output]).status).toBe(0);
    const second = runImport([source, "--out", output]);

    expect(second.status).toBe(2);
    expect(second.stderr).toContain("Refusing to overwrite");
  });

  it("can pick the newest browser download from a directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-import-"));
    const oldCapture = join(dir, "majsoul-helper-capture-old.json");
    const newCapture = join(dir, "majsoul-helper-capture-new.json");
    const output = join(dir, "captures", "capture-real.json");
    writeFileSync(oldCapture, JSON.stringify({ formatVersion: 1, events: [] }));
    copyFileSync("tests/fixtures/capture-ready.json", newCapture);
    writeFileSync(join(dir, "not-a-helper-capture.json"), JSON.stringify({ formatVersion: 1, events: [] }));
    utimesSync(oldCapture, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));
    utimesSync(newCapture, new Date("2026-01-02T00:00:00.000Z"), new Date("2026-01-02T00:00:00.000Z"));

    const result = runImport(["--from", dir, "--out", output]);

    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(output, "utf8")).events.length).toBeGreaterThan(0);
    expect(result.stdout).toContain("majsoul-helper-capture-new.json");
  });

  it("rejects JSON files that are not helper captures", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-import-"));
    const source = join(dir, "majsoul-helper-capture.json");
    writeFileSync(source, JSON.stringify({ ok: true }));

    const result = runImport([source, "--out", join(dir, "captures", "capture-real.json")]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("missing events array");
  });
});

function runImport(args) {
  return spawnSync(process.execPath, ["scripts/import-capture.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

function buildOverlayShapedCapture() {
  const checks = Object.fromEntries(REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS.map((check) => [check, true]));
  return {
    formatVersion: 1,
    page: {
      origin: "https://game.maj-soul.com",
      host: "game.maj-soul.com",
      pathname: "/1/",
      sanitizedUrl: "https://game.maj-soul.com/1/"
    },
    helperDiagnostics: {
      installed: true,
      paused: false,
      eventBuffer: { retainedEvents: 1, totalEventsSinceClear: 1, droppedBeforeRetained: 0 }
    },
    verification: {
      commands: {
        doctor: "npm run capture-doctor -- captures/capture-real.json",
        replay: "npm run replay -- captures/capture-real.json",
        realPageGate: "npm run real-page-gate"
      }
    },
    liveGameState: { hand: [], drawnTile: null, visibleTiles: [], warnings: [] },
    liveDebugSummary: { raw: 1, parsed: 1 },
    liveMvpGate: { checks: {}, passed: 1, total: 1, missing: [] },
    liveRealPagePreflight: {
      preflightVersion: REAL_PAGE_PREFLIGHT_VERSION,
      requiredChecks: [...REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS],
      checks,
      passed: REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS.length,
      total: REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS.length,
      missing: [],
      hints: [],
      readyToExport: true
    },
    liveSafetySettings: {
      realtimeAdviceEnabled: false,
      realtimeAdviceDefault: false,
      realtimeAdviceMode: "off",
      manualInputActive: false,
      capturePaused: false,
      automationDisabled: true,
      clickAutomationDisabled: true,
      messageMutationDisabled: true
    },
    liveCaptureHealth: "Standard game events parsed. Compare gameState with the visible table.",
    events: [
      {
        type: "raw_message",
        source: "ws_in",
        payload: {
          kind: "Uint8Array",
          envelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" }
        }
      }
    ]
  };
}
