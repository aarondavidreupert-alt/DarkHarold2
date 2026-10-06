# Drugs & Chems — DarkHarold2 Reference

> Last audited: 2026-10-06 — rewritten as a direct port of CE `item.cc` (branch `100percent`).
> The earlier hand-written `DRUG_TABLE` (fixed numbers per drug, a 600-tick
> withdrawal loop that stacked penalties forever) is gone.

CE refs: `item.cc:2776 _item_d_take_drug`, `item.cc:2639 _perform_drug_effect`,
`item.cc:2598 _insert_drug_effect`, `item.cc:2721 _drug_effect_allowed`,
`item.cc:2917-3150` (withdrawal + addiction GVARs), `perk.cc:554 perkAddEffect`,
`character_editor.cc:5613` (karma-panel reliances).

---

## Data source

Every effect comes from the drug's own proto (`tools/proto.py readItem`, SUBTYPE_DRUG):

| Proto field | Meaning |
|---|---|
| `stat0..2` | CE stat indices (`stat_defs.h`). `stat0 == -2` means `amount0..amount1` is a random range applied to `stat1` (Stimpak, Healing Powder). `-1` = unused slot. |
| `amount0..2` | Immediate deltas. |
| `firstDelayed` / `secondDelayed` | `{duration (game minutes), amount0..2}` — further deltas applied later (usually the crash, then the recovery). |
| `addictionRate` | % chance (×2 Chem Reliant, ÷2 Chem Resistant, ÷2 Flower Child). |
| `addictionEffect` | Withdrawal perk index (53 Nuka-Cola, 54 Buffout, 55 Mentats, 56 Psycho, 57 Rad-Away, 70 Jet, 71 Tragic cards). |
| `addictionOnset` | Minutes until withdrawal starts. |

CE stat index → DH2 StatSet name: `src/statIds.ts STAT_NAME_BY_ID`. Current HP (35),
poison (36) and radiation (37) route through their adjust functions
(`Scripting.adjustPoison`, `radiation.ts critterAdjustRadiation`).

## Flow (`src/drugs.ts useDrug`)

1. Robots and the dead can't take drugs.
2. **Jet Antidote** while Jet-addicted: end Jet withdrawal, clear `GVAR_ADDICT_JET`, consume.
3. Taking a drug again ends an active withdrawal for the same addiction GVAR and restarts its onset timer (`_item_wd_clear_all`).
4. If the stacking limit allows it (`gDrugDescriptions` max doses: Buffout/Mentats/Psycho/Jet = 4 queued events), apply the immediate deltas and queue the two delayed ones (`600 × minutes` ticks, halved for Chem Resistant). Otherwise item.msg 50 "That didn't seem to do that much."
5. Addiction roll (only if not already addicted). On success: GVAR set, `addictedState` (CE DUDE_STATE_ADDICTED) on, withdrawal-start event after onset.
6. Withdrawal start applies the perk's stat modifiers (`WITHDRAWAL_PERKS`, from `perk.cc gPerkDescriptions`) and shows the perk description; withdrawal ends after 10080 min (÷2 Chem Reliant, ÷2 Flower Child), except Jet, which only the antidote ends.

Messages: item.msg 1/2 ("You gained/lost %d %s", stat names from stat.msg 100+stat), 3, 10, 50, 600.

CE quirk kept: `dudeIsAddicted(-1)` only checks the Nuka-Cola GVAR, so the ADDICT indicator can clear while another addiction is still active.

## Persistence

Timed events use string userdata, saved with the timed-event queue:
`drug:<pid>:<s0>,<s1>,<s2>:<m0>,<m1>,<m2>` and `withdrawal:<1 start|0 end>:<pid>:<perk>`
(`restoreDrugEvent` in `saveload.ts`). Addiction state itself is the CE GVARs
(21-26, 295, 296), saved with all other GVARs.

## Known gaps

- DH2 has no separate bonus-stat layer, so deltas land on base stats (sums match CE).
- CE `_item_d_clear` (flush pending drug events of non-party critters on map exit) is not modelled.
