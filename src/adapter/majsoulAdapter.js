import { parseBinaryEnvelope, parseBinaryMessage, parseReadableMessage } from "./messageParser.js";
import { isStandardGameEvent } from "../core/events.js";

const DEFAULT_BINARY_SAMPLE_BYTES = 2048;
const DEFAULT_MAX_EVENTS = 500;
const SELF_TEST_DISCARD_SAMPLE =
  "01 0a 13 2e 6c 71 2e 41 63 74 69 6f 6e 50 72 6f 74 6f 74 79 70 65 12 1f 08 35 12 11 41 63 74 69 6f 6e 44 69 73 63 61 72 64 54 69 6c 65 1a 08 08 03 12 02 39 73 28 01";

function createHookDiagnostics() {
  return {
    constructor: false,
    constructorStatics: {
      copied: 0,
      failed: []
    },
    prototypeConstructor: "not-installed",
    send: false,
    addEventListener: false,
    removeEventListener: false,
    onmessage: false,
    onmessageMode: "not-installed"
  };
}

function copyConstructorStatics(target, source) {
  const result = { copied: 0, failed: [] };
  const skippedKeys = new Set(["prototype", "length", "name"]);
  for (const key of Reflect.ownKeys(source)) {
    if (skippedKeys.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor) continue;
    try {
      Object.defineProperty(target, key, descriptor);
      result.copied += 1;
    } catch {
      result.failed.push(String(key));
    }
  }
  return result;
}

function patchPrototypeConstructor(prototype, constructor, restoreFns) {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "constructor");
  try {
    Object.defineProperty(prototype, "constructor", {
      configurable: true,
      writable: true,
      value: constructor
    });
    restoreFns.push(() => {
      if (descriptor) {
        Object.defineProperty(prototype, "constructor", descriptor);
      } else {
        delete prototype.constructor;
      }
    });
    return "patched";
  } catch (error) {
    return `failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function getPageDiagnostics() {
  const location = globalThis.location;
  if (!location) {
    return {
      origin: "",
      host: "",
      pathname: "",
      sanitizedUrl: ""
    };
  }
  const origin = String(location.origin || "");
  const host = String(location.host || "");
  const pathname = String(location.pathname || "");
  return {
    origin,
    host,
    pathname,
    sanitizedUrl: `${origin}${pathname}`
  };
}

function sanitizeUrl(value = "") {
  const raw = String(value || "");
  if (!raw) return "";
  try {
    const url = new URL(raw, globalThis.location?.href || undefined);
    return `${url.origin}${url.pathname}`;
  } catch {
    return raw.split("#")[0].split("?")[0];
  }
}

function summarizeMessage(data, { binarySampleBytes = DEFAULT_BINARY_SAMPLE_BYTES } = {}) {
  if (typeof data === "string") {
    return {
      kind: "text",
      length: data.length,
      preview: data.slice(0, 240),
      sample: data.slice(0, 4000),
      truncated: data.length > 4000
    };
  }
  if (data instanceof ArrayBuffer) {
    const sampleLength = normalizeSampleBytes(binarySampleBytes);
    return {
      kind: "arraybuffer",
      length: data.byteLength,
      preview: `ArrayBuffer(${data.byteLength})`,
      sample: bytesToHex(new Uint8Array(data.slice(0, sampleLength))),
      truncated: data.byteLength > sampleLength,
      envelope: parseBinaryEnvelope(data)
    };
  }
  if (ArrayBuffer.isView(data)) {
    const sampleLength = normalizeSampleBytes(binarySampleBytes);
    const bytes = new Uint8Array(data.buffer, data.byteOffset, Math.min(data.byteLength, sampleLength));
    return {
      kind: data.constructor.name,
      length: data.byteLength,
      preview: `${data.constructor.name}(${data.byteLength})`,
      sample: bytesToHex(bytes),
      truncated: data.byteLength > sampleLength,
      envelope: parseBinaryEnvelope(data)
    };
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return {
      kind: "blob",
      length: data.size,
      preview: `Blob(${data.size}, ${data.type || "unknown"})`,
      sample: "",
      truncated: false,
      asyncSamplePending: data.size > 0,
      sampleUnavailableReason: data.size > 0 ? "blob-async" : ""
    };
  }
  return {
    kind: typeof data,
    length: 0,
    preview: String(data).slice(0, 240),
    sample: String(data).slice(0, 1000),
    truncated: String(data).length > 1000
  };
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

function summarizeBytes(bytes, kind = "blob-arraybuffer", { binarySampleBytes = DEFAULT_BINARY_SAMPLE_BYTES } = {}) {
  const sampleLength = normalizeSampleBytes(binarySampleBytes);
  const sampleBytes = bytes.slice(0, sampleLength);
  return {
    kind,
    length: bytes.byteLength,
    preview: `${kind}(${bytes.byteLength})`,
    sample: bytesToHex(sampleBytes),
    truncated: bytes.byteLength > sampleLength,
    envelope: parseBinaryEnvelope(bytes)
  };
}

export class MajsoulAdapter extends EventTarget {
  constructor({ maxEvents = DEFAULT_MAX_EVENTS, dedupeMs = 25, binarySampleBytes = DEFAULT_BINARY_SAMPLE_BYTES } = {}) {
    super();
    this.maxEvents = normalizeMaxEvents(maxEvents);
    this.dedupeMs = dedupeMs;
    this.binarySampleBytes = normalizeSampleBytes(binarySampleBytes);
    this.paused = false;
    this.events = [];
    this.recentRawKeys = [];
    this.observedInboundEvents = new WeakSet();
    this.installed = false;
    this.installAttempts = 0;
    this.installedAt = null;
    this.installFailureReason = "";
    this.restoreFns = [];
    this.socketRecords = [];
    this.hookDiagnostics = createHookDiagnostics();
    this.nextEventId = 1;
  }

  install() {
    if (this.installed) return true;
    this.installAttempts += 1;
    if (typeof WebSocket === "undefined") {
      this.installFailureReason = "WebSocket is not available on this page context yet.";
      return false;
    }
    const restoreStart = this.restoreFns.length;
    try {
      this.installed = true;
      this.installedAt = new Date().toISOString();
      this.installFailureReason = "";
      this.hookDiagnostics = createHookDiagnostics();

      const adapter = this;
      const OriginalWebSocket = WebSocket;
      const originalPrototype = OriginalWebSocket.prototype;
      const originalSend = originalPrototype.send;
      const PatchedWebSocket = function MajsoulHelperWebSocket(...args) {
        const socket = new.target
          ? Reflect.construct(OriginalWebSocket, args, new.target)
          : OriginalWebSocket(...args);
        adapter.recordSocket(args[0] || socket.url || "");
        return socket;
      };
      Object.setPrototypeOf(PatchedWebSocket, OriginalWebSocket);
      PatchedWebSocket.prototype = originalPrototype;
      this.hookDiagnostics.constructorStatics = copyConstructorStatics(PatchedWebSocket, OriginalWebSocket);
      globalThis.WebSocket = PatchedWebSocket;
      this.restoreFns.push(() => {
        globalThis.WebSocket = OriginalWebSocket;
      });
      this.hookDiagnostics.prototypeConstructor = patchPrototypeConstructor(
        originalPrototype,
        PatchedWebSocket,
        this.restoreFns
      );
      this.hookDiagnostics.constructor = true;

    originalPrototype.send = function patchedSend(data) {
      const result = originalSend.call(this, data);
      adapter.safeRecordRaw("ws_out", data, this.url);
      return result;
    };
    this.restoreFns.push(() => {
      originalPrototype.send = originalSend;
    });
    this.hookDiagnostics.send = true;

    const originalAddEventListener = originalPrototype.addEventListener;
    const originalRemoveEventListener = originalPrototype.removeEventListener;
    const wrappedListeners = new WeakMap();

    const isEventListener = (listener) => (
      typeof listener === "function"
      || (listener && typeof listener === "object" && typeof listener.handleEvent === "function")
    );

    const callEventListener = (listener, thisArg, event) => {
      if (typeof listener === "function") return listener.call(thisArg, event);
      return listener.handleEvent.call(listener, event);
    };

    const listenerCaptureKey = (options) => String(typeof options === "boolean" ? options : Boolean(options?.capture));

    const rememberWrappedListener = (socket, listener, options, wrapped) => {
      let socketListeners = wrappedListeners.get(socket);
      if (!socketListeners) {
        socketListeners = new WeakMap();
        wrappedListeners.set(socket, socketListeners);
      }
      let listenerEntries = socketListeners.get(listener);
      if (!listenerEntries) {
        listenerEntries = new Map();
        socketListeners.set(listener, listenerEntries);
      }
      listenerEntries.set(listenerCaptureKey(options), wrapped);
    };

    const getWrappedListener = (socket, listener, options) => {
      const socketListeners = wrappedListeners.get(socket);
      const listenerEntries = socketListeners?.get(listener);
      return listenerEntries?.get(listenerCaptureKey(options));
    };

    const takeWrappedListener = (socket, listener, options) => {
      const socketListeners = wrappedListeners.get(socket);
      const listenerEntries = socketListeners?.get(listener);
      const wrapped = listenerEntries?.get(listenerCaptureKey(options));
      if (wrapped) listenerEntries.delete(listenerCaptureKey(options));
      return wrapped;
    };

    originalPrototype.addEventListener = function patchedAddEventListener(type, listener, options) {
      if (type !== "message" || !isEventListener(listener)) {
        return originalAddEventListener.call(this, type, listener, options);
      }
      const socket = this;
      const existing = getWrappedListener(socket, listener, options);
      if (existing) {
        return originalAddEventListener.call(this, type, existing, options);
      }
      const wrapped = function wrappedMessageListener(event) {
        adapter.safeRecordRaw("ws_in", event.data, socket.url, event);
        return callEventListener(listener, this, event);
      };
      rememberWrappedListener(socket, listener, options, wrapped);
      return originalAddEventListener.call(this, type, wrapped, options);
    };
    this.restoreFns.push(() => {
      originalPrototype.addEventListener = originalAddEventListener;
    });
    this.hookDiagnostics.addEventListener = true;

    originalPrototype.removeEventListener = function patchedRemoveEventListener(type, listener, options) {
      if (type !== "message" || !isEventListener(listener)) {
        return originalRemoveEventListener.call(this, type, listener, options);
      }
      return originalRemoveEventListener.call(this, type, takeWrappedListener(this, listener, options) || listener, options);
    };
    this.restoreFns.push(() => {
      originalPrototype.removeEventListener = originalRemoveEventListener;
    });
    this.hookDiagnostics.removeEventListener = true;

    const descriptor = Object.getOwnPropertyDescriptor(originalPrototype, "onmessage");
    if (descriptor && descriptor.configurable && typeof descriptor.set === "function") {
      const onMessageHandlers = new WeakMap();
      Object.defineProperty(originalPrototype, "onmessage", {
        configurable: true,
        enumerable: descriptor.enumerable,
        get() {
          return onMessageHandlers.get(this)?.handler || descriptor.get.call(this);
        },
        set(handler) {
          if (typeof handler !== "function") {
            onMessageHandlers.delete(this);
            descriptor.set.call(this, handler);
            return;
          }
          const socket = this;
          const wrapped = function patchedOnMessage(event) {
            adapter.safeRecordRaw("ws_in", event.data, socket.url, event);
            return handler.call(this, event);
          };
          onMessageHandlers.set(this, { handler, wrapped });
          descriptor.set.call(this, wrapped);
        }
      });
      this.restoreFns.push(() => {
        Object.defineProperty(originalPrototype, "onmessage", descriptor);
      });
      this.hookDiagnostics.onmessage = true;
      this.hookDiagnostics.onmessageMode = "accessor";
    } else if (!descriptor || descriptor.configurable) {
      const onMessageHandlers = new WeakMap();
      Object.defineProperty(originalPrototype, "onmessage", {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() {
          return onMessageHandlers.get(this)?.handler || null;
        },
        set(handler) {
          const previous = onMessageHandlers.get(this);
          if (previous?.wrapped) {
            originalRemoveEventListener.call(this, "message", previous.wrapped);
          }
          if (typeof handler !== "function") {
            onMessageHandlers.delete(this);
            return;
          }
          const socket = this;
          const wrapped = function fallbackOnMessage(event) {
            adapter.safeRecordRaw("ws_in", event.data, socket.url, event);
            return handler.call(this, event);
          };
          onMessageHandlers.set(this, { handler, wrapped });
          originalAddEventListener.call(this, "message", wrapped);
        }
      });
      this.restoreFns.push(() => {
        if (descriptor) {
          Object.defineProperty(originalPrototype, "onmessage", descriptor);
        } else {
          delete originalPrototype.onmessage;
        }
      });
      this.hookDiagnostics.onmessage = true;
      this.hookDiagnostics.onmessageMode = descriptor ? "data-descriptor-fallback" : "descriptorless-fallback";
    } else {
      this.hookDiagnostics.onmessage = false;
      this.hookDiagnostics.onmessageMode = "non-configurable";
    }
      this.dispatchEvent(new CustomEvent("majsoul-helper:install", { detail: this.getInstallDiagnostics() }));
      return true;
    } catch (error) {
      const restoreFns = this.restoreFns.splice(restoreStart).reverse();
      for (const restore of restoreFns) {
        try {
          restore();
        } catch {
          // Best-effort rollback; report the original install failure below.
        }
      }
      this.installed = false;
      this.installedAt = null;
      this.hookDiagnostics = createHookDiagnostics();
      this.installFailureReason = `WebSocket hook install failed: ${error instanceof Error ? error.message : String(error)}`;
      this.dispatchEvent(new CustomEvent("majsoul-helper:install", { detail: this.getInstallDiagnostics() }));
      return false;
    }
  }

  uninstall() {
    for (const restore of this.restoreFns.reverse()) restore();
    this.restoreFns = [];
    this.installed = false;
    this.installedAt = null;
    this.hookDiagnostics = createHookDiagnostics();
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
    return this.paused;
  }

  setBinarySampleBytes(value) {
    this.binarySampleBytes = normalizeSampleBytes(value);
    this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
    return this.binarySampleBytes;
  }

  setMaxEvents(value) {
    this.maxEvents = normalizeMaxEvents(value, this.maxEvents);
    this.events = this.events.slice(0, this.maxEvents);
    this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
    return this.maxEvents;
  }

  recordSocket(url = "") {
    const record = {
      url: sanitizeUrl(url),
      ts: Date.now()
    };
    this.socketRecords = [record, ...this.socketRecords].slice(0, 20);
    this.dispatchEvent(new CustomEvent("majsoul-helper:socket", { detail: record }));
  }

  recordRaw(source, data, url = "", messageEvent = null) {
    if (this.paused) return;
    if (source === "ws_in" && messageEvent && typeof messageEvent === "object") {
      if (this.observedInboundEvents.has(messageEvent)) return;
      this.observedInboundEvents.add(messageEvent);
    }
    const summary = summarizeMessage(data, { binarySampleBytes: this.binarySampleBytes });
    const now = Date.now();
    if (source === "ws_in" && !messageEvent) {
      const rawKey = `${source}|${url}|${summary.kind}|${summary.length}|${summary.sample || summary.preview}`;
      this.recentRawKeys = this.recentRawKeys.filter((entry) => now - entry.ts <= this.dedupeMs);
      if (this.recentRawKeys.some((entry) => entry.key === rawKey)) return;
      this.recentRawKeys.push({ key: rawKey, ts: now });
    }

    const event = {
      eventId: this.nextEventId++,
      type: "raw_message",
      source,
      ts: now,
      payload: {
        url: sanitizeUrl(url),
        ...summary
      }
    };
    this.events = [event, ...this.events].slice(0, this.maxEvents);
    this.dispatchEvent(new CustomEvent("majsoul-helper:event", { detail: event }));

    for (const parsed of [...parseReadableMessage(data), ...parseBinaryMessage(data)]) {
      const parsedEvent = {
        ...parsed,
        eventId: this.nextEventId++,
        source,
        ts: now,
        payload: {
          ...parsed.payload,
          rawSummary: event.payload
        }
      };
      this.events = [parsedEvent, ...this.events].slice(0, this.maxEvents);
      this.dispatchEvent(new CustomEvent("majsoul-helper:event", { detail: parsedEvent }));
    }

    if (typeof Blob !== "undefined" && data instanceof Blob && typeof data.arrayBuffer === "function") {
      this.recordBlobBytes(source, data, url, now);
    }
  }

  safeRecordRaw(source, data, url = "", messageEvent = null) {
    try {
      this.recordRaw(source, data, url, messageEvent);
    } catch (error) {
      this.recordCaptureError(source, url, error);
    }
  }

  recordCaptureError(source, url, error, observedAt = Date.now()) {
    if (this.paused) return;
    try {
      const event = {
        eventId: this.nextEventId++,
        type: "capture_error",
        source,
        ts: observedAt,
        payload: {
          url: sanitizeUrl(url),
          message: error instanceof Error ? error.message : String(error)
        }
      };
      this.events = [event, ...this.events].slice(0, this.maxEvents);
      this.dispatchEvent(new CustomEvent("majsoul-helper:event", { detail: event }));
    } catch {
      // Capture must never interfere with the page's own WebSocket behavior.
    }
  }

  async recordBlobBytes(source, blob, url, observedAt) {
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (this.paused) return;
      const summary = summarizeBytes(bytes, "blob-arraybuffer", { binarySampleBytes: this.binarySampleBytes });
      const event = {
        eventId: this.nextEventId++,
        type: "raw_message",
        source,
        ts: observedAt,
        payload: {
          url: sanitizeUrl(url),
          asyncSampleFor: "blob-async",
          ...summary
        }
      };
      this.events = [event, ...this.events].slice(0, this.maxEvents);
      this.dispatchEvent(new CustomEvent("majsoul-helper:event", { detail: event }));

      for (const parsed of parseBinaryMessage(bytes)) {
        const parsedEvent = {
          ...parsed,
          eventId: this.nextEventId++,
          source,
          ts: observedAt,
          payload: {
            ...parsed.payload,
            rawSummary: event.payload
          }
        };
        this.events = [parsedEvent, ...this.events].slice(0, this.maxEvents);
        this.dispatchEvent(new CustomEvent("majsoul-helper:event", { detail: parsedEvent }));
      }
    } catch (error) {
      this.recordCaptureError(source, url, error, observedAt);
    }
  }

  getRecentEvents() {
    return [...this.events];
  }

  getInstallDiagnostics({ events = this.events } = {}) {
    return {
      installed: this.installed,
      installAttempts: this.installAttempts,
      installedAt: this.installedAt,
      installFailureReason: this.installFailureReason,
      webSocketAvailable: typeof WebSocket !== "undefined",
      paused: this.paused,
      hooks: { ...this.hookDiagnostics },
      socketsCreated: this.socketRecords.length,
      recentSocketUrls: [...new Set(this.socketRecords.map((record) => record.url).filter(Boolean))].slice(0, 5),
      maxEvents: this.maxEvents,
      binarySampleBytes: this.binarySampleBytes,
      eventBuffer: buildEventBufferDiagnostics(events, this.nextEventId, this.maxEvents)
    };
  }

  clearEvents() {
    this.events = [];
    this.recentRawKeys = [];
    this.observedInboundEvents = new WeakSet();
    this.nextEventId = 1;
    this.dispatchEvent(new CustomEvent("majsoul-helper:clear", { detail: { ts: Date.now() } }));
  }

  exportCapture({ limit = this.maxEvents } = {}) {
    const normalizedLimit = normalizeLimit(limit, this.maxEvents, this.maxEvents);
    const events = this.getRecentEvents().slice(0, normalizedLimit);
    return {
      exportedAt: new Date().toISOString(),
      formatVersion: 1,
      limit: normalizedLimit,
      note: "Majsoul Helper capture export. Contains message summaries/samples only; no messages were modified by the helper.",
      page: getPageDiagnostics(),
      helperDiagnostics: this.getInstallDiagnostics({ events }),
      summary: summarizeCaptureEvents(events),
      events
    };
  }

  runSelfTest() {
    const readableEvents = parseReadableMessage(JSON.stringify({
      name: ".lq.ActionDealTile",
      data: { seat: 0, tile: "5m", leftTileCount: 55 }
    }));
    const binaryBytes = hexToBytes(SELF_TEST_DISCARD_SAMPLE);
    const binaryEnvelope = parseBinaryEnvelope(binaryBytes);
    const binaryEvents = parseBinaryMessage(binaryBytes);
    const result = {
      ranAt: new Date().toISOString(),
      installed: this.installed,
      webSocketAvailable: typeof WebSocket !== "undefined",
      readableParsedTypes: readableEvents.map((event) => event.type),
      binaryEnvelope: binaryEnvelope ? {
        frameTypeName: binaryEnvelope.frameTypeName,
        methodName: binaryEnvelope.methodName,
        actionName: binaryEnvelope.actionName,
        payloadTruncated: binaryEnvelope.payloadTruncated,
        actionPayloadTruncated: binaryEnvelope.actionPayloadTruncated
      } : null,
      binaryParsedTypes: binaryEvents.map((event) => event.type),
      ok: Boolean(
        readableEvents.some((event) => event.type === "draw_tile" && event.payload.seat === 0 && event.payload.tile === "5m")
        && binaryEnvelope?.methodName === ".lq.ActionPrototype"
        && binaryEnvelope?.actionName === "ActionDiscardTile"
        && binaryEvents.some((event) => event.type === "discard_tile" && event.payload.seat === 3 && event.payload.tile === "9s")
      )
    };
    this.dispatchEvent(new CustomEvent("majsoul-helper:self-test", { detail: result }));
    return result;
  }
}

function hexToBytes(hex) {
  if (!hex) return new Uint8Array();
  return new Uint8Array(hex.split(/\s+/).filter(Boolean).map((part) => Number.parseInt(part, 16)));
}

export function parseCapturedSampleEvent(event) {
  if (!event || event.type !== "raw_message") return [];
  const payload = event.payload || {};
  let data = null;

  if (payload.kind === "text") {
    data = payload.sample ?? payload.preview ?? "";
  } else if (payload.sample) {
    data = hexToBytes(payload.sample);
  }

  if (data === null) return [];
  return [...parseReadableMessage(data), ...parseBinaryMessage(data)].map((parsed) => ({
    ...parsed,
    source: event.source,
    ts: event.ts,
    payload: {
      ...parsed.payload,
      rawSummary: payload
    }
  }));
}

function buildEventBufferDiagnostics(events = [], nextEventId = 1, maxEvents = DEFAULT_MAX_EVENTS) {
  const ids = events
    .map((event) => Number(event?.eventId))
    .filter((eventId) => Number.isFinite(eventId));
  const oldestEventId = ids.length ? Math.min(...ids) : null;
  const newestEventId = ids.length ? Math.max(...ids) : null;
  return {
    maxEvents,
    retainedEvents: events.length,
    totalEventsSinceClear: Math.max(0, Number(nextEventId) - 1),
    oldestEventId,
    newestEventId,
    droppedBeforeRetained: oldestEventId === null ? 0 : Math.max(0, oldestEventId - 1)
  };
}

export function replayCaptureWithDiagnostics(capture) {
  const events = [];
  const inputEvents = capture?.events || [];
  const orderedEvents = orderedCaptureEvents(inputEvents);
  const replayDedupe = {
    inputEvents: inputEvents.length,
    ordering: orderedEvents.orderedBy,
    rawMessages: 0,
    rawMessagesWithParsedEvents: 0,
    rawParsedEvents: 0,
    liveParsedEvents: 0,
    skippedLiveParsedEvents: 0,
    retainedLiveParsedEvents: 0,
    fallbackLiveParsedEvents: 0,
    passthroughParsedEvents: 0,
    diagnosticEvents: 0,
    replayedEvents: 0
  };
  const replayedParsedKeys = new Set();
  for (const event of orderedEvents.events) {
    if (event.type === "raw_message") {
      replayDedupe.rawMessages += 1;
      const parsedEvents = parseCapturedSampleEvent(event);
      if (parsedEvents.length) replayDedupe.rawMessagesWithParsedEvents += 1;
      replayDedupe.rawParsedEvents += parsedEvents.length;
      for (const parsedEvent of parsedEvents) {
        replayedParsedKeys.add(parsedEventReplayKey(parsedEvent));
        events.push(parsedEvent);
      }
    } else if (isStandardGameEvent(event.type)) {
      replayDedupe.liveParsedEvents += 1;
      if (event.payload?.rawSummary && replayedParsedKeys.has(parsedEventReplayKey(event))) {
        replayDedupe.skippedLiveParsedEvents += 1;
        continue;
      }
      replayDedupe.retainedLiveParsedEvents += 1;
      if (event.payload?.rawSummary) {
        replayDedupe.fallbackLiveParsedEvents += 1;
      } else {
        replayDedupe.passthroughParsedEvents += 1;
      }
      events.push(event);
    } else {
      replayDedupe.diagnosticEvents += 1;
    }
  }
  replayDedupe.replayedEvents = events.length;
  return { events, replayDedupe };
}

function orderedCaptureEvents(events = []) {
  if (events.length && events.every((event) => Number.isFinite(Number(event.eventId)))) {
    return {
      orderedBy: "eventId",
      events: [...events].sort((left, right) => Number(left.eventId) - Number(right.eventId))
    };
  }
  return {
    orderedBy: "newestFirstFallback",
    events: [...events].reverse()
  };
}

export function replayCapture(capture) {
  const { events } = replayCaptureWithDiagnostics(capture);
  return events;
}

function parsedEventReplayKey(event) {
  const payload = event?.payload || {};
  return JSON.stringify({
    type: event?.type || "",
    source: event?.source || "",
    ts: event?.ts ?? null,
    methodName: payload.binaryEnvelope?.methodName || "",
    actionName: payload.binaryEnvelope?.actionName || "",
    seat: payload.seat ?? null,
    tile: payload.tile ?? null,
    reason: payload.reason ?? null,
    meldType: payload.type ?? null,
    meld: payload.meld || null,
    scores: payload.scores || null,
    round: payload.round ?? null,
    chang: payload.chang ?? null,
    ju: payload.ju ?? null,
    rawSummary: rawSummaryReplayKey(payload.rawSummary)
  });
}

function rawSummaryReplayKey(rawSummary) {
  if (!rawSummary) return null;
  return {
    kind: rawSummary.kind || "",
    length: rawSummary.length ?? null,
    sample: rawSummary.sample || "",
    preview: rawSummary.preview || ""
  };
}

export function summarizeCaptureEvents(events = []) {
  const summary = {
    totalEvents: events.length,
    rawMessages: 0,
    parsedEvents: 0,
    diagnosticEvents: 0,
    bySource: {},
    byKind: {},
    byMethodName: {},
    byActionName: {},
    byParsedType: {},
    byDiagnosticType: {},
    byUnparsedActionName: {}
  };
  const rawActions = {};
  const parsedActions = {};

  for (const event of events) {
    summary.bySource[event.source || "unknown"] = (summary.bySource[event.source || "unknown"] || 0) + 1;
    if (event.type === "raw_message") {
      summary.rawMessages += 1;
      const payload = event.payload || {};
      const kind = payload.kind || "unknown";
      summary.byKind[kind] = (summary.byKind[kind] || 0) + 1;
      const envelope = payloadEnvelope(payload);
      const methodName = envelope?.methodName;
      const actionNames = envelopeActionNames(envelope);
      if (methodName) summary.byMethodName[methodName] = (summary.byMethodName[methodName] || 0) + 1;
      for (const actionName of actionNames) {
        summary.byActionName[actionName] = (summary.byActionName[actionName] || 0) + 1;
        rawActions[actionName] = (rawActions[actionName] || 0) + 1;
      }
    } else if (isStandardGameEvent(event.type)) {
      summary.parsedEvents += 1;
      summary.byParsedType[event.type] = (summary.byParsedType[event.type] || 0) + 1;
      const methodName = event.payload?.binaryEnvelope?.methodName;
      const actionNames = [event.payload?.binaryEnvelope?.actionName].filter(Boolean);
      if (methodName) summary.byMethodName[methodName] = (summary.byMethodName[methodName] || 0) + 1;
      for (const actionName of actionNames) {
        summary.byActionName[actionName] = (summary.byActionName[actionName] || 0) + 1;
        parsedActions[actionName] = (parsedActions[actionName] || 0) + 1;
      }
    } else {
      summary.diagnosticEvents += 1;
      summary.byDiagnosticType[event.type || "unknown"] = (summary.byDiagnosticType[event.type || "unknown"] || 0) + 1;
    }
  }

  for (const [actionName, count] of Object.entries(rawActions)) {
    const missing = count - (parsedActions[actionName] || 0);
    if (missing > 0) summary.byUnparsedActionName[actionName] = missing;
  }

  return summary;
}

function payloadEnvelope(payload = {}) {
  if (payload.envelope) return payload.envelope;
  if (!payload.sample || payload.kind === "text") return null;
  return parseBinaryEnvelope(hexToBytes(payload.sample));
}

function envelopeActionNames(envelope = {}) {
  return [
    envelope?.actionName,
    ...(envelope?.restoreActionNames || [])
  ].filter(Boolean);
}

function normalizeLimit(limit, fallback, max = Infinity) {
  const value = Number(limit);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

function normalizeMaxEvents(value, fallback = DEFAULT_MAX_EVENTS) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(1, Math.min(1000, Math.floor(number)));
}

function normalizeSampleBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_BINARY_SAMPLE_BYTES;
  return Math.max(16, Math.min(4096, Math.floor(number)));
}

export { DEFAULT_BINARY_SAMPLE_BYTES, DEFAULT_MAX_EVENTS, summarizeMessage };
