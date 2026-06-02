# Elevation System

> **Source anchor:** `raw/fallout2-ce/src/map.cc`, `map.h`, `map_defs.h`, `object.cc`, `scripts.cc`, `interpreter_extra.cc`
> **DH2 files:** `src/map.ts`, `src/object.ts`, `src/scripting.ts`, `src/vm_bridge.ts`
> **Last audited:** 2026-06-02

---

## 1. Overview

Fallout 2 maps support up to three independent horizontal planes called elevations (0, 1, 2). Each elevation has its own tile grid, object set, and spatial script list. Elevation change is **not** a map transition — the script context, object scripts, and variable state all persist. Only the active tile layer, object set, and spatial list change. The most common real-world use is multi-storey buildings (Klamath bat caves, Vault City vault levels, NCR downtown/sewers).

Out of the 151 maps in the DH2 build, 43 contain more than one elevation (including 2 with all 3 levels).

---

## 2. CE — Constants and Data Structures

### 2.1 Elevation count

```cpp
// map_defs.h:6
#define ELEVATION_COUNT (3)

static inline bool elevationIsValid(int elevation) {
    return elevation >= 0 && elevation < ELEVATION_COUNT;
}
```

Elevation indices are 0, 1, 2. There is no runtime way to add a fourth elevation.

### 2.2 MapHeader.flags — Elevation Presence Bitmask

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

### 2.3 gElevation — Active Elevation

```cpp
// map.cc:124
int gElevation = 0;
```

All rendering, pathfinding, lighting, and spatial-trigger calls receive `gElevation` as the authoritative elevation. The player's `gDude->elevation` matches this after every `mapSetElevation` call.

### 2.4 Object.elevation

Every `Object` carries its own `elevation` field (`obj_types.h`). This is set by `objectSetLocation` / `_obj_connect_to_tile` whenever an object is placed. All objects on all elevations reside in the same `gObjectListHeadByTile[]` array; elevation is used to filter which objects are visible, blocking, or script-active.

---

## 3. CE — Elevation Change Sequence

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

### 3.1 Elevator Transitions (scriptsHandleRequests)

Elevators are the most common elevation-change mechanic. `scriptsHandleRequests` (scripts.cc:894) handles the `SCRIPT_REQUEST_ELEVATOR` flag:

- **Same map, same elevation:** just reposition the player.
- **Same map, different elevation:** close elevator doors on the old elevation → reposition player → `mapSetElevation(new)` → fires `map_update_p_proc`.
- **Different map:** close old elevator doors → set up `MapTransition` → full map reload on next frame.

The `elevator` script opcode enqueues a `SCRIPT_REQUEST_ELEVATOR` flag; the actual transition happens at the end of the current script tick.

### 3.2 Exit Grids and Stair Objects

Stair and ladder objects (scenery sub-type) store a destination packed in `Object.data.misc`:

- `object->data.misc.map` — destination map (-1 = same map)
- `object->data.misc.tile` — destination tile
- `object->data.misc.elevation` — destination elevation

When the player steps on the exit grid, `mapHandleTransition` (map.cc:1220) processes the transition.

---

## 4. CE — Object Visibility / Activity per Elevation

### 4.1 Rendering

`_obj_render_pre_roof(rect, elevation)` (object.cc:761) walks `gObjectListHeadByTile` and renders only objects where `obj->elevation == elevation`. Objects on other elevations are silently skipped. The renderer loop breaks early when `elevation < obj->elevation` (list is sorted by elevation ascending).

### 4.2 Blocking

All four blocking callbacks (`_obj_blocking_at`, `_obj_shoot_blocking_at`, `_obj_ai_blocking_at`, `_obj_sight_blocking_at` — object.cc:2387-2583) accept an `elevation` parameter and compare it against `obj->elevation` to filter objects.

### 4.3 Finding Objects at an Elevation

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

## 5. CE — Spatial Scripts per Elevation

Spatial triggers are keyed by `builtTile = (tile | (elevation << N))`. `scriptGetFirstSpatialScript(elevation)` (scripts.cc:2442) filters the spatial script list to only those whose `builtTileGetElevation(script->sp.built_tile) == elevation`. The caller (`scriptsExecSpatialProc`, scripts.cc:2516) always passes `gElevation`, so spatials on inactive elevations never fire.

---

## 6. CE — Scripting Opcodes

| Opcode | CE function | Behaviour |
|--------|-------------|-----------|
| `elevation(obj)` | `opGetObjectElevation` (interpreter_extra.cc:2285) | Returns `obj->elevation` — the elevation the named object actually occupies |
| `set_exit_grids(elev, mapID, destElev, destTile, destRot)` | interpreter_extra.cc:2183 | Patches all exit-grid objects on `elev` with a new destination |
| `obj_on_screen(obj)` | `opObjectOnScreen` (interpreter_extra.cc:4713) | Returns 1 only if `gElevation == obj->elevation` AND the object's screen rect intersects the viewport |

`map_enter_p_proc` receives `fixed_param = (flags & 1) == 0`, i.e., 1 on first visit, 0 on revisit (scripts.cc:2609).

---

## 7. DH2 Implementation

### 7.1 Data Layout

```typescript
// map.ts:66-73
currentElevation = 0          // active elevation
objects: Obj[][] = null       // [elevation][objectIndex]
spatials: any[][] = null      // [elevation][spatialIndex]
```

`getObjects(level?)` (map.ts:85) returns `objects[currentElevation]` by default — analogous to CE's elevation filter in rendering and blocking. The renderer only ever sees the current elevation's objects.

### 7.2 changeElevation

`GameMap.changeElevation(level, updateScripts, isMapLoading)` (map.ts:208):

1. Updates `currentElevation` and `globalState.currentElevation`.
2. Swaps `floorMap`/`roofMap` to the new elevation's tile layer.
3. Ends combat if active.
4. Moves player and party: removes from old elevation array, pushes onto new elevation array.
5. Re-initialises the renderer with the new tile and object sets.
6. If `updateScripts = true`: calls `Scripting.updateMap()` → fires `map_update_p_proc` on all objects on the new elevation. ✓ matches CE.
7. Rebuilds the lightmap.
8. Emits `elevationChanged` event.

### 7.3 doEnterElevation

`doEnterElevation()` (map.ts:193) is called from stair and ladder activation (object.ts:775, 792, 799):

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

### 7.4 Spatial Trigger Filtering

`hitSpatialTrigger(position)` (object.ts:1941):

```typescript
return globalState.gMap.getSpatials()  // getSpatials() uses currentElevation
    .filter((spatial) => hexDistance(position, spatial.position) <= spatial.range)
```

`getSpatials()` with no argument returns `spatials[currentElevation]`, so only spatials on the active elevation are considered. ✓ Matches CE behaviour.

### 7.5 `elevation()` Opcode

```typescript
// scripting.ts:752 — wired at vm_bridge.ts:158 as 0x80EC
elevation(obj: Obj) {
    if (isSpatial(obj) || isGameObject(obj)) return globalState.currentElevation
    // ...
}
```

Always returns the **player's current elevation**, ignoring the actual `obj.elevation`. CE returns `obj->elevation`. See gap EL1.

### 7.6 Elevator Objects

DH2 has no elevator opcode handler. Elevator-type scenery is treated as a stair object via `object.ts` stair/ladder branches, which use the destination elevation embedded in the object data. The `SCRIPT_REQUEST_ELEVATOR` path in CE (`scriptsHandleRequests`) — with its door-closing and same-map/cross-map split — is not implemented.

### 7.7 Elevation Presence vs. MapHeader.flags

DH2 derives elevation count directly from the JSON map's `levels` array length, set by the Python pipeline:

```typescript
// map.ts:435
this.numLevels = (map.levels ?? []).length
this.objects = new Array(map.levels.length)
```

The CE `_map_data_elev_flags` bitmask is not propagated to the JSON format. Empty elevations are simply absent from the levels array rather than flagged as empty.

---

## 8. Known Gaps

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| EL1 | **`elevation(obj)` always returns player's current elevation.** `scripting.ts:753` returns `globalState.currentElevation` for all objects. CE `opGetObjectElevation` returns `obj->elevation`. Scripts that query a different object's elevation (e.g., checking if a party member fell to a lower level) get the wrong answer. | `scripting.ts:753`, `vm_bridge.ts:158` | `interpreter_extra.cc:2285 opGetObjectElevation()` | major | bug |
| EL2 | **`doEnterElevation()` fires `map_enter_p_proc` on stair/ladder elevation change.** CE `mapSetElevation` fires only `map_update_p_proc`. DH2 calls `doEnterElevation()` which runs `map_enter_p_proc` on every stair/ladder use, causing map-entry side-effects (light resets, NPC repositions, first-visit flags) to run on every floor change. | `map.ts:193-205`, `object.ts:775,792,799` | `map.cc:362 mapSetElevation()` | major | bug |
| EL3 | **No elevator opcode handler.** CE `scriptsHandleRequests` has a dedicated elevator branch that closes old elevator doors, handles same-map vs. cross-map splits, and calls `mapSetElevation`. DH2 routes elevator-type objects through the generic stair/ladder path, skipping door animations and the same-map-different-elevation optimisation. | `object.ts:765` | `scripts.cc:926 scriptsHandleRequests SCRIPT_REQUEST_ELEVATOR` | minor | missing |
| EL4 | **`_map_data_elev_flags` bitmask not represented in DH2 map format.** CE saves per-elevation empty/non-empty state in `MapHeader.flags`. DH2's JSON pipeline omits this; all elevations present in the `levels` array are always loaded. Maps that CE would skip (empty elevations) are treated identically to populated ones. | `map.ts:435` | `map.cc:81 _map_data_elev_flags` | low | missing |
| EL5 | **`getObjectsAndSpatials()` passes no elevation to `getSpatials()`, so `map_update_p_proc` is fired only on current-elevation objects and spatials.** CE `scriptsExecMapUpdateScripts` runs `map_update_p_proc` on all loaded scripts regardless of elevation. Critters on other elevations do not tick their scripts when the player is away. | `map.ts:93`, `scripting.ts:2118` | `scripts.cc:2601 scriptsExecMapUpdateScripts()` | minor | bug |

<!-- audited: 2026-06-02 -->
