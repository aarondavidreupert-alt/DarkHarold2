# Rendering System

Reference doc for the Fallout 2 isometric rendering pipeline, DH2's WebGL 2.0 implementation, and the authoritative catalogue of every known deviation between DH2's renderer and CE's software renderer.

Ground truth: `raw/fallout2-ce/src/tile.cc`, `tile.h`, `object.cc`, `color.cc`  
DH2 implementation: `src/webglrenderer.ts` (barrel; `src/render/{webglContext,webglLighting,webglDraw}.ts`), `src/renderer.ts`, `src/tile.ts`, `src/geometry.ts` (barrel; `src/geometry/{hexScreen,hexGrid}.ts`), `src/map.ts` (barrel; `src/map/{GameMap,mapLoader}.ts`), `src/object.ts` (barrel; `src/object/*.ts`)

Cross-references: `wiki/lighting.md` (lighting overview and scripting-level gaps LD1–LD6 in §13), `wiki/tile_system.md`, `wiki/known_bugs.md §22` (bug registry)

Last audited: 2026-06-02

---

## 1. CE Render Pipeline Overview

### Isometric Projection

Fallout 2 uses a **staggered isometric hex grid**, not a classical 45° diamond grid. Two coordinate systems coexist:

- **Hex tiles** — 32×16 px, used for objects, critters, pathfinding
- **Square tiles** — 80×36 px, used for floor/roof sprites (each square covers 2×2 hex cells)

#### CE tileToScreenXY (`tile.cc:674`)

Converts a tileNum to screen pixel coordinates relative to the current center tile.

```c
int tile_x = gHexGridWidth - 1 - (tile % gHexGridWidth);  // reverse x: 0..199 → 199..0
int tile_y = tile / gHexGridWidth;

*screenX = _tile_offx;  // center-tile screen X (= windowWidth / 2)
*screenY = _tile_offy;  // center-tile screen Y (= windowHeight / 2)

// "columns" of tiles contribute 48px wide, offset halved for y
int dx = (tile_x - _tile_x) / 2;
*screenX += 48 * dx;
*screenY += 12 * ((tile_x - _tile_x) / -2);

// odd-column parity adjustment
if (tile_x & 1) {
    if (tile_x <= _tile_x) { *screenX -= 16;  *screenY += 12; }
    else                   { *screenX += 32; }
}

// rows contribute 16 horizontal + 12 vertical per tile
int dy = tile_y - _tile_y;
*screenX += 16 * dy;
*screenY += 12 * dy;
```

#### CE tileFromScreenXY (`tile.cc:718`)

Inverse: pixel → tileNum. Uses a precomputed `_tile_mask[512]` lookup table (32×16, 5-region classification) to handle sub-tile hit-testing at the diamond edge and corners.

### Hex Grid

The playfield is a 200×200 hex grid. Each position is stored as `(x, y)` with `x` running left-to-right (0–199) and `y` running top-to-bottom (0–199).

**CE tileNum encoding**: `tile = gHexGridWidth * tile_y + (gHexGridWidth - 1 - tile_x)` — CE stores x reversed (column 0 is at the right edge). All `tile % gHexGridWidth` operations in CE yield the reversed x.

CE uses `_dir_tile[parity][6]` precomputed offset arrays (`tile.cc:186`), where `parity = (tile % gHexGridWidth) & 1`:

```
parity=0 (even reversed-x):
  dir0: -1,      dir1: +199,    dir2: +200,    dir3: +201,    dir4: +1,    dir5: -200
parity=1 (odd reversed-x):
  dir0: -201,    dir1: -1,      dir2: +200,    dir3: +1,      dir4: -199,  dir5: -200
```

These offsets on the tileNum directly give the adjacent tile in each of the 6 directions. `tileGetTileInDirection` (`tile.cc:892`) applies one offset per step.

Hex distance: `tileDistanceBetween` (`tile.cc:797`) iterates using `_dir_tile` offsets — O(n) walk rather than a formula.

### CE Frame Pipeline (`tileRefreshGame`, `tile.cc:634`)

```
Frame:
  1. bufferFill             — clear dirty rect (CPU memset)
  2. tileRenderFloorsInRect — blit square floor tiles from art cache (no intensity)
  3. _obj_render_pre_roof   — per-tile isometric walk; OBJECT_FLAT first, then all others
                              Each sprite: intensityColorTable[palette[px]][lightLevel/512]
  4. tileRenderRoofsInRect  — blit roof tiles (full palette; no intensity applied)
  5. _obj_render_post_roof  — objects above roofline at full intensity (0x10000)
  6. blit to screen
```

`_obj_render_pre_roof` (`object.cc:761`) iterates tiles in a precomputed isometric sort order (`_orderTable[parity]`). For each tile it renders:
1. `OBJECT_FLAT` objects (e.g., floor decals) — dedicated first pass
2. All remaining objects in the render table — drawn back-to-front

CE's per-tile render table is sorted by `_obj_order_comp_func_even/odd` which encodes isometric depth by interleaving tile row/column offsets.

Object depth tie-breaking uses `tileIsInFrontOf` and `tileIsToRightOf`:

```c
// tileIsInFrontOf: tile1 is rendered in front of tile2
// Condition: dx <= dy * -4.0  (tile is "above" the other in isometric space)
return (double)dx <= (double)dy * -4.0;
```

### CE Lighting Model

Per-tile light intensity: `lightGetTileIntensity(elevation, tile)` — reads `_light_intensities[elevation][tile]`, max of ambient + all light-emitting objects casting onto that tile. `lightIntensity` field on each `Object` struct (from PRO data) drives the radius/intensity.

Lighting is applied per-pixel at draw time via `intensityColorTable[256][256]` (`color.cc:68`) — a precomputed 256 × 256 palette-remap table. `intensityIndex = lightIntensity / 512` (0–127 = darker, 128–255 = lighter). Per-pixel palette-table darkening: integer colour remapping, no GPU involved.

### CE Viewport & Camera (`tile.cc:537–608`)

```c
// After tileSetCenter(tile):
_tile_x = gHexGridWidth - 1 - (tile % gHexGridWidth)  // reversed x of center tile
_tile_y = tile / gHexGridWidth                         // y of center tile
_tile_offx = (windowWidth - 32) / 2    // screen X of center tile
_tile_offy = (windowHeight - 16) / 2   // screen Y of center tile
gCenterTile = tile
```

Fixed resolution: 640 × 480; `windowWidth / windowHeight` hard-wired. No zoom.

All `tileToScreenXY` calculations are relative to `(_tile_x, _tile_y, _tile_offx, _tile_offy)`. To center on the player, CE calls `tileSetCenter(gDude->tile)`.

Scroll restrictions:
- `gTileScrollBlockingEnabled`: prevents scrolling through `OBJECT_SCROLL_BLOCK` objects
- `gTileScrollLimitingEnabled`: prevents scrolling beyond `gTileBorderMin/MaxX/Y` (computed from viewport/grid size)

Mouse picking (screen → tile): `tileFromScreenXY(mouseX, mouseY, elevation)` (`tile.cc:718`)

### CE Roof Clipping (`object.cc:1445–1471`, `_obj_render_pre_roof`)

CE tracks the **square tile** the player is standing on (`_obj_last_roof_x/y`). Each frame, if the player has moved to a different square:

1. `tile_fill_roof(old_roof_x, old_roof_y, elevation, true)` — restores old roof tile visibility
2. `tile_fill_roof(new_roof_x, new_roof_y, elevation, false)` — hides roof tiles in the new square

`tile_fill_roof` (`tile.cc`) flood-fills connected roof tiles from the given square coordinate and toggles their visibility. This makes the roof transparent when the player walks under a building. The visibility flag is re-computed every frame.

### CE Multi-Elevation

The engine renders one elevation at a time (`gElevation`). `mapSetElevation()` in `map.cc` rebuilds the object list and tile data for the new elevation. CE map files store separate floor/roof tile layers and object lists per elevation (up to 3 elevations). CE applies a visual fade effect between elevation levels.

---

## 2. DH2 WebGL Pipeline

### Why the Architecture Differs

CE is a fixed-resolution (640 × 480) software renderer running on a CPU pixel buffer. Every draw call is a memcpy with a per-pixel palette table lookup — "darkening" a sprite means looking up a precomputed `intensityColorTable[colour_index][intensity_step]` array that maps a palette entry to a darker or lighter palette entry. There is no GPU, no floating-point colour, and no shader pipeline.

DH2 renders in WebGL 2.0. The GPU rasterises textured quads; colour values are 32-bit float RGBA; lighting is applied as a scalar float multiply in the fragment shader. The indexed-palette model is fundamentally absent at the hardware level. Three categories of deviation from CE are **deliberate improvements** rather than bugs — see §5.

### DH2 Coordinate Systems

**DH2 tileNum encoding**: `tileNum = y * 200 + x` — x is stored normally (column 0 is at the left edge). `src/tile.ts:22-27`. (CE reverses x; DH2 does not.)

**DH2 Square Tile Projection** (`src/tile.ts:30`):

```typescript
x = 99 - x               // tile grid x is stored 0-99 from right-to-left
sx = 4752 + 32 * y - 48 * x
sy = 24 * y + 12 * x
```

Produces the same stagger as CE: each grid row shifts 32px right and 24px down; each column shifts −48px horizontally and +12px vertically.

**DH2 Hex Object Projection** (`src/geometry/hexScreen.ts`):

```typescript
function hexToScreen(x: number, y: number): Point {
    const sx = 4816 - ((((x + 1) >> 1) << 5) + ((x >> 1) << 4) - (y << 4))
    const sy = 12 * (x >> 1) + y * 12 + 11
    return { x: sx, y: sy }
}
```

Distinct from `tileToScreen` — the hex grid is twice as fine as the square tile grid, and hex coordinates run in the opposite x direction.

**DH2 Hex Neighbour Offsets** (`src/geometry/hexGrid.ts`):

```
even x:  [(-1,y), (-1,y+1), (x,y+1), (+1,y+1), (+1,y), (x,y-1)]  // dirs 0–5
odd  x:  [(-1,y-1), (-1,y), (x,y+1), (+1,y), (+1,y-1), (x,y-1)]  // dirs 0–5
```

Direction 0 = NW (or N on even columns), increasing clockwise.

**DH2 Hex Distance** (`src/geometry/hexGrid.ts`): converts to cube coordinates and uses Chebyshev distance — O(1) vs CE's O(n) walk.

**Constants**:

| Constant | Value | Location |
|----------|-------|----------|
| `TILE_WIDTH` | 80 | `src/tile.ts:19` |
| `TILE_HEIGHT` | 36 | `src/tile.ts:20` |
| `HEX_WIDTH` | 32 | `src/geometry/hexScreen.ts` |
| `HEX_HEIGHT` | 16 | `src/geometry/hexScreen.ts` |
| `HEX_GRID_SIZE` | 200 | `src/geometry/hexScreen.ts` |
| Grid dimensions | 200 × 200 | both CE and DH2 |

### DH2 Frame Pipeline (`Renderer.render()`, `renderer.ts:119`)

```
Frame:
  1. gl.clear()
  2. renderFloor           — floor quads via floorLightShader (3 modes: CPU/GPU/screen-space)
  3. renderObjects         — sorted object quads via tileShader
  4. renderRoof            — roof quads via tileShader (roofDummyTexture on unit 5)
  5. UI / float messages / cursor
```

Lighting in the fragment shader (`fragment.glsl:51`):
```glsl
float light = max(getWorldTileLight(), u_ambient);
gl_FragColor = vec4(texel.rgb * light, texel.a);
```

`getWorldTileLight()` derives a continuous hex UV from `gl_FragCoord` and samples the 200 × 200 R8 `u_tileIntensity` texture (value / 255 normalised, ≈ intensity / 65536).

### DH2 Viewport & Camera (`src/renderer.ts`, `src/tile.ts`)

```typescript
// Camera is the world-space top-left corner of the visible area:
globalState.cameraPosition: { x, y }  // world pixels
globalState.cameraZoom: number         // 1.0 = 100%, [ZOOM_MIN=0.5, ZOOM_MAX=3.0]

// Center on a world point:
function centerCamera(around: Point) {
    const scr = hexToScreen(around.x, around.y)
    cameraPosition.x = scr.x - viewW / 2
    cameraPosition.y = scr.y - viewH / 2
}

// Visible world area in world units:
viewW = SCREEN_WIDTH / zoom
viewH = SCREEN_HEIGHT / zoom

// Screen pixel → world:
function screenToWorld(sx, sy): Point {
    return { x: sx / zoom + cameraPosition.x, y: sy / zoom + cameraPosition.y }
}
```

`SCREEN_WIDTH` and `SCREEN_HEIGHT` are dynamic — updated by `setScreenSize()` on browser window resize (`renderer.ts:53`). A `resize` event causes `WebGLRenderer.resize()` to update all shader uniforms and reallocate the floor FBO.

Mouse picking (screen → hex): `hexFromScreen(screenToWorld(mouseX, mouseY))` via cube-coordinate rounding (`geometry.ts`).

Mouse picking (screen → square tile): `tileFromScreen(worldX, worldY)` (`tile.ts:38`):
```typescript
off_x = -4800 + x
off_y = y
tx = -(off_x - (off_y * 4) / 3) / 64
ty = (off_y + off_x / 4) / 32
return { x: 99 - round(tx), y: round(ty) }
```

### DH2 Multi-Elevation (`GameMap.changeElevation`, `map.ts`)

```typescript
changeElevation(level, updateScripts = true) {
    // Move party members to new elevation object list
    arrayRemove(objects[oldElevation], member)
    objects[level].push(member)

    // Update renderer with new floor/roof tilemaps and object list
    renderer.initData(roofMap, floorMap, getObjects())  // floorMap/roofMap are per-elevation

    // Rebuild lightmap for new elevation
    if (Config.engine.doFloorLighting) {
        Lightmap.resetLight()
        Lightmap.rebuildLight()
    }
}
```

The `floorMap` and `roofMap` properties on `GameMap` are set to the current elevation's tile data whenever elevation changes. Each elevation has its own `objects[level]: Obj[]` array (populated from `maps/*.json` on map load). The player and party members are moved between elevation arrays when `changeElevation` is called. Elevation switching is **instant** — no transition effect.

---

## 3. Tile Drawing & Object Order

### Tile Draw Order

Floor tiles are iterated in reverse row order (`i = tileMap.length-1` down to 0) to match Fallout 2's visual layering and prevent lighting artefacts at tile boundaries. (`webglrenderer.ts`, `708`)

**Roof Y offset**: DH2 shifts roof tiles up by 96 pixels: `scr.y -= 96` (`webglrenderer.ts`). This empirically aligns 80×36 roof sprites with the floor tiles beneath them.

**Roof clipping**: DH2 renders all roof tiles unconditionally in `renderRoof()` (`webglrenderer.ts`). There is no equivalent to CE's `tile_fill_roof` or per-square roof hiding. `Config.ui.showRoof` (default `true`) is a debug toggle that hides **all** roofs globally. `map.hasRoofAt(pos)` (`map.ts`) returns true if a given hex position has a non-`grid000` roof tile above it, but is not used during rendering. See deviation **RD06** in §5.

### Object Sort (`objectZCompare`, `object.ts`)

DH2 sorts objects by a simplified key:

```
Primary:   hex y (north-to-south), ascending
Secondary: hex x (west-to-east), ascending
Tertiary:  walls before non-walls at same tile
```

This is **not** equivalent to CE's isometric-correct sort. CE uses a two-phase algorithm (`_obj_preload_sort` then the per-parity offset table `_obj_order_comp_func_even/odd`) that correctly handles all 6 hex directions. DH2's Y-then-X sort produces correct results for most cases but fails at the north-east / south-west diagonals. See deviation **RD09** in §5.

Object insertion after movement uses `objectZOrder` (`object.ts`) which does an in-place insertion-sort into the live objects array.

---

## 4. Object Rendering Details

### Object Screen Positioning

**CE**: `_obj_render_object` calls `tileToScreenXY(object->tile)` to get the base screen position, then adds FRM per-frame/direction offset data from the art cache.

**DH2** (`objectRenderInfo`, `renderer.ts:284`):

```typescript
const scr = hexToScreen(obj.position.x, obj.position.y)  // hex → world coords

// FRM frame offsets from imageInfo
const frameInfo = info.frameOffsets[obj.orientation][obj.frame]
const dirOffset = info.directionOffsets[obj.orientation]

// Anchor from bottom-center of the hex position:
offsetX = -(frameInfo.w / 2) + dirOffset.x + frameInfo.ox
offsetY = -frameInfo.h + dirOffset.y + frameInfo.oy

scrX = scr.x + offsetX
scrY = scr.y + offsetY
```

The final `(scrX, scrY)` is the top-left pixel of the sprite. `frameInfo.w/h` are the current frame's pixel dimensions. `dirOffset.x/y` are per-direction offsets from `imageMap.json`. `frameInfo.ox/oy` are per-frame offsets from the FRM binary.

Culling is done in world coordinates before the draw call: if the sprite AABB is fully outside `[cameraPosition, cameraPosition + viewSize]` it is skipped.

### WebGL Shaders

| Shader | File | Used for |
|--------|------|----------|
| `tileShader` | `shaders/vertex.glsl` + `shaders/fragment.glsl` | All sprites: floor tiles (fallback), objects, walls, roof tiles, UI |
| `floorLightShader` | `shaders/vertex.glsl` + `shaders/fragmentLighting.glsl` | Floor tiles with lighting |
| `fontShader` | `shaders/vertex.glsl` + `shaders/fragmentFont.glsl` | Bitmap font rendering |

### Key Uniforms (tileShader)

| Uniform | Type | Description |
|---------|------|-------------|
| `u_offset` | vec2 | Screen-space top-left position (pixels) |
| `u_scale` | vec2 | Sprite dimensions in screen pixels (width × zoom, height × zoom) |
| `u_numFrames` | float | Total frames in sprite sheet (for UV calculation) |
| `u_frame` | float | Current frame index |
| `u_ambient` | float | Ambient light level (0.0–1.0). `1.0` = no darkening (UI mode) |
| `u_camera` | vec2 | Camera world position (for tile-intensity lookup) |
| `u_zoom` | float | Current zoom (for gl_FragCoord → world coord math) |
| `u_resolution` | vec2 | Logical screen dimensions |

### Texture Units

| Unit | Contents |
|------|----------|
| 0 | Sprite texture (from `globalState.images`) |
| 1 | Per-tile light buffer (80×36, R32F float) — CPU lighting mode |
| 5 | 200×200 tile-intensity texture (R8, 0–255) — world lighting for all draws |

### Sprite Sheet Layout

All frames (all directions × all animation frames) are packed into one horizontal PNG:

```
[dir0frame0][dir0frame1]...[dir1frame0][dir1frame1]...
```

Frame index in the sheet: `totalFrames * orientation + frame`  
UV x-start: `frameIndex * frameWidth / totalFrameWidth`

The `tileShader` uses `u_numFrames` and `u_frame` to compute the UV source rectangle entirely in the fragment shader.

### Floor Lighting Modes

Selectable via `Config.engine.doFloorLighting` (on/off) and `renderer.setLightingMode('gpu' | 'cpu')`:

**CPU mode** (`renderLitFloorCPU`):
- Per-tile lighting computed in JS using `Lighting.initTile` + `Lighting.computeFrame()`
- 80×36 float32 light buffer uploaded as R32F texture each frame
- One draw call per tile; `floorLightShader` applies lighting per pixel

**GPU mode** (`renderLitFloorGPU`):
- Unlit floor rendered to an FBO (cached — invalidated only on camera move, zoom, or map change)
- Single fullscreen-quad composite via `floorLightShader` applies 200×200 tile-intensity texture
- FBO is RGBA8 at physical resolution; Y-flipped UVs for correct orientation

**Roof lighting** (`setRoofLighting`): Roof tiles bind the 1×1 zeroed `roofDummyTexture` on unit 5, so `max(tileSample=0, ambient)` = ambient → roofs are darkened only by day/night cycle, not by floor-level spotlight sources.

### Lighting Integration

```typescript
Lightmap.tile_intensity[40000]  // per-tile intensity, index = y*200+x
```

Rebuilt by `Lightmap.rebuildLight()` (called on map load / elevation change) and `Lightmap.rebuildDynamicLight()` (called each frame — only updates tiles affected by moving light sources like the player).

**Ambient light** (`GameTime.getAmbientLightNormalized()`): 0.0–1.0 normalized from the in-game hour lookup table in `gametime.ts`. Drives `u_ambient` in all world shaders.

**Per-object lighting**: Objects with `lightRadius > 0` and `lightIntensity > 0` (set from PRO data) contribute to `tile_intensity` in `Lightmap.rebuildLight()`.

**Color LUT**: `Lighting.colorLUT` and `Lighting.colorRGB` (loaded from `lut/color_lut.json`, `lut/color_rgb.json`) are used in CPU lighting mode to apply Fallout 2's original 6-bit paletted color shading. In GPU mode the shader uses the float intensity directly.

### Draw Call Pattern (one frame)

```
1. gl.clear()
2. renderFloor:
   a. Rebuild Lightmap dynamic sources
   b. Upload tile_intensity to texture unit 5
   c. [CPU] per-tile draw via floorLightShader
   d. [GPU] render unlit floor to FBO → composite with floorLightShader
   e. Switch back to tileShader
3. [Objects] renderObject per Obj via tileShader
4. [Roofs]   drawTileMap(roofTiles, -96) via tileShader (ambient-only lighting)
5. [UI]      renderImage / renderFont via tileShader (u_ambient = 1.0)
```

High-DPI displays: canvas physical size = `logicalSize * devicePixelRatio`; CSS size stays at logical resolution. Fragment shaders receive both via separate uniforms.

---

## 5. Known Deviations — DH2 vs CE

Single authoritative catalogue of every known deviation between DH2's WebGL 2.0 renderer and CE's software renderer. Documentation only — no source changes.

For scripting-level lighting deviations see `wiki/lighting.md §13` (LD1–LD6) and `wiki/known_bugs.md §21`.

### Why Deviations Exist — Context for Contributors

CE is a fixed-resolution (640 × 480) software renderer running on a CPU pixel buffer. Every draw call is a memcpy with a per-pixel palette table lookup — "darkening" a sprite means looking up a precomputed `intensityColorTable[colour_index][intensity_step]` array. There is no GPU, no floating-point colour, and no shader pipeline.

DH2 renders in WebGL 2.0: the GPU rasterises textured quads; colour values are 32-bit float RGBA; lighting is applied as a scalar float multiply in the fragment shader. The indexed-palette model is fundamentally absent at the hardware level. Any deviation that originates from this difference is **architectural** — it cannot be made identical to CE without emulating a software renderer in a canvas2D fallback, which the project explicitly rejects.

Three categories of deviation are deliberate improvements, not bugs:

1. **Dynamic resolution** — CE's fixed 640 × 480 is unsuitable for modern displays. DH2 adapts to any browser window and supports high-DPI via `devicePixelRatio`.
2. **Camera zoom** — CE has no zoom. DH2 adds a `[0.5, 3.0]` configurable range. This does not affect game logic.
3. **Automatic day/night ambient curve** — CE drives ambient intensity only through scripts (`set_global_lighting`, `set_ambient_intensity`). On maps without those script calls DH2 would be pitch black at night. The `gametime.ts` piecewise curve provides a reasonable fallback without overriding explicit script values.

**Do not "fix" these deviations toward CE behaviour.** They are architecture requirements or deliberate quality-of-life improvements.

**Decision rule for future work**: before changing any rendering behaviour, ask:

**(a)** Is this deviation causing a visible gameplay problem or a scripting-correctness problem?  
**(b)** Is the fix feasible within the WebGL 2.0 pipeline without a full rewrite?

If both yes → fix. If cosmetic/imperceptible → accept. If unsure → mark ❓ and investigate CE ground truth first.

### Deviation Table

| ID | System | CE Behaviour | DH2 Behaviour | Root Cause | Severity | Status |
|----|--------|-------------|---------------|------------|----------|--------|
| RD01 | Lighting model | Per-pixel palette-table darkening: `intensityColorTable[pal_idx][intensity/512]` (`object.cc:2771`); integer colour remapping, 256 × 256 look-up | Per-pixel float multiply: `rgb × max(tile_intensity/65536, ambient)` (`fragment.glsl:51`); continuous float colour | WebGL has no indexed palette; float multiply is the closest analogue | low | ✅ Accepted |
| RD02 | Viewport resolution | Fixed 640 × 480; `windowWidth / windowHeight` hard-wired (`tile.cc:674`) | Dynamic: `setScreenSize()` on `resize` event (`renderer.ts:53`); high-DPI via `devicePixelRatio` | Browser requirement | — | ✅ Accepted |
| RD03 | Camera zoom | Fixed 1× | Configurable `[ZOOM_MIN=0.5, ZOOM_MAX=3.0]` via `cameraZoom`; affects `viewW`, `viewH`, and all shader uniforms | DH2 extension | — | ✅ Accepted |
| RD04 | Day/night ambient | No automatic curve; ambient is set exclusively by scripts (`set_global_lighting`, `set_ambient_intensity`) | Piecewise-linear 24-hour curve in `gametime.ts`; 35 % floor at midnight, 100 % at noon; drives `u_ambient` | DH2 extension to prevent pitch-black on maps without ambient scripts | low | ✅ Accepted |
| RD05 | Floor lighting — texture filter | Sharp per-hex boundary: each tile's pixel gets exactly the integer intensity for that hex cell | GPU mode: LINEAR-filtered 200 × 200 tile-intensity texture; bilinear interpolation between adjacent hex centres (`fragmentLighting.glsl:35`) | GPU `LINEAR` filter is unavoidable with texture sampling; creates smooth gradients instead of CE's sharp edges | low | ✅ Accepted |
| RD06 | Roof clipping | `tile_fill_roof` flood-fills all connected square roof tiles when player walks under a building; re-evaluated each frame (`object.cc:1445`) | All roof tiles rendered unconditionally in `renderRoof()` (`webglrenderer.ts`); `Config.ui.showRoof` is all-or-nothing | Not implemented; `map.hasRoofAt()` exists but not wired to per-position clipping | major | ⚠️ Known Bug |
| RD07 | OBJECT_FLAT — two-pass | `_obj_render_pre_roof` renders OBJECT_FLAT objects (floor decals, blood) in a dedicated first pass before all non-flat objects (`object.cc:761`) | All objects rendered in one sorted pass; OBJECT_FLAT not read by renderer | Not implemented | minor | ⚠️ Known Bug |
| RD08 | Post-roof object pass | `_obj_render_post_roof` draws any object that must appear above roofs at full intensity (0x10000) after the roof layer (`object.cc:862`) | No post-roof pass; no object can render above the roof layer | Not implemented | minor | ⚠️ Known Bug |
| RD09 | Object depth sort | Two-phase isometric sort: `_obj_preload_sort` + `_obj_order_comp_func_even/odd` using `tileIsInFrontOf` / `tileIsToRightOf`; correct for all 6 hex directions (`object.cc:761`) | `objectZCompare` (`object.ts`): primary hex-y, secondary hex-x, tertiary walls-first; fails on NE/SW diagonal hex borders | Simplification | minor | ⚠️ Known Bug |
| RD10 | Color cycling | `colorCycleInit` / `colorCycleEnable` drives time-based palette rotation for water surfaces and fire objects (`color.cc`) | Not implemented; water and fire sprites are static colour | Not implemented | minor | ⚠️ Known Bug |
| RD11 | Scroll blocking | `gTileScrollBlockingEnabled` + `OBJECT_SCROLL_BLOCK` flag prevents viewport scrolling through certain scenery barriers | No scroll-block logic in `renderer.ts` camera update | Not implemented | minor | ⚠️ Known Bug |
| RD12 | Scroll border limiting | `gTileBorderMin/MaxX/Y` clamps viewport to usable tile area; computed from grid and window size (`tile.cc:537`) | Camera clamps to world min (0, 0) but has no computed max border; can scroll to show grey beyond map edge | Not implemented | low | ⚠️ Known Bug |
| RD13 | Hex click hit-testing | `_tile_mask[512]` lookup table (32 × 16 px, 5 sub-regions) gives pixel-precise edge detection at hex diamond corners (`tile.cc:718`) | Cube-coordinate rounding in `hexFromScreen` (`geometry.ts`); approximation at hex boundaries | Simplification | low | ⚠️ Known Bug |
| RD14 | Elevation transition | Visual fade effect between elevation levels | Instant switch; no transition (`map.ts changeElevation`) | Not implemented | low | ⚠️ Known Bug |
| RD15 | Roof tile lighting | `tileRenderRoofsInRect` blits roof tiles at full palette intensity — unaffected by any light source or time of day | Roofs bind `roofDummyTexture` (1 × 1, zeroed) on unit 5 → `max(0, ambient) = ambient`; roofs dim at night (`webglrenderer.ts`) | DH2 implementation detail — see §6 Q1 for CE ground-truth question | low | ❓ Unknown |
| RD16 | Object-lighting scripting | See `wiki/known_bugs.md §20` entries LD1–LD6 for all scripting-level lighting deviations (hidden objects, OBJECT_LIGHTING flag, `obj_set_light_level`, `set_obj_visibility`) | (cross-reference) | — | — | ⚠️ Known Bug (→ LD1–LD6) |

### Accepted Deviations — Rationale

**RD01 — Float multiply vs palette LUT.**  
`intensityColorTable` remaps 6-bit palette colours to physically darker palette entries. In WebGL, textures are 32-bit RGBA; there is no palette index to look up. The float multiply `rgb × scale` is mathematically equivalent for linear colour values and visually indistinguishable at typical monitor gamma. CPU lighting mode additionally uses `Lighting.colorLUT` (loaded from `lut/color_lut.json`) to apply the original 6-bit colour quantisation for accurate tone matching.

**RD02 — Dynamic resolution.**  
Fixed 640 × 480 is unacceptable in a browser. `setScreenSize()` keeps all viewport math consistent on window resize. No game logic depends on exact pixel dimensions.

**RD03 — Camera zoom.**  
CE has no zoom. DH2's `[0.5, 3.0]` range is a usability feature. The zoom is a pure viewport scale — it does not affect tile coordinates, pathfinding, or scripting. It is safe to keep.

**RD04 — Automatic day/night ambient curve.**  
CE leaves ambient entirely to scripts. Many shipped maps do not call `set_global_lighting` at all; without the automatic curve DH2 would be pitch black at the wrong time of day. The `gametime.ts` piecewise curve is a polyfill for absent script coverage. When a script explicitly calls `set_global_lighting`, that value replaces the automatic curve value for the duration of the map stay (via `globalState.ambientOverride`). This matches player expectations without breaking CE-authored lighting scripts.

**RD05 — GPU bilinear floor lighting.**  
CE's per-tile light is sharp: every pixel inside a hex gets exactly that hex's integer intensity. The GPU path in DH2 uses `LINEAR` filtering on the 200 × 200 tile-intensity texture, which bilinearly interpolates between adjacent hex centres. The resulting soft gradient is visually pleasing and architecturally unavoidable when sampling a texture at sub-texel precision. The CPU path (`renderLitFloorCPU`) does apply discrete per-tile values, matching CE more closely at a higher per-frame cost.

---

## 6. Known Gaps & Open Questions

### Fix Priority

Listed in descending order of gameplay impact.

#### Priority 1 — Visually blocking

| Bug | File(s) | Why it matters |
|-----|---------|----------------|
| **RD06 Roof clipping** | `webglrenderer.ts`, `map.ts` | Players can see through roofs of every building on every map. `map.hasRoofAt()` already exists; a per-frame flood-fill from the player's square tile is the missing piece. |

#### Priority 2 — Visible gameplay deviations

| Bug | File(s) | Why it matters |
|-----|---------|----------------|
| **RD09 Object depth sort** | `object.ts` | On NE/SW hex diagonals, objects overlap in the wrong order — a critter may appear behind a wall it is actually standing in front of. Affects readability in combat. |
| **LD3, LD6** (see `wiki/known_bugs.md §20`) | `scripting.ts:1262,1267` | `obj_set_light_level` does not update the lightmap and mis-scales intensity by 100×. Major scripting correctness issue. |

#### Priority 3 — Visual polish

| Bug | File(s) | Why it matters |
|-----|---------|----------------|
| **RD07 OBJECT_FLAT pass** | `renderer.ts:119` | Floor decals (blood splats, flat items) are sorted with wall-height objects; may appear behind objects that should visually rest on top of them. |
| **RD08 Post-roof pass** | `renderer.ts:119` | Objects tagged for post-roof rendering will never appear above the roof layer. Requires first auditing shipped maps for actual usage (see Q2 below). |
| **RD10 Color cycling** | — | Static water and fire lack the original animated shimmering effect. Cosmetic only. |

#### Priority 4 — Minor correctness

| Bug | File(s) | Why it matters |
|-----|---------|----------------|
| **RD11 Scroll blocking** | `renderer.ts` | Players can scroll the viewport through barriers that are meant to block the camera. |
| **RD12 Scroll border limiting** | `renderer.ts` | Camera can expose grey canvas beyond the map edge. |
| **RD13 Hex hit-testing** | `geometry.ts` | Click registration is imprecise at hex boundaries; usually imperceptible but affects small/adjacent objects. |
| **RD14 Elevation transition** | `map.ts` | Abrupt elevation switches look jarring. |

#### Investigate before prioritising

| Bug | Why investigation is needed |
|-----|-----------------------------|
| **RD15 Roof tile lighting** | CE ground truth unclear — see Q1 below. May be accepted or a bug depending on findings. |

### Open Questions

**Q1 — RD15: Does CE render roofs at full intensity or ambient-adjusted?**  
`tileRenderRoofsInRect` in CE blits roof tiles directly without calling `_obj_render_object` (which applies `intensityColorTable`). If confirmed, CE roofs are always full-bright regardless of time of day or point lights. DH2 roofs dim at night with `u_ambient`. This difference would be visible on all outdoor maps at night. Investigate `tile.cc` to confirm the CE call chain, then decide: accept (roofs look better dim) or fix (bind a full-intensity dummy texture for roofs).

**Q2 — RD08: Are post-roof objects used in any shipped Fallout 2 map?**  
`_obj_render_post_roof` iterates a `_postRoofTable`. If no vanilla script or map data populates this table, RD08 has zero practical impact on shipped content and can stay at lowest priority. Run a grep of extracted map JSON for any object with the post-roof flag set to determine real-world impact before investing in a fix.

**Q3 — RD07: Which OBJECT_FLAT objects appear in shipped maps?**  
Quantifying how many floor decals (blood, flat items, certain scenery) exist in practice calibrates priority for the two-pass fix. If OBJECT_FLAT objects are sparse and their z-fighting with non-flat objects is imperceptible in practice, the fix may safely stay deprioritised.

**Q4 — RD05: Should NEAREST filtering be used for CE-accurate sharp light edges?**  
The GPU tile-intensity texture currently uses `LINEAR` filter. Switching to `NEAREST` would produce hard per-hex boundaries matching CE's sharp light model at no performance cost. The only trade-off is visual: gradients vs sharp edges. This is a one-line change in `webglrenderer.ts` and the decision is aesthetic, not correctness-critical.
