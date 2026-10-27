// Copyright 2022 darkf
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Config } from '../config.js'
import { debug } from '../debug.js'
import globalState from '../globalState.js'
import * as IDBCache from '../idbcache.js'
import { dbg } from '../logger.js'
import { uiWorldMap } from '../ui.js'
import * as Worldmap from '../worldmap.js'

// console commands are free-form globals (play.html#dev)
const devWindow = window as unknown as Record<string, unknown>

// DH2 console commands (no CE equivalent): engine and UI toggles, test shortcuts.
// Moved out of main.ts (window.onload).

export function registerToggleCommands(): void {
    devWindow.toggleFloorLighting = () => {
        Config.engine.doFloorLighting = !Config.engine.doFloorLighting
        dbg('map', '[Lighting] floor lighting:', Config.engine.doFloorLighting)
    }

    // setRoofEgg(bool) — soft egg oval on roof tiles that occlude the player when
    // standing BEHIND a building (roof not hidden by the under-building flood-fill).
    devWindow.setRoofEgg = (on: boolean) => {
        Config.ui.roofEgg = on !== false
        console.log(`[Roof] egg-transparency = ${Config.ui.roofEgg}`)
    }

    // setWalkModel('ce' | 'dh2' | 'smooth') — walk/run movement model (Config.engine.walkModel)
    devWindow.setWalkModel = (model: 'ce' | 'dh2' | 'smooth') => {
        if (model !== 'ce' && model !== 'dh2' && model !== 'smooth') {
            console.log(
                "[Walk] use 'ce' (CE _object_move, default), 'dh2' (old DarkFO chunks) or 'smooth' (ce + frame blend)",
            )
            return
        }
        Config.engine.walkModel = model
        console.log(`[Walk] movement model = ${model}`)
    }

    // setAnimOffsetModel('ce' | 'dh2') — sprite offset across animation changes
    // (Config.engine.animOffsetModel)
    devWindow.setAnimOffsetModel = (model: 'ce' | 'dh2') => {
        if (model !== 'ce' && model !== 'dh2') {
            console.log("[Anim] use 'ce' (CE obj->x/y accumulator, default) or 'dh2' (old anchor-pinning artOffset)")
            return
        }
        Config.engine.animOffsetModel = model
        console.log(`[Anim] offset model = ${model}`)
    }

    // setDevKeys(true) — enable the DH2 developer hotkeys (h teleport, q/e elevation, ...)
    // Console: the debug readouts and the fps counter (fallout2.cfg [dh2] debug_overlay / fps_overlay)
    devWindow.setDebugOverlay = (on: boolean) => {
        Config.ui.showDebugOverlay = !!on
        console.log(`[DH2] debug overlay ${on ? 'on' : 'off'}`)
    }
    devWindow.setFpsOverlay = (on: boolean) => {
        Config.ui.showFPS = !!on
        if (globalState.$fpsOverlay) globalState.$fpsOverlay.style.display = on ? '' : 'none'
        console.log(`[DH2] fps overlay ${on ? 'on' : 'off'}`)
    }
    // Console: CE's 480×400 px scroll limit around the player (fallout2.cfg [dh2] scroll_player_limit)
    devWindow.setScrollPlayerLimit = (on: boolean) => {
        Config.ui.scrollPlayerLimit = !!on
        console.log(`[DH2] scroll limit around the player ${on ? 'on' : 'off'}`)
    }
    // Console: skipTemple() — leave the Temple of Trials for Arroyo Village (src/debug.ts).
    devWindow.skipTemple = () => debug.skipTemple()
    // Console (DH2 debug): revealWorldmap() — open the worldmap with every subtile, town
    // and entrance revealed; a click then moves the party there at once (no time, no
    // encounters). revealWorldmap(false) reveals without instant travel;
    // setInstantTravel(false) switches it off again.
    devWindow.revealWorldmap = (instant: boolean = true) => {
        if (globalState.inCombat) {
            console.warn('[DH2] revealWorldmap: not in combat')
            return
        }
        uiWorldMap() // loads the areas
        Worldmap.revealAll()
        Worldmap.setInstantTravel(instant !== false)
        uiWorldMap() // rebuilds the town list with every area
        console.log(
            `[DH2] worldmap revealed${instant !== false ? ', instant travel on (setInstantTravel(false) to stop)' : ''}`,
        )
    }
    devWindow.setInstantTravel = (on: boolean) => {
        Worldmap.setInstantTravel(!!on)
        console.log(`[DH2] worldmap instant travel ${on ? 'on' : 'off'}`)
    }
    devWindow.setDevKeys = (on: boolean) => {
        Config.engine.devKeys = on !== false
        console.log(`[Input] developer hotkeys ${Config.engine.devKeys ? 'on' : 'off'}`)
    }

    // setDayNightCycle(true)  — DH2 smooth day/night light curve (default)
    // setDayNightCycle(false) — CE lighting: only map scripts' set_light_level
    // For this session only; the permanent setting is fallout2.cfg [dh2] day_night_cycle.
    devWindow.setDayNightCycle = (on: boolean) => {
        Config.engine.dayNightCycle = on !== false
        console.log(
            `[Lighting] day/night cycle = ${Config.engine.dayNightCycle} (${Config.engine.dayNightCycle ? 'DH2 curve' : 'CE scripts only'})`,
        )
    }
}

export function registerCacheAndOutlineCommands(): void {
    // proMap / imageMap are cached in IndexedDB (main.ts cachedJSON()) so repeat
    // loads skip the network fetch. Each entry carries the file's Last-Modified +
    // size (fileStamp), so a pipeline re-run refreshes it on the next load; this
    // drops the cache by hand (then reload), e.g. when a server sends no stamp.
    devWindow.clearAssetCache = () => {
        IDBCache.nuke()
        console.log('[Cache] IndexedDB asset cache cleared — reload the page to re-fetch proMap/imageMap from disk.')
    }

    // Combat/item outline tuning (CI11/CI12, wiki/known_bugs.md). The
    // "border" layer (4 near-overlapping 1px offset stamps) reads as a near-
    // total fill in practice, not a thin edge — kept by request as the more
    // opaque/colorful layer; "fill" is the silhouette at its normal
    // position, drawn on top, typically more transparent so the border's
    // outermost sliver still pokes out around the edge.
    devWindow.setOutlineFillAlpha = (a: number) => {
        Config.ui.outlineFillAlpha = Math.max(0, Math.min(1, a))
        console.log(`[Outline] fillAlpha=${Config.ui.outlineFillAlpha}`)
    }
    devWindow.setOutlineBorderAlpha = (a: number) => {
        Config.ui.outlineBorderAlpha = Math.max(0, Math.min(1, a))
        console.log(`[Outline] borderAlpha=${Config.ui.outlineBorderAlpha}`)
    }
    // Dialogue screen-curvature highlight opacity tuning.
    // CSS opacity multiplies the PNG's own baked-in alpha, so these are
    // relative to whatever HIGHLIGHT_STRENGTH produced in export_mask_frms.py.
    // Usage:  setDialogueHighlights(0.5, 1.0)  (upper, lower, both 0.0–1.0)
    // The PNG bakes the full spatial falloff; CSS opacity is the sole strength
    // knob. 0=invisible, 1=max (raw PNG alpha). Defaults set in ui.css.
    devWindow.setDialogueHighlights = (upper: number, lower: number) => {
        const u = document.getElementById('dialogueHighlightUpper') as HTMLElement | null
        const l = document.getElementById('dialogueHighlightLower') as HTMLElement | null
        if (u) u.style.opacity = String(upper)
        if (l) l.style.opacity = String(lower)
        console.log(`[DialogueHighlight] upper=${upper} lower=${lower}`)
    }
}
