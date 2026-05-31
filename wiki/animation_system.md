# Animation System

Reference doc for the Fallout 2 animation system as implemented in DarkHarold2.  
Covers FID encoding, animation IDs, the `reg_anim_*` batch system, FRM format, and DH2 implementation status.

Ground truth: `raw/fallout2-ce/src/art.cc`, `art.h`, `animation.cc`, `animation.h`, `obj_types.h`  
DH2 implementation: `src/object.ts`, `src/scripting.ts`, `src/vm_bridge.ts`

---

## 1. FID Structure

Every renderable object has a **Frame ID (FID)** — a 32-bit integer that encodes all the information needed to locate its sprite file.

### Bit Layout

```
bits  31-30: unused (always 0)
bits  29-28: rotation       [3 bits, 0-5; critters only, used for death anim facing]
bits  27-24: object type    [4 bits, OBJ_TYPE_* enum]
bits  23-16: animation ID   [8 bits, AnimationType enum]
bits  15-12: weapon code    [4 bits, WeaponAnimation enum]
bits  11-0:  FRM index      [12 bits, index into type .lst file]
```

Source: `buildFidInternal` in `raw/fallout2-ce/src/art.cc:1009`:
```c
return ((rotation << 28) & 0x70000000)
     | (objectType << 24)
     | ((animType << 16) & 0xFF0000)
     | ((weaponCode << 12) & 0xF000)
     | (frmId & 0xFFF);
```

### CE Macros

```c
// raw/fallout2-ce/src/obj_types.h
#define FID_TYPE(value)      (((value) & 0xF000000) >> 24)

// raw/fallout2-ce/src/art.h
#define FID_ANIM_TYPE(value) (((value) & 0xFF0000) >> 16)
```

`buildFid(objectType, frmId, animType, weaponCode, rotation)` is the public CE wrapper (declared `art.h`, defined `art.cc:1015`). It falls back to rotation 0 for non-death animations.

### DH2 Equivalent

DH2 does not construct FIDs at runtime for rendering. The FID is stored on each object as `obj.frmPID` (set during map load from `.json` proto data). Scripting opcodes read it with `obj_art_fid` / `art_anim`:

```typescript
// src/scripting.ts
obj_art_fid(obj): number  { return obj.frmPID ?? 0 }
art_anim(fid): number     { return (fid >>> 16) & 0xFF }  // extracts animType field
```

Animation path resolution uses the object's base `art` string, not a reconstructed FID. See §4 (Weapon Animation Codes) and §7 (FRM lookup) for how DH2 maps anim strings → FRM paths.

---

## 2. Object Types

The high nibble of a FID identifies the object class, which determines the `art/` subdirectory.

| Value | CE Constant         | Directory    | DH2            |
|-------|---------------------|--------------|----------------|
| 0     | OBJ_TYPE_ITEM       | art/items/   | yes (items)    |
| 1     | OBJ_TYPE_CRITTER    | art/critters/| yes (critters) |
| 2     | OBJ_TYPE_SCENERY    | art/scenery/ | yes (scenery)  |
| 3     | OBJ_TYPE_WALL       | art/walls/   | yes (walls)    |
| 4     | OBJ_TYPE_TILE       | art/tiles/   | yes (tiles)    |
| 5     | OBJ_TYPE_MISC       | art/misc/    | yes (misc)     |
| 6     | OBJ_TYPE_INTERFACE  | art/intrface/| yes (intrface) |
| 7     | OBJ_TYPE_INVENTORY  | art/inven/   | partial        |
| 8     | OBJ_TYPE_HEAD       | art/heads/   | partial        |
| 9     | OBJ_TYPE_BACKGROUND | art/backgrnd/| no             |
| 10    | OBJ_TYPE_SKILLDEX   | art/skilldex/| no             |

Source: `gArtListDescriptions` array, `raw/fallout2-ce/src/art.cc:55`.

DH2 `getPROType` in `src/pro.ts:22` handles types 0–5 only. Interface art is looked up separately via `lookupInterfaceArt` (`src/pro.ts:110`).

---

## 3. Animation IDs

The `AnimationType` enum is defined in `raw/fallout2-ce/src/animation.h`. There are 65 values (0–64).

### Basic Locomotion (0–19)

| ID | CE Name               | DH2 anim string      |
|----|-----------------------|----------------------|
| 0  | ANIM_STAND            | `'idle'`             |
| 1  | ANIM_WALK             | `'walk'`             |
| 2  | ANIM_JUMP_BEGIN       | —                    |
| 3  | ANIM_JUMP_END         | —                    |
| 4  | ANIM_CLIMB_LADDER     | `'climb'`            |
| 5  | ANIM_FALLING          | —                    |
| 6  | ANIM_UP_STAIRS_RIGHT  | —                    |
| 7  | ANIM_UP_STAIRS_LEFT   | —                    |
| 8  | ANIM_DOWN_STAIRS_RIGHT| —                    |
| 9  | ANIM_DOWN_STAIRS_LEFT | —                    |
| 10 | ANIM_MAGIC_HANDS_GROUND | —                  |
| 11 | ANIM_MAGIC_HANDS_MIDDLE | —                  |
| 12 | ANIM_MAGIC_HANDS_UP   | —                    |
| 13 | ANIM_DODGE_ANIM       | `'dodge'`            |
| 14 | ANIM_HIT_FROM_FRONT   | `'hitFront'`         |
| 15 | ANIM_HIT_FROM_BACK    | `'hitBack'`          |
| 16 | ANIM_THROW_PUNCH      | —                    |
| 17 | ANIM_KICK_LEG         | —                    |
| 18 | ANIM_THROW_ANIM       | —                    |
| 19 | ANIM_RUNNING          | `'run'`              |

### Knockdown and Death (20–35) — `FIRST_KNOCKDOWN_AND_DEATH_ANIM = 20`

| ID | CE Name                       | DH2 anim string        |
|----|-------------------------------|------------------------|
| 20 | ANIM_FALL_BACK                | `'knockdownBack'`      |
| 21 | ANIM_FALL_FRONT               | `'knockdownFront'`     |
| 22 | ANIM_BAD_LANDING              | —                      |
| 23 | ANIM_BIG_HOLE                 | —                      |
| 24 | ANIM_CHARRED_BODY             | `'death-fire'`         |
| 25 | ANIM_CHUNKS_OF_FLESH          | `'death-explode'`      |
| 26 | ANIM_DANCING_AUTOFIRE         | `'death-burst'`        |
| 27 | ANIM_ELECTRIFY                | `'death-electro'`      |
| 28 | ANIM_SLICED_IN_HALF           | —                      |
| 29 | ANIM_BURNED_TO_NOTHING        | —                      |
| 30 | ANIM_ELECTRIFIED_TO_NOTHING   | —                      |
| 31 | ANIM_EXPLODED_TO_NOTHING      | —                      |
| 32 | ANIM_MELTED_TO_NOTHING        | `'death-plasma'`       |
| 33 | ANIM_FIRE_DANCE               | —                      |
| 34 | ANIM_FALL_BACK_BLOOD          | `'death'`              |
| 35 | ANIM_FALL_FRONT_BLOOD         | —                      |

`LAST_KNOCKDOWN_AND_DEATH_ANIM = 35`

### Position Change (36–37)

| ID | CE Name                 | DH2 anim string   |
|----|-------------------------|-------------------|
| 36 | ANIM_PRONE_TO_STANDING  | `'getUpFront'`    |
| 37 | ANIM_BACK_TO_STANDING   | `'getUpBack'`     |

### Weapon Animations (38–47)

| ID | CE Name                 | DH2 anim string      |
|----|-------------------------|----------------------|
| 38 | ANIM_TAKE_OUT           | `'weapon-draw'`      |
| 39 | ANIM_PUT_AWAY           | `'weapon-holster'`   |
| 40 | ANIM_PARRY_ANIM         | —                    |
| 41 | ANIM_THRUST_ANIM        | `'shoot'` (melee)    |
| 42 | ANIM_SWING_ANIM         | —                    |
| 43 | ANIM_POINT              | —                    |
| 44 | ANIM_UNPOINT            | —                    |
| 45 | ANIM_FIRE_SINGLE        | `'shoot'`            |
| 46 | ANIM_FIRE_BURST         | —                    |
| 47 | ANIM_FIRE_CONTINUOUS    | —                    |

### SF Death Sequences (48–63) — `FIRST_SF_DEATH_ANIM = 48`

IDs 48–63 mirror the 16 knockdown/death animations as "special" variants (typically fewer frames or alternate effects). DH2 maps `'death-laser'` to the SF laser-death path (`base+'bg'`).

`LAST_SF_DEATH_ANIM = 63`

### Called Shot (64)

| ID | CE Name                | DH2 anim string     |
|----|------------------------|---------------------|
| 64 | ANIM_CALLED_SHOT_PIC   | `'called-shot'`     |

---

## 4. Weapon Animation Codes

The weapon code field (bits 15–12) selects the armed-variant sprite for a critter. It also drives the FRM filename prefix character.

| Value | CE Name                          | Prefix char | Example FRM prefix |
|-------|----------------------------------|-------------|---------------------|
| 0     | WEAPON_ANIMATION_NONE            | —           | (unarmed: `a`)      |
| 1     | WEAPON_ANIMATION_KNIFE           | `d`         | `*da`               |
| 2     | WEAPON_ANIMATION_CLUB            | `e`         | `*ea`               |
| 3     | WEAPON_ANIMATION_HAMMER          | `f`         | `*fa`               |
| 4     | WEAPON_ANIMATION_SPEAR           | `g`         | `*ga`               |
| 5     | WEAPON_ANIMATION_PISTOL          | `h`         | `*ha`               |
| 6     | WEAPON_ANIMATION_SMG             | `i`         | `*ia`               |
| 7     | WEAPON_ANIMATION_SHOTGUN         | `j`         | `*ja`               |
| 8     | WEAPON_ANIMATION_LASER_RIFLE     | `k`         | `*ka`               |
| 9     | WEAPON_ANIMATION_MINIGUN         | `l`         | `*la`               |
| 10    | WEAPON_ANIMATION_LAUNCHER        | `m`         | `*ma`               |

Source: `WeaponAnimation` enum in `raw/fallout2-ce/src/art.h`; prefix chars from `_art_get_code` in `art.cc:544`.

### FRM Filename Suffix Encoding

CE's `_art_get_code(animation, weaponType, *a3, *a4)` returns two chars that are appended to the critter base name to form the FRM filename. DH2 replicates this directly in `getAnimation()` (`src/object.ts:1591`):

| Animation category                 | a3 (weapon/type char)              | a4 (motion char)            |
|------------------------------------|------------------------------------|-----------------------------|
| STAND (0) / WALK (1), unarmed      | `a`                                | `a` / `b`                   |
| STAND / WALK, armed (weapon≥1)     | `d` + (weaponType-1)               | `a` / `b`                   |
| RUNNING (19)                       | `a`                                | `t`                         |
| DODGE, unarmed                     | `a`                                | `n`                         |
| DODGE, armed                       | `d` + (weaponType-1)               | `e`                         |
| HIT_FROM_FRONT (14)                | `a`                                | `o`                         |
| HIT_FROM_BACK (15)                 | `a`                                | `p`                         |
| Knockdown/death (20–35)            | `b`                                | `a` + (anim-20)             |
| PRONE_TO_STANDING (36)             | `c`                                | `h`                         |
| BACK_TO_STANDING (37)              | `c`                                | `j`                         |
| Weapon anims (38–47)               | `d` + (weaponType-1)               | `c` + (anim-38)             |
| SF death (48–63)                   | `r`                                | `a` + (anim-48)             |
| CALLED_SHOT_PIC (64)               | `n`                                | `a`                         |
| PICK_UP                            | `a`                                | `k`                         |
| USE                                | `a`                                | `l`                         |

The full FRM path is: `art/critters/<base><a3><a4>` — e.g., `art/critters/mchaaaa` is Marcus idle unarmed.

DH2 encodes the same table as literal string concatenations in `getAnimation()` rather than computing it from weaponType at call time. The `skin` variable in that function holds the weapon prefix char (e.g., `'h'` for pistol).

---

## 5. `reg_anim_*` Batch System

### CE Model (`raw/fallout2-ce/src/animation.cc`)

CE maintains a fixed-capacity queue of `AnimationSequence` slots:

- `ANIMATION_SEQUENCE_LIST_CAPACITY = 32` concurrent sequences
- `ANIMATION_DESCRIPTION_LIST_CAPACITY = 55` entries per sequence
- `reg_anim_begin(requestOptions)` — allocates a sequence slot; sets `ANIM_SEQ_ACCUMULATING` flag
- `reg_anim_end()` — commits the sequence for execution; animations chain automatically
- `reg_anim_clear()` — discards the accumulating sequence

Each entry in the sequence is an `AnimationDescription` union tagged by `AnimationKind`. The full 28-kind enum (from `animation.h`):

| Value | AnimationKind constant                    |
|-------|-------------------------------------------|
| 0     | ANIM_KIND_MOVE_TO_OBJECT                  |
| 1     | ANIM_KIND_MOVE_TO_TILE                    |
| 2     | ANIM_KIND_MOVE_TO_TILE_STRAIGHT           |
| 3     | ANIM_KIND_MOVE_TO_TILE_STRAIGHT_AND_WAIT  |
| 4     | ANIM_KIND_ANIMATE                         |
| 5     | ANIM_KIND_ANIMATE_REVERSED               |
| 6     | ANIM_KIND_ANIMATE_AND_HIDE                |
| 7     | ANIM_KIND_ROTATE_TO_TILE                  |
| 8     | ANIM_KIND_ROTATE_STEP                     |
| 9     | ANIM_KIND_HIDE_OBJECT                     |
| 10    | ANIM_KIND_CALLBACK                        |
| 11    | ANIM_KIND_CALLBACK2                       |
| 12    | ANIM_KIND_PING                            |
| 13    | ANIM_KIND_SCENE_INIT                      |
| 14    | ANIM_KIND_SCENE_END                       |
| 15    | ANIM_KIND_TOGGLE_FLAT                     |
| 16    | ANIM_KIND_SET_FID                         |
| 17    | ANIM_KIND_TAKE_OUT_WEAPON                 |
| 18    | ANIM_KIND_SET_LIGHT                       |
| 19    | ANIM_KIND_MOVE_ON_STAIRS                  |
| 20    | ANIM_KIND_CHECK_FALLING                   |
| 21    | ANIM_KIND_TOGGLE_OUTLINE                  |
| 22    | ANIM_KIND_ANIMATE_FOREVER                 |
| 23    | ANIM_KIND_MOVE_TO_TILE_NO_FLAG            |
| 24    | ANIM_KIND_RUN_TO_OBJECT                   |
| 25    | ANIM_KIND_RUN_TO_TILE                     |
| 26    | ANIM_KIND_ANIMATE_AND_DROP                |
| 27    | ANIM_KIND_MOVE_TO_OBJECT_STRAIGHT         |
| 28    | ANIM_KIND_CONTINUE                        |

`AnimationRequestOptions` flags: `UNRESERVED=0x01`, `RESERVED=0x02`, `NO_STAND=0x04`, `PING=0x100`, `INSIGNIFICANT=0x200`

### DH2 Model (`src/scripting.ts`)

DH2 replaces the fixed-capacity CE queue with a simpler `animBatch: AnimEntry[] | null` accumulator:

```typescript
type AnimStep = { kind: 'animate'; obj: Obj; anim: string; delay: number }
type AnimFunc  = { kind: 'func';    fn: () => void }
type AnimEntry = AnimStep | AnimFunc
```

- `reg_anim_begin(_flags)` → `animBatch = []` (flags ignored)
- `reg_anim_clear()` → `animBatch = null`
- `reg_anim_func(obj, fn)` → pushes `AnimFunc` to batch
- `reg_anim_animate(obj, anim, delay)` → pushes `AnimStep` (or calls `singleAnimation` immediately if no batch active)
- `reg_anim_end()` → builds a sequential chain: `doStep(i)` calls `obj.singleAnimation`, passes a callback that calls `doStep(i+1)`, fires all `AnimFunc` entries in order, then calls the terminal callback

`reg_anim_animate_forever(obj, anim)` (`src/scripting.ts:1613`) uses a recursive `singleAnimation` loop outside the batch system.

`reg_anim_obj_move_to_tile(obj, tileNum, delay)` (`src/scripting.ts:1655`) calls `critter.walkTo(tile, false)` and ignores the delay argument.

Rotation and frame-set via `anim(obj, anim, param)` (`src/scripting.ts:1237`): only param values `1000` (set rotation) and `1010` (set frame) are implemented; all others are stubs.

---

## 6. FRM File Format

FRM (FRame Map) is Fallout 2's binary sprite format. DH2 does not parse FRM at runtime; `setup.py` pre-converts all FRMs to PNG sprite sheets with sidecar JSON metadata.

### Binary Header (from `frmpixels.py`)

| Offset | Size | Field             | Notes                               |
|--------|------|-------------------|-------------------------------------|
| 0      | 4    | version           | always 4                            |
| 4      | 2    | fps               | playback rate (frames per second)   |
| 6      | 2    | actionFrame       | frame index where hit/effect fires  |
| 8      | 2    | numFrames         | frames per direction                |
| 10     | 12   | dOffsetX[6]       | per-direction x delta offsets       |
| 22     | 12   | dOffsetY[6]       | per-direction y delta offsets       |
| 34     | 24   | directionPtrs[6]  | byte offsets to each direction's data |
| 58     | 4    | framesBufSize     | total frame data byte count         |

Up to 6 directions; critters use all 6, most other types use 1.

### Per-Frame Data

Each frame in each direction:

| Offset | Size | Field         |
|--------|------|---------------|
| 0      | 2    | width         |
| 2      | 2    | height        |
| 4      | 4    | pixelDataSize |
| 8      | 2    | offsetX       |
| 10     | 2    | offsetY       |
| 12     | N    | pixel bytes (paletted) |

### DH2 Asset Pipeline

`frmpixels.py` combines all directions × frames into one horizontal PNG sprite sheet. All 6 directions appear left-to-right; frames within each direction are concatenated.

`imageMap.json` entry per sprite (loaded into `globalState.imageInfo` at startup in `src/main.ts:562`):

```json
{
  "numFrames":      <frames per direction>,
  "fps":            <playback rate>,
  "numDirections":  <1 or 6>,
  "totalFrames":    <numDirections × numFrames>,
  "frameWidth":     <pixels>,
  "frameHeight":    <pixels>,
  "directionOffsets": [{ "x": n, "y": n }, ...],  // 6 entries
  "frameOffsets": [                                // [direction][frame]
    [{ "w": n, "h": n, "sx": n, "ox": n, "oy": n }, ...]
  ]
}
```

The engine's frame update loop in `src/object.ts` reads `imageInfo[this.art].fps` and `imageInfo[this.art].numFrames` to advance `this.frame` each heartbeat tick, then fires `this.animCallback` on the last frame.

---

## 7. Scripting Opcodes

All animation-related script opcodes, their hex values, CE counterparts, and DH2 status.

| Opcode | CE Function                     | Args | DH2 Method                | Status        |
|--------|---------------------------------|------|---------------------------|---------------|
| 0x8111 | reg_anim_begin                  | 1    | `reg_anim_begin`          | implemented   |
| 0x8112 | reg_anim_end                    | 0    | `reg_anim_end`            | implemented   |
| 0x8113 | reg_anim_clear                  | 0    | `reg_anim_clear`          | implemented   |
| 0x810E | reg_anim_func                   | 2    | `reg_anim_func`           | implemented   |
| 0x810F | reg_anim_animate                | 3    | `reg_anim_animate`        | implemented   |
| 0x8110 | reg_anim_obj_move_to_tile       | 3    | `reg_anim_obj_move_to_tile` | partial (delay ignored) |
| 0x8126 | reg_anim_animate_forever        | 2    | `reg_anim_animate_forever`| implemented   |
| 0x80E7 | anim_busy                       | 1    | `anim_busy`               | implemented   |
| 0x810C | anim                            | 3    | `anim`                    | partial (1000/1010 only) |
| 0x80E3 | set_obj_visibility              | 2    | `set_obj_visibility`      | implemented   |
| 0x80CE | animate_move_obj_to_tile        | 3    | (vm_bridge stub)          | stub          |
| 0x80A3 | play_sfx                        | 1    | `play_sfx`                | implemented   |
| 0x8136 | gfade_out                       | 1    | `gfade_out`               | implemented (CSS) |
| 0x8137 | gfade_in                        | 1    | `gfade_in`                | implemented (CSS) |
| —      | reg_anim_animate_and_hide       | —    | —                         | **missing**   |
| —      | reg_anim_obj_run_to_tile        | —    | —                         | **missing**   |
| —      | reg_anim_obj_move_to_obj        | —    | —                         | **missing**   |
| —      | reg_anim_obj_run_to_obj         | —    | —                         | **missing**   |

`0x810E` (`reg_anim_func`) is handled by a custom inline wrapper in `src/vm_bridge.ts` rather than `bridged()` — it converts a script proc address to a callable JS function before pushing to the batch.

`gfade_out` / `gfade_in` are implemented via a CSS `black` overlay div with an `opacity` transition, not a WebGL render pass.

---

## 8. Known Gaps vs CE

| Gap | CE Reference | DH2 Status |
|-----|-------------|------------|
| `reg_anim_animate_and_hide` — animate then hide object | `animation.cc`, ANIM_KIND_ANIMATE_AND_HIDE | not wired, no opcode |
| `reg_anim_obj_run_to_tile` — run (not walk) to tile | `animation.cc`, ANIM_KIND_RUN_TO_TILE | not wired, no opcode |
| `reg_anim_obj_move_to_obj` — move to another object's tile | `animation.cc`, ANIM_KIND_MOVE_TO_OBJECT | not wired |
| `reg_anim_obj_run_to_obj` — run to another object's tile | `animation.cc`, ANIM_KIND_RUN_TO_OBJECT | not wired |
| `anim()` param dispatch | CE handles all AnimationType values | only 1000 (rotation) and 1010 (frame) implemented; all other param values are stub |
| `animate_move_obj_to_tile` (0x80CE) | CE animate + move combo | wired in vm_bridge but no implementation body |
| Weapon-code-aware STAND/WALK paths | CE selects armed/unarmed FRM based on equipped weapon | DH2 `getAnimation()` uses a static `skin` field; runtime weapon-swap updates `skin` manually via `playWeaponSwapAnim` |
| Rotation field in FID | CE stores facing in bits 29-28 for death anims | DH2 stores facing on `obj.orientation`; FID rotation bits not used at render time |
| CE animation sequence capacity | 32 concurrent sequences, 55 descriptions each | DH2 supports one active batch at a time (single `animBatch` array) |
| Direction-indexed FRM lookup | CE selects one of 6 direction strips based on `obj.rotation` | DH2 WebGL renderer selects the strip based on `obj.orientation` using `directionOffsets` from imageMap |
| SF death animations (IDs 48–63) | Full set mapped to unique FRM suffixes `ra`–`rp` | DH2 only maps `death-laser` → `bg` (one SF variant); others fall back to regular death or are absent |
| All 28 `AnimationKind` values | Full batch kind set in CE | DH2 batch only handles `animate` and `func` kinds |
| `AnimationRequestOptions` flags | UNRESERVED/RESERVED/NO_STAND/PING/INSIGNIFICANT | all flags silently ignored in `reg_anim_begin` |
