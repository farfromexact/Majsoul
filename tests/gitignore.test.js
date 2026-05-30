import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("gitignore", () => {
  it("ignores real capture files while keeping capture docs", () => {
    const gitignore = readFileSync(".gitignore", "utf8");

    expect(gitignore).toContain("captures/*.json");
    expect(gitignore).toContain("captures/*.jsonl");
    expect(gitignore).toContain("captures/*.txt");
    expect(gitignore).toContain("!captures/README.md");
  });
});
