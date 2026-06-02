# DarkHarold2 — Known Bugs & Gaps Registry

> **Last audited: 2026-06-02** (time_clock audit added §12; elevation audit added §13; frm_animation added §14; proto_system added §15; tile_system added §16; item_use added §17; random_numbers added §18; config_ini added §19; lighting_deep_dive added §20; rendering_deviations added §21; endgame added §23)
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
| D2 | **Barter formula uses 1× markup not 2×; Barter skill and reaction not consulted.** See `wiki/barter_economy.md §11` for the full comparison table. | `ui_barter.ts:320` | `inventory.cc:4673 _barter_compute_value()` | major | bug |
| D3 | **No dedicated Barter button in dialogue UI.** CE renders a permanent BARTER button gated by `CRITTER_BARTER` proto flag (0x02). DH2 has no such button — barter only accessible if the NPC script adds a dialogue option calling `gdialog_mod_barter`. NPCs with the flag set but no scripted barter option can't trade. | `play.html:57–59`, `scripting.ts:1430` | `game_dialog.cc:3662 _gdCanBarter()`, `obj_types.h:93` | major | missing |

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

## 12. Time & Game Clock

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| GTC1 | **`game_time_hour` opcode returns wrong value.** Opcodes 0x80F6 and 0x80a8 use `floor((ticks/600)%24)` instead of the military format `100*hour+minute` (0-2359). Scripts checking `game_time_hour >= 800` will never match. | `vm_bridge.ts:53-54` | `scripts.cc:332 gameTimeGetHour()` | major | bug |
| GTC2 | **`game_time_advance` skips queue processing.** CE fires `queueProcessEvents()` per day advanced, triggering midnight events (door unjam, story timers, radiation). DH2 directly adds ticks. | `scripting.ts:1755` | `interpreter_extra.cc:2761` | minor | missing |
| GTC3 | **`set_light_level` uses linear mapping, not CE piecewise.** CE maps 0-50 and 51-100 as two separate linear segments (midpoint = 40960); DH2 uses a single linear segment. Also: DH2 silently ignores the call on outdoor maps; CE does not. | `gametime.ts:234`, `scripting.ts:1255` | `interpreter_extra.cc:2233` | minor | bug |
| GTC4 | **`days_since_visited` (0x811B) not wired in `vm_bridge.ts`.** Any script calling `days_since_visited` will fault. | `vm_bridge.ts` | `interpreter_extra.cc:3734` | minor | missing |
| GTC5 | **No midnight queue event.** CE fires `gameTimeEventProcess` each in-game midnight: unjams all doors, checks ARTIMER story movies, runs radiation on player. | `main.ts` | `scripts.cc:405 gameTimeEventProcess` | minor | missing |
| GTC6 | **Starting month is August (DH2) vs July (CE).** `START_MONTH = 7` (0-indexed) vs CE `gStartMonth = 6`. `get_month` returns 8 where CE returns 7. | `gametime.ts:36` | `sfall_config.cc:31` | minor | bug |
| GTC7 | **No 13-year endgame timeout.** CE ends the game when ticks exceed 13 × TICKS_PER_YEAR. | `gametime.ts` | `scripts.cc:368` | minor | missing |
| GTC8 | **Pathfinder perk does not reduce worldmap travel time.** CE reduces per-step ticks by 25% per rank. | `worldmap.ts:651` | `worldmap.cc:4178` | minor | missing |
| GTC9 | **`game_time_in_seconds` (0x80EB) not wired.** | `vm_bridge.ts` | `interpreter_extra.cc:2277` | low | missing |
| GTC10 | **Day/night ambient light curve is a DH2 invention.** CE has no clock-driven ambient curve; only script-controlled `set_light_level`. | `gametime.ts:181` | `light.cc`, `map.cc:927` | low | deviation |

<!-- audited: 2026-06-02 -->

---

## 13. Elevation System

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| EL1 | **`elevation(obj)` always returns player's current elevation.** `scripting.ts:753` returns `globalState.currentElevation` for all objects. CE returns `obj->elevation`. Scripts querying another object's floor get the wrong answer. | `scripting.ts:753`, `vm_bridge.ts:158` | `interpreter_extra.cc:2285 opGetObjectElevation()` | major | bug |
| EL2 | **`doEnterElevation()` fires `map_enter_p_proc` on stair/ladder elevation change.** CE `mapSetElevation` fires only `map_update_p_proc`. DH2 calls `doEnterElevation()` on every stair/ladder use, triggering map-entry side-effects (light resets, NPC repositions, first-visit flags) on every floor change. | `map.ts:193-205`, `object.ts:775,792,799` | `map.cc:362 mapSetElevation()` | major | bug |
| EL3 | **No elevator opcode handler.** CE `scriptsHandleRequests` has a dedicated elevator branch with door animation and same-map/cross-map split. DH2 routes elevator objects through the generic stair/ladder path. | `object.ts:765` | `scripts.cc:926 scriptsHandleRequests SCRIPT_REQUEST_ELEVATOR` | minor | missing |
| EL4 | **`_map_data_elev_flags` bitmask not in DH2 map format.** CE stores per-elevation empty/present state in `MapHeader.flags`. DH2 uses `levels` array length only; empty elevations cannot be represented. | `map.ts:435` | `map.cc:81 _map_data_elev_flags` | low | missing |
| EL5 | **`map_update_p_proc` fires only on current-elevation objects.** `getObjectsAndSpatials()` (map.ts:93) returns only current-elevation objects. CE runs `map_update_p_proc` on all loaded scripts regardless of elevation, so critters on other floors keep ticking. | `map.ts:93`, `scripting.ts:2118` | `scripts.cc:2601 scriptsExecMapUpdateScripts()` | minor | bug |

<!-- audited: 2026-06-02 -->

---

## 14. FRM Animation Pipeline

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| FA1 | **`updateStaticAnim` hardcodes fps = 8.** Comment reads `// todo: get FPS from image info`. Should read `info.fps \|\| 10`. Flowing water, fire, and other looping scenery animations play at the wrong speed. | `object.ts:1335` | `art.cc:713 artGetFramesPerSecond()` | minor | bug |
| FA2 | **`getAnimDistance` reads direction 1 for the last frame.** Uses `frameOffsets[1][numFrames-1].ox` (direction E) instead of `frameOffsets[0][numFrames-1].ox` (direction NE). Returns wrong hex-steps-per-cycle, causing walk partial-action boundaries to be off and producing hitching. | `object.ts:1980` | `animation.cc:1716 pathfinderFindPath()` | major | bug |
| FA3 | **`actionFrame` discarded by the extraction pipeline.** `frmpixels.py:40` reads the header field into `_actionFrame` (not saved to output dict). Absent from `imageMap.json`. DH2 cannot synchronise hit-detection or sounds to the correct animation frame for weapon attacks. | `frmpixels.py:40` | `art.h ArtFrame.actionFrame` | major | missing |
| FA4 | **No combat walk speed bonus.** CE `animationComputeTicksPerFrame` (`animation.cc:3287`) applies a `combat_speed` preference bonus to ANIM_WALK tick rate during combat. DH2 uses a fixed `1000/fps` for all animations. | `object.ts:1395` | `animation.cc:3287` | minor | missing |
| FA5 | **Walk start: `obj.shift={x:0,y:0}` is truthy; frame 0's static ox/oy is skipped.** Renderer takes the shift branch (+0) instead of the static branch (`frameInfo.ox`) for the first frame of a walk cycle. Most walk FRMs have frame-0 ox=0 so it is invisible in practice, but FRMs with a non-zero initial delta will display one frame off-anchor. | `renderer.ts:311`, `object.ts:1417` | `object.cc _obj_offset()` | low | bug |

<!-- audited: 2026-06-02 -->

---

## 15. Proto System

> Source: `wiki/proto_system.md` · CE: `proto.cc`, `proto.h`, `proto_types.h` · DH2: `src/pro.ts`, `src/scripting.ts`, `src/vm_bridge.ts`, `proto.py`

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| PS1 | **`proto_data` opcode (0x8104) not wired in `vm_bridge.ts`.** `scripting.ts` has a `proto_data` method but `vm_bridge.ts` has no entry for 0x8104. Any script calling `proto_data()` falls through to the unknown-opcode error handler, breaking item stat queries. | `vm_bridge.ts`, `scripting.ts:1090` | `interpreter_extra.cc opGetProtoData()` | major | bug |
| PS2 | **`proto.py` sets `FO1 = True`, suppressing critter `damageType` extraction.** The `FO1` flag is a Fallout 1 compat guard; the pipeline is targeting Fallout 2 data. `damageType` is never written to the JSON, so critters always use the fallback value (0 = normal) instead of their CE-defined damage type. | `proto.py:34` | `proto_types.h CritterProtoData.damageType` | major | bug |
| PS3 | **Tile PROs not extracted by pipeline.** `exportPRO.py` only processes types 0–3 (items, critters, scenery, walls). Type 4 (tiles) is silently skipped. DH2 never reads tile prototype data — terrain movement cost and special tile flags come entirely from hardcoded heuristics. | `exportPRO.py`, `proto.py` | `proto_types.h TileProto` | low | missing |
| PS4 | **Wall and misc `extra` fields not parsed.** CE `WallProto` has an `extra` sub-struct with 4 fields (materialType, etc.); `MiscProto.extra` similarly. `proto.py` writes no `extra` key for these types, and `pro.ts` has no wall/misc field accessors. | `proto.py`, `src/pro.ts` | `proto_types.h WallProto.extra`, `MiscProto.extra` | low | missing |
| PS5 | **`proto_data` item `data_member` IDs don't match CE.** DH2's `proto_data` handler in `scripting.ts` counts DataMember fields from 0 (subType=0, material=1, size=2 …); CE defines `ITEM_DATA_MEMBER_TYPE=9`, `MATERIAL=11`, `SIZE=12` etc. Scripts using CE-standard member IDs receive incorrect field values or undefined. | `scripting.ts:1090-1150` | `proto.h ItemDataMember enum` | major | bug |

<!-- audited: 2026-06-02 -->

---

## 16. Tile System

> Source: `wiki/tile_system.md` · CE: `tile.cc`, `tile.h`, `obj_types.h` · DH2: `src/tile.ts`, `src/geometry.ts`

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| TS1 | **No edge-check in `hexInDirectionDistance`.** CE `tileGetTileInDirection` calls `tileIsEdge` before each step and breaks at the grid boundary. DH2 `hexInDirectionDistance` has no equivalent guard; walking off the 200×200 grid returns out-of-bounds `{x, y}` coordinates, potentially causing out-of-bounds lookups in object lists or spatial arrays. | `src/geometry.ts:171` | `tile.cc:893 tileIsEdge()` | minor | bug |
| TS2 | **`hexDirectionTo` uses grid-space delta instead of screen-space delta.** CE `tileGetRotationTo` projects both tiles to screen coordinates before applying atan2. DH2 applies atan2 to the raw grid delta `(b.x−a.x, b.y−a.y)`. Because DH2's x-axis runs opposite to screen-x, the direction is systematically wrong (e.g., returns 4/W instead of 0/NE for the NE neighbour). The function itself carries a "TODO: check correctness" comment. | `src/geometry.ts:210` | `tile.cc:910 tileGetRotationTo()` | major | bug |
| TS3 | **No `_tile_num_beyond` equivalent.** CE uses this Bresenham-based function to walk a straight screen-space line and return the tile `distance` steps past a target — used for projectile overshoot and `shoot_into_the_air`. DH2's `hexLine(a, b)` only walks to `b`, not past it. | `src/geometry.ts` | `tile.cc:944 _tile_num_beyond()` | minor | missing |
| TS4 | **`tile_coord()` in `tile.ts` is unused and broken.** An incomplete CE-compatible `tile_coord(tileNum)` function (tile.ts:81) uses hardcoded screen offsets and contains an active `console.log`. It is never called from anywhere in the codebase. | `src/tile.ts:81` | `tile.cc:674 tileToScreenXY()` | low | bug |

<!-- audited: 2026-06-02 -->

---

## 17. Item Use & Scenery Interaction

> Source: `wiki/item_use.md` · CE: `proto_instance.cc`, `scripts.cc`, `obj_types.h` · DH2: `src/object.ts`, `src/scripting.ts`, `src/skillUse.ts`

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| IU1 | **`use_obj_on_obj` fires `use_p_proc` instead of `use_obj_on_p_proc`.** `scripting.ts:1227` calls `obj.use(who, true)` which dispatches `use_p_proc` on the target. CE `_protinst_use_item_on` fires `SCRIPT_PROC_USE_OBJ_ON` — the two-step item/target chain. Quest-item interactions (e.g. Wrench on car engine) will invoke the wrong proc and silently do nothing. | `src/scripting.ts:1227` | `proto_instance.cc:1245 _protinst_use_item_on()` | major | bug |
| IU2 | **Proc name mismatch: DH2 uses `use_obj_on_me_p_proc` / `use_skill_on_me_p_proc`; CE scripts export `use_obj_on_p_proc` / `use_skill_on_p_proc`.** Any CE-compiled script that defines these procs will never be called. | `src/scripting.ts:390–391` | `scripts.h:61–62` | major | bug |
| IU3 | **No jammed state on `Obj`; `jam_lock` / `unjam_lock` opcodes unimplemented; midnight unjam never fires.** CE sets `DOOR_FLAG_JAMMGED` on lockpick critical failure and clears all jam bits at midnight via `objectUnjamAll()`. DH2 `Obj` has no `jammed` field; doors remain perpetually unjammed. Cross-reference GTC5 in known_bugs.md. | `src/scripting.ts` (missing opcodes) | `proto_instance.cc:2131 objectJamLock()`; `scripts.cc:418 gameTimeEventProcess()` | minor | missing |
| IU4 | **No locked-door SFX or "That door is locked." message.** CE `_obj_use_door` plays the locked sound and prints the message before firing `use_p_proc`. DH2 `setObjectOpen()` returns `false` silently when `obj.locked === true`. | `src/object.ts:136` | `proto_instance.cc:1710–1722 _obj_use_door()` | minor | bug |
| IU5 | **Container loot UI opens immediately instead of after animation.** `setObjectOpen()` calls `uiLoot(obj)` before any animation plays. CE separates the loot screen from the `objectOpenClose()` animation completion. | `src/object.ts:152` | `proto_instance.cc:1825–1840 _obj_use_container()` | minor | bug |

<!-- audited: 2026-06-02 -->

---

## 18. Random Number System

> Source: `wiki/random_numbers.md` · CE: `random.cc`, `random.h`, `interpreter_extra.cc` · DH2: `src/util.ts`, `src/scripting.ts`, `src/combat.ts`

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| RN1 | **Fixed seed 123 makes every session deterministic.** `Scripting.init()` always calls `seed(123)`, resetting the sin-based PRNG. CE seeds from `compat_timeGetTime()` — different rolls every launch. Every DH2 player gets the same sequence of crits, misses, and drops. | `src/scripting.ts:2206` | `random.cc:39 randomInit()` | minor | bug |
| RN2 | **`roll_dice` opcode (0x80B5) not registered in `vm_bridge.ts`.** Any script calling `roll_dice` hits an unknown-opcode trap. CE also never implemented the body (predefined error), but CE pushes 0 gracefully. | `src/vm_bridge.ts` | `interpreter_extra.cc:789 opRollDice()` | low | missing |
| RN3 | **Sniper perk rolls d100 instead of d10.** `combat.ts:526` uses `getRandomInt(1, 100)` vs CE's `randomBetween(1, 10)`. Makes the perk ~10× harder to trigger. Direct cause of §C1. | `src/combat.ts:526` | `combat.cc:3892` | major | bug |
| RN4 | **`rollSkillCheck` uses 101 outcomes ([0–100]) vs CE's 100 ([1–100]).** Makes combat hit rolls very slightly easier at all skill values. | `src/util.ts:110` | `random.cc:134 randomBetween()` | low | bug |
| RN5 | **No statistical validation of DH2 sin-PRNG.** CE runs a 100,000-sample chi-squared test at startup. Sin-PRNG has known non-uniform bit patterns that are unmonitored. | `src/util.ts:102` | `random.cc:224 randomValidatePrerandom()` | low | missing |

<!-- audited: 2026-06-02 -->

---

## 19. Config & INI System

> Source: `wiki/config_ini.md` · CE: `config.cc`, `game_config.h`, `settings.h`, `settings.cc` · DH2: `src/config.ts`, `src/ui_options.ts`, `src/init.ts`

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| CI1 | **No fallout2.cfg — all config is hardcoded.** DH2 has no file-based config; all defaults are baked into `Config` in `src/config.ts`. Users cannot edit settings between sessions via a file. | `src/config.ts` | `config.cc:273 configRead()`; `game_config.h:8` | minor | missing |
| CI2 | **`game_difficulty` and `combat_difficulty` conflated.** CE has separate keys affecting skill checks/loot/XP vs enemy stats. DH2 maps both to `difficultyModifier` which only scales combat damage. | `src/config.ts:62`; `src/ui_options.ts:205` | `settings.h:29-31`; `preferences.cc:371-372` | minor | missing |
| CI3 | **`combat_speed` uses inverse/incompatible scale.** CE: 0–50 integer where 0=slowest. DH2: discrete values 1/2/4 where 4=fastest. Inverse and non-equivalent. | `src/config.ts:67` | `preferences.cc:382`; `game_config.h:44` | low | bug |
| CI4 | **`running` defaults differ.** CE default is false (walk by default); DH2 `doAlwaysRun` defaults to true (always run). | `src/config.ts:41` | `settings.h:38` | low | bug |
| CI5 | **Preferences stored in localStorage, not fallout2.cfg.** CE writes back to fallout2.cfg on exit. localStorage is lost in private browsing or on cache clear. | `src/ui_options.ts:332` | `settings.cc:118 settingsToConfig()`; `config.cc:313` | minor | missing |
| CI6 | **`speech_volume` not persisted in DH2 preferences.** CE saves it to fallout2.cfg on every exit. | `src/ui_options.ts:315` | `settings.cc:93` | low | bug |
| CI7 | **`item_highlight` setting absent.** CE allows toggling item-highlighting on cursor hover. DH2 has no Config field or UI toggle for this. | `src/config.ts` | `game_config.h:37`; `settings.h:33` | low | missing |
| CI8 | **`target_highlight` loses "targeting only" mode.** CE has three states (0=Off/1=On/2=Targeting-only). DH2 collapses to a boolean. | `src/ui_options.ts:232-237` | `game_config.h:111-115 TargetHighlight enum` | low | bug |
| CI9 | **No `text_base_delay` / `text_line_delay`.** CE auto-advances dialogue text after a configurable per-line delay. DH2 has no auto-advance. | `src/config.ts` | `settings.h:42-43` | low | missing |

<!-- audited: 2026-06-02 -->

---

## 20. Lighting Deep Dive

> Source: `wiki/lighting_deep_dive.md` · CE: `light.cc`, `light.h`, `object.cc`, `interpreter_extra.cc`, `obj_types.h` · DH2: `src/lightmap.ts`, `src/scripting.ts`, `src/object.ts`
>
> Supplements the 10 gaps in `wiki/lighting.md §9` with additional implementation-level gaps.

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| LD1 | **Hidden objects still emit light.** `bakeStaticLight()` / `rebuildDynamicLight()` do not check `obj.visible`. CE `_obj_adjust_light` bails on `OBJECT_HIDDEN`. Scripts hiding a torch (e.g. `set_obj_visibility(torch, 1)`) leave the tile lit in DH2. | `src/lightmap.ts:564,576` | `object.cc:3973` | minor | bug |
| LD2 | **`OBJECT_LIGHTING` flag (0x20) not checked.** CE `_obj_adjust_light` bails when `(flags & OBJECT_LIGHTING) == 0`. DH2 illuminates any object with `lightRadius > 0` regardless of the flag. | `src/lightmap.ts:68` | `object.cc:3977`; `obj_types.h:61` | low | bug |
| LD3 | **`obj_set_light_level` does not update lightmap.** `scripting.ts:1267` stores fields but never calls `obj_adjust_light()` or `bakeStaticLight()`. Visible lightmap unchanged until next map reload. CE calls `objectSetLight()` → full turn-off/turn-on cycle. | `src/scripting.ts:1262` | `interpreter_extra.cc:3071`; `object.cc:1721` | major | bug |
| LD4 | **`set_obj_visibility` does not update lightmap.** Sets `obj.visible = !visibility` but does not remove or restore the object's light contribution. CE `objectHide`/`objectShow` call `_obj_turn_off_light` / `_obj_turn_on_light`. | `src/scripting.ts:1213` | `interpreter_extra.cc:2096-2119` | minor | bug |
| LD5 | **`objectGetLightIntensity` self-subtraction absent.** CE subtracts the player's own `lightIntensity` from the tile value before computing effective light level (prevents self-illumination). No DH2 equivalent — moot while night-penalty is absent (lighting.md gap #1). | `src/combat.ts:441` | `object.cc:1748` | low | missing |
| LD6 | **`obj_set_light_level` intensity not converted from percent.** CE: `(intensity × 65636) / 100`. DH2: stores raw value directly — result is 100× too dim when scripts pass percentage values (0–100 range). | `src/scripting.ts:1267` | `interpreter_extra.cc:3071` | major | bug |

<!-- audited: 2026-06-02 -->

---

## 21. Rendering Deviations

> Source: `wiki/rendering_deviations.md` · CE: `tile.cc`, `object.cc`, `color.cc` · DH2: `src/webglrenderer.ts`, `src/renderer.ts`, `src/object.ts`, `shaders/`
>
> Accepted deviations (RD01–RD05, RD02 high-DPI, RD03 zoom) are not listed here. Scripting-level lighting deviations are in §20 (LD1–LD6). See `wiki/rendering_deviations.md §4` for fix priority ordering.

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| RD06 | **Roof clipping not implemented.** CE `tile_fill_roof` flood-fills connected roof tiles when player walks under a building. DH2 renders all roofs unconditionally. `Config.ui.showRoof` is all-or-nothing. `map.hasRoofAt()` exists but is not wired to per-position rendering. | `src/webglrenderer.ts:965`, `src/map.ts:135` | `object.cc:1445`; `tile.cc tile_fill_roof()` | major | missing |
| RD07 | **OBJECT_FLAT two-pass rendering absent.** CE renders flat objects (floor decals, blood) in a dedicated first pass before all non-flat objects. DH2 renders all objects in one sorted pass. | `src/renderer.ts:119` | `object.cc:761 _obj_render_pre_roof()` | minor | missing |
| RD08 | **No post-roof object pass.** CE `_obj_render_post_roof` renders objects that must appear above the roof layer at full intensity (0x10000). DH2 has no post-roof pass. | `src/renderer.ts:119` | `object.cc:862 _obj_render_post_roof()` | minor | missing |
| RD09 | **Object depth sort approximate.** CE uses a two-phase isometric sort (`_obj_order_comp_func_even/odd`, `tileIsInFrontOf`, `tileIsToRightOf`) correct for all 6 hex directions. DH2 `objectZCompare` sorts by hex-y then hex-x; fails at NE/SW diagonal hex borders. | `src/object.ts:182` | `object.cc:761`; `tile.cc tileIsInFrontOf()` | minor | bug |
| RD10 | **Color cycling absent.** CE `colorCycleEnable/Disable` drives time-based palette rotation for water and fire. DH2 has no palette cycling; water and fire sprites are static. | — | `color.cc colorCycleEnable()` | minor | missing |
| RD11 | **Scroll blocking not implemented.** CE respects `OBJECT_SCROLL_BLOCK` flagged scenery to prevent the viewport scrolling through barrier objects. | `src/renderer.ts` | `tile.cc tileSetCenter()`; `gTileScrollBlockingEnabled` | minor | missing |
| RD12 | **Scroll border limiting absent.** CE clamps viewport to `gTileBorderMin/MaxX/Y`. DH2 camera can scroll to expose grey canvas beyond the map edge. | `src/renderer.ts` | `tile.cc:537` | low | missing |
| RD13 | **Hex click hit-testing is approximate.** CE uses `_tile_mask[512]` (32 × 16 px, 5 sub-regions) for pixel-precise diamond edges. DH2 uses cube-coordinate rounding (`hexFromScreen`) — imprecise at hex boundaries. | `src/geometry.ts:135` | `tile.cc:718 tileFromScreenXY()` | low | bug |
| RD14 | **Elevation transition is instant.** CE fades/transitions between elevation levels. DH2 switches immediately. | `src/map.ts:196` | `map.cc mapSetElevation()` | low | missing |
| RD15 | **Roof tile lighting deviation — ground truth unclear.** CE `tileRenderRoofsInRect` appears to blit roofs at full palette intensity (no `intensityColorTable`). DH2 roofs render at `max(0, ambient) = ambient` via `roofDummyTexture` — dimming at night. See `wiki/rendering_deviations.md §5 Q1`. | `src/webglrenderer.ts:989` | `tile.cc tileRenderRoofsInRect()` | low | bug |

<!-- audited: 2026-06-02 -->

---

## 22. Pathfinding

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| P1 | **PathFinding.js treats the hex grid as orthogonal.** CE's A* iterates all 6 hex rotations per node (`animation.cc:1795`). PathFinding.js uses 4/8-connected grid movement; hex topology mismatches may produce sub-optimal or visually odd paths near angled walls. | `map.ts:604` | `animation.cc:1795` | minor | bug |
| P2 | **No rotation-change step cost.** CE adds +10 to a node's cost when the direction changes from its parent (outside combat). | `map.ts:605` | `animation.cc:1838` | low | missing |
| P3 | **No radioactive goo tile penalty.** CE adds +100 (gecko) or +400 (others) to step cost when the tile contains radioactive goo PID objects. | `map.ts:596` | `animation.cc:1852` | low | missing |
| P4 | **Closed doors are hard path blocks; no door-opening during pathing.** CE's A* allows traversal through unlocked/openable doors via `canUseDoor`; the critter then opens the door mid-walk. | `map.ts:596` | `animation.cc:1805` | minor | missing |
| P5 | **No `OBJECT_MULTIHEX` neighbor check in `blocks()`.** CE `_obj_blocking_at` also scans all 6 adjacent tiles for MULTIHEX-flagged objects. DH2's `Obj.blocks()` only tests the object's own tile. | `object.ts:559` | `object.cc:2413` | low | missing |
| P6 | **No shoot-blocking type.** `_obj_shoot_blocking_at` excludes dead critters and `OBJECT_SHOOT_THRU` objects. DH2 uses the same `blocks()` predicate for pathfinding and LoF alike. | `map.ts:596` | `object.cc:2440` | minor | missing |
| P7 | **`hasLineOfSight` checks only `type === 'wall'`.** CE `_obj_sight_blocking_at` blocks on scenery objects without `OBJECT_LIGHT_THRU`; DH2 ignores scenery for combat LoS. | `combat.ts:1471` | `object.cc:2583` | minor | bug |
| P8 | **Script opcodes `make_path` / `obj_blocking_at` / `make_straight_path` are stubs.** | `scripting.ts` | `sfall_opcodes.cc:937,951` | low | stub |

<!-- audited: 2026-06-02 -->

---

## 23. Endgame System

> Source: `wiki/endgame.md` · CE: `src/endgame.cc`, `endgame.h` · DH2: `src/endgame.ts`, `tools/convertEndgame.py`

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| EG3 | **Panning slide uses linear timing instead of CE's per-pixel formula.** CE computes `v9` (ms per pixel step) from image width and speech duration. DH2 uses a simple linear pan over `max(speechDuration, 5s)`. | `src/endgame.ts:showPanningSlide` | `endgame.cc:337-345` | low | bug |
| EG4 | **`endgame_movie` skips credits music and text.** CE plays `akiss.acm`, calls `creditsOpen("credits.txt")`, then loads `10labone.acm`. DH2 shows only the "continue playing?" dialog. | `src/endgame.ts:playMovie` | `endgame.cc:234`; `credits.cc` | minor | missing |
| EG5 | **Death ending slide is a black screen.** CE plays the narrator over the death scene. DH2 `playDeathEnding()` shows a blank canvas. | `src/endgame.ts:playDeathEnding` | `critter.cc:912` | low | missing |
| EG6 | **`setupDeathEnding` not wired to player death.** CE calls it immediately when the player dies (`critter.cc:912`). The DH2 export exists but is not called from `critter.ts`. | `src/critter.ts` | `critter.cc:912` | major | missing |

<!-- audited: 2026-06-02 -->

---

## 24. Intentionally Deferred — Do Not Implement Unless Tasked

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
