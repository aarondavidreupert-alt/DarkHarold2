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

import { Config } from '../config.js'

// CE combat.cc attackComputeDamage and sfall's damage mod (damageModCalculateGlovz /
// damageModCalculateYaam), one round at a time: fallout2.cfg [dh2] damage_formula picks the
// ruleset (Config.combat.damageCalculationType, CE's DamageFormula: 0 vanilla, 1 Glovz,
// 2 Glovz with the multiplier tweak, 5 YAAM). See wiki/damage_formula.md.

/** One round of a damage roll, fed to the active ruleset. */
export interface DamageCalculationContext {
    RD: number // the weapon's raw damage roll (weaponGetDamage)
    bonus: number // flat damage bonus (Bonus Ranged Damage)
    critMult: number // CE bonusDamageMultiplier: 2 for a normal hit, more for a critical
    ammoX: number // ammo damage multiplier
    ammoY: number // ammo damage divisor
    ammoRM: number // ammo DR modifier (each ruleset uses it its own way)
    DT: number // damage threshold after bypass / penetrate
    DR: number // damage resistance after bypass / Finesse, without the ammo modifier
    CD: number // combat difficulty damage modifier (75 / 100 / 125; 100 for the dude's team)
}

/** CE damageModGlovzDivRound: integer division rounding half to even. */
export function glovzDivRound(dividend: number, divisor: number): number {
    if (dividend < divisor) return dividend !== divisor && dividend * 2 <= divisor ? 0 : 1
    let quotient = Math.trunc(dividend / divisor)
    dividend %= divisor
    if (dividend === 0) return quotient
    dividend *= 2
    if (dividend > divisor || (dividend === divisor && (quotient & 1) !== 0)) quotient += 1
    return quotient
}

// CE attackComputeDamage (vanilla): the ammo modifier joins DR (0–100); multiplier × ammo X,
// ÷ ammo Y, ÷ 2, × difficulty, − DT, − DR %.
export function computeDamageVanilla(ctx: DamageCalculationContext): number {
    const DR = Math.max(0, Math.min(100, ctx.DR + ctx.ammoRM))
    let d = ctx.RD + ctx.bonus
    d *= ctx.critMult * ctx.ammoX
    if (ctx.ammoY !== 0) d = Math.trunc(d / ctx.ammoY)
    d = Math.trunc(d / 2)
    d = Math.trunc((d * ctx.CD) / 100)
    d -= ctx.DT
    if (d > 0) d -= Math.trunc((d * DR) / 100)
    return d > 0 ? d : 0
}

// CE damageModCalculateGlovz: DT ÷ ammo Y and DR ÷ ammo X (rounded); DR ±20 by difficulty and
// lowered by the ammo modifier's size, ≥ 100 stops all damage; per round − DT, − DR %, then
// +15 / 20 / 10 % against no armour at all, and the multiplier as + damage × mult / 2 (tweak:
// + damage × mult × 25 %). No difficulty multiply.
export function computeDamageGlovz(ctx: DamageCalculationContext, tweak = false): number {
    const ammoX = ctx.ammoX <= 0 ? 1 : ctx.ammoX
    const ammoY = ctx.ammoY <= 0 ? 1 : ctx.ammoY
    const ammoDR = ctx.ammoRM > 0 ? -ctx.ammoRM : ctx.ammoRM
    const calcDT = ctx.DT > 0 ? glovzDivRound(ctx.DT, ammoY) : ctx.DT
    let calcDR = ctx.DR
    if (ctx.DR > 0) {
        if (ctx.CD > 100) calcDR -= 20
        else if (ctx.CD < 100) calcDR += 20
        calcDR += ammoDR
        calcDR = glovzDivRound(calcDR, ammoX)
        if (calcDR >= 100) return 0
    }
    let d = ctx.RD + ctx.bonus
    if (d <= 0) return 0
    if (ctx.DT > 0) {
        d -= calcDT
        if (d <= 0) return 0
    }
    if (ctx.DR > 0) {
        d -= glovzDivRound(d * calcDR, 100)
        if (d <= 0) return 0
    }
    if (ctx.DT <= 0 && ctx.DR <= 0) {
        if (ammoX > 1 && ammoY > 1) d += glovzDivRound(d * 15, 100)
        else if (ammoX > 1) d += glovzDivRound(d * 20, 100)
        else if (ammoY > 1) d += glovzDivRound(d * 10, 100)
    }
    if (tweak) d += glovzDivRound(d * ctx.critMult * 25, 100)
    else d += Math.trunc((d * ctx.critMult) / 2)
    return d > 0 ? d : 0
}

// CE damageModCalculateYaam as meant: the ammo modifier lowers DT, and what it takes past 0
// adds 10 DR a point (DR ≥ 100 stops all damage); per round − DT, multiplier × ammo X, ÷ ammo
// Y, ÷ 2, × difficulty, − DR %. CE's own copy adds no damage at all (`damagePtr += damage`
// moves the pointer) and takes off only the extra DR; DH2 keeps the intended formula.
export function computeDamageYaam(ctx: DamageCalculationContext): number {
    let calcDT = ctx.DT - ctx.ammoRM
    let extraDR = calcDT
    if (calcDT >= 0) extraDR = 0
    else {
        calcDT = 0
        extraDR *= 10
    }
    let calcDR = ctx.DR + extraDR
    if (calcDR < 0) calcDR = 0
    else if (calcDR >= 100) return 0
    let d = ctx.RD + ctx.bonus - calcDT
    if (d <= 0) return 0
    d *= ctx.critMult * ctx.ammoX
    if (ctx.ammoY !== 0) d = Math.trunc(d / ctx.ammoY)
    d = Math.trunc(d / 2)
    d = Math.trunc((d * ctx.CD) / 100)
    d -= Math.trunc((d * calcDR) / 100)
    return d > 0 ? d : 0
}

/** Dispatch to the configured damage ruleset (Config.combat.damageCalculationType). */
export function computeDamage(ctx: DamageCalculationContext): number {
    switch (Config.combat.damageCalculationType) {
        case 1:
            return computeDamageGlovz(ctx)
        case 2:
            return computeDamageGlovz(ctx, true)
        case 5:
            return computeDamageYaam(ctx)
        default:
            return computeDamageVanilla(ctx)
    }
}
