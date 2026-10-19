# Critter Stats & Combat Attributes — DarkHarold2 Reference

> Ground-truth: `raw/fallout2-ce/src/proto_types.h`, `critter.cc`, `critter.h`, `combat_ai.cc`, `combat_ai_defs.h`, `stat_defs.h`, `obj_types.h`  
> DH2 impl: `src/object/Critter.ts`, `src/object/Obj.ts`, `src/critter/Weapon.ts`, `src/critter/lifecycle.ts`, `src/pro.ts`, `src/char.ts`, `src/combat.ts` (barrel; `src/combat/*.ts`), `src/scripting.ts`, `src/vm_bridge.ts`

This document covers non-player critters only. SPECIAL stat formulas are documented in `wiki/character_stats.md`. Skill formulas are in `wiki/skill_checks.md`. Perk/trait system is in `wiki/perks_traits.md`.

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

No binary `.PRO` files at runtime — the Python pipeline extracts them to `proto/**/*.json` (via `tools/proto.py`). These are loaded into `globalState.proMap` from `proto/pro.json` at startup (`main.ts:564`).

**Proto lookup path:** `src/pro.ts:loadPRO(pid, pidID)` → `globalState.proMap[type][id]`

```
pid high byte → type name:  0=items, 1=critters, 2=scenery, 3=walls, 4=tiles, 5=misc
```

**JSON fields used by `Critter.initFromPro()` (`object.ts`):**

| JSON field path | CE source | DH2 consumer |
|---|---|---|
| `pro.extra.baseStats` | `CritterProtoData.baseStats` | `StatSet.fromPro()` in `char.ts:243` |
| `pro.extra.bonusStats` | `CritterProtoData.bonusStats` | `StatSet.fromPro()` — merged into baseStats |
| `pro.extra.skills` | `CritterProtoData.skills` | `SkillSet.fromPro()` in `char.ts:61` |
| `pro.extra.AI` | `CritterProto.aiPacket` | `critter.aiNum` (`object.ts`) |
| `pro.extra.team` | `CritterProto.team` | `critter.teamNum` (`object.ts`) |
| `pro.extra.bodyType` | `CritterProtoData.bodyType` | door use (`map/pathfinder.ts canUseDoor`), called-shot window, death anims |
| `pro.extra.experience` | `CritterProtoData.experience` | XP on kill (`combat/Combat.ts`, CE `_combat_exps`) |
| `pro.extra.killType` | `CritterProtoData.killType` | `killCounts` (`critter/lifecycle.ts`), `kill_type_count`, aging, gecko pathing |
| `pro.extra.flags` | `CritterProtoData.flags` | see §1.3 |

**`StatSet.fromPro()` (`char.ts:244`):** merges `baseStats + bonusStats` into one base. DH2 keeps no separate bonus layer; perks, drugs, radiation and armor perks write the base symmetrically (apply / remove), see `perks_traits.md` §4.4.

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

**DH2 status (all read from `pro.extra.flags`):**

| Flag | DH2 |
|---|---|
| `CRITTER_BARTER` | `metarule METARULE_CRITTER_BARTERS`, dialogue BARTER button (`ui_dialogue.ts`) |
| `CRITTER_NO_STEAL` | action menu / steal (`ui_contextmenu.ts`) |
| `CRITTER_NO_DROP` | no DAM_DROP (`combat/results.ts attackFindInvalidFlags`), no drop on death / aging |
| `CRITTER_NO_HEAL` / robots | no healing / aging on map revisit (`map/mapLoader.ts mapAgeDeadCritters`) |
| `CRITTER_INVULNERABLE` | no damage, no results (`combat/Combat.ts`, `combat/results.ts`) |
| `CRITTER_FLAT` | aged-corpse frame (`mapAgeDeadCritters`) |
| `CRITTER_SPECIAL_DEATH` | death anim choice, no item drop (`critter/deathAnim.ts`, `critter/lifecycle.ts`) |
| `CRITTER_LONG_LIMBS` | unarmed range 2 (`combat/Combat.ts`) |
| `CRITTER_NO_KNOCKBACK` | no knockback (`combat/Combat.ts`, `critter/lifecycle.ts`) |
| `CRITTER_NO_LIMBS`, `CRITTER_NO_AGE` | not referenced by the CE engine either |

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
| 7 | `STAT_MAXIMUM_HIT_POINTS` | `Max HP` | baseStats[7] | `'Max HP'` | WIRED (Alcohol/Autodoc perks in `Player.getStat`) |
| 8 | `STAT_MAXIMUM_ACTION_POINTS` | `AP` | baseStats[8] | special case | WIRED — `getStat('AP')`, overweight penalty |
| 9 | `STAT_ARMOR_CLASS` | `AC` | baseStats[9] | special case | WIRED — base + worn armor AC + unused combat AP (`bonusAC`, HtH Evade) |
| 10 | `STAT_UNARMED_DAMAGE` | — | baseStats[10] | special case | returns 0 (unarmed bonus is per hit mode, `unarmed.ts`) |
| 11 | `STAT_MELEE_DAMAGE` | `Melee` | baseStats[11] | `'Melee'` | WIRED |
| 12 | `STAT_CARRY_WEIGHT` | `Carry` | baseStats[12] | `'Carry'` | WIRED |
| 13 | `STAT_SEQUENCE` | `Sequence` | baseStats[13] | special case | WIRED |
| 14 | `STAT_HEALING_RATE` | `Healing Rate` | baseStats[14] | `'Healing Rate'` | WIRED |
| 15 | `STAT_CRITICAL_CHANCE` | `Critical Chance` | baseStats[15] | `'Critical Chance'` | WIRED |
| 16 | `STAT_BETTER_CRITICALS` | `Better Criticals` | baseStats[16] | `'Better Criticals'` | WIRED |
| 17–23 | `STAT_DAMAGE_THRESHOLD*` | `DT <type>` | baseStats[17–23] | special case | WIRED — stat + worn armor DT |
| 24–30 | `STAT_DAMAGE_RESISTANCE*` | `DR <type>` | baseStats[24–30] | special case | WIRED — stat + worn armor DR (implant perks in `Player.getStat`) |
| 31 | `STAT_RADIATION_RESISTANCE` | `DR Radiation` | baseStats[31] | special case | WIRED |
| 32 | `STAT_POISON_RESISTANCE` | `DR Poison` | baseStats[32] | special case | WIRED |
| 33 | `STAT_AGE` | `Age` | baseStats[33] | special case | WIRED — + game years |
| 34 | `STAT_GENDER` | `Gender` | baseStats[34] | special case | WIRED — player choice, else proto |
| 35 | `STAT_CURRENT_HIT_POINTS` | `HP` | runtime | `'HP'` | WIRED |
| 36 | `STAT_CURRENT_POISON_LEVEL` | — | runtime | special case | WIRED — `poisonLevel` |
| 37 | `STAT_CURRENT_RADIATION_LEVEL` | — | runtime | special case | WIRED — `radiationLevel` |

**`get_critter_stat`** (`scripting.ts`) covers all 38 indices. **`set_critter_stat`** is CE `opSetCritterStat`: dude only, additive on the base; derived stats 7–32 are refused, 35–37 go through HP / poison / radiation adjust.

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
- **Damage:** `critterDamage(obj, damage, ...)` (`critter.ts`):
  1. `obj.stats.modifyBase('HP', -damage)`
  2. Fire `damage_p_proc` script procedure if applicable
  3. `obj.getStat('HP') <= 0` → `critterKill(obj, source, ...)`
- **Healing:** `critterHeal(obj, amount)` in scripting / `critter_heal()` (`scripting.ts:978`):
  - Clamps to `maxHp - hp`, then `obj.stats.modifyBase('HP', healed)`
- **Death:** `critterKill()` (`critter/lifecycle.ts`, CE `critterKill`): `destroy_p_proc`, kill count by kill type, death animation (`critter/deathAnim.ts`), items dropped unless NO_DROP / SPECIAL_DEATH, the dude's death scene. Karma for kills comes from the critters' scripts, as in CE.
- **Map revisit** (`map/mapLoader.ts`, CE `mapLoadSaved` → `_map_age_dead_critters`): with `dead_bodies_age` (maps.txt, default Yes) living non-party critters stop fleeing and heal 14 HP per 3 hours away; after more than 6 days corpses drop their items and become a blood / bones pile. ≥ 24 hours away also unjams the map's locks.

### 3.3 Combat Damage Flags (`DAM_*`, `obj_types.h:127`)

CE stores these in `critter->data.critter.combat.results` (a bitmask). In DH2, `obj.injuryFlags` (set by `critter_injure`) partially mirrors this.

| Flag | Value | Meaning | DH2 Status |
|---|---|---|---|
| `DAM_KNOCKED_OUT` | 0x01 | Unconscious (skips turns, timer-wake) | WIRED — `combat/results.ts setNewResults` queues `knockoutEventProcess` |
| `DAM_KNOCKED_DOWN` | 0x02 | Prone, stands up on its turn | WIRED — `combatStandup` |
| `DAM_CRIP_LEG_LEFT` | 0x04 | Left leg crippled | WIRED — movement ×4 AP (×8 both, `combat/actionPoints.ts`), no running |
| `DAM_CRIP_LEG_RIGHT` | 0x08 | Right leg crippled | WIRED (as above) |
| `DAM_CRIP_ARM_LEFT` | 0x10 | Left arm crippled | WIRED — no two-handed weapons (`combat/Combat.ts`) |
| `DAM_CRIP_ARM_RIGHT` | 0x20 | Right arm crippled | WIRED — both arms: no attacks with weapons |
| `DAM_BLIND` | 0x40 | Blinded (PE −5 to min 1) | WIRED — `Critter.getStat('PER')`, to-hit |
| `DAM_DEAD` | 0x80 | Dead | WIRED |
| `DAM_LOSE_TURN` | 0x8000 | Loses next combat turn | WIRED |
| `DAM_CRIP_LEG_ANY` | 0x0C | Either leg crippled | Composite |
| `DAM_CRIP_ARM_ANY` | 0x30 | Either arm crippled | Composite |
| `DAM_CRIP` | 0x7C | Any crippling condition | Composite |

**DH2 `critter_injure`** is CE `opCritterInjure`: only the DAM_CRIP bits; `DAM_PERFORM_REVERSE` (0x800000) heals them.

---

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

`src/combat/AI.ts` (AI.TXT parsing) and `src/aiPackets.ts`; the turn logic is the `_combat_ai` port in `src/combat/Combat.ts` (known_bugs C28/C29): all packet fields are used — best weapon, attack_who, run_away_mode (HP %), area_attack_mode, distance, disposition, chem use, called / secondary frequency, taunts. See `wiki/ai_behavior.md`.

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

| Opcode | Intrinsic | Args | CE | DH2 (`src/scripting.ts`) |
|---|---|---|---|---|
| `0x80CA` | `get_critter_stat` | (obj, stat) | `critterGetStat` | all 38 stats (§2) |
| `0x80CB` | `set_critter_stat` | (obj, stat, delta) | `opSetCritterStat` | dude only, additive (§2) |
| `0x80E8` | `critter_heal` | (obj, amount) | `critterAdjustHitPoints` | clamps at Max HP |
| `0x8127` | `critter_injure` | (obj, flags) | `opCritterInjure` | DAM_CRIP bits, reverse |
| `0x80EF` | `critter_dmg` | (obj, dmg, type) | `actionDamage` | `critterDamage` |
| `0x80ED` | `kill_critter` | (obj, deathFrame) | `critterKill` | single-frame death `deathFrame` |
| `0x80FB` | `critter_state` | (obj) | `opGetCritterState` | DEAD / PRONE (knocked out or down) + DAM_CRIP bits |
| `0x8102` | `critter_add_trait` | (obj, type, id, amount) | `opCritterAddTrait` | perks (`perkRankOwner`), AI packet, team |
| `0x8103` | `critter_rm_trait` | (obj, type, id, value) | `opCritterRemoveTrait` | perks |
| `0x8106` | `critter_inven_obj` | (obj, which) | `opCritterGetInventoryObject` | hands, armor, count |
| `0x80FF` | `critter_attempt_placement` | (obj, tile, elev) | `_obj_attempt_placement` | implemented |
| `0x813C` | `critter_mod_skill` | (obj, skill, delta) | `opCritterModifySkill` | implemented |
| `0x8151` | `critter_is_fleeing` | (obj) | `opCritterIsFleeing` | `fleeing` |
| `0x8152` | `critter_set_flee_state` | (obj, state) | `opCritterSetFleeState` | implemented |
| `0x80DA` | `wield_obj_critter` | (obj, item) | `opWieldItem` → `_invenWieldFunc` | `inventoryWield.ts` |
| `0x80EE` | `kill_critter_type` | (pid, deathFrame) | `opKillCritterType` | implemented |

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

**Bonus layer:** CE writes perk, drug, radiation and armor bonuses to `bonusStats` (`critterSetBonusStat`). DH2 writes the same deltas to the base stats and removes them symmetrically (`perkApplyEffect`, `drugs.ts`, `radiation.ts`, `armorPerkSwap`).

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

**DH2:** `critterKill` counts kills per type in `killCounts` (`critter/lifecycle.ts`, saved with the game like CE `killsSave`); `kill_type_count` reads it.

---

## 7. Known Gaps

| # | Area | CE | DH2 |
|---|---|---|---|
| 1 | Bonus stat layer | Separate `bonusStats` | Deltas on the base stats (equivalent while applied/removed symmetrically) |
| 2 | `STAT_UNARMED_DAMAGE` | Proto base + bonus (0 for every vanilla critter) | Always 0 |

Everything else in this doc is implemented. <!-- audited: 2026-10-18 -->
