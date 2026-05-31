import { DEFAULT_BINARY_SAMPLE_BYTES, DEFAULT_MAX_EVENTS, MajsoulAdapter } from "./adapter/majsoulAdapter.js";
import { GameState } from "./core/gameState.js";
import { analyzeHand } from "./core/analyzer.js";
import { parseTiles } from "./core/tile.js";
import { Overlay } from "./ui/overlay.js";

const STORAGE_KEY = "majsoul-helper-config";
const HELPER_VERSION = "0.2.13";

function upgradedStoredNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(fallback, Math.floor(number));
}

function readConfig() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function boot() {
  const existingHelper = window.__majsoulHelper;
  if (existingHelper?.version === HELPER_VERSION) return existingHelper;
  if (existingHelper?.version) {
    try {
      existingHelper.adapter?.uninstall?.();
    } catch {
      // Best-effort upgrade cleanup; the new adapter will install below.
    }
    try {
      existingHelper.overlay?.root?.remove?.();
      document.getElementById("majsoul-helper-overlay")?.remove?.();
    } catch {
      // DOM cleanup should not block replacing an older helper singleton.
    }
  }
  const config = readConfig();
  const adapter = new MajsoulAdapter({
    helperVersion: HELPER_VERSION,
    binarySampleBytes: upgradedStoredNumber(config.binarySampleBytes, DEFAULT_BINARY_SAMPLE_BYTES),
    maxEvents: upgradedStoredNumber(config.captureLimit, DEFAULT_MAX_EVENTS)
  });
  const gameState = new GameState();
  const helper = {
    version: HELPER_VERSION,
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
