# Damage Formula — DarkHarold2 / Fallout 2

Cross-reference: `src/combat.ts` · fallout2-ce `combat.cc:attackComputeDamage` (lines ~4578–4615)

---

## Overview

Damage flows through three stages:

1. **Pre-formula modifiers** — adjust DT, DR, and add flat bonuses  
2. **Core formula** — four ruleset variants (configurable)  
3. **Post-formula bonuses** — flat perk additions after the formula

---

## DamageCalculationContext

```typescript
interface DamageCalculationContext {
    RD:       number  // raw die roll: getRandomInt(wep.minDmg, wep.maxDmg)
    bonus:    number  // flat bonus before multipliers (Bonus Ranged Damage perk)
    critMult: number  // 1 = normal, 2/3/… = critical multiplier from critical table
    ammoX:    number  // ammo damage multiplier  (PRO field: damMult; default 1)
    ammoY:    number  // ammo damage divisor     (PRO field: damDiv;  default 1)
    DT:       number  // damage threshold after bypass/penetrate reductions
    DR:       number  // damage resistance 0–100 after clamp and ammo RM applied
    CD:       number  // combat difficulty modifier: 75 / 100 / 125
}
```

---

## Stage 1 — Pre-Formula Modifiers

All adjustments happen to **DT** and **DR** (plus `bonus`) before the formula runs.

### Armor sources
```
DT = target.getStat("DT " + damageType) + target.getArmorDT(damageType)
DR = target.getStat("DR " + damageType) + target.getArmorDR(damageType)
```
For unarmed attacks, `damageType` is always `"Normal"`.

### DAM_BYPASS (`target.bypassArmorNextHit`)
Applied when a critical hit rolls the BYPASS effect (not EMP damage type):
```
DT = trunc(20 * DT / 100)   // ≈ 80% reduction
DR = trunc(20 * DR / 100)
```
Flag cleared immediately after consumption.

### PERK_WEAPON_PENETRATE / unarmed penetrating (`mode.penetrate`)
Only DT is reduced; DR is unchanged:
```
DT = trunc(20 * DT / 100)
```
Triggered by `wep.isPenetrating()` (weapon perk) or `mode.penetrate` (unarmed mode).

### TRAIT_FINESSE (player only)
Imposes a DR penalty on the attacker:
```
DR += 30
```
Applied regardless of BYPASS/PENETRATE (but only if no BYPASS this hit).

### Ammo DR modifier (RM)
```
DR += ammo.RM           // RM from ammoPRO.extra["DR modifier"]
DR = clamp(0, 100, DR)
```
Positive RM = harder to hurt (e.g. hollow point vs. armored targets).  
Negative RM = easier to hurt (e.g. AP rounds).

### Bonus Ranged Damage perk (player + non-melee only)
```
bonus = 2 * rankCount("Bonus Ranged Damage")
```
Flat bonus added to `RD` before any multipliers.

### Combat Difficulty modifier
```
CD = Config.combat.difficultyModifier   // Easy: 75 | Normal: 100 | Hard: 125
```

---

## Stage 2 — Core Formula Variants

Selected by `Config.combat.damageCalculationType` (default 0 = Vanilla).

### Vanilla (type 0 or default)
CE ref: `attackComputeDamage`, combat.cc ~4578.

```
d = RD + bonus
d = trunc(d × critMult × ammoX)
if ammoY ≠ 0: d = trunc(d / ammoY)
d = trunc(d / 2)                  ← Vanilla only
d = trunc(d × CD / 100)
d = d − DT
if d > 0: d = d − trunc(d × DR / 100)
if d < 0: d = 0
```

All divisions are integer-truncated (`Math.trunc`).

---

### Glovz (type 1)
DR applied **before** DT; uses round-half-up; `/2` folded into `ammoY × 2`.

```typescript
function glovzRound(a, b) { return trunc((a + trunc(b/2)) / b) }  // round-half-up
```

```
d = RD + bonus
d = d × critMult × ammoX
if ammoY ≠ 0: d = glovzRound(d, ammoY × 2)   ← halve via ammoY*2 + round-half-up
d = trunc(d × CD / 100)
d = d − glovzRound(d × DR, 100)              ← DR before DT
d = d − DT
if d < 0: d = 0
```

Key differences from Vanilla: DR before DT; round-half-up instead of truncate.

---

### GlovzTweak (type 2)
`critMult` applied **after** the ammo divide (not before):

```
d = RD + bonus
if ammoY ≠ 0: d = glovzRound(d × ammoX, ammoY × 2)  ← ammo first
d = d × critMult                                       ← crit after ammo
d = trunc(d × CD / 100)
d = d − glovzRound(d × DR, 100)
d = d − DT
if d < 0: d = 0
```

---

### YAAM (type 5)
Same as Vanilla but **no `/2` halving step**:

```
d = RD + bonus
d = trunc(d × critMult × ammoX)
if ammoY ≠ 0: d = trunc(d / ammoY)
                                   ← /2 step omitted
d = trunc(d × CD / 100)
d = d − DT
if d > 0: d = d − trunc(d × DR / 100)
if d < 0: d = 0
```

---

## Stage 3 — Post-Formula Perk Bonuses

Applied to the final `damage` value after the formula (player only):

| Perk | Condition | Bonus |
|------|-----------|-------|
| Living Anatomy | target `killType` ≠ 10 (robot) and ≠ 16 (alien) | +5 |
| Pyromaniac | `damageType === "Fire"` | +5 |

---

## Hit Chance Formula

CE ref: `combat.cc:_combat_to_hit`

```
hitChance = weaponSkill
          − AC
          − regionHitChanceDec[region]   // head: 40, eyes: 60, groin: 30, etc.
          − hitDistanceModifier
          − partialCoverPenalty          // 10 per intervening critter
          − crippledArmPenalty           // 40 per crippled arm
          − blindPenalty                 // 25 flat if blinded

hitChance = min(95, hitChance)           // 5% always-miss preserved
```

**hitDistanceModifier:**
```
dist = hexDistance(attacker, target)
tempPER = PER − 2    (player only; hardcoded FO2 penalty)
dist -= tempPER × distModifier    (distModifier = 2 normally; 4/5 for scope/long-range)
Sharpshooter perk: dist -= 2 per rank
if dist ≥ 0 and blinded: dist *= 12
elif dist ≥ 0:            dist *= 4
if dist < 0: modifier = 0
```

**Ammo AC modifier:**
```
AC = target.AC + target.armorAC + target.bonusAC + ammo.ACmod
```
Negative `ACmod` (AP rounds) makes the target easier to hit.

---

## Critical Hit Chance

```
critChance = baseCrit + regionHitChanceDec[region]
baseCrit   = player.getStat("Critical Chance") + (hasTrait("Finesse") ? 10 : 0)
```

Critical hit level (0–4):
```
critModifier = getStat("Better Criticals") + 30 * rankCount("Better Criticals")
level = floor(max(0, roll(critModifier, 100 + critModifier)) / 20)
```

Critical effects (kill type × region × level) are resolved from `lut/criticalTables.json`  
via `CriticalEffects.getCritical(killType, region, level)`.

**Special perk overrides:**
- **Slayer** — every melee hit is automatically critical
- **Sniper** — ranged hit: roll d100 ≤ LUK → upgrade to critical
- **Jinxed / Pariah Dog** — 50% chance to upgrade any miss to a critical miss (either combatant)

**Melee crits use half DM** (minimum 2):
```
critDM = max(2, floor(critDM / 2))   // for melee (non-unarmed) weapons only
```

---

## Sequence / Initiative

CE ref: `_combat_sequence`

```
sequence = 10 + 2 × PER
```

Combatants sorted descending. Ties: player goes first, then original array order.

---

## Action Points

CE ref: `critter_max_ap`, `party.cc:partyMemberGetMaxMembersToFollow`

```
baseAP = 5 + floor(AGI / 2)
totalAP = baseAP + bonusCombatAP + bonusMoveAP
```

Bonus sources:
- **Bonus HtH Attacks**: +1 AP per rank
- **Bonus Rate of Fire**: +1 AP per rank
- **Bonus Move**: +2 AP per rank (free movement)

---

## Divergences: DH2 vs. fallout2-ce

| Area | fallout2-ce | DarkHarold2 |
|------|------------|-------------|
| Damage types | 8 types (Normal, Laser, Fire, Plasma, Electrical, EMP, Explosive, Radiation) | All 8 wired |
| ammoX/ammoY | weapon PRO field lookup | PRO loaded via `loadPRO()` |
| Sequence ties | player wins; else random | player wins; else array order |
| Light level | reduces hit chance at night | **NOT implemented** (noted in getHitChance comment) |
| Distance modifier | `distModifier` 2/4/5 by weapon perk | only 2 (long_range/scope_range stubs) |
| EMP damage | special DR/DT tables | lookup via stat system (EMP DT/DR stats) |
| Critical tables | hardcoded in fallout2.exe | extracted to `lut/criticalTables.json` |
