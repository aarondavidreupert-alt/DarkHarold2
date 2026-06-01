# DarkHarold2 — Known Bugs & Gaps Registry

> **Last audited: 2026-06-01**
>
> Update this file when: closing a bug, adding a stub, or after any sprint
> that touches scripting, combat, or worldmap.

Sources: `CODEBASE.md` Known Gaps, `TODO.md`, `wiki/CROSS_CHECK_NOTES.md`,
grep of `stub()` / `console.warn` / TODO in `src/`.

---

## Legend

| Field | Values |
|-------|--------|
| **Status** | `bug` wrong vs CE ground truth · `stub` method exists, does nothing · `partial` incomplete implementation · `missing` not started |
| **Severity** | `blocking` crashes or prevents play · `major` visible gameplay deviation · `minor` polish / edge-case |

Items marked ✅ in this document have been confirmed fixed since the last audit.
Items marked 🔶 are addressed on an unmerged branch.

---

## 1. Combat System

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| C1 | **Sniper perk uses d100 instead of d10.** DH2: `getRandomInt(1, 100) <= LUK`. CE: `randomBetween(1, 10) <= luck`. | `combat.ts:526` | `combat.cc:3891–3897 rollCriticalHit()` | major | bug |
| C2 | **Critical hit level formula uses uniform `/20` thresholds.** DH2: `floor(max(0, rand(critMod, 100+critMod)) / 20)` → 6 equal bands. CE: non-uniform breakpoints ≤20→0, ≤45→1, ≤70→2, ≤90→3, ≤100→4, >100→5. | `combat.ts:531` | `combat.cc:4102–4118 attackComputeCriticalHit()` | major | bug |
| C3 | **YAAM damage formula has three divergences from CE.** (a) DH2 omits the `/2` halving step. (b) DH2 applies DT *after* multiply; CE subtracts DT *before* multiply at line 6795. (c) DH2 adjusts DR with ammo RM; CE adjusts DT instead. | `combat.ts:266–275` | `combat.cc:6767–6813 damageModCalculateYaam()` | minor | bug |
| C4 | **Melee/unarmed hit-location penalty not halved.** CE halves `hit_location_penalty[region]` for melee weapons in `attackDetermineToHit`. DH2 applies full `regionHitChanceDecTable[region]` to both unarmed and ranged paths identically. | `combat.ts:454,488` | `combat.cc:4440 attackDetermineToHit()` | minor | bug |
| C5 | **Melee weapons use the ranged critical effects table.** CE has a separate critical effects table for melee weapons. DH2's `criticalEffects.ts` uses one table for all weapon types. | `criticalEffects.ts:49` | `combat.cc rollCriticalHit()` | minor | partial |
| C6 | **Party members are not enrolled in the combatants list.** At `combat.ts:301`, `combatants` is filtered from `objects` but party members are not included. They wander freely while the player fights; no party AI turn is executed. | `combat.ts:301`, `party.ts` | `combat.cc`, `party.cc` | major | partial |
| C7 | **AI team targeting ignores faction.** `teamNum = -1` on all critters (`object.ts:1188`). The AI target filter at `combat.ts:1058` (`teamNum !== obj.teamNum`) always passes, so all critters are valid targets regardless of faction. | `object.ts:1188`, `combat.ts:1058` | `ai.cc aiGetAttackTarget()` | major | partial |
| C8 | **Wander-type radius not differentiated.** CE maps wander\_type 1 → short radius, 2 → large radius, 3 → unrestricted. DH2 applies a flat 5%/tick random-hex move with no radius cap for any non-zero wander\_type. Wiring to `AiPacket.wander_type` is pending the `ai-packet-system` branch. 🔶 | `combat.ts` | `ai.cc` | minor | partial |
| C9 | **DAM\_DROP not implemented.** Weapons are never dropped on a critical failure that rolls the DROP effect. | `combat.ts`, `criticalEffects.ts` | `combat.cc` | minor | missing |
| C10 | **Unarmed special moves defined but no combat logic.** `unarmed.ts` defines 9 modes (Haymaker, Jab, etc.) with threshold/AP/damage tables. None of the mode-specific hit or damage bonuses are applied during combat. | `unarmed.ts` | `unarmed.cc` | minor | partial |
| C11 | **Misleading comment on Sequence.** `combat.ts:321` states `Sequence = 10 + 2*PER` — the constant is wrong. The implementation at `skills.ts:124` (`Dependency('PER', 2)` with base 0) is correct: `2*PER`. | `combat.ts:321` | `stat.cc:572` | minor | bug (comment) |

---

## 2. Scripting VM — Stub Opcodes

All entries below are wired in `vm_bridge.ts` and have a corresponding method in `scripting.ts` that calls `stub()` or silently no-ops for the listed cases. See `CODEBASE.md §Scripting VM — Opcode Coverage` for per-case detail.

| ID | Opcode / Method | File(s) | What's missing | Sev | Status |
|----|-----------------|---------|----------------|-----|--------|
| S1 | `metarule` | `scripting.ts:523` | Sub-ops 14/15/17/18/22/46/48/49 handled; all other IDs call `stub()` | major | partial |
| S2 | `metarule3` | `scripting.ts:553` | Sub-ops 100 and 106 handled; all other IDs call `stub()` | minor | partial |
| S3 | `get_critter_stat` | `scripting.ts:577` | 8 stat IDs mapped (SPECIAL 0–6, HP/MaxHP, gender 34); all other stat IDs stub | major | partial |
| S4 | `has_trait` | `scripting.ts:602` | `TRAIT_OBJECT` cases 5/6/10/666 handled; `OBJECT_CUR_WEIGHT` (669) and all non-`TRAIT_OBJECT` types stub | major | partial |
| S5 | `critter_add_trait` | `scripting.ts:606` | Cases 5 (ai\_packet) and 6 (team\_num) write through; cases 10/666/669 and all other trait types silently ignored | minor | partial |
| S6 | `using_skill` | `scripting.ts:791` | Always returns 0; CE `skill.cc::isUsingSkill()` check not implemented | minor | stub |
| S7 | `do_check` | `scripting.ts:819` | Always returns 1 (pass); CE `stat.cc::statRoll()` not invoked | major | stub |
| S8 | `inven_cmds` | `scripting.ts:847` | All cases return null; only `INVEN_CMD_INDEX_PTR` (13) is asserted | minor | stub |
| S9 | `set_pc_stat` | `scripting.ts:922` | Cases 3 (Reputation) and 4 (Karma) write through; all other `PCSTAT_*` IDs stub | minor | partial |
| S10 | `mod_pc_stat` | `scripting.ts:942` | Cases 3 (Reputation) and 4 (Karma) write through; all other `PCSTAT_*` IDs stub | minor | partial |
| S11 | `anim` | `scripting.ts:1249` | IDs 1000 (set rotation) and 1010 (set frame) handled; all other animation-command IDs stub | major | partial |
| S12 | `proto_data` (critters) | `scripting.ts:1144` | Item fields (24 cases) fully mapped; critter fields return 0 for all IDs except `CRITTER_KILL_TYPE` | major | partial |
| S13 | `reg_anim_func` | `scripting.ts:1558`, `vm_bridge.ts:76` | Wired; `reg_anim_func` callbacks are collected and fired **after** all animate steps complete, not interleaved between them in registration order. CE `animationRegAnimFunc` sequences them together. | major | partial |
| S14 | `reg_anim_animate` | `scripting.ts:1566` | Plays animation immediately; the `delay` parameter (number of ticks to wait) is ignored — no WAIT/sleep equivalent in the queue. | minor | partial |
| S15 | `play_gmovie` | `scripting.ts:1768` | Logs a skip message and returns; `.mve` video playback infrastructure does not exist | minor | stub |
| S16 | `obj_art_fid` | `scripting.ts:1201` | Always returns 0; proto FID data is already loaded | minor | stub |
| S17 | `art_anim` | `scripting.ts:1209` | Always returns 0; CE `art.cc::artAlias()` lookup not implemented | minor | stub |
| S18 | `obj_item_subtype` | `scripting.ts:1180` | Always returns null; proto sub-type data is available | minor | stub |
| S19 | `tile_contains_pid_obj` | `scripting.ts:1337` | Logic exists and runs but `stub()` still fires — correctness unverified | minor | partial |
| S20 | `tile_is_visible` | `scripting.ts` | Always returns 1; lightmap data available but not consulted | minor | stub |
| S21 | `set_exit_grids` | `scripting.ts:1306` | Method body writes to `map.exitGrids`; visual correctness unverified and area-screen re-entry not triggered | minor | partial |
| S22 | `gdialog_set_barter_mod` | `scripting.ts:1425` | Stores mod in `this._barterMod`; `ui_barter.ts` does not read this field — the dialogue barter bonus has no effect | major | partial |
| S23 | `game_ui_disable` / `game_ui_enable` | `scripting.ts:1789,1793` | Methods exist and are wired; input locking not implemented — UI remains interactive during cutscenes | minor | stub |
| S24 | `wm_area_set_pos` | `scripting.ts:1782` | Writes to `globalState.mapAreas`; `ui_worldmap.ts` does not re-render area markers on write | minor | partial |
| S25 | `critter_attempt_placement` | `scripting.ts:851` | Calls `move_to()` directly; does not search adjacent tiles when the target tile is occupied | minor | partial |
| S26 | `get_poison` / `poison` | `scripting.ts` | Script read/write of `poisonLevel`; no CE-accurate decay loop (though `main.ts` does decrement 1/cycle) | minor | partial |
| S27 | `radiation_dec` | `scripting.ts` | Scripted radiation decrease; deliberately deferred | minor | stub |

---

## 3. Map System & Script Events

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| M1 | **Spatial triggers lost on save/load.** `spatial_p_proc` fires correctly during play. But `map.ts` resets `this.spatials = [[], [], []]` on load, so all spatial triggers in the loaded save are gone. | `map.ts:612` | `map.cc spatialLoad()` | major | bug |
| M2 | **`map_enter_p_proc` on elevation change unclear.** `map.ts:508` has a TODO comment — it is unknown if the procedure should fire when the player changes elevation, and it currently does not. | `map.ts:508` | `map.cc` | minor | partial |
| M3 | **Scripting engine not notified when `objectsAndSpatials` updates.** `map.ts:491–492` — objects added after map load may not get their scripts initialised or run. | `map.ts:491–492` | — | minor | bug |

---

## 4. World Map & Encounters

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| W1 | **Morning-only encounter frequency.** `parseSquare()` reads only `props[2]` (morning frequency) and discards afternoon/night tokens. All squares use morning rates 24 hours a day. | `worldmap.ts:145` | `worldmap.cc:1943 wmParseSubTileInfo()` | major | bug |
| W2 | **Encounter occurrence difficulty modifier missing.** `didEncounter()` has a TODO at line 447: easy difficulty should subtract `encRate/15`, hard should add `encRate/15`. | `worldmap.ts:444–447` | `worldmap.cc:3322 wmRndEncounterOccurred()` | minor | bug |
| W3 | **Encounter-spawned critters have no items or equipment.** `execEncounter()` at `worldmap.ts:409` has a TODO for items. CE's `wmSetupCritterObjs()` equips weapons and other items from the encounter definition. | `worldmap.ts:409`, `encounters.ts` | `worldmap.cc:3771 wmSetupCritterObjs()` | major | partial |
| W4 | **Encounter counter field not decremented.** `encounters.ts` picks encounters from tables but never decrements the `counter` limit field. Encounters marked as one-shot in the data can repeat indefinitely. | `encounters.ts` | `worldmap.cc wmRndEncounterOccurred()` | minor | partial |
| W5 | **Condition system incomplete.** `evalCond()` in `encounters.ts:187`: `player(level)` returns 0 (level check always fails), `time_of_day` returns 12 (always afternoon). The `==` and `!=` comparison operators are not handled. | `encounters.ts:187` | `worldmap.cc wmParseEncounterTableIndex()` | major | partial |
| W6 | **Encounter formation placement partially stubbed.** `positionCritters()` at `encounters.ts:327` implements `surrounding` (PER-based, Cautious Nature bonus) and `huddle`. Formations `back_and_side`, `behind`, `straight_line`, `v_shape` fall through to a stub. | `encounters.ts:327` | `worldmap.cc wmSetupRandomEncounter()` | minor | partial |
| W7 | **Outdoorsman detection check absent.** CE's two-stage encounter: (1) base occurrence roll, (2) separate Outdoorsman-skill check for whether the player can detect and avoid the encounter. DH2 has no detection phase — every rolled encounter is forced. | `worldmap.ts` | `worldmap.cc:3322 wmRndEncounterOccurred()` | major | missing |
| W8 | **Car travel system absent.** No car fuel, no car-speed multipliers, no car encounter-rate reduction. | `worldmap.ts` | `worldmap.cc:5984 wmCarUseGas()` | major | missing |
| W9 | **Area entrance positions misplaced on area screens.** Documented in README; world map area click positions do not align with the rendered overlay markers. | `ui_worldmap.ts`, `worldmap.ts` | — | minor | bug |

---

## 5. Skills & Stat Checks

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| K1 | **Healer perk not applied in First Aid / Doctor.** `skillUse.ts:227` does not read `hasPerk('Healer')`. CE adds `+4 / +10 per rank` to the healing amount. | `skillUse.ts:227` | `skill.cc skillUse()` | minor | partial |
| K2 | **Gambling and Outdoorsman have no interactive handler.** Active use of either falls through to the default "cannot be used directly" error. | `skillUse.ts`, `main.ts:95` | `skill.cc` | minor | missing |
| K3 | **Facing check missing on Steal.** CE requires the thief to approach from behind; DH2 has no facing constraint. | `skillUse.ts` | `skill.cc::skillUse(SKILL_STEAL)` | minor | partial |
| K4 | **Expanded Lockpick Set / Electronic Lockpick not modelled.** Lockpick skill check does not distinguish between tool types. | `skillUse.ts` | `skill.cc` | minor | partial |
| K5 | **"Melee Weapons" skill named "Melee" in PRO.** `char.ts:27` notes that the PRO calls it "Melee"; the engine uses "Melee Weapons". Potential mismatch when reading skill values from proto data. | `char.ts:27` | — | minor | bug |

---

## 6. Dialogue System

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| D1 | **`gdialog_mod_barter(mod)` ignores its `mod` argument.** The modifier passed to the screen-opener is silently dropped; `gdialog_set_barter_mod` (stored in `dialogueBarterMod` and read by `ui_barter.ts:319`) works correctly. If a script relies on the `gdialog_barter(mod)` argument alone (without a prior `gdialog_set_barter_mod` call) the markup is 0. | `scripting.ts:1430`, `ui_barter.ts:319` | `game_dialog.cc:3163 gameDialogBarter()` | minor | bug |
| D2 | **Barter formula uses 1× markup not 2×; Barter skill and reaction not consulted.** See `wiki/barter_economy.md §10` for the full comparison table. | `ui_barter.ts:320` | `inventory.cc:4673 _barter_compute_value()` | major | bug |

---

## 7. Party & NPC Systems

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| P1 | **Party members absent from combat.** No party-member AI turns. Party follows the player but is not part of the combat sequence. See C6. | `combat.ts:301`, `party.ts` | `combat.cc`, `party.cc` | major | partial |
| P2 | **NPC time-of-day schedules not implemented.** Critters with `wander_type > 0` do a simple random-hex wander. CE assigns each NPC a fixed schedule (home/work/sleep positions keyed by hour). | `main.ts:1099` | `scripts.cc`, `ai.cc` | major | missing |
| P3 | **Party companion full AI deferred.** No CHA-based size cap, no formation pathfinding, no companion level-up, no dismissal dialogue hooks. Deliberately out of scope for the current sprint. | `party.ts` | `party.cc` | major | missing |
| P4 | **Speech audio / subtitles not implemented.** `Config.ui.subtitles = false`. No `.acm` speech playback path; `audio.ts` handles music/SFX only. | `audio.ts`, `config.ts` | `sound.cc` | minor | missing |

---

## 8. Time System

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| T1 | **Combat time advances by wall-clock, not turn count.** `events.ts:45` comment: "TODO: advance by combat turns instead." TimedEvents tick faster or slower depending on combat speed rather than a fixed per-turn increment. | `events.ts:45` | `scripts.cc` | minor | bug |

---

## 9. UI / Options

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| U1 | **Preferences screen not implemented.** The `P` shortcut and the Options button both call `alert('not yet implemented')`. Config fields for difficulty, violence level, combat speed, subtitles exist but cannot be changed in-game. | `ui_options.ts` | `preferences.cc` | major | missing |
| U2 | **Volume control absent.** `audio.ts` has play/stop infrastructure but no `GainNode` on the `AudioContext`. Master / music / SFX volume sliders cannot be wired until this is added. | `audio.ts` | `sound.cc` | minor | missing |
| U3 | **Save slot screenshots not saved.** `saveload.ts` saves game state but does not capture a screenshot for the save slot thumbnail. | `saveload.ts` | `loadsave.cc` | minor | missing |
| U4 | **HUD reload AP hardcoded to 2.** `ui_hud.ts:195` and `ui.ts:323` both use a literal `2`; CE reads `reloadAP` from the weapon proto field. | `ui_hud.ts:195`, `ui.ts:323` | `proto_types.h ProtoItemWeaponData` | minor | bug |

---

## 10. Karma & Reputation

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| R1 | **No karma title string table.** `Karma` stat is tracked; `set_pc_stat` / `mod_pc_stat` write it. But there is no lookup that converts a karma value to the FO2 title string ("Vault Dweller", "Grave Digger", etc.). | `player.ts` | `karma.cc` | minor | missing |
| R2 | **No per-town reputation tracking.** Town Reputation stat exists. No per-faction delta table; no string lookup for town reputation titles. | `player.ts`, `scripting.ts` | `karma.cc` | minor | missing |

---

## 11. Type Hygiene (low-priority but tracked)

These are `any`-typed fields and `throw 'TODO'` sites that do not produce visible bugs today but represent technical debt that can mask future bugs.

| ID | Description | File(s) | Sev | Status |
|----|-------------|---------|-----|--------|
| Q1 | `WeaponObj.getAttackSkin()` throws `'TODO'` when `attackOne` is not set — crashes if a weapon with no attack mode is equipped. | `critter.ts:385` | major | bug |
| Q2 | `critter.changeStat()` and `changeSkill()` are `console.warn` no-ops — scripted stat/skill changes silently do nothing. | `critter.ts:605,614` | major | stub |
| Q3 | Ladder destination reads tile number only; elevation and map bits in the destination field are ignored. | `object.ts:784` | minor | partial |
| Q4 | `Obj.serialize()` does not call subclass-specific serialization — `WeaponObj` (de)serialization is incomplete; `leftHand`/`rightHand` commented out. | `object.ts:974`, `object.ts:1877` | major | partial |

---

## 12. Intentionally Deferred — Do Not Implement Unless Tasked

These systems are out-of-scope and marked deliberately incomplete. They appear in source as stubs only.

| System | File(s) | Notes |
|--------|---------|-------|
| Poison decay loop | `drugs.ts`, `main.ts:1063` | Stat field + tick hook exists; CE formula not implemented |
| Radiation accumulation | `main.ts:1076` | `applyRadiationSymptoms` runs but does not accumulate rads from exposure |
| Drug/chem timers | `drugs.ts` | Effect tables defined; no duration/addiction-roll loop |
| Endgame slides | `scripting.ts:1768` | `play_gmovie` skips — no `.mve` infrastructure |
| Unarmed special-move combat logic | `unarmed.ts` | Mode table defined; combat dispatch not wired |
| Party full AI | `party.ts` | Shell only; see P3 above |

---

## Appendix: Outdated TODO.md Entries

The following entries appeared in `TODO.md` but are **confirmed fixed** in `main`:

| Item | Where fixed |
|------|------------|
| `get_month` / `get_day` hardcoded | `vm_bridge.ts:52,56` now reads `GameTime.getDate()` |
| `gsay_message` no-op / bitrotted | `scripting.ts:1461–1479` — full implementation with halt/resume |
| `damage_p_proc` never invoked | `critter.ts:567` — called when `useScript && obj._script` |
| `destroy_p_proc` never invoked | `critter.ts:463`, `map.ts:131` — both call `Scripting.destroy()` |
| Object removal `splice()` index drift | `map.ts:75` — `_removalQueue` with `drainRemovalQueue()` per heartbeat |
| Perk selection UI missing | `ui_character.ts:1875 showPerkModal()` |
| Trait selection missing | `ui_character.ts:1550–1640` |
| Drug decay / addiction loop missing | `main.ts:1073 tickAddictions()` — runs every 600 ticks |
| Poison tick damage missing | `main.ts:1063` — `-1 HP / 10 poison` per 600-tick cycle |
| Radiation symptom tick missing | `main.ts:1076 applyRadiationSymptoms()` |

<!-- audited: 2026-06-01 -->
