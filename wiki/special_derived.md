# DarkHarold2 — SPECIAL & Derived Stats Reference

**Audited:** 2026-05-31  
**CE ref:** `raw/fallout2-ce/src/stat_defs.h`, `stat.cc`, `trait.cc`, `character_editor.cc`  
**DH2 ref:** `src/skills.ts` (`statDependencies`), `src/object.ts` (`StatSet`), `src/player.ts`, `src/ui_character.ts`  

Skill formulas that derive from SPECIAL (Small Guns = 5 + 4×AGI, etc.) are documented
in `wiki/skill_checks.md` and are not repeated here.

---

## 1. SPECIAL Stats

CE `stat_defs.h` — primary stat indices 0–6. DH2 stores each as a named key in `StatSet.baseStats`.

| # | CE Constant | DH2 Name | Abbrev | Default | Range | DH2 storage |
|---|-------------|----------|--------|---------|-------|-------------|
| 0 | `STAT_STRENGTH` | `'STR'` | ST | 5 | 1–10 | `StatSet.baseStats['STR']` |
| 1 | `STAT_PERCEPTION` | `'PER'` | PE | 5 | 1–10 | `StatSet.baseStats['PER']` |
| 2 | `STAT_ENDURANCE` | `'END'` | EN | 5 | 1–10 | `StatSet.baseStats['END']` |
| 3 | `STAT_CHARISMA` | `'CHA'` | CH | 5 | 1–10 | `StatSet.baseStats['CHA']` |
| 4 | `STAT_INTELLIGENCE` | `'INT'` | IN | 5 | 1–10 | `StatSet.baseStats['INT']` |
| 5 | `STAT_AGILITY` | `'AGI'` | AG | 5 | 1–10 | `StatSet.baseStats['AGI']` |
| 6 | `STAT_LUCK` | `'LUK'` | LK | 5 | 1–10 | `StatSet.baseStats['LUK']` |

`PRIMARY_STAT_MIN = 1`, `PRIMARY_STAT_MAX = 10` (stat_defs.h).  
`PRIMARY_STAT_COUNT = 7`.

### 1.1 `StatSet.get()` and `StatSet.getBase()`

**CE** (`stat.cc:182` `critterGetStat`): value chain is `critterGetBaseStat` + `traitGetStatModifier` (if player) + `critterGetBonusStat` + perk bonuses + context modifiers (blindness, overweight, HTH Evade AC) + clamp.

**DH2** (`object.ts:277` `StatSet.get()`): reads `baseStats[stat]` (falls back to `statDep.defaultValue`), sums derived dependencies, clamps to `[statDep.min, statDep.max]`. No live trait or perk modifier chain — those are applied once at creation or explicitly added to base.

---

## 2. Derived Stats

### 2.1 CE formulas (`stat.cc:554` `critterUpdateDerivedStats`)

Called whenever a primary SPECIAL changes (via `critterSetBaseStat` or `critterSetBonusStat`). Writes directly to `proto->critter.data.baseStats[]`.

```c
// stat.cc:567–577
baseStats[STAT_MAXIMUM_HIT_POINTS] = baseSTR + 2*baseEND + 15
    // (baseSTR/baseEND are from critterGetBaseStatWithTraitModifier, not critterGetStat)
baseStats[STAT_MAXIMUM_ACTION_POINTS] = AGI / 2 + 5          // integer division
baseStats[STAT_ARMOR_CLASS]           = AGI
baseStats[STAT_MELEE_DAMAGE]          = max(STR - 5, 1)
baseStats[STAT_CARRY_WEIGHT]          = 25 * STR + 25
baseStats[STAT_SEQUENCE]              = 2 * PER
baseStats[STAT_HEALING_RATE]          = max(END / 3, 1)       // integer division
baseStats[STAT_CRITICAL_CHANCE]       = LUK
baseStats[STAT_BETTER_CRITICALS]      = 0
baseStats[STAT_RADIATION_RESISTANCE]  = 2 * END
baseStats[STAT_POISON_RESISTANCE]     = 5 * END
```

`STAT_UNARMED_DAMAGE` (index 10) is NOT computed here; it's proto-sourced (default 0).  
DT/DR stats (STAT_DAMAGE_THRESHOLD_* and STAT_DAMAGE_RESISTANCE_*) are NOT computed here; they come from equipped armor only.

### 2.2 Full derived stats table

| CE Constant | CE index | DH2 Name | Formula (CE) | DH2 Formula (skills.ts) | CE min–max | DH2 min–max | Status |
|-------------|----------|----------|-------------|------------------------|------------|-------------|--------|
| `STAT_MAXIMUM_HIT_POINTS` | 7 | `'Max HP'` | 15 + 2×EN + ST | `15 + 2×END + STR` | 0–999 | 0–999 | MATCH |
| `STAT_MAXIMUM_ACTION_POINTS` | 8 | `'AP'` | 5 + AG÷2 | `5 + AGI×0.5` | 1–99 | 1–99 | MATCH |
| `STAT_ARMOR_CLASS` | 9 | `'AC'` | AG | `AGI×1` | 0–999 | 0–999 | MATCH |
| `STAT_UNARMED_DAMAGE` | 10 | *(not in statDependencies)* | proto default 0 | — | 0–INT_MAX | — | NOT IN DH2 |
| `STAT_MELEE_DAMAGE` | 11 | `'Melee'` | max(ST−5, 1) | `max(−5 + STR×1, 1)` | 0–500 | 1–500 | MATCH |
| `STAT_CARRY_WEIGHT` | 12 | `'Carry'` | 25×ST + 25 | `25 + STR×25` | 0–999 | 0–999 | MATCH |
| `STAT_SEQUENCE` | 13 | `'Sequence'` | 2×PE | `PER×2` | 0–60 | 0–60 | MATCH |
| `STAT_HEALING_RATE` | 14 | `'Healing Rate'` | max(EN÷3, 1) | `END×(1/3)` rounded | 0–30 | 1–30 | MATCH (min=1) |
| `STAT_CRITICAL_CHANCE` | 15 | `'Critical Chance'` | LK | `LUK×1` | 0–100 | 0–100 | MATCH |
| `STAT_BETTER_CRITICALS` | 16 | `'Better Criticals'` | 0 (base) | standalone, no dep | −60–100 | −60–100 | MATCH |
| `STAT_DAMAGE_THRESHOLD` | 17 | `'DT Normal'` | armor only | no dep | 0–100 | 0–100 | MATCH |
| `STAT_DAMAGE_THRESHOLD_LASER` | 18 | `'DT Laser'` | armor only | no dep | 0–100 | 0–100 | MATCH |
| `STAT_DAMAGE_THRESHOLD_FIRE` | 19 | `'DT Fire'` | armor only | no dep | 0–100 | 0–100 | MATCH |
| `STAT_DAMAGE_THRESHOLD_PLASMA` | 20 | `'DT Plasma'` | armor only | no dep | 0–100 | 0–100 | MATCH |
| `STAT_DAMAGE_THRESHOLD_ELECTRICAL` | 21 | `'DT Electrical'` | armor only | no dep | 0–100 | 0–100 | MATCH |
| `STAT_DAMAGE_THRESHOLD_EMP` | 22 | `'DT EMP'` | armor only | no dep | 0–100 | 0–100 | MATCH |
| `STAT_DAMAGE_THRESHOLD_EXPLOSION` | 23 | `'DT Explosive'` | armor only | no dep | 0–100 | 0–100 | MATCH |
| `STAT_DAMAGE_RESISTANCE` | 24 | `'DR Normal'` | armor only | no dep | 0–90 | 0–90 | MATCH |
| `STAT_DAMAGE_RESISTANCE_LASER` | 25 | `'DR Laser'` | armor only | no dep | 0–90 | 0–90 | MATCH |
| `STAT_DAMAGE_RESISTANCE_FIRE` | 26 | `'DR Fire'` | armor only | no dep | 0–90 | 0–90 | MATCH |
| `STAT_DAMAGE_RESISTANCE_PLASMA` | 27 | `'DR Plasma'` | armor only | no dep | 0–90 | 0–90 | MATCH |
| `STAT_DAMAGE_RESISTANCE_ELECTRICAL` | 28 | `'DR Electrical'` | armor only | no dep | 0–90 | 0–90 | MATCH |
| `STAT_DAMAGE_RESISTANCE_EMP` | 29 | `'DR EMP'` | armor only | no dep | 0–100 | 0–100 | MATCH |
| `STAT_DAMAGE_RESISTANCE_EXPLOSION` | 30 | `'DR Explosive'` | armor only | no dep | 0–90 | 0–90 | MATCH |
| `STAT_RADIATION_RESISTANCE` | 31 | `'DR Radiation'` | 2×EN | `END×2` | 0–95 | 0–95 | MATCH |
| `STAT_POISON_RESISTANCE` | 32 | `'DR Poison'` | 5×EN | `END×5` | 0–95 | 0–95 | MATCH |
| `STAT_AGE` | 33 | `'Age'` | 25 default | standalone | 16–101 | 16–101 | MATCH |
| `STAT_GENDER` | 34 | `'Gender'` | 0=male, 1=female | standalone | 0–1 | 0–1 | MATCH |
| `STAT_CURRENT_HIT_POINTS` | 35 | `'HP'` | live HP | `StatSet.baseStats['HP']` | 0–2000 | 0–999 | NOTE |
| `STAT_CURRENT_POISON_LEVEL` | 36 | `'Poison Level'` | live poison | `(critter as any).poisonLevel` | 0–2000 | 0–2000 | MATCH |
| `STAT_CURRENT_RADIATION_LEVEL` | 37 | `'Radiation Level'` | live radiation | `(critter as any).radiationLevel` | 0–2000 | 0–2000 | MATCH |

**HP note:** CE uses `critterGetHitPoints()` (from the critter struct's `hp` field, separate from the stat array). DH2 stores HP in `StatSet.baseStats['HP']`.

DH2 also has additional pseudo-stats not in CE:
- `'Skill Points'` (skill point pool, range 0–999999)
- `'Level'` (1–99), `'Experience'` (0–99999999)
- `'Reputation'` (−20–20), `'Karma'` (unbounded)

### 2.3 HP per level

CE (`stat.cc:771`): on each level-up, adds `floor(EN/2) + 2` to Max HP bonus stat. Lifegiver perk: +4 per rank.

DH2 (`player.ts:116–120`): `hpGain = floor(getStat('END') / 2) + 2`; Lifegiver +4; modifies both `'Max HP'` and `'HP'` base stats.

---

## 3. Stat Modifiers — Traits, Perks, and Chems

### 3.1 CE modifier chain (`stat.cc:182` `critterGetStat`)

CE reads stats through a layered chain:

1. `critterGetBaseStat(critter, stat)` — raw value from `proto->critter.data.baseStats[]`
2. `traitGetStatModifier(stat)` — player-only, live trait modifier (e.g. Gifted +1 all SPECIAL)
3. `critterGetBonusStat(critter, stat)` — bonus layer (drugs, chem effects written here)
4. Perk bonuses — `perkGetRank()` checks for Gain Strength/Perception/etc., Alcohol HP, etc.
5. Context modifiers — blindness (−5 PER), overweight (−AP), unused AP → AC bonus in combat
6. Final clamp to `[gStatDescriptions[stat].min, gStatDescriptions[stat].max]`

### 3.2 DH2 modifier model

DH2 uses a **flat base-only** model — no live modifier chain. `StatSet.get(stat)` returns:
```
clamp(min, max, baseStats[stat] + sum(dep.multiplier * get(dep.statType) for dep in dependencies))
```

Bonuses from drugs and chem effects are written directly to `baseStats` via `StatSet.modifyBase()`, then reversed when the effect expires (see `src/drugs.ts`).

Trait and perk SPECIAL modifiers are applied **once** at character creation in `Player.applyCreationStats()` (`player.ts:142`), not recalculated live.

### 3.3 CE trait stat modifiers (`trait.cc:180` `traitGetStatModifier`)

Applied live in CE (player only). DH2 applies subset at creation only.

| Trait | SPECIAL effect | DH2 status |
|-------|----------------|------------|
| Gifted | +1 to all 7 SPECIAL; −5 skill points/level; −10 all skills | IMPLEMENTED (player.ts:159) |
| Bruiser | +2 STR; −2 AP | STR: IMPLEMENTED (player.ts:162); AP penalty: IMPLEMENTED (traitGetStatModifier) |
| Small Frame | +1 AGI; carry weight penalty (−10×STR) | AGI: IMPLEMENTED (player.ts:165); carry penalty: NOT IMPLEMENTED |
| Kamikaze | AC = 0; +5 Sequence | NOT IMPLEMENTED |
| Fast Metabolism | +2 Healing Rate; Radiation Resistance = 0; Poison Resistance = 0 | NOT IMPLEMENTED |
| Heavy Handed | +4 Melee Damage; −30 Better Criticals | NOT IMPLEMENTED |
| Finesse | +10 Critical Chance | NOT IMPLEMENTED |

DH2 `skills.ts TRAIT_SKILL_MODIFIERS` handles Gifted (−10 all skills) and Good Natured skill effects at the skill-formula level; trait SPECIAL modifiers beyond Gifted/Bruiser/Small Frame are not applied.

### 3.4 CE perk SPECIAL modifiers (`stat.cc:249–366`)

CE handles these live in `critterGetStat`. DH2 does not implement SPECIAL-modifying perks in the stat chain.

| CE Perk | Effect | DH2 status |
|---------|--------|------------|
| Gain Strength/Perception/Endurance/Charisma/Intelligence/Agility/Luck | +1 to that SPECIAL | NOT IMPLEMENTED |
| Adrenaline Rush | +1 STR when HP < 50% | NOT IMPLEMENTED |
| Alcohol Raised HP / Lowered HP (I/II) | ±2/±4 Max HP | NOT IMPLEMENTED |
| Autodoc Raised HP / Lowered HP (I/II) | ±2/±4 Max HP | NOT IMPLEMENTED |
| Lifegiver | +4 Max HP per rank (per level-up) | IMPLEMENTED (player.ts:118) |
| Dermal Impact Armor/Enhancement | +5/+10 DR Normal + DR Explosive | NOT IMPLEMENTED |
| Phoenix Armor/Enhancement | +5/+10 DR Laser/Fire/Plasma | NOT IMPLEMENTED |
| Vault City Inoculations | +10 Radiation Resistance + Poison Resistance | NOT IMPLEMENTED |

---

## 4. Character Creation

### 4.1 Starting SPECIAL points

CE (`character_editor.cc:1907, 5674`): `gCharacterEditorRemainingCharacterPoints = 5`  
DH2 (`ui_character.ts:1012`): `let pool = 5`

All 7 SPECIAL stats start at their default value of **5** each. The player may distribute **5 bonus points** freely among them, subject to min/max per stat.

| | CE | DH2 |
|---|---|---|
| Starting value per stat | 5 | 5 |
| Bonus points to distribute | 5 | 5 |
| Min per stat at creation | 1 | 1 |
| Max per stat at creation | 10 | 10 |

The bonus pool is spent/refunded by incrementing/decrementing stats in the character editor. A stat can only be decreased below 5 if points were previously spent raising it (the pool does not go negative in CE; DH2 enforces the same by preventing decrement when a stat is already at its base default).

### 4.2 Trait effects on point pool

Traits are applied **after** the point pool is spent (they are separate from the 5-point bonus allocation):

| Trait | Effect on SPECIAL at creation | Effect on point pool |
|-------|-------------------------------|----------------------|
| Gifted | +1 to all 7 SPECIAL (applied on top of distributed stats) | None — the +7 is free |
| Bruiser | +2 STR (free bonus) | None |
| Small Frame | +1 AGI (free bonus) | None |

Post-trait SPECIAL values are clamped to [1, 10] (player.ts:170).

### 4.3 Initial skill points (level 1)

CE: `5 + 2×INT` (per level, starting at level 1).  
DH2 (`player.ts:183`): `5 + 2×INT`

Modifiers:
- Gifted trait: −5 skill points/level (DH2: player.ts:112, 184)
- Skilled trait: +5 skill points/level (DH2: player.ts:111, 185)
- Educated perk: +2 per level (DH2: player.ts:110, level-up path only)

### 4.4 Initial Max HP

CE/DH2 both use: `15 + 2×EN + ST` (computed from final post-trait SPECIAL values).  
DH2 sets both `'Max HP'` and `'HP'` to this value at creation (player.ts:177–179).

---

## 5. Scripting Opcodes

### 5.1 `get_critter_stat`

**Opcode:** `0x80CA`  
**CE ref:** `interpreter_extra.cc:4915` `interpreterRegisterOpcode(0x80CA, opGetCritterStat)`  
**Args:** `obj, stat` → returns stat value  
**DH2 wired:** YES (vm_bridge.ts:70)

DH2 `statMap` (scripting.ts:90–100) — indices handled:

| Index | CE Constant | DH2 name | Notes |
|-------|-------------|----------|-------|
| 0 | `STAT_STRENGTH` | `'STR'` | |
| 1 | `STAT_PERCEPTION` | `'PER'` | |
| 2 | `STAT_ENDURANCE` | `'END'` | |
| 3 | `STAT_CHARISMA` | `'CHA'` | |
| 4 | `STAT_INTELLIGENCE` | `'INT'` | |
| 5 | `STAT_AGILITY` | `'AGI'` | |
| 6 | `STAT_LUCK` | `'LUK'` | |
| 7 | `STAT_MAXIMUM_HIT_POINTS` | `'Max HP'` | |
| 34 | `STAT_GENDER` | gender check | Returns 1 (female) or 0 (male); player only |
| 35 | `STAT_CURRENT_HIT_POINTS` | `'HP'` | |
| other | — | — | Falls through to `stub()`, returns 5 |

**Known gap:** CE `critterGetStat` routes through the full modifier chain (bonus stats, perks, context). DH2 calls `obj.getStat(namedStat)` which calls `StatSet.get()` — the dependency chain for derived stats, but no live perk modifiers.

CE stats not handled in DH2 statMap:
- 8: `STAT_MAXIMUM_ACTION_POINTS` — missing (not in statMap; scripts wanting player AP would call via `statMap` but 8 is undefined → stub → 5)
- 9: `STAT_ARMOR_CLASS` — missing
- 11: `STAT_MELEE_DAMAGE` — missing (DH2 name is `'Melee'`, not in statMap)
- 12: `STAT_CARRY_WEIGHT` — missing
- 13–16: Sequence, Healing Rate, Critical Chance, Better Criticals — missing
- 31–32: Radiation/Poison Resistance — missing
- 33: Age — missing
- 36–37: Poison/Radiation Level — missing

### 5.2 `set_critter_stat`

**Opcode:** `0x80CB`  
**CE ref:** `interpreter_extra.cc:4916` `interpreterRegisterOpcode(0x80CB, opSetCritterStat)`  
**CE behavior:** Calls `critterSetBonusStat(critter, stat, value)` — writes to the bonus layer.  
**DH2 status: NOT IMPLEMENTED.** No method on `Script` class, not wired in vm_bridge.ts.

### 5.3 `get_pc_stat` / `set_pc_stat` / `mod_pc_stat`

| Method | CE opcode | DH2 wired | Notes |
|--------|-----------|-----------|-------|
| `get_pc_stat(pcstat)` | `0x80A6` | NOT WIRED | Method exists in scripting.ts:891 |
| `set_pc_stat(pcstat, value)` | unknown | NOT WIRED | Method exists in scripting.ts:910 |
| `mod_pc_stat(pcstat, delta)` | unknown | NOT WIRED | Method exists in scripting.ts:926 |

**CE `PcStat` enum** (stat_defs.h):

| Index | CE Constant | DH2 impl |
|-------|-------------|----------|
| 0 | `PC_STAT_UNSPENT_SKILL_POINTS` | `player.skills.skillPoints` |
| 1 | `PC_STAT_LEVEL` | `player.getStat('Level')` |
| 2 | `PC_STAT_EXPERIENCE` | `player.getStat('Experience')` |
| 3 | `PC_STAT_REPUTATION` | `player.stats.getBase('Reputation')` |
| 4 | `PC_STAT_KARMA` | `player.stats.getBase('Karma')` |

The methods exist and are correct, but because they are not wired in vm_bridge.ts, FO2 scripts calling `get_pc_stat()` or `set_pc_stat()` will crash with an unknown opcode error.

---

## 6. Known Gaps

| Feature | CE behavior | DH2 gap |
|---------|-------------|---------|
| `set_critter_stat` (`0x80CB`) | Writes to critter bonus stat layer | Not implemented; method and opcode wiring both absent |
| `get_pc_stat` (`0x80A6`) | Reads level/XP/skill points/reputation/karma | Method exists in scripting.ts but NOT wired in vm_bridge.ts |
| `set_pc_stat`, `mod_pc_stat` | Write level/XP/reputation/karma | Methods exist but NOT wired; unknown opcode values |
| Live trait modifier chain | `traitGetStatModifier()` recalculated on every `critterGetStat` | DH2 applies trait SPECIAL bonuses once at creation; no live recalculation |
| Gain SPECIAL perks | +1 to specific stat applied in `critterGetStat` perk block | Not implemented; perks collected but stat chain ignores them |
| STAT_UNARMED_DAMAGE (index 10) | Separate proto field for base unarmed damage | No entry in DH2 `statDependencies` or `statMap` |
| `get_critter_stat` for indices 8–16, 31–33, 36–37 | Returns computed/live value | Falls through to `stub()`, returns hardcoded 5 |
| Overweight AP penalty | `critterGetStat(AP)`: if carrying > carry weight, AP reduced by `(-overflow / 40) + 1` | Not implemented |
| Blind −5 PER | `critterGetStat(PER)`: subtracts 5 if `DAM_BLIND` flag set | Not implemented |
| Unused AP → AC bonus | At turn end, each unused AP adds 1 AC (in combat only) | See `wiki/combat.md`; partially implemented |
| Small Frame carry penalty | −10×STR from carry weight | +1 AGI applied; carry penalty ignored |
| Trait derived stat modifiers | Kamikaze zeroes AC, +5 Sequence; Fast Metabolism zeroes rad/poison resist; Bruiser −2 AP; Heavy Handed +4 Melee; Finesse +10 Crit | Only Bruiser's STR bonus and Gifted/Small Frame SPECIAL bonuses applied |
| Alcohol/Autodoc HP perks | ±2/±4 Max HP from perk ranks | Not implemented |
