import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sourceFiles = [
  "src/main.js",
  "src/adapter/majsoulAdapter.js",
  "src/adapter/messageParser.js",
  "src/core/analyzer.js",
  "src/core/gameState.js",
  "src/ui/overlay.js"
];

function readProjectSource() {
  return sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");
}

describe("safety boundaries", () => {
  it("does not automate page clicks or keyboard input", () => {
    const source = readProjectSource();
    expect(source).not.toMatch(/\.click\s*\(/);
    expect(source).not.toMatch(/dispatchEvent\s*\(\s*new\s+(MouseEvent|KeyboardEvent|PointerEvent)/);
    expect(source).not.toMatch(/pyautogui|selenium|webdriver/i);
  });

  it("does not hide the overlay or anti-detection behavior", () => {
    const source = readProjectSource();
    expect(source).not.toMatch(/display\s*:\s*none[^;]*majsoul-helper/i);
    expect(source).not.toMatch(/anti[-_ ]?cheat|stealth|evade|bypass/i);
  });

  it("does not introduce outbound game action helpers", () => {
    const source = readProjectSource();
    expect(source).not.toMatch(/actionDiscardTile|actionLiqi|inputOperation|FastTest\.inputOperation/);
    expect(source).not.toMatch(/sendGame|sendAction|autoDiscard|autoClick/i);
  });
});
