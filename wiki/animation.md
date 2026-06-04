# Animation

Reference doc for the Fallout 2 animation system as implemented in DarkHarold2.  
Covers FRM binary format, FID/animation ID encoding, the `reg_anim_*` batch system, palette cycling, and DH2 implementation status.

> **Source anchor:** `raw/fallout2-ce/src/art.cc`, `art.h`, `animation.cc`, `animation.h`, `obj_types.h`, `cycle.cc`, `object.cc`  
> **DH2 files:** `src/object.ts`, `src/scripting.ts`, `src/vm_bridge.ts`, `src/renderer.ts`, `frmpixels.py` (pipeline)  
> **Last audited:** 2026-06-03

---

## 1. FRM Binary Format

All sprite art in Fallout 2 is stored in `.frm` (FRaMe) files. Each file holds up to six directional animations packed into a single binary stream. The Python extractor `frmpixels.py` reads this format and bakes it into the `art/imageMap.json` atlas manifest consumed at runtime. DH2 does not parse FRM at runtime.

### 1.1 File Header (62 bytes)

```
Offset  Size  Type        Field
0       4     uint32 BE   version        (always 4)
4       2     uint16 BE   fps            (0 = default 10 fps)
6       2     uint16 BE   actionFrame    (key frame index, e.g. hit / muzzle flash)
8       2     uint16 BE   numFrames      (frames per direction)
10      12    int16[6]    xOffsets       (per-direction pixel offset X, header-level)
22      12    int16[6]    yOffsets       (per-direction pixel offset Y, header-level)
34      24    uint32[6]   dataOffsets    (byte offset of each direction's frame block)
58      4     uint32 BE   dataSize       (total size of all frame data)
```

CE reference: `artReadHeader()` in `art.cc`; struct declared in `art.h`.

If two direction slots share the same `dataOffsets` value, they share the same frame data — used for items and scenery that only have a single facing (direction 0 duplicated into all 6 slots).

### 1.2 Per-Frame Record (ArtFrame)

Immediately after the header, each direction's block contains `numFrames` consecutive records:

```
Offset  Size  Type        Field
0       2     uint16 BE   width
2       2     uint16 BE   height
4       4     uint32 BE   size           (width × height)
8       2     int16 BE    x              (delta X relative to previous frame)
10      2     int16 BE    y              (delta Y relative to previous frame)
12      size  uint8[]     pixels         (palette indices, row-major)
```

CE reference: `artReadFrameData()` in `art.cc`; `ArtFrame` struct in `art.h`.

**Critical:** `ArtFrame.x` and `ArtFrame.y` are **per-frame deltas**, not absolute positions. Frame 0's delta is relative to the object's tile anchor; subsequent frames are relative to the previous frame. The CE engine accumulates these into `obj->x`/`obj->y` sub-tile pixel offsets each time a frame advances (see §5).

### 1.3 actionFrame

`actionFrame` marks the frame where the key game event fires — the moment of impact for weapon attacks, muzzle-flash start, etc. CE uses this to synchronise hit-detection and sound with the correct animation frame (`art.cc:713`). DH2's pipeline discards this field (see gap AN3 in §9).

---

## 2. Direction Layout

The six direction slots map to the `Rotation` enum from `obj_types.h`:

| Index | CE name      | Compass direction |
|-------|-------------|-------------------|
| 0     | ROTATION_NE | North-east        |
| 1     | ROTATION_E  | East              |
| 2     | ROTATION_SE | South-east        |
| 3     | ROTATION_SW | South-west        |
| 4     | ROTATION_W  | West              |
| 5     | ROTATION_NW | North-west        |

Items, walls, and most scenery objects contain only direction 0 data; the engine uses `buildFid()` to fall back to ROTATION_NE for anything that isn't a critter or weapon-take-out animation (`art.cc`). Up to 6 directions are present for critters; most other types use 1.

`frmpixels.py` detects the actual direction count with:

```python
nDirTotal = 1 + sum(1 for x in directionPtrs if x != directionPtrs[0])
```

(direction 0 is always present; each distinct non-zero `dataOffset` counts as an additional direction.)

---

## 3. FPS and Tick Rate

### CE

```cpp
// art.cc:713
int artGetFramesPerSecond(Art* art) {
    return art->framesPerSecond == 0 ? 10 : art->framesPerSecond;
}
```

The timer check in `_anim_animate` / `_object_animate` (`animation.cc:2757`):

```cpp
if (getTicksBetween(now, sad->animationTimestamp) < sad->ticksPerFrame) return;
```

`sad->ticksPerFrame` is computed by `animationComputeTicksPerFrame` (`animation.cc:3287`):

```cpp
return 1000 / fps;   // + combat_speed bonus for ANIM_WALK in combat
```

So a 10 fps animation advances one frame every 100 ms of wall clock. Combat walk gains an extra speed bonus configurable via the `combat_speed` preference.

### DH2

`Obj.updateAnim()` (`object.ts:524`) mirrors CE:

```typescript
const fps = imageInfo.fps === 0 ? 10 : imageInfo.fps
if (time - this.lastFrameTime >= 1000 / fps) {
    // advance frame
    this.lastFrameTime = time
}
```

`Critter.updateStaticAnim()` (`object.ts:1333`) **hardcodes fps = 8** — see gap AN1 in §9.

---

## 4. imageMap.json — DH2 Pre-baked Atlas Manifest

`frmpixels.py exportFRM()` bakes each FRM into a PNG sprite-sheet and writes a metadata entry into `art/imageMap.json`. The engine's frame update loop in `src/object.ts` reads `imageInfo[this.art].fps` and `imageInfo[this.art].numFrames` to advance `this.frame` each heartbeat tick, then fires `this.animCallback` on the last frame. The manifest is loaded into `globalState.imageInfo` at startup in `src/main.ts:562`.

Key fields:

```json
{
  "numFrames": N,
  "fps": fps,
  "numDirections": D,
  "totalFrames": N * D,
  "frameWidth": maxW,
  "frameHeight": maxH,
  "directionOffsets": [{"x": dx, "y": dy}, ...],
  "frameOffsets": [
    [
      {
        "x":  <per-frame delta X (raw ArtFrame.x)>,
        "y":  <per-frame delta Y (raw ArtFrame.y)>,
        "w":  <frame pixel width>,
        "h":  <frame pixel height>,
        "sx": <x position in sprite atlas>,
        "ox": <cumulative X = sum of all deltas frame 0..N>,
        "oy": <cumulative Y = sum of all deltas frame 0..N>
      },
      ...
    ],
    ...
  ]
}
```

`ox`/`oy` are the **running sum** of all `ArtFrame.x`/`y` values from frame 0 up to and including frame N. This means `frameOffsets[d][N].ox` equals the total horizontal drift across the entire animation.

`directionOffsets` maps directly from the FRM header's `xOffsets[6]`/`yOffsets[6]` arrays (header-level per-direction offsets, distinct from per-frame deltas).

### 4.1 Renderer Usage

`src/renderer.ts` (around line 311):

```typescript
const frameInfo = info.frameOffsets[obj.orientation][obj.frame]
// info.frameWidth = maxW across all frames (uniform atlas slot width)
// CE: artGetFrameWidth(art, dir) — series max, not per-frame
let offsetX = -(info.frameWidth / 2 | 0) + dirOffset.x
let offsetY = -frameInfo.h + dirOffset.y

if (obj.shift !== null) {
    // Walk mode: shift accumulates per-frame deltas at runtime.
    offsetX += obj.shift.x
    offsetY += obj.shift.y
} else {
    // Static / one-shot: pre-baked cumulative ox/oy plus artOffset carry from art transitions.
    offsetX += frameInfo.ox + obj.artOffset.x
    offsetY += frameInfo.oy + obj.artOffset.y
}
```

Three render contributions for static animations:

- **`dirOffset`** — FRM header `xOffsets[direction]`/`yOffsets[direction]`.
- **`frameInfo.ox` / `frameInfo.oy`** — pre-baked cumulative per-frame deltas (sum of `ArtFrame.x`/`y` from frame 0 to N).
- **`obj.artOffset`** — carry-offset accumulated across FRM art transitions (see §4.2).

### 4.2 Art Transition Offset Model — CE vs DH2

#### The Problem

Each FRM file has per-direction `xOffsets[6]`/`yOffsets[6]` header values (the `directionOffsets` in `imageMap.json`). These values differ between FRM files. When a critter switches FRMs (e.g. idle `hanpwraa` → weapon-draw `hanpwrjc`), the renderer immediately uses the new FRM's `dirOffset`, which differs from the old one. Without compensation this causes a visible sprite jump on the first rendered frame after the switch.

However `dirOffset` alone is not the only source of jump — there are three contributing factors:

1. **`directionOffset` change** — e.g. `hanpwraa` dir0 y=5, `hanpwrjc` dir0 y=0.
2. **Per-frame ox state at the transition moment** — the idle animation's `ox` is non-zero for many frames (e.g. `hanpwraa` dir0 frames 2–10 have `ox=1`). Ignoring this causes a 2 px x jump if the player triggers a weapon draw mid-idle-cycle.
3. **Frame-width center-anchor change** — x is anchored at `-(w/2 | 0)`. Different FRMs have different frame widths; for dir4 (West), `hanpwraa` f0 w=23 vs `hanpwrjc` f0 w=34 — a 6 px anchor shift.

#### CE's Mechanism

CE (`animation.cc ~2886`) does at every art transition:

```c
artGetRotationOffsets(OLD_art, rotation, &x, &y);       // OLD directionOffsets
artGetFrameOffsets(NEW_art, frame=0, rotation, &dx, &dy); // NEW frame-0 RAW delta
_obj_offset(object, x + dx, y + dy, &rect);              // ADDITIVE to obj->x/y
```

`_obj_offset` is additive: `obj->x += OLD_xOffsets + NEW_frame0.rawDelta`. The renderer then draws at `screenX = tileX + NEW_xOffsets + obj->x - frameW/2`. The raw delta at frame 0 equals the cumulative `ox[0]`, so CE's transition naturally encodes all three corrections into a single running accumulator.

#### DH2's artOffset Carry-Field

DH2 pre-bakes cumulative `ox`/`oy` into `imageMap.json`. To achieve the same visual result, `Obj` holds:

```typescript
artOffset: Point = { x: 0, y: 0 }
```

At every art transition (`Critter.staticAnimation` and `Critter.clearAnim`), computed **synchronously before `lazyLoadImage`** (imageInfo is always available at startup):

```typescript
// Exact zero-jump formula
const oldF    = oldInfo.frameOffsets[orient][oldFrame]   // clamped to valid range
const newF0   = newInfo.frameOffsets[orient][newStartFrame]
const oldMaxW = oldInfo.frameWidth   // series max width (uniform atlas slot)
const newMaxW = newInfo.frameWidth
this.artOffset = {
    x: Math.floor(newMaxW / 2) - Math.floor(oldMaxW / 2)
       + oldDirOff.x - newDirOff.x + oldF.ox - newF0.ox + prevArtOffset.x,
    y: (newF0.h - oldF.h) + oldDirOff.y - newDirOff.y + oldF.oy - newF0.oy + prevArtOffset.y,
}
```

The x formula uses **series max width** (`info.frameWidth`) for both old and new, matching CE's `artGetFrameWidth()`. This is critical for K_cycle stability: the width terms telescope to exactly zero over a full weapon-swap cycle regardless of which frames happen to be active at each transition. Using per-frame width (`f0.w`) breaks the telescoping when frame-0 and last-frame widths differ within an animation.

The y formula uses per-frame height (`newF0.h - srcF.h`) because the bottom-edge anchor (`tileY - h`) means height differences directly shift the visual foot position; a matching correction is needed.

#### Correctness Proof (dir0, idle frame 0 → rifle draw, hanpwr)

| Quantity | Value |
|----------|-------|
| `hanpwraa` dir0 `dirOffset` | `{x:-1, y:5}` |
| `hanpwrjc` dir0 `dirOffset` | `{x:0, y:0}` |
| `hanpwraa.frameWidth` (series max) | 42 |
| `hanpwrjc.frameWidth` (series max) | 42 |
| idle f0: h=60, ox=0, oy=0 | |
| draw f0: h=60, ox=1, oy=0 | |

`artOffset.x = floor(42/2) − floor(42/2) + (−1) − 0 + 0 − 1 = 0−0−1−1 = **−2**`  
`artOffset.y = (60−60) + 5 − 0 + 0 − 0 = **5**`

Pre-transition renderer: `−(42/2) + (−1) + 0 + 0 = −22`  
Post-transition renderer: `−(42/2) + 0 + 1 + (−2) = −22` ✓ **Zero jump**

(If both FRMs share the same series max width, the width term is 0 and artOffset.x is purely driven by dirOff + ox differences.)

#### artOffset After Walk

`Critter.clearAnim()` resets `artOffset = {0,0}` when the previous animation was a walk (`shift !== null`). This matches CE's `objectSetLocation` reset in `object.cc:3940`. After any walk, the carry state is clean.

#### K_cycle Stability

With series-max widths, the width terms telescope over a full weapon-swap cycle:
```
(floor(newMaxW₂/2) − floor(oldMaxW₁/2)) + … + (floor(oldMaxW₁/2) − floor(newMaxW₄/2)) = 0
```

Any remaining K_cycle drift comes only from `ox + dirOff` residuals in the FRM data (a property of how the original FO2 artists drew each FRM set). This residual matches CE's own accumulation and is reset by any subsequent walk.

---

## 5. Frame Sequencing and Sub-tile Offset Accumulation

### 5.1 CE Frame Advance

`objectSetNextFrame` (`object.cc:1578`):

```cpp
int nextFrame = obj->frame + 1;
if (nextFrame >= art->frameCount) nextFrame = 0;
obj->frame = nextFrame;
```

After advancing, `_object_animate` calls:

```cpp
artGetFrameOffsets(art, obj->frame, obj->rotation, &frameX, &frameY);
_obj_offset(obj, frameX, frameY, &rect);
```

`_obj_offset` adds `frameX`/`frameY` to `obj->x`/`obj->y`, which are sub-tile pixel offsets used by the renderer to position the sprite within its tile cell.

### 5.2 CE Sub-tile Offset Reset

The sub-tile offsets are only reset when an object crosses a tile boundary:

```cpp
// object.cc:3940 (_obj_connect_to_tile)
obj->x = 0;
obj->y = 0;
```

This is called from `objectSetLocation()` (tile-move), **not** from `objectSetNextFrame()`. For a looping idle animation (`ANIM_SAD_FOREVER`), the offsets therefore **accumulate continuously** — they are never zeroed at the loop wrap point. Whether this is intentional or a CE quirk is unclear; in practice most idle FRMs have net-zero cumulative offset (the walk-cycle offsets cancel out), so no visible drift occurs.

### 5.3 DH2 Frame Advance

`Obj.updateAnim()` (`object.ts:524`) for one-shot (single/reverse) animations:

```typescript
if (this.anim === 'reverse') this.frame--
else this.frame++
if (this.frame === -1 || this.frame === imageInfo.numFrames) {
    // clamp at final frame and call animCallback — does NOT loop
}
```

`Critter.updateLoopingAnim()` (`object.ts:1362`) for idle loop:

```typescript
if (this.frame >= numFrames) {
    this.frame = 0   // explicit reset to 0 at loop boundary
    // random 3–10 s pause before next cycle
}
```

DH2 resets `frame = 0` explicitly, so any sub-tile offset accumulated inside the loop **is lost** at the wrap, whereas CE never resets it. In practice this only matters if the sprite's ox/oy values don't cancel across the full animation cycle.

### 5.4 Loop Continuity — CE vs DH2

| Aspect | CE behaviour | DH2 behaviour |
|--------|-------------|---------------|
| Sub-tile offsets during loop | Accumulate continuously; no reset at wrap | `Critter.updateLoopingAnim` resets `frame=0`; renderer re-reads `frameInfo.ox` from scratch |
| Reset mechanism | Only `_obj_connect_to_tile` (tile crossing) | Implicit: static path reads `ox` for frame 0 = first delta only |
| Walk cycle reset | `shift={0,0}` + `move(nextHex)` at each partial action | Same logic — equivalent |
| Visible hitching risk | Low (FRM data net-zero by convention) | Same — but AN2 wrong hex-distance calc can cause early/late partial-action boundaries |

For idle animations the practical result is equivalent; hitching is more likely to originate from the wrong partial-action boundary calculation (AN2) than from offset accumulation.

---

## 6. FID Structure

Every renderable object has a **Frame ID (FID)** — a 32-bit integer that encodes all the information needed to locate its sprite file.

### 6.1 Bit Layout

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

### 6.2 CE Macros

```c
// raw/fallout2-ce/src/obj_types.h
#define FID_TYPE(value)      (((value) & 0xF000000) >> 24)

// raw/fallout2-ce/src/art.h
#define FID_ANIM_TYPE(value) (((value) & 0xFF0000) >> 16)
```

`buildFid(objectType, frmId, animType, weaponCode, rotation)` is the public CE wrapper (declared `art.h`, defined `art.cc:1015`). It falls back to rotation 0 for non-death animations.

### 6.3 DH2 Equivalent

DH2 does not construct FIDs at runtime for rendering. The FID is stored on each object as `obj.frmPID` (set during map load from `.json` proto data). Scripting opcodes read it with `obj_art_fid` / `art_anim`:

```typescript
// src/scripting.ts
obj_art_fid(obj): number  { return obj.frmPID ?? 0 }
art_anim(fid): number     { return (fid >>> 16) & 0xFF }  // extracts animType field
```

Animation path resolution uses the object's base `art` string, not a reconstructed FID. See §7 (Weapon Animation Codes) for how DH2 maps anim strings → FRM paths.

---

## 7. Object Types

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

## 8. Animation IDs

The `AnimationType` enum is defined in `raw/fallout2-ce/src/animation.h`. There are 65 values (0–64).

### 8.1 Basic Locomotion (0–19)

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

### 8.2 Knockdown and Death (20–35) — `FIRST_KNOCKDOWN_AND_DEATH_ANIM = 20`

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

### 8.3 Position Change (36–37)

| ID | CE Name                 | DH2 anim string   |
|----|-------------------------|-------------------|
| 36 | ANIM_PRONE_TO_STANDING  | `'getUpFront'`    |
| 37 | ANIM_BACK_TO_STANDING   | `'getUpBack'`     |

### 8.4 Weapon Animations (38–47)

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

### 8.5 SF Death Sequences (48–63) — `FIRST_SF_DEATH_ANIM = 48`

IDs 48–63 mirror the 16 knockdown/death animations as "special" variants (typically fewer frames or alternate effects). DH2 maps `'death-laser'` to the SF laser-death path (`base+'bg'`).

`LAST_SF_DEATH_ANIM = 63`

### 8.6 Called Shot (64)

| ID | CE Name                | DH2 anim string     |
|----|------------------------|---------------------|
| 64 | ANIM_CALLED_SHOT_PIC   | `'called-shot'`     |

---

## 9. Weapon Animation Codes

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

### 9.1 FRM Filename Suffix Encoding

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

## 10. `reg_anim_*` Batch System

### 10.1 CE Model (`raw/fallout2-ce/src/animation.cc`)

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

### 10.2 DH2 Model (`src/scripting.ts`)

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

## 11. Scripting Opcodes

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

## 12. Palette Cycling (`cycle.cc`)

> **Source anchor:** `raw/fallout2-ce/src/cycle.cc` (`colorCycleTicker`, `cycleSetSpeedFactor`, `cycleInit`)

### 12.1 Overview

CE animates certain palette regions at runtime by rotating a block of palette entries each tick. This produces the distinctive animated water, fire, and terminal-monitor effects without any per-object animation data — the palette itself changes, and every pixel referencing those indices appears to move.

Palette cycling is gated by `settings.system.color_cycling` in `fallout2.cfg`. If disabled, all cycling groups remain static.

### 12.2 Color Groups

Five named groups are cycled independently:

| Group | Palette entries | Byte span | Update tier |
|-------|----------------|-----------|-------------|
| `slime` | 4 entries | 12 bytes | slow (5 Hz) |
| `shoreline` | 6 entries | 18 bytes | medium (7 Hz) |
| `fire_slow` | 5 entries | 15 bytes | slow (5 Hz) |
| `fire_fast` | 5 entries | 15 bytes | fast (10 Hz) |
| `monitors` | 5 entries | 15 bytes | very_fast (30 Hz) |

Each group advances in round-robin fashion: the first entry rotates to the last position (or vice versa) at each update interval.

### 12.3 Speed Tiers

| Tier | Frequency | Period (ms) |
|------|-----------|-------------|
| slow | 5 Hz | 200 |
| medium | 7 Hz | ~143 |
| fast | 10 Hz | 100 |
| very_fast | 30 Hz | ~33 |

`cycleSetSpeedFactor(n)` multiplies all period lengths by `n`, stored in `settings.system.cycle_speed_factor`. A value of 1 is normal speed; higher values slow all cycling groups proportionally.

### 12.4 CE Ticker Integration

CE calls `tickersAdd(colorCycleTicker)` during init (`cycle.cc:cycleInit`). The ticker is invoked every frame by the main loop's ticker dispatch. Each call checks elapsed time per group and rotates its palette slice if the period has elapsed.

Because the effect is palette-level, it applies to every FRM sprite on screen simultaneously — a single palette write animates all water tiles, all fire tiles, and all active terminal monitors at once.

### 12.5 DH2 Status — NOT IMPLEMENTED

DH2 uses pre-baked PNG sprites extracted from FRM data via the Python pipeline. Palette indices are resolved to RGBA at extraction time; there is no runtime palette table. Palette cycling therefore has no equivalent mechanism in DH2.

| Item | Status |
|------|--------|
| `color_cycling` ini flag | Not read by DH2 |
| `cycle_speed_factor` ini flag | Not read by DH2 |
| `colorCycleTicker` | No DH2 equivalent; no `tickersAdd` system |
| Animated water (shoreline/slime groups) | Shows static frame only |
| Animated fire (fire_slow / fire_fast groups) | Shows static frame only |
| Animated terminals (monitors group) | Shows static frame only |

Implementing palette cycling in DH2 would require either (a) baking multiple pre-rotated PNG frames for each cycling group and animating them as a texture sequence in the WebGL renderer, or (b) passing palette-index textures to the GPU and performing the rotation in the fragment shader each frame. Neither approach is currently planned.

---

## 13. Known Gaps vs CE

| ID  | Description | File(s) | CE Reference | Sev | Status |
|-----|-------------|---------|--------------|-----|--------|
| AN1 | **`updateStaticAnim` hardcodes fps = 8.** Comment reads `// todo: get FPS from image info`. Should read `info.fps \|\| 10` like `updateLoopingAnim`. Scenery such as flowing water or fire plays at the wrong speed. | `object.ts:1335` | `art.cc:713 artGetFramesPerSecond()` | minor | bug |
| AN2 | **`getAnimDistance` reads direction 1 for the last frame.** `frameOffsets[1][numFrames-1].ox` uses direction E instead of direction 0 (NE). Returns wrong hex-steps-per-walk-cycle, causing partial-action boundaries to be off and walk animation to hitch or overshoot. | `object.ts:1980` | `animation.cc:1716` | major | bug |
| AN3 | **`actionFrame` discarded by the extraction pipeline.** `frmpixels.py:40` reads the field into `_actionFrame` (leading underscore = not saved). It is absent from `imageMap.json`. DH2 cannot synchronise hit-detection or sound to the correct animation frame for weapon attacks. | `frmpixels.py:40` | `art.h ArtFrame.actionFrame`, `animation.cc` | major | missing |
| AN4 | **No combat walk speed bonus.** CE's `animationComputeTicksPerFrame` adds the `combat_speed` preference to ANIM_WALK in combat. DH2 uses a fixed `1000/fps` for all animations. | `object.ts:1395` | `animation.cc:3287 animationComputeTicksPerFrame()` | minor | missing |
| AN5 | **`obj.shift = {x:0, y:0}` is truthy at walk start; frame 0's static ox/oy is skipped.** At the beginning of a walk cycle, `shift` is set to `{x:0,y:0}` — a truthy object. The renderer therefore takes the shift path and adds `+0`, while the correct static offset for frame 0 would be `frameInfo.ox`. For most walk FRMs `ox` at frame 0 is zero so the effect is invisible, but any FRM where frame 0 has a non-zero initial delta will display one frame off-anchor. | `renderer.ts:311`, `object.ts:1417` | `object.cc _obj_offset()` | low | bug |
| AN6 | **FID composition / weapon stance animation not implemented for NPC critters.** CE builds a Frame Identifier via `buildFid(objectType, animType, weaponAnimCode, direction, rotation)` (`art.cc`), where `weaponAnimCode` selects the critter's armed-pose FRM set (0=unarmed, 1=pistol, 3=rifle, 4=big gun, etc.). DH2 has no `buildFid` equivalent — critter FRM paths come from a static `skin` string. The player's `skin` is updated at weapon-swap time via `playWeaponSwapAnim`, but NPC critters on a map never have their skin recalculated from their held weapon; they always display unarmed animations. Full detail: §9 (Weapon Animation Codes). | `src/object.ts`; `src/renderer.ts` | `art.cc buildFid()`; `art.h ART_TYPE_CRITTER`; `proto_types.h ItemWeaponData.animCode` | medium | missing |
| AN7 | **`reg_anim_animate_and_hide` — animate then hide object.** Not wired; no opcode entry. | `animation.cc` | ANIM_KIND_ANIMATE_AND_HIDE | medium | missing |
| AN8 | **`reg_anim_obj_run_to_tile` — run (not walk) to tile.** Not wired; no opcode entry. | `animation.cc` | ANIM_KIND_RUN_TO_TILE | medium | missing |
| AN9 | **`reg_anim_obj_move_to_obj` — move to another object's tile.** Not wired. | `animation.cc` | ANIM_KIND_MOVE_TO_OBJECT | medium | missing |
| AN10 | **`reg_anim_obj_run_to_obj` — run to another object's tile.** Not wired. | `animation.cc` | ANIM_KIND_RUN_TO_OBJECT | medium | missing |
| AN11 | **`anim()` param dispatch incomplete.** CE handles all `AnimationType` values; DH2 only implements param values `1000` (rotation) and `1010` (frame). All other param values are stubs. | `src/scripting.ts:1237` | `animation.cc` | minor | partial |
| AN12 | **`animate_move_obj_to_tile` (0x80CE) unimplemented.** Wired in `vm_bridge` but has no implementation body. | `src/vm_bridge.ts` | CE animate + move combo | minor | stub |
| AN13 | **Rotation field in FID unused at render time.** CE stores facing in bits 29-28 for death anims. DH2 stores facing on `obj.orientation`; FID rotation bits are not used at render time. | `src/object.ts`, `src/renderer.ts` | `art.cc buildFid()`, `obj_types.h` | low | deviation |
| AN14 | **CE animation sequence capacity not replicated.** CE supports 32 concurrent sequences with 55 descriptions each. DH2 supports one active batch at a time (single `animBatch` array). | `src/scripting.ts` | `animation.cc` ANIMATION_SEQUENCE_LIST_CAPACITY | low | deviation |
| AN15 | **SF death animations (IDs 48–63) mostly absent.** CE maps all 16 to unique FRM suffixes `ra`–`rp`. DH2 only maps `death-laser` → `bg`; others fall back to regular death or are absent. | `src/object.ts` | `animation.h` FIRST_SF_DEATH_ANIM | medium | missing |
| AN16 | **All 28 `AnimationKind` values not handled.** DH2 batch system only processes `animate` and `func` kinds. | `src/scripting.ts` | `animation.h AnimationKind` | medium | missing |
| AN17 | **`AnimationRequestOptions` flags silently ignored.** UNRESERVED, RESERVED, NO_STAND, PING, INSIGNIFICANT are all discarded in `reg_anim_begin`. | `src/scripting.ts` | `animation.h AnimationRequestOptions` | low | missing |
| AN18 | **Palette cycling not implemented.** CE's `colorCycleTicker` rotates palette ranges to animate water, fire, and terminals. DH2 has no runtime palette system; all such objects display static frames only. | `src/renderer.ts` | `cycle.cc colorCycleTicker`, `cycleInit` | medium | missing |

<!-- audited: 2026-06-02 -->
