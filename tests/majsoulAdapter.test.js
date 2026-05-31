import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BINARY_SAMPLE_BYTES, DEFAULT_MAX_EVENTS, MajsoulAdapter, summarizeCaptureEvents } from "../src/adapter/majsoulAdapter.js";

const originalWebSocket = globalThis.WebSocket;
const originalCustomEvent = globalThis.CustomEvent;
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
const originalNet = globalThis.net;
const originalLaya = globalThis.Laya;

class TestCustomEvent extends Event {
  constructor(type, options = {}) {
    super(type);
    this.detail = options.detail;
  }
}

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

class OnMessageWebSocket extends FakeWebSocket {
  get onmessage() {
    return this._onmessage || null;
  }

  set onmessage(handler) {
    this._onmessage = handler;
  }

  receive(data) {
    const event = new MessageEvent("message", { data });
    this.dispatchEvent(event);
    if (typeof this._onmessage === "function") this._onmessage.call(this, event);
  }
}

class DescriptorlessWebSocket extends EventTarget {
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

class DataOnMessageWebSocket extends EventTarget {
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

Object.defineProperty(DataOnMessageWebSocket.prototype, "onmessage", {
  configurable: true,
  enumerable: true,
  writable: true,
  value: null
});

class NonConfigOnMessageWebSocket extends FakeWebSocket {}

Object.defineProperty(NonConfigOnMessageWebSocket.prototype, "onmessage", {
  configurable: false,
  enumerable: true,
  get() {
    return this._onmessage || null;
  },
  set(handler) {
    this._onmessage = handler;
  }
});

class ThrowingSendWebSocket extends FakeWebSocket {
  send() {
    throw new Error("native send failed");
  }
}

class ReadonlySendWebSocket extends EventTarget {
  constructor(url = "wss://example.test/socket") {
    super();
    this.url = url;
  }

  receive(data) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

Object.defineProperty(ReadonlySendWebSocket.prototype, "send", {
  configurable: true,
  writable: false,
  value(data) {
    this.lastSent = data;
  }
});

function bytesFromHex(hex) {
  return new Uint8Array(hex.split(/\s+/).filter(Boolean).map((part) => Number.parseInt(part, 16)));
}

async function waitFor(predicate) {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("MajsoulAdapter", () => {
  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    globalThis.CustomEvent = originalCustomEvent;
    if (originalLocationDescriptor) {
      Object.defineProperty(globalThis, "location", originalLocationDescriptor);
    } else {
      delete globalThis.location;
    }
    if (originalNet === undefined) {
      delete globalThis.net;
    } else {
      globalThis.net = originalNet;
    }
    if (originalLaya === undefined) {
      delete globalThis.Laya;
    } else {
      globalThis.Laya = originalLaya;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("records outbound websocket messages without blocking send", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    const events = [];
    adapter.addEventListener("majsoul-helper:event", (event) => events.push(event.detail));
    adapter.install();

    const socket = new WebSocket("wss://example.test/socket");
    socket.send("hello");

    expect(socket.lastSent).toBe("hello");
    expect(events[0]).toMatchObject({
      type: "raw_message",
      source: "ws_out",
      payload: { kind: "text", preview: "hello" }
    });
  });

  it("records WebSocket creation diagnostics without emitting fake raw traffic", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    const socketEvents = [];
    adapter.addEventListener("majsoul-helper:socket", (event) => socketEvents.push(event.detail));
    adapter.install();

    const socket = new WebSocket("wss://example.test/live");

    expect(socket).toBeInstanceOf(FakeWebSocket);
    expect(socketEvents).toHaveLength(1);
    expect(socketEvents[0]).toMatchObject({ url: "wss://example.test/live" });
    expect(adapter.getInstallDiagnostics()).toMatchObject({
      socketsCreated: 1,
      recentSocketUrls: ["wss://example.test/live"],
      hooks: {
        constructor: true,
        prototypeConstructor: "patched",
        send: true,
        addEventListener: true,
        removeEventListener: true,
        onmessage: true,
        onmessageMode: "accessor"
      }
    });
    expect(adapter.getRecentEvents()).toEqual([]);
  });

  it("sanitizes socket urls in diagnostics and capture payloads", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    adapter.install();

    const socket = new WebSocket("wss://example.test/live?accessToken=secret#fragment");
    socket.send("hello");

    const capture = adapter.exportCapture();
    expect(capture.helperDiagnostics.recentSocketUrls).toEqual(["wss://example.test/live"]);
    expect(capture.events[0].payload.url).toBe("wss://example.test/live");
    expect(JSON.stringify(capture)).not.toContain("accessToken=secret");
    expect(JSON.stringify(capture)).not.toContain("#fragment");
  });

  it("reports install diagnostics and allows retry when WebSocket is unavailable at first", () => {
    globalThis.WebSocket = undefined;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();

    expect(adapter.install()).toBe(false);
    expect(adapter.getInstallDiagnostics()).toMatchObject({
      installed: false,
      installAttempts: 1,
      installFailureReason: "WebSocket is not available on this page context yet.",
      webSocketAvailable: false
    });

    globalThis.WebSocket = FakeWebSocket;
    expect(adapter.install()).toBe(true);
    expect(adapter.getInstallDiagnostics()).toMatchObject({
      installed: true,
      installAttempts: 2,
      installFailureReason: "",
      webSocketAvailable: true
    });
    expect(adapter.getInstallDiagnostics().installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("preserves WebSocket constructor static properties on the wrapper", () => {
    class StaticWebSocket extends FakeWebSocket {}
    Object.defineProperty(StaticWebSocket, "CONNECTING", {
      configurable: true,
      enumerable: true,
      value: 0
    });
    Object.defineProperty(StaticWebSocket, "OPEN", {
      configurable: true,
      enumerable: true,
      value: 1
    });
    Object.defineProperty(StaticWebSocket, "customStatic", {
      configurable: true,
      enumerable: false,
      value: () => "static-ok"
    });
    globalThis.WebSocket = StaticWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();

    adapter.install();

    expect(WebSocket).not.toBe(StaticWebSocket);
    expect(WebSocket.OPEN).toBe(1);
    expect(WebSocket.customStatic()).toBe("static-ok");
    expect(Object.getOwnPropertyDescriptor(WebSocket, "OPEN")).toMatchObject({
      enumerable: true,
      value: 1
    });
    const socket = new WebSocket("wss://example.test/socket");
    expect(socket).toBeInstanceOf(WebSocket);
    expect(socket).toBeInstanceOf(StaticWebSocket);
    expect(socket.constructor).toBe(WebSocket);
    expect(adapter.getInstallDiagnostics().hooks.constructorStatics).toEqual({
      copied: 3,
      failed: []
    });
    expect(adapter.getInstallDiagnostics().hooks.prototypeConstructor).toBe("patched");

    adapter.uninstall();

    const restoredSocket = new WebSocket("wss://example.test/socket");
    expect(WebSocket).toBe(StaticWebSocket);
    expect(restoredSocket.constructor).toBe(StaticWebSocket);
  });

  it("preserves subclass construction through the wrapped WebSocket constructor", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    const socketEvents = [];
    adapter.addEventListener("majsoul-helper:socket", (event) => socketEvents.push(event.detail));
    adapter.install();

    class DerivedSocket extends WebSocket {
      constructor(url) {
        super(url);
        this.derived = true;
      }
    }

    const socket = new DerivedSocket("wss://example.test/derived");

    expect(socket).toBeInstanceOf(DerivedSocket);
    expect(socket).toBeInstanceOf(WebSocket);
    expect(socket).toBeInstanceOf(FakeWebSocket);
    expect(socket.constructor).toBe(DerivedSocket);
    expect(socket.derived).toBe(true);
    expect(socketEvents[0]).toMatchObject({ url: "wss://example.test/derived" });
  });

  it("preserves constructor call behavior when WebSocket is called without new", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    adapter.install();

    expect(() => WebSocket("wss://example.test/no-new")).toThrow(/class constructor|cannot be invoked without 'new'/i);
    expect(adapter.getInstallDiagnostics().socketsCreated).toBe(0);
  });

  it("restores the original WebSocket prototype even if the global constructor changes later", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const originalSend = FakeWebSocket.prototype.send;
    const originalAddEventListener = FakeWebSocket.prototype.addEventListener;
    const originalRemoveEventListener = FakeWebSocket.prototype.removeEventListener;
    const adapter = new MajsoulAdapter();

    adapter.install();

    expect(FakeWebSocket.prototype.send).not.toBe(originalSend);
    globalThis.WebSocket = class ReplacementWebSocket extends FakeWebSocket {};
    adapter.uninstall();

    expect(globalThis.WebSocket).toBe(FakeWebSocket);
    expect(FakeWebSocket.prototype.send).toBe(originalSend);
    expect(FakeWebSocket.prototype.addEventListener).toBe(originalAddEventListener);
    expect(FakeWebSocket.prototype.removeEventListener).toBe(originalRemoveEventListener);
  });

  it("rolls back partial hooks and reports diagnostics when install fails", () => {
    globalThis.WebSocket = ReadonlySendWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    const installEvents = [];
    adapter.addEventListener("majsoul-helper:install", (event) => installEvents.push(event.detail));

    expect(adapter.install()).toBe(false);

    expect(globalThis.WebSocket).toBe(ReadonlySendWebSocket);
    expect(adapter.getInstallDiagnostics()).toMatchObject({
      installed: false,
      installedAt: null,
      webSocketAvailable: true,
      hooks: {
        constructor: false,
        prototypeConstructor: "not-installed",
        send: false,
        addEventListener: false,
        removeEventListener: false,
        onmessage: false,
        onmessageMode: "not-installed"
      }
    });
    expect(adapter.getInstallDiagnostics().installFailureReason).toContain("WebSocket hook install failed");
    expect(installEvents.at(-1)).toMatchObject({
      installed: false,
      webSocketAvailable: true
    });
  });

  it("passes outbound payloads through unchanged", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    adapter.install();

    const payload = new Uint8Array([1, 2, 3]);
    const socket = new WebSocket("wss://example.test/socket");
    socket.send(payload);

    expect(socket.lastSent).toBe(payload);
  });

  it("does not let capture failures block outbound sends", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    adapter.install();
    vi.spyOn(adapter, "recordRaw").mockImplementation(() => {
      throw new Error("capture failed");
    });

    const socket = new WebSocket("wss://example.test/socket");

    expect(() => socket.send("must-send")).not.toThrow();
    expect(socket.lastSent).toBe("must-send");
    expect(adapter.getRecentEvents()[0]).toMatchObject({
      type: "capture_error",
      source: "ws_out",
      payload: {
        message: "capture failed"
      }
    });
  });

  it("does not record outbound messages that native send rejected", () => {
    globalThis.WebSocket = ThrowingSendWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    adapter.install();

    const socket = new WebSocket("wss://example.test/socket");

    expect(() => socket.send("not-sent")).toThrow("native send failed");
    expect(adapter.getRecentEvents()).toEqual([]);
  });

  it("exports pause diagnostics and suppresses capture while paused", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    const configEvents = [];
    adapter.addEventListener("majsoul-helper:config", (event) => configEvents.push(event.detail));
    adapter.install();

    const socket = new WebSocket("wss://example.test/socket");

    expect(adapter.setPaused(true)).toBe(true);
    socket.send("paused-outbound");

    expect(adapter.getRecentEvents()).toEqual([]);
    expect(configEvents.at(-1)).toMatchObject({ paused: true });
    expect(adapter.exportCapture().helperDiagnostics.paused).toBe(true);

    expect(adapter.setPaused(false)).toBe(false);
    socket.send("running-outbound");

    expect(adapter.getRecentEvents()).toHaveLength(1);
    expect(configEvents.at(-1)).toMatchObject({ paused: false });
    expect(adapter.exportCapture().helperDiagnostics.paused).toBe(false);
  });

  it("records inbound messages and emits parsed standardized events when JSON is readable", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    const events = [];
    adapter.addEventListener("majsoul-helper:event", (event) => events.push(event.detail));
    adapter.install();

    const socket = new WebSocket("wss://example.test/socket");
    socket.addEventListener("message", () => {});
    socket.receive(JSON.stringify({ name: ".lq.ActionDiscardTile", data: { seat: 2, tile: "9s" } }));

    expect(events.map((event) => event.type)).toEqual(["raw_message", "discard_tile"]);
    expect(events.map((event) => event.eventId)).toEqual([1, 2]);
    expect(adapter.getRecentEvents().map((event) => event.eventId)).toEqual([2, 1]);
    expect(events[1]).toMatchObject({
      source: "ws_in",
      payload: { seat: 2, tile: "9s" }
    });
  });

  it("passively records client-decoded MessageWrapper actions", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const decodedMessage = {
      name: ".lq.ActionPrototype",
      data: {
        name: "ActionDealTile",
        step: 14,
        data: { seat: 0, tile: "5p", left_tile_count: 43, doras: ["1z"] }
      }
    };
    globalThis.net = {
      MessageWrapper: {
        decodeMessage(data) {
          return { ...decodedMessage, originalInputLength: data.length };
        }
      }
    };
    const adapter = new MajsoulAdapter();
    const events = [];
    adapter.addEventListener("majsoul-helper:event", (event) => events.push(event.detail));
    adapter.install();

    const result = globalThis.net.MessageWrapper.decodeMessage(new Uint8Array([1, 2, 3]));

    expect(result.originalInputLength).toBe(3);
    expect(events.map((event) => event.type)).toEqual(["decoded_message", "draw_tile"]);
    expect(events[0]).toMatchObject({
      type: "decoded_message",
      source: "client_decode",
      payload: {
        hook: "net.MessageWrapper.decodeMessage",
        name: ".lq.ActionPrototype",
        actionName: "ActionDealTile",
        parsedTypes: ["draw_tile"]
      }
    });
    expect(events[1]).toMatchObject({
      type: "draw_tile",
      source: "client_decode",
      payload: {
        seat: 0,
        tile: "5p",
        leftTileCount: 43,
        doraIndicators: ["1z"],
        binaryEnvelope: {
          methodName: ".lq.ActionPrototype",
          actionName: "ActionDealTile",
          step: 14,
          decodedSource: "client"
        }
      }
    });
    expect(adapter.getInstallDiagnostics().hooks).toMatchObject({
      decodedMessage: true,
      decodedMessageMode: "net.MessageWrapper.decodeMessage"
    });
  });

  it("retries the decoded MessageWrapper hook when net loads after install", () => {
    vi.useFakeTimers();
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    delete globalThis.net;
    const adapter = new MajsoulAdapter();
    adapter.install();

    expect(adapter.getInstallDiagnostics().hooks).toMatchObject({
      decodedMessage: false,
      decodedMessageFailureReason: "net.MessageWrapper is not available yet."
    });

    globalThis.net = {
      MessageWrapper: {
        decodeMessage() {
          return { name: "ActionDiscardTile", data: { seat: 1, tile: "7s" } };
        }
      }
    };
    vi.advanceTimersByTime(250);
    globalThis.net.MessageWrapper.decodeMessage(new Uint8Array([1]));

    expect(adapter.getRecentEvents()[0]).toMatchObject({
      type: "discard_tile",
      source: "client_decode",
      payload: { seat: 1, tile: "7s" }
    });
    adapter.uninstall();
  });

  it("passively records page-dispatched decoded Laya events without recording unrelated UI events", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    class FakeEventDispatcher {
      event(type, data, ...args) {
        this.lastNativeEvent = { type, data, args };
        return "native-result";
      }
    }
    globalThis.Laya = { EventDispatcher: FakeEventDispatcher };
    const adapter = new MajsoulAdapter();
    const events = [];
    adapter.addEventListener("majsoul-helper:event", (event) => events.push(event.detail));
    adapter.install();

    const dispatcher = new globalThis.Laya.EventDispatcher();
    expect(dispatcher.event("OnNotify", {
      name: "ActionDealTile",
      data: { seat: 0, tile: "2m", leftTileCount: 42 }
    }, "extra")).toBe("native-result");
    dispatcher.event("display", { visible: true });

    expect(dispatcher.lastNativeEvent).toMatchObject({
      type: "display",
      data: { visible: true }
    });
    expect(events.map((event) => event.type)).toEqual(["decoded_message", "draw_tile"]);
    expect(events[0]).toMatchObject({
      type: "decoded_message",
      source: "client_decode",
      payload: {
        hook: "Laya.EventDispatcher.event",
        name: "ActionDealTile",
        parsedTypes: ["draw_tile"]
      }
    });
    expect(events[1]).toMatchObject({
      type: "draw_tile",
      source: "client_decode",
      payload: {
        seat: 0,
        tile: "2m",
        leftTileCount: 42
      }
    });
    expect(adapter.getInstallDiagnostics().hooks).toMatchObject({
      decodedDispatcher: true,
      decodedDispatcherMode: "Laya.EventDispatcher.event"
    });
    adapter.uninstall();
  });

  it("deduplicates the same inbound message observed through multiple handlers", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter({ dedupeMs: 1000 });
    const events = [];
    adapter.addEventListener("majsoul-helper:event", (event) => events.push(event.detail));
    adapter.install();

    const socket = new WebSocket("wss://example.test/socket");
    socket.addEventListener("message", () => {});
    socket.onmessage = () => {};
    socket.receive("duplicate");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "raw_message",
      source: "ws_in",
      payload: { preview: "duplicate" }
    });
  });

  it("does not let capture failures block inbound message listeners", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    const listener = vi.fn();
    adapter.install();
    vi.spyOn(adapter, "recordRaw").mockImplementation(() => {
      throw new Error("capture failed");
    });

    const socket = new WebSocket("wss://example.test/socket");
    socket.addEventListener("message", listener);
    socket.receive("must-deliver");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].data).toBe("must-deliver");
    expect(adapter.getRecentEvents()[0]).toMatchObject({
      type: "capture_error",
      source: "ws_in",
      payload: {
        message: "capture failed"
      }
    });
  });

  it("keeps repeated outbound messages with identical payloads in the capture", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter({ dedupeMs: 1000 });
    adapter.install();

    const socket = new WebSocket("wss://example.test/socket");
    socket.send("repeat");
    socket.send("repeat");

    expect(adapter.getRecentEvents()).toHaveLength(2);
    expect(adapter.getRecentEvents().map((event) => event.payload.preview)).toEqual(["repeat", "repeat"]);
  });

  it("keeps repeated inbound messages when they are separate MessageEvents", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter({ dedupeMs: 1000 });
    adapter.install();

    const socket = new WebSocket("wss://example.test/socket");
    socket.addEventListener("message", () => {});
    socket.receive("repeat-inbound");
    socket.receive("repeat-inbound");

    expect(adapter.getRecentEvents()).toHaveLength(2);
    expect(adapter.getRecentEvents().map((event) => event.payload.preview)).toEqual(["repeat-inbound", "repeat-inbound"]);
  });

  it("preserves removeEventListener behavior for wrapped message listeners", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    const events = [];
    const listener = vi.fn();
    adapter.addEventListener("majsoul-helper:event", (event) => events.push(event.detail));
    adapter.install();

    const socket = new WebSocket("wss://example.test/socket");
    socket.addEventListener("message", listener);
    socket.removeEventListener("message", listener);
    socket.receive("removed");

    expect(listener).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("preserves native duplicate listener registration behavior", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    const events = [];
    const listener = vi.fn();
    adapter.addEventListener("majsoul-helper:event", (event) => events.push(event.detail));
    adapter.install();

    const socket = new WebSocket("wss://example.test/socket");
    socket.addEventListener("message", listener);
    socket.addEventListener("message", listener);
    socket.receive("single-callback");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "raw_message",
      source: "ws_in",
      payload: { preview: "single-callback" }
    });

    adapter.clearEvents();
    listener.mockClear();
    socket.removeEventListener("message", listener);
    socket.receive("after-remove");

    expect(listener).not.toHaveBeenCalled();
    expect(adapter.getRecentEvents()).toEqual([]);
  });

  it("records inbound messages for handleEvent listener objects and preserves removal", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    const events = [];
    const listener = { handleEvent: vi.fn() };
    adapter.addEventListener("majsoul-helper:event", (event) => events.push(event.detail));
    adapter.install();

    const socket = new WebSocket("wss://example.test/socket");
    socket.addEventListener("message", listener);
    socket.receive("object-listener");

    expect(listener.handleEvent).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "raw_message",
      source: "ws_in",
      payload: { preview: "object-listener" }
    });

    adapter.clearEvents();
    listener.handleEvent.mockClear();
    socket.removeEventListener("message", listener);
    socket.receive("removed-object-listener");

    expect(listener.handleEvent).not.toHaveBeenCalled();
    expect(adapter.getRecentEvents()).toEqual([]);
  });

  it("records inbound messages from the onmessage property handler", () => {
    globalThis.WebSocket = OnMessageWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    const events = [];
    const listener = vi.fn();
    adapter.addEventListener("majsoul-helper:event", (event) => events.push(event.detail));
    adapter.install();

    const socket = new WebSocket("wss://example.test/socket");
    socket.onmessage = listener;
    expect(socket.onmessage).toBe(listener);
    socket.receive("from-onmessage");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "raw_message",
      source: "ws_in",
      payload: { preview: "from-onmessage" }
    });

    adapter.clearEvents();
    listener.mockClear();
    socket.onmessage = null;
    socket.receive("after-null-onmessage");

    expect(socket.onmessage).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    expect(adapter.getRecentEvents()).toEqual([]);
  });

  it("falls back to an onmessage property hook when the prototype has no native descriptor", () => {
    globalThis.WebSocket = DescriptorlessWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    const events = [];
    const listener = vi.fn();
    adapter.addEventListener("majsoul-helper:event", (event) => events.push(event.detail));
    adapter.install();

    const socket = new WebSocket("wss://example.test/socket");
    socket.onmessage = listener;
    socket.receive("fallback-onmessage");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(socket.onmessage).toBe(listener);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "raw_message",
      source: "ws_in",
      payload: { preview: "fallback-onmessage" }
    });

    adapter.clearEvents();
    listener.mockClear();
    socket.onmessage = null;
    socket.receive("after-null");

    expect(socket.onmessage).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    expect(adapter.getRecentEvents()).toEqual([]);
  });

  it("falls back when onmessage is a configurable data descriptor", () => {
    globalThis.WebSocket = DataOnMessageWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    const events = [];
    const listener = vi.fn();
    adapter.addEventListener("majsoul-helper:event", (event) => events.push(event.detail));
    adapter.install();

    const socket = new WebSocket("wss://example.test/socket");
    socket.onmessage = listener;
    socket.receive("data-descriptor-onmessage");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(socket.onmessage).toBe(listener);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "raw_message",
      source: "ws_in",
      payload: { preview: "data-descriptor-onmessage" }
    });
    expect(adapter.getInstallDiagnostics().hooks).toMatchObject({
      onmessage: true,
      onmessageMode: "data-descriptor-fallback"
    });
  });

  it("reports when onmessage cannot be patched because the descriptor is non-configurable", () => {
    globalThis.WebSocket = NonConfigOnMessageWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    adapter.install();

    expect(adapter.getInstallDiagnostics().hooks).toMatchObject({
      constructor: true,
      send: true,
      addEventListener: true,
      removeEventListener: true,
      onmessage: false,
      onmessageMode: "non-configurable"
    });
  });

  it("samples and parses inbound Blob messages without changing socket binaryType", async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    const events = [];
    adapter.addEventListener("majsoul-helper:event", (event) => events.push(event.detail));
    adapter.install();

    const socket = new WebSocket("wss://example.test/socket");
    socket.binaryType = "blob";
    socket.addEventListener("message", () => {});
    socket.receive(new Blob([bytesFromHex(
      "01 0a 13 2e 6c 71 2e 41 63 74 69 6f 6e 50 72 6f 74 6f 74 79 70 65 12 1f 08 35 12 11 41 63 74 69 6f 6e 44 69 73 63 61 72 64 54 69 6c 65 1a 08 08 03 12 02 39 73 18 01"
    )]));

    await waitFor(() => events.some((event) => event.type === "discard_tile"));

    expect(socket.binaryType).toBe("blob");
    expect(events.map((event) => event.type)).toEqual(["raw_message", "raw_message", "discard_tile"]);
    expect(events[0].payload).toMatchObject({
      kind: "blob",
      sample: "",
      truncated: false,
      asyncSamplePending: true,
      sampleUnavailableReason: "blob-async"
    });
    expect(events[1].payload).toMatchObject({
      asyncSampleFor: "blob-async",
      kind: "blob-arraybuffer",
      envelope: {
        methodName: ".lq.ActionPrototype",
        actionName: "ActionDiscardTile"
      }
    });
    expect(events[2]).toMatchObject({
      type: "discard_tile",
      payload: { seat: 3, tile: "9s" }
    });
  });

  it("exports capture samples for protocol mapping", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: {
        origin: "https://game.maj-soul.com",
        host: "game.maj-soul.com",
        pathname: "/1/",
        href: "https://game.maj-soul.com/1/?token=secret#debug"
      }
    });
    const adapter = new MajsoulAdapter({ binarySampleBytes: 1024 });
    adapter.install();

    const socket = new WebSocket("wss://example.test/socket");
    socket.send(new Uint8Array([1, 2, 10, 255]));

    const capture = adapter.exportCapture();
    expect(capture.formatVersion).toBe(1);
    expect(capture.page).toEqual({
      origin: "https://game.maj-soul.com",
      host: "game.maj-soul.com",
      pathname: "/1/",
      sanitizedUrl: "https://game.maj-soul.com/1/"
    });
    expect(JSON.stringify(capture.page)).not.toContain("token=secret");
    expect(JSON.stringify(capture.page)).not.toContain("#debug");
    expect(capture.helperDiagnostics).toMatchObject({
      installed: true,
      installAttempts: 1,
      webSocketAvailable: true,
      hooks: {
        constructor: true,
        send: true,
        addEventListener: true,
        removeEventListener: true,
        onmessage: true
      },
      binarySampleBytes: 1024,
      maxEvents: DEFAULT_MAX_EVENTS
    });
    expect(capture.events[0]).toMatchObject({
      type: "raw_message",
      payload: {
        kind: "Uint8Array",
        sample: "01 02 0a ff",
        truncated: false,
        envelope: {
          frameType: 1,
          frameTypeName: "Notify"
        }
      }
    });
    expect(capture.summary).toMatchObject({
      totalEvents: 1,
      rawMessages: 1,
      byKind: { Uint8Array: 1 }
    });
  });

  it("uses a larger bounded default binary capture sample", () => {
    const bytes = new Uint8Array(3000).map((_, index) => index % 256);
    const adapter = new MajsoulAdapter();
    adapter.recordRaw("ws_in", bytes, "wss://example.test/socket");

    const event = adapter.getRecentEvents()[0];
    expect(DEFAULT_BINARY_SAMPLE_BYTES).toBe(2048);
    expect(event.payload.sample.split(" ")).toHaveLength(2048);
    expect(event.payload.truncated).toBe(true);
  });

  it("allows binary capture sample length to be configured", () => {
    const bytes = new Uint8Array(80).map((_, index) => index);
    const adapter = new MajsoulAdapter({ binarySampleBytes: 32 });
    adapter.recordRaw("ws_in", bytes, "wss://example.test/socket");

    const event = adapter.getRecentEvents()[0];
    expect(event.payload.sample.split(" ")).toHaveLength(32);
    expect(event.payload.truncated).toBe(true);
  });

  it("allows binary capture sample length to be updated for later messages", () => {
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter({ binarySampleBytes: 32 });
    const configEvents = [];
    adapter.addEventListener("majsoul-helper:config", (event) => configEvents.push(event.detail));

    expect(adapter.setBinarySampleBytes(64)).toBe(64);
    adapter.recordRaw("ws_in", new Uint8Array(80).map((_, index) => index), "wss://example.test/socket");

    const event = adapter.getRecentEvents()[0];
    expect(event.payload.sample.split(" ")).toHaveLength(64);
    expect(event.payload.truncated).toBe(true);
    expect(configEvents[0]).toMatchObject({ binarySampleBytes: 64 });
  });

  it("exports only the requested number of recent capture events", () => {
    const adapter = new MajsoulAdapter();
    adapter.events = [
      { type: "raw_message", source: "ws_in", ts: 3, payload: { kind: "text", preview: "latest" } },
      { type: "raw_message", source: "ws_in", ts: 2, payload: { kind: "text", preview: "middle" } },
      { type: "raw_message", source: "ws_in", ts: 1, payload: { kind: "text", preview: "oldest" } }
    ];

    const capture = adapter.exportCapture({ limit: 2 });
    expect(capture.limit).toBe(2);
    expect(capture.events.map((event) => event.payload.preview)).toEqual(["latest", "middle"]);
    expect(capture.summary.totalEvents).toBe(2);
  });

  it("exports event buffer diagnostics and resets them after clearing debug events", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter({ maxEvents: 2 });
    adapter.install();
    const socket = new WebSocket("wss://example.test/socket");

    socket.send("one");
    socket.send("two");
    socket.send("three");

    const capture = adapter.exportCapture();
    expect(capture.events.map((event) => event.eventId)).toEqual([3, 2]);
    expect(capture.helperDiagnostics.eventBuffer).toEqual({
      maxEvents: 2,
      retainedEvents: 2,
      totalEventsSinceClear: 3,
      oldestEventId: 2,
      newestEventId: 3,
      droppedBeforeRetained: 1
    });

    adapter.clearEvents();
    socket.send("fresh");

    expect(adapter.exportCapture().helperDiagnostics.eventBuffer).toEqual({
      maxEvents: 2,
      retainedEvents: 1,
      totalEventsSinceClear: 1,
      oldestEventId: 1,
      newestEventId: 1,
      droppedBeforeRetained: 0
    });
  });

  it("updates the retained event buffer when max events changes", () => {
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter({ maxEvents: 3 });
    const configEvents = [];
    adapter.addEventListener("majsoul-helper:config", (event) => configEvents.push(event.detail));
    adapter.events = [
      { type: "raw_message", source: "ws_in", ts: 5, payload: { kind: "text", preview: "5" } },
      { type: "raw_message", source: "ws_in", ts: 4, payload: { kind: "text", preview: "4" } },
      { type: "raw_message", source: "ws_in", ts: 3, payload: { kind: "text", preview: "3" } }
    ];

    expect(adapter.setMaxEvents(2)).toBe(2);
    expect(adapter.getRecentEvents().map((event) => event.payload.preview)).toEqual(["5", "4"]);
    expect(configEvents[0]).toMatchObject({ maxEvents: 2 });

    expect(adapter.setMaxEvents(500)).toBe(500);
    adapter.events = Array.from({ length: 600 }, (_, index) => ({
      type: "raw_message",
      source: "ws_in",
      ts: 600 - index,
      payload: { kind: "text", preview: String(index) }
    }));
    const capture = adapter.exportCapture({ limit: 600 });

    expect(capture.limit).toBe(500);
    expect(capture.events).toHaveLength(500);
  });

  it("summarizes raw and parsed capture events by method/action/type", () => {
    const summary = summarizeCaptureEvents([
      {
        type: "raw_message",
        source: "ws_in",
        payload: {
          kind: "blob-arraybuffer",
          envelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" }
        }
      },
      {
        type: "discard_tile",
        source: "ws_in",
        payload: {
          binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" }
        }
      }
    ]);

    expect(summary).toEqual({
      totalEvents: 2,
      rawMessages: 1,
      parsedEvents: 1,
      diagnosticEvents: 0,
      bySource: { ws_in: 2 },
      byKind: { "blob-arraybuffer": 1 },
      byMethodName: { ".lq.ActionPrototype": 2 },
      byActionName: { ActionDiscardTile: 2 },
      byParsedType: { discard_tile: 1 },
      byDiagnosticType: {},
      byUnparsedActionName: {}
    });
  });

  it("summarizes helper diagnostics separately from parsed game events", () => {
    const summary = summarizeCaptureEvents([
      {
        type: "capture_error",
        source: "ws_in",
        payload: { message: "capture failed" }
      }
    ]);

    expect(summary).toMatchObject({
      totalEvents: 1,
      rawMessages: 0,
      parsedEvents: 0,
      diagnosticEvents: 1,
      bySource: { ws_in: 1 },
      byParsedType: {},
      byDiagnosticType: { capture_error: 1 }
    });
  });

  it("summarizes ActionPrototype names that did not parse into standard events", () => {
    const summary = summarizeCaptureEvents([
      {
        type: "raw_message",
        source: "ws_in",
        payload: {
          kind: "Uint8Array",
          envelope: { methodName: ".lq.ActionPrototype", actionName: "ActionUnknownLive" }
        }
      },
      {
        type: "raw_message",
        source: "ws_in",
        payload: {
          kind: "Uint8Array",
          envelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" }
        }
      },
      {
        type: "discard_tile",
        source: "ws_in",
        payload: {
          binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" }
        }
      }
    ]);

    expect(summary.byUnparsedActionName).toEqual({ ActionUnknownLive: 1 });
  });

  it("clears recorded debug events without uninstalling hooks", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    let cleared = false;
    adapter.addEventListener("majsoul-helper:clear", () => {
      cleared = true;
    });
    adapter.install();

    const socket = new WebSocket("wss://example.test/socket");
    socket.send("before-clear");
    expect(adapter.getRecentEvents()).toHaveLength(1);

    adapter.clearEvents();
    expect(cleared).toBe(true);
    expect(adapter.getRecentEvents()).toEqual([]);

    socket.send("after-clear");
    expect(adapter.getRecentEvents()).toHaveLength(1);
  });

  it("runs a local parser self-test without recording fake traffic", () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.CustomEvent = TestCustomEvent;
    const adapter = new MajsoulAdapter();
    const selfTestEvents = [];
    adapter.addEventListener("majsoul-helper:self-test", (event) => selfTestEvents.push(event.detail));
    adapter.install();

    const result = adapter.runSelfTest();

    expect(result).toMatchObject({
      ok: true,
      installed: true,
      webSocketAvailable: true,
      readableParsedTypes: ["draw_tile"],
      binaryEnvelope: {
        methodName: ".lq.ActionPrototype",
        actionName: "ActionDiscardTile"
      },
      binaryParsedTypes: ["discard_tile"]
    });
    expect(selfTestEvents).toEqual([result]);
    expect(adapter.getRecentEvents()).toEqual([]);
  });
});
