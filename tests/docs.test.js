import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("docs", () => {
  it("documents safe real-page capture steps", () => {
    const doc = readFileSync("docs/real-page-sampling.md", "utf8");

    expect(doc).toContain("non-ranked");
    expect(doc).toContain("npm run smoke");
    expect(doc).toContain("smoke.html");
    expect(doc).toContain("Emit sample traffic");
    expect(doc).toContain("@inject-into page");
    expect(doc).toContain("mahjongsoul.game.yo-star.com");
    expect(doc).toContain("Keep realtime advice off");
    expect(doc).toContain("Do not use any auto-clicking or auto-discard tool");
    expect(doc).toContain("npm run capture-doctor -- captures/capture-real.json");
    expect(doc).toContain("npm run import-capture -- path/to/majsoul-helper-capture.json");
    expect(doc).toContain("refuses to overwrite");
    expect(doc).toContain("npm run replay -- captures/capture-real.json");
    expect(doc).toContain("npm run validate-captures");
    expect(doc).toContain("npm run validate-captures -- --summary");
    expect(doc).toContain("npm run validate-captures -- --require-real-page-ready");
    expect(doc).toContain("npm run real-page-gate");
    expect(doc).toContain("npm run validate-captures -- --require-real-page-ready");
    expect(doc).toContain("npm run audit -- --strict");
    expect(doc).toContain("npm run audit");
    expect(doc).toContain("Real-page preflight");
    expect(doc).toContain("raw_message");
    expect(doc).toContain("recommendations");
    expect(doc).toContain("actionDiagnostics");
    expect(doc).toContain("captureMetadata.verification");
    expect(doc).toContain("liveStateComparison");
    expect(doc).toContain("acceptance.readyForRealPageMvp");
    expect(doc).toContain("drawTileSeatParsed");
    expect(doc).toContain("discardTileSeatParsed");
    expect(doc).toContain("gameStateWarningsClear");
    expect(doc).toContain("gameState");
    expect(doc).toContain("ActionBaBei");
    expect(doc).toContain("GameRestore");
    expect(doc).toContain("RecordNewRound");
    expect(doc).toContain("fixtureKind: \"sanitized-replay\"");
  });
});
