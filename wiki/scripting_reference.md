# Scripting Reference — DarkHarold2

Companion to [scripting_vm.md](scripting_vm.md) and [map_scripting.md](map_scripting.md).

CE sources:
- `raw/fallout2-ce/src/scripts.h` (`SCRIPT_PROC_*` constants)
- `raw/fallout2-ce/src/scripts.cc` (`gScriptProcNames`, fire sites, opcode registration)
- `raw/fallout2-ce/src/interpreter.h` (VM opcode enum)
- `raw/fallout2-ce/src/interpreter.cc` (VM opcode handlers)
- `raw/fallout2-ce/src/interpreter_extra.cc` (intrinsic opcode registration)
- `raw/fallout2-ce/src/stat_defs.h` (`PcStat` enum)

DH2 sources:
- `src/scripting.ts` (all `Scripting.*` exports + `Script` class procs)
- `src/vm.ts` (VM opcode handlers)
- `src/vm_bridge.ts` (bridge, `bridgeOpMap`)

Cross-link: See [damage_formula.md](damage_formula.md) for how `attack_complex` and related opcodes connect to the damage pipeline.

<!-- audited: 2026-10-18 — opcode tables regenerated from CE interpreter.h / interpreter_extra.cc and DH2 vm.ts / vm_bridge.ts; all 1443 .int files scanned -->

---

## §1 Script Procedure Hooks (SCRIPT_PROC_*)

CE fires a named procedure in the script program for each event. Procedures are located by name at load time (`scriptLocateProcs`, `scripts.cc:1350`). Missing = not defined in the .int → CE skips gracefully.

Status key: `WIRED` = DH2 fires this proc where CE does; `N/A` = CE never fires it either.

| # | CE Constant | Proc Name | Triggered By (CE) | DH2 | Status |
|---|-------------|-----------|--------------|-----|--------|
| 0 | `SCRIPT_PROC_NO_PROC` | `no_p_proc` | Never (sentinel) | — | N/A |
| 1 | `SCRIPT_PROC_START` | `start` | Script init | `Scripting.initScript()` | WIRED |
| 2 | `SCRIPT_PROC_SPATIAL` | `spatial_p_proc` | Critter enters radius | `Scripting.spatial()` | WIRED |
| 3 | `SCRIPT_PROC_DESCRIPTION` | `description_p_proc` | Examine (`_obj_examine`) | `examine.ts` | WIRED |
| 4 | `SCRIPT_PROC_PICKUP` | `pickup_p_proc` | Pickup from the floor, inventory moves, steal | `Obj.pickup`, `ui_inventory/dragdrop.ts`, `ui_steal.ts` | WIRED |
| 5 | `SCRIPT_PROC_DROP` | `drop_p_proc` | `_obj_drop` (item's script; can override) | `Obj.drop` → `Scripting.drop()` | WIRED |
| 6 | `SCRIPT_PROC_USE` | `use_p_proc` | Object used | `Scripting.use()` | WIRED |
| 7 | `SCRIPT_PROC_USE_OBJ_ON` | `use_obj_on_p_proc` | Item used on this object | `useItemOn.ts` | WIRED |
| 8 | `SCRIPT_PROC_USE_SKILL_ON` | `use_skill_on_p_proc` | Skill used on object | `Scripting.useSkillOn()` | WIRED |
| 9, 10 | `SCRIPT_PROC_9/10` | `none_x_bad` | Unused | — | N/A |
| 11 | `SCRIPT_PROC_TALK` | `talk_p_proc` | Dialogue | `Scripting.talk()` | WIRED |
| 12 | `SCRIPT_PROC_CRITTER` | `critter_p_proc` | Heartbeat outside combat | `Scripting.updateCritter()` | WIRED |
| 13 | `SCRIPT_PROC_COMBAT` | `combat_p_proc` | Turn begin, hit, want-to-join (fixed_param 1/2/4…) | `Scripting.combatEvent()` (`combat/Combat.ts`) | WIRED |
| 14 | `SCRIPT_PROC_DAMAGE` | `damage_p_proc` | Damage taken | `Scripting.damage()` | WIRED |
| 15 | `SCRIPT_PROC_MAP_ENTER` | `map_enter_p_proc` | Map loaded | `Scripting.objectEnterMap()` | WIRED |
| 16 | `SCRIPT_PROC_MAP_EXIT` | `map_exit_p_proc` | Map left (`scriptsExecMapExitProc`) | `map/mapLoader.ts` | WIRED |
| 17 | `SCRIPT_PROC_CREATE` | `create_p_proc` | No CE fire site | — | N/A |
| 18 | `SCRIPT_PROC_DESTROY` | `destroy_p_proc` | Critter killed | `Scripting.destroy()` | WIRED |
| 19, 20 | `SCRIPT_PROC_19/20` | `none_x_bad` | Unused | — | N/A |
| 21 | `SCRIPT_PROC_LOOK_AT` | `look_at_p_proc` | Hover / look (`_obj_look_at`) | `examine.ts` | WIRED |
| 22 | `SCRIPT_PROC_TIMED` | `timed_event_p_proc` | `add_timer_event` fires | `Scripting.timedEvent()` | WIRED |
| 23 | `SCRIPT_PROC_MAP_UPDATE` | `map_update_p_proc` | Map update events | `Scripting.updateMap()` | WIRED |
| 24 | `SCRIPT_PROC_PUSH` | `push_p_proc` | `actionPush` | `ui_contextmenu.ts` | WIRED |
| 25 | `SCRIPT_PROC_IS_DROPPING` | `is_dropping_p_proc` | `_obj_drop` (owner's script; can override) | `Obj.drop` → `Scripting.isDropping()` | WIRED (2026-10-18) |
| 26 | `SCRIPT_PROC_COMBAT_IS_STARTING` | `combat_is_starting_p_proc` | No CE fire site | — | N/A |
| 27 | `SCRIPT_PROC_COMBAT_IS_OVER` | `combat_is_over_p_proc` | No CE fire site | — | N/A |

---

## §2 Script Variable Context

Variables set on the `Script` object before each proc is called:

| Variable | Type | Description | CE Source |
|----------|------|-------------|-----------|
| `self_obj` | `Obj` | The scripted object | `scriptSetObjects(sid, ...)` → `script->self_obj` |
| `source_obj` | `Obj` | Who triggered the action | `scriptSetObjects` 2nd arg |
| `target_obj` | `Obj \| null` | Secondary object (rarely set) | `scriptSetObjects` 3rd arg |
| `action_being_used` | `number` | Skill ID for `use_skill_on_p_proc` | CE `actionBeingUsed` |
| `fixed_param` | `number` | Proc-specific parameter (see §1) | CE `script->fixedParam` |
| `game_time` | `number` | Current tick count | `gameGetGlobalTime()` |
| `cur_map_index` | `number` | Map index (0-based) | CE `gGameState.map` |
| `combat_is_initialized` | `0 \| 1` | Whether combat is active | `isInCombat()` |

---

## §3 VM Bytecode Opcodes (0x8000–0x804B)

Low-level bytecode handled by `ScriptVM` in `src/vm.ts` (a few that touch map variables are inline in `vm_bridge.ts`). Literal pushes: `0xC001` int, `0xA001` float, `0x9001` string / identifier.

**Floats** (CE `VALUE_TYPE_FLOAT`): `0xA001` pushes a boxed `Number`; `+ − × ÷` keep CE's typing (int op int is an int — division truncates —, anything with a float is a float, a float joins a string as `%.5f`); `floor` truncates like CE's `(int)` cast; stores keep the float; every other consumer gets a plain number. Used by Metzger's slave prices (dcmetzge), the craps tables (dccraps, zccrpdel), ecmststr and ectrappr.

A scan of all 1443 `data/scripts/*.int` (code section, decoded linearly) shows that FO2's compiled scripts use only the opcodes DH2 implements; the `—` rows below appear only in the unused header area or in scripts not in scripts.lst (barstow, dumar, surf, genint). The one interpreter_lib opcode a listed script uses, `0x806B display` (gcfestus), is implemented as CE's visible no-op.

CE source: `src/interpreter.h` (opcode enum), `src/interpreter.cc` (handlers)

| Opcode | CE name | DH2 |
|---|---|---|
| `0x8000` | NOOP | — |
| `0x8001` | PUSH | vm.ts |
| `0x8002` | ENTER_CRITICAL_SECTION | vm.ts |
| `0x8003` | LEAVE_CRITICAL_SECTION | vm.ts |
| `0x8004` | JUMP | vm.ts |
| `0x8005` | CALL | vm.ts |
| `0x8006` | CALL_AT | — |
| `0x8007` | CALL_WHEN | — |
| `0x8008` | CALLSTART | — |
| `0x8009` | EXEC | — |
| `0x800A` | SPAWN | — |
| `0x800B` | FORK | — |
| `0x800C` | A_TO_D | vm.ts |
| `0x800D` | D_TO_A | vm.ts |
| `0x800E` | EXIT | — |
| `0x800F` | DETACH | — |
| `0x8010` | EXIT_PROGRAM | vm.ts |
| `0x8011` | STOP_PROGRAM | — |
| `0x8012` | FETCH_GLOBAL | vm.ts |
| `0x8013` | STORE_GLOBAL | vm.ts |
| `0x8014` | FETCH_EXTERNAL | vm_bridge.ts (inline) |
| `0x8015` | STORE_EXTERNAL | vm_bridge.ts (inline) |
| `0x8016` | EXPORT_VARIABLE | vm_bridge.ts (inline) |
| `0x8017` | EXPORT_PROCEDURE | — |
| `0x8018` | SWAP | — |
| `0x8019` | SWAPA | vm.ts |
| `0x801A` | POP | vm.ts |
| `0x801B` | DUP | vm.ts |
| `0x801C` | POP_RETURN | vm.ts |
| `0x801D` | POP_EXIT | — |
| `0x801E` | POP_ADDRESS | — |
| `0x801F` | POP_FLAGS | — |
| `0x8020` | POP_FLAGS_RETURN | — |
| `0x8021` | POP_FLAGS_EXIT | — |
| `0x8022` | POP_FLAGS_RETURN_EXTERN | — |
| `0x8023` | POP_FLAGS_EXIT_EXTERN | — |
| `0x8024` | POP_FLAGS_RETURN_VAL_EXTERN | — |
| `0x8025` | POP_FLAGS_RETURN_VAL_EXIT | — |
| `0x8026` | POP_FLAGS_RETURN_VAL_EXIT_EXTERN | — |
| `0x8027` | CHECK_PROCEDURE_ARGUMENT_COUNT | vm.ts |
| `0x8028` | LOOKUP_PROCEDURE_BY_NAME | vm.ts |
| `0x8029` | POP_BASE | vm.ts |
| `0x802A` | POP_TO_BASE | vm.ts |
| `0x802B` | PUSH_BASE | vm.ts |
| `0x802C` | SET_GLOBAL | vm.ts |
| `0x802D` | FETCH_PROCEDURE_ADDRESS | — |
| `0x802E` | DUMP | — |
| `0x802F` | IF | vm.ts |
| `0x8030` | WHILE | vm.ts |
| `0x8031` | STORE | vm.ts |
| `0x8032` | FETCH | vm.ts |
| `0x8033` | EQUAL | vm.ts |
| `0x8034` | NOT_EQUAL | vm.ts |
| `0x8035` | LESS_THAN_EQUAL | vm.ts |
| `0x8036` | GREATER_THAN_EQUAL | vm.ts |
| `0x8037` | LESS_THAN | vm.ts |
| `0x8038` | GREATER_THAN | vm.ts |
| `0x8039` | ADD | vm.ts |
| `0x803A` | SUB | vm.ts |
| `0x803B` | MUL | vm.ts |
| `0x803C` | DIV | vm.ts |
| `0x803D` | MOD | vm.ts |
| `0x803E` | AND | vm.ts |
| `0x803F` | OR | vm.ts |
| `0x8040` | BITWISE_AND | vm.ts |
| `0x8041` | BITWISE_OR | vm.ts |
| `0x8042` | BITWISE_XOR | — |
| `0x8043` | BITWISE_NOT | — |
| `0x8044` | FLOOR | vm.ts |
| `0x8045` | NOT | vm.ts |
| `0x8046` | NEGATE | vm.ts |
| `0x8047` | WAIT | — |
| `0x8048` | CANCEL | — |
| `0x8049` | CANCEL_ALL | — |
| `0x804A` | START_CRITICAL | — |
| `0x804B` | END_CRITICAL | — |

## §4 Script Intrinsic Opcodes (0x80A0+)

The "game API" opcodes. CE registers 181 of them in `interpreter_extra.cc` (`_initIntExtra`); DH2 wires every one in `src/vm_bridge.ts` — `bridged("name", argc)` calls the `Script` method in `src/scripting.ts`, inline entries push context values. (DH2 also maps the sfall opcodes `0x826E` / `0x826F`.) Generated 2026-10-18; "no return" = the bridge pushes nothing.

| Opcode | CE handler | DH2 |
|---|---|---|
| `0x80A1` | `opGiveExpPoints` | `give_exp_points` (1, no return) |
| `0x80A2` | `opScrReturn` | `scr_return` (1, no return) |
| `0x80A3` | `opPlaySfx` | `play_sfx` (1, no return) |
| `0x80A4` | `opGetObjectName` | `obj_name` (1) |
| `0x80A5` | `opSfxBuildOpenName` | `sfx_build_open_name` (2) |
| `0x80A6` | `opGetPcStat` | `get_pc_stat` (1) |
| `0x80A7` | `opTileGetObjectWithPid` | `tile_contains_pid_obj` (3) |
| `0x80A8` | `opSetMapStart` | `set_map_start` (4, no return) |
| `0x80A9` | `opOverrideMapStart` | `override_map_start` (4, no return) |
| `0x80AA` | `opHasSkill` | `has_skill` (2) |
| `0x80AB` | `opUsingSkill` | `using_skill` (2) |
| `0x80AC` | `opRollVsSkill` | `roll_vs_skill` (3) |
| `0x80AD` | `opSkillContest` | `skill_contest` (3) |
| `0x80AE` | `opDoCheck` | `do_check` (3) |
| `0x80AF` | `opSuccess` | `is_success` (1) |
| `0x80B0` | `opCritical` | `is_critical` (1) |
| `0x80B1` | `opHowMuch` | `how_much` (1) |
| `0x80B2` | `opMarkAreaKnown` | `mark_area_known` (3, no return) |
| `0x80B3` | `opReactionInfluence` | `reaction_influence` (3) |
| `0x80B4` | `opRandom` | `random` (2) |
| `0x80B5` | `opRollDice` | inline `roll_dice` |
| `0x80B6` | `opMoveTo` | `move_to` (3) |
| `0x80B7` | `opCreateObject` | `create_object_sid` (4) |
| `0x80B8` | `opDisplayMsg` | `display_msg` (1, no return) |
| `0x80B9` | `opScriptOverrides` | `script_overrides` (0, no return) |
| `0x80BA` | `opObjectIsCarryingObjectWithPid` | `obj_is_carrying_obj_pid` (2) |
| `0x80BB` | `opTileContainsObjectWithPid` | `tile_contains_obj_pid` (3) |
| `0x80BC` | `opGetSelf` | inline `self_obj` |
| `0x80BD` | `opGetSource` | inline `source_obj` |
| `0x80BE` | `opGetTarget` | inline `target_obj` |
| `0x80BF` | `opGetDude` | inline `dude_obj` |
| `0x80C0` | `opGetObjectBeingUsed` | `obj_being_used_with` (0) |
| `0x80C1` | `opGetLocalVar` | `local_var` (1) |
| `0x80C2` | `opSetLocalVar` | `set_local_var` (2, no return) |
| `0x80C3` | `opGetMapVar` | `map_var` (1) |
| `0x80C4` | `opSetMapVar` | `set_map_var` (2, no return) |
| `0x80C5` | `opGetGlobalVar` | `global_var` (1) |
| `0x80C6` | `opSetGlobalVar` | `set_global_var` (2, no return) |
| `0x80C7` | `opGetScriptAction` | `script_action` (0) |
| `0x80C8` | `opGetObjectType` | `obj_type` (1) |
| `0x80C9` | `opGetItemType` | `obj_item_subtype` (1) |
| `0x80CA` | `opGetCritterStat` | `get_critter_stat` (2) |
| `0x80CB` | `opSetCritterStat` | `set_critter_stat` (3) |
| `0x80CC` | `opAnimateStand` | `animate_stand_obj` (1, no return) |
| `0x80CD` | `opAnimateStandReverse` | `animate_stand_reverse_obj` (1, no return) |
| `0x80CE` | `opAnimateMoveObjectToTile` | `animate_move_obj_to_tile` (3, no return) |
| `0x80CF` | `opTileInTileRect` | `tile_in_tile_rect` (5) |
| `0x80D0` | `opAttackComplex` | `attack_complex` (8, no return) |
| `0x80D1` | `opMakeDayTime` | `make_daytime` (0, no return) |
| `0x80D2` | `opTileDistanceBetween` | `tile_distance` (2) |
| `0x80D3` | `opTileDistanceBetweenObjects` | `tile_distance_objs` (2) |
| `0x80D4` | `opGetObjectTile` | `tile_num` (1) |
| `0x80D5` | `opGetTileInDirection` | `tile_num_in_direction` (3) |
| `0x80D6` | `opPickup` | `pickup_obj` (1, no return) |
| `0x80D7` | `opDrop` | `drop_obj` (1, no return) |
| `0x80D8` | `opAddObjectToInventory` | `add_obj_to_inven` (2, no return) |
| `0x80D9` | `opRemoveObjectFromInventory` | `rm_obj_from_inven` (2, no return) |
| `0x80DA` | `opWieldItem` | `wield_obj_critter` (2, no return) |
| `0x80DB` | `opUseObject` | `use_obj` (1, no return) |
| `0x80DC` | `opObjectCanSeeObject` | `obj_can_see_obj` (2) |
| `0x80DD` | `opAttackComplex` | `attack_complex` (8, no return) |
| `0x80DE` | `opStartGameDialog` | `start_gdialog` (5, no return) |
| `0x80DF` | `opEndGameDialog` | `end_dialogue` (0, no return) |
| `0x80E0` | `opGameDialogReaction` | `dialogue_reaction` (1, no return) |
| `0x80E1` | `opMetarule3` | `metarule3` (4) |
| `0x80E2` | `opSetMapMusic` | `set_map_music` (2, no return) |
| `0x80E3` | `opSetObjectVisibility` | `set_obj_visibility` (2, no return) |
| `0x80E4` | `opLoadMap` | `load_map` (2, no return) |
| `0x80E5` | `opWorldmapCitySetPos` | `wm_area_set_pos` (3, no return) |
| `0x80E6` | `opSetExitGrids` | `set_exit_grids` (5, no return) |
| `0x80E7` | `opAnimBusy` | `anim_busy` (1) |
| `0x80E8` | `opCritterHeal` | `critter_heal` (2) |
| `0x80E9` | `opSetLightLevel` | `set_light_level` (1, no return) |
| `0x80EA` | `opGetGameTime` | inline `game_time` |
| `0x80EB` | `opGetGameTimeInSeconds` | inline `game_time_in_seconds` |
| `0x80EC` | `opGetObjectElevation` | `elevation` (1) |
| `0x80ED` | `opKillCritter` | `kill_critter` (2, no return) |
| `0x80EE` | `opKillCritterType` | `kill_critter_type` (2, no return) |
| `0x80EF` | `opCritterDamage` | `critter_dmg` (3, no return) |
| `0x80F0` | `opAddTimerEvent` | `add_timer_event` (3, no return) |
| `0x80F1` | `opRemoveTimerEvent` | `rm_timer_event` (1, no return) |
| `0x80F2` | `opGameTicks` | `game_ticks` (1) |
| `0x80F3` | `opHasTrait` | `has_trait` (3) |
| `0x80F4` | `opDestroyObject` | `destroy_object` (1, no return) |
| `0x80F5` | `opObjectCanHearObject` | `obj_can_hear_obj` (2) |
| `0x80F6` | `opGameTimeHour` | inline `game_time_hour` |
| `0x80F7` | `opGetFixedParam` | inline `fixed_param` |
| `0x80F8` | `opTileIsVisible` | `tile_is_visible` (1) |
| `0x80F9` | `opGameDialogSystemEnter` | `dialogue_system_enter` (0, no return) |
| `0x80FA` | `opGetActionBeingUsed` | inline `action_being_used` |
| `0x80FB` | `opGetCritterState` | `critter_state` (1) |
| `0x80FC` | `opGameTimeAdvance` | `game_time_advance` (1, no return) |
| `0x80FD` | `opRadiationIncrease` | `radiation_inc` (2, no return) |
| `0x80FE` | `opRadiationDecrease` | `radiation_dec` (2, no return) |
| `0x80FF` | `opCritterAttemptPlacement` | `critter_attempt_placement` (3) |
| `0x8100` | `opGetObjectPid` | `obj_pid` (1) |
| `0x8101` | `opGetCurrentMap` | inline `cur_map_index` |
| `0x8102` | `opCritterAddTrait` | `critter_add_trait` (4) |
| `0x8103` | `opCritterRemoveTrait` | `critter_rm_trait` (4) |
| `0x8104` | `opGetProtoData` | `proto_data` (2) |
| `0x8105` | `opGetMessageString` | `message_str` (2) |
| `0x8106` | `opCritterGetInventoryObject` | `critter_inven_obj` (2) |
| `0x8107` | `opSetObjectLightLevel` | `obj_set_light_level` (3, no return) |
| `0x8108` | `opWorldmap` | `world_map` (0, no return) |
| `0x8109` | `_op_inven_cmds` | `inven_cmds` (3) |
| `0x810A` | `opFloatMessage` | `float_msg` (3, no return) |
| `0x810B` | `opMetarule` | `metarule` (2) |
| `0x810C` | `opAnim` | `anim` (3, no return) |
| `0x810D` | `opObjectCarryingObjectByPid` | `obj_carrying_pid_obj` (2) |
| `0x810E` | `opRegAnimFunc` | `reg_anim_func` (2, no return) |
| `0x810F` | `opRegAnimAnimate` | `reg_anim_animate` (3, no return) |
| `0x8110` | `opRegAnimAnimateReverse` | `reg_anim_animate_reverse` (3, no return) |
| `0x8111` | `opRegAnimObjectMoveToObject` | `reg_anim_obj_move_to_obj` (3, no return) |
| `0x8112` | `opRegAnimObjectRunToObject` | `reg_anim_obj_run_to_obj` (3, no return) |
| `0x8113` | `opRegAnimObjectMoveToTile` | `reg_anim_obj_move_to_tile` (3, no return) |
| `0x8114` | `opRegAnimObjectRunToTile` | `reg_anim_obj_run_to_tile` (3, no return) |
| `0x8115` | `opPlayGameMovie` | `play_gmovie` (1, no return) |
| `0x8116` | `opAddMultipleObjectsToInventory` | `add_mult_objs_to_inven` (3, no return) |
| `0x8117` | `opRemoveMultipleObjectsFromInventory` | `rm_mult_objs_from_inven` (3) |
| `0x8118` | `opGetMonth` | inline `get_month` |
| `0x8119` | `opGetDay` | inline `get_day` |
| `0x811A` | `opExplosion` | `explosion` (3, no return) |
| `0x811B` | `opGetDaysSinceLastVisit` | `days_since_visited` (0) |
| `0x811C` | `_op_gsay_start` | `gsay_start` (0, no return) |
| `0x811D` | `_op_gsay_end` | inline `gsay_end` |
| `0x811E` | `_op_gsay_reply` | `gsay_reply` (2, no return) |
| `0x811F` | `_op_gsay_option` | inline `?` |
| `0x8120` | `_op_gsay_message` | `gsay_message` (3, no return) |
| `0x8121` | `_op_giq_option` | inline `giq_option` |
| `0x8122` | `opPoison` | `poison` (2, no return) |
| `0x8123` | `opGetPoison` | `get_poison` (1) |
| `0x8124` | `opPartyAdd` | `party_add` (1, no return) |
| `0x8125` | `opPartyRemove` | `party_remove` (1, no return) |
| `0x8126` | `opRegAnimAnimateForever` | `reg_anim_animate_forever` (2, no return) |
| `0x8127` | `opCritterInjure` | `critter_injure` (2, no return) |
| `0x8128` | `opCombatIsInitialized` | inline `combat_is_initialized` |
| `0x8129` | `_op_gdialog_barter` | `gdialog_mod_barter` (1, no return) |
| `0x812A` | `opGetGameDifficulty` | `game_difficulty` (0) |
| `0x812B` | `opGetRunningBurningGuy` | `running_burning_guy` (0) |
| `0x812C` | `_op_inven_unwield` | `inven_unwield` (0, no return) |
| `0x812D` | `opObjectIsLocked` | `obj_is_locked` (1) |
| `0x812E` | `opObjectLock` | `obj_lock` (1, no return) |
| `0x812F` | `opObjectUnlock` | `obj_unlock` (1, no return) |
| `0x8131` | `opObjectOpen` | `obj_open` (1, no return) |
| `0x8130` | `opObjectIsOpen` | `obj_is_open` (1) |
| `0x8132` | `opObjectClose` | `obj_close` (1, no return) |
| `0x8133` | `opGameUiDisable` | `game_ui_disable` (0, no return) |
| `0x8134` | `opGameUiEnable` | `game_ui_enable` (0, no return) |
| `0x8135` | `opGameUiIsDisabled` | `game_ui_is_disabled` (0) |
| `0x8136` | `opGameFadeOut` | `gfade_out` (1, no return) |
| `0x8137` | `opGameFadeIn` | `gfade_in` (1, no return) |
| `0x8138` | `opItemCapsTotal` | `item_caps_total` (1) |
| `0x8139` | `opItemCapsAdjust` | `item_caps_adjust` (2) |
| `0x813A` | `_op_anim_action_frame` | `anim_action_frame` (2) |
| `0x813B` | `opRegAnimPlaySfx` | `reg_anim_play_sfx` (3, no return) |
| `0x813C` | `opCritterModifySkill` | `critter_mod_skill` (3) |
| `0x813D` | `opSfxBuildCharName` | `sfx_build_char_name` (3) |
| `0x813E` | `opSfxBuildAmbientName` | `sfx_build_ambient_name` (1) |
| `0x813F` | `opSfxBuildInterfaceName` | `sfx_build_interface_name` (1) |
| `0x8140` | `opSfxBuildItemName` | `sfx_build_item_name` (1) |
| `0x8141` | `opSfxBuildWeaponName` | `sfx_build_weapon_name` (4) |
| `0x8142` | `opSfxBuildSceneryName` | `sfx_build_scenery_name` (3) |
| `0x8143` | `opAttackSetup` | `attack_setup` (2, no return) |
| `0x8144` | `opDestroyMultipleObjects` | `destroy_mult_objs` (2) |
| `0x8145` | `opUseObjectOnObject` | `use_obj_on_obj` (2, no return) |
| `0x8146` | `opEndgameSlideshow` | `endgame_slideshow` (0, no return) |
| `0x8147` | `opMoveObjectInventoryToObject` | `move_obj_inven_to_obj` (2, no return) |
| `0x8148` | `opEndgameMovie` | `endgame_movie` (0, no return) |
| `0x8149` | `opGetObjectFid` | `obj_art_fid` (1) |
| `0x814A` | `opGetFidAnim` | `art_anim` (1) |
| `0x814B` | `opGetPartyMember` | `party_member_obj` (1) |
| `0x814C` | `opGetRotationToTile` | `rotation_to_tile` (2) |
| `0x814D` | `opJamLock` | `jam_lock` (1, no return) |
| `0x814E` | `opGameDialogSetBarterMod` | `gdialog_set_barter_mod` (1, no return) |
| `0x814F` | `opGetCombatDifficulty` | `combat_difficulty` (0) |
| `0x8150` | `opObjectOnScreen` | `obj_on_screen` (1) |
| `0x8151` | `opCritterIsFleeing` | `critter_is_fleeing` (1) |
| `0x8152` | `opCritterSetFleeState` | `critter_set_flee_state` (2, no return) |
| `0x8153` | `opTerminateCombat` | `terminate_combat` (0, no return) |
| `0x8154` | `opDebugMessage` | `debug_msg` (1, no return) |
| `0x8155` | `opCritterStopAttacking` | `critter_stop_attacking` (1, no return) |

### Variable/context accessors (INLINE in vm_bridge.ts)

These read directly from the script VM context or globalState without going through a Script method:

| Opcode | Name | Value |
|--------|------|-------|
| 0x80BF | dude_obj | globalState.player |
| 0x80BC | self_obj | this.scriptObj.self_obj |
| 0x80BD | source_obj | this.scriptObj.source_obj |
| 0x80BE | target_obj | this.scriptObj.target_obj |
| 0x80EA | game_time | this.scriptObj.game_time |
| 0x80F6 | game_time_hour | `GameTime.getHourMilitary()` (100 × hour + minute) |
| 0x8118 | get_month | GameTime.getDate().month+1 |
| 0x8119 | get_day | GameTime.getDate().day |
| 0x8101 | cur_map_index | this.scriptObj.cur_map_index |
| 0x80FA | action_being_used | this.scriptObj.action_being_used |
| 0x80F7 | fixed_param | this.scriptObj.fixed_param |
| 0x8128 | combat_is_initialized | this.scriptObj.combat_is_initialized |

---

## §5 get_pc_stat / set_pc_stat Constants

Opcode `0x80A6` (`get_pc_stat`) and `0x80CB` (`set_critter_stat`) use indices from the `PcStat` enum (`stat_defs.h:76`). These are **player-only** stats not part of the normal SPECIAL/derived stat array.

**FIXED 2026-07-05**: `get_pc_stat` (`scripting.ts:1225`) is now wired at `0x80A6` in `vm_bridge.ts` — the method existed and was CE-accurate, it had simply never been added to `bridgeOpMap`.

| Value | CE Constant | DH2 `get_pc_stat` | DH2 `set_pc_stat` |
|-------|-------------|-------------------|-------------------|
| 0 | `PC_STAT_UNSPENT_SKILL_POINTS` | returns `player.skills.skillPoints ?? 0` | sets `player.skills.skillPoints` |
| 1 | `PC_STAT_LEVEL` | returns `player.getStat('Level')` | sets `player.stats` base (clamped 1-99) |
| 2 | `PC_STAT_EXPERIENCE` | returns `player.getStat('Experience')` | sets `player.stats` base (clamped ≥0) |
| 3 | `PC_STAT_REPUTATION` | returns `player.stats.getBase('Reputation')` | sets `player.stats` base (clamped -20..20) |
| 4 | `PC_STAT_KARMA` | returns `player.stats.getBase('Karma')` | sets `player.stats` base (clamped ±99999999) |

Correction: `DH2 set_pc_stat` is fully implemented for all 5 cases (`scripting.ts:1244`), not a stub — an earlier pass of this table was stale. `mod_pc_stat` (`set_pc_stat` + delta, `scripting.ts:1269`) is likewise implemented, not stubbed.

**Neither `set_pc_stat` nor `mod_pc_stat` is wired in `vm_bridge.ts`, and that's correct** — CE has no `op_set_pc_stat`/`op_mod_pc_stat` opcode at all (verified: no hits for `opSetPcStat`/`opModPcStat`/`ModifyPcStat` anywhere in `interpreter_extra.cc` or elsewhere). `pcSetStat()` is a CE-internal C++ function used only by the character editor, perk, and skill-point-spending code paths (`character_editor.cc`, `perk.cc`, `skill.cc`, `stat.cc`) — it was never exposed to scripts. `mod_pc_stat`'s in-code comment citing `scripts.cc opModifyPcStat()` does not correspond to any real CE function; there is nothing to wire these to.

CE source: `raw/fallout2-ce/src/stat_defs.h` (`PcStat` enum)

---

## §6 metarule Sub-Operation IDs

Opcode `0x810B`, `metarule(id, value)`. DH2 (`scripting.ts metarule`) handles every case of CE `opMetarule`: 13 SIGNAL_END_GAME, 14 FIRST_RUN, 15 ELEVATOR, 16 PARTY_COUNT, 17 AREA_KNOWN, 18 WHO_ON_DRUGS, 19 MAP_KNOWN, 22 IS_LOADGAME, 30 CAR_CURRENT_TOWN, 31 GIVE_CAR_TO_PARTY, 32 GIVE_CAR_GAS, 40 SKILL_CHECK_TAG, 42 DROP_ALL_INVEN (`itemDropAll`, no scripts), 43 INVEN_UNWIELD_WHO, 44/45 GET_WORLDMAP_X/YPOS, 46 CURRENT_TOWN, 47 LANGUAGE_FILTER, 48 VIOLENCE_FILTER, 49 WEAPON_DAMAGE_TYPE, 50 CRITTER_BARTERS, 51 CRITTER_KILL_TYPE, 52/53 SET/GET_CAR_CARRY_AMOUNT. Unknown ids log a warning and return 0, as CE.

---

## §7 metarule3 Sub-Operation IDs

Opcode `0x80E1`, `metarule3(id, p1, p2, p3)`. DH2 handles every CE case: 100 CLR_FIXED_TIMED_EVENTS, 101 MARK_SUBTILE, 102 SET_WM_MUSIC (CE has no case — returns 0), 103 GET_KILL_COUNT, 104 MARK_MAP_ENTRANCE (entrance state, saved), 105 WM_SUBTILE_STATE, 106 TILE_GET_NEXT_CRITTER, 107 ART_SET_BASE_FID_NUM, 108 TILE_SET_CENTER, 109 (AI chem use), 110 (car out of gas), 111 (`_map_target_load_area`).

---

## §8 Opcode Coverage

All 181 CE intrinsics are wired (§4) and every bytecode the shipped scripts execute is implemented (§3); there are no `stub()` calls left in `src/`.

---

## §9 get_critter_stat Stat ID Mapping

Opcode `0x80CA` covers all 38 stat ids — see `critter_stats.md` §2 for the table.
