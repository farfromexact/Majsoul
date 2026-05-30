import { MajsoulAdapter } from "./adapter/majsoulAdapter.js";
import { GameState } from "./core/gameState.js";
import { analyzeHand } from "./core/analyzer.js";
import { parseTiles } from "./core/tile.js";
import { Overlay } from "./ui/overlay.js";

const STORAGE_KEY = "majsoul-helper-config";

function readConfig() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function boot() {
  if (window.__majsoulHelper?.version) return window.__majsoulHelper;
  const config = readConfig();
  const adapter = new MajsoulAdapter({
    binarySampleBytes: config.binarySampleBytes,
    maxEvents: config.captureLimit
  });
  const gameState = new GameState();
  const helper = {
    version: "0.1.0",
    adapter,
    gameState,
    overlay: null,
    analyzeHand,
    parseTiles
  };
  window.__majsoulHelper = helper;
  let retryTimer = null;
  const tryInstall = () => {
    if (adapter.install() && retryTimer !== null) {
      window.clearInterval(retryTimer);
      retryTimer = null;
    }
  };
  tryInstall();
  if (!adapter.installed && typeof window !== "undefined") {
    retryTimer = window.setInterval(tryInstall, 250);
  }

  const mountOverlay = () => {
    if (helper.overlay?.root) return helper.overlay;
    const overlay = new Overlay({ adapter, gameState });
    overlay.mount();
    helper.overlay = overlay;
    return overlay;
  };

  if (document.documentElement) {
    mountOverlay();
  } else {
    document.addEventListener("DOMContentLoaded", mountOverlay, { once: true });
  }

  return helper;
}

boot();
