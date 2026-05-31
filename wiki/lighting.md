# Lighting System

Documents the Fallout 2 lighting system — intensity scale, ambient light,
per-object light sources, propagation/blockers, night penalty, time-of-day
transitions, scripting opcodes, and render integration. Cross-reference
with [wiki/map_rendering.md §9 (Lighting Integration)](map_rendering.md) for
how tile intensity feeds into the WebGL render pipeline.

Ground-truth reference: `raw/fallout2-ce/src/light.cc`, `light.h`,
`object.cc` (`objectSetLight`, `_obj_adjust_light`), `map.cc` (map-load
ambient reset), `combat.cc` (night penalty), `interpreter_extra.cc`
(`set_light_level` and `obj_set_light_level` opcodes).

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

## 2. Ambient Light

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

- **Night Vision perk**: not applied to ambient in DH2 (CE gap — see §9).

---

## 3. Per-Object Light Sources

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
- **`objectGetLightIntensity(obj)`** (`object.cc:1748`): returns
  `max(ambient, tileIntensity)`, subtracting the object's own contribution
  from the tile if the object is the player.

### DH2 — object light fields

| Field | Default | Source |
|---|---|---|
| `Obj.lightRadius` | 0 | `object.ts:320`; player=4 (`player.ts:76`) |
| `Obj.lightIntensity` | 655 | `object.ts:321`; player=65536 (`player.ts:77`) |

Values are read from map JSON at load time (`object.ts:381-382`) via
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

## 4. Light Blockers

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

## 5. Night Penalty (Combat To-Hit)

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

**Not implemented.** `src/combat.ts:441` has the comment
`"light conditions not yet factored in"`.

---

## 6. Time-of-Day Lighting

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

DH2 adds a custom piecewise-linear day/night curve (documented in §2).
The curve runs continuously — ambient changes each frame as `getHour()` ticks
forward. This is a DH2 extension; CE has no equivalent.

Script `set_light_level` calls are blended with the curve via
`max(curveValue, scriptOverride)` rather than replacing it outright
(`gametime.ts:212`).

---

## 7. Scripting Opcodes

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

## 8. Render Integration

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
| `u_ambient` | — | `GameTime.getAmbientLightNormalized()` (0–1) | `setTileLighting(true)` (`webglrenderer.ts:1063`) |
| `u_tileIntensity` | 5 | 200×200 R8 texture — `Lightmap.tile_intensity` normalized to 0–255 | uploaded each frame (`webglrenderer.ts:511,647`) |
| `u_camera` | — | `globalState.cameraPosition.{x,y}` | `setTileLighting` |
| `u_zoom` | — | current zoom factor | `setTileLighting` |

For world draws (`lit=true`), the fragment shader recovers the hex-grid tile
for the current fragment from `gl_FragCoord` + `u_camera` + `u_zoom`, then
samples `u_tileIntensity` to get per-tile intensity, finally takes
`max(tileLight, u_ambient)`. UI draws (`lit=false`) receive `u_ambient=1.0`
which makes the max always 1.0 — no darkening.

The tile-intensity texture is uploaded once per frame in
`renderLitFloorCPU()` / `renderLitFloorGPU()` after
`Lightmap.rebuildDynamicLight()` has run (`webglrenderer.ts:504-514`).

Cross-reference: [wiki/map_rendering.md §9 (Lighting Integration)](map_rendering.md)
documents the GPU floor-lighting FBO path and `floorLightingMode` flag.

---

## 9. Known Gaps vs CE

| # | CE behaviour | DH2 status | Location |
|---|---|---|---|
| 1 | Night to-hit penalty (−10/−25/−40) when attacking in darkness | **Not implemented** | `combat.ts:441` comment |
| 2 | `obj_set_light_level` (0x8107) changes tile intensity at runtime | Method exists but **not wired** in `vm_bridge.ts`; even if called, does not call `obj_adjust_light` | `scripting.ts:1262`, `vm_bridge.ts` |
| 3 | Night Vision perk adds 20 %/rank to ambient (`LIGHT_LEVEL_NIGHT_VISION_BONUS`) | **Not applied** to ambient in DH2 | `light.cc:50`; perk defined in `perks.ts:125` but unused |
| 4 | No built-in day/night curve — only script-driven | DH2 adds a custom curve (`gametime.ts:181`). This is a DH2 extension beyond CE. | `gametime.ts` |
| 5 | `set_light_level` always applied (indoor and outdoor) | DH2 **silently ignores** it on outdoor maps | `gametime.ts:235` |
| 6 | CE `set_light_level` maps 0-100 through piecewise ramp (`intensities[3]`) | DH2 uses simpler linear remap across `[MIN, MAX]` — minor brightness difference | `gametime.ts:241` |
| 7 | Non-wall opaque scenery casts light shadow (the `edi=0` path in `_obj_adjust_light`) | **Commented out** in DH2 | `lightmap.ts:335-345` |
| 8 | Per-elevation tile intensity (`gTileIntensity[ELEVATION_COUNT][HEX_GRID_SIZE]`) | DH2 `tile_intensity` is a flat `40000`-entry array — **no elevation separation** | `lightmap.ts:37` |
| 9 | Solar Scorcher / flare AI: ambient threshold checks (0.95×MAX / 0.85×MAX) | Not implemented in DH2 AI | `combat_ai.cc:1772,2907` |
| 10 | `obj_set_light_level` intensity argument is 0–100 %; CE converts via `(v * 65636) / 100` | DH2 stores the raw integer directly without percentage conversion | `scripting.ts:1267` |
