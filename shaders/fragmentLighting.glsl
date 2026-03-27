precision mediump float;
precision highp int;

uniform sampler2D u_image;
uniform sampler2D u_lightBuffer;
uniform sampler2D u_tileIntensity;   // 200x200 tile intensity map
uniform int u_useGPULighting;        // 0 = CPU lightbuffer, 1 = GPU tile-intensity
uniform float u_ambient;             // minimum brightness floor (e.g. 40960/65536 ≈ 0.625)
uniform vec2 u_screenResolution;     // vec2(canvas_width, canvas_height)
uniform vec2 u_camera;               // world camera position (cameraX, cameraY)

varying vec2 v_texCoord;

float getGPULightIntensity() {
    // Compute world screen position from gl_FragCoord and camera.
    // Vertex shader flips Y (clipSpace * vec2(1,-1)), so gl_FragCoord.y=0 is at the
    // bottom of the canvas. Engine Y increases downward, so:
    //   world_x = cameraX + gl_FragCoord.x
    //   world_y = cameraY + canvasHeight - gl_FragCoord.y
    float world_x = u_camera.x + gl_FragCoord.x;
    float world_y = u_camera.y + u_screenResolution.y - gl_FragCoord.y;

    // hexFromScreen without rounding (continuous hex UV for smooth GPU interpolation).
    // Derived from geometry.ts pixelToCube + cubeRoundToHex (HEX_WIDTH=32, HEX_HEIGHT=16):
    //   cube_x = world_x/32 - world_y/24
    //   hex_x  = 150 - cube_x
    //   hex_y  = world_x/64 + world_y/16 - 75  (cube_z + cube_x/2 - 75, simplified)
    float adj_x = world_x - 13.0;
    float adj_y = world_y + 13.0;
    float cube_x = adj_x / 32.0 - adj_y / 24.0;
    float hex_x = 150.0 - cube_x;
    float hex_y = adj_x / 64.0 + adj_y / 16.0 - 75.0;

    // GPU LINEAR filter interpolates continuously between adjacent hex intensities.
    return texture2D(u_tileIntensity, (vec2(hex_x, hex_y) + 0.5) / 200.0).r;
}

void main() {
    vec4 tileTexel = texture2D(u_image, v_texCoord);

    if (u_useGPULighting == 1) {
        // tile-intensity path: continuous hex UV via gl_FragCoord, value normalised 0..1
        float light = max(getGPULightIntensity(), u_ambient);
        gl_FragColor = vec4(tileTexel.rgb * light, tileTexel.a);
    } else {
        // CPU path — per-tile 80x36 lightbuffer uploaded each tile
        float lightIntensity = min(texture2D(u_lightBuffer, v_texCoord).r, 65536.0);
        float light = max(lightIntensity / 65536.0, u_ambient);
        gl_FragColor = vec4(tileTexel.rgb * light, tileTexel.a);
    }
}
