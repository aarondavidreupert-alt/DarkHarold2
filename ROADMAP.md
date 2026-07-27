# Roadmap to 95%

Ordered by impact and dependency. Each phase is a coherent chunk of work that
unlocks the next. Phases 1–3 are pure connectivity — the engine infrastructure
already exists, these wire it up. Phases 4–5 introduce the only genuinely new
systems still needed.

**Last audited: 2026-06-25**
Current estimate: **~93% complete** (was ~90% at 2026-06-04; 60+ items fixed across
2026-06-11 to 2026-06-25 sprints: companion/dialogue state machine P5–P20, barter
P14/P19–P24, worldmap W11/W12, Pip-Boy IW10/IW11, roof RD06, egg RD16, outline
CI11–CI15, and preferences/HUD gaps CI3/CI6/CI8/CI9/CI10/IW3/IW9).
Target: 95% (a playable end-to-end run through Fallout 2's main quest with
companions, working scripted content, and correct combat).

Phases 1–7 are now mostly complete. Phase 8 (rendering) is the largest remaining
coherent block. Phase 9 collects all remaining tractable gaps across subsystems
(~55 items) that don't fit neatly into the earlier phases.

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
| `metarule` | 🟡 Partial | IDs 9,13,14,15,16,17,18,19,22,40,42,43,44,45,46,47,48,49,50,51 handled (42=DROP_ALL_INVEN, 43=INVEN_UNWIELD_WHO added 2026-07-27); car IDs 30/31/32/52/53 still stub. Ref: `interpreter_extra.cc opMetarule` |
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
- 🔴 **Type annotations**: `Obj.type`, `Obj.pro`, `Obj.art`, `Obj.extra`, `Obj.anim`,
  `globalState.proMap`, `Critter.weapon` — still `any`.

---

## Phase 7 — Save/Load Completeness ✅ Mostly Done

### 7a. MVAR persistence ✅ Done
### 7b. WorldMap `knownAreas` persisted ✅ Done
### 7c. Timed event queue persistence ✅ Done (2026-06-02)
### 7d. `obj_set_light_level` wired ✅ Done

---

## Phase 8 — Rendering Gaps

### 8a. Egg transparency system ✅ FIXED 2026-06-15/17/18
- CE 4-case `extendedFlags` branch (`isCEOccludingWall`) wired for `'egg'` mode;
  `'alpha'` mode uses `hexDistance` radial check. `extendedFlags` now extracted for
  walls and scenery by `tools/proto.py readWall()`. Cache-busting + `clearAssetCache()`
  console command added.
- Ref: `object.cc:4949 _obj_render()`; `proto.cc protoRead() case OBJ_TYPE_WALL`.

### 8b. Flat object two-pass rendering 🔴 Missing (RD07/RD08)
- CE renders `OBJECT_FLAT` objects (floor decals, blood) in a dedicated first pass.
- Also missing: post-roof object pass (`_obj_render_post_roof` at full intensity).
- Ref: `object.cc:761 _obj_render_pre_roof()`; `object.cc:862 _obj_render_post_roof()`

### 8c. Object depth sort ✅ FIXED 2026-06-04
- `objectZCompare` now uses `hexIsInFrontOf` (CE `tile.cc:854 tileIsInFrontOf`)
  on tile screen coords. Wall-priority preserved when tiles coincide; hex-y/x
  fallback only on ambiguous cases. NE/SW diagonals no longer mis-sort.
- Ref: `object.cc:761`; `tile.cc tileIsInFrontOf()`

### 8d. Color cycling absent 🔴 (RD10)
- CE `colorCycleEnable/Disable` drives palette rotation for water and fire.
- Ref: `color.cc colorCycleEnable()`

### 8e. Scroll blocking / border limiting ✅ FIXED 2026-06-04
- `clampCameraPosition` enforces map-edge bounds (RD12) and reverts any
  scroll that would put a misc PID 12 marker (CE OBJECT_SCROLL_BLOCK,
  `0x500000C`) under the viewport center (RD11).
- Ref: `tile.cc tileSetCenter()`; `object.cc:2559 _obj_scroll_blocking_at`

### 8f. Hex click hit-testing approximate 🔴 (RD13)
- CE uses `_tile_mask[512]` (32×16 px, 5 sub-regions) for pixel-precise edges.
- DH2 uses cube-coordinate rounding — imprecise at hex boundaries.
- Ref: `tile.cc:718 tileFromScreenXY()`

### 8g. Elevation transition instant 🔴 (RD14)
- CE fades between elevation levels; DH2 switches immediately.
- Ref: `map.cc mapSetElevation()`

### 8h. Roof tile lighting deviation 🔴 (RD15)
- CE appears to blit roofs at full intensity (no `intensityColorTable`).
- DH2 roofs dim at night via `roofDummyTexture`.
- Ref: `tile.cc tileRenderRoofsInRect()`

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
| LE5 | ~~**Ammo stack merge ignores magazine capacity ceiling.**~~ FIXED 2026-07-27 — `addInventoryItem` enforces `pro.extra.quantity` ceiling and recursively splits overflow. | `item.cc:322 itemAdd()` | minor |
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
| P8 | ~~**`make_path` / `obj_blocking_at` / `make_straight_path` are stubs.**~~ FIXED 2026-07-27 — `make_straight_path` uses `hexLinecast`; `obj_blocking_at` uses `objectsAtPosition` + `blocks()`. Wired at 0x826E/0x826F. | `sfall_opcodes.cc:937,951` | low |

### 9c. Scripting

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| S11 | ✅ FIXED 2026-06-04 — reverse direction wired through animBatch → `singleAnimation(reversed)`. | `interpreter_extra.cc:3355` | minor |
| S14 | ~~**`reg_anim_animate` delay ignored in non-batch path.**~~ FIXED 2026-07-27 — non-batch path now applies delay via `setTimeout` and respects `anim=0` (stand still). | `animation.cc:1374` | minor |
| S26 | **`get_poison`/`poison` read/write work; decay loop is simplified** (`main.ts` decrements 1/cycle; CE is more complex). `poison` opcode (0x8122) wired 2026-07-27. | `critter.cc critterPoisonCheck` | minor |
| S15 | **`play_gmovie` is a no-op.** `.mve` video playback infrastructure absent. | `movie.cc` | minor |
| S27 | ~~**`radiation_dec/inc` stubs.**~~ FIXED 2026-07-27 — `radiation_inc`/`radiation_dec` implemented in `scripting.ts`; wired at 0x80FD/0x80FE. No decay loop (deferred). | `radiation.cc` | minor |
| GTC5 | **Midnight queue partial.** `objectUnjamAll()` wired; ARTIMER movies (`_scriptsCheckGameEvents`) not yet wired. | `scripts.cc:405 gameTimeEventProcess` | minor |

### 9d. Interface / HUD

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| IW1 | **No HP/AC indicator bars in the character window.** CE renders colour-coded indicator bars on the HUD. | `interface.cc` | minor |
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
| C10 | **Unarmed special moves have no combat logic.** `unarmed.ts` defines 9 modes; hit/damage bonuses not applied. | `unarmed.cc` | minor |
| C8 | ✅ FIXED 2026-06-04 — wander caps by type (5/15/∞ hex) around spawn origin. | `ai.cc aiMoveSteps()` | minor |
| C13 | ✅ FIXED 2026-06-04 (STAY_CLOSE wired); CHARGE remains the default. | `combat_ai.cc` | minor |

### 9g. Worldmap

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| W9 | **Area entrance positions misplaced on area screens.** | — | minor |
| W8 | **Car travel system entirely absent.** No fuel, no speed multipliers, no encounter rate reduction. | `worldmap.cc:5984 wmCarUseGas()` | major |
| W10 | **Walk masks not loaded.** Player walks through mountains. | `worldmap.cc:1337 wmGrabTileWalkMask()` | minor |

### 9h. Lighting

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| GTC10 | **Day/night ambient light curve is a DH2 invention.** CE has no clock-driven ambient. | `light.cc`, `map.cc:927` | low |
| LD5 | **`objectGetLightIntensity` self-subtraction absent.** Prevents self-illumination artefacts. | `object.cc:1748` | low |

### 9i. Reputation / Economy

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| R2 | **No per-town reputation tracking.** Global karma ✅; per-faction NPC reaction modifiers absent. | `karma.cc` | minor |

### 9j. Skills / Locks

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| K4 | **Expanded Lockpick Set / Electronic Lockpick not modelled.** Tool type not checked in `useLockpick()`. | `skill.cc` | minor |
| EL3 | **Elevator door-animation reset partial.** Door re-close animation on floor switch absent. | `elevator.cc` | low |
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
| PS2 | **`tools/proto.py` has `FO1=True`, suppressing critter `damageType` extraction.** One-line fix. | `proto_types.h CritterProtoData.damageType` | major |
| FA3 | **`actionFrame` discarded by `tools/frmpixels.py`.** Field not saved; hit-frame sync absent. | `art.h ArtFrame.actionFrame` | major |
| PS3 | **Tile PROs not extracted.** Type 4 silently skipped; terrain costs hardcoded. | `proto_types.h TileProto` | low |
| PS4 | **Wall and misc `extra` fields not parsed.** `WallProto.extra` / `MiscProto.extra` absent. | `proto_types.h` | low |

### 9m. Animation

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| FA6 | **FID composition / weapon stance animation absent.** Critters always display unarmed pose regardless of equipped weapon. CE `buildFid()` selects FRM set from weapon `animCode`. | `art.cc buildFid()`; `art.h ART_TYPE_CRITTER` | medium |

---

## What is NOT required for 95%

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
Phase 8 (rendering gaps) 🔴
Phase 9 (remaining tractable gaps) 🟡/🔴
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
| IF01 | ~~**HP counter animation absent.**~~ FIXED (prior session) — `drawHP`/`drawAC` use `setInterval` rolling from display value to target with `max(16, 250/|Δ|)` ms delay per step plus color transitions. | `interface.cc interfaceRenderCounter` | med |
| IF02 | ~~**HP color thresholds not animated.**~~ FIXED (prior session) — `_hpColorOffset()` applies white/yellow/red on each intermediate step during counter roll. | `interface.cc interfaceRenderHitPoints` | low |
| IF03 | ~~**End-button lights missing.**~~ FIXED 2026-07-27 — `#endLights` overlay shows `endltgrn.frm` / `endltred.frm` on player/AI turns; cleared on combat end. | `interface.cc interfaceBarEndButtonsRenderGreenLights` | low |
| IF04 | ~~**End-button SFX missing.**~~ FIXED 2026-07-27 — `icombat2` fires at player-turn start, `icombat1` at AI-turn start, `icibcxx1` at combat end (was swapped). | `interface.cc interfaceBarEndButtonsRenderGreenLights` | low |
| IF05 | ~~**Active hand not persisted in save.**~~ FIXED (prior session) — `saveload.ts` serializes and restores `player.activeHand`. | `interface.cc interfaceSave/Load` | low |
| IF06 | ~~**Reload AP cost hardcoded to 2.**~~ FIXED (prior session) — `Weapon.getReloadAPCost()` matches CE: perk 65 → 1 AP, Solar Scorcher → 0 AP, default → 2 AP. | `interface.cc interfaceBarRefreshMainAction / item.cc` | med |
| IF07 | **Called-shot aiming not reachable via action-cycle.** CE cycles PRIMARY→PRIMARY_AIMING→SECONDARY→SECONDARY_AIMING→RELOAD; entering an AIMING mode auto-opens the called-shot panel. DH2 uses a separate hotkey ('Z'). | `interface.cc interfaceBarRefreshMainAction` | low |
| IF08 | ~~**Ammo bar fill width deviant.**~~ FIXED 2026-07-27 — `uiUpdateAmmoBar` now uses 70 px max to match CE formula. | `interface.cc interfaceBarRefreshMainAction line ~1361` | low |
| IF09 | **HUD bar hide/show script hooks absent.** CE exposes `gInterfaceBarMode` toggled by `intface_hide` / `intface_show` opcodes; scripts can hide the entire HUD. DH2 stubs these opcodes. | `interface.cc indicatorBarHide/Show, scripting opcodes` | low |
