import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("install page", () => {
  it("links to the generated userscript and states safety boundaries", () => {
    const html = readFileSync("install.html", "utf8");

    expect(html).toContain("./majsoul-helper.user.js");
    expect(html).toContain("./smoke.html");
    expect(html).toContain("No auto discard");
    expect(html).toContain("No click or keyboard automation");
    expect(html).toContain("No WebSocket payload mutation");
    expect(html).toContain("Realtime advice is off by default");
    expect(html).toContain("Before real-page sampling");
    expect(html).toContain("npm run smoke");
    expect(html).toContain("Local smoke test");
    expect(html).toContain("Emit sample traffic");
    expect(html).toContain("Self-test");
    expect(html).toContain("hook diagnostics");
    expect(html).toContain("MVP gate");
    expect(html).toContain("Real-page preflight");
    expect(html).toContain("15/15");
    expect(html).toContain("safety snapshot checks");
    expect(html).toContain("liveSafetySettings");
    expect(html).toContain("manual input clear");
    expect(html).toContain("automation/message mutation disabled");
    expect(html).toContain("missing items");
    expect(html).toContain("Download capture");
    expect(html).toContain("Copy capture");
    expect(html).toContain("npm run import-capture -- path/to/majsoul-helper-capture.json");
    expect(html).toContain("Import notice");
    expect(html).toContain("file was copied but still lacks one or more real-page proof fields");
    expect(html).toContain("npm run capture-doctor -- captures/capture-real.json");
    expect(html).toContain("npm run replay -- captures/capture-real.json");
    expect(html).toContain("npm run real-page-gate");
    expect(html).toContain("docs/real-page-sampling.md");
  });
});
