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

// Per-object weapon ammo state (CE obj->data.item.weapon: ammoQuantity, ammoTypePid).
// Protos are shared between every object of the same pid, so loaded rounds must live
// on the object; the proto only supplies capacity, burst size and the default type.
// The proto field `rounds` is CE's weapon burstRounds, not the loaded ammo.

import type { Obj } from './object.js'

const isWeapon = (w: Obj | null | undefined): w is Obj => !!w && w.subtype === 'weapon' && !!w.pro?.extra

// CE proto.cc:758 _proto_update_init — a new weapon is full, with the proto's ammo type;
// object.cc:455 clamps a negative map value to 0. Map/save values win when present.
export function initWeaponAmmo(w: Obj, quantity?: number, typePid?: number): void {
    if (!isWeapon(w)) return
    const extra = w.pro.extra
    if (w.ammoQuantity === undefined) w.ammoQuantity = quantity ?? extra.maxAmmo ?? 0
    if (w.ammoTypePid === undefined) w.ammoTypePid = typePid ?? extra.ammoPID ?? -1
    if (w.ammoQuantity! < 0) w.ammoQuantity = 0
}

// CE item.cc ammoGetQuantity / ammoSetQuantity (weapon branch).
export function ammoGetQuantity(w: Obj | null | undefined): number {
    return isWeapon(w) ? (w.ammoQuantity ?? 0) : 0
}
export function ammoSetQuantity(w: Obj, quantity: number): void {
    if (!isWeapon(w)) return
    const capacity = ammoGetCapacity(w)
    w.ammoQuantity = Math.max(0, capacity > 0 ? Math.min(quantity, capacity) : quantity)
}

// CE item.cc ammoGetCapacity — proto ammoCapacity.
export function ammoGetCapacity(w: Obj | null | undefined): number {
    return isWeapon(w) ? (w.pro.extra.maxAmmo ?? 0) : 0
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

// CE item.cc weaponReload. DH2 ammo stacks keep their rounds in `amount` (CE keeps
// boxes + rounds-in-top-box); the loaded rounds come off that count. Returns the
// rounds loaded, or -1 if the ammo doesn't fit.
export function weaponReload(w: Obj, ammo: Obj): number {
    if (!weaponCanBeReloadedWith(w, ammo)) return -1
    const quantity = ammoGetQuantity(w)
    const capacity = ammoGetCapacity(w)
    if (quantity >= capacity) return 0
    const available = ammo.amount ?? 1
    const loaded = Math.min(capacity - quantity, available)
    w.ammoTypePid = ammo.pid
    ammo.amount = available - loaded
    ammoSetQuantity(w, quantity + loaded)
    return loaded
}

// First inventory ammo that fits (CE _item_w_try_reload / inventory search).
export function findReloadAmmo(w: Obj, inventory: Obj[]): Obj | null {
    return inventory.find((item) => weaponCanBeReloadedWith(w, item)) ?? null
}
