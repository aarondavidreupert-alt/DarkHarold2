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
import { ANIM, critterWeaponCode, playCharAnimSfx } from './sfxNames.js'
import globalState from './globalState.js'
import { UIMode } from './ui_panels.js'

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
// `animate` (the script opcodes): CE _invenWieldFunc registers animationRegisterTakeOutWeapon
// for the new weapon when the map is showing (!isoIsDisabled) and the hand is the one in use.
// (CE's ANIM_PUT_AWAY of the old weapon first isn't played here: a script's wield changes the
// hand at once; the AI's switch, which waits, uses invenWieldAnimated.)
export function invenWield(c: Critter, item: Obj, hand: Hand, animate = false): void {
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
    const wasDrawn = hand === scriptHand(c) && critterWeaponCode(c) > 0
    a[hand] = item
    if (hand === scriptHand(c)) c.setIdleArt?.()
    refreshStealthState(c) // item.cc stealthBoyTurnOn
    if (c.isPlayer) uiDrawWeapon()
    if (animate && hand === scriptHand(c) && mapShowing() && !c.inAnim() && (wasDrawn || critterWeaponCode(c) > 0)) {
        if (critterWeaponCode(c) > 0 && c.hasAnimation('weapon-draw')) {
            playCharAnimSfx(c, ANIM.takeOut, critterWeaponCode(c))
            c.staticAnimation('weapon-draw', () => c.clearAnim())
        }
    }
}

// CE isoIsDisabled: no window over the map
function mapShowing(): boolean {
    return globalState.uiMode === UIMode.none
}

/** CE _invenWieldFunc(animate) for a turn that waits (the AI's weapon switch): ANIM_PUT_AWAY of
 *  the drawn weapon, the new item in the hand, its take-out (animationRegisterTakeOutWeapon),
 *  then `done`. False — wielded at once, `done` not called — when nothing is animated. */
export function invenWieldAnimated(c: Critter, item: Obj, hand: Hand, done: () => void): boolean {
    if (hand !== scriptHand(c) || !mapShowing() || c.inAnim() || c.dead || item.subtype === 'armor') {
        invenWield(c, item, hand)
        return false
    }
    const takeOut = () => {
        if (critterWeaponCode(c) > 0 && c.hasAnimation('weapon-draw')) {
            playCharAnimSfx(c, ANIM.takeOut, critterWeaponCode(c))
            c.staticAnimation('weapon-draw', () => { c.clearAnim(); done() })
        } else {
            done()
        }
    }
    if (critterWeaponCode(c) > 0 && c.hasAnimation('weapon-holster')) {
        playCharAnimSfx(c, ANIM.putAway)
        c.staticAnimation('weapon-holster', () => { c.clearAnim(); invenWield(c, item, hand); takeOut() })
        return true
    }
    invenWield(c, item, hand)
    if (critterWeaponCode(c) > 0 && c.hasAnimation('weapon-draw')) { takeOut(); return true }
    return false
}

// CE _invenUnwieldFunc(critter, hand): the item leaves the hand (an NPC keeps it in
// its inventory, the dude gets it back there); the art drops the weapon.
// `animate` (inven_unwield): CE _invenUnwieldFunc's ANIM_PUT_AWAY on a live map — the hand is
// empty at once, the put-away plays with the weapon's art (staticAnimation takes it now) and
// the critter stands unarmed after it.
export function invenUnwield(c: Critter, hand: Hand, animate = false): void {
    const a = c as any
    const item = a[hand]
    if (!isReal(item)) return
    const holster = animate && hand === scriptHand(c) && mapShowing() && !c.inAnim() && !c.dead
        && critterWeaponCode(c) > 0 && c.hasAnimation('weapon-holster')
    if (holster) {
        playCharAnimSfx(c, ANIM.putAway)
        c.staticAnimation('weapon-holster', () => c.clearAnim())
    }
    item.flags = (item.flags ?? 0) & ~OBJECT_IN_ANY_HAND
    if (c.isPlayer) {
        c.inventory.push(item)
        a[hand] = undefined
    } else {
        a[hand] = (c.constructor as any).makeFist?.() ?? undefined
    }
    if (hand === scriptHand(c) && !holster) c.setIdleArt?.() // (else clearAnim after the put-away)
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

// What an object carries as CE's inventory list holds it: the dude's hand and armor
// items are appended, since DH2 keeps them outside his list.
export function carriedList(o: Obj): Obj[] {
    const list = o.inventory ?? []
    const a = o as any
    if (!a.isPlayer) return list
    const equipped = [a.leftHand, a.rightHand, a.armor].filter((it: any) => isReal(it) && !list.includes(it))
    return equipped.length ? list.concat(equipped) : list
}

// CE inventory.cc objectGetCarriedQuantityByPid — the quantity of every matching
// stack, bags included.
export function carriedQuantityByPid(o: Obj, pid: number): number {
    let quantity = 0
    for (const item of carriedList(o)) {
        if (item.pid === pid) quantity += item.amount ?? 1
        quantity += carriedQuantityByPid(item, pid)
    }
    return quantity
}

// CE inventory.cc objectGetCarriedObjectByPid — the first match, searching bags.
export function carriedObjectByPid(o: Obj, pid: number): Obj | null {
    for (const item of carriedList(o)) {
        if (item.pid === pid) return item
        const found = carriedObjectByPid(item, pid)
        if (found) return found
    }
    return null
}

// CE item->owner: the object whose list (or equipped slot) holds `item` directly —
// a bag for an item inside one. Searches the given objects and their bags.
export function findItemHolder(item: Obj, roots: Obj[]): Obj | null {
    for (const o of roots) {
        const list = carriedList(o)
        if (list.includes(item)) return o
        const inBag = findItemHolder(item, list)
        if (inBag) return inBag
    }
    return null
}

// CE inventory.cc:5040-5055 inventoryOpenTrade: the barterer's worn armor and right-hand
// item stay out of the trade — and, for a barterer outside the party with an empty right
// hand, its first weapon (_inven_find_type ITEM_TYPE_WEAPON). They are re-added at exit.
export function tradeHeldAside(c: Critter, isPartyMember: boolean): Obj[] {
    const aside: Obj[] = []
    const worn = c.inventory.find((it) => ((it.flags ?? 0) & OBJECT_WORN) !== 0)
    if (worn) aside.push(worn)
    const right = c.inventory.find((it) => ((it.flags ?? 0) & OBJECT_IN_RIGHT_HAND) !== 0)
    if (right) aside.push(right)
    else if (!isPartyMember) {
        const weapon = c.inventory.find((it) => it.subtype === 'weapon' && !aside.includes(it))
        if (weapon) aside.push(weapon)
    }
    return aside
}

// After a trade replaced an NPC's inventory with clones: point the hands at the items
// that now carry the hand flags (a hand item that left goes back to the fist), and clear
// the hand / worn flags of the items the dude received (his slots live outside the list).
export function relinkTradedHands(c: Critter, player: Critter): void {
    const a = c as any
    for (const [hand, flag] of [['leftHand', OBJECT_IN_LEFT_HAND], ['rightHand', OBJECT_IN_RIGHT_HAND]] as [Hand, number][]) {
        const held = c.inventory.find((it) => ((it.flags ?? 0) & flag) !== 0)
        if (held) a[hand] = held
        else if (isReal(a[hand]) && !c.inventory.includes(a[hand])) a[hand] = (c.constructor as any).makeFist?.()
    }
    for (const it of player.inventory) it.flags = (it.flags ?? 0) & ~(OBJECT_IN_ANY_HAND | OBJECT_WORN)
}
