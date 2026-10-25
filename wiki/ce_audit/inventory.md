# CE parity audit — Inventory / use-on / loot / steal / barter screens

Scope: CE files `raw/fallout2-ce/src/inventory.cc` (+ `inventory.h`), with the callees needed to judge behaviour (`item.cc objectGetInventoryWeight / itemMoveAllHidden`, `critter.cc critterIsActive`, `reaction.cc reactionGetValue`, `game_dialog.cc gameDialogBarter`, `interpreter_extra.cc opObjectIsCarryingObjectWithPid`).
DH2 files: `src/ui_inventory/panel.ts`, `src/ui_inventory/dragdrop.ts`, `src/ui_barter/screen.ts`, `src/ui_barter/swap.ts`, `src/ui_loot.ts`, `src/ui_steal.ts`, `src/ui_companion_trade.ts`, `src/inventoryWield.ts`, `src/weaponAmmo.ts`, `src/examine.ts`, `src/useItemOn.ts`, `src/playerUse.ts`, `src/input.ts`, `src/hotkeys.ts`, `src/scripting.ts` (inventory opcodes), `src/object/Critter.ts`, `src/ui_dom.ts`.
Audited 2026-10-24.

## Summary

59 CE functions in inventory.cc, grouped into 47 table rows (trivial pairs such as init/free and get-item-1/2/armor share a row).

| Status | Count |
|---|---|
| ✅ MATCH | 13 |
| ⚠️ DIFFERS | 11 |
| 🟡 PARTIAL | 15 |
| ❌ MISSING | 3 |
| 🚫 N/A | 5 |

Top findings (by severity):

1. **INV-01 (HIGH)** `obj_is_carrying_obj_pid` returns the number of *stacks*, not the quantity: 10 stimpaks count as 1. CE `objectGetCarriedQuantityByPid` sums quantities, recurses into bags, and counts the dude's equipped items, which DH2 keeps outside `inventory[]`. Every script check like "has ≥ N of X" is wrong.
2. **INV-03 (MED)** Barter / companion trade: a merchant's worn armor and right-hand weapon (or, with an empty right hand, his first weapon) can be bought. A companion's armor and weapon can be taken too. CE `inventoryOpenTrade` removes them from the tradable list for the duration. When DH2 swaps in the cloned inventory, the merchant's hand and armor references are left pointing at stale objects.
3. **INV-04 (MED)** Steal: you can steal the target's wielded weapon and worn armor. CE `inventoryOpenLooting` (with `_gIsSteal`) takes hands and armor out before the window opens. After the steal, the DH2 NPC still points `rightHand` at the item you stole.
4. **INV-05 (MED)** Looting containers and bodies never runs the target's `pickup_p_proc` or honours `script_overrides`. `CRITTER_NO_STEAL` (msg 50) is not checked, hidden items (`itemMoveAllHidden`) are shown, and there are no arrows to cycle through several corpses on one hex.
5. **INV-06 (MED)** A knocked-out (not dead) target opens the steal window with rolls. CE `inventoryOpenStealing` uses `critterIsActive`, so a KO target is looted freely.
6. **INV-07 (MED)** Opening the inventory in combat with fewer than 4 AP (2 with Quick Pockets) is allowed and costs nothing: `subtractCombatAP` fails silently. CE refuses with inventry.msg 19.
7. **INV-08 (MED)** The barter screen's merchant-side total shows the raw item cost. CE shows `_barter_compute_value`, the price you actually have to match. There is no "Ok, that's a good trade." (msg 27) and no T / M hotkeys.
8. **INV-09 (MED)** Inventory summary panel: AC = AGI + armor AC (ignores perks, traits, drugs), DR comes from the armor alone, DT is missing, the "Explode" row shows *DR Electrical*, the weapon line has no melee bonus and no ammo line, and "(Not worn)" is missing.
9. **INV-10 (MED)** Equipping an item into a hand fires its `pickup_p_proc`. This is DH2-invented: CE `_inven_pickup` / `_switch_hand` run no script. A hand → armor-slot drag also accepts non-armor.
10. **INV-11 / INV-12 / INV-13 (MED)** Look/examine in the inventory skips `description_p_proc`, the ammo line and the weight line. There is no context menu in loot, barter or steal, and equipped items have no Drop. Bags and backpacks cannot be opened or filled (`_container_enter`, `_drop_into_container`).

## Function table

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| `_inven_reset_dude` (inventory.cc:525) | — (DH2 always uses `globalState.player`) | 🚫 N/A | — | `_inven_dude` / `_inven_pid` state has no DH2 equivalent; only the dude opens the inventory. |
| `inventoryMessageListInit` / `inventoryMessageListFree` (:533/:549) | `util.ts getMessage('inventry', n)` | 🚫 N/A | — | Message list loading replaced by the global msg cache. |
| `inventoryOpen` (:556) | `ui_inventory/panel.ts:123 showInventory`, `:116` INV button, `hotkeys.ts:218`, `input.ts:158` | 🟡 PARTIAL | MED | 4 − 2×Quick Pockets AP ✅. Refusal with msg 19 when short of AP ❌ (INV-07), and no `_combat_whose_turn` check. Esc / I close ✅. Home / End / PgUp / PgDn / arrow scrolling keys ❌ (LOW). Right-click toggles the hand/arrow cursor in CE; DH2 right-click opens the context menu directly (documented deviation). Closing: `_adjust_fid`, AC redraw, `interfaceUpdateItems` ✅ via `uiDrawWeapon` / `drawAC`. |
| `_setup_inventory` (:735) | static DOM `#inventoryBox`, `#lootBox`, `#barterBox` + `panel.ts:78 initInventory` | 🟡 PARTIAL | LOW | Layout / button art replaced by DOM. Done button red-button sounds ✅ (C66). Take All hidden while stealing ✅ (`ui_steal.ts:285`). The use-item-on window reuses the normal panel with Done instead of Cancel (LOW). |
| `_exit_inventory` (:1525) | `panel.ts:58 closeInventory` | 🟡 PARTIAL | MED | Re-flagging the hand items is N/A (DH2 keeps the dude's hands outside the list). The **`_dropped_explosive` watcher** is ❌: CE, after an armed explosive is dropped from the inventory, makes every non-team critter in the blast extras that passes a PE roll mark the dude as who-hit-me and requests combat (INV-14). |
| `_display_inventory` (:1605) | `panel.ts:355 drawInventory` | ⚠️ DIFFERS | LOW | CE lists the inventory **newest-first** (`items[length − (i+offset+1)]`), DH2 in array order (all four DH2 screens). Scrolling: CE moves one slot per wheel or arrow step; DH2 scrolls the DOM by 60 px. |
| `_display_target_inventory` (:1809) | `ui_loot.ts:94`, `ui_barter/screen.ts:319`, `ui_steal.ts:205` | ⚠️ DIFFERS | LOW | Same reverse-order difference. |
| `_display_inventory_info` (:1933) | `ui_dom.ts:119 appendItemSlot` | ⚠️ DIFFERS | LOW | CE: ammo shows **rounds** (`capacity×(boxes−1)+top`, the dragged box excluded), other items `x<n>` only when n > 1, capped at 99999. DH2 always shows `x<amount>` (box count for ammo, and "x1" for singles). |
| `_display_body` (:1982) | `panel.ts:301 drawCharacterPortrait`; `ui_barter/screen.ts:39 renderBarterPortrait`, `:103` | ⚠️ DIFFERS | LOW | CE spins the dude every 1000/6 ≈ 166 ms in the normal / use-on windows (DH2: 250 ms). In trade and loot windows (`fid != -1`) the dude is static ROTATION_SW and the target faces its own rotation. DH2's barter screen spins the dude; the loot / steal window has no body views (unverified in CSS). |
| `inventoryCommonInit` / `inventoryCommonFree` (:2121/:2177) | — | 🚫 N/A | — | Cursor FRM locking and game-UI enable/disable. |
| `inventorySetCursor` (:2194) | — | 🚫 N/A | — | Hand / arrow / blank cursors replaced by HTML5 drag plus the right-click menu (documented approximation "Action menu on right-click"). |
| `inventoryItemSlotOnMouseEnter` / `…OnMouseExit` (:2207/:2240) | `panel.ts:146 showItemInfo` (on click) | ⚠️ DIFFERS | LOW | In arrow mode, CE hovering prints `_obj_look_at_func` ("You see: …", look_at_p_proc) into the info area. DH2 shows name + proto description on click, with no look_at_p_proc. |
| `_inven_update_lighting` (:2251) | `dragdrop.ts:201 updateHandFlareLight` | 🟡 PARTIAL | LOW | DH2 re-lights only for a lit flare. CE sets the dude's light to max(4, active item's lightDistance) at 0x10000 while dragging and after the drop (unverified for other light items). |
| `_inven_pickup` (:2268) | `dragdrop.ts:99 uiMoveSlot`, `panel.ts:392` (ammo onto a weapon in the list) | 🟡 PARTIAL | MED | INV-10: pickup_p_proc fired on equip (DH2-invented); hand → armor slot accepts any item. Dropping onto a **container** item (bag) ❌ (INV-13). Dropping onto the body view inside a nested bag ❌. `ipickup1` / `iputdown` drag sounds ❌ (DH2 plays its own armor sounds instead, see DH2-only). Stack drag asks the quantity (DH2) — CE drags one item from the list to a hand; for stacked items moved into a hand slot, CE `_switch_hand` moves exactly 1, while DH2 asks how many and may put a stack of N in a hand (LOW). |
| `_switch_hand` (:2490) | `dragdrop.ts:149-169` | 🟡 PARTIAL | LOW | Swap semantics ✅. CE: ammo dropped on a hand weapon it cannot reload returns with no swap. DH2 falls through and puts the ammo in the hand, pushing the weapon to the inventory (`dragdrop.ts:117-123`). CE weight-checks the displaced item with `itemAdd` (rare). |
| `_adjust_ac` (:2544) | `perks/cePerks.ts:303 armorPerkSwap`; armor AC/DR read live (`drawAC(getStat('AC') + armorAC)`, `Critter.getArmorDR`) | ✅ FIXED (2026-10-25) | LOW | Perk part ✅ (party members). DH2 never writes the AC/DR/DT bonus stats; it reads the armor at use time, which is equivalent for combat if every consumer adds the armor (combat audit's scope). The display consequences are INV-09. |
| `_adjust_fid` (:2582) | `dragdrop.ts:209 applyArmorArt`, `Critter.getAnimation` | ✅ MATCH | — | Armor male/female FID, fallback to the base art (CE `_art_vault_guy_num` / proto fid), weapon anim code via the idle animation. |
| `inventoryOpenUseItemOn` (:2633) | `panel.ts:53 showInventoryUseOn`, `:380`; `useItemOn.ts:55/67` | ✅ MATCH | — | No 4-AP open cost, click → `_action_use_an_item_on_object`, 2 AP in combat (refused below 2), window closes. Keyboard scrolling ❌ (LOW, as above). |
| `critterGetItem2` / `critterGetItem1` / `critterGetArmor` (:2771-2815) | `Critter.ts:222-236` (hand flags), `Critter.ts:336 getEquippedArmor` | 🟡 PARTIAL | MED | Hand flags ✅. `getEquippedArmor` for NPCs falls back to "**the first armor carried**" when none is flagged OBJECT_WORN — CE returns null (INV-15). |
| `objectGetCarriedObjectByPid` (:2837) | `scripting.ts:1369 obj_carrying_pid_obj` | ⚠️ DIFFERS | MED | No recursion into containers; misses the dude's hand / armor items (outside `inventory[]`) (INV-02). |
| `objectGetCarriedQuantityByPid` (:2857) | `scripting.ts:1301 obj_is_carrying_obj_pid` | ⚠️ DIFFERS | HIGH | Counts stacks, not quantity; no container recursion; misses the dude's equipped items (INV-01). |
| `inventoryRenderSummary` (:2878) | `panel.ts:162 showStats` | ⚠️ DIFFERS | MED | INV-09. |
| `_inven_find_type` (:3190) | inline loops (combat AI) | ✅ MATCH | — | Generic helper; its one inventory.cc use (hiding the merchant's first weapon in trade) is missing, see INV-03. |
| `_inven_find_id` (:3220) | `combat/Combat.ts:306` | ✅ MATCH | — | |
| `_inven_index_ptr` (:3248) | `scripting.ts:1496 inven_cmds` | ✅ MATCH | — | |
| `_inven_wield` / `_invenWieldFunc` (:3263/:3269) | `inventoryWield.ts:35 invenWield`, `scripting.ts:1653` | 🟡 PARTIAL | LOW | Flags, hand choice (dude: active hand, NPC: right), lit-flare light ✅. Missing: the put-away / take-out animation and sfx (`animationRegisterTakeOutWeapon`), and the `artExists` failure (−1 when the critter has no art for that weapon). CE quirk: for **the dude** wielding armor, only the FID changes and `_adjust_ac` is *not* called; DH2 applies the armor's AC and perk (DH2 is "more correct" than CE here; undocumented). |
| `_inven_unwield` / `_invenUnwieldFunc` (:3411/:3417) | `inventoryWield.ts:74 invenUnwield` | 🟡 PARTIAL | LOW | Put-away animation and sfx missing; state ✅. |
| `_inven_from_button` (:3462) | drag data strings `i<n>` / `leftHand` / … | 🚫 N/A | — | Button → item mapping. |
| `inventoryRenderItemDescription` (:3558) | CSS wrapping in `#inventoryBoxInfo` | ✅ MATCH | — | Line wrap at 152 px / 17 lines; DOM wraps automatically. |
| `inventoryExamineItem` (:3645) | `panel.ts:146 showItemInfo` | ⚠️ DIFFERS | MED | INV-11: no `description_p_proc`, no `_obj_examine_func` extra lines (weapon ammo, ammo modifiers), no "It weighs %d pounds." (proto.msg 540/541). `examine.ts objExamine` exists but is not used here. |
| `inventoryWindowOpenContextMenu` (:3712) | `panel.ts:550 makeItemContextMenu`, `:408 itemAction`, `:508` | 🟡 PARTIAL | MED | INV-12. Normal-window menu sets ✅ for list items. Equipped items: CE uses the same sets, so Drop and Use are available; DH2 drops Drop (it uses the `_act_weap2`-style sets meant for other windows) and adds Unequip. No context menu at all in loot, steal or barter (CE: look / unload / use-bag / drop). Drop details: money special case, armed explosive → `_dropped_explosive`, N separate `_obj_drop` calls for N items. Use on a container → `_container_enter` ❌. Unload ✅. |
| `inventoryOpenLooting` (:4057) | `ui_loot.ts:51 uiLoot` (callers `playerUse.ts:145/412`, `ui_contextmenu.ts:168`, `Obj.ts:356`, `input.ts:538`) | 🟡 PARTIAL | MED | INV-05 (pickup_p_proc + override, NO_STEAL msg 50, hidden items, corpse cycling). Closed animated container returns early ✅ (DH2 opens it first). Take All: INV-16. |
| `inventoryOpenStealing` (:4505) | `playerUse.ts:141-146`, `ui_steal.ts:193 uiSteal` | ⚠️ DIFFERS | MED | INV-04 (equipped items stealable), INV-06 (KO target → steal). Steal-XP accrual (+10, +20, …, capped at 300 − Steal, none if caught or vs a party member) ✅. Caught → window closes, then the target's pickup_p_proc runs ✅. |
| `_move_inventory` (:4525) | `ui_steal.ts:251 attemptSteal`, `ui_loot.ts:55 uiLootMove` | ✅ MATCH | LOW | Quantity first, then `skillsPerformStealing` (planting too), then the move ✅; `_gStealCount` incremented per click (cancel included) ✅. Minor: when the dude can't carry a stolen item, CE shows msg 25 and DH2 msg 26 (`ui_steal.ts:273`). Taking a right-hand item from a target doesn't reset the target's FID weapon code (CE does). |
| `_barter_compute_value` (:4673) | `ui_barter/screen.ts:220 barterMinPlayerOffer`; companion: weight (`ui_companion_trade.ts`) | ✅ MATCH | — | `(160+npcBarter)/(160+partyBestBarter) × (cost−caps) × 2 × (mod+100−MasterTrader25)×0.01 + caps`, reaction modifier added as in `inventoryOpenTrade`, party best Barter (C49). DH2 clamps the multiplier with `max(0.01, …)`; CE replaces it with 0.01 only when it is < 0 (negligible). |
| `_barter_attempt_transaction` (:4706) | `ui_barter/screen.ts:251 offer`, `ui_companion_trade.ts:101 offer` | 🟡 PARTIAL | LOW | Weight check (31), party-member weight check (32), empty or low offer (28) ✅. Missing: the `itemIsQueued` check on the offer table (a running device or armed item makes the offer bad; a Geiger counter is switched off). Companion trade: the dude's weight excludes his equipped items (CE `objectGetInventoryWeight` includes them) (LOW). |
| `_barter_move_inventory` / `_barter_move_from_table_inventory` (:4765/:4852) | `ui_barter/screen.ts:341 uiBarterMove`, `swap.ts:282 uiSwapItem` | ✅ MATCH | — | Quantity window for stacks ✅; ammo top-box split ✅ (C36). |
| `inventoryWindowRenderInnerInventories` (:4939) | `ui_barter/screen.ts:449 redrawBarterInventory` | ⚠️ DIFFERS | MED | INV-08: the right table shows the raw `stackCost` sum; CE shows `_barter_compute_value`. Party member: "msg 30 + weight" (unverified in DH2's readout). |
| `inventoryOpenTrade` (:5031) | `ui_barter/screen.ts:156 uiBarterMode`, `ui_companion_trade.ts:60` | 🟡 PARTIAL | MED | INV-03 (equipped items tradable), INV-08 (msg 27, T/M keys). Reaction modifier (bad +25, neutral 0, good −15 from LVAR 0) ✅. Scroll buttons ✅ (P19/P20). |
| `_container_enter` / `_container_exit` (:5362/:5404) | — | ❌ MISSING | MED | INV-13: no nested bag / backpack inventories in any window. |
| `_drop_into_container` (:5429) | — | ❌ MISSING | MED | INV-13. |
| `_drop_ammo_into_weapon` (:5469) | `dragdrop.ts:77 tryLoadAmmoIntoWeapon` | ✅ MATCH | — | Compatibility, quantity of boxes, reload loop, READY sound ✅. |
| `_draw_amount` (:5534) | `swap.ts:48 drawBignumDigits`, `uiGetTimer` redraw | ✅ MATCH | — | |
| `inventoryQuantitySelect` (:5584) | `swap.ts:72 uiGetAmount`, `swap.ts:192 uiGetTimer` | 🟡 PARTIAL | LOW | Move-items differences: in CE the first typed digit *replaces* the value and later digits append (mod 100000); DH2 appends to the initial 1 (typing "5" gives 15). CE Backspace is missing in DH2. CE beeps (`iisxxxx1`) on Return when the value is outside [1, max]; DH2 clamps. The 99999 max is not applied. The accept sound `ib1p1xx1` is missing. ALL ✅, hold-repeat ✅ (different acceleration). Timer: ✅. |
| `inventoryQuantityWindowInit` / `…Free` (:5743/:5957) | static `#moveMultOverlay` | ✅ MATCH | — | Positions per P23/P24. |
| `_inven_set_timer` (:5971) | `swap.ts:192 uiGetTimer` | ✅ MATCH | — | 10–180 s in 10 s steps, default 60. |
| `inven_get_current_target_obj` (:5991) | — | ❌ MISSING | LOW | Used only by sfall `inventory_target`-style opcodes; no DH2 caller found (unverified whether UPU needs it). |

## Detailed findings

### INV-01 — `obj_is_carrying_obj_pid` counts stacks, not items (HIGH, NEW) — **FIXED 2026-10-24 (PA8)**
- CE: `inventory.cc objectGetCarriedQuantityByPid` (via `interpreter_extra.cc:1040 opObjectIsCarryingObjectWithPid`).
- DH2: `src/scripting.ts:1301-1317`.
- **CE behaviour:** sums `inventoryItem->quantity` for every entry with the pid and recurses into each item's own inventory (bags). For the dude, wielded and worn items are ordinary inventory entries (flagged OBJECT_IN_*_HAND / OBJECT_WORN), so they count too.
- **DH2 behaviour:** `count++` per matching entry in `obj.inventory`. A stack of 10 counts as 1; bag contents don't count; the dude's `leftHand`, `rightHand` and `armor` are outside `inventory[]` and are never seen.
- **Impact:** quest and dialogue checks like "bring me 5 X", "do you have the holodisk / the gun", and "is the dude wearing armor X" get the wrong count. A wielded quest weapon counts as "not carried". Wide blast radius across the 1288 scripts.
- **Fix:** sum `amount` recursively and, for the dude, add the equipped slots (as `unequipForRemoval` does for removal). The same applies to INV-02.

### INV-02 — `obj_carrying_pid_obj` misses bags and the dude's equipped items (MED, NEW) — **FIXED 2026-10-24 (PA8)**
- CE: `objectGetCarriedObjectByPid` (recursive). DH2: `src/scripting.ts:1369`.
- DH2 scans the top-level `inventory[]` only. A script that fetches the dude's wielded weapon or worn armor by pid (for example to `rm_obj_from_inven` it) gets 0.
- **Fix:** recurse, and check `leftHand`, `rightHand` and `armor` for the dude.

### INV-03 — Merchants and companions trade away their equipped weapon and armor (MED, NEW) — **FIXED 2026-10-25**
- CE: `inventory.cc:5040-5055 inventoryOpenTrade` removes `critterGetArmor` and `critterGetItem2` from the barterer before the window opens. If there is no right-hand item and the barterer is not a party member, it removes the first weapon instead (`_inven_find_type(…, ITEM_TYPE_WEAPON)`). All of them are re-added with their flags at exit.
- DH2: `src/ui_barter/screen.ts:193-194`, `src/ui_companion_trade.ts` (`companion.inventory.map(cloneItem)`). NPC equipped items stay in `inventory[]` (`inventoryWield.ts` header, `Critter.ts:222`), so they appear and can be bought. After a deal, `merchant.inventory` is replaced by clones, so `merchant.rightHand` / `armor` keep pointing at objects no longer in the inventory.
- **Impact:** you can buy a guard-merchant's gun or a vendor's armor, or strip a companion's armor through Trade, which CE forbids. Stale hand references follow.
- **Fix:** filter out (or hold aside) the flagged hand / worn items (plus CE's first-weapon rule for vendors) when building the working inventory, and re-link the hand references to the new clones after a deal.

### INV-04 — Stealing equipped items (MED, NEW) — **FIXED 2026-10-25**
- CE: `inventoryOpenLooting:4135-4148` (`_gIsSteal`) removes item1, item2 and armor from the target and restores them at exit.
- DH2: `src/ui_steal.ts:221` shows `target.inventory` in full; `uiSwapItem` moves the item without clearing `target.rightHand` / `armor`.
- **Impact:** you can pickpocket a raider's wielded weapon or worn armor, and the NPC keeps fighting with a weapon that is now in your inventory (shared object).
- **Fix:** exclude the hand / worn flagged items from the steal view.

### INV-05 — Looting skips pickup_p_proc / NO_STEAL / hidden items (MED, NEW) — **FIXED 2026-10-25**
- CE: `inventoryOpenLooting:4067-4111`:
  - `CRITTER_NO_STEAL` → msg 50 "You can't find anything to take from that." and return.
  - Not stealing → the target's `pickup_p_proc` (source = looter); `script_overrides` aborts.
  - `itemMoveAllHidden` keeps hidden items out of view.
  - With several dead or KO critters on the hex, PgUp / PgDn arrows cycle the bodies.
- DH2: `src/ui_loot.ts:51` and all callers (`playerUse.ts:145/412`, `ui_contextmenu.ts:168`, `Obj.ts:356`; only the dev key in `input.ts:533` runs `use_p_proc`). None of these exist.
- **Impact:** script-protected containers and corpses (scripts that react to looting, or override it) don't work. NO_STEAL critters (some bodies flagged so) can be looted. Script-hidden inventory shows up.
- **Fix:** port the pre-checks into `uiLoot` (or a wrapper), plus the hidden-items filter.

### INV-06 — A knocked-out target opens the steal window (MED, NEW) — **FIXED 2026-10-25**
- CE: `inventoryOpenStealing:4510` `_gIsSteal = … && critterIsActive(target)`; `critterIsActive` is false for DAM_KNOCKED_OUT | DAM_DEAD, so a KO target opens a plain loot window (no rolls, no XP, nothing hidden).
- DH2: `src/playerUse.ts:141-146` checks only `target.dead`; the comment claims KO targets loot freely, but the code sends them to `uiSteal`.
- **Fix:** `if (target.dead || (target.injuryFlags & DAM_KNOCKED_OUT)) uiLoot(target)`.

### INV-07 — Inventory in combat without enough AP (MED, NEW) — **FIXED 2026-10-25**
- CE: `inventoryOpen:566-590`: with 4 − 2×QP AP required and fewer AP left → inventry.msg 19 "You don't have enough action points to use inventory" and no window. It also returns unless it is the dude's turn.
- DH2: `src/ui_inventory/panel.ts:134-142`: `subtractCombatAP` returns false when short (`combat/actionPoints.ts:74`), the result is ignored, and the window opens for free.
- **Fix:** check `getAvailableCombatAP() < apCost` → uiLog(msg 19) and don't open.

### INV-08 — Barter merchant-table price and trade feedback (MED, NEW) — **FIXED 2026-10-25**
- CE: `inventoryWindowRenderInnerInventories:4999-5010` prints `$<_barter_compute_value>` under the merchant's table (for party members, msg 30 + weight). `inventoryOpenTrade` shows msg 27 "Ok, that's a good trade." after a successful vendor deal; `T` = talk, `M` = offer.
- DH2: `src/ui_barter/screen.ts:462-466` shows the raw cost sum on both sides; `offer()` succeeds silently; no keys.
- **Impact:** the player can't see what the merchant actually wants (the price is often 2× or more the raw cost) and has to guess.
- **Fix:** `$id('barterBoxRightAmount').textContent = '$' + barterMinPlayerOffer(merchantBarterTable)`; add msg 27 and the T / M keys.

### INV-09 — Inventory summary panel values (MED, NEW) — **FIXED 2026-10-25**
- CE: `inventoryRenderSummary` uses `gSummaryStats` / `gSummaryStats2`: HP cur/max, `STAT_ARMOR_CLASS`, and for Normal / Laser / Fire / Plasma / **Explode**, `DT/DR%` from the critter stats (armor plus perks, traits, drugs). Hand lines:
  - weapon: `Dmg: min-max(+Melee for melee/unarmed)`, plus `Rng:` only when range > 1 (or thrown), using the active (secondary) mode's range;
  - `Ammo: q/cap <ammo name>` when the weapon has capacity;
  - armor held in a hand: "(Not worn)".
  - "Total Wt" turns red when encumbered.
- DH2: `src/ui_inventory/panel.ts:255-296`:
  - AC = `getStat('AGI') + armor AC` (ignores Dodger, Kamikaze, drugs);
  - DR = the armor proto only;
  - no DT;
  - the "Explode" row reads `DR Electrical`;
  - weapon: `Dmg: proto min-max` + `Rng: maxRange1`, with no melee bonus, mode or ammo line;
  - non-weapons print just the name.
- **Fix:** use `getStat('AC')` and the critter DT/DR getters for every damage type (Explosion, not Electrical); port the hand-line rules.

### INV-10 — Equipping fires pickup_p_proc; hand → armor slot accepts any item (MED, NEW) — **FIXED 2026-10-25**
- CE: `_inven_pickup` / `_switch_hand` run no script proc. The armor slot accepts only `ITEM_TYPE_ARMOR` from any source (`inventory.cc:2440`).
- DH2: `src/ui_inventory/dragdrop.ts:164-168` calls `Scripting.pickup(obj, player)` when an item goes into a hand. The cited "inventory.cc:4494" is the caught-stealing pickup, not equip. The armor-type guard at `:114` runs only for drags from the list; a drag from a hand slot to the armor slot (`data = 'leftHand'`) puts a weapon in `armor`.
- **Impact:** scripted items' pickup_p_proc fires again on every equip (double rewards or messages, or a script refusing a pickup the player already made). A weapon can be "worn" as armor.
- **Fix:** remove the pickup call; apply the armor-type check for every source.

### INV-11 — Inventory "Look" skips the examine pipeline (MED, NEW) — **FIXED 2026-10-25**
- CE: `inventoryExamineItem` → name, separator, `_obj_examine_func` (the item's `description_p_proc`, with override; proto description or msg 493; weapon "loaded with" line 526; ammo AC/DR/damage-mod lines 510-512), then "It weighs %d pound(s)." (proto.msg 540/541). In loot and barter windows Look prints `_obj_examine_func` to the monitor.
- DH2: `src/ui_inventory/panel.ts:146 showItemInfo` → name + `getDescription()` only. `src/examine.ts:objExamine` implements the CE text but isn't used here.
- **Fix:** render `objExamine(player, item)` lines plus the weight line.

### INV-12 — Context menus (MED, NEW) — **FIXED 2026-10-25**
- CE: `inventoryWindowOpenContextMenu`:
  - Normal window: the same action set for list and equipped items. A weapon that can be unloaded gets look / unload / drop / cancel; use-able items get look / use / drop / cancel; anything else gets look / drop / cancel. Dropping an equipped item moves it out of the slot first.
  - Loot / trade windows: menus too (`_act_weap2`, `_act_just_use` for bags, `_act_nothing`, own items `_act_use` / `_act_no_use`).
  - Drop: money uses the quantity window and `itemSetMoney`; an armed explosive sets `_dropped_explosive`; N items are dropped as N separate `_obj_drop` calls.
- DH2: `src/ui_inventory/panel.ts:567-594`: equipped slots get the "no drop" sets plus a DH2 Unequip; the loot, barter and steal screens have no menu (`ui_loot.ts`, `ui_barter/screen.ts`, `ui_steal.ts` only drag).
- **Impact:** you can't unload a weapon or examine an item in a container or corpse before taking it, and you can't drop an equipped item directly.
- **Fix:** use the same set selection as CE for slots; add right-click menus (Look / Unload) to the other windows.
- **Fixed 2026-10-25:** CE's action sets in every window (`src/ui_inventory/itemMenu.ts`); USE on a bag opens it in the inventory, loot, steal, barter and companion-trade windows (in the trade windows only from either side's list, not the tables).

### INV-13 — No nested containers (bags / backpacks) (MED, NEW) — **FIXED 2026-10-25**
- CE: `_container_enter` / `_container_exit` (up to 9 levels, in every window type), `_drop_into_container` (drag onto a bag in the list, a hand slot, or the body view while inside a bag; `itemAttemptAdd` with the bag's capacity).
- DH2: nothing. Bag and backpack items are opaque; their contents can't be seen or moved, and nothing can be put in.
- **Fix:** a container stack in the inventory, loot and barter views (the `Use` action on a container item, plus a back button / body-view drop target).
- **Fixed 2026-10-25:** a bag stack per side (up to 9) in the inventory, loot, steal, barter and companion-trade windows; the body view shows the open bag (`drawBagView`) and a click there goes back up; moves into an open bag check its room (and, for the dude's, his carry weight). The trade windows open the working copies, so a bag's changes count only when the deal is made. Dropping onto a bag's icon works in the inventory window only.

### INV-14 — Dropping an armed explosive alerts no one (MED, NEW) — **FIXED 2026-10-25**
- CE: context-menu Drop of an active explosive sets `_dropped_explosive`. At `_exit_inventory`, the critters in the would-be blast (`_compute_explosion_on_extras`) that are not on the dude's team and pass a PE `statRoll` mark the dude as who-hit-me; the first one requests combat.
- DH2: no equivalent in `closeInventory` / `itemAction('drop')`.
- **Fix:** set a flag on dropping an armed explosive (`explosiveIsActiveExplosive` pids) and port the watcher loop on close.

### INV-15 — NPCs "wear" the first armor they carry (MED, NEW — DH2-only) — **FIXED 2026-10-25**
- CE: `critterGetArmor` returns only the OBJECT_WORN item, else null.
- DH2: `src/object/Critter.ts:336-347 getEquippedArmor` falls back to the first armor in the inventory.
- **Impact:** vendors and NPCs carrying armor for sale or as loot get its AC / DR / DT in combat (`getArmorDR`) and in `critter_inven_obj(…, INVEN_TYPE_WORN)` (`scripting.ts:1486`), unlike CE. (Overlaps the combat audit; reported here because it is `critterGetArmor`.)
- **Fix:** drop the fallback, or limit it to data that lacks flags, with a comment.

### INV-16 — Take All is partial and uses a hardcoded message (LOW, NEW) — **FIXED 2026-10-25**
- CE: `inventoryOpenLooting` `KEY_UPPERCASE_A`: if the target's whole inventory weight exceeds the remaining capacity → msg 31 "Sorry, you cannot carry that much." and **nothing** moves; otherwise `itemMoveAll`. The `A` key also triggers it.
- DH2: `src/ui_loot.ts:121-136` moves every item that fits, skips the rest, and logs the hardcoded English "You can't carry any more."; no `A` key.
- **Fixed 2026-10-25:** everything or nothing: the target's whole inventory weight against the room left, else inventry.msg 31 in a dialog box; Shift+A (the button's key) takes all and Esc closes the loot window (`ui_loot.ts lootKey`).

## DH2-only behaviour

- **Unequip** action in the context menu of equipped slots (`panel.ts:591-594`), labelled as a DH2 addition.
- **pickup_p_proc on equipping into a hand** (`dragdrop.ts:164-168`) — not in CE (INV-10).
- **Armor-change sounds** `ltharmor` / `pwrarmor` / `mtlarmor` / `robe` chosen from the armor art name (`dragdrop.ts:174-188`); CE plays only `ipickup1` / `iputdown` on any drag.
- **Quantity window extras:** Up / Down arrow keys change the amount (`swap.ts:160-161`); hold-to-repeat uses a fixed 300 / 60 ms cadence.
- **Stack into a hand:** dragging a stack into a hand slot asks for a quantity and can put several items in one hand (`dragdrop.ts:125-138`); CE moves one.
- **Barter screen spins the player portrait** (`ui_barter/screen.ts:103-111`); CE keeps the dude static (ROTATION_SW) in the trade window.
- **The dude's armor via `wield_obj_critter`** applies AC and perk effects (`inventoryWield.ts:44-46`); CE's `_invenWieldFunc` changes only the dude's FID (CE quirk not reproduced, undocumented).
- **NPC armor fallback** to the first carried armor (`Critter.ts:336`, INV-15).
- **Story-crawler hook** `activeBarter` (`ui_barter/screen.ts:122-132`): test tooling, not CE.
- **Inventory-list ammo-onto-weapon drop target** (`panel.ts:389-402`) — equivalent to CE dropping onto a list item; matches CE's `_drop_ammo_into_weapon` path, kept for completeness.
