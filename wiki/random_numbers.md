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

`src/random.ts` is a port of CE `random.cc`:

- `getRandom` — Park-Miller (16807, Schrage) with the 32-entry Bays-Durham shuffle, the same arithmetic as CE.
- `seedPrerandomInternal` (CE `randomSeedPrerandomInternal`, including its quirk that the loop never writes `_iv[0]`), `randomSeedPrerandom(-1)` reseeding from the CRT generator.
- `randomInit` (CE `randomInit`): `srand(timeGetTime())` through an MSVC-CRT `rand()` port, then the chi-squared self-test `validatePrerandom` (CE `randomValidatePrerandom`, 25 buckets, warning above 36.42). It runs at module load and again from `Scripting.init` with `Date.now()` — different rolls each launch, as CE.
- `randomBetween(min, max)` — inclusive, swapped bounds allowed, out-of-range result warned and clamped to `min` (CE `randomBetween`).

`util.ts getRandomInt` is `randomBetween`; `randomRoll` (`util.ts`) is CE `randomRoll` + `randomTranslateRoll` (d100 from 1, criticals only from day 1, crit failure on a second d100 ≤ −delta / 10). Math.random is no longer overridden. `Scripting.setSeed(n)` (crawler) seeds the generator for repeatable runs.

Opcodes: `random` (0x80B4) → `randomBetween`; `roll_dice` (0x80B5) pops its two arguments and pushes 0, as CE's unimplemented handler. The Sniper perk rolls `randomBetween(1, 10) <= LUK` (`Combat.ts`, CE `combat.cc` attackCompute).

---

## 6. Distribution Comparison

Same generator, same seeding scheme, same ranges — the distributions are CE's. Neither CE nor DH2 saves the generator state.

---

## 7. Known Gaps

None. RN1–RN5 are fixed: time seed, `roll_dice` pushing 0, Sniper d10, d100 from 1, chi-squared self-test. <!-- audited: 2026-10-18 -->
