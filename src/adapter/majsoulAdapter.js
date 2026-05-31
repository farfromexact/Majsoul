import { parseBinaryEnvelope, parseBinaryMessage, parseDecodedMessage, parseReadableMessage } from "./messageParser.js";
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
    onmessageMode: "not-installed",
    decodedMessage: false,
    decodedMessageMode: "not-installed",
    decodedMessageAttempts: 0,
    decodedMessageFailureReason: "",
    decodedDispatcher: false,
    decodedDispatcherMode: "not-installed",
    decodedDispatcherAttempts: 0,
    decodedDispatcherFailureReason: ""
  };
}

function createUnityRuntimeState() {
  return {
    instance: null,
    createUnityInstanceLoadObserver: false,
    createUnityInstanceLoadEvents: 0,
    createUnityInstanceLastScript: "",
    createUnityInstanceHook: false,
    createUnityInstanceMode: "not-installed",
    createUnityInstanceAttempts: 0,
    createUnityInstanceCalls: 0,
    createUnityInstanceResolved: false,
    createUnityInstanceFailureReason: ""
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

function getRuntimeDiagnostics(unityRuntime = {}) {
  const unityInstance = unityRuntime.instance || globalThis.unityInstance || globalThis.gameInstance || null;
  const unityModule = unityInstance?.Module || null;
  const unityBuildScript = getScriptSources()
    .find((src) => /WebGL-release|\.loader\.js|\.framework\.js|\.wasm/i.test(src)) || "";
  const unityCanvas = safeQuerySelector("#unity-canvas") || safeQuerySelector("canvas");
  return {
    unityWebGL: Boolean(unityBuildScript || unityInstance || unityCanvas?.id === "unity-canvas"),
    unityBuildScript: sanitizeUrl(unityBuildScript),
    hasUnityInstance: Boolean(unityInstance),
    hasUnityModule: Boolean(unityModule),
    heapU8: Boolean(unityModule?.HEAPU8),
    sendMessageAvailable: Boolean(unityInstance?.SendMessage || unityModule?.SendMessage),
    createUnityInstanceLoadObserver: Boolean(unityRuntime.createUnityInstanceLoadObserver),
    createUnityInstanceLoadEvents: unityRuntime.createUnityInstanceLoadEvents ?? 0,
    createUnityInstanceLastScript: unityRuntime.createUnityInstanceLastScript || "",
    createUnityInstanceHook: Boolean(unityRuntime.createUnityInstanceHook),
    createUnityInstanceMode: unityRuntime.createUnityInstanceMode || "not-installed",
    createUnityInstanceAttempts: unityRuntime.createUnityInstanceAttempts ?? 0,
    createUnityInstanceCalls: unityRuntime.createUnityInstanceCalls ?? 0,
    createUnityInstanceResolved: Boolean(unityRuntime.createUnityInstanceResolved),
    createUnityInstanceFailureReason: unityRuntime.createUnityInstanceFailureReason || "",
    netMessageWrapperGlobal: typeof globalThis.net?.MessageWrapper?.decodeMessage === "function",
    layaGlobal: Boolean(globalThis.Laya?.EventDispatcher)
  };
}

function getScriptSources() {
  try {
    return Array.from(globalThis.document?.scripts || [])
      .map((script) => String(script?.src || ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isUnityLoaderScript(src = "") {
  return /(?:unity|webgl|\.loader\.js|\.framework\.js|\.wasm)/i.test(String(src || ""));
}

function safeQuerySelector(selector) {
  try {
    return globalThis.document?.querySelector?.(selector) || null;
  } catch {
    return null;
  }
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

function safeParseError(error) {
  return error instanceof Error ? error.message : String(error);
}

function summarizeBinaryEnvelope(data) {
  try {
    return { envelope: parseBinaryEnvelope(data) };
  } catch (error) {
    return {
      envelope: null,
      envelopeError: safeParseError(error)
    };
  }
}

function parseStandardMessagesSafely(data) {
  const events = [];
  const errors = [];
  try {
    events.push(...parseReadableMessage(data));
  } catch (error) {
    errors.push(`readable: ${safeParseError(error)}`);
  }
  try {
    events.push(...parseBinaryMessage(data));
  } catch (error) {
    errors.push(`binary: ${safeParseError(error)}`);
  }
  return {
    events,
    parseError: errors.join("; ")
  };
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
    const envelopeSummary = summarizeBinaryEnvelope(data);
    return {
      kind: "arraybuffer",
      length: data.byteLength,
      preview: `ArrayBuffer(${data.byteLength})`,
      sample: bytesToHex(new Uint8Array(data.slice(0, sampleLength))),
      truncated: data.byteLength > sampleLength,
      ...envelopeSummary
    };
  }
  if (ArrayBuffer.isView(data)) {
    const sampleLength = normalizeSampleBytes(binarySampleBytes);
    const bytes = new Uint8Array(data.buffer, data.byteOffset, Math.min(data.byteLength, sampleLength));
    const envelopeSummary = summarizeBinaryEnvelope(data);
    return {
      kind: data.constructor.name,
      length: data.byteLength,
      preview: `${data.constructor.name}(${data.byteLength})`,
      sample: bytesToHex(bytes),
      truncated: data.byteLength > sampleLength,
      ...envelopeSummary
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
  const envelopeSummary = summarizeBinaryEnvelope(bytes);
  return {
    kind,
    length: bytes.byteLength,
    preview: `${kind}(${bytes.byteLength})`,
    sample: bytesToHex(sampleBytes),
    truncated: bytes.byteLength > sampleLength,
    ...envelopeSummary
  };
}

function summarizeDecodedMessage(message, hookName, parsedEvents = []) {
  const envelope = firstDecodedEnvelopeSummary(message);
  return {
    hook: hookName,
    name: envelope.name,
    actionName: envelope.actionName,
    payloadKeys: envelope.payloadKeys,
    parsedTypes: parsedEvents.map((event) => event.type),
    parsedCount: parsedEvents.length
  };
}

function firstDecodedEnvelopeSummary(message) {
  const first = Array.isArray(message) ? message[0] : message;
  if (!first || typeof first !== "object") {
    return {
      name: "",
      actionName: "",
      payloadKeys: []
    };
  }
  const name = stringValue(
    first.name,
    first.method,
    first.type,
    first.event,
    first.msg,
    first.command,
    first.actionName,
    first.action,
    first.wrapper?.name,
    first.head?.name,
    first.message?.name
  );
  const payload = objectValue(first.data, first.payload, first.result, first.params, first.detail);
  const actionName = stringValue(payload?.name, payload?.actionName, payload?.action);
  return {
    name,
    actionName,
    payloadKeys: payload ? Object.keys(payload).slice(0, 20) : []
  };
}

function stringValue(...values) {
  for (const value of values) {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && typeof value.name === "string") return value.name;
  }
  return "";
}

function objectValue(...values) {
  return values.find((value) => value && typeof value === "object" && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer));
}

function isDecodedGameName(value = "") {
  const text = String(value || "");
  return (
    /(^|\.)(Action|Record)[A-Za-z0-9_]+$/.test(text)
    || /^\.?lq\.(ActionPrototype|GameRestore|ResSyncGame|ResEnterGame)$/.test(text)
  );
}

function hasDecodedGameName(value, depth = 0) {
  if (depth > 4 || value === undefined || value === null) return false;
  if (typeof value === "string") return isDecodedGameName(value);
  if (typeof value !== "object") return false;

  const direct = [
    value.name,
    value.method,
    value.type,
    value.event,
    value.msg,
    value.command,
    value.actionName,
    value.action,
    value.wrapper?.name,
    value.head?.name,
    value.message?.name,
    value.constructor?.name
  ];
  if (direct.some((entry) => isDecodedGameName(entry))) return true;

  return [
    value.data,
    value.payload,
    value.result,
    value.params,
    value.detail,
    value.message,
    value.wrapper,
    value.head
  ].some((entry) => hasDecodedGameName(entry, depth + 1));
}

export class MajsoulAdapter extends EventTarget {
  constructor({ maxEvents = DEFAULT_MAX_EVENTS, dedupeMs = 25, binarySampleBytes = DEFAULT_BINARY_SAMPLE_BYTES, helperVersion = "" } = {}) {
    super();
    this.helperVersion = helperVersion;
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
    this.unityRuntime = createUnityRuntimeState();
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
    this.installDecodedMessageHook();
    this.startDecodedMessageHookRetry();
    this.installDecodedDispatcherHook();
    this.startDecodedDispatcherHookRetry();
    this.installUnityScriptLoadObserver();
    this.installUnityInstanceHook();
    this.startUnityInstanceHookRetry();
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
    this.unityRuntime = createUnityRuntimeState();
  }

  installUnityScriptLoadObserver() {
    const target = globalThis.document || globalThis;
    if (this.unityRuntime.createUnityInstanceLoadObserver || typeof target?.addEventListener !== "function") return false;
    const adapter = this;
    function onScriptLoad(event) {
      const script = event?.target;
      const src = String(script?.src || "");
      if (!isUnityLoaderScript(src)) return;
      adapter.unityRuntime.createUnityInstanceLoadEvents += 1;
      adapter.unityRuntime.createUnityInstanceLastScript = sanitizeUrl(src);
      if (!adapter.unityRuntime.createUnityInstanceHook) {
        adapter.installUnityInstanceHook();
      }
      adapter.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: adapter.getInstallDiagnostics() }));
    }
    target.addEventListener("load", onScriptLoad, true);
    this.restoreFns.push(() => {
      target.removeEventListener?.("load", onScriptLoad, true);
    });
    this.unityRuntime.createUnityInstanceLoadObserver = true;
    if (this.unityRuntime.createUnityInstanceMode === "not-installed") {
      this.unityRuntime.createUnityInstanceMode = "script-load-observer";
    }
    return true;
  }

  installUnityInstanceHook() {
    this.unityRuntime.createUnityInstanceAttempts += 1;
    const originalCreateUnityInstance = globalThis.createUnityInstance;
    if (typeof originalCreateUnityInstance !== "function") {
      this.unityRuntime.createUnityInstanceFailureReason = "createUnityInstance is not available yet.";
      return false;
    }
    if (originalCreateUnityInstance.__majsoulHelperWrapped) {
      this.unityRuntime.createUnityInstanceHook = true;
      this.unityRuntime.createUnityInstanceMode = "already-wrapped";
      this.unityRuntime.createUnityInstanceFailureReason = "";
      return true;
    }

    const adapter = this;
    function wrappedCreateUnityInstance(...args) {
      adapter.unityRuntime.createUnityInstanceCalls += 1;
      let result;
      try {
        result = originalCreateUnityInstance.apply(this, args);
      } catch (error) {
        adapter.unityRuntime.createUnityInstanceFailureReason = `createUnityInstance threw: ${safeParseError(error)}`;
        adapter.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: adapter.getInstallDiagnostics() }));
        throw error;
      }
      adapter.observeUnityInstanceResult(result);
      return result;
    }
    Object.defineProperty(wrappedCreateUnityInstance, "__majsoulHelperWrapped", {
      configurable: true,
      value: true
    });

    try {
      globalThis.createUnityInstance = wrappedCreateUnityInstance;
      this.restoreFns.push(() => {
        globalThis.createUnityInstance = originalCreateUnityInstance;
      });
      this.unityRuntime.createUnityInstanceHook = true;
      this.unityRuntime.createUnityInstanceMode = "createUnityInstance";
      this.unityRuntime.createUnityInstanceFailureReason = "";
      this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
      return true;
    } catch (error) {
      this.unityRuntime.createUnityInstanceHook = false;
      this.unityRuntime.createUnityInstanceMode = "failed";
      this.unityRuntime.createUnityInstanceFailureReason = safeParseError(error);
      return false;
    }
  }

  startUnityInstanceHookRetry() {
    if (this.unityRuntime.createUnityInstanceHook || typeof globalThis.setInterval !== "function") return;
    const timer = globalThis.setInterval(() => {
      if (this.unityRuntime.createUnityInstanceHook || this.installUnityInstanceHook()) {
        globalThis.clearInterval(timer);
      }
    }, 250);
    if (typeof timer?.unref === "function") timer.unref();
    this.restoreFns.push(() => {
      globalThis.clearInterval(timer);
    });
  }

  observeUnityInstanceResult(result) {
    if (result && typeof result.then === "function") {
      result
        .then((instance) => {
          this.recordUnityInstance(instance);
        })
        .catch((error) => {
          this.unityRuntime.createUnityInstanceFailureReason = `createUnityInstance rejected: ${safeParseError(error)}`;
          this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
        });
      return;
    }
    this.recordUnityInstance(result);
  }

  recordUnityInstance(instance) {
    if (!instance || typeof instance !== "object") return;
    this.unityRuntime.instance = instance;
    this.unityRuntime.createUnityInstanceResolved = true;
    this.unityRuntime.createUnityInstanceFailureReason = "";
    this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
  }

  installDecodedMessageHook() {
    this.hookDiagnostics.decodedMessageAttempts += 1;
    const wrapper = globalThis.net?.MessageWrapper;
    if (!wrapper || typeof wrapper !== "object") {
      this.hookDiagnostics.decodedMessageFailureReason = "net.MessageWrapper is not available yet.";
      return false;
    }
    const originalDecodeMessage = wrapper.decodeMessage;
    if (typeof originalDecodeMessage !== "function") {
      this.hookDiagnostics.decodedMessageFailureReason = "net.MessageWrapper.decodeMessage is not available yet.";
      return false;
    }
    if (originalDecodeMessage.__majsoulHelperWrapped) {
      this.hookDiagnostics.decodedMessage = true;
      this.hookDiagnostics.decodedMessageMode = "already-wrapped";
      this.hookDiagnostics.decodedMessageFailureReason = "";
      return true;
    }

    const adapter = this;
    const descriptor = Object.getOwnPropertyDescriptor(wrapper, "decodeMessage");
    function wrappedDecodeMessage(...args) {
      const result = originalDecodeMessage.apply(this, args);
      adapter.safeRecordDecoded("net.MessageWrapper.decodeMessage", result);
      return result;
    }
    Object.defineProperty(wrappedDecodeMessage, "__majsoulHelperWrapped", {
      configurable: true,
      value: true
    });

    try {
      if (descriptor?.configurable) {
        Object.defineProperty(wrapper, "decodeMessage", {
          ...descriptor,
          value: wrappedDecodeMessage
        });
      } else {
        wrapper.decodeMessage = wrappedDecodeMessage;
      }
      this.restoreFns.push(() => {
        try {
          if (descriptor?.configurable) {
            Object.defineProperty(wrapper, "decodeMessage", descriptor);
          } else {
            wrapper.decodeMessage = originalDecodeMessage;
          }
        } catch {
          // Best-effort restore only.
        }
      });
      this.hookDiagnostics.decodedMessage = true;
      this.hookDiagnostics.decodedMessageMode = "net.MessageWrapper.decodeMessage";
      this.hookDiagnostics.decodedMessageFailureReason = "";
      this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
      return true;
    } catch (error) {
      this.hookDiagnostics.decodedMessage = false;
      this.hookDiagnostics.decodedMessageMode = "failed";
      this.hookDiagnostics.decodedMessageFailureReason = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  startDecodedMessageHookRetry() {
    if (this.hookDiagnostics.decodedMessage || typeof globalThis.setInterval !== "function") return;
    const timer = globalThis.setInterval(() => {
      if (this.markDecodedMessageNotApplicableForUnity()) {
        globalThis.clearInterval(timer);
        return;
      }
      if (this.hookDiagnostics.decodedMessage || this.installDecodedMessageHook()) {
        globalThis.clearInterval(timer);
      }
    }, 250);
    if (typeof timer?.unref === "function") timer.unref();
    this.restoreFns.push(() => {
      globalThis.clearInterval(timer);
    });
  }

  markDecodedMessageNotApplicableForUnity() {
    const runtime = getRuntimeDiagnostics(this.unityRuntime);
    if (!runtime.unityWebGL || runtime.netMessageWrapperGlobal || this.hookDiagnostics.decodedMessage) return false;
    this.hookDiagnostics.decodedMessageMode = "not-applicable-unity";
    this.hookDiagnostics.decodedMessageFailureReason = "Unity WebGL runtime detected; net.MessageWrapper is not expected on this build.";
    this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
    return true;
  }

  installDecodedDispatcherHook() {
    this.hookDiagnostics.decodedDispatcherAttempts += 1;
    const dispatcherPrototype = globalThis.Laya?.EventDispatcher?.prototype;
    if (!dispatcherPrototype || typeof dispatcherPrototype !== "object") {
      this.hookDiagnostics.decodedDispatcherFailureReason = "Laya.EventDispatcher is not available yet.";
      return false;
    }
    const originalEvent = dispatcherPrototype.event;
    if (typeof originalEvent !== "function") {
      this.hookDiagnostics.decodedDispatcherFailureReason = "Laya.EventDispatcher.prototype.event is not available yet.";
      return false;
    }
    if (originalEvent.__majsoulHelperWrapped) {
      this.hookDiagnostics.decodedDispatcher = true;
      this.hookDiagnostics.decodedDispatcherMode = "already-wrapped";
      this.hookDiagnostics.decodedDispatcherFailureReason = "";
      return true;
    }

    const adapter = this;
    const descriptor = Object.getOwnPropertyDescriptor(dispatcherPrototype, "event");
    function wrappedLayaEvent(type, data, ...args) {
      adapter.safeRecordDecoded("Laya.EventDispatcher.event", data, {
        requireGameLike: true,
        eventType: type
      });
      return originalEvent.call(this, type, data, ...args);
    }
    Object.defineProperty(wrappedLayaEvent, "__majsoulHelperWrapped", {
      configurable: true,
      value: true
    });

    try {
      if (descriptor?.configurable) {
        Object.defineProperty(dispatcherPrototype, "event", {
          ...descriptor,
          value: wrappedLayaEvent
        });
      } else {
        dispatcherPrototype.event = wrappedLayaEvent;
      }
      this.restoreFns.push(() => {
        try {
          if (descriptor?.configurable) {
            Object.defineProperty(dispatcherPrototype, "event", descriptor);
          } else {
            dispatcherPrototype.event = originalEvent;
          }
        } catch {
          // Best-effort restore only.
        }
      });
      this.hookDiagnostics.decodedDispatcher = true;
      this.hookDiagnostics.decodedDispatcherMode = "Laya.EventDispatcher.event";
      this.hookDiagnostics.decodedDispatcherFailureReason = "";
      this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
      return true;
    } catch (error) {
      this.hookDiagnostics.decodedDispatcher = false;
      this.hookDiagnostics.decodedDispatcherMode = "failed";
      this.hookDiagnostics.decodedDispatcherFailureReason = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  startDecodedDispatcherHookRetry() {
    if (this.hookDiagnostics.decodedDispatcher || typeof globalThis.setInterval !== "function") return;
    const timer = globalThis.setInterval(() => {
      if (this.markDecodedDispatcherNotApplicableForUnity()) {
        globalThis.clearInterval(timer);
        return;
      }
      if (this.hookDiagnostics.decodedDispatcher || this.installDecodedDispatcherHook()) {
        globalThis.clearInterval(timer);
      }
    }, 250);
    if (typeof timer?.unref === "function") timer.unref();
    this.restoreFns.push(() => {
      globalThis.clearInterval(timer);
    });
  }

  markDecodedDispatcherNotApplicableForUnity() {
    const runtime = getRuntimeDiagnostics(this.unityRuntime);
    if (!runtime.unityWebGL || runtime.layaGlobal || this.hookDiagnostics.decodedDispatcher) return false;
    this.hookDiagnostics.decodedDispatcherMode = "not-applicable-unity";
    this.hookDiagnostics.decodedDispatcherFailureReason = "Unity WebGL runtime detected; Laya.EventDispatcher is not expected on this build.";
    this.dispatchEvent(new CustomEvent("majsoul-helper:config", { detail: this.getInstallDiagnostics() }));
    return true;
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
    const parsedMessages = parseStandardMessagesSafely(data);
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
        ...summary,
        ...(parsedMessages.parseError ? { parseError: parsedMessages.parseError } : {})
      }
    };
    this.events = [event, ...this.events].slice(0, this.maxEvents);
    this.dispatchEvent(new CustomEvent("majsoul-helper:event", { detail: event }));

    for (const parsed of parsedMessages.events) {
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

  recordDecoded(hookName, message, { requireGameLike = false, eventType = "" } = {}) {
    if (this.paused) return;
    const parsedEvents = parseDecodedMessage(message);
    if (requireGameLike && !parsedEvents.length && !hasDecodedGameName(eventType) && !hasDecodedGameName(message)) {
      return;
    }
    const now = Date.now();
    const event = {
      eventId: this.nextEventId++,
      type: "decoded_message",
      source: "client_decode",
      ts: now,
      payload: summarizeDecodedMessage(message, hookName, parsedEvents)
    };
    this.events = [event, ...this.events].slice(0, this.maxEvents);
    this.dispatchEvent(new CustomEvent("majsoul-helper:event", { detail: event }));

    for (const parsed of parsedEvents) {
      const parsedEvent = {
        ...parsed,
        eventId: this.nextEventId++,
        source: "client_decode",
        ts: now,
        payload: {
          ...parsed.payload,
          decodedSummary: event.payload
        }
      };
      this.events = [parsedEvent, ...this.events].slice(0, this.maxEvents);
      this.dispatchEvent(new CustomEvent("majsoul-helper:event", { detail: parsedEvent }));
    }
  }

  safeRecordDecoded(hookName, message, options) {
    try {
      this.recordDecoded(hookName, message, options);
    } catch (error) {
      this.recordCaptureError("client_decode", hookName, error);
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
      const parsedMessages = parseStandardMessagesSafely(bytes);
      const event = {
        eventId: this.nextEventId++,
        type: "raw_message",
        source,
        ts: observedAt,
        payload: {
          url: sanitizeUrl(url),
          asyncSampleFor: "blob-async",
          ...summary,
          ...(parsedMessages.parseError ? { parseError: parsedMessages.parseError } : {})
        }
      };
      this.events = [event, ...this.events].slice(0, this.maxEvents);
      this.dispatchEvent(new CustomEvent("majsoul-helper:event", { detail: event }));

      for (const parsed of parsedMessages.events) {
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
      helperVersion: this.helperVersion,
      installAttempts: this.installAttempts,
      installedAt: this.installedAt,
      installFailureReason: this.installFailureReason,
      webSocketAvailable: typeof WebSocket !== "undefined",
      paused: this.paused,
      hooks: { ...this.hookDiagnostics },
      runtime: getRuntimeDiagnostics(this.unityRuntime),
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
      helperVersion: this.helperVersion,
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
  return parseStandardMessagesSafely(data).events.map((parsed) => ({
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
  try {
    return parseBinaryEnvelope(hexToBytes(payload.sample));
  } catch {
    return null;
  }
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
