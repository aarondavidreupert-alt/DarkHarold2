import { hexFromScreen } from '../geometry.js'
import globalState from '../globalState.js'
import * as GameTime from '../gametime.js'
import { Lighting } from '../lighting.js'
import { Lightmap } from '../lightmap.js'
import { getZoom, SCREEN_HEIGHT, SCREEN_WIDTH, TileMap } from '../renderer.js'
import { tileToScreen, TILE_HEIGHT, TILE_WIDTH } from '../tile.js'
import { getFileJSON } from '../util.js'
import { dbg } from '../logger.js'
import { WebGLRenderer } from './webglContext.js'

declare module './webglContext.js' {
    interface WebGLRenderer {
        renderLitFloorCPU(tileMap: TileMap, useColorTable?: boolean): void
        renderLitFloorGPU(tileMap: TileMap): void
        renderFloorToFBO(tileMap: TileMap): void
        compositeFloorWithLighting(): void
    }
}

WebGLRenderer.prototype.renderLitFloorCPU = function (tileMap: TileMap, useColorTable = true) {
    Lightmap.rebuildDynamicLight()

    // initialize color tables if necessary (TODO: hack, should be initialized elsewhere)
    if (useColorTable) {
        if (Lighting.colorLUT === null) {
            Lighting.colorLUT = getFileJSON('lut/color_lut.json')
            Lighting.colorRGB = getFileJSON('lut/color_rgb.json')
        }
    }

    const gl = this.gl

    // Upload Lightmap.tile_intensity to unit 5 even in CPU mode, so
    // subsequent world object draws (walls / critters / objects / roofs)
    // going through the tile shader can sample the same per-tile light
    // the GPU floor path uses. Without this, CPU-mode scenes would see
    // day/night on walls but no per-tile spotlight brightening.
    const tileData = this.tileDataBuffer
    for (let i = 0; i < 40000; i++) {
        tileData[i] = Math.round(Math.min(Lightmap.tile_intensity[i], 65536) / 65536.0 * 255)
    }
    gl.activeTexture(gl.TEXTURE5)
    gl.bindTexture(gl.TEXTURE_2D, this.tileIntensityTexture)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 200, 200, gl.RED, gl.UNSIGNED_BYTE, tileData)
    gl.activeTexture(gl.TEXTURE0)

    // use floor light shader
    gl.useProgram(this.floorLightShader)
    gl.uniform1i(this.uUseGPULighting, 0)
    const ambientCPU = GameTime.getAmbientLightNormalized()
    gl.uniform1f(this.uAmbient, ambientCPU)
    if (ambientCPU !== this.lastLoggedAmbient) {
        dbg('renderer', `[lighting/cpu] u_ambient = ${ambientCPU.toFixed(3)} (hour ${GameTime.getHour()}:${String(GameTime.getMinute()).padStart(2,'0')})`)
        this.lastLoggedAmbient = ambientCPU
    }

    // bind buffers
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tileBuffer)
    const zCPU = getZoom()
    gl.uniform2f(this.litScaleLocation, 80 * zCPU, 36 * zCPU)

    // bind light buffer texture in texture unit 0
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.lightBufferTexture)

    // allocate texture for tile image
    //gl.activeTexture(gl.TEXTURE1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 80, 36, 0, gl.RED, gl.FLOAT, null)

    // use tile texture unit
    //gl.activeTexture(gl.TEXTURE0)

    // construct light buffer
    const lightBuffer = new Float32Array(80 * 36)
    let lastTexture = null

    const viewWCPU = SCREEN_WIDTH / zCPU
    const viewHCPU = SCREEN_HEIGHT / zCPU

    // reverse i to draw in the order Fallout 2 normally does
    // otherwise there will be artifacts in the light rendering
    // due to tile sizes being different and not overlapping properly
    for (let i = tileMap.length - 1; i >= 0; i--) {
        for (let j = 0; j < tileMap[0].length; j++) {
            const tile = tileMap[j][i]
            if (tile === 'grid000') {
                continue
            }
            const img = 'art/tiles/' + tile

            const scr = tileToScreen(i, j)
            if (
                scr.x + TILE_WIDTH < globalState.cameraPosition.x ||
                scr.y + TILE_HEIGHT < globalState.cameraPosition.y ||
                scr.x >= globalState.cameraPosition.x + viewWCPU ||
                scr.y >= globalState.cameraPosition.y + viewHCPU
            ) {
                continue
            }

            if (img !== lastTexture) {
                gl.activeTexture(gl.TEXTURE0)

                // TODO: uses hack
                const texture = this.getTextureFromHack(img)
                if (!texture) {
                    dbg('renderer', 'skipping tile without a texture: ' + img)
                    continue
                }

                gl.bindTexture(gl.TEXTURE_2D, texture)

                lastTexture = img
            }

            // compute lighting

            // TODO: how correct is this?
            const hex = hexFromScreen(scr.x - 13, scr.y + 13)

            const isTriangleLit = Lighting.initTile(hex)
            let framebuffer
            let intensity_

            if (isTriangleLit) {
                framebuffer = Lighting.computeFrame()
            }

            // render tile
            for (let y = 0; y < 36; y++) {
                for (let x = 0; x < 80; x++) {
                    if (isTriangleLit) {
                        intensity_ = framebuffer[160 + 80 * y + x]
                    } else {
                        // uniformly lit
                        intensity_ = Lighting.vertices[3]
                    }

                    // blit to the light buffer
                    lightBuffer[y * 80 + x] = intensity_ //(x%2 && y%2) ? 0.5 : 0.25 //Math.max(0.25, intensity_/65536)
                }
            }

            // update light buffer texture
            gl.activeTexture(gl.TEXTURE1)
            //gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 80, 36, 0, gl.RGBA, gl.UNSIGNED_BYTE, lightBuffer)
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 80, 36, gl.RED, gl.FLOAT, lightBuffer)

            // draw
            gl.uniform2f(
                this.litOffsetLocation,
                (scr.x - globalState.cameraPosition.x) * zCPU,
                (scr.y - globalState.cameraPosition.y) * zCPU
            )
            gl.drawArrays(gl.TRIANGLES, 0, 6)
        }
    }

    gl.activeTexture(gl.TEXTURE0)

    // use normal shader
    gl.useProgram(this.tileShader)
    // Push live ambient so subsequent object / roof draws are correct
    // even if no objects are on screen to trigger setTileLighting.
    this.setTileLighting(true)
}

WebGLRenderer.prototype.renderLitFloorGPU = function (tileMap: TileMap) {
    Lightmap.rebuildDynamicLight()

    const gl = this.gl

    // Upload tile_intensity as 200×200 R8 (uint8, 0-255) — R8 always supports LINEAR filtering
    const tileData = this.tileDataBuffer
    for (let i = 0; i < 40000; i++) {
        tileData[i] = Math.round(Math.min(Lightmap.tile_intensity[i], 65536) / 65536.0 * 255)
    }
    gl.activeTexture(gl.TEXTURE5)
    gl.bindTexture(gl.TEXTURE_2D, this.tileIntensityTexture)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 200, 200, gl.RED, gl.UNSIGNED_BYTE, tileData)

    // Render unlit floor to FBO (cached — only re-renders on camera move or map change)
    this.renderFloorToFBO(tileMap)

    // Composite floor FBO with lighting in a single fullscreen quad
    this.compositeFloorWithLighting()
}

WebGLRenderer.prototype.renderFloorToFBO = function (tileMap: TileMap): void {
    const gl = this.gl
    const cameraX = globalState.cameraPosition.x
    const cameraY = globalState.cameraPosition.y
    const z = getZoom()

    // Skip re-rendering if FBO is still valid (camera hasn't moved, same tilemap, zoom unchanged)
    if (
        this.floorFBOValid &&
        cameraX === this.lastFloorCameraX &&
        cameraY === this.lastFloorCameraY &&
        z === this.lastFloorZoom &&
        tileMap === this.lastFloorTileMap
    ) {
        return
    }

    // Render unlit floor tiles into FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.floorFBO)
    gl.clearColor(0, 0, 0, 0) // transparent background
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.disable(gl.DEPTH_TEST)

    gl.useProgram(this.tileShader)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer)
    gl.enableVertexAttribArray(this.texCoordLocation)
    gl.vertexAttribPointer(this.texCoordLocation, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tileBuffer)
    gl.enableVertexAttribArray(this.positionLocation)
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0)

    gl.uniform1f(this.uNumFramesLocation, 1)
    gl.uniform1f(this.uFrameLocation, 0)
    // Tiles are drawn into the FBO at zoomed size so the cached floor
    // already reflects the current zoom; the composite pass is a plain
    // fullscreen quad on top.
    gl.uniform2f(this.uScaleLocation, TILE_WIDTH * z, TILE_HEIGHT * z)
    // The FBO is the unlit floor cache. compositeFloorWithLighting()
    // applies the real ambient + tile intensity via floorLightShader
    // afterwards, so bake the floor with ambient = 1 here to avoid
    // double-lighting it.
    this.setTileLighting(false)

    const viewW = SCREEN_WIDTH / z
    const viewH = SCREEN_HEIGHT / z

    let lastTexture: string | null = null
    for (let i = tileMap.length - 1; i >= 0; i--) {
        for (let j = 0; j < tileMap[0].length; j++) {
            const tile = tileMap[j][i]
            if (tile === 'grid000') continue
            const img = 'art/tiles/' + tile
            const scr = tileToScreen(i, j)
            if (
                scr.x + TILE_WIDTH < cameraX ||
                scr.y + TILE_HEIGHT < cameraY ||
                scr.x >= cameraX + viewW ||
                scr.y >= cameraY + viewH
            ) {
                continue
            }

            if (img !== lastTexture) {
                const texture = this.getTextureFromHack(img)
                if (!texture) continue
                gl.bindTexture(gl.TEXTURE_2D, texture)
                lastTexture = img
            }

            gl.uniform2f(this.offsetLocation, (scr.x - cameraX) * z, (scr.y - cameraY) * z)
            gl.drawArrays(gl.TRIANGLES, 0, 6)
        }
    }

    // Restore state — keep clear colour black (CE: tileRefreshGame bufferFill=0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.clearColor(0, 0, 0, 1)
    gl.enable(gl.DEPTH_TEST)

    this.lastFloorCameraX = cameraX
    this.lastFloorCameraY = cameraY
    this.lastFloorZoom = z
    this.lastFloorTileMap = tileMap
    this.floorFBOValid = true
}

WebGLRenderer.prototype.compositeFloorWithLighting = function (): void {
    const gl = this.gl

    gl.useProgram(this.floorLightShader)

    // Rebind vertex attributes for the lighting shader (use Y-flipped UVs for FBO sampling)
    const litPositionLoc = gl.getAttribLocation(this.floorLightShader, 'a_position')
    const litTexCoordLoc = gl.getAttribLocation(this.floorLightShader, 'a_texCoord')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.compositeTexCoordBuffer)
    gl.enableVertexAttribArray(litTexCoordLoc)
    gl.vertexAttribPointer(litTexCoordLoc, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tileBuffer)
    gl.enableVertexAttribArray(litPositionLoc)
    gl.vertexAttribPointer(litPositionLoc, 2, gl.FLOAT, false, 0, 0)

    // Set uniforms for fullscreen quad composite
    gl.uniform1i(this.uUseGPULighting, 1)
    const ambientGPU = GameTime.getAmbientLightNormalized()
    gl.uniform1f(this.uAmbient, ambientGPU)
    if (ambientGPU !== this.lastLoggedAmbient) {
        dbg('renderer', `[lighting/gpu] u_ambient = ${ambientGPU.toFixed(3)} (hour ${GameTime.getHour()}:${String(GameTime.getMinute()).padStart(2,'0')})`)
        this.lastLoggedAmbient = ambientGPU
    }
    gl.uniform2f(this.litScaleLocation, SCREEN_WIDTH, SCREEN_HEIGHT)
    gl.uniform2f(this.uCamera, globalState.cameraPosition.x, globalState.cameraPosition.y)
    // Zoom tells the lighting shader how to recover world coords from
    // gl_FragCoord — `world = camera + gl_FragCoord / (dpr * zoom)`.
    if (this.uFloorLightZoom) gl.uniform1f(this.uFloorLightZoom, getZoom())
    gl.uniform2f(this.litOffsetLocation, 0, 0)
    gl.uniform1i(gl.getUniformLocation(this.floorLightShader, 'u_image'), 0)
    gl.uniform1i(gl.getUniformLocation(this.floorLightShader, 'u_tileIntensity'), 5)

    // Bind FBO texture as the floor image
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.floorFBOTexture)

    // Draw single fullscreen quad — applies lighting to the cached floor in one draw call
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    // Restore tile shader for subsequent object rendering
    gl.activeTexture(gl.TEXTURE0)
    gl.useProgram(this.tileShader)

    // Rebind vertex attributes for the tile shader
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer)
    gl.enableVertexAttribArray(this.texCoordLocation)
    gl.vertexAttribPointer(this.texCoordLocation, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tileBuffer)
    gl.enableVertexAttribArray(this.positionLocation)
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0)

    // Push live ambient into the tile shader now — subsequent
    // renderObject / drawTileMap calls may or may not happen (empty
    // map, roofs hidden), so the tile shader must already have the
    // correct ambient before any of them fire.
    this.setTileLighting(true)
}
