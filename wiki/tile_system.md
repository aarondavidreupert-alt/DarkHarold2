# Tile System

> **Source anchor:** `raw/fallout2-ce/src/tile.cc`, `tile.h`, `obj_types.h`
> **DH2 files:** `src/tile.ts`, `src/geometry.ts`, `src/map.ts`
> **Last audited:** 2026-06-02

---

## 1. Overview

This document covers the **coordinate layer** of Fallout 2's tile system: the two-grid architecture, square-tile projection and hit-testing, direction numbering, and the tile navigation functions (`tileGetTileInDirection`, `tileGetRotationTo`, `_tile_num_beyond`).

**Not duplicated here — see linked docs:**
- Isometric projection formulas and hex grid coordinate encoding → [`wiki/map_rendering.md`](map_rendering.md) §1–2
- Viewport, camera centering, scroll borders → [`wiki/map_rendering.md`](map_rendering.md) §5
- MAP binary header, variable arrays, tile data section, script section → [`wiki/file_formats.md`](file_formats.md) §MAP
- Render order, object depth sort, roof clipping → [`wiki/map_rendering.md`](map_rendering.md) §3–6

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
// src/geometry.ts:20
export const HEX_GRID_SIZE = 200   // grid is 200×200 hex cells

// src/tile.ts:19-20
export const TILE_WIDTH  = 80   // square tile pixel width
export const TILE_HEIGHT = 36   // square tile pixel height
```

---

## 3. tileNum Encoding (Summary)

Full detail is in `wiki/map_rendering.md` §2. Short form:

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

The −96 px offset shifts the roof sprite so it visually aligns above the floor it covers. DH2 replicates this exactly: `webglrenderer.ts:989` passes `−96` as the Y offset when drawing roof tiles (`drawTileMap(roofTiles, -96)`).

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

### 5.3 DH2 Direction Numbering (geometry.ts:139)

DH2's `hexNeighbors(position)` for even-x positions returns neighbors in the order:

```
dir 0: (x−1, y)    → screen (+16, −12) = NE  ← same as CE ROTATION_NE
dir 1: (x−1, y+1)  → screen (+16, +12) = SE  ← CE ROTATION_SE? No — E
dir 2: (x,   y+1)  → screen (−16, +12) = SW  ← CE ROTATION_SW? No — SE
dir 3: (x+1, y+1)  → screen (−16, +12) … SW
dir 4: (x+1, y)    → screen (−32, 0)   = W   ← CE ROTATION_W
dir 5: (x,   y−1)  → screen (−16, −12) = NW  ← CE ROTATION_NW
```

The exact mapping is derived from `hexToScreen` (geometry.ts:43). After substituting into the formula, the screen deltas for even-x are:

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

`_dir_tile[parity][rotation]` is the tileNum delta for one step in the given direction at the given column parity. See `wiki/map_rendering.md` §2 for the full delta table.

### 6.2 DH2: hexInDirection / hexInDirectionDistance (geometry.ts:167)

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

### 7.2 DH2: hexDirectionTo (geometry.ts:210)

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

The `"TODO: check correctness"` comment (geometry.ts:210) is warranted. See gap TS2.

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

### 8.2 DH2: hexLine (geometry.ts:244)

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

Square tile FIDs: art type bits `[27:24] = 4`. The LST index (bits `[11:0]`) looks up into `art/tiles/tiles.lst`. The Python pipeline (`fomap.py`) converts this to the FRM filename and stores it as a string in the JSON.

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

`GameMap.floorMap` and `GameMap.roofMap` hold the 2-D string arrays for the current elevation (`map.ts:219-220`). The renderer iterates `floorMap[y][x]` (100 rows × 100 cols) and calls `tileToScreen(x, y)` for each position.

---

## 10. Known Gaps

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| TS1 | **No edge-check in `hexInDirectionDistance`.** CE `tileGetTileInDirection` calls `tileIsEdge` and breaks if the tile is on the 200×200 grid boundary. DH2 `hexInDirectionDistance` has no equivalent guard; walking off the grid returns an `{x, y}` with values outside 0–199, which may cause out-of-bounds lookups in object lists or spatial arrays. | `src/geometry.ts:171` | `tile.cc:893 tileIsEdge()` | minor | bug |
| TS2 | **`hexDirectionTo` uses grid-space delta instead of screen-space delta.** CE `tileGetRotationTo` projects both tiles to screen space first. DH2 applies atan2 to the raw grid delta `(b.x−a.x, b.y−a.y)`. Because DH2's x-axis is reversed relative to screen-x, the returned direction value is systematically wrong (e.g., returns 4/W instead of 0/NE for the NE neighbour). The function carries a "TODO: check correctness" comment. | `src/geometry.ts:210` | `tile.cc:910 tileGetRotationTo()` | major | bug |
| TS3 | **No `_tile_num_beyond` equivalent.** CE uses this Bresenham-based function to find the tile at a given number of steps beyond a target along a straight line — used for projectile overshoot and `shoot_into_the_air`. DH2 has `hexLine(a, b)` which only walks *to* b, not past it. | `src/geometry.ts` | `tile.cc:944 _tile_num_beyond()` | minor | missing |
| TS4 | **`tile_coord()` in tile.ts is unused and broken.** `tile.ts:81` contains a CE-compatible `tile_coord(tileNum)` implementation with hardcoded offsets (`tile_offx=272, tile_offy=182`) and an active `console.log`. It is never called from anywhere in the codebase. | `src/tile.ts:81` | `tile.cc:674 tileToScreenXY()` | low | bug |

<!-- audited: 2026-06-02 -->
