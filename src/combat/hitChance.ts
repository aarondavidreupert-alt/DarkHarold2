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

import { CriticalEffects } from '../criticalEffects.js'
import { hexDistance, hexLine } from '../geometry.js'
import globalState from '../globalState.js'
import { dbg } from '../logger.js'
import { Critter, Obj } from '../object.js'
import { loadPRO } from '../pro.js'
import { getActiveUnarmedMode, getActiveUnarmedModeForHand } from '../unarmed.js'

function combatDebug(...args: any[]): void {
    dbg('combat', ...args)
}

/** Load ammo stats for a loaded weapon. Returns defaults (X=1,Y=1,RM=0,ACmod=0) if no ammo.
 *  Vanilla: weaponGetAmmoDamageMultiplier / weaponGetAmmoDamageDivisor return 1/1 for no ammo. */
export function getAmmoStats(weaponObj: Obj): { X: number; Y: number; RM: number; ACmod: number } {
    const defaults = { X: 1, Y: 1, RM: 0, ACmod: 0 }
    const ammoPID: number | undefined = (weaponObj as any).pro?.extra?.ammoPID
    if (ammoPID === undefined || ammoPID < 0) return defaults

    const ammoPro = loadPRO(ammoPID, ammoPID & 0xffff)
    if (!ammoPro || !ammoPro.extra) return defaults

    return {
        X: ammoPro.extra.damMult ?? 1,
        Y: ammoPro.extra.damDiv ?? 1,
        RM: ammoPro.extra['DR modifier'] ?? 0,
        ACmod: ammoPro.extra['AC modifier'] ?? 0,
    }
}

export function accountForPartialCover(obj: Critter, target: Critter): number {
    // Count living critters on the hex line between obj and target
    // (excluding the endpoints). Subtract 10 per intervening critter.
    if (!globalState.gMap) return 0

    const line = hexLine(obj.position, target.position)
    if (!line || line.length <= 2) return 0

    const interior = line.slice(1, -1)

    // Pre-index living critters by "x,y" hex key so the interior scan is O(lineLength)
    // instead of O(lineLength * numObjects).
    const crittersByHex = new Map<string, number>()
    for (const o of globalState.gMap.getObjects()) {
        if (
            o instanceof Critter &&
            !o.dead &&
            o !== obj &&
            o !== target
        ) {
            const key = `${o.position.x},${o.position.y}`
            crittersByHex.set(key, (crittersByHex.get(key) || 0) + 1)
        }
    }

    let count = 0
    for (const hex of interior) {
        count += crittersByHex.get(`${hex.x},${hex.y}`) || 0
    }
    return count * 10
}

export function getHitDistanceModifier(obj: Critter, target: Critter, weapon: Obj): number {
    // we calculate the distance between source and target
    // we then substract the source's per modified by the weapon from it (except for scoped weapons)

    // NOTE: this function is supposed to have weird behaviour for multihex sources and targets. Let's ignore that.

    // 4 if weapon has long_range perk
    // 5 if weapon has scope_range perk
    var distModifier = 2
    // 8 if weapon has scope_range perk
    var minDistance = 0
    var perception = obj.getStat('PER')
    var distance = hexDistance(obj.position, target.position)
    if (distance < minDistance)
        distance += minDistance // yes supposedly += not =, this means 7 grid distance is the worst
    else {
        var tempPER = perception
        if (obj.isPlayer === true) tempPER -= 2 // FO2 reference: player receives a -2 PER penalty in hit chance (hardcoded in _combat_to_hit, combat.c)
        distance -= tempPER * distModifier
    }

    // this appears not to have any effect but was found so elsewhere
    // If anyone can tell me why it exists or what it's for I'd be grateful.
    if (-2 * perception > distance) distance = -2 * perception

    // Sharpshooter perk: each rank reduces the effective distance by 2 hexes
    if (obj.hasPerk('Sharpshooter')) distance -= 2

    // then we multiply a magic number on top. More if the attacker is blinded (FO2: 12× vs 4×)
    var objHasEyeDamage = obj.isBlinded
    if (distance >= 0 && objHasEyeDamage) distance *= 12
    else distance *= 4

    // and if the result is a positive distance, we return that
    // closeness can not improve hitchance above normal, so we don't return that
    if (distance >= 0) return distance
    else return 0
}

export function getHitChance(obj: Critter, target: Critter, region: string) {
    // NOTE: distance modifier is implemented; light conditions not yet factored in
    var weaponObj = obj.equippedWeapon
    if (weaponObj === null) {
        // Unarmed (no weapon equipped): use Unarmed skill
        const unarmedSkill = obj.getSkill('Unarmed')
        const mode = obj.isPlayer
            ? getActiveUnarmedModeForHand(unarmedSkill, (obj as any).activeHand ?? 'leftHand', globalState.punchModeIdx, globalState.kickModeIdx, !(obj as any).leftHand?.weapon && !(obj as any).rightHand?.weapon)
            : getActiveUnarmedMode(unarmedSkill, 0)
        const AC = target.getStat('AC') + target.getArmorAC() + target.bonusAC
        const partialCoverPenalty = accountForPartialCover(obj, target)
        const crippledArmPenalty = (obj.crippledLeftArm ? 40 : 0) + (obj.crippledRightArm ? 40 : 0)
        const blindPenalty = obj.isBlinded ? 25 : 0
        const baseCrit = obj.getStat('Critical Chance') + mode.critBonus
        // CE ref: combat.cc:4440 — melee/unarmed use half the hit-location penalty
        const regionPenalty = Math.floor(CriticalEffects.regionHitChanceDecTable[region] / 2)
        var hitChance = unarmedSkill - AC - regionPenalty - partialCoverPenalty - crippledArmPenalty - blindPenalty
        var critChance = baseCrit + CriticalEffects.regionHitChanceDecTable[region]
        hitChance = Math.min(95, hitChance)
        combatDebug(`hitChance(unarmed): skill=${unarmedSkill} AC=${AC} region=${regionPenalty} cover=${partialCoverPenalty} → ${hitChance}%`)
        return { hit: hitChance, crit: critChance }
    }

    var weapon = weaponObj.weapon
    var weaponSkill

    if (!weapon) throw Error('getHitChance: No weapon')

    if (weapon.weaponSkillType === undefined) {
        combatDebug('weaponSkillType is undefined')
        weaponSkill = 0
    } else weaponSkill = obj.getSkill(weapon.weaponSkillType)

    var hitDistanceModifier = getHitDistanceModifier(obj, target, weaponObj)
    var ammoStats = getAmmoStats(weaponObj)
    // Ammo AC modifier reduces effective AC (negative value = easier to hit, e.g. AP rounds)
    var AC = target.getStat('AC') + target.getArmorAC() + target.bonusAC + ammoStats.ACmod
    var partialCoverPenalty = accountForPartialCover(obj, target)
    // FO2-CE ref: combat.cc rollCriticalHit() — Finesse trait adds +10 to critical chance
    var bonusCrit = ((obj as any).traits?.includes('Finesse')) ? 10 : 0
    var baseCrit = obj.getStat('Critical Chance') + bonusCrit

    // Crippled-limb penalties for the attacker (FO2: -40 per arm)
    var crippledArmPenalty = 0
    if (obj.crippledLeftArm) crippledArmPenalty += 40
    if (obj.crippledRightArm) crippledArmPenalty += 40

    // Blinded attacker: additional -25 flat penalty on top of the 12× distance modifier wired above
    var blindPenalty = obj.isBlinded ? 25 : 0

    // CE ref: combat.cc:4437-4440 — ranged weapons use full penalty; melee/thrown use half
    const isRanged = weapon.weaponSkillType === 'Small Guns' || weapon.weaponSkillType === 'Big Guns' ||
                     weapon.weaponSkillType === 'Energy Weapons' || weapon.weaponSkillType === 'Throwing'
    const regionPenaltyFull = CriticalEffects.regionHitChanceDecTable[region]
    const regionPenalty = isRanged ? regionPenaltyFull : Math.floor(regionPenaltyFull / 2)
    var hitChance = weaponSkill - AC - regionPenalty - hitDistanceModifier - partialCoverPenalty - crippledArmPenalty - blindPenalty
    var critChance = baseCrit + regionPenaltyFull

    if (isNaN(hitChance)) throw 'something went wrong with hit chance calculation'

    // 1 in 20 chance of failing needs to be preserved
    hitChance = Math.min(95, hitChance)

    return { hit: hitChance, crit: critChance }
}
