import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("local smoke page", () => {
  it("loads the generated userscript after installing a fake page WebSocket", () => {
    const html = readFileSync("smoke.html", "utf8");
    const fakeSocketIndex = html.indexOf("class SmokeWebSocket");
    const userscriptIndex = html.indexOf('<script src="./majsoul-helper.user.js"></script>');

    expect(fakeSocketIndex).toBeGreaterThan(-1);
    expect(userscriptIndex).toBeGreaterThan(fakeSocketIndex);
    expect(html).toContain("SmokeWebSocket.instances");
    expect(html).toContain("Emit sample traffic");
    expect(html).toContain("ActionDealTile");
    expect(html).toContain("ActionDiscardTile");
    expect(html).toContain("round_start");
    expect(html).toContain("draw_tile");
    expect(html).toContain("discard_tile");
    expect(html).toContain("MVP gate: 16/16");
    expect(html).toContain("socket.receive(roundStartSample)");
    expect(html).toContain("socket.receive(drawSample)");
    expect(html).toContain("socket.receive(discardSample)");
    expect(html).not.toMatch(/\.click\s*\(/);
  });
});
