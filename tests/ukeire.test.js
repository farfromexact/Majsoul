import { describe, expect, it } from "vitest";
import { analyzeHand } from "../src/core/analyzer.js";
import { calculateUkeire } from "../src/core/ukeire.js";
import { parseTiles } from "../src/core/tile.js";

describe("calculateUkeire", () => {
  it("counts effective tiles that reduce shanten", () => {
    const result = calculateUkeire(parseTiles("123m123p123s456s1z"));
    expect(result.shanten).toBe(0);
    expect(result.ukeireTiles).toContain("1z");
    expect(result.ukeireBreakdown).toContainEqual({ tile: "1z", remaining: 3 });
    expect(result.ukeireCount).toBe(3);
  });

  it("subtracts visible tiles from remaining count", () => {
    const result = calculateUkeire(parseTiles("123m123p123s456s1z"), parseTiles("11z"));
    expect(result.ukeireTiles).toContain("1z");
    expect(result.ukeireCount).toBe(1);
  });

  it("normalizes visible red fives when counting remaining ukeire", () => {
    const result = calculateUkeire(parseTiles("123m123p123s46s11z"), parseTiles("0s"));
    expect(result.shanten).toBe(0);
    expect(result.ukeireTiles).toEqual(["5s"]);
    expect(result.ukeireBreakdown).toEqual([{ tile: "5s", remaining: 3 }]);
    expect(result.ukeireCount).toBe(3);
  });

  it("calculates ukeire with open melds counted as completed standard melds", () => {
    const result = calculateUkeire(parseTiles("45m11z"), [], { openMelds: 3 });
    expect(result.shanten).toBe(0);
    expect(result.ukeireTiles).toEqual(["3m", "6m"]);
    expect(result.ukeireBreakdown).toEqual([
      { tile: "3m", remaining: 4 },
      { tile: "6m", remaining: 4 }
    ]);
    expect(result.ukeireCount).toBe(8);
  });

  it("counts chiitoitsu pair waits and overlapping standard waits", () => {
    const result = calculateUkeire(parseTiles("1122334455667m"));

    expect(result.shanten).toBe(0);
    expect(result.ukeireTiles).toEqual(["1m", "4m", "7m"]);
    expect(result.ukeireBreakdown).toEqual([
      { tile: "1m", remaining: 2 },
      { tile: "4m", remaining: 2 },
      { tile: "7m", remaining: 3 }
    ]);
    expect(result.ukeireCount).toBe(7);
  });

  it("counts kokushi thirteen-sided waits with visible tiles removed", () => {
    const result = calculateUkeire(parseTiles("19m19p19s1234567z"), parseTiles("1m7z"));

    expect(result.shanten).toBe(0);
    expect(result.ukeireTiles).toEqual([
      "1m",
      "9m",
      "1p",
      "9p",
      "1s",
      "9s",
      "1z",
      "2z",
      "3z",
      "4z",
      "5z",
      "6z",
      "7z"
    ]);
    expect(result.ukeireBreakdown).toContainEqual({ tile: "1m", remaining: 2 });
    expect(result.ukeireBreakdown).toContainEqual({ tile: "7z", remaining: 2 });
    expect(result.ukeireCount).toBe(37);
  });

  it("rejects impossible known tile counts before reporting ukeire", () => {
    expect(() => calculateUkeire(parseTiles("1111m234p234s11z"), parseTiles("1m"))).toThrow("Known tile count exceeds four: 1m x5");
  });
});

describe("analyzeHand", () => {
  it("returns discard candidates sorted by shanten and ukeire", () => {
    const result = analyzeHand({ hand: parseTiles("123m123p123s456s11z") });
    expect(result.shanten).toBe(-1);
    expect(result.canDiscard).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].shantenAfterDiscard).toBe(0);
    expect(result.candidates[0].ukeireCount).toBeGreaterThan(0);
  });

  it("does not generate discard candidates outside a 3n+2 tile state", () => {
    const result = analyzeHand({ hand: parseTiles("123m123p123s456s1z") });

    expect(result.shanten).toBe(0);
    expect(result.canDiscard).toBe(false);
    expect(result.candidates).toEqual([]);
  });

  it("includes drawnTile and treats the simulated discard as visible for ukeire counts", () => {
    const result = analyzeHand({
      hand: parseTiles("123m123p123s46s11z"),
      drawnTile: "9m",
      visibleTiles: parseTiles("0s")
    });
    const discardCandidate = result.candidates.find((candidate) => candidate.discard === "9m");

    expect(result.hand).toEqual(parseTiles("1239m123p123s46s11z"));
    expect(result.canDiscard).toBe(true);
    expect(discardCandidate).toMatchObject({
      shantenAfterDiscard: 0,
      ukeireTiles: ["5s"],
      ukeireBreakdown: [{ tile: "5s", remaining: 3 }],
      ukeireCount: 3,
      ukeireTypes: 1
    });
  });

  it("counts the post-discard hand, existing visible tiles, and simulated discard together", () => {
    const result = analyzeHand({
      hand: parseTiles("123m123p123s456s11z"),
      visibleTiles: parseTiles("11z")
    });
    const pairDiscard = result.candidates.find((candidate) => candidate.discard === "1z");

    expect(pairDiscard).toMatchObject({
      shantenAfterDiscard: 0,
      ukeireCount: 0,
      ukeireTypes: 0
    });
    expect(pairDiscard.ukeireTiles).not.toContain("1z");
  });

  it("analyzes open hands using the provided open meld count", () => {
    const result = analyzeHand({
      hand: parseTiles("445m11z"),
      openMelds: 3
    });
    const discard = result.candidates.find((candidate) => candidate.discard === "4m");

    expect(result.openMelds).toBe(3);
    expect(discard).toMatchObject({
      shantenAfterDiscard: 0,
      ukeireTiles: ["3m", "6m"],
      ukeireCount: 8
    });
  });

  it("sorts kokushi discard candidates by remaining ukeire", () => {
    const result = analyzeHand({
      hand: parseTiles("19m19p19s12345677z")
    });

    expect(result.shanten).toBe(-1);
    expect(result.candidates[0]).toMatchObject({
      discard: "7z",
      shantenAfterDiscard: 0,
      ukeireCount: 38,
      ukeireTypes: 13
    });
  });

  it("rejects impossible hands before producing discard candidates", () => {
    expect(() => analyzeHand({
      hand: parseTiles("11111m222p333s44z")
    })).toThrow("Known tile count exceeds four: 1m x5");
  });
});
