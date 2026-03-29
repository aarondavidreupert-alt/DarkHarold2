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

varying vec2 v_texCoord;

float getGPULightIntensity() {
    // Convert physical gl_FragCoord to logical screen pixels (accounts for high-DPI displays).
    // Then compute world position from camera + logical screen offset.
    float dpr = u_screenResolution.x / u_resolution.x;
    float world_x = u_camera.x + gl_FragCoord.x / dpr;
    float world_y = u_camera.y + u_resolution.y - gl_FragCoord.y / dpr;

    // Apply hex grid alignment offset (matches CPU path's hexFromScreen(x - 13, y + 13))
    float adj_x = world_x - 13.0;
    float adj_y = world_y + 13.0;

    // hexFromScreen without rounding (continuous hex UV for smooth GPU interpolation).
    // Derived from geometry.ts pixelToCube + cubeRoundToHex (HEX_WIDTH=32, HEX_HEIGHT=16):
    //   cube_x = adj_x/32 - adj_y/24
    //   hex_x  = 150 - cube_x
    //   hex_y  = adj_x/64 + adj_y/16 - 75  (cube_z + cube_x/2 - 75, simplified)
    float cube_x = adj_x / 32.0 - adj_y / 24.0;
    float hex_x = 150.0 - cube_x;
    float hex_y = adj_x / 64.0 + adj_y / 16.0 - 75.0;

    // GPU LINEAR filter interpolates continuously between adjacent hex intensities.
    return texture2D(u_tileIntensity, (vec2(hex_x, hex_y) + 0.5) / 200.0).r;
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
