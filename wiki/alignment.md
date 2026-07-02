# Screen-Space Alignment — CE vs DH2

How Fallout 2 CE positions and aligns every renderable category in screen
space, and exactly where DH2's WebGL 2.0 renderer agrees, deviates, or
approximates. This is the single reference for "why is *X* drawn at *that*
pixel", covering floor tiles, walls, scenery, roofs, objects/critters, the
player character, and the per-object lightmap UV lookup.

> **Source anchor:** `raw/fallout2-ce/src/tile.cc`, `object.cc`, `art.cc`
> **DH2 files:** `src/tile.ts`, `src/geometry.ts` (barrel; `src/geometry/{hexScreen,hexGrid}.ts`),
> `src/renderer.ts` (`objectRenderInfo`), `src/render/webglDraw.ts`
> (`drawTileMap`, `renderRoof`, `renderObject`), `shaders/fragment.glsl`,
> `shaders/fragmentLighting.glsl`, `tools/frmpixels.py` (sprite-sheet packer)
> **Related:** [`wiki/rendering.md`](rendering.md) (full pipeline + deviation
> registry RD01–RD17), [`wiki/tile_system.md`](tile_system.md) (coordinate
> layer), [`wiki/lighting.md`](lighting.md) (intensity model),
> [`wiki/failed_animation_offset_attempts.md`](failed_animation_offset_attempts.md)
> (`artOffset` derivation)
> **Last audited:** 2026-07-02

---

## 0. The two anchor conventions

Every alignment question reduces to one distinction: **what point on the map
does a sprite's screen position resolve to, and where on the sprite is that
point placed.**

| | Anchor point on the map | Anchor point on the sprite |
|--|-------------------------|----------------------------|
| **Floor / roof tiles** | *square* grid cell corner (80×36 grid) | top-left of the 80×36 sprite |
| **Objects / critters / walls / scenery** | *hex* tile **centre** | bottom-centre (feet) of the trimmed frame |

CE and DH2 agree on both conventions. They differ only in the arithmetic that
produces the corner/centre pixel (CE recomputes it relative to a moving camera
register; DH2 bakes a fixed world-space origin) and in a handful of ±1px
rounding choices detailed below.

---

## 1. Floor tiles — hex/square `(x, y)` → screen `(sx, sy)`

Floor sprites are **square-grid** art (80×36 px, type 4), *not* hex art. Each
square cell covers a 2×2 patch of hex cells. See
[`wiki/tile_system.md §2`](tile_system.md) for the two-grid architecture.

### CE — `squareTileToScreenXY` (`tile.cc:1097`)

```c
int rx = gSquareGridWidth - 1 - squareTile % gSquareGridWidth;  // reversed X
int sy_grid = squareTile / gSquareGridWidth;

int dx = rx - _square_x;
*coordX = _square_offx + 48 * dx;
*coordY = _square_offy - 12 * dx;

int dy = sy_grid - _square_y;
*coordX += 32 * dy;
*coordY += 24 * dy;
```

Per column step: Δx = +48, Δy = −12. Per row step: Δx = +32, Δy = +24. The
origin `_square_offx/_square_offy` is derived each frame from the hex camera
registers (`tile.cc:590`): `_square_offx = _tile_offx − 16`,
`_square_offy = _tile_offy − 2` (with an extra `−12/−16` when `_tile_y` is
odd). The floor blit (`tile.cc:1478`) uses this corner directly — the sprite's
top-left is placed at `(coordX, coordY)`; **no `+16/+8` centre nudge** (that is
an object-only step, see §4).

### DH2 — `tileToScreen` (`src/tile.ts:30`)

```typescript
export function tileToScreen(x: number, y: number): Point {
    x = 99 - x               // reverse X (CE convention)
    return { x: 4752 + 32 * y - 48 * x, y: 24 * y + 12 * x }
}
```

`drawTileMap` (`webglDraw.ts:60`) iterates `floorMap[j][i]` and draws each
80×36 quad at `tileToScreen(i, j) − cameraPosition`, scaled by zoom.

### Comparison

| Aspect | CE | DH2 | Verdict |
|--------|----|----|---------|
| Column pitch | Δx +48, Δy −12 | `−48·x`, `+12·x` (x reversed → same stagger) | ✅ identical |
| Row pitch | Δx +32, Δy +24 | `+32·y`, `+24·y` | ✅ identical |
| X reversal | `rx = 99 − col` | `x = 99 − x` | ✅ identical convention |
| Origin | dynamic `_square_offx` (camera-relative, recomputed per frame) | fixed world-space constant **4752** | ⚠️ different *mechanism*, same *result* |
| Anchor on sprite | sprite top-left at corner | sprite top-left at corner | ✅ identical |

**The one real difference is the origin constant.** CE's `_square_offx` tracks
a 640×480 screen centred on `gCenterTile`; DH2 works in a camera-independent
**world** coordinate space and bakes the origin (`4752`) as the pre-computed
`_square_offx` for a view centred on hex `(100,100)`. The camera subtract
(`scr − cameraPosition`) happens later, per draw. Net on-screen positions match
because DH2's `centerCamera` / `hexToScreen` share the same world baseline (see
[`wiki/tile_system.md §4.5`](tile_system.md)). No per-tile offset differs.

> Note: `src/tile.ts:81 tile_coord()` is a *separate*, unused, and broken
> CE-style port (`tile_offx=272`) — gap **TS4** in `tile_system.md`. It is not
> on the floor-render path and is irrelevant to alignment.

---

## 2. Walls & Scenery — object render anchor & FRM offsets

Walls and scenery are ordinary **objects** (hex-anchored), not tiles. They
follow the object anchor convention (§4) but are called out here because they
are the categories where FRM `offsetX/offsetY` data matters most (a wall
sprite's art extends far above and to the side of its logical hex).

### CE anchor — `_obj_render_object` (`object.cc:4881`, tile branch at 4903)

```c
tileToScreenXY(object->tile, &objectScreenX, &objectScreenY, object->elevation);
objectScreenX += 16;                        // hex corner → hex CENTRE (32×16 hex)
objectScreenY += 8;
objectScreenX += art->xOffsets[object->rotation];   // per-direction FRM offset
objectScreenY += art->yOffsets[object->rotation];
objectScreenX += object->x;                 // accumulated per-frame animation delta
objectScreenY += object->y;

objectRect.left   = objectScreenX - frameWidth / 2;   // horizontally centred
objectRect.top    = objectScreenY - (frameHeight - 1);// bottom-anchored (feet)
objectRect.right  = objectRect.left + frameWidth - 1;
objectRect.bottom = objectScreenY;
```

So CE's anchor point is the **hex tile centre** (corner `+16,+8`), shifted by
the FRM's per-rotation `xOffsets/yOffsets` (the `dataOffsets` baked in the FRM
header) plus `object->x/y` (a running per-frame pixel delta accumulated during
animation). The sprite is then placed **bottom-centre**: left = centre − w/2,
bottom edge = anchor Y.

The static-placement path `_obj_move` (`object.cc:1325`) sets the same rect
shape: `sx = a2 − width/2`, `sy = a3 − (height − 1)`.

### DH2 anchor — `objectRenderInfo` (`renderer.ts:342`)

```typescript
const scr = hexToScreen(obj.position.x, obj.position.y)   // hex → world (already centre-ish)
const frameInfo = info.frameOffsets[obj.orientation][obj.frame]
const dirOffset = info.directionOffsets[obj.orientation]

let offsetX = -((frameInfo.w / 2) | 0) + dirOffset.x     // bottom-centre anchor
let offsetY = -frameInfo.h + dirOffset.y

if (obj.shift !== null) {           // walking: accumulated shift (≙ CE object->x/y)
    offsetX += obj.shift.x
    offsetY += obj.shift.y
} else {                            // static / one-shot: FRM per-frame ox/oy + artOffset
    offsetX += frameInfo.ox + obj.artOffset.x
    offsetY += frameInfo.oy + obj.artOffset.y
}
const scrX = scr.x + offsetX, scrY = scr.y + offsetY     // top-left of trimmed frame
```

### Term-by-term mapping

| CE term | DH2 term | Match |
|---------|----------|-------|
| `tileToScreenXY + (16, 8)` (corner → centre) | `hexToScreen(x,y)` (returns centre-anchor directly) | ✅ equivalent — DH2 bakes the `+16/+8` into `hexToScreen`'s `4816`/`+11` constants |
| `art->xOffsets/yOffsets[rotation]` | `info.directionOffsets[orientation]` | ✅ same per-direction FRM offset |
| `object->x / object->y` (accumulated) | `obj.shift` (walk) / `frameInfo.ox+oy + obj.artOffset` (static) | ✅ equivalent; DH2 splits walk vs static, CE keeps one running register |
| `− frameWidth / 2` | `−(frameInfo.w / 2 | 0)` | ✅ identical (trimmed width) |
| `− (frameHeight − 1)` | `− frameInfo.h` | ⚠️ **1px** — CE bottom edge is inclusive; DH2 uses full height |

**Known discrepancies:**

1. **The `−(h−1)` vs `−h` one-pixel difference.** CE anchors the sprite so its
   *bottom-most row* sits on the anchor Y (inclusive rectangle). DH2 subtracts
   the full height. This is a consistent 1px vertical bias, imperceptible in
   practice and never separately tracked as a bug.
2. **`artOffset` is a DH2 invention.** CE keeps a single `object->x/y` running
   position that `objectSetLocation` resets to the tile screen coords on every
   tile step. DH2 recomputes the sprite position from scratch each frame and
   uses `artOffset` (recomputed at each FRM transition) to preserve continuity
   across art swaps. See
   [`wiki/failed_animation_offset_attempts.md`](failed_animation_offset_attempts.md)
   for the full derivation and the residual per-cycle drift (K_cycle) that
   CE also exhibits but hides via tile-step resets.
3. **Egg-anchor reconstruction** (`webglDraw.ts:452`) deliberately anchors the
   wall-transparency egg to the player's rendered foot point derived from
   `playerInfo.frameWidth/frameHeight` (trimmed) — *not* the uniform slot size
   (see §4) — because a residual half-padding offset otherwise shifts the egg.

There is no wall/scenery-specific anchor deviation beyond these — walls align
by the same rule as all objects.

---

## 3. Roofs — the `−96` offset

Roof sprites are **square-grid** art like floor tiles, but drawn 96px higher so
they visually sit *above* the floor they cover (an isometric building storey).

### CE — `squareTileToRoofScreenXY` (`tile.cc:1128`)

Identical to `squareTileToScreenXY` (§1) except the final Y:

```c
*screenY = v10 - 96;     // tile.cc:1155
```

Called by the roof blit at `tile.cc:1269` / `1514`. The `−96` shifts the
80×36 roof sprite up by roughly 2⅔ tile-heights so a roof cell renders directly
above the floor cell of the same square coordinate.

### DH2 — `renderRoof` (`webglDraw.ts:129`)

```typescript
const scr = tileToScreen(i, j)
scr.y += -96                 // webglDraw.ts:152
```

**Verdict: ✅ exact match.** DH2 uses the same literal `−96` on the same
square-tile projection. The value is correct and requires no change.

> Caveat unrelated to *alignment*: DH2 renders **all** roof tiles
> unconditionally — it has no equivalent of CE's per-square `tile_fill_roof`
> flood-fill that hides roofs when the player walks under a building
> (deviation **RD06** in `rendering.md`; `map.hasRoofAt()` exists but is not
> wired to rendering). Roof *lighting* also differs — DH2 dims roofs with
> ambient via `roofDummyTexture`, CE blits at full palette intensity
> (**RD15**). Neither affects the positional `−96`.

---

## 4. Objects / Critters — anchor, and `uniformFrameWidth` vs `frameWidth`

The anchor math is §2 (walls/scenery share it). This section resolves the
sprite-sheet packing question the anchor depends on.

### CE has no sheet — one trimmed bitmap per frame

CE blits `artGetFrameData(art, frame, rotation)` directly: a tightly-trimmed
`frameWidth × frameHeight` bitmap positioned at `(centre − w/2, anchorY −
(h−1))`. There is no padding, no slot, no uniform size. The FRM's per-frame
`offsetX/offsetY` are already folded into `object->x/y`; the per-rotation
`dataOffsets` into `art->xOffsets/yOffsets`.

### DH2 packs frames into a uniform-slot horizontal sheet

`tools/frmpixels.py:83` builds one PNG per FRM where **every slot is the same
size** — `maxW × maxH`, the maximum trimmed dimensions across *all*
directions/frames:

```python
maxW = max(max(fo['w'] ...) ...)      # widest frame in the whole FRM
maxH = max(max(fo['h'] ...) ...)
frmInfo['frameWidth']  = maxW          # ← "uniformFrameWidth"
frmInfo['frameHeight'] = maxH
...
finalImg.paste(img, (currentX, 0))     # trimmed frame pasted TOP-LEFT of its slot
currentX += maxW
```

Two distinct widths therefore exist on every object:

| Field | Meaning | Source |
|-------|---------|--------|
| `frameInfo.w / .h` (`frameWidth/frameHeight` in `ObjectRenderInfo`) | **trimmed** bounding box of *this* frame | FRM per-frame data |
| `info.frameWidth / .frameHeight` (`uniformFrameWidth/Height`) | **padded** per-slot size (`maxW × maxH`) | sheet packer |

### Why top-left packing makes this correct

`objectRenderInfo` computes the top-left `(scrX, scrY)` using the **trimmed**
`frameInfo.w/h` (§2). But `renderObject` (`webglDraw.ts:507`) draws a quad of
**uniform** size:

```typescript
this.renderFrame(obj.art,
    (renderInfo.x - cameraX) * z, (renderInfo.y - cameraY) * z,
    renderInfo.uniformFrameWidth * z,   // ← padded slot width drawn
    renderInfo.uniformFrameHeight * z,
    renderInfo.artInfo.totalFrames, renderInfo.spriteFrameNum, /*lit*/ true)
```

Because the packer pastes each trimmed frame at the **top-left** `(currentX,
0)` of its slot, the visible pixels of a slot occupy its top-left `w × h`
corner, with transparent padding extending **right and down**. Drawing the
uniform-size quad at the trimmed-computed top-left therefore places the visible
content at exactly the pixel CE would blit it; the transparent padding merely
extends the (invisible) quad extent. **This reproduces CE's result** — CE's
`(centre − w/2, anchorY)` and DH2's content pixel land in the same place.

### Consequence: anchor / egg / lighting math must use the trimmed size

Any calculation about *where the sprite actually is* must use `frameWidth/
frameHeight`, never the uniform size, or it picks up half the padding delta:

- **Culling** (`renderInfo` bounds, `renderer.ts:402`) uses `frameInfo.w/h`. ✅
- **Egg anchor** (`webglDraw.ts:441`) explicitly uses `frameWidth/frameHeight`,
  with a comment warning that the uniform size leaves "a residual offset of
  half the padding delta". ✅
- **`foot-y` object lighting** (§5) uses `renderInfo.frameHeight`. ✅
- **Occlusion bbox test** `isBBoxOccludingWall` (`webglDraw.ts:372`) uses
  `frameWidth/frameHeight`. ✅

**Verdict:** the `uniformFrameWidth` / `frameWidth` split is a DH2 packing
artifact with **no CE equivalent**, but it matches CE's expectation *as long
as* trimmed content stays top-left in each slot and all positional math uses
the trimmed dimensions — which the code does. The only sprite-sheet-related
draw cost is that transparent padding is rasterised (negligible).

### Player character

The player is just an object (`globalState.player`) rendered through the same
`objectRenderInfo` path; no special-case anchor. Its only distinct alignment
consumer is the egg effect, which anchors *to* the player's foot point to place
the wall-transparency mask around it (§2, point 3).

---

## 5. Lightmap UV sampling for objects — the `8.4` in `renderObject`

Object sprites are lit by sampling the 200×200 `u_tileIntensity` texture in the
fragment shader. Because a tall sprite (a wall, a standing critter) spans many
screen rows, per-fragment sampling would read *unlit hexes above the object's
tile*, darkening the sprite's top. DH2 fixes the sampled world-Y to the
object's tile row. The constant `8.4` lives in that fix.

### The forward formula (fragment shader)

`getWorldTileLight()` (`shaders/fragment.glsl:63`, mirrored in
`fragmentLighting.glsl:17`) converts a fragment's world position to a
continuous hex UV:

```glsl
float cube_x = world_x / 32.0 - world_y / 24.0;
float hex_x  = 150.0 - cube_x;
float hex_y  = world_x / 64.0 + world_y / 16.0 - 75.7;
return texture2D(u_tileIntensity, (vec2(hex_x, hex_y) + 0.5) / 200.0).r;
```

This is `hexFromScreen` (from `geometry.ts pixelToCube` + `сubeRoundToHex`) with
the rounding removed for smooth GPU interpolation. The `−75.7` (i.e. `75 +
0.7`) folds in the `−75` offset from `сubeRoundToHex` plus a **`0.7` empirical
bias correction**: the continuous form omits `сubeRoundToHex`'s `isEvenX`
adjustment (≈ −0.25 average) and the integer floor (≈ −0.5 average) — together
≈ −0.75, rounded to −0.7 (comment at `fragmentLighting.glsl:29`).

### The inverse (`renderObject`, `webglDraw.ts:479`)

`'tile-y'` mode solves the forward formula for `world_y` at a tile centre
`(tx, ty)`, then feeds it to the shader as `u_objectBaseY`, which clamps every
fragment's sampled Y to `baseY ± 6` world units:

```typescript
const tx = obj.position.x, ty = obj.position.y
baseY = 12 * ty + 8.4 + 6 * tx
```

**Derivation** — set `hex_x = tx`, `hex_y = ty`, eliminate `world_x`:

```
from hex_x:  world_x = 32·(150 − tx) + (4/3)·world_y
sub into hex_y:  (150 − tx)/2 + world_y/12 = ty + 75.7
                 world_y/12 = ty + 0.7 + tx/2
                 world_y = 12·ty + 8.4 + 6·tx        (8.4 = 12 × 0.7)
```

So **`8.4 = 12 × 0.7`**, where `0.7` is the shader's own bias-correction
constant (the `.7` in `−75.7`).

### Is it correct?

- **As an inverse of the shader: exact.** `baseY` is the algebraically exact
  `world_y` that makes the shader sample tile `(tx, ty)`'s texel centre. The
  `±6` clamp (`fragment.glsl:77`) = ±0.375 texels — adjacent iso tiles are
  ~0.75 texels apart — so horizontal LINEAR blending stays intentional while
  the vertical sample never crosses into the wrong tile row.
- **As "the correct value": inherits the shader's approximation.** The forward
  formula is itself an approximation (the `0.7` stands in for the true
  `−0.25/−0.5` discrete rounding CE performs). `baseY` is thus an *exact inverse
  of an approximate forward map* — correct relative to the shader, ~sub-texel
  off relative to a pixel-perfect CE `hexFromScreen`.

### Alignment with CE's per-tile light lookup

CE applies **one** intensity per object — `lightGetTileIntensity(elevation,
obj->tile)` — to every pixel of the sprite (`object.cc`, `_obj_render_pre_roof`
passes a single `lightIntensity` into `_obj_render_object`). DH2's three modes
(`Config.engine.objectLightingMode`, default **`'tile-y'`**) approximate this:

| Mode | `u_objectBaseY` | Behaviour vs CE |
|------|-----------------|-----------------|
| **`tile-y`** (default) | `12·ty + (11.25\|5.25) + 6·tx` (tile centre, parity-aware — see §6) | Closest to CE: locks the sample to the object's own tile row. Still permits a *horizontal* bilinear gradient across the sprite (a DH2 softening — CE is flat per object). |
| **`foot-y`** | `renderInfo.y + renderInfo.frameHeight` (sprite bottom, world px) | Samples whatever tile the *feet pixels* fall on. Near-correct, but diverges from `tile-y` when FRM offsets shift the foot pixel off the logical tile; can pick a neighbouring row. |
| **`off`** | `−1.0` (per-fragment) | Original path: full per-fragment sampling → dark tops on tall sprites. Switches `u_tileIntensity` to **NEAREST** for the draw to stop bilinear light-leak through walls (floor draws restore LINEAR). |

None reproduces CE exactly: CE is *flat* (single intensity, hard per-hex
edges); DH2 always samples a texture and so blends horizontally. `tile-y` is
the intended default because it guarantees the correct tile row while keeping
the smooth horizontal gradient DH2 accepts elsewhere (deviation **RD05** in
`rendering.md`). This is a deliberate WebGL-architecture approximation, not a
bug.

> **Update (2026-07-02):** the single `8.4` constant (which matched the old
> averaged shader constant `−75.7`) was replaced by a per-column-parity offset
> (`11.25` even / `5.25` odd) as part of the §6 fix, so `tile-y` now stays
> aligned with the corrected shader on both column parities.

---

## 6. Diagnosis — Hex ↔ lightmap sampling offset (root cause + fix)

**Symptom.** The player sprite sits correctly in the centre of the cursor hex,
but the rendered light circle is offset from that hex — tiles on one side are
brighter than the symmetric opposite. `lightingPlayerDebug()` shows the stored
per-tile intensities are perfectly symmetric, so the *data* is right; the
*sampling* is displaced.

### The two mappings compared

**Cursor hex → screen** (`renderer.ts:187`): the cursor overlay uses
`scr = hexToScreen(mouseHex.x, mouseHex.y)` and draws `hex_outline` at
`worldToScreen(scr.x − 16, scr.y − 12)`. The player sprite uses the *same*
`hexToScreen` for its foot anchor (`objectRenderInfo`, `renderer.ts:343`). So
**cursor and player agree** — they are both placed by `hexToScreen`. `hexToScreen`
is the ground truth for "where tile *(x, y)* appears on screen".

**Lightmap texel → screen** (`shaders/fragmentLighting.glsl`, mirrored in
`fragment.glsl`): each fragment reconstructs a continuous hex coordinate from
its world position and samples texel *(hex_x, hex_y)*:

```glsl
hex_x = 150.0 − (world_x/32 − world_y/24);
hex_y = world_x/64 + world_y/16 − 75.7;      // ← the culprit
```

The texel for tile *(tx, ty)* is uploaded at index `ty·200 + tx`
(`webglLighting.ts:40`, `texSubImage2D(…, 200, 200, RED)`), so `hex_x ↔ x`,
`hex_y ↔ y` with no transposition. The screen point whose light peaks for tile
*(tx, ty)* is the world point that makes `hex_x = tx, hex_y = ty`.

### Do they agree? No — and here is the exact delta

`hexToScreen` is **not a single affine map**. Its `x >> 1` floor makes even and
odd columns follow *different* affine maps:

```
even x:  sx = 4816 − 24x + 16y     sy = 6x + 12y + 11
odd  x:  sx = 4808 − 24x + 16y     sy = 6x + 12y + 5
```

Inverting each exactly gives a **parity-dependent** `hex_y` constant, and a
`hex_x` constant that is the same for both:

| | exact `hex_x` const | exact `hex_y` const |
|--|--------------------|---------------------|
| even column | **150.0417** (= 150 + 1/24) | **−75.9375** |
| odd column | **150.0417** | **−75.4375** |
| shipped shader | `150.0` | `−75.7` (the even/odd **average**) |

A single affine formula *cannot* invert a two-parity map, so `−75.7` is the
best compromise (the mean of `−75.9375` and `−75.4375`). Feeding a tile's true
screen position back through the shader (`shaderHex(hexToScreen(tile))`) yields
this round-trip error, in texels:

| tile | current `(150.0, −75.7)` error | ⇒ light-peak offset from hex |
|------|-------------------------------|------------------------------|
| `(100,100)` even | `(−0.042, +0.238)` | **(−4.8, −2.6) px** (peak NW of player) |
| `(101,100)` odd | `(−0.042, −0.263)` | **(+3.2, +3.4) px** (peak SE of player) |

So the light circle is displaced ≈ **5 px** from the player's hex, and the
direction **flips with the player's column parity**. On any one tile it reads as
a consistent one-sided brightness bias — exactly the reported symptom. (The
`hex_x` error of `−0.042` texels ≈ 1 px is a minor consistent contributor; the
dominant term is the alternating `hex_y` parity error of ±0.24 texels.)

### Is it zoom-dependent? Yes

The two formulas diverge by a fixed offset in **world** units (≈ 5 world px).
The shader computes world coords as `camera + (fragCoord/dpr)/zoom` *before* the
hex math, so a fixed world-space error renders as `error × zoom` screen pixels:
**zooming in magnifies the visible misalignment, zooming out shrinks it.** (A
fixed *pixel* offset — e.g. a bad texel-upload origin — would not scale with
zoom; this one does, which fingers the world→hex formula, not the upload.)

### Root cause

The shader's `hex_y` constant `−75.7` is a single-affine approximation of a
map (`hexToScreen`) that is genuinely per-column-parity affine. Nothing in the
lightmap *data* or the *upload* is wrong; the analytic screen→hex inverse in the
shader simply cannot be parity-blind and still be exact.

### Fix (applied 2026-07-02)

Make the shader's `hex_y` constant parity-aware, and correct `hex_x` to its
exact value. In both `shaders/fragment.glsl` (`getWorldTileLight`) and
`shaders/fragmentLighting.glsl` (`getGPULightIntensity`):

```glsl
float hex_x = 150.0416667 - (world_x / 32.0 - world_y / 24.0);   // 150 + 1/24
float col   = floor(hex_x + 0.5);                                // nearest column
float cy    = (mod(col, 2.0) < 0.5) ? -75.9375 : -75.4375;       // even : odd
float hex_y = world_x / 64.0 + world_y / 16.0 + cy;
```

This drives the round-trip error to **exactly zero on every tile of both
parities** (verified numerically). The parity `hex_y` step of 0.5 texel at each
column boundary is the *correct* compensation for the half-hex vertical stagger,
not a seam. `renderObject`'s `tile-y` `baseY` (`webglDraw.ts:479`) was updated
to the matching parity offset (`11.25` even / `5.25` odd) so per-object
lighting stays consistent with the corrected shader.

**Not touched:** the CPU floor-light path (`webglLighting.ts:120`) uses the
*discrete, rounded* `hexFromScreen(scr.x − 13, scr.y + 13)` per square tile — a
different mechanism that does not suffer the continuous-affine averaging error
(though its own `−13/+13` fudge is worth a future audit). Default rendering uses
the GPU path, which the fix corrects.

**Verify in-browser:** enable the cursor-hex overlay + lightmap debug, stand on
`(100,100)`, confirm the brightest texel now coincides with the hex centre at
1× zoom, then re-check at 0.5× and 3× zoom (the pre-fix offset scaled with
zoom; post-fix it should be ~0 at all zooms).

---

## 7. Lighting interpolation modes (stripe fix)

### Why the parity fix introduced stripes

The §6 parity fix centres the light on the player's hex, but it did **not**
change how WebGL's `gl.LINEAR` sampler blends *between* hexes. LINEAR
interpolates the four texels surrounding `(hex_x, hex_y)` in a **rectangular**
grid, but `hexToScreen` is per-column-parity: the texel at `(x+1, y)` (the next
column) sits half a hex-cell higher/lower on screen than the texel at `(x, y)`.
So LINEAR mixes light from tiles that are **not** screen-adjacent, and the
mismatch beats along column boundaries — which run NW-SE — producing the NW-SE
**stripes**.

Put differently: a unit step in `hex_x` is `(−32, 0)` screen on even→odd
columns but `(−16, +12)` on odd→even. The texture grid is uniform; the screen
lattice is staggered. LINEAR assumes the former, so it's wrong by exactly the
stagger at every column edge.

### The modes — `setLightingBilinear(mode)`

Runtime-switchable (persists in `Config.engine.lightingInterpolation`), no
reload. Same `u_lightInterp` branch in both world shaders
(`sampleTileLight` in `fragment.glsl` and `fragmentLighting.glsl`); the CPU
sets the texture filter each mode needs (`webglContext.ts setLightInterpMode`).

| Mode | `u_lightInterp` | Filter | How it samples | Result |
|------|-----------------|--------|----------------|--------|
| `off` | 0 | NEAREST | single snap at `(hex_x, hex_y)` | Crisp hex cells, no blend. Debug baseline. |
| `linear` | 0 | LINEAR | single sample, sampler blends 4 rect texels | Fast, **striped** (kept for comparison). |
| `column-center` | 1 | LINEAR | quantize column `u = floor(hex_x)+0.5`, keep row `v` continuous | LINEAR blends **only within a column** (screen-adjacent SE neighbours) → no cross-column bleed, no stripes. Hard steps *between* columns. |
| `hex-lerp` | 2 | NEAREST | 3-tap barycentric over the 3 nearest hexes in **axial** space | **Default.** Geometrically correct, smoothest, no stripes. |
| `bicubic` | 3 | NEAREST | 4-tap Catmull-Rom down the column (column locked to centre) | Smoother falloff than linear along the column; never crosses the stagger. Cross-column steps remain (like `column-center`). |

### Why `hex-lerp` is the correct one

The stripes come from interpolating in the staggered *offset* grid. `hex-lerp`
interpolates in **axial** coordinates instead — a parity-free triangular
lattice where hex centres are uniform. World→axial is a single constant linear
map (no parity):

```
aj = (world_y − 11) / 12          // 11 = hexToScreen(0,0).y
ai = ((world_x − 4816) − 16·aj) / 32
```

with generators `+i = screen (32,0)` (E) and `+j = screen (16,12)` (SE). The
fractional cell `(ai, aj)` is split into two triangles along the E–SE diagonal
(the Delaunay diagonal of the hex lattice); the enclosing triangle's 3 corners
are the 3 nearest hexes, with barycentric weights:

```
fi + fj ≤ 1 :  A=(i0,j0)   wA=1−fi−fj ; B=(i0+1,j0)   wB=fi ; C=(i0,j0+1) wC=fj
fi + fj > 1 :  A=(i0+1,j0+1) wA=fi+fj−1 ; B=(i0+1,j0) wB=1−fj ; C=(i0,j0+1) wC=1−fi
```

Each integer axial corner maps back to a texel via `axialToUV`, which walks
axial→screen→(parity inverse)→offset — exact because corners are hex centres.
**Numerically verified** over all 40 000 tiles: at a tile centre one weight is
1 (so §6's centring is preserved exactly), weights always sum to 1 and are
non-negative, and the 3 taps are always pairwise hex-adjacent (≤ 32 px) — so it
can never blend non-adjacent tiles, i.e. no stagger, no stripes.

### Alternatives considered

- **Gaussian / hex-aware CPU blur** of `tile_intensity` before upload (blur each
  tile with its 6 `hexNeighbors`, done once per lightmap rebuild): also correct
  and cheap, but softens the whole field globally rather than being a
  per-fragment choice, and can't be toggled without a re-bake. `hex-lerp` keeps
  the data crisp and does the smoothing at sample time. Left as a possible
  future mode if per-fragment cost ever matters (it doesn't — the GPU floor is a
  single fullscreen composite).
- **Naïve bicubic over the rectangular grid** (4×4): would *reintroduce* the
  stagger because it still crosses columns. Rejected — the shipped `bicubic`
  stays inside one column instead.

### Objects vs floor

Both the floor shader (`getGPULightIntensity`) and the object/wall/critter
shader (`getWorldTileLight`) route through the same `sampleTileLight`, so the
mode applies everywhere consistently. For objects the world-Y is still clamped
to the sprite's tile row first (§5), so `hex-lerp`'s taps stay on the object's
tile and its immediate neighbours.

### Interaction with `objectLightingMode 'off'`

That debug mode temporarily forces NEAREST on the intensity texture during a
sprite draw to stop bilinear bleed; it now restores the **active** interpolation
mode's filter (`applyTileIntensityFilter`) afterwards instead of a hardcoded
LINEAR, so the two settings no longer fight.

---

## 8. Summary — agreements, deviations, approximations

| Category | CE anchor | DH2 anchor | Status |
|----------|-----------|------------|--------|
| **Floor tiles** | square corner, dynamic `_square_offx` origin | square corner, fixed world origin `4752` | ✅ same result; origin *mechanism* differs |
| **Walls & scenery** | hex centre + FRM dir/frame offsets, bottom-centre | same via `hexToScreen` + `directionOffsets` + `ox/oy` | ✅ match, minus 1px `−(h−1)` vs `−h` |
| **Roofs** | square projection, `screenY − 96` | `tileToScreen` + `scr.y − 96` | ✅ exact; value correct |
| **Objects / critters / player** | trimmed bitmap at `(centre−w/2, anchorY−(h−1))` | uniform-slot sheet, top-left packed; anchor uses trimmed `w/h` | ✅ match; `uniformFrameWidth` is a DH2 packing artifact |
| **Object lightmap UV** | one `lightGetTileIntensity` per object (flat) | parity-aware `baseY = 12·ty + (11.25\|5.25) + 6·tx`, ±6 clamp, horizontal LINEAR | ⚠️ approximation (horizontal blend); vertical now exact — see §6 |
| **Hex ↔ lightmap sampling** | n/a | shader screen→hex inverse of `hexToScreen` | ✅ **fixed 2026-07-02** — centring offset (§6) + selectable interpolation to remove the LINEAR stagger stripes (§7, default `hex-lerp`) |

### Cross-references

- Full render pipeline and the deviation registry (RD01–RD17, incl. roof
  clipping RD06, object sort RD09, floor-light filter RD05, roof lighting
  RD15) → [`wiki/rendering.md`](rendering.md)
- Coordinate encoding, square/hex projection, `tile_coord` gap TS4 →
  [`wiki/tile_system.md`](tile_system.md)
- Intensity scale, per-object light sources, ambient →
  [`wiki/lighting.md`](lighting.md)
- `artOffset` / animation-transition continuity →
  [`wiki/failed_animation_offset_attempts.md`](failed_animation_offset_attempts.md)

<!-- audited: 2026-07-02 -->
