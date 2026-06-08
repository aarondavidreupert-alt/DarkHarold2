/*
Copyright 2014-2015 darkf, Stratege

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

// Critical-effect appliers split out of criticalEffects.ts. See
// wiki/ts-split-refactor.md → "Per-file split proposals" §22.

import { Critter, WeaponObj } from '../object.js'
import globalState from '../globalState.js'
import { critterDamage, Weapon, getAvailableUnarmedMoves } from '../critter.js'
import { uiDrawWeapon, uiLog } from '../ui.js'

interface Dict<T> {
    [key: string]: T
}

export type EffectsFunction = (target: Critter) => void

const generalRegionName: { [region: number]: string } = {
    0: 'head',
    1: 'leftArm',
    2: 'rightArm',
    3: 'torso',
    4: 'rightLeg',
    5: 'leftLeg',
    6: 'eyes',
    7: 'groin',
    8: 'uncalled',
}

// TODO: make this table account for different weapon types. It appears melee weapons use a second one
// though it appears to only be a /2 for melee
export const regionHitChanceDecTable: { [region: string]: number } = {
    torso: 0,
    leftLeg: 20,
    rightLeg: 20,
    leftArm: 30,
    rightArm: 30,
    head: 40,
    eyes: 30,   // FO2 reference: -30 penalty (less than head; eyes are small but close)
    groin: 60,  // FO2 reference: -60 penalty (hardest targeted shot)
}

// Helper: compute raw weapon damage for the attacker's current weapon (no armor, no multiplier)
function selfWeaponDamage(target: Critter): number {
    const weaponObj = (target as any).equippedWeapon
    const weapon = weaponObj?.weapon
    if (!weapon) return 0
    const min = weapon.minDmg ?? 1
    const max = weapon.maxDmg ?? min
    return Math.floor(Math.random() * (max - min + 1)) + min
}

export const critFailEffects: Dict<EffectsFunction> = {
    damageSelf: function (target: Critter) {
        // Attacker injures themselves with their own weapon (no armor bypass, no crit)
        const dmg = Math.max(1, selfWeaponDamage(target))
        console.log(target.name + ' damaged themselves for ' + dmg)
        critterDamage(target, dmg, target, false, true)
    },

    crippleRandomAppendage: function (target: Critter) {
        const appendages = ['crippledLeftArm', 'crippledRightArm', 'crippledLeftLeg', 'crippledRightLeg']
        const choice = appendages[Math.floor(Math.random() * appendages.length)] as keyof Critter
        ;(target as any)[choice] = true
        console.log(target.name + ' crippled their own ' + choice)
    },

    hitRandomly: function (target: Critter) {
        // Redirect the attack to a random combat participant (excluding the attacker)
        const combat = globalState.combat
        if (!combat) return
        const candidates = (combat as any).combatants?.filter(
            (c: Critter) => !c.dead && c !== target
        ) ?? []
        if (candidates.length === 0) return
        const victim: Critter = candidates[Math.floor(Math.random() * candidates.length)]
        const dmg = Math.max(1, selfWeaponDamage(target))
        console.log(target.name + ' hit randomly — struck ' + victim.name + ' for ' + dmg)
        critterDamage(victim, dmg, target, false, true)
    },

    hitSelf: function (target: Critter) {
        // Attacker turns the weapon on themselves (full damage, no armor)
        const dmg = Math.max(1, selfWeaponDamage(target))
        console.log(target.name + ' hit themselves for ' + dmg)
        critterDamage(target, dmg, target, false, true)
    },

    loseAmmo: function (target: Critter) {
        // Empty the magazine (jam / misfire)
        const weaponObj = (target as any).equippedWeapon
        if (weaponObj?.pro?.extra) {
            weaponObj.pro.extra.rounds = 0
            console.log(target.name + ' lost their ammo')
        }
    },

    destroyWeapon: function (target: Critter) {
        // Weapon explodes in hand — drop it and deal blast damage to the attacker
        const dmg = Math.max(1, selfWeaponDamage(target))
        console.log(target.name + "'s weapon blew up for " + dmg + ' damage')
        critterEffects.droppedWeapon(target) // remove from hand and place on ground
        critterDamage(target, dmg, target, false, true)
    },
}

export const critterEffects: Dict<(target: Critter) => void> = {
    knockout: function (target: Critter) {
        // Skip 2 turns; critterDamage() reads isKnockedDown and plays the animation
        target.skipTurns = Math.max(target.skipTurns, 2)
        target.isKnockedDown = true
    },

    knockdown: function (target: Critter) {
        // Skip 1 turn; critterDamage() reads isKnockedDown and plays the animation
        target.skipTurns = Math.max(target.skipTurns, 1)
        target.isKnockedDown = true
    },

    crippledLeftLeg: function (target: Critter) {
        if (!target.crippledLeftLeg) {
            target.crippledLeftLeg = true
            console.log(target.name + ' has been crippled in the left leg')
        }
    },

    crippledRightLeg: function (target: Critter) {
        if (!target.crippledRightLeg) {
            target.crippledRightLeg = true
            console.log(target.name + ' has been crippled in the right leg')
        }
    },

    crippledLeftArm: function (target: Critter) {
        if (!target.crippledLeftArm) {
            target.crippledLeftArm = true
            console.log(target.name + ' has been crippled in the left arm')
        }
    },

    crippledRightArm: function (target: Critter) {
        if (!target.crippledRightArm) {
            target.crippledRightArm = true
            console.log(target.name + ' has been crippled in the right arm')
        }
    },

    blinded: function (target: Critter) {
        if (!target.isBlinded) {
            target.isBlinded = true
            console.log(target.name + ' has been blinded')
        }
    },

    death: function (target: Critter) {
        // Mark the critter for an explosive death animation if this hit kills them.
        // critterKill() reads target.deathAnim before choosing the animation.
        target.deathAnim = 'death-explode'
    },

    onFire: function (target: Critter) {
        // 3 turns of fire DoT; stacks by taking the max so double-fire doesn't double-tick
        target.onFireTurns = Math.max(target.onFireTurns, 3)
        console.log(target.name + ' is on fire for ' + target.onFireTurns + ' turns')
    },

    bypassArmor: function (target: Critter) {
        // Flag consumed by getDamageDone() to zero out DR/DT for this hit
        target.bypassArmorNextHit = true
    },

    droppedWeapon: function (target: Critter) {
        const self = target as any
        const activeHand: 'leftHand' | 'rightHand' = self.activeHand ?? 'leftHand'
        const weaponObj: WeaponObj | undefined = self[activeHand]

        if (!weaponObj || !weaponObj.weapon || weaponObj.weapon.type === 'melee') {
            // No real weapon to drop (unarmed / punch)
            return
        }

        // Natural weapons (Spore Plant plntspik, claws, etc.) live only in
        // the hand slot — never in inventory. fallout2-ce's
        // attackComputeCriticalFailure() masks DAM_DROP for these
        // (weapon == nullptr || weapon == attacker). Mirror that here:
        // if the hand weapon isn't an inventory item, it's a natural attack
        // and can't be dropped.
        const invIdx = target.inventory.indexOf(weaponObj)
        if (invIdx === -1) return
        target.inventory.splice(invIdx, 1)

        // Place weapon on the ground at target's position
        if (globalState.gMap) {
            weaponObj.position = { ...target.position }
            globalState.gMap.addObject(weaponObj)
        }

        // Replace hand slot with unarmed punch (with progression if critter has skill)
        const fist = new WeaponObj()
        fist.type = 'item'
        fist.subtype = 'weapon'
        fist.weapon = new Weapon(null as any)
        const unarmedSkill = (target as any).getSkill?.('Unarmed') ?? 55
        const charLevel = (target as any).getStat?.('Level') ?? 1
        fist.weapon.initUnarmedMoves(unarmedSkill, charLevel)
        self[activeHand] = fist

        uiLog(`${target.name} dropped their weapon!`)
        // FO2-CE ref: combat.cc DAM_DROP — update HUD weapon display if this is the player
        if (target.isPlayer) uiDrawWeapon()
    },

    loseNextTurn: function (target: Critter) {
        target.skipTurns = Math.max(target.skipTurns, 1)
    },

    random: function (target: Critter) {
        // Pick a random non-death effect from the set; avoid infinite recursion
        const pool = ['knockdown', 'loseNextTurn', 'crippledLeftArm', 'crippledRightArm']
        const choice = pool[Math.floor(Math.random() * pool.length)]
        critterEffects[choice](target)
    },
}
