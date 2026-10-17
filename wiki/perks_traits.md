# Perks & Traits — DarkHarold2 Reference

> Ground-truth: `raw/fallout2-ce/src/perk.cc`, `perk_defs.h`, `trait.cc`, `trait_defs.h`  
> DH2 impl: `src/perks.ts` (barrel; `src/perks/{perks.data,perks}.ts`), `src/ui_character.ts` (barrel; `src/ui_character/*.ts`), `src/combat.ts` (barrel; `src/combat/*.ts`), `src/player.ts`, `src/object.ts` (barrel; `src/object/*.ts`), `src/scripting.ts`, `src/vm_bridge.ts`

---

## 1. Traits

Traits are selected during **character creation** only (max 2). They provide trade-off bonuses/penalties and are never gained during play via normal gameplay. Selecting a trait immediately modifies stats and skills for the lifetime of the character.

### 1.1 CE Implementation

**Storage:** `gSelectedTraits[TRAITS_MAX_SELECTED_COUNT]` (size=2). Each element is a `Trait` enum value (0–15) or `-1` for empty.

**Live modifier queries:**
- `traitGetStatModifier(trait)` in `trait.cc` — returns stat delta for each selected trait; called inside `critterGetStat` chain
- `traitGetSkillModifier(traits[], skill)` in `trait.cc:284` — returns skill delta; called inside `skillGetValue`

**DH2 Storage:** `Player.traits: string[]` (names as in `TRAIT_DESCRIPTIONS`, `src/ui_character/descriptions.ts`), set at character creation and by Mutate! (`Player.setTraits`).

**DH2 Live vs Applied:** skills read the traits live (`traitGetSkillModifier` in `src/skills.ts`). The derived-stat parts of `traitGetStatModifier` are applied live in `Player.getStat` (`src/player.ts`: AP, AC, Melee, Carry, Sequence, Healing Rate, Critical Chance, Better Criticals, DR Radiation/Poison); only the SPECIAL parts (Gifted +1 all, Bruiser ST +2, Small Frame AG +1) are kept on the base stats and swapped by `setTraits` — equivalent, since CE's `critterGetBaseStatWithTraitModifier` adds them to the base.

### 1.2 Traits Table

| # | CE Constant | Name | CE effect | DH2 |
|---|---|---|---|---|
| 0 | `TRAIT_FAST_METABOLISM` | Fast Metabolism | Healing Rate +2; Rad/Poison Resist 0 | `player.ts` getStat |
| 1 | `TRAIT_BRUISER` | Bruiser | ST +2; AP −2 | SPECIAL on base; AP in getStat |
| 2 | `TRAIT_SMALL_FRAME` | Small Frame | AG +1; Carry −10×ST | SPECIAL on base; Carry in getStat |
| 3 | `TRAIT_ONE_HANDER` | One Hander | +20 one-handed, −40 two-handed (to-hit) | `combat/hitChance.ts` |
| 4 | `TRAIT_FINESSE` | Finesse | Crit chance +10; damage −30 % | `player.ts`, `combat/Combat.ts` |
| 5 | `TRAIT_KAMIKAZE` | Kamikaze | Sequence +5; AC = −base AC | `player.ts` getStat |
| 6 | `TRAIT_HEAVY_HANDED` | Heavy Handed | Melee Damage +4; Better Criticals −30 | `player.ts` getStat |
| 7 | `TRAIT_FAST_SHOT` | Fast Shot | −1 AP for weapons with range > 2; no aimed shots | `critter/Weapon.ts`, `unarmed.ts` |
| 8 | `TRAIT_BLOODY_MESS` | Bloody Mess | Always the most violent death | `critter/deathAnim.ts` |
| 9 | `TRAIT_JINXED` | Jinxed | Misses can become critical failures (everyone) | `combat/Combat.ts` |
| 10 | `TRAIT_GOOD_NATURED` | Good Natured | Combat skills −10; First Aid/Doctor/Speech/Barter +15 | `skills.ts` |
| 11 | `TRAIT_CHEM_RELIANT` | Chem Reliant | Addiction chance ×2; withdrawal ÷2 | `drugs.ts` |
| 12 | `TRAIT_CHEM_RESISTANT` | Chem Resistant | Addiction chance ÷2; drug effect ÷2 | `drugs.ts` |
| 13 | `TRAIT_SEX_APPEAL` | Sex Appeal | Script-driven (has_trait TRAIT_TRAIT) | `scripting.ts` has_trait |
| 14 | `TRAIT_SKILLED` | Skilled | +5 SP/level; perk every 4 levels | `player.ts` addExperience |
| 15 | `TRAIT_GIFTED` | Gifted | SPECIAL +1; skills −10; −5 SP/level | base SPECIAL, `skills.ts`, `player.ts` |

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

**Storage:** a rank array per critter (`perkGetRankData`): the dude's, the party.txt members' own; any other critter falls back to the dude's ranks (CE quirk, kept). `perkGetRank(critter, perk)` returns the rank.

**DH2 Storage:** `Critter.perks: string[]` (perk.msg names, one entry per rank). `getPerkRank(critter, name)` counts entries; `perkRankOwner(c)` (`src/scripting.ts`) is the CE `perkGetRankData` choice (player / party.txt member / else the player).

**DH2 Application:** `applyPerk(player, name)` (`src/perks/perks.ts`) pushes the rank and calls `perkApplyEffect` (`src/perks/cePerks.ts`, CE `perkAddEffect`): the per-rank `stat`/`statModifier`, the SPECIAL deltas of `maxRank == −1` perks and the Gain <stat> +1; plus Tag!, the immediate Lifegiver/Educated parts and Here and Now's XP. Other perks are checked where they act (table below).

### 2.2 Perk Prerequisites

CE `perkCanAdd()` (`perk.cc:302`), ported 1:1 as `perkCanAdd` in `src/perks/perks.ts` over `CE_PERK_REQS` (`src/perks/cePerks.ts`, generated from `gPerkDescriptions`):
1. `maxRank != −1` and rank < maxRank
2. `minLevel` (dude only)
3. `param1` / `paramMode` / `param2` — skill id, or GVAR when bit `0x4000000` is set; a negative value is an upper bound:
   - `PERK_PARAM_MODE_FIRST_ONLY (0)` — param1 only
   - `PERK_PARAM_MODE_OR (1)` — param1 OR param2
   - `PERK_PARAM_MODE_AND (2)` — param1 AND param2
4. `stats[0..6]` — SPECIAL minimum; negative = must be below −value (Gain perks: < 10, Heave Ho! ST < 9, Weapon Handling ST < 7)

`getValidPerks` walks all 119 ids like `perkGetAvailablePerks`; perks missing from `perks.data.ts` (the Gain perks, Here and Now …) get a `PerkDef` from perk.msg (`perkDefById`; image from `art/skilldex` by the CE frmId). minLevel 310 marks perks CE never offers (Mental Block, Scrounger, Flower Child, Animal Friend, the unused 36).

### 2.3 Perk Rate

- Default: 1 perk every **3 levels**; Skilled: every **4 levels** (`player.ts` addExperience → `pendingPerkPick`)
- Here and Now: XP up to the next level (`pcGetExperienceForLevel(level + 1) − XP`, Swift Learner applies)

### 2.4 Perk Table (CE `gPerkDescriptions`, all 119)

Generated from `perk.cc` / `perk_defs.h` / `perk.msg` (2026-10-18). "stat N" is the per-rank derived-stat bonus applied by `perkApplyEffect` (STAT ids: 3 CH, 8 AP, 9 AC, 11 Melee, 12 Carry, 13 Sequence, 14 Healing Rate, 15 Crit Chance, 16 Better Criticals, 24 DR Normal, 31 Rad Resist, 32 Poison Resist); "Δ" are the SPECIAL deltas of `maxRank == −1` perks. "Referenced in" lists the DH2 files that check the perk; `—` with a stat bonus means the bonus is all it does. Perks with neither are script-driven in CE as well (no engine reference in CE: Presence, Cult of Personality, Mysterious Stranger, Kama Sutra Master, Karma Beacon, Light Step, Magnetic Personality, Gecko Skinning, Scrounger, Animal Friend). The Alcohol/Autodoc HP perks (108–115) are checked by id in `Player.getStat` (CE `critterGetStat`).

| ID | CE constant | Name | Ranks | Lvl | SPECIAL | Skill / GVAR | Referenced in (src) |
|---|---|---|---|---|---|---|---|
| 0 | `PERK_AWARENESS` | Awareness | 1 | 3 | PE≥5 | — | examine.ts |
| 1 | `PERK_BONUS_HTH_ATTACKS` | Bonus HtH Attacks | 1 | 15 | AG≥6 | — | critter/Weapon.ts, unarmed.ts |
| 2 | `PERK_BONUS_HTH_DAMAGE` | Bonus HtH Damage | 3 | 3 | ST≥6, AG≥6; stat 11 +2/rank | — | combat/Combat.ts |
| 3 | `PERK_BONUS_MOVE` | Bonus Move | 2 | 6 | AG≥5 | — | combat/actionPoints.ts |
| 4 | `PERK_BONUS_RANGED_DAMAGE` | Bonus Ranged Damage | 2 | 6 | AG≥6, LK≥6 | — | combat/Combat.ts |
| 5 | `PERK_BONUS_RATE_OF_FIRE` | Bonus Rate of Fire | 1 | 15 | PE≥6, IN≥6, AG≥7 | — | critter/Weapon.ts |
| 6 | `PERK_EARLIER_SEQUENCE` | Earlier Sequence | 3 | 3 | PE≥6; stat 13 +2/rank | — | — |
| 7 | `PERK_FASTER_HEALING` | Faster Healing | 3 | 3 | EN≥6; stat 14 +2/rank | — | — |
| 8 | `PERK_MORE_CRITICALS` | More Criticals | 3 | 6 | LK≥6; stat 15 +5/rank | — | — |
| 9 | `PERK_NIGHT_VISION` | Night Vision | 1 | 3 | PE≥6 | — | gametime.ts |
| 10 | `PERK_PRESENCE` | Presence | 3 | 3 | CH≥6 | — | — |
| 11 | `PERK_RAD_RESISTANCE` | Rad Resistance | 2 | 6 | EN≥6, IN≥4; stat 31 +15/rank | — | — |
| 12 | `PERK_TOUGHNESS` | Toughness | 3 | 3 | EN≥6, LK≥6; stat 24 +10/rank | — | — |
| 13 | `PERK_STRONG_BACK` | Strong Back | 3 | 3 | ST≥6, EN≥6; stat 12 +50/rank | — | — |
| 14 | `PERK_SHARPSHOOTER` | Sharpshooter | 1 | 9 | PE≥7, IN≥6 | — | combat/hitChance.ts |
| 15 | `PERK_SILENT_RUNNING` | Silent Running | 1 | 6 | AG≥6 | Sneak≥50 | object/Critter.ts |
| 16 | `PERK_SURVIVALIST` | Survivalist | 1 | 3 | EN≥6, IN≥6 | Outdoorsman≥40 | skills.ts |
| 17 | `PERK_MASTER_TRADER` | Master Trader | 1 | 12 | CH≥7 | Barter≥75 | ui_barter/screen.ts |
| 18 | `PERK_EDUCATED` | Educated | 3 | 6 | IN≥6 | — | perks/perks.ts, player.ts |
| 19 | `PERK_HEALER` | Healer | 2 | 3 | PE≥7, IN≥5, AG≥6 | First Aid≥40 | skillUse.ts |
| 20 | `PERK_FORTUNE_FINDER` | Fortune Finder | 1 | 6 | LK≥8 | — | worldmap/encounters.ts |
| 21 | `PERK_BETTER_CRITICALS` | Better Criticals | 1 | 9 | PE≥6, AG≥4, LK≥6; stat 16 +20/rank | — | combat/Combat.ts, player.ts, proto_types.ts, scripting.ts, skills.ts, statIds.ts |
| 22 | `PERK_EMPATHY` | Empathy | 1 | 6 | PE≥7, IN≥5 | — | ui_dialogue.ts |
| 23 | `PERK_SLAYER` | Slayer | 1 | 24 | ST≥8, AG≥8 | Unarmed≥80 | combat/Combat.ts |
| 24 | `PERK_SNIPER` | Sniper | 1 | 24 | PE≥8, AG≥8 | Small Guns≥80 | combat/Combat.ts |
| 25 | `PERK_SILENT_DEATH` | Silent Death | 1 | 18 | AG≥10 | Sneak≥80 AND Unarmed≥80 | combat/Combat.ts |
| 26 | `PERK_ACTION_BOY` | Action Boy | 2 | 12 | AG≥5; stat 8 +1/rank | — | — |
| 27 | `PERK_MENTAL_BLOCK` | Mental Block | 1 | 310 | — | — | — |
| 28 | `PERK_LIFEGIVER` | Lifegiver | 2 | 12 | EN≥4 | — | perks/perks.ts, player.ts |
| 29 | `PERK_DODGER` | Dodger | 1 | 9 | AG≥6; stat 9 +5/rank | — | — |
| 30 | `PERK_SNAKEATER` | Snakeater | 2 | 6 | EN≥3; stat 32 +25/rank | — | — |
| 31 | `PERK_MR_FIXIT` | Mr. Fixit | 1 | 12 | — | Repair≥40 OR Science≥40 | skills.ts |
| 32 | `PERK_MEDIC` | Medic | 1 | 12 | — | First Aid≥40 OR Doctor≥40 | skills.ts |
| 33 | `PERK_MASTER_THIEF` | Master Thief | 1 | 12 | — | Steal≥50 AND Lockpick≥50 | skills.ts |
| 34 | `PERK_SPEAKER` | Speaker | 1 | 9 | — | Speech≥50 | skills.ts |
| 35 | `PERK_HEAVE_HO` | Heave Ho! | 3 | 6 | ST<9 | — | combat/Combat.ts |
| 36 | `PERK_FRIENDLY_FOE` | ERROR -- UNIMPED | 1 | 310 | PE≥4 | — | — |
| 37 | `PERK_PICKPOCKET` | Pickpocket | 1 | 15 | AG≥8 | Steal≥80 | skillUse.ts |
| 38 | `PERK_GHOST` | Ghost | 1 | 6 | — | Sneak≥60 | object/Critter.ts, skills.ts |
| 39 | `PERK_CULT_OF_PERSONALITY` | Cult of Personality | 1 | 12 | CH≥10 | — | — |
| 40 | `PERK_SCROUNGER` | Scrounger | 1 | 310 | LK≥8 | — | — |
| 41 | `PERK_EXPLORER` | Explorer | 1 | 9 | — | — | encounters/resolver.ts |
| 42 | `PERK_FLOWER_CHILD` | Flower Child | 1 | 310 | EN≥5 | — | drugs.ts |
| 43 | `PERK_PATHFINDER` | Pathfinder | 2 | 6 | EN≥6 | Outdoorsman≥40 | worldmap/Worldmap.ts |
| 44 | `PERK_ANIMAL_FRIEND` | Animal Friend | 1 | 310 | IN≥5 | Outdoorsman≥25 | — |
| 45 | `PERK_SCOUT` | Scout | 1 | 3 | PE≥7 | — | encounters/resolver.ts |
| 46 | `PERK_MYSTERIOUS_STRANGER` | Mysterious Stranger | 1 | 9 | LK≥4 | — | — |
| 47 | `PERK_RANGER` | Ranger | 1 | 6 | PE≥6 | — | encounters/resolver.ts, skills.ts |
| 48 | `PERK_QUICK_POCKETS` | Quick Pockets | 1 | 3 | AG≥5 | — | ui_inventory/panel.ts |
| 49 | `PERK_SMOOTH_TALKER` | Smooth Talker | 3 | 3 | IN≥4 | — | scripting.ts |
| 50 | `PERK_SWIFT_LEARNER` | Swift Learner | 3 | 3 | IN≥4 | — | player.ts |
| 51 | `PERK_TAG` | Tag! | 1 | 12 | — | — | perks/perks.ts |
| 52 | `PERK_MUTATE` | Mutate! | 1 | 9 | — | — | ui_character/perkModal.ts |
| 53 | `PERK_NUKA_COLA_ADDICTION` | Nuka-Cola Reliance | ∞ (−1) | — | — | — | — |
| 54 | `PERK_BUFFOUT_ADDICTION` | Buffout Reliance | ∞ (−1) | — | Δ ST-2, EN-2, AG-3 | — | — |
| 55 | `PERK_MENTATS_ADDICTION` | Mentats Reliance | ∞ (−1) | — | Δ IN-3, AG-2 | — | — |
| 56 | `PERK_PSYCHO_ADDICTION` | Psycho Reliance | ∞ (−1) | — | Δ IN-2 | — | — |
| 57 | `PERK_RADAWAY_ADDICTION` | Radaway Reliance | ∞ (−1) | — | stat 31 -20/rank | — | — |
| 58 | `PERK_WEAPON_LONG_RANGE` | Weapon Long Range | ∞ (−1) | — | — | — | combat/hitChance.ts |
| 59 | `PERK_WEAPON_ACCURATE` | Weapon Accurate | ∞ (−1) | — | — | — | combat/hitChance.ts |
| 60 | `PERK_WEAPON_PENETRATE` | Weapon Penetrate | ∞ (−1) | — | — | — | combat/Combat.ts |
| 61 | `PERK_WEAPON_KNOCKBACK` | Weapon Knockback | ∞ (−1) | — | — | — | combat/Combat.ts |
| 62 | `PERK_POWERED_ARMOR` | Powered Armor | ∞ (−1) | — | Δ ST+3; stat 31 +30/rank | — | — |
| 63 | `PERK_COMBAT_ARMOR` | Combat Armor | ∞ (−1) | — | stat 31 +20/rank | — | — |
| 64 | `PERK_WEAPON_SCOPE_RANGE` | Weapon Scope Range | ∞ (−1) | — | — | — | combat/hitChance.ts |
| 65 | `PERK_WEAPON_FAST_RELOAD` | Weapon Fast Reload | ∞ (−1) | — | — | — | critter/Weapon.ts |
| 66 | `PERK_WEAPON_NIGHT_SIGHT` | Weapon Night Sight | ∞ (−1) | — | — | — | combat/hitChance.ts |
| 67 | `PERK_WEAPON_FLAMEBOY` | Weapon Flameboy | ∞ (−1) | — | — | — | critter/deathAnim.ts |
| 68 | `PERK_ARMOR_ADVANCED_I` | Armor Advanced I | ∞ (−1) | — | Δ ST+4; stat 31 +60/rank | — | — |
| 69 | `PERK_ARMOR_ADVANCED_II` | Armor Advanced II | ∞ (−1) | — | Δ ST+4; stat 31 +75/rank | — | — |
| 70 | `PERK_JET_ADDICTION` | Jet Reliance | ∞ (−1) | — | Δ ST-1, PE-1; stat 8 -1/rank | — | drugs.ts |
| 71 | `PERK_TRAGIC_ADDICTION` | Tragic Reliance | ∞ (−1) | — | Δ PE-2, IN-1, LK-1 | — | — |
| 72 | `PERK_ARMOR_CHARISMA` | Armor Charisma | ∞ (−1) | — | Δ CH+2 | — | — |
| 73 | `PERK_GECKO_SKINNING` | Gecko Skinning | ∞ (−1) | — | — | — | — |
| 74 | `PERK_DERMAL_IMPACT_ARMOR` | Dermal Impact Armor | ∞ (−1) | — | — | — | player.ts |
| 75 | `PERK_DERMAL_IMPACT_ASSAULT_ENHANCEMENT` | Dermal Impact Asslt. Enhance. | ∞ (−1) | — | stat 3 -1/rank | — | player.ts |
| 76 | `PERK_PHOENIX_ARMOR_IMPLANTS` | Phoenix Armor Implants | ∞ (−1) | — | — | — | player.ts |
| 77 | `PERK_PHOENIX_ASSAULT_ENHANCEMENT` | Phoenix Assault Enhancement | ∞ (−1) | — | stat 3 -1/rank | — | player.ts |
| 78 | `PERK_VAULT_CITY_INOCULATIONS` | Vault City Inoculations | ∞ (−1) | — | — | — | player.ts |
| 79 | `PERK_ADRENALINE_RUSH` | Adrenaline Rush | 1 | 6 | ST<10 | — | player.ts |
| 80 | `PERK_CAUTIOUS_NATURE` | Cautious Nature | 1 | 3 | PE≥6 | — | encounters/resolver.ts |
| 81 | `PERK_COMPREHENSION` | Comprehension | 1 | 3 | IN≥6 | — | object/Obj.ts |
| 82 | `PERK_DEMOLITION_EXPERT` | Demolition Expert | 1 | 9 | AG≥4 | Traps≥75 | object/Obj.ts |
| 83 | `PERK_GAMBLER` | Gambler | 1 | 6 | — | Gambling≥50 | skills.ts |
| 84 | `PERK_GAIN_STRENGTH` | Gain Strength | 1 | 12 | ST<10 | — | — |
| 85 | `PERK_GAIN_PERCEPTION` | Gain Perception | 1 | 12 | PE<10 | — | — |
| 86 | `PERK_GAIN_ENDURANCE` | Gain Endurance | 1 | 12 | EN<10 | — | — |
| 87 | `PERK_GAIN_CHARISMA` | Gain Charisma | 1 | 12 | CH<10 | — | — |
| 88 | `PERK_GAIN_INTELLIGENCE` | Gain Intelligence | 1 | 12 | IN<10 | — | — |
| 89 | `PERK_GAIN_AGILITY` | Gain Agility | 1 | 12 | AG<10 | — | — |
| 90 | `PERK_GAIN_LUCK` | Gain Luck | 1 | 12 | LK<10 | — | — |
| 91 | `PERK_HARMLESS` | Harmless | 1 | 6 | — | Steal≥50 AND GVAR 0≥50 | skills.ts |
| 92 | `PERK_HERE_AND_NOW` | Here and Now | 1 | 3 | — | — | perks/perks.ts |
| 93 | `PERK_HTH_EVADE` | HtH Evade | 1 | 12 | — | Unarmed≥75 | combat/Combat.ts |
| 94 | `PERK_KAMA_SUTRA_MASTER` | Kama Sutra Master | 1 | 3 | EN≥5, AG≥5 | — | — |
| 95 | `PERK_KARMA_BEACON` | Karma Beacon | 1 | 9 | CH≥6 | — | — |
| 96 | `PERK_LIGHT_STEP` | Light Step | 1 | 9 | AG≥5, LK≥5 | — | — |
| 97 | `PERK_LIVING_ANATOMY` | Living Anatomy | 1 | 12 | — | Doctor≥60 | combat/Combat.ts, skills.ts |
| 98 | `PERK_MAGNETIC_PERSONALITY` | Magnetic Personality | 1 | 6 | CH<10 | — | — |
| 99 | `PERK_NEGOTIATOR` | Negotiator | 1 | 6 | — | Barter≥50 AND Speech≥50 | skills.ts |
| 100 | `PERK_PACK_RAT` | Pack Rat | 1 | 6 | stat 12 +50/rank | — | — |
| 101 | `PERK_PYROMANIAC` | Pyromaniac | 1 | 9 | — | Big Guns≥75 | combat/Combat.ts, critter/deathAnim.ts |
| 102 | `PERK_QUICK_RECOVERY` | Quick Recovery | 1 | 6 | AG≥5 | — | combat/results.ts |
| 103 | `PERK_SALESMAN` | Salesman | 1 | 6 | — | Barter≥50 | skills.ts |
| 104 | `PERK_STONEWALL` | Stonewall | 1 | 3 | ST≥6 | — | combat/Combat.ts |
| 105 | `PERK_THIEF` | Thief | 1 | 3 | — | — | skills.ts |
| 106 | `PERK_WEAPON_HANDLING` | Weapon Handling | 1 | 12 | ST<7, AG≥5 | — | combat/Combat.ts, combat/hitChance.ts |
| 107 | `PERK_VAULT_CITY_TRAINING` | Vault City Training | ∞ (−1) | — | — | Doctor≥75 | skills.ts |
| 108 | `PERK_ALCOHOL_RAISED_HIT_POINTS` | Alcohol Raised hit points | ∞ (−1) | — | — | — | player.ts |
| 109 | `PERK_ALCOHOL_RAISED_HIT_POINTS_II` | Alcohol Raised hit points II | ∞ (−1) | — | — | — | — |
| 110 | `PERK_ALCOHOL_LOWERED_HIT_POINTS` | Alcohol Lowered hit points | ∞ (−1) | — | — | — | player.ts |
| 111 | `PERK_ALCOHOL_LOWERED_HIT_POINTS_II` | Alcohol Lowered hit points II | ∞ (−1) | — | — | — | — |
| 112 | `PERK_AUTODOC_RAISED_HIT_POINTS` | Autodoc Raised hit points | ∞ (−1) | — | — | — | player.ts |
| 113 | `PERK_AUTODOC_RAISED_HIT_POINTS_II` | Autodoc Raised hit points II | ∞ (−1) | — | — | — | — |
| 114 | `PERK_AUTODOC_LOWERED_HIT_POINTS` | Autodoc Lowered hit points | ∞ (−1) | — | — | — | player.ts |
| 115 | `PERK_AUTODOC_LOWERED_HIT_POINTS_II` | Autodoc Lowered hit points II | ∞ (−1) | — | — | — | — |
| 116 | `PERK_EXPERT_EXCREMENT_EXPEDITOR` | Expert Excrement Expeditor | ∞ (−1) | — | — | — | skills.ts |
| 117 | `PERK_WEAPON_ENHANCED_KNOCKOUT` | Weapon Enhanced Knockout | ∞ (−1) | — | — | — | combat/Combat.ts |
| 118 | `PERK_JINXED` | Jinxed | ∞ (−1) | — | — | — | combat/Combat.ts, scripting.ts |

---

## 3. Perk & Trait Script Opcodes

Vanilla FO2 has no `has_perk` / `add_perk` opcodes — scripts use `has_trait` / `critter_add_trait` / `critter_rm_trait` with `TRAIT_PERK`.

| Opcode | Intrinsic | argc | CE | DH2 (`src/scripting.ts`) |
|---|---|---|---|---|
| `0x80F3` | `has_trait(type, obj, id)` | 3 | `opHasTrait` | TRAIT_PERK (0): rank on `perkRankOwner`; TRAIT_OBJECT (1): AI packet, team, rotation, sex, visibility, poison, radiation, inventory weight; TRAIT_TRAIT (2): selected trait |
| `0x8102` | `critter_add_trait(obj, type, id, amount)` | 4 | `opCritterAddTrait` | TRAIT_PERK: ranks on `perkRankOwner` + `perkApplyEffect`; TRAIT_OBJECT: AI packet / team |
| `0x8103` | `critter_rm_trait(obj, type, id, value)` | 4 | `opCritterRemoveTrait` | TRAIT_PERK: removes ranks + `perkApplyEffect(−1)` |

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

**DH2 `src/skills.ts`** implements `perkGetSkillModifier(perks, skill)` with equivalent logic; Ghost's light check is in `object/Critter.ts` (sneak).

### 4.2 CE `traitGetSkillModifier(traits[], skill)` — `trait.cc:284`

Called from `skillGetValue()` for any critter. Returns total trait bonus for a skill. See §1.4 for the full table.

**DH2 `src/skills.ts`** implements `traitGetSkillModifier(traits, skill)` with equivalent logic.

### 4.3 CE `traitGetStatModifier(trait, stat)` — `trait.cc:180`

See §1.3. DH2 applies the derived-stat parts live in `Player.getStat`, the SPECIAL parts on the base (§1.1).

### 4.4 CE `perkAddEffect(critter, perk)` — `perk.cc:554`

Bonus stat layer `+= statModifier`; `HERE_AND_NOW` grants the XP to the next level; `maxRank == −1` perks add `stats[0..6]`. DH2 has no separate bonus layer — `perkApplyEffect` writes the base stats (sign −1 for `perkRemoveEffect`); armor perks swap via `armorPerkSwap` (CE `_adjust_ac`).

---

## 5. Character Creation

- Max **2 traits** (`TRAITS_MAX_SELECTED_COUNT`), enforced in `ui_character/creator.ts`; Mutate! swaps one later (`ui_character/perkModal.ts` runMutate, CE `perkDialogHandleMutatePerk`).
- Tag! (CE 51) adds a 4th tag slot without the +20 (`SkillSet.hasTagPerk`, set by `applyPerk`).
- Books (`_obj_use_book`, `object/Obj.ts` useBook): +(100 − skill)/10 per read, ×1.5 with Comprehension, 3600 × (11 − INT) game ticks.

---

## 6. Known Gaps

| # | Area | CE | DH2 |
|---|---|---|---|
| 1 | Bonus stat layer | Perk/drug bonuses live in a separate layer | DH2 writes base stats (equivalent while effects are applied/removed symmetrically) |
| 2 | Perks of non-party NPCs | Share the dude's rank array (CE quirk) | Same (`perkRankOwner`) — kept for fidelity |

Everything else in this doc is implemented. <!-- audited: 2026-10-18 -->
