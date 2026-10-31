// gametime.ts against fallout2-ce scripts.cc (gameTimeGetDate, gameTimeGetHour,
// gameTimeGetTimeString), scripts.h (tick constants) and sfall_config.cc (start date defaults).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as GameTime from '../js/gametime.js'
import globalState from '../js/globalState.js'
import { ceSource, cdiv } from './support/ce.mjs'

// sfall_config.cc sfallConfigInit defaults: START_YEAR 2241, START_MONTH 6, START_DAY 24 (0-based)
const CE_START_YEAR = 2241
const CE_START_MONTH = 6
const CE_START_DAY = 24
// scripts.cc gGameTimeDaysPerMonth
const CE_DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const TICKS_PER_DAY = 864000

/** scripts.cc gameTimeGetDate, transliterated (C int division); returns 1-based month and day. */
function ceGameTimeGetDate(gameTime) {
    let year = cdiv(cdiv(gameTime, TICKS_PER_DAY) + CE_START_DAY, 365) + CE_START_YEAR
    let month = CE_START_MONTH
    let day = (cdiv(gameTime, TICKS_PER_DAY) + CE_START_DAY) % 365
    for (;;) {
        const daysInMonth = CE_DAYS_PER_MONTH[month]
        if (day < daysInMonth) break
        month++
        day -= daysInMonth
        if (month === 12) {
            year++
            month = 0
        }
    }
    return { month: month + 1, day: day + 1, year }
}

function withTime(ticks, fn) {
    const saved = globalState.gameTickTime
    globalState.gameTickTime = ticks
    try {
        return fn()
    } finally {
        globalState.gameTickTime = saved
    }
}

test('tick constants match CE scripts.h', () => {
    const h = ceSource('scripts.h')
    const define = (name) => Number(h.match(new RegExp(`#define ${name} \\(?(\\d+)\\)?`))[1])
    assert.equal(GameTime.TICKS_PER_HOUR, define('GAME_TIME_TICKS_PER_HOUR'))
    assert.equal(GameTime.TICKS_PER_DAY, define('GAME_TIME_TICKS_PER_DAY'))
    assert.equal(GameTime.TICKS_PER_YEAR, define('GAME_TIME_TICKS_PER_YEAR'))
})

test('the start date is CE sfall_config.cc default: 25 July 2241', () => {
    // gameTimeGetDate(0): day (0 + 24) % 365 = 24 in July -> 1-based day 25, month 7
    assert.deepEqual(ceGameTimeGetDate(0), { month: 7, day: 25, year: 2241 })
    const d = GameTime.getDate(0)
    assert.deepEqual({ month: d.month + 1, day: d.day, year: d.year }, { month: 7, day: 25, year: 2241 })
})

test('dates across month and year ends (hand-checked from scripts.cc gameTimeGetDate)', () => {
    // day 7: (7 + 24) % 365 = 31 -> July (31) -> 0 in August -> 1 August 2241
    // day 160: 184 -> Jul 31, Aug 31, Sep 30, Oct 31, Nov 30, Dec 31 -> month 12 wraps -> 1 January 2242
    // day 341: (341 + 24) / 365 = 1 -> 2242, % 365 = 0 -> 1 July 2242
    const cases = [[7, 8, 1, 2241], [160, 1, 1, 2242], [341, 7, 1, 2242]]
    for (const [days, month, day, year] of cases) {
        const d = GameTime.getDate(days * TICKS_PER_DAY)
        assert.deepEqual({ month: d.month + 1, day: d.day, year: d.year }, { month, day, year }, `day ${days}`)
    }
})

test('getDate agrees with CE gameTimeGetDate for every day of ten years', () => {
    for (let days = 0; days < 3650; days++) {
        const ticks = days * TICKS_PER_DAY + 12345
        const d = GameTime.getDate(ticks)
        assert.deepEqual({ month: d.month + 1, day: d.day, year: d.year }, ceGameTimeGetDate(ticks), `day ${days}`)
    }
})

test('game_time_hour matches CE scripts.cc gameTimeGetHour', () => {
    // scripts.cc gameTimeGetHour: 100 * ((t / 600) / 60 % 24) + (t / 600) % 60
    const ceHour = (t) => 100 * (cdiv(cdiv(t, 600), 60) % 24) + (cdiv(t, 600) % 60)
    assert.equal(ceHour(302400), 824) // the new-game start time, 8:24
    for (const t of [0, 302400, 599, 600, 35999, 36000, 863999, 864000, 1234567, 98765432]) {
        withTime(t, () => assert.equal(GameTime.getHourMilitary(), ceHour(t), `tick ${t}`))
    }
})

test('time string matches CE scripts.cc gameTimeGetTimeString ("%d:%02d")', () => {
    withTime(GameTime.START_TICKS, () => assert.equal(GameTime.getTimeString(), '8:24'))
    // 20:05 = (20*60 + 5) minutes * 600 ticks
    withTime((20 * 60 + 5) * 600, () => assert.equal(GameTime.getTimeString(), '20:05'))
    withTime(TICKS_PER_DAY - 1, () => assert.equal(GameTime.getTimeString(), '23:59'))
})
