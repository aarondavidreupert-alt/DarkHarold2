# Roadmap to 95%

Ordered by impact and dependency. Each phase is a coherent chunk of work that
unlocks the next. Phases 1–3 are pure connectivity — the engine infrastructure
already exists, these wire it up. Phases 4–5 introduce the only genuinely new
systems still needed.

**Last audited: 2026-06-04**
Current estimate: **~87% complete** (was ~83% at 2026-06-03; 20 Phase 3/4/5/9
items fixed across the June 4 sprint).
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

### 8a. Egg transparency system 🔴 Still needed
- Transparent wall/scenery region around player — entirely absent from DH2.
- CE: `gEgg` pseudo-object, `tileIsInFrontOf`/`tileIsToRightOf`, `_intensity_mask_buf_to_buf`.
- WebGL equivalent: distance-based alpha mask in fragment shader, or CPU hex-distance clip.
- Ref: `wiki/rendering.md`; `object.cc:4949`, `tile.cc:1328`.

### 8b. Flat object two-pass rendering 🔴 Missing (RD07/RD08)
- CE renders `OBJECT_FLAT` objects (floor decals, blood) in a dedicated first pass.
- Also missing: post-roof object pass (`_obj_render_post_roof` at full intensity).
- Ref: `object.cc:761 _obj_render_pre_roof()`; `object.cc:862 _obj_render_post_roof()`

### 8c. Object depth sort 🔴 Approximate (RD09)
- CE uses `_obj_order_comp_func_even/odd`, `tileIsInFrontOf`, `tileIsToRightOf`.
- DH2 `objectZCompare` sorts by hex-y then hex-x; fails at NE/SW diagonals.
- Ref: `object.cc:761`; `tile.cc tileIsInFrontOf()`

### 8d. Color cycling absent 🔴 (RD10)
- CE `colorCycleEnable/Disable` drives palette rotation for water and fire.
- Ref: `color.cc colorCycleEnable()`

### 8e. Scroll blocking / border limiting absent 🔴 (RD11/RD12)
- `OBJECT_SCROLL_BLOCK` not respected; viewport can scroll past map edge.
- Ref: `tile.cc tileSetCenter()`; `tile.cc:537`

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
| LE5 | **Ammo stack merge ignores magazine capacity ceiling.** CE fills to capacity and splits remainder. | `item.cc:322 itemAdd()` | minor |
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
| P8 | **`make_path` / `obj_blocking_at` / `make_straight_path` are stubs.** | `sfall_opcodes.cc:937,951` | low |

### 9c. Scripting

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| S11 | ✅ FIXED 2026-06-04 — reverse direction wired through animBatch → `singleAnimation(reversed)`. | `interpreter_extra.cc:3355` | minor |
| S14 | **`reg_anim_animate` delay ignored in non-batch path.** Batch path works; legacy non-batch path ignores delay. | `animation.cc:1374` | minor |
| S26 | **`get_poison`/`poison` script read/write work; no CE-accurate decay loop.** (`main.ts` decrements 1/cycle, CE is more complex.) | `critter.cc critterPoisonCheck` | minor |
| S15 | **`play_gmovie` is a no-op.** `.mve` video playback infrastructure absent. | `movie.cc` | minor |
| S27 | **`radiation_dec` deliberately deferred.** | `radiation.cc` | minor |
| GTC5 | **Midnight queue partial.** `objectUnjamAll()` wired; ARTIMER movies (`_scriptsCheckGameEvents`) not yet wired. | `scripts.cc:405 gameTimeEventProcess` | minor |

### 9d. Interface / HUD

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| IW1 | **No HP/AC indicator bars in the character window.** CE renders colour-coded indicator bars on the HUD. | `interface.cc` | minor |
| IW1 | ✅ FIXED 2026-06-04 — `#indicatorBar` shows SNEAK/POISONED/RADIATED/ADDICT badges above HUD. | `interface.cc indicatorBarRefresh` | major |
| IW2 | ✅ FIXED 2026-06-04 — `drawAP` dims `#attackButton` (opacity+grayscale) when AP < cost or not player turn. | `interface.cc interfaceRenderActionPoints()` | minor |
| IW3 | **Weapon action cycling missing aiming states.** Mode cycle doesn't include aimed-shot states. | `interface.cc` | minor |
| IW4 | ✅ FIXED 2026-06-04 — `game_ui_disable/enable` toggle `#bar` visibility in addition to input block. | `interface.cc` | minor |
| IW7 | **AP readout has no frame animation.** CE animates AP digit changes per-frame. | `interface.cc interfaceRenderActionPoints()` | low |
| U3 | **Save slot screenshots not saved.** | `loadsave.cc` | minor |

### 9e. Config / Preferences

| ID | What | CE Ref | Sev |
|----|------|--------|-----|
| CI3 | **`combat_speed` scale inverted.** CE: 0–50 where 0=slowest. DH2: 1/2/4 where 4=fastest. | `game_config.h:44` | low |
| CI4 | ✅ FIXED 2026-06-04 — `doAlwaysRun` default = false, matching CE. | `settings.h:38` | low |
| CI5 | **Preferences in localStorage, not fallout2.cfg.** Lost in private browsing. | `settings.cc:118` | minor |
| CI6 | **`speech_volume` not persisted.** | `settings.cc:93` | low |
| CI7 | **`item_highlight` setting absent.** CE allows toggling item-highlight on hover. | `game_config.h:37` | low |
| CI8 | **`target_highlight` loses "targeting only" mode.** CE has 3 states; DH2 collapses to boolean. | `game_config.h:111` | low |
| CI9 | **No `text_base_delay` / `text_line_delay`.** CE auto-advances dialogue text. | `settings.h:42` | low |

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
| PS2 | **`proto.py` has `FO1=True`, suppressing critter `damageType` extraction.** One-line fix. | `proto_types.h CritterProtoData.damageType` | major |
| FA3 | **`actionFrame` discarded by `frmpixels.py`.** Field not saved; hit-frame sync absent. | `art.h ArtFrame.actionFrame` | major |
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
