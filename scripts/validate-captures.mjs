import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMahjongSoulPage, summarizeLiveRealPagePreflight, summarizeLiveSafetySettings } from "../src/core/realPageReadiness.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const replayScript = join(scriptDir, "replay-capture.mjs");

const options = parseArgs(process.argv.slice(2));
const captureDir = resolve(process.cwd(), options.dir);
const captureFiles = await listCaptureFiles(captureDir);
const results = captureFiles.map((file) => replayCapture(file));
const readyCaptures = results.filter((result) => result.readyForRealPageMvp).length;
const realPageReadyCaptures = results.filter((result) => result.realPageReady).length;
const replayFailures = results.filter((result) => !result.ok).length;

const output = {
  checkedAt: new Date().toISOString(),
  directory: relative(process.cwd(), captureDir) || ".",
  strict: options.strict,
  requireReady: options.requireReady,
  requireRealPageReady: options.requireRealPageReady,
  capturesFound: captureFiles.length,
  readyCaptures,
  realPageReadyCaptures,
  replayFailures,
  results,
  recommendations: buildRecommendations({
    captureCount: captureFiles.length,
    readyCaptures,
    realPageReadyCaptures,
    replayFailures,
    strict: options.strict,
    requireReady: options.requireReady,
    requireRealPageReady: options.requireRealPageReady
  })
};

console.log(options.summary ? formatSummary(output) : JSON.stringify(output, null, 2));

if (options.strict && (captureFiles.length === 0 || replayFailures > 0 || readyCaptures !== captureFiles.length)) {
  process.exit(2);
}

if (options.requireReady && readyCaptures === 0) {
  process.exit(2);
}

if (options.requireRealPageReady && realPageReadyCaptures === 0) {
  process.exit(2);
}

function parseArgs(args) {
  const parsed = {
    dir: "captures",
    strict: false,
    requireReady: false,
    requireRealPageReady: false,
    summary: false
  };

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
    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (arg === "--require-ready") {
      parsed.requireReady = true;
      continue;
    }
    if (arg === "--require-real-page-ready") {
      parsed.requireRealPageReady = true;
      continue;
    }
    if (arg === "--summary") {
      parsed.summary = true;
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

function printUsage() {
  console.error("Usage: node scripts/validate-captures.mjs [--dir captures] [--summary] [--require-ready] [--require-real-page-ready] [--strict]");
}

function failUsage(message) {
  console.error(message);
  printUsage();
  process.exit(1);
}

async function listCaptureFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => join(directory, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function replayCapture(file) {
  const result = spawnSync(process.execPath, [replayScript, file], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  const parsed = parseReplayOutput(result.stdout);
  const relativeFile = relative(process.cwd(), file);

  if (result.error) {
    return {
      file: relativeFile,
      ok: false,
      readyForRealPageMvp: false,
      error: result.error.message,
      recommendations: ["Replay process failed before producing diagnostics."]
    };
  }

  if (result.status !== 0 || !parsed) {
    return {
      file: relativeFile,
      ok: false,
      readyForRealPageMvp: false,
      exitCode: result.status,
      stderr: trimOutput(result.stderr),
      stdout: trimOutput(result.stdout),
      recommendations: ["Replay command failed or did not produce JSON output."]
    };
  }

  return summarizeReplay(relativeFile, parsed);
}

function parseReplayOutput(stdout) {
  if (!stdout?.trim()) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function summarizeReplay(file, report) {
  const acceptance = report.acceptance || {};
  const checks = acceptance.checks || {};
  const liveGate = summarizeLiveGate(report.liveOverlay?.mvpGate);
  const page = report.captureMetadata?.page || null;
  const livePreflight = summarizeLiveRealPagePreflight(report.captureMetadata?.liveRealPagePreflight || null);
  const liveSafety = summarizeLiveSafetySettings(report.captureMetadata?.liveSafetySettings || null);
  const realPage = summarizeRealPageReadiness({
    readyForRealPageMvp: Boolean(acceptance.readyForRealPageMvp),
    page,
    liveOverlayAvailable: Boolean(report.liveOverlay?.available),
    liveStateSnapshotMatches: report.acceptance?.checks?.liveStateSnapshotMatches ?? null,
    livePreflight,
    liveSafety
  });
  return {
    file,
    ok: true,
    readyForRealPageMvp: Boolean(acceptance.readyForRealPageMvp),
    realPageReady: realPage.ready,
    realPageMissing: realPage.missing,
    mahjongSoulPage: realPage.mahjongSoulPage,
    missing: acceptance.missing || [],
    page,
    checksPassed: Object.values(checks).filter(Boolean).length,
    checksTotal: Object.keys(checks).length,
    rawMessages: report.diagnostics?.rawMessages ?? null,
    inboundRawMessages: report.diagnostics?.inboundRawMessages ?? null,
    parsedEvents: report.replaySummary?.parsedEvents ?? null,
    eventTypes: report.eventTypes || [],
    liveStateSnapshotMatches: report.acceptance?.checks?.liveStateSnapshotMatches ?? null,
    liveSnapshotAvailable: report.acceptance?.checks?.liveStateSnapshotMatches !== undefined,
    liveOverlayAvailable: Boolean(report.liveOverlay?.available),
    liveRealPagePreflightReady: livePreflight.ready,
    liveRealPagePreflightMissing: livePreflight.missing,
    liveRealPagePreflightHints: report.captureMetadata?.liveRealPagePreflight?.hints ?? null,
    liveSafetyReady: liveSafety.ready,
    liveSafetyMissing: liveSafety.missing,
    liveSafetySettings: report.captureMetadata?.liveSafetySettings ?? null,
    liveOverlayGateReady: liveGate.available ? liveGate.ready : null,
    liveOverlayGatePassed: liveGate.available ? liveGate.passed : null,
    liveOverlayGateTotal: liveGate.available ? liveGate.total : null,
    captureIntegrityReady: report.captureIntegrity?.readyForRealPageExport ?? null,
    captureIntegrityMissing: report.captureIntegrity?.requiredMissing ?? null,
    captureIntegrityRecommendedMissing: report.captureIntegrity?.recommendedMissing ?? null,
    recommendations: report.recommendations || []
  };
}

function summarizeRealPageReadiness({ readyForRealPageMvp, page, liveOverlayAvailable, liveStateSnapshotMatches, livePreflight, liveSafety }) {
  const missing = [];
  const mahjongSoulPage = isMahjongSoulPage(page);
  if (!readyForRealPageMvp) missing.push("acceptance.readyForRealPageMvp is not true");
  if (!mahjongSoulPage) missing.push("captureMetadata.page is not a Mahjong Soul web page");
  if (!liveOverlayAvailable) missing.push("overlay live debug/gate snapshot is missing");
  if (livePreflight?.ready !== true) missing.push(...(livePreflight?.missing?.length ? livePreflight.missing : ["liveRealPagePreflight checks are not ready"]));
  if (liveSafety?.ready !== true) missing.push(...(liveSafety?.missing?.length ? liveSafety.missing : ["liveSafetySettings safety checks are not ready"]));
  if (liveStateSnapshotMatches !== true) missing.push("liveStateSnapshotMatches is not true");
  return {
    ready: missing.length === 0,
    missing,
    mahjongSoulPage
  };
}

function summarizeLiveGate(gate) {
  if (!gate) {
    return {
      available: false,
      ready: false,
      passed: 0,
      total: 0
    };
  }
  const checks = gate.checks || {};
  const total = Number.isFinite(Number(gate.total)) ? Number(gate.total) : Object.keys(checks).length;
  const passed = Number.isFinite(Number(gate.passed))
    ? Number(gate.passed)
    : Object.values(checks).filter(Boolean).length;
  return {
    available: true,
    ready: total > 0 && passed === total,
    passed,
    total
  };
}

function trimOutput(value) {
  const text = String(value || "").trim();
  return text.length > 1000 ? `${text.slice(0, 1000)}...` : text;
}

function formatSummary(report) {
  const lines = [
    `Capture validation: capturesFound=${report.capturesFound} ready=${report.readyCaptures} realPageReady=${report.realPageReadyCaptures} failures=${report.replayFailures}`,
    `Directory: ${report.directory}`
  ];

  const gates = [
    report.strict ? "strict" : null,
    report.requireReady ? "require-ready" : null,
    report.requireRealPageReady ? "require-real-page-ready" : null
  ].filter(Boolean);
  if (gates.length > 0) {
    lines.push(`Active gates: ${gates.join(", ")}`);
  }

  if (report.results.length === 0) {
    lines.push("", "No capture JSON files were found.");
    lines.push("Next: npm run import-capture -- path/to/majsoul-helper-capture.json");
  } else {
    lines.push("", "Captures:");
    for (const result of report.results) {
      lines.push(`- ${result.file}`);
      if (!result.ok) {
        lines.push(`  replay: failed${result.exitCode === undefined ? "" : ` (exit ${result.exitCode})`}`);
        lines.push(`  real-page: not ready`);
        lines.push(`  missing: ${joinLimited(result.recommendations)}`);
        continue;
      }

      lines.push(
        `  replay: ${result.readyForRealPageMvp ? "ready" : "not ready"} (${formatCount(result.checksPassed)}/${formatCount(result.checksTotal)} checks, raw/inbound/parsed: ${formatCount(result.rawMessages)}/${formatCount(result.inboundRawMessages)}/${formatCount(result.parsedEvents)})`
      );
      lines.push(`  real-page: ${result.realPageReady ? "ready" : "not ready"}${result.mahjongSoulPage ? " (Mahjong Soul page)" : ""}`);
      if (result.realPageMissing?.length > 0) {
        lines.push(`  missing: ${joinLimited(result.realPageMissing)}`);
      }
      if (result.missing?.length > 0) {
        lines.push(`  acceptance: ${joinLimited(result.missing)}`);
      }
      if (result.liveRealPagePreflightMissing?.length > 0) {
        lines.push(`  preflight: ${joinLimited(result.liveRealPagePreflightMissing)}`);
      }
      if (result.liveSafetyMissing?.length > 0) {
        lines.push(`  safety: ${joinLimited(result.liveSafetyMissing)}`);
      }
      if (result.captureIntegrityMissing?.length > 0) {
        lines.push(`  capture export: ${joinLimited(result.captureIntegrityMissing)}`);
      }
      if (result.recommendations?.length > 0) {
        lines.push(`  next: ${result.recommendations[0]}`);
      }
    }
  }

  lines.push("", "Recommendations:");
  for (const recommendation of report.recommendations) {
    lines.push(`- ${recommendation}`);
  }

  return lines.join("\n");
}

function formatCount(value) {
  return value === null || value === undefined ? "?" : String(value);
}

function joinLimited(values, limit = 4) {
  const list = (values || []).filter(Boolean).map(String);
  if (list.length === 0) return "none";
  const shown = list.slice(0, limit);
  const suffix = list.length > limit ? `; +${list.length - limit} more` : "";
  return `${shown.join("; ")}${suffix}`;
}

function buildRecommendations({ captureCount, readyCaptures, realPageReadyCaptures, replayFailures, strict, requireReady, requireRealPageReady }) {
  if (captureCount === 0) {
    return [
      "No capture JSON files were found. Export a real-page capture from the overlay, then run npm run import-capture -- path/to/majsoul-helper-capture.json before claiming real-page MVP readiness."
    ];
  }
  if (replayFailures > 0) {
    return [
      `${replayFailures} capture file${replayFailures === 1 ? "" : "s"} failed replay. Fix invalid JSON or replay errors before using the batch result.`
    ];
  }
  if (readyCaptures === 0) {
    return [
      requireReady || strict
        ? "No capture satisfies acceptance.readyForRealPageMvp; this run should fail the real-page readiness gate. Run npm run real-page-gate after collecting a stronger capture."
        : "No capture satisfies acceptance.readyForRealPageMvp yet. Inspect each result's missing checks and recommendations."
    ];
  }
  if (realPageReadyCaptures === 0) {
    return [
      requireRealPageReady
        ? "No capture satisfies realPageReady. Export from Mahjong Soul with the full current versioned overlay preflight complete, safe liveSafetySettings, live snapshots, and liveStateSnapshotMatches=true, then run npm run real-page-gate before claiming real-page MVP readiness."
        : "Replay-ready captures exist, but none are realPageReady yet. Real-page proof requires Mahjong Soul page metadata, the full current versioned overlay preflight, safe liveSafetySettings, overlay live snapshots, liveStateSnapshotMatches=true, and acceptance.readyForRealPageMvp=true. Run npm run real-page-gate for final acceptance after collecting a real-page sample."
    ];
  }
  if (readyCaptures < captureCount) {
    return [
      `${readyCaptures} of ${captureCount} capture files satisfy acceptance.readyForRealPageMvp. Inspect non-ready results before treating parser coverage as complete.`
    ];
  }
  if (realPageReadyCaptures < captureCount) {
    return [
      `${realPageReadyCaptures} of ${captureCount} capture files are realPageReady. Non-real-page-ready captures may still be useful fixtures or parser samples.`
    ];
  }
  return ["All checked captures satisfy realPageReady."];
}
