# CE parity audit — stats / skills / perks / traits / critter / reaction / random

Scope: CE files `critter.cc`, `stat.cc`, `skill.cc`, `perk.cc`, `trait.cc`, `reaction.cc`, `random.cc`
(+ their `.h` / `*_defs.h`); DH2 files `src/char.ts`, `src/skills.ts`, `src/statIds.ts`, `src/player.ts`,
`src/object/Critter.ts`, `src/critter/lifecycle.ts`, `src/skillUse.ts`, `src/perks/{perks,cePerks,perks.data}.ts`,
`src/random.ts`, `src/util.ts` (roll helpers), `src/radiation.ts`, `src/drugs.ts`, `src/party.ts`,
`src/combat/{whoHitMe,results,actionPoints,Combat}.ts`, `src/scripting.ts` (stat / poison / pc-stat opcodes),
`src/ui_pipboy/shell.ts`, `src/map/mapLoader.ts`. Audited 2026-10-24.

Method: every function in the seven CE files listed and matched; data tables machine-diffed where
possible (`gPerkDescriptions` vs `cePerks.ts` CE_PERKS + CE_PERK_REQS: **all 119 rows identical**;
`gSkillDescriptions` and `gStatDescriptions` vs `skills.ts` checked by hand).

## Summary

Counts are per table row (trivial getters / load-save / msg-init triplets are grouped into one row;
~167 CE functions in 132 rows).

| Status | Rows |
|---|---|
| ✅ MATCH | 88 |
| ⚠️ DIFFERS | 13 |
| 🟡 PARTIAL | 14 |
| ❌ MISSING | 3 |
| 🚫 N/A | 14 |
| **Total rows** | **132** |

Top findings (by severity):

1. **STAT-01 (HIGH, NEW)** — DH2 has no CE bonus-stat layer for SPECIAL: drugs, radiation, armor perks and
   Gain-SPECIAL perks write the *base*. CE derives Max HP, level-up HP and level-up skill points from
   `critterGetBaseStatWithTraitModifier` (base + trait only), so in DH2 Buffout/radiation/Power Armor/Gain
   Strength/Gain Endurance change **Max HP live**, and a level gained under Mentats/Buffout (or with Gain
   Endurance/Intelligence) grants permanently more SP/HP than CE.
2. **SKILL-01 (HIGH, NEW)** — NPC/proto skills are `defaultValue` too low: `SkillSet.get` treats the proto's raw
   invested points as `startValue + invested` (correct only for the player's own SkillSet). Every non-player
   critter loses 5–30 points (Unarmed −30, Melee −20, Lockpick/Traps −10, Small Guns/Doctor/Sneak −5), which
   feeds AI to-hit, party-member skill rolls (`skillRoll` best-of-party), catch-stealing, barter, etc.
3. **TRAIT-01 (MED, NEW)** — Fast Metabolism zeroes Radiation/Poison Resistance *entirely* (incl. Rad-X and
   Vault City Inoculations); CE only subtracts the derived base (bonus + VCI remain).
4. **TRAIT-02 (MED, NEW)** — Small Frame carry penalty uses DH2 base STR (includes Bruiser/Gifted, drugs,
   Gain Strength, Power Armor); CE uses the raw proto base STR. Also the overload-AP penalty ignores the Small
   Frame carry modifier (`Critter.getStat('AP')` reads `stats.get('Carry')`).
5. **CRIT-01 (MED, NEW)** — `kill_critter` / `kill_critter_type` / poison & radiation deaths run the victim's
   `destroy_p_proc` (DH2 `critterKill(useScript=true)`); CE `critterKill` never runs it (only combat
   `_damage_object` and `_combatKillCritterOutsideCombat` do), and it removes the script (`sid = -1`).
6. **CRIT-02 (MED, NEW)** — `critterKill` doesn't `partyMemberRemove` the dead critter: a dead companion stays
   in `gParty`.
7. **RAD-01 (MED, NEW)** — radiation HP penalty/recovery goes through `modifyBase('HP')`, not
   `critterAdjustHitPoints`: the 7-day recovery adds up to +20 HP **uncapped above Max HP**.
8. **STAT-02 (MED, NEW)** — derived stats with a perk/trait/radiation delta on the base clamp *after* the delta
   (Melee min 1, Healing Rate min 1): Bonus HtH Damage with ST ≤ 5 gives nothing; Faster Healing with EN ≤ 2
   gives +1 instead of +2. CE adds the bonus to `max(ST−5,1)` / `max(EN/3,1)`; table mins are 0.
9. **CRIT-03 (MED, NEW)** — no `scrname.msg`: CE `critterGetName` prefers `scrname.msg` 101+scriptIndex over
   the proto name.
10. **PERK-01 (LOW, NEW)** — `perks.data.ts` PERKS has stale `maxRanks`/`minLevel` (Healer/Lifegiver/Snakeater
    max 3 vs CE 2; 25 min-levels wrong; enum comments misnumbered from 33). Selection uses the CE tables, so
    only UI text and the no-perk.msg fallback are affected.

## Function table

### random.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| randomInit | src/random.ts:100 `randomInit` | ✅ | | srand(time) → seed from MSVC-style `rand()` → chi-square self-test. |
| _roll_reset_ / randomReset / randomExit / randomSave / randomLoad | — | 🚫 | | All no-ops in CE (RNG state is not saved). |
| randomRoll | src/util.ts:142 `randomRoll` | ✅ | | `delta = difficulty − d100`, howMuch = delta. |
| randomTranslateRoll (static) | src/util.ts:146-161 (inline) | 🟡 | LOW | Day-1 crit lockout, `-delta/10` / `delta/10 + critMod` (trunc) match. sfall `RemoveCriticalTimelimits` option not supported (CE reads it from ddraw.ini). |
| randomBetween | src/random.ts:64 | ✅ | | Incl. swapped-range branch and out-of-range fallback. |
| getRandom (static) | src/random.ts:35 | ✅ | | Park-Miller + 32-slot shuffle, identical arithmetic. |
| randomSeedPrerandom | src/random.ts:76 | ✅ | | `-1` → CRT rand. |
| randomInt32 (static) | src/random.ts:20 `crtRand` | ✅ | | MSVC LCG (CE on Windows); platform-dependent in CE anyway. |
| randomSeedPrerandomInternal (static) | src/random.ts:52 | ✅ | | `_iv[0]` never written, reproduced. |
| randomGetSeed (static) | `Date.now()` in randomInit | 🚫 | | compat_timeGetTime → Date.now. |
| randomValidatePrerandom (static) | src/random.ts:90 | ✅ | | Logs only. |

### reaction.cc

| CE function | DH2 counterpart | Status | Sev | Notes |
|---|---|---|---|---|
| reactionSetValue | src/combat/whoHitMe.ts:43 (inline LVAR 0 write) | ✅ | | Only caller in scope (`_critter_set_who_hit_me`). |
| reactionTranslateValue | inline: src/scripting.ts:2475, src/ui_barter/screen.ts:239 | ✅ | | >10 good, >−10 neutral, else bad. |
| _reaction_influence_ | src/scripting.ts:2504 `reaction_influence` | ✅ | | Returns 0. |
| reactionGetValue | inline LVAR 0 reads | ✅ | | Missing LVAR → −1 (dialogue) / 0 (barter); both map to neutral, as CE's −1. |

### trait.cc

| CE function | DH2 counterpart | Status | Sev | Notes |
|---|---|---|---|---|
| traitsInit / traitsExit | message loading (`getMessage('trait', …)`) | 🚫 | | msg-file plumbing. |
| traitsReset | src/player.ts:47 `resetForNewGame` (`traits = []`) | ✅ | | |
| traitsLoad / traitsSave | Player serialization (`traits`) | ✅ | | |
| traitsSetSelected | src/player.ts:84 `setTraits` | 🟡 | LOW | SPECIAL parts are baked into the base and swapped (see TRAIT-03); `applyCreationStats` clamps the baked base to 10, so a base-10 stat + Gifted loses the point permanently if the trait is later removed by Mutate! (CE keeps base 10, shows 10). |
| traitsGetSelected | `player.traits` | ✅ | | |
| traitGetName / traitGetDescription / traitGetFrmId | ui_character (trait.msg 100+/200+, intrface ids) | 🚫 | | UI text/art — chareditor audit. |
| traitIsSelected | `traits.includes(name)` | ✅ | | |
| traitGetStatModifier | src/player.ts:119-169 `Player.getStat` + base for SPECIAL | ⚠️ | MED | Bruiser AP, Heavy Handed, Kamikaze (AC→0 of non-armor part; armor added separately — equivalent), Sequence, Fast Metabolism HR, Finesse match. **Differs:** Small Frame carry (TRAIT-02), Fast Metabolism rad/poison (TRAIT-01). |
| traitGetSkillModifier | src/skills.ts:265 | ✅ | | Gifted −10 all; Good Natured −10 combat / +15 FA, Doc, Speech, Barter. |

### perk.cc

| CE function | DH2 counterpart | Status | Sev | Notes |
|---|---|---|---|---|
| perksInit / perksExit | perk.msg via `perkNameById` (src/perks/cePerks.ts:262) | 🚫 | | msg plumbing; names 101+id, descriptions 1101+id match. |
| perksReset | src/player.ts:46 (`perks = []`) | ✅ | | Party members' ranks: see party audit. |
| perksLoad / perksSave | perks arrays serialized with the critters | ✅ | | |
| perkGetRankData (static) | `player.perks` / scripting `perkRankOwner` | ✅ | | Ranks = occurrences in `perks[]`. |
| perkCanAdd (static) | src/perks/perks.ts:62 | ✅ | | All branches incl. GVAR flag 0x4000000, negative bounds (CE's `gvar >= value1` quirk kept), AND/OR/FIRST_ONLY, SPECIAL `<`/upper bounds via `getStat` (critterGetStat). Tables identical to CE (diffed). |
| perkResetRanks (static) | — | ✅ | | Implicit (new arrays). |
| perkAdd | src/perks/perks.ts:120 `applyPerk` (after `getValidPerks`) | 🟡 | LOW | `applyPerk` checks max rank from `perks.data.ts` (PERK-01) not CE; real gate is `perkCanAdd` in the modal. Lifegiver/Educated immediate effects added here (CE does them in character_editor — documented). |
| perkAddForce | scripting `critter_add_trait` (perk) path | ✅ | | (unverified in detail — script audit). |
| perkRemove | perkApplyEffect(…, −1) | 🟡 | LOW | HERE_AND_NOW removal (`pcSetStat(XP − bonus)` → level-down) not handled ("handled by caller"; no caller does). |
| perkGetAvailablePerks | src/perks/perks.ts:19 `getValidPerks` | ✅ | | Falls back to `perks.data.ts` minimums when perk.msg is missing. |
| perkGetRank / perkHasRank | src/perks/perks.ts:105 `getPerkRank`, `Critter.hasPerk` | ✅ | | |
| perkGetName / perkGetDescription / perkGetFrmId | cePerks.ts:262, perks.ts:33 `perkDefById` | ✅ | | frmId from CE_PERK_REQS[6]. PERKS overrides (PERK-01). |
| perkAddEffect | src/perks/cePerks.ts:294 `perkApplyEffect(+1)`; HERE_AND_NOW in perks.ts:146 | ⚠️ | MED | Stat modifier / maxRank −1 SPECIAL deltas land on the **base** (STAT-01, STAT-02). Gain-SPECIAL perks put +1 on the base (CE: live +1 in critterGetStat, not in base-with-trait). HERE_AND_NOW: CE `pcAddExperienceWithOptions(bonus, false)` — no party level-ups; DH2 `addExperience` levels party members too (LOW). |
| perkRemoveEffect | perkApplyEffect(−1) | 🟡 | LOW | As above; HERE_AND_NOW XP not removed. |
| perkGetSkillModifier | src/skills.ts:182-249 | ✅ | | All 14 perks + Ghost light > 45875 on gDude; perkHasRank (once per perk). |

### stat.cc

| CE function | DH2 counterpart | Status | Sev | Notes |
|---|---|---|---|---|
| statsInit / statsExit | stat.msg via getMessage | 🚫 | | |
| statsReset / pcStatsReset | src/player.ts:44 `newPlayerStats()` | ✅ | | Level 1, XP 0, SP 0 at creation (applyCreationStats). |
| statsLoad / statsSave | StatSet.serialize | ✅ | | |
| critterGetStat | src/object/Critter.ts:321 `getStat` + src/player.ts:119 + src/char.ts:291 `StatSet.get` + Combat.ts:3001 (AC) | ⚠️ | MED | Blind −5 PE, overload AP `−(excess/40+1)`, age + years, unused-AP/HtH-Evade AC, Adrenaline Rush, Mirrored Shades, Alcohol/Autodoc HP, Dermal/Phoenix (else-if), VC Inoculations all present. **Differs:** (a) clamp order — DH2 clamps base+bonus to [min,max] *before* blind/overload/perk deltas (CE clamps once at the end; only matters when base+bonus is out of range); (b) overload uses `stats.get('Carry')` without the Small Frame trait (TRAIT-02); (c) Gain-SPECIAL in base (STAT-01). |
| critterGetBaseStatWithTraitModifier | `stats.getBase()` (traits baked) | ⚠️ | HIGH | DH2 base also contains drugs, radiation, armor perks, Gain-SPECIAL perks → STAT-01. |
| critterGetBaseStat | `stats.getBase()` | ⚠️ | MED | Same contamination (used by Kamikaze / Small Frame / Fast Metabolism). |
| critterGetBonusStat | src/char.ts:318 `getBonus` | 🟡 | MED | Only sfall `set_*_extra_stat` writes it; drugs/perks/radiation/armor don't (STAT-01). |
| critterSetBaseStat | src/scripting.ts:2307 `setCritterStatPart`, 1103 `set_critter_stat` | ⚠️ | LOW | `set_critter_stat` refuses derived 7–32 ✓, routes 36/37 ✓; but SPECIAL is stored without CE's −2/−3 range refusal (value−trait outside 1..10 is rejected in CE), and HP (35) uses `modifyBase` — no cap at Max HP and no `critterKill` at ≤0 (CE `critterAdjustHitPoints`). `set_pc_base_stat` has no derived-stat refusal. |
| critterIncBaseStat / critterDecBaseStat | character creator SPECIAL buttons | ✅ | | chareditor audit. |
| critterSetBonusStat | src/char.ts:322 `setBonus` | 🟡 | MED | No `critterUpdateDerivedStats` needed (DH2 derives live), but HP/poison/rad routing for 35–37 missing in `set_*_extra_stat` (statMap name only). |
| protoCritterDataResetStats | `StatSet` defaults (`statDependencies.defaultValue`) | ✅ | | SPECIAL 5, Age 25. |
| critterUpdateDerivedStats | src/skills.ts:117-128 live dependencies | ⚠️ | HIGH | Formulas match (`15+ST+2EN`, `AG/2+5`, `AG`, `max(ST−5,1)`, `25ST+25`, `2PE`, `max(EN/3,1)`, `LK`, 0, `2EN`, `5EN`) but Max HP reads live ST/EN (STAT-01) and min/max clamp after deltas (STAT-02). |
| statGetName / statGetDescription / statGetValueDescription / statGetFrmId | ui_character/statPanels.ts | 🚫 | | UI. |
| pcGetStat | `stats.get('Level'/'Experience'/…)`, `skills.skillPoints` | ✅ | | |
| pcSetStat | src/scripting.ts:1566 `set_pc_stat` (sfall) | 🟡 PARTLY FIXED (2026-10-26) | LOW | CE: XP ≥ current → set then `pcAddExperienceWithOptions(0)` (level-ups), lower → `pcSetExperience` (level down, HP loss); out-of-range rejected (−2/−3). DH2 sets XP/level directly and clamps. Vanilla scripts don't call it. — **2026-10-26:** XP: level-ups or pcSetExperience; −2 below 0 (the other stats keep DH2's clamps). |
| pcGetExperienceForNextLevel / pcGetExperienceForLevel | src/player.ts:236 `xpForLevel` | ✅ | LOW | Same values. CE returns −1 for level ≥ 99 (so level 98→99 is free in CE); unreachable in practice. |
| pcStatGetName / pcStatGetDescription | stat.msg 400+/500+ | 🚫 | | |
| statRoll | src/combat/Combat.ts:134, whoHitMe.ts:29, radiation.ts:138 (inline d10) | ✅ | | d10 ≤ stat + modifier. |
| pcAddExperience / pcAddExperienceWithOptions | src/player.ts:240 `addExperience` | ⚠️ | MED | Swift Learner `rank*5*xp/100` (trunc) ✓, level loop ✓, msg 600 ✓, levelup sound ✓, HP/level `EN/2+2 + 4·Lifegiver` ✓ formula, party `incLevels` ✓. **Differs:** HP per level reads contaminated base EN (STAT-01); SP + perk flag granted at level-up instead of when the editor opens (`characterEditorUpdateLevel`, chareditor scope); no `DUDE_STATE_LEVEL_UP_AVAILABLE` (HUD LEVEL shows while SP > 0, src/ui_hud.ts:262); `a2=false` (Here and Now) not honoured; negative XP lets the base go below 0 (get() clamps). |
| pcSetExperience | — | ✅ FIXED (2026-10-26) | LOW | Level-down path absent (only reached by pcSetStat with lower XP / Here-and-Now removal). — **2026-10-26:** ported (setExperienceLower). |

### skill.cc

| CE function | DH2 counterpart | Status | Sev | Notes |
|---|---|---|---|---|
| skillsInit / skillsExit | skill.msg via getMessage | 🚫 | | |
| skillsReset | src/skillUse.ts:72 `resetSkillUsage`; tags reset with new SkillSet | ✅ | | |
| skillsLoad / skillsSave | SkillSet.serialize (tags) | ✅ | | |
| protoCritterDataResetSkills | new SkillSet() | ✅ | | |
| skillsSetTagged / skillsGetTagged | SkillSet.tag / `tagged` | ✅ | | |
| skillIsTagged | src/char.ts:198 | ✅ | | |
| skillGetValue | src/char.ts:75 `SkillSet.get`, Critter.ts:308 `getSkill` | ⚠️ | HIGH | Player path matches (tag doubles invested, +20 unless Tag!'s 4th slot, trait/perk/difficulty, cap 300). **NPC path wrong by `defaultValue`** (SKILL-01). Stat terms use `stats.get` (base+bonus, no Player.getStat perks like Adrenaline/Mirrored Shades/blind) — CE uses critterGetStat (LOW). |
| skillGetDefaultValue | `skillDependencies[s].startValue` | ✅ | | Table matches CE (incl. Gambling 0). |
| skillGetBaseValue | src/char.ts:66 `getBase` | ⚠️ | HIGH | Returns startValue+invested for the player but raw invested for proto critters (SKILL-01). |
| skillAdd | src/char.ts:131 `incBase` | ✅ | | SP>0, value<300, cost by effective value. |
| skillAddForce | `incBase(…, useSkillPoints=false)`, Obj.ts:225 (book reading) | ✅ | | |
| skillsGetCost | src/skills.ts:198 `skillImprovementCost` | ✅ | | 1/2/3/4/5/6 at 101/126/151/176/201. |
| skillSub | src/char.ts:156 `decBase` | ✅ | | Refund via post-decrement effective value is equivalent to CE's cost(value−1) + tagged bracket correction (checked all bracket edges). |
| skillSubForce | `decBase(…, false)` | ✅ | | |
| skillRoll | src/skillUse.ts:114 (also src/util.ts:169 simpler variant) | 🟡 | LOW | skillUse.ts version matches (party best-in-skill + own-best-skill test, Steal excluded, Steal +30 while really sneaking, crit chance of roller). `util.ts skillRoll` (used by Obj.ts:172 trap disarm) lacks the party substitution. |
| skillGetName / skillGetDescription / skillGetAttributes / skillGetFrmId | ui_character | 🚫 | | |
| _show_skill_use_messages (static) | src/skillUse.ts:96 | ✅ | | XP 25/50/25/25/25/100, field_28 (+abs critMod) for Lockpick/Steal/Traps, msg 505. |
| skillUse | src/skillUse.ts:181 | ✅ | | First Aid / Doctor / Repair flows, robot checks, critChance passed as the *modifier* (CE quirk) kept, damage-flag loop with repeated XP, daily slots, time cost 1800 / 3600·n / 1800·n, messages 500–592/1101. Palette fades omitted (documented cosmetic). Sneak toggled here (CE does it in `_action_skill_use`) — equivalent at call sites. |
| skillsPerformStealing | src/skillUse.ts:423 `performSteal` | 🟡 | LOW | Formula matches (−stealCount+1, −4·size, −25 front, +20 prone, cap 95, party = crit success, catch = target Steal − mod). Non-critter target branch (`30 − mod`) absent (DH2 only steals from critters). |
| skillGetGameDifficultyModifier | src/skills.ts:213 | ✅ | | 12 skills, Easy +20 / Hard −10 from `game_difficulty` (not combat difficulty). |
| skillGetFreeUsageSlot (static) | src/skillUse.ts:50 | ✅ | | |
| skillUpdateLastUse | src/skillUse.ts:61 | ✅ | | |
| skill_use_slot_clear | src/skillUse.ts:72 | ✅ | | |
| skillsUsageSave / skillsUsageLoad | src/skillUse.ts:75/78 | ✅ | | |
| skillsGetGenericResponse | — | ❌ | LOW | `randomBetween(0, count)` msg 1100+0..4 (dude) / 1000+0..5. Used by proto_instance `_obj_use_skill_on` fallbacks (out of scope; unverified whether DH2 shows these elsewhere). |

### critter.cc

| CE function | DH2 counterpart | Status | Sev | Notes |
|---|---|---|---|---|
| critterInit / critterExit | — | 🚫 | | msg plumbing (but see critterGetName). |
| critterReset | src/gameReset.ts:43 (`killCounts.clear()`), Player.resetForNewGame | ✅ | | Dude name reset handled by the creator. |
| critterLoad / critterSave | saveload (sneakWorking not serialized; dude proto data = Player.serialize) | 🟡 | LOW | `_sneak_working` is not saved; reloading while sneaking restarts the roll (unverified). |
| critterProtoDataCopy | — | 🚫 | | memcpy helper. |
| critterGetName | src/object/Critter.ts:210 (`pro_crit` name only) | ❌ | MED | CRIT-03: no `scrname.msg` lookup (101 + scriptIndex) before the proto name. |
| dudeSetName / dudeResetName | `player.name` (creator) | ✅ | | 32-char limit enforced by the creator UI (unverified). |
| critterGetHitPoints | `getStat('HP')` | ✅ | | |
| critterAdjustHitPoints | scattered: skillUse.ts:165, drugs.ts:113, scripting.ts:1676, mapLoader, poisonDecayEvent | 🟡 | MED | Most call sites cap at Max HP and kill at ≤0, but radiation (RAD-01) and `set_critter_stat(35)` use raw `modifyBase('HP')`; drugs.ts clamps to ≥0 then kills separately. No single helper. |
| critterGetPoison | `poisonLevel` | ✅ | | |
| critterAdjustPoison | src/scripting.ts:292 `adjustPoison` | ✅ | | Dude only, resistance trunc, early-out, re-schedule `10·(505−5p)`, msgs 3000/3002/3003, indicator refresh. |
| poisonEventProcess | src/scripting.ts:322 `poisonDecayEvent` | ✅ | | −2 poison, −1 HP (kills at 0), msg 3001, bail at HP ≤ 5. |
| critterGetRadiation | `radiationLevel` | ✅ | | |
| critterAdjustRadiation | src/radiation.ts:67 | ✅ | | Resistance (×amount/100 trunc), CRITTER_RADIATED, Geiger in either hand + on, 1009/1008, ≥10 → 1007, floor 0. |
| _critter_check_rads | src/radiation.ts:126 `checkRads` | ✅ | | Level thresholds, END roll with ±modifiers, old-level from queue, 4–18 h event, flag cleared. |
| _get_rad_damage_level (static) | inline in checkRads | ✅ | | |
| _clear_rad_damage | inline in radiationEventProcess | ✅ | | |
| _process_rads | src/radiation.ts:151 `processRads` | ⚠️ | MED | Table, level−1 indexing, msgs 1000+n / 3003, death check match. Effects go on the base (STAT-01) and HP via `modifyBase` — recovery can push HP above Max HP and the HP loss can drop HP ≤ 0 without CE's kill-in-adjust (DH2 has an explicit HP ≤ 0 kill instead, equivalent). RAD-01. |
| radiationEventProcess | src/radiation.ts:187 | ✅ | | 7-day recovery, clears others (undoing pending recoveries), returns bail. |
| radiationEventRead / radiationEventWrite | src/radiation.ts:113 `restoreRadiationEvent` (userdata string) | ✅ | | |
| critterGetDamageType | — (unverified) | 🟡 | LOW | Proto `damageType` (unarmed damage type) — not found by grep in Critter; combat audit. |
| critter_kill_count_clear | killCounts.clear() | ✅ | | |
| killsIncByType | src/critter/lifecycle.ts:93-96 | ✅ | | Kills by player or player's team. |
| killsGetByType | killCounts.get | ✅ | | |
| killsLoad / killsSave | saveload (killCounts) | ✅ | | (unverified field name). |
| critterGetKillType | src/object/Critter.ts:390 `killType` getter | ⚠️ | LOW | Dude returns 19 (used as the player critical table index, Combat.ts:128); CE returns KILL_TYPE_MAN/WOMAN by gender. No vanilla consumer of the dude's kill type in scope; flagged for combat audit. |
| killTypeGetName / killTypeGetDescription | ui_character kills list (proto.msg 1450/1469) | 🚫 | | UI. |
| _critter_heal_hours | src/map/mapLoader.ts:93 | ✅ | | `14·(hours/3)` capped, fleeing cleared. |
| _critterClearObjDrugs (static) | gameTick.ts:251 (events of dead objects dropped) | ✅ | | |
| critterKill | src/critter/lifecycle.ts:71 | 🟡 | MED | HP 0, DAM_DEAD, single-frame corpse, prone fall, player death ending ✓. **Differs:** runs `destroy_p_proc` (CRIT-01); no `partyMemberRemove` (CRIT-02); script not removed (corpse keeps look/description procs — unverified impact); `itemDestroyAllHidden`, light-off and `OBJECT_NO_BLOCK`/flat handled elsewhere (`blocks()` uses `dead`; light/hidden items unverified). |
| critterGetExp | Combat.ts:1710 (`pro.extra.XPValue`) | ✅ | | |
| critterIsActive | inline checks (KO/dead/lose-turn) | ✅ | | (unverified everywhere). |
| critterIsDead | `dead` flag / HP ≤ 0 checks | ✅ | | Map-start 0-HP critters marked dead (Critter.ts:189). |
| critterIsCrippled | src/skillUse.ts:162 | ✅ | | DAM_CRIP includes DAM_BLIND (obj_types.h:153) ✓. |
| _critter_is_prone | src/combat/results.ts `critterIsProne` | ✅ | | |
| critterGetBodyType | `pro.extra.bodyType` | ✅ | | |
| gcdLoad / gcdSave / protoCritterDataRead / protoCritterDataWrite | premade.ts / proto JSON | 🚫 | | File formats (pipeline / premade audit). |
| dudeDisableState / dudeEnableState / dudeToggleState / dudeHasState | `isSneaking`, `addictedState` flags; skillUse.ts:395 `toggleSneak` | ✅ | | Sneak enable fires the first roll at once ✓; LEVEL_UP state see pcAddExperience. |
| sneakEventProcess | src/skillUse.ts:356 `scheduleSneakEvent` | ✅ | | Intervals 100…600, party-best roller. |
| _critter_sneak_clear | src/skillUse.ts:388 `sneakClear` | ✅ | | |
| dudeIsSneaking | `isSneaking && sneakWorking` | ✅ | | |
| knockoutEventProcess | src/combat/results.ts:124 | ✅ | | In combat: stands at next turn (CE sets ENGAGING maneuver; DH2 Combat.ts:2917). |
| _critter_wake_clear | src/combat/results.ts:115 | ✅ | | |
| _critter_set_who_hit_me | src/combat/whoHitMe.ts:34 | ✅ | | Team test, INT roll −1, party exemption (dude counted), reaction −3. |
| _critter_can_obj_dude_rest | src/ui_pipboy/shell.ts:392 | ✅ | | |
| critterGetMovementPointCostAdjustedForCrippledLegs | src/combat/actionPoints.ts:62 | ✅ | | ×4 / ×8. |
| critterIsEncumbered | Obj.ts:1042 / Critter.ts:327 (inline) | 🟡 | LOW | Uses `getStat('Carry')` in Obj (✓) but `stats.get('Carry')` in the AP penalty (no Small Frame). |
| critterIsFleeing | `fleeing` flag | ✅ | | |
| _critter_flag_check / critter_flag_set / critter_flag_unset | `pro.extra.flags` reads (lifecycle.ts:110, mapLoader) | ✅ | | set/unset only used by `radiated` (own field) — fine. |

## Detailed findings

### STAT-01 — No bonus-stat layer: Max HP, level-up HP and level-up SP read drug/radiation/perk/armor SPECIAL — **FIXED 2026-10-24 (PA4)**
- **CE:** `stat.cc:554 critterUpdateDerivedStats` — `baseStats[MAX_HP] = baseWithTrait(ST) + 2·baseWithTrait(EN) + 15`;
  `stat.cc:731 pcAddExperienceWithOptions` / `pcSetExperience` — `hpPerLevel = baseWithTrait(EN)/2 + 2 + 4·Lifegiver`;
  `character_editor.cc characterEditorUpdateLevel` — `sp += baseWithTrait(IN)·2`. Drugs (`item.cc` →
  `critterSetBonusStat`), radiation (`critter.cc _process_rads` → bonus), armor perks (`perkAddEffect` → bonus,
  e.g. Powered Armor ST+3) and Gain-SPECIAL perks (live +1 in `critterGetStat`) never touch base-with-trait.
- **DH2:** `src/drugs.ts:110 adjustStat`, `src/radiation.ts:166`, `src/perks/cePerks.ts:288 adjust` all call
  `stats.modifyBase`; Gain-SPECIAL at `cePerks.ts:298`. `skills.ts:117 'Max HP'` derives from `this.get('STR'/'END')`;
  `player.ts:266/276` use `stats.getBase('INT'/'END')`.
- **Impact:** Buffout (+2 ST, +2 EN) raises Max HP by 6 while active; Power Armor +3; radiation sickness lowers
  Max HP; Gain Endurance gives +2 Max HP and +½ HP/level (CE: none — a known vanilla quirk). Levelling while on
  Mentats (+2 IN) gives +4 SP per level permanently; on Buffout +1 HP/level permanently. The `player.ts` comment
  "base INT (with traits, not drugs)" is false in practice.
- **Fix:** route drug / radiation / armor-perk / perk-statMod / maxRank −1 deltas through `StatSet.bonusStats`
  (`setBonus`), keep Gain-SPECIAL as a live +1 in `Player.getStat`, and compute Max HP from `getBase` only.
  `wiki/perks_traits.md:299` and `wiki/character_stats.md:443` document "no separate bonus layer" but not these
  consequences. **NEW.**

### STAT-02 — Derived-stat clamp applied after perk/trait/radiation deltas — **FIXED 2026-10-25**
- **CE:** derived base = `max(ST−5,1)` / `max(EN/3,1)`; bonus (Bonus HtH Damage +2/rank, Faster Healing +2/rank,
  radiation HR −3/−5/−10) added in `critterGetStat`, then clamped to the table range (Melee 0..500, Healing Rate 0..30).
- **DH2:** `skills.ts:121/124` — `Melee` min 1, `Healing Rate` min 1, the perk delta sits in the base, so
  `clamp(1, …, base + STR − 5)`.
- **Impact:** ST ≤ 5 characters get no melee bonus from Bonus HtH Damage (CE: +2/+4/+6); EN 1–2 get +1 less HR;
  radiation can't lower HR below 1 (CE: 0). **Fix:** keep the `max(…,1)` in the formula and the delta outside it
  (bonus layer), table mins 0. **NEW.**

### SKILL-01 — Proto critters' skills are `defaultValue` points low — **FIXED 2026-10-24 (PA3)**
- **CE:** `skill.cc:230 skillGetValue` — `defaultValue + statModifier·(stat1+stat2) + skills[skill]·mult`, where
  `skills[]` is the proto's raw invested value (`tools/proto.py:246 readCritterSkills` stores exactly that).
- **DH2:** `src/char.ts:66 getBase` returns the raw proto value; `get()` computes `invested = base − startValue`
  and `value = startValue + statBonus + invested` = `statBonus + raw`.
- **Impact:** every NPC / companion / party member: Small Guns −5, Unarmed −30, Melee −20, Doctor −5, Sneak −5,
  Lockpick −10, Traps −10. Affects NPC to-hit, `skillRoll`'s party substitution, steal-catch rolls, barter
  (`npcBarter`), AI weapon choice, `has_skill` in scripts.
- **Fix:** in `SkillSet.fromPro`, store `startValue + raw` (consistent with the player representation), or
  track invested points separately. **NEW.**

### TRAIT-01 — Fast Metabolism removes all radiation/poison resistance — **FIXED 2026-10-25**
- **CE:** `trait.cc:262` — modifier `−critterGetBaseStat(RAD_RES)` / `−(POISON_RES)` (the derived 2·EN / 5·EN
  only); bonus (Rad-X +50 via drug bonus) and Vault City Inoculations (+10, added after) remain.
- **DH2:** `src/player.ts:167` — `return 0`.
- **Impact:** Rad-X does nothing for a Fast Metabolism character; Inoculations neither. **Fix:** subtract only the
  derived part (needs STAT-01's bonus layer, else `2·END`/`5·END`). **NEW.**

### TRAIT-02 — Small Frame carry penalty uses the wrong strength; overload AP ignores Small Frame — **FIXED 2026-10-25**
- **CE:** `trait.cc:243` — `−10·critterGetBaseStat(gDude, ST)` (raw proto base, no trait/bonus). Overload in
  `stat.cc:200` uses `critterGetStat(CARRY_WEIGHT)` (trait included).
- **DH2:** `src/player.ts:162` — `−10·stats.getBase('STR')` (includes Bruiser +2, Gifted +1, Buffout, Gain
  Strength, Powered Armor). `src/object/Critter.ts:327` overload uses `stats.get('Carry')` (no trait).
- **Impact:** Bruiser + Small Frame loses 20 lb more than CE; drugs lower carry weight; overloaded Small Frame
  characters lose fewer AP than CE. **Fix:** subtract the trait's ST from the base for the penalty; use
  `this.getStat('Carry')` in the overload branch. **NEW.**

### CRIT-01 — Script kills run destroy_p_proc — **FIXED 2026-10-25**
- **CE:** `critter.cc:818 critterKill` never runs SCRIPT_PROC_DESTROY; it `scriptRemove`s the sid. Only
  `combat.cc:4857 _damage_object` and `combat.cc:6018 _combatKillCritterOutsideCombat` run destroy_p_proc first.
  `opKillCritter` (`interpreter_extra.cc:2301`) / `kill_critter_type` → `critterKill` directly.
- **DH2:** `src/critter/lifecycle.ts:98` runs `Scripting.destroy` whenever `useScript !== false`; callers
  `scripting.ts:1541` (kill_critter), `:2718` (kill_critter_type), `:329` (poison), `drugs.ts:184`, `radiation.ts`.
- **Impact:** scripted kills fire karma / GVAR / "killed" bookkeeping in the victim's destroy_p_proc that CE
  skips (with `source_obj = 0`). **Fix:** pass `useScript=false` from the non-combat callers and drop the corpse's
  script like CE. **NEW.**

### CRIT-02 — Dead party members stay in the party — **FIXED 2026-10-24 (PA12)**
- **CE:** `critterKill` → `partyMemberRemove(critter)` first.
- **DH2:** `lifecycle.ts` never calls `gParty.removePartyMember`; `party.ts` has no dead filter (only some callers
  filter `!dead`, e.g. encounters.ts:254, party_member_list).
- **Impact:** dead companions remain in `getPartyMembers()` (map transitions, party-best skill rolls skip only
  hidden members, `party_member_count`, level-ups). **Fix:** remove from party in `critterKill`. **NEW**
  (cross-check with dialogue_party audit).

### RAD-01 — Radiation HP effect bypasses critterAdjustHitPoints — **FIXED 2026-10-25**
- **CE:** `_process_rads` → `critterSetBonusStat(STAT_CURRENT_HIT_POINTS, ±n)` → `critterAdjustHitPoints`
  (capped at Max HP; kill at ≤ 0).
- **DH2:** `src/radiation.ts:166` `modifyBase('HP', delta)`; `StatSet` clamps HP to 0..999 only.
- **Impact:** the 7-day recovery returns 5/15/20 HP even if the player healed in the meantime → HP above Max HP.
  **Fix:** use a capped HP adjust for the HP entry. **NEW.**

### CRIT-03 — critterGetName ignores scrname.msg — **FIXED 2026-10-25**
- **CE:** `critter.cc:235` — `scrname.msg` entry `101 + scriptIndex` (if non-empty) wins over `protoGetName`.
- **DH2:** `src/object/Critter.ts:210` — proto name (`pro_crit`) only; no `scrname` anywhere in src/ or tools/.
- **Impact:** script-specific critter names (look-at, combat messages, `obj_name`) can differ. Exact impact depends
  on scrname.msg contents (unverified). **Fix:** load scrname.msg and apply in `init()` when the critter has a
  script. **NEW.**

### TRAIT-03 / perkAddEffect Gain-SPECIAL — see STAT-01 (same root cause).

### critterGetStat / pcAddExperience MED items
- `a2 = false` (Here and Now) and missing `DUDE_STATE_LEVEL_UP_AVAILABLE` are LOW; SP-at-level-up timing is a
  chareditor question (`characterEditorUpdateLevel`) — **NEW** for the HUD LEVEL indicator (`ui_hud.ts:262` lights
  while SP > 0, CE lights from level-up until the editor is opened).

## DH2-only behaviour

- `randomSeedExact` (src/random.ts:84) and the draw counter/hook — debug-only for the story crawler.
- `util.ts rollSkillCheck` (bounded 0..95 helper) has no CE counterpart; `util.ts skillRoll` duplicates
  `skillUse.ts skillRoll` without the party substitution.
- `skillUse` toggles Sneak itself (CE: `actions.cc _action_skill_use`); `skillUse` returns the HP healed.
- `applyPerk` applies Lifegiver (+4 Max HP/HP) and Educated (+2 SP) immediately (CE: character editor).
- `Player.addExperience` hands out skill points and the perk flag at the level-up moment (CE: when the editor opens).
- `Critter.fromMapObject` marks map critters with 0 HP dead with DAM_DEAD (CE: `critterIsDead` is HP ≤ 0 — equivalent).
- Corpse auto-cleanup timer (`Config.engine.corpseTimeout`, lifecycle.ts:123) — not CE (off unless configured).
- Trait SPECIAL modifiers are baked into the base and swapped by `setTraits` (documented in perks_traits.md).
- `StatSet` stats for per-town reputation (`Rep_*`), `Karma`, `Skill Points` etc. — DH2 storage of CE GVARs/pc stats.
