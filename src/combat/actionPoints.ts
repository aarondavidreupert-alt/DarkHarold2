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

export class ActionPoints {
    combat: number = 0 // Combat AP
    move: number = 0 // Move AP
    attachedCritter: Critter

    constructor(obj: Critter) {
        this.attachedCritter = obj
        this.resetAP()
    }

    resetAP() {
        // Unified AP pool: base + all perk bonuses collected into combat; move is always 0
        this.combat = this.getMaxAP() + this.getBonusCombatAP() + this.getBonusMoveAP()
        this.move = 0
    }

    getBonusCombatAP(): number {
        var bonus = 0
        // Bonus HtH Attacks: +1 combat AP per rank (melee only, but applied globally for simplicity)
        if (this.attachedCritter.hasPerk('Bonus HtH Attacks')) bonus += 1
        // Bonus Rate of Fire: +1 combat AP per rank
        if (this.attachedCritter.hasPerk('Bonus Rate of Fire')) bonus += 1
        return bonus
    }

    getBonusMoveAP(): number {
        var bonus = 0
        // Bonus Move: +2 free move AP per rank added to the unified pool
        if (this.attachedCritter.hasPerk('Bonus Move')) bonus += 2
        return bonus
    }

    /** Base AP = 5 + floor(AGI / 2), without perk bonuses. */
    getMaxAP(): number {
        return 5 + Math.floor(this.attachedCritter.getStat('AGI') / 2)
    }

    /** Full AP at turn start: base + all perk bonuses. Use this for the display max. */
    getTotalMaxAP(): number {
        return this.getMaxAP() + this.getBonusCombatAP() + this.getBonusMoveAP()
    }

    /** Total AP remaining (unified pool — movement and attacks share the same bucket). */
    getAvailableMoveAP(): number {
        return this.combat
    }

    getAvailableCombatAP() {
        return this.combat
    }

    subtractMoveAP(value: number): boolean {
        // Crippled legs increase the AP cost of movement (FO2 reference: 4× one leg, 8× both legs)
        const critter = this.attachedCritter
        if (critter.crippledLeftLeg && critter.crippledRightLeg) value *= 8
        else if (critter.crippledLeftLeg || critter.crippledRightLeg) value *= 4

        if (this.combat < value) return false
        this.combat -= value
        return true
    }

    subtractCombatAP(value: number): boolean {
        if (this.combat < value) return false

        this.combat -= value
        return true
    }
}
