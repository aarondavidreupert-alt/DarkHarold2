# Loot Economy — DarkHarold2 Reference

> Ground-truth: `raw/fallout2-ce/src/proto_instance.cc` (`_obj_pickup`), `raw/fallout2-ce/src/item.cc` (`itemAdd`, `itemRemove`), `raw/fallout2-ce/src/inventory.cc`  
> DH2 impl: `src/object.ts` (`Obj.pickup`, `Obj.drop`, `Obj.addInventoryItem`), `src/scripting.ts` (inventory opcodes, `Scripting.pickup`), `src/ui_loot.ts` (`uiLoot`), `src/main.ts` (loot entry points)  
> See also: [barter_economy.md](barter_economy.md) — item pricing, trade formulas  
> See also: [critter_stats.md](critter_stats.md) §1.3 — `CRITTER_NO_DROP` flag gap

---

## 1. Item Pickup — CE Flow (`proto_instance.cc:571`)

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

### CE `itemAdd` / `item_add_force` (`item.cc:322`)

`itemAdd(owner, item, qty)` is the low-level stack merge:
- Scans existing inventory for identical items (`_item_identical`)
- If found: increments quantity; for ammo: merges rounds up to ammo capacity
- If not found: appends new slot, grows array by 10 if needed
- Special case: STEALTH_BOY II auto-activates stealth if item is in-hand at add time
- Sets `item->owner = owner`

`itemAttemptAdd` is the weight-checking wrapper; scripts use `item_add_force` (calls `itemAdd` directly, bypassing weight check).

---

## 2. DH2 Pickup Flow (`object.ts:941`)

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

### `Obj.addInventoryItem` (`object.ts:625`)

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

---

## 3. Loot UI (`ui_loot.ts`)

Opened from `main.ts`:
- Dead critter: right-click → `uiLoot(obj)` (`main.ts:353`)
- Any object: debug hotkey `Config.controls.showTargetInventory` → `uiLoot(obj)` (`main.ts:873`)

```typescript
export function uiLoot(object: Obj)
```

Layout: two-column panel (left = player inventory, right = target inventory). Items are rendered as inventory art PNGs with an `×N` quantity label.

**Move (drag-and-drop):** `uiLootMove` resolves source/destination arrays from an encoded string (`"l{idx}"` = player, `"r{idx}"` = target), then delegates to `uiSwapItem(from, item, to, amount)` from `ui_barter.ts`. For stacks > 1, prompts for quantity via `uiGetAmount`.

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

## 4. Inventory Script Opcodes

All implemented in `src/scripting.ts` inside the `Script` class.

### 4.1 Bulk Transfer

| Opcode | Signature | DH2 Behavior |
|--------|-----------|--------------|
| `move_obj_inven_to_obj` | `(src, dst)` | `dst.inventory = src.inventory; src.inventory = []` — direct array reassignment, no stack-merge |
| `add_mult_objs_to_inven` | `(obj, item, count)` | Calls `obj.addInventoryItem(item, count)` — stack-merges by PID |
| `add_obj_to_inven` | `(obj, item)` | Delegates to `add_mult_objs_to_inven(obj, item, 1)` |
| `rm_mult_objs_from_inven` | `(obj, item, count)` | Finds item by `approxEq` (PID match), subtracts count; splices if amount ≤ 0. Wired at `0x8117`. |
| `rm_obj_from_inven` | `(obj, item)` | Method exists at `scripting.ts:738` and delegates to `rm_mult_objs_from_inven(obj, item, 1)`, but **opcode `0x80D9` is absent from `vm_bridge.ts`** — scripts calling this opcode silently fail. See `wiki/scripting_opcodes_index.md §7`. |

### 4.2 Query

| Opcode | Signature | Returns |
|--------|-----------|---------|
| `obj_is_carrying_obj_pid` | `(obj, pid)` | Count of inventory items matching PID |
| `obj_carrying_pid_obj` | `(obj, pid)` | First inventory item with matching PID, or `0` |
| `critter_inven_obj` | `(critter, slot)` | Equipped item: `0`=worn armor, `1`=right hand, `2`=left hand; `-2` (INV_COUNT) returns `0` with a warning |
| `inven_cmds` | `(obj, cmd, idx)` | STUB — `INVEN_CMD_INDEX_PTR` (13) only; always returns `null` |

### 4.3 Caps (Currency)

`MONEY_PID = 41` (Bottle Caps) is hardcoded in DH2.

| Opcode | Signature | DH2 Behavior |
|--------|-----------|--------------|
| `item_caps_total` | `(obj)` | Returns `obj.money` (a cached numeric field) |
| `item_caps_adjust` | `(obj, amount)` | Scans inventory for PID 41; adjusts `.amount`; clamps to 0; if no caps stack found and `amount > 0`, creates a new `MONEY_PID` object via `createObjectWithPID(41)` and adds it |

---

## 5. Drop Flow (`object.ts:965`)

`Obj.drop(source)` removes the item from `source.inventory`, fires `drop_p_proc` if present, plays `iputdown` sound, and `gMap.addObject(this)` re-adds it to the map at the source's tile.

CE counterpart: `_obj_remove_from_inven` (`item.cc:621`) — also handles unequipping from both hands and rebuilding the FID (weapon skin change on drop).

---

## 6. CE Script Variable Context in `pickup_p_proc`

| Var | CE value | DH2 value |
|-----|----------|-----------|
| `self_obj` | The item being picked up | Same |
| `source_obj` | The critter picking it up | Same |
| `target_obj` | `nullptr` | Not set (undefined) |
| `game_time` | `gameGetGlobalTime()` | `globalState.gameTickTime` |
| `cur_map_index` | Current map ID | `currentMapID` |

CE also fires `SCRIPT_PROC_PICKUP` (index 4) in `inventory.cc:4102` and `4494` during the inventory UI equip path — DH2 does not replicate this second firing.

---

## 7. Known Gaps vs CE

| # | Feature | CE Behavior | DH2 Status | Impact |
|---|---------|-------------|------------|--------|
| 1 | Weight limit enforcement | `itemAttemptAdd` refuses pickup if critter exceeds carry weight; shows "at maximum weight" message | MISSING — `addInventoryItem` has no weight check; loot UI has no weight check | Player can carry unlimited items |
| 2 | `CRITTER_NO_DROP` flag | Critters with `CRITTER_NO_DROP` bit set do not drop items when killed | MISSING — `critterKill()` never checks `pro.extra.flags`; all critters drop inventory | Quest-critical "no drop" critters will expose loot that should be invisible |
| 3 | Ammo stack merge | CE merges ammo into existing magazines: fills to capacity, splits remainder | PARTIAL — `addInventoryItem` stacks by PID but uses simple quantity addition; no magazine-capacity splitting | Ammo always stacks without capacity limit |
| 4 | `move_obj_inven_to_obj` identity | CE iterates items and calls `itemAdd` for each (stack-merging) | DH2 bulk-assigns the array reference directly: `dst.inventory = src.inventory` — no merge | Scripts that call `move_obj_inven_to_obj` when `dst` already has items will overwrite dst inventory |
| 5 | Caps pickup quantity | CE's `PROTO_ID_MONEY` path calls `itemGetMoney(item)` which sums all money objects at the tile | DH2 `pickup` passes `this.amount` directly — correct for items placed as discrete amounts; may be wrong for multi-money-object tiles | Tile with multiple separate caps piles may not sum correctly |
| 6 | `pickup_p_proc` in inventory UI | CE also fires `SCRIPT_PROC_PICKUP` when equipping an item via the inventory screen (two call sites in `inventory.cc`) | NOT FIRED in DH2 inventory screen (`ui_inventory.ts`); only fires on tile pickup | Scripts that use `pickup_p_proc` to track equip events won't trigger from inventory |
| 7 | STEALTH_BOY II auto-stealth | `itemAdd` checks `PROTO_ID_STEALTH_BOY_II` and activates stealth if the item is in-hand | NOT IMPLEMENTED in `addInventoryItem` | Picking up STEALTH_BOY II while holding it won't auto-activate |
| 8 | `approxEq` stacking granularity | CE `_item_identical` compares full object state (type, proto ID, flags, charges, condition) | DH2 `approxEq` compares only `pid` — items with same PID but different charges (loaded / unloaded guns) or different conditions always stack | Damaged vs. pristine items of same PID merge into one stack incorrectly |
| 9 | `item_caps_total` | CE iterates all inventory items of type `ITEM_TYPE_MONEY` and sums their quantities | DH2 returns `obj.money` — a cached field whose update path is not fully audited | May return stale value if caps are added via `addInventoryItem` without updating `obj.money` |
| 10 | `critter_inven_obj` slot −2 | CE `INVEN_TYPE_INV_COUNT` returns `inventory.length` | DH2 returns `0` and warns — returns incorrect count | Scripts querying `INVEN_TYPE_INV_COUNT` always get 0 |
| 11 | Loot UI entry condition | CE opens the container/loot UI only for valid container/dead critter objects, after running `use_p_proc` and checking scripting overrides | DH2 `uiLoot` is called directly with no `use_p_proc` invocation for the container-open case | Container scripts that use `use_p_proc` to control whether the container can be opened are bypassed |
