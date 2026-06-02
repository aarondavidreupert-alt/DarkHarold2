# Item Use & Scenery Interaction

Cross-references: `wiki/map_scripting.md` (script proc list), `wiki/skill_checks.md` (lockpick/traps formula), `wiki/known_bugs.md` §IU.

---

## 1. Overview

"Using" an object in Fallout 2 triggers one of three script procedures depending on context:

| Action | Proc | CE enum value |
|--------|------|---------------|
| Use item/scenery alone | `use_p_proc` | `SCRIPT_PROC_USE = 6` |
| Use one item on another object | `use_obj_on_p_proc` | `SCRIPT_PROC_USE_OBJ_ON = 7` |
| Use a skill on an object | `use_skill_on_p_proc` | `SCRIPT_PROC_USE_SKILL_ON = 8` |

Procedures are always fired on the **target object's script**, not on the player script — with one exception in the `use_obj_on_p_proc` two-step dispatch (§6).

CE enum defined in `scripts.h` lines 50-78.

---

## 2. Script Context Wiring

Before firing any proc, CE calls `scriptSetObjects(sid, source, target)` (`scripts.cc:624`):

```c
// scripts.cc:624
int scriptSetObjects(int sid, Object* source, Object* target) {
    script->source = source;   // → script intrinsic: source_obj
    script->target = target;   // → script intrinsic: target_obj
    // script->owner (self_obj) is set separately to the script's owning object
}
```

For `use_p_proc` on a door (`proto_instance.cc:1720`):
- `source_obj` = the critter doing the using
- `self_obj` = the door/scenery object
- `target_obj` = same door/scenery object

For `use_skill_on_p_proc` (`proto_instance.cc:1872`), CE additionally calls `scriptSetActionBeingUsed(target->sid, skill)` (`scripts.cc:647`) which exposes the skill number via the `action_being_used` intrinsic.

---

## 3. `_obj_use()` — General Scenery Dispatch

`proto_instance.cc:1434`. Entry point for using scenery without a secondary item.

```
_obj_use(user, target):
  type = proto type of target
  if type == SCENERY:
    subtype = scenery subtype
    if subtype == DOOR      → _obj_use_door(user, target)
    if subtype == STAIRS    → _obj_use_stairs(user, target)
    if subtype == ELEVATOR  → _obj_use_elevator(user, target)
    if subtype == LADDER_UP/DOWN → _obj_use_ladder(user, target, ...)
    else → fire use_p_proc on target; if no script or returnValue==0:
             display "You see: %s" (name lookup from proto)
  if type == ITEM:
    subtype = item subtype
    misc items, radios → dedicated handlers, may fire use_p_proc
```

Non-door scenery with unrecognised subtype falls through to printing the object name — no engine default behaviour beyond that.

Items (misc, radios) fire `use_p_proc` on the item's own script when used standalone.

---

## 4. Door State Machine

### 4.1 State flags

Defined in `obj_types.h`:

| Flag | Hex | Meaning |
|------|-----|---------|
| `DOOR_FLAG_LOCKED` | `0x02000000` | door is locked |
| `DOOR_FLAG_JAMMGED` | `0x04000000` | door is jammed (typo in CE source preserved) |

Note: `CONTAINER_FLAG_LOCKED` and `CONTAINER_FLAG_JAMMED` share identical values; they are stored in the same `openFlags` field with different object types.

Open/closed state is tracked by animation frame: `object->frame == 0` → closed; `object->frame != 0` → open. Opening a door sets the `OBJECT_OPEN_DOOR` composite flag (`OBJECT_SHOOT_THRU | OBJECT_LIGHT_THRU | OBJECT_NO_BLOCK`) on the tile object.

### 4.2 `_obj_use_door` dispatch (`proto_instance.cc:1710`)

```
_obj_use_door(user, door):
  if objectIsLocked(door):
    play locked-door SFX
    display "That door is locked."
  fire use_p_proc on door (ALWAYS, even if locked)
  if returnValue != 0: return   ← script overrode default behaviour
  if objectIsJammed(door):
    display "That door appears to be jammed."
    return
  objectOpenClose(door)         ← toggle open/closed animation + flags
  play open/close SFX
```

Key point: the locked-door sound plays **before** the script proc fires. Scripts can still override the action by returning non-zero.

### 4.3 Jam/unjam lifecycle

- Jam is set by lockpick critical failure (`skill.cc`) via `objectJamLock()` (`proto_instance.cc:2131`).
- `objectUnjamAll()` (`proto_instance.cc:2171`) clears all jam bits on every object on the current map. Called:
  - At midnight every in-game day: `gameTimeEventProcess()` (`scripts.cc:418`)
  - On map load: `map.cc:1065`

---

## 5. Container Interaction (`_obj_use_container`)

`proto_instance.cc:1789`. Similar pattern to doors:

```
_obj_use_container(user, container):
  if objectIsLocked(container):
    play locked SFX
    display "That is locked."
  fire use_p_proc on container
  if returnValue != 0: return
  if objectIsJammed(container):
    display "That appears to be jammed."
    return
  objectOpenClose(container)
  if now open: show loot screen (gsound + interface_loot)
  if now closed: close loot screen
```

Loot UI is shown only **after** the open animation completes, not immediately on interaction.

---

## 6. `_protinst_use_item_on` — Use-Item-On Dispatch

`proto_instance.cc:1245`. Handles "use item X on object Y".

### 6.1 Two-step dispatch

```
_protinst_use_item_on(critter, item, target):
  if item has NO script:
    fire use_obj_on_p_proc on target
      scriptSetObjects(target->sid, critter, item)
      self_obj = target, source_obj = critter, target_obj = item
    return
  // item HAS a script:
  fire use_obj_on_p_proc on item
    scriptSetObjects(item->sid, critter, target)
    self_obj = item, source_obj = critter, target_obj = target
  if returnValue == 0:
    also fire use_obj_on_p_proc on target
      scriptSetObjects(target->sid, critter, item)
```

When the item has its own script, the item script runs first and can consume the action (`returnValue != 0`). If it doesn't consume it, the target also gets the proc.

### 6.2 `_obj_use_item_on` wrapper (`proto_instance.cc:1357`)

Outer wrapper that checks proto flags before calling `_protinst_use_item_on`. Handles charge-based items (medkits, stimpaks) and items with `PID_SUPER_STIMPAK`, `PID_DOCTOR_BAG` etc. before falling through to the script proc chain.

---

## 7. Skill-on-Object (`_obj_use_skill_on`)

`proto_instance.cc:1872`.

```
_obj_use_skill_on(critter, target, skill):
  if objectIsJammed(target) and skill == SKILL_LOCKPICK:
    display "That lock appears to be jammed."
    return SKILL_ON_JAMMED
  scriptSetObjects(target->sid, critter, target)
  scriptSetActionBeingUsed(target->sid, skill)
  fire use_skill_on_p_proc on target
  if returnValue != 0: return SKILL_ON_SCRIPT_HANDLED
  // engine default skill handling:
  switch skill:
    SKILL_LOCKPICK  → no engine default (break — script must handle it)
    SKILL_TRAPS     → check trap, display result message
    ...
```

Note: CE's engine default for `SKILL_LOCKPICK` is a bare `break` — scripts are expected to handle it entirely. DH2's `useLockpick()` in `skillUse.ts:383` does the roll independently.

The `action_being_used` value is readable from scripts via the `action_being_used()` intrinsic.

---

## 8. DH2 Implementation

### 8.1 `Obj.use()` (`src/object.ts:725`)

```typescript
use(source: Obj, isSecondary = false): boolean {
    if (this._script) {
        Scripting.use(this, source)  // → fires use_p_proc on this._script
    }
    // engine fallback: door, container, stairs, ladder
}
```

`Scripting.use()` (`scripting.ts:1959`) calls `obj._script.use_p_proc()` — fires on the **object's** script with `self_obj = obj`, `source_obj = source`. This matches CE.

### 8.2 Proc declarations (`src/scripting.ts:389`)

DH2 declares:

```typescript
use_p_proc() { ... }
use_obj_on_me_p_proc() { ... }  // ← wrong name
use_skill_on_me_p_proc() { ... }
```

CE uses `use_obj_on_p_proc` and `use_skill_on_p_proc`. Scripts compiled for CE will not match the DH2 names.

### 8.3 Lock/open opcodes (`src/scripting.ts`)

| Opcode | CE hex | DH2 implementation |
|--------|--------|--------------------|
| `obj_is_locked` | 0x812D | reads `obj.locked` |
| `obj_lock` | 0x812E | sets `obj.locked = true` |
| `obj_unlock` | 0x812F | sets `obj.locked = false` |
| `obj_is_open` | 0x8130 | reads `obj.open` |
| `obj_open` | 0x8131 | calls `setObjectOpen(obj, true)` |
| `obj_close` | 0x8132 | calls `setObjectOpen(obj, false)` |
| `jam_lock` | — | **not implemented** |
| `unjam_lock` | — | **not implemented** |

Wired in `vm_bridge.ts`.

### 8.4 `setObjectOpen()` (`src/object.ts:136`)

When `obj.locked === true`, returns `false` immediately with no sound or message. CE plays the locked SFX and "That door is locked." message before checking.

### 8.5 Container loot UI

`setObjectOpen()` calls `uiLoot(obj)` immediately upon opening. CE separates the loot screen from the animation: the screen opens only after `objectOpenClose()` completes.

### 8.6 `use_obj_on_obj` (`src/scripting.ts:1221`)

```typescript
use_obj_on_obj(item: Obj, obj: Obj): void {
    const who = this.obj
    obj.use(who, true)  // ← fires use_p_proc, NOT use_obj_on_p_proc
}
```

The `isSecondary = true` flag is passed to `Obj.use()` but has no effect on which script proc fires.

---

## 9. Known Gaps

| ID | Description | CE reference | DH2 location |
|----|-------------|--------------|--------------|
| IU1 | `use_obj_on_obj` fires `use_p_proc` instead of `use_obj_on_p_proc` — quest-item interactions (e.g. Wrench on car) use the wrong proc | `proto_instance.cc:1245` | `scripting.ts:1227` |
| IU2 | Proc name mismatch: DH2 declares `use_obj_on_me_p_proc` / `use_skill_on_me_p_proc`; CE scripts call `use_obj_on_p_proc` / `use_skill_on_p_proc` | `scripts.h:61-62` | `scripting.ts:390-391` |
| IU3 | No jammed state on `Obj`; `jam_lock` / `unjam_lock` opcodes not implemented; midnight unjam never fires (cross-ref §GTC5 in known_bugs.md) | `proto_instance.cc:2131,2171`; `scripts.cc:418` | `scripting.ts` (missing) |
| IU4 | No locked-door SFX or "That door is locked." message in DH2; `setObjectOpen()` returns false silently | `proto_instance.cc:1710-1722` | `object.ts:136` |
| IU5 | Container loot UI fires immediately in `setObjectOpen()`; CE shows loot screen only after open animation | `proto_instance.cc:1825-1840` | `object.ts:152` |

Last audited: 2026-06-02
