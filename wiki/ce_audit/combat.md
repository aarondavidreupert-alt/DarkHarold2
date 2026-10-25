# CE parity audit — combat (combat.cc)

Scope: CE files `raw/fallout2-ce/src/combat.cc` (every function), `combat.h` (inline `isInCombat`, `isUnarmedHitMode`), `combat_defs.h` (enums/structs only); DH2 files `src/combat/Combat.ts`, `src/combat/{hitChance,damage,results,actionPoints,lineOfFire,explosion,whoHitMe}.ts`, `src/criticalEffects/*`, `src/critter/Weapon.ts`, `src/critter/lifecycle.ts`, `src/unarmed.ts`, `src/ui_calledshot.ts`, `src/playerUse.ts`, `src/weaponAmmo.ts`, `src/scripting.ts` (combatEvent). Audited 2026-10-24.

Method: each CE function read next to its DH2 counterpart. The critical-hit tables (`src/criticalEffects/ceTables.ts`) were checked by a script against CE's static `gCriticalHitTables` + `gPlayerCriticalHitTable`: all 1080 entries match. `_cf_table`, `hit_location_penalty_default` and the 14 `gUnarmedHitDescriptions` entries were checked by hand and also match. Proto facts quoted below (which weapons burst, which critters have flags) come from the local `proto/pro.json`.

## Summary

| Status | Count |
|---|---|
| ✅ MATCH | 51 |
| ⚠️ DIFFERS | 26 |
| ❌ MISSING | 11 |
| 🟡 PARTIAL | 14 |
| 🚫 N/A | 16 |
| **Total rows** | **118** (113 combat.cc functions, 2 combat.h inlines, 3 static tables) |

Top findings, most severe first:

1. **COMBAT-01 (HIGH, NEW)** — Weapons whose **primary** attack is burst (mode 7) or flame (mode 8) fire a single round. That covers miniguns 12/350/355/387/389/395/518/520, the gatling laser 28 and flamers 11/400/427. DH2 only bursts in the `'burst'` mode, and that mode only exists for a secondary 7/8. CE picks `_compute_spray` from the hit mode's animation. The `ANIM_FIRE_CONTINUOUS` (flamer) branch of `_compute_spray` / `_shoot_along_path` isn't ported at all.
2. **COMBAT-02 (HIGH, NEW)** — CE's default `OverrideCriticalTable=2` (`criticalsInit`) applies about 90 sfall fixes to the critical tables. Examples: human uncalled effect 2 becomes knockdown + bypass, deathclaw left-leg cripples, child legs, gecko / alien / ant uncalled, Frank Horrigan's messages and multipliers. DH2's tables are CE's unpatched static arrays.
3. **COMBAT-03 (HIGH, NEW)** — When a party member dies, CE `_damage_object` calls `partyMemberRemove`. DH2 never removes a dead member from `gParty.party`, so `METARULE_PARTY_COUNT` (party-size limits on recruiting), map transitions and the party lists still include the corpse.
4. **COMBAT-04 (HIGH, conflicts with known_bugs C22)** — The unused-AP Armor Class bonus doesn't follow CE (`stat.cc` STAT_ARMOR_CLASS adds the critter's *current* `combat.ap` whenever it isn't that critter's turn):
   - CE sets every combatant to full AP at round start (`_combat_set_move_all`), so a critter that hasn't acted yet has its full AP as AC. In DH2 it has only last round's leftover, and 0 in round 1.
   - Non-combatants get full AP as AC in DH2; in CE they have 0.
   - The bonus stays on critters after combat ends.
5. **COMBAT-05 (MED, NEW)** — `script_overrides` in `combat_p_proc` (fixed_param 4, turn start) is ignored (`Scripting.combatEvent` has a `TODO: script_overrides`). CE skips the critter's whole AI turn (and the standup) when the script overrides.
6. **COMBAT-07 / 08 (MED, NEW)** — `_apply_damage` / `_damage_object` side effects differ:
   - `damage_p_proc` always runs in DH2. CE skips it for party-on-party hits, for accidental victims, for blast/burst extras of a normal attack, and for a critical-failure self-hit.
   - On a miss, CE still runs `_set_new_results` and `_combatai_check_retaliation` for the intended target, plus `_combatai_notify_onlookers(oops)` for an accidental hit. DH2 skips the defender block whenever DAM_HIT is clear.
7. **COMBAT-09 / 10 / 11 (MED, NEW)** — Combat bookkeeping:
   - `whoHitMe` is never cleared at `_combat_begin` / `_combat_over`.
   - A critter that joins at round end gets no immediate turn (CE's `_combat_add_noncoms` runs `_combat_turn` right away).
   - Party members act without joining.
   - The player's attack doesn't set `dude.whoHitMe = defender`, which the party AI uses to pick its target.
8. **COMBAT-06 (MED, NEW)** — `CRITTER_INVULNERABLE` critters (proto 481) still lose HP; CE `_damage_object` returns early.
9. **COMBAT-12 / 14 (MED, NEW)** — No `_combat_delete_critter`, so critters a script destroys or moves stay in the turn order. Combat state isn't saved (`combatSave` / `combatLoad`), so a save made in combat loads out of combat.
10. **COMBAT-13 (MED, opt-in, conflicts with known_bugs C3)** — The Glovz and Glovz-tweak formulas in `damage.ts` are not CE's `damageModCalculateGlovz`. YAAM is fed a DR that already includes the ammo modifier. CE's own YAAM is broken (`context->damagePtr += damage` never adds damage), so known_bugs C3's "matches CE" is wrong either way.

## Function table

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| `isInCombat` (combat.h) | `globalState.inCombat` / `isCombatActive()` Combat.ts:73 | ✅ | | |
| `isUnarmedHitMode` (combat.h) | `getHitChance` isUnarmed hitChance.ts:146; `weaponObj === null` checks | ✅ | | Brass knuckles / power fist take the weapon branch, as in CE. |
| `combatInit` | — | 🚫 | | Loads combat.msg (DH2 `getMessage('combat')`) and calls the sfall inits, which are audited in their own rows. |
| `combatReset` | — | 🚫 | | DH2 has no mutable crit / penalty tables to reset. |
| `combatExit` | — | 🚫 | | Frees memory. |
| `_find_cid` | — | 🚫 | | Save/load helper. |
| `combatLoad` | saveload.ts:333 (ends combat on load) | ❌ | MED | COMBAT-14: combat state isn't restored. |
| `combatSave` | — | ❌ | MED | COMBAT-14: DH2 allows saving in combat (hotkeys.ts:177/201/203) but writes no combat state. |
| `_combat_safety_invalidate_weapon` | `combatSafetyInvalidateWeapon` Combat.ts:1416 | ⚠️ | LOW | No `PROTO_ID_0x10001E0` exemption. `safeDistance` is a boolean (no distance computed). Distances are plain hex, not multihex-aware. Primary-burst weapons are never simulated (COMBAT-01). |
| `_combat_safety_invalidate_weapon_func` | same, Combat.ts:1416 | ⚠️ | LOW | CE literal DR×(max−DT) test and the INT<5 radius cut are ported. The `attackerFriend` parameter isn't (see next row). |
| `_combatTestIncidentalHit` | `attackWouldIntersect` Combat.ts:2654 | 🟡 | LOW | CE checks the given friend (any team) against the blast radius and the spray extras. DH2 checks only the first obstacle, then the team-only test. |
| `_combat_whose_turn` | `whoseTurn` / `inPlayerTurn` Combat.ts:353 | ✅ | | |
| `_combat_data_init` | — | 🚫 | | Proto instance init (damageLastTurn / results = 0); DH2 defaults the fields. |
| `_combatInitAIInfoList` | fields on critters (`aiFriendlyDead`, `aiLastTarget`, `aiLastItem`) | 🟡 | LOW | Not reset at combat begin (only `aiFriendlyDead` / `aiLastItem` at combatOver, Combat.ts:2897). `aiLastTarget` is never cleared. |
| `aiInfoCopy` | — | 🚫 | | Array compaction. |
| `aiInfoGetFriendlyDead` | `(c as any).aiFriendlyDead` | ✅ | | |
| `aiInfoSetFriendlyDead` | `notifyOnlookers` Combat.ts:1999 | ✅ | | |
| `aiInfoGetLastTarget` | `aiLastTarget` Combat.ts:1922 | ✅ | | |
| `aiInfoSetLastTarget` | Combat.ts:2167 (AI attempt start only) | ⚠️ | LOW | CE sets it in every `_combat_attack`, the player's attacks included, and stores null for a dead target. DH2 sets it at the AI's first attempt only. |
| `aiInfoGetLastItem` | `aiLastItem` Combat.ts:2440 | ✅ | | |
| `aiInfoSetLastItem` | Combat.ts:2543 | ⚠️ | LOW | CE bug: always stores nullptr, and the caller passes the item as the critter. So in CE lastItem is never set; DH2 stores the item and retries it. |
| `_combatAIInfoSetLastMove` | — | ❌ | LOW | lastMove isn't modelled (it's read by combat_ai). |
| `_combat_begin` | `Combat` ctor Combat.ts:359, `start` Combat.ts:2797 | 🟡 | MED | Missing: `whoHitMe = null` for every critter (COMBAT-09); `maneuver &= ENGAGING` (stale DISENGAGING / FLEEING from `critter_stop_attacking` survives); `ap = 0` (COMBAT-04); the PROTO_ID_0x1000098 robot's fid 99→100 transform anim. `_caiTeamCombatInit` matches (teamCombat). |
| `_combat_begin_extra` | `refreshHighlights` Combat.ts:3112 | ✅ | | Outline refresh + `attackInit`; `_combat_ai_begin` is combat_ai scope. |
| `_combat_update_critters_in_los` | `refreshHighlights` | 🟡 | LOW | See next row. |
| `_combat_update_critter_outline_for_los` | `refreshHighlights` Combat.ts:3112 | ⚠️ | LOW | CE: red/green by team (not by "hostile") for critters in line of fire; a different outline type for unseen critters within PER×5 (half through glass). DH2: red only if `hostile`, else green or blue, no line-of-fire test. Blue for neutrals is a documented DH2 addition (CI11). |
| `_combat_over` | `finish` Combat.ts:2865, `combatOver` Combat.ts:2892 | 🟡 | MED | Missing `whoHitMe = null` (COMBAT-09) and `ap = 0` (bonus AC stays, COMBAT-04). AI reload runs for all map critters, not just `_list_com` (LOW). Robot fid 100→99 anim missing. XP, prone-dude wake-up and maneuver reset match. |
| `_combat_over_from_load` | saveload.ts:337 `forceEnd` | ✅ | | |
| `_combat_give_exps` | `giveExps` Combat.ts:1716 | ✅ | | proto.msg 621 + 622–625 / 626 (35 % at full HP), actual XP gained. |
| `_combat_add_noncoms` | `combatSequence` Combat.ts:2016 | ⚠️ | MED | COMBAT-10: CE gives a joiner max AP and an immediate `_combat_turn`; DH2 only flags it hostile. |
| `_compare_faster` | `sortBySequence` Combat.ts:2041 | ✅ | | Sequence, then Luck. |
| `_combat_sequence_init` | `sequenceInit` Combat.ts:2048 | ⚠️ | LOW | Order and whoHitMe as CE. In CE only the placed critters are `_list_com`; in DH2 every critter is in the list and same-team critters act at once (COMBAT-10). CE sets whoHitMe when either one is non-null; DH2 needs both. |
| `_combat_sequence` | `combatSequence` Combat.ts:2016 | ✅ | | Dead / KO / disengaging leave, sort, +5 s. |
| `combatAttemptEnd` | `attemptEnd` Combat.ts:2087 | ⚠️ | LOW | CE runs the hostiles check only when `_combat_elev == dude elevation`; DH2 always does. `_caiTeamCombatExit` not called. |
| `_combat_turn_run` | animation callbacks | 🚫 | | Busy-wait loop; DH2 is callback-driven. |
| `_combat_input` | hotkeys.ts (Space / Return), Combat.ts | ✅ | | Ends when AP and free move run out, Space, Return. |
| `_combat_set_move_all` | `ActionPoints.resetAP` at turn start (Combat.ts:3020 / 3060) | ⚠️ | HIGH | COMBAT-04: CE resets every combatant's AP at round start; DH2 resets at each critter's own turn, which changes the AP-as-AC bonus. `_gcsd->actionPointsBonus` is always 0 in CE callers (N/A). |
| `_combat_turn` | `nextTurn` Combat.ts:2970, `turnSkipped` 3073, `doAITurn` 1827 | ⚠️ | MED | COMBAT-05: `script_overrides` from combat_p_proc(4) ignored. Other gaps: the proc runs after the standup (CE: before); source/target aren't cleared for it (CE `scriptSetObjects(sid, null, null)`); the player's first turn doesn't auto-attack `_gcsd->defender` (`_combat_attack_this`). Skips, LOSE_TURN clear, standup, Bonus Move pool and AC→AP as CE. |
| `_combat_should_end` | `shouldEnd` Combat.ts:2072 | ✅ | | |
| `_combat` | `start` Combat.ts:2797 + `nextTurn` loop | 🟡 | MED | Loop structure matches. `_gcsd` covers every attack of the first turn in CE; DH2 uses it for one attack (COMBAT-15). The `_combat_ending_guy` break is dead code in CE too (see `_combat_player_knocked_out_by`). |
| `attackInit` | `attackInit` Combat.ts:188 | ✅ | | `tile` starts null (CE: defender tile); `computeExplosionOnExtras` falls back to it. |
| `_combat_attack` | `attack` Combat.ts:780 | ⚠️ | MED | NPC 1-in-4 kick, gcsd damage clamps and override match. Differences: <br>- COMBAT-11: the player's `whoHitMe = defender` isn't set.<br>- `aiInfoSetLastTarget` isn't called.<br>- DH2-only: any attack flips a non-team target to `hostile` at once.<br>- COMBAT-17: DH2 refuses every attack with both arms crippled; CE allows punch / kick.<br>AP is paid by the callers (equivalent). |
| `_combat_bullet_start` | `flyProjectile` Combat.ts:1613 | ✅ | | |
| `_check_ranged_miss` | `checkRangedMiss` Combat.ts:1489 | ⚠️ | LOW | The never-hits quirk is ported. CE resets `defenderHitLocation = TORSO` and runs only on ROLL_FAILURE. DH2 keeps the called location (an accidental victim is reported "hit in the eyes") and also rolls on a flag-less critical failure (extra RNG). |
| `_shoot_along_path` | `shootAlongPath` Combat.ts:1460 | 🟡 | MED | Burst path matches. The ANIM_FIRE_CONTINUOUS branch (1 round per critter, main-target path hits zeroed) is missing (COMBAT-01). |
| `_compute_spray` | `computeSpray` Combat.ts:1163 | 🟡 | HIGH | Burst split, main rolls, +20 on a critical and the final roll fix-up match. Missing: continuous mode (1/1/1/1 rounds); use for primary-burst weapons (COMBAT-01); gcsd accuracy bonus. `centerTile` uses hexDistance (CE `objectGetDistanceBetween`, multihex). sfall burst mod not configurable (off by default). |
| `attackComputeEnhancedKnockout` | `computeEnhancedKnockout` Combat.ts:547 | ✅ | | |
| `attackCompute` | `attackCompute` Combat.ts:437 | ⚠️ | HIGH | Sequence otherwise matches (Jinxed, Slayer, Silent Death ×4 / ×2 on a critical, unarmed bonus crit, Sniper, ranged-miss tail, grenade scatter, explosion dispatch, death flags). Differences:<br>- COMBAT-01: burst comes from `isBurst()` (mode name), not the hit-mode animation.<br>- gcsd accuracy is added after the 95 cap (COMBAT-15).<br>- `_item_w_compute_ammo_cost` is missing (COMBAT-16).<br>- No range check (callers do it).<br>- `damageType` is "Normal" for natural attacks (CE `critterGetDamageType`: protos 76, 246, 247). |
| `_compute_explosion_on_extras` | `computeExplosionOnExtras` Combat.ts:732 + `explosionRingCritters` explosion.ts:35 | ✅ | | Ring walk, radii 2/3, backwash and the shot-blocked test match. sfall's explosion radius / max-targets settings are constants. `noDamage` (AI simulation callers) isn't needed by DH2's own simulation. Duplicates can use up a victim slot (LOW). |
| `attackComputeCriticalHit` | `computeCriticalHit` Combat.ts:562 | ⚠️ | HIGH | Logic matches; the table data lacks sfall's mode-2 fixes (COMBAT-02). |
| `_attackFindInvalidFlags` | `attackFindInvalidFlags` results.ts:85 | ✅ | | |
| `attackComputeCriticalFailure` | `computeCriticalFailure` Combat.ts:587 | ✅ | | Day-6 limit, Luck formula, `_cf_table` and all flag branches. `_combat_ai_random_target` is combat_ai scope (`aiRandomTarget` Combat.ts:631). |
| `_do_random_cripple` | `doRandomCripple` results.ts:73 | ✅ | | |
| `_determine_to_hit` | `getHitChance` hitChance.ts:139 | ✅ | | |
| `_determine_to_hit_no_range` | `getHitChance(..., useDistance=false)` | ⚠️ | LOW | CE adds the distance term only when `useDistance` or it is a bonus (>0). DH2 always subtracts it, so a Scope Range weapon (min distance 8) gets −32 in the AI's no-range check. |
| `_determine_to_hit_from_tile` | `getHitChance(..., from)` | ✅ | | |
| `attackDetermineToHit` | `getHitChance` hitChance.ts:139 | ⚠️ | LOW | All terms match: skill, perception/range perks, Sharpshooter, blind ×−12 / −25, line-of-fire −10s, One Hander, min ST, Accurate, AC + ammo AC, location penalty (half for melee), multihex +15, darkness / Night Sight, knockdown +40, difficulty ±20, cap 95. The one difference is that `_gcsd->accuracyBonus` isn't added inside (COMBAT-15). AC uses `bonusAC` (COMBAT-04). |
| `attackComputeDamage` | `attackComputeDamage` 646 / `damageAgainst` 662 / damage.ts | ⚠️ | MED | Vanilla formula, bypass, penetrate (weapon + unarmed), Finesse, Bonus Ranged Damage, difficulty, Living Anatomy / Pyromaniac, knockback rules and Stonewall match. Differences: Glovz / YAAM (COMBAT-13); natural damage type; Living Anatomy reads the hit critter's kill type (CE: `attack->defender` even on a self-hit, LOW). |
| `attackComputeDeathFlags` | Combat.ts:533 | ✅ | | |
| `_apply_damage` | `applyDamage` Combat.ts:951 | ⚠️ | MED | COMBAT-07 / 08: the miss path (results, retaliation and onlookers for oops) is missing; `damage_p_proc` gating differs; no damage proc for a non-critter defender (N/A, DH2 targets only critters). The attacker's combat_p_proc(2) after a hit matches. |
| `_check_for_death` | `checkForDeath` Combat.ts:140 | ✅ | | |
| `_set_new_results` | `setNewResults` results.ts:94 | ⚠️ | LOW | DAM_DEAD: CE `queueRemoveEvents` drops *all* the critter's queued events; DH2 drops only knockouts. KO timer 10×(35−3·END) and the persistent mask match. |
| `_damage_object` | `critterDamage` lifecycle.ts:332, `critterKill` 71, `perish` Combat.ts:1687 | ⚠️ | HIGH | Missing pieces:<br>- COMBAT-06: no invulnerable check.<br>- COMBAT-07: `damage_p_proc` conditions.<br>- COMBAT-03: no `partyMemberRemove`.<br>- No `itemDestroyAllHidden` or `scriptRemove` (LOW, unverified).<br>- Kill count ignores `scriptOverrides` (LOW).<br>- `destroy_p_proc` source is the attacker (CE: whoHitMe).<br>damageLastTurn and XP match. |
| `_combat_display` | `combatDisplay` Combat.ts:1028 | ✅ | | Message ids, oops line, critical text, killed line and extras match. The "%s missed" for a non-critter accidental target is N/A. |
| `combatCopyDamageAmountDescription` | `damageAmountDescription` Combat.ts:1122 | ✅ | | |
| `combatAddDamageFlagsDescription` | `damageFlagsDescription` Combat.ts:1135 | ✅ | | |
| `_combat_anim_begin` | — | 🚫 | | UI disable / cursor during the animation. |
| `_combat_anim_finished` | `resolveAttack` / `proceed` Combat.ts:856–945 | 🟡 | LOW | Ammo spend → display → apply → standup after the attacker's own knockdown matches. DH2 applies on the action frame / projectile impact; CE applies after the whole animation (ordering only). `_scr_end_combat` (dead path) not ported. |
| `_combat_standup` | `combatStandup` results.ts:147 | ✅ | | 3 AP (1 with Quick Recovery). |
| `_print_tohit` | `drawDigits` ui_calledshot.ts:58 | ⚠️ | LOW | CE shows "00" for 0 % and dashes only below 0; DH2 shows "--" for ≤ 0. |
| `hitLocationGetName` | `hitLocationName` Combat.ts:1153 | ✅ | | combat.msg 1000 + 10 × alias + location. |
| `_draw_loc_off` | ui_calledshot.ts (CSS) | 🚫 | | DOM equivalent. |
| `_draw_loc_on_` | ui_calledshot.ts (CSS) | 🚫 | | |
| `_draw_loc_` | ui_calledshot.ts | 🚫 | | |
| `calledShotSelectHitLocation` | `uiCalledShot` ui_calledshot.ts:52 | ⚠️ | LOW | 8 locations with the hit mode's to-hit, Esc/cancel. DH2-only: crippled limbs are greyed out and can't be picked (CE allows them). No `icsxxxx1` sound on pick. |
| `_combat_check_bad_shot` | `checkBadShot` Combat.ts:2136 | ✅ | | Order and conditions match (two-hand flag = weaponFlags 0x02, i.e. 0x200). |
| `_combat_to_hit` | `uiShowCombatHover` ui_hud.ts:594 | ⚠️ | LOW | CE shows "X" whenever `_combat_check_bad_shot` fails (range, AP, aim blocked); DH2 tests only ammo. |
| `_combat_attack_this` | playerUse.ts:278–380 | 🟡 | LOW | combat.msg 100–106 refusals and the out-of-ammo sound match. The out-of-combat branch (start `_combat` with csd so the player's first turn auto-attacks) isn't reachable in DH2. |
| `_combat_outline_on` | `refreshHighlights` Combat.ts:3112 | 🟡 | LOW | See the outline row. |
| `_combat_outline_off` | `finish` / `clearNeutralOutlines` Combat.ts:338 | ✅ | | |
| `_combat_highlight_change` | `refreshHighlights` (pref change) | ✅ | | |
| `_combat_is_shot_blocked` | `combatIsShotBlocked` lineOfFire.ts:39 | ✅ | | sfall fixes (flags, multihex step) included. |
| `_combat_player_knocked_out_by` | — | 🚫 | | Dead in CE: `_combat_ending_guy` is only set after `_scr_end_combat` succeeds, which needs it set first. |
| `_combat_explode_scenery` | `scriptsExplodeScenery` explosion.ts:88 | ✅ | | |
| `_combat_delete_critter` | — | ❌ | MED | COMBAT-12. |
| `_combatKillCritterOutsideCombat` | drugs.ts:184 `critterKill` | 🟡 | LOW | DH2 kills; item.msg 600 "succumbs to the adverse effects of chems" and `destroy_p_proc` aren't run (drugs scope, unverified). |
| `combatGetTargetHighlight` | `Config.ui.targetHighlight` | ✅ | | |
| `criticalsInit` | ceTables.ts (static) | ❌ | HIGH | COMBAT-02: mode-2 fixes missing; modes 1/3 (ini override files) are sfall-only (LOW). |
| `criticalsReset` | — | 🚫 | | No mutable tables. |
| `criticalsExit` | — | 🚫 | | |
| `criticalsGetValue` | — | ❌ | LOW | sfall `get_critical_table` has no backing; no opcode found in DH2. |
| `criticalsSetValue` | — | ❌ | LOW | sfall `set_critical_table`. |
| `criticalsResetValue` | — | ❌ | LOW | sfall `reset_critical_table`. |
| `burstModInit` | — | 🟡 | LOW | Burst mod off by default in CE; DH2 hardcodes the vanilla split. |
| `burstModComputeRounds` | — | ❌ | LOW | Only used with BurstMod=1. |
| `unarmedInit` | unarmed.ts:59–78 | ✅ | | |
| `unarmedInitVanilla` | `PUNCH` / `KICK` / `ADVANCED_*` unarmed.ts:59 | ✅ | | All 14 entries checked (level, skill, ST, AG, bonus, crit, AP, penetrate, secondary). |
| `unarmedInitCustom` | — | 🚫 | | sfall `UnarmedFile` ini override. |
| `unarmedGetDamage` | `mode.minDmg/maxDmg/bonusDamage` Combat.ts:690 | ✅ | | |
| `unarmedGetBonusCriticalChance` | `mode.critBonus` Combat.ts:480 | ✅ | | |
| `unarmedGetActionPointCost` | `unarmedAPCost` unarmed.ts:166 | ✅ | | |
| `unarmedIsPenetrating` | `mode.penetrate` Combat.ts:675 | ✅ | | |
| `unarmedGetPunchHitMode` | `unarmedHitMode(..., 'punch')` unarmed.ts:82 | ✅ | | |
| `unarmedGetKickHitMode` | `unarmedHitMode(..., 'kick')` | ✅ | | |
| `unarmedGetHitModeInRange` | `unarmedHitMode` unarmed.ts:82 | ✅ | | Uses only ST / AG requirements (the only non-zero ones in vanilla); non-players get the basic move. |
| `damageModInit` | `Config.combat.damageCalculationType` config.ts:272 | ✅ | | Default vanilla; BonusHthDamageFix is always on in DH2 (CE default on). |
| `damageModGetBonusHthDamageFix` | `rollWeaponDamage` Combat.ts:225 | ✅ | | |
| `damageModGetDisplayBonusDamage` | — | 🚫 | | Off by default; display-only. |
| `damageModCalculateGlovz` | `computeDamageGlovz` / `GlovzTweak` damage.ts:50/62 | ⚠️ | MED | COMBAT-13: different formula. |
| `damageModGlovzDivRound` | `glovzRound` damage.ts:34 | ⚠️ | LOW | CE rounds half to even with special cases for dividend < divisor; DH2 is plain round-half-up. |
| `damageModCalculateYaam` | `computeDamageYaam` damage.ts:74 | ⚠️ | LOW | COMBAT-13: DH2 implements the intended sfall YAAM. CE's YAAM yields 0 (pointer bug) and uses the extra DR only. DH2 also gets DR with ammo RM already added (double count). |
| `combat_get_hit_location_penalty` | `regionHitChanceDecTable` effects.ts:22 | 🟡 | LOW | Values match (sign flipped); the sfall `get_bodypart_hit_modifier` opcode has no handler in DH2. |
| `combat_set_hit_location_penalty` | — | ❌ | LOW | sfall `set_bodypart_hit_modifier` (0x81E0) missing. |
| `combat_reset_hit_location_penalty` | — | ❌ | LOW | Needs the above. |
| `combat_get_data` | `combatGetData` Combat.ts:78 | ✅ | | sfall `combat_data`. |
| (static data) `_cf_table` | `CF_TABLE` Combat.ts:107 | ✅ | | |
| (static data) `hit_location_penalty_default` | effects.ts:22 | ✅ | | |
| (static data) `gCriticalHitTables` / `gPlayerCriticalHitTable` | ceTables.ts | ✅ | | Script-verified, 1080/1080 identical to the *static* arrays (see COMBAT-02 for the runtime fixes). |

## Detailed findings

### COMBAT-01 — Primary burst / flame weapons never spray (HIGH, NEW) — **FIXED 2026-10-24 (PA15)**
- **CE:** `combat.cc:attackCompute` computes `anim = critterGetAnimationForHitMode(attacker, hitMode)`, then `if (anim == ANIM_FIRE_BURST || anim == ANIM_FIRE_CONTINUOUS) roll = _compute_spray(...)`. That covers the primary hit mode too. Continuous mode (flamers) uses 1 left / 1 main / 1 centre / 1 right round. `_shoot_along_path` gives each critter on a line one round (`remainingRounds = 1`) and doesn't count path hits on the main target. The AI safety check (`_combat_safety_invalidate_weapon_func`) also simulates the spray for any hit mode whose anim is burst / continuous.
- **DH2:** `Combat.ts:442` `const isBurst = !!weapon?.isBurst?.()`, and `Weapon.ts:300` `isBurst()` returns `this.mode === 'burst'`. The `'burst'` mode is added only for a *secondary* attack mode of 7/8 (`Weapon.ts:231`). For a primary 7/8 weapon, `modes = ['single']` (it can't be aimed). The safety check returns false for `hitMode !== 'secondary'` (Combat.ts:1447).
- **Affected protos (pro.json):** primary mode 7 — 12 Minigun, 28 Gatling Laser, 350 Avenger, 355 Vindicator, 387, 389, 395, 518, 520; primary mode 8 — 11 Flamer, 400 Improved Flamer, 427.
- **Impact:** the game's heaviest weapons hit one target with one round's damage. No spray, no friendly fire, and a 1-round ammo cost instead of `min(ammo, burstRounds)`. Gameplay balance changes a lot (Frank Horrigan, Enclave troopers and Navarro carry these). The AI's safety check never blocks a minigun.
- **Fix:** decide spray from the current hit mode's attack mode (7 → burst, 8 → continuous) for both slots. Port the continuous branch in `computeSpray` / `shootAlongPath`. Make `getAttackSkin`, the HUD and `aiPickHitMode` agree.

### COMBAT-02 — sfall critical-table fixes (OverrideCriticalTable=2) not applied (HIGH, NEW) — **FIXED 2026-10-24 (PA16)**
- **CE:** `combat.cc:criticalsInit`. `sfall_config.cc:42` defaults `OverrideCriticalTable` to 2, and mode 2 rewrites about 90 entries. Examples:
  - KILL_TYPE_MAN, uncalled, effect 2: flags `DAM_KNOCKED_DOWN | DAM_BYPASS`, message 5019.
  - Child leg effects 1–2: no massive flags, message 5216.
  - Ghoul / brahmin head effect 4: no massive stat.
  - Radscorpion / centaur: massive knockdown.
  - Deathclaw left leg effects 1–5: `DAM_CRIP_LEG_LEFT`.
  - Gecko uncalled: messages 6701 / 6704, effect 2 knockdown + bypass.
  - Alien and giant-ant uncalled effect 2.
  - Big Bad Boss: messages throughout; uncalled multipliers 3 / 4.
- **DH2:** `ceTables.ts` is generated from the static initialiser only. The script check shows, for example, MAN uncalled e2 = `[4, 0, -1, 0, 0, 5018, 5000]`; CE at runtime has `[4, DAM_KNOCKED_DOWN|DAM_BYPASS, -1, 0, 0, 5019, 5000]`.
- **Impact:** about a quarter of critical hits on humans with unaimed shots (effect 2, roll 46–70) lose the knockdown and armor bypass. Other kill types lose their fixes, and wrong messages show.
- **Fix:** apply the mode-2 `criticalsSetValue` list on top of `CRITICAL_HIT_TABLES` (a copy at init), or regenerate ceTables.ts with the patches baked in.

### COMBAT-03 — Dead party members stay in the party (HIGH, NEW) — **FIXED 2026-10-24 (PA12)**
- **CE:** `combat.cc:_damage_object` on death runs `scriptRemove(a1->sid); a1->sid = -1; partyMemberRemove(a1);`.
- **DH2:** `critterKill` (lifecycle.ts:71) / `perish` (Combat.ts:1687) never call `gParty.removePartyMember`; it has no callers at all.
- **Impact:** `METARULE_PARTY_COUNT` (scripting.ts:776) counts corpses, so party-size limits block recruiting after a companion dies. Party iteration (`GameMap.ts:244/324`, `mapLoader.ts:149/359`, `skillUse.ts`, `drugs.ts:248`) includes dead members, e.g. the corpse is carried to the next map.
- **Fix:** in `critterKill`, when the victim is a party member, remove it (`partyMemberRemove` semantics) and drop its script, as CE does. Also check the `party_member_list` / `party_member_obj` opcodes.

### COMBAT-04 — Unused-AP Armor Class bonus not CE's model (HIGH, conflicts with known_bugs C22) — **FIXED 2026-10-24 (PA17)**
- **CE:** `stat.cc:203` STAT_ARMOR_CLASS adds `critter->data.critter.combat.ap` (×2 + Unarmed/12 with HtH Evade) when `isInCombat() && _combat_whose_turn() != critter`. `combat.cc:_combat_set_move_all` sets `ap = max AP` for every combatant at the **start of each round**. `_combat_begin` sets `ap = 0` for everyone and `_combat_over` sets it to 0 again. So:
  - a combatant that hasn't acted yet this round has its **full AP** as AC;
  - after acting it keeps its leftover;
  - non-combatants have 0;
  - after combat nothing remains.
- **DH2:**
  - `bonusAC` is set only from the leftover after a critter's own turn (Combat.ts:2993–3012) and zeroed at its next turn start.
  - In round 1 every not-yet-acted critter has 0.
  - Skipped non-hostile critters get `bonusAC = full AP` (their `ActionPoints` start full).
  - `bonusAC` isn't cleared at combat end, and `hitChance.ts:183` adds it even out of combat.
- **Impact:** to-hit against critters later in the turn order is too high by up to ~10 %, and too low against neutrals. Stale AC lingers after combat. Known_bugs C22 ("Bonus AC counts only leftover AP") reads CE as leftover-only, which is wrong for critters that haven't acted yet.
- **Fix:** model `combat.ap` like CE. Reset all combatants' AP at round start (not turn start), leave non-combatants at 0, and zero it at combat end. Then derive AC from current AP when it isn't the critter's turn, instead of a separate `bonusAC`.

### COMBAT-05 — `script_overrides` in combat_p_proc (turn start) ignored (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `combat.cc:_combat_turn` runs `scriptSetObjects(sid, null, null); fixedParam 4; SCRIPT_PROC_COMBAT`. If the script sets `scriptOverrides`, the standup, the player's input and `_combat_ai` are all skipped.
- **DH2:** `Combat.ts:1851` calls `Scripting.combatEvent(obj, 'turnBegin')`. `scripting.ts:3625` has `// TODO: script_overrides`, and the return value is only the terminate flag. The proc also runs after the standup and without clearing source/target.
- **Impact:** scripts that take over a critter's turn (COMBAT_SUBTYPE_TURN + `script_overrides`) still get the AI's turn.
- **Fix:** read `_didOverride` after the proc and end the turn when it is set. Run the proc before the standup, and null source/target first.

### COMBAT-06 — Invulnerable critters lose HP (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `_damage_object` returns if `_critter_flag_check(pid, CRITTER_INVULNERABLE)`. `_set_new_results` and `_check_for_death` skip such critters too.
- **DH2:** `critterDamage` (lifecycle.ts:348) subtracts HP and kills at ≤ 0 without the check; only `setNewResults` / `checkForDeath` / the crit functions test it.
- **Impact:** proto 481 (the only critter with flag 0x400) can be damaged and killed. So can script-flagged critters.
- **Fix:** add the invulnerable early-out to `critterDamage` (the combat path).

### COMBAT-07 — `damage_p_proc` gating of `_damage_object` not ported (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `_damage_object(obj, dmg, animated, a4, attacker)` runs damage_p_proc only when `!a4` and not (both party members). `_apply_damage` passes:
  - for the attacker: `a4 = defender == oops`, so a self-hit from a normal critical failure gets **no** proc;
  - for the defender: `a4 = defender != oops`, so an accidental victim gets **no** proc;
  - for extras: `a4 = defender == oops`, so burst / blast bystanders of a normal attack get **no** proc.
- **DH2:** `critterDamage` (lifecycle.ts:353) always calls `Scripting.damage` when damage > 0.
- **Impact:** extra `damage_p_proc` runs, e.g. a companion hit by the player's burst reacts, and bystanders turn hostile through their scripts where CE leaves them alone.
- **Fix:** pass CE's `a4` and the party check into `critterDamage` (killOptions).

### COMBAT-08 — Miss path of `_apply_damage` (MED, NEW) — **FIXED 2026-10-25**
- **CE:** the defender block runs for any live critter defender, hit or not. On a miss `defender == oops` and flags are 0, so `_set_new_results(defender, 0)` and `_combatai_check_retaliation(defender, attacker)` run (whoHitMe), then `_combatai_notify_onlookers(defender)`. An accidental hit also notifies onlookers of `oops`.
- **DH2:** `applyDamage` (Combat.ts:966) handles the defender only with DAM_HIT and never notifies for `a.oops`. Instead `attack()` (Combat.ts:784) flips the target to `hostile` with whoHitMe before the roll; that DH2-only shortcut covers non-hostile targets only.
- **Impact:** a target that is already hostile doesn't switch retaliation to an attacker who missed. Onlookers aren't engaged by misses.
- **Fix:** run `noteHit(defender, attacker, false)` and `notifyOnlookers` for the intended target on misses, plus `notifyOnlookers(oops)` on accidental hits. Drop the DH2 `hostile` flip.

### COMBAT-09 — whoHitMe never reset per combat (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `_combat_begin` and `_combat_over` set `whoHitMe = nullptr` for every critter on the elevation.
- **DH2:** never cleared, except `critter_stop_attacking` (scripting.ts:2678) and the AI's strongest / weakest / closest reset.
- **Impact:** the next fight starts with stale attackers (`aiDangerSource` returns them; `shouldEnd` / `attemptEnd` team checks see old team-mate hits). Combat may refuse to end, or critters retaliate against old foes.
- **Fix:** clear whoHitMe in the `Combat` constructor (before `sequenceInit` / teamCombat) and in `combatOver`.

### COMBAT-10 — Joining critters and party members (MED, NEW) — **FIXED 2026-10-25**
- **CE:**
  - `_combat_sequence_init` makes only the attacker, the defender and the dude combatants.
  - At round end `_combat_add_noncoms` runs `_combatai_notify_friends(dude)`. Each critter for which `_combatai_want_to_join` is true gets max AP and **an immediate `_combat_turn`**, then acts again in the next round.
  - Party members join this way, after round 1.
- **DH2:**
  - `combatSequence` only sets `hostile = true`, so the joiner acts first next round.
  - `nextTurn` (Combat.ts:3045) gives every same-team critter a full AI turn in round 1 whether it joined or not.
- **Impact:** a different turn order. CE joiners get an extra immediate turn, and DH2 party members act before CE would let them.
- **Fix:** run the joiner's turn right away (needs re-entrancy in `nextTurn`), and require joining for party members.

### COMBAT-11 — Player's attack doesn't set the player's whoHitMe (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `_combat_attack` runs `if (attacker == gDude) _critter_set_who_hit_me(attacker, defender)` and `aiInfoSetLastTarget(attacker, defender)` for every attacker.
- **DH2:** `attack()` sets neither for the player; `aiLastTarget` is set only at the AI's first attempt (Combat.ts:2167).
- **Impact:** `_ai_danger_source` / `aiFindAttackers` (the "my team's attacker" slot) and party `attack_who` logic can't see whom the player is fighting. Party members pick other targets. `_combat_should_end`'s whoHitMe test also differs.
- **Fix:** add both calls in `attack()` after `attackCompute`.

### COMBAT-12 — No `_combat_delete_critter` (MED, NEW, impact unverified) — **FIXED 2026-10-25**
- **CE:** script opcodes (destroy_object, move to another elevation, party changes) and `object.cc` call `_combat_delete_critter`, which removes the critter from the combat list, zeroes AP and whoHitMe and calls `_combatai_delete_critter`.
- **DH2:** `combatants` is never pruned; `nextTurn` skips only `dead` critters. A destroyed or moved live critter keeps its turn slot (its AI runs while it is off the map) and counts in `shouldEnd`.
- **Fix:** add `Combat.deleteCritter(obj)` and call it from `destroyObject`, `move_to` across elevations and `party_remove`.

### COMBAT-13 — Glovz / YAAM damage formulas (MED, opt-in; conflicts with known_bugs C3)
- **CE Glovz** (`damageModCalculateGlovz`):
  - DT is divided by ammoY (DivRound); DR is shifted ±20 by difficulty, lowered by the absolute ammo DR modifier, then divided by ammoX; DR ≥ 100 means no damage.
  - Per round: damage, minus DT, minus DR%; then +15 / 20 / 10 % for unarmored targets.
  - Multiplier: `+ damage × mult / 2` (tweak: `+ DivRound(damage × mult × 25, 100)`).
  - No difficulty multiply.
- **DH2:** `damage.ts:50/62` multiplies by crit × ammoX, divides by 2·ammoY, applies the difficulty multiplier, then DR then DT. That is a different formula with different results.
- **CE YAAM** (`damageModCalculateYaam`) is broken: `context->damagePtr += damage` advances the pointer, so no damage is added, and it reduces by the local extra DR, not `calculatedDamageResistance`. DH2 implements the intended version, but `damageAgainst` already adds ammo RM to DR (Combat.ts:683) before YAAM applies RM to DT.
- **Impact:** only with `damageCalculationType` 1 / 2 / 5 (default 0).
- **Fix:** port Glovz literally. For YAAM, either keep the intended version (document it as a deliberate deviation in known_bugs C3) or match CE. In both cases pass the raw DR (without RM) to the non-vanilla rulesets.

### COMBAT-14 — Combat state not saved (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `combatSave` / `combatLoad` persist `gCombatState`, the free move, `_combat_exps`, the combatant / non-combatant split, the order, whoHitMe and the AI info. A save made in combat reloads in combat, on the player's turn.
- **DH2:** saving is allowed in combat (hotkeys.ts:177/201/203). saveload.ts writes no combat state, and loading always ends combat (saveload.ts:336).
- **Impact:** save / reload during a fight escapes it, and the kill XP collected so far (`combatExps`) is lost.
- **Fix:** serialise the `Combat` fields and resume, or refuse saving in combat (CE does allow it).

### COMBAT-15 — attack_complex (`_gcsd`) bonuses (LOW, NEW)
- **CE:** `_gcsd` is non-null for the whole first combatant turn. `attackDetermineToHit` adds `accuracyBonus` before the 95 cap, for every to-hit computed (spray lines, AI decisions), and `_combat_attack` applies the damage clamps to every attack in that turn.
- **DH2:** Combat.ts:813/467 adds the bonus after the cap, for the first single-shot attack only (not in `computeSpray`), then clears `gcsd`.
- **Fix:** read `gcsd.accuracyBonus` inside `getHitChance` before the cap, and clear `gcsd` at the end of the first turn.

### COMBAT-16 — Super Cattle Prod / Mega Power Fist ammo cost (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `attackCompute` → `item.cc:_item_w_compute_ammo_cost` doubles `ammoQuantity` for PROTO_ID_SUPER_CATTLE_PROD (399) and PROTO_ID_MEGA_POWER_FIST (407).
- **DH2:** not ported; Combat.ts:489 always uses 1 for a non-ranged weapon.
- **Impact:** these two weapons use half the charges they should.
- **Fix:** double `a.ammoQuantity` for those pids.

### COMBAT-17 — Both arms crippled blocks unarmed attacks (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `_combat_check_bad_shot` checks crippled arms only when `critterGetWeaponForHitMode` returns a weapon. Punches and kicks (weapon nullptr) are allowed, crippled or not.
- **DH2:** `attack()` (Combat.ts:803) returns early ("can't attack — both arms are crippled!") for any attacker with both arms crippled, unarmed included. The message is invented as well.
- **Fix:** remove the guard; `checkBadShot` already returns `bothArmsCrippled` for real weapons.

## DH2-only behaviour

- **Instant hostility on attack** (`attack()` Combat.ts:784): a non-team, non-hostile target becomes `hostile` (and gets whoHitMe) as soon as it is attacked, even mid-round. In CE it joins only through `_combat_add_noncoms` at round end.
- **Party members take turns without joining** (Combat.ts:3045), see COMBAT-10.
- **"X is killed by Y!"** message in `perish` (Combat.ts:1690). CE prints no such line (the kill shows as "… and was killed" in `_combat_display`).
- **"out of ammo!" / "can't attack — both arms are crippled!"** uiLog lines in `attack()` (Combat.ts:797/804) are invented strings (CE uses combat.msg 101 / 105 in `_combat_attack_this`).
- **Jinxed from Pariah Dog**: `isJinxed` (Combat.ts:1210) also triggers when the attacker or target has a perk named "Pariah Dog". CE checks only TRAIT_JINXED or the dude's PERK_JINXED.
- **Called-shot screen greys out crippled limbs** and blocks clicks on them (ui_calledshot.ts:81–101); CE lets you target them.
- **Blue outline for neutral critters** (`refreshHighlights`, CI11, documented).
- **Solar Scorcher daylight gate in `attack()`** (via `aiHaveAmmo`, Combat.ts:796) applies to the player too and returns after `playerUse` has already paid the AP.
- **AI `aiLastItem` retry** (Combat.ts:2543): CE never stores a last item (see `aiInfoSetLastItem`).
- **Explosion sprites** spawned by the attack pipeline (`spawnExplosionSprite`) are visual only; CE animates them through actions.cc.
- **Corpse auto-cleanup timer** (`Config.engine.corpseTimeout`, lifecycle.ts:123) has no CE equivalent (off unless configured).
