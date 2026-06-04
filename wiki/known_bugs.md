# DarkHarold2 — Known Bugs & Gaps Registry

> **Last audited: 2026-06-04** — June 4 roadmap sprint: S3/STAT_AGE FIXED, S5/critter_add_trait PERK FIXED, S11/anim reverse FIXED, S2/metarule3 107 added, C8/wander radius FIXED, C13/stay_close FIXED, P3/companion follow pathfinding FIXED, P4/closed-unlocked doors FIXED, P5/MULTIHEX neighbors FIXED, P6/shoot-blocking FIXED, P7/scenery LoS FIXED, LE1/carry weight FIXED, LE4/weapon stack identity FIXED, LE6/inventory pickup_p_proc FIXED, IW2/attack button grey FIXED, IW4/HUD bar hide FIXED, CI4/doAlwaysRun default FIXED. Older audit history:
> 2026-06-02 (time_clock audit added §12; elevation audit added §13; animation gaps added §14; proto_system added §15; tile_system added §16; items added §17; random_numbers added §18; settings added §19; lighting added §20; rendering added §21; pathfinding added §22; endgame added §23; economy added §24; interface_windows added §25; M4/W10/LD3 corrections 2026-06-02; wiki merged 55→38 docs 2026-06-02; audio §8 added 2026-06-02; sections §9-§29 renumbered; autocrawler merge crash fixes FIXED 2026-06-02; aiPackets.ts wired: C7/C12/C13 2026-06-02; Phase 1/3/7 sprint 2026-06-02: S13 FIXED, S21 wired, LD3 partial→wired, U5/U6 FIXED; Phase combat/scripting sprint 2026-06-02: S7/do_check FIXED, S3/get_critter_stat expanded, C6/P1 party combat AI wired; U7 timed event persistence FIXED 2026-06-02; C1/Sniper d10 FIXED, C2/crit level breakpoints FIXED 2026-06-02; S6/using_skill FIXED, C9/DAM_DROP verified done 2026-06-02; GTC1/game_time_hour FIXED, S3/DT_DR 17-32 added 2026-06-02; GTC2/game_time_advance queue FIXED, GTC9/game_time_in_seconds wired, IW5/activeHand verified done, RN1/seed FIXED, RN2/roll_dice wired, LE3/move_obj_inven FIXED, LE8/critter_inven_obj FIXED 2026-06-02; EG6/death ending wired, GTC4/days_since_visited wired, PS1/proto_data wired 2026-06-02; EL1/obj.elevation FIXED, LD6/obj_set_light_level intensity FIXED 2026-06-02; IU2/use_obj_on_p_proc FIXED, Q1/getAttackSkin FIXED, M1/spatials verified done 2026-06-02; PS5/proto_data IDs FIXED 2026-06-02; TS2/hexDirectionTo screen-space FIXED 2026-06-02; FA2/getAnimDistance dir-0 FIXED, LE2/CRITTER_NO_DROP FIXED, M4/map_exit_p_proc FIXED, Q4/WeaponObj serialization FIXED, EV3/use_elevator verified wired via metarule, W1/worldmap day-part frequency FIXED, AC1/knockback partial, AC7/explosion damage FIXED, C11/Sequence formula FIXED, S16/S17/S18 verified done, C4/melee location penalty halved FIXED, C12/AI perception gate FIXED, C13/snipe distance FIXED, C3/YAAM formula FIXED 2026-06-02; S4/has_trait TRAIT_OBJECT all cases FIXED, S5/critter_add_trait cases 10/666/669 FIXED 2026-06-02; S9/set_pc_stat all PCSTAT IDs FIXED, S10/mod_pc_stat all IDs FIXED, S11/anim type IDs 0-64 handled 2026-06-02; S22/gdialog_set_barter_mod verified wired; C5/melee crit table false premise verified; AC1/Stonewall perk + melee-only filter FIXED 2026-06-02; Q2/set_critter_stat wired FIXED, W2/encounter difficulty modifier FIXED, W5/evalCond level+time_of_day+operators FIXED, K1/Healer perk verified done 2026-06-02; D2/barter CE formula FIXED 2026-06-02; S3/Sequence formula 2*PER FIXED, GTC3/set_light_level piecewise FIXED 2026-06-02; D1/gdialog_mod_barter mod arg FIXED, W4/encounter counter FIXED 2026-06-02; W7/Outdoorsman detection XP FIXED avoidance UI still absent 2026-06-02; W6/encounter formations straight_line/double_line/wedge/cone FIXED 2026-06-02; S12/proto_data name+description cases FIXED 2026-06-02; S20/tile_is_visible verified done; S24/wm_area_set_pos DOM update FIXED 2026-06-02; K3/Steal facing+knockdown FIXED 2026-06-02; K5/Melee Weapons remap verified done 2026-06-02; S1/metarule 9 new sub-ops FIXED 2026-06-02; S23/game_ui keydown guard FIXED 2026-06-02; S2/metarule3 103+108 added kill-count tracking 2026-06-02; S8/inven_cmds FIXED 2026-06-02; R1/karma sync FIXED 2026-06-02; FA1/updateStaticAnim fps from imageInfo FIXED 2026-06-02; IU4/locked door SFX+message FIXED 2026-06-02; GTC8/Pathfinder travel time reduction FIXED 2026-06-02; EL2/stair-ladder fires map_update not map_enter FIXED 2026-06-02; EL5/map_update_p_proc all elevations FIXED 2026-06-02; IU1/use_obj_on_obj two-step chain FIXED 2026-06-02; Q3/ladder destination elevation+map FIXED 2026-06-02; M3/addObject fires enterMap FIXED 2026-06-02; GTC6/START_MONTH July fixed FIXED 2026-06-02; TS1/hexInDirectionDistance edge-check FIXED 2026-06-02; FA5/walk frame-0 shift null check FIXED 2026-06-02; D3/Barter button in gsay_end FIXED 2026-06-02; LD3/obj_set_light_level triggers rebuildLight FIXED 2026-06-02; LD4/set_obj_visibility triggers rebuildLight FIXED 2026-06-02; LD1/hidden objects no longer emit light FIXED 2026-06-02; FA8/sprite-vanish async load FIXED, FA9/frame-0 skipped FIXED, FA10/walk limp partial boundary FIXED, FA11/idle inter-cycle delay FIXED 2026-06-03; FA12/per-orientation weapon-draw pixel drift Y-height correction + clearAnim formula FIXED 2026-06-04)
>
> Update this file when: closing a bug, adding a stub, or after any sprint
> that touches scripting, combat, or worldmap.

Sources: `CODEBASE.md` Known Gaps, `TODO.md`, `wiki/CROSS_CHECK_NOTES.md`,
grep of `stub()` / `console.warn` / TODO in `src/`.

---

## Legend

| Field | Values |
|-------|--------|
| **Status** | `bug` wrong vs CE ground truth · `stub` method exists, does nothing · `partial` incomplete implementation · `missing` not started |
| **Severity** | `blocking` crashes or prevents play · `major` visible gameplay deviation · `minor` polish / edge-case |

Items marked ✅ in this document have been confirmed fixed since the last audit.
Items marked 🔶 are addressed on an unmerged branch.

---

## 1. Combat System

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| C1 | **Sniper perk uses d100 instead of d10.** FIXED 2026-06-02 — changed to `getRandomInt(1, 10) <= LUK`. CE ref: `combat.cc:3891 randomBetween(1, 10)`. | `combat.ts:499` | `combat.cc:3891–3897` | major | fixed |
| C2 | **Critical hit level formula uses uniform `/20` thresholds.** FIXED 2026-06-02 — uses CE's non-uniform breakpoints: ≤20→0, ≤45→1, ≤70→2, ≤90→3, ≤100→4, >100→5. Roll is `d100 + BetterCriticals`. CE ref: `combat.cc:4102 attackComputeCriticalHit()`. | `combat.ts:505` | `combat.cc:4102–4118` | major | fixed |
| C3 | **YAAM damage formula now matches CE.** FIXED 2026-06-02 — (a) `/2` halving step added after divisor; (b) DT subtracted BEFORE multiply (CE line 6795); (c) ammoRM adjusts DT not DR: `calcDT = DT - ammoRM`; if `calcDT < 0` → extra DR = `abs(calcDT) * 10`. All three divergences corrected. CE ref: `combat.cc:6767-6814 damageModCalculateYaam`. | `combat.ts` | `combat.cc:6767–6813 damageModCalculateYaam()` | minor | fixed |
| C4 | **Melee/unarmed hit-location penalty now halved.** FIXED 2026-06-02 — `getHitChance()` checks weapon skill type; ranged (Small/Big/Energy Guns, Throwing) uses full `regionHitChanceDecTable[region]`; melee/unarmed uses `floor(penalty/2)`. CE ref: `combat.cc:4437-4440 attackDetermineToHit`. | `combat.ts` | `combat.cc:4440 attackDetermineToHit()` | minor | fixed |
| C5 | **No separate melee critical table — original entry was incorrect.** VERIFIED 2026-06-02: CE's `attackComputeCriticalHit` (`combat.cc:4089`) uses `gCriticalHitTables[killType][hitLocation]` for all weapon types — there is no melee-specific variant. The `TODO` comment in `criticalEffects.ts:49` referred to the hit-location penalty halving, which was fixed by C4. DH2 is correct. | `criticalEffects.ts:49` | `combat.cc:4089 attackComputeCriticalHit()` | minor | fixed |
| C6 | **Party member combat AI now wired (2026-06-02).** Friendly-team critters (teamNum = player.teamNum) are enrolled in combat, skipped from the enemy `numActive` count, and get full AI turns via `doAITurn()`. They target the nearest enemy via `findTarget()`. CE ref: `party.cc partyMemberGetCombatants`. Outstanding: no CHA-based squad-cap enforcement, no companion level-up, no formation pathfinding. | `combat.ts:1493,1560` | `combat.cc`, `party.cc` | major | partial |
| C7 | **AI team targeting still partially broken.** FIXED 2026-06-02 — `execEncounter()` now sets `obj.hostile = true` for critters in groups with `target === 'player'`; the `Combat` constructor enrolls `hostile === true` critters regardless of `teamNum`, so encounter enemies with `teamNum = -1` now correctly participate. Critters that are not encounter-spawned and have no `team_num` in ai.txt still default to teamNum=-1 and may not enroll if not pre-marked hostile. | `worldmap.ts:411`, `combat.ts:285` | `ai.cc aiGetAttackTarget()` | major | partial |
| C8 | **Wander-type radius now differentiated** FIXED 2026-06-04 — `main.ts` wander tick now captures `wanderOrigin` lazily and caps movement to type 1=5 hex / type 2=15 hex / type 3=unrestricted. Prefers neighbours inside the radius. CE ref: `ai.cc` wander\_type. | `main.ts`, `object.ts` | `ai.cc` | minor | fixed |
| C9 | **DAM\_DROP implemented** (verified 2026-06-02). `critterEffects.droppedWeapon()` (`criticalEffects.ts:193`) removes weapon and places it on the ground. Wired into `criticalFailTable` for melee/firearms/energy/grenades; called via `temporaryDoCritFail()` from `combat.ts:932`. | `combat.ts`, `criticalEffects.ts` | `combat.cc` | minor | fixed |
| C10 | **Unarmed special moves defined but no combat logic.** `unarmed.ts` defines 9 modes (Haymaker, Jab, etc.) with threshold/AP/damage tables. None of the mode-specific hit or damage bonuses are applied during combat. | `unarmed.ts` | `unarmed.cc` | minor | partial |
| C11 | **Sequence formula was wrong in sort.** FIXED 2026-06-02 — `combat.ts` sort was using `10 + 2*PER` inline; changed to `getStat('Sequence')` which correctly uses `2*PER` (CE ref: `stat.cc:572`). Comment also corrected. | `combat.ts:295` | `stat.cc:572` | minor | fixed |
| C12 | **AI perception range gate added.** FIXED 2026-06-02 — `findTarget()` now filters candidates to `PER*5` tile max; targets beyond `PER*2` tiles require LOS (`hasLineOfSight()`). Matches CE `combat_ai.cc isWithinPerception` logic. | `combat.ts:1045` | `combat_ai.cc:_ai_danger_source, isWithinPerception` | minor | fixed |
| C13 | **DISTANCE_STAY_CLOSE added.** FIXED 2026-06-04 — `DistanceMode` extended with `'stay_close'`; `doAITurn()` walks the companion toward a free neighbour of the player when distance > 5. SNIPE (2026-06-02) and CHARGE (default) already wired. CE ref: `combat_ai.cc:2985 _cai_perform_distance_prefs DISTANCE_STAY_CLOSE`. | `combat.ts`, `aiPackets.ts` | `combat_ai.cc:_cai_perform_distance_prefs` | minor | fixed |

---

## 2. Scripting VM — Stub Opcodes

All entries below are wired in `vm_bridge.ts` and have a corresponding method in `scripting.ts` that calls `stub()` or silently no-ops for the listed cases. See `CODEBASE.md §Scripting VM — Opcode Coverage` for per-case detail.

| ID | Opcode / Method | File(s) | What's missing | Sev | Status |
|----|-----------------|---------|----------------|-----|--------|
| S1 | `metarule` | `scripting.ts:512` | Sub-ops 13/14/15/16/17/18/19/22/40/44/45/46/47/48/49/50/51 handled (2026-06-02: added 13=end_game, 16=party_count, 19=map_known, 40=skill_check_tag, 44/45=worldmap_pos, 47=lang_filter, 50=critter_barters, 51=critter_kill_type). Car-related IDs 30/31/32/52/53 still stub (car system absent). | major | partial |
| S2 | `metarule3` IMPROVED 2026-06-04 | `scripting.ts:621` | Sub-ops handled: 100 (clr_fixed_events), 103 (get_kill_count), 106 (tile_get_next_critter), 107 (art_set_base_fid_num — added 2026-06-04, rebuilds art path via `lookupArt`), 108 (tile_set_center). IDs 101/102/104/105/109-111 still stub. | minor | partial |
| S3 | `get_critter_stat` | `scripting.ts:608` | **FIXED 2026-06-04** — STAT_AGE (33) now returns `25 + gameTime / TICKS_PER_YEAR` (CE `stat.cc:244`). Sequence (13) fixed 2026-06-02. 27+ stat IDs handled. | major | fixed |
| S4 | `has_trait` | `scripting.ts:640` | **FIXED 2026-06-02** — `TRAIT_OBJECT` cases 5 (AI packet), 6 (team num), 10 (rotation), 666 (visibility), 669 (inventory weight) all handled. Non-`TRAIT_OBJECT` types still call `stub()`. CE ref: `interpreter_extra.cc opHasTrait`. | major | partial |
| S5 | `critter_add_trait` | `scripting.ts:672` | **FIXED 2026-06-04** — TRAIT_PERK (kind=0) added: add/remove perks on the player via `applyPerk`/`perks.splice` using `PERKS[trait]` index. TRAIT_OBJECT cases 5/6/10/666/669 already wired 2026-06-02. CE ref: `interpreter_extra.cc:2859 opCritterAddTrait`. | minor | fixed |
| S6 | `using_skill` | `scripting.ts:836` | **FIXED 2026-06-02** — SKILL_SNEAK (8) on player returns `isSneaking`. All other combos return 0 per CE: "uninitialized result" for non-dude/non-sneak. CE ref: `interpreter_extra.cc:579 opUsingSkill`. | minor | fixed |
| S7 | `do_check` | `scripting.ts:819` | **FIXED 2026-06-02** — implements CE `stat.cc::statRoll()`: roll d10 (1–10), success if roll ≤ SPECIAL stat + modifier. Only stat indices 0–6 (SPECIAL) accepted; others return failure. | major | fixed |
| S8 | `inven_cmds` FIXED 2026-06-02 | `scripting.ts:1015` | CE only has cmd=13 (`INVEN_CMD_INDEX_PTR`); now returns `obj.inventory[itemIndex]`. Unknown cmds still call `stub()`. | minor | fixed |
| S9 | `set_pc_stat` | `scripting.ts:994` | **FIXED 2026-06-02** — all 5 writable PCSTAT IDs handled: 0 (skill points), 1 (level, direct set), 2 (experience, direct set), 3 (reputation), 4 (karma). CE ref: `stat.cc pcSetStat()`. | minor | fixed |
| S10 | `mod_pc_stat` | `scripting.ts:1010` | **FIXED 2026-06-02** — all 5 IDs handled: 0 (skill points additive), 1 (level additive), 2 (experience via `addExperience` — triggers level-up loop), 3 (reputation), 4 (karma). CE ref: `scripts.cc opModifyPcStat()`. | minor | fixed |
| S11 | `anim` | `scripting.ts:1338` | **FIXED 2026-06-04** — Reverse direction now threaded through animBatch (`AnimStep.reversed`) and passed to `singleAnimation(reversed)`. Combined with 2026-06-02 fixes: IDs 1000/1010 and anim types 0–64 all handled, both forward and reverse playback. CE ref: `interpreter_extra.cc:3355 opAnim` / `animationRegisterAnimateReversed`. | major | fixed |
| S12 | `proto_data` name/description FIXED 2026-06-02 | `scripting.ts:1228` | Cases 1 (name) and 2 (description) added for both items and critters using `getMessage('pro_item/crit', textID / textID+1)`. CE has no case 9 for critters (wiki was incorrect). All known CE cases now handled for items, critters, and scenery. | major | fixed |
| S13 | `reg_anim_func` | `scripting.ts:1592`, `vm_bridge.ts:76` | FIXED 2026-06-02: `reg_anim_end` now drains batch in registration order; `func` entries fire immediately before the next `animate` step (CE `animationRegAnimFunc` behavior). | major | fixed |
| S14 | `reg_anim_animate` delay parameter. Verified 2026-06-02: batch path (`reg_anim_begin/end`) applies `step.delay * 100ms` via `setTimeout`. Legacy non-batch path (script error) ignores delay. CE ref: `animation.cc:1374 animationDescription->delay--`. | `scripting.ts:1843,1847` | `animation.cc:1374` | minor | partial |
| S15 | `play_gmovie` | `scripting.ts:1768` | Logs a skip message and returns; `.mve` video playback infrastructure does not exist | minor | stub |
| S16 | `obj_art_fid` returns `obj.frmPID ?? 0` (verified 2026-06-02). | `scripting.ts` | — | minor | fixed |
| S17 | `art_anim` returns `(fid >>> 16) & 0xFF` per CE `art.cc` bit layout (verified 2026-06-02). | `scripting.ts` | — | minor | fixed |
| S18 | `obj_item_subtype` returns `pro.extra.subType ?? pro.extra.subtype ?? null` (verified 2026-06-02). | `scripting.ts` | — | minor | fixed |
| S19 | `tile_contains_pid_obj` correctly implemented and wired (verified 2026-06-02). Iterates map objects at elevation, matches position and PID. No stub() call. | `scripting.ts:1415` | — | minor | fixed |
| S20 | `tile_is_visible` VERIFIED DONE | `scripting.ts:1481` | Already uses `Lightmap.tile_intensity[tile] > 0 ? 1 : 0` — wiki entry was stale. | minor | fixed |
| S21 | `set_exit_grids` | `scripting.ts:1306`, `vm_bridge.ts:0x80E6` | FIXED 2026-06-02: opcode wired (`vm_bridge.ts`). Method writes to `map.exitGrids`; area-screen re-entry visual correctness still unverified. | minor | partial |
| S22 | `gdialog_set_barter_mod` | `scripting.ts:1535` | **VERIFIED WIRED 2026-06-02** — `dialogueBarterMod` module-level var is set by `gdialog_set_barter_mod`; `ui_barter.ts:319` reads it via `Scripting.getDialogueBarterMod()`. Works correctly. (Wiki entry was stale.) | major | fixed |
| S23 | `game_ui_disable` / `game_ui_enable` FIXED 2026-06-02 | `main.ts:722`, `scripting.ts` | `gameUIDisabled` flag now checked in both `heart.mousepressed` (already done) and `heart.keydown` (added 2026-06-02). All player input blocked when set. | minor | fixed |
| S24 | `wm_area_set_pos` FIXED 2026-06-02 | `scripting.ts:1970`, `worldmap.ts:440` | Area elements now tagged with `data-area-key`; `Worldmap.updateAreaMarkerPos()` called from `wm_area_set_pos` to update the DOM marker position immediately. | minor | fixed |
| S25 | `critter_attempt_placement` now searches adjacent tiles when target is occupied (verified 2026-06-02). Matches CE `critter.cc critterAttemptPlacement()`. | `scripting.ts:929` | — | minor | fixed |
| S26 | `get_poison` / `poison` | `scripting.ts` | Script read/write of `poisonLevel`; no CE-accurate decay loop (though `main.ts` does decrement 1/cycle) | minor | partial |
| S27 | `radiation_dec` | `scripting.ts` | Scripted radiation decrease; deliberately deferred | minor | stub |

---

## 3. Map System & Script Events

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| M0 | **Missing `.images.json` threw fatally, corrupting all subsequent map loads.** `loadNewMap` propagated a 404 exception synchronously, leaving `this.objects = null` and `isLoading = true` permanently. Any following map load then crashed on `serialize()` calling `.map()` on null. | `src/map.ts` | — | major | **FIXED 2026-06-02** |
| M0b | **`serialize()` called when `objects === null` after a failed previous load.** Guard at `loadMap` dirty-cache branch now checks `this.objects !== null` before serializing. | `src/map.ts` | — | major | **FIXED 2026-06-02** |
| M1 | **Spatial triggers persist across save/load.** FIXED (Phase 1/3/7 sprint, 2026-06-02) — `SerializedMap.spatials` now stores all elevations; `deserialize()` re-creates spatials from script names and reapplies saved LVARs. CE ref: `map.cc spatialLoad()`. | `map.ts:deserialize` | `map.cc spatialLoad()` | major | fixed |
| M2 | **`map_enter_p_proc` on elevation change.** VERIFIED CORRECT 2026-06-02 — CE `mapSetElevation` (map.cc:362) calls only `scriptsExecMapUpdateProc()`, never `map_enter_p_proc`. DH2's `changeElevation` calls `updateMap()` which fires `map_update_p_proc`. Behaviour is correct; TODO comment in `map.ts:555` can be ignored. | `map.ts:555` | `map.cc:362 mapSetElevation()` | minor | fixed |
| M3 | **Scripting engine not notified when `objectsAndSpatials` updates.** FIXED 2026-06-02 — `addObject()` now calls `obj.enterMap()` after inserting, firing `map_enter_p_proc` for newly-spawned scripted objects. `enterMap()` is a no-op for objects without scripts. | `map.ts:103` | — | minor | fixed |
| M4 | **`map_exit_p_proc` now declared and fired.** FIXED 2026-06-02 — added `map_exit_p_proc` to `Script` class proc prototype list; `loadNewMap()` calls it on the outgoing map script before teardown, matching CE `map.cc:1440 scriptsExecMapExitProc()`. | `src/scripting.ts:420`, `src/map.ts` | `scripts.cc:2673 scriptsExecMapUpdateScripts()`; `scripts.h:65 SCRIPT_PROC_MAP_EXIT` | minor | fixed |

---

## 4. World Map & Encounters

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| W1 | **Time-of-day encounter frequency now correct.** FIXED 2026-06-02 — `parseSquare()` reads all 3 frequency slots into `square.frequencies[0..2]` (morning/afternoon/night). `didEncounter()` selects the slot matching CE's `dayPart` logic: night if hour≥1800 or <600, afternoon if hour≥1200, else morning. CE ref: `worldmap.cc:1956 wmParseSubTileInfo`, `worldmap.cc:3395 dayPart`. | `worldmap.ts` | `worldmap.cc:1943 wmParseSubTileInfo()` | major | fixed |
| W2 | **Encounter occurrence difficulty modifier.** FIXED 2026-06-02 — `didEncounter()` now adjusts `encRate` by `±encRate/15` based on `Config.combat.difficultyModifier` (75=easy, 100=normal, 125=hard). CE ref: `worldmap.cc:3322 wmRndEncounterOccurred`. | `worldmap.ts:448` | `worldmap.cc:3322 wmRndEncounterOccurred()` | minor | fixed |
| W3 | **Encounter-spawned critters have no items or equipment.** FIXED 2026-06-02 — `execEncounter()` now iterates `critter.items` after `createObjectWithPID`; calls `addInventoryItem()` per item, then promotes the `wielded` weapon to `leftHand` and refreshes `art`. CE ref: `worldmap.cc:3771 wmSetupCritterObjs()`. | `worldmap.ts:414`, `encounters.ts` | `worldmap.cc:3771 wmSetupCritterObjs()` | major | fixed |
| W4 | **Encounter counter now tracked.** FIXED 2026-06-02 — `Encounter` interface gains `counter` field (parsed from INI, default −1=unlimited); `pickEncounter` filters out `counter===0` entries and decrements `counter > 0` after selection. CE ref: `worldmap.cc:3579,3636`. | `encounters.ts`, `worldmap.ts` | `worldmap.cc:3579,3636` | minor | fixed |
| W5 | **Condition system improved.** FIXED 2026-06-02 — `player(level)` now returns actual player level; `time_of_day` returns real game hour (0–23) via `getHourMilitary()/100`; `==`, `!=`, `<=`, `>=`, `or` operators added to the `op` map. CE ref: `worldmap.cc wmParseEncounterTableIndex`. | `encounters.ts:196,208` | `worldmap.cc wmParseEncounterTableIndex()` | major | partial |
| W6 | **Encounter formations FIXED 2026-06-02.** `positionCritters()` now implements all 6 formations: `surrounding`, `huddle` (existing), and `straight_line`, `double_line`, `wedge`, `cone` (new). Two-cursor state machine (rotOffsets=[1,5], alternating centers/dirs) matches CE `worldmap.cc:4008-4042 wmSetupRndNextTileNum`. | `encounters.ts:357` | `worldmap.cc:4008-4042 wmSetupRndNextTileNum` | minor | fixed |
| W7 | **Outdoorsman detection check — XP FIXED 2026-06-02; avoidance dialog absent.** `didEncounter()` now runs the two-stage CE check after the base roll: Outdoorsman skill + Motion Sensor bonus (+20, PID 59), capped at 95, + `square.difficulty`; awards `100-outdoorsman` XP on success. CE "do you wish to encounter it?" avoidance dialog still not implemented — every rolled encounter is still forced. | `worldmap.ts:459` | `worldmap.cc:3450 wmRndEncounterOccurred()` | major | partial |
| W8 | **Car travel system absent.** No car fuel, no car-speed multipliers, no car encounter-rate reduction. | `worldmap.ts` | `worldmap.cc:5984 wmCarUseGas()` | major | missing |
| W9 | **Area entrance positions misplaced on area screens.** Documented in README; world map area click positions do not align with the rendered overlay markers. | `ui_worldmap.ts`, `worldmap.ts` | — | minor | bug |
| W10 | **Walk masks not loaded.** Each world-map tile can specify a `walk_mask_name` (`.msk` file, 300×44 bytes) marking impassable terrain pixels. DH2 never loads `.msk` files. Player can walk through mountains and other impassable-terrain pixels on the world map. | `src/worldmap.ts` | `worldmap.cc:1337 wmGrabTileWalkMask()`; `worldmap.txt walk_mask_name` | minor | missing |

---

## 5. Skills & Stat Checks

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| K1 | **Healer perk applied in First Aid / Doctor.** VERIFIED 2026-06-02 — `skillUse.ts:228` and `:318` both read `user.perks.filter(p => p === 'Healer').length`; heal range adjusts by +4 min/+10 max per rank. Wiki entry was stale. | `skillUse.ts:228,318` | `skill.cc skillUse()` | minor | fixed |
| K2 | **Gambling and Outdoorsman have no interactive handler.** FIXED 2026-06-03 — Added context-appropriate messages: Gambling → "You need to find somewhere to gamble." (CE: only at gambling tables); Outdoorsman → "Outdoorsman skill applies when traveling." (CE: world-map encounter avoidance only). | `skillUse.ts` | `skill.cc` | minor | fixed |
| K3 | **Steal facing check FIXED 2026-06-02.** Added facing penalty (-25 if face-to-face: `abs(user.orientation - target.orientation) % 6 ∉ {0,1,5}`) and knocked-down bonus (+20), matching CE `skill.cc:1043-1050`. Pickpocket perk bypasses the facing penalty. Item-size penalty (-4×size) still absent (no item-select UI). | `skillUse.ts:440` | `skill.cc:1037 skillsPerformStealing()` | minor | partial |
| K4 | **Expanded Lockpick Set / Electronic Lockpick not modelled.** Lockpick skill check does not distinguish between tool types. | `skillUse.ts` | `skill.cc` | minor | partial |
| K5 | **"Melee" → "Melee Weapons" remap VERIFIED DONE.** `char.ts:62-65 SkillSet.fromPro()` already remaps `Melee` to `Melee Weapons` at PRO load time. No mismatch in practice. | `char.ts:62` | — | minor | fixed |

---

## 6. Dialogue System

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| D1 | **`gdialog_mod_barter(mod)` now passes mod through.** FIXED 2026-06-02 — sets `dialogueBarterMod = mod` before opening barter screen, matching CE `game_dialog.cc:3163 gameDialogBarter` which sets `_dialogBarterMod = mod`. Scripts that call `gdialog_mod_barter(mod)` directly (without a prior `gdialog_set_barter_mod`) now get the correct markup. | `scripting.ts:1560` | `game_dialog.cc:3163 gameDialogBarter()` | minor | fixed |
| D2 | **Barter formula now CE-accurate.** FIXED 2026-06-02 — `ui_barter.ts` implements CE `_barter_compute_value`: `(160+npcBarter)/(160+playerBarter) × costWithoutCaps×2 + caps`, scaled by `barterModMult = (scriptMod+reactionMod+100-perkBonus)×0.01`. Player Barter gets difficulty bonus (Easy+20, Hard-10). Reaction reads merchant LVAR 0 (>+10 → −15%, <−10 → +25%). Master Trader perk: +25 to multiplier denominator. CE ref: `inventory.cc:4673 _barter_compute_value`. | `ui_barter.ts:314` | `inventory.cc:4673 _barter_compute_value()` | major | fixed |
| D3 | **No dedicated Barter button in dialogue UI.** FIXED 2026-06-02 — `gsay_end()` checks `CRITTER_BARTER` flag (0x02) on `currentDialogueObject.pro.extra.flags`; if set, injects a `[Barter]` option that calls `uiBarterMode()`. CE ref: `game_dialog.cc:3662 _gdCanBarter()`. | `scripting.ts:1706` | `game_dialog.cc:3662 _gdCanBarter()`, `obj_types.h:93` | major | fixed |

---

## 7. Party & NPC Systems

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| P1 | **Party member combat AI wired (2026-06-02).** Party members on the player's team now participate in combat: they receive AI turns via `doAITurn()`, skip enemy counters, and target enemies via `findTarget()`. See C6 for remaining gaps. | `combat.ts:1493,1560` | `combat.cc`, `party.cc` | major | partial |
| P2 | **NPC time-of-day schedules not implemented.** Critters with `wander_type > 0` do a simple random-hex wander. CE assigns each NPC a fixed schedule (home/work/sleep positions keyed by hour). | `main.ts:1099` | `scripts.cc`, `ai.cc` | major | missing |
| P3 | **Party companion AI partial.** PARTIAL 2026-06-04 — CHA-based size cap enforced in `addPartyMember`; `followPlayer` now pathfinds to nearest free hex adjacent to player; `dismissPartyMember` helper added and `party_remove` opcode now silently no-ops when obj isn't in party (CE behaviour). Still missing: companion level-up, formation pathfinding. | `party.ts` | `party.cc` | major | partial |
| P4 | **Speech audio / subtitles not implemented.** `Config.ui.subtitles = false`. No `.acm` speech playback path; `audio.ts` handles music/SFX only. | `audio.ts`, `config.ts` | `sound.cc` | minor | missing |

---

## 8. Audio System

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| AU1 | **`rollNextSfx` crashed on null/undefined/empty `ambientSfx`.** Maps without ambient SFX entries return `ambientSfx: null` or `[]`; the old guard only checked `sfx.length` (throws on null), and `sfx[0][0]` would crash on empty arrays. Two guards added: early return on `!sfx` or `sfx.length === 0`, and early return when `sumFreqs === 0`. | `src/audio.ts` | `game_sound.cc` | major | **FIXED 2026-06-02** |

<!-- audited: 2026-06-02 -->

---

## 9. Time System

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| T1 | **Combat time advances by wall-clock, not turn count.** `events.ts:45` comment: "TODO: advance by combat turns instead." TimedEvents tick faster or slower depending on combat speed rather than a fixed per-turn increment. | `events.ts:45` | `scripts.cc` | minor | bug |

---

## 10. UI / Options

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| U1 | **Preferences screen not implemented.** The `P` shortcut and the Options button both call `alert('not yet implemented')`. Config fields for difficulty, violence level, combat speed, subtitles exist but cannot be changed in-game. | `ui_options.ts` | `preferences.cc` | major | missing |
| U2 | **Volume control absent.** `audio.ts` has play/stop infrastructure but no `GainNode` on the `AudioContext`. Master / music / SFX volume sliders cannot be wired until this is added. | `audio.ts` | `sound.cc` | minor | missing |
| U3 | **Save slot screenshots not saved.** `saveload.ts` saves game state but does not capture a screenshot for the save slot thumbnail. | `saveload.ts` | `loadsave.cc` | minor | missing |
| U4 | **HUD reload AP hardcoded to 2. FIXED 2026-06-03** — See IW6. `Weapon.getReloadAPCost()` now reads `pro.extra.perk` and `weapon.pid` to handle Fast Reload (→1) and Solar Scorcher (→0) cases. | `src/critter.ts`, `src/ui_hud.ts`, `src/ui.ts` | `item.cc:1640 weaponGetActionPointCost` | minor | fixed |
| U5 | **MVARs not persisted on save.** FIXED 2026-06-02 — `Scripting.getMapVars()`/`setMapVars()` added; `SaveGame.mvars` serialized in `saveload.ts`. | `saveload.ts`, `scripting.ts` | `map.cc::mapSave` | major | fixed |
| U6 | **`knownAreas` not persisted on save.** FIXED 2026-06-02 — `SaveGame.knownAreas` serialized as `number[]`; restored as `new Set()` on load. | `saveload.ts` | `worldmap.cc` | major | fixed |
| U7 | **Timed events not persisted on save.** FIXED 2026-06-02 — `SaveGame.timedEvents` serializes each event as `{ objPid, ticks, userdata }`. On load, script events are reconstructed by matching `objPid` to deserialized map objects; drug events (`drug:NAME`, `drug:delayed:NAME`) are reconstructed via `getDrugByName()`. CE ref: `scripts.cc scriptsSaveProcedureNames`. | `saveload.ts`, `scripting.ts`, `drugs.ts` | `scripts.cc` | major | fixed |

---

## 11. Karma & Reputation

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| R1 | **Karma title sync FIXED 2026-06-02.** `ui_character.ts` already has `KARMA_TITLES` table (verified). Gap was script-written karma (`set_global_var(0, N)`) not syncing to `player.stats('Karma')`. Fixed: `set_global_var` now syncs GVAR 0 → `player.stats.setBase('Karma', N)` so the character sheet title updates from script karma changes. | `scripting.ts:443` | `game.cc:995 gameSetGlobalVar` | minor | fixed |
| R2 | **No per-town reputation tracking.** Town Reputation stat exists. No per-faction delta table; no string lookup for town reputation titles. | `player.ts`, `scripting.ts` | `karma.cc` | minor | missing |

---

## 12. Type Hygiene (low-priority but tracked)

These are `any`-typed fields and `throw 'TODO'` sites that do not produce visible bugs today but represent technical debt that can mask future bugs.

| ID | Description | File(s) | Sev | Status |
|----|-------------|---------|-----|--------|
| Q1 | **`WeaponObj.getAttackSkin()` no longer throws.** FIXED 2026-06-02 — changed `throw 'TODO'` to `return null` when `attackOne` is absent. Caller `getAnim('attack')` already handles null skin gracefully. | `critter.ts:386` | major | fixed |
| Q2 | `set_critter_stat` opcode now wired. FIXED 2026-06-02 — `0x80CB` wired in `vm_bridge.ts`; `set_critter_stat(obj, stat, value)` adds `value` to player's current base+trait stat (player-only per CE). `critter_mod_skill` (0x813C) was already wired. `critterSetRawStat`/`critterSetRawSkill` in `critter.ts` are dead code (not called). CE ref: `interpreter_extra.cc:1313 opSetCritterStat`. | `vm_bridge.ts`, `scripting.ts` | major | fixed |
| Q3 | **Ladder destination reads tile number only; elevation and map bits ignored.** FIXED 2026-06-02 — ladder now decodes `destElev = ((dest >> 28) & 0xf) >> 1` (same format as stairs), passes it to `changeElevation()`, and checks `destinationMap != -1` for cross-map ladders. CE ref: `proto_instance.cc:1512 useLadderDown/Up`. | `object.ts:797` | `proto_instance.cc:1512` | minor | fixed |
| Q4 | **`WeaponObj` now serializes firing mode.** FIXED 2026-06-02 — Added `WeaponObj.serialize()` that persists `weapon.mode` as `weaponMode`, and `fromMapObject` restores it on deserialization. `leftHand`/`rightHand` are re-derived from inventory on load (already correct). `pro.extra.rounds` (ammo count) was already covered via `pro` serialization. | `object.ts` | — | major | fixed |

---

## 13. Time & Game Clock

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| GTC1 | **`game_time_hour` opcode.** FIXED 2026-06-02 — opcodes 0x80F6 and 0x80a8 now call `GameTime.getHourMilitary()` → `100*hour+min` (0–2359). CE ref: `scripts.cc:332 gameTimeGetHour()`. | `vm_bridge.ts:53-54` | `scripts.cc:332` | major | fixed |
| GTC2 | **`game_time_advance` queue processing.** FIXED 2026-06-02 — on time advance, subtracts advanced ticks from each pending `timeEventList` entry and fires any that expire. CE ref: `interpreter_extra.cc:2761 opGameTimeAdvance` — `queueProcessEvents()` per day. Full midnight event (door unjam, radiation) still absent (GTC5). | `scripting.ts:game_time_advance` | `interpreter_extra.cc:2761` | minor | partial |
| GTC3 | **`set_light_level` piecewise mapping.** FIXED 2026-06-02 — `setLightLevelOverride()` now uses CE's piecewise formula: level≤50 maps to `[MIN, mid]` range, level>50 maps to `[mid, MAX]` range (mid=40960). CE ref: `interpreter_extra.cc:2233 opSetLightLevel`. Outdoor map ignore still in place (intentional DH2 deviation). | `gametime.ts:234` | `interpreter_extra.cc:2233` | minor | fixed |
| GTC4 | **`days_since_visited` (0x811B) wired.** FIXED 2026-06-02 — `GameMap.lastVisitTime` field added; set to `gameTickTime` on serialize (map exit), restored on deserialize. Opcode returns `-1` for never-visited maps, else `floor((now - lastVisitTime) / TICKS_PER_DAY)`. CE ref: `interpreter_extra.cc:3734 opGetDaysSinceLastVisit`. | `src/map.ts`, `src/scripting.ts`, `vm_bridge.ts:0x811B` | `interpreter_extra.cc:3734` | minor | fixed |
| GTC5 | **No midnight queue event.** PARTIAL 2026-06-03 — `main.ts` detects day transitions and fires: `objectUnjamAll()` (IU3 now implemented); `_scriptsCheckGameEvents()` (ARTIMER movies) not yet implemented; radiation deferred. CE ref: `scripts.cc:405 gameTimeEventProcess`. | `main.ts:1035` | `scripts.cc:405 gameTimeEventProcess` | minor | partial |
| GTC6 | **Starting month is August (DH2) vs July (CE).** FIXED 2026-06-02 — `START_MONTH` changed from 7 to 6 (0-indexed July). CE ref: `sfall_config.cc:31 gStartMonth = 6`. | `gametime.ts:36` | `sfall_config.cc:31` | minor | fixed |
| GTC7 | **No 13-year endgame timeout.** FIXED 2026-06-02 — `main.ts` didTick block now checks `gameTickTime >= 13 * TICKS_PER_YEAR`; calls `Endgame.setupDeathEnding(DEATH_REASON_TIMEOUT)` then `Endgame.playDeathEnding()`. CE ref: `scripts.cc:368 gameTimeAddTicks`. | `main.ts:1031` | `scripts.cc:368` | minor | fixed |
| GTC8 | **Pathfinder perk does not reduce worldmap travel time.** FIXED 2026-06-02 — `pathfinderRank * 0.25` reduction applied per tick (CE worldmap.cc:4180). Rank is `player.perks.filter(…).length`. | `worldmap.ts:697` | `worldmap.cc:4178` | minor | fixed |
| GTC9 | **`game_time_in_seconds` (0x80EB) wired.** FIXED 2026-06-02 — returns `GameTime.getTotalSeconds()` (ticks / 10). CE ref: `interpreter_extra.cc:2277 opGetGameTimeInSeconds`. | `vm_bridge.ts:0x80EB` | `interpreter_extra.cc:2277` | low | fixed |
| GTC10 | **Day/night ambient light curve is a DH2 invention.** CE has no clock-driven ambient curve; only script-controlled `set_light_level`. | `gametime.ts:181` | `light.cc`, `map.cc:927` | low | deviation |

<!-- audited: 2026-06-02 -->

---

## 14. Elevation System

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| EL0 | **`override_map_start` wrote out-of-bounds elevation before bounds check.** Script calls `override_map_start(pos, elev)` with `elev=2` on a 2-level map (indices 0–1) — value was blindly assigned to `currentElevation`, causing `getObjects()` to return `undefined` and crash on `.length`. Also guards `loadMap` dirty-cache path. | `src/map.ts` | `map.cc mapSetupEnter()` | major | **FIXED 2026-06-02** |
| EL1 | **`elevation(obj)` returns correct per-object elevation.** FIXED 2026-06-02 — `Obj.elevation` field added; set from level index on map load (`loadNewMap`, `deserialize`) and updated in `changeElevation`. `scripting.ts:elevation()` now returns `obj.elevation`. CE ref: `interpreter_extra.cc:2285 opGetObjectElevation()`. | `src/object.ts`, `src/map.ts`, `scripting.ts:elevation` | `interpreter_extra.cc:2285` | major | fixed |
| EL2 | **`doEnterElevation()` fires `map_enter_p_proc` on stair/ladder elevation change.** FIXED 2026-06-02 — replaced `doEnterElevation()` with `updateMap()` at all three stair/ladder sites in `object.ts`. CE `mapSetElevation` (map.cc:386) only calls `scriptsExecMapUpdateProc` (= `map_update_p_proc`). | `object.ts:791,808,815` | `map.cc:362 mapSetElevation()` | major | fixed |
| EL3 | **Elevator door animation not reset on level change.** DH2 has `useElevator()` → `uiElevator()` wired via `metarule(15)`; same-map/cross-map split works. CE additionally finds nearby elevator door scenery (PIDs `0x2000099/0x20001A5/0x20001D6`) and resets their frame/flags on level change. DH2 omits this door reset. | `main.ts:1165 useElevator()` | `scripts.cc:926 scriptsHandleRequests SCRIPT_REQUEST_ELEVATOR` | low | partial |
| EL4 | **`_map_data_elev_flags` bitmask not in DH2 map format.** CE stores per-elevation empty/present state in `MapHeader.flags`. DH2 uses `levels` array length only; empty elevations cannot be represented. | `map.ts:435` | `map.cc:81 _map_data_elev_flags` | low | missing |
| EL5 | **`map_update_p_proc` fires only on current-elevation objects.** FIXED 2026-06-02 — `updateMap()` now concatenates all elevation arrays before passing to `Scripting.updateMap`. CE ref: `scripts.cc:2601 scriptsExecMapUpdateScripts` iterates all `gScriptLists` entries regardless of elevation. | `map.ts:195` | `scripts.cc:2601 scriptsExecMapUpdateScripts()` | minor | fixed |

<!-- audited: 2026-06-02 -->

---

## 15. FRM Animation Pipeline

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| FA0 | **`animInfo` missing `'single'` key — `singleAnimation()` critters froze.** `singleAnimation()` sets `this.anim = 'single'` for one-shot forward playback, but `'single'` was absent from `animInfo`, causing the tombstone guard to fire and freeze critters (e.g. nachldaa/nachldba on Klamath). Fixed: `'single': { type: 'static' }` added. | `src/object.ts` | `animation.cc anim_run_sequence()` | minor | **FIXED 2026-06-02** |
| FA0b | **Unknown `anim` key caused `TypeError` on every rAF frame.** When `animInfo[this.anim]` was `undefined` (stale save state or script bug), accessing `.type` threw on every animation frame, hammering the console and locking the critter. Fixed: tombstone guard sets `anim='dead'`. | `src/object.ts` | — | minor | **FIXED 2026-06-02** |
| FA0c | **`Obj` base class had no `hasAnimation()` method.** `scripting.ts:use_obj_on_obj` passes any `Obj` as source (via `as Critter` cast); non-Critter objects (encdet, encfite, encpres) crashed with `source.hasAnimation is not a function`. Fixed: `Obj.hasAnimation()` stub added returning `false`. | `src/object.ts` | — | minor | **FIXED 2026-06-02** |
| FA1 | **`updateStaticAnim` hardcodes fps = 8.** FIXED 2026-06-02 — changed to `globalState.imageInfo[this.art]?.fps \|\| 8`, matching `updateLoopingAnim`. CE ref: `art.cc:713 artGetFramesPerSecond()`. | `object.ts:1359` | `art.cc:713 artGetFramesPerSecond()` | minor | fixed |
| FA2 | **`getAnimDistance` used wrong direction anchor, causing walk snap-back.** RE-FIXED 2026-06-03 — the 2026-06-02 "fix" switched both anchors to direction 0 (NE), but NE has oblique/negative x displacement that makes `(total+16)/32` give 0 or negative → clamped to 1 hex/cycle. For 2-hex-per-cycle animations (e.g. player walk, dir1.lastOx=69), shift accumulated 2-hex worth (~69px) but position advanced only 1 hex (~32px), causing a 37px snap-back on cycle end. Correct anchor: direction E (index 1) whose x displacement is purely horizontal (+32px per hex), so `floor((totalE+16)/32)` gives exact hex count. CE ref: `Art.xOffsets[rotation]` — rotation 1. | `object.ts getAnimDistance` | `art.h Art.xOffsets` | major | fixed |
| FA3 | **`actionFrame` discarded by the extraction pipeline.** `frmpixels.py:40` reads the header field into `_actionFrame` (not saved to output dict). Absent from `imageMap.json`. DH2 cannot synchronise hit-detection or sounds to the correct animation frame for weapon attacks. | `frmpixels.py:40` | `art.h ArtFrame.actionFrame` | major | missing |
| FA4 | **No combat walk speed bonus.** CE `animationComputeTicksPerFrame` (`animation.cc:3287`) applies a `combat_speed` preference bonus to ANIM_WALK tick rate during combat. DH2 uses a fixed `1000/fps` for all animations. | `object.ts:1395` | `animation.cc:3287` | minor | missing |
| FA5 | **Walk start: `obj.shift={x:0,y:0}` is truthy; frame 0's static ox/oy is skipped.** FIXED 2026-06-02 — renderer condition changed to `obj.shift !== null` so `{x:0,y:0}` correctly falls through to `frameInfo.ox/oy`. CE ref: `object.cc _obj_offset()`. | `renderer.ts:311` | `object.cc _obj_offset()` | low | fixed |
| FA6 | **FID composition / weapon stance animation not implemented.** CE builds a Frame Identifier via `buildFid(objectType, animType, weaponAnimCode, direction, rotation)` (`art.cc`), selecting the critter's armed-pose FRM set based on equipped weapon type (pistol=1, rifle=3, big gun=4, etc.). DH2 has no `buildFid` equivalent; critter FRM paths are resolved from static skin strings and never change on equip. Critters always display unarmed walk/idle regardless of what weapon they hold. | `src/object.ts`; `src/renderer.ts` | `art.cc buildFid()`; `art.h ART_TYPE_CRITTER`; `proto_types.h ItemWeaponData.animCode` | medium | missing |
| FA7 | **FRM art transition caused sprite position jump.** FIXED 2026-06-03 — three sources: (1) directionOffset mismatch between FRMs (e.g. idle y=5 → draw y=0 = 5 px y jump); (2) non-zero per-frame ox at transition frame (idle dir0 frames 2–10 have ox=1; ignoring this = 2 px x jump); (3) frame-width center-anchor change (dir4: idle w=23 → draw w=34 = 6 px anchor shift, total -12 px). Fix: `artOffset: Point` field on `Obj`, updated at every art switch using exact zero-jump formula: `artOffset.x = floor(newW/2)−floor(oldW/2) + oldDirOff.x−newDirOff.x + oldOx[F]−newOx[0]`, `artOffset.y = (newH0−oldHF) + oldDirOff.y−newDirOff.y + oldOy[F]−newOy[0]` (height term added 2026-06-04, see FA12). Computed synchronously before `lazyLoadImage` (imageInfo always available). Resets to 0 on walk end (matches CE's `objectSetLocation` reset). Full model in `wiki/animation.md §4.2`. | `src/object.ts Critter.staticAnimation, clearAnim`; `src/renderer.ts` | `animation.cc ~2886 artGetRotationOffsets + artGetFrameOffsets`; `object.cc objectSetLocation` | medium | **FIXED 2026-06-03** |
| FA8 | **Sprite vanishes for one frame when a new animation starts (async texture load gap).** FIXED 2026-06-03 — `staticAnimation` previously assigned `this.art = newArt` before calling `lazyLoadImage`; if the GL texture for `newArt` had not yet loaded, the renderer drew nothing for the duration of the async load. Fix: deferred all art-state changes (`this.art`, `this.frame`, `this.anim`, `this.animCallback`, `this.artOffset`) into the `startAnim` callback so the old art remains visible until the texture is confirmed loaded. For already-cached textures `lazyLoadImage` fires synchronously so there is no visible delay. | `src/object.ts Critter.staticAnimation` | `animation.cc artLoad()` | minor | **FIXED 2026-06-03** |
| FA9 | **Frame 0 of a new animation was shown for 0 ms (skipped).** FIXED 2026-06-03 — `staticAnimation` set `this.lastFrameTime = 0`, causing the fps check `time - 0 >= 125ms` to pass on the very first rAF tick, advancing to frame 1 immediately and skipping frame 0 entirely. Fix: `this.lastFrameTime = window.performance.now()` inside `startAnim` so frame 0 is held for a full fps interval before advancing. | `src/object.ts Critter.staticAnimation` | `animation.cc animationComputeTicksPerFrame()` | minor | **FIXED 2026-06-03** |
| FA10 | **Walk cycle had asymmetric partial boundary — visible limp.** FIXED 2026-06-03 — `updateAnim` used `this.frame === currentPartial.endFrame` as the partial-switch trigger; this fires after the boundary frame is already set, so partial 0 consumed 5 intervals and partial 1 only 3 (5:3 ratio) for an 8-frame/2-partial walk → visible limp. Secondary bug: `nextFrame = startFrame + 1` skipped the first frame of each new partial. Fix: trigger changed to `this.frame + 1 >= currentPartial.endFrame` (pre-boundary) and `nextFrame = partials.actions[partial].startFrame` (no +1), giving symmetric 4:4 intervals. `if (partial === 0) nextFrame = 0` special case removed (now redundant). | `src/object.ts Critter.updateAnim` | `animation.cc anim_run_sequence() partial-action loop` | minor | **FIXED 2026-06-03** |
| FA11 | **Idle animation cycle had an extra inter-cycle delay.** FIXED 2026-06-03 — `updateLoopingAnim` assigned `this.lastFrameTime = time` during the between-cycle wait, so when the wait expired the fps check `time - lastFrameTime ≈ 0` would not pass until one additional fps interval (~125ms) elapsed, adding a dead pause before each cycle. Fix: `this.lastFrameTime = this.nextIdleAnimTime` during the wait so the first advance fires promptly after `nextIdleAnimTime`. | `src/object.ts Critter.updateLoopingAnim` | `animation.cc animationComputeTicksPerFrame()` | minor | **FIXED 2026-06-03** |
| FA12 | **Per-orientation pixel drift on weapon draw — three-part fix.** FIXED 2026-06-04 — **Part 1 (mid-idle contamination, 2026-06-03):** `staticAnimation` baked `iOxF` into `artOffset_draw`. Fix: `srcF = oldFrames[0]` when `this.anim === 'idle'`. CE ref: `art.cc artGetFrameOffsets`. **Part 2 (K_cycle accumulation, 2026-06-03):** clearAnim zero-jump with `prev` caused −2px/cycle drift for dir2 of hmjmps (K_cycle ≠ 0). Interim fix: `artOffset = {0,0}` hard reset, bounded drift at the cost of a residual Y snap at settle. **Part 3 (Y height correction + clearAnim formula, 2026-06-04):** both `staticAnimation` and `clearAnim` were missing the `(newF0.h − srcF.h)` height term in the Y formula. Confirmed by log: hmjmpsia h=65 → hmjmpsid h=63 → artOffset.y was 4 instead of 2 → 2 px Y jump on every weapon draw. Final fix: (a) `(newF0.h − srcF.h)` added to both Y formulas; (b) `clearAnim` now uses the full zero-jump formula with current artOffset as `prev` (true zero-jump at draw→idle settle). K_cycle drift bounded by subsequent walk resets (CE `objectSetLocation` semantics). | `src/object.ts Critter.staticAnimation, clearAnim` | `art.cc artGetFrameOffsets`; `object.cc objectSetLocation` | minor | **FIXED 2026-06-04** |

<!-- audited: 2026-06-04 -->

---

## 16. Proto System

> Source: `wiki/proto_system.md` · CE: `proto.cc`, `proto.h`, `proto_types.h` · DH2: `src/pro.ts`, `src/scripting.ts`, `src/vm_bridge.ts`, `proto.py`

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| PS1 | **`proto_data` opcode (0x8104) wired.** FIXED 2026-06-02 — `bridged("proto_data", 2)` added to `vm_bridge.ts`. The method body in `scripting.ts:1090` handles item/critter fields; critter field coverage remains partial (PS5). | `vm_bridge.ts:0x8104`, `scripting.ts:1090` | `interpreter_extra.cc opGetProtoData()` | major | partial |
| PS2 | **`proto.py` sets `FO1 = True`, suppressing critter `damageType` extraction.** The `FO1` flag is a Fallout 1 compat guard; the pipeline is targeting Fallout 2 data. `damageType` is never written to the JSON, so critters always use the fallback value (0 = normal) instead of their CE-defined damage type. | `proto.py:34` | `proto_types.h CritterProtoData.damageType` | major | bug |
| PS3 | **Tile PROs not extracted by pipeline.** `exportPRO.py` only processes types 0–3 (items, critters, scenery, walls). Type 4 (tiles) is silently skipped. DH2 never reads tile prototype data — terrain movement cost and special tile flags come entirely from hardcoded heuristics. | `exportPRO.py`, `proto.py` | `proto_types.h TileProto` | low | missing |
| PS4 | **Wall and misc `extra` fields not parsed.** CE `WallProto` has an `extra` sub-struct with 4 fields (materialType, etc.); `MiscProto.extra` similarly. `proto.py` writes no `extra` key for these types, and `pro.ts` has no wall/misc field accessors. | `proto.py`, `src/pro.ts` | `proto_types.h WallProto.extra`, `MiscProto.extra` | low | missing |
| PS5 | **`proto_data` data_member IDs fixed.** FIXED 2026-06-02 — completely rewrote `proto_data` switch to use CE's actual `ItemDataMember`/`CritterDataMember`/`SceneryDataMember` enum IDs from `proto.h` (confirmed against `proto.cc:1099 protoGetDataMember`). Item: 6=flags, 7=extFlags, 9=type, 11=material, 12=size, 13=weight, 14=cost, 15=invFid, 555=weaponRange. Critter: 10=headFid, 11=bodyType. Scenery: 9=type, 11=material. Subtype-specific weapon/ammo/armor fields are NOT accessible via proto_data() in CE — removed the guessed 100-300 IDs. | `scripting.ts:proto_data` | `proto.h ItemDataMember enum` | major | fixed |

<!-- audited: 2026-06-02 -->

---

## 17. Tile System

> Source: `wiki/tile_system.md` · CE: `tile.cc`, `tile.h`, `obj_types.h` · DH2: `src/tile.ts`, `src/geometry.ts`

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| TS1 | **No edge-check in `hexInDirectionDistance`.** FIXED 2026-06-02 — added `hexIsEdge(p)` check (x≤0, y≤0, x≥199, y≥199) inside the loop; stops stepping at grid boundary. CE ref: `tile.cc:893 tileGetTileInDirection` calls `tileIsEdge()` before each step. | `src/geometry.ts:171` | `tile.cc:893 tileIsEdge()` | minor | fixed |
| TS2 | **`hexDirectionTo` now uses screen-space projection.** FIXED 2026-06-02 — projects both tiles via `hexToScreen()` before atan2, matching CE `tileGetRotationTo`. Old grid-space delta gave wrong results because DH2 grid x-axis inverts relative to screen-x. | `src/geometry.ts:210` | `tile.cc:910 tileGetRotationTo()` | major | fixed |
| TS3 | **No `_tile_num_beyond` equivalent.** FIXED 2026-06-02 — `hexLineBeyond(from, to, distance)` added to `geometry.ts`; implements CE's Bresenham screen-space walk, returning the hex `distance` tile-transitions past `from` toward `to`. CE ref: `tile.cc:944 _tile_num_beyond()`. | `src/geometry.ts` | `tile.cc:944 _tile_num_beyond()` | minor | fixed |
| TS4 | **`tile_coord()` in `tile.ts` is unused and broken.** FIXED 2026-06-02 — removed dead `tile_coord()` function (tile.ts:81) which had a live `console.log`, hardcoded offsets, and was never called. `hexToScreen` in geometry.ts serves the same purpose. | `src/tile.ts:81` | `tile.cc:674 tileToScreenXY()` | low | fixed |

<!-- audited: 2026-06-02 -->

---

## 18. Item Use & Scenery Interaction

> Source: `wiki/items.md` · CE: `proto_instance.cc`, `scripts.cc`, `obj_types.h` · DH2: `src/object.ts`, `src/scripting.ts`, `src/skillUse.ts`

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| IU1 | **`use_obj_on_obj` fires `use_p_proc` instead of `use_obj_on_p_proc`.** FIXED 2026-06-02 — implements CE two-step chain: fire `use_obj_on_p_proc` on item first; if not overridden, fire on target via `Scripting.useObjOnMe`. Also fixed `useObjOnMe` to set `target_obj=item` per CE `scriptSetObjects(targetObj->sid, critter, item)`. CE ref: `proto_instance.cc:1286–1320`. | `src/scripting.ts:1423` | `proto_instance.cc:1245 _protinst_use_item_on()` | major | fixed |
| IU2 | **Proc name mismatch fixed.** FIXED 2026-06-02 — `use_obj_on_me_p_proc` renamed to `use_obj_on_p_proc` throughout `scripting.ts` (class decl + 2 call sites). CE ref: `scripts.h:61 SCRIPT_PROC_USE_OBJ_ON`. `use_skill_on_p_proc` was already correct. | `src/scripting.ts:428,2188,2193` | `scripts.h:61–62` | major | fixed |
| IU3 | **Jammed lock state implemented.** FIXED 2026-06-03 — `Obj.jammed` field added; `jam_lock` opcode (0x814D) wired via `vm_bridge.ts` → `scripting.ts`; `useLockpick` bails with "It's jammed." when target is jammed; midnight `objectUnjamAll()` clears all jam bits (GTC5). No `unjam_lock` script opcode in CE (CE clears only via midnight). | `src/object.ts`, `src/scripting.ts`, `src/skillUse.ts`, `src/main.ts` | `proto_instance.cc:2131 objectJamLock()`; `scripts.cc:418 gameTimeEventProcess()` | minor | fixed |
| IU4 | **No locked-door SFX or message.** FIXED 2026-06-02 — `setObjectOpen()` now plays `sldoorsa` for locked doors (CE: `SLDOORSx`) and `silcntna` + "It is locked." for locked containers (CE: msg 487). CE ref: `proto_instance.cc:1712 _obj_use_door`; `proto_instance.cc:1804`. | `src/object.ts:145` | `proto_instance.cc:1710–1722 _obj_use_door()` | minor | fixed |
| IU5 | **Container loot UI opens immediately instead of after animation.** VERIFIED FIXED — `setObjectOpen()` already defers `uiLoot(obj)` inside the `singleAnimation` callback; loot screen opens only after the open animation completes. | `src/object.ts:171` | `proto_instance.cc:1825–1840 _obj_use_container()` | minor | fixed |

<!-- audited: 2026-06-02 -->

---

## 19. Random Number System

> Source: `wiki/random_numbers.md` · CE: `random.cc`, `random.h`, `interpreter_extra.cc` · DH2: `src/util.ts`, `src/scripting.ts`, `src/combat.ts`

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| RN1 | **Fixed seed 123.** FIXED 2026-06-02 — `Scripting.init()` now calls `seed(Date.now())`, matching CE's `compat_timeGetTime()` seeding. `setSeed(n)` export preserved for deterministic crawler runs. | `src/scripting.ts:init` | `random.cc:39 randomInit()` | minor | fixed |
| RN2 | **`roll_dice` opcode (0x80B5) wired.** FIXED 2026-06-02 — pops 2 args and pushes 0 (CE predefined-error stub; `interpreter_extra.cc:789 opRollDice()` returns 0). | `src/vm_bridge.ts:0x80B5` | `interpreter_extra.cc:789` | low | fixed |
| RN3 | **Sniper perk rolls d100 instead of d10.** VERIFIED FIXED (C1 sprint) — `combat.ts:519` uses `getRandomInt(1, 10)` vs LUK. CE ref: `combat.cc:3892 randomBetween(1,10)`. | `src/combat.ts:519` | `combat.cc:3892` | major | fixed |
| RN4 | **`rollSkillCheck` uses 101 outcomes ([0–100]) vs CE's 100 ([1–100]).** FIXED 2026-06-02 — changed to `getRandomInt(1, 100)` with `roll <= tempSkill`, matching CE's `randomBetween(1,100)` / `delta >= 0` semantics. | `src/util.ts:111` | `random.cc:87 randomRoll()` | low | fixed |
| RN5 | **No statistical validation of DH2 sin-PRNG.** CE runs a 100,000-sample chi-squared test at startup. Sin-PRNG has known non-uniform bit patterns that are unmonitored. | `src/util.ts:102` | `random.cc:224 randomValidatePrerandom()` | low | missing |

<!-- audited: 2026-06-02 -->

---

## 20. Config & INI System

> Source: `wiki/settings.md` · CE: `config.cc`, `game_config.h`, `settings.h`, `settings.cc` · DH2: `src/config.ts`, `src/ui_options.ts`, `src/init.ts`

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| CI1 | **No fallout2.cfg — all config is hardcoded.** DH2 has no file-based config; all defaults are baked into `Config` in `src/config.ts`. Users cannot edit settings between sessions via a file. | `src/config.ts` | `config.cc:273 configRead()`; `game_config.h:8` | minor | missing |
| CI2 | **`game_difficulty` and `combat_difficulty` conflated.** CE has separate keys affecting skill checks/loot/XP vs enemy stats. DH2 maps both to `difficultyModifier` which only scales combat damage. | `src/config.ts:62`; `src/ui_options.ts:205` | `settings.h:29-31`; `preferences.cc:371-372` | minor | missing |
| CI3 | **`combat_speed` uses inverse/incompatible scale.** CE: 0–50 integer where 0=slowest. DH2: discrete values 1/2/4 where 4=fastest. Inverse and non-equivalent. | `src/config.ts:67` | `preferences.cc:382`; `game_config.h:44` | low | bug |
| CI4 | **`running` default matches CE.** FIXED 2026-06-04 — `doAlwaysRun` defaults to `false` (walk by default), matching CE `settings.h:38`. | `src/config.ts:41` | `settings.h:38` | low | fixed |
| CI5 | **Preferences stored in localStorage, not fallout2.cfg.** CE writes back to fallout2.cfg on exit. localStorage is lost in private browsing or on cache clear. | `src/ui_options.ts:332` | `settings.cc:118 settingsToConfig()`; `config.cc:313` | minor | missing |
| CI6 | **`speech_volume` not persisted in DH2 preferences.** CE saves it to fallout2.cfg on every exit. | `src/ui_options.ts:315` | `settings.cc:93` | low | bug |
| CI7 | **`item_highlight` setting absent.** CE allows toggling item-highlighting on cursor hover. DH2 has no Config field or UI toggle for this. | `src/config.ts` | `game_config.h:37`; `settings.h:33` | low | missing |
| CI8 | **`target_highlight` loses "targeting only" mode.** CE has three states (0=Off/1=On/2=Targeting-only). DH2 collapses to a boolean. | `src/ui_options.ts:232-237` | `game_config.h:111-115 TargetHighlight enum` | low | bug |
| CI9 | **No `text_base_delay` / `text_line_delay`.** CE auto-advances dialogue text after a configurable per-line delay. DH2 has no auto-advance. | `src/config.ts` | `settings.h:42-43` | low | missing |

<!-- audited: 2026-06-02 -->

---

## 21. Lighting Deep Dive

> Source: `wiki/lighting.md` · CE: `light.cc`, `light.h`, `object.cc`, `interpreter_extra.cc`, `obj_types.h` · DH2: `src/lightmap.ts`, `src/scripting.ts`, `src/object.ts`
>
> Supplements the open gaps in `wiki/lighting.md §13` with additional implementation-level gaps.

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| LD1 | **Hidden objects still emit light.** FIXED 2026-06-02 — `obj_adjust_light()` returns early when `obj.visible === false`. CE ref: `object.cc:3973 _obj_adjust_light` bails on `OBJECT_HIDDEN`. | `src/lightmap.ts:68` | `object.cc:3973` | minor | fixed |
| LD2 | **`OBJECT_LIGHTING` flag (0x20) not checked.** FIXED 2026-06-02 — `obj_adjust_light()` now returns early if `lightRadius <= 0 || lightIntensity <= 655` (DH2's ambient baseline); equivalent to CE's `OBJECT_LIGHTING` guard which is set only when `lightIntensity > 0`. CE ref: `object.cc:3969,3977`. | `src/lightmap.ts:68` | `object.cc:3977`; `obj_types.h:61` | low | fixed |
| LD3 | **`obj_set_light_level` method does not update lightmap.** FIXED 2026-06-02 — calls `Lightmap.rebuildLight()` after setting `lightRadius`/`lightIntensity`. CE ref: `interpreter_extra.cc:3071 opSetObjectLightLevel` → `objectSetLight()` full cycle. | `src/scripting.ts:1485` | `interpreter_extra.cc:3071`; `object.cc:1721` | major | fixed |
| LD4 | **`set_obj_visibility` does not update lightmap.** FIXED 2026-06-02 — calls `Lightmap.rebuildLight()` after toggling `obj.visible`. CE ref: `interpreter_extra.cc:2096 objectHide/objectShow` call `_obj_turn_off_light/_obj_turn_on_light`. | `src/scripting.ts:1415` | `interpreter_extra.cc:2096-2119` | minor | fixed |
| LD5 | **`objectGetLightIntensity` self-subtraction absent.** CE subtracts the player's own `lightIntensity` from the tile value before computing effective light level (prevents self-illumination). No DH2 equivalent — moot while night-penalty is absent (lighting.md gap #1). | `src/combat.ts:441` | `object.cc:1748` | low | missing |
| LD6 | **`obj_set_light_level` intensity conversion.** FIXED 2026-06-02 — `obj.lightIntensity = Math.round(intensity * 65536 / 100)` converts percent input to the engine's 0–65536 range. CE ref: `interpreter_extra.cc:3071 opSetObjectLightLevel`. | `src/scripting.ts:obj_set_light_level` | `interpreter_extra.cc:3071` | major | fixed |

<!-- audited: 2026-06-02 -->

---

## 22. Rendering Deviations

> Source: `wiki/rendering.md` · CE: `tile.cc`, `object.cc`, `color.cc` · DH2: `src/webglrenderer.ts`, `src/renderer.ts`, `src/object.ts`, `shaders/`
>
> Accepted deviations (RD01–RD05, RD02 high-DPI, RD03 zoom) are not listed here. Scripting-level lighting deviations are in §20 (LD1–LD6). See `wiki/rendering.md §5` for fix priority ordering.

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| RD06 | **Roof clipping not implemented.** CE `tile_fill_roof` flood-fills connected roof tiles when player walks under a building. DH2 renders all roofs unconditionally. `Config.ui.showRoof` is all-or-nothing. `map.hasRoofAt()` exists but is not wired to per-position rendering. | `src/webglrenderer.ts:965`, `src/map.ts:135` | `object.cc:1445`; `tile.cc tile_fill_roof()` | major | missing |
| RD07 | **OBJECT_FLAT two-pass rendering absent.** CE renders flat objects (floor decals, blood) in a dedicated first pass before all non-flat objects. DH2 renders all objects in one sorted pass. | `src/renderer.ts:119` | `object.cc:761 _obj_render_pre_roof()` | minor | missing |
| RD08 | **No post-roof object pass.** CE `_obj_render_post_roof` renders objects that must appear above the roof layer at full intensity (0x10000). DH2 has no post-roof pass. | `src/renderer.ts:119` | `object.cc:862 _obj_render_post_roof()` | minor | missing |
| RD09 | **Object depth sort approximate.** CE uses a two-phase isometric sort (`_obj_order_comp_func_even/odd`, `tileIsInFrontOf`, `tileIsToRightOf`) correct for all 6 hex directions. DH2 `objectZCompare` sorts by hex-y then hex-x; fails at NE/SW diagonal hex borders. | `src/object.ts:182` | `object.cc:761`; `tile.cc tileIsInFrontOf()` | minor | bug |
| RD10 | **Color cycling absent.** CE `colorCycleEnable/Disable` drives time-based palette rotation for water and fire. DH2 has no palette cycling; water and fire sprites are static. | — | `color.cc colorCycleEnable()` | minor | missing |
| RD11 | **Scroll blocking not implemented.** CE respects `OBJECT_SCROLL_BLOCK` flagged scenery to prevent the viewport scrolling through barrier objects. | `src/renderer.ts` | `tile.cc tileSetCenter()`; `gTileScrollBlockingEnabled` | minor | missing |
| RD12 | **Scroll border limiting absent.** CE clamps viewport to `gTileBorderMin/MaxX/Y`. DH2 camera can scroll to expose grey canvas beyond the map edge. | `src/renderer.ts` | `tile.cc:537` | low | missing |
| RD13 | **Hex click hit-testing is approximate.** CE uses `_tile_mask[512]` (32 × 16 px, 5 sub-regions) for pixel-precise diamond edges. DH2 uses cube-coordinate rounding (`hexFromScreen`) — imprecise at hex boundaries. | `src/geometry.ts:135` | `tile.cc:718 tileFromScreenXY()` | low | bug |
| RD14 | **Elevation transition is instant.** CE fades/transitions between elevation levels. DH2 switches immediately. | `src/map.ts:196` | `map.cc mapSetElevation()` | low | missing |
| RD15 | **Roof tile lighting deviation — ground truth unclear.** CE `tileRenderRoofsInRect` appears to blit roofs at full palette intensity (no `intensityColorTable`). DH2 roofs render at `max(0, ambient) = ambient` via `roofDummyTexture` — dimming at night. See `wiki/rendering.md §6`. | `src/webglrenderer.ts:989` | `tile.cc tileRenderRoofsInRect()` | low | bug |

<!-- audited: 2026-06-02 -->

---

## 23. Pathfinding

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| P1 | **PathFinding.js treats the hex grid as orthogonal.** CE's A* iterates all 6 hex rotations per node (`animation.cc:1795`). PathFinding.js uses 4/8-connected grid movement; hex topology mismatches may produce sub-optimal or visually odd paths near angled walls. | `map.ts:604` | `animation.cc:1795` | minor | bug |
| P2 | **No rotation-change step cost.** CE adds +10 to a node's cost when the direction changes from its parent (outside combat). | `map.ts:605` | `animation.cc:1838` | low | missing |
| P3 | **No radioactive goo tile penalty.** CE adds +100 (gecko) or +400 (others) to step cost when the tile contains radioactive goo PID objects. | `map.ts:596` | `animation.cc:1852` | low | missing |
| P4 | **Closed unlocked doors traversable in pathfinding.** FIXED 2026-06-04 — `Obj.pathBlocks()` separates path-blocking from shoot-blocking; closed-but-unlocked, non-jammed doors return `false` for path blocking (CE auto-opens mid-walk). LoF still blocks. CE ref: `animation.cc:1805`. | `object.ts:585`, `map.ts:661` | `animation.cc:1805` | minor | fixed |
| P5 | **OBJECT_MULTIHEX neighbor scan added.** FIXED 2026-06-04 — `recalcPath` now marks all 6 adjacent hexes blocked when a multihex (0x800) object is path-blocking. CE ref: `object.cc:2413 _obj_blocking_at`. | `map.ts:661` | `object.cc:2413` | low | fixed |
| P6 | **Shoot-blocking separated from path-blocking.** FIXED 2026-06-04 — `hexLinecast` now skips dead critters, `OBJECT_SHOOT_THRU` (0x80000000), hidden objects, and non-blocking objects. CE ref: `object.cc:2440 _obj_shoot_blocking_at`. | `map.ts:618` | `object.cc:2440` | minor | fixed |
| P7 | **`hasLineOfSight` blocks on scenery.** FIXED 2026-06-04 — now blocks on walls and scenery lacking `OBJECT_LIGHT_THRU` (0x20000000); also skips `OBJECT_HIDDEN`. CE ref: `object.cc:2583 _obj_sight_blocking_at`. | `combat.ts:1545` | `object.cc:2583` | minor | fixed |
| P8 | **Script opcodes `make_path` / `obj_blocking_at` / `make_straight_path` are stubs.** | `scripting.ts` | `sfall_opcodes.cc:937,951` | low | stub |
| P9 | **`recalcPath` crashed on off-map object positions.** Objects with position sentinel `(-1,-1)` caused `matrix[y]` → `undefined`, then `.x` access threw TypeError. Also: start/goal coords not bounds-checked, so out-of-range tile arguments crashed the A* finder. Both guards added. | `src/map.ts` | `tile.cc tileIsValid()` | major | **FIXED 2026-06-02** |
| P10 | **`walkTo` accepted invalid target tiles without guard.** Out-of-bounds `target.x/y` passed directly to `recalcPath`, crashing the pathfinder. Guard added: returns false with `dbgWarn`. `reg_anim_obj_move_to_tile` in `scripting.ts` also lacked the tile-validity guard — `-1` sentinel passed through. Both fixed. | `src/object.ts`, `src/scripting.ts` | `ai.cc pathFind()` | major | **FIXED 2026-06-02** |

<!-- audited: 2026-06-02 -->

---

## 24. Endgame System

> Source: `wiki/endgame.md` · CE: `src/endgame.cc`, `endgame.h` · DH2: `src/endgame.ts`, `tools/convertEndgame.py`

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| EG3 | **Panning slide uses linear timing instead of CE's per-pixel formula.** CE computes `v9` (ms per pixel step) from image width and speech duration. DH2 uses a simple linear pan over `max(speechDuration, 5s)`. | `src/endgame.ts:showPanningSlide` | `endgame.cc:337-345` | low | bug |
| EG4 | **`endgame_movie` skips credits music and text.** CE plays `akiss.acm`, calls `creditsOpen("credits.txt")`, then loads `10labone.acm`. DH2 shows only the "continue playing?" dialog. | `src/endgame.ts:playMovie` | `endgame.cc:234`; `credits.cc` | minor | missing |
| EG5 | **Death ending slide is a black screen.** CE plays the narrator over the death scene. DH2 `playDeathEnding()` shows a blank canvas. | `src/endgame.ts:playDeathEnding` | `critter.cc:912` | low | missing |
| EG6 | **`setupDeathEnding` wired to player death.** FIXED 2026-06-02 — `critter.ts` now imports `endgame.ts` and calls `setupDeathEnding(DEATH_REASON_DEATH)` + `playDeathEnding()` in `finalizeCallback` when `obj.isPlayer`. Replaces the plain "YOU ARE DEAD" overlay with the CE-accurate narrator death slide. | `src/critter.ts:finalizeCallback` | `critter.cc:912` | major | fixed |

<!-- audited: 2026-06-02 -->

---

## 25. Loot Economy

> Source: `wiki/economy.md` · CE: `proto_instance.cc`, `item.cc`, `inventory.cc` · DH2: `src/object.ts`, `src/scripting.ts`, `src/ui_loot.ts`

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| LE1 | **Carry-weight limit enforced.** FIXED 2026-06-04 — `Obj.canCarry(item, count)` checks STAT_CARRY_WEIGHT against `getInventoryWeight()`. Wired into loot drag-drop, "Take All", and tile pickup; refusal floats "You can't carry any more." CE ref: `item.cc:322 itemAttemptAdd()`. Scripts using force-add (`addInventoryItem` direct) bypass the check by design (matches CE `itemAdd`). | `src/object.ts:625`, `src/ui_loot.ts` | `item.cc:322 itemAttemptAdd()` | major | fixed |
| LE2 | **`CRITTER_NO_DROP` flag now checked.** FIXED 2026-06-02 — `critterKill()` clears inventory in `finalizeCallback` when `pro.extra.flags & 0x40` (CE `CRITTER_NO_DROP`). CE ref: `critter.cc _critter_flag_check(pid, CRITTER_NO_DROP=0x40)`. | `src/critter.ts` | `critter.cc _critter_flag_check`; `obj_types.h:95 CRITTER_NO_DROP` | major | fixed |
| LE3 | **`move_obj_inven_to_obj` stack-merge.** FIXED 2026-06-02 — now calls `addInventoryItem(item, item.amount)` per item instead of `dst.inventory = src.inventory`. CE ref: `item.cc:322 itemAdd()`. | `src/scripting.ts:move_obj_inven_to_obj` | `item.cc:322 itemAdd()` | major | fixed |
| LE4 | **WeaponObj.approxEq compares loaded state.** FIXED 2026-06-04 — `WeaponObj.approxEq` overrides `Obj.approxEq` to require matching `pro.extra.ammoPID` and `pro.extra.rounds`. Loaded and unloaded copies of the same weapon PID no longer merge. Non-weapon items still merge by PID alone. CE ref: `item.cc:357 _item_identical()`. | `src/object.ts:1118` | `item.cc:357 _item_identical()` | minor | fixed |
| LE5 | **Ammo stack merge ignores magazine capacity.** `addInventoryItem` adds quantities without a capacity ceiling. CE fills magazines to capacity and splits remainder. | `src/object.ts:625` | `item.cc:322 itemAdd()` | minor | partial |
| LE6 | **`pickup_p_proc` fires from inventory equip.** FIXED 2026-06-04 — `ui_inventory.uiMoveSlot` now calls `Scripting.pickup` when an item with a script is dropped onto `leftHand`/`rightHand`. CE ref: `inventory.cc:4494`. | `src/ui_inventory.ts`; `src/scripting.ts:2060` | `inventory.cc:4102,4494` | minor | fixed |
| LE7 | **`item_caps_total` may return stale value.** DH2 returns `obj.money` — a cached field whose full update path is not audited. CE iterates all `ITEM_TYPE_MONEY` inventory items and sums quantities live. | `src/scripting.ts` | `item.cc item_caps_total()` | minor | bug |
| LE8 | **`critter_inven_obj` slot −2.** FIXED 2026-06-02 — `INVEN_TYPE_INV_COUNT` now returns `obj.inventory.length`. CE ref: `inventory.cc critter_inven_obj()`. | `src/scripting.ts:critter_inven_obj` | `inventory.cc critter_inven_obj()` | minor | fixed |
| LE9 | **Loot UI bypasses `use_p_proc` for containers.** `uiLoot()` is called directly without running `use_p_proc` on the container. CE runs the proc and checks `scriptOverrides` before opening. Container scripts that guard opening via `use_p_proc` are bypassed. | `src/ui_loot.ts`; `src/main.ts:353` | `proto_instance.cc _obj_use_container()` | minor | missing |
| LE10 | **STEALTH_BOY II auto-stealth not implemented.** CE `itemAdd` checks `PROTO_ID_STEALTH_BOY_II` and activates stealth if the item is in-hand at add time. DH2 `addInventoryItem` has no such check. | `src/object.ts:625` | `item.cc:322 itemAdd()` | low | missing |
| LE11 | **Multi-pile caps tile undercount.** CE's `PROTO_ID_MONEY` path calls `itemGetMoney(item)` which sums all money objects at the tile. DH2 `pickup` passes `this.amount` directly — tiles with multiple separate caps objects may not be fully collected. | `src/object.ts:941` | `proto_instance.cc:571 _obj_pickup()` | low | bug |

<!-- audited: 2026-06-02 -->

---

## 26. Interface Windows & HUD

> Source: `wiki/interface_windows.md` · CE: `interface.cc`, `interface.h`, `game_dialog.cc` · DH2: `src/ui_hud.ts`, `src/ui.ts`, `src/ui_panels.ts`, `src/ui_components.ts`

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| IW1 | **No indicator bar.** CE renders up to 6 status badges (ADDICT, SNEAK, LEVEL, POISONED, RADIATED) in `gIndicatorBarWindow` above the HUD. DH2 has no indicator bar element or rendering — player gets no HUD feedback for these states. | `src/ui_hud.ts` | `interface.cc indicatorBarInit()`; `interface.h INDICATOR_*` | major | missing |
| IW2 | **Attack button greyed at low AP.** FIXED 2026-06-04 — `drawAP()` now calls `updateAttackButtonAvailability()`, which computes the current weapon mode's AP cost and sets `opacity:0.4 / grayscale(80%)` on `#attackButton` when unaffordable or when it isn't the player's turn. CE ref: `interface.cc interfaceRenderActionPoints`. | `src/ui_hud.ts:99,121` | `interface.cc InterfaceItemState.isDisabled` | minor | fixed |
| IW3 | **Weapon action cycling missing aiming states.** CE right-click cycles through 7 states (DEFAULT→USE→PRIMARY→PRIMARY_AIMING→SECONDARY→SECONDARY_AIMING→RELOAD); aiming states auto-open called shot. DH2 cycles only `single`/`burst`/`reload`. Called shot is a separate hotkey. | `src/ui.ts`; `src/weapon.ts` | `interface.cc InterfaceItemAction`; `interface.h INTERFACE_ITEM_ACTION_*` | minor | partial |
| IW4 | **HUD bar hide/showable from scripts.** FIXED 2026-06-04 — `game_ui_disable` / `game_ui_enable` now toggle `#bar` visibility (in addition to the existing keydown/mouse input block). CE ref: `interface.cc interfaceBarHide/Show`. | `src/scripting.ts:2123` | `interface.cc interfaceBarHide()`; `interfaceBarShow()` | minor | fixed |
| IW5 | **Active hand persisted in save.** FIXED (already done) — `saveload.ts:112` serializes `p.activeHand`; `saveload.ts:235` restores it. CE `interfaceSave` equivalently serializes `gInterfaceCurrentHand`. | `src/saveload.ts:112,235` | `interface.cc interfaceSave()` | minor | fixed |
| IW6 | **Reload AP cost hardcoded to 2. FIXED 2026-06-03** — CE `item.cc:1640 weaponGetActionPointCost` hardcodes 2 for all reloads except `PERK_WEAPON_FAST_RELOAD` (→1, perk=65) and Solar Scorcher (→0, pid=390). Added `Weapon.getReloadAPCost()` in `critter.ts` implementing CE's three-case logic from weapon proto `perk` field and `weapon.pid`. Both `ui.ts` and `ui_hud.ts` now call this method. Also tracked as U4. | `src/critter.ts`, `src/ui.ts`, `src/ui_hud.ts` | `item.cc:1640 weaponGetActionPointCost` | minor | fixed |
| IW7 | **AP readout has no frame-by-frame animation.** CE `interfaceRenderActionPoints(animate=true)` plays a frame-by-frame AP loss/gain animation. DH2 `drawAP` updates immediately with no animation. | `src/ui_hud.ts` | `interface.cc interfaceRenderActionPoints()` | low | missing |
| IW8 | **Dialogue sub-mode state machine partial.** CE `game_dialog.cc` runs a multi-state machine for dialogue/barter/trade sub-modes. DH2 only transitions `UIMode.dialogue → UIMode.barter`; other CE sub-mode paths are not replicated. | `src/ui_dialogue.ts`; `src/ui_barter.ts` | `game_dialog.cc gameDialogEnter()`; `_dialogue_state` | minor | partial |

<!-- audited: 2026-06-02 -->

---

## 27. Action Dispatch System (`actions.cc`)

See [wiki/actions.md](actions.md) for full documentation.

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| AC1 | **Knockback fully implemented per CE.** FIXED 2026-06-02 — `critterDamage()` now applies knockback only for melee/unarmed/explosion damage (matching CE `combat.cc:4635` condition). Stonewall perk (defender=player): 50% chance full negation, else distance halved (CE `combat.cc:4641–4656`). CRITTER_NO_KNOCKBACK=0x4000 flag respected. Outstanding: PERK_WEAPON_KNOCKBACK divisor-5 path skipped (weapon proto perk field not loaded). | `src/critter.ts` | `combat.cc:4633 attackComputeDamage knockback block` | major | partial |
| AC2 | **Death animation not selected by damage type or violence level.** `_pick_death` selects from 7 death FRMs based on damage type, violence_level preference, and per-critter art availability. DH2 `critterKill` always plays the generic `'dead'` animation. | `src/combat.ts:critterKill` | `actions.cc:183 _pick_death` | major | missing |
| AC3 | **`CRITTER_SPECIAL_DEATH` flag not checked.** CE checks `critter_flag_check(CRITTER_SPECIAL_DEATH)` in `_pick_death` and forces `ANIM_EXPLODED_TO_NOTHING`. DH2 never reads this flag. | — | `actions.cc:209` | minor | missing |
| AC4 | **Hit-from-front vs hit-from-back not tracked for death direction.** `_is_hit_from_front` picks `FALL_FRONT` vs `FALL_BACK` based on attacker/defender facing. DH2 always uses the same fall direction. | — | `actions.cc:1512` | low | missing |
| AC5 | **AI combat taunts not queued.** `_combatai_msg` fires critter voice-line float text at attack/hit/miss events. DH2 never calls this. | — | `actions.cc:667,689` | minor | missing |
| AC6 | **`actionUseSkill` party-member delegation absent.** CE delegates skill use to the party member best at the skill and shows their response text. DH2 always uses the player. | `src/main.ts:useSkill` | `actions.cc:1374` | minor | missing |
| AC7 | **`explosion()` now uses script-supplied damage.** FIXED 2026-06-02 — removed hardcoded (0, 100) range; now passes `damage` as both min and max to `Obj.explode()`. Radius and per-target damage logic is handled by `explode()` (hexesInRadius). CE ref: `actions.cc:1582 actionExplode`. Outstanding: no adjacent-tile secondary blasts, no SCRIPT_PROC_DAMAGE callbacks per target. | `src/scripting.ts` | `actions.cc:1582` | major | partial |
| AC8 | **Damage floating text uses different system.** CE calls `textObjectAdd` per hit for palette-rendered numeric labels with outline color and collision avoidance. DH2 uses `globalState.floatMessages[]` — plain WebGL text, no collision avoidance, no outline. | `src/combat.ts:1044`, `src/renderer.ts:207` | `actions.cc:_show_damage_to_object` | low | partial |

<!-- audited: 2026-06-02 -->

---

## 28. Elevator System (`elevator.cc`)

See [wiki/interface_windows.md §11](interface_windows.md) for full documentation.

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| EV1 | **No gauge animation.** CE smoothly scrolls a gauge pointer as the player travels between floors. DH2 loads the destination immediately with no travel animation. | `src/ui_elevator.ts:79` | `elevator.cc:405 gauge interpolation loop` | low | missing |
| EV2 | **Sierra-2 / Military Base elevation remapping absent.** CE applies hardcoded offsets for specific elevator IDs. DH2 uses raw `level` from JSON. | `src/ui_elevator.ts:84` | `elevator.cc:354–375` | low | missing |
| EV3 | **`use_elevator` already covered via `metarule(15)`.** Wiki incorrectly attributed opcode `0x80FD` to `use_elevator`; CE `interpreter_extra.cc:4966` maps `0x80FD` to `opRadiationIncrease` (`radiation_inc`). Script-triggered elevator calls go through `metarule(id=15)` which is wired and calls `useElevator()`. No separate opcode needed. `0x80FD`/`radiation_inc` is a separate stub gap (see S27). | `src/scripting.ts:514` | `interpreter_extra.cc:4966` | minor | fixed |
| EV4 | **`console.log` in production path.** `ui_elevator.ts:59–64` uses `console.log` instead of `dbg()`/`dbgWarn()`. | `src/ui_elevator.ts:59` | — | low | bug |

<!-- audited: 2026-06-02 -->

---

## 29. Intentionally Deferred — Do Not Implement Unless Tasked

These systems are out-of-scope and marked deliberately incomplete. They appear in source as stubs only.

| System | File(s) | Notes |
|--------|---------|-------|
| Poison decay loop | `drugs.ts`, `main.ts:1063` | Stat field + tick hook exists; CE formula not implemented |
| Radiation accumulation | `main.ts:1076` | `applyRadiationSymptoms` runs but does not accumulate rads from exposure |
| Drug/chem timers | `drugs.ts` | Effect tables defined; no duration/addiction-roll loop |
| Endgame slides | `scripting.ts:1768` | `play_gmovie` skips — no `.mve` infrastructure |
| Unarmed special-move combat logic | `unarmed.ts` | Mode table defined; combat dispatch not wired |
| Party full AI | `party.ts` | Shell only; see P3 above |

---

## Appendix: Outdated TODO.md Entries

The following entries appeared in `TODO.md` but are **confirmed fixed** in `main`:

| Item | Where fixed |
|------|------------|
| `get_month` / `get_day` hardcoded | `vm_bridge.ts:52,56` now reads `GameTime.getDate()` |
| `gsay_message` no-op / bitrotted | `scripting.ts:1461–1479` — full implementation with halt/resume |
| `damage_p_proc` never invoked | `critter.ts:567` — called when `useScript && obj._script` |
| `destroy_p_proc` never invoked | `critter.ts:463`, `map.ts:131` — both call `Scripting.destroy()` |
| Object removal `splice()` index drift | `map.ts:75` — `_removalQueue` with `drainRemovalQueue()` per heartbeat |
| Perk selection UI missing | `ui_character.ts:1875 showPerkModal()` |
| Trait selection missing | `ui_character.ts:1550–1640` |
| Drug decay / addiction loop missing | `main.ts:1073 tickAddictions()` — runs every 600 ticks |
| Poison tick damage missing | `main.ts:1063` — `-1 HP / 10 poison` per 600-tick cycle |
| Radiation symptom tick missing | `main.ts:1076 applyRadiationSymptoms()` |

<!-- audited: 2026-06-01 -->
