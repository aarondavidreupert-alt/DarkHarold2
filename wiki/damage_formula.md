# Damage Formula — DarkHarold2 / Fallout 2

Cross-reference: `src/combat/damage.ts` · fallout2-ce `combat.cc:attackComputeDamage` (lines ~4578–4615)  
See also [skill_checks.md](skill_checks.md) for the `skillRoll` mechanic used in non-combat skill checks.

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

### Bonus Ranged Damage perk (player, ATTACK_TYPE_RANGED only — not thrown)
```
bonus = 2 * rankCount("Bonus Ranged Damage")
```
Flat bonus added to `RD` before any multipliers.

### Combat Difficulty modifier
```
CD = attacker on the player's team ? 100 : Config.combat.difficultyModifier   // Easy 75 | Normal 100 | Hard 125
```
CE `attackComputeDamage` applies the difficulty only to attackers outside the player's team (fixed 2026-10-17).

### Raw damage RD (CE item.cc `weaponGetDamage`)
```
RD = randomBetween(min, max)                          // ranged / thrown
RD = randomBetween(min, max + Melee Damage)           // melee weapons and unarmed
     player: min += 2 × Bonus HtH Damage rank         // sfall Bonus HtH Damage fix, CE default
```
Melee Damage was not added in DH2 before 2026-10-17.

### PERK_WEAPON_PENETRATE (weapon perk 60)
DT is cut to 20% (like a penetrating unarmed move); DR is unchanged.

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

### Glovz (type 1 and 2)
CE ref: `damageModCalculateGlovz`, combat.cc ~6662.

Glovz is a fundamentally different algorithm, not a simple reordering of the Vanilla steps.
Uses banker's rounding (`damageModGlovzDivRound`, combat.cc ~6745).

Pre-loop adjustments (applied once, not per round):
```
ammoX = max(1, weaponAmmoMultiplier)
ammoY = max(1, weaponAmmoDivisor)
ammoDR = −abs(weaponAmmoDamageResistanceModifier)  ← always negated
adjustedDT = glovzRound(DT, ammoY)                 ← if DT > 0
adjustedDR = DR                                     ← if DR > 0:
    if CD > 100: adjustedDR -= 20
    if CD < 100: adjustedDR += 20
    adjustedDR += ammoDR
    adjustedDR = glovzRound(adjustedDR, ammoX)
    if adjustedDR >= 100: return 0 damage
```

Per-round loop:
```
d = weaponGetDamage() + bonus
if DT > 0: d -= adjustedDT;  skip round if d ≤ 0
if DR > 0: d -= glovzRound(d × adjustedDR, 100); skip round if d ≤ 0
[ammo bonus if DT=0 and DR=0: add 10–20% based on ammoX/ammoY]
```

Crit multiplier application (at end, differs by type):
- Type 1 (GLOVZ):            `d += d × bonusDamageMultiplier / 2`
- Type 2 (GLOVZ_WITH_TWEAK): `d += glovzRound(d × bonusDamageMultiplier × 25, 100)`

Key differences from Vanilla: DT is applied **before** DR (same order); ammo multiplier
and difficulty are folded into pre-adjusted DT/DR rather than applied mid-formula;
no `/2` halving step; crit multiplier is a percentage bonus, not a direct multiply.

---

### YAAM (type 5)
CE ref: `damageModCalculateYaam`, combat.cc lines 6767–6813.

YAAM is **not** a simple Vanilla variant — it has a fundamentally different algorithm.
The ammo DR modifier adjusts DT rather than DR, DT is subtracted **before** multiplying,
and the `/2` halving step is retained. **DH2's YAAM implementation diverges** (see Divergences table).

CE algorithm per `damageModCalculateYaam`:
```
calculatedDT = DT − ammo.RM        // ammo modifier reduces DT, not DR
if calculatedDT < 0:               // overflow converts to extra DR
    extraDR = calculatedDT × 10    // negative DT → penalty to effective DR
    calculatedDT = 0
else: extraDR = 0
effectiveDR = DR + extraDR         // clamp: if effectiveDR ≥ 100, skip damage entirely

for each ammo round:
    d = roll(minDmg, maxDmg) + bonus
    d = d − calculatedDT           // ← DT subtracted BEFORE multiply
    if d ≤ 0: skip round
    d = d × ammoX
    if ammoY ≠ 0: d = trunc(d / ammoY)
    d = trunc(d / 2)               // ← /2 halving IS present
    d = trunc(d × CD / 100)
    d = d − trunc(d × effectiveDR / 100)
    if d > 0: total += d
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

CE ref: `combat.cc:attackDetermineToHit` line ~4440.

The region penalty is **halved for melee weapons** (`toHit += hit_location_penalty[hitLocation] / 2`)
and applied in full for ranged/unarmed.

```
// ranged / unarmed
hitChance = weaponSkill
          − AC
          − regionHitChanceDec[region]        // full penalty: head 40, eyes 60, groin 30, …
          − hitDistanceModifier
          − partialCoverPenalty               // 10 per intervening critter
          − crippledArmPenalty               // 40 per crippled arm
          − blindPenalty                     // 25 flat if blinded

// melee weapons only: region penalty is halved
hitChance = weaponSkill
          − AC
          − regionHitChanceDec[region] / 2   // ← integer-divided (CE line ~4440)
          − partialCoverPenalty
          − crippledArmPenalty
          − blindPenalty
          // no distance modifier for melee

hitChance = min(95, hitChance)               // 5% always-miss preserved
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

Critical hit level (0–5), resolved in `attackComputeCriticalHit` (combat.cc ~4102):
```
chance = randomBetween(1, 100) + getStat("Better Criticals")
if chance ≤ 20  → effect 0
if chance ≤ 45  → effect 1
if chance ≤ 70  → effect 2
if chance ≤ 90  → effect 3
if chance ≤ 100 → effect 4
if chance > 100 → effect 5
```

Critical effects (kill type × region × level) are resolved from `lut/criticalTables.json`  
via `CriticalEffects.getCritical(killType, region, level)`.

**The roll itself** (CE `attackCompute` → `randomRoll`, DH2 `Combat.rollHit`):
```
margin = toHit - d100                 // hit if margin >= 0
hit  → critical if d100 <= margin/10 + critChance      (from game day 1 on)
miss → critical miss if d100 <= -margin/10             (from game day 1 on)
```

**Special perk overrides** (all CE `attackCompute`, player only unless noted):
- **Slayer** — a melee or unarmed hit becomes critical.
- **Unarmed move bonus crit** — on a melee or unarmed hit, a separate d100 ≤ the move's bonus critical chance makes it critical (sfall, CE default).
- **Sniper** — on an ATTACK_TYPE_RANGED hit (not thrown), d10 ≤ LUK makes it critical.
- **Jinxed** (the player's trait or perk) — any attacker's miss becomes a critical miss half the time. DH2 also counts Pariah Dog on either combatant.

The critical damage multiplier is the table value as is. The old DH2 rule "melee crits use half DM (min 2)" is not in CE and was removed on 2026-10-17. Invulnerable critters (`CRITTER_INVULNERABLE`) take no critical and ×2.

**Critical failure** (CE `attackComputeCriticalFailure`):
- The table row is the weapon proto's `criticalFailureType` (DH2 `critFail`).
- The effect index comes from `d100 - 5 × (LUK - 5)`: ≤20 → 0, ≤50 → 1, ≤75 → 2, ≤95 → 3, else 4.
- The player gets no effect before game day 6.

---

## Sequence / Initiative

CE ref: `_combat_sequence`

```
sequence = 2 × PER
```

Combatants sorted descending. Ties: player goes first, then original array order.

---

## Action Points

CE ref: `critter_max_ap`, `party.cc:partyMemberGetMaxMembersToFollow`

```
AP per round = STAT_MAXIMUM_ACTION_POINTS   // 5 + AGI/2 (NPCs: proto value) + Action Boy + Bruiser − 2 …
free move    = 2 × Bonus Move rank           // player only, spent before AP, movement only
```

Attack cost (CE item.cc `weaponGetActionPointCost`, DH2 `Weapon.getAttackAPCost`):
- **Fast Shot** (trait): −1 for weapons with range > 2.
- **Bonus HtH Attacks**: −1 for melee and unarmed attacks.
- **Bonus Rate of Fire**: −1 for ranged attacks.
- **Aimed shot**: +1.
- Minimum 1.

Before 2026-10-17 DH2 gave +1 AP per turn for each of the two attack perks and +2 general AP for Bonus Move, which is not CE.

---

## Divergences: DH2 vs. fallout2-ce

| Area | fallout2-ce | DarkHarold2 |
|------|------------|-------------|
| Damage types | 8 types (Normal, Laser, Fire, Plasma, Electrical, EMP, Explosive, Radiation) | All 8 wired |
| ammoX/ammoY | weapon PRO field lookup | PRO loaded via `loadPRO()` |
| Sequence ties | player wins; else random | player wins; else array order |
| Light level | reduces hit chance at night (player only) | implemented (`darknessPenalty`, Night Sight) |
| Distance modifier | `distModifier` 2/4/5 by weapon perk | implemented (`getHitDistanceModifier`) |
| EMP damage | special DR/DT tables | lookup via stat system (EMP DT/DR stats) |
| Critical tables | hardcoded in fallout2.exe | extracted to `lut/criticalTables.json` |
| YAAM formula | DT subtracted before multiply; ammo RM adjusts DT; `/2` present (combat.cc:6767) | DT after multiply; ammo RM adjusts DR; no `/2` — matches Vanilla minus halving |
| Melee hit penalty | `regionPenalty / 2` for melee (combat.cc:4440) | implemented |
| Unarmed moves | `gUnarmedHitDescriptions` (bonus damage, bonus crit, AP, requirements) | **not CE** — invented tables, see `wiki/combat.md` §10 |

<!-- audited: 2026-10-17 (see wiki/combat.md §10) -->
