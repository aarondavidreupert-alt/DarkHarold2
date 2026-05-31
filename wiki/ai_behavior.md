# AI Behavior — DarkHarold2 / Fallout 2

See also [damage_formula.md](damage_formula.md), [skill_checks.md](skill_checks.md)

CE refs: `combat_ai.cc`, `combat_ai.h`, `combat_ai_defs.h`, `party_member.cc`  
DH2 refs: `src/combat.ts` (`class AI`, `class Combat::doAITurn`), `src/object.ts` (Critter fields)

---

## 1. AIPacket Struct

CE ref: `combat_ai.cc:59` — `typedef struct AiPacket`

Each packet is one entry in `data/ai.txt`. The engine loads all entries via `aiInit()` into the global `gAiPackets[]` array. Critters reference a packet by the `aiPacket` integer stored in `CritterCombatData`.

| Field | Type | Description | Valid values |
|-------|------|-------------|--------------|
| `name` | `char*` | Packet name (key name in ai.txt) | Any string |
| `packet_num` | `int` | Unique packet identifier | Integer ≥ 0 |
| `max_dist` | `int` | Maximum engagement distance in tiles. If target is farther, AI disengages. | Integer tiles |
| `min_to_hit` | `int` | Minimum to-hit% the AI will accept before fleeing instead of attacking | 0–95 |
| `min_hp` | `int` | Absolute HP floor for flee check (used when `run_away_mode == -1`) | Integer HP |
| `aggression` | `int` | Unused in CE combat logic (read from ai.txt but not used in `_combat_ai`) | — |
| `hurt_too_much` | `int` | Bitmask of damage flags (`DAM_BLIND`, `DAM_CRIP_*`) that immediately trigger flee | Bitmask of `HurtTooMuch` values |
| `secondary_freq` | `int` | Denominator for 1-in-N random secondary-fire roll (used in `_ai_pick_hit_mode` when `area_attack_mode == -1`) | Integer ≥ 1 |
| `called_freq` | `int` | Frequency for called-shot selection (`_ai_called_shot`) | Integer |
| `font` | `int` | Display font for combat taunts | Font index |
| `color` | `int` | Taunt text colour | Colour index |
| `outline_color` | `int` | Taunt outline colour | Colour index |
| `chance` | `int` | 0–100 chance the AI will speak a combat taunt | 0–100 |
| `run` | `AiMessageRange` | Message range for run/flee taunts (start/end indices into combatai.msg) | int start, int end |
| `move` | `AiMessageRange` | Message range for movement taunts | — |
| `attack` | `AiMessageRange` | Message range for attack taunts | — |
| `miss` | `AiMessageRange` | Message range for miss taunts | — |
| `hit[HIT_LOCATION_SPECIFIC_COUNT]` | `AiMessageRange[]` | Per-hit-location message ranges | — |
| `area_attack_mode` | `int` | Controls when secondary (area) fire is used. `-1` = fall back to random `secondary_freq` roll | `AreaAttackMode` enum or -1 |
| `run_away_mode` | `int` | Flee mode; maps to an HP-percentage threshold via `_hp_run_away_value[]`. `-1` = use `min_hp` directly | `RunAwayMode` enum or -1 |
| `best_weapon` | `int` | Weapon-type preference used when comparing two candidate weapons | `BestWeapon` enum or -1 |
| `distance` | `int` | Movement preference: how the AI positions itself relative to its target | `DistanceMode` enum |
| `attack_who` | `int` | Target-selection policy | `AttackWho` enum |
| `chem_use` | `int` | Drug-use policy; controls when the AI consumes healing items or chems | `ChemUse` enum |
| `chem_primary_desire[3]` | `int[3]` | Up to 3 proto IDs of preferred drugs (used for random drug selection buckets) | PID or -1 |
| `disposition` | `int` | Attitude/engagement stance; affects party-member target filtering | `Disposition` enum or -1 |
| `body_type` | `char*` | Body type string from ai.txt (informational; actual body type comes from proto) | String |
| `general_type` | `char*` | General type string from ai.txt (informational) | String |

`AiMessageRange` is a simple `{ int start; int end; }` pair. Message indices are looked up in `combatai.msg`.

---

## 2. Enums

CE ref: `combat_ai_defs.h`

### `AttackWho` — target selection policy

| Value | Name | Behaviour |
|-------|------|-----------|
| 0 | `ATTACK_WHO_WHOMEVER_ATTACKING_ME` | Prefer the enemy currently attacking this critter or targeting a teammate; fall back to nearest |
| 1 | `ATTACK_WHO_STRONGEST` | Sort candidates by `_combatai_rating()` descending, pick highest-rated |
| 2 | `ATTACK_WHO_WEAKEST` | Sort candidates by `_combatai_rating()` ascending, pick lowest-rated |
| 3 | `ATTACK_WHO_WHOMEVER` | Return `whoHitMe` immediately if alive; no further sorting |
| 4 | `ATTACK_WHO_CLOSEST` | Sort candidates by tile distance, pick nearest |

### `RunAwayMode` — flee HP threshold

| Value | Name | `_hp_run_away_value` | Meaning |
|-------|------|-----------------------|---------|
| 0 | `RUN_AWAY_MODE_NONE` | 0% | Never flee based on HP |
| 1 | `RUN_AWAY_MODE_COWARD` | 25% | Flee when HP < 75% of max |
| 2 | `RUN_AWAY_MODE_FINGER_HURTS` | 40% | Flee when HP < 60% of max |
| 3 | `RUN_AWAY_MODE_BLEEDING` | 60% | Flee when HP < 40% of max |
| 4 | `RUN_AWAY_MODE_NOT_FEELING_GOOD` | 75% | Flee when HP < 25% of max |
| 5 | `RUN_AWAY_MODE_TOURNIQUET` | 100% | Flee immediately at any damage |
| 6 | `RUN_AWAY_MODE_NEVER` | — | Never flee (no table entry used) |

Actual minimum HP is computed by `_cai_get_min_hp()`:  
`minHp = maxHp − (maxHp × _hp_run_away_value[run_away_mode] / 100)` (see Section 5 for full formula).

### `BestWeapon` — weapon-type preference

| Value | Name | Attack-type preference order |
|-------|------|------------------------------|
| 0 | `BEST_WEAPON_NO_PREF` | Ranged → Throw → Melee → Unarmed |
| 1 | `BEST_WEAPON_MELEE` | Melee only |
| 2 | `BEST_WEAPON_MELEE_OVER_RANGED` | Melee → Ranged |
| 3 | `BEST_WEAPON_RANGED_OVER_MELEE` | Ranged → Melee |
| 4 | `BEST_WEAPON_RANGED` | Ranged only |
| 5 | `BEST_WEAPON_UNARMED` | Unarmed only |
| 6 | `BEST_WEAPON_UNARMED_OVER_THROW` | Unarmed → Throw |
| 7 | `BEST_WEAPON_RANDOM` | Random 50/50 coin flip between two candidates |

CE ref: `combat_ai.cc:269` — `_weapPrefOrderings[]` matrix (indexed by `best_weapon + 1`).

### `DistanceMode` — movement stance

| Value | Name | Behaviour |
|-------|------|-----------|
| 0 | `DISTANCE_STAY_CLOSE` | Stay within 5 tiles of player (gDude); will not chase target past that radius |
| 1 | `DISTANCE_CHARGE` | Move adjacent to target before every attack |
| 2 | `DISTANCE_SNIPE` | Maintain ≥ 10 tile standoff; back away if closer and weaker than target |
| 3 | `DISTANCE_ON_YOUR_OWN` | No distance preference |
| 4 | `DISTANCE_STAY` | Never move (cannot `_ai_move_away` either) |

Party-member maximum distance from gDude (when no target): Stay Close=5, all others=7, Stay=50000.  
CE ref: `combat_ai.cc:3056` — `aiPartyMemberDistances[]`.

### `AreaAttackMode` — secondary-fire policy

| Value | Name | Condition |
|-------|------|-----------|
| 0 | `AREA_ATTACK_MODE_ALWAYS` | Always use secondary attack mode |
| 1 | `AREA_ATTACK_MODE_SOMETIMES` | 1-in-`secondary_freq` random chance |
| 2 | `AREA_ATTACK_MODE_BE_SURE` | Use secondary if to-hit ≥ 85% and no friendly-fire risk |
| 3 | `AREA_ATTACK_MODE_BE_CAREFUL` | Use secondary if to-hit ≥ 50% and no friendly-fire risk |
| 4 | `AREA_ATTACK_MODE_BE_ABSOLUTELY_SURE` | Use secondary if to-hit ≥ 95% and no friendly-fire risk |

### `ChemUse` — drug-use policy

| Value | Name | When drugs are used |
|-------|------|---------------------|
| 0 | `CHEM_USE_CLEAN` | Never |
| 1 | `CHEM_USE_STIMS_WHEN_HURT_LITTLE` | HP < 60% of max |
| 2 | `CHEM_USE_STIMS_WHEN_HURT_LOTS` | HP < 30% of max |
| 3 | `CHEM_USE_SOMETIMES` | Every 3rd turn, 25% chance |
| 4 | `CHEM_USE_ANYTIME` | Every 3rd turn, 75% chance |
| 5 | `CHEM_USE_ALWAYS` | 100% chance each turn |

CE ref: `combat_ai.cc:44` — `kChemUse*` constants.

### `Disposition` — engagement attitude

| Value | Name | Effect on party members |
|-------|------|-------------------------|
| 0 | `DISPOSITION_NONE` | No filtering (`ignoreFleeingCritters = false`) |
| 1 | `DISPOSITION_CUSTOM` | `ignoreFleeingCritters = true` |
| 2 | `DISPOSITION_COWARD` | `ignoreFleeingCritters = true` |
| 3 | `DISPOSITION_DEFENSIVE` | `ignoreFleeingCritters = true` |
| 4 | `DISPOSITION_AGGRESSIVE` | `ignoreFleeingCritters = true` |
| 5 | `DISPOSITION_BERKSERK` | `ignoreFleeingCritters = false` (CE typo: "BERKSERK") |

If `ignoreFleeingCritters` is true **and** `distance == DISTANCE_CHARGE`, `ignoreFleeingCritters` is reset to false.  
CE ref: `combat_ai.cc:1542`.

### `HurtTooMuch` — damage-flag flee trigger

Stored in `ai->hurt_too_much` as a bitmask. Matching any bit in `critter.combat.results` immediately triggers `_ai_run_away`.

| Value | Name | Condition |
|-------|------|-----------|
| `HURT_BLIND` | Blind | `DAM_BLIND` set |
| `HURT_CRIPPLED` | Any limb crippled | `DAM_CRIP_LEG_LEFT \| DAM_CRIP_LEG_RIGHT \| DAM_CRIP_ARM_LEFT \| DAM_CRIP_ARM_RIGHT` |
| `HURT_CRIPPLED_LEGS` | Legs crippled | `DAM_CRIP_LEG_LEFT \| DAM_CRIP_LEG_RIGHT` |
| `HURT_CRIPPLED_ARMS` | Arms crippled | `DAM_CRIP_ARM_LEFT \| DAM_CRIP_ARM_RIGHT` |

CE ref: `combat_ai.cc:242` — `_rmatchHurtVals[]`.

---

## 3. Combat Decision Loop

CE ref: `combat_ai.cc:3053` — `void _combat_ai(Object* a1, Object* a2)`

`_combat_ai` is the per-turn entry point. `a1` is the acting critter; `a2` is a hint target (may be null).

```
_combat_ai(critter, hintTarget):
    ai = aiGetPacket(critter)

    // ── Step 1: Flee check ─────────────────────────────────────────────────
    hpRatio = _cai_get_min_hp(ai)                 // see Section 5
    if CRITTER_MANUEVER_FLEEING in combatData.maneuver
       OR (combatData.results & ai.hurt_too_much) != 0
       OR critter.HP < ai.min_hp:
        _ai_run_away(critter, hintTarget)
        return

    // ── Step 2: Drug check ─────────────────────────────────────────────────
    if _ai_check_drugs(critter):                  // returned non-zero means fled after drugs
        _ai_run_away(critter, hintTarget)
    else:
        // ── Step 3: Target resolution ──────────────────────────────────────
        if hintTarget == null:
            hintTarget = _ai_danger_source(critter)   // see Section 4

        // ── Step 4: Pre-attack positioning ────────────────────────────────
        _cai_perform_distance_prefs(critter, hintTarget)  // see below

        // ── Step 5: Attack ────────────────────────────────────────────────
        if hintTarget != null:
            _ai_try_attack(critter, hintTarget)           // see below

    // ── Step 6: Disengage if over max_dist ────────────────────────────────
    if hintTarget != null AND target alive AND critter.AP > 0
       AND distance(critter, hintTarget) > ai.max_dist:
        friendlyDead = aiInfoGetFriendlyDead(critter)
        if friendlyDead:
            _ai_move_away(critter, friendlyDead, 10)
        else if not _ai_find_friend(critter, perception*2, 5):
            combatData.maneuver |= CRITTER_MANEUVER_DISENGAGING

    // ── Step 7: Invisible sniper reaction ─────────────────────────────────
    if hintTarget == null AND not party member:
        if whoHitMe != null AND whoHitMe alive AND damageLastTurn > 0:
            if friendlyDead: move away from friendlyDead
            else: _ai_run_away(critter, null)        // "can't see who shot me"

    // ── Step 8: Move away from dead ally ──────────────────────────────────
    if aiInfoGetFriendlyDead(critter) != null:
        _ai_move_away(critter, friendlyDead, 10)

    // ── Step 9: Rally to nearest teammate ─────────────────────────────────
    if hintTarget == null AND teammate farther than maxTeammateDistance:
        _ai_move_steps_closer(critter, teammate, overshoot, false)
    else if AP > 0:
        _cai_perform_distance_prefs(critter, hintTarget)   // use remaining AP
```

### `_cai_perform_distance_prefs` (CE ref: `combat_ai.cc:2970`)

```
switch ai.distance:
    DISTANCE_STAY_CLOSE:
        if whoHitMe != gDude AND dist(critter, gDude) > 5:
            move critter toward gDude
    DISTANCE_CHARGE:
        move adjacent to hintTarget
    DISTANCE_SNIPE:
        if dist < 10:
            movementAP = critter.ap - weapon.apCost
            if can't open gap to 10 tiles OR critter weaker than target:
                _ai_move_away(critter, target, 10)
    // DISTANCE_ON_YOUR_OWN, DISTANCE_STAY: no action

// Friendly-fire avoidance: after stance positioning, retarget tile
//  to avoid shooting through teammates (_cai_retargetTileFromFriendlyFire)
if new tile found AND tile != current tile:
    animateMoveTo(new tile, critter.ap)
```

### `_ai_try_attack` inner loop (CE ref: `combat_ai.cc:2692`)

Runs up to 10 attempts per turn:

```
for attempt in 0..9:
    if critter knocked-out/dead/lost-turn: break

    reason = _combat_check_bad_shot(attacker, defender, hitMode)
    switch reason:
        NO_AMMO:
            try reload from inventory → if none, search environment → if none, unwield + switch weapon
        NOT_ENOUGH_AP / ARM_CRIPPLED:
            _ai_switch_weapons() or return -1
        OUT_OF_RANGE:
            if to-hit even at point-blank < min_to_hit: flee
            else: move closer by actionPoints steps
        AIM_BLOCKED:
            move closer by all remaining AP
        OK:
            if accuracy < min_to_hit:
                compute path toward target until to-hit >= min_to_hit
                if can't get closer: flee
                move, then attack
            else:
                attack
```

---

## 4. Target Selection (`_ai_danger_source`)

CE ref: `combat_ai.cc:1529`

There is no `aiGetTarget` or `_aiGetTarget` function in CE. Target selection is performed by `_ai_danger_source(Object* critter)`.

**Candidate pool:** `_curr_crit_list[]` — all critters active in the current combat, set by `_combat_ai_begin()`.

```
_ai_danger_source(critter):
    targets[4] = { null, null, null, null }
    attackWho = -1

    if party member:
        disposition = aiGetDisposition(critter)
        ignoreFleeingCritters = (disposition in CUSTOM/COWARD/DEFENSIVE/AGGRESSIVE)
        if ignoreFleeingCritters AND distance == DISTANCE_CHARGE:
            ignoreFleeingCritters = false

        attackWho = aiGetAttackWho(critter)

        // Special case: ATTACK_WHO_WHOMEVER_ATTACKING_ME
        if attackWho == WHOMEVER_ATTACKING_ME:
            1. Try to re-use lastTarget if still valid (alive, enemy team, targeting gDude, not fleeing)
            2. If invalid: sort _curr_crit_list by distance to self
               scan for nearest alive enemy-team critter whose lastTarget == gDude,
               pathfinder can reach, and _combat_check_bad_shot allows (OK/NO_AMMO/OUT_OF_RANGE)
            return first valid candidate (or fall through)

        if attackWho in STRONGEST/WEAKEST/CLOSEST:
            clear whoHitMe (force full scan)
    else:
        attackWho = -1   // hostile NPCs: treat as WHOMEVER

    // Populate targets[] from combat state
    whoHitMe = critter.combat.whoHitMe
    if whoHitMe alive:
        if attackWho == WHOMEVER OR attackWho == -1: return whoHitMe immediately
        else: targets[0] = whoHitMe (or nearest teammate of dead whoHitMe)

    aiFindAttackers(critter, &targets[1], &targets[2], &targets[3])
    //  targets[1] = nearest enemy attacking ME
    //  targets[2] = enemy attacking MY teammate
    //  targets[3] = enemy being attacked by my teammate

    // Filter fleeing critters if disposition says to
    if ignoreFleeingCritters:
        for each target: if critterIsFleeing(target): target = null

    // Sort by policy
    switch attackWho:
        STRONGEST: sort by _combatai_rating() descending
        WEAKEST:   sort by _combatai_rating() ascending
        default:   sort by tile distance ascending

    // Return first reachable, within-perception target
    for each candidate in targets[]:
        if candidate != null AND isWithinPerception(critter, candidate):
            if pathfinder can reach OR _combat_check_bad_shot == OK:
                return candidate

    return null
```

### `_combatai_rating` (CE ref: `combat_ai.cc:3449`)

Used for STRONGEST/WEAKEST sorting:

```
rating(obj) = max(STAT_MELEE_DAMAGE, weapon.damage_max) + STAT_ARMOR_CLASS
```

Evaluates both hand slots; returns 0 if dead or knocked out.

### `aiFindAttackers` (CE ref: `combat_ai.cc:1457`)

Walks `_curr_crit_list` sorted by distance and fills three target slots:

- `whoHitMePtr` — nearest enemy whose `whoHitMe == critter` (someone attacking me)
- `whoHitFriendPtr` — nearest enemy attacking a teammate
- `whoHitByFriendPtr` — nearest enemy being attacked by a teammate

Each slot is filled at most once (continue after fill, so no double-counting).

### Perception check (`isWithinPerception`)

CE ref: `combat_ai.cc:3499`

```
line-of-sight range  = STAT_PERCEPTION × 5 tiles
  (halved if target has OBJECT_TRANS_GLASS flag)
  (÷ 4 if player is sneaking successfully; × 2/3 if DUDE_STATE_SNEAKING only)

non-LOS range        = STAT_PERCEPTION × 2 in combat, × 1 out of combat
  (same sneak modifiers apply)

returns true if distance <= either range
```

---

## 5. Flee Logic (`_ai_run_away`)

CE ref: `combat_ai.cc:1173`

### Flee threshold formula

`_cai_get_min_hp` (CE ref: `combat_ai.cc:3036`):

```
if run_away_mode >= 0 AND < RUN_AWAY_MODE_COUNT:
    hpPercent = _hp_run_away_value[run_away_mode]   // 0/25/40/60/75/100
    minHp     = maxHp − (maxHp × hpPercent / 100)
else if run_away_mode == -1:
    minHp = ai.min_hp                               // raw absolute value from packet
else:
    minHp = 0
```

The flee check in `_combat_ai` fires when **any** of:
- `CRITTER_MANUEVER_FLEEING` flag is already set, **or**
- `critter.combat.results & ai.hurt_too_much` is non-zero (hurt-too-much bitmask), **or**
- `critter.HP < ai.min_hp` (absolute HP floor, not the percentage threshold directly — `min_hp` is set from the percentage by `aiSetRunAwayMode`)

`_ai_check_drugs` returning non-zero also triggers `_ai_run_away` (drug-search failure path — CE code notes "I need DRUGS!").

### What happens during flee

```
_ai_run_away(critter, target):
    if target == null: target = gDude

    dist = distance(critter, target)
    if dist < ai.max_dist:
        // Still within engagement distance — must run
        combatData.maneuver |= CRITTER_MANUEVER_FLEEING
        rotation = directionAwayFrom(target)

        // Try to find a tile actionPoints steps away in 3 rotation variants
        for steps = actionPoints downto 1:
            try destination = tileInDirection(rotation, steps)
            or  destination = tileInDirection((rotation+1)%6, steps)
            or  destination = tileInDirection((rotation+5)%6, steps)
            if any path is valid: break

        if found valid destination:
            play run taunt message
            animateRunTo(destination, critter.AP)
    else:
        // Already beyond max_dist — just mark disengaging, no animation
        combatData.maneuver |= CRITTER_MANEUVER_DISENGAGING
```

The fleeing flag persists into future turns: `_combat_ai` checks it first before any other logic, causing the critter to flee again on subsequent turns until cleared.

---

## 6. Weapon / Attack Mode Selection

### `_ai_best_weapon` (CE ref: `combat_ai.cc:1817`)

Called iteratively by `_ai_search_inven_weap` to find the best weapon in inventory.

```
_ai_best_weapon(attacker, weapon1, weapon2, defender):
    if best_weapon == BEST_WEAPON_RANDOM: return random choice

    For each weapon (non-null):
        attackType = weaponGetAttackTypeForHitMode(weapon, PRIMARY)
        avgDamage  = (minDamage + maxDamage) / 2
        if weapon has area damage AND defender != null:
            count extras from explosion; avgDamage *= (extrasCount + 1)
        if weapon has perk: avgDamage *= 2    // perk bonus multiplier
        if weapon would cause friendly fire: ignoreWeapon = true
        if weapon is hidden (OBJECT_FLAG_HIDDEN): return it immediately (special case)
        order = position of attackType in _weapPrefOrderings[best_weapon+1][]

    if order1 == order2:
        if both == 999 (neither in preference list): return null
        if |avgDamage2 − avgDamage1| ≤ 5: return more expensive one
        return higher-damage weapon
    if weapon is flare and other is real weapon: prefer real weapon
    if best_weapon is -1 or ≥ UNARMED_OVER_THROW AND |dmg diff| > 5: return higher damage
    return weapon with lower (better) preference order index
```

`_ai_search_inven_weap` (CE ref: `combat_ai.cc:2002`) scans the critter's inventory:
- Skips non-BIPED/non-ROBOTIC critters (unless special PID `0x1000098`)
- Skips weapons the critter cannot use (`_ai_can_use_weapon`)
- Skips empty ranged weapons with no ammo in inventory
- Calls `_ai_best_weapon` as a fold/reduce over all candidates

### `_ai_can_use_weapon` preconditions (CE ref: `combat_ai.cc:1972`)

- Both arms must not be crippled (can't hold anything)
- If one arm crippled: weapon must be one-handed
- Critter must have the required animation FID
- Skill value for the weapon must be ≥ `ai.min_to_hit`
- Weapon attack type must be in `_weapPrefOrderings[best_weapon+1]`

### `_ai_pick_hit_mode` (CE ref: `combat_ai.cc:2262`)

Decides primary vs. secondary attack mode:

```
if no weapon: return HIT_MODE_PUNCH
if weapon has no secondary mode or critter can't use it: return PRIMARY

useSecondaryMode = false

if ai.area_attack_mode != -1:
    switch area_attack_mode:
        ALWAYS:               useSecondaryMode = true
        SOMETIMES:            useSecondaryMode = (random 1..secondary_freq == 1)
        BE_SURE:              useSecondaryMode = (to-hit >= 85 AND no friendly fire)
        BE_CAREFUL:           useSecondaryMode = (to-hit >= 50 AND no friendly fire)
        BE_ABSOLUTELY_SURE:   useSecondaryMode = (to-hit >= 95 AND no friendly fire)
else:
    // No area_attack_mode set
    if intelligence < 6 OR distance to target < 10:
        useSecondaryMode = (random 1..secondary_freq == 1)

// Additional guards (SFALL additions in CE):
if useSecondaryMode AND attackType not in weapon pref list: useSecondaryMode = false
if useSecondaryMode AND dist > secondary weapon range:      useSecondaryMode = false
if useSecondaryMode AND AP < secondary weapon AP cost:      useSecondaryMode = false

// Final guard: if secondary is throw AND no other weapons AND intelligence roll > 1: don't throw last weapon
if useSecondaryMode AND attackType == THROW
   AND _ai_search_inven_weap() == null
   AND statRoll(STAT_INTELLIGENCE, 0) > 1:
    useSecondaryMode = false

return useSecondaryMode ? SECONDARY : PRIMARY
```

---

## 7. Healing (`_ai_check_drugs`)

CE ref: `combat_ai.cc:955`

`_ai_check_drugs` handles **healing items and general chems** (not a distinct `aiTryToHeal` — there is no function by that name in CE).

```
_ai_check_drugs(critter):
    if critter body type != BIPED: return 0

    if no lastItem pending:
        switch chem_use:
            CLEAN: return 0
            STIMS_WHEN_HURT_LITTLE: use stims if HP < maxHp × 60%
            STIMS_WHEN_HURT_LOTS:   use stims if HP < maxHp × 30%
            SOMETIMES:  if turn%3==0: chemUseChance = 25%
            ANYTIME:    if turn%3==0: chemUseChance = 75%
            ALWAYS:                  chemUseChance = 100%

        // Healing items first (stims path)
        while HP < minHp AND AP >= 2:
            drug = find next ITEM_TYPE_DRUG in inventory
            if drug is healing item: consume it, AP -= 2

        // Chem path (if no healing done and chance fires)
        if not drugUsed AND randomBetween(0,100) < chemUseChance:
            collect drugs into:
              primaryDrugs[]   — drugs matching chem_primary_desire[] PIDs
              secondaryDrugs[] — all other non-healing drugs
            consume in random order (primary first), AP -= 2 per drug
            SOMETIMES: stop after 1 drug
            ANYTIME:   stop after 2 drugs
            ALWAYS:    continue until AP < 2

    // If nothing worked: search environment for ITEM_TYPE_DRUG or ITEM_TYPE_MISC
    if no drug found and nothing used:
        lastItem = _ai_search_environ(critter, DRUG)
        if not found: lastItem = _ai_search_environ(critter, MISC)
        if found: _ai_retrieve_object() to pick it up, then consume

    return 0   // NOTE: always returns 0 in CE; the caller checks for fleeing separately
```

**Important:** `_ai_check_drugs` always returns 0. The `_combat_ai` check `if (_ai_check_drugs(a1))` is a CE quirk — the block inside (`_ai_run_away`) only fires if the return value is non-zero, which never happens. The debug print "I need DRUGS!" would appear in that dead branch. Actual drug use is performed as a side effect of calling the function; the critter does not flee because of it.

Items the AI uses:
- Any `ITEM_TYPE_DRUG` where `itemIsHealing(pid)` is true (stim path)
- Any drug/misc item in `chem_primary_desire[]` (chem path)
- All other non-healing `ITEM_TYPE_DRUG` items (secondary chem path)
- Drugs and misc items from the ground within search range (environment path)

Eligibility for drug use (`aiCanUseItem`, CE ref: `combat_ai.cc:2105`):
- PID is in `chem_primary_desire[]`, **or**
- Body type BIPED, kill type is human/super mutant/ghoul/child, `STAT_INTELLIGENCE >= 3`, and item is healing

---

## 8. Party Member AI

CE refs: `combat_ai.cc:1541`, `party_member.cc:1292`, `party_member.cc:1407`

Party members use the same `_combat_ai` entry point as hostile NPCs. The differences are:

### Target filtering (disposition-aware)

Only party members reach the `if (objectIsPartyMember(a1))` branch in `_ai_danger_source`. This branch:
- Reads `Disposition` to set `ignoreFleeingCritters`
- Honours `AttackWho` policy (hostile NPCs always get `attackWho = -1`, which behaves like `WHOMEVER`)
- `ATTACK_WHO_WHOMEVER_ATTACKING_ME` has CE-enhanced logic: try to continue attacking the last target if still valid, rather than always picking the nearest new one (avoids wasted movement)

### Distance enforcement

Party members with `DISTANCE_STAY_CLOSE` use `aiPartyMemberDistances[]` to cap how far they stray from gDude:

| DistanceMode | Max tiles from gDude |
|--------------|----------------------|
| STAY_CLOSE | 5 |
| CHARGE, SNIPE, ON_YOUR_OWN | 7 |
| STAY | 50000 (effectively unlimited) |

When no target is found and a party member is more than `maxTeammateDistance` tiles from gDude, the AI moves back toward gDude (Step 9 of `_combat_ai`).

### Weapon switching after combat

`aiAttemptWeaponReload` (CE ref: `combat_ai.cc:2914`) plays the reload animation **only** for party members (`objectIsPartyMember`).

### Armor upgrades

`_ai_search_inven_armor` (CE ref: `combat_ai.cc:2051`) only runs for party members — hostile NPCs never search for better armor.

### `partyMemberDescription` constraints

CE ref: `party_member.cc`

Each party member's description (loaded from `party.txt`) defines which AI options the player may set for them via the party-member control panel:

- `partyMemberSupportsDisposition(critter, disposition)` — returns true if the given disposition is allowed for this NPC
- `partyMemberSupportsAttackWho(critter, attackWho)` — same for attack-who policy
- `partyMemberSupportsAreaAttackMode(critter, areaAttackMode)` — same for area attack mode
- `partyMemberSupportsRunAwayMode(critter, runAwayMode)` — same for run-away mode

These functions do not affect the AI loop itself — they only gate what the player is allowed to change in the UI.

---

## 9. DH2 Status Table

CE ref: `combat_ai.cc` / `combat_ai_defs.h`  
DH2 ref: `src/combat.ts` (class `AI`, class `Combat::doAITurn`)

| System | DH2 Status | Notes |
|--------|-----------|-------|
| AiPacket loading (ai.txt) | WIRED | `AI.init()` parses ai.txt, stores per-packet info; numeric fields converted |
| `run_away_mode` / HP flee threshold | PARTIAL | DH2 compares `critter.HP <= ai.info.min_hp` (absolute), but `min_hp` is read directly from ai.txt — the `_hp_run_away_value[]` percentage conversion is not applied; `run_away_mode` field is not read |
| `hurt_too_much` bitmask flee | MISSING | No check for damage-flag-triggered flee |
| `CRITTER_MANUEVER_FLEEING` flag persistence | MISSING | No persistent maneuver flag; flee is computed fresh each turn |
| Flee movement (`_ai_run_away`) | PARTIAL | DH2 flees to map left edge `{x:128, y:obj.y}` instead of computing rotation-based hex direction |
| Target selection (`_ai_danger_source`) | PARTIAL | DH2 `findTarget()` picks nearest enemy only (distance sort); no `AttackWho` policy, no `whoHitMe` priority, no perception check |
| `AttackWho` enum | MISSING | Field not read; field present in ai.txt packet but ignored |
| `Disposition` enum | MISSING | Field not read |
| `isWithinPerception` | MISSING | No perception range check during target selection |
| Distance mode (`_cai_perform_distance_prefs`) | MISSING | No distance stance logic; critter always charges |
| Weapon selection (`_ai_search_inven_weap`) | PARTIAL | DH2 switches between left/right hand once per turn based on range vs. melee/gun heuristic; no `BestWeapon` preference, no inventory scan beyond two hands |
| `_ai_can_use_weapon` preconditions | MISSING | No crippled-arm check, no animation-FID check, no min_to_hit skill filter for weapons |
| `_ai_pick_hit_mode` (primary vs. secondary) | PARTIAL | DH2 selects burst fire when ≥ 2 targets in burst range and enough AP; `AreaAttackMode` enum and `secondary_freq` not consulted |
| `area_attack_mode` / `secondary_freq` | MISSING | Fields exist in ai.txt packet but not used |
| Ammo reload during turn | PARTIAL | DH2 reloads from inventory if matching `ammoPID` found; no `_ai_search_environ` for ground ammo |
| Drug/healing use (`_ai_check_drugs`) | MISSING | No implementation |
| `ChemUse` enum | MISSING | Field not read |
| `_ai_best_weapon` damage comparison | MISSING | No damage-scoring of inventory weapons |
| Friendly-fire avoidance (`_cai_retargetTileFromFriendlyFire`) | MISSING | No friendly-fire tile retargeting |
| `min_to_hit` accuracy flee | MISSING | DH2 never flees because to-hit is too low |
| `max_dist` disengage | MISSING | No disengage at `max_dist` tiles |
| Party-member vs. hostile NPC distinction | MISSING | No `objectIsPartyMember` distinction in DH2 AI loop |
| Party-member armor upgrade | MISSING | `_ai_search_inven_armor` not implemented |
| `_combatai_rating` | MISSING | No critter threat-rating function |
| `_combatai_check_retaliation` | MISSING | Not implemented |
| `_combatai_notify_onlookers` / `_combatai_notify_friends` | MISSING | Not implemented |
| `_combatai_want_to_join` / `_combatai_want_to_stop` | MISSING | Not implemented; DH2 uses `hostile` flag for participation |

---

## 10. Divergences Table

DH2 vs. fallout2-ce

| Area | fallout2-ce | DarkHarold2 |
|------|------------|-------------|
| Flee threshold formula | `minHp = maxHp − (maxHp × _hp_run_away_value[run_away_mode] / 100)` from `RunAwayMode` enum | `critter.HP <= ai.min_hp` read directly as integer from ai.txt; `run_away_mode` enum not used |
| Flee-flag persistence | `CRITTER_MANUEVER_FLEEING` flag set and checked across turns | No flag; flee condition recalculated from scratch each turn |
| Hurt-too-much flee | Immediate flee on `DAM_BLIND` or crippled-limb flags (bitmask) | Not implemented |
| Flee movement direction | Away from target in one of three rotation candidates, up to full AP | Hard-coded left edge `x=128` |
| Target selection | `_ai_danger_source`: respect `AttackWho`, `whoHitMe`, `disposition`, perception check, pathfinder reachability | Nearest enemy by tile distance, no policy, no perception, no path check |
| `ATTACK_WHO_WHOMEVER_ATTACKING_ME` | Prefer last valid target before scanning; avoid fleeing critters if disposition says so | Not implemented |
| STRONGEST / WEAKEST targeting | `_combatai_rating()` = max weapon damage + AC | Not implemented |
| Weapon preference (`BestWeapon`) | Full `_weapPrefOrderings` matrix; damage comparison with ≤5 tie-breaker, cost tie-breaker | Binary melee-vs-gun check based only on range vs. distance |
| Secondary attack mode | `_ai_pick_hit_mode`: `area_attack_mode`, `secondary_freq`, intelligence, range, AP checks | Burst fire used when ≥ 2 targets and enough AP; `area_attack_mode`/`secondary_freq` ignored |
| Drug use | `_ai_check_drugs`: HP-ratio checks, `ChemUse` enum, primary/secondary desire buckets, ground search | Not implemented |
| Perception range | `STAT_PERCEPTION × 5` (LOS) / `STAT_PERCEPTION × 2` (non-LOS); halved for sneak | No perception range check; all combatants always visible |
| Distance stance | `DISTANCE_STAY_CLOSE`, `CHARGE`, `SNIPE`, `ON_YOUR_OWN`, `STAY` | Always charges (no DistanceMode logic) |
| `max_dist` disengage | AI sets `CRITTER_MANEUVER_DISENGAGING` when target exceeds `max_dist` | Not implemented |
| `min_to_hit` flee | Flee if to-hit even at point-blank < `min_to_hit` | Not implemented |
| Party member distinction | Separate targeting branch (`disposition`, `attack_who`), armor upgrade, distance-to-gDude enforcement | No `objectIsPartyMember` distinction in combat loop |
| Friendly-fire avoidance | `_cai_retargetTileFromFriendlyFire` repositions attacker tile before firing | Not implemented |
| `_combatai_check_retaliation` | Switch `whoHitMe` to highest-rated attacker when hit | Not implemented |
| Awareness (`_combatai_notify_onlookers`) | Critters in perception range of a combat event join combat | Not implemented; DH2 enrolls all critters with `hostile=true` at combat start |
