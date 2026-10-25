# CE parity audit — Combat AI

Scope: CE files `raw/fallout2-ce/src/combat_ai.cc`, `combat_ai.h`, `combat_ai_defs.h`; DH2 files `src/combat/Combat.ts` (AI section, ~1219–2800), `src/combat/AI.ts`, `src/aiPackets.ts`, `src/combat/whoHitMe.ts`, `src/perception.ts`, `src/party.ts` (disposition / custom), `src/scripting.ts` (`critter_add_trait`). Audited 2026-10-24.

## Summary

| Status | Count |
|---|---|
| ✅ MATCH | 32 |
| ⚠️ DIFFERS | 14 |
| 🟡 PARTIAL | 16 |
| ❌ MISSING | 0 |
| 🚫 N/A | 15 |

(Counts are per table row; grouped getter/setter rows count once.)

Top findings, most severe first:

1. **AI-01 (MED-HIGH)**: `_ai_try_attack` safety and fallback branches are missing. An NPC that already holds a weapon never switches away from one that would hit its own team (`_combat_safety_invalidate_weapon` → `_ai_switch_weapons`). It also never takes CE's safe-distance step back before an area attack. When the move in the min_to_hit approach fails, CE runs away and DH2 attacks anyway.
2. **AI-02 (MED)**: `critterSetTeam` (via `critter_add_trait` OBJECT_TEAM) is a bare `teamNum =` assignment. CE skips party members and same-value writes, clears a who-hit-me that is now on the same team, and clears the last target. In DH2 an NPC moved onto the player's team by script keeps `whoHitMe` = player and goes on attacking. It also blocks `_combat_should_end`.
3. **AI-03 (MED)**: `aiFindAttackers` skips dead team-mates. CE's "who hit my friend" slot also takes the killer of a dead team-mate, which is the main way NPCs retaliate for a fallen ally.
4. **AI-04 (MED)**: the `attack_who=strongest/weakest` sorts are inverted relative to CE. CE's `_compare_strength` sorts ascending (so "strongest" picks the lowest rating first) and `_compare_weakness` sorts descending. DH2 does the intuitive thing. This is a vanilla quirk; nothing documents it.
5. **AI-05 (MED)**: `_ai_pick_hit_mode` checks the secondary-mode preference against `'ranged'` instead of the secondary attack type. It also lacks CE's last-weapon throw guard (no other weapon and an INT roll), so an NPC can throw away its only spear or knife.
6. **AI-06 (MED)**: `_ai_best_weapon` treats an explicit `best_weapon=no_pref` like the unset value (-1) for the "avg damage beats preference order" override. CE applies that override only to -1 and unarmed_over_throw.
7. **AI-07 (MED)**: in `_combat_ai` a fleeing critter runs away from the danger source in DH2. CE calls `_ai_run_away(a1, a2)` with the caller's `a2`, which is normally null, so it runs from the dude. CE companions flee *from the player*.
8. **AI-08 (LOW-MED)**: in the `_combat_ai` tail, a non-player-team NPC regroups with any living team-mate in DH2. CE only uses team-mates already in the fight (`_ai_find_nearest_team_in_combat`, which needs `whoHitMe != null`). `_ai_find_friend` moves toward the friend in DH2, but CE's step count is always negative, so in CE it never moves.
9. **AI-09 (LOW)**: `aiPackets.ts` numeric fallback maps (ATTACK_WHO, DISTANCE, RUN_AWAY, AREA_ATTACK) do not follow CE's enum order. Missing-key defaults are 'closest' and 'on_your_own' where CE uses -1. `hit_groin_end++` is not applied. Vanilla ai.txt only uses string keys, so this is practically dormant.
10. **AI-10 (LOW)**: `fleeHpThreshold` / `HP_FLEE_PCT` in `src/combat/AI.ts` is dead code (imported, never called) and carries an inverted percentage meaning. `Combat.ts aiMinHp` is the live, correct port.

## Function table

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| `_parse_hurt_str` (combat_ai.cc:302) | `aiPackets.ts:116 parseStringList` + `Combat.ts:279 aiHurtTooMuch` | ✅ | | Strings are kept and tested at use time; blind / crippled (any limb) / crippled_legs / crippled_arms bits as `_rmatchHurtVals`. |
| `_cai_match_str_to_list` (:337) | `aiPackets.ts:92 parseEnum` | ✅ FIXED (2026-10-25) | LOW | String keys match case-insensitively, as CE does. The numeric fallback maps (`ATTACK_WHO_MAP`, `DISTANCE_MAP`, `RUN_AWAY_MODE_MAP`, `AREA_ATTACK_MODE_MAP`) use invented orders, not CE's enums. Unknown string → fallback ('closest', 'on_your_own', …) where CE uses -1. See AI-09. |
| `aiPacketInit` (:350) | `aiPackets.ts:230 FALLBACK_PACKET` / `buildPacket` defaults | ✅ FIXED (2026-10-25) | LOW | CE sets every enum to -1. DH2 defaults attack_who='closest' and distance='on_your_own'. -1 distance means maxTeammateDistance 5 for a party member in CE, while 'on_your_own' gives 7. AI-09. |
| `aiInit` (:370) | `aiPackets.ts:206 ensureInit` / `buildPacket` | ✅ FIXED (2026-10-25) | LOW | Same keys. CE's `hit[GROIN].end++` (the groin range is one longer) is missing. font / color / outline_color / body_type / general_type are not parsed; taunt colours are hard-coded (see `_ai_print_msg`). run_away_mode / disposition are kept as strings, not CE's decremented ints (the behaviour is equivalent where used). CE aborts on a missing int key; DH2 substitutes defaults. — **Fixed 2026-10-25:** hit_groin_end + 1 (AI-09); the colours are still hard-coded. |
| `aiReset` (:533) | — | 🚫 | | Empty in CE. |
| `aiExit` (:538) | — | 🚫 | | Memory free; GC in DH2. |
| `aiLoad` (:573) | Critter `customAiOverrides` serialisation (`party.ts`, SERIALIZED_CRITTER_PROPS) | 🚫 | | CE saves/loads the shared CUSTOM packet per party PID. DH2 persists per-critter overrides; same effect. |
| `aiSave` (:594) | same | 🚫 | | as above |
| `aiPacketRead` (:615) | — | 🚫 | | Binary save format; replaced by JSON. |
| `aiPacketWrite` (:659) | — | 🚫 | | CE comment notes a possible chem_primary_desire bug; not relevant. |
| `combat_ai_num` (:705) | — | 🚫 | | Debug / sfall helper; unused by vanilla flow. |
| `combat_ai_name` (:711) | `AiPacket.name` | 🚫 | | Debug name lookup (CE bounds-checks the packet_num against the count, a CE quirk). Unverified whether any DH2 path needs it. |
| `aiGetPacket` (:731) | `AI.ts:25 AI` constructor | ✅ | | The packet comes from `combatant.aiNum`, with custom overrides merged. |
| `aiGetPacketByNum` (:741) | `aiPackets.ts:257 getAiPacket` | ✅ | | Falls back to the first packet, as CE. |
| `aiGetAreaAttackMode` / `aiGetBestWeapon` / `aiGetDistance` / `aiGetAttackWho` / `aiGetChemUse` (:756–808) | `obj.ai.packet.<field>` | ✅ | | Plain field reads. |
| `aiGetRunAwayMode` (:763) | `ui_companion.ts:92` (shows `packet.runAwayMode`) | 🟡 | LOW | CE derives the mode from `100*min_hp/maxHP` against `_hp_run_away_value` when run_away_mode == -1. DH2 shows the packet string. Unverified for packets without run_away_mode. |
| `aiSetAreaAttackMode` / `aiSetBestWeapon` / `aiSetDistance` / `aiSetAttackWho` / `aiSetChemUse` (:811–889) | `party.ts setCompanionCustomSetting` → `customAiOverrides` | ✅ | | Override instead of mutating the shared packet. |
| `aiSetRunAwayMode` (:823) | `Combat.ts:268 aiMinHp` | ✅ | | `min_hp = max − trunc(max × pct / 100)`, with pct by enum index (none 0 … tourniquet 100). |
| `aiGetDisposition` (:892) | `packet.disposition` | ✅ | | |
| `aiSetDisposition` (:903) | `party.ts:230 setCompanionDisposition` + `aiPackets.ts:306` | ⚠️ | LOW | **Documented deviation.** DH2 looks up the sibling packet by section name ("PARTY X AGGRESSIVE"); CE uses packet_num arithmetic. |
| `_ai_magic_hands` (:920) | `Combat.ts:2383 aiMagicHands` | 🟡 | LOW | 'use' anim plus "<name> <msg> <item>." matches. The out-of-ammo path (`aiNoAmmo` :2357) logs msg 5001 directly with no magic-hands animation. |
| `_ai_check_drugs` (:955) | `Combat.ts:2391 aiCheckDrugsStep` | 🟡 | LOW | Ratios 60/30/50 and chances 25/75/100 match. `_combatNumTurns` is approximated from `turnNum / combatants.length`. The env-search loop runs once per turn (CE loops while AP ≥ 2). The pool is re-derived from the inventory each step rather than CE's 3+3 buckets; the effect is equivalent. |
| `_ai_run_away` (:1173) | `Combat.ts:2608 aiRunAway` | ✅ | | `< max_dist` → FLEEING, run with all AP over 3 directions; else DISENGAGING. DH2 taunts 'run' before the path is known (CE only after a path is found), LOW. |
| `_ai_move_away` (:1221) | `Combat.ts:2585 aiMoveAway` | ⚠️ | LOW | CE moves only if `distance(a1,a2) <= a3`; DH2 has no such gate, so it moves away from a friendlyDead >10 hexes off in tail steps 1–2. The 'stay' check matches. |
| `_ai_find_friend` (:1267) | `Combat.ts:2731` (aiEndOfTurn step 1) | ✅ FIXED (2026-10-25) | LOW | CE: true if the nearest team-mate is within PER×2, and it moves `distance − 5` steps only when `5 > distance`. That number is negative, so CE never moves. DH2 moves `d−5` when d>5. AI-08. |
| `_compare_nearer` / `_ai_sort_list_distance` (:1290/:1318) | inline `sort` by `hexDistance` | ✅ | | |
| `_compare_strength` / `_ai_sort_list_strength` (:1327/:1355) | `Combat.ts:1954` | ⚠️ | MED | CE sorts ascending by rating (lowest first). DH2 sorts descending. AI-04. |
| `_compare_weakness` / `_ai_sort_list_weakness` (:1363/:1391) | `Combat.ts:1955` | ⚠️ | MED | CE sorts descending (highest first). DH2 sorts ascending. AI-04. |
| `_ai_find_nearest_team` (:1397) | `Combat.ts:2107 nearestOfTeam` / `:2788 nearestOfTeamExcept` | ✅ | | |
| `_ai_find_nearest_team_in_combat` (:1426) | `Combat.ts:2771` uses `nearestOfTeamExcept` | ✅ FIXED (2026-10-25) | LOW | The `whoHitMe != null` filter is missing. AI-08. |
| `aiFindAttackers` (:1457) | `Combat.ts:1945–1952` | ⚠️ | MED | DH2 `if (c.dead) continue` also drops dead team-mates from the whoHitFriend slot. CE checks dead only for slots 1 and 3. AI-03. |
| `_ai_danger_source` (:1529) | `Combat.ts:1909 aiDangerSource` | 🟡 | MED | Party rules (ignoreFleeing, last target, attack_who clearing whoHitMe) match. In the whomever_attacking_me candidate test, CE requires a path AND bad-shot ∈ {OK, NO_AMMO, OUT_OF_RANGE}; DH2 accepts bad-shot OK OR a path. The sort is inverted (AI-04). When nothing is found DH2 falls back to `findTarget` (documented, C29). |
| `_caiSetupTeamCombat` (:1708) | `Combat.ts:2830–2845` (`Combat.start` teamCombat) | ✅ | | ENGAGING for every non-dude critter; DH2 enrols every critter (C31). |
| `_caiTeamCombatInit` (:1725) | same block | ✅ | | |
| `_caiTeamCombatExit` (:1758) | — | 🚫 | | Clears statics. |
| `aiHaveAmmo` (:1765) | `Combat.ts:326 aiHaveAmmo` + `findReloadAmmo` | 🟡 | LOW | Solar Scorcher daylight > 95 % matches. DH2's helper means "loaded"; the inventory-ammo half is `findReloadAmmo`. CE's in-loop `_inven_unwield` quirk (unwields the right hand for each non-matching ammo box) is not reproduced. |
| `_caiHasWeapPrefType` (:1803) | `WEAP_PREF_ORDERINGS[...].includes` (`Combat.ts:1219`) | ✅ | | Table rows match (no_pref and unset are the same row). |
| `_ai_best_weapon` (:1817) | `Combat.ts:1293 aiBestWeapon` | ⚠️ | MED | Avg damage, blast multiplier, perk ×2, safety, hidden, flare and cost tie-break match. The override `best_weapon == -1 \|\| >= UNARMED_OVER_THROW` is applied for 'no_pref' too, because DH2 conflates -1 with 0 (AI-06). Unarmed reach is fixed at 1; CE uses `weaponGetRange(PUNCH)`, which is 2 with long limbs (LOW). |
| `_ai_can_use_weapon` (:1972) | `Combat.ts:2506 aiCanUseWeapon` / inline in `aiSearchInvenWeap:1249` | ✅ | | Arms, FRM, skill ≥ min_to_hit, pref type. |
| `_ai_search_inven_weap` (:2002) | `Combat.ts:1235 aiSearchInvenWeap` | ✅ | | Body type, AP, ammo, best_weapon fold. |
| `_ai_search_inven_armor` (:2051) | `Combat.ts:1265 aiSearchInvenArmor` | ✅ | | AC + Σ DR + DT over 7 types. |
| `aiCanUseItem` (:2105) | `Combat.ts:293 aiCanUseItem` | ✅ | | Includes CE's "needs healing" ratio. |
| `_ai_search_environ` (:2178) | `Combat.ts:2482 aiSearchEnviron` | ✅ | | Within PER+5, nearest first. DH2 skips `visible === false` items; unverified whether CE's `objectListCreate` includes hidden items. |
| `_ai_retrieve_object` (:2237) | `Combat.ts:2520 aiRetrieveObject` | ✅ | | Includes aiInfoSetLastItem for an item not reached. |
| `_ai_pick_hit_mode` (:2262) | `Combat.ts:1364 aiPickHitMode` | ⚠️ | MED | AI-05. Area-mode thresholds 85/50/95, the INT<6 / dist<10 default and the sfall range/AP checks match. |
| `_ai_move_steps_closer` (:2354) | `Combat.ts:2551 aiMoveStepsCloser` | 🟡 | LOW | stay / stay_close / ≤1 / run-at-half-AP and the friendly-fire retarget match. Missing: CE's retarget to the blocking critter (`_moveBlockObj`) when the path is blocked; DH2 tries the target's neighbour hexes instead. The 'move' taunt fires only after a successful walk (CE taunts first). |
| `_ai_move_closer` (:2450) | callers pass `AP.getAvailableMoveAP()` | ✅ | | |
| `_cai_retargetTileFromFriendlyFire` (:2456) | `Combat.ts:2625 retargetTileFromFriendlyFire` | ✅ | | Rating ≥ own, same last target, ±1 rotation of the friend's facing, nearest free tile. |
| `_cai_retargetTileFromFriendlyFireSubFunc` (:2541) | merged into the above | ✅ | | Only the first intersecting friend counts, as CE (its INT −2 has no further effect). |
| `_cai_attackWouldIntersect` (:2567) | `Combat.ts:2654 attackWouldIntersect` | 🟡 | LOW | The first-obstacle == friend test matches. CE's second test, `_combatTestIncidentalHit(attacker, defender, friend, weapon)`, is approximated by the team-wide `combatSafetyInvalidateWeapon`. For the dude, CE uses the interface hit mode; DH2 uses the equipped weapon. |
| `_ai_switch_weapons` (:2596) | `Combat.ts:2303 aiSwitchWeapons` | 🟡 | LOW | Inventory → floor → fist matches. The fist fallback uses a hard-coded 3 AP rather than `weaponGetActionPointCost(PUNCH)`, plus the free-hand punch (documented, C29). After wielding it re-checks only notEnoughAp, not the full AP-for-hitMode test (equivalent). |
| `_ai_called_shot` (:2634) | `Combat.ts:2270 aiCalledShot` | ⚠️ | LOW | INT 7/5/3 by difficulty, 1-in-called_freq, random 0..8. CE calls `_determine_to_hit(attacker, defender, hitMode, hitLocation)` with the arguments swapped against its signature `(…, hitLocation, hitMode)`, a vanilla bug. DH2 computes the real chance for that location. |
| `_ai_attack` (:2670) | `Combat.ts:2248 aiAttack` | 🟡 | LOW | No `CRITTER_MANUEVER_FLEEING → -1` guard (unreachable in practice: the flee paths end the turn). Rotate-to-target is implicit. |
| `_ai_try_attack` (:2692) | `Combat.ts:2160 aiTryAttackStep` + `:2289 aiWieldOrRetrieve` + `:1345 aiWieldInventoryWeapon` | ⚠️ | MED-HIGH | AI-01. Reload / no-ammo / out-of-range / aim-blocked / OK branches and the 10-attempt cap are present. |
| `_cAIPrepWeaponItem` (:2905) | `Combat.ts:1673` (takeThrownItem) | ✅ | | INT ≥ 3, flare, ambient < 85 %. |
| `aiAttemptWeaponReload` (:2914) | `Combat.ts:2892 combatOver`; `ui_companion.ts` (Use Best Weapon) | 🟡 | LOW | combatOver reloads silently. CE plays the READY sfx for party members (animate = 0 at combat end, so no magic hands). |
| `_combat_ai_begin` (:2945) | `this.combatants` | 🚫 | | List copy. |
| `_combat_ai_over` (:2960) | — | 🚫 | | |
| `_cai_perform_distance_prefs` (:2970) | `Combat.ts:2664 aiDistancePrefs` | ✅ | | stay_close / charge / snipe (sfall fix) plus the retarget tail. CE's `a2->ap & DAM_DEAD` typo (it tests AP bits) is not reproduced (harmless). |
| `_cai_get_min_hp` (:3036) | — | 🚫 | | Only feeds a debugPrint in `_combat_ai`. |
| `_combat_ai` (:3053) | `Combat.ts:1827 doAITurn` + `:2715 aiEndOfTurn` | 🟡 | MED | Flee test (FLEEING, hurt_too_much, HP < min_hp) matches. The flee source differs (AI-07). The tail matches except the teammate selection / find_friend (AI-08). Party distances 5/7/7/7/50000 match. |
| `_combatai_want_to_join` (:3165) | `Combat.ts:1968 wantToJoin` | ✅ | | Includes combat_p_proc fixed param 5. |
| `_combatai_want_to_stop` (:3211) | `Combat.ts:1981 wantToStop` | ✅ | | |
| `critterSetTeam` (:3232) | `scripting.ts:1210` (`critter_add_trait` OBJECT_TEAM_NUM); `party.ts:99` | ⚠️ | MED | AI-02. |
| `critterSetAiPacket` (:3280) | `scripting.ts:1207` (`aiNum = amount`) | 🟡 | LOW | Sets `aiNum` only. A cached `critter.ai.packet` mid-combat is not refreshed (unverified whether AI is rebuilt per turn). The proto update for potential party members is not done. |
| `_combatai_msg` (:3302) | `Combat.ts:1739 maybeTaunt` | ✅ FIXED (2026-10-25) | LOW | Checks (taunts pref, not dude, not dead / KO, d100 ≤ chance, end<start) match. Missing: the `delay` parameter (hit / miss lines are not delayed), groin end+1 (AI-09), packet font / colours (hard-coded `#e4d80c` / `#1c0c18`, commented as identical for every vanilla packet). |
| `_ai_print_msg` (:3381) | `Combat.ts:1756` (floatMessages check) | ✅ | | Skips when any text object is showing. DH2 checks at roll time rather than at callback time. |
| `_combat_ai_random_target` (:3411) | `Combat.ts:631 aiRandomTarget` | ✅ | | Random start, `_can_see` plus bad-shot OK. |
| `_combatai_rating` (:3449) | `whoHitMe.ts:51 combatAiRating` | 🟡 | LOW | Melee damage vs either hand's max damage matches. AC term: CE `STAT_ARMOR_CLASS` includes the unused-AP bonus outside the critter's turn; DH2 adds base AC + armor AC but not `bonusAC`. |
| `_combatai_check_retaliation` (:3484) | `whoHitMe.ts:65 combatAiCheckRetaliation` | ✅ | | |
| `isWithinPerception` (:3499) | `perception.ts:32 isWithinPerception` | ✅ | | PER×5 when seen (TRANS_GLASS → `stealthActive` /2), PER×2 / PER otherwise, sneak /4 (−1 if Sneak > 120) or ×2/3. |
| `aiMessageListInit` (:3558) | `getMessage('combatai', …)` | 🟡 | LOW | Loads combatai.msg. Unverified whether the language filter is applied to combatai lines. |
| `aiMessageListFree` (:3583) | — | 🚫 | | |
| `aiMessageListReloadIfNeeded` (:3594) | — | 🚫 | | Re-filters on a language_filter toggle; unverified in DH2. |
| `_combatai_notify_onlookers` (:3613) | `Combat.ts:1993 notifyOnlookers` | ✅ | | DH2 excludes the victim / player / dead observers (no behavioural effect). |
| `_combatai_notify_friends` (:3632) | `Combat.ts:2005 notifyFriends` | ✅ | | |
| `_combatai_delete_critter` (:3647) | — | 🚫 | | Dead critters stay in `this.combatants` and are skipped via `.dead`. |

## Detailed findings

### AI-01 — `_ai_try_attack`: weapon safety switch, safe-distance step back and failed-approach flee are missing — **FIXED 2026-10-25**
- CE: `combat_ai.cc:_ai_try_attack` (2710–2721, 2838–2843, 2881–2885)
- DH2: `src/combat/Combat.ts:2160 aiTryAttackStep`, `:2289 aiWieldOrRetrieve`
- CE behaviour:
  1. With a weapon in hand (or a punchable unarmed biped), `_combat_safety_invalidate_weapon(attacker, weapon, hitMode, defender, &safeDistance)`. If that is true, `_ai_switch_weapons`: an NPC with a rocket launcher or grenades and a team-mate near the target swaps to another weapon.
  2. `safeDistance` (the attacker standing in its own blast) is non-zero → `_ai_move_away(attacker, defender, safeDistance)` before the OK-branch attack.
  3. In the min_to_hit approach, if `_ai_move_steps_closer` returns -1 → "FLEEING: Can't possibly get closer" → `_ai_run_away`, return.
- DH2 behaviour: `aiWieldOrRetrieve` returns 'retry' whenever a real weapon is in hand, so the safety check never runs on the held weapon. `combatSafetyInvalidateWeapon` is used only in `aiBestWeapon` / `aiPickHitMode`, and its own comment says DH2 doesn't step back. In the OK branch a failed move (`steps > 0 && aiMoveStepsCloser(...)` false) falls through to `aiAttack`.
- Impact: NPCs fire explosives into their own allies or into their own blast radius more than in CE. A critter that cannot approach to a viable to-hit attacks at low odds instead of fleeing.
- Suggested fix: on the first try-attack step, when a real weapon is held, call `combatSafetyInvalidateWeapon(..., withSafeDistance=true)` and, if it is unsafe, `aiSwitchWeapons`. Compute safeDistance (the damage radius when the attacker is inside it) and call `aiMoveAway(obj, target, safeDistance)` before attacking. On a failed approach move, call `aiRunAway` instead of attacking.
- known_bugs: NEW. The no-step-back part is only noted in a code comment.

### AI-02 — `critterSetTeam` side effects missing — **FIXED 2026-10-25**
- CE: `combat_ai.cc:critterSetTeam`; `interpreter_extra.cc:2898 opCritterAddTrait` (OBJECT_TEAM)
- DH2: `src/scripting.ts:1210`
- CE behaviour: the opcode ignores party members and same-value writes, and does nothing while loading. `critterSetTeam` sets the team, clears `whoHitMe` if that critter is now on the same team, clears `aiInfoSetLastTarget`, and re-outlines in combat.
- DH2 behaviour: `if (loadingGame) return; teamNum = amount`. It has no party-member guard, no whoHitMe or last-target clearing, and no same-value skip.
- Impact: when a script pacifies an attacker by moving it onto the player's team (common in F2 scripts, e.g. `set_team` after a surrender), it keeps `whoHitMe = player`. `aiDangerSource` returns a live whoHitMe regardless of team, so it keeps attacking. `shouldEnd` sees a same-team whoHitMe and combat may not end. A script setting a party member's team breaks companions where CE ignores it.
- Suggested fix: add a `critterSetTeam(c, team)` helper in `whoHitMe.ts` mirroring CE and call it from `critter_add_trait` and `party.ts`, with the party-member and same-value guards in the opcode.
- known_bugs: NEW.

### AI-03 — `aiFindAttackers` ignores dead team-mates — **FIXED 2026-10-25**
- CE: `combat_ai.cc:aiFindAttackers` (1495–1507)
- DH2: `src/combat/Combat.ts:1947`
- CE behaviour: the whoHitFriend slot only requires `candidate.team == team`. A dead candidate is allowed, provided its whoHitMe is alive and on another team.
- DH2 behaviour: `if (c === obj || c.dead) continue` runs before all three slot tests.
- Impact: an NPC whose friend was killed does not target the killer through this path. It relies on its own whoHitMe or DH2's `findTarget` fallback, which picks the nearest enemy instead.
- Suggested fix: apply the dead check only to slots 1 and 3.
- known_bugs: NEW.

### AI-04 — strongest / weakest sorting is inverted relative to CE — **FIXED 2026-10-25**
- CE: `_compare_strength` (ascending, so "strongest" puts the weakest first), `_compare_weakness` (descending). Used in `_ai_danger_source` (1678–1691).
- DH2: `Combat.ts:1954–1955` (and `findTarget` 1777–1782)
- Impact: companions set to "Attack strongest" or "Attack weakest" pick the opposite target from CE / vanilla. This is a vanilla oddity: CE keeps it and its comments call the functions "melee then ranged" / "ranged then melee".
- Suggested fix: decide on a policy. For CE fidelity, swap the comparators. Either way, document it in `wiki/ai_behavior.md`.
- known_bugs: NEW.

### AI-05 — `_ai_pick_hit_mode` preference type and throw guard — **FIXED 2026-10-25**
- CE: `combat_ai.cc:_ai_pick_hit_mode` (2272–2348)
- DH2: `Combat.ts:1364 aiPickHitMode`
- CE behaviour:
  1. `_caiHasWeapPrefType(ai, attackType)` with `attackType` = the **secondary** mode's attack type.
  2. `_ai_can_use_weapon(attacker, weapon, SECONDARY)`: arms, FRM, skill vs min_to_hit, pref type.
  3. Final gate: `attackType != THROW || _ai_search_inven_weap(...) != nullptr || statRoll(INT) <= 1`. A throw secondary is used only if another weapon exists, or on a failed INT roll.
- DH2 behaviour: (1) checks `prefs.includes('ranged')`, so a ranged-only packet with a spear throws it and a melee packet with a knife never does. (2) checks the FRM only. (3) is missing.
- Impact: NPCs throw away their only melee weapon more readily than in CE.
- Suggested fix: use `weaponAttackType` for mode 2, run full `aiCanUseWeapon` for the secondary, and add the throw guard (`aiSearchInvenWeap(obj, target, false)` or `statRoll(INT) <= 1`).
- known_bugs: NEW.

### AI-06 — `_ai_best_weapon` damage override applied to explicit no_pref — **FIXED 2026-10-25**
- CE: `combat_ai.cc:1963`, condition `ai->best_weapon == -1 || ai->best_weapon >= BEST_WEAPON_UNARMED_OVER_THROW`
- DH2: `Combat.ts:1334`, `best === 'no_pref' || best === 'unarmed_over_throw'`
- CE behaviour: only an unset best_weapon (-1) and unarmed_over_throw (6) let a >5 avg-damage gap override the preference order. An explicit `no_pref` (0) uses the order (ranged > throw > melee > unarmed).
- DH2 behaviour: DH2 maps both -1 and 'no_pref' to 'no_pref', so both get the override.
- Impact: packets with `best_weapon=no_pref` (common in ai.txt) prefer a stronger melee weapon over a weaker gun, where CE prefers the gun.
- Suggested fix: keep an "unset" distinction in `aiPackets.ts`, e.g. `bestWeaponUnset: boolean` or a distinct `'unset'` value sharing the no_pref ordering row.
- known_bugs: NEW.

### AI-07 — the flee source in `_combat_ai` — **FIXED 2026-10-25**
- CE: `combat_ai.cc:3075–3081`, `_ai_run_away(a1, a2)` where `a2` is the caller's argument. `combat.cc` normally passes the gcsd defender or null, and null → gDude inside `_ai_run_away`.
- DH2: `Combat.ts:1860–1869`, which first computes `st.target = aiDangerSource(obj)` and flees from it
- Impact: in CE a hurt NPC (including a companion) runs from the player's position, and `max_dist` is measured to the player. In DH2 it runs from its enemy, which is more sensible but not CE. The decision between FLEEING and DISENGAGING (distance < max_dist) also changes.
- Suggested fix: pass the turn's incoming `a2` (gcsd defender or null) to `aiRunAway`, or record this as a deliberate deviation.
- known_bugs: NEW (C28 says "away from the threat", which is not exactly CE).

### AI-08 — `_combat_ai` tail: teammate choice and `_ai_find_friend` — **FIXED 2026-10-25**
- CE: `_ai_find_nearest_team_in_combat` (it needs `whoHitMe != null`) for team ≠ 0; `_ai_find_friend` never moves, because the step count `distance − 5` is computed only when `5 > distance`
- DH2: `Combat.ts:2731–2738`, `:2771` (`nearestOfTeamExcept`, no whoHitMe filter; moves `d−5` toward the friend)
- Impact: DH2 NPCs that are out of range of their target regroup on idle or non-fighting team-mates, and close in on friends in step 1. CE NPCs either just disengage or stay.
- Suggested fix: add a `whoHitMe` filter to the step-4 teammate selection, and drop the move in step 1, returning false after confirming a friend within PER×2.
- known_bugs: NEW. Severity LOW-MED.

### AI-09 — ai.txt parsing details (LOW, listed for completeness) — **FIXED 2026-10-25**
- `aiPackets.ts` numeric maps follow no CE enum order: `ATTACK_WHO_MAP` = whomever, closest, … where CE is whomever_attacking_me, strongest, weakest, whomever, closest. `DISTANCE_MAP` starts at on_your_own where CE is stay_close, charge, snipe, on_your_own, stay. `RUN_AWAY_MODE_MAP` and `AREA_ATTACK_MODE_MAP` differ the same way. They are reached only with numeric values, which vanilla ai.txt does not use.
- Missing-key defaults are 'closest', 'on_your_own' and chance 85; CE uses -1 or aborts.
- `hit_groin_end` is not incremented (CE `aiInit:446`).
- **Fixed 2026-10-25:** the numeric fallbacks follow CE's enum order (−1 = the fallback); `hit_groin_end` is incremented as in `aiInit`. Missing-key defaults stay DH2's (CE aborts loading ai.txt).

### AI-10 — dead helper `fleeHpThreshold` (LOW) — **FIXED 2026-10-25**
- `src/combat/AI.ts:43–55` exports `HP_FLEE_PCT` / `fleeHpThreshold` (HP% = pct of max). It is imported in `Combat.ts:42` but never called. It encodes the "inverted percentage" model that C28 replaced, so it is misleading. Delete it or mark it obsolete.
- **Fixed 2026-10-25:** `HP_FLEE_PCT` / `fleeHpThreshold` removed.

## DH2-only behaviour

- **Target fallback**: `aiDangerSource(..., fallback=true)` → `findTarget` (the nearest / attack_who-sorted perceived enemy) when CE's danger source is null. Documented as kept on purpose in C29 / `wiki/ai_behavior.md` §10. It makes non-provoked NPCs in combat attack anyone hostile they perceive.
- **Free-hand punch**: when no weapon switch is possible, DH2 switches the active hand to a fist for the turn (documented, C29).
- **Async phase machine**: `doAITurn` re-enters per animation with `AiTurnState` and a `Config.combat.maxAIDepth` recursion bail-out. CE runs synchronously with `_combat_turn_run`.
- **Custom AI overrides** are stored per critter (`customAiOverrides`) instead of mutating the shared CUSTOM packet. Disposition switching is by packet name.
- **Bystander friendlyDead step**: in `nextTurn`, non-hostile critters still move away from a friend who died unseen (CE runs this inside `_combat_ai` for combatants only).
- **Neutral blue outline** (`refreshHighlights`), not CE (documented CI11).
- **Hard-coded taunt colours** instead of the ai.txt font / colour fields.
- **Event log / dbg instrumentation** (`eventLogPush` 'ai-decision').
