# Inventory & Items System

DarkHarold2 inventory and item reference. Documents item types, data structures,
equip/unequip mechanics, carry weight, the drug system, and all item-related
scripting opcodes.

Ground truth: `raw/fallout2-ce/src/item.cc`, `item.h`, `inventory.cc`,
`inventory.h`. DH2 sources: `src/object.ts`, `src/ui_inventory.ts`,
`src/drugs.ts`, `src/scripting.ts`, `src/vm_bridge.ts`.

---

## Item Types

### CE `ITEM_TYPE_*` enum (`raw/fallout2-ce/src/proto_types.h`)

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

### DH2 item type representation

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

---

## Data Structures

### CE `ItemProto` (proto_types.h)

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

### DH2 `Obj` / proto data

Runtime item data lives in `Obj` (`src/object.ts`):
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

## Inventory Data Model

### CE inventory (`raw/fallout2-ce/src/inventory.h`)

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

### DH2 inventory (src/object.ts)

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

`addInventoryItem(item, count)` (`object.ts:625`): checks for an existing item
with `approxEq()` (matching PID and type), increments `.amount` if found,
otherwise clones the item and pushes it. Stack-safe.

`Obj.money` getter (`object.ts:670`): searches `inventory` for an item with
`pid === MONEY_PID` (41 = bottle caps).

`getEquippedArmor()` (`object.ts:1537`): checks `self.armor` first (explicit
player slot), then scans `inventory` for the first item with
`subtype === 'armor'`.

**Key divergence:** CE tracks equipped state with bitmask flags on each object
and deduplifies in weight calculation. DH2 tracks equipped items as separate
named properties (`leftHand`, `rightHand`, `armor`) on the `Critter`, with no
object-level bitmask.

---

## Equipment Slots

### CE equip / unequip (`raw/fallout2-ce/src/inventory.h`)

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

### DH2 equip / unequip

**Script-driven** (`wield_obj_critter`, `scripting.ts:959`): sets
`(obj as Critter).rightHand = item` only. No left-hand support, no equip
animation, no `_adjust_ac` call.

**UI-driven** (`ui_inventory.ts:204`, `uiMoveSlot`): drag-and-drop slots
`leftHand`, `rightHand`, `armor`. Directly writes to `player.leftHand`,
`player.rightHand`, `player.armor` via `playerUnsafe[target] = obj`. Triggers
`applyArmorArt()` on armor slot changes.

`applyArmorArt` (`ui_inventory.ts:277`): updates `player.art` to the armor's
`maleFID` / `femaleFID` sprite path. Saves original art in `player._baseArt`
for restoration on unequip. Plays armor equip sound (`ltharmor`, `pwrarmor`,
`mtlarmor`, or `robe`).

**AC calculation** (ui_inventory.ts:416–422, object.ts:1547): armor AC is read
directly from `armor.pro.extra.AC` at render/query time — no bonus stat is
mutated on the critter object. `getArmorDR/DT/AC()` (`object.ts:1547-1573`)
similarly reads `pro.extra.stats['DR Type']` directly.

---

## Weight & Carry Capacity

### CE formula (`raw/fallout2-ce/src/stat.cc:571`)

```c
data->baseStats[STAT_CARRY_WEIGHT] = 25 * strength + 25;
```

`itemGetWeight` (`item.cc:757`):
- Power armor PIDs → weight halved
- Container type → adds `objectGetInventoryWeight` (contents)
- Weapon type → adds loaded ammo weight
- Otherwise → `proto->item.weight`

### DH2 formula (`src/ui_inventory.ts:461`)

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

---

## Drug / Consumable System

### CE drug mechanics (`raw/fallout2-ce/src/item.cc:2776`)

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

### DH2 drug mechanics (`src/drugs.ts`)

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

---

## Scripting Opcodes

All opcodes listed by hex value with status against the CE implementation.

| Opcode | Name                   | Args | Status      | DH2 source                          | Notes |
|--------|------------------------|------|-------------|-------------------------------------|-------|
| 0x80C8 | `obj_type`             | 1    | IMPLEMENTED | scripting.ts:1290                   | Returns `(pid>>24)&0xFF`; returns 1 for critters |
| 0x80C9 | `obj_item_subtype`     | 1    | IMPLEMENTED | scripting.ts:1180                   | Returns `pro.extra.subType ?? subtype` |
| 0x80BA | `obj_is_carrying_obj_pid` | 2 | IMPLEMENTED | scripting.ts:678                    | Counts inventory matches by PID |
| 0x80D8 | `add_obj_to_inven`     | 2    | IMPLEMENTED | scripting.ts:734                    | Delegates to `addInventoryItem(item, 1)` |
| 0x80D9 | `rm_obj_from_inven`    | 2    | IMPLEMENTED | scripting.ts:738                    | Delegates to `rm_mult_objs_from_inven(..., 1)` |
| 0x80DA | `wield_obj_critter`    | 2    | PARTIAL     | scripting.ts:959                    | Right hand only; no equip anim; no `_adjust_ac` |
| 0x8106 | `critter_inven_obj`    | 2    | IMPLEMENTED | scripting.ts:834                    | where=0→armor, 1→rightHand, 2→leftHand; −2 warns |
| 0x8109 | `inven_cmds`           | 3    | STUB        | scripting.ts:846                    | INVEN_CMD_INDEX_PTR=13 always returns null |
| 0x810D | `obj_carrying_pid_obj` | 2    | IMPLEMENTED | scripting.ts:740                    | Returns first matching inventory item |
| 0x8116 | `add_mult_objs_to_inven` | 3  | IMPLEMENTED | scripting.ts:696                    | Calls `addInventoryItem(item, count)` |
| 0x8117 | `rm_mult_objs_from_inven` | 3 | IMPLEMENTED | scripting.ts:713                    | Finds by `approxEq`, decrements amount |
| 0x8138 | `item_caps_total`      | 1    | IMPLEMENTED | scripting.ts:640                    | Returns `obj.money` (PID 41 search) |
| 0x8139 | `item_caps_adjust`     | 2    | IMPLEMENTED | scripting.ts:644                    | Adjusts bottle caps amount; creates if missing |
| 0x8145 | `use_obj_on_obj`       | 2    | IMPLEMENTED | scripting.ts:1221                   | Calls `obj.use(who, true)` |
| 0x8147 | `move_obj_inven_to_obj`| 2    | IMPLEMENTED | scripting.ts:663                    | `other.inventory = obj.inventory; obj.inventory = []` |

### Missing opcodes (not in `vm_bridge.ts`)

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

## Known Gaps

| Area                      | CE behavior                                  | DH2 behavior                                         |
|---------------------------|----------------------------------------------|------------------------------------------------------|
| Carry weight enforcement  | Blocks pickup; AP penalty when over limit    | Display only; no enforcement (`ui_inventory.ts:461`) |
| Wield left hand (script)  | `_inven_wield(critter, item, HAND_LEFT)`     | `wield_obj_critter` only sets `rightHand`            |
| Equip animation           | `ANIM_DRAW_WEAPON` triggered on wield        | No animation in `wield_obj_critter`                  |
| AC bonus stat mutation    | `_adjust_ac` modifies bonus stats at equip   | AC/DR read directly from `pro.extra` at query time   |
| Drug data source          | All deltas from PRO file; extensible         | Hardcoded `DRUG_TABLE` for 8 drugs only              |
| Flower Child trait        | Halves addiction chance                      | Not implemented in `computeAddictChance`             |
| Robot drug immunity       | Robots can't use drugs                       | Not checked in `useDrug()`                           |
| Addiction persistence     | Stored as GVARs; survives save/load          | In-memory `critter.addictions[]`; not persisted      |
| Container weight          | Contents added to container weight           | No container weight summing in DH2                   |
| Power armor weight halve  | PIDs 0x13, 0x16, 0x3E5 halved in `itemGetWeight` | Not implemented                                 |
| `inven_cmds`              | 13 inventory manipulation sub-commands       | STUB — only INVEN_CMD_INDEX_PTR=13, always null      |
| Drop / pickup (script)    | `drop_obj` / `pickup_obj` map placement      | Not wired in vm_bridge.ts                            |
| `unwield_obj_critter`     | Removes item from hand, triggers anim        | Not wired in vm_bridge.ts                            |

---

## How to Use

### Check what a critter is carrying

```ssl
// Check inventory count for a specific PID
variable count := obj_is_carrying_obj_pid(critter, PID_STIMPAK);

// Get the actual item object
variable item := obj_carrying_pid_obj(critter, PID_STIMPAK);
```

### Add / remove items

```ssl
// Add 3 stimpaks to critter
add_mult_objs_to_inven(critter, PID_STIMPAK, 3);

// Remove 1 stimpak
rm_mult_objs_from_inven(critter, item, 1);

// Transfer entire inventory
move_obj_inven_to_obj(source, destination);
```

### Equip a weapon (right hand only via script)

```ssl
// Equip item to critter's right hand
// Note: left hand not supported via script in DH2
wield_obj_critter(critter, weapon_item);
```

### Caps manipulation

```ssl
// Get total caps
variable caps := item_caps_total(critter);

// Give critter 100 caps
item_caps_adjust(critter, 100);

// Take 50 caps
item_caps_adjust(critter, -50);
```

### Check item type

```ssl
// Get proto category (0=item, 1=critter, 2=scenery, 3=wall, 4=tile, 5=misc)
variable otype := obj_type(obj);

// Get item subtype (0=armor, 1=container, 2=drug, 3=weapon, 4=ammo, 5=misc, 6=key)
variable itype := obj_item_subtype(obj);
```

### Read currently equipped items

```ssl
// INVEN_TYPE_WORN=0, INVEN_TYPE_RIGHT_HAND=1, INVEN_TYPE_LEFT_HAND=2
variable armor := critter_inven_obj(critter, INVEN_TYPE_WORN);
variable weapon := critter_inven_obj(critter, INVEN_TYPE_RIGHT_HAND);
```

### Adding a new drug

DH2 drug support requires a `DRUG_TABLE` entry in `src/drugs.ts`. The item's
`pidID` (`pid & 0xFFFF`) must be added to `DRUG_TABLE` with the desired effects.
There is no automatic PRO-based drug handling.

1. Find the drug's PRO file number (low 24 bits of the PID, or check
   `proto/items/` JSON)
2. Add a `DrugEffect` entry to `DRUG_TABLE` in `src/drugs.ts`
3. The `useDrug()` function is called from the item `use()` handler in
   `object.ts` when a drug-subtype item is activated
