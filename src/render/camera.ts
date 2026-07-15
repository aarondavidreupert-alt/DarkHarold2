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

// Sprite half-extents added to each object's screen position so the bbox
// covers the full art footprint, not just the anchor point.
const OBJ_HALF_W = 48
const OBJ_HALF_H = 36

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

// Per-map bar bounds — EDGE coords (where the black bars sit), calibrated via
// blackBar() in-game. getActiveScrollBarBounds() returns these directly;
// getActiveScrollLimits() insets them by (320,190) to get the centre clamp.
// Add an entry only when a map's auto object-bbox feels wrong.
const MAP_BAR_BOUNDS: Record<string, typeof CE_CENTER_BOUNDS> = {
    arvillag: { minX: 2920, maxX: 4944, minY:  991, maxY: 2579 },
    artemple: { minX: 3720, maxX: 4444, minY: 1211, maxY: 2099 },
    denbus1:  { minX: 2860, maxX: 5272, minY: 1055, maxY: 2683 },
    denres1:  { minX: 2364, maxX: 4996, minY: 1075, maxY: 2127 },
    kladwtwn: { minX: 2740, maxX: 5372, minY: 1035, maxY: 2515 },
    klamall:  { minX: 2560, maxX: 5292, minY: 1035, maxY: 2515 },
    newrst:   { minX: 2400, maxX: 5324, minY: 1051, maxY: 2459 },
}

// Active bar bounds for this map — set on each map load.
let _activeBarBounds: typeof CE_CENTER_BOUNDS | null = null

export function setMapScrollLimits(mapName: string): void {
    _activeBarBounds = MAP_BAR_BOUNDS[mapName] ?? null
    // Clear any live console override so it doesn't bleed into the next map.
    delete (window as any).scrollLimits
    delete (window as any).borderDebug
    delete (window as any)._bbSide
    if (_bbKeyListener) { document.removeEventListener('keydown', _bbKeyListener); _bbKeyListener = null }
}

// Returns the world-space EDGE bounds for the black overlay bars.
// Precedence:
//   1. window.scrollLimits   — live blackBar() editor
//   2. MAP_BAR_BOUNDS entry  — hand-calibrated edge bounds for this map
//   3. objectContentBounds   — auto: world bbox of placed objects
//   4. null                  — no data yet; overlay skips drawing
// Returns the world-space EDGE bounds for the black overlay bars.
// Precedence:
//   1. window.scrollLimits   — live blackBar() editor
//   2. MAP_BAR_BOUNDS entry  — hand-calibrated edge bounds for this map
//   3. mapContentBounds      — auto: interior floor bbox (non-grid000, non-edg*) + inset
//   4. null                  — no data yet; overlay skips drawing
export function getActiveScrollBarBounds(): typeof CE_CENTER_BOUNDS | null {
    if ((window as any).scrollLimits) return (window as any).scrollLimits
    if (_activeBarBounds) return _activeBarBounds
    return mapContentBounds ?? null
}

// Returns the viewport-CENTRE clamp bounds (bar bounds inset by CE reference
// half-extents 320×190 so the camera stops before content leaves screen).
export function getActiveScrollLimits(): typeof CE_CENTER_BOUNDS {
    const inX = ORIGINAL_ISO_WINDOW_WIDTH  / 2  // 320
    const inY = ORIGINAL_ISO_WINDOW_HEIGHT / 2  // 190
    const barBounds = getActiveScrollBarBounds()
    if (barBounds) {
        return { minX: barBounds.minX + inX, maxX: barBounds.maxX - inX, minY: barBounds.minY + inY, maxY: barBounds.maxY - inY }
    }
    return CE_CENTER_BOUNDS
}

// World-space bounding box of the placed objects on the current map/elevation.
// This is the authoritative "playfield" extent — much tighter than the floor
// bbox because desert-fill floor tiles extend far past the settlements.
// CE has no equivalent (its maps fill the whole grid), so this is DH2-specific.
// `null` until a map is loaded / computeObjectContentBounds runs.
export let objectContentBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null

// Floor-tile bbox kept for debug/diagnostic purposes only (window.mapContentBounds).
export let mapContentBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null

// Scan the placed objects on the current elevation and record their world-space
// bbox. hexToScreen converts hex-grid position to world-space pixels. Called
// from GameMap.changeElevation after objects are ready.
export function computeObjectContentBounds(objects: Obj[]): void {
    if (!objects || objects.length === 0) {
        objectContentBounds = null
        ;(window as any).objectContentBounds = null
        return
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const obj of objects) {
        const pos = (obj as any).position
        if (!pos || pos.x == null || pos.y == null) continue
        const p = hexToScreen(pos.x, pos.y)
        if (p.x - OBJ_HALF_W < minX) minX = p.x - OBJ_HALF_W
        if (p.x + OBJ_HALF_W > maxX) maxX = p.x + OBJ_HALF_W
        if (p.y - OBJ_HALF_H < minY) minY = p.y - OBJ_HALF_H
        if (p.y + OBJ_HALF_H > maxY) maxY = p.y + OBJ_HALF_H
    }
    objectContentBounds = (minX === Infinity) ? null : { minX, maxX, minY, maxY }
    ;(window as any).objectContentBounds = objectContentBounds
    console.log('[scroll] objectContentBounds =', JSON.stringify(objectContentBounds),
        objects.length + ' objects')
}

// Interior inset applied to the raw non-edg floor bbox to arrive at bar bounds.
// Empirically validated against 5 hand-calibrated maps: X diff ≈ ±129px,
// Y-top diff ≈ 55px. A single fixed pad of 130/60 produces results within
// ~60px of manual calibration on every tested map.
const INTERIOR_INSET_X = 130
const INTERIOR_INSET_Y = 60

// Scan the floor tilemap for the interior playfield bbox and store the bar
// bounds (inset interior) in mapContentBounds. "Interior" = tiles that are
// neither the empty filler ('grid000') nor border-transition tiles ('edg*').
// The edg* tiles are explicitly the artist-drawn outer ring — excluding them
// gives the settled/playable area, which matches hand-calibrated bar positions
// to within ~60px on all tested maps. Called on every map load / elevation change.
export function computeMapContentBounds(floorMap: string[][] | null): void {
    if (!floorMap || floorMap.length === 0) {
        mapContentBounds = null
        ;(window as any).mapContentBounds = null
        return
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (let y = 0; y < floorMap.length; y++) {
        const row = floorMap[y]
        if (!row) continue
        for (let x = 0; x < row.length; x++) {
            const name = row[x]
            if (name === 'grid000' || name.startsWith('edg')) continue
            const p = tileToScreen(x, y)
            if (p.x < minX) minX = p.x
            if (p.x + TILE_WIDTH > maxX) maxX = p.x + TILE_WIDTH
            if (p.y < minY) minY = p.y
            if (p.y + TILE_HEIGHT > maxY) maxY = p.y + TILE_HEIGHT
        }
    }
    if (minX === Infinity) {
        mapContentBounds = null
    } else {
        // Inset to the calibrated bar position.
        mapContentBounds = {
            minX: minX + INTERIOR_INSET_X,
            maxX: maxX - INTERIOR_INSET_X,
            minY: minY + INTERIOR_INSET_Y,
            maxY: maxY - INTERIOR_INSET_Y,
        }
    }
    ;(window as any).mapContentBounds = mapContentBounds
    console.log('[scroll] interiorFloorBounds =', JSON.stringify(mapContentBounds))
}

// Copyable console diagnostic. Call `scrollDebug()` in DevTools to print the
// current content bbox, camera, zoom, screen size, and the black-bar widths the
// overlay would draw this frame. Returns the same object so it copies cleanly.
;(window as any).scrollDebug = function () {
    const ob = objectContentBounds
    const cam = globalState.cameraPosition
    const z = getZoom()
    const lim = getActiveScrollLimits()
    const out: any = {
        objBbox: ob,
        autoClamp: ob ? { minX: Math.round(ob.minX+320), maxX: Math.round(ob.maxX-320), minY: Math.round(ob.minY+190), maxY: Math.round(ob.maxY-190) } : null,
        activeClamp: lim,
        camera: { x: Math.round(cam.x), y: Math.round(cam.y) },
        zoom: z,
        screen: { w: SCREEN_WIDTH, h: SCREEN_HEIGHT },
    }
    if (ob) {
        out.barsPx = {
            left:   Math.round((ob.minX - cam.x) * z),
            right:  Math.round(SCREEN_WIDTH - (ob.maxX - cam.x) * z),
            top:    Math.round((ob.minY - cam.y) * z),
            bottom: Math.round(SCREEN_HEIGHT - (ob.maxY - cam.y) * z),
        }
    }
    console.log('[scrollDebug] ' + JSON.stringify(out))
    return out
}

// --- Interactive black-bar editor (call from DevTools console) ---
//
//   blackBar('W')   → edit west  bar with PageUp/PageDown
//   blackBar('E')   → edit east  bar
//   blackBar('N')   → edit north bar
//   blackBar('S')   → edit south bar
//   blackBar()      → exit editor (bars go solid black, clamp re-enabled)
//
//   While in edit mode:
//     PageUp   → move active bar outward (more map visible)
//     PageDown → move active bar inward  (less map visible)
//     Step = 20 world units per press (hold Shift = 5)
//
//   clearBorder() → revert to auto object-bbox bounds
//
const BB_STEP = 20

let _bbKeyListener: ((e: KeyboardEvent) => void) | null = null

;(window as any).blackBar = function (side?: 'W' | 'E' | 'N' | 'S') {
    // Exit mode
    if (!side) {
        ;(window as any).borderDebug = false
        ;(window as any)._bbSide = null
        if (_bbKeyListener) { document.removeEventListener('keydown', _bbKeyListener); _bbKeyListener = null }
        const mapName = (globalState.gMap as any)?.name ?? '?'
        const lim = (window as any).scrollLimits
        if (lim) console.log('[blackBar] SAVE → ' + mapName + ': ' + JSON.stringify(lim))
        console.log('[blackBar] OFF — bars solid black, clamp active')
        return
    }

    // Seed window.scrollLimits from the current auto bounds so edits are relative
    if (!(window as any).scrollLimits) {
        const b = objectContentBounds
        if (b) {
            ;(window as any).scrollLimits = { minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY }
        } else {
            ;(window as any).scrollLimits = { ...getActiveScrollLimits() }
        }
    }

    ;(window as any).borderDebug = true   // grey overlay + free scroll
    ;(window as any)._bbSide = side

    // Remove any previous listener before adding a new one
    if (_bbKeyListener) document.removeEventListener('keydown', _bbKeyListener)

    _bbKeyListener = function (e: KeyboardEvent) {
        if (e.code !== 'PageUp' && e.code !== 'PageDown') return
        e.preventDefault()
        const step = e.shiftKey ? 5 : BB_STEP
        const out = e.code === 'PageUp'  // true = more visible = bar moves outward
        const lim = (window as any).scrollLimits
        const s = (window as any)._bbSide
        if (s === 'W') lim.minX += out ? -step : +step
        if (s === 'E') lim.maxX += out ? +step : -step
        if (s === 'N') lim.minY += out ? -step : +step
        if (s === 'S') lim.maxY += out ? +step : -step
        // Keep overlay source in sync (objectContentBounds is immutable; scroll limits override it)
        const mapName = (globalState.gMap as any)?.name ?? '?'
    console.log('[blackBar] ' + mapName + ' ' + s + ' → ' + JSON.stringify(lim))
    }
    document.addEventListener('keydown', _bbKeyListener)

    console.log('[blackBar] editing ' + side + ' bar  |  PageUp=more  PageDown=less  Shift=fine  |  blackBar() to exit')
    console.log('[blackBar] current = ' + JSON.stringify((window as any).scrollLimits))
}

;(window as any).borderSave = function () {
    const mapName = (globalState.gMap as any)?.name ?? '?'
    const lim = (window as any).scrollLimits ?? objectContentBounds
    console.log(mapName + ': ' + JSON.stringify(lim))
    return lim
}

;(window as any).clearBorder = function () {
    delete (window as any).scrollLimits
    ;(window as any).borderDebug = false
    ;(window as any)._bbSide = null
    if (_bbKeyListener) { document.removeEventListener('keydown', _bbKeyListener); _bbKeyListener = null }
    console.log('[border] cleared — auto object-bbox bounds restored')
}

// Keep the old name as an alias so renderer.ts re-exports work unchanged.
export const MAP_WORLD_BOUNDS = CE_CENTER_BOUNDS

export function clampCameraPosition(): void {
    // Calibration mode (borderCalib()): let the camera scroll freely so each
    // edge can be reached and grabbed without half-set bounds locking scroll.
    if ((window as any).borderDebug) return

    const viewW = getWorldViewWidth()
    const viewH = getWorldViewHeight()
    const halfW = viewW / 2
    const halfH = viewH / 2

    const prevX = globalState.cameraPosition.x
    const prevY = globalState.cameraPosition.y
    // The viewport centre we want to constrain (camera top-left + half view).
    const prevCX = prevX + halfW
    const prevCY = prevY + halfH

    // Clamp the viewport CENTRE to the active per-map bounds (window.scrollLimits
    // override → _activeLimits table → CE_CENTER_BOUNDS). Same source the black
    // bars use (getActiveScrollBarBounds), so scroll limit and bars stay in sync.
    const lim = getActiveScrollLimits()
    let nextCX = Math.max(lim.minX, Math.min(lim.maxX, prevCX))
    let nextCY = Math.max(lim.minY, Math.min(lim.maxY, prevCY))

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
