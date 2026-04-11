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

varying vec2 v_texCoord;

float getWorldTileLight() {
    // Convert physical gl_FragCoord → logical screen pixels → world coord.
    float dpr = u_screenResolution.x / u_resolution.x;
    float world_x = u_camera.x + gl_FragCoord.x / dpr;
    float world_y = u_camera.y + u_resolution.y - gl_FragCoord.y / dpr;

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

    float light = max(getWorldTileLight(), u_ambient);
    gl_FragColor = vec4(texel.rgb * light, texel.a);
}
