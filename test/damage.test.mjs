// combat/damage.ts against fallout2-ce combat.cc. Each expected value is worked out by hand from
// the CE function named in the test, step by step in the comment, with C integer division.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    glovzDivRound,
    computeDamage,
    computeDamageVanilla,
    computeDamageGlovz,
    computeDamageYaam,
} from '../js/combat/damage.js'
import { Config } from '../js/config.js'

// A 10mm pistol round (damage roll 15) against leather armour (DT 4 / DR 30), normal hit
// (CE bonusDamageMultiplier 2), plain ammo, normal combat difficulty.
const base = { RD: 15, bonus: 0, critMult: 2, ammoX: 1, ammoY: 1, ammoRM: 0, DT: 4, DR: 30, CD: 100 }

// --- CE combat.cc damageModGlovzDivRound ---

test('glovzDivRound: exact quotients', () => {
    // combat.cc damageModGlovzDivRound: dividend % divisor == 0 returns the quotient
    assert.equal(glovzDivRound(10, 5), 2)
    assert.equal(glovzDivRound(5, 5), 1)
    assert.equal(glovzDivRound(330, 100), 3) // remainder 30: 60 > 100 is false, stays 3
})

test('glovzDivRound: halves round to even', () => {
    // combat.cc damageModGlovzDivRound: 7/2 -> q 3, rem 1*2 == 2 and q odd -> 4;
    // 5/2 -> q 2, rem 1*2 == 2 but q even -> 2
    assert.equal(glovzDivRound(7, 2), 4)
    assert.equal(glovzDivRound(5, 2), 2)
    assert.equal(glovzDivRound(400, 100), 4)
})

test('glovzDivRound: dividend below divisor', () => {
    // combat.cc damageModGlovzDivRound: dividend < divisor -> dividend*2 <= divisor ? 0 : 1
    assert.equal(glovzDivRound(0, 5), 0)
    assert.equal(glovzDivRound(1, 2), 0) // 2 <= 2
    assert.equal(glovzDivRound(2, 3), 1) // 4 > 3
    assert.equal(glovzDivRound(3, 4), 1)
})

// --- CE combat.cc attackComputeDamage (vanilla branch) ---

test('vanilla: normal hit through DT and DR', () => {
    // combat.cc attackComputeDamage: 15 * (2*1) = 30, /1, /2 = 15, *100/100 = 15, -DT 4 = 11,
    // 11 - 11*30/100 (3) = 8
    assert.equal(computeDamageVanilla(base), 8)
})

test('vanilla: critical multiplier', () => {
    // combat.cc attackComputeDamage with bonusDamageMultiplier 6: 15*6 = 90, /2 = 45, -4 = 41,
    // 41 - 41*30/100 (12) = 29
    assert.equal(computeDamageVanilla({ ...base, critMult: 6 }), 29)
})

test('vanilla: armour-piercing ammo (divisor and DR modifier)', () => {
    // combat.cc attackComputeDamage: DR 30 + ammo DR mod -25 = 5; 15*2 = 30, /2 (divisor) = 15,
    // /2 = 7, *100/100 = 7, -4 = 3, 3 - 3*5/100 (0) = 3
    assert.equal(computeDamageVanilla({ ...base, ammoY: 2, ammoRM: -25 }), 3)
})

test('vanilla: DR plus ammo modifier is clamped to 0..100', () => {
    // combat.cc attackComputeDamage: DR 10 - 25 -> clamped to 0: 30/2 = 15, -DT 0 = 15
    assert.equal(computeDamageVanilla({ ...base, DT: 0, DR: 10, ammoRM: -25 }), 15)
    // DR 90 + 30 -> clamped to 100: 15 - 4 = 11, 11 - 11*100/100 = 0
    assert.equal(computeDamageVanilla({ ...base, DR: 90, ammoRM: 30 }), 0)
})

test('vanilla: combat difficulty modifier', () => {
    // combat.cc attackComputeDamage, easy (75): 15*75/100 = 11, -4 = 7, 7 - 7*30/100 (2) = 5
    assert.equal(computeDamageVanilla({ ...base, CD: 75 }), 5)
    // hard (125): 15*125/100 = 18, -4 = 14, 14 - 14*30/100 (4) = 10
    assert.equal(computeDamageVanilla({ ...base, CD: 125 }), 10)
})

test('vanilla: DT above the damage leaves 0, never negative', () => {
    // combat.cc attackComputeDamage: 5*2/2 = 5, -10 = -5, only `damage > 0` is added
    assert.equal(computeDamageVanilla({ ...base, RD: 5, DT: 10 }), 0)
})

// --- CE combat.cc damageModCalculateGlovz ---

test('Glovz: DT, DR and the multiplier as a bonus', () => {
    // combat.cc damageModCalculateGlovz: calcDT = divRound(4,1) = 4, calcDR = divRound(30,1) = 30;
    // 15 - 4 = 11, 11 - divRound(330,100) (3) = 8, + 8*2/2 = 16
    assert.equal(computeDamageGlovz(base), 16)
})

test('Glovz: damage multiplier tweak (type 2)', () => {
    // combat.cc damageModCalculateGlovz, GLOVZ_WITH_DAMAGE_MULTIPLIER_TWEAK:
    // 8 + divRound(8*2*25, 100) (4) = 12
    assert.equal(computeDamageGlovz(base, true), 12)
})

test('Glovz: bonus against no armour with a multiplier-only ammo', () => {
    // combat.cc damageModCalculateGlovz: DT 0, DR 0, ammoX 2 > 1, ammoY 1:
    // 15 + divRound(300,100) (3) = 18, + 18*2/2 = 36
    assert.equal(computeDamageGlovz({ ...base, DT: 0, DR: 0, ammoX: 2 }), 36)
})

test('Glovz: combat difficulty shifts DR by 20; DR 100 or more stops all damage', () => {
    // combat.cc damageModCalculateGlovz: easy (CD < 100) adds 20 DR: 95 + 20 = 115 >= 100 -> return
    assert.equal(computeDamageGlovz({ ...base, DR: 95, CD: 75 }), 0)
    // hard (CD > 100) takes 20 off: DR 30 -> 10; 11 - divRound(110,100) (1) = 10, + 10*2/2 = 20
    assert.equal(computeDamageGlovz({ ...base, CD: 125 }), 20)
})

// --- CE combat.cc damageModCalculateYaam (as meant; wiki/damage_formula.md "YAAM (type 5)") ---
// CE's copy adds nothing (`context->damagePtr += damage`) and subtracts only the extra DR; DH2 keeps
// the intended formula on purpose (known_bugs C3). These values follow CE's steps with both fixed.

test('YAAM: DT comes off before the multipliers', () => {
    // combat.cc damageModCalculateYaam: calcDT = 4 - 0 = 4, extra DR 0, calcDR 30; 15 - 4 = 11,
    // *2 = 22, /1, /2 = 11, *100/100 = 11, 11 - 11*30/100 (3) = 8
    assert.equal(computeDamageYaam(base), 8)
})

test('YAAM: an ammo modifier larger than DT turns into -10 DR a point', () => {
    // combat.cc damageModCalculateYaam: calcDT = 4 - 10 = -6 -> DT 0, extra DR -60;
    // DR 30 - 60 < 0 -> 0; 15 * 2 = 30, /2 = 15, - 0 = 15
    assert.equal(computeDamageYaam({ ...base, ammoRM: 10 }), 15)
})

// --- CE combat.cc attackComputeDamage: dispatch on gDamageCalculationType ---

test('computeDamage dispatches on the damage formula setting', () => {
    const saved = Config.combat.damageCalculationType
    try {
        Config.combat.damageCalculationType = 0
        assert.equal(computeDamage(base), 8)
        Config.combat.damageCalculationType = 1
        assert.equal(computeDamage(base), 16)
        Config.combat.damageCalculationType = 2
        assert.equal(computeDamage(base), 12)
        Config.combat.damageCalculationType = 5
        assert.equal(computeDamage({ ...base, ammoRM: 10 }), 15)
    } finally {
        Config.combat.damageCalculationType = saved
    }
})
