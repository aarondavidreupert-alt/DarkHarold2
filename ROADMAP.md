# Roadmap to 95%

Ordered by impact and dependency. Each phase is a coherent chunk of work that
unlocks the next. Phases 1–3 are pure connectivity — the engine infrastructure
already exists, these wire it up. Phases 4–5 introduce the only genuinely new
systems still needed.

**Last audited: 2026-06-01**
Current estimate: **~70% complete** (was ~55% when this roadmap was written).
Target: 95% (a playable end-to-end run through Fallout 2's main quest with
companions, working scripted content, and correct combat).

Phases 1–3 and most of Phase 4 are now done. Phase 5 is ~65% done (drugs and
poison implemented; party has basic follow; wander schedules absent). Phase 6 is
~55% done (preferences screen and healer perk complete; type hygiene outstanding).
Four new save/load gaps were found during the audit and are added below.

---

## Infrastructure

Work completed since the roadmap was written to support ongoing development. Not
game features, but prerequisites for reliable iteration.

- ✅ **Wiki Layer** (`wiki/` directory) — 35 audited docs covering all major systems
  with CE citations and DH2 gap inventories. Lookup order: wiki/ → CE source → ask.
- ✅ **CODEBASE.md** — post-audit source map with Known Gaps inventory; maintained
  in CLAUDE.md via the CODEBASE.md Maintenance rule.
- ✅ **CLAUDE.md update rules** — Wiki Layer lookup order and CODEBASE.md surgical
  edit rule added to project instructions.

---

## Phase 1 — Script Hook Connectivity
**Goal:** Script procedures actually fire when the engine expects them to.
**Why first:** Everything else depends on scripts running. Quest scripts that
advance state, spawn items, play animations, or react to damage are all silent
until these hooks are wired.

### 1a. `damage_p_proc` and `destroy_p_proc` ✅ Done
- `Scripting.damage()` is called from `critter.ts:~570` after HP change, before
  death check — correct CE timing per `combat.cc::attackComputeDamage()`.
- `destroyObject()` in `map.ts` calls `Scripting.destroy()` before removal.
- Both dispatch functions live in `scripting.ts:2005–2025`.

### 1b. `reg_anim_func` + animation scripting ✅ Done
- `animBatch` queue accumulates entries per `reg_anim_begin` / `reg_anim_end` block.
- `reg_anim_end` drains sequentially via `doStep()` with `setTimeout`-based delay
  (`step.delay * 100` ms) — `scripting.ts:1579`.
- Ref: fallout2-ce `animationRegAnimFunc()` in `animation.cc`

### 1c. `get_month` and `get_day` ✅ Done
- `0x8118`: `this.push(GameTime.getDate().month + 1)` — `vm_bridge.ts:52`
- `0x8119`: `this.push(GameTime.getDate().day)` — `vm_bridge.ts:56`
- Both read from the game tick counter via `gametime.ts::getDate()`.

### 1d. Object removal queue ✅ Done
- `removeObject()` pushes to `_removalQueue`; `drainRemovalQueue()` splices at
  end of each heartbeat tick — `map.ts:101–130`.
- Prevents index drift when scripts remove objects during iteration.

### 1e. `reg_anim_func` callback interleaving 🟡 Partial
- Callbacks registered via `reg_anim_func` are collected into `animBatch` and
  fired *after* all animate steps complete — `scripting.ts:1579`.
- CE fires `reg_anim_func` callbacks interleaved between individual animate
  steps, allowing scripts to react mid-sequence and branch on the result.
- Current behaviour is correct for the common case (single callback at end of
  sequence) but will misfire for scripts that branch mid-sequence.
- Ref: fallout2-ce `animation.cc::animationRegAnimFunc()`

---

## Phase 2 — Dialogue Completeness
**Goal:** All standard NPC dialogue patterns work end-to-end.

### 2a. `gsay_message` ✅ Done
- Implemented: `scripting.ts:1461`. Displays reply text, synthesises a `[Done]`
  option, saves VM resume address, and halts the VM — mirrors the `gsay_end`
  convention.

### 2b. `gSay_Start` / `gsay_start` ✅ Done
- Implemented: `scripting.ts:1450`. Opens the dialogue UI if not already open
  via `uiStartDialogue(false, self_obj)`. Wired: `vm_bridge.ts:183`.

### 2c. `gdialog_set_barter_mod` ✅ Done
- Stores `dialogueBarterMod` — `scripting.ts:1425`.
- Applied in `ui_barter.ts:317–320`: `merchantNeed = ceil(merchantOffered * (100 + barterMod) / 100)`.

---

## Phase 3 — Scripting Stubs (P2 batch)
**Goal:** The remaining P2 stubs that scripted content depends on.

| Opcode | Status | Notes |
|---|---|---|
| `obj_art_fid` | ✅ Done | `vm_bridge.ts:130`, `scripting.ts:1201` |
| `art_anim` | ✅ Done | `vm_bridge.ts:118`, `scripting.ts:1209` |
| `obj_item_subtype` | ✅ Done | `vm_bridge.ts:123`, `scripting.ts:1180` |
| `tile_contains_pid_obj` | ✅ Done | `vm_bridge.ts:115`, `scripting.ts:1337` |
| `tile_is_visible` | ✅ Done | `vm_bridge.ts` `0x80f8`, `scripting.ts:1347` |
| `set_exit_grids` | 🟡 Partial | Implemented `scripting.ts:1306`; **not wired in `vm_bridge.ts`** |
| `game_ui_disable` / `game_ui_enable` | ✅ Done | `vm_bridge.ts:160–161`, `scripting.ts:1789–1793` |
| `wm_area_set_pos` | ✅ Done | `vm_bridge.ts:96`, `scripting.ts:1782` |
| `critter_attempt_placement` | ✅ Done | `vm_bridge.ts:101`, `scripting.ts:851` |
| `proto_data` critter fields | 🟡 Partial | Implemented `scripting.ts:1090`; critter `data_member` cases incomplete; **not wired in `vm_bridge.ts`** |
| `metarule` | 🟡 Partial | IDs 14,15,17,18,22,46,48,49 handled; all others `stub()` — `scripting.ts`. Ref: `interpreter_extra.cc::opMetarule` |
| `metarule3` | 🟡 Partial | IDs 100,106 handled; all others `stub()` — `scripting.ts`. Ref: `interpreter_extra.cc::opMetarule3` |
| `has_trait` | 🟡 Partial | TRAIT_OBJECT cases 5,6,10,666 handled; case 669 (OBJECT_CUR_WEIGHT) has TODO; all others `stub()` — `scripting.ts`. Ref: `interpreter_extra.cc::opHasTrait` |
| `critter_add_trait` | 🟡 Partial | TRAIT_OBJECT cases 5,6 handled; all others silently ignored after `stub()` log — `scripting.ts`. Ref: `interpreter_extra.cc::opAddTrait` |
| `anim` | 🟡 Partial | IDs 1000 (set rotation) and 1010 (set frame) handled; all others `stub()` — `scripting.ts`. Ref: `interpreter_extra.cc::opAnim` |
| `do_check` | 🔴 Stub | Always returns 1; `statRoll()` never invoked — `scripting.ts:819`. Ref: `interpreter_extra.cc::opDoCheck` |
| `using_skill` | 🔴 Stub | Always returns 0 — `scripting.ts:791`. Ref: `interpreter_extra.cc::opUsingSkill` |
| `inven_cmds` | 🟡 Partial | Only INVEN_CMD_INDEX_PTR (13) handled; all other inventory command IDs `stub()` — `scripting.ts:847`. Ref: `interpreter_extra.cc::opInvenCmds` |
| `get_critter_stat` | 🟡 Partial | SPECIAL 0–6, HP (35), Max HP (7), gender (34) handled; all other stat IDs (AC, AP, carry weight, sequence, critical chance, damage threshold/resistance, etc.) `stub()` and return 5 — `scripting.ts`. Ref: `interpreter_extra.cc::opGetCritterStat`, `stat.cc::statGetValue` |
| `set_pc_stat` | 🟡 Partial | PCSTAT_reputation (3) and PCSTAT_karma (4) handled; PCSTAT_unspent_skill_points (0), PCSTAT_level (1), PCSTAT_experience (2) `stub()` — `scripting.ts`. Ref: `stat.cc::pcSetStat` |
| `mod_pc_stat` | 🟡 Partial | PCSTAT_reputation (3) and PCSTAT_karma (4) handled; PCSTAT_unspent_skill_points (0), PCSTAT_level (1), PCSTAT_experience (2) `stub()` — `scripting.ts`. Ref: `scripts.cc::opModifyPcStat` |

---

## Phase 4 — Combat Correctness
**Goal:** Combat produces the right outcomes; AI behaves like FO2.

### 4a. AI team targeting ✅ Done
- `teamNum` assigned from proto AI packet at critter load — `object.ts:1290`.
- `findTarget()` filters by `x.teamNum !== obj.teamNum` — `combat.ts:1058`.
- Ref: fallout2-ce `ai.cc::aiGetAttackTarget()`

### 4b. Perk crit bonuses ✅ Done
- **Better Criticals**: +30 per rank applied — `combat.ts:501–503`.
- **Slayer**: every melee hit auto-critical — `combat.ts:523`.
- **Sniper**: on ranged hit, roll d100 ≤ LUK → critical — `combat.ts` (same block).
- Ref: fallout2-ce `combat.cc::rollCriticalHit()`

### 4c. Melee critical table 🟡 Partial
- Melee crit `DM` is halved (`max(2, floor(DM/2))`) — `combat.ts:538`.
- However a **separate critical table is not used** — single table for all weapons.
- `criticalEffects.ts:49` still carries the `TODO` comment.
- Ref: fallout2-ce `combat.cc` critical hit table indices

### 4d. `damage_p_proc` timing ✅ Done
- Fires after HP reduction, before death check — `critter.ts:~570`.
- CE-accurate per `combat.cc::attackComputeDamage()`.

### 4e. DAM_DROP 🔴 Still needed
- Critical failure flag `DAM_DROP` that drops the weapon is not handled anywhere
  in `combat.ts`.
- On critical failure with this flag: remove weapon from critter's active hand.
- Ref: fallout2-ce `combat.cc` `DAM_DROP` handling

### 4f. Party member combat AI 🔴 Still needed
- Party members are excluded from the combatants list at `combat.ts:301`:
  `if (!obj.isPlayer && !triggerTeams.has(obj.teamNum) && !obj.hostile) return false`.
- Companions stand idle during combat — they receive no AI turns and cannot
  attack enemies or use items, even when adjacent to a hostile.
- Fix: enrol party members into the combatants list with their own team number;
  assign each companion an AI turn using `aiTurn()` with their loaded AI packet.
- Ref: fallout2-ce `party.cc::partyMemberCombatTurn()`, `ai.cc::aiTurn()`
- Wiki: `wiki/companion_party.md` — Section 3 (Combat AI for companions)

---

## Phase 5 — Minimal Deferred Systems
**Goal:** The four systems marked "deliberately deferred" that are required for
a believable playthrough.

### 5a. Drug/chem effects and addiction ✅ Done
- Full implementation in `src/drugs.ts` (224 lines): `useDrug()` applies stat
  modifiers via `TimedEvent`, schedules reversal, rolls addiction check on expiry.
- Addiction/withdrawal tick: `main.ts:1073` via `tickAddictions()` each 600 ticks.
- Covered: Stimpak, Psycho, Buffout, Jet, Radaway, Antidote, Nuka-Cola.
- `globalState.drugHandler` routes `obj.subtype === 'drug'` uses to `useDrug`.
- Ref: fallout2-ce `proto.cc` drug data, `addiction.cc addictionProcess`

### 5b. Poison and radiation decay loops ✅ Done
- **Poison**: -`floor(poisonLevel/10)` HP per 600-tick cycle, level decremented
  by 1 — `main.ts:1063–1068`. Ref: `critter.cc::critterPoisonCheck`.
- **Radiation**: `applyRadiationSymptoms()` called per 600-tick cycle —
  `main.ts:1076–1078`. Ref: `radiation.cc::radiationEventProcess`.
- **Addiction withdrawal**: `tickAddictions()` called per cycle — `main.ts:1073`.

### 5c. Party / companion follow logic 🟡 Partial
- `party.ts` has `followPlayer()`: walks companions toward player when >5 hexes
  away. Party size cap (1 + floor(CHA/2)) enforced.
- **Missing**: true pathfinding (companions teleport rather than pathfind);
  dismissal dialogue hooks; companion inventory accessible from HUD.
- Full companion level-up remains deferred (out of scope for 95%).
- Ref: fallout2-ce `party.cc`
- Wiki: `wiki/companion_party.md` — Sections 1, 2, 4, 5

### 5d. Minimal NPC wander schedules 🔴 Still needed
- No wander logic implemented anywhere. Towns remain frozen.
- **Minimum for 95%**: read `pro.aiPacket.wanderDistance`; each `map_update_p_proc`
  tick, occasionally move critter to random adjacent hex within radius if not in
  combat.
- Full day/night schedule tables remain deferred.
- Ref: fallout2-ce `ai.cc::aiMoveSteps()`

---

## Phase 6 — Polish and Type Hygiene
**Goal:** Correctness, stability, and maintainability. No new features.

- ✅ `Obj.serialize()` equipment — `leftHand`/`rightHand` re-established from
  serialized inventory at deserialize time (`object.ts:1250–1260`); not a
  direct save field but round-trips correctly.
- ✅ Spatial trigger LVARs — serialized at map save (`map.ts:634`), restored on
  load (`map.ts:661`).
- ✅ `get_month`/`get_day` save round-trip — `gameTickTime` is in `SaveGame`;
  `getDate()` derives month/day from it deterministically.
- ✅ **Preferences screen** — `ui_options.ts` (434 lines): difficulty slider,
  running toggle, audio toggle, volume sliders (master/music/SFX via `setVolume()`
  on `HTMLAudioEngine`), `localStorage` persist/restore via `loadPreferences()`.
- ✅ **Healer perk** — `skillUse.ts:227–230`: +4 min /+10 max HP per rank for
  First Aid; +4/+10 per rank for Doctor (`skillUse.ts:318–320`).
- ✅ Encounter difficulty roll adjustments — `encounters.ts:302–310`: difficulty
  modifier ±5 applied; Scout/Ranger/Explorer perk bonuses applied.
- ✅ Karma title computation — `ui_character.ts:581–624`: `KARMA_TITLES` threshold
  table displayed in the character screen.
- ✅ `char.ts:27` skill name — `Melee` → `Melee Weapons` remapped on deserialize
  (`char.ts:62–65`); `TODO` comment remains but is functionally resolved.
- 🔴 **Town faction deltas** — `ui_character.ts` has no per-town reputation
  table. CE tracks faction rep separately from global karma via `GVAR_*_REP_*`
  GVARs; NPC reaction modifiers based on faction rep are absent. Global karma
  display (KARMA_TITLES) is ✅; town-level display and NPC reaction modifiers
  are not. Ref: fallout2-ce `reputation.cc`
- 🟡 **Active skill use — Gambling and Outdoorsman** — `skillUse.ts` handles 8
  of 10 active skills. `Gambling` and `Outdoorsman` fall through to the default
  `"cannot be used directly"` error path. Ref: fallout2-ce `skill.cc::skillUse`
- 🟡 **Worldmap accuracy gaps** — `worldmap.ts` is functional but: (1) area
  entrance positions on area screens are misplaced; (2) no difficulty modifier
  applied to random encounter roll; (3) encounter-spawned critters carry no
  items or equipment. Ref: fallout2-ce `worldmap.cc`, `encounter.cc`
- 🟡 **Quest system gaps** — GVAR-based tracking and Pip-Boy display work, but:
  no XP awarded on quest completion; no quest-completion script callbacks wired;
  quest descriptions are inlined in `questData.ts` rather than loaded from
  `quests.msg`. Ref: fallout2-ce `quest.cc`
- 🔴 **Type annotations**: `Obj.type`, `Obj.pro`, `Obj.art`, `Obj.extra`,
  `Obj.anim`, `globalState.proMap`, `Critter.weapon` — still `any`.

---

## Phase 7 — Save/Load Completeness (New — found during audit)
**Goal:** Game state survives a save/load cycle without silent data loss.
These gaps were not in the original roadmap. Each causes observable quest and
gameplay regressions on reload.

### 7a. MVAR persistence 🔴 Critical
- `mapVars` is a module-level `var` in `scripting.ts:50`; it is **not exported
  and not included in `SaveGame`** (`saveload.ts`).
- On reload, all map variable state resets to the default `.mvars.json` values.
  Quest-critical flags (doors unlocked, merchants visited, quest stages) are lost.
- Fix: export `mapVars` from `scripting.ts`; add `mvars` field to `SaveGame`;
  restore in `load()`.
- Ref: fallout2-ce `map.cc::mapSave` — MVARs persist with the map.

### 7b. WorldMap `knownAreas` not persisted 🔴
- `globalState.knownAreas: Set<number>` is **not in `SaveGame`**.
- On reload the worldmap forgets all discovered areas; player must re-discover
  every location.
- Fix: serialize `knownAreas` as an array in `SaveGame.playerState`; restore
  into a new `Set` on load.

### 7c. Timed event queue not persisted 🔴
- `Scripting.timeEventList` (`scripting.ts:59`) is **not in `SaveGame`**.
- Drug timers (stat reversal, addiction rolls), scripted `add_timer_event` delays
  — all lost on reload. Reloading after using drugs silently removes the expiry
  callback.
- Fix: serialize the `timeEventList` (filter to serializable entries — e.g.
  drug events tagged with string `userdata`); restore with adjusted `fireTime`
  on load.

### 7d. `obj_set_light_level` (0x8107) not wired 🟡
- Implemented in `scripting.ts:1262` (sets `obj.lightRadius`,
  `obj.lightIntensity`) but **no entry in `vm_bridge.ts`**.
- Scripts that call `obj_set_light_level` at runtime will no-op.
- Fix: add `0x8107: bridged("obj_set_light_level", 3, false)` to `vm_bridge.ts`.
- Ref: fallout2-ce `interpreter_extra.cc:3058` `opSetObjectLightLevel`.

---

## Phase 8 — Rendering Gaps (New — found during audit)
**Goal:** Visual correctness for world geometry interaction.

### 8a. Egg transparency system 🔴 Still needed
- The CE "egg" — the circular transparent region around the player where
  overlapping walls and scenery are rendered semi-transparent — is **entirely
  absent** from DH2.
- CE uses `gEgg` pseudo-object (FID `OBJ_TYPE_INTERFACE/2`, egg.frm), per-frame
  position tracking, `tileIsInFrontOf` / `tileIsToRightOf` positional checks,
  and `_intensity_mask_buf_to_buf` gradient blending.
- Roof clipping (roof tiles transparent above the player) uses the same technique
  via `tileRenderRoof`.
- WebGL equivalent: a distance-based alpha mask in the fragment shader, or
  CPU-side per-object clip based on hex-distance to player.
- Ref: `wiki/egg_system.md` for full CE algorithm; `raw/fallout2-ce/src/object.cc:4949`,
  `tile.cc:1328`.

---

## What is NOT required for 95%

These are real FO2 systems but not on the critical path to a playable main quest run:

- **Endgame slides** — needed for 100%, not 95%
- **Subtitles / speech audio playback** — immersion, not correctness
- **Full NPC day-night schedules** — minimal wander (Phase 5d) is enough
- **Perk selection screen** — ✅ already implemented (`ui_character.ts:1866` `showPerkModal`)
- **Unarmed special moves** (Haymaker etc.) — edge case; unarmed modes defined in `unarmed.ts`
- **Full companion level-up UI** — companions work without it
- **Town reputation / faction tracking** — affects NPC reactions but not quest completion
- **Save slot screenshots**
- **`set_exit_grids` fully wired** — scripted exit overrides rare in main quest
- **Full `proto_data` critter coverage** — most needed fields implemented; missing
  cases hit warn() and return 0, which is tolerable for most quest scripts

---

## Dependency order summary

```
Infrastructure (wiki, CODEBASE.md, CLAUDE.md)
    └─ Phase 1 (script hooks) ✅
        └─ Phase 2 (dialogue) ✅
            └─ Phase 3 (stub batch — mostly done) ✅/🟡
                └─ Phase 4 (combat correctness — mostly done) ✅/🟡
                    └─ Phase 5 (deferred systems — partially done) ✅/🟡/🔴
                        └─ Phase 6 (polish — partially done) ✅/🔴
Phase 7 (save/load completeness — new, independent) 🔴
Phase 8 (rendering gaps — new, independent) 🔴
```
