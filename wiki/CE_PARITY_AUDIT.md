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
| H1 | Pipeline | **FIXED 2026-10-24 (known_bugs PA1).** ✔ **Locked / jammed state, misc-item charges (money on the ground) and key codes are dropped by `tools/fomap.py`** (it skips CE's `data.flags` word after the inventory header). Everything locked in a map file would start unlocked — the 2026-10-24 re-export found no vanilla map object with a lock flag, so this affects mods only; only `obj_lock` scripts lock. Door state is also not saved or restored. | ITEM-12, OBJ-02 |
| H2 | Pipeline | **FIXED 2026-10-24 (known_bugs PA2).** ✔ **Ladders never change map.** `fomap.py` stores the FO2 ladder `destinationMap` (CE `proto.cc` reads it first) as `unknown1`; `Obj.use` reads `extra.destinationMap`. Stairs: CE changes map only for `> 0`. | ITEM-13, ACT-07 |
| H3 | Skills | **FIXED 2026-10-24 (known_bugs PA3).** ✔ **NPC skills are too low by the skill's `defaultValue`** (Unarmed −30, Melee −20, …): `SkillSet.fromPro` stores raw invested points but `SkillSet.get` treats them as `startValue + invested`. Affects NPC to-hit, steal catch, barter, party best skill. | SKILL-01 |
| H4 | Stats | **FIXED 2026-10-24 (known_bugs PA4).** **No bonus-stat layer.** Drugs, radiation, armour and Gain-SPECIAL perks write base stats, so Max HP changes while on Buffout / in Power Armour and level-ups on Mentats give extra skill points permanently. | STAT-01, TRAIT-03 |
| H5 | Char editor | **FIXED 2026-10-24 (known_bugs PA5).** **Level-up perk effects are lost** (stale skill copy written back on DONE): Educated, Tag! (no tag pick at all), Here and Now. | CHAR-01 |
| H6 | Char editor | **FIXED 2026-10-24 (known_bugs PA6).** **Trait skill modifiers (Gifted, Good Natured) only apply in the creator**, not in play. Conflicts with `perks_traits.md` §1. | CHAR-02 |
| H7 | Scripts | **FIXED 2026-10-24 (known_bugs PA7).** ✔ **`add_obj_to_inven` adds a clone**; the original stays on the map and the script handle is not the inventory item (`Obj.addInventoryItem` → `item.clone()`). NPCs can end up with two copies. | OP-03 |
| H8 | Scripts | **FIXED 2026-10-24 (known_bugs PA8).** ✔ **`obj_is_carrying_obj_pid` counts stacks, not quantity**, and ignores bags and equipped items. Every "have N of X" check is wrong. | OP-02, INV-01, INV-02 |
| H9 | Scripts | **FIXED 2026-10-24 (known_bugs PA9).** **`destroy_object` on a carried item does nothing** (and queued timers survive). | OP-04, ITEM-15 |
| H10 | Scripts | **FIXED 2026-10-24 (known_bugs PA10).** **`critter_dmg` ignores armour and the 0x100 / 0x200 flags**, reads the damage type as a name, prints nothing. | OP-05, ACT-01 |
| H11 | Scripts | **FIXED 2026-10-24 (known_bugs PA11).** **`game_time` and `combat_is_initialized` are per-script snapshots**, stale or `undefined` in many procs. | OP-01, SCR-02 |
| H12 | Party | **FIXED 2026-10-24 (known_bugs PA12).** **Dead companions are never removed from the party**: count against the limit, follow to every map, still returned by `party_member_obj`. Party-count metarule 16 is also off by one (player not counted). | COMBAT-03, CRIT-02, PTY-01, OP-06, PTY-04 |
| H13 | Party | **FIXED 2026-10-24 (known_bugs PA13).** **Companion Custom screen writes wrong values** ("Always!" → sometimes; run-away list shifted, "tourniquet" flees at first damage). | PTY-02 |
| H14 | Dialogue | **FIXED 2026-10-24 (known_bugs PA14).** **Returning from Barter / Trade / Combat Control re-runs `talk_p_proc`**; the node set after `gdialog_mod_barter` is lost (64 scripts) and code after `gsay_end` runs twice. | DLG-01 (extends P6/P10) |
| H15 | Combat | **FIXED 2026-10-24 (known_bugs PA15).** **Primary burst / flame weapons fire one round** (minigun, gatling laser, flamers — 12 protos); flamer spray not ported. | COMBAT-01 |
| H16 | Combat | **FIXED 2026-10-24 (known_bugs PA16).** ✔ **sfall critical-table fixes not applied.** CE defaults `OverrideCriticalTable=2` (`sfall_config.cc:42`), ~90 entry fixes; DH2 has only the static arrays. | COMBAT-02 |
| H17 | Combat | **FIXED 2026-10-24 (known_bugs PA17).** **Unused-AP AC bonus is not CE's model** (CE: everyone starts the round with full AP). Conflicts with known_bugs C22. | COMBAT-04 |
| H18 | Combat | **FIXED 2026-10-24 (known_bugs PA18).** **Free movement in combat for use / pickup / loot / skill**: no AP limit, no 3-AP action cost. | ACT-02, ITEM-17 |
| H19 | Doors | **FIXED 2026-10-24 (known_bugs PA19).** **Open doors still block** shots, light, placement and explosions (no open-door flags set). | OBJ-01 |
| H20 | Items | **FIXED 2026-10-24 (known_bugs PA20).** Natural weapons use the wrong hidden flag (count weight, can be knocked loose / looted). Energy cells can't refuel the car. | ITEM-01, ITEM-07 |
| H21 | Worldmap | **FIXED 2026-10-24 (known_bugs PA21).** Subtile-visited metarule3 105 always returns 1 (Vault City scouting job); state numbers swapped. Entrances never auto-open on map entry. Town map always shown, even for areas without art (blank `undefined.png`). | WM-01, WM-02, WM-03 |
| H22 | Engine | **FIXED 2026-10-24 (known_bugs PA22).** **(VM backend)** non-`VMFatalError` exceptions escape and stop the frame loop; a throwing timed event re-fires every tick. Lua backend is safe. | SCR-01 |
| H23 | Audio | **FIXED 2026-10-24 (known_bugs PA23).** Only map music exists: no worldmap (`23world` / `20car`), main menu (`07desert`) or `wind2` fallback music. | SND-01, WM-07 |

**All 23 HIGH groups were fixed on 2026-10-24** (known_bugs §33). The MED / LOW findings below are open unless a report says otherwise.

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
(TILE-03 — ported on branch `ce-audit-results`, commits 8c260689 / 2e033fca); picking skips `objects[0]` / roofs / corpses (OBJ-06, MOUSE-06).

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

### MED findings fixed (2026-10-25, branch `small-autits`)

| Batch | IDs | What changed |
|---|---|---|
| Map load / script lifecycle | MAP-01, SCR-04 | one `map_update_p_proc` per map load; map updates also run in combat and every 30 s of real time (CE `_script_chk_timed_events`) |
| | SCR-03 | the clock no longer advances in combat (combat time = 5 s per round, as CE) |
| | SCR-05 (part) | map script and spatial scripts get `start` after the map script's `map_enter_p_proc`; `fixed_param` = first visit for the map script and every object's `map_enter_p_proc`. Object `start` still runs at script load (before the map script's `map_enter_p_proc`). |
| | SCR-08 | a script that hits a fatal error runs no further procs (both backends), as CE's PROGRAM_FLAG_EXITED |
| Dialogue | DLG-02, DLG-03 | CE's pending-reply model: `gsay_end` runs the dialogue only while a reply is pending and adds CE's implicit option (proto.msg 655 / empty) when the reply has none; a `gsay_message` [Done] returns into its procedure with the dialogue open, which closes only if no options follow |
| Save / load | SAVE-01 | preferences saved with the game and applied on load |
| | SAVE-02, COMBAT-14 | a save made in combat resumes the fight (order, turn, round, XP, player AP) |
| | SAVE-03, SCR-10 (part) | timed events keyed by object uid (uids stay unique after a load); knockout events rebuilt; flare / explosive events no longer become fake script calls |
| Script opcodes | OP-07, WM-05 | metarule 13 returns to the main menu after the script; 15 requests the elevator from the stub around the script's object (no throw); 18 checks the critter passed in for drug events; 19 reads the map's entrance state |
| | OP-08 | `critter_inven_obj`: the dude's hand slot counts only while it is the active hand |
| | OP-09 | `animate_move_obj_to_tile`: 0x10 clears the current animation; nothing in combat or for an inactive critter |
| | OP-10, OBJ-05 | `tile_is_visible` (CE centre-tile test), `tile_in_tile_rect` (inclusive, ul / lr), `tile_contains_obj_pid` (any elevation), `obj_can_see_obj` (elevation, perception, first obstacle of the straight path), `tile_distance_objs` (9999 across elevations) |
| | OP-11, OP-12 | `override_map_start` moves the player at once outside map_enter; `move_to` uses the object's own elevation, moves it between elevation lists, takes a critter out of combat, returns the tile |
| | OP-14 | metarule3 100 clears every matching script timer; 104 returns 0 / −1; 106 walks the critters after `previous`, dude included |
| | OP-16, AI-02 | `critter_add_trait` AI packet rebuilds the cached packet; TEAM skips party members / unchanged teams and clears who-hit-me and the last target |
| | OP-17 | `obj_open` / `obj_close` toggle without the use animation, loot window or lock message (a locked object stays, as CE) |
| | OP-18 | `use_obj_on_obj` by a critter runs the engine's default use (drugs, healing) after the scripts |
| Combat | COMBAT-05 | `script_overrides` in a turn-start `combat_p_proc` takes the turn over |
| | COMBAT-06 | invulnerable critters (CRITTER_INVULNERABLE) take no damage |
| | COMBAT-07 | `damage_p_proc` skipped where CE's `_damage_object` a4 says so (self-hit from a critical failure, accidental victim, bystanders of a normal attack) and between party members |
| | COMBAT-08 | a miss still makes the intended target consider retaliating and notifies onlookers |
| | COMBAT-09, COMBAT-11 | who-hit-me cleared at combat start and end; the player's attack records the player's who-hit-me and every attacker's last target |
| | COMBAT-12 | a destroyed critter, or one moved to another elevation, leaves the turn order |
| | COMBAT-16, COMBAT-17 | Super Cattle Prod / Mega Power Fist use 2 charges a hit; punches and kicks work with both arms crippled |
| AI | AI-01 | the held weapon gets CE's team-safety check (switching weapons if unsafe), the attacker steps out of its own blast, a failed approach makes it flee |
| | AI-03, AI-04 | a dead team-mate's killer is a target; "strongest" / "weakest" sorted as CE (the vanilla inversion) |
| | AI-05, AI-06 | the secondary attack checks its own attack type against the preference, a throw needs a fall-back weapon or a failed INT roll; only an unset `best_weapon` lets average damage override the order |
| | AI-07 | a hurt critter flees from CE's `a2` (the attack_complex defender, else the player) |
| Actions | ACT-04 | explosions give the player the XP of new kills, survivors remember the bomber and start a fight (CE `_report_explosion`), victims die exploded to nothing |
| Stats / critters | STAT-02, RAD-01 | Melee Damage and Healing Rate have CE's minimum of 1 before perk / trait deltas; radiation HP changes go through current HP (capped at max), not a bonus |
| | TRAIT-01, TRAIT-02 | Fast Metabolism zeroes only the base Radiation / Poison resistance (Rad-X etc. still count); Small Frame uses base STR without Bruiser / Gifted |
| | CRIT-01 | `kill_critter`, `kill_critter_type`, `critter_heal`, poison and radiation deaths no longer run `destroy_p_proc` (an NPC's chem death still does, as CE `_combatKillCritterOutsideCombat`) |
| | CRIT-03 | critters take their scrname.msg name (101 + script index) over the proto name |
| Items | ITEM-18 | the dude has DR EMP 100 |
| Inventory | INV-03, INV-04 | the barterer's worn armor and right-hand item (a vendor's first weapon if the hand is empty) stay out of barter / companion trade; hand items and worn armor are not in the steal view; hand references relinked after a deal |
| | INV-05, INV-06 | looting: CRITTER_NO_STEAL → inventry.msg 50, the target's pickup_p_proc runs and can override; a knocked-out target opens the loot window, not stealing |
| | INV-07, INV-10 | inventory in combat without enough AP → inventry.msg 19, no window; equipping runs no pickup_p_proc; the armor slot takes only armor from any source |
| | INV-15 | NPCs get armor stats only from the OBJECT_WORN item (no carried-armor fallback) |
| Items | ITEM-02, ITEM-03 | the Solar Scorcher recharges in daylight (item.msg 500 otherwise); the Motion Sensor uses a charge and opens the automap in scanner mode (critters shown only then; the SCANNER button needs a sensor in hand, misc.msg 17 / 18) |
| | ITEM-06 | an armed explosive is put down at the user's feet; non-team critters nearby that pass a PE roll suspect the player and start a fight |
| | INV-14, ITEM-19 | an armed explosive dropped from the inventory runs the same watcher check when it closes; non-biped critters without CRITTER_BARTER take no items |
| World | WM-06, WM-08 | town-map entrances at −1/−1 are not shown, labels are worldmap.msg 200 + 10 × area + index; a known area marked visited clears the fog around it (state 1 makes its subtile known) |
| | OBJ-03 | objects created at runtime take their proto's light (and relight the map) |
| | OBJ-04 | the automap marks CE's seen band (32 rows × 40 tiles around the dude's 8-tile block) |
| | OBJ-06, MOUSE-06 (part) | object picking: the bottom object can be picked, hidden objects are skipped, a wall's egg-transparent part and dead / knocked-out critters lose to what lies under them (falling back to them). Still open: no pick through a visible roof |
| | TILE-02 | hex → roof square is CE's `(x >> 1, y >> 1)` (odd hex rows were one square south) |
| UI | CHAR-03, OPT-01 | the character screen, Options and the Skilldex are modal (the map pauses, game keys don't reach it); character screen keys Return / D done, Esc / C cancel |
| | CHAR-04, HUD-01 | CANCEL on the character screen restores perks, traits, the free perk, SPECIAL / HP and skills; the LEVEL light follows CE's level-up flag (on at a level-up, off when the screen opens; saved) |
| | HUD-02 | the HUD reload spends AP only when something loaded, plays the weapon's ready sound, prints nothing when short of AP |
| | MENU-01, MENU-02 | main-menu OPTIONS opens Preferences over the menu; cancelling its LOAD GAME returns to the menu |
| | END-01 | the endgame slideshow goes on to akiss, the credits and the continue dialog |
| | CHAR-05 | the creation screen's derived stats and skills include the traits (SPECIAL bonus and trait effects); "+" stops at base + trait bonus = 10 |
| Party | PTY-03 | party.txt's disposition and Custom-value lists are read: dispositions it doesn't list are disabled, Custom values it doesn't list are greyed and refused |
| | PTY-05 | the control screen shows CE's eight fields at CE's positions: right-hand item and worn armor (proto.msg 10 for none), the standing SW sprite, HP, best skill, weight (red when encumbered), melee damage, AP |
| | DLG-04 (part) | dialogue keys 1–9 pick an option, B barters. Still open: page keys, control / customise screen keys |
| Input | MOUSE-03, MOUSE-04 | the arrow cursor shows the pointed object's primary-action icon after 250 ms (use / talk / look / rotate; nothing over empty ground); "You see" only when the pointed object changes |
| | MOUSE-05 | the hex cursor shows the move's AP cost in combat (white) or a red X (too far / no path) after 250 ms |
| Sound | SND-02 | sounds of items, critters and scenery (weapon fire and hits, character and door sounds, explosions) play at full volume on screen; off screen full up to PE hexes, falling to ⅓ at 2 × PE (`src/soundVolume.ts`) |
| | SND-05 | combat attack / hit sounds use CE's `sfxBuildWeaponName` (variant 2 for burst / secondary modes, the target's material, X for plasma / EMP / explosion); a missing file is silent (no invented fallbacks) |
| | MSG-01 | the language filter masks the badwords.txt words in script dialogue and AI combat lines (`src/badwords.ts`, CE's rule including its start-of-message quirk) |

Still open from these groups: COMBAT-10 (joining critters' immediate turn), COMBAT-13 (Glovz / YAAM opt-in formulas), ACT-05 (point / unpoint animations), MOUSE-06 roof test. MOUSE-01 / MOUSE-02 are the documented action-menu approximation (CLAUDE.md, README).

## 4. Conflicts with the wiki / known_bugs (flagged, not resolved)

Per CLAUDE.md these are flagged here; the fixed-entry text in `known_bugs.md` is annotated, not rewritten.

| Doc claim | Audit result | Report |
|---|---|---|
| known_bugs **C22**: unused-AP AC fixed | CE gives every combatant full AP at round start; DH2 used last round's leftover — fixed 2026-10-24 (PA17) | combat COMBAT-04 |
| known_bugs **C3**: YAAM matches CE | CE's YAAM never adds damage; DH2 Glovz / YAAM both differ | combat COMBAT-13 |
| known_bugs **RD06**: roof clipping "exactly CE" | flood fill is CE, but hex→roof square uses `(y+1)>>1` (CE `y>>1`) | object_map_tile TILE-02 |
| known_bugs **S20**: `tile_is_visible` correct | CE uses distance from screen centre, not the light map | script_opcodes OP-10 |
| `perks_traits.md` §1: skills read traits live | only the creator passed traits — fixed 2026-10-24 (PA6) | chareditor CHAR-02 |
| `save_load.md` §9: prefs only in fallout2.cfg | CE saves them in every save (handler 17) | game_saveload SAVE-01 |
| `scripting_vm.md` §4: base opcode numbers | wrong (push_base = 0x802B, add = 0x8039) | script_engine SCR-14 |
| `lighting.md` §6: non-wall rotations 2..4 | CE and DH2 use 1..3 | object_map_tile |
| `scroll_clamping.md`: scroll limited | CE's ~480×400 px limit was missing — ported since (`ce-audit-results`, 8c260689 / 2e033fca) | object_map_tile TILE-03 |
| `companion_party.md`: party count = CE | off by one | script_opcodes OP-06 |
| `companion_party.md` §8.4: packet numbers don't fit | they do (`packet_num` = base − disposition) | dialogue_party |
| README "Known approximations": action menu on right-click | code opens it on any command-mode left click | sound_input MOUSE-02 |

## 5. Suggested fix order

1. **Pipeline:** H1, H2 in `tools/fomap.py` — done 2026-10-24 (maps re-exported).
2. **Script correctness (quests):** H7–H11, H12 party count / dead members, OP-07, DLG-01/02, SCR-05, MAP-01.
3. **Character rules:** H3–H6, TRAIT-01/02, STAT-02.
4. **Combat:** H15–H18, COMBAT-05…10, AI-01…07, ACT-04.
5. **World / doors:** H19, H21, OBJ-03, TILE-02.
6. **Save / load:** SAVE-01…03.
7. **Robustness:** H22 (VM backend; Lua default is safe).
8. UI, input, sound polish (MED / LOW).

Unverified items (need a playtest or the user's `data/scripts`) are marked "unverified" in each report.
