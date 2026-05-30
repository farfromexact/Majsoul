import { tilesToCounts } from "./tile.js";

const TERMINAL_OR_HONOR = new Set([0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]);

function cloneCounts(counts) {
  return counts.slice();
}

function isSuitSequenceStart(index) {
  return index < 27 && index % 9 <= 6;
}

function standardShantenFromCounts(counts, { openMelds = 0 } = {}) {
  let best = 8;
  const completedMelds = normalizeOpenMelds(openMelds);

  function scanMelds(work, start, melds) {
    while (start < 34 && work[start] === 0) start += 1;
    if (start >= 34) {
      scanTaatsu(work, 0, melds, 0);
      return;
    }

    if (work[start] >= 3) {
      work[start] -= 3;
      scanMelds(work, start, melds + 1);
      work[start] += 3;
    }

    if (isSuitSequenceStart(start) && work[start + 1] > 0 && work[start + 2] > 0) {
      work[start] -= 1;
      work[start + 1] -= 1;
      work[start + 2] -= 1;
      scanMelds(work, start, melds + 1);
      work[start] += 1;
      work[start + 1] += 1;
      work[start + 2] += 1;
    }

    scanMelds(work, start + 1, melds);
  }

  function scanTaatsu(work, start, melds, taatsu) {
    while (start < 34 && work[start] === 0) start += 1;
    if (start >= 34) {
      const totalMelds = melds + completedMelds;
      const usableTaatsu = Math.min(taatsu, 4 - totalMelds);
      best = Math.min(best, 8 - totalMelds * 2 - usableTaatsu);
      return;
    }

    if (work[start] >= 2) {
      work[start] -= 2;
      scanTaatsu(work, start, melds, taatsu + 1);
      work[start] += 2;
    }

    if (isSuitSequenceStart(start) && work[start + 1] > 0) {
      work[start] -= 1;
      work[start + 1] -= 1;
      scanTaatsu(work, start, melds, taatsu + 1);
      work[start] += 1;
      work[start + 1] += 1;
    }

    if (start < 27 && start % 9 <= 6 && work[start + 2] > 0) {
      work[start] -= 1;
      work[start + 2] -= 1;
      scanTaatsu(work, start, melds, taatsu + 1);
      work[start] += 1;
      work[start + 2] += 1;
    }

    scanTaatsu(work, start + 1, melds, taatsu);
  }

  scanMelds(cloneCounts(counts), 0, 0);

  for (let i = 0; i < 34; i += 1) {
    if (counts[i] >= 2) {
      const work = cloneCounts(counts);
      work[i] -= 2;
      let pairBest = 8;
      const oldBest = best;
      best = 8;
      scanMelds(work, 0, 0);
      pairBest = best - 1;
      best = Math.min(oldBest, pairBest);
    }
  }

  return best;
}

function normalizeOpenMelds(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(4, Math.floor(number));
}

function chiitoiShantenFromCounts(counts) {
  let pairs = 0;
  let unique = 0;
  for (const count of counts) {
    if (count > 0) unique += 1;
    if (count >= 2) pairs += 1;
  }
  return 6 - pairs + Math.max(0, 7 - unique);
}

function kokushiShantenFromCounts(counts) {
  let unique = 0;
  let hasPair = false;
  for (const index of TERMINAL_OR_HONOR) {
    if (counts[index] > 0) unique += 1;
    if (counts[index] >= 2) hasPair = true;
  }
  return 13 - unique - (hasPair ? 1 : 0);
}

export function calculateShanten(tilesOrCounts, { openMelds = 0 } = {}) {
  const counts = Array.isArray(tilesOrCounts) && tilesOrCounts.length === 34 && tilesOrCounts.every(Number.isInteger)
    ? tilesOrCounts
    : tilesToCounts(tilesOrCounts);
  const melds = normalizeOpenMelds(openMelds);
  if (melds > 0) {
    return standardShantenFromCounts(counts, { openMelds: melds });
  }
  return Math.min(
    standardShantenFromCounts(counts, { openMelds: melds }),
    chiitoiShantenFromCounts(counts),
    kokushiShantenFromCounts(counts)
  );
}

export { standardShantenFromCounts, chiitoiShantenFromCounts, kokushiShantenFromCounts };
