# DarkHarold2 — Character Creation Reference

**Audited:** 2026-06-01  
**CE ref:** `raw/fallout2-ce/src/character_editor.cc` (`characterEditorShow`, `characterEditorInit`,
`characterEditorReset`, `characterEditorAdjustPrimaryStat`, `characterEditorToggleTaggedSkill`,
`characterEditorToggleOptionalTrait`, `characterEditorUpdateLevel`, `_is_supper_bonus`),
`stat.cc` (`critterUpdateDerivedStats`, `critterSetBaseStat`), `skill.cc` (`skillGetValue`),
`trait.cc` (`traitGetStatModifier`), `proto.cc` (`_ResetPlayer`)  
**DH2 ref:** `src/ui_character.ts` (`showCharacterCreator`), `src/player.ts` (`applyCreationStats`, `addExperience`),
`src/char.ts` (`SkillSet.get`, `StatSet`), `src/skills.ts` (`skillDependencies`, `statDependencies`)  
**See also:** `wiki/special_derived.md` (derived stat formulas), `wiki/perks_traits.md` (traits and perks)

---

## 1. Entry Point

CE entry: `characterEditorShow(isCreationMode=true)` in `character_editor.cc:793`.  
Called from `character_selector.cc:192` after `_ResetPlayer()` resets all PC stats to
defaults and clears traits, skills, and bonus stats.

DH2 entry: `showCharacterCreator(onDone, onCancel)` in `ui_character.ts:1002`.  
Called from the new-game main-menu path; operates on `globalState.player`.

---

## 2. SPECIAL Point Buy

### 2.1 CE Behaviour

- **Pool size:** `gCharacterEditorRemainingCharacterPoints = 5` (set in `characterEditorInit` / `characterEditorReset`, `character_editor.cc:1907, 5674`).
- **Defaults:** all 7 SPECIAL stats start at 5 (from `gStatDescriptions[stat].defaultValue = 5`, `stat.cc:43–49`).
- **Floor:** 1 (`PRIMARY_STAT_MIN`, `stat_defs.h:7`). `critterSetBaseStat` returns −2 if value < min.
- **Ceiling:** enforced two ways:
  - During input: `characterEditorAdjustPrimaryStat` blocks increment if `critterGetBaseStatWithTraitModifier + critterGetBonusStat >= 10` (`character_editor.cc:3758`).
  - At Done: `_is_supper_bonus()` scans all 7 SPECIAL; returns 1 (blocks Done) if any stat's `base + bonus > 10` (`character_editor.cc:6741–6752`). This catches trait modifiers: e.g. selecting Gifted (+1 all) with a base-10 stat gives visible 11, which is caught here.
- Spending a point calls `critterIncBaseStat` → decrements pool; removing calls `critterDecBaseStat` → refunds pool.
- Traits with SPECIAL modifiers (Gifted, Bruiser, Small Frame) are applied **live** via `traitGetStatModifier` in `trait.cc:180`, so the creation UI always shows the trait-adjusted value.

### 2.2 DH2 Behaviour (`ui_character.ts:1234–1255`)

- Pool of 5, all SPECIAL default to 5.
- Up button: blocks if `newStatSet.getBase(stat) >= 10`; down button: blocks if `getBase(stat) <= 1`.
- DH2 checks raw base only — trait modifiers are **not** applied to the live display. With Gifted selected and base=9, DH2 shows 9; CE shows 10. After `applyCreationStats` the +1 is baked in permanently (see §7.3).
- Done validation: `pool > 0` → shows info card message and aborts (`ui_character.ts:1819`).

---

## 3. Traits

### 3.1 CE Behaviour

- `gCharacterEditorTempTraits[2]` stores selected trait indices (−1 = empty slot).
- `characterEditorToggleOptionalTrait` (`character_editor.cc:5445`): blocks adding a 3rd trait if both slots are filled; de-selects on second click.
- **No minimum** enforced — Done button does NOT require any traits; 0 or 1 traits are permitted.
- Maximum is 2.

### 3.2 DH2 Behaviour (`ui_character.ts:1624–1640`)

- `selectedTraits: string[]`, capped at length 2.
- Clicking a 3rd trait shows "You may only pick 2 traits." info card — matches CE.
- 0 or 1 traits permitted — matches CE.

### 3.3 Which Traits Modify Creation-Time Stats

Traits with SPECIAL stat effects (from `trait.cc::traitGetStatModifier`):

| Trait | SPECIAL Effect |
|---|---|
| Gifted | All 7 SPECIAL +1 |
| Bruiser | STR +2; AP −2 |
| Small Frame | AGI +1; Carry Weight −10×STR |
| Kamikaze | Sequence +5; AC zeroed to armor-only |
| Heavy Handed | Melee Damage +4; Better Criticals −30 |
| Fast Metabolism | Healing Rate +2; Rad Resist = 0; Poison Resist = 0 |
| Finesse | Critical Chance +10 |

CE applies these as live modifiers. DH2 bakes SPECIAL-affecting traits into `baseStats` at
`applyCreationStats` time (see §7.3).

---

## 4. Tag Skills

### 4.1 CE Behaviour

- 3 tag skills required; stored in `gTaggedSkills[4]` (4th slot reserved for Tag! perk).
- `characterEditorToggleTaggedSkill` (`character_editor.cc:5291`): toggles membership in the 3-slot temp array.
- Done validation: `gCharacterEditorTaggedSkillCount > 0` blocks Done (`character_editor.cc:861`). `gCharacterEditorTaggedSkillCount` tracks remaining tags to pick (i.e. 3 minus selected count, adjusted for creation mode off-by-one).
- No check for the 4th slot during creation — it is reserved for the Tag! perk (a post-creation perk).

### 4.2 DH2 Behaviour (`ui_character.ts:1770–1779`)

- `newSkillSet.tagged: string[]`, capped by `SkillSet.getMaxTaggedSkills()` (3 at creation).
- Done validation: `newSkillSet.tagged.length < 3` → shows "Tag N more skill(s)" info card (`ui_character.ts:1823`).

### 4.3 Tagged Skill Value Formula

**CE (`skill.cc:248–261`):**

```c
// For tagged skills (player only):
value = defaultValue + statModifier * statSum + baseValue * baseValueMult;
value += baseValue * baseValueMult;  // doubles the invested-point contribution
if (!isPerkTagSlot) value += 20;     // +20% flat bonus
```

Because `baseValueMult = 1` for all 18 skills, each invested SP is worth 2% in a tagged skill.
At creation, 0 SPs are invested, so a tagged skill gets exactly **+20%** above its formula value.

**DH2 (`char.ts:113–123`):**
```typescript
if (isPlayer && this.isTagged(skill)) {
    value += invested;           // doubles invested
    if (!isTagPerk4thSlot) value += 20;  // +20 flat
}
```
Formula is correct.

---

## 5. Skill Points

### 5.1 At Character Creation

CE gives **0 unspent skill points** at the start of a new game. The character editor in
creation mode returns immediately from `characterEditorHandleAdjustSkillButtonPressed`
(`character_editor.cc:5160–5162`), preventing any SP investment during the creation screen.

Skills displayed during creation are read-only derived values: `skillGetValue` computes them
live from SPECIAL + base formula + trait modifier + tagged bonus, but no SP has been invested.

### 5.2 Per-Level Allocation

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

### 5.3 DH2 Deviation — Creation-Time SP Grant

DH2 `applyCreationStats` grants level-1 SPs immediately upon creation
(`player.ts:183–186`):

```typescript
let sp = 5 + 2 * int
if (traits.includes('Gifted'))  sp -= 5
if (traits.includes('Skilled')) sp += 5
skills.skillPoints = Math.max(0, sp)
```

**CE grants 0 SPs at creation.** DH2 starts with `5 + 2*INT ± traits` SPs already available.
Consequentially, in DH2 a new character at level 1 can immediately spend SPs on skills;
in CE this only becomes possible after reaching level 2.

Level-up SP allocation in DH2 (`player.ts:109–113`) correctly matches the CE formula
(including Educated perk), and runs on each level gained.

---

## 6. Name, Age, and Sex

### 6.1 CE Behaviour

| Field | CE storage | CE creation range | Gameplay effect |
|---|---|---|---|
| Name | `critterGetName(gDude)` | up to 11 chars (keyboard input) | display only |
| Age | `STAT_AGE` (base stat) | 16–35 in creation UI (stat_defs min=16 max=101) | affects some dialogue checks |
| Sex | `STAT_GENDER` (0=male, 1=female) | male/female | dialogue choices, Black Widow / Cherchez La Femme perk eligibility, some NPC reactions |

Done validation: if name equals "None" (the default), CE shows a yes/no warning but allows
proceeding. It does NOT block on name "None" (`character_editor.cc:897–914`).

### 6.2 DH2 Behaviour

- Name: HTML `<input maxLength=11>`, default "none"; blocks Done if name is empty after trim.
- Age: stepper popup, range 16–35 — matches CE creation range.
- Sex: male/female toggle — stored as `player.gender = sex.toLowerCase()`.
- No "None" name warning. Empty name blocked; but "none" as a literal string is allowed.

---

## 7. Derived Stats and Validation

### 7.1 CE: Derived Stats During Creation

`critterUpdateDerivedStats(gDude)` is called each time a SPECIAL stat changes
(`characterEditorAdjustPrimaryStat:3751`) and after each trait toggle. All derived stats
(HP, AP, AC, Melee Damage, etc.) update immediately. Formulas: see `wiki/special_derived.md`.

### 7.2 CE: Done Validation Sequence

Four checks are applied in order when the player presses Done in creation mode
(`character_editor.cc:842–915`):

1. `gCharacterEditorRemainingCharacterPoints != 0` → must spend all bonus points.
2. `gCharacterEditorTaggedSkillCount > 0` → must select all 3 tag skills.
3. `_is_supper_bonus()` → any SPECIAL stat's (base + trait modifier) > 10 is blocked.
4. Name == "None" → warning dialog (can still proceed after confirming).

### 7.3 DH2: `applyCreationStats` Flow

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

**Max HP formula**: `15 + 2×END + STR` — correct per CE (`stat.cc:567`; `wiki/special_derived.md`).

---

## 8. DH2 Status and Known Gaps

| Feature | CE source | DH2 status |
|---|---|---|
| 5-point SPECIAL pool | `character_editor.cc:1907` | ✅ correct (`ui_character.ts:1012`) |
| SPECIAL default 5, range 1–10 | `stat.cc:43` | ✅ correct |
| Done: pool must reach 0 | `character_editor.cc:843` | ✅ correct |
| Done: must tag 3 skills | `character_editor.cc:861` | ✅ correct |
| Done: _is_supper_bonus check | `character_editor.cc:879` | ✅ effective: up-button blocks base ≥ 10; Gifted display discrepancy (see #1 below) |
| Tag skill bonus (+20 + double invest) | `skill.cc:251–255` | ✅ correct (`char.ts:113–123`) |
| 0–2 traits at creation | `character_editor.cc:5467` | ✅ correct |
| Age 16–35 in UI | `character_editor.cc:3442,3447` | ✅ correct |
| Sex selection | `stat.cc` | ✅ correct |
| Level-up SP formula | `character_editor.cc:5686–5701` | ✅ correct (`player.ts:109–113`) |
| Skill point cost tiers | `skill.cc:skillsGetCost` | ✅ correct (`skills.ts:167–175`) |
| 0 SPs at creation | `character_editor.cc:5160` | ❌ DH2 grants level-1 SPs immediately (gap #1) |
| Trait SPECIAL as live modifier | `trait.cc:traitGetStatModifier` | ❌ DH2 bakes into baseStats (gap #2) |
| Gifted: correct SPECIAL display during creation | `trait.cc` | ❌ DH2 shows raw base without +1 (gap #3) |
| Premade characters | `character_selector.cc` | ❌ not implemented |
| "None" name warning | `character_editor.cc:897` | ❌ not implemented (blocks empty name instead) |

### Gap #1 — Creation-time SP grant
DH2 `applyCreationStats` (`player.ts:183–186`) grants `5 + 2*INT ± traits` SPs immediately
when a new character is finalised. CE gives 0 SPs at creation; the first batch is allocated only
when the character screen opens after reaching level 2 (`characterEditorUpdateLevel`).

The in-game result: DH2 players can spend SPs at level 1; CE players cannot until level 2.
The level-up formula itself is correct in both.

### Gap #2 — Trait SPECIAL modifiers baked vs live
DH2 permanently modifies `baseStats` for Gifted (+1 all), Bruiser (+2 STR), and Small Frame
(+1 AGI) in `applyCreationStats`. CE applies these via `traitGetStatModifier` at query time,
so they are automatically reversed if a trait is removed (e.g. via the Mutate! perk,
`perk_defs.h`).

Consequence: if DH2 ever implements Mutate!, the trait-SPECIAL link is broken — baked bonuses
won't be undone.

### Gap #3 — Gifted SPECIAL display during creation
During `showCharacterCreator`, `redrawStatsSkills` renders `newStatSet.getBase(stat)` — the
raw value before Gifted's +1 is applied (`ui_character.ts:1806`). CE shows the trait-modified
value. So a player with INT=5 and Gifted sees 5 in DH2 and 6 in CE during the creation screen.
Skill values shown in the creation screen also use the pre-Gifted SPECIAL (the -10 flat penalty
from Gifted IS applied to skills via `traitGetSkillModifier`, but the SPECIAL-based contribution
does not include the +1 until after `applyCreationStats`).

After `applyCreationStats` the player correctly has INT=6, so in-game skill calculations
are unaffected. This is a creation-screen display issue only.
<!-- audited: 2026-06-01 -->
