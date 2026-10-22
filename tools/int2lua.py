"""
Decompiler for Fallout 2 .int script bytecode straight to Lua 5.4.

Licensed under the Apache License, Version 2.0 (see LICENSE.txt).

The .int files are compiled SSL (Star-Trek Scripting Language). This tool turns
each one into a readable Lua file that the DarkHarold2 Lua script backend
(src/lua/) runs in place of the bytecode VM (src/vm.ts). The output keeps the
script's own variable and procedure names (they are stored in the .int
identifier table) and calls the same intrinsics as the VM bridge
(src/vm_bridge.ts), under their SSL names.

Bytecode layout and opcode semantics follow fallout2-ce:
  interpreter.cc  programCreateByName / opPushBase / opIf / opWhile / opCall /
                  opPopReturn ... (the core opcodes 0x8000-0x804B)
  interpreter_extra.cc  the game intrinsics (0x80A1-0x8156)
The control-flow shapes recognised are the ones the original sslc compiler
emits (if / if-else / while / call / return). Anything else is an error: a
script either decompiles completely or not at all - never silently wrong.

Semantics the Lua runtime (src/lua/prelude.lua) provides, so the output can
use plain Lua operators where SSL and Lua agree:
  * a + b      string metamethod: a string operand concatenates (CE opAdd)
  * div / mod  truncating integer division / remainder (CE opDivide/opModulo)
  * AND / OR   both operands already evaluated (sslc's and/or never
               short-circuit); used only when the right side has side effects
  * b2i        a comparison used as a value is 0/1, as in CE
Truthiness: SSL treats 0 as false, Lua does not, so value-typed conditions are
written as `x ~= 0`.

Usage:
  python tools/int2lua.py data/scripts/acmynoc.int            # print to stdout
  python tools/int2lua.py -o out_dir data/scripts/*.int       # write out_dir/<name>.lua
"""

import argparse
import glob
import json
import os
import struct
import sys

# ---------------------------------------------------------------------------
# Intrinsic table: opcode -> (ssl name, argc, pushes a result)
# Mirrors src/vm_bridge.ts bridgeOpMap (`--check-bridge` verifies it).
# ---------------------------------------------------------------------------

INTRINSICS = {
    0x80BF: ("dude_obj", 0, True),
    0x80BC: ("self_obj", 0, True),
    0x8128: ("combat_is_initialized", 0, True),
    0x8118: ("get_month", 0, True),
    0x80F6: ("game_time_hour", 0, True),
    0x80EA: ("game_time", 0, True),
    0x80EB: ("game_time_in_seconds", 0, True),
    0x8119: ("get_day", 0, True),
    0x8101: ("cur_map_index", 0, True),
    0x80BD: ("source_obj", 0, True),
    0x80FA: ("action_being_used", 0, True),
    0x80BE: ("target_obj", 0, True),
    0x80F7: ("fixed_param", 0, True),
    0x80B5: ("roll_dice", 2, True),
    0x806B: ("display", 1, False),
    0x811D: ("gsay_end", 0, False),
    0x811F: ("gsay_option", 4, False),
    0x8121: ("giq_option", 5, False),
    0x80A8: ("set_map_start", 4, False),
    0x80B9: ("script_overrides", 0, False),
    0x80B4: ("random", 2, True),
    0x80E1: ("metarule3", 4, True),
    0x80CA: ("get_critter_stat", 2, True),
    0x80CB: ("set_critter_stat", 3, True),
    0x8105: ("message_str", 2, True),
    0x80B8: ("display_msg", 1, False),
    0x810E: ("reg_anim_func", 2, False),
    0x810F: ("reg_anim_animate", 3, False),
    0x8110: ("reg_anim_animate_reverse", 3, False),
    0x8111: ("reg_anim_obj_move_to_obj", 3, False),
    0x8112: ("reg_anim_obj_run_to_obj", 3, False),
    0x8113: ("reg_anim_obj_move_to_tile", 3, False),
    0x8126: ("reg_anim_animate_forever", 2, False),
    0x810C: ("anim", 3, False),
    0x80E7: ("anim_busy", 1, True),
    0x810B: ("metarule", 2, True),
    0x80C1: ("local_var", 1, True),
    0x80C2: ("set_local_var", 2, False),
    0x80C5: ("global_var", 1, True),
    0x80C6: ("set_global_var", 2, False),
    0x80C3: ("map_var", 1, True),
    0x80C4: ("set_map_var", 2, False),
    0x80B2: ("mark_area_known", 3, False),
    0x80E5: ("wm_area_set_pos", 3, False),
    0x80B7: ("create_object_sid", 4, True),
    0x8102: ("critter_add_trait", 4, True),
    0x8106: ("critter_inven_obj", 2, True),
    0x8109: ("inven_cmds", 3, True),
    0x80FF: ("critter_attempt_placement", 3, True),
    0x8127: ("critter_injure", 2, False),
    0x80E8: ("critter_heal", 2, True),
    0x8151: ("critter_is_fleeing", 1, True),
    0x8152: ("critter_set_flee_state", 2, False),
    0x80DA: ("wield_obj_critter", 2, False),
    0x8116: ("add_mult_objs_to_inven", 3, False),
    0x8117: ("rm_mult_objs_from_inven", 3, True),
    0x80D8: ("add_obj_to_inven", 2, False),
    0x80D9: ("rm_obj_from_inven", 2, False),
    0x80DC: ("obj_can_see_obj", 2, True),
    0x80E9: ("set_light_level", 1, False),
    0x8107: ("obj_set_light_level", 3, False),
    0x80E6: ("set_exit_grids", 5, False),
    0x80BB: ("tile_contains_obj_pid", 3, True),
    0x80D3: ("tile_distance_objs", 2, True),
    0x80D2: ("tile_distance", 2, True),
    0x80A7: ("tile_contains_pid_obj", 3, True),
    0x814C: ("rotation_to_tile", 2, True),
    0x814D: ("jam_lock", 1, False),
    0x80AE: ("do_check", 3, True),
    0x814A: ("art_anim", 1, True),
    0x80F4: ("destroy_object", 1, False),
    0x80A9: ("override_map_start", 4, False),
    0x8154: ("debug_msg", 1, False),
    0x80F3: ("has_trait", 3, True),
    0x80C9: ("obj_item_subtype", 1, True),
    0x80BA: ("obj_is_carrying_obj_pid", 2, True),
    0x810D: ("obj_carrying_pid_obj", 2, True),
    0x80B6: ("move_to", 3, True),
    0x8147: ("move_obj_inven_to_obj", 2, False),
    0x8100: ("obj_pid", 1, True),
    0x8104: ("proto_data", 2, True),
    0x80A4: ("obj_name", 1, True),
    0x80A6: ("get_pc_stat", 1, True),
    0x8149: ("obj_art_fid", 1, True),
    0x8150: ("obj_on_screen", 1, True),
    0x80F5: ("obj_can_hear_obj", 2, True),
    0x80E3: ("set_obj_visibility", 2, False),
    0x8130: ("obj_is_open", 1, True),
    0x80C8: ("obj_type", 1, True),
    0x8131: ("obj_open", 1, False),
    0x8132: ("obj_close", 1, False),
    0x812E: ("obj_lock", 1, False),
    0x812F: ("obj_unlock", 1, False),
    0x812D: ("obj_is_locked", 1, True),
    0x80AC: ("roll_vs_skill", 3, True),
    0x80AF: ("is_success", 1, True),
    0x80B0: ("is_critical", 1, True),
    0x80AA: ("has_skill", 2, True),
    0x80AB: ("using_skill", 2, True),
    0x813C: ("critter_mod_skill", 3, True),
    0x80EF: ("critter_dmg", 3, False),
    0x80ED: ("kill_critter", 2, False),
    0x811A: ("explosion", 3, False),
    0x8122: ("poison", 2, False),
    0x8123: ("get_poison", 1, True),
    0x80FD: ("radiation_inc", 2, False),
    0x80FE: ("radiation_dec", 2, False),
    0x826E: ("make_straight_path", 3, True),
    0x826F: ("obj_blocking_at", 3, True),
    # sfall arrays (CE sfall_opcodes.cc; Script methods in src/scripting.ts)
    0x822D: ("create_array", 2, True),
    0x822E: ("set_array", 3, False),
    0x822F: ("get_array", 2, True),
    0x8230: ("free_array", 1, False),
    0x8231: ("len_array", 1, True),
    0x8232: ("resize_array", 2, False),
    0x8233: ("temp_array", 2, True),
    0x8234: ("fix_array", 1, False),
    0x8235: ("string_split", 2, True),
    0x8236: ("list_as_array", 1, True),
    0x8239: ("scan_array", 2, True),
    0x8256: ("array_key", 2, True),
    0x8257: ("arrayexpr", 2, True),
    # other sfall functions the Unofficial Patch uses (CE sfall_opcodes.cc handlers)
    0x81ED: ("abs", 1, True),                        # op_abs
    0x81AC: ("get_ini_setting", 1, True),            # op_get_ini_setting
    0x8261: ("explosions_metarule", 3, True),        # op_explosions_metarule
    0x8206: ("set_self", 1, False),                  # op_set_self
    0x8204: ("get_proto_data", 2, True),             # op_get_proto_data
    0x8205: ("set_proto_data", 3, False),            # op_set_proto_data
    0x8217: ("get_weapon_ammo_pid", 1, True),        # opGetWeaponAmmoPid
    0x8218: ("set_weapon_ammo_pid", 2, False),       # opSetWeaponAmmoPid
    0x8219: ("get_weapon_ammo_count", 1, True),      # opGetWeaponAmmoCount
    0x821A: ("set_weapon_ammo_count", 2, False),     # opSetWeaponAmmoCount
    0x815A: ("set_pc_base_stat", 2, False),          # op_set_pc_base_stat
    0x815B: ("set_pc_extra_stat", 2, False),         # opSetPcBonusStat
    0x815C: ("get_pc_base_stat", 1, True),           # op_get_pc_base_stat
    0x815D: ("get_pc_extra_stat", 1, True),          # opGetPcBonusStat
    0x8271: ("party_member_list", 1, True),          # opPartyMemberList
    0x81F5: ("get_script", 1, True),                 # op_get_script
    0x8172: ("set_world_map_pos", 2, False),         # op_set_world_map_pos
    0x81B6: ("set_car_current_town", 1, False),      # op_set_car_current_town
    0x8164: ("game_loaded", 0, True),                # op_game_loaded
    0x816A: ("set_global_script_repeat", 1, False),  # op_set_global_script_repeat
    0x819B: ("set_global_script_type", 1, False),    # op_set_global_script_type
    0x819D: ("set_sfall_global", 2, False),          # opSetGlobalVar
    0x819E: ("get_sfall_global_int", 1, True),       # opGetGlobalInt
    0x81AF: ("get_game_mode", 0, True),              # opGetGameMode
    0x8162: ("tap_key", 1, False),                   # op_tap_key
    0x8276: ("sfall_func0", 1, True),                # op_sfall_func0 → sfall_metarules.cc, by name
    0x8277: ("sfall_func1", 2, True),
    0x8278: ("sfall_func2", 3, True),
    # sfall functions CE lacks (sfall Opcodes.cpp), used by UPU scripts
    0x815F: ("set_critter_extra_stat", 3, False),
    0x8160: ("get_critter_base_stat", 2, True),
    0x8161: ("get_critter_extra_stat", 2, True),
    0x81F8: ("fs_copy", 2, True),
    0x80A1: ("give_exp_points", 1, False),
    0x8138: ("item_caps_total", 1, True),
    0x8139: ("item_caps_adjust", 2, True),
    0x80FB: ("critter_state", 1, True),
    0x8124: ("party_add", 1, False),
    0x8125: ("party_remove", 1, False),
    0x814B: ("party_member_obj", 1, True),
    0x80EC: ("elevation", 1, True),
    0x80F2: ("game_ticks", 1, True),
    0x811B: ("days_since_visited", 0, True),
    0x8133: ("game_ui_disable", 0, False),
    0x8134: ("game_ui_enable", 0, False),
    0x80F8: ("tile_is_visible", 1, True),
    0x80CF: ("tile_in_tile_rect", 5, True),
    0x80D4: ("tile_num", 1, True),
    0x80D5: ("tile_num_in_direction", 3, True),
    0x80CE: ("animate_move_obj_to_tile", 3, False),
    0x80CC: ("animate_stand_obj", 1, False),
    0x80D0: ("attack_complex", 8, False),
    0x8153: ("terminate_combat", 0, False),
    0x8145: ("use_obj_on_obj", 2, False),
    0x80E4: ("load_map", 2, False),
    0x8115: ("play_gmovie", 1, False),
    0x8146: ("endgame_slideshow", 0, False),
    0x8148: ("endgame_movie", 0, False),
    0x80A3: ("play_sfx", 1, False),
    0x80FC: ("game_time_advance", 1, False),
    0x8137: ("gfade_in", 1, False),
    0x8136: ("gfade_out", 1, False),
    0x810A: ("float_msg", 3, False),
    0x80F0: ("add_timer_event", 3, False),
    0x80F1: ("rm_timer_event", 1, False),
    0x80F9: ("dialogue_system_enter", 0, False),
    0x8129: ("gdialog_mod_barter", 1, False),
    0x80DE: ("start_gdialog", 5, False),
    0x811C: ("gsay_start", 0, False),
    0x811E: ("gsay_reply", 2, False),
    0x80DF: ("end_dialogue", 0, False),
    0x8120: ("gsay_message", 3, False),
    0x80A2: ("scr_return", 1, False),
    0x80A5: ("sfx_build_open_name", 2, True),
    0x80AD: ("skill_contest", 3, True),
    0x80B1: ("how_much", 1, True),
    0x80B3: ("reaction_influence", 3, True),
    0x80C0: ("obj_being_used_with", 0, True),
    0x80C7: ("script_action", 0, True),
    0x80CD: ("animate_stand_reverse_obj", 1, False),
    0x80D1: ("make_daytime", 0, False),
    0x80D6: ("pickup_obj", 1, False),
    0x80D7: ("drop_obj", 1, False),
    0x80DB: ("use_obj", 1, False),
    0x80DD: ("attack_complex", 8, False),
    0x80E2: ("set_map_music", 2, False),
    0x80EE: ("kill_critter_type", 2, False),
    0x8103: ("critter_rm_trait", 4, True),
    0x8108: ("world_map", 0, False),
    0x8114: ("reg_anim_obj_run_to_tile", 3, False),
    0x812A: ("game_difficulty", 0, True),
    0x812B: ("running_burning_guy", 0, True),
    0x812C: ("inven_unwield", 0, False),
    0x8135: ("game_ui_is_disabled", 0, True),
    0x813A: ("anim_action_frame", 2, True),
    0x813B: ("reg_anim_play_sfx", 3, False),
    0x813D: ("sfx_build_char_name", 3, True),
    0x813E: ("sfx_build_ambient_name", 1, True),
    0x813F: ("sfx_build_interface_name", 1, True),
    0x8140: ("sfx_build_item_name", 1, True),
    0x8141: ("sfx_build_weapon_name", 4, True),
    0x8142: ("sfx_build_scenery_name", 3, True),
    0x8143: ("attack_setup", 2, False),
    0x8144: ("destroy_mult_objs", 2, True),
    0x814F: ("combat_difficulty", 0, True),
    0x8155: ("critter_stop_attacking", 1, False),
    0x80E0: ("dialogue_reaction", 1, False),
    0x814E: ("gdialog_set_barter_mod", 1, False),
}

# The opcodes above that take no arguments read an engine value: in SSL they are
# written without parentheses (`self_obj`), and the Lua runtime exposes them the
# same way, as variables resolved on every read.
BUILTIN_VARS = {
    "dude_obj", "self_obj", "source_obj", "target_obj", "fixed_param",
    "action_being_used", "game_time", "game_time_hour", "game_time_in_seconds",
    "cur_map_index", "combat_is_initialized", "get_month", "get_day",
    "obj_being_used_with", "script_action", "game_difficulty", "combat_difficulty",
    "game_ui_is_disabled", "days_since_visited", "running_burning_guy",
}

# Intrinsics without side effects. `a and b` may short-circuit in Lua only when
# skipping b cannot change anything; everything not listed here is assumed to
# have side effects (random() advances the RNG, roll_vs_skill rolls, ...).
PURE = BUILTIN_VARS | {
    "local_var", "global_var", "map_var", "get_critter_stat", "get_pc_stat",
    "obj_can_see_obj", "obj_can_hear_obj", "has_trait", "has_skill", "obj_pid",
    "obj_type", "obj_item_subtype", "obj_name", "obj_art_fid", "art_anim",
    "obj_is_carrying_obj_pid", "obj_carrying_pid_obj", "obj_is_open",
    "obj_is_locked", "obj_on_screen", "tile_num", "tile_distance",
    "tile_distance_objs", "tile_num_in_direction", "tile_is_visible",
    "tile_in_tile_rect", "tile_contains_obj_pid", "tile_contains_pid_obj",
    "rotation_to_tile", "is_success", "is_critical", "critter_state",
    "critter_is_fleeing", "critter_inven_obj", "party_member_obj", "elevation",
    "game_ticks", "message_str", "proto_data", "item_caps_total", "get_poison",
    "anim_busy", "using_skill", "how_much", "anim_action_frame",
}

# Constant arguments that have names: intrinsic -> [(argument, kind)]. "gvar",
# "mvar", "lvar": variable numbers; "pid": a proto id (CE PID values: items,
# critters 0x01xxxxxx, scenery 0x02xxxxxx).
NAMED_ARGS = {
    "global_var": [(0, "gvar")], "set_global_var": [(0, "gvar")],
    "map_var": [(0, "mvar")], "set_map_var": [(0, "mvar")],
    "local_var": [(0, "lvar")], "set_local_var": [(0, "lvar")],
    "create_object_sid": [(0, "pid")], "party_member_obj": [(0, "pid")],
    "obj_is_carrying_obj_pid": [(1, "pid")], "obj_carrying_pid_obj": [(1, "pid")],
    "tile_contains_pid_obj": [(2, "pid")], "tile_contains_obj_pid": [(2, "pid")],
    "kill_critter_type": [(0, "pid")], "proto_data": [(0, "pid")],
}
# define.h / animcomd.h name groups: (prefix, kind), first match wins
ENUM_PREFIXES = [
    ("STAT_", "stat"), ("PCSTAT_", "pcstat"), ("SKILL_", "skill"), ("PERK_", "perk"), ("TRAIT_", "trait"),
    ("OBJECT_", "object"), ("INVEN_TYPE_", "inven"), ("METARULE3_", "metarule3"), ("METARULE_", "metarule"),
    ("FLOAT_MSG_", "float_msg"), ("ANIMATE_ROTATION", "anim"), ("ANIMATE_SET_FRAME", "anim"), ("ANIM_", "anim"),
    ("REG_ANIM_", "reg_anim"), ("DMG_", "dmg"), ("DAM_", "dam"), ("MARK_TYPE_", "mark_type"),
    ("MARK_STATE_", "mark_state"), ("HEAD_", "head"), ("BACKGROUND_", "background"), ("ELEV_", "elev"),
    ("KILL_TYPE_", "kill_type"),
]
ENUM_EXCLUDE = {"STAT_max_stat", "STAT_real_max_stat", "PCSTAT_max_pc_stat"}  # bounds, not values
# Arguments named from those groups: intrinsic -> [(argument, kind)]; the
# trait argument of has_trait / critter_add_trait depends on the trait type
# (TRAIT_KINDS)
ENUM_ARGS = {
    "get_critter_stat": [(1, "stat")], "set_critter_stat": [(1, "stat")], "do_check": [(1, "stat")],
    "get_pc_stat": [(0, "pcstat")],
    "has_skill": [(1, "skill")], "using_skill": [(1, "skill")], "roll_vs_skill": [(1, "skill")],
    "critter_mod_skill": [(1, "skill")],
    "critter_inven_obj": [(1, "inven")],
    "metarule": [(0, "metarule")], "metarule3": [(0, "metarule3")],
    "float_msg": [(2, "float_msg")],
    "anim": [(1, "anim")], "reg_anim_animate": [(1, "anim")], "reg_anim_animate_reverse": [(1, "anim")],
    "reg_anim_animate_forever": [(1, "anim")], "kill_critter": [(1, "anim")],
    "reg_anim_func": [(0, "reg_anim")],
    "critter_dmg": [(2, "dmg")], "critter_injure": [(1, "dam")],
    "mark_area_known": [(0, "mark_type"), (2, "mark_state")],
    "start_gdialog": [(3, "head"), (4, "background")],
    "has_trait": [(0, "trait_type")], "critter_add_trait": [(1, "trait_type")],
    "critter_rm_trait": [(1, "trait_type")],
}
TRAIT_KINDS = {0: "perk", 1: "object", 2: "trait"}
# METARULE_ELEVATOR's argument is an elevator, METARULE3_GET_KILL_COUNT's a kill type
METARULE_ARGS = {("metarule", 15): (1, "elev"), ("metarule3", 103): (1, "kill_type")}
# Lua allows 200 locals in a chunk; names beyond this stay numbers
MAX_NAMED = 180
NAME_ORDER = ("gvar", "mvar", "lvar")  # then the define.h groups, then "pid"

# fallout2-ce interpreter.h procedure flags
PROC_FLAG_TIMED = 0x01
PROC_FLAG_CONDITIONAL = 0x02
PROC_FLAG_IMPORTED = 0x04
PROC_FLAG_EXPORTED = 0x08
PROC_FLAG_CRITICAL = 0x10

OP_PUSH_INT = 0xC001
OP_PUSH_FLOAT = 0xA001
OP_PUSH_STRING = 0x9001

OP_CRITICAL_START = 0x8002
OP_CRITICAL_DONE = 0x8003
OP_JUMP = 0x8004
OP_CALL = 0x8005
OP_DETACH = 0x800F
OP_A_TO_D = 0x800C
OP_D_TO_A = 0x800D
OP_EXIT_PROG = 0x8010
OP_FETCH_GLOBAL = 0x8012
OP_STORE_GLOBAL = 0x8013
OP_FETCH_EXTERNAL = 0x8014
OP_STORE_EXTERNAL = 0x8015
OP_EXPORT_VAR = 0x8016
OP_EXPORT_PROC = 0x8017
OP_SWAPA = 0x8019
OP_POP = 0x801A
OP_POP_RETURN = 0x801C
OP_CHECK_ARGS = 0x8027
OP_LOOKUP_PROC = 0x8028
OP_POP_BASE = 0x8029
OP_POP_TO_BASE = 0x802A
OP_PUSH_BASE = 0x802B
OP_SET_GLOBAL = 0x802C
OP_IF = 0x802F
OP_WHILE = 0x8030
OP_STORE = 0x8031
OP_FETCH = 0x8032

# CE interpreter_lib.cc opSayStart ... opSayMessage: the interpreter library's
# own dialogue windows, which Fallout 2 replaced with gdialog (gsay_*). Only
# Fallout 1 leftovers that no scripts.lst entry names use them (barstow, dumar,
# surf), and neither the VM nor the Lua runtime implements them.
SAY_OPS = set(range(0x804C, 0x8062))

# operator opcodes -> (SSL operator, Lua operator, Lua precedence, kind)
COMPARE = {
    0x8033: "==", 0x8034: "~=", 0x8035: "<=", 0x8036: ">=", 0x8037: "<", 0x8038: ">",
}
ARITH = {0x8039: "+", 0x803A: "-", 0x803B: "*"}
BITWISE = {0x8040: "&", 0x8041: "|", 0x8042: "~"}

# Lua 5.4 operator precedence (higher binds tighter)
PREC = {
    "or": 1, "and": 2,
    "<": 3, ">": 3, "<=": 3, ">=": 3, "~=": 3, "==": 3,
    "|": 4, "~": 5, "&": 6, "..": 9, "+": 10, "-": 10, "*": 11,
}
PREC_UNARY = 12
PREC_ATOM = 100

LUA_KEYWORDS = {
    "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
    "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return", "then",
    "true", "until", "while",
}
# Names the runtime defines for the generated code; a script identifier with one
# of these names is renamed like a Lua keyword.
RUNTIME_NAMES = {"div", "mod", "AND", "OR", "b2i", "floor", "import", "export", "entry", "call", "exit",
                 "recursion_guard"}


# ---------------------------------------------------------------------------
# Variable names: vault13.gam names the global variables (GVAR_*), a map's
# <map>.gam its map variables (MVAR_*), one `NAME :=value;` line per variable
# in number order (CE gameLoadGlobalVars / mapLoadMapVars read the values the
# same way, by position).
# ---------------------------------------------------------------------------

_gam_cache = {}


def read_gam(path, section):
    """[name, ...] in variable-number order from a .gam file, or None."""
    import re
    key = (os.path.normcase(os.path.abspath(path)), section)
    if key in _gam_cache:
        return _gam_cache[key]
    names = None
    if os.path.exists(path):
        names = []
        inside = False
        with open(path, encoding="latin-1") as fh:
            for line in fh:
                code = line.split("//")[0].strip()
                if code.endswith(":") and ":=" not in code:
                    inside = code[:-1].strip() == section
                    continue
                m = re.match(r"([A-Za-z_]\w*)\s*:=", code)
                if inside and m:
                    names.append(m.group(1))
    _gam_cache[key] = names
    return names


# Operands the compiler left out of a script, restored from its source: (script,
# procedure) -> (value, name, why). mitoilet description_p_proc compiles
# `set_local_var(LVAR_Examined, true)` without the variable number, so the
# bytecode pops the word below its frame: in CE the program's windowId that
# _setupCallWithReturnVal pushed, 0 for a game script (src/vm.ts pushes the same)
# — the source's LVAR_Examined (0).
MISSING_OPERANDS = {
    ("mitoilet", "description_p_proc"): (0, "LVAR_Examined",
                                         "the .int lacks this set_local_var argument; mitoilet.ssl has LVAR_Examined (0), and CE takes the windowId, 0"),
}

# Script fixes: deliberate deviations from the shipped bytecode (and from CE), for
# Black Isle bugs whose intent the sources make clear. Each is switchable at run
# time ([dh2] script_fixes, Script.dh2_script_fixes; off = the original
# behaviour), marked in the generated Lua, and listed in wiki/lua_scripts.md
# ("Script fixes") and wiki/known_bugs.md. (script, procedure) -> {intrinsic:
# (local variable the bytecode passes by mistake, Lua expression the source meant,
# note)}.
#
# L7 bhrnddst DMRV_Caravan: Black Isle's source gives each caravan guard
# `give_money(Critter, item)` -- `item` holds the hunting rifle Create_Enemy just
# made (LVar3), so the bytecode passes the weapon object as the caps amount, with
# and without Fortune Finder (CE multiplies the pointer's bits: a garbage amount).
# The Unofficial Patch (scripts_src/maps/bhrnddst.ssl) gives random(10, 20), the
# guards' amount in DMRV_Highwaymen.
SCRIPT_FIXES = {
    ("bhrnddst", "dmrv_caravan"): {
        "item_caps_adjust": ("LVar3", "random(10, 20)",
                             "DH2 fix (L7): the .int passes the guard's rifle object; Unofficial Patch: random(10, 20)"),
    },
}


# Other #defines that name a variable number, used only for a number nothing else
# names: define.h's caught_pickpocket counts thefts in local_var(NPC_REACTION_VAR)
# (fcmarc: 8); the emitter scripts notify through map_var(MAP_NOTIFY) /
# global_var(GLOBAL_NOTIFY). -1, their defaults, means none (behind `if (X > -1)`).
VAR_DEFINES = {"NPC_REACTION_VAR": "LVAR_", "MAP_NOTIFY": "MVAR_", "GLOBAL_NOTIFY": "GVAR_"}

# Names no source gives, chosen by hand: (script, kind, number) -> (name, status,
# why). "inferred": the script's code for that variable only runs on one map,
# whose .gam names it. "guessed": from what the code does with it (scripts no
# map uses: the cut Colusa/Navarro guards, test1).
CURATED_NAMES = {
    ("mcatkdog", "mvar", 0): ("MVAR_Did_Fake_Dog_Kill", "inferred",
                              "maps/modbrah.gam; used only under cur_map_index == 20 (modbrah)"),
}
for _s in ("ccguard", "cctech", "ccmaster", "test1"):
    CURATED_NAMES[(_s, "lvar", 5)] = ("LVAR_Hostile", "guessed",
                                      "the template's number; 2 after a theft, then attacks on sight")
    CURATED_NAMES[(_s, "lvar", 6)] = ("LVAR_Personal_Enemy", "guessed",
                                      "the template's number; set when the player damages the critter")
for _s in ("ccguard", "cctech", "ccmaster"):
    CURATED_NAMES[(_s, "lvar", 1)] = ("LVAR_reaction_level", "guessed",
                                      "modreact.h's number; set to +4 / -4 (REACTION_LEVEL_EXCELLENT / ABYSMAL)")
    CURATED_NAMES[(_s, "lvar", 3)] = ("LVAR_base_reaction", "guessed",
                                      "modreact.h's number; set to +100 / -100 with LVAR 1")
    CURATED_NAMES[(_s, "mvar", 2)] = ("MVAR_Alert_Status", "guessed",
                                      "0-4, the dialogue branches on it; 4 once the player attacks or is exposed (\"GUARDS!\")")
    CURATED_NAMES[(_s, "mvar", 3)] = ("MVAR_Claimed_New_Guy", "guessed",
                                      "set to 1 when the player claims to be the new guy (ccmaster Node027)")
CURATED_NAMES[("ccmaster", "lvar", 8)] = ("LVAR_Refuse_Talk", "guessed",
                                          "never set (always 0); when 1, talking only gives a float message")
CURATED_NAMES[("ccmaster", "lvar", 9)] = ("LVAR_Asked_If_New_Guy", "guessed",
                                          "set at the first Node004 (\"You the guy Arch radioed about?\"), then reply 111")

# SslNames.for_script: an .ssl whose tree lacks at most this many of the .int's
# procedures is taken as another version of the same script (names marked inferred)
NEAR_MATCH_PROCS = 3


class SslNames:
    """Names from one tree of SSL script sources (<dir>/<name>.ssl anywhere
    below, headers/*.h; see ssl_sources). A script's own .ssl and the headers it
    #includes name its local variables (LVAR_*) and the map variables it uses
    (MVAR_*); itempid.h, critrpid.h and scenepid.h name the PIDs. Sources may be
    of another game version, so a script's names are only used when every
    procedure of the vanilla .int is also in its .ssl."""

    def __init__(self, root):
        import re
        self.re = re
        self.files = {}  # lower-case relative path -> path, for case-insensitive #include
        self.by_base = {}  # lower-case file name -> path (an #include into a folder the tree lacks)
        self.ssl = {}    # script name -> .ssl path
        for d, _sub, names in os.walk(root):
            for n in names:
                p = os.path.join(d, n)
                self.files[os.path.relpath(p, root).replace("\\", "/").lower()] = p
                self.by_base.setdefault(n.lower(), p)
                if n.lower().endswith(".ssl"):
                    self.ssl.setdefault(n[:-4].lower(), p)
        self.root = root
        self.cache = {}
        self.pids = {}
        for h in ("itempid.h", "critrpid.h", "scenepid.h"):
            p = self.files.get("headers/" + h)
            for name, value in (self.read(p)["defines"] if p else []):
                if name.startswith("PID_"):
                    self.pids.setdefault(value, name)
        # define.h / animcomd.h constants by prefix (ENUM_PREFIXES); a value two
        # names share in one group (HEAD_MARCUS, HEAD_OVERSEER) stays a number
        self.enums = {}
        for h in ("define.h", "animcomd.h"):
            p = self.files.get("headers/" + h)
            for name, value in (self.read(p)["defines"] if p else []):
                for prefix, kind in ENUM_PREFIXES:
                    if name.startswith(prefix) and name not in ENUM_EXCLUDE:
                        self.enums.setdefault(kind, {}).setdefault(value, set()).add(name)
                        break
        self.enums = {k: {v: ns.pop() for v, ns in t.items() if len(ns) == 1} for k, t in self.enums.items()}
        # has_trait / critter_add_trait type (CE interpreter_extra.cc CRITTER_TRAIT_*;
        # the headers use these names but sslc defines them)
        self.enums["trait_type"] = {0: "TRAIT_PERK", 1: "TRAIT_OBJECT", 2: "TRAIT_TRAIT"}

    def resolve(self, base, inc):
        # Black Isle's sources write `#include "..\headers\define.h"`
        inc = inc.replace("\\", "/")
        p = os.path.normpath(os.path.join(os.path.dirname(base), inc))
        if os.path.exists(p):
            return p
        rel = os.path.relpath(p, self.root).replace("\\", "/").lower()
        # the Fallout wiki's tree keeps generic/*.ssl (ziLocker.ssl) in scripts/:
        # the file of that name anywhere in the tree
        return self.files.get(rel) or self.by_base.get(os.path.basename(inc).lower())

    def read(self, path):
        """One file: its (name, number) #defines, procedures and #includes."""
        if path in self.cache:
            return self.cache[path]
        re = self.re
        # includes: paths, or ("macro", NAME) for `#include NAME` (ziLocker.ssl's
        # EXTRA_HEADER, a string #define of the script that includes it)
        out = {"defines": [], "procs": set(), "includes": [], "strings": {}, "aliases": {}, "prefixes": set(), "words": set()}
        self.cache[path] = out
        with open(path, encoding="latin-1") as fh:
            for line in fh:
                # /* ... */ on the line, and a /* the line leaves open (`#define MAP_NOTIFY
                # (-1) /* use this macro ...` goes on below)
                code = re.sub(r"/\*.*?(\*/|$)", "", line.split("//")[0])
                out["words"].update(re.findall(r"[A-Za-z_]\w*", code))
                m = re.match(r'\s*#\s*include\s+"([^"]+)"', code)
                if m:
                    inc = self.resolve(path, m.group(1))
                    if inc:
                        out["includes"].append(inc)
                    continue
                m = re.match(r'\s*#\s*include\s+([A-Za-z_]\w*)\s*$', code)
                if m:
                    out["includes"].append(("macro", m.group(1)))
                    continue
                m = re.match(r'\s*#\s*define\s+([A-Za-z_]\w*)\s+"([^"]+)"', code)
                if m:
                    out["strings"][m.group(1)] = (path, m.group(2))
                    continue
                m = re.match(r"\s*#\s*define\s+([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*$", code)
                if m:  # `#define description_p_proc def_description_p_proc`: a procedure's real name
                    out["aliases"][m.group(1).lower()] = m.group(2).lower()
                    continue
                m = re.match(r"\s*#\s*define\s+([A-Za-z_]\w*)\s+\(?\s*(-?\d+)\s*\)?\s*$", code)
                if m:
                    out["defines"].append((m.group(1), int(m.group(2))))
                    continue
                m = re.match(r"\s*procedure\s+([A-Za-z_]\w*)##", code)
                if m:  # a macro template (`procedure NOdds##name##x`): names starting so
                    out["prefixes"].add(m.group(1).lower())
                m = re.match(r"\s*procedure\s+([A-Za-z_]\w*)", code)
                if m:
                    out["procs"].add(m.group(1).lower())
                # a procedure the source calls exists in the program, even when a
                # macro makes it (zcCrpDel.ssl: `procedure check_Num_##number`)
                for c in re.findall(r"\bcall\s+([A-Za-z_]\w*)", code):
                    out["procs"].add(c.lower())
        return out

    def for_script(self, name, int_procs):
        """{"lvar": {n: name}, "mvar": {n: name}, "source": str, "inferred": bool} for one
        script, or None. Names come from the script's .ssl and its #includes when every
        procedure of the vanilla .int is in them (the sources may be of another game
        version). With a few procedures missing (NEAR_MATCH_PROCS: another version of the
        same script) the names are still used, marked inferred. A number two names share
        keeps the one the script's own .ssl defines (ricshbox: LVAR_Restock_Time, not
        modreact.h's LVAR_reaction), else the one its .ssl mentions, else it stays a number."""
        path = self.ssl.get(name.lower())
        if not path:
            return None
        procs, found, prefixes = self.collect(path)
        missing = sorted(p for p in set(x.lower() for x in int_procs) - procs
                         if not any(p.startswith(pre) for pre in prefixes))
        if len(missing) > NEAR_MATCH_PROCS:
            return None
        own = {n for n, _v in self.read(path)["defines"]}
        mentioned = self.read(path)["words"]

        def pick(table):
            out = {}
            for v, ns in table.items():
                if len(ns) > 1:
                    # the script's own define, else the one its .ssl mentions (wtpltrp2:
                    # depolva.h names 77 twice, the trap uses MVAR_Plasma_Trap_L2_00)
                    ns = (ns & own) or (ns & mentioned)
                if len(ns) == 1:
                    out[v] = next(iter(ns))
            return out
        tree = os.path.basename(self.root)
        src = "%s/%s" % (tree, os.path.relpath(path, self.root).replace("\\", "/"))
        return {"lvar": pick(found["LVAR_"]), "mvar": pick(found["MVAR_"]), "gvar": pick(found["GVAR_"]),
                "inferred": bool(missing),
                "source": src + (" (near match: the .int also has %s)" % ", ".join(missing) if missing else "")}

    def collect(self, path):
        """An .ssl and everything it #includes: (procedure names, {"LVAR_": {n:
        {names}}, "MVAR_": ...}, procedure-name template prefixes)."""
        seen, todo, procs = set(), [path], set()
        found = {"LVAR_": {}, "MVAR_": {}, "GVAR_": {}}
        extra = {}  # VAR_DEFINES: only for a number no LVAR_ / MVAR_ define names
        strings = {}  # string #defines seen so far, for `#include NAME`
        aliases = {}  # `#define x y`: procedure x compiles as y
        prefixes = set()  # procedure name templates (`procedure NOdds##...`)
        while todo:
            p = todo.pop()
            if isinstance(p, tuple):
                where = strings.get(p[1])
                p = self.resolve(where[0], where[1]) if where else None
                if not p:
                    continue
            if p in seen:
                continue
            seen.add(p)
            f = self.read(p)
            procs |= f["procs"]  # headers define procedures too (checkPartyMembersNearDoor)
            aliases.update(f["aliases"])
            prefixes |= f["prefixes"]
            strings.update(f["strings"])
            for n, v in f["defines"]:
                for prefix in ("LVAR_", "MVAR_"):  # GVAR names come from vault13.gam
                    if n.startswith(prefix):
                        found[prefix].setdefault(v, set()).add(n)
                if n in VAR_DEFINES:
                    extra.setdefault(VAR_DEFINES[n], {}).setdefault(v, set()).add(n)
            todo.extend(reversed(f["includes"]))  # in file order
        procs |= {aliases[p] for p in procs if p in aliases}
        for prefix, table in extra.items():
            for v, ns in table.items():
                found[prefix].setdefault(v, ns)
        return procs, found, prefixes


class MsgTexts:
    """Message texts for comments: message list n is the script on line n of
    data/scripts/scripts.lst (src/data.ts lookupScriptName), its texts in
    data/text/english/dialog/<script>.msg as {number}{speech}{text}."""

    # message references with constant numbers in a generated line: (list, number)
    REFS = [r"\bmessage_str\((\d+), (\d+)\)", r"\bgsay_reply\((\d+), (\d+)\)",
            r"\bgsay_message\((\d+), (\d+),", r"\bgsay_option\((\d+), (\d+),",
            r"\bgiq_option\(-?\d+, (\d+), (\d+),"]
    MAX_TEXT = 70

    def __init__(self, root):
        import re
        self.re = re
        self.dir = os.path.join(root, "text", "english", "dialog")
        self.lst = []
        lst = os.path.join(root, "scripts", "scripts.lst")
        if os.path.exists(lst):
            with open(lst, encoding="latin-1") as fh:
                self.lst = [line.split(".")[0].strip().lower() for line in fh if line.strip()]
        self.files = {}

    def text(self, list_no, num):
        if not (1 <= list_no <= len(self.lst)):
            return None
        name = self.lst[list_no - 1]
        if name not in self.files:
            texts = {}
            path = os.path.join(self.dir, name + ".msg")
            if os.path.exists(path):
                with open(path, encoding="latin-1") as fh:
                    body = fh.read()
                for m in self.re.finditer(r"\{(\d+)\}\{[^}]*\}\{([^}]*)\}", body):
                    texts[int(m.group(1))] = " ".join(m.group(2).split())
            self.files[name] = texts
        return self.files[name].get(num)

    def comment(self, line):
        """The texts a line refers to, as a trailing comment ("" if none)."""
        out = []
        for pattern in self.REFS:
            for m in self.re.finditer(pattern, line):
                t = self.text(int(m.group(1)), int(m.group(2)))
                if t is None:
                    continue
                if len(t) > self.MAX_TEXT:
                    t = t[:self.MAX_TEXT - 1].rstrip() + "…"
                if t not in out:
                    out.append(t)
        return ("  -- " + " / ".join(lua_string(t) for t in out)) if out else ""


_msg_cache = {}


def msg_texts(root):
    root = os.path.normcase(os.path.abspath(root))
    if root not in _msg_cache:
        _msg_cache[root] = MsgTexts(root)
    return _msg_cache[root]


def ssl_sources(root):
    """The SSL source trees an install has, best first: ssl/ next to data/
    (Black Isle's own sources, e.g. from the Fallout wiki's script library;
    scripts in ssl/scripts/, headers in ssl/headers/), then data/scripts_src/
    (the Unofficial Patch's, which renumbers some scripts' LVARs)."""
    trees = [ssl_names(os.path.join(os.path.dirname(root), "ssl")), ssl_names(os.path.join(root, "scripts_src"))]
    return [t for t in trees if t is not None]


def upu_ssl_tree(root):
    """The Unofficial Patch's (UPU) own script sources, when fetched into
    third_party/upu_src/scripts_src (wiki/upu_support.md), else None."""
    return ssl_names(os.path.join(os.path.dirname(root), "third_party", "upu_src", "scripts_src"))


_mod_sources_cache = {}


def script_from_mod(root, name):
    """Whether tools/setup.py took data/scripts/<name>.int from a mod archive
    (data/mod_sources.json: "mods/upu.dat", ...) rather than the vanilla data."""
    key = os.path.normcase(os.path.abspath(root))
    if key not in _mod_sources_cache:
        try:
            with open(os.path.join(root, "mod_sources.json"), encoding="utf-8") as fh:
                _mod_sources_cache[key] = json.load(fh)
        except (OSError, ValueError):
            _mod_sources_cache[key] = {}
    return _mod_sources_cache[key].get("scripts/%s.int" % name, "").startswith("mods/")


def script_ssl_sources(root, name):
    """ssl_sources for one script: a script the pipeline took from a mod archive
    (data/mod_sources.json, tools/setup.py) reads the UPU tree first, as its .int was
    compiled from it; the vanilla scripts keep Black Isle's, then killap's."""
    trees = ssl_sources(root)
    upu = upu_ssl_tree(root) if script_from_mod(root, name) else None
    return [upu] + trees if upu is not None else trees


_ssl_cache = {}


def ssl_names(root):
    root = os.path.normcase(os.path.abspath(root))
    if root not in _ssl_cache:
        _ssl_cache[root] = SslNames(root) if os.path.isdir(root) else None
    return _ssl_cache[root]


class DecompileError(Exception):
    pass


class LeftoverConst(DecompileError):
    """A constant nobody consumed: an unused procedure-local variable."""


def lua_name(name):
    if name in LUA_KEYWORDS or name in RUNTIME_NAMES:
        return name + "_"
    return name


def lua_string(s):
    out = ['"']
    for ch in s:
        o = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif o < 32 or o == 127:
            out.append("\\%03d" % o)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


# ---------------------------------------------------------------------------
# .int file parsing (layout as in src/intfile.ts / CE interpreter.cc
# programCreateByName: 42-byte header, procedure table, identifier table,
# 0xFFFFFFFF, string table, code)
# ---------------------------------------------------------------------------

class Procedure:
    def __init__(self, index, name, flags, offset, argc):
        self.index = index
        self.name = name
        self.flags = flags
        self.offset = offset
        self.argc = argc


class IntFile:
    def __init__(self, data, name):
        self.data = data
        self.name = name
        off = 0x2A
        (count,) = struct.unpack_from(">I", data, off)
        off += 4
        raw = []
        for i in range(count):
            name_i, flags, _time, _cond, offset, argc = struct.unpack_from(">6I", data, off)
            off += 24
            raw.append((i, name_i, flags, offset, argc))
        self.identifiers, off = self._table(off)
        (sig,) = struct.unpack_from(">I", data, off)
        if sig != 0xFFFFFFFF:
            raise DecompileError("missing 0xFFFFFFFF after identifier table")
        off += 4
        self.strings, off = self._table(off)
        self.code_start = off
        self.procs = [Procedure(i, self.identifiers[n], f, o, a) for (i, n, f, o, a) in raw]
        self.proc_names = set(p.name for p in self.procs)

    def _table(self, off):
        (size,) = struct.unpack_from(">I", self.data, off)
        off += 4
        table = {}
        if size == 0xFFFFFFFF:
            return table, off
        base = off
        while off - base < size:
            (ln,) = struct.unpack_from(">H", self.data, off)
            off += 2
            table[off - base + 4] = self.data[off:off + ln].split(b"\0")[0].decode("latin-1")
            off += ln
        return table, off

    def instr(self, pc):
        """(opcode, operand or None, next pc)"""
        if pc + 2 > len(self.data):
            raise DecompileError("code runs past end of file at 0x%x" % pc)
        (op,) = struct.unpack_from(">H", self.data, pc)
        if op in (OP_PUSH_INT, OP_PUSH_STRING):
            (v,) = struct.unpack_from(">i", self.data, pc + 2)
            return op, v, pc + 6
        if op == OP_PUSH_FLOAT:
            (v,) = struct.unpack_from(">f", self.data, pc + 2)
            return op, v, pc + 6
        return op, None, pc + 2


# ---------------------------------------------------------------------------
# Expression tree
# kind: "bool" (Lua boolean), "num", "str", "any" (an SSL value of unknown type)
# ---------------------------------------------------------------------------

class Expr:
    kind = "any"
    pure = True
    prec = PREC_ATOM
    pc = None  # offset of the first instruction that produced this value


class Const(Expr):
    def __init__(self, value, is_float=False):
        self.value = value
        self.is_float = is_float
        self.kind = "num"

    def lua(self):
        if self.is_float:
            r = repr(float(self.value))
            if "inf" in r or "nan" in r:
                raise DecompileError("non-finite float literal")
            return r
        return str(self.value)

    @property
    def prec(self):
        return PREC_UNARY if (not self.is_float and self.value < 0) or (self.is_float and self.value < 0) else PREC_ATOM


class Str(Expr):
    def __init__(self, value):
        self.value = value
        self.kind = "str"

    def lua(self):
        return lua_string(self.value)


class Name(Expr):
    def __init__(self, name):
        self.name = name

    def lua(self):
        return self.name


class NamedConst(Expr):
    """A number with a name from the .gam / .ssl files (GVAR_ENEMY_ARROYO). It
    becomes the name when the script declares it (ScriptDecompiler.emit declares
    as many as Lua's local limit allows), else the number. Some expressions are
    rendered to text during decompilation, before that is known, so lua() leaves
    a marker that emit() resolves (NAMED_MARK)."""

    def __init__(self, name, value, script):
        self.name = name
        self.value = value
        self.script = script
        self.kind = "num"

    def lua(self):
        return "\x01%s\x02%d\x03" % (self.name, self.value)


NAMED_MARK = "\x01([A-Za-z_]\\w*)\x02(-?\\d+)\x03"


class ProcRef(Expr):
    """A procedure used as a value (dialogue option targets)."""

    def __init__(self, name):
        self.name = name

    def lua(self):
        return lua_name(self.name)


class Call(Expr):
    def __init__(self, name, args, pure, is_builtin_var=False):
        self.name = name
        self.args = args
        self.pure = pure and all(a.pure for a in args)
        self.is_builtin_var = is_builtin_var
        self.kind = "str" if name in ("message_str", "obj_name") else "any"

    def lua(self):
        if self.is_builtin_var:
            return self.name
        return "%s(%s)" % (lua_name(self.name), ", ".join(value(a).lua() for a in self.args))


class Raw(Expr):
    """Already-rendered Lua text."""

    def __init__(self, text, kind="any", prec=PREC_ATOM, pure=True):
        self.text = text
        self.kind = kind
        self.prec = prec
        self.pure = pure

    def lua(self):
        return self.text


class BinOp(Expr):
    def __init__(self, op, a, b, kind):
        self.op = op
        self.a = a
        self.b = b
        self.kind = kind
        self.prec = PREC[op]
        self.pure = a.pure and b.pure

    def lua(self):
        # Lua's comparison and arithmetic operators are left associative; `..`
        # is not used here. The right operand needs parentheses at equal
        # precedence (a - (b - c)).
        return "%s %s %s" % (paren(self.a, self.prec), self.op, paren(self.b, self.prec + 1))


class Not(Expr):
    def __init__(self, a):
        self.a = a
        self.kind = "bool"
        self.prec = PREC_UNARY
        self.pure = a.pure

    def lua(self):
        return "not " + paren(self.a, PREC_UNARY)


class Neg(Expr):
    def __init__(self, a):
        self.a = a
        self.kind = "num"
        self.prec = PREC_UNARY
        self.pure = a.pure

    def lua(self):
        inner = paren(self.a, PREC_UNARY)
        # "- -x" would read as a comment start
        return "-" + (" " + inner if inner.startswith("-") else inner)


def paren(e, min_prec):
    s = e.lua()
    return "(%s)" % s if e.prec < min_prec else s


def cond(e):
    """e as a Lua boolean (SSL: 0 is false)."""
    if e.kind == "bool":
        return e
    if isinstance(e, Const):
        return Raw("true" if e.value != 0 else "false", "bool")
    return BinOp("~=", e, Const(0), "bool")


def value(e):
    """e as an SSL value (a comparison becomes 0/1)."""
    if e.kind == "bool":
        return Raw("b2i(%s)" % e.lua(), "num", PREC_ATOM, e.pure)
    return e


def logical(op, a, b):
    # sslc evaluates both operands of and/or before opAnd/opOr. Lua's and/or
    # skip the right side, so they are only used when skipping it is harmless.
    if b.pure:
        return BinOp(op, cond(a), cond(b), "bool")
    helper = "AND" if op == "and" else "OR"
    return Raw("%s(%s, %s)" % (helper, value(a).lua(), value(b).lua()), "bool", PREC_ATOM, False)


# ---------------------------------------------------------------------------
# Statements
# ---------------------------------------------------------------------------

class Stmt:
    pass


class Assign(Stmt):
    def __init__(self, target, expr):
        self.target = target
        self.expr = expr


class ExprStmt(Stmt):
    def __init__(self, expr):
        self.expr = expr


class If(Stmt):
    def __init__(self, test, then, orelse):
        self.test = test
        self.then = then
        self.orelse = orelse


class While(Stmt):
    def __init__(self, test, body):
        self.test = test
        self.body = body


class Return(Stmt):
    def __init__(self, expr):
        self.expr = expr


class Exit(Stmt):
    pass


# ---------------------------------------------------------------------------
# Procedure decompilation
# ---------------------------------------------------------------------------

RETURN_TAIL = [OP_SWAPA, OP_POP_TO_BASE, OP_POP_BASE, OP_A_TO_D, OP_POP_RETURN]
PROC_END = [OP_POP_TO_BASE, OP_POP_BASE, OP_POP_RETURN]


class ProcDecompiler:
    def __init__(self, script, proc, end):
        self.s = script
        self.f = script.f
        self.proc = proc
        self.end = end
        self.argc = proc.argc
        # linear instruction list (sslc never puts data in code)
        self.ins = []
        self.at = {}
        pc = proc.offset
        while pc < end:
            op, arg, nxt = self.f.instr(pc)
            self.at[pc] = len(self.ins)
            self.ins.append((pc, op, arg, nxt))
            pc = nxt
        if pc != end:
            raise DecompileError("%s: instructions overrun the procedure end" % proc.name)
        self.nlocals = 0
        self.returns_value = False

    def local_name(self, i):
        if i < self.argc:
            return "arg%d" % i
        return "LVar%d" % (i - self.argc)

    def run(self):
        f = self.f
        if not self.ins or self.ins[0][1] != OP_PUSH_BASE:
            raise DecompileError("%s: does not start with push_base" % self.proc.name)
        # the implicit `return 0` epilogue every procedure ends with
        tail_ops = [i[1] for i in self.ins[-len(PROC_END):]]
        if tail_ops != PROC_END:
            raise DecompileError("%s: missing procedure epilogue" % self.proc.name)
        body_end = self.ins[-len(PROC_END)][0]

        # procedure-local variables: their initial values are pushed right after
        # push_base. The highest variable index used gives the count; a local
        # nobody uses shows up as a constant left on the stack, so retry with
        # one more until the body balances.
        top = -1
        for (_pc, op, _arg, _nxt), prev in zip(self.ins[1:], self.ins[:-1]):
            if op in (OP_FETCH, OP_STORE) and prev[1] == OP_PUSH_INT:
                top = max(top, prev[2])
        n = max(0, top + 1 - self.argc)
        while True:
            try:
                body = self.with_locals(n, body_end)
                break
            except LeftoverConst:
                n += 1
                if n > 64:
                    raise DecompileError("%s: cannot balance the local variables" % self.proc.name)
        # drop the trailing explicit `return 0` sslc adds before the epilogue
        if body and isinstance(body[-1], Return) and isinstance(body[-1].expr, Const) \
                and body[-1].expr.value == 0 and not body[-1].expr.is_float:
            body.pop()
        return body

    def with_locals(self, n, body_end):
        self.nlocals = n
        self.local_inits = []
        k = 1
        for i in range(n):
            if k >= len(self.ins):
                raise DecompileError("%s: missing local variable initialisers" % self.proc.name)
            pc, op, arg, nxt = self.ins[k]
            if op == OP_PUSH_INT:
                self.local_inits.append(Const(arg))
            elif op == OP_PUSH_FLOAT:
                self.local_inits.append(Const(arg, True))
            elif op == OP_PUSH_STRING:
                self.local_inits.append(Str(self.s.string(arg)))
            else:
                raise DecompileError("%s: local variable %d has no constant initialiser" % (self.proc.name, i))
            k += 1
        start = self.ins[k][0] if k < len(self.ins) else body_end
        return self.region(start, body_end)

    # -- helpers ----------------------------------------------------------
    def ops_at(self, pc, n):
        i = self.at.get(pc)
        if i is None:
            return None
        return [x[1] for x in self.ins[i:i + n]]

    def prev_ins(self, pc, back=1):
        i = self.at.get(pc)
        if i is None or i - back < 0:
            return None
        return self.ins[i - back]

    def region(self, start, end):
        """Decompile [start, end) into a statement list; the stack starts and ends empty."""
        if start != end and start not in self.at:
            raise DecompileError("%s: region start 0x%x is not an instruction" % (self.proc.name, start))
        out = []
        stack = []
        pending_ret = []  # return addresses pushed by d_to_a for calls in flight

        def emit(stmt):
            self.flush(stack, out, pc)
            out.append(stmt)

        pc = start
        while pc < end:
            i = self.at[pc]
            _pc, op, arg, nxt = self.ins[i]

            if op == OP_PUSH_INT:
                e = Const(arg)
                e.pc = pc
                stack.append(e)
            elif op == OP_PUSH_FLOAT:
                e = Const(arg, True)
                e.pc = pc
                stack.append(e)
            elif op == OP_PUSH_STRING:
                nop = self.ins[i + 1][1] if i + 1 < len(self.ins) else None
                if nop in (OP_FETCH_EXTERNAL, OP_STORE_EXTERNAL, OP_EXPORT_VAR):
                    e = Name(self.s.ident(arg))
                else:
                    e = Str(self.s.string(arg))
                e.pc = pc
                stack.append(e)

            elif op in (OP_CRITICAL_START, OP_CRITICAL_DONE):
                pass

            elif op in COMPARE:
                b, a = self.pop(stack, pc), self.pop(stack, pc)
                # obj_pid(x) == 16777278 -> obj_pid(x) == PID_SULIK
                if isinstance(a, Call) and a.name == "obj_pid":
                    b = self.s.name_const("pid", b)
                elif isinstance(b, Call) and b.name == "obj_pid":
                    a = self.s.name_const("pid", a)
                self.push(stack, BinOp(COMPARE[op], value(a), value(b), "bool"), a)
            elif op in ARITH:
                b, a = self.pop(stack, pc), self.pop(stack, pc)
                kind = "str" if "str" in (a.kind, b.kind) and op == 0x8039 else "any"
                self.push(stack, BinOp(ARITH[op], value(a), value(b), kind), a)
            elif op == 0x803C or op == 0x803D:
                b, a = self.pop(stack, pc), self.pop(stack, pc)
                fn = "div" if op == 0x803C else "mod"
                self.push(stack, Raw("%s(%s, %s)" % (fn, value(a).lua(), value(b).lua()), "any",
                                     PREC_ATOM, a.pure and b.pure), a)
            elif op in BITWISE:
                b, a = self.pop(stack, pc), self.pop(stack, pc)
                self.push(stack, BinOp(BITWISE[op], value(a), value(b), "num"), a)
            elif op == 0x8043:  # bwnot
                a = self.pop(stack, pc)
                self.push(stack, Raw("~" + paren(value(a), PREC_UNARY), "num", PREC_UNARY, a.pure), a)
            elif op == 0x803E:
                b, a = self.pop(stack, pc), self.pop(stack, pc)
                self.push(stack, logical("and", a, b), a)
            elif op == 0x803F:
                b, a = self.pop(stack, pc), self.pop(stack, pc)
                self.push(stack, logical("or", a, b), a)
            elif op == 0x8045:  # not
                a = self.pop(stack, pc)
                if a.kind == "bool":
                    e = Not(a)
                else:
                    e = BinOp("==", a, Const(0), "bool")
                self.push(stack, e, a)
            elif op == 0x8046:  # negate
                a = self.pop(stack, pc)
                if isinstance(a, Const):
                    v = -a.value
                    if not a.is_float:
                        # CE opNegate on a 32-bit int: -(-2147483648) stays -2147483648
                        # (dccraps writes `-0x80000000` for bit 31)
                        v = (v + 2**31) % 2**32 - 2**31
                    e = Const(v, a.is_float)
                else:
                    e = Neg(value(a))
                self.push(stack, e, a)
            elif op == 0x8044:  # floor
                a = self.pop(stack, pc)
                self.push(stack, Raw("floor(%s)" % value(a).lua(), "num", PREC_ATOM, a.pure), a)

            elif op == OP_FETCH_GLOBAL:
                n = self.pop_const(stack, pc)
                self.push(stack, Name(self.s.svar(n)), n)
            elif op == OP_STORE_GLOBAL:
                n = self.pop_const(stack, pc)
                v = self.pop(stack, pc)
                emit(Assign(self.s.svar(n.value), value(v)))
            elif op == OP_FETCH:
                n = self.pop_const(stack, pc)
                self.push(stack, Name(self.local_name(n.value)), n)
            elif op == OP_STORE:
                n = self.pop_const(stack, pc)
                v = self.pop(stack, pc)
                emit(Assign(self.local_name(n.value), value(v)))
            elif op == OP_FETCH_EXTERNAL:
                n = self.ext_name(self.pop(stack, pc))
                if not isinstance(n, Name):
                    raise DecompileError("%s: fetch_external of a computed name at 0x%x" % (self.proc.name, pc))
                self.s.externals.add(n.name)
                self.push(stack, Name(lua_name(n.name)), n)
            elif op == OP_STORE_EXTERNAL:
                n = self.ext_name(self.pop(stack, pc))
                v = self.pop(stack, pc)
                if not isinstance(n, Name):
                    raise DecompileError("%s: store_external of a computed name at 0x%x" % (self.proc.name, pc))
                self.s.externals.add(n.name)
                emit(Assign(lua_name(n.name), value(v)))
            elif op == OP_EXPORT_VAR:
                n = self.pop(stack, pc)
                if not isinstance(n, Name):
                    raise DecompileError("%s: export of a computed name at 0x%x" % (self.proc.name, pc))
                emit(ExprStmt(Raw("export(%s)" % lua_string(n.name))))

            elif op == OP_POP:
                e = self.pop(stack, pc)
                if isinstance(e, (Const, Str, Name)):
                    pass  # a discarded literal has no effect
                elif isinstance(e, Call) or getattr(e, "is_proc_call", False):
                    e.used_as_value = False
                    emit(ExprStmt(e))
                else:
                    emit(ExprStmt(Raw("local _ = %s" % value(e).lua())))

            elif op == OP_D_TO_A:
                if self.ops_at(nxt, len(RETURN_TAIL)) == RETURN_TAIL:
                    v = self.pop(stack, pc)
                    if not (isinstance(v, Const) and v.value == 0 and not v.is_float):
                        self.returns_value = True
                    emit(Return(value(v)))
                    pc = self.ins[self.at[nxt] + len(RETURN_TAIL) - 1][3]
                    continue
                r = self.pop_const(stack, pc)
                pending_ret.append(r.value)

            elif op == OP_CHECK_ARGS:
                self.pop(stack, pc)
                self.pop(stack, pc)
            elif op == OP_LOOKUP_PROC:
                n = self.pop(stack, pc)
                if isinstance(n, Str):
                    e = Const(self.s.proc_index(n.value))
                else:
                    e = Raw(value(n).lua(), "any", PREC_ATOM, n.pure)
                    e.lookup = True
                self.push(stack, e, n)
            elif op == 0x801B:  # dup
                e = self.pop(stack, pc)
                if not e.pure:
                    raise DecompileError("%s: dup of an expression with side effects at 0x%x" % (self.proc.name, pc))
                stack.append(e)
                stack.append(e)

            elif op == OP_CALL:
                idx = self.pop(stack, pc)
                argc = self.pop_const(stack, pc)
                if not pending_ret or pending_ret[-1] != nxt:
                    raise DecompileError("%s: unexpected call shape at 0x%x" % (self.proc.name, pc))
                pending_ret.pop()
                args = [self.pop(stack, pc) for _ in range(argc.value)][::-1]
                if getattr(idx, "lookup", False):
                    # the procedure is named by a variable (CE opLookupStringProc)
                    name = "*"
                    text = "call(%s)" % ", ".join([idx.lua()] + [value(a).lua() for a in args])
                elif isinstance(idx, Const) and not idx.is_float:
                    target = self.s.proc_by_index(idx.value)
                    if target.argc != argc.value and self.s.uses_frame(target):
                        raise DecompileError("%s: %s called with %d args, expects %d"
                                             % (self.proc.name, target.name, argc.value, target.argc))
                    name = target.name
                    text = "%s(%s)" % (lua_name(target.name), ", ".join(value(a).lua() for a in args))
                else:
                    raise DecompileError("%s: call through a computed index at 0x%x" % (self.proc.name, pc))
                e = Raw(text, "any", PREC_ATOM, False)
                e.is_proc_call = True
                e.used_as_value = True
                self.s.value_calls_pending.append((name, e))
                self.s.call_edges.add((self.proc.name, name))
                self.push(stack, e, args[0] if args else argc)

            elif op == OP_IF or op == OP_WHILE:
                c = self.pop(stack, pc)
                addr = self.pop_const(stack, pc)
                self.flush(stack, out, pc)
                target = addr.value
                loop_head = addr.pc
                if target > end and self.threads_to(end, target):
                    target = end
                if not (nxt <= target <= end):
                    raise DecompileError("%s: branch target 0x%x outside 0x%x..0x%x"
                                         % (self.proc.name, target, nxt, end))
                # a body ending with `push X; jmp` jumps back (loop) or over an else
                j = self.jump_before(target)
                # opWhile leaves the exit address on the stack while the loop
                # runs, so the back jump goes to the condition, just past the
                # `push <exit>` (CE interpreter.cc opWhile)
                if j is not None and loop_head is not None and j == loop_head + 6:
                    body = self.region(nxt, target - 8)
                    emit(While(cond(c), body))
                    pc = target
                    continue
                if op == OP_WHILE:
                    raise DecompileError("%s: while at 0x%x without a back jump" % (self.proc.name, pc))
                # j == target: `else begin end`, an empty else branch
                if j is not None and j >= target:
                    if j > end and self.threads_to(end, j):
                        j = end
                    if j > end:
                        raise DecompileError("%s: else branch at 0x%x runs past its block" % (self.proc.name, pc))
                    then = self.region(nxt, target - 8)
                    orelse = self.region(target, j)
                    emit(If(cond(c), then, orelse))
                    pc = j
                    continue
                emit(If(cond(c), self.region(nxt, target), []))
                pc = target
                continue

            elif op == OP_EXIT_PROG:
                emit(Exit())
            elif op == OP_DETACH:
                # CE opDetach only unlinks the program from a parent program; a
                # game script has none (scriptLoad creates it standalone), so
                # it does nothing
                pass

            elif op in INTRINSICS:
                name, argc, pushes = INTRINSICS[op]
                args = [self.pop(stack, pc) for _ in range(argc)][::-1]
                if name in ("gsay_option", "giq_option"):
                    args[-2] = self.proc_target(args[-2], pc)
                fix = self.s.script_fixes.get((self.s.name, self.proc.name.lower()), {}).get(name)
                if fix is not None:
                    args = [self.script_fix(a, fix) for a in args]
                for k, kind in NAMED_ARGS.get(name, []) + ENUM_ARGS.get(name, []):
                    raw = args[k]
                    args[k] = self.s.name_const(kind, raw)
                    if kind == "trait_type" and isinstance(raw, Const):
                        # the third argument, has_trait(type, obj, trait) and
                        # critter_add_trait(obj, type, trait, amount): a perk, an
                        # object property or a trait, by type
                        t = TRAIT_KINDS.get(raw.value)
                        if t:
                            args[2] = self.s.name_const(t, args[2])
                if name in ("metarule", "metarule3") and isinstance(args[0], (Const, NamedConst)):
                    extra = METARULE_ARGS.get((name, args[0].value))
                    if extra:
                        args[extra[0]] = self.s.name_const(extra[1], args[extra[0]])
                e = Call(name, args, name in PURE, name in BUILTIN_VARS)
                first = args[0] if args else None
                if pushes:
                    self.push(stack, e, first, pc)
                else:
                    emit(ExprStmt(e))
            elif op in SAY_OPS:
                raise DecompileError("%s: interpreter-library dialogue opcode 0x%04x at 0x%x (CE interpreter_lib.cc"
                                     " say*, not gdialog)" % (self.proc.name, op, pc))
            else:
                raise DecompileError("%s: unsupported opcode 0x%04x at 0x%x" % (self.proc.name, op, pc))
            pc = nxt
        if pc != end:
            raise DecompileError("%s: region overran its end (0x%x > 0x%x)" % (self.proc.name, pc, end))
        self.flush(stack, out, end)
        if pending_ret:
            raise DecompileError("%s: unfinished call at 0x%x" % (self.proc.name, end))
        return out

    def flush(self, stack, out, pc):
        """Results nobody pops: CE pushes a value for some intrinsics that sslc
        compiles as statements (critter_mod_skill pushes 0, interpreter_extra.cc
        opCritterModifySkill). The value just stays on the stack, so the call is
        a statement at the point it ran."""
        if not stack:
            return
        for e in stack:
            if not (isinstance(e, Call) or getattr(e, "is_proc_call", False)):
                if isinstance(e, (Const, Str)) and e is stack[0]:
                    raise LeftoverConst()
                raise DecompileError("%s: value left on the stack at 0x%x" % (self.proc.name, pc))
        for e in stack:
            e.used_as_value = False
            out.append(ExprStmt(e))
        del stack[:]

    def threads_to(self, pc, target):
        """True if the code at `pc` is a chain of `push X; jmp` that ends at
        `target`. Some scripts (the ncr talk_p_procs, modinn) jump from a nested
        if straight to where the enclosing block's closing jump goes instead of
        to that jump; both run the same instructions, so the branch is treated
        as ending the block at `pc`."""
        seen = set()
        while pc not in seen:
            seen.add(pc)
            if self.ops_at(pc, 2) != [OP_PUSH_INT, OP_JUMP]:
                return False
            pc = self.ins[self.at[pc]][2]
            if pc == target:
                return True
        return False

    def ext_name(self, n):
        """sslc compiles `x += 1` on an imported variable as `push_int <identifier
        offset>; fetch_external`: CE opFetchExternalVariable /
        opStoreExternalVariable read the name as programGetIdentifier(
        value.integerValue) whatever the value's type (src/vm_bridge.ts varName
        does the same). A constant that is not an identifier offset stays an
        error."""
        if isinstance(n, Const) and not n.is_float and n.value in self.f.identifiers:
            e = Name(self.f.identifiers[n.value])
            e.pc = n.pc
            return e
        return n

    def jump_before(self, target):
        """Target of a `push X; jmp` that ends right before `target`, else None."""
        jmp = self.prev_ins(target, 1)
        push = self.prev_ins(target, 2)
        if jmp is None or push is None:
            return None
        if jmp[1] == OP_JUMP and push[1] == OP_PUSH_INT and jmp[3] == target:
            return push[2]
        return None

    def proc_target(self, e, pc):
        if isinstance(e, Const) and not e.is_float:
            return ProcRef(self.s.proc_by_index(e.value).name)
        if isinstance(e, Str):
            return ProcRef(e.value)
        raise DecompileError("%s: dialogue option target is not a procedure at 0x%x" % (self.proc.name, pc))

    def script_fix(self, e, fix):
        """SCRIPT_FIXES: the local variable `fix[0]` in an intrinsic's argument
        becomes the source's intended expression while [dh2] script_fixes is on."""
        local, intended, note = fix
        if isinstance(e, Name) and e.name == local:
            self.s.script_fixes_applied += 1
            return Raw("(dh2_script_fixes() ~= 0 and %s --[[ %s ]] or %s)" % (intended, note, local), pure=False)
        if isinstance(e, BinOp):
            e.a = self.script_fix(e.a, fix)
            e.b = self.script_fix(e.b, fix)
            e.pure = e.a.pure and e.b.pure
        return e

    def push(self, stack, e, origin, pc=None):
        e.pc = origin.pc if origin is not None and origin.pc is not None else pc
        stack.append(e)

    def pop(self, stack, pc):
        if not stack:
            fix = self.s.missing_operands.get((self.s.name, self.proc.name.lower()))
            if fix is not None and pc not in self.s.fixed_operands:
                # a word the compiler left out (MISSING_OPERANDS): the source's value
                self.s.fixed_operands.add(pc)
                e = Const(fix[0])
                e.pc = pc
                self.s.operand_notes[fix[1]] = fix[2]
                return e
            raise DecompileError("%s: stack underflow at 0x%x" % (self.proc.name, pc))
        return stack.pop()

    def pop_const(self, stack, pc):
        e = self.pop(stack, pc)
        if not isinstance(e, Const) or e.is_float:
            raise DecompileError("%s: expected an integer constant at 0x%x" % (self.proc.name, pc))
        return e


class ScriptDecompiler:
    def __init__(self, data, name, gvar_names=None, mvar_names=None, ssl=None, msgs=None):
        self.f = IntFile(data, name)
        self.name = name
        self.msgs = msgs  # MsgTexts: message text comments, or None
        # number -> name per kind (NAMED_ARGS), for global_var(7) -> global_var(GVAR_ENEMY_ARROYO)
        self.names = {"gvar": dict(enumerate(gvar_names or [])), "mvar": dict(enumerate(mvar_names or [])),
                      "lvar": {}, "pid": {}}
        self.ssl_matched = False
        # SSL source trees, best first (ssl_sources): PID and define.h names from
        # all of them (an earlier tree's name wins), a script's own LVAR/MVAR
        # names from the first tree whose .ssl matches the .int
        int_procs = [p.name for p in self.f.procs if not p.name.startswith(".") and not p.flags & PROC_FLAG_IMPORTED]
        for tree in reversed(ssl or []):
            self.names["pid"] = {**self.names["pid"], **tree.pids}
            for kind, table in tree.enums.items():
                self.names[kind] = {**self.names.get(kind, {}), **table}
        # where each kind's names come from (the variable list, report())
        self.var_source = {"gvar": "data/vault13.gam" if gvar_names else None,
                           "mvar": "maps/%s.gam" % name if mvar_names else None, "lvar": None}
        self.var_inferred = {"gvar": False, "mvar": False, "lvar": False}
        self.inferred = {}  # name -> why it is inferred (a comment where emit() declares it)
        # an exact match in any tree before a near match (SslNames.for_script)
        matches = [m for m in (tree.for_script(name, int_procs) for tree in ssl or []) if m is not None]
        own = next((m for m in matches if not m["inferred"]), matches[0] if matches else None)
        if own is not None:
            self.ssl_matched = True
            self.names["lvar"] = own["lvar"]
            self.var_source["lvar"], self.var_inferred["lvar"] = own["source"], own["inferred"]
            if not self.names["mvar"]:  # a map's own .gam comes first
                self.names["mvar"] = own["mvar"]
                self.var_source["mvar"], self.var_inferred["mvar"] = own["source"], own["inferred"]
            # a GVAR number vault13.gam lacks (GLOBAL_NOTIFY's -1)
            self.names["gvar"] = {**own["gvar"], **self.names["gvar"]}
        self.var_uses = {}  # (kind, number) -> name or None, every variable the code uses
        self.guessed = {}  # name -> why it is guessed (CURATED_NAMES)
        for (script, kind, num), (cname, status, why) in CURATED_NAMES.items():
            if script == name and num not in self.names[kind]:
                self.names[kind] = {**self.names[kind], num: cname}
                (self.inferred if status == "inferred" else self.guessed)[cname] = why
        self.script_fixes_applied = 0  # SCRIPT_FIXES operands replaced
        # the per-script repairs of the vanilla .int; decompile_file clears them for a
        # script taken from a mod (recompiled from fixed sources, wiki/upu_support.md)
        self.script_fixes = SCRIPT_FIXES
        self.missing_operands = MISSING_OPERANDS
        self.fixed_operands = set()  # pcs MISSING_OPERANDS supplied a value for
        self.operand_notes = {}      # name -> why (MISSING_OPERANDS), marked inferred
        self.named = {}       # name -> (kind, number), used somewhere in the script
        self.declared = set()  # the names emit() declares as locals
        self.externals = set()
        self.value_calls_pending = []
        self.call_edges = set()  # (caller, callee) procedure names, for recursive()
        self.svars = []
        self.svar_inits = []
        self.exports = []  # [name, initial value]
        self.entry = None

    def ident(self, off):
        if off not in self.f.identifiers:
            raise DecompileError("identifier 0x%x missing" % off)
        return self.f.identifiers[off]

    def string(self, off):
        if off not in self.f.strings:
            raise DecompileError("string 0x%x missing" % off)
        return self.f.strings[off]

    def svar(self, n):
        n = n.value if isinstance(n, Const) else n
        if n >= len(self.svars):
            raise DecompileError("script variable %d not declared" % n)
        return self.svars[n]

    def proc_by_index(self, i):
        if not (0 <= i < len(self.f.procs)):
            raise DecompileError("procedure index %d out of range" % i)
        return self.f.procs[i]

    def uses_frame(self, proc):
        """True if the procedure reads or writes an argument or local variable.
        CE opPushBase builds the frame from the argument count the caller
        pushed, not the one in the procedure table, so a call with the wrong
        count is harmless when the callee never touches its frame (sccop calls
        getArmedPartyMember, declared with one parameter, with none)."""
        f = self.f
        ends = [p.offset for p in f.procs if p.offset > proc.offset] + [len(f.data)]
        pc, end = proc.offset, min(ends)
        while pc < end:
            op, _arg, pc = f.instr(pc)
            if op in (OP_FETCH, OP_STORE):
                return True
        return False

    def name_const(self, kind, e):
        """A constant number as its name (NamedConst); anything else as it is."""
        if kind == "gvar" and isinstance(e, BinOp) and e.op in ("+", "-"):
            # an index expression: sslc folds `GVAR_SALVATORE_WARNINGS + family - 1`
            # to `251 + 2 - 1`; the base is named, marked inferred (the number could
            # be a coincidence)
            parent = e
            while isinstance(parent.a, BinOp) and parent.a.op in ("+", "-"):
                parent = parent.a
            base = parent.a
            named = self.name_const("gvar", base)
            if named is not base:
                parent.a = named
                self.inferred.setdefault(named.name, "the base of an index expression (%d + ...)" % base.value)
                self.var_uses[("gvar", base.value)] = named.name
            return e
        if not (isinstance(e, Const) and not e.is_float):
            return e
        record = kind in ("gvar", "mvar", "lvar")
        if record:
            self.var_uses.setdefault((kind, e.value), None)
        n = self.names.get(kind, {}).get(e.value)
        if n is None or n in LUA_KEYWORDS or n in RUNTIME_NAMES or n in self.taken_names():
            return e
        if self.named.setdefault(n, (kind, e.value)) != (kind, e.value):
            return e  # one name for two numbers (a typo in the sources): keep both numeric
        if record:
            self.var_uses[(kind, e.value)] = n
            if n in self.operand_notes:
                self.inferred.setdefault(n, self.operand_notes[n])
            if self.var_inferred.get(kind):
                self.inferred.setdefault(n, "from %s" % self.var_source[kind])
        named = NamedConst(n, e.value, self)
        named.pc = e.pc
        return named

    def report(self):
        """The variables the script uses: (kind, number, name or "", source, inferred),
        after emit(); a name emit() could not declare (Lua's local limit) is listed as
        a number."""
        rows = []
        for (kind, v), n in sorted(self.var_uses.items()):
            if n and n in self.declared:
                src = self.var_source[kind] or ""
                why = self.inferred.get(n) or self.guessed.get(n)
                if (kind, v) in [(k, x) for (sc, k, x) in CURATED_NAMES if sc == self.name]:
                    src = why  # a hand-chosen name: the evidence is its whole source
                elif why and not why.startswith("from "):  # the reason, unless it is just the source again
                    src = "%s: %s" % (src, why)
                status = "guessed" if n in self.guessed else ("inferred" if n in self.inferred else "")
                rows.append((kind, v, n, src, status))
            else:
                if not self.var_source[kind]:
                    why = "no source names it"
                elif not n:
                    why = "not named in %s" % self.var_source[kind]
                else:
                    why = "not declared (Lua's local limit)"
                rows.append((kind, v, "", why, False))
        return rows

    def taken_names(self):
        if not hasattr(self, "_taken"):
            self._taken = set(self.svars) | set(lua_name(p.name) for p in self.f.procs) | \
                set(lua_name(n) for n, _v in self.exports) | set(lua_name(n) for n in self.external_names())
        return self._taken

    def proc_index(self, name):
        for p in self.f.procs:
            if p.name == name:
                return p.index
        raise DecompileError("unknown procedure %s" % name)

    def startup(self):
        """The code before the first procedure: script variable initial values,
        then a jump into the entry procedure (CE: runProgram -> _interpret)."""
        f = self.f
        pc = f.code_start
        # the .int writer pads with 0xFFFF words before the code
        while pc + 2 <= len(f.data) and struct.unpack_from(">H", f.data, pc)[0] == 0xFFFF:
            pc += 2
        op, _, pc = f.instr(pc)
        if op != OP_SET_GLOBAL:
            raise DecompileError("startup code does not begin with set_global")
        # Sections, in sslc's order (int2ssl FalloutScript.cpp reads them the
        # same way): `export variable` (push name; export_var), exported
        # variables' initial values (push value; push name; store_external),
        # then one push per script variable, then the argument count of the
        # entry procedure, then critical_done.
        pushed = []
        while True:
            op, arg, nxt = f.instr(pc)
            if op in (OP_PUSH_INT, OP_PUSH_FLOAT, OP_PUSH_STRING):
                pushed.append((op, arg))
            elif op == OP_EXPORT_VAR:
                kind, off = pushed.pop()
                self.exports.append([self.ident(off), Const(0)])
            elif op == OP_STORE_EXTERNAL:
                (_k, off), (vk, v) = pushed.pop(), pushed.pop()
                name = self.ident(off)
                for ex in self.exports:
                    if ex[0] == name:
                        ex[1] = self.literal(vk, v)
                        break
                else:
                    raise DecompileError("initial value for %s, which is not exported" % name)
            elif op == OP_CRITICAL_DONE:
                break
            else:
                raise DecompileError("startup code: unexpected opcode 0x%04x" % op)
            pc = nxt
        if not pushed or pushed[-1][0] != OP_PUSH_INT:
            raise DecompileError("startup code: no entry argument count")
        pushed.pop()
        inits = [self.literal(k, v) for k, v in pushed]
        op, entry, pc = f.instr(nxt)
        op2, _, _ = f.instr(pc)
        if op != OP_PUSH_INT or op2 != OP_JUMP:
            raise DecompileError("startup code does not jump to an entry procedure")

        # The identifier table holds every name in declaration order:
        # procedures, script variables, exported and imported variables. The
        # script variables are what is left after the others.
        external = set(n for n, _v in self.exports) | self.external_names()
        names = [n for _off, n in sorted(f.identifiers.items())
                 if n not in f.proc_names and n not in external]
        if len(names) == len(inits):
            self.svars = [lua_name(n) for n in names]
        else:
            # int2ssl TryRenameGlobalVariables falls back the same way
            self.svars = ["GVar%d" % i for i in range(len(inits))]
        self.svar_inits = inits
        entries = [p for p in f.procs if p.offset == entry and not p.name.startswith(".")]
        self.entry = entries[0].name if entries else None

    def literal(self, op, arg):
        if op == OP_PUSH_INT:
            return Const(arg)
        if op == OP_PUSH_FLOAT:
            return Const(arg, True)
        return Str(self.string(arg))

    def external_names(self):
        """Names used by fetch/store_external anywhere in the code."""
        f = self.f
        out = set()
        pc = f.code_start
        while pc + 2 <= len(f.data) and struct.unpack_from(">H", f.data, pc)[0] == 0xFFFF:
            pc += 2
        prev = None
        while pc + 2 <= len(f.data):
            op, arg, nxt = f.instr(pc)
            if op in (OP_FETCH_EXTERNAL, OP_STORE_EXTERNAL) and prev and prev[0] in (OP_PUSH_STRING, OP_PUSH_INT):
                if prev[1] in f.identifiers:
                    out.add(f.identifiers[prev[1]])
            prev = (op, arg)
            pc = nxt
        return out

    def decompile(self):
        self.startup()
        f = self.f
        offsets = sorted(set(p.offset for p in f.procs if not (p.flags & PROC_FLAG_IMPORTED)) | {len(f.data)})
        out_procs = []
        seen = set()
        for p in f.procs:
            if p.flags & PROC_FLAG_IMPORTED:
                continue
            if p.flags & (PROC_FLAG_TIMED | PROC_FLAG_CONDITIONAL):
                raise DecompileError("%s: timed/conditional procedures are not supported" % p.name)
            if p.name.startswith("."):
                continue  # sslc's dummy procedure 0
            nxt = min(o for o in offsets if o > p.offset)
            if p.offset in seen:
                raise DecompileError("%s shares its code with another procedure" % p.name)
            seen.add(p.offset)
            pd = ProcDecompiler(self, p, nxt)
            body = pd.run()
            out_procs.append((p, pd, body))
        return out_procs

    # ------------------------------------------------------------------
    def emit(self):
        procs = self.decompile()
        lines = []
        w = lines.append
        w("-- %s.lua - decompiled from %s.int by tools/int2lua.py (DarkHarold2)." % (self.name, self.name))
        w("-- Generated from your Fallout 2 install; regenerate rather than edit. A mod")
        w("-- replaces a script by shipping its own %s.lua." % self.name)
        w("")
        if self.externals:
            names = sorted(self.externals)
            w("import(%s)" % ", ".join(lua_string(n) for n in names))
            w("")
        for n, v in self.exports:
            w("export(%s, %s)" % (lua_string(n), v.lua()))
        if self.exports:
            w("")
        def rank(kind):
            return NAME_ORDER.index(kind) if kind in NAME_ORDER else (len(NAME_ORDER) + 1 if kind == "pid" else len(NAME_ORDER))
        ordered = sorted(self.named.items(), key=lambda kv: (rank(kv[1][0]), kv[1][0], kv[1][1]))[:MAX_NAMED]
        self.declared = set(n for n, _kv in ordered)
        if ordered:
            for n, (_kind, v) in ordered:
                note = ("inferred", self.inferred[n]) if n in self.inferred else                     (("guessed", self.guessed[n]) if n in self.guessed else None)
                w("local %s = %d%s" % (n, v, "  -- %s: %s" % note if note else ""))
            w("")
        if self.svars:
            for n, v in zip(self.svars, self.svar_inits):
                w("%s = %s" % (n, v.lua()))
            w("")
        if self.entry and self.entry != "start":
            w("entry(%s)" % lua_string(self.entry))
            w("")
        # procedures whose result some expression uses keep sslc's `return 0`
        callers = self.value_calls()
        recursive = self.recursive()
        for p, pd, body in procs:
            args = ", ".join(pd.local_name(i) for i in range(p.argc))
            w("function %s(%s)" % (lua_name(p.name), args))
            if p.name in recursive:
                # CE stops a recursion that fills the stacks with a fatal error (prelude MAX_RECURSION)
                w("    local _ <close> = recursion_guard()")
            for i, init in enumerate(pd.local_inits):
                w("    local %s = %s" % (pd.local_name(p.argc + i), init.lua()))
            self.block(body, 1, w)
            if p.name in callers and not (body and isinstance(body[-1], Return)):
                w("    return 0")
            w("end")
            w("")
        while lines and lines[-1] == "":
            lines.pop()
        import re
        text = re.sub(NAMED_MARK, lambda m: m.group(1) if m.group(1) in self.declared else m.group(2),
                      "\n".join(lines))
        if self.msgs is not None:
            # a comment with the message text after each line that uses one
            text = "\n".join(line if line.lstrip().startswith("--") else line + self.msgs.comment(line)
                             for line in text.split("\n"))
        return text + "\n"

    def recursive(self):
        """Procedures that can reach themselves through static calls (a call
        through a variable, `call(name)`, is not followed)."""
        graph = {}
        for a, b in self.call_edges:
            graph.setdefault(a, set()).add(b)
        found = set()
        for start in graph:
            seen, todo = set(), list(graph[start])
            while todo:
                n = todo.pop()
                if n == start:
                    found.add(start)
                    break
                if n not in seen:
                    seen.add(n)
                    todo.extend(graph.get(n, ()))
        return found

    def value_calls(self):
        return set(name for name, e in self.value_calls_pending if e.used_as_value)

    def block(self, stmts, depth, w):
        ind = "    " * depth
        for k, s in enumerate(stmts):
            last = k == len(stmts) - 1
            if isinstance(s, Assign):
                w("%s%s = %s" % (ind, s.target, s.expr.lua()))
            elif isinstance(s, ExprStmt):
                w(ind + s.expr.lua())
            elif isinstance(s, Return):
                text = "return " + s.expr.lua()
                w(ind + (text if last else "do %s end" % text))
            elif isinstance(s, Exit):
                w(ind + ("exit()" if last else "do exit() end"))
            elif isinstance(s, While):
                w("%swhile %s do" % (ind, s.test.lua()))
                self.block(s.body, depth + 1, w)
                w(ind + "end")
            elif isinstance(s, If):
                self.emit_if(s, depth, w, "if")
                w(ind + "end")
            else:
                raise DecompileError("unknown statement")

    def emit_if(self, s, depth, w, kw):
        ind = "    " * depth
        w("%s%s %s then" % (ind, kw, s.test.lua()))
        self.block(s.then, depth + 1, w)
        if len(s.orelse) == 1 and isinstance(s.orelse[0], If):
            self.emit_if(s.orelse[0], depth, w, "elseif")
        elif s.orelse:
            w(ind + "else")
            self.block(s.orelse, depth + 1, w)


def decompile_file(path, report=None):
    """data/scripts/<name>.int -> Lua text. Variable names come from the
    install's data/data/vault13.gam, for a map's own script data/maps/<name>.gam,
    and SSL sources in data/scripts_src/ when present (SslNames); without them
    the numbers stay. A line that uses a message gets its text as a comment
    (MsgTexts)."""
    name = os.path.splitext(os.path.basename(path))[0].lower()
    with open(path, "rb") as fh:
        data = fh.read()
    root = os.path.dirname(os.path.dirname(os.path.abspath(path)))
    gvars = read_gam(os.path.join(root, "data", "vault13.gam"), "GAME_GLOBAL_VARS")
    mvars = read_gam(os.path.join(root, "maps", name + ".gam"), "MAP_GLOBAL_VARS")
    sd = ScriptDecompiler(data, name, gvars, mvars, script_ssl_sources(root, name), msg_texts(root))
    if script_from_mod(root, name):
        sd.script_fixes, sd.missing_operands = {}, {}
    text = sd.emit()
    if report is not None:
        report.extend((name,) + row for row in sd.report())
    return text


REPORT_HEADER = "script\tkind\tnumber\tname\tsource\tstatus"


def write_report(path, rows):
    """The variable list: every GVAR / MVAR / LVAR a script uses, its name and where
    the name comes from (decompile_file report rows)."""
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(REPORT_HEADER + "\n")
        for script, kind, v, n, src, inf in sorted(rows):
            fh.write("%s\t%s\t%d\t%s\t%s\t%s\n" % (script, kind, v, n, src, inf or ""))


def check_bridge(bridge_path):
    """Compare INTRINSICS against src/vm_bridge.ts; returns a list of differences."""
    import re
    lines = open(bridge_path, encoding="utf-8").read().splitlines()
    src = "\n".join(l for l in lines if not l.strip().startswith("//"))
    diffs = []
    for m in re.finditer(r'(0x[0-9A-Fa-f]{4}):\s*bridged\("(\w+)",\s*(\d+)(?:,\s*(true|false))?\)', src):
        op = int(m.group(1), 16)
        want = (m.group(2), int(m.group(3)), m.group(4) != "false")
        if INTRINSICS.get(op) != want:
            diffs.append("0x%04X: table %r, vm_bridge.ts %r" % (op, INTRINSICS.get(op), want))
    return diffs


def main(argv=None):
    ap = argparse.ArgumentParser(description="Decompile Fallout 2 .int scripts to Lua")
    ap.add_argument("files", nargs="*", help=".int files (globs allowed)")
    ap.add_argument("-o", "--out", help="output directory (default: print to stdout)")
    ap.add_argument("--report", metavar="TSV", help="write the variable list (names and their sources) to TSV")
    ap.add_argument("--check-bridge", metavar="VM_BRIDGE_TS",
                    help="verify the intrinsic table against src/vm_bridge.ts and exit")
    args = ap.parse_args(argv)

    if args.check_bridge:
        diffs = check_bridge(args.check_bridge)
        for d in diffs:
            print(d)
        return 1 if diffs else 0

    paths = []
    for pat in args.files:
        paths.extend(sorted(glob.glob(pat)) or [pat])
    if args.out:
        os.makedirs(args.out, exist_ok=True)
    failed = 0
    rows = [] if args.report else None
    for path in paths:
        try:
            text = decompile_file(path, rows)
        except (DecompileError, struct.error, KeyError, IndexError) as e:
            failed += 1
            print("FAILED %s: %s" % (path, e), file=sys.stderr)
            continue
        if args.out:
            name = os.path.splitext(os.path.basename(path))[0].lower()
            with open(os.path.join(args.out, name + ".lua"), "w", encoding="utf-8", newline="\n") as fh:
                fh.write(text)
        else:
            sys.stdout.write(text)
    if args.report:
        write_report(args.report, rows)
    if len(paths) > 1:
        print("%d/%d scripts decompiled" % (len(paths) - failed, len(paths)), file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
