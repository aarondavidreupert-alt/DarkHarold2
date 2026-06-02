# DarkHarold2 — Character Stats Reference

**Audited:** 2026-06-02  
**CE ref:** `raw/fallout2-ce/src/stat_defs.h`, `stat.cc` (`critterUpdateDerivedStats`,
`critterGetStat`, `critterSetBaseStat`, `critterGetBaseStatWithTraitModifier`),
`character_editor.cc` (`characterEditorShow`, `characterEditorInit`, `characterEditorReset`,
`characterEditorAdjustPrimaryStat`, `characterEditorToggleTaggedSkill`,
`characterEditorToggleOptionalTrait`, `characterEditorUpdateLevel`, `_is_supper_bonus`),
`trait.cc` (`traitGetStatModifier`), `skill.cc` (`skillGetValue`), `proto.cc` (`_ResetPlayer`)  
**DH2 ref:** `src/ui_character.ts` (`showCharacterCreator`), `src/player.ts`
(`applyCreationStats`, `addExperience`), `src/char.ts` (`SkillSet.get`, `StatSet`),
`src/skills.ts` (`skillDependencies`, `statDependencies`), `src/object.ts` (`StatSet`),
`src/scripting.ts` (`statMap`, `get_critter_stat`)  
**See also:** `wiki/skill_checks.md` (skill formulas derived from SPECIAL),
`wiki/perks_traits.md` (traits and perks detail), `wiki/critter_stats.md` (NPC/critter stat model)

Skill formulas that derive from SPECIAL (e.g. Small Guns = 5 + 4×AGI) are documented in
`wiki/skill_checks.md` and are not repeated here.

---

## 1. SPECIAL Stats

CE `stat_defs.h` — primary stat indices 0–6. DH2 stores each as a named key in
`StatSet.baseStats`.

| # | CE Constant | DH2 Name | Abbrev | Default | Range | DH2 storage |
|---|-------------|----------|--------|---------|-------|-------------|
| 0 | `STAT_STRENGTH` | `'STR'` | ST | 5 | 1–10 | `StatSet.baseStats['STR']` |
| 1 | `STAT_PERCEPTION` | `'PER'` | PE | 5 | 1–10 | `StatSet.baseStats['PER']` |
| 2 | `STAT_ENDURANCE` | `'END'` | EN | 5 | 1–10 | `StatSet.baseStats['END']` |
| 3 | `STAT_CHARISMA` | `'CHA'` | CH | 5 | 1–10 | `StatSet.baseStats['CHA']` |
| 4 | `STAT_INTELLIGENCE` | `'INT'` | IN | 5 | 1–10 | `StatSet.baseStats['INT']` |
| 5 | `STAT_AGILITY` | `'AGI'` | AG | 5 | 1–10 | `StatSet.baseStats['AGI']` |
| 6 | `STAT_LUCK` | `'LUK'` | LK | 5 | 1–10 | `StatSet.baseStats['LUK']` |

`PRIMARY_STAT_MIN = 1`, `PRIMARY_STAT_MAX = 10` (`stat_defs.h`).  
`PRIMARY_STAT_COUNT = 7`.

### 1.1 `StatSet.get()` and `StatSet.getBase()`

**CE** (`stat.cc:182` `critterGetStat`): value chain is `critterGetBaseStat` +
`traitGetStatModifier` (if player) + `critterGetBonusStat` + perk bonuses + context modifiers
(blindness, overweight, HTH Evade AC) + clamp.

**DH2** (`object.ts:277` `StatSet.get()`): reads `baseStats[stat]` (falls back to
`statDep.defaultValue`), sums derived dependencies, clamps to `[statDep.min, statDep.max]`. No
live trait or perk modifier chain — those are applied once at creation or explicitly added to
base.

---

## 2. Derived Stats Formulas

### 2.1 CE formulas (`stat.cc:554` `critterUpdateDerivedStats`)

Called whenever a primary SPECIAL changes (via `critterSetBaseStat` or `critterSetBonusStat`).
Writes directly to `proto->critter.data.baseStats[]`. Note: `baseSTR`/`baseEND` in the HP
formula are from `critterGetBaseStatWithTraitModifier`, not `critterGetStat`.

```c
// stat.cc:567–577
baseStats[STAT_MAXIMUM_HIT_POINTS] = baseSTR + 2*baseEND + 15
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

`STAT_UNARMED_DAMAGE` (index 10) is NOT computed here; it is proto-sourced (default 0).  
DT/DR stats (`STAT_DAMAGE_THRESHOLD_*` and `STAT_DAMAGE_RESISTANCE_*`) are NOT computed here;
they come from equipped armor only.

### 2.2 Full derived stats table

| CE Constant | CE index | DH2 Name | Formula (CE) | DH2 Formula (`skills.ts`) | CE min–max | DH2 min–max | Status |
|-------------|----------|----------|--------------|--------------------------|------------|-------------|--------|
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

**HP note:** CE uses `critterGetHitPoints()` (from the critter struct's `hp` field, separate
from the stat array). DH2 stores HP in `StatSet.baseStats['HP']`.

DH2 also has additional pseudo-stats not in CE:
- `'Skill Points'` (skill point pool, range 0–999999)
- `'Level'` (1–99), `'Experience'` (0–99999999)
- `'Reputation'` (−20–20), `'Karma'` (unbounded)

### 2.3 HP per level

CE (`stat.cc:771`): on each level-up, adds `floor(EN/2) + 2` to Max HP bonus stat. Lifegiver
perk: +4 per rank.

DH2 (`player.ts:116–120`): `hpGain = floor(getStat('END') / 2) + 2`; Lifegiver +4; modifies
both `'Max HP'` and `'HP'` base stats.

---

## 3. Character Creation Flow

### 3.1 Entry Point

CE entry: `characterEditorShow(isCreationMode=true)` in `character_editor.cc:793`.  
Called from `character_selector.cc:192` after `_ResetPlayer()` resets all PC stats to defaults
and clears traits, skills, and bonus stats.

DH2 entry: `showCharacterCreator(onDone, onCancel)` in `ui_character.ts:1002`.  
Called from the new-game main-menu path; operates on `globalState.player`.

### 3.2 SPECIAL Point Buy

**CE Behaviour**

- **Pool size:** `gCharacterEditorRemainingCharacterPoints = 5` (set in `characterEditorInit` /
  `characterEditorReset`, `character_editor.cc:1907, 5674`).
- **Defaults:** all 7 SPECIAL stats start at 5 (`gStatDescriptions[stat].defaultValue = 5`,
  `stat.cc:43–49`).
- **Floor:** 1 (`PRIMARY_STAT_MIN`, `stat_defs.h:7`). `critterSetBaseStat` returns −2 if
  value < min.
- **Ceiling:** enforced two ways:
  - During input: `characterEditorAdjustPrimaryStat` blocks increment if
    `critterGetBaseStatWithTraitModifier + critterGetBonusStat >= 10`
    (`character_editor.cc:3758`).
  - At Done: `_is_supper_bonus()` scans all 7 SPECIAL; returns 1 (blocks Done) if any stat's
    `base + bonus > 10` (`character_editor.cc:6741–6752`). This catches trait modifiers: e.g.
    selecting Gifted (+1 all) with a base-10 stat gives visible 11, which is caught here.
- Spending a point calls `critterIncBaseStat` → decrements pool; removing calls
  `critterDecBaseStat` → refunds pool.
- Traits with SPECIAL modifiers (Gifted, Bruiser, Small Frame) are applied **live** via
  `traitGetStatModifier` in `trait.cc:180`, so the creation UI always shows the trait-adjusted
  value.

**DH2 Behaviour (`ui_character.ts:1234–1255`)**

- Pool of 5, all SPECIAL default to 5.
- Up button: blocks if `newStatSet.getBase(stat) >= 10`; down button: blocks if
  `getBase(stat) <= 1`.
- DH2 checks raw base only — trait modifiers are **not** applied to the live display. With
  Gifted selected and base=9, DH2 shows 9; CE shows 10. After `applyCreationStats` the +1 is
  baked in permanently (see §5).
- Done validation: `pool > 0` → shows info card message and aborts (`ui_character.ts:1819`).

**Point-buy summary:**

| | CE | DH2 |
|---|---|---|
| Starting value per stat | 5 | 5 |
| Bonus points to distribute | 5 | 5 |
| Min per stat at creation | 1 | 1 |
| Max per stat at creation | 10 | 10 |

The bonus pool is spent/refunded by incrementing/decrementing stats in the character editor. A
stat can only be decreased below 5 if points were previously spent raising it (the pool does not
go negative in CE; DH2 enforces the same by preventing decrement when a stat is already at its
base default).

### 3.3 Tag Skills

**CE Behaviour**

- 3 tag skills required; stored in `gTaggedSkills[4]` (4th slot reserved for Tag! perk).
- `characterEditorToggleTaggedSkill` (`character_editor.cc:5291`): toggles membership in the
  3-slot temp array.
- Done validation: `gCharacterEditorTaggedSkillCount > 0` blocks Done
  (`character_editor.cc:861`). `gCharacterEditorTaggedSkillCount` tracks remaining tags to pick
  (i.e. 3 minus selected count, adjusted for creation mode off-by-one).
- No check for the 4th slot during creation — it is reserved for the Tag! perk (a
  post-creation perk).

**DH2 Behaviour (`ui_character.ts:1770–1779`)**

- `newSkillSet.tagged: string[]`, capped by `SkillSet.getMaxTaggedSkills()` (3 at creation).
- Done validation: `newSkillSet.tagged.length < 3` → shows "Tag N more skill(s)" info card
  (`ui_character.ts:1823`).

**Tagged Skill Value Formula**

CE (`skill.cc:248–261`):

```c
// For tagged skills (player only):
value = defaultValue + statModifier * statSum + baseValue * baseValueMult;
value += baseValue * baseValueMult;  // doubles the invested-point contribution
if (!isPerkTagSlot) value += 20;     // +20% flat bonus
```

Because `baseValueMult = 1` for all 18 skills, each invested SP is worth 2% in a tagged skill.
At creation, 0 SPs are invested, so a tagged skill gets exactly **+20%** above its formula value.

DH2 (`char.ts:113–123`):
```typescript
if (isPlayer && this.isTagged(skill)) {
    value += invested;           // doubles invested
    if (!isTagPerk4thSlot) value += 20;  // +20 flat
}
```
Formula is correct.

### 3.4 Skill Points

**At Character Creation**

CE gives **0 unspent skill points** at the start of a new game. The character editor in
creation mode returns immediately from `characterEditorHandleAdjustSkillButtonPressed`
(`character_editor.cc:5160–5162`), preventing any SP investment during the creation screen.

Skills displayed during creation are read-only derived values: `skillGetValue` computes them
live from SPECIAL + base formula + trait modifier + tagged bonus, but no SP has been invested.

**Per-Level Allocation**

SPs are granted by `characterEditorUpdateLevel` (`character_editor.cc:5681`) when the
character screen is opened in-game after a level-up:

```c
// character_editor.cc:5686–5701
sp += 5;
sp += critterGetBaseStatWithTraitModifier(gDude, STAT_INTELLIGENCE) * 2;
sp += perkGetRank(gDude, PERK_EDUCATED) * 2;
sp += traitIsSelected(TRAIT_SKILLED) * 5;
if (traitIsSelected(TRAIT_GIFTED)) {
    sp -= 5;
    if (sp < 0) sp = 0;
}
if (sp > 99) sp = 99;
pcSetStat(PC_STAT_UNSPENT_SKILL_POINTS, sp);
```

Formula: **5 + 2×INT + (Educated rank × 2) + (Skilled × 5) − (Gifted × 5)**, capped at 99.

Note: this loop runs for each level gained since the last time the character screen was opened,
so SP accumulates if the player defers opening the editor.

**DH2 Deviation — Creation-Time SP Grant**

DH2 `applyCreationStats` grants level-1 SPs immediately upon creation
(`player.ts:183–186`):

```typescript
let sp = 5 + 2 * int
if (traits.includes('Gifted'))  sp -= 5
if (traits.includes('Skilled')) sp += 5
skills.skillPoints = Math.max(0, sp)
```

**CE grants 0 SPs at creation.** DH2 starts with `5 + 2*INT ± traits` SPs already available.
Consequently, in DH2 a new character at level 1 can immediately spend SPs on skills; in CE
this only becomes possible after reaching level 2.

Level-up SP allocation in DH2 (`player.ts:109–113`) correctly matches the CE formula
(including Educated perk), and runs on each level gained.

### 3.5 Name, Age, and Sex

**CE Behaviour**

| Field | CE storage | CE creation range | Gameplay effect |
|---|---|---|---|
| Name | `critterGetName(gDude)` | up to 11 chars (keyboard input) | display only |
| Age | `STAT_AGE` (base stat) | 16–35 in creation UI (stat_defs min=16 max=101) | affects some dialogue checks |
| Sex | `STAT_GENDER` (0=male, 1=female) | male/female | dialogue choices, Black Widow / Cherchez La Femme perk eligibility, some NPC reactions |

Done validation: if name equals "None" (the default), CE shows a yes/no warning but allows
proceeding. It does NOT block on name "None" (`character_editor.cc:897–914`).

**DH2 Behaviour**

- Name: HTML `<input maxLength=11>`, default "none"; blocks Done if name is empty after trim.
- Age: stepper popup, range 16–35 — matches CE creation range.
- Sex: male/female toggle — stored as `player.gender = sex.toLowerCase()`.
- No "None" name warning. Empty name blocked; but "none" as a literal string is allowed.

### 3.6 CE Done Validation Sequence

Four checks are applied in order when the player presses Done in creation mode
(`character_editor.cc:842–915`):

1. `gCharacterEditorRemainingCharacterPoints != 0` → must spend all bonus points.
2. `gCharacterEditorTaggedSkillCount > 0` → must select all 3 tag skills.
3. `_is_supper_bonus()` → any SPECIAL stat's (base + trait modifier) > 10 is blocked.
4. Name == "None" → warning dialog (can still proceed after confirming).

---

## 4. Trait System

### 4.1 CE Behaviour

- `gCharacterEditorTempTraits[2]` stores selected trait indices (−1 = empty slot).
- `characterEditorToggleOptionalTrait` (`character_editor.cc:5445`): blocks adding a 3rd trait
  if both slots are filled; de-selects on second click.
- **No minimum** enforced — Done button does NOT require any traits; 0 or 1 traits are
  permitted.
- Maximum is 2.

### 4.2 DH2 Behaviour (`ui_character.ts:1624–1640`)

- `selectedTraits: string[]`, capped at length 2.
- Clicking a 3rd trait shows "You may only pick 2 traits." info card — matches CE.
- 0 or 1 traits permitted — matches CE.

### 4.3 Trait SPECIAL Modifiers at Creation

Traits with SPECIAL stat effects (from `trait.cc::traitGetStatModifier`). Trait bonuses are
applied **after** the point pool is spent; they do not consume from the 5-point pool.

| Trait | SPECIAL Effect | Effect on Point Pool |
|---|---|---|
| Gifted | All 7 SPECIAL +1 | None — the +7 is free |
| Bruiser | STR +2 | None |
| Small Frame | AGI +1 | None |

Post-trait SPECIAL values are clamped to [1, 10] (`player.ts:170`).

CE applies all trait modifiers as **live** modifiers via `traitGetStatModifier`. DH2 bakes
SPECIAL-affecting traits into `baseStats` at `applyCreationStats` time (see §5).

### 4.4 All Traits with Stat Effects

Traits that affect derived stats or skills (from `trait.cc::traitGetStatModifier`):

| Trait | SPECIAL / Derived Effect | DH2 status |
|---|---|---|
| Gifted | +1 to all 7 SPECIAL; −5 skill points/level; −10 all skills | SPECIAL +1: IMPLEMENTED (`player.ts:159`); skill penalty: IMPLEMENTED (`skills.ts TRAIT_SKILL_MODIFIERS`) |
| Bruiser | +2 STR; −2 AP | STR +2: IMPLEMENTED (`player.ts:162`); AP penalty: IMPLEMENTED (`traitGetStatModifier`) |
| Small Frame | +1 AGI; carry weight penalty (−10×STR) | AGI +1: IMPLEMENTED (`player.ts:165`); carry penalty: NOT IMPLEMENTED |
| Kamikaze | AC = 0 (armor-only); +5 Sequence | NOT IMPLEMENTED |
| Fast Metabolism | +2 Healing Rate; Radiation Resistance = 0; Poison Resistance = 0 | NOT IMPLEMENTED |
| Heavy Handed | +4 Melee Damage; −30 Better Criticals | NOT IMPLEMENTED |
| Finesse | +10 Critical Chance | NOT IMPLEMENTED |

DH2 `skills.ts TRAIT_SKILL_MODIFIERS` handles Gifted (−10 all skills) and Good Natured skill
effects at the skill-formula level; trait SPECIAL modifiers beyond Gifted/Bruiser/Small Frame
are not applied.

---

## 5. DH2 Implementation

### 5.1 `StatSet` Model

DH2 uses a **flat base-only** model — no live modifier chain. `StatSet.get(stat)` returns:

```
clamp(min, max, baseStats[stat] + sum(dep.multiplier * get(dep.statType) for dep in dependencies))
```

Bonuses from drugs and chem effects are written directly to `baseStats` via `StatSet.modifyBase()`,
then reversed when the effect expires (see `src/drugs.ts`).

Trait and perk SPECIAL modifiers are applied **once** at character creation in
`Player.applyCreationStats()` (`player.ts:142`), not recalculated live.

### 5.2 CE Modifier Chain vs DH2

CE reads stats through a layered chain (`stat.cc:182` `critterGetStat`):

1. `critterGetBaseStat(critter, stat)` — raw value from `proto->critter.data.baseStats[]`
2. `traitGetStatModifier(stat)` — player-only, live trait modifier (e.g. Gifted +1 all SPECIAL)
3. `critterGetBonusStat(critter, stat)` — bonus layer (drugs, chem effects written here)
4. Perk bonuses — `perkGetRank()` checks for Gain Strength/Perception/etc., Alcohol HP, etc.
5. Context modifiers — blindness (−5 PER), overweight (−AP), unused AP → AC bonus in combat
6. Final clamp to `[gStatDescriptions[stat].min, gStatDescriptions[stat].max]`

DH2 omits steps 2, 4, and 5 from the live chain. Instead, trait SPECIAL bonuses are baked in
at creation and drug effects are written/reversed to `baseStats` directly.

### 5.3 `applyCreationStats` Flow

Called by the Done handler after DH2's own validation
(`ui_character.ts:1833`; implemented in `player.ts:142–202`):

```typescript
// 1. Set raw SPECIAL bases from creation screen
for (const s of SPECIALS) this.stats.setBase(s, stats.getBase(s))

// 2. Bake trait SPECIAL modifiers permanently into baseStats
this.traits = traits
if (traits.includes('Gifted'))    for (const s of SPECIALS) this.stats.modifyBase(s, 1)
if (traits.includes('Bruiser'))   this.stats.modifyBase('STR', 2)
if (traits.includes('Small Frame')) this.stats.modifyBase('AGI', 1)

// 3. Clamp all SPECIAL to [1, 10]
for (const s of SPECIALS) this.stats.setBase(s, clamp(1, 10, this.stats.getBase(s)))

// 4. Derive Max HP: 15 + 2×END + STR
const maxHp = 15 + 2 * end + str
this.stats.setBase('Max HP', maxHp)
this.stats.setBase('HP', maxHp)

// 5. Grant level-1 skill points (DH2-only — CE gives 0 at creation)
let sp = 5 + 2 * int
if (traits.includes('Gifted'))  sp -= 5
if (traits.includes('Skilled')) sp += 5
skills.skillPoints = Math.max(0, sp)
```

**Max HP formula**: `15 + 2×END + STR` — correct per CE (`stat.cc:567`).

### 5.4 CE Perk SPECIAL Modifiers (not implemented in DH2)

CE handles these live in `critterGetStat` (`stat.cc:249–366`). DH2 does not implement
SPECIAL-modifying perks in the stat chain.

| CE Perk | Effect | DH2 status |
|---------|--------|------------|
| Gain Strength/Perception/Endurance/Charisma/Intelligence/Agility/Luck | +1 to that SPECIAL | NOT IMPLEMENTED |
| Adrenaline Rush | +1 STR when HP < 50% | NOT IMPLEMENTED |
| Alcohol Raised HP / Lowered HP (I/II) | ±2/±4 Max HP | NOT IMPLEMENTED |
| Autodoc Raised HP / Lowered HP (I/II) | ±2/±4 Max HP | NOT IMPLEMENTED |
| Lifegiver | +4 Max HP per rank (per level-up) | IMPLEMENTED (`player.ts:118`) |
| Dermal Impact Armor/Enhancement | +5/+10 DR Normal + DR Explosive | NOT IMPLEMENTED |
| Phoenix Armor/Enhancement | +5/+10 DR Laser/Fire/Plasma | NOT IMPLEMENTED |
| Vault City Inoculations | +10 Radiation Resistance + Poison Resistance | NOT IMPLEMENTED |

### 5.5 Scripting Opcodes

**`get_critter_stat` (opcode `0x80CA`)**

CE ref: `interpreter_extra.cc:4915`.  
Args: `obj, stat` → returns stat value.  
DH2 wired: YES (`vm_bridge.ts:70`).

DH2 `statMap` (`scripting.ts:90–100`) — indices handled:

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

Known gap: CE `critterGetStat` routes through the full modifier chain (bonus stats, perks,
context). DH2 calls `obj.getStat(namedStat)` which calls `StatSet.get()` — the dependency
chain for derived stats, but no live perk modifiers.

CE stats not handled in DH2 statMap:
- 8: `STAT_MAXIMUM_ACTION_POINTS` — missing (not in statMap; scripts wanting player AP would
  call via `statMap` but 8 is undefined → stub → 5)
- 9: `STAT_ARMOR_CLASS` — missing
- 11: `STAT_MELEE_DAMAGE` — missing (DH2 name is `'Melee'`, not in statMap)
- 12: `STAT_CARRY_WEIGHT` — missing
- 13–16: Sequence, Healing Rate, Critical Chance, Better Criticals — missing
- 31–32: Radiation/Poison Resistance — missing
- 33: Age — missing
- 36–37: Poison/Radiation Level — missing

**`set_critter_stat` (opcode `0x80CB`)**

CE ref: `interpreter_extra.cc:4916`.  
CE behavior: calls `critterSetBonusStat(critter, stat, value)` — writes to the bonus layer.  
DH2 status: NOT IMPLEMENTED. No method on `Script` class, not wired in `vm_bridge.ts`.

**`get_pc_stat` / `set_pc_stat` / `mod_pc_stat`**

| Method | CE opcode | DH2 wired | Notes |
|--------|-----------|-----------|-------|
| `get_pc_stat(pcstat)` | `0x80A6` | NOT WIRED | Method exists in `scripting.ts:891` |
| `set_pc_stat(pcstat, value)` | unknown | NOT WIRED | Method exists in `scripting.ts:910` |
| `mod_pc_stat(pcstat, delta)` | unknown | NOT WIRED | Method exists in `scripting.ts:926` |

CE `PcStat` enum (`stat_defs.h`):

| Index | CE Constant | DH2 impl |
|-------|-------------|----------|
| 0 | `PC_STAT_UNSPENT_SKILL_POINTS` | `player.skills.skillPoints` |
| 1 | `PC_STAT_LEVEL` | `player.getStat('Level')` |
| 2 | `PC_STAT_EXPERIENCE` | `player.getStat('Experience')` |
| 3 | `PC_STAT_REPUTATION` | `player.stats.getBase('Reputation')` |
| 4 | `PC_STAT_KARMA` | `player.stats.getBase('Karma')` |

The methods exist and are correct, but because they are not wired in `vm_bridge.ts`, FO2
scripts calling `get_pc_stat()` or `set_pc_stat()` will crash with an unknown opcode error.

---

## 6. Known Gaps

Unified table from both source documents.

| Feature | CE source | DH2 status |
|---------|-----------|------------|
| 5-point SPECIAL pool | `character_editor.cc:1907` | IMPLEMENTED (`ui_character.ts:1012`) |
| SPECIAL default 5, range 1–10 | `stat.cc:43` | IMPLEMENTED |
| Done: pool must reach 0 | `character_editor.cc:843` | IMPLEMENTED |
| Done: must tag 3 skills | `character_editor.cc:861` | IMPLEMENTED |
| Done: `_is_supper_bonus` check | `character_editor.cc:879` | PARTIAL — up-button blocks base ≥ 10; Gifted display discrepancy (Gap A) |
| Tag skill bonus (+20 + double invest) | `skill.cc:251–255` | IMPLEMENTED (`char.ts:113–123`) |
| 0–2 traits at creation | `character_editor.cc:5467` | IMPLEMENTED |
| Age 16–35 in UI | `character_editor.cc:3442,3447` | IMPLEMENTED |
| Sex selection | `stat.cc` | IMPLEMENTED |
| Level-up SP formula | `character_editor.cc:5686–5701` | IMPLEMENTED (`player.ts:109–113`) |
| Skill point cost tiers | `skill.cc:skillsGetCost` | IMPLEMENTED (`skills.ts:167–175`) |
| 0 SPs at creation | `character_editor.cc:5160` | GAP A — DH2 grants level-1 SPs immediately |
| Trait SPECIAL as live modifier | `trait.cc:traitGetStatModifier` | GAP B — DH2 bakes into baseStats |
| Gifted: correct SPECIAL display during creation | `trait.cc` | GAP B — DH2 shows raw base without +1 |
| Live trait modifier chain | `stat.cc:182` | GAP B — no live recalculation after creation |
| Gain SPECIAL perks | `stat.cc:249–366` | GAP C — perks collected but stat chain ignores them |
| `set_critter_stat` (`0x80CB`) | `interpreter_extra.cc:4916` | GAP D — method and opcode wiring both absent |
| `get_pc_stat` (`0x80A6`) | `interpreter_extra.cc` | GAP D — method exists but NOT wired in `vm_bridge.ts` |
| `set_pc_stat`, `mod_pc_stat` | `interpreter_extra.cc` | GAP D — methods exist but NOT wired; unknown opcode values |
| `get_critter_stat` indices 8–16, 31–33, 36–37 | `stat.cc` | GAP D — falls through to `stub()`, returns hardcoded 5 |
| `STAT_UNARMED_DAMAGE` (index 10) | proto default 0 | GAP E — no entry in `statDependencies` or `statMap` |
| Small Frame carry weight penalty | `trait.cc:traitGetStatModifier` | GAP E — +1 AGI applied; −10×STR carry penalty ignored |
| Trait derived stat modifiers (Kamikaze, Fast Metabolism, Heavy Handed, Finesse) | `trait.cc:traitGetStatModifier` | GAP E — not implemented |
| Overweight AP penalty | `stat.cc:critterGetStat` | GAP E — not implemented |
| Blind −5 PER | `stat.cc:critterGetStat` | GAP E — not implemented |
| Alcohol/Autodoc HP perks | `stat.cc:249–366` | GAP E — not implemented |
| Premade characters | `character_selector.cc` | NOT IMPLEMENTED |
| "None" name warning | `character_editor.cc:897` | NOT IMPLEMENTED — blocks empty name instead |
| Unused AP → AC bonus | `stat.cc` (combat context modifier) | Partially implemented — see `wiki/combat.md` |

### Gap A — Creation-time SP grant
DH2 `applyCreationStats` (`player.ts:183–186`) grants `5 + 2*INT ± traits` SPs immediately
when a new character is finalised. CE gives 0 SPs at creation; the first batch is allocated only
when the character screen opens after reaching level 2 (`characterEditorUpdateLevel`).

Result: DH2 players can spend SPs at level 1; CE players cannot until level 2.
The level-up formula itself is correct in both.

### Gap B — Trait SPECIAL modifiers baked vs live
DH2 permanently modifies `baseStats` for Gifted (+1 all), Bruiser (+2 STR), and Small Frame
(+1 AGI) in `applyCreationStats`. CE applies these via `traitGetStatModifier` at query time,
so they are automatically reversed if a trait is removed (e.g. via the Mutate! perk,
`perk_defs.h`).

Consequences:
1. If DH2 ever implements Mutate!, the trait-SPECIAL link is broken — baked bonuses won't be
   undone.
2. During `showCharacterCreator`, `redrawStatsSkills` renders `newStatSet.getBase(stat)` — the
   raw value before Gifted's +1 is applied (`ui_character.ts:1806`). CE shows the trait-modified
   value. So a player with INT=5 and Gifted sees 5 in DH2 and 6 in CE during the creation
   screen. Skill values shown in the creation screen also use the pre-Gifted SPECIAL (the −10
   flat penalty from Gifted IS applied to skills via `traitGetSkillModifier`, but the
   SPECIAL-based contribution does not include the +1 until after `applyCreationStats`).
   After `applyCreationStats` the player correctly has INT=6, so in-game skill calculations
   are unaffected. This is a creation-screen display issue only.

### Gap C — Gain SPECIAL perks
CE handles Gain Strength/Perception/etc. perks live in `critterGetStat` (`stat.cc:249–366`).
DH2 collects perk selections but the `StatSet.get()` chain does not consult them.

### Gap D — Scripting stat opcodes
`set_critter_stat` is completely absent. `get_pc_stat`, `set_pc_stat`, and `mod_pc_stat`
methods exist on the `Script` class but are not wired in `vm_bridge.ts`, causing unknown opcode
crashes. `get_critter_stat` only maps indices 0–7, 34–35; all others fall through to
`stub()` returning 5.

### Gap E — Trait derived stat modifiers (non-SPECIAL)
Kamikaze (AC = 0, +5 Sequence), Fast Metabolism (+2 Healing Rate, Rad/Poison Resist = 0),
Heavy Handed (+4 Melee Damage, −30 Better Criticals), Finesse (+10 Critical Chance), and
Small Frame's carry weight penalty (−10×STR) are not implemented in DH2.

<!-- audited: 2026-06-02 -->
