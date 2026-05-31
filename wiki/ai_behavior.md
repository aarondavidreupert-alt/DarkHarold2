# AI Behavior — DarkHarold2 / Fallout 2

See also [damage_formula.md](damage_formula.md), [skill_checks.md](skill_checks.md)

DH2 refs: `src/aiPackets.ts` (packet parser), `src/combat.ts` (`doAITurn`, `findTargetForCritter`, `aiBestWeapon`, `aiCheckDrugs`, `aiCalledShot`, `aiPickHitMode`, `aiRunAwayDirectional`)  
CE refs: `combat_ai.cc`, `combat_ai.h`, `combat_ai_defs.h`

---

## 1. What Is an AI Packet?

An **AI packet** is a named configuration block that governs how a critter behaves in combat. Every non-player critter references one packet by a numeric ID (`aiPacket` field in the critter's PRO; stored as `obj.aiNum` in DH2).

**Source file:** `data/data/ai.txt`  
**Format:** Windows INI — one `[SectionName]` block per packet, each with `key=value` pairs.  
**Loading:** `aiPackets.ts:ensureInit()` fetches `data/data/ai.txt` via synchronous XHR on first use, parses it with `parseIniText()`, and populates `aiPackets: Map<number, AiPacket>` keyed by `packet_num`.

---

## 2. AiPacket Interface

CE ref: `combat_ai.cc:59` — `typedef struct AiPacket` / `AiPacket`  
DH2 ref: `src/aiPackets.ts:AiPacket`

| DH2 field | ai.txt key | CE field | Type | Default | Description |
|-----------|-----------|---------|------|---------|-------------|
| `packetNum` | `packet_num` | `packet_num` | number | 0 | Unique numeric identifier; used as the map key |
| `name` | *(section name)* | `name` | string | — | Human-readable packet name (e.g. `"BOS_Guard"`) |
| `aggression` | `aggression` | `aggression` | number | 0 | Parsed but **not consumed** by combat logic in DH2 or CE |
| `disposition` | `disposition` | `disposition` | Disposition | `'none'` | Engagement attitude — affects party-member target filtering in CE; **not consumed** in DH2 |
| `attackWho` | `attack_who` | `attack_who` | AttackWho | `'closest'` | Target-selection policy |
| `bestWeapon` | `best_weapon` | `best_weapon` | BestWeapon | `'no_pref'` | Weapon-type preference for `aiBestWeapon()` |
| `areaAttackMode` | `area_attack_mode` | `area_attack_mode` | AreaAttackMode | `'no_pref'` | When to use secondary (burst) fire |
| `distance` | `distance` | `distance` | DistanceMode | `'on_your_own'` | Movement stance relative to target; **not consumed** in DH2 |
| `runAwayMode` | `run_away_mode` | `run_away_mode` | RunAwayMode | `'none'` | Controls flee behaviour |
| `hurtTooMuch` | `hurt_too_much` | `hurt_too_much` | string[] | `[]` | Damage flags that trigger immediate flee (e.g. `['crippled', 'blind']`) |
| `minHp` | `min_hp` | `min_hp` | number | 0 | Flee when `(HP / maxHP) × 100 ≤ minHp` |
| `minToHit` | `min_to_hit` | `min_to_hit` | number | 0 | Skip called shots below this hit-chance %; in CE also gates approach-vs-flee |
| `maxDist` | `max_dist` | `max_dist` | number | 50 | Max pursuit distance in hexes; **not consumed** in DH2 |
| `calledFreq` | `called_freq` | `called_freq` | number | 0 | 1-in-N chance to attempt a called shot (0 = never) |
| `secondaryFreq` | `secondary_freq` | `secondary_freq` | number | 0 | 1-in-N chance for secondary fire in `no_pref` / `sometimes` modes |
| `chance` | `chance` | `chance` | number | 85 | % chance to say a taunt message; rolled each turn |
| `chemUse` | `chem_use` | `chem_use` | ChemUse | `'clean'` | Drug/healing-item usage policy |
| `chemPrimaryDesire` | `chem_primary_desire` | `chem_primary_desire[3]` | number[] | `[]` | PIDs of preferred drugs; `-1` entries filtered out |

**DH2 note on `minHp`:** In CE, `min_hp` is an absolute HP integer and `run_away_mode` maps to a percentage via `_hp_run_away_value[]` which overwrites `min_hp`. DH2 reads `min_hp` directly from ai.txt and treats it as a percentage threshold instead.

---

## 3. Enums

All enum values are accepted by `parseEnum()` as either their string name (case-insensitive) or their CE numeric code.

### `Disposition`

CE ref: `combat_ai_defs.h` — `Disposition`  
DH2 numeric map: `DISPOSITION_MAP = ['none', 'custom', 'berserk', 'aggressive', 'coward']`

| Code | String | CE name | Effect |
|------|--------|---------|--------|
| 0 | `'none'` | `DISPOSITION_NONE` | No filtering |
| 1 | `'custom'` | `DISPOSITION_CUSTOM` | Ignore fleeing critters (CE party member only) |
| 2 | `'berserk'` | `DISPOSITION_BERKSERK` | Ignore fleeing critters (CE typo retained) |
| 3 | `'aggressive'` | `DISPOSITION_AGGRESSIVE` | Ignore fleeing critters |
| 4 | `'coward'` | `DISPOSITION_COWARD` | Ignore fleeing critters |

> **DH2 status:** field is parsed and stored but not read during combat. The CE disposition logic (filtering targets that are fleeing) is not implemented.

### `AttackWho`

CE ref: `combat_ai_defs.h` — `AttackWho`  
DH2 numeric map: `ATTACK_WHO_MAP = ['whomever', 'closest', 'weakest', 'strongest', 'closest', 'whomever_attacking_me']`

Note: CE code 4 (`which_side_most_hurt`) maps to `'closest'` in DH2 (no implementation of team-health comparisons).

| Code | String | CE name | DH2 `findTargetForCritter` behaviour |
|------|--------|---------|--------------------------------------|
| 0 | `'whomever'` | `ATTACK_WHO_WHOMEVER` | Prefer `lastAttacker`; fall back to random pick |
| 1 | `'closest'` | `ATTACK_WHO_CLOSEST` | Sort by hex distance, pick nearest |
| 2 | `'weakest'` | `ATTACK_WHO_WEAKEST` | Sort by current HP ascending |
| 3 | `'strongest'` | `ATTACK_WHO_STRONGEST` | Sort by current HP descending |
| 4 | `'closest'` | `ATTACK_WHO_WHICH_SIDE_MOST_HURT` | (no DH2 impl) → falls back to closest |
| 5 | `'whomever_attacking_me'` | `ATTACK_WHO_WHOEVER_ATTACKING_ME` | Prefer `lastAttacker`; then prefer anyone whose `lastAttacker === self`; fall back to closest |

> **CE divergence:** CE `STRONGEST`/`WEAKEST` use `_combatai_rating() = max(meleeDmg, weaponMaxDmg) + AC`, not raw HP. DH2 uses HP as a simpler proxy.

### `BestWeapon`

CE ref: `combat_ai_defs.h` — `BestWeapon`  
DH2 numeric map: `BEST_WEAPON_MAP` (index 0 = `'no_pref'` which is also the -1 fallback)

| Code | String | CE name | Weapon preference ordering |
|------|--------|---------|---------------------------|
| -1/0 | `'no_pref'` | unset/-1 | RANGED → THROW → MELEE → UNARMED |
| 1 | `'melee'` | `BEST_WEAPON_MELEE` | MELEE only |
| 2 | `'melee_over_ranged'` | `BEST_WEAPON_MELEE_OVER_RANGED` | MELEE → RANGED |
| 3 | `'ranged_over_melee'` | `BEST_WEAPON_RANGED_OVER_MELEE` | RANGED → MELEE |
| 4 | `'ranged'` | `BEST_WEAPON_RANGED` | RANGED only |
| 5 | `'unarmed'` | `BEST_WEAPON_UNARMED` | UNARMED only |
| 6 | `'unarmed_over_throw'` | `BEST_WEAPON_UNARMED_OVER_THROW` | UNARMED → THROW |
| 7 | `'random'` | `BEST_WEAPON_RANDOM` | Random 50/50 between equipped weapons |
| 8 | `'never'` | `BEST_WEAPON_NEVER` | Never attack with a weapon |

DH2 `aiBestWeapon()` walks `WEAP_PREF_ORDERINGS[weapPrefRow(bestWeapon)]` and returns the first hand whose weapon matches the preferred attack type. If `bestWeapon === 'never'`, returns `null` and the critter skips its attack phase entirely.

### `AreaAttackMode`

CE ref: `combat_ai_defs.h` — `AreaAttackMode`  
DH2 numeric map: `AREA_ATTACK_MODE_MAP = ['no_pref', 'be_careful', 'be_sure', 'be_absolutely_sure', 'sometimes']`

| Code | String | Burst fire condition |
|------|--------|---------------------|
| 0 | `'no_pref'` | Roll `1/secondaryFreq` if INT < 6 or distance < 10 |
| 1 | `'be_careful'` | to-hit ≥ 50% **and** no friendly within 3 hexes of target |
| 2 | `'be_sure'` | to-hit ≥ 85% **and** no friendly within 2 hexes of target |
| 3 | `'be_absolutely_sure'` | to-hit ≥ 95% **and** no friendly within 1 hex of target |
| 4 | `'sometimes'` | 50% random chance |

"Friendly within N hexes" in DH2 is checked by `canUseBurst()` which counts teammates within the threshold distance. CE uses `_cai_attackWouldIntersect` (hex-line LOS check); DH2 uses a radius approximation via `attackPathClear()`.

### `DistanceMode`

CE ref: `combat_ai_defs.h` — `DistanceMode`  
DH2 numeric map: `DISTANCE_MAP = ['on_your_own', 'charge', 'snipe', 'stay', 'random']`

| Code | String | CE name | CE behaviour |
|------|--------|---------|-------------|
| 0 | `'on_your_own'` | `DISTANCE_ON_YOUR_OWN` | No movement preference |
| 1 | `'charge'` | `DISTANCE_CHARGE` | Move adjacent to target before every attack |
| 2 | `'snipe'` | `DISTANCE_SNIPE` | Maintain ≥ 10 hex standoff; back away if closer |
| 3 | `'stay'` | `DISTANCE_STAY` | Never move |
| 4 | `'random'` | — | (CE does not define this; DH2 extension) |

> **DH2 status:** field is parsed and stored but the distance stance logic (`_cai_perform_distance_prefs`) is not implemented. DH2 always charges.

### `RunAwayMode`

CE ref: `combat_ai_defs.h` — `RunAwayMode`  
DH2 numeric map: `RUN_AWAY_MODE_MAP = ['never', 'none', 'bleeding', 'finger_hurts', 'not_feeling_good', 'coward']`

| Code | String | CE name | CE flee HP% | DH2 interpretation |
|------|--------|---------|-------------|-------------------|
| -1 | `'never'` | (special) | Never flee | `runAwayMode === 'never'` skips all flee checks |
| 0 | `'none'` | `RUN_AWAY_MODE_NONE` | 0% (never via HP) | Flee check disabled; `hurtTooMuch` still applies |
| 1 | `'bleeding'` | `RUN_AWAY_MODE_BLEEDING` | 60% remaining | Flee check uses `minHp` as % directly |
| 2 | `'finger_hurts'` | `RUN_AWAY_MODE_FINGER_HURTS` | 40% remaining | Same |
| 3 | `'not_feeling_good'` | `RUN_AWAY_MODE_NOT_FEELING_GOOD` | 25% remaining | Same |
| 4 | `'coward'` | `RUN_AWAY_MODE_COWARD` | 75% remaining | Same |

> **CE divergence:** CE maps `run_away_mode` to a percentage via `_hp_run_away_value[]` and computes `minHp = maxHp − (maxHp × pct / 100)`. DH2 reads `min_hp` from ai.txt as-is and treats it as a percentage (0–100). If an ai.txt packet sets `run_away_mode=2` (bleeding) but also `min_hp=25`, CE uses the mode-derived floor; DH2 uses `minHp=25` directly.

### `ChemUse`

CE ref: `combat_ai_defs.h` — `ChemUse`  
DH2 numeric map: `CHEM_USE_MAP = ['clean', 'stims_when_hurt_little', 'stims_when_hurt_lots', 'sometimes', 'anytime']`

| Code | String | CE name | DH2 `aiCheckDrugs` trigger |
|------|--------|---------|---------------------------|
| 0 | `'clean'` | `CHEM_USE_CLEAN` | Never use drugs |
| 1 | `'stims_when_hurt_little'` | `CHEM_USE_STIMS_WHEN_HURT_LITTLE` | HP < 75% of max |
| 2 | `'stims_when_hurt_lots'` | `CHEM_USE_STIMS_WHEN_HURT_LOTS` | HP < 50% of max |
| 3 | `'sometimes'` | `CHEM_USE_SOMETIMES` | Turn % 3 == 0, 25% chance |
| 4 | `'anytime'` | `CHEM_USE_ANYTIME` | Turn % 3 == 0, 50% chance |

> **CE divergence:** CE also has `CHEM_USE_ALWAYS` (always 100% per turn) which DH2 does not define. CE HP thresholds are 60%/30%; DH2 uses 75%/50%.

### `hurtTooMuch` values

String list parsed from `hurt_too_much=` in ai.txt. Each token is matched case-insensitively by `doAITurn`:

| Token | Triggers flee when… |
|-------|---------------------|
| `'crippled'` | Any limb crippled (left/right arm or leg) |
| `'crippled_arms'` | Left or right arm crippled |
| `'crippled_legs'` | Left or right leg crippled |
| `'blind'` | `obj.isBlinded === true` |

CE uses a bitmask (`HURT_BLIND`, `HURT_CRIPPLED`, `HURT_CRIPPLED_LEGS`, `HURT_CRIPPLED_ARMS`) against `critter.combat.results`. DH2 checks the same conditions directly on critter state flags.

---

## 4. `getAiPacket(num)` — Lookup with Fallback

CE ref: `combat_ai.cc:aiGetPacketByNum()`  
DH2 ref: `src/aiPackets.ts:getAiPacket()`

```typescript
export function getAiPacket(num: number): AiPacket {
    ensureInit()                                   // lazy-load ai.txt on first call
    return aiPackets.get(num)                      // exact match by packet_num
        ?? _firstPacket                            // first packet in file (CE fallback)
        ?? FALLBACK_PACKET                         // hard-coded last resort if ai.txt missing
}
```

**Three-tier lookup:**

1. **Exact match** — `aiPackets.get(num)`: direct O(1) map lookup.
2. **First packet fallback** — `_firstPacket`: mirrors CE `aiGetPacketByNum()` which returns `gAiPackets[0]` when the requested packet is not found. `_firstPacket` is set to the first packet parsed from ai.txt.
3. **Hard fallback** — `FALLBACK_PACKET`: only reached when ai.txt could not be loaded at all (HTTP error or missing file). All enum fields default to `-1` semantics (`'no_pref'`, `'none'`, `'closest'`, etc.), and numeric fields default to `0` except `maxDist=50` and `chance=85`.

**Usage in combat:**
```typescript
// src/combat.ts, Combat constructor
if (!obj.isPlayer) obj.aiPacket = getAiPacket(obj.aiNum ?? 0)
```
`obj.aiNum` comes from the critter's PRO `aiPacket` integer field, loaded via `loadPRO()`.

---

## 5. Combat Turn Usage (`doAITurn`)

CE ref: `combat_ai.cc:_combat_ai()`  
DH2 ref: `src/combat.ts:doAITurn()`

Each AI turn runs through these phases in order:

```
doAITurn(obj, idx, depth):
    pkt = obj.aiPacket

    // Phase 1: Drug / healing use
    if aiCheckDrugs(obj, pkt, turnNum):
        recurse → doAITurn()   // spent AP on drug; continue with remaining AP

    // Phase 2: Flee check
    if pkt.runAwayMode !== 'never':
        hpPct = (HP / maxHP) × 100
        shouldFlee = hpPct ≤ pkt.minHp
        if !shouldFlee AND pkt.hurtTooMuch:
            check each hurt_too_much condition → shouldFlee
        if shouldFlee:
            try aiRunAwayDirectional(threat)   // directional hex-rotation flee
            fallback → walk to nearest map edge
            return

    // Phase 3: Target selection
    target = findTargetForCritter(obj)   // uses pkt.attackWho
    if !target: nextTurn()

    // Phase 4: Weapon selection
    if !weaponSwitchDone:
        choice = aiBestWeapon(obj, pkt)  // uses pkt.bestWeapon
        if choice.hand !== activeHand:
            play swap anim → recurse with weaponSwitchDone=true

    // Phase 5: Attack mode selection
    region = aiCalledShot(obj, target, pkt)  // uses pkt.calledFreq, pkt.minToHit
    mode   = aiPickHitMode(obj, target, weapon, pkt)  // uses pkt.areaAttackMode, pkt.secondaryFreq

    // Phase 6: Move-and-attack
    if in range and has AP: attack(target, region, mode)
    else if can reach: walk closer, then attack
    else: nextTurn()
```

### Flee movement (`aiRunAwayDirectional`)

Port of CE `_ai_run_away` direction logic (CE `combat_ai.cc:1173`):

```
awayDir = hexDirectionTo(threat.position, obj.position)
for attemptAP = AP downto 1:
    for offset in [0, +1, -1]:        // direct / +60° / -60°
        dir = (awayDir + offset + 6) % 6
        dest = hexInDirectionDistance(obj.position, dir, attemptAP)
        if walkTo(dest, AP): return true   // fled successfully

// Fallback if directional flee fails:
edgeCandidates = [left, right, top, bottom edges]
sort by distance to obj, pick nearest
walk to that edge; on arrival set obj.hostile=false (remove from combat)
```

### Drug usage (`aiCheckDrugs`)

Port of CE `_ai_check_drugs`. Runs before flee/attack so an injured critter heals instead of fleeing:

- **Stim path:** if HP < threshold%, find first item with a known healing PID in inventory (`STIMPAK_PID=47`, `SUPER_STIMPAK_PID=144`, `HEALING_POWDER_PID=145`), apply `STIMPAK_HEAL[pid]` HP, deduct 2 AP.
- **Chem path:** if turn % 3 == 0 and random roll passes `chanceRoll`, prefer items in `chemPrimaryDesire` PIDs, then any healing item.
- Returns `true` if a drug was used (causes `doAITurn` to recurse for remaining AP).

> **CE divergence:** CE scans inventory for `ITEM_TYPE_DRUG` via `_inven_find_type`. DH2 matches against a hardcoded `STIMPAK_HEAL` PID table because drug PRO data is not parsed.

---

## 6. Known Gaps and TODOs

Fields that are parsed and stored in `AiPacket` but not yet consumed by combat logic:

| Field | Parsed? | Consumed? | What CE does with it |
|-------|---------|-----------|----------------------|
| `aggression` | ✓ | ✗ | Parsed but unused in CE too |
| `disposition` | ✓ | ✗ | CE: ignore fleeing targets for party members |
| `distance` | ✓ | ✗ | CE: `_cai_perform_distance_prefs()` — stance logic |
| `maxDist` | ✓ | ✗ | CE: disengage when target > maxDist hexes away |
| `minToHit` | ✓ | Partial | Used in `aiCalledShot`; CE also uses it to gate approach vs. flee |

Additional gaps vs. CE:
- **`_combatai_rating()`** — CE rates targets by `max(meleeDmg, weapDmg) + AC`; DH2 uses HP.
- **`_ai_search_inven_weap()`** — CE scans full inventory for best weapon; DH2 only checks the two equipped hands.
- **`_combatai_check_retaliation()`** — CE switches `whoHitMe` when hit by a higher-rated attacker; DH2 sets `lastAttacker` but does not compare ratings.
- **`_combatai_notify_onlookers()`** — CE recruits nearby critters into combat when a fight starts; DH2 enrolls only `hostile=true` critters at `Combat` construction time.
- **Party member distinction** — CE has a separate `objectIsPartyMember` branch in `_ai_danger_source` for disposition filtering, distance enforcement, and armor upgrades; DH2 has no such distinction.

---

## 7. How to Use (For Future Claude Prompts)

When working on AI behavior in DarkHarold2:

**Reading a packet:**
```typescript
import { getAiPacket, AiPacket } from './aiPackets.js'
const pkt: AiPacket = getAiPacket(obj.aiNum ?? 0)
```

**Checking a specific policy:**
```typescript
if (pkt.runAwayMode !== 'never' && hpPct <= pkt.minHp) { /* flee */ }
if (pkt.attackWho === 'strongest') { /* sort by threat rating */ }
if (pkt.bestWeapon === 'never') { /* don't attack */ }
```

**Adding a new ai.txt field:**
1. Add the field to `AiPacket` interface in `aiPackets.ts`
2. Add a `parseEnum` / `parseIntField` call in `buildPacket()`
3. Consume the field in the relevant `doAITurn` phase in `combat.ts`

**Adding a new enum value:**
1. Extend the type union (e.g. `DistanceMode`)
2. Add the string to the `DISTANCE_MODES` Set
3. Add it to the `DISTANCE_MAP` array at the correct CE numeric index
4. Handle it in the combat switch/if block

**Where `doAITurn` is called:**
- `src/combat.ts:nextTurn()` — after each human turn, iterates through NPC combatants
- Recursively by `doAITurn` itself (depth-limited by `Config.combat.maxAIDepth`) for drug use, weapon swap, and post-movement attack

**CE reference for new AI features:**  
All AI logic lives in `raw/fallout2-ce/src/combat_ai.cc` (not `ai.cc` — that file does not exist in CE). Key functions: `_combat_ai`, `_ai_danger_source`, `_ai_best_weapon`, `_ai_check_drugs`, `_ai_pick_hit_mode`, `_ai_run_away`, `_cai_perform_distance_prefs`.
