// Death-ending selection — split out of endgame.ts.
// See wiki/ts-split-refactor.md → "Per-file split proposals" §19.
//
// CE ref:
//   endgameDeathEndingInit        (0x440984)
//   endgameSetupDeathEnding       (0x440BD0)
//   endgameDeathEndingValidate    (0x440CF4)
//   endgameDeathEndingGetFileName (0x440D8C)

import { Scripting } from '../scripting.js'
import globalState from '../globalState.js'
import { getFileJSON, getRandomInt } from '../util.js'
import { dbg, dbgWarn } from '../logger.js'

// CE: endgame.h EndgameDeathEnding struct
export interface EndgameDeathEnding {
    gvar: number           // -1 = no check
    value: number
    worldAreaKnown: number  // -1 = no check
    worldAreaNotKnown: number
    minLevel: number
    percentage: number
    voiceOverBaseName: string
    enabled?: boolean      // runtime only, not in JSON
}

// CE: ENDGAME_DEATH_ENDING_REASON_DEATH / _TIMEOUT (endgame.h)
export const DEATH_REASON_DEATH = 0
export const DEATH_REASON_TIMEOUT = 2

// CE: GVAR_MODOC_SHITTY_DEATH = 491 (game_vars.h:498, 0-based from GVAR_PLAYER_REPUTATION)
const GVAR_MODOC_SHITTY_DEATH = 491

let cachedDeathEndings: EndgameDeathEnding[] | null = null

// CE default filename (endgame.cc:1007 — strcpy(gEndgameDeathEndingFileName, "narrator\\nar_5"))
let selectedDeathFile = 'narrator/nar_5'

// ---------- data loading ----------

function loadDeathEndings(): EndgameDeathEnding[] {
    if (cachedDeathEndings !== null) return cachedDeathEndings
    try {
        cachedDeathEndings = getFileJSON('lut/enddeath.json') as EndgameDeathEnding[]
    } catch (_e) {
        dbgWarn('endgame', 'lut/enddeath.json not found — death endings unavailable')
        cachedDeathEndings = []
    }
    return cachedDeathEndings
}

// ---------- death ending selection ----------

// CE: endgame.cc:endgameDeathEndingValidate (0x440CF4)
// Marks entries enabled when ALL conditions hold:
//   gvar === -1 OR getGlobalVar(gvar) < value      [CE skips entry if gvar >= value]
//   worldAreaKnown === -1 OR area is known
//   worldAreaNotKnown === -1 OR area is NOT known
//   player.level >= minLevel
// Returns sum of enabled entries' percentage weights.
function validateDeathEndings(entries: EndgameDeathEnding[]): number {
    let total = 0
    for (const e of entries) {
        e.enabled = false
        if (e.gvar !== -1 && Scripting.getGlobalVar(e.gvar) >= e.value) continue
        if (e.worldAreaKnown !== -1 && !globalState.knownAreas.has(e.worldAreaKnown)) continue
        if (e.worldAreaNotKnown !== -1 && globalState.knownAreas.has(e.worldAreaNotKnown)) continue
        const lvl = globalState.player?.getStat('Level') ?? 1
        if (lvl < e.minLevel) continue
        e.enabled = true
        total += e.percentage
    }
    return total
}

// CE: endgame.cc:endgameSetupDeathEnding (0x440BD0)
// Called when the player dies or the timer expires.
export function setupDeathEnding(reason: number): void {
    const entries = loadDeathEndings()
    if (entries.length === 0) {
        dbgWarn('endgame', 'setupDeathEnding: no entries in enddeath.json')
        return
    }

    // CE: special-case GVAR_MODOC_SHITTY_DEATH → forced index 12 (endgame.cc:1136)
    if (reason === DEATH_REASON_DEATH && Scripting.getGlobalVar(GVAR_MODOC_SHITTY_DEATH) !== 0) {
        const special = entries[12]
        if (special) {
            selectedDeathFile = 'narrator/' + special.voiceOverBaseName
            dbg('endgame', 'setupDeathEnding: MODOC special ending →', selectedDeathFile)
            return
        }
    }

    const total = validateDeathEndings(entries)

    // CE: randomBetween(0, percentage) — endgame.cc:1147
    const chance = getRandomInt(0, total)
    let accum = 0
    let selectedIdx = 0
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i]
        if (!e.enabled) continue
        accum += e.percentage
        if (accum >= chance) break
        // CE mirrors this: selectedEnding++ runs before the break check (endgame.cc:1158)
        selectedIdx++
    }

    const winner = entries[selectedIdx] ?? entries[0]
    selectedDeathFile = 'narrator/' + winner.voiceOverBaseName
    dbg('endgame', 'setupDeathEnding: picked', selectedDeathFile)
}

// CE: endgame.cc:endgameDeathEndingGetFileName (0x440D8C)
export function getDeathEndingFileName(): string {
    return selectedDeathFile
}
