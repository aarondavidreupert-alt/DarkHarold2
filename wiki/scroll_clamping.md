# Scroll Clamping & Map Edge Rendering

## CE Reference
- `src/tile.cc` — `tileInit()` (line 290), `tileSetBorder()` (line 462),
  `tileSetCenter()` (line 537, scroll-reject at 574), `_tile_scroll_to()` (line 1947)
- `src/map_defs.h` — grid dimensions
- `src/object.cc:2559` — `_obj_scroll_blocking_at` (misc scroll-blocker objects)

## The core question: where does CE store "map bounds"?

**It doesn't.** This is the key finding of the deep dive. CE has *no* per-map
playfield rectangle. There is exactly one, universal, map-independent scroll
bound, derived purely from the grid dimensions and the (fixed) window size.

### Grid dimensions (`map_defs.h`)
```c
#define SQUARE_GRID_WIDTH  (100)   // floor / roof tile grid
#define SQUARE_GRID_HEIGHT (100)
#define HEX_GRID_WIDTH     (200)   // object / movement / scroll grid
#define HEX_GRID_HEIGHT    (200)
```
Every F2 map is the same size: a 100×100 square-tile floor and a 200×200 hex
grid. There is no stored width/height per map — the dimensions are compile-time
constants.

### Border calculation (`tileSetBorder`, tile.cc:462)
Computed **once at map load**, in hex-tile space, from the *original* iso window
(640×380) regardless of the real resolution — CE's own comment:
> "keep borders for original resolution"

```c
int v1 = tileFromScreenXY(-320, -240, 0);
int v2 = tileFromScreenXY(-320, ORIGINAL_ISO_WINDOW_HEIGHT + 240, 0);
gTileBorderMinX = abs(hexGridWidth - 1 - v2 % hexGridWidth - _tile_x) + 6;
gTileBorderMinY = abs(_tile_y - v1 / hexGridWidth) + 7;
gTileBorderMaxX = hexGridWidth - gTileBorderMinX - 1;
gTileBorderMaxY = hexGridHeight - gTileBorderMinY - 1;
```
So the border is `[MinX..MaxX] × [MinY..MaxY]` = the full 200×200 hex grid minus a
viewport-sized inset (plus a 6/7-tile pad). **Identical for every map.**

### Scroll rejection (`tileSetCenter`, tile.cc:574)
Every scroll request converts the candidate centre tile to `tile_x`/`tile_y`
and rejects the move if it falls outside the border:
```c
if (tile_x <= gTileBorderMinX || tile_x >= gTileBorderMaxX
 || tile_y <= gTileBorderMinY || tile_y >= gTileBorderMaxY) {
    return -1;  // scroll rejected
}
```
Plus `gTileScrollBlockingEnabled`: individual misc objects (PID `0x500000C`,
type=misc pidID=12) act as invisible per-tile scroll blockers.

### Why the original game shows no black at the edges
CE lets you scroll all the way to the grid-edge inset. In the *original* game
this never reveals black, because **the map artists paint floor tiles across the
entire playable region** — right out to (and past) where the grid clamp stops
you. The clamp edge and the painted-floor edge coincide by construction. There
is no "playfield rectangle" because the floor fill *is* the playfield.

## Why DH2 diverges

DH2 consumes the same maps but the extraction (`tools/fomap.py`) exposes the
floor as a `100×100` array of tile names. Tile **index 0 → `grid000`** (the
mapper's empty/grid filler, `tiles.lst[0]`). Genuinely painted tiles are
anything ≠ `grid000`.

Two facts make CE's uniform clamp look wrong in DH2:

1. **DH2 windows are larger than 640×380** and support zoom-out, so the fixed
   640×380 border inset leaves a visible black margin CE never showed.
2. **The painted floor does not tightly bound the buildings.** On outdoor maps
   the desert floor is painted far past the settlement — e.g. Arroyo Village's
   floor spans nearly the full grid width (world-space bbox ≈ x[864..7520]),
   while the actual walkable village is a small cluster in the middle. So the
   non-`grid000` floor bbox is *correct as the painted-tile extent* but far too
   generous as a "keep the camera on the buildings" bound.

This is the crux of every failed attempt so far: **the floor-tile bbox is the
wrong signal for a tight playfield.** It faithfully reproduces CE (scroll to the
painted edge), which is exactly the "borders too far out" behaviour.

## What signal *does* bound the playfield automatically?

There is no CE-authoritative tight rectangle — "tight borders around the
buildings" is a DH2 aesthetic choice, not an F2 feature. But the map data does
carry a much better automatic proxy than the floor:

- **Object bounding box** — scenery, walls, and critters (`level.objects[].position`,
  hex coords 0..199) cluster on the actual playfield. Buildings, fences, NPCs and
  loot all sit where the player goes; the surrounding painted desert has no
  objects. The bbox of object hex positions, converted to world space and padded
  by a viewport half-extent, is the best zero-calibration estimate of the
  playfield.

Proposed automatic bound (pending empirical validation, see below):
```
playfield = worldBBox(objects) expanded by (viewHalfW, viewHalfH)
clampCentre to [playfield.min .. playfield.max]
```
Fallbacks, in precedence order:
1. `window.scrollLimits` (live console override / calibration)
2. per-map `MAP_SCROLL_LIMITS` (hand-calibrated, current source of truth)
3. object-bbox estimate (proposed automatic)
4. `CE_CENTER_BOUNDS` (full grid — pure CE behaviour)

### Validation still owed
The object-bbox hypothesis was **not** numerically confirmed this session: the
Bash/PowerShell safety classifier was unavailable for the active model
(Opus 4.8), so `tools`-style extraction scripts could not run. The analysis
script is saved at `scratchpad/floorstat.js` and prints, per map, the floor
distribution, the non-`grid000` floor tile-bbox, and the object tile-bbox. Run it
(any map, e.g. `node floorstat.js`) once the classifier is back — or under
Sonnet, where the classifier is available — and compare the object-bbox against
the four hand-calibrated `MAP_SCROLL_LIMITS` entries. If object-bbox+pad lands
close to the calibrated centre bounds, wire it into `getActiveScrollLimits()` as
tier 3 and the per-map table can be retired for most maps.

## DH2 Implementation (current state)

### Automatic bounds (default path)

`getActiveScrollBarBounds()` selects bar-edge coords using this precedence:

1. `window.scrollLimits` — live `blackBar()` editor override (edge coords)
2. `MAP_BAR_BOUNDS[mapName]` — hand-calibrated edge coords (currently empty — see below)
3. `scrollBlockerBounds` expanded by (290, 172) — CE-authoritative ring, when present
   and not anomalously wide (w < 3500 && h < 2500; wider rings = city multi-district maps)
4. `mapContentBounds` — interior floor tile bbox, excluding `grid000` and `edg*` tiles,
   inset by (130, 60). Fallback for outdoor maps whose blocker rings exceed the width
   threshold.
5. `null` — no overlay drawn (only for maps with no floor tiles at all)

`getActiveScrollLimits()` (for the scroll clamp) derives from the same chain but
insets the bar bounds by (320, 190) = reference half-viewport to get centre coords.
Falls back to `CE_CENTER_BOUNDS` (full 200×200 grid) if no bar bounds are available.

### Per-map override table (`src/render/camera.ts`)

`MAP_BAR_BOUNDS` — **edge** world coords, calibrated via `blackBar()` in-game.
Currently empty: auto-detection (scroll blockers → floor bbox fallback) handles all
shipped maps. Add an entry only when a specific map's auto result feels wrong:
```typescript
const MAP_BAR_BOUNDS: Record<string, typeof CE_CENTER_BOUNDS> = {
    // e.g. arvillag: { minX: 1047, maxX: 5812, minY: 514, maxY: 2593 },
}
```
Note: these are **bar-edge** coords (where the black bars sit), not viewport-centre
clamp coords. `getActiveScrollLimits()` insets them by (320, 190) automatically.

### Scroll clamp — `clampCameraPosition()`
Clamps the viewport **centre** (camera top-left + half view) to the active
limits. Rejects moves whose centre hex is a misc `pidID=12` scroll blocker
(CE ref `object.cc:2559`). Bails out entirely while `window.borderDebug` is set
so calibration can scroll freely. Called from mouse-edge scroll (`gameTick.ts`),
arrow/WASD (`input.ts`), `centerCamera()`, and the zoom wheel (`main.ts`).

### Black edge overlay — `renderScrollBorderOverlay()` (`src/render/webglDraw.ts`)
CE ref `tileRefreshGame` `bufferFill(0)`. Draws four screen-parallel bars on the
2D `textCtx` overlay, filling the margin between the active bar bounds
(`getActiveScrollBarBounds()`) and the screen edges. Solid `#000000` normally;
`rgba(128,128,128,0.5)` while `window.borderDebug` (calibration) is on so the
placement is visible against the map. The diamond-corner triangles inside the
bounds are left to the WebGL `clearColor (0,0,0,1)` showing through.

### WebGL black background
`clearColor(0,0,0,1)` in `WebGLRenderer.init()`, restored after the floor-FBO
pass (`webglLighting.ts`); `clear()` clears colour+depth each frame. This is what
fills the un-rendered (non-content) region black behind the overlay.

### Console calibration helpers (`camera.ts`, registered on `window`)
- `scrollDebug()` — prints copyable JSON: object bbox, auto clamp, active clamp,
  camera position, zoom, screen size, and bar pixel widths for the current frame.
- `blackBar('W'|'E'|'N'|'S')` — enters edit mode for the named bar edge (West/East/
  North/South). Grey semi-transparent bars appear and scroll clamping is disabled so
  you can reach any position. Keys while in edit mode:
  - `PageUp` → bar moves outward (more map visible), step = 20 world units
  - `PageDown` → bar moves inward (less map visible), step = 20 world units
  - `Shift` → fine mode: step = 5 world units
  - Prints current `window.scrollLimits` JSON after every step.
- `blackBar()` (no argument) — exits edit mode; bars go solid black and clamping
  re-enables. Prints the final `window.scrollLimits` value to copy into `MAP_BAR_BOUNDS`.
- `borderSave()` — prints `mapName: { current scrollLimits }` for copy-paste.
- `clearBorder()` — deletes `window.scrollLimits` and exits edit mode; auto bounds
  are restored immediately.

**Calibration workflow** (for a map whose auto result is wrong):
1. Load the map in-game.
2. `blackBar('W')` → use PageUp/Down until the west bar looks right → repeat for
   `'E'`, `'N'`, `'S'`.
3. `blackBar()` → copy the printed JSON.
4. Add an entry to `MAP_BAR_BOUNDS` in `camera.ts`:
   ```typescript
   mapfilename: { minX: <W edge>, maxX: <E edge>, minY: <N edge>, maxY: <S edge> }
   ```
5. Recompile (`npx tsc`) and verify in-game.

## Known Gaps vs CE
- **Not CE-faithful by design.** CE scrolls to the painted-floor / grid-edge
  bound (borders "far out"). DH2 deliberately tightens to the playfield for a
  cleaner presentation. Accept this divergence.
- **Automatic bounds are empirically calibrated, not derived.** The (130, 60)
  interior inset for the floor bbox fallback and the (290, 172) expansion from
  scroll blocker rings are tuned to match tested maps; not guaranteed for all.
- **Reference margin approximation.** DH2 uses plain 640×380 half-extents as the
  clamp margin; CE adds a 6–7 tile pad. Tunable via
  `ORIGINAL_ISO_WINDOW_WIDTH/HEIGHT`.
- **Scroll-blocker objects** (misc pidID=12): DH2 checks the viewport-centre hex;
  CE checks the candidate centre tile. Low impact; no shipped DH2 map uses them.

<!-- audited: 2026-08-25 -->
<!-- deep-dive: 2026-07-09 — CE has no per-map bounds; uniform grid-edge clamp. -->
<!-- 2026-08-25: updated to reflect MAP_BAR_BOUNDS (was MAP_SCROLL_LIMITS), corrected console helpers (blackBar/borderSave/clearBorder replacing old setBorder/grabBorderEdge/borderCalib), updated auto-detection precedence chain. -->
