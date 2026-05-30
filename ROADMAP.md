# DarkHarold2 Roadmap

High-level tracking on top, detailed phased implementation plan below.

## In Progress
- Map crawler debugging and polish
- Original game font implementation (nearly complete)

## Next
- Automated "does everything work" testing strategy (depends on map crawler being solid)
- Convert all precompiled .int scripts to Lua (Fallout-script layer for LLM interaction)

## Backlog
- Fallout 1 support (same engine, slot in after FO2 is stable)

## Done
- Original game font — implemented

---

# Detailed Implementation Plan — Roadmap to 95%

Ordered by impact and dependency. Each phase is a coherent chunk of work that
unlocks the next. Phases 1–3 are pure connectivity — the engine infrastructure
already exists, these wire it up. Phases 4–5 introduce the only genuinely new
systems still needed.

Current estimate: ~55% complete. Target: 95% (a playable end-to-end run through
Fallout 2's main quest with companions, working scripted content, and correct combat).

---

## Phase 1 — Script Hook Connectivity
**Goal:** Script procedures actually fire when the engine expects them to.
**Why first:** Everything else depends on scripts running. Quest scripts that
advance state, spawn items, play animations, or react to damage are all silent
until these hooks are wired.

### 1a. `damage_p_proc` and `destroy_p_proc`
- `Scripting.damage()` exists at `scripting.ts` but is never called
- `Scripting.destroy()` exists but is never called
- Wire `damage_p_proc`: call from `critterDamage()` in `critter.ts` after HP change
- Wire `destroy_p_proc`: call from `GameMap.removeObject()` in `map.ts` before splice
- Ref: fallout2-ce `scripts.cc::scriptExecProc()`

### 1b. `reg_anim_func` + animation scripting
- `reg_anim_func` (`scripting.ts:1478`) is a complete no-op; most scripted object
  interactions queue animations through this
- `reg_anim_animate` (`scripting.ts:1481`) plays an animation but ignores the `delay` param
- Implement the animation queue: accumulate `reg_anim_func` calls per object, drain
  sequentially with delay timing via `TimedEvent`
- Ref: fallout2-ce `animationRegAnimFunc()` in `animation.cc`

### 1c. `get_month` and `get_day`
- Both hardcoded in `vm_bridge.ts:51,55` — `get_month` returns 1, `get_day` returns 0
- Wire both to read from the game tick counter in `gametime.ts`
- Ref: fallout2-ce `scripts.cc` opcode handlers; `game_time` is already wired correctly

### 1d. Object removal queue
- Direct `splice()` in `GameMap.removeObject()` (`map.ts:99`) causes index drift
  when scripts remove objects during iteration
- Add a deferred removal queue; drain at end of each heartbeat tick in `heart.ts`

---

## Phase 2 — Dialogue Completeness
**Goal:** All standard NPC dialogue patterns work end-to-end.

### 2a. `gsay_message` rebuild
- Current implementation is bitrotted — old code commented out, method is a no-op
  (`scripting.ts:1394`)
- Implement: display a message in the dialogue panel with a [Done] button, blocking
  further option display until dismissed
- `gsay_reply` already works and calls `uiSetDialogueReply()`; model `gsay_message`
  on the same pattern with a single synthesised option

### 2b. `gSay_Start`
- Stub at `scripting.ts:1604`; triggers the dialogue UI from script
- Wire to the existing `ui_dialogue.ts` open path

### 2c. `gdialog_set_barter_mod`
- Stub at `scripting.ts:1597`; sets a per-dialogue barter price modifier
- Store modifier on the active dialogue session; apply in `ui_barter.ts` value calculation

---

## Phase 3 — Scripting Stubs (P2 batch)
**Goal:** The remaining P2 stubs that scripted content depends on.
Each is a small self-contained change; batch them in one pass.

| Opcode | What to implement |
|---|---|
| `obj_art_fid` | Read `obj.fid` (already on Obj) and return it |
| `art_anim` | Encode anim enum into FRM ID high bits; ref: fallout2-ce `art.cc::artAlias()` |
| `obj_item_subtype` | Read `pro.extra.subType` from the loaded proto |
| `tile_contains_pid_obj` | Remove the `stub()` log; logic already present — verify and clean up |
| `tile_is_visible` | Check tile lightmap intensity > threshold |
| `set_exit_grids` | Write to `GameMap.exitGrids`; map loader already populates these |
| `game_ui_disable` / `game_ui_enable` | Set a flag on `globalState`; HUD input checks the flag |
| `wm_area_set_pos` | Update area marker position in `globalState.mapAreas` |

Also in this pass:
- `critter_attempt_placement`: search hex neighbours when target tile is occupied
  (ref: fallout2-ce `critter.cc::critterAttemptPlacement()`)
- `proto_data` critter fields: implement the missing cases beyond `CRITTER_KILL_TYPE`
  (ref: fallout2-ce `proto.cc::protoGetDataMember()`)

---

## Phase 4 — Combat Correctness
**Goal:** Combat produces the right outcomes; AI behaves like FO2.

### 4a. AI team targeting (`object.ts:1173`, `combat.ts:1044`)
- `teamNum` is always -1; AI attacks the nearest critter regardless of faction
- Assign `teamNum` from proto AI packet when loading critters
- Update `Combat.findTarget()` to filter by `x.teamNum !== obj.teamNum`
- Ref: fallout2-ce `ai.cc::aiGetAttackTarget()`

### 4b. Perk crit bonuses (`combat.ts:475`)
- `bonusCrit = 0`; Better Criticals and Slayer perks don't apply
- Read `player.perks` in the crit roll; ref: fallout2-ce `combat.cc::rollCriticalHit()`

### 4c. Melee critical table (`criticalEffects.ts:49`)
- Single table used for all weapons; melee uses a separate table in FO2
- Add a second table entry; select based on `weapon.extra.subType === WeaponSubtype.Melee`
- Ref: fallout2-ce `combat.cc` critical hit table indices

### 4d. `damage_p_proc` timing (Phase 1 follow-up)
- Verify the hook fires at the right point (after DR/DT reduction, before death check)
- Ref: fallout2-ce `combat.cc::attackComputeDamage()`

### 4e. DAM_DROP
- Critical failure flag that drops the weapon; not implemented in combat
- On critical failure with `DAM_DROP` flag: remove weapon from critter's active hand
- Ref: fallout2-ce `combat.cc` `DAM_DROP` handling

---

## Phase 5 — Minimal Deferred Systems
**Goal:** The four systems marked "deliberately deferred" that are required for
a believable playthrough. Minimal implementations only — enough to be correct,
not exhaustive.

### 5a. Drug/chem effects and addiction
- `Stimpak`, `Psycho`, `Buffout`, `Jet` etc. are central to FO2 gameplay
- Implement: on use, apply timed stat modifier via `TimedEvent`; on expiry, reverse
  modifier and roll addiction check
- Addiction roll: `Luck`-based; on fail, set addiction flag; withdrawal applies
  negative modifier until treated
- Ref: fallout2-ce `proto.cc` drug data, `player.cc::playerAddAddiction()`

### 5b. Poison and radiation decay loops
- Scripting stubs (`get_poison`, `poison`, `radiation_dec`) exist but no tick loop
- Implement: per-tick poison HP damage and decay in the heartbeat loop (`heart.ts`)
- Radiation: accumulate rads; apply symptom thresholds (nausea, stat penalties, death)
- Ref: fallout2-ce `critter.cc::critterGetPoison()`, `radiation.cc`

### 5c. Party / companion follow logic
- `party.ts` is a 61-line shell; companions can be added but do nothing
- Minimum for 95%: follow the player (pathfind to player position each turn),
  CHA-based party size cap, companion inventory accessible from UI
- Dismissal dialogue hooks can reuse the existing `talk_p_proc` path
- Full companion level-up can remain deferred
- Ref: fallout2-ce `party.cc`

### 5d. Minimal NPC wander schedules
- Towns feel frozen without basic AI movement
- Minimum: read wander radius from AI packet (`pro.aiPacket.wanderDistance`);
  each `map_update_p_proc` tick, occasionally move critter to a random adjacent hex
  within radius if not in combat
- Full day/night schedule tables remain deferred
- Ref: fallout2-ce `ai.cc::aiMoveSteps()`

---

## Phase 6 — Polish and Type Hygiene
**Goal:** Correctness, stability, and maintainability. No new features.

- `Obj.serialize()` subclass gap (`object.ts:974`) — critter/weapon equipment not
  serialized correctly
- `WeaponObj` deserialization — leftHand/rightHand fields commented out (`object.ts:1828`)
- Ladder destination ignores elevation/map bits — reads tile only (`object.ts:775`)
- Spatial trigger deserialization in save/load (`map.ts:612`) — spatial state lost on load
- `get_month`/`get_day` wired in Phase 1; verify against actual save/load round-trip
- Type annotations: `Obj.type`, `Obj.pro`, `Obj.art`, `Obj.extra`, `Obj.anim`,
  `globalState.proMap`, `Critter.weapon` — all `any`
- **Preferences screen** (`ui_options.ts:50`, `ui_options.ts:95`) — currently `alert('not yet implemented')` stub
  - Build panel with `WindowFrame`/`Widget` (same pattern as the rest of `ui_options.ts`)
  - Difficulty slider → `Config.combat.difficultyModifier` (75/100/125)
  - Running toggle → `Config.engine.doAlwaysRun`
  - Audio toggle → `Config.engine.doAudio`
  - Add new `Config` entries for violence level, target highlight, combat speed, subtitles, combat messages
  - Volume sliders (master/music/SFX): add a `GainNode` to the `AudioContext` in `audio.ts`; expose `setVolume()` on `AudioEngine`
  - Persist to `localStorage` on close; read back in `initOptionsMenu()`
  - Ref: fallout2-ce `options.cc`, `preferences.cc`
- Healer perk in First Aid/Doctor (`skillUse.ts:227`)
- Perk crit bonuses in `bonusCrit` (covered in Phase 4b)
- Encounter difficulty roll adjustments (`encounters.ts:300`, `349`)
- Karma title computation
- `char.ts:27` skill name mismatch ("Melee" vs "Melee Weapons")

---

## What is NOT required for 95%

These are real FO2 systems but not on the critical path to a playable main quest run:

- **Endgame slides** — needed for 100%, not 95%
- **Subtitles / speech audio playback** — immersion, not correctness
- **Full NPC day-night schedules** — minimal wander (Phase 5d) is enough
- **Perk selection screen** — already implemented
- **Unarmed special moves** (Haymaker etc.) — edge case; unarmed modes defined in `unarmed.ts`
- **Full companion level-up UI** — companions work without it
- **Town reputation / faction tracking** — affects NPC reactions but not quest completion
- **Save slot screenshots**

---

## Dependency order summary

```
Phase 1 (script hooks)
    └─ Phase 2 (dialogue — needs hooks to work correctly)
        └─ Phase 3 (stub batch — some depend on dialogue infrastructure)
            └─ Phase 4 (combat — clean base before correctness pass)
                └─ Phase 5 (deferred systems — built on stable scripting + combat)
                    └─ Phase 6 (polish — everything stable before cleanup)
```
