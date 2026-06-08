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

// Critical-table loader, accessors, classes and crit-fail dispatch.
// Split out of criticalEffects.ts. See wiki/ts-split-refactor.md →
// "Per-file split proposals" §22.

import { Critter } from '../object.js'
import { StatType } from '../skills.js'
import { getFileJSON, rollSkillCheck } from '../util.js'
import { critterEffects, critFailEffects, EffectsFunction } from './effects.js'

interface Dict<T> {
    [key: string]: T
}

interface NumDict<T> {
    [key: number]: T
}

let critterTable: Dict<CritType[]>[]

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
