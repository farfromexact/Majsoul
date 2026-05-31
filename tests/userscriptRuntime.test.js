// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeWebSocket extends EventTarget {
  constructor(url = "wss://example.test/socket") {
    super();
    this.url = url;
  }

  send(data) {
    this.lastSent = data;
  }

  receive(data) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

describe("built userscript runtime", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head></head><body></body>";
    window.localStorage.clear();
    window.WebSocket = FakeWebSocket;
    delete window.__majsoulHelper;
    delete window.net;
    delete window.Laya;
  });

  afterEach(() => {
    window.__majsoulHelper?.adapter?.uninstall?.();
    vi.useRealTimers();
  });

  it("boots the generated userscript, mounts overlay, and hooks page WebSocket", () => {
    const userscript = readFileSync("majsoul-helper.user.js", "utf8");
    window.eval(userscript);

    expect(window.__majsoulHelper).toBeTruthy();
    expect(window.__majsoulHelper.version).toBe("0.2.0");
    expect(document.querySelector(".mh-title").textContent).toContain("v0.2.0");
    expect(window.__majsoulHelper.adapter.getInstallDiagnostics().maxEvents).toBe(500);
    expect(window.__majsoulHelper.adapter.getInstallDiagnostics().binarySampleBytes).toBe(2048);
    expect(document.querySelector("#majsoul-helper-overlay")).toBeTruthy();
    expect(document.querySelector('[data-role="capture-limit"]').value).toBe("500");
    expect(document.querySelector('[data-role="binary-sample-bytes"]').value).toBe("2048");

    const socket = new window.WebSocket("wss://example.test/socket");
    socket.send("hello");
    socket.addEventListener("message", () => {});
    socket.receive(JSON.stringify({ name: ".lq.ActionDiscardTile", data: { seat: 1, tile: "3m" } }));

    const events = window.__majsoulHelper.adapter.getRecentEvents();
    expect(events.map((event) => event.type)).toEqual(["discard_tile", "raw_message", "raw_message"]);
    expect(events[0]).toMatchObject({
      type: "discard_tile",
      source: "ws_in",
      payload: { seat: 1, tile: "3m" }
    });
  });

  it("does not double boot when the userscript is injected twice on the same page", () => {
    const userscript = readFileSync("majsoul-helper.user.js", "utf8");
    window.eval(userscript);
    const helper = window.__majsoulHelper;

    window.eval(userscript);

    expect(window.__majsoulHelper).toBe(helper);
    expect(document.querySelectorAll("#majsoul-helper-overlay")).toHaveLength(1);

    const socket = new window.WebSocket("wss://example.test/socket");
    socket.send("hello");
    expect(helper.adapter.getRecentEvents()).toHaveLength(1);
  });

  it("sets the helper singleton before the DOM is ready", () => {
    const originalDocumentElement = document.documentElement;
    Object.defineProperty(document, "documentElement", {
      configurable: true,
      get: () => null
    });
    try {
      const userscript = readFileSync("majsoul-helper.user.js", "utf8");

      window.eval(userscript);
      const helper = window.__majsoulHelper;
      window.eval(userscript);

      expect(window.__majsoulHelper).toBe(helper);
      expect(helper.overlay).toBe(null);
      expect(document.querySelectorAll("#majsoul-helper-overlay")).toHaveLength(0);

      Object.defineProperty(document, "documentElement", {
        configurable: true,
        get: () => originalDocumentElement
      });
      document.dispatchEvent(new Event("DOMContentLoaded"));

      expect(helper.overlay).toBeTruthy();
      expect(document.querySelectorAll("#majsoul-helper-overlay")).toHaveLength(1);

      const socket = new window.WebSocket("wss://example.test/socket");
      socket.send("hello");
      expect(helper.adapter.getRecentEvents()).toHaveLength(1);
    } finally {
      delete document.documentElement;
    }
  });

  it("retries WebSocket hook installation when WebSocket is unavailable at document-start", () => {
    vi.useFakeTimers();
    const userscript = readFileSync("majsoul-helper.user.js", "utf8");
    window.WebSocket = undefined;

    window.eval(userscript);
    expect(window.__majsoulHelper.adapter.getInstallDiagnostics()).toMatchObject({
      installed: false,
      installAttempts: 1,
      webSocketAvailable: false
    });

    window.WebSocket = FakeWebSocket;
    vi.advanceTimersByTime(250);

    expect(window.__majsoulHelper.adapter.getInstallDiagnostics()).toMatchObject({
      installed: true,
      installAttempts: 2,
      webSocketAvailable: true
    });
    expect(document.querySelector('[data-role="install-diagnostics"]').textContent).toContain("Install: installed");
  });

  it("boots generated userscript with stored capture configuration", () => {
    window.localStorage.setItem("majsoul-helper-config", JSON.stringify({ binarySampleBytes: 1024, captureLimit: 500 }));
    const userscript = readFileSync("majsoul-helper.user.js", "utf8");

    window.eval(userscript);

    expect(window.__majsoulHelper.adapter.getInstallDiagnostics()).toMatchObject({
      binarySampleBytes: 1024,
      maxEvents: 500
    });
    expect(document.querySelector('[data-role="binary-sample-bytes"]').value).toBe("1024");
    expect(document.querySelector('[data-role="capture-limit"]').value).toBe("500");
  });

  it("records page-decoded MessageWrapper events in the generated userscript", () => {
    window.net = {
      MessageWrapper: {
        decodeMessage() {
          return {
            name: ".lq.ActionPrototype",
            data: {
              name: "ActionDiscardTile",
              step: 9,
              data: { seat: 2, tile: "8p" }
            }
          };
        }
      }
    };
    const userscript = readFileSync("majsoul-helper.user.js", "utf8");

    window.eval(userscript);
    window.net.MessageWrapper.decodeMessage(new Uint8Array([1]));

    const events = window.__majsoulHelper.adapter.getRecentEvents();
    expect(events[0]).toMatchObject({
      type: "discard_tile",
      source: "client_decode",
      payload: { seat: 2, tile: "8p" }
    });
    expect(window.__majsoulHelper.adapter.getInstallDiagnostics().hooks.decodedMessage).toBe(true);
  });

  it("records page-dispatched Laya decoded events in the generated userscript", () => {
    class FakeEventDispatcher {
      event(type, data) {
        this.lastEvent = { type, data };
        return "ok";
      }
    }
    window.Laya = { EventDispatcher: FakeEventDispatcher };
    const userscript = readFileSync("majsoul-helper.user.js", "utf8");

    window.eval(userscript);
    const dispatcher = new window.Laya.EventDispatcher();
    dispatcher.event("OnNotify", {
      name: "ActionDealTile",
      data: { seat: 0, tile: "4m", leftTileCount: 34 }
    });
    dispatcher.event("display", { visible: true });

    const events = window.__majsoulHelper.adapter.getRecentEvents();
    expect(events.map((event) => event.type)).toEqual(["draw_tile", "decoded_message"]);
    expect(events[0]).toMatchObject({
      type: "draw_tile",
      source: "client_decode",
      payload: { seat: 0, tile: "4m", leftTileCount: 34 }
    });
    expect(window.__majsoulHelper.adapter.getInstallDiagnostics().hooks.decodedDispatcher).toBe(true);
    expect(document.querySelector('[data-role="install-diagnostics"]').textContent).toContain("page dispatch hooked");
  });

  it("runs the generated userscript self-test without recording fake traffic", () => {
    const userscript = readFileSync("majsoul-helper.user.js", "utf8");
    window.eval(userscript);

    document.querySelector('[data-action="self-test"]').click();

    expect(document.querySelector('[data-role="self-test-result"]').textContent).toContain("Self-test: ok");
    expect(document.querySelector('[data-role="self-test-result"]').textContent).toContain("ActionDiscardTile -> discard_tile");
    expect(window.__majsoulHelper.adapter.getRecentEvents()).toEqual([]);
    expect(window.__majsoulHelper.gameState.getVisibleState().events).toEqual([]);
  });
});
