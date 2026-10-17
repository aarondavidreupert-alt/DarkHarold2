# Fallout 2 — Economy System (Item Flow, Loot & Barter)

> CE source references: `proto_instance.cc` (`_obj_pickup`), `item.cc` (`itemAdd`,
> `itemRemove`, `itemGetCost`, `itemGetTotalCaps`, `itemCapsAdjust`), `inventory.cc`
> (`_barter_compute_value`, `_barter_attempt_transaction`, `inventoryOpenTrade`),
> `skill.cc`, `party_member.cc`, `reaction.cc`, `game_dialog.cc`,
> `interpreter_extra.cc`.
>
> DH2 references: `src/object/Obj.ts` (`Obj.pickup`, `Obj.drop`, `Obj.addInventoryItem`),
> `src/scripting.ts` (inventory & barter opcodes, `Scripting.pickup`),
> `src/ui_loot.ts` (`uiLoot`), `src/ui_barter/screen.ts` (`uiBarterMode`), `src/playerUse.ts` / `src/main.ts`
> (loot entry points).
>
> See also: [critter_stats.md](critter_stats.md) §1.3 — `CRITTER_NO_DROP` flag gap.

<!-- audited: 2026-10-18 -->

---

## §1 Item Pickup / Loot Flow

### §1.1 CE Pickup Flow — `proto_instance.cc:571`

CE pickup is handled by `_obj_pickup(critter, item)`:

```c
int _obj_pickup(Object* critter, Object* item)
{
    bool overriden = false;

    if (item->sid != -1) {
        scriptSetObjects(item->sid, critter, item);   // source_obj=critter, self_obj=item
        scriptExecProc(item->sid, SCRIPT_PROC_PICKUP);

        Script* script;
        scriptGetScript(item->sid, &script);
        overriden = script->scriptOverrides;  // set_override_game_flag(1)
    }

    if (!overriden) {
        if (item->pid == PROTO_ID_MONEY) {
            int amount = itemGetMoney(item);
            if (amount <= 0) amount = 1;
            rc = itemAttemptAdd(critter, item, amount);
            if (rc == 0) itemSetMoney(item, 0);
        } else {
            rc = itemAttemptAdd(critter, item, 1);
        }

        if (rc == 0) {
            _obj_disconnect(item, &rect);   // remove from tile
        } else {
            // "You cannot pick up that item. You are at your maximum weight capacity."
            displayMonitorAddMessage(messageListItem.text);
        }
    }
    return 0;
}
```

Key behaviors:
- `SCRIPT_PROC_PICKUP` (index 4) fires **before** the item is moved — script can prevent it via `set_override_game_flag(1)`
- `PROTO_ID_MONEY` (Bottle Caps, PID 41): all loose caps on the tile are collected at once
- `itemAttemptAdd` enforces weight limits (unlike `item_add_force` / `itemAdd` which do not)

### §1.2 CE `itemAdd` / `item_add_force` (`item.cc:322`)

`itemAdd(owner, item, qty)` is the low-level stack merge:
- Scans existing inventory for identical items (`_item_identical`)
- If found: increments quantity; for ammo: merges rounds up to ammo capacity
- If not found: appends new slot, grows array by 10 if needed
- Special case: STEALTH_BOY II auto-activates stealth if item is in-hand at add time
- Sets `item->owner = owner`

`itemAttemptAdd` is the weight-checking wrapper; scripts use `item_add_force` (calls `itemAdd` directly, bypassing weight check).

### §1.3 DH2 Pickup Flow (`object.ts`)

```typescript
pickup(source: Critter) {
    if (this._script) {
        if (Scripting.pickup(this, source)) {
            return   // script handled it via set_override_game_flag
        }
    }
    const doPickup = () => {
        globalState.audioEngine.playSfxByName('ipickup1')
        source.addInventoryItem(this, this.amount)  // stack-merge into player inventory
        globalState.gMap.destroyObject(this)         // remove from map
        source.clearAnim()
    }
    const playPickup = () => {
        if (source.hasAnimation('pickUp')) {
            source.staticAnimation('pickUp', doPickup)
        } else {
            doPickup()
        }
    }
    source.walkInFrontOf(this.position, playPickup)  // walk first, then pick up
}
```

`Scripting.pickup` (`scripting.ts:2060`):
```typescript
export function pickup(obj: Obj, source: Critter): boolean {
    obj._script.self_obj    = obj as ScriptableObj
    obj._script.source_obj  = source
    obj._script.cur_map_index = currentMapID
    obj._script._didOverride = false
    obj._script.pickup_p_proc()
    return obj._script._didOverride   // true = script took over
}
```

### §1.4 `Obj.addInventoryItem` (`src/object/Obj.ts`)

```typescript
addInventoryItem(item: Obj, count = 1): void {
    for (let i = 0; i < this.inventory.length; i++) {
        if (this.inventory[i].approxEq(item)) {   // approxEq = same pid
            this.inventory[i].amount += count
            return
        }
    }
    // no matching stack — clone item and push
    const clone = item.clone()
    this.inventory.push(clone.setAmount(count))
}
```

`approxEq` compares only `pid` — two items stack if they share a PID regardless of condition, charges, or other fields.

### §1.5 Script Variable Context in `pickup_p_proc`

| Var | CE value | DH2 value |
|-----|----------|-----------|
| `self_obj` | The item being picked up | Same |
| `source_obj` | The critter picking it up | Same |
| `target_obj` | `nullptr` | Not set (undefined) |
| `game_time` | `gameGetGlobalTime()` | `globalState.gameTickTime` |
| `cur_map_index` | Current map ID | `currentMapID` |

CE also fires `SCRIPT_PROC_PICKUP` (index 4) in `inventory.cc:4102` and `4494` during the inventory UI equip path — DH2 does not replicate this second firing.

---

## §2 Inventory Script Opcodes

All implemented in `src/scripting.ts` inside the `Script` class.

### §2.1 Bulk Transfer

| Opcode | Signature | DH2 Behavior |
|--------|-----------|--------------|
| `move_obj_inven_to_obj` | `(src, dst)` | `dst.inventory = src.inventory; src.inventory = []` — direct array reassignment, no stack-merge |
| `add_mult_objs_to_inven` | `(obj, item, count)` | Calls `obj.addInventoryItem(item, count)` — stack-merges by PID |
| `add_obj_to_inven` | `(obj, item)` | Delegates to `add_mult_objs_to_inven(obj, item, 1)` |
| `rm_mult_objs_from_inven` | `(obj, item, count)` | Finds item by `approxEq` (PID match), subtracts count; splices if amount ≤ 0. Wired at `0x8117`. |
| `rm_obj_from_inven` | `(obj, item)` | Method exists at `scripting.ts:738` and delegates to `rm_mult_objs_from_inven(obj, item, 1)`, but **opcode `0x80D9` is absent from `vm_bridge.ts`** — scripts calling this opcode silently fail. See `wiki/scripting_reference.md §4`. |

### §2.2 Query

| Opcode | Signature | Returns |
|--------|-----------|---------|
| `obj_is_carrying_obj_pid` | `(obj, pid)` | Count of inventory items matching PID |
| `obj_carrying_pid_obj` | `(obj, pid)` | First inventory item with matching PID, or `0` |
| `critter_inven_obj` | `(critter, slot)` | Equipped item: `0`=worn armor, `1`=right hand, `2`=left hand; `-2` (INV_COUNT) returns `0` with a warning |
| `inven_cmds` | `(obj, cmd, idx)` | STUB — `INVEN_CMD_INDEX_PTR` (13) only; always returns `null` |

### §2.3 Caps (Currency)

`MONEY_PID = 41` (Bottle Caps) is hardcoded in DH2.

| Opcode | Signature | DH2 Behavior |
|--------|-----------|--------------|
| `item_caps_total` | `(obj)` | Returns `obj.money` (a cached numeric field) |
| `item_caps_adjust` | `(obj, amount)` | Scans inventory for PID 41; adjusts `.amount`; clamps to 0; if no caps stack found and `amount > 0`, creates a new `MONEY_PID` object via `createObjectWithPID(41)` and adds it |

---

## §3 Loot UI (`ui_loot.ts`)

Opened from `main.ts`:
- Dead critter: right-click → `uiLoot(obj)` (`main.ts:353`)
- Any object: debug hotkey `Config.controls.showTargetInventory` → `uiLoot(obj)` (`main.ts:873`)

```typescript
export function uiLoot(object: Obj)
```

Layout: two-column panel (left = player inventory, right = target inventory). Items are rendered as inventory art PNGs with an `×N` quantity label.

**Move (drag-and-drop):** `uiLootMove` resolves source/destination arrays from an encoded string (`"l{idx}"` = player, `"r{idx}"` = target), then delegates to `uiSwapItem(from, item, to, amount)` from `src/ui_barter/swap.ts`. For stacks > 1, prompts for quantity via `uiGetAmount`.

**Take all:**
```typescript
const inv = object.inventory.slice(0)   // snapshot
for (const item of inv) {
    uiSwapItem(object.inventory, item, globalState.player.inventory, item.amount)
}
```
Iterates the snapshot (not the live array) to avoid modification-while-iterating errors.

**Close:** "Done" button calls `uiEndLoot()` which hides the panel and removes event listeners.

---

## §4 Item Drop Flow (`object.ts`)

`Obj.drop(source)` removes the item from `source.inventory`, fires `drop_p_proc` if present, plays `iputdown` sound, and `gMap.addObject(this)` re-adds it to the map at the source's tile.

CE counterpart: `_obj_remove_from_inven` (`item.cc:621`) — also handles unequipping from both hands and rebuilding the FID (weapon skin change on drop).

---

## §5 Barter System

### §5.1 CE Overview

Barter in Fallout 2 is a symmetric item-exchange screen accessed from dialogue.
Both parties place items and/or caps onto a shared "offer table"; the transaction
succeeds when the player's offer meets a computed minimum value. There is no
separate buy-price and sell-price — one formula governs all trades — but the
formula contains an implicit 2× markup that creates a real buy/sell spread.

The main entry point is `inventoryOpenTrade()` at `inventory.cc:5031`, called from
`game_dialog.cc:1904`. The actual price check is `_barter_compute_value()` at
`inventory.cc:4673`, and the transaction gate is `_barter_attempt_transaction()` at
`inventory.cc:4706`.

### §5.2 CE Item Base Cost — `itemGetCost(obj)` (`item.cc:813`)

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

### §5.3 Caps — `itemGetTotalCaps` (`item.cc:3153`)

`itemGetTotalCaps(obj)` counts only `PROTO_ID_MONEY` (PID `0x0029`) items
recursively through containers. Caps are extracted and handled separately in
the price formula so they are not subject to the 2× markup — see §5.4.

### §5.4 CE Price Formula — `_barter_compute_value()` (`inventory.cc:4673`)

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

`_barter_mod` is the combined script + reaction modifier — see §5.6.

#### The 2× Factor

`costWithoutCaps × 2` means that at default settings (equal Barter skills, no
modifiers, no perks), the player must offer items/caps totaling **2× the base proto
value** of anything they want from the merchant. Caps in the merchant's offer are
excluded from this multiplier and added back at face value.

#### High-Barter Break-Even

When `partyBarter > npcBarter`, `balancedCost` shrinks. With player Barter 300 and
NPC Barter 0, the ratio becomes `160 / 460 ≈ 0.348`, making required cost
`≈ 0.348 × 2 × merchantCost = 0.696 × merchantCost` — the player pays below proto
value and can profit from the trade.

#### Sell-for-Caps Asymmetry

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

### §5.5 CE Barter Skill

#### Base Formula — `skill.cc:93, 248`

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
— Speech uses 5×CHA. This affects the reaction system (see §5.6), not the barter
formula directly.

#### Difficulty Modifier — `skill.cc:1125–1137`

Barter (and Speech, Gambling, Outdoorsman) receives a game-difficulty modifier:

| Difficulty | Barter skill modifier |
|------------|----------------------|
| Easy       | +20                  |
| Normal     | 0                    |
| Hard       | −10                  |

#### Party Member Barter Delegation — `party_member.cc:1182`

`partyGetBestSkillValue(SKILL_BARTER)` iterates all unhidden party-member critters
(excluding the player) and returns the highest Barter skill found. The price formula
uses whichever is higher — player or best party member. Having Cassidy or another
high-Barter companion in your party lowers your effective buy price even when trading
solo.

### §5.6 CE Modifier System

#### `_barter_mod` — Combined Modifier

`_barter_mod = scriptBarterMod + reactionMod` — set each frame inside
`inventoryOpenTrade` at `inventory.cc:5124`.

#### Reaction Modifier — `inventory.cc:5091–5105`, `reaction.cc:18`

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

#### Script Barter Modifier — `gdialog_set_barter_mod` (`game_dialog.cc:3156`)

Scripts call `gdialog_set_barter_mod(mod)` to set a per-dialogue percentage modifier.
This value persists until dialogue ends. Range is unrestricted — negative values give
a discount, positive values add markup. The NPC can also set this in a `talk_p_proc`
before opening the screen.

The modifier passed directly to `gdialog_barter(mod)` (the screen-opener) also sets
this value. If `gdialog_set_barter_mod` is called separately and then `gdialog_barter`
is called with `mod=0`, the set\_barter\_mod value is overwritten with 0.

#### Master Trader Perk — `inventory.cc:4685`

`PERK_MASTER_TRADER` subtracts 25.0 from the `barterModMult` numerator:
`barterModMult = (_barter_mod + 100 - 25) × 0.01` — a flat 25% discount on all
non-cap merchant items regardless of Barter skill levels.

### §5.7 CE Transaction Gate — `_barter_attempt_transaction()` (`inventory.cc:4706`)

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

### §5.8 CE Merchant Inventory & Reset Timing

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

### §5.9 CE Script Opcodes

| Opcode | CE function | Description |
|--------|-------------|-------------|
| `0x8129` `gdialog_mod_barter(mod)` | `gameDialogBarter(modifier)` — `game_dialog.cc:3163` | Open barter screen. `mod` sets `gGameDialogBarterModifier`; added to the reaction modifier each frame. |
| `0x814E` `gdialog_set_barter_mod(mod)` | `gameDialogSetBarterModifier(modifier)` — `game_dialog.cc:3156` | Set per-dialogue markup % without opening barter. Persists until dialogue ends. |
| `0x8138` `item_caps_total(obj)` | `itemGetTotalCaps(obj)` — `item.cc:3153` | Count caps (PROTO_ID_MONEY) in obj's inventory, recursing into containers. |
| `0x8139` `item_caps_adjust(obj, amount)` | `itemCapsAdjust(obj, amount)` — `item.cc:3177` | Add (`+`) or remove (`−`) caps from obj. Creates a new money object if adding and none exists. Returns −1 if insufficient caps for removal. |

---

## §6 Barter UI

### §6.1 CE Trigger Chain

CE has two independent paths into the barter screen:

**Path A — Dedicated Barter button (player-initiated)**

The dialogue window includes a permanent "BARTER" button rendered as part of the
dialogue UI. When clicked (or key `D` pressed), the handler at `game_dialog.cc:3758`
calls `_gdCanBarter()` which checks the `CRITTER_BARTER` flag (`= 0x02`) in the
critter's proto (`obj_types.h:93`, `game_dialog.cc:3673`). If the flag is set, the
barter window opens regardless of what the NPC script has said. If the flag is clear
("This person will not barter with you." — msg 903), the button silently rejects and
the dialogue continues.

```
Player clicks BARTER button
  → _gdCanBarter()                  // game_dialog.cc:3662
      → proto->critter.data.flags & CRITTER_BARTER
  → _dialogue_switch_mode = 2, _dialogue_state = 4
  → inventoryOpenTrade(...)         // inventory.cc:5031
```

**Path B — Script-initiated via `gdialog_barter(mod)` (`0x8129`)**

NPC scripts may call `gdialog_barter(mod)` at any point in their `talk_p_proc` (or
from a dialogue option handler) to open barter directly without the player pressing
the button. This is common for merchants where Barter is a scripted dialogue choice.

```
talk_p_proc: ... → gSay_Reply(...)  → giq_option(..., barter_proc, reaction)
                                    → gsay_end()   [halts VM]
Player clicks "[Barter]" option
  → dialogueReply(id)               // scripting.ts:239
  → barter_proc() runs
      → gdialog_barter(0)           // 0x8129 opcode
          → gameDialogBarter(0)     // game_dialog.cc:3163
              → gGameDialogBarterModifier = 0
              → gameDialogBarterButtonUpMouseUp(-1,-1)
              → inventoryOpenTrade(...)
```

**`metarule(METARULE_CRITTER_BARTERS, obj)` = 50** — scripts can query the proto
flag at runtime (`interpreter_extra.cc:3316`).

### §6.2 DH2 Trigger Chain

DH2 has **only one path** into barter — the script-option path. There is no
dedicated Barter button in the dialogue DOM (`play.html:57–59` shows `dialogueBox`
contains only `dialogueBoxTextArea`).

```
Player right-clicks critter → [Talk] context menu item
  → main.ts / ui_contextmenu.ts calls Scripting.talk(script, obj)  // scripting.ts:1969
  → script.talk_p_proc() runs in the VM

    Inside talk_p_proc:
    → start_gdialog(...)       // scripting.ts:1437 → uiStartDialogue() → dialogueBox slides up
    → gsay_start()             // scripting.ts:1445 → clears dialogueOptionProcs[]
    → gsay_reply(list, id)     // scripting.ts:1454 → uiSetDialogueReply(text)
    → giq_option(iq, list, id, barter_proc, reaction)
        // scripting.ts:1490 → dialogueOptionProcs.push(barter_proc.bind(this))
        //                   → uiAddDialogueOption("[Barter]", idx)
        //                       → appends <div onclick=dialogueReply(idx)> to dialogueBoxTextArea
    → gsay_end()               // scripting.ts:1480 → vm.halted = true

Player clicks "[Barter]" <div> in dialogueBoxTextArea
  → Scripting.dialogueReply(idx)   // scripting.ts:238
  → dialogueOptionProcs[idx]() = barter_proc.bind(script)()
  → gdialog_mod_barter(0)          // scripting.ts:1430 (0x8129 in vm_bridge.ts:181)
  → uiBarterMode(this.self_obj as Critter)   // src/ui_barter/screen.ts
      → dialogueBox slides down (uiAnimateBox)
      → barterBox slides up (uiAnimateBox)
      → working inventory copies created
      → offer/talk button handlers wired
```

The dialogue window also has CE's permanent **BARTER button** (`src/ui_dialogue.ts`, `game_dialog.cc _gdCanBarter`): with `CRITTER_BARTER` (proto flag 0x02) it opens the barter screen, otherwise the NPC answers with the "no barter" line. `gdialog_mod_barter(mod)` stores `mod` as the barter modifier (`gGameDialogBarterModifier`) before opening the screen; `gdialog_set_barter_mod` sets it too.

### §6.3 DH2 Barter Screen — `src/ui_barter/screen.ts` (re-audited 2026-10-18)

`barterMinPlayerOffer()` is CE `_barter_compute_value`:
- `cost` = `stackCost()` of the merchant table (CE `objectGetCost`: ammo by the rounds left, containers with contents, loaded weapons with their rounds — C36), `caps` = `itemGetTotalCaps` of the table (containers included), `costWithoutCaps = cost − caps`;
- `partyBarter` = the best Barter in the party, the dude included (`partyGetBestSkillValue`; `getSkill` already holds the difficulty bonus — it used to be added a second time), `npcBarter` = the merchant's Barter;
- `barterModMult = (barterMod + reactionMod + 100 − 25·MasterTrader) × 0.01` (minimum 0.01), with the reaction modifier of `inventoryOpenTrade` (LVAR 0 → good −15 / neutral 0 / bad +25);
- `balancedCost = (160 + npcBarter) / (160 + partyBarter) × costWithoutCaps × 2`; the merchant wants `trunc(barterModMult × balancedCost) + caps`.

`offer()` is `_barter_attempt_transaction`: first the weight ("Sorry, you cannot carry that much.", inventry.msg 31), then an empty offer or one worth less is "No, your offer is not good enough." (28); otherwise both tables move over. Trading with a party member is the separate weight-only screen (`src/ui_companion_trade.ts`, messages 31 / 32).

### §6.4 DH2 Barter Script Opcodes

| Opcode | DH2 method | Status |
|--------|------------|--------|
| `0x8129` `gdialog_mod_barter` | `Script.gdialog_mod_barter` | ✅ stores the modifier and opens the screen |
| `0x814E` `gdialog_set_barter_mod` | `Script.gdialog_set_barter_mod` | ✅ |
| `0x8138` `item_caps_total` | `Scripting.itemGetTotalCaps` | ✅ CE `itemGetTotalCaps` — containers included (2026-10-18) |
| `0x8139` `item_caps_adjust` | `Scripting.itemCapsAdjust` | ✅ CE `itemCapsAdjust` — money stacks first, then containers; returns −1 when there isn't enough (2026-10-18) |

### §6.5 DH2 vs CE Formula Comparison

| Feature | CE (`inventory.cc:4673`) | DH2 | Status |
|---------|--------------------------|-----|--------|
| 2× markup, Barter ratio, Master Trader, reaction, script modifier | `_barter_compute_value`, `inventoryOpenTrade` | Same | ✅ |
| Party Barter | Best of the party | Same (2026-10-18) | ✅ |
| Difficulty on Barter | Inside `skillGetValue` | Same — no longer counted twice (2026-10-18) | ✅ |
| Caps 1:1 | Added after the multiplier | Same | ✅ |
| Ammo / container / weapon value | `objectGetCost` | Same (C36) | ✅ |
| Carry weight / empty offer | `_barter_attempt_transaction` | Same (2026-10-18) | ✅ |
| Party member trade | Weight only | Separate weight-only screen | ✅ |

---

## §7 Known Gaps

Unified gap table combining loot/pickup gaps (prefix L) and barter gaps (prefix B).

| ID | Status |
|----|--------|
| L1 | ✅ `Obj.canCarry` (CE `itemAttemptAdd`) blocks pickup / loot over the carry weight |
| L2 | ✅ `CRITTER_NO_DROP` checked in `_attackFindInvalidFlags` (no DAM_DROP) and on death (`itemDropAll`) |
| L3 | ✅ ammo stacks are CE boxes + rounds in the top box (C36); pricing and reloading agree |
| L4 | ✅ `move_obj_inven_to_obj` = CE `itemMoveAll` (merges; armor and hands included — C44) |
| L5 | ✅ money is a normal stack; `itemGetTotalCaps` sums every stack |
| L6 | ✅ `pickup_p_proc` fires when an item is equipped from the inventory screen |
| L7 | ✅ Stealth Boy state follows hand changes (`refreshStealthState`) |
| L8 | ✅ stacking is CE `_item_identical` (`Obj.approxEq`, 2026-10-18): same PID and script, nothing equipped / worn / queued, no containers or inventories, same charges; weapons also the same load |
| L9 | ✅ `item_caps_total` counts live (and recursively — 2026-10-18) |
| L10 | ✅ `critter_inven_obj(-2)` returns the inventory count |
| L11 | ✅ containers run `use_p_proc` before the loot screen opens |
| B1–B7 | ✅ CE `_barter_compute_value` (§6.3) |
| B8 | ✅ the weight check (message 31, 2026-10-18) |
| B9 | ✅ party trade is the weight-only screen |
| B10 | ✅ caps total / adjust recurse into containers (2026-10-18) |
| B11 / B12 | ✅ the dialogue window's BARTER button reads `CRITTER_BARTER` |

Open: none.

<!-- audited: 2026-10-18 -->
