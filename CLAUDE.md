# DarkHarold2 — Claude Project Instructions

DarkHarold2 is a semi-faithful browser recreation of Fallout 2, forked from the DarkFO project (Apache 2.0 license). Goal: faithful F2 gameplay with only minor tweaks — do not invent features, follow the originals.

## Tech Stack
- Engine/logic: TypeScript (strict mode: noImplicitAny, noImplicitReturns), compiled with `npx tsc` → `js/`
- Rendering: WebGL 2.0 (no canvas 2D fallback)
- Audio: Web Audio API (ACM source files, converted to WAV by pipeline)
- Asset pipeline: Python 3.9+ / Pipenv (`setup.py` orchestrates full extraction)
- Package management: npm (TS devDeps only — no runtime npm modules), Pipenv (Python)
- No native dependencies — browser-safe only

## Build Commands
- `npx tsc` — compile TypeScript (output to js/)
- `pipenv run python setup.py /path/to/Fallout2/` — full asset extraction pipeline
- No test runner — manual testing in browser only

## Ground-Truth References
All game logic, formulas, and data structures must be anchored to:
- fallout2-ce (https://github.com/alexbatalov/fallout2-ce) — authoritative C++ source. Cite the specific .cc/.h file and function name in every implementation.
- jsFO (https://github.com/ajxs/jsFO) — JS/browser patterns reference (secondary)

## Wiki Layer
When researching any system before implementing or documenting:
1. Check `wiki/` first — these docs are pre-audited summaries of CE behaviour with DH2 gaps already identified. Trust them over raw source reads for formulas and system overviews.
2. Fall back to `raw/fallout2-ce/src/` only when the wiki is silent, too high-level, or you suspect a discrepancy.
3. If CE source and the wiki contradict each other, stop and flag the conflict rather than guessing.

Available wiki docs: `ai_behavior.md`, `animation_system.md`, `combat.md`, `critter_stats.md`, `damage_formula.md`, `dialogue_system.md`, `egg_system.md`, `file_formats.md`, `inventory_items.md`, `lighting.md`, `map_rendering.md`, `map_scripting.md`, `opcodes.md`, `perks_traits.md`, `save_load.md`, `skill_checks.md`, `sound_system.md`, `special_derived.md`, `worldmap.md`.

## File Access Policy
- ALWAYS pull from the remote branch before reading any file
- If a file is not found after pulling, STOP and ask — do NOT create it from scratch
- Never fabricate reference files (pal.py, frmpixels.py, example_scripts/, etc.)

## Key Files
- src/scripting.ts — Script class with all opcode intrinsic methods (~1700 lines)
- src/vm.ts — bytecode VM (opMap of 32+ raw bytecode handlers)
- src/vm_bridge.ts — wires bytecode opcodes to Script class methods (bridgeOpMap, ~150 entries)
- src/player.ts — Player class and stat initialization
- src/gametime.ts — in-game time constants, tick system, day/night cycle
- src/combat.ts — combat loop, AI, hit/damage calculation, critical effects
- src/critter.ts — critter damage/kill/heal helpers
- src/object.ts — Obj / Critter base types
- src/globalState.ts — central game state singleton (gMap, player, combatActive, etc.)
- src/config.ts — Config singleton with engine/UI/scripting/combat debug flags
- src/main.ts — main game loop, input handling, map loading entry point
- src/heart.ts — 60Hz heartbeat loop

## Scripting System Architecture
Three-file split — understand this before touching any opcode:
1. `src/vm.ts` — low-level bytecode decoder (`opMap`, raw stack ops)
2. `src/vm_bridge.ts` — maps bytecode op values to Script methods via `bridgeOpMap` and the `bridged(procName, argc)` factory
3. `src/scripting.ts` — `Script` class, one method per FO2 script intrinsic

To add a new opcode: implement the method on `Script` in scripting.ts, then wire it in vm_bridge.ts with `bridged("methodName", argCount)`. Never add raw stack logic in vm_bridge.ts.

Script variable scoping:
- GVARs — engine-wide, persisted in save
- LVARs — per-script instance, persisted in save
- MVARs — per-map, persisted with map

## Key Singletons
- `globalState` — exported from src/globalState.ts, also on `window`. Contains: `gMap`, `player`, `combatActive`, `knownAreas`, `eventLog`, `proMap` (proto cache), `images` (texture cache)
- `Config` — exported from src/config.ts, also on `window`. Flags for debug, UI, combat, scripting verbosity

## Data Pipeline & Asset Conventions
Engine consumes only pre-baked JSON/PNG — no runtime DAT parsing:
- `art/**/*.png` — FRM sprites (critters, items, scenery, walls, tiles, intrface, heads)
- `proto/**/*.json` — PRO binary data as JSON (items/, critters/, scenery/, walls/, misc/)
- `maps/*.json` — map data from fomap.py (tiles, objects, spatials, elevation, lights)
- `lut/lst/*.json` — LST index files; naming: `art/critters/critters.lst` → `art_critters.json`
- `lut/criticalTables.json`, `lut/elevators.json` — extracted from fallout2.exe binary

Proto type encoding (pid high byte): 0=items, 1=critters, 2=scenery, 3=walls, 4=tiles, 5=misc
Tile coordinate convention: `tileNum = y * 200 + x` (200-wide grid, 40000 max tiles per elevation)

## Conventions
- All new scripting opcodes go in src/scripting.ts inside the Script class
- Use the existing `stub()` helper for unimplemented opcodes — never silent no-ops
- Use `dbg()` / `dbgWarn()` from src/logger.ts for logging — never raw console.log in new code
- TimedEvent / `timeEventList` in scripting.ts is the hook for all tick-based callbacks
- Do not add addiction, drug, poison/radiation decay, or NPC schedule logic unless the task explicitly asks for it

## CODEBASE.md Maintenance
After any feature that adds, removes, or significantly changes a system:
- Update the relevant row(s) in the Source Modules table, the Known Gaps section, or the Repository Layout — whichever applies.
- Surgical edits only — do not rewrite sections unrelated to the change.
- If the Known Gaps section changes, append a one-line audit note: `<!-- audited: YYYY-MM-DD -->` at the end of the changed block.
- Add new wiki docs to the "Wiki references" line in CODEBASE.md when they are created.

## Intentionally Incomplete Systems (do not implement unless asked)
- Party system — add/remove/enumerate stubs only (src/party.ts)
- Perk selection UI — `pendingPerkPick` flag exists but no selection screen
- Poison / radiation / addiction — stat fields defined, no decay loop
- NPC schedules / day-night AI behavior
- Unarmed special moves (Haymaker etc.)
- Subtitles / speech audio playback
- Endgame slides
- ~11 script opcodes remain active `stub()` no-ops (e.g. `metarule`, `has_trait`, `using_skill`, `do_check`, `inven_cmds`)

## Constraints
- WebGL 2.0 only — no Three.js, no canvas 2D, no native deps
- Browser-safe: no Node.js-only APIs in src/
- Do not modify the asset pipeline (Python) unless the task is explicitly about assets
- TypeScript strict mode enforced — no implicit any, no implicit returns
