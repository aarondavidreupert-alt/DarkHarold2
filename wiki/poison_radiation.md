# Poison & Radiation Systems

CE refs: `critter.cc` (`critterGetPoison`, `critterAdjustPoison`, `poisonEventProcess`,
`critterGetRadiation`, `critterAdjustRadiation`, `_critter_check_rads`,
`radiationEventProcess`, `_process_rads`), `interpreter_extra.cc` (`opPoison`,
`opGetPoison`, `opRadiationIncrease`, `opRadiationDecrease`),
`scripts.cc` (`gameTimeEventProcess`), `queue.h`, `stat_defs.h`  
DH2 refs: `src/scripting.ts` (poison/radiation opcode methods), `src/vm_bridge.ts`
(wiring), `src/object.ts` (field declarations), `src/main.ts` (tick handling)

Cross-references: see `wiki/drug_addiction.md` for the queue event model; see
`wiki/critter_stats.md` for bonus vs base stat layer distinction.

---

## 1. Shared Infrastructure

Both systems store a numeric level on the critter's proto data:

```c
critter->data.critter.poison    // int, player only
critter->data.critter.radiation // int, player only
```

Both are processed via the queue system (`queue.h`):

```c
EVENT_TYPE_POISON    = 5
EVENT_TYPE_RADIATION = 6
```

**Critical constraint**: Both CE functions that accumulate poison/radiation
(`critterAdjustPoison`, `critterAdjustRadiation`) check `if (obj != gDude) return -1`
at the top. Non-player critters cannot be poisoned or irradiated through the normal
path. Scripts calling `poison(critter, amount)` on a non-player critter silently fail.
CE's comment on `critterAdjustPoison`: "For unknown reason this function only works
on dude."

**Resistance stats** (indices from `stat_defs.h`):

| Stat | ID | Notes |
|---|---|---|
| `STAT_RADIATION_RESISTANCE` | 31 | Applied percentage reduction on accumulation |
| `STAT_POISON_RESISTANCE` | 32 | Applied percentage reduction on accumulation |
| `STAT_CURRENT_POISON_LEVEL` | 36 | Pseudo-stat; `get_critter_stat(obj, 36)` reads live value |
| `STAT_CURRENT_RADIATION_LEVEL` | 37 | Pseudo-stat; `get_critter_stat(obj, 37)` reads live value |

These are the last two entries before `STAT_COUNT = 38`. They are pseudo-stats in the
sense that they read live runtime values (`critterGetPoison`, `critterGetRadiation`)
rather than the stored stat arrays.

---

## 2. Poison System

### Accumulation

`critterAdjustPoison(critter, amount)` (`critter.cc:327`):

1. Rejects non-player objects.
2. If `amount > 0`: apply resistance — `amount -= amount * STAT_POISON_RESISTANCE / 100`.
3. If `amount < 0` and current poison is already 0: no-op (avoids underflow).
4. `newPoison = current + amount`
5. If `newPoison > 0`:
   - Store new level.
   - Clear old EVENT_TYPE_POISON entries.
   - Schedule new event at `10 * (505 - 5 * newPoison)` ticks.
   - Display "You have been poisoned!" (or "You feel a little better" if amount < 0).
6. If `newPoison <= 0`: set to 0, display "You feel better."

**Timer formula**: delay in ticks = `10 * (505 - 5 * P)`, where P is the new poison level.

| Poison level | Event delay (ticks) | Game minutes (÷600) |
|---|---|---|
| 100 | 50 | ~0.08 min |
| 50 | 2550 | ~4.25 min |
| 20 | 4050 | ~6.75 min |
| 5 | 4775 | ~8 min |
| 1 | 4995 | ~8.3 min |

At high poison, events fire rapidly; as poison decays, intervals lengthen.

### Per-Event Processing

`poisonEventProcess(obj, data)` (`critter.cc:378`), fires when poison event triggers:

1. Calls `critterAdjustPoison(obj, -2)` — decays poison by 2 **and** reschedules the
   next event via the timer formula above (or clears it if poison reaches 0).
2. Calls `critterAdjustHitPoints(obj, -1)` — -1 HP.
3. Displays "You take damage from poison."
4. Returns 0 (keep event) if current HP > 5; returns 1 (stop) if HP ≤ 5.

Because step 1 already reschedules the next event via `critterAdjustPoison`, the
return value is effectively irrelevant to continuity — the decay is self-sustaining
until poison reaches 0.

### Summary of Poison Flow

```
critterAdjustPoison(+N)
  → apply resistance → newPoison stored → schedule EVENT_TYPE_POISON

EVENT_TYPE_POISON fires
  → poisonEventProcess
    → critterAdjustPoison(-2) [reschedules at lower P interval]
    → HP -= 1
    → repeat until poison = 0
```

Poison naturally decays to 0 without any external action. There is no separate
"cure" mechanic in CE beyond antidote items that call `critterAdjustPoison(obj, -N)`.

---

## 3. Radiation System

### Accumulation

`critterAdjustRadiation(obj, amount)` (`critter.cc:412`):

1. Rejects non-player objects.
2. If `amount > 0`: apply resistance — `amount -= STAT_RADIATION_RESISTANCE * amount / 100`.
3. If `amount > 0`: set `CRITTER_RADIATED` flag on proto data.
4. Geiger counter check: if Geiger Counter I or II is equipped and active, display
   click message (message 1009 "clicking wildly" if amount > 5, else 1008 "clicking").
5. If `amount >= 10`: display "You have received a large dose of radiation."
6. `obj->data.critter.radiation += amount` (clamp to 0 minimum).
7. Refresh indicator bar.

Radiation accumulates additively without decay. `critterAdjustRadiation` never
schedules an event; it only adds to the stored value and sets the flag.

### Daily Check (`_critter_check_rads`)

`_critter_check_rads(gDude)` (`critter.cc:487`) is called by `gameTimeEventProcess`
(`scripts.cc:424`) which fires **once per in-game day at midnight**.

1. Rejects non-player objects.
2. Checks `CRITTER_RADIATED` flag — if not set, skip.
3. Clears old EVENT_TYPE_RADIATION entries (capturing old level via `_get_rad_damage_level`).
4. Maps current radiation to a severity level:

   | Rads | Level |
   |---|---|
   | 0–99 | NONE |
   | 100–199 | MINOR |
   | 200–399 | ADVANCED |
   | 400–599 | CRITICAL |
   | 600–999 | DEADLY |
   | 1000+ | FATAL |

5. Endurance roll: `statRoll(obj, STAT_ENDURANCE, modifier[level], nullptr)`. If roll
   fails, advance level by 1 (up to FATAL maximum). Endurance modifiers:

   | Level | END modifier |
   |---|---|
   | NONE | +2 (easier roll) |
   | MINOR | 0 |
   | ADVANCED | −2 |
   | CRITICAL | −4 |
   | DEADLY | −6 |
   | FATAL | −8 |

6. If new level > old level: schedule a `RadiationEvent` at
   `GAME_TIME_TICKS_PER_HOUR * randomBetween(4, 18)` ticks (4–18 in-game hours).
7. Clear `CRITTER_RADIATED` flag.

### Radiation Event Processing

`radiationEventProcess(obj, data)` (`critter.cc:627`):

- If damage event (`isHealing = 0`): clear any pending healing events, schedule a
  healing event (`isHealing = 1`) at `GAME_TIME_TICKS_PER_DAY * 7` (7 in-game days).
- Call `_process_rads(obj, level, isHealing)`.

`_process_rads(obj, level, isHealing)` (`critter.cc:566`):

1. Display level message (or "You feel better" on healing).
2. For each of 8 effect slots: apply `modifier * penalty[level-1][effect]` to bonus
   stat (`critterSetBonusStat`).
3. If not healing: check if any of the 6 primary stats (STR–AGI) dropped below
   `PRIMARY_STAT_MIN = 1`. If so, kill the critter.
4. If dead: display "You have died from radiation sickness."

### Radiation Effect Tables

Stats affected (`gRadiationEffectStats[8]`):
STR (0), PER (1), END (2), CHA (3), INT (4), AGI (5), CURRENT_HP (6), HEALING_RATE (7)

Penalty per level (`gRadiationEffectPenalties[level][effect]`):

| Level | STR | PER | END | CHA | INT | AGI | HP | Heal Rate |
|---|---|---|---|---|---|---|---|---|
| NONE | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| MINOR | −1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ADVANCED | −1 | 0 | 0 | 0 | 0 | −1 | 0 | −3 |
| CRITICAL | −2 | 0 | −1 | 0 | 0 | −2 | −5 | −5 |
| DEADLY | −4 | −3 | −3 | −3 | −1 | −5 | −15 | −10 |
| FATAL | −6 | −5 | −5 | −5 | −3 | −6 | −20 | −10 |

Effects are applied to the **bonus layer** and removed 7 days later (healing event).
Radiation itself never auto-decays — only `radiation_dec` (or RadAway) reduces the
stored radiation value.

### Summary of Radiation Flow

```
critterAdjustRadiation(+N)
  → apply resistance → store rad level → set CRITTER_RADIATED flag

midnight (gameTimeEventProcess)
  → _critter_check_rads
    → convert rads to level → endurance roll
    → schedule radiation damage event (4–18 hours away)

radiation damage event fires
  → _process_rads: apply bonus-layer stat penalties
  → schedule healing event (7 days away)

healing event fires
  → _process_rads(isHealing=true): reverse stat penalties
```

---

## 4. Scripting Interface

### Opcodes

| Opcode | Hex | CE function | Description |
|---|---|---|---|
| `poison` | 0x8122 | `opPoison` → `critterAdjustPoison` | Add/remove poison |
| `get_poison` | 0x8123 | `opGetPoison` → `critterGetPoison` | Read current poison |
| `radiation_inc` | 0x80FD | `opRadiationIncrease` → `critterAdjustRadiation` | Add radiation |
| `radiation_dec` | 0x80FE | `opRadiationDecrease` → `critterAdjustRadiation(-n)` | Remove radiation |

**Note on `radiation_dec`**: CE's `opRadiationDecrease` reads current radiation,
computes `adjustment = (radiation >= 0) ? -amount : 0`, then calls
`critterAdjustRadiation(object, adjustment)`. Because `critterAdjustRadiation` only
works on `gDude`, this also silently fails on non-player objects.

### Pseudo-stat Queries

Scripts read current poison and radiation via `get_critter_stat`:

```
get_critter_stat(obj, 36)  // STAT_CURRENT_POISON_LEVEL → critterGetPoison(obj)
get_critter_stat(obj, 37)  // STAT_CURRENT_RADIATION_LEVEL → critterGetRadiation(obj)
```

---

## 5. DH2 Implementation Status

### Fields

`src/object.ts:1210–1212`:

```typescript
poisonLevel: number = 0
radiationLevel: number = 0
```

Both are in the serialized field list (`object.ts:1899`), so they persist across
save/load.

### Opcode Wiring

| Opcode | Hex | DH2 method | vm_bridge wired |
|---|---|---|---|
| `poison` | 0x8122 | `scripting.ts:989` ✅ | ❌ Not in vm_bridge |
| `get_poison` | 0x8123 | `scripting.ts:887` ✅ | ✅ `vm_bridge.ts:150` |
| `radiation_inc` | 0x80FD | ❌ Not implemented | ❌ Not in vm_bridge |
| `radiation_dec` | 0x80FE | `scripting.ts:993` ✅ | ❌ Not in vm_bridge |

The `poison` opcode method exists but is unreachable from scripts — any script
calling `poison(self_obj, 10)` will receive no error and no effect because 0x8122 is
not in `bridgeOpMap`. Similarly `radiation_dec`. `radiation_inc` is missing entirely.

### Pseudo-stat Queries (`get_critter_stat`)

`statMap` in `scripting.ts:90–100` contains only:
`{0:STR, 1:PER, 2:END, 3:CHA, 4:INT, 5:AGI, 6:LUK, 7:"Max HP", 35:HP}`.

Stat IDs 31 (radiation resistance), 32 (poison resistance), 36 (current poison),
and 37 (current radiation) are not in `statMap`. Calling `get_critter_stat(obj, 36)`
falls through to `stub()` and returns 5. Scripts that check current poison or
radiation via `get_critter_stat` will always get the wrong value.

### Poison Tick (`main.ts:1063–1070`)

Runs every 600-tick game cycle:

```typescript
const dmg = Math.floor(player.poisonLevel / 10)
if (dmg > 0) player.stats.modifyBase('HP', -dmg)
player.poisonLevel = Math.max(0, player.poisonLevel - 1)
```

**Deviations from CE:**

1. **Timer**: CE uses variable `10 * (505 - 5 * P)` ticks per event (shortening as
   poison increases). DH2 runs every fixed 600-tick cycle.

2. **HP damage formula**: CE deals flat −1 HP per event. DH2 deals `floor(P / 10)`
   HP per cycle — linear scaling with current level. At P=100 that's −10 HP/cycle;
   at P=10 that's −1 HP/cycle.

3. **Decay rate**: CE decays −2 per event. DH2 decays −1 per cycle.

4. **Stat layer**: CE `critterAdjustHitPoints` modifies HP directly (current HP
   field). DH2 uses `modifyBase('HP', ...)` which adds to base HP, which can
   permanently push base HP below 0.

5. **Poison resistance not applied on `poison()` call**: CE's `critterAdjustPoison`
   reduces incoming amount by `amount * STAT_POISON_RESISTANCE / 100`. DH2's
   `poison()` method (`scripting.ts:989`) applies no resistance.

6. **Non-player critters**: CE rejects non-player silently. DH2 `poison()` method
   sets `poisonLevel` on any Critter object passed to it.

### Radiation Symptom Tick (`main.ts:1075–1158`)

Runs every 600-tick cycle:

```typescript
function applyRadiationSymptoms(player: Critter): void {
    const rads = player.radiationLevel
    if (rads >= 1000) { uiLog('Radiation: You are dying!'); player.stats.modifyBase('HP', -10) }
    else if (rads >= 600) { uiLog('Radiation: Critical!'); player.stats.modifyBase('HP', -4) }
    else if (rads >= 450) { uiLog('Radiation: Acute sickness') }
    else if (rads >= 300) { uiLog('Radiation: Nausea') }
    // Below 300 rads: no symptoms
}
```

**Deviations from CE:**

1. **No stat penalties**: CE applies a full 8-stat bonus-layer penalty table (STR,
   PER, END, CHA, INT, AGI, HP, Healing Rate). DH2 only deals direct HP damage at
   two thresholds (600+ and 1000+). All SPECIAL stat reductions are absent.

2. **Continuous tick model**: CE schedules a one-shot damage event 4–18 hours after
   exposure, followed by a healing event 7 days later. DH2 applies symptoms every
   600 game ticks continuously while `radiationLevel > 0`.

3. **No endurance roll**: CE rolls STAT_ENDURANCE (with level-dependent modifier)
   and can worsen the radiation severity level by 1. DH2 has no roll.

4. **Threshold mismatch**: CE thresholds (100/200/400/600/1000) determine which
   severity level's penalty table to apply. DH2 thresholds (300/450/600/1000) only
   gate messages and HP damage — they don't correspond to CE's level boundaries.

5. **Stat layer**: DH2 uses `modifyBase('HP', ...)` (permanent base modification).
   CE uses `critterSetBonusStat` (bonus layer, reversed 7 days later).

6. **No radiation resistance on `radiation_inc`**: `radiation_inc` (0x80FD) is not
   implemented in DH2. Scripts that call `radiation_inc` would trigger a missing
   opcode. `critterAdjustRadiation` applies resistance before adding; DH2 has no
   equivalent path.

7. **No RadAway integration**: CE's RadAway drug calls `critterAdjustRadiation(obj,
   -N)` (via the drug proto effect system). DH2's `drugs.ts` has a `specialEffect:
   'radaway'` case for RadAway but the actual radiation level reduction is not
   implemented (status unclear — verify against `src/drugs.ts` `radaway` handler).

---

## 6. DH2 Implementation Status Summary

| Mechanic | CE source | DH2 status |
|---|---|---|
| `poisonLevel` field | `critter.data.critter.poison` | ✅ `object.ts:1211`; serialized |
| `radiationLevel` field | `critter.data.critter.radiation` | ✅ `object.ts:1212`; serialized |
| `poison` opcode (0x8122) | `critter.cc:critterAdjustPoison` | 🟡 Method in `scripting.ts:989`; NOT wired in vm_bridge |
| `get_poison` opcode (0x8123) | `critter.cc:critterGetPoison` | ✅ Wired `vm_bridge.ts:150`; correct |
| `radiation_inc` opcode (0x80FD) | `interpreter_extra.cc:opRadiationIncrease` | ❌ Not implemented; not wired |
| `radiation_dec` opcode (0x80FE) | `interpreter_extra.cc:opRadiationDecrease` | 🟡 Method in `scripting.ts:993`; NOT wired in vm_bridge |
| `get_critter_stat(obj, 36)` (poison level) | `stat.cc via STAT_CURRENT_POISON_LEVEL` | ❌ Not in `statMap`; returns stub value 5 |
| `get_critter_stat(obj, 37)` (radiation level) | `stat.cc via STAT_CURRENT_RADIATION_LEVEL` | ❌ Not in `statMap`; returns stub value 5 |
| Poison resistance applied on accumulation | `critterAdjustPoison: amount * resistance / 100` | ❌ Missing from DH2 `poison()` method |
| Poison tick interval | Variable `10*(505-5*P)` ticks | ❌ Fixed 600-tick cycle |
| Poison HP damage | −1 HP per event | ❌ `floor(P/10)` HP per cycle |
| Poison decay | −2 per event | ❌ −1 per cycle |
| Radiation resistance on `radiation_inc` | `critterAdjustRadiation`: `amount * resistance / 100` | ❌ No `radiation_inc` at all |
| Radiation event scheduling (daily check) | `_critter_check_rads` at midnight | ❌ Not implemented |
| Endurance roll on radiation check | `statRoll(END, modifier[level])` | ❌ Not implemented |
| Radiation stat penalties (bonus layer) | `_process_rads`: 8 stats | ❌ Only HP damage in DH2 |
| Radiation healing event (7-day reversal) | `radiationEventProcess: isHealing=1` | ❌ Not implemented |
| Non-player critter restriction | `critterAdjustPoison/Radiation: gDude only` | 🟡 DH2 applies to any critter passed |

---

## 7. Known Issues and Flags

**`radiation_inc` entirely absent**: Scripts that call `radiation_inc(self_obj, N)`
(common in map scripts for radioactive zones) will trigger a missing-opcode path.
No DH2 method or vm_bridge entry exists for 0x80FD.

**`poison` and `radiation_dec` not reachable from scripts**: Both methods exist in
`scripting.ts` but are not wired in `vm_bridge.ts`. Any script opcode calls to
0x8122 or 0x80FE are silently ignored.

**`get_critter_stat(obj, 36/37)` returns 5**: Scripts that test whether the player
is poisoned or irradiated via `get_critter_stat(SELF_OBJ, 36)` will always receive
5, making conditional branching on current poison/radiation level impossible.

**RadAway radiation reduction**: DH2 `drugs.ts` routes RadAway through
`specialEffect: 'radaway'` but the handler's actual effect on `radiationLevel` was
not confirmed during this audit. Verify `handleSpecialEffect('radaway', ...)` in
`drugs.ts` before assuming radiation is reduced.

**DH2 `modifyBase` vs CE direct field/bonus layer**: Both poison HP damage and
radiation HP damage use `modifyBase('HP', -N)`, which permanently lowers base HP.
CE's `critterAdjustHitPoints` modifies the current HP field (not base), and
`critterSetBonusStat` for radiation effects is reversed 7 days later. DH2's approach
causes permanent base HP degradation that compounds across reloads.
