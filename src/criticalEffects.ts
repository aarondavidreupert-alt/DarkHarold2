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

import { Critter, WeaponObj } from './object.js'
import { StatType } from './skills.js'
import { getFileJSON, rollSkillCheck } from './util.js'
import globalState from './globalState.js'
import { critterDamage, Weapon } from './critter.js'

// Critical Effects system

export module CriticalEffects {
    interface Dict<T> {
        [key: string]: T
    }

    interface NumDict<T> {
        [key: number]: T
    }

    type EffectsFunction = (target: Critter) => void

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

    let critterTable: Dict<CritType[]>[]

    // Helper: compute raw weapon damage for the attacker's current weapon (no armor, no multiplier)
    function selfWeaponDamage(target: Critter): number {
        const weaponObj = (target as any).equippedWeapon
        const weapon = weaponObj?.weapon
        if (!weapon) return 0
        const min = weapon.minDmg ?? 1
        const max = weapon.maxDmg ?? min
        return Math.floor(Math.random() * (max - min + 1)) + min
    }

    const critFailEffects: Dict<EffectsFunction> = {
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

    const critterEffects: Dict<(target: Critter) => void> = {
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

            // Remove from inventory (weapons in hand are also in inventory)
            const invIdx = target.inventory.indexOf(weaponObj)
            if (invIdx !== -1) target.inventory.splice(invIdx, 1)

            // Place weapon on the ground at target's position
            if (globalState.gMap) {
                weaponObj.position = { ...target.position }
                globalState.gMap.addObject(weaponObj)
            }

            // Replace hand slot with default unarmed punch
            const fist = new WeaponObj()
            fist.type = 'item'
            fist.subtype = 'weapon'
            fist.weapon = new Weapon(null as any)
            self[activeHand] = fist

            console.log(target.name + ' dropped their weapon')
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

    class Effects {
        effects: EffectsFunction[]

        constructor(effectCallbackList: EffectsFunction[]) {
            this.effects = effectCallbackList
        }

        doEffectsOn(target: any): void {
            for (var i = 0; i < this.effects.length; i++) this.effects[i](target)
        }
    }

    class StatCheck {
        stat: string
        modifier: number
        effects: Effects
        failEffectMessageID: number
        //stat = number, probably

        constructor(stat: string, modifier: number, effects: Effects, failEffectMessageID: number) {
            this.stat = stat
            this.modifier = modifier
            this.effects = effects
            this.failEffectMessageID = failEffectMessageID
        }

        // This should return "Maybe msgID"
        doEffectsOn(target: Critter): any {
            // stat being undefined means there is no stat check to be done
            if (this.stat === undefined) return { success: false }

            var statToRollAgainst = target.getStat(this.stat)
            statToRollAgainst += this.modifier

            // if our target fails their skillcheck, they have to suffer the added effects.
            // We do *10 so we can reuse the skillCheck function which goes from 0 to 100, while stat is 1 to 10
            if (!rollSkillCheck(statToRollAgainst * 10, 0, false)) {
                this.effects.doEffectsOn(target)
                return { success: true, msgID: this.failEffectMessageID }
            }

            return { success: false }
        }
    }

    class CritType {
        DM: number
        effects: Effects
        statCheck: StatCheck
        msgID: number

        constructor(damageMultiplier: number, effects: Effects, statCheck: StatCheck, effectMsg: number) {
            this.DM = damageMultiplier
            this.effects = effects
            this.statCheck = statCheck
            this.msgID = effectMsg
        }

        doEffectsOn(target: Critter) {
            var returnMsgID = this.msgID
            //we need to check for results before we apply the other effects, to ensure the checks in statCheck aren't modified by the effects of the crit.
            var statCheckResults = this.statCheck.doEffectsOn(target)

            this.effects.doEffectsOn(target)

            //did statCheck do its effects as well?
            if (statCheckResults.success === true) returnMsgID = statCheckResults.msgID

            return { DM: this.DM, msgID: returnMsgID }
        }
    }

    interface CritLevelData {
        statCheck: { stat: number; checkModifier: number; failureEffect: string[]; failureMessage: number }
        dmgMultiplier: number
        critEffect: string[]
        msg: number
    }

    function parseCritLevel(critLevel: CritLevelData): CritType {
        var stat = critLevel.statCheck
        var statVal: string | undefined = undefined
        if (stat.stat != -1) statVal = StatType[stat.stat]
        var tempStatCheck = new StatCheck(
            statVal,
            stat.checkModifier,
            parseEffects(stat.failureEffect),
            stat.failureMessage
        )
        var retCritLevel = new CritType(
            critLevel.dmgMultiplier,
            parseEffects(critLevel.critEffect),
            tempStatCheck,
            critLevel.msg
        )
        return retCritLevel
    }

    // takes a List of effect names, gets the appropriate effects from the table and stores it in a Effects object
    function parseEffects(effects: string[]): Effects {
        var tempEffects = []
        for (var i = 0; i < effects.length; i++) tempEffects[i] = critterEffects[effects[i]]
        return new Effects(tempEffects)
    }

    // tries to obtain the CritType object partaining to the critLevel of the region of the critterType in question, returns a default CritType object otherwise
    export function getCritical(critterKillType: number, region: string, critLevel: number): CritType {
        let ret: CritType | undefined = undefined

        try {
            // ensure we aren't exceeding the highest crit level existing for this type of critter and region
            const actualLevel = Math.min(critLevel, critterTable[critterKillType][region].length - 1)
            // get the appropriate CritType from the table
            ret = critterTable[critterKillType][region][actualLevel]
        } catch (e) {}

        if (ret === undefined) {
            console.log('error: could not find critical: ' + critterKillType + '/' + region + '/' + critLevel)
            ret = defaultCritType(critterKillType, region, critLevel)
        }

        return ret
    }

    // constructs a default Crit Type object which doesn't apply any modifications to the shot, only changes the logging.
    function defaultCritType(critterKillType: number, region: string, critLevel: number): CritType {
        return new CritType(2, new Effects([]), new StatCheck(undefined, undefined, undefined, undefined), undefined)
    }

    export function getCriticalFail(weaponType: string, failLevel: number): EffectsFunction[] {
        var ret: EffectsFunction[] | undefined = undefined
        try {
            // get the appropriate Critical Fail from the table
            ret = criticalFailTable[weaponType][failLevel]
        } catch (e) {}

        if (ret === undefined)
            //default crit fail error, which doesn't do anything but print an error message
            ret = [
                (critter) => {
                    console.log('error: could not find critical fail: ' + weaponType + '/' + failLevel)
                },
            ]

        return ret
    }

    export function loadTable() {
        // read in the global table
        var haveTable = true

        //console.log("loading critical table...");
        var table = getFileJSON('lut/criticalTables.json', () => {
            haveTable = false
        })

        if (!haveTable) {
            console.log('lut/criticalTables.json not found, not loading critical hit/miss table')
            return
        }

        critterTable = new Array(table.length)
        for (var i = 0; i < table.length; i++) {
            critterTable[i] = {}

            for (var region in table[i]) {
                critterTable[i][region] = new Array(table[i][region].length)

                for (var critLevel = 0; critLevel < table[i][region].length; critLevel++)
                    critterTable[i][region][critLevel] = parseCritLevel(table[i][region][critLevel])
            }
        }
        //console.log("parsed critical table with " + critterTable.length + " entries")
    }

    export const criticalFailTable: Dict<NumDict<EffectsFunction[]>> = {
        unarmed: {
            1: [],
            2: [critterEffects.loseNextTurn],
            3: [critterEffects.loseNextTurn],
            4: [critFailEffects.damageSelf, critterEffects.knockdown],
            5: [critFailEffects.crippleRandomAppendage],
        },
        melee: {
            1: [],
            2: [critterEffects.loseNextTurn],
            3: [critterEffects.droppedWeapon],
            4: [critFailEffects.hitRandomly],
            5: [critFailEffects.hitSelf],
        },
        firearms: {
            1: [],
            2: [critFailEffects.loseAmmo],
            3: [critterEffects.droppedWeapon],
            4: [critFailEffects.hitRandomly],
            5: [critFailEffects.destroyWeapon],
        },
        energy: {
            1: [critterEffects.loseNextTurn],
            2: [critFailEffects.loseAmmo, critterEffects.loseNextTurn],
            3: [critterEffects.droppedWeapon, critterEffects.loseNextTurn],
            4: [critFailEffects.hitRandomly],
            5: [critFailEffects.destroyWeapon, critterEffects.loseNextTurn],
        },
        grenades: {
            1: [],
            2: [critterEffects.droppedWeapon],
            3: [critFailEffects.damageSelf, critterEffects.droppedWeapon],
            4: [critFailEffects.hitRandomly],
            5: [critFailEffects.destroyWeapon],
        },
        rocketlauncher: {
            1: [critterEffects.loseNextTurn],
            2: [], //yes that appears backwards but seems to be the case in FO
            3: [critFailEffects.destroyWeapon],
            4: [critFailEffects.hitRandomly],
            5: [critFailEffects.destroyWeapon, critterEffects.loseNextTurn, critterEffects.knockdown],
        },
        flamers: {
            1: [],
            2: [critterEffects.loseNextTurn],
            3: [critFailEffects.hitRandomly],
            4: [critFailEffects.destroyWeapon],
            5: [critFailEffects.destroyWeapon, critterEffects.loseNextTurn, critterEffects.onFire],
        },
    }

    export function temporaryDoCritFail(critFail: EffectsFunction[], target: Critter) {
        for (var i = 0; i < critFail.length; i++) {
            critFail[i](target)
        }
    }
}
