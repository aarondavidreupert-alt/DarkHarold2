# Fallout 2 — Barter & Economy System

> CE references: `inventory.cc`, `item.cc`, `skill.cc`, `party_member.cc`,
> `reaction.cc`, `game_dialog.cc`, `interpreter_extra.cc`.
> DH2 references: `src/ui_barter.ts`, `src/scripting.ts`, `src/object.ts`.

---

## 1. CE Overview

Barter in Fallout 2 is a symmetric item-exchange screen accessed from dialogue.
Both parties place items and/or caps onto a shared "offer table"; the transaction
succeeds when the player's offer meets a computed minimum value. There is no
separate buy-price and sell-price — one formula governs all trades — but the
formula contains an implicit 2× markup that creates a real buy/sell spread.

The main entry point is `inventoryOpenTrade()` at `inventory.cc:5031`, called from
`game_dialog.cc:1904`. The actual price check is `_barter_compute_value()` at
`inventory.cc:4673`, and the transaction gate is `_barter_attempt_transaction()` at
`inventory.cc:4706`.

---

## 2. CE Item Base Cost

### `itemGetCost(obj)` — `item.cc:813`

Returns the raw proto cost of one object. Used on both sides of the barter screen.

```
baseValue = proto->item.cost                // from .pro file
if ITEM_TYPE_WEAPON and has ammo loaded:
    baseValue += ammoQty × ammoCost / ammoCapacity
if ITEM_TYPE_AMMO:
    baseValue = protoCost × currentQty / ammoCapacity
if ITEM_TYPE_CONTAINER:
    baseValue += objectGetCost(contents)
return baseValue
```

**Ammo proportional cost** — `item.cc:847–854`: ammo stacks are prorated by the
remaining charge. A half-full clip costs half of a full clip's proto cost.
`objectGetCost(obj)` sums all inventory items the same way, handling partial ammo
clips correctly — `item.cc:886`.

### Caps (PROTO_ID_MONEY)

`itemGetTotalCaps(obj)` at `item.cc:3153` counts only `PROTO_ID_MONEY` (PID `0x0029`)
items recursively through containers. Caps are extracted and handled separately in
the price formula so they are not subject to the 2× markup — see §3.

---

## 3. CE Price Formula — `_barter_compute_value()` (`inventory.cc:4673`)

This function computes the **minimum player-offer value** required for the merchant's
items on the barter table to be a fair deal.

```c
// inventory.cc:4673–4703
cost             = objectGetCost(_btable)          // raw proto cost of merchant's offer
caps             = itemGetTotalCaps(_btable)        // caps in merchant's offer
costWithoutCaps  = cost - caps

perkBonus        = 25.0 if player has PERK_MASTER_TRADER, else 0.0
partyBarter      = partyGetBestSkillValue(SKILL_BARTER)  // best Barter in party
npcBarter        = skillGetValue(npc, SKILL_BARTER)      // merchant's Barter

barterModMult    = (_barter_mod + 100.0 - perkBonus) × 0.01
                   clamped to ≥ 0.01 if negative

balancedCost     = (160 + npcBarter) / (160 + partyBarter) × (costWithoutCaps × 2)

result           = trunc(barterModMult × balancedCost) + caps
```

`_barter_mod` is the combined script + reaction modifier — see §5.

### The 2× Factor

`costWithoutCaps × 2` means that at default settings (equal Barter skills, no
modifiers, no perks), the player must offer items/caps totaling **2× the base proto
value** of anything they want from the merchant. Caps in the merchant's offer are
excluded from this multiplier and added back at face value.

### High-Barter Break-Even

When `partyBarter > npcBarter`, `balancedCost` shrinks. With player Barter 300 and
NPC Barter 0, the ratio becomes `160 / 460 ≈ 0.348`, making required cost
`≈ 0.348 × 2 × merchantCost = 0.696 × merchantCost` — the player pays below proto
value and can profit from the trade.

### Sell-for-Caps Asymmetry

When the player sells items (puts items on their table) and the merchant offers only
caps:
- `costWithoutCaps = 0` → `balancedCost = 0`
- `result = barterModMult × 0 + caps = caps` (exactly face value)

So selling items to a merchant for caps is always 1:1 on the merchant's caps,
regardless of Barter skill. The player cannot force a profit — they can only sell
for at most the merchant's offered caps. In practice, selling an item worth 100 for
100 caps is accepted; demanding 200 caps for an item worth 100 is rejected (player
must put up items worth 200 in raw cost to get 200 caps).

The effective spread: **buy at 2× proto value, sell at 1× proto value** (at equal
Barter, default settings).

---

## 4. CE Barter Skill

### Base Formula — `skill.cc:93, 248`

```
SKILL_BARTER (index 15):
  defaultValue = 0
  statModifier = 4
  stat1        = STAT_CHARISMA
  stat2        = STAT_INVALID

  Barter = 0 + 4 × CHA + investedPoints
```

**Charisma influence**: every point of Charisma adds 4 to the base Barter skill,
directly improving the `partyBarter / (160 + partyBarter)` ratio in the price
formula. CHA 5 → base Barter 20; CHA 10 → base Barter 40 before any investment.

Speech (SKILL_SPEECH, index 14): `defaultValue=0, statModifier=5, stat1=STAT_CHARISMA`
— Speech uses 5×CHA. This affects the reaction system (see §5), not the barter
formula directly.

### Difficulty Modifier — `skill.cc:1125–1137`

Barter (and Speech, Gambling, Outdoorsman) receives a game-difficulty modifier:

| Difficulty | Barter skill modifier |
|------------|----------------------|
| Easy       | +20                  |
| Normal     | 0                    |
| Hard       | −10                  |

### Party Member Barter Delegation — `party_member.cc:1182`

`partyGetBestSkillValue(SKILL_BARTER)` iterates all unhidden party-member critters
(excluding the player) and returns the highest Barter skill found. The price formula
uses whichever is higher — player or best party member. Having Cassidy or another
high-Barter companion in your party lowers your effective buy price even when trading
solo.

---

## 5. CE Modifier System

### `_barter_mod` — Combined Modifier

`_barter_mod = scriptBarterMod + reactionMod` — set each frame inside
`inventoryOpenTrade` at `inventory.cc:5124`.

### Reaction Modifier — `inventory.cc:5091–5105`, `reaction.cc:18`

The NPC's current reaction level (stored in LVAR 0 of the NPC's script) translates
to a markup percentage added to `_barter_mod`:

| Reaction level | `reactionTranslateValue()` | Markup |
|---------------|---------------------------|--------|
| > +10         | GOOD                      | −15 (discount) |
| −10 to +10    | NEUTRAL                   | 0 |
| ≤ −10         | BAD                       | +25 (markup) |

A hostile NPC charges 25% more; a friendly NPC gives a 15% discount. Reaction is
set by individual NPC scripts via `reactionSetValue(critter, val)` which writes to
LVAR 0 (`reaction.cc:8`).

### Script Barter Modifier — `gdialog_set_barter_mod` (`game_dialog.cc:3156`)

Scripts call `gdialog_set_barter_mod(mod)` to set a per-dialogue percentage modifier.
This value persists until dialogue ends. Range is unrestricted — negative values give
a discount, positive values add markup. The NPC can also set this in a `talk_p_proc`
before opening the screen.

The modifier passed directly to `gdialog_barter(mod)` (the screen-opener) also sets
this value. If `gdialog_set_barter_mod` is called separately and then `gdialog_barter`
is called with `mod=0`, the set\_barter\_mod value is overwritten with 0.

### Master Trader Perk — `inventory.cc:4685`

`PERK_MASTER_TRADER` subtracts 25.0 from the `barterModMult` numerator:
`barterModMult = (_barter_mod + 100 - 25) × 0.01` — a flat 25% discount on all
non-cap merchant items regardless of Barter skill levels.

---

## 6. CE Barter Transaction Gate — `_barter_attempt_transaction()` (`inventory.cc:4706`)

Checks run in order before the trade executes:

1. **Carry weight**: `objectGetInventoryWeight(barterTable) > weightAvailable` →
   rejected ("Sorry, you cannot carry that much." — msg 31).

2. **Party-member trade** — weight-based only: if trading with a party member
   (`gGameDialogSpeakerIsPartyMember`), check the NPC's carry capacity instead of
   computing value. Party member trades are free exchanges with only a weight limit —
   no Barter skill check, no markup. This is the FO2 companion item-exchange mechanic.

3. **Empty offer**: `offerTable->data.inventory.length == 0` → rejected (msg 28).

4. **Queued item**: `itemIsQueued(offerTable)` — a running Geiger Counter in the offer
   is rejected unless it can be turned off. `inventory.cc:4735–4739`.

5. **Value check**: `_barter_compute_value(dude, npc) > objectGetCost(offerTable)` →
   rejected ("No, your offer is not good enough." — msg 28).

On success: `itemMoveAll(barterTable, dude)` + `itemMoveAll(offerTable, npc)`.

---

## 7. CE Script Opcodes

| Opcode | CE function | Description |
|--------|-------------|-------------|
| `0x8129` `gdialog_mod_barter(mod)` | `gameDialogBarter(modifier)` — `game_dialog.cc:3163` | Open barter screen. `mod` sets `gGameDialogBarterModifier`; added to the reaction modifier each frame. |
| `0x814E` `gdialog_set_barter_mod(mod)` | `gameDialogSetBarterModifier(modifier)` — `game_dialog.cc:3156` | Set per-dialogue markup % without opening barter. Persists until dialogue ends. |
| `0x8138` `item_caps_total(obj)` | `itemGetTotalCaps(obj)` — `item.cc:3153` | Count caps (PROTO_ID_MONEY) in obj's inventory, recursing into containers. |
| `0x8139` `item_caps_adjust(obj, amount)` | `itemCapsAdjust(obj, amount)` — `item.cc:3177` | Add (`+`) or remove (`−`) caps from obj. Creates a new money object if adding and none exists. Returns −1 if insufficient caps for removal. |

---

## 8. CE Merchant Inventory & Reset Timing

Merchant stock is defined in two ways:

1. **Proto-defined inventory** — Written directly into the NPC's `.pro` file (the
   items section of the critter proto). These items exist at map load and are restored
   by the map-reset mechanism.

2. **Script-defined inventory** — Many merchants use `map_enter_p_proc` or
   `critter_p_proc` to call `item_caps_adjust` and `create_object_sid` / move-to-inven
   to add items on first visit, tracked by an LVAR flag. Stock added this way is
   persistent within a session — it depletes as the player buys.

3. **Map reset** — Fallout 2 resets maps after a configurable number of in-game days
   (typically 3–30 days per-map, stored in the map header). On reset, objects are
   reloaded from the map source and scripts re-run `map_enter_p_proc`. Proto-defined
   inventory is automatically restored; script-defined inventory is restored if the
   LVAR "already stocked" flag is reset by the script.

The caps reset mechanism — `item_caps_adjust(merchant, -item_caps_total(merchant))`
then `item_caps_adjust(merchant, startingCaps)` — appears in many vendor scripts to
refresh their caps supply on each map reset.

> **Note**: No bulk "vendor restock" function was found in `worldmap.cc` or
> `scripts.cc`. Inventory management is entirely per-script. The authoritative
> reference for a specific vendor is that vendor's `.int` file.

---

## 9. DH2 Implementation

### Barter Screen — `src/ui_barter.ts`

`uiBarterMode(merchant: Critter)` is the DH2 barter screen entry point,
called from `scripting.ts:1434` (`gdialog_mod_barter` handler).

The DH2 offer check at `ui_barter.ts:312–351`:

```typescript
function totalAmount(objects: Obj[]): number {
    // sums pro.extra.cost * amount for each item
    return objects.reduce((sum, obj) => sum + obj.pro.extra.cost * obj.amount, 0)
}

function offer() {
    const merchantOffered = totalAmount(merchantBarterTable)
    const playerOffered   = totalAmount(playerBarterTable)
    const barterMod       = Scripting.getDialogueBarterMod()
    const merchantNeed    = Math.ceil(merchantOffered * (100 + barterMod) / 100)

    if (playerOffered >= merchantNeed) {
        // trade accepted
    }
}
```

### Script Opcodes — `src/scripting.ts`, `src/vm_bridge.ts`

| Opcode | DH2 method | Status |
|--------|------------|--------|
| `0x8129` `gdialog_mod_barter` | `scripting.ts:1430` | **Partial** — opens barter screen correctly; `mod` parameter is ignored (always 0) |
| `0x814E` `gdialog_set_barter_mod` | `scripting.ts:1425` | **Implemented** — stores modifier in `dialogueBarterMod`; read by `ui_barter.ts:319` |
| `0x8138` `item_caps_total` | `scripting.ts:640` | **Implemented** — returns `obj.money` (PID 41 scan); no container recursion |
| `0x8139` `item_caps_adjust` | `scripting.ts:644` | **Implemented** — PID 41 scan, creates money object if absent; no container recursion |

---

## 10. DH2 vs CE — Formula Comparison

| Feature | CE (`inventory.cc:4673`) | DH2 (`ui_barter.ts:315`) | Status |
|---------|--------------------------|--------------------------|--------|
| Default buy markup | 2× proto value | 1× proto value (no markup) | **bug** |
| Player Barter skill | Modifies ratio via `partyBarter` | Not used | **bug** |
| NPC Barter skill | Modifies ratio via `npcBarter` | Not used | **bug** |
| Charisma influence | Via Barter skill | Not used | **bug** |
| Party member Barter | Best of all party members | Not used | **bug** |
| Master Trader perk | −25 on barterModMult | Not used | **bug** |
| Barter difficulty modifier | Easy +20, Hard −10 on Barter | Not used | **bug** |
| Reaction modifier | −15/0/+25 added to `_barter_mod` | Not used | **missing** |
| `gdialog_set_barter_mod` effect | Shifts `_barter_mod` % | Applied ✓ | **correct** |
| `gdialog_mod_barter(mod)` modifier | Sets `gGameDialogBarterModifier` | Ignored (always 0) | **bug** |
| Caps isolation | Caps bypass the 2× factor | Caps subject to barterMod markup | **bug** |
| Ammo proportional cost | `ammoQty / ammoCapacity × protoCost` | Uses `pro.extra.cost` directly (full clip value) | **bug** |
| Carry weight check | Yes — both parties | Not implemented | **missing** |
| Queued item check | Geiger Counter active → reject | Not implemented | **missing** |
| Party member free trade | Weight-only, no value check | Uses value check (same as NPC trade) | **bug** |
| `item_caps_total` container recursion | Recursive | Flat scan only | **minor** |

---

## 11. Known Gaps

| ID | Description | File(s) | CE Reference | Sev | Status |
|----|-------------|---------|--------------|-----|--------|
| B1 | **Default buy markup is 1× not 2×.** DH2 requires `merchantOffered` raw cost; CE requires `2 × merchantOffered × Barter-ratio`. A player with no Barter skill can trade at-par, making money trivially easy. | `ui_barter.ts:320` | `inventory.cc:4695` | major | bug |
| B2 | **Barter skill not consulted.** Neither the player's nor the NPC's Barter skill is read during the offer check. Investing in Barter has no barter-screen effect. | `ui_barter.ts` | `inventory.cc:4690–4691` | major | missing |
| B3 | **Reaction modifier not applied.** The NPC's current reaction level (LVAR 0) does not affect the price. Friendly NPCs should give a 15% discount; hostile NPCs should add a 25% markup. | `ui_barter.ts` | `inventory.cc:5091–5105`, `reaction.cc:18` | major | missing |
| B4 | **`gdialog_mod_barter(mod)` ignores `mod` argument.** The modifier passed directly to the screen-opener is silently dropped; only `gdialog_set_barter_mod` works. | `scripting.ts:1430` | `game_dialog.cc:3163` | minor | bug |
| B5 | **Master Trader perk has no barter effect.** The perk is defined in `perks.ts:209` but not applied as a −25 markup reduction in the offer formula. | `ui_barter.ts` | `inventory.cc:4685` | minor | missing |
| B6 | **Caps not isolated from barterMod markup.** When the merchant offers caps, DH2 applies `(100 + barterMod) / 100` to cap face value. CE adds caps at 1:1 regardless of all modifiers. | `ui_barter.ts:320` | `inventory.cc:4700–4702` | minor | bug |
| B7 | **Ammo cost not prorated by remaining charge.** `totalAmount` uses `pro.extra.cost` directly — a half-empty clip is counted the same as a full clip. | `ui_barter.ts:306` | `item.cc:847–854` | minor | bug |
| B8 | **Carry weight not checked.** DH2 completes trades regardless of whether the player can carry the acquired items. | `ui_barter.ts` | `inventory.cc:4710–4718` | minor | missing |
| B9 | **Party member trade uses value check instead of weight check.** Trading with a companion should be free (weight-limited only). DH2 applies the same formula as NPC merchants. | `ui_barter.ts` | `inventory.cc:4720–4729` | minor | bug |
| B10 | **`item_caps_total`/`item_caps_adjust` do not recurse into containers.** CE's versions search nested containers; DH2's scan only the top-level inventory. | `scripting.ts:640,644`, `object.ts:670` | `item.cc:3153,3177` | minor | partial |

<!-- audited: 2026-06-01 -->
