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

// A critter's combat results (CE critter->data.critter.combat.results, the DAM_*
// bits of obj_types.h). DH2 keeps them in Critter.injuryFlags; the cripple / blind
// booleans on Critter read and write the same bits.

import globalState from '../globalState.js'
import { Scripting } from '../scripting.js'
import { randomBetween } from '../random.js'
import type { Critter } from '../object/Critter.js'
import type { Obj } from '../object/Obj.js'

export const DAM_KNOCKED_OUT = 0x01
export const DAM_KNOCKED_DOWN = 0x02
export const DAM_CRIP_LEG_LEFT = 0x04
export const DAM_CRIP_LEG_RIGHT = 0x08
export const DAM_CRIP_ARM_LEFT = 0x10
export const DAM_CRIP_ARM_RIGHT = 0x20
export const DAM_BLIND = 0x40
export const DAM_DEAD = 0x80
export const DAM_HIT = 0x100
export const DAM_CRITICAL = 0x200
export const DAM_ON_FIRE = 0x400
export const DAM_BYPASS = 0x800
export const DAM_EXPLODE = 0x1000
export const DAM_DESTROY = 0x2000
export const DAM_DROP = 0x4000
export const DAM_LOSE_TURN = 0x8000
export const DAM_HIT_SELF = 0x10000
export const DAM_LOSE_AMMO = 0x20000
export const DAM_DUD = 0x40000
export const DAM_HURT_SELF = 0x80000
export const DAM_RANDOM_HIT = 0x100000
export const DAM_CRIP_RANDOM = 0x200000
export const DAM_BACKWASH = 0x400000
export const DAM_PERFORM_REVERSE = 0x800000
export const DAM_CRIP_LEG_ANY = DAM_CRIP_LEG_LEFT | DAM_CRIP_LEG_RIGHT
export const DAM_CRIP_ARM_ANY = DAM_CRIP_ARM_LEFT | DAM_CRIP_ARM_RIGHT
export const DAM_CRIP = DAM_CRIP_LEG_ANY | DAM_CRIP_ARM_ANY | DAM_BLIND

const CRITTER_NO_DROP = 0x40       // proto critter flags (proto_types.h)
const CRITTER_INVULNERABLE = 0x400
const OBJECT_HIDDEN = 0x01

export function results(c: Critter): number {
    return c.injuryFlags ?? 0
}

function protoFlags(c: Critter): number {
    return ((c.pro as any)?.extra?.flags ?? 0) >>> 0
}

// CE critter.cc _critter_is_prone: knocked out or down.
export function critterIsProne(c: Critter): boolean {
    return (results(c) & (DAM_KNOCKED_OUT | DAM_KNOCKED_DOWN)) !== 0
}

// CE combat.cc _do_random_cripple: DAM_CRIP_RANDOM becomes one random limb.
export function doRandomCripple(flags: number): number {
    flags &= ~DAM_CRIP_RANDOM
    switch (randomBetween(0, 3)) {
        case 0: return flags | DAM_CRIP_LEG_LEFT
        case 1: return flags | DAM_CRIP_LEG_RIGHT
        case 2: return flags | DAM_CRIP_ARM_LEFT
        default: return flags | DAM_CRIP_ARM_RIGHT
    }
}

// CE combat.cc _attackFindInvalidFlags: no DAM_DROP for CRITTER_NO_DROP critters or a
// hidden item (natural weapons).
export function attackFindInvalidFlags(critter: Critter | null, item: Obj | null): number {
    let flags = 0
    if (critter && (protoFlags(critter) & CRITTER_NO_DROP) !== 0) flags |= DAM_DROP
    if (item && (((item as any).flags ?? 0) & OBJECT_HIDDEN) !== 0) flags |= DAM_DROP
    return flags
}

// CE combat.cc _set_new_results: a knockout queues the wake-up event
// (10 × (35 − 3 × END) ticks, sfall: one event at a time); the lasting bits are kept.
export function setNewResults(c: Critter, flags: number): void {
    if (c.type !== 'critter' || (protoFlags(c) & CRITTER_INVULNERABLE) !== 0) return
    if ((flags & DAM_DEAD) !== 0) {
        removeKnockoutEvents(c)
    } else if ((flags & DAM_KNOCKED_OUT) !== 0) {
        removeKnockoutEvents(c)
        const ticks = 10 * (35 - 3 * c.getStat('END'))
        Scripting.timeEventList.push({ obj: c, ticks, userdata: 'knockout', fn: () => knockoutEventProcess(c) })
    }
    c.injuryFlags = (results(c) | (flags & (DAM_KNOCKED_OUT | DAM_KNOCKED_DOWN | DAM_CRIP | DAM_DEAD | DAM_LOSE_TURN))) >>> 0
}

export function removeKnockoutEvents(c: Critter): void {
    const list = Scripting.timeEventList
    for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].obj === c && list[i].userdata === 'knockout') list.splice(i, 1)
    }
}

// CE critter.cc knockoutEventProcess: the critter comes to and lies knocked down; in
// combat it stands up at the start of its next turn, otherwise at once.
export function knockoutEventProcess(c: Critter): void {
    if ((results(c) & DAM_DEAD) !== 0 || c.dead) return
    c.injuryFlags = ((results(c) & ~(DAM_KNOCKED_OUT | DAM_KNOCKED_DOWN)) | DAM_KNOCKED_DOWN) >>> 0
    if (!globalState.inCombat) dudeStandup(c)
}

// CE animation.cc _dude_standup: ANIM_BACK_TO_STANDING ('getUpFront', cj) after
// ANIM_FALL_BACK ('knockdownFront', ba), ANIM_PRONE_TO_STANDING ('getUpBack', ch)
// otherwise; DAM_KNOCKED_DOWN is cleared.
export function dudeStandup(c: Critter, then?: () => void): void {
    c.injuryFlags = (results(c) & ~DAM_KNOCKED_DOWN) >>> 0
    const getUp = c.knockdownAnim === 'knockdownBack' ? 'getUpBack' : 'getUpFront'
    c.knockdownAnim = null
    if (c.hasAnimation(getUp)) {
        c.staticAnimation(getUp, () => { c.clearAnim(); then?.() })
    } else {
        c.clearAnim()
        then?.()
    }
}

// CE combat.cc _combat_standup: standing up costs 3 AP (1 with Quick Recovery for the
// player).
export function combatStandup(c: Critter, then?: () => void): void {
    const cost = c.isPlayer && c.hasPerk('Quick Recovery') ? 1 : 3
    const AP = c.AP
    if (AP) {
        if (cost > AP.combat) AP.combat = 0
        else AP.combat -= cost
    }
    dudeStandup(c, then)
}
