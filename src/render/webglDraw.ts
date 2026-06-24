import globalState from '../globalState.js'
import * as GameTime from '../gametime.js'
import { Obj } from '../object.js'
import { getZoom, SCREEN_HEIGHT, SCREEN_WIDTH, TileMap } from '../renderer.js'
import { tileToScreen, TILE_HEIGHT, TILE_WIDTH } from '../tile.js'
import { Config } from '../config.js'
import { Font } from '../formats/fon.js'
import { dbg } from '../logger.js'
import { WebGLRenderer } from './webglContext.js'
import { hexDistance } from '../geometry.js'
import { hexIsInFrontOf, hexIsToRightOf } from '../geometry/hexScreen.js'

declare module './webglContext.js' {
    interface WebGLRenderer {
        renderText(txt: string, x: number, y: number, align?: CanvasTextAlign, color?: string): void
        renderImage(imgPath: string, x: number, y: number, width: number, height: number): void
        renderFont(font: Font, x: number, y: number): void
        drawTileMap(tilemap: TileMap, offsetY: number): void
        renderRoof(roof: TileMap, hideSet?: Set<string> | null): void
        renderFloor(floor: TileMap): void
        renderObject(obj: Obj): void
        renderObjectOutlined(obj: Obj): void
        renderOutlinePass(objs: Obj[]): void
        renderFrame(
            imgPath: string,
            x: number,
            y: number,
            width: number,
            height: number,
            totalFrames: number,
            frame: number,
            lit?: boolean,
        ): void
        setRoofLighting(): void
    }
}

WebGLRenderer.prototype.renderText = function (
    txt: string,
    x: number,
    y: number,
    align: CanvasTextAlign = 'left',
    color?: string,
): void {
    const ctx = this.textCtx
    ctx.font = '16px "VT323", monospace'
    // Map common float-message palette names to CSS colors per CE:
    // white = normal damage, red = critter death, yellow = warnings.
    const colorMap: { [k: string]: string } = {
        white: '#FFFFFF', red: '#FF4444', yellow: '#FFFF44', green: '#00ff00',
    }
    ctx.fillStyle = color ? (colorMap[color] ?? color) : '#00ff00'
    ctx.textAlign = align
    ctx.strokeStyle = 'black'
    ctx.lineWidth = 2
    ctx.strokeText(txt, x, y)
    ctx.fillText(txt, x, y)
}

WebGLRenderer.prototype.drawTileMap = function (tilemap: TileMap, offsetY: number): void {
    const gl = this.gl
    this.gl.useProgram(this.tileShader)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tileBuffer)
    gl.uniform1f(this.uNumFramesLocation, 1)
    gl.uniform1f(this.uFrameLocation, 0)
    const z = getZoom()
    gl.uniform2f(this.uScaleLocation, 80 * z, 36 * z)

    // Roofs and fallback (unlit) floors are world geometry — react to
    // day/night + per-tile intensity like everything else on the map.
    this.setTileLighting(true)

    // Zoom-aware visible world bounds — zooming out shows more tiles.
    const viewW = SCREEN_WIDTH / z
    const viewH = SCREEN_HEIGHT / z

    for (let i = 0; i < tilemap.length; i++) {
        for (let j = 0; j < tilemap[0].length; j++) {
            const tile = tilemap[j][i]
            if (tile === 'grid000') {
                continue
            }
            const img = 'art/tiles/' + tile

            const scr = tileToScreen(i, j)
            scr.y += offsetY
            if (
                scr.x + TILE_WIDTH < globalState.cameraPosition.x ||
                scr.y + TILE_HEIGHT < globalState.cameraPosition.y ||
                scr.x >= globalState.cameraPosition.x + viewW ||
                scr.y >= globalState.cameraPosition.y + viewH
            ) {
                continue
            }

            // TODO: uses hack
            const texture = this.getTextureFromHack(img)
            if (!texture) {
                dbg('renderer', 'skipping tile without a texture: ' + img)
                continue
            }
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, texture)

            // draw — screen offset is zoomed world delta
            gl.uniform2f(
                this.offsetLocation,
                (scr.x - globalState.cameraPosition.x) * z,
                (scr.y - globalState.cameraPosition.y) * z
            )
            gl.drawArrays(gl.TRIANGLES, 0, 6)
        }
    }
}

// Roofs are sky-facing — lit by ambient sky light only, not by
// floor-level spotlights. Bind the zeroed roofDummyTexture on unit 5
// so the shader computes max(0, ambient) = ambient for every pixel.
WebGLRenderer.prototype.setRoofLighting = function (): void {
    const gl = this.gl
    gl.uniform1f(this.uTileAmbient, GameTime.getAmbientLightNormalized())
    gl.uniform2f(this.uTileCamera, globalState.cameraPosition.x, globalState.cameraPosition.y)
    if (this.uTileZoom) gl.uniform1f(this.uTileZoom, getZoom())
    gl.activeTexture(gl.TEXTURE5)
    gl.bindTexture(gl.TEXTURE_2D, this.roofDummyTexture)
    gl.activeTexture(gl.TEXTURE0)
}

WebGLRenderer.prototype.renderRoof = function (roof: TileMap, hideSet?: Set<string> | null): void {
    const gl = this.gl
    gl.useProgram(this.tileShader)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tileBuffer)
    gl.uniform1f(this.uNumFramesLocation, 1)
    gl.uniform1f(this.uFrameLocation, 0)
    const z = getZoom()
    gl.uniform2f(this.uScaleLocation, 80 * z, 36 * z)

    // Use ambient-only lighting for sky-facing roof tiles.
    this.setRoofLighting()

    const viewW = SCREEN_WIDTH / z
    const viewH = SCREEN_HEIGHT / z

    for (let i = 0; i < roof.length; i++) {
        for (let j = 0; j < roof[0].length; j++) {
            const tile = roof[j][i]
            if (tile === 'grid000') continue
            if (hideSet && hideSet.has(`${i},${j}`)) continue
            const img = 'art/tiles/' + tile

            const scr = tileToScreen(i, j)
            scr.y += -96
            if (
                scr.x + TILE_WIDTH < globalState.cameraPosition.x ||
                scr.y + TILE_HEIGHT < globalState.cameraPosition.y ||
                scr.x >= globalState.cameraPosition.x + viewW ||
                scr.y >= globalState.cameraPosition.y + viewH
            ) {
                continue
            }

            const texture = this.getTextureFromHack(img)
            if (!texture) {
                dbg('renderer', 'skipping roof tile without a texture: ' + img)
                continue
            }
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, texture)

            gl.uniform2f(
                this.offsetLocation,
                (scr.x - globalState.cameraPosition.x) * z,
                (scr.y - globalState.cameraPosition.y) * z
            )
            gl.drawArrays(gl.TRIANGLES, 0, 6)
        }
    }
}

WebGLRenderer.prototype.renderFloor = function (floor: TileMap): void {
    if (Config.engine.doFloorLighting) {
        if (this.floorLightingMode === 'gpu') {
            this.renderLitFloorGPU(floor)
        } else {
            this.renderLitFloorCPU(floor)
        }
    } else {
        this.drawTileMap(floor, 0)
    }
}

// CE ref: object.cc:4949 _obj_render() — walls/scenery that occlude the player
// are drawn with the "egg" transparency so the player is visible behind them.
// These are tunable at runtime via setEggAlpha() / setEggRadius() in the browser console.
let EGG_RADIUS = 8   // hex distance — walls farther than this are never faded
let EGG_ALPHA  = 0.4 // outer/flat alpha (0 = fully transparent, 1 = fully opaque)

function getEggAlpha(): number  { return Config.ui.eggAlpha  ?? EGG_ALPHA  }
function getEggRadius(): number { return Config.ui.eggRadius ?? EGG_RADIUS }

// CE ref: obj_types.h:81 — OBJECT_WALL_TRANS_END object flag bit.
const OBJECT_WALL_TRANS_END = 0x10000000

// CE ref: object.cc:4949 _obj_render() — the occlusion test branches into
// 4 different combinations of tileIsInFrontOf/tileIsToRightOf depending on
// bits in the wall/scenery's own extendedFlags (flags_ext, read from the
// .pro file — see proto.py readWall()/readScenery()).
//
// IMPORTANT: this is NOT a "distance from player" test, and no combination
// of these 4 cases can ever produce a symmetric circle around the player.
// tileIsInFrontOf/tileIsToRightOf are literally `dx <= dy * k` line tests in
// screen space — a fixed half-plane through the player, whose boundary is
// the NW-SE hex axis. That's deliberate: it's asking "is this wall between
// the isometric camera (always at a fixed diagonal angle) and the player",
// which is inherently one-sided. CE's real egg effect is camera-facing-only,
// not a radial bubble — confirmed correct for 'egg' mode.
//
// 'alpha' mode is a DH2 invention (not a CE feature) meant to behave like a
// symmetric "see-through bubble around me", so it must NOT reuse this
// directional test as its qualification gate — that's what was producing
// the NW-SE-axis cutoff and the "affects walls behind me too" complaint
// (the OR/AND combinations don't map cleanly to "in front of the camera"
// either). It uses a plain symmetric hexDistance check instead.
//
// Argument order matters for the CE cases — tileIsInFrontOf/tileIsToRightOf
// are NOT symmetric under swapping their arguments, so each case below
// mirrors CE's exact (object, dude) vs (dude, object) ordering.
function isCEOccludingWall(obj: Obj, player: Obj): boolean {
    const extendedFlags: number = obj.pro?.extra?.extendedFlags ?? 0
    const objFlags: number = obj.flags ?? 0
    const frontObjDude = hexIsInFrontOf(obj.position, player.position)
    const frontDudeObj = hexIsInFrontOf(player.position, obj.position)
    const rightObjDude = hexIsToRightOf(obj.position, player.position)
    const rightDudeObj = hexIsToRightOf(player.position, obj.position)

    if ((extendedFlags & 0x8000000) !== 0 || (extendedFlags & 0x80000000) !== 0) {
        let v = frontObjDude
        if (v && rightObjDude && (objFlags & OBJECT_WALL_TRANS_END) !== 0) v = false
        return v
    } else if ((extendedFlags & 0x10000000) !== 0) {
        return frontObjDude || rightDudeObj
    } else if ((extendedFlags & 0x20000000) !== 0) {
        return frontObjDude && rightDudeObj
    } else {
        // CE default case
        let v = rightDudeObj
        if (v && frontDudeObj && (objFlags & OBJECT_WALL_TRANS_END) !== 0) v = false
        return v
    }
}

function isEggObject(obj: Obj): boolean {
    // 'beta' mode is a pure floor overlay — no wall transparency at all.
    if (Config.ui.eggMode === 'beta') return false

    if (obj.type !== 'scenery' && obj.type !== 'wall') return false
    const player = globalState.player
    if (!player) return false
    if (hexDistance(player.position, obj.position) > getEggRadius()) return false

    if (Config.ui.eggMode === 'egg') {
        return isCEOccludingWall(obj, player)
    }

    // 'alpha' mode: symmetric radius only, no directional gate — see comment above.
    return true
}

WebGLRenderer.prototype.renderObject = function (obj: Obj): void {
    const renderInfo = this.objectRenderInfo(obj)
    if (!renderInfo || !renderInfo.visible) {
        return
    }
    const z = getZoom()
    const egg = Config.ui.showEgg !== false && isEggObject(obj)

    if (egg) {
        const gl = this.gl
        if (this.uAlpha) gl.uniform1f(this.uAlpha, getEggAlpha())

        // Egg-mask mode: anchor the egg to the player's actual rendered foot
        // point (bottom-center of the sprite), not the raw hex position.
        // DH2's hexToScreen() already returns the bottom-center anchor (the
        // same point objectRenderInfo subtracts half-width/full-height from
        // to get the sprite's top-left draw position) — unlike CE's
        // tileToScreenXY which returns a tile *corner* and needs a +16/+8
        // fudge to reach the center. Adding that CE-style fudge here was
        // shifting the egg by half a hex tile (NW, since hexToScreen's +y
        // goes down/south and +x goes right/east). Deriving the anchor from
        // the player's own renderInfo also makes the egg track per-frame
        // walk-animation shift smoothly, instead of snapping per-hex.
        if (Config.ui.eggMode === 'egg' && this.eggTexture && this.eggWidth > 0 && this.eggHeight > 0 && this.uEggMode && this.uEggCenter) {
            const playerInfo = this.objectRenderInfo(globalState.player!)
            if (playerInfo) {
                // Use frameWidth/frameHeight (this frame's actual trimmed
                // bounding box — what offsetX/offsetY were computed against
                // in objectRenderInfo), NOT uniformFrameWidth/Height (the
                // sprite-sheet's padded per-slot size). Reconstructing with
                // the uniform size left a residual offset of half the
                // padding delta whenever a frame's trimmed box differs from
                // the sheet's uniform slot size.
                // Vertical anchor is nudged down by one hex-side (~10px):
                // anchoring exactly at the feet made the egg's bottom edge
                // end right at the player's feet instead of extending a
                // bit below them.
                const eggX = playerInfo.x + playerInfo.frameWidth / 2
                const eggY = playerInfo.y + playerInfo.frameHeight + 10
                gl.uniform1i(this.uEggMode, 1)
                gl.uniform2f(this.uEggCenter, eggX, eggY)
                // Bind egg texture to unit 6
                gl.activeTexture(gl.TEXTURE6)
                gl.bindTexture(gl.TEXTURE_2D, this.eggTexture)
                gl.activeTexture(gl.TEXTURE0)
            }
        }
    }

    this.renderFrame(
        obj.art,
        (renderInfo.x - globalState.cameraPosition.x) * z,
        (renderInfo.y - globalState.cameraPosition.y) * z,
        renderInfo.uniformFrameWidth * z,
        renderInfo.uniformFrameHeight * z,
        renderInfo.artInfo.totalFrames,
        renderInfo.spriteFrameNum,
        /*lit*/ true
    )

    if (egg) {
        const gl = this.gl
        if (this.uAlpha) gl.uniform1f(this.uAlpha, 1.0)
        if (Config.ui.eggMode === 'egg' && this.uEggMode) gl.uniform1i(this.uEggMode, 0)
    }
}

WebGLRenderer.prototype.renderObjectOutlined = function (obj: Obj): void {
    this.renderObject(obj)
}

// CE outline colors (object.cc:4704 objectDrawOutline): OUTLINE_TYPE_HOSTILE =
// palette 243 (red), OUTLINE_TYPE_FRIENDLY = palette 229 (green). CE also
// cycles a few palette shades down the sprite height for a shimmer effect;
// DH2 uses one flat color per type as a documented simplification.
// 'blue' is a DH2 addition (no CE equivalent) — neutral critters not yet
// hostile and not on the player's team, so an unprovoked target can be
// spotted (even through walls) before attacking. See Combat.refreshHighlights().
const OUTLINE_COLORS: { [name: string]: [number, number, number] } = {
    red: [1, 0, 0],
    green: [0, 1, 0],
    yellow: [1, 1, 0],
    blue: [0.3, 0.6, 1],
}

function getOutlineFillAlpha(): number   { return Config.ui.outlineFillAlpha   ?? 0.2 }
function getOutlineBorderAlpha(): number { return Config.ui.outlineBorderAlpha ?? 0.5 }

// CE ref: object.cc:874 _obj_render_post_roof() — combat outlines (and the
// item-pickup highlight) are drawn as a flat solid-color silhouette in a
// dedicated pass that runs AFTER walls/roofs for the frame, which is why
// they remain visible through occluding geometry. DH2 reuses the existing
// painter's-algorithm draw order (every quad is at the same GL depth=0 with
// depthFunc LEQUAL — see webglContext.ts init() — so later draws always win
// regardless of depth) by simply calling this after renderRoof() in
// renderer.ts's render().
//
// Three steps, giving fillAlpha/borderAlpha genuinely independent control
// (an earlier version stacked border-then-fill directly, which mathematically
// makes fillAlpha invisible whenever borderAlpha=1: compositing "outlineColor
// @ fillAlpha" over an already-fully-opaque same-color layer changes
// nothing, since alpha-blending a color over itself is a no-op regardless of
// alpha — see wiki/known_bugs.md CI14):
//  1. "border": the sprite's silhouette stamped at 4 cardinal 1px
//     screen-space offsets around its normal position, at borderAlpha. Since
//     a 1px shift barely changes which pixels are inside the silhouette,
//     these 4 stamps overlap almost entirely with the sprite's own
//     footprint — covering nearly the whole sprite, not just a thin edge
//     (a true 1px-only edge would need per-pixel neighbor sampling in the
//     shader, risking bleed across frames in the sprite atlas).
//  2. Punch-out: redraw the object NORMALLY (normal lit shader path, not
//     outline mode) at its unshifted position. This restores the interior
//     to the normal sprite, leaving only the border stamps' outermost 1px
//     sliver visible around the edge — turning step 1 from "near-total fill"
//     into an actual border.
//  3. "fill": one more outline-mode stamp at the unshifted position, at
//     fillAlpha, on top of the now-restored normal sprite. This is what
//     independently controls how much color washes over the interior,
//     regardless of what borderAlpha was set to.
// Net effect: borderAlpha=1, fillAlpha=0 → crisp opaque border only.
// borderAlpha=0, fillAlpha=0.5 → translucent fill only, no border. Both >0
// → a fill with a more solid border ring around it.
WebGLRenderer.prototype.renderOutlinePass = function (objs: Obj[]): void {
    const gl = this.gl
    if (!this.uOutlineMode || !this.uOutlineColor || !this.uOutlineAlpha) return
    const z = getZoom()
    const fillAlpha = getOutlineFillAlpha()
    const borderAlpha = getOutlineBorderAlpha()

    for (const obj of objs) {
        if (!obj.outline) continue
        const renderInfo = this.objectRenderInfo(obj)
        if (!renderInfo || !renderInfo.visible) continue

        const color = OUTLINE_COLORS[obj.outline] ?? OUTLINE_COLORS.red
        const baseX = (renderInfo.x - globalState.cameraPosition.x) * z
        const baseY = (renderInfo.y - globalState.cameraPosition.y) * z
        const w = renderInfo.uniformFrameWidth * z
        const h = renderInfo.uniformFrameHeight * z

        if (borderAlpha > 0) {
            gl.uniform1i(this.uOutlineMode, 1)
            gl.uniform3f(this.uOutlineColor, color[0], color[1], color[2])
            gl.uniform1f(this.uOutlineAlpha, borderAlpha)
            for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                this.renderFrame(
                    obj.art,
                    baseX + dx * z,
                    baseY + dy * z,
                    w,
                    h,
                    renderInfo.artInfo.totalFrames,
                    renderInfo.spriteFrameNum,
                    /*lit*/ false
                )
            }

            // Punch-out: restore the interior to the normal sprite so only
            // the border stamps' protruding edge remains visible.
            gl.uniform1i(this.uOutlineMode, 0)
            this.renderFrame(
                obj.art,
                baseX,
                baseY,
                w,
                h,
                renderInfo.artInfo.totalFrames,
                renderInfo.spriteFrameNum,
                /*lit*/ true
            )
        }

        if (fillAlpha > 0) {
            gl.uniform1i(this.uOutlineMode, 1)
            gl.uniform3f(this.uOutlineColor, color[0], color[1], color[2])
            gl.uniform1f(this.uOutlineAlpha, fillAlpha)
            this.renderFrame(
                obj.art,
                baseX,
                baseY,
                w,
                h,
                renderInfo.artInfo.totalFrames,
                renderInfo.spriteFrameNum,
                /*lit*/ false
            )
        }

        gl.uniform1i(this.uOutlineMode, 0)
        gl.uniform1f(this.uOutlineAlpha, 1.0)
    }
}

WebGLRenderer.prototype.renderFrame = function (
    imgPath: string,
    x: number,
    y: number,
    width: number,
    height: number,
    totalFrames: number,
    frame: number,
    lit = false
): void {
    // TODO: uses hack
    const texture = this.getTextureFromHack(imgPath)
    if (!texture) {
        dbg('renderer', 'no texture for object')
        return
    }

    const gl = this.gl
    this.gl.useProgram(this.tileShader)

    // draw
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)

    gl.uniform1f(this.uNumFramesLocation, totalFrames)
    gl.uniform1f(this.uFrameLocation, frame)

    gl.uniform2f(this.offsetLocation, x, y)
    gl.uniform2f(this.uScaleLocation, width, height)

    this.setTileLighting(lit)

    gl.drawArrays(gl.TRIANGLES, 0, 6)
}

WebGLRenderer.prototype.renderImage = function (imgPath: string, x: number, y: number, width: number, height: number): void {
    // UI path — never darkened by ambient.
    this.renderFrame(imgPath, x, y, width, height, 1, 0, /*lit*/ false)
}

WebGLRenderer.prototype.renderFont = function (font: Font, x: number, y: number) {
    const texture = this.textures[font.filepath]
    const width = font.symbols.reduce((accumulator, sym) => accumulator + sym.width, 0)
    const gl = this.gl
    // FIXME: set up separate uniforms for this shader
    // this.gl.useProgram(this.fontShader)

    // draw
    gl.bindTexture(gl.TEXTURE_2D, texture)

    gl.uniform1f(this.uNumFramesLocation, 1)
    gl.uniform1f(this.uFrameLocation, 0)

    gl.uniform2f(this.offsetLocation, x, y)
    gl.uniform2f(this.uScaleLocation, width, font.height)

    // Text is UI — keep ambient = 1 so letters stay legible at night.
    this.setTileLighting(false)

    gl.drawArrays(gl.TRIANGLES, 0, 6)
}
