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
| `destroy_p_proc` (critter) | Already wired | `Scripting.destroy()` is called from `critterKill()` in `critter.ts:461` |
| `combat_p_proc` | Already wired | Called from `src/combat.ts` at lines 777, 862, 905, 1097 |
| `map_enter_p_proc` on full load | Already wired | `doEnterNewMap()` → `Scripting.enterMap()` → `objectEnterMap()` for all objects |
| `critter_p_proc` | Already wired | Fired per-tick from `src/main.ts:1069` via `Scripting.updateCritter()` |
| `map_update_p_proc` | Already wired | Fired every 600 ticks from `src/main.ts` via `GameMap.updateMap()` |
| `spatial_p_proc` | Already wired | Fired from `src/object.ts` explosion and walk-over paths |
| `timed_event_p_proc` | Already wired | Fired from `src/scripting.ts` timer callback |

---

## Follow-up Changes (1a–1d extended)

### 1a-ext. `destroy_p_proc` in `destroyObject` (non-critter objects)

**File:** `src/map.ts` — `GameMap.destroyObject()`

**Before:**
```typescript
destroyObject(obj: Obj): void {
    this.removeObject(obj)
    // TODO: notify scripts with destroy_p_proc
}
```

**After:**
```typescript
destroyObject(obj: Obj): void {
    Scripting.destroy(obj)
    this.removeObject(obj)
}
```

**Why:** `critterKill()` already fires `destroy_p_proc` for critters. `destroyObject` handles all other destroyed world objects — explosions, scenery, items removed from the world. The `Scripting.destroy()` export already existed (wired to `destroy_p_proc`) but was never called from this path.

---

### 1b. `reg_anim_func` animation queue

**Files:** `src/scripting.ts`, `src/vm_bridge.ts`

The entire `reg_anim_begin / reg_anim_func / reg_anim_animate / reg_anim_end` animation batch system was either absent (begin/end) or stub-only (reg_anim_func). Most scripted object interactions — NPC reaction animations, door-open sequences, item use effects — pass through this system.

**vm_bridge.ts — added missing opcodes:**
- `0x8111: reg_anim_begin` — was completely missing; scripts hitting this got a silent "unimplemented opcode" warning
- `0x8112: reg_anim_end` — same
- `0x8113: reg_anim_clear` — same
- `0x8110: reg_anim_obj_move_to_tile` — the method existed in `scripting.ts` but had no opcode wire

**vm_bridge.ts — custom handler for `0x810E: reg_anim_func`:**

Previously used `bridged("reg_anim_func", 2)` which passed the raw procedure address integer to the Script method. Following the same pattern as `giq_option`, replaced with a custom handler that wraps the address into a callable:
```typescript
,0x810E: function() {
    const procAddr = this.pop()
    const obj = this.pop()
    const procEntry = this.intfile.proceduresTable[procAddr]
    const fn = procEntry ? () => { this.call(procEntry.name) } : null
    this.scriptObj.reg_anim_func(obj, fn)
}
```

**scripting.ts — animation batch state and methods:**

Added module-level batch state:
```typescript
interface AnimStep { kind: 'animate'; obj: Obj; anim: number; delay: number }
interface AnimFunc  { kind: 'func';    fn: (() => void) | null }
type AnimEntry = AnimStep | AnimFunc
let animBatch: AnimEntry[] | null = null
```

Replaced stub `reg_anim_func` and no-op `reg_anim_animate`; added `reg_anim_begin`, `reg_anim_end`, `reg_anim_clear`:
- `reg_anim_begin(flags)` — creates new batch
- `reg_anim_func(obj, fn)` — pushes `AnimFunc` entry into batch
- `reg_anim_animate(obj, anim, delay)` — if in a batch, queues an `AnimStep`; outside a batch, plays immediately (legacy path)
- `reg_anim_end()` — drains batch: chains animations sequentially through completion callbacks, fires all `reg_anim_func` callbacks after all steps complete. `anim=0` (ANIM_STAND) calls `clearAnim()` instead of playing a cycle. Non-zero `delay` maps to `setTimeout(play, delay * 100)` (1 tick = 100ms at 10 ticks/sec).

**Ref:** `fallout2-ce animation.cc` — `animationRegAnimFunc()`, `animationRegAnimAnimate()`, `animationBegin()`, `animationEnd()`

---

### 1c. `get_month` and `get_day` wired to game clock

**File:** `src/vm_bridge.ts` — opcodes `0x8118` and `0x8119`

Added `import * as GameTime from "./gametime.js"` to vm_bridge.ts.

**Before:**
```typescript
,0x8118: function() { this.push(1) } // get_month // TODO
,0x8119: function() { this.push(0) } // get_day // TODO
```

**After:**
```typescript
,0x8118: function() { this.push(GameTime.getDate().month + 1) } // get_month (1-indexed)
,0x8119: function() { this.push(GameTime.getDate().day) } // get_day (day of month)
```

`GameTime.getDate()` walks forward from the FO2 start date (July 25, 2241) using per-month day counts. `month` is 0-indexed internally; scripts expect 1-indexed (Jan=1). `day` is already 1-indexed (1–31).

**Ref:** `fallout2-ce scripts.cc` opcode handlers for `OPCODE_GET_MONTH`, `OPCODE_GET_DAY`

---

### 1d. Object removal queue (deferred splice)

**File:** `src/map.ts` — `GameMap.removeObject()` and new `GameMap.drainRemovalQueue()`  
**File:** `src/main.ts` — drain call at end of heartbeat

**Before:** `removeObject()` called `splice()` immediately, causing index drift when scripts removed objects during the main object-iteration loop.

**After:**
- `removeObject(obj)` pushes `obj` to `this._removalQueue`
- `drainRemovalQueue()` — called once per heartbeat tick after all per-frame updates — scans all levels and splices the queued objects

```typescript
// main.ts, end of heart.update
globalState.gMap?.drainRemovalQueue()
```

**Why:** Scripts commonly remove objects from the map (destroying spawned creatures, removing used quest items, spawning explosions that self-remove). If `splice()` fires mid-iteration of `gMap.getObjects()`, subsequent objects shift indices and get skipped or double-processed. Deferring to the tick boundary eliminates that class of bug without requiring a snapshot copy of the object list.
