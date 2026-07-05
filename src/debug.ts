// Debug/cheat utilities for development and testing.
// Only active when Config.engine.debug === true; all methods are no-ops otherwise.
// Import this module in main.ts so it initialises on load. Do NOT attach to window.
//
// Usage (browser DevTools, module-aware snippet):
//   const { debug } = await import('./js/debug.js')
//   debug.addXP(2000)
//   debug.giveItemByName('stealth boy')
//   debug.giveItem(54, 3)

import { Config } from './config.js'
import globalState from './globalState.js'
import { createObjectWithPID } from './object.js'
import { heart } from './heart.js'
import { fromTileNum } from './tile.js'
import { centerCamera } from './renderer.js'

let _crawlerModeSnapshot: {
    stub: boolean; dialogue: boolean; combat: boolean; ai: boolean
    difficultyModifier: 100 | 75 | 125
} | null = null

// PID lookup table for debug.giveItemByName(). Mirrors the items already
// listed in player.ts's starting test inventory, plus the LE10 misc items.
// Extend as needed — these are plain item PIDs (proto/items lst indices).
const ITEM_ALIASES: Record<string, number> = {
    'money': 41,
    'combat knife': 4,
    'hunting rifle': 15,
    'leather jacket': 2,
    'leather armor': 3,
    '10mm smg': 9,
    'laser pistol': 22,
    'laser rifle': 23,
    'plasma pistol': 24,
    'plasma rifle': 25,
    'gatling laser': 27,
    'minigun': 19,
    'rocket launcher': 20,
    'assault rifle': 16,
    '10mm jhp': 33,
    '10mm ap': 34,
    'small energy cell': 42,
    'micro fusion cell': 43,
    '5mm jhp': 38,
    '.223 fmj': 36,
    'rocket ap': 44,
    'rocket explosive': 45,
    // Misc charged items — LE10 (src/miscItem.ts)
    'stealth boy': 54,
    'geiger counter': 52,
    'motion sensor': 59,
}

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

    /** Set player karma. Clamped to the Karma stat's ±99999999 bounds. */
    setKarma(n: number): void {
        const p = guardPlayer('setKarma')
        if (!p) return
        const clamped = Math.max(-99999999, Math.min(99999999, n))
        p.stats.setBase('Karma', clamped)
        console.log(`[debug] Karma set to ${clamped}`)
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

    /** Add an item to player inventory by prototype ID. Optional amount for stackable items. */
    giveItem(pid: number, amount: number = 1): void {
        const p = guardPlayer('giveItem')
        if (!p) return
        const item = createObjectWithPID(pid)
        if (!item) {
            console.warn(`[debug.giveItem] Could not create item with PID ${pid}`)
            return
        }
        if (amount > 1) item.setAmount(amount)
        p.inventory.push(item)
        console.log(`[debug] Added PID ${pid}${amount > 1 ? ` x${amount}` : ''} (${item.name || '?'}) to inventory. Inventory size: ${p.inventory.length}`)
    },

    /** Add an item to player inventory by common name (see ITEM_ALIASES below).
     *  Case-insensitive. Prints known names if no match is found. */
    giveItemByName(name: string, amount: number = 1): void {
        const p = guardPlayer('giveItemByName')
        if (!p) return
        const key = name.trim().toLowerCase()
        const pid = ITEM_ALIASES[key]
        if (pid === undefined) {
            console.warn(`[debug.giveItemByName] Unknown item "${name}". Known names: ${Object.keys(ITEM_ALIASES).join(', ')}`)
            return
        }
        debug.giveItem(pid, amount)
    },

    /** Drive one engine tick without waiting for requestAnimationFrame.
     *  Used by the AutoCrawler to advance game state at engine speed. */
    step(dtMs: number = (heart._targetTickTime ?? 33) + 1): void {
        if (!Config.engine.debug) return
        if (heart._lastTick === undefined) return
        heart._stepOnly(heart._lastTick + dtMs)
    },

    /** Teleport player to a tile by tile number without changing maps. */
    movePlayer(tileNum: number): void {
        const p = guardPlayer('movePlayer')
        if (!p) return
        p.position = fromTileNum(tileNum)
        centerCamera(p.position)
        console.log(`[debug] Player moved to tile ${tileNum}`)
    },

    /** Toggle crawler mode: silences noisy logs and sets neutral combat difficulty.
     *  Enabling snapshots the current flag values; disabling restores them exactly. */
    crawlerMode(on: boolean): void {
        if (!Config.engine.debug) return
        if (on && _crawlerModeSnapshot === null) {
            _crawlerModeSnapshot = {
                stub: Config.scripting.debugLogShowType.stub,
                dialogue: Config.scripting.debugLogShowType.dialogue,
                combat: Config.scripting.debugLogShowType.combat,
                ai: Config.scripting.debugLogShowType.ai,
                difficultyModifier: Config.combat.difficultyModifier,
            }
            Config.scripting.debugLogShowType.stub = false
            Config.scripting.debugLogShowType.dialogue = false
            Config.scripting.debugLogShowType.combat = false
            Config.scripting.debugLogShowType.ai = false
            Config.combat.difficultyModifier = 100
        } else if (_crawlerModeSnapshot) {
            Config.scripting.debugLogShowType.stub = _crawlerModeSnapshot.stub
            Config.scripting.debugLogShowType.dialogue = _crawlerModeSnapshot.dialogue
            Config.scripting.debugLogShowType.combat = _crawlerModeSnapshot.combat
            Config.scripting.debugLogShowType.ai = _crawlerModeSnapshot.ai
            Config.combat.difficultyModifier = _crawlerModeSnapshot.difficultyModifier
            _crawlerModeSnapshot = null
        }
        console.log(`[debug] Crawler mode: ${on ? 'ON' : 'OFF'}`)
    },
}
