# Tile System & Elevation

> **Source anchor:** `raw/fallout2-ce/src/tile.cc`, `tile.h`, `obj_types.h`, `map.cc`, `map.h`, `map_defs.h`, `object.cc`, `scripts.cc`, `interpreter_extra.cc`
> **DH2 files:** `src/tile.ts`, `src/geometry.ts` (barrel; `src/geometry/{hexScreen,hexGrid}.ts`), `src/map.ts` (barrel; `src/map/{GameMap,mapLoader}.ts`), `src/object.ts` (barrel; `src/object/*.ts`), `src/scripting.ts`, `src/vm_bridge.ts`
> **Last audited:** 2026-06-02

---

## 1. Overview

This document covers the **coordinate layer** of Fallout 2's tile system — the two-grid architecture, square-tile projection and hit-testing, direction numbering, and the tile navigation functions (`tileGetTileInDirection`, `tileGetRotationTo`, `_tile_num_beyond`) — plus the **elevation system**: every object has a tile number AND an elevation, and the two axes are inseparable.

**Not duplicated here — see linked docs:**
- Isometric projection formulas and hex grid coordinate encoding → [`wiki/rendering.md`](rendering.md) §1–2
- Viewport, camera centering, scroll borders → [`wiki/rendering.md`](rendering.md) §5
- MAP binary header, variable arrays, tile data section, script section → [`wiki/file_formats.md`](file_formats.md) §MAP
- Render order, object depth sort, roof clipping → [`wiki/rendering.md`](rendering.md) §3–6
- Elevator UI and LST data → [`wiki/interface_windows.md §11`](interface_windows.md)
- Spatial trigger lifecycle → [`wiki/map_scripting.md`](map_scripting.md)

---

## 2. Two-Grid Architecture

Fallout 2 uses two overlapping grids, both 200 units wide:

| Grid | Dimensions | Cell size | Used for |
|------|-----------|-----------|----------|
| **Hex** | 200 × 200 = 40 000 cells | 32 × 16 px | Objects, critters, pathfinding, scripts |
| **Square** | 100 × 100 = 10 000 cells | 80 × 36 px | Floor and roof tile sprites |

One square tile spans exactly **2 × 2 hex cells** (80/32 = 2.5 px column span, but the stagger means each square row = 2 hex rows of 16 px = 32 px; each square column = 80 px ≈ 1.67 hex widths, staggered). In practice the alignment is visual: a `grid001` floor sprite (80×36 px) covers the floor under the 4 hex cells at its grid position.

### Constants

```c
// tile.cc — gHexGridWidth = gHexGridHeight = 200 (always)
// gSquareGridWidth = gSquareGridHeight = 100 (always)
gHexGridSize  = gHexGridWidth  * gHexGridHeight   // 40 000
gSquareGridSize = gSquareGridWidth * gSquareGridHeight  // 10 000
```

```typescript
// src/geometry/hexScreen.ts
export const HEX_GRID_SIZE = 200   // grid is 200×200 hex cells

// src/tile.ts:19-20
export const TILE_WIDTH  = 80   // square tile pixel width
export const TILE_HEIGHT = 36   // square tile pixel height
```

---

## 3. tileNum Encoding (Summary)

Full detail is in `wiki/rendering.md` §2. Short form:

| System | Formula | x-direction |
|--------|---------|-------------|
| CE | `tileNum = tile_y × 200 + (199 − tile_x)` | x=0 is right edge |
| DH2 | `tileNum = y × 200 + x` | x=0 is left edge |

CE reads the column back-to-front: `rx = gHexGridWidth − 1 − tileNum % gHexGridWidth`. DH2 stores x normally: `x = tileNum % 200`. All CE `tileNum % gHexGridWidth` operations yield the **reversed** column.

Square tileNum (CE only — DH2 uses 2-D array):

```c
squareTile = squareX + gSquareGridWidth * squareY
squareX    = gSquareGridWidth − 1 − squareTile % gSquareGridWidth  // reversed, like hex
squareY    = squareTile / gSquareGridWidth
```

---

## 4. Square Tile Subsystem

### 4.1 Square Origin Registers (CE)

`tileSetCenter` (tile.cc:537) sets the hex origin registers `_tile_x/_tile_y/_tile_offx/_tile_offy` and then derives square origin registers:

```c
// tile.cc:590-598
_square_x    = _tile_x / 2;
_square_y    = _tile_y / 2;
_square_offx = _tile_offx - 16;
_square_offy = _tile_offy - 2;

if (_tile_y & 1) {
    _square_offy -= 12;
    _square_offx -= 16;
}
```

The square grid is half the density of the hex grid; integer division by 2 maps the center hex to the containing square. The −16 x and −2 y offsets account for the half-cell positional shift between the hex anchor and the square anchor.

### 4.2 squareTileToScreenXY (CE, tile.cc:1097)

```c
int squareTileToScreenXY(int squareTile, int* coordX, int* coordY, int elevation)
{
    int rx = gSquareGridWidth - 1 - squareTile % gSquareGridWidth;  // reversed X
    int sy_grid = squareTile / gSquareGridWidth;

    int dx = rx - _square_x;
    *coordX = _square_offx + 48 * dx;
    *coordY = _square_offy - 12 * dx;

    int dy = sy_grid - _square_y;
    *coordX += 32 * dy;
    *coordY += 24 * dy;

    return 0;
}
```

Per column step: Δx = +48, Δy = −12 (same stagger as hex but twice the pitch).  
Per row step: Δx = +32, Δy = +24.

### 4.3 squareTileToRoofScreenXY (CE, tile.cc:1128)

Identical formula to `squareTileToScreenXY` except the final Y is decremented by 96:

```c
*screenY = 24 * dy + *screenY - 96;
```

The −96 px offset shifts the roof sprite so it visually aligns above the floor it covers. DH2 replicates this exactly: `webglrenderer.ts` passes `−96` as the Y offset when drawing roof tiles (`drawTileMap(roofTiles, -96)`).

### 4.4 squareTileFromScreenXY / squareTileScreenToCoord (CE, tile.cc:1161)

```c
// squareTileScreenToCoord — tile.cc:1176
void squareTileScreenToCoord(int screenX, int screenY, int elevation,
                              int* coordX, int* coordY)
{
    int v4 = screenX - _square_offx;
    int v5 = screenY - _square_offy - 12;
    int v6 = 3 * v4 - 4 * v5;
    *coordX = v6 >= 0 ? (v6 / 192) : ((v6 + 1) / 192 - 1);

    int v8 = 4 * v5 + v4;
    *coordY = v8 >= 0 ? (v8 / 128) : ((v8 + 1) / 128 - 1);
}
```

The inverse is a linear system solve: `3x − 4y = v6` and `x + 4y = v8` in screen-relative coordinates. The divisors 192 and 128 correspond to the 48×32 column/row pitch of the square grid (48×4 = 192, 32×4 = 128).

### 4.5 DH2 Square Tile Functions (tile.ts)

DH2 uses world-space coordinates (camera-independent) rather than screen-relative:

```typescript
// tile.ts:30 — square tileNum → world pixel
export function tileToScreen(x: number, y: number): Point {
    x = 99 - x                   // reverse X (CE convention)
    return {
        x: 4752 + 32 * y - 48 * x,
        y: 24 * y + 12 * x,
    }
}

// tile.ts:38 — world pixel → square grid position
export function tileFromScreen(x: number, y: number): Point {
    const off_x = -4800 + x
    const off_y = y
    const tx = -(off_x - (off_y * 4) / 3) / 64
    const ty = (off_y + off_x / 4) / 32
    return { x: 99 - Math.round(tx), y: Math.round(ty) }
}

// tile.ts:53 — hex grid position → containing square tile
export function hexToTile(pos: Point): Point {
    const scrPos = hexToScreen(pos.x, pos.y)
    return tileFromScreen(scrPos.x, scrPos.y)
}
```

The world-space origin constant 4752 is the pre-baked `_square_offx` for a camera centred at the default map centre (hex 100, 100). CE computes this dynamically from `_tile_offx`; DH2 uses a fixed world-space baseline.

---

## 5. Direction System

### 5.1 CE Direction Enum (obj_types.h:7)

```c
typedef enum Rotation {
    ROTATION_NE = 0,
    ROTATION_E  = 1,
    ROTATION_SE = 2,
    ROTATION_SW = 3,
    ROTATION_W  = 4,
    ROTATION_NW = 5,
} Rotation;
```

Six directions numbered 0–5, clockwise starting from NE (upper-right in screen space).

### 5.2 Screen-Space Direction Offsets (CE)

Two arrays in tile.cc define the screen-pixel delta for each direction:

```c
// tile.cc:93 — _off_tile[6]: X delta (pixels)
const int _off_tile[6] = { 16, 32, 16, -16, -32, -16 };

// tile.cc:103 — dword_51D984[6]: Y delta (pixels)
const int dword_51D984[6] = { -12, 0, 12, 12, 0, -12 };
```

Combined as screen-space (Δx, Δy) per direction:

| Direction | Value | Δx | Δy | Screen compass |
|-----------|-------|----|----|----------------|
| NE | 0 | +16 | −12 | up-right |
| E  | 1 | +32 | 0   | right |
| SE | 2 | +16 | +12 | down-right |
| SW | 3 | −16 | +12 | down-left |
| W  | 4 | −32 | 0   | left |
| NW | 5 | −16 | −12 | up-left |

These offsets are used by the FRM animation system to offset sprite frames per direction, and by `tileGetRotationTo` as the reference mapping.

### 5.3 DH2 Direction Numbering (geometry.ts)

DH2's `hexNeighbors(position)` for even-x positions returns neighbors in the order:

```
dir 0: (x−1, y)    → screen (+16, −12) = NE  ← same as CE ROTATION_NE
dir 1: (x−1, y+1)  → screen (+16, +12) = SE  ← CE ROTATION_SE? No — E
dir 2: (x,   y+1)  → screen (−16, +12) = SW  ← CE ROTATION_SW? No — SE
dir 3: (x+1, y+1)  → screen (−16, +12) … SW
dir 4: (x+1, y)    → screen (−32, 0)   = W   ← CE ROTATION_W
dir 5: (x,   y−1)  → screen (−16, −12) = NW  ← CE ROTATION_NW
```

The exact mapping is derived from `hexToScreen` (geometry.ts). After substituting into the formula, the screen deltas for even-x are:

| DH2 dir | Grid delta (even x) | Screen Δx | Screen Δy | CE rotation |
|---------|---------------------|-----------|-----------|-------------|
| 0 | (x−1, y) | +16 | −12 | NE (0) |
| 1 | (x−1, y+1) | +32 | 0 | E (1) |
| 2 | (x, y+1) | −16 | +12 | SE (2) |
| 3 | (x+1, y+1) | −16 | +12 | SW (3) |
| 4 | (x+1, y) | −32 | 0 | W (4) |
| 5 | (x, y−1) | −16 | −12 | NW (5) |

DH2 direction numbers match CE rotation values for even-x tiles. For odd-x tiles the mapping is offset by one row; `hexNeighbors` handles this with the `if (x % 2 === 0)` branch. The net result: `hexInDirection(pos, n)` correctly moves to the CE `ROTATION_n` neighbour for any position. See gap TS2 for the mismatch in `hexDirectionTo`.

---

## 6. tileGetTileInDirection vs hexInDirection

### 6.1 CE: tileGetTileInDirection (tile.cc:893)

```c
int tileGetTileInDirection(int tile, int rotation, int distance)
{
    int newTile = tile;
    for (int index = 0; index < distance; index++) {
        if (tileIsEdge(newTile)) break;   // stop at grid boundary
        int parity = (newTile % gHexGridWidth) & 1;  // parity of reversed-x column
        newTile += _dir_tile[parity][rotation];
    }
    return newTile;
}
```

`tileIsEdge` (tile.cc:1034) returns true when `tile` is on any of the four edges of the 200×200 grid:

```c
bool tileIsEdge(int tile) {
    if (!tileIsValid(tile)) return false;
    int rx = gHexGridWidth - 1 - tile % gHexGridWidth;  // reversed x
    int y  = tile / gHexGridWidth;
    return rx == 0 || rx == gHexGridWidth - 1
        || y  == 0 || y  == gHexGridHeight - 1;
}
```

`_dir_tile[parity][rotation]` is the tileNum delta for one step in the given direction at the given column parity. See `wiki/rendering.md` §2 for the full delta table.

### 6.2 DH2: hexInDirection / hexInDirectionDistance (geometry.ts)

```typescript
export function hexInDirection(position: Point, dir: number): Point {
    return hexNeighbors(position)[dir]
}

export function hexInDirectionDistance(position: Point, dir: number, distance: number): Point {
    if (distance === 0) return position
    let tile = hexInDirection(position, dir)
    for (var i = 0; i < distance - 1; i++) {
        tile = hexInDirection(tile, dir)
    }
    return tile
}
```

**No bounds checking.** DH2 does not guard against `x < 0`, `x > 199`, `y < 0`, or `y > 199`. Walking past the grid edge returns an out-of-bounds `{x, y}` object.

### 6.3 Comparison

| Aspect | CE | DH2 |
|--------|----|-----|
| Edge guard | `tileIsEdge` stops walk at boundary | None — returns out-of-bounds coords |
| Complexity per step | O(1) table lookup on reversed-x parity | O(1), explicit branch per even/odd x |
| Direction convention | CE ROTATION enum (NE=0 … NW=5) | Same numbering (dir 0 = NE for even x) |
| Multi-step | Loop inside function | `hexInDirectionDistance` re-calls `hexInDirection` each step |

---

## 7. tileGetRotationTo vs hexDirectionTo

### 7.1 CE: tileGetRotationTo (tile.cc:910)

Uses screen-space positions for the angle calculation:

```c
int tileGetRotationTo(int tile1, int tile2)
{
    int x1, y1, x2, y2;
    tileToScreenXY(tile1, &x1, &y1, 0);
    tileToScreenXY(tile2, &x2, &y2, 0);

    int dx = x2 - x1;
    int dy = y2 - y1;

    if (dx == 0) {
        return dy < 0 ? ROTATION_NE : ROTATION_SE;
    }

    int deg = (int)trunc(atan2((double)-dy, (double)dx) * 180.0 / M_PI);
    int bearing = 360 - (deg + 180) - 90;
    if (bearing < 0) bearing += 360;
    bearing /= 60;
    if (bearing >= 6) bearing = 5;
    return bearing;
}
```

The formula maps screen-space atan2 to a clockwise bearing starting at NE (direction 0). It works in screen coordinates (y-down), so `-dy` flips to standard math convention. The result is a CE `Rotation` value (0–5).

### 7.2 DH2: hexDirectionTo (geometry.ts)

```typescript
export function hexDirectionTo(a: Point, b: Point): number {
    // TODO: check correctness
    const delta = { x: b.x - a.x, y: b.y - a.y }

    if (delta.x) {
        const angle = (Math.atan2(-delta.y, delta.x) * 180) / Math.PI
        let temp = (90 - angle) | 0
        if (temp < 0) temp += 360
        return Math.min((temp / 60) | 0, 5)
    } else if (delta.y < 0) return 0
    return 2
}
```

**Bug:** This function applies atan2 to the **grid-space delta** `(b.x − a.x, b.y − a.y)`, not to the **screen-space delta**. Because DH2's x grid axis runs opposite to screen-x (decreasing grid-x = increasing screen-x), the atan2 angle is wrong. For example:

- `hexDirectionTo({x:100, y:100}, {x:99, y:100})`: grid delta = (−1, 0)  
  → `atan2(0, −1) = 180°` → bearing = 270 → returns **4 (W)**  
  → CE `tileGetRotationTo` for the same pair returns **0 (NE)**

The `"TODO: check correctness"` comment (geometry.ts) is warranted. See gap TS2.

---

## 8. _tile_num_beyond vs hexLine

### 8.1 CE: _tile_num_beyond (tile.cc:944)

Walks a Bresenham line from `from` toward `to` and returns the tile that is `distance` steps past `from` along that line (not the tile at `from + distance` in a cardinal direction, but along the actual screen-space line):

```c
int _tile_num_beyond(int from, int to, int distance)
{
    // 1. Convert both tiles to screen-pixel centre coordinates (+16, +8 to centre within hex)
    // 2. Run Bresenham integer line from fromX,fromY to toX,toY
    // 3. Track each new tile entered (via tileFromScreenXY)
    // 4. Stop and return the tile when distance new tiles have been entered
    // 5. Also stop at tileIsEdge
}
```

Used by the combat system for projectile over-range and by the `shoot_into_the_air` mechanic. Not exposed as a script opcode directly.

### 8.2 DH2: hexLine (geometry.ts)

```typescript
export function hexLine(a: Point, b: Point): Point[] {
    var path = []
    var position: Point = { x: a.x, y: a.y }

    while (true) {
        path.push(position)
        if (position.x === b.x && position.y === b.y) return path
        var nearest = hexNearestNeighbor(position, b)
        if (nearest === null) return null
        position = nearest.hex
    }
}
```

`hexLine` returns the full path from `a` to `b` by repeatedly stepping to the nearest hex neighbor. This is not equivalent to `_tile_num_beyond`, which continues **past** the target tile by `distance` steps rather than returning the path to it.

No DH2 equivalent for the "beyond" extension exists.

---

## 9. MAP Binary Tile Data

Full MAP header and structure documented in `wiki/file_formats.md` §MAP. Tile-specific detail:

### 9.1 Binary Layout (CE: map.cc mapLoad)

After the 200-byte header and GVAR/LVAR variable arrays:

```
for each active elevation (numLevels times):
    for tile_index in range(10000):   // 100×100 square grid
        roofFID  = readU16()
        floorFID = readU16()
        // x = tile_index % 100; y = tile_index // 100
        // stored in reversed-x order: stored column = 99 - x
```

Each pair is 4 bytes (2 × U16). Total tile data: `numLevels × 10000 × 4` bytes. FID value 0 = no tile. The stored tile FID is a **square tile FID** (art type = 4, PID high byte = 4).

### 9.2 CE Tile FID → FRM File

Square tile FIDs: art type bits `[27:24] = 4`. The LST index (bits `[11:0]`) looks up into `art/tiles/tiles.lst`. The Python pipeline (`tools/fomap.py`) converts this to the FRM filename and stores it as a string in the JSON.

### 9.3 DH2 Map JSON Format

```json
{
  "levels": [
    {
      "tiles": {
        "floor": [["grid001", "grid001", ...], ...],  // [y][x], 100×100
        "roof":  [["roof001", null, ...], ...]         // null = no tile
      },
      "objects": [...],
      "spatials": [...]
    }
  ]
}
```

`GameMap.floorMap` and `GameMap.roofMap` hold the 2-D string arrays for the current elevation (`map.ts`). The renderer iterates `floorMap[y][x]` (100 rows × 100 cols) and calls `tileToScreen(x, y)` for each position.

---

## 10. Elevation System

Elevation is a coordinate axis every object carries alongside its tile number. Fallout 2 maps support up to three independent horizontal planes called elevations (0, 1, 2). Each elevation has its own tile grid, object set, and spatial script list. Elevation change is **not** a map transition — the script context, object scripts, and variable state all persist. Only the active tile layer, object set, and spatial list change. The most common real-world use is multi-storey buildings (Klamath bat caves, Vault City vault levels, NCR downtown/sewers).

Out of the 151 maps in the DH2 build, 43 contain more than one elevation (including 2 with all 3 levels).

---

## 11. CE — Elevation Constants and Data Structures

### 11.1 Elevation Count

```cpp
// map_defs.h:6
#define ELEVATION_COUNT (3)

static inline bool elevationIsValid(int elevation) {
    return elevation >= 0 && elevation < ELEVATION_COUNT;
}
```

Elevation indices are 0, 1, 2. There is no runtime way to add a fourth elevation.

### 11.2 MapHeader.flags — Elevation Presence Bitmask

```cpp
// map.cc:81 — bit values for _map_data_elev_flags[ELEVATION_COUNT]
static const int _map_data_elev_flags[ELEVATION_COUNT] = {
    2,   // elevation 0 → flag bit 1
    4,   // elevation 1 → flag bit 2
    8,   // elevation 2 → flag bit 3
};
```

The `MapHeader.flags` field carries several bits. The three elevation bits use the **inverted-presence** convention:

- Bit **SET** → elevation is **empty** (no tile data in the `.MAP` file for this level)
- Bit **CLEAR** → elevation **has tile data** stored in the file

This is determined at save time by scanning for non-default tiles and non-flagged objects:

```cpp
// map.cc:1377-1385 (_map_save_file)
if (tile == SQUARE_GRID_SIZE) {      // all tiles are default
    if (object == nullptr) {
        gMapHeader.flags |= flag;   // empty → set bit
    } else {
        gMapHeader.flags &= ~flag;  // has objects → clear bit
    }
} else {
    gMapHeader.flags &= ~flag;      // has custom tiles → clear bit
}
```

And at load time:

```cpp
// map.cc:1713-1715 (_square_load)
if ((flags & _map_data_elev_flags[elevation]) == 0) {
    // load tile data for this elevation
}
// if bit is set → skip (elevation is blank, no data to read)
```

Flag bit 0 (`flags & 1`) is the "map revisited" flag — `0` = first visit (used to set `fixed_param` in `map_enter_p_proc`).

### 11.3 gElevation — Active Elevation

```cpp
// map.cc:124
int gElevation = 0;
```

All rendering, pathfinding, lighting, and spatial-trigger calls receive `gElevation` as the authoritative elevation. The player's `gDude->elevation` matches this after every `mapSetElevation` call.

### 11.4 Object.elevation

Every `Object` carries its own `elevation` field (`obj_types.h`). This is set by `objectSetLocation` / `_obj_connect_to_tile` whenever an object is placed. All objects on all elevations reside in the same `gObjectListHeadByTile[]` array; elevation is used to filter which objects are visible, blocking, or script-active.

---

## 12. CE — Elevation Change Sequence

```cpp
// map.cc:362 — mapSetElevation
int mapSetElevation(int elevation)
{
    if (!elevationIsValid(elevation)) return -1;

    if (elevation != gElevation) {
        wmMapMarkMapEntranceState(gMapHeader.index, elevation, 1);
    }

    gElevation = elevation;

    reg_anim_clear(gDude);            // cancel all pending animations
    _dude_stand(gDude, rotation, fid); // snap player to idle stand
    _partyMemberSyncPosition();        // move party to same elevation

    if (gMapSid != -1) {
        scriptsExecMapUpdateProc();    // fires map_update_p_proc
    }

    return 0;
}
```

Key consequences of `mapSetElevation`:

1. **Renders only the new elevation.** `_obj_render_pre_roof` and `_obj_render_post_roof` take `gElevation` and skip any object whose `obj->elevation != elevation` (object.cc:800-804).
2. **Fires `map_update_p_proc` on the map script and all object scripts**, not `map_enter_p_proc`. Elevation change does not count as a map load.
3. **Does not re-run spatial scripts or re-fire `map_enter_p_proc`.** Those fire only on a full map load.
4. **All object scripts remain active.** Scripts on elevation 1 continue to run `critter_p_proc` even when the player is on elevation 0; they only become invisible.

### 12.1 Elevator Transitions (scriptsHandleRequests)

Elevators are the most common elevation-change mechanic. `scriptsHandleRequests` (scripts.cc:894) handles the `SCRIPT_REQUEST_ELEVATOR` flag:

- **Same map, same elevation:** just reposition the player.
- **Same map, different elevation:** close elevator doors on the old elevation → reposition player → `mapSetElevation(new)` → fires `map_update_p_proc`.
- **Different map:** close old elevator doors → set up `MapTransition` → full map reload on next frame.

The `elevator` script opcode enqueues a `SCRIPT_REQUEST_ELEVATOR` flag; the actual transition happens at the end of the current script tick.

### 12.2 Exit Grids and Stair Objects

Stair and ladder objects (scenery sub-type) store a destination packed in `Object.data.misc`:

- `object->data.misc.map` — destination map (-1 = same map)
- `object->data.misc.tile` — destination tile
- `object->data.misc.elevation` — destination elevation

When the player steps on the exit grid, `mapHandleTransition` (map.cc:1220) processes the transition.

---

## 13. CE — Object Visibility / Activity per Elevation

### 13.1 Rendering

`_obj_render_pre_roof(rect, elevation)` (object.cc:761) walks `gObjectListHeadByTile` and renders only objects where `obj->elevation == elevation`. Objects on other elevations are silently skipped. The renderer loop breaks early when `elevation < obj->elevation` (list is sorted by elevation ascending).

### 13.2 Blocking

All four blocking callbacks (`_obj_blocking_at`, `_obj_shoot_blocking_at`, `_obj_ai_blocking_at`, `_obj_sight_blocking_at` — object.cc:2387-2583) accept an `elevation` parameter and compare it against `obj->elevation` to filter objects.

### 13.3 Finding Objects at an Elevation

```cpp
// object.cc:2195 — objectFindFirstAtElevation
Object* objectFindFirstAtElevation(int elevation) {
    for (tile = 0; tile < HEX_GRID_SIZE; tile++) {
        // walk gObjectListHeadByTile[tile], return first obj->elevation == elevation
    }
}
```

Used by elevator code, `set_exit_grids`, and the map save logic.

---

## 14. CE — Spatial Scripts per Elevation

Spatial triggers are keyed by `builtTile = (tile | (elevation << N))`. `scriptGetFirstSpatialScript(elevation)` (scripts.cc:2442) filters the spatial script list to only those whose `builtTileGetElevation(script->sp.built_tile) == elevation`. The caller (`scriptsExecSpatialProc`, scripts.cc:2516) always passes `gElevation`, so spatials on inactive elevations never fire.

---

## 15. CE — Elevation-Related Scripting Opcodes

| Opcode | CE function | Behaviour |
|--------|-------------|-----------|
| `elevation(obj)` | `opGetObjectElevation` (interpreter_extra.cc:2285) | Returns `obj->elevation` — the elevation the named object actually occupies |
| `set_exit_grids(elev, mapID, destElev, destTile, destRot)` | interpreter_extra.cc:2183 | Patches all exit-grid objects on `elev` with a new destination |
| `obj_on_screen(obj)` | `opObjectOnScreen` (interpreter_extra.cc:4713) | Returns 1 only if `gElevation == obj->elevation` AND the object's screen rect intersects the viewport |

`map_enter_p_proc` receives `fixed_param = (flags & 1) == 0`, i.e., 1 on first visit, 0 on revisit (scripts.cc:2609).

---

## 16. DH2 Elevation Implementation

### 16.1 Data Layout

```typescript
// map.ts
currentElevation = 0          // active elevation
objects: Obj[][] = null       // [elevation][objectIndex]
spatials: any[][] = null      // [elevation][spatialIndex]
```

`getObjects(level?)` (map.ts) returns `objects[currentElevation]` by default — analogous to CE's elevation filter in rendering and blocking. The renderer only ever sees the current elevation's objects.

### 16.2 changeElevation

`GameMap.changeElevation(level, updateScripts, isMapLoading)` (map.ts):

1. Updates `currentElevation` and `globalState.currentElevation`.
2. Swaps `floorMap`/`roofMap` to the new elevation's tile layer.
3. Ends combat if active.
4. Moves player and party: removes from old elevation array, pushes onto new elevation array.
5. Re-initialises the renderer with the new tile and object sets.
6. If `updateScripts = true`: calls `Scripting.updateMap()` → fires `map_update_p_proc` on all objects on the new elevation. ✓ matches CE.
7. Rebuilds the lightmap.
8. Emits `elevationChanged` event.

### 16.3 doEnterElevation

`doEnterElevation()` (map.ts) is called from stair and ladder activation (object.ts, 792, 799):

```typescript
doEnterElevation(): void {
    if (this.mapScript?.map_enter_p_proc !== undefined) {
        this.mapScript.map_enter_p_proc()
    }
    for (const obj of this.getObjectsAndSpatials()) {
        Scripting.objectEnterMap(obj, elev, mapID)
    }
}
```

This fires `map_enter_p_proc` and each object's `map_enter_p_proc` on an **in-map elevation change** — which CE does not do. See gap EL2.

### 16.4 Spatial Trigger Filtering

`hitSpatialTrigger(position)` (object.ts):

```typescript
return globalState.gMap.getSpatials()  // getSpatials() uses currentElevation
    .filter((spatial) => hexDistance(position, spatial.position) <= spatial.range)
```

`getSpatials()` with no argument returns `spatials[currentElevation]`, so only spatials on the active elevation are considered. ✓ Matches CE behaviour.

### 16.5 `elevation()` Opcode

```typescript
// scripting.ts:752 — wired at vm_bridge.ts:158 as 0x80EC
elevation(obj: Obj) {
    if (isSpatial(obj) || isGameObject(obj)) return globalState.currentElevation
    // ...
}
```

Always returns the **player's current elevation**, ignoring the actual `obj.elevation`. CE returns `obj->elevation`. See gap EL1.

### 16.6 Elevator Objects

DH2 has no elevator opcode handler. Elevator-type scenery is treated as a stair object via `object.ts` stair/ladder branches, which use the destination elevation embedded in the object data. The `SCRIPT_REQUEST_ELEVATOR` path in CE (`scriptsHandleRequests`) — with its door-closing and same-map/cross-map split — is not implemented.

### 16.7 Elevation Presence vs. MapHeader.flags

DH2 derives elevation count directly from the JSON map's `levels` array length, set by the Python pipeline:

```typescript
// map.ts
this.numLevels = (map.levels ?? []).length
this.objects = new Array(map.levels.length)
```

The CE `_map_data_elev_flags` bitmask is not propagated to the JSON format. Empty elevations are simply absent from the levels array rather than flagged as empty.

---

## 17. Known Gaps

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| TS1 | **No edge-check in `hexInDirectionDistance`.** CE `tileGetTileInDirection` calls `tileIsEdge` and breaks if the tile is on the 200×200 grid boundary. DH2 `hexInDirectionDistance` has no equivalent guard; walking off the grid returns an `{x, y}` with values outside 0–199, which may cause out-of-bounds lookups in object lists or spatial arrays. | `src/geometry/hexGrid.ts` | `tile.cc:893 tileIsEdge()` | minor | bug |
| TS2 | **`hexDirectionTo` uses grid-space delta instead of screen-space delta.** CE `tileGetRotationTo` projects both tiles to screen space first. DH2 applies atan2 to the raw grid delta `(b.x−a.x, b.y−a.y)`. Because DH2's x-axis is reversed relative to screen-x, the returned direction value is systematically wrong (e.g., returns 4/W instead of 0/NE for the NE neighbour). The function carries a "TODO: check correctness" comment. | `src/geometry/hexGrid.ts` | `tile.cc:910 tileGetRotationTo()` | major | bug |
| TS3 | **No `_tile_num_beyond` equivalent.** CE uses this Bresenham-based function to find the tile at a given number of steps beyond a target along a straight line — used for projectile overshoot and `shoot_into_the_air`. DH2 has `hexLine(a, b)` which only walks *to* b, not past it. | `src/geometry/hexGrid.ts` | `tile.cc:944 _tile_num_beyond()` | minor | missing |
| TS4 | **`tile_coord()` in tile.ts is unused and broken.** `tile.ts:81` contains a CE-compatible `tile_coord(tileNum)` implementation with hardcoded offsets (`tile_offx=272, tile_offy=182`) and an active `console.log`. It is never called from anywhere in the codebase. | `src/tile.ts:81` | `tile.cc:674 tileToScreenXY()` | low | bug |
| EL1 | **`elevation(obj)` always returns player's current elevation.** `scripting.ts:753` returns `globalState.currentElevation` for all objects. CE `opGetObjectElevation` returns `obj->elevation`. Scripts that query a different object's elevation (e.g., checking if a party member fell to a lower level) get the wrong answer. | `scripting.ts:753`, `vm_bridge.ts:158` | `interpreter_extra.cc:2285 opGetObjectElevation()` | major | bug |
| EL2 | **`doEnterElevation()` fires `map_enter_p_proc` on stair/ladder elevation change.** CE `mapSetElevation` fires only `map_update_p_proc`. DH2 calls `doEnterElevation()` which runs `map_enter_p_proc` on every stair/ladder use, causing map-entry side-effects (light resets, NPC repositions, first-visit flags) to run on every floor change. | `src/map/GameMap.ts`, `src/object/Obj.ts` | `map.cc:362 mapSetElevation()` | major | bug |
| EL3 | **No elevator opcode handler.** CE `scriptsHandleRequests` has a dedicated elevator branch that closes old elevator doors, handles same-map vs. cross-map splits, and calls `mapSetElevation`. DH2 routes elevator-type objects through the generic stair/ladder path, skipping door animations and the same-map-different-elevation optimisation. | `object.ts` | `scripts.cc:926 scriptsHandleRequests SCRIPT_REQUEST_ELEVATOR` | minor | missing |
| EL4 | **`_map_data_elev_flags` bitmask not represented in DH2 map format.** CE saves per-elevation empty/non-empty state in `MapHeader.flags`. DH2's JSON pipeline omits this; all elevations present in the `levels` array are always loaded. Maps that CE would skip (empty elevations) are treated identically to populated ones. | `map.ts` | `map.cc:81 _map_data_elev_flags` | low | missing |
| EL5 | **`getObjectsAndSpatials()` passes no elevation to `getSpatials()`, so `map_update_p_proc` is fired only on current-elevation objects and spatials.** CE `scriptsExecMapUpdateScripts` runs `map_update_p_proc` on all loaded scripts regardless of elevation. Critters on other elevations do not tick their scripts when the player is away. | `map.ts`, `scripting.ts:2118` | `scripts.cc:2601 scriptsExecMapUpdateScripts()` | minor | bug |

<!-- audited: 2026-06-02 -->
