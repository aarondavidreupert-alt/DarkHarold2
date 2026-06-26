# Rendering System

Reference doc for the Fallout 2 isometric rendering pipeline, DH2's WebGL 2.0 implementation, and the authoritative catalogue of every known deviation between DH2's renderer and CE's software renderer.

Ground truth: `raw/fallout2-ce/src/tile.cc`, `tile.h`, `object.cc`, `color.cc`  
DH2 implementation: `src/webglrenderer.ts` (barrel; `src/render/{webglContext,webglLighting,webglDraw}.ts`), `src/renderer.ts`, `src/tile.ts`, `src/geometry.ts` (barrel; `src/geometry/{hexScreen,hexGrid}.ts`), `src/map.ts` (barrel; `src/map/{GameMap,mapLoader}.ts`), `src/object.ts` (barrel; `src/object/*.ts`)

Cross-references: `wiki/lighting.md` (lighting overview and scripting-level gaps LD1–LD6 in §13), `wiki/tile_system.md`, `wiki/known_bugs.md §22` (bug registry)

Last audited: 2026-06-16

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

---

## Egg Transparency Effect

### CE implementation (`object.cc:4949–5084`)

When the player walks behind a wall or scenery that occludes them, CE renders those objects with per-pixel alpha blending using an egg-shaped mask image (`art/intrface/egg.frm`).

**Activation condition** (`object.cc:4983`):
```cpp
tileIsToRightOf(gDude, object)  // player is to the right of the wall tile
```
CE also implicitly requires the object's screen rect to intersect the player rect (occlusion). DH2 replicates this with `hexIsToRightOf(player, obj) && hexIsInFrontOf(obj, player) && hexDistance <= radius`.

**Egg rect** (`object.cc:5006`): bottom-aligned, not center-aligned.
```cpp
eggRect.left   = eggScreenX - eggWidth / 2
eggRect.top    = eggScreenY - (eggHeight - 1)   // bottom of rect = eggScreenY
eggRect.right  = eggRect.left + eggWidth - 1
eggRect.bottom = eggScreenY
```
Egg anchor = `tileToScreenXY(gEgg->tile)` + `(16, 8)` (tile-center offset).

**Blend function** `_intensity_mask_buf_to_buf` (`object.cc:2815`):
```cpp
if (mask == 0) {
    // outside egg — draw wall at full light intensity, no transparency
    *dest = intensityColorTable[src][lightIndex];
} else {
    // inside egg — blend wall with background
    v1 = intensityColorTable[*dest][128 - mask];   // background at (128-mask) intensity
    v2 = intensityColorTable[src][mask];            // wall at mask intensity
    *dest = colorMixAddTable[v2][v1];               // additive mix ≈ wall*(mask/128) + bg*((128-mask)/128)
}
```
`mask` values in `egg.frm` range 0–128:
- **0** (outside egg, transparent FRM pixels = palette index 0) → wall fully opaque
- **128** (center white pixels) → wall at full intensity + background at 0 → wall appears opaque in center
- **1–127** (border gradient) → wall fades in, background fades out

> Note: The CE egg creates a GRADIENT FADE of wall opacity from border to center — the center is visually clear of obstructions because the wall is blended with the (already-rendered) background at full-background weight at the edges, grading to full-wall weight at the center. Read in conjunction with the jsFO approach below.

**egg.frm dimensions**: 129 × 98 px (working rect; full FRM may be slightly larger).

### jsFO implementation (`src/gamestate/MainState.js:876–1050`)

jsFO uses Canvas 2D compositing rather than per-pixel blending.

**Algorithm**:
1. Clear `eggBuffer` (300×300 offscreen canvas).
2. Draw `egg.png` (white oval, transparent outside) onto `eggContext` with `"source-over"`.
3. Floor tiles intersecting `eggBufferRect` → drawn to `eggContext` with `"source-atop"` (clips to egg oval).
4. All map objects → drawn to main `_context` normally (full opacity).
5. For objects intersecting `eggBufferRect`:
   - Walls where `!(cRow < pRow || cCol < pCol)` (wall "in front" of player) → **skip** eggContext draw.
   - All other objects → drawn to `eggContext` with `"source-atop"`.
6. Roofs → main `_context` only.
7. `_context.drawImage(eggBuffer, eggBufferRect.x, eggBufferRect.y)` — composites egg buffer over main.

**Effect**: In the egg zone, the occluding walls are absent from `eggBuffer`. When `eggBuffer` is composited on top, those pixels get overwritten by floor/objects that were drawn BEHIND the wall. This effectively hides the occluding wall inside the egg oval.

**Wall filter** (opposite of CE):
- CE: `tileIsToRightOf(gDude, object)` — player RIGHT of wall → egg applies
- jsFO: `cRow < pRow || cCol < pCol` — wall row/col LESS THAN player → egg applies (wall behind player)

**Egg buffer rect**:
- Dimensions: 129 × 98 px
- Position: `x = playerX - 64, y = playerY - 84` (i.e. `playerX - width/2`, `playerY - height/2 - 35`)
- Player screen anchor: `tileToScreen(hexPos) + (16, 8) + animShift - camera`

### DH2 implementation (`shaders/fragment.glsl`, `src/render/webglDraw.ts`, `src/render/webglContext.ts`)

DH2 approximates the CE blend in the fragment shader using the egg.png R channel as a mask weight.

**Two modes** (toggle: `setEggMode('alpha')` / `setEggMode('egg')`):

| Mode | Behaviour |
|------|-----------|
| `'alpha'` (default) | Flat alpha applied to entire qualifying wall sprite. Alpha tunable: `setEggAlpha(0.4)`. |
| `'egg'` | egg.png R channel modulates per-fragment alpha. White center → `alpha=0` (invisible wall). Border → `alpha=u_alpha`. |

**Shader logic** (fragment.glsl):
```glsl
float mask = texture2D(u_eggTex, eggUV).r;
alpha = mix(u_alpha, 0.0, mask);  // white=fully transparent, dark=flat alpha
```

**Coordinates**: egg center is passed as world-space `(ps.x + 16, ps.y + 8)`. Fragment world position is computed identically to `getWorldTileLight()` so the egg UV is zoom-independent.

**Qualification** (`isEggObject` in webglDraw.ts):
```typescript
hexIsInFrontOf(obj.position, player.position)   // wall renders above player (occludes)
&& hexIsToRightOf(player.position, obj.position) // CE: tileIsToRightOf(gDude, obj)
&& hexDistance(player.position, obj.position) <= getEggRadius()
```
Radius and alpha tunable at runtime: `setEggRadius(8)`, `setEggAlpha(0.4)`.

**Status**: confirmed working (RD16, 2026-06-15; refined 2026-06-17; gradient restored 2026-06-23; directional-asymmetry symptom resolved 2026-06-26 by cache invalidation — see note below).

**2026-06-23 — real gradient restored, binary cutoff removed**: `art/intrface/egg.png` was replaced again. The jsFO-sourced binary mask (alpha = hard 0/1) is gone; `tools/export_mask_frms.py` now exports the FRM's raw mask bytes with correct semantics. Key findings from spatial pixel inspection: CE's egg data has **low bytes (~1) at the oval center and high bytes (~120) at the perimeter** — the opposite of the "bright center" assumption. The converter rescales from CE's 0–128 scale to 0–255 alpha then **inverts non-zero values** (`alpha = 255 - scaled`) so that center → high alpha → `mix(1.0, 0.0, mask)` → transparent wall, perimeter → low alpha → opaque wall, giving a smooth CRT "oval cutout" the jsFO binary only approximated. The shader formula (`float mask = texture2D(u_eggTex, eggUV).a; alpha = mix(1.0, 0.0, mask)`) is unchanged — the binary version worked for the same reason the gradient does, just with no falloff. `src/render/webglContext.ts` URL bumped to `?v=20260623b` to force browser cache invalidation.

**2026-06-17 fixes**:
- Egg anchor is derived from the player's actual per-frame `objectRenderInfo` (`x + frameWidth/2`, `y + frameHeight` — the bottom-center foot point, including walk-animation shift), not the raw hex position plus a CE-style `+16/+8` corner-to-center correction. DH2's `hexToScreen()` already returns a foot/bottom-center anchor — unlike CE's `tileToScreenXY`, which returns a tile *corner* and needs the `+16/+8` fudge to reach center. Applying that fudge on top of DH2's already-centered anchor shifted the egg one half-hex tile to the NW. **Pitfall hit during the fix**: the first pass reconstructed the anchor using `uniformFrameWidth`/`uniformFrameHeight` (the sprite-sheet's padded per-slot frame size) instead of `frameWidth`/`frameHeight` (the actual trimmed bounding box of the current frame — what `offsetX`/`offsetY` in `objectRenderInfo` were computed against). These two sizes differ whenever animation frames have different trimmed content sizes, leaving a residual offset of half the padding delta even after the `+16/+8` fudge was removed.
- In `'egg'` mode the wall now defaults to **fully opaque** (`alpha = 1.0`) everywhere outside the small egg-texture footprint, fading toward 0 only inside the oval — matching CE, which has no separate flat-alpha fallback layer. Previously the shader used `mix(u_alpha, 0.0, mask)`, which painted the whole qualifying wall at flat 40% alpha with just a clear hole cut in the center.
- `art/intrface/egg.png` as produced by the DH2 asset pipeline showed visible colored rings instead of a smooth gradient. Root cause: the pipeline's FRM→PNG conversion resolves every FRM's raw pixel bytes through the normal Fallout palette to produce a displayable RGBA image — correct for sprites, but egg.frm's pixel bytes are mask-intensity values, not palette indices meant to be displayed as color. Different intensity steps land on different (often non-gray) palette entries, producing visible hue rings at each step boundary. Fix: replaced `art/intrface/egg.png` with a clean alpha-channel mask (solid white RGB, oval shape encoded in alpha) sourced from jsFO's `inc/egg.png`, and switched the shader to sample `.a` instead of `.r`. Note this mask is a hard binary cutout (0 or 255 alpha, no gradient) — edge softness now comes only from the texture's bilinear filtering (`LINEAR` min/mag already set), not from a multi-step intensity ramp like the original CE-derived PNG had.
- `_loadEggTexture()` now appends a cache-busting query string (`?v=Date.now()`) to the image URL, matching the pattern already used for shader fetches in `main.ts`. Without it, replacing `egg.png` on disk and reloading the page could keep serving an old cached copy.
- **2026-06-18 — root-caused the asymmetric-growth bug.** User-reported symptom: walking toward a wall in `'alpha'` mode revealed transparency growing on only one side (left), not symmetrically, as the qualification radius enclosed more wall tiles. Root cause: CE's `_obj_render()` occlusion test is not one fixed formula — it's 4 different combinations of `tileIsInFrontOf`/`tileIsToRightOf` selected by bits in the wall/scenery's own `extendedFlags` (`flags_ext`):
  - `extendedFlags & (0x8000000 | 0x80000000)`: `v = frontOD`, overridden to `false` if `frontOD && rightOD && OBJECT_WALL_TRANS_END`
  - `extendedFlags & 0x10000000`: `v = frontOD || rightDO`
  - `extendedFlags & 0x20000000`: `v = frontOD && rightDO`
  - default: `v = rightDO`, overridden to `false` if `rightDO && frontDO && OBJECT_WALL_TRANS_END`

  (`OD`/`DO` = argument order — object-then-dude vs dude-then-object; these CE functions are not symmetric under argument swap, so order must be preserved exactly per case.) `isEggObject()` previously hardcoded the `AND` case (`frontOD && rightDO`) for *every* wall unconditionally — that's literally CE's `0x20000000` case applied regardless of what a wall's actual `extendedFlags` select, which only produces symmetric growth for one specific wall facing.

  Deeper problem: DH2's proto extractor (`tools/proto.py`'s `readPRO()`) never had a parse case for `TYPE_WALL` — it fell into `else: print("unhandled type")` and extracted zero wall-specific fields, so `extendedFlags` wasn't even available to read. Fixed by adding `readWall()` (byte order verified against CE's `proto.cc protoRead() case OBJ_TYPE_WALL`: `extendedFlags`, `sid`, `material`, each a 32-bit int) and wiring it into `readPRO()`. Also reconstructed scenery's `extendedFlags` — its existing `wallLightTypeFlags`/`actionFlags` 16-bit reads are CE's single 32-bit `flags_ext` split into halves, so `extendedFlags = (wallLightTypeFlags << 16) | actionFlags` recovers it without disturbing the original two fields (still used elsewhere, e.g. `Obj.ts:792`).

  `proto/pro.json` was regenerated directly from the existing local `data/proto/*.pro` files (item/critter/scenery/wall/misc counts verified unchanged — only new `extra` fields added, no data loss). CE ref: `object.cc:4949`; `obj_types.h:81 OBJECT_WALL_TRANS_END`; `proto_types.h:411 WallProto`; `proto.cc:1709-1717`. See `wiki/known_bugs.md` RD16.

  **Follow-up (2026-06-18)**: the 4-case branching fixed `'egg'` mode but `'alpha'` mode still showed the same one-sided NW-SE cutoff, plus affected walls behind the player. Root cause: `tileIsInFrontOf`/`tileIsToRightOf` aren't distance checks — they're `dx <= dy*k` half-plane line tests in screen space, whose boundary geometrically *is* the NW-SE hex axis. That's correct and deliberate for CE/`'egg'` mode (the real egg effect is "is this wall between the fixed-angle isometric camera and the player," inherently one-sided, never a symmetric bubble). `'alpha'` mode is a DH2 invention with no CE equivalent, meant to behave like a symmetric "see-through bubble around me," so it shouldn't use the camera-facing directional test as its qualification at all. Split `isEggObject()`: the CE branching moved to `isCEOccludingWall()`, used only when `eggMode === 'egg'`; `'alpha'` mode now qualifies purely on `hexDistance(player, obj) <= radius`, with no directional component — genuinely symmetric in every direction.

**2026-06-26 — residual directional asymmetry traced to stale IndexedDB cache (no code change required)**: After all the code fixes above were in place, the egg effect still appeared to affect only walls to the screen-left. Investigation confirmed that `tools/proto.py` already contained `readWall()` (correctly reading `extendedFlags`, `scriptID`, `material` as three consecutive 32-bit ints — added in the 2026-06-18 sprint), that `proto/pro.json` already had non-zero `extendedFlags` for 3061 of 3484 wall/scenery entries (e.g., `walls[1].extra.extendedFlags = 0x20000000`, `walls[2].extra.extendedFlags = 0x8000000`), and that `isCEOccludingWall` was CE-faithful. The symptom — `debugEgg()` showing `extendedFlags = 0` for every sampled wall — was caused entirely by the browser's IndexedDB cache serving a stale `proMap` that predated the 2026-06-18 code changes. **Fix: `clearAssetCache()` (calls `IDBCache.nuke()`, commit fa0fc2b) + page reload.** No source files required changing. `debugEgg()`'s `wallExtendedFlagsSample` field flags a stale cache automatically.

---

## Combat Outline Effect (implemented 2026-06-18)

**CE source**: `object.cc:4629 objectDrawOutline()`, `object.cc:874 _obj_render_post_roof()`, `combat.cc:2669 _combat_update_critter_outline_for_los()`, `obj_types.h:36 OutlineType`.

User-reported memory: combatants get a 1px outline visible *through walls* (red for hostiles), and a green variant for "companions" — confirmed by reading CE source, though the green case is **not perk-gated**; it's plain team comparison.

**CE mechanism**:
1. `OutlineType` enum: `HOSTILE=1`, `2`, `4`, `FRIENDLY=8`, `ITEM=16`, `32`. `combat.cc`'s `_combat_update_critter_outline_for_los()` assigns `HOSTILE` or `FRIENDLY` to each combatant by comparing `critter->data.critter.combat.team` to the player's team — same-team critters (including companions, who share the player's team) get `FRIENDLY` automatically. No perk involved.
2. Color: `objectDrawOutline()` resolves `HOSTILE` → palette index 243 (red), `FRIENDLY` → palette index 229 (green), then cycles a few nearby palette shades down the sprite height for a "shimmer" effect (5 phases for hostile, 4 for friendly — `v43`/`v44` in the CE source).
3. Drawing: `objectDrawOutline()` scans the sprite's alpha/transparency boundary in both horizontal and vertical directions and paints a literal 1px silhouette border at the transparent↔opaque transition.
4. **Why it shows through walls**: during the main per-tile depth-sorted render pass (`_obj_render_pre_roof`), every object draws normally *and*, if it has a nonzero outline, gets added to a `_outlinedObjects[]` list — but the outline itself is NOT drawn yet. Only later, in `_obj_render_post_roof()` (called after roof tiles for the frame), does CE loop that list and call `objectDrawOutline()` for each, painting the border on top of whatever was already drawn (walls, roofs, other objects) in that frame. The outline is a deliberately separate, depth-ignorant render pass — that's the entire mechanism, not a special "see through occluders" shader trick.

**DH2 implementation**:
- `obj.outline` (already existed, `string | null`) is now actually rendered — previously `WebGLRenderer.renderObjectOutlined()` was a no-op alias for `renderObject()` (CI11, `wiki/known_bugs.md`).
- New shader uniforms `u_outlineMode`/`u_outlineColor` in `fragment.glsl`: when set, bypass lighting and the egg/alpha logic entirely, output `vec4(outlineColor, texel.a > 0.5 ? 1.0 : 0.0)` — a flat solid-color silhouette stamp.
- `WebGLRenderer.renderOutlinePass(objs)` (`webglDraw.ts`) stamps each outlined object's silhouette at 4 cardinal 1px-screen-space offsets (scaled by zoom) around its normal draw position, using the same texture/UV/frame as the normal sprite. This avoids sampling neighboring texels in the shader (which would risk bleeding across frames in the sprite atlas if the silhouette boundary falls near a frame edge) — the offset-stamp technique only ever samples within the current frame's own UV rect.
- Called from `renderer.ts`'s `render()` right after `renderRoof()` — exploiting the renderer's existing painter's-algorithm draw order (every quad sits at the same GL depth=0 with `depthFunc(LEQUAL)`, so later draws always win regardless of depth; see `webglContext.ts init()`). This is the DH2-equivalent of CE's separate post-roof pass and is what makes the outline visible through walls/roofs without any special occlusion-bypass shader logic.
- `Combat.refreshHighlights()` extended to assign `'green'` to same-team combatants (was previously skipped entirely) alongside the existing `'red'` for hostiles, matching CE's plain team-comparison rule.
- **Deliberate simplification**: DH2 uses one flat color per outline type. CE's palette-shade cycling down the sprite height (the "shimmer") is not replicated — would require resolving palette bands through `data/color.pal` and adds visual complexity disproportionate to the gameplay value (the outline's job is target identification, which a flat color already serves).

**Follow-up (2026-06-18) — ground-item outline (`OUTLINE_TYPE_ITEM`)**: user asked whether the same outline mechanism applied to items lying on the ground, and whether it was hover-based, always-on, or an options toggle. Confirmed against CE source (`game_mouse.cc:680`, `:1949 gameMouseLoadItemHighlight()`, `preferences.cc`, `settings.h:33`): `item_highlight` is a **persistent Options checkbox** (default `true`), no key involved — while on, CE outlines only the single item currently under the mouse cursor, live, via `gameMouseGetObjectUnderCursor()`. `OUTLINE_TYPE_ITEM` is queued into the same `_outlinedObjects[]` list as combat outlines, so a hovered item highlights through occluding scenery too via the post-roof pass described above. See `wiki/known_bugs.md` CI12 for the fix — DH2 already had a correctly-wired preferences checkbox for this exact setting, but a Spacebar key handler was hijacking the same flag for an unrelated "highlight everything" sweep; the two are now independent (`Config.ui.itemHighlight` = the real CE preference, driving a persistent `obj.outline` on the hovered item; `globalState.highlightItemsKeyHeld` = the DH2-only sweep, runtime state only, not a saved preference).

**Follow-up (2026-06-18) — fill vs. border alpha (CI13/CI14, not CE-accurate, kept by request)**: the 4-offset-stamp technique above reads as a near-total solid fill rather than a thin edge in practice (a 1px screen-space shift barely changes which pixels fall inside a typical sprite's silhouette, so the 4 stamps nearly fully overlap the sprite's own footprint). The user liked this look and asked to keep it, but wanted independent alpha control over the fill vs. an additional border layer.

CI13's first attempt drew the 4 border stamps directly, then one more fill stamp on top, both in the same color — and the user reported the fill alpha "seems to have no effect." That's because stacking two same-colored alpha layers reduces to `outlineColor·[1-(1-fill)(1-border)] + litSprite·[(1-fill)(1-border)]`: once `border=1` (the default), `(1-border)=0` zeroes the whole `(1-fill)(1-border)` term regardless of `fill`'s value — blending a color over an already-opaque layer of the *same* color is a no-op at any alpha. Not a math bug in the uniform itself, just an architecture that couldn't give independent control once one layer was opaque.

CI14 fixed this by inserting a punch-out step between the two layers: (1) draw the 4 border stamps at `Config.ui.outlineBorderAlpha`, (2) redraw the object *normally* (regular lit shader path, not outline mode) at its unshifted position — restoring the interior to the normal sprite, leaving only the border stamps' protruding edge visible, turning step 1 from "near-total fill" into an actual border — (3) draw one more outline-mode stamp at `Config.ui.outlineFillAlpha` on top of the now-restored normal sprite. `borderAlpha=1, fillAlpha=0` now gives a crisp opaque border with a normal-colored interior; `borderAlpha=0, fillAlpha=0.5` gives a translucent fill with no border at all — genuinely independent. Either alpha at 0 skips that layer's draw calls entirely. New shader uniform `u_outlineAlpha` (the previous binary `texel.a > 0.5 ? 1.0 : 0.0` became `texel.a > 0.5 ? u_outlineAlpha : 0.0`, set per-draw). Tunable live via `setOutlineFillAlpha()`/`setOutlineBorderAlpha()` in the console. This whole feature is a deliberate stylistic departure from CE (which draws a true single-pixel edge, no fill, no border/fill split at all), not a bug to fix later. Defaults reset to `outlineBorderAlpha=0.5`, `outlineFillAlpha=0.2` per follow-up user request (CI15).

**Follow-up (2026-06-18) — neutral-critter outline (CI15, DH2 addition, no CE equivalent)**: user wanted to be able to spot an unprovoked target (e.g. a neutral critter standing behind a wall) before attacking. CE's outline system only ever covers active combatants (`this.combatants` — player, trigger-team members, and already-hostile critters); a critter that's simply neutral (not on the player's team, not yet hostile) was never touched by `refreshHighlights()`. Added a new `'blue'` outline color, gated by the same on/off/targeting-only preference logic, so neutral critters now show through walls the same way hostile ones do (CI11's post-roof late pass).

The first attempt kept the existing combatant/non-combatant split — red/green for anyone in `this.combatants`, blue for everyone else not already in that set. User reported zero highlights (not even blue) right after starting combat via the HUD gun button. Root cause: `Combat.start()` for a player-initiated fight sweeps *every team on the current map* into `triggerTeams` so any enemy can join in, meaning `this.combatants` already contains nearly every living critter on the elevation regardless of hostility. Those not-yet-hostile, different-team critters were skipped by the red/green loop (not hostile yet) *and* excluded from the blue loop (already "a combatant") — a gap with no outline at all. Fixed by dropping the split entirely: `refreshHighlights()` now classifies every live, visible critter on `globalState.gMap.getObjects()` (current elevation) in one unified pass — hostile → red, same team → green, else → blue — with no reference to `this.combatants`. `clearNeutralOutlines()` (map-wide scan clearing any `outline === 'blue'`, called from `Combat.end()`/`forceEnd()`) stays as a safety net, since `this.combatants` still doesn't necessarily cover every critter that could be blue-outlined (e.g. an NPC-initiated fight via `forceTurn` only sweeps the player's and attacker's team, leaving uninvolved third parties elsewhere out of `this.combatants` but still blue).

## Dialogue Talking-Head Screen Highlights (researched + implemented 2026-06-23)

User remembered `hilight1.png`/`hilight2.png` should be "overlayed on the screen" to "simulate the screen curvature" of the dialogue head-display area — confirmed against CE source. **Not** a full-screen overlay; it's localized to the talking-head/portrait display rect inside the dialogue window.

**CE source**: `game_dialog.cc:4549 gameDialogRenderTalkingHead()`, `:4526 gameDialogRenderHighlight()`, `:4675 gameDialogHighlightsInit()`.

**What the head-display area actually shows** (`gameDialogRenderTalkingHead`, `:4549-4627`): a 388×200 rect at `(126,14)`–`(514,214)` within the dialogue background window (DH2 equivalent: `#dialogueContainer`, which is conveniently already 640×480 — the exact size of `gGameDialogBackgroundWindow`). If the speaker has talking-head art (`headFrm != nullptr`), CE blits that NPC's background plate (388×200, `gGameDialogBackground` FRM) plus the current head animation frame into the rect. **If the speaker has no head art at all, CE instead crops and blits a live 388×200 slice of the isometric game view (`gIsoWindow`)** as the "screen" content (`:4605-4627`) — i.e. the dialogue "TV" can literally show a window into the game world mid-conversation, not just a portrait. DH2 currently does neither: `#dialogueContainer`'s background is a single static `alltlk.png`, with no head-art rendering and no game-view crop — this is a separate, larger pre-existing gap from the highlight effect itself, noted here since it's the same code path.

**The highlight overlay itself** (`gameDialogRenderHighlight`, `:4526-4546`, called from `:4637` and `:4648` every time the talking head is (re)rendered — i.e. every animation frame during lip-sync, not just once):
```cpp
void gameDialogRenderHighlight(src, srcWidth, srcHeight, srcPitch, dest, destX, destY, destPitch, a9 /*blendTable*/, a10 /*grayTable*/)
{
    dest += destPitch * destY + destX;
    for (y = 0; y < srcHeight; y++) {
        for (x = 0; x < srcWidth; x++) {
            v1 = *src++;
            if (v1 != 0) v1 = (256 - v1) >> 4;     // pixel value used as an intensity/weight, NOT a literal color
            v15 = *dest;
            *dest++ = a9[256 * v1 + v15];           // blend-table lookup keyed by (intensity, existing background pixel)
        }
        ...
    }
}
```
Two calls, two images, two different blend tables:
- **Upper highlight** (`hilight1.frm`/`hilight1.png`, confirmed **89×81px**) at `destX=426, destY=15`, using `_light_BlendTable`/`_light_GrayTable` (derived from `_colorTable[17969]`) — a lightening glint, upper-right of the head rect.
- **Lower highlight** (`hilight2.frm`/`hilight2.png`, confirmed **137×131px**) at `destX=129, destY=214-height-2=81`, using `_dark_BlendTable`/`_dark_GrayTable` (derived from `_colorTable[22187]`) — a darkening shadow, lower-left.

`_light_GrayTable`/`_dark_GrayTable` are precomputed per-palette-index luminance lookup tables (`gameDialogHighlightsInit`, `:4675-4690`: `_light_GrayTable[c] = ((r+2g+2b)/10)>>2`, `_dark_GrayTable[c] = ((r+g+b)/10)>>2` from each palette color's RGB). **Important**: this means `hilight1.png`/`hilight2.png` are not meant to be displayed as literal images at all — every non-zero pixel value is reinterpreted purely as a blend-weight/mask (hence the garish raw palette colors when previewed directly: index values, not real RGB). The net visual effect is a fixed-position soft glint (upper-right) + shadow (lower-left) painted over whatever's currently in the head-display rect, every frame — exactly the "curved glass/CRT screen" look the user described, achieved via palette-index math rather than alpha-blended sprites.

**DH2 implementation (2026-06-23/24)** — went through several corrective iterations, final state described here:

**Asset pipeline** (`tools/export_mask_frms.py`, standalone — does NOT touch `tools/frmpixels.py`/`tools/exportImagesPar.py`):
- Parses each FRM's raw mask bytes without palette lookup.
- `egg.png`: white RGBA, alpha = raw byte rescaled from 0–128, then **inverted for non-zero pixels** (`255 - scaled`). Spatial inspection confirmed CE's egg data has LOW bytes at center (~1) and HIGH bytes at perimeter (~120) — a ring transparency pattern where the oval shell is most transparent. Inversion maps center → high alpha → transparent wall, perimeter → low alpha → near-opaque wall, giving the DH2 "center reveals player through wall" oval behaviour that matches visual expectations and restores the original hand-patched egg's intent with a real gradient. WebGL URL version-bumped in `src/render/webglContext.ts` (`?v=20260623b`) to bypass browser texture cache on regeneration.
- `hilight1.png`: R=G=B=255, A=`(255 − raw)` — white semi-transparent, **direction inverted** to match CE's `(256-v)>>4` formula which makes low raw bytes = strongest effect. Plain alpha compositing lightens the area beneath.
- `hilight2.png`: **Color is set in code, not in the FRM.** `HILIGHT2_COLOR = (255, 140, 30)` (amber) is a named constant in `tools/export_mask_frms.py`, baked into the PNG's RGB channels at conversion time — edit that constant and re-run the script to change the hue. CE's `_dark_BlendTable` is derived from `_colorTable[22187]` = `colorMixAddTable[86][171]`: an **additive** blend of palette[86]=[120,148,120] and palette[171]=[212,172,124] clamps to near-white [255,255,244]. The actual visual effect in the original FO2 game is a warm amber glow at the lower-left of the head rect (vacuum-tube cathode warmth). The amber value was **user-confirmed** to visually match the original game at `HIGHLIGHT_STRENGTH=1.0`. A 2026-06-24 attempt to change it to `(160,144,124)` based on incorrectly assuming averaging rather than additive mixing caused the effect to look "white and very dim" and was immediately reverted. See `wiki/palette_colors.md §3.1` for the full derivation. `HIGHLIGHT_STRENGTH` (= 1.0) and `HILIGHT2_COLOR` are named constants for easy re-tuning.

**Why `mix-blend-mode: screen/multiply` was abandoned**: `screen(white, x) = white` for any x — the blend produces solid white regardless of backdrop, making alpha only scale the opacity of that white result. `multiply(white, x) = x` — white is multiply's identity, so solid-white pixels produce no visual change at all. Plain alpha compositing (no blend mode) correctly composites white/amber semi-transparent pixels over whatever is beneath.

**Rendering** (`play.html`, `ui.css`): `#dialogueHighlightUpper`/`#dialogueHighlightLower` permanent `<img>` elements inside `#dialogueContainer` at CE-verified positions (426,15 / 129,81), `opacity: 1` (full PNG alpha, confirmed visually matching the original CE game). CSS `opacity` is the sole runtime strength control — range 0–1 — accessible via `setDialogueHighlights(upper, lower)` in the browser console (`src/main.ts`).

**Not yet addressed**: the talking-head/game-view content gap — DH2's head rect remains the static `alltlk.png` (no head animation, no live game-view crop). The highlights composite against that for now. Full fidelity requires that separate, larger gap to be implemented.

**Known simplification**: CE's exact per-palette-index gray-table blend is not ported; plain white/amber alpha compositing approximates the visual character. Not pixel-identical but confirmed close to the original by in-game visual comparison.

See `wiki/known_bugs.md` P22 for full citations.
