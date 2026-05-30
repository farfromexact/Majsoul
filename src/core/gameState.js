import { indexToTile, normalizeTile, tileToIndex, tilesToCounts } from "./tile.js";
import { isStandardGameEvent } from "./events.js";

const INITIAL_STATE = {
  hand: [],
  drawnTile: null,
  melds: [[], [], [], []],
  discards: [[], [], [], []],
  doraIndicators: [],
  round: null,
  chang: null,
  ju: null,
  honba: 0,
  riichiSticks: 0,
  seatWind: null,
  roundWind: null,
  currentTurn: null,
  leftTileCount: null,
  lastStep: null,
  roundEndReason: null,
  riichi: [false, false, false, false],
  scores: [25000, 25000, 25000, 25000],
  scoresKnown: false,
  invalidTiles: [],
  events: []
};

export class GameState {
  constructor() {
    this.state = structuredClone(INITIAL_STATE);
  }

  reset(partial = {}) {
    this.state = { ...structuredClone(INITIAL_STATE), ...partial };
  }

  clearEvents() {
    this.state.events = [];
  }

  applyEvent(event) {
    if (!event || !event.type) return;
    if (!isStandardGameEvent(event.type)) return;
    if (event.type !== "raw_message") {
      this.state.events = [event, ...this.state.events].slice(0, 100);
    }

    const payload = event.payload || {};
    if (payload.binaryEnvelope?.step !== undefined) {
      this.state.lastStep = payload.binaryEnvelope.step;
    }
    switch (event.type) {
      case "round_start": {
        const nextStateDiagnostics = { invalidTiles: [] };
        this.reset({
          round: payload.round ?? null,
          chang: normalizeRoundIndex(payload.chang),
          ju: normalizeRoundIndex(payload.ju),
          honba: payload.honba ?? 0,
          riichiSticks: payload.riichiSticks ?? 0,
          roundWind: payload.roundWind ?? roundWindFromChang(payload.chang) ?? null,
          seatWind: payload.seatWind ?? seatWindFromJu(payload.ju) ?? null,
          scores: payload.scores ?? [25000, 25000, 25000, 25000],
          scoresKnown: Array.isArray(payload.scores) && payload.scores.length > 0,
          hand: sanitizeTiles(payload.tiles ?? [], nextStateDiagnostics, "round_start.tiles"),
          melds: sanitizeSeatMelds(payload.melds, nextStateDiagnostics, "round_start.melds"),
          discards: sanitizeSeatTiles(payload.discards, nextStateDiagnostics, "round_start.discards"),
          doraIndicators: sanitizeTiles(payload.doraIndicators ?? [], nextStateDiagnostics, "round_start.doraIndicators"),
          currentTurn: normalizeSeat(payload.currentTurn) ?? null,
          leftTileCount: payload.leftTileCount ?? null,
          riichi: normalizeRiichi(payload.riichi),
          invalidTiles: nextStateDiagnostics.invalidTiles,
          events: this.state.events
        });
        break;
      }
      case "deal_hand":
        this.state.hand = sanitizeTiles(payload.tiles || [], this.state, "deal_hand.tiles");
        this.state.drawnTile = null;
        break;
      case "draw_tile": {
        if (!payload.tile) break;
        const tile = sanitizeTile(payload.tile, this.state, "draw_tile.tile");
        if (!tile) break;
        if (normalizeSeat(payload.seat) === undefined) {
          mergeDoraIndicatorList(this.state, payload.doraIndicators);
          this.state.leftTileCount = payload.leftTileCount ?? this.state.leftTileCount;
          break;
        }
        if (normalizeSeat(payload.seat) === 0) this.state.drawnTile = tile;
        this.state.currentTurn = normalizeSeat(payload.seat);
        this.state.leftTileCount = payload.leftTileCount ?? this.state.leftTileCount;
        mergeDoraIndicatorList(this.state, payload.doraIndicators);
        break;
      }
      case "discard_tile": {
        if (!payload.tile) break;
        const tile = sanitizeTile(payload.tile, this.state, "discard_tile.tile");
        if (!tile) break;
        if (normalizeSeat(payload.seat) === undefined) {
          mergeDoraIndicatorList(this.state, payload.doraIndicators);
          break;
        }
        this.state.discards[normalizeSeat(payload.seat)].push(tile);
        this.state.currentTurn = null;
        if (payload.isRiichi) {
          this.state.riichi[normalizeSeat(payload.seat)] = true;
        }
        mergeDoraIndicatorList(this.state, payload.doraIndicators);
        if (normalizeSeat(payload.seat) === 0) {
          if (this.state.drawnTile && tileToIndex(this.state.drawnTile) === tileToIndex(tile)) {
            this.state.drawnTile = null;
          } else {
            const drawnTile = this.state.drawnTile;
            const discardIndex = tileToIndex(tile);
            let removed = false;
            this.state.hand = this.state.hand.filter((tile) => {
              if (!removed && tileToIndex(tile) === discardIndex) {
                removed = true;
                return false;
              }
              return true;
            });
            if (drawnTile) {
              this.state.hand.push(drawnTile);
              this.state.drawnTile = null;
            }
          }
        }
        break;
      }
      case "call_meld": {
        if (normalizeSeat(payload.seat) === undefined) break;
        const callerSeat = normalizeSeat(payload.seat);
        const actionName = payload.binaryEnvelope?.actionName;
        const isBaBei = isBaBeiAction(actionName, payload.type);
        const normalizedMeld = normalizeMeld(isBaBei && !payload.meld ? ["4z"] : payload.meld, this.state);
        const meld = isAnGangAddGangAction(actionName)
          ? normalizeKanMeld(normalizedMeld, payload.type)
          : normalizedMeld;
        mergeDoraIndicatorList(this.state, payload.doraIndicators);
        this.state.currentTurn = callerSeat;
        if (!meld.length) break;
        const upgradedAddedKan = isAnGangAddGangAction(actionName)
          && upgradeAddedKanMeld(this.state, callerSeat, meld, payload.type);
        if (!upgradedAddedKan) {
          this.state.melds[callerSeat].push(meld);
        }
        if (isChiPengGangAction(actionName)) {
          const claimedTile = removeClaimedDiscard(this.state, meld, callerSeat);
          if (callerSeat === 0) {
            removeOwnMeldTiles(this.state, meld, claimedTile);
          }
        }
        if (isAnGangAddGangAction(actionName) && callerSeat === 0) {
          removeOwnKnownTiles(this.state, meld);
        }
        if (isBaBei && callerSeat === 0) {
          removeOwnKnownTile(this.state, "4z");
        }
        break;
      }
      case "riichi":
        if (normalizeSeat(payload.seat) === undefined) break;
        applyRiichiSuccess(this.state, payload);
        break;
      case "dora":
        {
          const doraTiles = payload.tile ? [payload.tile] : payload.doraIndicators;
          if (!doraTiles?.length) break;
          appendDoraIndicators(this.state, doraTiles);
        }
        break;
      case "round_end":
        this.state.currentTurn = null;
        this.state.roundEndReason = payload.reason ?? payload.type ?? "ended";
        mergeDoraIndicatorList(this.state, payload.doraIndicators);
        if (payload.scores?.length) {
          this.state.scores = payload.scores;
          this.state.scoresKnown = true;
        }
        break;
      default:
        break;
    }
  }

  getVisibleState() {
    const visible = structuredClone(this.state);
    visible.visibleTiles = collectVisibleTiles(visible);
    visible.warnings = buildWarnings(visible);
    return visible;
  }
}

function applyRiichiSuccess(state, payload) {
  const seat = normalizeSeat(payload.seat);
  if (seat === undefined) return;
  state.riichi[seat] = true;
  if (payload.riichiSticks !== undefined) {
    state.riichiSticks = payload.riichiSticks;
  }
  if (payload.score !== undefined && Number.isFinite(Number(payload.score))) {
    state.scores[seat] = Number(payload.score);
    state.scoresKnown = true;
  }
}

function normalizeRoundIndex(value) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function roundWindFromChang(chang) {
  const winds = ["E", "S", "W", "N"];
  const index = normalizeRoundIndex(chang);
  return index === null ? null : winds[index] ?? null;
}

function seatWindFromJu(ju) {
  const winds = ["E", "S", "W", "N"];
  const dealerSeat = normalizeRoundIndex(ju);
  if (dealerSeat === null || dealerSeat > 3) return null;
  return winds[(4 - dealerSeat) % 4];
}

function normalizeSeat(seat) {
  if (seat === undefined || seat === null) return undefined;
  const value = Number(seat);
  return Number.isInteger(value) && value >= 0 && value <= 3 ? value : undefined;
}

function normalizeMeld(meld, state) {
  if (!meld) return [];
  return sanitizeTiles(Array.isArray(meld) ? meld : [meld], state, "call_meld.meld");
}

function isChiPengGangAction(actionName) {
  return actionName === "ActionChiPengGang" || actionName === "RecordChiPengGang";
}

function isAnGangAddGangAction(actionName) {
  return actionName === "ActionAnGangAddGang" || actionName === "RecordAnGangAddGang";
}

function isBaBeiAction(actionName, type) {
  return actionName === "ActionBaBei" || actionName === "RecordBaBei" || type === "babei";
}

function sanitizeSeatTiles(value, state, context) {
  const result = [[], [], [], []];
  for (let seat = 0; seat < result.length; seat += 1) {
    result[seat] = sanitizeTiles(value?.[seat] || [], state, `${context}.${seat}`);
  }
  return result;
}

function sanitizeSeatMelds(value, state, context) {
  const result = [[], [], [], []];
  for (let seat = 0; seat < result.length; seat += 1) {
    result[seat] = (value?.[seat] || []).map((meld, meldIndex) => (
      sanitizeTiles(Array.isArray(meld) ? meld : [meld], state, `${context}.${seat}.${meldIndex}`)
    )).filter((meld) => meld.length);
  }
  return result;
}

function normalizeRiichi(value) {
  const result = [false, false, false, false];
  for (let seat = 0; seat < result.length; seat += 1) {
    result[seat] = Boolean(value?.[seat]);
  }
  return result;
}

function normalizeKanMeld(meld, type) {
  if (!meld.length) return [];
  if (Number(type) === 3 && meld.length === 1) {
    return [meld[0], meld[0], meld[0], meld[0]];
  }
  return meld;
}

function upgradeAddedKanMeld(state, seat, meld, type) {
  if (Number(type) !== 2 || meld.length !== 1) return false;
  const targetIndex = tileToIndex(meld[0]);
  const existing = state.melds[seat].find((entry) => (
    entry.length >= 3
    && entry.length < 4
    && entry.every((tile) => tileToIndex(tile) === targetIndex)
  ));
  if (!existing) return false;
  existing.push(meld[0]);
  return true;
}

function collectVisibleTiles(state) {
  return [
    ...state.doraIndicators,
    ...state.discards.flat(),
    ...state.melds.flat(2)
  ].filter(Boolean);
}

function appendDoraIndicators(state, tiles = []) {
  for (const tile of sanitizeTiles(tiles || [], state, "doraIndicators")) {
    if (tile) {
      state.doraIndicators.push(tile);
    }
  }
}

function mergeDoraIndicatorList(state, tiles = []) {
  const sanitized = sanitizeTiles(tiles || [], state, "doraIndicators");
  if (!sanitized.length) return;
  const currentCounts = countTilesByName(state.doraIndicators);
  const incomingCounts = countTilesByName(sanitized);
  for (const tile of sanitized) {
    if ((incomingCounts[tile] || 0) > (currentCounts[tile] || 0)) {
      state.doraIndicators.push(tile);
      currentCounts[tile] = (currentCounts[tile] || 0) + 1;
    }
  }
}

function countTilesByName(tiles) {
  const counts = {};
  for (const tile of tiles || []) {
    counts[tile] = (counts[tile] || 0) + 1;
  }
  return counts;
}

function sanitizeTile(tile, state, context) {
  if (!tile) return null;
  try {
    return normalizeTile(tile);
  } catch {
    state.invalidTiles.push({ tile: String(tile), context });
    return null;
  }
}

function sanitizeTiles(tiles, state, context) {
  return (tiles || []).map((tile) => sanitizeTile(tile, state, context)).filter(Boolean);
}

function removeClaimedDiscard(state, meld, callerSeat) {
  const meldIndexes = new Set((meld || []).filter(Boolean).map(tileToIndex));
  for (let seat = 0; seat < state.discards.length; seat += 1) {
    if (seat === callerSeat) continue;
    const river = state.discards[seat];
    const lastTile = river[river.length - 1];
    if (lastTile && meldIndexes.has(tileToIndex(lastTile))) {
      river.pop();
      return lastTile;
    }
  }
  return null;
}

function removeOwnMeldTiles(state, meld, claimedTile) {
  const claimedIndex = claimedTile ? tileToIndex(claimedTile) : null;
  let skippedClaimed = false;
  const consumedIndexes = [];
  for (const tile of meld || []) {
    const index = tileToIndex(tile);
    if (!skippedClaimed && claimedIndex !== null && index === claimedIndex) {
      skippedClaimed = true;
      continue;
    }
    consumedIndexes.push(index);
  }

  for (const consumedIndex of consumedIndexes) {
    let removed = false;
    state.hand = state.hand.filter((tile) => {
      if (!removed && tileToIndex(tile) === consumedIndex) {
        removed = true;
        return false;
      }
      return true;
    });
  }
}

function removeOwnKnownTile(state, tile) {
  const targetIndex = tileToIndex(tile);
  if (state.drawnTile && tileToIndex(state.drawnTile) === targetIndex) {
    state.drawnTile = null;
    return;
  }

  let removed = false;
  state.hand = state.hand.filter((handTile) => {
    if (!removed && tileToIndex(handTile) === targetIndex) {
      removed = true;
      return false;
    }
    return true;
  });
}

function removeOwnKnownTiles(state, tiles = []) {
  for (const tile of tiles || []) {
    removeOwnKnownTile(state, tile);
  }
}

function buildWarnings(state) {
  const warnings = [];
  const handSize = state.hand.length + (state.drawnTile ? 1 : 0);
  if (handSize > 14) {
    warnings.push(`hand has ${handSize} tiles`);
  }
  if (state.drawnTile && !state.hand.length) {
    warnings.push("drawnTile exists without base hand");
  }
  for (const invalid of state.invalidTiles || []) {
    warnings.push(`ignored invalid tile ${invalid.tile} from ${invalid.context}`);
  }

  const knownTiles = [
    ...state.hand,
    state.drawnTile,
    ...state.visibleTiles
  ].filter(Boolean);
  const counts = tilesToCounts(knownTiles);
  counts.forEach((count, index) => {
    if (count > 4) {
      warnings.push(`${indexToTile(index)} appears ${count} times`);
    }
  });
  return warnings;
}
