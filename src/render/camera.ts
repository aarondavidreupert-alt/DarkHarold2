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

import { hexFromScreen, hexNeighbors, hexToScreen, Point } from '../geometry.js'
import globalState from '../globalState.js'
import { Obj } from '../object.js'
import { Config } from '../config.js'
import { tileToScreen, TILE_WIDTH, TILE_HEIGHT } from '../tile.js'
import { dbg } from '../logger.js'

// Sprite half-extents added to each object's screen position so the bbox
// covers the full art footprint, not just the anchor point.
const OBJ_HALF_W = 48
const OBJ_HALF_H = 36

// CE ref: object.cc:2559 _obj_scroll_blocking_at — misc PID 0x500000C
// (type='misc', pidID=12) marks a tile as a scroll blocker. In CE these form
// a ring around the playable area; their bbox is the per-map border.
const SCROLL_BLOCKER_TYPE  = 'misc'
const SCROLL_BLOCKER_PIDID = 12

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
    // Auto interior-floor-bbox handles all maps now.
    // Add an entry here only if a specific map's auto result feels wrong.
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
// scrollBlockerBounds is the camera CENTRE clamp; bars sit one reference
// half-viewport (320×190) outward from that ring — matching where the
// original 640×380 viewport edge would be at the scroll limit.
// Precedence:
//   1. window.scrollLimits  — live blackBar() editor (already edge bounds)
//   2. MAP_BAR_BOUNDS entry — hand-calibrated edge bounds for this map
//   3. scrollBlockerBounds expanded by (290, 172) — CE-authoritative ring
//   4. mapContentBounds     — interior floor bbox fallback
//   5. null                 — no data; overlay skips drawing
export function getActiveScrollBarBounds(): typeof CE_CENTER_BOUNDS | null {
    if ((window as any).scrollLimits) return (window as any).scrollLimits
    if (_activeBarBounds) return _activeBarBounds
    if (Config.ui.scrollBounds === 'ce') {
        // the ring the player is in, a CE view half (320×190) out: where the original
        // 640×380 view's edge is when its centre stands on the ring
        const ring = scrollRingBounds()
        if (ring) {
            return {
                minX: ring.minX - ORIGINAL_ISO_WINDOW_WIDTH / 2, maxX: ring.maxX + ORIGINAL_ISO_WINDOW_WIDTH / 2,
                minY: ring.minY - ORIGINAL_ISO_WINDOW_HEIGHT / 2, maxY: ring.maxY + ORIGINAL_ISO_WINDOW_HEIGHT / 2,
            }
        }
        return mapContentBounds ?? null
    }
    if (scrollBlockerBounds) {
        const refHalfX = 290  // empirical: blocker ring sits ~290px inside the bar edge
        const refHalfY = 172  // empirical: blocker ring sits ~172px inside the bar edge
        // Skip if the blocker ring is anomalously wide (multi-district city maps
        // like ncr1 where blockers span the whole grid — bbox would be off-screen).
        const w = scrollBlockerBounds.maxX - scrollBlockerBounds.minX
        const h = scrollBlockerBounds.maxY - scrollBlockerBounds.minY
        if (w < 3500 && h < 2500) {
            return {
                minX: scrollBlockerBounds.minX - refHalfX,
                maxX: scrollBlockerBounds.maxX + refHalfX,
                minY: scrollBlockerBounds.minY - refHalfY,
                maxY: scrollBlockerBounds.maxY + refHalfY,
            }
        }
    }
    return mapContentBounds ?? null
}

// Returns the viewport-CENTRE clamp bounds.
// Precedence:
//   1. window.scrollLimits inset by 320×190  — live editor
//   2. MAP_BAR_BOUNDS inset by 320×190       — hand-calibrated
//   3. scrollBlockerBounds                   — CE-authoritative (already centre bounds)
//   4. mapContentBounds inset by 320×190     — floor bbox fallback
//   5. CE_CENTER_BOUNDS                      — full grid
export function getActiveScrollLimits(): typeof CE_CENTER_BOUNDS {
    const inX = ORIGINAL_ISO_WINDOW_WIDTH  / 2  // 320
    const inY = ORIGINAL_ISO_WINDOW_HEIGHT / 2  // 190
    if ((window as any).scrollLimits) {
        const b = (window as any).scrollLimits
        return { minX: b.minX + inX, maxX: b.maxX - inX, minY: b.minY + inY, maxY: b.maxY - inY }
    }
    if (_activeBarBounds) {
        const b = _activeBarBounds
        return { minX: b.minX + inX, maxX: b.maxX - inX, minY: b.minY + inY, maxY: b.maxY - inY }
    }
    if (scrollBlockerBounds) {
        const w = scrollBlockerBounds.maxX - scrollBlockerBounds.minX
        const h = scrollBlockerBounds.maxY - scrollBlockerBounds.minY
        if (w < 3500 && h < 2500) return scrollBlockerBounds
    }
    if (mapContentBounds) {
        const b = mapContentBounds
        return { minX: b.minX + inX, maxX: b.maxX - inX, minY: b.minY + inY, maxY: b.maxY - inY }
    }
    return CE_CENTER_BOUNDS
}

// CE-authoritative per-map border: world-space bbox of scroll blocker objects
// (type='misc', pidID=12). These form a ring around the playable area placed
// by map designers — their bbox is the exact per-map playfield boundary.
// CE ref: object.cc _obj_scroll_blocking_at, tile.cc tileSetCenter scroll check.
export let scrollBlockerBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null

// World-space bounding box of the placed objects on the current map/elevation.
export let objectContentBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null

// Floor-tile bbox (non-grid000, non-edg*, inset) — fallback when no scroll blockers.
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
    dbg('map', '[scroll] objectContentBounds =', JSON.stringify(objectContentBounds),
        objects.length + ' objects')
}

// Interior inset applied to the raw non-edg floor bbox to arrive at bar bounds.
// Empirically validated against 5 hand-calibrated maps: X diff ≈ ±129px,
// Y-top diff ≈ 55px. A single fixed pad of 130/60 produces results within
// ~60px of manual calibration on every tested map.
const INTERIOR_INSET_X = 130
const INTERIOR_INSET_Y = 60

// Compute the world-space bbox of scroll blocker objects (type='misc', pidID=12).
// These are placed by map designers as an invisible ring at the playable boundary.
// Called from GameMap.changeElevation alongside computeObjectContentBounds.
export function computeScrollBlockerBounds(objects: Obj[]): void {
    if (!objects || objects.length === 0) {
        scrollBlockerBounds = null
        ;(window as any).scrollBlockerBounds = null
        return
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    let count = 0
    for (const obj of objects) {
        if ((obj as any).type !== SCROLL_BLOCKER_TYPE || (obj as any).pidID !== SCROLL_BLOCKER_PIDID) continue
        const pos = (obj as any).position
        if (!pos || pos.x == null || pos.y == null) continue
        count++
        const p = hexToScreen(pos.x, pos.y)
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
    }
    scrollBlockerBounds = (count === 0) ? null : { minX, maxX, minY, maxY }
    ;(window as any).scrollBlockerBounds = scrollBlockerBounds
    dbg('map', '[scroll] scrollBlockerBounds =', JSON.stringify(scrollBlockerBounds), count + ' blockers')

    // [dh2] scroll_bounds=ce: the blocker hexes (clampCameraCE) and their groups
    // (blockers within 2 hexes of each other), for the black border around the ring
    // the player is in (scrollRingBounds). A map can hold several groups: newrst has
    // its ring plus a second, outside one.
    _blockerHexes = new Set()
    for (const obj of objects) {
        if ((obj as any).type !== SCROLL_BLOCKER_TYPE || (obj as any).pidID !== SCROLL_BLOCKER_PIDID) continue
        const pos = (obj as any).position
        if (pos && pos.x != null && pos.y != null) _blockerHexes.add(pos.x + pos.y * 200)
    }
    _blockerGroups = []
    const seen = new Set<number>()
    for (const start of _blockerHexes) {
        if (seen.has(start)) continue
        seen.add(start)
        const g = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
        const stack = [start]
        while (stack.length) {
            const k = stack.pop() as number
            const hx = k % 200, hy = (k / 200) | 0
            const p = hexToScreen(hx, hy)
            g.minX = Math.min(g.minX, p.x); g.maxX = Math.max(g.maxX, p.x)
            g.minY = Math.min(g.minY, p.y); g.maxY = Math.max(g.maxY, p.y)
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    const nx = hx + dx, ny = hy + dy
                    if (nx < 0 || nx >= 200 || ny < 0 || ny >= 200) continue
                    const n = nx + ny * 200
                    if (_blockerHexes.has(n) && !seen.has(n)) { seen.add(n); stack.push(n) }
                }
            }
        }
        _blockerGroups.push(g)
    }

    // The areas the view centre can reach: the free hexes split by the blockers
    // (hex neighbours), each with the bbox of its hex centres. An area touching the
    // grid's edge is open (no closed ring around it).
    _hexArea = new Int32Array(40000).fill(-1)
    _areas = []
    if (_blockerHexes.size > 0) {
        for (let start = 0; start < 40000; start++) {
            if (_hexArea[start] !== -1 || _blockerHexes.has(start)) continue
            const id = _areas.length
            const a = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, open: false }
            _hexArea[start] = id
            const stack = [start]
            while (stack.length) {
                const k = stack.pop() as number
                const hx = k % 200, hy = (k / 200) | 0
                if (hx === 0 || hx === 199 || hy === 0 || hy === 199) a.open = true
                const p = hexToScreen(hx, hy)
                a.minX = Math.min(a.minX, p.x); a.maxX = Math.max(a.maxX, p.x)
                a.minY = Math.min(a.minY, p.y); a.maxY = Math.max(a.maxY, p.y)
                for (const n of hexNeighbors({ x: hx, y: hy })) {
                    if (n.x < 0 || n.x >= 200 || n.y < 0 || n.y >= 200) continue
                    const nk = n.x + n.y * 200
                    if (_hexArea[nk] === -1 && !_blockerHexes.has(nk)) { _hexArea[nk] = id; stack.push(nk) }
                }
            }
            _areas.push(a)
        }
    }
    _ceCentre = null // the next centerCamera (elevation change, map load) sets it
    _ringBounds = undefined // chosen again for this elevation (scrollRingBounds)
    _walkBounds = undefined
    // exit grids (misc pid 0x5000010-0x5000017) by destination, for walkBorderBounds
    _exitGroups = new Map()
    for (const obj of objects) {
        const pid = (obj as any).pid as number
        if ((obj as any).type !== 'misc' || pid < 0x5000010 || pid > 0x5000017 || !(obj as any).position) continue
        const ex = (obj as any).extra ?? {}
        const key = `${ex.exitMapID}/${ex.startingPosition}/${ex.startingElevation}`
        if (!_exitGroups.has(key)) _exitGroups.set(key, [])
        _exitGroups.get(key)!.push(hexToScreen((obj as any).position.x, (obj as any).position.y))
    }
}

let _exitGroups: Map<string, Point[]> = new Map()
let _walkBounds: typeof CE_CENTER_BOUNDS | null | undefined = undefined

// [dh2] walk_limit=1: where critters may walk (map/pathfinder.ts) — the black border
// (getActiveScrollBarBounds), widened over any exit grid that has no hex inside it, so
// every exit stays reachable (ncr2's exit to map 42 and one of redwan1's lie outside).
// Fixed per elevation, as the border is.
export function walkBorderBounds(): typeof CE_CENTER_BOUNDS | null {
    const bar = getActiveScrollBarBounds() // may choose the ring again (resets _walkBounds)
    if (_walkBounds !== undefined) return _walkBounds
    if (!bar) return null
    const b = { ...bar }
    const inside = (p: Point) => p.x >= bar.minX && p.x <= bar.maxX && p.y >= bar.minY && p.y <= bar.maxY
    for (const hexes of _exitGroups.values()) {
        if (hexes.some(inside)) continue
        for (const p of hexes) {
            b.minX = Math.min(b.minX, p.x - 16); b.maxX = Math.max(b.maxX, p.x + 16)
            b.minY = Math.min(b.minY, p.y - 12); b.maxY = Math.max(b.maxY, p.y + 12)
        }
    }
    // a live blackBar() edit changes the border: don't keep it
    if (!(window as any).scrollLimits && !(window as any).borderDebug) _walkBounds = b
    return b
}

// Blocker hexes (x + y*200) and blocker groups' world bboxes on this elevation.
let _blockerHexes: Set<number> = new Set()
let _blockerGroups: { minX: number; maxX: number; minY: number; maxY: number }[] = []
// The reachable areas (computeScrollBlockerBounds): area index per hex (-1 = blocker
// or no blockers on this elevation) and each area's hex-centre bbox.
let _hexArea: Int32Array = new Int32Array(0)
let _areas: { minX: number; maxX: number; minY: number; maxY: number; open: boolean }[] = []

// [dh2] scroll_bounds=ce: where the view centre can go. The hex centres of the area
// the player stands in, when a ring closes it (CE's centre tile can be any of them,
// and the original view reaches 320×190 px past it — getActiveScrollBarBounds);
// else the bbox of the blocker groups around the player (whose bbox holds the
// player), else of all of them; null without blockers.
// Chosen once per elevation, on the first call after computeScrollBlockerBounds (the
// centerCamera on the player that follows it), so the border stays where it is while
// the player walks — blockers don't block walking, and a blocker hex is in no area.
// undefined = not chosen yet.
// Chosen again only when the player stands inside another closed area (an exit grid or
// script put them there): not on a blocker hex or in the open area outside the ring.
let _ringBounds: typeof CE_CENTER_BOUNDS | null | undefined = undefined
let _ringArea: (typeof _areas)[number] | null = null

export function scrollRingBounds(): typeof CE_CENTER_BOUNDS | null {
    const pl = globalState.player
    if (_ringBounds !== undefined && pl && pl.position && _hexArea.length === 40000) {
        const id = _hexArea[pl.position.x + pl.position.y * 200]
        if (id >= 0 && !_areas[id].open && _areas[id] !== _ringArea) _ringBounds = undefined
    }
    if (_ringBounds === undefined) {
        _ringBounds = chooseRingBounds()
        _walkBounds = undefined
    }
    return _ringBounds
}

// The closed area at or next to `pos` (a blocker hex: its neighbours, up to 3 hexes out).
function closedAreaNear(pos: Point): (typeof _areas)[number] | null {
    let ring: Point[] = [pos]
    const seen = new Set<number>([pos.x + pos.y * 200])
    for (let r = 0; r <= 3; r++) {
        for (const h of ring) {
            const id = _hexArea[h.x + h.y * 200]
            if (id >= 0 && !_areas[id].open) return _areas[id]
        }
        const next: Point[] = []
        for (const h of ring) {
            for (const n of hexNeighbors(h)) {
                const k = n.x + n.y * 200
                if (n.x < 0 || n.x >= 200 || n.y < 0 || n.y >= 200 || seen.has(k)) continue
                seen.add(k)
                next.push(n)
            }
        }
        ring = next
    }
    return null
}

function chooseRingBounds(): typeof CE_CENTER_BOUNDS | null {
    _ringArea = null
    if (_blockerGroups.length === 0) return null
    const pl = globalState.player
    if (pl && pl.position && _hexArea.length === 40000) {
        const a = closedAreaNear(pl.position)
        if (a) {
            _ringArea = a
            return { minX: a.minX, maxX: a.maxX, minY: a.minY, maxY: a.maxY }
        }
    }
    const p = globalState.player
    let groups = _blockerGroups
    if (p && p.position) {
        const s = hexToScreen(p.position.x, p.position.y)
        const around = _blockerGroups.filter(g => s.x >= g.minX && s.x <= g.maxX && s.y >= g.minY && s.y <= g.maxY)
        if (around.length) groups = around
    }
    return {
        minX: Math.min(...groups.map(g => g.minX)), maxX: Math.max(...groups.map(g => g.maxX)),
        minY: Math.min(...groups.map(g => g.minY)), maxY: Math.max(...groups.map(g => g.maxY)),
    }
}

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
    const mapName = (globalState.gMap as any)?.name?.toLowerCase() ?? '?'
    ;(window as any).mapContentBounds = mapContentBounds
        ? { map: mapName, ...mapContentBounds }
        : null
    dbg('map', '[scroll] interiorFloorBounds =', JSON.stringify(mapContentBounds))
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

// CE ref: tile.cc tileSetCenter — the scroll restrictions. Called after every
// camera move (edge scroll, keys, zoom). [dh2] scroll_bounds=ce (default) ports
// CE's two automatic limits (clampCameraCE); =dh2 is the older DH2 clamp to a
// rectangle guessed from the blocker / floor bounding boxes (clampCameraDH2).
export function clampCameraPosition(): void {
    // Calibration mode (borderCalib()): let the camera scroll freely so each
    // edge can be reached and grabbed without half-set bounds locking scroll.
    if ((window as any).borderDebug) return
    if (Config.ui.scrollBounds === 'ce') clampCameraCE(false)
    else clampCameraDH2()
}

// CE's player limit (tile.cc tileSetCenter, gTileScrollLimitingEnabled): a step
// that moves the centre further from the player is refused once it would be
// 480 px (x) or 400 px (y) away from them.
const CE_SCROLL_LIMIT_X = 480
const CE_SCROLL_LIMIT_Y = 400
// Sample distance when walking the centre from its last position to the new one,
// in world px: less than a hex, so the two-hex-thick blocker ring can't be skipped.
const CE_SCROLL_SAMPLE = 8

// The last centre clampCameraCE accepted (world px); null until the first
// centerCamera of a map.
let _ceCentre: Point | null = null

function playerLimitRefuses(fromX: number, fromY: number, toX: number, toY: number): boolean {
    // [dh2] scroll_player_limit=0 / console setScrollPlayerLimit(false): off
    if (!Config.ui.scrollPlayerLimit) return false
    const p = globalState.player
    if (!p || !p.position) return false
    // CE compares the two tiles' tileToScreenXY points; hexToScreen is the hex's
    // centre, as the view centre is
    const d = hexToScreen(p.position.x, p.position.y)
    const dx = Math.abs(d.x - toX)
    const dy = Math.abs(d.y - toY)
    if (dx > Math.abs(d.x - fromX) || dy > Math.abs(d.y - fromY)) {
        return dx >= CE_SCROLL_LIMIT_X || dy >= CE_SCROLL_LIMIT_Y
    }
    return false
}

// CE ref: object.cc _obj_scroll_blocking_at — the centre hex holds a scroll blocker.
function blockerAtCentre(cx: number, cy: number): boolean {
    if (_blockerHexes.size === 0) return false
    const h = hexFromScreen(cx, cy)
    const tile = h.x + h.y * 200
    if (tile <= 0 || tile >= 40000) return false // CE excludes tile 0 (and off-grid tiles)
    return _blockerHexes.has(tile)
}

// [dh2] scroll_bounds=ce. CE refuses each scroll step whose new centre tile holds
// a scroll blocker (the ring mappers placed around the playfield) or that takes
// the centre too far from the player, then keeps the grid border. DH2 moves the
// camera by less than CE's 32×24 px steps, so the move from the last accepted
// centre is walked in CE_SCROLL_SAMPLE steps, x first, then y: a refused axis
// stops there and the other still moves (CE refuses a diagonal step whole; here
// the view slides along the ring). ignoreRestrictions: centring on the player or
// a script's tile_set_center / move_to (CE turns the checks off around move_to
// and on map load) — only the grid border applies.
function clampCameraCE(ignoreRestrictions: boolean): void {
    const halfW = getWorldViewWidth() / 2
    const halfH = getWorldViewHeight() / 2
    let cx = globalState.cameraPosition.x + halfW
    let cy = globalState.cameraPosition.y + halfH

    if (!ignoreRestrictions && _ceCentre) {
        const tx = cx, ty = cy
        cx = _ceCentre.x
        cy = _ceCentre.y
        for (const axis of ['x', 'y'] as const) {
            const target = axis === 'x' ? tx : ty
            for (;;) {
                const cur = axis === 'x' ? cx : cy
                const left = target - cur
                if (left === 0) break
                const step = Math.sign(left) * Math.min(Math.abs(left), CE_SCROLL_SAMPLE)
                const nx = axis === 'x' ? cx + step : cx
                const ny = axis === 'y' ? cy + step : cy
                if (blockerAtCentre(nx, ny) || playerLimitRefuses(cx, cy, nx, ny)) break
                cx = nx
                cy = ny
            }
        }
    }

    // CE tileSetBorder: the grid border, whatever the restrictions
    cx = Math.max(CE_CENTER_BOUNDS.minX, Math.min(CE_CENTER_BOUNDS.maxX, cx))
    cy = Math.max(CE_CENTER_BOUNDS.minY, Math.min(CE_CENTER_BOUNDS.maxY, cy))
    // [dh2] scroll_limit=1: never past the black border (RD19)
    if (Config.ui.scrollLimitToBorder) {
        const bar = getActiveScrollBarBounds()
        if (bar) {
            cx = Math.max(bar.minX, Math.min(bar.maxX, cx))
            cy = Math.max(bar.minY, Math.min(bar.maxY, cy))
        }
    }
    _ceCentre = { x: cx, y: cy }
    globalState.cameraPosition.x = cx - halfW
    globalState.cameraPosition.y = cy - halfH
}

// [dh2] scroll_bounds=dh2: the older clamp to a rectangle (getActiveScrollLimits).
function clampCameraDH2(): void {
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
    // The blocker rejection above keeps the pre-clamp centre, which can already be
    // past the limits (the clamp target sits on the blocker ring, e.g. arvillag), so
    // each scroll step went further out. [dh2] scroll_limit=1 (default): the centre
    // never passes the black border (getActiveScrollBarBounds), so the border
    // reaches the middle of the screen at most.
    if (Config.ui.scrollLimitToBorder) {
        const bar = getActiveScrollBarBounds() ?? lim
        nextCX = Math.max(bar.minX, Math.min(bar.maxX, nextCX))
        nextCY = Math.max(bar.minY, Math.min(bar.maxY, nextCY))
    }
    globalState.cameraPosition.x = nextCX - halfW
    globalState.cameraPosition.y = nextCY - halfH
}

// CE gCenterTile: the hex at the centre of the view
export function getCenterTile(): Point {
    return hexFromScreen(globalState.cameraPosition.x + getWorldViewWidth() / 2, globalState.cameraPosition.y + getWorldViewHeight() / 2)
}

export function centerCamera(around: Point) {
    const scr = hexToScreen(around.x, around.y)
    // The visible world region shrinks as zoom grows, so divide by zoom
    // when offsetting from the target to the top-left camera anchor.
    const viewW = getWorldViewWidth()
    const viewH = getWorldViewHeight()
    globalState.cameraPosition.x = (scr.x - viewW / 2) | 0
    globalState.cameraPosition.y = (scr.y - viewH / 2) | 0
    if (Config.ui.scrollBounds === 'ce' && !(window as any).borderDebug) clampCameraCE(true)
    else clampCameraPosition()
}

// CE tile.cc _tile_scroll_to(tile, 2): the centre walks toward the tile and stops at the
// first centre tileSetCenter refuses (a scroll blocker, the player limit) — the checks stay
// on, unlike centerCamera (CE turns them off only for move_to and a map load)
export function tileScrollTo(around: Point): void {
    const scr = hexToScreen(around.x, around.y)
    globalState.cameraPosition.x = (scr.x - getWorldViewWidth() / 2) | 0
    globalState.cameraPosition.y = (scr.y - getWorldViewHeight() / 2) | 0
    clampCameraPosition()
}

// CE map.cc mapScroll(dx, dy): the view moves a whole step — 32 px across, 24 px down — and
// at most every 33 ms ([dh2] scroll_mode=ce for edge / arrow scrolling, mouse_wheel=ce).
let lastMapScroll = 0
export function ceMapScroll(dx: number, dy: number): boolean {
    if (dx === 0 && dy === 0) return false
    const now = performance.now()
    if (now - lastMapScroll < 33) return false
    lastMapScroll = now
    globalState.cameraPosition.x += dx * 32
    globalState.cameraPosition.y += dy * 24
    clampCameraPosition()
    return true
}
