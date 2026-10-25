# CE parity audit — script opcodes (interpreter_extra.cc + interpreter_lib.cc)

Scope: CE files `raw/fallout2-ce/src/interpreter_extra.cc` (game intrinsics 0x80A1–0x8155, 181
registrations = 180 opcodes, `opAttackComplex` is registered twice) and
`raw/fallout2-ce/src/interpreter_lib.cc` (UI / sound / library intrinsics 0x804C–0x80A0, 83 opcodes);
helpers they call (`scripts.cc scriptExecProc / scriptsRequestElevator`, `actions.cc actionDamage`,
`inventory.cc objectGetCarried*ByPid`, `party_member.cc _getPartyMemberCount`, `combat_ai.cc
critterSetTeam / critterSetAiPacket`, `proto_instance.cc objectOpen / objectLock`, `object.cc
_obj_remove`). DH2 files: `src/scripting.ts` (Script class), `src/vm_bridge.ts`, `src/vm.ts`,
`src/lua/prelude.ts`, the `tools/int2lua.py` opcode table (cross-checked: every name / argc / push
flag is identical to `vm_bridge.ts`, so both backends dispatch to the same `Script` methods with
the same arity), plus the helpers they call (`src/object/Obj.ts`, `src/inventoryWield.ts`,
`src/map/GameMap.ts`, `src/critter/lifecycle.ts`, `src/party.ts`, `src/geometry/hexGrid.ts`).
Audited 2026-10-24. Line numbers are `src/scripting.ts` unless noted.

## Summary

| Status | interpreter_extra.cc (181 rows: 180 opcodes + the 2nd attack_complex registration) | interpreter_lib.cc (83 opcodes) | total |
|---|---|---|---|
| ✅ MATCH | 136 | 1 (0x806B display) | 137 |
| ⚠️ DIFFERS | 34 | 0 | 34 |
| 🟡 PARTIAL | 11 | 0 | 11 |
| ❌ MISSING | 0 | 0 | 0 |
| 🚫 N/A (not used by vanilla scripts, no DH2 handler) | 0 | 82 | 82 |

Severity of the 45 non-matching rows: HIGH 8, MED 14, LOW 23 (plus the cross-cutting
"exceptions escape the VM" note, MED). All findings are NEW: none of them is an open entry in
`wiki/known_bugs.md`; S20 (`tile_is_visible`) and `wiki/companion_party.md` (party count) state
the opposite of what CE does.

Opcode numbers and argc / return (push / no push) are correct for every bridged opcode — no arity
bugs found (known_bugs C38 holds).

Top findings, by severity:

1. **OP-01 HIGH — `game_time` (0x80EA) and `combat_is_initialized` (0x8128) are cached per script,
   not live.** CE reads `gameTimeGetTime()` / `isInCombat()` each time. DH2 returns `s.game_time` /
   `s.combat_is_initialized`, set only by some entry points: `game_time` is never set for
   `timed_event_p_proc`, `use_p_proc`, `use_skill_on_p_proc`, pickup / drop, `use_obj_on_p_proc`,
   `start` or the map script's `map_enter` / `map_update` (stale or `undefined`);
   `combat_is_initialized` goes to 1 in `combat_p_proc` and back to 0 only through
   `map_update` / `map_enter` / `map_exit`.
2. **OP-02 HIGH — `obj_is_carrying_obj_pid` (0x80BA) counts stacks, not items.** CE sums stack
   quantities and recurses into containers; DH2 returns 1 for a stack of 10 stimpaks. The player's
   equipped items are missed too (the player's hands / armor are not in `inventory`).
3. **OP-03 HIGH — `add_obj_to_inven` / `add_mult_objs_to_inven` (0x80D8 / 0x8116) add a clone.**
   CE moves the object itself into the inventory and off the map. DH2 pushes `item.clone()`: the
   original stays on the map, and the script's handle is not the object in the inventory. With
   the usual `create_object` → `add_obj_to_inven` → `wield_obj_critter` sequence an NPC ends up
   carrying two copies.
4. **OP-04 HIGH — `destroy_object` (0x80F4) on a carried item does nothing.** CE removes it from
   its owner; DH2 queues a map removal that never finds it (`drainRemovalQueue: object not found`).
5. **OP-05 HIGH — `critter_dmg` (0x80EF) ignores armor and the flag bits.** CE `actionDamage`
   applies the type's DT/DR (`_compute_dmg_damage`) unless 0x100 (bypass armor) is set; 0x200 means
   no animation; the hit is reported in the message log. DH2 deals the raw amount.
6. **OP-06 HIGH — `metarule(METARULE_PARTY_COUNT)` is off by one.** CE `_getPartyMemberCount`
   counts the dude and leaves out dead or hidden members; DH2 returns `party.length` (no dude, dead
   members included). The companions' scripts compare it with `1 + CHA/2`, so DH2 lets the player
   recruit one companion too many. (`wiki/companion_party.md` says "the same"; it is not.)
7. **OP-07 MED — other `metarule` cases are broken:** 13 SIGNAL_END_GAME calls a function that does
   not exist (`Endgame.triggerEnd`), 15 ELEVATOR throws on an explicit elevator type, 18
   WHO_ON_DRUGS always returns 0 (it reads `this.self`, not the argument), 19 MAP_KNOWN always
   returns 0 (compares a map name with a map index).
8. **OP-08 MED — `critter_inven_obj` (0x8106) for the dude** returns the raw hand slots; CE returns
   the right-hand item only while the right hand is active, the left-hand item only while the
   left hand is active.
9. **OP-09 MED — `animate_move_obj_to_tile` (0x80CE)** treats ANIMATE_INTERRUPT (0x10) as "run" and
   moves critters during combat or while knocked out; CE clears the animation queue on 0x10,
   walks unless another bit is set, and does nothing in combat or for an inactive critter.
10. **OP-10 MED — tile / visibility helpers differ:** `tile_is_visible` (0x80F8: CE tests distance
    from the screen-centre tile, DH2 tests the light map), `tile_in_tile_rect` (0x80CF: DH2 leaves
    out the edge tiles and rejects non-rectangles), `tile_contains_obj_pid` (0x80BB: DH2 returns 0
    on any elevation but the current one), `obj_can_see_obj` (0x80DC: no elevation check, no
    perception check for non-critter targets).

## Opcode table

Sev only for non-matches. "null" = the object argument is 0 / not an object. Opcodes whose only
difference is a LOW null-argument default (noted in the Notes column) are counted ✅: the vanilla
scripts guard their object arguments, and the difference shows only with a broken call.

### interpreter_extra.cc (registration order, `_initIntExtra` lines 4874–5054)

| Opcode (hex) | CE op_ function (file) | DH2 method (file:line) | Status | Sev | Notes |
|---|---|---|---|---|---|
| 0x80A1 | opGiveExpPoints | give_exp_points :1046 | ✅ | | pcAddExperience, no message, as CE |
| 0x80A2 | opScrReturn | scr_return :2486 | ✅ | | |
| 0x80A3 | opPlaySfx | play_sfx :3201 | ✅ | | |
| 0x80A4 | opGetObjectName | obj_name :1931 | ⚠️ | LOW | null: CE returns the previous name (static `_strName`), DH2 throws a TypeError |
| 0x80A5 | opSfxBuildOpenName | sfx_build_open_name :2490 | ✅ | | |
| 0x80A6 | opGetPcStat | get_pc_stat :1547 | ⚠️ | LOW | unknown pcstat: DH2 `throw`s a string (not caught by the VM); CE pcGetStat returns a value |
| 0x80A7 | opTileGetObjectWithPid | tile_contains_pid_obj :2162 | ✅ | | |
| 0x80A8 | opSetMapStart | set_map_start :2083 | ✅ | | |
| 0x80A9 | opOverrideMapStart | override_map_start :2092 | ⚠️ | MED | OP-11: CE moves the dude at once; DH2 stores a start position that only `enterMap` uses |
| 0x80AA | opHasSkill | has_skill :1433 | ⚠️ | LOW | null: CE 0 + error, DH2 TypeError; non-critter: CE 0 |
| 0x80AB | opUsingSkill | using_skill :1426 | ✅ | | null obj → TypeError (LOW, same pattern) |
| 0x80AC | opRollVsSkill | roll_vs_skill :1445 | ✅ | | skillRoll port; null → critical failure as CE |
| 0x80AD | opSkillContest | skill_contest :2495 | ✅ | | 0, unimplemented in CE too |
| 0x80AE | opDoCheck | do_check :1454 | ✅ | | statRoll: d10 vs stat + mod, howMuch |
| 0x80AF | opSuccess | is_success :1472 | ⚠️ | LOW | invalid roll value: CE -1, DH2 0 |
| 0x80B0 | opCritical | is_critical :1478 | ⚠️ | LOW | invalid roll value: CE -1, DH2 0 |
| 0x80B1 | opHowMuch | how_much :2500 | ✅ | | |
| 0x80B2 | opMarkAreaKnown | mark_area_known :3164 | ✅ | | |
| 0x80B3 | opReactionInfluence | reaction_influence :2504 | ✅ | | 0 as CE |
| 0x80B4 | opRandom | random :743 | ✅ | | randomBetween |
| 0x80B5 | opRollDice | vm_bridge.ts:106 / prelude `roll_dice` | ✅ | | 0 as CE |
| 0x80B6 | opMoveTo | move_to :2408 | ⚠️ | MED | OP-12: elevation compared with the current elevation, not the object's; returns undefined (CE: new tile or -1) |
| 0x80B7 | opCreateObject | create_object_sid :1890 | ✅ | | pid 0 not refused (LOW); a bad elevation returns null where CE still creates the object |
| 0x80B8 | opDisplayMsg | display_msg :751 | ✅ | | |
| 0x80B9 | opScriptOverrides | script_overrides :1039 | ✅ | | |
| 0x80BA | opObjectIsCarryingObjectWithPid | obj_is_carrying_obj_pid :1301 | ⚠️ | HIGH | OP-02 |
| 0x80BB | opTileContainsObjectWithPid | tile_contains_obj_pid :2389 | ⚠️ | MED | OP-10: 0 for any elevation but the current one |
| 0x80BC | opGetSelf | builtin self_obj (vm_bridge.ts:54) | ✅ | | |
| 0x80BD | opGetSource | builtin source_obj (vm_bridge.ts:62) | ⚠️ | LOW | OP-13: CE `scriptExecProc` clears `source` after every proc; DH2 keeps the last one |
| 0x80BE | opGetTarget | builtin target_obj | ✅ | | CE defaults target to the owner when null (minor) |
| 0x80BF | opGetDude | builtin dude_obj | ✅ | | |
| 0x80C0 | opGetObjectBeingUsed | obj_being_used_with :2509 | ✅ | | |
| 0x80C1 | opGetLocalVar | local_var :706 | ✅ | | |
| 0x80C2 | opSetLocalVar | set_local_var :701 | ✅ | | |
| 0x80C3 | opGetMapVar | map_var :712 | ✅ | | no map script: CE -1, DH2 undefined (LOW) |
| 0x80C4 | opSetMapVar | set_map_var :725 | ✅ | | |
| 0x80C5 | opGetGlobalVar | global_var :736 | ✅ | | |
| 0x80C6 | opSetGlobalVar | set_global_var :684 | ✅ | | the karma message is an sfall option in CE (off); DH2 mirrors karma / town reps into player stats (DH2-only) |
| 0x80C7 | opGetScriptAction | script_action :2513 | ⚠️ | LOW | OP-13: CE `script->action = proc` in scriptExecProc; DH2 never sets `action` → always 0 |
| 0x80C8 | opGetObjectType | obj_type :2112 | ✅ | | null: CE -1, DH2 null (LOW) |
| 0x80C9 | opGetItemType | obj_item_subtype :1934 | ⚠️ | LOW | non-item / null: CE -1, DH2 null |
| 0x80CA | opGetCritterStat | get_critter_stat :1054 | ✅ | | null: CE -1, DH2 TypeError (LOW) |
| 0x80CB | opSetCritterStat | set_critter_stat :1103 | ✅ | | dude only, adjust, returns 0 / -1 |
| 0x80CC | opAnimateStand | animate_stand_obj :3025 | 🟡 | LOW | CE: null → self, nothing in combat, plays ANIM_STAND; DH2 only `clearAnim()` |
| 0x80CD | opAnimateStandReverse | animate_stand_reverse_obj :2517 | ✅ | | |
| 0x80CE | opAnimateMoveObjectToTile | animate_move_obj_to_tile :2991 | ⚠️ | MED | OP-09 |
| 0x80CF | opTileInTileRect | tile_in_tile_rect :2380 | ⚠️ | MED | OP-10 |
| 0x80D0 | opAttackComplex | attack_complex :1700 | ✅ | | arg order and the result-override quirk match; DH2 starts combat at once and doesn't check `_gdialogActive` (LOW) |
| 0x80D1 | opMakeDayTime | make_daytime :2523 | ✅ | | empty in CE |
| 0x80D2 | opTileDistanceBetween | tile_distance :2151 | ✅ | | -1 → 9999 |
| 0x80D3 | opTileDistanceBetweenObjects | tile_distance_objs :2144 | ⚠️ | LOW | CE 9999 for different elevations / tile -1 / null; DH2 measures across elevations, null → null |
| 0x80D4 | opGetObjectTile | tile_num :2155 | ✅ | | null: CE -1, DH2 null (LOW) |
| 0x80D5 | opGetTileInDirection | tile_num_in_direction :2366 | ✅ | | origin -1 / rotation ≥ 6 not refused (LOW) |
| 0x80D6 | opPickup | pickup_obj :2525 | ✅ | | set_self honoured |
| 0x80D7 | opDrop | drop_obj :2534 | ✅ | | |
| 0x80D8 | opAddObjectToInventory | add_obj_to_inven :1363 | ⚠️ | HIGH | OP-03; CE also refuses an item that already has an owner |
| 0x80D9 | opRemoveObjectFromInventory | rm_obj_from_inven :1366 | ✅ | | equipped item unequipped first |
| 0x80DA | opWieldItem | wield_obj_critter :1643 | ✅ | | |
| 0x80DB | opUseObject | use_obj :2003 | ✅ | | CE uses script->target as the user for a critter self (minor) |
| 0x80DC | opObjectCanSeeObject | obj_can_see_obj :1389 | ⚠️ | MED | OP-10: no elevation / tile -1 check; perception skipped for non-critter targets; CE needs the straight path's first obstacle to be the target |
| 0x80DD | opAttackComplex (2nd registration) | attack_complex :1700 | ✅ | | |
| 0x80DE | opStartGameDialog | start_gdialog :2452 | ✅ | | in combat CE returns entirely, DH2 opens the dialogue window without the head (LOW) |
| 0x80DF | opEndGameDialog | end_dialogue :2815 | ✅ | | |
| 0x80E0 | opGameDialogReaction | dialogue_reaction :2739 | ✅ | | |
| 0x80E1 | opMetarule3 | metarule3 :932 | ⚠️ | MED | OP-14: 106 TILE_GET_NEXT_CRITTER ignores elevation and the previous critter and skips the dude; 100 removes only the first match; 101 / 105 not implemented (105 returns 1) |
| 0x80E2 | opSetMapMusic | set_map_music :2682 | ✅ | | |
| 0x80E3 | opSetObjectVisibility | set_obj_visibility :1967 | 🟡 | LOW | CE also sets / clears OBJECT_NO_BLOCK on hidden critters and drops the combat outline |
| 0x80E4 | opLoadMap | load_map :3118 | ✅ | | deferred transition, GVAR 27 |
| 0x80E5 | opWorldmapCitySetPos | wm_area_set_pos :3179 | ✅ | | |
| 0x80E6 | opSetExitGrids | set_exit_grids :2130 | ✅ | | rotation unused in CE too |
| 0x80E7 | opAnimBusy | anim_busy :1947 | ✅ | | returns a boolean |
| 0x80E8 | opCritterHeal | critter_heal :1666 | ✅ | | critterAdjustHitPoints |
| 0x80E9 | opSetLightLevel | set_light_level :2054 → gametime.ts:240 | ✅ | | CE intensity formula |
| 0x80EA | opGetGameTime | builtin game_time (vm_bridge.ts:58) | ⚠️ | HIGH | OP-01 |
| 0x80EB | opGetGameTimeInSeconds | builtin game_time_in_seconds | ✅ | | live |
| 0x80EC | opGetObjectElevation | elevation :1381 | ✅ | | null: CE 0, DH2 -1 (LOW) |
| 0x80ED | opKillCritter | kill_critter :1539 | 🟡 | LOW | OP-15: on self CE stops the procedure (PROGRAM_FLAG_0x0100); DH2 runs on |
| 0x80EE | opKillCritterType | kill_critter_type :2696 | ✅ | | ftList, 200 cap; lastVisitTime not touched (LOW) |
| 0x80EF | opCritterDamage | critter_dmg :1657 | ⚠️ | HIGH | OP-05 |
| 0x80F0 | opAddTimerEvent | add_timer_event :3072 | ✅ | | |
| 0x80F1 | opRemoveTimerEvent | rm_timer_event :3091 | ✅ | | |
| 0x80F2 | opGameTicks | game_ticks :3098 | ⚠️ | LOW | CE clamps a negative value to 0 |
| 0x80F3 | opHasTrait | has_trait :1132 | ⚠️ | LOW | unknown OBJECT param: CE 0, DH2 -1; DH2 adds 34 / 667 / 668 (not in CE) |
| 0x80F4 | opDestroyObject | destroy_object :2123 | ⚠️ | HIGH | OP-04; OP-15 (self) |
| 0x80F5 | opObjectCanHearObject | obj_can_hear_obj :1397 | ✅ | | DH2 also requires a critter listener (minor) |
| 0x80F6 | opGameTimeHour | builtin game_time_hour | ✅ | | live HHMM |
| 0x80F7 | opGetFixedParam | builtin fixed_param | ✅ | | |
| 0x80F8 | opTileIsVisible | tile_is_visible :2172 | ⚠️ | MED | OP-10: CE `tileIsVisible` = within 5 columns or rows of `gCenterTile`; DH2 = tile is lit (known_bugs S20 calls the light version "done") |
| 0x80F9 | opGameDialogSystemEnter | dialogue_system_enter :2840 | ✅ | | deferred request |
| 0x80FA | opGetActionBeingUsed | builtin action_being_used | ✅ | | |
| 0x80FB | opGetCritterState | critter_state :1517 | 🟡 | LOW | prone from knockdown flags, not the SF frame; null / non-critter: CE DEAD (1), DH2 0 / TypeError |
| 0x80FC | opGameTimeAdvance | game_time_advance :3108 | ✅ | | |
| 0x80FD | opRadiationIncrease | radiation_inc :1686 | ✅ | | |
| 0x80FE | opRadiationDecrease | radiation_dec :1692 | ✅ | | |
| 0x80FF | opCritterAttemptPlacement | critter_attempt_placement :1507 | ✅ | | returns 0, CE the placement rc (LOW) |
| 0x8100 | opGetObjectPid | obj_pid :2097 | ✅ | | null: CE -1, DH2 null (LOW) |
| 0x8101 | opGetCurrentMap | builtin cur_map_index | ✅ | | |
| 0x8102 | opCritterAddTrait | critter_add_trait :1192 | ⚠️ | MED | OP-16: an AI-packet change isn't seen by the critter's cached `ai.packet`; TEAM doesn't skip party members or clear who-hit-me; DH2 extras (rotation, visibility); returns undefined (CE -1) |
| 0x8103 | opCritterRemoveTrait | critter_rm_trait :2723 | ✅ | | |
| 0x8104 | opGetProtoData | proto_data :1816 | ✅ | | |
| 0x8105 | opGetMessageString | message_str :756 | ✅ | | a negative msg id isn't mapped to "Error" (LOW); no speech |
| 0x8106 | opCritterGetInventoryObject | critter_inven_obj :1484 | ⚠️ | MED | OP-08; also non-object → `throw` |
| 0x8107 | opSetObjectLightLevel | obj_set_light_level :2061 | ✅ | | |
| 0x8108 | opWorldmap | world_map :2686 | ✅ | | opens at once (CE: request) |
| 0x8109 | _op_inven_cmds | inven_cmds :1496 | ✅ | | the index leaves out the dude's equipped items (consistent with the -2 count) |
| 0x810A | opFloatMessage | float_msg :2855 | 🟡 | LOW | CE: an empty string removes the object's float texts; another elevation → nothing; WARNING centres on the dude; the colour sequence starts at 1 (DH2 0) |
| 0x810B | opMetarule | metarule :759 | ⚠️ | HIGH | OP-06 (16), OP-07 (13 / 15 / 18 / 19); 43 INVEN_UNWIELD_WHO hand-rolled (LOW); 32 returns 1, not wmCarFillGas's rc (LOW) |
| 0x810C | opAnim | anim :2011 | ✅ | | |
| 0x810D | opObjectCarryingObjectByPid | obj_carrying_pid_obj :1369 | ⚠️ | MED | OP-02: no recursion into containers; the player's equipped items are missed |
| 0x810E | opRegAnimFunc | reg_anim_func :2880 | ✅ | | |
| 0x810F | opRegAnimAnimate | reg_anim_animate :2906 | ✅ | | |
| 0x8110 | opRegAnimAnimateReverse | reg_anim_animate_reverse :2912 | ✅ | | |
| 0x8111 | opRegAnimObjectMoveToObject | reg_anim_obj_move_to_obj :2916 | ✅ | | |
| 0x8112 | opRegAnimObjectRunToObject | reg_anim_obj_run_to_obj :2921 | ✅ | | |
| 0x8113 | opRegAnimObjectMoveToTile | reg_anim_obj_move_to_tile :3020 | ✅ | | |
| 0x8114 | opRegAnimObjectRunToTile | reg_anim_obj_run_to_tile :2690 | ✅ | | |
| 0x8115 | opPlayGameMovie | play_gmovie :3137 | ✅ | | doesn't block the script (documented) |
| 0x8116 | opAddMultipleObjectsToInventory | add_mult_objs_to_inven :1319 | ⚠️ | HIGH | OP-03; CE clamps the quantity (< 0 → 1, > 99999 → 99999) |
| 0x8117 | opRemoveMultipleObjectsFromInventory | rm_mult_objs_from_inven :1338 | ✅ | | |
| 0x8118 | opGetMonth | builtin get_month | ✅ | | |
| 0x8119 | opGetDay | builtin get_day | ✅ | | |
| 0x811A | opExplosion | explosion :3030 | 🟡 | LOW | elevation ignored (current elevation); tile -1 not refused; immediate (CE request) |
| 0x811B | opGetDaysSinceLastVisit | days_since_visited :3101 | ✅ | | |
| 0x811C | _op_gsay_start | gsay_start :2754 | ✅ | | |
| 0x811D | _op_gsay_end | vm_bridge.ts:317 / gsay_end :2801 | ✅ | | suspend + resume |
| 0x811E | _op_gsay_reply | gsay_reply :2765 | ✅ | | |
| 0x811F | _op_gsay_option | vm_bridge.ts:328 / gsay_option :2743 | ✅ | | |
| 0x8120 | _op_gsay_message | gsay_message :2777 | ✅ | | the synthesised option text is "[Done]" (see the dialogue audit) |
| 0x8121 | _op_giq_option | vm_bridge.ts:340 / giq_option :2819 | ✅ | | INT + Smooth Talker, both signs; a string proc target isn't handled by the VM wrapper (LOW) |
| 0x8122 | opPoison | poison :1681 | ✅ | | |
| 0x8123 | opGetPoison | get_poison :1543 | ✅ | | |
| 0x8124 | opPartyAdd | party_add :3211 | ✅ | | |
| 0x8125 | opPartyRemove | party_remove :3215 | ✅ | | |
| 0x8126 | opRegAnimAnimateForever | reg_anim_animate_forever :2987 | ✅ | | |
| 0x8127 | opCritterInjure | critter_injure :1626 | ✅ | | |
| 0x8128 | opCombatIsInitialized | builtin combat_is_initialized (vm_bridge.ts:55) | ⚠️ | HIGH | OP-01 |
| 0x8129 | _op_gdialog_barter | gdialog_mod_barter :2444 | ✅ | | |
| 0x812A | opGetGameDifficulty | game_difficulty :2541 | ✅ | | |
| 0x812B | opGetRunningBurningGuy | running_burning_guy :2546 | ✅ | | |
| 0x812C | _op_inven_unwield | inven_unwield :2551 | ✅ | | |
| 0x812D | opObjectIsLocked | obj_is_locked :1755 | ⚠️ | LOW | null: CE 0, DH2 1 |
| 0x812E | opObjectLock | obj_lock :1763 | ✅ | | |
| 0x812F | opObjectUnlock | obj_unlock :1771 | ✅ | | |
| 0x8131 | opObjectOpen | obj_open :1806 | ⚠️ | MED | OP-17 |
| 0x8130 | opObjectIsOpen | obj_is_open :1788 | ✅ | | |
| 0x8132 | opObjectClose | obj_close :1796 | ⚠️ | MED | OP-17 |
| 0x8133 | opGameUiDisable | game_ui_disable :3187 | ✅ | | DH2 also hides the HUD bar (CE only disables it; LOW) |
| 0x8134 | opGameUiEnable | game_ui_enable :3194 | ✅ | | |
| 0x8135 | opGameUiIsDisabled | game_ui_is_disabled :2557 | ✅ | | |
| 0x8136 | opGameFadeOut | gfade_out :3041 | 🟡 | LOW | CE: the argument only gates (0 = error), the fade has a fixed length and blocks; DH2 uses it as milliseconds and doesn't block |
| 0x8137 | opGameFadeIn | gfade_in :3058 | 🟡 | LOW | as 0x8136 |
| 0x8138 | opItemCapsTotal | item_caps_total :1259 | ✅ | | null → `throw` (CE 0; LOW) |
| 0x8139 | opItemCapsAdjust | item_caps_adjust :1264 | ✅ | | the NaN guard is DH2-only (L7) |
| 0x813A | _op_anim_action_frame | anim_action_frame :2561 | ✅ | | uses the proto's FRM, not the object's current fid (LOW) |
| 0x813B | opRegAnimPlaySfx | reg_anim_play_sfx :2573 | ✅ | | |
| 0x813C | opCritterModifySkill | critter_mod_skill :1406 | ⚠️ | LOW | CE: dude only, tagged skills get half the points (skillAddForce one at a time), amount 0 = error; DH2 adds `amount` to the base of any critter |
| 0x813D | opSfxBuildCharName | sfx_build_char_name :2581 | ✅ | | |
| 0x813E | opSfxBuildAmbientName | sfx_build_ambient_name :2598 | ✅ | | |
| 0x813F | opSfxBuildInterfaceName | sfx_build_interface_name :2603 | ✅ | | |
| 0x8140 | opSfxBuildItemName | sfx_build_item_name :2606 | ✅ | | |
| 0x8141 | opSfxBuildWeaponName | sfx_build_weapon_name :2610 | ✅ | | |
| 0x8142 | opSfxBuildSceneryName | sfx_build_scenery_name :2624 | ✅ | | |
| 0x8143 | opAttackSetup | attack_setup :2629 | ✅ | | reads `isFleeing` while critter_set_flee_state writes `fleeing` (LOW); a knocked-out attacker isn't refused |
| 0x8144 | opDestroyMultipleObjects | destroy_mult_objs :2653 | ✅ | | owner search: current-elevation objects + the dude, not nested containers (LOW) |
| 0x8145 | opUseObjectOnObject | use_obj_on_obj :1979 | 🟡 | MED | OP-18 |
| 0x8146 | opEndgameSlideshow | endgame_slideshow :3145 | ✅ | | immediate (CE request) |
| 0x8147 | opMoveObjectInventoryToObject | move_obj_inven_to_obj :1287 | ✅ | | |
| 0x8148 | opEndgameMovie | endgame_movie :3153 | ✅ | | |
| 0x8149 | opGetObjectFid | obj_art_fid :1955 | ✅ | | `frmPID` may be null for objects created at runtime → 0 (unverified, LOW) |
| 0x814A | opGetFidAnim | art_anim :1963 | ✅ | | |
| 0x814B | opGetPartyMember | party_member_obj :3207 | ✅ | | |
| 0x814C | opGetRotationToTile | rotation_to_tile :2400 | 🟡 | LOW | direction of the nearest-neighbour step, not CE's screen-angle `tileGetRotationTo`; can differ for distant tiles |
| 0x814D | opJamLock | jam_lock :1780 | ✅ | | |
| 0x814E | opGameDialogSetBarterMod | gdialog_set_barter_mod :2439 | ✅ | | |
| 0x814F | opGetCombatDifficulty | combat_difficulty :2669 | ✅ | | |
| 0x8150 | opObjectOnScreen | obj_on_screen :2104 | ✅ | | |
| 0x8151 | opCritterIsFleeing | critter_is_fleeing :1639 | ✅ | | |
| 0x8152 | opCritterSetFleeState | critter_set_flee_state :1745 | ✅ | | |
| 0x8153 | opTerminateCombat | terminate_combat :1741 | 🟡 | LOW | CE also makes self (a critter) DISENGAGING and forgets its target |
| 0x8154 | opDebugMessage | debug_msg :747 | ✅ | | |
| 0x8155 | opCritterStopAttacking | critter_stop_attacking :2674 | ✅ | | |

### interpreter_lib.cc (`intLibInit` lines 2200–2282)

DH2 has no handler for any of these except 0x806B (`vm.ts:173`, pops the file name, draws
nothing — gcfestus.int passes a message text, so CE finds no file either; prelude `display` does
the same). An unhandled opcode makes `ScriptVM.step` log `unimplemented opcode` and end the
procedure. The 2026-10-18 opcode scan (known_bugs C54, `wiki/map_scripting.md`) found none of
them in the 1288 scripts of scripts.lst; they are the interpreter's window / button / region /
sound / say-window library, which Fallout 2's game scripts don't use (game dialogue goes through
the `gsay_*` opcodes above). Not re-verified against the .int files (they are not in the repo).

| Opcode (hex) | CE op_ function (file) | DH2 | Status | Notes |
|---|---|---|---|---|
| 0x804C–0x8061 | opSayQuit, opSayEnd, opSayStart, opSayStartPos, opSayReplyTitle, opSayGoToReply, opSayOption, opSayReply, opSayMessage, opSayReplyWindow, opSayOptionWindow, opSayBorder, opSayScrollUp, opSayScrollDown, opSaySetSpacing, opSayOptionColor, opSayReplyColor, opSayRestart, opSayGetLastPos, opSayReplyFlags, opSayOptionFlags, opSayMessageTimeout | — | 🚫 (22) | dialog.cc say windows (not the game dialogue) |
| 0x8062–0x806A | opCreateWin, opDeleteWin, opSelect, opResizeWin, opScaleWin, opShowWin, opFillWin, opFillRect, opFillWin3x3 | — | 🚫 (9) | windows |
| 0x806B | opDisplay | vm.ts:173, prelude `display` | ✅ | pops 1, nothing drawn |
| 0x806C–0x806E | opDisplayGfx, opDisplayRaw, opLoadPaletteTable | — | 🚫 (3) | |
| 0x806F–0x8070 | opFadeIn, opFadeOut | — | 🚫 (2) | game scripts use gfade_in / out (0x8136 / 7) |
| 0x8071–0x8078 | opGotoXY, opPrint, opFormat, opPrintRect, opSetFont, opSetTextFlags, opSetTextColor, opSetHighlightColor | — | 🚫 (8) | text |
| 0x8079–0x807C | opStopMovie, opPlayMovie, opSetMovieFlags, opPlayMovieRect | — | 🚫 (4) | game scripts use play_gmovie (0x8115) |
| 0x807F–0x8085 | opAddRegion, opAddRegionFlag, opAddRegionProc, opAddRegionRightProc, opDeleteRegion, opActivateRegion, opCheckRegion | — | 🚫 (7) | |
| 0x8086–0x808C | opAddButton, opAddButtonText, opAddButtonFlag, opAddButtonGfx, opAddButtonProc, opAddButtonRightProc, opDeleteButton | — | 🚫 (7) | |
| 0x808D–0x8091 | opHideMouse, opShowMouse, opMouseShape, opRefreshMouse, opSetGlobalMouseFunc | — | 🚫 (5) | |
| 0x8092–0x8095 | opAddNamedEvent, opAddNamedHandler, opClearNamed, opSignalNamed | — | 🚫 (4) | NEVS (map_scripting.md) |
| 0x8096–0x8097 | opAddKey, opDeleteKey | — | 🚫 (2) | |
| 0x8098–0x809D | opSoundPlay, opSoundPause, opSoundResume, opSoundStop, opSoundRewind, opSoundDelete | — | 🚫 (6) | game scripts use play_sfx (0x80A3) |
| 0x809E–0x80A0 | opSetOneOptPause, opSelectFileList, opTokenize | — | 🚫 (3) | |

## Detailed findings

### OP-01 — `game_time` and `combat_is_initialized` are cached, not live (HIGH, NEW) — **FIXED 2026-10-24 (PA11)**
- CE: `interpreter_extra.cc opGetGameTime` → `gameTimeGetTime()`; `opCombatIsInitialized` →
  `isInCombat()`. Both are read at the moment the script asks.
- DH2: `vm_bridge.ts:55,58` builtins return `s.combat_is_initialized` / `s.game_time`, plain fields
  on the Script object (the Lua backend reads the same builtins through `readBuiltinVar`).
  - `game_time` is set in `talk` :3463, `updateCritter` :3474, `spatial` :3489, `destroy` :3501,
    `damage` :3514, `combatEvent` :3621, `updateMap` (object scripts) :3661, `objectRunProc` :3715,
    `objectEnterMap` :3726, `runViewProc` :3395 and `push` :3421 — never in `timedEvent` :3372,
    `use` :3404, `useSkillOn` :3522, `pickup` :3537, `drop` / `isDropping`, `useObjOnItem`,
    `useObjOnMe`, `initScript` (`start`), or for the map script in `enterMap` / `updateMap`.
    A map script's `map_enter_p_proc` therefore reads `undefined`, and a `timed_event_p_proc`
    reads whatever time the last other entry point stored. It also doesn't advance inside a
    procedure across `game_time_advance`.
  - `combat_is_initialized` is set to 1 in `combatEvent` :3617 and reset to 0 only in
    `updateMap` (scripts with a `map_update_p_proc`), `objectRunProc` and `objectEnterMap`. A
    critter whose script has no `map_update_p_proc` keeps 1 after its first combat, so its
    `critter_p_proc` / `talk_p_proc` `if (not combat_is_initialized)` branches stop running.
- Impact: timers based on `game_time` (elapsed-days checks, "come back tomorrow", rest gates) and
  combat-gated idle behaviour (floats, wandering, dialogue refusals). The VM-vs-Lua test
  (`luaDiff.ts:197`) pins `game_time` to 12345, so it can't see this.
- Fix: make both builtins live: `game_time: () => Math.max(1, globalState.gameTickTime)`,
  `combat_is_initialized: () => isCombatActive() ? 1 : 0`; drop the per-entry-point assignments.

### OP-02 — `obj_is_carrying_obj_pid` counts stacks; `obj_carrying_pid_obj` doesn't recurse (HIGH / MED, NEW) — **FIXED 2026-10-24 (PA8)**
- CE: `inventory.cc:2857 objectGetCarriedQuantityByPid` sums `inventoryItem->quantity` of every
  matching stack and recurses into every item's own inventory (bags); `:2837
  objectGetCarriedObjectByPid` returns the first match, recursing as well. In CE equipped items
  are in the inventory list too.
- DH2 :1301 counts matching *stacks* (`count++`); `addInventoryItem` (Obj.ts:947) merges equal items
  into one stack with `amount`. :1369 looks at the top level only. The player's hand and armor
  items are spliced out of `inventory` (`inventoryWield.ts invenWield`), so they aren't counted;
  an NPC's stay in the list (flagged), so they are.
- Impact: every "do you have N of X" check ("bring me 5 …", `> 1` tests,
  `rm_mult_objs_from_inven(…, obj_is_carrying_obj_pid(…))` patterns that then remove only one); an
  item inside a bag, or the player's equipped weapon / armor, is invisible to quest checks.
- Fix: sum `stack.amount` over matches plus recursion into `item.inventory`, and include the
  player's `leftHand` / `rightHand` / `armor` (as CE's list does); same for `obj_carrying_pid_obj`.

### OP-03 — `add_obj_to_inven` / `add_mult_objs_to_inven` add a clone (HIGH, NEW) — **FIXED 2026-10-24 (PA7)**
- CE `opAddObjectToInventory` / `opAddMultipleObjectsToInventory`: `itemAdd(owner, item, qty)` makes
  that object (or the stack it merges into) the inventory entry and `_obj_disconnect`s it from the
  map; an item that already has an owner is refused (single form). The quantity is clamped to
  1..99999.
- DH2 :1319 → `Obj.addInventoryItem` (Obj.ts:956) pushes `item.clone().setAmount(count)` when no
  stack matches. The original object (usually from `create_object`, which `addObject`s it to the
  map at tile 0) stays on the map, and the script's variable points at it, not at the inventory
  copy. A following `wield_obj_critter(npc, item)` (`inventoryWield.ts:63`) puts the original
  into the NPC's inventory as well → two copies (both drop on death). `rm_obj_from_inven(owner,
  item)` falls back to `approxEq`, so removal mostly still works.
- Impact: duplicated weapons / armor on scripted NPCs, stray objects on the map (tile 0), items with
  their own script running twice.
- Fix: in `add_mult_objs_to_inven`, remove the item from the map (`gMap.removeObject`) and push the
  object itself when no stack matches (merge into an existing stack otherwise, as itemAdd does);
  refuse an item already carried; clamp the quantity.

### OP-04 — `destroy_object` doesn't remove carried items (HIGH, NEW) — **FIXED 2026-10-24 (PA9)**
- CE `opDestroyObject`: `objectGetOwner(object)` → `itemRemove(owner, object, quantity)`, interface
  refresh for the dude, then `objectDestroy` (which runs `destroy_p_proc`, object.cc
  `_obj_remove`). A critter is dropped from combat first. Destroying self hides the object and
  stops the procedure (PROGRAM_FLAG_0x0100).
- DH2 :2123 → `GameMap.destroyObject` (GameMap.ts:148): `Scripting.destroy`, then `removeObject`,
  which queues a search over the map's object lists only (`drainRemovalQueue`). A carried item is
  never found ("object not found on map") and stays in the inventory.
- Impact: quest items that scripts take away with `destroy_object(obj_carrying_pid_obj(dude_obj,
  PID))` (keys, holodisks, delivered packages) stay with the player; quest state and inventory
  disagree.
- Fix: find the owner (map critters / containers recursively, plus the dude), unequip and splice
  the item (as `destroy_mult_objs` already does), refresh the UI, then run destroy_p_proc.

### OP-05 — `critter_dmg` deals raw damage (HIGH, NEW) — **FIXED 2026-10-24 (PA10)**
- CE `opCritterDamage` → `actions.cc:1890 actionDamage(tile, elevation, amount, amount, type,
  animate = !(flags & 0x200), bypassArmor = flags & 0x100)`: the defender is whatever blocks the
  tile; damage = `_compute_dmg_damage` (amount − DT[type], then − DR[type] %, ≥ 0, knockback)
  unless bypassed; a hidden dummy attacker; `_combat_display` puts the hit in the message log;
  `_apply_damage` with death flags. Self-damage stops the procedure.
- DH2 :1657 → `critterDamage(obj, damage, self_obj, …, damageType)` (critter/lifecycle.ts:332):
  HP − damage directly; the 0x100 / 0x200 bits aren't split off (the whole value goes in as the
  "damage type", used only for the death animation); `source` is the script's self object; no
  message.
- Impact: traps, radiation spills, gas and scripted environmental damage ignore armor (Power Armor
  gives no protection), and a value with 0x100 / 0x200 picks the wrong death animation.
- Fix: decode the flags, apply DT/DR for the type (reuse the combat damage helpers), log the hit,
  use a neutral source for `damage_p_proc`.

### OP-06 — `metarule(METARULE_PARTY_COUNT)` off by one (HIGH, NEW) — **FIXED 2026-10-24 (PA12)**
- CE `party_member.cc:900 _getPartyMemberCount`: `gPartyMembersLength` (the dude is entry 0) minus
  members that aren't critters, are dead or hidden.
- DH2 :777 `globalState.gParty?.party.length` — `Party.party` holds only the companions
  (`party.ts:82`), dead or hidden ones included.
- Impact: companion scripts limit the party to `1 + CHA/2` (+ Magnetic Personality) through this
  value, so DH2 allows one companion more than CE; a dead companion still listed takes a slot.
- Fix: `1 + party.filter(c => c.type === 'critter' && !c.dead && c.visible !== false).length`.
  Correct `wiki/companion_party.md` ("DH2: the same").

### OP-07 — `metarule` 13 / 15 / 18 / 19 (MED, NEW) — **FIXED 2026-10-25**
- 13 SIGNAL_END_GAME (:761): CE sets `_game_user_wants_to_quit = 2` (back to the main menu after
  the end sequence). DH2 calls `(Endgame as any).triggerEnd?.()`, which `endgame.ts` doesn't
  export → no-op.
- 15 ELEVATOR (:771): CE `scripts.cc:1154 scriptsRequestElevator(self, type)` scans a 10×10 tile
  square around the *script's self object* for the elevator stub 0x200050D and takes its type /
  level, else uses the explicit type (−1 → refuse); the trip happens after the script. DH2
  `throw`s when the type isn't −1 (`lua_scripts.md` notes calls that pass `ELEV_…`), and
  `useElevator` (main.ts:974) searches around the *player* and throws when no stub is found. A
  thrown string isn't a `VMFatalError`, so it escapes `ScriptVM.run`.
- 18 WHO_ON_DRUGS (:780): CE `queueHasEvent(param, EVENT_TYPE_DRUG)`. DH2 reads
  `(this as any).self` — no such field — and always returns 0; the argument is ignored.
- 19 MAP_KNOWN (:794): CE `wmMapIsKnown(mapIndex)`. DH2 compares `entrance.mapName` (a string)
  with the numeric index → never matches → 0.
- Fix: 13 → the main-menu path used after `playSlideshow`; 15 → port the stub search around
  `self_obj` with the explicit-type fallback, no throw; 18 → search `timeEventList` for the
  target's drug events; 19 → `lookupMapName(target)`, then the map's known state.

### OP-08 — `critter_inven_obj` hands for the dude (MED, NEW) — **FIXED 2026-10-25**
- CE `opCritterGetInventoryObject`: for gDude, INVEN_TYPE_RIGHT_HAND returns `critterGetItem2`
  only if the current hand isn't HAND_LEFT (else null); LEFT_HAND returns `critterGetItem1` only
  if it is. NPCs get their slots. A non-critter pushes 0. INV_COUNT counts the full inventory list
  (equipped items included).
- DH2 :1484 returns `obj.rightHand` / `obj.leftHand` whatever the active hand is; a non-object
  → `throw`.
- Impact: scripts that ask what the player is holding (`critter_inven_obj(dude_obj,
  INVEN_TYPE_RIGHT_HAND)` → guards' weapon checks, "put your weapon away" dialogue) see the
  inactive hand's item.
- Fix: for the player, return a hand slot only when it is the active hand (`activeHand`).

### OP-09 — `animate_move_obj_to_tile` flags and guards (MED, NEW) — **FIXED 2026-10-25**
- CE `opAnimateMoveObjectToTile`: tile ≤ −1 → nothing; inactive critter or combat → nothing;
  `flags & 0x10` (ANIMATE_INTERRUPT) → `reg_anim_clear`, and the bit is dropped; then walk if
  `flags == 0`, else run.
- DH2 :2991 `walkTo(tile, !!isRun)`: 0x10 alone means run; no combat / active check.
- Impact: NPCs sprint where they should walk when a script passes the interrupt bit; scripted
  movement during combat moves critters outside their turns.
- Fix: treat 0x10 as "clear the current animation", run only for the other bits, return in combat
  or for dead / knocked-out critters.

### OP-10 — tile / visibility helpers (MED, NEW) — **FIXED 2026-10-25**
- `tile_is_visible` (0x80F8): CE `interpreter_extra.cc:401 tileIsVisible` — 1 when
  `abs(gCenterTile − tile) % 200 < 5` or `/ 200 < 5` (near the screen centre). DH2 :2172 —
  `Lightmap.tile_intensity[tile] > 0`. Scripts use it to decide whether something happens in view
  (spawns, removals). known_bugs S20 treats the light-map version as correct.
- `tile_in_tile_rect` (0x80CF): CE — inclusive `lr.x ≤ x ≤ ul.x`, `ul.y ≤ y ≤ lr.y`; only ul and
  lr matter. DH2 :2380 → `hexGrid.ts:234` — exclusive bounds (edge tiles are outside), and any
  inconsistent corner set returns false.
- `tile_contains_obj_pid` (0x80BB): CE searches the given elevation. DH2 :2389 returns 0 unless it
  is the current elevation.
- `obj_can_see_obj` (0x80DC): CE — same elevation, both tiles valid, `isWithinPerception(a, b)` for
  any target, then the target must be the first obstacle of `_make_straight_path(…, 16)`. DH2
  :585 — no elevation check, non-critter targets skip perception, LOS by `hexLinecast`.
- `tile_distance_objs` (0x80D3, LOW): CE 9999 across elevations; DH2 measures anyway.
- Fix: port each CE test literally.

### OP-11 — `override_map_start` is deferred (MED, NEW) — **FIXED 2026-10-25**
- CE `opOverrideMapStart`: sets the dude's rotation and location (`objectSetLocation`) and centres
  the view immediately.
- DH2 :2092 stores `overrideStartPos`, which only `enterMap` returns (consumed after the map
  script's `map_enter_p_proc`). Called anywhere else (a `timed_event_p_proc`, a critter script)
  nothing happens until the *next* map load, which then puts the player at a stale position.
- Fix: move the player at once (as `move_to` does for the dude); keep the hand-off only for the
  map-enter case.

### OP-12 — `move_to` elevation handling (MED, NEW) — **FIXED 2026-10-25**
- CE `opMoveTo`: `objectSetLocation(object, tile, elevation)` for any object; a critter changing
  elevation leaves combat; pushes the new tile (−1 on failure).
- DH2 :2408 compares `elevation` with `globalState.currentElevation`, not the object's own: an NPC
  on another elevation moved to the current elevation stays in the other elevation's object list
  with its new position; the return value is `undefined`.
- Fix: compare with `obj.elevation`, re-home the object between elevation lists whenever they
  differ, return the tile.

### OP-13 — per-proc script fields aren't reset (LOW, NEW) — **FIXED 2026-10-25**
- CE `scripts.cc scriptExecProc` (:1336–1340): `script->action = proc` before the run,
  `script->source = nullptr` after it; `target` defaults to the owner.
- DH2: `action` is never assigned (`script_action` is always 0); `source_obj` keeps its last value
  across procs (a `critter_p_proc` sees whoever last talked to the critter; CE sees 0).
- **Fixed 2026-10-25:** every engine call into a procedure (VM `GameScriptVM.engineCall`, the Lua proc wrapper) sets `action` to its SCRIPT_PROC_* number (`src/scriptProcs.ts`) and clears `source_obj` afterwards, unless the procedure is waiting in a dialogue. Startup code is not an engine call (no change).

### OP-14 — `metarule3` 100 / 105 / 106 (MED, NEW) — **FIXED 2026-10-25**
- 106 TILE_GET_NEXT_CRITTER: CE walks the critters at (tile, elevation) and returns the one after
  `previousCritter` (the dude included). DH2 :984 ignores both elevation and the previous critter
  and skips the dude, so a `while (c := tile_get_next_critter(t, e, c))` loop never advances.
- 100 CLR_FIXED_TIMED_EVENTS: CE `_queue_clear_type(EVENT_TYPE_SCRIPT, _scrQueueRemoveFixed)`
  removes every script event of that object with that fixed param; DH2 removes only the first
  matching event, of any type.
- 101 / 105 subtile marking: DH2 no-op / constant 1 (worldmap fog of war not implemented).

### OP-15 — self-destruction doesn't stop the procedure (LOW, NEW) — **FIXED 2026-10-25**
- CE `destroy_object`, `destroy_mult_objs`, `kill_critter` and `critter_dmg` on self set
  PROGRAM_FLAG_0x0100, which ends `_interpret` (interpreter.cc:2628 / 2649). DH2 keeps executing
  the rest of the procedure on a destroyed / dead self.
- **Fixed 2026-10-25:** `destroy_object`, `destroy_mult_objs`, `kill_critter` and `critter_dmg` on the script's own `self_obj` end the procedure (VM: halt and drop the frame; Lua: EXIT). CE's flag also keeps the script from running any later procedure until it is reloaded; DH2 stops only the current one.

### OP-16 — `critter_add_trait` OBJECT traits (MED, NEW) — **FIXED 2026-10-25**
- CE `opCritterAddTrait`: AI_PACKET → `combat_ai.cc:3280 critterSetAiPacket` (also writes the
  proto for potential party members); TEAM → skipped for party members, for an unchanged team and
  while loading, else `critterSetTeam` (clears who-hit-me if now the same team, the last target,
  the combat outline); other OBJECT params are ignored; pushes −1.
- DH2 :1192 sets `aiNum` only — `Critter.ai` (`combat/AI.ts`, created once at the critter's first
  combat, Combat.ts:370) keeps the old packet; TEAM sets `teamNum` for party members too and
  doesn't clear `whoHitMe`; ROTATION (10) and VISIBILITY (666) are DH2 extras; no return value.
- Impact: scripts that switch an NPC to another AI packet mid-game have no effect after its first
  fight; team changes keep the old grudge.
- Fix: refresh or drop `critter.ai` on an AI-packet change; port the TEAM guards and side effects.

### OP-17 — `obj_open` / `obj_close` go through the use path (MED, NEW) — **FIXED 2026-10-25**
- CE `proto_instance.cc:2090 objectOpen` / `:2100 objectClose`: toggle when the frame says closed /
  open — the lock isn't checked, no UI, nobody animates.
- DH2 :1806 / :1796 → `Obj.use(self_obj, false)` → plays the `use` animation on the script's self
  critter (Obj.ts:1212), then `setObjectOpen(obj, …, loot = true)` (Obj.ts:326), which refuses a
  locked door / container ("It is locked." + the locked sound) and opens the loot window when a
  container opens.
- Fix: call `setObjectOpen(obj, true / false, false, true)` directly, without the lock check.

### OP-18 — `use_obj_on_obj` lacks the engine's default use (MED, NEW) — **FIXED 2026-10-25**
- CE `opUseObjectOnObject`: a critter self → `_action_use_an_item_on_object(self, target, item)`
  (walk + animation, then `_obj_use_item_on`), else `_obj_use_item_on(self, target, item)`: the
  target's `use_obj_on_p_proc`, and if not overridden the item's own effect (drug / healing item on
  a critter, skill items), the item consumed.
- DH2 :1979 runs the item's, then the target's `use_obj_on_p_proc`; without an override nothing
  happens (no drug effect, no heal, no consumption).
- Fix: fall through to the handler the player's "use item on" action uses.

### Note affecting all opcodes — exceptions escape the VM (MED, NEW)
- Several intrinsics `throw` a string on bad input (`item_caps_total`, `critter_inven_obj`,
  `get_pc_stat`, `metarule(15)`, `gsay_reply`, `start_gdialog`, `gdialog_mod_barter`), and many
  dereference a null object (TypeError). Neither is a `VMFatalError`, so `ScriptVM.run` (vm.ts:519)
  doesn't catch it and the exception escapes into the caller (game tick / UI handler). CE logs a
  "Script Error" and pushes a default (0, −1 or null). Suggest one guard in `bridged()` that turns
  an exception into the CE default plus a `dbgWarn`.

## DH2-only behaviour
- `set_global_var` mirrors GVAR 0 (karma) and the town-reputation GVARs into player stats.
- `has_trait` OBJECT answers 34 (sex), 667 (poison), 668 (radiation); `critter_add_trait` OBJECT
  handles 10 (rotation) and 666 (visibility) — CE ignores these params.
- `item_caps_adjust` refuses a non-number amount (L7 caravan-guard script fix).
- `game_ui_disable` hides the HUD bar (CE only disables input and the bar's buttons).
- `gfade_in` / `gfade_out` use their argument as milliseconds.
- `play_gmovie`, `endgame_slideshow`, `world_map`, `explosion`, `attack_complex` / `attack_setup`
  act at once instead of setting a script request that the main loop handles after the script
  (CE `scriptsRequest*`); `load_map` and `dialogue_system_enter` are deferred, as in CE.
- `dh2_script_fixes()` is a Script method (not an opcode) that the decompiled Lua asks before a
  script fix (`tools/int2lua.py` SCRIPT_FIXES).
- The sfall opcodes in `vm_bridge.ts` (arrays, `abs`, `get_ini_setting`, `set_self`, proto data,
  weapon ammo, PC base / extra stats, `party_member_list`, `get_script`, `sfall_func0-2`, …) are
  outside this audit's scope (CE `sfall_opcodes.cc`).
