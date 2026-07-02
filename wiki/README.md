# DarkHarold2 Wiki — Index

Quick-lookup reference for all 38 game-system docs and 3 meta/audit docs. Each
entry is one to three sentences. For the live bug registry start with
[known_bugs.md](known_bugs.md). For a map of the CE C++ codebase start with
[CODEBASE_FOCE.md](CODEBASE_FOCE.md).

---

## Reference Maps

| File | Summary |
|------|---------|
| [CODEBASE_FOCE.md](CODEBASE_FOCE.md) | Navigational map of every `.cc`/`.h` file in fallout2-ce that is relevant to DH2. Use it to locate the authoritative C++ source for any system before reading or implementing. |
| [CODEBASE_jsFO.md](CODEBASE_jsFO.md) | Navigational map of the jsFO project (plain ES6 browser Fallout engine). Secondary patterns reference only — jsFO is less complete than DH2 and not authoritative for game mechanics. |
| [CROSS_CHECK_NOTES.md](CROSS_CHECK_NOTES.md) | Audit notes from a 2026-05-31 pass comparing three wiki docs against raw CE source. Records confirmed facts, known discrepancies, and open questions for `damage_formula.md`, `scripting_vm.md`, and `combat.md`. |

---

## Core Combat

| File | Summary |
|------|---------|
| [combat.md](combat.md) | Full combat lifecycle: initiative, AP pool, turn sequencing, attack resolution, burst fire, and critical hit/miss tables. Covers the CE `combat.cc` flow mapped against DH2's `src/combat.ts`. |
| [damage_formula.md](damage_formula.md) | The CE `attackComputeDamage` formula step-by-step: base damage, ammo DR modifier, armor DR/DT application, bonus ranged damage, and DH2 implementation fidelity. |
| [actions.md](actions.md) | CE `actions.cc` action dispatch layer: `_action_attack` melee/ranged routing, death animation selection by damage type (`_pick_death`), knockdown slide, item pickup animation queue, `actionUseSkill`, and `actionExplode`. Lists gaps AC1–AC8 for missing DH2 equivalents. |
| [weapon_combat.md](weapon_combat.md) | Weapon PRO data fields, attack mode tables, ammo type stats, hit-mode to animation code mapping, burst fire radius, and DH2 `Weapon` class fidelity against CE `item.cc`. |
| [critter_stats.md](critter_stats.md) | Non-player critter stat storage, CE `proto_types.h` field layout, armor class formula, SPECIAL-to-derived stat formulas for critters, and flags (`CRITTER_*`) that affect combat behaviour. |
| [ai_behavior.md](ai_behavior.md) | CE `combat_ai.cc` AI packet fields, target selection, flee/aggression thresholds, burst-mode conditions, AP budget, and DH2 `combat.ts` AI approximation gaps. |

---

## Character & Stats

| File | Summary |
|------|---------|
| [character_stats.md](character_stats.md) | SPECIAL base stats, all derived stat formulas (HP, AC, carry weight, sequence, etc.), the character creation flow (tag skills, trait picks, starting SPECIAL), and DH2 `src/player.ts` implementation gaps. |
| [perks_traits.md](perks_traits.md) | Complete perk and trait tables with CE `perk_defs.h` / `trait_defs.h` values, level requirements, and which modifiers DH2 implements vs stubs. |
| [skill_checks.md](skill_checks.md) | CE `skill.cc` skill formula, `skillRoll` pass/fail mechanic, critical success/failure thresholds, tagged-skill bonus, and how DH2 `skillUse.ts` deviates (missing tagged-skill critical success). |
| [status_effects.md](status_effects.md) | Drug use mechanics, addiction thresholds and withdrawal penalties, poison damage ticks, and radiation level/penalty system — all four drawn from CE `item.cc` / `queue.cc`. DH2 has stat fields but no active decay loops for any of these systems. |

---

## Scripting & VM

| File | Summary |
|------|---------|
| [scripting_vm.md](scripting_vm.md) | DH2's three-file scripting architecture (`vm.ts` bytecode decoder, `vm_bridge.ts` opcode wiring, `scripting.ts` Script class), procedure hook lifecycle, stack layout, and the full `opMap` of low-level bytecode handlers. |
| [scripting_reference.md](scripting_reference.md) | Full reference tables: `SCRIPT_PROC_*` hook IDs, variable scoping (GVAR/LVAR/MVAR), VM bytecodes (0x8000–0x804B), intrinsic opcodes (0x80A0+), `get_pc_stat` constants, `metarule` IDs, and the list of unwired opcodes. |
| [map_scripting.md](map_scripting.md) | Map-level script lifecycle (load, enter, exit, use, damage, spatial), NEVS named event system (`nevs.cc`), scripted elevation changes, and how `tools/fomap.py` extracts script headers into map JSON. |
| [spatial_triggers.md](spatial_triggers.md) | CE `SCRIPT_TYPE_SPATIAL` trigger mechanics: tile/elevation encoding, `scriptsExecSpatialProc` dispatch, radius vs exact-tile matching, and DH2 `hitSpatialTrigger` implementation fidelity. |

---

## World & Navigation

| File | Summary |
|------|---------|
| [tile_system.md](tile_system.md) | Tile coordinate system (`tileNum = y×200 + x`), hex-to-screen projection formulas, direction delta tables, multi-elevation map structure, elevation change scripting opcodes, and CE `tile.cc` vs DH2 geometry. |
| [worldmap.md](worldmap.md) | World-map navigation (party walk, sub-tile visibility, car travel, city/map area flags), complete random encounter system (table parsing, `wmRndEncounterOccurred`, critter placement), and DH2 gap catalogue. |
| [pathfinding.md](pathfinding.md) | CE `_make_path` / `pathfinderFindPath` algorithm (A* variant in `animation.cc`), movement costs, blocking flags. DH2 uses PathFinding.js — gaps include lacking CE's parity-dependent movement cost and critter-blocking logic. |
| [time_clock.md](time_clock.md) | In-game time constants (tick = 10 seconds, 10 ticks/minute), `gameTimeGetTime`/`gameTimeSetTime`, day/night cycle, and DH2 `gametime.ts` fidelity including `TimedEvent` tick callbacks. |
| [random_numbers.md](random_numbers.md) | CE `random.cc` LCG implementation, `randomBetween`/`randomRoll` usage, seeding behaviour, and why DH2's `Math.random()` replacement is functionally acceptable but not bit-identical. |

---

## Rendering & Art

| File | Summary |
|------|---------|
| [rendering.md](rendering.md) | CE software render pipeline vs DH2's WebGL 2.0 pipeline: tile draw order, object Z-sort algorithm, screen-position math, and the authoritative catalogue of all known deviations (RD06–RD17) including missing roof clipping, object sort approximation, absent palette effects, and the fixed lightmap hex-sampling offset. |
| [lighting.md](lighting.md) | Intensity scale (0–65536), per-object light sources, `_obj_adjust_light` propagation, ambient ambient reset on map load, night penalty to combat, time-of-day transitions, scripting opcodes (`set_light_level`, `obj_set_light_level`), and render integration. Known gaps LD1–LD6 cover hidden-object lighting, OBJECT_LIGHTING flag, and unwired opcodes. |
| [animation.md](animation.md) | FRM binary format, FID structure (type/ID/weapon/direction), animation ID enum, `reg_anim_begin/end` batch system, weapon anim codes, scripting animation opcodes, and palette cycling (`cycle.cc` 5 color groups at 4 speed tiers — not yet implemented in DH2). Gaps AN1–AN18. |
| [alignment.md](alignment.md) | Screen-space alignment reference for every renderable category (floor tiles, walls/scenery, roofs, objects/critters, player) — CE anchor formulas vs DH2's `tileToScreen`/`objectRenderInfo`, the roof `−96` offset, the `uniformFrameWidth` vs trimmed `frameWidth` sheet-packing distinction, and the `8.4` lightmap-UV inverse. Also the full **lighting-alignment** trilogy, all rooted in `hexToScreen`'s per-column parity: §6 light-centring offset (RD17), §7 interpolation stripes / `hex-lerp` modes, §8 W-E wall occlusion bleed (LD11). |

---

## Audio

| File | Summary |
|------|---------|
| [sound_system.md](sound_system.md) | ACM audio format, SFX naming conventions (`sfxBuildWeaponName`, `sfxBuildCharName`), ambient loop system, music playback, and DH2's Web Audio API implementation with pre-decoded WAV files. Covers `game_sound.cc`, `audio.cc`, and `audio_engine.cc` ground truth. |

---

## UI & Interface

| File | Summary |
|------|---------|
| [interface_windows.md](interface_windows.md) | All in-game UI panels: HUD bar (HP/AP/poison/radiation indicators), inventory, character sheet, Skilldex, barter, PipBoy button, elevator panel, and the `UIMode` mutual-exclusion system. Gaps IW1–IW11 and EV1–EV4. |
| [hotkeys.md](hotkeys.md) | Full keyboard binding table for DH2 vs CE `gameHandleKey`, including what works, what is missing, and known conflicts (F2, Home). |
| [pipboy.md](pipboy.md) | Pip-Boy window system (status, inventory, automaps, quests, skills), quest display logic, holodisk viewing mechanics (absorbed from `holodisk.md`), and DH2 `ui_pipboy.ts` fidelity gaps #1–#9. |
| [dialogue_system.md](dialogue_system.md) | CE `game_dialog.cc` dialogue state machine, reaction system, `gdialog_*` scripting opcodes, BARTER button gating, `MSG` file format from `message.cc`, and DH2 `ui_dialogue.ts` implementation gaps. |
| [settings.md](settings.md) | CE `fallout2.cfg` format and key table, in-game Options screen (`options.cc`), full preference table with defaults and DH2 mappings, floating text object system (`text_object.cc`), and DH2 `src/config.ts` gaps S-CI1–S-CI6 / S-PR1–S-PR6. |

---

## Economy, Items & Social

| File | Summary |
|------|---------|
| [economy.md](economy.md) | Item flow (pickup/drop/transfer scripting opcodes), carry-weight system, loot container mechanics, barter UI flow, and `_barter_compute_value` formula with full DH2 deviation table. Covers both `loot_economy` and `barter_economy` content. Gaps L1–L11 + B1–B12. |
| [items.md](items.md) | Item type taxonomy (weapon/ammo/armor/container/drug/key/misc), PRO field layout, inventory stack management, equip/unequip, drug consumption, scenery/door interaction, container opening, and all item-related scripting opcodes. |
| [faction_reputation.md](faction_reputation.md) | Global karma score and title thresholds, per-town reputation values and effects, NPC reaction system (base + modifiers), PC-Stat karma fields, and the egg transparency zone system (`OBJECT_TRANS_*` rendering). Gaps K1–K9 + E1–E10. |
| [companion_party.md](companion_party.md) | CE `party_member.cc` party management (join/leave, level scaling, morale), AI delegation for skill use, and DH2 `src/party.ts` stub coverage. |

---

## Data Infrastructure

| File | Summary |
|------|---------|
| [file_formats.md](file_formats.md) | Binary format specs for every file type DH2 consumes: FRM, PRO, MAP, INT (compiled script), PAL, LST, MSG, and ACM. Big-endian unless noted. |
| [proto_system.md](proto_system.md) | PRO file type encoding (high-byte 0–5), `pro.ts` ProtoMap cache, `proGet`/`protoGetName` API, object PID construction, and the DH2 JSON baking pipeline (`tools/proto.py`). |
| [save_load.md](save_load.md) | CE savegame format (slot structure, state serialized per system), DH2 localStorage save format, serialization of GVARs/LVARs/MVARs, and known gaps (no critter-state persistence, no timed-event save). |
| [quest_system.md](quest_system.md) | GVAR-state-driven quest tracking, CE `pipboy.cc` quest display loop, how `quest.ini` maps GVAR thresholds to display text, and DH2 `questLog.ts` implementation. |
| [endgame.md](endgame.md) | Victory slideshow (`endgame.cc`), death-ending weighted selection from `lut/enddeath.json`, "continue playing?" dialog, and DH2 `src/endgame.ts` implementation status. |

---

## Bug & Gap Registry

| File | Summary |
|------|---------|
| [known_bugs.md](known_bugs.md) | Single authoritative registry of all known bugs, missing features, and CE deviation gaps across every DH2 system (28 sections, ~400 entries). Update this file whenever a bug is fixed, a stub is added, or a sprint touches scripting/combat/worldmap. |
