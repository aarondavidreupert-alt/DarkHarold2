# Combat System Reference

> Last audited: 2026-10-17 (lifecycle §1; formula audit C22/C23/C30, see §10)  
> Sources: `raw/fallout2-ce/src/combat.cc`, `combat_ai.cc`, `critter.cc`, `obj_types.h`, `proto_types.h`  
> DH2 sources: `src/combat.ts` (barrel; `src/combat/{actionPoints,AI,damage,hitChance,Combat,results,explosion,whoHitMe}.ts`), `src/critter.ts` (barrel; `src/critter/{Weapon,lifecycle}.ts`), `src/scripting.ts`, `src/vmBridge.ts`, `src/main.ts`  
> Cross-reference: [damage_formula.md](damage_formula.md) for hit chance, damage calculation, critical
> effects, sequence/initiative, and AP base formula.

---

## 1. Combat Lifecycle (re-audited 2026-10-17)

### CE (`combat.cc _combat`)

```
_combat(csd):
  _combat_begin(nullptr)                 every critter on the elevation in _combat_list
  _combat_sequence_init(attacker, defender)
      round 1 = attacker, defender, the dude (unless one of them); only these are
      combatants (_list_com), the rest non-combatants; attacker / defender whoHitMe each other
  loop:
    _combat_set_move_all()
    for each combatant: _combat_turn(obj)        (csd covers the first turn only)
    _combat_sequence():                          end of round
      _combat_add_noncoms()                      _combatai_want_to_join → joins
      dead out; knocked out / DISENGAGING → non-combatants
      qsort(_compare_faster)                     Sequence, then Luck, highest first
      gameTimeAddSeconds(5)
  while !_combat_should_end()
  _combat_over(); scriptsExecMapUpdateProc()
```

Inside the dude's turn `_combat_input`: Space ends the turn, Return tries to end combat (`combatAttemptEnd`), other keys go to `gameHandleKey`.

### DH2 (`src/combat/Combat.ts`)

- `Combat.start(attacker?, gcsd?, teamCombat?)`: every living, visible critter of the map goes into `combatants`; `sequenceInit(attacker ?? gcsd.attacker, gcsd.defender)` is `_combat_sequence_init` (round 1 = attacker, defender, dude; whoHitMe both ways). Without an attacker (the A key, the attack button) the dude goes first.
- Participation is the `hostile` flag (CE `_list_com`); `combatSequence()` at each round's end is `_combat_sequence`: `notifyFriends`, `wantToJoin` joins, knocked-out / disengaging leave, `sortBySequence()` (Sequence, then Luck — `_compare_faster`), 5 s of game time; then `shouldEnd()` (`_combat_should_end`).
- `attack_complex` / `attack_setup` start combat with their start data (`attack_setup`: neutral data, in combat ENGAGING + whoHitMe, as `opAttackSetup`); worldmap encounters use `teamCombat` (`_caiSetupTeamCombat`).
- Turn start: standup (`_combat_standup`), knockout / lose-turn skips, unused AP → AC (HtH Evade), the dude's damage-last-turn reset.
- `attemptEnd()` = `combatAttemptEnd`; `forceEnd()` = `terminate_combat` / leaving the map.
- Keys: `src/hotkeys.ts` (Space / Return in the player's turn).

Remaining differences: none known in the lifecycle (see §10 for the formula audit).

## 2. AP Consumption

### CE AP pool

CE tracks two separate pools: `critter->data.critter.combat.ap` (attack AP, decremented per action)
and the movement AP tracked via `_gcsd->freeMovement`. Both are integers.

Base AP formula: `critterGetStat(STAT_MAXIMUM_ACTION_POINTS)` = `5 + floor(AGI/2)`.

### DH2 `ActionPoints` class (`src/combat/actionPoints.ts`) — CE model since 2026-10-17

```typescript
class ActionPoints {
    combat: number  // critter.combat.ap = getStat('AP') (STAT_MAXIMUM_ACTION_POINTS) each round
    move: number    // player's _combat_free_move = 2 × Bonus Move rank (combat.cc _combat_turn)
}
```

- `getStat('AP')` is 5 + AGI/2 for the player, or the proto's value for NPCs. It already includes Action Boy (+1 per rank), Bruiser (−2) and drug modifiers.
- Movement uses the free move points first, then AP (animation.cc `_object_move`). Crippled legs cost ×4 for one leg and ×8 for both (`critterGetMovementPointCostAdjustedForCrippledLegs`).
- The attack cost for the player is `Weapon.getAttackAPCost(critter, slot, aiming)`, a port of CE item.cc `weaponGetActionPointCost`:
  - Fast Shot: −1 for a weapon with range > 2.
  - Bonus HtH Attacks: −1 for melee and unarmed attacks.
  - Bonus Rate of Fire: −1 for ranged attacks.
  - Aimed shot: +1.
  - The cost is never below 1.
- The HUD shows the free move points as extra lights (`drawAP(ap, max, move)`).

**AP costs per action:**

| Action | Cost | Source |
|--------|------|--------|
| Move 1 hex | 1 (free move first) | `subtractMoveAP` |
| Move with one / both crippled legs | ×4 / ×8 | `subtractMoveAP` |
| Single shot / burst | `APCost1` / `APCost2` with the player modifiers above | `getAttackAPCost` |
| Called shot | `APCost1` + 1 | `getAttackAPCost(…, aiming = true)` |
| Unarmed (AI) | 3 | `doAITurn` |
| Unarmed (player, empty hand) | the hit mode's AP (−1 Bonus HtH Attacks, +1 aimed) | `unarmedAPCost()` — `wiki/weapon_combat.md` §9 |

**Unused AP → AC** (CE `stat.cc critterGetStat(STAT_ARMOR_CLASS)`): in combat a critter's current combat AP count as AC while it isn't its turn (`Combat.unusedApAC`). Every combatant gets its full AP at the start of each round (CE `_combat_set_move_all`, `Combat.setMoveAll`), so a critter that hasn't acted yet has its full AP as AC, one that has acted its leftover; non-combatants and anyone out of combat have 0. Free move points do not count. HtH Evade (player, no weapon in either hand): AP × 2 + Unarmed / 12. (Until 2026-10-24 DH2 counted only the leftover after the critter's own turn — known_bugs PA17.)

---

## 3. Burst Fire

### CE `_compute_spray` (combat.cc:3703)

CE computes burst as three separate sweep lines, each calling `_shoot_along_path`:

```
mainTargetEndTile  — directly toward target
leftEndTile        — one hex to the left of center
rightEndTile       — one hex to the right of center

centerRounds = burstCount (per weapon)
leftRounds   = burstCount / 2 (rounded down)
rightRounds  = burstCount - centerRounds - leftRounds

_shoot_along_path(attack, endTile, rounds, anim):
  for each tile along path (from attacker to endTile):
    for i in 0..rounds:
      roll hit vs full accuracy
      if hit: attackComputeDamage (ammo-per-hit = 1, multiplier = 2)
```

Hits on the main target are counted in `roundsHitMainTarget`. All critters on all
three lines (friend or foe) are valid burst targets. Ammo is deducted per
*spent* round, not per *hit* round.

### DH2 (combat.ts)

```typescript
const centerCount = Math.floor(burstCount / 2)
const leftCount   = Math.floor((burstCount - centerCount) / 2)
const rightCount  = (burstCount - centerCount) - leftCount

for each cone {dir, count}:
    coneEnd = hexInDirectionDistance(target.position, dir±1, 2)
    line = hexLine(attacker.position, coneEnd)
    for each position on line:
        for b in 0..count:
            roll = rollHit(obj, o, 'torso', -20)   // −20 penalty per round
            if roll.hit: damageMap[o] += getDamageDone(...)

// Apply all accumulated damage after all cones
for [victim, dmg] of damageMap:
    critterDamage(victim, dmg, ...)

// Deduct rounds
pro.extra.rounds = max(0, curRounds - burstCount)
```

All critters on all three cone lines are eligible, including the player and allies.
Damage is summed across multiple bullet hits per target.

**Divergences from CE:**

| Feature | CE | DH2 |
|---------|-----|-----|
| Round distribution | center / left / right with separate `_shoot_along_path` calls | same split logic |
| Hit penalty | full accuracy, ammo count matters | −20 flat penalty per bullet (approximation) |
| Ammo tracking | deducts per round *spent* | deducts `burstCount` flat |
| Critter-line intersection | per-tile object lookup | same |
| `_check_ranged_miss` on zero main-target hits | yes | no (if `damageMap` empty, plays dodge) |
| Friendly fire | included (any critter on path) | included (no team check) |

---

## 4. Knockback

### CE `attackComputeDamage` (combat.cc:4633–4658)

Knockback is computed alongside damage:

```c
Conditions for knockback:
  knockbackDistancePtr != nullptr  (only for defender, not attacker or extras)
  (critter->flags & OBJECT_MULTIHEX) == 0     // multi-hex critters immune
  damageType == EXPLOSION || weapon == nullptr || attackType == ATTACK_TYPE_MELEE
  PID_TYPE(critter->pid) == OBJ_TYPE_CRITTER
  !_critter_flag_check(critter->pid, CRITTER_NO_KNOCKBACK)  // CritterFlags:0x4000

Formula:
  divisor = (weaponPerk == PERK_WEAPON_KNOCKBACK) ? 5 : 10
  distance = damage / divisor

Stonewall perk (player only):
  50% chance to negate knockback entirely; if not negated: distance /= 2
```

Direction: away from attacker along the hex-line between attacker and defender.
The defender is moved that many hexes. Each hex of movement checks for blocking objects.

`CRITTER_NO_KNOCKBACK = 0x4000` is a proto-level flag set per critter type in the PRO file.

### DH2 (`src/critter/lifecycle.ts` `critterDamage`)

The conditions and the formula follow CE (fixed 2026-10-17):
- The source is `'Explosive'` damage, a fist or an attack-mode swing/thrust weapon.
- No multihex or `CRITTER_NO_KNOCKBACK` target.
- `PERK_WEAPON_KNOCKBACK` (id 61) uses /5.
- Stonewall applies.
- The cap is 20 (`MAX_KNOCKDOWN_DISTANCE`).

Earlier versions compared against the wrong name `'Explosion'`, used perk id 3 and capped the distance at 6.

The knockback itself is CE `actionKnockdown` (slide with the fall animation, stops before blockers and exit grids, then stands up); only the main defender and explosion victims are knocked back (§10 "Closed by C30").

---

## 5. Death & Knockout

### CE critter death (`critter.cc:818`)

`critterKill(critter, anim, a3)`:
1. Removes from party (`partyMemberRemove`)
2. Picks death FID: if already prone → fall-back/fall-front SF; otherwise uses explicit `anim` or `LAST_SF_DEATH_ANIM`, with `_obj_fix_violence_settings` for low-violence mode
3. Clears blocking flag (`OBJECT_NO_BLOCK`), makes flat
4. Turns off light
5. Sets `critter->data.critter.hp = 0` and `DAM_DEAD` flag
6. Removes script (`scriptRemove`), clears drug event queue (`_queue_clear_type`)
7. Calls `itemDestroyAllHidden(critter)` — destroys hidden inventory items but leaves visible ones on the corpse (player can loot)
8. Player death: `endgameSetupDeathEnding` + `_game_user_wants_to_quit = 2`

### DH2 `critterKill` (`src/critter/lifecycle.ts`)

1. Re-entry guard (`if (obj.dead) return`), then `dead = true` and HP 0.
2. `killsIncByType` only for kills by the player or the player's team (combat.cc `_damage_object`). There is no karma for kills, as in CE (the scripts handle karma; the old "+1 karma per kill" placeholder was removed 2026-10-17).
3. `destroy_p_proc` via `Scripting.destroy`.
4. Death animation: `_pick_death` → `_check_death` → `_pick_fall` → `_action_blood` (`src/critter/deathAnim.ts`, C20), with the DIE sound. Without animation it uses the single-frame `deathFrame`. Fire dance → burned to nothing.
5. Freeze on the last frame (`anim = 'dead'`). Player death → death ending.
6. The inventory stays on the corpse. The old invented `CRITTER_NO_DROP` inventory wipe was removed: CE uses that flag only to keep the weapon from being dropped by a critical and to keep items from dropping when a critter is burned or exploded to nothing.

**XP** (`Combat.perish` / `giveExps`, fixed 2026-10-17):
- A kill by the player or the player's team adds the proto's `XPValue` to `combatExps`, unless the victim's script overrode it.
- At combat end the XP goes to the player with CE's message 621 and a prefix from 622–626 (`_combat_give_exps`).
- Before, it read the non-existent field `killExp` and so gave 50 XP for every kill, immediately.

### Knockdown / knockout (DH2)

Knockdown is triggered by critical effects (not directly by damage). `CriticalEffects`
sets `critter.isKnockedDown = true` and `critter.skipTurns = N` on the target.

**In `critterDamage`** (critter.ts–581): if HP > 0 and `isKnockedDown`:
- Plays `knockdownFront` animation (stays on last frame)
- Sets `skipTurns = 1`

**In `nextTurn`** (combat.ts–1580): if `critter.skipTurns > 0`:
- Decrements `skipTurns`
- When 0: clears `isKnockedDown`, plays `getUpFront`, then skips to next turn

**CE knockout**: sets `DAM_KNOCKED_OUT` flag. The critter loses all remaining AP
for their current turn and skips their next turn(s) until the flag clears.

### Divergences

None. Death, knockdown and knockout use the same `combat.results` bits (`Critter.injuryFlags`, `src/combat/results.ts`); `critter_state` reports PRONE (§7); the player's death runs `endgameSetupDeathEnding` (`src/endgame/deathEndings.ts`); XP from the proto `experience`, given at combat end.

---

## 6. Fleeing / Surrender

### CE fleeing (`combat_ai.cc`, `obj_types.h`)

```c
// CritterManeuver flags (obj_types.h:119)
CRITTER_MANEUVER_NONE         = 0x00
CRITTER_MANEUVER_ENGAGING     = 0x01
CRITTER_MANEUVER_DISENGAGING  = 0x02
CRITTER_MANUEVER_FLEEING      = 0x04   // note: typo in CE source
```

The AI sets `CRITTER_MANUEVER_FLEEING` when:
- `currentHp < ai->min_hp` (from `ai.txt` field `min_hp`)
- Or explicitly via the `critter_set_flee_state` script opcode

While fleeing, the critter moves away from all threats and does not attack even if
adjacent (`combat_ai.cc:2812`). Dialogue cannot be opened with a fleeing critter.

CE has no "surrender" mechanic exposed to scripts; the flag
`CRITTER_MANUEVER_FLEEING` covers both retreat and surrender behavior.

### DH2 fleeing

The same: `Combat` checks `fleeing` (`CRITTER_MANUEVER_FLEEING`), the packet's `min_hp` and `hurt_too_much` at the start of an AI turn, and a fleeing critter runs as CE `_ai_run_away` (`Combat.ts`). `critter_set_flee_state` / `critter_is_fleeing` set and read that flag, so a script-set flee is honoured at once. (The old notes on a fixed flee target at x = 128 and an ignored script flag are obsolete; CE has no `CRITTER_NO_FLEE` check either.)

---

## 7. Combat Scripting Opcodes

### Direct opcodes

| Opcode | Name | Args | CE function | DH2 status | DH2 source | Notes |
|--------|------|------|-------------|------------|------------|-------|
| 0x8128 | `combat_is_initialized` | 0 | `opCombatIsInitialized` | IMPLEMENTED | vmBridge.ts:51 | Returns `scriptObj.combat_is_initialized` (0/1); set to 1 when `combat_p_proc` fires |
| 0x80D0 | `attack_complex` | 8 | `opAttackComplex` | IMPLEMENTED | scripting.ts | Self attacks the target; nothing when either is inactive / hidden or the target flees; `_gcsd` accuracy bonus, min / max damage and the results override for the first attack |
| 0x80ED | `kill_critter` | 2 | `opKillCritter` | IMPLEMENTED | scripting.ts | `critterKill` without animation; the corpse is the single-frame death `deathFrame` |
| 0x80EE | `kill_critter_type` | 2 | `opKillCritterType` | IMPLEMENTED | vmBridge.ts | |
| 0x80EF | `critter_dmg` | 3 | `opCritterDamage` | IMPLEMENTED | vmBridge.ts | |
| 0x80FB | `critter_state` | 1 | `opGetCritterState` | IMPLEMENTED | scripting.ts | DEAD 1; PRONE 2 when knocked out or in a knockdown; plus the DAM_CRIP bits |
| 0x80FF | `critter_attempt_placement` | 3 | `opCritterAttemptPlacement` | IMPLEMENTED | scripting.ts | CE `_obj_attempt_placement` |
| 0x8127 | `critter_injure` | 2 | `opCritterInjure` | IMPLEMENTED | scripting.ts | |
| 0x8143 | `attack_setup` | 2 | `opAttackSetup` | IMPLEMENTED | vmBridge.ts | |
| 0x8151 | `critter_is_fleeing` | 1 | `opCritterIsFleeing` | IMPLEMENTED | scripting.ts | the AI's flee flag |
| 0x8152 | `critter_set_flee_state` | 2 | `opCritterSetFleeState` | IMPLEMENTED | scripting.ts | the AI honours it |
| 0x8153 | `terminate_combat` | 0 | `opTerminateCombat` | IMPLEMENTED | scripting.ts | |
| 0x8155 | `critter_stop_attacking` | 1 | `opCritterStopAttacking` | IMPLEMENTED | scripting.ts | DISENGAGING, forgets its attacker |
| 0x80B6 | `move_to` | 3 | `opMoveTo` | IMPLEMENTED | scripting.ts | |

### `combat_is_initialized` detail

CE `opCombatIsInitialized` returns 1 when the engine's combat state machine is
active. DH2 uses `scriptObj.combat_is_initialized`, a property on the Script
instance set to 1 when `Scripting.combatEvent(obj, 'turnBegin')` fires and
the script's `combat_p_proc` exists (`scripting.ts:2093`). It is **not** the
same as `isCombatActive()` — a critter can have `combat_is_initialized = 1` only
during its own `combat_p_proc` callback.

### `attack_complex` detail

See the table above and §10 ("`attack_complex` — `_gcsd`").

---

## 8. Known Gaps vs CE

None open. The former rows (knockback animation, flee state, `critter_stop_attacking`, `critter_state` prone bit, `attack_complex` parameters and `_gcsd`, `kill_critter` death frame, `_combat_add_noncoms`, enrolment of every critter on the elevation, fire damage over time, AI called shots via `_ai_called_shot`) are all CE now. <!-- audited: 2026-10-18 -->

---

## 10. Audit 2026-10-17 — combat, damage, criticals, death vs fallout2-ce

This was a full review of the attack chain against CE combat.cc (`attackDetermineToHit`, `attackCompute`, `attackComputeCriticalHit`, `attackComputeCriticalFailure`, `attackComputeDamage`, `_damage_object`, `_combat_give_exps`), item.cc (`weaponGetDamage`, `weaponGetActionPointCost`), actions.cc (`_pick_death`, `_show_damage_to_object`, `actionKnockdown`, `_is_hit_from_front`) and critter.cc `critterKill`.

### Fixed in this audit

| # | Area | CE | DH2 before |
|---|------|----|-----------|
| 1 | Single-shot / melee / unarmed roll | `randomRoll(toHit, critChance)`: hit if d100 ≤ toHit; crit if d100 ≤ margin/10 + crit; crit miss if d100 ≤ −margin/10; criticals only from day 1 | Old DarkFO `rollHit`: d1–101 and "roll < toHit" (about 1% too low), fractional margin, no day rule. Bursts already used `randomRoll`. |
| 2 | Slayer / Sniper / unarmed bonus crit | Player only. Slayer: melee + unarmed. Sniper: ATTACK_TYPE_RANGED. A move's bonus crit chance is its own d100 roll on a hit. | Slayer not for fists; Sniper also for thrown weapons and NPCs; the move's crit bonus was added to Better Criticals |
| 3 | Critical damage multiplier | Table value as is | Halved for melee weapons (min 2), which is not in CE |
| 4 | Invulnerable critters | No critical, ×2 | Critical tables applied |
| 5 | Critical failure | Table row = proto `criticalFailureType`; effect from d100 − 5×(LUK−5); none for the player before day 6 | Row guessed from the damage type; Luck sign inverted (high Luck made it worse); no day rule |
| 6 | Melee damage | `random(min, max + Melee Damage)` for melee and unarmed; player min + 2 × Bonus HtH Damage (sfall fix, CE default) | Melee Damage never added |
| 7 | Difficulty damage modifier | Only for attackers outside the player's team | Applied to everyone, so the player did 75% damage on Easy |
| 8 | PERK_WEAPON_PENETRATE (60) | DT ×20% | Weapon perk not read (only unarmed moves) |
| 9 | Bonus Ranged Damage | ATTACK_TYPE_RANGED only | Every non-melee weapon (also thrown) |
| 10 | Knockback | See §4 | Never for explosions (`'Explosion'` typo), perk id 3 instead of 61, cap 6 |
| 11 | Kill XP and kill counts | Proto XP for player/team kills, given at combat end; kill counter only for those | 50 XP for every player kill, immediately; every kill counted; +1 karma per kill (invented) |
| 12 | `CRITTER_NO_DROP` | Weapon can't be dropped; items stay with burned/exploded corpses | Corpse inventory wiped |
| 13 | Max AP | STAT_MAXIMUM_ACTION_POINTS (Action Boy, Bruiser, proto AP) | 5 + AGI/2 recomputed; Action Boy and Bruiser ignored in combat |
| 14 | Bonus HtH Attacks / Rate of Fire / Move | −1 AP per melee/ranged attack; Bonus Move = 2 free move points per rank | +1 AP per turn each; Bonus Move +2 general AP |
| 15 | Fast Shot | −1 AP for weapons with range > 2 | Not implemented |
| 16 | `_is_hit_from_front` | Compares attacker and defender facing | Used the direction to the attacker |
| 18 | Thrown weapons (2026-10-17, C25) | `_action_ranged`: `itemRemove(attacker, weapon, 1)` — one item of the stack is the projectile, the rest stays in the hand; it lands on the target's tile on a hit, on the tile where the miss stopped (the critter it hit by accident, or the last free hex before a wall), and stays there; grenades explode and are gone; no throw on a critical failure | Thrown weapons were never used up |
| 19 | Projectile flight (2026-10-17, C26) | Projectile object from the proto's `projPID`: appears on the hex next to the attacker on the action frame, moves 32 px per frame along a straight screen line at FRM fps (+ combat speed), hits on arrival | Nothing drawn; damage at once |
| 20 | Secondary attacks (2026-10-17, C27) | Primary → aimed → secondary → aimed → reload; secondary uses APCost2 / maxRange2 / its own skill and attack type; throw anims dm / gm / as; AI picks any secondary | Only primary + burst; spears and knives could not be thrown; every weapon had an aimed mode |
| 21 | Player bad-shot check (C28) | `_combat_check_bad_shot` before every attack: out of range, no ammo, AP, aim blocked, crippled arms (combat.msg 100–106) | No range check at all; only an AP check |
| 22 | Hit-location penalties (C28) | Eyes −60, groin −30 | Swapped (eyes −30, groin −60) |
| 23 | Items on the floor (C28) | Never block (`_obj_blocking_at`) | Blocked movement unless the proto had NoBlock |
| 17 | Unarmed moves (2026-10-17, C24) | `gUnarmedHitDescriptions`: 1–2 + bonus damage, CE requirements, AP, bonus crit, penetration; left hand punches and right hand kicks; primary/secondary + aimed; NPCs plain punch | Two invented tables with other names, damage, AP and requirements; kicks only with both hands empty; NPC fists levelled up after a weapon drop — see `wiki/weapon_combat.md` §9 |

### Verified as CE (no change)

- **Hit chance (`hitChance.ts`):**
  - Distance with the perception bonus (Long Range ×4, Scope ×5 from 8 hexes), the Sharpshooter fix and the blind ×−12.
  - −10 per critter in the line of fire.
  - One Hander, min-ST penalty, Weapon Handling, Accurate +20.
  - Ammo AC modifier, AC floor 0.
  - Hit-location penalty (half for melee/unarmed), multihex +15, darkness tiers (Night Sight).
  - Blind −25, prone target +40, difficulty ±20 for non-team attackers, cap 95.
- **Critical chance and level:** STAT_CRITICAL_CHANCE − hit-location penalty. Level bands 20/45/70/90/100 + Better Criticals. Massive-critical stat roll (d10 ≤ stat + mod).
- **Vanilla damage formula order:** bonus → ×(crit × ammo X) → /ammo Y → /2 → ×difficulty/100 → −DT → −DR%. Bypass (DT/DR 20%, not EMP), Finesse +30 DR, ammo DR modifier clamped 0–100, Living Anatomy +5, Pyromaniac +5.
- **Death:** `_pick_death` / `_check_death` / `_pick_fall` / `_action_blood`, the DIE sounds and fire dance (C20).
- **Bursts:** `_compute_spray` and `_shoot_along_path`; ranged miss → `_check_ranged_miss` / `_tile_num_beyond` (C17).
- **Movement AP:** crippled legs ×4 / ×8.
- **Checked in the browser:** 2000 rolls at 44% gave 45.4% hits (no criticals on day 0, as in CE). A spore plant kill gave its proto XP of 85 at combat end, with CE message 621.

### Closed by C30 (2026-10-17)

| Area | CE | DH2 now |
|------|----|---------|
| Attack pipeline | `attackInit` → `attackCompute` → `_combat_display` + `_apply_damage` | One `Attack` per attack (attacker/defender flags, damage, knockback, extras), computed before the animation; `src/combat/Combat.ts` |
| Critical hit tables | `gCriticalHitTables` / `gPlayerCriticalHitTable` | Generated from CE source (`src/criticalEffects/ceTables.ts`); `lut/criticalTables.json` decoded DAM_BYPASS as "lose turn" and lost DAM_LOSE_TURN |
| Critical failures | `_cf_table`, `attackComputeCriticalFailure` | Ported: DUD (nothing flies), EXPLODE (weapon gone, blast around the attacker), DESTROY, DROP, HIT_SELF (own rounds), LOSE_AMMO, LOSE_TURN, RANDOM_HIT (`_combat_ai_random_target`), CRIP_RANDOM, KNOCKED_DOWN (stands up at once) |
| Results | `combat.results`, `_set_new_results` | `Critter.injuryFlags`; cripple / blind / prone accessors read the same bits (`src/combat/results.ts`) |
| Knockout | Event after 10 × (35 − 3 × END) ticks, then knocked down | Same (`timeEventList` 'knockout'); turns are skipped while out; 5 s of game time per round (`_combat_sequence`), not per turn |
| Turn start | `_combat_turn`: KO / dead / LOSE_TURN skip (LOSE_TURN cleared); prone → `_combat_standup` (3 AP, Quick Recovery 1) | Same, for NPCs and the player |
| Knockback | `actionKnockdown`: slide with the fall anim (max 20, stops before blockers and exit grids, CE's extra step back), then stand up | Same; only the main defender and explosion victims (`attackComputeDamage` knockback pointer) |
| Fire | `DAM_ON_FIRE`: non-lethal fire dance; lethal: run 2–5 hexes, burn to nothing | Same; the invented 3-turn fire damage over time is gone |
| Corpses | `_show_death`: electrified / exploded to nothing drop everything | `itemDropAll` |
| Perks | Silent Death (×2, also on criticals — sfall), Enhanced Knockout weapon perk | Implemented |
| `attack_complex` | `_gcsd`: accuracy bonus, min / max damage, results override | Implemented (first attack only) |
| Unarmed-type weapons | Weapon branch of `attackDetermineToHit` | Brass knuckles etc. use their skill, min ST, One Hander, Accurate |
| Distance | `objectGetDistanceBetween(Tiles)` (−1 per multihex) | `objectDistance` for the to-hit range modifier, range checks and grenade scatter |
| Fast Shot | `critterCanAim` false | No aimed modes for the player |
| Messages | `_combat_display` (combat.msg 500–800, flag lists 200–422, hit locations 1000+) | Ported |
| NPC kicks | `_combat_attack`: a non-player punch is a kick 1 in 4 with the art | Same; NPC punches now play their character sound |
| Defender DAM_DROP | `_obj_drop(defender, attacker's weapon)` finds nothing — no effect (vanilla) | Same (the old C9 disarm was not CE) |
| Scripted explosions | `actionExplode`: tile critter + ≤ 6 in rings ≤ 3, d(min, max) − explosion DT / DR, knockback; `_scr_explode_scenery` → `damage_p_proc` (fixed param 20) | Same (`src/combat/explosion.ts`); replaces radius 8 without DT/DR and the door / spatial workaround |
| Living Anatomy | +5 once per attack | Was +5 per burst round |

<!-- audited: 2026-10-17 -->

## 9. How to Use — Guidance for Future Prompts

**Starting combat from a script** (usual case):
```ssl
// In NPC script:
// attack_complex fires Combat.start(self_obj) — no other args honored
attack_complex(self_obj, 0, 1, 0, 0, 0, 0, 0)
```

**Force-ending combat from a script**:
```ssl
terminate_combat()
// DH2: calls globalState.combat.forceEnd()
// CE: opTerminateCombat → ends current combat turn loop
```

**Checking combat state**:
```ssl
variable in_combat := combat_is_initialized
// Returns 1 only while the critter's combat_p_proc is executing
// Does NOT return 1 for general "is the game in combat mode"
```

**Scripted critter death with animation**:
```ssl
// CE: kill_critter(obj, deathFrame) picks a specific animation
// DH2: deathFrame is ignored; to force a specific death animation
//      set obj.deathAnim before calling critterKill from TypeScript,
//      or rely on the damage-type-based fallback.
kill_critter(target_obj, 0)
```

**Checking if critter is dead**:
```ssl
if (critter_state(obj) band 1) begin
    // critter is dead
end
// Note: bit 1 (prone) always 0 in DH2
```

**Flee state manipulation**:
```ssl
// Make a critter flee:
critter_set_flee_state(critter, 1)
// !! DH2 gap: AI will NOT actually flee unless HP <= min_hp.
// critter_is_fleeing() will return 1, but behavior is unchanged.

// Check if a critter is fleeing:
if critter_is_fleeing(critter) then begin ... end
```

**CE source quick-reference**:

- Combat start/end → `combat.cc:_combat_begin` (line ~2563), `_combat_over` (line ~2755)
- Turn loop → `combat.cc:_combat_turn` (line ~2917), `_combat_turn_run` (line 3121)
- AP assignment → `combat.cc:~2926`
- Burst fire → `combat.cc:_compute_spray` (line 3703), `_shoot_along_path` (line 3629)
- Knockback → `combat.cc:attackComputeDamage` (line 4633)
- Critter kill → `critter.cc:critterKill` (line 818)
- AI flee decision → `combat_ai.cc:~3065–3084`
- Opcode registration → `interpreter_extra.cc:~4874+`
