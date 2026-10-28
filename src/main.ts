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
import { heart } from './heart.js'
import globalState from './globalState.js'
import * as IDBCache from './idbcache.js'
import { initGame, initialMapName } from './init.js'
import { prefetchMap } from './map/prefetch.js'
import { dbg, dbgWarn } from './logger.js'
import { initLuaRuntime } from './lua/luaRuntime.js'
import { clampCameraPosition, ceMapScroll, setScreenSize, ZOOM_MAX, ZOOM_MIN } from './renderer.js'
import { initLogScrollZones } from './messageLog.js'
import { UIMode } from './uiMode.js'
import { objUseItemOn } from './useItemOn.js'
import { assetUrl, initModAssets, mergeModJSON, overrideStylesheets, setArtVersion } from './modAssets.js'
import { loadFallout2Cfg, loadModsOrder, loadPreferences, parseModList } from './ui_options.js'
import { showSplash } from './splash.js'
import { isMainMenuReturn } from './mainMenuReturn.js'
import { skipOpeningMoviesLevel } from './init.js'
import { getFileJSON, prefetchAssets } from './util.js'
import { WebGLRenderer } from './webglrenderer.js'
import { Config } from './config.js'
import { fonUnpack } from './formats/fon.js'
import { installInputHandlers } from './input.js'
import { tickGame } from './gameTick.js'
import { devConsoleEnabled, registerDevConsole, registerEventLogCommands } from './devConsole.js'
import './autocrawler.js'
import './mapFade.js' // black screen over map changes (CE isoDisable / wmFadeOut)

// Re-export playerUse so existing call sites (scripting.ts imports it from './main.js')
// keep working after the Phase 7 split.
export { playerUse } from './playerUse.js'

// CE inventory.cc GAME_MOUSE_ACTION_MENU_ITEM_USE: an item without the use action is
// used on the dude (_protinst_use_item_on) — the medical kits run their skill with the
// kit's critical bonus. Wired via globalState.miscItemUseHandler (no object.ts cycle).
function miscHealingItemUse(item: import('./object.js').Obj, user: import('./object.js').Critter): boolean {
    // CE proto_types.h: First Aid Kit 47, Field Medic First Aid Kit 408, Doctor's Bag 91,
    // Paramedics Bag 409
    if (![47, 408, 91, 409].includes(item.pid)) return false
    objUseItemOn(user, user, item)
    return true
}

registerEventLogCommands()

/** The files the engine reads synchronously while it starts and loads the first map, prefetched
 *  at boot (fileCache.ts, wiki/code_quality.md Q13). A file missing here still loads, with a
 *  synchronous request; one listed that does not exist costs a 404. */
function bootFiles(backend: string): string[] {
    const lst = [
        'proto_items',
        'proto_critters',
        'proto_scenery',
        'proto_walls',
        'proto_misc',
        'art_items',
        'art_intrface',
        'sound_sfx_sndlist',
        'scripts',
    ]
    const gameMsg = [
        'pro_item',
        'pro_crit',
        'worldmap',
        'skilldex',
        'options',
        'perk',
        'scrname',
        'map',
        'misc',
        'intrface',
    ]
    return [
        ...lst.map((n) => `lut/lst/${n}.json`),
        ...gameMsg.map((n) => `data/text/english/game/${n}.msg`),
        'data/art/inven/inven.lst',
        'data/data/worldmap.txt',
        'data/data/maps.txt',
        'data/data/city.txt',
        'data/data/ai.txt',
        'data/gvars.json',
        'lut/color_lut.json',
        'lut/color_rgb.json',
        `data/scripts/obj_dude.${backend === 'lua' ? 'lua' : 'int'}`,
    ]
}

window.onload = async function () {
    globalState.isInitializing = true

    globalState.$fpsOverlay = document.getElementById('fpsOverlay')
    initLogScrollZones()

    // no-cache: the browser revalidates its copy (a 304 when unchanged) instead of a
    // ?v=Date.now() URL that is downloaded again on every load
    const fetchShader = (name: string) => fetch(`shaders/${name}.glsl`, { cache: 'no-cache' })
    const fragment = await fetchShader('fragment')
    const fragmentLighting = await fetchShader('fragmentLighting')
    const vertex = await fetchShader('vertex')
    const fragmentFont = await fetchShader('fragmentFont')

    // initialize renderer
    globalState.renderer = new WebGLRenderer(
        {
            fragment: await fragment.text(),
            fragmentLighting: await fragmentLighting.text(),
            vertex: await vertex.text(),
            fragmentFont: await fragmentFont.text(),
        },
        await Promise.all([0, 1, 2, 3, 5].map((i) => fonUnpack(`data/font${i}.fon`))),
    )

    globalState.renderer.init()
    // Apply the configured tile-intensity interpolation mode (default 'hex-lerp')
    // so the texture filter + shader branch match Config from the first frame.
    ;(globalState.renderer as WebGLRenderer).setLightInterpMode(Config.engine.lightingInterpolation)

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
                // [dh2] mouse_wheel=ce: CE game.cc gameHandleKey — the wheel scrolls the map a
                // step (up = north, a tilt wheel sideways)
                if (Config.ui.mouseWheel === 'ce') {
                    ceMapScroll(Math.sign(e.deltaX), Math.sign(e.deltaY))
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
                // CE ref: tile.cc:537 tileSetCenter — borders re-evaluated after any
                // zoom change because getWorldViewWidth/Height depend on zoom.
                clampCameraPosition()

                // The floor FBO caches a pre-zoomed snapshot of the floor;
                // invalidate it so the next frame re-bakes at the new zoom.
                const r = globalState.renderer as WebGLRenderer
                if (r && typeof r.invalidateFloorFBO === 'function') {
                    r.invalidateFloorFBO()
                }
            },
            { passive: false },
        )
    }

    // initialize audio engine
    if (Config.engine.doAudio) {
        globalState.audioEngine = new HTMLAudioEngine()
    } else {
        globalState.audioEngine = new NullAudioEngine()
    }

    // Apply persisted user preferences (volume, difficulty, etc.) after audioEngine is ready:
    // fallout2.cfg first (CE game_config.cc gameConfigInit), then the options screen's
    // localStorage write-back on top (FO2-CE ref: preferences.cc — preferenceLoad()).
    // mods/mods_order.txt first: fallout2.cfg's [dh2] mods= overrides it when set. Both are read
    // before any mod is active, so their plain paths are the ones to prefetch (fileCache.ts).
    await prefetchAssets(['mods/mods_order.txt', 'fallout2.cfg'])
    loadModsOrder()
    loadFallout2Cfg()
    loadPreferences()
    // play.html#script_backend=lua (or =vm) overrides fallout2.cfg for this page load; the
    // query string is taken by the ?mapname shortcut (init.ts)
    const backendOverride = /script_backend=(lua|vm)/.exec(location.hash)
    if (backendOverride) Config.scripting.backend = backendOverride[1] as 'lua' | 'vm'
    const modsOverride = /mods=([^&]*)/.exec(location.hash) // play.html#script_backend=lua&mods=a,b
    if (modsOverride) Config.scripting.mods = parseModList(decodeURIComponent(modsOverride[1]))
    // the active mods' asset folders (mods/<mod>/manifest.json), before any asset loads
    await initModAssets(Config.scripting.mods)
    // the static tables the engine reads synchronously while it starts (now that the mods are
    // known, so each key is fetched as assetUrl resolves it): no blocking request for them
    const prefetch = prefetchAssets(bootFiles(Config.scripting.backend))
    // the art/ files' version (modAssets.ts setArtVersion): every sprite URL changes when the
    // pipeline re-exports the art, so no stale sheet comes from the browser cache
    setArtVersion(await fileStamp('art/imageMap.json'))
    overrideStylesheets() // ui.css url()s: mod copies and the art version
    // CE gameInitWithOptions → showSplash while the game loads — not for a ?map / ?crawl
    // start, a return to the main menu, or SkipOpeningMovies=2
    if (!location.search && !isMainMenuReturn() && skipOpeningMoviesLevel() < 2) showSplash()
    // fallout2.cfg [dh2] script_backend=lua (the default) — start the Lua engine before
    // any script loads. An install whose pipeline did not decompile the scripts (no
    // data/scripts/obj_dude.lua, the player's script) runs the VM instead of asking
    // for a missing .lua before every .int.
    if (Config.scripting.backend === 'lua') {
        const decompiled = await fetch('data/scripts/obj_dude.lua', { method: 'HEAD' }).then(
            (r) => r.ok,
            () => false,
        )
        if (!decompiled) {
            dbgWarn('lua', 'no decompiled scripts (run the decompile_scripts pipeline stage); running the .int scripts')
            Config.scripting.backend = 'vm'
        }
    }
    if (Config.scripting.backend === 'lua') {
        try {
            await initLuaRuntime()
        } catch (e) {
            dbgWarn('lua', `Lua runtime failed to start (${e}); running the .int scripts`)
            Config.scripting.backend = 'vm'
        }
    }
    // fallout2.cfg [dh2] pixel_font — ui.css switches every DOM text to the AAF web font,
    // art/fonts/font1_aaf.woff. It is built from the install by the export_fonts pipeline
    // stage (not in git); without it the UI keeps the browser font instead of falling back
    // to a 9px monospace.
    let pixelFont = false
    if (Config.ui.pixelFont) {
        try {
            pixelFont = (await document.fonts.load("9px 'Fallout Font 1'")).length > 0
        } catch (_) {
            pixelFont = false
        }
        if (!pixelFont)
            dbgWarn(
                'load',
                'art/fonts/font1_aaf.woff did not load (run the export_fonts pipeline stage); using the browser font',
            )
    }
    document.documentElement.classList.toggle('dh2-pixel-font', pixelFont)

    // initialize cached data

    // Cheap fingerprint of a static file (Last-Modified + Content-Length of a HEAD request) so a
    // pipeline re-run invalidates the IndexedDB copy instead of silently serving stale
    // proMap/imageMap data forever.
    async function fileStamp(path: string): Promise<string> {
        try {
            // no-cache: revalidate, the browser's heuristic HTTP cache otherwise answers with
            // the stale Last-Modified of an older copy
            const response = await fetch(path, { method: 'HEAD', cache: 'no-cache' })
            return `${response.headers.get('Last-Modified') ?? ''}|${response.headers.get('Content-Length') ?? ''}`
        } catch {
            return ''
        }
    }

    // load data from the cache DB if it is still current, else load and cache it
    async function cachedJSON(key: string, path: string): Promise<unknown> {
        const stamp = await fileStamp(path)
        const cached = await IDBCache.getAsync<{ __stamp?: string; data: unknown }>(key)
        if (cached && cached.__stamp !== undefined && cached.__stamp === stamp && stamp !== '') {
            dbg('map', '[Main] %s loaded from cache DB', key)
            // the vanilla file is cached; the active mods' entries are merged on top
            return mergeModJSON(path, cached.data, getFileJSON)
        }
        // Version query string so the HTTP cache can't hand back an old body either.
        const response = await fetch(assetUrl(stamp ? `${path}?v=${encodeURIComponent(stamp)}` : path))
        if (response.status !== 200) throw Error(`cachedJSON: got status ${response.status} when requesting '${path}'`)
        const value = await response.json()
        IDBCache.add(key, { __stamp: stamp, data: value })
        dbg('map', '[Main] %s loaded and cached (stamp %s)', key, stamp)
        return mergeModJSON(path, value, getFileJSON)
    }

    // not awaited: the frame loop starts below meanwhile, as before (it waits on isInitializing)
    void (async () => {
        await IDBCache.initAsync()
        globalState.imageInfo = (await cachedJSON('imageMap', 'art/imageMap.json')) as typeof globalState.imageInfo
        globalState.proMap = (await cachedJSON('proMap', 'proto/pro.json')) as typeof globalState.proMap
        await prefetch
        // the first map's JSON and scripts (map/prefetch.ts), read synchronously by loadMap
        await prefetchMap(initialMapName())
        // continue initialization
        initGame()
        globalState.drugHandler = useDrug
        globalState.miscItemUseHandler = miscHealingItemUse
        globalState.isInitializing = false
    })()

    heart._init()

    // the developer console commands: play.html#dev only (src/devConsole/register.ts)
    if (devConsoleEnabled()) registerDevConsole()
}

installInputHandlers()

heart.update = tickGame

heart.draw = () => {
    const time = window.performance.now()

    globalState.renderer.render()

    globalState.lastDrawTime = Math.floor(window.performance.now() - time)
}
