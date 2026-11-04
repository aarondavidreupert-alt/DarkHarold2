// combat/actionPoints.ts against fallout2-ce combat.cc. CE charges AP hex by hex as a critter
// walks (animation.cc _object_move); DH2 pays a walk up front and refunds the hexes not walked
// (refundWalk). Whatever a walk paid, a new turn starts at the maximum (CE _combat_set_move_all).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ActionPoints } from '../js/combat/actionPoints.js'

/** The parts of a Critter ActionPoints reads. */
function critter(maxAP) {
    return {
        isPlayer: true,
        perks: [],
        path: null,
        crippledLeftLeg: false,
        crippledRightLeg: false,
        getStat: (stat) => (stat === 'AP' ? maxAP : 0),
    }
}

test('a walk that stops early gets the unwalked hexes back', () => {
    const c = critter(10)
    const ap = new ActionPoints(c)
    c.path = { walked: 0 }
    assert.equal(ap.subtractMoveAP(5), true)
    assert.equal(ap.combat, 5)
    c.path.walked = 1
    ap.refundWalk(c.path)
    // animation.cc _object_move: only the one hex walked costs AP
    assert.equal(ap.combat, 9)
})

test('a new turn starts at the maximum, even with a walk still paid (combat.cc _combat_set_move_all)', () => {
    // combat.cc _combat_set_move_all: combat.ap = STAT_MAXIMUM_ACTION_POINTS. The previous turn's
    // payment must not come back into the new balance when the walk then ends early.
    const c = critter(10)
    const ap = new ActionPoints(c)
    c.path = { walked: 0 }
    ap.subtractMoveAP(5) // 5 left
    c.path.walked = 1
    ap.resetAP() // the turn ends while walking
    assert.equal(ap.combat, 10)
    ap.refundWalk(c.path) // the walk stops
    assert.equal(ap.combat, 10)
})
