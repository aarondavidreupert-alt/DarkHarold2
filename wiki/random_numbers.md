# Random Number System

Cross-references: `wiki/combat.md` (hit/crit rolls), `wiki/skill_checks.md` (randomRoll usage), `wiki/known_bugs.md` §C1 (Sniper perk), §RN (gaps).

---

## 1. Overview

Fallout 2 uses a single global random number generator (RNG) for all gameplay randomness — skill checks, hit rolls, critical tables, loot, AI decisions, and the `random()` script opcode. The CE source lives in `random.cc` / `random.h`.

There are two public API levels:

| Function | CE | DH2 |
|----------|----|-----|
| Raw integer in range | `randomBetween(min, max)` | `getRandomInt(min, max)` (util.ts:102) |
| d% skill check | `randomRoll(difficulty, critMod)` | `randomRoll(difficulty, critMod)` (util.ts:127) |
| Script opcode | `op_random` (0x80B4) | `random` method (scripting.ts:455) |
| Dice roll opcode | `op_roll_dice` (0x80B5) | not registered |

---

## 2. CE Implementation — MINSTD LCG with Bays-Durham Shuffle

### 2.1 Algorithm

CE's generator (`random.cc:152`) is the **Park-Miller Minimal Standard LCG** with a **Bays-Durham shuffle table** to eliminate serial correlation:

```c
// random.cc:153 — getRandom(max)
int v1 = 16807 * (_idum % 127773) - 2836 * (_idum / 127773);
if (v1 < 0) v1 += 0x7FFFFFFF;
if (v1 < 0) v1 += 0x7FFFFFFF;

int v2 = _iy & 0x1F;   // index into 32-element shuffle table
int v3 = _iv[v2];       // output = stored value at that slot
_iv[v2] = v1;           // replace slot with new raw value
_iy = v3;               // next index = output value
_idum = v1;             // advance internal state

return v3 % max;
```

LCG parameters: **a = 16807**, **m = 2³¹ − 1 = 2,147,483,647**. The constants `127773 = m / a` and `2836 = m % a` are Schrage's method to avoid 32-bit overflow. This is identical to the MINSTD generator of Park & Miller (1988).

The three module-level statics:

| Variable | Address | Role |
|----------|---------|------|
| `_idum` | `0x664950` | current raw LCG state |
| `_iv[32]` | `0x6648D0` | Bays-Durham shuffle table |
| `_iy` | `0x51C694` | current output index |

### 2.2 Seeding (`randomInit`, `random.cc:39`)

```c
void randomInit() {
    unsigned int seed = compat_timeGetTime(); // wall-clock milliseconds
    std::srand(seed);                         // seed std::rand
    int pseudoSeed = std::rand();             // one std::rand() call
    randomSeedPrerandomInternal(pseudoSeed);  // populate _iv[] from LCG
    randomValidatePrerandom();                // chi-squared sanity check
}
```

`randomSeedPrerandomInternal(seed)` (random.cc:192) runs **40 LCG iterations** to warm up `_iv[32]`, then sets `_iy = _iv[0]`. Seeds below 1 are clamped to 1.

The result: CE seeds from system wall-clock time at startup — **non-deterministic across sessions**.

### 2.3 Distribution validation

`randomValidatePrerandom()` (random.cc:224) runs 100,000 samples of `randomBetween(1, 25)`, computes the chi-squared statistic, and prints `"Sequence is random, 95% confidence."` or a warning to the debug log. This runs at every startup.

### 2.4 `randomBetween(min, max)` (`random.cc:134`)

```c
int randomBetween(int min, int max) {
    int result;
    if (min <= max)
        result = min + getRandom(max - min + 1);
    else
        result = max + getRandom(min - max + 1);  // inverted range

    if (result < min || result > max) {
        debugPrint("Random number %d is not in range %d to %d", result, min, max);
        result = min;   // clamp on out-of-range (should never happen)
    }
    return result;
}
```

Both endpoints are **inclusive**. Inverted ranges (`min > max`) are handled by swapping the computation. A debug-print guard catches any out-of-range result.

### 2.5 `randomRoll(difficulty, critMod)` (`random.cc:85`)

The d% skill-check function:

```c
int randomRoll(int difficulty, int criticalSuccessModifier, int* howMuchPtr) {
    int delta = difficulty - randomBetween(1, 100);
    return randomTranslateRoll(delta, criticalSuccessModifier);
}
```

`randomTranslateRoll` (`random.cc:101`) maps `delta` to a `Roll` enum:

| delta | Primary result | Critical upgrade condition |
|-------|---------------|---------------------------|
| < 0 | `ROLL_FAILURE` | 10% if `d100 ≤ |delta| / 10` → `ROLL_CRITICAL_FAILURE` |
| ≥ 0 | `ROLL_SUCCESS` | 10%+mod if `d100 ≤ delta/10 + critMod` → `ROLL_CRITICAL_SUCCESS` |

Critical upgrades only apply **from day 2 onward** (or if the sfall `REMOVE_CRITICALS_TIME_LIMITS` config is set).

`Roll` enum values (`random.h:8`):

```c
ROLL_CRITICAL_FAILURE = 0
ROLL_FAILURE          = 1
ROLL_SUCCESS          = 2
ROLL_CRITICAL_SUCCESS = 3
```

### 2.6 RNG state and saves

`randomSave()` and `randomLoad()` both call `_roll_reset_()` which returns 0 (`random.cc:71-80`). The RNG state is **never persisted** to save files. Each game session starts from a freshly time-seeded state.

---

## 3. CE Script Opcodes

### 3.1 `random` (opcode 0x80B4, `interpreter_extra.cc:774`)

```c
static void opRandom(Program* program) {
    int data[2];
    data[0] = programStackPopInteger(program);  // max (pushed second)
    data[1] = programStackPopInteger(program);  // min (pushed first)
    int result = randomBetween(data[1], data[0]);
    programStackPushInteger(program, result);
}
```

Script syntax: `random(min, max)` → returns integer in `[min, max]` inclusive. Delegates directly to `randomBetween`.

### 3.2 `roll_dice` (opcode 0x80B5, `interpreter_extra.cc:789`)

```c
static void opRollDice(Program* program) {
    int data[2];
    data[0] = programStackPopInteger(program);
    data[1] = programStackPopInteger(program);
    scriptPredefinedError(program, "roll_dice", SCRIPT_ERROR_NOT_IMPLEMENTED);
    programStackPushInteger(program, 0);
}
```

**`roll_dice` was never implemented in CE.** The handler pops its two arguments and immediately fires `SCRIPT_ERROR_NOT_IMPLEMENTED`, then pushes 0. The opcode is registered at CE startup (`interpreter_extra.cc:4894`) but is a stub. Intended semantics (from Fallout scripting docs): `roll_dice(N, X)` → sum of N dice each with X sides (NdX).

---

## 4. CE Random Usage in Combat

### 4.1 Hit roll (`combat.cc:3802`)

```c
int chance = randomBetween(1, 100);
// attack hits if chance <= computed hit chance
```

### 4.2 Sniper perk (`combat.cc:3892`)

```c
int d10 = randomBetween(1, 10);
int luck = critterGetStat(gDude, STAT_LUCK);
if (d10 <= luck) { roll = ROLL_CRITICAL_SUCCESS; }
```

CE uses **d10** (1-10). This is the authoritative formula.

### 4.3 Critical hit level (`combat.cc:4102`)

Non-uniform breakpoints: `randomBetween(1, 100)` compared against `<=20`, `<=45`, `<=70`, `<=90`, `<=100`, `>100` (with crit modifier offset).

---

## 5. DH2 Implementation

### 5.1 `getRandomInt(min, max)` (`src/util.ts:102`)

```typescript
export function getRandomInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}
```

Inclusive on both ends. Uses `Math.random()` which is either the browser's native implementation or a replacement installed by `seed()`.

### 5.2 Sin-based PRNG and deterministic seeding

DH2 defines a `seed()` function inside the `Scripting` module (`scripting.ts:136`):

```typescript
function seed(s: number) {
    Math.random = () => {
        s = Math.sin(s) * 10000
        return s - Math.floor(s)
    }
}
```

This replaces the global `Math.random` with a sin-based PRNG. `Scripting.init()` calls `seed(123)` (`scripting.ts:2206`) on every map load:

```typescript
export function init(mapName: string, mapID?: number) {
    seed(123)   // ← resets PRNG to fixed seed every session
    loadGlobalVars()
    reset(mapName, mapID)
}
```

Effect: **every DH2 session produces the same random sequence** — rolls are deterministic and reproducible. CE sessions differ every launch due to time-based seeding.

The sin-based PRNG has no published statistical validation. Known weaknesses: lower-order bits are non-uniform, and the output can converge near 0 or 1 for certain seed values. It is adequate for d100 game rolls at macro scale.

### 5.3 `randomRoll` (`src/util.ts:127`)

Matches CE `randomRoll` + `randomTranslateRoll` formulas:

```typescript
export function randomRoll(difficulty, criticalSuccessModifier) {
    const delta = difficulty - getRandomInt(1, 100)
    let roll: RollResult
    if (delta < 0) {
        roll = RollResult.Failure
        if (getRandomInt(1, 100) <= Math.floor(-delta / 10))
            roll = RollResult.CriticalFailure
    } else {
        roll = RollResult.Success
        if (getRandomInt(1, 100) <= Math.floor(delta / 10) + criticalSuccessModifier)
            roll = RollResult.CriticalSuccess
    }
    return { roll, delta }
}
```

`RollResult` enum values match CE `Roll` (CriticalFailure=0, Failure=1, Success=2, CriticalSuccess=3).

Note: DH2 does not replicate CE's day-2 restriction on critical upgrades (always enabled).

### 5.4 `random` opcode (`src/scripting.ts:455`, `vm_bridge.ts:68`)

```typescript
// scripting.ts:455
random(min: number, max: number) {
    log('random', arguments)
    return getRandomInt(min, max)
}

// vm_bridge.ts:68
0x80B4: bridged("random", 2)
```

Correctly delegates to `getRandomInt`. Opcode 0x80B4 is wired and functional.

### 5.5 `roll_dice` opcode (`vm_bridge.ts`)

Opcode 0x80B5 is **not registered** in `vm_bridge.ts`. Any script calling `roll_dice` will trigger an unknown-opcode trap in the VM. CE gracefully pushes 0; DH2 does not.

### 5.6 Sniper perk (`src/combat/Combat.ts`)

```typescript
if (getRandomInt(1, 100) <= obj.getStat('LUK')) { isCrit = true }
```

DH2 uses **d100** instead of CE's **d10**. This makes the Sniper perk roughly 10× harder to trigger (e.g., LUK=7 → 7% chance in DH2 vs 70% in CE). Tracked as bug C1 in `wiki/known_bugs.md`.

### 5.7 `rollSkillCheck` (`src/util.ts:110`)

```typescript
export function rollSkillCheck(skill, modifier, isBounded) {
    const roll = getRandomInt(0, 100)   // 101 outcomes [0-100]
    return roll < skill
}
```

CE `randomBetween(1, 100)` has 100 possible outcomes. DH2 `getRandomInt(0, 100)` has **101** outcomes (includes 0), making every skill check very slightly easier. `randomRoll` (the skill-check wrapper) uses `getRandomInt(1, 100)` correctly — the deviation only affects the direct `rollSkillCheck` call path (used in combat hit rolls at `combat.ts:517`).

---

## 6. Distribution Comparison

| Property | CE | DH2 |
|----------|----|-----|
| Generator | Park-Miller LCG + Bays-Durham shuffle | Sin-based PRNG |
| Period | 2³¹ − 2 ≈ 2.1 × 10⁹ | Variable (sin orbit) |
| Statistical validation | Chi-squared test at startup | None |
| Seed source | `compat_timeGetTime()` (wall clock) | Fixed constant 123 |
| Deterministic? | No | Yes — same sequence every session |
| `randomBetween(1, 100)` range | [1, 100] inclusive, 100 values | [1, 100] inclusive, 100 values |
| Out-of-range guard | debugPrint + clamp | None |
| RNG saved in save file | No (save/load are stubs) | No |

---

## 7. Known Gaps

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| RN1 | **Fixed seed 123 makes every session deterministic.** `Scripting.init()` always calls `seed(123)`, resetting the sin-based PRNG to the same state. CE seeds from system time — different rolls every session. A new player always gets the same sequence of crits, misses, and drops. | `src/scripting.ts:2206` | `random.cc:39 randomInit()` | minor | bug |
| RN2 | **`roll_dice` opcode (0x80B5) not registered.** Any script calling `roll_dice` hits an unknown-opcode trap. CE also never implemented the opcode, but it pushes 0 gracefully. | `src/vm_bridge.ts` | `interpreter_extra.cc:789 opRollDice()` | low | missing |
| RN3 | **Sniper perk rolls d100 instead of d10.** `combat/Combat.ts` uses `getRandomInt(1, 100)` vs CE's `randomBetween(1, 10)`. Direct cause of known_bugs.md §C1. | `src/combat/Combat.ts` | `combat.cc:3892` | major | bug |
| RN4 | **`rollSkillCheck` uses 101 outcomes ([0, 100]) vs CE's 100 ([1, 100]).** Makes hit rolls very slightly easier at all skill levels. Affects combat attack rolls (`combat/Combat.ts`). | `src/util.ts:110` | `random.cc:134 randomBetween()` | low | bug |
| RN5 | **No chi-squared validation of DH2 PRNG.** CE runs 100,000-sample chi-squared test at startup. Sin-based PRNG has known non-uniform bit patterns that are not monitored. | `src/util.ts:102` | `random.cc:224 randomValidatePrerandom()` | low | missing |

Last audited: 2026-06-02
