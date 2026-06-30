import { heart } from '../heart.js'
import globalState from '../globalState.js'
import * as GameTime from '../gametime.js'
import { getZoom, Renderer, SCREEN_HEIGHT, SCREEN_WIDTH, TileMap } from '../renderer.js'
import { Config } from '../config.js'
import { Font } from '../formats/fon.js'
import { dbg } from '../logger.js'

export interface ShaderSources {
    fragment: string
    vertex: string
    fragmentLighting: string
    fragmentFont: string
}

export class WebGLRenderer extends Renderer {
    canvas: HTMLCanvasElement
    gl: WebGL2RenderingContext
    offsetLocation: WebGLUniformLocation
    positionLocation: number
    texCoordLocation: number
    uScaleLocation: WebGLUniformLocation
    uNumFramesLocation: WebGLUniformLocation
    uFrameLocation: WebGLUniformLocation
    objectUVBuffer: WebGLBuffer
    texCoordBuffer: WebGLBuffer
    tileBuffer: WebGLBuffer
    tileShader: WebGLProgram

    fontShader: WebGLProgram

    uLightBuffer: WebGLUniformLocation
    litOffsetLocation: WebGLUniformLocation
    litScaleLocation: WebGLUniformLocation
    lightBufferTexture: WebGLTexture
    floorLightShader: WebGLProgram

    tileIntensityTexture: WebGLTexture | null = null // 200x200 R8 texture for GPU path
    floorLightingMode: 'gpu' | 'cpu' = 'cpu'
    uUseGPULighting: WebGLUniformLocation | null = null

    // Tile shader world-lighting uniforms. The tile shader now samples the
    // same 200×200 tile-intensity texture (unit 5) the floor light shader
    // uses, so walls / objects / critters / roofs darken at night and
    // brighten in the player spotlight the same way the floor does. UI
    // draws bypass lighting by pushing u_ambient = 1.0.
    uTileAmbient: WebGLUniformLocation | null = null
    uTileCamera: WebGLUniformLocation | null = null
    roofDummyTexture: WebGLTexture | null = null // 1x1 R8 = 0, used for roof draws

    // Last ambient value pushed to u_ambient; used to log transitions so we
    // can verify day/night changes are actually reaching the shader without
    // spamming one line per frame.
    lastLoggedAmbient = -1
    tileLightingLoggedOnce = false

    // Zoom uniforms on each shader. World draws push the current zoom so
    // the fragment shaders compute world coords as
    // `u_camera + gl_FragCoord / (dpr * u_zoom)` for per-pixel tile-light
    // lookup. UI draws (ambient=1) don't care about the zoom value.
    uTileZoom: WebGLUniformLocation | null = null
    uFloorLightZoom: WebGLUniformLocation | null = null
    uAlpha: WebGLUniformLocation | null = null
    uEggMode: WebGLUniformLocation | null = null
    uEggCenter: WebGLUniformLocation | null = null
    uEggSize: WebGLUniformLocation | null = null
    eggTexture: WebGLTexture | null = null
    eggWidth = 0
    eggHeight = 0
    uOutlineMode: WebGLUniformLocation | null = null
    uOutlineColor: WebGLUniformLocation | null = null
    uOutlineAlpha: WebGLUniformLocation | null = null
    uObjectLight: WebGLUniformLocation | null = null

    // Resolution uniforms stashed at init-time so resize() can re-upload them
    // (they are set once in init() and then re-read by the fragment shader
    // every frame via uniform state).
    uTileResolution: WebGLUniformLocation | null = null
    uTileScreenResolutionLoc: WebGLUniformLocation | null = null
    uFloorLightResolution: WebGLUniformLocation | null = null

    // FBO for cached unlit floor rendering (GPU lighting mode)
    floorFBO: WebGLFramebuffer | null = null
    floorFBOTexture: WebGLTexture | null = null
    floorFBOValid = false
    lastFloorCameraX = -Infinity
    lastFloorCameraY = -Infinity
    lastFloorZoom = -Infinity
    lastFloorTileMap: TileMap | null = null
    tileDataBuffer = new Uint8Array(200 * 200)
    compositeTexCoordBuffer: WebGLBuffer // Y-flipped UVs for FBO composite
    uAmbient: WebGLUniformLocation | null = null
    uCamera: WebGLUniformLocation | null = null
    uScreenResolutionLighting: WebGLUniformLocation | null = null

    textures: { [key: string]: WebGLTexture } = {} // WebGL texture cache

    textCanvas: HTMLCanvasElement
    textCtx: CanvasRenderingContext2D

    constructor(public shaderSources: ShaderSources, fonts: Font[]) {
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

    // CE ref: object.cc:352 — egg FID is OBJ_TYPE_INTERFACE #2 (art/intrface/egg.frm).
    // Load the egg mask as a WebGL texture on unit 6.
    //
    // Step 1 (synchronous): build a procedural elliptical gradient so egg mode
    // works from the very first frame regardless of whether egg.png has loaded.
    // Same encoding as export_mask_frms.py: center → alpha≈255 → mix(1,0,1)=0
    // → transparent; edge → alpha=0 → opaque. CE egg.frm is 129×98 px.
    //
    // Step 2 (async): try to upgrade to the CE-accurate FRM-derived gradient
    // from art/intrface/egg.png. If the file is missing or fails, the
    // procedural fallback stays active — no flat-alpha regression.
    _loadEggTexture(): void {
        const gl = this.gl
        const W = 129, H = 98  // CE egg.frm dimensions
        const cx = (W - 1) / 2, cy = (H - 1) / 2
        const rx = W / 2, ry = H / 2
        const data = new Uint8Array(W * H * 4)
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const nx = (x - cx) / rx, ny = (y - cy) / ry
                const dist = Math.sqrt(nx * nx + ny * ny)
                // Linear gradient: center=255 (transparent), edge=0 (opaque).
                const a = dist < 1.0 ? Math.round((1.0 - dist) * 255) : 0
                const i = (y * W + x) * 4
                data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = a
            }
        }
        const tex = gl.createTexture()
        gl.activeTexture(gl.TEXTURE6)
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
        gl.activeTexture(gl.TEXTURE0)
        this.eggTexture = tex
        this.eggWidth = W
        this.eggHeight = H
        gl.useProgram(this.tileShader)
        if (this.uEggSize) gl.uniform2f(this.uEggSize, W, H)
        console.log(`[Egg] procedural ellipse ready ${W}x${H}; loading egg.png for CE-accurate gradient`)

        // Upgrade to CE-accurate FRM-derived gradient asynchronously
        const img = new Image()
        img.onload = () => {
            const tex2 = gl.createTexture()
            gl.activeTexture(gl.TEXTURE6)
            gl.bindTexture(gl.TEXTURE_2D, tex2)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
            gl.activeTexture(gl.TEXTURE0)
            this.eggTexture = tex2
            this.eggWidth = img.naturalWidth
            this.eggHeight = img.naturalHeight
            gl.useProgram(this.tileShader)
            if (this.uEggSize) gl.uniform2f(this.uEggSize, img.naturalWidth, img.naturalHeight)
            console.log(`[Egg] upgraded to CE-accurate egg.png: ${img.naturalWidth}x${img.naturalHeight}`)
        }
        img.onerror = () => {
            console.warn('[Egg] egg.png not found — procedural ellipse fallback stays active')
        }
        // Bump the version string whenever egg.png is regenerated via
        // tools/export_mask_frms.py so the browser discards the cached copy.
        img.src = 'art/intrface/egg.png?v=20260623b'
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

        // Mirror the DPR scaling on the 2D text overlay so text stays sharp on
        // HiDPI/Retina displays. The 2D context is scaled by dpr so callers
        // continue to draw in logical (CSS) coordinates.
        const textCssWidth = this.textCanvas.width
        const textCssHeight = this.textCanvas.height
        this.textCanvas.style.width = textCssWidth + 'px'
        this.textCanvas.style.height = textCssHeight + 'px'
        this.textCanvas.width = Math.round(textCssWidth * dpr)
        this.textCanvas.height = Math.round(textCssHeight * dpr)
        this.textCtx.setTransform(1, 0, 0, 1, 0, 0)
        this.textCtx.scale(dpr, dpr)

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
        this.uTileResolution = resolutionLocation

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
        // LINEAR: object sprites use the per-object u_objectLight uniform and
        // never sample this texture, so bilinear blending between hex values
        // only affects floor tiles — where the smooth wash between differently-lit
        // hexes is the desired look.
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
        this.uTileZoom = gl.getUniformLocation(this.tileShader, 'u_zoom')
        const uTileTileIntensity = gl.getUniformLocation(this.tileShader, 'u_tileIntensity')
        const uTileScreenResolution = gl.getUniformLocation(this.tileShader, 'u_screenResolution')
        this.uTileScreenResolutionLoc = uTileScreenResolution
        dbg('renderer',
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
        if (this.uTileZoom) gl.uniform1f(this.uTileZoom, 1.0)
        this.uAlpha = gl.getUniformLocation(this.tileShader, 'u_alpha')
        if (this.uAlpha) gl.uniform1f(this.uAlpha, 1.0)
        this.uEggMode = gl.getUniformLocation(this.tileShader, 'u_eggMode')
        this.uEggCenter = gl.getUniformLocation(this.tileShader, 'u_eggCenter')
        this.uEggSize = gl.getUniformLocation(this.tileShader, 'u_eggSize')
        if (this.uEggMode) gl.uniform1i(this.uEggMode, 0)
        // Bind egg texture to unit 6 — loaded asynchronously after init
        gl.uniform1i(gl.getUniformLocation(this.tileShader, 'u_eggTex'), 6)
        this._loadEggTexture()

        this.uOutlineMode = gl.getUniformLocation(this.tileShader, 'u_outlineMode')
        this.uOutlineColor = gl.getUniformLocation(this.tileShader, 'u_outlineColor')
        this.uOutlineAlpha = gl.getUniformLocation(this.tileShader, 'u_outlineAlpha')
        if (this.uOutlineMode) gl.uniform1i(this.uOutlineMode, 0)
        if (this.uOutlineAlpha) gl.uniform1f(this.uOutlineAlpha, 1.0)
        this.uObjectLight = gl.getUniformLocation(this.tileShader, 'u_objectLight')
        // -1.0 = per-fragment world-position fallback (floor tiles, UI draws)
        if (this.uObjectLight) gl.uniform1f(this.uObjectLight, -1.0)

        // 1×1 R8 dummy texture (value 0) for roof draws — roofs are
        // sky-facing and should be lit by ambient only, not by floor
        // spotlights below them. Binding this on unit 5 during roof
        // draws makes the shader return max(0, u_ambient) = ambient.
        this.roofDummyTexture = gl.createTexture()
        gl.activeTexture(gl.TEXTURE6) // use a scratch unit to avoid disturbing unit 5
        gl.bindTexture(gl.TEXTURE_2D, this.roofDummyTexture)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]))

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
            this.uFloorLightResolution = litResolutionLocation

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
            dbg('renderer', '[Lighting] mode:', this.floorLightingMode)

            // Floor shader samples the same 200×200 tile intensity texture
            // (already created above and bound to unit 5 for the tile shader).
            gl.useProgram(this.floorLightShader)
            gl.uniform1i(gl.getUniformLocation(this.floorLightShader, 'u_tileIntensity'), 5)

            // get uniform locations
            this.uUseGPULighting = gl.getUniformLocation(this.floorLightShader, 'u_useGPULighting')
            this.uAmbient = gl.getUniformLocation(this.floorLightShader, 'u_ambient')
            this.uCamera = gl.getUniformLocation(this.floorLightShader, 'u_camera')
            this.uFloorLightZoom = gl.getUniformLocation(this.floorLightShader, 'u_zoom')
            this.uScreenResolutionLighting = gl.getUniformLocation(this.floorLightShader, 'u_screenResolution')
            gl.uniform2f(this.uScreenResolutionLighting, this.canvas.width, this.canvas.height)
            if (this.uFloorLightZoom) gl.uniform1f(this.uFloorLightZoom, 1.0)

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
            dbg('renderer', 'An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader))
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
            dbg('renderer', 'Unable to initialize the shader program.')
            return null
        }

        return program
    }

    clear(): void {
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT)
        // Clear the 2D text overlay each frame
        this.textCtx.clearRect(0, 0, this.textCanvas.width, this.textCanvas.height)
    }

    // Push the tile-shader world-lighting uniforms. `lit=true` gives the
    // draw the live day/night ambient and camera position; `lit=false`
    // sets u_ambient=1.0 which makes max(tileSample, 1.0) always 1.0,
    // i.e. no darkening (used by UI / HUD / PipBoy / fonts).
    setTileLighting(lit: boolean): void {
        const gl = this.gl
        if (lit) {
            const ambient = GameTime.getAmbientLightNormalized()
            if (!this.tileLightingLoggedOnce) {
                this.tileLightingLoggedOnce = true
                dbg('renderer',
                    `[setTileLighting] FIRST CALL — ambient=${ambient.toFixed(3)}, ` +
                    `uTileAmbient=${this.uTileAmbient}, uTileCamera=${this.uTileCamera}, ` +
                    `tileIntensityTex=${this.tileIntensityTexture}, ` +
                    `program=${gl.getParameter(gl.CURRENT_PROGRAM) === this.tileShader ? 'tileShader' : 'OTHER'}`
                )
            }
            gl.uniform1f(this.uTileAmbient, ambient)
            gl.uniform2f(this.uTileCamera, globalState.cameraPosition.x, globalState.cameraPosition.y)
            // Zoom lets the fragment shader recover world coords from
            // gl_FragCoord for per-pixel tile-intensity sampling.
            if (this.uTileZoom) gl.uniform1f(this.uTileZoom, getZoom())
            // Re-bind tileIntensityTexture to unit 5 — other draw calls
            // (compositeFloorWithLighting, renderFloorToFBO, etc.) may have
            // disturbed the binding on that unit.
            gl.activeTexture(gl.TEXTURE5)
            gl.bindTexture(gl.TEXTURE_2D, this.tileIntensityTexture)
            gl.activeTexture(gl.TEXTURE0) // restore default unit
        } else {
            gl.uniform1f(this.uTileAmbient, 1.0)
            // UI draws don't sample world lighting (ambient=1 clamps to 1),
            // but keep u_zoom sane at 1.0 so any stray math stays stable.
            if (this.uTileZoom) gl.uniform1f(this.uTileZoom, 1.0)
        }
    }

    // Resize the WebGL canvas (and its companion text overlay) to new logical
    // dimensions. Called by the window.resize handler in main.ts after it has
    // updated SCREEN_WIDTH/SCREEN_HEIGHT via setScreenSize(). Uploads the new
    // resolution/screen-resolution uniforms to every world shader, reallocates
    // the floor FBO texture at the new physical size, and invalidates the FBO
    // cache so the next frame paints a fresh floor pass.
    resize(logicalWidth: number, logicalHeight: number): void {
        const gl = this.gl
        if (!gl) return

        const dpr = window.devicePixelRatio || 1
        const physWidth = Math.max(1, Math.round(logicalWidth * dpr))
        const physHeight = Math.max(1, Math.round(logicalHeight * dpr))

        // Main WebGL canvas: CSS size in logical pixels, backing store in
        // physical pixels. Heart's mouse tracking reads getBoundingClientRect
        // so CSS px is what the event handlers expect.
        this.canvas.style.width = logicalWidth + 'px'
        this.canvas.style.height = logicalHeight + 'px'
        this.canvas.width = physWidth
        this.canvas.height = physHeight
        gl.viewport(0, 0, physWidth, physHeight)

        // 2D text overlay — mirror the DPR trick so text stays crisp.
        if (this.textCanvas) {
            this.textCanvas.style.width = logicalWidth + 'px'
            this.textCanvas.style.height = logicalHeight + 'px'
            this.textCanvas.width = physWidth
            this.textCanvas.height = physHeight
            this.textCtx.setTransform(1, 0, 0, 1, 0, 0)
            this.textCtx.scale(dpr, dpr)
        }

        // Push new logical + physical resolution into every shader that
        // uses them. The tile shader's vertex path uses u_resolution to
        // project logical pixel coords into clip space; the lighting
        // fragment path uses both to map gl_FragCoord back to world space.
        gl.useProgram(this.tileShader)
        if (this.uTileResolution) gl.uniform2f(this.uTileResolution, logicalWidth, logicalHeight)
        if (this.uTileScreenResolutionLoc) gl.uniform2f(this.uTileScreenResolutionLoc, physWidth, physHeight)

        if (this.floorLightShader) {
            gl.useProgram(this.floorLightShader)
            if (this.uFloorLightResolution) gl.uniform2f(this.uFloorLightResolution, logicalWidth, logicalHeight)
            if (this.uScreenResolutionLighting) gl.uniform2f(this.uScreenResolutionLighting, physWidth, physHeight)
        }

        // Font shader shares the vertex program with the tile shader, so
        // u_resolution inside it is a separate uniform — reupload.
        if (this.fontShader) {
            gl.useProgram(this.fontShader)
            const fontRes = gl.getUniformLocation(this.fontShader, 'u_resolution')
            if (fontRes) gl.uniform2f(fontRes, logicalWidth, logicalHeight)
        }

        // Reallocate the floor FBO color attachment at the new backing size.
        // WebGL textures bound to FBOs must match the viewport; otherwise
        // the next composite draws garbage / nothing.
        if (this.floorFBOTexture) {
            gl.bindTexture(gl.TEXTURE_2D, this.floorFBOTexture)
            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.RGBA8,
                physWidth,
                physHeight,
                0,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                null,
            )
        }
        this.floorFBOValid = false

        gl.useProgram(this.tileShader)
    }

    setLightingMode(mode: 'gpu' | 'cpu'): void {
        this.floorLightingMode = mode
    }

    invalidateFloorFBO(): void {
        this.floorFBOValid = false
    }

    clearTileCache(): void {
        const fontKeys = new Set(this.fonts.map((f) => f.filepath))
        for (const key of Object.keys(this.textures)) {
            if (!fontKeys.has(key)) {
                delete this.textures[key]
            }
        }
        this.invalidateFloorFBO()
    }
}
