precision mediump float;
precision highp int;

// uniform int u_colorTable[0x8000];
// uniform int u_intensityColorTable[65536];
// uniform vec3 u_paletteRGB[256];

uniform sampler2D u_colorTable;
uniform sampler2D u_intensityColorTable;
uniform sampler2D u_paletteRGB;

uniform sampler2D u_image;
uniform sampler2D u_lightBuffer;
uniform sampler2D u_tileIntensity;  // 200x200 tile intensity map
uniform ivec2 u_tilePos;            // current tile position (x, y) in tile coords
uniform int u_useGPULighting;      // 1 = GPU path, 0 = CPU path (uses u_lightBuffer)

varying vec2 v_texCoord;

int colorToColorTableRGB(const vec3 color) {
    // Get 5-bit "paletted" RGB values
    // for this to work, r, g, and b need to be in the range 0..31 (5 bits)
    //vec3 v = vec3(color.x*255 / 8, color.y*255 / 8, color.z*255 / 8); // Get 5-bit "paletted" RGB values
    int r = int(color.r * 255.0) / 8;
    int g = int(color.g * 255.0) / 8;
    int b = int(color.b * 255.0) / 8;

    // r << 10 | g << 5 | b
    return 32 * 32 * r + 32 * g + b;
}

vec4 atIndex(sampler2D tex, int index) {
    const float size = 256.0; // max size of texture
    float x = mod(float(index), size);
    float y = 1.0 - float(index / int(size)); // use upside-down V coordinates because OpenGL likes textures bottom-to-top but we don't play their game
    return texture2D(tex, vec2((x + 0.5) / size, (y + 0.5) / size));
}

vec3 paletteColor(int palIdx) {
    return texture2D(u_paletteRGB, vec2((float(palIdx) + 0.5) / 256.0, 1.0)).rgb;
}

float sampleTileIntensity(ivec2 tilePos) {
    vec2 uv = (vec2(tilePos) + 0.5) / vec2(200.0, 200.0);
    return texture2D(u_tileIntensity, uv).r;
}

float getGPULightIntensity(vec2 texCoord) {
    // Convert (tx, ty) back to a flat index, then sample the 4 quad corners.
    // Avoid % operator — not supported in GLSL ES 1.00; use x - (x/200)*200 instead.
    // Fallout tile x increases going LEFT on screen → flip the x interpolation axis.
    int flatIdx = u_tilePos.y * 200 + u_tilePos.x;
    int f1 = flatIdx + 1;    // x+1 neighbour (left on screen)
    int f2 = flatIdx + 200;  // y+1 neighbour (down-right on screen)
    int f3 = flatIdx + 201;
    ivec2 p0 = ivec2(flatIdx - (flatIdx / 200) * 200, flatIdx / 200);
    ivec2 p1 = ivec2(f1     - (f1     / 200) * 200, f1     / 200);
    ivec2 p2 = ivec2(f2     - (f2     / 200) * 200, f2     / 200);
    ivec2 p3 = ivec2(f3     - (f3     / 200) * 200, f3     / 200);
    float tl = sampleTileIntensity(p0);
    float tr = sampleTileIntensity(p1);
    float bl = sampleTileIntensity(p2);
    float br = sampleTileIntensity(p3);
    float u = 1.0 - texCoord.x; // flip x: tile x+ goes left on screen
    float v = texCoord.y;
    return mix(mix(tl, tr, u), mix(bl, br, u), v);
}

void main() {
    vec4 tileTexel = texture2D(u_image, v_texCoord);

    float lightIntensity;
    if (u_useGPULighting == 1) {
        lightIntensity = getGPULightIntensity(v_texCoord);
    } else {
        // CPU path — per-tile 80x36 light buffer uploaded by renderLitFloorCPU
        lightIntensity = min(texture2D(u_lightBuffer, v_texCoord).r, 65536.0);
    }

    float brightness = lightIntensity / 65536.0;

    gl_FragColor = vec4(tileTexel.rgb * brightness, tileTexel.a);
}
