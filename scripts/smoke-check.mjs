import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const ROUND_START_SAMPLE = JSON.stringify({
  name: "round_start",
  data: {
    round: "0-1",
    chang: 0,
    ju: 1,
    honba: 0,
    riichiSticks: 0,
    tiles: ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "1z"],
    doraIndicators: ["4p"],
    scores: [25000, 25000, 25000, 25000],
    leftTileCount: 70
  }
});

const DRAW_SAMPLE = new Uint8Array([
  0x01, 0x0a, 0x13, 0x2e, 0x6c, 0x71, 0x2e, 0x41,
  0x63, 0x74, 0x69, 0x6f, 0x6e, 0x50, 0x72, 0x6f,
  0x74, 0x6f, 0x74, 0x79, 0x70, 0x65, 0x12, 0x1c,
  0x08, 0x0a, 0x12, 0x0e, 0x41, 0x63, 0x74, 0x69,
  0x6f, 0x6e, 0x44, 0x65, 0x61, 0x6c, 0x54, 0x69,
  0x6c, 0x65, 0x1a, 0x08, 0x08, 0x00, 0x12, 0x02,
  0x35, 0x6d, 0x18, 0x37
]);

const DISCARD_SAMPLE = new Uint8Array([
  0x01, 0x0a, 0x13, 0x2e, 0x6c, 0x71, 0x2e, 0x41,
  0x63, 0x74, 0x69, 0x6f, 0x6e, 0x50, 0x72, 0x6f,
  0x74, 0x6f, 0x74, 0x79, 0x70, 0x65, 0x12, 0x1d,
  0x08, 0x0b, 0x12, 0x11, 0x41, 0x63, 0x74, 0x69,
  0x6f, 0x6e, 0x44, 0x69, 0x73, 0x63, 0x61, 0x72,
  0x64, 0x54, 0x69, 0x6c, 0x65, 0x1a, 0x06, 0x08,
  0x01, 0x12, 0x02, 0x39, 0x73
]);

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
  runScripts: "dangerously",
  url: "https://game.maj-soul.com/1/?token=secret#fragment",
  pretendToBeVisual: true
});

const { window } = dom;
window.structuredClone = globalThis.structuredClone || ((value) => JSON.parse(JSON.stringify(value)));

class SmokeWebSocket extends window.EventTarget {
  static instances = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url = "wss://smoke.local/socket") {
    super();
    this.url = url;
    this.binaryType = "arraybuffer";
    SmokeWebSocket.instances.push(this);
  }

  send(data) {
    this.lastSent = data;
  }

  receive(data) {
    this.dispatchEvent(new window.MessageEvent("message", { data }));
  }
}

window.WebSocket = SmokeWebSocket;
window.eval(readFileSync("majsoul-helper.user.js", "utf8"));

const helper = window.__majsoulHelper;
assert(helper, "helper singleton was not created");
assert(window.document.querySelector("#majsoul-helper-overlay"), "overlay did not mount");

const socket = new window.WebSocket("wss://smoke.local/socket?accessToken=secret#fragment");
socket.addEventListener("message", () => {});
socket.send("smoke-outbound");
socket.receive(ROUND_START_SAMPLE);
socket.receive(DRAW_SAMPLE);
socket.receive(DISCARD_SAMPLE);

const events = helper.adapter.getRecentEvents();
const capture = typeof helper.overlay?.buildOverlayCapture === "function"
  ? helper.overlay.buildOverlayCapture()
  : helper.adapter.exportCapture({ limit: 100 });
const visibleState = helper.gameState.getVisibleState();
const diagnostics = helper.adapter.getInstallDiagnostics();
const overlayText = window.document.querySelector("#majsoul-helper-overlay")?.textContent || "";
const serializedCapture = JSON.stringify(capture);
const liveSafetySettings = capture.liveSafetySettings || {};
const liveRealPagePreflight = capture.liveRealPagePreflight || {};

const checks = {
  helperLoaded: Boolean(helper),
  overlayMounted: Boolean(window.document.querySelector("#majsoul-helper-overlay")),
  hookInstalled: diagnostics.installed === true,
  staticOpenCopied: window.WebSocket.OPEN === 1,
  socketObserved: diagnostics.socketsCreated >= 1,
  rawInboundCaptured: events.some((event) => event.type === "raw_message" && event.source === "ws_in"),
  rawOutboundCaptured: events.some((event) => event.type === "raw_message" && event.source === "ws_out"),
  actionEnvelopeDecoded: events.some((event) => event.payload?.envelope?.actionName === "ActionDiscardTile"),
  roundStartParsed: events.some((event) => event.type === "round_start" && event.payload?.round === "0-1"),
  drawParsed: events.some((event) => event.type === "draw_tile" && event.payload?.seat === 0 && event.payload?.tile === "5m"),
  discardParsed: events.some((event) => event.type === "discard_tile" && event.payload?.seat === 1 && event.payload?.tile === "9s"),
  stateUpdated: visibleState.discards?.[1]?.includes("9s") === true,
  stateHandUpdated: visibleState.hand?.length === 13,
  stateRoundUpdated: visibleState.chang === 0 && visibleState.ju === 1,
  stateDoraUpdated: visibleState.doraIndicators?.includes("4p") === true,
  stateScoresKnown: visibleState.scoresKnown === true,
  liveMvpGateReady: overlayText.includes("MVP gate: 16/16"),
  liveRealPagePreflightReady: liveRealPagePreflight.readyToExport === true
    && overlayText.includes(`Real-page preflight: ${liveRealPagePreflight.passed}/${liveRealPagePreflight.total}`)
    && overlayText.includes("real-page-gate"),
  captureHasLiveState: Boolean(capture.liveGameState),
  captureHasLiveDebugSummary: Boolean(capture.liveDebugSummary),
  captureHasLiveMvpGate: capture.liveMvpGate?.passed === 16 && capture.liveMvpGate?.total === 16,
  captureHasLiveSafetySettings: liveSafetySettings.realtimeAdviceEnabled === false
    && liveSafetySettings.realtimeAdviceDefault === false
    && liveSafetySettings.realtimeAdviceMode === "off"
    && liveSafetySettings.capturePaused === false
    && liveSafetySettings.automationDisabled === true
    && liveSafetySettings.clickAutomationDisabled === true
    && liveSafetySettings.messageMutationDisabled === true,
  captureHasLiveRealPagePreflight: liveRealPagePreflight.readyToExport === true,
  captureSanitized: !serializedCapture.includes("accessToken=secret") && !serializedCapture.includes("token=secret") && !serializedCapture.includes("#fragment"),
  overlayDebugUpdated: overlayText.includes("ActionDiscardTile raw 1 / parsed 1")
};

for (const [name, ok] of Object.entries(checks)) {
  assert(ok, `smoke check failed: ${name}`);
}

console.log(JSON.stringify({
  ok: true,
  checks,
  eventTypes: events.map((event) => event.type),
  captureSummary: capture.summary,
  liveMvpGate: capture.liveMvpGate,
  liveSafetySettings: capture.liveSafetySettings,
  liveRealPagePreflight: capture.liveRealPagePreflight,
  install: {
    installed: diagnostics.installed,
    hooks: diagnostics.hooks,
    socketsCreated: diagnostics.socketsCreated,
    recentSocketUrls: diagnostics.recentSocketUrls
  },
  gameState: {
    hand: visibleState.hand,
    drawnTile: visibleState.drawnTile,
    discards: visibleState.discards,
    doraIndicators: visibleState.doraIndicators,
    round: visibleState.round,
    chang: visibleState.chang,
    ju: visibleState.ju,
    warnings: visibleState.warnings
  }
}, null, 2));

helper.adapter.uninstall();
window.close();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
