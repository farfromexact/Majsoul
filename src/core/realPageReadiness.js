export const CAPTURE_VERIFICATION = Object.freeze({
  recommendedPath: "captures/capture-real.json",
  commands: Object.freeze({
    doctor: "npm run capture-doctor -- captures/capture-real.json",
    replay: "npm run replay -- captures/capture-real.json",
    realPageGate: "npm run real-page-gate"
  }),
  realPageReadyRequires: Object.freeze([
    "Mahjong Soul page metadata",
    "overlay live snapshots",
    "liveRealPagePreflight.readyToExport=true",
    "safe liveSafetySettings",
    "acceptance.readyForRealPageMvp=true",
    "liveStateSnapshotMatches=true"
  ])
});

export const REAL_PAGE_PREFLIGHT_HINTS = Object.freeze({
  mahjongSoulPage: "Open Mahjong Soul web before exporting.",
  hookInstalled: "Reload the page after installing or updating the userscript.",
  captureRunning: "Click Resume before collecting live traffic.",
  liveSnapshotsIncluded: "Use Copy capture or Download capture from this overlay.",
  liveMvpGateReady: "Collect from round start until the MVP gate is complete.",
  eventBufferComplete: "Increase Capture limit, clear debug, and collect again from round start before exporting.",
  noTruncatedSamples: "Increase Binary sample bytes and collect a fresh sample before exporting.",
  noCaptureErrors: "Reload the page and collect again after capture errors stop appearing.",
  liveSafetySettingsIncluded: "Use the current overlay export so safety settings are included.",
  realtimeAdviceOff: "Turn realtime advice off before exporting an acceptance sample.",
  realtimeAdviceDefaultOff: "Reload the helper if realtime advice is no longer default-off.",
  manualInputInactive: "Clear Manual Input before exporting an acceptance sample.",
  automationDisabled: "Reload the helper if the no-automation boundary is not recorded.",
  clickAutomationDisabled: "Reload the helper if click automation is not recorded as disabled.",
  messageMutationDisabled: "Reload the helper if message mutation is not recorded as disabled."
});

export const REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS = Object.freeze(Object.keys(REAL_PAGE_PREFLIGHT_HINTS));
export const REAL_PAGE_PREFLIGHT_VERSION = 1;

export function isMahjongSoulPage(page) {
  const host = String(page?.host || "");
  const origin = String(page?.origin || "");
  const url = String(page?.sanitizedUrl || "");
  return /mahjongsoul|maj-soul/i.test(`${host} ${origin} ${url}`);
}

export function buildLiveRealPagePreflight({ adapter, page, installDiagnostics, liveMvpGate, liveGameState, liveDebugSummary, liveSafetySettings }) {
  const droppedBeforeRetained = Number(installDiagnostics?.eventBuffer?.droppedBeforeRetained || 0);
  const checks = {
    mahjongSoulPage: isMahjongSoulPage(page),
    hookInstalled: Boolean(installDiagnostics?.installed ?? adapter?.installed),
    captureRunning: !(installDiagnostics?.paused || adapter?.paused),
    liveSnapshotsIncluded: Boolean(liveGameState && liveDebugSummary && liveMvpGate),
    liveMvpGateReady: liveMvpGate?.passed === liveMvpGate?.total,
    eventBufferComplete: droppedBeforeRetained === 0,
    noTruncatedSamples: Number(liveDebugSummary?.truncated || 0) === 0,
    noCaptureErrors: Number(liveDebugSummary?.captureErrors || 0) === 0,
    liveSafetySettingsIncluded: Boolean(liveSafetySettings && typeof liveSafetySettings === "object"),
    realtimeAdviceOff: liveSafetySettings?.realtimeAdviceEnabled === false,
    realtimeAdviceDefaultOff: liveSafetySettings?.realtimeAdviceDefault === false,
    manualInputInactive: liveSafetySettings?.manualInputActive === false,
    automationDisabled: liveSafetySettings?.automationDisabled === true,
    clickAutomationDisabled: liveSafetySettings?.clickAutomationDisabled === true,
    messageMutationDisabled: liveSafetySettings?.messageMutationDisabled === true
  };
  const entries = Object.entries(checks);
  const missing = entries.filter(([, value]) => !value).map(([key]) => key);
  const hints = missing.map((key) => REAL_PAGE_PREFLIGHT_HINTS[key]).filter(Boolean);
  return {
    preflightVersion: REAL_PAGE_PREFLIGHT_VERSION,
    requiredChecks: [...REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS],
    checks,
    passed: entries.filter(([, value]) => value).length,
    total: entries.length,
    missing,
    hints,
    readyToExport: missing.length === 0,
    offlineValidationRequired: true,
    doctorCommand: CAPTURE_VERIFICATION.commands.doctor,
    offlineCommand: CAPTURE_VERIFICATION.commands.realPageGate
  };
}

export function summarizeLiveRealPagePreflight(preflight) {
  const missing = [];
  if (!preflight || typeof preflight !== "object") {
    missing.push("liveRealPagePreflight snapshot is missing");
    missing.push("liveRealPagePreflight.readyToExport is not true");
    return {
      ready: false,
      missing
    };
  }

  if (preflight.readyToExport !== true) {
    missing.push("liveRealPagePreflight.readyToExport is not true");
  }
  if (preflight.preflightVersion !== REAL_PAGE_PREFLIGHT_VERSION) {
    missing.push(`liveRealPagePreflight.preflightVersion is not ${REAL_PAGE_PREFLIGHT_VERSION}`);
  }

  const requiredChecks = Array.isArray(preflight.requiredChecks) ? preflight.requiredChecks : [];
  for (const key of REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS) {
    if (!requiredChecks.includes(key)) {
      missing.push(`liveRealPagePreflight.requiredChecks is missing ${key}`);
    }
  }
  const checks = preflight.checks || {};
  for (const key of REQUIRED_REAL_PAGE_PREFLIGHT_CHECKS) {
    if (checks[key] !== true) {
      missing.push(`liveRealPagePreflight.checks.${key} is not true`);
    }
  }

  return {
    ready: missing.length === 0,
    missing
  };
}

export function summarizeLiveSafetySettings(settings) {
  if (!settings || typeof settings !== "object") {
    return {
      ready: false,
      missing: ["liveSafetySettings snapshot is missing"]
    };
  }
  const missing = [];
  if (settings.realtimeAdviceEnabled !== false) missing.push("liveSafetySettings.realtimeAdviceEnabled is not false");
  if (settings.realtimeAdviceDefault !== false) missing.push("liveSafetySettings.realtimeAdviceDefault is not false");
  if (settings.manualInputActive !== false) missing.push("liveSafetySettings.manualInputActive is not false");
  if (settings.capturePaused !== false) missing.push("liveSafetySettings.capturePaused is not false");
  if (settings.automationDisabled !== true) missing.push("liveSafetySettings.automationDisabled is not true");
  if (settings.clickAutomationDisabled !== true) missing.push("liveSafetySettings.clickAutomationDisabled is not true");
  if (settings.messageMutationDisabled !== true) missing.push("liveSafetySettings.messageMutationDisabled is not true");
  return {
    ready: missing.length === 0,
    missing
  };
}
