# Pathfinding — CE Reference and DH2 Status

CE pathfinding lives entirely in `animation.cc` (no separate `pathfind.cc`).
The public entry point is `_make_path`; the real implementation is
`pathfinderFindPath`. DH2 uses the third-party PathFinding.js library.

---

## 1. CE Architecture Overview

| Function | File | Address |
|----------|------|---------|
| `_make_path(obj, from, to, rotations, a5)` | `animation.cc:1709` | 0x415EE8 |
| `pathfinderFindPath(obj, from, to, rotations, a5, callback)` | `animation.cc:1716` | 0x415EFC |
| `_tile_idistance(tile1, tile2)` | `animation.cc:1929` | 0x416360 |
| `_idist(x1, y1, x2, y2)` | `animation.cc:1911` | 0x41633C |
| `_make_straight_path(obj, from, to, …)` | `animation.cc:1943` | 0x4163AC |
| `_make_straight_path_func(obj, from, to, …, callback)` | `animation.cc:1951` | 0x4163C8 |
| `_obj_blocking_at(excludeObj, tile, elev)` | `object.cc:2387` | 0x48B810 |
| `_obj_shoot_blocking_at(excludeObj, tile, elev)` | `object.cc:2440` | 0x48B930 |
| `_obj_ai_blocking_at(excludeObj, tile, elevation)` | `object.cc:2496` | 0x48BA20 |
| `_obj_sight_blocking_at(excludeObj, tile, elevation)` | `object.cc:2583` | 0x48BB88 |
| `_obj_scroll_blocking_at(tile, elev)` | `object.cc:2559` | — |

`_make_path` is a thin wrapper: it calls `pathfinderFindPath` with
`_obj_blocking_at` as the blocking callback.

---

## 2. CE A* Algorithm (`animation.cc:1716–1908`)

### Data structures

```c
// animation.cc:227–234
typedef struct PathNode {
    int   tile;       // tile index (-1 = empty slot in open list)
    int   from;       // tile index of predecessor
    int   rotation;   // direction taken from predecessor (0–5)
    int   estimate;   // heuristic distance to goal (in screen pixels)
    int   cost;       // accumulated g-cost
} PathNode;

static PathNode gOpenPathNodeList[2000];           // animation.cc:317
static PathNode gClosedPathNodeList[2000];         // animation.cc:308
static unsigned char gPathfinderProcessedTiles[5000]; // bit array, animation.cc:314
```

Max open list: 2000 nodes. Max closed list: 2000 nodes (function returns 0 = no
path if the closed list fills). Max path length: 800 steps (animation.cc:1869).

### Algorithm flow

1. **Init**: mark `from` tile in `gPathfinderProcessedTiles`; push start node
   `{tile=from, from=-1, rotation=0, estimate=_tile_idistance(from,to), cost=0}`.
2. **Main loop**: find open-list node with lowest `estimate + cost` (linear scan).
3. If lowest node's tile == `to` → break (path found).
4. Move lowest node to closed list. If `closedPathNodeListLength == 2000` → return 0.
5. **Expand neighbors**: for each of the 6 rotations:
   - Skip if tile already in processed set.
   - Skip if `callback(object, tile, elevation) != nullptr` **and** `!canUseDoor(object, obstacle)`.
   - Push neighbor to open list with:
     - `estimate = _idist(screenX, screenY, goalScreenX, goalScreenY)` (animation.cc:1835)
     - `cost = parent.cost + 50` (animation.cc:1836)
     - If outside combat and `parent.rotation != rotation`: `cost += 10` (animation.cc:1838–1840)
     - If critter and tile contains radioactive goo: `cost += 100` (gecko) or `cost += 400` (others) (animation.cc:1852–1857)
6. If open list empties → path failed.
7. **Back-trace**: walk closed list from goal back to start, collect `rotation` at
   each node, then reverse the array so rotations are start→goal order.
8. Returns: number of steps (0 = no path).

### Heuristic: `_tile_idistance` / `_idist`

```c
// animation.cc:1929
static int _tile_idistance(int tile1, int tile2) {
    tileToScreenXY(tile1, &x1, &y1, gElevation);
    tileToScreenXY(tile2, &x2, &y2, gElevation);
    return _idist(x1, y1, x2, y2);
}

// animation.cc:1911
static int _idist(int x1, int y1, int x2, int y2) {
    int dx = abs(x2 - x1), dy = abs(y2 - y1);
    int dm = (dx <= dy) ? dx : dy;
    return dx + dy - (dm / 2);   // octile-like distance in screen pixels
}
```

This is an integer approximation of Euclidean distance using screen-pixel
coordinates, not hex cube distance. It is admissible (never over-estimates)
so A* is optimal.

---

## 3. CE Blocking Callbacks (`object.cc:2387–2614`)

All four callbacks have the same signature: `Object* fn(Object* excludeObj, int tile, int elev)`.
Return `nullptr` = tile passable; return non-null = tile blocked.

Each callback checks the tile itself **and** all 6 adjacent tiles for any
object with `OBJECT_MULTIHEX` set (animation.cc:1795 uses `tileGetTileInDirection`
to enumerate neighbors).

### `_obj_blocking_at` (`object.cc:2387`)

Blocks if any object at `tile` or a MULTIHEX neighbor has:
- `type ∈ {OBJ_TYPE_CRITTER, OBJ_TYPE_SCENERY, OBJ_TYPE_WALL}`
- `!(flags & OBJECT_HIDDEN)`
- `!(flags & OBJECT_NO_BLOCK)`
- `obj != excludeObj`

### `_obj_shoot_blocking_at` (`object.cc:2440`)

Same criteria, plus:
- Dead critters are **not** blocking (SFALL fix, `!critterIsDead(candidate)`).
- Objects with `OBJECT_SHOOT_THRU` are excluded.

### `_obj_ai_blocking_at` (`object.cc:2496`)

Same as `_obj_blocking_at`, but the **first critter** hit is stored in the
module-level `_moveBlockObj` instead of blocking immediately. This allows AI
pathfinding to pass through exactly one critter (e.g., stepping past an ally).
Subsequent critters do block.

### `_obj_sight_blocking_at` (`object.cc:2583`)

Blocks only `OBJ_TYPE_SCENERY` and `OBJ_TYPE_WALL` objects where
`!(flags & OBJECT_LIGHT_THRU)`. Critters and items are transparent to sight.

### BLOCKING_TYPE enum (sfall, `sfall_opcodes.cc:914–919`)

| Constant | Value | Callback |
|----------|-------|----------|
| `BLOCKING_TYPE_BLOCK` | 0 | `_obj_blocking_at` |
| `BLOCKING_TYPE_SHOOT` | 1 | `_obj_shoot_blocking_at` |
| `BLOCKING_TYPE_AI` | 2 | `_obj_ai_blocking_at` |
| `BLOCKING_TYPE_SIGHT` | 3 | `_obj_sight_blocking_at` |
| `BLOCKING_TYPE_SCROLL` | 4 | `_obj_scroll_blocking_at` |

---

## 4. CE Straight-Line Path (`animation.cc:1943–2099`)

`_make_straight_path_func` walks a hex line from `from` to `to` using the six
rotation directions, calling `callback` at each intermediate tile. Used for:
- **Line-of-fire**: with `_obj_shoot_blocking_at` to find the first bullet obstacle.
- **Line-of-sight**: with `_obj_sight_blocking_at` or `_obj_blocking_at`.
- **Cone/blast radius**: called from explosion code.

`_make_straight_path` (animation.cc:1943) is the `_obj_blocking_at`-defaulting
wrapper, symmetric to `_make_path` vs `pathfinderFindPath`.

---

## 5. Door Passthrough

During A* expansion (animation.cc:1805–1807):
```c
Object* v24 = callback(object, tile, object->elevation);
if (v24 != nullptr) {
    if (!canUseDoor(object, v24)) {
        continue;  // hard block
    }
    // else: obstacle is an openable door — tile is traversable
}
```

`canUseDoor` (proto_instance.cc) checks that the obstacle is an unlocked/openable
door and that `object` (the pathfinder) can interact with it. This allows A* to
route through closed-but-openable doors; the animation layer then opens the door
before the critter steps through.

---

## 6. DH2 Implementation

### Library

DH2 uses [PathFinding.js](https://github.com/qiao/PathFinding.js) (bundled as
`lib/pathfinding-browser.js`, exposed as global `PF`; declared `declare let PF: any`
in `map.ts:31`).

### `GameMap.recalcPath` (`map.ts:588`)

```typescript
recalcPath(start: Point, goal: Point, isGoalBlocking?: boolean) {
    const matrix = new Array(HEX_GRID_SIZE)
    for (let y = 0; y < HEX_GRID_SIZE; y++)
        matrix[y] = new Array(HEX_GRID_SIZE)

    for (const obj of this.getObjects())
        matrix[obj.position.y][obj.position.x] |= <any>obj.blocks()

    if (isGoalBlocking === false)
        matrix[goal.y][goal.x] = 0   // allow walking into blocking goal tile

    const grid = new PF.Grid(HEX_GRID_SIZE, HEX_GRID_SIZE, matrix)
    const finder = new PF.AStarFinder()
    return finder.findPath(start.x, start.y, goal.x, goal.y, grid)
}
```

Returns `[x, y][]` — an array of grid coordinates from start to goal.

### Blocking predicates

**`Obj.blocks()` (`object.ts:559`):**
- Returns `false` for `type === 'misc'`.
- Returns `true` if `!pro` (no proto — failsafe).
- Doors: block if `!this.open`.
- Invisible objects: `this.visible === false` → not blocking.
- Otherwise: `!(pro.flags & 0x00000010)` — the `NoBlock` proto flag.

**`Critter.blocks()` (`object.ts:1496`):**
- `return this.dead !== true && this.visible !== false`

### Movement (`object.ts:1790–1860`)

- `Critter.walkTo(target, running?, callback?, maxLength?, path?)` — calls
  `recalcPath` if no path supplied; truncates to `maxLength` if set; sets
  `this.path = { path, index: 1, target, partial: 0 }` and starts walk animation.
- `Critter.walkInFrontOf(targetPos)` — calls `recalcPath(pos, target, false)`,
  pops the last tile so the critter stops adjacent to the target.

### Line-of-sight

DH2 has two LoS helpers:

**`GameMap.hexLinecast(a, b)` (`map.ts:571`):**
Walks `hexLine(a, b)` (excluding endpoints), returns the first `Obj` found at any
interior tile regardless of object type. Used for interactable-object targeting in
`main.ts:860` and script `obj_can_see_obj` at `scripting.ts:341`.

**`Combat.hasLineOfSight(from, to)` (`combat.ts:1463`):**
Walks the interior of `hexLine(from, to)`, blocks only on `type === 'wall'` objects.
Used for critter aggro/combat LoS checks (FO2 ref: `_combat_update_critters_in_los`).

`hexLine` itself (`geometry.ts:244`) is a greedy nearest-neighbor walk — at each
step it picks the adjacent hex closest to the target — not a CE-equivalent
step-by-direction algorithm.

---

## 7. DH2 vs CE Comparison

| Feature | CE | DH2 |
|---------|-----|-----|
| Algorithm | A* in `animation.cc` | PathFinding.js A* on 2D grid |
| Grid model | Hex tile indices (200×200, `tileNum = y*200+x`) | Same 200×200 array, but PathFinding.js treats it as orthogonal |
| Heuristic | Screen-pixel octile distance (`_idist`, `animation.cc:1911`) | PathFinding.js default (Manhattan or Euclidean on grid coords) |
| Output format | `rotations[]` array of direction 0-5 | `[x, y][]` coordinate pairs |
| Max path length | 800 steps, 2000-node closed list | Unbounded (library default) |
| Base step cost | 50 | Equal (library default: 1) |
| Rotation-change penalty | +10 (outside combat) | None |
| Radioactive goo penalty | +100/+400 | None |
| Door passthrough | Yes (`canUseDoor` in expansion loop) | No — closed doors are hard blocks |
| MULTIHEX neighbor check | Yes (6 neighbors per tile) | No |
| Shoot-blocking type | `_obj_shoot_blocking_at` (excludes SHOOT_THRU, skips dead critters) | No dedicated variant |
| AI-blocking type | `_obj_ai_blocking_at` (one critter passthrough) | No dedicated variant |
| Sight-blocking type | `_obj_sight_blocking_at` (scenery/wall, LIGHT_THRU aware) | Partial — `hasLineOfSight` checks wall type only; `hexLinecast` checks all types |
| Straight-line LoF | `_make_straight_path_func` (hex step directions) | `hexLine` greedy walk — same concept, different step algorithm |
| Dead critters blocking paths | Yes (treated as critters) | `Critter.blocks()` returns `false` when dead |
| Script opcode `make_path` | `pathfinderFindPath` with `_obj_blocking_at` | Not implemented (`stub()`) |
| Script opcode `obj_blocking_at` | `_obj_blocking_at` | Not implemented (`stub()`) |

---

## 8. Known Gaps

| ID | Description | DH2 Location | CE Reference | Severity |
|----|-------------|--------------|--------------|----------|
| P1 | PathFinding.js models the hex grid as an orthogonal rectangle. Diagonal moves in PathFinding.js are 4-connected or 8-connected (depending on heuristic); CE steps through all 6 hex rotations. Path quality near edges or angled obstacles may differ. | `map.ts:604` | `animation.cc:1795` | Medium |
| P2 | No rotation-change step cost (+10 in CE, outside combat) | `map.ts:605` | `animation.cc:1838` | Low |
| P3 | No radioactive goo tile penalty (+100 geckos / +400 others) | `map.ts:596` | `animation.cc:1852` | Low |
| P4 | Closed doors are hard blocks in pathfinding. CE's `canUseDoor` check routes through unlocked/openable doors and the critter opens them en route. | `map.ts:596` | `animation.cc:1805` | Medium |
| P5 | No `OBJECT_MULTIHEX` neighbor check in `blocks()`. CE checks all 6 adjacent tiles for multihex objects when computing blocking. | `object.ts:559` | `object.cc:2413` | Low |
| P6 | No shoot-blocking type: `_obj_shoot_blocking_at` skips dead critters and OBJECT_SHOOT_THRU objects; DH2 uses the same `blocks()` for everything. | `map.ts:596` | `object.cc:2440` | Medium |
| P7 | `hasLineOfSight` checks only `type === 'wall'`; CE's `_obj_sight_blocking_at` also blocks on scenery objects without `OBJECT_LIGHT_THRU`. Scenery objects currently do not block combat LoS. | `combat.ts:1471` | `object.cc:2583` | Medium |
| P8 | Script opcodes `make_path` and `obj_blocking_at` / `make_straight_path` are stubs. | `scripting.ts` | `sfall_opcodes.cc:937,951` | Low |

<!-- audited: 2026-06-02 -->
