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

import globalState from "./globalState.js"
import { IntFile } from "./intfile.js"
import { Scripting } from "./scripting.js"
import { BinaryReader } from "./util.js"
import { dbg } from "./logger.js"
import { opMap, ScriptVM } from "./vm.js"
import * as GameTime from "./gametime.js"

// Bridge between Scripting API and the Scripting VM

export module ScriptVMBridge {
    // create a bridged function that calls procedures on scriptObj
    function bridged(procName: string, argc: number, pushResult: boolean=true) {
        return function(this: GameScriptVM) {
            var args = []
            for(var i = 0; i < argc; i++)
                args.push(this.pop())
            args.reverse()

            var r = (<any>this.scriptObj)[procName].apply(this.scriptObj, args)
            if(pushResult)
                this.push(r)
        }
    }

    function varName(this: ScriptVM, value: any): string {
        if(typeof value === "number")
            return this.intfile.identifiers[value]
        return value
    }

    var bridgeOpMap: { [opcode: number]: (this: GameScriptVM) => void } = {
        0x80BF: function() { this.push(globalState.player) } // dude_obj
       ,0x80BC: function() { this.push(this.scriptObj.self_obj) } // self_obj
       ,0x8128: function() { this.push(this.scriptObj.combat_is_initialized) } // combat_is_initialized
       ,0x8118: function() { this.push(GameTime.getDate().month + 1) } // get_month (1-indexed)
       ,0x80F6: function() { this.push(GameTime.getHourMilitary()) } // game_time_hour — CE: 100*hour+min (scripts.cc:332 gameTimeGetHour)
       ,0x80a8: function() { this.push(GameTime.getHourMilitary()) } // game_time_hour (alt)
       ,0x80EA: function() { this.push(this.scriptObj.game_time) } // game_time
       ,0x80EB: function() { this.push(GameTime.getTotalSeconds()) } // game_time_in_seconds — CE: interpreter_extra.cc:2277 opGetGameTimeInSeconds → ticks/10
       ,0x8119: function() { this.push(GameTime.getDate().day) } // get_day (day of month)
       ,0x8101: function() { this.push(this.scriptObj.cur_map_index) } // cur_map_index
       ,0x80BD: function() { this.push(this.scriptObj.source_obj) } // source_obj
       ,0x80FA: function() { this.push(this.scriptObj.action_being_used) } // action_being_used
       ,0x80BE: function() { this.push(this.scriptObj.target_obj) } // target_obj
       ,0x80F7: function() { this.push(this.scriptObj.fixed_param) } // fixed_param

       ,0x8016: function() { this.mapScript()[this.pop()] = 0 } // op_export_var
       ,0x8015: function() { var name = varName.call(this, this.pop()); this.mapScript()[name] = this.pop() } // op_store_external
       ,0x8014: function() { this.push(this.mapScript()[varName.call(this, this.pop())]) } // op_fetch_external

       ,0x80B9: bridged("script_overrides", 0, false)
       ,0x80B4: bridged("random", 2)
       ,0x80B5: function() { this.pop(); this.pop(); this.push(0) } // roll_dice — CE predefined-error stub; pushes 0 per CE interpreter_extra.cc:789 opRollDice
       ,0x80E1: bridged("metarule3", 4)
       ,0x80CA: bridged("get_critter_stat", 2)
       ,0x80CB: bridged("set_critter_stat", 3)
       ,0x8105: bridged("message_str", 2)
       ,0x80B8: bridged("display_msg", 1, false)
       ,0x8111: bridged("reg_anim_begin", 1, false)
       ,0x8112: bridged("reg_anim_end", 0, false)
       ,0x8113: bridged("reg_anim_clear", 0, false)
       ,0x810E: function() { // reg_anim_func — wraps proc addr into a callable (ref: giq_option pattern)
            const procAddr = this.pop()
            const obj = this.pop()
            const procEntry = this.intfile.proceduresTable[procAddr]
            const fn = procEntry ? () => { this.call(procEntry.name) } : null
            this.scriptObj.reg_anim_func(obj, fn)
       }
       ,0x8110: bridged("reg_anim_obj_move_to_tile", 3, false)
       ,0x8126: bridged("reg_anim_animate_forever", 2, false)
       ,0x810F: bridged("reg_anim_animate", 3, false)
       ,0x810C: bridged("anim", 3, false)
       ,0x80E7: bridged("anim_busy", 1)
       ,0x810B: bridged("metarule", 2)
       ,0x80C1: bridged("local_var", 1)
       ,0x80C2: bridged("set_local_var", 2, false)
       ,0x80C5: bridged("global_var", 1)
       ,0x80C6: bridged("set_global_var", 2, false)
       ,0x80C3: bridged("map_var", 1)
       ,0x80C4: bridged("set_map_var", 2, false)
       ,0x80B2: bridged("mark_area_known", 3, false)
       ,0x80E5: bridged("wm_area_set_pos", 3, false)
       ,0x80B7: bridged("create_object_sid", 4)
       ,0x8102: bridged("critter_add_trait", 4)
       ,0x8106: bridged("critter_inven_obj", 2)
       ,0x8109: bridged("inven_cmds", 3)
       ,0x80FF: bridged("critter_attempt_placement", 3)
       ,0x8127: bridged("critter_injure", 2, false)
       ,0x80E8: bridged("critter_heal", 2, false)
       ,0x8151: bridged("critter_is_fleeing", 1)
       ,0x8152: bridged("critter_set_flee_state", 2, false) // void?
       ,0x80DA: bridged("wield_obj_critter", 2, false)
       ,0x8116: bridged("add_mult_objs_to_inven", 3, false)
       ,0x8117: bridged("rm_mult_objs_from_inven", 3)
       ,0x80D8: bridged("add_obj_to_inven", 2, false)
       ,0x80D9: bridged("rm_obj_from_inven", 2, false) // CE: interpreter_extra.cc:4930 opRemoveObjectFromInventory (restored 2026-10-06; lost in b282cca)
       ,0x80DC: bridged("obj_can_see_obj", 2)
       ,0x80E9: bridged("set_light_level", 1)
       ,0x8107: bridged("obj_set_light_level", 3, false)
       ,0x80E6: bridged("set_exit_grids", 5, false)
       ,0x80BB: bridged("tile_contains_obj_pid", 3)
       ,0x80D3: bridged("tile_distance_objs", 2)
       ,0x80D2: bridged("tile_distance", 2)
       ,0x80A7: bridged("tile_contains_pid_obj", 3)
       ,0x814C: bridged("rotation_to_tile", 2)
       ,0x814D: bridged("jam_lock", 1, false) // CE ref: interpreter_extra.cc:5046 opJamLock
       ,0x80AE: bridged("do_check", 3)
       ,0x814a: bridged("art_anim", 1)
       ,0x80F4: bridged("destroy_object", 1, false)
       ,0x80A9: bridged("override_map_start", 4, false)
       ,0x8154: bridged("debug_msg", 1, false)
       ,0x80F3: bridged("has_trait", 3)
       ,0x80C9: bridged("obj_item_subtype", 1)
       ,0x80BA: bridged("obj_is_carrying_obj_pid", 2)
       ,0x810D: bridged("obj_carrying_pid_obj", 2)
       ,0x80B6: bridged("move_to", 3)
       ,0x8147: bridged("move_obj_inven_to_obj", 2, false)
       ,0x8100: bridged("obj_pid", 1)
       ,0x8104: bridged("proto_data", 2) // proto_data(pid, data_member) — CE: interpreter_extra.cc opGetProtoData (PS1)
       ,0x80A4: bridged("obj_name", 1)
       ,0x80A6: bridged("get_pc_stat", 1) // CE: interpreter_extra.cc:4879 opGetPcStat (restored 2026-10-06; lost in b282cca)
       ,0x8149: bridged("obj_art_fid", 1)
       ,0x8150: bridged("obj_on_screen", 1)
       ,0x80f5: bridged("obj_can_hear_obj", 2)
       ,0x80E3: bridged("set_obj_visibility", 2, false)
       ,0x8130: bridged("obj_is_open", 1)
       ,0x80C8: bridged("obj_type", 1)
       ,0x8131: bridged("obj_open", 1, false)
       ,0x8132: bridged("obj_close", 1, false)
       ,0x812E: bridged("obj_lock", 1, false)
       ,0x812F: bridged("obj_unlock", 1, false)
       ,0x812D: bridged("obj_is_locked", 1)
       ,0x80AC: bridged("roll_vs_skill", 3)
       ,0x80AF: bridged("is_success", 1)
       ,0x80B0: bridged("is_critical", 1)
       ,0x80AA: bridged("has_skill", 2)
       ,0x80AB: bridged("using_skill", 2)
       ,0x813C: bridged("critter_mod_skill", 3) // int or void?
       ,0x80EF: bridged("critter_dmg", 3, false)
       ,0x80ed: bridged("kill_critter", 2, false)
       ,0x811a: bridged("explosion", 3) // int?
       ,0x8122: bridged("poison", 2, false)      // CE: interpreter_extra.cc:5003 opPoison
       ,0x8123: bridged("get_poison", 1)          // CE: interpreter_extra.cc:5004 opGetPoison
       ,0x80FD: bridged("radiation_inc", 2, false) // CE: interpreter_extra.cc:4966 opRadiationIncrease
       ,0x80FE: bridged("radiation_dec", 2, false) // CE: interpreter_extra.cc:4967 opRadiationDecrease
       ,0x826E: bridged("make_straight_path", 3)    // CE: sfall_opcodes.cc:937 op_make_straight_path
       ,0x826F: bridged("obj_blocking_at", 3)       // CE: sfall_opcodes.cc:951 op_obj_blocking_at
       ,0x80A1: bridged("give_exp_points", 1, false)
       ,0x8138: bridged("item_caps_total", 1)
       ,0x8139: bridged("item_caps_adjust", 2)
       ,0x80FB: bridged("critter_state", 1)
       ,0x8124: bridged("party_add", 1, false)
       ,0x8125: bridged("party_remove", 1, false)
       ,0x814B: bridged("party_member_obj", 1)
       ,0x80EC: bridged("elevation", 1)
       ,0x80F2: bridged("game_ticks", 1)
       ,0x811B: bridged("days_since_visited", 0) // CE: interpreter_extra.cc:3734 opGetDaysSinceLastVisit
       ,0x8133: bridged("game_ui_disable", 0, false)
       ,0x8134: bridged("game_ui_enable", 0, false)
       ,0x80f8: bridged("tile_is_visible", 1)
       ,0x80CF: bridged("tile_in_tile_rect", 5)
       ,0x80D4: bridged("tile_num", 1)
       ,0x80D5: bridged("tile_num_in_direction", 3)
       ,0x80CE: bridged("animate_move_obj_to_tile", 3, false)
       ,0x80CC: bridged("animate_stand_obj", 1, false)
       ,0x80D0: bridged("attack_complex", 8, false)
       ,0x8153: bridged("terminate_combat", 0, false)
       ,0x8145: bridged("use_obj_on_obj", 2, false)
       ,0x80E4: bridged("load_map", 2, false)
       ,0x8115: bridged("play_gmovie", 1, false)
       ,0x8146: bridged("endgame_slideshow", 0, false)
       ,0x8148: bridged("endgame_movie", 0, false)
       ,0x80A3: bridged("play_sfx", 1, false)
       ,0x80FC: bridged("game_time_advance", 1, false)
       ,0x8137: bridged("gfade_in", 1, false)
       ,0x8136: bridged("gfade_out", 1, false)
       ,0x810A: bridged("float_msg", 3, false)
       ,0x80F0: bridged("add_timer_event", 3, false)
       ,0x80F1: bridged("rm_timer_event", 1, false)
       ,0x80F9: bridged("dialogue_system_enter", 0, false)
       ,0x8129: bridged("gdialog_mod_barter", 1, false)
       ,0x80DE: bridged("start_gdialog", 5, false)
       ,0x811C: bridged("gsay_start", 0) // void?
       //,0x811D: bridged("gsay_end", 0) // void?
       ,0x811E: bridged("gsay_reply", 2, false)
       ,0x80DF: bridged("end_dialogue", 0) // void?
       ,0x8120: bridged("gsay_message", 3, false)
       // Vanilla FO2 opcodes that were missing from the bridge (CE interpreter_extra.cc
       // interpreterRegisterOpcode table, diffed 2026-10-06).
       ,0x80A2: bridged("scr_return", 1, false)
       ,0x80A5: bridged("sfx_build_open_name", 2)
       ,0x80AD: bridged("skill_contest", 3)
       ,0x80B1: bridged("how_much", 1)
       ,0x80B3: bridged("reaction_influence", 3)
       ,0x80C0: bridged("obj_being_used_with", 0)
       ,0x80C7: bridged("script_action", 0)
       ,0x80CD: bridged("animate_stand_reverse_obj", 1, false)
       ,0x80D1: bridged("make_daytime", 0, false)
       ,0x80D6: bridged("pickup_obj", 1, false)
       ,0x80D7: bridged("drop_obj", 1, false)
       ,0x80DB: bridged("use_obj", 1, false)
       ,0x80DD: bridged("attack_complex", 8, false) // CE registers opAttackComplex at both 0x80D0 and 0x80DD
       ,0x80E2: bridged("set_map_music", 2, false)
       ,0x80EE: bridged("kill_critter_type", 2, false)
       ,0x8103: bridged("critter_rm_trait", 4)
       ,0x8108: bridged("world_map", 0, false)
       ,0x8114: bridged("reg_anim_obj_run_to_tile", 3, false)
       ,0x812A: bridged("game_difficulty", 0)
       ,0x812B: bridged("running_burning_guy", 0)
       ,0x812C: bridged("inven_unwield", 0, false)
       ,0x8135: bridged("game_ui_is_disabled", 0)
       ,0x813A: bridged("anim_action_frame", 2)
       ,0x813B: bridged("reg_anim_play_sfx", 3, false)
       ,0x813D: bridged("sfx_build_char_name", 3)
       ,0x813E: bridged("sfx_build_ambient_name", 1)
       ,0x813F: bridged("sfx_build_interface_name", 1)
       ,0x8140: bridged("sfx_build_item_name", 1)
       ,0x8141: bridged("sfx_build_weapon_name", 4)
       ,0x8142: bridged("sfx_build_scenery_name", 3)
       ,0x8143: bridged("attack_setup", 2, false)
       ,0x8144: bridged("destroy_mult_objs", 2)
       ,0x814F: bridged("combat_difficulty", 0)
       ,0x8155: bridged("critter_stop_attacking", 1, false)
       ,0x80E0: bridged("dialogue_reaction", 1, false) // CE: interpreter_extra.cc:4937 op_dialogue_reaction
       //,0x806B: bridged("display", 1)
       ,0x814E: bridged("gdialog_set_barter_mod", 1, false)

       ,0x811D: function() { // gsay_end
            // halt where we are, saving our return address.
            // we will resume when the dialogue system resumes us on dialogue exit
            // usually to run cleanup code.
            dbg('script', "halting in gsay_end (pc=0x%s)", this.pc.toString(16))
            this.retStack.push(this.pc + 2)
            this.halted = true
            this.scriptObj.gsay_end()
       }

       // gsay_option — CE: interpreter_extra.cc _op_gsay_option (0x811F); like giq_option without the IQ test.
       ,0x811F: function() {
            var reaction = this.pop()
            var target = this.pop()
            var msgId = this.pop()
            var msgList = this.pop()
            var targetProc = typeof target === 'string' ? target : this.intfile.proceduresTable[target].name
            var targetFn = () => { this.call(targetProc) }
            this.scriptObj.gsay_option(msgList, msgId, targetFn, reaction)
       }

       //,0x8121: bridged("giq_option", 5) // TODO: wrap this so that target becomes a function
       // giq_option
       ,0x8121: function() { // giq_option
            var reaction = this.pop()
            var target = this.pop()
            var msgId = this.pop()
            var msgList = this.pop()
            var iqTest = this.pop()

            // wrap target in a function
            //var targetFn = () => { this.call() }
            //console.log("TARGET=%o, proc=%o this=%o", targetFn, this.intfile.proceduresTable[target], this)
            var targetProc = this.intfile.proceduresTable[target].name
            // TODO: do we save the current PC as the return address?
            // otherwise when end_dialogue is reached, we will have
            // interrupted to this targetFn, and have no way back
            var targetFn = () => { this.call(targetProc) }

            this.scriptObj.giq_option(iqTest, msgList, msgId, targetFn, reaction)
        }
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
            for(const procName in this.intfile.procedures) {
                (<any>this.scriptObj)[procName] = () => { this.call(procName) }
            }
        }

        mapScript(): any {
            if(this.scriptObj._mapScript)
                return this.scriptObj._mapScript
            return this.scriptObj
        }
    }
}