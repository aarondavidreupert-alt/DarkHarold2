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

varying vec2 v_texCoord;

float getWorldTileLight() {
    // Convert physical gl_FragCoord → logical screen pixels → world coord.
    // Zoom divides the logical screen delta because each on-screen pixel
    // covers `1/zoom` world units when the view is scaled.
    float dpr = u_screenResolution.x / u_resolution.x;
    float zoom = max(u_zoom, 0.0001);
    float world_x = u_camera.x + (gl_FragCoord.x / dpr) / zoom;
    float world_y = u_camera.y + (u_resolution.y - gl_FragCoord.y / dpr) / zoom;

    // Continuous hex UV (same math as fragmentLighting.glsl::getGPULightIntensity).
    float cube_x = world_x / 32.0 - world_y / 24.0;
    float hex_x = 150.0 - cube_x;
    float hex_y = world_x / 64.0 + world_y / 16.0 - 75.7;

    return texture2D(u_tileIntensity, (vec2(hex_x, hex_y) + 0.5) / 200.0).r;
}

void main() {
    float frameWidth = 1.0 / u_numFrames;
    vec2 coord = v_texCoord;
    coord.x = coord.x / u_numFrames + frameWidth * u_frame;

    vec4 texel = texture2D(u_image, coord);

    float alpha = u_alpha;

    if (u_eggMode == 1 && u_alpha < 1.0) {
        // Egg-mask mode: sample egg.png to get per-pixel transparency.
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
            // egg.png white center (R≈1) = transparent wall; dark border (R≈0) = opaque.
            // CE ref: object.cc:5047 _intensity_mask_buf_to_buf — mask=255 suppresses wall pixel.
            float mask = texture2D(u_eggTex, eggUV).r;
            alpha = mix(u_alpha, 0.0, mask);
        }
    }

    float light = max(getWorldTileLight(), u_ambient);
    gl_FragColor = vec4(texel.rgb * light, texel.a * alpha);
}
