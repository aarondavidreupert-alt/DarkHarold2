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
import { hexDistance, hexesInRadius, hexIsInFrontOf, hexIsToRightOf, hexInDirection, hexInDirectionDistance } from './geometry.js'
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
import { isCEOccludingWall, isCEOccludingWallLiteral, isBBoxOccludingWall, WebGLRenderer } from './webglrenderer.js'
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

    // setLightPropagationMode('dh2')      — literal CE-ported 36-case switch table (default)
    // setLightPropagationMode('derived')  — DH2-original hex-grid BFS shadowcasting, inferred
    //                                        from reverse-engineering the literal switch table.
    //                                        See wiki/lighting.md → "Derived lighting mode
    //                                        (DH2 inference)". NOT verified bit-exact vs CE —
    //                                        compare against 'dh2' with lightingDebug().
    // setLightPropagationMode('naive')    — pure hex-distance falloff, NO occlusion at all
    //                                        (light bleeds through walls). Comparison baseline
    //                                        only — see wiki/lighting.md → "Naive lighting mode
    //                                        (distance-only baseline)".
    // This controls light *propagation/blocking*, not floor rendering — see setLightingMode()
    // above for the GPU/CPU floor-render backend switch (a separate, unrelated layer).
    ;(window as any).setLightPropagationMode = (mode: 'dh2' | 'derived' | 'naive') => {
        if (mode !== 'dh2' && mode !== 'derived' && mode !== 'naive') {
            console.log("Usage: setLightPropagationMode('dh2' | 'derived' | 'naive')")
            return
        }
        Config.engine.lightPropagationMode = mode
        Lightmap.bakeStaticLight()
        Lightmap.rebuildDynamicLight()
        console.log(`[Lighting] propagation mode="${mode}"`)
    }

    // setObjectLightingMode(mode) — controls how object/wall/critter sprites
    // sample the tile intensity texture (takes effect immediately, next frame):
    //
    //   'foot-y'  — (default) fixes world-Y to the bottom of the sprite's bounding
    //               box (ground-contact point), varies world-X per-fragment. Makes the
    //               player's floor light pool naturally at the base of walls.
    //   'tile-y'  — fixes world-Y to the object's tile position via the inverse hex
    //               formula (locks to the tile row exactly; slightly above the foot).
    //   'off'     — original per-fragment path: both X and Y come from gl_FragCoord.
    //               Tall sprites get dark tops but the horizontal gradient still works.
    ;(window as any).setObjectLightingMode = (mode: 'tile-y' | 'foot-y' | 'off') => {
        if (mode !== 'tile-y' && mode !== 'foot-y' && mode !== 'off') {
            console.log("Usage: setObjectLightingMode('tile-y' | 'foot-y' | 'off')")
            return
        }
        Config.engine.objectLightingMode = mode
        console.log(`[Lighting] object lighting mode="${mode}"`)
    }

    // setPlayerLight(radius, intensity) — set the player's own light source.
    // radius:    hex distance (CE default for the player/torch = 4)
    // intensity: 0–100 percent (CE maps 100% → 65536, matching obj_set_light_level)
    // Examples:
    //   setPlayerLight(4, 100)  — default torch
    //   setPlayerLight(8, 100)  — bigger torch
    //   setPlayerLight(0, 0)    — no personal light
    ;(window as any).setPlayerLight = (radius: number, intensity: number) => {
        const player = globalState.player
        if (!player) { console.log('[setPlayerLight] no player'); return }
        player.lightRadius = Math.max(0, Math.round(radius))
        player.lightIntensity = Math.round(Math.max(0, Math.min(100, intensity)) * 65536 / 100)
        Lightmap.rebuildLight()
        console.log(`[setPlayerLight] radius=${player.lightRadius} intensity=${player.lightIntensity} (${intensity}%)`)
    }

    // setLightingBilinear(mode) — choose how the tile-intensity texture
    // (u_tileIntensity, 200×200 R8, unit 5) is interpolated when the world
    // shaders sample it. hexToScreen is per-column-parity affine, so plain
    // 'linear' bleeds across the hex stagger and shows NW-SE stripes; the other
    // modes remove them. Takes effect next frame, persists across map changes
    // (stored in Config.engine.lightingInterpolation). See wiki/alignment.md §7.
    //
    //   'off'           — NEAREST. Crisp hex cells, no interpolation (debug baseline).
    //   'linear'        — LINEAR. Fast but striped; kept for comparison.
    //   'column-center' — LINEAR within a column only (no cross-column bleed).
    //   'hex-lerp'      — (default) 3-tap barycentric over the 3 nearest hexes;
    //                     geometrically correct, smoothest, no stripes.
    //   'bicubic'       — Catmull-Rom down the column; smoother falloff, no stagger.
    //
    // Back-compat: setLightingBilinear(true) → 'linear', setLightingBilinear(false) → 'off'.
    ;(window as any).setLightingBilinear = (mode: boolean | string) => {
        const r = globalState.renderer as WebGLRenderer
        if (!r || typeof r.setLightInterpMode !== 'function') {
            console.log('[setLightingBilinear] renderer not ready')
            return
        }
        const resolved = mode === true ? 'linear' : mode === false ? 'off' : mode
        const valid = ['off', 'linear', 'column-center', 'hex-lerp', 'bicubic']
        if (typeof resolved !== 'string' || !valid.includes(resolved)) {
            console.log("Usage: setLightingBilinear('off'|'linear'|'column-center'|'hex-lerp'|'bicubic')")
            return
        }
        Config.engine.lightingInterpolation = resolved as any
        r.setLightInterpMode(resolved as any)
        // GPU floor is cached in an FBO keyed on camera/zoom, but the lighting is
        // applied in the composite pass which re-runs every frame, so no FBO
        // invalidation is needed — the new mode shows on the next frame.
        console.log(`[setLightingBilinear] interpolation → '${resolved}'`)
    }

    // lightingDebug() — rebakes the current map's lighting under all three propagation
    // modes ('dh2', 'derived', 'naive') and lists every tile within radius hexes of the
    // player whose resulting intensity differs, mirroring eggDebug()'s side-by-side
    // comparison pattern.
    // Example: tile pos=21718 (18,108) dh2=43210 derived=39850 naive=51200 (DIFF)
    ;(window as any).lightingDebug = (radius: number = 10) => {
        const player = globalState.player
        if (!player) { console.log('[LightingDebug] no player'); return }
        console.log(`[LightingDebug] comparing 'dh2' vs 'derived' vs 'naive' within ${radius} hexes of player (live mode=${Config.engine.lightPropagationMode})`)
        const { dh2, derived, naive } = Lightmap.compareLightingModes()
        let diffCount = 0
        let sameCount = 0
        for (let x = Math.max(0, player.position.x - radius); x <= Math.min(199, player.position.x + radius); x++) {
            for (let y = Math.max(0, player.position.y - radius); y <= Math.min(199, player.position.y + radius); y++) {
                const pos = { x, y }
                if (hexDistance(player.position, pos) > radius) continue
                const tileNum = y * 200 + x
                const a = dh2[tileNum]
                const b = derived[tileNum]
                const c = naive[tileNum]
                if (a !== b || a !== c) {
                    diffCount++
                    console.log(`[LightingDebug] tile pos=${tileNum} (${x},${y}) dh2=${a} derived=${b} naive=${c} (DIFF)`)
                } else {
                    sameCount++
                }
            }
        }
        console.log(`[LightingDebug] ${diffCount} differing tiles, ${sameCount} matching tiles within radius ${radius}`)
    }

    // lightingPlayerDebug(rings=2) — dump light values for all hex neighbours around the
    // player, separated by ring, with direction labels (CE obj_types.h Rotation enum:
    // 0=NE 1=E 2=SE 3=SW 4=W 5=NW) and an ASCII hex grid so asymmetries are immediately
    // readable. Also compares all three propagation modes and flags DIFFs inline.
    //
    // CE ref: obj_types.h Rotation enum; tile.cc _off_tile / dword_51D984 screen offsets.
    // Screen offsets: NE=(+16,−12) E=(+32,0) SE=(+16,+12) SW=(−16,+12) W=(−32,0) NW=(−16,−12)
    // Grid layout: col = screenX/16 + 4, row = screenY/12 + 2  → 9 cols × 5 rows.
    // Natural indentation from leading null columns: rows 0,4 → 12-char, rows 1,3 → 6-char.
    ;(window as any).lightingPlayerDebug = (rings: number = 2, output: string = 'full') => {
        const player = globalState.player
        if (!player) { console.log('[LightingPlayerDebug] no player'); return }

        const showList = output !== 'hex'
        const showHex  = output !== 'list'

        const pos = player.position
        const propMode = Config.engine.lightPropagationMode
        // Inline helpers to avoid a module-level tile import just for this debug command.
        const toTile = (p: { x: number; y: number }): number => p.y * 200 + p.x
        const tileVal = (p: { x: number; y: number }): number => {
            const t = toTile(p)
            return (t >= 0 && t < 40000) ? Lightmap.tile_intensity[t] : 0
        }

        // CE Rotation enum: 0=NE,1=E,2=SE,3=SW,4=W,5=NW
        const DIR = ['NE', 'E', 'SE', 'SW', 'W', 'NW']

        // All-mode comparison snapshot
        const { dh2, derived, naive } = Lightmap.compareLightingModes()
        const diffStr = (p: { x: number; y: number }): string => {
            const t = toTile(p)
            if (t < 0 || t >= 40000) return ''
            const a = dh2[t], b = derived[t], c = naive[t]
            return (a !== b || a !== c) ? `  ← DIFF dh2=${a} derived=${b} naive=${c}` : ''
        }

        const px = pos.x, py = pos.y
        console.log(`[LightingPlayerDebug] Player @ (${px},${py}) | mode=${propMode} | output=${output}`)
        console.log(`  player tile (${px},${py}): ${tileVal(pos)}${diffStr(pos)}`)

        // ── Ring 1: 6 immediate neighbours ───────────────────────────────────────────
        const n1 = DIR.map((name, dir) => ({ name, p: hexInDirection(pos, dir) }))
        if (showList) {
            console.log('\n  Ring 1 (CE dir order 0–5):')
            n1.forEach(({ name, p }) =>
                console.log(`    ${name.padEnd(3)}: (${p.x},${p.y}) = ${tileVal(p)}${diffStr(p)}`)
            )
        }

        // ── Ring 2: 6 corner (dir×2) + 6 edge (between adjacent dirs) ───────────────
        type TP = { name: string; p: { x: number; y: number } }
        const n2corners: TP[] = rings >= 2
            ? DIR.map((name, dir) => ({ name: name + '×2', p: hexInDirectionDistance(pos, dir, 2) }))
            : []
        const EDGE_LABELS = ['NE+E', 'E+SE', 'SE+SW', 'SW+W', 'W+NW', 'NW+NE']
        const n2edges: TP[] = rings >= 2
            ? EDGE_LABELS.map((name, i) => ({
                name,
                // From the ring-1 tile in direction i, take one more step in direction (i+1)%6.
                p: hexInDirection(hexInDirection(pos, i), (i + 1) % 6),
            }))
            : []

        if (rings >= 2 && showList) {
            console.log('\n  Ring 2:')
            for (let i = 0; i < 6; i++) {
                const c = n2corners[i], e = n2edges[i]
                console.log(`    ${c.name.padEnd(6)}: (${c.p.x},${c.p.y}) = ${tileVal(c.p)}${diffStr(c.p)}`)
                console.log(`    ${e.name.padEnd(6)}: (${e.p.x},${e.p.y}) = ${tileVal(e.p)}${diffStr(e.p)}`)
            }
        }

        if (!showHex) return

        // ── ASCII hex grid ────────────────────────────────────────────────────────────
        // 9 columns × 5 rows. col = screenX/16+4, row = screenY/12+2.
        // Leading null columns produce natural indentation (12 chars for rows 0/4, 6 for rows 1/3).
        const CELL = 6  // chars per cell (fits 5-digit intensity + 1 sep)
        const GW = 9, GH = 5
        const g: (string | null)[][] = Array.from({ length: GH }, () => Array(GW).fill(null))

        const place = (sx: number, sy: number, val: string) => {
            const c = sx / 16 + 4, r = sy / 12 + 2
            if (r >= 0 && r < GH && c >= 0 && c < GW) g[r][c] = val
        }

        // Player
        place(0, 0, '@')
        // Ring-1: screen offsets from CE tile.cc _off_tile / dword_51D984
        const R1S = [[16,-12],[32,0],[16,12],[-16,12],[-32,0],[-16,-12]] as const
        n1.forEach(({ p }, i) => place(R1S[i][0], R1S[i][1], String(tileVal(p))))
        if (rings >= 2) {
            // Ring-2 corners (2× each direction)
            const R2CS = [[32,-24],[64,0],[32,24],[-32,24],[-64,0],[-32,-24]] as const
            n2corners.forEach(({ p }, i) => place(R2CS[i][0], R2CS[i][1], String(tileVal(p))))
            // Ring-2 edges (between adjacent directions)
            const R2ES = [[48,-12],[48,12],[0,24],[-48,12],[-48,-12],[0,-24]] as const
            n2edges.forEach(({ p }, i) => place(R2ES[i][0], R2ES[i][1], String(tileVal(p))))
        }

        const ringLabel = rings >= 2 ? '2 rings' : '1 ring'
        console.log(`\n  Hex grid (${ringLabel}, offsets = CE _off_tile/dword_51D984):`)
        for (let r = 0; r < GH; r++) {
            if (!g[r].some(x => x !== null)) continue
            let line = ''
            for (let c = 0; c < GW; c++) {
                const cell = g[r][c]
                if (cell !== null) {
                    line += cell.padStart(CELL)
                } else if (g[r].slice(c + 1).some(x => x !== null)) {
                    line += ' '.repeat(CELL)  // spacer between occupied cells in same row
                }
            }
            console.log('  ' + line)
        }
    }

    // Console commands for the egg transparency effect.
    // setEggMode('alpha')      — flat alpha applied to the whole wall sprite
    // setEggMode('dh2-egg')    — egg.png mask using DH2's hand-tuned occlusion test (default)
    // setEggMode('ce-egg')     — egg.png mask using the byte-for-byte literal CE occlusion
    //                            test (isCEOccludingWallLiteral) — no DH2 deviations, for A/B
    //                            comparison against 'dh2-egg'. See wiki/extended_flags.md §8.
    // setEggMode('bbox')       — egg.png mask using a screen-space bounding-box overlap +
    //                            draw-order depth test (isBBoxOccludingWall) — DH2-original,
    //                            not CE-derived. See wiki/extended_flags.md §8.
    // setEggMode('beta')       — floor hex debug overlay: colored quads on every floor tile
    //                            within eggRadius, no wall transparency
    // setEggAlpha(0.3)         — set the outer/flat alpha (0=invisible, 1=opaque, default 0.4)
    // setEggRadius(6)          — set max hex distance for egg effect (default 8)
    ;(window as any).setEggMode = (mode: 'alpha' | 'dh2-egg' | 'ce-egg' | 'bbox' | 'beta') => {
        if (mode !== 'alpha' && mode !== 'dh2-egg' && mode !== 'ce-egg' && mode !== 'bbox' && mode !== 'beta') {
            console.log("Usage: setEggMode('alpha'), setEggMode('dh2-egg'), setEggMode('ce-egg'), setEggMode('bbox'), or setEggMode('beta')")
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
    // the player, with all four isCEOccludingWall predicate components visible,
    // plus a side-by-side comparison of DH2's hand-tuned occlusion test ('dh2-egg'),
    // the byte-for-byte literal CE port ('ce-egg'), and the screen-space
    // bbox/depth test ('bbox') — see wiki/extended_flags.md §8 for what differs and why.
    // Example: wall pos=21718 extFlags=0x2000 fOD=false fDO=true rOD=false rDO=true → egg=true ceLiteral=false bbox=false (DIFF)
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
            const dh2Egg = isCEOccludingWall(obj, player)
            const ceEgg = isCEOccludingWallLiteral(obj, player)
            const bbox = isBBoxOccludingWall(obj, player)
            const pos = obj.position.y * 200 + obj.position.x
            const diff = (dh2Egg !== ceEgg || dh2Egg !== bbox) ? ' (DIFF)' : ''
            console.log(`[EggDebug] ${obj.type} pos=${pos} extFlags=0x${extFlags.toString(16)} fOD=${fOD} fDO=${fDO} rOD=${rOD} rDO=${rDO} → dh2Egg=${dh2Egg} ceEgg=${ceEgg} bbox=${bbox}${diff}`)
        }
        console.log(`[EggDebug] ${nearby.length} objects checked`)
    }

    // inspectPos(tileNum) — dump every object at a map position with all flag fields.
    // Example: inspectPos(22925)
    ;(window as any).inspectPos = (tileNum: number) => {
        if (!globalState.gMap) { console.log('[inspectPos] no map loaded'); return }
        const x = tileNum % 200
        const y = Math.floor(tileNum / 200)
        const objs = globalState.gMap.objectsAtPosition({ x, y })
        if (objs.length === 0) {
            console.log(`[inspectPos] no objects at position ${tileNum}`)
            return
        }
        // Collect every key matching /flag/i with a numeric value from src,
        // prefixed so caller knows which nesting level it came from.
        function flagsFrom(src: any, prefix: string): Record<string, string> {
            const out: Record<string, string> = {}
            if (!src || typeof src !== 'object') return out
            for (const k of Object.keys(src)) {
                if (/flag/i.test(k) && typeof src[k] === 'number') {
                    const v: number = src[k]
                    out[prefix + k] = `0x${v.toString(16).padStart(8, '0')} (${v})`
                }
            }
            return out
        }
        console.log(`[inspectPos] ${objs.length} object(s) at pos=${tileNum} (x=${x}, y=${y})`)
        for (const obj of objs) {
            console.log(`[inspectPos] → ${obj.type}`, {
                type: obj.type,
                pos: tileNum,
                frmPID: (obj as any).frmPID ?? null,
                ...flagsFrom(obj, ''),
                ...flagsFrom((obj as any).pro, 'pro.'),
                ...flagsFrom((obj as any).pro?.extra, 'pro.extra.'),
            })
        }
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
