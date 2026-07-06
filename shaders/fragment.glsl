precision mediump float;
precision highp int;

uniform sampler2D u_image;
uniform float u_numFrames;
uniform float u_frame;

// World lighting — mirrors fragmentLighting.glsl's GPU path so walls,
// objects, critters, scenery and roofs darken at night and brighten in
// the player's spotlight exactly like the floor does.
//
// UI draws (HUD / PipBoy / text / fullscreen images) set u_ambient = 1.0,
// which makes `max(tileLight, u_ambient) = 1.0` for every pixel regardless
// of where in world-space the fragment coincidentally lands. So we don't
// need a separate branch for UI vs. world — the multiply just becomes a
// no-op when u_ambient = 1.
uniform float u_ambient;
uniform sampler2D u_tileIntensity;   // 200x200 R8 — shared with floor light shader on unit 5
uniform vec2 u_camera;               // world camera position (cameraX, cameraY)
uniform vec2 u_screenResolution;     // canvas physical pixels
uniform highp vec2 u_resolution;     // logical pixels (SCREEN_WIDTH, SCREEN_HEIGHT) — highp to match vertex shader
uniform float u_zoom;                // world-space zoom factor (1.0 = no zoom); UI draws leave this at 1.0
uniform float u_alpha;               // per-draw alpha multiplier (flat egg fallback = 0.4, normal = 1.0)
// CE ref: object.cc:5074 OBJECT_TRANS_GLASS — _dark_translucent_trans_buf_to_buf with
// _glassGrayTable (desaturate) + _glassBlendTable (_colorTable[10239] ≈ teal/cyan).
// When 1: desaturate texel to luma, then tint with the same teal blend.
uniform int u_stealth;               // 1 = Stealth Boy OBJECT_TRANS_GLASS desaturate+tint

// Object sprite lighting mode (DH2 extension of the CE per-object path):
// CE ref: object.cc:835 — one intensity per object tile, not per-fragment.
// DH2 extends this: world_x varies freely per-fragment (horizontal gradient),
// and world_y is clamped to ±6 world units of the sprite's anchor tile.
// ±6 world units = ±0.375 texels in the 200×200 tile-intensity texture
// (adjacent iso tiles are ~0.75 texels apart), so the LINEAR filter blends
// smoothly into neighbouring tiles at sprite edges without ever sampling the
// wrong tile (prevents dark tops on tall sprites).
// u_objectBaseY >= 0: object sprite path — world_y clamped around this value.
// u_objectBaseY  < 0: per-fragment fallback — floor tiles, UI draws.
uniform highp float u_objectBaseY;

// Object-lighting smoothing extras (wiki/alignment.md §8):
// u_objectBaseX >= 0 → 'flat' mode: sample the whole sprite at ONE tile centre
//   (u_objectBaseX, u_objectBaseY) — CE-faithful, no gradient, no stripes.
// u_objectSmoothPx > 0 → blur the sampled light over a small world-space kernel
//   to soften the per-column "vertical stripe" texture on wall faces.
// u_objectHardClampY == 1 → 'wall-clamp' mode: world_y is fixed EXACTLY to
//   u_objectBaseY (the foot row) for every pixel, instead of the ±6 soft band —
//   so the wall face samples the floor light field along its foot line, per
//   column, inheriting whatever interpolation the floor uses (setLightingBilinear).
uniform highp float u_objectBaseX;
uniform float u_objectSmoothPx;
uniform int u_objectHardClampY;

// Wall top-edge fade (walls only; u_wallFadePx == 0 for non-wall draws).
// Fades the LIT contribution toward 0 within u_wallFadePx TEXELS of the sprite's
// painted top edge, so the wall top recedes to ambient where it meets the dark
// roof tile — a cheap ambient-occlusion cue. §8.
// The edge is read from the sprite's OWN alpha silhouette (wallTopFadeFactor in
// main): the isometric slant of the top is already baked into the art, so marching
// up the alpha follows it exactly — no slope/orientation math needed.
// u_wallTexelStepV = 1 / sprite-sheet-height-in-texels (v-delta for one art row).
uniform float u_wallFadePx;
uniform float u_wallTexelStepV;

// Tile-intensity interpolation mode — see sampleTileLight below and
// fragmentLighting.glsl (kept identical). wiki/alignment.md §7.
uniform int u_lightInterp;

// CE ref: object.cc:4983 — egg mask texture (art/intrface/egg.frm, unit 6).
// White center = player-visible area (wall transparent there).
// u_eggMode: 0=disabled / flat-alpha mode, 1=egg-mask mode.
// u_eggCenter: world-space position of the egg anchor (player tile + 16, 8).
// u_eggSize:   egg texture dimensions in world-space pixels.
// CE rect: left = eggX - W/2, top = eggY - (H-1), right = left+W-1, bottom = eggY.
uniform int u_eggMode;
uniform highp vec2 u_eggCenter;   // highp — world coords can be large
uniform vec2 u_eggSize;
uniform sampler2D u_eggTex;        // texture unit 6

// CE ref: object.cc:4629 objectDrawOutline() / object.cc:874 _obj_render_post_roof()
// — combat target outlines (red=hostile, green=friendly) are drawn as a flat
// solid-color silhouette, in a separate pass run AFTER walls/roofs, which is
// why they show through occluding geometry. u_outlineMode bypasses lighting
// and the egg/alpha logic entirely — when set, this draw is purely a colored
// silhouette stamp (see webglDraw.ts renderOutlinePass), not a normal sprite.
// CE also cycles through a few palette shades down the sprite height for a
// "shimmer" look (5 shades for hostile, 4 for friendly); DH2 uses one flat
// color per outline type as a deliberate simplification (see wiki/rendering.md).
uniform int u_outlineMode;
uniform vec3 u_outlineColor;
uniform float u_outlineAlpha; // separate fill-alpha vs border-alpha draws share this; set per-draw in webglDraw.ts

varying vec2 v_texCoord;

// --- Tile-intensity sampling with selectable interpolation (u_lightInterp) ---
// Identical to shaders/fragmentLighting.glsl::sampleTileLight — keep in sync.
// hexToScreen is per-column-parity affine, so plain LINEAR blends across the hex
// stagger (NW-SE stripes). Modes: 0=off/linear (single sample), 1=column-center
// (quantize column, blend within column), 2=hex-lerp (3-tap barycentric over the
// 3 nearest hexes in parity-free axial space), 3=bicubic (Catmull-Rom down the
// column). See wiki/alignment.md §7.

void worldToHex(highp float wx, highp float wy, out highp float hx, out highp float hy) {
    hx = 150.0416667 - (wx / 32.0 - wy / 24.0);
    float col = floor(hx + 0.5);
    float cy = (mod(col, 2.0) < 0.5) ? -75.9375 : -75.4375;
    hy = wx / 64.0 + wy / 16.0 + cy;
}

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
        if (fi + fj <= 1.0) {
            uvA = axialToUV(i0, j0);             wA = 1.0 - fi - fj;
            uvB = axialToUV(i0 + 1.0, j0);       wB = fi;
            uvC = axialToUV(i0, j0 + 1.0);       wC = fj;
        } else {
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

    if (u_lightInterp == 3) {                       // bicubic (down column)
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

    return texture2D(u_tileIntensity, (vec2(hx, hy) + 0.5) / 200.0).r;
}

float getWorldTileLight() {
    // Convert physical gl_FragCoord → logical screen pixels → world coord.
    // Zoom divides the logical screen delta because each on-screen pixel
    // covers `1/zoom` world units when the view is scaled.
    // For object sprites (u_objectBaseY >= 0): world_x varies freely per-fragment
    // (horizontal bilinear gradient). world_y is clamped to ±6 world units of the
    // sprite's anchor tile — in tile-intensity texture space this is ±0.375 texels
    // (adjacent iso tiles are ~0.75 texels apart), so the LINEAR filter smoothly
    // blends with neighbouring tiles at sprite edges without ever sampling the wrong
    // tile and making tall sprites dark at the top.
    float dpr = u_screenResolution.x / u_resolution.x;
    float zoom = max(u_zoom, 0.0001);
    float world_x = u_camera.x + (gl_FragCoord.x / dpr) / zoom;
    float frag_world_y = u_camera.y + (u_resolution.y - gl_FragCoord.y / dpr) / zoom;

    float intensity;
    if (u_objectBaseX >= 0.0) {
        // 'flat' mode: whole sprite samples one tile centre → CE-faithful, no stripes.
        intensity = sampleTileLight(u_objectBaseX, u_objectBaseY);
    } else {
        // world_y: 'wall-clamp' pins it exactly to the foot row; other object modes
        // use the ±6 soft band around the anchor; floor/UI (baseY<0) use per-fragment.
        float world_y = (u_objectHardClampY == 1)
            ? u_objectBaseY
            : (u_objectBaseY >= 0.0
                ? clamp(frag_world_y, u_objectBaseY - 6.0, u_objectBaseY + 6.0)
                : frag_world_y);

        if (u_objectSmoothPx > 0.0) {
            // '*-smooth' modes: average the sampled light over a small world-space
            // kernel (2 wide horizontal taps + 2 short vertical taps, centre-weighted).
            // Horizontal taps smooth the per-column stripe; vertical taps soften the
            // per-object hex-row stagger. Reads the shared texture, so it blends
            // across tile/object boundaries. §8.
            float p = u_objectSmoothPx;
            intensity = (sampleTileLight(world_x, world_y) * 2.0
                  + sampleTileLight(world_x - p, world_y)
                  + sampleTileLight(world_x + p, world_y)
                  + sampleTileLight(world_x - 2.0 * p, world_y)
                  + sampleTileLight(world_x + 2.0 * p, world_y)
                  + sampleTileLight(world_x, world_y - p)
                  + sampleTileLight(world_x, world_y + p)) / 8.0;
        } else {
            // Parity-correct hex sampling with selectable interpolation. See §6/§7.
            intensity = sampleTileLight(world_x, world_y);
        }
    }

    // (Wall top-edge fade is applied in main() via the sprite's own alpha — it needs
    // the frame UV / sprite texture, which live there. See wallTopFadeFactor.)
    return intensity;
}

// Wall top-edge fade factor (1 = full light, →0 near the painted top edge).
// Reads the sprite's OWN alpha: march up the current frame column until the art
// turns transparent (or the frame top is passed). The distance to that first
// transparent texel is the distance to the painted top edge — which is already
// isometrically slanted in the art — so the fade follows any top-edge angle/shape
// with no slope, sign, or orientation input. `coord` is the frame-adjusted UV.
// v=0 is the sprite's screen-top (vertex shader flips Y; art is top-aligned in the
// slot), so "up" is decreasing v. Faded light is floored to ambient by main().
float wallTopFadeFactor(vec2 coord) {
    if (u_wallFadePx <= 0.0) return 1.0;   // non-wall / disabled — no marching
    // Distance (texels) up to the first transparent texel; default = past the band.
    float nearest = u_wallFadePx + 1.0;
    // The loop bound compares against u_wallFadePx (a UNIFORM), so every fragment in
    // the draw runs the same iteration count → uniform control flow, and texture2D
    // is sampled unconditionally each step (legal implicit-LOD use in WebGL1). The
    // data-dependent test only updates `nearest`, it does not gate the sample.
    for (int k = 1; k <= 32; k++) {
        float fk = float(k);
        if (fk > u_wallFadePx) break;
        float vy = coord.y - fk * u_wallTexelStepV;
        float a = (vy < 0.0) ? 0.0 : texture2D(u_image, vec2(coord.x, vy)).a;
        if (a < 0.5 && fk < nearest) nearest = fk;
    }
    if (nearest > u_wallFadePx) return 1.0;               // no transparent within band → deep inside
    return smoothstep(0.0, u_wallFadePx, nearest);        // near edge → faded toward 0
}

void main() {
    float frameWidth = 1.0 / u_numFrames;
    vec2 coord = v_texCoord;
    coord.x = coord.x / u_numFrames + frameWidth * u_frame;

    vec4 texel = texture2D(u_image, coord);

    if (u_outlineMode == 1) {
        // Flat solid-color silhouette stamp — no lighting, no egg/alpha logic.
        gl_FragColor = vec4(u_outlineColor, texel.a > 0.5 ? u_outlineAlpha : 0.0);
        return;
    }

    float alpha = u_alpha;

    if (u_eggMode == 1) {
        // Egg-mask mode: CE only fades the wall inside the small egg
        // footprint around the player — everywhere else (including the
        // rest of the same qualifying wall sprite) stays fully opaque.
        // There is no "flat alpha" fallback in egg mode; u_alpha is only
        // used by the separate flat-alpha mode.
        alpha = 1.0;

        // All coordinates in world space — zoom-independent.
        // CE ref: object.cc:5006 — eggRect: left=eggX-W/2, top=eggY-(H-1), bottom=eggY.
        float dpr = u_screenResolution.x / u_resolution.x;
        float zoom = max(u_zoom, 0.0001);
        float world_x = u_camera.x + (gl_FragCoord.x / dpr) / zoom;
        float world_y = u_camera.y + (u_resolution.y - gl_FragCoord.y / dpr) / zoom;

        // Egg top-left corner in world space, matching CE's bottom-aligned rect.
        vec2 eggTopLeft = vec2(
            u_eggCenter.x - u_eggSize.x * 0.5,
            u_eggCenter.y - (u_eggSize.y - 1.0)
        );
        vec2 eggUV = (vec2(world_x, world_y) - eggTopLeft) / u_eggSize;

        if (eggUV.x >= 0.0 && eggUV.x <= 1.0 && eggUV.y >= 0.0 && eggUV.y <= 1.0) {
            // egg.png mask shape lives in the ALPHA channel (solid white RGB) —
            // NOT the red channel. The original CE-derived egg.png stored its
            // falloff in R, resolved through the normal Fallout palette
            // (correct for sprites, wrong for mask data — painted each
            // gradient step a different hue, visible as colored rings).
            // 2026-06-23: regenerated via tools/export_mask_frms.py, which
            // writes the FRM's raw mask-intensity bytes (CE's documented
            // 0-128 scale) straight into alpha, rescaled to fill 0-255 so
            // this texture sample already *is* the final 0-1 blend fraction
            // — true smooth gradient, matching CE's `mask/128` falloff, not
            // the binary 0/1 cutoff an earlier hand-patched version of this
            // asset used.
            float mask = texture2D(u_eggTex, eggUV).a;
            alpha = mix(1.0, 0.0, mask);
        }
    }

    // CE ref: object.cc:5074 OBJECT_TRANS_GLASS + color.cc:375 _buildBlendTable.
    // _glassGrayTable: luma = (r + 5g + 4b)/10, max 0-7 (5-bit input, >>2).
    // _buildBlendTable (7-step): section N = (N/7)*teal + (1-N/7)*background.
    // → dark pixels: fully transparent; bright pixels: pure teal.
    // Sprite colour is discarded — only luminance controls teal opacity.
    // _colorTable[10239] = 15-bit 0RRRRR GGGGG BBBBB: R=9 G=31 B=31
    //                     = RGB(74, 255, 255) ≈ vec3(0.29, 1.0, 1.0).
    if (u_stealth == 1) {
        float luma = dot(texel.rgb, vec3(0.1, 0.5, 0.4));  // (r+5g+4b)/10 normalised
        texel.rgb = vec3(0.29, 1.0, 1.0);                  // teal = _colorTable[10239]
        texel.a  *= luma;                                   // dark→transparent, bright→teal
        // u_alpha (Config.ui.stealthAlpha) scales overall visibility via the
        // alpha local var below — no additional multiply needed here.
    }

    // Fade the wall top toward ambient (applied to the lit term BEFORE the ambient
    // floor, so it settles to ambient — matching the roof — not to black).
    float tileLight = getWorldTileLight() * wallTopFadeFactor(coord);
    float light = max(tileLight, u_ambient);
    gl_FragColor = vec4(texel.rgb * light, texel.a * alpha);
}
