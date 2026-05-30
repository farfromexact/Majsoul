import { calculateShanten } from "./shanten.js";
import { assertKnownTileLimit, calculateUkeire } from "./ukeire.js";
import { indexToTile, sortTiles, tileToIndex, tilesToCounts } from "./tile.js";

function removeOneTile(tiles, discard) {
  const discardIndex = tileToIndex(discard);
  const result = [];
  let removed = false;
  for (const tile of tiles) {
    if (!removed && tileToIndex(tile) === discardIndex) {
      removed = true;
      continue;
    }
    result.push(tile);
  }
  return result;
}

export function analyzeHand({ hand = [], drawnTile = null, visibleTiles = [], openMelds = 0 } = {}) {
  const combined = sortTiles(drawnTile ? [...hand, drawnTile] : hand);
  assertKnownTileLimit([...combined, ...(visibleTiles || [])]);
  const shanten = calculateShanten(combined, { openMelds });
  const canDiscard = combined.length % 3 === 2;
  if (!canDiscard) {
    return { hand: combined, openMelds, shanten, canDiscard, candidates: [] };
  }
  const counts = tilesToCounts(combined);
  const candidates = [];

  for (let index = 0; index < 34; index += 1) {
    if (counts[index] === 0) continue;
    const discard = indexToTile(index);
    const afterDiscard = removeOneTile(combined, discard);
    const discardVisible = [...visibleTiles, discard];
    const ukeire = calculateUkeire(afterDiscard, discardVisible, { openMelds });
    candidates.push({
      discard,
      shantenAfterDiscard: ukeire.shanten,
      ukeireTiles: ukeire.ukeireTiles,
      ukeireBreakdown: ukeire.ukeireBreakdown,
      ukeireCount: ukeire.ukeireCount,
      ukeireTypes: ukeire.ukeireTypes
    });
  }

  candidates.sort((a, b) => (
    a.shantenAfterDiscard - b.shantenAfterDiscard
    || b.ukeireCount - a.ukeireCount
    || b.ukeireTypes - a.ukeireTypes
    || tileToIndex(a.discard) - tileToIndex(b.discard)
  ));

  return { hand: combined, openMelds, shanten, canDiscard, candidates };
}
