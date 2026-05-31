import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replayCapture, replayCaptureWithDiagnostics } from "../src/adapter/majsoulAdapter.js";
import { GameState } from "../src/core/gameState.js";
import { REAL_PAGE_PREFLIGHT_VERSION, REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS } from "../src/core/realPageReadiness.js";

const capture = readFixture("capture-action-discard.json");
const drawDiscardCapture = readFixture("capture-draw-discard.json");
const readyCapture = readFixture("capture-ready.json");

function readFixture(fileName) {
  return JSON.parse(readFileSync(join("tests", "fixtures", fileName), "utf8"));
}

function protobufString(field, value) {
  const encoded = new TextEncoder().encode(value);
  return [...encodeVarint(field << 3 | 2), ...encodeVarint(encoded.length), ...encoded];
}

function protobufBytes(field, value) {
  return [...encodeVarint(field << 3 | 2), ...encodeVarint(value.length), ...value];
}

function protobufVarint(field, value) {
  const bytes = encodeVarint(field << 3 | 0);
  return [...bytes, ...encodeVarint(value)];
}

function encodeVarint(value) {
  const bytes = [];
  let remaining = value;
  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining);
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

describe("replayCapture", () => {
  it("replays exported raw capture samples into parsed events", () => {
    const events = replayCapture(capture);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "discard_tile",
      source: "ws_in",
      payload: {
        seat: 3,
        tile: "9s",
        tsumogiri: true
      }
    });
  });

  it("does not duplicate live parsed events when their raw message can be replayed", () => {
    const discardPayload = [
      ...protobufVarint(1, 1),
      ...protobufString(2, "9s")
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 11),
      ...protobufString(2, "ActionDiscardTile"),
      ...protobufBytes(3, discardPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);
    const rawSummary = {
      kind: "Uint8Array",
      length: frame.byteLength,
      preview: `Uint8Array(${frame.byteLength})`,
      sample: bytesToHex(frame),
      truncated: false
    };
    const liveCapture = {
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "discard_tile",
          source: "ws_in",
          ts: 11,
          payload: {
            seat: 1,
            tile: "9s",
            binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" },
            rawSummary
          }
        },
        {
          type: "raw_message",
          source: "ws_in",
          ts: 11,
          payload: rawSummary
        }
      ]
    };

    const { events, replayDedupe } = replayCaptureWithDiagnostics(liveCapture);

    expect(events).toHaveLength(1);
    expect(replayDedupe).toMatchObject({
      inputEvents: 2,
      rawMessages: 1,
      rawMessagesWithParsedEvents: 1,
      rawParsedEvents: 1,
      liveParsedEvents: 1,
      skippedLiveParsedEvents: 1,
      retainedLiveParsedEvents: 0,
      fallbackLiveParsedEvents: 0,
      replayedEvents: 1
    });
    expect(events[0]).toMatchObject({
      type: "discard_tile",
      source: "ws_in",
      payload: {
        seat: 1,
        tile: "9s",
        rawSummary
      }
    });
  });

  it("dedupes stale live parsed events when raw replay now extracts more fields", () => {
    const encodedDiscardPayload = [0x95, 0x7e, 0x63, 0x68, 0x55, 0xae, 0x4e, 0x9c, 0x75, 0xca, 0x99, 0x9e, 0xdf, 0x93];
    const actionPrototypePayload = [
      ...protobufVarint(1, 6),
      ...protobufString(2, "ActionDiscardTile"),
      ...protobufBytes(3, encodedDiscardPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);
    const rawSummary = {
      kind: "Uint8Array",
      length: frame.byteLength,
      preview: `Uint8Array(${frame.byteLength})`,
      sample: bytesToHex(frame),
      truncated: false
    };
    const liveCapture = {
      exportedAt: "2026-05-31T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          eventId: 1,
          type: "raw_message",
          source: "ws_in",
          ts: 11,
          payload: rawSummary
        },
        {
          eventId: 2,
          type: "discard_tile",
          source: "ws_in",
          ts: 11,
          payload: {
            tsumogiri: false,
            isRiichi: false,
            doraIndicators: [],
            binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" },
            rawSummary
          }
        }
      ]
    };

    const { events, replayDedupe } = replayCaptureWithDiagnostics(liveCapture);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "discard_tile",
      payload: {
        seat: 0,
        tile: "3z",
        payloadCodec: "unity-xor-discard-short"
      }
    });
    expect(replayDedupe).toMatchObject({
      rawParsedEvents: 1,
      liveParsedEvents: 1,
      skippedLiveParsedEvents: 1,
      replayedEvents: 1
    });
  });

  it("dedupes stale live parsed events when raw replay no longer emits them", () => {
    const noisyDealPayload = [
      ...protobufBytes(5, [
        ...protobufVarint(2, 36)
      ])
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 42),
      ...protobufString(2, "ActionDealTile"),
      ...protobufBytes(3, noisyDealPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);
    const rawSummary = {
      kind: "Uint8Array",
      length: frame.byteLength,
      preview: `Uint8Array(${frame.byteLength})`,
      sample: bytesToHex(frame),
      truncated: false
    };
    const liveCapture = {
      exportedAt: "2026-05-31T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          eventId: 1,
          type: "raw_message",
          source: "ws_in",
          ts: 11,
          payload: rawSummary
        },
        {
          eventId: 2,
          type: "riichi",
          source: "ws_in",
          ts: 11,
          payload: {
            score: 36,
            binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDealTile" },
            rawSummary
          }
        }
      ]
    };

    const { events, replayDedupe } = replayCaptureWithDiagnostics(liveCapture);

    expect(events.map((event) => event.type)).toEqual(["draw_tile"]);
    expect(replayDedupe).toMatchObject({
      rawParsedEvents: 1,
      liveParsedEvents: 1,
      skippedLiveParsedEvents: 1,
      retainedLiveParsedEvents: 0,
      fallbackLiveParsedEvents: 0,
      replayedEvents: 1
    });
  });

  it("uses eventId ordering when replaying captures that include stable event ids", () => {
    const discardPayload = [
      ...protobufVarint(1, 1),
      ...protobufString(2, "9s")
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 11),
      ...protobufString(2, "ActionDiscardTile"),
      ...protobufBytes(3, discardPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);
    const rawSummary = {
      kind: "Uint8Array",
      length: frame.byteLength,
      preview: `Uint8Array(${frame.byteLength})`,
      sample: bytesToHex(frame),
      truncated: false
    };
    const liveCapture = {
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          eventId: 1,
          type: "raw_message",
          source: "ws_in",
          ts: 11,
          payload: rawSummary
        },
        {
          eventId: 2,
          type: "discard_tile",
          source: "ws_in",
          ts: 11,
          payload: {
            seat: 1,
            tile: "9s",
            binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" },
            rawSummary
          }
        }
      ]
    };

    const { events, replayDedupe } = replayCaptureWithDiagnostics(liveCapture);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "discard_tile",
      payload: { seat: 1, tile: "9s" }
    });
    expect(replayDedupe).toMatchObject({
      ordering: "eventId",
      rawMessagesWithParsedEvents: 1,
      skippedLiveParsedEvents: 1,
      replayedEvents: 1
    });
  });

  it("does not treat Blob async placeholders as truncated replay samples", () => {
    const discardPayload = [
      ...protobufVarint(1, 1),
      ...protobufString(2, "9s")
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 12),
      ...protobufString(2, "ActionDiscardTile"),
      ...protobufBytes(3, discardPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);
    const liveCapture = {
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "raw_message",
          source: "ws_in",
          ts: 11,
          payload: {
            kind: "blob-arraybuffer",
            length: frame.byteLength,
            preview: `blob-arraybuffer(${frame.byteLength})`,
            sample: bytesToHex(frame),
            truncated: false,
            asyncSampleFor: "blob-async"
          }
        },
        {
          type: "raw_message",
          source: "ws_in",
          ts: 11,
          payload: {
            kind: "blob",
            length: frame.byteLength,
            preview: `Blob(${frame.byteLength}, unknown)`,
            sample: "",
            truncated: false,
            asyncSamplePending: true,
            sampleUnavailableReason: "blob-async"
          }
        }
      ]
    };

    const { events, replayDedupe } = replayCaptureWithDiagnostics(liveCapture);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "discard_tile",
      payload: { seat: 1, tile: "9s" }
    });
    expect(replayDedupe).toMatchObject({
      inputEvents: 2,
      rawMessages: 2,
      rawMessagesWithParsedEvents: 1,
      rawParsedEvents: 1,
      liveParsedEvents: 0,
      replayedEvents: 1
    });

    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "blob-async.json");
    writeFileSync(capturePath, JSON.stringify(liveCapture));
    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.eventTypes).toEqual(["discard_tile"]);
    expect(parsed.diagnostics).toMatchObject({
      rawMessages: 2,
      rawMessagesWithEnvelope: 1,
      truncatedRawMessages: 0,
      truncatedEnvelopes: 0,
      truncatedActionPayloads: 0
    });
    expect(parsed.recommendations).not.toContain("Some raw binary capture samples are truncated. Increase Binary sample bytes and collect a fresh capture before mapping missing fields.");
  });

  it("does not treat long diagnostic envelope samples as raw capture truncation", () => {
    const largeField = new Uint8Array(700).fill(7);
    const discardPayload = [
      ...protobufVarint(1, 1),
      ...protobufString(2, "9s"),
      ...protobufBytes(4, largeField)
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 12),
      ...protobufString(2, "ActionDiscardTile"),
      ...protobufBytes(3, discardPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "long-diagnostic-sample.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "raw_message",
          source: "ws_in",
          ts: 1,
          payload: {
            kind: "Uint8Array",
            length: frame.byteLength,
            preview: `Uint8Array(${frame.byteLength})`,
            sample: bytesToHex(frame),
            truncated: false
          }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.eventTypes).toEqual(["discard_tile"]);
    expect(parsed.diagnostics).toMatchObject({
      truncatedRawMessages: 0,
      truncatedEnvelopes: 0,
      truncatedActionPayloads: 0
    });
    expect(parsed.actionDiagnostics[0].sample.actionPayloadTruncated).toBe(true);
    expect(parsed.recommendations).not.toContain("Some raw binary capture samples are truncated. Increase Binary sample bytes and collect a fresh capture before mapping missing fields.");
  });

  it("keeps live parsed events when the raw sample cannot be replayed", () => {
    const rawSummary = {
      kind: "Uint8Array",
      length: 120,
      preview: "Uint8Array(120)",
      sample: "01",
      truncated: true
    };
    const liveCapture = {
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "discard_tile",
          source: "ws_in",
          ts: 11,
          payload: {
            seat: 1,
            tile: "9s",
            binaryEnvelope: { methodName: ".lq.ActionPrototype", actionName: "ActionDiscardTile" },
            rawSummary
          }
        },
        {
          type: "raw_message",
          source: "ws_in",
          ts: 11,
          payload: rawSummary
        }
      ]
    };

    const { events, replayDedupe } = replayCaptureWithDiagnostics(liveCapture);

    expect(events).toHaveLength(1);
    expect(replayDedupe).toMatchObject({
      inputEvents: 2,
      rawMessages: 1,
      rawMessagesWithParsedEvents: 0,
      rawParsedEvents: 0,
      liveParsedEvents: 1,
      skippedLiveParsedEvents: 0,
      retainedLiveParsedEvents: 1,
      fallbackLiveParsedEvents: 1,
      replayedEvents: 1
    });
    expect(events[0]).toMatchObject({
      type: "discard_tile",
      payload: { seat: 1, tile: "9s" }
    });
  });

  it("keeps helper diagnostic events out of replayed game events", () => {
    const liveCapture = {
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "capture_error",
          source: "ws_in",
          ts: 2,
          payload: { message: "capture failed" }
        },
        {
          type: "deal_hand",
          source: "fixture",
          ts: 1,
          payload: { tiles: ["1m", "2m", "3m"] }
        }
      ]
    };

    const { events, replayDedupe } = replayCaptureWithDiagnostics(liveCapture);

    expect(events.map((event) => event.type)).toEqual(["deal_hand"]);
    expect(replayDedupe).toMatchObject({
      inputEvents: 2,
      rawMessages: 0,
      liveParsedEvents: 1,
      diagnosticEvents: 1,
      replayedEvents: 1
    });

    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "capture-error.json");
    writeFileSync(capturePath, JSON.stringify(liveCapture));
    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.eventTypes).toEqual(["deal_hand"]);
    expect(parsed.captureSummary).toMatchObject({
      parsedEvents: 1,
      diagnosticEvents: 1,
      byParsedType: { deal_hand: 1 },
      byDiagnosticType: { capture_error: 1 }
    });
    expect(parsed.replayDedupe.diagnosticEvents).toBe(1);
    expect(parsed.recommendations[0]).toBe("Capture contains 1 helper capture_error event. Inspect recent debug events before trusting missing parser/state diagnostics.");
  });

  it("can drive GameState from replayed events", () => {
    const gameState = new GameState();
    for (const event of replayCapture(capture)) {
      gameState.applyEvent(event);
    }

    expect(gameState.getVisibleState().discards[3]).toEqual(["9s"]);
  });

  it("replays dora-like action samples into dora indicator state", () => {
    const doraPayload = [
      ...protobufString(1, "6p")
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 84),
      ...protobufString(2, "ActionNewDora"),
      ...protobufBytes(3, doraPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);
    const doraCapture = {
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "raw_message",
          source: "ws_in",
          ts: 1,
          payload: {
            kind: "Uint8Array",
            length: frame.byteLength,
            preview: `Uint8Array(${frame.byteLength})`,
            sample: bytesToHex(frame),
            truncated: false
          }
        }
      ]
    };

    const events = replayCapture(doraCapture);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "dora",
      payload: {
        tile: "6p",
        doraIndicators: ["6p"]
      }
    });

    const gameState = new GameState();
    for (const event of events) gameState.applyEvent(event);
    expect(gameState.getVisibleState()).toMatchObject({
      doraIndicators: ["6p"],
      visibleTiles: ["6p"]
    });
  });

  it("replays GameRestore snapshots and counts nested actions in diagnostics", () => {
    const playerPayload = [
      ...protobufVarint(1, 26000),
      ...protobufString(4, "9s")
    ];
    const snapshotPayload = [
      ...protobufVarint(1, 1),
      ...protobufVarint(2, 2),
      ...protobufVarint(3, 1),
      ...protobufVarint(5, 42),
      ...protobufString(6, "1m"),
      ...protobufString(6, "2m"),
      ...protobufString(6, "3m"),
      ...protobufString(7, "4p"),
      ...protobufBytes(9, playerPayload)
    ];
    const discardPayload = [
      ...protobufVarint(1, 3),
      ...protobufString(2, "8s")
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 91),
      ...protobufString(2, "ActionDiscardTile"),
      ...protobufBytes(3, discardPayload)
    ];
    const restorePayload = [
      ...protobufBytes(1, snapshotPayload),
      ...protobufBytes(2, actionPrototypePayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.GameRestore"),
      ...protobufBytes(2, restorePayload)
    ]);
    const restoreCapture = {
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "raw_message",
          source: "ws_in",
          ts: 1,
          payload: {
            kind: "Uint8Array",
            length: frame.byteLength,
            preview: `Uint8Array(${frame.byteLength})`,
            sample: bytesToHex(frame),
            truncated: false
          }
        }
      ]
    };

    const events = replayCapture(restoreCapture);
    expect(events.map((event) => event.type)).toEqual(["round_start", "discard_tile"]);

    const gameState = new GameState();
    for (const event of events) gameState.applyEvent(event);
    expect(gameState.getVisibleState()).toMatchObject({
      chang: 1,
      ju: 2,
      honba: 1,
      hand: ["1m", "2m", "3m"],
      doraIndicators: ["4p"],
      discards: [["9s"], [], [], ["8s"]]
    });

    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "restore.json");
    writeFileSync(capturePath, JSON.stringify(restoreCapture));
    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);
    expect(parsed.captureSummary.byActionName).toEqual({ ActionDiscardTile: 1 });
    expect(parsed.diagnostics).toMatchObject({
      rawMessages: 1,
      rawMessagesWithEnvelope: 1,
      rawActionTotal: 1,
      parsedActionTotal: 1,
      parsedActionCoverage: 1
    });
    expect(parsed.actionDiagnostics[0]).toMatchObject({
      name: "ActionDiscardTile",
      methodName: ".lq.GameRestore",
      count: 1,
      parsedCount: 1,
      unparsedCount: 0
    });
  });

  it("replays ResSyncGame game_restore snapshots and counts nested actions in diagnostics", () => {
    const playerPayload = [
      ...protobufVarint(1, 26000),
      ...protobufString(4, "9s")
    ];
    const snapshotPayload = [
      ...protobufVarint(1, 2),
      ...protobufVarint(2, 3),
      ...protobufVarint(5, 41),
      ...protobufString(6, "1m"),
      ...protobufString(6, "2m"),
      ...protobufString(6, "3m"),
      ...protobufString(7, "5p"),
      ...protobufBytes(9, playerPayload)
    ];
    const discardPayload = [
      ...protobufVarint(1, 2),
      ...protobufString(2, "7s")
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 101),
      ...protobufString(2, "ActionDiscardTile"),
      ...protobufBytes(3, discardPayload)
    ];
    const restorePayload = [
      ...protobufBytes(1, snapshotPayload),
      ...protobufBytes(2, actionPrototypePayload)
    ];
    const syncPayload = [
      ...protobufVarint(3, 101),
      ...protobufBytes(4, restorePayload)
    ];
    const frame = new Uint8Array([
      3,
      0x34,
      0x12,
      ...protobufString(1, ".lq.ResSyncGame"),
      ...protobufBytes(2, syncPayload)
    ]);
    const syncCapture = {
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "raw_message",
          source: "ws_in",
          ts: 1,
          payload: {
            kind: "Uint8Array",
            length: frame.byteLength,
            preview: `Uint8Array(${frame.byteLength})`,
            sample: bytesToHex(frame),
            truncated: false
          }
        }
      ]
    };

    const events = replayCapture(syncCapture);
    expect(events.map((event) => event.type)).toEqual(["round_start", "discard_tile"]);

    const gameState = new GameState();
    for (const event of events) gameState.applyEvent(event);
    expect(gameState.getVisibleState()).toMatchObject({
      chang: 2,
      ju: 3,
      hand: ["1m", "2m", "3m"],
      doraIndicators: ["5p"],
      discards: [["9s"], [], ["7s"], []]
    });

    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "sync-game-restore.json");
    writeFileSync(capturePath, JSON.stringify(syncCapture));
    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);
    expect(parsed.captureSummary.byMethodName).toEqual({ ".lq.ResSyncGame": 1 });
    expect(parsed.captureSummary.byActionName).toEqual({ ActionDiscardTile: 1 });
    expect(parsed.diagnostics).toMatchObject({
      rawMessages: 1,
      rawMessagesWithEnvelope: 1,
      rawActionTotal: 1,
      parsedActionTotal: 1,
      parsedActionCoverage: 1
    });
    expect(parsed.actionDiagnostics[0]).toMatchObject({
      name: "ActionDiscardTile",
      methodName: ".lq.ResSyncGame",
      count: 1,
      parsedCount: 1,
      unparsedCount: 0
    });
  });

  it("replays ResEnterGame game_restore snapshots and counts nested actions in diagnostics", () => {
    const playerPayload = [
      ...protobufVarint(1, 25000),
      ...protobufString(4, "2z")
    ];
    const snapshotPayload = [
      ...protobufVarint(1, 0),
      ...protobufVarint(2, 1),
      ...protobufVarint(3, 2),
      ...protobufVarint(5, 52),
      ...protobufString(6, "4m"),
      ...protobufString(6, "5m"),
      ...protobufString(6, "6m"),
      ...protobufString(7, "3s"),
      ...protobufBytes(9, playerPayload)
    ];
    const dealPayload = [
      ...protobufVarint(1, 0),
      ...protobufString(2, "7m"),
      ...protobufVarint(3, 51)
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 12),
      ...protobufString(2, "ActionDealTile"),
      ...protobufBytes(3, dealPayload)
    ];
    const restorePayload = [
      ...protobufBytes(1, snapshotPayload),
      ...protobufBytes(2, actionPrototypePayload)
    ];
    const enterPayload = [
      ...protobufVarint(2, 0),
      ...protobufBytes(4, restorePayload)
    ];
    const frame = new Uint8Array([
      3,
      0x56,
      0x34,
      ...protobufString(1, ".lq.ResEnterGame"),
      ...protobufBytes(2, enterPayload)
    ]);
    const enterCapture = {
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "raw_message",
          source: "ws_in",
          ts: 1,
          payload: {
            kind: "Uint8Array",
            length: frame.byteLength,
            preview: `Uint8Array(${frame.byteLength})`,
            sample: bytesToHex(frame),
            truncated: false
          }
        }
      ]
    };

    const events = replayCapture(enterCapture);
    expect(events.map((event) => event.type)).toEqual(["round_start", "draw_tile"]);

    const gameState = new GameState();
    for (const event of events) gameState.applyEvent(event);
    expect(gameState.getVisibleState()).toMatchObject({
      chang: 0,
      ju: 1,
      honba: 2,
      hand: ["4m", "5m", "6m"],
      drawnTile: "7m",
      doraIndicators: ["3s"],
      discards: [["2z"], [], [], []],
      currentTurn: 0
    });

    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "enter-game-restore.json");
    writeFileSync(capturePath, JSON.stringify(enterCapture));
    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);
    expect(parsed.captureSummary.byMethodName).toEqual({ ".lq.ResEnterGame": 1 });
    expect(parsed.captureSummary.byActionName).toEqual({ ActionDealTile: 1 });
    expect(parsed.diagnostics).toMatchObject({
      rawMessages: 1,
      rawMessagesWithEnvelope: 1,
      rawActionTotal: 1,
      parsedActionTotal: 1,
      parsedActionCoverage: 1
    });
    expect(parsed.actionDiagnostics[0]).toMatchObject({
      name: "ActionDealTile",
      methodName: ".lq.ResEnterGame",
      count: 1,
      parsedCount: 1,
      unparsedCount: 0
    });
  });

  it("does not replay unsupported binary response methods as empty round starts", () => {
    const frame = new Uint8Array([
      3,
      0x01,
      0x00,
      ...protobufString(1, ".lq.ResAuthGame"),
      ...protobufBytes(2, [
        ...protobufVarint(4, 1)
      ])
    ]);
    const capture = {
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "raw_message",
          source: "ws_in",
          ts: 1,
          payload: {
            kind: "Uint8Array",
            length: frame.byteLength,
            preview: `Uint8Array(${frame.byteLength})`,
            sample: bytesToHex(frame),
            truncated: false
          }
        }
      ]
    };

    const events = replayCapture(capture);
    expect(events).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "unsupported-response.json");
    writeFileSync(capturePath, JSON.stringify(capture));
    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);
    expect(parsed.eventTypes).toEqual([]);
    expect(parsed.captureSummary.byMethodName).toEqual({ ".lq.ResAuthGame": 1 });
    expect(parsed.diagnostics.unparsedMethods).toEqual([
      { name: ".lq.ResAuthGame", count: 1 }
    ]);
    expect(parsed.recommendations).toContain(
      "Only non-action Liqi methods were captured (.lq.ResAuthGame). Wait for ActionPrototype or game_restore traffic from an in-table hand before changing parser mappings."
    );
    expect(parsed.gameState).toMatchObject({
      hand: [],
      round: null,
      chang: null,
      ju: null,
      scoresKnown: false,
      warnings: []
    });
  });

  it("prints sorted summary sections from the replay CLI", () => {
    const output = execFileSync("node", ["scripts/replay-capture.mjs", "tests/fixtures/capture-action-discard.json"], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.captureMetadata).toMatchObject({
      formatVersion: 1,
      helperDiagnostics: null
    });
    expect(parsed.captureSummary).toMatchObject({
      rawMessages: 1,
      byKind: { Uint8Array: 1 }
    });
    expect(parsed.replaySummary).toMatchObject({
      parsedEvents: 1,
      byParsedType: { discard_tile: 1 }
    });
    expect(parsed.topReplayedParsedTypes).toEqual([{ name: "discard_tile", count: 1 }]);
    expect(parsed.replayDedupe).toMatchObject({
      inputEvents: 1,
      rawMessages: 1,
      rawMessagesWithParsedEvents: 1,
      rawParsedEvents: 1,
      liveParsedEvents: 0,
      skippedLiveParsedEvents: 0,
      retainedLiveParsedEvents: 0,
      fallbackLiveParsedEvents: 0,
      replayedEvents: 1
    });
    expect(parsed.diagnostics).toMatchObject({
      rawMessages: 1,
      inboundRawMessages: 1,
      outboundRawMessages: 0,
      rawMessagesWithEnvelope: 1,
      truncatedRawMessages: 0,
      truncatedEnvelopes: 0,
      truncatedActionPayloads: 0,
      rawActionTotal: 1,
      parsedActionTotal: 1,
      parsedActionCoverage: 1,
      unparsedActions: [],
      unparsedMethods: []
    });
    expect(parsed.actionDiagnostics).toEqual([
      {
        name: "ActionDiscardTile",
        methodName: ".lq.ActionPrototype",
        count: 1,
        parsedCount: 1,
        unparsedCount: 0,
        sample: {
          source: "ws_in",
          kind: "Uint8Array",
          messageLength: 55,
          payloadLength: 31,
          actionPayloadLength: 8,
          payloadTruncated: false,
          actionPayloadTruncated: false,
          actionPayloadFields: {
            varints: [
              { field: 1, values: [3] },
              { field: 5, values: [1] }
            ],
            strings: [{ field: 2, values: ["9s"] }],
            tileStrings: [{ field: 2, values: ["9s"] }]
          }
        }
      }
    ]);
    expect(parsed.topParsedTypes).toEqual([]);
    expect(parsed.eventTypes).toEqual(["discard_tile"]);
    expect(parsed.recommendations).toEqual([
      "Capture does not yet satisfy real-page MVP acceptance. Missing: drawTileParsed, drawTileSeatParsed, gameStateHandUpdated, gameStateRoundMetadataUpdated, gameStateDrawnTileUpdated, gameStateDoraIndicatorsUpdated, gameStateScoresUpdated."
    ]);
    expect(parsed.acceptance).toEqual({
      readyForRealPageMvp: false,
      checks: {
        rawMessagesCaptured: true,
        binaryEnvelopeDecoded: true,
        actionPrototypeDecoded: true,
        drawTileParsed: false,
        drawTileSeatParsed: false,
        discardTileParsed: true,
        discardTileSeatParsed: true,
        gameStateHandUpdated: false,
        gameStateRoundMetadataUpdated: false,
        gameStateDrawnTileUpdated: false,
        gameStateDiscardsUpdated: true,
        gameStateDoraIndicatorsUpdated: false,
        gameStateScoresUpdated: false,
        gameStateVisibleTilesUpdated: true,
        gameStateWarningsClear: true
      },
      missing: ["drawTileParsed", "drawTileSeatParsed", "gameStateHandUpdated", "gameStateRoundMetadataUpdated", "gameStateDrawnTileUpdated", "gameStateDoraIndicatorsUpdated", "gameStateScoresUpdated"]
    });
  });

  it("can write a sanitized parsed fixture from the replay CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const fixturePath = join(dir, "fixture.json");
    execFileSync("node", [
      "scripts/replay-capture.mjs",
      "tests/fixtures/capture-action-discard.json",
      "--fixture-out",
      fixturePath
    ]);

    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    expect(fixture).toMatchObject({
      fixtureVersion: 1,
      fixtureKind: "sanitized-replay",
      generatedBy: "scripts/replay-capture.mjs --fixture-out",
      sourceSummary: {
        readyForRealPageMvp: false,
        eventCount: 1,
        eventTypes: ["discard_tile"],
        warnings: []
      },
      eventTypes: ["discard_tile"],
      events: [
        {
          type: "discard_tile",
          source: "ws_in",
          payload: {
            seat: 3,
            tile: "9s"
          }
        }
      ],
      gameState: {
        discards: [[], [], [], ["9s"]]
      }
    });
    expect(JSON.stringify(fixture)).not.toContain("rawSummary");
    expect(JSON.stringify(fixture)).not.toContain("payloadSample");
    expect(JSON.stringify(fixture)).not.toContain("captureMetadata");
  });

  it("prints capture helper diagnostics when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "diagnostics.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-25T00:00:00.000Z",
      formatVersion: 1,
      limit: 200,
      page: {
        origin: "https://game.maj-soul.com",
        host: "game.maj-soul.com",
        pathname: "/1/",
        sanitizedUrl: "https://game.maj-soul.com/1/"
      },
      helperDiagnostics: {
        installed: true,
        installAttempts: 1,
        installedAt: "2026-05-25T00:00:00.000Z",
        installFailureReason: "",
        webSocketAvailable: true,
        maxEvents: 100,
        binarySampleBytes: 2048
      },
      events: []
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.captureMetadata).toEqual({
      exportedAt: "2026-05-25T00:00:00.000Z",
      formatVersion: 1,
      limit: 200,
      page: {
        origin: "https://game.maj-soul.com",
        host: "game.maj-soul.com",
        pathname: "/1/",
        sanitizedUrl: "https://game.maj-soul.com/1/"
      },
      helperDiagnostics: {
        installed: true,
        installAttempts: 1,
        installedAt: "2026-05-25T00:00:00.000Z",
        installFailureReason: "",
        webSocketAvailable: true,
        maxEvents: 100,
        binarySampleBytes: 2048
      },
      liveRealPagePreflight: null,
      liveSafetySettings: null,
      verification: null
    });
  });

  it("carries overlay verification commands into capture metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "verification.json");
    writeFileSync(capturePath, JSON.stringify({
      ...readyCapture,
      verification: {
        recommendedPath: "captures/capture-real.json",
        commands: {
          doctor: "npm run capture-doctor -- captures/capture-real.json",
          replay: "npm run replay -- captures/capture-real.json",
          realPageGate: "npm run real-page-gate"
        },
        realPageReadyRequires: [
          "Mahjong Soul page metadata",
          "overlay live snapshots",
          "liveRealPagePreflight.readyToExport=true",
          "safe liveSafetySettings",
          "acceptance.readyForRealPageMvp=true",
          "liveStateSnapshotMatches=true"
        ]
      }
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.captureMetadata.verification).toMatchObject({
      recommendedPath: "captures/capture-real.json",
      commands: {
        doctor: "npm run capture-doctor -- captures/capture-real.json",
        realPageGate: "npm run real-page-gate"
      }
    });
  });

  it("reports capture integrity for overlay exports", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "overlay-export-integrity.json");
    writeFileSync(capturePath, JSON.stringify({
      ...readyCapture,
      note: "Majsoul Helper capture export. Contains message summaries/samples plus liveGameState, liveDebugSummary, liveMvpGate, and liveRealPagePreflight snapshots copied from the overlay; no messages were modified by the helper.",
      page: {
        origin: "https://mahjongsoul.game.yo-star.com",
        host: "mahjongsoul.game.yo-star.com",
        pathname: "/",
        sanitizedUrl: "https://mahjongsoul.game.yo-star.com/"
      },
      helperDiagnostics: {
        installed: true,
        paused: false,
        webSocketAvailable: true,
        socketsCreated: 1,
        binarySampleBytes: 2048
      },
      verification: {
        recommendedPath: "captures/capture-real.json",
        commands: {
          doctor: "npm run capture-doctor -- captures/capture-real.json",
          replay: "npm run replay -- captures/capture-real.json",
          realPageGate: "npm run real-page-gate"
        },
        realPageReadyRequires: [
          "Mahjong Soul page metadata",
          "overlay live snapshots",
          "liveRealPagePreflight.readyToExport=true",
          "safe liveSafetySettings",
          "acceptance.readyForRealPageMvp=true",
          "liveStateSnapshotMatches=true"
        ]
      },
      liveGameState: {
        hand: ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "1z"],
        drawnTile: "5m",
        discards: [[], ["9s"], [], []],
        doraIndicators: ["4p"],
        currentTurn: null,
        visibleTiles: ["4p", "9s"],
        warnings: []
      },
      liveDebugSummary: {
        raw: 3,
        parsed: 3,
        inbound: 3,
        outbound: 0,
        envelopes: 2,
        truncated: 0,
        methods: 1,
        actions: 2,
        captureErrors: 0,
        diagnostics: 0
      },
      liveMvpGate: {
        checks: {
          rawMessagesCaptured: true,
          binaryEnvelopeDecoded: true,
          actionPrototypeDecoded: true,
          drawTileParsed: true,
          drawTileSeatParsed: true,
          discardTileParsed: true,
          discardTileSeatParsed: true,
          gameStateHandUpdated: true,
          gameStateRoundMetadataUpdated: true,
          gameStateDrawnTileUpdated: true,
          gameStateDiscardsUpdated: true,
          gameStateDoraIndicatorsUpdated: true,
          gameStateScoresUpdated: true,
          gameStateVisibleTilesUpdated: true,
          gameStateWarningsClear: true
        },
        passed: 15,
        total: 15,
        missing: []
      },
      liveRealPagePreflight: {
        preflightVersion: REAL_PAGE_PREFLIGHT_VERSION,
        requiredChecks: [...REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS],
        checks: {
          mahjongSoulPage: true,
          hookInstalled: true,
          captureRunning: true,
          liveSnapshotsIncluded: true,
          liveMvpGateReady: true,
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
        },
        passed: 15,
        total: 15,
        missing: [],
        hints: [],
        readyToExport: true
      },
      liveCaptureHealth: "Standard game events parsed. Compare gameState with the visible table.",
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
      events: readyCapture.events.map((event, index) => ({ ...event, eventId: index + 1 }))
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.captureIntegrity).toMatchObject({
      readyForRealPageExport: true,
      requiredMissing: [],
      recommendedMissing: [],
      eventCount: 3,
      checks: {
        pageMetadataPresent: true,
        helperDiagnosticsPresent: true,
        liveGameStatePresent: true,
        liveDebugSummaryPresent: true,
        liveMvpGatePresent: true,
        liveRealPagePreflightPresent: true,
        liveRealPagePreflightVersionCurrent: true,
        liveRealPagePreflightRequiredChecksPresent: true,
        liveSafetySettingsPresent: true,
        verificationCommandsPresent: true,
        verificationRequirementsPresent: true,
        eventIdsPresent: true
      }
    });
    expect(parsed.captureMetadata.liveSafetySettings).toMatchObject({
      realtimeAdviceEnabled: false,
      automationDisabled: true,
      clickAutomationDisabled: true,
      messageMutationDisabled: true
    });
  });

  it("recommends hook compatibility checks when constructor statics fail to copy", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "constructor-statics-failed.json");
    writeFileSync(capturePath, JSON.stringify({
      ...readyCapture,
      helperDiagnostics: {
        installed: true,
        installAttempts: 1,
        installedAt: "2026-05-25T00:00:00.000Z",
        installFailureReason: "",
        webSocketAvailable: true,
        hooks: {
          constructor: true,
          constructorStatics: {
            copied: 3,
            failed: ["OPEN", "CLOSED"]
          },
          prototypeConstructor: "failed: readonly constructor",
          send: true,
          addEventListener: true,
          removeEventListener: true,
          onmessage: true,
          onmessageMode: "accessor"
        },
        socketsCreated: 1,
        recentSocketUrls: ["wss://example.test/socket"],
        maxEvents: 100,
        binarySampleBytes: 512
      }
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.acceptance.readyForRealPageMvp).toBe(true);
    expect(parsed.captureMetadata.helperDiagnostics.hooks.constructorStatics.failed).toEqual(["OPEN", "CLOSED"]);
    expect(parsed.recommendations).toEqual([
      "WebSocket constructor static properties failed to copy: OPEN, CLOSED. Inspect hook compatibility before trusting the live page capture.",
      "WebSocket prototype.constructor was not patched (failed: readonly constructor). Inspect hook compatibility before trusting the live page capture."
    ]);
  });

  it("recommends increasing capture limit when older helper events were dropped", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "buffer-dropped.json");
    writeFileSync(capturePath, JSON.stringify({
      ...readyCapture,
      helperDiagnostics: {
        installed: true,
        installAttempts: 1,
        installedAt: "2026-05-25T00:00:00.000Z",
        installFailureReason: "",
        webSocketAvailable: true,
        hooks: {
          constructor: true,
          send: true,
          addEventListener: true,
          removeEventListener: true,
          onmessage: true,
          onmessageMode: "accessor"
        },
        socketsCreated: 1,
        recentSocketUrls: ["wss://example.test/socket"],
        maxEvents: 2,
        binarySampleBytes: 512,
        eventBuffer: {
          maxEvents: 2,
          retainedEvents: 2,
          totalEventsSinceClear: 13,
          oldestEventId: 12,
          newestEventId: 13,
          droppedBeforeRetained: 11
        }
      }
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.acceptance.readyForRealPageMvp).toBe(true);
    expect(parsed.recommendations).toEqual([
      "Capture retained 2 of 13 helper events; 11 older events were dropped before export. Increase Capture limit and collect from round start if round metadata or hand state is missing."
    ]);
  });

  it("does not mark acceptance ready when state warnings are present", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "draw-discard.json");
    writeFileSync(capturePath, JSON.stringify(drawDiscardCapture));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.eventTypes).toEqual(["discard_tile", "draw_tile"]);
    expect(parsed.acceptance).toEqual({
      readyForRealPageMvp: false,
      checks: {
        rawMessagesCaptured: true,
        binaryEnvelopeDecoded: true,
        actionPrototypeDecoded: true,
        drawTileParsed: true,
        drawTileSeatParsed: true,
        discardTileParsed: true,
        discardTileSeatParsed: true,
        gameStateHandUpdated: false,
        gameStateRoundMetadataUpdated: false,
        gameStateDrawnTileUpdated: true,
        gameStateDiscardsUpdated: true,
        gameStateDoraIndicatorsUpdated: false,
        gameStateScoresUpdated: false,
        gameStateVisibleTilesUpdated: true,
        gameStateWarningsClear: false
      },
      missing: ["gameStateHandUpdated", "gameStateRoundMetadataUpdated", "gameStateDoraIndicatorsUpdated", "gameStateScoresUpdated", "gameStateWarningsClear"]
    });
    expect(parsed.recommendations).toEqual([
      "Capture does not yet satisfy real-page MVP acceptance. Missing: gameStateHandUpdated, gameStateRoundMetadataUpdated, gameStateDoraIndicatorsUpdated, gameStateScoresUpdated, gameStateWarningsClear."
    ]);
    expect(parsed.warnings).toEqual(["drawnTile exists without base hand"]);
  });

  it("marks acceptance ready only when draw, discard, and clean gameState updates are present", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "ready.json");
    writeFileSync(capturePath, JSON.stringify(readyCapture));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.eventTypes).toEqual(["round_start", "draw_tile", "discard_tile"]);
    expect(parsed.stateDiagnostics).toMatchObject({
      eventCounts: {
        round_start: 1,
        draw_tile: 1,
        discard_tile: 1
      },
      stateUpdated: {
        hand: true,
        drawnTile: true,
        discards: true,
        melds: false,
        doraIndicators: true,
        roundMetadata: true,
        riichi: false,
        scores: true,
        visibleTiles: true,
        warningsClear: true
      }
    });
    expect(parsed.stateCoverage).toMatchObject({
      requiredPassed: true,
      requiredMissing: [],
      required: {
        gameStateHandUpdated: true,
        gameStateRoundMetadataUpdated: true,
        gameStateScoresUpdated: true,
        gameStateWarningsClear: true
      },
      optional: {
        melds: {
          observed: false,
          updated: false,
          eventCount: 0
        },
        riichi: {
          observed: false,
          updated: false,
          eventCount: 0
        },
        roundEndScores: {
          observed: false,
          updated: true,
          eventCount: 0
        }
      }
    });
    expect(parsed.acceptance).toEqual({
      readyForRealPageMvp: true,
      checks: {
        rawMessagesCaptured: true,
        binaryEnvelopeDecoded: true,
        actionPrototypeDecoded: true,
        drawTileParsed: true,
        drawTileSeatParsed: true,
        discardTileParsed: true,
        discardTileSeatParsed: true,
        gameStateHandUpdated: true,
        gameStateRoundMetadataUpdated: true,
        gameStateDrawnTileUpdated: true,
        gameStateDiscardsUpdated: true,
        gameStateDoraIndicatorsUpdated: true,
        gameStateScoresUpdated: true,
        gameStateVisibleTilesUpdated: true,
        gameStateWarningsClear: true
      },
      missing: []
    });
    expect(parsed.warnings).toEqual([]);
    expect(parsed.recommendations).toEqual([
      "Capture looks usable for current parser coverage. Validate gameState against the visible table state."
    ]);
  });

  it("fails acceptance when observed optional events do not update state", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "ready-with-broken-call.json");
    writeFileSync(capturePath, JSON.stringify({
      ...readyCapture,
      events: [
        {
          type: "call_meld",
          source: "fixture",
          ts: 4,
          payload: {
            meld: ["3p", "4p", "5p"],
            binaryEnvelope: { actionName: "ActionChiPengGang" }
          }
        },
        ...readyCapture.events
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.eventTypes).toEqual(["round_start", "draw_tile", "discard_tile", "call_meld"]);
    expect(parsed.acceptance).toMatchObject({
      readyForRealPageMvp: false,
      checks: {
        rawMessagesCaptured: true,
        gameStateWarningsClear: true,
        callMeldSeatParsed: false,
        gameStateMeldsUpdated: false
      },
      missing: expect.arrayContaining(["callMeldSeatParsed", "gameStateMeldsUpdated"])
    });
    expect(parsed.stateCoverage).toMatchObject({
      requiredPassed: false,
      required: {
        callMeldSeatParsed: false,
        gameStateMeldsUpdated: false
      },
      requiredMissing: expect.arrayContaining(["callMeldSeatParsed", "gameStateMeldsUpdated"]),
      optional: {
        melds: {
          observed: true,
          seatParsed: false,
          updated: false,
          eventCount: 1
        }
      }
    });
    expect(parsed.recommendations).toContain(
      "call_meld events replayed, but meld state did not update. Inspect call seat and meld tile fields in actionPayloadFields."
    );
    expect(parsed.recommendations).toContain(
      "call_meld events replayed, but no valid caller seat was parsed. Inspect ActionChiPengGang/ActionAnGangAddGang seat fields before trusting meld state."
    );
  });

  it("compares replayed state with a live gameState snapshot when capture includes one", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "ready-with-live-state.json");
    writeFileSync(capturePath, JSON.stringify({
      ...readyCapture,
      liveGameState: {
        hand: ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "1z"],
        drawnTile: "5m",
        discards: [[], ["9s"], [], []],
        doraIndicators: ["4p"],
        currentTurn: 0,
        visibleTiles: ["4p", "9s"],
        warnings: []
      },
      liveDebugSummary: {
        raw: 3,
        parsed: 3,
        inbound: 3,
        outbound: 0,
        envelopes: 2,
        truncated: 0,
        methods: 1,
        actions: 2,
        captureErrors: 0,
        diagnostics: 0,
        unparsedActions: {}
      },
      liveMvpGate: {
        checks: {
          rawMessagesCaptured: true,
          drawTileParsed: true,
          discardTileParsed: true,
          gameStateWarningsClear: true
        },
        passed: 4,
        total: 4,
        missing: []
      },
      liveCaptureHealth: "Standard game events parsed. Compare gameState with the visible table."
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.liveOverlay).toMatchObject({
      available: true,
      debugSummary: {
        raw: 3,
        parsed: 3
      },
      mvpGate: {
        passed: 4,
        total: 4,
        missing: []
      },
      captureHealth: "Standard game events parsed. Compare gameState with the visible table.",
      gateComparison: {
        available: true,
        comparedKeys: ["rawMessagesCaptured", "drawTileParsed", "discardTileParsed", "gameStateWarningsClear"],
        mismatches: []
      }
    });

    expect(parsed.liveStateComparison).toMatchObject({
      available: true,
      comparedKeys: ["hand", "drawnTile", "discards", "doraIndicators", "currentTurn", "visibleTiles", "warnings"],
      matchingKeys: ["hand", "drawnTile", "discards", "doraIndicators", "visibleTiles", "warnings"],
      mismatches: [
        { key: "currentTurn", live: 0, replayed: null }
      ]
    });
    expect(parsed.acceptance).toMatchObject({
      readyForRealPageMvp: false,
      checks: {
        liveStateSnapshotMatches: false
      },
      missing: expect.arrayContaining(["liveStateSnapshotMatches"])
    });
    expect(parsed.stateCoverage).toMatchObject({
      required: {
        liveStateSnapshotMatches: false
      },
      requiredMissing: expect.arrayContaining(["liveStateSnapshotMatches"])
    });
    expect(parsed.recommendations).toContain(
      "Replay state differs from liveGameState snapshot for: currentTurn. Increase capture limit or collect from round start before trusting replayed state."
    );
  });

  it("does not require the final drawn tile to remain after own discard", () => {
    const drawPayload = [
      ...protobufVarint(1, 0),
      ...protobufString(2, "5m"),
      ...protobufVarint(3, 55)
    ];
    const drawActionPayload = [
      ...protobufVarint(1, 10),
      ...protobufString(2, "ActionDealTile"),
      ...protobufBytes(3, drawPayload)
    ];
    const discardPayload = [
      ...protobufVarint(1, 0),
      ...protobufString(2, "5m")
    ];
    const discardActionPayload = [
      ...protobufVarint(1, 11),
      ...protobufString(2, "ActionDiscardTile"),
      ...protobufBytes(3, discardPayload)
    ];
    const drawFrame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, drawActionPayload)
    ]);
    const discardFrame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, discardActionPayload)
    ]);
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "own-draw-discard.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "raw_message",
          source: "ws_in",
          ts: 3,
          payload: {
            kind: "Uint8Array",
            length: discardFrame.byteLength,
            preview: `Uint8Array(${discardFrame.byteLength})`,
            sample: bytesToHex(discardFrame),
            truncated: false
          }
        },
        {
          type: "raw_message",
          source: "ws_in",
          ts: 2,
          payload: {
            kind: "Uint8Array",
            length: drawFrame.byteLength,
            preview: `Uint8Array(${drawFrame.byteLength})`,
            sample: bytesToHex(drawFrame),
            truncated: false
          }
        },
        {
          type: "raw_message",
          source: "ws_in",
          ts: 1,
          payload: {
            kind: "text",
            length: 215,
            preview: "{\"name\":\"round_start\",\"data\":{\"round\":\"0-1\",\"chang\":0,\"ju\":1,\"honba\":0,\"riichiSticks\":0,\"tiles\":[\"1m\",\"2m\",\"3m\",\"4m\",\"5m\",\"6m\",\"7m\",\"8m\",\"9m\",\"1p\",\"2p\",\"3p\",\"1z\"],\"doraIndicators\":[\"4p\"],\"scores\":[25000,25000,25000,25000],\"leftTileCount\":70}}",
            sample: "{\"name\":\"round_start\",\"data\":{\"round\":\"0-1\",\"chang\":0,\"ju\":1,\"honba\":0,\"riichiSticks\":0,\"tiles\":[\"1m\",\"2m\",\"3m\",\"4m\",\"5m\",\"6m\",\"7m\",\"8m\",\"9m\",\"1p\",\"2p\",\"3p\",\"1z\"],\"doraIndicators\":[\"4p\"],\"scores\":[25000,25000,25000,25000],\"leftTileCount\":70}}",
            truncated: false
          }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.gameState.drawnTile).toBeNull();
    expect(parsed.gameState.discards[0]).toEqual(["5m"]);
    expect(parsed.stateDiagnostics).toMatchObject({
      ownDrawTileEvents: 1,
      ownDrawTileEventsWithValidTile: 1,
      drawnTileRetained: false,
      stateUpdated: {
        drawnTile: true,
        discards: true,
        warningsClear: true
      }
    });
    expect(parsed.acceptance.readyForRealPageMvp).toBe(true);
    expect(parsed.acceptance.checks.gameStateDrawnTileUpdated).toBe(true);
  });

  it("uses strict mode as a machine-readable acceptance gate", () => {
    const ready = spawnSync("node", ["scripts/replay-capture.mjs", "tests/fixtures/capture-ready.json", "--strict"], {
      encoding: "utf8"
    });
    expect(ready.status).toBe(0);
    expect(JSON.parse(ready.stdout).acceptance.readyForRealPageMvp).toBe(true);

    const notReady = spawnSync("node", ["scripts/replay-capture.mjs", "tests/fixtures/capture-action-discard.json", "--strict"], {
      encoding: "utf8"
    });
    expect(notReady.status).toBe(2);
    const parsed = JSON.parse(notReady.stdout);
    expect(parsed.acceptance.readyForRealPageMvp).toBe(false);
    expect(parsed.acceptance.missing).toContain("drawTileParsed");
  });

  it("reports captured ActionPrototype names that do not replay into standard events", () => {
    const unknownPayload = [
      ...protobufVarint(1, 12),
      ...protobufString(2, "ActionFutureThing"),
      ...protobufBytes(3, protobufVarint(1, 3))
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, unknownPayload)
    ]);
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "unknown-action.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "raw_message",
          source: "ws_in",
          ts: 1,
          payload: {
            kind: "Uint8Array",
            length: frame.byteLength,
            preview: `Uint8Array(${frame.byteLength})`,
            sample: bytesToHex(frame),
            truncated: false
          }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.eventTypes).toEqual([]);
    expect(parsed.diagnostics).toMatchObject({
      rawMessages: 1,
      rawMessagesWithEnvelope: 1,
      truncatedRawMessages: 0,
      truncatedEnvelopes: 0,
      truncatedActionPayloads: 0,
      rawActionTotal: 1,
      parsedActionTotal: 0,
      parsedActionCoverage: 0,
      unparsedActions: [{ name: "ActionFutureThing", count: 1 }]
    });
    expect(parsed.actionDiagnostics).toEqual([
      {
        name: "ActionFutureThing",
        methodName: ".lq.ActionPrototype",
        count: 1,
        parsedCount: 0,
        unparsedCount: 1,
        sample: {
          source: "ws_in",
          kind: "Uint8Array",
          messageLength: frame.byteLength,
          payloadLength: 25,
          actionPayloadLength: 2,
          payloadTruncated: false,
          actionPayloadTruncated: false,
          actionPayloadFields: {
            varints: [{ field: 1, values: [3] }],
            strings: [],
            tileStrings: []
          }
        }
      }
    ]);
    expect(parsed.recommendations).toContain("Map unparsed ActionPrototype events: ActionFutureThing.");
    expect(parsed.acceptance).toMatchObject({
      readyForRealPageMvp: false,
      checks: {
        rawMessagesCaptured: true,
        binaryEnvelopeDecoded: true,
        actionPrototypeDecoded: true,
        drawTileParsed: false,
        drawTileSeatParsed: false,
        discardTileParsed: false,
        discardTileSeatParsed: false,
        gameStateHandUpdated: false,
        gameStateRoundMetadataUpdated: false,
        gameStateDrawnTileUpdated: false,
        gameStateDiscardsUpdated: false,
        gameStateDoraIndicatorsUpdated: false,
        gameStateScoresUpdated: false,
        gameStateVisibleTilesUpdated: false,
        gameStateWarningsClear: true
      },
      missing: [
        "drawTileParsed",
        "drawTileSeatParsed",
        "discardTileParsed",
        "discardTileSeatParsed",
        "gameStateHandUpdated",
        "gameStateRoundMetadataUpdated",
        "gameStateDrawnTileUpdated",
        "gameStateDiscardsUpdated",
        "gameStateDoraIndicatorsUpdated",
        "gameStateScoresUpdated",
        "gameStateVisibleTilesUpdated"
      ]
    });
  });

  it("requires parsed draw and discard events to include valid seats", () => {
    const drawPayload = [
      ...protobufString(2, "5m"),
      ...protobufVarint(3, 43)
    ];
    const drawActionPayload = [
      ...protobufVarint(1, 12),
      ...protobufString(2, "ActionDealTile"),
      ...protobufBytes(3, drawPayload)
    ];
    const discardPayload = [
      ...protobufString(2, "9s")
    ];
    const discardActionPayload = [
      ...protobufVarint(1, 13),
      ...protobufString(2, "ActionDiscardTile"),
      ...protobufBytes(3, discardPayload)
    ];
    const drawFrame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, drawActionPayload)
    ]);
    const discardFrame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, discardActionPayload)
    ]);
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "missing-seat.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "raw_message",
          source: "ws_in",
          ts: 2,
          payload: {
            kind: "Uint8Array",
            length: discardFrame.byteLength,
            preview: `Uint8Array(${discardFrame.byteLength})`,
            sample: bytesToHex(discardFrame),
            truncated: false
          }
        },
        {
          type: "raw_message",
          source: "ws_in",
          ts: 1,
          payload: {
            kind: "Uint8Array",
            length: drawFrame.byteLength,
            preview: `Uint8Array(${drawFrame.byteLength})`,
            sample: bytesToHex(drawFrame),
            truncated: false
          }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.eventTypes).toEqual(["draw_tile", "discard_tile"]);
    expect(parsed.acceptance).toMatchObject({
      readyForRealPageMvp: false,
      checks: {
        drawTileParsed: true,
        drawTileSeatParsed: false,
        discardTileParsed: true,
        discardTileSeatParsed: false,
        gameStateHandUpdated: false,
        gameStateRoundMetadataUpdated: false,
        gameStateDrawnTileUpdated: false,
        gameStateDiscardsUpdated: false,
        gameStateDoraIndicatorsUpdated: false,
        gameStateScoresUpdated: false,
        gameStateVisibleTilesUpdated: false
      },
      missing: expect.arrayContaining([
        "drawTileSeatParsed",
        "discardTileSeatParsed",
        "gameStateHandUpdated",
        "gameStateRoundMetadataUpdated",
        "gameStateDrawnTileUpdated",
        "gameStateDiscardsUpdated",
        "gameStateDoraIndicatorsUpdated",
        "gameStateScoresUpdated",
        "gameStateVisibleTilesUpdated"
      ])
    });
    expect(parsed.recommendations).toEqual([
      "Capture does not yet satisfy real-page MVP acceptance. Missing: drawTileSeatParsed, discardTileSeatParsed, gameStateHandUpdated, gameStateRoundMetadataUpdated, gameStateDrawnTileUpdated, gameStateDiscardsUpdated, gameStateDoraIndicatorsUpdated, gameStateScoresUpdated, gameStateVisibleTilesUpdated."
    ]);
  });

  it("reports truncated capture samples separately from parser coverage", () => {
    const actionPayload = [
      ...protobufVarint(1, 0),
      ...protobufString(2, "5m"),
      ...protobufString(6, "1z"),
      ...protobufString(6, "2z"),
      ...protobufString(6, "3z"),
      ...protobufString(6, "4z"),
      ...protobufString(6, "5z")
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 99),
      ...protobufString(2, "ActionDealTile"),
      ...protobufBytes(3, actionPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "truncated-action.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "raw_message",
          source: "ws_in",
          ts: 1,
          payload: {
            kind: "Uint8Array",
            length: frame.byteLength,
            preview: `Uint8Array(${frame.byteLength})`,
            sample: bytesToHex(frame.slice(0, 96)),
            truncated: true,
            envelope: {
              frameType: 1,
              frameTypeName: "Notify",
              methodName: ".lq.ActionPrototype",
              actionName: "ActionDealTile",
              payloadTruncated: true,
              actionPayloadTruncated: true
            }
          }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.diagnostics).toMatchObject({
      truncatedRawMessages: 1,
      truncatedEnvelopes: 1,
      truncatedActionPayloads: 1
    });
    expect(parsed.recommendations).toContain("Some raw binary capture samples are truncated. Increase Binary sample bytes and collect a fresh capture before mapping missing fields.");
  });

  it("reports unmapped Unity action payloads separately from parsed action names", () => {
    const noisyDealPayload = [
      ...protobufBytes(5, [
        ...protobufVarint(2, 36)
      ])
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 42),
      ...protobufString(2, "ActionDealTile"),
      ...protobufBytes(3, noisyDealPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "unmapped-unity-payload.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-31T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "raw_message",
          source: "ws_in",
          ts: 1,
          payload: {
            kind: "Uint8Array",
            length: frame.byteLength,
            preview: `Uint8Array(${frame.byteLength})`,
            sample: bytesToHex(frame),
            truncated: false
          }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.eventTypes).toEqual(["draw_tile"]);
    expect(parsed.diagnostics.unparsedActions).toEqual([]);
    expect(parsed.diagnostics.unmappedUnityPayloads).toMatchObject([
      {
        name: "ActionDealTile",
        count: 1,
        sample: {
          actionPayloadLength: noisyDealPayload.length
        }
      }
    ]);
    expect(parsed.recommendations).toContain("Captured Unity action payloads still need field mapping: ActionDealTile x1.");
    expect(parsed.eventTypes).not.toContain("riichi");
  });

  it("points unmapped NewRound payloads at the mjai-reviewer RecordNewRound contract", () => {
    const noisyNewRoundPayload = [0x95, 0x7e, 0x63, 0x68, 0x55, 0xae, 0x4e, 0x9c];
    const actionPrototypePayload = [
      ...protobufVarint(1, 1),
      ...protobufString(2, "ActionNewRound"),
      ...protobufBytes(3, noisyNewRoundPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "unmapped-newround.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-31T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "raw_message",
          source: "ws_in",
          ts: 1,
          payload: {
            kind: "Uint8Array",
            length: frame.byteLength,
            preview: `Uint8Array(${frame.byteLength})`,
            sample: bytesToHex(frame),
            truncated: false
          }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.eventTypes).toEqual(["round_start"]);
    expect(parsed.diagnostics.unmappedUnityPayloads).toMatchObject([
      { name: "ActionNewRound", count: 1 }
    ]);
    expect(parsed.recommendations).toContain(
      "For NewRound mapping, compare Unity payload bytes against the Mahjong Soul RecordNewRound contract used by mjai-reviewer: chang, ju, ben, liqibang, scores, dora/doras, and tiles or tiles0..tiles3."
    );
  });

  it("reports concrete tile names when replayed state exceeds four known copies", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "over-count.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "deal_hand",
          source: "fixture",
          ts: 1,
          payload: { tiles: ["1m", "1m", "1m", "1m", "1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m"] }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.warnings).toEqual(["1m appears 5 times"]);
    expect(parsed.stateDiagnostics.overKnownTileLimit).toEqual([
      { tile: "1m", count: 5 }
    ]);
  });

  it("reports invalid parsed tile names in state diagnostics", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "invalid-tiles.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "deal_hand",
          source: "fixture",
          ts: 1,
          payload: { tiles: ["1m", "9z", "2m"] }
        },
        {
          type: "draw_tile",
          source: "fixture",
          ts: 2,
          payload: { seat: 0, tile: "10m" }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.gameState.hand).toEqual(["1m", "2m"]);
    expect(parsed.gameState.drawnTile).toBeNull();
    expect(parsed.stateDiagnostics.invalidTiles).toEqual([
      { tile: "10m", context: "draw_tile.tile" },
      { tile: "9z", context: "deal_hand.tiles" }
    ]);
    expect(parsed.warnings).toEqual([
      "ignored invalid tile 10m from draw_tile.tile",
      "ignored invalid tile 9z from deal_hand.tiles"
    ]);
    expect(parsed.recommendations).toContain("Invalid tile names were ignored while replaying state. Inspect stateDiagnostics.invalidTiles contexts before trusting field mapping.");
  });

  it("reports chi/peng/gang state diagnostics without double-counting the claimed discard", () => {
    const discardPayload = [
      ...protobufVarint(1, 1),
      ...protobufString(2, "4p")
    ];
    const discardActionPayload = [
      ...protobufVarint(1, 20),
      ...protobufString(2, "ActionDiscardTile"),
      ...protobufBytes(3, discardPayload)
    ];
    const callPayload = [
      ...protobufVarint(1, 2),
      ...protobufVarint(2, 1),
      ...protobufString(3, "3p"),
      ...protobufString(3, "4p"),
      ...protobufString(3, "5p")
    ];
    const callActionPayload = [
      ...protobufVarint(1, 21),
      ...protobufString(2, "ActionChiPengGang"),
      ...protobufBytes(3, callPayload)
    ];
    const discardFrame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, discardActionPayload)
    ]);
    const callFrame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, callActionPayload)
    ]);
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "call-meld.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "raw_message",
          source: "ws_in",
          ts: 2,
          payload: {
            kind: "Uint8Array",
            length: callFrame.byteLength,
            preview: `Uint8Array(${callFrame.byteLength})`,
            sample: bytesToHex(callFrame),
            truncated: false
          }
        },
        {
          type: "raw_message",
          source: "ws_in",
          ts: 1,
          payload: {
            kind: "Uint8Array",
            length: discardFrame.byteLength,
            preview: `Uint8Array(${discardFrame.byteLength})`,
            sample: bytesToHex(discardFrame),
            truncated: false
          }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.eventTypes).toEqual(["discard_tile", "call_meld"]);
    expect(parsed.stateDiagnostics).toMatchObject({
      eventCounts: {
        discard_tile: 1,
        call_meld: 1
      },
      stateUpdated: {
        discards: false,
        melds: true,
        currentTurn: true,
        visibleTiles: true,
        warningsClear: true
      },
      callMeldEvents: 1,
      callMeldEventsWithSeat: 1,
      chiPengGangEvents: 1,
      claimableChiPengGangEvents: 1,
      meldCount: 1,
      expectedCurrentTurn: 2,
      currentTurnMatchesExpected: true,
      claimedDiscardTransferred: true
    });
    expect(parsed.gameState.discards[1]).toEqual([]);
    expect(parsed.gameState.melds[2]).toEqual([["3p", "4p", "5p"]]);
    expect(parsed.gameState.currentTurn).toBe(2);
    expect(parsed.gameState.visibleTiles).toEqual(["3p", "4p", "5p"]);
    expect(parsed.acceptance.checks.gameStateCurrentTurnUpdated).toBe(true);
    expect(parsed.stateCoverage.optional.melds).toMatchObject({
      observed: true,
      updated: true,
      eventCount: 1
    });
    expect(parsed.stateCoverage.optional.currentTurn).toMatchObject({
      expected: 2,
      updated: true
    });
  });

  it("replays own call melds by removing consumed hand tiles", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "own-call-meld.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "call_meld",
          source: "fixture",
          ts: 3,
          payload: {
            seat: 0,
            meld: ["3p", "4p", "5p"],
            binaryEnvelope: { actionName: "ActionChiPengGang" }
          }
        },
        {
          type: "discard_tile",
          source: "fixture",
          ts: 2,
          payload: { seat: 1, tile: "4p" }
        },
        {
          type: "deal_hand",
          source: "fixture",
          ts: 1,
          payload: { tiles: ["3p", "5p", "1m", "2m", "3m"] }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.gameState.hand).toEqual(["1m", "2m", "3m"]);
    expect(parsed.gameState.discards[1]).toEqual([]);
    expect(parsed.gameState.melds[0]).toEqual([["3p", "4p", "5p"]]);
    expect(parsed.stateDiagnostics).toMatchObject({
      callMeldEvents: 1,
      chiPengGangEvents: 1,
      claimableChiPengGangEvents: 1,
      claimedDiscardTransferred: true
    });
  });

  it("applies RecordChiPengGang state diagnostics like ActionChiPengGang", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "own-record-call-meld.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "call_meld",
          source: "fixture",
          ts: 3,
          payload: {
            seat: 0,
            meld: ["6s", "7s", "8s"],
            binaryEnvelope: { actionName: "RecordChiPengGang" }
          }
        },
        {
          type: "discard_tile",
          source: "fixture",
          ts: 2,
          payload: { seat: 2, tile: "7s" }
        },
        {
          type: "deal_hand",
          source: "fixture",
          ts: 1,
          payload: { tiles: ["6s", "8s", "1m", "2m"] }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.gameState.hand).toEqual(["1m", "2m"]);
    expect(parsed.gameState.discards[2]).toEqual([]);
    expect(parsed.gameState.melds[0]).toEqual([["6s", "7s", "8s"]]);
    expect(parsed.stateDiagnostics).toMatchObject({
      callMeldEvents: 1,
      chiPengGangEvents: 1,
      claimableChiPengGangEvents: 1,
      claimedDiscardTransferred: true
    });
  });

  it("reports closed-kan replay diagnostics and own tile removal", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "closed-kan.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "call_meld",
          source: "fixture",
          ts: 2,
          payload: {
            seat: 0,
            type: 3,
            meld: ["5p"],
            binaryEnvelope: { actionName: "ActionAnGangAddGang" }
          }
        },
        {
          type: "deal_hand",
          source: "fixture",
          ts: 1,
          payload: { tiles: ["5p", "5p", "5p", "5p", "1m"] }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.gameState.hand).toEqual(["1m"]);
    expect(parsed.gameState.melds[0]).toEqual([["5p", "5p", "5p", "5p"]]);
    expect(parsed.stateDiagnostics).toMatchObject({
      callMeldEvents: 1,
      anGangAddGangEvents: 1,
      anGangAddGangEventsWithSeat: 1,
      closedKanEvents: 1,
      addedKanEvents: 0,
      ownAnGangAddGangEvents: 1,
      kanTypeKnown: true,
      kanMeldTileCountsOk: true,
      closedKanVisibleTileCountsOk: true,
      addedKanVisibleTileCountsOk: null,
      ownKanTilesRemoved: true,
      kanMeldMismatches: [],
      ownKanTilesStillInHand: []
    });
    expect(parsed.acceptance.checks).toMatchObject({
      anGangAddGangSeatParsed: true,
      kanTypeKnown: true,
      kanMeldTileCountsOk: true,
      ownKanTilesRemoved: true
    });
    expect(parsed.stateCoverage.optional.kan).toMatchObject({
      observed: true,
      seatParsed: true,
      closedEvents: 1,
      addedEvents: 0,
      typeKnown: true,
      visibleTileCountsOk: true,
      ownTilesRemoved: true,
      eventCount: 1
    });
  });

  it("recommends resampling when added-kan replay lacks the earlier triplet", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "partial-added-kan.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "call_meld",
          source: "fixture",
          ts: 2,
          payload: {
            seat: 0,
            type: 2,
            meld: ["5p"],
            binaryEnvelope: { actionName: "RecordAnGangAddGang" }
          }
        },
        {
          type: "draw_tile",
          source: "fixture",
          ts: 1,
          payload: { seat: 0, tile: "5p" }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.gameState.drawnTile).toBeNull();
    expect(parsed.gameState.melds[0]).toEqual([["5p"]]);
    expect(parsed.stateDiagnostics).toMatchObject({
      anGangAddGangEvents: 1,
      anGangAddGangEventsWithSeat: 1,
      closedKanEvents: 0,
      addedKanEvents: 1,
      ownAnGangAddGangEvents: 1,
      kanTypeKnown: true,
      kanMeldTileCountsOk: false,
      closedKanVisibleTileCountsOk: null,
      addedKanVisibleTileCountsOk: false,
      ownKanTilesRemoved: true,
      kanMeldMismatches: [
        {
          seat: 0,
          type: 2,
          tile: "5p",
          expectedCopies: 4,
          actualCopies: 1,
          reason: "no four-tile kan meld in final state"
        }
      ],
      ownKanTilesStillInHand: []
    });
    expect(parsed.acceptance.checks).toMatchObject({
      anGangAddGangSeatParsed: true,
      kanTypeKnown: true,
      kanMeldTileCountsOk: false,
      ownKanTilesRemoved: true
    });
    expect(parsed.acceptance.missing).toContain("kanMeldTileCountsOk");
    expect(parsed.recommendations).toContain(
      "ActionAnGangAddGang added-kan events replayed, but no four-tile upgraded kan meld was visible. Capture from the earlier pon or inspect type/tile fields before trusting meld state."
    );
  });

  it("recommends injection checks when a capture has no raw messages", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "empty.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: []
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.recommendations).toEqual([
      "No raw WebSocket messages were captured. Confirm Tampermonkey page injection and join a table before copying capture."
    ]);
    expect(parsed.acceptance).toMatchObject({
      readyForRealPageMvp: false,
      missing: [
        "rawMessagesCaptured",
        "binaryEnvelopeDecoded",
        "actionPrototypeDecoded",
        "drawTileParsed",
        "drawTileSeatParsed",
        "discardTileParsed",
        "discardTileSeatParsed",
        "gameStateHandUpdated",
        "gameStateRoundMetadataUpdated",
        "gameStateDrawnTileUpdated",
        "gameStateDiscardsUpdated",
        "gameStateDoraIndicatorsUpdated",
        "gameStateScoresUpdated",
        "gameStateVisibleTilesUpdated"
      ]
    });
  });

  it("uses helper diagnostics when no raw messages were captured because install failed", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "install-failed.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      helperDiagnostics: {
        installed: false,
        installAttempts: 1,
        installedAt: null,
        installFailureReason: "WebSocket hook install failed: readonly send",
        webSocketAvailable: true,
        socketsCreated: 0,
        recentSocketUrls: [],
        maxEvents: 100,
        binarySampleBytes: 512
      },
      events: []
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.recommendations).toEqual([
      "No raw WebSocket messages were captured because the helper hook was not installed. Reason: WebSocket hook install failed: readonly send"
    ]);
    expect(parsed.captureMetadata.helperDiagnostics.installed).toBe(false);
  });

  it("uses helper diagnostics when no WebSocket instances were observed", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "no-sockets.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      helperDiagnostics: {
        installed: true,
        installAttempts: 1,
        installedAt: "2026-05-24T00:00:00.000Z",
        installFailureReason: "",
        webSocketAvailable: true,
        socketsCreated: 0,
        recentSocketUrls: [],
        maxEvents: 100,
        binarySampleBytes: 512
      },
      events: []
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.recommendations).toEqual([
      "No raw WebSocket messages were captured and no WebSocket instances were observed. Reload the game client after enabling the userscript, then join a table."
    ]);
    expect(parsed.captureMetadata.helperDiagnostics.socketsCreated).toBe(0);
  });

  it("warns when the capture was exported while paused", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "paused.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      helperDiagnostics: {
        installed: true,
        installAttempts: 1,
        installedAt: "2026-05-24T00:00:00.000Z",
        installFailureReason: "",
        webSocketAvailable: true,
        paused: true,
        hooks: {
          constructor: true,
          send: true,
          addEventListener: true,
          removeEventListener: true,
          onmessage: true,
          onmessageMode: "accessor"
        },
        socketsCreated: 1,
        recentSocketUrls: ["wss://example.test/socket"],
        maxEvents: 100,
        binarySampleBytes: 512
      },
      events: []
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.captureMetadata.helperDiagnostics.paused).toBe(true);
    expect(parsed.recommendations).toEqual([
      "Capture was exported while capture was paused. Resume capture and collect fresh in-table traffic before trusting missing-event diagnostics.",
      "No raw WebSocket messages were captured. Confirm Tampermonkey page injection and join a table before copying capture."
    ]);
  });

  it("uses hook diagnostics when only outbound messages were captured", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "outbound-only.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      helperDiagnostics: {
        installed: true,
        installAttempts: 1,
        installedAt: "2026-05-24T00:00:00.000Z",
        installFailureReason: "",
        webSocketAvailable: true,
        hooks: {
          constructor: true,
          send: true,
          addEventListener: true,
          removeEventListener: true,
          onmessage: false,
          onmessageMode: "non-configurable"
        },
        socketsCreated: 1,
        recentSocketUrls: ["wss://example.test/socket"],
        maxEvents: 100,
        binarySampleBytes: 512
      },
      events: [
        {
          type: "raw_message",
          source: "ws_out",
          ts: 1,
          payload: {
            kind: "text",
            length: 5,
            preview: "hello",
            sample: "hello",
            truncated: false
          }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.diagnostics).toMatchObject({
      rawMessages: 1,
      inboundRawMessages: 0,
      outboundRawMessages: 1
    });
    expect(parsed.recommendations).toContain(
      "Only outbound WebSocket messages were captured, and onmessage could not be patched because its descriptor is non-configurable. Confirm whether the client uses addEventListener(\"message\", ...) or collect a browser console hook diagnostic before changing parser mappings."
    );
  });

  it("replays ActionLiqiSuccess into riichi state, sticks, and score", () => {
    const riichiPayload = [
      ...protobufVarint(1, 1),
      ...protobufVarint(2, 24000),
      ...protobufVarint(3, 2)
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 78),
      ...protobufString(2, "ActionLiqiSuccess"),
      ...protobufBytes(3, riichiPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "riichi-success.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "raw_message",
          source: "ws_in",
          ts: 1,
          payload: {
            kind: "Uint8Array",
            length: frame.byteLength,
            preview: `Uint8Array(${frame.byteLength})`,
            sample: bytesToHex(frame),
            truncated: false
          }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.eventTypes).toEqual(["riichi"]);
    expect(parsed.gameState.riichi[1]).toBe(true);
    expect(parsed.gameState.riichiSticks).toBe(2);
    expect(parsed.gameState.scores[1]).toBe(24000);
    expect(parsed.gameState.scoresKnown).toBe(true);
    expect(parsed.stateDiagnostics).toMatchObject({
      eventCounts: {
        riichi: 1
      },
      stateUpdated: {
        riichi: true,
        scores: true
      },
      riichiEventsWithSeat: 1
    });
    expect(parsed.stateCoverage.optional.riichi).toMatchObject({
      observed: true,
      seatParsed: true,
      updated: true,
      eventCount: 1
    });
  });

  it("replays ActionHule game-end scores into final state", () => {
    const hulePayload = [
      ...protobufBytes(6, [...protobufBytes(1, [...encodeVarint(32000), ...encodeVarint(18000)])]),
      ...protobufString(7, "4p")
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 89),
      ...protobufString(2, "ActionHule"),
      ...protobufBytes(3, hulePayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "hule-gameend-scores.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "raw_message",
          source: "ws_in",
          ts: 1,
          payload: {
            kind: "Uint8Array",
            length: frame.byteLength,
            preview: `Uint8Array(${frame.byteLength})`,
            sample: bytesToHex(frame),
            truncated: false
          }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.eventTypes).toEqual(["round_end"]);
    expect(parsed.gameState.roundEndReason).toBe("hule");
    expect(parsed.gameState.scores).toEqual([32000, 18000]);
    expect(parsed.gameState.scoresKnown).toBe(true);
    expect(parsed.gameState.doraIndicators).toEqual(["4p"]);
    expect(parsed.stateDiagnostics).toMatchObject({
      eventCounts: {
        round_end: 1
      },
      stateUpdated: {
        roundEndReason: true,
        scores: true
      },
      roundEndEventsWithScores: 1
    });
    expect(parsed.stateCoverage.optional.roundEnd).toMatchObject({
      observed: true,
      reasonUpdated: true,
      scoreEvents: 1,
      scoresUpdated: true,
      eventCount: 1
    });
    expect(parsed.acceptance.checks.roundEndScoresUpdated).toBe(true);
  });

  it("replays ActionLiuJu game-end scores into final state", () => {
    const liujuPayload = [
      ...protobufVarint(1, 2),
      ...protobufBytes(2, [...protobufBytes(1, [...encodeVarint(27000), ...encodeVarint(23000)])]),
      ...protobufVarint(3, 1),
      ...protobufString(4, "1m"),
      ...protobufString(4, "2m")
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 90),
      ...protobufString(2, "ActionLiuJu"),
      ...protobufBytes(3, liujuPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "liuju-scores.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "raw_message",
          source: "ws_in",
          ts: 1,
          payload: {
            kind: "Uint8Array",
            length: frame.byteLength,
            preview: `Uint8Array(${frame.byteLength})`,
            sample: bytesToHex(frame),
            truncated: false
          }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.eventTypes).toEqual(["round_end"]);
    expect(parsed.gameState.roundEndReason).toBe("liuju");
    expect(parsed.gameState.scores).toEqual([27000, 23000]);
    expect(parsed.gameState.scoresKnown).toBe(true);
    expect(parsed.stateDiagnostics).toMatchObject({
      eventCounts: {
        round_end: 1
      },
      stateUpdated: {
        roundEndReason: true,
        scores: true
      },
      roundEndEventsWithScores: 1
    });
    expect(parsed.stateCoverage.optional.roundEnd).toMatchObject({
      observed: true,
      reasonUpdated: true,
      scoreEvents: 1,
      scoresUpdated: true,
      eventCount: 1
    });
    expect(parsed.acceptance.checks.roundEndScoresUpdated).toBe(true);
  });

  it("replays ActionNoTile score infos by seat into final state", () => {
    const firstScore = [
      ...protobufVarint(1, 2),
      ...protobufString(6, "4p"),
      ...protobufVarint(7, 24000)
    ];
    const secondScore = [
      ...protobufVarint(1, 0),
      ...protobufVarint(7, 26000)
    ];
    const thirdScore = [
      ...protobufVarint(1, 3),
      ...protobufVarint(7, 25000)
    ];
    const fourthScore = [
      ...protobufVarint(1, 1),
      ...protobufVarint(7, 25000)
    ];
    const noTilePayload = [
      ...protobufVarint(1, 1),
      ...protobufBytes(3, firstScore),
      ...protobufBytes(3, secondScore),
      ...protobufBytes(3, thirdScore),
      ...protobufBytes(3, fourthScore),
      ...protobufVarint(4, 1)
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 91),
      ...protobufString(2, "ActionNoTile"),
      ...protobufBytes(3, noTilePayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "no-tile-scores.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "raw_message",
          source: "ws_in",
          ts: 1,
          payload: {
            kind: "Uint8Array",
            length: frame.byteLength,
            preview: `Uint8Array(${frame.byteLength})`,
            sample: bytesToHex(frame),
            truncated: false
          }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.eventTypes).toEqual(["round_end"]);
    expect(parsed.gameState.roundEndReason).toBe("no_tile");
    expect(parsed.gameState.scores).toEqual([26000, 25000, 24000, 25000]);
    expect(parsed.gameState.scoresKnown).toBe(true);
    expect(parsed.gameState.doraIndicators).toEqual(["4p"]);
    expect(parsed.stateDiagnostics).toMatchObject({
      eventCounts: {
        round_end: 1
      },
      stateUpdated: {
        roundEndReason: true,
        scores: true,
        doraIndicators: true
      },
      roundEndEventsWithScores: 1
    });
    expect(parsed.stateCoverage.optional.roundEnd).toMatchObject({
      observed: true,
      reasonUpdated: true,
      scoreEvents: 1,
      scoresUpdated: true,
      eventCount: 1
    });
    expect(parsed.acceptance.checks.roundEndScoresUpdated).toBe(true);
  });

  it("recommends field checks when parsed events do not update expected state", () => {
    const dir = mkdtempSync(join(tmpdir(), "majsoul-helper-"));
    const capturePath = join(dir, "state-update-gaps.json");
    writeFileSync(capturePath, JSON.stringify({
      exportedAt: "2026-05-24T00:00:00.000Z",
      formatVersion: 1,
      events: [
        {
          type: "round_start",
          source: "fixture",
          ts: 1,
          payload: { tiles: ["1m", "2m", "3m"] }
        },
        {
          type: "riichi",
          source: "fixture",
          ts: 2,
          payload: {}
        },
        {
          type: "round_end",
          source: "fixture",
          ts: 3,
          payload: { reason: "hule" }
        }
      ]
    }));

    const output = execFileSync("node", ["scripts/replay-capture.mjs", capturePath], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output);

    expect(parsed.stateDiagnostics).toMatchObject({
      eventCounts: {
        round_start: 1,
        riichi: 1,
        round_end: 1
      },
      stateUpdated: {
        hand: true,
        roundMetadata: false,
        riichi: false,
        scores: false
      }
    });
    expect(parsed.recommendations).toContain(
      "round_start events replayed, but round metadata did not update. Inspect ActionNewRound chang/ju/round fields in actionPayloadFields before trusting table state."
    );
    expect(parsed.recommendations).toContain(
      "riichi events replayed, but riichi state did not update. Inspect parsed riichi seat fields."
    );
    expect(parsed.recommendations).toContain(
      "round_end events replayed, but scores did not change. Inspect ActionHule/ActionLiuJu/ActionNoTile score fields before trusting score state."
    );
    expect(parsed.stateCoverage.optional).toMatchObject({
      riichi: {
        observed: true,
        updated: false,
        eventCount: 1
      },
      roundEndScores: {
        observed: true,
        updated: false,
        eventCount: 1
      }
    });
  });
});
