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

### `CE_CENTER_BOUNDS` (`src/render/camera.ts`)
The CE border maths (reproduced in comments in camera.ts) gives valid viewport-centre hex ranges:
- `hex_x ∈ [45, 153]`, `hex_y ∈ [44, 155]` (DH2 coordinates)

Converting those boundary hexes to world-space pixel positions:
| Bound | Hex | World value |
|---|---|---|
| minX (centre) | hexToScreen(153, 44).x | 1840 |
| maxX (centre) | hexToScreen(45, 155).x | 6208 |
| minY (centre) | hexToScreen(45, 44).y  | 803  |
| maxY (centre) | hexToScreen(153, 155).y | 2783 |

These bounds apply to the **viewport centre**, not the camera top-left. The camera's valid top-left range is `[centreMin - viewW/2, centreMax - viewW/2]` and changes with zoom.

### `clampCameraPosition()` (`src/render/camera.ts`)
Clamps `globalState.cameraPosition` so the viewport centre stays in `CE_CENTER_BOUNDS`. Also checks for misc `pidID=12` scroll-blocker objects (CE ref: `object.cc:2559 _obj_scroll_blocking_at`).

Called from:
| Site | Trigger |
|---|---|
| `gameTick.ts:109` | Mouse-edge scroll (every frame while cursor at border) |
| `input.ts:314,318,322,326` | Arrow-key / WASD scroll |
| `camera.ts` (in `centerCamera()`) | Map load, player move |
| `main.ts` (zoom wheel) | After zoom-anchor camera mutation |

### WebGL Black Background
CE fills unrendered areas with 0 (black) via `bufferFill`. DH2 uses WebGL's `clearColor`:
- Set to `(0, 0, 0, 1)` in `WebGLRenderer.init()` (`webglContext.ts:325`)
- Restored to `(0, 0, 0, 1)` after floor-FBO pass (`webglLighting.ts:267`)
- `WebGLRenderer.clear()` clears `COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT` each frame

### High-resolution viewports
CE does not expand borders for viewports larger than 640×380 (see `tileSetBorder` comment).
sfall covers the extra area with black overlay quads. DH2 relies on `clearColor=(0,0,0,1)` to
make unrendered viewport margins automatically black — no explicit overlay pass needed,
because `clampCameraPosition` keeps the valid tile area centred and `gl.clear()` fills the rest.

## Known Gaps vs CE
- **Scroll-blocker objects** (misc pidID=12): the `clampCameraPosition` check fires on the viewport centre hex — CE checks the actual candidate centre tile. Low impact; no maps in DH2 currently use scroll blockers.
- **Odd-column border alignment**: CE adjusts `gTileBorderMinX` by ±1 to keep it odd (for hex column alignment). The DH2 world-space clamp skips this; the difference is sub-tile (≤16 px) and not perceptible.

<!-- audited: 2026-07-08 -->
