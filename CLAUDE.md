# DarkHarold2 — Claude Project Instructions

## Tech Stack
- Engine/logic: TypeScript, compiled with tsc
- Rendering: WebGL 2.0 (no canvas 2D fallback)
- Audio: Web Audio API (ACM source files)
- Asset pipeline: Python 3.9+ / Pipenv
- Package management: npm (TS), Pipenv (Python)
- No native dependencies — browser-safe only

## Ground-Truth References
All game logic, formulas, and data structures must be anchored to:
- fallout2-ce (https://github.com/alexbatalov/fallout2-ce) — authoritative C++ CE. Cite the specific .cc/.h file and function name in every implementation.
- jsFO (https://github.com/ajxs/jsFO) — JS/browser patterns reference (secondary)

## File Access Policy
- ALWAYS pull from the remote branch before reading any file
- If a file is not found after pulling, STOP and ask — do NOT create it from scratch
- Never fabricate reference files (pal.py, frmpixels.py, example_scripts/, etc.)

## Key Files
- src/scripting.ts — script opcode implementations (the main scripting API)
- src/player.ts — Player class and stat initialization
- src/gametime.ts — in-game time and tick event system
- src/combat.ts — combat loop
- src/critter.ts — critter damage/kill helpers
- src/object.ts — Obj / Critter base types

## Conventions
- All new scripting opcodes go in src/scripting.ts inside the Script class
- Use the existing `stub()` helper for unimplemented opcodes, not silent no-ops
- Use `info()` / `warn()` / `dbg()` for logging — never raw console.log in new code
- TimedEvent pattern (timeEventList in scripting.ts) is the hook for all tick loops
- Do not add addiction, drug, or NPC schedule logic unless the task explicitly asks for it

## Constraints
- WebGL 2.0 only — no Three.js, no canvas 2D, no native deps
- Browser-safe: no Node.js-only APIs in src/
- Do not modify the asset pipeline (Python) unless the task is explicitly about assets
