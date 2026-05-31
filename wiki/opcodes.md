# Fallout 2 Script Opcodes — DarkHarold2 Reference

Two sections:
1. **VM Opcodes** (0x8000–0x804B) — interpreter/bytecode operations, defined in fallout2-ce `src/interpreter.h`
2. **Script Intrinsic Opcodes** (0x80A0+) — game API calls from .INT scripts, wired in DarkHarold2's `src/vm_bridge.ts`

For the **DarkHarold2 status** column:
- `WIRED` = bridged in vm_bridge.ts and method exists in scripting.ts
- `PARTIAL` = wired but method calls stub() for some inputs
- `STUB` = wired but method always calls stub() / returns default
- `INLINE` = wired with a custom inline function in vm_bridge.ts (not bridged())
- `UNWIRED` = not in vm_bridge.ts at all

Cross-link: See [damage_formula.md](damage_formula.md) for how attack_complex and related opcodes connect to the damage pipeline.

---

## Section 1: VM Opcodes (interpreter.h)

These are low-level bytecode operations handled by ScriptVM in `src/vm.ts`.

Opcode | Name | Description | DH2 vm.ts
-------|------|-------------|----------
0x8000 | NOOP | No-op | WIRED
0x8001 | PUSH_D | Push 32-bit literal onto data stack | WIRED (0xC001 variant)
0x8002 | ENTER_CRITICAL | Begin critical section (nop in CE) | WIRED (nop)
0x8003 | LEAVE_CRITICAL | End critical section (nop in CE) | WIRED (nop)
0x8004 | JUMP | Unconditional jump to popped address | WIRED
0x8005 | CALL | Call procedure | WIRED
0x8006 | CALL_AT | Delayed call | WIRED
0x8007 | CALL_WHEN | Conditional call | partial
0x8008 | CALLSTART | Call start procedure | WIRED
0x8009 | EXEC | Execute program | partial
0x800A | SPAWN | Spawn new program | UNWIRED
0x800B | FORK | Fork program | UNWIRED
0x800C | A_TO_D | Address register → data stack | WIRED
0x800D | D_TO_A | Data stack → address register | WIRED
0x800E | EXIT | Exit program | WIRED
0x800F | DETACH | Detach program | UNWIRED
0x8010 | EXIT_PROGRAM | Exit program (alt) | WIRED
0x8011 | STOP_PROGRAM | Stop program | WIRED
0x8012 | FETCH_GLOBAL | Fetch global var | WIRED
0x8013 | STORE_GLOBAL | Store global var | WIRED
0x8014 | FETCH_EXTERNAL | Fetch exported variable | INLINE (vm_bridge.ts)
0x8015 | STORE_EXTERNAL | Store exported variable | INLINE
0x8016 | EXPORT_VARIABLE | Export variable | INLINE
0x8017 | EXPORT_PROCEDURE | Export procedure | WIRED
0x8018 | SWAP | Swap top two data stack items | WIRED
0x8019 | SWAPA | Swap top two address stack items | WIRED
0x801A | POP | Pop and discard | WIRED
0x801B | DUP | Duplicate top of stack | WIRED
0x801C | POP_RETURN | Pop and return | WIRED
0x801D | POP_EXIT | Pop and exit | WIRED
0x801E | POP_ADDRESS | Pop address | WIRED
0x801F | POP_FLAGS | Pop flags | WIRED
0x8020 | POP_FLAGS_RETURN | Pop flags, return | WIRED
0x8021 | POP_FLAGS_EXIT | Pop flags, exit | WIRED
0x8022 | POP_FLAGS_RETURN_EXTERN | Pop flags, return extern | WIRED
0x8023 | POP_FLAGS_EXIT_EXTERN | Pop flags, exit extern | WIRED
0x8024 | POP_FLAGS_RETURN_VAL_EXTERN | Pop flags, return val extern | WIRED
0x8025 | POP_FLAGS_RETURN_VAL_EXIT | Pop flags, return val exit | WIRED
0x8026 | POP_FLAGS_RETURN_VAL_EXIT_EXTERN | Pop flags, return val exit extern | WIRED
0x8027 | CHECK_PROCEDURE_ARGUMENT_COUNT | Check argc | WIRED
0x8028 | LOOKUP_PROCEDURE_BY_NAME | Look up procedure | WIRED
0x8029 | POP_BASE | Pop base pointer | WIRED
0x802A | POP_TO_BASE | Pop to base | WIRED
0x802B | PUSH_BASE | Push base pointer (with argc) | WIRED
0x802C | SET_GLOBAL | Set global var | WIRED
0x802D | FETCH_PROCEDURE_ADDRESS | Fetch proc address | WIRED
0x802E | DUMP | Dump (debug) | nop
0x802F | IF | Conditional branch | WIRED
0x8030 | WHILE | While loop | WIRED
0x8031 | STORE | Store to var | WIRED
0x8032 | FETCH | Fetch from var | WIRED
0x8033 | EQUAL | == | WIRED
0x8034 | NOT_EQUAL | != | WIRED
0x8035 | LESS_THAN_EQUAL | <= | WIRED
0x8036 | GREATER_THAN_EQUAL | >= | WIRED
0x8037 | LESS_THAN | < | WIRED
0x8038 | GREATER_THAN | > | WIRED
0x8039 | ADD | + | WIRED
0x803A | SUB | - | WIRED
0x803B | MUL | * | WIRED
0x803C | DIV | / (integer) | WIRED
0x803D | MOD | % | WIRED
0x803E | AND | logical and | WIRED
0x803F | OR | logical or | WIRED
0x8040 | BITWISE_AND | & | WIRED
0x8041 | BITWISE_OR | \| | WIRED
0x8042 | BITWISE_XOR | ^ | WIRED
0x8043 | BITWISE_NOT | ~ | WIRED
0x8044 | FLOOR | floor() | WIRED
0x8045 | NOT | logical not | WIRED
0x8046 | NEGATE | unary minus | WIRED
0x8047 | WAIT | Wait ticks | WIRED
0x8048 | CANCEL | Cancel wait | WIRED
0x8049 | CANCEL_ALL | Cancel all waits | WIRED
0x804A | START_CRITICAL | Start critical | nop
0x804B | END_CRITICAL | End critical | nop

CE source: `src/interpreter.h` (opcode enum), `src/interpreter.cc` (handlers)

---

## Section 2: Script Intrinsic Opcodes (vm_bridge.ts)

These are the "game API" opcodes — calls from scripts to engine functions. In fallout2-ce they are registered in `src/scripts.cc::interpreterRegisterOpcodeHandlers()`. In DarkHarold2 they are wired in `src/vm_bridge.ts` and implemented in `src/scripting.ts`.

Hex | Name | Args | Returns | Status | Notes
----|------|------|---------|--------|------
0x80A1 | give_exp_points | 1 (xp) | void | WIRED | Awards XP to player; triggers level-up
0x80A3 | play_sfx | 1 (sfx_name) | void | WIRED | Plays sound effect
0x80A4 | obj_name | 1 (obj) | str | WIRED | Returns object name string
0x80A7 | tile_contains_pid_obj | 3 (tile,elev,pid) | obj | WIRED | First obj with pid at tile
0x80A8 | game_time_hour | 0 | int | INLINE | Current hour 0-23
0x80A9 | override_map_start | 4 (tile,elev,rot,flags) | void | WIRED | Override player start position
0x80AA | has_skill | 2 (obj,skill) | int | WIRED | Returns effective skill value
0x80AB | using_skill | 2 (obj,skill) | int | STUB | Always returns 0; CE: isUsingSkill()
0x80AC | roll_vs_skill | 3 (obj,skill,bonus) | roll | WIRED | Skill roll; returns RollResult enum
0x80AE | do_check | 3 (obj,check,mod) | int | STUB | Always returns 1 (success)
0x80AF | is_success | 1 (roll) | bool | WIRED | Roll result is success or crit-success
0x80B0 | is_critical | 1 (roll) | bool | WIRED | Roll result is crit-success or crit-fail
0x80B2 | mark_area_known | 3 (type,id,state) | void | WIRED | Mark worldmap area known
0x80B4 | random | 2 (min,max) | int | WIRED | Random int in range
0x80B6 | move_to | 3 (obj,tile,elev) | int | WIRED | Teleport object to tile
0x80B7 | create_object_sid | 4 (pid,tile,elev,sid) | obj | WIRED | Create object with script
0x80B8 | display_msg | 1 (msg) | void | WIRED | Show message in HUD log
0x80B9 | script_overrides | 0 | void | WIRED | Set script override flag
0x80BA | obj_is_carrying_obj_pid | 2 (obj,pid) | bool | WIRED | Check if carrying pid
0x80BB | tile_contains_obj_pid | 3 (tile,elev,pid) | obj | WIRED | First obj of pid at tile
0x80BC | self_obj | 0 | obj | INLINE | Returns self object
0x80BD | source_obj | 0 | obj | INLINE | Returns source object
0x80BE | target_obj | 0 | obj | INLINE | Returns target object
0x80BF | dude_obj | 0 | obj | INLINE | Returns player object
0x80CA | get_critter_stat | 2 (obj,stat) | int | PARTIAL | Handles 9 stat IDs; stub for rest (see CODEBASE.md)
0x80CC | animate_stand_obj | 1 (obj) | void | WIRED | Snap to idle animation
0x80CE | animate_move_obj_to_tile | 3 (obj,tile,isRun) | void | WIRED | Animate critter moving to tile
0x80CF | tile_in_tile_rect | 5 (ul,ur,ll,lr,tile) | bool | WIRED | Tile in rectangle test
0x80D0 | attack_complex | 8 (args) | void | WIRED | Script-initiated attack; see [damage_formula.md](damage_formula.md)
0x80D2 | tile_distance | 2 (tile1,tile2) | int | WIRED | Hex distance between tiles
0x80D3 | tile_distance_objs | 2 (obj1,obj2) | int | WIRED | Hex distance between objects
0x80D4 | tile_num | 1 (obj) | int | WIRED | Object's tile number
0x80D5 | tile_num_in_direction | 3 (tile,dir,dist) | int | WIRED | Tile N steps in direction
0x80D8 | add_obj_to_inven | 2 (critter,obj) | void | WIRED | Add object to inventory
0x80DA | wield_obj_critter | 2 (critter,obj) | void | WIRED | Equip item
0x80DC | obj_can_see_obj | 2 (obj1,obj2) | bool | WIRED | LOS check
0x80DE | start_gdialog | 5 (head,msg,barter,unk,unk) | void | WIRED | Open dialogue
0x80DF | end_dialogue | 0 | void | WIRED | Close dialogue
0x80E1 | metarule3 | 4 (id,obj,userdata,radius) | any | PARTIAL | Sub-ops 100, 106 handled; rest stub
0x80E3 | set_obj_visibility | 2 (obj,visible) | void | WIRED | Show/hide object
0x80E4 | load_map | 2 (mapName,startTile) | void | WIRED | Load a new map
0x80E5 | wm_area_set_pos | 3 (area,x,y) | void | WIRED | Set worldmap area position
0x80E7 | anim_busy | 1 (obj) | bool | WIRED | Is object animating?
0x80E8 | critter_heal | 2 (obj,amount) | void | WIRED | Heal critter HP
0x80E9 | set_light_level | 1 (level) | void | WIRED | Set ambient light level
0x80EA | game_time | 0 | int | INLINE | Current game tick counter
0x80EC | elevation | 1 (obj) | int | WIRED | Object's elevation
0x80ED | kill_critter | 2 (obj,anim) | void | WIRED | Kill critter
0x80EF | critter_dmg | 3 (obj,dmg,type) | void | WIRED | Deal damage to critter
0x80F0 | add_timer_event | 3 (obj,ticks,data) | void | WIRED | Schedule timed callback
0x80F1 | rm_timer_event | 1 (obj) | void | WIRED | Remove timer events for obj
0x80F2 | game_ticks | 1 (seconds) | int | WIRED | Convert seconds to ticks
0x80F3 | has_trait | 3 (traitType,obj,trait) | int | PARTIAL | TRAIT_OBJECT cases 5/6/10/666 handled; rest stub
0x80F4 | destroy_object | 1 (obj) | void | WIRED | Remove object from map
0x80F5 | obj_can_hear_obj | 2 (obj1,obj2) | bool | WIRED | Hearing check
0x80F6 | game_time_hour | 0 | int | INLINE | Current hour (alt opcode)
0x80F7 | fixed_param | 0 | int | INLINE | Script fixed_param value
0x80F8 | tile_is_visible | 1 (tile) | bool | WIRED | Is tile on screen?
0x80F9 | dialogue_system_enter | 0 | void | WIRED | Enter dialogue mode
0x80FA | action_being_used | 0 | int | INLINE | Current action ID
0x80FB | critter_state | 1 (obj) | int | WIRED | Critter state flags
0x80FC | game_time_advance | 1 (ticks) | void | WIRED | Advance game time
0x80FF | critter_attempt_placement | 3 (obj,tile,elev) | int | WIRED | Place critter, try neighbors if blocked
0x8100 | obj_pid | 1 (obj) | int | WIRED | Object's PID
0x8101 | cur_map_index | 0 | int | INLINE | Current map index
0x8102 | critter_add_trait | 4 (obj,type,trait,amount) | void | PARTIAL | TRAIT_OBJECT cases 5,6 write; rest no-op after stub log
0x8105 | message_str | 2 (msgFile,msgID) | str | WIRED | Lookup message string
0x8106 | critter_inven_obj | 2 (critter,where) | obj | WIRED | Get equipped item (0=armor, 1=right, 2=left)
0x8109 | inven_cmds | 3 (critter,cmd,idx) | obj | STUB | Only INVEN_CMD_INDEX_PTR (13) asserted; returns null
0x810A | float_msg | 3 (obj,msg,type) | void | WIRED | Show floating text above object
0x810B | metarule | 2 (id,target) | any | PARTIAL | Sub-ops 14/15/17/18/22/46/48/49 handled; rest stub
0x810C | anim | 3 (obj,anim,param) | void | PARTIAL | IDs 1000 (set rotation) and 1010 (set frame) handled; rest stub
0x810D | obj_carrying_pid_obj | 2 (obj,pid) | obj | WIRED | Find carried item by pid
0x810E | reg_anim_func | 2 (obj,fn) | void | INLINE | Queue callback in animation batch
0x810F | reg_anim_animate | 3 (obj,anim,delay) | void | WIRED | Queue animation step with delay
0x8110 | reg_anim_obj_move_to_tile | 3 (obj,tile,delay) | void | WIRED | Queue move animation
0x8111 | reg_anim_begin | 1 (flags) | void | WIRED | Start animation batch
0x8112 | reg_anim_end | 0 | void | WIRED | Execute animation batch with delays
0x8113 | reg_anim_clear | 0 | void | WIRED | Clear pending animation batch
0x8115 | play_gmovie | 1 (movieID) | void | WIRED | Play .MVE movie (logs skip — not implemented)
0x8116 | add_mult_objs_to_inven | 3 (critter,obj,count) | void | WIRED | Add N copies to inventory
0x8117 | rm_mult_objs_from_inven | 3 (critter,obj,count) | int | WIRED | Remove N copies from inventory
0x8118 | get_month | 0 | int | INLINE | Current month 1-12 (from GameTime)
0x8119 | get_day | 0 | int | INLINE | Current day of month (from GameTime)
0x811A | explosion | 3 (tile,elev,dmg) | int | WIRED | Create explosion at tile
0x811C | gsay_start | 0 | int | WIRED | Begin dialogue option collection
0x811D | gsay_end | 0 | void | INLINE | Halt VM to wait for player choice
0x811E | gsay_reply | 2 (msgFile,msgID) | void | WIRED | Set NPC reply text
0x8120 | gsay_message | 3 (msgFile,msgID,unk) | void | WIRED | Display gsay message (Done button)
0x8121 | giq_option | 5 (iq,msgFile,msgID,target,reaction) | void | INLINE | Add IQ-gated dialogue option
0x8123 | get_poison | 1 (obj) | int | WIRED | Get object poison level
0x8124 | party_add | 1 (critter) | void | WIRED | Add to party (respects maxSize cap)
0x8125 | party_remove | 1 (critter) | void | WIRED | Remove from party
0x8126 | reg_anim_animate_forever | 2 (obj,anim) | void | WIRED | Loop animation forever
0x8127 | critter_injure | 2 (obj,flags) | void | WIRED | Apply injury flags (crippled limbs etc.)
0x8128 | combat_is_initialized | 0 | bool | INLINE | Is combat active?
0x8129 | gdialog_mod_barter | 1 (mod) | void | WIRED | Modify barter difficulty
0x812D | obj_is_locked | 1 (obj) | bool | WIRED | Is object locked?
0x812E | obj_lock | 1 (obj) | void | WIRED | Lock object
0x812F | obj_unlock | 1 (obj) | void | WIRED | Unlock object
0x8130 | obj_is_open | 1 (obj) | bool | WIRED | Is object open?
0x8131 | obj_open | 1 (obj) | void | WIRED | Open object (door/container)
0x8132 | obj_close | 1 (obj) | void | WIRED | Close object
0x8133 | game_ui_disable | 0 | void | WIRED | Disable UI input
0x8134 | game_ui_enable | 0 | void | WIRED | Enable UI input
0x8136 | gfade_out | 1 (time) | void | WIRED | Fade screen to black
0x8137 | gfade_in | 1 (time) | void | WIRED | Fade screen in
0x8138 | item_caps_total | 1 (obj) | int | WIRED | Get caps (money) amount
0x8139 | item_caps_adjust | 2 (obj,amount) | void | WIRED | Add/remove caps
0x813C | critter_mod_skill | 3 (obj,skill,amount) | int | WIRED | Modify critter skill
0x8145 | use_obj_on_obj | 2 (item,target) | void | WIRED | Use item on object
0x8147 | move_obj_inven_to_obj | 2 (src,dst) | void | WIRED | Move entire inventory
0x8149 | obj_art_fid | 1 (obj) | int | WIRED | Get object FRM FID
0x814A | art_anim | 1 (fid) | int | WIRED | Extract anim field from FID
0x814B | party_member_obj | 1 (pid) | obj | WIRED | Get party member by PID
0x814C | rotation_to_tile | 2 (src,dst) | int | WIRED | Direction from src to dst tile
0x814E | gdialog_set_barter_mod | 1 (mod) | void | WIRED | Set barter modifier
0x8150 | obj_on_screen | 1 (obj) | bool | WIRED | Is object visible on screen?
0x8151 | critter_is_fleeing | 1 (obj) | bool | WIRED | Is critter in flee state?
0x8152 | critter_set_flee_state | 2 (obj,state) | void | WIRED | Set flee state
0x8153 | terminate_combat | 0 | void | WIRED | End combat
0x8154 | debug_msg | 1 (msg) | void | WIRED | Debug print (no-op in release)

CE source: `src/scripts.cc` (registration), `src/scripts_impl.cc` or similar (implementations)

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
