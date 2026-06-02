# Scripting Opcodes Index — DarkHarold2 Reference

Companion to [opcodes.md](opcodes.md) (wired intrinsic table) and [scripting_vm.md](scripting_vm.md) (VM architecture).  
CE ref: `raw/fallout2-ce/src/scripts.h` (`SCRIPT_PROC_*`), `raw/fallout2-ce/src/scripts.cc` (`gScriptProcNames`, fire sites), `raw/fallout2-ce/src/interpreter_extra.cc` (opcode registration), `raw/fallout2-ce/src/stat_defs.h` (`PcStat`)  
DH2 ref: `src/scripting.ts` (all `Scripting.*` exports + `Script` class procs), `src/vm_bridge.ts` (bridge)

---

## 1. Script Procedure Hooks (SCRIPT_PROC_*)

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

## 2. Script Variable Context

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

## 3. `get_pc_stat` / `set_pc_stat` Constants

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

---

## 4. `metarule` Sub-Operation IDs

Opcode `0x810B` dispatches on the first argument. CE source: `interpreter_extra.cc:opMetarule`.

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

## 5. `metarule3` Sub-Operation IDs

Opcode `0x80E1`. Signature: `metarule3(id, obj, userdata, radius)`.

| ID | CE Name | DH2 Status | Description |
|----|---------|------------|-------------|
| 100 | `METARULE3_CLR_FIXED_TIMED_EVENTS` | WIRED | Removes timer event by (obj, userdata) pair |
| 106 | `METARULE3_TILE_GET_NEXT_CRITTER` | WIRED (partial) | First non-player critter at tile; elevation not respected |
| all others | — | STUB | logs + returns undefined |

---

## 6. `has_trait` Object-Trait Cases

Opcode `0x80F3`. Signature: `has_trait(traitType, obj, traitId)`.  
CE: `TRAIT_OBJECT = 1` queries object flags/state. DH2 handles type `1` only.

| traitType | traitId | DH2 Status | Meaning |
|-----------|---------|------------|---------|
| 1 (TRAIT_OBJECT) | 5 | WIRED | `OBJECT_WORN` flag set? (is wearing armor) |
| 1 | 6 | WIRED | item count in right/left hand slot |
| 1 | 10 | WIRED | `OBJECT_FLAT` flag (flat/ground-level object) |
| 1 | 666 | WIRED | object visibility (OBJECT_HIDDEN flag) |
| 1 | 669 | WIRED | object type check |
| other types | any | STUB | `has_trait: STUB` |

---

## 7. Unwired CE Opcodes (UNWIRED in DH2)

These opcodes exist in CE (`interpreter_extra.cc`) but have no entry in DH2's `vm_bridge.ts`. Scripts that call them hit the unhandled opcode path (silent no-op in the default dispatch; no error thrown).

| Opcode | CE Name | CE Description |
|--------|---------|----------------|
| 0x80A2 | `scr_return` | Return value from a scripted function call |
| 0x80A5 | `sfx_build_open_name` | Build SFX filename for open action |
| 0x80A6 | `get_pc_stat` | Read player-only stat (see §3) — method exists in scripting.ts but not wired |
| 0x80AD | `skill_contest` | Two-critter skill contest |
| 0x80B1 | `how_much` | Count of a specific item type on tile |
| 0x80B3 | `reaction_influence` | Adjust NPC reaction |
| 0x80B5 | `roll_dice` | Multi-dice roll (Nd6 etc.) |
| 0x80C0 | `obj_being_used_with` | Object currently being used with self |
| 0x80C7 | `script_action` | Current script action |
| 0x80CB | `set_critter_stat` | Set critter stat (see §3) |
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

## 8. `get_critter_stat` Stat ID Mapping

Opcode `0x80CA`. CE registers stat IDs in `stat_defs.h`. DH2 `scripting.ts:570` handles a partial set:

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
