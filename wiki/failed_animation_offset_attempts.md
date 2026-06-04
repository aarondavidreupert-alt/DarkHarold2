# Failed Animation Offset Attempts — FA12 Post-Mortem

This document records every formula and approach tried while fixing FA12
(per-orientation weapon-draw pixel drift). Each attempt is explained, the
exact formula given, and the failure mode described. The goal is to prevent
re-introducing any of these approaches.

---

## Background: the artOffset field and the renderer formula

DH2 represents a critter's position as a tile number (`obj.position`). The
renderer derives the screen pixel position from scratch each frame:

```
screenX = tileToScreenX(tile) - floor(w/2) + dirOffset.x + ox[frame] + artOffset.x
screenY = tileToScreenY(tile) - h          + dirOffset.y + oy[frame] + artOffset.y
```

Where:
- `floor(w/2)` — horizontal center anchor (width of current FRM frame)
- `dirOffset` — per-direction fixed offset baked into the FRM header
- `ox[frame]` — cumulative x-delta at the current frame (baked by `frmpixels.py`); `ox[0]` is the delta for entering frame 0
- `artOffset` — a correction field on `Obj`, computed at every FRM transition

CE (`fallout2-ce`) has no equivalent of `artOffset`. Instead it maintains `obj->x/y`
as a running pixel position, updated each frame by `artGetFrameOffsets` deltas.
When a critter settles to idle, CE calls `objectSetLocation` which resets `obj->x/y`
to the tile's screen coordinates, discarding any accumulated drift.

`artOffset` in DH2 is the equivalent of CE's accumulated pixel displacement above
the tile's reference position.

---

## The zero-jump formula — derivation

When switching from FRM A at frame F to FRM B at frame 0, the screen position
must not jump. Setting `screenX_before = screenX_after` and solving for
`artOffset_new`:

```
artOffset_new.x = floor(newF0.w/2) − floor(srcF.w/2)
                + srcDirOff.x − destDirOff.x
                + srcF.ox    − destF0.ox
                + artOffset_old.x          ← "prev"
```

The y formula omits the `floor(h)` term because DH2 anchors on the bottom edge:

```
artOffset_new.y = srcDirOff.y − destDirOff.y
                + srcF.oy    − destF0.oy
                + artOffset_old.y
```

This formula is mathematically exact — position is **continuous** at the
transition point regardless of frame geometry differences.

---

## FRM animation chain for weapon swap

```
armed-idle (hmjmpsia)
  → staticAnimation(weapon-holster)
      → holster plays (hmjmpsid)
          → callback: swapFn() → clearAnim()   [→ unarmed-idle hmjmpsaa]
          →           staticAnimation(weapon-draw)
                          → draw plays (hmjmpsic)
                              → callback: settle() → clearAnim()  [→ armed-idle hmjmpsia]
```

`clearAnim` is called **twice** per swap cycle:
1. Between holster and draw (intermediate settle to unarmed-idle)
2. After draw (final settle to armed-idle)

`staticAnimation` is called twice:
1. Before holster (from armed-idle)
2. Before draw (from unarmed-idle, immediately after clearAnim #1)

---

## K_cycle — the FRM closed-loop property

For a complete swap cycle starting and ending at armed-idle with `artOffset = A`:

```
K_cycle = artOffset_after_full_cycle − A
```

If the FRM set forms a perfectly closed loop, `K_cycle = 0` for all directions.
For the `hmjmps` critter:

| Direction | K_cycle |
|-----------|---------|
| dir5 (NW) | 0       |
| dir2 (S)  | −2      |

The `floor(w/2)` terms cancel across a full cycle (verified by summing the four
transitions). The residual −2 for dir2 comes from `ox + dirOffset` terms not
summing to zero — an imperfection in the original FO2 FRM data.

CE has the same −2px/cycle accumulation for dir2 of this critter. It goes
unnoticed in CE because `objectSetLocation` resets `obj->x/y` on every tile
step; players virtually always walk between weapon swaps.

---

## Attempt 1 — Hard reset in clearAnim (FA12 first try)

**Formula — `clearAnim`:**
```
artOffset = {0, 0}
```

**Formula — `staticAnimation` (unchanged, using current idle frame):**
```
artOffset_new.x = floor(newF0.w/2) − floor(oldFf.w/2)
                + oldDirOff.x − newDirOff.x
                + oldFf.ox  − newF0.ox
                + prev.x

where oldFf = oldFrames[currentFrame]   ← mid-cycle frame F
```

**Failure mode:** Visual jumps that appeared random.

**Root cause:** The reset in `clearAnim` itself was fine, but `staticAnimation`
used `oldFrames[currentFrame]` (frame F of the idle, mid-cycle). This baked
`iOxF` (the cumulative idle ox at frame F, up to ±9 px) into `artOffset_draw`:

```
artOffset_draw.x = ... + iOxF + ...   ← contaminates all subsequent transitions
```

When `clearAnim` reset to `{0,0}` at the end of draw, the artOffset snapped by
`iOxF`, which varied with whichever idle frame happened to be playing when the
player triggered the draw. The jump appeared random because `iOxF` is a function
of animation timing.

**Key lesson:** The problem was in `staticAnimation`, not `clearAnim`. Fixing
`clearAnim` in isolation hides nothing when `staticAnimation` still carries the
contamination.

---

## Attempt 2 — Deferred contamination correction via `_idleContamination`

**Added field:**
```typescript
_idleContamination: { x: number, y: number } | null = null
```

**Formula — `staticAnimation` (idle → one-shot):**
```
contamination.x = floor(iW0/2) − floor(iWF/2) + iOxF
                 (stored in this._idleContamination)
```
where `iW0`, `iWF` are frame-0 and frame-F widths of the idle FRM, `iOxF` is
the idle ox at frame F.

`staticAnimation` still used `oldFf = oldFrames[currentFrame]` for the artOffset
formula (zero-jump with prev, same as Attempt 1).

**Formula — `clearAnim` (any → idle):**
```
artOffset_new.x = floor(newF0.w/2) − floor(oldF.w/2)
                + oldDirOff.x − newDirOff.x
                + oldF.ox    − newF0.ox
                + prev.x
                − contamination.x    ← subtracted here, at settle time
```
`_idleContamination` was then nulled.

**Failure mode:** The critter was visually displaced by `iOxF` pixels
**throughout the entire holster animation**. For example, dir5 triggered at idle
frame 6 showed `artOffset(-9, 0)` during holster vs `artOffset(0, 0)` when
triggered at frame 0.

**Root cause:** `_idleContamination` identified the problem correctly but applied
the correction at the wrong time — only at `clearAnim` (settle), not at the
point of contamination. The holster animation played with the dirty artOffset for
its full duration. The correction cancelled the accumulated error at settle, so
no drift accumulated across cycles, but the visual displacement during holster
was real and observable.

**Key lesson:** A correction that exists in the wrong place in the timeline is
not a fix. The contamination must be neutralised at the moment it is introduced,
not deferred to a later callback.

---

## Attempt 3 / Part 1 — Frame-0 anchor in staticAnimation

**Formula — `staticAnimation` (idle → one-shot):**
```
srcF = (this.anim === 'idle') ? oldFrames[0] : oldFrames[currentFrame]

artOffset_new.x = floor(newF0.w/2) − floor(srcF.w/2)
                + oldDirOff.x − newDirOff.x
                + srcF.ox    − newF0.ox
                + prev.x
```

By anchoring on `oldFrames[0]` (frame 0 of the idle), `iOxF` is never included.
The artOffset is identical whether the draw is triggered at idle frame 0 or
frame 7. A sub-pixel visual snap may occur at the trigger moment (the critter
shifts by `floor(iWF/2) − floor(iW0/2) − iOxF` pixels) but artOffset is clean
for the entire holster/draw chain.

CE justification: `art.cc artGetFrameOffsets` — CE's frame deltas are
independent of playback position; CE never carries a mid-animation ox into the
object reference point.

**Formula — `clearAnim` (any → idle):** zero-jump with `prev` (unchanged from
Attempt 2, minus the contamination subtraction):
```
artOffset_new.x = floor(newF0.w/2) − floor(oldF.w/2)
                + oldDirOff.x − newDirOff.x
                + oldF.ox    − newF0.ox
                + prev.x
```

**Failure mode:** Per-orientation drift on repeated weapon swaps. Dir5 was
stable (K_cycle = 0); dir2 drifted by −2px per full swap cycle, accumulating
to −10px after 5 swaps.

**Root cause:** The zero-jump formula in `clearAnim` carries `prev`, making
`artOffset` a running sum. For FRM directions where K_cycle ≠ 0 (dir2 = −2),
the sum grows unboundedly. Each term in the formula is locally correct
(no visual jump) but the global sum diverges.

Log evidence:
```
Cycle 1: staticAnimation hmjmpsaa→hmjmpsic dir2 prev(0,0)   → artOffset(-1,4)
Cycle 2: staticAnimation hmjmpsaa→hmjmpsic dir2 prev(-2,0)  → artOffset(-3,4)
Cycle 3: staticAnimation hmjmpsaa→hmjmpsic dir2 prev(-4,0)  → artOffset(-5,4)
```

**Key lesson:** A formula that is locally correct (preserves position at each
transition) can still be globally wrong (artOffset grows without bound). The
`prev` term is the correct mathematical carry for continuity but conflicts with
bounded artOffset when K_cycle ≠ 0 in the FRM data.

---

## Rejected approach — Remove prev without floor(w/2) correction

At this point the proposed fix was:

```
artOffset.x = (srcF0.ox + srcDirOff.x) − (destF0.ox + destDirOff.x)
artOffset.y = (srcF0.oy + srcDirOff.y) − (destF0.oy + destDirOff.y)
```

**Why this is wrong:** It omits the `floor(w/2)` terms. When source and dest
FRMs have different widths, the renderer's `−floor(w/2)` term shifts the sprite
horizontally. Without compensating for this in `artOffset`, there is a
width-proportional visual jump at every transition where widths differ.

Example — holster→unarmed-idle dir2:
- `hmjmpsid f9`: w=27, dirOff.x=1, ox=1
- `hmjmpsaa f0`: w=28, dirOff.x=−1, ox=0

This formula gives `artOffset.x = (1+1) − (0−1) = 3`.
The full formula (without prev but with `floor(w/2)`) gives `4`.
Difference = 1px at this transition.

For holster-start dir2 (`hmjmpsia→hmjmpsid`, width 31→28):
The formula gives `(0−2) − (1+1) = −4`.
Full formula gives `−5`. Difference = 1px here too.

But for the cumulative effect across a transition where both width and
dirOffset change significantly, the mismatch can reach 4–9px. Specifically,
`hmjmpsid f9 → hmjmpsaa f0` for dir2 with accumulated prev of −6 would
produce a 9px jump under this formula.

**Key lesson:** `floor(w/2)` is not optional. The horizontal centering term is
part of the screen position formula and must be compensated in `artOffset`
whenever source and dest FRM widths differ.

---

## Rejected approach — Remove prev, keep floor(w/2)

```
artOffset_new.x = floor(newF0.w/2) − floor(srcF.w/2)
                + srcDirOff.x − destDirOff.x
                + srcF.ox    − destF0.ox
                (no + prev.x)
```

This preserves visual continuity at the transition point (the screen position
is continuous — derivation holds with `artOffset_old = 0` in the equality).
However, `artOffset_old` is never actually 0 at intermediate transitions.

At the holster→unarmed-idle clearAnim (intermediate, called by `swapFn`):
`artOffset_holster` is non-zero (the holster start staticAnimation set it).
If we now compute clearAnim without prev, the position DOES jump by
`artOffset_holster` pixels. For dir2 with a −5px holster-start offset, the
jump at holster-end would be 5px. Clearly visible.

**Key lesson:** Removing `prev` from `staticAnimation` is safe only if
`artOffset` is always 0 when `staticAnimation` is called (which is guaranteed
in the final solution because `clearAnim` resets to zero). Removing `prev`
from `clearAnim` in isolation is not safe because the FRM may end with
a non-zero artOffset set by the preceding `staticAnimation`.

---

## Final solution — Part 1 + Part 2 combined

**`staticAnimation` (final):** zero-jump formula with frame-0 anchor and prev.

```
srcF = (this.anim === 'idle') ? oldFrames[0] : oldFrames[currentFrame]

artOffset_new.x = floor(newF0.w/2) − floor(srcF.w/2)
                + oldDirOff.x − newDirOff.x
                + srcF.ox    − newF0.ox
                + prev.x
```

`prev` is kept because `staticAnimation` can be called to interrupt an
in-progress one-shot animation (e.g. attack interrupted). In such cases prev
is non-zero and must be carried for continuity. In the normal weapon-swap flow,
`clearAnim` always resets first so prev is effectively 0.

**`clearAnim` (final):** unconditional reset.

```
artOffset = {0, 0}
```

Mirrors CE's `objectSetLocation` (object.cc): CE resets `obj->x/y` to the
tile's screen coordinates on every settle. Any accumulated K_cycle drift is
discarded, keeping artOffset bounded for all FRM sets regardless of whether
the FRM pair forms a perfect closed loop.

The visual consequence: 0–1px snap at the very last frame of any one-shot
animation transitioning to idle. This is identical to CE — CE has the same
snap because FRM designers target frame-0 alignment but are off by at most
1px in some directions (e.g. dir5 of hmjmps draw animation).

---

## Summary table

| Attempt | staticAnimation src frame | clearAnim formula | Failure |
|---------|--------------------------|-------------------|---------|
| 1 | `oldFrames[currentFrame]` | reset to 0 | Random ±9px jump at draw start (iOxF contamination) |
| 2 | `oldFrames[currentFrame]` | zero-jump − contamination | Critter displaced throughout holster animation |
| 3 / Part 1 | `oldFrames[0]` (anchor) | zero-jump + prev | −2px/cycle drift for dir2 (K_cycle accumulation) |
| No-prev (rejected) | `oldFrames[0]` | no prev, no floor(w/2) | Up to 9px jump at width-mismatched transitions |
| No-prev + floor(w/2) (rejected) | `oldFrames[0]` | no prev, with floor(w/2) | 5px jump at holster-end for dir2 |
| **Final** | `oldFrames[0]` (anchor) | **reset to 0** | ✅ Stable; 0–1px snap matches CE |

---

## Files

- `src/object.ts` — `Critter.staticAnimation`, `Critter.clearAnim`
- `src/renderer.ts` — `objectRenderInfo` (renderer formula; `animation` log)
- `src/config.ts` — `animOffset` and `animation` log flags
- `wiki/known_bugs.md` — FA12 entry
