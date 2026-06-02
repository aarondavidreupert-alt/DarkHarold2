# Rendering Deviations — DH2 vs CE

Single authoritative catalogue of every known deviation between DH2's WebGL 2.0 renderer and CE's software renderer. Documentation only — no source changes.

Cross-references: `wiki/map_rendering.md` (pipeline overview), `wiki/lighting.md` (lighting overview), `wiki/lighting_deep_dive.md` §7 (scripting-level lighting gaps LD1–LD6), `wiki/known_bugs.md §21` (this section's bug registry).

---

## 0. Why Deviations Exist — Context for Contributors

### What is the architectural gap?

CE is a fixed-resolution (640 × 480) software renderer running on a CPU pixel buffer. Every draw call is a memcpy with a per-pixel palette table lookup — "darkening" a sprite means looking up a precomputed `intensityColorTable[colour_index][intensity_step]` array that maps a palette entry to a darker or lighter palette entry. There is no GPU, no floating-point colour, and no shader pipeline.

DH2 renders in WebGL 2.0. The GPU rasterises textured quads; colour values are 32-bit float RGBA; lighting is applied as a scalar float multiply in the fragment shader. The indexed-palette model is fundamentally absent at the hardware level. Any deviation that originates from this difference is **architectural** — it cannot be made identical to CE without emulating a software renderer in a canvas2D fallback, which the project explicitly rejects.

### Which deviations are intentional extensions?

Three categories of deviation are deliberate improvements, not bugs:

1. **Dynamic resolution** — CE's fixed 640 × 480 is unsuitable for modern displays. DH2 adapts to any browser window and supports high-DPI via `devicePixelRatio`.
2. **Camera zoom** — CE has no zoom. DH2 adds a `[0.5, 3.0]` configurable range. This does not affect game logic.
3. **Automatic day/night ambient curve** — CE drives ambient intensity only through scripts (`set_global_lighting`, `set_ambient_intensity`). On maps without those script calls DH2 would be pitch black at night. The `gametime.ts` piecewise curve provides a reasonable fallback without overriding explicit script values.

**Do not "fix" these deviations toward CE behaviour.** They are architecture requirements or deliberate quality-of-life improvements.

### Decision rule for future work

Before changing any rendering behaviour, ask:

**(a)** Is this deviation causing a visible gameplay problem or a scripting-correctness problem?  
**(b)** Is the fix feasible within the WebGL 2.0 pipeline without a full rewrite?

If both yes → fix. If cosmetic/imperceptible → accept. If unsure → mark ❓ and investigate CE ground truth first.

---

## 1. Rendering Architecture Overview

### CE Software Renderer (`tile.cc`, `object.cc`, `color.cc`)

```
Frame:
  1. bufferFill            — clear dirty rect (CPU memset)
  2. tileRenderFloorsInRect — blit square floor tiles from art cache (no intensity)
  3. _obj_render_pre_roof   — per-tile isometric walk; OBJECT_FLAT first, then all others
                              Each sprite: intensityColorTable[palette[px]][lightLevel/512]
  4. tileRenderRoofsInRect  — blit roof tiles (full palette; no intensity applied)
  5. _obj_render_post_roof  — objects above roofline at full intensity (0x10000)
  6. blit to screen
```

Lighting is applied per-pixel at draw time via `intensityColorTable[256][256]` (`color.cc:68`) — a precomputed 256 × 256 palette-remap table. `intensityIndex = lightIntensity / 512` (0–127 = darker, 128–255 = lighter).

### DH2 WebGL 2.0 Renderer (`webglrenderer.ts`, `renderer.ts`, `shaders/`)

```
Frame:
  1. gl.clear()
  2. renderFloor           — floor quads via floorLightShader (3 modes: CPU/GPU/screen-space)
  3. renderObjects         — sorted object quads via tileShader
  4. renderRoof            — roof quads via tileShader (roofDummyTexture on unit 5)
  5. UI / float messages / cursor
```

Lighting in the fragment shader (`fragment.glsl:51`):
```glsl
float light = max(getWorldTileLight(), u_ambient);
gl_FragColor = vec4(texel.rgb * light, texel.a);
```

`getWorldTileLight()` derives a continuous hex UV from `gl_FragCoord` and samples the 200 × 200 R8 `u_tileIntensity` texture (value / 255 normalised, ≈ intensity / 65536).

---

## 2. Deviation Table

| ID | System | CE Behaviour | DH2 Behaviour | Root Cause | Severity | Status |
|----|--------|-------------|---------------|------------|----------|--------|
| RD01 | Lighting model | Per-pixel palette-table darkening: `intensityColorTable[pal_idx][intensity/512]` (`object.cc:2771`); integer colour remapping, 256 × 256 look-up | Per-pixel float multiply: `rgb × max(tile_intensity/65536, ambient)` (`fragment.glsl:51`); continuous float colour | WebGL has no indexed palette; float multiply is the closest analogue | low | ✅ Accepted |
| RD02 | Viewport resolution | Fixed 640 × 480; `windowWidth / windowHeight` hard-wired (`tile.cc:674`) | Dynamic: `setScreenSize()` on `resize` event (`renderer.ts:53`); high-DPI via `devicePixelRatio` | Browser requirement | — | ✅ Accepted |
| RD03 | Camera zoom | Fixed 1× | Configurable `[ZOOM_MIN=0.5, ZOOM_MAX=3.0]` via `cameraZoom`; affects `viewW`, `viewH`, and all shader uniforms | DH2 extension | — | ✅ Accepted |
| RD04 | Day/night ambient | No automatic curve; ambient is set exclusively by scripts (`set_global_lighting`, `set_ambient_intensity`) | Piecewise-linear 24-hour curve in `gametime.ts`; 35 % floor at midnight, 100 % at noon; drives `u_ambient` | DH2 extension to prevent pitch-black on maps without ambient scripts | low | ✅ Accepted |
| RD05 | Floor lighting — texture filter | Sharp per-hex boundary: each tile's pixel gets exactly the integer intensity for that hex cell | GPU mode: LINEAR-filtered 200 × 200 tile-intensity texture; bilinear interpolation between adjacent hex centres (`fragmentLighting.glsl:35`) | GPU `LINEAR` filter is unavoidable with texture sampling; creates smooth gradients instead of CE's sharp edges | low | ✅ Accepted |
| RD06 | Roof clipping | `tile_fill_roof` flood-fills all connected square roof tiles when player walks under a building; re-evaluated each frame (`object.cc:1445`) | All roof tiles rendered unconditionally in `renderRoof()` (`webglrenderer.ts:965`); `Config.ui.showRoof` is all-or-nothing | Not implemented; `map.hasRoofAt()` exists but not wired to per-position clipping | major | ⚠️ Known Bug |
| RD07 | OBJECT_FLAT — two-pass | `_obj_render_pre_roof` renders OBJECT_FLAT objects (floor decals, blood) in a dedicated first pass before all non-flat objects (`object.cc:761`) | All objects rendered in one sorted pass; OBJECT_FLAT not read by renderer | Not implemented | minor | ⚠️ Known Bug |
| RD08 | Post-roof object pass | `_obj_render_post_roof` draws any object that must appear above roofs at full intensity (0x10000) after the roof layer (`object.cc:862`) | No post-roof pass; no object can render above the roof layer | Not implemented | minor | ⚠️ Known Bug |
| RD09 | Object depth sort | Two-phase isometric sort: `_obj_preload_sort` + `_obj_order_comp_func_even/odd` using `tileIsInFrontOf` / `tileIsToRightOf`; correct for all 6 hex directions (`object.cc:761`) | `objectZCompare` (`object.ts:182`): primary hex-y, secondary hex-x, tertiary walls-first; fails on NE/SW diagonal hex borders | Simplification | minor | ⚠️ Known Bug |
| RD10 | Color cycling | `colorCycleInit` / `colorCycleEnable` drives time-based palette rotation for water surfaces and fire objects (`color.cc`) | Not implemented; water and fire sprites are static colour | Not implemented | minor | ⚠️ Known Bug |
| RD11 | Scroll blocking | `gTileScrollBlockingEnabled` + `OBJECT_SCROLL_BLOCK` flag prevents viewport scrolling through certain scenery barriers | No scroll-block logic in `renderer.ts` camera update | Not implemented | minor | ⚠️ Known Bug |
| RD12 | Scroll border limiting | `gTileBorderMin/MaxX/Y` clamps viewport to usable tile area; computed from grid and window size (`tile.cc:537`) | Camera clamps to world min (0, 0) but has no computed max border; can scroll to show grey beyond map edge | Not implemented | low | ⚠️ Known Bug |
| RD13 | Hex click hit-testing | `_tile_mask[512]` lookup table (32 × 16 px, 5 sub-regions) gives pixel-precise edge detection at hex diamond corners (`tile.cc:718`) | Cube-coordinate rounding in `hexFromScreen` (`geometry.ts:135`); approximation at hex boundaries | Simplification | low | ⚠️ Known Bug |
| RD14 | Elevation transition | Visual fade effect between elevation levels | Instant switch; no transition (`map.ts:196 changeElevation`) | Not implemented | low | ⚠️ Known Bug |
| RD15 | Roof tile lighting | `tileRenderRoofsInRect` blits roof tiles at full palette intensity — unaffected by any light source or time of day | Roofs bind `roofDummyTexture` (1 × 1, zeroed) on unit 5 → `max(0, ambient) = ambient`; roofs dim at night (`webglrenderer.ts:989`) | DH2 implementation detail — see §5 Q1 for CE ground-truth question | low | ❓ Unknown |
| RD16 | Object-lighting scripting | See `wiki/known_bugs.md §20` entries LD1–LD6 for all scripting-level lighting deviations (hidden objects, OBJECT_LIGHTING flag, `obj_set_light_level`, `set_obj_visibility`) | (cross-reference) | — | — | ⚠️ Known Bug (→ LD1–LD6) |

---

## 3. Accepted Deviations — Rationale

**RD01 — Float multiply vs palette LUT.**  
`intensityColorTable` remaps 6-bit palette colours to physically darker palette entries. In WebGL, textures are 32-bit RGBA; there is no palette index to look up. The float multiply `rgb × scale` is mathematically equivalent for linear colour values and visually indistinguishable at typical monitor gamma. CPU lighting mode additionally uses `Lighting.colorLUT` (loaded from `lut/color_lut.json`) to apply the original 6-bit colour quantisation for accurate tone matching.

**RD02 — Dynamic resolution.**  
Fixed 640 × 480 is unacceptable in a browser. `setScreenSize()` keeps all viewport math consistent on window resize. No game logic depends on exact pixel dimensions.

**RD03 — Camera zoom.**  
CE has no zoom. DH2's `[0.5, 3.0]` range is a usability feature. The zoom is a pure viewport scale — it does not affect tile coordinates, pathfinding, or scripting. It is safe to keep.

**RD04 — Automatic day/night ambient curve.**  
CE leaves ambient entirely to scripts. Many shipped maps do not call `set_global_lighting` at all; without the automatic curve DH2 would be pitch black at the wrong time of day. The `gametime.ts` piecewise curve is a polyfill for absent script coverage. When a script explicitly calls `set_global_lighting`, that value replaces the automatic curve value for the duration of the map stay (via `globalState.ambientOverride`). This matches player expectations without breaking CE-authored lighting scripts.

**RD05 — GPU bilinear floor lighting.**  
CE's per-tile light is sharp: every pixel inside a hex gets exactly that hex's integer intensity. The GPU path in DH2 uses `LINEAR` filtering on the 200 × 200 tile-intensity texture, which bilinearly interpolates between adjacent hex centres. The resulting soft gradient is visually pleasing and architecturally unavoidable when sampling a texture at sub-texel precision. The CPU path (`renderLitFloorCPU`) does apply discrete per-tile values, matching CE more closely at a higher per-frame cost.

---

## 4. Known Bugs — Fix Priority

Listed in descending order of gameplay impact.

### Priority 1 — Visually blocking

| Bug | File(s) | Why it matters |
|-----|---------|----------------|
| **RD06 Roof clipping** | `webglrenderer.ts:965`, `map.ts:135` | Players can see through roofs of every building on every map. `map.hasRoofAt()` already exists; a per-frame flood-fill from the player's square tile is the missing piece. |

### Priority 2 — Visible gameplay deviations

| Bug | File(s) | Why it matters |
|-----|---------|----------------|
| **RD09 Object depth sort** | `object.ts:182` | On NE/SW hex diagonals, objects overlap in the wrong order — a critter may appear behind a wall it is actually standing in front of. Affects readability in combat. |
| **LD3, LD6** (see §20) | `scripting.ts:1262,1267` | `obj_set_light_level` does not update the lightmap and mis-scales intensity by 100×. Major scripting correctness issue. |

### Priority 3 — Visual polish

| Bug | File(s) | Why it matters |
|-----|---------|----------------|
| **RD07 OBJECT_FLAT pass** | `renderer.ts:119` | Floor decals (blood splats, flat items) are sorted with wall-height objects; may appear behind objects that should visually rest on top of them. |
| **RD08 Post-roof pass** | `renderer.ts:119` | Objects tagged for post-roof rendering will never appear above the roof layer. Requires first auditing shipped maps for actual usage (see §5 Q2). |
| **RD10 Color cycling** | — | Static water and fire lack the original animated shimmering effect. Cosmetic only. |

### Priority 4 — Minor correctness

| Bug | File(s) | Why it matters |
|-----|---------|----------------|
| **RD11 Scroll blocking** | `renderer.ts` | Players can scroll the viewport through barriers that are meant to block the camera. |
| **RD12 Scroll border limiting** | `renderer.ts` | Camera can expose grey canvas beyond the map edge. |
| **RD13 Hex hit-testing** | `geometry.ts:135` | Click registration is imprecise at hex boundaries; usually imperceptible but affects small/adjacent objects. |
| **RD14 Elevation transition** | `map.ts:196` | Abrupt elevation switches look jarring. |

### Investigate before prioritising

| Bug | Why investigation is needed |
|-----|-----------------------------|
| **RD15 Roof tile lighting** | CE ground truth unclear — see §5 Q1. May be accepted or a bug depending on findings. |

---

## 5. Open Questions

**Q1 — RD15: Does CE render roofs at full intensity or ambient-adjusted?**  
`tileRenderRoofsInRect` in CE blits roof tiles directly without calling `_obj_render_object` (which applies `intensityColorTable`). If confirmed, CE roofs are always full-bright regardless of time of day or point lights. DH2 roofs dim at night with `u_ambient`. This difference would be visible on all outdoor maps at night. Investigate `tile.cc` to confirm the CE call chain, then decide: accept (roofs look better dim) or fix (bind a full-intensity dummy texture for roofs).

**Q2 — RD08: Are post-roof objects used in any shipped Fallout 2 map?**  
`_obj_render_post_roof` iterates a `_postRoofTable`. If no vanilla script or map data populates this table, RD08 has zero practical impact on shipped content and can stay at lowest priority. Run a grep of extracted map JSON for any object with the post-roof flag set to determine real-world impact before investing in a fix.

**Q3 — RD07: Which OBJECT_FLAT objects appear in shipped maps?**  
Quantifying how many floor decals (blood, flat items, certain scenery) exist in practice calibrates priority for the two-pass fix. If OBJECT_FLAT objects are sparse and their z-fighting with non-flat objects is imperceptible in practice, the fix may safely stay deprioritised.

**Q4 — RD05: Should NEAREST filtering be used for CE-accurate sharp light edges?**  
The GPU tile-intensity texture currently uses `LINEAR` filter. Switching to `NEAREST` would produce hard per-hex boundaries matching CE's sharp light model at no performance cost. The only trade-off is visual: gradients vs sharp edges. This is a one-line change in `webglrenderer.ts` and the decision is aesthetic, not correctness-critical.

---

Last audited: 2026-06-02
