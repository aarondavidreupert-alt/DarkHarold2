# Drug & Addiction System

CE refs: `item.cc` (`_item_d_take_drug`, `_insert_drug_effect`, `_insert_withdrawal`,
`performWithdrawalStart`, `performWithdrawalEnd`, `_perform_drug_effect`, `_drug_effect_allowed`),
`proto_types.h` (PROTO_ID constants), `queue.h` (EVENT_TYPE constants)  
DH2 refs: `src/drugs.ts`, `src/scripting.ts` (metarule case 18), `src/main.ts`,
`src/object.ts`, `src/char.ts`

Cross-references: see `wiki/perks_traits.md` for perk/trait effect application; see
`wiki/critter_stats.md` for stat bonus layer vs base layer distinction.

---

## 1. Drug Proto Data Model

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

### Stat Encoding

- `stat[n] == -1`: slot unused, skip.
- `stat[n] == -2` at index 0: the stat fields are reinterpreted as a random HP range:
  `amount[0]` = min HP gain, `amount[1]` = max HP gain. Used by Super Stimpak's
  delayed negative HP effect.
- Stat IDs map to `STAT_*` constants (e.g., `STAT_STRENGTH = 0`, `STAT_ENDURANCE = 2`,
  `STAT_AGILITY = 6`, `STAT_CURRENT_HIT_POINTS = 6` — note HP uses a different
  constant in the stat context vs the effect context).

### Effect Application

`_perform_drug_effect` (`item.cc:2639`):

1. If `stat[0] == -2`: randomize amount between `amount[0]` and `amount[1]`.
2. For each non-(-1) stat slot: call `critterSetBonusStat(critter, statID, current + amount)`.
3. HP special case: if the resulting current HP ≤ 0 for a non-player critter, kill it
   with a "succumbs to adverse effects" message.

**Critical**: CE uses `critterSetBonusStat` — the **bonus layer** — not base stat
modification. Effects are not permanent; they can be added and removed without
corrupting the character's underlying stat block.

---

## 2. Drug Use Flow

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

### Concurrent Effect Cap (`field_8`)

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

### Deferred Effect Scheduling

`_insert_drug_effect` (`item.cc:2598`):

```c
int delay = 600 * duration;
if (critter == gDude && traitIsSelected(TRAIT_CHEM_RESISTANT)) delay /= 2;
queueAddEvent(delay, critter, drugEffectEvent, EVENT_TYPE_DRUG);
```

The **Chem Resistant** trait halves the deferred delay — meaning the beneficial
effect wears off sooner (or the harmful deferred effect arrives sooner).

---

## 3. Addiction Tracking

### State Storage

Addiction state lives in two places:

1. **GVARs** (e.g., `GVAR_NUKA_COLA_ADDICT`, `GVAR_BUFF_OUT_ADDICT`, etc.) —
   globally accessible, serialized in save files, queryable from scripts via
   `get_global_var`. Set to 1 by `dudeSetAddiction`, cleared by `dudeClearAddiction`.

2. **`DUDE_STATE_ADDICTED`** flag on the player critter — bitfield state, cleared
   when the last addiction GVAR is cleared. Used for HUD indicator.

`dudeIsAddicted(pid)` (`item.cc`) checks the GVAR for the given PID.

### Script Access

Scripts check addiction via:
```
get_global_var(GVAR_BUFF_OUT_ADDICT)  // 1 if addicted, 0 if not
```

There is no `metarule` for "is addicted to X" — scripts read GVARs directly.

---

## 4. Withdrawal Flow

Withdrawal uses a two-step queue sequence. Both events use `EVENT_TYPE_WITHDRAWAL = 2`.

### Step 1: Withdrawal Start (pending)

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

### Step 2: Withdrawal End

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

### Trait/Perk Modifiers Summary

| Modifier | Effect |
|---|---|
| **Chem Resistant** (trait) | Deferred drug effect delay ÷ 2 (wears off / kicks in sooner) |
| **Chem Reliant** (trait) | Withdrawal duration ÷ 2 (shorter suffering, but addiction triggers more easily — not a CE mechanic, just context) |
| **Flower Child** (perk) | Withdrawal duration ÷ 2 (stacks with Chem Reliant) |

---

## 5. Non-Addictable Drugs

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

## 6. Drug Reference Table

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

## 7. DH2 Implementation Status

`src/drugs.ts` implements 8 drugs with several significant deviations from CE.

### Covered Drugs

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

### `pidID` vs `PROTO_ID` Discrepancy

DH2 `drugs.ts` uses `pidID = pid & 0xFFFF` (item PID low-word). CE `PROTO_ID_*`
constants appear to be the same low-word values for item-type protos (type 0, so
the full PID equals `PROTO_ID`). The mismatch is real — DH2 Stimpak pidID=24 vs
CE STIMPACK=40. This likely means DH2's `pidID` values are simply wrong and do not
match the actual extracted proto PIDs. **Verify against `proto/items/*.json`
before any fix** — the JSON files contain the actual extracted PID values that the
runtime uses.

### Deviation 1: Addiction Roll Timing

**CE**: Addiction rolls on **use** (`_item_d_take_drug` step 8).  
**DH2**: Addiction rolls at **effect expiry** (inside the reversal callback in
`drugs.ts`). This is incorrect — a player who uses a drug and immediately takes
it again before the effect expires would never trigger the addiction roll in DH2.

### Deviation 2: Stat Application Layer

**CE**: Uses `critterSetBonusStat` — applies to the **bonus layer**. Drug effects are
separate from base stats and can be cleanly removed.  
**DH2**: Uses `modifyBase` — applies directly to `baseStats`. When the drug wears off,
the reversal `modifyBase` subtracts the amount. This works for simple cases but
breaks down with repeated doses (double-subtract), level-ups mid-effect, and
stat caps.

### Deviation 3: Withdrawal Model

**CE**: Discrete two-event queue sequence. Withdrawal perk is applied for a fixed
`10080 * 600` ticks and then removed; addiction GVAR cleared at end.  
**DH2**: `tickAddictions` (`drugs.ts`) runs every 600 ticks and applies a stat penalty
on every tick that the player is addicted. This is a continuous tick-based bleed,
not a bounded withdrawal period. There is no "withdrawal ends" event; the penalty
persists as long as `(player as any).addictions` includes the drug name.

### Deviation 4: Addiction State Not Script-Queryable

**CE**: Addiction stored in GVARs; scripts read `get_global_var(GVAR_BUFF_OUT_ADDICT)`.  
**DH2**: Addiction stored in `(critter as any).addictions: string[]` — a plain array
on the critter object. Scripts cannot query this; `get_global_var` for addiction
GVARs will always return 0.

### Deviation 5: `metarule(WHO_ON_DRUGS)` Parameter

**CE**: `METARULE_WHO_ON_DRUGS` (metarule ID 18) takes a critter object as parameter
and returns whether that critter has active drug effects.  
**DH2** (`scripting.ts:481`): Uses `this.self` (the script's own critter) instead of
reading the opcode parameter. The parameter is ignored. This works correctly only
when the target critter is the script's self object.

### Deviation 6: Concurrent Dose Cap Not Implemented

**CE**: `_drug_effect_allowed` prevents stacking more than `field_8` doses of the
same drug.  
**DH2**: No equivalent check. All doses apply regardless of how many active effects
exist.

### Deviation 7: Jet Special Case Not Implemented

**CE**: Jet withdrawal is permanent until Jet Antidote is used; `performWithdrawalEnd`
short-circuits for `PROTO_ID_JET`.  
**DH2**: No special Jet behaviour. The `antidote` special effect in DRUG_TABLE is for
generic antidote (pid 51), not Jet Antidote.

---

## 8. DH2 Implementation Status Summary

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

---

## 9. Known Issues and Flags

**Rad-X PID not found in CE source**: No `PROTO_ID_RAD_X` constant appears in
`proto_types.h` or any searched CE file. Rad-X protection may be handled outside
the drug proto system. Do not implement until the correct CE handling is identified.

**Super Stimpak GVAR**: In `gDrugDescriptions`, Super Stimpak shares `GVAR_RADAWAY_ADDICT`
(it appears listed with RadAway's GVAR). Its `addictionChance` in proto data is
likely 0, making this moot — but verify before implementing the entry.

**`pidID` values require verification**: Before fixing the pidID mismatch, read
`proto/items/` JSON files to see what PID values the extracted game data actually
uses. DH2's numeric ids may have been manually chosen for a version of the game
data that differs from the CE constants.
