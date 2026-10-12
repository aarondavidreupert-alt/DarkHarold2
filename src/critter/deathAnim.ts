/*
Copyright 2026 DarkHarold2 contributors

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

// Death animation choice — CE actions.cc _pick_death / _check_death / _pick_fall /
// _action_blood, critter.cc critterKill (single-frame corpses) and object.cc
// _obj_fix_violence_settings. Animations are CE anim ids; Critter.getAnimation
// resolves 'anim:<id>' to the art code (pro.ts artGetCode).

import { Config } from '../config.js'
import { hexInDirection } from '../geometry.js'
import globalState from '../globalState.js'
import type { Critter } from '../object/Critter.js'
import type { Obj } from '../object/Obj.js'
import { getActiveUnarmedMode, getActiveUnarmedModeForHand } from '../unarmed.js'

// CE animation.h
export const ANIM_STAND = 0
export const ANIM_THROW_PUNCH = 16
export const ANIM_KICK_LEG = 17
export const ANIM_THROW_ANIM = 18
export const ANIM_FALL_BACK = 20
export const ANIM_FALL_FRONT = 21
export const ANIM_BIG_HOLE = 23
export const ANIM_CHARRED_BODY = 24
export const ANIM_CHUNKS_OF_FLESH = 25
export const ANIM_DANCING_AUTOFIRE = 26
export const ANIM_ELECTRIFY = 27
export const ANIM_SLICED_IN_HALF = 28
export const ANIM_BURNED_TO_NOTHING = 29
export const ANIM_ELECTRIFIED_TO_NOTHING = 30
export const ANIM_EXPLODED_TO_NOTHING = 31
export const ANIM_MELTED_TO_NOTHING = 32
export const ANIM_FIRE_DANCE = 33
export const ANIM_FALL_BACK_BLOOD = 34
export const ANIM_FALL_FRONT_BLOOD = 35
export const ANIM_PRONE_TO_STANDING = 36
export const ANIM_BACK_TO_STANDING = 37
export const ANIM_THRUST_ANIM = 41
export const ANIM_SWING_ANIM = 42
export const ANIM_FIRE_SINGLE = 45
export const ANIM_FIRE_BURST = 46
export const ANIM_FIRE_CONTINUOUS = 47
export const ANIM_FALL_BACK_SF = 48
export const ANIM_FALL_FRONT_SF = 49
export const ANIM_BIG_HOLE_SF = 51
export const ANIM_SLICED_IN_HALF_SF = 56
export const ANIM_FIRE_DANCE_SF = 61
export const ANIM_FALL_BACK_BLOOD_SF = 62
export const ANIM_FALL_FRONT_BLOOD_SF = 63

const VIOLENCE_LEVEL_NONE = 0
const VIOLENCE_LEVEL_MINIMAL = 1
const VIOLENCE_LEVEL_NORMAL = 2
const VIOLENCE_LEVEL_MAXIMUM_BLOOD = 3

const PROTO_ID_MOLOTOV_COCKTAIL = 159
const PERK_WEAPON_FLAMEBOY = 67

// DAMAGE_TYPE_* order (proto_types.h); DH2 names from Weapon.ts.
const DAMAGE_TYPE_INDEX: { [name: string]: number } = {
    Normal: 0, Laser: 1, Fire: 2, Plasma: 3, Electrical: 4, EMP: 5, Explosive: 6,
}
// actions.cc:55 gNormalDeathAnimations / :66 gMaximumBloodDeathAnimations
const NORMAL_DEATH_ANIMATIONS = [
    ANIM_DANCING_AUTOFIRE, ANIM_SLICED_IN_HALF, ANIM_CHARRED_BODY, ANIM_CHARRED_BODY,
    ANIM_ELECTRIFY, ANIM_FALL_BACK, ANIM_BIG_HOLE,
]
export const MAXIMUM_BLOOD_DEATH_ANIMATIONS = [
    ANIM_CHUNKS_OF_FLESH, ANIM_SLICED_IN_HALF, ANIM_FIRE_DANCE, ANIM_MELTED_TO_NOTHING,
    ANIM_ELECTRIFIED_TO_NOTHING, ANIM_FALL_BACK, ANIM_EXPLODED_TO_NOTHING,
]

export function damageTypeIndex(damageType: string | undefined): number {
    return DAMAGE_TYPE_INDEX[damageType ?? 'Normal'] ?? 0
}

export function animName(anim: number): string {
    return 'anim:' + anim
}

// CE artExists(buildFid(critter, anim, ...)).
export function critterHasAnim(c: Critter, anim: number): boolean {
    return c.hasAnimation(animName(anim))
}

function violenceLevel(): number {
    return Config.combat.violenceLevel
}

// Unarmed attack anim: ANIM_KICK_LEG for kick moves, else ANIM_THROW_PUNCH (same
// choice as Critter.getAnimation('attack')).
export function unarmedAttackAnim(obj: Critter): number {
    const skill = obj.getSkill('Unarmed')
    const mode = obj.isPlayer
        ? getActiveUnarmedModeForHand(skill, (obj as any).activeHand ?? 'leftHand', globalState.punchModeIdx, globalState.kickModeIdx, !(obj as any).leftHand?.weapon && !(obj as any).rightHand?.weapon)
        : getActiveUnarmedMode(skill, 0)
    return mode.icon === 'kick' ? ANIM_KICK_LEG : ANIM_THROW_PUNCH
}

// CE critterGetAnimationForHitMode — the attacker's anim for its current hit mode.
const ATTACK_MODE_ANIM: { [mode: string]: number } = {
    punch: ANIM_THROW_PUNCH, kick: ANIM_KICK_LEG, swing: ANIM_SWING_ANIM, thrust: ANIM_THRUST_ANIM,
    throw: ANIM_THROW_ANIM, 'fire single': ANIM_FIRE_SINGLE, 'fire burst': ANIM_FIRE_BURST, flame: ANIM_FIRE_CONTINUOUS,
}
export function attackerAnimation(attacker: Critter | undefined): number {
    if (!attacker) return ANIM_STAND
    const w = attacker.equippedWeapon?.weapon
    if (!w) return unarmedAttackAnim(attacker)
    const mode = w.mode === 'burst' ? w.attackTwo?.mode : w.attackOne?.mode
    return ATTACK_MODE_ANIM[String(mode)] ?? ANIM_FIRE_SINGLE
}

// actions.cc _check_death
export function checkDeath(obj: Critter, anim: number, minViolenceLevel: number, hitFromFront: boolean): number {
    if (violenceLevel() >= minViolenceLevel && critterHasAnim(obj, anim)) return anim
    if (hitFromFront) return ANIM_FALL_BACK
    return critterHasAnim(obj, ANIM_FALL_FRONT) ? ANIM_FALL_BACK : ANIM_FALL_FRONT
}

export interface DeathContext {
    attacker?: Critter
    weapon?: Obj | null
    damage: number
    damageType?: string
    attackerAnim: number
    hitFromFront: boolean
}

// actions.cc _pick_death
export function pickDeath(defender: Critter, ctx: DeathContext): number {
    let normalThreshold = 15
    let maximumBloodThreshold = 45
    let damageType = damageTypeIndex(ctx.damageType)
    let attackerAnim = ctx.attackerAnim
    const weapon: any = ctx.weapon

    if (weapon && weapon.pid === PROTO_ID_MOLOTOV_COCKTAIL) {
        normalThreshold = 5
        maximumBloodThreshold = 15
        damageType = DAMAGE_TYPE_INDEX.Fire
        attackerAnim = ANIM_FIRE_SINGLE
    }
    const attackerIsDude = ctx.attacker !== undefined && ctx.attacker === (globalState.player as unknown as Critter)
    if (attackerIsDude && ctx.attacker!.hasPerk?.('Pyromaniac') && damageType === DAMAGE_TYPE_INDEX.Fire) {
        normalThreshold = 1
        maximumBloodThreshold = 1
    }
    if (weapon && weapon.pro?.extra?.perk === PERK_WEAPON_FLAMEBOY) {
        normalThreshold = Math.trunc(normalThreshold / 3)
        maximumBloodThreshold = Math.trunc(maximumBloodThreshold / 3)
    }

    const violence = violenceLevel()
    if (((defender.pro?.extra?.flags ?? 0) & 0x1000) !== 0) { // CRITTER_SPECIAL_DEATH
        return checkDeath(defender, ANIM_EXPLODED_TO_NOTHING, VIOLENCE_LEVEL_NORMAL, ctx.hitFromFront)
    }
    const bloodyMess = attackerIsDude && ((ctx.attacker as any).traits ?? []).includes('Bloody Mess')
    const damage = ctx.damage

    let deathAnim = ANIM_FALL_BACK
    if ((attackerAnim === ANIM_THROW_PUNCH && damageType === DAMAGE_TYPE_INDEX.Normal)
        || attackerAnim === ANIM_KICK_LEG
        || attackerAnim === ANIM_THRUST_ANIM
        || attackerAnim === ANIM_SWING_ANIM
        || (attackerAnim === ANIM_THROW_ANIM && damageType !== DAMAGE_TYPE_INDEX.Explosive)) {
        if (violence === VIOLENCE_LEVEL_MAXIMUM_BLOOD && bloodyMess) deathAnim = ANIM_BIG_HOLE
    } else if (attackerAnim === ANIM_FIRE_SINGLE && damageType === DAMAGE_TYPE_INDEX.Normal) {
        if (violence === VIOLENCE_LEVEL_MAXIMUM_BLOOD && (bloodyMess || maximumBloodThreshold <= damage)) {
            deathAnim = ANIM_BIG_HOLE
        }
    } else if (violence > VIOLENCE_LEVEL_MINIMAL && (bloodyMess || normalThreshold <= damage)) {
        if (violence > VIOLENCE_LEVEL_NORMAL && (bloodyMess || maximumBloodThreshold <= damage)) {
            deathAnim = MAXIMUM_BLOOD_DEATH_ANIMATIONS[damageType]
            if (checkDeath(defender, deathAnim, VIOLENCE_LEVEL_MAXIMUM_BLOOD, ctx.hitFromFront) !== deathAnim) {
                deathAnim = NORMAL_DEATH_ANIMATIONS[damageType]
            }
        } else {
            deathAnim = NORMAL_DEATH_ANIMATIONS[damageType]
        }
    }

    if (!ctx.hitFromFront && deathAnim === ANIM_FALL_BACK) deathAnim = ANIM_FALL_FRONT
    return checkDeath(defender, deathAnim, VIOLENCE_LEVEL_NONE, ctx.hitFromFront)
}

function blockedAt(obj: Critter, dir: number, distance: number): boolean {
    let pos = obj.position
    for (let i = 0; i < distance; i++) pos = hexInDirection(pos, dir)
    return (globalState.gMap?.objectsAtPosition(pos) ?? []).some((o: Obj) => o !== obj && o.blocks?.())
}

// actions.cc _pick_fall — fall the other way when a blocker is 1-2 hexes behind
// the direction of the fall.
export function pickFall(obj: Critter, anim: number): number {
    const rotation = obj.orientation ?? 0
    if (anim === ANIM_FALL_FRONT) {
        for (let i = 1; i < 3; i++) if (blockedAt(obj, rotation, i)) { anim = ANIM_FALL_BACK; break }
    } else if (anim === ANIM_FALL_BACK) {
        for (let i = 1; i < 3; i++) if (blockedAt(obj, (rotation + 3) % 6, i)) { anim = ANIM_FALL_FRONT; break }
    }
    if (anim === ANIM_FALL_FRONT && !critterHasAnim(obj, ANIM_FALL_FRONT)) anim = ANIM_FALL_BACK
    return anim
}

// actions.cc _action_blood — the blood-pool variant that follows a plain fall, or
// null when there is none (violence NONE, no art, not a fall).
export function bloodAnim(obj: Critter, anim: number): number | null {
    if (violenceLevel() === VIOLENCE_LEVEL_NONE) return null
    const bloody = anim === ANIM_FALL_BACK ? ANIM_FALL_BACK_BLOOD : anim === ANIM_FALL_FRONT ? ANIM_FALL_FRONT_BLOOD : null
    return bloody !== null && critterHasAnim(obj, bloody) ? bloody : null
}

// object.cc _obj_fix_violence_settings — gory single-frame corpses become a plain
// fall below the violence level that shows them.
export function fixViolenceSettings(anim: number): number {
    let start: number, end: number
    switch (violenceLevel()) {
        case VIOLENCE_LEVEL_NONE: start = ANIM_BIG_HOLE_SF; end = ANIM_FALL_FRONT_BLOOD_SF; break
        case VIOLENCE_LEVEL_MINIMAL: start = ANIM_BIG_HOLE_SF; end = ANIM_FIRE_DANCE_SF; break
        case VIOLENCE_LEVEL_NORMAL: start = ANIM_BIG_HOLE_SF; end = ANIM_SLICED_IN_HALF_SF; break
        default: return anim
    }
    if (anim >= start && anim <= end) return anim === ANIM_FALL_BACK_BLOOD_SF ? ANIM_FALL_BACK_SF : ANIM_FALL_FRONT_SF
    return anim
}

// critter.cc critterKill — the single-frame corpse a kill without animation shows:
// a fallen critter keeps its fall (as SF), otherwise `deathFrame` (CE default
// LAST_SF_DEATH_ANIM), with ANIM_FALL_BACK_BLOOD_SF when the art is missing.
export function corpseFrame(obj: Critter, deathFrame: number | undefined, fallAnim: number | null): number {
    if (fallAnim === ANIM_FALL_BACK) return ANIM_FALL_BACK_SF
    if (fallAnim === ANIM_FALL_FRONT) {
        return critterHasAnim(obj, ANIM_FALL_FRONT_SF) ? ANIM_FALL_FRONT_SF : ANIM_FALL_BACK_SF
    }
    let anim = deathFrame === undefined || deathFrame < 0 ? ANIM_FALL_FRONT_BLOOD_SF : Math.min(deathFrame, ANIM_FALL_FRONT_BLOOD_SF)
    anim = fixViolenceSettings(anim)
    if (!critterHasAnim(obj, anim)) anim = fixViolenceSettings(ANIM_FALL_BACK_BLOOD_SF)
    return anim
}

// interpreter_extra.cc _correctDeath (forceBack) + the CE fix in opKillCritterType:
// gory SF frames need maximum blood and the art, otherwise a plain fall (as SF).
export function correctDeath(obj: Critter, anim: number): number {
    if (anim >= ANIM_BIG_HOLE_SF && anim <= ANIM_FALL_FRONT_BLOOD_SF) {
        if (violenceLevel() < VIOLENCE_LEVEL_MAXIMUM_BLOOD || !critterHasAnim(obj, anim)) anim = ANIM_FALL_BACK_SF
    }
    return anim
}

export function isDeathFall(anim: number): boolean {
    return anim === ANIM_FALL_BACK || anim === ANIM_FALL_FRONT
}

