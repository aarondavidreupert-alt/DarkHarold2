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

`canUseDoor` (`animation.cc:1667`): for **the dude** the door must be a walk-thru portal (proto scenery data `& 0x04`, `_obj_portal_is_walk_thru`) — no Fallout 2 door has it (all 98 door protos have 0), so the player never paths through a closed door and opens doors himself. Other critters pass a closed door that is an unlocked scenery door if they are biped or robotic and not geckos; `_object_move` then opens it (`_obj_use_door`) on the way.

---

## 6. DH2 Implementation

### `src/map/pathfinder.ts` (ported 2026-10-17, known_bugs C45)

`pathfinderFindPath(mover, from, to, goalMustBeFree)` is CE `pathfinderFindPath` line by line: a tile is taken on first discovery (never re-opened), `estimate = _idist(screen distance)`, cost 50 per step, +10 for a turn outside combat (also from the start node, whose rotation is 0), +400 on radioactive goo (+100 geckos), the open node with the lowest estimate + cost wins (ties: lowest slot), 2000 open / 2000 closed nodes at most (no path beyond), 800 rotations returned at most. The blocking test is CE `_obj_blocking_at` precomputed per tile (critters, scenery, walls; not hidden / NO_BLOCK; OBJECT_MULTIHEX also blocks its six neighbours; the mover never blocks itself); a blocked tile is only entered when it is a door the mover `canUseDoor`.

`GameMap.recalcPath(start, goal, isGoalBlocking?, mover?)` wraps it: the goal must be free unless `isGoalBlocking === false` (CE a5); `mover` defaults to the player; it returns `[x, y][]` from start to goal. The combat AI passes the critter and `false` for paths to a target critter (CE `_make_path(..., 0)`) — before, those paths always failed because the occupied goal counted as blocked.

### Blocking predicates

**`Obj.blocks()` (`src/object/Obj.ts`):**
- Returns `false` for `type === 'misc'`.
- Returns `true` if `!pro` (no proto — failsafe).
- Doors: block if `!this.open`.
- Invisible objects: `this.visible === false` → not blocking.
- Otherwise: `!(pro.flags & 0x00000010)` — the `NoBlock` proto flag.

**`Critter.blocks()` (`src/object/Critter.ts`):**
- `return this.dead !== true && this.visible !== false`

### Movement (`src/object/Critter.ts`)

- `Critter.walkTo(target, running?, callback?, maxLength?, path?)` — calls
  `recalcPath` if no path supplied; truncates to `maxLength` if set; sets
  `this.path = { path, index: 1, target, partial: 0 }` and starts walk animation.
- `Critter.walkInFrontOf(targetPos)` — calls `recalcPath(pos, target, false)`,
  pops the last tile so the critter stops adjacent to the target.

### Line-of-sight

DH2 has two LoS helpers:

**`GameMap.hexLinecast(a, b)` (`src/map/GameMap.ts`):**
Walks `hexLine(a, b)` (excluding endpoints), returns the first `Obj` found at any
interior tile regardless of object type. Used for interactable-object targeting in
`main.ts:860` and script `obj_can_see_obj` at `scripting.ts:341`.

**`Combat.hasLineOfSight(from, to)` (`src/combat/Combat.ts`):**
Walks the interior of `hexLine(from, to)`, blocks only on `type === 'wall'` objects.
Used for critter aggro/combat LoS checks (FO2 ref: `_combat_update_critters_in_los`).

`hexLine` itself (`src/geometry/hexGrid.ts`) is a greedy nearest-neighbor walk — at each
step it picks the adjacent hex closest to the target — not a CE-equivalent
step-by-direction algorithm.

---

## 7. DH2 vs CE Comparison

| Feature | CE | DH2 |
|---------|-----|-----|
| Algorithm, heuristic, costs, node limits, tie-break | `pathfinderFindPath` | Same (`src/map/pathfinder.ts`) |
| Door passthrough | `canUseDoor` (dude: walk-thru portals only) | Same; `Critter.move` opens a door only when `canUseDoor` |
| MULTIHEX / hidden / NO_BLOCK | `_obj_blocking_at` | Same |
| Dead critters | `critterKill` sets OBJECT_NO_BLOCK | `Critter.blocks()` false when dead — same |
| Shoot / sight blocking | `_obj_shoot_blocking_at`, `_obj_sight_blocking_at` | `GameMap.blockingObjectAt` types 0/1; `Combat.hasLineOfSight` walls + scenery without LIGHT_THRU |
| Straight line | `_make_straight_path_func` | `hexLine` — same concept, different step algorithm |
| `obj_blocking_at` / `make_straight_path` (0x826F / 0x826E) | sfall opcodes | wired (types 0/1) |

---

## 8. Known Gaps

| ID | Status |
|----|--------|
| P1–P3 | ✅ hex grid, turn cost, goo — now the literal CE port (C45) |
| P4 | ✅ door passthrough per `canUseDoor` — the player no longer walks through closed doors (C45) |
| P5 | ✅ MULTIHEX neighbours |
| P6 / P7 | ✅ shoot / sight blocking (`blockingObjectAt`, `hasLineOfSight`) |
| P8 | ✅ `obj_blocking_at` / `make_straight_path` |
| — | `hexLine` steps greedily rather than CE's `_make_straight_path_func` (open, low) |

<!-- audited: 2026-10-17 -->
