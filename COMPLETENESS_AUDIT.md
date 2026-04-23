# DarkHarold2 — Fallout 2 Engine Completeness Audit

_Static analysis only. No game execution. Branch: `claude/fallout-bitmap-fonts-tsBnO`.  
All line citations are from `src/` unless otherwise noted._

---

## 1. Executive Summary

DarkHarold2 is a partial Fallout 2 engine reimplementation in TypeScript/WebGL that is approximately **~54% complete** on a weighted basis. The core rendering pipeline, combat damage formula, map loading, scripting VM, and dialogue flow are all meaningfully implemented and would be recognizable to someone who has played Fallout 2. However, several systems that are essential to reaching the endgame — character creation (SPECIAL point-buy, trait selection), a level-up/perk-pick UI, complete script opcode coverage, karma/reputation tracking, and proper save-game serialization of player stats and global script vars — are either missing or significantly stubbed. The engine can load FO2 maps, run NPC scripts, shoot things, and show the Pip-Boy, but a player cannot start a new game from scratch, pick a build, level up meaningfully, or save a complete game state.

**Headline: ~54% complete (weighted). Playable demo quality; not shippable.**

---

## 2. Subsystem Scorecard

| Subsystem | Status | Score | Confidence | Key Evidence |
|---|---|---|---|---|
| **Combat** | Partial | 65% | High | AP/initiative (`combat.ts:227`), full DT/DR formula with 7 dmg types (`combat.ts:460–537`), critical tables (`criticalEffects.ts:344,367`), death anims (`critter.ts:426`); AI flee partial, `critter_is_fleeing` stubbed (`scripting.ts:797`) |
| **Scripting / VM** | Partial | 45% | High | `vm.ts` has ~41 base opcodes (`vm.ts:31`); `vm_bridge.ts` has ~134 bridge entries but 61 call `stub()` (`scripting.ts:87`); poison/radiation/flee are stubs (`scripting.ts:775–844`) |
| **Map Rendering** | Partial | 80% | High | Full MAP parsing + multi-elevation (`map.ts:58,181,455`), WebGL+canvas pipelines (`webglrenderer.ts:1145L`, `renderer.ts:485L`), A\* pathfinding (`map.ts:573–575`), lightmap (`lightmap.ts:582L`) |
| **Object Model** | Partial | 65% | High | Full `Obj`/`Item`/`WeaponObj`/`Critter` hierarchy, inventory add/remove/serialize, two weapon slots (`object.ts:1038–1142`); PRO parsing thin (`pro.ts:128L`), many `any` types and TODOs (`object.ts:86,282,291`) |
| **Dialogue** | Partial | 65% | High | Node traversal, reply callbacks, barter-mode switch (`scripting.ts:217–259`); reaction tracking absent, `gdialog_set_barter_mod` stub (`scripting.ts:1154`), float_msg logged but rendering unclear (`scripting.ts:1229–1254`) |
| **Worldmap / Travel** | Partial | 60% | Medium | Tile traversal + time passage (`worldmap.ts`), encounter-rate check, car/special encounters absent (`worldmap.ts:408,443`) |
| **Random Encounters** | Partial | 65% | Medium | Full condition-expression parser, table evaluation, critter placement with ratios (`encounters.ts:140–279`); no special-encounter logic found |
| **Inventory** | Partial | 60% | High | Add/remove/serialize/drop/pickup (`object.ts:602–842`), two weapon slots, ammo reload (`ui.ts:1390`); no carry-weight enforcement, armor slot is implicit |
| **Character Creation** | Stub | 15% | High | Character screen is view+skill-edit only; `canChangeStats = false` (`ui.ts:1171`); no SPECIAL point-buy, trait selection, or tag-skill flow anywhere in codebase |
| **Save / Load** | Partial | 45% | High | Saves map + inventory + party to IndexedDB (`saveload.ts:44–65`); explicit `// TODO: Properly (de)serialize the player!` (`saveload.ts:158`); global script vars not saved |
| **Level-Up / Perks** | Stub | 25% | High | `pendingPerkPick` flag exists (`player.ts:118`); no perk-selection UI, no prerequisite checks, no "every 3 levels" gating; `perkGetSkillModifier()` implemented for skill math only (`skills.ts:209`) |
| **Traits** | Stub | 20% | High | `traitGetSkillModifier()` covers Gifted's −10% skill penalty only (`skills.ts:223–238`); Kamikaze, Finesse, Fast Shot, Bruiser, Small Frame, Heavy Handed stat/AP/AC effects not applied anywhere |
| **Karma / Reputation** | Missing | 10% | High | `PCSTAT_reputation` and `PCSTAT_karma` are commented cases (`scripting.ts:784–785`); no tracking variables, no title computation, no town-rep tables |
| **Party / Followers** | Stub | 20% | High | `party.ts` (61L) is add/remove/serialize only; no combat AI delegation, no follower inventory access, no follower level-up, no recruitment dialogue plumbing |
| **Quest System** | Partial | 75% | High | Complete FO2 quest table with GVAR indices + thresholds (`questData.ts:204L`); GVAR-driven active/completed logic (`questLog.ts`); no separate XP-award wiring from quest completion |
| **Skills in Use** | Partial | 44% | High | 8/18 skills have active code paths (First Aid, Doctor, Sneak, Lockpick, Steal, Traps, Science, Repair — `skillUse.ts:136–152`); 10 remaining either drive stats only or have no `skillUse()` path |
| **Poison / Radiation / Drugs** | Stub | 10% | High | `poison()` and `radiation_dec()` call `stub()` (`scripting.ts:813–817`); no addiction roll, no withdrawal timer, no drug-effect stat modifier anywhere |
| **Audio** | Partial | 60% | High | Music + async SFX with caching (`audio.ts:51–124`), weapon sound routing (`soundMap.ts`); speech/dialogue audio and volume-slider wiring absent |
| **Pip-Boy** | Partial | 75% | High | Status, automap with zoom/pan, Archives (quest log), date/time bar, alarm, wait menu all present (`pipboy.ts:736L`); worldmap travel from pip-boy absent |
| **UI (HUD + panels)** | Partial | 75% | High | HUD, inventory, dialogue, charscreen, skilldex, options, called-shot box, barter, elevator, worldmap all exist; no character-creation screen |
| **Context Menu** | Partial | 65% | Medium | Look/Talk/Use/Pickup wired (`ui.ts:1561–1613`); Push/Rotate/Unload absent from menu |
| **Endgame / Slides** | Missing | 0% | High | No `endgame`, `slideshow`, `gameover`, or `credits` references anywhere in `src/` |

---

## 3. Incompleteness Heatmap

_Counts of `TODO/FIXME/XXX/HACK/not implemented/stub/placeholder` + `throw Error` per file, sorted by combined total._

| File | Lines | TODO/FIXME/etc | throw Error | Total |
|---|---|---|---|---|
| `scripting.ts` | 1770 | 37 | 19 | **56** |
| `object.ts` | 1790 | 35 | 10 | **45** |
| `ui.ts` | 3258 | 20 | 7 | **27** |
| `map.ts` | 617 | 17 | 0 | **17** |
| `webglrenderer.ts` | 1145 | 15 | 0 | **15** |
| `soundMap.ts` | 128 | 15 | 0 | **15** |
| `critter.ts` | 586 | 11 | 2 | **13** |
| `vm.ts` | 318 | 8 | 5 | **13** |
| `worldmap.ts` | 688 | 9 | 1 | **10** |
| `combat.ts` | 1350 | 7 | 9 | **16** |
| `lightmap.ts` | 582 | 7 | 0 | **7** |
| `encounters.ts` | 449 | 7 | 0 | **7** |
| `vm_bridge.ts` | 233 | 5 | 0 | **5** |
| `data.ts` | 295 | 2 | 8 | **10** |
| `char.ts` | 283 | 4 | 4 | **8** |
| `util.ts` | 261 | 2 | 5 | **7** |
| `renderer.ts` | 485 | 1 | 3 | **4** |
| `main.ts` | 1110 | 3 | 2 | **5** |
| `pro.ts` | 128 | 0 | 0 | **0** |
| `party.ts` | 61 | 0 | 1 | **1** |
| `questLog.ts` | 53 | 0 | 0 | **0** |
| `questData.ts` | 204 | 0 | 0 | **0** |
| `saveload.ts` | 193 | 1 | 0 | **1** |
| `audio.ts` | 220 | 1 | 0 | **1** |
| `skillUse.ts` | 579 | 1 | 0 | **1** |
| `skills.ts` | 247 | 2 | 0 | **2** |

---

## 4. Critical Gaps

Ranked by severity as a blocker for "playable to credits":

1. **Character creation is non-existent.** `canChangeStats = false` at `ui.ts:1171`. There is no screen for SPECIAL point-buy, trait selection (2 of 16), or tag-skill selection. A player cannot legally begin a new game with a custom character.

2. **Save game does not serialize player stats or global script vars.** `saveload.ts:158` contains an explicit `// TODO: Properly (de)serialize the player!`. Global vars (`Scripting.globalVars`) are not included in the save structure at `saveload.ts:44–65`. Loading a save effectively loses all quest progress and player build.

3. **Scripting opcode coverage is ~45%.** 61 of the script bridge functions call `stub()` (`scripting.ts:87`). Crucially, `poison()`, `radiation_dec()`, `critter_is_fleeing()`, `critter_set_flee_state()`, and `gdialog_set_barter_mod()` are all stubs. Many FO2 maps' `map_enter` and `critter_p_proc` scripts will hit unimplemented opcodes and silently fail or crash.

4. **Poison and radiation are fully stubbed.** Both `poison()` and `radiation_dec()` call `stub()` (`scripting.ts:813–817`). Vault 13's water chip run, Gecko's reactor quest, and half of the Enclave's content rely on radiation damage. Addiction and withdrawal are entirely absent.

5. **Level-up perk selection has no UI.** `player.ts:118` sets `pendingPerkPick = true`, but there is no screen to actually pick a perk. The charscreen has `canChangeStats = false` making stat modification dead code. Players accumulate skill points but can never pick perks.

6. **Trait effects are not applied.** `traitGetSkillModifier()` handles only Gifted's skill penalty (`skills.ts:223`). The remaining 15 traits — Kamikaze (AC to 0), Fast Shot (−1 AP for guns), Finesse (+10% crit), Bruiser (−2 AP, +2 STR), Small Frame, Heavy Handed, One Hander, etc. — have no stat/combat effect anywhere in the codebase.

7. **Karma and reputation are absent.** `PCSTAT_reputation` and `PCSTAT_karma` are noted but unimplemented (`scripting.ts:784–785`). This means faction-gated quests (NCR ranger status, Slaver guild, etc.) and reaction modifiers are always in their default state.

8. **Called shots are not wired end-to-end.** The called-shot UI exists (`ui.ts:3108–3157`), and critical effect tables have per-region data (`criticalEffects.ts:38–59`). However, there is no code path passing the selected region from the UI through the attack calculation to `getCritical()` with the correct region string. The `calledShot` variable in `ui.ts:1210` is set to `7` (torso default) and never updated from the UI.

9. **Endgame is completely absent.** No `endgame`, `slideshow`, `gameover`, `credits`, or slide-show renderer exists anywhere in `src/`. Killing the final boss produces no game-over sequence.

10. **Party follower AI is a stub.** `party.ts` (61 lines) only tracks membership. Followers have no combat turn logic, no AI delegation, no inventory-access UI, and no follower level-up. Companions like Sulik, Cassidy, and Marcus would be inert.

---

## 5. Surprisingly Complete

- **Critical hit/fail tables.** `criticalEffects.ts` (470L) has a full data-driven implementation: per-region per-critter-type tables loaded from JSON, all 16 effect types implemented (knockout, knockdown, cripple all 4 limbs, blind, death-explode, bypass armor, drop weapon, lose turn, on fire, random), and critical failure by weapon class (`criticalEffects.ts:367,413`). This matches FO2-CE's `critTable` closely.

- **Quest system data.** `questData.ts` (204L) contains the complete FO2 quest list — all 90+ quests across 16 locations with correct GVAR indices, display thresholds, and verbatim descriptions. The GVAR-driven `getActiveQuests()` logic in `questLog.ts` is clean and complete for display purposes.

- **Skill use implementation.** `skillUse.ts` (579L) has faithful FO2-CE implementations of 8 skills: First Aid and Doctor have daily usage slot limits, correct HP restoration formulas, cripple-healing logic, and XP awards. Lockpick, Steal, Sneak, Traps, Science, and Repair each have proper skill-roll → consequence flows.

- **Damage formula accuracy.** The full FO2 damage formula is present: bonus damage → ammo multiply/divide → halve → subtract DT → apply DR% → difficulty modifier, with armor bypass (DAM_BYPASS at 20% DT/DR) and penetration (unarmed/perk) variants (`combat.ts:460–565`). All 7 damage types with per-type DT/DR lookups are wired.

- **Pip-Boy.** The pip-boy (`pipboy.ts` 736L) has Status, date/time bar, automap with zoom/pan and fog-of-war, Archives tab driven by the quest system, alarm, and a functional wait menu with time advance. More complete than expected.

- **Encounter system.** `encounters.ts` has a proper expression parser for FO2's condition strings (`encounters.ts:47–159`), evaluation with `rand()`, critter placement with ratio-based scaling, and faction-vs-faction combat setup (`encounters.ts:418`).

---

## 6. Suspicious Smallness

| File | Lines | Claimed scope | Verdict |
|---|---|---|---|
| `pro.ts` | 128 | FO2 PRO file parser — complex binary format with 6 item subtypes, 3 critter variants, armors, containers, scenery, walls | Almost nothing here. Actual PRO loading is spread across `object.ts` with `any` types and minimal field extraction. The real PRO parser is effectively missing. |
| `party.ts` | 61 | Full NPC follower system — recruitment, inventory, combat delegation, level-up, dismissal | Purely a list with serialize/deserialize. No follower logic of any kind. |
| `unarmed.ts` | 53 | Unarmed combat system | Only defines the mode data table. The actual unarmed mode advancement and move selection logic lives in `critter.ts`, but the dedicated module is effectively empty. |
| `player.ts` | 187 | Player character — the most important object in the game | Very thin; delegates almost everything to `Critter`. The `pendingPerkPick` flag and XP-to-level formula are here, but there is no character-creation state, no perk-pick flow, and no trait application. |
| `transpiler.ts` | 167 | INT→JS script transpiler | Appears to be a partial attempt at a static transpiler alternative to the VM; unclear if it's used in the current execution path. |

---

## 7. Unknown / Could Not Determine

- **Float messages (NPC speech bubbles).** `float_msg()` pushes to `globalState.floatMessages` (`scripting.ts:1254`), but I could not find where that array is consumed to render DOM elements above critters. May exist in renderer or main loop — needs tracing from `floatMessages` consumption site.

- **Barter screen completeness.** A barter UI mode exists (`UIMode.barter` referenced at `scripting.ts:222`) and there is a `barter` window in `ui.ts`, but the value-calculation formula with the Barter skill modifier and NPC's barter perk could not be fully traced. `gdialog_mod_barter` is stub but the base barter flow may work.

- **Script coverage in practice.** The VM runs, but exactly which of FO2's ~1000 INT scripts execute successfully cannot be determined without running the game. Stub functions fail silently, so map scripts may appear to run while skipping large portions of logic.

- **FRM animation completeness.** The renderer supports sprite rendering with orientations and animation frames. Whether all 6 orientations and all animation variants (walk, run, combat idle, all attack types, all death types) load correctly for a representative set of critters requires runtime verification.

- **Worldmap car mechanics.** There are car-related GVARs in `questData.ts` and a car part quest in the Den, but no car fuel/travel-by-car code path was found in `worldmap.ts`. Could be in an unexamined data file or simply absent.

- **Reaction tracking.** FO2 tracks NPC reaction to the player (hostile/neutral/friendly) based on reputation, Charisma, and past actions. No reaction variable or computation was found. Whether dialogue conditional checks for reaction (`has_skill`, `reaction_level`) work via scripts is unclear.

---

## 8. Recommended Next Milestones

If the goal is "playable to credits," the following 5 pieces of work would move the needle most, roughly in order of unlock value:

1. **Character creation screen** (`canChangeStats` gate + new pre-game flow). Without this, every playthrough starts with a blank default character. Implement the SPECIAL point-buy (5 points to distribute from base 5, max 10), 2-of-16 trait selection, 3 tag skills, and name/sex input — all the data structures exist in `skills.ts` and `char.ts`, it's purely a UI and init wiring task. Unlock: actual character builds.

2. **Save game: full player + global var serialization.** Fix `saveload.ts:158` to serialize player SPECIAL/skills/perks/traits, and add `Scripting.globalVars` to the save blob. Without this, the game cannot be meaningfully saved. Quest state, faction standing, and character progression all live in GVARs. Unlock: persistent progress.

3. **Scripting opcode completeness pass.** Triage the 61 `stub()` call sites in `scripting.ts`. A subset are critical-path for nearly every map: `poison`, `radiation_dec`, `critter_is_fleeing`, `critter_set_flee_state`, `mark_area_known`, `obj_can_hear_obj`, `tile_is_visible`. A focused 2-week pass bringing opcode coverage from ~45% to ~70% would make most maps fully playable. Unlock: functional quests, working NPC AI.

4. **Trait effects applied to combat and stats.** Wire the 16 traits into the stat/combat system. Fast Shot (`−1 AP cost for guns/thrown` in attack code), Kamikaze (`AC = worn armor only`, zero base), Finesse (`+10% critical chance`), Bruiser (`−2 AP, +2 STR`), Small Frame (`+1 AGI, −10 carry weight`) are each a handful of lines in the right places. `traitGetSkillModifier()` already handles skill penalties — the same pattern needs extending to stat and combat modifiers. Unlock: meaningful trait choice.

5. **Level-up perk selection UI.** The `pendingPerkPick` flag at `player.ts:118` is the hook. Build a perk selection window (showing eligible perks filtered by level/stat prerequisites from `perkGetSkillModifier`'s data) that fires when `pendingPerkPick` is true on charscreen open. Persist the picked perk into `player.perks[]`. Unlock: character progression feels real.
