import { describe, expect, it } from "vitest";
import { calculateShanten } from "../src/core/shanten.js";
import { doraFromIndicator, parseTiles, tileToIndex } from "../src/core/tile.js";

describe("tile parsing", () => {
  it("normalizes red fives for analysis", () => {
    expect(parseTiles("0m0p0s")).toEqual(["5m", "5p", "5s"]);
    expect(tileToIndex("0m")).toBe(tileToIndex("5m"));
  });

  it("accepts common separators in hand input while keeping red fives strict", () => {
    expect(parseTiles("123m 456p,789s、11z")).toEqual(parseTiles("123m456p789s11z"));
    expect(() => tileToIndex("0 ")).toThrow("Invalid tile: 0 ");
    expect(() => parseTiles("0z")).toThrow("Red five is only valid for m/p/s");
  });

  it("derives dora tiles from indicators", () => {
    expect(doraFromIndicator("4m")).toBe("5m");
    expect(doraFromIndicator("9p")).toBe("1p");
    expect(doraFromIndicator("4z")).toBe("1z");
    expect(doraFromIndicator("7z")).toBe("5z");
    expect(doraFromIndicator("0s")).toBe("6s");
  });
});

describe("calculateShanten", () => {
  it("detects complete standard hands", () => {
    expect(calculateShanten(parseTiles("123m123p123s456s11z"))).toBe(-1);
  });

  it("detects standard tenpai", () => {
    expect(calculateShanten(parseTiles("123m123p123s456s1z"))).toBe(0);
  });

  it("detects chiitoitsu tenpai", () => {
    expect(calculateShanten(parseTiles("1122334455667m"))).toBe(0);
  });

  it("detects complete chiitoitsu hands", () => {
    expect(calculateShanten(parseTiles("11223344556677m"))).toBe(-1);
  });

  it("detects kokushi tenpai", () => {
    expect(calculateShanten(parseTiles("19m19p19s1234567z"))).toBe(0);
  });

  it("detects complete kokushi hands", () => {
    expect(calculateShanten(parseTiles("19m19p19s12345677z"))).toBe(-1);
  });

  it("counts open melds as completed standard melds", () => {
    expect(calculateShanten(parseTiles("45m11z"), { openMelds: 3 })).toBe(0);
    expect(calculateShanten(parseTiles("19m19p19s1234567z"), { openMelds: 1 })).toBeGreaterThan(0);
  });
});
