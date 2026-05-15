// Debug/cheat utilities for development and testing.
// Only active when Config.engine.debug === true; all methods are no-ops otherwise.
// Import this module in main.ts so it initialises on load. Do NOT attach to window.
//
// Usage (browser DevTools, module-aware snippet):
//   const { debug } = await import('./src/debug.js')
//   debug.addXP(2000)

import { Config } from './config.js'
import globalState from './globalState.js'
import { createObjectWithPID } from './object.js'

function guardPlayer(method: string): import('./player.js').Player | null {
    if (!Config.engine.debug) return null
    const p = globalState.player
    if (!p) {
        console.warn(`[debug.${method}] No active player — start a game first.`)
        return null
    }
    return p
}

export const debug = {
    /** Add XP to the player. Triggers level-up and perk picker if threshold crossed. */
    addXP(n: number): void {
        const p = guardPlayer('addXP')
        if (!p) return
        p.addExperience(n)
        console.log(`[debug] +${n} XP. Level: ${p.getStat('Level')}, XP: ${p.getStat('Experience')}`)
    },

    /** Directly set player current HP. */
    setHP(n: number): void {
        const p = guardPlayer('setHP')
        if (!p) return
        p.stats.setBase('HP', n)
        console.log(`[debug] HP set to ${n}`)
    },

    /** Set player karma (reputation). No-op with a warning if the field is absent. */
    setKarma(n: number): void {
        const p = guardPlayer('setKarma')
        if (!p) return
        if (!('karma' in p)) {
            console.warn('[debug.setKarma] Player has no karma field — not yet implemented.')
            return
        }
        ;(p as any).karma = n
        console.log(`[debug] Karma set to ${n}`)
    },

    /** Returns the current event log array (same data shown in the UI event log). */
    combatLog(): typeof globalState.eventLog {
        if (!Config.engine.debug) return []
        return globalState.eventLog
    },

    /** Load a map by name (e.g. 'artemple', 'modmeeting'). */
    teleport(map: string): void {
        if (!Config.engine.debug) return
        const gMap = globalState.gMap
        if (!gMap) {
            console.warn('[debug.teleport] No active map — start a game first.')
            return
        }
        console.log(`[debug] Teleporting to ${map}`)
        gMap.loadMap(map)
    },

    /** Add an item to player inventory by prototype ID. */
    giveItem(pid: number): void {
        const p = guardPlayer('giveItem')
        if (!p) return
        const item = createObjectWithPID(pid)
        if (!item) {
            console.warn(`[debug.giveItem] Could not create item with PID ${pid}`)
            return
        }
        p.inventory.push(item)
        console.log(`[debug] Added PID ${pid} to inventory. Inventory size: ${p.inventory.length}`)
    },
}
