// VM-vs-Lua differential test (luadiff.html). Every procedure of a script runs
// once in the bytecode VM (src/vm.ts + vm_bridge.ts) and once as decompiled Lua
// (src/lua/), each against an identical simulated game: every intrinsic call is
// recorded with its arguments and answered from a seeded random world (stored
// LVARs/GVARs/MVARs, a pool of fake objects). The two call traces must match.
// Different seeds steer the scripts down different branches.
//
// What a run does, in both backends:
//   load the script (startup code + entry procedure, as loadScript does)
//   call the procedure under test with random arguments
//   if it suspended in gsay_end / gsay_message: resume it (dialogueExit)
//   call the first dialogue option it offered, once

import globalState from '../globalState.js'
import { parseIntFile } from '../intfile.js'
import { BinaryReader } from '../util.js'
import { ScriptVMBridge } from '../vm_bridge.js'
import { attachLuaScript, detachLuaScript, initLuaRuntime, setLuaErrorHook, sslValue } from './luaRuntime.js'

const OBJ_RESULTS = new Set([
    'create_object_sid', 'party_member_obj', 'obj_carrying_pid_obj', 'critter_inven_obj',
    'obj_being_used_with', 'tile_contains_pid_obj', 'obj_blocking_at',
])
const STR_RESULTS = new Set([
    'message_str', 'obj_name', 'sfx_build_open_name', 'sfx_build_char_name', 'sfx_build_ambient_name',
    'sfx_build_interface_name', 'sfx_build_item_name', 'sfx_build_weapon_name', 'sfx_build_scenery_name',
])
// Calls with side effects one run may make; a script waiting in a loop for the
// world to change (the traps' projectile loops) never ends against the fake
// world. Pure calls do not count: Lua skips some of them (see PURE), so the
// budget runs out at the same point in both backends.
const CALL_BUDGET = 1000
// All calls, pure ones included: stops a loop of pure calls quickly. Lua skips
// some pure calls, so this budget runs out at different points in the two
// backends; such a run is only compared up to where the shorter trace ends.
const TOTAL_BUDGET = 50000
const BUDGET_ERROR = 'call budget exceeded'
const TOTAL_BUDGET_ERROR = 'total call budget exceeded'


// tools/int2lua.py PURE: intrinsics without side effects. The decompiled
// `a and b` may skip such a call where sslc's opAnd evaluates it, so these are
// not traced, and their answers depend only on their arguments (not on how
// many calls came before), so skipping one cannot shift later answers.
const PURE = new Set([
    'dude_obj', 'self_obj', 'source_obj', 'target_obj', 'fixed_param', 'action_being_used', 'game_time',
    'game_time_hour', 'game_time_in_seconds', 'cur_map_index', 'combat_is_initialized', 'get_month', 'get_day',
    'obj_being_used_with', 'script_action', 'game_difficulty', 'combat_difficulty', 'game_ui_is_disabled',
    'days_since_visited', 'running_burning_guy',
    'local_var', 'global_var', 'map_var', 'get_critter_stat', 'get_pc_stat', 'obj_can_see_obj', 'obj_can_hear_obj',
    'has_trait', 'has_skill', 'obj_pid', 'obj_type', 'obj_item_subtype', 'obj_name', 'obj_art_fid', 'art_anim',
    'obj_is_carrying_obj_pid', 'obj_carrying_pid_obj', 'obj_is_open', 'obj_is_locked', 'obj_on_screen', 'tile_num',
    'tile_distance', 'tile_distance_objs', 'tile_num_in_direction', 'tile_is_visible', 'tile_in_tile_rect',
    'tile_contains_obj_pid', 'tile_contains_pid_obj', 'rotation_to_tile', 'is_success', 'is_critical',
    'critter_state', 'critter_is_fleeing', 'critter_inven_obj', 'party_member_obj', 'elevation', 'game_ticks',
    'message_str', 'proto_data', 'item_caps_total', 'get_poison', 'anim_busy', 'using_skill', 'how_much',
    'anim_action_frame',
])

function hashOf(text: string, seed: number): number {
    let h = (seed * 2654435761) >>> 0
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0
    return h
}

interface FakeObj {
    id: string
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

class World {
    seed: number
    rng: () => number
    lvars = new Map<number, any>()
    gvars = new Map<number, any>()
    mvars = new Map<number, any>()
    pool: FakeObj[] = []
    calls = 0
    totalCalls = 0
    suspended = false
    errored = false
    errorText = ''
    options: Array<() => void> = []
    trace: string[] = []

    constructor(seed: number) {
        this.seed = seed
        this.rng = mulberry32(seed)
        for (let i = 0; i < 6; i++) this.pool.push({ id: 'obj' + i })
    }

    int(lo: number, hi: number): number {
        return lo + Math.floor(this.rng() * (hi - lo + 1))
    }

    obj(): FakeObj | 0 {
        const i = this.int(-1, this.pool.length - 1)
        return i < 0 ? 0 : this.pool[i]
    }

    stored(store: Map<number, any>, tag: string, key: any): any {
        if (!store.has(key)) store.set(key, hashOf(tag + key, this.seed) % 4)
        return store.get(key)
    }

    // a pure intrinsic: the answer is a function of the call
    pureAnswer(name: string, args: any[]): any {
        const call = name + '(' + args.map(fmt).join(',') + ')'
        const h = hashOf(call, this.seed)
        if (OBJ_RESULTS.has(name)) {
            const i = (h % (this.pool.length + 1)) - 1
            return i < 0 ? 0 : this.pool[i]
        }
        if (STR_RESULTS.has(name)) return call
        return (h % 6) - 1
    }

    answer(name: string, args: any[]): any {
        switch (name) {
            case 'local_var': return this.stored(this.lvars, 'L', args[0])
            case 'global_var': return this.stored(this.gvars, 'G', args[0])
            case 'map_var': return this.stored(this.mvars, 'M', args[0])
            case 'set_local_var': this.lvars.set(args[0], args[1]); return 0
            case 'set_global_var': this.gvars.set(args[0], args[1]); return 0
            case 'set_map_var': this.mvars.set(args[0], args[1]); return 0
            case 'random': return args[1] >= args[0] ? this.int(args[0], args[1]) : args[0]
        }
        if (PURE.has(name)) return this.pureAnswer(name, args)
        if (OBJ_RESULTS.has(name)) return this.obj()
        if (STR_RESULTS.has(name)) return `${name}(${args.map(fmt).join(',')})`
        return this.int(-1, 4)
    }
}

function fmt(v: any): string {
    v = sslValue(v)
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(5)
    if (typeof v === 'string') return JSON.stringify(v)
    if (typeof v === 'function') return 'fn'
    if (v instanceof Number) return v.valueOf().toFixed(5)
    if (v && typeof v === 'object' && 'id' in v) return '#' + v.id
    return String(v)
}

// The fields the engine sets on a Script before calling a procedure.
function makeMock(world: World, name: string): any {
    const t: any = {
        scriptName: name,
        lvars: {},
        self_obj: world.pool[0],
        source_obj: world.pool[1],
        target_obj: world.pool[2],
        fixed_param: 7,
        game_time: 12345,
        cur_map_index: 3,
        action_being_used: 2,
        combat_is_initialized: 0,
    }
    t._mapScript = t
    const recorders: { [k: string]: (...a: any[]) => any } = {}
    const recorder = (k: string) =>
        recorders[k] ??
        (recorders[k] = (...args: any[]) => {
            if (++world.totalCalls > TOTAL_BUDGET) throw Error(TOTAL_BUDGET_ERROR)
            if (!PURE.has(k) && ++world.calls > CALL_BUDGET) throw Error(BUDGET_ERROR)
            for (const a of args) if (typeof a === 'function') world.options.push(a)
            const r = world.answer(k, args.map(sslValue))
            if (!PURE.has(k)) world.trace.push(`${k}(${args.map(fmt).join(', ')}) -> ${fmt(r)}`)
            const vm = t._vm
            if (k === 'gsay_end') {
                world.suspended = true
                if (vm) vm.halted = true
            } else if (k === 'gsay_message') {
                // Script.gsay_message: save the resume address and halt (scripting.ts)
                world.suspended = true
                if (vm) {
                    vm.retStack.push(vm.script.offset)
                    vm.halted = true
                }
            }
            return r
        })
    return new Proxy(t, {
        get(target, k) {
            if (k in target) return target[k]
            if (typeof k === 'string' && !k.startsWith('_') && k !== 'then' && k !== 'toJSON') return recorder(k)
            return undefined
        },
    })
}

function exported(mock: any): string {
    const out: string[] = []
    for (const k of Object.keys(mock).sort()) {
        const v = mock[k]
        if (typeof v === 'function' || k.startsWith('_') || k === 'lvars') continue
        out.push(`${k}=${fmt(v)}`)
    }
    return out.join(' ')
}

interface Plan {
    proc: string
    args: number[]
}

function step(world: World, what: string, fn: () => any): void {
    if (world.errored) return
    try {
        const r = fn()
        // a Lua error is caught inside the runtime (the error hook marks it)
        if (what === 'call' && !world.suspended && !world.errored) world.trace.push('ret ' + fmt(r))
    } catch (e) {
        world.errored = true
        world.errorText = String(e)
        world.trace.push('ERROR')
    }
}

interface RunResult {
    trace: string[]
    error: string
}

function runVM(name: string, data: DataView, seed: number, plan: Plan): RunResult {
    const world = new World(seed)
    const mock = makeMock(world, name)
    globalState.player = world.pool[5] as any
    const reader = new BinaryReader(data)
    const intfile = parseIntFile(reader, name)
    reader.seek(0)
    const vm = new ScriptVMBridge.GameScriptVM(reader, intfile)
    vm.scriptObj = mock
    mock._vm = vm
    for (const procName in intfile.procedures) mock[procName] = (...args: any[]) => vm.call(procName, args)
    world.trace.push('-- load')
    step(world, 'load', () => vm.run())
    world.trace.push('-- ' + plan.proc)
    step(world, 'call', () => mock[plan.proc](...plan.args))
    if (world.suspended) {
        world.trace.push('-- resume')
        step(world, 'resume', () => {
            vm.pc = vm.popAddr()
            vm.run()
        })
    }
    if (world.options.length > 0) {
        world.trace.push('-- option')
        const opt = world.options[0]
        world.suspended = false
        step(world, 'option', () => opt())
    }
    world.trace.push('-- exported ' + exported(mock))
    return { trace: world.trace, error: world.errorText }
}

function runLua(name: string, source: string, seed: number, plan: Plan): RunResult {
    const world = new World(seed)
    const mock = makeMock(world, name)
    globalState.player = world.pool[5] as any
    setLuaErrorHook((text) => {
        if (!world.errored) {
            world.errored = true
            world.errorText = text
            world.trace.push('ERROR')
        }
    })
    world.trace.push('-- load')
    step(world, 'load', () => attachLuaScript(mock, name, source))
    world.trace.push('-- ' + plan.proc)
    step(world, 'call', () => mock[plan.proc](...plan.args))
    if (world.suspended) {
        world.trace.push('-- resume')
        step(world, 'resume', () => mock._lua.resume())
    }
    if (world.options.length > 0) {
        world.trace.push('-- option')
        const opt = world.options[0]
        world.suspended = false
        step(world, 'option', () => opt())
    }
    world.trace.push('-- exported ' + exported(mock))
    setLuaErrorHook(null)
    detachLuaScript(mock)
    return { trace: world.trace, error: world.errorText }
}

export interface DiffFailure {
    script: string
    proc: string
    seed: number
    line: number
    vm: string[]
    lua: string[]
    vmError: string
    luaError: string
}

export interface DiffReport {
    scripts: number
    runs: number
    truncated: number // runs one backend cut short at TOTAL_BUDGET, compared as far as both got
    failures: DiffFailure[]
    missing: string[]
    vmErrors: number
    errors: { [text: string]: number } // why runs stopped (both backends agreeing)
}

function firstDiff(a: string[], b: string[]): number {
    const n = Math.max(a.length, b.length)
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i
    return -1
}

export async function runLuaDiff(names: string[], seeds: number, log: (s: string) => void): Promise<DiffReport> {
    await initLuaRuntime()
    const report: DiffReport = { scripts: 0, runs: 0, truncated: 0, failures: [], missing: [], vmErrors: 0, errors: {} }
    for (const name of names) {
        const intResp = await fetch(`data/scripts/${name}.int`)
        const luaResp = await fetch(`data/scripts/${name}.lua`)
        if (!intResp.ok || !luaResp.ok) {
            report.missing.push(name)
            continue
        }
        const data = new DataView(await intResp.arrayBuffer())
        const source = await luaResp.text()
        const procs = parseIntFile(new BinaryReader(data), name).proceduresTable.filter((p) => !p.name.startsWith('.'))
        report.scripts++
        let failed = 0
        for (const p of procs) {
            for (let seed = 1; seed <= seeds; seed++) {
                const argRng = mulberry32(seed * 7919)
                const plan: Plan = { proc: p.name, args: Array.from({ length: p.argc }, () => Math.floor(argRng() * 5)) }
                const vmRun = runVM(name, data, seed, plan)
                const luaRun = runLua(name, source, seed, plan)
                let vm = vmRun.trace
                let lua = luaRun.trace
                if (vmRun.error.includes(TOTAL_BUDGET_ERROR) || luaRun.error.includes(TOTAL_BUDGET_ERROR)) {
                    report.truncated++
                    const cut = (t: string[]) => t.slice(0, Math.max(0, t.indexOf('ERROR')))
                    vm = cut(vm)
                    lua = cut(lua)
                    const n = Math.min(vm.length, lua.length)
                    vm = vm.slice(0, n)
                    lua = lua.slice(0, n)
                }
                report.runs++
                if (vmRun.error) {
                    report.vmErrors++
                    const why = `${name}: VM ${vmRun.error} / Lua ${luaRun.error.replace(/^.*?: /, '')}`
                    report.errors[why] = (report.errors[why] ?? 0) + 1
                }
                const i = firstDiff(vm, lua)
                if (i >= 0) {
                    failed++
                    report.failures.push({
                        script: name, proc: p.name, seed, line: i,
                        vm: vm.slice(Math.max(0, i - 3), i + 3), lua: lua.slice(Math.max(0, i - 3), i + 3),
                        vmError: vmRun.error, luaError: luaRun.error,
                    })
                    break // one failing seed per procedure is enough
                }
            }
        }
        log(`${name}: ${procs.length} procedures, ${failed ? failed + ' differ' : 'identical'}`)
        await new Promise((r) => setTimeout(r, 0))
    }
    return report
}
