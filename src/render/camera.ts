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
// CE calls tileFromScreenXY(-320,-240,0) and tileFromScreenXY(-320,620,0)
// with the map centre as reference to derive gTileBorderMinX/MaxX/MinY/MaxY.
// Working through that arithmetic for a 200×200 grid gives valid centre-tile
// hex ranges (in DH2 coordinates): hex_x ∈ [45,153], hex_y ∈ [44,155].
//
// Converting those boundary hexes to world-space (hexToScreen):
//   minX = hexToScreen(153, 44).x = 1840   (large x → small world X)
//   maxX = hexToScreen(45,  155).x = 6208   (small x → large world X)
//   minY = hexToScreen(45,  44).y  = 803
//   maxY = hexToScreen(153, 155).y = 2783
//
// These are the bounds for the VIEWPORT CENTRE, not the camera top-left.
// The camera top-left bounds are derived per-frame by subtracting half the
// current world-view size.
export const CE_CENTER_BOUNDS = {
    minX: hexToScreen(153, 44).x,   // 1840
    maxX: hexToScreen(45, 155).x,   // 6208
    minY: hexToScreen(45, 44).y,    // 803
    maxY: hexToScreen(153, 155).y,  // 2783
}

// Keep the old name as an alias so renderer.ts re-exports work unchanged.
export const MAP_WORLD_BOUNDS = CE_CENTER_BOUNDS

export function clampCameraPosition(): void {
    const viewW = getWorldViewWidth()
    const viewH = getWorldViewHeight()
    const halfW = viewW / 2
    const halfH = viewH / 2

    // Clamp the viewport CENTRE to the CE-faithful scrollable region, then
    // back-convert to camera top-left. This matches CE tileSetCenter() which
    // rejects scrolls where tile_x/tile_y fall outside the precomputed borders.
    const prevX = globalState.cameraPosition.x
    const prevY = globalState.cameraPosition.y
    let nextX = Math.max(CE_CENTER_BOUNDS.minX - halfW, Math.min(CE_CENTER_BOUNDS.maxX - halfW, prevX))
    let nextY = Math.max(CE_CENTER_BOUNDS.minY - halfH, Math.min(CE_CENTER_BOUNDS.maxY - halfH, prevY))

    // CE ref: object.cc:2559 _obj_scroll_blocking_at — misc PID 0x500000C
    // (type=5, pidID=12) flags a tile as a scroll blocker. Reject the move
    // when the proposed viewport centre sits on such a tile.
    const centerHex = hexFromScreen(nextX + halfW, nextY + halfH)
    const gMap = globalState.gMap
    if (gMap) {
        const blocked = gMap.objectsAtPosition(centerHex).some((o: Obj) =>
            (o as any).type === 'misc' && (o as any).pidID === 12)
        if (blocked) {
            nextX = prevX
            nextY = prevY
        }
    }
    globalState.cameraPosition.x = nextX
    globalState.cameraPosition.y = nextY
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
