// Random number generation — port of fallout2-ce random.cc.
//
// CE uses a Park-Miller "minimal standard" generator with a 32-entry shuffle
// table (getRandom, random.cc:104), seeded from the C runtime's rand() after
// srand(timeGetTime()) (randomInit, random.cc:31), and runs a 100,000-sample
// chi-squared self-test on start-up (randomValidatePrerandom, random.cc:225).
// This replaces DH2's old sin()-based Math.random override (RN5).

import { dbg, dbgWarn } from './logger.js'

let _iy = 0
const _iv = new Int32Array(32)
let _idum = 1

// MSVC CRT rand(): 15-bit LCG — what CE's randomInt32() returns on Windows builds.
let _crtHoldRand = 1
function crtSrand(seed: number): void {
    _crtHoldRand = seed >>> 0
}
function crtRand(): number {
    _crtHoldRand = (Math.imul(_crtHoldRand, 214013) + 2531011) >>> 0
    return (_crtHoldRand >>> 16) & 0x7fff
}

// CE random.cc:104 getRandom — returns 0..max-1
function getRandom(max: number): number {
    let v1 = 16807 * (_idum % 127773) - 2836 * Math.trunc(_idum / 127773)
    if (v1 < 0) v1 += 0x7fffffff
    if (v1 < 0) v1 += 0x7fffffff

    const v2 = _iy & 0x1f
    const v3 = _iv[v2]
    _iv[v2] = v1
    _iy = v3
    _idum = v1
    return v3 % max
}

// CE random.cc:136 randomSeedPrerandomInternal. NOTE: the loop never writes
// _iv[0] (index runs 40..1), so _iy starts at 0 — reproduced as-is.
function seedPrerandomInternal(seed: number): void {
    let num = seed < 1 ? 1 : seed
    for (let index = 40; index > 0; index--) {
        num = 16807 * (num % 127773) - 2836 * Math.trunc(num / 127773)
        if (num < 0) num &= 0x7fffffff
        if (index < 32) _iv[index] = num
    }
    _iy = _iv[0]
    _idum = num
}

/** CE random.cc:87 randomBetween — inclusive on both ends. */
export function randomBetween(min: number, max: number): number {
    let result: number
    if (min <= max) result = min + getRandom(max - min + 1)
    else result = max + getRandom(min - max + 1)
    if (result < min || result > max) {
        dbgWarn('script', `Random number ${result} is not in range ${min} to ${max}`)
        result = min
    }
    return result
}

/** CE random.cc:122 randomSeedPrerandom — `-1` reseeds from the CRT generator. */
export function randomSeedPrerandom(seed: number): void {
    if (seed === -1) seed = crtRand()
    seedPrerandomInternal(seed)
}

// CE random.cc:225 randomValidatePrerandom — chi-squared over 25 buckets.
function validatePrerandom(): void {
    const results = new Array<number>(25).fill(0)
    for (let i = 0; i < 100000; i++) results[randomBetween(1, 25) - 1]++
    let chi = 0
    for (const r of results) chi += (r - 4000) * (r - 4000) / 4000
    if (chi < 36.42) dbg('script', `[Random] Chi squared is ${chi.toFixed(3)}: sequence is random, 95% confidence.`)
    else dbgWarn('script', `[Random] Chi squared is ${chi.toFixed(3)}: warning! sequence is not random, 95% confidence.`)
}

/** CE random.cc:31 randomInit — `timeMs` stands in for compat_timeGetTime(). */
export function randomInit(timeMs: number = Date.now()): void {
    crtSrand(timeMs)
    seedPrerandomInternal(crtRand())
    validatePrerandom()
}

randomInit()
