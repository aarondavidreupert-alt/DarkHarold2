/*
Copyright 2014 darkf, Stratege
Copyright 2015 darkf

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

import { Critter } from '../object.js'

// CE combat.cc AP bookkeeping: `combat` is critter.combat.ap, set to
// STAT_MAXIMUM_ACTION_POINTS each round (_combat_set_move_all); `move` is the player's
// _combat_free_move, 2 per Bonus Move rank at the start of the player's turn
// (_combat_turn), spent before AP on movement only (animation.cc _object_move).
export class ActionPoints {
    combat: number = 0 // Combat AP
    move: number = 0   // free move points (Bonus Move, player only)
    attachedCritter: Critter

    constructor(obj: Critter) {
        this.attachedCritter = obj
        this.resetAP()
    }

    resetAP() {
        this.combat = this.getMaxAP()
        this.move = this.attachedCritter.isPlayer
            ? 2 * this.attachedCritter.perks.filter((p) => p === 'Bonus Move').length
            : 0
    }

    /** STAT_MAXIMUM_ACTION_POINTS — 5 + AGI/2 (or the proto's value) plus Action Boy,
     *  Bruiser and other stat modifiers. */
    getMaxAP(): number {
        return Math.max(0, this.attachedCritter.getStat('AP'))
    }

    /** Max AP for the HUD (the free move points show separately). */
    getTotalMaxAP(): number {
        return this.getMaxAP()
    }

    /** Points available for movement: free move points first, then AP. */
    getAvailableMoveAP(): number {
        return this.combat + this.move
    }

    getAvailableCombatAP() {
        return this.combat
    }

    subtractMoveAP(value: number): boolean {
        // CE critter.cc critterGetMovementPointCostAdjustedForCrippledLegs: x4 one leg, x8 both
        const critter = this.attachedCritter
        if (critter.crippledLeftLeg && critter.crippledRightLeg) value *= 8
        else if (critter.crippledLeftLeg || critter.crippledRightLeg) value *= 4

        if (this.combat + this.move < value) return false
        const fromFree = Math.min(this.move, value)
        this.move -= fromFree
        this.combat -= value - fromFree
        return true
    }

    subtractCombatAP(value: number): boolean {
        if (this.combat < value) return false

        this.combat -= value
        return true
    }
}
