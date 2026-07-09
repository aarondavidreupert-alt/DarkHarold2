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

### Strategy: fixed content bbox drives everything
The single source of truth is the **world-space bounding box of the actual floor
tiles** on the current map/elevation (`mapContentBounds`), computed once at load
by scanning `floorMap` for non-`grid000` tiles. It is fixed in world space, so it
is completely independent of zoom, pan, and window resolution. Both the black edge
overlay and the scroll clamp derive from it — no per-map calibration required.

This replaced an earlier per-map empirically-tuned `MAP_SCROLL_LIMITS` table. That
table (and `window.scrollLimits`, `CE_CENTER_BOUNDS`, `setMapScrollLimits`) now
survive only as fallbacks / live-tuning overrides when the bbox is unavailable.

### `computeMapContentBounds(floorMap)` (`src/render/camera.ts`)
Scans the floor tilemap (`[y][x]`, sentinel `'grid000'`), projecting each real tile
via `tileToScreen` and accumulating a world-space bbox (`+TILE_WIDTH/HEIGHT` for the
tile footprint). Stored in the live-binding export `mapContentBounds`. Called from
`GameMap.changeElevation` (per elevation) and the save-load `deserialize` path.

### Black edge overlay — `renderScrollBorderOverlay()` (`src/render/webglDraw.ts`)
CE ref: `tile.cc tileRefreshGame bufferFill(0)`. Every frame, projects
`mapContentBounds` to screen space (`worldToScreen`) and fills black rects over the
four margins outside it, on the 2D `textCtx` overlay. The four diamond-corner
triangles (inside the bbox but tile-free) are left to the WebGL `clearColor`
`(0,0,0,1)` showing through the transparent overlay, so the entire non-content
region is black. Robust at every zoom because the bbox is fixed in world space.

Drawn near the end of `Renderer.render()` (before the light-source debug overlay).

### Scroll clamp — `clampCameraPosition()` (`src/render/camera.ts`)
CE-faithful (`tile.cc tileSetBorder`): the border is computed as if the iso view
were the original **640×380** (`ORIGINAL_ISO_WINDOW_WIDTH/HEIGHT`), ignoring the
actual resolution. The viewport **centre** is clamped to
`[bbox.min + refHalf, bbox.max − refHalf]` with `refHalf = 320×190`. At real
(larger) viewports you scroll to the same world limit and the extra margin projects
to black beyond the content, which the overlay fills. Maps smaller than 640×380 on
an axis lock the centre to the content midpoint (fully visible, black all sides).

Precedence: `window.scrollLimits` override → `mapContentBounds` (primary) →
`_activeLimits` (per-map table / `CE_CENTER_BOUNDS` fallback). Also rejects moves
whose centre hex is a misc `pidID=12` scroll blocker (CE ref: `object.cc:2559
_obj_scroll_blocking_at`).

Called from: mouse-edge scroll (`gameTick.ts`), arrow/WASD (`input.ts`),
`centerCamera()` (map load / player move), and the zoom wheel (`main.ts`).

### WebGL Black Background
CE fills unrendered areas with 0 (black) via `bufferFill`. DH2 uses WebGL's `clearColor`:
- Set to `(0, 0, 0, 1)` in `WebGLRenderer.init()` (`webglContext.ts`)
- Restored to `(0, 0, 0, 1)` after floor-FBO pass (`webglLighting.ts`)
- `WebGLRenderer.clear()` clears `COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT` each frame

## Known Gaps vs CE
- **Reference margin approximation**: DH2 uses the plain 640×380 half-extents
  (320×190) as the clamp margin. CE's `tileSetBorder` samples `tileFromScreenXY`
  at `(-320,-240)`/`(-320,620)` and adds a 6–7 tile pad, so the true CE margin is
  slightly larger. Tunable via `ORIGINAL_ISO_WINDOW_WIDTH/HEIGHT` if it feels off.
- **Scroll-blocker objects** (misc pidID=12): the check fires on the viewport
  centre hex — CE checks the actual candidate centre tile. Low impact; no DH2 maps
  currently use scroll blockers.

<!-- audited: 2026-07-09 -->
<!-- reworked: 2026-07-09 — content-bbox drives overlay + CE-ref-window clamp -->
<!-- per-map MAP_SCROLL_LIMITS table now fallback-only (arvillag, kladwtwn, klatrap, geckjunk) -->
