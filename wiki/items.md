# Items System

Merged reference for item types, data structures, inventory management, equip/unequip, carry weight, drug items, item use mechanics, scenery interaction, container opening, and all item-related scripting opcodes.

Cross-references: `wiki/map_scripting.md` (script proc list), `wiki/skill_checks.md` (lockpick/traps formula), `wiki/known_bugs.md` §IU, `wiki/economy.md`.

Ground truth: `raw/fallout2-ce/src/item.cc`, `item.h`, `inventory.cc`, `inventory.h`, `proto_instance.cc`, `scripts.cc`, `scripts.h`, `proto_types.h`, `obj_types.h`. DH2 sources: `src/object.ts` (barrel; `src/object/{Obj,items,Critter}.ts`), `src/ui_inventory.ts`, `src/drugs.ts`, `src/scripting.ts`, `src/vm_bridge.ts`, `src/skillUse.ts`.

---

## §1 Item Types & ProtoItem Structure

### 1.1 CE `ITEM_TYPE_*` enum (`raw/fallout2-ce/src/proto_types.h`)

| Value | Name        | Description                          |
|-------|-------------|--------------------------------------|
| 0     | ARMOR       | Wearable armor (AC / DR / DT)        |
| 1     | CONTAINER   | Container (holds other items)        |
| 2     | DRUG        | Consumable with stat effects         |
| 3     | WEAPON      | Ranged or melee weapon               |
| 4     | AMMO        | Ammunition for weapons               |
| 5     | MISC        | Miscellaneous (includes money/keys)  |
| 6     | KEY         | Key items                            |

`itemGetType` (`item.cc:712`): returns `proto->item.type`. Special cases:
- `obj == nullptr` → returns `ITEM_TYPE_MISC`
- non-item PID (high byte not 0) → returns `ITEM_TYPE_MISC`
- `PROTO_ID_SHIV` → returns `ITEM_TYPE_MISC`

### 1.2 DH2 item type representation

DH2 has no runtime `ITEM_TYPE_*` enum. Type is encoded two ways:

1. **`obj.type`** — object category string (`'item'`, `'critter'`, `'scenery'`,
   `'wall'`, `'tile'`, `'misc'`). All items have `obj.type === 'item'`.

2. **`obj.pro.extra.subType`** (number) — the raw proto type value, same numeric
   encoding as the CE enum above. Serialized from PRO files by the Python asset
   pipeline as `subType` (capital T) or `subtype` (lower) depending on the
   converter version.

`obj_type` (`scripting.ts:1290`): returns `(obj.pid >> 24) & 0xFF` — the proto
category from the PID high byte. Returns `1` for critters as a special case.

`obj_item_subtype` (`scripting.ts:1180`): returns
`obj.pro.extra.subType ?? obj.pro.extra.subtype ?? null` — the item subtype
(ARMOR=0 through KEY=6).

### 1.3 CE `ItemProto` structure (`raw/fallout2-ce/src/proto_types.h`)

The item proto struct contains:
```
type          ITEM_TYPE_* enum
flags         attribute flags
material      material type (WOOD, METAL, etc.)
size          bulk size
weight        weight in pounds
cost          barter value
inv_fid       inventory icon FID
soundId       sound ID char
```
Weapon, armor, drug, ammo, misc, key each have a union sub-struct with type-specific
fields (damage range, DR/DT values, drug stat deltas, caliber, charge counts, etc.).

### 1.4 DH2 `Obj` / proto data (`src/object/Obj.ts`, `src/object/items.ts`)

Runtime item data lives in `Obj`:
- `pid: number` — full 32-bit PID (high byte = category, low 24 bits = proto index)
- `type: string` — object category string
- `pro: ProtoItem` — deserialized proto JSON (loaded lazily)
- `amount: number` — stack count (defaults 1)
- `inventory: Obj[]` — items inside this container (containers only)
- `flags: number` — object flags bitmask

`pro.extra` fields relevant to items:
- `subType` — numeric ITEM_TYPE_* value
- `weight` — weight in pounds
- `cost` — barter value
- `AC`, `DR Normal/Laser/Fire/Plasma/Electrical/Burst/EMP`, `DT *` — armor stats
- `minDmg`, `maxDmg`, `dmgType`, `apCost*`, `range*`, `caliber` — weapon stats
- `maleFID`, `femaleFID` — armor appearance FIDs

---

## §2 Inventory Management & Carry Weight

### 2.1 CE inventory model (`raw/fallout2-ce/src/inventory.h`)

CE stores inventory as a linked list (`Inventory.items[]` of `InventoryItem`
structs, each with an `Object*` and `quantity`). Equipped items are flagged by
bitmask on the object:

```
OBJECT_IN_LEFT_HAND   = 0x1000000
OBJECT_IN_RIGHT_HAND  = 0x2000000
OBJECT_WORN           = 0x4000000  (implied — set by _inven_wield for armor)
```

`objectGetInventoryWeight` (`item.cc:919`): iterates `inventory.items[]`, calls
`itemGetWeight(item) * quantity` for each. Equipped items that are _not_
already in inventory (not flagged) are added separately via the three hand/armor
accessor functions.

### 2.2 DH2 inventory model (`src/object/Obj.ts`)

```typescript
class Obj {
    inventory: Obj[]   // flat array of item Obj instances
    // no separate quantity field — stack count lives in Obj.amount
}

class Critter extends Obj {
    leftHand?: WeaponObj   // equipped left-hand weapon
    rightHand?: WeaponObj  // equipped right-hand weapon
    // armor: found via getEquippedArmor() scanning inventory by subtype
}
```

`addInventoryItem(item, count)` (`src/object/Obj.ts`): checks for an existing item
with `approxEq()` (matching PID and type), increments `.amount` if found,
otherwise clones the item and pushes it. Stack-safe.

`Obj.money` getter (`src/object/Obj.ts`): searches `inventory` for an item with
`pid === MONEY_PID` (41 = bottle caps).

`getEquippedArmor()` (`src/object/Critter.ts`): checks `self.armor` first (explicit
player slot), then scans `inventory` for the first item with
`subtype === 'armor'`.

**Key divergence:** CE tracks equipped state with bitmask flags on each object
and deduplifies in weight calculation. DH2 tracks equipped items as separate
named properties (`leftHand`, `rightHand`, `armor`) on the `Critter`, with no
object-level bitmask.

### 2.3 Carry weight formula

**CE formula** (`raw/fallout2-ce/src/stat.cc:571`):
```c
data->baseStats[STAT_CARRY_WEIGHT] = 25 * strength + 25;
```

`itemGetWeight` (`item.cc:757`):
- Power armor PIDs → weight halved
- Container type → adds `objectGetInventoryWeight` (contents)
- Weapon type → adds loaded ammo weight
- Otherwise → `proto->item.weight`

**DH2 formula** (`src/ui_inventory/panel.ts`):
```typescript
const max = 25 + p.getStat('STR') * 25
```

Matches CE exactly. Weight calculation in `showInventory()`:
```typescript
let current = 0
for (const item of p.inventory) {
    current += (item.pro?.extra?.weight ?? 0) * item.amount
}
if (playerAny.leftHand?.pro?.extra?.weight) current += playerAny.leftHand.pro.extra.weight
if (playerAny.rightHand?.pro?.extra?.weight) current += playerAny.rightHand.pro.extra.weight
if (armorExtra?.weight) current += armorExtra.weight
```

**Divergence:** DH2 weight display is UI-only — there is no runtime enforcement
that prevents the player from picking up items over the carry limit. CE blocks
pickup when over-encumbered and applies movement penalties.

### 2.4 Script usage patterns

```ssl
// Check inventory count for a specific PID
variable count := obj_is_carrying_obj_pid(critter, PID_STIMPAK);

// Get the actual item object
variable item := obj_carrying_pid_obj(critter, PID_STIMPAK);

// Add 3 stimpaks to critter
add_mult_objs_to_inven(critter, PID_STIMPAK, 3);

// Remove 1 stimpak
rm_mult_objs_from_inven(critter, item, 1);

// Transfer entire inventory
move_obj_inven_to_obj(source, destination);

// Caps manipulation
variable caps := item_caps_total(critter);
item_caps_adjust(critter, 100);   // give 100 caps
item_caps_adjust(critter, -50);   // take 50 caps
```

---

## §3 Equip/Unequip System

### 3.1 CE equip / unequip (`raw/fallout2-ce/src/inventory.h`)

```c
int _inven_wield(Object* critter, Object* item, int hand);
int _inven_unwield(Object* critter, int hand);
```

`_inven_wield`: sets `OBJECT_IN_LEFT_HAND` or `OBJECT_IN_RIGHT_HAND` flag on
item; triggers equip animation (`ANIM_DRAW_WEAPON`); calls `_adjust_ac` for
armor. `Hand` enum: `HAND_LEFT=0`, `HAND_RIGHT=1`.

`_adjust_ac` (`inventory.h`): mutates bonus stats on the critter object for AC
and all 7 DR/DT types when armor is equipped or removed.

Accessors:
- `critterGetItem1(critter)` — item in slot 1 (left hand)
- `critterGetItem2(critter)` — item in slot 2 (right hand)
- `critterGetArmor(critter)` — worn armor

### 3.2 DH2 equip / unequip

**Script-driven** (`wield_obj_critter`, `scripting.ts:959`): sets
`(obj as Critter).rightHand = item` only. No left-hand support, no equip
animation, no `_adjust_ac` call.

**UI-driven** (`src/ui_inventory/dragdrop.ts`, `uiMoveSlot`): drag-and-drop slots
`leftHand`, `rightHand`, `armor`. Directly writes to `player.leftHand`,
`player.rightHand`, `player.armor` via `playerUnsafe[target] = obj`. Triggers
`applyArmorArt()` on armor slot changes.

`applyArmorArt` (`src/ui_inventory/dragdrop.ts`): updates `player.art` to the armor's
`maleFID` / `femaleFID` sprite path. Saves original art in `player._baseArt`
for restoration on unequip. Plays armor equip sound (`ltharmor`, `pwrarmor`,
`mtlarmor`, or `robe`).

**AC calculation** (`src/ui_inventory/panel.ts`, `src/object/Critter.ts`): armor AC is
read directly from `armor.pro.extra.AC` at render/query time — no bonus stat is
mutated on the critter object. `getArmorDR/DT/AC()` (`src/object/Critter.ts`)
similarly reads `pro.extra.stats['DR Type']` directly.

### 3.3 Script usage patterns

```ssl
// Get currently equipped items
// INVEN_TYPE_WORN=0, INVEN_TYPE_RIGHT_HAND=1, INVEN_TYPE_LEFT_HAND=2
variable armor  := critter_inven_obj(critter, INVEN_TYPE_WORN);
variable weapon := critter_inven_obj(critter, INVEN_TYPE_RIGHT_HAND);

// Equip item to right hand (left hand not supported via script in DH2)
wield_obj_critter(critter, weapon_item);

// Check item type
variable otype := obj_type(obj);         // proto category
variable itype := obj_item_subtype(obj); // 0=armor,1=container,2=drug,...
```

---

## §4 Item Use Mechanics

### 4.1 Overview of use procs

"Using" an object in Fallout 2 triggers one of three script procedures depending
on context:

| Action | Proc | CE enum value |
|--------|------|---------------|
| Use item/scenery alone | `use_p_proc` | `SCRIPT_PROC_USE = 6` |
| Use one item on another object | `use_obj_on_p_proc` | `SCRIPT_PROC_USE_OBJ_ON = 7` |
| Use a skill on an object | `use_skill_on_p_proc` | `SCRIPT_PROC_USE_SKILL_ON = 8` |

Procedures are always fired on the **target object's script**, not on the player
script — with one exception in the `use_obj_on_p_proc` two-step dispatch (§4.4).

CE enum defined in `scripts.h` lines 50–78.

### 4.2 Script context wiring

Before firing any proc, CE calls `scriptSetObjects(sid, source, target)` (`scripts.cc:624`):

```c
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

For `use_skill_on_p_proc` (`proto_instance.cc:1872`), CE additionally calls
`scriptSetActionBeingUsed(target->sid, skill)` (`scripts.cc:647`) which exposes
the skill number via the `action_being_used` intrinsic.

### 4.3 `_obj_use()` — general scenery dispatch (`proto_instance.cc:1434`)

Entry point for using scenery without a secondary item:

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

Non-door scenery with unrecognised subtype falls through to printing the object
name — no engine default behaviour beyond that. Items (misc, radios) fire
`use_p_proc` on the item's own script when used standalone.

### 4.3b Misc charged items — Stealth Boy / Geiger Counter (LE10)

✅ FIXED 2026-07-05. CE ref: `item.cc:2246-2499`. Stealth Boy and Geiger
Counter are `ITEM_SUBTYPE_MISC` items with a finite charge count
(`ProtoItemMiscData.charges`) that drain while toggled on. CE represents
on/off by literally swapping the item's own pid between the "I" (off) and
"II" (on) proto variant; DH2 tracks the same state directly on the `Obj`
instance instead (`miscOn`/`miscCharges`, new `src/miscItem.ts`), to avoid
mutating the shared cached `Proto` object every instance of that pid points
to (see `Obj.ts serialize()`'s "if pro changes in the future, this should be
cloned" note — proto objects are cache-shared via `proMap`/`loadPRO`, not
cloned per instance).

**Pipeline note**: this uncovered a real, separate gap — `tools/proto.py`'s
`readItem()` had no `SUBTYPE_MISC` branch at all, so `charges`/`powerType`/
`powerTypePid` were silently dropped for every misc item. Fixed alongside
(new branch + `MiscItemProtoExtra` in `proto_types.ts`); needs a pipeline
re-run against real assets locally to regenerate `proto/items/*.json`.

**Mechanics**: `Obj.use()` (the inventory "Use" action) toggles via
`useChargedMiscItem()`; charges drain 1 per in-game minute via
`Scripting.timeEventList` (matching CE's 600-tick
`miscItemTrickleEventProcess`). Re-equipping an already-toggled-on item into
a hand slot auto-reactivates it (`item.cc:353-358` — the literal "auto-
stealth" gap LE10 named) via a new `Critter.stealthActive` flag, recomputed
by `refreshStealthState()` on every equip/unequip/swap/drop
(`dragdrop.ts`/`panel.ts`). `Combat.ts findTarget()` halves max AI detection
range for a stealthed critter, matching `isWithinPerception()`
(`combat_ai.cc:3499-3520`).

**Known simplification**: the save/load re-equip pass (`Critter.ts`) only
restores weapon-subtype items into hand slots — a Stealth Boy equipped at
save time falls back into plain inventory on load (its on/off + charge
state still round-trips; the player just re-equips it that session).

**Not implemented**: CE's `OBJECT_TRANS_GLASS` semi-transparent sprite
rendering — needs a real WebGL shader/alpha change verified in a browser,
deferred to visual/rendering work (same status as color-cycling, RD10).

### 4.4 `_protinst_use_item_on` — use-item-on dispatch (`proto_instance.cc:1245`)

Handles "use item X on object Y". Two-step dispatch:

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

When the item has its own script, the item script runs first and can consume the
action (`returnValue != 0`). If it doesn't consume it, the target also gets the
proc.

`_obj_use_item_on` wrapper (`proto_instance.cc:1357`): outer wrapper that checks
proto flags before calling `_protinst_use_item_on`. Handles charge-based items
(medkits, stimpaks) and items with `PID_SUPER_STIMPAK`, `PID_DOCTOR_BAG` etc.
before falling through to the script proc chain.

### 4.5 Skill-on-object (`_obj_use_skill_on`, `proto_instance.cc:1872`)

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

CE's engine default for `SKILL_LOCKPICK` is a bare `break` — scripts are
expected to handle it entirely. DH2's `useLockpick()` in `skillUse.ts:383` does
the roll independently. The `action_being_used` value is readable from scripts
via the `action_being_used()` intrinsic.

### 4.6 Door state machine

State flags defined in `obj_types.h`:

| Flag | Hex | Meaning |
|------|-----|---------|
| `DOOR_FLAG_LOCKED` | `0x02000000` | door is locked |
| `DOOR_FLAG_JAMMGED` | `0x04000000` | door is jammed (typo in CE source preserved) |

Note: `CONTAINER_FLAG_LOCKED` and `CONTAINER_FLAG_JAMMED` share identical values;
they are stored in the same `openFlags` field with different object types.

Open/closed state is tracked by animation frame: `object->frame == 0` → closed;
`object->frame != 0` → open. Opening a door sets the `OBJECT_OPEN_DOOR`
composite flag (`OBJECT_SHOOT_THRU | OBJECT_LIGHT_THRU | OBJECT_NO_BLOCK`) on
the tile object.

`_obj_use_door` dispatch (`proto_instance.cc:1710`):

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

Key point: the locked-door sound plays **before** the script proc fires. Scripts
can still override the action by returning non-zero.

Jam/unjam lifecycle:
- Jam is set by lockpick critical failure (`skill.cc`) via `objectJamLock()` (`proto_instance.cc:2131`).
- `objectUnjamAll()` (`proto_instance.cc:2171`) clears all jam bits on every object on the current map. Called:
  - At midnight every in-game day: `gameTimeEventProcess()` (`scripts.cc:418`)
  - On map load: `map.cc:1065`

### 4.7 DH2 `Obj.use()` implementation (`src/object/Obj.ts`)

```typescript
use(source: Obj, isSecondary = false): boolean {
    if (this._script) {
        Scripting.use(this, source)  // → fires use_p_proc on this._script
    }
    // engine fallback: door, container, stairs, ladder
}
```

`Scripting.use()` (`scripting.ts:1959`) calls `obj._script.use_p_proc()` — fires
on the **object's** script with `self_obj = obj`, `source_obj = source`. This
matches CE.

DH2 proc declarations (`src/scripting.ts:389`):

```typescript
use_p_proc() { ... }
use_obj_on_me_p_proc() { ... }  // ← wrong name (CE: use_obj_on_p_proc)
use_skill_on_me_p_proc() { ... } // ← wrong name (CE: use_skill_on_p_proc)
```

Scripts compiled for CE will not match the DH2 names.

Lock/open opcodes (`src/scripting.ts`):

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

All wired in `vm_bridge.ts`.

`setObjectOpen()` (`src/object/Obj.ts`): when `obj.locked === true`, returns
`false` immediately with no sound or message. CE plays the locked SFX and "That
door is locked." message before checking.

---

## §5 Container Interaction

### 5.1 CE `_obj_use_container` (`proto_instance.cc:1789`)

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

Loot UI is shown only **after** the open animation completes, not immediately on
interaction.

### 5.2 DH2 container loot UI

`setObjectOpen()` calls `uiLoot(obj)` immediately upon opening. CE separates the
loot screen from the animation: the screen opens only after `objectOpenClose()`
completes. (See also gap IU5 in §7.)

---

## §6 Drug / Consumable System

### 6.1 CE drug mechanics (`raw/fallout2-ce/src/item.cc:2776`)

`_item_d_take_drug`:
1. Checks if user is a robot (robots are immune)
2. Reads stat delta data from proto (immediate, timed effect 1, timed effect 2)
3. `_perform_drug_effect(critter, ...)` — applies immediate stat changes
4. `_insert_drug_effect(...)` ×2 — queues two `EVENT_TYPE_DRUG` events into the
   game event queue with delays read from proto
5. Addiction roll: base chance from proto; × 2 for Chem Reliant, ÷ 2 for Chem
   Resistant, ÷ 2 for Flower Child; if roll passes, `_insert_withdrawal`

Drug data (stat deltas, timings, addiction chance) is stored in each drug's PRO
file — not hardcoded.

### 6.2 DH2 drug mechanics (`src/drugs.ts`)

DH2 does **not** read drug data from PRO files. Instead it uses a hardcoded
`DRUG_TABLE` of 8 known drugs:

| pidID | Name         | Immediate       | Timed Effect              | Duration  | Addic% | Withdrawal         |
|-------|--------------|-----------------|---------------------------|-----------|--------|--------------------|
| 24    | Stimpak      | +10 HP          | —                         | —         | 0%     | —                  |
| 75    | Super Stimpak| +75 HP          | −9 HP (delayed)           | 36000 t   | 0%     | —                  |
| 28    | Psycho       | —               | +25 DR Normal             | 3000 t    | 10%    | −1 END             |
| 27    | Buffout      | —               | +2 STR, +2 END            | 3000 t    | 10%    | −2 STR, −1 AGI     |
| 119   | Jet          | —               | +2 AP                     | 1500 t    | 100%   | −1 END             |
| 164   | Nuka-Cola    | +2 HP           | —                         | —         | 0%     | —                  |
| 29    | Rad-Away     | −150 radiation  | —                         | —         | 0%     | —                  |
| 51    | Antidote     | −50 poison      | —                         | —         | 0%     | —                  |

`useDrug(item, user)` (`drugs.ts:107`):
1. Looks up drug by `item.pid & 0xFFFF` in `drugByPID` map
2. Applies `immediateHP` (capped at `maxHP - curHP`)
3. Handles special effects (`radaway`, `antidote`, `jetAddict`)
4. Schedules delayed HP events on `Scripting.timeEventList`
5. Applies timed stat bonuses immediately; schedules reversal + addiction check
   via `timeEventList`

`computeAddictChance` (`drugs.ts:94`): Chem Resistant halves, Chem Reliant
doubles (no Flower Child trait — gap vs CE).

`tickAddictions(critter)` (`drugs.ts:203`): called from `map_update_p_proc` in
`main.ts`. Per cycle (600 ticks), for each addiction where the drug's timed
effect event is no longer in `timeEventList`, applies withdrawal stat penalties.

**Key divergences from CE:**
- Only 8 drugs recognized; any other drug PRO has no effect
- No robot immunity check
- No Flower Child trait modifier
- Drug stat data not read from PRO files
- Addiction stored in `critter.addictions: string[]` (drug name), not via GVAR
- CE tracks addiction as a GVAR per drug; DH2 tracks it as an in-memory array

### 6.3 Adding a new drug

DH2 drug support requires a `DRUG_TABLE` entry in `src/drugs.ts`. The item's
`pidID` (`pid & 0xFFFF`) must be added to `DRUG_TABLE` with the desired effects.
There is no automatic PRO-based drug handling.

1. Find the drug's PRO file number (low 24 bits of the PID, or check
   `proto/items/` JSON)
2. Add a `DrugEffect` entry to `DRUG_TABLE` in `src/drugs.ts`
3. The `useDrug()` function is called from the item `use()` handler in
   `object.ts` when a drug-subtype item is activated

---

## §7 Item Scripting Opcodes

All opcodes listed by hex value with status against the CE implementation.

### 7.1 Implemented inventory opcodes

| Opcode | Name                      | Args | Status      | DH2 source              | Notes |
|--------|---------------------------|------|-------------|-------------------------|-------|
| 0x80C8 | `obj_type`                | 1    | IMPLEMENTED | scripting.ts:1290       | Returns `(pid>>24)&0xFF`; returns 1 for critters |
| 0x80C9 | `obj_item_subtype`        | 1    | IMPLEMENTED | scripting.ts:1180       | Returns `pro.extra.subType ?? subtype` |
| 0x80BA | `obj_is_carrying_obj_pid` | 2    | IMPLEMENTED | scripting.ts:678        | Counts inventory matches by PID |
| 0x80D8 | `add_obj_to_inven`        | 2    | IMPLEMENTED | scripting.ts:734        | Delegates to `addInventoryItem(item, 1)` |
| 0x80D9 | `rm_obj_from_inven`       | 2    | IMPLEMENTED | scripting.ts:738        | Delegates to `rm_mult_objs_from_inven(..., 1)` |
| 0x80DA | `wield_obj_critter`       | 2    | PARTIAL     | scripting.ts:959        | Right hand only; no equip anim; no `_adjust_ac` |
| 0x8106 | `critter_inven_obj`       | 2    | IMPLEMENTED | scripting.ts:834        | where=0→armor, 1→rightHand, 2→leftHand; −2 warns |
| 0x8109 | `inven_cmds`              | 3    | STUB        | scripting.ts:846        | INVEN_CMD_INDEX_PTR=13 always returns null |
| 0x810D | `obj_carrying_pid_obj`    | 2    | IMPLEMENTED | scripting.ts:740        | Returns first matching inventory item |
| 0x8116 | `add_mult_objs_to_inven`  | 3    | IMPLEMENTED | scripting.ts:696        | Calls `addInventoryItem(item, count)` |
| 0x8117 | `rm_mult_objs_from_inven` | 3    | IMPLEMENTED | scripting.ts:713        | Finds by `approxEq`, decrements amount |
| 0x8138 | `item_caps_total`         | 1    | IMPLEMENTED | scripting.ts:640        | Returns `obj.money` (PID 41 search) |
| 0x8139 | `item_caps_adjust`        | 2    | IMPLEMENTED | scripting.ts:644        | Adjusts bottle caps amount; creates if missing |
| 0x8145 | `use_obj_on_obj`          | 2    | IMPLEMENTED | scripting.ts:1221       | Calls `obj.use(who, true)` — fires wrong proc (see §8 gap IU1) |
| 0x8147 | `move_obj_inven_to_obj`   | 2    | IMPLEMENTED | scripting.ts:663        | `other.inventory = obj.inventory; obj.inventory = []` |

### 7.2 Missing opcodes (not in `vm_bridge.ts`)

These CE scripting intrinsics have no entry in `src/vm_bridge.ts`:

| CE function           | Description                              |
|-----------------------|------------------------------------------|
| `unwield_obj_critter` | Unequip weapon from critter slot         |
| `item_size`           | Return item bulk size from proto         |
| `item_weight`         | Return item weight from proto            |
| `obj_is_in_inven`     | Test if item is currently in inventory   |
| `inven_obj_is_wielded`| Test if item is currently equipped       |
| `drop_obj`            | Drop item to map tile                    |
| `pickup_obj`          | Pick up item from map tile               |
| `item_d_take_drug`    | CE-style pro-data drug application       |

---

## §8 Known Gaps

| ID   | Area                          | CE behavior                                                       | DH2 behavior                                                         | CE reference                               | DH2 location              |
|------|-------------------------------|-------------------------------------------------------------------|----------------------------------------------------------------------|--------------------------------------------|---------------------------|
| —    | Carry weight enforcement      | Blocks pickup; AP penalty when over limit                         | Display only; no enforcement                                         | `stat.cc:571`, `item.cc:919`               | `src/ui_inventory/panel.ts` |
| —    | Wield left hand (script)      | `_inven_wield(critter, item, HAND_LEFT)`                          | `wield_obj_critter` only sets `rightHand`                            | `inventory.h`                              | `scripting.ts:959`        |
| —    | Equip animation               | `ANIM_DRAW_WEAPON` triggered on wield                             | No animation in `wield_obj_critter`                                  | `inventory.h`                              | `scripting.ts:959`        |
| —    | AC bonus stat mutation        | `_adjust_ac` modifies bonus stats at equip                        | AC/DR read directly from `pro.extra` at query time                   | `inventory.h`                              | `src/object/Critter.ts`   |
| —    | Drug data source              | All deltas from PRO file; extensible                              | Hardcoded `DRUG_TABLE` for 8 drugs only                              | `item.cc:2776`                             | `drugs.ts`                |
| —    | Flower Child trait            | Halves addiction chance                                           | Not implemented in `computeAddictChance`                             | `item.cc:2776`                             | `drugs.ts:94`             |
| —    | Robot drug immunity           | Robots can't use drugs                                            | Not checked in `useDrug()`                                           | `item.cc:2776`                             | `drugs.ts:107`            |
| —    | Addiction persistence         | Stored as GVARs; survives save/load                               | In-memory `critter.addictions[]`; not persisted                      | `item.cc`                                  | `drugs.ts`                |
| —    | Container weight              | Contents added to container weight                                | No container weight summing in DH2                                   | `item.cc:919`                              | —                         |
| —    | Power armor weight halve      | PIDs 0x13, 0x16, 0x3E5 halved in `itemGetWeight`                 | Not implemented                                                      | `item.cc:757`                              | —                         |
| —    | `inven_cmds`                  | 13 inventory manipulation sub-commands                            | STUB — only INVEN_CMD_INDEX_PTR=13, always null                      | `inventory.h`                              | `scripting.ts:846`        |
| —    | Drop / pickup (script)        | `drop_obj` / `pickup_obj` map placement                           | Not wired in `vm_bridge.ts`                                          | `item.cc`                                  | `vm_bridge.ts` (missing)  |
| —    | `unwield_obj_critter`         | Removes item from hand, triggers anim                             | Not wired in `vm_bridge.ts`                                          | `inventory.h`                              | `vm_bridge.ts` (missing)  |
| IU1  | `use_obj_on_obj` wrong proc   | Fires `use_obj_on_p_proc` on target                               | Fires `use_p_proc` — quest-item interactions (e.g. Wrench on car) broken | `proto_instance.cc:1245`               | `scripting.ts:1227`       |
| IU2  | Proc name mismatch            | `use_obj_on_p_proc` / `use_skill_on_p_proc`                      | DH2 declares `use_obj_on_me_p_proc` / `use_skill_on_me_p_proc`      | `scripts.h:61-62`                          | `scripting.ts:390-391`    |
| IU3  | No jammed state               | `jam_lock` / `unjam_lock` exist; midnight unjam fires             | No jammed state on `Obj`; opcodes missing; midnight unjam never fires (cross-ref §GTC5 in known_bugs.md) | `proto_instance.cc:2131,2171`; `scripts.cc:418` | `scripting.ts` (missing) |
| IU4  | No locked-door SFX/message    | Plays locked SFX + "That door is locked." before proc fires       | `setObjectOpen()` returns `false` silently                           | `proto_instance.cc:1710-1722`              | `src/object/Obj.ts`       |
| IU5  | Container loot UI timing      | Loot screen shown only after `objectOpenClose()` animation        | `setObjectOpen()` calls `uiLoot(obj)` immediately                   | `proto_instance.cc:1825-1840`              | `src/object/Obj.ts`       |
| IU6  | ✅ FIXED 2026-07-05 — `canUse` read a nonexistent `extendedFlags` key (items have no such top-level `extra` field) | Standalone-usable items (Stealth Boy, radios, etc.) never showed as usable | Fixed to read `extra.weaponFlags & 0x08` — see `known_bugs.md` IU6 for the full byte-swap derivation | `proto.cc:257 _proto_action_can_use()` | `src/object/Obj.ts:canUse` |

Last audited: 2026-07-05
<!-- 2026-07-05: added §4.3b misc charged items (Stealth Boy/Geiger Counter, LE10 fixed); IU6 canUse bitmask fix -->
