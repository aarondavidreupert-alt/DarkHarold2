# Roadmap to 100%

Ordered by impact and dependency. Each phase is a coherent chunk of work that
unlocks the next. Phases 1–3 are pure connectivity — the engine infrastructure
already exists, these wire it up. Phases 4–5 introduce the only genuinely new
systems still needed. **Phase 10 (added 2026-07-04) collects everything the
original 95% target deliberately excluded — the remaining ~5–6% needed for true
100% parity with Fallout 2.**

**Last audited: 2026-07-04**
Current estimate: **~94% complete** (was ~93% at 2026-06-25; the 2026-06-26→07-02
rendering/lighting-alignment sprint closed the hex-parity light-sampling block —
LD7/LD11/RD17 + `alignment.md` §6–§8: parity-aware shader inverse, `hex-lerp`
interpolation, W-E wall occlusion, `wall-clamp` object lighting — plus earlier
2026-06-11→25 sprints: companion/dialogue state machine P5–P24, barter, worldmap
W11/W12, Pip-Boy IW10/IW11, roof RD06, egg RD16, outline CI11–CI15).
Target: **100%** (full parity with Fallout 2 including the immersion, presentation,
and edge-case systems the 95% target set aside). The 95% milestone — a playable
end-to-end run through the main quest with companions, working scripted content,
and correct combat — is essentially met; Phase 10 tracks the remainder.

Phases 1–7 are now mostly complete. Phase 8 (rendering) is largely closed after
the 2026-07-02 lighting-alignment sprint; a handful of visual-only items remain.
Phase 9 collects the remaining tractable gaps across subsystems. Phase 10 —
**Path to 100%** — enumerates every gap beyond the 95% line, grouped by subsystem.

---

## Infrastructure

Work completed since the roadmap was written to support ongoing development. Not
game features, but prerequisites for reliable iteration.

- ✅ **Wiki Layer** (`wiki/` directory) — 38 audited docs covering all major systems
  with CE citations and DH2 gap inventories. Lookup order: wiki/ → CE source → ask.
- ✅ **CODEBASE.md** — post-audit source map with Known Gaps inventory; maintained
  in CLAUDE.md via the CODEBASE.md Maintenance rule.
- ✅ **CLAUDE.md update rules** — Wiki Layer lookup order and CODEBASE.md surgical
  edit rule added to project instructions.

---

## Phase 1 — Script Hook Connectivity ✅ Done
**Goal:** Script procedures actually fire when the engine expects them to.

### 1a. `damage_p_proc` and `destroy_p_proc` ✅ Done
### 1b. `reg_anim_func` + animation scripting ✅ Done
### 1c. `get_month` and `get_day` ✅ Done
### 1d. Object removal queue ✅ Done
### 1e. `reg_anim_func` callback interleaving ✅ Done

---

## Phase 2 — Dialogue Completeness ✅ Done
**Goal:** All standard NPC dialogue patterns work end-to-end.

### 2a. `gsay_message` ✅ Done
### 2b. `gSay_Start` / `gsay_start` ✅ Done
### 2c. `gdialog_set_barter_mod` ✅ Done

---

## Phase 3 — Scripting Stubs (P2 batch)
**Goal:** The remaining P2 stubs that scripted content depends on.

| Opcode | Status | Notes |
|---|---|---|
| `obj_art_fid` | ✅ Done | `vm_bridge.ts:130`, `scripting.ts:1201` |
| `art_anim` | ✅ Done | `vm_bridge.ts:118`, `scripting.ts:1209` |
| `obj_item_subtype` | ✅ Done | `vm_bridge.ts:123`, `scripting.ts:1180` |
| `tile_contains_pid_obj` | ✅ Done | `vm_bridge.ts:115`, `scripting.ts:1337` |
| `tile_is_visible` | ✅ Done | `vm_bridge.ts 0x80f8`, `scripting.ts:1347` |
| `set_exit_grids` | ✅ Done | `vm_bridge.ts:0x80E6`, `scripting.ts:1306` |
| `game_ui_disable` / `game_ui_enable` | ✅ Done | `vm_bridge.ts:160–161`, `scripting.ts:1789–1793` |
| `wm_area_set_pos` | ✅ Done | `vm_bridge.ts:96`, `scripting.ts:1782` |
| `critter_attempt_placement` | ✅ Done | `vm_bridge.ts:101`, `scripting.ts:851` |
| `proto_data` critter fields | ✅ Done | Wired `vm_bridge.ts`; all item and critter `data_member` IDs handled; name/description cases added 2026-06-02. Ref: `interpreter_extra.cc opGetProtoData` |
| `has_trait` | ✅ Done | TRAIT_OBJECT all cases (5,6,10,666,669=weight) handled 2026-06-02. Ref: `interpreter_extra.cc opHasTrait` |
| `do_check` | ✅ Done | CE `stat.cc statRoll()` — d10 roll, SPECIAL stat + modifier — `scripting.ts:839` |
| `using_skill` | ✅ Done | SKILL_SNEAK (8) on player returns `isSneaking`; others return 0 — `scripting.ts:836` |
| `inven_cmds` | ✅ Done | All INVEN_CMD_* cases handled 2026-06-02. Ref: `interpreter_extra.cc opInvenCmds` |
| `set_pc_stat` | ✅ Done | All PCSTAT IDs (0–4) handled 2026-06-02. Ref: `stat.cc pcSetStat` |
| `mod_pc_stat` | ✅ Done | All PCSTAT IDs (0–4) handled 2026-06-02. Ref: `scripts.cc opModifyPcStat` |
| `metarule` | 🟡 Partial | IDs 9,13,14,15,16,17,18,19,22,40,44,45,46,47,48,49,50,51 handled; car-related IDs 30/31/32/52/53 still stub (car system absent). Ref: `interpreter_extra.cc opMetarule` |
| `metarule3` | 🟡 Partial | IDs 100,103,106,107,108 handled (107 added 2026-06-04 — ART_SET_BASE_FID_NUM via lookupArt); others stub. Ref: `interpreter_extra.cc opMetarule3` |
| `critter_add_trait` | ✅ Done | TRAIT_PERK (kind=0) added 2026-06-04 — player-only via applyPerk/perks.splice; TRAIT_OBJECT cases handled 2026-06-02. Ref: `interpreter_extra.cc opAddTrait` |
| `anim` | ✅ Done | Reverse direction (param ≠ 0) wired through animBatch 2026-06-04 — passed to `singleAnimation(reversed)`. IDs 1000/1010 + types 0–64 handled 2026-06-02. Ref: `interpreter_extra.cc opAnim` |
| `get_critter_stat` | ✅ Done | STAT_AGE (33) added 2026-06-04 — `25 + gameTime / TICKS_PER_YEAR`. SPECIAL 0–6, MaxHP/MaxAP/AC, Sequence, CritChance, BetterCriticals, DT/DR ranges all handled. Ref: `interpreter_extra.cc opGetCritterStat` |

---

## Phase 4 — Combat Correctness
**Goal:** Combat produces the right outcomes; AI behaves like FO2.

### 4a. AI team targeting ✅ Done
- `teamNum` assigned from proto AI packet at critter load — `object.ts:1290`.
- `findTarget()` filters by `x.teamNum !== obj.teamNum` — `combat.ts:1058`.
- Ref: `ai.cc aiGetAttackTarget()`

### 4b. Perk crit bonuses ✅ Done
- **Better Criticals**: +30 per rank applied.
- **Slayer**: every melee hit auto-critical.
- **Sniper**: d10 ≤ LUK → critical (FIXED 2026-06-02; was d100).
- **Crit level formula**: CE non-uniform breakpoints (FIXED 2026-06-02).
- Ref: `combat.cc:3891 rollCriticalHit()`, `combat.cc:4102 attackComputeCriticalHit()`

### 4c. Melee critical table 🟡 Partial
- Melee crit `DM` is halved (`max(2, floor(DM/2))`) — `combat.ts:538`.
- Separate melee critical effects table not used — single table for all weapons.
- Ref: `combat.cc` critical hit table indices

### 4d. `damage_p_proc` timing ✅ Done
### 4e. DAM_DROP ✅ Done (verified 2026-06-02)
### 4f. Party member combat AI ✅ Done (2026-06-02)

### 4g. AI packet system wired ✅ Done
- `src/aiPackets.ts`: `ai.txt` parser, `getAiPacket(num)`, 18 fields, 7 enum types.
- **AttackWho**, **RunAwayMode**, **BestWeapon**, **DistanceMode=STAY** all implemented.
- **Perception gate (C12)**: critters check LoS before attacking (FIXED 2026-06-02).
- **SNIPE distance (C13)**: sniper critters maintain optimal range (FIXED 2026-06-02).
- **STAY_CLOSE distance**: companion stays within 5 tiles of player (FIXED 2026-06-04).
- **YAAM formula (C3)**: armour-penetration capped per CE (FIXED 2026-06-02).
- **Sequence formula (C11)**: `2 * PER + Fast Shot bonus` (FIXED 2026-06-02).
- **Melee location penalty (C4)**: halved per CE (FIXED 2026-06-02).
- Remaining gaps: friendly-fire / line-of-fire blockers for AoE.
- Ref: `wiki/ai_behavior.md §9`

---

## Phase 5 — Minimal Deferred Systems
**Goal:** The four systems marked "deliberately deferred" that are required for
a believable playthrough.

### 5a. Drug/chem effects and addiction ✅ Done
### 5b. Poison and radiation decay loops ✅ Done

### 5c. Party / companion follow logic 🟡 Partial
- `party.ts` has `followPlayer()` (CHA size cap enforced).
- ✅ followPlayer now pathfinds to nearest free hex adjacent to player (2026-06-04).
- ✅ `dismissPartyMember` helper added; `party_remove` opcode silently no-ops on
  non-party objects per CE (2026-06-04).
- **Missing**: companion inventory from HUD, level-up, formation pathfinding.
- Ref: `wiki/companion_party.md §1,2,4,5`

### 5d. Minimal NPC wander schedules 🟡 Partial
- ✅ Wander radius now differentiated (2026-06-04): type 1=radius 5, type 2=15,
  type 3=unrestricted, around lazily captured spawn position.
- Day-night schedules deferred.
- Ref: `ai.cc aiMoveSteps()`

---

## Phase 6 — Polish and Type Hygiene
**Goal:** Correctness, stability, and maintainability.

- ✅ `Obj.serialize()` equipment round-trips correctly.
- ✅ Spatial trigger LVARs serialized/restored.
- ✅ `get_month`/`get_day` save round-trip.
- ✅ **Preferences screen** — `ui_options.ts` (434 lines): difficulty, running, audio,
  volume sliders, `localStorage` persist/restore.
- ✅ **Healer perk** — `skillUse.ts:227–230` (+4/+10 HP per rank for First Aid/Doctor).
- ✅ Encounter difficulty roll adjustments (W2 FIXED 2026-06-02).
- ✅ Karma title computation — `ui_character.ts:581–624`.
- ✅ `Melee Weapons` skill name remapped on deserialize.
- ✅ Encounter formations (straight_line/double_line/wedge/cone) — W6 FIXED 2026-06-02.
- ✅ Encounter-spawned critters carry items/equipment (W3 FIXED 2026-06-03).
- ✅ Encounter condition eval: level, time_of_day, operators — W5 FIXED 2026-06-02.
- ✅ Outdoorsman detection XP — W7 FIXED 2026-06-02.
- ✅ Reload AP cost: `Weapon.getReloadAPCost()` — Fast Reload perk + Solar Scorcher
  exceptions — IW6/U4 FIXED 2026-06-03.
- ✅ `rollSkillCheck` uses `[1,100]` range per CE (RN4 FIXED 2026-06-03).
- ✅ `jam_lock` opcode (0x814D) + `objectUnjamAll()` at midnight (IU3 FIXED 2026-06-03).
- ✅ Gambling/Outdoorsman skill use return proper refusal messages (K2 FIXED 2026-06-03).
- ✅ Hex line-beyond (`hexLineBeyond`) — CE Bresenham screen-space walk (TS3 FIXED 2026-06-03).
- ✅ Dead `tile_coord()` function removed (TS4 FIXED 2026-06-03).
- 🔴 **Town faction deltas** — per-town rep table absent; NPC reaction modifiers absent.
  Global karma display ✅; town-level display not. Ref: `reputation.cc`
  *(✅ FIXED 2026-07-04 — see **R2** in Phase 10d for the full writeup.
  `set_global_var()` now syncs town-rep GVAR writes to `player.stats`, so the
  pre-existing reputation panel populates; an off-by-one in the title
  thresholds was also found and fixed.)*
- 🔴 **Type annotations**: `Obj.type`, `Obj.pro`, `Obj.art`, `Obj.extra`, `Obj.anim`,
  `globalState.proMap`, `Critter.weapon` — still `any`.
  *(🟡 Partial — re-verified 2026-07-04, and 3 of these 7 turned out to already
  be resolved: `Obj.type`/`Obj.art` are already plain `string` (not `any`);
  `Critter.weapon` doesn't exist as a field — `leftHand`/`rightHand: WeaponObj`
  are the real, already-properly-typed fields. Of the 4 genuinely still `any`,
  fixed **`globalState.proMap`** (shaped object, zero new tsc errors) and
  **`Obj.anim`** (`string | null`, matching the precedent already set by
  `Obj.type`/`Obj.art` in the same class). `Obj.pro`/`Obj.extra` remain `any`
  by deliberate choice — see **Q-any** in Phase 10l for why a full discriminated
  union is a much larger, separate effort, not attempted here.)*

---

## Phase 7 — Save/Load Completeness ✅ Mostly Done

### 7a. MVAR persistence ✅ Done
### 7b. WorldMap `knownAreas` persisted ✅ Done
### 7c. Timed event queue persistence ✅ Done (2026-06-02)
### 7d. `obj_set_light_level` wired ✅ Done

---

## Phase 8 — Rendering Gaps

> **Lighting-alignment sprint ✅ (2026-06-26 → 2026-07-02).** The largest remaining
> rendering block — the hex-parity light-sampling family — is now closed. All three
> artifacts traced to `hexToScreen` being a per-column-parity map (not single-affine):
> **RD17/§6** light *centring* (parity-aware shader inverse `150.0416667` / `−75.9375`
> even ⁄ `−75.4375` odd), **§7** interpolation *stripes* (selectable `setLightingBilinear`,
> default `hex-lerp` — 3-tap barycentric in axial space), **LD11/§8** W-E wall *occlusion*
> bleed (read `pro.extra.extendedFlags`, not `pro.flags`). Also added: `wall-clamp`
> object-light mode (default), selectable `objectLightingMode`, `LD7` piecewise
> `set_light_level`, and `LD8`/`LD9` alternative propagation modes. Full derivation:
> `wiki/alignment.md §6–§8`. The remaining Phase 8 items (8b/8d/8f/8g/8h) are visual-only
> and are re-collected into Phase 10f.

### 8a. Egg transparency system ✅ FIXED 2026-06-15/17/18
- CE 4-case `extendedFlags` branch (`isCEOccludingWall`) wired for `'egg'` mode;
  `'alpha'` mode uses `hexDistance` radial check. `extendedFlags` now extracted for
  walls and scenery by `tools/proto.py readWall()`. Cache-busting + `clearAssetCache()`
  console command added.
- Ref: `object.cc:4949 _obj_render()`; `proto.cc protoRead() case OBJ_TYPE_WALL`.

### 8b. Flat object two-pass rendering 🔴 Missing (RD07/RD08)
- CE renders `OBJECT_FLAT` objects (floor decals, blood) in a dedicated first pass.
- Also missing: post-roof object pass (`_obj_render_post_roof` at full intensity).
- **Re-verified 2026-07-04:** a post-roof pass exists **for outlines only** (CI11,
  `webglDraw.ts:605`); the general flat/full-intensity passes are still absent.
- Ref: `object.cc:761 _obj_render_pre_roof()`; `object.cc:862 _obj_render_post_roof()`
- → tracked for 100% as **RD07/RD08** in Phase 10f.

### 8c. Object depth sort ✅ FIXED 2026-06-04
- `objectZCompare` now uses `hexIsInFrontOf` (CE `tile.cc:854 tileIsInFrontOf`)
  on tile screen coords. Wall-priority preserved when tiles coincide; hex-y/x
  fallback only on ambiguous cases. NE/SW diagonals no longer mis-sort.
- Ref: `object.cc:761`; `tile.cc tileIsInFrontOf()`

### 8d. Color cycling absent 🔴 (RD10)
- CE `colorCycleEnable/Disable` drives palette rotation for water and fire.
- **Re-verified 2026-07-04:** no `colorCycle*` in `src/` or `shaders/`.
- Ref: `color.cc colorCycleEnable()`
- → tracked for 100% as **RD10** in Phase 10f.

### 8e. Scroll blocking / border limiting ✅ FIXED 2026-06-04
- `clampCameraPosition` enforces map-edge bounds (RD12) and reverts any
  scroll that would put a misc PID 12 marker (CE OBJECT_SCROLL_BLOCK,
  `0x500000C`) under the viewport center (RD11).
- Ref: `tile.cc tileSetCenter()`; `object.cc:2559 _obj_scroll_blocking_at`

### 8f. Hex click hit-testing approximate 🔴 (RD13)
- CE uses `_tile_mask[512]` (32×16 px, 5 sub-regions) for pixel-precise edges.
- DH2 uses cube-coordinate rounding — imprecise at hex boundaries.
- **Re-verified 2026-07-04:** no `tile_mask` in `src/`.
- Ref: `tile.cc:718 tileFromScreenXY()`
- → tracked for 100% as **RD13** in Phase 10f.

### 8g. Elevation transition instant 🔴 (RD14)
- CE fades between elevation levels; DH2 switches immediately.
- **Re-verified 2026-07-04:** `GameMap.changeElevation()` (`map/GameMap.ts:224`)
  swaps levels with no fade.
- Ref: `map.cc mapSetElevation()`
- → tracked for 100% as **RD14** in Phase 10f.

### 8h. Roof tile lighting deviation 🔴 (RD15)
- CE appears to blit roofs at full intensity (no `intensityColorTable`).
- DH2 roofs dim at night via `roofDummyTexture`.
- **Re-verified 2026-07-04:** unchanged; see `alignment.md §3` caveat.
- Ref: `tile.cc tileRenderRoofsInRect()`
- → tracked for 100% as **RD15** in Phase 10f.

---

## Phase 9 — Remaining Tractable Gaps

All items below have a clear CE reference and bounded scope. Ordered within each
subsystem by severity. Tracks the ~55 open items in `wiki/known_bugs.md` not
covered by Phases 1–8.

### 9a. Inventory / Item mechanics

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| LE1 | ✅ FIXED 2026-06-04 — `Obj.canCarry` enforced at loot drag/Take All and ground pickup. | `item.cc:322 itemAttemptAdd()` | major |
| LE4 | ✅ FIXED 2026-06-04 — `WeaponObj.approxEq` compares ammoPID+rounds; loaded≠unloaded stacks. | `item.cc:357 _item_identical()` | minor |
| LE5 | 🟡 Investigated 2026-07-04 — not a bounded fix; surfaced a real `.amount` semantics inconsistency between `reloadWeapon()` (rounds) and barter pricing (boxes) instead. See Phase 10k for the full writeup. | `item.cc:322 itemAdd()` | minor |
| LE6 | ✅ FIXED 2026-06-04 — `Scripting.pickup` now fires when an item is dropped into a hand slot. | `inventory.cc:4102,4494` | minor |

### 9b. Pathfinding

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| P7 | ✅ FIXED 2026-06-04 — `hasLineOfSight` blocks on walls+scenery lacking `OBJECT_LIGHT_THRU`; skips hidden. | `object.cc:2583` | minor |
| P5 | ✅ FIXED 2026-06-04 — `recalcPath` marks all 6 neighbours blocked for MULTIHEX (0x800) objects. | `object.cc:2413` | low |
| P6 | ✅ FIXED 2026-06-04 — `hexLinecast` skips dead critters, `OBJECT_SHOOT_THRU`, hidden, non-blocking. | `object.cc:2440` | minor |
| P2 | **No rotation-change step cost.** CE adds +10 to node cost on direction change (outside combat). | `animation.cc:1838` | low |
| P4 | ✅ FIXED 2026-06-04 — `pathBlocks()` allows closed-unlocked doors; LoF still blocks (`blocks()`). | `animation.cc:1805` | minor |
| P3 | **No radioactive goo tile penalty.** CE adds +100 (gecko) / +400 (others) on goo PID tiles. | `animation.cc:1852` | low |
| P8 | 🟡 Partial — IMPROVED 2026-07-04. Correction: `make_path` isn't a real CE script opcode (only the internal `_make_path` C++ function exists, never exposed to scripts). `make_straight_path`/`obj_blocking_at` now wired for BLOCK/SHOOT blocking types; AI/SIGHT/SCROLL types remain stub, each needing infrastructure DH2 lacks (see Phase 10h for detail). | `sfall_opcodes.cc:914-967` | low |

### 9c. Scripting

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| S11 | ✅ FIXED 2026-06-04 — reverse direction wired through animBatch → `singleAnimation(reversed)`. | `interpreter_extra.cc:3355` | minor |
| S14 | ✅ FIXED 2026-07-04 — non-batch path now applies `delay*100ms` via `setTimeout`, mirroring the batch path (CE has no batch-vs-standalone distinction; verified against `opRegAnimAnimate`). | `animation.cc:1374` | minor |
| S26 | **`get_poison`/`poison` script read/write work; no CE-accurate decay loop.** (`main.ts` decrements 1/cycle, CE is more complex.) | `critter.cc critterPoisonCheck` | minor |
| S15 | **`play_gmovie` is a no-op.** `.mve` video playback infrastructure absent. | `movie.cc` | minor |
| S27 | **`radiation_dec` deliberately deferred.** | `radiation.cc` | minor |
| GTC5 | 🟡 Investigated 2026-07-05, deliberately not attempted — turned out to be more than a movie trigger. `_scriptsCheckGameEvents()` (`scripts.cc:438-490`) isn't just "play a cutscene": crossing an ARTIMER day threshold applies real, one-time gameplay consequences independent of playback — `wmAreaSetVisibleState(CITY_ARROYO, 0)` + `wmAreaSetVisibleState(CITY_DESTROYED_ARROYO, 1)` (Arroyo replaced by "Destroyed Arroyo" on the worldmap) and a flat `GVAR_TOWN_REP_ARROYO -= 15` penalty, gated by a per-movie "seen" flag DH2 has no equivalent of. The movie-playback half is correctly out of scope (S15, already deferred), but the consequence half is a real, separable, missing feature. Blocked on an unresolved detail: the day thresholds (`gMovieTimerArtimer1-4`) are only ever populated from Sfall config (`configGetInt` with no in-source default) — the true vanilla-CE default day counts aren't visible in `raw/fallout2-ce/src/`, and guessing wrong would apply an unwanted worldmap change + rep penalty at the wrong time. Also unverified: whether DH2's real (git-ignored) `city.txt` even has a "Destroyed Arroyo" area entry to swap to. Left open pending those two answers rather than guessed at. | `scripts.cc:405,438-490 gameTimeEventProcess/_scriptsCheckGameEvents` | minor |

### 9d. Interface / HUD

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| IW1 | ✅ FIXED — stale duplicate of the row below (the original "no indicator bars" line predates the fix); superseded, kept for history. | `interface.cc` | minor |
| IW1 | ✅ FIXED 2026-06-04, updated 2026-06-11 — `#indicatorBar` shows all 5 CE badges in correct order (ADDICT/SNEAK/LEVEL/POISONED/RADIATED); LEVEL badge on unspent skill points; radiation threshold corrected to ≥65; bad/good colour coding (red/green). | `interface.cc indicatorBarRefresh` | major |
| IW2 | ✅ FIXED 2026-06-04 — `drawAP` dims `#attackButton` (opacity+grayscale) when AP < cost or not player turn. | `interface.cc interfaceRenderActionPoints()` | minor |
| IW3 | ✅ FIXED 2026-06-11 — mode cycle is `single → called → burst → reload`; called mode auto-opens `uiCalledShot()`. Target-highlight outlines refresh immediately on cycle. | `interface.cc` | minor |
| IW4 | ✅ FIXED 2026-06-04 — `game_ui_disable/enable` toggle `#bar` visibility in addition to input block. | `interface.cc` | minor |
| IW7 | ✅ FIXED 2026-06-04 — `drawAP` opacity-fade transitions for `apLight` slots. | `interface.cc interfaceRenderActionPoints()` | low |
| IW9 | ✅ FIXED 2026-06-13 — `showInventory()` deducts `4 - 2×quickPocketsRank` AP on first open during combat. | `inventory.cc:570` | minor |
| U3 | ✅ FIXED 2026-06-04 — `captureScreenshot()` draws WebGL canvas to 160×100 JPEG; stored on `SaveGame.screenshot`. | `loadsave.cc` | minor |

### 9e. Config / Preferences

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| CI3 | ✅ FIXED 2026-06-11 — `combatSpeed` range changed to 0–50 (CE: 0=fastest, 50=slowest); animation boost now inverted `fps += (50-speed)*0.2`. | `game_config.h:44` | low |
| CI4 | ✅ FIXED 2026-06-04 — `doAlwaysRun` default = false, matching CE. | `settings.h:38` | low |
| CI5 | **Preferences in localStorage, not fallout2.cfg.** Lost in private browsing. | `settings.cc:118` | minor |
| CI6 | ✅ FIXED 2026-06-11 — `speechVolume` added to `HTMLAudioEngine`, persisted in `SavedPreferences`, slider in prefs panel. | `settings.cc:93` | low |
| CI7 | **`item_highlight` setting absent.** CE allows toggling item-highlight on hover. | `game_config.h:37` | low |
| CI8 | ✅ FIXED 2026-06-11 — `target_highlight` is now full 3-state enum `'off'|'targeting-only'|'on'` matching CE 0/1/2; prefs cycle order corrected; legacy boolean load migration preserved. | `game_config.h:111` | low |
| CI9 | ✅ FIXED 2026-06-11 — `textBaseDelay` (1.0–6.0 s) added to `Config.ui`, preferences slider added, persisted in `SavedPreferences`. | `settings.h:42` | low |
| CI10 | ✅ FIXED 2026-06-11 — `player_speedup` checkbox added to `Config.engine.playerSpeedup`; prefs panel checkbox wired; `critterAnimation.ts` skips player FPS boost when disabled. | `preferences.cc player_speedup` | low |

### 9f. Combat (remaining)

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| C10 | ✅ FIXED — verified 2026-07-04 in `combat/Combat.ts`: `getActiveUnarmedMode(ForHand)` selects the mode, `getUnarmedDamageDone` reads `mode.minDmg/maxDmg`, `mode.penetrate` applies the DT-bypass, and `mode.critBonus` adds to crit chance. `known_bugs` already marked fixed; ROADMAP row was stale. | `unarmed.cc` | minor |
| C8 | ✅ FIXED 2026-06-04 — wander caps by type (5/15/∞ hex) around spawn origin. | `ai.cc aiMoveSteps()` | minor |
| C13 | ✅ FIXED 2026-06-04 (STAY_CLOSE wired); CHARGE remains the default. | `combat_ai.cc` | minor |

### 9g. Worldmap

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| W9 | ✅ FIXED 2026-07-04 — root cause was a fixed 22/21px offset between CE's town-map blit origin and its window-relative entrance-button coordinates; see Phase 10e for the full writeup. | `worldmap.cc:5886,5917-5921` | minor |
| W8 | **Car travel system entirely absent.** No fuel, no speed multipliers, no encounter rate reduction. | `worldmap.cc:5984 wmCarUseGas()` | major |
| W10 | ✅ FIXED 2026-07-04, path bug fixed 2026-07-05 — `.msk` files are fetched directly at runtime (no pipeline changes needed — `data/data/*.msk` ships as raw binary in the DAT archives, same as `worldmap.txt`) and checked before each worldmap movement step; travel halts in place at the boundary instead of walking through. See Phase 10e for the full writeup. | `worldmap.cc:1337 wmGrabTileWalkMask()` | minor |

### 9h. Lighting

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| GTC10 | **Day/night ambient light curve is a DH2 invention.** CE has no clock-driven ambient. | `light.cc`, `map.cc:927` | low |
| LD5 | **`objectGetLightIntensity` self-subtraction absent.** Prevents self-illumination artefacts. | `object.cc:1748` | low |

### 9i. Reputation / Economy

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| R2 | ✅ FIXED 2026-07-04 (regression fixed 2026-07-05) — CE has no generic engine-side "NPC reaction modifier" system for town rep at all (verified: only plain GVARs scripts read directly, one hardcoded exception in `scripts.cc`). Fixed the real gap: `set_global_var()` now syncs town-rep GVAR writes to `player.stats`, so the pre-existing (but previously always-empty) reputation display panel populates. Also fixed an off-by-one in the title-threshold boundaries found while verifying. **Regression**: the sync wrote via `setBase()` without registering the 19 `Rep_*` names in `statDependencies`, so the panel's `getBase()` read-back crashed the character screen the first time a script touched any town's GVAR — fixed by registering them (`skills.ts`). | `game_vars.h GVAR_TOWN_REP_*`; `character_editor.cc:4582-4599` | minor |

### 9j. Skills / Locks

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| K4 | ✅ Investigated 2026-07-04 — not a real gap; CE's `skillGetValue()` has no tool-bonus logic at all, only per-door scripts do (already supported via the wired `roll_vs_skill` opcode). See Phase 10k for the full writeup. | `skill.cc:230-269` | minor |
| EL3 | ✅ FIXED — verified 2026-07-04 in `ui_elevator.ts:134-142`: after travel, hexes within radius 5 of the arrival tile with door PIDs (153/421/470) are reset to `frame=0`/`open=false`. `known_bugs` already marked fixed; ROADMAP row was stale. Gauge-animation interpolation (EV1) remains a separate low-pri gap. | `scripts.cc:926` | low |
| EL4 | **`_map_data_elev_flags` bitmask not in DH2 map format.** Empty elevations can't be represented. | `map.cc:81` | low |

### 9k. Endgame

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| EG3 | **Panning slide uses linear timing.** CE computes ms/pixel from image width and speech duration. | `endgame.cc:337` | low |
| EG4 | **`endgame_movie` skips credits music and text.** CE plays `akiss.acm` + `credits.txt`. | `endgame.cc:234` | minor |
| EG5 | **Death ending slide is a black screen.** CE plays narrator over the death scene. | `critter.cc:912` | low |

### 9l. Asset Pipeline (Python — separate process)

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| PS2 | ✅ FIXED 2026-07-04 — removed `FO1` flag; `readCritter()` reads `damageType` unconditionally per CE `critter.cc:1064` (the killType-based skip had no CE basis); short-read (2 vanilla protos) falls back to `DAMAGE_TYPE_NORMAL` matching CE's own EOF handling. Requires pipeline re-run to take effect; combat consumption (`getUnarmedDamageDone`) still hardcodes `'Normal'` — separate open follow-on. | `critter.cc:1064-1091` | major |
| FA3 | 🟡 Partial — FIXED 2026-07-04 extraction-side. `readFRMInfo()`/`exportFRMs()` now preserve `actionFrame` into `imageMap.json` (scalar for single-.FRM, per-direction array for split `.FR0`-`.FR5` sets — verified against CE `art.cc:1063` that it's read per-sub-file-header, unlike `fps`/`numFrames`). Requires pipeline re-run; combat/animation consumption not wired yet — separate follow-on. | `art.h ArtFrame.actionFrame`; `art.cc:1063` | major |
| PS3 | 🟡 Partial — FIXED 2026-07-04. Found `TileProto` has no `lightDistance`/`lightIntensity` fields at all (unlike the other 5 proto types) — CE's true common prefix is only `pid`/`messageId`/`fid`; naively bolting on a tile branch would have misaligned the byte stream. `readPRO()` now special-cases tiles correctly; added missing `"tiles"` entry to `exportPRO.py`'s scan list (confirmed via wiki + `convertPRO.py` precedent). Requires pipeline re-run; terrain-cost consumption still hardcoded — separate follow-on. | `proto_types.h TileProto`; `proto.cc:1663,1719` | low |
| PS4 | ✅ FIXED 2026-07-04 — `readPRO()` now dispatches `TYPE_MISC` to `readMisc()` (extendedFlags), matching CE exactly. Wall `extra` already done (RD16). Requires pipeline re-run to take effect. | `proto_types.h MiscProto` | low |

### 9m. Animation

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| FA6 | 🟡 Partial → **substantially implemented** (verified 2026-07-04, docs were stale). `Weapon.getSkin()` (`critter/Weapon.ts:355`) maps weapon `animCode` → FRM letter suffix (a/d/e/f/g/h/i/j/k/l/m); `Weapon.getAnim()` composes the per-stance path (`idle→Xa`, `walk→Xb`, `attack→X+attackSkin`, `weapon-draw→Xc`, `weapon-holster→Xd`); `critterAnimation.ts:146` uses `equippedWeapon` to select the armed FRM set, gated by `Config.engine.doUseWeaponModel` (default **on**). This is the `buildFid()`-equivalent path — critters DO change pose on equip. Remaining for 100%: per-weapon FRM-coverage completeness and holster/draw sequencing not fully audited end-to-end. | `art.cc buildFid()`; `art.h ART_TYPE_CRITTER` | medium |

---

## What is NOT required for 95%

> **These are now enumerated with full status detail in Phase 10 (Path to 100%).**
> This list is retained for the 95%-milestone framing; Phase 10 is the source of
> truth for what remains.

These are real FO2 systems but not on the critical path to a playable main quest run:

- **Subtitles / speech audio playback** — immersion, not correctness
- **Full NPC day-night schedules** — minimal wander (Phase 5d) is enough
- **Perk selection screen** — ✅ already implemented (`ui_character.ts:1866 showPerkModal`)
- **Full companion level-up UI** — companions work without it
- **Town reputation / faction tracking** — affects NPC reactions but not quest completion
- **Save slot screenshots**
- **Car travel system** — main quest areas accessible on foot
- **Color cycling / water animation** — visual only
- **`_tile_mask` pixel-precise hit-testing** — cube rounding sufficient for play

---

## Dependency order summary

```
Infrastructure (wiki, CODEBASE.md, CLAUDE.md)
    └─ Phase 1 (script hooks) ✅
        └─ Phase 2 (dialogue) ✅
            └─ Phase 3 (stub batch — mostly done) ✅/🟡
                └─ Phase 4 (combat correctness — mostly done) ✅/🟡
                    └─ Phase 5 (deferred systems — partially done) ✅/🟡
                        └─ Phase 6 (polish — partially done) ✅/🔴
Phase 7 (save/load completeness) ✅
Phase 8 (rendering gaps) ✅ (lighting-alignment block closed 2026-07-02) / 🟡 (visual-only remainder)
Phase 9 (remaining tractable gaps) 🟡/🔴
Phase 10 (path to 100% — deferred/parity systems) 🔴  [independent of 1–9; not on the playable-run critical path]
```

---

## AUDIT FINDINGS
*Forensic comparison of CE `src/interface.cc` + `src/preferences.cc` vs DH2 `src/ui_hud.ts` / `src/ui_options.ts`. Audited 2026-06-11.*

### AF-HUD — interface.cc gaps

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| AF1 | **Indicator bar is DOM text, not FRM sprites.** CE renders badge FRMs (e.g. `intrface/idxbadge.frm`) at fixed pixel offsets in the HUD. DH2 uses `<span>` elements above the bar. | `interface.cc indicatorBarDraw()` | low |
| AF2 | **INDICATOR_SLOTS_COUNT = 6, but DH2 has no slot reservation.** CE allocates 6 fixed pixel slots; badges slide into position 0–5. DH2 has no slot concept — badges just flex. | `interface.cc:2890 INDICATOR_SLOTS_COUNT` | low |
| AF3 | **HP/AC digit sprites use custom backgroundPosition trick, not CE's `buf_to_buf` blit.** Functionally equivalent but doesn't use pre-baked FRM digit sprites from `numeron.frm`. | `interface.cc interfaceRenderHitPoints()` | low |
| AF4 | **AP pip sprites hardcode `hlgrn.png`/`hlred.png`; CE picks FRM by AP state per slot.** Missing: "move AP" (yellow) pips correctly matching CE interface — CE uses separate ap_active/ap_move/ap_empty FRMs. DH2 approximates with hlyel. | `interface.cc interfaceRenderActionPoints()` | low |
| AF5 | **Ammo bar widget renders 55 px fill; CE uses a 4-frame FRM strip for each increment.** Cosmetic difference only. | `interface.cc interfaceRenderAmmoBar()` | low |
| AF6 | **`interfaceBarEndButtonsEnable/Disable` not fully wired.** CE dims End Turn / End Combat buttons via a separate FRM; DH2 uses CSS opacity. | `interface.cc` | low |
| AF7 | **`interfaceRenderItemBars` (item condition bars) absent.** CE renders two small bars under equipped weapon for condition. | `interface.cc interfaceRenderItemBars()` | minor |
| AF8 | **Combat hover info is DOM overlay; CE renders directly into buffer.** Functional parity but no `windowRefresh` integration. | `interface.cc` | low |

### AF-PREFS — preferences.cc gaps

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| AF9 | **`brightness` slider absent.** CE has a gamma/brightness slider (prfsldof/prfsldon FRMs). | `preferences.cc PREF_BRIGHTNESS` | minor |
| AF10 | **`mouse_sensitivity` slider absent.** CE has a mouse sensitivity knob. | `preferences.cc PREF_MOUSE_SENSITIVITY` | low |
| AF11 | **`running` toggle cycles boolean; CE uses a 2-way toggle knob FRM (prflknbs.frm).** DH2 uses a cycle button; cosmetic. | `preferences.cc` | low |
| AF12 | **`game_difficulty` uses CE 3-way knob (prfbknbs.frm); DH2 uses a cycle button.** The 4-way rotary knob FRM is not loaded. | `preferences.cc PREF_GAME_DIFFICULTY` | low |
| AF13 | **Preferences background (`prefscrn.frm`) not loaded.** DH2 prefs panel uses a raw `<div>` with inline styles; the 640×480 background FRM is never rendered. | `preferences.cc` | low |
| AF14 | **`combat_messages` uses cycle button; CE uses 2-way toggle knob (prflknbs.frm).** | `preferences.cc PREF_COMBAT_MESSAGES` | low |
| AF15 | **Preferences screen has no Default button.** CE has a "DEFAULT" button that resets all sliders to CE defaults. | `preferences.cc preferencesSave()` | low |
| AF16 | **`text_line_delay` absent.** CE has a separate `text_line_delay` (per-line auto-advance speed distinct from `text_base_delay`). | `settings.h:43` | low |
| AF17 | **`language_filter` checkbox absent.** CE has a profanity filter toggle. | `preferences.cc PREF_LANGUAGE_FILTER` | low |

---

## AUDIT FINDINGS — interface.cc (2026-06-13)

Audit scope: `fallout2-ce/src/interface.cc` vs `src/ui_hud.ts`, `src/ui.ts`, `src/ui_options.ts`.
Items already implemented (indicator bar, AP lights, sneaking/addiction/level flags, radiation/poison thresholds) are omitted.

| ID | Gap | CE reference | severity |
|----|-----|--------------|----------|
| IF01 | **HP counter animation absent.** CE `interfaceRenderCounter()` rolls digits frame-by-frame (250ms / delta HP) with intermediate white→yellow→red color transitions. DH2 `drawDigits()` is instant. | `interface.cc interfaceRenderCounter` | med |
| IF02 | **HP color thresholds not animated.** CE flashes white→yellow at 50% max HP and yellow→red at 25%; transitions are per-frame. DH2 shows the correct final color but skips transition frames. | `interface.cc interfaceRenderHitPoints` | low |
| IF03 | **End-button lights missing.** CE `interfaceBarEndButtonsRenderGreenLights()` / `RenderRedLights()` blit separate light sprites over the End Turn / End Combat buttons on enter/exit combat. DH2 has no light overlay. | `interface.cc interfaceBarEndButtonsRenderGreenLights` | low |
| IF04 | **End-button SFX missing.** CE plays `icombat2` (lights on) and `icombat1` (lights off) when combat mode is entered/exited. DH2 does not fire these SFX. | `interface.cc interfaceBarEndButtonsRenderGreenLights` | low |
| IF05 | **Active hand not persisted in save.** CE `interfaceSave()` writes `gInterfaceCurrentHand` to the save stream. DH2 `saveload.ts` does not save/restore `player.activeHand`. | `interface.cc interfaceSave/Load` | low |
| IF06 | ✅ FIXED 2026-07-04 — corrected: the actual reload-AP-spend path (`ui.ts:238`) already called `Weapon.getReloadAPCost()` correctly. The stale hardcoded-2 fallback was in the *display-only* attack-button-affordability check (`ui_hud.ts:328`, `updateAttackButtonAvailability()`), which used `(weapon.weapon as any).getReloadAPCost?.() ?? 2` — unnecessary since `weapon.weapon` is narrowed non-null and `getReloadAPCost()` is a real, always-defined `Weapon` method. Simplified to a direct call; zero new tsc errors. | `interface.cc interfaceBarRefreshMainAction / item.cc` | med |
| IF07 | **Called-shot aiming not reachable via action-cycle.** CE cycles PRIMARY→PRIMARY_AIMING→SECONDARY→SECONDARY_AIMING→RELOAD; entering an AIMING mode auto-opens the called-shot panel. DH2 uses a separate hotkey ('Z'). | `interface.cc interfaceBarRefreshMainAction` | low |
| IF08 | **Ammo bar fill width deviant.** CE formula: `ratio = currentRounds / maxAmmo * 70` (70 px max). DH2 uses 55 px max. | `interface.cc interfaceBarRefreshMainAction line ~1361` | low |
| IF09 | **HUD bar hide/show script hooks absent.** CE exposes `gInterfaceBarMode` toggled by `intface_hide` / `intface_show` opcodes; scripts can hide the entire HUD. DH2 stubs these opcodes. | `interface.cc indicatorBarHide/Show, scripting opcodes` | low |

---

## Phase 10 — Path to 100%

<!--
  Completion estimate for this phase:
  Current whole-project estimate ~94% (95% playable-main-quest milestone
  essentially met). Phase 10 is the remaining ~5–6% — the immersion,
  presentation, and edge-case systems the 95% target deliberately set aside,
  plus the AF/IF HUD-fidelity audit findings and TypeScript hygiene.
  Rough weight of the remainder: presentation/audio (subtitles, movies, endgame
  narration) ≈ 2%; NPC schedules + car travel + town reputation ≈ 2%; the long
  tail of HUD-FRM fidelity (AF/IF), asset-pipeline extras, type hygiene, and
  visual-only rendering polish ≈ 1–2%. None are on the critical path to a
  completable playthrough — they are parity/faithfulness work.
  Verified during the 2026-07-04 deep-pass audit; source-checked items are
  marked ✅ (already done) or 🟡 (more complete than previously documented).
-->

All items below are **beyond the 95% line** and collectively define true 100%
parity with Fallout 2. Grouped by subsystem (same structure as Phase 9). Items
already tracked in Phase 8/9 or in `wiki/known_bugs.md` keep their existing ID;
newly surfaced gaps are noted inline. Severity: **major** (visible system-level
gap) · **minor** (feature/polish) · **low** (cosmetic / edge-case). Status
reflects the 2026-07-04 source audit.

### 10a. Speech, Movies & Endgame Presentation

| ID | What | CE Ref | Sev | Status |
|----|------|--------|-----|--------|
| P4 | **Speech audio / subtitles.** `Config.ui.subtitles = false`; no `.acm` speech playback path (`audio.ts` handles music/SFX only). | `sound.cc`, `gdialog.cc` | minor | missing |
| DLG-HEAD | **Talking-head animations not rendered** (verified 2026-07-04). CE `gameDialogRenderTalkingHead()` draws the speaker's animated head FRM (mood + phoneme/lip-sync frames driven by speech duration) in the 388×200 head rect, or a live crop of the game view when no head art exists. DH2 ignores the `headNum` arg to `start_gdialog` and shows the static `alltlk.png` background; only the glint overlay (P22), caps readout (P16) and review log (P17) exist on that window. Head art is indexed (`lut/lst/art_heads.json`) but never drawn. Lip-sync depends on P4 (speech). Sub-gap of `known_bugs` P22. | `game_dialog.cc:4549-4627 gameDialogRenderTalkingHead()` | minor | missing |
| S15 | **`play_gmovie` is a no-op.** `.mve` video playback infrastructure absent (`scripting.ts:2141` logs + skips). | `movie.cc` | minor | stub |
| EG4 | **`endgame_movie` skips credits music + text.** CE plays `akiss.acm`, `creditsOpen("credits.txt")`, then `10labone.acm`. | `endgame.cc:234`; `credits.cc` | minor | missing |
| EG5 | **Death ending slide is a black screen.** CE plays the narrator over the death scene. | `critter.cc:912` | low | missing |
| EG3 | **Panning slide uses linear timing** instead of CE's per-pixel ms/step from image width + speech duration. | `endgame.cc:337-345` | low | bug |

### 10b. NPC AI & Schedules

| ID | What | CE Ref | Sev | Status |
|----|------|--------|-----|--------|
| P2 | **Full NPC day-night schedules.** Critters with `wander_type>0` random-wander; CE assigns fixed home/work/sleep positions keyed by hour. (Minimal wander is done — Phase 5d.) | `scripts.cc`, `ai.cc` | major | missing |
| AC4 | **Hit-from-front vs hit-from-back death direction not tracked.** CE `_is_hit_from_front` picks `FALL_FRONT`/`FALL_BACK`; DH2 always uses one fall direction. | `actions.cc:1512` | low | missing |
| AC7 | **`explosion()` lacks adjacent-tile secondary blasts + per-target `SCRIPT_PROC_DAMAGE` callbacks.** Base script-supplied damage works. | `actions.cc:1582` | minor | partial |
| AC1 | **`PERK_WEAPON_KNOCKBACK` divisor-5 path skipped** (weapon-proto perk field not loaded). Stonewall/base knockback done. | `combat.cc:4633` | low | partial |

### 10c. Companion / Party (full parity)

| ID | What | CE Ref | Sev | Status |
|----|------|--------|-----|--------|
| — | **Companion level-up UI.** Companions function without it; CE levels them via `partyMemberIncLevels`. | `party.cc partyMemberIncLevels` | minor | missing |
| — | **Formation pathfinding.** `followPlayer` pathfinds to nearest free adjacent hex; no CE squad formation. | `party.cc` | minor | missing |
| — | **"Use Best Weapon / Best Armor" heuristics** (companion Custom screen buttons present but inert). | `combat_ai.cc _ai_search_inven_weap/_armor` | minor | missing |
| P21 | **Barter/Trade body-view portraits** render the actual critter sprite — implementation path documented, canvas sprite-extractor not yet built. | `inventory.cc:1982-2070` | minor | partial |

### 10d. Reputation / Faction

| ID | What | CE Ref | Sev | Status |
|----|------|--------|-----|--------|
| R2 | ✅ FIXED 2026-07-04 — same root cause as R1's karma bug (already fixed): CE writes town reputation as plain GVARs (`game_vars.h GVAR_TOWN_REP_*`) with no dedicated opcode or generic engine-side reaction system (verified — no hits in `game_dialog.cc`; only one hardcoded Arroyo movie-penalty reads it in C++). `set_global_var()` now mirrors town-rep GVAR writes to `player.stats` (new `Scripting.TOWN_REP_GVARS`, 19 entries, exact non-contiguous indices verified against `game_vars.h`, matching CE's own curated display list), so `ui_character/viewer.ts`'s pre-existing reputation panel — previously always empty since nothing wrote the stats it read — now populates. Also fixed an off-by-one at the Antipathy/Hated/Vilified title thresholds (-14/-29 → -15/-30, matching `character_editor.cc:4586-4599`) found while verifying. **REGRESSION fixed 2026-07-05** (user-reported): the sync used `setBase()` (unconditional write) but the panel reads back via `getBase()`, which throws for any unregistered stat name — none of the 19 `Rep_*` names existed in `statDependencies`, so the character screen crashed (`No dependencies for stat 'Rep_Klamath'`) the first time a script touched any town's GVAR. Fixed by registering all 19 `Rep_*` stats in `skills.ts`. | `game_vars.h GVAR_TOWN_REP_*`; `character_editor.cc:4582-4599`; `scripts.cc:487` | minor | fixed |

### 10e. Worldmap (full parity)

| ID | What | CE Ref | Sev | Status |
|----|------|--------|-----|--------|
| W8 | **Car travel system entirely absent.** No fuel, speed multipliers, or encounter-rate reduction; car-related `metarule` IDs 30/31/32/52/53 stub. | `worldmap.cc:5984 wmCarUseGas()` | major | missing |
| W10 | ✅ FIXED 2026-07-04 — `parseWorldmap()` (`worldmap/parser.ts`) now captures each `[Tile N]` section's `walk_mask_name` into a new `Worldmap.walkMaskNames[0..19]` array. `Worldmap.ts` adds `worldPosInvalid(x, y)`, a direct port of `wmWorldPosInvalid` (`worldmap.cc:4244`) including its own noted bit-layout quirk (CE's source has a literal `// TODO: Check math.` comment above the same formula — matched as-is rather than "corrected", since the shipped `.msk` data was authored against that exact layout), lazily fetching `data/{name}.msk` via the existing `getFileBinarySync` helper (same sync-XHR pattern already used elsewhere, e.g. `scripting.ts:2412`) and caching per mask name. `updateWorldmapPlayer()` now checks the candidate next position before committing it and halts travel in place (clears `.target`, no bounce/reroute) when blocked — mirroring `wmPartyWalkingStep`'s exact halt behavior (`worldmap.cc:4335-4341`), adapted from CE's discrete pixel-by-pixel Bresenham stepper to DH2's continuous float-interpolation movement (checks the tick's *candidate endpoint* rather than every intermediate pixel — an acceptable approximation given masked regions are broad areas like oceans/mountain ranges, not thin 1px lines). No Python pipeline changes needed — `.msk` files ship as raw binary inside `master.dat`/`critter.dat` and are extracted automatically by the existing bulk DAT-extraction step; confirmed not present in `DELETE_ORIGINALS_GLOBS`. Also fixed a related type gap: `WorldmapPlayer.target` was typed as non-nullable `Point` despite being assigned `null` throughout the file (pre-existing tsc debt); narrowed to `Point \| null`, incidentally resolving 2 pre-existing tsc errors. **BUG fixed 2026-07-05** (user-reported: could still walk over the ocean): the fetch path was `data/{name}.msk`, missing the DAT-extraction-root prefix — CE's literal path `"data\\%s.msk"` uses the *same* `data\` prefix as `"data\\worldmap.txt"` (`worldmap.cc:1275`), which DH2 fetches from `data/data/worldmap.txt` since `tools/setup.py`'s DAT extraction preserves each entry's internal archive path under the project's `data/` folder. The wrong path made every mask load 404, silently caught, so `worldPosInvalid()` always returned `false` (no blocking, ever). Corrected to `data/data/{name}.msk`. | `worldmap.cc:1337,4208,4244,4335-4341`; `src/worldmap/{Worldmap,parser,types}.ts` | minor | fixed |
| W9 | ✅ FIXED 2026-07-04 — CE's town-map art blits at a fixed `(WM_VIEW_X, WM_VIEW_Y) = (22, 21)` offset within its window (`worldmap.cc:5917-5921`), but entrance buttons are created at raw window-relative `entrance->x,y` (`worldmap.cc:5886`). DH2's `#areamap` has no equivalent window border, so every marker was off by that fixed offset; `uiWorldMapShowArea()` now subtracts it. | `worldmap.cc:5886,5917-5921` | minor | fixed |
| W7 | ✅ FIXED 2026-07-05 — `didEncounter()` now returns `{ occurs, detected }`; `Worldmap.ts` shows a Yes/No `showConfirm()` prompt when `detected` is true (matching CE's `showDialogBox(..., DIALOG_BOX_YES_NO)`, `worldmap.cc:3503-3517`), and skips it for undetected (forced ambush) encounters, matching CE exactly. Declining resumes normal travel. | `worldmap.cc:3450,3503-3517` | minor | fixed |

### 10f. Rendering & Lighting (visual-only remainder)

| ID | What | CE Ref | Sev | Status |
|----|------|--------|-----|--------|
| RD10 | **Color cycling absent** — no palette rotation for water/fire (verified: no `colorCycle*` in `src/`/`shaders/`). | `color.cc colorCycleEnable()` | minor | missing |
| RD07 | **OBJECT_FLAT two-pass rendering absent** — flat decals/blood not drawn in a dedicated first pass. | `object.cc:761 _obj_render_pre_roof()` | minor | missing |
| RD08 | **General post-roof object pass absent.** A post-roof pass exists **for outlines only** (CI11, `webglDraw.ts:605`); full-intensity post-roof object rendering not generalised. | `object.cc:862 _obj_render_post_roof()` | minor | partial |
| RD13 | **Hex click hit-testing approximate** — cube-coord rounding, not CE's `_tile_mask[512]` pixel-precise edges (verified: no `tile_mask` in `src/`). | `tile.cc:718 tileFromScreenXY()` | low | bug |
| RD14 | **Elevation transition instant** — CE fades between levels. | `map.cc mapSetElevation()` | low | missing |
| RD15 | **Roof tile lighting deviation** — CE blits roofs at full palette intensity; DH2 dims at night via `roofDummyTexture`. | `tile.cc tileRenderRoofsInRect()` | low | bug |
| RD06 | ✅ **Behind-building roof reveal now implemented** (2026-07-04, via the merged `fallout2-alignment-research` branch). Under-building roofs already flood-hidden; behind-building occlusion now uses **`roofEgg`** (default ON) — `renderRoof()` binds the egg mask + `u_eggMode=1` so the wall egg oval fades any visible occluding roof tile (`webglDraw.ts:141`, `shaders/fragment.glsl`). `roofPeek` full-hide remains an opt-in fallback. Was "partial/planned" in the audit; superseded. | `tile.cc tile_fill_roof()`; `object.cc:5006` | minor | fixed |
| LD5 | **`objectGetLightIntensity` self-subtraction absent** in the combat/perk path (verified: no `lightIntensity` in `combat/hitChance.ts`). Not a render-path gap. | `object.cc:1748` | low | missing |
| LD11n | **Non-wall opaque-object directional occlusion** still commented out (`lightmap.ts`) — separate from the fixed wall case. | `object.cc:4583` | low | missing |
| §8 | **Residual per-column wall-face stripes** — inherent to DH2's per-fragment wall gradient (RD05 embellishment); `flat` mode is CE-faithful, aesthetic default TBD. | `alignment.md §8` | low | deviation |
| GTC10 | **Day/night ambient light curve is a DH2 invention** — CE has no clock-driven ambient. | `light.cc`, `map.cc:927` | low | deviation |

### 10g. Animation & Asset Pipeline

| ID | What | CE Ref | Sev | Status |
|----|------|--------|-----|--------|
| PS2 | ✅ FIXED 2026-07-04 — `FO1` flag removed; `readCritter()` now reads `damageType` unconditionally after `killType`, matching CE `critter.cc:1064 protoCritterDataRead` exactly. Verified against CE source: the original killType∈{5,10} skip was not CE-accurate — CE only special-cases a *failed* read (2 vanilla protos 4 bytes short: Sentry Bot, Weak Brahmin), falling back to `DAMAGE_TYPE_NORMAL`, which the fix replicates. Requires a pipeline re-run against real assets to take effect (git-ignored `proto/`); `combat/Combat.ts getUnarmedDamageDone()` still hardcodes `'Normal'` for unarmed natural damage type — separate open item, not covered here. | `critter.cc:1064-1091 protoCritterDataRead` | major | fixed |
| FA3 | 🟡 Partial — FIXED 2026-07-04 extraction-side. `tools/frmpixels.py` `readFRMInfo()` now includes `actionFrame` in its returned dict; `exportFRMs()` (the `.FR0`-`.FR5` split-file path used for critter animations) captures it as a per-direction array matching CE's per-sub-file-header granularity (verified against `art.cc:1063` — unlike `fps`/`numFrames`, not required to match across directions). Both flow straight into `imageMap.json`. Requires a pipeline re-run against real assets; hit/sound frame-sync consumption in combat/animation code is not wired — separate, still-open follow-on. | `art.h ArtFrame.actionFrame`; `art.cc:1063,725` | major | partial |
| FA6 | ✅ **Weapon-stance FID composition substantially implemented** (see Phase 9m, re-verified 2026-07-04). `Weapon.getSkin()`/`getAnim()` + `critterAnimation.ts` behind `doUseWeaponModel` (default on). Remaining: end-to-end per-weapon FRM-coverage audit. | `art.cc buildFid()` | medium | partial |
| PS4 | ✅ FIXED 2026-07-04 — `readMisc()` wired for `TYPE_MISC` (extendedFlags). Wall extras already done via `readWall()`. Requires pipeline re-run. | `proto_types.h MiscProto.extra` | low | fixed |
| PS3 | 🟡 Partial — FIXED 2026-07-04. `TileProto` has no `lightDistance`/`lightIntensity` fields (unlike the other 5 types) — CE's real common prefix is only pid/messageId/fid; `readPRO()` now special-cases tiles to avoid a byte-misalignment a naive fix would have caused. Also added the missing `"tiles"` directory to `exportPRO.py`'s scan list. Requires pipeline re-run; terrain-cost consumption in DH2 still hardcoded — separate follow-on. | `proto_types.h TileProto`; `proto.cc:1663,1719` | low | partial |

### 10h. Scripting (remaining stubs)

| ID | What | CE Ref | Sev | Status |
|----|------|--------|-----|--------|
| S1 | **`metarule` car IDs 30/31/32/52/53 stub** (car system absent — see W8). All non-car IDs handled. | `interpreter_extra.cc opMetarule` | minor | partial |
| S2 | 🟡 Partial — IMPROVED 2026-07-04. Wired: 102 (verified CE has no case for this ID at all — always 0, matches CE exactly), 109 (chem_use via `getAiPacket`/`CHEM_USE_MAP`), 111 (`_map_target_load_area` via `areaContainingMap`/`lookupMapName`). **Genuinely stub** (each needs a subsystem DH2 lacks, not just a bounded opcode fix): 101/105 need a subtile-grid worldmap fog-of-war system; 104 needs per-entrance discovery state; 110 needs the car system (W8). IDs 100/103/106/107/108 already handled. | `interpreter_extra.cc opMetarule3` | minor | partial |
| GTC5 | 🟡 Investigated 2026-07-05 — see Phase 8/9 row above for the full writeup. Not just a movie trigger: crossing an ARTIMER day threshold applies a real worldmap area swap (Arroyo → Destroyed Arroyo) and a -15 town-rep penalty, independent of the (correctly out-of-scope) movie playback. Blocked on the real vanilla day-threshold defaults (Sfall-config-only in CE source) and whether DH2's `city.txt` even has a "Destroyed Arroyo" entry — not guessed at. `objectUnjamAll()` done, radiation deferred separately. | `scripts.cc:405,438-490` | minor | partial |
| S14 | ✅ FIXED 2026-07-04 — legacy non-batch path now applies `delay*100ms` via `setTimeout`, matching the batch path. Verified against CE `opRegAnimAnimate` (interpreter_extra.cc:3477): delay is uniform, no batch/standalone split exists in CE. | `animation.cc:1374` | minor | fixed |
| P8 | 🟡 Partial — IMPROVED 2026-07-04. `make_path` corrected: not a real CE script opcode (verified — only the internal `_make_path()` C++ function exists, animation.cc:1709, never exposed to scripts; no `op_make_path` anywhere in `interpreter_extra.cc`/`sfall_opcodes.cc`). The two real opcodes — `make_straight_path` (0x826E) and `obj_blocking_at` (0x826F) — are now wired for `BLOCKING_TYPE_BLOCK` (0) and `_SHOOT` (1), reusing `Obj.pathBlocks()` and the existing `hexLinecast` shoot-blocking logic. `_AI` (2) / `_SIGHT` (3) / `_SCROLL` (4) remain stub — each needs infrastructure DH2 doesn't have: AI's stateful "second obstacle" rule (`_moveBlockObj`), a per-tile SIGHT lookup (DH2's `hasLineOfSight` is angle/distance-based, not per-tile), and a boolean-returning SCROLL check distinct from the existing camera-clamp path (RD11/RD12). | `sfall_opcodes.cc:914-967` | low | partial |
| S26 | **`get_poison`/`poison` lack CE-accurate decay loop** (`main.ts` decrements 1/cycle; CE more complex). | `critter.cc critterPoisonCheck` | minor | partial |
| S27 | **`radiation_dec` deliberately deferred.** | `radiation.cc` | minor | stub |

### 10i. Interface / HUD Fidelity (AF + IF audit findings)

CE-faithful HUD/preferences rendering. Mostly cosmetic (DOM/CSS vs pre-baked FRM
sprites); functional parity already met. Full detail in the **AUDIT FINDINGS**
sections above and `wiki/known_bugs.md §26`.

| ID | What | CE Ref | Sev | Status |
|----|------|--------|-----|--------|
| IF01 | **HP counter digit-roll animation absent** — CE rolls digits frame-by-frame with colour transitions; DH2 is instant. | `interface.cc interfaceRenderCounter` | minor | missing |
| IF06 | ✅ FIXED 2026-07-04 — the second call site (`ui_hud.ts:328`, attack-button affordability display) reconciled to call `Weapon.getReloadAPCost()` directly instead of a defensive `?? 2` fallback. | `interface.cc`; `item.cc` | minor | fixed |
| AF7 | **Item-condition bars under equipped weapon absent** (`interfaceRenderItemBars`). | `interface.cc interfaceRenderItemBars()` | minor | missing |
| AF9 | **Brightness/gamma slider absent** in preferences. | `preferences.cc PREF_BRIGHTNESS` | minor | missing |
| AF10 | **Mouse-sensitivity slider absent.** | `preferences.cc PREF_MOUSE_SENSITIVITY` | low | missing |
| AF15 | **Preferences "Default" button absent.** | `preferences.cc preferencesSave()` | low | missing |
| AF16 | **`text_line_delay` (per-line auto-advance) absent** — distinct from `text_base_delay`. | `settings.h:43` | low | missing |
| AF17 | **`language_filter` (profanity) toggle absent.** | `preferences.cc PREF_LANGUAGE_FILTER` | low | missing |
| AF1–AF6, AF8, AF11–AF14 | **HUD/prefs FRM-sprite fidelity** (badge/digit/pip/knob/background FRMs vs DOM-CSS). Functional parity met; presentation differs. | `interface.cc`, `preferences.cc` | low | deviation |
| IF02–IF05, IF07–IF08 | **HP colour-transition frames, end-button lights/SFX, active-hand save, ammo-bar width, aim-mode cycle** — cosmetic/edge HUD details. | `interface.cc` | low | mixed |
| IW8 | **Dialogue sub-mode state machine partial** — only `dialogue→barter`; other CE sub-mode paths not replicated. | `game_dialog.cc gameDialogEnter()` | minor | partial |

### 10j. Config / Persistence

| ID | What | CE Ref | Sev | Status |
|----|------|--------|-----|--------|
| CI1/CI5 | **No file-based config** — all settings hardcoded in `Config`; prefs in `localStorage`, not `fallout2.cfg` (lost in private browsing). | `config.cc:273`; `settings.cc:118` | minor | missing |
| CI2 | ✅ FIXED 2026-07-04 — added `Config.combat.gameDifficultyModifier` as a separate field from `difficultyModifier`. Verified against CE: `combat_difficulty` only scales damage (`combat.cc:4552-4572`, used correctly by `Combat.ts`), while `game_difficulty` drives skill-check modifiers (`skill.cc:1129 skillGetGameDifficultyModifier`, +20/0/-10) and worldmap encounter frequency (`worldmap.cc:3406 wmRndEncounterOccurred`, ±freq/15) — two genuinely independent CE preferences. `skills.ts`/`worldmap/encounters.ts` now read the new field; `ui_options.ts`'s "Game Difficulty" knob (already correctly labelled, previously wired to the wrong field) and "Combat Difficulty" knob (previously an unpersisted local variable, non-functional) are now each wired to their own Config field. No loot/XP effect found in CE for `game_difficulty` — the ROADMAP's original "loot/XP" claim doesn't match the source; only skill checks and encounter rate. | `settings.h:29-31`; `skill.cc:1129`; `worldmap.cc:3406`; `combat.cc:4552-4572` | minor | fixed |
| CI7 | **`item_highlight` persistent setting** — CE-accurate hover-highlight wired (CI12); the CE Options *checkbox* semantics are approximated. | `game_config.h:37` | low | partial |

### 10k. Skills, Locks, Elevators & Economy (edge cases)

| ID | What | CE Ref | Sev | Status |
|----|------|--------|-----|--------|
| K4 | ✅ Investigated 2026-07-04, not a real gap — CE's `skillGetValue()` (`skill.cc:230-269`) has no item/tool-bonus logic anywhere; Expanded/Electronic Lockpick Set bonuses are 100% script-driven (each door's own `use_skill_on_p_proc` passes its own bonus into `roll_vs_skill`, already wired in DH2 at opcode `0x80AC`). `useLockpick()` is explicitly CE's engine-level fallback for when no script overrides it, and correctly has no tool logic — matching `skill.cc`'s own no-op `SKILL_LOCKPICK` case. Modelling tool types there would invent behavior CE doesn't have. Any real gap here would be missing script content, not an engine bug. | `skill.cc:230-269` | minor | not-a-gap |
| K3 | **Steal item-size penalty absent** (no item-select UI); facing/knockdown done. | `skill.cc:1037` | minor | partial |
| LE5 | 🟡 Investigated 2026-07-04, deliberately not attempted — the premise doesn't map cleanly onto DH2's data model. CE's `itemAdd()` (`item.cc:361-378`) tracks ammo as discrete "box" `Object` instances: `inventory->items[index].quantity` = number of boxes, and the one representative item object's own charge field holds a *partial* box's remaining rounds; merging sums that partial charge and only increments the box count when it overflows a box's `capacity` (`pro.extra.quantity`/`ammoGetCapacity`). DH2 never modelled ammo as discrete boxes at all — `reloadWeapon()` (`ui.ts:205-231`) treats an ammo stack's `.amount` as a flat *total rounds* counter, consumed 1:1 with no box/capacity concept, and `addInventoryItem()`'s flat `amount += count` merge is actually *correct* for that simplified model (summing total rounds needs no ceiling). **However**, this investigation surfaced a real, separate inconsistency worth flagging: `ui_barter/screen.ts:167` prices ammo as `pro.extra.cost * amount` — i.e. treats `.amount` as a *box count* at full per-box price — while `reloadWeapon()` treats the same field as raw rounds. Whichever convention `.amount` is meant to hold for ammo, the other consumer is wrong (barter is either drastically over- or under-pricing ammo stacks depending on which is authoritative), and map-loaded ammo `.amount` (`Obj.ts:433`, straight from the map file) hasn't been checked against either assumption. Fixing LE5 as literally stated would require first resolving *that* inconsistency and deciding whether DH2 should adopt CE's box+capacity model at all — a data-model question, not a bounded bug fix — so left open pending that decision. | `item.cc:322,361-378`; `ui.ts:205-231`; `ui_barter/screen.ts:167` | minor | needs-design-decision |
| LE10 | **STEALTH_BOY II auto-stealth not implemented.** | `item.cc:322` | low | missing |
| EL4 | **`_map_data_elev_flags` bitmask not in DH2 map format** — empty elevations can't be represented. | `map.cc:81` | low | missing |
| EV1 | 🟡 Stale claim, corrected 2026-07-04 — already implemented. `ui_elevator.ts` has `animateGauge()`/`setGaugeFrame()`/`gaugeFrameForFloor()`, driven by the same per-frame interpolation CE uses (`GAUGE_FRAME_MS=276`, matching `elevator.cc:405`'s float-step loop); called from the button handler before `proceed()`. | `elevator.cc:405` | low | fixed |
| EV2 | 🟡 Investigated 2026-07-04, deliberately not attempted. CE's `elevatorSelectLevel` (`elevator.cc:349-378`) computes the *current-floor* button index via two interacting steps: (1) a generic step for **all** elevators — find the first button entry whose `.map` matches the current map, then `*elevationPtr += that entry's index`; (2) the three elevator-specific offsets (Sierra-2 −2/−3, Military-Base-Lower −2 if ≥2, Military-Base-Upper −2 if =4), applied only to determine where the gauge needle starts — **not** to travel destinations, which always come straight from `elevatorDescription[keyCode]` regardless. DH2's `uiElevator()` uses a structurally different approach (linear search for a button whose `(mapID, level)` matches `globalState.currentElevation` directly, no index-arithmetic), so CE's offsets can't be ported as a literal patch — they'd need re-deriving against DH2's search algorithm and the real `lut/elevators.json` button data (git-ignored, unavailable in-repo) to confirm whether a mismatch is even reachable, and DH2 currently has no path threading the elevator's identity index (0–23, e.g. `elevatorStub.extra.type`) into `uiElevator()` to condition on it. Net effect if never fixed: the gauge needle may show the wrong "current floor" on first opening the panel for these 2-3 specific elevators; **actual travel destinations are unaffected** (always correct, matching the button table directly) — zero gameplay impact, cosmetic only. Left open pending real asset access to verify against. | `elevator.cc:354-378` | low | missing |
| EV4 | ✅ FIXED 2026-07-04 — all 5 `console.log` call sites in `ui_elevator.ts` now use `dbg('map', ...)`. | — | low | fixed |
| RN5 | **PRNG chi-squared startup validation absent** (CE runs a 100k-sample test). | `random.cc:224` | low | missing |

### 10l. Type Hygiene

| ID | What | CE Ref | Sev | Status |
|----|------|--------|-----|--------|
| Q-any | 🟡 Partial — FURTHER NARROWED 2026-07-04 (second pass). Of the 7 originally-listed fields: `Obj.type`/`Obj.art`/`Critter.weapon` were already resolved (stale claim, corrected in the first pass); `globalState.proMap`/`Obj.anim` were fixed in the first pass. **This pass**: added `src/proto_types.ts` — a full, CE-verified discriminated union (`ItemProtoExtra`/`CritterProtoExtra`/`SceneryProtoExtra`/`WallProtoExtra`/`TileProtoExtra`/`MiscProtoExtra`, cross-checked field-for-field against `tools/proto.py`'s readItem/readCritter/readScenery/readWall/readTile/readMisc). `Obj.pro` retyped `any` → `Proto \| null` (common header fields — `pid`/`textID`/`type`/`frmPID`/`frmType`/`flags`/`lightDistance`/`lightIntensity` — now real; `Proto.extra` deliberately stays `any`, since narrowing it to the union would force every one of the ~230 `.pro.extra.*` call sites across ~30 files to add a guard/cast in the same change — documented in `proto_types.ts` itself). `loadPRO()` and `globalState.proMap`'s value type updated to match. Fixed ~24 newly-surfaced null-safety call sites (Weapon.ts, Critter.ts, Obj.ts, ui_inventory/panel.ts) with `!` assertions where the surrounding code already assumed non-null pro; net tsc error count unchanged (570→570) after also fixing 2 unrelated pre-existing errors. **Bonus find**: the stricter typing surfaced a real, previously-silent bug — `tools/proto.py` emitted the light-radius proto field as `lightRadius` (a DH2-invented name), while `scripting.ts`'s `proto_data()` `LIGHT_DISTANCE` opcode cases already correctly read CE's real field name `lightDistance`; the mismatch meant that opcode always silently returned 0. Renamed to match (requires pipeline re-run on real assets). **Still `any`**: `ProtoExtra` itself (documented, ready for incremental per-file adoption) and `Obj.extra` (176+ raw matches — a *different* concept, map-instance data from `fomap.py`, not proto data; not investigated this pass). | `src/proto_types.ts`; `object/Obj.ts`; `pro.ts`; `globalState.ts`; `tools/proto.py` | low | partial |

---

### Phase 10 — suggested model tier per group

Guidance for *which model to drive each group with* (added 2026-07-04). This is
about matching effort/cost to task shape, not a hard rule — the audit itself is
done, so most of Phase 10 no longer needs a frontier model. Tiers: **Haiku 4.5**
(trivial mechanical) · **Sonnet 5** (well-scoped, CE-referenced — the bulk) ·
**Opus 4.8** (architecturally significant / cross-cutting) · **Fable 5** (only if a
single hardest item warrants a long autonomous run; premium pricing).

| Group | Suggested tier | Why |
|-------|----------------|-----|
| 10a Speech/Movies/Endgame + DLG-HEAD | **Opus 4.8** for the speech/`.acm` + head-render pipeline (new subsystem, audio+render plumbing); **Sonnet 5** for EG3/EG4 slide timing/credits. |
| 10b NPC AI & Schedules | **Opus 4.8** — P2 day-night schedules is a genuinely new system with map/time coupling. AC1/AC4/AC7 are Sonnet 5. |
| 10c Companion parity | **Sonnet 5** for level-up UI + P21 portraits; **Opus 4.8** for formation pathfinding + best-weapon/armor heuristic (AI logic). |
| 10d Reputation (R2) | **Sonnet 5** — bounded table + reaction-modifier wiring. |
| 10e Worldmap | **Opus 4.8** for W8 car travel (new subsystem: fuel/speed/encounter-rate + worldmap integration); **Sonnet 5** for W7/W9/W10. |
| 10f Rendering/Lighting | **Opus 4.8** — anything touching the WebGL shaders or the lighting model (RD07/08, LD5, LD11n, stripes) is subtle and regression-prone. RD10/RD13/RD14 are Sonnet 5. |
| 10g Animation/Pipeline | **Sonnet 5** — PS2 is a one-liner (**Haiku 4.5** would do it), FA3/PS3/PS4 are bounded Python extraction; FA6 completion is Sonnet 5. |
| 10h Scripting stubs | **Sonnet 5** — each opcode is small and CE-referenced. |
| 10i HUD fidelity (AF/IF) | **Sonnet 5**, or **Haiku 4.5** for the pure FRM-vs-DOM cosmetic swaps; **Opus 4.8** only for IW8 dialogue sub-mode state machine. |
| 10j Config/Persistence | **Sonnet 5**. |
| 10k Skills/Elevators/Economy | **Sonnet 5**; EV4 (`console.log`→`dbg`) and RN5 are **Haiku 4.5**. |
| 10l Type hygiene | **Sonnet 5** — mechanical but needs `strict`-mode care across call sites. |

**Rule of thumb:** default to **Sonnet 5** for Phase 10; switch to **Opus 4.8** only
for the four cross-cutting subsystems (NPC schedules, car travel, shader/lighting
work, the speech/head pipeline); use **Haiku 4.5** for the true one-liners; reserve
**Fable 5** for a single hardest end-to-end build you want run autonomously in one
pass. The 2026-07-04 audit that produced this phase was Opus-tier work; executing
the phase mostly is not.

---

### Phase 10 — verified-done during the 2026-07-04 audit

Items the deep-pass confirmed already implemented (moved off the open list; see
inline ✅ above and the corrected Phase 8/9 rows):

- **C10** unarmed special-move combat logic — `combat/Combat.ts` (Phase 9f corrected).
- **EL3** elevator door-reset on floor switch — `ui_elevator.ts:134-142` (Phase 9j corrected).
- **FA6** weapon-stance FID composition — `Weapon.getSkin/getAnim` + `critterAnimation.ts` (Phase 9m/10g downgraded missing→partial).
- **PS4 (walls)** — wall `extendedFlags/sid/material` extraction via `readWall()` (Phase 9l/10g).
- **Perk selection screen**, **save-slot screenshots** — already ✅ in the "NOT required for 95%" list.
- The entire **lighting-alignment block** (LD7/LD11/RD17 + `alignment.md §6–§8`) — see the Phase 8 note.
