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

**Rad-X** (pid 109) is an ordinary drug: its proto raises `STAT_RADIATION_RESISTANCE` for a while; nothing special-cases it.

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

### §1.5 DH2 Drug Implementation

`src/drugs.ts` is a port of `item.cc` (`_item_d_take_drug`, `_perform_drug_effect`, `_drug_effect_allowed`, `_insert_drug_effect`, `drugEffectEventProcess`). The drug table is `gDrugDescriptions` (all 9 entries, Beer/Booze sharing the alcohol GVAR) with the per-drug dose caps. Effects come from the item protos (`stat0..2`, `amount0..2`, `firstDelayed`, `secondDelayed`); the random-range encoding (`stat0 == −2`) and the HP / poison / radiation stats go through their adjust functions. Robots can't take drugs. The deferred events are queued in `Scripting.timeEventList` (saved), and off the party they end when the map is left (`_item_d_clear`).

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

### §2.3 DH2 Addiction Implementation

CE-faithful (`src/drugs.ts`): the addiction roll happens on use (Chem Reliant ×2, Chem Resistant ÷2, Flower Child ÷2); the two-event withdrawal queue (`_insert_withdrawal`, `performWithdrawalStart` / `performWithdrawalEnd`); withdrawal perks 53–71 apply their stat deltas through the perk table; addiction state is the GVARs (`dudeSetAddiction` / `dudeClearAddiction`, `GVAR_ADDICT`-style vars read by scripts and the karma panel); Jet's withdrawal never ends except with the antidote (pid 260); taking the drug again ends an active withdrawal (`_item_wd_clear_all`). Withdrawal events stop a rest (CE returns 1 from `withdrawalEventProcess` for the dude).

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

### §3.5 DH2 Poison Implementation

`Scripting.adjustPoison` / `poisonDecayEvent` (`src/scripting.ts`) port `critterAdjustPoison` / `poisonEventProcess`: dude only, resistance on positive amounts, the event at `10 × (505 − 5 × poison)` ticks, −2 poison and −1 HP per event, misc.msg 3000–3003, death at 0 HP, and at 5 HP or less the event stops a rest. `poison` (0x8122) and `get_poison` are wired; `get_critter_stat` 36 returns the level. The event is saved and restored with the game (`saveload.ts`).

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

### §4.5 DH2 Radiation Implementation

`src/radiation.ts` ports `critterAdjustRadiation`, `_critter_check_rads` (each midnight, the END roll with the level modifiers), `_process_rads` (the 8 stat penalties of `gRadiationEffectPenalties`, applied and reversed by the 7-day healing event) and `radiationEventProcess` (which stops a rest). Thresholds are CE's (100 / 200 / 400 / 600 / 1000). `radiation_inc` (0x80FD) / `radiation_dec` (0x80FE) are wired; `get_critter_stat` 31 / 37 return resistance and level. Rad-Away lowers the level through the drug path (`STAT_CURRENT_RADIATION_LEVEL`).

---

## §5. Known Gaps

| Area | CE | DH2 |
|---|---|---|
| Stat layer | Drug / withdrawal / radiation deltas in `bonusStats` | Deltas on the base stats, removed symmetrically by the later events (equivalent) |

Everything else in this doc is implemented. <!-- audited: 2026-10-18 -->
