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
    // 4 corners derived from CPU lighting geometry:
    //   top-left  (texCoord 0,0): tilenum + 0    (sx,    sy)
    //   top-right (texCoord 1,0): tilenum + 201  (sx+80, sy+12 → tileToScreen/back)
    //   bot-left  (texCoord 0,1): tilenum + 200  (sx,    sy+36 → y+1 row)
    //   bot-right (texCoord 1,1): tilenum + 401  (sx+112,sy+36)
    int flatIdx = u_tilePos.y * 200 + u_tilePos.x;
    int idxTL = flatIdx;
    int idxTR = flatIdx + 201;
    int idxBL = flatIdx + 200;
    int idxBR = flatIdx + 401;
    // convert flat index back to (tx, ty) — avoid % with integer subtraction
    ivec2 pTL = ivec2(idxTL - (idxTL / 200) * 200, idxTL / 200);
    ivec2 pTR = ivec2(idxTR - (idxTR / 200) * 200, idxTR / 200);
    ivec2 pBL = ivec2(idxBL - (idxBL / 200) * 200, idxBL / 200);
    ivec2 pBR = ivec2(idxBR - (idxBR / 200) * 200, idxBR / 200);
    float tl = sampleTileIntensity(pTL);
    float tr = sampleTileIntensity(pTR);
    float bl = sampleTileIntensity(pBL);
    float br = sampleTileIntensity(pBR);
    return mix(mix(tl, tr, texCoord.x), mix(bl, br, texCoord.x), texCoord.y);
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
