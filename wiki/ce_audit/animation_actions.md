# CE parity audit — animation & actions (animation.cc, actions.cc)

Scope: fallout2-ce `src/animation.cc` (reg_anim sequences, path finding, straight paths, walk/run,
idle fidget, stand / stand-up, ticks per frame) and `src/actions.cc` (attack animation sequences,
knockback, death animation choice, use / pick up / loot / skill / talk / push / ladder,
explosions, script damage), compared with DH2 `src/**/*.ts`. Audited 2026-10-24.

DH2 has no animation-sequence registry. It plays each step with
`Critter.staticAnimation` / `walkTo` callbacks. Script `reg_anim_*` calls go into a small batch
queue in `src/scripting.ts`. Many CE registry internals (slots, priority, sads, ping) are
therefore 🚫 N/A. They are judged by the behaviour they produce, not by their structure.

## Summary

| Status | Count |
|---|---|
| ✅ MATCH | 37 |
| ⚠️ DIFFERS | 17 |
| 🟡 PARTIAL | 18 |
| ❌ MISSING | 7 |
| 🚫 N/A | 13 |

(Rows; several rows group 2–4 trivially related CE functions.)

Top findings:
- **ACT-01 (HIGH, NEW):** `critter_dmg` is not CE `actionDamage`. DT/DR is never subtracted. The
  0x100 (bypass armour) and 0x200 (no animation) flags are ignored. The damage type is a number
  that DH2 reads as a string name, so every scripted death uses the *Normal* max-blood anim.
  There is no `_combat_display` line, and the source is `self_obj`, not CE's hidden dummy attacker.
- **ACT-02 (HIGH, NEW):** in combat, using scenery, picking up an item, looting a corpse, or
  using a skill or a non-target action walks there **with no AP limit and no AP cost**. The click
  is not even checked for the player's turn (`playerUse.ts:424` → `walkInFrontOf`). CE moves with
  the critter's AP (`animationRegisterMoveToObject(..., ap)`) and charges 3 AP
  (`_check_scenery_ap_cost`) for use / pickup / loot.
- **ANIM-01 (MED, NEW):** `reg_anim_end` runs every step one after another and treats `delay`
  as 100 ms units. In CE, delay 0 starts the step together with the previous one, −1 waits for
  it to finish, and N waits N animation frames. Scripted multi-object sequences (two critters
  animating at once, a sound on a given frame) play one after another in DH2.
- **ACT-04 (MED, NEW):** the `actionExplode` port (`Obj.explode`) lacks `_report_explosion`.
  A player's dynamite or plastic-explosive kill gives no XP, survivors get no `who_hit_me`, and
  no combat starts. The death animation comes from `_pick_death`, where CE forces
  `ANIM_EXPLODED_TO_NOTHING` (max blood) or else a fall. There is no `_action_in_explode` guard.
- **ACT-05 (MED, NEW):** ranged attacks skip `ANIM_POINT` / `ANIM_UNPOINT` (raising and lowering
  the gun, `Xh` / `Xi`). The firing FRM starts at once and the critter snaps back to idle.
- **ANIM-02 (MED, NEW):** walking never checks the next hex for a blocker, and never re-paths
  or stops as CE `_object_move` does. A critter that steps into the path after it was planned is
  walked through. In combat, AP is taken for the whole path up front rather than hex by hex.
- **ANIM-03 (MED, NEW):** the run rules differ from `animationRegisterRunTo*`. A sneaking player
  sent to an object more than 5 hexes away *runs and loses Sneak* (DH2 applies `_dude_run`'s rule
  to every run). CE walks and keeps sneaking. Encumbered critters still run, and there is no
  misc.msg 8000/8001 "overloaded" message (`reportOverloaded` is missing).
- **ACT-06 (MED, NEW):** `Obj.pickup` runs `pickup_p_proc` and the carry-weight check *before*
  walking to the item. CE walks first and calls `_obj_pickup` on the action frame of
  `ANIM_MAGIC_HANDS_GROUND`.
- **ACT-07 (MED/LOW, NEW):** ladders. DH2 plays the climb animation (`ae`) for both ladder
  types after a walk to any adjacent hex. CE calls `_action_climb_ladder` only for
  `SCENERY_TYPE_LADDER_UP`, walking to the hex SE of the ladder and putting the weapon away first.
  A ladder going down uses the normal magic-hands use.
- Faithful ports: the path finder (`pathfinder.ts`), the straight-path Bresenham (`GameMap.ts`),
  `_pick_death` / `_check_death` / `_pick_fall` / `_action_blood`, the knock-down and fire-dance
  branches of `_show_damage_to_object`, `_compute_explosion_damage`, `_is_hit_from_front`,
  `_can_see`, `_dude_stand` offsets, `_dude_standup`, and `animationComputeTicksPerFrame`.

## Function table

### actions.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| `actionKnockdown` (actions.cc:102) | `actionKnockdown` src/critter/lifecycle.ts:278 | ✅ FIXED (2026-10-25) | LOW | Distance loop, exit-grid stop, the extra `distance--`, the FALL_FRONT→FALL_BACK art fallback, the KNOCKDOWN sfx and the 20-hex cap all match. The slide (`moveStraight`, lifecycle.ts:257) moves one *hex* per frame. CE `_make_straight_path(..., 4)` makes a node every 4 screen pixels, one per tick, so the DH2 slide is ~4–8× faster (ANIM-05). |
| `_action_blood` (:157) | `bloodAnim` src/critter/deathAnim.ts:217 | ✅ | — | |
| `_pick_death` (:183) | `pickDeath` deathAnim.ts:140 | ✅ | — | Thresholds, Molotov, Pyromaniac, Flameboy, SPECIAL_DEATH, Bloody Mess and the tables all match. |
| `_check_death` (:260) | `checkDeath` deathAnim.ts:124 | ✅ | — | |
| `_internal_destroy` (:284) | `attackerWeaponEffects` src/combat/Combat.ts:1006 | ✅ | — | DAM_DESTROY removes the weapon. |
| `_show_damage_to_object` (:292) | `critterKill` lifecycle.ts:71 + `critterDamage` lifecycle.ts:332 | ✅ FIXED (ACT-04) | MED | The death branch (knockback fall, DIE sfx + `_pick_fall` + blood, fire dance with exit-grid / straight-path search, BURNED_TO_NOTHING), the knock-down branch, alive-on-fire, knockback + get-up, and HIT_FROM_FRONT/BACK all match. Missing: the special attackers (explosion fid misc 10 → EXPLODED_TO_NOTHING, ACT-04; pid 0x20001EB → ELECTRIFIED_TO_NOTHING). The hit reaction is skipped when the critter is busy (`if (obj.inAnim()) return`, :394), where CE `reg_anim_clear`s it first. Weapon EXPLODE/DROP side effects are only done for the attacker (Combat.ts:1006). |
| `_show_death` (:471) | `finalizeCallback` lifecycle.ts:103 | ✅ | — | Drop-all for anims 30/31 unless SPECIAL_DEATH / NO_DROP. NO_BLOCK comes from `blocks()` being false when dead. Outline cleared. CE's `anim < 48 && anim > 63` SF swap is dead code. |
| `_show_damage_extras` (:510) | `applyDamage` extras loop Combat.ts:985 | ⚠️ | LOW | Knockback rotation: DH2 `hexDirectionTo(explosionTile, critter)` (:990). CE `tileGetRotationTo(attacker->tile, obj->tile)`, so a grenade's extras fly away from the *thrower*. The two are the same only for `actionExplode`. |
| `_show_damage` (:530) | `resolveAttack` / `applyDamage` Combat.ts:882,951 | 🟡 | LOW | Same order: attacker crit-failure / backwash, defender, then DUD. All reactions fire on the impact instead of on CE's ping-synchronised sequences. |
| `_action_attack` (:573) | `Combat.attack` Combat.ts:780 | 🟡 | LOW | Melee/ranged split by anim ✓. CE `reg_anim_clear`s attacker, defender and extras (fails with −2 when prioritised). DH2 does not clear, so a busy defender skips its hit anim. |
| `_action_melee` (:598) | `attack` + `resolveAttack` Combat.ts:780–946 | 🟡 | LOW | Rotate to target ✓. Weapon ATTACK sfx at frame 0, HIT sfx / CONTACT on the action frame ✓. Unarmed char sfx ✓. Dodge only when the defender is not prone and has dodge art ✓, but DH2 also needs `!inAnim()` and ignores the dodge-vs-attack action-frame alignment (`dodgeDelay`). Taunts: attacker hit/miss ✓ (C33). |
| `_action_ranged` (:692) | `attack` / `resolveAttack` / `flyProjectile` / `takeThrownItem` Combat.ts | ✅ FIXED (ACT-05) | MED | Projectile only on hit or a non-critical miss ✓. Origin hex, 32-px nodes, ammo-flying ✓. Thrown item removed/replaced ✓, flare lit ✓. Missing: **ANIM_POINT before / ANIM_UNPOINT after** (ACT-05). The explosion is one `misc 14` sprite at the centre; CE uses frm 29 (grenade) / 31 (plasma) / 2 (EMP) / 10 (rocket) at the centre plus the six adjacent hexes (NE delayed 2/4). No ANIM_TAKE_OUT of the replacement weapon after a throw. A ranged miss plays `cmbtflx`, where CE plays the weapon's HIT sfx (material 'X'/'F'). Defender taunt hit/miss ✓. |
| `_is_next_to` (:988) | inline `hexDistance <= 1` checks (useItemOn.ts:91, playerUse.ts:203) | ✅ FIXED (2026-10-26) | LOW | The failure text is hard-coded "Can't reach that." instead of misc.msg 2000 ("You cannot get there."). — **2026-10-26:** misc.msg 2000 "You cannot get there.". |
| `_action_climb_ladder` (:1006) | `Obj.use` isLadder branch src/object/Obj.ts:1236 | ✅ FIXED (ACT-07) | MED | ACT-07. |
| `_action_use_an_item_on_object` (:1063) | `usePendingItemOn` src/useItemOn.ts:67; ui_contextmenu.ts:103 `use` | ✅ FIXED (ACT-02) | MED | Walk to an adjacent hex ✓. Item-on-object in combat walks with move AP and costs 2 AP (itemGetActionPointCost) ✓. Missing: the run rule (≥ 5 hexes out of combat → run; DH2 uses `doAlwaysRun`). Missing: weapon PUT_AWAY / TAKE_OUT around the use, MAGIC_HANDS_GROUND (prone critter or scenery ext flag 0x01) vs MIDDLE before `_obj_use` (DH2 plays `al` concurrently, Obj.ts:1214), and the 3-AP scenery cost for a plain use (ACT-02). |
| `_action_use_an_object` (:1151) | `playerUse` callback → `obj.use` playerUse.ts:417 | ✅ FIXED (ACT-02) | HIGH | No AP gating in combat (ACT-02). Animation as above. |
| `actionPickUp` (:1157) | `Obj.pickup` Obj.ts:1348 | ✅ FIXED (ACT-06) | MED | ACT-06. Also: the pickup sfx is `ipickup1` (CE: `artCopyFileName(item fid)` on the action frame); no AP in combat; the container branch (open via `_obj_use_container` + `scriptsRequestLooting`) goes through `use` instead. |
| `_action_loot_container` (:1257) | `uiLootWalk` ui_contextmenu.ts:164; playerUse.ts:410 | ✅ FIXED (ACT-02) | MED | Walk then loot ✓, NO_STEAL ✓ (context menu only; the plain left-click on a corpse at playerUse.ts:410 skips it). No AP / 3-AP cost in combat (ACT-02). Run threshold differs (walkInFrontOf: distance to the stop hex > 5, CE: ≥ 5 to the target). |
| `_action_skill_use` (:1295) | `skillUse` Sneak branch src/skillUse.ts:344 | ✅ | — | dudeToggleState(SNEAKING). |
| `_action_use_skill_in_combat_error` (:1309) | playerUse.ts:192 | ✅ | — | proto.msg 902. |
| `actionUseSkill` (:1325) | `playerUse` useSkill branch playerUse.ts:178, `skillPerformer` :76 | 🟡 | LOW | Non-combat skills ✓. Performer choice and party lines (skill.msg 1000/1100) ✓, Steal by the dude only ✓. Missing: the target-type gates (First Aid/Doctor → critters; Lockpick → items/scenery; Steal → item/critter, not self; Traps → not critters; Science/Repair → only robots, Repair also brahmin, before any walk). DH2 walks first and then lets `skillUse` print a message. Missing: the MAGIC_HANDS anim before `_obj_use_skill_on`. The run rule for the dude uses `doAlwaysRun`, where CE runs at ≥ 5 hexes. |
| `_is_hit_from_front` (:1512) | Combat.ts:148, lifecycle.ts:323 | ✅ | — | abs(rot diff) ∉ {0,1,5}. |
| `_can_see` (:1523) | `canSee` src/perception.ts:25 | ✅ | — | |
| `_pick_fall` (:1537) | `pickFall` deathAnim.ts:204 | ✅ | — | `blocks()` stands in for `_obj_blocking_at`. |
| `_action_explode_running` (:1575) | — | ✅ FIXED (2026-10-26) | LOW | No re-entrancy guard. CE returns −2 and `queue.cc` re-queues the explosion. — **2026-10-26:** an animated explosion refuses a second one (Obj.explode → false); the timed explosive re-queues 50 ticks on. |
| `actionExplode` (:1582) | `Obj.explode` / `explosionBlast` Obj.ts:1281,1318 | ✅ FIXED (ACT-04) | MED | Sprites on the centre and 6 neighbours ✓, `whn1xxx1` ✓, main critter + ring extras ✓, damage ✓, `_scr_explode_scenery` ✓, the `animate=false` path ✓. Damage starts only after the centre sprite has finished (CE: concurrent). See ACT-04. |
| `_report_explosion` (:1727) | — | ✅ FIXED (ACT-04) | MED | ACT-04: no `_combat_display`, no XP for the dude source, no `who_hit_me`, no `scriptsRequestCombat` for survivors. |
| `_finished_explosion` (:1803) | — | 🚫 | — | Guard flag (see above). |
| `_compute_explosion_damage` (:1811) | `computeExplosionDamage` src/combat/explosion.ts:77 | ✅ | — | Armour DT/DR are added the way `critterGetStat` sums them. |
| `actionTalk` (:1832) | input.ts:452, ui_contextmenu.ts:94, playerUse.ts:396 | ✅ FIXED (2026-10-26) | LOW | DH2 always walks next to the NPC. CE moves only when ≥ 9 hexes away or the shot is blocked (then *runs*), and talks from range otherwise. Deliberate, known_bugs P15. — **2026-10-26:** as an option: `[dh2] talk_mode=ce` talks within 9 hexes in line of sight (talkApproach.ts); the default walks up. |
| `_can_talk_to` (:1864) | — | ❌ | LOW | No post-move recheck / misc.msg 2000. |
| `_talk_to` (:1883) | `Scripting.talk` | ✅ | — | |
| `actionDamage` (:1890) | `critter_dmg` src/scripting.ts:1657 | ✅ FIXED (ACT-01) | HIGH | ACT-01. |
| `_report_dmg` (:1959) | — | ✅ FIXED (ACT-01) | MED | No `_combat_display` for script damage (part of ACT-01). |
| `_compute_dmg_damage` (:1971) | — | ✅ FIXED (ACT-01) | HIGH | No DT/DR by type (part of ACT-01). CE's inverted NO_KNOCKBACK test means script damage never knocks back; DH2 matches that by accident. |
| `actionCheckPush` (:1996) | `actionCheckPush` ui_contextmenu.ts:175 | ⚠️ | LOW | `_action_can_talk_to` is reduced to a ≤ 12 distance check. CE also needs a sight-blocking path (`pathfinderFindPath(..., _obj_sight_blocking_at)`). |
| `actionPush` (:2040) | `actionPush` ui_contextmenu.ts:190 | ⚠️ | LOW | push_p_proc + override ✓, rotation order 0,1,5,2,4,3 ✓. In combat CE moves the target with its own AP; DH2 `walkTo` with no AP. |
| `_action_can_talk_to` (:2116) | inside actionCheckPush | 🟡 | LOW | See above. |
| `hideProjectile` (:2129) | `flyProjectile` destroy Combat.ts:1631 | 🚫 | — | CE crash workaround; DH2 destroys the projectile object. |

### animation.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| `animationInit` / `animationReset` / `animationExit` (animation.cc:324–349) | — | 🚫 | — | No registry. |
| `reg_anim_begin` (:356) | `Script.reg_anim_begin` scripting.ts:2887 | 🟡 | LOW | Starts a batch. No reserved / insignificant / NO_STAND flags. A nested begin is not refused (CE −1). |
| `_anim_free_slot` / `_register_priority` (:394,423) | — | 🚫 | — | 32-slot and priority bookkeeping. |
| `reg_anim_clear` (:439) | `Script.reg_anim_clear` scripting.ts:2892 | ✅ | — | Drops the object's queued steps and `clearAnim`s it. CE's −2 for a prioritised (combat) sequence has no equivalent. |
| `reg_anim_end` (:474) | `Script.reg_anim_end` scripting.ts:2926 | ✅ FIXED (ANIM-01) | MED | ANIM-01. |
| `_anim_preload` / `_anim_cleanup` (:504,518) | `playAnimId` / `hasAnimation` | 🟡 | LOW | CE drops the *whole* sequence when any step's art is missing. DH2 skips or plays per step. |
| `_check_registry` (:544) | `regAnimPush` scripting.ts:2899 | ✅ | — | Outside begin…end a step does nothing. In combat it does nothing (opRegAnim*). |
| `animationIsBusy` (:581) | `anim_busy` → `obj.inAnim()` scripting.ts:1947 | ✅ | LOW | CE ignores a lone ANIM_STAND step and callbacks. Close enough. |
| `animationRegisterMoveToObject` (:613) | AnimMove step → `walkTo(hexNearestNeighbor)` scripting.ts:2945 | 🟡 | LOW | CE paths onto the object's tile (destination hidden) and drops the last step (2 for multihex). DH2 walks to the nearest neighbour hex of the destination as seen from the mover. That can be a different hex when the nearest neighbour is not on the path side. |
| `animationRegisterRunToObject` (:646) | same, `run: true`; `walkInFrontOf` Critter.ts:481 | ✅ FIXED (ANIM-03) | MED | ANIM-03 (sneak, encumbrance, overloaded message). Crippled legs → walk ✓, no run art → walk ✓. |
| `animationRegisterMoveToTile` (:694) | AnimMove step; `walkTo` Critter.ts:409 | ⚠️ | LOW | CE `_anim_move(a5 = 0)` paths onto an *occupied* goal and stops one short (animateMoveObjectToTile). DH2 `recalcPath(goal must be free)` finds no path, so a script move to an occupied tile does nothing. |
| `animationRegisterRunToTile` (:728) | same, `run: true` | ✅ FIXED (ANIM-03) | MED | ANIM-03. |
| `animationRegisterMoveToTileStraight` (:778) | `moveStraight` lifecycle.ts:257 | ✅ FIXED (2026-10-25) | LOW | ANIM-05 (slide speed). |
| `animationRegisterMoveToTileStraightAndWaitForComplete` (:813) | `moveStraight` (waits for anim + slide) | ✅ FIXED (2026-10-25) | LOW | Waits for both ✓. Speed as ANIM-05. |
| `animationRegisterAnimate` (:847) | AnimStep / `staticAnimation('anim:'+id)` | ✅ | — | |
| `animationRegisterAnimateReversed` (:875) | AnimStep `reversed` | ✅ | — | |
| `animationRegisterAnimateAndHide` (:904) | explosion sprites `singleAnimation` + `destroyObject` (Obj.ts:1301) | ✅ | — | |
| `animationRegisterRotateToTile` (:933) | `obj.orientation = …` (Combat.ts:790, lifecycle fire dance) | ✅ | — | Inline; prone check missing (LOW). |
| `animationRegisterRotateClockwise` / `CounterClockwise` (:954,974) | context-menu rotate ui_contextmenu.ts:119 | ✅ | — | |
| `animationRegisterHideObject` / `HideObjectForced` (:996,1016) | `destroyObject` calls | ✅ | — | |
| `animationRegisterCallback` / `Callback3` / `CallbackForced` (:1036–1085) | JS closures | ✅ | — | CE runs "forced" callbacks even when a sequence aborts. DH2 sequences cannot abort, so this does not arise. |
| `animationRegisterSetFlag` / `UnsetFlag` (:1114,1139) | — | 🚫 | — | Used for hidden / lighting toggles inside CE sequences only. |
| `animationRegisterSetFid` (:1160) | `clearAnim` / `setIdleArt` | 🚫 | — | |
| `animationRegisterTakeOutWeapon` (:1186) | `playWeaponSwapAnim` critterAnimation.ts:670 | ✅ | LOW | Swap ✓ with the TAKE_OUT sfx. Not used after use / climb / throw (CE re-draws the weapon after each). |
| `animationRegisterSetLightDistance` / `SetLightIntensity` (:1220,3311) | — | 🚫 | — | Only the sfall `ExplosionsEmitLight` option (off by default). |
| `animationRegisterToggleOutline` (:1243) | — | 🚫 | — | |
| `animationRegisterPlaySoundEffect` (:1264) | `reg_anim_play_sfx` scripting.ts:2573; `playCharAnimSfx` | ✅ FIXED (2026-10-25) | LOW | Delay unit differs (ANIM-01). |
| `animationRegisterAnimateForever` (:1296) | AnimForever step scripting.ts:2960 | ✅ | — | |
| `animationRegisterPing` (:1324) | — | 🚫 | — | Cross-sequence sync. |
| `animationRunSequence` / `_anim_set_continue` / `_anim_set_end` (:1352–1663) | `doStep` scripting.ts:2936 | ✅ FIXED (ANIM-01) | MED | ANIM-01. The final `_dude_stand` of every critter owner unless NO_STAND matches `clearAnim` ✓. |
| `canUseDoor` (:1667) | `canUseDoor` src/map/pathfinder.ts:25 | ✅ | — | Biped / robotic, unlocked, not a gecko; the dude only through walk-thru portals. |
| `_make_path` / `pathfinderFindPath` (:1709,1716) | `pathfinderFindPath` pathfinder.ts:91, `GameMap.recalcPath` GameMap.ts:675 | ✅ | — | Literal port: 50 per step, +10 for a turn out of combat, goo +400 / +100 for geckos, 2000 open/closed nodes, 800 steps, a5 goal check, no re-opening. |
| `_idist` / `_tile_idistance` (:1911,1929) | `idist` pathfinder.ts:39 | ✅ | — | |
| `_make_straight_path` / `_make_straight_path_func` (:1943,1951) | `straightPathObstacle` GameMap.ts:595; `straightPathNodes` Combat.ts:1568 | ✅ | — | Start-tile check, SHOOT_THRU for a6 = 32, loop-end order ✓. |
| `animateMoveObjectToObject` (:2140) | see MoveToObject | 🟡 | LOW | AP truncation: `walkTo(maxLength)` callers. |
| `_make_stair_path` / `_anim_move_on_stairs` / `_check_for_falling` / `_check_gravity` (:2180,2463,2494,3270) | — | 🚫 | — | No `animationRegister*` creates these kinds in CE (dead code). |
| `animateMoveObjectToTile` / `_anim_move` (:2359,2384) | `walkTo` Critter.ts:409 | 🟡 | LOW | See MoveToTile (occupied goal). |
| `animateMoveObjectToTileStraight` (:2421) | `moveStraight`, `flyProjectile` | ✅ FIXED (2026-10-25) | LOW | Projectiles: 32-px nodes ✓. Critters: 4-px nodes not ported (ANIM-05). |
| `_object_move` (:2529) | `walkFrameCE` critterAnimation.ts:511, `Critter.move` Critter.ts:270 | ✅ FIXED (ANIM-02) | MED | Per-frame FRM deltas and hex-step crossing ✓ (FA13). Doors opened via canUseDoor ✓. Missing: the blocker check on the next hex with re-path (`_make_path(..., 1)`) or stop, and the per-hex AP charge with a stop at 0 AP (DH2 charges the path up front). ANIM-02. |
| `_object_straight_move` (:2650) | `moveStraight` / `flyProjectile` updateAnim | ✅ | LOW | WAIT_FOR_COMPLETION ✓. |
| `_anim_animate` (:2705) | `staticAnimation` critterAnimation.ts:581 | ✅ | — | Missing art → no play ✓. |
| `_object_animate` (:2740) | `updateAnim` / `updateStaticAnim` critterAnimation.ts:283,365 | ✅ | — | Forward / reverse, action frame (FA3). |
| `_object_anim_compact` (:2908) | — | 🚫 | — | |
| `_check_move` (:2942) | — | 🟡 PARTLY FIXED (2026-10-26) | LOW | Ctrl+move in combat (keep AP for one attack) and `interrupt_walk`. — **2026-10-26:** Ctrl+move in combat keeps the AP of one attack in the current mode; `interrupt_walk` is not ported. |
| `_dude_move` / `_dude_run` (:2976,3000) | playerUse.ts:233–268, input.ts:481 `runTo` | ✅ FIXED (2026-10-26) | LOW | Walk ✓, run key ✓, run cancels Sneak without Silent Running ✓. Clicking the same destination twice does not run. — **2026-10-26:** a second walk click on the same tile runs (lastDestination); the combat walk no longer falls through to an unlimited walk. |
| `_dude_fidget` (:3019) | `updateLoopingAnim` critterAnimation.ts:332 | ✅ FIXED (2026-10-25) | LOW | ANIM-04. |
| `_dude_stand` (:3113) | `clearAnim` + `ceStandOffset` critterAnimation.ts:698,765 | ✅ | — | Take-out sum + stand rotation offset ✓. CE keeps a fire-dance fid (rare). |
| `_dude_standup` (:3182) | `dudeStandup` src/combat/results.ts:133 | ✅ | — | |
| `actionRotate` (:3199) | context-menu rotate | ✅ | — | No prone check (LOW). |
| `_anim_hide` / `_anim_change_fid` (:3220,3236) | — | 🚫 | — | |
| `animationStop` (:3256) | — | 🚫 | — | unverified: DH2 drops pending callbacks on map change through object teardown. |
| `animationComputeTicksPerFrame` (:3287) | critterAnimation.ts:404 | ✅ | — | Combat walk + combat_speed, the dude only with player_speedup. |
| `reportOverloaded` (:3332) | — | ✅ FIXED (2026-10-25) | LOW | Part of ANIM-03. |

## Detailed findings

### ACT-01 — `critter_dmg` is not `actionDamage` (HIGH, NEW) — **FIXED 2026-10-24 (PA10)**
- **CE:** `interpreter_extra.cc opCritterDamage` → `actions.cc actionDamage`, `_compute_dmg_damage`, `_report_dmg`.
- **DH2:** `src/scripting.ts:1657 critter_dmg` → `critterDamage(obj, damage, self_obj, …, damageType, …, { scriptDamage: true })`.
- **CE behaviour:**
  - The third argument is an *integer*: the damage type, plus 0x100 = bypass armour and 0x200 = no animation.
  - The damage is `d(amount, amount) − DT[type]`, then `− DR[type]%` (unless bypass), floored at 0.
  - The attacker is a hidden dummy object (fid 0x20001F5). The animated death is
    `_check_death(gMaximumBloodDeathAnimations[type], MAX_BLOOD)`.
  - `_combat_display` prints the damage line and `_apply_damage` applies it.
  - `whoHitMe` is reset when `whoHitMeCid == -1`.
- **DH2 behaviour:**
  - The number is typed as `string` and passed on as the damage-type *name*.
    `damageTypeIndex(5)` → `DAMAGE_TYPE_INDEX[5]` is undefined → 0 (Normal). Every scripted
    death therefore uses `ANIM_CHUNKS_OF_FLESH` (or falls back), never fire dance, melt or
    electrify.
  - DT/DR are never subtracted, and the 0x100 / 0x200 flags are ignored (always animated).
  - The source is `self_obj`. That changes kill credit (`killCounts` when the player's script
    damages) and the `damage_p_proc` source. There is no message-window line.
- **Impact:**
  - Traps, radiation and fire scripts deal full damage through armour.
  - Gory deaths come out wrong at maximum blood.
  - "No animation" damage still animates.
- **Fix:** take an integer type, decode the flags, compute damage with `DT/DR + type` unless
  bypass, call `critterDamage` with a null or dummy source, pass `animate = !(flags & 0x200)`,
  and map the type index to the name (`Weapon.ts damageType[]`) for `scriptDamage`. Print the
  damage line the way `combatDisplay` does.
- known_bugs: NEW.

### ACT-02 — No AP limit or cost for use / pickup / loot / skill moves in combat (HIGH, NEW) — **FIXED 2026-10-24 (PA18)**
- **CE:** `_action_use_an_item_on_object`, `actionPickUp`, `_action_loot_container` and
  `actionUseSkill` all call `animationRegisterMoveToObject(..., critter->combat.ap)` in combat.
  `_check_scenery_ap_cost` (proto_instance.cc:1403) then takes 3 AP, or prints proto.msg 700
  and aborts.
- **DH2:** `playerUse.ts:388–425` (callback → `walkInFrontOf`), `playerUse.ts:224`
  (skill walk), `ui_contextmenu.ts:103,164`.
- **DH2 behaviour:** no turn check, no `maxLength`, no `subtractMoveAP`, no 3-AP charge.
  (`usePendingItemOn` does charge its 2 AP and move AP correctly.)
- **Impact:** in combat the player can cross the map for free by clicking a far item, door or
  corpse, even during an enemy's turn. Using a door or container costs nothing.
- **Fix:** in combat, require `inPlayerTurn`, pass `getAvailableMoveAP()` as `maxLength`,
  charge move AP as the plain-walk path does, and charge 3 AP (Quick-Pockets-free) before
  `use` / `pickup` / loot (msg 700 if short).
- known_bugs: NEW.

### ANIM-01 — reg_anim delay semantics (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `animation.cc animationRunSequence`, `_anim_set_continue`.
- **DH2:** `src/scripting.ts:2926 reg_anim_end` (`doStep`).
- **CE behaviour:** step 0 always starts at once.
  - delay **0**: the step starts on the same tick as the previous one (parallel).
  - delay **−1**: the step waits until every earlier step has finished.
  - delay **N > 0**: the step starts N animation ticks after the previous one began.
- **DH2 behaviour:** every animate or move step waits for the previous step to *finish*, then
  waits `delay × 100 ms`. Func and sfx steps fire at once.
- **Impact:** scripted scenes in which two critters animate together, or an animation runs
  alongside a move, play one after another and take longer. A `delay` of −1 vs 0 makes no
  difference.
- **Fix:** model the CE cursor: start steps while `delay >= 0`, count N down per frame tick,
  and block on −1 until all started steps are done.
- known_bugs: NEW.

### ACT-04 — Explosions lack `_report_explosion` and the explosion death anim (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `actions.cc actionExplode`, `_report_explosion`, `_show_damage_to_object`
  (`fid == buildFid(MISC, 10)` → EXPLODED_TO_NOTHING).
- **DH2:** `src/object/Obj.ts:1281 explode`, `:1318 explosionBlast`.
- **CE behaviour:**
  - After the blast, `_combat_display` prints the lines.
  - The dude source gets the XP of every critter that newly died (`_combat_give_exps`).
  - Survivors get `who_hit_me = source`.
  - Out of combat, `scriptsRequestCombat` starts a fight (survivor vs source).
  - Victims die with `_check_death(ANIM_EXPLODED_TO_NOTHING, MAX_BLOOD)`, else a plain fall.
- **DH2 behaviour:** `critterDamage` only. No XP, no who-hit-me, no combat, no message lines.
  The death anim comes from `pickDeath` (attackerAnim STAND, Explosive): BIG_HOLE at normal
  violence for damage ≥ 15, a fall below 15 even at maximum blood, and Bloody Mess counts.
- **Impact:** dynamite and plastic kills give no XP. Bombing a group does not make it hostile.
  The death visuals differ.
- **Fix:** pass an explosion attacker marker to `critterKill` so it uses
  `checkDeath(EXPLODED_TO_NOTHING, 3)`. After the blast, add who-hit-me, start combat
  (`Combat.start` with the survivor as attacker), sum `XPValue` for new kills when the source
  is the player, and log damage lines.
- known_bugs: NEW (C32 covers the timer and damage only).

### ACT-05 — No ANIM_POINT / ANIM_UNPOINT on ranged attacks (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `actions.cc _action_ranged`: `animationRegisterAnimate(attacker, ANIM_POINT, -1)`
  before the fire anim, and `ANIM_UNPOINT` after it unless the attacker is knocked down or dead.
  Throws use neither.
- **DH2:** `src/combat/Combat.ts:874`. Only the attack FRM plays. `Weapon.getAnim` has no
  `Xh` / `Xi` codes.
- **Impact:** guns snap from idle to firing and back. Each ranged attack is shorter than in CE.
- **Fix:** for non-throw ranged modes, play `anim:43` (point) when the art exists, then the
  attack with the existing action-frame callback, then `anim:44` (unpoint) before `proceed`.
- known_bugs: NEW.

### ANIM-02 — Walking never detects blockers mid-path; AP is taken up front (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `animation.cc _object_move`. At each hex step it checks `_obj_blocking_at(next)`.
  A door the critter can use is opened. Any other blocker triggers a re-path
  (`_make_path(..., a5 = 1)`), or the walk ends when no path is left. In combat, each hex costs
  `critterGetMovementPointCostAdjustedForCrippledLegs(1)` (free move first) and the walk stops
  at 0 AP.
- **DH2:** `critterAnimation.ts:511 walkFrameCE` / `Critter.move` Critter.ts:270. Only doors are
  handled. Callers subtract `path.length − 1` before moving (playerUse.ts:251,
  Combat.ts:2545…).
- **Impact:** critters walk through a critter that stepped into the path. Overlapping occupants
  are possible. A walk interrupted by a script still costs the full AP.
- **Fix:** in `walkFrameCE`, before `move(next)`, test `blockingObjectAt(next)`; open the door if
  `canUseDoor`, otherwise re-path to the target with the goal required free, or stop. Charge AP
  per hex.
- **Fixed 2026-10-25:** a blocker on the next hex makes the walk re-path within its paid hexes or end (usable doors open). The AP are still charged when the walk starts, but a walk that ends early (blocked, or a script stopped it) gets back the AP of the hexes it didn't walk, free move points counted as spent first (`ActionPoints.refundWalk`), so the cost is CE's per-hex one.
- known_bugs: NEW.

### ANIM-03 — Run rules: Sneak, encumbrance, overloaded message (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `animation.cc animationRegisterRunToObject` / `RunToTile` and `reportOverloaded`.
- **CE behaviour:**
  - The critter walks instead of running when it has a crippled leg, when it is the dude
    sneaking without Silent Running, or when it has no run art. Sneak is *not* cleared.
  - An encumbered critter walks, and a party member prints misc.msg 8000 / 8001.
  - Only `_dude_run` (the explicit run command) clears Sneak.
- **DH2:** `Critter.walkTo` Critter.ts:436–446 treats every `running = true` like `_dude_run`.
  `walkInFrontOf` (Critter.ts:498) forces running beyond 5 hexes. A sneaking player clicking
  something 6+ hexes away stops sneaking. No encumbrance check.
- **Fix:** add a `runRequested` origin flag. Registered runs should downgrade to walking (keep
  Sneak), and only the run key / `doAlwaysRun` should clear Sneak. Add
  `critterIsEncumbered` → walk + message.
- known_bugs: NEW.

### ACT-06 — Pickup runs the script before walking (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `actions.cc actionPickUp`: walk (run ≥ 5 out of combat; move AP in combat),
  `_is_next_to`, `_check_scenery_ap_cost`, ANIM_MAGIC_HANDS_GROUND, then on its action frame the
  item sfx and `_obj_pickup` (pickup_p_proc, carry check, add).
- **DH2:** `src/object/Obj.ts:1348 pickup`. `Scripting.pickup` and `canCarry` run first; then
  `walkInFrontOf`, then `pickUp` (`ak`), then add.
- **Impact:** pickup_p_proc side effects (floats, alarms, "can't take that") fire while the
  player is still far away, and an override still means no walk. The carry message appears at
  a distance.
- **Fix:** walk first, then play `pickUp` with an action-frame callback that runs pickup_p_proc,
  the carry check and the add.
- known_bugs: NEW.

### ACT-07 — Ladder handling (MED/LOW, NEW) — **FIXED 2026-10-25**
- **CE:** `actions.cc _action_use_an_item_on_object` → `_action_climb_ladder`, only for
  `SCENERY_TYPE_LADDER_UP` (3) with no item. It walks to `tileGetTileInDirection(ladder, SE, 1)`,
  checks `_is_next_to`, rotates to the ladder, charges 3 AP in combat, puts the weapon away,
  plays CLIMB_LADDER + sfx, calls `_obj_use`, then takes the weapon out. `LADDER_DOWN` (4) uses
  the normal magic-hands path.
- **DH2:** `src/object/Obj.ts:1236–1266`. The climb `ae` plays for both subtypes, after
  `walkInFrontOf` (any adjacent hex). There is no put-away or take-out, and the `ae` art is the
  unarmed code.
- **Impact:** a wrong animation for ladders going down. The player may climb from the wrong side.
- **Fix:** branch on subType 3. Walk to the SE neighbour, then follow CE's sequence.
- known_bugs: NEW.

### ANIM-04 — Idle fidget (LOW, NEW) — **FIXED 2026-10-25**
- **CE:** `animation.cc _dude_fidget`: out of combat only, one random on-screen standing critter
  every `clamp(20 / n, 1, 7)` s + 0–3 s. The stand sfx plays for the dude, or for 'm…'-art
  critters within PER × 2.
- **DH2:** `critterAnimation.ts:332`. Every critter loops its idle on its own, every 3–10 s, in
  combat too, with no sfx.
- known_bugs: NEW.
- **Fixed 2026-10-25:** CE's single `_dude_fidget` scheduler (`critterAnimation.ts dudeFidget`): out of combat, one random standing critter on screen, its stand sound for the dude or an 'm…' critter within PER × 2, the next after clamp(20 / n, 1, 7) s + 0–3 s; other critters stand on frame 0.

### ANIM-05 — Straight-move speed for knockback and fire dance (LOW, NEW) — **FIXED 2026-10-25**
- **CE:** `animateMoveObjectToTileStraight`, `_make_straight_path(..., 4)` for critters. A node
  is every 4 screen pixels, one per animation tick.
- **DH2:** `lifecycle.ts:257 moveStraight`, one hex per frame.
- **Impact:** knockback and the burning run end several times sooner, and the slide outruns the
  fall animation.
- known_bugs: NEW.
- **Fixed 2026-10-25:** a hex of the straight slide takes its screen length / 4 frames at the art's fps (CE's node every 4 pixels, one a frame); the sprite glides 4 px a frame (`slideOffset`, drawn by the renderer) and changes tile half-way, as CE's nodes do.

## DH2-only behaviour
- `walkInFrontOf` (Critter.ts:481) is DH2's universal "go next to it": it stops one path step
  short and runs beyond 5 hexes. CE has a separate rule per action.
- Talking walks all the way to the NPC (known_bugs P15, deliberate).
- `Combat.perish` logs "X is killed by Y!" to the message window (Combat.ts:1694). CE prints no
  such line; its kill text comes from `_combat_display` (combat.msg).
- The explosion sprite in combat uses misc proto 14 for every grenade type
  (`spawnExplosionSprite`).
- Corpse auto-cleanup timer `Config.engine.corpseTimeout` (lifecycle.ts:123).
- The `[dh2] elevator_use` context-menu Use on elevators (ui_contextmenu.ts:134).
- `Config.engine.doInfiniteUse` skips every walk-to-target.
- `Config.engine.walkModel` 'dh2' / 'smooth' alternatives to CE's walk model.
