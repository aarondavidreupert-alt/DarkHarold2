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

<!-- audited: 2026-06-02 -->

---

## §1 Script Procedure Hooks (SCRIPT_PROC_*)

CE fires a named procedure in the script program for each event. Procedures are located by name at load time (`scriptLocateProcs`, `scripts.cc:1350`). Missing = not defined in the .int → CE skips gracefully.

Status key: `WIRED` = DH2 fires this proc; `PARTIAL` = wired but context vars incomplete; `MISSING` = CE fires it but DH2 does not.

| # | CE Constant | Proc Name | Triggered By | DH2 Firing Function | Variables Set | DH2 Status |
|---|-------------|-----------|--------------|---------------------|---------------|------------|
| 0 | `SCRIPT_PROC_NO_PROC` | `no_p_proc` | Never (sentinel) | — | — | N/A |
| 1 | `SCRIPT_PROC_START` | `start` | Script init (`scriptsExecStartProc`) | `Scripting.initScript()` | self_obj, cur_map_index | WIRED |
| 2 | `SCRIPT_PROC_SPATIAL` | `spatial_p_proc` | Critter enters radius | `Scripting.spatial()` | self_obj, source_obj, game_time, cur_map_index | WIRED |
| 3 | `SCRIPT_PROC_DESCRIPTION` | `description_p_proc` | Player examines object | Not called | — | MISSING |
| 4 | `SCRIPT_PROC_PICKUP` | `pickup_p_proc` | Item picked up or equipped | `Scripting.pickup()` | self_obj, source_obj, cur_map_index | WIRED |
| 5 | `SCRIPT_PROC_DROP` | `drop_p_proc` | Item dropped | `Scripting.drop()` | self_obj, source_obj, cur_map_index | WIRED |
| 6 | `SCRIPT_PROC_USE` | `use_p_proc` | Object used | `Scripting.use()` | self_obj, source_obj, cur_map_index | WIRED |
| 7 | `SCRIPT_PROC_USE_OBJ_ON` | `use_obj_on_p_proc` | Item used on this object | `Scripting.useObjOnMe()` | self_obj, source_obj, fixed_param (item), cur_map_index | PARTIAL (declared `use_obj_on_me_p_proc`; name mismatch vs CE `use_obj_on_p_proc`) |
| 8 | `SCRIPT_PROC_USE_SKILL_ON` | `use_skill_on_p_proc` | Skill used on object | `Scripting.useSkillOn()` | self_obj, source_obj, action_being_used, cur_map_index | WIRED |
| 9 | `SCRIPT_PROC_9` | `none_x_bad` | Unused (use_ad_on_proc) | — | — | N/A |
| 10 | `SCRIPT_PROC_10` | `none_x_bad` | Unused (use_disad_on_proc) | — | — | N/A |
| 11 | `SCRIPT_PROC_TALK` | `talk_p_proc` | Player initiates dialogue | `Scripting.talk()` | self_obj, source_obj (player), cur_map_index | WIRED |
| 12 | `SCRIPT_PROC_CRITTER` | `critter_p_proc` | Each combat turn / heartbeat tick | `Scripting.updateCritter()` | self_obj, source_obj (self), game_time, cur_map_index | WIRED |
| 13 | `SCRIPT_PROC_COMBAT` | `combat_p_proc` | Combat action taken against critter | `Scripting.combatEvent(obj, 'turnBegin')` | self_obj, source_obj (attacker), cur_map_index | PARTIAL — only 'turnBegin' fires; CE fires on every attack action |
| 14 | `SCRIPT_PROC_DAMAGE` | `damage_p_proc` | Object takes damage from explosion | `Scripting.damage()` | self_obj, source_obj (attacker), fixed_param (damage), target_obj (explosion src) | WIRED |
| 15 | `SCRIPT_PROC_MAP_ENTER` | `map_enter_p_proc` | Map loaded / elevation changed | `Scripting.objectEnterMap()` | self_obj, cur_map_index, game_time | WIRED (also fires on spatials — see spatial_triggers.md §7 gap 9) |
| 16 | `SCRIPT_PROC_MAP_EXIT` | `map_exit_p_proc` | Map unloaded | Not declared on Script | — | MISSING — no DH2 firing path |
| 17 | `SCRIPT_PROC_CREATE` | `create_p_proc` | Object created via `create_object_sid` | Not declared on Script | — | MISSING |
| 18 | `SCRIPT_PROC_DESTROY` | `destroy_p_proc` | Object destroyed | `Scripting.destroy()` | self_obj, source_obj (destroyer), cur_map_index | WIRED |
| 19 | `SCRIPT_PROC_19` | `none_x_bad` | Unused (barter_init_proc) | — | — | N/A |
| 20 | `SCRIPT_PROC_20` | `none_x_bad` | Unused (barter_proc) | — | — | N/A |
| 21 | `SCRIPT_PROC_LOOK_AT` | `look_at_p_proc` | Player looks at object | Not declared on Script | — | MISSING |
| 22 | `SCRIPT_PROC_TIMED` | `timed_event_p_proc` | `add_timer_event` fires | `Scripting.timedEvent()` | self_obj, fixed_param (userdata), game_time, cur_map_index | WIRED |
| 23 | `SCRIPT_PROC_MAP_UPDATE` | `map_update_p_proc` | Every game tick (10 Hz) | `Scripting.updateMap()` | self_obj, game_time, cur_map_index | WIRED |
| 24 | `SCRIPT_PROC_PUSH` | `push_p_proc` | Object pushed by critter | Not declared on Script | — | MISSING |
| 25 | `SCRIPT_PROC_IS_DROPPING` | `is_dropping_p_proc` | Item about to be dropped via UI | Not declared on Script | — | MISSING |
| 26 | `SCRIPT_PROC_COMBAT_IS_STARTING` | `combat_is_starting_p_proc` | Combat begins | Not declared on Script | — | MISSING |
| 27 | `SCRIPT_PROC_COMBAT_IS_OVER` | `combat_is_over_p_proc` | Combat ends | Not declared on Script | — | MISSING |

### Notes

- CE fires `SCRIPT_PROC_CRITTER` (12) for every critter on every tick **if** combat is not active; in combat it fires `SCRIPT_PROC_COMBAT` (13). DH2's `Scripting.updateCritter` fires `critter_p_proc` (tick-rate) for all objects; `combatEvent('turnBegin')` fires `combat_p_proc` at turn start only.
- CE fires `SCRIPT_PROC_PICKUP` from both tile pickup AND equipping via the inventory screen (`inventory.cc:4102` and `4494`). DH2 only fires it from tile pickup.
- The DH2 declaration uses `use_obj_on_me_p_proc` (CE name `use_obj_on_p_proc`) — both names exist in scripts that reference this proc; CE scripts use `use_obj_on_p_proc`.

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

These are low-level bytecode operations handled by ScriptVM in `src/vm.ts`.

For the **DH2 Status** column:
- `WIRED` = bridged in vm_bridge.ts and method exists in scripting.ts
- `PARTIAL` = wired but method calls stub() for some inputs
- `STUB` = wired but method always calls stub() / returns default
- `INLINE` = wired with a custom inline function in vm_bridge.ts (not bridged())
- `UNWIRED` = not in vm_bridge.ts at all

CE source: `src/interpreter.h` (opcode enum), `src/interpreter.cc` (handlers)

| Opcode | Name | Description | DH2 vm.ts |
|--------|------|-------------|-----------|
| 0x8000 | NOOP | No-op | WIRED |
| 0x8001 | PUSH_D | Push 32-bit literal onto data stack | WIRED (0xC001 variant) |
| 0x8002 | ENTER_CRITICAL | Begin critical section (nop in CE) | WIRED (nop) |
| 0x8003 | LEAVE_CRITICAL | End critical section (nop in CE) | WIRED (nop) |
| 0x8004 | JUMP | Unconditional jump to popped address | WIRED |
| 0x8005 | CALL | Call procedure | WIRED |
| 0x8006 | CALL_AT | Delayed call | WIRED |
| 0x8007 | CALL_WHEN | Conditional call | partial |
| 0x8008 | CALLSTART | Call start procedure | WIRED |
| 0x8009 | EXEC | Execute program | partial |
| 0x800A | SPAWN | Spawn new program | UNWIRED |
| 0x800B | FORK | Fork program | UNWIRED |
| 0x800C | A_TO_D | Address register → data stack | WIRED |
| 0x800D | D_TO_A | Data stack → address register | WIRED |
| 0x800E | EXIT | Exit program | WIRED |
| 0x800F | DETACH | Detach program | UNWIRED |
| 0x8010 | EXIT_PROGRAM | Exit program (alt) | WIRED |
| 0x8011 | STOP_PROGRAM | Stop program | WIRED |
| 0x8012 | FETCH_GLOBAL | Fetch global var | WIRED |
| 0x8013 | STORE_GLOBAL | Store global var | WIRED |
| 0x8014 | FETCH_EXTERNAL | Fetch exported variable | INLINE (vm_bridge.ts) |
| 0x8015 | STORE_EXTERNAL | Store exported variable | INLINE |
| 0x8016 | EXPORT_VARIABLE | Export variable | INLINE |
| 0x8017 | EXPORT_PROCEDURE | Export procedure | WIRED |
| 0x8018 | SWAP | Swap top two data stack items | WIRED |
| 0x8019 | SWAPA | Swap top two address stack items | WIRED |
| 0x801A | POP | Pop and discard | WIRED |
| 0x801B | DUP | Duplicate top of stack | WIRED |
| 0x801C | POP_RETURN | Pop and return | WIRED |
| 0x801D | POP_EXIT | Pop and exit | WIRED |
| 0x801E | POP_ADDRESS | Pop address | WIRED |
| 0x801F | POP_FLAGS | Pop flags | WIRED |
| 0x8020 | POP_FLAGS_RETURN | Pop flags, return | WIRED |
| 0x8021 | POP_FLAGS_EXIT | Pop flags, exit | WIRED |
| 0x8022 | POP_FLAGS_RETURN_EXTERN | Pop flags, return extern | WIRED |
| 0x8023 | POP_FLAGS_EXIT_EXTERN | Pop flags, exit extern | WIRED |
| 0x8024 | POP_FLAGS_RETURN_VAL_EXTERN | Pop flags, return val extern | WIRED |
| 0x8025 | POP_FLAGS_RETURN_VAL_EXIT | Pop flags, return val exit | WIRED |
| 0x8026 | POP_FLAGS_RETURN_VAL_EXIT_EXTERN | Pop flags, return val exit extern | WIRED |
| 0x8027 | CHECK_PROCEDURE_ARGUMENT_COUNT | Check argc | WIRED |
| 0x8028 | LOOKUP_PROCEDURE_BY_NAME | Look up procedure | WIRED |
| 0x8029 | POP_BASE | Pop base pointer | WIRED |
| 0x802A | POP_TO_BASE | Pop to base | WIRED |
| 0x802B | PUSH_BASE | Push base pointer (with argc) | WIRED |
| 0x802C | SET_GLOBAL | Set global var | WIRED |
| 0x802D | FETCH_PROCEDURE_ADDRESS | Fetch proc address | WIRED |
| 0x802E | DUMP | Dump (debug) | nop |
| 0x802F | IF | Conditional branch | WIRED |
| 0x8030 | WHILE | While loop | WIRED |
| 0x8031 | STORE | Store to var | WIRED |
| 0x8032 | FETCH | Fetch from var | WIRED |
| 0x8033 | EQUAL | == | WIRED |
| 0x8034 | NOT_EQUAL | != | WIRED |
| 0x8035 | LESS_THAN_EQUAL | <= | WIRED |
| 0x8036 | GREATER_THAN_EQUAL | >= | WIRED |
| 0x8037 | LESS_THAN | < | WIRED |
| 0x8038 | GREATER_THAN | > | WIRED |
| 0x8039 | ADD | + | WIRED |
| 0x803A | SUB | - | WIRED |
| 0x803B | MUL | * | WIRED |
| 0x803C | DIV | / (integer) | WIRED |
| 0x803D | MOD | % | WIRED |
| 0x803E | AND | logical and | WIRED |
| 0x803F | OR | logical or | WIRED |
| 0x8040 | BITWISE_AND | & | WIRED |
| 0x8041 | BITWISE_OR | \| | WIRED |
| 0x8042 | BITWISE_XOR | ^ | WIRED |
| 0x8043 | BITWISE_NOT | ~ | WIRED |
| 0x8044 | FLOOR | floor() | WIRED |
| 0x8045 | NOT | logical not | WIRED |
| 0x8046 | NEGATE | unary minus | WIRED |
| 0x8047 | WAIT | Wait ticks | WIRED |
| 0x8048 | CANCEL | Cancel wait | WIRED |
| 0x8049 | CANCEL_ALL | Cancel all waits | WIRED |
| 0x804A | START_CRITICAL | Start critical | nop |
| 0x804B | END_CRITICAL | End critical | nop |

---

## §4 Script Intrinsic Opcodes (0x80A0+)

These are the "game API" opcodes — calls from scripts to engine functions. In fallout2-ce they are registered in `src/scripts.cc::interpreterRegisterOpcodeHandlers()`. In DarkHarold2 they are wired in `src/vm_bridge.ts` and implemented in `src/scripting.ts`.

CE source: `src/scripts.cc` (registration), `src/interpreter_extra.cc` (implementations)

For the **Status** column, see the key in §3.

| Hex | Name | Args | Returns | Status | Notes |
|-----|------|------|---------|--------|-------|
| 0x80A1 | give_exp_points | 1 (xp) | void | WIRED | Awards XP to player; triggers level-up |
| 0x80A3 | play_sfx | 1 (sfx_name) | void | WIRED | Plays sound effect |
| 0x80A4 | obj_name | 1 (obj) | str | WIRED | Returns object name string |
| 0x80A7 | tile_contains_pid_obj | 3 (tile,elev,pid) | obj | WIRED | First obj with pid at tile |
| 0x80A8 | game_time_hour | 0 | int | INLINE | Current hour 0-23 |
| 0x80A9 | override_map_start | 4 (tile,elev,rot,flags) | void | WIRED | Override player start position |
| 0x80AA | has_skill | 2 (obj,skill) | int | WIRED | Returns effective skill value |
| 0x80AB | using_skill | 2 (obj,skill) | int | STUB | Always returns 0; CE: isUsingSkill() |
| 0x80AC | roll_vs_skill | 3 (obj,skill,bonus) | roll | WIRED | Skill roll; returns RollResult enum |
| 0x80AE | do_check | 3 (obj,check,mod) | int | STUB | Always returns 1 (success) |
| 0x80AF | is_success | 1 (roll) | bool | WIRED | Roll result is success or crit-success |
| 0x80B0 | is_critical | 1 (roll) | bool | WIRED | Roll result is crit-success or crit-fail |
| 0x80B2 | mark_area_known | 3 (type,id,state) | void | WIRED | Mark worldmap area known |
| 0x80B4 | random | 2 (min,max) | int | WIRED | Random int in range |
| 0x80B6 | move_to | 3 (obj,tile,elev) | int | WIRED | Teleport object to tile |
| 0x80B7 | create_object_sid | 4 (pid,tile,elev,sid) | obj | WIRED | Create object with script |
| 0x80B8 | display_msg | 1 (msg) | void | WIRED | Show message in HUD log |
| 0x80B9 | script_overrides | 0 | void | WIRED | Set script override flag |
| 0x80BA | obj_is_carrying_obj_pid | 2 (obj,pid) | bool | WIRED | Check if carrying pid |
| 0x80BB | tile_contains_obj_pid | 3 (tile,elev,pid) | obj | WIRED | First obj of pid at tile |
| 0x80BC | self_obj | 0 | obj | INLINE | Returns self object |
| 0x80BD | source_obj | 0 | obj | INLINE | Returns source object |
| 0x80BE | target_obj | 0 | obj | INLINE | Returns target object |
| 0x80BF | dude_obj | 0 | obj | INLINE | Returns player object |
| 0x80CA | get_critter_stat | 2 (obj,stat) | int | PARTIAL | Handles 9 stat IDs; stub for rest (see §9 and CODEBASE.md) |
| 0x80CC | animate_stand_obj | 1 (obj) | void | WIRED | Snap to idle animation |
| 0x80CE | animate_move_obj_to_tile | 3 (obj,tile,isRun) | void | WIRED | Animate critter moving to tile |
| 0x80CF | tile_in_tile_rect | 5 (ul,ur,ll,lr,tile) | bool | WIRED | Tile in rectangle test |
| 0x80D0 | attack_complex | 8 (args) | void | WIRED | Script-initiated attack; see [damage_formula.md](damage_formula.md) |
| 0x80D2 | tile_distance | 2 (tile1,tile2) | int | WIRED | Hex distance between tiles |
| 0x80D3 | tile_distance_objs | 2 (obj1,obj2) | int | WIRED | Hex distance between objects |
| 0x80D4 | tile_num | 1 (obj) | int | WIRED | Object's tile number |
| 0x80D5 | tile_num_in_direction | 3 (tile,dir,dist) | int | WIRED | Tile N steps in direction |
| 0x80D8 | add_obj_to_inven | 2 (critter,obj) | void | WIRED | Add object to inventory |
| 0x80DA | wield_obj_critter | 2 (critter,obj) | void | WIRED | Equip item |
| 0x80DC | obj_can_see_obj | 2 (obj1,obj2) | bool | WIRED | LOS check |
| 0x80DE | start_gdialog | 5 (head,msg,barter,unk,unk) | void | WIRED | Open dialogue |
| 0x80DF | end_dialogue | 0 | void | WIRED | Close dialogue |
| 0x80E1 | metarule3 | 4 (id,obj,userdata,radius) | any | PARTIAL | Sub-ops 100, 106 handled; rest stub (see §7) |
| 0x80E3 | set_obj_visibility | 2 (obj,visible) | void | WIRED | Show/hide object |
| 0x80E4 | load_map | 2 (mapName,startTile) | void | WIRED | Load a new map |
| 0x80E5 | wm_area_set_pos | 3 (area,x,y) | void | WIRED | Set worldmap area position |
| 0x80E7 | anim_busy | 1 (obj) | bool | WIRED | Is object animating? |
| 0x80E8 | critter_heal | 2 (obj,amount) | void | WIRED | Heal critter HP |
| 0x80E9 | set_light_level | 1 (level) | void | WIRED | Set ambient light level |
| 0x80EA | game_time | 0 | int | INLINE | Current game tick counter |
| 0x80EC | elevation | 1 (obj) | int | WIRED | Object's elevation |
| 0x80ED | kill_critter | 2 (obj,anim) | void | WIRED | Kill critter |
| 0x80EF | critter_dmg | 3 (obj,dmg,type) | void | WIRED | Deal damage to critter |
| 0x80F0 | add_timer_event | 3 (obj,ticks,data) | void | WIRED | Schedule timed callback |
| 0x80F1 | rm_timer_event | 1 (obj) | void | WIRED | Remove timer events for obj |
| 0x80F2 | game_ticks | 1 (seconds) | int | WIRED | Convert seconds to ticks |
| 0x80F3 | has_trait | 3 (traitType,obj,trait) | int | PARTIAL | TRAIT_OBJECT cases 5/6/10/666/669 handled; rest stub |
| 0x80F4 | destroy_object | 1 (obj) | void | WIRED | Remove object from map |
| 0x80F5 | obj_can_hear_obj | 2 (obj1,obj2) | bool | WIRED | Hearing check |
| 0x80F6 | game_time_hour | 0 | int | INLINE | Current hour (alt opcode) |
| 0x80F7 | fixed_param | 0 | int | INLINE | Script fixed_param value |
| 0x80F8 | tile_is_visible | 1 (tile) | bool | WIRED | Is tile on screen? |
| 0x80F9 | dialogue_system_enter | 0 | void | WIRED | Enter dialogue mode |
| 0x80FA | action_being_used | 0 | int | INLINE | Current action ID |
| 0x80FB | critter_state | 1 (obj) | int | WIRED | Critter state flags |
| 0x80FC | game_time_advance | 1 (ticks) | void | WIRED | Advance game time |
| 0x80FF | critter_attempt_placement | 3 (obj,tile,elev) | int | WIRED | Place critter, try neighbors if blocked |
| 0x8100 | obj_pid | 1 (obj) | int | WIRED | Object's PID |
| 0x8101 | cur_map_index | 0 | int | INLINE | Current map index |
| 0x8102 | critter_add_trait | 4 (obj,type,trait,amount) | void | PARTIAL | TRAIT_OBJECT cases 5,6 write; rest no-op after stub log |
| 0x8105 | message_str | 2 (msgFile,msgID) | str | WIRED | Lookup message string |
| 0x8106 | critter_inven_obj | 2 (critter,where) | obj | WIRED | Get equipped item (0=armor, 1=right, 2=left) |
| 0x8109 | inven_cmds | 3 (critter,cmd,idx) | obj | STUB | Only INVEN_CMD_INDEX_PTR (13) asserted; returns null |
| 0x810A | float_msg | 3 (obj,msg,type) | void | WIRED | Show floating text above object |
| 0x810B | metarule | 2 (id,target) | any | PARTIAL | Sub-ops 14/15/17/18/22/46/48/49 handled; rest stub (see §6) |
| 0x810C | anim | 3 (obj,anim,param) | void | PARTIAL | IDs 1000 (set rotation) and 1010 (set frame) handled; rest stub |
| 0x810D | obj_carrying_pid_obj | 2 (obj,pid) | obj | WIRED | Find carried item by pid |
| 0x810E | reg_anim_func | 2 (obj,fn) | void | INLINE | Queue callback in animation batch |
| 0x810F | reg_anim_animate | 3 (obj,anim,delay) | void | WIRED | Queue animation step with delay |
| 0x8110 | reg_anim_obj_move_to_tile | 3 (obj,tile,delay) | void | WIRED | Queue move animation |
| 0x8111 | reg_anim_begin | 1 (flags) | void | WIRED | Start animation batch |
| 0x8112 | reg_anim_end | 0 | void | WIRED | Execute animation batch with delays |
| 0x8113 | reg_anim_clear | 0 | void | WIRED | Clear pending animation batch |
| 0x8115 | play_gmovie | 1 (movieID) | void | WIRED | Play .MVE movie (logs skip — not implemented) |
| 0x8116 | add_mult_objs_to_inven | 3 (critter,obj,count) | void | WIRED | Add N copies to inventory |
| 0x8117 | rm_mult_objs_from_inven | 3 (critter,obj,count) | int | WIRED | Remove N copies from inventory |
| 0x8118 | get_month | 0 | int | INLINE | Current month 1-12 (from GameTime) |
| 0x8119 | get_day | 0 | int | INLINE | Current day of month (from GameTime) |
| 0x811A | explosion | 3 (tile,elev,dmg) | int | WIRED | Create explosion at tile |
| 0x811C | gsay_start | 0 | int | WIRED | Begin dialogue option collection |
| 0x811D | gsay_end | 0 | void | INLINE | Halt VM to wait for player choice |
| 0x811E | gsay_reply | 2 (msgFile,msgID) | void | WIRED | Set NPC reply text |
| 0x8120 | gsay_message | 3 (msgFile,msgID,unk) | void | WIRED | Display gsay message (Done button) |
| 0x8121 | giq_option | 5 (iq,msgFile,msgID,target,reaction) | void | INLINE | Add IQ-gated dialogue option |
| 0x8123 | get_poison | 1 (obj) | int | WIRED | Get object poison level |
| 0x8124 | party_add | 1 (critter) | void | WIRED | Add to party (respects maxSize cap) |
| 0x8125 | party_remove | 1 (critter) | void | WIRED | Remove from party |
| 0x8126 | reg_anim_animate_forever | 2 (obj,anim) | void | WIRED | Loop animation forever |
| 0x8127 | critter_injure | 2 (obj,flags) | void | WIRED | Apply injury flags (crippled limbs etc.) |
| 0x8128 | combat_is_initialized | 0 | bool | INLINE | Is combat active? |
| 0x8129 | gdialog_mod_barter | 1 (mod) | void | WIRED | Modify barter difficulty |
| 0x812D | obj_is_locked | 1 (obj) | bool | WIRED | Is object locked? |
| 0x812E | obj_lock | 1 (obj) | void | WIRED | Lock object |
| 0x812F | obj_unlock | 1 (obj) | void | WIRED | Unlock object |
| 0x8130 | obj_is_open | 1 (obj) | bool | WIRED | Is object open? |
| 0x8131 | obj_open | 1 (obj) | void | WIRED | Open object (door/container) |
| 0x8132 | obj_close | 1 (obj) | void | WIRED | Close object |
| 0x8133 | game_ui_disable | 0 | void | WIRED | Disable UI input |
| 0x8134 | game_ui_enable | 0 | void | WIRED | Enable UI input |
| 0x8136 | gfade_out | 1 (time) | void | WIRED | Fade screen to black |
| 0x8137 | gfade_in | 1 (time) | void | WIRED | Fade screen in |
| 0x8138 | item_caps_total | 1 (obj) | int | WIRED | Get caps (money) amount |
| 0x8139 | item_caps_adjust | 2 (obj,amount) | void | WIRED | Add/remove caps |
| 0x813C | critter_mod_skill | 3 (obj,skill,amount) | int | WIRED | Modify critter skill |
| 0x8145 | use_obj_on_obj | 2 (item,target) | void | WIRED | Use item on object |
| 0x8147 | move_obj_inven_to_obj | 2 (src,dst) | void | WIRED | Move entire inventory |
| 0x8149 | obj_art_fid | 1 (obj) | int | WIRED | Get object FRM FID |
| 0x814A | art_anim | 1 (fid) | int | WIRED | Extract anim field from FID |
| 0x814B | party_member_obj | 1 (pid) | obj | WIRED | Get party member by PID |
| 0x814C | rotation_to_tile | 2 (src,dst) | int | WIRED | Direction from src to dst tile |
| 0x814E | gdialog_set_barter_mod | 1 (mod) | void | WIRED | Set barter modifier |
| 0x8150 | obj_on_screen | 1 (obj) | bool | WIRED | Is object visible on screen? |
| 0x8151 | critter_is_fleeing | 1 (obj) | bool | WIRED | Is critter in flee state? |
| 0x8152 | critter_set_flee_state | 2 (obj,state) | void | WIRED | Set flee state |
| 0x8153 | terminate_combat | 0 | void | WIRED | End combat |
| 0x8154 | debug_msg | 1 (msg) | void | WIRED | Debug print (no-op in release) |

### Variable/context accessors (INLINE in vm_bridge.ts)

These read directly from the script VM context or globalState without going through a Script method:

| Opcode | Name | Value |
|--------|------|-------|
| 0x80BF | dude_obj | globalState.player |
| 0x80BC | self_obj | this.scriptObj.self_obj |
| 0x80BD | source_obj | this.scriptObj.source_obj |
| 0x80BE | target_obj | this.scriptObj.target_obj |
| 0x80EA | game_time | this.scriptObj.game_time |
| 0x80F6/0x80A8 | game_time_hour | gameTickTime/600 % 24 |
| 0x8118 | get_month | GameTime.getDate().month+1 |
| 0x8119 | get_day | GameTime.getDate().day |
| 0x8101 | cur_map_index | this.scriptObj.cur_map_index |
| 0x80FA | action_being_used | this.scriptObj.action_being_used |
| 0x80F7 | fixed_param | this.scriptObj.fixed_param |
| 0x8128 | combat_is_initialized | this.scriptObj.combat_is_initialized |

---

## §5 get_pc_stat / set_pc_stat Constants

Opcode `0x80A6` (`get_pc_stat`) and `0x80CB` (`set_critter_stat`) use indices from the `PcStat` enum (`stat_defs.h:76`). These are **player-only** stats not part of the normal SPECIAL/derived stat array.

DH2 implements `get_pc_stat` (in `scripting.ts:892`) but **0x80A6 is not wired** in `vm_bridge.ts` — scripts calling it will trigger an unhandled opcode.

| Value | CE Constant | DH2 `get_pc_stat` | DH2 `set_pc_stat` |
|-------|-------------|-------------------|-------------------|
| 0 | `PC_STAT_UNSPENT_SKILL_POINTS` | returns `player.unspentSkillPoints ?? 0` | STUB |
| 1 | `PC_STAT_LEVEL` | returns `player.level` | STUB |
| 2 | `PC_STAT_EXPERIENCE` | returns `player.experience` | STUB |
| 3 | `PC_STAT_REPUTATION` | returns `player.reputation ?? 0` | STUB |
| 4 | `PC_STAT_KARMA` | returns `player.karma ?? 0` | STUB |

`mod_pc_stat` (`set_pc_stat` + delta) is in `scripting.ts:927` but also unwired.

CE source: `raw/fallout2-ce/src/stat_defs.h` (`PcStat` enum)

---

## §6 metarule Sub-Operation IDs

Opcode `0x810B`. Signature: `metarule(id, target)`.

CE source: `raw/fallout2-ce/src/interpreter_extra.cc:opMetarule`

| ID | CE Name | DH2 Status | Returns |
|----|---------|------------|---------|
| 14 | `METARULE_SIGNAL_END_GAME` / map first run | WIRED | `mapFirstRun` boolean |
| 15 | Elevator call | WIRED | calls `useElevator()` |
| 17 | Is area known? | WIRED | `globalState.knownAreas.has(target) ? 1 : 0` |
| 18 | Is critter under drug effect? | WIRED | scans `timeEventList` for drug events |
| 22 | `METARULE_GAME_LOADING` | WIRED | always returns `0` |
| 46 | `METARULE_CURRENT_TOWN` | WIRED | area ID for current map, or 0 |
| 48 | `METARULE_VIOLENCE_FILTER` | WIRED | always returns `2` (VLNCLVL_NORMAL) |
| 49 | `METARULE_W_DAMAGE_TYPE` | WIRED | damage type index for `target` object (0–6) |
| all others | — | STUB | logs + returns undefined |

---

## §7 metarule3 Sub-Operation IDs

Opcode `0x80E1`. Signature: `metarule3(id, obj, userdata, radius)`.

CE source: `raw/fallout2-ce/src/interpreter_extra.cc`

| ID | CE Name | DH2 Status | Description |
|----|---------|------------|-------------|
| 100 | `METARULE3_CLR_FIXED_TIMED_EVENTS` | WIRED | Removes timer event by (obj, userdata) pair |
| 106 | `METARULE3_TILE_GET_NEXT_CRITTER` | WIRED (partial) | First non-player critter at tile; elevation not respected |
| all others | — | STUB | logs + returns undefined |

---

## §8 Unwired CE Opcodes (UNWIRED in DH2)

These opcodes exist in CE (`interpreter_extra.cc`) but have no entry in DH2's `vm_bridge.ts`. Scripts that call them hit the unhandled opcode path (silent no-op in the default dispatch; no error thrown).

| Opcode | CE Name | CE Description |
|--------|---------|----------------|
| 0x80A2 | `scr_return` | Return value from a scripted function call |
| 0x80A5 | `sfx_build_open_name` | Build SFX filename for open action |
| 0x80A6 | `get_pc_stat` | Read player-only stat (see §5) — method exists in scripting.ts but not wired |
| 0x80AD | `skill_contest` | Two-critter skill contest |
| 0x80B1 | `how_much` | Count of a specific item type on tile |
| 0x80B3 | `reaction_influence` | Adjust NPC reaction |
| 0x80B5 | `roll_dice` | Multi-dice roll (Nd6 etc.) |
| 0x80C0 | `obj_being_used_with` | Object currently being used with self |
| 0x80C7 | `script_action` | Current script action |
| 0x80CB | `set_critter_stat` | Set critter stat (see §5) |
| 0x80CD | `animate_stand_reverse_obj` | Stand-reverse animation |
| 0x80D1 | `make_daytime` | Advance time to next daytime |
| 0x80D6 | `pickup_obj` | Pick up object (script-driven) |
| 0x80D7 | `drop_obj` | Drop object (script-driven) |
| 0x80D9 | `rm_obj_from_inven` | Remove single item from inventory — method exists (`rm_obj_from_inven` delegates to `rm_mult_objs_from_inven`) but not wired at 0x80D9 |
| 0x80DB | `use_obj` | Use object |
| 0x80DD | `attack` | CE `attack` opcode (maps to same handler as attack_complex) |
| 0x80E0 | `dialogue_reaction` | Set/get NPC dialogue reaction |
| 0x80E2 | `set_map_music` | Change ambient map music |
| 0x80E6 | `set_exit_grids` | Configure map exit grids |
| 0x80EB | `get_game_time_in_seconds` | Game time in seconds (ticks / 10) |
| 0x80EE | `kill_critter_type` | Kill all critters of a given type |
| 0x8103 | `critter_rm_trait` | Remove trait from critter |
| 0x8104 | `proto_data` | Read PRO field by data_member ID — method exists in scripting.ts at `proto_data()` but not wired |
| 0x8107 | `obj_set_light_level` | Set per-object light level/radius — method exists at `obj_set_light_level()` |
| 0x8108 | `scripts_request_world_map` | Transition to world map |
| 0x8114 | `reg_anim_obj_run_to_tile` | Queue run-to-tile animation |
| 0x811B | `days_since_visited` | Days since last map visit |
| 0x8122 | `poison` | Apply poison to critter |
| 0x812A | `get_game_difficulty` | Read game difficulty setting |
| 0x813A | `anim_action_frame` | Anim action-frame callback |
| 0x813B | `reg_anim_play_sfx` | Play SFX at animation frame |
| 0x813D | `sfx_build_char_name` | Build character SFX name |
| 0x813E | `sfx_build_ambient_name` | Build ambient SFX name |
| 0x813F | `sfx_build_interface_name` | Build interface SFX name |
| 0x8140 | `sfx_build_item_name` | Build item SFX name |
| 0x8141 | `sfx_build_weapon_name` | Build weapon SFX name |
| 0x8142 | `sfx_build_scenery_name` | Build scenery SFX name |
| 0x8143 | `attack_setup` | Set up attack parameters |
| 0x8144 | `destroy_mult_objs` | Destroy multiple objects of PID |
| 0x814D | `jam_lock` | Permanently jam a lock |
| 0x814F | `combat_difficulty` | Read combat difficulty setting |
| 0x8155 | `critter_stop_attacking` | Force critter to stop attacking |

### Most-Called Unwired Opcodes (high script frequency)

Scripts that use these will silently malfunction. Priority for future wiring:

- **`0x80A6` `get_pc_stat`** — commonly called to read player level, XP, reputation; method already exists, just needs `bridged("get_pc_stat", 1)` added to vm_bridge.ts at 0x80A6
- **`0x8104` `proto_data`** — item/weapon stat queries in AI and shop scripts; method exists
- **`0x80CB` `set_critter_stat`** — used by scripts that modify NPC stats; method exists as `set_pc_stat` (STUB for most fields)
- **`0x80D9` `rm_obj_from_inven`** — single-item inventory removal; method exists as `rm_obj_from_inven`
- **`0x8107` `obj_set_light_level`** — light-emitting objects (lamps, fires); method exists
- **`0x8122` `poison`** — apply poison; no DH2 method exists
- **`0x812A` `get_game_difficulty`** — difficulty checks in AI scripts; no DH2 method

---

## §9 get_critter_stat Stat ID Mapping

Opcode `0x80CA`. CE registers stat IDs in `stat_defs.h`. DH2 `scripting.ts:570` handles a partial set:

CE source: `raw/fallout2-ce/src/stat_defs.h`

| stat ID | CE STAT_* | DH2 Status | Notes |
|---------|-----------|------------|-------|
| 0–6 | STAT_ST / PE / EN / CH / IN / AG / LK | WIRED | Read from `obj.getStat(statName)` |
| 7 | STAT_MAX_HIT_POINTS | WIRED | |
| 8 | STAT_MAX_ACTION_POINTS | WIRED | |
| 9 | STAT_ARMOR_CLASS | WIRED | |
| 10 | STAT_UNARMED_DMG | WIRED | |
| 11 | STAT_MELEE_DMG | WIRED | |
| 12 | STAT_CARRY_WEIGHT | WIRED | |
| 13 | STAT_SEQUENCE | WIRED | |
| 14 | STAT_HEALING_RATE | WIRED | |
| 15 | STAT_CRITICAL_CHANCE | WIRED | |
| 16 | STAT_BETTER_CRITICALS | WIRED | |
| 17–24 | DT_*/DR_* damage type thresholds | STUB | |
| 25 | STAT_RADIATION | WIRED | |
| 26 | STAT_POISON | WIRED | |
| 27 | STAT_AGE | WIRED | |
| 28 | STAT_GENDER | WIRED | |
| 29+ | Extended stats (HP, AC mods etc.) | PARTIAL/STUB | |
