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

### Per-map calibrated limits (`src/render/camera.ts`)
`MAP_SCROLL_LIMITS` — viewport-**centre** world coords, hand-tuned in-game via the
console helpers below. Four maps calibrated so far:
```
arvillag { minX:3367 maxX:4492 minY:1370 maxY:2210 }
kladwtwn { minX:3178 maxX:4918 minY:1400 maxY:2150 }
klatrap  { minX:3343 maxX:4468 minY:1445 maxY:2090 }
geckjunk { minX:3535 maxX:4870 minY:1463 maxY:2183 }
```
No clean regularity across the four (widths 1125/1740/1125/1335, heights
840/750/645/720) — consistent with "playfield size is per-map content", which is
why a formula from grid constants alone can't produce them and why the
object-bbox proxy is the more promising automatic route.

`getActiveScrollLimits()` precedence: `window.scrollLimits` → `_activeLimits`
(per-map table, set by `setMapScrollLimits()` on load) → `CE_CENTER_BOUNDS`.

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
- `scrollDebug()` — copyable JSON: content bbox, camera, zoom, screen, bar px
- `borderCalib(on=true)` — grey semi-transparent bars + free scroll (ON) / solid
  black + clamp (OFF)
- `setBorder(minX,maxX,minY,maxY)` — set `window.scrollLimits` directly
- `grabBorderEdge('left'|'right'|'top'|'bottom')` — capture current viewport
  centre as one edge
- `clearBorder()` — delete `window.scrollLimits`

Workflow: `borderCalib()` → scroll to each real map edge → `grabBorderEdge(side)`
per side → `borderCalib(false)` to preview solid → paste the final
`window.scrollLimits` into `MAP_SCROLL_LIMITS`.

## Known Gaps vs CE
- **Not CE-faithful by design.** CE scrolls to the painted-floor / grid-edge
  bound (borders "far out"). DH2 deliberately tightens to the playfield for a
  cleaner presentation. Accept this divergence.
- **No automatic tight bound yet.** Per-map calibration is manual. Object-bbox
  automation is proposed but unvalidated (classifier outage this session).
- **Reference margin approximation.** DH2 uses plain 640×380 half-extents as the
  clamp margin; CE adds a 6–7 tile pad. Tunable via
  `ORIGINAL_ISO_WINDOW_WIDTH/HEIGHT`.
- **Scroll-blocker objects** (misc pidID=12): DH2 checks the viewport-centre hex;
  CE checks the candidate centre tile. Low impact; no shipped DH2 map uses them.

<!-- audited: 2026-07-09 -->
<!-- deep-dive: 2026-07-09 — CE has no per-map bounds; uniform grid-edge clamp. -->
<!-- DH2 floor bbox = painted extent (too wide); object-bbox proposed as auto proxy (unvalidated: classifier outage). -->
