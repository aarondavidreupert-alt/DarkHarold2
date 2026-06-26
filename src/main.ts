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

import { HTMLAudioEngine, NullAudioEngine } from './audio.js'
import { useDrug } from './drugs.js'
import { getElevator } from './data.js'
import { heart } from './heart.js'
import { hexDistance, hexesInRadius, hexIsInFrontOf, hexIsToRightOf } from './geometry.js'
import globalState from './globalState.js'
import { IDBCache } from './idbcache.js'
import { initGame } from './init.js'
import { dbg } from './logger.js'
import {
    setScreenSize,
    ZOOM_MAX,
    ZOOM_MIN,
} from './renderer.js'
import {
    initLogScrollZones,
    uiElevator,
    UIMode,
} from './ui.js'
import { loadPreferences } from './ui_options.js'
import { getFileJSON } from './util.js'
import { isCEOccludingWall, WebGLRenderer } from './webglrenderer.js'
import { Config } from './config.js'
import { fonUnpack } from './formats/fon.js'
import { Lightmap } from './lightmap.js'
import { installInputHandlers } from './input.js'
import { tickGame } from './gameTick.js'
import './debug.js'
import './autocrawler.js'

// Re-export playerUse so existing call sites (scripting.ts imports it from './main.js')
// keep working after the Phase 7 split.
export { playerUse } from './playerUse.js'

window.onload = async function () {
    globalState.isInitializing = true

    globalState.$fpsOverlay = document.getElementById('fpsOverlay')
    initLogScrollZones()

    const _v = '?v=' + Date.now()
    const fragment = await fetch('shaders/fragment.glsl' + _v)
    const fragmentLighting = await fetch('shaders/fragmentLighting.glsl' + _v)
    const vertex = await fetch('shaders/vertex.glsl' + _v)
    const fragmentFont = await fetch('shaders/fragmentFont.glsl' + _v)

    // initialize renderer
    globalState.renderer = new WebGLRenderer(
        {
            fragment: await fragment.text(),
            fragmentLighting: await fragmentLighting.text(),
            vertex: await vertex.text(),
            fragmentFont: await fragmentFont.text(),
        },
        await Promise.all([0, 1, 2, 3, 5].map((i) => fonUnpack(`data/font${i}.fon`)))
    )

    globalState.renderer.init()

    // --- Dynamic resolution ---
    //
    // Resize the game canvas to fill the browser viewport and re-fit the
    // world whenever the window changes size (or on fullscreen toggle, or
    // when CSS layout shifts during a resize). The visible world area
    // grows with the window since SCREEN_WIDTH/SCREEN_HEIGHT propagate
    // through the renderer's visibility culling and shader uniforms.
    //
    // We debounce the handler (~80ms) because resize fires on every pixel
    // of a drag in some browsers and reallocating the floor FBO each
    // event wrecks performance.
    let resizeTimer: number | null = null
    const applyViewportSize = () => {
        const w = Math.max(1, window.innerWidth | 0)
        const h = Math.max(1, window.innerHeight | 0)

        // 1. Update the logical screen dimensions exported by renderer.ts.
        //    ES-module `let` exports are live bindings, so every consumer
        //    (culling, hex picking, UI layout) picks up the new value.
        setScreenSize(w, h)

        // 2. Tell the WebGL renderer to resize its canvas + FBOs + uniforms.
        const r = globalState.renderer as WebGLRenderer
        if (r && typeof r.resize === 'function') {
            r.resize(w, h)
        }

        // 3. Keep the temp canvas (used for single-pixel picking) in sync.
        if (globalState.tempCanvas) {
            globalState.tempCanvas.width = w
            globalState.tempCanvas.height = h
        }

        // 4. Refresh heart.js's cached size + canvas-offset so mouse
        //    coordinates continue to map to canvas-local pixels.
        heart._size.w = w
        heart._size.h = h
        if (heart.canvas) {
            const rect = heart.canvas.getBoundingClientRect()
            heart._canvasOffset.x = rect.left
            heart._canvasOffset.y = rect.top
        }
    }
    // Apply once immediately so the initial canvas matches the browser
    // viewport, even if the user loaded the page at a non-default size.
    applyViewportSize()

    window.addEventListener('resize', () => {
        if (resizeTimer !== null) {
            window.clearTimeout(resizeTimer)
        }
        resizeTimer = window.setTimeout(() => {
            resizeTimer = null
            applyViewportSize()
        }, 80)
    })

    // Fullscreen API toggle — delegated from a button in the DOM. We go
    // fullscreen on the whole document so the canvas (which fills the
    // viewport) expands to the screen edges. The browser fires a resize
    // event on entry/exit, so applyViewportSize() runs automatically.
    const fullscreenBtn = document.getElementById('fullscreenBtn') as HTMLButtonElement | null
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {})
            } else {
                document.documentElement.requestFullscreen().catch(() => {})
            }
        })
        document.addEventListener('fullscreenchange', () => {
            fullscreenBtn.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen'
        })
    }

    // --- Mouse-wheel zoom ---
    //
    // Scrolling the wheel zooms the world in/out centered on the mouse
    // cursor: the world point currently under the cursor stays pinned to
    // that screen location across the zoom. UI (HUD, PipBoy, HTML overlays)
    // is not affected — the renderer only applies zoom to world draws.
    //
    // Continuous (non-snapping) zoom feels smoother for map navigation
    // than stepped levels; each wheel notch multiplies zoom by ~1.1 (or
    // divides, for zoom-out), clamped to [ZOOM_MIN, ZOOM_MAX].
    const zoomCanvas = document.getElementById('cnv') as HTMLCanvasElement | null
    if (zoomCanvas) {
        zoomCanvas.addEventListener(
            'wheel',
            (e: WheelEvent) => {
                // Prevent the browser from scrolling the page when the
                // cursor is over the game canvas.
                e.preventDefault()
                if (globalState.isInitializing || globalState.isLoading) {
                    return
                }
                // Ignore zoom while a modal UI (dialog, inventory, pipboy)
                // is up — it'd desync the underlying paused map.
                if (globalState.uiMode !== UIMode.none && globalState.uiMode !== UIMode.useSkill) {
                    return
                }

                const oldZoom = globalState.cameraZoom || 1.0
                // deltaY > 0 = scroll down = zoom out; < 0 = zoom in.
                // Use the sign only so high-resolution touchpads don't
                // make zoom jittery or too sensitive.
                const step = 1.1
                const factor = e.deltaY < 0 ? step : 1 / step
                const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, oldZoom * factor))
                if (newZoom === oldZoom) {
                    return
                }

                // Anchor the zoom on the cursor: we want the world point
                // under the mouse before zoom to stay under the mouse
                // after. With camera as world-space top-left and
                // screen = (world - cam) * zoom:
                //     world_under_mouse = cam_old + mouse/zoom_old
                //                       = cam_new + mouse/zoom_new
                // ⇒ cam_new = cam_old + mouse*(1/zoom_old − 1/zoom_new).
                const rect = zoomCanvas.getBoundingClientRect()
                const mouseX = e.clientX - rect.left
                const mouseY = e.clientY - rect.top
                globalState.cameraPosition.x += mouseX * (1 / oldZoom - 1 / newZoom)
                globalState.cameraPosition.y += mouseY * (1 / oldZoom - 1 / newZoom)
                globalState.cameraZoom = newZoom

                // The floor FBO caches a pre-zoomed snapshot of the floor;
                // invalidate it so the next frame re-bakes at the new zoom.
                const r = globalState.renderer as WebGLRenderer
                if (r && typeof r.invalidateFloorFBO === 'function') {
                    r.invalidateFloorFBO()
                }
            },
            { passive: false }
        )
    }

    // initialize audio engine
    if (Config.engine.doAudio) {
        globalState.audioEngine = new HTMLAudioEngine()
    } else {
        globalState.audioEngine = new NullAudioEngine()
    }

    // Apply persisted user preferences (volume, difficulty, etc.) after audioEngine is ready.
    // FO2-CE ref: preferences.cc — preferenceLoad()
    loadPreferences()

    // initialize cached data

    function cachedJSON(key: string, path: string, callback: (value: any) => void): void {
        // load data from cache if possible, else load and cache it
        IDBCache.get(key, (value) => {
            if (value) {
                dbg('map', '[Main] %s loaded from cache DB', key)
                callback(value)
            } else {
                value = getFileJSON(path)
                IDBCache.add(key, value)
                dbg('map', '[Main] %s loaded and cached', key)
                callback(value)
            }
        })
    }

    IDBCache.init(() => {
        cachedJSON('imageMap', 'art/imageMap.json', (value) => {
            globalState.imageInfo = value

            cachedJSON('proMap', 'proto/pro.json', (value) => {
                globalState.proMap = value

                // continue initialization
                initGame()
                globalState.drugHandler = useDrug
                globalState.isInitializing = false

                // debug exposure for console inspection
                ;(window as any).debugLightmap = Lightmap
                ;(window as any).debugRenderer = globalState.renderer
                ;(window as any).debugGlobalState = globalState
            })
        })
    })

    heart._init()

    ;(window as any).toggleFloorLighting = () => {
        Config.engine.doFloorLighting = !Config.engine.doFloorLighting
        dbg('map', '[Lighting] floor lighting:', Config.engine.doFloorLighting)
    }

    ;(window as any).setLightingMode = (mode: 'gpu' | 'cpu') => {
        Config.engine.floorLightingMode = mode
        ;(globalState.renderer as WebGLRenderer).setLightingMode(mode)
        dbg('map', '[Lighting] switched to:', mode)
    }

    // Console commands for the egg transparency effect.
    // setEggMode('alpha') — flat alpha applied to the whole wall sprite
    // setEggMode('egg')   — CE-faithful egg.png mask: smooth falloff centered on player (default)
    // setEggMode('beta')  — floor hex debug overlay: colored quads on every floor tile within
    //                       eggRadius, no wall transparency — verifies hex radius shape on field
    // setEggAlpha(0.3)    — set the outer/flat alpha (0=invisible, 1=opaque, default 0.4)
    // setEggRadius(6)     — set max hex distance for egg effect (default 8)
    ;(window as any).setEggMode = (mode: 'alpha' | 'egg' | 'beta') => {
        if (mode !== 'alpha' && mode !== 'egg' && mode !== 'beta') {
            console.log("Usage: setEggMode('alpha'), setEggMode('egg'), or setEggMode('beta')")
            return
        }
        Config.ui.eggMode = mode
        console.log(`[Egg] mode="${mode}"  alpha=${Config.ui.eggAlpha ?? 0.4}  radius=${Config.ui.eggRadius ?? 8}`)
    }
    ;(window as any).setEggAlpha = (a: number) => {
        Config.ui.eggAlpha = Math.max(0, Math.min(1, a))
        console.log(`[Egg] alpha=${Config.ui.eggAlpha}`)
    }
    ;(window as any).setEggRadius = (r: number) => {
        Config.ui.eggRadius = Math.max(1, r)
        console.log(`[Egg] radius=${Config.ui.eggRadius}`)
    }
    ;(window as any).debugEgg = () => {
        const r = globalState.renderer as WebGLRenderer
        // Quick sanity check that proto/pro.json's wall extendedFlags data
        // actually made it into the cached proMap — if every sampled wall
        // shows extendedFlags=0, the browser is very likely still serving a
        // stale proMap cached in IndexedDB from before that field existed.
        // Run clearAssetCache() and reload if so.
        let wallsWithFlags = 0
        let wallsSampled = 0
        const walls = (globalState.proMap as any)?.walls
        if (walls) {
            for (const id of Object.keys(walls).slice(0, 50)) {
                wallsSampled++
                if ((walls[id]?.extra?.extendedFlags ?? 0) !== 0) wallsWithFlags++
            }
        }
        console.log('[Egg] diagnostic:', {
            mode: Config.ui.eggMode,
            alpha: Config.ui.eggAlpha ?? 0.4,
            radius: Config.ui.eggRadius ?? 8,
            textureLoaded: !!r.eggTexture,
            eggWidth: r.eggWidth,
            eggHeight: r.eggHeight,
            uEggMode: !!r.uEggMode,
            uEggCenter: !!r.uEggCenter,
            uEggSize: !!r.uEggSize,
            playerPosition: globalState.player ? { x: globalState.player.position.x, y: globalState.player.position.y } : null,
            cameraPosition: globalState.cameraPosition,
            zoom: globalState.cameraZoom,
            wallExtendedFlagsSample: `${wallsWithFlags}/${wallsSampled} sampled walls have nonzero extendedFlags`
                + (wallsSampled > 0 && wallsWithFlags === 0 ? ' — STALE proMap cache? Try clearAssetCache()' : ''),
        })
    }

    // eggDebug() — real-time dump of every wall/scenery within egg radius of
    // the player, with all four isCEOccludingWall predicate components visible.
    // Example: wall pos=21718 extFlags=0x2000 fOD=false fDO=true rOD=false rDO=true → occluding=true
    ;(window as any).eggDebug = () => {
        const player = globalState.player
        if (!player) { console.log('[EggDebug] no player'); return }
        const radius = Config.ui.eggRadius ?? 8
        const playerPos = player.position.y * 200 + player.position.x
        console.log(`[EggDebug] player pos=${playerPos} (radius=${radius}, mode=${Config.ui.eggMode})`)
        const objs = globalState.gMap?.getObjects() ?? []
        const nearby = objs.filter(o =>
            (o.type === 'wall' || o.type === 'scenery') &&
            hexDistance(player.position, o.position) <= radius
        )
        if (nearby.length === 0) {
            console.log('[EggDebug] no wall/scenery within radius')
            return
        }
        for (const obj of nearby) {
            const extFlags: number = (obj as any).pro?.extra?.extendedFlags ?? 0
            const fOD = hexIsInFrontOf(obj.position, player.position)
            const fDO = hexIsInFrontOf(player.position, obj.position)
            const rOD = hexIsToRightOf(obj.position, player.position)
            const rDO = hexIsToRightOf(player.position, obj.position)
            const occluding = isCEOccludingWall(obj, player)
            const pos = obj.position.y * 200 + obj.position.x
            console.log(`[EggDebug] ${obj.type} pos=${pos} extFlags=0x${extFlags.toString(16)} fOD=${fOD} fDO=${fDO} rOD=${rOD} rDO=${rDO} → occluding=${occluding}`)
        }
        console.log(`[EggDebug] ${nearby.length} objects checked`)
    }

    // proMap / imageMap are cached in IndexedDB (see cachedJSON() above) so
    // repeat loads skip the network fetch — but that means editing
    // proto/pro.json (or any other cached JSON) on disk has NO EFFECT until
    // this cache is cleared, since IDBCache has no content-versioning of
    // its own. Run this after any proto/pro.json regeneration, then reload.
    ;(window as any).clearAssetCache = () => {
        IDBCache.nuke()
        console.log('[Cache] IndexedDB asset cache cleared — reload the page to re-fetch proMap/imageMap from disk.')
    }

    // Combat/item outline tuning (CI11/CI12, wiki/known_bugs.md). The
    // "border" layer (4 near-overlapping 1px offset stamps) reads as a near-
    // total fill in practice, not a thin edge — kept by request as the more
    // opaque/colorful layer; "fill" is the silhouette at its normal
    // position, drawn on top, typically more transparent so the border's
    // outermost sliver still pokes out around the edge.
    ;(window as any).setOutlineFillAlpha = (a: number) => {
        Config.ui.outlineFillAlpha = Math.max(0, Math.min(1, a))
        console.log(`[Outline] fillAlpha=${Config.ui.outlineFillAlpha}`)
    }
    ;(window as any).setOutlineBorderAlpha = (a: number) => {
        Config.ui.outlineBorderAlpha = Math.max(0, Math.min(1, a))
        console.log(`[Outline] borderAlpha=${Config.ui.outlineBorderAlpha}`)
    }
    // Dialogue screen-curvature highlight opacity tuning.
    // CSS opacity multiplies the PNG's own baked-in alpha, so these are
    // relative to whatever HIGHLIGHT_STRENGTH produced in export_mask_frms.py.
    // Usage:  setDialogueHighlights(0.5, 1.0)  (upper, lower, both 0.0–1.0)
    // The PNG bakes the full spatial falloff; CSS opacity is the sole strength
    // knob. 0=invisible, 1=max (raw PNG alpha). Defaults set in ui.css.
    ;(window as any).setDialogueHighlights = (upper: number, lower: number) => {
        const u = document.getElementById('dialogueHighlightUpper') as HTMLElement | null
        const l = document.getElementById('dialogueHighlightLower') as HTMLElement | null
        if (u) u.style.opacity = String(upper)
        if (l) l.style.opacity = String(lower)
        console.log(`[DialogueHighlight] upper=${upper} lower=${lower}`)
    }
}

installInputHandlers()

heart.update = tickGame

heart.draw = () => {
    const time = window.performance.now()

    if (globalState.isWaitingOnRemote) {
        return
    }
    globalState.renderer.render()

    globalState.lastDrawTime = Math.floor(window.performance.now() - time)
}

export function useElevator(): void {
    // Player walked into an elevator
    //
    // We search for the Elevator Stub (Scenery PID 1293)
    // in the range of 11. The original engine uses a square
    // of size 11x11, but we don't do that.

    dbg('map', '[Elevator] entered')

    const center = globalState.player.position
    const hexes = hexesInRadius(center, 11)
    let elevatorStub = null
    for (let i = 0; i < hexes.length; i++) {
        const objs = globalState.gMap.objectsAtPosition(hexes[i])
        for (let j = 0; j < objs.length; j++) {
            const obj = objs[j]
            if (obj.type === 'scenery' && obj.pidID === 1293) {
                dbg('map', `[Elevator] stub @ (${hexes[i].x}, ${hexes[i].y})`)
                elevatorStub = obj
                break
            }
        }
    }

    if (elevatorStub === null) {
        throw "couldn't find elevator stub near " + center.x + ', ' + center.y
    }

    dbg('map', `[Elevator] type=${elevatorStub.extra.type}, level=${elevatorStub.extra.level}`)

    const elevator = getElevator(elevatorStub.extra.type)
    if (!elevator) {
        throw 'no elevator: ' + elevatorStub.extra.type
    }

    uiElevator(elevator)
}
