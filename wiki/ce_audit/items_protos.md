# CE parity audit — Items, protos, object "use" actions

Scope: CE files `item.cc`, `proto.cc`, `proto_instance.cc` (+ `item.h`, `proto.h`, `proto_types.h`, `obj_types.h`); DH2 files `src/object/Obj.ts`, `src/object/items.ts`, `src/object/factories.ts`, `src/pro.ts`, `src/proto_types.ts`, `src/miscItem.ts`, `src/weaponAmmo.ts`, `src/critter/Weapon.ts`, `src/critter/lifecycle.ts`, `src/useItemOn.ts`, `src/playerUse.ts`, `src/examine.ts`, `src/inventoryWield.ts`, `src/drugs.ts`, `src/scripting.ts` (item/object opcodes), `src/map/GameMap.ts`, `src/ui_contextmenu.ts`, `src/ui_inventory/panel.ts`, `src/combat/*`, plus the map pipeline `tools/fomap.py` (the stand-in for `proto.cc objectDataRead`). Audited 2026-10-24.

## Summary

Counts (one row per CE function or grouped set of trivial getters):

| Status | Rows |
|---|---|
| ✅ MATCH | 64 |
| ⚠️ DIFFERS | 15 |
| 🟡 PARTIAL | 29 |
| ❌ MISSING | 9 |
| 🚫 N/A | 10 |
| **Total** | **127** |

Severity of the 53 rows that don't match: HIGH 7, MED 14, LOW 32.

Top findings, worst first:

1. **ITEM-12 (HIGH)**: the map pipeline drops per-object lock data. `tools/fomap.py` skips the common `data.flags` word and the door `openFlags`, so map-placed locked or jammed doors and containers start unlocked. DH2 only sets `Obj.locked` through `obj_lock`. The pipeline also drops misc-item charges (ground money amount) and key codes.
2. **ITEM-13 (HIGH)**: a ladder to another map never changes map. fomap.py saves the FO2 ladder `destinationMap` as `extra.unknown1`, but `Obj.use` reads `extra.destinationMap`. The stairs test is also not CE's (`> 0`).
3. **ITEM-07 (HIGH)**: `_obj_use_power_on_car` is not ported. Using a Small Energy Cell or Micro Fusion Cell on the car does nothing.
4. **ITEM-01 (HIGH)**: `itemIsHidden` reads the wrong flag. CE reads the proto flag `ITEM_HIDDEN` (0x08000000, DH2 `itemFlags & 0x08`); DH2 reads the object flag `OBJECT_HIDDEN` 0x01 everywhere. As a result, natural weapons count toward weight, can be dropped by a crit, show in loot, and are not destroyed when their owner dies. `itemDestroyAllHidden` and `itemMoveAllHidden` are missing.
5. **ITEM-06 (MED)**: arming an explosive leaves it in the pack. CE drops it at the user's feet (`_obj_use_item` rc 2), then `_protinstTestDroppedExplosive` lets non-team onlookers start combat.
6. **ITEM-09 (MED)**: `_protinst_use_item_on` on a scripted item works off `scr_return` in CE and off the override flag in DH2. Also, script `use_obj_on_obj` never reaches the engine default, so drugs and kits used from scripts are not applied or consumed.
7. **ITEM-17 (MED)**: `_check_scenery_ap_cost` is missing. In combat, using scenery or doors, picking up an item or opening a container costs 0 AP instead of 3.
8. **ITEM-02 (MED)**: Solar Scorcher recharge is missing. The reload mode is offered, but nothing loads.
9. **ITEM-18 (MED)**: `_proto_dude_init` gives the dude DR EMP 100; DH2's player has 0. EMP damage hurts the player.
10. **ITEM-03 / ITEM-08 / ITEM-15 / ITEM-19 (MED)**:
    - ITEM-03: the Motion Sensor does nothing.
    - ITEM-08: the `_obj_use_misc_item` items (Cat's Paw #5, Ramirez box, maps, Pip-Boy enhancers) are not consumed.
    - ITEM-15: `destroy_object` neither removes the item from its owner's inventory nor clears the item's queued events.
    - ITEM-19: `itemAttemptAdd` lacks the container-in-critter weight check and the non-biped refusal.

None of these are listed in `wiki/known_bugs.md`. Related closed rows: IU1 (use_obj_on_obj chain), LE10 (Stealth Boy), PS6 (proto ext flags), C44/C46 (items/flares), C57 (translucency).

## Function table

### item.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| itemsInit / itemsReset / itemsExit / _item_load_ / itemsLoad / itemsSave | `getMessage('item', …)`; static tables in Obj.ts / drugs.ts | 🚫 N/A | – | item.msg comes from the message JSON; books, explosives and healing pids are constants |
| itemAttemptAdd | `Obj.canCarry` Obj.ts:1033 (+ pickup Obj.ts:1355, ui_loot.ts:80/127) | 🟡 PARTIAL | MED | Critter weight check and the container `>=` size check match; three CE checks are missing. ITEM-19 |
| itemAdd | `Obj.addInventoryItem` Obj.ts:947; `ammoMergeInto` weaponAmmo.ts:69 | ✅ MATCH | LOW | Ammo top-box merge is the same. CE replaces the stack's object with the incoming one; DH2 keeps the old object. Stealth Boy II in hand → `refreshStealthState` |
| itemRemove | inventory splice at call sites; `ammoSplitOff` weaponAmmo.ts:83 | 🟡 PARTIAL | LOW | CE also looks inside containers and clears OBJECT_EQUIPPED / Stealth Boy; DH2 handles this at each call site. Container recursion not verified |
| _item_compact | Array.splice | 🚫 N/A | – | |
| _item_move_func / itemMove / itemMoveForce | ui_loot.ts transfer; `move_obj_inven_to_obj` | 🟡 PARTIAL | LOW | No "put it back, else drop at the owner's tile" fallback when the add fails |
| itemMoveAll | inventoryWield.ts:90 | ✅ MATCH | – | |
| itemMoveAllHidden | — | ❌ MISSING | MED | Used by inventory.cc:4127 to keep hidden items out of the loot / steal window. ITEM-01 |
| itemDestroyAllHidden | — | ❌ MISSING | HIGH | Called on death (critter.cc:905, combat.cc:4858) to destroy natural weapons; in DH2 they stay in the corpse's inventory. ITEM-01 |
| itemDropAll | `itemDropAll` critter/lifecycle.ts:300 | 🟡 PARTIAL | LOW | Drops everything, hands and armor included. Not done: the critter's art back to the proto FID / `_adjust_ac` when the armor comes off (the art is not verified) |
| _item_identical | `Obj.approxEq` Obj.ts:918, `WeaponObj.approxEq` items.ts:58 | ✅ MATCH | LOW | DH2 compares "has a script" where CE compares sid. Otherwise held/queued, container, inventory, charges and weapon load all match |
| itemGetName / itemGetDescription | `Obj.getName` / `getDescription` Obj.ts | ✅ MATCH | – | |
| itemGetType | `obj.subtype` / `obj_item_subtype` scripting.ts:1934 | ✅ FIXED (2026-10-25) | LOW | CE reports the Shiv (383) as ITEM_TYPE_MISC (concealed weapon); DH2 reports its proto type. ITEM-20 — **Fixed 2026-10-25:** obj_item_subtype and the AI weapon searches (ITEM-20). |
| itemGetMaterial | — | 🚫 N/A | – | Unused in CE |
| itemGetSize | `pro.extra.size` (canCarry) | ✅ MATCH | – | |
| itemGetWeight | `Obj.getWeight` Obj.ts:961 | ⚠️ DIFFERS | HIGH | Formula matches (power armour ÷2, container contents, ammo by the box), but "hidden = 0" reads OBJECT_HIDDEN instead of ITEM_HIDDEN. ITEM-01 |
| itemGetCost | `Obj.getCost` Obj.ts:987 | ✅ MATCH | – | Integer math is the same |
| objectGetCost | `Obj.stackCost` Obj.ts:1008, ui_barter/screen.ts:212 | ✅ MATCH | – | |
| objectGetInventoryWeight | `Obj.getInventoryWeight` Obj.ts:1015 | ✅ MATCH | – | DH2 keeps hand / armor items outside the list and adds them; the totals are the same |
| dudeIsWeaponDisabled | ui_hud.ts:316 | ✅ MATCH | – | |
| itemGetInventoryFid | `Item.init` invArt items.ts:46 | ✅ MATCH | – | |
| critterGetWeaponForHitMode | hand slots + `Weapon.slot()` | ✅ MATCH | – | |
| itemGetActionPointCost | useItemOn.ts:40 `USE_ITEM_AP = 2`; `Weapon.getAttackAPCost` | ✅ MATCH | – | |
| itemGetQuantity | `obj_is_carrying_obj_pid` scripting.ts:1301; inventory amounts | 🟡 PARTIAL | LOW | No recursion into containers (sfall-fixed CE) checked |
| itemIsQueued | timeEventList scan in approxEq Obj.ts:924 | 🟡 PARTIAL | LOW | The barter refusal of queued items (inventory.cc:4735) was not verified |
| itemReplace | — (useItemOn.ts `removeOne`) | ✅ FIXED (2026-10-26) | LOW | After the last unit in a hand is used, CE moves an identical item from the inventory into the hand; DH2 leaves the hand empty — **2026-10-26:** refillHand (bags included). |
| itemIsHidden | object flag 0x01 at Obj.ts:963, combat/results.ts:87, Combat.ts:1320 | ⚠️ DIFFERS | HIGH | ITEM-01 |
| weaponGetAttackTypeForHitMode | Weapon.ts:333, hitChance.ts:125 | ✅ MATCH | – | |
| weaponGetSkillForHitMode | `getWeaponSkillFromPro` Weapon.ts:104 | ✅ FIXED (2026-10-25) | LOW | Big Guns comes from animCode {8,9,10} instead of the ext flag 0x0100 (`weaponFlags & 0x01`). Mode 0 → 'Unarmed' (CE −1). ITEM-05 |
| weaponGetSkillValue | `Critter.getSkill(skillForMode)` | ✅ MATCH | – | |
| weaponGetDamageMinMax | `pro.extra.minDmg/maxDmg` | ✅ MATCH | – | |
| weaponGetDamage | `rollWeaponDamage` Combat.ts:225; unarmed.ts | ✅ MATCH | – | Includes the sfall Bonus HtH Damage fix |
| weaponGetDamageType | `Weapon.getDamageType` Weapon.ts:434 | ✅ MATCH | – | |
| weaponIsTwoHanded | `weaponFlags & 0x02` (several call sites) | ✅ MATCH | – | |
| critterGetAnimationForHitMode / weaponGetAnimationForHitMode | `Weapon.getAttackSkin` Weapon.ts:372; unarmed.ts (kicks) | ✅ MATCH | – | |
| ammoGetCapacity / ammoGetQuantity / ammoSetQuantity | weaponAmmo.ts:43-58 | ✅ MATCH | – | |
| ammoGetCaliber | weapon proto `caliber` (examine.ts:91,111) | ⚠️ DIFFERS | LOW | For a weapon, CE uses the *loaded ammo type's* caliber (0 when ammoTypePid = −1) |
| weaponAttemptReload | weaponAmmo.ts:171; ui.ts:240 | ⚠️ DIFFERS | MED | Solar Scorcher branch missing. ITEM-02 |
| weaponCanBeReloadedWith | weaponAmmo.ts:116 | 🟡 PARTIAL | MED | Caliber / same-type rules match. Missing: the Scorcher ambient > 95 % check and item.msg 500 (the helpers exist but nothing calls them). ITEM-02 |
| weaponReload | weaponAmmo.ts:135 | ✅ MATCH | – | Except the Scorcher refill |
| weaponGetRange | Combat.ts:2121 | ✅ MATCH | – | Throw capped at 3 × ST (Heave Ho!); long limbs handled |
| weaponGetActionPointCost | `Weapon.getAttackAPCost` Weapon.ts:327, `getReloadAPCost` :345, unarmed.ts:164 | ✅ MATCH | – | |
| weaponGetMinStrengthRequired / CriticalFailureType / Perk / BurstRounds / AnimationCode / ProjectilePid / AmmoTypePid / SoundId | proto fields; weaponAmmo.ts:100 | ✅ MATCH | – | Getters, grouped |
| critterCanAim | Weapon.ts:293, cycleMode Fast Shot :249; unarmed.ts:115 | ✅ MATCH | – | |
| weaponCanBeUnloaded / weaponUnload | ui_inventory/panel.ts:481 | ✅ MATCH | – | Repeats one box at a time, as inventory.cc does |
| weaponGetPrimary/SecondaryActionPointCost | `Weapon.getAPCost` Weapon.ts:320 | ✅ MATCH | – | |
| _item_w_compute_ammo_cost | — | ✅ FIXED (2026-10-25) | LOW | The Super Cattle Prod (399) and Mega Power Fist (407) should use 2 charges per hit; DH2 uses 1 (Combat.ts:489/897). ITEM-16 — **Fixed 2026-10-25:** pids 399 / 407 use 2 charges (ITEM-16). |
| weaponIsGrenade / weaponGetDamageRadius / weaponGetGrenadeExplosionRadius / weaponGetRocketExplosionRadius | combat/explosion.ts:28-29, Combat.ts:424-444 | ✅ MATCH | – | |
| weaponGetAmmo{ArmorClass,DamageResistance}Modifier / DamageMultiplier / DamageDivisor; ammoGet* (same four) | combat damage reads the ammo proto `AC modifier / DR modifier / damMult / damDiv` | ✅ MATCH | – | Grouped; the damage formula is audited under combat |
| armorGetArmorClass / DamageResistance / DamageThreshold / Perk / MaleFid / FemaleFid | Critter stats, `armorPerkSwap`, `applyArmorArt` | ✅ MATCH | – | Grouped |
| miscItemGetMaxCharges / GetCharges / SetCharges | `miscCharges` miscItem.ts:108 | ✅ FIXED (2026-10-25) | LOW | No clamp to the max; charges start from the proto on the first turn-on; the map's charges are lost (ITEM-12) |
| miscItemGetPowerType / GetPowerTypePid / IsConsumable | proto_types.ts:149 (fields only) | ✅ FIXED (2026-10-25) | LOW | Only used through itemAttemptAdd (recharging with cells), which is missing (ITEM-19) |
| _item_m_use_charged_item | `useChargedMiscItem` miscItem.ts:127 | 🟡 PARTIAL | MED | Motion Sensor branch missing. ITEM-03 |
| miscItemConsumeCharge / miscItemTrickleEventProcess | `scheduleTrickle` miscItem.ts:85 | ✅ FIXED (2026-10-25) | LOW | ITEM-04 |
| miscItemIsOn | miscItem.ts:62 | ✅ MATCH | – | |
| miscItemTurnOn | miscItem.ts:108 | ✅ FIXED (2026-10-25) | LOW | No immediate charge use, no "not owned" refusal (item.msg 9), no Geiger rad reading (msg 8), no pid I→II swap, English literals. ITEM-04 |
| miscItemTurnOff / _item_m_turn_off_from_queue | miscItem.ts:73; leaveMap :102 | ✅ FIXED (2026-10-25) | LOW | No pid II→I swap (ITEM-04) |
| stealthBoyTurnOn / stealthBoyTurnOff | `refreshStealthState` miscItem.ts:142; render/webglDraw.ts:505 | ✅ MATCH | – | The miscItem.ts header still says "TRANS_GLASS not implemented"; C57 implemented it |
| containerGetMaxSize / containerGetTotalSize | `canCarry` Obj.ts:1034 | ✅ MATCH | – | |
| _insert_drug_effect | drugs.ts:213 | ✅ MATCH | – | Chem Resistant halves the delay |
| _perform_drug_effect | drugs.ts:136 | 🟡 PARTIAL | LOW | DH2 changes base stats instead of CE's bonus layer (documented in code). An HP change doesn't clear the FLEEING flag. NPC death: CE `_combatKillCritterOutsideCombat`, DH2 `critterKill` |
| _drug_effect_allowed | drugs.ts:199 | ✅ MATCH | – | |
| _item_d_take_drug | `useDrug` drugs.ts:316 | ✅ MATCH | – | Jet antidote (sfall fix), withdrawal reset, addiction roll with traits / Flower Child |
| _item_d_clear / drugEffectEventProcess | drugs.ts:205-226 | ✅ MATCH | – | |
| drugEffectEventRead / drugEffectEventWrite / withdrawalEventRead / withdrawalEventWrite | saveload.ts:428; `restoreDrugEvent` drugs.ts:368 | 🚫 N/A | – | JSON save |
| _insert_withdrawal / _item_wd_clear / _item_wd_clear_all / withdrawalEventProcess | drugs.ts:229-305 | ✅ MATCH | – | Only the first match is reset, as CE |
| performWithdrawalStart / performWithdrawalEnd | drugs.ts:252 / :267 | ✅ MATCH | – | |
| drugGetAddictionGvarByPid / dudeSetAddiction / dudeClearAddiction / dudeIsAddicted | drugs.ts:65-107 | ✅ MATCH | – | CE's first-entry quirk is kept |
| itemGetTotalCaps / itemCapsAdjust | scripting.ts:117 / :128 | ✅ MATCH | – | |
| itemGetMoney / itemSetMoney | `Obj.money` Obj.ts:1078 (`amount`) | ✅ MATCH | – | Ground money: the map's charges are lost (ITEM-12) |
| booksInit / booksExit / booksInitVanilla / booksAdd / booksGetInfo | `BOOKS` Obj.ts:198 | ✅ MATCH | – | |
| booksInitCustom | — | ❌ MISSING | LOW | sfall `BooksFile` |
| explosionsInit / explosionsReset / explosionsExit / explosiveAdd / explosiveIsExplosive / explosiveIsActiveExplosive / explosiveActivate / explosiveSetDamage / explosionEmitsLight / weaponSet*ExplosionRadius | `EXPLOSIVES` Obj.ts:133, `isExplosive` Obj.ts:1109 | ✅ MATCH | – | Vanilla constants match (30-50 / 40-80, radius 2/3). The sfall-config overrides are not ported |
| explosiveGetDamage | Obj.ts:140; `explosions_metarule` 6 scripting.ts:2243 | ⚠️ DIFFERS | LOW | DH2 also answers for the armed pids 206/209 (CE: plain pids only) |
| explosionSettingsReset / explosionGet/SetPattern / Get/SetFrm / SetRadius / Get/SetDamageType / Get/SetMaxTargets | scripting.ts:2251 (warns) | ❌ MISSING | LOW | sfall `explosions_metarule` 0-5 / 7+ are unsupported (documented in code) |
| healingItemsInit / healingItemsInitVanilla / healingItemsInitCustom / itemIsHealing | `HEALING_PIDS` Combat.ts:258 | ✅ MATCH | – | sfall tweaks file not supported |

### proto.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| proto_make_path / _proto_list_str / proto_size | `loadPRO` pro.ts:27 (lst lookup) | 🚫 N/A | – | JSON pipeline |
| _proto_action_can_use | `Obj.canUse` Obj.ts:1119 | ✅ FIXED (2026-10-25) | LOW | Items: `weaponFlags & 0x08` (0x0800) + containers matches. Scenery: reads `extra.weaponFlags`, which scenery JSON doesn't have (it stores `extendedFlags`), so the flag is ignored. ITEM-14 — **Fixed 2026-10-25:** scenery reads its own extendedFlags (ITEM-14). |
| _proto_action_can_use_on | `itemCanUseOn` useItemOn.ts:47 | ✅ MATCH | – | |
| _proto_action_can_talk_to | `objActionCanTalkTo` ui_contextmenu.ts:159 | 🟡 PARTIAL | LOW | The ext-flag 0x4000 "talk" on non-critters is ignored |
| _proto_action_can_pickup | — | ✅ FIXED (2026-10-25) | LOW | Ground containers with ext flag 0x8000 (bags) can't be picked up; DH2 always opens them. ITEM-14 — **Fixed 2026-10-25:** Obj.canPickUp (ITEM-14). |
| protoGetMessage / protoGetName / protoGetDescription | `getMessage(cat, textID[+1])` Obj.ts; proto_data 1/2 | ✅ MATCH | LOW | CE's `protoGetName(0x1000000)` returns the dude's own name |
| proto_item_init / proto_item_subdata_init / proto_critter_init / proto_scenery_init / proto_scenery_subdata_init / proto_wall_init / proto_tile_init / proto_misc_init / proto_copy_proto / proto_new / _proto_find_free_subnode / _proto_new_id / proto_max_id | — | 🚫 N/A | – | Mapper / editor defaults |
| proto_is_subtype | `pro.extra.subType` checks | ✅ MATCH | – | |
| objectDataReset / objectCritterCombatDataRead / objectCritterCombatDataWrite / objectDataWrite | `Obj.serialize` Obj.ts:1405 | 🚫 N/A | – | JSON save |
| objectDataRead | tools/fomap.py `parseObject` / `parseItemObj`; `Obj.fromMapObject_` Obj.ts:632 | ⚠️ DIFFERS | HIGH | Lost: `data.flags` (container lock / jam), door `openFlags`, misc `charges`, key `keyCode`; the ladder `destinationMap` lands in `unknown1`. ITEM-12, ITEM-13 |
| _proto_update_gen | `initWeaponAmmo` weaponAmmo.ts:33; misc charges lazily, miscItem.ts:112 | 🟡 PARTIAL | LOW | Weapons are full; door openFlags / ladder map defaults from the proto are not applied |
| _proto_update_init | Critter.fromPID init (HP = max, AP, team, AI) | ✅ MATCH | – | Not re-verified field by field |
| _proto_dude_update_gender | `Player.updateNativeLook` player.ts:99 | ✅ MATCH | – | |
| _proto_dude_init / _ResetPlayer | `Player.resetForNewGame` player.ts:42 | 🟡 PARTIAL | MED | The dude proto's DR EMP = 100 is missing; the player has DR EMP 0 (skills.ts:135). ITEM-18 |
| protoGetDataMember | `proto_data` scripting.ts:1816 | ✅ MATCH | – | Audited earlier (PS1/PS5/S12) |
| protoInit / protoReset / protoExit / _proto_header_load / protoItemDataRead / protoSceneryDataRead / protoRead / protoItemDataWrite / protoSceneryDataWrite / protoWrite / _proto_save_pid / _proto_load_pid / _proto_remove_some_list / _proto_remove_list / _proto_remove_all | tools/proto.py → proto JSON; `globalState.proMap` | 🚫 N/A | – | |
| protoGetProto | `loadPRO` pro.ts:27 | 🚫 N/A | – | |

### proto_instance.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| _obj_sid / _obj_new_sid / _obj_new_sid_inst | `Obj.loadScript` Obj.ts:723 | 🚫 N/A | – | Script instances; scripts.lst index as CE |
| _obj_look_at / _obj_look_at_func | `objLookAt` examine.ts:47 | ✅ MATCH | – | |
| _obj_examine / _obj_examine_func | `objExamine` examine.ts:55 | ✅ MATCH | LOW | Ammo line uses the weapon's caliber (see ammoGetCaliber) |
| _obj_pickup | `Obj.pickup` Obj.ts:1348 | ✅ FIXED (2026-10-25) | LOW | proto.msg 905 replaced by a hard-coded float "You can't carry any more."; money uses `amount` — **Fixed 2026-10-25:** proto.msg 905. |
| _obj_remove_from_inven | slot clearing in `drop` / `invenUnwield` | 🟡 PARTIAL | LOW | Art / interface refresh happen elsewhere |
| _obj_drop | `Obj.drop` Obj.ts:1385; `drop_obj` scripting.ts:2534 | 🟡 PARTIAL | LOW | Script procs match. CE drops **one** item of a stack (`itemRemove(…,1)`); DH2 drops the whole stack (the inventory UI splits it first) |
| _obj_destroy | `GameMap.destroyObject` GameMap.ts:148 | 🟡 PARTIAL | MED | No owner-inventory removal and no `queueRemoveEvents(obj)`. ITEM-15 |
| _obj_use_book | `useBook` Obj.ts:210 | ✅ MATCH | – | No palette fade (cosmetic) |
| _obj_use_flare | `useFlare` Obj.ts:273 | ✅ MATCH | – | Shows 587 where CE shows 588 twice (documented deviation in code) |
| _obj_use_radio | `Obj.use` → `Scripting.use` Obj.ts:1145 | ✅ MATCH | – | DH2 runs use_p_proc first for every item |
| _obj_use_explosive | `useExplosive` Obj.ts:152 | ⚠️ DIFFERS | MED | Timer, Traps roll, Demolition Expert and messages 589/590 match; the armed explosive is not dropped. ITEM-06 |
| _obj_use_power_on_car | — (useItemOn.ts:201 "Not ported") | ❌ MISSING | HIGH | ITEM-07 |
| _obj_use_misc_item | — (use_p_proc via Obj.use) | 🟡 PARTIAL | MED | use_p_proc runs, but the item is not consumed. ITEM-08 |
| _protinst_use_item | `Obj.use` Obj.ts:1139 | 🟡 PARTIAL | LOW | Different order (script first). "That does nothing." (582) not shown for unusable items |
| _protinstTestDroppedExplosive | — | ❌ MISSING | MED | ITEM-06 |
| _obj_use_item | `Obj.use` consumption per branch (drug, book) | ✅ FIXED (2026-10-25) | LOW | rc 2 → drop on the tile missing (ITEM-06); no itemReplace — **Fixed 2026-10-25:** 480 "You see: %s." (ITEM-10). |
| _protinst_default_use_item | `defaultUseItem` useItemOn.ts:181 | 🟡 PARTIAL | HIGH | Drug branch matches (582 / 583-586 / 581). Missing: ammo → car (ITEM-07), flare used on a target (LOW) |
| _protinst_use_item_on | `protinstUseItemOn` useItemOn.ts:146 | ⚠️ DIFFERS | MED | Medical kits match (902, skillUse, 1 in 10 used up, 900/901/910/911). The scripted-item path differs. ITEM-09 |
| _obj_use_item_on | `objUseItemOn` useItemOn.ts:134 | 🟡 PARTIAL | MED | Correct for the player's crosshair; script `use_obj_on_obj` bypasses it. ITEM-09 |
| _check_scenery_ap_cost | — | ❌ MISSING | MED | ITEM-17 |
| _obj_use | `Obj.use` scenery branch Obj.ts:1201 | 🟡 PARTIAL | LOW | Fallback "You see: %s" (480) missing (DH2 plays the scenery animation). ITEM-10 |
| useLadderDown / useLadderUp | Obj.ts:1236 | ⚠️ DIFFERS | HIGH | ITEM-13 |
| useStairs | Obj.ts:1221 | ⚠️ DIFFERS | MED | `destinationMap > 0` test; `builtTile == -1` refusal; rotation. ITEM-13 |
| _set_door_state_open / _set_door_state_closed / _check_door_state | `setObjectOpen` Obj.ts:326 (`obj.open`, animation) | ✅ MATCH | LOW | Light rebuild on the door state (`_obj_rebuild_all_light`) not verified |
| _obj_use_door | `Obj.use` → `toggleObjectOpen` | ✅ FIXED (2026-10-25) | LOW | CE plays the locked sfx and still runs the script, and **doesn't refuse** a locked door itself; DH2 refuses. "Something is blocking" (597) missing. ITEM-10 — **Fixed 2026-10-25:** the lock is left to the script, 597 (ITEM-10). |
| _obj_use_container | `Obj.use` → `setObjectOpen` → `uiLoot` | ✅ FIXED (2026-10-25) | LOW | 485/486 messages missing; locked text hard-coded (487 text) — **Fixed 2026-10-25:** 485 / 486 / 487 from proto.msg (ITEM-10). |
| _obj_use_skill_on | `playerUseSkill` playerUse.ts:107 | ✅ MATCH | – | Jammed → misc.msg 2001, then use_skill_on_p_proc, then skillUse |
| _obj_is_portal / _obj_is_lockable / _obj_is_openable | `isDoor` / `isContainer` Obj.ts:1088-1105 | ✅ MATCH | – | |
| objectIsLocked / objectLock / objectUnlock | `obj_is_locked` / `obj_lock` / `obj_unlock` scripting.ts:1755-1778 | ✅ FIXED (2026-10-25) | LOW | Accepts any object type (CE: items / scenery only); initial lock data lost (ITEM-12) |
| objectIsOpen | `obj_is_open` scripting.ts:1788 | ✅ MATCH | – | |
| objectOpenClose / objectOpen / objectClose | `obj_open` / `obj_close` scripting.ts:1796-1814 | ✅ FIXED (2026-10-25) | LOW | ITEM-11 — **Fixed 2026-10-25:** no animation, unjams (ITEM-11). |
| objectIsJammed / objectJamLock / objectUnjamLock / objectUnjamAll | `jammed`, `jam_lock` scripting.ts:1780, `objectUnjamAll` Obj.ts:373 | ✅ FIXED (2026-10-25) | LOW | `objectUnjamLock` on open/close missing (ITEM-11) — **Fixed 2026-10-25:** obj_open / obj_close unjam (ITEM-11). |
| _obj_attempt_placement | `GameMap.attemptPlacement` GameMap.ts:338 | ✅ MATCH | – | CE's keep-the-last-tile quirk is kept |
| _objPMAttemptPlacement | `GameMap.attemptPartyPlacement` GameMap.ts:374 | ✅ MATCH | – | |

## Detailed findings

### ITEM-01 — Hidden (natural) items: wrong flag, hidden-item helpers missing (HIGH, NEW) — **FIXED 2026-10-24 (PA20)**
- **CE**: `item.cc itemIsHidden` → `proto->item.extendedFlags & ITEM_HIDDEN (0x08000000)`. It is used by `itemGetWeight` (weight 0), `itemMoveAllHidden` (inventory.cc:4127 moves hidden items out of the loot view), `itemDestroyAllHidden` (critter.cc:905 on kill, combat.cc:4858), `_attackFindInvalidFlags` (combat.cc:4170, no DAM_DROP) and `_ai_best_weapon` (combat_ai.cc:1877/1921).
- **DH2**: every one of these checks reads the object flag `OBJECT_HIDDEN` 0x01 (Obj.ts:963, combat/results.ts:87, Combat.ts:1320). The proto byte where tools/proto.py stores ITEM_HIDDEN (`itemFlags & 0x08`) is read only by `proto_data` member 7 (scripting.ts:1849). `itemMoveAllHidden` and `itemDestroyAllHidden` have no counterpart.
- **Impact**: natural weapons (claws, spore spikes, robot and turret guns) count toward weight, can be knocked out of the hand by a critical, are not the AI's preferred weapon, and can be looted from corpses.
- **Fix**: add an `itemIsHidden(obj)` helper that reads `(pro.extra.itemFlags & 0x08) !== 0` and use it at those call sites. Call `itemDestroyAllHidden` in `critterKill`; filter hidden items in `uiLoot` / steal.

### ITEM-02 — Solar Scorcher can't be recharged (MED, NEW) — **FIXED 2026-10-25**
- **CE**: `weaponAttemptReload` for pid 390 skips the ammo search and calls `weaponReload(weapon, NULL)`. `weaponCanBeReloadedWith` passes when `lightGetAmbientIntensity() > 65536 × 0.95`, else prints item.msg 500. `weaponReload` then fills the weapon to capacity.
- **DH2**: `weaponAttemptReload` (weaponAmmo.ts:171) only searches inventory ammo and returns −1. `isSolarScorcher` and `solarScorcherCanRecharge` (weaponAmmo.ts:124/128) are never called. The HUD still offers "reload" (Weapon.ts cycleMode), and `getReloadAPCost` gives 0 AP.
- **Fix**: in `weaponAttemptReload`, if `isSolarScorcher(w)`: when `solarScorcherCanRecharge(GameTime.getAmbientLight())`, set `ammoQuantity = capacity` and return 0; else log item.msg 500 and return −1.

### ITEM-03 — Motion Sensor use missing (MED, NEW) — **FIXED 2026-10-25**
- **CE**: `_item_m_use_charged_item`: for PROTO_ID_MOTION_SENSOR (59), `miscItemConsumeCharge` == 0 → `automapShow(true, true)` (automap with critters shown); otherwise item.msg 5 "%s has no charges left."
- **DH2**: `Obj.use` has no branch for it (`isChargedMiscItem` covers only 52/54/207/210). Using the sensor does nothing; only the encounter Outdoorsman +20 bonus exists (worldmap/encounters.ts:148).
- **Fix**: add the branch; open the automap with the critter-showing mode, if the automap supports one.

### ITEM-04 — Stealth Boy / Geiger details (LOW, NEW) — **FIXED 2026-10-25**
`miscItemTurnOn`:
- CE uses a charge at once and refuses when the item has no owner (item.msg 9).
- CE prints item.msg 6, and for the Geiger counter also msg 8 with the dude's radiation.
- CE swaps the pid I → II, and `miscItemTurnOff` swaps it back, so scripts testing PID 207/210 see the active item.

DH2 (miscItem.ts:108) differs on each point: no charge at turn-on (the total run time is the same, but switching off and on again doesn't use a charge), no message 8 or 9, English literals instead of item.msg, and the pid never changes.
- **Fixed 2026-10-25:** turn-on needs a carrier (item.msg 9) and uses a charge at once (item.msg 5), the pid swaps to the II proto and back (`switchItemProto`), item.msg 6 / 7 and the Geiger's msg 8; the trickle event is typed and rebuilt from a save.

### ITEM-06 — Armed explosive stays carried; no onlooker check (MED, NEW) — **FIXED 2026-10-25**
- **CE**: `_obj_use_explosive` returns 2. `_obj_use_item` then calls `itemRemove` + `itemReplace` and `_obj_connect`s the explosive at the owner's tile, followed by `_protinstTestDroppedExplosive`. That function walks the blast ring (`_compute_explosion_on_extras`); each non-dude, non-team critter that passes a PE `statRoll` ≥ 2 gets who-hit-me = dude, and the first one starts combat if none is running.
- **DH2**: `useExplosive` (Obj.ts:152) keeps the item in the inventory. The comment says "carried, it explodes on whoever carries it", and `explosiveDetonate` handles a carried explosive. There is no watcher check.
- **Impact**: setting a charge in vanilla means placing it at your feet. In DH2 the player must drop it by hand or blow up, and planting explosives near guards never provokes them.
- **Fix**: after the timer is set, move the item from its owner to the owner's tile and port `_protinstTestDroppedExplosive`.

### ITEM-07 — Energy cells don't charge the car (HIGH, NEW) — **FIXED 2026-10-24 (PA20)**
- **CE**: `_protinst_default_use_item`, ITEM_TYPE_AMMO with a target of `PROTO_ID_CAR` / `PROTO_ID_CAR_TRUNK` → `_obj_use_power_on_car`. A Small Energy Cell (38) gives 16000 and a Micro Fusion Cell (39) 40000, scaled by rounds / capacity. This calls `wmCarFillGas`, prints proto.msg 595 "You charge the car with more power" and uses up the cell. With a full tank it prints 596 and keeps the cell (sfall fix).
- **DH2**: useItemOn.ts:201 says it is not ported, so the player gets "That does nothing."
- **Fix**: in `defaultUseItem`, for an ammo pid of 38/39 used on the car scenery pids, add fuel via the Worldmap car API (`setCarFuel`, CAR_FUEL_MAX 80000) and return 1, or −1 with message 596 when full.

### ITEM-08 — Misc "use" items not consumed (MED, NEW, unverified impact) — **FIXED 2026-10-25**
- **CE**: `_obj_use_misc_item` for Ramirez box closed (431), Raiders map (444), Cat's Paw #5 (331), Pip-Boy Lingual Enhancer (499), Survey map (523) and Pip-Boy Medical Enhancer (516) runs use_p_proc when scripted, then returns 1. `_obj_use_item` then destroys the item, script or no script.
- **DH2**: `Obj.use` runs use_p_proc and keeps the item (or plays its animation).
- **Impact**: these items stay in the inventory and can be re-used unless their scripts call `destroy_object` themselves. Whether they do was not checked against the decompiled scripts.

### ITEM-09 — Scripted use-item-on semantics; script use_obj_on_obj skips the engine (MED, NEW) — **FIXED 2026-10-25**
- **CE** `_protinst_use_item_on`, no medical kit:
  - Item has no sid: the target's USE_OBJ_ON proc runs; if it doesn't override, the default (`_protinst_default_use_item`) applies.
  - Item has a sid: the item's proc runs. Its **`scr_return` value** (`script->returnValue`, interpreter_extra.cc:484) decides, not the override flag. Only when it is 0 does the target's proc and then the default run. Otherwise that value is returned, and 1 destroys the item in `_obj_use_item_on`.
- **DH2** `protinstUseItemOn` (useItemOn.ts:157) stops on the item script's `_didOverride` and returns 0. `scr_return` is stored (scripting.ts:2486) but not read here.
- **Script path**: script `use_obj_on_obj` (scripting.ts:1979) only chains the two procs. CE `opUseObjectOnObject` calls `_action_use_an_item_on_object` (critter self) or `_obj_use_item_on`, so a script that feeds a stimpak or uses a kit on someone gets the engine's drug / First Aid / Doctor default and the item is used up. In DH2 nothing happens without script overrides. This extends closed IU1, which wired only the proc chain.
- **Fix**: read `returnValue` for the item path. Route `use_obj_on_obj` through `objUseItemOn(self, target, item)`, with the walk-up when self is a critter.

### ITEM-12 — Map object data lost in the pipeline (HIGH, NEW) — **FIXED 2026-10-24 (PA1)**
- **CE** `objectDataRead` reads, for non-critters:
  - `data.flags` (items: CONTAINER_FLAG_LOCKED 0x02000000 / CONTAINER_FLAG_JAMMED 0x04000000)
  - door `openFlags` (DOOR_FLAG_LOCKED 0x02000000 / DOOR_FLAG_JAMMGED 0x04000000)
  - misc `charges` (which is also the ground money amount, `itemGetMoney`)
  - key `keyCode`
  - weapon / ammo quantities
  - stairs / ladder / elevator destinations

  `objectIsLocked` / `objectIsJammed` read exactly those flags.
- **DH2** `tools/fomap.py`:
  - `numInventory = readU32(f); f.read(4*3)` drops capacity, the pointer **and `data.flags`**.
  - Doors: `f.read(4) # unknown?` drops openFlags.
  - Misc and key: `f.read(4) # unknown?` drops charges and keyCode.

  `Obj.locked` (Obj.ts:533) is only ever set by `obj_lock` / `obj_unlock` (scripting.ts:1769/1777).
- **Impact**: every door or container locked in the map file (rather than by its script) opens freely. Lockpick and Traps checks, and scripts that test `obj_is_locked`, are bypassed. Ground money piles and charged items lose their stored amount.
- **Fix** (pipeline change; CLAUDE.md allows it only when the task is about assets):
  - fomap.py: emit `dataFlags`, `openFlags`, `charges` and `keyCode`.
  - `fromMapObject_`: set `locked = (flags & 0x02000000) !== 0` and `jammed = (flags & 0x04000000) !== 0`.
  - Also take the ground money `amount` and `miscCharges` from `charges`.

### ITEM-13 — Ladder / stairs destinations (HIGH ladders, MED stairs, NEW) — **FIXED 2026-10-24 (PA2)**
- **CE** `useLadderUp` / `useLadderDown`: builtTile −1 means fail. `destinationMap != 0` means a map transition with tile, elevation and rotation, plus `wmMapMarkMapEntranceState`; otherwise the user moves on the same map. `useStairs` is the same except it tests `destinationMap > 0`.
- **DH2**: fomap.py stores the FO2 ladder's first int, `destinationMap`, as `extra.unknown1`. Obj.ts:1244 tests `extra.destinationMap`, which is always undefined, so every ladder is treated as same-map: the player is placed at that tile and elevation of the *current* map. For stairs, Obj.ts:1224 treats only `destinationMap === -1` as same-map, so a 0 value would load map 0, and a stair with destination −1 is not refused. The rotation is ignored.
- **Fix**: in the loader, rename `unknown1` → `destinationMap`; then apply CE's tests (`!= 0` for ladders, `> 0` for stairs, refuse builtTile −1).

### ITEM-15 — Destroying a carried / queued object (MED, NEW; overlaps the interpreter_extra audit) — **FIXED 2026-10-24 (PA9)**
- **CE**: `_obj_destroy` calls `_obj_remove_from_inven(owner)` and `queueRemoveEvents(obj)`. `opDestroyObject` likewise removes a carried item from its owner (`itemRemove` of the whole quantity).
- **DH2**: `GameMap.destroyObject` (GameMap.ts:148) runs destroy_p_proc and queues a *map* removal. For an item in an inventory, `drainRemovalQueue` only warns "object not found on map" and the item stays. Timed events of the object (flare, explosive, script timers) are not removed.
- **Fix**: find the owner (inventory or hand / armor slot) and remove the item from it; drop the object's `timeEventList` entries.

### ITEM-17 — No 3-AP cost for scenery / pickup / container use in combat (MED, NEW) — **FIXED 2026-10-24 (PA18)**
- **CE**: `_check_scenery_ap_cost` is registered by actions.cc for `_action_use_an_object`, `actionPickUp` and loot (actions.cc:1041/1109/1183/1289). In combat, fewer than 3 AP gives proto.msg 700 and refuses; otherwise it subtracts 3 AP.
- **DH2**: no AP is charged for `Obj.use`, `Obj.pickup` or `uiLoot` in combat (playerUse.ts:417, ui_contextmenu.ts:103/113). Only item-on-target use costs 2 AP (useItemOn.ts:76).
- **Fix**: check and spend 3 combat AP in those paths when `inCombat`.

### ITEM-18 — Dude's EMP resistance (MED, NEW) — **FIXED 2026-10-25**
- **CE**: `_proto_dude_init` sets `proto->critter.data.baseStats[STAT_DAMAGE_RESISTANCE_EMP] = 100` (bodyType, XP, killType and damageType 0). The dude is immune to EMP, as biological critter protos are.
- **DH2**: the player's StatSet defaults DR EMP to 0 (skills.ts:135), and `resetForNewGame` doesn't set it.
- **Impact**: EMP grenades or other EMP damage hurt the player.
- **Fix**: set the player's base `DR EMP` to 100 at creation and on reset.

### ITEM-19 — itemAttemptAdd gaps (MED, NEW) — **FIXED 2026-10-25**
DH2 `canCarry` (Obj.ts:1033) differs from CE in three places:
- **Container in a critter**: CE also checks the critter owner's STAT_CARRY_WEIGHT. DH2 checks only the container's size, so putting items into a backpack bypasses the weight limit.
- **Misc item as owner**: CE accepts only that item's `powerTypePid` (recharging) and refuses everything else.
- **Non-biped critter**: CE refuses with −5 unless the critter has CRITTER_BARTER (sfall fix). DH2 lets the player plant items on animals and robots.

### ITEM-05 / 10 / 11 / 14 / 16 / 20 (LOW, NEW) — **FIXED 2026-10-25**
- **ITEM-05**: Big Guns is decided by animCode instead of the 0x0100 ext flag (Weapon.ts:96). This is equivalent unless a proto's animCode and flag disagree, which was not checked.
- **ITEM-10**: some `_obj_use*` messages are missing: 480 "You see", 485/486 container open / search, 597 "something is blocking" when closing a door. A locked door is refused by the engine in DH2; in CE only its script refuses.
- **ITEM-11**: `obj_open` / `obj_close` go through `Obj.use(self,false)`, which plays the self critter's "use" animation and doesn't unjam. CE `objectOpenClose` does no critter animation, unjams the lock, refuses when locked and runs no script.
- **ITEM-14**: `_proto_action_can_pickup` (ext flag 0x8000 containers) is missing. The scenery `_proto_action_can_use` reads the wrong JSON field.
- **ITEM-16**: `_item_w_compute_ammo_cost` is missing: the Super Cattle Prod and Mega Power Fist should use 2 charges per hit.
- **ITEM-20**: Shiv as ITEM_TYPE_MISC (`itemGetType`).
- **Fixed 2026-10-25:** ITEM-05: Big Guns from the 0x0100 flag (the Flame Breath, pid 427, has the big-gun anim code but not the flag, so it is Small Guns as in CE). ITEM-10: proto.msg 480 after a scenery use, 485 / 486 for containers, 487 + the locked sound for a locked container (before its script), 597 when a door closes on something; a locked door plays its locked sound and only its script refuses. ITEM-11: obj_open / obj_close already went through setObjectOpen without an animation; they now unjam too. ITEM-14: `Obj.canPickUp` (bags and backpacks, ext flag 0x8000, are picked up from the ground; other containers open), scenery can-use reads its own `extendedFlags`. ITEM-16 was already in (`Combat.ts`: pids 399 / 407 use 2 charges). ITEM-20: `obj_item_subtype` gives the Shiv ITEM_TYPE_MISC and −1 for a non-item and the AI's weapon searches (`_ai_search_inven_weap`, `_ai_search_environ`) pass it over; an NPC already holding one still stabs (CE: `_ai_pick_hit_mode` punches).

## DH2-only behaviour

- **Order of `Obj.use`**: any item's or scenery's use_p_proc runs first and can override, before the engine handlers (book, flare, explosive, drug). CE reaches the script only through `_obj_use_radio` / `_obj_use_misc_item`, after books and flares.
- **The flare message** is 587 "You light the flare." (CE shows 588 in both branches); this deviation is documented in Obj.ts:269.
- **Medical kit on a non-critter**: `protinstUseItemOn` refuses with 582; CE hands the target to `skillUse`.
- **`[dh2] elevator_use`**: elevator scenery gets a Use action (ui_contextmenu.ts:131, src/elevatorUse.ts); CE has none. This is documented in C66.
- **Ladder climb** plays the climb animation and sfx inside `Obj.use` (Obj.ts:1250); CE does this in actions.cc.
- **`explosiveGetDamage`** also accepts the armed pids (206/209).
- **Drug deltas** are applied to base stats, not to a bonus layer (drugs.ts:108, documented).
- **Pickup refusal** is shown as a floating message over the player, not the proto.msg 905 monitor line.
- **Stale comment**: the miscItem.ts header comment still claims OBJECT_TRANS_GLASS isn't rendered; C57 implemented it.
