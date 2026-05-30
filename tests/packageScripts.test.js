import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("package scripts", () => {
  it("defines audit, build, capture-doctor, import-capture, mvp-check, real-page-gate, smoke, test, replay, validate-captures, and verify commands", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));

    expect(pkg.scripts).toMatchObject({
      audit: "node scripts/goal-audit.mjs",
      build: "node scripts/build-userscript.mjs",
      "capture-doctor": "node scripts/capture-doctor.mjs",
      "import-capture": "node scripts/import-capture.mjs",
      "mvp-check": "node scripts/mvp-check.mjs",
      "real-page-gate": "node scripts/real-page-gate.mjs",
      replay: "node scripts/replay-capture.mjs",
      smoke: "node scripts/smoke-check.mjs",
      test: "vitest run",
      "validate-captures": "node scripts/validate-captures.mjs",
      verify: "node scripts/verify.mjs"
    });
  });
});
