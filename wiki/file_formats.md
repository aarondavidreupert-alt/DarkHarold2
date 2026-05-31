# Binary File Formats — Fallout 2

Sources: `frmpixels.py`, `proto.py`, `fomap.py`, `intfile.ts` · fallout2-ce `art.cc`, `proto.cc`, `map.cc`, `scripts.cc`

All multi-byte integers are **big-endian** (network byte order, `struct "!"`) unless noted.

---

## FRM — Sprite Animation

Source: `frmpixels.py:readFRMInfo`  
CE ref: `art.cc:artLoadFrameData`

FRM files hold palette-indexed pixel data for 1–6 directions. The pipeline converts them to PNG sprite sheets via `frmpixels.py` + `pal.py`.

### Header (62 bytes)

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| 0x00 | 4 | version | usually 4 |
| 0x04 | 2 | fps | frames per second (0 = use default 10) |
| 0x06 | 2 | actionFrame | frame index of the action keyframe |
| 0x08 | 2 | numFrames | number of frames per direction |
| 0x0A | 12 | dOffsetX[6] | per-direction X offset accumulator seed (signed 16 × 6) |
| 0x16 | 12 | dOffsetY[6] | per-direction Y offset accumulator seed (signed 16 × 6) |
| 0x22 | 24 | directionPtrs[6] | byte offset of each direction's frame data within the frames buffer (U32 × 6; 0 = direction absent) |
| 0x3A | 4 | framesBufSize | total byte length of all frames data |

Total header: **62 bytes**.

### Directions

A FRM may have 1–6 directions. `nDirTotal = 1 + count(directionPtr != 0)`.  
When 6 separate `.FR0`–`.FR5` files exist (critters), they are loaded as one 6-direction virtual FRM by `exportFRMs()`.

### Frame Entry (12 + pixelData bytes)

Located at `framesBuffer + directionPtr[d]`. Advance by `12 + pixelDataSize` per frame.

| Offset | Size | Field |
|--------|------|-------|
| +0 | 2 | width (pixels) |
| +2 | 2 | height (pixels) |
| +4 | 4 | pixelDataSize = width × height |
| +8 | 2 | offsetX (sprite draw offset, signed) |
| +10 | 2 | offsetY (sprite draw offset, signed) |
| +12 | W×H | pixel data (palette indices, row-major) |

Palette index 0 = transparent.

### Output (DH2 pipeline)

`exportFRM` outputs a PNG sprite sheet: all frames (all directions) stitched horizontally at `maxW × maxH` each.  
A JSON metadata blob is returned describing `frameOffsets[dir][frame].{sx, ox, oy, w, h}` where `sx` is the X pixel position in the sheet and `ox/oy` are cumulative directional offsets.

**Palette**: `pal.py:readPAL` reads `data/color.pal` (768-byte RGB triplets, 256 colours).

---

## PRO — Prototype Object Data

Source: `proto.py:readPRO`  
CE ref: `proto.cc:protoLoad`

Each `.pro` file describes one object archetype. All integers signed 32-bit unless noted.

### Shared Header (12 bytes)

CE ref: `proto.cc:protoRead` lines ~1665–1668. Only three fields are shared across all
PRO types; subsequent fields diverge immediately per type.

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| 0x00 | 4 | pid (objectTypeAndID) | high byte = type; low 16 = PID |
| 0x04 | 4 | messageId (textID) | index into `*.msg` for name/description |
| 0x08 | 4 | fid (frmTypeAndID) | high byte = FRM type; low 16 = FRM PID |

For ITEM, CRITTER, SCENERY, WALL, and MISC types the next fields are `lightDistance (4B)`,
`lightIntensity (4B)`, `flags (4B)`, and `extendedFlags (4B)` — but these are type-specific
reads, not a universal header. TILE type skips them entirely and reads only flags/extendedFlags/sid/material.

**Type encoding** (high byte of `objectTypeAndID`):

| Value | Name | Directory |
|-------|------|-----------|
| 0 | Item | `proto/items/` |
| 1 | Critter | `proto/critters/` |
| 2 | Scenery | `proto/scenery/` |
| 3 | Wall | `proto/walls/` |
| 4 | Tile | `proto/tiles/` |
| 5 | Misc | `proto/misc/` |

### Item PRO (type 0) — Fields after shared 12B header

CE ref: `proto.cc:protoRead` OBJ_TYPE_ITEM branch, lines ~1671–1683.

| Field (CE name) | Size | Notes |
|-----------------|------|-------|
| lightDistance | 4 | |
| lightIntensity | 4 | |
| flags | 4 | object flags |
| extendedFlags | 4 | item flags (two-handed, big-gun, hidden, etc.) |
| sid | 4 | script ID |
| type | 4 | 0=Armor, 1=Container, 2=Drug, 3=Weapon, 4=Ammo, 5=Misc, 6=Key |
| material | 4 | material type |
| size | 4 | |
| weight | 4 | |
| cost | 4 | |
| inventoryFid | 4 | FRM PID for inventory icon |
| soundCode (field_80) | 1 | |
| [type-specific extra data] | — | see weapon/ammo/armor sections below |

### Weapon Extra Fields (subType 3, 16 fields × 4B + 1B soundID)

| Field | Notes |
|-------|-------|
| animCode | weapon animation code |
| minDmg / maxDmg | damage dice range |
| dmgType | 0=Normal 1=Laser 2=Fire 3=Plasma 4=Electrical 5=EMP 6=Explosive |
| maxRange1 / maxRange2 | primary / secondary attack range |
| projPID | projectile PID (-1 = none) |
| minST | minimum Strength requirement |
| APCost1 / APCost2 | AP cost for each attack mode |
| critFail | critical failure table index |
| perk | weapon perk ID |
| rounds | rounds per burst |
| caliber | ammo caliber code |
| ammoPID | currently-loaded ammo PID (-1 = none) |
| maxAmmo | magazine capacity |
| soundID (1B) | |

### Ammo Extra Fields (subType 4, 6 fields × 4B)

| Field | DH2 name | Notes |
|-------|---------|-------|
| caliber | — | must match weapon caliber |
| quantity | — | rounds in the box |
| AC modifier | `ammo.ACmod` | added to target AC for hit-chance; negative = AP rounds |
| DR modifier | `ammo.RM` | added to DR before formula; positive = harder to hurt |
| damMult | `ammo.X` | damage multiplier (numerator) |
| damDiv | `ammo.Y` | damage divisor (denominator) |

### Armor Extra Fields (subType 0)

AC (4B), then 7 DR stats × 4B, then 7 DT stats × 4B, perk (4B), maleFID (4B), femaleFID (4B).

Stats in order: Normal, Laser, Fire, Plasma, Electrical, EMP, Explosive.

### Drug Extra Fields (subType 2)

stat0/1/2 (which stats are modified), amount0/1/2 (immediate values), two delayed effects (`{duration, amount0/1/2}` × 2), addictionRate, addictionEffect, addictionOnset.

### Critter PRO (type 1)

CE ref: `proto.cc:protoRead` (OBJ_TYPE_CRITTER branch, lines ~1687–1696) and `critter.cc:protoCritterDataRead` (~1064).

Fields after the 12-byte shared pid/messageId/fid:

| Field (CE name) | Size | Notes |
|-----------------|------|-------|
| lightDistance | 4 | |
| lightIntensity | 4 | |
| flags | 4 | proto-level flags |
| extendedFlags | 4 | |
| sid | 4 | script ID |
| headFid | 4 | |
| aiPacket | 4 | AI packet number |
| team | 4 | |
| data.flags | 4 | CritterProtoData flags (action flags) |
| data.baseStats (35 × 4B) | 140 | 17 primary+secondary + 7 DT + 7 DR + RadResist + PoisonResist + Age + Gender |
| data.bonusStats (35 × 4B) | 140 | same layout |
| data.skills (18 × 4B) | 72 | |
| data.bodyType | 4 | |
| data.experience (XPValue) | 4 | |
| data.killType | 4 | |
| data.damageType | 4 | optional; defaults to NORMAL if missing (some protos are 4B shorter) |

**Base/bonus stat order** (35 entries, matching `SAVEABLE_STAT_COUNT` in stat_defs.h): STR, PER, END, CHR, INT, AGI, LUK, HP, AP, AC, Unarmed, Melee, Carry, Sequence, Healing Rate, Critical Chance, Better Criticals — then DT: Normal/Laser/Fire/Plasma/Electrical/EMP/Explosive — then DR: Normal/Laser/Fire/Plasma/Electrical/EMP/Explosive — then Radiation Resistance, Poison Resistance, Age, Gender.

**Skill order**: Small Guns, Big Guns, Energy Weapons, Unarmed, Melee, Throwing, First Aid, Doctor, Sneak, Lockpick, Steal, Traps, Science, Repair, Speech, Barter, Gambling, Outdoorsman.

### Scenery PRO (type 2)

wallLightTypeFlags (2B), actionFlags (2B), scriptPID (4B), subType (4B), materialID (4B), soundID (1B).

Subtypes: 0=Door (+walkthroughFlag), 1=Stairs (+destination+destinationMap), 2=Elevator (+elevatorType+elevatorLevel), 3/4=Ladder (+destination), 5=Generic.

---

## MAP — Area Map Data

Source: `fomap.py`  
CE ref: `map.cc:mapLoad`

### Header (200 bytes)

| Offset | Size | Field | Notes |
|--------|------|-------|-------|
| 0x00 | 4 | version | 19=FO1, 20=FO2 |
| 0x04 | 16 | mapName | null-padded ASCII |
| 0x14 | 4 | playerPosition | tile number (tileNum = y×200 + x) |
| 0x18 | 4 | playerElevation | 0–2 |
| 0x1C | 4 | playerOrientation | 0–5 |
| 0x20 | 4 | numLocalVars | count of LVARs |
| 0x24 | 4 | mapScriptID | index into `scripts/` LST (-1 = none) |
| 0x28 | 4 | elevationFlags | bitmask controlling which elevations exist |
| 0x2C | 4 | unknown | |
| 0x30 | 4 | numGlobalVars | count of GVARs |
| 0x34 | 4 | mapID | |
| 0x38 | 4 | time | game time ticks at map creation |
| 0x3C | 176 | padding | |

Total: **200 bytes**.

### Elevation flags → number of levels

```python
def getNumLevels(elevationFlags):
    if elevationFlags & 8:
        if elevationFlags & 4: return 1
        return 2
    return 3
```

### Variable Arrays

Immediately after the header:
- `numGlobalVars × 4` bytes — GVAR values (signed 32-bit)  
- `numLocalVars × 4` bytes — LVAR values (signed 32-bit)

### Tile Data

`numLevels × 10000` pairs of U16 values, interleaved roof/floor per tile:

```python
for level in range(numLevels):
    for i in range(10000):  # 100x100 grid
        x = i % 100; y = i // 100
        roofTiles[level][y][99-x]  = readU16(f)  # X axis reversed
        floorTiles[level][y][99-x] = readU16(f)
```

Tile value 0 = no tile. The X reversal is a Fallout engine quirk.

### Tile Coordinate System

```
tileNum = y × 200 + x       (200-tile-wide world grid)
x = tileNum % 200
y = tileNum // 200
```

Map tiles are a 100×100 subset of the 200-wide world grid.

### Script Section

5 type blocks in order: `s_system`, `s_spatial`, `s_time`, `s_item`, `s_critter`.

Each block:
1. `count` (U32)
2. `count` entries, padded up to the next multiple of 16

Each entry (~52 bytes):
- PID (U32) — high byte = script type
- unk1 (U32)
- tileNum (U32) — for spatial/time types
- spatialRange (U32) — for spatial type only
- unk2 (U32)
- scriptID (U32)
- unk3 (U32)
- 11 × U32 unknown fields

After every 16 entries: a U32 checksum (must equal `count`) + U32 unknown.

Spatial scripts with `range > 50` are filtered as invalid.

### Object Section

Per elevation: object count (U32) then object entries.

Each object (~80 bytes shared header):
- 4B unknown separator
- position (S32) — tile number or -1
- 4×4B unknown
- frameNum (U32), orientation (U32), frmPID (U32), flags (U32)
- elevation (U32)
- protoPID (U32) — high byte = type
- 4B unknown
- lightRadius, lightIntensity (U32 each)
- 4B unknown
- mapPID (U32)
- scriptID (S32)
- numInventory (U32)
- 3×4B unknown
- type-specific extra data
- inventory items (numInventory recursive object entries)

---

## INT — Script Bytecode

Source: `intfile.ts:parseIntFile`  
CE ref: `scripts.cc`, `interpreter.cc`

`.INT` files are compiled Fallout Script Compiler output. DH2 executes them directly via `vm.ts`.

### Layout

```
[0x00–0x29]  __start block (42 bytes of init opcodes)
[0x2A]       procedure table
[after procs] identifier pool
[after idents] string pool
[code section] opcode stream
```

### Procedure Table (at offset 0x2A)

```
numProcs (U32)
for each proc:
    nameIndex (U32)   — offset into identifier pool
    flags     (U32)   — e.g. 0x01 = exported
    unk0      (U32)   — always 0
    unk1      (U32)   — always 0
    offset    (U32)   — byte offset of procedure's first opcode
    argc      (U32)   — argument count
```

Per-procedure size: **24 bytes**.

### Identifier Pool

Preceded by `identEnd` (U32) — byte length of the entire pool.

```
while (cursor - base < identEnd):
    len (U16)          — string byte count
    str (len bytes)    — null bytes ignored (early NUL = end of string data)
```

Offset into the pool (relative to `base + 4`) becomes the key in `identifiers[offset]`.

After the pool: `0xFFFFFFFF` (U32) as a signature/separator.

### String Pool

`stringEnd` (U32):
- If `0xFFFFFFFF` → no string pool; skip directly to code.
- Otherwise: same `{len(U16) + str}` structure as identifier pool.

### Code Section

Opcode stream; each opcode is `U16`. Some opcodes read a following U32 argument:
- `0xC001` — `op_push_d` (push 32-bit integer literal)
- `0x9001` — same form
- `0x8004` — `op_jmp` (absolute target offset, U32)
- `0x8005` — `op_call` (procedure name index, U32)

All other opcodes are nullary (no trailing data). See [`wiki/opcodes.md`](opcodes.md) for the full table.

### Script Procedure Hooks

FO2 scripts define specific procedure names that the engine calls at fixed events:

| Procedure | When called |
|-----------|------------|
| `start` | Map/object load, initial setup |
| `map_enter_p_proc` | Player enters map |
| `map_exit_p_proc` | Player leaves map |
| `map_update_p_proc` | Every game-tick update |
| `critter_p_proc` | Critter heartbeat |
| `talk_p_proc` | Dialogue initiated with critter |
| `combat_p_proc` | Combat begins |
| `damage_p_proc` | Critter takes damage |
| `destroy_p_proc` | Critter dies |
| `look_at_p_proc` | Player looks at object |
| `use_p_proc` | Object is used |
| `use_skill_on_p_proc` | Skill used on object |
| `pickup_p_proc` | Item picked up |
| `timed_event_p_proc` | Scheduled timer fires (`add_timer_event`) |

The `vm_bridge.ts` `GameScriptVM` constructor patches `scriptObj` so each known procedure name becomes a callable function that re-enters the VM at that procedure's offset.
