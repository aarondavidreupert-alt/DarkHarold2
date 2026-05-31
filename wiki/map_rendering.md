# Map Rendering System

Reference doc for the Fallout 2 isometric rendering pipeline and DH2's WebGL 2.0 implementation.  
Covers coordinate math, hex grid, render order, object positioning, roof clipping, and lighting.

Ground truth: `raw/fallout2-ce/src/tile.cc`, `tile.h`, `object.cc`  
DH2 implementation: `src/webglrenderer.ts`, `src/renderer.ts`, `src/tile.ts`, `src/geometry.ts`, `src/map.ts`, `src/object.ts`

---

## 1. Isometric Projection

Fallout 2 uses a **staggered isometric hex grid**, not a classical 45° diamond grid. Two coordinate systems coexist:

- **Hex tiles** — 32×16 px, used for objects, critters, pathfinding
- **Square tiles** — 80×36 px, used for floor/roof sprites (each square covers 2×2 hex cells)

### CE tileToScreenXY (`tile.cc:674`)

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

### CE tileFromScreenXY (`tile.cc:718`)

Inverse: pixel → tileNum. Uses a precomputed `_tile_mask[512]` lookup table (32×16, 5-region classification) to handle sub-tile hit-testing at the diamond edge and corners.

### DH2 Square Tile Projection (`src/tile.ts:30`)

DH2's `tileToScreen(x, y)` takes explicit grid coordinates (not a tileNum), with x pre-reversed:

```typescript
x = 99 - x               // tile grid x is stored 0-99 from right-to-left
sx = 4752 + 32 * y - 48 * x
sy = 24 * y + 12 * x
```

This produces the same stagger as CE: each grid row shifts 32px right and 24px down; each column shifts −48px horizontally and +12px vertically.

Tile coordinate encoding: `tileNum = y * 200 + x`, where x and y are 0-based grid coords (`src/tile.ts:22`).

### DH2 Hex Object Projection (`src/geometry.ts:43`)

Objects (critters, items, scenery, walls) use hex positions, converted via:

```typescript
function hexToScreen(x: number, y: number): Point {
    const sx = 4816 - ((((x + 1) >> 1) << 5) + ((x >> 1) << 4) - (y << 4))
    const sy = 12 * (x >> 1) + y * 12 + 11
    return { x: sx, y: sy }
}
```

This is distinct from `tileToScreen` — the hex grid is twice as fine as the square tile grid, and hex coordinates run in the opposite x direction.

### Constants

| Constant | Value | Location |
|----------|-------|----------|
| `TILE_WIDTH` | 80 | `src/tile.ts:19` |
| `TILE_HEIGHT` | 36 | `src/tile.ts:20` |
| `HEX_WIDTH` | 32 | `src/geometry.ts:22` |
| `HEX_HEIGHT` | 16 | `src/geometry.ts:23` |
| `HEX_GRID_SIZE` | 200 | `src/geometry.ts:20` |
| Grid dimensions | 200 × 200 | both CE and DH2 |

---

## 2. Hex Grid

### Coordinate System

The playfield is a 200×200 hex grid. Each position is stored as `(x, y)` with `x` running left-to-right (0–199) and `y` running top-to-bottom (0–199).

**CE tileNum encoding**: `tile = gHexGridWidth * tile_y + (gHexGridWidth - 1 - tile_x)` — CE stores x reversed (column 0 is at the right edge). All `tile % gHexGridWidth` operations in CE yield the reversed x.

**DH2 tileNum encoding**: `tileNum = y * 200 + x` — x is stored normally (column 0 is at the left edge). `src/tile.ts:22-27`.

### Hex Neighbour Offsets

CE uses `_dir_tile[parity][6]` precomputed offset arrays (`tile.cc:186`), where `parity = (tile % gHexGridWidth) & 1`:

```
parity=0 (even reversed-x):
  dir0: -1,      dir1: +199,    dir2: +200,    dir3: +201,    dir4: +1,    dir5: -200
parity=1 (odd reversed-x):
  dir0: -201,    dir1: -1,      dir2: +200,    dir3: +1,      dir4: -199,  dir5: -200
```

These offsets on the tileNum directly give the adjacent tile in each of the 6 directions. `tileGetTileInDirection` (`tile.cc:892`) applies one offset per step.

DH2's `hexNeighbors(position)` (`geometry.ts:139`) returns explicit `{x, y}` points:

```
even x:  [(-1,y), (-1,y+1), (x,y+1), (+1,y+1), (+1,y), (x,y-1)]  // dirs 0–5
odd  x:  [(-1,y-1), (-1,y), (x,y+1), (+1,y), (+1,y-1), (x,y-1)]  // dirs 0–5
```

Direction 0 = NW (or N on even columns), increasing clockwise.

### Hex Distance

CE's `tileDistanceBetween` (`tile.cc:797`) iterates using `_dir_tile` offsets — O(n) walk rather than a formula.

DH2's `hexDistance(a, b)` (`geometry.ts:200`) converts to cube coordinates and uses Chebyshev:

```typescript
cubeA = hexGridToCube(a)   // offset → cube coords
cubeB = hexGridToCube(b)
return Math.max(|ax-bx|, |ay-by|, |az-bz|)
```

---

## 3. Render Order

### CE Pipeline (`tileRefreshGame`, `tile.cc:634`)

```
1. bufferFill (clear dirty rect)
2. tileRenderFloorsInRect      — draw all floor tiles in rect
3. _obj_render_pre_roof        — draw objects below roofline
4. tileRenderRoofsInRect       — draw roof tiles (with clipping applied)
5. _obj_render_post_roof       — draw objects that appear above roofs (none by default)
6. gTileWindowRefreshProc      — blit to screen
```

`_obj_render_pre_roof` (`object.cc:761`) iterates tiles in a precomputed isometric sort order (`_orderTable[parity]`). For each tile it renders:
1. `OBJECT_FLAT` objects (e.g., floor decals)
2. All remaining objects in the render table — drawn back-to-front

CE's per-tile render table is sorted by `_obj_order_comp_func_even/odd` which encodes isometric depth by interleaving tile row/column offsets.

Object depth tie-breaking uses `tileIsInFrontOf` and `tileIsToRightOf`:

```c
// tileIsInFrontOf: tile1 is rendered in front of tile2
// Condition: dx <= dy * -4.0  (tile is "above" the other in isometric space)
return (double)dx <= (double)dy * -4.0;
```

### DH2 Pipeline (`Renderer.render()`, `renderer.ts:119`)

```
1. renderFloor(floorTiles)   — floor tiles (lit or unlit depending on Config.engine.doFloorLighting)
2. hex_outline cursor overlay (if cursorMode === 'move')
3. renderObjects(objects)    — all objects in current sorted order
4. renderRoof(roofTiles)     — roof tiles (no clipping applied)
5. UI windows
6. Float messages
7. Cursor overlay
```

### DH2 Object Sort (`objectZCompare`, `object.ts:182`)

Objects are sorted by a simplified key:

```typescript
// Primary: hex y (north-to-south), ascending
// Secondary: hex x (west-to-east), ascending
// Tertiary: walls before non-walls at same tile
```

This is **not** equivalent to CE's isometric-correct sort. CE uses a two-phase algorithm (`_obj_preload_sort` then the per-parity offset table) that correctly handles all 6 hex directions. DH2's Y-then-X sort produces correct results for most cases but fails at the north-east / south-west diagonals.

Object insertion after movement uses `objectZOrder` (`object.ts:212`) which does an in-place insertion-sort into the live objects array.

---

## 4. Object Screen Positioning

### CE

`_obj_render_object` calls `tileToScreenXY(object->tile)` to get the base screen position, then adds FRM per-frame/direction offset data from the art cache.

### DH2 (`objectRenderInfo`, `renderer.ts:284`)

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

---

## 5. Viewport & Camera

### CE (`tile.cc:537–608`)

```c
// After tileSetCenter(tile):
_tile_x = gHexGridWidth - 1 - (tile % gHexGridWidth)  // reversed x of center tile
_tile_y = tile / gHexGridWidth                         // y of center tile
_tile_offx = (windowWidth - 32) / 2    // screen X of center tile
_tile_offy = (windowHeight - 16) / 2   // screen Y of center tile
gCenterTile = tile
```

All `tileToScreenXY` calculations are relative to `(_tile_x, _tile_y, _tile_offx, _tile_offy)`. To center on the player, CE calls `tileSetCenter(gDude->tile)`.

Scroll restrictions:
- `gTileScrollBlockingEnabled`: prevents scrolling through OBJECT_SCROLL_BLOCK objects
- `gTileScrollLimitingEnabled`: prevents scrolling beyond `gTileBorderMin/MaxX/Y` (computed from viewport/grid size)

Mouse picking (screen → tile): `tileFromScreenXY(mouseX, mouseY, elevation)` (`tile.cc:718`)

### DH2 (`src/renderer.ts`, `src/tile.ts`)

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

Mouse picking (screen → hex): `hexFromScreen(screenToWorld(mouseX, mouseY))` via cube-coordinate rounding (`geometry.ts:135`).

Mouse picking (screen → square tile): `tileFromScreen(worldX, worldY)` (`tile.ts:38`):
```typescript
off_x = -4800 + x
off_y = y
tx = -(off_x - (off_y * 4) / 3) / 64
ty = (off_y + off_x / 4) / 32
return { x: 99 - round(tx), y: round(ty) }
```

`SCREEN_WIDTH` and `SCREEN_HEIGHT` are dynamic — updated by `setScreenSize()` on browser window resize (`renderer.ts:53`). A `resize` event causes `WebGLRenderer.resize()` to update all shader uniforms and reallocate the floor FBO.

---

## 6. Roof Clipping

### CE (`object.cc:1445–1471`, `_obj_render_pre_roof`)

CE tracks the **square tile** the player is standing on (`_obj_last_roof_x/y`). Each frame, if the player has moved to a different square:

1. `tile_fill_roof(old_roof_x, old_roof_y, elevation, true)` — restores old roof tile visibility
2. `tile_fill_roof(new_roof_x, new_roof_y, elevation, false)` — hides roof tiles in the new square

`tile_fill_roof` (tile.cc) flood-fills connected roof tiles from the given square coordinate and toggles their visibility. This makes the roof transparent when the player walks under a building.

The visibility flag set by `tile_fill_roof` only affects that render frame; it is re-computed every frame.

### DH2 — **NOT IMPLEMENTED**

DH2 renders all roof tiles unconditionally in `renderRoof()` (`webglrenderer.ts:965`). There is no equivalent to `tile_fill_roof` or per-square roof hiding.

`Config.ui.showRoof` (default `true`) is a debug toggle that hides **all** roofs globally, but does not replicate CE's positional clipping.

`map.hasRoofAt(pos)` (`map.ts:135`) is available and returns true if a given hex position has a non-`grid000` roof tile above it, but this function is not used during rendering.

---

## 7. Multi-Elevation Rendering

### CE

The engine renders one elevation at a time (`gElevation`). `mapSetElevation()` in `map.cc` rebuilds the object list and tile data for the new elevation. CE map files store separate floor/roof tile layers and object lists per elevation (up to 3 elevations).

### DH2 (`GameMap.changeElevation`, `map.ts:196`)

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

The `floorMap` and `roofMap` properties on `GameMap` are set to the current elevation's tile data whenever elevation changes. `getObjects(level)` returns `objects[level]`.

Each elevation has its own `objects[level]: Obj[]` array (populated from `maps/*.json` on map load). The player and party members are moved between elevation arrays when `changeElevation` is called.

---

## 8. WebGL Pipeline (DH2-specific)

### Shaders

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

**Roof Y offset**: DH2 shifts roof tiles up by 96 pixels: `scr.y -= 96` (`webglrenderer.ts:989`). This empirically aligns 80×36 roof sprites with the floor tiles beneath them.

**Floor tile draw order**: Floor tiles are iterated in reverse row order (`i = tileMap.length-1` down to 0) to match Fallout 2's visual layering and prevent lighting artefacts at tile boundaries. (`webglrenderer.ts:554`, `708`)

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

## 9. Lighting Integration

### CE

Per-tile light intensity: `lightGetTileIntensity(elevation, tile)` — reads `_light_intensities[elevation][tile]`, max of ambient + all light-emitting objects casting onto that tile. `lightIntensity` field on each `Object` struct (from PRO data) drives the radius/intensity.

### DH2 (`src/lighting.ts`, `src/lightmap.ts`)

```typescript
Lightmap.tile_intensity[40000]  // per-tile intensity, index = y*200+x
```

Rebuilt by `Lightmap.rebuildLight()` (called on map load / elevation change) and `Lightmap.rebuildDynamicLight()` (called each frame — only updates tiles affected by moving light sources like the player).

**Ambient light** (`GameTime.getAmbientLightNormalized()`): 0.0–1.0 normalized from the in-game hour lookup table in `gametime.ts`. Drives `u_ambient` in all world shaders.

**Per-object lighting**: Objects with `lightRadius > 0` and `lightIntensity > 0` (set from PRO data) contribute to `tile_intensity` in `Lightmap.rebuildLight()`.

**Color LUT**: `Lighting.colorLUT` and `Lighting.colorRGB` (loaded from `lut/color_lut.json`, `lut/color_rgb.json`) are used in CPU lighting mode to apply Fallout 2's original 6-bit paletted color shading. In GPU mode the shader uses the float intensity directly.

---

## 10. Known Gaps vs CE

| Gap | CE Reference | DH2 Status |
|-----|-------------|------------|
| **Roof clipping (player-under-roof)** | `tile_fill_roof`, `object.cc:1445` | **Missing** — all roofs always visible; `hasRoofAt` exists but not wired to render |
| **Isometric object sort** | Two-phase sort via `_obj_order_comp_func_even/odd`; `tileIsInFrontOf` / `tileIsToRightOf` | Approximate: Y-then-X `objectZCompare` — fails on NE/SW diagonals |
| **OBJECT_FLAT rendering** | CE renders flat objects first, then non-flat (two passes in `_obj_render_pre_roof`) | DH2 renders all objects in a single pass in sorted order |
| **_obj_render_post_roof** | CE has a post-roof object pass for objects that must appear above roofs | DH2 has no post-roof object pass |
| **Tile scroll blocking** | `OBJECT_SCROLL_BLOCK` prevents viewport scrolling through certain tiles | Not implemented in DH2 camera |
| **Tile scroll limiting** | `gTileBorderMin/MaxX/Y` clamps camera within usable map area | Not implemented in DH2; camera can scroll to world x=0, y=0 minimum only |
| **Tile mask hit testing** | CE's `_tile_mask[512]` lookup gives pixel-precise hex hit detection | DH2 `hexFromScreen` uses cube-coordinate rounding — approximation |
| **Elevation transition effects** | CE fades/transitions between elevations | DH2 switches elevations immediately without transition |
| **Light intensity per object** | CE: `max(ambient, tile_intensity)` per object draw call | DH2: same 200×200 tile_intensity used, but updates driven by `Lightmap.rebuildDynamicLight` each frame |
| **Color cycling** | CE `colorCycleEnable/Disable` for animated palette effects (water, fire) | Not implemented in DH2 WebGL path |
