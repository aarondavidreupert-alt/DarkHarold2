# Edit History — Phase 1: Script Hook Connectivity

**Branch:** `claude/fix-script-hooks-8LwjT`  
**Date:** 2026-05-20

---

## Goal

Wire the script procedure hooks that the engine was failing to fire, so that quest scripts, NPC scripts, and item scripts actually execute when game events occur. Without these hooks, no script-driven state changes, spawns, dialogue advances, or reactions to damage would work.

---

## Changes Made

### 1. `damage_p_proc` now fires when a critter takes damage

**File:** `src/critter.ts` — `critterDamage()` (line ~566)

**Before:**
```typescript
if (useScript) {
    // TODO: Call damage_p_proc
}
```

**After:**
```typescript
if (useScript && obj._script) {
    Scripting.damage(obj, obj, source, damage)
}
```

**Why:** `Scripting.damage()` already existed in `src/scripting.ts` and correctly sets `self_obj`, `target_obj`, `source_obj`, and calls `damage_p_proc`. It was simply never called. This hook fires for all damage — in combat and out (e.g. environmental, fire, explosion splash). In-combat damage also separately fires `combat_p_proc(damage)` from `src/combat.ts`; both are correct per Fallout 2 CE `critters.cc`.

---

### 2. `drop_p_proc` implemented end-to-end

**File:** `src/scripting.ts` — Script class + new `Scripting.drop()` export

Added `drop_p_proc` and `use_obj_on_me_p_proc` to the Script class procedure type declarations:
```typescript
drop_p_proc!: () => void
use_obj_on_me_p_proc!: () => void
```

Added two new export functions after `Scripting.pickup()`:

```typescript
export function drop(obj: Obj, source: Obj): boolean {
    if (!obj._script || obj._script.drop_p_proc === undefined) return false
    obj._script.self_obj = obj as ScriptableObj
    obj._script.source_obj = source
    obj._script.cur_map_index = currentMapID
    obj._script._didOverride = false
    obj._script.drop_p_proc()
    return obj._script._didOverride
}

export function useObjOnMe(obj: Obj, item: Obj, source: Obj): boolean {
    if (!obj._script || obj._script.use_obj_on_me_p_proc === undefined) return false
    obj._script.self_obj = obj as ScriptableObj
    obj._script.source_obj = source
    obj._script.cur_map_index = currentMapID
    obj._script._didOverride = false
    obj._script.use_obj_on_me_p_proc()
    return obj._script._didOverride
}
```

**File:** `src/object.ts` — `Obj.drop()`

Added the hook call before the physical drop logic:
```typescript
if (this._script) {
    Scripting.drop(this, source)
}
```

**Why:** `drop_p_proc` was completely absent — no type declaration, no `Scripting` export, no call site. `use_obj_on_me_p_proc` was similarly absent. Both follow the same pattern as `pickup_p_proc`. `drop_p_proc` does not `_didOverride`-block the drop (Fallout 2 uses it for notification, not cancellation).

---

### 3. `map_enter_p_proc` fires on elevation change (stairs / ladders)

**File:** `src/map.ts` — new `GameMap.doEnterElevation()` method

```typescript
doEnterElevation(): void {
    if (!Config.engine.doLoadScripts) return
    const elev = this.currentElevation
    const mapID = this.mapID

    if (this.mapScript && this.mapScript.map_enter_p_proc !== undefined) {
        this.mapScript.self_obj = { _script: this.mapScript }
        this.mapScript.map_enter_p_proc()
    }

    for (const obj of this.getObjectsAndSpatials()) {
        Scripting.objectEnterMap(obj, elev, mapID)
    }
}
```

**File:** `src/object.ts` — stairs and ladder paths in `Obj.use()`

Added `globalState.gMap.doEnterElevation()` calls:
- After `changeElevation(destElev)` in the same-map stairs path
- Inside the climb-animation callback for ladders (before `updateMap()`)
- After `changeElevation(level)` in the no-animation ladder path

**Why:** Previously, `map_enter_p_proc` only fired on a full map load (`doEnterNewMap`). Using stairs or a ladder only called `changeElevation()` + `updateMap()` (which fires `map_update_p_proc`). Per Fallout 2 CE `scripts.cc`, `map_enter_p_proc` must also fire on elevation change. Without it, floor-change scripts (e.g. NCR vault level transitions, Sierra Army Depot elevator logic) never run.

---

### 4. `tsconfig.json` — `rootDir` added

Added `"rootDir": "src"` to prevent the TS5011 common-source-directory error introduced when `edit_history.md` was added to the repo root.

---

## What Was NOT Changed (and Why)

| Hook | Status | Reason |
|------|--------|--------|
| `use_obj_on_me_p_proc` call site | Added type + Scripting fn only | No UI path for dragging inventory items onto world objects exists yet; adding a dead call site would be misleading |
| `destroy_p_proc` | Already wired | `Scripting.destroy()` is called from `critterKill()` in `critter.ts:461` |
| `combat_p_proc` | Already wired | Called from `src/combat.ts` at lines 777, 862, 905, 1097 |
| `map_enter_p_proc` on full load | Already wired | `doEnterNewMap()` → `Scripting.enterMap()` → `objectEnterMap()` for all objects |
| `critter_p_proc` | Already wired | Fired per-tick from `src/main.ts:1069` via `Scripting.updateCritter()` |
| `map_update_p_proc` | Already wired | Fired every 600 ticks from `src/main.ts` via `GameMap.updateMap()` |
| `spatial_p_proc` | Already wired | Fired from `src/object.ts` explosion and walk-over paths |
| `timed_event_p_proc` | Already wired | Fired from `src/scripting.ts` timer callback |
