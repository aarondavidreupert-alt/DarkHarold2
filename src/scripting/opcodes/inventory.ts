// Script opcodes: items, caps and inventories: adding, removing, wielding, picking up and dropping (CE op_add_obj_to_inven, op_critter_inven_obj, ...).
// Methods of the Script class (scripting.ts), kept here by topic and installed on its prototype
// there; vmBridge.ts and the Lua prelude call them as before (wiki/code_quality.md Q16).

import type { Script } from '../../scripting.js'
import { Critter, Obj, giveNewUid } from '../../object.js'
import { ammoSplitOff } from '../../weaponAmmo.js'
import { arrayRemove } from '../../util.js'
import {
    carriedObjectByPid,
    carriedQuantityByPid,
    findItemHolder,
    invenUnwield,
    invenWield,
    moveAllInventory,
    scriptHand,
    unequipForRemoval,
} from '../../inventoryWield.js'
import { dbg, dbgWarn } from '../../logger.js'
import { world } from '../../state/world.js'
import { uiDrawWeapon } from '../../hudRefresh.js'
import { allCarriers, info, isGameObject, itemCapsAdjust, itemGetTotalCaps, log, warn } from '../../scripting.js'

export const inventoryOpcodes = {
    // CE interpreter_extra.cc opItemCapsTotal → item.cc itemGetTotalCaps (containers included)
    item_caps_total(this: Script, obj: Obj) {
        if (!isGameObject(obj)) throw new Error('item_caps_total: not game object')
        return itemGetTotalCaps(obj)
    },
    // CE opItemCapsAdjust → item.cc itemCapsAdjust: 0, or −1 when there isn't enough money
    item_caps_adjust(this: Script, obj: Obj, amount: number) {
        if (!isGameObject(obj)) {
            warn('item_caps_adjust: not game object: ' + obj)
            return -1
        }
        // DH2 guard, not CE: an amount that is not a number (bhrnddst's caravan
        // guards pass their rifle object, L7; the VM makes that NaN) changes
        // nothing instead of turning the caps stack into NaN. CE (interpreter.cc
        // opMultiply, interpreter_extra.cc opItemCapsAdjust) multiplies the
        // pointer's bits and adds a garbage amount, which cannot be reproduced.
        if (typeof amount !== 'number' || !Number.isFinite(amount)) {
            warn('item_caps_adjust: amount is not a number: ' + amount)
            return -1
        }
        info('item_caps_adjust: ' + obj.name + ' caps ' + (amount >= 0 ? '+' : '') + amount)
        return itemCapsAdjust(obj, amount)
    },
    move_obj_inven_to_obj(this: Script, obj: Obj, other: Obj) {
        if (obj === null || other === null) {
            warn('move_obj_inven_to_obj: null pointer passed in')
            return
        }

        if (!isGameObject(obj) || !isGameObject(other)) {
            warn('move_obj_inven_to_obj: not game object')
            return
        }

        info('move_obj_inven_to_obj: ' + obj.inventory.length + ' to ' + other.inventory.length, 'inventory')
        moveAllInventory(obj, other) // CE itemMoveAll — armor and hands included
    },
    // CE opObjectIsCarryingObjectWithPid → objectGetCarriedQuantityByPid: the quantity of
    // every matching stack, bags and the dude's equipped items included.
    obj_is_carrying_obj_pid(this: Script, obj: Obj, pid: number) {
        log('obj_is_carrying_obj_pid', [obj, pid])
        if (!isGameObject(obj)) {
            warn('obj_is_carrying_obj_pid: not a game object')
            return 0
        } else if (obj.inventory === undefined) {
            warn('obj_is_carrying_obj_pid: object has no inventory!')
            return 0
        }
        return carriedQuantityByPid(obj, pid)
    },
    // CE opAddMultipleObjectsToInventory (quantity clamped to 1..99999; 0 adds nothing)
    // → item.cc itemAdd, then _obj_disconnect: the object itself becomes the inventory
    // entry and leaves the map. Joining a stack, itemAdd keeps the new object and
    // destroys the old one, so the script's handle stays the carried item.
    add_mult_objs_to_inven(this: Script, obj: Obj, item: Obj, count: number) {
        if (!isGameObject(obj)) {
            warn('add_mult_objs_to_inven: not a game object')
            return
        } else if (!isGameObject(item)) {
            warn('add_mult_objs_to_inven: item not a game object: ' + item)
            return
        } else if (obj.inventory === undefined) {
            warn('add_mult_objs_to_inven: object has no inventory!')
            return
        }
        const quantity = count < 0 ? 1 : Math.min(count, 99999)
        if (quantity < 1) return
        // CE checks item->owner only in the single form; DH2 has no owner pointer, and
        // a carried object listed twice would be two references to one object.
        if (findItemHolder(item, allCarriers())) {
            warn('add_mult_objs_to_inven: item was already attached to something else')
            return
        }
        dbg('inventory', 'add_mult_objs_to_inven: %d counts of %o to %o', quantity, item, obj)
        const a = obj as any
        const i = obj.inventory.findIndex((stack) => stack.approxEq(item))
        const stack = i === -1 ? null : obj.inventory[i]
        if (!stack) {
            item.amount = quantity
            obj.inventory.push(item)
        } else if (item.subtype === 'ammo' || stack === a.leftHand || stack === a.rightHand || stack === a.armor) {
            obj.addInventoryItem(item, quantity) // ammo boxes combine; an equipped stack stays
        } else {
            item.amount = stack.amount + quantity
            obj.inventory[i] = item
        }
        if (world.gMap?.objects?.some((level: Obj[]) => level.includes(item))) world.gMap.removeObject(item)
    },
    // CE opRemoveMultipleObjectsFromInventory: itemRemove(owner, item, min(quantity
    // held, count)) — that object, equipped or not — and returns the quantity removed.
    rm_mult_objs_from_inven(this: Script, obj: Obj, item: Obj, count: number): number {
        if (!isGameObject(obj) || !isGameObject(item) || obj.inventory === undefined) {
            warn('rm_mult_objs_from_inven: not a game object / no inventory')
            return 0
        }
        dbg('inventory', 'rm_mult_objs_from_inven: %d counts of %o from %o', count, item, obj)
        if (obj.type === 'critter') unequipForRemoval(obj as Critter, item)
        // CE item.cc itemRemove: the owner's list, then — recursively — every bag in it
        const findIn = (list: Obj[]): { list: Obj[]; i: number } | null => {
            let i = list.indexOf(item)
            if (i === -1) i = list.findIndex((it) => it.approxEq(item))
            if (i !== -1) return { list, i }
            for (const it of list) {
                if (it.subtype === 'container' && it.inventory?.length) {
                    const found = findIn(it.inventory)
                    if (found) return found
                }
            }
            return null
        }
        const found = findIn(obj.inventory)
        if (!found) {
            warn('rm_mult_objs_from_inven: item not found in inventory')
            return 0
        }
        const i = found.i
        const stack = found.list[i]
        const quantity = Math.min(stack.amount, count)
        if (quantity <= 0) return 0
        stack.amount -= quantity
        if (stack.amount <= 0) {
            found.list.splice(i, 1)
            stack.amount = quantity // the removed object carries the quantity on (_obj_connect)
        } else {
            ammoSplitOff(stack, stack.clone()) // the boxes left are full
        }
        return quantity
    },
    add_obj_to_inven(this: Script, obj: Obj, item: Obj) {
        this.add_mult_objs_to_inven(obj, item, 1)
    },
    rm_obj_from_inven(this: Script, obj: Obj, item: Obj) {
        this.rm_mult_objs_from_inven(obj, item, 1)
    },
    // CE opObjectCarryingObjectByPid → objectGetCarriedObjectByPid (bags searched).
    obj_carrying_pid_obj(this: Script, obj: Obj, pid: number) {
        log('obj_carrying_pid_obj', [obj, pid])
        if (!isGameObject(obj)) {
            warn('obj_carrying_pid_obj: not a game object: ' + obj)
            return 0
        }
        return carriedObjectByPid(obj, pid) ?? 0
    },
    // CE opCritterGetInventoryObject: for the dude a hand counts only while it is the
    // active one (interfaceGetCurrentHand); a non-critter gives 0.
    critter_inven_obj(this: Script, obj: Critter, where: number) {
        if (!isGameObject(obj) || obj.type !== 'critter') {
            warn('critter_inven_obj: not a critter')
            return 0
        }
        const real = (h: any) => (h && h.pid !== undefined ? h : null)
        const active = obj.isPlayer ? (obj.activeHand ?? 'leftHand') : null
        if (where === 0)
            return (obj as Critter).getEquippedArmor() ?? null // INVEN_TYPE_WORN
        else if (where === 1)
            return active && active === 'leftHand' ? null : real(obj.rightHand) // INVEN_TYPE_RIGHT_HAND
        else if (where === 2)
            return active && active !== 'leftHand' ? null : real(obj.leftHand) // INVEN_TYPE_LEFT_HAND
        else if (where === -2) {
            // INVEN_TYPE_INV_COUNT — CE ref: inventory.cc critter_inven_obj() returns inventory.length
            return (obj as Critter).inventory.length
        }
        warn('critter_inven_obj: unknown where=' + where)
        return null
    },
    inven_cmds(this: Script, obj: Critter, invenCmd: number, itemIndex: number): Obj | null {
        // CE ref: interpreter_extra.cc:3088 _op_inven_cmds
        // Only cmd=13 exists in CE: _inven_index_ptr(obj, index) → inventory[index]
        if (invenCmd !== 13) {
            dbgWarn('script', `inven_cmds: unhandled cmd ${invenCmd}`)
            return null
        }
        if (!isGameObject(obj) || !obj.inventory) return null
        if (itemIndex < 0 || itemIndex >= obj.inventory.length) return null
        return obj.inventory[itemIndex]
    },
    wield_obj_critter(this: Script, obj: Obj, item: Obj) {
        if (!isGameObject(obj) || obj.type !== 'critter') {
            warn('wield_obj_critter: not a critter: ' + obj)
            return
        }
        if (!isGameObject(item)) {
            warn('wield_obj_critter: item not a game object: ' + item)
            return
        }
        info('wield_obj_critter: ' + obj.name + ' wields ' + (item.name ?? item.pid))
        // CE opWieldItem → inventory.cc _invenWieldFunc: the dude's active hand (an
        // NPC's right), armor on the body; the old item back to the inventory.
        invenWield(obj as Critter, item, scriptHand(obj as Critter), true)
    },
    // CE _op_inven_unwield (0x812C) — self puts its weapon away (dude: current hand).
    // CE _op_inven_unwield → _invenUnwieldFunc(self, the dude's active hand / an NPC's right)
    inven_unwield(this: Script) {
        const self = this.self_obj as Critter
        if (!self || self.type !== 'critter') return
        invenUnwield(self, scriptHand(self), true)
    },
    // CE opPickup (0x80D6) — actionPickUp(script->target, obj)
    pickup_obj(this: Script, obj: Obj) {
        if (!isGameObject(obj)) return
        // sfall set_self: this one call runs as that object (CE opPickup)
        const who = (this.overriddenSelf ?? this.target_obj ?? this.self_obj) as Critter
        this.overriddenSelf = null
        if (!who || who.type !== 'critter') return
        obj.pickup?.(who)
    },
    // CE opDrop (0x80D7) — _obj_drop(script->target, obj)
    drop_obj(this: Script, obj: Obj) {
        if (!isGameObject(obj)) return
        const who = (this.target_obj ?? this.self_obj) as Critter
        if (!who) return
        // CE _obj_drop → _obj_remove_from_inven → itemRemove(owner, item, 1): one item of
        // a stack goes; the handle is the dropped one and a copy keeps the rest (an ammo
        // stack's rest is full boxes)
        const i = who.inventory?.indexOf(obj) ?? -1
        if (i !== -1 && obj.amount > 1) {
            const rest = giveNewUid(obj.clone())
            rest.amount = obj.amount - 1
            obj.amount = 1
            ammoSplitOff(rest, obj)
            who.inventory[i] = rest
            if (!obj.drop?.(who)) {
                // a script kept it
                who.inventory[i] = obj
                obj.amount = rest.amount + 1
            }
            return
        }
        obj.drop?.(who)
    },
    // CE opDestroyMultipleObjects (0x8144) — remove `quantity` of an item from its
    // owner (returns how many), or destroy the object outright when it has no owner.
    destroy_mult_objs(this: Script, obj: Obj, quantity: number) {
        if (!isGameObject(obj)) return 0
        const owner = findItemHolder(obj, allCarriers())
        if (owner) {
            if (owner.type === 'critter') unequipForRemoval(owner as Critter, obj)
            const have = obj.amount ?? 1
            const n = Math.min(have, quantity)
            if (n >= have) arrayRemove(owner.inventory, obj)
            else {
                obj.amount = have - n
                ammoSplitOff(obj, obj.clone())
            } // the boxes left are full
            if (owner === world.player) uiDrawWeapon()
            return n
        }
        world.gMap!.destroyObject(obj)
        return 0
    },
}
