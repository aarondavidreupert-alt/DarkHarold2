# Scroll Clamping & Map Edge Rendering

## CE Reference
`src/tile.cc` — `tileSetCenter()` (line 537), `_tile_scroll_to()` (line 1947)

## CE Behaviour

### Border Calculation
At map-load time (`tileInit`, `tile.cc:~430–480`), CE pre-computes tile-space margins:
```c
gTileBorderMinX = abs(hexGridWidth - 1 - v2 % hexGridWidth - _tile_x) + 6
gTileBorderMinY = abs(_tile_y - v1 / hexGridWidth) + 7
gTileBorderMaxX = hexGridWidth - gTileBorderMinX - 1
gTileBorderMaxY = hexGridHeight - gTileBorderMinY - 1
```
These margins account for the viewport size so the camera can never position a tile outside `[borderMin, borderMax]` as the center tile.

### Scroll Block (`tileSetCenter`, tile.cc:537)
Every scroll call computes the candidate center tile's `tile_x`/`tile_y`:
```c
int tile_x = gHexGridWidth - 1 - tile % gHexGridWidth
int tile_y = tile / gHexGridWidth
if (gTileBorderInitialized) {
    if (tile_x <= gTileBorderMinX || tile_x >= gTileBorderMaxX
        || tile_y <= gTileBorderMinY || tile_y >= gTileBorderMaxY) {
        return -1;  // scroll rejected
    }
}
```
Additionally `gTileScrollBlockingEnabled` lets individual misc objects (PID `0x500000C`, type=misc pidID=12) act as invisible scroll blockers.

### Black Fill
`tileRefreshGame()` calls `bufferFill(..., 0)` (black) on the dirty rect before drawing tiles. Any area outside valid tile indices is never drawn over, leaving the pre-filled black.

## DH2 Implementation

### `MAP_WORLD_BOUNDS` (`src/render/camera.ts`)
Instead of tile-space margins, DH2 computes world-space (pixel) bounds from the four corner hexes:
```typescript
const corners = [hexToScreen(0,0), hexToScreen(199,0), hexToScreen(0,199), hexToScreen(199,199)]
// → minX≈32, maxX≈8000, minY≈11, maxY≈3587
```
This is functionally equivalent to CE's border system: tiles outside 0..199 in either axis don't exist and never render.

### `clampCameraPosition()` (`src/render/camera.ts:95`)
Clamps `globalState.cameraPosition` to keep the viewport entirely within `MAP_WORLD_BOUNDS`. Also checks for misc `pidID=12` scroll-blocker objects at the prospective viewport center (CE ref: `object.cc:2559 _obj_scroll_blocking_at`).

Called from:
| Site | Trigger |
|---|---|
| `gameTick.ts:109` | Mouse-edge scroll (every frame while cursor at border) |
| `input.ts:314,318,322,326` | Arrow-key / WASD scroll |
| `camera.ts:129` | `centerCamera()` (map load, player move) |
| `main.ts` *(gap — now fixed)* | Zoom wheel |

### WebGL Black Background
CE fills unrendered areas with 0 (black) via `bufferFill`. DH2 uses WebGL's `clearColor`:
- Set to `(0, 0, 0, 1)` in `WebGLRenderer.init()` (`webglContext.ts:325`)
- Restored to `(0, 0, 0, 1)` after floor-FBO pass (`webglLighting.ts:267`)
- `WebGLRenderer.clear()` calls `gl.clear(COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT)` each frame, so black shows for any area not covered by tiles

## Known Gaps vs CE
- **Scroll-blocker objects** (misc pidID=12): the `clampCameraPosition` check exists but only fires on the viewport centre hex — CE checks the actual center tile being set. Low impact in practice; no maps in DH2 currently use scroll blockers.
- **Viewport-relative border margins** (CE "+6"/"+7" padding): DH2 clamps at the world-space pixel of the exact corner hex centre. Tiles at the very edge may be partially clipped rather than kept fully in frame, but the area beyond renders black correctly.

<!-- audited: 2026-07-07 -->
