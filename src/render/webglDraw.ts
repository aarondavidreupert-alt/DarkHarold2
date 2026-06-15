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
import { hexIsInFrontOf, hexIsToRightOf, hexToScreen } from '../geometry/hexScreen.js'

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

function isEggObject(obj: Obj): boolean {
    if (obj.type !== 'scenery' && obj.type !== 'wall') return false
    const player = globalState.player
    if (!player) return false
    // CE default case: tileIsToRightOf(gDude, object) — player is to the right of the wall.
    // Also require the wall to be "in front of" the player (closer to camera = higher z-order),
    // which is the actual occlusion condition CE tests implicitly via rect intersection.
    return hexIsInFrontOf(obj.position, player.position)
        && hexIsToRightOf(player.position, obj.position)
        && hexDistance(player.position, obj.position) <= getEggRadius()
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

        // Egg-mask mode: set the egg center uniform to the player's screen position.
        // CE ref: object.cc:4995 — egg centered at player tile + 16px x + 8px y.
        if (Config.ui.eggMode === 'egg' && this.eggTexture && this.uEggMode && this.uEggCenter) {
            const p = globalState.player!.position
            const ps = hexToScreen(p.x, p.y)
            // Egg center in WORLD SPACE (not viewport/logical pixels) so the
            // shader can use the same coordinate system as getWorldTileLight().
            // CE ref: object.cc:4995 — tileToScreenXY + 16x + 8y for egg anchor.
            gl.uniform1i(this.uEggMode, 1)
            gl.uniform2f(this.uEggCenter, ps.x + 16, ps.y + 8)
            // Bind egg texture to unit 6
            gl.activeTexture(gl.TEXTURE6)
            gl.bindTexture(gl.TEXTURE_2D, this.eggTexture)
            gl.activeTexture(gl.TEXTURE0)
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
