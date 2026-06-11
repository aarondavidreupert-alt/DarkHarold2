# Lighting System

Documents the Fallout 2 lighting system — intensity scale, ambient light,
per-object light sources, propagation/blockers, night penalty, time-of-day
transitions, scripting opcodes, visibility interactions, and render integration.
Cross-reference with [wiki/rendering.md §3 (Tile Drawing & Object Order)](rendering.md)
for how tile intensity feeds into the WebGL render pipeline.
See also [wiki/known_bugs.md §LD](known_bugs.md) for open lighting bugs.

Ground-truth references: `raw/fallout2-ce/src/light.cc`, `light.h`,
`object.cc` (`objectSetLight`, `_obj_adjust_light`, `objectGetLightIntensity`,
`_obj_turn_off_light`, `_obj_turn_on_light`, `_obj_light_table_init`),
`obj_types.h` (`OBJECT_HIDDEN`, `OBJECT_LIGHTING`, `OBJECT_LIGHT_THRU`),
`map.cc` (map-load ambient reset), `combat.cc` (night penalty),
`interpreter_extra.cc` (`set_light_level`, `obj_set_light_level`,
`opSetObjectVisibility` opcodes), `combat_ai.cc` (Solar Scorcher / flare AI).

Last audited: 2026-06-02

---

## 1. Light Intensity Scale

Both CE and DH2 express all light values as integers in the range **0 –
65 536** (unsigned 16-bit ceiling). The scale is linear: 65536 = fully
lit, 0 = absolute black. A tile at ambient darkness still has a small
residual value (655, ≈ 1 % of max) rather than zero.

### CE constants (`raw/fallout2-ce/src/light.h`)

| Constant | Value | Notes |
|---|---|---|
| `LIGHT_INTENSITY_MIN` | 16384 (= 65536 / 4) | Lowest ambient `set_light_level` can produce (25 % of max) |
| `LIGHT_INTENSITY_MAX` | 65536 | Full brightness |
| `LIGHT_LEVEL_NIGHT_VISION_BONUS` | 13107 (= 65536 / 5) | Added to ambient per Night Vision perk rank |
| tile floor (unlit default) | 655 | Set by `lightResetTileIntensity()` in `light.cc:134` |

`LIGHT_INTENSITY_MIN` is the floor for the `set_light_level` opcode mapping
(0-100 → `MIN..MAX`), not the floor for tile intensity or the ambient curve.

### DH2 equivalents (`src/gametime.ts`)

| Constant | Value | Notes |
|---|---|---|
| `LIGHT_INTENSITY_MIN` | 16384 | Exact match with CE |
| `LIGHT_INTENSITY_MAX` | 65536 | Exact match |
| `LIGHT_CURVE_NIGHT_FLOOR` | ≈ 22938 (= 0.35 × 65536) | DH2-only night floor; deliberately above MIN so nights are visible |
| tile floor | 655 | Set by `Lightmap.light_reset()` (`lightmap.ts:33`) |

The fragment shader uses the **normalized** form (`0.0 – 1.0`) via
`GameTime.getAmbientLightNormalized()` (`gametime.ts:222`).

---

## 2. `light.cc` Tile Intensity API

CE exposes the per-tile intensity array through `light.cc`. The backing store is
`gTileIntensity[ELEVATION_COUNT][HEX_GRID_SIZE]` (`light.cc:20`) — a 3 × 40,000
integer array. All values start at the floor **655** (`lightResetTileIntensity`,
`light.cc:134`).

| Function | Address | Behaviour |
|----------|---------|-----------|
| `lightGetAmbientIntensity()` | 0x47A8F8 | Returns `gAmbientIntensity` (global scalar, not per-tile) |
| `lightSetAmbientIntensity(i, refresh)` | 0x47A908 | Adds Night Vision bonus, clamps to `[MIN, MAX]`, triggers `tileWindowRefresh()` if changed and `refresh=true` |
| `lightGetTileIntensity(elev, tile)` | 0x47A980 | Returns `min(gTileIntensity[elev][tile], 65536)` — **clamped** |
| `lightGetTrueTileIntensity(elev, tile)` | 0x47A9C4 | Returns raw `gTileIntensity[elev][tile]` — **may exceed 65536** when multiple light sources overlap |
| `lightSetTileIntensity(elev, tile, i)` | 0x47A9EC | Direct write — used during map load to inject baked tile data |
| `lightIncreaseTileIntensity(elev, tile, i)` | 0x47AA10 | `gTileIntensity[elev][tile] += i` — called by `_obj_adjust_light` when adding a source |
| `lightDecreaseTileIntensity(elev, tile, i)` | 0x47AA48 | `gTileIntensity[elev][tile] -= i` — called by `_obj_adjust_light` when removing a source |

**"True" vs clamped distinction.** `objectGetLightIntensity()` (`object.cc:1748`)
uses `lightGetTrueTileIntensity` (not the clamped version) to retrieve the tile's
raw accumulated value. This matters when two strong light sources overlap — the raw
sum can exceed 65536, and CE uses the full accumulated value for the self-subtraction
step (§5) before clamping the final result.

DH2 `tile_intensity` (`lightmap.ts:37`) stores raw accumulated values;
`light_add_to_tile` and `light_subtract_from_tile` perform unchecked
addition/subtraction. The normalized upload to GPU (`tile_intensity[i] / 65536`)
will silently clamp values above 1.0 in the shader's `max(tileLight, u_ambient)`.
This matches CE's clamped read path.

---

## 3. Ambient Light

Ambient is the global floor: any tile darker than ambient is rendered at
ambient brightness instead (both CE and DH2: `max(ambient, tileIntensity)`).

### CE — map load and script control

- **Map load** (`raw/fallout2-ce/src/map.cc:927`): every map load calls
  `lightSetAmbientIntensity(LIGHT_INTENSITY_MAX, false)` — ambient is
  always restored to max (fully lit) on every map change. Script
  darkness is re-applied by the new map's `map_enter_p_proc`.
- **`lightSetAmbientIntensity(intensity, shouldUpdateScreen)`**
  (`light.cc:48`):
  1. Adds `perkGetRank(gDude, PERK_NIGHT_VISION) × LIGHT_LEVEL_NIGHT_VISION_BONUS`.
  2. Clamps to `[LIGHT_INTENSITY_MIN, LIGHT_INTENSITY_MAX]`.
  3. If `shouldUpdateScreen` and value changed, calls `tileWindowRefresh()`.
- **No automatic day/night curve.** CE only changes ambient when a script
  calls `set_light_level`. The original game relies on outdoor encounter maps
  and cave maps scripting their own darkness.

### DH2 — map load and day/night curve

- **Map enter** (`src/scripting.ts:2161`): `GameTime.clearLightLevelOverride()`
  clears any script-set override, mirroring CE's reset on map load.
- **Day/night curve** (`src/gametime.ts:181-188`, DH2-only):

  ```
  LIGHT_CURVE_NIGHT_FLOOR ≈ 35 %
  
  00:00 ─┐
         │  night (35 %)
  04:00 ─┤
           \_ dawn ramp (4 h)
  08:00 ─┐
         │  day (100 %)
  18:00 ─┤
           \_ dusk ramp (4 h)
  22:00 ─┐
         │  night (35 %)
  24:00 ─┘
  ```

  Implemented as piecewise-linear interpolation in `curveAt()` (`gametime.ts:190`).

- **`getAmbientLight()` semantics** (`gametime.ts:212`): returns
  `max(curveValue, scriptOverride)`. A script that sets darkness (e.g. a
  blacked-out vault) pins a brightness *floor* for the area; the curve can
  still brighten it further at noon. Matches the indoor intent of the original
  `set_light_level` usage.

- **Outdoor maps** (`gametime.ts:235`): `setLightLevelOverride()` silently
  ignores `set_light_level` calls on outdoor maps (detected by
  `GameMap.isOutdoor()`) to prevent open-air map scripts from clamping noon
  to dusk.

- **Night Vision perk**: not applied to ambient in DH2 (CE gap — see §10 #3).

---

## 4. Per-Object Light Sources

Objects act as point lights: they illuminate the tiles around them in a
radius of up to 8 hexes with linearly decreasing intensity.

### CE — object light fields and setup

- Every `Object` has `lightDistance` (int, max 8) and `lightIntensity`
  (int, 0–65536), read from the PRO at load time (`object.cc:929`):
  `objectSetLight(obj, proto->lightDistance, proto->lightIntensity, nullptr)`.
- The player is initialized with `lightDistance=4, lightIntensity=65536`
  (`object.cc:345`).
- **`objectSetLight(obj, lightDistance, lightIntensity, rect)`**
  (`object.cc:1721`):
  1. Calls `_obj_turn_off_light` to subtract current contribution.
  2. Stores clamped distance (max 8) and new intensity.
  3. Calls `_obj_turn_on_light` → `_obj_adjust_light` to add new contribution.

Full call chain when a light source changes:

```
objectSetLight(obj, distance, intensity, rect)
  → _obj_turn_off_light(obj, rect)         // subtract current contribution
      → _obj_adjust_light(obj, isSub=1)    // lightDecreaseTileIntensity for each affected tile
  → obj->lightDistance = min(distance, 8)
  → obj->lightIntensity = intensity
  → _obj_turn_on_light(obj, rect)          // add new contribution
      → _obj_adjust_light(obj, isSub=0)    // lightIncreaseTileIntensity for each affected tile
```

- **`objectGetLightIntensity(obj)`** (`object.cc:1748`): returns
  `max(ambient, tileIntensity)`, subtracting the object's own contribution
  from the tile if the object is the player. See §5 for full formula.

### DH2 — object light fields

| Field | Default | Source |
|---|---|---|
| `Obj.lightRadius` | 0 | `object.ts`; player=4 (`player.ts:76`) |
| `Obj.lightIntensity` | 655 | `object.ts`; player=65536 (`player.ts:77`) |

Values are read from map JSON at load time (`object.ts`) via
`mobj.lightRadius` / `mobj.lightIntensity`.

### Propagation algorithm

Both CE and DH2 implement the same algorithm (DH2 port in `lightmap.ts:68`):

```
light_per_dist = (lightIntensity − 655) / (lightRadius + 1)

Ring 0 (origin tile):   lightIntensity           (full)
Ring 1 (adjacent):      lightIntensity − 1×step
Ring 2:                 lightIntensity − 2×step
…
Ring N (N ≤ lightRadius): lightIntensity − N×step
```

A 36-entry lookup table pre-computes the intensity for each of 36 positions
in the diamond-shaped light cone, expanded 6 times (one per hex direction).
The index array `_light_distance[36]` (both: `[1,2,3,4,5,6,7,8,2,3,…]`)
controls which ring each of the 36 cells belongs to.

CE source: `_obj_adjust_light` (`object.cc:3963`), `_obj_light_table_init`
(`object.cc:3433`).
DH2: `obj_adjust_light` (`lightmap.ts:68`), `obj_light_table_init`
(`lightmap.ts:365`).

### DH2 light rebuild strategy

DH2 separates static from dynamic lights to avoid rebuilding the full map
every frame:

| Function | When called | What it does |
|---|---|---|
| `bakeStaticLight()` | map load, elevation change | Resets `tile_intensity`, applies all non-critter objects, copies result to `staticTileIntensity` |
| `rebuildDynamicLight()` | once per render frame | Copies `staticTileIntensity` → `tile_intensity`, then adds critter lights |
| `resetLight()` | map load | Calls `light_reset()` + `obj_light_table_init()` |

Source: `lightmap.ts:553-583`.

---

## 4a. `_obj_adjust_light` Entry Guards

CE's `_obj_adjust_light` (`object.cc:3963`) is the single function that applies
or removes a light source from the tile intensity array. It has four early-exit
conditions that DH2 does not fully replicate:

```c
// object.cc:3963-3983
if (obj == nullptr)                          return -1;
if (obj->lightIntensity <= 0)                return -1;
if ((obj->flags & OBJECT_HIDDEN) != 0)       return -1;   // (A)
if ((obj->flags & OBJECT_LIGHTING) == 0)     return -1;   // (B)
if (!hexGridTileIsValid(obj->tile))          return -1;
```

### (A) `OBJECT_HIDDEN` guard

When an object is hidden via `set_obj_visibility`, CE sets `OBJECT_HIDDEN`
(`obj_types.h:46 = 0x01`) on the object. `_obj_adjust_light` bails immediately,
so **hidden objects contribute no light**. DH2's `obj_adjust_light` has no
`visible` check:

```typescript
// lightmap.ts:68 — DH2 obj_adjust_light
function obj_adjust_light(obj: Obj, isSub: boolean = false) {
    var pos = obj.position
    var lightModifier = isSub ? light_subtract_from_tile : light_add_to_tile
    lightModifier(toTileNum(obj.position), obj.lightIntensity)
    // … no check for obj.visible
```

`bakeStaticLight()` (`lightmap.ts:564`) iterates all non-critter objects
unconditionally and calls `obj_adjust_light` on each. An object with
`obj.visible = false` (set by `set_obj_visibility`) still radiates light in DH2.

### (B) `OBJECT_LIGHTING` guard

`OBJECT_LIGHTING = 0x20` (`obj_types.h:61`) is a flag set on objects that are
meant to emit light. CE bails if this flag is absent — objects without it never
contribute to the lightmap even if their `lightIntensity > 0`.

DH2 does not check this flag anywhere. Any object with `lightRadius > 0`
contributes light regardless of whether the PRO data had the LIGHTING flag set.

---

## 4b. `_obj_light_table_init` — Parity-Dependent Offset Table

`_obj_light_table_init()` (`object.cc:3433`) precomputes `_light_offsets[2][6][36]`
— a table of tile-number deltas from an origin tile to each of the 36 cells in the
light diamond, for two parity values (even-x and odd-x origin tiles).

```c
for (int s = 0; s < 2; s++) {           // s = origin parity (0 = even, 1 = odd)
    int v4 = gCenterTile + s;
    for (int i = 0; i < 6; i++) {       // i = rotation / hex direction
        int v15 = 8;                     // cells along this arm
        int* p = _light_offsets[v4 & 1][i];
        for (int j = 0; j < 8; j++) {   // j = arm step (lateral offset)
            int tile = tileGetTileInDirection(v4, (i+1) % 6, j);
            for (int m = 0; m < v15; m++) {
                *p++ = tileGetTileInDirection(tile, i, m+1) - v4;
            }
            v15--;
        }
    }
}
```

This is called once during `objectInit()` with `gCenterTile` as the seed. The
resulting table contains signed tile-number offsets valid for the current map's
200-wide grid. Offsets are parity-dependent because the hex grid's neighbor-offset
table differs for even-x and odd-x tiles (see [wiki/tile_system.md §5](tile_system.md)).

DH2's `obj_light_table_init()` (`lightmap.ts:365`) mirrors this logic. It is called
lazily on the first `obj_adjust_light()` invocation (init guard at `lightmap.ts:76`).

**CE caveat**: `gCenterTile` is the viewport center tile, not the object's tile. The
offsets are relative to `gCenterTile`, not to the object. When the table is used, each
offset is added to the object's tile number to get the destination tile. This means the
table must be regenerated whenever `gCenterTile` changes significantly — CE does this in
`tileSetCenter()`. DH2 initialises the table once and never regenerates it, which is
correct because the offsets are stable within a 200-wide grid regardless of `gCenterTile`.

---

## 5. `objectGetLightIntensity` — Self-Subtraction Formula

`objectGetLightIntensity(obj)` (`object.cc:1748`) computes the effective light level
at an object's location — used for the night to-hit penalty and the `obj_is_visible`
opcode:

```c
int ambientIntensity   = lightGetAmbientIntensity();
int tileIntensity      = lightGetTrueTileIntensity(obj->elevation, obj->tile);

if (obj == gDude) {
    tileIntensity -= gDude->lightIntensity;   // subtract player's own contribution
}

if (tileIntensity >= ambientIntensity)
    return min(tileIntensity, LIGHT_INTENSITY_MAX);   // tile is brighter than ambient
else
    return ambientIntensity;                           // ambient floor
```

The **self-subtraction** prevents the player from always appearing "well-lit" due to
their own torch. Without it, `objectGetLightIntensity(gDude)` would always return
near-max regardless of ambient.

DH2 has no equivalent of `objectGetLightIntensity`. The night-penalty path in
`combat.ts` has the comment `"light conditions not yet factored in"` and does
nothing. The self-subtraction is therefore not an issue in practice, but it would be
needed if the night penalty were ever implemented.

---

## 6. Light Blockers

During propagation, each cell in the 36-cell cone is tested against objects
on that tile. Walls and opaque objects stop light from reaching tiles behind
them.

### CE — blocking logic (`object.cc:4532-4603`)

For each destination tile:

1. If `v14 != 0` (blocked by shadow accumulation), skip the tile entirely.
2. Otherwise iterate objects on the tile. For each non-hidden object:
   - **`OBJECT_LIGHT_THRU` flag** (`0x20000000` in `flags`): if set, object
     does not block light (`isLightBlocked = 0`); otherwise `isLightBlocked = 1`.
   - **Wall objects** with `OBJECT_FLAT` unset: apply direction-dependent blocking
     based on PRO `extendedFlags`:
     - Bit 27 (`0x8000000`) or Bit 30 (`0x40000000`): N/S wall — blocks all
       directions except W, NW, and conditional NE (index < 8) / SW (index > 15).
     - Bit 28 (`0x10000000`): pass-through N/S — blocks all except NE and NW.
     - Bit 29 (`0x20000000`): E/W wall — blocks all except NE, E, W, NW, and
       conditional SW.
     - Default (no flags): blocks all except NE, E, and conditional NW (index ≤ 7).
   - **Non-wall opaque objects** (`isLightBlocked=1`) in rotation range E–SW
     (`rotation >= 2 && rotation <= 4`): set `edi = 0` (additional blocker).
3. If `edi != 0` (not additionally blocked), `adjustLightIntensity(tile, v28[index])`.
4. Regardless, `_light_blocked[rotation][index] = v14` is recorded for the
   shadow-accumulation pass used by farther cells.

Closed doors block light because they lack the `OBJECT_LIGHT_THRU` flag.

### DH2 — blocking logic (`lightmap.ts:287-357`)

DH2 mirrors CE's wall direction logic:

```typescript
// LightThru flag
isLightBlocked = (curObj.flags & 0x20000000 /* LightThru */) ? 0 : 1

// Wall direction-dependent blocking (same bit constants as CE):
// flags & 0x8000000 || flags & 0x40000000  → N/S wall
// flags & 0x10000000                        → pass-through N/S
// flags & 0x20000000                        → E/W wall
// else                                      → default wall
```

**Gap**: the non-wall opaque-object `edi=0` path is commented out in DH2
(`lightmap.ts:335-345`), meaning opaque scenery (non-wall, non-flat) does not
cast shadows in DH2 while it does in CE.

---

## 7. Night Penalty (Combat To-Hit)

CE applies a to-hit penalty when the **player** attacks a target in low light.

### CE formula (`raw/fallout2-ce/src/combat.cc:4447-4463`)

```
lightIntensity = objectGetLightIntensity(defender)
               = max(ambientIntensity, tileIntensity at defender's tile)

if weapon has PERK_WEAPON_NIGHT_SIGHT:
    lightIntensity = 65536  // bypass penalty

if lightIntensity ≤ 26214  (40 % of MAX)  →  toHit −= 40
if lightIntensity ≤ 39321  (60 % of MAX)  →  toHit −= 25
if lightIntensity ≤ 52428  (80 % of MAX)  →  toHit −= 10
```

Only applies when `attacker == gDude` (player-controlled).
AI-controlled attackers are not penalized.

### DH2 status

**Not implemented.** `src/combat/hitChance.ts` has the comment
`"light conditions not yet factored in"`.

---

## 8. Time-of-Day Lighting

### CE

No automatic curve. CE sets ambient to max on every map load
(`map.cc:927`) and relies on individual map scripts calling `set_light_level`
in `map_enter_p_proc` to darken the area. There is no tick-by-tick ambient
transition in CE.

The only time-related check is in AI logic:
- Solar Scorcher: only "has ammo" if ambient > 95 % of max
  (`combat_ai.cc:1772`).
- AI flare use: triggered if ambient < 85 % of max (`combat_ai.cc:2907`).

### DH2

DH2 adds a custom piecewise-linear day/night curve (documented in §3).
The curve runs continuously — ambient changes each frame as `getHour()` ticks
forward. This is a DH2 extension; CE has no equivalent.

Script `set_light_level` calls are blended with the curve via
`max(curveValue, scriptOverride)` rather than replacing it outright
(`gametime.ts:212`).

---

## 9. `set_obj_visibility` Opcode and Lighting Interaction

| Item | CE | DH2 |
|------|----|----|
| Opcode | `0x80E3` | `0x80E3` |
| Args | `obj, invisible_flag (0/1)` | same |
| CE handler | `opSetObjectVisibility` (`interpreter_extra.cc:2080`) | — |
| DH2 handler | — | `Script.set_obj_visibility` (`scripting.ts:1213`) |
| Wired | Yes — `vm_bridge.ts:133` | Yes (same line) |

### CE behaviour (`interpreter_extra.cc:2080`)

When `invisible != 0` (hide):
1. If object is not already hidden and game is not loading:
2. `objectDisableOutline` + `objectClearOutline` (combat only)
3. `objectHide(obj, &rect)` → sets `OBJECT_HIDDEN | OBJECT_NO_SAVE`, subtracts from lightmap via `_obj_turn_off_light`
4. If critter: also sets `OBJECT_NO_BLOCK`
5. `tileWindowRefreshRect` to redraw

When `invisible == 0` (show):
1. `objectShow(obj, &rect)` → clears `OBJECT_HIDDEN | OBJECT_NO_SAVE`, adds back to lightmap via `_obj_turn_on_light`
2. If critter: clears `OBJECT_NO_BLOCK`
3. `tileWindowRefreshRect`

### DH2 behaviour (`scripting.ts:1213`)

```typescript
set_obj_visibility(obj: Obj, visibility: number) {
    obj.visible = !visibility
}
```

Differences vs CE:
- **No light update** — CE calls `_obj_turn_off_light` / `_obj_turn_on_light`
  through `objectHide`/`objectShow`. DH2 only toggles `obj.visible`. The object's
  light contribution is not removed from the lightmap, and `bakeStaticLight` is not
  triggered. Hidden objects still illuminate tiles.
- **No `OBJECT_NO_BLOCK`** — CE removes critters from pathfinding when hidden.
  DH2 leaves the collision flag unchanged.
- **No `OBJECT_NO_SAVE`** — CE tags hidden objects to skip save serialisation.
  DH2 serialises `obj.visible` in the save JSON.

---

## 10. Scripting Opcodes

### Full table

| Opcode | Name | Args | CE handler | DH2 method | DH2 wired |
|--------|------|------|-----------|-----------|-----------|
| `0x80E9` | `set_light_level` | `level` (0–100) | `opSetLightLevel` `interpreter_extra.cc:2233` | `Script.set_light_level` `scripting.ts:1255` | Yes — `vm_bridge.ts:111` |
| `0x8107` | `obj_set_light_level` | `obj, intensity, distance` | `opSetObjectLightLevel` `interpreter_extra.cc:3058` | `Script.obj_set_light_level` `scripting.ts:1262` | **No** — missing from `vm_bridge.ts` |

There is no `get_light_level`, `ambient_light`, or `get_obj_light_level`
opcode in CE or DH2.

### `set_light_level` — 0–100 mapping

CE `interpreter_extra.cc:2241-2264`:
```
intensities[0] = LIGHT_INTENSITY_MIN   (16384)
intensities[1] = (MIN + MAX) / 2       (40960)
intensities[2] = LIGHT_INTENSITY_MAX   (65536)

level == 50  →  intensities[1]
level  > 50  →  intensities[1] + level × (MAX − MID) / 100
level  < 50  →  intensities[0] + level × (MID − MIN) / 100
```

DH2 `gametime.ts:241-243`:
```typescript
const t = clamped / 100  // 0..1
lightLevelOverride = LIGHT_INTENSITY_MIN + t * (LIGHT_INTENSITY_MAX - LIGHT_INTENSITY_MIN)
```

DH2 uses a simpler linear remap across the full `[MIN, MAX]` range rather
than CE's piecewise two-segment ramp. The practical difference is small —
both yield `LIGHT_INTENSITY_MAX` at `level=100` and `LIGHT_INTENSITY_MIN`
at `level=0`.

### `obj_set_light_level` — per-object light

CE `interpreter_extra.cc:3071`: converts `intensity` from 0–100 percentage
to the raw scale via `(lightIntensity * 65636) / 100` (note: typo `65636`
rather than `65536` in the original — a known bug, ≈ 0.15 % brightness
error at max).

DH2 `scripting.ts:1262-1268`: stores `intensity` and `distance` directly on
the object but **does not call `obj_adjust_light`** to propagate the new
value into `tile_intensity`. As a result, `obj_set_light_level` calls from
scripts have no visible effect on floor lighting at runtime until the next
full `bakeStaticLight()` rebuild, and even then only if the object is
non-critter.

Additionally, the opcode is not wired in `vm_bridge.ts` (missing
`0x8107: bridged("obj_set_light_level", 3)`), so the bytecode never reaches
the handler.

---

## 11. Torch Flicker — Not Present

Fallout 2 CE has no torch-flicker effect. There is no time-based variation of
`lightIntensity` or `lightDistance` for any object type in the CE codebase. All
light is static between script calls. Objects with animated fire FRMs (candles,
campfires) appear to flicker because the sprite animates — the light radius does
not change.

DH2 likewise has no flicker. The `rebuildDynamicLight()` function
(`lightmap.ts:576`) is called every render frame but only reapplies static
critter-light values — it does not animate them.

---

## 12. Render Integration

### CE — palette darkening

CE is a software-rendered game. Each object's draw call receives a
`lightIntensity` integer (`object.cc:796,835`):

```cpp
lightIntensity = std::max(ambientIntensity,
    lightGetTileIntensity(elevation, obj->tile));
_obj_render_object(obj, &rect, lightIntensity);
```

Inside `_obj_render_object`, the lightIntensity selects entries from a
pre-baked colour-shift table (`intensityColorTable`) that remaps each
256-colour palette entry to a darker shade. There is no per-pixel
calculation; darkness is baked into palette lookup.

### DH2 — WebGL shader

DH2 uses a real-time fragment shader for all lighting (`shaders/fragment.glsl`):

```glsl
float tileLight = texture2D(u_tileIntensity, uv).r;  // 0..1 from R8 texture
float light     = max(tileLight, u_ambient);           // enforce ambient floor
gl_FragColor    = vec4(texel.rgb * light, texel.a);   // multiply into RGB
```

Key uniforms:

| Uniform | Unit | Value | Set by |
|---------|------|-------|--------|
| `u_ambient` | — | `GameTime.getAmbientLightNormalized()` (0–1) | `setTileLighting(true)` (`webglrenderer.ts`) |
| `u_tileIntensity` | 5 | 200×200 R8 texture — `Lightmap.tile_intensity` normalized to 0–255 | uploaded each frame (`webglrenderer.ts`) |
| `u_camera` | — | `globalState.cameraPosition.{x,y}` | `setTileLighting` |
| `u_zoom` | — | current zoom factor | `setTileLighting` |

For world draws (`lit=true`), the fragment shader recovers the hex-grid tile
for the current fragment from `gl_FragCoord` + `u_camera` + `u_zoom`, then
samples `u_tileIntensity` to get per-tile intensity, finally takes
`max(tileLight, u_ambient)`. UI draws (`lit=false`) receive `u_ambient=1.0`
which makes the max always 1.0 — no darkening.

The tile-intensity texture is uploaded once per frame in
`renderLitFloorCPU()` / `renderLitFloorGPU()` after
`Lightmap.rebuildDynamicLight()` has run (`webglrenderer.ts`).

Cross-reference: [wiki/rendering.md §3 (Tile Drawing & Object Order)](rendering.md)
documents the GPU floor-lighting FBO path and `floorLightingMode` flag.

---

## 13. Known Gaps vs CE

| # | CE behaviour | DH2 status | Location |
|---|---|---|---|
| 1 | Night to-hit penalty (−10/−25/−40) when attacking in darkness | **Not implemented** | `combat.ts` comment |
| 2 | `obj_set_light_level` (0x8107) changes tile intensity at runtime — CE calls `objectSetLight()` which triggers the full turn-off/turn-on cycle and refreshes the screen rect | Opcode **not wired** in `vm_bridge.ts`; even if called, `scripting.ts:1267` stores intensity/distance on object but never calls `obj_adjust_light()` or triggers `bakeStaticLight()` — lightmap is stale until next map reload | `scripting.ts:1262`, `vm_bridge.ts` |
| 3 | Night Vision perk adds 20 %/rank to ambient (`LIGHT_LEVEL_NIGHT_VISION_BONUS`) | **Not applied** to ambient in DH2 | `light.cc:50`; perk defined in `perks.ts` but unused |
| 4 | No built-in day/night curve — only script-driven ambient | DH2 adds a custom curve (`gametime.ts:181`). This is a DH2 extension beyond CE. | `gametime.ts` |
| 5 | `set_light_level` always applied (indoor and outdoor) | DH2 **silently ignores** it on outdoor maps | `gametime.ts:235` |
| 6 | CE `set_light_level` maps 0-100 through piecewise ramp (`intensities[3]`) | DH2 uses simpler linear remap across `[MIN, MAX]` — minor brightness difference | `gametime.ts:241` |
| 7 | Non-wall opaque scenery casts light shadow (the `edi=0` path in `_obj_adjust_light`) | **Commented out** in DH2 | `lightmap.ts:335-345` |
| 8 | Per-elevation tile intensity (`gTileIntensity[ELEVATION_COUNT][HEX_GRID_SIZE]`) | DH2 `tile_intensity` is a flat `40000`-entry array — **no elevation separation** | `lightmap.ts:37` |
| 9 | Solar Scorcher / flare AI: ambient threshold checks (0.95×MAX / 0.85×MAX) | Not implemented in DH2 AI | `combat_ai.cc:1772,2907` |
| 10 | `obj_set_light_level` intensity argument is 0–100 %; CE converts via `(v * 65636) / 100` (note: CE typo, should be 65536) | DH2 stores the raw integer directly, giving 100× too dim a result when scripts pass percentage values | `scripting.ts:1267` |
| 11 | **Hidden objects do not emit light** — `_obj_adjust_light` bails when `OBJECT_HIDDEN` is set; CE `objectHide`/`objectShow` call `_obj_turn_off_light`/`_obj_turn_on_light` | `bakeStaticLight()` and `rebuildDynamicLight()` do not check `obj.visible` — hidden objects still illuminate tiles; `set_obj_visibility` does not update the lightmap | `lightmap.ts:564,576`; `scripting.ts:1213` / `object.cc:3973`; `interpreter_extra.cc:2096-2119` |
| 12 | `OBJECT_LIGHTING` flag (`0x20`) must be set for an object to contribute light | DH2 does not check this flag — any object with `lightRadius > 0` contributes light regardless of PRO data | `lightmap.ts:68` / `object.cc:3977`; `obj_types.h:61` |
| 13 | `objectGetLightIntensity` self-subtraction: player's own torch is excluded from the tile intensity used for night penalty | No DH2 equivalent — moot while night penalty is absent (gap #1), but needed if it is ever implemented | `combat.ts` / `object.cc:1748` |

<!-- audited: 2026-06-02 -->
