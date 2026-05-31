import { describe, expect, it } from "vitest";
import { BINARY_ENVELOPE_SAMPLE_BYTES, parseBinaryEnvelope, parseBinaryMessage, parseDecodedMessage, parseReadableMessage, toEventType } from "../src/adapter/messageParser.js";

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

function protobufString(field, value) {
  const encoded = new TextEncoder().encode(value);
  return [...encodeVarint(field << 3 | 2), ...encodeVarint(encoded.length), ...encoded];
}

function protobufBytes(field, value) {
  return [...encodeVarint(field << 3 | 2), ...encodeVarint(value.length), ...value];
}

function protobufVarint(field, value) {
  return [...encodeVarint(field << 3 | 0), ...encodeVarint(value)];
}

describe("messageParser", () => {
  it("maps known Mahjong Soul style action names to standardized event types", () => {
    expect(toEventType(".lq.ActionNewRound")).toBe("round_start");
    expect(toEventType(".lq.RecordNewRound")).toBe("round_start");
    expect(toEventType(".lq.ActionDealTile")).toBe("draw_tile");
    expect(toEventType(".lq.RecordDealTile")).toBe("draw_tile");
    expect(toEventType(".lq.ActionDiscardTile")).toBe("discard_tile");
    expect(toEventType(".lq.RecordDiscardTile")).toBe("discard_tile");
    expect(toEventType(".lq.ActionChiPengGang")).toBe("call_meld");
    expect(toEventType(".lq.RecordChiPengGang")).toBe("call_meld");
    expect(toEventType(".lq.ActionAnGangAddGang")).toBe("call_meld");
    expect(toEventType(".lq.ActionBaBei")).toBe("call_meld");
    expect(toEventType(".lq.RecordBaBei")).toBe("call_meld");
    expect(toEventType(".lq.ActionNewDora")).toBe("dora");
    expect(toEventType(".lq.ActionHule")).toBe("round_end");
    expect(toEventType(".lq.RecordHule")).toBe("round_end");
    expect(toEventType(".lq.ActionNoTile")).toBe("round_end");
    expect(toEventType(".lq.RecordNoTile")).toBe("round_end");
    expect(toEventType(".lq.RecordLiqi")).toBe("riichi");
    expect(toEventType(".lq.RecordLiqiSuccess")).toBe("riichi");
  });

  it("does not map auth-only methods to state-changing events", () => {
    expect(toEventType(".lq.ResAuthGame")).toBe(null);
    expect(parseReadableMessage(JSON.stringify({
      name: ".lq.ResAuthGame",
      data: { isGameStart: true }
    }))).toEqual([]);
  });

  it("parses readable JSON websocket messages conservatively", () => {
    const events = parseReadableMessage(JSON.stringify({
      name: ".lq.ActionDiscardTile",
      data: { seat: 1, tile: "5m", tsumogiri: true, isRiichi: true, doraIndicators: ["1z"] }
    }));

    expect(events).toEqual([
      {
        type: "discard_tile",
        payload: { seat: 1, tile: "5m", tsumogiri: true, isRiichi: true, doraIndicators: ["1z"] }
      }
    ]);
  });

  it("keeps visible metadata from readable JSON draw and round messages", () => {
    expect(parseReadableMessage(JSON.stringify({
      name: ".lq.ActionDealTile",
      data: { seat: 0, tile: "6p", leftTileCount: 39, doraIndicators: ["3s"] }
    }))).toEqual([
      {
        type: "draw_tile",
        payload: { seat: 0, tile: "6p", leftTileCount: 39, doraIndicators: ["3s"] }
      }
    ]);

    expect(parseReadableMessage(JSON.stringify({
      name: ".lq.ActionNewRound",
      data: { chang: 1, ju: 2, honba: 1, tiles: ["1m", "2m"], doraIndicators: ["5p"], scores: [25000, 25000] }
    }))).toEqual([
      {
        type: "round_start",
        payload: {
          round: "1-2",
          chang: 1,
          ju: 2,
          honba: 1,
          riichiSticks: 0,
          roundWind: undefined,
          seatWind: undefined,
          scores: [25000, 25000],
          tiles: ["1m", "2m"],
          doraIndicators: ["5p"],
          leftTileCount: undefined
        }
      }
    ]);
  });

  it("normalizes readable dora metadata to indicator arrays", () => {
    expect(parseReadableMessage(JSON.stringify({
      name: ".lq.ActionDealTile",
      data: { seat: 0, tile: "6p", dora: "3s" }
    }))).toEqual([
      {
        type: "draw_tile",
        payload: { seat: 0, tile: "6p", leftTileCount: undefined, doraIndicators: ["3s"] }
      }
    ]);

    expect(parseReadableMessage(JSON.stringify({
      name: ".lq.ActionNewDora",
      data: { doraIndicators: ["2m", "3m"] }
    }))).toEqual([
      {
        type: "dora",
        payload: { tile: undefined, doraIndicators: ["2m", "3m"] }
      }
    ]);

    expect(parseReadableMessage(JSON.stringify({
      name: ".lq.ActionNewDora",
      data: { dora: "6p" }
    }))).toEqual([
      {
        type: "dora",
        payload: { tile: "6p", doraIndicators: ["6p"] }
      }
    ]);
  });

  it("normalizes readable round-end metadata from method names and field aliases", () => {
    expect(parseReadableMessage(JSON.stringify({
      name: ".lq.ActionHule",
      data: { points: ["32000", "18000"], baopai: "4p" }
    }))).toEqual([
      {
        type: "round_end",
        payload: {
          reason: "hule",
          type: undefined,
          seat: undefined,
          scores: [32000, 18000],
          doraIndicators: ["4p"],
          tiles: [],
          liujumanguan: undefined,
          gameEnd: undefined
        }
      }
    ]);

    expect(parseReadableMessage(JSON.stringify({
      name: ".lq.ActionNoTile",
      data: { type: 1, score: [26000, 25000, 24000, 25000], dora: "6p", game_end: true, liujuManguan: true }
    }))).toEqual([
      {
        type: "round_end",
        payload: {
          reason: "no_tile",
          type: 1,
          seat: undefined,
          scores: [26000, 25000, 24000, 25000],
          doraIndicators: ["6p"],
          tiles: [],
          liujumanguan: true,
          gameEnd: true
        }
      }
    ]);
  });

  it("keeps visible metadata from readable JSON call meld messages", () => {
    expect(parseReadableMessage(JSON.stringify({
      name: ".lq.ActionAnGangAddGang",
      data: { seat: 0, tiles: ["5p"], meldType: 2, doraIndicators: ["1z"] }
    }))).toEqual([
      {
        type: "call_meld",
        payload: {
          seat: 0,
          meld: ["5p"],
          type: 2,
          doraIndicators: ["1z"]
        }
      }
    ]);
  });

  it("preserves explicit readable round names while still exposing chang and ju", () => {
    expect(parseReadableMessage(JSON.stringify({
      name: ".lq.ActionNewRound",
      data: { round: "South 4", chang: 1, ju: 3 }
    }))).toEqual([
      {
        type: "round_start",
        payload: {
          round: "South 4",
          chang: 1,
          ju: 3,
          honba: 0,
          riichiSticks: 0,
          roundWind: undefined,
          seatWind: undefined,
          scores: undefined,
          tiles: [],
          doraIndicators: [],
          leftTileCount: undefined
        }
      }
    ]);
  });

  it("does not invent a seat when readable JSON omits one", () => {
    expect(parseReadableMessage(JSON.stringify({
      name: ".lq.ActionDiscardTile",
      data: { tile: "6m" }
    }))).toEqual([
      {
        type: "discard_tile",
        payload: {
          seat: undefined,
          tile: "6m",
          tsumogiri: undefined,
          isRiichi: undefined,
          doraIndicators: []
        }
      }
    ]);
  });

  it("parses client-decoded ActionPrototype messages without raw inner protobuf bytes", () => {
    expect(parseDecodedMessage({
      name: ".lq.ActionPrototype",
      data: {
        name: "ActionDiscardTile",
        step: 72,
        data: {
          seat: 2,
          tile: "6s",
          moqie: true,
          is_liqi: true,
          doras: ["1z"]
        }
      }
    })).toEqual([
      {
        type: "discard_tile",
        payload: {
          seat: 2,
          tile: "6s",
          tsumogiri: true,
          isRiichi: true,
          doraIndicators: ["1z"],
          binaryEnvelope: {
            methodName: ".lq.ActionPrototype",
            actionName: "ActionDiscardTile",
            step: 72,
            decodedSource: "client"
          }
        }
      }
    ]);
  });

  it("parses direct client-decoded action records", () => {
    expect(parseDecodedMessage({
      name: "ActionDealTile",
      data: { seat: 0, tile: "5m", left_tile_count: 44, doras: ["4p"] }
    })).toEqual([
      {
        type: "draw_tile",
        payload: {
          seat: 0,
          tile: "5m",
          leftTileCount: 44,
          doraIndicators: ["4p"],
          binaryEnvelope: {
            methodName: "ActionDealTile",
            actionName: "ActionDealTile",
            step: undefined,
            decodedSource: "client"
          }
        }
      }
    ]);
  });

  it("ignores binary-like or unknown text instead of guessing", () => {
    expect(parseReadableMessage("not json")).toEqual([]);
    expect(parseReadableMessage(JSON.stringify({ name: "UnknownThing", data: { tile: "1m" } }))).toEqual([]);
  });

  it("extracts method names from Mahjong Soul binary envelopes", () => {
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionDiscardTile"),
      ...protobufString(2, "\b\u0002\u0012\u00029s")
    ]);

    expect(parseBinaryEnvelope(frame)).toMatchObject({
      frameType: 1,
      frameTypeName: "Notify",
      requestId: null,
      methodName: ".lq.ActionDiscardTile",
      actionName: "ActionDiscardTile",
      actionPayloadFields: {
        varints: [{ field: 1, values: [2] }],
        strings: [{ field: 2, values: ["9s"] }],
        tileStrings: [{ field: 2, values: ["9s"] }]
      }
    });
    expect(parseBinaryMessage(frame)[0]).toMatchObject({
      type: "discard_tile",
      payload: {
        seat: 2,
        tile: "9s",
        binaryEnvelope: expect.objectContaining({
          methodName: ".lq.ActionDiscardTile",
          actionName: "ActionDiscardTile"
        })
      }
    });
  });

  it("extracts ActionPrototype action names and simple discard payload fields", () => {
    const discardPayload = [
      ...protobufVarint(1, 3),
      ...protobufString(2, "9s"),
      ...protobufVarint(3, 1),
      ...protobufVarint(5, 1),
      ...protobufString(8, "1z")
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 53),
      ...protobufString(2, "ActionDiscardTile"),
      ...protobufBytes(3, discardPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);

    expect(parseBinaryEnvelope(frame)).toMatchObject({
      frameTypeName: "Notify",
      methodName: ".lq.ActionPrototype",
      actionName: "ActionDiscardTile",
      step: 53,
      actionPayloadFields: {
        varints: [
          { field: 1, values: [3] },
          { field: 3, values: [1] },
          { field: 5, values: [1] }
        ],
        strings: [
          { field: 2, values: ["9s"] },
          { field: 8, values: ["1z"] }
        ],
        tileStrings: [
          { field: 2, values: ["9s"] },
          { field: 8, values: ["1z"] }
        ]
      }
    });
    expect(parseBinaryMessage(frame)[0]).toMatchObject({
      type: "discard_tile",
      payload: {
        seat: 3,
        tile: "9s",
        isRiichi: true,
        tsumogiri: true,
        doraIndicators: ["1z"],
        binaryEnvelope: expect.objectContaining({
          actionName: "ActionDiscardTile",
          actionPayloadFields: expect.objectContaining({
            tileStrings: [
              { field: 2, values: ["9s"] },
              { field: 8, values: ["1z"] }
            ]
          })
        })
      }
    });
  });

  it("extracts Record action names carried by ActionPrototype frames", () => {
    const discardPayload = [
      ...protobufVarint(1, 2),
      ...protobufString(2, "7p"),
      ...protobufVarint(5, 1)
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 61),
      ...protobufString(2, "RecordDiscardTile"),
      ...protobufBytes(3, discardPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);

    expect(parseBinaryEnvelope(frame)).toMatchObject({
      methodName: ".lq.ActionPrototype",
      actionName: "RecordDiscardTile",
      step: 61
    });
    expect(parseBinaryMessage(frame)[0]).toMatchObject({
      type: "discard_tile",
      payload: {
        seat: 2,
        tile: "7p",
        tsumogiri: true,
        binaryEnvelope: expect.objectContaining({
          actionName: "RecordDiscardTile"
        })
      }
    });
  });

  it("uses little-endian request ids for request and response frames", () => {
    const frame = new Uint8Array([
      2,
      0x34,
      0x12,
      ...protobufString(1, ".lq.FastTest.checkNetworkDelay"),
      ...protobufBytes(2, [])
    ]);

    expect(parseBinaryEnvelope(frame)).toMatchObject({
      frameTypeName: "Request",
      requestId: 0x1234,
      methodName: ".lq.FastTest.checkNetworkDelay"
    });
  });

  it("does not replay unsupported binary response methods as empty state events", () => {
    const frame = new Uint8Array([
      3,
      0x01,
      0x00,
      ...protobufString(1, ".lq.ResAuthGame"),
      ...protobufBytes(2, [
        ...protobufVarint(4, 1)
      ])
    ]);

    expect(parseBinaryEnvelope(frame)).toMatchObject({
      frameTypeName: "Response",
      requestId: 1,
      methodName: ".lq.ResAuthGame",
      actionName: null
    });
    expect(parseBinaryMessage(frame)).toEqual([]);
  });

  it("extracts simple draw fields by protobuf field id", () => {
    const dealPayload = [
      ...protobufVarint(1, 0),
      ...protobufString(2, "5m"),
      ...protobufVarint(3, 43),
      ...protobufString(6, "1z")
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 54),
      ...protobufString(2, "ActionDealTile"),
      ...protobufBytes(3, dealPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);

    expect(parseBinaryMessage(frame)).toEqual([
      {
        type: "draw_tile",
        payload: {
          seat: 0,
          tile: "5m",
          leftTileCount: 43,
          doraIndicators: ["1z"],
          binaryEnvelope: expect.objectContaining({ actionName: "ActionDealTile" })
        }
      }
    ]);
  });

  it("emits standard riichi events from nested LiQiSuccess payloads", () => {
    const liqiPayload = [
      ...protobufVarint(1, 1),
      ...protobufVarint(2, 24000),
      ...protobufVarint(3, 2)
    ];
    const dealPayload = [
      ...protobufVarint(1, 0),
      ...protobufString(2, "5m"),
      ...protobufVarint(3, 43),
      ...protobufBytes(5, liqiPayload),
      ...protobufString(6, "1z")
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 56),
      ...protobufString(2, "ActionDealTile"),
      ...protobufBytes(3, dealPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);

    expect(parseBinaryMessage(frame)).toEqual([
      {
        type: "draw_tile",
        payload: {
          seat: 0,
          tile: "5m",
          leftTileCount: 43,
          doraIndicators: ["1z"],
          riichi: {
            seat: 1,
            score: 24000,
            riichiSticks: 2
          },
          binaryEnvelope: expect.objectContaining({ actionName: "ActionDealTile" })
        }
      },
      {
        type: "riichi",
        payload: {
          seat: 1,
          score: 24000,
          riichiSticks: 2,
          sourceAction: "ActionDealTile",
          sourceMethodName: ".lq.ActionPrototype",
          sourceStep: 56
        }
      }
    ]);
  });

  it("keeps enough ActionPrototype payload sample to parse fields beyond 96 bytes", () => {
    const filler = [];
    for (let index = 0; index < 120; index += 1) {
      filler.push(...protobufVarint(15, index % 16));
    }
    const dealPayload = [
      ...filler,
      ...protobufVarint(1, 0),
      ...protobufString(2, "7m"),
      ...protobufVarint(3, 31)
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 54),
      ...protobufString(2, "ActionDealTile"),
      ...protobufBytes(3, dealPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);

    expect(BINARY_ENVELOPE_SAMPLE_BYTES).toBe(512);
    expect(parseBinaryEnvelope(frame)).toMatchObject({
      actionPayloadLength: dealPayload.length,
      actionPayloadTruncated: false
    });
    expect(parseBinaryMessage(frame)[0]).toMatchObject({
      type: "draw_tile",
      payload: {
        seat: 0,
        tile: "7m",
        leftTileCount: 31
      }
    });
  });

  it("parses live binary fields beyond the bounded debug action payload sample", () => {
    const filler = [];
    for (let index = 0; index < 280; index += 1) {
      filler.push(...protobufVarint(15, index % 16));
    }
    const dealPayload = [
      ...filler,
      ...protobufVarint(1, 2),
      ...protobufString(2, "6p"),
      ...protobufVarint(3, 24)
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 55),
      ...protobufString(2, "ActionDealTile"),
      ...protobufBytes(3, dealPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);

    expect(dealPayload.length).toBeGreaterThan(BINARY_ENVELOPE_SAMPLE_BYTES);
    expect(parseBinaryEnvelope(frame)).toMatchObject({
      actionPayloadLength: dealPayload.length,
      actionPayloadTruncated: true
    });
    expect(parseBinaryMessage(frame)[0]).toMatchObject({
      type: "draw_tile",
      payload: {
        seat: 2,
        tile: "6p",
        leftTileCount: 24
      }
    });
  });

  it("extracts conservative new-round fields", () => {
    const newRoundPayload = [
      ...protobufVarint(1, 0),
      ...protobufVarint(2, 1),
      ...protobufVarint(3, 2),
      ...protobufString(4, "1m"),
      ...protobufString(4, "2m"),
      ...protobufString(4, "3m"),
      ...protobufString(5, "4p"),
      ...protobufBytes(6, [...encodeVarint(25000), ...encodeVarint(26000)]),
      ...protobufVarint(8, 1),
      ...protobufVarint(13, 69)
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 1),
      ...protobufString(2, "ActionNewRound"),
      ...protobufBytes(3, newRoundPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);

    expect(parseBinaryMessage(frame)[0]).toMatchObject({
      type: "round_start",
      payload: {
        round: "0-1",
        chang: 0,
        ju: 1,
        honba: 2,
        riichiSticks: 1,
        doraIndicators: ["4p"],
        scores: [25000, 26000],
        tiles: ["1m", "2m", "3m"],
        leftTileCount: 69,
        binaryEnvelope: expect.objectContaining({ actionName: "ActionNewRound" })
      }
    });
  });

  it("keeps new-round hand tiles that match dora indicators", () => {
    const newRoundPayload = [
      ...protobufVarint(1, 0),
      ...protobufVarint(2, 0),
      ...protobufString(4, "4p"),
      ...protobufString(4, "4p"),
      ...protobufString(4, "5p"),
      ...protobufString(5, "4p"),
      ...protobufBytes(6, [...encodeVarint(25000)])
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 1),
      ...protobufString(2, "ActionNewRound"),
      ...protobufBytes(3, newRoundPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);

    expect(parseBinaryMessage(frame)[0]).toMatchObject({
      type: "round_start",
      payload: {
        doraIndicators: ["4p"],
        tiles: ["4p", "4p", "5p"]
      }
    });
  });

  it("extracts a visible round snapshot and nested actions from GameRestore", () => {
    const fuluPayload = [
      ...protobufVarint(1, 1),
      ...protobufString(2, "3p"),
      ...protobufString(2, "4p"),
      ...protobufString(2, "5p")
    ];
    const player0Payload = [
      ...protobufVarint(1, 26000),
      ...protobufVarint(2, 2),
      ...protobufString(4, "9s"),
      ...protobufBytes(5, fuluPayload)
    ];
    const player1Payload = [
      ...protobufVarint(1, 24000),
      ...protobufString(4, "1z")
    ];
    const snapshotPayload = [
      ...protobufVarint(1, 1),
      ...protobufVarint(2, 2),
      ...protobufVarint(3, 1),
      ...protobufVarint(4, 3),
      ...protobufVarint(5, 42),
      ...protobufString(6, "1m"),
      ...protobufString(6, "2m"),
      ...protobufString(6, "3m"),
      ...protobufString(7, "4p"),
      ...protobufVarint(8, 1),
      ...protobufBytes(9, player0Payload),
      ...protobufBytes(9, player1Payload)
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

    expect(parseBinaryEnvelope(frame)).toMatchObject({
      methodName: ".lq.GameRestore",
      restoreActionNames: ["ActionDiscardTile"]
    });
    expect(parseBinaryMessage(frame)).toMatchObject([
      {
        type: "round_start",
        payload: {
          round: "1-2",
          chang: 1,
          ju: 2,
          honba: 1,
          currentTurn: 3,
          leftTileCount: 42,
          riichiSticks: 1,
          scores: [26000, 24000],
          tiles: ["1m", "2m", "3m"],
          doraIndicators: ["4p"],
          discards: [["9s"], ["1z"], [], []],
          melds: [[["3p", "4p", "5p"]], [], [], []],
          riichi: [true, false, false, false],
          binaryEnvelope: expect.objectContaining({
            methodName: ".lq.GameRestore",
            snapshotPayloadLength: snapshotPayload.length
          })
        }
      },
      {
        type: "discard_tile",
        payload: {
          seat: 3,
          tile: "8s",
          binaryEnvelope: expect.objectContaining({
            methodName: ".lq.GameRestore",
            actionName: "ActionDiscardTile",
            step: 91
          })
        }
      }
    ]);
  });

  it("extracts a visible round snapshot from ResSyncGame game_restore responses", () => {
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

    expect(parseBinaryEnvelope(frame)).toMatchObject({
      frameTypeName: "Response",
      requestId: 0x1234,
      methodName: ".lq.ResSyncGame",
      restoreActionNames: ["ActionDiscardTile"]
    });
    expect(parseBinaryMessage(frame)).toMatchObject([
      {
        type: "round_start",
        payload: {
          round: "2-3",
          chang: 2,
          ju: 3,
          leftTileCount: 41,
          tiles: ["1m", "2m", "3m"],
          doraIndicators: ["5p"],
          discards: [["9s"], [], [], []],
          scores: [26000],
          binaryEnvelope: expect.objectContaining({
            methodName: ".lq.ResSyncGame",
            requestId: 0x1234,
            syncGameStep: 101,
            gameRestorePayloadLength: restorePayload.length,
            snapshotPayloadLength: snapshotPayload.length
          })
        }
      },
      {
        type: "discard_tile",
        payload: {
          seat: 2,
          tile: "7s",
          binaryEnvelope: expect.objectContaining({
            methodName: ".lq.ResSyncGame",
            requestId: 0x1234,
            actionName: "ActionDiscardTile",
            step: 101
          })
        }
      }
    ]);
  });

  it("extracts a visible round snapshot from ResEnterGame game_restore responses", () => {
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

    expect(parseBinaryEnvelope(frame)).toMatchObject({
      frameTypeName: "Response",
      requestId: 0x3456,
      methodName: ".lq.ResEnterGame",
      restoreActionNames: ["ActionDealTile"]
    });
    expect(parseBinaryMessage(frame)).toMatchObject([
      {
        type: "round_start",
        payload: {
          round: "0-1",
          chang: 0,
          ju: 1,
          honba: 2,
          leftTileCount: 52,
          tiles: ["4m", "5m", "6m"],
          doraIndicators: ["3s"],
          discards: [["2z"], [], [], []],
          scores: [25000],
          binaryEnvelope: expect.objectContaining({
            methodName: ".lq.ResEnterGame",
            requestId: 0x3456,
            gameRestoreSourceMethod: "ResEnterGame",
            enterGameEnded: false,
            gameRestorePayloadLength: restorePayload.length,
            snapshotPayloadLength: snapshotPayload.length
          })
        }
      },
      {
        type: "draw_tile",
        payload: {
          seat: 0,
          tile: "7m",
          leftTileCount: 51,
          binaryEnvelope: expect.objectContaining({
            methodName: ".lq.ResEnterGame",
            requestId: 0x3456,
            gameRestoreSourceMethod: "ResEnterGame",
            actionName: "ActionDealTile",
            step: 12
          })
        }
      }
    ]);
  });

  it("extracts visible replay fields from direct Record* binary methods", () => {
    const recordNewRoundPayload = [
      ...protobufVarint(1, 2),
      ...protobufVarint(2, 3),
      ...protobufVarint(3, 1),
      ...protobufString(4, "5p"),
      ...protobufBytes(5, [...encodeVarint(27000), ...encodeVarint(23000)]),
      ...protobufVarint(6, 1),
      ...protobufString(7, "1m"),
      ...protobufString(7, "2m"),
      ...protobufString(7, "3m"),
      ...protobufVarint(15, 68),
      ...protobufString(16, "1z")
    ];
    const newRoundFrame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.RecordNewRound"),
      ...protobufBytes(2, recordNewRoundPayload)
    ]);

    expect(parseBinaryMessage(newRoundFrame)[0]).toMatchObject({
      type: "round_start",
      payload: {
        round: "2-3",
        chang: 2,
        ju: 3,
        honba: 1,
        riichiSticks: 1,
        doraIndicators: ["5p", "1z"],
        scores: [27000, 23000],
        tiles: ["1m", "2m", "3m"],
        leftTileCount: 68,
        binaryEnvelope: expect.objectContaining({
          methodName: ".lq.RecordNewRound",
          actionName: "RecordNewRound"
        })
      }
    });

    const recordDealPayload = [
      ...protobufVarint(1, 0),
      ...protobufString(2, "7s"),
      ...protobufVarint(3, 32),
      ...protobufString(6, "2z")
    ];
    const dealFrame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.RecordDealTile"),
      ...protobufBytes(2, recordDealPayload)
    ]);
    expect(parseBinaryMessage(dealFrame)[0]).toMatchObject({
      type: "draw_tile",
      payload: {
        seat: 0,
        tile: "7s",
        leftTileCount: 32,
        doraIndicators: ["2z"]
      }
    });

    const recordDiscardPayload = [
      ...protobufVarint(1, 1),
      ...protobufString(2, "9m"),
      ...protobufVarint(3, 1),
      ...protobufVarint(5, 1),
      ...protobufString(8, "3z")
    ];
    const discardFrame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.RecordDiscardTile"),
      ...protobufBytes(2, recordDiscardPayload)
    ]);
    expect(parseBinaryMessage(discardFrame)[0]).toMatchObject({
      type: "discard_tile",
      payload: {
        seat: 1,
        tile: "9m",
        isRiichi: true,
        tsumogiri: true,
        doraIndicators: ["3z"]
      }
    });

    const recordCallPayload = [
      ...protobufVarint(1, 2),
      ...protobufVarint(2, 1),
      ...protobufString(3, "3p"),
      ...protobufString(3, "4p"),
      ...protobufString(3, "5p")
    ];
    const callFrame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.RecordChiPengGang"),
      ...protobufBytes(2, recordCallPayload)
    ]);
    expect(parseBinaryMessage(callFrame)[0]).toMatchObject({
      type: "call_meld",
      payload: {
        seat: 2,
        type: 1,
        meld: ["3p", "4p", "5p"]
      }
    });

    const recordKanPayload = [
      ...protobufVarint(1, 1),
      ...protobufVarint(2, 2),
      ...protobufString(3, "5p"),
      ...protobufString(6, "6z")
    ];
    const kanFrame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.RecordAnGangAddGang"),
      ...protobufBytes(2, recordKanPayload)
    ]);
    expect(parseBinaryMessage(kanFrame)[0]).toMatchObject({
      type: "call_meld",
      payload: {
        seat: 1,
        type: 2,
        meld: ["5p"],
        doraIndicators: ["6z"]
      }
    });

    const recordBeiPayload = [
      ...protobufVarint(1, 0),
      ...protobufString(6, "2z"),
      ...protobufVarint(8, 1)
    ];
    const beiFrame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.RecordBaBei"),
      ...protobufBytes(2, recordBeiPayload)
    ]);
    expect(parseBinaryMessage(beiFrame)[0]).toMatchObject({
      type: "call_meld",
      payload: {
        seat: 0,
        type: "babei",
        meld: ["4z"],
        tsumogiri: true,
        doraIndicators: ["2z"]
      }
    });
  });

  it("extracts visible replay round-end fields from direct Record* binary methods", () => {
    const recordHulePayload = [
      ...protobufBytes(5, [...encodeVarint(35000), ...encodeVarint(15000)]),
      ...protobufString(7, "4p")
    ];
    const huleFrame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.RecordHule"),
      ...protobufBytes(2, recordHulePayload)
    ]);
    expect(parseBinaryMessage(huleFrame)[0]).toMatchObject({
      type: "round_end",
      payload: {
        reason: "hule",
        scores: [35000, 15000],
        doraIndicators: ["4p"]
      }
    });

    const recordHuleGameEndPayload = [
      ...protobufBytes(6, [...protobufBytes(1, [...encodeVarint(33000), ...encodeVarint(17000)])]),
      ...protobufString(7, "5p")
    ];
    const huleGameEndFrame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.RecordHule"),
      ...protobufBytes(2, recordHuleGameEndPayload)
    ]);
    expect(parseBinaryMessage(huleGameEndFrame)[0]).toMatchObject({
      type: "round_end",
      payload: {
        reason: "hule",
        scores: [33000, 17000],
        doraIndicators: ["5p"]
      }
    });

    const recordLiuJuPayload = [
      ...protobufVarint(1, 2),
      ...protobufBytes(2, [...protobufBytes(1, [...encodeVarint(27000), ...encodeVarint(23000)])]),
      ...protobufVarint(3, 1),
      ...protobufString(4, "1m"),
      ...protobufString(4, "2m")
    ];
    const liujuFrame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.RecordLiuJu"),
      ...protobufBytes(2, recordLiuJuPayload)
    ]);
    expect(parseBinaryMessage(liujuFrame)[0]).toMatchObject({
      type: "round_end",
      payload: {
        reason: "liuju",
        type: 2,
        seat: 1,
        tiles: ["1m", "2m"],
        scores: [27000, 23000]
      }
    });

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
    const recordNoTilePayload = [
      ...protobufVarint(1, 1),
      ...protobufBytes(3, firstScore),
      ...protobufBytes(3, secondScore),
      ...protobufBytes(3, thirdScore),
      ...protobufBytes(3, fourthScore),
      ...protobufVarint(4, 1)
    ];
    const noTileFrame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.RecordNoTile"),
      ...protobufBytes(2, recordNoTilePayload)
    ]);
    expect(parseBinaryMessage(noTileFrame)[0]).toMatchObject({
      type: "round_end",
      payload: {
        reason: "no_tile",
        type: 1,
        liujumanguan: true,
        gameEnd: true,
        scores: [26000, 25000, 24000, 25000],
        doraIndicators: ["4p"]
      }
    });
  });

  it("extracts riichi action fields", () => {
    const riichiPayload = [
      ...protobufVarint(1, 2),
      ...protobufVarint(2, 77)
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 77),
      ...protobufString(2, "ActionLiqi"),
      ...protobufBytes(3, riichiPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);

    expect(parseBinaryMessage(frame)[0]).toMatchObject({
      type: "riichi",
      payload: {
        seat: 2,
        step: 77,
        binaryEnvelope: expect.objectContaining({ actionName: "ActionLiqi" })
      }
    });
  });

  it("extracts riichi success score and stick fields", () => {
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

    expect(parseBinaryMessage(frame)[0]).toMatchObject({
      type: "riichi",
      payload: {
        seat: 1,
        score: 24000,
        riichiSticks: 2,
        binaryEnvelope: expect.objectContaining({ actionName: "ActionLiqiSuccess" })
      }
    });
  });

  it("extracts direct replay riichi record fields", () => {
    const recordLiqiPayload = [
      ...protobufVarint(1, 3),
      ...protobufVarint(2, 91)
    ];
    const liqiFrame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.RecordLiqi"),
      ...protobufBytes(2, recordLiqiPayload)
    ]);
    expect(parseBinaryMessage(liqiFrame)[0]).toMatchObject({
      type: "riichi",
      payload: {
        seat: 3,
        step: 91,
        binaryEnvelope: expect.objectContaining({ actionName: "RecordLiqi" })
      }
    });

    const successPayload = [
      ...protobufVarint(1, 3),
      ...protobufVarint(2, 23000),
      ...protobufVarint(3, 2)
    ];
    const successFrame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.RecordLiqiSuccess"),
      ...protobufBytes(2, successPayload)
    ]);
    expect(parseBinaryMessage(successFrame)[0]).toMatchObject({
      type: "riichi",
      payload: {
        seat: 3,
        score: 23000,
        riichiSticks: 2,
        binaryEnvelope: expect.objectContaining({ actionName: "RecordLiqiSuccess" })
      }
    });
  });

  it("extracts conservative closed/add-kan fields as meld events", () => {
    const gangPayload = [
      ...protobufVarint(1, 1),
      ...protobufVarint(2, 2),
      ...protobufString(3, "5p"),
      ...protobufString(6, "1z")
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 81),
      ...protobufString(2, "ActionAnGangAddGang"),
      ...protobufBytes(3, gangPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);

    expect(parseBinaryMessage(frame)[0]).toMatchObject({
      type: "call_meld",
      payload: {
        seat: 1,
        type: 2,
        meld: ["5p"],
        doraIndicators: ["1z"],
        binaryEnvelope: expect.objectContaining({ actionName: "ActionAnGangAddGang" })
      }
    });
  });

  it("extracts conservative north reveal fields as visible meld events", () => {
    const beiPayload = [
      ...protobufVarint(1, 0),
      ...protobufString(6, "2z"),
      ...protobufVarint(9, 1)
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 82),
      ...protobufString(2, "ActionBaBei"),
      ...protobufBytes(3, beiPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);

    expect(parseBinaryMessage(frame)[0]).toMatchObject({
      type: "call_meld",
      payload: {
        seat: 0,
        type: "babei",
        meld: ["4z"],
        tsumogiri: true,
        doraIndicators: ["2z"],
        binaryEnvelope: expect.objectContaining({ actionName: "ActionBaBei" })
      }
    });
  });

  it("extracts conservative dora-like action fields", () => {
    const doraPayload = [
      ...protobufString(1, "6p")
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 83),
      ...protobufString(2, "ActionNewDora"),
      ...protobufBytes(3, doraPayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);

    expect(parseBinaryMessage(frame)[0]).toMatchObject({
      type: "dora",
      payload: {
        tile: "6p",
        doraIndicators: ["6p"],
        binaryEnvelope: expect.objectContaining({ actionName: "ActionNewDora" })
      }
    });
  });

  it("extracts conservative round end fields", () => {
    const hulePayload = [
      ...protobufBytes(5, [...encodeVarint(32000), ...encodeVarint(18000)]),
      ...protobufString(7, "4p")
    ];
    const actionPrototypePayload = [
      ...protobufVarint(1, 88),
      ...protobufString(2, "ActionHule"),
      ...protobufBytes(3, hulePayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);

    expect(parseBinaryMessage(frame)[0]).toMatchObject({
      type: "round_end",
      payload: {
        reason: "hule",
        scores: [32000, 18000],
        doraIndicators: ["4p"],
        binaryEnvelope: expect.objectContaining({ actionName: "ActionHule" })
      }
    });
  });

  it("extracts conservative exhaustive-draw round end fields", () => {
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
      ...protobufVarint(1, 89),
      ...protobufString(2, "ActionNoTile"),
      ...protobufBytes(3, noTilePayload)
    ];
    const frame = new Uint8Array([
      1,
      ...protobufString(1, ".lq.ActionPrototype"),
      ...protobufBytes(2, actionPrototypePayload)
    ]);

    expect(parseBinaryMessage(frame)[0]).toMatchObject({
      type: "round_end",
      payload: {
        reason: "no_tile",
        type: 1,
        liujumanguan: true,
        gameEnd: true,
        scores: [26000, 25000, 24000, 25000],
        doraIndicators: ["4p"],
        binaryEnvelope: expect.objectContaining({ actionName: "ActionNoTile" })
      }
    });
  });
});
