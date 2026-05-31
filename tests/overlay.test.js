// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Overlay } from "../src/ui/overlay.js";
import { GameState } from "../src/core/gameState.js";
import { REAL_PAGE_PREFLIGHT_VERSION, REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS } from "../src/core/realPageReadiness.js";

class FakeAdapter extends EventTarget {
  constructor() {
    super();
    this.paused = false;
    this.installed = true;
    this.events = [];
    this.installDiagnostics = {
      installed: true,
      helperVersion: "0.2.9",
      installAttempts: 1,
      installedAt: "2026-05-25T00:00:00.000Z",
      installFailureReason: "",
      webSocketAvailable: true,
      paused: false,
      hooks: {
        constructor: true,
        send: true,
        addEventListener: true,
        removeEventListener: true,
        onmessage: true,
        onmessageMode: "accessor",
        decodedMessage: false,
        decodedMessageMode: "not-installed",
        decodedDispatcher: true,
        decodedDispatcherMode: "Laya.EventDispatcher.event"
      },
      runtime: {
        unityWebGL: false,
        unityBuildScript: "",
        hasUnityInstance: false,
        hasUnityModule: false,
        heapU8: false,
        sendMessageAvailable: false,
        netMessageWrapperGlobal: false,
        layaGlobal: true
      },
      socketsCreated: 1,
      recentSocketUrls: ["wss://example.test/socket"],
      maxEvents: 3000,
      binarySampleBytes: 4096,
      eventBuffer: {
        maxEvents: 300,
        retainedEvents: 0,
        totalEventsSinceClear: 0,
        oldestEventId: null,
        newestEventId: null,
        droppedBeforeRetained: 0
      }
    };
    this.maxEvents = 3000;
  }

  setPaused(paused) {
    this.paused = paused;
    this.installDiagnostics.paused = this.paused;
    this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.installDiagnostics }));
    return this.paused;
  }

  setBinarySampleBytes(value) {
    const number = Number(value);
    this.installDiagnostics.binarySampleBytes = Math.max(16, Math.min(4096, Math.floor(number)));
    this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.installDiagnostics }));
    return this.installDiagnostics.binarySampleBytes;
  }

  setMaxEvents(value) {
    const number = Number(value);
    this.maxEvents = Math.max(1, Math.min(3000, Math.floor(number)));
    this.events = this.events.slice(0, this.maxEvents);
    this.installDiagnostics.maxEvents = this.maxEvents;
    this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.installDiagnostics }));
    return this.maxEvents;
  }

  getRecentEvents() {
    return this.events;
  }

  getInstallDiagnostics() {
    this.installDiagnostics.paused = this.paused;
    this.installDiagnostics.eventBuffer ??= {
      maxEvents: this.maxEvents,
      retainedEvents: this.events.length,
      totalEventsSinceClear: this.events.length,
      oldestEventId: null,
      newestEventId: null,
      droppedBeforeRetained: 0
    };
    return this.installDiagnostics;
  }

  exportCapture({ limit = this.maxEvents } = {}) {
    return { formatVersion: 1, limit, events: this.events.slice(0, limit) };
  }

  clearEvents() {
    this.events = [];
    this.dispatchEvent(new CustomEvent("majsoul-helper:clear", { detail: { ts: Date.now() } }));
  }

  runSelfTest() {
    const result = {
      ranAt: "2026-05-25T00:00:00.000Z",
      ok: true,
      installed: this.installed,
      webSocketAvailable: true,
      readableParsedTypes: ["draw_tile"],
      binaryEnvelope: { actionName: "ActionDiscardTile" },
      binaryParsedTypes: ["discard_tile"]
    };
    this.dispatchEvent(new CustomEvent("majsoul-helper:self-test", { detail: result }));
    return result;
  }
}

describe("Overlay", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head></head><body></body>";
    window.localStorage.clear();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:majsoul-helper-capture")
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn()
      }
    });
  });

  it("renders training warning and keeps realtime advice disabled by default", () => {
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState: new GameState() });
    overlay.mount();

    expect(document.querySelector("#majsoul-helper-overlay").textContent).toContain("Training/review use only");
    expect(document.querySelector(".mh-title").textContent).toContain("v0.2.9");
    expect(document.querySelector('[data-action="realtime-advice"]').checked).toBe(false);
    expect(document.querySelector('[data-role="realtime-risk"]')).toBeNull();
    expect(document.querySelector("#majsoul-helper-overlay").textContent).toContain("Enter a hand or enable realtime advice");
  });

  it("marks realtime advice as an active risk feature when enabled", () => {
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState: new GameState() });
    overlay.mount();

    document.querySelector('[data-action="realtime-advice"]').checked = true;
    document.querySelector('[data-action="realtime-advice"]').dispatchEvent(new Event("change", { bubbles: true }));

    expect(document.querySelector('[data-role="realtime-risk"]').textContent).toContain("Risk feature active");
    expect(document.querySelector('[data-role="realtime-risk"]').textContent).toContain("training/review only");
  });

  it("collapses and drags the overlay within the viewport", () => {
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState: new GameState() });
    overlay.mount();

    const root = document.querySelector("#majsoul-helper-overlay");
    const header = root.querySelector(".mh-header");
    const collapse = root.querySelector('[data-action="collapse"]');
    collapse.click();
    expect(root.classList.contains("mh-collapsed")).toBe(true);
    collapse.click();
    expect(root.classList.contains("mh-collapsed")).toBe(false);

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 640 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 480 });
    Object.defineProperty(root, "offsetLeft", { configurable: true, value: 360 });
    Object.defineProperty(root, "offsetTop", { configurable: true, value: 96 });
    Object.defineProperty(root, "offsetWidth", { configurable: true, value: 240 });
    header.setPointerCapture = vi.fn();

    header.onpointerdown({ target: header, pointerId: 1, clientX: 100, clientY: 100 });
    header.onpointermove({ pointerId: 1, clientX: 500, clientY: 520 });

    expect(header.setPointerCapture).toHaveBeenCalledWith(1);
    expect(root.style.left).toBe("400px");
    expect(root.style.top).toBe("432px");
    expect(root.style.right).toBe("auto");
  });

  it("renders visible round metadata from gameState", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "round_start",
      source: "manual",
      ts: 0,
      payload: { round: "1-2", chang: 1, ju: 2, honba: 3, riichiSticks: 2 }
    });
    gameState.applyEvent({
      type: "draw_tile",
      source: "manual",
      ts: 1,
      payload: { seat: 0, tile: "1m", leftTileCount: 55, binaryEnvelope: { step: 8 } }
    });
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState });
    overlay.mount();

    const round = document.querySelector('[data-role="round-metadata"]').textContent;
    const counters = document.querySelector('[data-role="counter-metadata"]').textContent;
    const turn = document.querySelector('[data-role="turn-metadata"]').textContent;
    expect(turn).toContain("Wall: 55");
    expect(turn).toContain("Step: 8");
    expect(round).toContain("Chang 1");
    expect(round).toContain("Ju 2");
    expect(round).toContain("Round wind S");
    expect(round).toContain("Seat wind W");
    expect(counters).toContain("Honba 3");
    expect(counters).toContain("Riichi sticks 2");
  });

  it("renders dora indicator to dora tile mapping", () => {
    const gameState = new GameState();
    gameState.applyEvent({ type: "dora", source: "manual", ts: 1, payload: { tile: "4p" } });
    gameState.applyEvent({ type: "dora", source: "manual", ts: 2, payload: { tile: "7z" } });
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState });
    overlay.mount();

    const text = document.querySelector("#majsoul-helper-overlay").textContent;
    expect(text).toContain("Dora indicators: 4p->5p 7z->5z");
  });

  it("renders drawn tile separately from hand and summarizes visible tiles used for ukeire", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "round_start",
      source: "manual",
      ts: 1,
      payload: {
        tiles: ["1m", "2m", "3m", "1p", "2p", "3p", "1s", "2s", "3s", "4s", "5s", "6s", "1z"],
        doraIndicators: ["4p"]
      }
    });
    gameState.applyEvent({ type: "discard_tile", source: "manual", ts: 2, payload: { seat: 1, tile: "9s" } });
    gameState.applyEvent({ type: "draw_tile", source: "manual", ts: 3, payload: { seat: 0, tile: "7z" } });
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState });
    overlay.mount();

    expect(document.querySelector('[data-role="current-hand"]').textContent).not.toContain("7z");
    expect(document.querySelector('[data-role="drawn-tile"]').textContent).toContain("Drawn tile: 7z");
    const visibleSummary = document.querySelector('[data-role="visible-tiles-for-analysis"]').textContent;
    expect(visibleSummary).toContain("Visible known tiles for ukeire: 2 tiles");
    expect(visibleSummary).toContain("4p");
    expect(visibleSummary).toContain("9s");
  });

  it("renders state warnings", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "draw_tile",
      source: "manual",
      ts: 1,
      payload: { seat: 0, tile: "1m" }
    });
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState });
    overlay.mount();

    expect(document.querySelector("#majsoul-helper-overlay").textContent).toContain("State warnings");
    expect(document.querySelector("#majsoul-helper-overlay").textContent).toContain("drawnTile exists without base hand");
  });

  it("renders riichi and round end metadata", () => {
    const gameState = new GameState();
    gameState.applyEvent({ type: "riichi", source: "manual", ts: 1, payload: { seat: 1 } });
    gameState.applyEvent({ type: "round_end", source: "manual", ts: 2, payload: { reason: "liuju" } });
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState });
    overlay.mount();

    expect(document.querySelector("#majsoul-helper-overlay").textContent).toContain("Riichi: 1");
    expect(document.querySelector("#majsoul-helper-overlay").textContent).toContain("End: liuju");
  });

  it("renders table state with scores, rivers, melds, riichi, and current turn", () => {
    const gameState = new GameState();
    gameState.applyEvent({ type: "round_start", source: "manual", ts: 1, payload: { scores: [25000, 26000, 24000, 25000] } });
    gameState.applyEvent({ type: "discard_tile", source: "manual", ts: 2, payload: { seat: 1, tile: "9s", isRiichi: true } });
    gameState.applyEvent({ type: "call_meld", source: "manual", ts: 3, payload: { seat: 2, meld: ["3p", "4p", "5p"] } });
    gameState.applyEvent({ type: "draw_tile", source: "manual", ts: 4, payload: { seat: 3, tile: "1m" } });
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState });
    overlay.mount();

    const text = document.querySelector("#majsoul-helper-overlay").textContent;
    expect(text).toContain("Table State");
    expect(text).toContain("Seat 1 riichi / 26000");
    expect(text).toContain("9s");
    expect(text).toContain("Seat 2 / 24000");
    expect(text).toContain("Melds: 3p 4p 5p");
    expect(text).toContain("Seat 3 turn / 25000");
  });

  it("does not show a stale turn marker after discard", () => {
    const gameState = new GameState();
    gameState.applyEvent({ type: "draw_tile", source: "manual", ts: 1, payload: { seat: 3, tile: "1m" } });
    gameState.applyEvent({ type: "discard_tile", source: "manual", ts: 2, payload: { seat: 3, tile: "1m" } });
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState });
    overlay.mount();

    const text = document.querySelector("#majsoul-helper-overlay").textContent;
    expect(text).toContain("Turn: -");
    expect(text).toContain("Seat 3 / 25000");
    expect(text).not.toContain("Seat 3 turn / 25000");
  });

  it("analyzes manual input without enabling realtime advice", () => {
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState: new GameState() });
    overlay.mount();

    const input = document.querySelector('[data-role="manual-input"]');
    input.value = "123m123p123s456s11z";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(document.querySelector("#majsoul-helper-overlay").textContent).toContain("Current shanten");
    expect(document.querySelector("#majsoul-helper-overlay").textContent).toContain("After discard shanten");
    expect(document.querySelector("#majsoul-helper-overlay").textContent).toMatch(/Ukeire: .* x\d+/);
  });

  it("updates manual analysis on input and can clear manual state before export", () => {
    const gameState = new GameState();
    gameState.applyEvent({ type: "deal_hand", source: "manual", ts: 1, payload: { tiles: ["1m", "2m", "3m"] } });
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState });
    overlay.mount();

    const input = document.querySelector('[data-role="manual-input"]');
    input.value = "123m123p123s456s11z";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(document.querySelector('[data-role="analysis-source"]').textContent).toContain("manual input");
    expect(document.querySelector("#majsoul-helper-overlay").textContent).toContain("Current shanten");
    expect(document.querySelector('[data-role="real-page-preflight"]').textContent).toContain("manualInputInactive");

    document.querySelector('[data-action="clear-manual-input"]').click();

    expect(document.querySelector('[data-role="manual-input"]').value).toBe("");
    expect(document.querySelector('[data-role="analysis-source"]').textContent).toContain("captured state");
    expect(document.querySelector('[data-role="current-hand"]').textContent).toContain("1m2m3m");
    expect(document.querySelector('[data-role="real-page-preflight"]').textContent).not.toContain("manualInputInactive");
  });

  it("does not persist realtime advice enablement across overlay mounts", () => {
    const adapter = new FakeAdapter();
    const gameState = new GameState();
    const overlay = new Overlay({ adapter, gameState });
    overlay.mount();

    const toggle = document.querySelector('[data-action="realtime-advice"]');
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(document.querySelector('[data-action="realtime-advice"]').checked).toBe(true);
    expect(window.localStorage.getItem("majsoul-helper-config") || "{}").not.toContain("realtime");

    document.querySelector("#majsoul-helper-overlay").remove();
    const nextOverlay = new Overlay({ adapter, gameState });
    nextOverlay.mount();

    expect(document.querySelector('[data-action="realtime-advice"]').checked).toBe(false);
  });

  it("shows shanten but withholds discard candidates for 13-tile manual input", () => {
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState: new GameState() });
    overlay.mount();

    const input = document.querySelector('[data-role="manual-input"]');
    input.value = "123m123p123s456s1z";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const text = document.querySelector("#majsoul-helper-overlay").textContent;
    expect(text).toContain("Current shanten");
    expect(text).toContain("Discard candidates are shown only with 3n+2 tiles");
    expect(text).not.toContain("After discard shanten");
  });

  it("withholds realtime discard candidates before own drawn tile is present", () => {
    const gameState = new GameState();
    gameState.applyEvent({ type: "deal_hand", source: "manual", ts: 1, payload: { tiles: ["1m", "2m", "3m", "1p", "2p", "3p", "1s", "2s", "3s", "4s", "5s", "6s", "1z"] } });
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState });
    overlay.mount();

    document.querySelector('[data-action="realtime-advice"]').checked = true;
    document.querySelector('[data-action="realtime-advice"]').dispatchEvent(new Event("change", { bubbles: true }));

    const text = document.querySelector("#majsoul-helper-overlay").textContent;
    expect(text).toContain("Current shanten");
    expect(text).toContain("Discard candidates are shown only with 3n+2 tiles");
    expect(text).not.toContain("After discard shanten");
  });

  it("uses own open meld count for captured-state analysis", () => {
    const gameState = new GameState();
    gameState.applyEvent({ type: "deal_hand", source: "manual", ts: 1, payload: { tiles: ["4m", "4m", "5m", "1z"] } });
    gameState.applyEvent({ type: "call_meld", source: "manual", ts: 2, payload: { seat: 0, meld: ["1p", "2p", "3p"] } });
    gameState.applyEvent({ type: "call_meld", source: "manual", ts: 3, payload: { seat: 0, meld: ["4p", "5p", "6p"] } });
    gameState.applyEvent({ type: "call_meld", source: "manual", ts: 4, payload: { seat: 0, meld: ["7s", "8s", "9s"] } });
    gameState.applyEvent({ type: "draw_tile", source: "manual", ts: 5, payload: { seat: 0, tile: "1z" } });
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState });
    overlay.mount();

    document.querySelector('[data-action="realtime-advice"]').checked = true;
    document.querySelector('[data-action="realtime-advice"]').dispatchEvent(new Event("change", { bubbles: true }));

    const text = document.querySelector("#majsoul-helper-overlay").textContent;
    expect(text).toContain("Open melds for analysis: 3");
    expect(text).toContain("After discard shanten: 0");
  });

  it("keeps manual analysis isolated from captured drawn tile", () => {
    const gameState = new GameState();
    gameState.applyEvent({ type: "deal_hand", source: "manual", ts: 1, payload: { tiles: ["1m", "2m", "3m"] } });
    gameState.applyEvent({ type: "draw_tile", source: "manual", ts: 2, payload: { seat: 0, tile: "9s" } });
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState });
    overlay.mount();

    const input = document.querySelector('[data-role="manual-input"]');
    input.value = "123m123p123s456s11z";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(document.querySelector('[data-role="analysis-source"]').textContent).toContain("manual input");
    expect(document.querySelector('[data-role="current-hand"]').textContent).not.toContain("9s");
  });

  it("keeps manual ukeire isolated from captured visible tiles", () => {
    const gameState = new GameState();
    gameState.applyEvent({ type: "dora", source: "manual", ts: 1, payload: { tile: "5s" } });
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState });
    overlay.mount();

    const input = document.querySelector('[data-role="manual-input"]');
    input.value = "1239m123p123s46s11z";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const text = document.querySelector("#majsoul-helper-overlay").textContent;
    expect(document.querySelector('[data-role="analysis-source"]').textContent).toContain("manual input");
    expect(text).toContain("5s x4 (1 types / 4 tiles)");
  });

  it("does not fall back to captured analysis while manual input is invalid", () => {
    const gameState = new GameState();
    gameState.applyEvent({ type: "deal_hand", source: "manual", ts: 1, payload: { tiles: ["1m", "2m", "3m", "1p", "2p", "3p", "1s", "2s", "3s", "4s", "5s", "6s", "1z"] } });
    gameState.applyEvent({ type: "draw_tile", source: "manual", ts: 2, payload: { seat: 0, tile: "9s" } });
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState });
    overlay.mount();

    document.querySelector('[data-action="realtime-advice"]').checked = true;
    document.querySelector('[data-action="realtime-advice"]').dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.querySelector("#majsoul-helper-overlay").textContent).toContain("After discard shanten");

    const input = document.querySelector('[data-role="manual-input"]');
    input.value = "123x";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const text = document.querySelector("#majsoul-helper-overlay").textContent;
    expect(document.querySelector('[data-role="analysis-source"]').textContent).toContain("manual input");
    expect(text).toContain("Invalid suit: x");
    expect(text).toContain("Fix manual input to show analysis");
    expect(text).not.toContain("After discard shanten");
    expect(document.querySelector('[data-role="current-hand"]').textContent).not.toContain("9s");
  });

  it("surfaces impossible known tile counts as analysis errors", () => {
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState: new GameState() });
    overlay.mount();

    const input = document.querySelector('[data-role="manual-input"]');
    input.value = "11111m222p333s44z";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const text = document.querySelector("#majsoul-helper-overlay").textContent;
    expect(text).toContain("Analysis failed: Known tile count exceeds four: 1m x5");
    expect(text).not.toContain("After discard shanten");
  });

  it("keeps debug controls usable when captured analysis fails", () => {
    const gameState = {
      clearEvents: vi.fn(),
      applyEvent: vi.fn(),
      getVisibleState: () => ({
        hand: ["bad"],
        drawnTile: null,
        melds: [[], [], [], []],
        discards: [[], [], [], []],
        doraIndicators: [],
        round: null,
        chang: null,
        ju: null,
        honba: 0,
        riichiSticks: 0,
        seatWind: null,
        roundWind: null,
        currentTurn: null,
        leftTileCount: null,
        lastStep: null,
        roundEndReason: null,
        riichi: [false, false, false, false],
        scores: [25000, 25000, 25000, 25000],
        events: [],
        visibleTiles: [],
        warnings: []
      })
    };
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState });
    overlay.mount();

    document.querySelector('[data-action="realtime-advice"]').checked = true;
    document.querySelector('[data-action="realtime-advice"]').dispatchEvent(new Event("change", { bubbles: true }));

    const text = document.querySelector("#majsoul-helper-overlay").textContent;
    expect(text).toContain("Analysis failed: Invalid tile: bad");
    expect(document.querySelector('[data-action="copy-capture"]')).toBeTruthy();
    expect(document.querySelector('[data-role="capture-health"]').textContent).toContain("Waiting for WebSocket traffic");
  });

  it("copies gameState and capture JSON", async () => {
    const adapter = new FakeAdapter();
    const overlay = new Overlay({ adapter, gameState: new GameState() });
    overlay.mount();

    document.querySelector('[data-action="copy-state"]').click();
    document.querySelector('[data-action="copy-capture"]').click();

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2);
    expect(navigator.clipboard.writeText.mock.calls[0][0]).toContain('"hand"');
    expect(navigator.clipboard.writeText.mock.calls[1][0]).toContain('"formatVersion"');
    expect(navigator.clipboard.writeText.mock.calls[1][0]).toContain('"liveGameState"');
    expect(navigator.clipboard.writeText.mock.calls[1][0]).toContain('"liveDebugSummary"');
    expect(navigator.clipboard.writeText.mock.calls[1][0]).toContain('"liveMvpGate"');
    expect(navigator.clipboard.writeText.mock.calls[1][0]).toContain('"liveSafetySettings"');
    expect(navigator.clipboard.writeText.mock.calls[1][0]).toContain('"liveRealPagePreflight"');
    const copiedCapture = JSON.parse(navigator.clipboard.writeText.mock.calls[1][0]);
    expect(copiedCapture.note).toContain("liveGameState, liveDebugSummary, liveMvpGate, liveSafetySettings, and liveRealPagePreflight snapshots");
    expect(copiedCapture.note).toContain("no messages were modified");
    expect(copiedCapture.verification).toMatchObject({
      recommendedPath: "captures/capture-real.json",
      commands: {
        doctor: "npm run capture-doctor -- captures/capture-real.json",
        replay: "npm run replay -- captures/capture-real.json",
        realPageGate: "npm run real-page-gate"
      },
      realPageReadyRequires: expect.arrayContaining([
        "Mahjong Soul page metadata",
        "overlay live snapshots",
        "liveRealPagePreflight.readyToExport=true",
        "safe liveSafetySettings",
        "acceptance.readyForRealPageMvp=true",
        "liveStateSnapshotMatches=true"
      ])
    });
    expect(copiedCapture.liveGameState.events).toBeUndefined();
    expect(copiedCapture.liveDebugSummary).toMatchObject({
      raw: 0,
      parsed: 0
    });
    expect(copiedCapture.liveMvpGate).toMatchObject({
      passed: 1,
      total: 16
    });
    expect(copiedCapture.liveSafetySettings).toMatchObject({
      realtimeAdviceEnabled: false,
      realtimeAdviceDefault: false,
      realtimeAdviceMode: "off",
      manualInputActive: false,
      capturePaused: false,
      automationDisabled: true,
      clickAutomationDisabled: true,
      messageMutationDisabled: true
    });
    expect(copiedCapture.liveRealPagePreflight).toMatchObject({
      preflightVersion: REAL_PAGE_PREFLIGHT_VERSION,
      requiredChecks: [...REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS],
      readyToExport: false,
      checks: expect.objectContaining({
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
      }),
      hints: expect.arrayContaining(["Open Mahjong Soul web before exporting."]),
      offlineValidationRequired: true,
      doctorCommand: "npm run capture-doctor -- captures/capture-real.json",
      offlineCommand: "npm run real-page-gate"
    });
  });

  it("prepares a downloadable capture JSON without using clipboard", async () => {
    const adapter = new FakeAdapter();
    adapter.exportCapture = vi.fn(({ limit } = {}) => ({ formatVersion: 1, limit, events: [] }));
    const overlay = new Overlay({ adapter, gameState: new GameState() });
    overlay.mount();

    const input = document.querySelector('[data-role="capture-limit"]');
    input.value = "9";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const link = document.querySelector('[data-action="download-capture"]');
    link.addEventListener("click", (event) => event.preventDefault());
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(adapter.exportCapture).toHaveBeenCalledWith({ limit: 9 });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(link.href).toBe("blob:majsoul-helper-capture");
    expect(link.download).toMatch(/^majsoul-helper-capture-.+\.json$/);
    const blob = URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("application/json");
    const captureText = await blob.text();
    expect(captureText).toContain('"liveGameState"');
    expect(captureText).toContain('"liveDebugSummary"');
    expect(captureText).toContain('"liveMvpGate"');
    expect(captureText).toContain('"liveSafetySettings"');
    expect(captureText).toContain('"liveRealPagePreflight"');
    expect(captureText).toContain('"verification"');
  });

  it("uses capture limit when copying capture JSON", () => {
    const adapter = new FakeAdapter();
    adapter.exportCapture = vi.fn(({ limit } = {}) => ({ formatVersion: 1, limit, events: [] }));
    const overlay = new Overlay({ adapter, gameState: new GameState() });
    overlay.mount();

    const input = document.querySelector('[data-role="capture-limit"]');
    input.value = "700";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector('[data-action="copy-capture"]').click();

    expect(adapter.maxEvents).toBe(700);
    expect(JSON.parse(window.localStorage.getItem("majsoul-helper-config"))).toMatchObject({
      captureLimit: 700
    });
    expect(adapter.exportCapture).toHaveBeenCalledWith({ limit: 700 });
    expect(navigator.clipboard.writeText.mock.calls.at(-1)[0]).toContain('"limit": 700');
    const copiedCapture = JSON.parse(navigator.clipboard.writeText.mock.calls.at(-1)[0]);
    expect(copiedCapture.note).toContain("liveGameState");
    expect(copiedCapture.liveMvpGate).toBeTruthy();
    expect(copiedCapture.liveRealPagePreflight).toBeTruthy();
  });

  it("keeps capture config inputs keyboard-editable across live renders", () => {
    const adapter = new FakeAdapter();
    const overlay = new Overlay({ adapter, gameState: new GameState() });
    overlay.mount();

    const rawEvent = {
      type: "raw_message",
      source: "ws_in",
      ts: 1,
      payload: {
        kind: "text",
        length: 2,
        preview: "{}",
        sample: "{}",
        truncated: false
      }
    };

    let captureLimit = document.querySelector('[data-role="capture-limit"]');
    expect(captureLimit.type).toBe("text");
    expect(captureLimit.inputMode).toBe("numeric");
    captureLimit.focus();
    captureLimit.value = "";
    captureLimit.dispatchEvent(new Event("input", { bubbles: true }));
    adapter.events = [rawEvent];
    adapter.dispatchEvent(new CustomEvent("majsoul-helper:event", { detail: rawEvent }));

    captureLimit = document.querySelector('[data-role="capture-limit"]');
    expect(document.activeElement).toBe(captureLimit);
    expect(captureLimit.value).toBe("");

    captureLimit.value = "3000";
    captureLimit.dispatchEvent(new Event("input", { bubbles: true }));
    adapter.dispatchEvent(new CustomEvent("majsoul-helper:event", { detail: rawEvent }));
    captureLimit = document.querySelector('[data-role="capture-limit"]');
    expect(document.activeElement).toBe(captureLimit);
    expect(captureLimit.value).toBe("3000");
    captureLimit.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

    expect(adapter.maxEvents).toBe(3000);
    expect(JSON.parse(window.localStorage.getItem("majsoul-helper-config"))).toMatchObject({
      captureLimit: 3000
    });

    let sampleBytes = document.querySelector('[data-role="binary-sample-bytes"]');
    expect(sampleBytes.type).toBe("text");
    expect(sampleBytes.inputMode).toBe("numeric");
    sampleBytes.focus();
    sampleBytes.value = "4x096";
    sampleBytes.dispatchEvent(new Event("input", { bubbles: true }));
    expect(sampleBytes.value).toBe("4096");
    adapter.dispatchEvent(new CustomEvent("majsoul-helper:event", { detail: rawEvent }));
    sampleBytes = document.querySelector('[data-role="binary-sample-bytes"]');
    expect(sampleBytes.value).toBe("4096");
    sampleBytes.dispatchEvent(new Event("change", { bubbles: true }));

    expect(adapter.getInstallDiagnostics().binarySampleBytes).toBe(4096);
    expect(JSON.parse(window.localStorage.getItem("majsoul-helper-config"))).toMatchObject({
      binarySampleBytes: 4096
    });
  });

  it("shields capture config typing from page listeners while capture is paused", () => {
    const adapter = new FakeAdapter();
    adapter.paused = true;
    adapter.installDiagnostics.paused = true;
    const overlay = new Overlay({ adapter, gameState: new GameState() });
    const pageKeydown = vi.fn();
    const pageInput = vi.fn();
    const pageChange = vi.fn();
    document.addEventListener("keydown", pageKeydown);
    document.addEventListener("input", pageInput);
    document.addEventListener("change", pageChange);

    overlay.mount();

    let captureLimit = document.querySelector('[data-role="capture-limit"]');
    captureLimit.focus();
    captureLimit.value = "2500";
    captureLimit.dispatchEvent(new Event("input", { bubbles: true }));
    expect(captureLimit.value).toBe("2500");
    expect(pageInput).not.toHaveBeenCalled();
    captureLimit.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

    expect(pageKeydown).not.toHaveBeenCalled();
    expect(adapter.maxEvents).toBe(2500);
    expect(adapter.paused).toBe(true);

    let sampleBytes = document.querySelector('[data-role="binary-sample-bytes"]');
    sampleBytes.focus();
    sampleBytes.value = "4096";
    sampleBytes.dispatchEvent(new Event("input", { bubbles: true }));
    expect(pageInput).not.toHaveBeenCalled();
    sampleBytes.dispatchEvent(new Event("change", { bubbles: true }));

    expect(pageChange).not.toHaveBeenCalled();
    expect(adapter.getInstallDiagnostics().binarySampleBytes).toBe(4096);
    expect(document.querySelector('[data-role="install-diagnostics"]').textContent).toContain("capture paused");
  });

  it("upgrades stored low capture config on mount", () => {
    window.localStorage.setItem("majsoul-helper-config", JSON.stringify({ captureLimit: 500, binarySampleBytes: 2048 }));
    const adapter = new FakeAdapter();
    const overlay = new Overlay({ adapter, gameState: new GameState() });
    overlay.mount();

    expect(adapter.maxEvents).toBe(3000);
    expect(adapter.getInstallDiagnostics().binarySampleBytes).toBe(4096);
    expect(document.querySelector('[data-role="capture-limit"]').value).toBe("3000");
    expect(document.querySelector('[data-role="binary-sample-bytes"]').value).toBe("4096");
    expect(JSON.parse(window.localStorage.getItem("majsoul-helper-config"))).toMatchObject({
      captureLimit: 3000,
      binarySampleBytes: 4096
    });
    expect(document.querySelector('[data-role="install-diagnostics"]').textContent).toContain("v0.2.9");
    expect(document.querySelector('[data-role="install-diagnostics"]').textContent).toContain("sample 4096 bytes");
    expect(document.querySelector('[data-role="install-diagnostics"]').textContent).toContain("page dispatch hooked");
  });

  it("shows capture pause state in debug diagnostics", () => {
    const adapter = new FakeAdapter();
    const overlay = new Overlay({ adapter, gameState: new GameState() });
    overlay.mount();

    expect(document.querySelector('[data-role="install-diagnostics"]').textContent).toContain("capture running");

    document.querySelector('[data-action="toggle-capture"]').click();

    expect(adapter.paused).toBe(true);
    expect(document.querySelector('[data-action="toggle-capture"]').textContent).toBe("Resume");
    expect(document.querySelector('[data-role="install-diagnostics"]').textContent).toContain("capture paused");
    expect(document.querySelector('[data-role="capture-health"]').textContent).toContain("Paused");
  });

  it("shows a selectable fallback when clipboard copy fails", async () => {
    navigator.clipboard.writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState: new GameState() });
    overlay.mount();

    document.querySelector('[data-action="copy-state"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector("#majsoul-helper-overlay").textContent).toContain("Clipboard write failed");
    expect(document.querySelector('[data-role="copy-fallback"]').value).toContain('"hand"');
  });

  it("clears debug messages from the overlay", () => {
    const adapter = new FakeAdapter();
    adapter.events = [{ type: "raw_message", source: "ws_in", ts: 1, payload: { preview: "old" } }];
    const overlay = new Overlay({ adapter, gameState: new GameState() });
    overlay.mount();
    expect(document.querySelector("#majsoul-helper-overlay").textContent).toContain("old");

    document.querySelector('[data-action="clear-debug"]').click();
    expect(document.querySelector("#majsoul-helper-overlay").textContent).not.toContain("old");
  });

  it("shows parser self-test results without mutating gameState or debug events", () => {
    const adapter = new FakeAdapter();
    const gameState = new GameState();
    const overlay = new Overlay({ adapter, gameState });
    overlay.mount();

    document.querySelector('[data-action="self-test"]').click();

    expect(document.querySelector('[data-role="self-test-result"]').textContent).toContain("Self-test: ok");
    expect(document.querySelector('[data-role="self-test-result"]').textContent).toContain("ActionDiscardTile -> discard_tile");
    expect(adapter.getRecentEvents()).toEqual([]);
    expect(gameState.getVisibleState().events).toEqual([]);
  });

  it("renders capture summary and truncated sample warnings in debug", () => {
    const adapter = new FakeAdapter();
    adapter.events = [
      {
        type: "raw_message",
        source: "ws_in",
        ts: 2,
        payload: {
          kind: "Uint8Array",
          truncated: true,
          envelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDealTile" }
        }
      },
      {
        type: "draw_tile",
        source: "ws_in",
        ts: 1,
        payload: {
          binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDealTile" }
        }
      }
    ];
    const overlay = new Overlay({ adapter, gameState: new GameState() });
    overlay.mount();

    const text = document.querySelector("#majsoul-helper-overlay").textContent;
    expect(text).toContain("Capture health: Standard game event names parsed, but no usable gameState fields updated yet");
    expect(text).toContain("Capture summary: raw 1 / inbound 1 / outbound 0 / parsed 1 / errors 0 / diagnostics 0 / envelopes 1 / truncated 1 / methods 1 / actions 1");
    expect(text).toContain("Some captured samples are truncated");
  });

  it("reports capture errors without counting them as parsed game events", () => {
    const adapter = new FakeAdapter();
    adapter.events = [
      {
        type: "capture_error",
        source: "ws_in",
        ts: 2,
        payload: { message: "capture failed" }
      },
      {
        type: "raw_message",
        source: "ws_in",
        ts: 1,
        payload: {
          kind: "Uint8Array",
          envelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDealTile" }
        }
      }
    ];
    const overlay = new Overlay({ adapter, gameState: new GameState() });
    overlay.mount();

    const text = document.querySelector("#majsoul-helper-overlay").textContent;
    expect(text).toContain("Capture health: Liqi envelopes captured, but no standard game events parsed yet");
    expect(text).toContain("Capture summary: raw 1 / inbound 1 / outbound 0 / parsed 0 / errors 1 / diagnostics 1 / envelopes 1");
  });

  it("renders adapter install diagnostics in debug", () => {
    const adapter = new FakeAdapter();
    adapter.installed = false;
    adapter.installDiagnostics = {
      installed: false,
      installAttempts: 3,
      installedAt: null,
      installFailureReason: "WebSocket is not available on this page context yet.",
      webSocketAvailable: false,
      paused: false,
      hooks: {
        constructor: false,
        constructorStatics: {
          copied: 3,
          failed: ["CLOSED"]
        },
        prototypeConstructor: "not-installed",
        send: false,
        addEventListener: false,
        removeEventListener: false,
        onmessage: false,
        onmessageMode: "not-installed"
      },
      socketsCreated: 0,
      recentSocketUrls: [],
      maxEvents: 100,
      binarySampleBytes: 1024,
      eventBuffer: {
        maxEvents: 100,
        retainedEvents: 0,
        totalEventsSinceClear: 0,
        oldestEventId: null,
        newestEventId: null,
        droppedBeforeRetained: 0
      }
    };
    const overlay = new Overlay({ adapter, gameState: new GameState() });
    overlay.mount();

    const text = document.querySelector("#majsoul-helper-overlay").textContent;
    expect(document.querySelector('[data-role="install-diagnostics"]').textContent).toContain("Install: not installed / capture running / attempts 3 / WebSocket missing / sockets 0 / sample 4096 bytes");
    expect(document.querySelector('[data-role="hook-diagnostics"]').textContent).toContain("constructor off / statics 3 copied / 1 failed / prototype.constructor not-installed / send off / addEventListener off / removeEventListener off / onmessage off (not-installed)");
    expect(document.querySelector('[data-role="runtime-diagnostics"]').textContent).toContain("Runtime:");
    expect(text).toContain("WebSocket is not available on this page context yet.");
  });

  it("renders event buffer diagnostics and warns when older events were dropped", () => {
    const adapter = new FakeAdapter();
    adapter.installDiagnostics.eventBuffer = {
      maxEvents: 300,
      retainedEvents: 300,
      totalEventsSinceClear: 420,
      oldestEventId: 121,
      newestEventId: 420,
      droppedBeforeRetained: 120
    };
    const overlay = new Overlay({ adapter, gameState: new GameState() });
    overlay.mount();

    const buffer = document.querySelector('[data-role="event-buffer-diagnostics"]');
    expect(buffer.textContent).toContain("Event buffer: retained 300/420 / max 300 / dropped 120 / ids 121-420");
    expect(buffer.classList.contains("mh-warning")).toBe(true);
    const preflightText = document.querySelector('[data-role="real-page-preflight"]').textContent;
    expect(preflightText).toContain("eventBufferComplete");
    expect(preflightText).toContain("Increase Capture limit");
  });

  it("blocks real-page preflight when live samples are truncated or capture errors occurred", () => {
    const adapter = new FakeAdapter();
    adapter.events = [
      {
        type: "raw_message",
        source: "ws_in",
        ts: 1,
        payload: {
          kind: "Uint8Array",
          truncated: true,
          envelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDealTile" }
        }
      },
      {
        type: "capture_error",
        source: "ws_in",
        ts: 2,
        payload: { message: "sample failed" }
      }
    ];
    const overlay = new Overlay({ adapter, gameState: new GameState() });
    overlay.mount();

    const preflightText = document.querySelector('[data-role="real-page-preflight"]').textContent;
    expect(preflightText).toContain("noTruncatedSamples");
    expect(preflightText).toContain("Increase Binary sample bytes");
    expect(preflightText).toContain("noCaptureErrors");
    expect(preflightText).toContain("capture errors stop appearing");
  });

  it("blocks real-page preflight when acceptance-sample safety settings are not clean", () => {
    const overlay = new Overlay({ adapter: new FakeAdapter(), gameState: new GameState() });
    overlay.mount();

    document.querySelector('[data-action="realtime-advice"]').checked = true;
    document.querySelector('[data-action="realtime-advice"]').dispatchEvent(new Event("change", { bubbles: true }));
    const input = document.querySelector('[data-role="manual-input"]');
    input.value = "123m";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const preflightText = document.querySelector('[data-role="real-page-preflight"]').textContent;
    expect(preflightText).toContain("realtimeAdviceOff");
    expect(preflightText).toContain("Turn realtime advice off before exporting");
    expect(preflightText).toContain("manualInputInactive");
    expect(preflightText).toContain("Clear Manual Input before exporting");
  });

  it("updates and stores binary sample byte setting from debug", () => {
    const adapter = new FakeAdapter();
    const overlay = new Overlay({ adapter, gameState: new GameState() });
    overlay.mount();

    const input = document.querySelector('[data-role="binary-sample-bytes"]');
    input.value = "2048";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(adapter.getInstallDiagnostics().binarySampleBytes).toBe(2048);
    expect(JSON.parse(window.localStorage.getItem("majsoul-helper-config"))).toMatchObject({
      binarySampleBytes: 2048
    });
    expect(document.querySelector('[data-role="install-diagnostics"]').textContent).toContain("sample 2048 bytes");
  });

  it("upgrades stored low binary sample byte setting on mount", () => {
    window.localStorage.setItem("majsoul-helper-config", JSON.stringify({ binarySampleBytes: 2048 }));
    const adapter = new FakeAdapter();
    const overlay = new Overlay({ adapter, gameState: new GameState() });
    overlay.mount();

    expect(adapter.getInstallDiagnostics().binarySampleBytes).toBe(4096);
    expect(document.querySelector('[data-role="binary-sample-bytes"]').value).toBe("4096");
    expect(document.querySelector('[data-role="install-diagnostics"]').textContent).toContain("sample 4096 bytes");
  });

  it("renders unparsed ActionPrototype names in debug", () => {
    const adapter = new FakeAdapter();
    adapter.events = [
      {
        type: "raw_message",
        source: "ws_in",
        ts: 1,
        payload: {
          kind: "Uint8Array",
          length: 44,
          envelope: {
            methodName: ".lq.ActionPrototype",
            actionName: "ActionUnknownLive",
            payloadLength: 20,
            actionPayloadLength: 6,
            actionPayloadFields: {
              varints: [{ field: 1, values: [2] }],
              strings: [{ field: 2, values: ["5m"] }],
              tileStrings: [{ field: 2, values: ["5m"] }]
            }
          }
        }
      },
      {
        type: "raw_message",
        source: "ws_in",
        ts: 2,
        payload: {
          kind: "Uint8Array",
          length: 53,
          envelope: {
            methodName: ".lq.ActionPrototype",
            actionName: "ActionDiscardTile",
            payloadLength: 29,
            actionPayloadLength: 6,
            actionPayloadFields: {
              varints: [{ field: 1, values: [1] }],
              strings: [{ field: 2, values: ["9s"] }],
              tileStrings: [{ field: 2, values: ["9s"] }]
            }
          }
        }
      },
      {
        type: "discard_tile",
        source: "ws_in",
        ts: 3,
        payload: {
          binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" }
        }
      }
    ];
    const overlay = new Overlay({ adapter, gameState: new GameState() });
    overlay.mount();

    const text = document.querySelector("#majsoul-helper-overlay").textContent;
    expect(text).toContain("Unparsed actions: ActionUnknownLive x1");
    expect(text).toContain("Action diagnostics");
    expect(text).toContain("ActionUnknownLive raw 1 / parsed 0 / unparsed 1");
    expect(text).toContain("sample Uint8Array msg 44 / payload 20 / action 6");
    expect(text).toContain("varints f1:2 / tiles f2:5m / strings f2:5m");
    expect(text).toContain("ActionDiscardTile raw 1 / parsed 1 / unparsed 0");
  });

  it("renders capture health for common hook and parser states", () => {
    const adapter = new FakeAdapter();
    const overlay = new Overlay({ adapter, gameState: new GameState() });
    overlay.mount();
    expect(document.querySelector('[data-role="capture-health"]').textContent).toContain("Waiting for WebSocket traffic");

    adapter.events = [{ type: "raw_message", source: "ws_out", ts: 1, payload: { kind: "text", preview: "out" } }];
    overlay.render();
    expect(document.querySelector('[data-role="capture-health"]').textContent).toContain("Only outbound traffic captured");

    adapter.installDiagnostics.hooks.onmessage = false;
    adapter.installDiagnostics.hooks.onmessageMode = "non-configurable";
    overlay.render();
    expect(document.querySelector('[data-role="capture-health"]').textContent).toContain("onmessage descriptor is non-configurable");
    adapter.installDiagnostics.hooks.onmessage = true;
    adapter.installDiagnostics.hooks.onmessageMode = "accessor";

    adapter.events = [{ type: "raw_message", source: "ws_in", ts: 2, payload: { kind: "Uint8Array", preview: "in" } }];
    overlay.render();
    expect(document.querySelector('[data-role="capture-health"]').textContent).toContain("no Liqi envelope decoded");

    adapter.events = [{
      type: "raw_message",
      source: "ws_in",
      ts: 3,
      payload: { kind: "Uint8Array", envelope: { methodName: ".lq.ActionPrototype" } }
    }];
    overlay.render();
    expect(document.querySelector('[data-role="capture-health"]').textContent).toContain("no standard game events parsed");

    adapter.installDiagnostics.runtime = {
      unityWebGL: true,
      unityBuildScript: "https://game.maj-soul.com/1/Build/chs_t-WebGL-release-4.0.43(43).loader.js",
      hasUnityInstance: true,
      hasUnityModule: true,
      heapU8: true,
      sendMessageAvailable: true,
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
    };
    adapter.events = [
      {
        type: "raw_message",
        source: "ws_in",
        ts: 4,
        payload: { kind: "Uint8Array", envelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDealTile" } }
      },
      {
        type: "draw_tile",
        source: "ws_in",
        ts: 5,
        payload: { binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDealTile" } }
      }
    ];
    overlay.render();
    expect(document.querySelector('[data-role="runtime-diagnostics"]').textContent).toContain("Unity WebGL detected");
    expect(document.querySelector('[data-role="runtime-diagnostics"]').textContent).toContain("instance keys 3 / funcs 2 / proto funcs 0");
    expect(document.querySelector('[data-role="runtime-diagnostics"]').textContent).toContain("Module keys 4 / funcs 3 / proto funcs 0");
    expect(document.querySelector('[data-role="capture-health"]').textContent).toContain("Unity WebGL Action names are captured");
  });

  it("renders a live MVP gate aligned with real-page replay acceptance", () => {
    const adapter = new FakeAdapter();
    adapter.events = [
      {
        type: "raw_message",
        source: "ws_in",
        ts: 1,
        payload: {
          kind: "Uint8Array",
          envelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDealTile" }
        }
      },
      {
        type: "draw_tile",
        source: "ws_in",
        ts: 2,
        payload: {
          seat: 0,
          tile: "5m",
          binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDealTile" }
        }
      },
      {
        type: "raw_message",
        source: "ws_in",
        ts: 3,
        payload: {
          kind: "Uint8Array",
          envelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" }
        }
      },
      {
        type: "discard_tile",
        source: "ws_in",
        ts: 4,
        payload: {
          seat: 1,
          tile: "9s",
          binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" }
        }
      }
    ];
    const gameState = new GameState();
    gameState.applyEvent({
      type: "round_start",
      source: "ws_in",
      ts: 0,
      payload: {
        chang: 0,
        ju: 1,
        tiles: ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "1z"],
        doraIndicators: ["4p"],
        scores: [25000, 25000, 25000, 25000]
      }
    });
    gameState.applyEvent({ type: "draw_tile", source: "ws_in", ts: 2, payload: { seat: 0, tile: "5m" } });
    gameState.applyEvent({ type: "discard_tile", source: "ws_in", ts: 4, payload: { seat: 1, tile: "9s" } });

    const overlay = new Overlay({ adapter, gameState });
    overlay.mount();

    const gateText = document.querySelector('[data-role="mvp-gate"]').textContent;
    expect(gateText).toContain("MVP gate: 16/16");
    expect(gateText).toContain("Ready for replay strict validation");
    const preflightText = document.querySelector('[data-role="real-page-preflight"]').textContent;
    expect(preflightText).toContain("Real-page preflight");
    expect(preflightText).toContain("Missing before export");
    expect(preflightText).toContain("mahjongSoulPage");
    expect(preflightText).toContain("Open Mahjong Soul web before exporting");
    expect(preflightText).toContain("npm run capture-doctor -- captures/capture-real.json");
    expect(preflightText).toContain("npm run real-page-gate");
  });

  it("promotes observed optional live events into the MVP gate", () => {
    const adapter = new FakeAdapter();
    adapter.events = [
      {
        type: "raw_message",
        source: "ws_in",
        ts: 1,
        payload: {
          kind: "Uint8Array",
          envelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDealTile" }
        }
      },
      {
        type: "draw_tile",
        source: "ws_in",
        ts: 2,
        payload: {
          seat: 0,
          tile: "5m",
          binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDealTile" }
        }
      },
      {
        type: "raw_message",
        source: "ws_in",
        ts: 3,
        payload: {
          kind: "Uint8Array",
          envelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" }
        }
      },
      {
        type: "discard_tile",
        source: "ws_in",
        ts: 4,
        payload: {
          seat: 1,
          tile: "9s",
          binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" }
        }
      },
      {
        type: "call_meld",
        source: "ws_in",
        ts: 5,
        payload: {
          meld: ["3p", "4p", "5p"],
          binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionChiPengGang" }
        }
      }
    ];
    const gameState = new GameState();
    gameState.applyEvent({
      type: "round_start",
      source: "ws_in",
      ts: 0,
      payload: {
        chang: 0,
        ju: 1,
        tiles: ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "1z"],
        doraIndicators: ["4p"],
        scores: [25000, 25000, 25000, 25000]
      }
    });
    gameState.applyEvent({ type: "draw_tile", source: "ws_in", ts: 2, payload: { seat: 0, tile: "5m" } });
    gameState.applyEvent({ type: "discard_tile", source: "ws_in", ts: 4, payload: { seat: 1, tile: "9s" } });

    const overlay = new Overlay({ adapter, gameState });
    overlay.mount();

    const gateText = document.querySelector('[data-role="mvp-gate"]').textContent;
    expect(gateText).toContain("MVP gate: 16/18");
    expect(gateText).toContain("Missing: callMeldSeatParsed, gameStateMeldsUpdated");
  });

  it("checks current turn when live events imply an active caller", () => {
    const adapter = new FakeAdapter();
    adapter.events = [
      {
        type: "raw_message",
        source: "ws_in",
        ts: 1,
        payload: {
          kind: "Uint8Array",
          envelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDealTile" }
        }
      },
      {
        type: "draw_tile",
        source: "ws_in",
        ts: 2,
        payload: {
          seat: 0,
          tile: "5m",
          binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDealTile" }
        }
      },
      {
        type: "raw_message",
        source: "ws_in",
        ts: 3,
        payload: {
          kind: "Uint8Array",
          envelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" }
        }
      },
      {
        type: "discard_tile",
        source: "ws_in",
        ts: 4,
        payload: {
          seat: 1,
          tile: "9s",
          binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" }
        }
      },
      {
        type: "call_meld",
        source: "ws_in",
        ts: 5,
        payload: {
          seat: 2,
          meld: ["3p", "4p", "5p"],
          binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionChiPengGang" }
        }
      }
    ];
    const gameState = new GameState();
    gameState.applyEvent({
      type: "round_start",
      source: "ws_in",
      ts: 0,
      payload: {
        chang: 0,
        ju: 1,
        tiles: ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "1z"],
        doraIndicators: ["4p"],
        scores: [25000, 25000, 25000, 25000]
      }
    });
    gameState.applyEvent({ type: "draw_tile", source: "ws_in", ts: 2, payload: { seat: 0, tile: "5m" } });
    gameState.applyEvent({ type: "discard_tile", source: "ws_in", ts: 4, payload: { seat: 1, tile: "9s" } });
    gameState.applyEvent({ type: "call_meld", source: "ws_in", ts: 5, payload: { seat: 2, meld: ["3p", "4p", "5p"] } });
    gameState.state.currentTurn = null;

    const overlay = new Overlay({ adapter, gameState });
    overlay.mount();

    const gateText = document.querySelector('[data-role="mvp-gate"]').textContent;
    expect(gateText).toContain("MVP gate: 18/19");
    expect(gateText).toContain("Missing: gameStateCurrentTurnUpdated");
  });

  it("promotes live closed-kan checks when ActionAnGangAddGang appears", () => {
    const adapter = new FakeAdapter();
    adapter.events = [
      {
        type: "raw_message",
        source: "ws_in",
        ts: 1,
        payload: {
          kind: "Uint8Array",
          envelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDealTile" }
        }
      },
      {
        type: "draw_tile",
        source: "ws_in",
        ts: 2,
        payload: {
          seat: 0,
          tile: "1m",
          binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDealTile" }
        }
      },
      {
        type: "raw_message",
        source: "ws_in",
        ts: 3,
        payload: {
          kind: "Uint8Array",
          envelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" }
        }
      },
      {
        type: "discard_tile",
        source: "ws_in",
        ts: 4,
        payload: {
          seat: 1,
          tile: "9s",
          binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" }
        }
      },
      {
        type: "call_meld",
        source: "ws_in",
        ts: 5,
        payload: {
          seat: 0,
          type: 3,
          meld: ["5p"],
          binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionAnGangAddGang" }
        }
      }
    ];
    const gameState = new GameState();
    gameState.applyEvent({
      type: "round_start",
      source: "ws_in",
      ts: 0,
      payload: {
        chang: 0,
        ju: 1,
        tiles: ["5p", "5p", "5p", "5p", "1m", "2m", "3m", "4m", "6m", "7m", "8m", "9m", "1p"],
        doraIndicators: ["4p"],
        scores: [25000, 25000, 25000, 25000]
      }
    });
    gameState.applyEvent({ type: "draw_tile", source: "ws_in", ts: 2, payload: { seat: 0, tile: "1m" } });
    gameState.applyEvent({ type: "discard_tile", source: "ws_in", ts: 4, payload: { seat: 1, tile: "9s" } });
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 5,
      payload: {
        seat: 0,
        type: 3,
        meld: ["5p"],
        binaryEnvelope: { actionName: "ActionAnGangAddGang" }
      }
    });

    const overlay = new Overlay({ adapter, gameState });
    overlay.mount();

    const gateText = document.querySelector('[data-role="mvp-gate"]').textContent;
    expect(gateText).toContain("MVP gate: 23/23");
    expect(gateText).toContain("Ready for replay strict validation");
  });

  it("flags live added-kan samples that do not restore a four-tile meld", () => {
    const adapter = new FakeAdapter();
    adapter.events = [
      {
        type: "raw_message",
        source: "ws_in",
        ts: 1,
        payload: {
          kind: "Uint8Array",
          envelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDealTile" }
        }
      },
      {
        type: "draw_tile",
        source: "ws_in",
        ts: 2,
        payload: {
          seat: 0,
          tile: "5p",
          binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDealTile" }
        }
      },
      {
        type: "raw_message",
        source: "ws_in",
        ts: 3,
        payload: {
          kind: "Uint8Array",
          envelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" }
        }
      },
      {
        type: "discard_tile",
        source: "ws_in",
        ts: 4,
        payload: {
          seat: 1,
          tile: "9s",
          binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" }
        }
      },
      {
        type: "call_meld",
        source: "ws_in",
        ts: 5,
        payload: {
          seat: 0,
          type: 2,
          meld: ["5p"],
          binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "RecordAnGangAddGang" }
        }
      }
    ];
    const gameState = new GameState();
    gameState.applyEvent({
      type: "round_start",
      source: "ws_in",
      ts: 0,
      payload: {
        chang: 0,
        ju: 1,
        tiles: ["1m", "2m", "3m", "4m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "1z", "2z"],
        doraIndicators: ["4p"],
        scores: [25000, 25000, 25000, 25000]
      }
    });
    gameState.applyEvent({ type: "draw_tile", source: "ws_in", ts: 2, payload: { seat: 0, tile: "5p" } });
    gameState.applyEvent({ type: "discard_tile", source: "ws_in", ts: 4, payload: { seat: 1, tile: "9s" } });
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 5,
      payload: {
        seat: 0,
        type: 2,
        meld: ["5p"],
        binaryEnvelope: { actionName: "RecordAnGangAddGang" }
      }
    });

    const overlay = new Overlay({ adapter, gameState });
    overlay.mount();

    const gateText = document.querySelector('[data-role="mvp-gate"]').textContent;
    expect(gateText).toContain("MVP gate: 22/23");
    expect(gateText).toContain("Missing: kanMeldTileCountsOk");
  });
});
