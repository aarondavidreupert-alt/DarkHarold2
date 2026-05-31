# Egg Transparency System

Documents the Fallout 2 "egg" — the translucency zone around the player that
makes overlapping walls, scenery, and roofs fade out so the player is always
visible. This doc is the reference for implementing egg rendering in DH2's
WebGL pipeline.

Ground-truth reference:
- `raw/fallout2-ce/src/object.cc` — `_obj_render_object`, `objectsInit`, `objectSetLocation`, `_obj_offset`, `_intensity_mask_buf_to_buf`, `_dark_trans_buf_to_buf`, `_dark_translucent_trans_buf_to_buf`
- `raw/fallout2-ce/src/tile.cc` — `tileRenderRoof`, `tileRenderRoofsInRect`, `tile_fill_roof`, `tileIsInFrontOf`, `tileIsToRightOf`
- `raw/fallout2-ce/src/obj_types.h` — `ObjectFlags` enum, `OBJECT_TRANS_*` constants

Cross-reference:
- [wiki/map_rendering.md §6](map_rendering.md) — roof clipping (the `tile_fill_roof` subsystem used alongside the egg)
- [wiki/lighting.md §8](lighting.md) — render integration (draw order for lit objects)

---

## 1. Egg Concept

The egg is a special pseudo-object (`gEgg`) that tracks the player's tile and
screen position. Its FRM is an elliptical alpha-gradient mask image. When a
wall or scenery object overlaps the egg's screen region **and** is geometrically
in front of or to the right of the player, CE splits the object's draw call:
the region inside the egg is blended using the gradient mask (player visible
through the wall), the region outside the egg is drawn normally.

The egg FRM is loaded in `objectsInit` (`object.cc:352`):

```cpp
int eggFid = buildFid(OBJ_TYPE_INTERFACE, 2, 0, 0, 0);
objectCreateWithFidPid(&gEgg, eggFid, -1);
gEgg->flags |= OBJECT_NO_REMOVE | OBJECT_NO_SAVE | OBJECT_HIDDEN | OBJECT_LIGHT_THRU;
```

`OBJ_TYPE_INTERFACE = 6`, index 2 → the second entry in `art/intrface/*.lst`,
which resolves to `egg.frm` in the original game data. The FRM is a single-
frame greyscale image; pixel value 0 = fully opaque wall (player NOT visible),
higher values = more of the player visible. The oval is roughly 80×60 screen
pixels, matching the isometric tile footprint.

**Object types affected by the egg:**

| Type | Affected |
|------|---------|
| Scenery (OBJ_TYPE_SCENERY = 2) | Yes |
| Wall (OBJ_TYPE_WALL = 3) | Yes |
| Items (OBJ_TYPE_ITEM = 0) | No |
| Critters (OBJ_TYPE_CRITTER = 1) | No |
| Tiles (OBJ_TYPE_TILE = 4) | No |
| Misc/exit grids (OBJ_TYPE_MISC = 5) | No |
| Roofs (OBJ_TYPE_TILE, rendered separately) | Yes — handled in `tileRenderRoof` |

---

## 2. Egg Position Tracking

`gEgg` is a permanent invisible object that always occupies the same tile as
the player. CE synchronises it on every player move:

| Event | CE call |
|-------|---------|
| Player moves to new tile | `objectSetLocation(gEgg, tile, elevation, ...)` inside `objectSetLocation(gDude, ...)` — `object.cc:1476-1481` |
| Player pixel-offsets (sliding) | `_obj_offset(gEgg, x, y, ...)` inside `_obj_offset(gDude, ...)` — `object.cc:1173, 1195` |
| Player moves one step | `_obj_move(gEgg, a2, a3, elevation, ...)` inside the player move path — `object.cc:1343-1346` |
| Elevation change | `objectSetLocation(gEgg, tile, newElevation, ...)` — same as tile move |

`gEgg->tile` and `gEgg->x/y` (pixel sub-tile offsets) thus match `gDude`
exactly. The egg FRM screen position is computed on each render call from
`gEgg->tile`:

```cpp
int eggScreenX, eggScreenY;
tileToScreenXY(gEgg->tile, &eggScreenX, &eggScreenY, gEgg->elevation);
eggScreenX += 16;                 // centre tile horizontally
eggScreenY += 8;                  // centre tile vertically
eggScreenX += egg->xOffsets[0];   // FRM art offset
eggScreenY += egg->yOffsets[0];
eggScreenX += gEgg->x;            // pixel sub-tile offset
eggScreenY += gEgg->y;
```

The resulting `eggRect` (object.cc:5005-5009):
```
eggRect.left  = eggScreenX - eggWidth / 2
eggRect.top   = eggScreenY - (eggHeight - 1)
eggRect.right = eggRect.left + eggWidth - 1
eggRect.bottom = eggScreenY
```

There is no hex-grid radius constant — the egg boundary is purely the screen-
space bounding box of the egg FRM. Any wall/scenery whose screen rect
intersects this box (and passes the positional check, §3) is partially faded.

---

## 3. Positional Condition for Egg Activation

The egg masking is only applied if the wall/scenery is geometrically in front of
or to the right of the player (i.e. obscuring the player's body in the isometric
view). CE uses `tileIsInFrontOf` and `tileIsToRightOf` (`tile.cc:854-888`) to
classify the relative position.

### `tileIsInFrontOf(tile1, tile2)` (`tile.cc:854`)

```
dx = screenX(tile2) − screenX(tile1)
dy = screenY(tile2) − screenY(tile1)
return dx ≤ dy × −4.0
```

`dbl_50E7C7 = −4.0` (`tile.cc:69`). Returns true when tile2 is significantly
higher on screen than tile1 — the "this object is visually in front of
the player" check.

### `tileIsToRightOf(tile1, tile2)` (`tile.cc:871`)

```
dx = screenX(tile2) − screenX(tile1)
dy = screenY(tile2) − screenY(tile1)
return dx ≤ dy × 1.3333333333333335
```

Returns true when tile2 is isometrically to the right of tile1.

### Per-wall-orientation condition (`object.cc:4954-4980`)

CE reads the wall proto's `extendedFlags` (same flags used for light-blocker
orientation — see [wiki/lighting.md §4](lighting.md)):

| `extendedFlags` bits | Condition to activate egg |
|---|---|
| `0x8000000` or `0x80000000` | `tileIsInFrontOf(object, gDude)` — but negated if also `tileIsToRightOf` and `OBJECT_WALL_TRANS_END` |
| `0x10000000` | `tileIsInFrontOf(object, gDude) OR tileIsToRightOf(gDude, object)` (bitwise OR — both evaluated) |
| `0x20000000` | `tileIsInFrontOf(object, gDude) AND tileIsToRightOf(gDude, object)` |
| None (default) | `tileIsToRightOf(gDude, object)` — negated if also `tileIsInFrontOf(gDude, object)` and `OBJECT_WALL_TRANS_END` |

The same logic is duplicated in the click-intersection function
`_obj_create_intersect_list` (`object.cc:2944-2966`).

### Full egg-activation check

```
if type ∈ {scenery, wall}
AND gDude not hidden
AND object has no permanent OBJECT_TRANS_* flag (OBJECT_FLAG_0xFC000 == 0)
AND positionalCheck(object.tile, gDude.tile, object.extendedFlags) is true
AND rectIntersection(eggRect, objectScreenRect) succeeds (non-empty intersection)
    → render with egg masking
```

If any condition fails the object is rendered normally (or with its own
permanent translucency if `OBJECT_FLAG_0xFC000 != 0`).

---

## 4. Transparency Flags — OBJECT_TRANS_*

These flags are set from the PRO at map load time (`object.cc:943-956`). They
control how an object is permanently rendered, independent of the egg.

### Constants (`raw/fallout2-ce/src/obj_types.h:72-88`)

| Flag | Value | PRO bit | Render blit function | Effect |
|------|-------|---------|---------------------|--------|
| `OBJECT_TRANS_RED` | `0x4000` | `0x4000` | `_dark_translucent_trans_buf_to_buf` + `_redBlendTable` | Red-tinted translucency |
| `OBJECT_TRANS_NONE` | `0x8000` | `0x8000` | `_dark_trans_buf_to_buf` (default branch) | Fully opaque draw (palette-0 skip) |
| `OBJECT_TRANS_WALL` | `0x10000` | `0x10000` | `_dark_translucent_trans_buf_to_buf` + `_wallBlendTable` | Wall-tinted translucency |
| `OBJECT_TRANS_GLASS` | `0x20000` | `0x20000` | `_dark_translucent_trans_buf_to_buf` + `_glassBlendTable` | Glass translucency |
| `OBJECT_TRANS_STEAM` | `0x40000` | `0x40000` | `_dark_translucent_trans_buf_to_buf` + `_steamBlendTable` | Steam translucency |
| `OBJECT_TRANS_ENERGY` | `0x80000` | `0x80000` | `_dark_translucent_trans_buf_to_buf` + `_energyBlendTable` | Energy translucency |
| `OBJECT_FLAG_0xFC000` | `0xFC000` | (mask) | Combined mask of all 6 flags above | |

`OBJECT_WALL_TRANS_END` (`0x10000000`) — a separate flag indicating the wall
ends a transparent run; it modifies the positional condition (§3), not rendering.

### Relationship to the egg

**Objects with any `OBJECT_FLAG_0xFC000` bit set bypass the egg entirely.** The
conditional in `_obj_render_object` checks `(object->flags & OBJECT_FLAG_0xFC000) != 0`
first; if true, the positional and intersection checks are skipped. Steam vents,
glass windows, energy barriers and other permanently-translucent scenery always
render with their colour-blend table regardless of player position.

**`OBJECT_TRANS_NONE` is not "invisible"** — it means "use simple palette
rendering (`_dark_trans_buf_to_buf`), skip colour blending." It is the default
case in the translucency switch and is used for opaque-but-depth-sorted walls
that still count as in the TRANS group.

### Palette index 0 = transparent

All CE blit functions (`_dark_trans_buf_to_buf` and `_dark_translucent_trans_buf_to_buf`)
skip source pixels where the colour byte is `0` (`color != 0` guard,
`object.cc:2769,2798`). Palette index 0 is the transparent colour. The egg FRM
itself uses non-zero pixel values as an alpha mask (0=opaque wall region,
higher=more player visible); those pixels are never skipped.

---

## 5. Roof Egg

Roofs are rendered by `tileRenderRoofsInRect` (`tile.cc:1221`), which calls
`tileRenderRoof` (`tile.cc:1328`) for each visible roof tile.

`tileRenderRoof` applies the same egg-mask technique as wall rendering:
1. Compute the egg's current screen rect from `gEgg->tile` and the FRM offsets.
2. Compute `rectIntersection(&eggRect, &tileRect, &intersectedRect)`.
3. If intersection found: draw the four non-overlapping quadrants of the tile
   with `_dark_trans_buf_to_buf`, then draw the overlapping region with
   `_intensity_mask_buf_to_buf` using the egg FRM as the alpha mask.
4. If no intersection: draw the whole tile with `_dark_trans_buf_to_buf`.

The roof tile is also subject to `tile_fill_roof` visibility: if bit 0 of the
roof tile's flag nibble is set (`(frmId & 0xF000) >> 12) & 0x01 != 0`), the
tile is skipped entirely regardless of the egg. The flag is cleared when the
player enters a building's square and set when the player leaves
(`object.cc:1447-1463` — the `_obj_last_roof_x/y` system). See
[wiki/map_rendering.md §6](map_rendering.md) for the full roof-clipping system.

CE therefore has two separate mechanisms for roofs above the player:
- **`tile_fill_roof` skip** — hides the entire roof tile so the room interior
  is visible from above. Triggered once per square-tile entry.
- **Egg mask on roof** — fades the roof tile edges where they overlap the egg
  ellipse, creating a soft circular window.

**DH2 status**: Neither mechanism is implemented. DH2's `renderRoof` draws all
roof tiles without any player position check or egg masking.

---

## 6. Render Pipeline Integration

### CE — software palette blitter

CE renders scenery and walls inline with the normal tile-ordered render pass
(`_obj_render_pre_roof`, `_obj_render_post_roof`). Each object's draw call ends
in one of three blit paths:

1. **Egg-masked region** (`_intensity_mask_buf_to_buf`, `object.cc:2815`):
   - `src` = object FRM pixels (lit, palette-indexed)
   - `mask` = egg FRM pixel (0 = destination opaque, 128 = 50 % mix, 255 = object fully visible)
   - Algorithm: `v1 = intensityColorTable[dest][128 − mask]`, `v2 = intensityColorTable[color][mask]`, `*dest = colorMixAddTable[v2][v1]`
   - `color = 0` pixels still skipped (transparent shape).

2. **Non-egg region of same object** (`_dark_trans_buf_to_buf`): normal lit
   blit, palette-0 transparent.

3. **Permanent translucency** (`_dark_translucent_trans_buf_to_buf`): colour-
   blend table lookup through a grayscale conversion step, applied to the whole
   object regardless of egg or player position.

CE has no per-object alpha channel — transparency is entirely palette-based.
All blending happens in software at 8-bit indexed colour depth.

### DH2 — WebGL shader

DH2's `renderObject` (`webglrenderer.ts:1033`) calls `renderFrame` for every
object unconditionally. No egg mask, no `OBJECT_TRANS_*` flag check, no
positional condition.

WebGL alpha blending is globally enabled at init:
```typescript
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
gl.enable(gl.BLEND)   // webglrenderer.ts:244-245
```

This respects the alpha channel of the sprite PNG (palette-0 pixels become
`a=0` in the exporter), so sprite shapes are correct. However:
- No egg transparency zone.
- No wall fade-out based on player position.
- No `OBJECT_TRANS_*` colouration (glass, steam, energy, etc.).
- No roof egg masking.

Implementing the egg in DH2 would require:
1. Adding `tileIsInFrontOf` / `tileIsToRightOf` geometric helpers (equivalent
   formulas using DH2's `hexToScreen`).
2. Maintaining a player-centred screen rect for the egg boundary.
3. For walls/scenery in the egg zone: either a per-object custom blend weight
   (clip the object and draw with reduced alpha), or a stencil/mask texture
   pass.
4. Roof tiles at the player's square: suppressing the draw or applying a
   circular alpha cutout.

---

## 7. `set_obj_visibility` Opcode

There is **no `set_obj_transparency` opcode** in CE. The task description's
name does not correspond to a real CE opcode. The two existing visibility/
transparency-adjacent opcodes are:

| Opcode | Name | Args | CE handler | DH2 method | DH2 wired |
|--------|------|------|-----------|-----------|-----------|
| `0x80E3` | `set_obj_visibility` | `obj, invisible` (0=show, 1=hide) | `opSetObjectVisibility` `interpreter_extra.cc:2080` | `Script.set_obj_visibility` `scripting.ts:1213` | Yes — `vm_bridge.ts:133` |

`set_obj_visibility` sets or clears the `OBJECT_HIDDEN` flag (`object.cc:2096`).
In combat it also clears any outline on the object. It has nothing to do with
translucency — hidden objects are simply skipped by the render loop.

`OBJECT_TRANS_*` flags are set at load time from the PRO file and are **not
directly settable by script** in CE. Translucency type is a property of the
prototype, not runtime-scriptable.

### DH2 `set_obj_visibility`

`scripting.ts:1213`:
```typescript
set_obj_visibility(obj: Obj, visibility: number) {
    obj.visible = !visibility   // 0 = show, 1 = hide
}
```

DH2's `visible` field (`object.ts:43`) is checked in `objectRenderInfo`
(`renderer.ts:286`) and propagates to WebGL via `renderInfo.visible`.
The semantics match CE's `OBJECT_HIDDEN` behaviour.

---

## 8. Edge Cases (CE Behaviour)

| Scenario | CE behaviour |
|---|---|
| Multiple overlapping walls | Each wall is independently checked; egg masking applied to each whose screen rect intersects the egg. Can produce additive fade if several walls overlap. |
| Critter inside egg zone | Critters are not affected — `type == 2 || type == 3` check excludes type 1 (critters). Friendly NPCs standing in front of the player are drawn fully opaque. |
| Items on ground inside egg | Items (type 0) not affected. Dropped items near the player render opaque. |
| Objects with `OBJECT_FLAG_0xFC000` inside egg zone | Their permanent TRANS flag takes priority; egg mask is NOT applied. A glass window (`OBJECT_TRANS_GLASS`) in front of the player shows as glass-blended, not egg-masked. |
| Elevation change | `gEgg` is moved to the new elevation in the same `objectSetLocation` call that moves `gDude`. The roof `tile_fill_roof` system also resets on elevation change (`_obj_last_roof_x/y/elev` tracking). |
| During combat | No special handling — egg renders normally during combat turns. |
| `OBJECT_WALL_TRANS_END` flag | Modifies the wall-orientation condition: a wall with this flag at the "end" of a transparent run suppresses the egg for certain rotations, allowing the run to end cleanly at a corner. |
| Player hidden (`OBJECT_HIDDEN`) | Egg masking is suppressed — `(gDude->flags & OBJECT_HIDDEN) == 0` guard (`object.cc:4950`). |

---

## 9. DH2 Current Status

The egg system is **completely absent** from DH2. No component has been
implemented.

| Component | DH2 status |
|---|---|
| `gEgg` pseudo-object | Not created |
| Egg FRM loading (`OBJ_TYPE_INTERFACE` index 2) | Not loaded |
| Egg position tracking (follows player) | Not implemented |
| `tileIsInFrontOf` / `tileIsToRightOf` | Not implemented |
| Wall/scenery positional check | Not implemented |
| Egg screen-rect intersection test | Not implemented |
| `_intensity_mask_buf_to_buf` equivalent (WebGL) | Not implemented |
| `OBJECT_TRANS_*` flag rendering (glass, steam, etc.) | Not implemented (all objects drawn opaque) |
| `tile_fill_roof` roof skip | Not implemented (see [map_rendering.md §6](map_rendering.md)) |
| Egg masking on roof tiles | Not implemented |
| `set_obj_visibility` opcode | **Implemented** — `scripting.ts:1213`, `vm_bridge.ts:133` |

**Visual symptom**: Walls and large scenery objects in front of the player are
drawn fully opaque. The player character can be completely hidden behind a wall
with no transparency to indicate their position.

---

## 10. Known Gaps vs CE

| # | CE behaviour | DH2 status |
|---|---|---|
| 1 | Walls/scenery in front of player fade using egg FRM gradient mask | **Not implemented** — walls always opaque |
| 2 | Roof tiles at player's square rendered with egg circle cutout | **Not implemented** — roofs drawn fully opaque |
| 3 | `tile_fill_roof` skips interior roof tiles when player enters building | **Not implemented** (see map_rendering.md §6) |
| 4 | `OBJECT_TRANS_GLASS` objects render with glass blend table (50 % alpha-ish) | **Not implemented** — no blend table; all objects render with standard `SRC_ALPHA` |
| 5 | `OBJECT_TRANS_STEAM`, `_ENERGY`, `_RED`, `_WALL` — each uses its own palette blend table | **Not implemented** |
| 6 | `OBJECT_TRANS_NONE` objects still respect palette-index-0 transparency but are otherwise opaque | Partial — PNG alpha channel handles this correctly, but `OBJECT_TRANS_NONE` flag is never read |
| 7 | Critters inside the egg zone are still drawn opaque (intentional exclusion) | Correctly excluded by type check (moot since egg itself is missing) |
| 8 | `set_obj_transparency` as a script opcode | Does not exist in CE (no gap — the task description's name was incorrect). `set_obj_visibility` is the real opcode and **is** implemented in DH2. |
| 9 | `tileIsInFrontOf` / `tileIsToRightOf` geometry functions | Not present in DH2; needed for egg and also for correct combat sight-line logic |
| 10 | Egg is reset / repositioned on elevation change synchronously with player | N/A (egg not present), but elevation change is handled in `changeElevation` (`map.ts:196`) |
