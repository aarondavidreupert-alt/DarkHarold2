/*
Copyright 2015 darkf

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import globalState from './globalState.js'
import { IntFile } from './intfile.js'
import * as Scripting from './scripting.js'
import { BinaryReader } from './util.js'
import { dbg } from './logger.js'
import { scriptProcNumber, STOPS_PROC_ON_SELF } from './scriptProcs.js'
import { opMap, ScriptVM } from './vm.js'
import * as GameTime from './gametime.js'
import { BuiltinVarReader, setBuiltinVarReader, sslValue } from './lua/luaRuntime.js'

// Bridge between Scripting API and the Scripting VM

// create a bridged function that calls procedures on scriptObj
function bridged(procName: string, argc: number, pushResult: boolean = true) {
    return function (this: GameScriptVM) {
        const args = []
        for (let i = 0; i < argc; i++) args.push(this.pop())
        args.reverse()

        const self = this.scriptObj.self_obj
        const r = (<any>this.scriptObj)[procName].apply(this.scriptObj, args)
        // (destroying / killing / damaging its own self_obj ends the procedure — CE drops its frame)
        if (STOPS_PROC_ON_SELF.has(procName) && self && args[0] === self) {
            this.halted = true
            this.aborted = true
            return
        }
        // CE values are typed: a null object is 0, a truth value 0 / 1 (as the Lua backend's sslValue)
        if (pushResult) this.push(sslValue(r))
    }
}

function varName(this: ScriptVM, value: any): string {
    if (typeof value === 'number') return this.intfile.identifiers[value]
    return value
}

// SSL built-in variables: the argument-less opcodes that read engine state.
// Shared with the Lua backend (src/lua/luaRuntime.ts), which reads them
// whenever a script names one.
const builtinVars: { [name: string]: (script: Scripting.Script) => any } = {
    dude_obj: () => globalState.player,
    self_obj: (s) => s.self_obj,
    combat_is_initialized: () => (globalState.inCombat ? 1 : 0), // CE: interpreter_extra.cc opCombatIsInitialized → isInCombat()
    get_month: () => GameTime.getDate().month + 1, // 1-indexed
    game_time_hour: () => GameTime.getHourMilitary(), // CE: 100*hour+min (scripts.cc:332 gameTimeGetHour)
    game_time: () => Math.max(1, globalState.gameTickTime), // CE: interpreter_extra.cc opGetGameTime → gameTimeGetTime() (live)
    game_time_in_seconds: () => GameTime.getTotalSeconds(), // CE: interpreter_extra.cc:2277 opGetGameTimeInSeconds → ticks/10
    get_day: () => GameTime.getDate().day, // day of month
    cur_map_index: (s) => s.cur_map_index,
    source_obj: (s) => s.source_obj,
    action_being_used: (s) => s.action_being_used,
    target_obj: (s) => s.target_obj,
    fixed_param: (s) => s.fixed_param,
}

/** A built-in variable's value; the zero-argument intrinsics that are
 *  Script methods (game_difficulty, ...) are called. */
export function readBuiltinVar(script: Scripting.Script, name: string): any {
    const reader = builtinVars[name]
    if (reader) return reader(script)
    const f = (<any>script)[name]
    return typeof f === 'function' ? f.call(script) : undefined
}

setBuiltinVarReader(readBuiltinVar as BuiltinVarReader)

function builtin(name: string) {
    const reader = builtinVars[name]
    return function (this: GameScriptVM) {
        this.push(sslValue(reader(this.scriptObj)))
    }
}

let bridgeOpMap: { [opcode: number]: (this: GameScriptVM) => void } = {
    0x80bf: builtin('dude_obj'),
    0x80bc: builtin('self_obj'),
    0x8128: builtin('combat_is_initialized'),
    0x8118: builtin('get_month'),
    0x80f6: builtin('game_time_hour'),
    0x80a8: bridged('set_map_start', 4, false), // CE interpreter_extra.cc:4881 op_set_map_start (was a second game_time_hour, leaving 4 args on the stack)
    0x80ea: builtin('game_time'),
    0x80eb: builtin('game_time_in_seconds'),
    0x8119: builtin('get_day'),
    0x8101: builtin('cur_map_index'),
    0x80bd: builtin('source_obj'),
    0x80fa: builtin('action_being_used'),
    0x80be: builtin('target_obj'),
    0x80f7: builtin('fixed_param'),

    0x8016: function () {
        this.mapScript()[this.pop()] = 0
    }, // op_export_var
    0x8015: function () {
        const name = varName.call(this, this.pop())
        this.mapScript()[name] = this.popRaw()
    }, // op_store_external
    0x8014: function () {
        this.push(this.mapScript()[varName.call(this, this.pop())])
    }, // op_fetch_external

    0x80b9: bridged('script_overrides', 0, false),
    0x80b4: bridged('random', 2),
    0x80b5: function () {
        this.pop()
        this.pop()
        this.push(0)
    }, // roll_dice — CE predefined-error stub; pushes 0 per CE interpreter_extra.cc:789 opRollDice
    0x80e1: bridged('metarule3', 4),
    0x80ca: bridged('get_critter_stat', 2),
    0x80cb: bridged('set_critter_stat', 3),
    0x8105: bridged('message_str', 2),
    0x80b8: bridged('display_msg', 1, false),
    // CE interpreter_extra.cc:4983-4989 — reg_anim_func(cmd, param) is begin (1, flags),
    // clear (2, obj) and end (3); then animate, animate_reverse, move/run to obj/tile.
    0x810e: bridged('reg_anim_func', 2, false),
    0x810f: bridged('reg_anim_animate', 3, false),
    0x8110: bridged('reg_anim_animate_reverse', 3, false),
    0x8111: bridged('reg_anim_obj_move_to_obj', 3, false),
    0x8112: bridged('reg_anim_obj_run_to_obj', 3, false),
    0x8113: bridged('reg_anim_obj_move_to_tile', 3, false),
    0x8126: bridged('reg_anim_animate_forever', 2, false),
    0x810c: bridged('anim', 3, false),
    0x80e7: bridged('anim_busy', 1),
    0x810b: bridged('metarule', 2),
    0x80c1: bridged('local_var', 1),
    0x80c2: bridged('set_local_var', 2, false),
    0x80c5: bridged('global_var', 1),
    0x80c6: bridged('set_global_var', 2, false),
    0x80c3: bridged('map_var', 1),
    0x80c4: bridged('set_map_var', 2, false),
    0x80b2: bridged('mark_area_known', 3, false),
    0x80e5: bridged('wm_area_set_pos', 3, false),
    0x80b7: bridged('create_object_sid', 4),
    0x8102: bridged('critter_add_trait', 4),
    0x8106: bridged('critter_inven_obj', 2),
    0x8109: bridged('inven_cmds', 3),
    0x80ff: bridged('critter_attempt_placement', 3),
    0x8127: bridged('critter_injure', 2, false),
    0x80e8: bridged('critter_heal', 2), // CE opCritterHeal pushes critterAdjustHitPoints' result
    0x8151: bridged('critter_is_fleeing', 1),
    0x8152: bridged('critter_set_flee_state', 2, false), // void?
    0x80da: bridged('wield_obj_critter', 2, false),
    0x8116: bridged('add_mult_objs_to_inven', 3, false),
    0x8117: bridged('rm_mult_objs_from_inven', 3),
    0x80d8: bridged('add_obj_to_inven', 2, false),
    0x80d9: bridged('rm_obj_from_inven', 2, false), // CE: interpreter_extra.cc:4930 opRemoveObjectFromInventory (restored 2026-10-06; lost in b282cca)
    0x80dc: bridged('obj_can_see_obj', 2),
    0x80e9: bridged('set_light_level', 1, false), // CE opSetLightLevel pushes nothing
    0x8107: bridged('obj_set_light_level', 3, false),
    0x80e6: bridged('set_exit_grids', 5, false),
    0x80bb: bridged('tile_contains_obj_pid', 3),
    0x80d3: bridged('tile_distance_objs', 2),
    0x80d2: bridged('tile_distance', 2),
    0x80a7: bridged('tile_contains_pid_obj', 3),
    0x814c: bridged('rotation_to_tile', 2),
    0x814d: bridged('jam_lock', 1, false), // CE ref: interpreter_extra.cc:5046 opJamLock
    0x80ae: bridged('do_check', 3),
    0x814a: bridged('art_anim', 1),
    0x80f4: bridged('destroy_object', 1, false),
    0x80a9: bridged('override_map_start', 4, false),
    0x8154: bridged('debug_msg', 1, false),
    0x80f3: bridged('has_trait', 3),
    0x80c9: bridged('obj_item_subtype', 1),
    0x80ba: bridged('obj_is_carrying_obj_pid', 2),
    0x810d: bridged('obj_carrying_pid_obj', 2),
    0x80b6: bridged('move_to', 3),
    0x8147: bridged('move_obj_inven_to_obj', 2, false),
    0x8100: bridged('obj_pid', 1),
    0x8104: bridged('proto_data', 2), // proto_data(pid, data_member) — CE: interpreter_extra.cc opGetProtoData (PS1)
    0x80a4: bridged('obj_name', 1),
    0x80a6: bridged('get_pc_stat', 1), // CE: interpreter_extra.cc:4879 opGetPcStat (restored 2026-10-06; lost in b282cca)
    0x8149: bridged('obj_art_fid', 1),
    0x8150: bridged('obj_on_screen', 1),
    0x80f5: bridged('obj_can_hear_obj', 2),
    0x80e3: bridged('set_obj_visibility', 2, false),
    0x8130: bridged('obj_is_open', 1),
    0x80c8: bridged('obj_type', 1),
    0x8131: bridged('obj_open', 1, false),
    0x8132: bridged('obj_close', 1, false),
    0x812e: bridged('obj_lock', 1, false),
    0x812f: bridged('obj_unlock', 1, false),
    0x812d: bridged('obj_is_locked', 1),
    0x80ac: bridged('roll_vs_skill', 3),
    0x80af: bridged('is_success', 1),
    0x80b0: bridged('is_critical', 1),
    0x80aa: bridged('has_skill', 2),
    0x80ab: bridged('using_skill', 2),
    0x813c: bridged('critter_mod_skill', 3), // int or void?
    0x80ef: bridged('critter_dmg', 3, false),
    0x80ed: bridged('kill_critter', 2, false),
    0x811a: bridged('explosion', 3, false), // CE opExplosion pushes nothing
    0x8122: bridged('poison', 2, false), // CE: interpreter_extra.cc:5003 opPoison
    0x8123: bridged('get_poison', 1), // CE: interpreter_extra.cc:5004 opGetPoison
    0x80fd: bridged('radiation_inc', 2, false), // CE: interpreter_extra.cc:4966 opRadiationIncrease
    0x80fe: bridged('radiation_dec', 2, false), // CE: interpreter_extra.cc:4967 opRadiationDecrease
    0x826e: bridged('make_straight_path', 3), // CE: sfall_opcodes.cc:937 op_make_straight_path
    0x826f: bridged('obj_blocking_at', 3), // CE: sfall_opcodes.cc:951 op_obj_blocking_at
    // sfall arrays (CE sfall_opcodes.cc, src/sfallArrays.ts)
    0x822d: bridged('create_array', 2), // CE opCreateArray
    0x822e: bridged('set_array', 3, false), // CE opSetArray
    0x822f: bridged('get_array', 2), // CE opGetArray
    0x8230: bridged('free_array', 1, false), // CE opFreeArray
    0x8231: bridged('len_array', 1), // CE opLenArray
    0x8232: bridged('resize_array', 2, false), // CE opResizeArray
    0x8233: bridged('temp_array', 2), // CE opTempArray
    0x8234: bridged('fix_array', 1, false), // CE opFixArray
    0x8235: bridged('string_split', 2), // CE opStringSplit
    0x8236: bridged('list_as_array', 1), // CE op_list_as_array
    0x8239: bridged('scan_array', 2), // CE opScanArray
    0x8256: bridged('array_key', 2), // CE opGetArrayKey
    0x8257: bridged('arrayexpr', 2), // CE opStackArray
    // other sfall functions the Unofficial Patch uses (CE sfall_opcodes.cc; Script methods)
    0x81ed: bridged('abs', 1), // CE op_abs
    0x81ac: bridged('get_ini_setting', 1), // CE op_get_ini_setting
    0x8261: bridged('explosions_metarule', 3), // CE op_explosions_metarule
    0x8206: bridged('set_self', 1, false), // CE op_set_self
    0x8204: bridged('get_proto_data', 2), // CE op_get_proto_data
    0x8205: bridged('set_proto_data', 3, false), // CE op_set_proto_data
    0x8217: bridged('get_weapon_ammo_pid', 1), // CE opGetWeaponAmmoPid
    0x8218: bridged('set_weapon_ammo_pid', 2, false), // CE opSetWeaponAmmoPid
    0x8219: bridged('get_weapon_ammo_count', 1), // CE opGetWeaponAmmoCount
    0x821a: bridged('set_weapon_ammo_count', 2, false), // CE opSetWeaponAmmoCount
    0x815a: bridged('set_pc_base_stat', 2, false), // CE op_set_pc_base_stat
    0x815b: bridged('set_pc_extra_stat', 2, false), // CE opSetPcBonusStat
    0x815c: bridged('get_pc_base_stat', 1), // CE op_get_pc_base_stat
    0x815d: bridged('get_pc_extra_stat', 1), // CE opGetPcBonusStat
    0x815f: bridged('set_critter_extra_stat', 3, false), // sfall (not in CE)
    0x8160: bridged('get_critter_base_stat', 2), // sfall (not in CE)
    0x8161: bridged('get_critter_extra_stat', 2), // sfall (not in CE)
    0x8271: bridged('party_member_list', 1), // CE opPartyMemberList
    0x81f5: bridged('get_script', 1), // CE op_get_script
    0x8172: bridged('set_world_map_pos', 2, false), // CE op_set_world_map_pos
    0x81b6: bridged('set_car_current_town', 1, false), // CE op_set_car_current_town
    0x81f8: bridged('fs_copy', 2), // sfall (not in CE): sfallFs.ts
    // sfall global scripts, global variables, hooks, virtual files (Script methods;
    // src/sfallGlobalScripts.ts, src/sfallHooks.ts, src/sfallFs.ts)
    0x8164: bridged('game_loaded', 0), // CE op_game_loaded
    0x816a: bridged('set_global_script_repeat', 1, false), // CE op_set_global_script_repeat
    0x819b: bridged('set_global_script_type', 1, false), // CE op_set_global_script_type
    0x819d: bridged('set_sfall_global', 2, false), // CE opSetGlobalVar
    0x819e: bridged('get_sfall_global_int', 1), // CE opGetGlobalInt
    0x81af: bridged('get_game_mode', 0), // CE opGetGameMode
    0x8162: bridged('tap_key', 1, false), // CE op_tap_key
    0x81e4: bridged('get_sfall_arg', 0), // sfall (not in CE): hooks
    0x81e5: bridged('set_sfall_return', 1, false), // sfall (not in CE): hooks
    0x823c: bridged('get_sfall_args', 0), // sfall (not in CE): hooks
    0x823d: bridged('set_sfall_arg', 2, false), // sfall (not in CE): hooks
    0x81f4: bridged('set_script', 2, false), // sfall (not in CE)
    0x81f9: bridged('fs_find', 1), // sfall (not in CE): sfallFs.ts
    0x81fa: bridged('fs_write_byte', 2, false), // sfall (not in CE)
    0x81fb: bridged('fs_write_short', 2, false), // sfall (not in CE)
    0x81fc: bridged('fs_write_int', 2, false), // sfall (not in CE)
    0x81fd: bridged('fs_write_int', 2, false), // sfall (not in CE): fs_write_float, the same bytes
    0x81ff: bridged('fs_delete', 1, false), // sfall (not in CE)
    0x8200: bridged('fs_size', 1), // sfall (not in CE)
    0x8201: bridged('fs_pos', 1), // sfall (not in CE)
    0x8202: bridged('fs_seek', 2, false), // sfall (not in CE)
    0x8203: bridged('fs_resize', 2, false), // sfall (not in CE)
    0x8209: bridged('fs_read_byte', 1), // sfall (not in CE)
    0x820a: bridged('fs_read_short', 1), // sfall (not in CE)
    0x820b: bridged('fs_read_int', 1), // sfall (not in CE)
    // sfall register_hook_proc (0x8262): like gsay_option, the procedure argument (a
    // procedure number, 0 = unregister) becomes a function
    0x8262: function () {
        const proc = this.pop()
        const hookId = this.pop()
        let procFn = null
        if (proc !== 0) {
            const procName = typeof proc === 'string' ? proc : this.intfile.proceduresTable[proc].name
            procFn = () => {
                this.call(procName)
            }
        }
        this.scriptObj.register_hook_proc(hookId, procFn)
    },
    0x8276: bridged('sfall_func0', 1), // CE op_sfall_func0
    0x8277: bridged('sfall_func1', 2), // CE op_sfall_func1
    0x8278: bridged('sfall_func2', 3), // CE op_sfall_func2
    0x8279: bridged('sfall_func3', 4), // CE op_sfall_func3
    0x827a: bridged('sfall_func4', 5), // CE op_sfall_func4
    0x827b: bridged('sfall_func5', 6), // CE op_sfall_func5
    0x827c: bridged('sfall_func6', 7), // CE op_sfall_func6
    // further sfall functions (CE sfall_opcodes.cc; Script methods — the float math is in vm.ts)
    0x8156: bridged('read_byte', 1), // CE opReadByte
    0x8163: bridged('get_year', 0), // CE op_get_year
    0x816c: bridged('key_pressed', 1), // CE op_key_pressed
    0x8170: bridged('in_world_map', 0), // CE op_in_world_map
    0x8171: bridged('force_encounter', 1, false), // CE op_force_encounter
    0x8229: bridged('force_encounter_with_flags', 2, false), // CE op_force_encounter_with_flags
    0x8193: bridged('active_hand', 0), // CE opGetCurrentHand
    0x81b3: bridged('get_uptime', 0), // CE op_get_uptime
    0x81df: bridged('get_bodypart_hit_modifier', 1), // CE op_get_bodypart_hit_modifier
    0x81e0: bridged('set_bodypart_hit_modifier', 2, false), // CE op_set_bodypart_hit_modifier
    0x81eb: bridged('get_ini_string', 1), // CE op_get_ini_string
    0x820d: bridged('list_begin', 1), // CE opListBegin
    0x820e: bridged('list_next', 1), // CE opListNext
    0x820f: bridged('list_end', 1, false), // CE opListEnd
    0x8210: bridged('sfall_ver_major', 0), // CE opGetVersionMajor
    0x8211: bridged('sfall_ver_minor', 0), // CE opGetVersionMinor
    0x8212: bridged('sfall_ver_build', 0), // CE opGetVersionPatch
    0x821c: bridged('get_mouse_x', 0), // CE opGetMouseX
    0x821d: bridged('get_mouse_y', 0), // CE opGetMouseY
    0x821e: bridged('get_mouse_buttons', 0), // CE op_get_mouse_buttons
    0x8220: bridged('get_screen_width', 0), // CE opGetScreenWidth
    0x8221: bridged('get_screen_height', 0), // CE opGetScreenHeight
    0x8224: bridged('create_message_window', 1, false), // CE op_create_message_window
    0x8228: bridged('get_attack_type', 0), // CE op_get_attack_type
    0x8237: bridged('atoi', 1), // CE opParseInt
    0x824b: bridged('tile_under_cursor', 0), // CE op_tile_under_cursor
    0x824e: bridged('substr', 3), // CE opSubstr
    0x824f: bridged('strlen', 1), // CE opGetStringLength
    0x826b: bridged('message_str_game', 2), // CE opGetMessage
    0x8274: bridged('art_exists', 1), // CE opArtExists
    0x80a1: bridged('give_exp_points', 1, false),
    0x8138: bridged('item_caps_total', 1),
    0x8139: bridged('item_caps_adjust', 2),
    0x80fb: bridged('critter_state', 1),
    0x8124: bridged('party_add', 1, false),
    0x8125: bridged('party_remove', 1, false),
    0x814b: bridged('party_member_obj', 1),
    0x80ec: bridged('elevation', 1),
    0x80f2: bridged('game_ticks', 1),
    0x811b: bridged('days_since_visited', 0), // CE: interpreter_extra.cc:3734 opGetDaysSinceLastVisit
    0x8133: bridged('game_ui_disable', 0, false),
    0x8134: bridged('game_ui_enable', 0, false),
    0x80f8: bridged('tile_is_visible', 1),
    0x80cf: bridged('tile_in_tile_rect', 5),
    0x80d4: bridged('tile_num', 1),
    0x80d5: bridged('tile_num_in_direction', 3),
    0x80ce: bridged('animate_move_obj_to_tile', 3, false),
    0x80cc: bridged('animate_stand_obj', 1, false),
    0x80d0: bridged('attack_complex', 8, false),
    0x8153: bridged('terminate_combat', 0, false),
    0x8145: bridged('use_obj_on_obj', 2, false),
    0x80e4: bridged('load_map', 2, false),
    0x8115: bridged('play_gmovie', 1, false),
    0x8146: bridged('endgame_slideshow', 0, false),
    0x8148: bridged('endgame_movie', 0, false),
    0x80a3: bridged('play_sfx', 1, false),
    0x80fc: bridged('game_time_advance', 1, false),
    0x8137: bridged('gfade_in', 1, false),
    0x8136: bridged('gfade_out', 1, false),
    0x810a: bridged('float_msg', 3, false),
    0x80f0: bridged('add_timer_event', 3, false),
    0x80f1: bridged('rm_timer_event', 1, false),
    0x80f9: bridged('dialogue_system_enter', 0, false),
    0x8129: bridged('gdialog_mod_barter', 1, false),
    0x80de: bridged('start_gdialog', 5, false),
    0x811c: bridged('gsay_start', 0, false), // CE _op_gsay_start pushes nothing
    //,0x811D: bridged("gsay_end", 0) // void?
    0x811e: bridged('gsay_reply', 2, false),
    0x80df: bridged('end_dialogue', 0, false), // CE opEndGameDialog pushes nothing
    0x8120: bridged('gsay_message', 3, false),
    // Vanilla FO2 opcodes that were missing from the bridge (CE interpreter_extra.cc
    // interpreterRegisterOpcode table, diffed 2026-10-06).
    0x80a2: bridged('scr_return', 1, false),
    0x80a5: bridged('sfx_build_open_name', 2),
    0x80ad: bridged('skill_contest', 3),
    0x80b1: bridged('how_much', 1),
    0x80b3: bridged('reaction_influence', 3),
    0x80c0: bridged('obj_being_used_with', 0),
    0x80c7: bridged('script_action', 0),
    0x80cd: bridged('animate_stand_reverse_obj', 1, false),
    0x80d1: bridged('make_daytime', 0, false),
    0x80d6: bridged('pickup_obj', 1, false),
    0x80d7: bridged('drop_obj', 1, false),
    0x80db: bridged('use_obj', 1, false),
    0x80dd: bridged('attack_complex', 8, false), // CE registers opAttackComplex at both 0x80D0 and 0x80DD
    0x80e2: bridged('set_map_music', 2, false),
    0x80ee: bridged('kill_critter_type', 2, false),
    0x8103: bridged('critter_rm_trait', 4),
    0x8108: bridged('world_map', 0, false),
    0x8114: bridged('reg_anim_obj_run_to_tile', 3, false),
    0x812a: bridged('game_difficulty', 0),
    0x812b: bridged('running_burning_guy', 0),
    0x812c: bridged('inven_unwield', 0, false),
    0x8135: bridged('game_ui_is_disabled', 0),
    0x813a: bridged('anim_action_frame', 2),
    0x813b: bridged('reg_anim_play_sfx', 3, false),
    0x813d: bridged('sfx_build_char_name', 3),
    0x813e: bridged('sfx_build_ambient_name', 1),
    0x813f: bridged('sfx_build_interface_name', 1),
    0x8140: bridged('sfx_build_item_name', 1),
    0x8141: bridged('sfx_build_weapon_name', 4),
    0x8142: bridged('sfx_build_scenery_name', 3),
    0x8143: bridged('attack_setup', 2, false),
    0x8144: bridged('destroy_mult_objs', 2),
    0x814f: bridged('combat_difficulty', 0),
    0x8155: bridged('critter_stop_attacking', 1, false),
    0x80e0: bridged('dialogue_reaction', 1, false), // CE: interpreter_extra.cc:4937 op_dialogue_reaction
    //,0x806B: bridged("display", 1)
    0x814e: bridged('gdialog_set_barter_mod', 1, false),

    0x811d: function () {
        // gsay_end
        // halt where we are, saving our return address.
        // we will resume when the dialogue system resumes us on dialogue exit
        // usually to run cleanup code.
        // CE _gdialogGo: the dialogue runs only while a reply is pending
        const r = this.scriptObj.gsay_end()
        if (!r) return
        dbg('script', 'halting in gsay_end (pc=0x%s)', this.pc.toString(16))
        this.retStack.push(this.pc + 2)
        this.halted = true
    },

    // gsay_option — CE: interpreter_extra.cc _op_gsay_option (0x811F); like giq_option without the IQ test.
    0x811f: function () {
        const reaction = this.pop()
        const target = this.pop()
        const msgId = this.pop()
        const msgList = this.pop()
        const targetProc = typeof target === 'string' ? target : this.intfile.proceduresTable[target].name
        const targetFn = () => {
            this.call(targetProc)
        }
        this.scriptObj.gsay_option(msgList, msgId, targetFn, reaction)
    },

    //,0x8121: bridged("giq_option", 5) // TODO: wrap this so that target becomes a function
    // giq_option
    0x8121: function () {
        // giq_option
        const reaction = this.pop()
        const target = this.pop()
        const msgId = this.pop()
        const msgList = this.pop()
        const iqTest = this.pop()

        // wrap target in a function
        //var targetFn = () => { this.call() }
        //console.log("TARGET=%o, proc=%o this=%o", targetFn, this.intfile.proceduresTable[target], this)
        const targetProc = this.intfile.proceduresTable[target].name
        // TODO: do we save the current PC as the return address?
        // otherwise when end_dialogue is reached, we will have
        // interrupted to this targetFn, and have no way back
        const targetFn = () => {
            this.call(targetProc)
        }

        this.scriptObj.giq_option(iqTest, msgList, msgId, targetFn, reaction)
    },
}

// update VM opMap with our bridgeOpMap
Object.assign(opMap, bridgeOpMap)

// define a game-oriented Script VM that has a ScriptProto instance
export class GameScriptVM extends ScriptVM {
    scriptObj = new Scripting.Script()

    constructor(script: BinaryReader, intfile: IntFile) {
        super(script, intfile)

        // patch scriptObj to allow transparent procedure calls
        // TODO: maybe we should check if we're interrupting the VM
        for (const procName in this.intfile.procedures) {
            ;(<any>this.scriptObj)[procName] = () => {
                this.engineCall(procName)
            }
            // CE programFindProcedure compares names case-insensitively (Talk_P_Proc is talk_p_proc)
            const lower = procName.toLowerCase()
            if (lower !== procName && !(lower in this.intfile.procedures))
                (<any>this.scriptObj)[lower] = (<any>this.scriptObj)[procName]
        }
    }

    // An engine entry into a procedure (CE scripts.cc scriptExecProc): the startup code runs
    // before the first proc (setDeferObjectStart); script->action = proc before the run,
    // script->source = 0 after it (not while the proc waits in a dialogue).
    engineCall(procName: string, args: any[] = []): any {
        const so = this.scriptObj
        const entry = so._pendingEntry
        if (entry) {
            so._pendingEntry = undefined
            entry()
        }
        so.action = scriptProcNumber(procName)
        const waiting = this.suspended.length
        const r = this.call(procName, args)
        if (this.suspended.length <= waiting) so.source_obj = 0
        return r
    }

    mapScript(): any {
        if (this.scriptObj._mapScript) return this.scriptObj._mapScript
        return this.scriptObj
    }
}
