# Combat System Reference

> Last audited: 2026-05-31  
> Sources: `raw/fallout2-ce/src/combat.cc`, `combat_ai.cc`, `critter.cc`, `obj_types.h`, `proto_types.h`  
> DH2 sources: `src/combat.ts`, `src/critter.ts`, `src/scripting.ts`, `src/vm_bridge.ts`, `src/main.ts`  
> Cross-reference: [damage_formula.md](damage_formula.md) for hit chance, damage calculation, critical
> effects, sequence/initiative, and AP base formula.

---

## 1. Combat Lifecycle

### CE (`combat.cc:_combat_begin`, `_combat_over`)

```
combat_begin(attacker):
  _combat_turn_running = 0
  _combat_begin_extra(attacker)  ← build turn order, assign AP
    foreach critter in LOS of gDude:
      actionPoints = critterGetStat(obj, STAT_MAXIMUM_ACTION_POINTS)
        + _gcsd->actionPointsBonus (AI bonus AP from critter proto)
      obj->data.critter.combat.ap = actionPoints
    _combat_turn_obj = attacker   ← first actor
  beginCombatTurnLoop()
    _combat_turn(obj, false)      ← run one turn per object

_combat_over():
  check all LOS critters — any hostile & alive?
  if not: end combat, clear flags, play sound
```

`_combatNumTurns` is a global turn counter. Each call to `_combat_turn`
increments it. Combat ends when no hostile critter in LOS is alive.

### DH2 (`combat.ts:1356`, `combat.ts:1394`)

```typescript
// Entry points
Combat.start(forceTurn?: Critter)   // called from main.ts click handler and attack_complex
combat.end()                         // called from nextTurn() when no hostile critters remain
combat.forceEnd()                    // called by terminate_combat script opcode
```

**`Combat.start()`** (combat.ts:1356):
1. Re-entry guard: `if (combatActive) return` — the `combatActive` flag is a file-level let, not just `globalState.inCombat`. Both are set together.
2. Builds `triggerTeams: Set<number>` from player's team (always) + either the attacker's team (NPC-initiated) or all NPC teams on map (player-initiated).
3. `new Combat(objects, triggerTeams)` — constructor filters `Critter` instances, excludes dead and invisible. Initializes `new ActionPoints(obj)` per combatant.
4. Sort by **Sequence** descending: `10 + 2 * PER`. Ties: player first, then original array order.
5. Sets `whoseTurn = playerIdx - 1` so the first `nextTurn()` call lands on the player.
6. Plays `icombat1` sound, calls `uiStartCombat()`.
7. `nextTurn()` starts the turn loop.

**`nextTurn()`** (combat.ts:1481):
1. Updates hostility/LOS state for all non-player combatants:
   - `hasLOS(obj, player)` — hex-line wall check (non-exported `hasLineOfSight()`)
   - Critter becomes hostile if LOS is clear **and** at least one attack has been made (`hasAttacked` flag), or was already hostile before combat.
   - Hostile critters get a red outline; player-team critters get green.
2. If `numActive === 0 && turnNum > 1 && playerHadTurn`: calls `forceEnd()`.
3. Advances game time by 5 seconds per turn (`GameTime.advanceSeconds(5)`).
4. Increments `turnNum`, `whoseTurn`. Wraps at `combatants.length`.
5. **Unused AP → bonus AC**: at end of previous critter's turn, `prev.bonusAC = prev.AP.getAvailableMoveAP()`. Reset to 0 at the start of that critter's next turn.
6. Player's turn: resets AP, redraws HUD, sets `inPlayerTurn = true`.
7. NPC turn:
   - Skip if dead or not hostile.
   - Apply fire DoT: `critter.onFireTurns > 0` → random 3–6 fire damage.
   - Apply knockdown skip: `critter.skipTurns > 0` → decrement, skip to next turn; plays `getUpFront` when it reaches 0.
   - Calls `doAITurn(critter, idx, depth=1)`.

**`end()`** vs **`forceEnd()`**:

| | `end()` | `forceEnd()` |
|---|---------|--------------|
| Condition | called by `nextTurn()` after checking hostile count | called directly (script / out-of-band) |
| Clears hostile | yes | yes |
| Sets `combatActive = false` | synchronous | deferred with `Promise.resolve().then(...)` to prevent re-entry |

### Divergences from CE

| Feature | CE | DH2 |
|---------|-----|-----|
| Turn counter | global `_combatNumTurns` | `combat.turnNum` (per-instance) |
| AP source | `critterGetStat(STAT_MAXIMUM_ACTION_POINTS)` + bonus from critter proto | `ActionPoints.getMaxAP()` = `5 + floor(AGI/2)` + perk bonuses |
| Combatant enrollment | all critters in LOS at start | `triggerTeams` set; non-hostile critters ignored until first attack |
| LOS computation | `_combat_check_tile` (ray cast) | `hasLineOfSight()` — simple hex-line, wall-object check only |
| Round time advance | 180000 ticks = 5 in-world minutes per round | 5 seconds per `nextTurn()` call |
| `actionPointsBonus` | per-critter field from proto | not tracked; perk bonuses only |

---

## 2. AP Consumption

### CE AP pool

CE tracks two separate pools: `critter->data.critter.combat.ap` (attack AP, decremented per action)
and the movement AP tracked via `_gcsd->freeMovement`. Both are integers.

Base AP formula: `critterGetStat(STAT_MAXIMUM_ACTION_POINTS)` = `5 + floor(AGI/2)`.

### DH2 `ActionPoints` class (`combat.ts:57`)

DH2 uses a **unified pool** — movement and attacks draw from the same bucket:

```typescript
class ActionPoints {
    combat: number  // the single pool (both move and attack AP)
    move: number    // always 0 (unused slot kept for historic reasons)
}
```

**Pool initialization on each turn start** (`resetAP()`):
```
combat = getMaxAP() + getBonusCombatAP() + getBonusMoveAP()

getMaxAP()         = 5 + floor(AGI / 2)
getBonusCombatAP() = +1 (Bonus HtH Attacks) + 1 (Bonus Rate of Fire)
getBonusMoveAP()   = +2 (Bonus Move perk)
```

**AP costs per action:**

| Action | Cost | Source |
|--------|------|--------|
| Move 1 hex | 1 AP | `subtractMoveAP(path.length - 1)` |
| Move with one crippled leg | 4× hex count | `subtractMoveAP` multiplier |
| Move with both legs crippled | 8× hex count | `subtractMoveAP` multiplier |
| Single-shot attack | `pro.extra.APCost1` | `weapon.getAPCost(1)` → reads from PRO |
| Burst attack | `pro.extra.APCost2` | `weapon.getAPCost(2)` |
| Called shot | `pro.extra.APCost1 + 1` | `main.ts:261` (base + 1 surcharge) |
| Unarmed (AI) | 3 | Hardcoded in `doAITurn` (combat.ts:1143) |
| Unarmed (player) | `mode.apCost` | From `getActiveUnarmedModeForHand()` |

**Unused AP → Bonus AC**: at the end of each critter's turn, all remaining AP converts 1:1 to `bonusAC` for the next round (`combat.ts:1532`). This is reset to 0 at the start of that critter's own turn. Matches CE: `critter->data.critter.combat.results & DAM_HIT` reduces bonus AC.

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

### DH2 (combat.ts:817)

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

### DH2

**Knockback is not implemented.** Neither `critter.ts` nor `combat.ts` contain any knockback
distance computation or hex-movement-due-to-damage. `CriticalEffects` can set
`isKnockedDown` and `skipTurns`, but there is no physics-style displacement.

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

### DH2 `critterKill` (critter.ts:441)

1. Re-entry guard: `if (obj.dead) return` — prevents double-kill during overkill
2. `obj.dead = true`, `obj.outline = null`
3. Karma +1 for player-sourced kills (placeholder; CE awards via proto `karma_vars`)
4. Calls `Scripting.destroy(obj, source)` — triggers the object's `destroy_p_proc` if it has a script
5. **Death animation resolution** (priority order):
   - Explicit `animName` parameter
   - `obj.deathAnim` (set by critical-hit 'death' effect, then cleared)
   - `deathAnimForDamageType(damageType)` — maps damage type to animation name
   - `'death'` as fallback
6. After animation: `obj.frame--` (freeze on last frame), `obj.anim = 'dead'` (sentinel)
7. Blood pool: spawns `art/misc/rdatblud` floor decal for non-Explosion/Electrical/EMP deaths
8. Player death: creates `#playerDeadOverlay` DOM element with "YOU ARE DEAD"
9. Corpse cleanup: if `Config.engine.corpseTimeout > 0` and inventory empty, `destroyObject` after timeout
10. XP: `killXP = obj.pro?.extra?.killExp ?? 50`, awarded only to player-sourced kills

**XP divergence**: CE awards XP from `proto->critter.data.experience` for the actual
critter killed. DH2 reads `pro.extra.killExp` with a default of 50. Critters with no
PRO data always give 50 XP.

### Knockdown / knockout (DH2)

Knockdown is triggered by critical effects (not directly by damage). `CriticalEffects`
sets `critter.isKnockedDown = true` and `critter.skipTurns = N` on the target.

**In `critterDamage`** (critter.ts:573–581): if HP > 0 and `isKnockedDown`:
- Plays `knockdownFront` animation (stays on last frame)
- Sets `skipTurns = 1`

**In `nextTurn`** (combat.ts:1571–1580): if `critter.skipTurns > 0`:
- Decrements `skipTurns`
- When 0: clears `isKnockedDown`, plays `getUpFront`, then skips to next turn

**CE knockout**: sets `DAM_KNOCKED_OUT` flag. The critter loses all remaining AP
for their current turn and skips their next turn(s) until the flag clears.

### Divergences

| Feature | CE | DH2 |
|---------|-----|-----|
| Death flag | `DAM_DEAD` bitmask on `combat.results` | `obj.dead = true` boolean |
| Corpse inventory | hidden items destroyed, visible items stay | entire inventory stays |
| Knockout state | `DAM_KNOCKED_OUT` flag | `skipTurns > 0` + `isKnockedDown` |
| Critter prone state | `_critter_is_prone` checks fall animations | not queryable from scripts (`critter_state` returns 0 for prone) |
| XP source | proto `experience` field | `pro.extra.killExp ?? 50` |
| Player death | `endgameSetupDeathEnding + quit` | DOM overlay; game does not hard-stop |
| Script on kill | `destroy_p_proc` + `critter_p_proc` sequenced | only `Scripting.destroy()` |

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

`CRITTER_NO_FLEE` (`proto_types.h CritterFlags:0x200`) — proto-level flag that
prevents AI from ever entering flee state. No movement restriction from script.

CE has no "surrender" mechanic exposed to scripts; the flag
`CRITTER_MANUEVER_FLEEING` covers both retreat and surrender behavior.

### DH2 fleeing

**AI-driven flee** (combat.ts:1116):
```typescript
if (obj.getStat('HP') <= obj.ai!.info.min_hp) {
    // flee toward hardcoded left edge
    const targetPos = { x: 128, y: obj.position.y }
    this.walkUpTo(obj, idx, targetPos, AP.getAvailableMoveAP(), callback)
}
```

Flee target is always `x=128` (left edge of map). CE picks the nearest map edge
or a flee waypoint from the AI packet.

**Script-driven flee flag** (scripting.ts:1028):
```typescript
critter_set_flee_state(obj, isFleeing) {
    (obj as any).fleeing = !!isFleeing
}
critter_is_fleeing(obj) {
    return (obj as any).fleeing ? 1 : 0
}
```

The `.fleeing` property is set/read by scripts but **is not checked by `doAITurn`**.
A critter marked fleeing by script will not actually flee unless its HP also drops
below `min_hp`. This is a functional gap: CE honors `critter_set_flee_state`
immediately; DH2 ignores it in the AI loop.

`CRITTER_NO_FLEE` proto flag is not checked anywhere in DH2.

---

## 7. Combat Scripting Opcodes

### Direct opcodes

| Opcode | Name | Args | CE function | DH2 status | DH2 source | Notes |
|--------|------|------|-------------|------------|------------|-------|
| 0x8128 | `combat_is_initialized` | 0 | `opCombatIsInitialized` | IMPLEMENTED | vm_bridge.ts:51 | Returns `scriptObj.combat_is_initialized` (0/1); set to 1 when `combat_p_proc` fires |
| 0x80D0 | `attack_complex` | 8 | `opAttackComplex` | PARTIAL | scripting.ts:999 | Starts combat via `Combat.start(self_obj)`; all 7 parameters after `obj` ignored |
| 0x80ED | `kill_critter` | 2 | `opKillCritter` | PARTIAL | scripting.ts:883 | Calls `critterKill(obj)`; `deathFrame` parameter ignored |
| 0x80FB | `critter_state` | 1 | `opGetCritterState` | PARTIAL | scripting.ts:870 | Returns bitmask: bit 0 = dead; bit 1 (prone) always 0 (TODO) |
| 0x80FF | `critter_attempt_placement` | 3 | `opCritterAttemptPlacement` | IMPLEMENTED | scripting.ts:851 | Tries target tile then 6 neighbors; falls through to `move_to` |
| 0x8127 | `critter_injure` | 2 | `opCritterInjure` | IMPLEMENTED | scripting.ts:946 | ORs `how` into `critter.injuryFlags`; `how & 0x80` (DAM_DEAD) kills immediately |
| 0x8151 | `critter_is_fleeing` | 1 | `opCritterIsFleeing` | PARTIAL | scripting.ts:955 | Returns `.fleeing` flag; not synced with AI HP-based flee state |
| 0x8152 | `critter_set_flee_state` | 2 | `opCritterSetFleeState` | PARTIAL | scripting.ts:1028 | Sets `.fleeing` flag; AI loop does not honor it (gap documented in §6) |
| 0x8153 | `terminate_combat` | 0 | `opTerminateCombat` | IMPLEMENTED | scripting.ts:1024 | Calls `globalState.combat.forceEnd()` |
| 0x80B6 | `move_to` | 3 | `opMoveTo` | IMPLEMENTED | scripting.ts:1394 | Teleports object to tileNum; handles elevation change; centers camera for player |

### Missing opcodes (not in `vm_bridge.ts`)

| CE function | Opcode | Description | Impact |
|-------------|--------|-------------|--------|
| `opCritterStopAttacking` | 0x8155 | Clears hostile/aggro flag | NPCs can't be de-aggroed by script |
| `opKillCritterType` | — | Kill all critters of a given kill type | Mass-kill sequences broken |
| `opCritterDamage` | — | `critter_damage(obj, amount)` — direct HP reduction bypassing armor | Scripted damage events unavailable |
| `opAttackSetup` | — | Pre-configures an attack before `attack_complex` | Scripted called-shot attacks broken |

### `combat_is_initialized` detail

CE `opCombatIsInitialized` returns 1 when the engine's combat state machine is
active. DH2 uses `scriptObj.combat_is_initialized`, a property on the Script
instance set to 1 when `Scripting.combatEvent(obj, 'turnBegin')` fires and
the script's `combat_p_proc` exists (`scripting.ts:2093`). It is **not** the
same as `isCombatActive()` — a critter can have `combat_is_initialized = 1` only
during its own `combat_p_proc` callback.

### `attack_complex` detail

CE `opAttackComplex` signature:
```ssl
attack_complex(obj, called_shot, num_attacks, bonus, min_dmg, max_dmg,
               attacker_results, target_results)
```

DH2 ignores all parameters except `obj` (the initiating critter). It calls
`Combat.start(self_obj)` which begins a full normal combat turn. Scripts that
rely on `num_attacks > 1` or `bonus/min_dmg/max_dmg` overrides will not
get the expected behavior.

### `critter_state` bitmask

CE bitmask values:
```
bit 0 (0x01) — DAM_DEAD       : critter is dead
bit 1 (0x02) — DAM_KNOCKED_DOWN/OUT : critter is prone
```

DH2 only returns bit 0 (`obj.dead`). Bit 1 is documented as TODO in the source
(`scripting.ts:879`).

---

## 8. Known Gaps vs CE

| Feature | CE | DH2 | Impact |
|---------|-----|-----|--------|
| Knockback | `damage / divisor` hexes from attacker | Not implemented | Explosions and melee crits never displace targets |
| `critter_set_flee_state` effect | Sets `CRITTER_MANUEVER_FLEEING`; AI immediately retreats | Sets `.fleeing` flag only; AI ignores it | Script-triggered fleeing non-functional |
| `CRITTER_NO_FLEE` proto flag | Prevents AI from fleeing | Not checked | All critters can flee in DH2 |
| `critter_stop_attacking` (0x8155) | Clears critter hostility | MISSING | De-aggro scripts fail silently |
| `critter_state` prone bit | Bit 1 for knocked-down critters | Always 0 | Scripts checking `critter_state & 2` always get false |
| `attack_complex` parameters | `numAttacks`, `bonus`, `minDmg`, `maxDmg`, `attackerResults`, `targetResults` | All ignored | Multi-attack / scripted-damage combat triggers simplified to normal combat start |
| `kill_critter` `deathFrame` | Selects specific death animation by frame index | Ignored; uses damage-type fallback | Scripted death animations don't work |
| CE critter AP bonus | `_gcsd->actionPointsBonus` from proto `ap_bonus` field | Not tracked | AP overrides from critter proto not respected |
| `_combat_add_noncoms` | Adds nearby non-combatants to the fight mid-round | Not implemented | Large fights don't automatically pull in bystanders |
| Surrender | CE has no surrender flag but `CRITTER_MANUEVER_FLEEING` covers it | Critters that flee just walk to map edge | Same effective behavior |
| Fire DoT | CE applies at a specific phase; requires specific weapon flag | DH2 applies `onFireTurns--` at turn start | Timing differs slightly |
| LOS-based auto-enrollment | All critters in LOS at combat start | Only critters on `triggerTeams` | Bystanders don't join even if they can see the fight |
| Bonus AC from unused AP | Matches CE | Implemented (`bonusAC = getAvailableMoveAP()` at turn end) | ✓ matches |
| Called shot (player) | Full UI with targeting | Implemented via `uiCalledShot()` | ✓ matches for player |
| Called shot (AI) | AI can call shots based on ai.txt `hit_location` prefs | Not implemented | AI always targets torso |

---

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
