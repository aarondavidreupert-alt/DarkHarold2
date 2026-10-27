# Codebase cleanup audit (2026-10-26)

Hygiene / dead code / stale docs / maintainability audit of the whole repo, branch
`small-autits` (`abe57ff0`). Game behaviour must not change: **SAFE** items were fixed
in this pass (one commit per category), **RISKY** items wait for approval.

- **SAFE** — no behaviour change: dead code, comments, typing, `.gitignore`, docs,
  moving debug code.
- **RISKY** — deletes files or modes, changes startup order, touches the save format,
  the scripting VM / Lua backend, or anything CE-parity related; also file renames
  and dependency upgrades.

Proof of "no behaviour change": `removeComments` is on and TypeScript drops imports
whose bindings are never used, so comment and unused-import edits must compile to
byte-identical `js/` (checked with a `diff -r` of the build before and after). Module
evaluation order (the import graph is cyclic: `main.js` has to be the first import)
was compared with a static walk of the compiled imports before and after.

Status column: **fixed** (this pass), **open** (RISKY, waiting), **no action**.

## Baseline (before the cleanup)

| Check | Result |
|---|---|
| `npx tsc -p .` | 0 errors (TS 4.6.4) |
| ESLint (`eslint:recommended` + `@typescript-eslint/recommended`, not part of the build) | 5583 problems: 4048 errors (3494 `curly`), 1535 warnings (1061 `no-explicit-any`, 195 `no-unused-vars`, ...) |
| `tools/luadiff.html` | 36 scripts, 12800 runs (69 cut short), 0 differing procedures, 70 runs where the VM threw |
| `as any` in `src/` | 694 (Combat.ts 158, scripting.ts 63, main.ts 50, render/camera.ts 48, object/Obj.ts 31) |
| TODO / FIXME / XXX / HACK in `src/` | 107, none with an owner (mostly inherited from DarkFO) |

## After the SAFE fixes

| Check | Result |
|---|---|
| `npx tsc -p .` | 0 errors |
| ESLint | 5490 problems: 4051 errors, 1439 warnings. `no-unused-vars` 195 → 104; the +3 errors are `curly` counts that moved with the console code (same code, counted in new files) |
| `js/` | apart from the intended edits, every changed file compiles identical (trailing commas aside); evaluation order of the existing modules unchanged |
| `main.ts` | 1045 → 370 lines |
| `play.html` without `#dev` | `typeof window.setEggMode === 'undefined'`; `exportEventLog`, `globalState`, `Config` still defined |
| `play.html#dev` | `blackBar()`, `lightingDebug()`, `setEggMode()` ... work |
| `tools/luadiff.html` | 36 scripts, 12800 runs (69 cut short), 0 differing procedures, 70 runs where the VM threw (= baseline) |
| Story crawler (`?crawl=story&maps=arvillag,klamall,kladwtwn,denbus1`) | before: VM then Lua, 4 maps / 6916 steps, Lua = VM on all 4. After: VM run identical to the VM run before (no repeat difference) and to the Lua trace; Lua run identical to VM and to the Lua run before. (The full 29-map run takes ~2.5 h per backend; the subset covers Arroyo, Klamath and Den) |
| Play test | `play.html?artemple`: Temple of Trials loads, the player walks; `play.html?klamall` (there is no `klamath` map): the citizen's `talk_p_proc` answers, `A` starts combat (32 combatants), Enter ends it |

## Findings

### Debug console and window globals

| # | Item | file:line | Category | Class | Proposed fix | Status |
|---|---|---|---|---|---|---|
| CA1 | ~40 `(window as any).setXyz` / `lightingDebug` / `eggDebug` / `inspectPos` / `clearAssetCache` / `skipTemple` / `revealWorldmap` ... console commands registered on every page load (main.ts was 1045 lines, 620 of them these commands) | `src/main.ts:375-990` | debug code | SAFE | Move to `src/devConsole/` (barrel `src/devConsole.ts`); register only for `play.html#dev` (`#...&dev` too). `Config.engine.debug` can't be the gate: it defaults to `true` (AutoCrawler, `src/debug.ts`). Neither `tools/luadiff.html` nor the AutoCrawler (`?crawl=`) uses any of them. | fixed |
| CA2 | `scrollDebug` / `blackBar` / `borderSave` / `clearBorder` put on `window` at module load | `src/render/camera.ts:514-621` | debug code | SAFE | Export them; `devConsole/register.ts` registers them for `#dev`. The runtime state they edit (`window.scrollLimits`, `borderDebug`, `mapContentBounds` ...) stays where it is. | fixed |
| CA3 | `window.giveCar` registered at module load | `src/worldmap/Worldmap.ts:147` | debug code | SAFE | Export `giveCar`, register for `#dev` | fixed |
| CA4 | `debugLightmap` / `debugRenderer` / `debugGlobalState` set after `initGame` | `src/main.ts:365-368` | debug code | SAFE | Register for `#dev` | fixed |
| CA5 | `exportEventLog` / `__eventLog` defined as a side effect of importing `globalState.ts` | `src/globalState.ts:222-263` | window side effect | SAFE | Move to `devConsole/eventLog.ts`, registered on every load (README documents them for everyone) | fixed |
| CA6 | `window.globalState`, `window.Config`, `window.Scripting`, `window.autoCrawler` | `globalState.ts:220`, `config.ts:429`, `scripting.ts:4531`, `autocrawler.ts:56` | window globals | RISKY | Keep: the wiki tells users to flip `Config.*` debug flags in DevTools, and the test pages read them. Gating them would change documented behaviour. | no action |

### Dead code

| # | Item | file:line | Category | Class | Proposed fix | Status |
|---|---|---|---|---|---|---|
| CA7 | `useElevator()` is never called: metarule 15 runs CE `scriptsRequestElevator` in `scripting.ts:525 requestElevator` | `src/main.ts:1009-1045` | dead code | SAFE | Delete; fix the wiki pages that still route metarule 15 through it | fixed |
| CA8 | `Events.on('openWorldmap')` has no emitter since the car became script-driven (W14); its comment says "mapLoader.ts injects the car Scenery", which was removed | `src/main.ts:77-81` | dead code / stale comment | SAFE | Delete the listener and comment | fixed |
| CA9 | `globalState.isWaitingOnRemote` is never set (DarkFO multiplayer leftover, see CA30) | `globalState.ts:55`, `gameTick.ts:128`, `input.ts:303`, `main.ts:1001` | dead field | SAFE | Delete the field and its three always-false checks | fixed |
| CA10 | `declare let PF: any` — PathFinding.js was replaced by the CE hex A* (P1-P3, 2026-07-28) | `map/GameMap.ts:32`, `map/mapLoader.ts:43` | dead declaration | SAFE | Delete (no JS output) | fixed |
| CA11 | ~110 unused imports (ESLint `no-unused-vars`), e.g. `ui.ts:32-55`, `ui_character/viewer.ts:26-55`, `map/mapLoader.ts:23-43`, `scripting.ts:41-80` | many | unused imports | SAFE | Delete; TypeScript already elides them, so `js/` is byte-identical | fixed |
| CA12 | Commented-out code: debug `console.log`s (`intfile.ts`, `lightmap.ts`, `Critter.ts`, `Obj.ts`, ...), jQuery worldmap scroll (`worldmap/Worldmap.ts:793`), old worldmap button handler (`ui.ts:230`), `player.ts:397`, `scripting.ts:2106,4423`, `vm.ts:454,481`, `vm_bridge.ts:423,433` | many | commented-out code | SAFE | Delete (comments: `js/` byte-identical) | fixed |
| CA13 | Unused locals / module constants with real values (`ui_barter/swap.ts:44-47` hit boxes, `ui_character/creator.ts:757`, `combat/Combat.ts:132 OBJECT_SHOOT_THRU`, `renderer.ts:571-589` abstract-method params, ...) and ~200 exports used only in their own file | many | dead code | RISKY | Most are CE constants / coordinates kept as documentation of the CE layout, or interface parameters. Remove case by case only. | fixed 2026-10-27: `tsc --noUnusedLocals` 44 → 18; the 18 left are the CE layout constants (`ui_barter/swap.ts` hit boxes, `OBJECT_SHOOT_THRU`) and the `stub()` helper CLAUDE.md prescribes. Exports used only in their own file not pruned |
| CA14 | `lib/pathfinding-browser.js` (62 KB) loaded by `play.html` and `tools/luadiff.html`, nothing uses `PF` | `play.html:26`, `tools/luadiff.html:17` | dead file | RISKY | Delete the file and both `<script>` tags (deletes a file) | fixed 2026-10-26 (approved) |

### Typing

| # | Item | file:line | Category | Class | Proposed fix | Status |
|---|---|---|---|---|---|---|
| CA15 | `globalState.imageInfo: any` (the `art/imageMap.json` entries) | `src/globalState.ts:158` | typing | SAFE | `ImageInfo` interface (numFrames, totalFrames, frameWidth/Height, fps, actionFrame, numDirections, directionOffsets, frameOffsets) | fixed |
| CA16 | `lastUpdateTime` / `lastDrawTime` are in the type but missing from the initialiser | `src/globalState.ts:170-171` | typing | SAFE | Initialise to 0 (the FPS overlay shows "update: 0ms" for the first frame instead of nothing) | fixed |
| CA17 | `drugHandler` / `miscItemUseHandler` typed `user: any` | `src/globalState.ts:213-215` | typing | SAFE | `user: Critter` | fixed |
| CA18 | `tsconfig.json` has no `"strict": true` (strictNullChecks, strictPropertyInitialization ... off); CLAUDE.md said "strict mode" | `tsconfig.json`, `CLAUDE.md:7,182` | config / docs | doc SAFE, flag RISKY | Docs now name the flags that are on. Turning `strict` on means hundreds of errors and touches every system. | doc fixed, flag open |
| CA19 | 694 `as any` | `combat/Combat.ts` 158, `scripting.ts` 63, `render/camera.ts` 48 ... | typing | RISKY | Combat / scripting hotspots are CE-parity code; type them system by system | open |

### Startup and caching

| # | Item | file:line | Category | Class | Proposed fix | Status |
|---|---|---|---|---|---|---|
| CA20 | Shaders fetched with `?v=Date.now()`: a new URL every load, never cached | `src/main.ts:86-90` | caching | SAFE | Plain URL with `{ cache: 'no-cache' }`: the browser revalidates (304) and still always gets the current file | fixed |
| CA21 | Synchronous XHR in `fileStamp()` (a HEAD per cached JSON) | `src/main.ts:320` | startup | RISKY | `fetch` HEAD + async `cachedJSON`; it changes the startup sequence. `getFile*` in `util.ts` and `aiPackets.ts:139` are sync XHR too (the whole loader is synchronous by design). | open |
| CA22 | Nested callback chain `IDBCache.init → cachedJSON → cachedJSON → initGame` | `src/main.ts:352-371` | startup | RISKY | Promise-based `IDBCache` + `await`; same order, but it is the boot path | open |

### Config and repository

| # | Item | file:line | Category | Class | Proposed fix | Status |
|---|---|---|---|---|---|---|
| CA23 | `package.json` has no name / private / scripts | `package.json` | config | SAFE | Add `name`, `private: true`, scripts `build` (`tsc -p .`) and `lint` | fixed |
| CA24 | TypeScript ^4.6, ESLint 7 with legacy `.eslintrc.js`, `@typescript-eslint` 5 | `package.json`, `.eslintrc.js` | dependencies | RISKY | Upgrade TS 5.x / ESLint 9 flat config; new TS versions add errors | open |
| CA25 | `.gitignore` lists `*.map` and `*.msk` twice | `.gitignore:3,6,13,17` | config | SAFE | Drop the duplicates | fixed |
| CA26 | `.claude/settings.local.json` (personal tool permissions) is tracked | `.claude/settings.local.json` | repo | RISKY | `git rm --cached` + ignore it. A pull of that commit **deletes the file** in every other checkout (e.g. the main working copy). `.claude/launch.json` stays tracked (decided). | fixed 2026-10-26 (approved; now in .gitignore) |
| CA27 | `raw/fallout2-ce/` vendors the whole CE repo (Android/iOS/SDL `os/`, `.github/` CI, `third_party/`, CMake) — 400 of the 780 tracked files | `raw/` | repo | RISKY | Keep only `src/` (+ LICENSE) or move to a submodule. Not deleted (task note). | fixed 2026-10-27: `src/` + LICENSE + README kept, `VENDORED.md` |
| CA28 | `docs/planning/` holds three `.docx` files and "new 5.txt" (a pasted chat log) | `docs/planning/` | repo | RISKY | Move out of the repo or into the wiki as text. Not deleted (task note). | fixed 2026-10-27: text in `wiki/planning_archive.md`, chat log dropped |
| CA29 | `lut/intensityColorTable.js` (374 KB, a generated table loaded by `<script>`); no pipeline stage makes it | `lut/`, `play.html:29` | repo | RISKY | Generate it in the pipeline (`tools/` change) or document where it came from (DarkFO) | fixed 2026-10-27: documented in the file; equals CE `_setIntensityTables` built from `lut/colorTable.json` + the palette, checked by `test/lighting.test.mjs` |
| CA30 | `tools/mpserv.py` (DarkFO multiplayer server, no client left), `tools/oldPy/` (17 superseded scripts), `tools/parse_gam2.py` next to `parse_gam.py` | `tools/` | repo | RISKY | Delete (`tools/` needs approval) | fixed 2026-10-26 (approved) |
| CA31 | `tools/lut/lst/*.json` (27 LST index files) are tracked while `lut/lst/` is ignored as game data | `tools/lut/lst/` | repo | RISKY | Check whether any tool reads them; untrack if they are install-derived | fixed 2026-10-27: untracked (nothing read them) |
| CA32 | `lib/` vendors wasmoon and PathFinding.js without version info | `lib/` | repo | SAFE (doc) | Note what is known in CODEBASE.md (no version string in either file) | fixed |

### Docs drift

| # | Item | file:line | Category | Class | Proposed fix | Status |
|---|---|---|---|---|---|---|
| CA33 | CLAUDE.md "Key Files": `scripting.ts` "~1700 lines" (4533), `vm_bridge.ts` "~150 entries" (267), `combat.ts` / `critter.ts` / `object.ts` called the logic files (they are barrels), `main.ts` "main game loop, input handling" (boot only) | `CLAUDE.md:52-64` | docs | SAFE | Point at the real files (`combat/Combat.ts`, `critter/lifecycle.ts`, `object/Obj.ts`, `gameTick.ts`, `input.ts`) | fixed |
| CA34 | CLAUDE.md wiki list misses `CE_PARITY_AUDIT.md` and `wiki/ce_audit/` | `CLAUDE.md:34` | docs | SAFE | Add them (and this file) | fixed |
| CA35 | CODEBASE.md: "Estimated completion: ~55%" (README/ROADMAP: ~99%), `main.ts` row lists `useElevator` | `CODEBASE.md:5,73` | docs | SAFE | Fix | fixed |
| CA36 | README: `main.ts` "Main game loop, input handling"; "Development / Debug" says to flip `Config.engine.debug` (already `true`); `skipTemple()` / `revealWorldmap()` / `giveCar()` now need `#dev` | `README.md:53,497-560` | docs | SAFE | Fix, document `play.html#dev` | fixed |
| CA37 | wiki pages naming the console commands without `#dev` (hotkeys `setDevKeys`, lighting, alignment, extended_flags, scroll_clamping, car_system ...) and routing metarule 15 through `useElevator` (`interface_windows.md`, `tile_system.md`) | `wiki/*.md` | docs | SAFE | Add the `#dev` note, fix the elevator path | fixed |
| CA38 | README / ROADMAP / CODEBASE / CLAUDE.md repeat the same status numbers (completion %, 181 / 192 opcodes, 1288 scripts) | several | docs | SAFE (no action) | CLAUDE.md already names `wiki/known_bugs.md` + `ROADMAP.md` as the source of truth; only the stale ~55% was wrong | no action |
| CA39 | Doc paths that no longer exist: `src/encounters/resolver.ts`, `lut/car_parking.json`, `src/carParking.ts`, `tools/parseElevatorTable.py`, `src/drawFrame.ts`, `docs/changelog.md` | `known_bugs.md:173-176,638`, `car_system.md`, `ts-split-refactor.md:615`, `upu_support.md:40` | docs | no action | Inside dated history rows of the trackers (they describe what was true then) or planned-split tables; rewriting history is out of scope | no action |

### Naming and size

| # | Item | file:line | Category | Class | Proposed fix | Status |
|---|---|---|---|---|---|---|
| CA40 | Naming mix: `gametime.ts` vs `gameTick.ts`; snake_case `proto_types.ts`, `vm_bridge.ts`, `ui_hud.ts` and 25 more `ui_*.ts` vs camelCase | `src/` | naming | RISKY | Renames (no renames in this pass) | open |
| CA41 | Files over 800 lines: `scripting.ts` 4533, `combat/Combat.ts` 3498, `object/Obj.ts` 1775, `worldmap/Worldmap.ts` 1280, `ui_character/creator.ts` 976, `vm.ts` 911, `render/webglDraw.ts` 906, `render/webglContext.ts` 864, `object/critterAnimation.ts` 853, `render/camera.ts` 813 (`main.ts` 1045 → ~380 after CA1) | `src/` | size | RISKY | Splits per `wiki/ts-split-refactor.md`; scripting / VM / combat are parity code | open |
| CA42 | Duplicate helpers: `isHitFromFront` (`combat/Combat.ts:187`, `critter/lifecycle.ts:396`), `combatDebug` (Combat.ts, hitChance.ts), `getCenterTile` (`tile.ts:60` private, `render/camera.ts:775`) | | duplicates | RISKY | Merge after checking both against CE (`isHitFromFront` is combat code) | fixed 2026-10-27: one `isHitFromFront` (critter/lifecycle.ts, CE actions.cc _is_hit_from_front), `hitChance.ts` calls `dbg('combat')`, one `getCenterTile` (camera.ts; the tile.ts copy was off by one hex, known_bugs CA48) |
| CA48 | `tools/fonts.py`: an early AAF to PNG script that converts at import time, with absolute paths into the main checkout (`art/fonts/font<N>.png/.json`); nothing imports it, the pipeline uses `tools/exportFonts.py` (`font<N>_aaf.*`) | `tools/fonts.py` | dead file | RISKY | Delete | fixed 2026-10-27 (found by the Q17 import check, which re-wrote the unused `art/fonts/font0.png/.json` in the main checkout) |
| CA43 | 107 TODO / FIXME / XXX without owner, most from DarkFO (e.g. `ui.ts:110-116`, `object/Obj.ts`) | `src/` | TODOs | no action | Triage into `wiki/known_bugs.md` when a system is next audited | no action |
| CA44 | `console.log` left in: `aiPackets.ts:229` prints "Loaded N AI packets" on every load | `src/aiPackets.ts:229` | debug output | no action | `aiPackets.ts` has no imports on purpose (no import cycle), so it can't use `dbg()`; one line per load | no action |
| CA45 | `Config.engine.debug` comment "set true to enable" while it defaults to `true` | `src/config.ts:185` | stale comment | SAFE | Fix comment | fixed |

## Real bugs found

None in game logic. (The dead code above never ran, so removing it changes nothing.)
