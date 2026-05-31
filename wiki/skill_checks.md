# Skill Checks — DarkHarold2 / Fallout 2

See also [damage_formula.md](damage_formula.md) for hit-chance formula (combat skills feed directly into `attackDetermineToHit`, not a separate skill-use function).

CE refs: `skill.cc`, `random.cc`, `skill_defs.h`, `random.h`, `proto_instance.cc`  
DH2 refs: `src/skillUse.ts`, `src/skills.ts`, `src/util.ts`, `src/scripting.ts`

---

## 1. Base Roll Mechanic

CE ref: `random.cc:randomRoll`, `random.cc:randomTranslateRoll`

```
// skill.cc skillRoll()
skillValue = skillGetValue(critter, skill) + sneakBonus (if SKILL_STEAL + sneaking: +30)
delta = skillValue + modifier − randomBetween(1, 100)
roll  = randomTranslateRoll(delta, critter.STAT_CRITICAL_CHANCE)
```

`randomTranslateRoll` maps `delta` to one of four roll results:

```
if delta < 0:
    roll = ROLL_FAILURE
    // Secondary roll: upgrade to CRITICAL_FAILURE
    if randomBetween(1, 100) ≤ floor(|delta| / 10):
        roll = ROLL_CRITICAL_FAILURE

if delta ≥ 0:
    roll = ROLL_SUCCESS
    // Secondary roll: upgrade to CRITICAL_SUCCESS
    if randomBetween(1, 100) ≤ floor(delta / 10) + criticalSuccessModifier:
        roll = ROLL_CRITICAL_SUCCESS
```

**Critical-upgrade note:** CE does not fire the upgrade path until game day ≥ 1
(configurable via `SFALL_CONFIG_REMOVE_CRITICALS_TIME_LIMITS_KEY`).
DH2 (`src/util.ts:randomRoll`) always permits upgrades — no day-1 gate.

### Thresholds summary

| `delta` | Base result | Upgrade condition |
|---------|-------------|-------------------|
| < 0 | Failure | `d100 ≤ ⌊|delta| / 10⌋` → Critical Failure |
| ≥ 0 | Success | `d100 ≤ ⌊delta / 10⌋ + CritChance%` → Critical Success |

The greater the margin of failure, the higher the chance of a critical failure (10% per 10 points under).
The greater the margin of success, the higher the chance of a critical success (10% per 10 points over, plus the critter's Luck-based Critical Chance stat).

---

## 2. RollResult Enum

CE ref: `random.h` — `typedef enum Roll`  
DH2 ref: `src/util.ts` — `export enum RollResult`

| Value | CE name | DH2 name | Numeric code |
|-------|---------|----------|--------------|
| 0 | `ROLL_CRITICAL_FAILURE` | `RollResult.CriticalFailure` | 0 |
| 1 | `ROLL_FAILURE` | `RollResult.Failure` | 1 |
| 2 | `ROLL_SUCCESS` | `RollResult.Success` | 2 |
| 3 | `ROLL_CRITICAL_SUCCESS` | `RollResult.CriticalSuccess` | 3 |

---

## 3. Skill Value Computation (`skillGetValue`)

CE ref: `skill.cc:skillGetValue` (line ~230)

```
value = defaultValue
      + statModifier × (stat1 + stat2)   // stat2 is STAT_INVALID (-1) when unused
      + baseValue × baseValueMult         // baseValue = player's invested skill points
```

For the player only, additional adjustments are layered on top:

```
if skillIsTagged(skill):
    value += baseValue × baseValueMult   // double the invested-point contribution
    value += 20                          // flat tagged bonus (always, except 4th tag via Tag! perk)
value += traitGetSkillModifier(skill)
value += perkGetSkillModifier(critter, skill)
value += skillGetGameDifficultyModifier(skill)
value = min(300, value)                  // hard cap
```

### Skill base formulas (from `gSkillDescriptions[]`)

| Skill | defaultValue | stat1 | stat2 | statModifier | Formula |
|-------|-------------|-------|-------|--------------|---------|
| Small Guns | 5 | AGI | — | 4 | `5 + 4×AGI` |
| Big Guns | 0 | AGI | — | 2 | `2×AGI` |
| Energy Weapons | 0 | AGI | — | 2 | `2×AGI` |
| Unarmed | 30 | AGI | STR | 2 | `30 + 2×(AGI+STR)` |
| Melee Weapons | 20 | AGI | STR | 2 | `20 + 2×(AGI+STR)` |
| Throwing | 0 | AGI | — | 4 | `4×AGI` |
| First Aid | 0 | PER | INT | 2 | `2×(PER+INT)` |
| Doctor | 5 | PER | INT | 1 | `5 + PER + INT` |
| Sneak | 5 | AGI | — | 3 | `5 + 3×AGI` |
| Lockpick | 10 | PER | AGI | 1 | `10 + PER + AGI` |
| Steal | 0 | AGI | — | 3 | `3×AGI` |
| Traps | 10 | PER | AGI | 1 | `10 + PER + AGI` |
| Science | 0 | INT | — | 4 | `4×INT` |
| Repair | 0 | INT | — | 3 | `3×INT` |
| Speech | 0 | CHA | — | 5 | `5×CHA` |
| Barter | 0 | CHA | — | 4 | `4×CHA` |
| Gambling | 0 | LUK | — | 5 | `5×LUK` |
| Outdoorsman | 0 | END | INT | 2 | `2×(END+INT)` |

`baseValueMult` is 1 for all skills (each invested skill point is worth 1, or 2 for tagged).

### Tagged skills

- Tagging a skill doubles the return on invested points **and** adds a flat +20.
- The 4th tag (via the **Tag!** perk) does **not** grant the +20 bonus.
- Up to 4 skills can be tagged (`NUM_TAGGED_SKILLS = 4`).

### Book reading (`_obj_use_book`, proto_instance.cc ~762)

```
increase = floor((100 − skillGetValue(player, skill)) / 10)
if Comprehension perk: increase = floor(150 × increase / 100)
for i in range(increase): skillAddForce(player, skill)
// Time cost: 3600 × (11 − INT) seconds
```

Books apply to: Science, Repair, First Aid, Small Guns, Outdoorsman.
If the skill value is already at 100 or higher, `increase` ≤ 0 and the book has no effect.

### Game difficulty modifier

CE ref: `skill.cc:skillGetGameDifficultyModifier`  
DH2 ref: `src/skills.ts:skillGetGameDifficultyModifier`

Applied to the player's effective skill value (not the base):

| Difficulty | Modifier |
|------------|----------|
| Easy | +20 |
| Normal | 0 |
| Hard | −10 |

Affected skills: First Aid, Doctor, Sneak, Lockpick, Steal, Traps, Science, Repair, Speech, Barter, Gambling, Outdoorsman. Combat skills (Small Guns through Throwing) are **not** affected.

**DH2 divergence:** `src/skills.ts` omits Speech, Barter, and Gambling from `DIFFICULTY_AFFECTED_SKILLS`. CE applies the modifier to all 12 skills listed above.

---

## 4. Per-Skill Sections

### Combat Skills (Small Guns, Big Guns, Energy Weapons, Unarmed, Melee Weapons, Throwing)

These six skills have **no** `skillUse` implementation in `skill.cc`. They are used exclusively for hit-chance calculation in `attackDetermineToHit` (combat.cc ~4440). See [damage_formula.md](damage_formula.md) — "Hit Chance Formula" section.

`skillUse()` in CE returns `-1` (invalid skill) for all combat skills; they fall through to the `default:` branch.

**DH2 status: MISSING** — `skillUse.ts` does not handle any combat skill case; the `default:` branch returns a failure message. This is correct CE behaviour.

---

### First Aid

**CE function:** `skillUse()`, `skill.cc` — `case SKILL_FIRST_AID`  
**Inputs:** `obj` (user), `target` (critter, may be self)

**Preconditions:**
- Target must be alive (`critterIsDead` → blocked).
- Target must be below max HP.
- At most 3 uses per 24 in-game hours (`SKILLS_MAX_USES_PER_DAY = 3`).

**Modifiers:**
- Robots: always `ROLL_FAILURE` (body type check).
- `criticalChanceModifier` passed in from the call site.
- Healer perk: +4 min heal / +10 max heal per rank.

**Roll:** `skillRoll(obj, SKILL_FIRST_AID, criticalChanceModifier)` → standard `randomRoll`.

**Outcome table:**

| Result | Effect |
|--------|--------|
| Critical Success | Heal `randomBetween(1 + ranks×4, 5 + ranks×10)` HP |
| Success | Heal `randomBetween(1 + ranks×4, 5 + ranks×10)` HP |
| Failure | "You fail to do any healing." No HP restored. |
| Critical Failure | (no special effect beyond Failure in CE; same message) |

**Time cost:** +30 minutes game time (always, even on failure).  
**XP:** 25 XP on success (player only).

**DH2 status: WIRED** — `src/skillUse.ts:useFirstAid()`.  
DH2 divergence: on Critical Success, DH2 doubles the heal roll; CE uses the same `randomBetween(1+, 5+)` formula for both Success and Critical Success.

---

### Doctor

**CE function:** `skillUse()`, `skill.cc` — `case SKILL_DOCTOR`  
**Inputs:** `obj` (user), `target` (critter, may be self)

**Preconditions:**
- Target must be alive.
- Target must be below max HP **or** have at least one crippled condition.
- At most 3 uses per 24 hours.

**Modifiers:**
- Robots: always `ROLL_FAILURE` for all sub-rolls.
- Healer perk: +4 min / +10 max HP heal per rank.
- `criticalChanceModifier` from call site.

**Crippled conditions treated:** DAM_BLIND, DAM_CRIP_ARM_LEFT, DAM_CRIP_ARM_RIGHT, DAM_CRIP_LEG_RIGHT, DAM_CRIP_LEG_LEFT.

**Roll sequence:**
1. For each active crippled flag: individual `skillRoll` — success clears the flag.
2. Then a second plain `randomRoll(skillGetValue, critChance)` for HP healing.

**Outcome table:**

| Result | Effect |
|--------|--------|
| Critical Success | Clears condition (per flag roll) / Heal `randomBetween(4 + ranks×4, 10 + ranks×10)` HP |
| Success | Same as Critical Success |
| Failure | Condition not cleared / No HP restored |
| Critical Failure | Same as Failure |

**Time cost:** +1 hour base, +1 hour per crippled-condition roll attempted (capped at 3 hours in DH2; CE uses `gameTimeAddSeconds(3600 × damageHealingAttempts)` without cap).  
**XP:** 50 XP on any success (player only).

**DH2 status: WIRED** — `src/skillUse.ts:useDoctor()`.  
DH2 divergence: CE's time cost is `3600 × damageHealingAttempts` seconds (no cap); DH2 caps at 3 hours via `Math.min(timeHours, 3)`.

---

### Sneak

**CE function:** `skillUse()`, `skill.cc` — `case SKILL_SNEAK` — falls through to `break` immediately.

CE's `skillUse` for Sneak is a **no-op** — the switch case has no body before `break`. Sneak mode is managed separately by `dudeHasState(DUDE_STATE_SNEAKING)` and `dudeIsSneaking()` elsewhere. The actual sneak roll (for detection) happens per-tile in the world traversal code, not in `skillUse`.

The +30 Steal bonus for sneaking is applied inside `skillRoll` when `skill == SKILL_STEAL` and sneak is active.

**DH2 status: PARTIAL** — `src/skillUse.ts:useSneak()` toggles `player.isSneaking`. The Sneak detection roll (per-tile) is not implemented.

---

### Lockpick

**CE function:** `skillUse()`, `skill.cc` — `case SKILL_LOCKPICK` — falls through to `break` immediately.

CE's `skillUse` for Lockpick is a **no-op** at the engine level. All lockpicking logic in the original game is handled by map scripts (`use_skill_on_p_proc`). The engine provides `skillRoll(obj, SKILL_LOCKPICK, modifier)` for scripts to call via the `roll_vs_skill` intrinsic.

**DH2 status: PARTIAL** — `src/skillUse.ts:useLockpick()` provides a fallback roll using `pro.extra.lockDifficulty` (default 50) when no script is present. Script-driven lockpicking (the normal path) goes through `roll_vs_skill` in scripting.ts.

---

### Steal

**CE function:** `skillsPerformStealing()`, `skill.cc` ~1031  
**Inputs:** `thief`, `target`, `item`, `isPlanting`

**Steal chance computation:**

```
stealModifier = −(_gStealCount − 1)     // penalty for repeated steal attempts
if not Pickpocket perk:
    stealModifier −= 4 × itemGetSize(item)  // −4% per size unit
    if target is facing thief:
        stealModifier −= 25             // face-to-face penalty
if target is knocked out or knocked down:
    stealModifier += 20
stealChance = stealModifier + skillGetValue(thief, SKILL_STEAL)
stealChance = min(95, stealChance)      // hard cap
```

**Special case:** if thief is the player and target is a party member → automatic `ROLL_CRITICAL_SUCCESS`.

**Two-roll system:**

```
stealRoll = randomRoll(stealChance, critChance)

if stealRoll == CRITICAL_SUCCESS:
    catchRoll = CRITICAL_FAILURE   // never caught
elif stealRoll == CRITICAL_FAILURE:
    catchRoll = SUCCESS            // always caught
else:
    catchChance = skillGetValue(target, SKILL_STEAL) − stealModifier
    catchRoll = randomRoll(catchChance, 0)
```

**Outcome table:**

| stealRoll | catchRoll | Result |
|-----------|-----------|--------|
| Critical Success | (auto Critical Failure) | Steal succeeds, not caught |
| Success | Failure / Critical Failure | Steal succeeds, not caught |
| Success | Success / Critical Success | Steal fails, caught |
| Failure | Failure / Critical Failure | Steal fails, not caught |
| Failure | Success / Critical Success | Steal fails, caught |
| Critical Failure | (auto Success) | Steal fails, always caught |

**XP:** 25 XP on success (per `_show_skill_use_messages`; `experience = 25`, `field_28 = 1` in CE descriptor).

**DH2 status: PARTIAL** — `src/skillUse.ts:useSteal()` implements the sneaking bonus and 95% cap. Missing: item-size penalty (`−4 × size`), facing check (`−25`), multi-steal penalty (`_gStealCount`), party-member auto-success, and target's Steal counter-roll. DH2 uses a simplified single-roll with `catchChance = floor((100 − chance) / 2)`.

---

### Traps

**CE function:** `skillUse()`, `skill.cc` — `case SKILL_TRAPS`

CE's implementation is a hard return of `-1` with message 551 ("You fail to find any traps."). There is no roll — trap disarming is entirely script-driven via `use_skill_on_p_proc`. The engine displays a generic failure message when `skillUse` is called directly with Traps.

**DH2 status: PARTIAL** — `src/skillUse.ts:useTraps()` provides a fallback roll against `pro.extra.trapDifficulty`. This is more functional than CE's bare `-1`, but genuine trap disarming still requires script support.

---

### Science

**CE function:** `skillUse()`, `skill.cc` — `case SKILL_SCIENCE`

CE returns `-1` with message 552 ("You fail to learn anything."). Science use is entirely script-driven. No engine-level roll in `skillUse`.

**DH2 status: PARTIAL** — `src/skillUse.ts:useScience()` performs a `randomRoll(skillValue, critChance)` and returns success/failure. Actual science interactions require map scripts.

---

### Repair

**CE function:** `skillUse()`, `skill.cc` — `case SKILL_REPAIR`  
**Inputs:** `obj` (user), `target` (must be `BODY_TYPE_ROBOTIC`)

**Preconditions:**
- Target must have `BODY_TYPE_ROBOTIC` (non-robots: message 553, return -1).
- At most 3 uses per 24 hours.
- Dead robots: displays message 1101, breaks without healing.

**Repairable damage flags:** DAM_BLIND, DAM_CRIP_ARM_LEFT, DAM_CRIP_ARM_RIGHT, DAM_CRIP_LEG_RIGHT, DAM_CRIP_LEG_LEFT.

**Roll sequence:** Same structure as Doctor — individual rolls per damage flag, then a plain HP roll.

**Outcome table:**

| Result | Effect |
|--------|--------|
| Critical Success | Clears condition / Heal `randomBetween(4, 10)` HP (no Healer perk) |
| Success | Same as Critical Success |
| Failure | No effect |
| Critical Failure | Same as Failure |

**Time cost:** `1800 × damageHealingAttempts` seconds (+30 min base, +30 min per flag attempt).  
**XP:** 50 XP on success (player only; `experience = 0` in gSkillDescriptions for Repair, but `_show_skill_use_messages` is called — could not verify XP grant from descriptor alone; SKILL_XP in DH2 sets 50).

**DH2 status: PARTIAL** — `src/skillUse.ts:useRepair()` heals HP but does not check `BODY_TYPE_ROBOTIC`. The damage-flag healing loop is implemented. Time advance is fixed at +30 min (not per-flag as in CE).

---

### Speech

**CE function:** No `skillUse` implementation. Falls through to `default:` → returns -1.

Speech is checked exclusively by dialogue scripts and the barter system. Scripts call `roll_vs_skill(obj, SKILL_SPEECH, modifier)` or `has_skill(obj, SKILL_SPEECH)` directly.

**DH2 status: MISSING** — `skillUse.ts` `default:` branch. Script access via `roll_vs_skill` / `has_skill` is WIRED in `scripting.ts`.

---

### Barter

**CE function:** No `skillUse` implementation. Falls through to `default:` → returns -1.

Barter is used by the inventory/trade system: `inventory.cc:4690` reads both `partyGetBestSkillValue(SKILL_BARTER)` and `skillGetValue(npc, SKILL_BARTER)` to compute trade prices.

**DH2 status: MISSING** — `skillUse.ts` `default:` branch. No trade-price system is implemented. Script access via `roll_vs_skill` / `has_skill` is WIRED in `scripting.ts`.

---

### Gambling

**CE function:** No `skillUse` implementation. Falls through to `default:` → returns -1.

Gambling outcomes are script-driven (casino scripts). CE provides no engine-level `skillUse` handler for Gambling.

**DH2 status: MISSING** — `skillUse.ts` `default:` branch. Script access via `roll_vs_skill` / `has_skill` is WIRED in `scripting.ts`.

---

### Outdoorsman

**CE function:** No `skillUse` implementation in `skill.cc`. Falls through to `default:` → returns -1.

Outdoorsman is used by the world-map system: `worldmap.cc:3456` reads `partyGetBestSkillValue(SKILL_OUTDOORSMAN)` to reduce random encounter frequency and improve travel safety. It is not a player-activated skill-use action.

**DH2 status: MISSING** — `skillUse.ts` `default:` branch. World-map system is not implemented in DH2. Script access via `roll_vs_skill` / `has_skill` is WIRED in `scripting.ts`.

---

## 5. Scripting Intrinsics

CE ref: `scripts.cc` / script bytecode  
DH2 ref: `src/scripting.ts`, `src/vm_bridge.ts`

Three intrinsics allow scripts to interact with the skill system:

### `roll_vs_skill(obj, skill, bonus)` — opcode `0x80AC`

**DH2 status: WIRED** (`scripting.ts:802`, `vm_bridge.ts:141`)

Performs a full `randomRoll(skillValue + bonus, critChance)` for the given object and skill ID (0–17, matching the `Skill` enum). Returns a `RollResult` numeric value (0–3). Scripts check the result with `is_success()` or `is_critical()`.

```
// Usage pattern in FO2 scripts:
roll = roll_vs_skill(self, SKILL_LOCKPICK, -20)
if is_success(roll): unlock_door()
```

### `has_skill(obj, skill)` — opcode `0x80AA`

**DH2 status: WIRED** (`scripting.ts:794`, `vm_bridge.ts:144`)

Returns the **effective skill value** (0–300) for the critter. Despite the name, this is not a boolean — it mirrors CE's `skillGetValue(obj, skill)`.

### `using_skill(obj, skill)` — opcode `0x80AB`

**DH2 status: STUB** (`scripting.ts:790`, `vm_bridge.ts:145`)

CE ref: `scripts.cc` — notifies the engine that a script is actively using a skill (for UI feedback and state tracking). Returns nothing meaningful. DH2 calls `stub('using_skill', arguments)`.

---

## 6. Skill Use Limits (`skillGetFreeUsageSlot`)

CE ref: `skill.cc:skillGetFreeUsageSlot`, `SKILLS_MAX_USES_PER_DAY = 3`

Skills with usage limits (First Aid, Doctor, Repair) track the last 3 use timestamps. A new use is allowed if:
- Fewer than 3 uses have been recorded, **or**
- The oldest recorded use is more than 24 in-game hours ago.

DH2 implements this identically in `src/skillUse.ts` via `hasFreeUsageSlot()` / `recordUsage()`.

---

## 7. Divergences: DH2 vs. fallout2-ce

| Area | fallout2-ce | DarkHarold2 |
|------|------------|-------------|
| Critical upgrade gate | Day ≥ 1 required (configurable) | Always permitted |
| Difficulty modifier skills | Affects Speech, Barter, Gambling too | Only First Aid, Doctor, Sneak, Lockpick, Steal, Traps, Science, Repair, Outdoorsman |
| First Aid crit success | Same heal range as normal success | Doubles the heal roll |
| Doctor time cap | `3600 × attempts` seconds (no cap) | `min(3, attempts)` hours |
| Steal: item size | −4% per size unit | Not implemented |
| Steal: facing | −25% if face-to-face | Not implemented |
| Steal: repeat penalty | −(`_gStealCount` − 1) | Not implemented |
| Steal: party member | Auto critical success | Not implemented |
| Steal: catch roll | Target's Steal skill minus modifier | `floor((100 − chance) / 2)` |
| Repair: robot check | Only works on BODY_TYPE_ROBOTIC | No body-type check |
| Repair: time cost | +30 min per damage-flag attempt | Fixed +30 min |
| Traps/Science (direct use) | Hard −1 with message; script-only | Fallback roll using pro data |
| World-map Outdoorsman | Reduces encounter frequency | Not implemented |
| Barter trade prices | Both sides' Barter skill compared | Not implemented |
