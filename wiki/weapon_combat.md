# Weapon Combat — DarkHarold2 Reference

> Ground-truth: `raw/fallout2-ce/src/item.cc`, `item.h`, `proto_types.h`, `combat.cc`  
> DH2 impl: `src/critter/Weapon.ts` (`Weapon` class, attack-mode tables), `src/combat/hitChance.ts` (`getHitChance`), `src/combat/Combat.ts` (`getDamageDone`, `getAmmoStats`, `rollHit`), `src/object/items.ts` (`WeaponObj`)  
> Cross-reference: [damage_formula.md](damage_formula.md) (full damage math), [combat.md](combat.md) (combat lifecycle, burst, AP pool), [animation.md](animation.md) (weapon anim codes)

---

## 1. Weapon PRO Data

Weapon prototype data is stored in a `ProtoItemWeaponData` sub-struct of `ProtoItem`
(`proto_types.h:256`). DH2 pre-extracts these to `proto/**/*.json` via the Python pipeline;
all fields live under `pro.extra` at runtime.

### 1.1 CE `ProtoItemWeaponData` Fields

| CE Field | Type | DH2 `pro.extra` key | Notes |
|----------|------|---------------------|-------|
| `animationCode` | int | `animCode` | Critter anim skin selection (0–10; see §6) |
| `minDamage` | int | `minDmg` | Min damage die result |
| `maxDamage` | int | `maxDmg` | Max damage die result |
| `damageType` | int | `dmgType` | 0–6 index (see §4.1) |
| `maxRange1` | int | `maxRange1` | Range for primary attack slot |
| `maxRange2` | int | `maxRange2` | Range for secondary attack slot |
| `projectilePid` | int | `projPID` | Projectile sprite PID for ranged attacks |
| `minStrength` | int | `minStr` | Minimum ST to wield without penalty |
| `actionPointCost1` | int | `APCost1` | AP cost for primary attack |
| `actionPointCost2` | int | `APCost2` | AP cost for secondary attack |
| `criticalFailureType` | int | `critFailType` | Index into critical-fail table (see §7) |
| `perk` | int | `perk` | `WeaponPerk` enum (see §5) |
| `rounds` | int | `rounds` | Currently loaded rounds (runtime mutable) |
| `caliber` | int | `caliber` | Must match loaded ammo's caliber |
| `ammoTypePid` | int | `ammoPID` | Currently loaded ammo proto PID (−1 if empty) |
| `ammoCapacity` | int | `maxAmmo` | Maximum magazine size (0 = no ammo needed) |
| `soundCode` | uchar | `soundCode` | Sound ID for attack sound |

The `attackMode` field is **packed into a single int** outside `ProtoItemWeaponData` proper — it is stored in the parent `ProtoItemData` union at the item level. In DH2, `pro.extra.attackMode` is a packed byte: bits 0–3 = primary attack mode, bits 4–7 = secondary attack mode.

**`attackMode` encoding example:**
```
attackMode = 0x67   // secondary=6 (fire single), primary=7 (fire burst)
primaryMode  = 0x67 & 0x0F = 7  (fire burst)
secondaryMode = (0x67 >> 4) & 0x0F = 6  (fire single)
```

CE source: `protoItemDataRead`, `item.cc:1585–1601`. DH2 parsing: `parseAttack()` in `critter.ts`.

---

## 2. Attack Modes & Skill Derivation

### 2.1 Attack Mode Values

The `attackMode` nibble maps to attack behavior. DH2 defines this as a bidirectional lookup
in `critter.ts`:

| Value | CE / DH2 Name | Attack Style | Skill Category |
|-------|--------------|--------------|----------------|
| 0 | `none` | No attack (slot disabled) | — |
| 1 | `punch` | Unarmed strike | Unarmed |
| 2 | `kick` | Unarmed kick | Unarmed |
| 3 | `swing` | Melee swing | Melee Weapons |
| 4 | `thrust` | Melee thrust | Melee Weapons |
| 5 | `throw` | Thrown weapon | Throwing |
| 6 | `fire single` | Single-shot ranged | Small Guns → (see §2.2) |
| 7 | `fire burst` | Burst-fire ranged | Small Guns → (see §2.2) |
| 8 | `flame` | Flamethrower stream | Small Guns (Big Guns in CE) |

CE ref: attack mode nibbles read in `item.cc:weaponGetAttackTypeForHitMode` and mapped to
`AttackType` (UNARMED / MELEE / THROW / RANGED).

### 2.2 Skill Derivation

CE `weaponGetSkillForHitMode` (`item.cc:1168`) maps attack mode → skill. DH2 replicates in
`getWeaponSkillFromPro()` (`critter.ts`) with two override steps:

```
Step 1: primaryMode → base skill
  0,1,2  → Unarmed
  3,4    → Melee Weapons
  5      → Throwing
  6,7,8  → Small Guns (initial; may be overridden in step 2)

Step 2: Small Guns override
  If dmgType ∈ {Laser, Plasma, Electrical} → Energy Weapons
  Else if animCode ∈ {8, 9, 10}            → Big Guns
  Else                                     → Small Guns (final)
```

`BIG_GUN_ANIM_CODES = {8, 9, 10}` — Big Gun, Minigun, Rocket Launcher (`critter.ts`).  
`ENERGY_DAMAGE_TYPES = {'Laser', 'Plasma', 'Electrical'}` (`critter.ts`).

**DH2 legacy fallback:** `weaponSkillMap` (`critter.ts`) maps weapon art name → skill for
weapons with incomplete PRO data. This is only consulted if `getWeaponSkillFromPro` returns
`undefined` or `'Unarmed'`.

### 2.3 Two Attack Slots

Every weapon has two attack slots. DH2 models them as:
```typescript
attackOne: { mode: number; APCost: number; maxRange: number }
attackTwo: { mode: number; APCost: number; maxRange: number }
```

If `attackTwo.mode === 'fire burst'` (or `=== 7`), the weapon's mode cycle includes
`'burst'` in addition to `['single', 'called']` (`critter.ts`).

`Weapon.getAPCost(slot?)` — slot 1 = primary, slot 2 = secondary/burst; inferred from
`this.mode` if not given (`critter.ts`).

`Weapon.getMaximumRange(slot?)` — same slot derivation (`critter.ts`).

---

## 3. AP Cost & Range Summary

| Situation | DH2 source | Cost |
|-----------|-----------|------|
| Single-shot (primary) | `pro.extra.APCost1` | per weapon PRO |
| Burst-fire (secondary) | `pro.extra.APCost2` | per weapon PRO |
| Called shot surcharge | `main.ts:261` | +1 AP on top of APCost1 |
| Unarmed AI hardcode | `combat.ts` | 3 AP flat |
| Unarmed player (`Weapon(null)`) | `pro.extra.APCost1` on synthetic proto | 3 AP (punch default) |

**Range check for AI attack decision** (`combat.ts`):
```typescript
const dist = hexDistance(obj.position, target.position)
// single-shot
if (dist <= weapon.getMaximumRange(1) && AP.getAvailableCombatAP() >= weapon.getAPCost(1))
    → attack
// burst (if burst mode available and preferred range)
if (burstEnabled && dist <= weapon.getMaximumRange(2) && dist >= burstMinRange)
    → burst
```

`burstMinRange` is hardcoded as `4` in DH2 (`combat.ts`) — CE uses AI packet's
`best_weapon` + distance mode for smarter burst/single choice.

---

## 4. Damage Roll & Damage Types

### 4.1 Damage Types

Seven damage types indexed 0–6 in CE (`damageType` enum, `proto_types.h`):

| Index | CE Name | DH2 String | Stat suffix | Death anim |
|-------|---------|------------|-------------|------------|
| 0 | `DAMAGE_NORMAL` | `'Normal'` | `'DT Normal'` / `'DR Normal'` | `'death'` |
| 1 | `DAMAGE_LASER` | `'Laser'` | `'DT Laser'` / `'DR Laser'` | `'death-laser'` |
| 2 | `DAMAGE_FIRE` | `'Fire'` | `'DT Fire'` / `'DR Fire'` | `'death-fire'` |
| 3 | `DAMAGE_PLASMA` | `'Plasma'` | `'DT Plasma'` / `'DR Plasma'` | `'death-plasma'` |
| 4 | `DAMAGE_EMP` | `'Electrical'` | `'DT Electrical'` / `'DR Electrical'` | `'death-electro'` |
| 5 | `DAMAGE_EXPLOSIVE` | `'EMP'` | `'DT EMP'` / `'DR EMP'` | `'death-electro'` |
| 6 | `DAMAGE_RADIATION` | `'Explosive'` | `'DT Explosion'` / `'DR Explosion'` | `'death-explode'` |

> **Important:** DH2's `damageType` bidirectional map in `critter.ts` has the string names
> for CE indices 4 and 5 **swapped**. CE index 4 is `DAMAGE_EMP` but DH2 maps it to `'Electrical'`;
> CE index 5 is `DAMAGE_EXPLOSIVE` but DH2 maps it to `'EMP'`. This is an existing discrepancy in
> the source; changing it would require updating all proto JSON data.

### 4.2 Damage Roll

```typescript
// src/combat/Combat.ts (getDamageDone)
const RD = getRandomInt(wep.minDmg, wep.maxDmg)
```

Unarmed moves use their own `mode.minDmg` / `mode.maxDmg` instead of the weapon PRO
(`combat.ts`). For explosives (`Obj.explode`), damage is hardcoded: Dynamite 30–50,
Plastic Explosive 40–80 (`object.ts`).

### 4.3 Armor Lookup

```typescript
// target's effective DT and DR (both stat layer and equipped armor)
DT = target.getStat('DT ' + damageType) + target.getArmorDT(damageType)
DR = target.getStat('DR ' + damageType) + target.getArmorDR(damageType)
```

For CE, `weaponGetDamageType` (`item.cc:1353`) reads `proto->item.data.weapon.damageType`.
Unarmed attacks always use `DAMAGE_NORMAL`.

---

## 5. Weapon Perks (CE `perk` field)

The `perk` field in `ProtoItemWeaponData` refers to a `WeaponPerk` enum value embedded into
the weapon's PRO. It is **different** from the critter-level `Perk` enum.

| CE Constant | DH2 Proto Key | Meaning | DH2 Status |
|-------------|--------------|---------|------------|
| `PERK_WEAPON_LONG_RANGE` (1) | `pro.extra.perk == 1` | `distModifier = 4` (doubles range penalty reduction) | PARTIAL — `combat.ts` reads it; `distModifier=4` wired |
| `PERK_WEAPON_ACCURATE` (2) | `pro.extra.perk == 2` | +20% hit chance for this weapon | STUB — not read in DH2 |
| `PERK_WEAPON_PENETRATE` (3) | `pro.extra.perk == 3` | 80% DT/DR bypass on hit | STUB — not read; DH2 penetrate comes from unarmed `mode.penetrate` only |
| `PERK_WEAPON_KNOCKBACK` (4) | `pro.extra.perk == 4` | Knockback divisor = 5 (not 10) | N/A — knockback not implemented |
| `PERK_WEAPON_SCOPE_RANGE` (5) | `pro.extra.perk == 5` | `distModifier = 5` | STUB — not read (`distModifier=5` branch is comment in `combat.ts`) |
| `PERK_WEAPON_FAST_RELOAD` (6) | `pro.extra.perk == 6` | Reload costs 0 AP | STUB — no AP cost for reload in DH2 |
| `PERK_WEAPON_NIGHT_SIGHT` (7) | `pro.extra.perk == 7` | No night vision penalty | STUB — no night penalty system |
| `PERK_WEAPON_FLAMEBOY` (8) | `pro.extra.perk == 8` | Fire damage deals splash | STUB |
| `PERK_WEAPON_HANDLING` (9) | `pro.extra.perk == 9` | −3 minimum ST requirement | STUB — `minStrength` not checked |
| `PERK_WEAPON_ENHANCED_KNOCKOUT` (10) | `pro.extra.perk == 10` | Knockout chance increased | STUB |

CE ref: `perk_defs.h:65–124`, `item.cc:weaponGetActionPointCost` (Fast Reload, line ~1654),
`combat.cc:attackComputeDamage` (Penetrate / Knockback / Accurate — lines ~4530–4558).

**`minStrength` gap:** CE applies a −20 hit-chance penalty when the wielder's ST is below
`minStrength` (`item.cc:1727`). DH2 does not read `pro.extra.minStr` anywhere.

---

## 6. AnimCode & Critter FRM Skins

`animationCode` drives two things: the critter's **idle/walk FRM prefix** (via `Weapon.getSkin()`)
and the **attack FRM suffix** (via `Weapon.getAttackSkin()`).

### 6.1 Idle/Walk Skin (`getSkin()`) — `critter.ts`

| animCode | CE WeaponAnimation constant | Prefix char | Example FRM |
|----------|-----------------------------|-------------|-------------|
| 0 | `WEAPON_ANIMATION_NONE` | `a` | `mahaaa` (unarmed idle NE) |
| 1 | `WEAPON_ANIMATION_KNIFE` | `d` | `mahda*` |
| 2 | `WEAPON_ANIMATION_CLUB` | `e` | `mahea*` |
| 3 | `WEAPON_ANIMATION_HAMMER` | `f` | `mahfa*` |
| 4 | `WEAPON_ANIMATION_SPEAR` | `g` | `mahga*` |
| 5 | `WEAPON_ANIMATION_PISTOL` | `h` | `mahha*` |
| 6 | `WEAPON_ANIMATION_SMG` | `i` | `mahia*` |
| 7 | `WEAPON_ANIMATION_RIFLE` | `j` | `mahja*` |
| 8 | `WEAPON_ANIMATION_BIG_GUN` | `k` | `mahka*` |
| 9 | `WEAPON_ANIMATION_MINIGUN` | `l` | `mahla*` |
| 10 | `WEAPON_ANIMATION_LAUNCHER` | `m` | `mahma*` |

Note: `animation.md §4` lists these under the `WeaponAnimation` enum name; here they
are tied to their source PRO field.

### 6.2 Attack Skin (`getAttackSkin()`) — `critter.ts`

The attack suffix is derived from the **current attack mode string**, not from `animCode`:

| Attack mode | Suffix char | Example FRM suffix |
|-------------|-------------|-------------------|
| `punch` | `q` | `*aq` |
| `kick` | `r` | `*ar` |
| `swing` | `g` | `*jg` (melee armed) |
| `thrust` | `f` | `*jf` |
| `throw` | `s` | `*as` |
| `fire single` | `j` | `*hj` (pistol) |
| `fire burst` | `k` | `*hk` |
| `flame` | `l` | `*kl` |

The burst attack always uses the `'fire burst'` skin (`k`) regardless of weapon slot.
CE uses `_art_get_code` with `ANIM_FIRE_SINGLE` / `ANIM_FIRE_BURST` to compute the same
suffix (see `animation.md §4`).

---

## 7. Critical Failure Tables

CE maps each attack to a named critical-fail table based on weapon category.
DH2 replicates this in `getCritFailTableType()` (`combat.ts`):

| CE / DH2 Table Key | Condition |
|--------------------|-----------|
| `'unarmed'` | No weapon or `weaponSkillType === 'Unarmed'` |
| `'melee'` | `weapon.type === 'melee'` |
| `'grenades'` | `damageType === 'Explosive'` |
| `'flamers'` | `damageType === 'Fire'` |
| `'energy'` | `damageType ∈ {Laser, Plasma, Electrical, EMP}` |
| `'rocketlauncher'` | `animCode === 10` (Rocket Launcher) |
| `'firearms'` | All other ranged weapons |

CE ref: `item.cc:weaponIsAimable`, `item_w_compute_crit_fail_critter_to_weapon_type`.

The `criticalFailureType` field in the weapon PRO maps to a **specific table within** the
critical-fail data. DH2 does not read `pro.extra.critFailType` — it derives the table purely
from weapon category.

---

## 8. Ammo System

### 8.1 CE Ammo PRO (`ProtoItemAmmoData`, `proto_types.h:276`)

| CE Field | Type | DH2 `pro.extra` key | Meaning |
|----------|------|---------------------|---------|
| `caliber` | int | `caliber` | Must match weapon's `caliber` for reload |
| `quantity` | int | `quantity` | Stack count of ammo item |
| `armorClassModifier` | int | `'AC modifier'` | Ammo AC adjustment (negative = easier to hit) |
| `damageResistanceModifier` | int | `'DR modifier'` | Ammo DR adjustment (positive = harder; negative = easier, e.g. AP) |
| `damageMultiplier` | int | `damMult` | `ammoX` — multiply damage roll |
| `damageDivisor` | int | `damDiv` | `ammoY` — divide damage roll |

### 8.2 DH2 Ammo Loading (`getAmmoStats()`, `combat.ts`)

```typescript
const ammoPID = (weaponObj as any).pro?.extra?.ammoPID  // −1 if empty
if (ammoPID < 0) return defaults  // { X:1, Y:1, RM:0, ACmod:0 }
const ammoPro = loadPRO(ammoPID, ammoPID & 0xffff)
return {
    X:     ammoPro.extra.damMult ?? 1,
    Y:     ammoPro.extra.damDiv  ?? 1,
    RM:    ammoPro.extra['DR modifier'] ?? 0,
    ACmod: ammoPro.extra['AC modifier'] ?? 0,
}
```

`ammoPID` is stored directly on the weapon's `pro.extra.ammoPID` — updated when the weapon
is reloaded via the reload script opcode or the UI. `pro.extra.rounds` tracks loaded count.

### 8.3 Caliber Matching

CE `item.cc:1537` prevents reload if `weapon.caliber !== ammo.caliber`. DH2 does not enforce
caliber matching — any ammo item can be loaded into any weapon in the current implementation.

### 8.4 Magazine Tracking

| Operation | DH2 source | CE equivalent |
|-----------|-----------|---------------|
| Current rounds read | `pro.extra.rounds` | `proto->item.data.weapon.rounds` |
| Rounds deducted (single shot) | `combat.ts` — implicit per attack; not explicitly decremented | `weaponDecrAmmo` |
| Rounds deducted (burst) | `pro.extra.rounds = max(0, curRounds - burstCount)` at `combat.ts` | per-round decrement in `_shoot_along_path` |
| Magazine capacity | `pro.extra.maxAmmo` | `proto->item.data.weapon.ammoCapacity` |
| Reload available check | `maxAmmo > 0 && rounds < maxAmmo` in `cycleMode()` | `itemIsWeapon + ammo count` |

**DH2 gap:** Single-shot attacks do not decrement `pro.extra.rounds`. Only burst fire deducts
ammo. A rifle will not run dry from single-shot attacks.

---

## 9. Unarmed Combat

### 9.1 Unarmed Move Progression

DH2 defines 14 unarmed moves in `UNARMED_MOVES` (`critter.ts`), unlocked by Unarmed
skill and character level. CE equivalent: `unarmedFindBestAttack` in `item.cc`.

| Move | Level Req | Skill Req | Damage | AP | Crit Bonus | Penetrate |
|------|-----------|-----------|--------|-----|-----------|-----------|
| Punch | 1 | 55 | 1–2 | 3 | 0 | — |
| Kick | 1 | 40 | 1–3 | 3 | 0 | — |
| Strong Punch | 6 | 55 | 3–6 | 4 | 0 | — |
| Haymaker | 6 | 60 | 3–6 | 5 | +5 | — |
| Jab | 6 | 60 | 3–6 | 5 | +10 | — |
| Hammer Punch | 9 | 60 | 3–6 | 4 | +5 | — |
| Groin Kick | 9 | 50 | 3–6 | 4 | +10 | — |
| Palm Strike | 12 | 70 | 3–6 | 5 | +20 | — |
| Lightning Punch | 12 | 75 | 3–6 | 4 | +30 | — |
| Power Kick | 12 | 60 | 5–10 | 4 | +5 | — |
| Piercing Strike | 16 | 75 | 3–6 | 5 | +15 | **yes** |
| Hip Kick | 16 | 60 | 5–10 | 5 | +10 | — |
| Hook Kick | 18 | 75 | 5–10 | 6 | +10 | — |
| Piercing Kick | 20 | 80 | 5–10 | 7 | +15 | **yes** |

`critBonus` is added to the critter's critical chance for that attack (`combat.ts` area).
Penetrating moves reduce DT to 20% (`Weapon.isPenetrating()`, `critter.ts`).

### 9.2 Mode Cycle for Unarmed

`Weapon.initUnarmedMoves(unarmedSkill, charLevel)` sets `this.modes` to the names of all
available moves plus `'called'`. `cycleMode()` walks the list; selecting a named move updates
`minDmg`, `maxDmg`, and `APCost1` on the synthetic proto.

**CE note:** In CE, special unarmed moves (Haymaker, Jab, etc.) are accessed via the HIT_MODE
system (`HIT_MODE_PUNCH / KICK / STRONG_PUNCH` etc., ~18 values). DH2 maps these to the
`UNARMED_MOVES` array. The critical bonus per move comes from `item.cc:unarmedGetBonusDamage`
(which applies to crit chance, not damage in CE).

---

## 10. Hit Chance & Combat Roll

Full formula is in [damage_formula.md](damage_formula.md). Weapon-specific inputs:

| Input | Source |
|-------|--------|
| `weaponSkill` | `obj.getSkill(weapon.weaponSkillType)` |
| `AC` | `target.getStat('AC') + target.getArmorAC() + target.bonusAC + ammoStats.ACmod` |
| `hitDistanceModifier` | `getHitDistanceModifier()` — dist, PER, Sharpshooter perk, weapon perk |
| `regionHitChanceDec` | `CriticalEffects.regionHitChanceDecTable[region]` |
| `partialCoverPenalty` | +10 per critter between attacker and target |
| `crippledArmPenalty` | +40 per crippled arm |
| `blindPenalty` | +25 if blinded |

`getHitDistanceModifier()` (`combat.ts`):
```
dist = hexDistance(attacker, target)
tempPER = attacker.PER − 2              // FO2 hardcoded penalty (CE: critter_get_stat_with_temp)
dist -= tempPER × distModifier          // distModifier: 2 normally, 4 long_range, 5 scope (stub)
Sharpshooter perk: each rank reduces dist by 2
if dist ≥ 0 and blinded: dist *= 12
elif dist ≥ 0:            dist *= 4
if dist < 0: modifier = 0
```

**Not implemented in DH2:**
- Light-level penalty (noted in `getHitChance` comment: `combat.ts`)
- `distModifier = 5` for `PERK_WEAPON_SCOPE_RANGE`
- Melee region-penalty halving (CE `combat.cc:4440`: `toHit += penalty / 2` for melee;
  DH2 applies full penalty — see `damage_formula.md` Divergences)

---

## 11. Weapon Scripting Opcodes

| Opcode | CE function | Args | DH2 method | Status |
|--------|-------------|------|------------|--------|
| `0x8112` | `item_w_subtype` | 1 | `item_w_subtype` | WIRED — returns PRO sub-type int |
| `0x8117` | `item_w_ac` | 1 | `item_w_ac` | WIRED |
| `0x8118` | `item_w_damage` | 3 | `item_w_damage` | PARTIAL — returns `min/max/type`; perk not factored |
| `0x8119` | `item_w_damage_type` | 1 | `item_w_damage_type` | WIRED |
| `0x811A` | `item_w_range` | 2 | `item_w_range` | WIRED — reads `maxRange1/2` from PRO |
| `0x811C` | `item_w_anim_weap` | 2 | `item_w_anim_weap` | WIRED |
| `0x811D` | `item_w_ammo_pid` | 1 | `item_w_ammo_pid` | WIRED — returns `pro.extra.ammoPID` |
| `0x811E` | `item_w_ammo_type` | 1 | `item_w_ammo_type` | WIRED — returns `pro.extra.caliber` |
| `0x811F` | `item_w_ammo_count` | 1 | `item_w_ammo_count` | WIRED — returns `pro.extra.rounds` |
| `0x8120` | `item_w_max_ammo` | 1 | `item_w_max_ammo` | WIRED — returns `pro.extra.maxAmmo` |
| `0x8121` | `item_w_perk` | 1 | `item_w_perk` | WIRED — returns `pro.extra.perk` |
| — | `item_w_caliber` | 1 | **NOT IMPL** | MISSING |
| — | `item_w_min_st` | 1 | **NOT IMPL** | MISSING |
| — | `item_w_crit_fail` | 1 | **NOT IMPL** | MISSING |

---

## 12. Known Gaps vs CE

| # | Feature | CE Behavior | DH2 Status | Impact |
|---|---------|-------------|------------|--------|
| 1 | Single-shot ammo decrement | `weaponDecrAmmo` after each attack | MISSING — only burst deducts rounds | Guns never run dry from single-shot fire |
| 2 | Caliber matching | Reload rejected if `weapon.caliber ≠ ammo.caliber` | STUB — any ammo loads any weapon | Wrong ammo can be loaded |
| 3 | `minStrength` penalty | −20 hit chance if attacker ST < `minStrength` | MISSING — `pro.extra.minStr` never read | Heavy weapons equally accurate for weak characters |
| 4 | `PERK_WEAPON_ACCURATE` | +20 hit chance for the weapon | STUB — `pro.extra.perk == 2` not read | Accurate weapons have no bonus |
| 5 | `PERK_WEAPON_PENETRATE` | 80% DT/DR reduction on hit (weapon-level) | STUB — weapon perk not read; only unarmed `mode.penetrate` wired | Penetrating ranged weapons behave like normal |
| 6 | `PERK_WEAPON_SCOPE_RANGE` | `distModifier = 5` | STUB — `distModifier=4` max, scope path is a comment | Scoped weapons have same range penalty as long-range |
| 7 | `PERK_WEAPON_FAST_RELOAD` | Reload AP cost = 0 | STUB — no AP cost for reload at all in DH2 | Effectively all weapons have free reload |
| 8 | Melee region-penalty halving | `regionPenalty / 2` for melee hit chance | MISSING — full penalty applied | Melee hit-chance is slightly harder than CE |
| 9 | Light-level hit modifier | Night / darkness reduces hit chance | MISSING — noted in `getHitChance` comment | All attacks equally accurate at night |
| 10 | `criticalFailureType` field | Per-weapon fail table selection | STUB — table selected by weapon category only | All knives use same fail table as all clubs |
| 11 | `Weapon.canEquip(obj)` | CE checks ST ≥ `minStrength` and animation exists | DH2 checks only animation exists (`critter.ts`) | STR-heavy weapons can be equipped by anyone |
| 12 | Damage type index swap | CE index 4 = EMP, 5 = Explosive | DH2 `damageType` map: 4 = 'Electrical', 5 = 'EMP' — string names swap EMP/Explosive indices | EMP vs Explosive damage type slightly wrong for edge cases |
| 13 | Haymaker / special moves unarmed | CE `ANIM_HAYMAKER` etc. as distinct HIT_MODE values | DH2 implements move list but critical bonus (`critBonus`) not applied to `critChance` during roll | Unarmed crit bonuses from Haymaker, Palm Strike etc. are defined but not active in `rollHit` |
| 14 | AI burst vs single choice | Prefers burst at close range, single at distance, based on AI `best_weapon` | Hardcoded `burstMinRange = 4` hex | AI burst preference is not weapon-specific |
