import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const options = parseArgs(process.argv.slice(2));

const validate = runNodeScript("validate-captures.mjs", [
  "--dir",
  options.dir,
  "--summary",
  "--require-real-page-ready"
]);

writeResult(validate);
if (validate.status !== 0) {
  console.error("Real-page gate failed at validate-captures.");
  process.exit(validate.status || 1);
}

const audit = runNodeScript("goal-audit.mjs", [
  "--capture-dir",
  options.dir,
  "--strict"
]);

writeResult(audit);
if (audit.status !== 0) {
  console.error("Real-page gate failed at goal-audit strict check.");
  process.exit(audit.status || 1);
}

console.log("Real-page gate passed.");

function parseArgs(args) {
  const parsed = { dir: "captures" };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--dir") {
      const value = args[index + 1];
      if (!value) failUsage("Missing path after --dir");
      parsed.dir = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--dir=")) {
      parsed.dir = arg.slice("--dir=".length);
      if (!parsed.dir) failUsage("Missing path after --dir=");
      continue;
    }
    if (!arg.startsWith("-")) {
      parsed.dir = arg;
      continue;
    }
    failUsage(`Unknown option: ${arg}`);
  }

  return parsed;
}

function runNodeScript(scriptName, args) {
  const scriptPath = join(scriptDir, scriptName);
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
}

function writeResult(result) {
  if (result.stdout) process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
  if (result.stderr) process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
  }
}

function printUsage() {
  console.error("Usage: node scripts/real-page-gate.mjs [--dir captures]");
}

function failUsage(message) {
  console.error(message);
  printUsage();
  process.exit(1);
}
