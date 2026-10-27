// sfall hook scripts — a DH2 addition after sfall (HookScripts.cpp, hookscripts.md); CE
// implements none. A global script registers one of its procedures for a hook point with
// register_hook_proc(hookId, proc); the engine runs the registered procedures there, each
// reading the hook's arguments with get_sfall_arg / get_sfall_arg_at and answering with
// set_sfall_return. Only the hook points the Unofficial Patch uses fire (see HOOK_*); the
// others can be registered and never run. wiki/upu_support.md → "Hooks and global scripts".

import globalState from './globalState.js'
import { UIMode } from './uiMode.js'
import { dbg, dbgWarn } from './logger.js'

// sfall.h hook ids
export const HOOK_INVENTORYMOVE = 24
export const HOOK_GAMEMODECHANGE = 31

// sfall.h get_game_mode flags (LoadGameHook.cpp LoopFlag)
export const GAME_MODE = {
    WORLDMAP: 0x1,
    DIALOG: 0x4,
    ESCMENU: 0x8,
    SAVEGAME: 0x10,
    LOADGAME: 0x20,
    COMBAT: 0x40,
    OPTIONS: 0x80,
    HELP: 0x100,
    CHARSCREEN: 0x200,
    PIPBOY: 0x400,
    PCOMBAT: 0x800,
    INVENTORY: 0x1000,
    AUTOMAP: 0x2000,
    SKILLDEX: 0x4000,
    INTFACEUSE: 0x8000,
    INTFACELOOT: 0x10000,
    BARTER: 0x20000,
    HEROWIN: 0x40000,
    DIALOGVIEW: 0x80000,
    COUNTERWIN: 0x100000,
    SPECIAL: 0x80000000,
}

/** a registered hook procedure: the script (for unregistering) and how to run it */
interface HookProc {
    owner: object
    run: () => void
}

const registry = new Map<number, HookProc[]>()

/** the hook being run: its arguments, the next one get_sfall_arg returns, the returns */
interface HookContext {
    args: any[]
    next: number
    returns: any[]
}
const contexts: HookContext[] = []

export function sfallHooksReset(): void {
    registry.clear()
    contexts.length = 0
    lastGameMode = 0
    special = 0
}

/** register_hook_proc(hookId, proc): `run` null unregisters `owner` from the hook. A
 *  script registers at most one procedure per hook (a second call replaces it). */
export function registerHookProc(hookId: number, owner: object, run: (() => void) | null): void {
    const list = (registry.get(hookId) ?? []).filter((h) => h.owner !== owner)
    if (run) list.push({ owner, run })
    registry.set(hookId, list)
    dbg('script', `hook ${hookId}: ${run ? 'registered' : 'unregistered'} (${list.length} procedures)`)
}

/** Unregisters every hook of a script (its global script is removed). */
export function unregisterHooksOf(owner: object): void {
    for (const [id, list] of registry)
        registry.set(
            id,
            list.filter((h) => h.owner !== owner),
        )
}

export function hasHook(hookId: number): boolean {
    return (registry.get(hookId)?.length ?? 0) > 0
}

/** Runs a hook point: the procedures registered with register_hook_proc, the last
 *  registered first (hookscripts.md: "executed in reverse order of registration").
 *  Returns the values set with set_sfall_return (a later procedure overrides an earlier
 *  one's). */
export function runHook(hookId: number, args: any[]): any[] {
    const list = registry.get(hookId)
    if (!list || list.length === 0) return []
    const ctx: HookContext = { args: args.slice(), next: 0, returns: [] }
    for (const h of list.slice().reverse()) {
        ctx.next = 0
        const before = ctx.returns.length
        contexts.push(ctx)
        try {
            h.run()
        } catch (e) {
            dbgWarn('script', `hook ${hookId}: ${e}`)
        } finally {
            contexts.pop()
        }
        // set_sfall_return sets return values from the first on, for each procedure
        if (ctx.returns.length > before) ctx.returns = ctx.returns.slice(before)
    }
    return ctx.returns
}

const current = (): HookContext | null => contexts[contexts.length - 1] ?? null

/** get_sfall_arg: the next argument, 0 when there are no more. */
export function hookArg(): any {
    const c = current()
    if (!c || c.next >= c.args.length) return 0
    return c.args[c.next++]
}

/** get_sfall_arg_at(n) (sfall_func1): argument n, 0-based. */
export function hookArgAt(n: number): any {
    const c = current()
    return c && n >= 0 && n < c.args.length ? c.args[n] : 0
}

/** get_sfall_args: all arguments. */
export function hookArgs(): any[] {
    return current()?.args.slice() ?? []
}

/** set_sfall_arg(n, value) */
export function setHookArg(n: number, value: any): void {
    const c = current()
    if (c && n >= 0 && n < c.args.length) c.args[n] = value
}

/** set_sfall_return(value) */
export function hookReturn(value: any): void {
    current()?.returns.push(value)
}

// --- game mode (get_game_mode, HOOK_GAMEMODECHANGE) ---

let lastGameMode = 0
let special = 0 // the SPECIAL flag while it is set (dialogue panel animations)

/** get_game_mode: sfall's loop flags for what the game shows now. */
export function gameMode(): number {
    const M = GAME_MODE
    let mode = 0
    switch (globalState.uiMode) {
        case UIMode.dialogue:
            mode = M.DIALOG
            break
        case UIMode.companionControl:
            mode = M.DIALOG
            break
        case UIMode.barter:
            mode = M.DIALOG | M.BARTER
            break
        case UIMode.loot:
            mode = M.INTFACELOOT
            break
        case UIMode.inventory:
            mode = M.INVENTORY
            break
        case UIMode.worldMap:
            mode = M.WORLDMAP
            break
        case UIMode.skilldex:
            mode = M.SKILLDEX
            break
        case UIMode.useSkill:
            mode = 0
            break
        case UIMode.saveLoad:
            mode = M.SAVEGAME
            break
        case UIMode.char:
            mode = M.CHARSCREEN
            break
        case UIMode.pipBoy:
            mode = M.PIPBOY
            break
        case UIMode.automap:
            mode = M.AUTOMAP
            break
        case UIMode.options:
            mode = M.ESCMENU
            break
        case UIMode.dialog:
            mode = M.COUNTERWIN
            break
        default:
            mode = 0
    }
    if (globalState.inCombat) {
        mode |= M.COMBAT
        if (globalState.combat?.inPlayerTurn) mode |= M.PCOMBAT
    }
    return (mode | special) >>> 0
}

/** Once per frame: runs HOOK_GAMEMODECHANGE when the game mode changed (sfall
 *  LoadGameHook GameModeChange; args: 0, the previous mode). */
export function pollGameMode(): void {
    const mode = gameMode()
    if (mode === lastGameMode) return
    const prev = lastGameMode
    lastGameMode = mode
    if (hasHook(HOOK_GAMEMODECHANGE)) runHook(HOOK_GAMEMODECHANGE, [0, prev | 0])
}

/** sfall sets SPECIAL around the dialogue panel's animations: when the dialogue ends
 *  (LoadGameHook.cpp: before animating the panel on exit) and when a party member
 *  joins or leaves in dialogue. `inDialogue` false: the dialogue is over. */
export function gameModeSpecial(inDialogue: boolean): void {
    special = GAME_MODE.SPECIAL
    const mode = inDialogue ? (gameMode() | GAME_MODE.DIALOG) >>> 0 : GAME_MODE.SPECIAL >>> 0
    const prev = lastGameMode
    lastGameMode = mode
    if (hasHook(HOOK_GAMEMODECHANGE)) runHook(HOOK_GAMEMODECHANGE, [0, prev | 0])
    special = 0
    // sfall clears the flag without a mode change event; leaving the dialogue then
    // changes the mode to the next one (pollGameMode)
    if (inDialogue) lastGameMode = gameMode()
}
