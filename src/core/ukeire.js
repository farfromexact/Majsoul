import { allTileTypes, indexToTile, tileToIndex, tilesToCounts } from "./tile.js";
import { calculateShanten } from "./shanten.js";

export function countVisibleTiles(tiles = []) {
  return tilesToCounts(tiles);
}

export function findKnownTileLimitViolations(tiles = []) {
  return tilesToCounts(tiles)
    .map((count, index) => ({ tile: indexToTile(index), count }))
    .filter((entry) => entry.count > 4);
}

export function assertKnownTileLimit(tiles = []) {
  const violations = findKnownTileLimitViolations(tiles);
  if (violations.length) {
    throw new Error(`Known tile count exceeds four: ${violations.map((entry) => `${entry.tile} x${entry.count}`).join(", ")}`);
  }
}

export function calculateUkeire(handTiles, visibleTiles = [], { openMelds = 0 } = {}) {
  assertKnownTileLimit([...(handTiles || []), ...(visibleTiles || [])]);
  const handCounts = tilesToCounts(handTiles);
  const visibleCounts = countVisibleTiles(visibleTiles);
  const baseShanten = calculateShanten(handCounts, { openMelds });
  const ukeireTiles = [];
  const ukeireBreakdown = [];
  let ukeireCount = 0;

  for (const tile of allTileTypes()) {
    const index = tileToIndex(tile);
    const remaining = Math.max(0, 4 - handCounts[index] - visibleCounts[index]);
    if (remaining === 0) continue;

    const nextCounts = handCounts.slice();
    nextCounts[index] += 1;
    if (calculateShanten(nextCounts, { openMelds }) < baseShanten) {
      const tile = indexToTile(index);
      ukeireTiles.push(tile);
      ukeireBreakdown.push({ tile, remaining });
      ukeireCount += remaining;
    }
  }

  return {
    shanten: baseShanten,
    ukeireTiles,
    ukeireBreakdown,
    ukeireCount,
    ukeireTypes: ukeireTiles.length
  };
}
