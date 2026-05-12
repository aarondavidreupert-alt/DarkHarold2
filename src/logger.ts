// Unified debug logging + structured event log.
//
// Two layers:
//   1. dbg(category, ...args) / dbgWarn(category, ...args)
//        — flag-gated console output. Categories live in
//          Config.scripting.debugLogShowType. Replace ad-hoc console.log
//          calls in engine code with these so output can be toggled at runtime.
//   2. eventLogPush(entry)
//        — pushes a structured EventLogEntry into globalState.eventLog.
//          Always recorded (so saves capture the fight history); the console
//          mirror is only emitted when Config.scripting.debugLogShowType.combat
//          is true. Entries are plain objects so DevTools can filter them.
//
// Player-visible messages still go through uiLog() — never mix the two.

import { Config } from './config.js'
import type { EventLogEntry, EventLogInput } from './eventlog.types.js'
import globalState from './globalState.js'

export type { EventLogEntry } from './eventlog.types.js'

export type DebugCategory = keyof typeof Config.scripting.debugLogShowType

export function dbg(category: DebugCategory, ...args: any[]): void {
    if (Config.scripting.debugLogShowType[category] !== true) return
    console.log(`[${category}]`, ...args)
}

export function dbgWarn(category: DebugCategory, ...args: any[]): void {
    if (Config.scripting.debugLogShowType[category] !== true) return
    console.warn(`[${category}]`, ...args)
}


function deriveRoundTurn(): { round: number; turn: number } {
    const c = globalState.combat
    if (!c) return { round: 0, turn: 0 }
    const turn = c.turnNum
    const cycle = Math.max(c.combatants?.length ?? 1, 1)
    const round = Math.max(1, Math.ceil(turn / cycle))
    return { round, turn }
}

export function eventLogPush(entry: EventLogInput): EventLogEntry {
    const derived = deriveRoundTurn()
    const full: EventLogEntry = {
        round: entry.round ?? derived.round,
        turn: entry.turn ?? derived.turn,
        timestamp: entry.timestamp ?? Date.now(),
        actor: entry.actor ?? null,
        action: entry.action,
        ...entry,
    }
    globalState.eventLog.push(full)
    if (Config.scripting.debugLogShowType.combat === true) {
        console.log('[combat]', full)
    }
    return full
}

export function eventLogClear(): void {
    globalState.eventLog.length = 0
}
