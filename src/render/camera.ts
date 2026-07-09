/*
Copyright 2015 darkf

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

// Camera / zoom / screen-coord helpers split out of renderer.ts.
// See wiki/ts-split-refactor.md → "Per-file split proposals" §16.

import { hexFromScreen, hexToScreen, Point } from '../geometry.js'
import globalState from '../globalState.js'
import { Obj } from '../object.js'
import { Config } from '../config.js'
import { tileToScreen, TILE_WIDTH, TILE_HEIGHT } from '../tile.js'

// Logical screen dimensions. Dynamic — resized at runtime when the browser
// window resizes so the visible world area grows/shrinks with the viewport.
// Exposed as `export let` so ES-module consumers pick up the updated value
// through the live binding; use setScreenSize() to mutate it.
export let SCREEN_WIDTH: number = Config.ui.screenWidth
export let SCREEN_HEIGHT: number = Config.ui.screenHeight

export function setScreenSize(w: number, h: number): void {
    SCREEN_WIDTH = w | 0
    SCREEN_HEIGHT = h | 0
}

// Mouse-wheel zoom bounds. Below 0.5 the world becomes hard to interact with,
// above 3.0 the sprites get pixelated to the point of uselessness.
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 3.0

// CE ref: tile.cc ORIGINAL_ISO_WINDOW_WIDTH/HEIGHT — the scroll border is always
// computed as if the iso view were this size, regardless of actual resolution
// ("For now keep borders for original resolution"). We use its half-extents as
// the fixed reference margin when clamping the viewport centre, so at higher
// resolutions / zoomed out you scroll to the same world limit and see black
// margins beyond the content (which the black overlay fills).
export const ORIGINAL_ISO_WINDOW_WIDTH = 640
export const ORIGINAL_ISO_WINDOW_HEIGHT = 380

// Current zoom factor — always reads from globalState so it stays in sync with
// whatever wheel handler / debug toggle last touched it. Defaults to 1.0 if
// somehow unset so the codebase doesn't explode on older saves/loads.
export function getZoom(): number {
    return globalState.cameraZoom || 1.0
}

// Convert a point in screen-pixel space (0..SCREEN_WIDTH, 0..SCREEN_HEIGHT)
// to world coordinates, honoring the current camera + zoom. Used for mouse
// picking, hex picking, etc.
export function screenToWorld(sx: number, sy: number): Point {
    const z = getZoom()
    return {
        x: sx / z + globalState.cameraPosition.x,
        y: sy / z + globalState.cameraPosition.y,
    }
}

// Convert a point in world coordinates to screen-pixel space. Used when
// drawing world-anchored overlays (hex_outline, float messages, spatials).
export function worldToScreen(wx: number, wy: number): Point {
    const z = getZoom()
    return {
        x: (wx - globalState.cameraPosition.x) * z,
        y: (wy - globalState.cameraPosition.y) * z,
    }
}

// The visible world-space area in world units. When zoomed out we see
// more than SCREEN_WIDTH of world; when zoomed in, less.
export function getWorldViewWidth(): number {
    return SCREEN_WIDTH / getZoom()
}
export function getWorldViewHeight(): number {
    return SCREEN_HEIGHT / getZoom()
}

// CE ref: tile.cc:461 tileSetBorder() — border margins computed at 640×380
// (ORIGINAL_ISO_WINDOW_WIDTH/HEIGHT) regardless of actual viewport size. The
// CE comment says: "For now keep borders for original resolution."
//
// CE's borders cover the full 200×200 tile grid minus a viewport-sized margin,
// which is much wider than any individual map's content area. DH2 maps only
// place floor tiles in the content region; areas outside render as black.
// So we use per-map empirically-tuned limits (viewport-centre world coords)
// that match each map's actual playfield, with CE_CENTER_BOUNDS as fallback.
export const CE_CENTER_BOUNDS = {
    minX: hexToScreen(153, 44).x,   // 1840 — full 200×200 grid fallback
    maxX: hexToScreen(45, 155).x,   // 6208
    minY: hexToScreen(45, 44).y,    // 803
    maxY: hexToScreen(153, 155).y,  // 2783
}

// Per-map scroll limits (viewport-centre world coords, empirically tuned).
// Key = map filename stem, lowercase (matches GameMap.name).
// Add an entry for each map as it is tested in-game.
const MAP_SCROLL_LIMITS: Record<string, typeof CE_CENTER_BOUNDS> = {
    arvillag: { minX: 3367, maxX: 4492, minY: 1370, maxY: 2210 },
    kladwtwn: { minX: 3178, maxX: 4918, minY: 1400, maxY: 2150 },
    klatrap:  { minX: 3343, maxX: 4468, minY: 1445, maxY: 2090 },
    geckjunk: { minX: 3535, maxX: 4870, minY: 1463, maxY: 2183 },
}

// Active limits — updated by setMapScrollLimits() on each map load.
let _activeLimits: typeof CE_CENTER_BOUNDS = CE_CENTER_BOUNDS

export function setMapScrollLimits(mapName: string): void {
    _activeLimits = MAP_SCROLL_LIMITS[mapName] ?? CE_CENTER_BOUNDS
}

// Returns the active centre bounds (used by the scroll clamp).
export function getActiveScrollLimits(): typeof CE_CENTER_BOUNDS {
    return (window as any).scrollLimits ?? _activeLimits
}

// Returns content-EDGE bounds for the overlay: expand centre bounds outward by
// the current half-viewport so the overlay only fires when the viewport edge
// actually extends past the content boundary.
export function getActiveScrollEdgeBounds(): typeof CE_CENTER_BOUNDS {
    const lim = getActiveScrollLimits()
    const halfW = getWorldViewWidth() / 2
    const halfH = getWorldViewHeight() / 2
    return {
        minX: lim.minX - halfW,
        maxX: lim.maxX + halfW,
        minY: lim.minY - halfH,
        maxY: lim.maxY + halfH,
    }
}

// World-space bounding box of the actual (non-empty) floor tiles on the current
// map/elevation. This is the FIXED content extent — zoom- and resolution-
// independent — and is the source of truth for the black edge overlay. CE ref:
// tile.cc tileRefreshGame bufferFill(0): everything past the last real tile is
// black. `null` until a map is loaded / computeMapContentBounds runs.
export let mapContentBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null

// Scan the floor tilemap for real tiles and record their world-space bbox.
// Called on every map load and elevation change (floorMap differs per level).
// floorMap is indexed [y][x]; the empty-tile sentinel is 'grid000'.
export function computeMapContentBounds(floorMap: string[][] | null): void {
    if (!floorMap || floorMap.length === 0) {
        mapContentBounds = null
        return
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (let y = 0; y < floorMap.length; y++) {
        const row = floorMap[y]
        if (!row) continue
        for (let x = 0; x < row.length; x++) {
            if (row[x] === 'grid000') continue
            const p = tileToScreen(x, y)
            if (p.x < minX) minX = p.x
            if (p.x + TILE_WIDTH > maxX) maxX = p.x + TILE_WIDTH
            if (p.y < minY) minY = p.y
            if (p.y + TILE_HEIGHT > maxY) maxY = p.y + TILE_HEIGHT
        }
    }
    mapContentBounds = (minX === Infinity) ? null : { minX, maxX, minY, maxY }
}

// Keep the old name as an alias so renderer.ts re-exports work unchanged.
export const MAP_WORLD_BOUNDS = CE_CENTER_BOUNDS

export function clampCameraPosition(): void {
    const viewW = getWorldViewWidth()
    const viewH = getWorldViewHeight()
    const halfW = viewW / 2
    const halfH = viewH / 2

    const prevX = globalState.cameraPosition.x
    const prevY = globalState.cameraPosition.y
    // The viewport centre we want to constrain (camera top-left + half view).
    const prevCX = prevX + halfW
    const prevCY = prevY + halfH

    // Derive the valid viewport-CENTRE range. window.scrollLimits still wins for
    // live tuning; otherwise prefer the CE-faithful content-bbox clamp and fall
    // back to the per-map/CE centre bounds only if the bbox isn't available.
    let loCX: number, hiCX: number, loCY: number, hiCY: number
    const override = (window as any).scrollLimits
    const b = mapContentBounds
    if (override) {
        loCX = override.minX; hiCX = override.maxX
        loCY = override.minY; hiCY = override.maxY
    } else if (b) {
        // CE ref: tile.cc tileSetBorder — border computed at ORIGINAL_ISO window
        // size, not the actual one. The centre is constrained so a 640×380 view
        // centred there stays inside the content; at real (larger) viewports the
        // extra margin projects to black beyond the content, filled by the overlay.
        const refHalfW = ORIGINAL_ISO_WINDOW_WIDTH / 2   // 320
        const refHalfH = ORIGINAL_ISO_WINDOW_HEIGHT / 2  // 190
        loCX = b.minX + refHalfW; hiCX = b.maxX - refHalfW
        loCY = b.minY + refHalfH; hiCY = b.maxY - refHalfH
        // Content smaller than the reference window on an axis → lock centre to
        // the content midpoint (map fully visible, black on all sides).
        if (loCX > hiCX) { const m = (b.minX + b.maxX) / 2; loCX = hiCX = m }
        if (loCY > hiCY) { const m = (b.minY + b.maxY) / 2; loCY = hiCY = m }
    } else {
        loCX = _activeLimits.minX; hiCX = _activeLimits.maxX
        loCY = _activeLimits.minY; hiCY = _activeLimits.maxY
    }

    let nextCX = Math.max(loCX, Math.min(hiCX, prevCX))
    let nextCY = Math.max(loCY, Math.min(hiCY, prevCY))

    // CE ref: object.cc:2559 _obj_scroll_blocking_at — misc PID 0x500000C
    // (type=5, pidID=12) flags a tile as a scroll blocker. Reject the move
    // when the proposed viewport centre sits on such a tile.
    const gMap = globalState.gMap
    if (gMap) {
        const centerHex = hexFromScreen(nextCX, nextCY)
        const blocked = gMap.objectsAtPosition(centerHex).some((o: Obj) =>
            (o as any).type === 'misc' && (o as any).pidID === 12)
        if (blocked) {
            nextCX = prevCX
            nextCY = prevCY
        }
    }
    globalState.cameraPosition.x = nextCX - halfW
    globalState.cameraPosition.y = nextCY - halfH
}

export function centerCamera(around: Point) {
    const scr = hexToScreen(around.x, around.y)
    // The visible world region shrinks as zoom grows, so divide by zoom
    // when offsetting from the target to the top-left camera anchor.
    const viewW = getWorldViewWidth()
    const viewH = getWorldViewHeight()
    globalState.cameraPosition.x = (scr.x - viewW / 2) | 0
    globalState.cameraPosition.y = (scr.y - viewH / 2) | 0
    clampCameraPosition()
}
