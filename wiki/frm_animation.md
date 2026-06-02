# FRM Animation Pipeline

> **Source anchor:** `raw/fallout2-ce/src/art.cc`, `art.h`, `animation.cc`, `animation.h`
> **DH2 files:** `src/object.ts`, `src/renderer.ts`, `frmpixels.py` (pipeline)
> **Last audited:** 2026-06-02

---

## 1. FRM Binary Format

All sprite art in Fallout 2 is stored in `.frm` (FRaMe) files. Each file holds up to six directional animations packed into a single binary stream. The Python extractor `frmpixels.py` reads this format and bakes it into the `art/imageMap.json` atlas manifest consumed at runtime.

### 1.1 File Header (40 bytes)

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

**Critical:** `ArtFrame.x` and `ArtFrame.y` are **per-frame deltas**, not absolute positions. Frame 0's delta is relative to the object's tile anchor; subsequent frames are relative to the previous frame. The CE engine accumulates these into `obj->x`/`obj->y` sub-tile pixel offsets each time a frame advances (see §4).

### 1.3 actionFrame

`actionFrame` marks the frame where the key game event fires — the moment of impact for weapon attacks, muzzle-flash start, etc. CE uses this to synchronise hit-detection and sound with the correct animation frame (`art.cc:713`). DH2's pipeline **discards** this field (see gap FA3 in §6).

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

Items, walls, and most scenery objects contain only direction 0 data; the engine uses `buildFid()` to fall back to ROTATION_NE for anything that isn't a critter or weapon-take-out animation (`art.cc`).

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

`Critter.updateStaticAnim()` (`object.ts:1333`) **hardcodes fps = 8** — see gap FA1 in §6.

---

## 4. Frame Sequencing and Sub-tile Offset Accumulation

### 4.1 CE Frame Advance

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

### 4.2 CE Sub-tile Offset Reset

The sub-tile offsets are only reset when an object crosses a tile boundary:

```cpp
// object.cc:3940 (_obj_connect_to_tile)
obj->x = 0;
obj->y = 0;
```

This is called from `objectSetLocation()` (tile-move), **not** from `objectSetNextFrame()`. For a looping idle animation (`ANIM_SAD_FOREVER`), the offsets therefore **accumulate continuously** — they are never zeroed at the loop wrap point. Whether this is intentional or a CE quirk is unclear; in practice most idle FRMs have net-zero cumulative offset (the walk-cycle offsets cancel out), so no visible drift occurs.

### 4.3 DH2 Frame Advance

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

---

## 5. imageMap.json — DH2 Pre-baked Atlas Manifest

`frmpixels.py exportFRM()` bakes each FRM into a PNG sprite-sheet and writes a metadata entry into `art/imageMap.json`. Key fields consumed by `src/renderer.ts`:

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

### 5.1 Renderer Usage

`src/renderer.ts` (around line 311):

```typescript
const frameInfo = info.frameOffsets[obj.orientation][obj.frame]
let offsetX = -(frameInfo.w / 2) + dirOffset.x
let offsetY = -frameInfo.h + dirOffset.y

if (obj.shift) {
    // Walk mode: per-frame deltas accumulated at runtime by Critter.updateAnim()
    offsetX += obj.shift.x
    offsetY += obj.shift.y
} else {
    // Static / one-shot: use the pre-baked cumulative offset for the current frame
    offsetX += frameInfo.ox
    offsetY += frameInfo.oy
}
```

Two code paths:

- **`obj.shift` present** — critter walk: shift accumulates `frameInfo.x` each frame and resets to `{0,0}` at each hex-step boundary.
- **`obj.shift` absent** — all other objects (idle, one-shot, scenery): use the pre-baked `ox`/`oy` for the requested frame directly.

---

## 6. Loop Continuity — CE vs DH2

A "perfect loop" requires the last frame's trailing sub-tile offset to match the first frame's initial offset so the sprite returns exactly to its anchor between cycles. In CE this is guaranteed only by the FRM data having net-zero cumulative deltas. In DH2 it depends on the same condition, with a subtle asymmetry:

| Aspect | CE behaviour | DH2 behaviour |
|--------|-------------|---------------|
| Sub-tile offsets during loop | Accumulate continuously; no reset at wrap | `Critter.updateLoopingAnim` resets `frame=0`; renderer re-reads `frameInfo.ox` from scratch |
| Reset mechanism | Only `_obj_connect_to_tile` (tile crossing) | Implicit: static path reads `ox` for frame 0 = first delta only |
| Walk cycle reset | `shift={0,0}` + `move(nextHex)` at each partial action | Same logic — equivalent |
| Visible hitching risk | Low (FRM data net-zero by convention) | Same — but FA2 wrong hex-distance calc can cause early/late partial-action boundaries |

For idle animations the practical result is equivalent; hitching is more likely to originate from the wrong partial-action boundary calculation (FA2) than from offset accumulation.

---

## 7. Known Gaps

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| FA1 | **`updateStaticAnim` hardcodes fps = 8.** Comment reads `// todo: get FPS from image info`. Should read `info.fps \|\| 10` like `updateLoopingAnim`. Scenery such as flowing water or fire plays at the wrong speed. | `object.ts:1335` | `art.cc:713 artGetFramesPerSecond()` | minor | bug |
| FA2 | **`getAnimDistance` reads direction 1 for the last frame.** `frameOffsets[1][numFrames-1].ox` uses direction E instead of direction 0 (NE). Returns wrong hex-steps-per-walk-cycle, causing the partial-action boundaries to be off and walk animation to hitch or overshoot. | `object.ts:1980` | `animation.cc:1716` | major | bug |
| FA3 | **`actionFrame` discarded by the extraction pipeline.** `frmpixels.py:40` reads the field into `_actionFrame` (leading underscore = not saved). It is absent from `imageMap.json`. DH2 cannot synchronise hit-detection or sound to the correct animation frame for weapon attacks. | `frmpixels.py:40` | `art.h ArtFrame.actionFrame`, `animation.cc` | major | missing |
| FA4 | **No combat walk speed bonus.** CE's `animationComputeTicksPerFrame` adds the `combat_speed` preference to ANIM_WALK in combat. DH2 uses a fixed `1000/fps` for all animations. | `object.ts:1395` | `animation.cc:3287 animationComputeTicksPerFrame()` | minor | missing |
| FA5 | **`obj.shift = {x:0, y:0}` is truthy at walk start; frame 0's static ox/oy is skipped.** At the beginning of a walk cycle, `shift` is set to `{x:0,y:0}` — a truthy object. The renderer therefore takes the shift path and adds `+0`, while the correct static offset for frame 0 would be `frameInfo.ox`. For most walk FRMs `ox` at frame 0 is zero so the effect is invisible, but any FRM where frame 0 has a non-zero initial delta will display one frame off-anchor. | `renderer.ts:311`, `object.ts:1417` | `object.cc _obj_offset()` | low | bug |
| FA6 | **FID composition / weapon stance animation not implemented for NPC critters.** CE builds a Frame Identifier via `buildFid(objectType, animType, weaponAnimCode, direction, rotation)` (`art.cc`), where `weaponAnimCode` selects the critter's armed-pose FRM set (0=unarmed, 1=pistol, 3=rifle, 4=big gun, etc.). DH2 has no `buildFid` equivalent — critter FRM paths come from a static `skin` string. The player's `skin` is updated at weapon-swap time via `playWeaponSwapAnim`, but NPC critters on a map never have their skin recalculated from their held weapon; they always display unarmed animations. Full detail: `wiki/animation_system.md §8` (weapon-code-aware STAND/WALK gap). | `src/object.ts`; `src/renderer.ts` | `art.cc buildFid()`; `art.h ART_TYPE_CRITTER`; `proto_types.h ItemWeaponData.animCode` | medium | missing |

---

## 8. Palette Cycling (`cycle.cc`)

> **Source anchor:** `raw/fallout2-ce/src/cycle.cc` (`colorCycleTicker`, `cycleSetSpeedFactor`, `cycleInit`)

### 8.1 Overview

CE animates certain palette regions at runtime by rotating a block of palette entries each tick. This produces the distinctive animated water, fire, and terminal-monitor effects without any per-object animation data — the palette itself changes, and every pixel referencing those indices appears to move.

Palette cycling is gated by `settings.system.color_cycling` in `fallout2.cfg`. If disabled, all cycling groups remain static.

### 8.2 Color Groups

Five named groups are cycled independently:

| Group | Palette entries | Byte span | Update tier |
|-------|----------------|-----------|-------------|
| `slime` | 4 entries | 12 bytes | slow (5 Hz) |
| `shoreline` | 6 entries | 18 bytes | medium (7 Hz) |
| `fire_slow` | 5 entries | 15 bytes | slow (5 Hz) |
| `fire_fast` | 5 entries | 15 bytes | fast (10 Hz) |
| `monitors` | 5 entries | 15 bytes | very_fast (30 Hz) |

Each group advances in round-robin fashion: the first entry rotates to the last position (or vice versa) at each update interval.

### 8.3 Speed Tiers

| Tier | Frequency | Period (ms) |
|------|-----------|-------------|
| slow | 5 Hz | 200 |
| medium | 7 Hz | ~143 |
| fast | 10 Hz | 100 |
| very_fast | 30 Hz | ~33 |

`cycleSetSpeedFactor(n)` multiplies all period lengths by `n`, stored in `settings.system.cycle_speed_factor`. A value of 1 is normal speed; higher values slow all cycling groups proportionally.

### 8.4 CE Ticker Integration

CE calls `tickersAdd(colorCycleTicker)` during init (`cycle.cc:cycleInit`). The ticker is invoked every frame by the main loop's ticker dispatch. Each call checks elapsed time per group and rotates its palette slice if the period has elapsed.

Because the effect is palette-level, it applies to every FRM sprite on screen simultaneously — a single palette write animates all water tiles, all fire tiles, and all active terminal monitors at once.

### 8.5 DH2 Status — NOT IMPLEMENTED

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

<!-- audited: 2026-06-02 -->
