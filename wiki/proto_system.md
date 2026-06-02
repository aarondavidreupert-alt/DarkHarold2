# Proto System

> **Source anchor:** `raw/fallout2-ce/src/proto.cc`, `proto.h`, `proto_types.h`, `obj_types.h`, `art.cc`
> **DH2 files:** `src/pro.ts`, `src/object.ts`, `src/scripting.ts`, `src/vm_bridge.ts`
> **DH2 pipeline:** `proto.py`, `exportPRO.py`
> **Last audited:** 2026-06-02

---

## 1. Overview

Every placed object in Fallout 2 has a **prototype** (`.PRO` file) that defines its static properties — art reference, weight, stats, damage, subtype flags. Prototypes are loaded lazily by CE on demand and cached; DH2 pre-bakes all prototypes to a single `proto/pro.json` at asset-extraction time.

There are six object types, each with its own PRO binary layout:

| Type | Constant | `pid >> 24` | Directory |
|------|----------|------------|-----------|
| Item | `OBJ_TYPE_ITEM` | 0 | `proto/items/` |
| Critter | `OBJ_TYPE_CRITTER` | 1 | `proto/critters/` |
| Scenery | `OBJ_TYPE_SCENERY` | 2 | `proto/scenery/` |
| Wall | `OBJ_TYPE_WALL` | 3 | `proto/walls/` |
| Tile | `OBJ_TYPE_TILE` | 4 | `proto/tiles/` |
| Misc | `OBJ_TYPE_MISC` | 5 | `proto/misc/` |

---

## 2. PID — Prototype ID

```
Bits 31-24:  object type  (0=item, 1=critter, 2=scenery, 3=wall, 4=tile, 5=misc)
Bits 23-0:   index        (1-based line number in proto/{type}/{type}.lst)
```

CE macros (`obj_types.h`):
```cpp
#define PID_TYPE(value)  (value) >> 24
```

The `.lst` file maps the 1-based index to the actual `.pro` filename (e.g., `00000001.pro`). An index of `0xFFFFFF` (`-1` in the low bytes) means "no prototype".

Special PID ranges:
- `0x5000010`–`0x5000017` — exit grid misc objects (`FIRST_EXIT_GRID_PID` / `LAST_EXIT_GRID_PID`)
- `0x1000000` — the player dude (`gDudeProto`, a static `CritterProto`)

---

## 3. FID — Frame / Art ID

```cpp
// art.cc:1009 — buildFidInternal
return ((rotation << 28) & 0x70000000)   // bits 30-28: rotation (Rotation enum, 0..5)
     | (objectType << 24)                // bits 27-24: object type (same enum as PID)
     | ((animType << 16) & 0xFF0000)     // bits 23-16: animation type (AnimationType enum)
     | ((weaponCode << 12) & 0xF000)     // bits 15-12: weapon animation code
     |  (frmId & 0xFFF);                 // bits 11-0:  LST index (0-based)
```

CE macro for type extraction:
```cpp
#define FID_TYPE(value) ((value) & 0xF000000) >> 24
```

For **non-critter** objects (items, scenery, walls, tiles) `animType`, `weaponCode`, and `rotation` are always 0, so the FID simplifies to:

```
bits 27-24: object type
bits 11-0:  0-based index into the type's art .lst
```

For **critters**, `animType` (ANIM_WALK, ANIM_STAND, etc.) encodes which animation sequence to use, and `weaponCode` selects the weapon pose letter suffix (`a`=unarmed, `b`=one-handed, etc.).

`buildFid` (art.cc:1015) wraps `buildFidInternal` and enforces ROTATION_NE for all non-critters and for critter animations where per-rotation art is not expected.

---

## 4. PRO Binary Format

PRO files are **big-endian** (Python pipeline uses `struct.unpack("!l", ...)`, consistent with FRM). CE reads them via the `fileReadInt32` / `_db_freadInt` wrappers which perform endian conversion.

### 4.1 Common Header (all types)

```
Offset  Bytes  Field            Description
0       4      pid              Packed PID (type in bits 31-24, index in bits 23-0)
4       4      textID           Message ID in pro_{type}.msg for name (textID) / description (textID+1)
8       4      fid              Sprite FID (see §3)
12      4      lightRadius      Emitted light radius in tiles (0 = no light)
16      4      lightIntensity   Emitted light intensity (0..65535 = 0..100%)
20      4      flags            ObjectFlags bitmask (OBJECT_NO_BLOCK=0x10, OBJECT_FLAT=0x08, etc.)
```

TileProto omits `lightRadius` and `lightIntensity` — its header is only 24 bytes total including flags + extendedFlags + sid + material.

### 4.2 Item PRO (`ItemProto`, sizeof = 0x84)

After the common header:

```
Offset  Bytes  Field
24      4      extendedFlags   ItemProtoExtendedFlags (two-handed=0x200, big gun=0x100, hidden=0x08000000)
28      4      sid             Script index (-1 = none)
32      4      type            Item subtype (ITEM_TYPE_* enum)
36      4      material        Material type (MATERIAL_TYPE_* enum)
40      4      size            Bulk size
44      4      weight          Weight in grams
48      4      cost            Base value in bottle caps
52      4      inventoryFid    FID for inventory icon sprite
56      1      field_80        (padding / sound code byte)
57      +      [subtype data]  Variable length (see §4.2.1–4.2.6)
```

#### Item Subtypes

| ID | Name | Constant |
|----|------|----------|
| 0 | Armor | `ITEM_TYPE_ARMOR` |
| 1 | Container | `ITEM_TYPE_CONTAINER` |
| 2 | Drug | `ITEM_TYPE_DRUG` |
| 3 | Weapon | `ITEM_TYPE_WEAPON` |
| 4 | Ammo | `ITEM_TYPE_AMMO` |
| 5 | Misc | `ITEM_TYPE_MISC` |
| 6 | Key | `ITEM_TYPE_KEY` |

**Armor** (`ProtoItemArmorData`):
```
armorClass int32; damageResistance int32[7]; damageThreshold int32[7]; perk int32; maleFid int32; femaleFid int32
```
DR/DT order: Normal, Laser, Fire, Plasma, Electrical, EMP, Explosion.

**Container** (`ProtoItemContainerData`):
```
maxSize int32; openFlags int32
```

**Drug** (`ProtoItemDrugData`):
```
stat[3] int32[3]; amount[3] int32[3]; duration1 int32; amount1[3] int32[3];
duration2 int32; amount2[3] int32[3]; addictionChance int32; withdrawalEffect int32; withdrawalOnset int32
```

**Weapon** (`ProtoItemWeaponData`):
```
animationCode int32; minDamage int32; maxDamage int32; damageType int32;
maxRange1 int32; maxRange2 int32; projectilePid int32; minStrength int32;
actionPointCost1 int32; actionPointCost2 int32; criticalFailureType int32; perk int32;
rounds int32; caliber int32; ammoTypePid int32; ammoCapacity int32; soundCode uint8
```

**Ammo** (`ProtoItemAmmoData`):
```
caliber int32; quantity int32; armorClassModifier int32;
damageResistanceModifier int32; damageMultiplier int32; damageDivisor int32
```

**Misc** (`ProtoItemMiscData`):
```
powerTypePid int32; powerType int32; charges int32
```

**Key** (`ProtoItemKeyData`):
```
keyCode int32
```

### 4.3 Critter PRO (`CritterProto`, sizeof = 0x1A0)

After the common header:

```
Offset  Bytes  Field
24      4      extendedFlags   CritterFlags bitmask (CRITTER_NO_STEAL=0x20, CRITTER_NO_DROP=0x40, etc.)
28      4      sid             Script index
32      4      headFid         FID for talking head portrait (-1 = no dialogue head)
36      4      aiPacket        AI packet index (links to ai.lst)
40      4      team            Team number
44      +      data            CritterProtoData (see below)
```

**`CritterProtoData`** (proto_types.h):
```
flags          int32     CritterFlags
baseStats[35]  int32[35] Base SPECIAL + derived stats
bonusStats[35] int32[35] Per-level stat bonuses
skills[18]     int32[18] Skill point bonuses
bodyType       int32     BODY_TYPE_BIPED/QUADRUPED/ROBOTIC
experience     int32
killType       int32     KILL_TYPE_* (for Nuka-Cola kill counter)
damageType     int32     Native damage type when unarmed
```

Stat index order (baseStats / bonusStats):
`STR, PER, END, CHR, INT, AGI, LUK, HP, AP, AC, Unarmed, Melee, Carry, Sequence, Healing Rate, Critical Chance, Better Criticals, DT Normal…DT Explosive, DR Normal…DR Poison, Age, Gender`

Skill index order (skills[18]):
`Small Guns, Big Guns, Energy Weapons, Unarmed, Melee, Throwing, First Aid, Doctor, Sneak, Lockpick, Steal, Traps, Science, Repair, Speech, Barter, Gambling, Outdoorsman`

### 4.4 Scenery PRO (`SceneryProto`, sizeof = 0x38)

After common header + extendedFlags + sid:

```
type        int32   Scenery subtype (SCENERY_TYPE_* enum)
material    int32   Material (MATERIAL_TYPE_*)
field_34    uint8   Sound ID byte
[subtype]           Variable subtype data
```

Scenery subtypes:

| ID | Constant | Extra fields |
|----|----------|-------------|
| 0 | `SCENERY_TYPE_DOOR` | `openFlags int32`, `keyCode int32` |
| 1 | `SCENERY_TYPE_STAIRS` | `lower_tile int32`, `upper_tile int32` (packed destination builtTile) |
| 2 | `SCENERY_TYPE_ELEVATOR` | `type int32`, `level int32` |
| 3 | `SCENERY_TYPE_LADDER_UP` | `field_0 int32` |
| 4 | `SCENERY_TYPE_LADDER_DOWN` | `field_0 int32` |
| 5 | `SCENERY_TYPE_GENERIC` | (4-byte pad only) |

### 4.5 Wall PRO (`WallProto`, sizeof = 0x24)

After common header: `extendedFlags int32`, `sid int32`, `material int32`. No subtype-specific data.

### 4.6 Tile PRO (`TileProto`, sizeof = 0x1C)

Minimal header — no lightRadius / lightIntensity:
```
pid int32; textID int32; fid int32; flags int32; extendedFlags int32; sid int32; material int32
```

### 4.7 Misc PRO (`MiscProto`, sizeof = 0x1C)

Common header + `extendedFlags int32`. No subtype data.

---

## 5. CE — Runtime Loading and Caching

```cpp
// proto.cc:2125 — protoGetProto
int protoGetProto(int pid, Proto** protoPtr)
{
    if (pid == 0x1000000) { *protoPtr = (Proto*)&gDudeProto; return 0; }

    // Walk per-type linked list of ProtoListExtent buckets (16 protos/extent)
    // Return cached entry if found
    ProtoList* list = &_protoLists[PID_TYPE(pid)];
    // ... linear scan ...

    // If cache > PROTO_LIST_MAX_ENTRIES (512), evict the oldest extent
    if (...) _proto_remove_some_list(PID_TYPE(pid));

    return _proto_load_pid(pid, protoPtr);  // load from disk
}
```

`_proto_load_pid` (proto.cc:1948):
1. Calls `proto_make_path(path, pid)` → builds `proto/{type}/` directory path
2. Calls `_proto_list_str(pid, ...)` → looks up filename from `{type}.lst` by 1-based index
3. Opens the `.pro` file and calls `protoRead(proto, stream)` to deserialize into a freshly `malloc`'d `Proto`
4. Inserts into the type's `ProtoList` cache (linked extent list)

Cache capacity is 512 prototypes per type (`PROTO_LIST_MAX_ENTRIES`). Eviction is oldest-extent-first.

---

## 6. DH2 — Pipeline and Runtime

### 6.1 Extraction Pipeline

```
data/proto/{type}/*.pro
    └── proto.py::readPRO(f)         ← parses binary, builds Python dict
exportPRO.py::extractPROs()          ← iterates all .pro files per subdir
    └── proto/pro.json               ← single master JSON, keyed by type then numeric ID
```

`exportPRO.py` processes five subdirectories: `items`, `critters`, `scenery`, `walls`, `misc`. **Tiles are excluded** (see gap PS3).

The JSON structure produced:

```json
{
  "items":    { "1": { "pid": 1, "textID": 100, "type": 0, "flags": 0, "lightRadius": 0, "lightIntensity": 0, "frmPID": 0, "frmType": 0, "extra": { ... } }, ... },
  "critters": { "1": { ... "extra": { "actionFlags": ..., "AI": ..., "baseStats": {...}, "bonusStats": {...}, "skills": {...}, ... } }, ... },
  "scenery":  { "1": { ... "extra": { "subType": 0, "wallLightTypeFlags": ..., "actionFlags": ..., ... } }, ... },
  "walls":    { "1": { "pid": ..., "textID": ..., "frmPID": ..., "frmType": ..., "flags": 0 } },
  "misc":     { "1": { ... } }
}
```

`proto.py::readPRO` splits the FID field into separate `frmPID` (bits 23-0) and `frmType` (bits 27-24) fields. The common header is always written; subtype `extra` data is populated only for items, critters, and scenery. Walls and misc have no `extra` key (see gap PS4).

### 6.2 Runtime Loading

```typescript
// main.ts:564
cachedJSON('proMap', 'proto/pro.json', (value) => { globalState.proMap = value })
```

`proto/pro.json` is loaded once at startup into `globalState.proMap`. No individual file loading occurs at runtime.

```typescript
// src/pro.ts:27 — loadPRO
export function loadPRO(pid: number, pidID: number) {
    const type = getPROType(pid)               // "items", "critters", etc.
    const lsts = { "items": "proto/items/items", ... }
    const id = lsts[type]
        ? parseInt(getLstJson(lsts[type], pidID - 1)!.split(".")[0], 10)
        : pidID
    return globalState.proMap[type][id]
}
```

`loadPRO` uses the per-type `.lst` JSON (pre-baked from `data/proto/{type}/{type}.lst`) to translate the 1-based `pidID` into the numeric file ID that keys `proMap`. This mirrors CE's `_proto_list_str` step.

### 6.3 Object-level Usage

Every `Obj` instance caches its proto in `obj.pro` (set during `objFromMapObject` or `createObjectWithPID`). Key fields accessed at runtime:

| `obj.pro` field | CE equivalent | Usage |
|----------------|---------------|-------|
| `pro.flags` | `proto.flags` | Copied to `obj.flags`; `0x10` = NoBlock (`Obj.blocks()`) |
| `pro.textID` | `proto.messageId` | `.getDescription()` / `.getName()` via `.msg` lookup |
| `pro.frmPID`, `pro.frmType` | `proto.fid` (decoded) | `lookupArt()` → sprite path |
| `pro.extra.subType` | `proto.item.type` / `proto.scenery.type` | Door/stairs/weapon/armor dispatch |
| `pro.extra.scriptPID` / `.scriptID` | `proto.sid` | Script to attach on object creation |
| `pro.extra.actionFlags` | `proto.item.extendedFlags` | `_proto_action_can_use()` checks |
| `pro.extra.AI` | `proto.critter.aiPacket` | AI packet index |
| `pro.extra.team` | `proto.critter.team` | Combat team assignment |
| `pro.extra.baseStats` | `proto.critter.data.baseStats[]` | `StatSet.fromPro()` — initial stat values |
| `pro.extra.bonusStats` | `proto.critter.data.bonusStats[]` | Level-up bonus stats |
| `pro.extra.skills` | `proto.critter.data.skills[]` | `SkillSet.fromPro()` |

### 6.4 `proto_data` Scripting Opcode

CE opcode `0x8104` → `opGetProtoData` (interpreter_extra.cc:2962) → `protoGetDataMember(pid, member, &value)` (proto.cc:1099).

`protoGetDataMember` uses `ItemDataMember`, `CritterDataMember`, and `SceneryDataMember` enum IDs to return individual proto fields. The full set:

**Item** (`OBJ_TYPE_ITEM`):
| CE ID | CE name | DH2 mapped field |
|-------|---------|-----------------|
| 0 | `ITEM_DATA_MEMBER_PID` | — |
| 1 | `ITEM_DATA_MEMBER_NAME` | — |
| 2 | `ITEM_DATA_MEMBER_DESCRIPTION` | — |
| 3 | `ITEM_DATA_MEMBER_FID` | — |
| 4 | `ITEM_DATA_MEMBER_LIGHT_DISTANCE` | — |
| 5 | `ITEM_DATA_MEMBER_LIGHT_INTENSITY` | — |
| 6 | `ITEM_DATA_MEMBER_FLAGS` | `extra.itemFlags` |
| 7 | `ITEM_DATA_MEMBER_EXTENDED_FLAGS` | `extra.attackMode` |
| 8 | `ITEM_DATA_MEMBER_SID` | — |
| 9 | `ITEM_DATA_MEMBER_TYPE` | `extra.subType` (as data_member=0 in DH2, off by 9) |
| 11 | `ITEM_DATA_MEMBER_MATERIAL` | `extra.materialID` (as data_member=1) |
| 12 | `ITEM_DATA_MEMBER_SIZE` | `extra.size` (as data_member=2) |
| 13 | `ITEM_DATA_MEMBER_WEIGHT` | `extra.weight` (as data_member=3) |
| 14 | `ITEM_DATA_MEMBER_COST` | `extra.cost` (as data_member=4) |
| 15 | `ITEM_DATA_MEMBER_INVENTORY_FID` | `extra.invFRM` (as data_member=5) |
| 555 | `ITEM_DATA_MEMBER_WEAPON_RANGE` | `extra.maxRange1` (as data_member=12) |

**Critter** (`OBJ_TYPE_CRITTER`):
| CE ID | CE name | DH2 mapped field |
|-------|---------|-----------------|
| 0 | `CRITTER_DATA_MEMBER_PID` | — |
| 3 | `CRITTER_DATA_MEMBER_FID` | — |
| 9 | `CRITTER_DATA_MEMBER_DATA` | (bulk struct) — see gap PS2 |
| 10 | `CRITTER_DATA_MEMBER_HEAD_FID` | `extra.headFRM` (as data_member=1) |
| 11 | `CRITTER_DATA_MEMBER_BODY_TYPE` | — |

DH2's `proto_data` method (scripting.ts:1090) is implemented but **opcode 0x8104 is not wired** in `vm_bridge.ts` (see gap PS1). The item data_member numbering in DH2 is also offset from CE IDs — DH2 counts from 0 for `ITEM_TYPE`/`ITEM_MATERIAL`/… whereas CE defines them as 9/11/12/… (see gap PS5). Cross-reference: `known_bugs.md §S12`.

---

## 7. Known Gaps

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| PS1 | **`proto_data` opcode (0x8104) not wired in vm_bridge.ts.** The `proto_data` method exists in `scripting.ts:1090` and partially works, but no `bridged("proto_data", 2)` entry exists in `vm_bridge.ts`. Any script calling `proto_data()` will hit an unknown-opcode handler and return 0. | `vm_bridge.ts` (missing), `scripting.ts:1090` | `interpreter_extra.cc:2962 opGetProtoData()` | major | missing |
| PS2 | **`proto.py` has `FO1 = True`, suppressing critter `damageType`.** Line 234: `if FO1 or obj["killType"] in (5, 10)` — with `FO1=True`, all critters get `damageType=null`. Fallout 2 critters should have a native damage type (e.g. explosion for grenades, fire for flamers). Scripts and combat code reading critter `damageType` always see null. | `proto.py:20,234` | `proto_types.h CritterProtoData.damageType` | minor | bug |
| PS3 | **Tile PROs not extracted.** `exportPRO.py` iterates only `("items", "critters", "scenery", "walls", "misc")`. Tile prototypes (material type, script index, flags) are absent from `proto/pro.json`. DH2 cannot read tile material for gameplay effects (footstep sounds, terrain damage, etc.). | `exportPRO.py:23` | `proto.cc proto_tile_init()` | minor | missing |
| PS4 | **Wall and misc `extra` fields not parsed.** `proto.py::readPRO` only calls `readItem`, `readCritter`, or `readScenery`. For wall (type 3) and misc (type 5), it prints "unhandled type" and returns no `extra` key. Scripts querying wall `extendedFlags` or misc `lightDistance` via `proto_data` get 0. | `proto.py:268-275` | `proto.cc protoRead() case OBJ_TYPE_WALL/MISC` | minor | missing |
| PS5 | **`proto_data` item data_member IDs don't match CE.** DH2 maps `data_member=0` to `ITEM_TYPE`, `data_member=1` to `ITEM_MATERIAL`, etc. CE defines `ITEM_DATA_MEMBER_TYPE=9`, `ITEM_DATA_MEMBER_MATERIAL=11`. Scripts compiled against the CE API will pass CE's IDs (9, 11, 12…) and receive wrong fields. Already noted as `known_bugs.md §S12`. | `scripting.ts:1100-1130` | `proto.h ItemDataMember` enum | major | bug |

<!-- audited: 2026-06-02 -->
