// Lua script backend: runs the decompiled scripts (tools/int2lua.py output,
// data/scripts/<name>.lua) in place of the bytecode VM (src/vm.ts).
//
// The Lua code calls the same Script methods the VM bridge (src/vmBridge.ts)
// calls, so every intrinsic keeps one implementation. What differs from the VM:
//   * procedures run as Lua coroutines; gsay_end / gsay_message yield and the
//     dialogue resumes them (CE game_dialog.cc: the dialogue loop runs inside
//     gsay_end, so the code after it runs when the dialogue ends)
//   * results are normalised to SSL values: booleans become 0/1, null/undefined 0
//
// The interpreter is wasmoon (Lua 5.4 in WebAssembly, lib/wasmoon/, MIT),
// loaded by play.html as the `wasmoon` global.

import { scriptProcNumber, STOPS_PROC_ON_SELF } from '../scriptProcs.js'
import { LUA_PRELUDE } from './prelude.js'
import { dbg, dbgWarn } from '../logger.js'

// --- the parts of the wasmoon API used here -------------------------------

interface LuaGlobal {
    get(name: string): any
    set(name: string, value: any): void
}
interface LuaEngine {
    global: LuaGlobal
    doStringSync(source: string): any
}
interface LuaFactoryCtor {
    new (wasmUri?: string): { createEngine(options?: object): Promise<LuaEngine> }
}

// --- what the backend needs from a Script object ---------------------------

export interface LuaHostScript {
    scriptName: string
    _mapScript?: LuaHostScript
    _lua?: LuaScriptHandle
    [key: string]: any
}

export interface LuaScriptHandle {
    /** continue the procedures suspended in gsay_end / gsay_message */
    resume(): boolean
    /** continue only the innermost suspended procedure (a gsay_message [Done]) */
    resumeOne(): boolean
    hasSuspended(): boolean
}

/** Reads an SSL built-in variable (self_obj, dude_obj, game_time, ...). */
export type BuiltinVarReader = (script: LuaHostScript, name: string) => any

let engine: LuaEngine | null = null
let luaErrorHook: ((text: string) => void) | null = null

/** Also report Lua script errors here (the VM-vs-Lua test page uses it). */
export function setLuaErrorHook(hook: ((text: string) => void) | null): void {
    luaErrorHook = hook
}
let readBuiltin: BuiltinVarReader | null = null
// the prelude's entry points; scripts are identified by a numeric id
let luaLoad: (id: number, script: LuaHostScript, name: string, source: string) => any
let luaCall: (id: number, name: string, ...args: any[]) => any
let luaCallOption: (id: number, option: number) => any
let luaResume: (id: number) => boolean
let luaResumeOne: (id: number) => boolean
let luaHasSuspended: (id: number) => boolean
let luaEntryName: (id: number) => string
let luaUnload: (id: number) => void
let nextScriptId = 1
const scriptIds = new WeakMap<LuaHostScript, number>()

/** SSL value of a host result (CE intrinsics push ints; the VM pushes booleans as-is). */
export function sslValue(v: any): any {
    if (v === true) return 1
    if (v === false || v === null || v === undefined) return 0
    return v
}

export function isLuaReady(): boolean {
    return engine !== null
}

/** vmBridge.ts registers its built-in variable readers here, so both
 *  backends read self_obj, game_time, ... the same way. */
export function setBuiltinVarReader(reader: BuiltinVarReader): void {
    readBuiltin = reader
}

/** Start the Lua engine. `wasmUri` points at glue.wasm; `factory` defaults to
 *  the `wasmoon` global play.html loads. */
export async function initLuaRuntime(wasmUri = 'lib/wasmoon/glue.wasm', factory?: LuaFactoryCtor): Promise<void> {
    if (engine) return
    const Factory: LuaFactoryCtor | undefined = factory ?? (globalThis as any).wasmoon?.LuaFactory
    if (!Factory) throw Error('initLuaRuntime: wasmoon is not loaded (lib/wasmoon/index.js)')
    if (!readBuiltin) throw Error('initLuaRuntime: no built-in variable reader (vmBridge.ts)')
    const lua = await new Factory(wasmUri).createEngine({ injectObjects: false, enableProxy: true })

    lua.global.set('__host_call', (script: LuaHostScript, name: string, ...args: any[]) => {
        const f = script[name]
        if (typeof f !== 'function') {
            dbgWarn('lua', `${script.scriptName}: no intrinsic ${name}`)
            return 0
        }
        const self = script.self_obj
        const r = sslValue(f.apply(script, args))
        // (on its own self_obj these end the procedure: the prelude's intrinsic raises EXIT)
        if (STOPS_PROC_ON_SELF.has(name) && self && args[0] === self) script._stopProc = true
        return r
    })
    // true once (and cleared) when the last intrinsic ended the procedure (STOPS_PROC_ON_SELF)
    lua.global.set('__host_stopped', (script: LuaHostScript) => {
        const stop = script._stopProc === true
        script._stopProc = false
        return stop
    })
    lua.global.set('__host_var', (script: LuaHostScript, name: string) => sslValue(readBuiltin!(script, name)))
    // CE exported variables live on the map script (vmBridge.ts op_fetch_external)
    lua.global.set('__host_get_ext', (script: LuaHostScript, name: string) =>
        sslValue((script._mapScript ?? script)[name]),
    )
    lua.global.set('__host_set_ext', (script: LuaHostScript, name: string, v: any) => {
        ;(script._mapScript ?? script)[name] = v
    })
    lua.global.set('__host_option', (script: LuaHostScript, kind: string, option: number, ...args: any[]) => {
        const id = scriptIds.get(script)!
        const target = () => {
            luaCallOption(id, option)
        }
        // gsay_option(list, msg, target, reaction) / giq_option(iq, list, msg, target, reaction)
        if (kind === 'gsay_option') script.gsay_option(args[0], args[1], target, args[2])
        else script.giq_option(args[0], args[1], args[2], target, args[3])
    })
    lua.global.set('__host_log', (level: string, text: string) => {
        if (level === 'error') {
            dbgWarn('lua', text)
            if (luaErrorHook) luaErrorHook(text)
        } else dbg('lua', text)
    })
    lua.doStringSync(LUA_PRELUDE)

    luaLoad = lua.global.get('__load')
    luaCall = lua.global.get('__call')
    luaCallOption = lua.global.get('__call_option')
    luaResume = lua.global.get('__resume')
    luaResumeOne = lua.global.get('__resume_one')
    luaHasSuspended = lua.global.get('__has_suspended')
    luaEntryName = lua.global.get('__entry_name')
    luaUnload = lua.global.get('__unload')
    engine = lua
}

/** Turn `script` into a Lua-backed script: load `source`, give the object a
 *  method per procedure and run the entry procedure once, as the VM's startup
 *  code does (CE scripts.cc scriptExecProc: runProgram + _interpret on load). */
export function attachLuaScript(script: LuaHostScript, name: string, source: string, deferEntry = false): void {
    if (!engine) throw Error('attachLuaScript: Lua runtime not initialised')
    const id = nextScriptId++
    scriptIds.set(script, id)
    const procs: string[] = luaLoad(id, script, name, source)
    for (const procName of Object.values(procs)) {
        script[procName] = (...args: any[]) => {
            // CE scriptExecProc: the startup code runs before the first proc (deferEntry)
            const entry = script._pendingEntry
            if (entry) {
                script._pendingEntry = undefined
                entry()
            }
            // … script->action = proc before the run, script->source = 0 after it (not while
            // the proc waits in a dialogue)
            script.action = scriptProcNumber(procName)
            const result = sslValue(luaCall(id, procName, ...args))
            if (!luaHasSuspended(id)) script.source_obj = 0
            return result
        }
        // CE programFindProcedure compares names case-insensitively (Talk_P_Proc is talk_p_proc)
        const lower = procName.toLowerCase()
        if (lower !== procName && !procs.includes(lower)) script[lower] = script[procName]
    }
    script._lua = {
        resume: () => luaResume(id),
        resumeOne: () => luaResumeOne(id),
        hasSuspended: () => luaHasSuspended(id),
    }
    const entry = luaEntryName(id)
    if (typeof script[entry] !== 'function') return
    // (run as the VM runs its startup code, not as an engine call: no action / source change;
    // a map object's runs when its first proc does, Scripting.initScript)
    const run = () => {
        luaCall(id, entry)
    }
    if (deferEntry) script._pendingEntry = run
    else run()
}

/** Drop the Lua state of a script (its environment and suspended procedures). */
export function detachLuaScript(script: LuaHostScript): void {
    const id = scriptIds.get(script)
    if (engine && id !== undefined) luaUnload(id)
    scriptIds.delete(script)
    delete script._lua
}
