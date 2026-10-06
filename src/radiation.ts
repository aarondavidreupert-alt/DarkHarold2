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

// Radiation sickness — port of fallout2-ce critter.cc:
//   critterAdjustRadiation()   (critter.cc:412)  — dose intake (resistance, geiger, messages)
//   _critter_check_rads()      (critter.cc:495)  — nightly check (scripts.cc:424 at midnight)
//   _process_rads()            (critter.cc:639)  — apply / remove stat penalties
//   radiationEventProcess()    (critter.cc:695)  — damage event, schedules 7-day recovery
// Only the player (gDude) accumulates radiation in CE.

import globalState from './globalState.js'
import { dbg } from './logger.js'
import type { Critter } from './object.js'
import { Scripting } from './scripting.js'
import { critterKill } from './critter/lifecycle.js'
import { uiLog, updateIndicatorBar } from './ui_hud.js'
import { getMessage, getRandomInt } from './util.js'

const TICKS_PER_HOUR = 36000 // CE GAME_TIME_TICKS_PER_HOUR (10 ticks/s)
const TICKS_PER_DAY = 24 * TICKS_PER_HOUR

const PROTO_ID_GEIGER_COUNTER_I = 52
const PROTO_ID_GEIGER_COUNTER_II = 207

// CE critter.cc:91 gRadiationEnduranceModifiers[RADIATION_LEVEL_COUNT]
const RADIATION_ENDURANCE_MODIFIERS = [2, 0, -2, -4, -6, -8]

// CE critter.cc:107 gRadiationEffectStats — primary stats first (6 of them).
const RADIATION_EFFECT_STATS = ['STR', 'PER', 'END', 'CHA', 'INT', 'AGI', 'HP', 'Healing Rate']
const RADIATION_EFFECT_PRIMARY_STAT_COUNT = 6

// CE critter.cc:125 gRadiationEffectPenalties[level][effect]
const RADIATION_EFFECT_PENALTIES: number[][] = [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [-1, 0, 0, 0, 0, 0, 0, 0],
    [-1, 0, 0, 0, 0, -1, 0, -3],
    [-2, 0, -1, 0, 0, -2, -5, -5],
    [-4, -3, -3, -3, -1, -5, -15, -10],
    [-6, -5, -5, -5, -3, -6, -20, -10],
]

const RADIATION_EVENT_TAG = 'radiation:' // userdata: `radiation:<level>:<isHealing 0|1>`

function miscMsg(id: number): string | null {
    return getMessage('misc', id)
}

function isPlayer(obj: Critter): boolean {
    return obj === globalState.player
}

// CE critter.cc:412 critterAdjustRadiation
export function critterAdjustRadiation(obj: Critter, amount: number): void {
    if (!isPlayer(obj)) return

    if (amount > 0) {
        const resist = obj.getStat('DR Radiation')
        amount -= Math.trunc(resist * amount / 100)
    }

    if (amount > 0) {
        obj.radiated = true // CE: proto->critter.data.flags |= CRITTER_RADIATED

        const hands = [obj.leftHand, obj.rightHand]
        const geiger = hands.find((it) => it && (it.pid === PROTO_ID_GEIGER_COUNTER_I || it.pid === PROTO_ID_GEIGER_COUNTER_II))
        if (geiger && geiger.miscOn === true) {
            // 1009 "The geiger counter is clicking wildly." / 1008 "...is clicking."
            const msg = miscMsg(amount > 5 ? 1009 : 1008)
            if (msg) uiLog(msg)
        }
    }

    if (amount >= 10) {
        const msg = miscMsg(1007) // "You have received a large dose of radiation."
        if (msg) uiLog(msg)
    }

    obj.radiationLevel = Math.max(0, (obj.radiationLevel ?? 0) + amount)
    updateIndicatorBar()
}

function radiationLevelFor(radiation: number): number {
    if (radiation > 999) return 5 // FATAL
    if (radiation > 599) return 4 // DEADLY
    if (radiation > 399) return 3 // CRITICAL
    if (radiation > 199) return 2 // ADVANCED
    if (radiation > 99) return 1 // MINOR
    return 0
}

function parseRadiationEvent(userdata: any): { level: number; isHealing: boolean } | null {
    if (typeof userdata !== 'string' || !userdata.startsWith(RADIATION_EVENT_TAG)) return null
    const [level, healing] = userdata.slice(RADIATION_EVENT_TAG.length).split(':').map(Number)
    return { level, isHealing: healing === 1 }
}

function scheduleRadiationEvent(obj: Critter, ticks: number, level: number, isHealing: boolean): void {
    const userdata = `${RADIATION_EVENT_TAG}${level}:${isHealing ? 1 : 0}`
    Scripting.timeEventList.push({ obj, ticks, userdata, fn: () => radiationEventProcess(obj, level, isHealing) })
}

// Re-arm a radiation event read from a save (saveload.ts). Returns false if `userdata`
// isn't a radiation event.
export function restoreRadiationEvent(obj: Critter, ticks: number, userdata: any): boolean {
    const ev = parseRadiationEvent(userdata)
    if (!ev) return false
    scheduleRadiationEvent(obj, ticks, ev.level, ev.isHealing)
    return true
}

// CE critter.cc:495 _critter_check_rads — run once per game midnight (scripts.cc:424).
export function checkRads(obj: Critter): void {
    if (!isPlayer(obj) || !obj.radiated) return

    // CE: _queue_clear_type(EVENT_TYPE_RADIATION, _get_rad_damage_level) keeps every
    // queued radiation event and leaves _old_rad_level = the last one's level.
    let oldRadLevel = 0
    for (const e of Scripting.timeEventList) {
        const ev = e.obj === obj ? parseRadiationEvent(e.userdata) : null
        if (ev) oldRadLevel = ev.level
    }

    let level = radiationLevelFor(obj.radiationLevel ?? 0)
    // CE stat.cc:708 statRoll — d10 (PRIMARY_STAT_MIN..MAX) vs END + modifier.
    const roll = getRandomInt(1, 10)
    if (roll > obj.getStat('END') + RADIATION_ENDURANCE_MODIFIERS[level]) level++

    if (level > oldRadLevel) {
        scheduleRadiationEvent(obj, TICKS_PER_HOUR * getRandomInt(4, 18), level, false)
        dbg('script', `[Radiation] level ${level} sickness scheduled (rads=${obj.radiationLevel})`)
    }

    obj.radiated = false
}

// CE critter.cc:639 _process_rads
function processRads(obj: Critter, level: number, isHealing: boolean): void {
    if (level === 0) return
    // CE indexes the penalty table with level - 1 (critter.cc:647), so FATAL (5)
    // uses row 4 and row 5 is only reachable via the END-roll bump (level 6 → row 5).
    const row = RADIATION_EFFECT_PENALTIES[Math.min(level - 1, RADIATION_EFFECT_PENALTIES.length - 1)]
    const modifier = isHealing ? -1 : 1

    if (isPlayer(obj)) {
        // 1000+n: escalating sickness text; SFALL fix: 3003 "You feel better." on recovery.
        const msg = miscMsg(isHealing ? 3003 : 1000 + level - 1)
        if (msg) uiLog(msg)
    }

    for (let i = 0; i < RADIATION_EFFECT_STATS.length; i++) {
        const delta = modifier * row[i]
        if (delta !== 0) obj.stats.modifyBase(RADIATION_EFFECT_STATS[i], delta)
    }

    // SFALL fix kept by CE: removing the effects can never kill.
    if (!isHealing && !obj.dead) {
        for (let i = 0; i < RADIATION_EFFECT_PRIMARY_STAT_COUNT; i++) {
            if (obj.stats.getBase(RADIATION_EFFECT_STATS[i]) < 1) { // PRIMARY_STAT_MIN
                critterKill(obj)
                break
            }
        }
        if (!obj.dead && obj.getStat('HP') <= 0) critterKill(obj)
    }

    if (obj.dead && isPlayer(obj)) {
        const msg = miscMsg(1006) // "You have died from radiation sickness."
        if (msg) uiLog(msg)
    }
}

// CE critter.cc:695 radiationEventProcess
function radiationEventProcess(obj: Critter, level: number, isHealing: boolean): void {
    if (!isHealing) {
        // CE: _queue_clear_type(EVENT_TYPE_RADIATION, _clear_rad_damage) — drop every
        // other queued radiation event, undoing pending recoveries first.
        // Neutralised in place rather than spliced: this runs from inside the
        // gameTick timed-event loop, which splices by index after fn() returns.
        for (const e of Scripting.timeEventList) {
            const ev = e.obj === obj ? parseRadiationEvent(e.userdata) : null
            if (!ev || e.ticks <= 0) continue // ticks <= 0: the event being processed now
            if (ev.isHealing) processRads(obj, ev.level, true)
            e.userdata = 'radiation-cancelled'
            e.fn = () => {}
            e.ticks = 1
        }
        scheduleRadiationEvent(obj, TICKS_PER_DAY * 7, level, true)
    }
    processRads(obj, level, isHealing)
}
