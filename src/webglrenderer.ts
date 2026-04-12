import { heart } from './heart.js'
import { hexFromScreen } from './geometry.js'
import globalState from './globalState.js'
import * as GameTime from './gametime.js'
import { Lighting } from './lighting.js'
import { Lightmap } from './lightmap.js'
import { Obj } from './object.js'
import { Renderer, SCREEN_HEIGHT, SCREEN_WIDTH, TileMap } from './renderer.js'
import { tileToScreen, toTileNum, TILE_HEIGHT, TILE_WIDTH } from './tile.js'
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

    private tileIntensityTexture: WebGLTexture | null = null // 200x200 R8 texture for GPU path
    private floorLightingMode: 'gpu' | 'cpu' = 'cpu'
    private uUseGPULighting: WebGLUniformLocation | null = null

    // Tile shader world-lighting uniforms. The tile shader now samples the
    // same 200×200 tile-intensity texture (unit 5) the floor light shader
    // uses, so walls / objects / critters / roofs darken at night and
    // brighten in the player spotlight the same way the floor does. UI
    // draws bypass lighting by pushing u_ambient = 1.0.
    private uTileAmbient: WebGLUniformLocation | null = null
    private uTileCamera: WebGLUniformLocation | null = null

    // Last ambient value pushed to u_ambient; used to log transitions so we
    // can verify day/night changes are actually reaching the shader without
    // spamming one line per frame.
    private lastLoggedAmbient = -1
    private tileLightingLoggedOnce = false

    // FBO for cached unlit floor rendering (GPU lighting mode)
    private floorFBO: WebGLFramebuffer | null = null
    private floorFBOTexture: WebGLTexture | null = null
    private floorFBOValid = false
    private lastFloorCameraX = -Infinity
    private lastFloorCameraY = -Infinity
    private lastFloorTileMap: TileMap | null = null
    private tileDataBuffer = new Uint8Array(200 * 200)
    private compositeTexCoordBuffer: WebGLBuffer // Y-flipped UVs for FBO composite
    private uAmbient: WebGLUniformLocation | null = null
    private uCamera: WebGLUniformLocation | null = null
    private uScreenResolutionLighting: WebGLUniformLocation | null = null

    private textures: { [key: string]: WebGLTexture } = {} // WebGL texture cache

    private textCanvas: HTMLCanvasElement
    private textCtx: CanvasRenderingContext2D

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

        // Set up 2D text overlay canvas
        this.textCanvas = document.getElementById('textOverlay') as HTMLCanvasElement
        this.textCtx = this.textCanvas.getContext('2d')!

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

        // --- Tile shader world-lighting uniforms ---
        // Allocated unconditionally so walls / objects / critters / roofs
        // still react to u_ambient (night/day) even when the full floor
        // lighting system is disabled. When doFloorLighting is off the
        // tile-intensity texture stays all-zero, and max(0, u_ambient) in
        // the shader degrades gracefully to "ambient only".
        this.tileIntensityTexture = gl.createTexture()
        gl.activeTexture(gl.TEXTURE5)
        gl.bindTexture(gl.TEXTURE_2D, this.tileIntensityTexture)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.R8,
            200,
            200,
            0,
            gl.RED,
            gl.UNSIGNED_BYTE,
            new Uint8Array(40000), // deterministic-zero so UI draws before any world draw sample 0 → max(0, ambient) = ambient
        )

        gl.useProgram(this.tileShader)
        this.uTileAmbient = gl.getUniformLocation(this.tileShader, 'u_ambient')
        this.uTileCamera = gl.getUniformLocation(this.tileShader, 'u_camera')
        const uTileTileIntensity = gl.getUniformLocation(this.tileShader, 'u_tileIntensity')
        const uTileScreenResolution = gl.getUniformLocation(this.tileShader, 'u_screenResolution')
        console.log(
            `[lighting/init] tileShader uniforms — u_ambient=${this.uTileAmbient !== null}, ` +
            `u_camera=${this.uTileCamera !== null}, u_tileIntensity=${uTileTileIntensity !== null}, ` +
            `u_screenResolution=${uTileScreenResolution !== null}, ` +
            `canvasSize=${this.canvas.width}x${this.canvas.height}`
        )
        gl.uniform1i(uTileTileIntensity, 5)
        gl.uniform2f(uTileScreenResolution, this.canvas.width, this.canvas.height)
        // Seed: any UI draw that happens before the first lit draw must NOT
        // get darkened. max(sample, 1.0) = 1.0, so ambient=1 disables the
        // multiply at init time.
        gl.uniform1f(this.uTileAmbient, 1.0)
        gl.uniform2f(this.uTileCamera, 0.0, 0.0)
        gl.activeTexture(gl.TEXTURE0)

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

            // set up light buffer texture
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

            // Floor shader samples the same 200×200 tile intensity texture
            // (already created above and bound to unit 5 for the tile shader).
            gl.useProgram(this.floorLightShader)
            gl.uniform1i(gl.getUniformLocation(this.floorLightShader, 'u_tileIntensity'), 5)

            // get uniform locations
            this.uUseGPULighting = gl.getUniformLocation(this.floorLightShader, 'u_useGPULighting')
            this.uAmbient = gl.getUniformLocation(this.floorLightShader, 'u_ambient')
            this.uCamera = gl.getUniformLocation(this.floorLightShader, 'u_camera')
            this.uScreenResolutionLighting = gl.getUniformLocation(this.floorLightShader, 'u_screenResolution')
            gl.uniform2f(this.uScreenResolutionLighting, this.canvas.width, this.canvas.height)

            // Create floor FBO for caching unlit floor tiles (GPU lighting mode)
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
            gl.bindFramebuffer(gl.FRAMEBUFFER, null)

            // Y-flipped texcoord buffer for FBO composite (vertex shader flips Y in clip space,
            // so the FBO stores the scene upside-down relative to texture V; flip V to compensate)
            this.compositeTexCoordBuffer = gl.createBuffer()
            gl.bindBuffer(gl.ARRAY_BUFFER, this.compositeTexCoordBuffer)
            gl.bufferData(
                gl.ARRAY_BUFFER,
                new Float32Array([0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.0]),
                gl.STATIC_DRAW
            )

            gl.activeTexture(gl.TEXTURE0)
            gl.useProgram(this.tileShader)
        }
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
        // Clear the 2D text overlay each frame
        this.textCtx.clearRect(0, 0, this.textCanvas.width, this.textCanvas.height)
    }

    renderText(txt: string, x: number, y: number): void {
        const ctx = this.textCtx
        ctx.font = '16px "VT323", monospace'
        ctx.fillStyle = '#00ff00'
        ctx.textAlign = 'center'
        ctx.strokeStyle = 'black'
        ctx.lineWidth = 2
        ctx.strokeText(txt, x, y)
        ctx.fillText(txt, x, y)
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
            console.log(`[lighting/cpu] u_ambient = ${ambientCPU.toFixed(3)} (hour ${GameTime.getHour()}:${String(GameTime.getMinute()).padStart(2,'0')})`)
            this.lastLoggedAmbient = ambientCPU
        }

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

    renderLitFloorGPU(tileMap: TileMap) {
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

    private renderFloorToFBO(tileMap: TileMap): void {
        const gl = this.gl
        const cameraX = globalState.cameraPosition.x
        const cameraY = globalState.cameraPosition.y

        // Skip re-rendering if FBO is still valid (camera hasn't moved, same tilemap)
        if (
            this.floorFBOValid &&
            cameraX === this.lastFloorCameraX &&
            cameraY === this.lastFloorCameraY &&
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
        gl.uniform2f(this.uScaleLocation, TILE_WIDTH, TILE_HEIGHT)
        // The FBO is the unlit floor cache. compositeFloorWithLighting()
        // applies the real ambient + tile intensity via floorLightShader
        // afterwards, so bake the floor with ambient = 1 here to avoid
        // double-lighting it.
        this.setTileLighting(false)

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
                    scr.x >= cameraX + SCREEN_WIDTH ||
                    scr.y >= cameraY + SCREEN_HEIGHT
                ) {
                    continue
                }

                if (img !== lastTexture) {
                    const texture = this.getTextureFromHack(img)
                    if (!texture) continue
                    gl.bindTexture(gl.TEXTURE_2D, texture)
                    lastTexture = img
                }

                gl.uniform2f(this.offsetLocation, scr.x - cameraX, scr.y - cameraY)
                gl.drawArrays(gl.TRIANGLES, 0, 6)
            }
        }

        // Restore state
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.clearColor(0.75, 0.75, 0.75, 1.0)
        gl.enable(gl.DEPTH_TEST)

        this.lastFloorCameraX = cameraX
        this.lastFloorCameraY = cameraY
        this.lastFloorTileMap = tileMap
        this.floorFBOValid = true
    }

    private compositeFloorWithLighting(): void {
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
            console.log(`[lighting/gpu] u_ambient = ${ambientGPU.toFixed(3)} (hour ${GameTime.getHour()}:${String(GameTime.getMinute()).padStart(2,'0')})`)
            this.lastLoggedAmbient = ambientGPU
        }
        gl.uniform2f(this.litScaleLocation, SCREEN_WIDTH, SCREEN_HEIGHT)
        gl.uniform2f(this.uCamera, globalState.cameraPosition.x, globalState.cameraPosition.y)
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
    }

    invalidateFloorFBO(): void {
        this.floorFBOValid = false
    }

    drawTileMap(tilemap: TileMap, offsetY: number): void {
        const gl = this.gl
        this.gl.useProgram(this.tileShader)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.tileBuffer)
        gl.uniform1f(this.uNumFramesLocation, 1)
        gl.uniform1f(this.uFrameLocation, 0)
        gl.uniform2f(this.uScaleLocation, 80, 36)

        // Roofs and fallback (unlit) floors are world geometry — react to
        // day/night + per-tile intensity like everything else on the map.
        this.setTileLighting(true)

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
                gl.activeTexture(gl.TEXTURE0)
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
            renderInfo.spriteFrameNum,
            /*lit*/ true
        )
    }

    renderObjectOutlined(obj: Obj): void {
        this.renderObject(obj)
    }

    // Push the tile-shader world-lighting uniforms. `lit=true` gives the
    // draw the live day/night ambient and camera position; `lit=false`
    // sets u_ambient=1.0 which makes max(tileSample, 1.0) always 1.0,
    // i.e. no darkening (used by UI / HUD / PipBoy / fonts).
    private setTileLighting(lit: boolean): void {
        const gl = this.gl
        if (lit) {
            const ambient = GameTime.getAmbientLightNormalized()
            if (!this.tileLightingLoggedOnce) {
                this.tileLightingLoggedOnce = true
                console.log(
                    `[setTileLighting] FIRST CALL — ambient=${ambient.toFixed(3)}, ` +
                    `uTileAmbient=${this.uTileAmbient}, uTileCamera=${this.uTileCamera}, ` +
                    `tileIntensityTex=${this.tileIntensityTexture}, ` +
                    `program=${gl.getParameter(gl.CURRENT_PROGRAM) === this.tileShader ? 'tileShader' : 'OTHER'}`
                )
            }
            gl.uniform1f(this.uTileAmbient, ambient)
            gl.uniform2f(this.uTileCamera, globalState.cameraPosition.x, globalState.cameraPosition.y)
            // Re-bind tileIntensityTexture to unit 5 — other draw calls
            // (compositeFloorWithLighting, renderFloorToFBO, etc.) may have
            // disturbed the binding on that unit.
            gl.activeTexture(gl.TEXTURE5)
            gl.bindTexture(gl.TEXTURE_2D, this.tileIntensityTexture)
            gl.activeTexture(gl.TEXTURE0) // restore default unit
        } else {
            gl.uniform1f(this.uTileAmbient, 1.0)
        }
    }

    renderFrame(
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
            console.log('no texture for object')
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

    renderImage(imgPath: string, x: number, y: number, width: number, height: number): void {
        // UI path — never darkened by ambient.
        this.renderFrame(imgPath, x, y, width, height, 1, 0, /*lit*/ false)
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

        // Text is UI — keep ambient = 1 so letters stay legible at night.
        this.setTileLighting(false)

        gl.drawArrays(gl.TRIANGLES, 0, 6)
    }
}
