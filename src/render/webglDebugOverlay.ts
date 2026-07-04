// Light Source Debug Overlay — a persistent, camera-aware 2D overlay that
// draws every active light source on the current map on the `textCtx` overlay.
// Toggle from the browser console with `showLightSources(true/false)`; choose
// how the radius is visualised with `setLightOverlayMode(...)`; calibrate the
// ellipse size with `setLightOverlayRadius(scale)`.
//
// Why this exists: we iterate on object lighting modes (setObjectLightingMode)
// and light propagation modes (setLightPropagationMode). To tell whether a
// stripe/gradient on a wall is a sampling bug, a propagation bug, or correct
// CE behaviour, we need to see where the light sources actually are in world
// space — their tile centre, their radius, their intensity. This overlay reads
// `obj.lightRadius` / `obj.lightIntensity` directly (NOT the baked
// `tile_intensity` array), so it is independent of both mode switches and
// stays anchored to tiles as the camera moves.
//
// Light sources have no Z height in CE (the elevation check in object.cc is a
// commented-out stub; lightmap.ts confirms this). They live purely on the hex
// tile grid, so the drawing is anchored to the tile's hex screen position, not
// to any sprite bounding box.

import globalState from '../globalState.js'
import { Obj } from '../object.js'
import { getZoom } from '../renderer.js'
import { worldToScreen } from './camera.js'
import { hexToScreen, hexesInRadius } from '../geometry.js'
import { TILE_WIDTH, TILE_HEIGHT } from '../tile.js'
import { WebGLRenderer } from './webglContext.js'

declare module './webglContext.js' {
    interface WebGLRenderer {
        drawLightSourceOverlay(): void
    }
}

// How the light radius is visualised around each source:
//   'ellipse' — (default) a dashed ellipse. A circle of hex-distance N on the
//               ground projects to an ellipse under the isometric camera, so
//               the ring is squashed vertically by the floor-tile aspect ratio
//               (TILE_HEIGHT / TILE_WIDTH) with its axes aligned to the tile
//               diamond's width/height.
//   'tiles'   — fill every hex within lightRadius (hex distance, occlusion
//               ignored) as a translucent floor rhombus, exactly like the
//               'beta' egg overlay. Shows the discrete tile coverage.
//   'none'    — no radius shape at all: just the centre point + its data.
export type LightOverlayMode = 'ellipse' | 'tiles' | 'none'

// One hex tile is a 32×16 (world-px) cell — the same dimensions the beta egg
// overlay uses to draw a floor hex (renderer.ts). We use the 32px width as the
// per-tile radius estimate: a light of `lightRadius` hexes gets a horizontal
// semi-axis of `lightRadius * 32` world px. This is a first-order estimate of
// the radial world-space falloff — `setLightOverlayRadius(scale)` exists
// precisely to calibrate it against where the floor visibly goes dark.
const HEX_TILE_SCREEN_WIDTH = 32
const HEX_CELL_W = 32 // world-px width of a floor hex cell (for 'tiles' fill)
const HEX_CELL_H = 16 // world-px height of a floor hex cell

// Overlay state — module-level so it survives lighting-mode switches
// (setLightPropagationMode / setObjectLightingMode never touch it).
let overlayActive = false
let overlayMode: LightOverlayMode = 'ellipse'
let radiusScale = 1.0

/** Console command hook — `showLightSources(true/false)`. */
export function setLightSourceOverlayActive(on: boolean): void {
    overlayActive = !!on
}

/** Console command hook — `setLightOverlayMode('ellipse'|'tiles'|'none')`. */
export function setLightOverlayMode(mode: LightOverlayMode): void {
    overlayMode = mode
}

/** Console command hook — `setLightOverlayRadius(scale)`, defaults to 1.0. */
export function setLightOverlayRadiusScale(scale: number): void {
    // Guard against NaN / non-positive: fall back to 1.0 so the ellipse never
    // vanishes or inverts.
    radiusScale = Number.isFinite(scale) && scale > 0 ? scale : 1.0
}

export function isLightSourceOverlayActive(): boolean {
    return overlayActive
}

// Colour-code the centre dot by object kind so a glance tells you what is
// emitting: white = player, orange = critter, yellow = item/scenery/other.
function dotColorFor(obj: Obj): string {
    if (obj === globalState.player) return '#FFFFFF'
    if (obj.type === 'critter') return '#FF8800'
    return '#FFFF44'
}

// Translucent fill for the 'tiles' mode, matching the dot colour so overlapping
// sources stay distinguishable.
function tileFillColorFor(obj: Obj): string {
    if (obj === globalState.player) return 'rgba(255, 255, 255, 0.15)'
    if (obj.type === 'critter') return 'rgba(255, 136, 0, 0.15)'
    return 'rgba(255, 255, 68, 0.15)'
}

function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + '…' : s
}

// Fill the hexes within `radius` of `centre` as translucent floor rhombi,
// matching the 'beta' egg overlay geometry (renderer.ts): a 32×16 world-px
// diamond per hex, projected through worldToScreen.
function drawTileFill(ctx: CanvasRenderingContext2D, centre: Obj, z: number): void {
    ctx.fillStyle = tileFillColorFor(centre)
    const w = HEX_CELL_W * z
    const h = HEX_CELL_H * z
    for (const pos of hexesInRadius(centre.position, centre.lightRadius)) {
        const scr = hexToScreen(pos.x, pos.y)
        const s = worldToScreen(scr.x - 16, scr.y - 12)
        ctx.beginPath()
        ctx.moveTo(s.x + w / 2, s.y)         // top
        ctx.lineTo(s.x + w, s.y + h / 2)     // right
        ctx.lineTo(s.x + w / 2, s.y + h)     // bottom
        ctx.lineTo(s.x, s.y + h / 2)         // left
        ctx.closePath()
        ctx.fill()
    }
}

// Drawn at the END of the render loop (after clear() and after all game
// objects), so it sits on top. `this.textCtx` is already DPR-scaled in
// webglContext.ts init(), so everything here is in logical CSS pixels, exactly
// like renderText().
WebGLRenderer.prototype.drawLightSourceOverlay = function (): void {
    if (!overlayActive) return

    const gm = globalState.gMap
    if (!gm) return
    // getObjects() defaults to the current elevation — sources on other floors
    // are correctly excluded.
    const objects = gm.getObjects()
    if (!objects || objects.length === 0) return

    const ctx = this.textCtx
    const z = getZoom()

    ctx.save()
    ctx.font = '12px "VT323", monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'

    for (const obj of objects) {
        // Same guard as lightmap.ts obj_adjust_light(): a light source is any
        // object with lightRadius > 0 && lightIntensity > 655 (655 is the DH2
        // ambient baseline).
        if (obj.lightRadius <= 0 || obj.lightIntensity <= 655) continue

        // Objects live on the HEX grid, so project through the same
        // hexToScreen -> worldToScreen path the renderer uses for sprites
        // (renderer.ts objectRenderInfo / egg overlay). tileToScreen is the
        // square floor-tile transform and would misplace every dot.
        const scr = hexToScreen(obj.position.x, obj.position.y)
        // Hex-cell centre in world space: the 32×16 cell's top-left is
        // (scr.x - 16, scr.y - 12), so its centre is (scr.x, scr.y - 4).
        const c = worldToScreen(scr.x, scr.y - 4)

        // --- Radius visualisation (behind the dot) ---
        if (overlayMode === 'tiles') {
            drawTileFill(ctx, obj, z)
        } else if (overlayMode === 'ellipse') {
            // A ground circle projects to an ellipse: horizontal semi-axis is
            // the calibrated radius; the vertical semi-axis is squashed by the
            // floor-tile aspect ratio so the axes line up with the tile
            // diamond's outer borders.
            const rx = obj.lightRadius * HEX_TILE_SCREEN_WIDTH * z * radiusScale
            const ry = rx * (TILE_HEIGHT / TILE_WIDTH)
            ctx.beginPath()
            ctx.setLineDash([4, 4])
            ctx.strokeStyle = 'rgba(255, 220, 120, 0.7)'
            ctx.lineWidth = 1
            ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2)
            ctx.stroke()
            ctx.setLineDash([])
        }
        // 'none' — draw nothing here; only the centre dot + label below.

        // --- Centre dot — ~4px filled circle, colour-coded by type ---
        ctx.beginPath()
        ctx.fillStyle = dotColorFor(obj)
        ctx.arc(c.x, c.y, 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'black'
        ctx.lineWidth = 1
        ctx.stroke()

        // --- Label — two lines directly below the dot. Black outline so the
        //     text stays readable over the floor, matching renderText() ---
        const line1 = `r=${obj.lightRadius} i=${obj.lightIntensity}`
        const nameOrArt = obj.name ? obj.name : obj.art
        const line2 = nameOrArt ? `${obj.type} ${truncate(nameOrArt, 20)}` : obj.type
        ctx.lineWidth = 2
        ctx.strokeStyle = 'black'
        ctx.fillStyle = '#FFFFFF'
        ctx.strokeText(line1, c.x, c.y + 16)
        ctx.fillText(line1, c.x, c.y + 16)
        ctx.strokeText(line2, c.x, c.y + 30)
        ctx.fillText(line2, c.x, c.y + 30)
    }

    ctx.restore()
}
