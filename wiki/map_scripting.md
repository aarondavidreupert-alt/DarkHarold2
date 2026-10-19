# DarkHarold2 — Map Scripting System Reference

**Audited:** 2026-05-31  
**Branch:** claude/codebase-map-docs-xW0xV  
**CE ref:** `raw/fallout2-ce/src/scripts.h`, `scripts.cc`, `map.cc`, `interpreter_extra.cc`  
**DH2 ref:** `src/scripting.ts`, `src/vm_bridge.ts`, `src/map/GameMap.ts`, `src/map/mapLoader.ts`, `src/object/Obj.ts`, `src/object/Critter.ts`

Do not duplicate content from `wiki/dialogue_system.md` or `wiki/items.md`.

---

## 1. Script Types (`ScriptType`)

CE `scripts.h:40–46` defines five script types. DH2 does not expose an explicit enum; types are inferred from how scripts are attached to objects and spatials.

| Value | CE Name | CE Constant | DH2 equivalent |
|-------|---------|-------------|----------------|
| 0 | System | `SCRIPT_TYPE_SYSTEM` | Map script (`GameMap.mapScript`) |
| 1 | Spatial | `SCRIPT_TYPE_SPATIAL` | `spatial._script` on `GameMap.spatials[elev][]` |
| 2 | Timed | `SCRIPT_TYPE_TIMED` | `timeEventList` entries via `add_timer_event` |
| 3 | Item | `SCRIPT_TYPE_ITEM` | `obj._script` where `obj.type === 'item'` |
| 4 | Critter | `SCRIPT_TYPE_CRITTER` | `obj._script` where `obj.type === 'critter'` |

---

## 2. Script Procedures (`ScriptProc`)

CE `scripts.h:49–78` defines 28 procedure entry points (0–27). The FO2 `.int` bytecode stores procedures by name; the engine calls them by numeric ID. DH2 calls matching method names on the `Script` instance.

| ID | CE Name | CE Constant | Called when |
|----|---------|-------------|-------------|
| 0 | `no_p_proc` | `SCRIPT_PROC_NO_PROC` | Never called directly |
| 1 | `start` | `SCRIPT_PROC_START` | Script first loaded |
| 2 | `spatial_p_proc` | `SCRIPT_PROC_SPATIAL` | Critter enters spatial radius |
| 3 | `description_p_proc` | `SCRIPT_PROC_DESCRIPTION` | Object examined (look at) |
| 4 | `pickup_p_proc` | `SCRIPT_PROC_PICKUP` | Item picked up |
| 5 | `drop_p_proc` | `SCRIPT_PROC_DROP` | Item dropped |
| 6 | `use_p_proc` | `SCRIPT_PROC_USE` | Object used |
| 7 | `use_obj_on_p_proc` | `SCRIPT_PROC_USE_OBJ_ON` | Object used on another object |
| 8 | `use_skill_on_p_proc` | `SCRIPT_PROC_USE_SKILL_ON` | Skill used on object |
| 11 | `talk_p_proc` | `SCRIPT_PROC_TALK` | NPC talked to |
| 12 | `critter_p_proc` | `SCRIPT_PROC_CRITTER` | Per-critter heartbeat update |
| 13 | `combat_p_proc` | `SCRIPT_PROC_COMBAT` | Critter's combat turn |
| 14 | `damage_p_proc` | `SCRIPT_PROC_DAMAGE` | Critter takes damage |
| 15 | `map_enter_p_proc` | `SCRIPT_PROC_MAP_ENTER` | Map loaded / elevation entered |
| 16 | `map_exit_p_proc` | `SCRIPT_PROC_MAP_EXIT` | Map exited |
| 17 | `create_p_proc` | `SCRIPT_PROC_CREATE` | Object created at runtime |
| 18 | `destroy_p_proc` | `SCRIPT_PROC_DESTROY` | Object destroyed |
| 21 | `look_at_p_proc` | `SCRIPT_PROC_LOOK_AT` | Object looked at |
| 22 | `timed_event_p_proc` | `SCRIPT_PROC_TIMED` | Timer fires (from `add_timer_event`) |
| 23 | `map_update_p_proc` | `SCRIPT_PROC_MAP_UPDATE` | Every map update tick (600 game ticks) |
| 24 | `push_p_proc` | `SCRIPT_PROC_PUSH` | Critter pushed by another |
| 25 | `is_dropping_p_proc` | `SCRIPT_PROC_IS_DROPPING` | Item being dropped check |
| 26 | `combat_is_starting_p_proc` | `SCRIPT_PROC_COMBAT_IS_STARTING` | Combat about to begin |
| 27 | `combat_is_over_p_proc` | `SCRIPT_PROC_COMBAT_IS_OVER` | Combat just ended |

IDs 9, 10, 19, 20 are undefined/reserved in CE.

---

## 3. Map Lifecycle

### 3.1 CE reference (`map.cc`, `scripts.cc`)

CE `mapLoad()` (map.cc:816) sequence:
1. Parse `.map` file, create objects
2. `_scr_spatials_disable()` — suspend spatial firing during init
3. `scriptExecProc(gMapSid, SCRIPT_PROC_MAP_ENTER)` (scripts.cc:2590)
4. `_scr_spatials_enable()` — re-enable spatial triggers

CE `_map_exit()` (map.cc:309): calls `scriptsExecMapUpdateScripts(SCRIPT_PROC_MAP_EXIT)` (scripts.cc:2673)

CE periodic update (scripts.cc:509): calls `scriptsExecMapUpdateScripts(SCRIPT_PROC_MAP_UPDATE)` per tick cycle.

### 3.2 DH2 implementation (`src/map/mapLoader.ts`, `src/scripting.ts`)

`GameMap.loadMap()` (map.ts) flow:
1. `Events.emit('loadMapPre')`
2. `Scripting.init(mapName, mapID)` — clears `timeEventList`, reloads GVARs and MVARs
3. Load map JSON, parse all elevations
4. `changeElevation(startElev, false, true)` — set up renderer, no script update
5. `Scripting.enterMap(mapScript, objectsAndSpatials, elevation, mapID, isFirstRun)` (scripting.ts:2164)
   - Clears `GameTime` light override
   - Calls `mapScript.map_enter_p_proc()` if present
   - Each object in `objectsAndSpatials` gets `objectEnterMap()` → `map_enter_p_proc()`
6. `Events.emit('loadMapPost')`

`GameMap.updateMap()` (map.ts): delegates to `Scripting.updateMap()`, which calls `map_update_p_proc` on the map script and every object with that proc.

Elevation changes inside a map run `map_update_p_proc` (`changeElevation` → `Scripting.updateMap`), as CE `mapSetElevation`; `map_enter_p_proc` runs only on map load (CE `mapLoad` → `scriptsExecMapEnterProc`).

---

## 4. Spatial Scripts

### 4.1 Data structure

`SerializedSpatial` (map.ts):
```typescript
interface SerializedSpatial {
    script: string    // .int script base name (e.g. "ECARMRDR")
    tileNum: number   // tile coordinate of the spatial anchor
    radius: number    // trigger radius in hex distance
    lvars?: { [lvar: number]: any }  // persisted LVARs
}
```

At runtime, `spatial.position` is set from `fromTileNum(spatial.tileNum)` (map.ts). Trigger distance uses `spatial.range` (set from `spatial.radius` in saved/loaded data).

`type Spatial = any` — no TypeScript interface defined (map.ts).

### 4.2 CE reference (`scripts.cc:2560`)

CE iterates `gScriptLists[SCRIPT_TYPE_SPATIAL]` and for each spatial whose tile distance is within its radius, calls `scriptExecProc(script->sid, SCRIPT_PROC_SPATIAL)`.

### 4.3 DH2 triggering (`src/object/Critter.ts`, `src/object/Obj.ts`)

Spatials fire inside `Critter.move()` (`src/object/Critter.ts`), called every hex step during movement animation:

```typescript
// object.ts–1515
if (Config.engine.doSpatials !== false) {
    const hitSpatials = hitSpatialTrigger(position)
    for (let i = 0; i < hitSpatials.length; i++) {
        Scripting.spatial(hitSpatials[i], this)
    }
}
```

`hitSpatialTrigger(position)` (object.ts):
```typescript
return globalState.gMap.getSpatials()
    .filter((spatial) => hexDistance(position, spatial.position) <= spatial.range)
```

`Scripting.spatial(spatialObj, source)` (scripting.ts:1991):
```typescript
script.self_obj = spatialObj as ScriptableObj
script.spatial_p_proc()
```

**Notes:**
- Only `Critter.move()` triggers spatials — as in CE, where only `_object_move` (an animated walk) calls `scriptsExecSpatialProc`; tile warps don't.
- As CE: no trigger for hidden critters or tiles below 10, and none while a `spatial_p_proc` is running (`_scr_SpatialsEnabled`); a spatial script without the proc does nothing.
- Explosions also scan nearby spatials (object.ts–902) using a default radius of 3 if the spatial has no explicit radius.
- `Config.engine.doSpatials` (default `true`) gates all spatial processing.

### 4.4 Script loading and LVARs

Spatial scripts are loaded at `loadMap()` time (map.ts–474):
```typescript
this.spatials.forEach((level) =>
    level.forEach((spatial) => {
        const script = Scripting.loadScript(spatial.script)
        spatial._script = script
        spatial.isSpatial = true
        spatial.position = fromTileNum(spatial.tileNum)
    })
)
```

Spatials only use `spatial_p_proc` — no other proc is called on them (map.ts comment).  
LVARs persist across saves (map.ts–634, CE `map.cc mapSave`).

---

## 5. Variable Scoping

Three variable scopes exist in FO2 scripting:

### 5.1 Global Variables (GVARs)

**CE ref:** `scripts.cc` — `gGameGlobalVars[]` array, persisted in save via `fileWriteInt32List`.

**DH2 ref:** `scripting.ts:51` — `var globalVars: any = {}`

Loaded once from `data/gvars.json` at `Scripting.init()`. Keyed by numeric index.

Opcodes:
- `global_var(gvar)` → `0x80C5` — read GVAR at index `gvar`
- `set_global_var(gvar, value)` → `0x80C6` — write GVAR at index `gvar`

Default: if index is unknown, `global_var` returns `0` with a warning.

GVARs are engine-wide and persist across map transitions. They represent game-state flags (e.g. quest completion, NPC death states).

### 5.2 Map Variables (MVARs)

**CE ref:** `scripts.cc` — `gMapLocalVars[]`, with per-script `localVarsOffset` and `localVarsCount`.

**DH2 ref:** `scripting.ts:50` — `var mapVars: any = null` keyed as `mapVars[scriptName][mvarIndex]`

Loaded from `data/maps/<mapname>.mvars.json` at `Scripting.reset()`. Keyed by map script name (lowercase), then by numeric MVAR index.

Opcodes:
- `map_var(mvar)` → `0x80C3` — read MVAR from the current map script
- `set_map_var(mvar, value)` → `0x80C4` — write MVAR

`map_var()` defaults to `0` if the key is not yet set. Both opcodes require `this._mapScript` to be set; they error/warn if called outside a map context.

MVARs are per-map and survive map reloads within a save. They are reset when `Scripting.reset()` is called (on each new map load, mapVars is cleared before re-loading from disk).

### 5.3 Local Variables (LVARs)

**CE ref:** per-script instance storage, persisted per-script in save.

**DH2 ref:** `scripting.ts:408–419` — `this.lvars[]` on each `Script` instance

Opcodes:
- `local_var(lvar)` → `0x80C1` — read LVAR at index `lvar`
- `set_local_var(lvar, value)` → `0x80C2` — write LVAR

Default: if index unknown, `local_var` initializes to `0` with a warning. LVARs for spatial scripts are persisted in `SerializedSpatial.lvars`.

### 5.4 Exported / External Variables (shared between scripts)

**CE:** The FO2 `.int` format supports `export variable` declarations and cross-script variable references via `op_export_var`, `op_store_external`, `op_fetch_external`.

**DH2 ref:** `vm_bridge.ts:63–65`

```typescript
,0x8016: function() { this.mapScript()[this.pop()] = 0 }  // op_export_var
,0x8015: function() { var name = varName(...); this.mapScript()[name] = this.pop() }  // op_store_external
,0x8014: function() { this.push(this.mapScript()[varName(...)]) }  // op_fetch_external
```

Exported vars are stored as properties on the **map script object** itself. This means only variables exported by the map script are accessible cross-script; object script exports are not stored in a shared namespace as in CE.

---

## 6. Timed Events

**CE ref:** `add_timer_event` / `rm_timer_event` — schedule `timed_event_p_proc` on an object.

**DH2 ref:** `scripting.ts:1722–1748`, `Scripting.timeEventList`

`TimedEvent` interface (scripting.ts:83):
```typescript
interface TimedEvent {
    obj: Obj | null
    ticks: number      // absolute game tick time to fire
    userdata: any      // passed to timed_event_p_proc as fixed_param
    fn: () => void     // callback, calls timedEvent(obj._script, userdata)
    leaveMap?: 'keep' | (() => boolean)  // CE gEventTypeDescriptions clear proc
}
```

Opcodes:
- `add_timer_event(obj, ticks, userdata)` → `0x80F0` — pushes a `TimedEvent` for `obj._script.timed_event_p_proc`
- `rm_timer_event(obj)` → `0x80F1` — CE `queueRemoveEvents(object)`: removes **every** queued event `obj` owns (any type), matched by object identity

**Leaving a map** (CE `map.cc _map_save_in_game` → `queue.cc _queue_leaving_map`): `Scripting.queueLeavingMap()` runs first in `GameMap.loadMap` (before `map_exit_p_proc`). Per CE event type:
- script timers (and every event without a clear proc): dropped;
- poison, radiation: kept;
- drug effect / withdrawal (`_item_d_clear` / `_item_wd_clear`): kept for party members; for anyone else the drug wears off (withdrawal ends) now;
- knockout (`_critter_wake_clear`): a living critter is up again (kept on dead ones);
- sneak (`_critter_sneak_clear`): sneaking ends;
- Stealth Boy / Geiger trickle (`_item_m_turn_off_from_queue`): the device turns off;
- armed explosives (`_queue_explode_exit`): they go off at once, unanimated, on the old map (at the carrier when carried).

A new game / load still empties the list (`Scripting.resetGameState`).

`metarule3(100, obj, userdata, ...)` (scripting.ts:530) — removes specific timed event by `obj` + `userdata` match (METARULE3_CLR_FIXED_TIMED_EVENTS).

(The save restore still finds an event's owner by `pid` on the current map — see §10.)

---

## 7. Map Control Opcodes

### 7.1 load_map

```typescript
load_map(map: number | string, startLocation: number)  // 0x80E4
```

Loads a new map. If `map` is a string (e.g. `"ARTEMPLE.MAP"`), strips extension and lowercases it before calling `GameMap.loadMap()`. If `map` is a number, calls `loadMapByID()`.

`startLocation` goes to `GVAR_LOAD_MAP_INDEX` (27), which the new map's `map_enter_p_proc` reads to place the player (`override_map_start`); a negative map index does nothing. CE defers the load to `mapHandleTransition`; DH2 loads at once.

CE ref: `interpreter_extra.cc opLoadMap`.

### 7.2 override_map_start

```typescript
override_map_start(x, y, elevation, rotation)  // 0x80A9
```

Stores `overrideStartPos = { position: {x,y}, orientation: rotation, elevation }` (scripting.ts:1273). After `map_enter_p_proc()` returns, `Scripting.enterMap()` checks `overrideStartPos` and returns it as the new player start position. The caller (`map.ts`) then applies it.

CE ref: `interpreter_extra.cc opOverrideMapStart`.

### 7.3 set_map_start

**Opcode:** `0x80A8` (`set_map_start(x, y, elev, rot)`)  
**CE ref:** `interpreter_extra.cc opSetMapStart` → `map.cc mapSetStart`

Implemented 2026-10-17 (known_bugs C38): sets the map's entering tile / elevation / rotation for later loads. (The slot used to be a second `game_time_hour`, which left four arguments on the stack.)

### 7.4 create_object_sid

```typescript
create_object_sid(pid, tile, elev, sid)  // 0x80B7
```

Creates a new object with PID `pid` at `tile` on elevation `elev`, attaching script SID `sid` if nonzero. As CE `opCreateObject`: tile −1 becomes 0; an invalid elevation warns and returns null. An object on another elevation is placed there at once — CE's scripts don't depend on the elevation either. Adds the object to `globalState.gMap` (scripting.ts:1173).

An object created for another elevation is placed there at once, as in CE.

### 7.5 destroy_object

```typescript
destroy_object(obj)  // 0x80F4
```

Removes `obj` from the world: `globalState.gMap.destroyObject(obj)` (scripting.ts:1301).

### 7.6 move_to

```typescript
move_to(obj, tileNum, elevation)  // 0x80B6
```

Teleports `obj` to `tileNum` on `elevation` (scripting.ts:1394). If elevation differs from current:
- Player: calls `GameMap.changeElevation(elevation, true)` (triggers elevation change UI/scripts)
- NPC: removes from current elevation objects list, adds to new elevation objects list

Then sets `obj.position = fromTileNum(tileNum)` and re-centers camera if player.

CE ref: `interpreter_extra.cc` op_move_to.

### 7.7 set_exit_grids

```typescript
set_exit_grids(onElev, mapID, elevation, tileNum, rotation)  // 0x80E6
```

CE ref: `interpreter_extra.cc opSetExitGrids` — every exit grid (PIDs `0x5000010`–`0x5000017`) on `onElev` gets the new destination map / tile / elevation (the rotation isn't stored, as in CE). DH2 walks `gMap.objects[onElev]`, so it works for elevations other than the displayed one.

### 7.8 script_overrides

```typescript
script_overrides()  // 0x80B9
```

Sets `this._didOverride = true` on the script instance (scripting.ts:558). Used by critter/item scripts to suppress default engine behavior for the current event (e.g. prevent default pickup action). DH2 checks `_didOverride` in some event handlers.

### 7.9 map_first_run (via metarule)

CE calls this `metarule(14, 0)`. DH2 implements as `metarule` case 14 (scripting.ts:474):

```typescript
case 14:
    return mapFirstRun  // map_first_run
```

`mapFirstRun` is set to `true` in `Scripting.enterMap()` (scripting.ts:2157) when `isFirstRun` is `true` (first time the map is loaded in this save), then set to `false` in `Scripting.updateMap()` (scripting.ts:2120).

### 7.10 mark_area_known

```typescript
mark_area_known(areaType, areaID, state)  // 0x80B2
```

`areaType`: 0 = `AREATYPE_KNOWN`, 1 = `AREATYPE_ENTRANCE_KNOWN` (distinction is not used — DH2 treats both identically).  
`state`: 1 = reveal, 0 = hide.

Updates `globalState.knownAreas` Set (scripting.ts:1778).

**Known gap (from worldmap.md):** Areas with `state=false` at `worldmap.init()` have no circle `<div>` element. `mark_area_known` with `state=1` adds to `knownAreas` but does NOT create the DOM element. Areas that start hidden cannot be visually revealed at runtime without a `revealAreaCircle()` helper or a full worldmap re-init.

### 7.11 wm_area_set_pos

```typescript
wm_area_set_pos(area, x, y)  // 0x80E5
```

Updates `globalState.mapAreas[area].worldPosition` (scripting.ts:1787).  
CE ref: `worldmap.cc wmAreaSetPos()`.

---

## 8. Environment / Utility Opcodes

### 8.1 elevation

```typescript
elevation(obj)  // 0x80EC
```

Returns the current elevation of `obj`. In DH2, always returns `globalState.currentElevation` (the map current elevation) — no per-object elevation tracking. CE tracks elevation per-object.

### 8.2 cur_map_index

Read-only field `0x8101` — pushes `this.scriptObj.cur_map_index` (the numeric map ID set in `Scripting.enterMap()`).

### 8.3 obj_on_screen

```typescript
obj_on_screen(obj)  // 0x8150
```

Returns 1 if `obj` is within the visible viewport, 0 otherwise (scripting.ts:1282, calls `objectOnScreen(obj)`).

### 8.4 game_time / game_time_hour

- `game_time` → `0x80EA` — returns `this.scriptObj.game_time` (absolute game tick count)
- `game_time_hour` → `0x80F6` — returns `Math.floor((gameTickTime / 600) % 24)` (0–23)
- Alternate `game_time_hour` → `0x80a8` — same formula (DH2 conflict with CE `set_map_start`)

### 8.5 game_time_advance

```typescript
game_time_advance(ticks)  // 0x80FC
```

Advances in-game time by `ticks` game ticks and processes the expired timed events and crossed midnights (CE `opGameTimeAdvance` → `queueProcessEvents`; `GameTime.advanceTicks` + `gameTick.ts`).

### 8.6 Tile opcodes (summary)

| Opcode | Method | Description |
|--------|--------|-------------|
| `0x80A7` | `tile_contains_pid_obj(tile, elev, pid)` | Returns first obj with matching PID at tile/elev |
| `0x80BB` | `tile_contains_obj_pid(tile, elev, pid)` | Returns 1 if any obj with PID at tile |
| `0x80D2` | `tile_distance(tileA, tileB)` | Hex distance between two tile numbers |
| `0x80D3` | `tile_distance_objs(a, b)` | Hex distance between two objects |
| `0x80D4` | `tile_num(obj)` | Tile number of object's position |
| `0x80D5` | `tile_num_in_direction(tile, dir, dist)` | Tile at given direction and distance |
| `0x814C` | `rotation_to_tile(src, dest)` | Rotation (0–5) from src toward dest |

---

## 9. Timer Event Flow

Sequence for a script-initiated timed event:

1. Script calls `add_timer_event(self_obj, 1200, 42)` — schedules `self_obj._script.timed_event_p_proc` to fire in 1200 ticks
2. Engine calls `GameMap.updateMap()` each heartbeat
3. `updateMap()` → `Scripting.updateMap()` — checks `timeEventList` for entries whose `ticks <= gameTickTime`
4. Matching entries have their `fn()` called → `timedEvent(script, userdata)` → `script.timed_event_p_proc()`
5. Inside `timed_event_p_proc`, script reads `fixed_param` to get `userdata` (42 in this example)

**Note:** `timeEventList` also holds drug-effect reversal callbacks (from `src/drugs.ts`) and delayed-damage callbacks (Super Stimpak). These use `userdata` strings like `'drug:Jet'` and are not dispatched to `timed_event_p_proc`.

---

## 10. Known Gaps

| Feature | CE behavior | DH2 status |
|---------|-------------|---------|
| `set_map_start` | `0x80A8` updates the map's start tile/elev/rot | **FIXED** (C38) |
| Map exit proc | `MAP_EXIT` fired on all scripts | **FIXED** (M9): `map_exit_p_proc` runs for the map script and every other script on the map |
| Elevation change | CE `mapSetElevation` runs `scriptsExecMapUpdateProc` (MAP_UPDATE) | Matches: `changeElevation()` calls `Scripting.updateMap()` |
| `set_exit_grids` | Updates exit grid destinations on an elevation | **FIXED** (C39): wired as `0x80E6`; walks the target elevation's objects by exit-grid PID |
| `teleport_to` / `get_obj_at_position` | Not vanilla opcodes | Not implemented (not needed) |
| MVARs | Per map script, survive transitions and save/load | Matches: `mapVars` keyed by script name, reset only on new game / load (M8) |
| Cross-elevation `create_object_sid` | Placed on that elevation; scripts run regardless | Matches |
| Timed events on map transition | `_queue_leaving_map` clears by event type (clear procs) | **FIXED** (C39): `Scripting.queueLeavingMap()` — see §6 |
| `rm_timer_event` identity | `queueRemoveEvents(object)` — all events of that object | **FIXED** (C39): by identity, all events |
| `load_map` start location | `GVAR_LOAD_MAP_INDEX` = param | **FIXED** (C39) |
| Save restore of event owners | Events keep their owner pointer | Approximation: restore looks the owner up by `pid` on the current map |
| Spatial `range` field | `radius` from `.map` binary | DH2 JSON spatials use `radius`; runtime reads `spatial.range` (same property, `any` type) |
<!-- audited: 2026-10-17 -->

---

## 11. How-to-Use

### Implementing a new map opcode

1. Add method to `Script` class in `src/scripting.ts`:
   ```typescript
   myOpcode(arg1: Type, arg2: Type): ReturnType {
       // implementation
   }
   ```
2. Wire in `src/vm_bridge.ts` inside `bridgeOpMap`:
   ```typescript
   ,0xXXXX: bridged("myOpcode", 2)  // 2 = argc, true = push return value
   ```
3. Look up the CE opcode in `raw/fallout2-ce/src/interpreter_extra.cc` for the correct hex value.

### Debugging spatial triggers

Set `Config.engine.showSpatials = true` (config.ts:21) — renders spatial anchor points on the map. Set `Config.engine.doSpatials = false` to disable all spatial processing.

Spatial trigger logging fires at `dbg('object', ...)` level — enable via `Config.scripting.debugLogShowType`.

### Reading map_first_run

```typescript
// In a map script's map_enter_p_proc:
if (metarule(14, 0)) {
    // first time this map has been entered in this save
}
```

DH2: `mapFirstRun` is `true` in `enterMap()` when `isFirstRun=true`, then set to `false` after the first `updateMap()` call.

---

## 12. Named Events System — NEVS (`nevs.cc`)

> **Source anchor:** `raw/fallout2-ce/src/nevs.cc` (`_nevs_addevent`, `_nevs_signal`, `_nevs_update`, `_nevs_clearevent`)

### 12.1 Overview

CE provides an internal engine subsystem for named asynchronous events called NEVS (Named EVent System). It allows C-side engine code to register named event slots, signal them asynchronously, and flush pending signals each tick by executing the registered script procedure. NEVS is not directly accessible from `.int` script opcodes — it is called exclusively from C engine code.

### 12.2 Data Structure

```c
// nevs.cc
#define NEVS_SIZE 40   // maximum concurrent named event slots

typedef struct Nevs {
    char     name[32];    // unique event name (null-terminated)
    Program* program;     // pointer to the owning script program
    int      proc;        // procedure index within that program
    int      type;        // NEVS_TYPE_EVENT (0) or NEVS_TYPE_HANDLER (1)
    int      hits;        // pending signal counter (incremented by _nevs_signal)
    int      busy;        // non-zero while the handler is executing (re-entrancy guard)
} Nevs;
```

### 12.3 Event Types

| Constant | Value | Behaviour |
|----------|-------|-----------|
| `NEVS_TYPE_EVENT` | 0 | One-shot: slot is reset (cleared) after the procedure fires once. |
| `NEVS_TYPE_HANDLER` | 1 | Persistent: slot remains registered after firing; can be signalled repeatedly. |

### 12.4 Core Functions

**`_nevs_addevent(name, program, proc, type)`**  
Registers a named event in the 40-slot array. If a slot with the same `name` already exists it is replaced. Returns `0` on success, `-1` if the array is full.

**`_nevs_signal(name)`**  
Increments the `hits` counter for the slot matching `name`. The signal is deferred — the procedure is not executed immediately.

**`_nevs_update()`**  
Called once per game tick by the CE engine. Iterates the 40 slots; for each slot where `hits > 0` and `busy == 0`, calls `_executeProc(program, proc)` and decrements `hits`. For `NEVS_TYPE_EVENT` slots, resets the slot to empty after the call. Re-entrancy is guarded by the `busy` flag.

**`_nevs_clearevent(name)`**  
Clears and resets the named slot without firing it.

### 12.5 DH2 Status

Not needed: NEVS is only reachable through the interpreter-library opcodes `0x8092`–`0x8095` (`opAddNamedEvent`, `opAddNamedHandler`, `opClearNamed`, `opSignalNamed`), and none of the 1288 scripts in scripts.lst uses them (opcode scan 2026-10-18 — every one of the 192 opcodes the game's scripts use has a DH2 handler). No engine code in CE calls NEVS either.

<!-- audited: 2026-10-18 -->
