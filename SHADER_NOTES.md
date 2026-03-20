# Shader Notes: Floor Lighting Fixes (branch: ShaderRecreate13)

## fragmentLighting.glsl

- **Y-flip fix**: Corrected texture coordinate vertical orientation to account for OpenGL's bottom-to-top convention.
- **Shader normalization**: Replaced palette-based lookup with direct brightness multiplication. Light intensity is now normalized as `lightIntensity / 65536.0` and applied directly to the tile color:
  ```glsl
  float brightness = lightIntensity / 65536.0;
  gl_FragColor = vec4(tileTexel.rgb * brightness, tileTexel.a);
  ```
  This maps an intensity of 40960 to ~0.625 brightness (visible mid-range).

## config.ts

- **`doFloorLighting: true`**: Enabled the floor lighting code path in the renderer configuration.

## webglrenderer.ts

- **`initFloorLighting()` extracted method**: Floor lighting initialization logic was extracted into its own method for clarity and separation of concerns.
- **WebGL2 format fixes**: Updated internal texture formats to be WebGL2-compatible:
  - `gl.RGBA32F` for floating-point RGBA buffers
  - `gl.RGB8` for 8-bit RGB textures
  - `gl.R32F` / `gl.RED` for single-channel float textures

## LUT path fixes

- **`lut/colorTable.json`** and **`lut/color_rgb.json`**: Corrected asset paths so the color lookup tables are resolved correctly at runtime.

## main.ts

- **`window.toggleFloorLighting` helper**: Exposed a debug helper on the global `window` object to toggle floor lighting on/off at runtime from the browser console.
