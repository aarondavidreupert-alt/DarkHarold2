# Status Effects (Drug, Addiction, Poison, Radiation)

CE refs: `item.cc` (`_item_d_take_drug`, `_insert_drug_effect`, `_insert_withdrawal`,
`performWithdrawalStart`, `performWithdrawalEnd`, `_perform_drug_effect`, `_drug_effect_allowed`),
`proto_types.h` (PROTO_ID constants), `queue.h` (EVENT_TYPE constants),
`critter.cc` (`critterGetPoison`, `critterAdjustPoison`, `poisonEventProcess`,
`critterGetRadiation`, `critterAdjustRadiation`, `_critter_check_rads`,
`radiationEventProcess`, `_process_rads`),
`interpreter_extra.cc` (`opPoison`, `opGetPoison`, `opRadiationIncrease`, `opRadiationDecrease`),
`scripts.cc` (`gameTimeEventProcess`), `stat_defs.h`  
DH2 refs: `src/drugs.ts`, `src/scripting.ts` (drug/poison/radiation opcode methods,
metarule case 18), `src/vm_bridge.ts` (wiring), `src/object/Critter.ts` (field declarations),
`src/gameTick.ts` (tick handling), `src/char.ts`

Cross-references: see `wiki/perks_traits.md` for perk/trait effect application; see
`wiki/critter_stats.md` for stat bonus layer vs base layer distinction.

<!-- audited: 2026-06-02 -->

---

## §1. Drug System

### §1.1 Drug Proto Data Model

Drug items use the item proto type (`ProtoItem.type = ITEM_TYPE_DRUG`). The relevant
fields from `proto_types.h` (struct `ItemData.drug`):

```c
struct {
    int stat[3];          // stat IDs for immediate effect; -1 = skip slot; -2 at stat[0] = random range
    int amount[3];        // immediate effect amounts; if stat[0]==-2, amount[0]=min, amount[1]=max
    int duration1;        // ticks before first deferred effect (in game minutes → × 600 ticks)
    int stat1[3];         // stat IDs for first deferred effect
    int amount1[3];       // amounts for first deferred effect
    int duration2;        // ticks before second deferred effect
    int stat2[3];         // stat IDs for second deferred effect
    int amount2[3];       // amounts for second deferred effect
    int addictionChance;  // 0–100; 0 = non-addictable
    int withdrawalEffect; // perk ID applied during withdrawal; -1 if no addiction
    int withdrawalOnset;  // game minutes until withdrawal begins after last use
} drug;
```

#### Stat Encoding

- `stat[n] == -1`: slot unused, skip.
- `stat[n] == -2` at index 0: the stat fields are reinterpreted as a random HP range:
  `amount[0]` = min HP gain, `amount[1]` = max HP gain. Used by Super Stimpak's
  delayed negative HP effect.
- Stat IDs map to `STAT_*` constants (e.g., `STAT_STRENGTH = 0`, `STAT_ENDURANCE = 2`,
  `STAT_AGILITY = 6`, `STAT_CURRENT_HIT_POINTS = 6` — note HP uses a different
  constant in the stat context vs the effect context).

#### Effect Application

`_perform_drug_effect` (`item.cc:2639`):

1. If `stat[0] == -2`: randomize amount between `amount[0]` and `amount[1]`.
2. For each non-(-1) stat slot: call `critterSetBonusStat(critter, statID, current + amount)`.
3. HP special case: if the resulting current HP ≤ 0 for a non-player critter, kill it
   with a "succumbs to adverse effects" message.

**Critical**: CE uses `critterSetBonusStat` — the **bonus layer** — not base stat
modification. Effects are not permanent; they can be added and removed without
corrupting the character's underlying stat block.

---

### §1.2 Drug Use Flow

`_item_d_take_drug` (`item.cc:2776`) — entry point when player uses a drug item:

```
1. Reject if critter is dead or CRITTER_TYPE_ROBOT.
2. Jet Antidote special path: if addicted to Jet (GVAR_ADDICT_JET), clear the Jet
   withdrawal queue and call dudeClearAddiction(PROTO_ID_JET). Return.
3. Clear any existing withdrawal-start queue entries for the same addiction GVAR
   (prevents old pending withdrawal from firing after re-use).
4. Check _drug_effect_allowed(critter, pid): counts current EVENT_TYPE_DRUG queue
   entries for this pid. If count >= field_8 (the per-drug concurrent cap), skip
   all effects and addiction roll entirely.
5. Apply immediate effect via _perform_drug_effect (immediate stat delta, HP gain/loss).
6. If duration1 > 0: _insert_drug_effect(critter, delay=600*duration1, effect1).
7. If duration2 > 0: _insert_drug_effect(critter, delay=600*duration2, effect2).
8. Addiction roll — ONLY if not already addicted (dudeIsAddicted check):
     if (randomBetween(1, 100) <= addictionChance) {
         _insert_withdrawal(critter, pending=1, onset=withdrawalOnset, perk, pid);
         dudeSetAddiction(pid);
     }
```

The addiction check fires on **use**, not on effect expiry.

#### Concurrent Effect Cap (`field_8`)

`gDrugDescriptions` (`item.cc:144`) maps PIDs to their addiction GVAR and a
concurrent-dose cap:

| Drug | PROTO_ID | GVAR | `field_8` (cap) |
|---|---|---|---|
| Nuka-Cola | 106 | GVAR_NUKA_COLA_ADDICT | 0 (unlimited) |
| Buffout | 87 | GVAR_BUFF_OUT_ADDICT | 4 |
| Mentats | 53 | GVAR_MENTATS_ADDICT | 4 |
| Psycho | 110 | GVAR_PSYCHO_ADDICT | 4 |
| Rad-Away | 48 | GVAR_RADAWAY_ADDICT | 0 (unlimited) |
| Beer | 124 | GVAR_ALCOHOL_ADDICT | 0 (unlimited) |
| Booze | 125 | GVAR_ALCOHOL_ADDICT | 0 (unlimited) |
| Jet | 259 | GVAR_ADDICT_JET | 4 |
| Tragic Cards | 304 | GVAR_ADDICT_TRAGIC | 0 (unlimited) |

When `field_8 == 0`, `_drug_effect_allowed` returns true unconditionally (no cap check).
When `field_8 > 0`, at most `field_8` active EVENT_TYPE_DRUG entries for that pid
can exist simultaneously; a fifth dose of Buffout has no effect.

#### Deferred Effect Scheduling

`_insert_drug_effect` (`item.cc:2598`):

```c
int delay = 600 * duration;
if (critter == gDude && traitIsSelected(TRAIT_CHEM_RESISTANT)) delay /= 2;
queueAddEvent(delay, critter, drugEffectEvent, EVENT_TYPE_DRUG);
```

The **Chem Resistant** trait halves the deferred delay — meaning the beneficial
effect wears off sooner (or the harmful deferred effect arrives sooner).

---

### §1.3 Non-Addictable Drugs

These drugs use the drug proto type but have `addictionChance = 0` (or aren't in
`gDrugDescriptions`):

**Stimpak** (`PROTO_ID_STIMPACK = 40`): Immediate HP restoration. No deferred effects,
no addiction.

**Super Stimpak** (`PROTO_ID_SUPER_STIMPACK = 144`): Large immediate HP gain; second
deferred effect uses the `stat[0] == -2` random-range encoding for a negative HP
delta (crash) after the duration. Appears in `gDrugDescriptions` with cap 0 but
`GVAR_RADAWAY_ADDICT` (shared slot) — verify against actual proto data before
implementing.

**Rad-Away** (`PROTO_ID_RADAWAY = 48`): Removes radiation. Appears in `gDrugDescriptions`
with `GVAR_RADAWAY_ADDICT`. Whether this GVAR is actually set during normal use
is unclear — the `addictionChance` in its proto is likely 0. CE radiation reduction
uses a separate radiation system, not a bonus-stat delta.

**Rad-X**: No `PROTO_ID_RAD_X` named constant exists in `proto_types.h` or anywhere
in the CE source that was searched. Rad-X may be implemented as an item with
special-cased logic in the radiation system rather than the drug proto type, or
may be accessed by numeric PID only. **Status: unclear.** Do not implement Rad-X
as a standard drug item without resolving this.

---

### §1.4 Drug Reference Table

Effects extracted from CE proto data (via `proto.dat` extraction, not hardcoded
in C++; the C++ describes the _schema_, not the values). Values below are from the
canonical Fallout 2 proto data:

| Drug | PROTO_ID | Addiction % | Withdrawal Perk | Onset (min) |
|---|---|---|---|---|
| Buffout | 87 | 10% | PERK_BUFFOUT_WITHDRAWAL | 168 (7 hrs) |
| Mentats | 53 | 20% | PERK_MENTATS_WITHDRAWAL | 168 |
| Psycho | 110 | 10% | PERK_PSYCHO_WITHDRAWAL | 168 |
| Jet | 259 | 100% | PERK_JET_WITHDRAWAL | 0 (immediate) |
| Nuka-Cola | 106 | 10% | PERK_NUKA_COLA_WITHDRAWAL | 168 |
| Beer | 124 | 20% | PERK_ALCOHOL_WITHDRAWAL | 168 |
| Booze | 125 | 20% | PERK_ALCOHOL_WITHDRAWAL | 168 |
| Rad-Away | 48 | ~0% | (none practical) | — |
| Tragic Cards | 304 | 25% | PERK_TRAGIC_WITHDRAWAL | 168 |

Jet's `withdrawalOnset = 0` means the withdrawal start event fires immediately on
the next queue processing cycle after use — it is practically immediate.

---

### §1.5 DH2 Drug Implementation Status

`src/drugs.ts` implements 8 drugs with several significant deviations from CE.

#### Covered Drugs

| Drug | CE PID | DH2 `pidID` | Covered |
|---|---|---|---|
| Stimpak | 40 | 24 | ✅ (pidID mismatch — see below) |
| Super Stimpak | 144 | 75 | ✅ (pidID mismatch) |
| Psycho | 110 | 28 | ✅ (pidID mismatch) |
| Buffout | 87 | 27 | ✅ (pidID mismatch) |
| Jet | 259 | 119 | ✅ (pidID mismatch) |
| Nuka-Cola | 106 | 164 | ✅ (pidID mismatch) |
| Rad-Away | 48 | 29 | ✅ (pidID mismatch) |
| Antidote | — | 51 | ✅ (CE-specific path, reasonable) |
| Mentats | 53 | — | ❌ Missing |
| Beer | 124 | — | ❌ Missing |
| Booze | 125 | — | ❌ Missing |
| Tragic Cards | 304 | — | ❌ Missing |

#### `pidID` vs `PROTO_ID` Discrepancy

DH2 `drugs.ts` uses `pidID = pid & 0xFFFF` (item PID low-word). CE `PROTO_ID_*`
constants appear to be the same low-word values for item-type protos (type 0, so
the full PID equals `PROTO_ID`). The mismatch is real — DH2 Stimpak pidID=24 vs
CE STIMPACK=40. This likely means DH2's `pidID` values are simply wrong and do not
match the actual extracted proto PIDs. **Verify against `proto/items/*.json`
before any fix** — the JSON files contain the actual extracted PID values that the
runtime uses.

---

## §2. Addiction System

### §2.1 Addiction Tracking

#### State Storage

Addiction state lives in two places:

1. **GVARs** (e.g., `GVAR_NUKA_COLA_ADDICT`, `GVAR_BUFF_OUT_ADDICT`, etc.) —
   globally accessible, serialized in save files, queryable from scripts via
   `get_global_var`. Set to 1 by `dudeSetAddiction`, cleared by `dudeClearAddiction`.

2. **`DUDE_STATE_ADDICTED`** flag on the player critter — bitfield state, cleared
   when the last addiction GVAR is cleared. Used for HUD indicator.

`dudeIsAddicted(pid)` (`item.cc`) checks the GVAR for the given PID.

#### Script Access

Scripts check addiction via:
```
get_global_var(GVAR_BUFF_OUT_ADDICT)  // 1 if addicted, 0 if not
```

There is no `metarule` for "is addicted to X" — scripts read GVARs directly.

---

### §2.2 Withdrawal Flow

Withdrawal uses a two-step queue sequence. Both events use `EVENT_TYPE_WITHDRAWAL = 2`.

#### Step 1: Withdrawal Start (pending)

`_insert_withdrawal(obj, pending=1, onset, perk, pid)` schedules an event at
`600 * onset` ticks. When it fires, `performWithdrawalStart` (`item.cc:3039`) runs:

```c
void performWithdrawalStart(Object* obj, int perk, int pid) {
    perkAddEffect(obj, perk);        // apply withdrawal perk effect (stat penalties)
    int duration = 10080;            // game minutes ≈ 7 days
    if (traitIsSelected(TRAIT_CHEM_RELIANT)) duration /= 2;
    if (perkGetRank(obj, PERK_FLOWER_CHILD)) duration /= 2;
    _insert_withdrawal(obj, pending=0, duration, perk, pid);  // schedule end event
}
```

The withdrawal perk is applied via `perkAddEffect` — same mechanism as an earned
perk, using the bonus layer. The perk carries negative stat modifiers that persist
until removed.

#### Step 2: Withdrawal End

When the end event fires, `performWithdrawalEnd` runs:

```c
void performWithdrawalEnd(Object* obj, int perk, int pid) {
    if (pid == PROTO_ID_JET) return;  // Jet withdrawal never auto-clears
    perkRemoveEffect(obj, perk);      // remove stat penalties
    dudeClearAddiction(pid);          // clear GVAR + DUDE_STATE_ADDICTED
}
```

**Jet is a special case**: `performWithdrawalEnd` returns immediately for Jet — the
withdrawal perk stays active indefinitely until the player uses Jet Antidote. Only
`_item_d_take_drug` with Jet Antidote calls `dudeClearAddiction(PROTO_ID_JET)`.

#### Trait/Perk Modifiers Summary

| Modifier | Effect |
|---|---|
| **Chem Resistant** (trait) | Deferred drug effect delay ÷ 2 (wears off / kicks in sooner) |
| **Chem Reliant** (trait) | Withdrawal duration ÷ 2 (shorter suffering, but addiction triggers more easily — not a CE mechanic, just context) |
| **Flower Child** (perk) | Withdrawal duration ÷ 2 (stacks with Chem Reliant) |

---

### §2.3 DH2 Addiction Deviations

#### Deviation 1: Addiction Roll Timing

**CE**: Addiction rolls on **use** (`_item_d_take_drug` step 8).  
**DH2**: Addiction rolls at **effect expiry** (inside the reversal callback in
`drugs.ts`). This is incorrect — a player who uses a drug and immediately takes
it again before the effect expires would never trigger the addiction roll in DH2.

#### Deviation 2: Stat Application Layer

**CE**: Uses `critterSetBonusStat` — applies to the **bonus layer**. Drug effects are
separate from base stats and can be cleanly removed.  
**DH2**: Uses `modifyBase` — applies directly to `baseStats`. When the drug wears off,
the reversal `modifyBase` subtracts the amount. This works for simple cases but
breaks down with repeated doses (double-subtract), level-ups mid-effect, and
stat caps.

#### Deviation 3: Withdrawal Model

**CE**: Discrete two-event queue sequence. Withdrawal perk is applied for a fixed
`10080 * 600` ticks and then removed; addiction GVAR cleared at end.  
**DH2**: `tickAddictions` (`drugs.ts`) runs every 600 ticks and applies a stat penalty
on every tick that the player is addicted. This is a continuous tick-based bleed,
not a bounded withdrawal period. There is no "withdrawal ends" event; the penalty
persists as long as `(player as any).addictions` includes the drug name.

#### Deviation 4: Addiction State Not Script-Queryable

**CE**: Addiction stored in GVARs; scripts read `get_global_var(GVAR_BUFF_OUT_ADDICT)`.  
**DH2**: Addiction stored in `(critter as any).addictions: string[]` — a plain array
on the critter object. Scripts cannot query this; `get_global_var` for addiction
GVARs will always return 0.

#### Deviation 5: `metarule(WHO_ON_DRUGS)` Parameter

**CE**: `METARULE_WHO_ON_DRUGS` (metarule ID 18) takes a critter object as parameter
and returns whether that critter has active drug effects.  
**DH2** (`scripting.ts:481`): Uses `this.self` (the script's own critter) instead of
reading the opcode parameter. The parameter is ignored. This works correctly only
when the target critter is the script's self object.

#### Deviation 6: Concurrent Dose Cap Not Implemented

**CE**: `_drug_effect_allowed` prevents stacking more than `field_8` doses of the
same drug.  
**DH2**: No equivalent check. All doses apply regardless of how many active effects
exist.

#### Deviation 7: Jet Special Case Not Implemented

**CE**: Jet withdrawal is permanent until Jet Antidote is used; `performWithdrawalEnd`
short-circuits for `PROTO_ID_JET`.  
**DH2**: No special Jet behaviour. The `antidote` special effect in DRUG_TABLE is for
generic antidote (pid 51), not Jet Antidote.

---

## §3. Poison System

### §3.1 Shared Infrastructure (Poison & Radiation)

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

### §3.2 Poison Accumulation

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

---

### §3.3 Per-Event Processing

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

### §3.4 Poison Scripting Interface

| Opcode | Hex | CE function | Description |
|---|---|---|---|
| `poison` | 0x8122 | `opPoison` → `critterAdjustPoison` | Add/remove poison |
| `get_poison` | 0x8123 | `opGetPoison` → `critterGetPoison` | Read current poison |

Scripts also read current poison via `get_critter_stat`:
```
get_critter_stat(obj, 36)  // STAT_CURRENT_POISON_LEVEL → critterGetPoison(obj)
```

---

### §3.5 DH2 Poison Implementation Status

#### Fields

`src/object/Critter.ts`:

```typescript
poisonLevel: number = 0
```

Serialized in the field list (`object/Critter.ts`), so it persists across save/load.

#### Opcode Wiring

| Opcode | Hex | DH2 method | vm_bridge wired |
|---|---|---|---|
| `poison` | 0x8122 | `scripting.ts:989` ✅ | ❌ Not in vm_bridge |
| `get_poison` | 0x8123 | `scripting.ts:887` ✅ | ✅ `vm_bridge.ts:150` |

The `poison` opcode method exists but is unreachable from scripts — any script
calling `poison(self_obj, 10)` will receive no error and no effect because 0x8122 is
not in `bridgeOpMap`.

#### Pseudo-stat Queries (`get_critter_stat`)

`statMap` in `scripting.ts:90–100` contains only:
`{0:STR, 1:PER, 2:END, 3:CHA, 4:INT, 5:AGI, 6:LUK, 7:"Max HP", 35:HP}`.

Stat IDs 32 (poison resistance) and 36 (current poison) are not in `statMap`.
Calling `get_critter_stat(obj, 36)` falls through to `stub()` and returns 5.
Scripts that check current poison via `get_critter_stat` will always get the wrong value.

#### Poison Tick (`main.ts:1063–1070`)

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

---

## §4. Radiation System

### §4.1 Radiation Accumulation

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

---

### §4.2 Daily Check (`_critter_check_rads`)

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

---

### §4.3 Radiation Event Processing

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

#### Radiation Effect Tables

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

### §4.4 Radiation Scripting Interface

| Opcode | Hex | CE function | Description |
|---|---|---|---|
| `radiation_inc` | 0x80FD | `opRadiationIncrease` → `critterAdjustRadiation` | Add radiation |
| `radiation_dec` | 0x80FE | `opRadiationDecrease` → `critterAdjustRadiation(-n)` | Remove radiation |

**Note on `radiation_dec`**: CE's `opRadiationDecrease` reads current radiation,
computes `adjustment = (radiation >= 0) ? -amount : 0`, then calls
`critterAdjustRadiation(object, adjustment)`. Because `critterAdjustRadiation` only
works on `gDude`, this also silently fails on non-player objects.

Scripts also read current radiation via `get_critter_stat`:
```
get_critter_stat(obj, 37)  // STAT_CURRENT_RADIATION_LEVEL → critterGetRadiation(obj)
```

---

### §4.5 DH2 Radiation Implementation Status

#### Fields

`src/object/Critter.ts`:

```typescript
radiationLevel: number = 0
```

Serialized in the field list (`object/Critter.ts`), so it persists across save/load.

#### Opcode Wiring

| Opcode | Hex | DH2 method | vm_bridge wired |
|---|---|---|---|
| `radiation_inc` | 0x80FD | ❌ Not implemented | ❌ Not in vm_bridge |
| `radiation_dec` | 0x80FE | `scripting.ts:993` ✅ | ❌ Not in vm_bridge |

`radiation_inc` is missing entirely. `radiation_dec` exists as a method but is
unreachable from scripts because 0x80FE is not in `bridgeOpMap`.

#### Pseudo-stat Queries (`get_critter_stat`)

Stat IDs 31 (radiation resistance) and 37 (current radiation) are not in `statMap`.
Calling `get_critter_stat(obj, 37)` falls through to `stub()` and returns 5.
Scripts that check current radiation via `get_critter_stat` will always get the wrong value.

#### Radiation Symptom Tick (`main.ts:1075–1158`)

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

## §5. Known Gaps

Unified gap table covering all four systems (drug use, addiction, poison, radiation).

### Drug & Addiction Gaps

| Mechanic | CE source | DH2 status |
|---|---|---|
| Drug proto schema | `proto_types.h` + `item.cc:_perform_drug_effect` | 🟡 Hardcoded table in `drugs.ts` rather than reading proto data; values may differ |
| Addiction roll timing | `item.cc:_item_d_take_drug` (on USE) | ❌ Rolls at effect expiry |
| Stat effect layer | `item.cc:critterSetBonusStat` (bonus layer) | ❌ `modifyBase` (base layer) |
| Concurrent dose cap (`field_8`) | `item.cc:_drug_effect_allowed` | ❌ Not implemented |
| Withdrawal model | Two-event queue; perk for 10080 min; then removed | ❌ Continuous per-tick penalty with no end condition |
| Addiction GVARs | `dudeSetAddiction` / `dudeClearAddiction` | ❌ `critter.addictions[]` array; not GVAR-backed |
| `metarule(WHO_ON_DRUGS)` parameter | Takes target critter as param | 🟡 Uses `this.self`; ignores parameter |
| Jet permanent withdrawal | `performWithdrawalEnd` short-circuits for Jet | ❌ Not implemented |
| Chem Resistant (deferred delay) | `_insert_drug_effect`: delay ÷ 2 | ❌ Not implemented |
| Chem Reliant (withdrawal duration) | `performWithdrawalStart`: duration ÷ 2 | ❌ Not implemented |
| Flower Child perk | `performWithdrawalStart`: duration ÷ 2 | ❌ Not implemented |
| Mentats, Beer, Booze, Tragic Cards | `gDrugDescriptions` | ❌ Missing from DRUG_TABLE |
| `pidID` correctness | CE PROTO_ID values | ❌ DH2 values don't match CE constants; verify against `proto/items/*.json` |
| Rad-X PID | `proto_types.h` / CE source | ❌ No `PROTO_ID_RAD_X` found; do not implement until CE handling identified |
| Super Stimpak GVAR | `gDrugDescriptions` shares `GVAR_RADAWAY_ADDICT` | 🟡 Verify `addictionChance` in proto before implementing |

### Poison & Radiation Gaps

| Mechanic | CE source | DH2 status |
|---|---|---|
| `poisonLevel` field | `critter.data.critter.poison` | ✅ `src/object/Critter.ts`; serialized |
| `radiationLevel` field | `critter.data.critter.radiation` | ✅ `src/object/Critter.ts`; serialized |
| `poison` opcode (0x8122) | `critter.cc:critterAdjustPoison` | 🟡 Method in `scripting.ts:989`; NOT wired in vm_bridge |
| `get_poison` opcode (0x8123) | `critter.cc:critterGetPoison` | ✅ Wired `vm_bridge.ts:150`; correct |
| `radiation_inc` opcode (0x80FD) | `interpreter_extra.cc:opRadiationIncrease` | ❌ Not implemented; not wired |
| `radiation_dec` opcode (0x80FE) | `interpreter_extra.cc:opRadiationDecrease` | 🟡 Method in `scripting.ts:993`; NOT wired in vm_bridge |
| `get_critter_stat(obj, 36)` (poison level) | `stat.cc via STAT_CURRENT_POISON_LEVEL` | ❌ Not in `statMap`; returns stub value 5 |
| `get_critter_stat(obj, 37)` (radiation level) | `stat.cc via STAT_CURRENT_RADIATION_LEVEL` | ❌ Not in `statMap`; returns stub value 5 |
| `get_critter_stat(obj, 31)` (radiation resistance) | `stat_defs.h STAT_RADIATION_RESISTANCE` | ❌ Not in `statMap` |
| `get_critter_stat(obj, 32)` (poison resistance) | `stat_defs.h STAT_POISON_RESISTANCE` | ❌ Not in `statMap` |
| Poison resistance applied on accumulation | `critterAdjustPoison: amount * resistance / 100` | ❌ Missing from DH2 `poison()` method |
| Poison tick interval | Variable `10*(505-5*P)` ticks | ❌ Fixed 600-tick cycle |
| Poison HP damage | −1 HP per event | ❌ `floor(P/10)` HP per cycle |
| Poison decay | −2 per event | ❌ −1 per cycle |
| Radiation resistance on `radiation_inc` | `critterAdjustRadiation`: `amount * resistance / 100` | ❌ No `radiation_inc` at all |
| Radiation event scheduling (daily check) | `_critter_check_rads` at midnight | ❌ Not implemented |
| Endurance roll on radiation check | `statRoll(END, modifier[level])` | ❌ Not implemented |
| Radiation stat penalties (bonus layer) | `_process_rads`: 8 stats | ❌ Only HP damage in DH2 |
| Radiation healing event (7-day reversal) | `radiationEventProcess: isHealing=1` | ❌ Not implemented |
| Radiation thresholds | CE: 100/200/400/600/1000 | ❌ DH2: 300/450/600/1000 (mismatch) |
| Non-player critter restriction | `critterAdjustPoison/Radiation: gDude only` | 🟡 DH2 applies to any critter passed |
| RadAway radiation reduction | `drugs.ts specialEffect: 'radaway'` | 🟡 Handler exists; actual `radiationLevel` reduction unconfirmed — verify `handleSpecialEffect('radaway', ...)` |
| Stat layer (poison/radiation HP damage) | CE: current HP field / bonus layer | ❌ DH2: `modifyBase('HP', -N)` — permanent base HP degradation |
