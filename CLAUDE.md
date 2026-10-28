# DarkHarold2 — Claude Project Instructions

DarkHarold2 is a semi-faithful browser recreation of Fallout 2, forked from the DarkFO project (Apache 2.0 license). Goal: faithful F2 gameplay with only minor tweaks — do not invent features, follow the originals.

## Tech Stack
- Engine/logic: TypeScript 6, `strict` (incl. `strictNullChecks`) + `noImplicitReturns`; a value the code knows is set is marked `!`. Compiled with `npx tsc -p .` (`npm run build`) → `js/`
- Rendering: WebGL 2.0 (no canvas 2D fallback)
- Audio: Web Audio API (ACM source files, converted to WAV by pipeline)
- Asset pipeline: Python 3.11+ / Pipenv, scripts under `tools/` (`tools/setup.py` orchestrates full extraction; `tools/pipeline_gui.py` is a Tkinter GUI front-end)
- Package management: npm (TS devDeps only — no runtime npm modules), Pipenv (Python). Browser libraries are vendored under `lib/` (wasmoon/ — Lua 5.4 for the Lua script backend)
- No native dependencies — browser-safe only

## Build Commands
- `npx tsc` — compile TypeScript (output to js/)
- `pipenv run python tools/setup.py /path/to/Fallout2/` — full asset extraction pipeline (run from project root; `--stages`, `--skip-existing`, `--delete-originals` flags available)
- `pipenv run python tools/pipeline_gui.py` — graphical front-end for the same pipeline
- `npm test` — unit tests (`test/*.test.mjs`, `node --test` on the compiled `js/`; pretest runs tsc). Expected
  values come from CE (cite file + function in each test), never from running the TS. A module a test imports
  must load in Node: keep `globalState.ts`, `logger.ts` and the formula modules free of game / DOM imports
- `npm run lint:ratchet` — ESLint must not rise above `tools/eslintBaseline.json` (`-- --update` after lowering it)
- `npm run parity` — `tools/luadiff.html` in headless Chromium (Playwright); must print the luadiff baseline line.
  Needs the extracted game data: local only, not in CI
- `npm run smoke` / `npm run storycrawl` — headless game boot (page errors, `SMOKE_SYNC_XHR=1` counts blocking
  requests) and the story crawler on both backends (VM = Lua, `--compare` a saved run). Local only, like parity
- `npm run format` (Prettier, checked in CI), `npm run cycles` (import cycles; CI: largest ≤ 90 modules; a split class's files count one by one)
- CI (`.github/workflows/ci.yml`): build (0 errors, `strict`), import-cycle ratchet, Prettier, lint ratchet, `npm test`.
  Everything else (play testing, story crawler) is manual in the browser

## Ground-Truth References
All game logic, formulas, and data structures must be anchored to:
- fallout2-ce (https://github.com/alexbatalov/fallout2-ce) — authoritative C++ source. Cite the specific .cc/.h file and function name in every implementation.
- jsFO (https://github.com/ajxs/jsFO) — JS/browser patterns reference (secondary)

## Wiki Layer
When researching any system before implementing or documenting:
1. Check `wiki/` first — these docs are pre-audited summaries of CE behaviour with DH2 gaps already identified. Trust them over raw source reads for formulas and system overviews.
2. Fall back to `raw/fallout2-ce/src/` only when the wiki is silent, too high-level, or you suspect a discrepancy.
3. If CE source and the wiki contradict each other, stop and flag the conflict rather than guessing.

Available wiki docs (43 system docs in `wiki/`, audited 2026-10-18; `lua_scripts.md` added 2026-10-19, `lua_variable_names.md` (generated review list) 2026-10-21, `upu_support.md` (Unofficial Patch, mod folders) 2026-10-22):
`actions.md`, `ai_behavior.md`, `animation.md`, `car_system.md`, `character_stats.md`, `combat.md`, `companion_party.md`, `critter_stats.md`, `damage_formula.md`, `dialogue_system.md`, `drugs.md`, `economy.md`, `endgame.md`, `faction_reputation.md`, `file_formats.md`, `hotkeys.md`, `interface_windows.md`, `items.md`, `known_bugs.md`, `lighting.md`, `lua_scripts.md`, `lua_variable_names.md`, `map_scripting.md`, `upu_support.md`, `palette_colors.md`, `pathfinding.md`, `perks_traits.md`, `pipboy.md`, `proto_system.md`, `quest_system.md`, `random_numbers.md`, `rendering.md`, `save_load.md`, `scripting_reference.md`, `scripting_vm.md`, `scroll_clamping.md`, `settings.md`, `skill_checks.md`, `sound_system.md`, `spatial_triggers.md`, `status_effects.md`, `tile_system.md`, `time_clock.md`, `weapon_combat.md`, `worldmap.md`.
Meta/audit: `CE_PARITY_AUDIT.md` (+ `ce_audit/`, function-by-function CE parity tables), `cleanup_audit.md` (codebase hygiene audit, 2026-10-26), `code_quality.md` (modern-standards assessment + fixing plan, 2026-10-27), `planning_archive.md` (early planning docs, superseded), `CODEBASE_FOCE.md`, `CODEBASE_jsFO.md`, `CROSS_CHECK_NOTES.md`, `alignment.md`, `extended_flags.md`, `failed_animation_offset_attempts.md`, `ts-split-refactor.md`, `edit_history.md`, `autocrawler.md` (AutoCrawler usage), `README.md`.

## File Access Policy
- ALWAYS pull from the remote branch before reading any file
- If a file is not found after pulling, STOP and ask — do NOT create it from scratch
- Never fabricate reference files (pal.py, frmpixels.py, example_scripts/, etc.)

## Key Files
- src/scripting.ts — the Script class, script loading and state; its opcode methods live in src/scripting/opcodes/<category>.ts, the event entry points (talk, use, damage, …) in src/scripting/events.ts
- src/vm.ts — bytecode VM (opMap of raw bytecode handlers)
- src/vmBridge.ts — wires bytecode opcodes to Script class methods (bridgeOpMap, ~270 `bridged()` entries)
- src/lua/ — the Lua script backend (luaRuntime.ts, prelude.ts, luaDiff.ts)
- src/player.ts — Player class and stat initialization
- src/gametime.ts — in-game time constants, day/night cycle; src/gameTick.ts — the per-tick game loop
- src/combat/Combat.ts — combat loop, AI, hit/damage (src/combat.ts is its barrel; also combat/{AI,damage,hitChance,...}.ts, criticalEffects/)
- src/critter/lifecycle.ts — critter damage/kill helpers (src/critter.ts is its barrel)
- src/object/Obj.ts, src/object/Critter.ts — Obj / Critter types (src/object.ts is their barrel)
- src/state/ — owned game state: `world` (gMap, player, gParty, combat, time), `uiState`, `view` (camera), `services` (renderer, audio), `assets` (images, protos, messages)
- src/globalState.ts — engine runtime fields (loading flags, eventLog) plus a getter / setter for every `src/state/` field
- src/config.ts — Config singleton with engine/UI/scripting/combat debug flags
- src/main.ts — boot only: renderer, audio, fallout2.cfg, the asset caches, `initGame`
- src/input.ts, src/hotkeys.ts — mouse and keyboard handlers; src/playerUse.ts — object interaction
- src/devConsole/ — DH2 developer console commands, registered for `play.html#dev` only
- src/heart.ts — 60Hz heartbeat loop

## Lua Script Backend (default)
`tools/int2lua.py` decompiles `data/scripts/*.int` to `*.lua` (pipeline stage `decompile_scripts`); `src/lua/`
runs them in place of the VM (`[dh2] script_backend=lua`, the default since 2026-10-21; `=vm` runs the bytecode,
and so does an install without decompiled scripts). Both backends call the same `Script` methods.
Check any decompiler or prelude change with `tools/luadiff.html` (VM-vs-Lua differential test). Generated `.lua`
files are derived from the user's install — never commit them. See `wiki/lua_scripts.md`.

## Scripting System Architecture
Three-file split — understand this before touching any opcode:
1. `src/vm.ts` — low-level bytecode decoder (`opMap`, raw stack ops)
2. `src/vmBridge.ts` — maps bytecode op values to Script methods via `bridgeOpMap` and the `bridged(procName, argc)` factory
3. `src/scripting.ts` — `Script` class, one method per FO2 script intrinsic; the methods are kept by category in `src/scripting/opcodes/*.ts` (core, critter, inventory, objects, map, anim, dialogue, combat, metarule, sfall) and installed on `Script.prototype` (`installMethods`)

To add a new opcode: add the method to the matching `src/scripting/opcodes/<category>.ts` object (it gets `this: Script` as its first parameter), then wire it in vmBridge.ts with `bridged("methodName", argCount)`. Never add raw stack logic in vmBridge.ts.

Script variable scoping:
- GVARs — engine-wide, persisted in save
- LVARs — per-script instance, persisted in save
- MVARs — per-map, persisted with map

## Key Singletons
- `world`, `uiState`, `view`, `services`, `assets` — `src/state/*.ts`; new code imports the owner (`world.player`)
- `globalState` — exported from src/globalState.ts, also on `window`. Own fields: `isLoading`, `eventLog`, the use handlers; every `src/state/` field is reachable through it too (`globalState.player`, dev console, saves)
- `Config` — exported from src/config.ts, also on `window`. Flags for debug, UI, combat, scripting verbosity

## Data Pipeline & Asset Conventions
Engine consumes only pre-baked JSON/PNG — no runtime DAT parsing:
- `art/**/*.png` — FRM sprites (critters, items, scenery, walls, tiles, intrface, heads)
- `proto/**/*.json` — PRO binary data as JSON (items/, critters/, scenery/, walls/, misc/)
- `maps/*.json` — map data from fomap.py (tiles, objects, spatials, elevation, lights)
- `lut/lst/*.json` — LST index files; naming: `art/critters/critters.lst` → `art_critters.json`
- `lut/criticalTables.json` — extracted from fallout2.exe (no longer read: CE's critical and elevator tables
  are compiled in, `src/criticalEffects/ceTables.ts`, `src/ceElevators.ts`)

- `mods/<name>/` — mod folders (the pipeline's `build_mods` stage converts an install's mods, e.g. the
  Unofficial Patch, into the same layout plus `manifest.json`); active while listed in `mods/mods_order.txt`.
  **Every asset load must go through `assetUrl(path)` (`src/modAssets.ts`) or the `getFile*` helpers in
  `src/util.ts`** (which call it), so a mod's copy replaces the vanilla file — `img.src`, CSS `url()`,
  `fetch`, `new Audio` included. See `wiki/upu_support.md`.

Proto type encoding (pid high byte): 0=items, 1=critters, 2=scenery, 3=walls, 4=tiles, 5=misc
Tile coordinate convention: `tileNum = y * 200 + x` (200-wide grid, 40000 max tiles per elevation)

## Conventions
- Scripting opcodes are methods of the `Script` class (`src/scripting.ts`), kept by
  category in `src/scripting/opcodes/<category>.ts` (object literals with a `this: Script`
  parameter, installed on the prototype by `installMethods`; 2026-10-28, code_quality Q16).
  To add an opcode: add it to the matching category file, then wire it in
  `src/vmBridge.ts` with `bridged("name", argc[, returns])`. The same pattern splits
  `combat/Combat.ts` (`combat/combat*.ts`). Import those files only through their class's module.
- Use the existing `stub()` helper for unimplemented opcodes — never silent no-ops
- Use `dbg()` / `dbgWarn()` from src/logger.ts for logging — never raw console.log in new code
- TimedEvent / `timeEventList` in scripting.ts is the hook for all tick-based callbacks
- Radiation (`src/radiation.ts`), drugs/addiction (`src/drugs.ts`) and poison decay are CE ports; NPC schedules are script-driven (`critter_p_proc`, as in CE). Keep changes to them CE-faithful.

### Subfolder layout convention
When a file gets split, its parts land in a sibling subfolder named after
the original file (e.g. `src/scripting.ts` → `src/scripting/Script.ts` +
siblings), and the original filename becomes a **barrel** at the same path
that re-exports the sub-files. Existing import sites that read
`from './scripting.js'` or `from './object.js'` keep working through the
barrel — no call site updates as part of a split. Bypassing the barrel
from outside the subfolder (`from './scripting/dialogue.js'`) is a code
smell warranting a review note; inside the subfolder, siblings import each
other directly. Files that aren't split keep their current top-level path.
See `wiki/ts-split-refactor.md` → "Subfolder layout" for the full rule
table and rationale.

## CODEBASE.md Maintenance
After any feature that adds, removes, or significantly changes a system:
- Update the relevant row(s) in the Source Modules table, the Known Gaps section, or the Repository Layout — whichever applies.
- Surgical edits only — do not rewrite sections unrelated to the change.
- If the Known Gaps section changes, append a one-line audit note: `<!-- audited: YYYY-MM-DD -->` at the end of the changed block.
- Add new wiki docs to the "Wiki references" line in CODEBASE.md when they are created.

## known_bugs.md — Maintenance Rule

`wiki/known_bugs.md` is a living document. Update it when:
- A stub or gap is resolved → mark as FIXED with date
- A new stub or TODO is introduced → add entry immediately
- A sprint touches scripting, combat, or worldmap → re-audit
  relevant sections and update "Last audited" date

When closing a bug in a feature prompt, include:
> Also update wiki/known_bugs.md: mark [entry name] as FIXED (date).

## README.md — Auto-Update Rule

`README.md` is the public-facing summary and must stay in sync with the canonical
trackers (`wiki/known_bugs.md` and `ROADMAP.md`). Update it whenever those change
substantively. Specifically:

- After any sprint that closes or opens entries in `wiki/known_bugs.md`, refresh the
  bullets under "Substantially implemented", "Partially implemented", and "Not
  implemented" so the public summary matches the tracker.
- When `ROADMAP.md`'s top-of-file completion estimate changes, mirror the new
  percentage in `README.md`'s "Status" section in the same commit.
- Keep the "Project Index / New Contributor Readthrough Guide" section accurate:
  if a wiki doc is renamed, added, or removed, update the corresponding row in the
  index table. Never list a wiki file that does not exist in `wiki/`.
- Surgical edits only — do not rewrite unrelated README sections (build commands,
  AutoCrawler, Debug Logging, FAQ) when refreshing the status content.
- The wiki tracker is the source of truth when README and the tracker disagree;
  the README must be updated to match, not the other way around.

## Intentionally Incomplete Systems
Everything formerly listed here is implemented as of the `100percent` branch (2026-10-07):
party (level-ups, CE placement), perk selection, poison/radiation/addiction, script-driven NPC
schedules, unarmed special moves, talking heads + speech + subtitles, movies, endgame slides,
and all 181 vanilla opcodes (0 active `stub()` calls). Remaining deliberate approximations
are listed in README.md → "Known approximations" and `wiki/known_bugs.md`:
- Action menu on a command-mode click (CE: held left button; `[dh2] mouse_mode=ce` gives CE's clicks); mouse wheel zooms (CE: scrolls; `mouse_wheel=ce`)
- `[dh2]` CE switches for other DH2 choices: `talk_mode`, `scroll_mode`, `save_slots`, `egg_mode`, `barter_running_item`, `combat_outline`, `elevation_fade` (defaults keep DH2's)
- Browser limits: no `fallout2.cfg` write-back (localStorage instead), mouse sensitivity stored only
- DH2 day/night light curve on by default (`[dh2] day_night_cycle=0` = CE script-only lighting)
- Cosmetic: no Pip-Boy screensaver, no palette fade around skill use

The 2026-10-18 wiki re-audit (known_bugs C48–C61) checked every wiki doc against CE and the code;
an opcode scan of the 1288 scripts in scripts.lst finds a handler for all 192 opcodes they use.

## Constraints
- WebGL 2.0 only — no Three.js, no canvas 2D, no native deps
- Browser-safe: no Node.js-only APIs in src/
- Do not modify the asset pipeline (Python) unless the task is explicitly about assets
- TypeScript: `strict` + no implicit returns (tsconfig.json); keep `as any` rare (CI does not count it yet; 172 left)
