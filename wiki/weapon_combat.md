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
| 0 | `DAMAGE_TYPE_NORMAL` | `'Normal'` | `'DT Normal'` / `'DR Normal'` | `'death'` |
| 1 | `DAMAGE_TYPE_LASER` | `'Laser'` | `'DT Laser'` / `'DR Laser'` | `'death-laser'` |
| 2 | `DAMAGE_TYPE_FIRE` | `'Fire'` | `'DT Fire'` / `'DR Fire'` | `'death-fire'` |
| 3 | `DAMAGE_TYPE_PLASMA` | `'Plasma'` | `'DT Plasma'` / `'DR Plasma'` | `'death-plasma'` |
| 4 | `DAMAGE_TYPE_ELECTRICAL` | `'Electrical'` | `'DT Electrical'` / `'DR Electrical'` | `'death-electro'` |
| 5 | `DAMAGE_TYPE_EMP` | `'EMP'` | `'DT EMP'` / `'DR EMP'` | `'death-electro'` |
| 6 | `DAMAGE_TYPE_EXPLOSION` | `'Explosive'` | `'DT Explosive'` / `'DR Explosive'` | `'death-explode'` |

> Corrected 2026-10-17: an earlier version of this table had CE's names shifted
> (index 4 "EMP", 5 "EXPLOSIVE", 6 "RADIATION") and called DH2's mapping swapped. CE
> `proto_types.h` orders them NORMAL, LASER, FIRE, PLASMA, ELECTRICAL, EMP, EXPLOSION —
> exactly DH2's strings.

### 4.2 Damage Roll

```typescript
// src/combat/Combat.ts (getDamageDone)
const RD = getRandomInt(wep.minDmg, wep.maxDmg)
```

Unarmed moves use their own `mode.minDmg` / `mode.maxDmg` instead of the weapon PRO
(`combat.ts`). Explosives follow CE `_obj_use_explosive` / `_queue_do_explosion_`
(`src/object/Obj.ts`): the Set Timer window (10–180 s, 10-s steps), 10 × seconds ticks
of game time, a Traps roll (failure: half the time, critical failure: at once, both
"detonates prematurely"), Dynamite 30–50 / Plastic 40–80 (+10 with Demolition Expert),
then `actionExplode` (`src/combat/explosion.ts`).

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

The IDs are the CE `Perk` enum values (perk_defs.h). Weapon PROs store the same IDs as critter perks.

| CE Constant (id) | Meaning | DH2 Status (audited 2026-10-17) |
|------------------|---------|---------------------------------|
| `PERK_WEAPON_LONG_RANGE` (58) | Perception bonus ×4 in the distance modifier | DONE — `hitChance.ts getHitDistanceModifier` |
| `PERK_WEAPON_ACCURATE` (59) | +20 to hit | DONE — `getHitChance` |
| `PERK_WEAPON_PENETRATE` (60) | DT ×20% (DR unchanged) | DONE 2026-10-17 — `Combat.getDamageDone` |
| `PERK_WEAPON_KNOCKBACK` (61) | Knockback damage / 5 instead of / 10 | DONE 2026-10-17 — `lifecycle.ts critterDamage` (was checked as id 3) |
| `PERK_WEAPON_SCOPE_RANGE` (64) | Perception bonus ×5, only from 8 hexes on | DONE — `getHitDistanceModifier` |
| `PERK_WEAPON_FAST_RELOAD` (65) | Reload costs 1 AP | DONE — `Weapon.getReloadAPCost` |
| `PERK_WEAPON_NIGHT_SIGHT` (66) | No darkness penalty | DONE — `getHitChance` |
| `PERK_WEAPON_FLAMEBOY` (67) | Death-animation damage thresholds / 3 | DONE — `deathAnim.ts pickDeath` |
| `PERK_WEAPON_ENHANCED_KNOCKOUT` (117) | Knockout on a hit with STR − 8 % chance, always on a critical | MISSING |

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

## 9. Unarmed Combat — CE `gUnarmedHitDescriptions` (since 2026-10-17)

DH2 impl: `src/unarmed.ts`. CE ref: combat.cc `unarmedInitVanilla`, `unarmedGetPunchHitMode` / `unarmedGetKickHitMode` / `unarmedGetHitModeInRange`, `unarmedGetDamage`, `unarmedGetBonusCriticalChance`, `unarmedIsPenetrating`; interface.cc `interfaceUpdateItems`, `interfaceCycleItemAction`, `interfaceBarRefreshMainAction`.

### 9.1 Hit modes

Every move does **1–2 damage + bonus damage**. Like any unarmed attack, the maximum also gets the Melee Damage stat (item.cc `weaponGetDamage`).

| HIT_MODE | Name | Req. level | Req. Unarmed | Req. ST / AG | Bonus dmg | Bonus crit | AP | Penetrate | Secondary | HUD FRM |
|---|---|---|---|---|---|---|---|---|---|---|
| 4 PUNCH | Punch | – | – | – | 0 | 0 | 3 | – | – | punch |
| 8 STRONG_PUNCH | Strong Punch | – | 55 | – / 6 | 3 | 0 | 3 | – | – | spunch |
| 9 HAMMER_PUNCH | Hammer Punch | 6 | 75 | 5 / 6 | 5 | 5 | 3 | – | – | hampnch |
| 10 HAYMAKER | Lightning Punch | 9 | 100 | 5 / 7 | 7 | 15 | 3 | – | – | cm_hymkr |
| 11 JAB | Chop Punch | 5 | 75 | 5 / 7 | 3 | 10 | 3 | – | yes | cm_jab |
| 12 PALM_STRIKE | Dragon Punch | 12 | 115 | 5 / 7 | 7 | 20 | 6 | yes | yes | cm_plmst |
| 13 PIERCING_STRIKE | Force Punch | 16 | 130 | 5 / 7 | 10 | 40 | 8 | yes | yes | cm_pstrk |
| 5 KICK | Kick | – | – | – | 0 | 0 | 3 | – | – | kick |
| 14 STRONG_KICK | Strong Kick | – | 40 | – / 6 | 5 | 0 | 4 | – | – | skick |
| 15 SNAP_KICK | Snap Kick | 6 | 60 | – / 6 | 7 | 0 | 4 | – | – | snapkick |
| 16 POWER_KICK | Roundhouse Kick | 9 | 80 | 6 / 6 | 9 | 5 | 4 | – | – | cm_pwkck |
| 17 HIP_KICK | Kip Kick | 6 | 60 | 6 / 7 | 7 | 0 | 7 | – | yes | hipk |
| 18 HOOK_KICK | Jump Kick | 12 | 100 | 6 / 7 | 9 | 10 | 7 | yes | yes | cm_hookk |
| 19 PIERCING_KICK | Death Blossom Kick | 15 | 125 | 6 / 8 | 12 | 50 | 9 | yes | yes | cm_prckk |

- **Bonus crit:** on a normal hit, a separate d100 ≤ bonus makes it a critical (CE `attackCompute`, sfall). It is not added to the critical chance.
- **Penetrate:** DT drops to 20% (`unarmedIsPenetrating`).
- **AP:** the move's cost, −1 with Bonus HtH Attacks, +1 when aimed, minimum 1 (`unarmedAPCost`, item.cc `weaponGetActionPointCost`).

### 9.2 Hands and actions (player)

- **Hands:** an empty **left** hand punches, an empty **right** hand kicks. This does not depend on the other hand; the old DH2 rule "kick only with both hands empty" was not CE.
- **Primary** is the last non-secondary move of the hand's family the player qualifies for (Unarmed skill, level, ST, AG); without one it is Punch / Kick.
- **Secondary** is the last qualifying secondary move. It exists only when it isn't the plain Punch / Kick.
- **Right-click cycle** (`cycleUnarmedAction`): primary → primary aimed → secondary → secondary aimed. Aiming is skipped with Fast Shot (`critterCanAim`), and the secondary steps when there is no secondary move. The state is kept per hand (`globalState.punchModeIdx` / `kickModeIdx` = action index 0–3).
- **HUD:** the action button shows the hit mode's FRM, the bullseye for an aimed attack, and the AP. An aimed punch or kick opens the called-shot window.
- **Inventory:** for an empty hand the summary shows "No item" and "Unarmed dmg: (bonus + 1)–(bonus + Melee + 2)" (inventory.cc).

### 9.3 Other critters

NPCs and party members always use the plain punch (1–2 + Melee Damage, 3 AP). CE `_ai_pick_hit_mode` returns `HIT_MODE_PUNCH` without a weapon, and the move tables read only gDude's stats. Their empty hand is a fist object (`Critter.makeFist`, `Weapon(null)`). A player whose weapon is knocked away gets an empty hand slot and so keeps the moves.

---

## 9a. Weapon Actions — Primary / Secondary (CE `interfaceCycleItemAction`, since 2026-10-17)

The proto's `attackMode` holds the primary attack in the low nibble and the secondary in the high one. The modes are 0 none, 1 punch, 2 kick, 3 swing, 4 thrust, 5 throw, 6 single, 7 burst, 8 flame. Examples: a spear is 0x54 (thrust / throw), a throwing knife 0x35 (throw / swing), a rock 0x15 (throw / punch), an SMG 0x76 (single / burst).

| `Weapon.mode` | CE action | Slot | Present when |
|---|---|---|---|
| `single` | PRIMARY | 1 | always |
| `called` | PRIMARY_AIMING | 1 | `critterCanAim` (not burst/flame, not explosive/fire/EMP, not a plasma throw) |
| `burst` | SECONDARY (burst / flame) | 2 | secondary mode 7 or 8 |
| `secondary` | SECONDARY | 2 | any other secondary mode |
| `secondaryCalled` | SECONDARY_AIMING | 2 | secondary present and aimable |
| `reload` | RELOAD | – | magazine not full |

- **Slot 2 values:** the action uses `APCost2` and `maxRange2`, its own skill (`skillForMode`, CE `weaponGetSkillForHitMode`; a spear's throw uses Throwing) and its own attack type (`weaponAttackType` reads the secondary nibble).
- **Aimed:** +1 AP.
- **Thrown attacks:** they fire a projectile, and the item lands where it hits (C25/C26).
- **Throw animation** (CE art.cc, ANIM_THROW_ANIM): knife `dm`, spear `gm`, anything else `as`.
- **HUD:** the label is the action's attack (`thrust`, `swing`, `throw`, `single`, `burst`, `reload`), plus the bullseye when aimed. The button shows the item's inventory picture for every weapon.
- **AI:** `_ai_pick_hit_mode` uses any secondary attack, not only bursts (area_attack_mode / secondary_freq, range and AP of slot 2).

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

All CE inputs are wired (light level, Scope Range ×5, melee region-penalty halving). The open points are listed in `wiki/combat.md` §10.

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

Re-audited 2026-10-17. Most of the old list here (single-shot ammo, caliber check, min-ST penalty, Accurate, Penetrate, Scope Range, Fast Reload, melee region halving, light level, critical-failure table) is now implemented. The current gap list for weapons, damage, criticals and death is in `wiki/combat.md` §10 "Still open". The weapon-specific gaps are:

| Feature | CE Behavior | DH2 Status |
|---------|-------------|------------|
| Unarmed-type weapons (brass knuckles, power fist) | Weapon hit mode: min ST, One Hander and Accurate apply | Treated as plain unarmed in the hit chance |
| Enhanced Knockout weapon perk | Knockout chance | Missing |
| Critical-failure effects DUD / EXPLODE | Weapon duds / explodes | Become "destroy weapon" |
| `item_w_caliber` / `item_w_min_st` / `item_w_crit_fail` | Script opcodes | Not wired (§11) |

<!-- audited: 2026-10-17 -->
