import { heart } from './heart.js'
import { hexFromScreen } from './geometry.js'
import globalState from './globalState.js'
import { Lighting } from './lighting.js'
import { Lightmap } from './lightmap.js'
import { Obj } from './object.js'
import { Renderer, SCREEN_HEIGHT, SCREEN_WIDTH, TileMap } from './renderer.js'
import { tileToScreen, TILE_HEIGHT, TILE_WIDTH } from './tile.js'
import { getFileJSON } from './util.js'
import { Config } from './config.js'
import { Font } from './formats/fon.js'

export interface ShaderSources {
    fragment: string
    vertex: string
    fragmentLighting: string
    fragmentFont: string
}

export class WebGLRenderer extends Renderer {
    private canvas: HTMLCanvasElement
    private gl: WebGL2RenderingContext
    private offsetLocation: WebGLUniformLocation
    private positionLocation: number
    private texCoordLocation: number
    private uScaleLocation: WebGLUniformLocation
    private uNumFramesLocation: WebGLUniformLocation
    private uFrameLocation: WebGLUniformLocation
    private objectUVBuffer: WebGLBuffer
    private texCoordBuffer: WebGLBuffer
    private tileBuffer: WebGLBuffer
    private tileShader: WebGLProgram

    private fontShader: WebGLProgram

    private uLightBuffer: WebGLUniformLocation
    private litOffsetLocation: WebGLUniformLocation
    private litScaleLocation: WebGLUniformLocation
    private lightBufferTexture: WebGLTexture
    private floorLightShader: WebGLProgram

    private tileIntensityTexture: WebGLTexture | null = null // 200x200 R8 tile intensity texture
    private floorLightingMode: 'gpu' | 'cpu' = 'cpu'
    private uUseGPULighting: WebGLUniformLocation | null = null
    private uAmbient: WebGLUniformLocation | null = null
    private uCamera: WebGLUniformLocation | null = null
    private uScreenResolutionLighting: WebGLUniformLocation | null = null
    private uDpr: WebGLUniformLocation | null = null

    // FBO for caching unlit floor tiles; re-rendered only when camera moves
    private floorFBO: WebGLFramebuffer | null = null
    private floorFBOTexture: WebGLTexture | null = null
    private floorFBODirty = true
    private floorFBOCameraX = NaN
    private floorFBOCameraY = NaN

    // Pre-allocated buffer for tile intensity upload (avoids per-frame allocation)
    private tileData = new Uint8Array(200 * 200)
    // Version of the last lightmap data uploaded to the GPU
    private lastLightmapVersion = -1

    // Cached attribute locations for floorLightShader (set during init)
    private litPositionLoc = -1
    private litTexCoordLoc = -1

    private textures: { [key: string]: WebGLTexture } = {} // WebGL texture cache

    constructor(private shaderSources: ShaderSources, fonts: Font[]) {
        super()
        this.fonts = fonts
    }

    newTexture(key: string, img: TexImageSource, doCache = true): WebGLTexture {
        const gl = this.gl
        const texture = this.gl.createTexture()
        gl.bindTexture(this.gl.TEXTURE_2D, texture)

        // Set the parameters so we can render any size image.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)

        // Upload the image into the texture.
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img)

        if (doCache) {
            this.textures[key] = texture
        }
        return texture
    }

    getTexture(name: string): WebGLTexture | null {
        const texture = this.textures[name]
        if (texture !== undefined) {
            return texture
        }
        return null
    }

    getTextureFromHack(name: string): WebGLTexture | null {
        // TODO: hack (ideally it should already be in textures)
        if (this.textures[name] === undefined) {
            if (globalState.images[name] !== undefined) {
                // generate a new texture
                return this.newTexture(name, globalState.images[name])
            }
            return null
        }
        return this.textures[name]
    }

    // create a texture from an array-like thing into a 3-component Float32Array using only the R component
    // TODO: find a better format to store data in textures
    textureFromArray(arr: any, size = 256): WebGLTexture {
        const buf = new Float32Array(size * size * 4)
        for (let i = 0; i < arr.length; i++) {
            buf[i * 4] = arr[i]
        }

        const gl = this.gl
        const texture = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, size, size, 0, gl.RGBA, gl.FLOAT, buf)
        return texture
    }

    // create a texture from a Uint8Array with RGB components
    textureFromColorArray(arr: Uint8Array, width: number): WebGLTexture {
        const gl = this.gl
        const texture = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, width, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, arr)
        return texture
    }

    // create a texture from a Uint8Array with RGB components
    textureFromFont(font: Font): WebGLTexture {
        const gl = this.gl
        const texture = gl.createTexture()
        const width = font.symbols.reduce((accumulator, sym) => accumulator + sym.width, 0)
        const alignment = 1
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, alignment)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, font.height, 0, gl.RED, gl.UNSIGNED_BYTE, font.textureData)
        const defaultAlignment = 4
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, defaultAlignment)
        return texture
    }

    init(): void {
        this.canvas = document.getElementById('cnv') as HTMLCanvasElement

        // TODO: hack
        heart.canvas = this.canvas
        heart.ctx = null
        heart._bg = null

        const gl = this.canvas.getContext('webgl2') as WebGL2RenderingContext
        if (!gl) {
            alert('error getting WebGL context')
            return
        }
        this.gl = gl

        // Scale the canvas buffer for high-DPI displays so pixels are crisp.
        // Keep the CSS display size at the logical resolution so game coordinates
        // (0–SCREEN_WIDTH, 0–SCREEN_HEIGHT) remain valid without any changes.
        const dpr = window.devicePixelRatio || 1
        const cssWidth = this.canvas.width   // logical width  (e.g. 800)
        const cssHeight = this.canvas.height // logical height (e.g. 600)
        this.canvas.style.width = cssWidth + 'px'
        this.canvas.style.height = cssHeight + 'px'
        this.canvas.width = Math.round(cssWidth * dpr)
        this.canvas.height = Math.round(cssHeight * dpr)
        gl.viewport(0, 0, this.canvas.width, this.canvas.height)

        for (const font of this.fonts) {
            this.textures[font.filepath] = this.textureFromFont(font)
        }

        this.gl.clearColor(0.75, 0.75, 0.75, 1.0)
        this.gl.enable(this.gl.DEPTH_TEST)
        this.gl.depthFunc(this.gl.LEQUAL)
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT)

        // enable alpha blending
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA)
        this.gl.enable(this.gl.BLEND)

        // set up tile shader
        this.tileShader = this.getProgram(this.gl, 'vertex', 'fragment')
        this.gl.useProgram(this.tileShader)

        // set up font shader
        this.fontShader = this.getProgram(this.gl, 'vertex', 'fragmentFont')
        // this.gl.useProgram(this.fontShader)

        // set up uniforms/attributes
        this.positionLocation = gl.getAttribLocation(this.tileShader, 'a_position')
        this.offsetLocation = gl.getUniformLocation(this.tileShader, 'u_offset')

        const resolutionLocation = gl.getUniformLocation(this.tileShader, 'u_resolution')
        gl.uniform2f(resolutionLocation, SCREEN_WIDTH, SCREEN_HEIGHT)

        this.texCoordLocation = gl.getAttribLocation(this.tileShader, 'a_texCoord')
        this.uNumFramesLocation = gl.getUniformLocation(this.tileShader, 'u_numFrames')
        this.uFrameLocation = gl.getUniformLocation(this.tileShader, 'u_frame')

        //this.uOffsetLocation = gl.getUniformLocation(this.tileShader, "u_uOffset")
        this.uScaleLocation = gl.getUniformLocation(this.tileShader, 'u_scale')

        // provide texture coordinates for the rectangle.
        this.texCoordBuffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer)
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0]),
            gl.STATIC_DRAW
        )
        gl.enableVertexAttribArray(this.texCoordLocation)
        gl.vertexAttribPointer(this.texCoordLocation, 2, gl.FLOAT, false, 0, 0)

        //this.tileBuffer = this.rectangleBuffer(this.gl, 0, 0, 80, 36)
        this.tileBuffer = this.rectangleBuffer(this.gl, 0, 0, 1, 1)
        gl.enableVertexAttribArray(this.positionLocation)
        gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0)

        // set up floor light shader
        if (Config.engine.doFloorLighting) {
            this.floorLightShader = this.getProgram(this.gl, 'vertex', 'fragmentLighting')
            gl.useProgram(this.floorLightShader)
            this.litOffsetLocation = gl.getUniformLocation(this.floorLightShader, 'u_offset')
            this.litScaleLocation = gl.getUniformLocation(this.floorLightShader, 'u_scale')
            this.uLightBuffer = gl.getUniformLocation(this.floorLightShader, 'u_lightBuffer')
            const litResolutionLocation = gl.getUniformLocation(this.floorLightShader, 'u_resolution')
            const litPositionLocation = gl.getAttribLocation(this.floorLightShader, 'a_position')

            gl.uniform2f(litResolutionLocation, SCREEN_WIDTH, SCREEN_HEIGHT)

            const litTexCoordLocation = gl.getAttribLocation(this.floorLightShader, 'a_texCoord')
            gl.enableVertexAttribArray(litTexCoordLocation)
            gl.vertexAttribPointer(litTexCoordLocation, 2, gl.FLOAT, false, 0, 0)

            gl.enableVertexAttribArray(litPositionLocation)
            gl.vertexAttribPointer(litPositionLocation, 2, gl.FLOAT, false, 0, 0)

            // set up light buffer texture (CPU path only)
            gl.activeTexture(gl.TEXTURE1)
            this.lightBufferTexture = gl.createTexture()
            gl.bindTexture(gl.TEXTURE_2D, this.lightBufferTexture)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
            gl.uniform1i(this.uLightBuffer, 1) // bind the light buffer texture to the shader

            // detect GPU capability: only requires WebGL2 (R8 always supports linear filter)
            const canGPU = this.gl instanceof WebGL2RenderingContext
            if (Config.engine.floorLightingMode === 'auto') {
                this.floorLightingMode = canGPU ? 'gpu' : 'cpu'
            } else {
                this.floorLightingMode = Config.engine.floorLightingMode as 'gpu' | 'cpu'
            }
            console.log('[Lighting] mode:', this.floorLightingMode)

            // create 200x200 R8 tile intensity texture (R8 always supports LINEAR filter in WebGL2;
            // R32F requires OES_texture_float_linear and silently falls back to NEAREST without it)
            gl.activeTexture(gl.TEXTURE5)
            this.tileIntensityTexture = gl.createTexture()
            gl.bindTexture(gl.TEXTURE_2D, this.tileIntensityTexture)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 200, 200, 0, gl.RED, gl.UNSIGNED_BYTE, null)
            gl.useProgram(this.floorLightShader)
            gl.uniform1i(gl.getUniformLocation(this.floorLightShader, 'u_tileIntensity'), 5)

            // get uniform locations
            this.uUseGPULighting = gl.getUniformLocation(this.floorLightShader, 'u_useGPULighting')
            this.uAmbient = gl.getUniformLocation(this.floorLightShader, 'u_ambient')
            this.uCamera = gl.getUniformLocation(this.floorLightShader, 'u_camera')
            this.uScreenResolutionLighting = gl.getUniformLocation(this.floorLightShader, 'u_screenResolution')
            gl.uniform2f(this.uScreenResolutionLighting, this.canvas.width, this.canvas.height)
            this.uDpr = gl.getUniformLocation(this.floorLightShader, 'u_dpr')

            // Cache attribute locations for the floor lighting shader
            this.litPositionLoc = gl.getAttribLocation(this.floorLightShader, 'a_position')
            this.litTexCoordLoc = gl.getAttribLocation(this.floorLightShader, 'a_texCoord')

            // Create offscreen FBO for caching unlit floor tiles.
            // Re-rendered only when the camera moves; lighting applied in a single
            // fullscreen quad pass instead of thousands of per-tile draw calls.
            this.floorFBO = gl.createFramebuffer()
            this.floorFBOTexture = gl.createTexture()
            gl.bindTexture(gl.TEXTURE_2D, this.floorFBOTexture)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.floorFBO)
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.floorFBOTexture, 0)
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                console.error('[Floor FBO] Framebuffer incomplete — floor lighting FBO disabled')
                this.floorFBO = null
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, null)

            gl.activeTexture(gl.TEXTURE0)
            gl.useProgram(this.tileShader)
        }
    }

    /** Call after map load or elevation change to force a full floor FBO rebuild. */
    invalidateFloorFBO(): void {
        this.floorFBODirty = true
        this.lastLightmapVersion = -1
    }

    rectangleBuffer(gl: WebGLRenderingContext, x: number, y: number, width: number, height: number): WebGLBuffer {
        const buffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        const x1 = x
        const x2 = x + width
        const y1 = y
        const y2 = y + height
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([x1, y1, x2, y1, x1, y2, x1, y2, x2, y1, x2, y2]),
            gl.STATIC_DRAW
        )
        return buffer
    }

    getShader(gl: WebGLRenderingContext, id: keyof ShaderSources): WebGLShader {
        const source = this.shaderSources[id]
        const shader = gl.createShader(id.includes('fragment') ? gl.FRAGMENT_SHADER : gl.VERTEX_SHADER)
        gl.shaderSource(shader, source)
        gl.compileShader(shader)

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.log('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader))
            return null
        }

        return shader
    }

    getProgram(gl: WebGLRenderingContext, vid: keyof ShaderSources, fid: keyof ShaderSources): WebGLProgram {
        const fsh = this.getShader(gl, fid)
        const vsh = this.getShader(gl, vid)
        const program = gl.createProgram()
        gl.attachShader(program, vsh)
        gl.attachShader(program, fsh)
        gl.linkProgram(program)

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.log('Unable to initialize the shader program.')
            return null
        }

        return program
    }

    clear(): void {
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT)
    }

    renderLitFloorCPU(tileMap: TileMap, useColorTable = true) {
        Lightmap.rebuildDynamicLight()

        // initialize color tables if necessary (TODO: hack, should be initialized elsewhere)
        if (useColorTable) {
            if (Lighting.colorLUT === null) {
                Lighting.colorLUT = getFileJSON('lut/color_lut.json')
                Lighting.colorRGB = getFileJSON('lut/color_rgb.json')
            }
        }

        const gl = this.gl

        // use floor light shader
        gl.useProgram(this.floorLightShader)
        gl.uniform1i(this.uUseGPULighting, 0)
        gl.uniform1f(this.uAmbient, 40960.0 / 65536.0)

        // bind buffers
        gl.bindBuffer(gl.ARRAY_BUFFER, this.tileBuffer)
        gl.uniform2f(this.litScaleLocation, 80, 36)

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
                    scr.x >= globalState.cameraPosition.x + SCREEN_WIDTH ||
                    scr.y >= globalState.cameraPosition.y + SCREEN_HEIGHT
                ) {
                    continue
                }

                if (img !== lastTexture) {
                    gl.activeTexture(gl.TEXTURE0)

                    // TODO: uses hack
                    const texture = this.getTextureFromHack(img)
                    if (!texture) {
                        console.log('skipping tile without a texture: ' + img)
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
                    scr.x - globalState.cameraPosition.x,
                    scr.y - globalState.cameraPosition.y
                )
                gl.drawArrays(gl.TRIANGLES, 0, 6)
            }
        }

        gl.activeTexture(gl.TEXTURE0)

        // use normal shader
        gl.useProgram(this.tileShader)
    }

    /**
     * Render unlit floor tiles into the offscreen FBO.
     * Called only when the camera position changes (or FBO is stale).
     * The result is cached and reused across frames until the camera moves again.
     */
    private _renderFloorTilesIntoFBO(tileMap: TileMap): void {
        const gl = this.gl
        const cameraX = this.floorFBOCameraX
        const cameraY = this.floorFBOCameraY

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.floorFBO)
        gl.viewport(0, 0, this.canvas.width, this.canvas.height)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        // No depth attachment on the FBO — disable depth test so all tiles draw
        gl.disable(gl.DEPTH_TEST)

        gl.useProgram(this.tileShader)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.tileBuffer)
        gl.uniform1f(this.uNumFramesLocation, 1)
        gl.uniform1f(this.uFrameLocation, 0)
        gl.uniform2f(this.uScaleLocation, TILE_WIDTH, TILE_HEIGHT)

        for (let i = tileMap.length - 1; i >= 0; i--) {
            for (let j = 0; j < tileMap[0].length; j++) {
                const tile = tileMap[j][i]
                if (tile === 'grid000') continue
                const scr = tileToScreen(i, j)
                if (
                    scr.x + TILE_WIDTH < cameraX ||
                    scr.y + TILE_HEIGHT < cameraY ||
                    scr.x >= cameraX + SCREEN_WIDTH ||
                    scr.y >= cameraY + SCREEN_HEIGHT
                ) continue

                const img = 'art/tiles/' + tile
                const texture = this.getTextureFromHack(img)
                if (!texture) continue

                gl.activeTexture(gl.TEXTURE0)
                gl.bindTexture(gl.TEXTURE_2D, texture)
                gl.uniform2f(this.offsetLocation, scr.x - cameraX, scr.y - cameraY)
                gl.drawArrays(gl.TRIANGLES, 0, 6)
            }
        }

        // Restore main framebuffer state
        gl.enable(gl.DEPTH_TEST)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.viewport(0, 0, this.canvas.width, this.canvas.height)
        gl.clearColor(0.75, 0.75, 0.75, 1.0)
    }

    renderLitFloorGPU(tileMap: TileMap) {
        // 1. Rebuild dynamic (critter) lights — fast no-op if no emitters exist
        Lightmap.rebuildDynamicLight()

        const gl = this.gl
        const cameraX = globalState.cameraPosition.x
        const cameraY = globalState.cameraPosition.y

        // 2. Upload tile intensity texture only when the lightmap data has changed
        if (this.lastLightmapVersion !== Lightmap.lightmapVersion) {
            const td = this.tileData
            const ti = Lightmap.tile_intensity
            for (let i = 0; i < 40000; i++) {
                td[i] = Math.round(Math.min(ti[i], 65536) / 65536.0 * 255)
            }
            gl.activeTexture(gl.TEXTURE5)
            gl.bindTexture(gl.TEXTURE_2D, this.tileIntensityTexture)
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 200, 200, gl.RED, gl.UNSIGNED_BYTE, td)
            this.lastLightmapVersion = Lightmap.lightmapVersion
        }

        // 3. Re-render floor tiles into FBO only when camera moves or FBO is stale
        if (this.floorFBO !== null &&
            (this.floorFBODirty || cameraX !== this.floorFBOCameraX || cameraY !== this.floorFBOCameraY)) {
            this.floorFBOCameraX = cameraX
            this.floorFBOCameraY = cameraY
            this.floorFBODirty = false
            this._renderFloorTilesIntoFBO(tileMap)
        }

        // 4. Single fullscreen quad pass: multiply cached floor texture by the lightmap.
        //    getGPULightIntensity() in the shader uses gl_FragCoord to look up the correct
        //    hex-tile intensity for every pixel — no per-tile uniforms needed.
        gl.useProgram(this.floorLightShader)

        // Rebind vertex attributes for floorLightShader
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer)
        gl.enableVertexAttribArray(this.litTexCoordLoc)
        gl.vertexAttribPointer(this.litTexCoordLoc, 2, gl.FLOAT, false, 0, 0)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.tileBuffer)
        gl.enableVertexAttribArray(this.litPositionLoc)
        gl.vertexAttribPointer(this.litPositionLoc, 2, gl.FLOAT, false, 0, 0)

        gl.uniform1i(this.uUseGPULighting, 1)
        gl.uniform1f(this.uAmbient, 40960.0 / 65536.0)
        gl.uniform2f(this.uCamera, cameraX, cameraY)
        gl.uniform1f(this.uDpr, window.devicePixelRatio || 1)
        gl.uniform1i(gl.getUniformLocation(this.floorLightShader, 'u_tileIntensity'), 5)

        // Bind the cached floor FBO texture as the tile image source
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, this.floorFBOTexture)
        gl.uniform1i(gl.getUniformLocation(this.floorLightShader, 'u_image'), 0)

        // Draw fullscreen quad covering the entire screen
        gl.uniform2f(this.litOffsetLocation, 0, 0)
        gl.uniform2f(this.litScaleLocation, SCREEN_WIDTH, SCREEN_HEIGHT)
        gl.drawArrays(gl.TRIANGLES, 0, 6)

        gl.activeTexture(gl.TEXTURE0)
        gl.useProgram(this.tileShader)
    }

    drawTileMap(tilemap: TileMap, offsetY: number): void {
        const gl = this.gl
        this.gl.useProgram(this.tileShader)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.tileBuffer)
        gl.uniform1f(this.uNumFramesLocation, 1)
        gl.uniform1f(this.uFrameLocation, 0)
        gl.uniform2f(this.uScaleLocation, 80, 36)

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
                    scr.x >= globalState.cameraPosition.x + SCREEN_WIDTH ||
                    scr.y >= globalState.cameraPosition.y + SCREEN_HEIGHT
                ) {
                    continue
                }

                // TODO: uses hack
                const texture = this.getTextureFromHack(img)
                if (!texture) {
                    console.log('skipping tile without a texture: ' + img)
                    continue
                }
                gl.bindTexture(gl.TEXTURE_2D, texture)

                // draw
                gl.uniform2f(
                    this.offsetLocation,
                    scr.x - globalState.cameraPosition.x,
                    scr.y - globalState.cameraPosition.y
                )
                gl.drawArrays(gl.TRIANGLES, 0, 6)
            }
        }
    }

    renderRoof(roof: TileMap): void {
        this.drawTileMap(roof, -96)
    }

    renderFloor(floor: TileMap): void {
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

    setLightingMode(mode: 'gpu' | 'cpu'): void {
        this.floorLightingMode = mode
    }

    renderObject(obj: Obj): void {
        const renderInfo = this.objectRenderInfo(obj)
        if (!renderInfo || !renderInfo.visible) {
            return
        }
        this.renderFrame(
            obj.art,
            renderInfo.x - globalState.cameraPosition.x,
            renderInfo.y - globalState.cameraPosition.y,
            renderInfo.uniformFrameWidth,
            renderInfo.uniformFrameHeight,
            renderInfo.artInfo.totalFrames,
            renderInfo.spriteFrameNum
        )
    }

    renderObjectOutlined(obj: Obj): void {
        this.renderObject(obj)
    }

    renderFrame(
        imgPath: string,
        x: number,
        y: number,
        width: number,
        height: number,
        totalFrames: number,
        frame: number
    ): void {
        // TODO: uses hack
        const texture = this.getTextureFromHack(imgPath)
        if (!texture) {
            console.log('no texture for object')
            return
        }

        const gl = this.gl
        this.gl.useProgram(this.tileShader)

        // draw
        gl.bindTexture(gl.TEXTURE_2D, texture)

        gl.uniform1f(this.uNumFramesLocation, totalFrames)
        gl.uniform1f(this.uFrameLocation, frame)

        gl.uniform2f(this.offsetLocation, x, y)
        gl.uniform2f(this.uScaleLocation, width, height)

        gl.drawArrays(gl.TRIANGLES, 0, 6)
    }

    renderImage(imgPath: string, x: number, y: number, width: number, height: number): void {
        this.renderFrame(imgPath, x, y, width, height, 1, 0)
    }

    renderFont(font: Font, x: number, y: number) {
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

        gl.drawArrays(gl.TRIANGLES, 0, 6)
    }
}
