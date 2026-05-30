const SUIT_OFFSETS = { m: 0, p: 9, s: 18, z: 27 };
const INDEX_SUITS = ["m", "p", "s", "z"];

export function normalizeTile(tile) {
  if (typeof tile !== "string") {
    throw new Error(`Tile must be a string: ${tile}`);
  }
  if (/^0[mps]$/.test(tile)) {
    return `5${tile[1]}`;
  }
  if (!/^[1-9][mps]$/.test(tile) && !/^[1-7]z$/.test(tile)) {
    throw new Error(`Invalid tile: ${tile}`);
  }
  return tile;
}

export function tileToIndex(tile) {
  const normalized = normalizeTile(tile);
  const value = Number(normalized[0]);
  const suit = normalized[1];
  return SUIT_OFFSETS[suit] + value - 1;
}

export function indexToTile(index) {
  if (!Number.isInteger(index) || index < 0 || index > 33) {
    throw new Error(`Invalid tile index: ${index}`);
  }
  if (index < 27) {
    const suit = INDEX_SUITS[Math.floor(index / 9)];
    return `${(index % 9) + 1}${suit}`;
  }
  return `${index - 26}z`;
}

export function tilesToCounts(tiles) {
  const counts = Array(34).fill(0);
  for (const tile of tiles) {
    counts[tileToIndex(tile)] += 1;
  }
  return counts;
}

export function countsToTiles(counts) {
  const tiles = [];
  counts.forEach((count, index) => {
    for (let i = 0; i < count; i += 1) {
      tiles.push(indexToTile(index));
    }
  });
  return tiles;
}

export function parseTiles(input) {
  if (typeof input !== "string") {
    throw new Error("Tile input must be a string");
  }
  const compactInput = input.trim().replace(/[\s,，、]+/g, "");
  const tiles = [];
  let digits = "";
  for (const char of compactInput) {
    if (/\d/.test(char)) {
      digits += char;
      continue;
    }
    if (!["m", "p", "s", "z"].includes(char)) {
      throw new Error(`Invalid suit: ${char}`);
    }
    if (!digits) {
      throw new Error(`Missing tile number before ${char}`);
    }
    for (const digit of digits) {
      if (digit === "0" && !["m", "p", "s"].includes(char)) {
        throw new Error("Red five is only valid for m/p/s");
      }
      tiles.push(normalizeTile(`${digit}${char}`));
    }
    digits = "";
  }
  if (digits) {
    throw new Error("Dangling tile number without suit");
  }
  return tiles;
}

export function sortTiles(tiles) {
  return [...tiles].sort((a, b) => tileToIndex(a) - tileToIndex(b));
}

export function allTileTypes() {
  return Array.from({ length: 34 }, (_, index) => indexToTile(index));
}

export function doraFromIndicator(indicator) {
  const normalized = normalizeTile(indicator);
  const value = Number(normalized[0]);
  const suit = normalized[1];
  if (suit === "z") {
    if (value <= 4) return `${value === 4 ? 1 : value + 1}z`;
    return `${value === 7 ? 5 : value + 1}z`;
  }
  return `${value === 9 ? 1 : value + 1}${suit}`;
}
