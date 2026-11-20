// Autosave (DH2 addition, not in CE): a save named AUTOSAVE, overwritten every
// Config.engine.autosaveMinutes minutes of play ([dh2] autosave_minutes, default 5; 0 = off), so a
// browser crash or a closed tab costs at most those minutes. It saves only at a quiet moment — the
// map in view with no window open, no combat, no map loading, no replay — and only when game time
// went on since the last one. A save of a large game (35 MB) takes about 0.1 s.

import { Config } from './config.js'
import globalState from './globalState.js'
import { isReplaying } from './actionLog.js'
import { world } from './state/world.js'
import { uiState } from './state/uiState.js'
import { UIMode } from './uiMode.js'
import { dbg } from './logger.js'

export const AUTOSAVE_NAME = 'AUTOSAVE'
const CHECK_MS = 10_000

let lastSave = Date.now()
let lastTick = -1
let saving = false

function quietMoment(): boolean {
    return (
        !!world.player &&
        !!world.gMap &&
        !globalState.isLoading &&
        !globalState.backgroundMapLoad &&
        !world.inCombat &&
        uiState.uiMode === UIMode.none &&
        !isReplaying()
    )
}

async function autosaveNow(): Promise<void> {
    saving = true
    // loaded here, not at the top: main.ts imports this module early, and importing saveload.js
    // that early changed the order the object modules start in ('Obj' before initialization)
    const { save, saveList } = await import('./saveload.js')
    // overwrite the AUTOSAVE slot (the newest of that name), else a new one
    saveList((saves) => {
        const own = saves
            .filter((s) => s.name === AUTOSAVE_NAME && s.id !== undefined)
            .sort((a, b) => b.timestamp - a.timestamp)[0]
        if (!quietMoment()) {
            saving = false
            return
        }
        save(AUTOSAVE_NAME, own?.id ?? -1, () => {
            saving = false
            lastSave = Date.now()
            lastTick = world.gameTickTime
            dbg('saveload', '[Autosave] saved')
        })
    })
}

/** Start the autosave timer (main.ts, once). */
export function installAutosave(): void {
    setInterval(() => {
        const minutes = Config.engine.autosaveMinutes
        if (!(minutes > 0) || saving) {
            return
        }
        if (Date.now() - lastSave < minutes * 60_000) {
            return
        }
        if (world.gameTickTime === lastTick) {
            return
        } // nothing happened since the last one
        if (!quietMoment()) {
            return
        }
        void autosaveNow()
    }, CHECK_MS)
}
