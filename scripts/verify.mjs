import { spawnSync } from "node:child_process";

const commands = [
  npmCommand(["run", "build"]),
  npmCommand(["run", "mvp-check"]),
  npmCommand(["run", "smoke"]),
  npmCommand(["test"]),
  ["node", ["--check", "majsoul-helper.user.js"]],
  ["node", ["--check", "src/core/realPageReadiness.js"]],
  ["node", ["--check", "scripts/capture-doctor.mjs"]],
  ["node", ["--check", "scripts/goal-audit.mjs"]],
  ["node", ["--check", "scripts/import-capture.mjs"]],
  ["node", ["--check", "scripts/real-page-gate.mjs"]],
  ["node", ["--check", "scripts/replay-capture.mjs"]],
  ["node", ["--check", "scripts/validate-captures.mjs"]],
  ["node", ["scripts/goal-audit.mjs"]],
  ["node", ["scripts/replay-capture.mjs", "tests/fixtures/capture-ready.json", "--strict"]],
  ["node", ["scripts/validate-captures.mjs", "--dir", "tests/fixtures", "--require-ready"]]
];

for (const [command, args] of commands) {
  const label = [command, ...args].join(" ");
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function npmCommand(args) {
  if (process.platform !== "win32") return ["npm", args];
  return [process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm", ...args]];
}
