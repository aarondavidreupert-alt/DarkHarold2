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

// Critter perception, shared by the scripting opcodes (obj_can_see_obj /
// obj_can_hear_obj) and the combat AI (_ai_danger_source, notify_onlookers).

import globalState from './globalState.js'
import { hexDirectionTo, hexDistance } from './geometry.js'
import type { Critter, Obj } from './object.js'

// CE actions.cc _can_see: the target is in front of the critter (its facing ±1).
export function canSee(obj: Obj, target: Obj): boolean {
    const dir = Math.abs(obj.orientation - hexDirectionTo(obj.position, target.position))
    return [0, 1, 5].indexOf(dir) !== -1
}

// CE combat_ai.cc isWithinPerception: PER × 5 in front (_can_see), halved for
// OBJECT_TRANS_GLASS (Stealth Boy); otherwise PER × 2 in combat, PER outside.
// No line-of-sight test.
export function isWithinPerception(obj: Critter, target: Obj | null | undefined): boolean {
    if (!target) return false
    const dist = hexDistance(obj.position, target.position)
    const perception = obj.getStat('PER')
    const sneakSkill = target.type === 'critter' ? (target as Critter).getSkill('Sneak') : 0
    // CE ref: combat_ai.cc:3514-3522 isWithinPerception — sneak detection tiers:
    //   dudeIsSneaking (isSneaking && sneakWorking) → ÷4 (strong path)
    //   dudeHasState(SNEAKING) (isSneaking only, roll failing) → ×2/3 (weak path)
    const playerTarget = target === globalState.player
    const isSneaking = playerTarget && (globalState.player as any).isSneaking === true
    const sneakWorking = isSneaking && (globalState.player as any).sneakWorking === true
    let reqDist

    if (canSee(obj, target)) {
        reqDist = perception * 5

        // CE ref: combat_ai.cc:3510 — OBJECT_TRANS_GLASS (Stealth Boy II) halves visual range.
        if ((target as any).stealthActive) reqDist = Math.floor(reqDist / 2)

        if (sneakWorking) {
            // CE: dudeIsSneaking() → true → ÷4
            reqDist = Math.floor(reqDist / 4)
            if (sneakSkill > 120) reqDist--
        } else if (isSneaking) {
            // CE: dudeHasState(SNEAKING) only → ×2/3 (no Sneak>120 bonus on this path)
            reqDist = Math.floor((reqDist * 2) / 3)
        }

        if (dist <= reqDist) return true
    }

    // Hearing range — CE combat_ai.cc:3527: no OBJECT_TRANS_GLASS halving here.
    reqDist = globalState.inCombat ? perception * 2 : perception

    if (sneakWorking) {
        reqDist = Math.floor(reqDist / 4)
        if (sneakSkill > 120) reqDist--
    } else if (isSneaking) {
        reqDist = Math.floor((reqDist * 2) / 3)
    }

    return dist <= reqDist
}
