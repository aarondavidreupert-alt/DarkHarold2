/*
Copyright 2026

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

// Stealth Boy / Geiger Counter charge-toggle system — misc items with a
// finite charge count that drains over time while active. CE ref:
// item.cc miscItemTurnOn()/miscItemTurnOff()/miscItemTrickleEventProcess()
// (item.cc:2246-2449). LE10.
//
// CE represents on/off state by literally swapping the item's own pid
// between the "I" (off) and "II" (on) proto IDs. DH2 instead tracks the
// same on/off + remaining-charge state directly on the Obj instance
// (miscOn/miscCharges) — functionally identical, but avoids mutating the
// shared, cached Proto object `Obj.pro` points to (proto instances are
// shared across every object with the same pid via proMap/loadPRO — see
// the "XXX: if pro changes in the future, this should be cloned" note at
// Obj.ts's serialize()).
//
// NOT implemented here: CE's OBJECT_TRANS_GLASS semi-transparent sprite
// rendering. That needs a real WebGL shader/alpha change verified in a
// browser — deferred, same as the color-cycling (RD10) work. See
// wiki/items.md LE10.

import type { Critter, Obj } from './object.js'
import { Scripting } from './scripting.js'
import { dbg } from './logger.js'
import { uiLog } from './ui_hud.js'

export const PROTO_ID_GEIGER_COUNTER_I = 52
export const PROTO_ID_GEIGER_COUNTER_II = 207
export const PROTO_ID_STEALTH_BOY_I = 54
export const PROTO_ID_STEALTH_BOY_II = 210

const CHARGED_MISC_PIDS: ReadonlySet<number> = new Set([
    PROTO_ID_GEIGER_COUNTER_I,
    PROTO_ID_GEIGER_COUNTER_II,
    PROTO_ID_STEALTH_BOY_I,
    PROTO_ID_STEALTH_BOY_II,
])

export function isChargedMiscItem(item: Obj): boolean {
    return CHARGED_MISC_PIDS.has(item.pid)
}

function isStealthBoy(item: Obj | null | undefined): boolean {
    return item?.pid === PROTO_ID_STEALTH_BOY_I || item?.pid === PROTO_ID_STEALTH_BOY_II
}

// CE ref: item.cc:2329-2341 miscItemIsOn() — true while a trickle event is queued.
export function miscItemIsOn(item: Obj): boolean {
    return item.miscOn === true
}

function clearTrickleEvent(item: Obj): void {
    const idx = Scripting.timeEventList.findIndex((e) => e.obj === item)
    if (idx !== -1) Scripting.timeEventList.splice(idx, 1)
}

// CE ref: item.cc:2412-2448 miscItemTurnOff()
export function miscItemTurnOff(item: Obj, owner: Critter | null): void {
    if (!miscItemIsOn(item)) return
    item.miscOn = false
    clearTrickleEvent(item)

    if (owner) refreshStealthState(owner)
    if (owner?.isPlayer) uiLog(`${item.name || 'It'} is off.`)
    dbg('object', 'miscItem: %s turned off', item.name || item.pid)
}

// CE ref: item.cc:2297-2327 miscItemTrickleEventProcess() — 600 ticks (one
// in-game minute) per charge for Stealth Boy/Geiger Counter, self-rescheduling.
function scheduleTrickle(item: Obj, owner: Critter | null): void {
    Scripting.timeEventList.push({
        ticks: 600,
        obj: item,
        userdata: null,
        fn: () => {
            const charges = (item.miscCharges ?? 0) - 1
            item.miscCharges = charges
            if (charges <= 0) {
                if (owner?.isPlayer) uiLog(`${item.name || 'It'} has no charges left.`)
                miscItemTurnOff(item, owner)
            } else {
                scheduleTrickle(item, owner)
            }
        },
    })
}

// CE ref: item.cc:2346-2410 miscItemTurnOn()
export function miscItemTurnOn(item: Obj, owner: Critter | null): void {
    if (miscItemIsOn(item)) return

    if (item.miscCharges === undefined) {
        item.miscCharges = (item.pro?.extra as any)?.charges ?? 0
    }
    if ((item.miscCharges ?? 0) <= 0) {
        if (owner?.isPlayer) uiLog(`${item.name || 'It'} has no charges left.`)
        return
    }

    item.miscOn = true
    scheduleTrickle(item, owner)

    if (owner) refreshStealthState(owner)
    if (owner?.isPlayer) uiLog(`${item.name || 'It'} is on.`)
    dbg('object', 'miscItem: %s turned on (%d charges)', item.name || item.pid, item.miscCharges ?? 0)
}

// "Use" toggle — CE ref: item.cc:2246-2280 _item_m_use_charged_item()
export function useChargedMiscItem(item: Obj, owner: Critter | null): void {
    if (miscItemIsOn(item)) {
        miscItemTurnOff(item, owner)
    } else {
        miscItemTurnOn(item, owner)
    }
}

// CE ref: item.cc:2460-2499 stealthBoyTurnOn()/stealthBoyTurnOff() — CE ties
// OBJECT_TRANS_GLASS to whichever hand(s) hold an active Stealth Boy II, with
// a guard so turning one off doesn't clear the flag while the other hand
// still holds an active one. DH2 recomputes the same result from both hand
// slots directly instead of tracking separate turn-on/turn-off calls per
// hand — call this any time a hand slot's contents change (equip/unequip/
// swap/drop) or a held item's on/off state changes.
export function refreshStealthState(critter: Critter): void {
    const active = (isStealthBoy(critter.leftHand) && miscItemIsOn(critter.leftHand!))
        || (isStealthBoy(critter.rightHand) && miscItemIsOn(critter.rightHand!))
    critter.stealthActive = active
}
