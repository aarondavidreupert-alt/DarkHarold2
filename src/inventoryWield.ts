// Putting an item in a hand / on the body from a script.
// CE ref: inventory.cc _invenWieldFunc / _invenUnwieldFunc (opWieldItem, _op_inven_unwield).
//
// DH2 keeps two hand models: the player's equipped items are taken out of the
// inventory list (the inventory screen's slots), an NPC's hands point at items that
// stay in its inventory, marked by the CE hand flags (OBJECT_IN_LEFT_HAND /
// OBJECT_IN_RIGHT_HAND, OBJECT_WORN for armor).

import type { Critter, Obj } from './object.js'
import { refreshStealthState } from './miscItem.js'
import { armorPerkSwap } from './perks/cePerks.js'
import { applyArmorArt } from './ui_inventory/dragdrop.js'
import { drawAC, uiDrawWeapon } from './ui_hud.js'
import { updateHandFlareLight } from './object.js'

const OBJECT_IN_LEFT_HAND = 0x1000000
const OBJECT_IN_RIGHT_HAND = 0x2000000
const OBJECT_IN_ANY_HAND = OBJECT_IN_LEFT_HAND | OBJECT_IN_RIGHT_HAND
const OBJECT_WORN = 0x4000000

type Hand = 'leftHand' | 'rightHand'

function isReal(o: any): o is Obj {
    return !!o && o.pid !== undefined
}

// The hand a script's wield / unwield goes to: the dude's active hand, an NPC's right.
export function scriptHand(c: Critter): Hand {
    return c.isPlayer ? ((c as any).activeHand ?? 'leftHand') : 'rightHand'
}

// CE _invenWieldFunc(critter, item, hand): armor goes on (the old armor stays in the
// inventory), anything else into the hand, the old item back to the inventory. The
// critter's art follows (the weapon drawn when it is the active hand).
export function invenWield(c: Critter, item: Obj, hand: Hand): void {
    const a = c as any
    if (item.subtype === 'armor') {
        const old = c.isPlayer ? a.armor ?? null : c.getEquippedArmor?.() ?? null
        if (c.isPlayer) {
            const i = c.inventory.indexOf(item)
            if (i !== -1) c.inventory.splice(i, 1)
            if (isReal(old)) c.inventory.push(old)
            a.armor = item
            armorPerkSwap(c, old, item)
            applyArmorArt(item)
            drawAC(c.getStat('AC') + ((item as any).pro?.extra?.AC ?? 0))
        } else {
            if (isReal(old)) old.flags = (old.flags ?? 0) & ~OBJECT_WORN
            if (!c.inventory.includes(item)) c.inventory.push(item)
            item.flags = (item.flags ?? 0) | OBJECT_WORN
            a.armor = item
        }
        return
    }

    const old = a[hand]
    if (c.isPlayer) {
        const i = c.inventory.indexOf(item)
        if (i !== -1) c.inventory.splice(i, 1)
        if (isReal(old) && old !== item) c.inventory.push(old)
    } else {
        if (isReal(old)) old.flags = (old.flags ?? 0) & ~OBJECT_IN_ANY_HAND
        if (!c.inventory.includes(item)) c.inventory.push(item)
        item.flags = ((item.flags ?? 0) & ~OBJECT_IN_ANY_HAND) | (hand === 'rightHand' ? OBJECT_IN_RIGHT_HAND : OBJECT_IN_LEFT_HAND)
    }
    a[hand] = item
    if (hand === scriptHand(c)) c.setIdleArt?.()
    refreshStealthState(c) // item.cc stealthBoyTurnOn
    if (c.isPlayer) uiDrawWeapon()
}

// CE _invenUnwieldFunc(critter, hand): the item leaves the hand (an NPC keeps it in
// its inventory, the dude gets it back there); the art drops the weapon.
export function invenUnwield(c: Critter, hand: Hand): void {
    const a = c as any
    const item = a[hand]
    if (!isReal(item)) return
    item.flags = (item.flags ?? 0) & ~OBJECT_IN_ANY_HAND
    if (c.isPlayer) {
        c.inventory.push(item)
        a[hand] = undefined
    } else {
        a[hand] = (c.constructor as any).makeFist?.() ?? undefined
    }
    if (hand === scriptHand(c)) c.setIdleArt?.()
    refreshStealthState(c)
    if (c.isPlayer) uiDrawWeapon()
}

// CE interpreter_extra.cc opMoveObjectInventoryToObject → item.cc itemMoveAll: every
// item goes, worn armor and the hands included. An NPC's right-hand weapon leaves its
// art first (_correctFidForRemovedItem); the dude loses his armor look and the
// interface items refresh.
// CE keeps equipped items in the inventory (flagged OBJECT_IN_*_HAND / OBJECT_WORN), so
// itemRemove finds them; DH2's dude holds them outside the list. Before an item is
// removed by a script (rm_obj_from_inven / rm_mult_objs_from_inven) it leaves the hand
// or body here — back into the inventory list, flags cleared, art and HUD updated
// (_correctFidForRemovedItem / interfaceUpdateItems).
export function unequipForRemoval(c: Critter, item: Obj): void {
    const a = c as any
    for (const hand of ['leftHand', 'rightHand'] as Hand[]) {
        if (a[hand] !== item) continue
        item.flags = (item.flags ?? 0) & ~OBJECT_IN_ANY_HAND
        if (c.isPlayer) {
            if (!c.inventory.includes(item)) c.inventory.push(item)
            a[hand] = undefined
        } else {
            a[hand] = (c.constructor as any).makeFist?.() ?? undefined
        }
        if (hand === scriptHand(c)) c.setIdleArt?.()
        refreshStealthState(c)
        updateHandFlareLight(c)
        if (c.isPlayer) uiDrawWeapon()
    }
    if (a.armor === item) {
        item.flags = (item.flags ?? 0) & ~OBJECT_WORN
        a.armor = null
        if (c.isPlayer) {
            if (!c.inventory.includes(item)) c.inventory.push(item)
            armorPerkSwap(c, item, null)
            applyArmorArt(null)
            drawAC(c.getStat('AC'))
        }
    }
}

export function moveAllInventory(from: Obj, to: Obj): void {
    const a = from as any
    if (from.type === 'critter') {
        const c = from as unknown as Critter
        if (c.isPlayer) {
            for (const hand of ['leftHand', 'rightHand'] as Hand[]) {
                if (isReal(a[hand])) from.inventory.push(a[hand])
                a[hand] = undefined
            }
            const oldArmor = a.armor
            if (isReal(oldArmor)) {
                from.inventory.push(oldArmor)
                a.armor = null
                armorPerkSwap(c, oldArmor, null)
                applyArmorArt(null)
            }
        } else {
            a.leftHand = (c.constructor as any).makeFist?.()
            a.rightHand = (c.constructor as any).makeFist?.()
            a.armor = null
        }
    }
    for (const item of from.inventory) {
        item.flags = (item.flags ?? 0) & ~(OBJECT_IN_ANY_HAND | OBJECT_WORN)
        to.addInventoryItem(item, item.amount ?? 1)
    }
    from.inventory = []
    if (from.type === 'critter') {
        const c = from as unknown as Critter
        c.setIdleArt?.()
        refreshStealthState(c)
        if (c.isPlayer) {
            uiDrawWeapon()
            drawAC(c.getStat('AC'))
        }
    }
}
