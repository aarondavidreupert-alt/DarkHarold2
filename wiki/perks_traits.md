# Perks & Traits — DarkHarold2 Reference

> Ground-truth: `raw/fallout2-ce/src/perk.cc`, `perk_defs.h`, `trait.cc`, `trait_defs.h`  
> DH2 impl: `src/perks.ts`, `src/ui_character.ts`, `src/combat.ts`, `src/player.ts`, `src/object.ts`, `src/scripting.ts`, `src/vm_bridge.ts`

---

## 1. Traits

Traits are selected during **character creation** only (max 2). They provide trade-off bonuses/penalties and are never gained during play via normal gameplay. Selecting a trait immediately modifies stats and skills for the lifetime of the character.

### 1.1 CE Implementation

**Storage:** `gSelectedTraits[TRAITS_MAX_SELECTED_COUNT]` (size=2). Each element is a `Trait` enum value (0–15) or `-1` for empty.

**Live modifier queries:**
- `traitGetStatModifier(trait)` in `trait.cc` — returns stat delta for each selected trait; called inside `critterGetStat` chain
- `traitGetSkillModifier(traits[], skill)` in `trait.cc:284` — returns skill delta; called inside `skillGetValue`

**DH2 Storage:** `Player.traits: string[]` — applied once at character creation via `ui_character.ts`; trait names match `TRAIT_DESCRIPTIONS` keys in `src/ui_character.ts:90`.

**DH2 Live vs Applied:** DH2 reads `player.traits` at skill calculation time via `traitGetSkillModifier()` in `src/skills.ts` (called from `SkillSet.get()`), but stat modifiers from traits are **not** applied to the StatSet live — they are baked into `baseStats` during character creation.

### 1.2 Traits Table

| # | CE Constant | Name | Stat/Skill Effect (CE) | DH2 Status |
|---|---|---|---|---|
| 0 | `TRAIT_FAST_METABOLISM` | Fast Metabolism | Healing Rate +2; Radiation Resist = 0; Poison Resist = 0 | PARTIAL — Healing Rate applied; rad/poison resist not enforced (no decay loop) |
| 1 | `TRAIT_BRUISER` | Bruiser | ST +2; AP −2 | PARTIAL — ST applied at creation; AP delta applied via statDep |
| 2 | `TRAIT_SMALL_FRAME` | Small Frame | AG +1; Carry Weight −10×STR | PARTIAL — AG applied; Carry Weight formula not separately adjusted |
| 3 | `TRAIT_ONE_HANDER` | One Hander | +20% one-handed weapons; −40% two-handed weapons | STUB — no weapon-type skill modifier in DH2 |
| 4 | `TRAIT_FINESSE` | Finesse | Critical Chance +10; all damage −30% from crits (Better Criticals) | WIRED — `critChance += 10` at creation; `Finesse` checked in `combat.ts:614,691` for −30 crit effect roll |
| 5 | `TRAIT_KAMIKAZE` | Kamikaze | Sequence +5; AC = base AC (armor AC bonus zeroed) | PARTIAL — Sequence +5 applied at creation; AC zeroing is stub |
| 6 | `TRAIT_HEAVY_HANDED` | Heavy Handed | Melee Damage +4; Better Criticals −30 | PARTIAL — Melee Damage +4 applied; Better Criticals penalty is stub |
| 7 | `TRAIT_FAST_SHOT` | Fast Shot | Ranged weapons cost 1 fewer AP; no targeted shots | STUB — no AP cost reduction or targeting restriction |
| 8 | `TRAIT_BLOODY_MESS` | Bloody Mess | Death animations always gory | STUB — no death animation selection in DH2 |
| 9 | `TRAIT_JINXED` | Jinxed | Enemies have 1-in-4 chance of critical failure each turn | PARTIAL — CE: also affects player; `'Jinxed'` perk (not trait) checked in `combat.ts:568` |
| 10 | `TRAIT_GOOD_NATURED` | Good Natured | Combat skills −10; First Aid/Doctor/Speech/Barter +15 | WIRED — `traitGetSkillModifier` in `src/skills.ts` applies these deltas live |
| 11 | `TRAIT_CHEM_RELIANT` | Chem Reliant | Addiction chance ×2 | WIRED — `drugs.ts:98` checks `player.traits` includes `'Chem Reliant'` |
| 12 | `TRAIT_CHEM_RESISTANT` | Chem Resistant | Addiction chance ÷2; drug duration ÷2 | PARTIAL — addiction chance halved (`drugs.ts:97`); duration halving stub |
| 13 | `TRAIT_SEX_APPEAL` | Sex Appeal | +1 CH vs opposite-gender NPCs | STUB — no gender-sensitive CH modifier |
| 14 | `TRAIT_SKILLED` | Skilled | +5 skill points/level; perk every 4 levels (not 3) | WIRED — `player.ts:127` checks `player.traits.includes('Skilled')` for perk rate; skill point bonus stub |
| 15 | `TRAIT_GIFTED` | Gifted | All SPECIAL +1; all skills −10 | PARTIAL — SPECIAL +1 applied at creation; skill −10 via `traitGetSkillModifier` in `src/skills.ts` |

### 1.3 CE Stat Modifier Detail

From `trait.cc::traitGetStatModifier()`:

| Stat | Fast Metabolism | Bruiser | Small Frame | Finesse | Kamikaze | Heavy Handed | Gifted |
|---|---|---|---|---|---|---|---|
| ST | — | +2 | — | — | — | — | +1 |
| PE | — | — | — | — | — | — | +1 |
| EN | — | — | — | — | — | — | +1 |
| CH | — | — | — | — | — | — | +1 |
| IN | — | — | — | — | — | — | +1 |
| AG | — | — | +1 | — | — | — | +1 |
| LK | — | — | — | — | — | — | +1 |
| AP | — | −2 | — | — | — | — | — |
| AC | — | — | — | — | = base AC | — | — |
| Melee Damage | — | — | — | — | — | +4 | — |
| Carry Weight | — | — | −10×ST | — | — | — | — |
| Sequence | — | — | — | — | +5 | — | — |
| Healing Rate | +2 | — | — | — | — | — | — |
| Critical Chance | — | — | — | +10 | — | — | — |
| Better Criticals | — | — | — | — | — | −30 | — |
| Radiation Resist | = 0 | — | — | — | — | — | — |
| Poison Resist | = 0 | — | — | — | — | — | — |

### 1.4 CE Skill Modifier Detail

From `trait.cc::traitGetSkillModifier()`:

| Skill | Gifted | Good Natured |
|---|---|---|
| Small Guns | −10 | −10 |
| Big Guns | −10 | −10 |
| Energy Weapons | −10 | −10 |
| Unarmed | −10 | −10 |
| Melee Weapons | −10 | −10 |
| Throwing | −10 | −10 |
| First Aid | −10 | +15 |
| Doctor | −10 | +15 |
| Sneak | −10 | — |
| Lockpick | −10 | — |
| Steal | −10 | — |
| Traps | −10 | — |
| Science | −10 | — |
| Repair | −10 | — |
| Speech | −10 | +15 |
| Barter | −10 | +15 |
| Gambling | −10 | — |
| Outdoorsman | −10 | — |

---

## 2. Perks

### 2.1 CE Implementation

**Storage:** Each critter has a per-perk rank array indexed by the `Perk` enum (0–119). `perkGetRank(critter, perk)` returns the rank count.

**Live modifier queries:**
- `perkGetSkillModifier(perks[], skill)` in `perk.cc:628` — called from `skillGetValue` for player
- `perkAddEffect(critter, perk)` in `perk.cc:554` — writes to the critter's **bonus stat layer**; called when a perk is gained. If `maxRank == -1` (non-selectable), applies `stats[7]` SPECIAL deltas instead.

**DH2 Storage:** `Critter.perks: string[]` (flat array of name strings, one entry per rank). `hasPerk(name)` = indexOf check. `getPerkRank(player, name)` counts occurrences.

**DH2 Application:** `applyPerk(player, perkName)` in `src/perks.ts` pushes name to `player.perks[]`. Effects are not stored in a stat layer — each system checks `hasPerk` at use time (e.g., `combat.ts`, `player.ts`).

### 2.2 Perk Prerequisites

CE `perkCanAdd()` (`perk.cc:302`) checks:
1. `minLevel` — player level ≥ requirement
2. `stats[0..6]` — minimum SPECIAL (negative value means "must be < 10", used by GAIN_ perks)
3. `param1 / paramMode / param2` — skill or GVAR requirements:
   - `PERK_PARAM_MODE_FIRST_ONLY (0)` — only param1 checked
   - `PERK_PARAM_MODE_OR (1)` — param1 OR param2
   - `PERK_PARAM_MODE_AND (2)` — param1 AND param2

DH2 `getValidPerks(player)` checks `minLevel` and `minStats` (SPECIAL) and `minSkills`. No GVAR-based prerequisites.

### 2.3 Perk Rate

- **Default:** 1 perk every **3 levels** (levels 3, 6, 9, 12, …)
- **Skilled trait:** 1 perk every **4 levels** (levels 4, 8, 12, …)
- **Here and Now (special):** immediately grants one extra level-up's XP
- DH2: `pendingPerkPick` flag set in `player.ts:122–127`

### 2.4 Selectable Perks — Full Table

Non-selectable perks (addiction, armor implants — `maxRank == -1`) are listed separately in §2.5.

| CE Index | CE Constant | Name | Max Ranks | Min Level | SPECIAL Req | Skill Req | Stat Effect | DH2 Status |
|---|---|---|---|---|---|---|---|---|
| 0 | `PERK_AWARENESS` | Awareness | 1 | 3 | ST≥5 | — | — (reveals enemy HP/weapon) | PARTIAL — defined in PERKS; no enemy info display |
| 1 | `PERK_BONUS_HTH_ATTACKS` | Bonus HtH Attacks | 1 | 15 | AG≥6 | — | +1 AP for HtH attacks | WIRED — `hasPerk('Bonus HtH Attacks')` in `combat.ts` |
| 2 | `PERK_BONUS_HTH_DAMAGE` | Bonus HtH Damage | 3 | 3 | ST≥6, AG≥6 | — | Melee Damage +2/rank | WIRED — defined in PERKS; Melee Damage stat applied via `perkAddEffect` analog in stat layer |
| 3 | `PERK_BONUS_MOVE` | Bonus Move | 2 | 6 | AG≥5 | — | +2 free move AP/rank | WIRED — `hasPerk('Bonus Move')` in `combat.ts` |
| 4 | `PERK_BONUS_RANGED_DAMAGE` | Bonus Ranged Damage | 2 | 6 | AG≥6, LK≥6 | — | Ranged damage +2/rank | WIRED — `hasPerk('Bonus Ranged Damage')` filter in `combat.ts:622` |
| 5 | `PERK_BONUS_RATE_OF_FIRE` | Bonus Rate of Fire | 1 | 15 | PE≥6, IN≥6, AG≥7 | — | +1 AP for ranged attacks | WIRED — `hasPerk('Bonus Rate of Fire')` in `combat.ts` |
| 6 | `PERK_EARLIER_SEQUENCE` | Earlier Sequence | 3 | 3 | PE≥6 | — | Sequence +2/rank | PARTIAL — defined; stat written at level-up |
| 7 | `PERK_FASTER_HEALING` | Faster Healing | 3 | 3 | EN≥6 | — | Healing Rate +2/rank | PARTIAL — defined; Healing Rate stub in DH2 |
| 8 | `PERK_MORE_CRITICALS` | More Criticals | 3 | 6 | LK≥6 | — | Critical Chance +5/rank | PARTIAL — defined; Critical Chance stat applied |
| 9 | `PERK_NIGHT_VISION` | Night Vision | 1 | 3 | PE≥6 | — | − (reduces darkness penalty) | STUB — no darkness penalty system |
| 10 | `PERK_PRESENCE` | Presence | 3 | 3 | CH≥6 | — | — (reaction bonus in dialogue) | STUB — no reaction modifier |
| 11 | `PERK_RAD_RESISTANCE` | Rad Resistance | 2 | 6 | EN≥6, IN≥4 | — | Radiation Resist +15/rank | STUB — no radiation system |
| 12 | `PERK_TOUGHNESS` | Toughness | 3 | 3 | EN≥6, LK≥6 | — | DR Normal +10/rank | PARTIAL — defined; DR stat written, armor DR system incomplete |
| 13 | `PERK_STRONG_BACK` | Strong Back | 3 | 3 | ST≥6, EN≥6 | — | Carry Weight +50/rank | PARTIAL — defined; Carry Weight stat written |
| 14 | `PERK_SHARPSHOOTER` | Sharpshooter | 1 | 9 | PE≥7, IN≥6 | — | − (range penalty reduced) | WIRED — `hasPerk('Sharpshooter')` in `combat.ts`, range −2 |
| 15 | `PERK_SILENT_RUNNING` | Silent Running | 1 | 6 | AG≥6 | Sneak≥50 | − (run without Sneak penalty) | STUB — no Sneak-while-running check |
| 16 | `PERK_SURVIVALIST` | Survivalist | 1 | 3 | EN≥6, IN≥6 | Outdoorsman≥40 | Outdoorsman +25 | WIRED — `perkGetSkillModifier` covers Outdoorsman |
| 17 | `PERK_MASTER_TRADER` | Master Trader | 1 | 12 | CH≥7 | Barter≥75 | Barter +25 | STUB — not in PERKS array; Barter bonus not wired |
| 18 | `PERK_EDUCATED` | Educated | 3 | 3 | IN≥6 | — | +2 skill points/level/rank | WIRED — `player.ts:110` multiplies by perk rank |
| 19 | `PERK_HEALER` | Healer | 4 | 3 | PE≥7, IN≥5, AG≥6 | First Aid≥40 | First Aid heals +4..+10 HP | STUB — no HP range bonus on First Aid use |
| 20 | `PERK_FORTUNE_FINDER` | Fortune Finder | 1 | 6 | LK≥8 | — | More caps in random encounters | STUB — no loot modifier |
| 21 | `PERK_BETTER_CRITICALS` | Better Criticals | 1 | 9 | PE≥6, AG≥4, LK≥6 | — | Critical effect table +20 | WIRED — `hasPerk('Better Criticals')` filter in `combat.ts:502`, +30/rank |
| 22 | `PERK_EMPATHY` | Empathy | 1 | 6 | PE≥7, IN≥5 | — | See NPC reaction | STUB — no reaction display |
| 23 | `PERK_SLAYER` | Slayer | 1 | 18 | ST≥8, AG≥8 | Unarmed≥80 | Melee/Unarmed always critical | WIRED — `hasPerk('Slayer')` in `combat.ts:523` |
| 24 | `PERK_SNIPER` | Sniper | 1 | 18 | PE≥8, AG≥8 | Small Guns≥80 | Ranged always critical on LK roll | WIRED — `hasPerk('Sniper')` in `combat.ts:525` |
| 25 | `PERK_SILENT_DEATH` | Silent Death | 1 | 18 | AG≥10 | Sneak≥80 | ×2 damage when sneaking + HtH | STUB — no sneak attack multiplier |
| 26 | `PERK_ACTION_BOY` | Action Boy | 2 | 12 | AG≥5 | — | AP +1/rank | WIRED — stat written via bonus stat layer |
| 27 | `PERK_MENTAL_BLOCK` | Mental Block | 1 | 9 | — | — | Immune to Telepathy (Psyker) | STUB — Psyker encounters not in DH2 |
| 28 | `PERK_LIFEGIVER` | Lifegiver | 2 | 12 | EN≥4 | — | Max HP +4/rank per level | WIRED — `player.ts:118` adds `+4 * perkRank` HP/level |
| 29 | `PERK_DODGER` | Dodger | 1 | 9 | AG≥6 | — | AC +5 | PARTIAL — defined; AC stat written |
| 30 | `PERK_SNAKEATER` | Snakeater | 2 | 6 | EN≥3 | — | Poison Resist +25/rank | STUB — no poison system |
| 31 | `PERK_MR_FIXIT` | Mr. Fixit | 1 | 12 | IN≥4 | — | Science/Repair +10 | WIRED — `perkGetSkillModifier` in `src/skills.ts` |
| 32 | `PERK_MEDIC` | Medic | 1 | 12 | IN≥5, PE≥7 | — | First Aid/Doctor +10 | WIRED — `perkGetSkillModifier` in `src/skills.ts` |
| 33 | `PERK_MASTER_THIEF` | Master Thief | 1 | 12 | — | — | Lockpick/Steal +15 | WIRED — `perkGetSkillModifier` in `src/skills.ts` |
| 34 | `PERK_SPEAKER` | Speaker | 1 | 9 | CH≥7 | Speech≥50 | Speech +20 | WIRED — `perkGetSkillModifier` in `src/skills.ts` |
| 35 | `PERK_GHOST` | Ghost | 1 | 6 | AG≥6 | Sneak≥60 | Sneak +20 in dim light | WIRED — `perkGetSkillModifier` (dim-light check stub in DH2) |
| 36 | `PERK_FRIENDLY_FOE` | Friendly Foe | 1 | 3 | PE≥7 | — | — (ID friend vs foe at distance) | STUB — non-selectable in CE (maxRank=−1) |
| 37 | `PERK_EXPLORER` | Explorer | 1 | 9 | — | — | More special encounters | STUB — non-selectable in CE (maxRank=−1) |
| 38 | `PERK_FLOWER_CHILD` | Flower Child | 1 | 3 | EN≥5 | — | ÷2 addiction withdrawal | STUB — non-selectable in CE (maxRank=−1) |
| 39 | `PERK_PATHFINDER` | Pathfinder | 2 | 6 | EN≥6 | Outdoorsman≥40 | World-map travel time −25%/rank | STUB — no travel time modifier |
| 40 | `PERK_ANIMAL_FRIEND` | Animal Friend | 1 | 3 | IN≥5, PE≥7 | — | Animals won't attack | STUB — non-selectable in CE (maxRank=−1) |
| 41 | `PERK_SCROUNGER` | Scrounger | 1 | 9 | LK≥8 | — | More ammo in random encounters | STUB — non-selectable in CE (maxRank=−1) |
| 42 | `PERK_MYSTERIOUS_STRANGER` | Mysterious Stranger | 1 | 9 | LK≥8 | — | Random combat ally | STUB — non-selectable in CE (maxRank=−1) |
| 43 | `PERK_RANGER` | Ranger | 1 | 6 | PE≥6 | — | Outdoorsman +15 | WIRED — `perkGetSkillModifier` in `src/skills.ts` |
| 44 | `PERK_QUICK_POCKETS` | Quick Pockets | 1 | 3 | AG≥5 | — | Inventory access costs 2 AP | STUB — no AP cost for inventory |
| 45 | `PERK_SMOOTH_TALKER` | Smooth Talker | 3 | 3 | IN≥4 | — | +1 IN for dialogue checks/rank | STUB — no temp IN boost in dialogue |
| 46 | `PERK_SWIFT_LEARNER` | Swift Learner | 3 | 3 | IN≥4 | — | XP gained +5%/rank | STUB — no XP multiplier |
| 47 | `PERK_TAG` | Tag! | 1 | 12 | — | — | Tag a 4th skill (no +20 bonus) | WIRED — `applyPerk` sets `player.skills.hasTagPerk = true` |
| 48 | `PERK_MUTATE` | Mutate! | 1 | 9 | — | — | Change one trait | STUB — no trait-swap UI |
| 49 | `PERK_ADD_NUKA_COLA` | (Nuka-Cola) | — | — | — | — | Script-granted item grant | STUB — non-selectable |
| 50 | `PERK_ADD_MENTATS` | (Mentats) | — | — | — | — | Script-granted item grant | STUB — non-selectable |
| 51 | `PERK_ADD_BUFFOUT` | (Buffout) | — | — | — | — | Script-granted item grant | STUB — non-selectable |
| 52 | `PERK_ADD_PSYCHO` | (Psycho) | — | — | — | — | Script-granted item grant | STUB — non-selectable |
| 79 | `PERK_THIEF` | Thief | 1 | 3 | — | — | Sneak/Steal/Lockpick/Traps +10 | WIRED — `perkGetSkillModifier` in `src/skills.ts` |
| 80 | `PERK_GAIN_STRENGTH` | Gain Strength | 1 | 12 | ST<10 | — | ST +1 | PARTIAL — defined; SPECIAL boost applied |
| 81 | `PERK_GAIN_PERCEPTION` | Gain Perception | 1 | 12 | PE<10 | — | PE +1 | PARTIAL — defined |
| 82 | `PERK_GAIN_ENDURANCE` | Gain Endurance | 1 | 12 | EN<10 | — | EN +1 | PARTIAL — defined |
| 83 | `PERK_GAIN_CHARISMA` | Gain Charisma | 1 | 12 | CH<10 | — | CH +1 | PARTIAL — defined |
| 84 | `PERK_GAIN_INTELLIGENCE` | Gain Intelligence | 1 | 12 | IN<10 | — | IN +1 | PARTIAL — defined |
| 85 | `PERK_GAIN_AGILITY` | Gain Agility | 1 | 12 | AG<10 | — | AG +1 | PARTIAL — defined |
| 86 | `PERK_GAIN_LUCK` | Gain Luck | 1 | 12 | LK<10 | — | LK +1 | PARTIAL — defined |
| 87 | `PERK_HARMLESS` | Harmless | 1 | 3 | CH≥8 | — | Steal +20 | STUB — non-selectable in CE (maxRank=−1) |
| 88 | `PERK_HERE_AND_NOW` | Here and Now | 1 | 3 | — | — | Immediate level-up | STUB — non-selectable in CE (maxRank=−1); special case in `perkAddEffect` |
| 89 | `PERK_EVEN_TOUGHER` | Even Tougher | — | — | — | — | (unused/variant Toughness) | STUB — not in DH2 PERKS |
| 90 | `PERK_KARMA_BEACON` | Karma Beacon | 1 | 9 | CH≥6 | — | Karma effects ×2 | STUB — non-selectable in CE |
| 91 | `PERK_LIVING_ANATOMY` | Living Anatomy | 1 | 12 | — | Doctor≥60 | +10 damage vs critters; Doctor +10 | WIRED — `hasPerk('Living Anatomy')` in `combat.ts:641,706`; `perkGetSkillModifier` for Doctor |
| 92 | `PERK_DEMOLITIONS_EXPERT` | Demolition Expert | 1 | 9 | — | Traps≥90 | Explosive damage +25% | WIRED — `hasPerk('Demolition Expert')` in `object.ts:108` |
| 93 | `PERK_GAMBLER` | Gambler | 1 | 6 | — | Gambling≥50 | Gambling +20 | WIRED — `perkGetSkillModifier` in `src/skills.ts` |
| 94 | `PERK_CULT_OF_PERSONALITY` | Cult of Personality | 1 | 12 | CH≥10 | — | Karma never affects reaction | STUB — no reaction system |
| 95 | `PERK_NEGOTIATOR` | Negotiator | 1 | 6 | CH≥6 | Barter≥50, Speech≥50 | Barter/Speech +10 | WIRED — `perkGetSkillModifier` (Barter); Speech portion stub |
| 96 | `PERK_DRUG_ADDICT` | (Drug Addict) | — | — | — | — | Withdrawal penalty | STUB — non-selectable; addiction system stub |
| 97 | `PERK_DRUG_RESISTANT` | (Drug Resistant) | — | — | — | — | Resist withdrawal | STUB — non-selectable |
| 98 | `PERK_PYROMANIAC` | Pyromaniac | 1 | 9 | — | — | Fire damage +5 | WIRED — `hasPerk('Pyromaniac')` in `combat.ts:647` |
| 99 | `PERK_ADRENALINE_RUSH` | Adrenaline Rush | 1 | 6 | ST≥4 | — | ST +1 when HP < 50% | STUB — no conditional ST modifier |
| 100 | `PERK_CAUSE_OF_DEATH` | Cause of Death | 1 | 9 | — | — | More detail on kills | STUB — non-selectable |
| 101 | `PERK_DIVINE_FAVOR` | (Divine Favor) | — | — | — | — | (special encounter) | STUB — non-selectable |
| 102 | `PERK_VAULT_CITY_TRAINING` | Vault City Training | 1 | 3 | — | — | First Aid/Doctor +5 | WIRED — `perkGetSkillModifier` in `src/skills.ts` |
| 103–107 | various | (Weapon Perk family) | — | — | — | — | Weapon type bonuses | STUB — not in DH2 PERKS |
| 108 | `PERK_WEAPON_LONG_RANGE` | (Long Range) | — | — | — | — | Weapon range bonus | STUB — non-selectable |
| 109–112 | various | (Weapon enhanced family) | — | — | — | — | Weapon accuracy bonuses | STUB — non-selectable |
| 113 | `PERK_EXPERT_EXCREMENT_EXPEDITOR` | Expert Excrement Expeditor | 1 | — | — | — | Speech +5 | STUB — non-selectable in CE (maxRank=−1) |
| 114 | `PERK_WEAPON_ENHANCED_KNOCKOUT` | (Enhanced Knockout) | — | — | — | — | Knockout chance | STUB — non-selectable |
| 115 | `PERK_JINXED` | Jinxed (perk) | 1 | — | — | — | Enemies crit-fail 1-in-4 | WIRED — `hasPerk('Jinxed')` in `combat.ts:568`; also Pariah Dog |
| 116 | `PERK_SALESMAN` | Salesman | 1 | 6 | CH≥5 | Barter≥50 | Barter +20 | WIRED — `perkGetSkillModifier` in `src/skills.ts` |
| 117 | `PERK_WEATHERED` | (Weathered) | — | — | — | — | (unused) | STUB — not in DH2 |
| 118 | `PERK_PARIAH` | Pariah (Pariah Dog) | 1 | — | — | — | LK −1; enemy crit-fail | PARTIAL — `hasPerk('Pariah Dog')` in `combat.ts:569` |
| 119 | `PERK_INTENSE_TRAINING` | Intense Training | 10 | 3 | — | — | +1 SPECIAL of choice/rank | STUB — not in DH2 PERKS |

### 2.5 Non-Selectable Perks (maxRank = −1)

These perks are granted by scripts, in-game events, or special conditions. They cannot be chosen at level-up.

| CE Index Range | Category | Examples | DH2 Status |
|---|---|---|---|
| 53–70 | Drug Addiction | Nuka-Cola Addiction, Buffout Addiction, Jet Addiction | STUB — addiction system not implemented |
| 61, 62 | Armor Bonus | Powered Armor, Combat Armor | STUB — no armor perk system |
| 67, 68 | Advanced Armor | Advanced Power Armor I/II | STUB |
| 72 | Armor Charisma | (from Tesla Armor) | STUB |
| 73–76 | Dermal/Phoenix Implants | Dermal Impact Armor, Phoenix Armor | STUB — no implant system |
| 77 | Inoculations | Vault City Inoculations | STUB |
| 36, 37, 38, 40–42, 86–88, 90, 100, 113 | Misc Non-Selectable | Friendly Foe, Explorer, Flower Child, Harmless, Here and Now, Karma Beacon | STUB |

---

## 3. Perk & Trait Script Opcodes

### 3.1 Opcode Table

| Opcode | Intrinsic Name | argc | vm_bridge.ts | scripting.ts | Status |
|---|---|---|---|---|---|
| `0x80F3` | `has_trait` | 3 | `bridged("has_trait", 3)` | `has_trait(traitType, obj, trait)` | PARTIAL (see §3.2) |
| `0x8102` | `critter_add_trait` | 4 | `bridged("critter_add_trait", 4)` | `critter_add_trait(...)` | PARTIAL (stub body) |
| — | `has_perk` | 2 | **NOT WIRED** | **NOT IMPLEMENTED** | MISSING |
| — | `add_perk` | 2 | **NOT WIRED** | **NOT IMPLEMENTED** | MISSING |
| — | `remove_perk` | 2 | **NOT WIRED** | **NOT IMPLEMENTED** | MISSING |
| — | `perk_level` | 2 | **NOT WIRED** | **NOT IMPLEMENTED** | MISSING |

### 3.2 `has_trait` Implementation Detail

CE semantics: `has_trait(traitType, object, traitValue)` where `traitType` selects which attribute family to query:
- `TRAIT_OBJECT = 0` — checks `critterGetStat` derived traits (team, rotation, etc.)
- `TRAIT_PERK = 1` — checks perk rank
- `TRAIT_OBJECT_DATA = 2` — checks object data field
- `TRAIT_TAG = 3` — checks tagged skill

**DH2 `scripting.ts`** (`has_trait` at line 580): Only handles `TRAIT_OBJECT` (type 1 in DH2's mapping). Recognized sub-values: `AI_PACKET (5)`, `TEAM_NUM (6)`, `CUR_ROT (10)`, `VISIBILITY (666)`. All other traitType values fall through to `stub()`.

**Result:** FO2 scripts calling `has_trait(TRAIT_PERK, critter, PERK_*)` always return the stub default. Any script that gates behavior on perk presence via `has_trait` is broken in DH2.

### 3.3 Missing Opcodes — Impact

Since `has_perk`, `add_perk`, `remove_perk`, and `perk_level` are not wired in `vm_bridge.ts`:

- FO2 scripts that grant perks via `add_perk` (e.g., Doctor granting Vault City Training, Gecko Skinning from Ranger quest) silently do nothing.
- Scripts that branch on `has_perk` (e.g., special NPC dialogue for perk holders) return stub value 0 = "no perk", always taking the fallback path.
- `perk_level` (rank query) returns stub value 0, blocking multi-rank gating.

---

## 4. Modifier Query Functions

### 4.1 CE `perkGetSkillModifier(perks[], skill)` — `perk.cc:628`

Called from `skillGetValue()` for the player critter. Returns total perk bonus for a skill.

| Skill | Perks that Contribute |
|---|---|
| First Aid | Medic +10, Vault City Training +5 |
| Doctor | Medic +10, Living Anatomy +10, Vault City Training +5 |
| Sneak | Ghost +20 (dim light only) |
| Lockpick | Thief +10, Master Thief +15 |
| Steal | Thief +10, Master Thief +15, Harmless +20 |
| Traps | Thief +10 |
| Science | Mr. Fixit +10 |
| Repair | Mr. Fixit +10 |
| Speech | Speaker +20, Expert Excrement Expeditor +5 |
| Barter | Negotiator +10, Salesman +20 |
| Gambling | Gambler +20 |
| Outdoorsman | Ranger +15, Survivalist +25 |

**DH2 `src/skills.ts`** implements `perkGetSkillModifier(perks, skill)` with equivalent logic. Ghost's dim-light check is not enforced (always grants the bonus if perk is held).

### 4.2 CE `traitGetSkillModifier(traits[], skill)` — `trait.cc:284`

Called from `skillGetValue()` for any critter. Returns total trait bonus for a skill. See §1.4 for the full table.

**DH2 `src/skills.ts`** implements `traitGetSkillModifier(traits, skill)` with equivalent logic.

### 4.3 CE `traitGetStatModifier(trait, stat)` — `trait.cc:180`

Called inside `critterGetStat` for the base stat layer. Returns the stat delta for a given trait. See §1.3 for the full table.

**DH2 Discrepancy:** DH2 does not call `traitGetStatModifier` at stat query time. Trait stat effects are baked into `baseStats` during character creation in `ui_character.ts`. This means trait stat modifiers on non-player critters granted traits via script are not respected.

### 4.4 CE `perkAddEffect(critter, perk)` — `perk.cc:554`

Writes the perk's `statModifier` to the critter's **bonus stat layer** (`critterSetBonusStat`). The bonus layer is then summed in `critterGetStat`. Special handling:
- `HERE_AND_NOW`: XP to next level granted immediately
- `maxRank == -1` perks: applies `stats[0..6]` array as SPECIAL bonus deltas

**DH2 has no bonus stat layer.** Perks with stat effects (Dodger, Action Boy, Earlier Sequence, etc.) write directly to `baseStats` via `applyPerk → player.stats.modifyBase`. This is equivalent for single-rank perks but differs for multi-rank perks if ranks are applied non-atomically.

---

## 5. Character Creation

### 5.1 Trait Selection

- Max **2 traits** selectable (`TRAITS_MAX_SELECTED_COUNT = 2` in CE; enforced in `ui_character.ts`)
- Traits cannot be changed after creation (except via the Mutate! perk — stub in DH2)
- DH2 enforces the 2-trait cap with `showInfoCard('Traits', 'You may only pick 2 traits.')` when a 3rd is attempted (`ui_character.ts:1630–1636`)

### 5.2 Perk Availability

| Condition | Perk Every N Levels |
|---|---|
| Default | 3 |
| Skilled trait selected | 4 |

DH2 implementation (`player.ts:122–127`):
```ts
if (this.level % (this.traits.includes('Skilled') ? 4 : 3) === 0) {
    this.pendingPerkPick = true;
}
```

### 5.3 Tag! Perk

The **Tag!** perk (CE index 47) allows tagging a 4th skill. The 4th tagged skill receives the tagging bonus (doubled invested points) but **not** the flat +20. DH2 mirrors this via `SkillSet.hasTagPerk` (set by `applyPerk('Tag!')` in `src/perks.ts`).

See `src/char.ts:117–122` for the 4th-slot Tag! check:
```ts
const isTagPerk4thSlot = (options?.hasTagPerk || this.hasTagPerk)
    && this.tagged.length >= 4
    && this.tagged[3] === skill;
if (!isTagPerk4thSlot) {
    value += 20;
}
```

---

## 6. Known Gaps

| # | Area | CE Behavior | DH2 Status | Gap Description |
|---|---|---|---|---|
| 1 | `has_perk` opcode | `perkGetRank(critter, perk) > 0` | MISSING | Not wired in vm_bridge.ts; scripts cannot query perk presence |
| 2 | `add_perk` opcode | `perkAddEffect(critter, perk)` | MISSING | Not wired; quest-granted perks never applied |
| 3 | `remove_perk` opcode | `perkRemoveEffect(critter, perk)` | MISSING | Not wired |
| 4 | `perk_level` opcode | `perkGetRank(critter, perk)` | MISSING | Not wired; rank queries always return stub 0 |
| 5 | `has_trait(TRAIT_PERK, ...)` | Routes to perk rank check | PARTIAL | DH2 has_trait only handles TRAIT_OBJECT sub-types |
| 6 | Trait stat modifiers — live | `traitGetStatModifier` called in `critterGetStat` | PARTIAL | DH2 bakes trait stats at creation only; NPC traits via script ignored |
| 7 | One Hander trait | ±weapon-type skill modifier | STUB | No weapon-type categorization for skill modifiers |
| 8 | Fast Shot trait | −1 AP ranged, no targeting | STUB | AP cost and targeted-shot restriction not implemented |
| 9 | Kamikaze — AC zeroing | Base AC only, armor bonus stripped | STUB | DH2 applies AC from armor normally |
| 10 | Ghost perk — light condition | +20 Sneak only in dim/darkness | PARTIAL | Bonus always applied; no light-level check |
| 11 | Addiction perks (53–70) | Script-granted withdrawal penalties | STUB | No addiction system; all 18 addiction perks are no-ops |
| 12 | Implant perks (73–77) | SPECIAL stat bonuses via `stats[]` delta | STUB | No implant system; `add_perk` itself missing |
| 13 | Action Boy multi-rank | AP +1 per `perkAddEffect` call | PARTIAL — DH2 modifyBase each rank | Functionally equivalent; differs if bonus layer reset ever implemented |
| 14 | Here and Now | Immediate XP-to-next-level grant | STUB | Non-selectable; `add_perk` missing |
| 15 | GAIN_* perks SPECIAL req | Require SPECIAL < 10 (encoded as `stats[n] = -10`) | PARTIAL | DH2 `getValidPerks` checks `minStats` as lower bound only; upper bound (< 10) not checked |
