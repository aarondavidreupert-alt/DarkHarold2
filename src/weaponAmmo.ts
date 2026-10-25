/*
Copyright 2026 DarkHarold2 contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

// Per-object ammo state, as CE keeps it on the object:
// - a weapon: obj->data.item.weapon.ammoQuantity / ammoTypePid (rounds loaded, type);
// - an ammo stack: `amount` is the number of boxes (CE inventory quantity) and
//   `ammoQuantity` the rounds left in the top box (obj->data.item.ammo.quantity); every
//   other box of the stack is full.
// Protos are shared between every object of the same pid, so this lives on the object;
// the proto supplies capacities, burst size and the default type. (The weapon proto
// field `rounds` is CE's burstRounds, not the loaded ammo.)

import type { Obj } from './object.js'
import { getAmbientLight } from './gametime.js'
import { uiLog } from './ui_hud.js'
import { getMessage } from './util.js'

const isWeapon = (w: Obj | null | undefined): w is Obj => !!w && w.subtype === 'weapon' && !!w.pro?.extra
const isAmmo = (a: Obj | null | undefined): boolean => !!a && a.subtype === 'ammo' && !!a.pro?.extra

// CE proto.cc:758 _proto_update_init — a new weapon is full, with the proto's ammo type;
// object.cc:455 clamps a negative map value to 0. Map/save values win when present.
export function initWeaponAmmo(w: Obj, quantity?: number, typePid?: number): void {
    if (!isWeapon(w)) return
    const extra = w.pro.extra
    if (w.ammoQuantity === undefined) w.ammoQuantity = quantity ?? extra.maxAmmo ?? 0
    if (w.ammoTypePid === undefined) w.ammoTypePid = typePid ?? extra.ammoPID ?? -1
    if (w.ammoQuantity! < 0) w.ammoQuantity = 0
}

// CE item.cc ammoGetQuantity / ammoSetQuantity — a weapon's loaded rounds, or the
// rounds in an ammo stack's top box (a full box when not set).
export function ammoGetQuantity(w: Obj | null | undefined): number {
    if (isWeapon(w)) return w.ammoQuantity ?? 0
    if (isAmmo(w)) return (w as Obj).ammoQuantity ?? ammoGetCapacity(w)
    return 0
}
export function ammoSetQuantity(w: Obj, quantity: number): void {
    if (!isWeapon(w) && !isAmmo(w)) return
    const capacity = ammoGetCapacity(w)
    w.ammoQuantity = Math.max(0, capacity > 0 ? Math.min(quantity, capacity) : quantity)
}

// CE item.cc ammoGetCapacity — a weapon's ammoCapacity, an ammo box's quantity.
export function ammoGetCapacity(w: Obj | null | undefined): number {
    if (isWeapon(w)) return w.pro.extra.maxAmmo ?? 0
    if (isAmmo(w)) return Math.max(1, (w as Obj).pro.extra.quantity ?? 1)
    return 0
}

// All rounds in an ammo stack: full boxes plus the top box.
export function ammoStackRounds(a: Obj): number {
    if (!isAmmo(a)) return 0
    return Math.max(0, (a.amount ?? 1) - 1) * ammoGetCapacity(a) + ammoGetQuantity(a)
}

// CE item.cc itemAdd (ammo): `count` boxes whose top box holds `topRounds` join `stack`;
// the two top boxes combine, spilling into one more full box when they overflow.
export function ammoMergeInto(stack: Obj, count: number, topRounds: number): void {
    const capacity = ammoGetCapacity(stack)
    const sum = ammoGetQuantity(stack) + topRounds
    if (sum > capacity) {
        stack.ammoQuantity = sum - capacity
        stack.amount = (stack.amount ?? 1) + count
    } else {
        stack.ammoQuantity = sum
        stack.amount = (stack.amount ?? 1) + count - 1
    }
}

// CE item.cc itemRemove (ammo): boxes split off a stack take its top box with them; the
// boxes left behind are all full.
export function ammoSplitOff(source: Obj, moved: Obj): void {
    if (!isAmmo(source)) return
    moved.ammoQuantity = ammoGetQuantity(source)
    source.ammoQuantity = ammoGetCapacity(source)
}

// Old saves kept an ammo stack's rounds in `amount`; turn them into boxes + top box.
export function ammoFromRounds(a: Obj, rounds: number): void {
    if (!isAmmo(a)) return
    const capacity = ammoGetCapacity(a)
    const boxes = Math.max(1, Math.ceil(rounds / capacity))
    a.amount = boxes
    a.ammoQuantity = Math.max(0, rounds - (boxes - 1) * capacity)
}

// CE item.cc weaponGetAmmoTypePid / weaponSetAmmoTypePid.
export function weaponGetAmmoTypePid(w: Obj | null | undefined): number {
    return isWeapon(w) ? (w.ammoTypePid ?? -1) : -1
}
export function weaponSetAmmoTypePid(w: Obj, pid: number): void {
    if (isWeapon(w)) w.ammoTypePid = pid
}

// CE item.cc weaponGetBurstRounds — proto burstRounds (proto.py names it `rounds`).
export function weaponGetBurstRounds(w: Obj | null | undefined): number {
    return isWeapon(w) ? (w.pro.extra.rounds ?? 0) : 0
}

const PROTO_ID_SOLAR_SCORCHER = 390
const LIGHT_INTENSITY_MAX = 65536

// CE item.cc weaponCanBeReloadedWith — same caliber, and a non-empty weapon only takes
// more of the ammo type already loaded. (Solar Scorcher's ambient-light recharge is
// handled by the caller, which owns the message.)
export function weaponCanBeReloadedWith(w: Obj, ammo: Obj | null | undefined): boolean {
    if (!isWeapon(w) || !ammo || ammo.subtype !== 'ammo' || !ammo.pro?.extra) return false
    if ((w.pro.extra.caliber ?? -1) !== (ammo.pro.extra.caliber ?? -2)) return false
    if (ammoGetQuantity(w) !== 0 && weaponGetAmmoTypePid(w) !== ammo.pid) return false
    return true
}

export function isSolarScorcher(w: Obj | null | undefined): boolean {
    return !!w && w.pid === PROTO_ID_SOLAR_SCORCHER
}
// CE item.cc weaponCanBeReloadedWith — the Scorcher recharges above 95% ambient light.
export function solarScorcherCanRecharge(ambient: number): boolean {
    return ambient > LIGHT_INTENSITY_MAX * 0.95
}

// CE item.cc weaponReload — loads from the stack's top box only. Returns the rounds left
// in that box (0: it is used up — the caller removes it with ammoUseTopBox), or -1 if
// the ammo doesn't fit.
export function weaponReload(w: Obj, ammo: Obj): number {
    if (!weaponCanBeReloadedWith(w, ammo)) return -1
    const quantity = ammoGetQuantity(w)
    const capacity = ammoGetCapacity(w)
    const top = ammoGetQuantity(ammo)
    let left = top
    if (quantity < capacity) {
        let loaded: number
        if (quantity + top > capacity) {
            left = top - (capacity - quantity)
            loaded = capacity
        } else {
            left = 0
            loaded = quantity + top
        }
        w.ammoTypePid = ammo.pid
        ammoSetQuantity(ammo, left)
        ammoSetQuantity(w, loaded)
    }
    return left
}

// CE _obj_destroy(ammo) after a reload emptied the top box (itemRemove(…, 1)): one box
// less, the next one full; the stack goes when it was the last.
export function ammoUseTopBox(ammo: Obj, inventory: Obj[]): void {
    if ((ammo.amount ?? 1) > 1) {
        ammo.amount -= 1
        ammo.ammoQuantity = ammoGetCapacity(ammo)
    } else {
        const i = inventory.indexOf(ammo)
        if (i !== -1) inventory.splice(i, 1)
    }
}

// CE item.cc weaponAttemptReload — one box of the loaded ammo type first, else of any
// type that fits. Returns -1 when the weapon is full or there is nothing to load.
export function weaponAttemptReload(w: Obj, inventory: Obj[]): number {
    if (ammoGetQuantity(w) >= ammoGetCapacity(w)) return -1
    // CE: the Solar Scorcher skips the ammo search; weaponReload(weapon, NULL) fills it
    // to capacity above 95% ambient light, else item.msg 500.
    if (isSolarScorcher(w)) {
        if (!solarScorcherCanRecharge(getAmbientLight())) {
            uiLog(getMessage('item', 500) ?? 'There is not enough light to recharge this item.')
            return -1
        }
        ammoSetQuantity(w, ammoGetCapacity(w))
        return 0
    }
    const ammo = inventory.find((a) => a.subtype === 'ammo' && a.pid === weaponGetAmmoTypePid(w) && weaponCanBeReloadedWith(w, a))
        ?? inventory.find((a) => weaponCanBeReloadedWith(w, a))
    if (!ammo) return -1
    const rc = weaponReload(w, ammo)
    if (rc === 0) ammoUseTopBox(ammo, inventory)
    return rc === -1 ? -1 : 0
}

// First inventory ammo that fits (CE _item_w_try_reload / inventory search).
export function findReloadAmmo(w: Obj, inventory: Obj[]): Obj | null {
    return inventory.find((item) => weaponCanBeReloadedWith(w, item)) ?? null
}
