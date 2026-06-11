# Spatial Triggers — DarkHarold2 Reference

> Ground-truth: `raw/fallout2-ce/src/scripts.cc` (`scriptsExecSpatialProc`, `_scr_explode_scenery`), `scripts.h` (`SCRIPT_TYPE_SPATIAL`, `SCRIPT_PROC_SPATIAL`)  
> DH2 impl: `fomap.py` (extraction), `src/map/GameMap.ts` (`GameMap.spatials`, deserialization), `src/object/Obj.ts` (`hitSpatialTrigger`, `Obj.explode`), `src/object/Critter.ts` (`Critter.move`), `src/scripting.ts` (`Scripting.spatial`, `isSpatial`)

---

## 1. What a Spatial Is

A **spatial script** is an invisible trigger zone attached to a map tile rather than to an
object. When any critter moves into its radius, the script's `spatial_p_proc` fires with the
moving critter as `source_obj`. Spatials have no visual representation, no inventory, and no
proto — they exist only as script entries.

CE stores spatials in a dedicated script list (`gScriptLists[SCRIPT_TYPE_SPATIAL]`), separate
from item, critter, and map scripts. The spatial list is per-map and is loaded / unloaded with
the map.

Common uses in FO2 scripts: invisible area boundaries, floor traps, zone-change triggers,
quest flag updates when the player enters a region.

---

## 2. CE Data Model (`scripts.h`, `scripts.cc`)

### 2.1 Script Type & Proc

```c
// scripts.h:42
SCRIPT_TYPE_SPATIAL   // type index 1 in the 5-element gScriptLists[]

// scripts.h:52
SCRIPT_PROC_SPATIAL = 2   // procedure index within the script program
```

Each spatial script in CE is a `Script` struct with a union field:

```c
struct {
    int built_tile;   // packed: tile number + elevation
    int radius;       // trigger radius in hex tiles (0 = exact tile match only)
} sp;
```

### 2.2 `built_tile` Encoding

`built_tile` is a packed integer created by `builtTileCreate(tile, elevation)`. The tile
number occupies the low bits; elevation is encoded in the high bits. Inverse functions:

| Function | Purpose |
|----------|---------|
| `builtTileCreate(tile, elev)` | Pack tile + elevation into one int |
| `builtTileGetTile(built_tile)` | Extract tile number |
| `builtTileGetElevation(built_tile)` | Extract elevation index |

`fomap.py` decodes this from the map binary:
```python
tileNum    = tileNum & 0xffff            # low 16 bits = tile index
elevation  = ((tileNum >> 28) & 0xf) >> 1  # bits 28–31 → right-shifted by 1
```

### 2.3 Map File Binary Format

Spatial scripts are stored in the map's script block (type index 1 out of 5 types). Each
record contains:
```
pid         (4B) — packed: type bits identify this as s_spatial
unk1        (4B) — unknown
tileNum     (4B) — packed tile+elevation (types 1 and 2 only)
spatialRange(4B) — trigger radius in hex tiles (type 1 only)
unk2        (4B)
scriptID    (4B) — index into SCRIPTS.LST
unk3        (4B)
<11 × 4B>  — unknown fields
```

`fomap.py` discards any spatial with `spatialRange > 50` as invalid/garbage data
(`fomap.py:127`).

### 2.4 JSON Representation in DH2 Map Files

After `fomap.py` extraction, each spatial appears in `maps/*.json` under
`levels[n].spatials[]`:

```json
{
  "tileNum":   12345,
  "elevation": 0,
  "range":     3,
  "scriptID":  42,
  "script":    "NCPLCMAP"
}
```

`script` is the basename (no extension) of the SSL/INT script file.

---

## 3. CE Trigger Logic (`scriptsExecSpatialProc`, `scripts.cc:2516`)

CE fires spatials whenever any object moves to a new tile:

```c
bool scriptsExecSpatialProc(Object* object, int tile, int elevation)
{
    // 1. Pre-conditions: skip cursor objects, hidden/flat objects, tile < 10
    if (object == gGameMouseBouncingCursor) return false;
    if (object == gGameMouseHexCursor)      return false;
    if ((object->flags & OBJECT_HIDDEN) != 0 || (object->flags & OBJECT_FLAT) != 0) return false;
    if (tile < 10)                          return false;

    // 2. Re-entracy guard: disable while processing
    if (!_scr_SpatialsEnabled) return false;
    _scr_SpatialsEnabled = false;

    int builtTile = builtTileCreate(tile, elevation);

    // 3. Iterate every spatial script for this elevation
    for (Script* script = scriptGetFirstSpatialScript(elevation); ...) {
        if (builtTile == script->sp.built_tile) {
            // exact match — always triggers regardless of radius
            scriptSetObjects(script->sid, object, nullptr);
        } else {
            if (script->sp.radius == 0) continue;  // radius=0 → exact-match only
            int dist = tileDistanceBetween(builtTileGetTile(script->sp.built_tile), tile);
            if (dist > script->sp.radius) continue;
            scriptSetObjects(script->sid, object, nullptr);
        }
        scriptExecProc(script->sid, SCRIPT_PROC_SPATIAL);
    }

    // 4. Re-enable after all scripts have run
    _scr_SpatialsEnabled = true;
    return true;
}
```

Key behaviours:
- `scriptSetObjects(sid, object, nullptr)` → `source_obj = object`, `target_obj = nullptr`
- Every matching spatial fires before re-enabling; nested trigger calls are dropped
- Exactly one elevation's spatial list is scanned per call

---

## 4. CE Explosion Trigger (`_scr_explode_scenery`, `scripts.cc:2879`)

CE also fires spatials when an explosion occurs. `_scr_explode_scenery(a1, tile, radius, elevation)`:

1. Iterates all spatials for the given elevation
2. For each: fires `SCRIPT_PROC_SPATIAL` if `tileDistanceBetween(spatial_tile, tile) <= radius`
3. Additionally fires `SCRIPT_PROC_DAMAGE` on item scripts within blast radius (separate loop)

Note: `_scr_SpatialsEnabled` is set to false for the entire `_scr_explode_scenery` call,
preventing the explosion-triggered `spatial_p_proc` from re-triggering more spatials.

---

## 5. DH2 Implementation

### 5.1 Loading (`map.ts:456`)

```typescript
if (Config.engine.doSpatials) {
    this.spatials = map.levels.map((level: any) => level.spatials)

    this.spatials.forEach((level: any) =>
        level.forEach((spatial: Spatial) => {
            const script = Scripting.loadScript(spatial.script)
            if (!script) {
                dbgWarn('map', 'load script failed for spatial ' + spatial.script)
            } else {
                spatial._script = script
                // no init call — spatials only need spatial_p_proc
            }
            spatial.isSpatial = true
            spatial.position = fromTileNum(spatial.tileNum)
        })
    )
}
```

Each spatial object at runtime is a plain dict:
```typescript
{
    script:    string      // script name, e.g. 'NCPLCMAP'
    tileNum:   number      // tile index (encoded as y×200+x in DH2 grid)
    radius:    number      // trigger radius in hex tiles
    isSpatial: true        // sentinel used by isSpatial() in scripting.ts
    position:  Point       // {x, y} decoded from tileNum via fromTileNum()
    _script:   Script      // loaded Script instance with spatial_p_proc
}
```

`spatial.range` from the JSON is stored as `spatial.radius`; the field name differs
between the JSON key (`"range"`) and the runtime object key (`radius`). Note:
`hitSpatialTrigger` reads `spatial.range` directly (`object.ts:1941`) — there is a
**field-name inconsistency**: the loaded JSON sets `spatial.range` (from fomap output)
but the runtime object expects `.radius`. DH2 works because `getSpatials()` returns the
raw JSON dict, so both `.range` and `.radius` may exist on it.

### 5.2 Movement Trigger (`Critter.move`, `object.ts:1509`)

```typescript
move(position: Point, ...): boolean {
    if (!super.move(position, ...)) return false

    if (Config.engine.doSpatials !== false) {
        const hitSpatials = hitSpatialTrigger(position)
        for (const spatial of hitSpatials) {
            dbg('object', `triggered spatial ${spatial.script} (range=${spatial.range})`)
            Scripting.spatial(spatial, this)
        }
    }
    return true
}
```

`hitSpatialTrigger(position)` (`object.ts:1939`):
```typescript
function hitSpatialTrigger(position: Point): any {
    return globalState.gMap.getSpatials()
        .filter(s => hexDistance(position, s.position) <= s.range)
}
```

### 5.3 Explosion Trigger (`Obj.explode`, `object.ts:855`)

DH2 fires spatials from explosion in two passes:

**Pass 1 — Dedicated spatial list:**
```typescript
for (const spatialObj of hitSpatialTrigger(this.position)) {
    if (!spatialObj._script?.spatial_p_proc) continue
    Scripting.spatial(spatialObj, this)
}
```

**Pass 2 — Map objects with `spatial_p_proc`:**
```typescript
const SPATIAL_RADIUS_DEFAULT = 3
const scripted = globalState.gMap.getObjects()  // map objects only
const spatialCapable = scripted.filter(o => o._script?.spatial_p_proc)
for (const obj of spatialCapable) {
    const dist = hexDistance(this.position, obj.position)
    if (dist > SPATIAL_RADIUS_DEFAULT) continue
    Scripting.spatial(obj, this)
}
```

Pass 2 is a DH2-specific hack to catch objects that carry a `spatial_p_proc` but are not
in the dedicated spatial list (e.g., scripted scenery objects). CE handles this via the
separate item-script pass in `_scr_explode_scenery`.

### 5.4 Script Execution (`Scripting.spatial`, `scripting.ts:2007`)

```typescript
export function spatial(spatialObj: Obj, source: Obj) {
    const script = spatialObj._script
    script.game_time    = globalState.gameTickTime
    script.cur_map_index = currentMapID
    script.source_obj   = source
    script.self_obj     = spatialObj as ScriptableObj
    script.spatial_p_proc()
}
```

`self_obj` is set to the spatial dict itself. In CE, `self_obj` is a temporary invisible
`OBJ_TYPE_INTERFACE` object created on the heap and positioned at the spatial's tile.

### 5.5 Save / Load Persistence (`map.ts:625`, `map.ts:647`)

**Save:**
```typescript
spatials: this.spatials.map(level =>
    level.map((s: Spatial): SerializedSpatial => ({
        script: s.script,
        tileNum: s.tileNum,
        radius: s.radius,
        lvars: s._script ? Object.assign({}, s._script.lvars) : undefined,
    }))
)
```

**Load (`map.ts:647`):**
```typescript
// Re-load script from name; reapply saved LVARs
const scr = Scripting.loadScript(s.script)
if (scr && s.lvars) scr.lvars = s.lvars
```

CE's `scriptWrite/scriptRead` serializes `sp.built_tile` and `sp.radius`; DH2 serializes
`script` name + `tileNum` + `radius` — functionally equivalent.

---

## 6. Script Variable Context in `spatial_p_proc`

CE sets the following script vars before calling `SCRIPT_PROC_SPATIAL`:

| Var | CE source | DH2 |
|-----|-----------|-----|
| `self_obj` | Temporary invisible interface object at spatial tile | Spatial dict (plain object, not a real Obj) |
| `source_obj` | The critter (or object) that entered the radius | `source` parameter — the moving `Critter` |
| `target_obj` | `nullptr` | Not set (undefined) |
| `game_time` | `gameGetGlobalTime()` | `globalState.gameTickTime` |
| `cur_map_index` | Current map ID | `currentMapID` |
| `action_being_used` | Not set for spatial | Not set |

`self_obj` in DH2 is the spatial dict, not an `Obj` instance. Scripting opcodes that read
`self_obj` (e.g., `tile_num(self_obj)`, `elevation(self_obj)`) have special cases in
`scripting.ts` for `isSpatial(obj)`:

```typescript
// scripting.ts:754
elevation(obj): number {
    if (isSpatial(obj) || isGameObject(obj)) return globalState.currentElevation
    ...
}
// scripting.ts:1321 (tile_num)
if (!isSpatial(a) && !isSpatial(b) && ...)
```

Any opcode that doesn't have an `isSpatial` branch will receive the spatial dict as an `Obj`
and likely produce wrong results or throw.

---

## 7. Config Flag

`Config.engine.doSpatials` (boolean, default `true`). When `false`:
- Map loading skips all spatial script initialization (`map.ts:456`)
- `Critter.move` does not call `hitSpatialTrigger`
- Explosion pass 1 is still gated by the flag; pass 2 is not

---

## 8. Known Gaps vs CE

| # | Feature | CE Behavior | DH2 Status | Impact |
|---|---------|-------------|------------|--------|
| 1 | `_scr_SpatialsEnabled` re-entracy guard | Set to false during proc, preventing nested triggers | MISSING — no guard | A `spatial_p_proc` that moves an object could trigger another spatial recursively; CE silently drops the inner call |
| 2 | Cursor / hidden / flat object filter | Cursor objects and `OBJECT_HIDDEN`/`OBJECT_FLAT` objects cannot trigger spatials | MISSING — all `Critter.move` calls reach `hitSpatialTrigger` regardless of flags | Invisible / flat critters can trigger spatials; cursor never moves as an `Obj` in DH2 so partially moot |
| 3 | `tile < 10` guard | Tiles 0–9 are invalid / reserved; never trigger spatials | MISSING | Very-low tile indices do not trigger in CE; DH2 may trigger |
| 4 | `radius = 0` exact-match semantics | CE skips distance check entirely and only fires when the critter lands **exactly** on the spatial's tile | PARTIAL — DH2 `hexDistance(...) <= 0` is true only for exact match, so functionally equivalent; but the `range` field may have a default value issue (see §5.1 field-name note) | Correct in most cases |
| 5 | `self_obj` type | CE creates a temporary invisible `OBJ_TYPE_INTERFACE` object at the spatial tile | DH2 uses the spatial dict itself | Opcodes that call CE's real object methods on `self_obj` may misbehave; partially patched by `isSpatial` guards in scripting.ts |
| 6 | `target_obj` | CE explicitly sets `target_obj = nullptr` before proc | NOT SET in DH2 | Spatials that call `obj_type(target_obj)` or similar get undefined behaviour |
| 7 | Explosion spatial trigger radius | `_scr_explode_scenery` passes the blast radius to the spatial scan | DH2 pass 2 hardcodes `SPATIAL_RADIUS_DEFAULT = 3` for map-object spatials | Explosions may under-trigger or over-trigger scripted objects depending on blast radius vs 3 |
| 8 | `spatial.range` vs `spatial.radius` field name | n/a | Runtime object populated from JSON `"range"` key; `hitSpatialTrigger` reads `.range`; save code writes `.radius` — the two names coexist on the same dict | Save/load round-trip may lose range on spatials if `.radius` is written and `.range` is not read back |
| 9 | `objectEnterMap` on spatials | CE does not call `map_enter_p_proc` on spatials (they have no such proc) | DH2 calls `Scripting.objectEnterMap(spatial, ...)` (`map.ts:319`); spatial scripts don't export `map_enter_p_proc` so it silently does nothing | Harmless no-op; slightly wasteful |
| 10 | Elevation filtering for movement | CE `scriptsExecSpatialProc` is called with the current tile's elevation and only iterates spatials on that elevation | DH2 `getSpatials()` returns the current elevation's list (via `gMap.currentElevation`) — correct only if the elevation never changes mid-move | Elevation changes mid-move (e.g., stairways) could briefly scan the wrong elevation list |
