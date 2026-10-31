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
import { hexDistance, hexInDirection, hexInDirectionDistance } from '../geometry.js'
import { world } from '../state/world.js'
import { services } from '../state/services.js'
import * as Lightmap from '../lightmap.js'
import { dbg } from '../logger.js'
import {
    WebGLRenderer,
    setLightSourceOverlayActive,
    setLightOverlayMode,
    setLightOverlayRadiusScale,
    LightOverlayMode,
} from '../webglrenderer.js'

// console commands are free-form globals (play.html#dev)
const devWindow = window as unknown as Record<string, unknown>

// DH2 console commands (no CE equivalent): lighting modes and lighting diagnostics.
// Moved out of main.ts (window.onload). See wiki/lighting.md and wiki/alignment.md.

export function registerLightingCommands(): void {
    devWindow.setLightingMode = (mode: 'gpu' | 'cpu') => {
        Config.engine.floorLightingMode = mode
        ;(services.renderer as WebGLRenderer).setLightingMode(mode)
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
    devWindow.setLightPropagationMode = (mode: 'dh2' | 'derived' | 'naive') => {
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
    // sample the tile intensity texture (takes effect immediately, next frame).
    // The '*-smooth'/'flat' modes exist to test fixes for the residual per-column
    // "vertical stripe" texture on wall faces — see wiki/alignment.md §8.
    //
    //   'wall-clamp'  — (default) world-Y pinned exactly to the foot row; samples the
    //                   floor light field per column via the shared floor path, so the
    //                   wall gradient matches the floor's and inherits setLightingBilinear
    //                   (LINEAR = smooth, NEAREST = discrete). No per-wall blend, no stripes.
    //   'foot-y'      — world-Y at the sprite's ground-contact point (±6 soft band),
    //                   world-X per-fragment. Light pools at the wall base. Has stripes.
    //   'tile-y'      — world-Y locked to the object's tile row (inverse hex). Has stripes.
    //   'flat'        — CE-faithful: ONE intensity for the whole sprite (tile centre).
    //                   No gradient, no stripes — matches vanilla Fallout 2.
    //   'foot-smooth' — foot-y + a world-space blur kernel that softens the stripes
    //                   while keeping the pooling gradient. Tune with setObjectLightSmooth().
    //   'tile-smooth' — tile-y + the same blur kernel.
    //   'off'         — original per-fragment path (dark tops on tall sprites).
    devWindow.setObjectLightingMode = (mode: string) => {
        const valid = ['tile-y', 'foot-y', 'off', 'flat', 'foot-smooth', 'tile-smooth', 'wall-clamp']
        if (!valid.includes(mode)) {
            console.log(
                "Usage: setObjectLightingMode('foot-y'|'tile-y'|'wall-clamp'|'flat'|'foot-smooth'|'tile-smooth'|'off')",
            )
            return
        }
        Config.engine.objectLightingMode = mode as any
        console.log(
            `[Lighting] object lighting mode="${mode}"` +
                (mode.endsWith('-smooth')
                    ? ` (blur ${Config.engine.objectLightSmoothPx}px — setObjectLightSmooth(px) to tune)`
                    : ''),
        )
    }

    // setObjectLightSmooth(px) — blur kernel radius (world px) for the '*-smooth'
    // object lighting modes. Larger = smoother wall faces, softer light detail.
    // Try values ~4–24; 12 is the default. Takes effect next frame.
    devWindow.setObjectLightSmooth = (px: number) => {
        if (typeof px !== 'number' || !isFinite(px) || px < 0) {
            console.log('Usage: setObjectLightSmooth(px)  — world pixels, e.g. setObjectLightSmooth(12)')
            return
        }
        Config.engine.objectLightSmoothPx = px
        console.log(
            `[Lighting] object light smooth kernel = ${px}px` +
                (Config.engine.objectLightingMode.endsWith('-smooth')
                    ? ''
                    : " (set mode to 'foot-smooth' or 'tile-smooth' to see it)"),
        )
    }

    // Wall top-edge fade depth (in art texels): a wall's lit contribution fades to
    // ambient within N texels of the sprite's painted top edge (alpha-silhouette).
    // DEFAULT OFF (0) — opt-in: it gates on obj.type === 'wall', which is noisy in
    // Fallout data (catches furniture like bar counters, misses 'scenery'
    // decorations, and hits interior walls), so it over-/under-applies. Enable to
    // experiment; ~4–24 is a reasonable range. Split per orientation:
    //   setWallTopFadeEW(px)    — E-W-run walls (extendedFlags 0x8000000/0x40000000)
    //   setWallTopFadeNWSE(px)  — the other orientation (NE-SW / corner / default)
    //   setWallTopFade(px)      — set BOTH at once (0 disables)
    const _validFade = (px: number) => typeof px === 'number' && isFinite(px) && px >= 0
    devWindow.setWallTopFadeEW = (px: number) => {
        if (!_validFade(px)) {
            console.log('Usage: setWallTopFadeEW(px)  — art texels; 0 to disable')
            return
        }
        Config.engine.wallTopFadePx = px
        console.log(`[Lighting] wall top-edge fade (E-W) = ${px} texels${px === 0 ? ' (disabled)' : ''}`)
    }
    devWindow.setWallTopFadeNWSE = (px: number) => {
        if (!_validFade(px)) {
            console.log('Usage: setWallTopFadeNWSE(px)  — art texels; 0 to disable')
            return
        }
        Config.engine.wallTopFadePxNWSE = px
        console.log(`[Lighting] wall top-edge fade (NW-SE) = ${px} texels${px === 0 ? ' (disabled)' : ''}`)
    }
    devWindow.setWallTopFade = (px: number) => {
        if (!_validFade(px)) {
            console.log('Usage: setWallTopFade(px)  — sets both E-W and NW-SE; 0 to disable')
            return
        }
        Config.engine.wallTopFadePx = px
        Config.engine.wallTopFadePxNWSE = px
        console.log(`[Lighting] wall top-edge fade (both) = ${px} texels${px === 0 ? ' (disabled)' : ''}`)
    }

    // setPlayerLightSmooth(mode) — how a walking critter's own light (mainly the
    // player's radius-4 torch) is stamped while moving. The lightmap is a per-tile
    // grid, so CE snaps the cone tile-to-tile on arrival; the smooth modes split the
    // stamp so the cone centre tracks the gliding sprite. Only affects the 'dh2'
    // propagation mode. Takes effect next frame. See wiki/lighting.md.
    //   'ce'        — integer-hex stamp; CE-faithful tile-snap.
    //   'blend'     — 2-tile lerp between current and next path hex by walk progress.
    //   'egg-split' — (default) barycentric split across the tiles under the animated
    //                 foot position; tracks the sprite exactly (like the egg anchor).
    devWindow.setPlayerLightSmooth = (mode: string) => {
        const valid = ['ce', 'blend', 'egg-split']
        if (!valid.includes(mode)) {
            console.log("Usage: setPlayerLightSmooth('ce' | 'blend' | 'egg-split')")
            return
        }
        Config.engine.playerLightSmooth = mode as any
        console.log(
            `[Lighting] player light smoothing = '${mode}'` +
                (mode !== 'ce' && Config.engine.lightPropagationMode !== 'dh2'
                    ? " (note: only active in 'dh2' propagation mode)"
                    : ''),
        )
    }

    // showLightSources(true/false) — persistent, camera-aware debug overlay
    // that draws every active light source (lightRadius > 0 &&
    // lightIntensity > 655) as a labelled circle on the 2D text overlay:
    // colour-coded centre dot, dashed radius ring, and r=/i= + type/name label.
    // It reads obj.lightRadius/lightIntensity directly, so it survives
    // setLightPropagationMode / setObjectLightingMode switches — you can watch
    // the effect of changing modes while seeing exactly where the sources are.
    devWindow.showLightSources = (on: boolean) => {
        setLightSourceOverlayActive(on)
        console.log(`[lightDebug] light source overlay ${on ? 'ON' : 'OFF'}`)
    }

    // setLightOverlayMode(mode) — how the radius is drawn around each source:
    //   'ellipse' — (default) perspective-correct dashed ellipse (a ground
    //               circle projects to an ellipse squashed by the tile ratio)
    //   'tiles'   — fill every hex within lightRadius as a translucent floor
    //               rhombus, like the 'beta' egg overlay
    //   'none'    — no radius shape; just the centre point + its r=/i= data
    devWindow.setLightOverlayMode = (mode: LightOverlayMode) => {
        if (mode !== 'ellipse' && mode !== 'tiles' && mode !== 'none') {
            console.log("Usage: setLightOverlayMode('ellipse' | 'tiles' | 'none')")
            return
        }
        setLightOverlayMode(mode)
        console.log(`[lightDebug] light overlay mode="${mode}"`)
    }

    // setLightOverlayRadius(scale) — multiplies the overlay ellipse's screen
    // radius (defaults to 1.0). Use it to calibrate whether the ellipse lines
    // up with the visible light falloff on the floor — a diagnostic for the
    // hex-UV offset issue. (No effect in 'tiles'/'none' modes.)
    devWindow.setLightOverlayRadius = (scale: number) => {
        setLightOverlayRadiusScale(scale)
        console.log(`[lightDebug] light overlay radius scale=${scale}`)
    }

    // setPlayerLight(radius, intensity) — set the player's own light source.
    // radius:    hex distance (CE default for the player/torch = 4)
    // intensity: 0–100 percent (CE maps 100% → 65536, matching obj_set_light_level)
    // Examples:
    //   setPlayerLight(4, 100)  — default torch
    //   setPlayerLight(8, 100)  — bigger torch
    //   setPlayerLight(0, 0)    — no personal light
    devWindow.setPlayerLight = (radius: number, intensity: number) => {
        const player = world.player
        if (!player) {
            console.log('[setPlayerLight] no player')
            return
        }
        player.lightRadius = Math.max(0, Math.round(radius))
        player.lightIntensity = Math.round((Math.max(0, Math.min(100, intensity)) * 65536) / 100)
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
    // Back-compat: setLightingBilinear(true)/'on' → 'linear', false/'off' → 'off'.
    devWindow.setLightingBilinear = (mode: boolean | string) => {
        const r = services.renderer as WebGLRenderer
        if (!r || typeof r.setLightInterpMode !== 'function') {
            console.log('[setLightingBilinear] renderer not ready')
            return
        }
        const resolved = mode === true || mode === 'on' ? 'linear' : mode === false || mode === 'off' ? 'off' : mode
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
    devWindow.lightingDebug = (radius: number = 10) => {
        const player = world.player
        if (!player) {
            console.log('[LightingDebug] no player')
            return
        }
        console.log(
            `[LightingDebug] comparing 'dh2' vs 'derived' vs 'naive' within ${radius} hexes of player (live mode=${Config.engine.lightPropagationMode})`,
        )
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
                    console.log(
                        `[LightingDebug] tile pos=${tileNum} (${x},${y}) dh2=${a} derived=${b} naive=${c} (DIFF)`,
                    )
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
    devWindow.lightingPlayerDebug = (rings: number = 2, output: string = 'full') => {
        const player = world.player
        if (!player) {
            console.log('[LightingPlayerDebug] no player')
            return
        }

        const showList = output !== 'hex'
        const showHex = output !== 'list'

        const pos = player.position
        const propMode = Config.engine.lightPropagationMode
        // Inline helpers to avoid a module-level tile import just for this debug command.
        const toTile = (p: { x: number; y: number }): number => p.y * 200 + p.x
        const tileVal = (p: { x: number; y: number }): number => {
            const t = toTile(p)
            return t >= 0 && t < 40000 ? Lightmap.tile_intensity[t] : 0
        }

        // CE Rotation enum: 0=NE,1=E,2=SE,3=SW,4=W,5=NW
        const DIR = ['NE', 'E', 'SE', 'SW', 'W', 'NW']

        // All-mode comparison snapshot
        const { dh2, derived, naive } = Lightmap.compareLightingModes()
        const diffStr = (p: { x: number; y: number }): string => {
            const t = toTile(p)
            if (t < 0 || t >= 40000) return ''
            const a = dh2[t],
                b = derived[t],
                c = naive[t]
            return a !== b || a !== c ? `  ← DIFF dh2=${a} derived=${b} naive=${c}` : ''
        }

        const px = pos.x,
            py = pos.y
        console.log(`[LightingPlayerDebug] Player @ (${px},${py}) | mode=${propMode} | output=${output}`)
        console.log(`  player tile (${px},${py}): ${tileVal(pos)}${diffStr(pos)}`)

        // ── Ring 1: 6 immediate neighbours ───────────────────────────────────────────
        const n1 = DIR.map((name, dir) => ({ name, p: hexInDirection(pos, dir) }))
        if (showList) {
            console.log('\n  Ring 1 (CE dir order 0–5):')
            n1.forEach(({ name, p }) =>
                console.log(`    ${name.padEnd(3)}: (${p.x},${p.y}) = ${tileVal(p)}${diffStr(p)}`),
            )
        }

        // ── Ring 2: 6 corner (dir×2) + 6 edge (between adjacent dirs) ───────────────
        type TP = { name: string; p: { x: number; y: number } }
        const n2corners: TP[] =
            rings >= 2 ? DIR.map((name, dir) => ({ name: name + '×2', p: hexInDirectionDistance(pos, dir, 2) })) : []
        const EDGE_LABELS = ['NE+E', 'E+SE', 'SE+SW', 'SW+W', 'W+NW', 'NW+NE']
        const n2edges: TP[] =
            rings >= 2
                ? EDGE_LABELS.map((name, i) => ({
                      name,
                      // From the ring-1 tile in direction i, take one more step in direction (i+1)%6.
                      p: hexInDirection(hexInDirection(pos, i), (i + 1) % 6),
                  }))
                : []

        if (rings >= 2 && showList) {
            console.log('\n  Ring 2:')
            for (let i = 0; i < 6; i++) {
                const c = n2corners[i],
                    e = n2edges[i]
                console.log(`    ${c.name.padEnd(6)}: (${c.p.x},${c.p.y}) = ${tileVal(c.p)}${diffStr(c.p)}`)
                console.log(`    ${e.name.padEnd(6)}: (${e.p.x},${e.p.y}) = ${tileVal(e.p)}${diffStr(e.p)}`)
            }
        }

        if (!showHex) return

        // ── ASCII hex grid ────────────────────────────────────────────────────────────
        // 9 columns × 5 rows. col = screenX/16+4, row = screenY/12+2.
        // Leading null columns produce natural indentation (12 chars for rows 0/4, 6 for rows 1/3).
        const CELL = 6 // chars per cell (fits 5-digit intensity + 1 sep)
        const GW = 9,
            GH = 5
        const g: (string | null)[][] = Array.from({ length: GH }, () => Array(GW).fill(null))

        const place = (sx: number, sy: number, val: string) => {
            const c = sx / 16 + 4,
                r = sy / 12 + 2
            if (r >= 0 && r < GH && c >= 0 && c < GW) g[r][c] = val
        }

        // Player
        place(0, 0, '@')
        // Ring-1: screen offsets from CE tile.cc _off_tile / dword_51D984
        const R1S = [
            [16, -12],
            [32, 0],
            [16, 12],
            [-16, 12],
            [-32, 0],
            [-16, -12],
        ] as const
        n1.forEach(({ p }, i) => place(R1S[i][0], R1S[i][1], String(tileVal(p))))
        if (rings >= 2) {
            // Ring-2 corners (2× each direction)
            const R2CS = [
                [32, -24],
                [64, 0],
                [32, 24],
                [-32, 24],
                [-64, 0],
                [-32, -24],
            ] as const
            n2corners.forEach(({ p }, i) => place(R2CS[i][0], R2CS[i][1], String(tileVal(p))))
            // Ring-2 edges (between adjacent directions)
            const R2ES = [
                [48, -12],
                [48, 12],
                [0, 24],
                [-48, 12],
                [-48, -12],
                [0, -24],
            ] as const
            n2edges.forEach(({ p }, i) => place(R2ES[i][0], R2ES[i][1], String(tileVal(p))))
        }

        const ringLabel = rings >= 2 ? '2 rings' : '1 ring'
        console.log(`\n  Hex grid (${ringLabel}, offsets = CE _off_tile/dword_51D984):`)
        for (let r = 0; r < GH; r++) {
            if (!g[r].some((x) => x !== null)) continue
            let line = ''
            for (let c = 0; c < GW; c++) {
                const cell = g[r][c]
                if (cell !== null) {
                    line += cell.padStart(CELL)
                } else if (g[r].slice(c + 1).some((x) => x !== null)) {
                    line += ' '.repeat(CELL) // spacer between occupied cells in same row
                }
            }
            console.log('  ' + line)
        }
    }
}
