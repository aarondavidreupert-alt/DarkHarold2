precision mediump float;

uniform sampler2D u_image;
uniform sampler2D u_lightBuffer;
uniform sampler2D u_tileIntensity;
uniform int u_useGPULighting;
uniform float u_ambient;
uniform vec2 u_screenResolution;
uniform vec2 u_camera;
uniform vec2 u_resolution;

varying vec2 v_texCoord;

float getGPULightIntensity() {
    float dpr = u_screenResolution.x / u_resolution.x;
    float world_x = u_camera.x + gl_FragCoord.x / dpr;
    float world_y = u_camera.y + u_resolution.y - gl_FragCoord.y / dpr;

    float adj_x = world_x - 13.0;
    float adj_y = world_y + 13.0;

    float cube_x = adj_x / 32.0 - adj_y / 24.0;
    float hex_x = 150.0 - cube_x;
    float hex_y = adj_x / 64.0 + adj_y / 16.0 - 75.0;

    return texture2D(u_tileIntensity, (vec2(hex_x, hex_y) + 0.5) / 200.0).r;
}

void main() {
    vec4 tileTexel = texture2D(u_image, v_texCoord);
    float lightIntensity;

    if (u_useGPULighting == 1) {
        float light = max(getGPULightIntensity(), u_ambient);
        gl_FragColor = vec4(tileTexel.rgb * light, tileTexel.a);
        return;
    } else {
        lightIntensity = min(texture2D(u_lightBuffer, v_texCoord).r, 65536.0);
    }

    float light = max(lightIntensity / 65536.0, u_ambient);
    gl_FragColor = vec4(tileTexel.rgb * light, tileTexel.a);
}