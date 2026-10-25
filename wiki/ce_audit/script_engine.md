# CE parity audit — script engine (VM, script lifecycle, event queue, sfall)

Scope: CE files `scripts.cc`, `interpreter.cc`, `queue.cc`, `export.cc`, `dictionary.cc`, `nevs.cc`, `sfall_opcodes.cc`, `sfall_arrays.cc`, `sfall_metarules.cc`, `sfall_global_vars.cc`, `sfall_global_scripts.cc`, `sfall_lists.cc`, `sfall_ini.cc`, `sfall_kb_helpers.cc`, `sfall_config.cc`. DH2 files `src/vm.ts`, `src/vm_bridge.ts`, `src/intfile.ts`, `src/scripting.ts` (non-opcode parts: dispatchers, loading, `timeEventList`), `src/gameTick.ts`, `src/heart.ts`, `src/gametime.ts`, `src/events.ts`, `src/sfallArrays.ts`, `src/sfallIni.ts`, `src/lua/*.ts`, `src/map/GameMap.ts`, `src/map/mapLoader.ts`, `src/object/Obj.ts` / `Critter.ts` (spatials), `src/saveload.ts` (queue persistence). Audited 2026-10-24.

The opcode *intrinsics* in `interpreter_extra.cc` (`add_timer_event`, `metarule3`, `message_str`, …) belong to a different audit. They come up here only where they touch the queue or the script lifecycle.

## Summary

| Status | Count (function rows) |
|---|---|
| ✅ MATCH | 78 |
| ⚠️ DIFFERS | 25 |
| ❌ MISSING | 24 (19 of them are core VM ops / sfall subsystems that no shipped vanilla script uses) |
| 🟡 PARTIAL | 21 |
| 🚫 N/A | 46 |

Top findings, most severe first:

1. **SCR-01 (HIGH, VM backend): an uncaught script exception stops the whole game loop.** Only `VMFatalError` is caught (`vm.ts:524`). Other errors are thrown as JS strings or `Error`s: data-stack underflow, a wrong argument count, an unknown `lookup_string_proc` name, or an intrinsic that throws. These escape through `tickGame` into `heart._tick`. That function re-arms `requestAnimationFrame` only after `_stepOnly` returns (`heart.ts:248-250`), so the frame loop dies. A timed event that throws is spliced only after `fn()` runs (`gameTick.ts:258-260`), so it fires and throws again on every tick. CE turns all of these into `programFatalError`, which ends only that procedure.
2. **SCR-02 (MED-HIGH): `game_time` is a snapshot, not the live clock.** `vm_bridge.ts:58` reads `s.game_time`, which only some dispatchers set. `timedEvent`, `use`, `useSkillOn`, `pickup`, `drop`, `useObjOn*` and `isDropping` never refresh it. A value read after `game_time_advance` in the same procedure is stale too. CE `opGetGameTime` returns `gameTimeGetTime()`. Both backends are affected; Lua reads the same reader.
3. **SCR-03 (MED): the game clock keeps running in combat.** `gameTick.ts:216` adds one tick every 100 ms during combat. CE `_script_chk_timed_events` only does `if (!isInCombat()) gGameTime += 1`, so its combat time comes only from the 5 s per round. DH2's per-tick event countdown is also frozen in combat, so script timers, drugs and knockouts fall behind the clock.
4. **SCR-04 (MED): `map_update_p_proc` cadence.** A map load runs it twice: `doEnterNewMap`, then `changeElevation(…, updateScripts=true)` (`mapLoader.ts:202-205`, `363-366`). CE's second trigger, every 30 s of real time in `_script_chk_timed_events`, is missing. DH2 also skips map updates during combat, while CE runs both paths in combat.
5. **SCR-05 (MED): map-load proc order and `start`.**
   - DH2 never runs `start` for the map script or for spatial scripts; CE `scriptsExecStartProc` runs it for every script list.
   - Object `start` procs run when the objects are created, before the map script's `map_enter_p_proc`. CE runs the map script's `map_enter_p_proc` first, then every script's `start`, then the other scripts' `map_enter_p_proc`.
   - `fixed_param` for object `map_enter_p_proc` (CE: `(mapHeader.flags & 1) == 0`) is never set.
6. **SCR-06 (MED, VM backend): intrinsic results are not normalised.** `bridged()` pushes `null`, `undefined` and booleans as they are, and comparisons push JS booleans. So `obj == 0` is false for a `null` object; CE compares a null pointer with 0 as equal. The Lua backend normalises these values (`luaRuntime.ts sslValue`), so the two backends disagree.
7. **SCR-07 (MED): script requests run at once instead of being deferred.** `attack_setup` / `attack_complex` → `Combat.start`, `explosion`, `world_map` and `endgame_*` all run inside the calling procedure. CE queues them (`scriptsRequest*`) and handles them in `scriptsHandleRequests` after the script has returned.
8. **SCR-08 (MED): a script survives a fatal error.** After `programFatalError`, CE leaves `PROGRAM_FLAG_EXITED|0x04` set. `scriptExecProc` then returns early (`flags & 0x0124`), so that script never runs again on the map; nimyrdor's recursion overflow, for example, disables Myron's script. DH2 resets `aborted` and keeps running the script.
9. **SCR-09 (MED): the dude has no script.** CE `scriptsSetDudeScript` gives `gDude` the script `obj_dude.int` (sid 0x4000000), so it takes part in the critter round-robin and receives `add_timer_event(dude_obj, …)`. DH2's player has no `_script`, so `add_timer_event` on `dude_obj` warns and is dropped. Impact unverified.
10. **SCR-10 (MED, save/load): saved queue events are matched to their object by PID** (`saveload.ts:423`), not by object id. Knockout, flare, explosion and trickle events on a scripted object end up in the `obj?._script` branch and are replayed as `timed_event_p_proc` with `fixed_param = 'knockout'` (and so on).

## Function table

### scripts.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| gameTimeGetTime | gametime.ts `getTime` | ✅ | | |
| gameTimeGetDate | gametime.ts `getDate` | ✅ | | Same result as CE's `(days+gStartDay)%365` walk from July, with gStartDay = 24 |
| gameTimeGetHour | gametime.ts `getHourMilitary`; vm_bridge.ts:57 | ✅ | | Read live |
| gameTimeGetTimeString | gametime.ts `getTimeString` | ⚠️ | LOW | DH2 shows `h:mm AM/PM`; CE shows `%d:%02d` in 24 h. Cosmetic |
| gameTimeSetTime | gametime.ts `setTime` | ✅ | | The 0 → 1 clamp is kept |
| gameTimeAddTicks | gametime.ts `advanceTicks`; gameTick.ts:216-225 | 🟡 | LOW | The 13-year TIMEOUT check runs only on the 10 Hz tick path, not on a jump, so it fires on the next tick |
| gameTimeAddSeconds | gametime.ts `advanceSeconds` | ✅ | | |
| gameTimeScheduleUpdateEvent | gameTick.ts `lastMidnightDay`, `nextMapUpdateTick` | 🟡 | LOW | Midnight is a day-number compare. `nextMapUpdateTick` is never reset on map load; CE schedules +600 ticks from the load |
| gameTimeEventProcess | gameTick.ts `processMidnightForDay` | 🟡 | LOW | Midnight unjam, story check and rads are done. CE skips the story check while a dialogue is active and skips everything while a movie plays; DH2 can run it from `game_time_advance` inside a dialogue |
| _scriptsCheckGameEvents | gameTick.ts `scriptsCheckGameEvents` | ✅ | LOW | Day thresholds are hard-coded to the sfall defaults 90/180/270/360; CE reads them from ddraw.ini |
| mapUpdateEventProcess | gameTick.ts:273-281 | ⚠️ | MED | SCR-04: blocked in combat |
| scriptsNewObjectId | Obj uid | 🟡 | | Not compared in detail |
| scriptGetSid / scriptGetSelf / scriptSetObjects / scriptSetFixedParam / scriptSetActionBeingUsed | scripting.ts dispatchers 3366-3731 | 🟡 | MED | Context is set per dispatcher; `game_time` is stale (SCR-02) |
| scriptsCreateProgramByName | scripting.ts:3287 `loadScript` | ✅ | | Also loads Lua, mods and stubs (DH2-only) |
| _doBkProcesses | gameTick.ts `tickGame` | 🟡 | | DH2 has no `_updatePrograms` burst (documented, scripting_vm.md §11) |
| _script_chk_critters | gameTick.ts:296-314 | ✅ | LOW | One `critter_p_proc` per 60 Hz pass, round-robin. DH2 rotates only over live critters of the current elevation; CE over the whole critter script list (dead and off-elevation ones included, unverified) |
| _script_chk_timed_events | gameTick.ts:216-282 | ⚠️ | MED | SCR-03, SCR-04. Ignores `stopProcess`; only the rest loop uses `queueBail` |
| _scrSetQueueTestVals / _scrQueueRemoveFixed | scripting.ts:936 (metarule3 100) | ⚠️ | LOW | CE clears **every** EVENT_TYPE_SCRIPT event of that object with that fixed param; DH2 removes only the first match, of any type |
| scriptAddTimerEvent | scripting.ts:3080 `add_timer_event` | ✅ | | Relative ticks, bound to `obj._script` |
| scriptEventWrite / scriptEventRead | saveload.ts:223, 420-482 | 🟡 | MED | SCR-10 |
| scriptEventProcess | scripting.ts:3372 `timedEvent` | 🟡 | MED | `fixed_param` is set. `self_obj`, `game_time` and `cur_map_index` are not refreshed (SCR-02) |
| scriptsClearPendingRequests / _scripts_clear_combat_requests | — | ❌ | LOW | No request flags (SCR-07) |
| scriptsHandleRequests | gameTick.ts:126-127 (`processMapTransition`, `processDialogueRequest`), 136 (`deleteAllTempArrays`) | 🟡 | MED | Dialogue and map transition are deferred as in CE; combat, explosion, world map, elevator and endgame run at once (SCR-07) |
| _scripts_check_state_in_combat | — | ❌ | LOW | Elevator / looting requests made in combat |
| scriptsRequestCombat / _scripts_request_combat_locked | scripting.ts:1734, 2645 `Combat.start` | ⚠️ | MED | Runs at once (SCR-07) |
| scripts_request_townmap / scriptsRequestWorldMap | scripting.ts:2686 `world_map` → `uiWorldMap()` | ⚠️ | LOW | Runs at once. CE also sets `_game_user_wants_to_quit = 1` in combat |
| scriptsRequestElevator | metarule 15 → `useElevator` | 🟡 | | Not compared in detail (elevator audit) |
| scriptsRequestExplosion | scripting.ts:3030 `explosion` | ⚠️ | LOW | Explodes inside the script (SCR-07) |
| scriptsRequestDialog | scripting.ts:2853 → `processDialogueRequest` | ✅ | | Deferred |
| scriptsRequestEndgame | scripting.ts:3145 | ⚠️ | LOW | Starts the async slideshow at once; CE plays the slideshow and then the movie from the request |
| scriptsRequestLooting / scriptsRequestStealing | (other audit) | 🟡 | | |
| _script_make_path | — | 🚫 | | Paths are built in `loadScript` |
| scriptExecProc | dispatchers in scripting.ts; vm.ts:367 `call` | ⚠️ | MED | SCR-08 (dead after a fatal error), SCR-11 (missing proc → procedure index 1). `scriptOverrides = 0` → `_didOverride = false` ✅; `source` is not cleared afterwards |
| scriptLocateProcs / scriptHasProc | intfile.ts `procedures` map | ⚠️ | LOW | Case-sensitive name lookup; CE `programFindProcedure` uses `stricmp` |
| scriptsLoadScriptsList / scriptsFreeScriptsList / _scr_find_str_run_info / scriptsGetFileName | `lookupScriptName` | 🟡 | LOW | The scripts.lst `local_vars=` count is not used (no LVAR bounds) |
| scriptsSetDudeScript / scriptsClearDudeScript | — | ❌ | MED | SCR-09 |
| scriptsInit / _scr_reset / _scr_game_init / scriptsReset / scriptsExit / _scr_message_free / _scr_game_exit | scripting.ts:3733 `reset`, 3749 `init`, 358 `resetGameState` | ✅ | | |
| scriptsEnable / scriptsDisable / _scr_enable_critters / _scr_disable_critters | `Config.engine.doLoadScripts` / `doUpdateCritters` | 🟡 | LOW | Static config flags, not CE's runtime toggles (elevator, map load) |
| scriptsSaveGameGlobalVars / LoadGameGlobalVars / SkipGameGlobalVars | saveload.ts gvars | ✅ | | |
| _scr_header_load / scriptWrite / scriptListExtentWrite / scriptSaveAll / scriptRead / scriptListExtentRead / scriptLoadAll | Obj serialize `_script.lvars`, `dirtyMapCache` | 🟡 | | Note only: per-object JSON instead of script lists |
| scriptGetScript / scriptGetNewId / scriptAdd / scriptsRemoveLocalVars / scriptRemove / _scr_remove_all / _scr_remove_all_force | — | 🚫 | | JS object ownership. `scriptRemove`'s removal of the owner's SCRIPT events is done by `destroy_object` / `rm_timer_event` ✅ |
| scriptGetFirstSpatialScript / scriptGetNextSpatialScript | GameMap.ts:104 `getSpatials` | ✅ | | |
| _scr_spatials_enable / _scr_spatials_disable | Critter.ts `spatialsBusy` | 🟡 | LOW | CE also turns spatials off during map_enter / map_update / explode_scenery |
| scriptsExecSpatialProc | Critter.ts:285-298, Obj.ts:474 `hitSpatialTrigger` | 🟡 | LOW | Hidden / flat / tile < 10 / re-entry checks ✅. DH2 uses the current elevation's spatials, CE the object's elevation. In CE only `_object_move` (animated, non-straight) triggers |
| scriptsExecStartProc | GameMap.ts:400, Obj.ts:731/767 `initScript` | ⚠️ | MED | SCR-05 |
| scriptsExecMapEnterProc | GameMap.ts:445-468 `doEnterNewMap` | ⚠️ | MED | SCR-05 |
| scriptsExecMapUpdateProc | GameMap.ts:207 `updateMap`, 273 | ⚠️ | MED | SCR-04 (runs twice at load) |
| scriptsExecMapUpdateScripts | scripting.ts:3643 `updateMap`, 3673 `enterMap`, 3721 `objectEnterMap` | 🟡 | LOW | Map script first ✅. Then objects in array order, then spatials; CE goes by script list type. Inventory items' scripts are not iterated (unverified whether DH2 gives them scripts) |
| scriptsExecMapExitProc | mapLoader.ts:139-155 | ✅ | | `_queue_leaving_map` first, party excluded |
| scriptsGetMessageList / _scr_get_msg_str / _scr_get_msg_str_speech | scripting.ts:458 `getScriptMessage`, 483 `speakScriptMessage` | 🟡 | LOW | Missing message → "Error" ✅; lips ✅. The special pairs (0,0) / (−1,−1) → "" and (−2,−2) → proto.msg 650 are not handled |
| scriptGetLocalVar / scriptSetLocalVar | scripting.ts:701-711 | ✅ | LOW | Unset = 0 ✅. CE refuses LVARs in map/system scripts (−1); DH2 allows them |
| _scr_end_combat | — | ✅ | | Dead code in CE: `_combat_ending_guy` is set only after this returns true (combat.cc:5370-5376), so the map's `combat_p_proc` is never reached |
| _scr_explode_scenery | combat/explosion.ts:85 | ✅ | | See the combat audit |

### interpreter.cc

| CE function | DH2 counterpart | Status | Sev | Notes |
|---|---|---|---|---|
| _defaultTimerFunc / _defaultFilename_ / _interpretMangleName / _outputStr / _checkWait / _interpretOutputFunc / _interpretOutput / programGetCurrentProcedureName | `dbg` / `dbgWarn` | 🚫 | | Debug output |
| stackReadInt16/32, stackWriteInt16/32, stackPushInt16/32, stackPopInt16/32 | BinaryReader | 🚫 | | |
| _interpretIncStringRef / _interpretDecStringRef / programMarkHeap / programPushString | JS strings | 🚫 | | Documented (scripting_vm.md §11) |
| _detachProgram / _purgeProgram / programFree | GC | 🚫 | | |
| programCreateByPath | intfile.ts `parseIntFile` + `GameScriptVM` | ✅ | | Procedure flags (timed / conditional / critical / imported) are read but dropped |
| _getOp | vm.ts:491 | ✅ | | |
| programGetString / programGetIdentifier | vm.ts:212-246 (0x9001) | 🟡 | LOW | DH2 chooses identifier or string by peeking at the next opcode (0x8014/15/16); CE decides in the consumer. Same result for sslc output |
| opNoop (0x8000) | — | ❌ | LOW | Unused |
| opPush (0x8001) | — | ❌ | LOW | DH2 implements the typed forms 0xC001 / 0xA001 / 0x9001 (the opcode word carries the type in CE too) |
| opPushBase / opPopBase / opPopToBase / opSetGlobal | vm.ts:105-127 | ✅ | | |
| opDump (0x802E) | — | ❌ | LOW | Unused (scan, scripting_vm.md §9.2) |
| opDelayedCall / opConditionalCall / opWait / opCancel / opCancelAll (0x8006, 0x8007, 0x8047-0x8049) | — | ❌ | LOW | Unused by shipped scripts |
| opIf / opWhile | vm.ts:146, 183 | ✅ | LOW | `""` is false in DH2; a CE string is false only at offset 0 |
| opStore / opFetch | vm.ts:151-157 | ✅ | | The float box is kept |
| opConditionalOperatorEqual / NotEqual / LessThanEquals / GreaterThanEquals / LessThan / GreaterThan | vm.ts:252-269 `binop` | ⚠️ | MED | SCR-06: JS loose comparison. `null == 0` is false (CE ptr == int 0 is true); string vs number goes through JS ToNumber, CE through `sprintf` + `strcmp` (`"05" == 5` is true in DH2, false in CE); pushes a boolean, not an int |
| opAdd | vm.ts:72 `arith`, 291 | ⚠️ | LOW | String concat and `%.5f` ✅. int + int overflow: CE pushes a float, DH2 a JS number above 2³¹. A pointer + string concatenates `[object Object]` (CE `%p`) |
| opSubtract / opMultiply | vm.ts:292-293 | ⚠️ | LOW | No 32-bit wraparound. A string operand gives NaN; CE pushes nothing (leaves the stack short) |
| opDivide | vm.ts:299 | ✅ | | int/int truncates (`|0`), float division, fatal on /0 |
| opModulo | vm.ts:294 | ⚠️ | LOW | CE: a float operand is fatal ("Trying to MOD a float"); DH2 computes a JS `%` |
| opLogicalOperatorAnd / Or | vm.ts:271-276 | ✅ | | Push 0/1 |
| opLogicalOperatorNot | vm.ts:249 | ⚠️ | LOW | Pushes a JS boolean, not an int |
| opUnaryMinus | vm.ts:158 | ✅ | LOW | A string gives NaN; CE "Invalid arg given to NEG" (fatal) |
| opBitwiseOperatorNot / And / Or / Xor | vm.ts:277-290 | ✅ | | |
| opFloor | vm.ts:162 | ✅ | LOW | A string gives NaN; CE fatal |
| opSwapReturnStack (0x8019) | vm.ts:112 | ✅ | | |
| opLeaveCriticalSection / opEnterCriticalSection (0x8002/3) | vm.ts:87, 104 (no-op) | 🚫 | | DH2 runs every call to completion; documented |
| (0x804A / 0x804B alternate critical slots) | — | ❌ | LOW | Unused |
| opJump | vm.ts:101 | ✅ | | |
| opCall | vm.ts:207 | ✅ | | The CRITICAL flag is ignored; CE does nothing for an IMPORTED procedure either |
| opPopFlags / opPopReturn / opPopExit / opPopFlagsReturn / opPopFlagsExit / opPopFlagsReturnValExit / …Extern (0x801D-0x8026) | vm.ts:137 (0x801C only); `call()` pops the 3 call words (vm.ts:387-389, 426) | 🟡 | | Equivalent for game procs: DH2 uses a −1 return sentinel instead of CE's header exit stubs (`_setupCall` return address 20/24/28/32). The extern variants are ❌ (no cross-program calls) |
| opPopAddress (0x801E) | — | ❌ | LOW | Unused |
| opAtoD / opDtoA | vm.ts:92-97 | ✅ | | |
| opExitProgram (0x8010) | vm.ts:142 | ✅ | | |
| opStopProgram (0x8011) | — | ❌ | LOW | Unused |
| opFetchGlobalVariable / opStoreGlobalVariable | vm.ts:128-135 | ✅ | | |
| opSwapStack (0x8018) | — | ❌ | LOW | Unused by shipped scripts |
| opFetchProcedureAddress (0x802D) | — | ❌ | LOW | Unused |
| opPop / opDuplicate | vm.ts:98, 179 | ✅ | | |
| opStoreExternalVariable / opFetchExternalVariable / opExportVariable | vm_bridge.ts:100-102 | 🟡 | LOW | Stored as properties on the map script object. A missing variable gives `undefined` (CE: fatal "does not exist"); a re-export resets to 0 (CE: fatal "already exists"); a name can shadow a `Script` member |
| opExportProcedure (0x8017) | — | ❌ | LOW | No cross-program procedures; unused |
| opExit (0x800E) / opDetach (0x800F) / opCallStart / opSpawn / forkProgram / opFork / opExec (0x8008-0x800B) | — | ❌ | LOW | Child programs; `detach` only appears in unlisted scripts (scripting_vm.md §9.2) |
| opCheckProcedureArgumentCount | vm.ts:197 | ⚠️ | MED | Throws a plain string (not `VMFatalError`) → SCR-01 |
| opLookupStringProc | vm.ts:192 | ⚠️ | LOW | Case-sensitive; can match index 0 (CE starts at 1); an unknown name throws a TypeError → SCR-01 |
| interpreterRegisterOpcodeHandlers / interpreterRegisterOpcode | vm.ts `opMap` + vm_bridge.ts:361 | ✅ | | |
| _interpretClose | — | 🚫 | | |
| _interpret | vm.ts:485 `step`, 519 `run` | ⚠️ | MED | No burst limit (documented). An unknown opcode makes `step()` return false: a silent halt with a warning (CE fatal). `call()` then finds the −1 sentinel still on the return stack and stores the frame as a **suspended dialogue frame** (vm.ts:407-421) — see SCR-12 |
| _setupCallWithReturnVal / _setupCall | vm.ts:387-395 | ✅ | | Pushes flags, checkWaitFunc and windowId as 0 |
| _setupExternalCallWithReturnVal / _setupExternalCall | — | ❌ | LOW | No imported procedures |
| _executeProc | — | ❌ | LOW | Only for timed / conditional procs (unused) |
| programFindProcedure | intfile.ts `procedures[name]` | ⚠️ | LOW | Case-sensitive |
| _executeProcedure | vm.ts:367 `call` | ✅ | | Saves and restores pc / offset / halted / dvarBase around nested runs, as CE saves `env`. Fatal error → returns 0 ✅ |
| _doEvents | — | ❌ | LOW | Unused (documented) |
| programListNodeFree / programListNodeCreate / runProgram / runScript / _updatePrograms / programListFree / interpreterPrintStats | — | 🚫 | | Event-driven model (documented) |
| programStackPushValue (overflow > 0x1000) | vm.ts:337 | ✅ | | `VMFatalError` |
| programStackPopValue (underflow) | vm.ts:345 | ⚠️ | HIGH | Throws a string, not `VMFatalError` → SCR-01 |
| programStackPopInteger / Float / String / Pointer (type checks) | vm.ts `pop` | ⚠️ | LOW | No type check; CE: fatal "integer expected" and so on |
| programStackPushInteger / Float / String / Pointer | vm.ts `push`, `vmFloat` | ✅ | | Floats are boxed |
| programReturnStackPush* / Pop* | vm.ts `retStack`, 511 (overflow) | ✅ | | Underflow throws a string → SCR-01 |
| ProgramValue::isEmpty / isInt / isFloat / asFloat / isString / isPointer / asInt / ctors | `unbox`, `isVMFloat`, `sslTrue` | ✅ | | |

### queue.cc

| CE function | DH2 counterpart | Status | Sev | Notes |
|---|---|---|---|---|
| queueInit / queueExit | — | 🚫 | | |
| queueLoad / queueSave | saveload.ts:223, 416-482 | 🟡 | MED | SCR-10. CE matches objects by id; DH2 by PID (the first object with that PID wins) |
| queueAddEvent | `timeEventList.push` (scripting.ts, drugs.ts, radiation.ts, combat/results.ts, Obj.ts, miscItem.ts, skillUse.ts) | 🟡 | LOW | Relative countdown instead of absolute time. Ties keep insertion order (= CE FIFO). Counts down only outside combat (SCR-03) |
| queueRemoveEvents | scripting.ts:3094 `rm_timer_event`; `destroy_object`; gameTick.ts:246 (dead critter) | ✅ | | CE combat.cc:4799 removes on death; DH2 drops events whose owner is dead |
| queueRemoveEventsByType | various (knockout, sneak, party) | ✅ | | |
| queueHasEvent | `timeEventList.some(...)` | ✅ | | |
| queueProcessEvents | gameTick.ts:240-262 (per tick), 70-85 `processTimeJump` | ⚠️ | LOW | Due-time order on a jump ✅. The per-tick path ignores `stopProcess`, and removing other events from inside `fn()` shifts the indices of the live loop (events can be skipped). `fn()` runs before the splice (SCR-01 repeat) |
| queueClear | scripting.ts:363 `resetGameState` | ✅ | | |
| _queue_clear_type | ad hoc filters | ✅ | | |
| queueGetNextEventTime / queueIsEmpty | — | 🚫 | | Not needed with countdowns |
| flareEventProcess | Obj.ts flare (72000 ticks, `burnOut`) | ✅ | | Map-leave clear ✅ |
| explosionEventProcess / explosionFailureEventProcess / _queue_do_explosion_ | Obj.ts explosive timer | ✅ | | C32 |
| _queue_explode_exit | Obj.ts `leaveMap` | ✅ | | C39 (detonates at once, no animation) |
| _queue_leaving_map | scripting.ts:222 `queueLeavingMap` | ✅ | | C39 |
| queueFindFirstEvent / queueFindNextEvent | `timeEventList` filters | ✅ | | |
| Event types: drug, knockout, withdrawal, script, poison, radiation, flare, explosion, trickle, sneak, explosion failure, ambient sfx | drugs.ts, combat/results.ts, scripting.ts, radiation.ts, Obj.ts, miscItem.ts, skillUse.ts, audio.ts | ✅ | | All 14 CE types are present; game-time and map-update use counters (see scripts.cc rows) |

### export.cc / dictionary.cc / nevs.cc

| CE function | DH2 counterpart | Status | Sev | Notes |
|---|---|---|---|---|
| _hashName / externalVariableFind / externalVariableAdd / externalVariableSetValue / externalVariableGetValue / externalVariableCreate / externalVariablesClear / _exportClearAllVariables | vm_bridge.ts:100-102; Lua `__host_get_ext` / `__host_set_ext` | 🟡 | LOW | Per-map-script property bag instead of a global table; it is cleared because the map script object is replaced on map change |
| externalProcedureFind / externalProcedureAdd / externalProcedureGetProgram / externalProcedureCreate / _removeProgramReferences / _initExport | — | ❌ | LOW | No cross-program procedure calls; unused by shipped scripts |
| dictionary* (14 functions) | — | 🚫 | | Generic hash dictionary used by the interpreter_lib / DB layers; not script-visible |
| _nevs_* (10 functions) | — | 🚫 | | `interpreter_lib` named events (window programs); not used by game scripts |

### sfall_*.cc

| CE function / subsystem | DH2 counterpart | Status | Sev | Notes |
|---|---|---|---|---|
| sfall_opcodes.cc opcode table (83 opcodes) | vm_bridge.ts:195-236 | 🟡 | MED (mods) | 36 of 83 are bridged (arrays, ini, proto data, ammo, pc stats, script, party list, sfall_func0-2, abs, explosions_metarule, path, blocking), plus 4 not in CE (0x815F-0x8161, 0x81F8). Missing 47 include 0x8193 active_hand, 0x819D/0x819E sfall gvars, 0x81EB get_ini_string, 0x81EC sqrt, 0x8237 atoi, 0x8238 atof, 0x824E substr, 0x824F strlen, 0x8253 typeof, 0x8263 `^`, 0x8267 round, 0x826B message_str_game, 0x827F div, 0x8279-0x827C sfall_func3-6, 0x820D-0x820F list_begin/next/end, 0x8164 game_loaded, 0x8170 in_world_map, 0x8171/0x8229 force_encounter, mouse / key / screen / version ops. SCR-12 |
| sfall_arrays.cc (CreateArray … StackArray, DeleteAllTempArrays, sfallArraysReset) | sfallArrays.ts | ✅ | LOW | Faithful port. Int and float are told apart by `Number.isInteger`, because `bridged()` unboxes floats, so `2.0` is stored as INT (documented in the file header) |
| sfall_metarules.cc (18 metarules) | scripting.ts:2346-2364 | 🟡 | LOW | `combat_data` and `get_object_data` (Attack offsets only); the other 16 warn and return 0 |
| sfall_global_vars.cc (store / fetch / save / load) | — | ❌ | LOW | Opcodes 0x819D/0x819E missing; planned in upu_support.md |
| sfall_global_scripts.cc (gl_* scripts) | — | ❌ | LOW | Documented deviation (upu_support.md item 5: the killap `gl_k_*` scripts need sfall hooks CE lacks) |
| sfall_lists.cc (sfallListsCreate / GetNext / Destroy / fill) | scripting.ts `list_as_array` → sfallArrays.ts `arrayFromObjects` | 🟡 | LOW | Only `list_as_array`; `list_begin/next/end` missing |
| sfall_ini.cc (parse_ini_triplet / get_int / get_string / set_*) | sfallIni.ts | 🟡 | LOW | DH2 needs exactly 3 `|` parts (CE: the key is the rest, so it may contain `|`). Files are cached per page load (CE re-reads on every call). No `set_ini_setting`; no sfall base path (DH2 reads `data/<file>`) |
| sfall_kb_helpers.cc | — | ❌ | LOW | key_pressed / tap_key opcodes missing |
| sfall_config.cc | gametime.ts constants, gameTick.ts ARTIMER_DAYS, config.ts | 🟡 | LOW | Start date and artimer days are hard-coded to the defaults; ddraw.ini `[Misc]` overrides are ignored |

### Lua backend (src/lua/) vs CE semantics

| Area | DH2 | Status | Sev | Notes |
|---|---|---|---|---|
| opAdd string concat | prelude.ts `string_mt.__add`, `text()` | ✅ | | `%.5f` / `%d` |
| opDivide / opModulo / opFloor | prelude.ts `div` / `mod` / `floor` | ✅ | LOW | Float MOD computes instead of the CE fatal error; 64-bit ints, no 32-bit wrap |
| comparisons | plain Lua `==` / `<` | ⚠️ | LOW | Comparing a string with a number using `<` raises a Lua error and aborts the procedure; CE uses `strcmp` |
| truthiness | prelude.ts `truthy` | ⚠️ | LOW | `""` is false in AND/OR; the VM's `sslTrue` says a string is always true (backends disagree) |
| intrinsic results | luaRuntime.ts `sslValue` | ✅ | | null → 0, boolean → 0/1 (better than the VM, SCR-06) |
| fatal errors | prelude.ts `step` (catches, returns 0) | ✅ | | Robust against SCR-01; CE's "script dead after a fatal error" (SCR-08) is not modelled |
| recursion limit | prelude.ts `MAX_RECURSION = 0x1000 // 3` | 🟡 | | Documented approximation |

## Detailed findings

### SCR-01 — non-fatal exceptions escape the VM and stop the game loop (HIGH, VM backend) — **FIXED 2026-10-24 (PA22)**
- **CE:** `interpreter.cc` `programFatalError` (`programStackPopValue` underflow, `opCheckProcedureArgumentCount`, `opLookupStringProc`, type-checked pops). `longjmp` to the running procedure's `setjmp` in `_interpret`; only that call ends.
- **DH2:**
  - `vm.ts:346` and `355` throw plain strings, `vm.ts:202` throws a string, and `vm.ts:194` hits a TypeError on an unknown name. Intrinsics also throw: `scripting.ts:772` `throw 'elevator given explicit type'`, `:726` `throw Error('set_map_var: no map script')`, and `combatEvent` / `pickup` / `useSkillOn` when the object has no script.
  - `vm.ts:524` rethrows anything that is not a `VMFatalError`, and `call()`'s `finally` restores pc but not the data stack.
  - Nothing above catches it: `gameTick.ts tickGame` → `heart.ts:250`. `_tick` calls `requestAnimationFrame` only after `_stepOnly` returns, so the frame loop stops.
  - A throwing timed event stays in the list: `gameTick.ts:258` calls `fn()` before the splice on line 260, so it throws again on every tick.
- **Impact:** A single broken script, a mod script, or an intrinsic edge case freezes the game on the VM backend (`script_backend=vm`, or installs without decompiled scripts). On the Lua backend `step()` catches these errors.
- **Fix:**
  - Throw `VMFatalError` for the stack underflows, the arg-count check and the lookup failure.
  - In `ScriptVM.run` (or `call`), also catch other exceptions coming from intrinsics: log them, set `aborted`, and reset the stacks to their depth at call time.
  - In `gameTick.ts`, splice a timed event before calling `fn()`, as `processTimeJump` already does.
  - Wrap `heart.update` in try/catch, or arm `requestAnimationFrame` first.
- **Ref:** NEW.

### SCR-02 — `game_time` is a stale snapshot (MED-HIGH) — **FIXED 2026-10-24 (PA11)**
- **CE:** `interpreter_extra.cc:2269 opGetGameTime` → `scripts.cc:283 gameTimeGetTime()`, read live on every access.
- **DH2:** `vm_bridge.ts:58 game_time: (s) => s.game_time`. The value is set only by `talk`, `updateCritter`, `spatial`, `destroy`, `damage`, `combatEvent`, `updateMap`, `objectEnterMap`, `objectRunProc`, `runViewProc` and `push` (`scripting.ts:3395-3726`). It is never set by `timedEvent` (3372), `use` (3404), `useSkillOn` (3522), `pickup`, `drop`, `isDropping`, `useObjOnItem`, `useObjOnMe`, or `initScript` (`start`). In those procs `game_time` is whatever an earlier proc of that script left there, or `undefined` for a fresh script. After `game_time_advance` inside a proc, the old value is returned.
- **Impact:** Script timers that store or compare `game_time` (cooldowns, "come back tomorrow") miscompute, mainly in `timed_event_p_proc` and `use_p_proc`. `game_time_in_seconds` and `game_time_hour` are live, so scripts disagree with themselves. This affects both backends (Lua reads the same reader).
- **Fix:** `game_time: () => globalState.gameTickTime` (CE has no 1-tick clamp in `opGetGameTime`; `gameTimeSetTime` already keeps the clock ≥ 1).
- **Ref:** NEW.

### SCR-03 — clock runs in combat; event countdown frozen (MED) — **FIXED 2026-10-25**
- **CE:** `scripts.cc:748 _script_chk_timed_events`. `gGameTime += 1` every 100 ms **only when not in combat**. The queue is still drained in combat, and combat time comes from `combat.cc:3071 gameTimeAddSeconds(5)` per round.
- **DH2:** `gameTick.ts:216` runs `globalState.gameTickTime++` on every 10 Hz tick, in combat too. The countdown at `gameTick.ts:238` is skipped in combat; only the 5 s jumps (`processTimeJump`) decrement events.
- **Impact:** In a long combat the clock gains real time (5 minutes of fighting = 3000 extra ticks), while drug, knockout, poison and script timers don't see that time. Effects:
  - `game_time_hour` and day thresholds move faster than in CE;
  - midnight can pass mid-combat;
  - after combat the timers are behind the clock.
- **Fix:** Guard the increment with `!globalState.inCombat`, as CE does.
- **Ref:** NEW; the time_clock.md §10 description omits the combat case.

### SCR-04 — map_update_p_proc cadence (MED) — **FIXED 2026-10-25**
- **CE:**
  - `map.cc:1010-1011`: `mapLoad` runs `scriptsExecMapUpdateProc` once.
  - `scripts.cc:507 mapUpdateEventProcess`: the queue event every 600 ticks.
  - `scripts.cc:762-767`: also `scriptsExecMapUpdateScripts` every 30000 ms of real time, unless the game state is 4 (dialogue). Both paths run in combat.
- **DH2:**
  - `mapLoader.ts:202+205` (dirty cache) and `363+366` (fresh load): `doEnterNewMap` runs `Scripting.updateMap` (GameMap.ts:471), then `changeElevation(…, true, …)` runs it again (GameMap.ts:273-277).
  - `gameTick.ts:273` gates the 600-tick path with `!globalState.inCombat`.
  - There is no 30 s real-time path.
  - `nextMapUpdateTick` starts at 600 and is never reset, so the first tick of a game also fires one.
- **Impact:** Some map scripts count, randomise or spawn in `map_update_p_proc`; they run twice per load and about half as often as in CE afterwards (CE: every ≤ 30 s plus every game minute). No updates in combat.
- **Fix:** Drop the second `updateMap` at load (call `changeElevation(…, false, …)` after `doEnterNewMap`). Add a 30 s `performance.now()` timer that is skipped in dialogue. Allow both paths in combat. Reset `nextMapUpdateTick = now + 600` on map load.
- **Ref:** NEW.

### SCR-05 — map-load procs: `start`, order, `fixed_param` (MED) — **PARTLY FIXED 2026-10-25**
- **CE `map.cc mapLoad`:**
  1. `scriptSetFixedParam(gMapSid, first visit)`, then the map script's `map_enter_p_proc` with spatials off (`map.cc:963-975`).
  2. The party is placed.
  3. `scriptsExecStartProc` (`scripts.cc:2570`): `start` for every script of every list — map, spatial, item, critter.
  4. `scriptsExecMapEnterProc`: every non-map script gets `fixed_param = (gMapHeader.flags & 1) == 0`, then its `map_enter_p_proc` (`scripts.cc:2601-2669`).
  5. `scriptsExecMapUpdateProc`.
- **DH2:**
  - Object `start` runs in `Obj` script loading (`Obj.ts:731, 767`), while the objects are being created and before the map script's `map_enter_p_proc`.
  - The map script (`mapLoader.ts:300`) and spatial scripts (`mapLoader.ts:322-327`, "no need to initialize here") never get `start`. `runLoadGameProcs` (`GameMap.ts:400`) is the same.
  - `objectEnterMap` (`scripting.ts:3721`) does not set `fixed_param`.
- **Impact:** Vanilla map and spatial `start` procs are mostly empty (unverified for all 1288 scripts). Any setup a script does in `start` is skipped. Object `start` code that reads MVARs or GVARs set by the map script's `map_enter_p_proc` sees the old values. Scripts that test `fixed_param` in `map_enter_p_proc` get a stale value.
- **Fix:** After the map script's `map_enter_p_proc`, run `initScript` (`start`) for the map script, the spatials and all objects. Set `fixed_param` before each object's `map_enter_p_proc`.
- **Ref:** NEW. C61 covers the load-game path only.

### SCR-06 — VM: loosely typed values in comparisons (MED, VM backend) — **FIXED 2026-10-25**
- **CE:** `interpreter.cc:865-1410`, the comparison operators switch on `VALUE_TYPE_*`. int vs ptr compares the pointer value, so a null object equals 0. int vs string formats with `%d` and uses `strcmp`. They push an int 0/1.
- **DH2:** `vm.ts:252-269` uses JS `==` / `<`. `vm_bridge.ts:37-39` pushes the raw intrinsic result: `null` (e.g. `critter_inven_obj` at `scripting.ts:1494-1504`, `create_object_sid` refusals at 1895-1902), `undefined` (`map_var` without a map script) or booleans. `null == 0` and `undefined == 0` are false.
- **Impact:** SSL like `if (obj == 0)` or `if (item != 0)` takes the wrong branch on the VM backend. Booleans also reach intrinsics and GVAR/LVAR storage as `true` / `false`. The Lua backend normalises (`luaRuntime.ts sslValue`), so the two backends disagree.
- **Fix:** Normalise in `bridged()` and `builtin()` (null/undefined → 0, boolean → 0/1), and push `+result` from the comparison ops and `!`.
- **Ref:** NEW.

### SCR-07 — script requests run at once (MED) — **FIXED 2026-10-25**
- **CE:** `scripts.cc:894 scriptsHandleRequests`, called from the game loop after the script returns. Combat (`_combat`), town map, world map, elevator, explosion (`actionExplode`), dialogue, endgame (slideshow, then movie), looting and stealing are all deferred through `gScriptsRequests`.
- **DH2:** Dialogue and `load_map` are deferred (`scripting.ts:3435-3459`). The others run inside the intrinsic:
  - `attack_setup` / `attack_complex` → `Combat.start` (`scripting.ts:1734`, `2645`);
  - `explosion` → `explode` (`3030`);
  - `world_map` → `uiWorldMap` (`2686`);
  - `endgame_slideshow` / `endgame_movie` start async at once (`3145-3160`).
- **Impact:** The rest of the calling procedure runs with combat already started, or the explosion already applied: critters can be dead before the script's next line, and `combat_is_initialized` changes mid-proc. An `attack_setup` from a dialogue node starts combat while the dialogue is still unwinding; CE starts it after the dialogue ends.
- **Fix:** Add a request bitfield as CE has, and handle it at the start of `tickGame` next to `processDialogueRequest`.
- **Ref:** NEW (C30 ported the combat-start data but not the deferral).

### SCR-08 — scripts keep running after a fatal error (MED) — **FIXED 2026-10-25**
- **CE:**
  - `interpreter.cc:2632-2636`: the `setjmp` return sets `program->flags |= PROGRAM_FLAG_EXITED | PROGRAM_FLAG_0x04`.
  - `scripts.cc:1302`: `if ((program->flags & 0x0124) != 0) return 0;`. Every later proc of that script is skipped until the script is loaded again on the next map load.
- **DH2:** `vm.ts:520-531` sets `aborted`, but the next `call` resets it, and `call` returns 0. The script keeps working.
- **Impact:** CE's visible behaviour after a fatal error is a dead NPC or object script. Myron (nimyrdor's `use_skill_on_p_proc` recursion overflow, per the vm.ts comment) and scripts that divide by zero keep reacting in DH2 but not in CE.
- **Fix:** Keep a per-VM `dead` flag that `call()` checks, reset by `loadScript`. Mirror it in Lua (`step` on error).
- **Ref:** NEW.

### SCR-09 — no obj_dude script (MED, impact unverified) — **FIXED 2026-10-25**
- **CE:** `scripts.cc:1460 scriptsSetDudeScript` (`object.cc:3649/3660`) gives the dude sid 0x4000000, script index 0 = `obj_dude.int`. It is in the critter list, so it gets the `critter_p_proc` round-robin and `start` / `map_enter` / `map_update`. Its `timed_event_p_proc` receives `add_timer_event(dude_obj, …)`.
- **DH2:** `globalState.player._script` is undefined. `add_timer_event` with `dude_obj` warns and does nothing (`scripting.ts:3073-3076`).
- **Impact:** Whatever `obj_dude.int` does (not inspected; no `.int` data in the repo) never happens. Any script's `add_timer_event(dude_obj, …)` is lost.
- **Fix:** Load `obj_dude` (scripts.lst index 1, 1-based) as the player's script at game start, and include it in the critter round-robin and the map proc loops.
- **Ref:** NEW.

### SCR-10 — queue save/load identity and type routing (MED, save/load) — **FIXED 2026-10-25**
- **CE:** `queue.cc:84 queueLoad` / `191 queueSave` store the event type, absolute time and owner **object id**. On load, each type's `readProc` rebuilds the event's data.
- **DH2:** `scripting.ts:375 getTimedEventsSerialized` stores `objPid` and the userdata. `saveload.ts:423` resolves the owner with `mapObjects.find(o => o.pid === ev.objPid)`, which picks the first same-PID object.
  - Only drug, withdrawal, sneak, radiation and poison are rebuilt.
  - Knockout, flare, explosion and trickle events on a scripted owner reach the `else if (obj?._script)` branch (`saveload.ts:450-454`). They are rebuilt as `timedEvent(script, 'knockout')` and so on.
  - Without a script they are dropped: a knocked-out NPC never wakes up after a load, a lit flare never burns out.
- **Impact:** Script timers move to the wrong guard among identical critters, and spurious `timed_event_p_proc` calls are made with a string `fixed_param`.
- **Fix:** Serialise the object uid and an explicit event type, and rebuild each type through its own constructor.
- **Ref:** NEW (U7 restored script timers but not their identity).
- **Fixed 2026-10-25:** events are keyed by object uid (items in inventories and hands included; uid −1 is only the dude's) and rebuilt by type: knockout, a lit flare's burn-out, an armed explosive's explosion / failure.

### SCR-11 — missing proc runs procedure index 1 in CE (LOW-MED, unverified impact)
- **CE:** `scripts.cc:1306-1309` and `1323-1326`: `v9 = script->procs[proc]; if (v9 == 0) v9 = 1;`. `SCRIPT_PROC_NO_PROC` is 0 (`scripts.h:50`), so a script that lacks the requested proc runs procedure index 1 instead.
- **DH2:** The dispatchers return without running anything (`scripting.ts:3392, 3405, 3472, 3487…`).
- **Impact:** This depends on what sslc puts at index 1, usually the first declared procedure, often `start`; unverified against the data. Usually harmless (empty `start`), but CE runs that code on, for example, `talk_p_proc` or `map_update_p_proc` for scripts that lack them.
- **Fix:** Confirm with an opcode / procedure-table scan of the shipped scripts before changing anything.
- **Ref:** NEW.

### SCR-12 — sfall opcode coverage; unknown opcodes are misread as a dialogue suspension (MED for mods) — **FIXED 2026-10-25**
- **CE:** `sfall_opcodes.cc` registers 83 opcodes; an unregistered opcode is `programFatalError("Undefined opcode")`.
- **DH2:** 36 of them are bridged (see the table). `vm.ts:495-506` returns `false` from `step()`, so `run()` halts with the −1 sentinel still on `retStack`. `call()` (`vm.ts:407-421`) then treats the frame as halted in `gsay_end` and stores it in `suspended`. The next `resume()` continues it from whatever address is on top of the stored return frame.
- **Impact:** Mods that use sfall string or math functions (`substr`, `strlen`, `atoi`, `sqrt`, `round`, `^`, sfall gvars) break silently, and `resume()` can later run a half-finished procedure. Vanilla is not affected (C54 scan).
- **Fix:** Throw `VMFatalError('Undefined opcode …')` for an unknown opcode. Port the pure sfall functions (string, math, typeof, sfall gvars, active_hand, game_loaded, in_world_map).
- **Ref:** Partly in upu_support.md (planned items); the suspension side effect is NEW.

### SCR-13 — minor VM semantics (LOW)
- These come from `opAdd` / `opSubtract` / `opMultiply` / `opModulo` / `opUnaryMinus` / `opFloor` / `opIf` / `opNot` (`interpreter.cc:1412-1880`):
  - no 32-bit wraparound (CE `opAdd` turns overflow into a float; sub and mul wrap);
  - MOD of a float is computed instead of a fatal error;
  - NEG, floor and arithmetic on strings give NaN instead of a fatal error or nothing pushed;
  - `""` is false in `if`;
  - `!` pushes a boolean.
- No shipped script is known to depend on these. Ref: NEW (scripting_vm.md §9.2 already notes the string ordering edge case).

### SCR-14 — wiki inconsistency (LOW, doc)
- `wiki/scripting_vm.md` §4's opcode table numbers the base opcodes wrongly; for example it lists 0x8002 as push_base, 0x8016 as `+` and 0x8027 as jmp.
- CE `interpreter.h:17-92` has OPCODE_PUSH_BASE = 0x802B, OPCODE_ADD = 0x8039, OPCODE_JUMP = 0x8004. §9.2 of the same doc uses the right numbers.
- Per the CLAUDE.md wiki rule, this is a wiki / CE conflict to flag; CE is right. Ref: NEW.

### Smaller ones (LOW, collected)
- **Midnight during a dialogue** (`gameTick.ts processMidnightForDay`): CE `gameTimeEventProcess` skips `_scriptsCheckGameEvents` while a dialogue is active, and everything while a movie plays.
- **`metarule3(100)`** removes only the first match; CE removes all matching script events.
- **Spatial triggers** use the current elevation's spatials, not the moving object's own (`Obj.ts:475`, `GameMap.ts:104`).
- **`queueProcessEvents` stopProcess** is ignored on the per-tick path.
- **`message_str`** special pairs (0,0), (−1,−1) and (−2,−2) are not handled.
- **LVARs** are allowed in map scripts.
- **Procedure lookup** is case-sensitive.
- **External variables** are not checked for existence.

## DH2-only behaviour

- **Event-driven VM.** DH2 runs each procedure call to completion: no `_updatePrograms` burst, no critical sections, no child programs (documented, scripting_vm.md §11). Dialogue suspends with `suspended` frames and `resume()` (`vm.ts:441`) instead of running the dialogue loop inside `gsay_end`.
- **Lua backend** (`src/lua/`, default): decompiled scripts with SSL semantics in `prelude.ts`. It differs from the VM in value normalisation (better) and in `""` truthiness. The recursion limit is approximated as `0x1000 // 3`.
- **Stub script registry** (`scripting.ts:3254-3285`): JS stand-ins for missing `.int` files, keyed by name or SID (for example the ACTemDor stub).
- **Mods script search path** (`Config.scripting.mods`, `loadLuaScript`).
- **Countdown queue**: `timeEventList` with relative `ticks` plus a time-jump hook (`gametime.ts setTimeJumpHandler`, `gameTick.ts processTimeJump`), instead of CE's absolute-time sorted list. The `queueBail` event replaces CE's `stopProcess` return for the rest loop only.
- **Day/night light curve** (`gametime.ts`, `[dh2] day_night_cycle`, documented).
- **`fs_copy`** (0x81F8) answers only whether the source file exists; 0x815F-0x8161 are nhmyron stat functions that are not in CE.
- **VM fatal hook** (`setVMFatalHook`) for the VM-vs-Lua differential page.
