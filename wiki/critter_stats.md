# Critter Stats & Combat Attributes — DarkHarold2 Reference

> Ground-truth: `raw/fallout2-ce/src/proto_types.h`, `critter.cc`, `critter.h`, `combat_ai.cc`, `combat_ai_defs.h`, `stat_defs.h`, `obj_types.h`  
> DH2 impl: `src/object.ts`, `src/critter.ts`, `src/pro.ts`, `src/char.ts`, `src/combat.ts`, `src/scripting.ts`, `src/vm_bridge.ts`

This document covers non-player critters only. SPECIAL stat formulas are documented in `wiki/special_derived.md`. Skill formulas are in `wiki/skill_checks.md`. Perk/trait system is in `wiki/perks_traits.md`.

---

## 1. Proto-Based Stat Storage

### 1.1 CE Proto Layout

CE stores critter stats in `.PRO` binary files. The relevant C++ types are in `proto_types.h`.

**`CritterProto` struct** (`proto_types.h:347`):

| Field | Type | Purpose |
|---|---|---|
| `pid` | int | Prototype ID (high byte = object type 1=critter) |
| `messageId` | int | Message list number (for critter name lookup) |
| `fid` | int | Frame ID for default sprite |
| `lightDistance` | int | Light emission distance |
| `lightIntensity` | int | Light emission intensity |
| `flags` | int | Object flags |
| `extendedFlags` | int | Extended object flags |
| `sid` | int | Script ID (-1 if none) |
| `data` | CritterProtoData | All stat/skill data (see below) |
| `headFid` | int | FID for dialogue head portrait |
| `aiPacket` | int | AI package number (index into AI.TXT) |
| `team` | int | Team number (faction) |

**`CritterProtoData` struct** (`proto_types.h:335`):

| Field | Type | Size | Purpose |
|---|---|---|---|
| `flags` | int | — | CritterFlags bitmask (see §1.3) |
| `baseStats` | int[] | 35 | Base stat values indexed by `STAT_*` enum (0–34) |
| `bonusStats` | int[] | 35 | Runtime bonus stat layer — modified by perks, radiation, drugs |
| `skills` | int[] | 18 | Invested skill points (0 = at startValue, n = n points above startValue) |
| `bodyType` | int | — | BODY_TYPE_BIPED(0) / QUADRUPED(1) / ROBOTIC(2) |
| `experience` | int | — | XP rewarded when this critter is killed |
| `killType` | int | — | KILL_TYPE_* for kill-count tracking (KarmaVars) |
| `damageType` | int | — | Native unarmed damage type (default NORMAL; floaters/eyes get others) |

`SAVEABLE_STAT_COUNT = 35` — so `baseStats/bonusStats` cover indices 0–34 (SPECIAL through STAT_GENDER). `STAT_CURRENT_HIT_POINTS (35)`, `STAT_CURRENT_POISON_LEVEL (36)`, and `STAT_CURRENT_RADIATION_LEVEL (37)` are runtime fields stored directly on the `Object` struct (`data.critter.hp`, `data.critter.poison`, `data.critter.radiation`), not in the proto arrays.

**CE stat query chain:** `critterGetStat(critter, stat)` → `critterGetBaseStat` + `critterGetBonusStat` + trait modifier → derived stat formula (see `stat.cc critterUpdateDerivedStats`).

### 1.2 DH2 Proto Layout

No binary `.PRO` files at runtime — the Python pipeline extracts them to `proto/**/*.json` (via `proto.py`). These are loaded into `globalState.proMap` from `proto/pro.json` at startup (`main.ts:564`).

**Proto lookup path:** `src/pro.ts:loadPRO(pid, pidID)` → `globalState.proMap[type][id]`

```
pid high byte → type name:  0=items, 1=critters, 2=scenery, 3=walls, 4=tiles, 5=misc
```

**JSON fields used by `Critter.initFromPro()` (`object.ts:1280`):**

| JSON field path | CE source | DH2 consumer |
|---|---|---|
| `pro.extra.baseStats` | `CritterProtoData.baseStats` | `StatSet.fromPro()` in `char.ts:243` |
| `pro.extra.bonusStats` | `CritterProtoData.bonusStats` | `StatSet.fromPro()` — merged into baseStats |
| `pro.extra.skills` | `CritterProtoData.skills` | `SkillSet.fromPro()` in `char.ts:61` |
| `pro.extra.AI` | `CritterProto.aiPacket` | `critter.aiNum` (`object.ts:1287`) |
| `pro.extra.team` | `CritterProto.team` | `critter.teamNum` (`object.ts:1290`) |
| `pro.extra.bodyType` | `CritterProtoData.bodyType` | Stored on critter; not used in combat logic |
| `pro.extra.experience` | `CritterProtoData.experience` | Not used (XP grant on kill not implemented) |
| `pro.extra.killType` | `CritterProtoData.killType` | Not used (kill count tracking not implemented) |

**`StatSet.fromPro()` (`char.ts:243`):** merges `baseStats + bonusStats` into a single flat `baseStats` object. DH2 does not maintain a separate live bonus layer for critters — all modifiers are baked in at load time. This means perk/radiation/drug runtime bonuses on NPCs cannot be applied without modifying `baseStats` directly.

### 1.3 CritterProtoData Flags (`CritterFlags` enum, `obj_types.h:92`)

| Flag | Value | Meaning |
|---|---|---|
| `CRITTER_BARTER` | 0x02 | NPC can engage in barter |
| `CRITTER_NO_STEAL` | 0x20 | Cannot be pickpocketed |
| `CRITTER_NO_DROP` | 0x40 | Does not drop inventory on death |
| `CRITTER_NO_LIMBS` | 0x80 | Immune to limb crippling |
| `CRITTER_NO_AGE` | 0x100 | Does not age |
| `CRITTER_NO_HEAL` | 0x200 | Cannot be healed by Healing Rate |
| `CRITTER_INVULNERABLE` | 0x400 | Takes no damage (script-controlled) |
| `CRITTER_FLAT` | 0x800 | Always rendered flat (2D sprite, no height) |
| `CRITTER_SPECIAL_DEATH` | 0x1000 | Uses a special death animation |
| `CRITTER_LONG_LIMBS` | 0x2000 | Increased melee range |
| `CRITTER_NO_KNOCKBACK` | 0x4000 | Cannot be knocked back by explosions |

**DH2 status:** These flags are not read from `pro.extra.flags` by DH2's combat/critter code. `critterKill()` in `critter.ts` does not check `CRITTER_INVULNERABLE` or `CRITTER_NO_DROP`. `injuryFlags` from `critter_injure` stores a partial DAM_ bitmask but the proto flags are separate.

---

## 2. Critter Stat Table

All `STAT_*` enum values from `stat_defs.h` (0–37). The `get_critter_stat` opcode uses these indices. `SAVEABLE_STAT_COUNT = 35` means only 0–34 are stored in the proto; 35–37 are runtime-only.

| Index | CE Constant | DH2 Stat Name | Proto? | DH2 `statMap` | Notes |
|---|---|---|---|---|---|
| 0 | `STAT_STRENGTH` | `STR` | baseStats[0] | `'STR'` | WIRED |
| 1 | `STAT_PERCEPTION` | `PER` | baseStats[1] | `'PER'` | WIRED |
| 2 | `STAT_ENDURANCE` | `END` | baseStats[2] | `'END'` | WIRED |
| 3 | `STAT_CHARISMA` | `CHA` | baseStats[3] | `'CHA'` | WIRED |
| 4 | `STAT_INTELLIGENCE` | `INT` | baseStats[4] | `'INT'` | WIRED |
| 5 | `STAT_AGILITY` | `AGI` | baseStats[5] | `'AGI'` | WIRED |
| 6 | `STAT_LUCK` | `LUK` | baseStats[6] | `'LUK'` | WIRED |
| 7 | `STAT_MAXIMUM_HIT_POINTS` | `Max HP` | baseStats[7] | `'Max HP'` | WIRED |
| 8 | `STAT_MAXIMUM_ACTION_POINTS` | `AP` | baseStats[8] | **MISSING** | stub → 5 |
| 9 | `STAT_ARMOR_CLASS` | `AC` | baseStats[9] | **MISSING** | stub → 5 |
| 10 | `STAT_UNARMED_DAMAGE` | `Unarmed Damage` | baseStats[10] | **MISSING** | stub → 5 |
| 11 | `STAT_MELEE_DAMAGE` | `Melee Damage` | baseStats[11] | **MISSING** | stub → 5 |
| 12 | `STAT_CARRY_WEIGHT` | `Carry Weight` | baseStats[12] | **MISSING** | stub → 5 |
| 13 | `STAT_SEQUENCE` | `Sequence` | baseStats[13] | **MISSING** | stub → 5 |
| 14 | `STAT_HEALING_RATE` | `Healing Rate` | baseStats[14] | **MISSING** | stub → 5 |
| 15 | `STAT_CRITICAL_CHANCE` | `Critical Chance` | baseStats[15] | **MISSING** | stub → 5 |
| 16 | `STAT_BETTER_CRITICALS` | `Better Criticals` | baseStats[16] | **MISSING** | stub → 5 |
| 17 | `STAT_DAMAGE_THRESHOLD` | `DT Normal` | baseStats[17] | **MISSING** | stub → 5 |
| 18 | `STAT_DAMAGE_THRESHOLD_LASER` | `DT Laser` | baseStats[18] | **MISSING** | stub → 5 |
| 19 | `STAT_DAMAGE_THRESHOLD_FIRE` | `DT Fire` | baseStats[19] | **MISSING** | stub → 5 |
| 20 | `STAT_DAMAGE_THRESHOLD_PLASMA` | `DT Plasma` | baseStats[20] | **MISSING** | stub → 5 |
| 21 | `STAT_DAMAGE_THRESHOLD_ELECTRICAL` | `DT Electrical` | baseStats[21] | **MISSING** | stub → 5 |
| 22 | `STAT_DAMAGE_THRESHOLD_EMP` | `DT EMP` | baseStats[22] | **MISSING** | stub → 5 |
| 23 | `STAT_DAMAGE_THRESHOLD_EXPLOSION` | `DT Explosion` | baseStats[23] | **MISSING** | stub → 5 |
| 24 | `STAT_DAMAGE_RESISTANCE` | `DR Normal` | baseStats[24] | **MISSING** | stub → 5 |
| 25 | `STAT_DAMAGE_RESISTANCE_LASER` | `DR Laser` | baseStats[25] | **MISSING** | stub → 5 |
| 26 | `STAT_DAMAGE_RESISTANCE_FIRE` | `DR Fire` | baseStats[26] | **MISSING** | stub → 5 |
| 27 | `STAT_DAMAGE_RESISTANCE_PLASMA` | `DR Plasma` | baseStats[27] | **MISSING** | stub → 5 |
| 28 | `STAT_DAMAGE_RESISTANCE_ELECTRICAL` | `DR Electrical` | baseStats[28] | **MISSING** | stub → 5 |
| 29 | `STAT_DAMAGE_RESISTANCE_EMP` | `DR EMP` | baseStats[29] | **MISSING** | stub → 5 |
| 30 | `STAT_DAMAGE_RESISTANCE_EXPLOSION` | `DR Explosion` | baseStats[30] | **MISSING** | stub → 5 |
| 31 | `STAT_RADIATION_RESISTANCE` | `Radiation Resistance` | baseStats[31] | **MISSING** | stub → 5 |
| 32 | `STAT_POISON_RESISTANCE` | `Poison Resistance` | baseStats[32] | **MISSING** | stub → 5 |
| 33 | `STAT_AGE` | `Age` | baseStats[33] | **MISSING** | stub → 5 |
| 34 | `STAT_GENDER` | `Gender` | baseStats[34] | **PARTIAL** | special-cased at `scripting.ts:570`: player = gender field; others always 0 (male) |
| 35 | `STAT_CURRENT_HIT_POINTS` | `HP` | runtime only | `'HP'` | WIRED — reads `obj.stats.getBase('HP')` |
| 36 | `STAT_CURRENT_POISON_LEVEL` | `Poison` | runtime only | **MISSING** | stub → 5 |
| 37 | `STAT_CURRENT_RADIATION_LEVEL` | `Radiation` | runtime only | **MISSING** | stub → 5 |

**`get_critter_stat` coverage:** Only indices 0–7 (SPECIAL + MaxHP) and 35 (current HP) are reliably mapped. All other script calls return the stub default 5. `set_critter_stat` (opcode `0x80CB`) is entirely unimplemented.

---

## 3. HP System

### 3.1 CE HP Flow (`critter.cc`)

- **Storage:** `critter->data.critter.hp` — runtime integer field, initialized from `baseStats[STAT_CURRENT_HIT_POINTS]` which equals `baseStats[STAT_MAXIMUM_HIT_POINTS]` on spawn.
- **Adjustment:** `critterAdjustHitPoints(critter, delta)` (`critter.cc:293`):
  1. Reads `maximumHp = critterGetStat(critter, STAT_MAXIMUM_HIT_POINTS)`
  2. `newHp = critter->data.critter.hp + delta`
  3. Clamps to `maximumHp` if above
  4. If `newHp <= 0 && !DAM_DEAD` → calls `critterKill(critter, -1, true)`
- **Dead check:** `critterIsDead()` (`critter.cc:950`) — returns true if `STAT_CURRENT_HIT_POINTS <= 0` OR `DAM_DEAD` flag set.
- **Active check:** `critterIsActive()` — alive, not knocked-out, not losing-turn.

### 3.2 DH2 HP Flow

- **Storage:** `Critter.stats.baseStats['HP']` and `Critter.stats.baseStats['Max HP']`
- **Damage:** `critterDamage(obj, damage, ...)` (`critter.ts:556`):
  1. `obj.stats.modifyBase('HP', -damage)`
  2. Fire `damage_p_proc` script procedure if applicable
  3. `obj.getStat('HP') <= 0` → `critterKill(obj, source, ...)`
- **Healing:** `critterHeal(obj, amount)` in scripting / `critter_heal()` (`scripting.ts:978`):
  - Clamps to `maxHp - hp`, then `obj.stats.modifyBase('HP', healed)`
- **Death:** `critterKill()` (`critter.ts:441`):
  1. Guards against double-kill with `if (obj.dead) return`
  2. Sets `obj.dead = true`
  3. Awards `+1 Karma` to player for hostile kills
  4. Fires `destroy` script procedure via `Scripting.destroy()`
  5. Picks death animation (priority: passed animName → `obj.deathAnim` → damage type → fallback `'death'`)
  6. Plays death animation, then freezes on last frame (`obj.anim = 'dead'`)
  7. Spawns blood pool decal for non-Explosion/Electrical/EMP deaths
  8. Shows "YOU ARE DEAD" overlay if player dies

### 3.3 Combat Damage Flags (`DAM_*`, `obj_types.h:127`)

CE stores these in `critter->data.critter.combat.results` (a bitmask). In DH2, `obj.injuryFlags` (set by `critter_injure`) partially mirrors this.

| Flag | Value | Meaning | DH2 Status |
|---|---|---|---|
| `DAM_KNOCKED_OUT` | 0x01 | Unconscious (skips turns, timer-wake) | PARTIAL — `critter.ts` plays knockdown anim; `knockoutEventProcess` not implemented |
| `DAM_KNOCKED_DOWN` | 0x02 | Prone (movement penalty, stand-up next turn) | PARTIAL — `obj.isKnockedDown` flag; stand-up transition wired |
| `DAM_CRIP_LEG_LEFT` | 0x04 | Left leg crippled (movement ×4 AP cost) | STUB — `injuryFlags` stores value; movement cost not applied |
| `DAM_CRIP_LEG_RIGHT` | 0x08 | Right leg crippled | STUB |
| `DAM_CRIP_ARM_LEFT` | 0x10 | Left arm crippled (weapon selection affected) | STUB |
| `DAM_CRIP_ARM_RIGHT` | 0x20 | Right arm crippled | STUB |
| `DAM_BLIND` | 0x40 | Blinded (perception −5, aimed shots disabled) | STUB |
| `DAM_DEAD` | 0x80 | Dead | WIRED — `critter_injure` with 0x80 calls `critterKill()` |
| `DAM_LOSE_TURN` | 0x8000 | Loses next combat turn | PARTIAL — `critter.skipTurns` counter used |
| `DAM_CRIP_LEG_ANY` | 0x0C | Either leg crippled | Composite |
| `DAM_CRIP_ARM_ANY` | 0x30 | Either arm crippled | Composite |
| `DAM_CRIP` | 0x74 | Any crippling condition | Composite |

**DH2 `critter_injure` (`scripting.ts:946`):** Stores `how` bitmask into `obj.injuryFlags`. Only the `0x80` (DAM_DEAD) path is actively handled — all other flags are stored but no system reads them to apply movement/combat penalties.

**CE movement penalty for crippled legs** (`critter.cc:1349`): both legs = 8× AP cost per step; one leg = 4×. Not implemented in DH2.

---

## 4. AI Packages

### 4.1 CE `AiPacket` Struct (`combat_ai.cc:59`)

Each critter's proto references an `aiPacket` integer (index into AI.TXT). CE reads all AI.TXT entries at startup into `gAiPackets[]`.

| Field | Type | Meaning |
|---|---|---|
| `name` | char* | Packet section name in AI.TXT |
| `packet_num` | int | Numeric ID matching `CritterProto.aiPacket` |
| `max_dist` | int | Maximum tiles to engage target |
| `min_to_hit` | int | Minimum hit chance (%) before weapon is considered |
| `min_hp` | int | HP threshold to trigger flee |
| `aggression` | int | Aggression scaling for attacks per turn |
| `hurt_too_much` | int | `HurtTooMuch` enum — which injury state triggers behavior change |
| `secondary_freq` | int | How often secondary attack mode is preferred |
| `called_freq` | int | How often aimed (called) shots are taken |
| `font/color/outline_color` | int | Text display for combat taunts |
| `chance` | int | % chance to emit combat message |
| `run/move/attack/miss/hit[]` | AiMessageRange | Message ID ranges for each event type |
| `area_attack_mode` | int | `AreaAttackMode` — when to use area-of-effect attacks |
| `run_away_mode` | int | `RunAwayMode` — flee trigger (NONE/COWARD/FINGER_HURTS/BLEEDING/etc.) |
| `best_weapon` | int | `BestWeapon` — weapon type preference (MELEE/RANGED/UNARMED/etc.) |
| `distance` | int | `DistanceMode` — STAY_CLOSE/CHARGE/SNIPE/ON_YOUR_OWN/STAY |
| `attack_who` | int | `AttackWho` — WHOMEVER_ATTACKING_ME/STRONGEST/WEAKEST/CLOSEST |
| `chem_use` | int | `ChemUse` — drug usage policy |
| `chem_primary_desire[3]` | int[] | Preferred drug types (indices into item list) |
| `disposition` | int | `Disposition` — overall behavior (COWARD/DEFENSIVE/AGGRESSIVE/BERKSERK) |
| `body_type` / `general_type` | char* | String classification for body/creature type |

**CE `combat_ai.cc` usage of key fields:**
- `min_hp` → `_cai_get_min_hp()` → flee if current HP ≤ threshold
- `max_dist` → engagement range; critter won't attack outside range
- `min_to_hit` → skip weapon if computed hit chance < threshold
- `best_weapon` → `_ai_best_weapon()` — weapon selection scoring
- `attack_who` → target priority sort (`_ai_sort_list_strength`, `_ai_sort_list_weakness`, nearest)
- `run_away_mode` → maps to HP % thresholds (COWARD=25%, BLEEDING=50%, etc.)
- `area_attack_mode` → `_cai_retargetTileFromFriendlyFire()` — avoid burst/explosion splash
- `distance` → movement AI (CHARGE = move into melee; SNIPE = maintain range)
- `disposition` → combined with damage state to pick behavior branch

### 4.2 DH2 AI Implementation

**Loading (`combat.ts:127–165`):** `AI.init()` parses `data/data/ai.txt` via `parseIni()`. Numeric fields are converted; string enum fields are stored as raw strings.

**Numeric fields DH2 parses:** `packet_num, max_dist, min_hp, min_to_hit, area_attack_mode, run_start/end, move_start/end, attack_start/end, miss_start/end, hit_*_start/end, chance, team_num, wander_start/end/type`

**Fields actively read by DH2 combat (`combat.ts`):**

| Field | DH2 Location | Used For |
|---|---|---|
| `min_hp` | `combat.ts:1116` | Flee decision: `obj.getStat('HP') <= info.min_hp` |
| `max_dist` | `combat.ts:1404, 1491` | Engagement range check: `hexDistance <= info.max_dist` |
| `chance` | `combat.ts:1103` | Combat taunt message roll |
| `team_num` | `object.ts:1293` | Assigns `critter.teamNum` for friend/foe distinction |

**Fields loaded but never read:** `best_weapon`, `attack_who`, `run_away_mode`, `disposition`, `distance`, `chem_use`, `area_attack_mode`, `min_to_hit`, `hurt_too_much` — parsed from AI.TXT but no code path reads them from `AI.info`.

**DH2 AI behavior summary:** Critters move within `max_dist` of the player, flee when HP ≤ `min_hp`, and attack the player with their equipped weapon each turn. No weapon selection, target priority, stance, or drug use logic.

### 4.3 AI Enum Reference (`combat_ai_defs.h`)

| Enum | Values |
|---|---|
| `AreaAttackMode` | ALWAYS(0), SOMETIMES(1), BE_SURE(2), BE_CAREFUL(3), BE_ABSOLUTELY_SURE(4) |
| `RunAwayMode` | NONE(0), COWARD(1), FINGER_HURTS(2), BLEEDING(3), NOT_FEELING_GOOD(4), TOURNIQUET(5), NEVER(6) |
| `BestWeapon` | NO_PREF(0), MELEE(1), MELEE_OVER_RANGED(2), RANGED_OVER_MELEE(3), RANGED(4), UNARMED(5), UNARMED_OVER_THROW(6), RANDOM(7) |
| `DistanceMode` | STAY_CLOSE(0), CHARGE(1), SNIPE(2), ON_YOUR_OWN(3), STAY(4) |
| `AttackWho` | WHOMEVER_ATTACKING_ME(0), STRONGEST(1), WEAKEST(2), WHOMEVER(3), CLOSEST(4) |
| `ChemUse` | CLEAN(0), STIMS_WHEN_HURT_LITTLE(1), STIMS_WHEN_HURT_LOTS(2), SOMETIMES(3), ANYTIME(4), ALWAYS(5) |
| `Disposition` | NONE(0), CUSTOM(1), COWARD(2), DEFENSIVE(3), AGGRESSIVE(4), BERKSERK(5) |
| `HurtTooMuch` | HURT_BLIND(0), HURT_CRIPPLED(1), HURT_CRIPPLED_LEGS(2), HURT_CRIPPLED_ARMS(3) |

---

## 5. Critter Scripting Opcodes

### 5.1 Full Opcode Table

| Opcode | Intrinsic | Args | CE Function | vm_bridge.ts | scripting.ts | DH2 Status |
|---|---|---|---|---|---|---|
| `0x80CA` | `get_critter_stat` | (obj, statIdx) | `critterGetStat()` | WIRED | `scripting.ts:569` | PARTIAL — indices 0–7, 35 mapped; rest stub → 5 |
| `0x80CB` | `set_critter_stat` | (obj, statIdx, val) | `critterSetBaseStat()` | **NOT WIRED** | **NOT IMPL** | MISSING |
| `0x80E8` | `critter_heal` | (obj, amount) | `critterAdjustHitPoints()` | `0x80E8` | `scripting.ts:978` | WIRED — clamps at maxHP |
| `0x8127` | `critter_injure` | (obj, damFlags) | `critter->results |= flags` | `0x8127` | `scripting.ts:946` | PARTIAL — stores flags; only 0x80 (kill) has effect |
| `0x80EF` | `critter_dmg` | (obj, dmg, type) | `attackComputeDamage` chain | `0x80EF` | `scripting.ts:971` | WIRED — calls `critterDamage()` |
| `0x80ED` | `kill_critter` | (obj, deathFrame) | `critterKill()` | `0x80ED` | `scripting.ts:883` | PARTIAL — calls `critterKill()`; deathFrame ignored |
| `0x80FB` | `critter_state` | (obj) | `critterIsDead() + critterIsCrippled()` | `0x80FB` | `scripting.ts:870` | PARTIAL — bit 0 (dead) wired; bit 1 (prone) stub |
| `0x8102` | `critter_add_trait` | (obj, traitType, trait, amount) | `critterSetBonusStat/perkAddEffect` | `0x8102` | `scripting.ts:605` | STUB — wired but body is `stub()` only |
| `0x8106` | `critter_inven_obj` | (obj, who) | item slot accessor | WIRED | implemented | WIRED |
| `0x80FF` | `critter_attempt_placement` | (obj, tile, elev) | placement | WIRED | implemented | WIRED |
| `0x813C` | `critter_mod_skill` | (obj, skill, delta) | `skillAdd/Sub` | WIRED | implemented | WIRED |
| `0x8151` | `critter_is_fleeing` | (obj) | `critterIsFleeing()` | WIRED | `scripting.ts:955` | WIRED — checks `obj.fleeing` |
| `0x8152` | `critter_set_flee_state` | (obj, state) | `maneuver |= FLEEING` | WIRED | implemented | WIRED |
| `0x80DA` | `wield_obj_critter` | (obj, item) | `invenWieldObj()` | WIRED | `scripting.ts:959` | WIRED — sets `critter.rightHand` |
| — | `kill_critter_type` | (killType) | kill all critters of type | **NOT WIRED** | **NOT IMPL** | MISSING |
| — | `critter_rm_trait` | (obj, traitType, trait) | reverse `critter_add_trait` | **NOT WIRED** | **NOT IMPL** | MISSING |

### 5.2 `critter_state` Detail

CE `critter_state` bitmask (`scripting.ts:870` partial implementation):

| Bit | CE Meaning | DH2 Status |
|---|---|---|
| 0 (`0x01`) | Dead | WIRED — `obj.dead === true` |
| 1 (`0x02`) | Prone (knocked down or out) | STUB — `// TODO: if obj is prone, state |= 2` |

CE also returns a non-zero value for poisoned, radiated, etc. — all stub in DH2.

### 5.3 `critter_add_trait` Detail

CE semantics: `critter_add_trait(obj, traitType, trait, amount)` where `traitType` selects the attribute family:
- `TRAIT_OBJECT = 0` — modifies object data fields (team, rotation, etc.)
- `TRAIT_PERK = 1` — calls `perkAddEffect(obj, perkIdx)` `amount` times
- `TRAIT_OBJECT_DATA = 2` — modifies stat/derived data
- `TRAIT_TAG = 3` — tags a skill

DH2 implementation at `scripting.ts:605`: calls `stub()` for all cases. The body after the stub call has guard clauses but no actual logic. Any FO2 script calling `critter_add_trait(npc, TRAIT_PERK, PERK_*)` is a silent no-op.

---

## 6. Critter Type / Proto Lookup

### 6.1 CE Proto Resolution

CE `critterGetStat(critter, stat)` (`stat.cc`):
1. Calls `protoGetProto(critter->pid, &proto)` — looks up the `Proto*` from the in-memory cache
2. Base stat = `proto->critter.data.baseStats[stat]` + trait modifier (from selected traits array)
3. Bonus stat = `proto->critter.data.bonusStats[stat]`
4. Applies derived stat formula (`critterUpdateDerivedStats`) for indices 7–32
5. Returns `base + bonus + derived`

CE `protoGetProto()` uses an LRU cache of proto extents (`ProtoList` / `ProtoListExtent`). On cache miss it loads the `.PRO` file from disk. Changes to a critter's stats write back to the in-memory proto (for `gDude` this is the save/load path).

### 6.2 DH2 Proto Resolution

**Load time:** `loadPRO(pid, pidID)` → `globalState.proMap[type][id]` (all protos pre-loaded as JSON).

**Stat access at runtime:** `critter.stats.getBase(statName)` / `critter.getStat(statName)` — reads from `StatSet.baseStats` which was populated from the merged proto JSON at initialization.

**Key gap:** CE allows runtime stat modifications via `critterSetBonusStat(critter, stat, value)` which writes to `proto->critter.data.bonusStats[stat]`. This is used by:
- `perkAddEffect()` — perk stat bonuses
- `_process_rads()` — radiation stat penalties
- Combat drug effects

DH2 has no equivalent; all proto stats are read-only after initialization. `critterSetRawStat()` in `critter.ts:603` logs a `console.warn` TODO and does nothing.

### 6.3 Kill Types

CE tracks kills by type in `gKillsByType[KILL_TYPE_COUNT]` for Karma variable lookups. The 19 kill types are:

| Value | Constant | Critter Category |
|---|---|---|
| 0 | `KILL_TYPE_MAN` | Male human |
| 1 | `KILL_TYPE_WOMAN` | Female human |
| 2 | `KILL_TYPE_CHILD` | Child |
| 3 | `KILL_TYPE_SUPER_MUTANT` | Super Mutant |
| 4 | `KILL_TYPE_GHOUL` | Ghoul |
| 5 | `KILL_TYPE_BRAHMIN` | Brahmin |
| 6 | `KILL_TYPE_RADSCORPION` | Radscorpion |
| 7 | `KILL_TYPE_RAT` | Rat |
| 8 | `KILL_TYPE_FLOATER` | Floater |
| 9 | `KILL_TYPE_CENTAUR` | Centaur |
| 10 | `KILL_TYPE_ROBOT` | Robot |
| 11 | `KILL_TYPE_DOG` | Dog |
| 12 | `KILL_TYPE_MANTIS` | Mantis |
| 13 | `KILL_TYPE_DEATH_CLAW` | Deathclaw |
| 14 | `KILL_TYPE_PLANT` | Plant |
| 15 | `KILL_TYPE_GECKO` | Gecko |
| 16 | `KILL_TYPE_ALIEN` | Alien |
| 17 | `KILL_TYPE_GIANT_ANT` | Giant Ant |
| 18 | `KILL_TYPE_BIG_BAD_BOSS` | Special boss |

**DH2 status:** Kill type is read from `pro.extra.killType` and available on `critter` objects, but `critterKill()` in `critter.ts` does not increment kill counters. No `killsGetByType` / `killsIncByType` equivalent exists. Scripts using `kill_type_count(killType)` will always get 0.

---

## 7. Known Gaps

| # | Area | CE Behavior | DH2 Status | Impact |
|---|---|---|---|---|
| 1 | `set_critter_stat` (0x80CB) | `critterSetBaseStat()` — writes to proto baseStats | MISSING — not wired | Scripts cannot set NPC stats at runtime; common for encounter setup |
| 2 | `get_critter_stat` coverage | Returns any of 38 stat indices | PARTIAL — only 9 indices mapped | Scripts reading AP (8), AC (9), sequence (13), DR/DT (17–30) etc. always get 5 |
| 3 | `critter_add_trait` body | Grants perk/modifies object data | STUB — wired but no-op | NPC perk grants via script fail silently |
| 4 | `kill_critter_type` | Kills all critters of a kill-type on map | MISSING — not wired | Area-clear scripts broken |
| 5 | `critter_rm_trait` | Removes perk / reverses object data | MISSING — not wired | Cannot remove script-granted perks |
| 6 | `critter_state` prone bit | Bit 1 = DAM_KNOCKED_OUT\|DOWN | STUB — returns 0 for bit 1 | Scripts checking if critter is prone always get false |
| 7 | `critter_injure` effect | DAM_CRIP_* flags affect movement/weapon use | STUB — stored but not applied | Crippled legs/arms/blind never penalize critter |
| 8 | Critter bonus stat layer | `bonusStats[35]` modified live by perks/drugs/radiation | MISSING — stats baked at load | NPCs cannot receive runtime stat boosts from any source |
| 9 | `CritterProtoData.flags` | INVULNERABLE/NO_LIMBS/NO_DROP/BARTER flags | MISSING — not read | Invulnerable NPCs die; non-lootable NPCs drop items |
| 10 | Kill type tracking | `gKillsByType[]` incremented on kill | MISSING | `kill_type_count()` always returns 0; Karma quest vars based on kill type never advance |
| 11 | AI best_weapon selection | `_ai_best_weapon()` uses BestWeapon enum | STUB — field loaded but not used | NPCs always use equipped weapon; never switch to preferred type |
| 12 | AI attack_who priority | STRONGEST/WEAKEST/CLOSEST target sort | STUB — always attacks player | NPCs ignore companions and alternate targets |
| 13 | AI run_away_mode | HP% thresholds per mode (COWARD=25%, etc.) | PARTIAL — only `min_hp` integer checked | Flee threshold is absolute HP not percentage; NEVER mode not respected |
| 14 | AI distance/disposition | CHARGE/SNIPE stance and combat style | STUB — unused fields | Snipers charge, cowards berserker-rush, defenders abandon position |
| 15 | Crippled leg movement penalty | 4× AP per step (one leg), 8× (both) | STUB | Crippled critters move at full speed |
| 16 | XP grant on kill | `critterGetExp()` → `pcAddExperience()` | STUB — `pro.extra.experience` not used | No XP rewarded for any kill |
| 17 | `critterSetRawStat` | Internal DH2 function for stat writes | STUB — logs `console.warn`, no effect | Any code path that reaches this silently fails |
