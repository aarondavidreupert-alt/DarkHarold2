# Lighting System — Deep Dive

This document extends `wiki/lighting.md` with CE internal call-chain detail, additional DH2 gaps, and answers to specific implementation questions. Read `wiki/lighting.md` first for the overview, ambient curve, propagation algorithm, and render integration.

Cross-references: `wiki/lighting.md` (overview), `wiki/map_rendering.md §9` (WebGL FBO path), `wiki/known_bugs.md §LD`.

---

## 1. `light.cc` Tile Intensity API

CE exposes the per-tile intensity array through `light.cc`, not through `tile.cc` (the task description names `tileSetLight/tileGetLight/tileRefreshLight` — these do not exist; they are aliases for the names below).

The backing store is `gTileIntensity[ELEVATION_COUNT][HEX_GRID_SIZE]` (`light.cc:20`) — a 3 × 40,000 integer array. All values start at the floor **655** (`lightResetTileIntensity`, `light.cc:134`).

| Function | Address | Behaviour |
|----------|---------|-----------|
| `lightGetAmbientIntensity()` | 0x47A8F8 | Returns `gAmbientIntensity` (global scalar, not per-tile) |
| `lightSetAmbientIntensity(i, refresh)` | 0x47A908 | Adds Night Vision bonus, clamps to `[MIN, MAX]`, triggers `tileWindowRefresh()` if changed and `refresh=true` |
| `lightGetTileIntensity(elev, tile)` | 0x47A980 | Returns `min(gTileIntensity[elev][tile], 65536)` — **clamped** |
| `lightGetTrueTileIntensity(elev, tile)` | 0x47A9C4 | Returns raw `gTileIntensity[elev][tile]` — **may exceed 65536** when multiple light sources overlap |
| `lightSetTileIntensity(elev, tile, i)` | 0x47A9EC | Direct write — used during map load to inject baked tile data |
| `lightIncreaseTileIntensity(elev, tile, i)` | 0x47AA10 | `gTileIntensity[elev][tile] += i` — called by `_obj_adjust_light` when adding a source |
| `lightDecreaseTileIntensity(elev, tile, i)` | 0x47AA48 | `gTileIntensity[elev][tile] -= i` — called by `_obj_adjust_light` when removing a source |

**"True" vs clamped distinction.** `objectGetLightIntensity()` (`object.cc:1748`) uses `lightGetTrueTileIntensity` (not the clamped version) to retrieve the tile's raw accumulated value. This matters when two strong light sources overlap — the raw sum can exceed 65536, and CE uses the full accumulated value for the self-subtraction step (§3) before clamping the final result.

DH2 `tile_intensity` (`lightmap.ts:37`) stores raw accumulated values; `light_add_to_tile` and `light_subtract_from_tile` perform unchecked addition/subtraction on the array. The normalized upload to GPU (`tile_intensity[i] / 65536`) will silently clamp values above 1.0 in the shader's `max(tileLight, u_ambient)`. This matches CE's clamped read path.

---

## 2. `_obj_adjust_light` Entry Guards

CE's `_obj_adjust_light` (`object.cc:3963`) is the single function that applies or removes a light source from the tile intensity array. It has four early-exit conditions that DH2 does not fully replicate:

```c
// object.cc:3963-3983
if (obj == nullptr)                          return -1;
if (obj->lightIntensity <= 0)                return -1;
if ((obj->flags & OBJECT_HIDDEN) != 0)       return -1;   // (A)
if ((obj->flags & OBJECT_LIGHTING) == 0)     return -1;   // (B)
if (!hexGridTileIsValid(obj->tile))          return -1;
```

### (A) `OBJECT_HIDDEN` guard

When an object is hidden via `set_obj_visibility`, CE sets `OBJECT_HIDDEN` (`obj_types.h:46 = 0x01`) on the object. `_obj_adjust_light` bails immediately, so **hidden objects contribute no light**. DH2's `obj_adjust_light` has no `visible` check:

```typescript
// lightmap.ts:68 — DH2 obj_adjust_light
function obj_adjust_light(obj: Obj, isSub: boolean = false) {
    var pos = obj.position
    var lightModifier = isSub ? light_subtract_from_tile : light_add_to_tile
    lightModifier(toTileNum(obj.position), obj.lightIntensity)
    // … no check for obj.visible
```

`bakeStaticLight()` (`lightmap.ts:564`) iterates all non-critter objects unconditionally and calls `obj_adjust_light` on each. An object with `obj.visible = false` (set by `set_obj_visibility`) still radiates light in DH2.

### (B) `OBJECT_LIGHTING` guard

`OBJECT_LIGHTING = 0x20` (`obj_types.h:61`) is a flag set on objects that are meant to emit light. CE bails if this flag is absent — objects without it never contribute to the lightmap even if their `lightIntensity > 0`.

DH2 does not check this flag anywhere. Any object with `lightRadius > 0` contributes light regardless of whether the PRO data had the LIGHTING flag set.

### `objectSetLight` call chain

Full sequence when a light source changes (`objectSetLight`, `object.cc:1721`):

```
objectSetLight(obj, distance, intensity, rect)
  → _obj_turn_off_light(obj, rect)         // subtract current contribution
      → _obj_adjust_light(obj, isSub=1)    // lightDecreaseTileIntensity for each affected tile
  → obj->lightDistance = min(distance, 8)
  → obj->lightIntensity = intensity
  → _obj_turn_on_light(obj, rect)          // add new contribution
      → _obj_adjust_light(obj, isSub=0)    // lightIncreaseTileIntensity for each affected tile
```

DH2's `obj_set_light_level` scripting handler (`scripting.ts:1262`) only updates `obj.lightRadius` and `obj.lightIntensity` on the object — it never calls `obj_adjust_light` or `bakeStaticLight`. The lightmap is therefore stale until the next map load. See §LD2 in gaps.

---

## 3. `objectGetLightIntensity` — Self-Subtraction Formula

`objectGetLightIntensity(obj)` (`object.cc:1748`) computes the effective light level at an object's location — used for the night to-hit penalty and the `obj_is_visible` opcode:

```c
int ambientIntensity   = lightGetAmbientIntensity();
int tileIntensity      = lightGetTrueTileIntensity(obj->elevation, obj->tile);

if (obj == gDude) {
    tileIntensity -= gDude->lightIntensity;   // subtract player's own contribution
}

if (tileIntensity >= ambientIntensity)
    return min(tileIntensity, LIGHT_INTENSITY_MAX);   // tile is brighter than ambient
else
    return ambientIntensity;                           // ambient floor
```

The **self-subtraction** prevents the player from always appearing "well-lit" due to their own torch. Without it, `objectGetLightIntensity(gDude)` would always return near-max regardless of ambient.

DH2 has no equivalent of `objectGetLightIntensity`. The night-penalty path in `combat.ts:441` has the comment `"light conditions not yet factored in"` and does nothing. The self-subtraction is therefore not an issue in practice, but it would be needed if the night penalty were ever implemented.

---

## 4. `_obj_light_table_init` — Parity-Dependent Offset Table

`_obj_light_table_init()` (`object.cc:3433`) precomputes `_light_offsets[2][6][36]` — a table of tile-number deltas from an origin tile to each of the 36 cells in the light diamond, for two parity values (even-x and odd-x origin tiles).

```c
for (int s = 0; s < 2; s++) {           // s = origin parity (0 = even, 1 = odd)
    int v4 = gCenterTile + s;
    for (int i = 0; i < 6; i++) {       // i = rotation / hex direction
        int v15 = 8;                     // cells along this arm
        int* p = _light_offsets[v4 & 1][i];
        for (int j = 0; j < 8; j++) {   // j = arm step (lateral offset)
            int tile = tileGetTileInDirection(v4, (i+1) % 6, j);
            for (int m = 0; m < v15; m++) {
                *p++ = tileGetTileInDirection(tile, i, m+1) - v4;
            }
            v15--;
        }
    }
}
```

This is called once during `objectInit()` with `gCenterTile` as the seed. The resulting table contains signed tile-number offsets valid for the current map's 200-wide grid. Offsets are parity-dependent because the hex grid's neighbor-offset table differs for even-x and odd-x tiles (see `wiki/tile_system.md §5`).

DH2's `obj_light_table_init()` (`lightmap.ts:365`) mirrors this logic. It is called lazily on the first `obj_adjust_light()` invocation (init guard at `lightmap.ts:76`).

**CE caveat**: `gCenterTile` is the viewport center tile, not the object's tile. The offsets are relative to `gCenterTile`, not to the object. When the table is used, each offset is added to the object's tile number to get the destination tile. This means the table must be regenerated whenever `gCenterTile` changes significantly — CE does this in `tileSetCenter()`. DH2 initialises the table once and never regenerates it, which is correct because the offsets are stable within a 200-wide grid regardless of `gCenterTile`.

---

## 5. `set_obj_visibility` Opcode

| Item | CE | DH2 |
|------|----|----|
| Opcode | `0x80E3` | `0x80E3` |
| Args | `obj, invisible_flag (0/1)` | same |
| CE handler | `opSetObjectVisibility` (`interpreter_extra.cc:2080`) | — |
| DH2 handler | — | `Script.set_obj_visibility` (`scripting.ts:1213`) |
| Wired | Yes — `vm_bridge.ts:133` | Yes (same line) |

### CE behaviour (`interpreter_extra.cc:2080`)

When `invisible != 0` (hide):
1. If object is not already hidden and game is not loading:
2. `objectDisableOutline` + `objectClearOutline` (combat only)
3. `objectHide(obj, &rect)` → sets `OBJECT_HIDDEN | OBJECT_NO_SAVE`, subtracts from lightmap via `_obj_turn_off_light`
4. If critter: also sets `OBJECT_NO_BLOCK`
5. `tileWindowRefreshRect` to redraw

When `invisible == 0` (show):
1. `objectShow(obj, &rect)` → clears `OBJECT_HIDDEN | OBJECT_NO_SAVE`, adds back to lightmap via `_obj_turn_on_light`
2. If critter: clears `OBJECT_NO_BLOCK`
3. `tileWindowRefreshRect`

### DH2 behaviour (`scripting.ts:1213`)

```typescript
set_obj_visibility(obj: Obj, visibility: number) {
    obj.visible = !visibility
}
```

Differences:
- **No light update** — CE calls `_obj_turn_off_light` / `_obj_turn_on_light` through `objectHide`/`objectShow`. DH2 only toggles `obj.visible`. The object's light contribution is not removed from the lightmap, and `bakeStaticLight` is not triggered. Hidden objects still illuminate tiles.
- **No `OBJECT_NO_BLOCK`** — CE removes critters from pathfinding when hidden. DH2 leaves the collision flag unchanged.
- **No `OBJECT_NO_SAVE`** — CE tags hidden objects to skip save serialisation. DH2 serialises `obj.visible` in the save JSON.

---

## 6. Torch Flicker — Not Present

Fallout 2 CE has no torch-flicker effect. There is no time-based variation of `lightIntensity` or `lightDistance` for any object type in the CE codebase. All light is static between script calls. Objects with animated fire FRMs (candles, campfires) appear to flicker because the sprite animates — the light radius does not change.

DH2 likewise has no flicker. The `rebuildDynamicLight()` function (`lightmap.ts:576`) is called every render frame but only reapplies static critter-light values — it does not animate them.

---

## 7. Additional Known Gaps

These complement the 10 gaps already documented in `wiki/lighting.md §9`. The gap IDs below use the `LD` prefix for the new known_bugs.md section §LD.

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| LD1 | **Hidden objects still emit light.** `bakeStaticLight()` and `rebuildDynamicLight()` do not check `obj.visible`. CE `_obj_adjust_light` bails when `OBJECT_HIDDEN` is set, removing the contribution. Scripts that hide a light-emitting object (e.g. `set_obj_visibility(torch, 1)`) will find the tile still lit in DH2. | `src/lightmap.ts:564,576` | `object.cc:3973` | minor | bug |
| LD2 | **`OBJECT_LIGHTING` flag not checked.** CE bails in `_obj_adjust_light` when `(flags & OBJECT_LIGHTING) == 0`. DH2 illuminates any object with `lightRadius > 0` regardless of whether the LIGHTING flag is set in the object's PRO data. Objects that have a light radius field but the flag unset will incorrectly contribute light. | `src/lightmap.ts:68` | `object.cc:3977`; `obj_types.h:61` | low | bug |
| LD3 | **`obj_set_light_level` does not update the lightmap.** `scripting.ts:1267` stores `intensity` and `distance` on the object but never calls `obj_adjust_light()` or triggers `bakeStaticLight()`. The visible lightmap does not change until the next map reload. CE `opSetObjectLightLevel` calls `objectSetLight()` which triggers the full turn-off/turn-on cycle and refreshes the screen rect. | `src/scripting.ts:1262` | `interpreter_extra.cc:3071`; `object.cc:1721` | major | bug |
| LD4 | **`set_obj_visibility` does not update the lightmap.** `scripting.ts:1213` sets `obj.visible = !visibility` but does not remove or restore the object's light contribution. CE `objectHide`/`objectShow` call `_obj_turn_off_light` / `_obj_turn_on_light`. | `src/scripting.ts:1213` | `interpreter_extra.cc:2096-2119` | minor | bug |
| LD5 | **`objectGetLightIntensity` self-subtraction not implemented.** No DH2 function computes effective light at a tile by subtracting the observer's own contribution — needed correctly for the night to-hit penalty. Moot while the penalty itself is absent (lighting.md gap #1). | `src/combat.ts:441` | `object.cc:1748` | low | missing |
| LD6 | **CE `obj_set_light_level` intensity argument is 0–100 %; DH2 stores the raw value.** CE converts via `(intensity × 65636) / 100`. `scripting.ts:1267` stores the raw integer directly, giving 100× too dim a result when scripts pass percentage values. Note the CE source has a typo: `65636` instead of `65536` (≈0.15 % error). | `src/scripting.ts:1267` | `interpreter_extra.cc:3071` | major | bug |

Last audited: 2026-06-02
