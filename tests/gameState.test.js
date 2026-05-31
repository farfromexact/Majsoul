import { describe, expect, it } from "vitest";
import { GameState } from "../src/core/gameState.js";
import { parseTiles } from "../src/core/tile.js";

describe("GameState", () => {
  it("updates visible state from standardized events", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "round_start",
      source: "manual",
      ts: 1,
      payload: { round: "E1", honba: 1, riichiSticks: 0, roundWind: "E", seatWind: "S" }
    });
    gameState.applyEvent({
      type: "deal_hand",
      source: "manual",
      ts: 2,
      payload: { tiles: parseTiles("123m456p789s11z") }
    });
    gameState.applyEvent({
      type: "draw_tile",
      source: "manual",
      ts: 3,
      payload: { seat: 0, tile: "0m" }
    });
    gameState.applyEvent({
      type: "discard_tile",
      source: "manual",
      ts: 4,
      payload: { seat: 0, tile: "5m" }
    });

    const state = gameState.getVisibleState();
    expect(state.round).toBe("E1");
    expect(state.honba).toBe(1);
    expect(state.hand).toEqual(parseTiles("123m456p789s11z"));
    expect(state.drawnTile).toBeNull();
    expect(state.discards[0]).toEqual(["5m"]);
  });

  it("preserves numeric round indexes and derives winds from chang and ju", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "round_start",
      source: "ws_in",
      ts: 1,
      payload: { round: "1-2", chang: 1, ju: 2, honba: 3, riichiSticks: 1 }
    });

    const state = gameState.getVisibleState();
    expect(state.round).toBe("1-2");
    expect(state.chang).toBe(1);
    expect(state.ju).toBe(2);
    expect(state.roundWind).toBe("S");
    expect(state.seatWind).toBe("W");
    expect(state.honba).toBe(3);
    expect(state.riichiSticks).toBe(1);
    expect(state.scoresKnown).toBe(false);
  });

  it("preserves explicit seat wind over derived seat wind", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "round_start",
      source: "ws_in",
      ts: 1,
      payload: { chang: 0, ju: 2, seatWind: "S" }
    });

    expect(gameState.getVisibleState().seatWind).toBe("S");
  });

  it("applies readable round_start chang and ju metadata", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "round_start",
      source: "ws_in",
      ts: 1,
      payload: { round: "1-3", chang: 1, ju: 3 }
    });

    const state = gameState.getVisibleState();
    expect(state.round).toBe("1-3");
    expect(state.chang).toBe(1);
    expect(state.ju).toBe(3);
    expect(state.roundWind).toBe("S");
    expect(state.seatWind).toBe("S");
  });

  it("restores visible table snapshot fields from round_start payloads", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "round_start",
      source: "ws_in",
      ts: 1,
      payload: {
        round: "1-2",
        chang: 1,
        ju: 2,
        tiles: ["1m", "2m", "3m"],
        discards: [["9s"], ["1z"], [], []],
        melds: [[["3p", "4p", "5p"]], [], [], []],
        doraIndicators: ["4p"],
        scores: [26000, 24000, 25000, 25000],
        currentTurn: 3,
        leftTileCount: 42,
        riichi: [true, false, false, false]
      }
    });

    const state = gameState.getVisibleState();
    expect(state.hand).toEqual(["1m", "2m", "3m"]);
    expect(state.discards).toEqual([["9s"], ["1z"], [], []]);
    expect(state.melds).toEqual([[["3p", "4p", "5p"]], [], [], []]);
    expect(state.doraIndicators).toEqual(["4p"]);
    expect(state.scoresKnown).toBe(true);
    expect(state.currentTurn).toBe(3);
    expect(state.leftTileCount).toBe(42);
    expect(state.riichi).toEqual([true, false, false, false]);
    expect(state.visibleTiles).toEqual(["4p", "9s", "1z", "3p", "4p", "5p"]);
  });

  it("moves own drawn tile into hand after discarding a different hand tile", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "deal_hand",
      source: "manual",
      ts: 1,
      payload: { tiles: parseTiles("123m123p123s456s1z") }
    });
    gameState.applyEvent({
      type: "draw_tile",
      source: "manual",
      ts: 2,
      payload: { seat: 0, tile: "9s" }
    });
    gameState.applyEvent({
      type: "discard_tile",
      source: "manual",
      ts: 3,
      payload: { seat: 0, tile: "1m" }
    });

    const state = gameState.getVisibleState();
    expect(state.drawnTile).toBeNull();
    expect(state.hand).toHaveLength(13);
    expect(state.hand).not.toContain("1m");
    expect(state.hand).toContain("9s");
    expect(state.discards[0]).toEqual(["1m"]);
    expect(state.currentTurn).toBeNull();
  });

  it("does not invent a base hand from own draw/discard events before the hand is known", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "draw_tile",
      source: "ws_in",
      ts: 1,
      payload: { seat: 0, tile: "9s" }
    });
    gameState.applyEvent({
      type: "discard_tile",
      source: "ws_in",
      ts: 2,
      payload: { seat: 0, tile: "1m" }
    });

    const state = gameState.getVisibleState();
    expect(state.handKnown).toBe(false);
    expect(state.hand).toEqual([]);
    expect(state.drawnTile).toBeNull();
    expect(state.discards[0]).toEqual(["1m"]);
    expect(state.warnings).toEqual([]);
  });

  it("clears current turn after a discard event", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "draw_tile",
      source: "manual",
      ts: 1,
      payload: { seat: 2, tile: "4p" }
    });
    expect(gameState.getVisibleState().currentTurn).toBe(2);

    gameState.applyEvent({
      type: "discard_tile",
      source: "manual",
      ts: 2,
      payload: { seat: 2, tile: "4p" }
    });

    const state = gameState.getVisibleState();
    expect(state.currentTurn).toBeNull();
    expect(state.discards[2]).toEqual(["4p"]);
  });

  it("sets current turn to the caller after a call meld event", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "discard_tile",
      source: "ws_in",
      ts: 1,
      payload: { seat: 1, tile: "4p" }
    });
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 2,
      payload: {
        seat: 2,
        meld: ["3p", "4p", "5p"],
        binaryEnvelope: { actionName: "ActionChiPengGang" }
      }
    });

    const state = gameState.getVisibleState();
    expect(state.currentTurn).toBe(2);
    expect(state.discards[1]).toEqual([]);
    expect(state.melds[2]).toEqual([["3p", "4p", "5p"]]);
  });

  it("ignores incomplete tile events without corrupting state", () => {
    const gameState = new GameState();
    gameState.applyEvent({ type: "draw_tile", source: "ws_in", ts: 1, payload: {} });
    gameState.applyEvent({ type: "discard_tile", source: "ws_in", ts: 2, payload: { seat: 0 } });
    gameState.applyEvent({ type: "dora", source: "ws_in", ts: 3, payload: {} });

    const state = gameState.getVisibleState();
    expect(state.drawnTile).toBeNull();
    expect(state.discards[0]).toEqual([]);
    expect(state.doraIndicators).toEqual([]);
  });

  it("ignores invalid parsed tiles and reports them as warnings", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "round_start",
      source: "ws_in",
      ts: 1,
      payload: { tiles: ["1m", "9z"], doraIndicators: ["8z"] }
    });
    gameState.applyEvent({ type: "draw_tile", source: "ws_in", ts: 2, payload: { seat: 0, tile: "10m" } });
    gameState.applyEvent({ type: "discard_tile", source: "ws_in", ts: 3, payload: { seat: 1, tile: "x" } });
    gameState.applyEvent({ type: "call_meld", source: "ws_in", ts: 4, payload: { seat: 2, meld: ["3p", "0z", "4p"] } });

    const state = gameState.getVisibleState();
    expect(state.hand).toEqual(["1m"]);
    expect(state.drawnTile).toBeNull();
    expect(state.doraIndicators).toEqual([]);
    expect(state.discards[1]).toEqual([]);
    expect(state.melds[2]).toEqual([["3p", "4p"]]);
    expect(state.visibleTiles).toEqual(["3p", "4p"]);
    expect(state.warnings).toEqual([
      "ignored invalid tile 9z from round_start.tiles",
      "ignored invalid tile 8z from round_start.doraIndicators",
      "ignored invalid tile 10m from draw_tile.tile",
      "ignored invalid tile x from discard_tile.tile",
      "ignored invalid tile 0z from call_meld.meld"
    ]);
  });

  it("does not mutate parsed event payloads while normalizing state tiles", () => {
    const gameState = new GameState();
    const drawEvent = { type: "draw_tile", source: "ws_in", ts: 1, payload: { seat: 0, tile: "0m" } };
    const discardEvent = { type: "discard_tile", source: "ws_in", ts: 2, payload: { seat: 0, tile: "0m" } };

    gameState.applyEvent(drawEvent);
    gameState.applyEvent(discardEvent);

    const state = gameState.getVisibleState();
    expect(drawEvent.payload.tile).toBe("0m");
    expect(discardEvent.payload.tile).toBe("0m");
    expect(state.events[1].payload.tile).toBe("0m");
    expect(state.events[0].payload.tile).toBe("0m");
    expect(state.discards[0]).toEqual(["5m"]);
  });

  it("sanitizes chi/peng/gang meld payloads only once", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 1,
      payload: {
        seat: 2,
        meld: ["3p", "0z", "4p"],
        binaryEnvelope: { actionName: "ActionChiPengGang" }
      }
    });

    const state = gameState.getVisibleState();
    expect(state.melds[2]).toEqual([["3p", "4p"]]);
    expect(state.invalidTiles).toEqual([{ tile: "0z", context: "call_meld.meld" }]);
    expect(state.warnings).toEqual(["ignored invalid tile 0z from call_meld.meld"]);
  });

  it("does not write seat-specific state when seat is missing", () => {
    const gameState = new GameState();
    gameState.applyEvent({ type: "discard_tile", source: "ws_in", ts: 1, payload: { tile: "7m", isRiichi: true, doraIndicators: ["1z"] } });
    gameState.applyEvent({ type: "call_meld", source: "ws_in", ts: 2, payload: { meld: ["2p", "3p", "4p"] } });
    gameState.applyEvent({ type: "riichi", source: "ws_in", ts: 3, payload: {} });

    const state = gameState.getVisibleState();
    expect(state.discards).toEqual([[], [], [], []]);
    expect(state.melds).toEqual([[], [], [], []]);
    expect(state.riichi).toEqual([false, false, false, false]);
    expect(state.doraIndicators).toEqual(["1z"]);
    expect(state.visibleTiles).toEqual(["1z"]);
  });

  it("keeps raw messages out of state events and exposes visible tiles", () => {
    const gameState = new GameState();
    gameState.applyEvent({ type: "raw_message", source: "ws_in", ts: 1, payload: { preview: "x" } });
    gameState.applyEvent({ type: "dora", source: "ws_in", ts: 2, payload: { tile: "1m" } });
    gameState.applyEvent({ type: "dora", source: "ws_in", ts: 3, payload: { tile: "1m" } });
    gameState.applyEvent({ type: "discard_tile", source: "ws_in", ts: 4, payload: { seat: 2, tile: "9s" } });
    gameState.applyEvent({ type: "call_meld", source: "ws_in", ts: 5, payload: { seat: 1, meld: ["3p", "4p", "5p"] } });

    const state = gameState.getVisibleState();
    expect(state.events.map((event) => event.type)).toEqual(["call_meld", "discard_tile", "dora", "dora"]);
    expect(state.doraIndicators).toEqual(["1m", "1m"]);
    expect(state.visibleTiles).toEqual(["1m", "1m", "9s", "3p", "4p", "5p"]);
  });

  it("accepts dora indicator arrays on standard dora events", () => {
    const gameState = new GameState();
    gameState.applyEvent({ type: "dora", source: "ws_in", ts: 1, payload: { doraIndicators: ["2m", "3m"] } });

    const state = gameState.getVisibleState();
    expect(state.events.map((event) => event.type)).toEqual(["dora"]);
    expect(state.doraIndicators).toEqual(["2m", "3m"]);
    expect(state.visibleTiles).toEqual(["2m", "3m"]);
  });

  it("keeps helper diagnostics out of game state", () => {
    const gameState = new GameState();
    gameState.applyEvent({ type: "capture_error", source: "ws_in", ts: 1, payload: { message: "capture failed" } });

    const state = gameState.getVisibleState();
    expect(state.events).toEqual([]);
    expect(state.lastStep).toBeNull();
    expect(state.visibleTiles).toEqual([]);
  });

  it("stores kan-style meld payloads as visible meld tiles", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 1,
      payload: { seat: 2, type: 2, meld: ["5p", "5p", "5p", "5p"] }
    });

    const state = gameState.getVisibleState();
    expect(state.melds[2]).toEqual([["5p", "5p", "5p", "5p"]]);
    expect(state.visibleTiles).toEqual(["5p", "5p", "5p", "5p"]);
  });

  it("absorbs dora indicators carried by call meld events", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 1,
      payload: {
        seat: 1,
        meld: ["5p"],
        doraIndicators: ["3s"],
        binaryEnvelope: { actionName: "ActionAnGangAddGang" }
      }
    });

    const state = gameState.getVisibleState();
    expect(state.doraIndicators).toEqual(["3s"]);
    expect(state.visibleTiles).toEqual(["3s", "5p"]);
  });

  it("expands closed kan events into four visible tiles", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 1,
      payload: {
        seat: 2,
        type: 3,
        meld: ["5p"],
        binaryEnvelope: { actionName: "ActionAnGangAddGang" }
      }
    });

    const state = gameState.getVisibleState();
    expect(state.melds[2]).toEqual([["5p", "5p", "5p", "5p"]]);
    expect(state.visibleTiles).toEqual(["5p", "5p", "5p", "5p"]);
  });

  it("removes own concealed kan tiles from hand", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "deal_hand",
      source: "manual",
      ts: 1,
      payload: { tiles: ["5p", "5p", "5p", "5p", "1m", "2m"] }
    });
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 2,
      payload: {
        seat: 0,
        type: 3,
        meld: ["5p"],
        binaryEnvelope: { actionName: "ActionAnGangAddGang" }
      }
    });

    const state = gameState.getVisibleState();
    expect(state.hand).toEqual(["1m", "2m"]);
    expect(state.melds[0]).toEqual([["5p", "5p", "5p", "5p"]]);
    expect(state.visibleTiles).toEqual(["5p", "5p", "5p", "5p"]);
  });

  it("upgrades own added kan meld and removes the added tile from drawnTile", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "round_start",
      source: "manual",
      ts: 1,
      payload: {
        tiles: ["1m", "2m"],
        melds: [[["5p", "5p", "5p"]], [], [], []]
      }
    });
    gameState.applyEvent({
      type: "draw_tile",
      source: "manual",
      ts: 2,
      payload: { seat: 0, tile: "5p" }
    });
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 3,
      payload: {
        seat: 0,
        type: 2,
        meld: ["5p"],
        binaryEnvelope: { actionName: "ActionAnGangAddGang" }
      }
    });

    const state = gameState.getVisibleState();
    expect(state.drawnTile).toBeNull();
    expect(state.hand).toEqual(["1m", "2m"]);
    expect(state.melds[0]).toEqual([["5p", "5p", "5p", "5p"]]);
    expect(state.visibleTiles).toEqual(["5p", "5p", "5p", "5p"]);
  });

  it("does not create phantom melds when call events have no valid meld tiles", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 1,
      payload: {
        seat: 1,
        doraIndicators: ["3s"],
        binaryEnvelope: { actionName: "ActionAnGangAddGang" }
      }
    });
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 2,
      payload: {
        seat: 2,
        meld: ["0z"],
        binaryEnvelope: { actionName: "ActionChiPengGang" }
      }
    });

    const state = gameState.getVisibleState();
    expect(state.melds).toEqual([[], [], [], []]);
    expect(state.doraIndicators).toEqual(["3s"]);
    expect(state.visibleTiles).toEqual(["3s"]);
    expect(state.warnings).toEqual(["ignored invalid tile 0z from call_meld.meld"]);
  });

  it("tracks own north reveal as visible state and removes one north from hand", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "deal_hand",
      source: "manual",
      ts: 1,
      payload: { tiles: ["4z", "1m", "2m", "3m"] }
    });
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 2,
      payload: {
        seat: 0,
        meld: ["4z"],
        doraIndicators: ["2z"],
        binaryEnvelope: { actionName: "ActionBaBei" }
      }
    });

    const state = gameState.getVisibleState();
    expect(state.hand).toEqual(["1m", "2m", "3m"]);
    expect(state.melds[0]).toEqual([["4z"]]);
    expect(state.doraIndicators).toEqual(["2z"]);
    expect(state.visibleTiles).toEqual(["2z", "4z"]);
  });

  it("treats babei call events without meld payloads as visible north reveals", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "deal_hand",
      source: "manual",
      ts: 1,
      payload: { tiles: ["4z", "1m", "2m", "3m"] }
    });
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 2,
      payload: {
        seat: 0,
        type: "babei",
        doraIndicators: ["2z"]
      }
    });

    const state = gameState.getVisibleState();
    expect(state.hand).toEqual(["1m", "2m", "3m"]);
    expect(state.melds[0]).toEqual([["4z"]]);
    expect(state.visibleTiles).toEqual(["2z", "4z"]);
  });

  it("handles replay RecordBaBei with the same visible state effects", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "deal_hand",
      source: "manual",
      ts: 1,
      payload: { tiles: ["4z", "4z", "1m", "2m"] }
    });
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 2,
      payload: {
        seat: 0,
        type: "babei",
        meld: ["4z"],
        doraIndicators: ["3z"],
        binaryEnvelope: { actionName: "RecordBaBei" }
      }
    });

    const state = gameState.getVisibleState();
    expect(state.hand).toEqual(["4z", "1m", "2m"]);
    expect(state.melds[0]).toEqual([["4z"]]);
    expect(state.doraIndicators).toEqual(["3z"]);
    expect(state.visibleTiles).toEqual(["3z", "4z"]);
  });

  it("moves a called discard from river into chi/peng/gang meld visibility", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "discard_tile",
      source: "ws_in",
      ts: 1,
      payload: { seat: 1, tile: "4p" }
    });
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 2,
      payload: {
        seat: 2,
        meld: ["3p", "4p", "5p"],
        binaryEnvelope: { actionName: "ActionChiPengGang" }
      }
    });

    const state = gameState.getVisibleState();
    expect(state.discards[1]).toEqual([]);
    expect(state.melds[2]).toEqual([["3p", "4p", "5p"]]);
    expect(state.visibleTiles).toEqual(["3p", "4p", "5p"]);
  });

  it("handles replay RecordChiPengGang as a claimed discard transfer", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "discard_tile",
      source: "ws_in",
      ts: 1,
      payload: { seat: 3, tile: "7s" }
    });
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 2,
      payload: {
        seat: 1,
        meld: ["7s", "7s", "7s"],
        binaryEnvelope: { actionName: "RecordChiPengGang" }
      }
    });

    const state = gameState.getVisibleState();
    expect(state.discards[3]).toEqual([]);
    expect(state.melds[1]).toEqual([["7s", "7s", "7s"]]);
    expect(state.visibleTiles).toEqual(["7s", "7s", "7s"]);
  });

  it("removes own consumed hand tiles after calling chi/peng/gang on a discard", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "deal_hand",
      source: "manual",
      ts: 1,
      payload: { tiles: ["3p", "5p", "1m", "2m", "3m"] }
    });
    gameState.applyEvent({
      type: "discard_tile",
      source: "ws_in",
      ts: 2,
      payload: { seat: 1, tile: "4p" }
    });
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 3,
      payload: {
        seat: 0,
        meld: ["3p", "4p", "5p"],
        binaryEnvelope: { actionName: "ActionChiPengGang" }
      }
    });

    const state = gameState.getVisibleState();
    expect(state.hand).toEqual(["1m", "2m", "3m"]);
    expect(state.discards[1]).toEqual([]);
    expect(state.melds[0]).toEqual([["3p", "4p", "5p"]]);
    expect(state.visibleTiles).toEqual(["3p", "4p", "5p"]);
  });

  it("removes own consumed hand tiles for replay RecordChiPengGang calls", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "deal_hand",
      source: "manual",
      ts: 1,
      payload: { tiles: ["6s", "8s", "1m", "2m"] }
    });
    gameState.applyEvent({
      type: "discard_tile",
      source: "ws_in",
      ts: 2,
      payload: { seat: 2, tile: "7s" }
    });
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 3,
      payload: {
        seat: 0,
        meld: ["6s", "7s", "8s"],
        binaryEnvelope: { actionName: "RecordChiPengGang" }
      }
    });

    const state = gameState.getVisibleState();
    expect(state.hand).toEqual(["1m", "2m"]);
    expect(state.discards[2]).toEqual([]);
    expect(state.melds[0]).toEqual([["6s", "7s", "8s"]]);
  });

  it("does not remove own hand tiles for other players' calls", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "deal_hand",
      source: "manual",
      ts: 1,
      payload: { tiles: ["3p", "5p", "1m"] }
    });
    gameState.applyEvent({
      type: "discard_tile",
      source: "ws_in",
      ts: 2,
      payload: { seat: 1, tile: "4p" }
    });
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 3,
      payload: {
        seat: 2,
        meld: ["3p", "4p", "5p"],
        binaryEnvelope: { actionName: "ActionChiPengGang" }
      }
    });

    expect(gameState.getVisibleState().hand).toEqual(["3p", "5p", "1m"]);
  });

  it("does not remove river tiles for closed or added kan events", () => {
    const gameState = new GameState();
    gameState.applyEvent({ type: "discard_tile", source: "ws_in", ts: 1, payload: { seat: 1, tile: "5p" } });
    gameState.applyEvent({
      type: "call_meld",
      source: "ws_in",
      ts: 2,
      payload: {
        seat: 2,
        meld: ["5p", "5p", "5p", "5p"],
        binaryEnvelope: { actionName: "ActionAnGangAddGang" }
      }
    });

    const state = gameState.getVisibleState();
    expect(state.discards[1]).toEqual(["5p"]);
    expect(state.melds[2]).toEqual([["5p", "5p", "5p", "5p"]]);
  });

  it("absorbs visible metadata from parsed draw and discard events", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "draw_tile",
      source: "ws_in",
      ts: 1,
      payload: {
        seat: 0,
        tile: "5m",
        leftTileCount: 42,
        doraIndicators: ["7z"],
        binaryEnvelope: { step: 12 }
      }
    });
    gameState.applyEvent({
      type: "discard_tile",
      source: "ws_in",
      ts: 2,
      payload: {
        seat: 2,
        tile: "9p",
        isRiichi: true,
        doraIndicators: ["7z", "3s"],
        binaryEnvelope: { step: 13 }
      }
    });

    const state = gameState.getVisibleState();
    expect(state.drawnTile).toBe("5m");
    expect(state.leftTileCount).toBe(42);
    expect(state.lastStep).toBe(13);
    expect(state.riichi[2]).toBe(true);
    expect(state.doraIndicators).toEqual(["7z", "3s"]);
    expect(state.visibleTiles).toEqual(["7z", "3s", "9p"]);
  });

  it("preserves duplicate dora indicators while avoiding duplicate full-list updates", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "round_start",
      source: "ws_in",
      ts: 1,
      payload: { doraIndicators: ["4p", "4p"] }
    });
    gameState.applyEvent({
      type: "draw_tile",
      source: "ws_in",
      ts: 2,
      payload: { seat: 1, tile: "1m", doraIndicators: ["4p", "4p"] }
    });
    gameState.applyEvent({
      type: "discard_tile",
      source: "ws_in",
      ts: 3,
      payload: { seat: 1, tile: "1m", doraIndicators: ["4p", "4p", "7z"] }
    });

    const state = gameState.getVisibleState();
    expect(state.doraIndicators).toEqual(["4p", "4p", "7z"]);
    expect(state.visibleTiles).toEqual(["4p", "4p", "7z", "1m"]);
  });

  it("can clear debug event history without clearing visible state", () => {
    const gameState = new GameState();
    gameState.applyEvent({ type: "dora", source: "manual", ts: 1, payload: { tile: "1z" } });
    expect(gameState.getVisibleState().events).toHaveLength(1);

    gameState.clearEvents();
    const state = gameState.getVisibleState();
    expect(state.events).toEqual([]);
    expect(state.doraIndicators).toEqual(["1z"]);
  });

  it("reports non-blocking consistency warnings", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "deal_hand",
      source: "manual",
      ts: 1,
      payload: { tiles: ["1m", "1m", "1m", "1m", "1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p"] }
    });
    gameState.applyEvent({
      type: "draw_tile",
      source: "manual",
      ts: 2,
      payload: { seat: 0, tile: "2p" }
    });

    expect(gameState.getVisibleState().warnings).toEqual([
      "hand has 15 tiles",
      "1m appears 5 times"
    ]);
  });

  it("warns when live ActionNewRound did not restore a complete state", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "round_start",
      source: "ws_in",
      ts: 1,
      payload: {
        tiles: [],
        doraIndicators: [],
        scores: [],
        binaryEnvelope: {
          methodName: ".lq.ActionPrototype",
          actionName: "ActionNewRound"
        }
      }
    });

    expect(gameState.getVisibleState().warnings).toEqual([
      "partial live state: round_start missing decoded hand, round metadata, dora indicators, scores"
    ]);

    gameState.applyEvent({
      type: "round_start",
      source: "ws_in",
      ts: 2,
      payload: {
        chang: 0,
        ju: 1,
        tiles: ["1m", "2m", "3m"],
        doraIndicators: ["4p"],
        scores: [25000, 25000, 25000, 25000],
        binaryEnvelope: {
          methodName: ".lq.ActionPrototype",
          actionName: "ActionNewRound"
        }
      }
    });

    expect(gameState.getVisibleState().warnings).toEqual([]);
  });

  it("tracks riichi and round end metadata", () => {
    const gameState = new GameState();
    gameState.applyEvent({ type: "riichi", source: "ws_in", ts: 1, payload: { seat: 2 } });
    gameState.applyEvent({ type: "round_end", source: "ws_in", ts: 2, payload: { reason: "hule", scores: [32000, 18000, 25000, 25000] } });

    const state = gameState.getVisibleState();
    expect(state.riichi[2]).toBe(true);
    expect(state.roundEndReason).toBe("hule");
    expect(state.scores).toEqual([32000, 18000, 25000, 25000]);
    expect(state.scoresKnown).toBe(true);
  });

  it("updates riichi sticks and player score from LiQiSuccess-derived events", () => {
    const gameState = new GameState();
    gameState.applyEvent({
      type: "riichi",
      source: "ws_in",
      ts: 1,
      payload: {
        seat: 1,
        score: 24000,
        riichiSticks: 2,
        sourceAction: "ActionDealTile"
      }
    });

    const state = gameState.getVisibleState();
    expect(state.riichi[1]).toBe(true);
    expect(state.riichiSticks).toBe(2);
    expect(state.scores[1]).toBe(24000);
    expect(state.scoresKnown).toBe(true);
  });

  it("tracks whether default-looking scores came from parsed state", () => {
    const gameState = new GameState();
    expect(gameState.getVisibleState().scoresKnown).toBe(false);

    gameState.applyEvent({
      type: "round_start",
      source: "ws_in",
      ts: 1,
      payload: { scores: [25000, 25000, 25000, 25000] }
    });

    const state = gameState.getVisibleState();
    expect(state.scores).toEqual([25000, 25000, 25000, 25000]);
    expect(state.scoresKnown).toBe(true);
  });
});
