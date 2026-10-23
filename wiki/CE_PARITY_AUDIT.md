# CE Parity Audit — fallout2-ce vs DarkHarold2, function by function

Audited 2026-10-24. Source: `raw/fallout2-ce/src/*.cc` (120 files, ~143k lines) compared against `src/**/*.ts`
(182 files, ~53k lines). No code was changed by this audit.

Each CE source file was assigned to one of 14 subsystem reports in [`wiki/ce_audit/`](ce_audit/). Every report
lists **every function** of its CE files (trivial getters grouped) with the DH2 counterpart, a status, a severity
and notes, followed by detailed findings with CE and DH2 file references and a suggested fix.

Status legend: ✅ MATCH · ⚠️ DIFFERS · ❌ MISSING · 🟡 PARTIAL · 🚫 N/A (platform / SDL / file I/O / debug, or
replaced by a browser equivalent). Severity: **HIGH** = visible gameplay or quest difference, **MED** = noticeable
edge case, **LOW** = cosmetic or rare.

## 1. Results by subsystem

| Report | CE files | ✅ | ⚠️ | ❌ | 🟡 | 🚫 | Rows |
|---|---|---:|---:|---:|---:|---:|---:|
| [combat](ce_audit/combat.md) | combat.cc | 51 | 26 | 11 | 14 | 16 | 118 |
| [combat_ai](ce_audit/combat_ai.md) | combat_ai.cc | 32 | 14 | 0 | 16 | 15 | 77 |
| [stats_skills_perks](ce_audit/stats_skills_perks.md) | critter, stat, skill, perk, trait, reaction, random | 88 | 13 | 3 | 14 | 14 | 132 |
| [items_protos](ce_audit/items_protos.md) | item, proto, proto_instance (+ `tools/fomap.py`) | 64 | 15 | 9 | 29 | 10 | 127 |
| [inventory](ce_audit/inventory.md) | inventory.cc | 13 | 11 | 3 | 15 | 5 | 47 |
| [script_opcodes](ce_audit/script_opcodes.md) | interpreter_extra, interpreter_lib | 137 | 34 | 0 | 11 | 82 | 264 |
| [script_engine](ce_audit/script_engine.md) | scripts, interpreter, queue, export, sfall_* | 78 | 25 | 24 | 21 | 46 | 194 |
| [worldmap](ce_audit/worldmap.md) | worldmap.cc | 77 | 14 | 6 | 7 | 10 | 114 |
| [object_map_tile](ce_audit/object_map_tile.md) | object, map, tile, light, geometry | 45 | 18 | 7 | 19 | 29 | 118 |
| [animation_actions](ce_audit/animation_actions.md) | animation, actions | 37 | 17 | 7 | 18 | 13 | 92 |
| [dialogue_party](ce_audit/dialogue_party.md) | game_dialog, dialog, lips, party_member | 44 | 27 | 4 | 7 | 21 | 103 |
| [game_saveload_menus](ce_audit/game_saveload_menus.md) | game, main, loadsave, config/settings, options, preferences, mainmenu, character_selector, endgame, credits, movies, elevator, automap, skilldex, display_monitor | 58 | 21 | 9 | 14 | 31 | 133 |
| [chareditor_pipboy_hud](ce_audit/chareditor_pipboy_hud.md) | character_editor, pipboy, interface | 60 | 23 | 8 | 11 | 15 | 117 |
| [sound_input_platform](ce_audit/sound_input_platform.md) | game_sound, sound/audio, game_mouse, art, cycle, color/palette, message, text_object, fonts, dbox, input, platform | 51 | 18 | 15 | 10 | 50 | 144 |
| **Total** | 120 files | **835** | **276** | **106** | **206** | **357** | **1780** |

Excluding N/A rows, **59 %** of the CE functions behave the same in DH2, 15 % are partial, and 26 % differ or are
missing. Most of the differing rows are LOW (messages, sounds, keys, UI details); about 30 distinct issues are HIGH.

**Checked by script and identical to CE:** the perk table (119 rows), the critical-hit tables (1080 entries), hex
distance (200k random pairs), screen↔hex picking (all 40 000 hexes), the light shadow switch (20k random
states), the RNG port, opcode numbers / argc / return flags for all 180 game opcodes (VM and Lua backend tables
are identical). The worldmap travel loop, random-encounter roll / pick / formations, the event queue, sfall arrays,
rest and healing, quest / holodisk lists, talking heads and lip sync, colour cycling and floating text are faithful.

## 2. HIGH findings (fix first)

Findings marked ✔ were re-checked against the code by the merging pass.

| # | Area | Finding | IDs |
|---|---|---|---|
| H1 | Pipeline | ✔ **Locked / jammed state, misc-item charges (money on the ground) and key codes are dropped by `tools/fomap.py`** (it skips CE's `data.flags` word after the inventory header). Everything locked in a map file starts unlocked; only `obj_lock` scripts lock. Door state is also not saved or restored. | ITEM-12, OBJ-02 |
| H2 | Pipeline | ✔ **Ladders never change map.** `fomap.py` stores the FO2 ladder `destinationMap` (CE `proto.cc` reads it first) as `unknown1`; `Obj.use` reads `extra.destinationMap`. Stairs: CE changes map only for `> 0`. | ITEM-13, ACT-07 |
| H3 | Skills | ✔ **NPC skills are too low by the skill's `defaultValue`** (Unarmed −30, Melee −20, …): `SkillSet.fromPro` stores raw invested points but `SkillSet.get` treats them as `startValue + invested`. Affects NPC to-hit, steal catch, barter, party best skill. | SKILL-01 |
| H4 | Stats | **No bonus-stat layer.** Drugs, radiation, armour and Gain-SPECIAL perks write base stats, so Max HP changes while on Buffout / in Power Armour and level-ups on Mentats give extra skill points permanently. | STAT-01, TRAIT-03 |
| H5 | Char editor | **Level-up perk effects are lost** (stale skill copy written back on DONE): Educated, Tag! (no tag pick at all), Here and Now. | CHAR-01 |
| H6 | Char editor | **Trait skill modifiers (Gifted, Good Natured) only apply in the creator**, not in play. Conflicts with `perks_traits.md` §1. | CHAR-02 |
| H7 | Scripts | ✔ **`add_obj_to_inven` adds a clone**; the original stays on the map and the script handle is not the inventory item (`Obj.addInventoryItem` → `item.clone()`). NPCs can end up with two copies. | OP-03 |
| H8 | Scripts | ✔ **`obj_is_carrying_obj_pid` counts stacks, not quantity**, and ignores bags and equipped items. Every "have N of X" check is wrong. | OP-02, INV-01, INV-02 |
| H9 | Scripts | **`destroy_object` on a carried item does nothing** (and queued timers survive). | OP-04, ITEM-15 |
| H10 | Scripts | **`critter_dmg` ignores armour and the 0x100 / 0x200 flags**, reads the damage type as a name, prints nothing. | OP-05, ACT-01 |
| H11 | Scripts | **`game_time` and `combat_is_initialized` are per-script snapshots**, stale or `undefined` in many procs. | OP-01, SCR-02 |
| H12 | Party | **Dead companions are never removed from the party**: count against the limit, follow to every map, still returned by `party_member_obj`. Party-count metarule 16 is also off by one (player not counted). | COMBAT-03, CRIT-02, PTY-01, OP-06, PTY-04 |
| H13 | Party | **Companion Custom screen writes wrong values** ("Always!" → sometimes; run-away list shifted, "tourniquet" flees at first damage). | PTY-02 |
| H14 | Dialogue | **Returning from Barter / Trade / Combat Control re-runs `talk_p_proc`**; the node set after `gdialog_mod_barter` is lost (64 scripts) and code after `gsay_end` runs twice. | DLG-01 (extends P6/P10) |
| H15 | Combat | **Primary burst / flame weapons fire one round** (minigun, gatling laser, flamers — 12 protos); flamer spray not ported. | COMBAT-01 |
| H16 | Combat | ✔ **sfall critical-table fixes not applied.** CE defaults `OverrideCriticalTable=2` (`sfall_config.cc:42`), ~90 entry fixes; DH2 has only the static arrays. | COMBAT-02 |
| H17 | Combat | **Unused-AP AC bonus is not CE's model** (CE: everyone starts the round with full AP). Conflicts with known_bugs C22. | COMBAT-04 |
| H18 | Combat | **Free movement in combat for use / pickup / loot / skill**: no AP limit, no 3-AP action cost. | ACT-02, ITEM-17 |
| H19 | Doors | **Open doors still block** shots, light, placement and explosions (no open-door flags set). | OBJ-01 |
| H20 | Items | Natural weapons use the wrong hidden flag (count weight, can be knocked loose / looted). Energy cells can't refuel the car. | ITEM-01, ITEM-07 |
| H21 | Worldmap | Subtile-visited metarule3 105 always returns 1 (Vault City scouting job); state numbers swapped. Entrances never auto-open on map entry. Town map always shown, even for areas without art (blank `undefined.png`). | WM-01, WM-02, WM-03 |
| H22 | Engine | **(VM backend)** non-`VMFatalError` exceptions escape and stop the frame loop; a throwing timed event re-fires every tick. Lua backend is safe. | SCR-01 |
| H23 | Audio | Only map music exists: no worldmap (`23world` / `20car`), main menu (`07desert`) or `wind2` fallback music. | SND-01, WM-07 |

## 3. MED findings by theme

**Map load / script lifecycle:** `map_update_p_proc` runs twice per load and lacks CE's 30 s cadence (MAP-01,
SCR-04); map `start` never runs and proc order differs (SCR-05); script requests run immediately instead of deferred
(SCR-07); scripts keep running after a fatal error (SCR-08); no `obj_dude` script (SCR-09); exit grids ignore
rotation / town-map rule (MAP-02); clock runs during combat (SCR-03); VM null≠0 differs from Lua backend (SCR-06);
36 / 83 sfall opcodes and unknown opcodes misread as dialogue suspension (SCR-12).

**Opcodes:** metarule 13 / 15 / 18 / 19 broken (OP-07, WM-05); `critter_inven_obj` hands (OP-08);
`animate_move_obj_to_tile` flags (OP-09); tile / visibility helpers (OP-10, OBJ-05); `override_map_start` deferred
(OP-11); `move_to` elevation (OP-12); metarule3 100/106 (OP-14); `critter_add_trait` team / packet side effects
(OP-16, AI-02); `obj_open`/`obj_close` (OP-17); `use_obj_on_obj` no engine default (OP-18, ITEM-09); metarule3 104
entrance matching (WM-04).

**Save / load:** preferences not saved with the game (SAVE-01); combat state not saved (SAVE-02, COMBAT-14); queue
events keyed by PID, not object id (SAVE-03, SCR-10).

**Combat & AI:** `script_overrides` at turn start ignored (COMBAT-05); invulnerable critters lose HP (COMBAT-06);
`damage_p_proc` gating (COMBAT-07); miss path (COMBAT-08); whoHitMe not reset (COMBAT-09, COMBAT-11); joining
critters (COMBAT-10); stale turn slots (COMBAT-12); Glovz / YAAM (COMBAT-13, conflicts with C3); double-charge
weapons (COMBAT-16); both arms crippled (COMBAT-17); AI weapon safety / flee (AI-01); dead allies ignored (AI-03);
strongest / weakest inverted (AI-04); hit-mode pick (AI-05); best_weapon no_pref (AI-06); flee source (AI-07);
explosions give no XP / onlooker reaction (ACT-04).

**Stats / traits:** derived-stat clamp order (STAT-02); Fast Metabolism zeroes all resistance (TRAIT-01); Small
Frame (TRAIT-02); script kills run `destroy_p_proc` (CRIT-01); radiation HP over max (RAD-01); `scrname.msg`
(CRIT-03); player EMP DR 100 missing (ITEM-18).

**Inventory / items:** equipped items tradeable / stealable (INV-03, INV-04); looting skips scripts / NO_STEAL /
hidden items (INV-05); knocked-out target steal (INV-06); inventory in combat without AP (INV-07); barter totals
(INV-08); summary panel (INV-09); equip fires pickup (INV-10); Look (INV-11); context menus (INV-12); no bags
(INV-13); armed explosive stays carried / no alert (INV-14, ITEM-06); NPCs wear first carried armour (INV-15);
Solar Scorcher, Motion Sensor, quest-item consumption (ITEM-02, -03, -08); `itemAttemptAdd` (ITEM-19).

**Animation:** `reg_anim` delay semantics (ANIM-01); no point / unpoint (ACT-05); no mid-walk blocker check, AP up
front (ANIM-02); sneak / encumbrance run rules (ANIM-03); pickup script before walking (ACT-06).

**World & map:** town-map hotspots and labels (WM-06); fog on `mark_area_known` (WM-08); entrance elevation −1
(WM-09); runtime lights (OBJ-03); automap seen-area (OBJ-04, AUTO-01); roof row off-by-one (TILE-02); scroll limit
(TILE-03); picking skips `objects[0]` / roofs / corpses (OBJ-06, MOUSE-06).

**Dialogue / party:** `gsay_message` [Done] ends dialogue (DLG-02); empty-option replies (DLG-03); no keyboard in
dialogue (DLG-04); dispositions from `ai.txt` not `party.txt` (PTY-03); control screen readout (PTY-05).

**UI / menus:** character screen not modal, no keys (CHAR-03); CANCEL keeps perk (CHAR-04); creator ignores trait
SPECIAL (CHAR-05); HUD LEVEL light (HUD-01); HUD reload AP (HUD-02); Pip-Boy automaps tab (PIP-01); Options /
Skilldex not modal, hotkey clash (OPT-01); main-menu OPTIONS / LOAD cancel (MENU-01, MENU-02); credits after
endgame (END-01).

**Sound / input:** no distance attenuation (SND-02); weapon sfx naming (SND-05); move-mode click acts on objects,
arrow-mode click opens menu, no Shift run toggle (MOUSE-01, MOUSE-02, PREF-01); hover icon, repeated "You see",
no AP / X on hex cursor (MOUSE-03…05); language filter does nothing (MSG-01, PREF-02).

LOW findings are listed in each report only.

## 4. Conflicts with the wiki / known_bugs (flagged, not resolved)

Per CLAUDE.md these are flagged here; the fixed-entry text in `known_bugs.md` is annotated, not rewritten.

| Doc claim | Audit result | Report |
|---|---|---|
| known_bugs **C22**: unused-AP AC fixed | CE gives every combatant full AP at round start; DH2 uses last round's leftover | combat COMBAT-04 |
| known_bugs **C3**: YAAM matches CE | CE's YAAM never adds damage; DH2 Glovz / YAAM both differ | combat COMBAT-13 |
| known_bugs **RD06**: roof clipping "exactly CE" | flood fill is CE, but hex→roof square uses `(y+1)>>1` (CE `y>>1`) | object_map_tile TILE-02 |
| known_bugs **S20**: `tile_is_visible` correct | CE uses distance from screen centre, not the light map | script_opcodes OP-10 |
| `perks_traits.md` §1: skills read traits live | only the creator passes traits | chareditor CHAR-02 |
| `save_load.md` §9: prefs only in fallout2.cfg | CE saves them in every save (handler 17) | game_saveload SAVE-01 |
| `scripting_vm.md` §4: base opcode numbers | wrong (push_base = 0x802B, add = 0x8039) | script_engine SCR-14 |
| `lighting.md` §6: non-wall rotations 2..4 | CE and DH2 use 1..3 | object_map_tile |
| `scroll_clamping.md`: scroll limited | CE's ~480×400 px limit is missing | object_map_tile TILE-03 |
| `companion_party.md`: party count = CE | off by one | script_opcodes OP-06 |
| `companion_party.md` §8.4: packet numbers don't fit | they do (`packet_num` = base − disposition) | dialogue_party |
| README "Known approximations": action menu on right-click | code opens it on any command-mode left click | sound_input MOUSE-02 |

## 5. Suggested fix order

1. **Pipeline (needs an asset task):** H1, H2 in `tools/fomap.py` — read `data.flags`, door `openFlags`, misc
   charges, key codes, ladder `destinationMap`; maps must be re-exported.
2. **Script correctness (quests):** H7–H11, H12 party count / dead members, OP-07, DLG-01/02, SCR-05, MAP-01.
3. **Character rules:** H3–H6, TRAIT-01/02, STAT-02.
4. **Combat:** H15–H18, COMBAT-05…10, AI-01…07, ACT-04.
5. **World / doors:** H19, H21, OBJ-03, TILE-02.
6. **Save / load:** SAVE-01…03.
7. **Robustness:** H22 (VM backend; Lua default is safe).
8. UI, input, sound polish (MED / LOW).

Unverified items (need a playtest or the user's `data/scripts`) are marked "unverified" in each report.
