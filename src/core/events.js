export const STANDARD_GAME_EVENT_TYPES = new Set([
  "round_start",
  "deal_hand",
  "draw_tile",
  "discard_tile",
  "call_meld",
  "riichi",
  "dora",
  "round_end"
]);

export function isStandardGameEvent(type) {
  return STANDARD_GAME_EVENT_TYPES.has(type);
}
