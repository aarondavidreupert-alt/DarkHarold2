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
uniform sampler2D u_tileIntensity;   // 200x200 tile intensity map
uniform sampler2D u_screenLightmap;  // SCREEN_WIDTH x SCREEN_HEIGHT screen-space lightmap (mode 2)
uniform ivec2 u_tilePos;            // current tile position (x, y) in tile coords
uniform int u_useGPULighting;       // 0 = CPU lightbuffer, 1 = GPU tile-intensity, 2 = screen-space
uniform float u_ambient;            // minimum brightness floor (e.g. 40960/65536 ≈ 0.625)
uniform vec2 u_screenResolution;    // vec2(SCREEN_WIDTH, SCREEN_HEIGHT)

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
    // Transform fragment position in the 80x36 tile quad into tile grid space using
    // the inverse Jacobian of tileToScreen (dx=48,dy=-12 per +tx; dx=32,dy=24 per +ty).
    // The reference hex is hexFromScreen(scrX-13, scrY+13), so px/py offsets include
    // that 13-pixel adjustment. GPU LINEAR filter interpolates between tile texels.
    float sampleX = float(u_tilePos.x) + (240.0*texCoord.x - 144.0*texCoord.y + 91.0) / 192.0;
    float sampleY = float(u_tilePos.y) + ( 80.0*texCoord.x + 144.0*texCoord.y - 39.0) / 128.0;
    return texture2D(u_tileIntensity, (vec2(sampleX, sampleY) + 0.5) / 200.0).r;
}

void main() {
    vec4 tileTexel = texture2D(u_image, v_texCoord);

    float lightIntensity;
    if (u_useGPULighting == 2) {
        // Screen-space lightmap: sample directly using gl_FragCoord.
        // gl_FragCoord.y=0 is at the bottom of the canvas; screenLightmap row 0 is the top
        // of the engine screen, so we flip Y to align them.
        vec2 screenUV = vec2(gl_FragCoord.x / u_screenResolution.x,
                             1.0 - gl_FragCoord.y / u_screenResolution.y);
        float lightVal = texture2D(u_screenLightmap, screenUV).r;
        // lightVal is already normalised 0-1
        float light = max(lightVal, u_ambient);
        gl_FragColor = vec4(tileTexel.rgb * light, tileTexel.a);
        return;
    } else if (u_useGPULighting == 1) {
        // tile-intensity path: value already normalised 0..1
        float light = max(getGPULightIntensity(v_texCoord), u_ambient);
        gl_FragColor = vec4(tileTexel.rgb * light, tileTexel.a);
        return;
    } else {
        // CPU path — per-tile 80x36 lightbuffer uploaded each tile
        lightIntensity = min(texture2D(u_lightBuffer, v_texCoord).r, 65536.0);
    }

    float light = max(lightIntensity / 65536.0, u_ambient);

    gl_FragColor = vec4(tileTexel.rgb * light, tileTexel.a);
}
