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
import { dbg } from './logger.js'

// --- Tick constants (all match fallout2-ce) ---
export const TICKS_PER_SECOND = 10
export const TICKS_PER_MINUTE = 600         // 60 * 10
export const TICKS_PER_HOUR = 36000         // 60 * 60 * 10
export const TICKS_PER_DAY = 864000         // 24 * 36000
export const TICKS_PER_YEAR = 315360000     // 365 * 864000

// --- Starting date ---
// Fallout 2 starts 302400 ticks in (= 8 hours 24 minutes), on July 25, 2241.
// CE ref: sfall_config.cc:31 gStartMonth = 6 (0-indexed = July).
export const START_TICKS = 302400            // 8:24 AM
export const START_DAY = 25
export const START_MONTH = 6                 // 0-indexed (July); CE sfall_config.cc:31
export const START_YEAR = 2241

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// --- Light constants (match fallout2-ce light.h) ---
export const LIGHT_INTENSITY_MIN = 65536 / 4  // 16384
export const LIGHT_INTENSITY_MAX = 65536

// Night floor used by the day/night curve. Decoupled from LIGHT_INTENSITY_MIN
// (which is the engine-wide floor fallout2-ce uses for set_light_level
// mapping) so we can keep nights visible without affecting the script
// intrinsic's 0..100 range. 0.35 * MAX ≈ 22937.

// Script-controlled override. Scripts (set_light_level opcode) can force
// darkness or full brightness regardless of the time-of-day curve.
// null = no override, use the hour-of-day curve.

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
    const before = globalState.gameTickTime
    globalState.gameTickTime = Math.max(1, ticks)
    const delta = globalState.gameTickTime - before
    if (delta > 0) timeJumpHandler?.(delta)
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

// CE's event queue stores absolute due-times, so any clock jump (rest, travel,
// game_time_advance, skill time costs) fires whatever became overdue. DH2's timed
// events count down per tick instead; gameTick.ts registers this hook to drain
// them (and run each crossed midnight) whenever the clock jumps.
let timeJumpHandler: ((deltaTicks: number) => void) | null = null
export function setTimeJumpHandler(fn: (deltaTicks: number) => void): void {
    timeJumpHandler = fn
}

export function advanceTicks(ticks: number): void {
    if (ticks <= 0) return
    globalState.gameTickTime += ticks
    timeJumpHandler?.(ticks)
}
export function advanceSeconds(seconds: number): void { advanceTicks(seconds * TICKS_PER_SECOND) }
export function advanceMinutes(minutes: number): void { advanceTicks(minutes * TICKS_PER_MINUTE) }
export function advanceHours(hours: number): void { advanceTicks(hours * TICKS_PER_HOUR) }

// --- Ambient light ---
//
// CE ref: light.cc gAmbientIntensity / lightSetAmbientIntensity. Fallout 2 has no
// engine day/night cycle: every map load resets ambient to LIGHT_INTENSITY_MAX
// (map.cc:927) and map scripts set darkness / time-of-day lighting themselves via
// set_light_level (their map_update_p_proc "Lighting" macros key off
// game_time_hour). The DH2-invented hour curve that used to live here (GTC10) was
// removed 2026-10-06.

let ambientIntensity = LIGHT_INTENSITY_MAX

// CE light.cc:48 lightSetAmbientIntensity — adds the Night Vision bonus
// (LIGHT_LEVEL_NIGHT_VISION_BONUS = 65536/5 per rank) and clamps to MIN..MAX.
function setAmbientIntensity(intensity: number): void {
    const nightVision = (globalState.player?.perks ?? []).filter((p: string) => p === 'Night Vision').length
    const adjusted = intensity + nightVision * Math.trunc(65536 / 5)
    ambientIntensity = Math.max(LIGHT_INTENSITY_MIN, Math.min(LIGHT_INTENSITY_MAX, adjusted))
}

// Ambient light intensity in Fallout 2's 0..65536 range.
export function getAmbientLight(): number {
    return ambientIntensity
}

// 0..1 for the GL fragment shader.
export function getAmbientLightNormalized(): number {
    return getAmbientLight() / LIGHT_INTENSITY_MAX
}

// Called by the scripting intrinsic `set_light_level(level)`. Fallout 2
// passes 0..100; we map that across the min..max intensity range.
// CE ref: interpreter_extra.cc:2233 opSetLightLevel — no outdoor guard in CE.
// Called by the scripting intrinsic `set_light_level(level)`.
// CE ref: interpreter_extra.cc:2233 opSetLightLevel — piecewise mapping over
// intensities = [MIN, (MIN+MAX)/2, MAX] = [16384, 40960, 65536]; no clamp of the
// 0..100 input (lightSetAmbientIntensity clamps the result).
export function setLightLevelOverride(level0to100: number): void {
    const mid = (LIGHT_INTENSITY_MIN + LIGHT_INTENSITY_MAX) / 2 // 40960
    const data = level0to100
    let intensity: number
    if (data === 50) {
        intensity = mid
    } else if (data > 50) {
        intensity = Math.trunc(mid + data * (LIGHT_INTENSITY_MAX - mid) / 100)
    } else {
        intensity = Math.trunc(LIGHT_INTENSITY_MIN + data * (mid - LIGHT_INTENSITY_MIN) / 100)
    }
    setAmbientIntensity(intensity)
    dbg('script', `[lighting] set_light_level(${level0to100}) -> ambient=${(ambientIntensity / LIGHT_INTENSITY_MAX).toFixed(3)}`)
}

// CE ref: map.cc:927 — ambient light resets to maximum on every map load.
export function clearLightLevelOverride(): void {
    setAmbientIntensity(LIGHT_INTENSITY_MAX)
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
