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

import { weaponGetAmmoTypePid } from '../weaponAmmo.js'
import { Config } from '../config.js'
import * as CriticalEffects from '../criticalEffects.js'
import { hexDistance, Point } from '../geometry.js'
import globalState from '../globalState.js'
import * as Lightmap from '../lightmap.js'
import { dbg } from '../logger.js'
import { Critter, Obj } from '../object.js'
import { loadPRO } from '../pro.js'
import * as GameTime from '../gametime.js'
import { toTileNum } from '../tile.js'
import { combatIsShotBlocked } from './lineOfFire.js'

// perk_defs.h weapon perks (proto `perk` field)
const PERK_WEAPON_LONG_RANGE = 58
const PERK_WEAPON_ACCURATE = 59
const PERK_WEAPON_SCOPE_RANGE = 64
const PERK_WEAPON_NIGHT_SIGHT = 66

/** Load ammo stats for a loaded weapon. Returns defaults (X=1,Y=1,RM=0,ACmod=0) if no ammo.
 *  Vanilla: weaponGetAmmoDamageMultiplier / weaponGetAmmoDamageDivisor return 1/1 for no ammo. */
export function getAmmoStats(weaponObj: Obj): { X: number; Y: number; RM: number; ACmod: number } {
    const defaults = { X: 1, Y: 1, RM: 0, ACmod: 0 }
    const ammoPID = weaponGetAmmoTypePid(weaponObj)
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

// CE ref: combat.cc:4398 — attackDetermineToHit's line-of-fire penalty, -10 per live,
// standing critter that _combat_is_shot_blocked counts between attacker and target.
export function accountForPartialCover(obj: Critter, target: Critter, from: Point = obj.position): number {
    if (!globalState.gMap) return 0
    return combatIsShotBlocked(obj, from, target.position, target).critters * 10
}

// CE object.cc objectGetDistanceBetweenTiles — the hex distance, one less for each
// multihex object (OBJECT_MULTIHEX 0x800), never below 0.
export function objectDistance(a: Obj, from: Point, b: Obj, to: Point = b.position): number {
    let d = hexDistance(from, to)
    if (((((a as any).flags ?? 0) >>> 0) & 0x800) !== 0) d -= 1
    if (((((b as any).flags ?? 0) >>> 0) & 0x800) !== 0) d -= 1
    return Math.max(0, d)
}

// CE ref: combat.cc:4334-4393 attackDetermineToHit (ranged/throw branch) — distance
// modifier. Returned as a penalty (positive = harder); negative means a close-range bonus,
// which CE does apply (toHit += distanceMod whenever useDistance is set).
export function getHitDistanceModifier(
    obj: Critter,
    target: Critter,
    weapon: Obj,
    from: Point = obj.position,
    useDistance = true,
): number {
    const weaponPerk = (weapon as any)?.pro?.extra?.perk
    let perceptionBonusMult = 2
    let minEffectiveDist = 0
    if (weaponPerk === PERK_WEAPON_LONG_RANGE) perceptionBonusMult = 4
    else if (weaponPerk === PERK_WEAPON_SCOPE_RANGE) {
        perceptionBonusMult = 5
        minEffectiveDist = 8
    }

    let perception = obj.getStat('PER')
    // SFALL fix kept by CE: Sharpshooter adds 2 PER per rank (player only).
    if (obj.isPlayer) perception += 2 * obj.perks.filter((p) => p === 'Sharpshooter').length

    // _determine_to_hit_no_range (useDistance = false) counts the distance as 0.
    let distanceMod = useDistance ? objectDistance(obj, from, target) : 0
    if (distanceMod >= minEffectiveDist) {
        distanceMod -= obj.isPlayer ? perceptionBonusMult * (perception - 2) : perceptionBonusMult * perception
    } else {
        distanceMod += minEffectiveDist
    }
    if (distanceMod < -2 * perception) distanceMod = -2 * perception

    if (distanceMod >= 0) distanceMod *= obj.isBlinded ? -12 : -4
    else distanceMod *= -4
    // CE: toHit += distanceMod only with useDistance or when it is a bonus — the no-range check
    // doesn't take a scope's minimum-distance penalty (−32 for Scope Range)
    if (!useDistance && distanceMod <= 0) return 0
    return -distanceMod
}

// CE ref: object.cc:1748 objectGetLightIntensity — tile intensity at obj's position,
// subtracting the player's own light so self-illumination doesn't reduce darkness penalty.
export function getObjectLightIntensity(obj: Critter, isPlayer: boolean): number {
    const tileNum = toTileNum(obj.position)
    // CE object.cc objectGetLightIntensity: the true (unclamped) tile intensity, minus
    // the dude's own light, then clamped to ambient..MAX.
    let intensity = Lightmap.tile_intensity[tileNum] ?? 655
    if (isPlayer) intensity -= obj.lightIntensity
    const ambient = GameTime.getAmbientLight()
    return Math.max(ambient, Math.min(65536, intensity))
}

// CE ref: combat.cc:4458-4463 — darkness penalty tiers for player attacks.
function darknessPenalty(target: Critter): number {
    const light = getObjectLightIntensity(target, false)
    if (light <= 26214) return 40 // < 40% light → -40
    if (light <= 39321) return 25 // < 60% light → -25
    if (light <= 52428) return 10 // < 80% light → -10
    return 0
}

// CE ref: item.cc:131 _attack_subtype via weaponGetAttackTypeForHitMode — the current
// hit mode is the secondary attack for burst, else the primary.
export function weaponAttackType(weaponObj: Obj | null): 'unarmed' | 'melee' | 'throw' | 'ranged' | 'none' {
    const weapon = (weaponObj as any)?.weapon
    if (!weaponObj || !weapon) return 'unarmed'
    const modes = (weaponObj as any).pro?.extra?.attackMode ?? 0
    const index = weapon.usesSecondary?.() ? (modes >> 4) & 0xf : modes & 0xf
    const types = ['none', 'unarmed', 'unarmed', 'melee', 'melee', 'throw', 'ranged', 'ranged', 'ranged'] as const
    return types[index] ?? 'none'
}

// CE ref: combat.cc:4313 attackDetermineToHit (useDistance = true; `from` is the tile
// the attack is made from, CE _determine_to_hit_from_tile).
// `useDistance = false` is CE _determine_to_hit_no_range: distance 0, no line-of-fire count.
export function getHitChance(
    obj: Critter,
    target: Critter,
    region: string,
    from: Point = obj.position,
    useDistance = true,
) {
    const weaponObj = obj.equippedWeapon
    const weapon = weaponObj?.weapon
    const attackType = weaponAttackType(weaponObj)
    // CE: weapon == nullptr || isUnarmedHitMode — a punch or kick. An unarmed-type weapon
    // (brass knuckles, power fist) takes the weapon branch: its skill, min ST, One
    // Hander, Accurate.
    const isUnarmed = weaponObj === null || !weapon || weaponObj.pid === undefined
    const isRanged = attackType === 'ranged' || attackType === 'throw'

    let toHit: number
    let ammoACmod = 0
    let distanceMod = 0
    let coverPenalty = 0
    if (isUnarmed) {
        toHit = obj.getSkill('Unarmed')
    } else {
        // CE weaponGetSkillValue: the skill of the hit mode (a spear's throw uses Throwing)
        const skill = weapon!.skillForMode?.() ?? weapon!.weaponSkillType
        toHit = skill === undefined ? 0 : obj.getSkill(skill)
        const extra = (weaponObj as any).pro?.extra ?? {}

        if (isRanged) {
            distanceMod = getHitDistanceModifier(obj, target, weaponObj!, from, useDistance)
            toHit -= distanceMod
            coverPenalty = useDistance ? accountForPartialCover(obj, target, from) : 0
            toHit -= coverPenalty
        }

        // One Hander trait (player): -40 with two-handed weapons, +20 otherwise.
        if (obj.isPlayer && (obj as any).traits?.includes('One Hander')) {
            const twoHanded = ((extra.weaponFlags ?? 0) & 0x02) !== 0 // WEAPON_TWO_HAND 0x200
            toHit += twoHanded ? -40 : 20
        }

        let minStrengthMod = (extra.minST ?? 0) - obj.getStat('STR')
        if (obj.isPlayer && obj.hasPerk('Weapon Handling')) minStrengthMod -= 3
        if (minStrengthMod > 0) toHit -= 20 * minStrengthMod

        if (extra.perk === PERK_WEAPON_ACCURATE) toHit += 20
        ammoACmod = getAmmoStats(weaponObj!).ACmod
    }

    // Defender AC (+ ammo AC modifier), floored at 0.
    const AC = Math.max(
        0,
        target.getStat('AC') + target.getArmorAC() + (globalState.combat?.unusedApAC(target) ?? 0) + ammoACmod,
    )
    toHit -= AC

    // hit_location_penalty: full for ranged/throw, half (C truncation) otherwise.
    const regionPenalty = CriticalEffects.regionHitChanceDecTable[region] ?? 0
    toHit -= isRanged ? regionPenalty : Math.trunc(regionPenalty / 2)

    if (((((target as any).flags ?? 0) >>> 0) & 0x800) !== 0) toHit += 15 // OBJECT_MULTIHEX

    // Darkness, player attacker only; PERK_WEAPON_NIGHT_SIGHT ignores it.
    if (obj.isPlayer && (weaponObj as any)?.pro?.extra?.perk !== PERK_WEAPON_NIGHT_SIGHT) {
        toHit -= darknessPenalty(target)
    }

    // CE attackDetermineToHit: attack_complex's accuracy bonus (_gcsd) for every to-hit during
    // the first combatant's turn, before the 95 cap (spray lines and AI decisions included)
    toHit += (globalState.combat as any)?.gcsd?.accuracyBonus ?? 0

    if (obj.isBlinded) toHit -= 25
    if (((target.injuryFlags ?? 0) & 0x03) !== 0) toHit += 40 // DAM_KNOCKED_OUT | DAM_KNOCKED_DOWN

    // Combat difficulty applies to everyone not on the player's team.
    const player = globalState.player
    if (player && obj.teamNum !== player.teamNum) {
        const d = Config.combat.difficultyModifier
        if (d === 75) toHit -= 20
        else if (d === 125) toHit += 20
    }

    if (toHit > 95) toHit = 95

    // Critical chance (attackCompute): STAT_CRITICAL_CHANCE - hit_location_penalty. (Finesse's
    // +10 is in the stat; an unarmed move's bonus crit chance is its own roll in rollHit.)
    const critChance = obj.getStat('Critical Chance') + regionPenalty

    dbg(
        'combat',
        `hitChance: type=${attackType} dist=${distanceMod} cover=${coverPenalty} AC=${AC} region=${region} -> ${toHit}%`,
    )
    return { hit: toHit, crit: critChance }
}
