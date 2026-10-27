/*
Copyright 2026

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

// CE scripts.cc gScriptProcNames: the SCRIPT_PROC_* number of each engine procedure, which
// scriptExecProc stores in script->action before the run (script_action reads it).

const SCRIPT_PROC_NAMES = [
    'no_p_proc',
    'start',
    'spatial_p_proc',
    'description_p_proc',
    'pickup_p_proc',
    'drop_p_proc',
    'use_p_proc',
    'use_obj_on_p_proc',
    'use_skill_on_p_proc',
    'none_x_bad',
    'none_x_bad',
    'talk_p_proc',
    'critter_p_proc',
    'combat_p_proc',
    'damage_p_proc',
    'map_enter_p_proc',
    'map_exit_p_proc',
    'create_p_proc',
    'destroy_p_proc',
    'none_x_bad',
    'none_x_bad',
    'look_at_p_proc',
    'timed_event_p_proc',
    'map_update_p_proc',
    'push_p_proc',
    'is_dropping_p_proc',
    'combat_is_starting_p_proc',
    'combat_is_over_p_proc',
]

/** SCRIPT_PROC_* of an engine procedure name; 0 (no_p_proc) for any other. */
export function scriptProcNumber(name: string): number {
    const i = SCRIPT_PROC_NAMES.indexOf(name)
    return i < 0 ? 0 : i
}

// CE interpreter_extra.cc opDestroyObject / opDestroyMultipleObjects / opKillCritter /
// opCritterDamage: on the script's own self_obj they set PROGRAM_FLAG_0x0100, which ends
// _interpret — the rest of the procedure doesn't run.
export const STOPS_PROC_ON_SELF: ReadonlySet<string> = new Set([
    'destroy_object',
    'destroy_mult_objs',
    'kill_critter',
    'critter_dmg',
])
