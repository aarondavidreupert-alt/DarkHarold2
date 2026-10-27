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
// CE represents on/off state by swapping the item's pid between the "I" (off)
// and "II" (on) proto IDs; DH2 does the same (switchItemProto points the object
// at the other proto, so scripts testing PID 207 / 210 see the active item) and
// keeps miscOn / miscCharges on the Obj instance.
//
// NOT implemented here: CE's OBJECT_TRANS_GLASS semi-transparent sprite
// rendering. That needs a real WebGL shader/alpha change verified in a
// browser — deferred, same as the color-cycling (RD10) work. See
// wiki/items.md LE10.

import { switchItemProto, type Critter, type Obj } from './object.js'
import * as Scripting from './scripting.js'
import { dbg } from './logger.js'
import { uiLog } from './ui_hud.js'
import { getMessage } from './util.js'
import { openAutomap } from './ui_automap.js'

export const PROTO_ID_GEIGER_COUNTER_I = 52
export const PROTO_ID_GEIGER_COUNTER_II = 207
export const PROTO_ID_STEALTH_BOY_I = 54
export const PROTO_ID_STEALTH_BOY_II = 210
export const PROTO_ID_MOTION_SENSOR = 59

const CHARGED_MISC_PIDS: ReadonlySet<number> = new Set([
    PROTO_ID_GEIGER_COUNTER_I,
    PROTO_ID_GEIGER_COUNTER_II,
    PROTO_ID_STEALTH_BOY_I,
    PROTO_ID_STEALTH_BOY_II,
    PROTO_ID_MOTION_SENSOR,
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

// item.msg 5 "%s has no charges left." / 6 "%s is on." / 7 "%s is off."
function logItemMsg(num: number, fallback: string, item: Obj): void {
    uiLog((getMessage('item', num) ?? fallback).replace('%s', item.name || ''))
}

// CE ref: item.cc:2412-2448 miscItemTurnOff() — the pid back to the "I" proto
export function miscItemTurnOff(item: Obj, owner: Critter | null): void {
    if (!miscItemIsOn(item)) return
    item.miscOn = false
    clearTrickleEvent(item)
    switchItemProto(item, isStealthBoy(item) ? PROTO_ID_STEALTH_BOY_I : PROTO_ID_GEIGER_COUNTER_I)

    if (owner) refreshStealthState(owner)
    if (owner?.isPlayer) logItemMsg(7, '%s is off.', item)
    dbg('object', 'miscItem: %s turned off', item.name || item.pid)
}

// CE ref: item.cc:2297-2327 miscItemTrickleEventProcess() — a charge every 600 ticks (one
// in-game minute) for the Stealth Boy, 3000 (five minutes) for the Geiger counter; off when
// none is left. Self-rescheduling; also rebuilt from a save (EVENT_TYPE_ITEM_TRICKLE).
export function scheduleTrickle(item: Obj, owner: Critter | null, ticks = isStealthBoy(item) ? 600 : 3000): void {
    Scripting.timeEventList.push({
        ticks,
        obj: item,
        userdata: 'trickle',
        fn: () => {
            if (miscItemConsumeCharge(item) === 0) {
                scheduleTrickle(item, owner)
            } else {
                if (owner?.isPlayer) logItemMsg(5, '%s has no charges left.', item)
                miscItemTurnOff(item, owner)
            }
        },
        // CE item.cc _item_m_turn_off_from_queue — off when leaving the map
        leaveMap: () => {
            miscItemTurnOff(item, owner)
            return true
        },
    })
}

// CE ref: item.cc:2346-2410 miscItemTurnOn() — only from a carrier (item.msg 9), a charge at
// once (item.msg 5 without one), the pid to the "II" proto; item.msg 6, and for the Geiger
// counter item.msg 8 with the dude's radiation.
export function miscItemTurnOn(item: Obj, owner: Critter | null): void {
    if (miscItemIsOn(item)) return
    if (!owner) {
        uiLog(getMessage('item', 9) ?? 'This item can only be used from the interface bar.')
        return
    }
    if (miscItemConsumeCharge(item) !== 0) {
        if (owner.isPlayer) logItemMsg(5, '%s has no charges left.', item)
        return
    }

    const stealthBoy = isStealthBoy(item)
    item.miscOn = true
    switchItemProto(item, stealthBoy ? PROTO_ID_STEALTH_BOY_II : PROTO_ID_GEIGER_COUNTER_II)
    scheduleTrickle(item, owner)

    refreshStealthState(owner)
    if (owner.isPlayer) {
        logItemMsg(6, '%s is on.', item)
        if (!stealthBoy) {
            const fmt = getMessage('item', 8) ?? 'You pass the Geiger counter over you body. The rem counter reads: %d'
            uiLog(fmt.replace('%d', String(owner.radiationLevel ?? 0)))
        }
    }
    dbg('object', 'miscItem: %s turned on (%d charges)', item.name || item.pid, item.miscCharges ?? 0)
}

// CE item.cc miscItemGetCharges (a missing count is the proto's)
export function miscItemGetCharges(item: Obj): number {
    if (item.miscCharges === undefined) item.miscCharges = item.pro?.extra?.charges ?? 0
    return item.miscCharges ?? 0
}

// CE item.cc miscItemConsumeCharge: 0 when a charge was used, -1 when none was left
export function miscItemConsumeCharge(item: Obj): number {
    const charges = miscItemGetCharges(item)
    if (charges <= 0) return -1
    item.miscCharges = charges - 1
    return 0
}

// "Use" toggle — CE ref: item.cc:2246-2280 _item_m_use_charged_item()
export function useChargedMiscItem(item: Obj, owner: Critter | null): void {
    if (item.pid === PROTO_ID_MOTION_SENSOR) {
        // CE: a charge opens the automap with the scanner on, else item.msg 5
        if (miscItemConsumeCharge(item) === 0) {
            openAutomap(true)
        } else {
            const fmt = getMessage('item', 5) ?? '%s has no charges left.'
            uiLog(fmt.replace('%s', item.name || ''))
        }
        return
    }
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
    const active =
        (isStealthBoy(critter.leftHand) && miscItemIsOn(critter.leftHand!)) ||
        (isStealthBoy(critter.rightHand) && miscItemIsOn(critter.rightHand!))
    critter.stealthActive = active
}
