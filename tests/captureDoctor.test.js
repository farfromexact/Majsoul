import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function runDoctor(args) {
  return spawnSync(process.execPath, ["scripts/capture-doctor.mjs", ...args], {
    encoding: "utf8"
  });
}

describe("capture doctor script", () => {
  it("prints a compact diagnosis for a replay-ready fixture", () => {
    const result = runDoctor(["tests/fixtures/capture-ready.json"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Capture doctor: tests/fixtures/capture-ready.json");
    expect(result.stdout).toContain("Replay acceptance: ready (15/15 checks)");
    expect(result.stdout).toContain("Real-page readiness: not ready");
    expect(result.stdout).toContain("Capture export: incomplete");
    expect(result.stdout).toContain("Page: missing");
    expect(result.stdout).toContain("Preflight: missing");
    expect(result.stdout).toContain("Hook: missing");
    expect(result.stdout).toContain("Runtime: missing");
    expect(result.stdout).toContain("Safety: missing");
    expect(result.stdout).toContain("Event buffer: missing");
    expect(result.stdout).toContain("Traffic: raw 3 / inbound 3 / outbound 0 / envelopes 2 / actions 2 / replayed 3");
    expect(result.stdout).toContain("Truncation: raw 0 / envelopes 0 / action payloads 0");
    expect(result.stdout).toContain("Parsed events: discard_tile x1, draw_tile x1, round_start x1");
    expect(result.stdout).toContain("Top actions: ActionDealTile x1, ActionDiscardTile x1");
    expect(result.stdout).toContain("State updates: hand=yes");
    expect(result.stdout).toContain("Live snapshot: missing");
    expect(result.stdout).toContain("Missing real-page proof: captureMetadata.page is not a Mahjong Soul web page, overlay live debug/gate snapshot is missing, liveRealPagePreflight snapshot is missing, liveRealPagePreflight.readyToExport is not true, liveSafetySettings snapshot is missing, liveStateSnapshotMatches is not true");
    expect(result.stdout).toContain("Missing capture export fields:");
    expect(result.stdout).toContain("Next steps:");
    expect(result.stdout).toContain("Offline gate: npm run real-page-gate");
  });

  it("can fail when replay or real-page readiness is required", () => {
    const notReady = runDoctor(["tests/fixtures/capture-action-discard.json", "--require-ready"]);
    expect(notReady.status).toBe(2);
    expect(notReady.stdout).toContain("Replay acceptance: not ready");
    expect(notReady.stdout).toContain("Missing replay checks:");

    const notRealPageReady = runDoctor(["tests/fixtures/capture-ready.json", "--require-real-page-ready"]);
    expect(notRealPageReady.status).toBe(3);
    expect(notRealPageReady.stdout).toContain("Real-page readiness: not ready");
  });

  it("prints verification commands embedded in an overlay capture", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capture = JSON.parse(readFileSync("tests/fixtures/capture-ready.json", "utf8"));
    capture.verification = {
      recommendedPath: "captures/capture-real.json",
      commands: {
        doctor: "npm run capture-doctor -- captures/capture-real.json",
        replay: "npm run replay -- captures/capture-real.json",
        realPageGate: "npm run real-page-gate"
      }
    };
    const capturePath = join(dir, "capture-with-verification.json");
    writeFileSync(capturePath, JSON.stringify(capture));

    const result = runDoctor([capturePath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Verification commands: npm run capture-doctor -- captures/capture-real.json / npm run replay -- captures/capture-real.json / npm run real-page-gate");
    expect(result.stdout).toContain("Offline gate: npm run real-page-gate");
  });

  it("summarizes page, preflight, hook, and event buffer diagnostics", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capture = JSON.parse(readFileSync("tests/fixtures/capture-ready.json", "utf8"));
    capture.page = {
      origin: "https://game.maj-soul.com",
      host: "game.maj-soul.com",
      pathname: "/1/",
      sanitizedUrl: "https://game.maj-soul.com/1/"
    };
    capture.helperDiagnostics = {
      installed: true,
      paused: false,
      webSocketAvailable: true,
      socketsCreated: 1,
      binarySampleBytes: 2048,
      hooks: {
        onmessage: true,
        onmessageMode: "accessor"
      },
      runtime: {
        unityWebGL: true,
        unityBuildScript: "https://game.maj-soul.com/1/Build/chs_t-WebGL-release-4.0.43(43).loader.js",
        hasUnityInstance: true,
        hasUnityModule: true,
        heapU8: true,
        unityInstanceShape: {
          keyCount: 3,
          keys: ["Module", "SendMessage", "decodeAction"],
          functionKeyCount: 2,
          functionKeys: ["SendMessage", "decodeAction"],
          prototypeFunctionKeyCount: 0,
          prototypeFunctionKeys: []
        },
        unityModuleShape: {
          keyCount: 4,
          keys: ["HEAPU8", "SendMessage", "_malloc", "decodeBuffer"],
          functionKeyCount: 3,
          functionKeys: ["SendMessage", "_malloc", "decodeBuffer"],
          prototypeFunctionKeyCount: 0,
          prototypeFunctionKeys: []
        },
        netMessageWrapperGlobal: false,
        layaGlobal: false
      },
      eventBuffer: {
        retainedEvents: 3,
        totalEventsSinceClear: 12,
        droppedBeforeRetained: 9,
        oldestEventId: 10,
        newestEventId: 12,
        maxEvents: 300
      }
    };
    capture.liveRealPagePreflight = {
      readyToExport: false,
      passed: 4,
      total: 5,
      missing: ["liveMvpGateReady"],
      hints: ["Collect from round start until the MVP gate is complete."]
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
    const capturePath = join(dir, "capture-with-diagnostics.json");
    writeFileSync(capturePath, JSON.stringify(capture));

    const result = runDoctor([capturePath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Page: https://game.maj-soul.com/1/ (Mahjong Soul)");
    expect(result.stdout).toContain("Preflight: not ready (4/5) missing liveMvpGateReady next Collect from round start until the MVP gate is complete.");
    expect(result.stdout).toContain("Hook: installed / capture running / WebSocket available / sockets 1 / sample 2048 bytes / onmessage ok (accessor)");
    expect(result.stdout).toContain("Runtime: Unity WebGL detected / build chs_t-WebGL-release-4.0.43(43).loader.js / loader observer off / loader loads 0 / createUnityInstance waiting (unknown) / calls 0 / resolved no / unityInstance ok / Module ok / heap ok / instance keys 3 / funcs 2 / proto funcs 0 / Module keys 4 / funcs 3 / proto funcs 0 / global net missing / global Laya missing");
    expect(result.stdout).toContain("Runtime keys: instance keys [Module, SendMessage, decodeAction] funcs [SendMessage, decodeAction] / Module keys [HEAPU8, SendMessage, _malloc, decodeBuffer] funcs [SendMessage, _malloc, decodeBuffer]");
    expect(result.stdout).toContain("Safety: realtime advice off (off) / capture running / automation disabled / message mutation disabled");
    expect(result.stdout).toContain("Event buffer: retained 3/12 / dropped 9 / ids 10-12 / max 300");
  });

  it("surfaces Unity runtime decoder recommendations", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capture = JSON.parse(readFileSync("tests/fixtures/capture-draw-discard.json", "utf8"));
    capture.helperDiagnostics = {
      installed: true,
      paused: false,
      webSocketAvailable: true,
      socketsCreated: 1,
      binarySampleBytes: 2048,
      hooks: {
        onmessage: true,
        onmessageMode: "accessor",
        decodedMessage: false,
        decodedDispatcher: false
      },
      runtime: {
        unityWebGL: true,
        unityBuildScript: "https://game.maj-soul.com/1/Build/chs_t-WebGL-release-4.0.43(43).loader.js",
        hasUnityInstance: true,
        hasUnityModule: true,
        heapU8: true,
        netMessageWrapperGlobal: false,
        layaGlobal: false
      }
    };
    const capturePath = join(dir, "capture-unity-not-ready.json");
    writeFileSync(capturePath, JSON.stringify(capture));

    const result = runDoctor([capturePath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Runtime: Unity WebGL detected");
    expect(result.stdout).toContain("Unity WebGL runtime detected: raw ActionPrototype names are captured, but the old JS decode hooks are not available.");
  });
});
