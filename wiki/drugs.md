# Drugs & Chems — DarkHarold2 Reference

CE refs: `item.cc:_item_d_take_drug()`, `item.cc:_perform_drug_effect()`, `proto_types.h`, `stat_defs.h`

---

## System Overview

CE drug pipeline (each step has a DH2 analogue):

| CE step | DH2 analogue |
|---|---|
| `_item_d_take_drug(critter, item)` | `useDrug(item, user)` in `drugs.ts` |
| `_perform_drug_effect(stats, amount, true)` | immediate `immediateHP` / `timedStats` applied |
| `_insert_drug_effect(duration1, amount1)` | `Scripting.timeEventList` timed reversal |
| Addiction GVAR check → `_insert_withdrawal` | `addictions[]` array + `tickAddictions()` |
| `withdrawalEventProcess` → `performWithdrawalStart` | `tickAddictions()` in gameTick |

Item **consumption** on use: `Obj.use()` splices the item from `owner.inventory` (or clears the hand slot) after `drugHandler` returns true.

HP display: `drawHP()` called after drug applies.

Inventory refresh: `showInventory()` called from `itemAction('use')`.

---

## Stat Name Mapping (CE → DH2)

| CE `STAT_*` | DH2 `stats.get(name)` key |
|---|---|
| STAT_STRENGTH (0) | `'STR'` |
| STAT_PERCEPTION (1) | `'PER'` |
| STAT_ENDURANCE (2) | `'END'` |
| STAT_CHARISMA (3) | `'CHA'` |
| STAT_INTELLIGENCE (4) | `'INT'` |
| STAT_AGILITY (5) | `'AGI'` |
| STAT_LUCK (6) | `'LUK'` |
| STAT_MAXIMUM_HIT_POINTS (7) | `'Max HP'` |
| STAT_CURRENT_HIT_POINTS (58) | `'HP'` (via `immediateHP` path) |
| STAT_DAMAGE_RESISTANCE (24) | `'DR Normal'` |

Radiation and poison are **not** in `StatSet` — tracked as `critter.radiationLevel` / `critter.poisonLevel` directly.

---

## Addiction System

CE tracks addiction via GVARs (`GVAR_BUFF_OUT_ADDICT` etc.) and applies withdrawal via a perk (`PERK_BUFF_OUT_WITHDRAWAL`). DH2 simplifies this:

- `critter.addictions: string[]` — list of drug names the critter is addicted to
- `tickAddictions(critter)` called each game tick cycle — applies `withdrawal` stat penalties each tick while the drug is **not** active
- Addiction chance checked when the drug's timed effect **expires** (not on use — matches CE `_insert_withdrawal` being queued at use but firing at onset)
- CE onset: `withdrawalOnset` from proto (in tick units). DH2 approximates: addiction check fires when timed effect wears off.
- CE `gDrugDescriptions`: 9 addictable drugs — Nuka-Cola (0%), Buffout (10%), Mentats (10%), Psycho (10%), Rad-Away (0%), Beer (0%), Booze (0%), Jet (100%), Tragic Cards (0%)
- CE withdrawal duration: 10080 ticks (168 in-game hours / 7 days). DH2: continuous penalty per tick cycle while addicted and drug not active.

---

## Drug Table (CE-faithful values)

Durations in DH2 ticks (`TICKS_PER_HOUR = 36000`).

| Drug | PID | Immediate effect | Timed stats | Duration (ticks) | Addiction % | Withdrawal | Notes |
|---|---|---|---|---|---|---|---|
| Stimpak | 40 | +10 HP | — | — | 0 | — | CE: random 4–10 HP; DH2 uses flat 10 |
| Super Stimpak | 144 | +75 HP, then −9 HP after 1h | — | — | 0 | — | Delayed damage via `delayedHP`; CE: `duration2` schedule |
| Mentats | 53 | — | +2 INT, +2 PER | 108000 (3h) | 10 | −1 INT | |
| Buffout | 87 | — | +2 STR, +2 END | 108000 (3h) | 10 | −2 STR, −1 END | CE also boosts Max HP via STR/END derivation |
| Psycho | 110 | — | +25 DR Normal | 108000 (3h) | 10 | −1 END | |
| Jet | 259 | — | +2 AP | 9000 (15min) | 100 | −1 AGI, −1 END | Very short; 100% addiction |
| Nuka-Cola | 106 | +2 HP | — | — | 0 | — | |
| Rad-Away | 48 | −150 rad | — | — | 0 | — | `radiationLevel -= 150` |
| Beer | 124 | — | +1 STR, −1 INT | 9000 (15min) | 0 | — | CE: GVAR_ALCOHOL_ADDICT but 0% chance in proto |
| Booze | 125 | — | +2 STR, −2 INT | 9000 (15min) | 0 | — | CE: same GVAR as Beer |
| Healing Powder | 273 | +4 HP | −1 PER | 18000 (30min) | 0 | — | Primitive Arroyo item; PER penalty is timed |
| Jet Antidote | 260 | cures Jet addiction | — | — | — | — | CE: `performWithdrawalEnd(PERK_JET_ADDICTION)` |

---

## Known Gaps / DH2 vs CE Differences

- **CE stimpak uses a random range (4–10 HP)**. DH2 uses flat 10. Good enough.
- **CE Buffout boosts Max HP** via STR/END cascade (derived stats). DH2 `StatSet` does not auto-derive `Max HP` from END, so the end result (derived HP) isn't boosted — only raw STR/END change.
- **CE withdrawal onset** is `withdrawalOnset * 600` ticks from use. DH2 checks addiction at effect expiry only.
- **Rad-Away addiction GVAR** exists in CE but `addictionChance` = 0 in proto. DH2 correctly sets no addiction.
- **Beer/Booze share GVAR_ALCOHOL_ADDICT** but both have 0% chance — no alcohol addiction in DH2 either.
- **Healing Powder PER penalty** is timed (wears off) in CE. DH2 implements this via `timedStats`.
- **Jet Antidote in CE also removes the item** — DH2 `Obj.use()` consumes it from inventory.
- **Tragic Cards (PID 304)** — no CE drug effect, just a scripted item. Not implemented.
- **Drug effect stacking** — CE prevents re-applying the same drug while it's active (`_drug_effect_allowed` checks the queue). DH2 does not enforce this; stacking is possible.

<!-- audited: 2026-07-07 -->
