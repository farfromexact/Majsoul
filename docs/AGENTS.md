# AGENTS.md

## Project

Majsoul Helper is a Tampermonkey userscript for the Mahjong Soul web client. It captures visible game information, maintains a normalized `gameState`, and renders a draggable training/debug overlay with hand, table state, shanten, ukeire, and discard-candidate analysis.

The project is explicitly for learning, review, and friendly-room practice. It must not automate play or bypass platform protections.

## Tech Stack

- Runtime: browser userscript, Tampermonkey, document-start injection.
- Language: JavaScript ES modules.
- Test runner: Vitest.
- DOM tests: jsdom.
- Build: `scripts/build-userscript.mjs` generates `majsoul-helper.user.js`.
- Main target: `https://game.maj-soul.com/1/`, currently Unity WebGL.

## Key Commands

- `npm test` - run unit tests.
- `npm run build` - regenerate `majsoul-helper.user.js`.
- `npm run smoke` - run smoke checks.
- `npm run mvp-check` - check MVP artifacts and safety boundaries.
- `npm run audit` - run goal completion audit.
- `npm run verify` - full local verification suite.
- `npm run replay -- <capture.json>` - replay one capture.
- `npm run validate-captures -- --summary` - batch-validate local captures.

## Development Principles

- Keep capture, parsing, state, analysis, and UI separated.
- Prefer conservative decoding over guessing live-game semantics.
- Treat raw capture data as evidence, not as proof of state correctness.
- Realtime advice must remain opt-in and clearly marked as risky/training-only.
- Preserve the no-interference model: observe and render only.
- Favor small patches with focused tests over broad rewrites.

## Code Conventions

- Edit source under `src/`; `majsoul-helper.user.js` is generated.
- Keep modules ESM-compatible.
- Use tile notation consistently: `1m-9m`, `1p-9p`, `1s-9s`, `1z-7z`, red fives as `0m/0p/0s`.
- Normalize red fives for analysis but preserve display where needed.
- Use standardized events from `src/core/events.js` at module boundaries.
- Keep comments short and only where they explain non-obvious capture/decoder behavior.

## File Modification Rules

- Do not commit local real captures from `captures/`.
- Do not hand-edit generated userscript output except for emergency diagnosis.
- If changing versioned behavior, update version references consistently:
  - `package.json`
  - `package-lock.json`
  - `src/main.js`
  - generated `majsoul-helper.user.js`
  - docs/tests that assert version behavior
- If changing parser output, update `GameState`, replay diagnostics, and tests together.
- If changing overlay controls, test jsdom UI behavior and real Tampermonkey install behavior when possible.

## Testing Principles

- Add or update tests for every decoder, state transition, and analyzer rule change.
- Use fixture captures only when sanitized and intentionally committed.
- For real-page progress, require capture evidence with:
  - current helper version
  - page URL metadata
  - safe settings
  - runtime/preflight diagnostics
  - replayed state matching live snapshot
- Do not treat screenshots alone as proof of decoded state.
- Run `npm run verify` before release or handoff.

## Git Conventions

- Use concise imperative commit messages, for example `Decode Unity deal payloads`.
- Commit source, tests, docs, and generated userscript together when behavior changes.
- Keep capture data, browser dumps, and temporary diagnostics out of git unless explicitly sanitized.
- Do not mix unrelated refactors with decoder or UI fixes.

## Prohibited

- No automatic discard, call, riichi, or win actions.
- No simulated clicks, keyboard events, pointer events, or UI automation against the game.
- No mutation of outbound game messages.
- No hidden execution, stealth behavior, anti-detection, or anti-cheat bypass.
- No attempts to gain unavailable private information.
- No advice enabled by default during realtime play.
- No broad decoder guesses that fabricate missing hand, dora, score, or meld state.
