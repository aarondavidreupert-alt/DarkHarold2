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

/** Context for a single damage calculation roll, fed to the active damage ruleset. */
export interface DamageCalculationContext {
    RD: number        // raw die roll
    bonus: number     // flat damage bonus before multipliers
    critMult: number  // critical hit multiplier (1 = normal hit)
    ammoX: number     // ammo damage multiplier
    ammoY: number     // ammo damage divisor (≥1; vanilla adds a separate /2)
    ammoRM: number    // ammo damage resistance modifier (used differently by vanilla vs YAAM)
    DT: number        // damage threshold (post bypass/penetrate adjustments; ammo RM NOT applied here for vanilla)
    DR: number        // damage resistance 0–100 (clamped; ammo RM already applied for vanilla/Glovz)
    CD: number        // combat difficulty modifier (75/100/125)
}

/** Round-half-up integer division — matches fallout2-ce damageModGlovzDivRound. */
function glovzRound(a: number, b: number): number {
    return Math.trunc((a + Math.trunc(b / 2)) / b)
}

export function computeDamageVanilla(ctx: DamageCalculationContext): number {
    let d = ctx.RD + ctx.bonus
    d = Math.trunc(d * ctx.critMult * ctx.ammoX)
    if (ctx.ammoY !== 0) d = Math.trunc(d / ctx.ammoY)
    d = Math.trunc(d / 2)
    d = Math.trunc(d * ctx.CD / 100)
    d -= ctx.DT
    if (d > 0) d -= Math.trunc(d * ctx.DR / 100)
    if (d < 0) d = 0
    return d
}

export function computeDamageGlovz(ctx: DamageCalculationContext): number {
    let d = ctx.RD + ctx.bonus
    d = d * ctx.critMult * ctx.ammoX
    if (ctx.ammoY !== 0) d = glovzRound(d, ctx.ammoY * 2)
    d = Math.trunc(d * ctx.CD / 100)
    // DR applied before DT (key Glovz difference); uses round-half-up
    d -= glovzRound(d * ctx.DR, 100)
    d -= ctx.DT
    if (d < 0) d = 0
    return d
}

export function computeDamageGlovzTweak(ctx: DamageCalculationContext): number {
    // critMult applied after the ammo divide rather than before
    let d = ctx.RD + ctx.bonus
    if (ctx.ammoY !== 0) d = glovzRound(d * ctx.ammoX, ctx.ammoY * 2)
    d = d * ctx.critMult
    d = Math.trunc(d * ctx.CD / 100)
    d -= glovzRound(d * ctx.DR, 100)
    d -= ctx.DT
    if (d < 0) d = 0
    return d
}

export function computeDamageYaam(ctx: DamageCalculationContext): number {
    // CE ref: combat.cc:6767 damageModCalculateYaam
    // (a) DT subtracted BEFORE multiply; (b) /2 halving step present;
    // (c) ammoRM adjusts DT (not DR): calculatedDT = DT - ammoRM; if <0 → extra DR penalty
    let calcDT = ctx.DT - ctx.ammoRM
    let extraDR = 0
    if (calcDT < 0) {
        extraDR = -calcDT * 10
        calcDT = 0
    }
    const calcDR = Math.min(99, ctx.DR + extraDR)
    let d = ctx.RD + ctx.bonus
    d -= calcDT
    if (d <= 0) return 0
    d = Math.trunc(d * ctx.critMult * ctx.ammoX)
    if (ctx.ammoY !== 0) d = Math.trunc(d / ctx.ammoY)
    d = Math.trunc(d / 2)
    d = Math.trunc(d * ctx.CD / 100)
    if (d > 0) d -= Math.trunc(d * calcDR / 100)
    if (d < 0) d = 0
    return d
}

/** Dispatch to the configured damage ruleset (Config.combat.damageCalculationType). */
export function computeDamage(ctx: DamageCalculationContext): number {
    switch (Config.combat.damageCalculationType) {
        case 1: return computeDamageGlovz(ctx)
        case 2: return computeDamageGlovzTweak(ctx)
        case 5: return computeDamageYaam(ctx)
        default: return computeDamageVanilla(ctx)
    }
}
