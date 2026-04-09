/*
Copyright 2014 darkf

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
*/

// Central game-time module. Fallout 2 stores time as a tick counter where
// one tick is 1/10 second; constants and the start time below come from the
// reference implementation at
// https://github.com/alexbatalov/fallout2-ce (scripts.h / scripts.cc).
//
// Authoritative backing store: globalState.gameTickTime (an existing field).
// This module wraps reads and writes so callers never have to know the tick
// math, and adds a day/night ambient-light curve used by the renderer.

import globalState from './globalState.js'

// --- Tick constants (all match fallout2-ce) ---
export const TICKS_PER_SECOND = 10
export const TICKS_PER_MINUTE = 600         // 60 * 10
export const TICKS_PER_HOUR = 36000         // 60 * 60 * 10
export const TICKS_PER_DAY = 864000         // 24 * 36000
export const TICKS_PER_YEAR = 315360000     // 365 * 864000

// --- Starting date ---
// Fallout 2 starts 302400 ticks in (= 8 hours 24 minutes), on July 25, 2241.
// DarkHarold2 previously treated month index 7 as the start month in
// pipboy.ts (0-indexed => August). We keep that convention so existing
// saves / display code don't shift a month.
export const START_TICKS = 302400            // 8:24 AM
export const START_DAY = 25
export const START_MONTH = 7                 // 0-indexed (August)
export const START_YEAR = 2241

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// --- Light constants (match fallout2-ce light.h) ---
export const LIGHT_INTENSITY_MIN = 65536 / 4  // 16384
export const LIGHT_INTENSITY_MAX = 65536

// Script-controlled override. Scripts (set_light_level opcode) can force
// darkness or full brightness regardless of the time-of-day curve.
// null = no override, use the hour-of-day curve.
let lightLevelOverride: number | null = null

// Initialize game time once at startup. Called from init.ts. We preserve
// any pre-existing value (non-zero) in case a save was already loaded.
export function initGameTime(): void {
    if (globalState.gameTickTime <= 0) {
        globalState.gameTickTime = START_TICKS
    }
}

// --- Queries ---

export function getTime(): number {
    return globalState.gameTickTime
}

export function setTime(ticks: number): void {
    globalState.gameTickTime = Math.max(1, ticks)
}

// Total elapsed seconds / minutes / hours / days since Jan 1 of year 1 of
// the game world. These are monotonic; they are not the "hour of day".
export function getTotalSeconds(): number { return Math.floor(globalState.gameTickTime / TICKS_PER_SECOND) }
export function getTotalMinutes(): number { return Math.floor(globalState.gameTickTime / TICKS_PER_MINUTE) }
export function getTotalHours(): number { return Math.floor(globalState.gameTickTime / TICKS_PER_HOUR) }
export function getTotalDays(): number { return Math.floor(globalState.gameTickTime / TICKS_PER_DAY) }

// Hour of day (0..23).
export function getHour(): number {
    return Math.floor(getTotalMinutes() / 60) % 24
}

// Minute within hour (0..59).
export function getMinute(): number {
    return getTotalMinutes() % 60
}

// Fallout-2-style combined military-format time: 0..2359. "8:24 AM" => 824.
// This matches `gameTimeGetHour()` in the reference implementation, which
// scripts read via the game_time_hour intrinsic.
export function getHourMilitary(): number {
    return 100 * getHour() + getMinute()
}

// In-game day counter, starting at 1 on day one.
export function getDay(): number {
    return getTotalDays() + 1
}

// Full broken-down date. Walks forward from the start date using the
// real-world month-length table. Leap years are ignored (same as the
// original).
export interface GameDate {
    day: number       // 1..31
    month: number     // 0..11
    year: number
    hours: number     // 0..23
    minutes: number   // 0..59
}
export function getDate(): GameDate {
    const totalDays = getTotalDays()
    let year = START_YEAR
    let month = START_MONTH
    let day = START_DAY + totalDays
    while (day > DAYS_IN_MONTH[month]) {
        day -= DAYS_IN_MONTH[month]
        month++
        if (month >= 12) {
            month = 0
            year++
        }
    }
    return { day, month, year, hours: getHour(), minutes: getMinute() }
}

// "8:24 AM" style, for the PipBoy STATUS tab.
export function getTimeString(): string {
    const h = getHour()
    const m = getMinute()
    const suffix = h < 12 ? 'AM' : 'PM'
    const h12 = h === 0 ? 12 : (h > 12 ? h - 12 : h)
    return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

// "Aug 25, 2241" style.
export function getDateString(): string {
    const d = getDate()
    return `${MONTH_NAMES[d.month]} ${d.day}, ${d.year}`
}

// --- Time advance ---

export function advanceTicks(ticks: number): void {
    if (ticks <= 0) return
    globalState.gameTickTime += ticks
}
export function advanceSeconds(seconds: number): void { advanceTicks(seconds * TICKS_PER_SECOND) }
export function advanceMinutes(minutes: number): void { advanceTicks(minutes * TICKS_PER_MINUTE) }
export function advanceHours(hours: number): void { advanceTicks(hours * TICKS_PER_HOUR) }

// --- Day / night ambient light curve ---
//
// Fallout 2 doesn't ship an automatic day/night cycle — maps load at
// LIGHT_INTENSITY_MAX and scripts manually call set_light_level when they
// want darkness. For DarkHarold2 we derive a continuous light curve from
// the hour of day using a piecewise-linear ramp between the reference
// implementation's LIGHT_INTENSITY_MIN and LIGHT_INTENSITY_MAX:
//
//   00:00 ─┐
//          │  night (min)
//   05:00 ─┤
//            \_ dawn ramp
//   07:00 ─┐
//          │  day (max)
//   18:00 ─┤
//            \_ dusk ramp
//   20:00 ─┐
//          │  night (min)
//   24:00 ─┘
//
// Scripts can call set_light_level to force a fixed value, which overrides
// the curve until the next map load or the script releases it.

interface LightStop { hour: number; intensity: number }
const LIGHT_CURVE: LightStop[] = [
    { hour: 0,  intensity: LIGHT_INTENSITY_MIN },
    { hour: 5,  intensity: LIGHT_INTENSITY_MIN },
    { hour: 7,  intensity: LIGHT_INTENSITY_MAX },
    { hour: 18, intensity: LIGHT_INTENSITY_MAX },
    { hour: 20, intensity: LIGHT_INTENSITY_MIN },
    { hour: 24, intensity: LIGHT_INTENSITY_MIN },
]

function curveAt(hourFloat: number): number {
    for (let i = 0; i < LIGHT_CURVE.length - 1; i++) {
        const a = LIGHT_CURVE[i]
        const b = LIGHT_CURVE[i + 1]
        if (hourFloat >= a.hour && hourFloat <= b.hour) {
            if (b.hour === a.hour) return a.intensity
            const t = (hourFloat - a.hour) / (b.hour - a.hour)
            return a.intensity + t * (b.intensity - a.intensity)
        }
    }
    return LIGHT_INTENSITY_MAX
}

// Ambient light intensity in the same 0..65536 range Fallout 2 uses. Takes
// the script override into account.
export function getAmbientLight(): number {
    if (lightLevelOverride !== null) return lightLevelOverride
    const hourFloat = getHour() + getMinute() / 60
    return curveAt(hourFloat)
}

// 0..1 for the GL fragment shader.
export function getAmbientLightNormalized(): number {
    return getAmbientLight() / LIGHT_INTENSITY_MAX
}

// Called by the scripting intrinsic `set_light_level(level)`. Fallout 2
// passes 0..100; we map that across the min..max intensity range.
export function setLightLevelOverride(level0to100: number): void {
    const clamped = Math.max(0, Math.min(100, level0to100))
    const t = clamped / 100
    lightLevelOverride = LIGHT_INTENSITY_MIN + t * (LIGHT_INTENSITY_MAX - LIGHT_INTENSITY_MIN)
}

export function clearLightLevelOverride(): void {
    lightLevelOverride = null
}

// --- Schedule helpers (NPC sleep / shop open hours) ---
//
// These are used by scripting and by the UI layer to gate interactions
// like talking to a shopkeeper at 3 AM.

// NPCs sleep at night by default. Roughly matches the ambient-light curve
// so the "asleep" window aligns with "it's dark".
const NIGHT_START_HOUR = 22
const NIGHT_END_HOUR = 6
export function isNightTime(): boolean {
    const h = getHour()
    return h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR
}

// Typical Fallout 2 shop hours: open 9 AM to 6 PM.
const SHOP_OPEN_HOUR = 9
const SHOP_CLOSE_HOUR = 18
export function isShopOpen(): boolean {
    const h = getHour()
    return h >= SHOP_OPEN_HOUR && h < SHOP_CLOSE_HOUR
}
