import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("userscript metadata", () => {
  it("runs at document-start in the page context so WebSocket hooks affect the game page", () => {
    const userscript = readFileSync("majsoul-helper.user.js", "utf8");
    const header = userscript.slice(0, userscript.indexOf("// ==/UserScript=="));

    expect(header).toContain("// @run-at       document-start");
    expect(header).toContain("// @inject-into  page");
    expect(header).toContain("// @grant        none");
  });

  it("targets known Mahjong Soul web hosts", () => {
    const userscript = readFileSync("majsoul-helper.user.js", "utf8");
    expect(userscript).toContain("// @match        *://*.mahjongsoul.com/*");
    expect(userscript).toContain("// @match        *://mahjongsoul.game.yo-star.com/*");
    expect(userscript).toContain("// @match        *://*.maj-soul.com/*");
    expect(userscript).toContain("// @match        *://game.maj-soul.com/*");
  });
});
