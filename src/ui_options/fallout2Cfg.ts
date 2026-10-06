/*
Copyright 2026 DarkHarold2 contributors

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

// fallout2.cfg support — CE config.cc configRead/configParseLine + settings.cc
// settingsFromConfig. If a fallout2.cfg sits next to play.html it seeds the
// preferences at startup (CE gameConfigInit). A browser can't write the file back
// (CE settingsToConfig/gameConfigSave on exit), so changes made in the options
// screen persist through localStorage (preferences.ts), which is applied after
// this and so takes precedence.

import { Config } from '../config.js'
import globalState from '../globalState.js'
import { dbg } from '../logger.js'
import { getFileText } from '../util.js'

export type CfgSections = { [section: string]: { [key: string]: string } }

// CE config.cc configParseLine: ';' starts a comment; "[name]" opens a section;
// otherwise "key=value" with both sides trimmed. Keys before any section land in
// "unknown" (gConfigLastSectionKey's initial value).
export function parseCfg(text: string): CfgSections {
    const out: CfgSections = {}
    let section = 'unknown'
    for (let line of text.split(/\r?\n/)) {
        const semi = line.indexOf(';')
        if (semi !== -1) line = line.slice(0, semi)
        line = line.replace(/^\s+/, '')
        if (line.startsWith('[')) {
            const close = line.indexOf(']')
            if (close !== -1) {
                section = line.slice(1, close).trim()
                continue
            }
        }
        const eq = line.indexOf('=')
        if (eq === -1) continue
        const key = line.slice(0, eq).trim()
        if (key === '') continue
        ;(out[section] ??= {})[key] = line.slice(eq + 1).trim()
    }
    return out
}

const DIFFICULTY: { [v: number]: 75 | 100 | 125 } = { 0: 75, 1: 100, 2: 125 }
const TARGET_HIGHLIGHT: { [v: number]: 'off' | 'on' | 'targeting-only' } = { 0: 'off', 1: 'on', 2: 'targeting-only' }
const SOUND_VOLUME_MAX = 32767 // CE settings.h volumes are 0..0x7FFF

// CE settings.cc settingsFromConfig — the [preferences]/[sound] keys DH2 has a
// counterpart for. Unknown or out-of-range values are ignored (CE keeps defaults).
export function applyCfg(cfg: CfgSections): void {
    const prefs = cfg['preferences'] ?? {}
    const sound = cfg['sound'] ?? {}
    const int = (v: string | undefined): number | null => {
        if (v === undefined) return null
        const n = parseInt(v, 10)
        return Number.isFinite(n) ? n : null
    }

    const gd = int(prefs['game_difficulty'])
    if (gd !== null && DIFFICULTY[gd]) Config.combat.gameDifficultyModifier = DIFFICULTY[gd]
    const cd = int(prefs['combat_difficulty'])
    if (cd !== null && DIFFICULTY[cd]) Config.combat.difficultyModifier = DIFFICULTY[cd]
    const vl = int(prefs['violence_level'])
    if (vl !== null && vl >= 0 && vl <= 3) Config.combat.violenceLevel = vl as 0 | 1 | 2 | 3
    const th = int(prefs['target_highlight'])
    if (th !== null && TARGET_HIGHLIGHT[th]) Config.ui.targetHighlight = TARGET_HIGHLIGHT[th]
    const ih = int(prefs['item_highlight'])
    if (ih !== null) Config.ui.itemHighlight = ih !== 0
    const cm = int(prefs['combat_messages'])
    if (cm !== null) Config.ui.combatMessages = cm !== 0 ? 'verbose' : 'brief'
    const lf = int(prefs['language_filter'])
    if (lf !== null) Config.ui.languageFilter = lf !== 0
    const run = int(prefs['running'])
    if (run !== null) Config.engine.doAlwaysRun = run !== 0
    const sub = int(prefs['subtitles'])
    if (sub !== null) Config.ui.subtitles = sub !== 0
    const cs = int(prefs['combat_speed'])
    if (cs !== null && cs >= 0 && cs <= 50) Config.combat.combatSpeed = cs
    const ps = int(prefs['player_speed'])
    if (ps !== null) Config.engine.playerSpeedup = ps !== 0
    const rbg = int(prefs['running_burning_guy'])
    if (rbg !== null) Config.combat.runningBurningGuy = rbg !== 0
    if (prefs['text_base_delay'] !== undefined) {
        const tbd = parseFloat(prefs['text_base_delay'])
        if (Number.isFinite(tbd) && tbd >= 1 && tbd <= 6) Config.ui.textBaseDelay = tbd
    }

    const eng = globalState.audioEngine
    if (eng) {
        const vol = (key: string, channel: 'master' | 'music' | 'sfx' | 'speech') => {
            const v = int(sound[key])
            if (v !== null && v >= 0 && v <= SOUND_VOLUME_MAX) eng.setVolume(channel, Math.round((v / SOUND_VOLUME_MAX) * 100))
        }
        vol('master_volume', 'master')
        vol('music_volume', 'music')
        vol('sndfx_volume', 'sfx')
        vol('speech_volume', 'speech')
    }
}

// CE game_config.cc gameConfigInit — read fallout2.cfg if present (a missing file is
// normal; CE then runs on its defaults).
export function loadFallout2Cfg(path = 'fallout2.cfg'): boolean {
    let text: string
    try {
        text = getFileText(path)
    } catch (_) {
        dbg('load', `${path} not found, using built-in defaults`)
        return false
    }
    applyCfg(parseCfg(text))
    dbg('load', `${path} applied`)
    return true
}
