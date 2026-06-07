# TypeScript Split Refactor — Audit & Strategy

> **Status:** proposal only. No code has been changed.
> **Audit date:** 2026-06-04
> **Scope:** every file under `src/` exceeding 400 lines.

This document audits the largest TypeScript modules in DarkHarold2 and proposes a
concrete plan to split them into focused sub-modules of roughly ≤ 400 lines each.
It is intentionally conservative — every proposed split preserves the existing
public import surface so call sites that read `from './scripting.js'` or
`from './object.js'` keep working via re-exports.

The proposals respect the three-file Scripting VM split documented in
[`CLAUDE.md` → "Scripting System Architecture"][claude-scripting] and the
"Source Modules" table in [`CODEBASE.md`][codebase]. No proposal introduces a
new architectural seam that contradicts those documents; in particular, no
opcode bodies move out of `Script` (CLAUDE.md "Conventions" forbids it).

[claude-scripting]: ../CLAUDE.md
[codebase]: ../CODEBASE.md

---

## Overview — files over 400 lines

| # | File | Lines | Proposed split count | Subsystem |
|---|------|------:|---------------------:|-----------|
| 1 | `src/scripting.ts` | 2614 | 6 | Scripting |
| 2 | `src/object.ts` | 2208 | 5 | Objects / characters |
| 3 | `src/ui_character.ts` | 2095 | 4 | UI panels |
| 4 | `src/combat.ts` | 1694 | 5 | Combat |
| 5 | `src/main.ts` | 1279 | 4 | Engine core |
| 6 | `src/webglrenderer.ts` | 1161 | 3 | Rendering |
| 7 | `src/autocrawler.ts` | 903 | 4 | Testing / tooling |
| 8 | `src/ui_inventory.ts` | 780 | 2 | UI panels |
| 9 | `src/map.ts` | 759 | 2 | World / map |
| 10 | `src/worldmap.ts` | 757 | 3 | World / map |
| 11 | `src/perks.ts` | 747 | 2 | Objects / characters |
| 12 | `src/ui_pipboy.ts` | 736 | 4 | UI panels |
| 13 | `src/critter.ts` | 670 | 2 | Objects / characters |
| 14 | `src/skillUse.ts` | 651 | 2 | Skills |
| 15 | `src/lightmap.ts` | 589 | 2 | Rendering |
| 16 | `src/renderer.ts` | 566 | 2 | Rendering |
| 17 | `src/ui_font.ts` | 543 | 2 | UI panels |
| 18 | `src/automapData.ts` | 543 | 3 | Persistence |
| 19 | `src/endgame.ts` | 536 | 3 | Endgame |
| 20 | `src/encounters.ts` | 519 | 2 | World / map |
| 21 | `src/ui_barter.ts` | 486 | 2 | UI panels |
| 22 | `src/criticalEffects.ts` | 478 | 2 | Combat |
| 23 | `src/ui.ts` | 469 | leave; already barrel | UI panels |
| 24 | `src/ui_options.ts` | 438 | 2 | UI panels |
| 25 | `src/geometry.ts` | 411 | 2 | Math utilities |

**Net result if all splits land:** roughly **62 new modules**, each well under
400 lines, with the existing 25 files either deleted, slimmed to a barrel
re-export, or split into focused responsibilities. See the per-file sections
below for full detail.

---

## General architectural observations

1. **`Scripting` is by far the most concentrated single namespace.** ~2600 lines
   in one `export module Scripting { ... }` block. The `Script` class alone
   contains all ~160 FO2 opcodes. CLAUDE.md explicitly forbids moving opcode
   bodies out of `Script`, so the split must add module-level helpers and
   sibling files inside the `Scripting` namespace via TypeScript's
   "namespace can be augmented across files" feature.

2. **`object.ts` is a god-class file.** `Obj`, `Item`, `WeaponObj`, `Scenery`,
   `Door`, `Critter` (≈ 720 lines on its own) and the factory functions all
   live here. The class hierarchy itself is fine; the problem is the **animation
   state machine** inside `Critter` — over half of `Critter` is the FRM
   animation pipeline (`updateStaticAnim`, `updateLoopingAnim`, `updateAnim`,
   `staticAnimation`, `getAnimation`, `clearAnim`, `walkTo`, the artOffset
   formulas).

3. **`combat.ts` mixes data structures (`ActionPoints`, `AI`), formula helpers
   (4 `computeDamage*` variants), and the giant `Combat` class** with its 25+
   methods. The class itself owns turn flow, AI dispatch, hit-chance, damage
   calculation, perish handling, and LoS — each of those is a candidate to
   become a focused sibling module that exposes pure functions consumed by
   `Combat`'s thin shell.

4. **UI files are mostly self-contained — the worst offenders are
   `ui_character.ts` (2095 lines) and `ui_pipboy.ts` (736 lines).**
   `ui_character.ts` interleaves the character-screen viewer and the
   character creator (two distinct flows sharing nothing except styles and
   shared widgets). `ui_pipboy.ts` has STATUS, AUTOMAPS, ARCHIVES tabs each
   ~150 lines, plus a date/time bar and a "wait" menu — each tab is its own
   sub-module candidate.

5. **`main.ts` mixes module-level state (`nextMapUpdateTick`,
   `lastMidnightDay`), input handlers (mouse/keyboard), the per-tick game
   loop (`heart.update`), the draw loop (`heart.draw`), and the elevator
   helper.** Splitting input handling and the tick loop into focused files is
   low-risk and leaves `main.ts` as the engine bootstrap.

6. **`perks.ts` is data + 3 functions.** ~660 lines is a literal `PERKS: PerkDef[]`
   array; the remaining ~80 lines is the `getValidPerks` / `getPerkRank` /
   `applyPerk` logic. Splitting data into `perks.data.ts` (or even per-category
   data files) is mechanical with zero risk of circular deps.

7. **Circular dependency risks are concentrated in two clusters:**
   - **`scripting.ts` ↔ everything game-state** (it already imports
     `combat`, `critter`, `object`, `worldmap`, `endgame`, `main`, `renderer`,
     `ui`). Splitting `scripting.ts` must keep the **module namespace
     augmentation pattern** so the existing import sites continue working.
   - **`object.ts` ↔ `critter.ts` ↔ `combat.ts`** (`object.ts` re-imports
     `critterDamage` and `Weapon` from `critter.ts`; `combat.ts` imports
     `Critter` from `object.ts`). The split must avoid re-importing
     `Critter` symbols across the new files in this cluster.

8. **Several files are barrels masquerading as modules.** `ui.ts` (469 lines)
   is already mostly re-exports plus `uiInit`. It does **not** need splitting —
   it's actually the model the other UI splits should follow. Same goes for
   the lighter-weight UI files (`ui_panels.ts`, `ui_drag.ts`, `ui_components.ts`).

---

## Subfolder layout

The current `src/` is flat: ~70 files at the top level. The refactor proposals
below add ~66 more — without grouping that's ~135 files in one directory.
A subfolder layout is therefore part of this proposal, mirroring the
"Source Modules" grouping in [`CODEBASE.md`][codebase].

### Folder convention

| Rule | Detail |
|------|--------|
| **When a file gets split, its parts land in a sibling subfolder named after the original file.** | `src/scripting.ts` → `src/scripting/Script.ts` + siblings. The original filename becomes a **barrel** at the same path. |
| **Barrels stay at the old path.** | Existing import sites (`from './scripting.js'`, `from './object.js'`) keep working. No call-site updates as part of a split. |
| **The barrel file is the public surface.** | If a downstream module imports a sub-file directly (`from './scripting/dialogue.js'`), that's a deliberate decision to depend on an internal — flag it in review. |
| **Files that aren't split stay where they are.** | `src/heart.ts`, `src/config.ts`, `src/util.ts`, `src/aiPackets.ts`, etc. all keep their current path. No churn for files under 400 lines. |
| **No nested subfolders inside a subfolder unless the file count justifies it.** | `src/ui_pipboy/tabs/` is the one exception (4 tab files share a common parent shell). Everything else is one level deep. |

### Target folder structure (after every split lands)

```
src/
├── audio.ts
├── aiPackets.ts
├── automap/                  ← split from automapData.ts
│   ├── render.ts
│   ├── storage.ts
│   └── tracking.ts
├── automapData.ts            ← barrel
├── autocrawler/              ← split from autocrawler.ts
│   ├── combat.ts
│   ├── dialogue.ts
│   ├── maps.ts
│   ├── report.ts
│   ├── shared.ts
│   └── types.ts
├── autocrawler.ts            ← barrel
├── char.ts
├── combat/                   ← split from combat.ts
│   ├── actionPoints.ts
│   ├── AI.ts
│   ├── Combat.ts
│   ├── damage.ts
│   └── hitChance.ts
├── combat.ts                 ← barrel
├── config.ts
├── criticalEffects/          ← split from criticalEffects.ts
│   ├── effects.ts
│   └── table.ts
├── criticalEffects.ts        ← barrel
├── data.ts
├── debug.ts
├── drugs.ts
├── encounters/               ← split from encounters.ts
│   ├── conditionLang.ts
│   └── resolver.ts
├── encounters.ts             ← barrel
├── endgame/                  ← split from endgame.ts
│   ├── deathEndings.ts
│   └── slideRender.ts
├── endgame.ts                ← public sequences + barrel
├── eventlog.types.ts
├── events.ts
├── formats/                  ← already a subfolder today
│   ├── fon.ts
│   └── struct.js
├── gameTick.ts               ← split from main.ts
├── gametime.ts
├── geometry/                 ← split from geometry.ts
│   ├── hexGrid.ts
│   └── hexScreen.ts
├── geometry.ts               ← barrel
├── globalState.ts
├── heart.ts
├── idbcache.ts
├── images.ts
├── init.ts
├── input.ts                  ← split from main.ts
├── intfile.ts
├── lighting.ts
├── lightmap/                 ← split from lightmap.ts
│   └── lightTable.ts
├── lightmap.ts               ← public namespace + barrel
├── logger.ts
├── main.ts                   ← bootstrap only
├── map/                      ← split from map.ts
│   ├── GameMap.ts
│   └── mapLoader.ts
├── map.ts                    ← barrel
├── object/                   ← split from object.ts
│   ├── Critter.ts
│   ├── critterAnimation.ts
│   ├── factories.ts
│   ├── items.ts
│   └── Obj.ts
├── object.ts                 ← barrel
├── party.ts
├── perks/                    ← split from perks.ts
│   ├── perks.data.ts
│   └── perks.ts
├── perks.ts                  ← barrel
├── player.ts
├── playerUse.ts              ← split from main.ts
├── pro.ts
├── questData.ts
├── questLog.ts
├── render/                   ← split from renderer.ts + webglrenderer.ts
│   ├── camera.ts
│   ├── webglContext.ts
│   ├── webglDraw.ts
│   └── webglLighting.ts
├── renderer.ts               ← slim Renderer base class + barrel
├── saveload.ts
├── scripting/                ← split from scripting.ts
│   ├── animBatch.ts
│   ├── dialogue.ts
│   ├── lifecycle.ts
│   ├── perception.ts
│   ├── runtime.ts
│   └── Script.ts
├── scripting.ts              ← barrel
├── skills.ts
├── skills/                   ← split from skillUse.ts
│   ├── skillUse.ts
│   └── skillUseShared.ts
├── skillUse.ts               ← barrel
├── soundMap.ts
├── tile.ts
├── transpiler.ts
├── ui/                       ← split from ui_font.ts (font primitives)
│   ├── fontCore.ts
│   └── numberDials.ts
├── ui.ts                     ← unchanged barrel
├── ui_automap.ts
├── ui_barter/                ← split from ui_barter.ts
│   ├── screen.ts
│   └── swap.ts
├── ui_barter.ts              ← barrel
├── ui_calledshot.ts
├── ui_character/             ← split from ui_character.ts
│   ├── creator.ts
│   ├── descriptions.ts
│   ├── perkModal.ts
│   └── viewer.ts
├── ui_character.ts           ← barrel
├── ui_charactercreator.ts
├── ui_components.ts
├── ui_contextmenu.ts
├── ui_dialogue.ts
├── ui_drag.ts
├── ui_elevator.ts
├── ui_font.ts                ← thin barrel + default Font instances
├── ui_hud.ts
├── ui_inventory/             ← split from ui_inventory.ts
│   ├── dragdrop.ts
│   └── panel.ts
├── ui_inventory.ts           ← barrel
├── ui_loot.ts
├── ui_mainmenu.ts
├── ui_options/               ← split from ui_options.ts
│   └── preferences.ts
├── ui_options.ts             ← panel + barrel
├── ui_panels.ts
├── ui_pipboy/                ← split from ui_pipboy.ts
│   ├── shell.ts
│   └── tabs/                 ← only nested subfolder in the proposal
│       ├── archives.ts
│       ├── automaps.ts
│       └── status.ts
├── ui_pipboy.ts              ← barrel
├── ui_saveload.ts
├── ui_skilldex.ts
├── ui_timer.ts
├── ui_unarmed.ts
├── ui_widget.ts
├── ui_worldmap.ts
├── unarmed.ts
├── util.ts
├── vm.ts
├── vm_bridge.ts
├── webglrenderer.ts          ← slim WebGLRenderer class + barrel
├── worldmap/                 ← split from worldmap.ts
│   ├── encounters.ts
│   ├── parser.ts
│   ├── types.ts
│   └── Worldmap.ts
└── worldmap.ts               ← barrel
```

### Cross-folder import rules

- Inside a subfolder, siblings import each other with relative paths:
  `import { foo } from './otherSibling.js'`.
- Sub-files reaching **outside** their folder go up one level:
  `import { Obj } from '../object.js'` (the barrel) — **not**
  `'../object/Obj.js'`, unless there's a documented reason to bypass the
  barrel.
- Bypassing the barrel is a code-smell warranting a review note. The two
  expected cases are (a) inside the `object/` cluster (`Critter.ts` imports
  `Obj.ts` directly to avoid a self-cycle through the barrel), and
  (b) inside `combat/` (`damage.ts` imports `Critter` from
  `'../object/Critter.js'` rather than the barrel to dodge the
  `combat → object → critter → combat` cycle).
- The barrel file itself never imports from outside its own folder
  besides type-only imports needed for re-exports.

### Pros / cons of subfolders (rationale)

**Pros**

- **Tree-view navigation.** ~135 files flat is unworkable; grouped is
  immediately scannable.
- **Mirror CODEBASE.md grouping.** Readers can move between the wiki map
  and the source tree without translation.
- **Encodes ownership.** Files inside `scripting/` are clearly part of the
  scripting subsystem; no need to memorise prefixes.
- **Makes "do not bypass the barrel" a structural cue,** not a stylistic
  rule. A relative `../object/Critter.js` import visibly reaches across a
  seam.
- **Easier to apply patterns like `index.ts` later** if we ever want them
  (we don't propose them yet — the barrel-at-the-old-path scheme avoids
  needing them).

**Cons (and mitigations)**

- **Import-path churn.** Every existing site that imports a *sub-file*
  would need updating. Mitigation: the barrel-at-the-old-path scheme means
  **no existing import site changes**. Only new code or deliberate
  internal-access sites use the subfolder paths.
- **Two-level depth in the tree.** Mitigated by the "no nested subfolders
  unless justified" rule. The only nested case is
  `src/ui_pipboy/tabs/`, where it's natural (the three tabs share a
  shell.ts parent).
- **`git mv` history is messier than a flat layout.** Mitigated by
  splitting **exactly** along whole-block boundaries inside a single
  commit per file (so `git log --follow` works for any sub-file).
- **TypeScript module-resolution latency** for deep paths is theoretical;
  the project compiles with strict mode and a flat `outDir: js/`. No
  measurable impact expected.

### Files that **don't** get a subfolder

Files that aren't being split keep their current top-level path. Specifically:
`audio.ts`, `aiPackets.ts`, `char.ts`, `config.ts`, `data.ts`, `debug.ts`,
`drugs.ts`, `eventlog.types.ts`, `events.ts`, `gametime.ts`,
`globalState.ts`, `heart.ts`, `idbcache.ts`, `images.ts`, `init.ts`,
`intfile.ts`, `lighting.ts`, `logger.ts`, `party.ts`, `player.ts`,
`pro.ts`, `questData.ts`, `questLog.ts`, `saveload.ts`, `skills.ts`,
`soundMap.ts`, `tile.ts`, `transpiler.ts`, `ui_automap.ts`,
`ui_calledshot.ts`, `ui_charactercreator.ts`, `ui_components.ts`,
`ui_contextmenu.ts`, `ui_dialogue.ts`, `ui_drag.ts`, `ui_elevator.ts`,
`ui_hud.ts`, `ui_loot.ts`, `ui_mainmenu.ts`, `ui_panels.ts`,
`ui_saveload.ts`, `ui_skilldex.ts`, `ui_timer.ts`, `ui_unarmed.ts`,
`ui_widget.ts`, `ui_worldmap.ts`, `unarmed.ts`, `util.ts`, `vm.ts`,
`vm_bridge.ts`. The `formats/` subfolder is pre-existing and untouched.

### Migration impact at every phase checkpoint

After each phase in the execution order, the import surface is:

- Phase 1 done → 6 barrels exist; everything still imports from the old
  flat path.
- Phase 2 done → render layer barrels exist; `from './renderer.js'` and
  `from './webglrenderer.js'` still work.
- Phase 3 done → UI barrels exist; no panel call site needs updating.
- … and so on through Phase 8.

At **no point** during the rollout do the existing import sites compile
because a file moved. Every import is shielded by a barrel until a
deliberate later cleanup pass (out of scope for this refactor) decides
to inline the sub-file paths at call sites.

---

## Per-file split proposals

### 1. `src/scripting.ts` — 2614 lines → 6 modules

**Current responsibilities (single `export module Scripting`):**

| Concern | Approx. line range |
|---------|--------------------|
| Imports, debug helpers (`stub`/`log`/`warn`/`info`), seed | 1–155 |
| GVAR/MVAR storage + (de)serialization | 156–220 |
| Object/spatial type guards, message-file loader | 220–270 |
| Dialogue runtime: `dialogueReply`, `dialogueEnd`, `reenterDialogue`, `getDialogueOptionCount` | 270–325 |
| Perception helpers (`canSee`, `isWithinPerception`, `objCanSeeObj`) | 325–390 |
| `Script` class — ~160 opcode methods + dialogue opcodes (`metarule`, `metarule3`, `has_trait`, `obj_*`, `tile_*`, `gsay_*`, `reg_anim_*`, etc.) | 396–2168 |
| Module-level "lifecycle" exports (`loadScript`, `loadScriptBySid`, `initScript`, `enterMap`, `updateMap`, `timedEvent`, `use`, `talk`, `spatial`, `destroy`, `damage`, `useSkillOn`, `pickup`, `drop`, `useObjOnMe`, `combatEvent`, `objectEnterMap`, `reset`, `init`, `give_exp_points`) | 2170–2614 |

**Constraint from CLAUDE.md:** _"All new scripting opcodes go in src/scripting.ts
inside the Script class."_ → opcode bodies must stay on `Script`. The split
therefore moves **only**: helpers, dialogue runtime, perception helpers,
lifecycle entry points, and module state — **never** the `Script` methods
themselves.

**Proposed split (all under `src/scripting/` directory; `src/scripting.ts`
becomes a barrel re-export):**

| New file | Owns | Exports |
|----------|------|---------|
| `src/scripting/Script.ts` | The `Script` class — every opcode intrinsic stays here verbatim. | `Script`, `ScriptableObj`, `SerializedScript` (re-exported by the barrel) |
| `src/scripting/runtime.ts` | Module state: `globalVars`, `mapVars`, `timeEventList`, `currentDialogueObject`, `mapFirstRun`, `currentMapID`, `currentMapObject`, `scriptMessages`, plus the `loadMessageFile` helper and `getScriptMessage`. | Internal-only globals plus accessors. |
| `src/scripting/dialogue.ts` | Dialogue runtime: `dialogueReply`, `dialogueEnd`, `dialogueExit`, `reenterDialogue`, `getDialogueOptionCount`, `dialogueBarterMod`, `getDialogueBarterMod`. | Dialogue lifecycle functions. |
| `src/scripting/perception.ts` | `canSee`, `isWithinPerception`, `objCanSeeObj` — pure helpers consumed by `obj_can_see_obj`/`obj_can_hear_obj` opcode methods on `Script` (which keep their bodies but call these helpers). | Three pure functions. |
| `src/scripting/lifecycle.ts` | Module entry points used by the engine loop: `loadScript`, `loadScriptBySid`, `registerStub`, `registerStubBySid`, `initScript`, `enterMap`, `objectEnterMap`, `updateMap`, `timedEvent`, `use`, `talk`, `spatial`, `destroy`, `damage`, `useSkillOn`, `pickup`, `drop`, `useObjOnMe`, `combatEvent`, `setMapScript`, `reset`, `init`, `give_exp_points`. | All current `export function`s that aren't dialogue-specific. |
| `src/scripting/animBatch.ts` | The `reg_anim_*` batch infrastructure: `AnimStep` / `AnimFunc` / `AnimEntry` types, `animBatch` module state, and the `reg_anim_end` queue drain logic. Opcode bodies on `Script` (`reg_anim_begin/end/animate/func/animate_forever`) keep their bodies but call this module for storage / drain. | `animBatch` accessor, `enqueueAnimStep`, `enqueueAnimFunc`, `drainAnimBatch`. |

`src/scripting.ts` becomes a thin barrel:

```ts
// Augments the Scripting namespace by re-exporting from sub-files.
export { Scripting } from './scripting/Script.js'
// (re-exports of public functions from runtime/dialogue/perception/lifecycle)
```

**Sizes after split (estimate):**
`Script.ts` ≈ 1700 lines (still over 400, but mandated by CLAUDE.md);
`runtime.ts` ≈ 130; `dialogue.ts` ≈ 90; `perception.ts` ≈ 80;
`lifecycle.ts` ≈ 420; `animBatch.ts` ≈ 60.

**Note on `Script.ts`:** even after every helper move, the opcode body file
stays large because every FO2 intrinsic lives there per CLAUDE.md. It is the
**only** intentional > 400-line file in the proposal. A future follow-up
could organise the opcode methods by category (dialogue, inventory, anim,
tile, metarule) using `///` region markers without moving them.

**Circular-dependency risks:**
- `scripting/Script.ts` already imports `combat`, `endgame`, `worldmap`,
  `main` — splitting changes nothing at the import-graph level because
  internal sub-files import from each other via the `./scripting/` prefix
  rather than touching siblings outside the namespace.
- `dialogue.ts` calls `uiEndDialogue` / `uiStartDialogue` from `./ui.js`;
  same module set as today.
- The barrel keeps `Scripting.*` references working for every existing
  import site.

---

### 2. `src/object.ts` — 2208 lines → 5 modules

**Current responsibilities:**

| Concern | Approx. line range |
|---------|--------------------|
| Helpers + free functions (`cloneItem`, `objectSwapItem`, `objectGetDamageType`, dynamite arming, `setObjectOpen`, `toggleObjectOpen`, `objectUnjamAll`, `objectFindIndex`, `objectZCompare`, `objectZOrder`, `zsort`) | 41–250 |
| `SerializedObj` interface | 251–283 |
| `Obj` base class (lifecycle, inventory, `blocks`/`pathBlocks`, `use`, `explode`, `pickup`, `drop`, `serialize`) | 283–1088 |
| `Item` / `WeaponObj` / `Scenery` / `Door` subclasses | 1089–1200 |
| Factory functions (`createObjectWithPID`, `objFromMapObject`, `deserializeObj`) | 1202–1259 |
| `Critter` class (≈ 720 lines) — animation state machine, FRM frame lookup, equipped armor/skill accessors, walking, weapon-swap anim, art-offset zero-jump model, serialize | 1260–2110 |
| `animInfo` table, FRM lookup helpers (`hitSpatialTrigger`, `getAnimPartialActions`, `getAnimDistance`, `PartialAction`) | 2111–2208 |

**Proposed split:**

| New file | Owns | Exports |
|----------|------|---------|
| `src/object/Obj.ts` | The `Obj` base class — lifecycle, inventory math, blocking predicates, explode/use/drop/pickup, serialize, `SerializedObj`. | `Obj`, `SerializedObj` |
| `src/object/items.ts` | `Item` (already private), `WeaponObj` (incl. `approxEq` ammo-state comparison), `Scenery`, `Door` subclasses. | `WeaponObj` |
| `src/object/factories.ts` | `createObjectWithPID`, `objFromMapObject`, `deserializeObj`, `cloneItem`. | Factory functions. |
| `src/object/Critter.ts` | The `Critter` class **excluding** the animation state machine — combat/skill/armor accessors (`getStat`, `getSkill`, `getArmorDR`, `getArmorAC`, `hasPerk`, etc.), `walkTo` / `walkInFrontOf`, `move`, `serialize`. | `Critter`, `SerializedCritter` |
| `src/object/critterAnimation.ts` | The FRM animation state machine carved out of `Critter` — `getAnimation`, `getBase`, `staticAnimation`, `singleAnimation`, `playWeaponSwapAnim`, `clearAnim`, `updateStaticAnim`, `updateLoopingAnim`, `updateAnim`, plus the `animInfo` table, `getAnimPartialActions`, `getAnimDistance`, `hitSpatialTrigger`, `PartialAction`. Methods stay on `Critter` via TypeScript's "declaration merging" — each is implemented as a free function that takes a `Critter` and is then assigned to `Critter.prototype` from the barrel. | Free functions plus prototype patches. |

`src/object.ts` becomes a barrel re-exporting `Obj`, `Critter`, `WeaponObj`,
`createObjectWithPID`, `objFromMapObject`, `deserializeObj`,
`objectGetDamageType`, `objectUnjamAll`, and the (currently private) zsort
helpers needed by `renderer.ts`.

**Sizes after split (estimate):**
`Obj.ts` ≈ 380; `items.ts` ≈ 110; `factories.ts` ≈ 80;
`Critter.ts` ≈ 380; `critterAnimation.ts` ≈ 480 (still over 400; could be
further split into `critterAnimation/static.ts` + `critterAnimation/walk.ts`
in a follow-up).

**Circular-dependency risks (high):**
- `object.ts` and `critter.ts` currently form a two-cycle (each imports
  from the other). The split must keep all the `Critter`-internal helper
  classes (`Weapon` for example) in their current home. Specifically,
  `Weapon` continues to live in `src/critter.ts` (not `object/Critter.ts`).
- `critterAnimation.ts` accesses `Obj` properties — it should import
  `Obj` from `./Obj.js` directly, not from `../object.js`, to avoid a cycle
  through the barrel.
- The `walkTo` method calls `globalState.gMap.recalcPath`, which is fine.
- `Critter.serialize` references `SERIALIZED_CRITTER_PROPS` — keep that
  table next to `Critter.ts`.

---

### 3. `src/ui_character.ts` — 2095 lines → 4 modules

**Current responsibilities:**

| Concern | Approx. line range |
|---------|--------------------|
| Description tables (SPECIAL/SKILL/DERIVED/CONDITION/TRAIT/PERK descriptions, image paths, karma titles) | 36–250 |
| `getCharacterWindow`, `closeCharacterScreen` | 275–287 |
| `showCharacterScreen` — in-game character screen viewer | 288–1000 |
| `showCharacterCreator` — character creation flow (name/age/sex, SPECIAL point-buy, traits, tag skills) | 1002–1870 |
| `showPerkModal` — perk-selection modal triggered on level-up | 1875–2095 |

**Proposed split (all under `src/ui_character/`):**

| New file | Owns | Exports |
|----------|------|---------|
| `src/ui_character/descriptions.ts` | All description / image / karma-title lookup tables. Pure data. | Named constants. |
| `src/ui_character/viewer.ts` | `showCharacterScreen` and helpers it uniquely needs (the in-game character screen viewer). | `showCharacterScreen`, `closeCharacterScreen`, `getCharacterWindow`. |
| `src/ui_character/creator.ts` | `showCharacterCreator` and creation-flow helpers (name/age/sex panels, trait picker, tag skill picker, point-buy). | `showCharacterCreator`. |
| `src/ui_character/perkModal.ts` | `showPerkModal` and its filtering / requirement-check helpers. | `showPerkModal`. |

`src/ui_character.ts` becomes a barrel.

**Sizes after split (estimate):**
`descriptions.ts` ≈ 230; `viewer.ts` ≈ 720 (still over but mostly DOM layout);
`creator.ts` ≈ 870; `perkModal.ts` ≈ 220.

**Follow-up note:** `viewer.ts` and `creator.ts` share considerable widget
plumbing (info-card panel, stat sliders, skilldex tabs). A future second pass
could lift `infoCard.ts` / `statSliderRow.ts` shared widgets, dropping both
viewer and creator under 400. Out of scope for this first pass — the goal here
is the major seam split, not the long tail.

**Circular-dependency risks (low):** all imports are downstream (Widget,
WindowFrame, fonts, perks, char, events). No risk.

---

### 4. `src/combat.ts` — 1694 lines → 5 modules

**Current responsibilities:**

| Concern | Approx. line range |
|---------|--------------------|
| Debug helpers, `actorName`, `isCombatActive` | 42–58 |
| `ActionPoints` class (AP accounting) | 59–127 |
| `AI` class (combat-time AI state for a critter) | 129–148 |
| Critical-fail table-type dispatch (`getCritFailTableType`, `aiHaveAmmo`) | 150–169 |
| `DamageCalculationContext` + 4 damage-formula variants (`computeDamageVanilla`, `computeDamageGlovz`, `computeDamageGlovzTweak`, `computeDamageYaam`, `computeDamage`) | 171–259 |
| `fleeHpThreshold`, `HP_FLEE_PCT` | 261–274 |
| `Combat` class — turn flow, hit chance, damage pipeline, attack execution, AI turn dispatch (`doAITurn`), `perish`, taunts, target selection, LoS, range checks | 276–1694 |

**Proposed split:**

| New file | Owns | Exports |
|----------|------|---------|
| `src/combat/actionPoints.ts` | `ActionPoints` class. | `ActionPoints`. |
| `src/combat/AI.ts` | `AI` class plus AI helpers `findTarget`, `fleeHpThreshold`, `HP_FLEE_PCT`, `maybeTaunt`, `getCombatAIMessage` (currently on `Combat`). `Combat.doAITurn` stays on `Combat` but calls these helpers. | `AI`, plus a small `AITargetingContext` interface. |
| `src/combat/damage.ts` | All four damage-formula variants plus `DamageCalculationContext` and the dispatcher `computeDamage`. Pure functions. | `computeDamage`, the variants for unit testing. |
| `src/combat/hitChance.ts` | The hit-chance & to-hit pipeline: `getHitChance`, `getHitDistanceModifier`, `getAmmoStats`, `accountForPartialCover`. Lifted to free functions taking `(attacker, target, ...)`. `Combat` keeps wrapper methods that delegate. | `getHitChance`, helpers. |
| `src/combat/Combat.ts` | The `Combat` class itself — constructor, `nextTurn`, `attack`, `rollHit`, `getDamageDone`, `getUnarmedDamageDone`, `perish`, `end`, `forceEnd`, `forceTurn`, `walkUpTo`, `doAITurn`, `hasLineOfSight`, `checkRangedMiss`. | `Combat`, `combatDebug`, `combatWarn`, `isCombatActive`. |

`src/combat.ts` becomes a barrel.

**Sizes after split (estimate):**
`actionPoints.ts` ≈ 90; `AI.ts` ≈ 220; `damage.ts` ≈ 100;
`hitChance.ts` ≈ 200; `Combat.ts` ≈ 950 (still > 400; see note).

**Note on `Combat.ts`:** even after the carve-out it remains large because
`doAITurn` alone is ~360 lines (distance-mode dispatch, weapon-mode loop,
range-charge logic). A follow-up could lift `doAITurn` into `combat/aiTurn.ts`
operating on a `Combat` context object. Out of scope for the first pass.

**Circular-dependency risks (medium):**
- `Combat.ts` will keep importing `Critter`, `Player`, `Obj` from `object.js`
  and `critterDamage` / `critterKill` from `critter.js`. Sibling files
  (`damage.ts`, `hitChance.ts`) should import `Critter` from `../object.js`
  directly to avoid a cycle through `Combat.ts`.
- `AI.ts` imports `aiPackets.ts` — already isolated, no cycle risk.

---

### 5. `src/main.ts` — 1279 lines → 4 modules

**Current responsibilities:**

| Concern | Approx. line range |
|---------|--------------------|
| Imports, module state (`nextMapUpdateTick`, `lastMidnightDay`) | 1–80 |
| Skill ID mapping (`getSkillID`), skill-use dispatch (`playerUseSkill`), skill-target cancel (`cancelSkillTargeting`) | 82–166 |
| `playerUse` — the giant unified "use that object" router (≈ 800 lines, includes context-menu walk-up, combat AP checks, container loot, dialogue triggers, every interaction path) | 168–970 |
| `changeCursor` (no-op stub) | 971–977 |
| Heart hook attachments: `heart.mousepressed` (≈ 60 lines), `heart.mousereleased`, `heart.mousemoved` (≈ 55 lines), `heart.keydown` (≈ 230 lines), `heart.keyup` | 619–981 |
| Per-tick game loop (`heart.update`, ~230 lines): mouse-edge scroll, midnight queue, poison/radiation/addiction ticks, map_update_p_proc cadence, wander | 982–1213 |
| Per-frame draw loop (`heart.draw`, ~13 lines): renderer.render() wrapper | 1215–1226 |
| Status helpers (`applyRadiationSymptoms`), `useElevator` | 1227–1278 |

**Proposed split:**

| New file | Owns | Exports |
|----------|------|---------|
| `src/main.ts` | Boot path only: imports, `initGame` wiring, `useElevator`, the module-level `nextMapUpdateTick` / `lastMidnightDay` state, and the `heart.update` / `heart.draw` assignments. Becomes ≈ 250 lines. | `playerUse`, `useElevator` (kept for the existing import site in `scripting.ts`). |
| `src/playerUse.ts` | `playerUse(obj)` plus `playerUseSkill`, `cancelSkillTargeting`, `getSkillID`. The router for object/critter interactions, lifted whole. | `playerUse`, `playerUseSkill`, `cancelSkillTargeting`. |
| `src/input.ts` | Mouse + keyboard handlers: the bodies of `heart.mousepressed`, `heart.mousereleased`, `heart.mousemoved`, `heart.keydown`, `heart.keyup`. Imports of `playerUse` and `globalState`. Side-effect module: importing it attaches handlers to `heart`. | Side-effect `installInputHandlers()` invoked once from `main.ts`. |
| `src/gameTick.ts` | The `heart.update` body — float-message expiry, mouse-edge scroll, FPS overlay, midnight queue, timed events, `map_update_p_proc` cadence, poison/radiation ticks, party follow, wander. Plus `applyRadiationSymptoms` helper. | `tickGame()` invoked from `heart.update`. |

`src/main.ts` becomes the thin orchestrator that calls `installInputHandlers()`
and assigns `heart.update = tickGame`, `heart.draw = drawFrame` (which could
in turn live in a tiny `src/drawFrame.ts` but isn't worth splitting at
13 lines).

**Sizes after split (estimate):**
`main.ts` ≈ 100; `playerUse.ts` ≈ 810 (still > 400 — see note);
`input.ts` ≈ 270; `gameTick.ts` ≈ 230.

**Note on `playerUse.ts`:** the unified router is intrinsically a switch on
object type, cursor mode, and UI mode. A follow-up could split it into
`playerUseCritter.ts` / `playerUseItem.ts` / `playerUseScenery.ts` after
mapping the per-branch behaviour, but that's a deeper refactor not warranted
by a first pass.

**Circular-dependency risks (medium):**
- `playerUse.ts` currently imports `Skills`, `skillUse`, `Combat`,
  `Scripting`, `Critter`, `uiLog`, `getProtoMsg`, `hexFromScreen`,
  `getZoom` — all downstream, no cycle.
- `input.ts` will need `playerUse` and `cancelSkillTargeting` from
  `playerUse.ts` — straight downstream. No cycle.
- `gameTick.ts` calls `Scripting.timeEventList` and `Lightmap.rebuildLight`
  — fine.
- `useElevator` keeps living in `main.ts` because `scripting.ts` already
  imports it from `./main.js`. Moving it would force a hop in `scripting.ts`'s
  imports.

---

### 6. `src/webglrenderer.ts` — 1161 lines → 3 modules

**Current responsibilities:**

| Concern | Approx. line range |
|---------|--------------------|
| `ShaderSources` interface | 15–21 |
| `WebGLRenderer` constructor + texture/program/shader plumbing (`newTexture`, `getTexture`, `textureFromArray`, `textureFromColorArray`, `textureFromFont`, `init`, `rectangleBuffer`, `getShader`, `getProgram`, `clear`, `resize`) | 22–840 |
| `renderText`, `renderImage`, `renderFont` — text/image drawing | 480–495, 1135–1160 |
| Floor lighting: `renderLitFloorCPU`, `renderLitFloorGPU`, `invalidateFloorFBO`, `clearTileCache`, `setLightingMode` | 496–1037 |
| Object/tile/roof drawing: `drawTileMap`, `renderRoof`, `renderFloor`, `renderObject`, `renderObjectOutlined`, `renderFrame` | 901–1135 |

**Proposed split:**

| New file | Owns | Exports |
|----------|------|---------|
| `src/render/webglContext.ts` | `WebGLRenderer` core: constructor, `init`, shader/program/texture plumbing, `clear`, `resize`, `rectangleBuffer`, `setLightingMode`, `invalidateFloorFBO`, `clearTileCache`. | The `WebGLRenderer` class shell (no draw methods). |
| `src/render/webglLighting.ts` | `renderLitFloorCPU`, `renderLitFloorGPU` as free functions taking a `WebGLRenderer` context plus `TileMap`. | Pure floor-lighting functions. |
| `src/render/webglDraw.ts` | `drawTileMap`, `renderRoof`, `renderFloor`, `renderObject`, `renderObjectOutlined`, `renderFrame`, `renderImage`, `renderText`, `renderFont`. | Pure draw functions taking a `WebGLRenderer` context. |

`src/webglrenderer.ts` becomes a barrel + a `WebGLRenderer` class declaration
that imports the draw / lighting / context functions and assigns them onto
the prototype.

**Sizes after split (estimate):**
`webglContext.ts` ≈ 360; `webglLighting.ts` ≈ 360; `webglDraw.ts` ≈ 360.

**Circular-dependency risks (low):**
- All three new files import `Renderer` from `./renderer.js` — no cycle.
- `webglDraw.ts` imports `Obj` from `./object.js`; same as today.
- `webglLighting.ts` imports `Lightmap` and `Lighting` — same as today.

---

### 7. `src/autocrawler.ts` — 903 lines → 4 modules

**Current responsibilities:**

| Concern | Approx. line range |
|---------|--------------------|
| Status enums + result interfaces (`DialogueStatus`, `CombatStatus`, `MapStatus`, `MapResult`, `DialogueNpcResult`, `CombatCritterResult`, `CrawlerSummary`, `CrawlerReport`) | 29–110 |
| Timeouts, polling constants, `CRAWLER_HP` | 113–122 |
| Shared helpers (`stepEngine`, `critterDisplayName`, `movePlayerAdjacent`, `getOptionElements`, `getReplyText`, `isExitOption`, `EXIT_OPTION_PATTERNS`, `listTalkableNPCs`, `listHostileCritters`) | 132–224 |
| Dialogue crawler (`crawlOneNpc`, `runDialogueCrawler`) | 225–453 |
| Combat crawler (`crawlOneCritter`, `runCombatCrawler`) | 454–668 |
| Map crawler (`discoverMapNames`, `crawlOneMap`, `runMapCrawler`) | 669–803 |
| Report builder, summary printer, `downloadReport` | 804–903 |

**Proposed split (all under `src/autocrawler/`):**

| New file | Owns | Exports |
|----------|------|---------|
| `src/autocrawler/types.ts` | All status enums and result interfaces. Pure types. | Type-only exports. |
| `src/autocrawler/shared.ts` | Constants, `stepEngine`, `critterDisplayName`, `movePlayerAdjacent`, dialogue DOM helpers, `listTalkableNPCs`, `listHostileCritters`. | Shared helpers. |
| `src/autocrawler/dialogue.ts` | `crawlOneNpc`, `runDialogueCrawler`. | Crawler entry point. |
| `src/autocrawler/combat.ts` | `crawlOneCritter`, `runCombatCrawler`. | Crawler entry point. |
| `src/autocrawler/maps.ts` | `discoverMapNames`, `crawlOneMap`, `runMapCrawler`. | Crawler entry point. |
| `src/autocrawler/report.ts` | `buildReport`, `printSummary`, `downloadReport`. | Report serialisation. |

That's 6 sub-files; per the overview table I scored this "4" because dialogue
+ combat + maps + (shared/report/types as one) is the minimum count, but
6 finer-grained files keeps each under 200 lines.

**Sizes after split (estimate):** all sub-files ≈ 100–230 lines.

`src/autocrawler.ts` becomes a barrel re-exporting `runDialogueCrawler`,
`runCombatCrawler`, `runMapCrawler`, `listTalkableNPCs`, `listHostileCritters`,
`downloadReport`. Currently `main.ts` does `import './autocrawler.js'` as a
side-effect import — that path keeps working through the barrel.

**Circular-dependency risks (low):** crawlers depend on `Scripting`, `Combat`,
`globalState`, `UIMode` — all downstream.

---

### 8. `src/ui_inventory.ts` — 780 lines → 2 modules

**Current responsibilities:**

| Concern | Approx. line range |
|---------|--------------------|
| DOM helpers (`$id`, `clearEl`, `showv`, `hidev`, `makeEl`), drag/drop helpers (`makeDropTarget`, `makeDraggable`) | 34–122 |
| `closeInventory`, `initInventory` (panel setup) | 123–180 |
| `tryLoadAmmoIntoWeapon` — ammo-state-aware reload | 181–204 |
| `uiMoveSlot` — drag-to-equip / inventory-to-slot transfers with `pickup_p_proc` firing | 205–283 |
| `applyArmorArt` — armor sprite swap | 284–312 |
| `showInventory` — main panel render (≈ 470 lines): inventory list, weapon section, weight bar, sort dropdown, armor section | 313–780 |

**Proposed split:**

| New file | Owns | Exports |
|----------|------|---------|
| `src/ui_inventory/dragdrop.ts` | DOM/drag helpers + `uiMoveSlot` + `tryLoadAmmoIntoWeapon` + `applyArmorArt`. Inventory transfer mechanics. | `makeDropTarget`, `makeDraggable`, `uiMoveSlot`, `applyArmorArt`. |
| `src/ui_inventory/panel.ts` | `closeInventory`, `initInventory`, `showInventory`. The panel itself. | `closeInventory`, `initInventory`, `showInventory`. |

`src/ui_inventory.ts` becomes a barrel.

**Sizes after split (estimate):** `dragdrop.ts` ≈ 300; `panel.ts` ≈ 480.

**Note:** `panel.ts` remains slightly over 400 — `showInventory` is a single
~470-line DOM build that doesn't decompose cleanly without a deeper refactor
to per-section helpers. Out of scope.

**Circular-dependency risks (low):** `dragdrop.ts` imports `Scripting` for
`pickup`, `panel.ts` imports from `dragdrop.ts`. No cycle.

---

### 9. `src/map.ts` — 759 lines → 2 modules

**Current responsibilities (single `GameMap` class):**

| Concern | Approx. line range |
|---------|--------------------|
| `SerializedMap`, `SerializedSpatial` interfaces | 36–62 |
| Object-list accessors, addObject/removeObject, removal queue (`drainRemovalQueue`), destroyObject | 63–144 |
| `hasRoofAt`, `isOutdoor`, `updateMap`, `doEnterElevation`, `changeElevation`, `placeParty`, `doEnterNewMap` | 144–363 |
| `loadMap`, `loadNewMap`, `loadMapByID` — map IO + cache | 364–608 |
| Tile-level helpers (`objectsAtPosition`, `critterAtPosition`, `hexLinecast`, `recalcPath`) | 609–681 |
| `serialize` / `deserialize` | 683–759 |

**Proposed split:**

| New file | Owns | Exports |
|----------|------|---------|
| `src/map/GameMap.ts` | The `GameMap` class **minus** the loaders. Object lists, elevation switch, party placement, removal queue, tile helpers, serialize/deserialize, `SerializedMap`, `SerializedSpatial`. | `GameMap`, `SerializedMap`, `SerializedSpatial`. |
| `src/map/mapLoader.ts` | `loadMap`, `loadNewMap`, `loadMapByID`, plus the JSON fetch path, dirty-cache handling, and the `doEnterNewMap` callout. Either becomes a free function `loadMapInto(gameMap, …)` or a `GameMap.prototype` extension via declaration merging. | `loadMap`, `loadMapByID`. |

`src/map.ts` becomes a barrel.

**Sizes after split (estimate):**
`GameMap.ts` ≈ 380; `mapLoader.ts` ≈ 380.

**Circular-dependency risks (low):** the loader needs `Scripting.enterMap` and
`Critter` — both already imported by `map.ts` today.

---

### 10. `src/worldmap.ts` — 757 lines → 3 modules

**Current responsibilities (single `export module Worldmap`):**

| Concern | Approx. line range |
|---------|--------------------|
| Square / Worldmap / EncounterTable / Encounter / EncounterRef / EncounterParty / EncounterGroup / Range / EncounterItem / EncounterCritter / EncounterPosition interfaces | 51–138 |
| `parseWorldmap` — `worldmap.txt` parser | 139–347 |
| `getEncounterGroup`, `getPlayerWorldPos`, `positionToSquare`, `setSquareStateAt`, `execEncounter`, `doEncounter`, `didEncounter`, `updateAreaMarkerPos`, `centerWorldmapTarget` | 348–528 |
| `init`, `start`, `stop`, `withinArea`, `updateWorldmapPlayer` — DOM lifecycle + travel loop | 530–757 |

**Proposed split (all augmenting the same `Worldmap` namespace):**

| New file | Owns | Exports |
|----------|------|---------|
| `src/worldmap/types.ts` | All interfaces (Encounter*, Square, Range, etc.) | Types only. |
| `src/worldmap/parser.ts` | `parseWorldmap` — the line-by-line `worldmap.txt` parser. | `parseWorldmap`. |
| `src/worldmap/Worldmap.ts` | Travel loop + DOM lifecycle: `init`, `start`, `stop`, `updateWorldmapPlayer`, `withinArea`, `centerWorldmapTarget`, `getPlayerWorldPos`, `setSquareStateAt`, `updateAreaMarkerPos`. | Public surface used by `ui.ts`. |
| `src/worldmap/encounters.ts` | Worldmap-side encounter dispatch: `getEncounterGroup`, `execEncounter`, `doEncounter`, `didEncounter`. (Not to be confused with `encounters.ts` which handles encounter table evaluation.) | Encounter dispatch. |

`src/worldmap.ts` becomes a barrel that augments the `Worldmap` namespace
across the four files (TypeScript supports merging a `namespace`/`module`
across files via re-export).

**Sizes after split (estimate):** all under 250.

**Circular-dependency risks (medium):**
- `Worldmap.encounters` imports `encounters.ts` (table eval) → no cycle.
- `Worldmap.encounters` also calls `Combat.start` and `globalState.gMap` —
  same imports as today.
- `parser.ts` is pure-string-in / typed-records-out, no game-state dep.

---

### 11. `src/perks.ts` — 747 lines → 2 modules

**Current responsibilities:**

| Concern | Approx. line range |
|---------|--------------------|
| `PerkDef` interface | 9–29 |
| `PERKS: PerkDef[]` — 60+ perk records | 34–688 |
| `getValidPerks`, `getPerkRank`, `applyPerk` | 691–747 |

**Proposed split:**

| New file | Owns | Exports |
|----------|------|---------|
| `src/perks/perks.data.ts` | `PerkDef` interface + the `PERKS` array. Pure data. | `PerkDef`, `PERKS`. |
| `src/perks/perks.ts` | `getValidPerks`, `getPerkRank`, `applyPerk`. | The three functions. |

`src/perks.ts` becomes a barrel.

**Sizes after split (estimate):** `perks.data.ts` ≈ 660 (data, kept as a single
file because it tracks `perk.cc gPerkDescription[]` order; splitting would
make the FO2-CE comparison harder); `perks.ts` ≈ 90.

**Note:** `perks.data.ts` stays over 400 — but it is **data**, not logic, and
no other proposal here splits a literal data table for size's sake. Mention
it as a known intentional outlier.

**Circular-dependency risks:** none — `perks.data.ts` has no imports;
`perks.ts` imports it plus `Player`. Same as today.

---

### 12. `src/ui_pipboy.ts` — 736 lines → 4 modules

**Current responsibilities:**

| Concern | Approx. line range |
|---------|--------------------|
| Tab type, screen constants, content-area constants, automap canvas constants, tab layout | 26–57 |
| Date/time bar with digit sprites (`makeDigit`, `getGameDate`, `renderDateTimeBar`) | 70–160 |
| Wait menu (`toggleWaitMenu`, `advanceTime`, `formatGameTime`) | 161–246 |
| Shared widget helpers (`makeHeader`, `makeRow`, `makeListItem`, `makeButton`, `clearScreen`, `makeContentArea`) | 247–306 |
| STATUS tab (`renderStatusTab`) | 307–346 |
| AUTOMAPS tab (`locationForMap`, `collectAutomapEntries`, `styleAutomapCanvas`, `createAutomapCanvas`, `renderAutomapsTab`) | 347–547 |
| ARCHIVES tab (`renderArchivesTab`) | 548–617 |
| Tab dispatch + public open/close/toggle (`renderTab`, `openPipBoy`, `closePipBoy`, `togglePipBoy`, `isPipBoyOpen`) | 618–736 |

**Proposed split (all under `src/ui_pipboy/`):**

| New file | Owns | Exports |
|----------|------|---------|
| `src/ui_pipboy/shell.ts` | Constants, tab dispatcher, public open/close/toggle, date/time bar, wait menu, shared widget helpers. | `openPipBoy`, `closePipBoy`, `togglePipBoy`, `isPipBoyOpen`. |
| `src/ui_pipboy/tabs/status.ts` | `renderStatusTab`. | `renderStatusTab`. |
| `src/ui_pipboy/tabs/automaps.ts` | AUTOMAPS tab (`renderAutomapsTab` + automap canvas helpers). | `renderAutomapsTab`. |
| `src/ui_pipboy/tabs/archives.ts` | `renderArchivesTab`. | `renderArchivesTab`. |

`src/ui_pipboy.ts` becomes a barrel re-exporting `openPipBoy`, `closePipBoy`,
`togglePipBoy`, `isPipBoyOpen`.

**Sizes after split (estimate):** `shell.ts` ≈ 280; `status.ts` ≈ 60;
`automaps.ts` ≈ 230; `archives.ts` ≈ 90.

**Circular-dependency risks (low):** tab files import `shell.ts` for the
shared widget helpers; shell imports no tab file (it dispatches via a
plain `switch` after lazy-importing the tab functions).

---

### 13. `src/critter.ts` — 670 lines → 2 modules

**Current responsibilities:**

| Concern | Approx. line range |
|---------|--------------------|
| Constants (`weaponSkins`, `weaponAnims`, `attackMode`, `damageType`, `attackModeToBaseSkill`, `BIG_GUN_ANIM_CODES`, `ENERGY_DAMAGE_TYPES`, `weaponSkillMap`) | 27–145 |
| `Weapon` class — proto data accessor, mode cycle, unarmed move progression, attack skins | 205–438 |
| `deathAnimForDamageType` | 445–455 |
| `critterKill` (death pipeline incl. karma, kill counts, animation selection) | 457–578 |
| `critterDamage` (damage application, knockback, status effects, hit animation) | 579–652 |
| `critterGetRawStat`/`critterSetRawStat`/`critterGetRawSkill`/`critterSetRawSkill` — dead code (only used inside file) | 654–670 |
| `killCounts: Map<number, number>` | 34 |
| `UnarmedMove` interface + `UNARMED_MOVES` table + `getAvailableUnarmedMoves` | 170–204 |

**Proposed split:**

| New file | Owns | Exports |
|----------|------|---------|
| `src/critter/Weapon.ts` | Weapon class, constants (`weaponSkins`, `weaponAnims`, `attackMode`, `damageType`, `attackModeToBaseSkill`, `BIG_GUN_ANIM_CODES`, `ENERGY_DAMAGE_TYPES`, `weaponSkillMap`, `parseAttack`, `getWeaponSkillFromPro`), `UnarmedMove`, `UNARMED_MOVES`, `getAvailableUnarmedMoves`. | `Weapon`, `UnarmedMove`, `UNARMED_MOVES`, `getAvailableUnarmedMoves`. |
| `src/critter/lifecycle.ts` | `critterKill`, `critterDamage`, `deathAnimForDamageType`, `killCounts`. | Public lifecycle helpers. |

Delete the dead `critterGetRawStat` / `critterSetRawSkill` quartet (only
referenced internally with `TODO` warnings).

`src/critter.ts` becomes a barrel.

**Sizes after split (estimate):** `Weapon.ts` ≈ 360; `lifecycle.ts` ≈ 220.

**Circular-dependency risks (medium):**
- `Weapon.ts` references the `Critter` and `WeaponObj` types — import them
  directly from `./object/Critter.js` / `./object/items.js` rather than from
  the `object.js` barrel to avoid a cycle through the barrel.
- `lifecycle.ts` calls `Scripting.destroy` + `endgame.setupDeathEnding` —
  same as today.

---

### 14. `src/skillUse.ts` — 651 lines → 2 modules

**Current responsibilities:**

| Concern | Approx. line range |
|---------|--------------------|
| Logging helpers (`rollName`, `logSkillHeader`, `logSkillRoll`, `logSkillXP`, `rollResultKey`, `emitSkillRoll`) | 19–84 |
| Usage limiter (3-use/day) — `SKILLS_MAX_USES_PER_DAY`, `usageSlots`, `getUsageSlots`, `hasFreeUsageSlot`, `recordUsage`, `resetSkillUsage` | 86–130 |
| `SKILL_XP` table, `SkillUseResult`, `makeResult` | 132–160 |
| `skillUse` dispatcher | 162–195 |
| Per-skill implementations: `useFirstAid`, `useDoctor`, `useSneak`, `useLockpick`, `useSteal`, `useTraps`, `useScience`, `useRepair` | 196–651 |

**Proposed split:**

| New file | Owns | Exports |
|----------|------|---------|
| `src/skills/skillUseShared.ts` | Logging helpers, usage limiter, `SKILL_XP`, `SkillUseResult`, `makeResult`. | Shared internals + the public types. |
| `src/skills/skillUse.ts` | `skillUse` dispatcher and the 8 per-skill implementations. | `skillUse`, `resetSkillUsage`, `SkillUseResult`. |

`src/skillUse.ts` becomes a barrel.

**Sizes after split (estimate):** `skillUseShared.ts` ≈ 150;
`skillUse.ts` ≈ 510 (still > 400, but each of the 8 skill bodies is small
enough that further splitting would add boilerplate without reducing complexity).

**Follow-up:** if needed, the 8 skill bodies could be moved into
`src/skills/firstAid.ts`, `src/skills/doctor.ts`, etc. The shape of each is
identical (function taking `(user, target?)` returning `SkillUseResult`), so
the file-per-skill split is mechanical. Out of scope for first pass.

**Circular-dependency risks:** none — all imports downstream.

---

### 15. `src/lightmap.ts` — 589 lines → 2 modules

**Current responsibilities (single `export module Lightmap`):**

| Concern | Approx. line range |
|---------|--------------------|
| `tile_intensity`, `staticTileIntensity` Int32Arrays | 37–42 |
| `light_offsets`, `light_distance` tables + `obj_adjust_light` (the big per-tile light propagation function, ~300 lines) | 43–370 |
| `obj_light_table_init` (the table generator, ~165 lines) | 371–533 |
| Public surface: `resetLight`, `rebuildLight`, `bakeStaticLight`, `rebuildDynamicLight`, `obj_rebuild_all_light`, `tile_num_in_direction` | 534–589 |

**Proposed split:**

| New file | Owns | Exports |
|----------|------|---------|
| `src/lightmap/lightTable.ts` | `light_offsets`, `light_distance`, `obj_light_table_init`, `tile_num_in_direction`, `isInit` flag — the static table-generation part. | Internal accessors for tables. |
| `src/lightmap.ts` | The remaining public Lightmap module: `tile_intensity`, `staticTileIntensity`, `obj_adjust_light`, `light_subtract_from_tile`, `light_add_to_tile`, `zeroArray`, `light_reset`, `obj_rebuild_all_light`, `resetLight`, `rebuildLight`, `bakeStaticLight`, `rebuildDynamicLight`. | Public Lightmap namespace. |

**Sizes after split (estimate):** `lightTable.ts` ≈ 200;
`lightmap.ts` (after carve) ≈ 380.

**Circular-dependency risks (low):** `lightTable.ts` is leaf — no game-state
deps.

---

### 16. `src/renderer.ts` — 566 lines → 2 modules

**Current responsibilities:**

| Concern | Approx. line range |
|---------|--------------------|
| `TileMap`, `ObjectRenderInfo` types | 34–55 |
| Screen-size + zoom + camera coord helpers (`setScreenSize`, `getZoom`, `screenToWorld`, `worldToScreen`, `getWorldViewWidth/Height`, `MAP_WORLD_BOUNDS`, `clampCameraPosition`, `centerCamera`) | 56–474 |
| `Renderer` abstract class (init/render shell, `addWindow`, `render`, `objectRenderInfo`, `renderObjects` with itemHighlight outline, draw method stubs) | 103–425 |
| Object screen-test / picking helpers (`objectOnScreen`, `objectTransparentAt`, `objectBoundingBox`, `getObjectUnderCursor`) | 475–566 |

**Proposed split:**

| New file | Owns | Exports |
|----------|------|---------|
| `src/render/camera.ts` | All camera/zoom/screen-coord helpers: `setScreenSize`, `getZoom`, `screenToWorld`, `worldToScreen`, `getWorldViewWidth/Height`, `MAP_WORLD_BOUNDS`, `clampCameraPosition`, `centerCamera`, `SCREEN_WIDTH`, `SCREEN_HEIGHT`, `ZOOM_MIN`, `ZOOM_MAX`. | Camera helpers. |
| `src/renderer.ts` | The remaining `Renderer` abstract class + object picking helpers (`objectOnScreen`, `objectTransparentAt`, `objectBoundingBox`, `getObjectUnderCursor`, `TileMap`, `ObjectRenderInfo`). | `Renderer`, picking helpers, types. |

**Sizes after split (estimate):** `camera.ts` ≈ 200;
`renderer.ts` (after carve) ≈ 380.

**Circular-dependency risks (low):** `camera.ts` is pure utility, no
game-state imports beyond `globalState` and `geometry`.

---

### 17. `src/ui_font.ts` — 543 lines → 2 modules

**Current responsibilities:**

| Concern | Approx. line range |
|---------|--------------------|
| `SymbolInfo` interface, `FontRenderer` class (font loading + glyph metrics) | 27–230 |
| `FontWidget` widget + `makeFontLabel` | 231–298 |
| `parseHexColor`, glyph-height cache, `renderBitmapText` — actual bitmap drawing | 277–447 |
| `setNumberDial`, `renderBignum` — number-sprite helpers (separate widget genres) | 448–540 |
| Default fonts (`font1` … `font4`) instantiation | 540–543 |

**Proposed split:**

| New file | Owns | Exports |
|----------|------|---------|
| `src/ui/fontCore.ts` | `SymbolInfo`, `SymbolInfoMap`, `FontRenderer`, `FontWidget`, `makeFontLabel`, `renderBitmapText`, `parseHexColor`, glyph-height cache. | Core font classes + the bitmap renderer. |
| `src/ui/numberDials.ts` | `setNumberDial`, `renderBignum`, the sprite-dimension constants. | Number-dial helpers (used by HUD HP/AC/AP and Pip-Boy clock). |

`src/ui_font.ts` keeps the default-font instantiations (`font1`–`font4`) and
becomes a barrel.

**Sizes after split (estimate):** `fontCore.ts` ≈ 410 (just over);
`numberDials.ts` ≈ 100; `ui_font.ts` ≈ 30.

**Circular-dependency risks:** none.

---

### 18. `src/automapData.ts` — 543 lines → 3 modules

**Current responsibilities:**

| Concern | Approx. line range |
|---------|--------------------|
| Constants (`LS_*`, `DB_*`, `REVEAL_RADIUS`) | 32–41 |
| `seenData`, `objectSnapshots` maps, `dirtyTiles`/`dirtyObjects` sets, `mapKey` helper | 43–67 |
| IndexedDB layer (`openDB`, `idbGetAll`, `idbPutBatch`, `loadFromLocalStorage`, `scheduleSave`, `flushPendingWrites`, `flushAutomapSave`) | 69–234 |
| Snapshot + query API (`snapshotCurrentMapObjects`, `getObjectSnapshot`, `getArchivedMaps`, `getSeenTiles`, `markSeenAt`, `initAutomapTracking`) | 235–346 |
| Canvas rendering (`renderAutomapCanvas`, `drawAutomapInto`, `RenderOptions`) | 347–543 |

**Proposed split:**

| New file | Owns | Exports |
|----------|------|---------|
| `src/automap/storage.ts` | IndexedDB layer + the legacy localStorage migration: `openDB`, `idbGetAll`, `idbPutBatch`, `loadFromLocalStorage`, `scheduleSave`, `flushPendingWrites`, `flushAutomapSave`, constants. | Storage primitives. |
| `src/automap/tracking.ts` | Map state: `seenData`, `objectSnapshots`, `dirtyTiles`/`dirtyObjects`, plus the query/mutation API (`snapshotCurrentMapObjects`, `getObjectSnapshot`, `getArchivedMaps`, `getSeenTiles`, `markSeenAt`, `initAutomapTracking`). | Public state API used by `ui_pipboy.ts` and `automapData.ts`. |
| `src/automap/render.ts` | `renderAutomapCanvas`, `drawAutomapInto`, `RenderOptions`. | Canvas renderer. |

`src/automapData.ts` becomes a barrel that re-exports the public surface
existing call sites use (`drawAutomapInto`, `getArchivedMaps`, `getSeenTiles`,
`getObjectSnapshot`, `flushAutomapSave`, `initAutomapTracking`, `markSeenAt`,
`snapshotCurrentMapObjects`, `ArchivedMap`, `RenderOptions`).

**Sizes after split (estimate):** `storage.ts` ≈ 180; `tracking.ts` ≈ 180;
`render.ts` ≈ 200.

**Circular-dependency risks (low):** all three new files are leaf w.r.t. game
state (no `Critter`/`Combat` deps).

---

### 19. `src/endgame.ts` — 536 lines → 3 modules

**Current responsibilities:**

| Concern | Approx. line range |
|---------|--------------------|
| Types + constants (`EndgameEnding`, `EndgameDeathEnding`, `PANNING_ART_NUM`, `SLIDE_W`/`SLIDE_H`, `DEATH_REASON_*`, `GVAR_MODOC_SHITTY_DEATH`) | 26–60 |
| Death-ending data loader (`loadDeathEndings`, `validateDeathEndings`, `setupDeathEnding`, `getDeathEndingFileName`) | 68–151 |
| Slide rendering primitives (`loadSubtitleLines`, `buildSubtitleTimings`, `playNarratorAudio`, `waitAudioDurationMs`, `createOverlay`, `removeOverlay`, `createSlideCanvas`, `createSubtitleDiv`, `fadeIn`, `fadeOut`, `scheduleSubtitles`, `loadImageToCanvas`, `showStaticSlide`, `showPanningSlide`) | 152–443 |
| Continue dialog (`showContinueDialog`) | 444–479 |
| Public sequences: `playSlideshow`, `playMovie`, `playDeathEnding` | 480–536 |

**Proposed split:**

| New file | Owns | Exports |
|----------|------|---------|
| `src/endgame/deathEndings.ts` | `EndgameDeathEnding`, `DEATH_REASON_*`, `GVAR_MODOC_SHITTY_DEATH`, `loadDeathEndings`, `validateDeathEndings`, `setupDeathEnding`, `getDeathEndingFileName`, state for the chosen death ending. | Death-ending API. |
| `src/endgame/slideRender.ts` | Slide rendering primitives (DOM overlay creation, narrator audio, subtitle scheduling, image load, fade in/out, static/panning slide play). | `showStaticSlide`, `showPanningSlide`, `createOverlay`, plus helpers. |
| `src/endgame.ts` | Public sequences (`playSlideshow`, `playMovie`, `playDeathEnding`), `EndgameEnding` interface, `showContinueDialog`, `PANNING_ART_NUM`, `SLIDE_W`/`SLIDE_H`. | Public surface used by `scripting.ts`. |

**Sizes after split (estimate):** `deathEndings.ts` ≈ 130;
`slideRender.ts` ≈ 240; `endgame.ts` ≈ 170.

**Circular-dependency risks (low):** `scripting.ts` already imports
`endgame.ts`; split doesn't change that.

---

### 20. `src/encounters.ts` — 519 lines → 2 modules

**Current responsibilities (single `export module Encounters`):**

| Concern | Approx. line range |
|---------|--------------------|
| AST node types + `tokenizeCond`, `parseCond`, `parseConds`, `printTree`, `evalCond`, `evalConds` — `worldmap.txt` encounter-condition expression parser | 42–243 |
| `evalEncounterCritter`, `evalEncounterCritters`, `pickEncounter`, `positionCritters`, `evalEncounter` — encounter resolution | 245–519 |

**Proposed split:**

| New file | Owns | Exports |
|----------|------|---------|
| `src/encounters/conditionLang.ts` | The expression parser + evaluator (`tokenizeCond`, `parseCond`, `parseConds`, `printTree`, `evalCond`, `evalConds` + AST types). | Parser/eval. |
| `src/encounters/resolver.ts` | Encounter resolution: `evalEncounterCritter`, `evalEncounterCritters`, `pickEncounter`, `positionCritters`, `evalEncounter`. | Resolution API. |

`src/encounters.ts` becomes a barrel augmenting the `Encounters` namespace.

**Sizes after split (estimate):** `conditionLang.ts` ≈ 220;
`resolver.ts` ≈ 280.

**Circular-dependency risks (low):** `conditionLang.ts` reads `globalState`
for `player(level)` / `time_of_day` — no cycle.

---

### 21. `src/ui_barter.ts` — 486 lines → 2 modules

**Current responsibilities:**

| Concern | Approx. line range |
|---------|--------------------|
| DOM helpers ($id, clearEl, off, makeEl) | 35–95 |
| `uiGetAmount` — count-picker modal | 98–207 |
| `_uiAddItem`, `uiSwapItem` — shared item-transfer primitives | 209–249 |
| `uiEndBarterMode`, `uiBarterMode` — main barter screen with CE-accurate value calculation | 253–486 |

**Proposed split:**

| New file | Owns | Exports |
|----------|------|---------|
| `src/ui_barter/swap.ts` | `_uiAddItem`, `uiSwapItem`, `uiGetAmount`, DOM helpers. The cross-list transfer primitives shared with `ui_loot.ts`. | `uiSwapItem`, `uiGetAmount`. |
| `src/ui_barter/screen.ts` | `uiBarterMode`, `uiEndBarterMode`. The barter screen itself. | `uiBarterMode`. |

`src/ui_barter.ts` becomes a barrel.

**Sizes after split (estimate):** `swap.ts` ≈ 240; `screen.ts` ≈ 250.

**Circular-dependency risks (low):** `screen.ts` imports `swap.ts` —
straight downstream.

---

### 22. `src/criticalEffects.ts` — 478 lines → 2 modules

**Current responsibilities (single `export module CriticalEffects`):**

| Concern | Approx. line range |
|---------|--------------------|
| Types + region-name lookup + `regionHitChanceDecTable` + `critterTable` | 27–64 |
| `selfWeaponDamage`, `critFailEffects`, `critterEffects` — the actual effect appliers (`droppedWeapon`, `knockdown`, `lostNextTurn`, `blinded`, `crippledLeft/RightLeg`, etc.) | 65–245 |
| `Effects`, `StatCheck`, `CritType`, `CritLevelData` classes — table-row representations | 246–344 |
| `parseCritLevel`, `parseEffects` — JSON parser | 325–351 |
| `getCritical`, `defaultCritType`, `getCriticalFail` | 352–391 |
| `loadTable`, `criticalFailTable`, `temporaryDoCritFail` | 393–478 |

**Proposed split:**

| New file | Owns | Exports |
|----------|------|---------|
| `src/criticalEffects/effects.ts` | The effect appliers: `critterEffects` map (knockdown, blinded, crippledLeftLeg, etc.), `critFailEffects` map (`droppedWeapon`, etc.), `selfWeaponDamage`, `regionHitChanceDecTable`, region-name lookup. The actual game-state mutations. | The effect maps + the public hit-chance table. |
| `src/criticalEffects/table.ts` | Table-row classes (`Effects`, `StatCheck`, `CritType`, `CritLevelData`) + parsers + accessors (`getCritical`, `defaultCritType`, `getCriticalFail`, `loadTable`, `criticalFailTable`, `temporaryDoCritFail`). | Table API. |

`src/criticalEffects.ts` becomes a barrel augmenting `CriticalEffects`.

**Sizes after split (estimate):** `effects.ts` ≈ 230; `table.ts` ≈ 250.

**Circular-dependency risks (low):** `effects.ts` imports `Critter`,
`Weapon`, `critterDamage` — same as today.

---

### 23. `src/ui.ts` — 469 lines → **leave as-is**

This file is **already a barrel**: ~410 of its 469 lines are `export { … }`
re-exports plus the one-off `uiInit()` function (which is just `initOptionsMenu`,
`initLoot`, `initCalledShot`, `initLogScrollZones`, `initInventory`,
`registerCloseInventoryPanel`, etc. wired together at boot). No content split
would reduce coupling. Recommendation: **do not split**; let the per-panel
file splits (sections 12, 21, etc.) leave their re-exports here.

If anything, after the other UI splits land, `ui.ts` will grow more re-export
lines but its real code shrinks; that's the intended outcome.

---

### 24. `src/ui_options.ts` — 438 lines → 2 modules

**Current responsibilities:**

| Concern | Approx. line range |
|---------|--------------------|
| `getOptionsWindow` accessor | 31–37 |
| `SavedPreferences` interface, `PREFS_KEY` | 39–53 |
| `loadPreferences` — apply persisted prefs to Config + audioEngine | 55–90 |
| `getVolumeValue` | 92–101 |
| `buildPrefsPanel` — DOM panel build (≈ 220 lines) | 102–318 |
| `savePreferences`, `openPrefsPanel`, `closePrefsPanel` | 319–354 |
| `initOptionsMenu`, `showOptionsMenu`, `closeOptionsMenu` — main-menu integration | 356–438 |

**Proposed split:**

| New file | Owns | Exports |
|----------|------|---------|
| `src/ui_options/preferences.ts` | `SavedPreferences`, `PREFS_KEY`, `loadPreferences`, `savePreferences`, `getVolumeValue`. The Config/localStorage layer with no DOM. | Pref I/O. |
| `src/ui_options.ts` | `buildPrefsPanel`, `openPrefsPanel`, `closePrefsPanel`, `initOptionsMenu`, `showOptionsMenu`, `closeOptionsMenu`, `getOptionsWindow`. The DOM-bearing panel. | Public surface. |

**Sizes after split (estimate):** `preferences.ts` ≈ 70;
`ui_options.ts` (after carve) ≈ 370.

**Circular-dependency risks (low):** none — `preferences.ts` only touches
`Config` and `globalState`.

---

### 25. `src/geometry.ts` — 411 lines → 2 modules

**Current responsibilities (no imports — pure):**

| Concern | Approx. line range |
|---------|--------------------|
| Hex screen projection (`hexToScreen`, `hexFromScreen`, `hexIsInFrontOf`, `hexIsToRightOf`, `pixelToCube`, `cubeRound`, `сubeRoundToHex`, `hexGridToCube`) + screen/grid constants (`HEX_WIDTH`, `HEX_HEIGHT`, `HEX_GRID_SIZE`) + `Point`, `BoundingBox` types | 20–155 |
| Hex grid topology (`hexNeighbors`, `hexInDirection`, `hexIsEdge`, `hexInDirectionDistance`, `directionOfDelta`, `hexDistance`, `hexDirectionTo`, `hexOppositeDirection`, `hexNearestNeighbor`) | 159–271 |
| Lines and ranges (`hexLine`, `hexLineBeyond`, `hexesInRadius`) | 273–353 |
| Bounding-box predicates (`pointInBoundingBox`, `tile_in_tile_rect`, `tile_in_tile_rect2`, `pointIntersectsCircle`) | 354–411 |

**Proposed split:**

| New file | Owns | Exports |
|----------|------|---------|
| `src/geometry/hexScreen.ts` | Projection helpers + types + constants. | `Point`, `BoundingBox`, `HEX_WIDTH`, `HEX_HEIGHT`, `HEX_GRID_SIZE`, `hexToScreen`, `hexFromScreen`, `hexIsInFrontOf`, `hexIsToRightOf`, plus the cube-rounding helpers. |
| `src/geometry/hexGrid.ts` | Topology + lines + bbox predicates (everything that operates on hex coords without touching screen pixels). | `hexNeighbors`, `hexInDirection`, `hexInDirectionDistance`, `directionOfDelta`, `hexDistance`, `hexDirectionTo`, `hexNearestNeighbor`, `hexLine`, `hexLineBeyond`, `hexesInRadius`, `pointInBoundingBox`, `tile_in_tile_rect`, `pointIntersectsCircle`. |

`src/geometry.ts` becomes a barrel re-exporting everything.

**Sizes after split (estimate):** `hexScreen.ts` ≈ 180; `hexGrid.ts` ≈ 240.

**Circular-dependency risks:** none — `geometry.ts` has zero imports today.

---

## Recommended execution order

The splits below are ordered to **minimise merge conflicts** (each step touches
files that downstream steps don't yet revisit) and **eliminate broken imports**
at every checkpoint (each step keeps the original file as a barrel re-export so
existing import sites compile until the next step).

**Phase 1 — leaf-level, zero-risk splits (no game-state coupling).**
These can land in any order, and almost certainly without test failures.

1. **`src/geometry.ts`** → `geometry/hexScreen.ts` + `geometry/hexGrid.ts`
   (no imports, no cycles possible).
2. **`src/perks.ts`** → `perks/perks.data.ts` + `perks/perks.ts`
   (data extraction, single downstream `Player` import).
3. **`src/criticalEffects.ts`** → `criticalEffects/effects.ts` + `criticalEffects/table.ts`
   (already inside a `module CriticalEffects` namespace; sibling files
   augment naturally).
4. **`src/ui_font.ts`** → `ui/fontCore.ts` + `ui/numberDials.ts` + barrel.
5. **`src/automapData.ts`** → `automap/storage.ts` + `automap/tracking.ts` + `automap/render.ts` + barrel.
6. **`src/lightmap.ts`** → `lightmap/lightTable.ts` carve-out.

**Phase 2 — render layer (depends on Phase 1's `geometry`).**

7. **`src/renderer.ts`** → `render/camera.ts` + slim `renderer.ts`.
8. **`src/webglrenderer.ts`** → `render/webglContext.ts` + `render/webglLighting.ts` + `render/webglDraw.ts`.

**Phase 3 — UI panels (independent of objects/combat changes).**

9.  **`src/ui_options.ts`** → `ui_options/preferences.ts` carve-out.
10. **`src/ui_barter.ts`** → `ui_barter/swap.ts` + `ui_barter/screen.ts`.
11. **`src/ui_inventory.ts`** → `ui_inventory/dragdrop.ts` + `ui_inventory/panel.ts`.
12. **`src/ui_pipboy.ts`** → `ui_pipboy/shell.ts` + 3 per-tab files.
13. **`src/ui_character.ts`** → `ui_character/{descriptions,viewer,creator,perkModal}.ts`.

**Phase 4 — world / map / encounter triplet (somewhat coupled).**

14. **`src/encounters.ts`** → `encounters/{conditionLang,resolver}.ts`.
15. **`src/worldmap.ts`** → `worldmap/{types,parser,Worldmap,encounters}.ts`.
16. **`src/map.ts`** → `map/{GameMap,mapLoader}.ts`.
17. **`src/endgame.ts`** → `endgame/{deathEndings,slideRender}.ts` + slim `endgame.ts`.

**Phase 5 — the high-risk cluster (objects / critter / combat).**
Land these together in a single review, because Phase 5's three splits share a
mutual import surface (`Critter` types) that's easy to get wrong if they land
independently.

18. **`src/object.ts`** → `object/{Obj,items,factories,Critter,critterAnimation}.ts`.
19. **`src/critter.ts`** → `critter/{Weapon,lifecycle}.ts`. Drop the dead
    `critterGetRawStat` / `critterSetRawSkill` quartet.
20. **`src/combat.ts`** → `combat/{actionPoints,AI,damage,hitChance,Combat}.ts`.

**Phase 6 — scripting (touches everyone) — go last.**

21. **`src/scripting.ts`** → `scripting/{Script,runtime,dialogue,perception,
    lifecycle,animBatch}.ts`. Keep the public `Scripting.*` namespace shape
    via barrel re-exports; verify every `Scripting.X` call site still resolves.

**Phase 7 — main / engine core.**

22. **`src/main.ts`** → `playerUse.ts` + `input.ts` + `gameTick.ts`.
    Land last because it imports from nearly every other module.

**Phase 8 — testing tooling (no game-runtime risk).**

23. **`src/autocrawler.ts`** → `autocrawler/{types,shared,dialogue,combat,
    maps,report}.ts`. Side-effect import in `main.ts` continues to work
    through the barrel.

---

## Conventions for every split

1. **Always leave a barrel.** Existing import sites (`from './scripting.js'`,
   `from './object.js'`, …) must keep working. The original file becomes
   `export { … } from './<split>/…'`. No call site is updated as part of the
   split itself; that's a follow-up.
2. **Namespace-augmenting splits use the `module`/`namespace` declaration in
   every sibling file**, then a single re-export aggregator in the barrel.
   This is the same pattern CE uses for its `interpreter_extra.cc` opcode
   registrations.
3. **No new logic in any split.** Every commit is "move file A's lines X–Y
   into file B verbatim, add necessary imports". `git mv -- A B` plus
   surgical adjustments preserves blame.
4. **Run `npx tsc` after every split.** TypeScript strict-mode will flag
   missing imports immediately, so the surface stays compileable at every
   checkpoint.
5. **Update `CODEBASE.md`'s Source Modules table** in the same commit that
   lands each split — per CLAUDE.md "CODEBASE.md Maintenance".
6. **Do not change `wiki/known_bugs.md` line counts** as part of a split;
   they reflect logical not physical organisation.

---

## What this proposal deliberately does **not** do

- **Does not move opcode bodies out of `Script`** — CLAUDE.md "Conventions"
  forbids it.
- **Does not introduce a new runtime layer.** No DI container, no event bus
  beyond the existing `events.ts`, no class hierarchy changes. Pure file
  decomposition with re-exports.
- **Does not rename anything publicly exported.** The visible names that other
  files import stay unchanged.
- **Does not touch `formats/`, `vm.ts`, `vm_bridge.ts`, `player.ts`,
  `char.ts`, `skills.ts`, `aiPackets.ts`, `gametime.ts`, `audio.ts`,
  `data.ts`, `pro.ts`, `tile.ts`, `lighting.ts`, `globalState.ts`,
  `config.ts`, `events.ts`, `logger.ts`, `util.ts`, `images.ts`,
  `saveload.ts`, `idbcache.ts`, `debug.ts`, `intfile.ts`, `transpiler.ts`,
  `questData.ts`, `questLog.ts`, `drugs.ts`, `eventlog.types.ts`,
  `unarmed.ts`, `soundMap.ts`, `heart.ts`, `init.ts`, `ui_hud.ts`,
  `ui_dialogue.ts`, `ui_panels.ts`, `ui_widget.ts`, `ui_components.ts`,
  `ui_drag.ts`, `ui_calledshot.ts`, `ui_contextmenu.ts`, `ui_elevator.ts`,
  `ui_loot.ts`, `ui_mainmenu.ts`, `ui_saveload.ts`, `ui_skilldex.ts`,
  `ui_timer.ts`, `ui_unarmed.ts`, `ui_charactercreator.ts`,
  `ui_worldmap.ts`, `ui_automap.ts`, `party.ts`** — all already at or
  below ~400 lines.
- **Does not collapse the `Scripting` / `Worldmap` / `Encounters` /
  `Lightmap` / `CriticalEffects` namespaces.** Each retains its existing
  `module X { … }` surface; the splits augment, they do not flatten.

---

## Alternative directions (if architectural rules were relaxed)

The proposal above respects every rule in `CLAUDE.md`. With more freedom,
two additional changes are worth considering — one big and one small.
These are **not** part of the recommended execution order; they're
captured here for future discussion.

### Alt-A. Bundle opcodes by FO2 category (relaxes CLAUDE.md "Conventions")

`CLAUDE.md` → "Conventions" today reads:
> All new scripting opcodes go in src/scripting.ts inside the Script class

That rule keeps `scripting/Script.ts` over 1700 lines even after the
mainline refactor. **If the rule were rewritten** to "all opcodes go on
the `Script` class, organised in `src/scripting/opcodes/<category>.ts`",
the file would split along the same seams CE uses in
`interpreter_extra.cc`:

| Proposed sub-file | Owns (FO2 opcode category) | Approx. lines |
|-------------------|---------------------------|---------------|
| `scripting/opcodes/vars.ts` | `set_global_var`, `global_var`, `set_local_var`, `local_var`, `set_map_var`, `map_var`, `random` | ~80 |
| `scripting/opcodes/messages.ts` | `debug_msg`, `display_msg`, `message_str`, `script_overrides`, `node998`, `node999`, `float_msg` | ~80 |
| `scripting/opcodes/metarule.ts` | `metarule`, `metarule3` (~250 lines together — both giant switch tables) | ~260 |
| `scripting/opcodes/critter.ts` | `get_critter_stat`, `set_critter_stat`, `has_trait`, `critter_add_trait`, `critter_mod_skill`, `critter_dmg`, `critter_heal`, `critter_injure`, `critter_is_fleeing`, `wield_obj_critter`, `critter_set_flee_state`, `give_exp_points` | ~280 |
| `scripting/opcodes/inventory.ts` | `item_caps_total`, `item_caps_adjust`, `move_obj_inven_to_obj`, `obj_is_carrying_obj_pid`, `add_mult_objs_to_inven`, `rm_mult_objs_from_inven`, `add_obj_to_inven`, `rm_obj_from_inven`, `obj_carrying_pid_obj`, `critter_inven_obj`, `inven_cmds`, `wield_obj_critter` | ~230 |
| `scripting/opcodes/anim.ts` | `anim`, `reg_anim_begin/end/clear`, `reg_anim_func`, `reg_anim_animate`, `reg_anim_animate_forever`, `animate_move_obj_to_tile`, `reg_anim_obj_move_to_tile`, `animate_stand_obj`, `anim_busy`, `art_anim`, `obj_art_fid` | ~260 |
| `scripting/opcodes/objects.ts` | `proto_data`, `create_object_sid`, `obj_name`, `obj_item_subtype`, `set_obj_visibility`, `use_obj_on_obj`, `use_obj`, `obj_pid`, `obj_on_screen`, `obj_type`, `destroy_object`, `set_exit_grids` | ~230 |
| `scripting/opcodes/tile.ts` | `tile_distance_objs`, `tile_distance`, `tile_num`, `tile_contains_pid_obj`, `tile_is_visible`, `tile_num_in_direction`, `tile_in_tile_rect`, `tile_contains_obj_pid`, `rotation_to_tile`, `move_to`, `elevation` | ~150 |
| `scripting/opcodes/locks.ts` | `obj_is_locked`, `obj_lock`, `obj_unlock`, `jam_lock`, `obj_is_open`, `obj_close`, `obj_open` | ~80 |
| `scripting/opcodes/perception.ts` | `obj_can_see_obj`, `obj_can_hear_obj`, `using_skill`, `has_skill`, `roll_vs_skill`, `do_check`, `is_success`, `is_critical` | ~100 |
| `scripting/opcodes/dialogue.ts` | `gdialog_set_barter_mod`, `gdialog_mod_barter`, `start_gdialog`, `gsay_start`, `gsay_reply`, `gsay_message`, `gsay_end`, `end_dialogue`, `giq_option`, `dialogue_system_enter` | ~140 |
| `scripting/opcodes/lighting.ts` | `set_light_level`, `obj_set_light_level`, `override_map_start` | ~50 |
| `scripting/opcodes/timer.ts` | `add_timer_event`, `rm_timer_event`, `game_ticks`, `days_since_visited`, `game_time_advance` | ~80 |
| `scripting/opcodes/loadout.ts` | `load_map`, `play_gmovie`, `endgame_slideshow`, `endgame_movie`, `mark_area_known`, `wm_area_set_pos`, `game_ui_disable`, `game_ui_enable` | ~80 |
| `scripting/opcodes/audio.ts` | `play_sfx`, `gfade_out`, `gfade_in` | ~60 |
| `scripting/opcodes/party.ts` | `party_member_obj`, `party_add`, `party_remove` | ~30 |
| `scripting/opcodes/combat.ts` | `attack_complex`, `terminate_combat`, `explosion` | ~60 |

#### How the class stays one class

TypeScript supports **prototype-merged classes** via interface declaration
merging plus assignment. Pattern:

```ts
// scripting/Script.ts — declares the class shell
export class Script {
    // shared state (LVARs, GVAR accessors, self/source/target_obj)
    lvars: Record<number, any> = {}
    self_obj: ScriptableObj | null = null
    // …
}

// Module-augmented interface so call sites see all the methods.
export interface Script {
    metarule(id: number, target: number): any
    metarule3(id: number, obj: any, userdata: any, radius: number): any
    // …one signature per opcode (or generated via a code-gen step)
}

// scripting/opcodes/metarule.ts
import { Script } from '../Script.js'
Script.prototype.metarule = function (id, target) { /* … */ }
Script.prototype.metarule3 = function (id, obj, userdata, radius) { /* … */ }

// scripting/opcodes/index.ts — side-effect-only barrel
import './vars.js'
import './messages.js'
import './metarule.js'
// …registers every category onto Script.prototype at import time.
```

`scripting/Script.ts` keeps the class declaration plus shared state and
the `_serialize` method. Every opcode body lives in a category file.
`scripting.ts` (the public barrel) adds `import './scripting/opcodes/index.js'`
as a side-effect import so the methods are wired before any caller
constructs a `Script`.

#### Trade-offs

**Pros**

- `scripting/Script.ts` drops from ~1700 lines to ~120 (class shell only).
- Every category file is 30–280 lines, easy to navigate.
- Mirrors CE's `interpreter_extra.cc` opcode grouping line-for-line; a
  reader cross-referencing CE finds the same boundaries.
- Adding a new opcode becomes "drop a method onto `Script.prototype` in
  the matching category file" — same one-line cognitive cost as today,
  just in a different physical file.
- Per-category test coverage becomes feasible (no current test runner,
  but a future addition).

**Cons**

- **Breaks the CLAUDE.md "Conventions" rule** as currently written. That
  rule was added so contributors know exactly where opcodes go; the new
  rule "go to `src/scripting/opcodes/<category>.ts`" requires a
  category-lookup table for non-obvious opcodes (where does `metarule`
  go? where does `wield_obj_critter` go — `critter.ts` or
  `inventory.ts`?). Mitigation: a short index table at the top of
  `scripting/opcodes/README.md` mapping every opcode → file.
- **Prototype-merging is less discoverable in IDEs** than class-method
  declarations. "Go to definition" on `script.metarule(13)` jumps to the
  declaration in `Script.ts` (the interface), then needs a second hop
  to the implementation in `metarule.ts`. Modern TS+VSCode handle this
  but it's friction.
- **Initialization order matters.** The `opcodes/index.ts` barrel must
  run before any `Script` is constructed. A single missed import means
  silent runtime breakage. Mitigation: bake the side-effect import into
  `Script`'s constructor as a one-time guard, or use a static block.
- **`git log --follow`** on individual opcode methods works less cleanly
  because they're moving from one giant class to scattered prototype
  assignments. Acceptable cost if we do the split in one commit per
  category.

#### Recommendation

Defer until after the mainline refactor lands. Once the barrel pattern
is proven and the 5 follow-up oversized files (Script.ts, creator.ts,
critterAnimation.ts, Combat.ts, playerUse.ts) are causing friction,
revisit. The opcode split should only land as a deliberate CLAUDE.md
rule change, not as a quiet refactor — the rule exists for contributor
clarity and the change has to be advertised.

---

### Alt-B. Lift shared DOM helpers into `src/ui_dom.ts` (no rule change needed)

The current UI files each redefine the same DOM micro-helpers. Audit of
`function $id(`, `clearEl`, `showv`, `hidev`, `show`, `hide`, `off`,
`makeEl`, `$img`, `$q`, `$qa`, `appendHTML`:

| File | Duplicated helpers |
|------|-------------------:|
| `ui.ts` | 9 |
| `ui_worldmap.ts` | 8 |
| `ui_hud.ts` | 8 |
| `ui_loot.ts` | 6 |
| `ui_inventory.ts` | 5 |
| `ui_calledshot.ts` | 5 |
| `ui_elevator.ts` | 4 |
| `ui_barter.ts` | 4 |
| `ui_contextmenu.ts` | 3 |
| `ui_dialogue.ts` | 1 |
| `ui_unarmed.ts` | 1 |

Roughly **54 duplicated helper bodies** across 11 files. Many bodies are
identical one-liners (`function $id(id: string): HTMLElement { return
document.getElementById(id)! }`). Some have subtle drift (e.g. `showv`
in `ui.ts` clears `visibility` while in `ui_loot.ts` it clears both
`visibility` and `display`).

#### Proposed file

`src/ui_dom.ts` — a single ~100-line module exporting:

| Export | Body |
|--------|------|
| `$id(id)` | `document.getElementById(id)!` (non-null assertion preserved; matches current behaviour) |
| `$img(id)` | `document.getElementById(id) as HTMLImageElement` |
| `$q(selector)` | `document.querySelector(selector) as HTMLElement` |
| `$qa(selector)` | `Array.from(document.querySelectorAll(selector))` |
| `clearEl(el)` | `el.innerHTML = ''` |
| `show(el)` | `el.style.display = ''` |
| `hide(el)` | `el.style.display = 'none'` |
| `showv(el)` | `el.style.visibility = 'visible'` |
| `hidev(el)` | `el.style.visibility = 'hidden'` |
| `off(el, events)` | jQuery-style multi-event detach (already identical across files) |
| `appendHTML(el, html)` | `el.insertAdjacentHTML('beforeend', html)` |
| `makeEl(tag, opts)` | The shared element-factory currently duplicated across `ui.ts`, `ui_inventory.ts`, `ui_barter.ts`, `ui_loot.ts` |

#### Reconciliation of drifted variants

Before consolidating, pick one canonical body for each helper. The two
known drift cases are:

- **`showv`/`hidev`**: `ui_loot.ts` and `ui_barter.ts` reset both
  `display` and `visibility`; `ui.ts` and the rest only touch `visibility`.
  Recommend: `showv` / `hidev` touch `visibility` only; callers that
  want both behaviours use `show`/`hide` which touch `display`. This
  matches `ui.ts` (the oldest variant) and the export names already
  hint at it (`v` = visibility).
- **`makeEl`**: at least four variants exist with slightly different
  option shapes (`classes` vs `className`, `attrs` vs `attributes`).
  Pick the `ui_inventory.ts` shape (`{ classes, attrs, style, text }`)
  since it has the most callers, and migrate the rest.

#### Trade-offs

**Pros**

- ~120 lines of duplication removed.
- Drift bugs become impossible (the two variants of `showv` cannot
  diverge again).
- New UI panels just import what they need rather than copying
  boilerplate.
- No rule change needed — `CLAUDE.md` is silent on DOM helpers.

**Cons**

- 11 UI files change in one commit (or one per file across a small
  series). Touches a lot of git blame but is a mechanical search-replace.
- One canonical body has to be chosen for each helper, which means
  callers expecting the "other" behaviour break silently if not
  caught. Mitigation: type-check post-migration, and visually QA the
  three biggest panels (inventory, character, pip-boy).

#### Recommendation

Land **before** the per-file UI splits in Phase 3. Consolidating first
means each split inherits the de-duplicated baseline rather than
carrying duplicates into the new subfolder structure.

---

### Summary of alternatives

| Alt | Scope | Rule change required? | Recommendation |
|-----|-------|-----------------------|----------------|
| **A. Opcode-category split** | `scripting/Script.ts` (~1700 → ~120) + 17 category files | Yes — `CLAUDE.md` "Conventions" line | Defer to a follow-up; needs explicit rule-change discussion |
| **B. Shared DOM helpers in `ui_dom.ts`** | 11 UI files lose ~120 lines of duplication | No | Do it; ideally before Phase 3 of the mainline refactor |

---

### Integrated execution order (mainline + Alt-A + Alt-B)

If both alternatives land, the recommended sequence is below. Two new
phases bracket the existing 8-phase plan: **Phase 0** lands the CLAUDE.md
rule change Alt-A depends on (must come first because it advertises the
new convention to contributors), and **Phase 1.5** consolidates the DOM
helpers before any UI split runs (so the dedup applies to both the 5 UI
files that get split in Phase 3 and the 6 UI files that don't).

Phase 6 (scripting) absorbs Alt-A by splitting into two commits — **6a**
delivers the mainline scripting layout with `Script.ts` containing every
opcode, **6b** carves opcodes out into category files. The two-commit
split keeps each diff reviewable, lets the engine compile and run after
6a (bisect-friendly), and means a botched Alt-A rolls back to a working
intermediate state instead of the pre-refactor monolith.

| # | Phase | What lands | Why this order |
|---|-------|------------|----------------|
| 0 | **CLAUDE.md rule change** | Rewrite "Conventions" → opcodes live in `src/scripting/opcodes/<category>.ts` on `Script.prototype`. Add subfolder convention. | Must come **first** so contributors are aware before the structure changes. One small commit. |
| 1 | Leaf-level splits (unchanged) | `geometry`, `perks`, `criticalEffects`, `ui_font`, `automapData`, `lightmap` | Zero-risk; ships the subfolder convention introduced in Phase 0 on safe files. |
| **1.5** | **Alt-B: `src/ui_dom.ts` consolidation** | Create `ui_dom.ts` with canonical `$id`/`clearEl`/`showv`/`hidev`/`makeEl`/`off`/`$img`/`$q`/`$qa`/`appendHTML`. Migrate 11 UI files to import from it. | Before Phase 3 so UI splits inherit deduplicated baseline. Files that don't get split (`ui_hud`, `ui_loot`, etc.) still benefit. One commit per file or one bulk commit — reviewer's call. |
| 2 | Render (unchanged) | `renderer`, `webglrenderer` | No UI dependency on Phase 1.5. Could run in parallel with Phase 1.5 in practice. |
| 3 | UI panels (unchanged) | `ui_options`, `ui_barter`, `ui_inventory`, `ui_pipboy`, `ui_character` | Each panel's split now starts from the deduplicated baseline. |
| 4 | World/map (unchanged) | `encounters`, `worldmap`, `map`, `endgame` | Independent of UI changes. |
| 5 | Objects/critter/combat (unchanged) | `object`, `critter`, `combat` | High-risk cluster lands together as planned. |
| **6a** | **Scripting mainline split** | `scripting/{Script,runtime,dialogue,perception,lifecycle,animBatch}.ts` per the original Phase 6 proposal. `Script.ts` still ~1700 lines (carries every opcode). | Validates the barrel pattern on the most-imported file in the engine before Alt-A piles on. |
| **6b** | **Alt-A: opcode category extraction** | Create `scripting/opcodes/{vars,messages,metarule,critter,inventory,anim,objects,tile,locks,perception,dialogue,lighting,timer,loadout,audio,party,combat}.ts` + `scripting/opcodes/index.ts`. Move each opcode body out of `Script.ts` onto `Script.prototype` in its category file. `Script.ts` drops from ~1700 to ~120 lines. Add `import './opcodes/index.js'` to `scripting.ts` barrel. | After 6a is proven; one PR per category (or one bulk PR with one category per commit) keeps diffs reviewable. Bisect lands at "all opcodes still on Script" if 6b breaks. |
| 7 | `main.ts` split (unchanged) | `playerUse.ts`, `input.ts`, `gameTick.ts` | Last because it imports from almost every other module. |
| 8 | `autocrawler.ts` split (unchanged) | `autocrawler/{types,shared,dialogue,combat,maps,report}.ts` | Side-effect import in `main.ts` keeps working through the barrel. |

#### Why this order works

- **Phase 0 first** advertises the rule change. No surprise restructuring.
- **Alt-B before Phase 3** is the only ordering that avoids carrying
  duplicated DOM helpers into the new subfolder structure. Doing it
  after Phase 3 means the 5 split panels each ship with their old
  duplicates and we have to do another sweep — wasted churn.
- **Phase 6a / 6b separation** means we get the mainline scripting
  refactor (a meaningful improvement on its own) without depending on
  Alt-A's prototype-merging pattern proving out. If 6b is botched it
  rolls back to a working 6a state, not the pre-refactor monolith.
- **Everything else stays as planned** — Phases 1, 2, 4, 5, 7, 8 are
  unchanged because neither alternative interacts with them.

#### Per-phase risk and rollback

| Phase | Risk if it goes wrong | Rollback |
|-------|----------------------|----------|
| 0 | Contributors miss the rule change | Re-advertise; no code rollback needed |
| 1 | Type / import error in a leaf file | Revert the single split commit |
| 1.5 | Drifted DOM helper body breaks a UI panel | Revert per-file migration commits |
| 2 | WebGL draw regression | Revert per-renderer commit; renderer.ts and webglrenderer.ts still work via their barrels |
| 3 | UI panel render regression | Revert per-panel commits; each is independent |
| 4 | Map load failure | Revert map.ts split; loader and GameMap are split in one phase |
| 5 | Combat behaviour regression | High risk — three coupled files. Stage in a single PR and bisect within. |
| 6a | `Scripting.X` import resolves to wrong sub-file | Revert the scripting/ folder add; the barrel re-exports keep call sites working |
| 6b | Prototype merging missed an opcode | Revert per-category commits; the affected opcode falls back to its body on `Script.ts` from 6a |
| 7 | `playerUse` router behaviour regression | Revert per-extracted-function commits |
| 8 | Crawler doesn't auto-start | Revert single barrel commit |

#### Total scope when both alternatives land

| Metric | Mainline only | Mainline + Alt-A + Alt-B |
|--------|--------------:|--------------------------:|
| New files | 66 | 66 + 17 (Alt-A) + 1 (Alt-B) = **84** |
| Files modified that aren't split | 0 | 11 (Alt-B migrations) |
| CLAUDE.md edits | 0 | 1 (Phase 0) |
| Files left above 400 lines after all phases | 5 (`scripting/Script.ts` mandated; `creator.ts`, `critterAnimation.ts`, `Combat.ts`, `playerUse.ts` are follow-up candidates; `perks.data.ts` is intentional data) | 4 (`scripting/Script.ts` drops to ~120; the other 4 are unchanged) |
| Phases | 8 | 10 (Phase 0 + Phase 1.5 added) |

---

## Summary

| Phase | Files touched | New files | Cumulative new modules | Net lines moved |
|-------|---------------|-----------|------------------------|-----------------|
| 1 | 6 | 14 | 14 | ~2400 |
| 2 | 2 | 5 | 19 | ~1300 |
| 3 | 5 | 11 | 30 | ~3700 |
| 4 | 4 | 9 | 39 | ~2400 |
| 5 | 3 | 12 | 51 | ~4400 |
| 6 | 1 | 6 | 57 | ~2600 |
| 7 | 1 | 3 | 60 | ~1100 |
| 8 | 1 | 6 | 66 | ~900 |
| **Total** | **23** | **66** | **66 new files** | **~19 000 lines repositioned** |

After execution every newly created file is ≤ 400 lines except:
`scripting/Script.ts` (~ 1700, mandated by CLAUDE.md), `object/critterAnimation.ts`
(~ 480, follow-up candidate), `combat/Combat.ts` (~ 950, follow-up candidate),
`playerUse.ts` (~ 810, follow-up candidate), `ui_character/creator.ts` (~ 870,
follow-up candidate), and the `perks/perks.data.ts` data table (~ 660,
intentional). Five files remain above 400; everything else fits.
