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
