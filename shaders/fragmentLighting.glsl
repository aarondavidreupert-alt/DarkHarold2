precision mediump float;
precision highp int;

uniform sampler2D u_image;
uniform sampler2D u_lightBuffer;
uniform sampler2D u_tileIntensity;   // 200x200 tile intensity map
uniform sampler2D u_screenLightmap;  // SCREEN_WIDTH x SCREEN_HEIGHT screen-space lightmap (mode 2)
uniform int u_useGPULighting;       // 0 = CPU lightbuffer, 1 = GPU tile-intensity, 2 = screen-space
uniform float u_ambient;            // minimum brightness floor (e.g. 40960/65536 ≈ 0.625)
uniform vec2 u_screenResolution;    // vec2(canvas_width, canvas_height) — physical pixels
uniform vec2 u_camera;              // world camera position (cameraX, cameraY)
uniform highp vec2 u_resolution;    // vec2(SCREEN_WIDTH, SCREEN_HEIGHT) — logical pixels (highp to match vertex shader)
uniform float u_zoom;               // world-space zoom factor (1.0 = no zoom)
uniform int u_lightInterp;          // tile-intensity interpolation mode (see sampleTileLight)

varying vec2 v_texCoord;

// Palette colour cycling for the CPU floor path (RD10) — mirrors shaders/fragment.glsl.
uniform sampler2D u_cycleMask;  // unit 7, (paletteIndex-228)/255 per pixel
uniform float u_cycleTime;      // seconds since page load
uniform int u_useCycleMask;     // 1 = sample u_cycleMask (per-tile CPU draws), 0 = composite of the cycled FBO

// CE ref: cycle.cc colorCycleTicker() — returns the animated RGB for a cycling palette entry.
// palIdx: raw Fallout 2 palette index (229-254).
// Colors are the CE source values after the >> 2 shift (6-bit) * 4 (to 8-bit), / 255 for GLSL.
// Rotation direction: CE decrements the start offset each tick, so display order reverses.
// Formula: displayed_color[palOffset] at tick f = colors[(palOffset - f + N) % N].
vec3 cycleColor(int palIdx, float t) {
    // slime: indices 229-232, 4 colors, slow (5fps)
    if (palIdx <= 232) {
        int off = palIdx - 229;
        int f = int(mod(t * 5.0, 4.0));
        int ci = int(mod(float(off - f + 400), 4.0));
        if (ci == 0) return vec3(0.0,        108.0/255.0, 0.0);
        if (ci == 1) return vec3(8.0/255.0,  112.0/255.0, 4.0/255.0);
        if (ci == 2) return vec3(24.0/255.0, 120.0/255.0, 12.0/255.0);
        return          vec3(40.0/255.0, 128.0/255.0, 24.0/255.0);
    }
    // monitors: indices 233-237, 5 colors, fast (10fps)
    if (palIdx <= 237) {
        int off = palIdx - 233;
        int f = int(mod(t * 10.0, 5.0));
        int ci = int(mod(float(off - f + 500), 5.0));
        if (ci == 0) return vec3(104.0/255.0, 104.0/255.0, 108.0/255.0);
        if (ci == 1) return vec3(96.0/255.0,  100.0/255.0, 124.0/255.0);
        if (ci == 2) return vec3(84.0/255.0,  104.0/255.0, 140.0/255.0);
        if (ci == 3) return vec3(0.0,         144.0/255.0, 160.0/255.0);
        return          vec3(104.0/255.0, 184.0/255.0, 252.0/255.0);
    }
    // fire_slow: indices 238-242, 5 colors, slow (5fps)
    if (palIdx <= 242) {
        int off = palIdx - 238;
        int f = int(mod(t * 5.0, 5.0));
        int ci = int(mod(float(off - f + 500), 5.0));
        if (ci == 0) return vec3(252.0/255.0, 0.0,         0.0);
        if (ci == 1) return vec3(212.0/255.0, 0.0,         0.0);
        if (ci == 2) return vec3(144.0/255.0, 40.0/255.0,  8.0/255.0);
        if (ci == 3) return vec3(252.0/255.0, 116.0/255.0, 0.0);
        return          vec3(252.0/255.0, 56.0/255.0,  0.0);
    }
    // fire_fast: indices 243-247, 5 colors, medium (7fps)
    if (palIdx <= 247) {
        int off = palIdx - 243;
        int f = int(mod(t * 7.0, 5.0));
        int ci = int(mod(float(off - f + 500), 5.0));
        if (ci == 0) return vec3(68.0/255.0,  0.0, 0.0);
        if (ci == 1) return vec3(120.0/255.0, 0.0, 0.0);
        if (ci == 2) return vec3(176.0/255.0, 0.0, 0.0);
        if (ci == 3) return vec3(120.0/255.0, 0.0, 0.0);
        return          vec3(68.0/255.0,  0.0, 0.0);
    }
    // shoreline: indices 248-253, 6 colors, slow (5fps)
    if (palIdx <= 253) {
        int off = palIdx - 248;
        int f = int(mod(t * 5.0, 6.0));
        int ci = int(mod(float(off - f + 600), 6.0));
        if (ci == 0) return vec3(80.0/255.0, 60.0/255.0, 40.0/255.0);
        if (ci == 1) return vec3(72.0/255.0, 56.0/255.0, 40.0/255.0);
        if (ci == 2) return vec3(64.0/255.0, 52.0/255.0, 36.0/255.0);
        if (ci == 3) return vec3(60.0/255.0, 48.0/255.0, 36.0/255.0);
        if (ci == 4) return vec3(52.0/255.0, 44.0/255.0, 32.0/255.0);
        return          vec3(48.0/255.0, 40.0/255.0, 32.0/255.0);
    }
    // bobber (palIdx == 254): red pulse 0→240→0, ~1-second period at 30fps step=16
    float phase = mod(t, 1.0);
    float red = (1.0 - abs(2.0 * phase - 1.0)) * (240.0/255.0);
    return vec3(red, 0.0, 0.0);
}

// --- Tile-intensity sampling with selectable interpolation (u_lightInterp) ---
// hexToScreen (src/geometry/hexScreen.ts) is a PER-COLUMN-PARITY affine map, so a
// plain gl.LINEAR sample blends texels across the hex stagger and produces NW-SE
// stripes. Modes (mirror in shaders/fragment.glsl; see wiki/alignment.md §7):
//   0 = off (NEAREST) / linear (LINEAR): single sample; the texture filter does it.
//   1 = column-center: quantize the hex COLUMN (u) to its cell centre, keep the row
//       (v) continuous so LINEAR blends only WITHIN a column — no cross-column bleed.
//   2 = hex-lerp: NEAREST + 3-tap barycentric blend over the 3 nearest hexes in
//       axial space (a parity-free lattice) — geometrically correct, smoothest.
//   3 = bicubic: NEAREST + 4-tap Catmull-Rom along the column; column locked to
//       centre, so it never crosses the stagger. Smoother falloff than linear.

// world pixel -> parity-correct continuous hex (col = hx, row = hy)
void worldToHex(highp float wx, highp float wy, out highp float hx, out highp float hy) {
    hx = 150.0416667 - (wx / 32.0 - wy / 24.0);
    float col = floor(hx + 0.5);
    float cy = (mod(col, 2.0) < 0.5) ? -75.9375 : -75.4375;
    hy = wx / 64.0 + wy / 16.0 + cy;
}

// integer axial (i along screen +E=(32,0), j along +SE=(16,12)) -> texel-centre UV.
// hexToScreen(0,0) = (4816, 11) is the lattice origin. Axial is parity-free.
highp vec2 axialToUV(highp float ai, highp float aj) {
    highp float sx = 4816.0 + 32.0 * ai + 16.0 * aj;
    highp float sy = 11.0 + 12.0 * aj;
    highp float hx; highp float hy;
    worldToHex(sx, sy, hx, hy);
    return (floor(vec2(hx, hy) + 0.5) + 0.5) / 200.0;
}

float sampleTileLight(highp float wx, highp float wy) {
    if (u_lightInterp == 2) {                       // hex-lerp
        highp float aj = (wy - 11.0) / 12.0;
        highp float ai = ((wx - 4816.0) - 16.0 * aj) / 32.0;
        highp float i0 = floor(ai);
        highp float j0 = floor(aj);
        highp float fi = ai - i0;
        highp float fj = aj - j0;
        highp vec2 uvA, uvB, uvC;
        float wA, wB, wC;
        if (fi + fj <= 1.0) {                        // lower triangle
            uvA = axialToUV(i0, j0);             wA = 1.0 - fi - fj;
            uvB = axialToUV(i0 + 1.0, j0);       wB = fi;
            uvC = axialToUV(i0, j0 + 1.0);       wC = fj;
        } else {                                    // upper triangle
            uvA = axialToUV(i0 + 1.0, j0 + 1.0); wA = fi + fj - 1.0;
            uvB = axialToUV(i0 + 1.0, j0);       wB = 1.0 - fj;
            uvC = axialToUV(i0, j0 + 1.0);       wC = 1.0 - fi;
        }
        return wA * texture2D(u_tileIntensity, uvA).r
             + wB * texture2D(u_tileIntensity, uvB).r
             + wC * texture2D(u_tileIntensity, uvC).r;
    }

    highp float hx; highp float hy;
    worldToHex(wx, wy, hx, hy);

    if (u_lightInterp == 1) {                       // column-center
        highp vec2 uv = (vec2(floor(hx + 0.5), hy) + 0.5) / 200.0;
        return texture2D(u_tileIntensity, uv).r;
    }

    if (u_lightInterp == 3) {                       // bicubic (Catmull-Rom down column)
        highp float col = floor(hx + 0.5);
        highp float r1 = floor(hy);
        float t = float(hy - r1);
        float t2 = t * t;
        float t3 = t2 * t;
        float w0 = 0.5 * (-t3 + 2.0 * t2 - t);
        float w1 = 0.5 * (3.0 * t3 - 5.0 * t2 + 2.0);
        float w2 = 0.5 * (-3.0 * t3 + 4.0 * t2 + t);
        float w3 = 0.5 * (t3 - t2);
        float s0 = texture2D(u_tileIntensity, (vec2(col, r1 - 1.0) + 0.5) / 200.0).r;
        float s1 = texture2D(u_tileIntensity, (vec2(col, r1) + 0.5) / 200.0).r;
        float s2 = texture2D(u_tileIntensity, (vec2(col, r1 + 1.0) + 0.5) / 200.0).r;
        float s3 = texture2D(u_tileIntensity, (vec2(col, r1 + 2.0) + 0.5) / 200.0).r;
        return w0 * s0 + w1 * s1 + w2 * s2 + w3 * s3;
    }

    // 0: off (NEAREST) / linear (LINEAR) — single sample
    return texture2D(u_tileIntensity, (vec2(hx, hy) + 0.5) / 200.0).r;
}

float getGPULightIntensity() {
    // Convert physical gl_FragCoord to logical screen pixels (accounts for high-DPI displays).
    // Then compute world position from camera + (screen offset / zoom), since every
    // on-screen pixel maps to `1/zoom` world units when the view is scaled.
    float dpr = u_screenResolution.x / u_resolution.x;
    float zoom = max(u_zoom, 0.0001);
    float world_x = u_camera.x + (gl_FragCoord.x / dpr) / zoom;
    float world_y = u_camera.y + (u_resolution.y - gl_FragCoord.y / dpr) / zoom;

    // Parity-correct hex sampling with selectable interpolation. The parity
    // fix (wiki/alignment.md §6) centres the light on the player's hex; the
    // interpolation mode (§7) controls how it blends between hexes.
    return sampleTileLight(world_x, world_y);
}

void main() {
    vec4 tileTexel = texture2D(u_image, v_texCoord);
    if (u_useCycleMask == 1) {
        int cycCode = int(texture2D(u_cycleMask, v_texCoord).r * 255.0 + 0.5);
        if (cycCode > 0) tileTexel.rgb = cycleColor(cycCode + 228, u_cycleTime);
    }

    float lightIntensity;
    if (u_useGPULighting == 2) {
        // Screen-space lightmap: sample directly using gl_FragCoord.
        vec2 screenUV = vec2(gl_FragCoord.x / u_screenResolution.x,
                             1.0 - gl_FragCoord.y / u_screenResolution.y);
        float lightVal = texture2D(u_screenLightmap, screenUV).r;
        float light = max(lightVal, u_ambient);
        gl_FragColor = vec4(tileTexel.rgb * light, tileTexel.a);
        return;
    } else if (u_useGPULighting == 1) {
        // tile-intensity path: continuous hex UV via gl_FragCoord, value normalised 0..1
        float light = max(getGPULightIntensity(), u_ambient);
        gl_FragColor = vec4(tileTexel.rgb * light, tileTexel.a);
        return;
    } else {
        // CPU path — per-tile 80x36 lightbuffer uploaded each tile
        lightIntensity = min(texture2D(u_lightBuffer, v_texCoord).r, 65536.0);
    }

    float light = max(lightIntensity / 65536.0, u_ambient);

    gl_FragColor = vec4(tileTexel.rgb * light, tileTexel.a);
}
