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
    float world_y = (u_objectBaseY >= 0.0)
        ? clamp(frag_world_y, u_objectBaseY - 6.0, u_objectBaseY + 6.0)
        : frag_world_y;

    // Continuous hex UV (same math as fragmentLighting.glsl::getGPULightIntensity).
    // Exact inverse of hexToScreen: parity-aware because hexToScreen is a
    // per-column-parity affine map. The old single -75.7 constant was the
    // even/odd average and mis-sampled by ±0.2375 texels per column. See
    // wiki/alignment.md §6.
    float hex_x = 150.0416667 - (world_x / 32.0 - world_y / 24.0);   // 150 + 1/24
    float col = floor(hex_x + 0.5);                                  // nearest hex column
    float cy = (mod(col, 2.0) < 0.5) ? -75.9375 : -75.4375;          // even : odd
    float hex_y = world_x / 64.0 + world_y / 16.0 + cy;

    return texture2D(u_tileIntensity, (vec2(hex_x, hex_y) + 0.5) / 200.0).r;
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

    float light = max(getWorldTileLight(), u_ambient);
    gl_FragColor = vec4(texel.rgb * light, texel.a * alpha);
}
