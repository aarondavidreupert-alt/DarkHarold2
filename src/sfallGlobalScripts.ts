// sfall global scripts and global variables — a port of fallout2-ce
// sfall_global_scripts.cc and sfall_global_vars.cc.
//
// Global scripts are data/scripts/gl*.int (sfall's default GlobalScriptPaths
// "scripts\gl*.int"; CE's default is none). DH2 cannot list a folder, so they are the
// gl*.int files of the active mod folders (modAssets.ts) — vanilla has none. Each runs its
// start procedure when a game starts or is loaded (CE sfall_gl_scr_exec_start_proc,
// called after the new game's map loads and after a save loads), then:
//   type 0 / 3: every `repeat` game-loop frames on the map (sfall_gl_scr_process_main),
//               and their map_enter / map_update / map_exit procedures with the map's
//               (sfall_gl_scr_exec_map_update_scripts)
//   type 1:     every `repeat` frames everywhere, also in dialogue and menus (the input
//               ticker, sfall_gl_scr_process_input)
//   type 2 / 3: every `repeat` frames on the world map (sfall_gl_scr_process_worldmap)
// game_loaded is 1 the first time a global script asks (sfall_gl_scr_is_loaded).
//
// sfall global variables (set_sfall_global / get_sfall_global_int): a key of exactly 8
// characters or a number, an int value; 0 removes it. Saved with the game.

import { assetFiles } from './modAssets.js'
import { dbg, dbgWarn } from './logger.js'
import { unregisterHooksOf } from './sfallHooks.js'

/** the Script a global script runs as (scripting.ts Script; kept structural here) */
interface ScriptLike {
    start?: () => void
    map_enter_p_proc?: () => void
    map_update_p_proc?: () => void
    map_exit_p_proc?: () => void
    self_obj?: any
}

interface GlobalScript {
    name: string
    script: ScriptLike
    repeat: number
    count: number
    mode: number
    once: boolean
}

let globalScripts: GlobalScript[] = []
let startRequested = false

/** The global scripts' names, sorted (CE sorts the paths). */
export function globalScriptNames(): string[] {
    return assetFiles(/^data\/scripts\/(gl[^/]*)\.int$/i)
        .map((p) => p.replace(/^.*\//, '').replace(/\.int$/i, '').toLowerCase())
        .sort()
}

/** CE sfall_gl_scr_remove_all (game reset) */
export function removeAllGlobalScripts(): void {
    for (const g of globalScripts) unregisterHooksOf(g.script)
    globalScripts = []
}

/** A new game: start the global scripts once its map has loaded (CE main.cc runs
 *  sfall_gl_scr_exec_start_proc after _main_load_new). */
export function requestGlobalScriptsStart(): void {
    startRequested = true
}

/** After a map load: the pending start of a new game (requestGlobalScriptsStart). */
export function startGlobalScriptsIfRequested(load: (name: string) => ScriptLike | null): void {
    if (!startRequested) return
    startRequested = false
    startGlobalScripts(load)
}

/** CE sfall_gl_scr_exec_start_proc: load every global script and run its start. */
export function startGlobalScripts(load: (name: string) => ScriptLike | null): void {
    removeAllGlobalScripts()
    for (const name of globalScriptNames()) {
        let script: ScriptLike | null = null
        try {
            script = load(name)
        } catch (e) {
            dbgWarn('script', `global script ${name}: ${e}`)
        }
        if (!script) continue
        script.self_obj = null
        const g: GlobalScript = { name, script, repeat: 0, count: 0, mode: 0, once: true }
        globalScripts.push(g)
        run(g, 'start')
    }
    if (globalScripts.length) dbg('script', `global scripts: ${globalScripts.map((g) => g.name).join(', ')}`)
}

function run(g: GlobalScript, proc: 'start' | 'map_enter_p_proc' | 'map_update_p_proc' | 'map_exit_p_proc'): void {
    const fn = g.script[proc]
    if (typeof fn !== 'function') return
    try {
        g.script.self_obj = null
        fn.call(g.script)
    } catch (e) {
        dbgWarn('script', `global script ${g.name} ${proc}: ${e}`)
    }
}

/** CE sfall_gl_scr_exec_map_update_scripts: map_enter / map_update / map_exit for the
 *  type 0 and 3 scripts. */
export function globalScriptsMapProc(proc: 'map_enter_p_proc' | 'map_update_p_proc' | 'map_exit_p_proc'): void {
    for (const g of globalScripts) if (g.mode === 0 || g.mode === 3) run(g, proc)
}

function processSimple(mode1: number, mode2: number): void {
    for (const g of globalScripts) {
        if (g.repeat !== 0 && (g.mode === mode1 || g.mode === mode2)) {
            g.count++
            if (g.count >= g.repeat) {
                run(g, 'start')
                g.count = 0
            }
        }
    }
}

/** the game loop on a map (CE main.cc / combat.cc sfall_gl_scr_process_main) */
export const globalScriptsProcessMain = () => processSimple(0, 3)
/** every frame, wherever the game is (CE's input ticker) */
export const globalScriptsProcessInput = () => processSimple(1, 1)
/** the world map loop (CE worldmap.cc sfall_gl_scr_process_worldmap) */
export const globalScriptsProcessWorldmap = () => processSimple(2, 3)

const find = (script: object) => globalScripts.find((g) => g.script === script) ?? null

/** set_global_script_repeat (CE sfall_gl_scr_set_repeat) */
export function setGlobalScriptRepeat(script: object, frames: number): void {
    const g = find(script)
    if (g) g.repeat = frames | 0
}

/** set_global_script_type (CE sfall_gl_scr_set_type): 0-3 */
export function setGlobalScriptType(script: object, type: number): void {
    if (type < 0 || type > 3) return
    const g = find(script)
    if (g) g.mode = type
}

/** game_loaded (CE sfall_gl_scr_is_loaded): 1 the first time a global script asks; any
 *  other script: 1 */
export function globalScriptIsLoaded(script: object): boolean {
    const g = find(script)
    if (!g) return true
    if (g.once) {
        g.once = false
        return true
    }
    return false
}

// --- sfall global variables (CE sfall_global_vars.cc) ---

let globalVars = new Map<string, number>()

/** CE: a string key must be exactly 8 characters (it is read as a 64-bit number); an int
 *  key is that number. Null: not a valid key. */
function varKey(key: any): string | null {
    if (typeof key === 'string') return key.length === 8 ? 's:' + key : null
    if (typeof key === 'number' && Number.isFinite(key)) return 'n:' + (key | 0)
    return null
}

export function sfallGlobalVarsReset(): void {
    globalVars = new Map()
}

/** set_sfall_global (CE sfall_gl_vars_store: 0 removes the variable) */
export function setSfallGlobal(key: any, value: number): void {
    const k = varKey(key)
    if (k === null) return
    const v = Math.trunc(Number(value) || 0) | 0
    if (v === 0) globalVars.delete(k)
    else globalVars.set(k, v)
}

/** get_sfall_global_int (CE sfall_gl_vars_fetch; 0 when unset) */
export function getSfallGlobal(key: any): number {
    const k = varKey(key)
    return k === null ? 0 : globalVars.get(k) ?? 0
}

/** for the save game (CE sfall_gl_vars_save / _load) */
export function serializeSfallGlobals(): [string, number][] {
    return Array.from(globalVars.entries())
}

export function deserializeSfallGlobals(entries: [string, number][] | undefined): void {
    globalVars = new Map(Array.isArray(entries) ? entries : [])
}
