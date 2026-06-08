/*
Copyright 2014 darkf

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

// Preferences persistence — FO2-CE ref: preferences.cc preferencesSave/Load.
// Split out of ui_options.ts. See wiki/ts-split-refactor.md →
// "Per-file split proposals" §24.

import { Config } from '../config.js'
import globalState from '../globalState.js'

export interface SavedPreferences {
    difficultyModifier?: 75 | 100 | 125
    combatSpeed?: 1 | 2 | 4
    violenceLevel?: 0 | 1 | 2 | 3
    targetHighlight?: 'off' | 'on' | 'targeting-only' | boolean // boolean kept for legacy saves
    combatMessages?: 'brief' | 'verbose'
    doAlwaysRun?: boolean
    subtitles?: boolean
    masterVolume?: number
    musicVolume?: number
    sfxVolume?: number
}

export const PREFS_KEY = 'dh2_preferences'

/** Read persisted preferences from localStorage and apply them to Config + audioEngine. */
export function loadPreferences(): void {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return
    let prefs: SavedPreferences
    try {
        prefs = JSON.parse(raw) as SavedPreferences
    } catch {
        return
    }

    if (prefs.difficultyModifier !== undefined) Config.combat.difficultyModifier = prefs.difficultyModifier
    if (prefs.combatSpeed !== undefined) Config.combat.combatSpeed = prefs.combatSpeed
    if (prefs.violenceLevel !== undefined) Config.combat.violenceLevel = prefs.violenceLevel
    if (prefs.targetHighlight !== undefined) {
        // Migrate legacy boolean → 3-state string. CE: game_config.h:111 TargetHighlight.
        const v = prefs.targetHighlight
        Config.ui.targetHighlight = v === true ? 'on' : v === false ? 'off' : v
    }
    if (prefs.combatMessages !== undefined) Config.ui.combatMessages = prefs.combatMessages
    if (prefs.doAlwaysRun !== undefined) Config.engine.doAlwaysRun = prefs.doAlwaysRun
    if (prefs.subtitles !== undefined) Config.ui.subtitles = prefs.subtitles

    // Audio volumes — applied after audioEngine may be set
    if (globalState.audioEngine) {
        if (prefs.masterVolume !== undefined) globalState.audioEngine.setVolume('master', prefs.masterVolume)
        if (prefs.musicVolume !== undefined) globalState.audioEngine.setVolume('music', prefs.musicVolume)
        if (prefs.sfxVolume !== undefined) globalState.audioEngine.setVolume('sfx', prefs.sfxVolume)
    }
}

/** Returns the raw 0–100 volume value for the given channel. */
export function getVolumeValue(channel: 'master' | 'music' | 'sfx'): number {
    const eng = globalState.audioEngine
    if (!eng || !('masterVolume' in eng)) return 100
    const he = (eng as unknown) as { masterVolume: number; musicVolume: number; sfxVolume: number }
    if (channel === 'master') return Math.round(he.masterVolume * 100)
    if (channel === 'music') return Math.round(he.musicVolume * 100)
    return Math.round(he.sfxVolume * 100)
}

export function savePreferences(): void {
    const eng = globalState.audioEngine
    const hasVol = eng && 'masterVolume' in eng
    const he = hasVol ? ((eng as unknown) as { masterVolume: number; musicVolume: number; sfxVolume: number }) : null

    const prefs: SavedPreferences = {
        difficultyModifier: Config.combat.difficultyModifier,
        combatSpeed: Config.combat.combatSpeed,
        violenceLevel: Config.combat.violenceLevel,
        targetHighlight: Config.ui.targetHighlight,
        combatMessages: Config.ui.combatMessages,
        doAlwaysRun: Config.engine.doAlwaysRun,
        subtitles: Config.ui.subtitles,
        masterVolume: he ? Math.round(he.masterVolume * 100) : 100,
        musicVolume: he ? Math.round(he.musicVolume * 100) : 100,
        sfxVolume: he ? Math.round(he.sfxVolume * 100) : 100,
    }
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
}
