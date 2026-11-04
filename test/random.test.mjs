// random.ts against fallout2-ce random.cc. ceRandom below is random.cc's generator transliterated
// (Park-Miller "minimal standard" with a 32-entry shuffle table); its core step is checked against
// Park & Miller's published value, then DH2's draws are compared with it draw for draw.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBetween, randomSeedExact, randomSeedPrerandom } from '../js/random.js'
import { cdiv } from './support/ce.mjs'

const INT_MAX = 0x7fffffff

/** random.cc state: _iy, _iv[32], _idum. Static, so zero at program start. */
function ceRandom() {
    let iy = 0
    const iv = new Array(32).fill(0)
    let idum = 0
    return {
        // random.cc randomSeedPrerandomInternal
        seed(seed) {
            let num = seed < 1 ? 1 : seed
            for (let index = 40; index > 0; index--) {
                num = 16807 * (num % 127773) - 2836 * cdiv(num, 127773)
                if (num < 0) num &= INT_MAX
                if (index < 32) iv[index] = num
            }
            iy = iv[0]
            idum = num
        },
        // random.cc getRandom
        getRandom(max) {
            let v1 = 16807 * (idum % 127773) - 2836 * cdiv(idum, 127773)
            if (v1 < 0) v1 += INT_MAX
            if (v1 < 0) v1 += INT_MAX
            const v2 = iy & 0x1f
            const v3 = iv[v2]
            iv[v2] = v1
            iy = v3
            idum = v1
            return v3 % max
        },
        // random.cc randomBetween
        between(min, max) {
            let result = min <= max ? min + this.getRandom(max - min + 1) : max + this.getRandom(min - max + 1)
            if (result < min || result > max) result = min
            return result
        },
    }
}

test('the reference generator step is the Park-Miller minimal standard', () => {
    // Park & Miller (CACM 1988): from seed 1, the 10,000th value is 1043618065. getRandom's step
    // (Schrage's method) must reproduce it.
    let x = 1
    for (let i = 0; i < 10000; i++) {
        x = 16807 * (x % 127773) - 2836 * cdiv(x, 127773)
        if (x < 0) x += INT_MAX
    }
    assert.equal(x, 1043618065)
})

test('the first draw after a fresh seed is 0 (CE: _iy starts at the unwritten _iv[0])', () => {
    // random.cc randomSeedPrerandomInternal fills _iv[31..1] only; _iy = _iv[0] = 0, so the first
    // getRandom returns _iv[0] % max = 0
    randomSeedExact(12345)
    assert.equal(randomBetween(1, 100), 1)
    randomSeedExact(1)
    assert.equal(randomBetween(0, 9), 0)
})

test('raw draws match CE random.cc draw for draw', () => {
    // randomBetween(0, INT_MAX - 1): getRandom(INT_MAX) returns the shuffle-table entry unreduced
    for (const seed of [1, 42, 12345, 987654321]) {
        const ce = ceRandom()
        ce.seed(seed)
        randomSeedExact(seed)
        for (let i = 0; i < 2000; i++) {
            assert.equal(randomBetween(0, INT_MAX - 1), ce.between(0, INT_MAX - 1), `seed ${seed} draw ${i}`)
        }
    }
})

test('dice ranges match CE random.cc randomBetween', () => {
    const ce = ceRandom()
    ce.seed(777)
    randomSeedExact(777)
    for (let i = 0; i < 5000; i++) {
        const [min, max] = [[1, 100], [1, 6], [-5, 5], [0, 0], [3, 18]][i % 5]
        const v = randomBetween(min, max)
        assert.equal(v, ce.between(min, max))
        assert.ok(v >= min && v <= max)
    }
})

test('reversed bounds always give min (CE randomBetween range check)', () => {
    // random.cc randomBetween(10, 1): result = 1 + getRandom(10) is 1..10; result < 10 or
    // result > 1 holds for every one of them, so the range check sets result = min = 10
    randomSeedExact(5)
    for (let i = 0; i < 200; i++) assert.equal(randomBetween(10, 1), 10)
})

test('reseeding keeps _iv[0] from before, as CE randomSeedPrerandom does', () => {
    // random.cc randomSeedPrerandomInternal never writes _iv[0]: reseeding mid-game continues
    // from whatever the previous draws left there
    const ce = ceRandom()
    ce.seed(99)
    randomSeedExact(99)
    for (let i = 0; i < 37; i++) assert.equal(randomBetween(1, 1000), ce.between(1, 1000))
    ce.seed(4242)
    randomSeedPrerandom(4242)
    for (let i = 0; i < 500; i++) assert.equal(randomBetween(1, 1000), ce.between(1, 1000), `draw ${i}`)
})
