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

import { Config, DRAG_WINDOWS } from '../config.js'
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
    const system = cfg['system'] ?? {}
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
    const ct = int(prefs['combat_taunts'])
    if (ct !== null) Config.ui.combatTaunts = ct !== 0
    const cl = int(prefs['combat_looks'])
    if (cl !== null) Config.ui.combatLooks = cl !== 0
    const flt = (key: string, lo: number, hi: number, set: (v: number) => void) => {
        if (prefs[key] === undefined) return
        const v = parseFloat(prefs[key])
        if (Number.isFinite(v) && v >= lo && v <= hi) set(v)
    }
    flt('brightness', 1.0, 1.18, (v) => { Config.ui.brightness = v })
    flt('mouse_sensitivity', 1.0, 2.5, (v) => { Config.ui.mouseSensitivity = v })
    if (prefs['text_base_delay'] !== undefined) {
        const tbd = parseFloat(prefs['text_base_delay'])
        if (Number.isFinite(tbd) && tbd >= 1 && tbd <= 6) Config.ui.textBaseDelay = tbd
    }

    // [system] color_cycling / cycle_speed_factor (CE cycle.cc colorCycleInit)
    const cc = int(system['color_cycling'])
    if (cc !== null) Config.ui.colorCycling = cc !== 0
    const csf = int(system['cycle_speed_factor'])
    if (csf !== null && csf > 0) Config.ui.cycleSpeedFactor = csf

    // [dh2] — DarkHarold2-only options (not in CE; CE ignores unknown sections).
    //   day_night_cycle=1  smooth hour-of-day light curve (default)
    //   day_night_cycle=0  CE lighting: only map scripts' set_light_level
    const dh2 = cfg['dh2'] ?? {}
    const dnc = int(dh2['day_night_cycle'])
    if (dnc !== null) Config.engine.dayNightCycle = dnc !== 0
    //   script_backend=lua  run the decompiled data/scripts/*.lua (tools/int2lua.py) (default)
    //   script_backend=vm   run the .int bytecode
    const sb = (dh2['script_backend'] ?? '').trim().toLowerCase()
    if (sb === 'lua' || sb === 'vm') Config.scripting.backend = sb
    //   script_fixes=0  the decompiled scripts keep the original bugs (default 1, SCRIPT_FIXES)
    const sf = int(dh2['script_fixes'])
    if (sf !== null) Config.scripting.scriptFixes = sf !== 0
    //   mods=a,b  mods in load order (folders under mods/: built asset mods, Lua mods; later ones win)
    // (empty: mods/mods_order.txt decides, loadModsOrder)
    if (dh2['mods'] !== undefined && dh2['mods'].trim() !== '') Config.scripting.mods = parseModList(dh2['mods'])
    //   pixel_font=0  UI text in the browser font instead of the Fallout pixel font (default 1)
    const pf = int(dh2['pixel_font'])
    if (pf !== null) Config.ui.pixelFont = pf !== 0
    //   elevator_use=0  no Use action on elevators: only walking in calls them (CE) (default 1)
    const eu = int(dh2['elevator_use'])
    if (eu !== null) Config.ui.elevatorUse = eu !== 0
    //   scroll_edge=<px>  how close to the screen edge the map scrolls (default 10; CE: the edge)
    const se = int(dh2['scroll_edge'])
    if (se !== null && se >= 0 && se <= 100) Config.ui.scrollPadding = se
    //   scroll_limit=0  the screen centre may scroll past the black map border (default 1)
    const sl = int(dh2['scroll_limit'])
    if (sl !== null) Config.ui.scrollLimitToBorder = sl !== 0
    //   scroll_bounds=ce   CE's scroll limits: the map's blocker ring and 480×400 px from the player (default)
    //   scroll_bounds=dh2  the older rectangle guessed from the blockers' / floor's bounding box
    const sbd = (dh2['scroll_bounds'] ?? '').trim().toLowerCase()
    if (sbd === 'ce' || sbd === 'dh2') Config.ui.scrollBounds = sbd
    //   scroll_player_limit=0  no 480×400 px limit around the player (default 1, CE); the
    //                          blocker ring and the black border still stop the view
    const spl = int(dh2['scroll_player_limit'])
    if (spl !== null) Config.ui.scrollPlayerLimit = spl !== 0
    //   walk_limit=0  critters may walk past the black map border (default 1: they stop at it)
    const wl = int(dh2['walk_limit'])
    if (wl !== null) Config.ui.walkLimitToBorder = wl !== 0
    //   debug_overlay=1  mouse-hex / tile / light / camera readouts (default 0)
    const dbo = int(dh2['debug_overlay'])
    if (dbo !== null) Config.ui.showDebugOverlay = dbo !== 0
    //   fps_overlay=0    hide the fps counter (default 1)
    const fpo = int(dh2['fps_overlay'])
    if (fpo !== null) Config.ui.showFPS = fpo !== 0
    //   drag_windows=0          no window can be dragged (default 1)
    //   drag_<window>=0|1       per window: inventory, character, characterCreator, options,
    //                           skilldex, pipboy, automap, loot, dialogue, dialogueReview,
    //                           elevator, calledShot, moveItems, saveLoad, perks, dialogBox
    const dw = int(dh2['drag_windows'])
    if (dw !== null) Config.ui.dragWindows = dw !== 0
    const dh2Lower: { [k: string]: string } = {}
    for (const k in dh2) dh2Lower[k.toLowerCase()] = dh2[k]
    for (const w of DRAG_WINDOWS) {
        const v = int(dh2Lower['drag_' + w.toLowerCase()]) // case-insensitive (drag_characterCreator)
        if (v !== null) Config.ui.dragWindow[w] = v !== 0
    }
    //   pipboy_available_at_game_start=1  Pip-Boy before the Vault Suit movie (sfall option)
    const pa = int(dh2['pipboy_available_at_game_start'])
    if (pa !== null) Config.engine.pipboyAvailableAtStart = pa !== 0
    //   walk_model=ce|dh2|smooth      walk/run movement (console setWalkModel, default ce)
    const wm = dh2['walk_model']?.toLowerCase()
    if (wm === 'ce' || wm === 'dh2' || wm === 'smooth') Config.engine.walkModel = wm
    //   object_sort=ce|ce-dh2|dh2     object draw order (default ce-dh2; see Config.engine.objectSort)
    const os = dh2['object_sort']?.toLowerCase()
    if (os === 'ce' || os === 'ce-dh2' || os === 'dh2') Config.engine.objectSort = os
    //   anim_offset_model=ce|dh2      sprite offset across animations (console setAnimOffsetModel)
    const am = dh2['anim_offset_model']?.toLowerCase()
    if (am === 'ce' || am === 'dh2') Config.engine.animOffsetModel = am

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

/** mods/mods_order.txt — the mods in load order, in sfall's mods_order.txt format
 *  (sfall LoadOrder.cpp GetExtraPatches): one entry per line, top to bottom, a later
 *  line taking priority; `;` or `#` starts a comment; blank lines skipped. Entries are
 *  folder names under mods/: Lua mods (mods/<name>/scripts/*.lua) and the asset folders
 *  the pipeline builds from an install's mods (mods/<name>/manifest.json, modAssets.ts);
 *  `.dat` entries name archives, not folders, and are skipped (wiki/upu_support.md). fallout2.cfg
 *  [dh2] mods= overrides the file when set. DH2 addition. Returns false if the file
 *  is missing. */
export function loadModsOrder(path = 'mods/mods_order.txt'): boolean {
    let text: string
    try {
        text = getFileText(path)
    } catch (_) {
        return false
    }
    const mods: string[] = []
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/[;#].*$/, '').trim()
        if (line === '' || /\.dat$/i.test(line)) continue
        const [name] = parseModList(line)
        if (name === undefined) continue
        // a name listed twice counts at its last line (sfall LoadOrder.cpp)
        if (mods.includes(name)) mods.splice(mods.indexOf(name), 1)
        mods.push(name)
    }
    Config.scripting.mods = mods
    dbg('load', `${path}: ${mods.length ? mods.join(', ') : 'no Lua mods'}`)
    return true
}

/** `a, b` -> ['a', 'b']: folder names only (no paths), empty entries dropped. */
export function parseModList(text: string): string[] {
    return text.split(',').map((m) => m.trim()).filter((m) => /^[\w.-]+$/.test(m) && m !== '.' && m !== '..')
}
