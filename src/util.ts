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

import { loadMessage } from './data.js'
import { world } from './state/world.js'
import { assets } from './state/assets.js'
import { dbgWarn } from './logger.js'
import { randomBetween } from './random.js'
import { assetUrl } from './modAssets.js'
import { prefetched, prefetchedText, prefetchFiles } from './fileCache.js'

// Utility functions

/** Fetch files ahead of time for the synchronous loaders below (fileCache.ts), each as
 *  assetUrl resolves it (an active mod's copy first). */
export function prefetchAssets(paths: string[]): Promise<void> {
    return prefetchFiles(paths, assetUrl)
}

/** Whether a file the page could load exists (prefetched, else a synchronous HEAD request). */
export function fileExistsSync(path: string): boolean {
    const file = prefetched(path)
    if (file) {
        return file.status >= 200 && file.status < 300
    }
    try {
        const xhr = new XMLHttpRequest()
        xhr.open('HEAD', assetUrl(path), false)
        xhr.send()
        return xhr.status >= 200 && xhr.status < 300
    } catch (_) {
        return false
    }
}

export function parseIni(text: string) {
    // Parse a .ini-style categorized key-value format
    const ini: { [category: string]: any } = {}
    const lines = text.split('\n').map((l) => l.replace(/\r$/, ''))
    let category = null

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/\s*;.*/, '') // replace comments
        if (line.trim() === '') {
        } else if (line[0] === '[') category = line.trim().slice(1, -1)
        else {
            // key=value (value may be empty)
            const eqIdx = line.indexOf('=')
            if (eqIdx === -1) {
                // MAPS.TXT has one of these, so it's not an exception
                dbgWarn('script', `warning: parseIni: not a key=value line: ${line}`)
                continue
            }
            if (category === null) throw new Error('parseIni: key=value not in category: ' + line)

            const key = line.slice(0, eqIdx).trim()
            const val = line.slice(eqIdx + 1).trim() // may be empty string — that's valid
            if (ini[category] === undefined) ini[category] = {}
            ini[category][key] = val
        }
    }

    return ini
}

export function getFileText(path: string, err?: () => void): string {
    const file = prefetched(path)
    if (file) {
        if (file.status !== 200) {
            throw Error(`getFileText: got status ${file.status} when requesting '${path}'`)
        }
        return prefetchedText(file)
    }
    const xhr = new XMLHttpRequest()
    xhr.open('GET', assetUrl(path), false) // an active mod's copy first (modAssets.ts)
    xhr.send(null)
    if (xhr.status !== 200) throw Error(`getFileText: got status ${xhr.status} when requesting '${path}'`)

    return xhr.responseText
}

export function getFileJSON(path: string, err?: () => void): any {
    return JSON.parse(getFileText(path, err))
}

export function getFileBinarySync(path: string) {
    const file = prefetched(path)
    if (file) {
        if (file.status !== 200) {
            throw Error(`getFileBinarySync: got status ${file.status} when requesting '${path}'`)
        }
        return new DataView(file.bytes.slice().buffer) // a copy, as each request gave
    }

    // Synchronous requests aren't allowed by browsers to define response types
    // in a misguided attempt to force developers to switch to asynchronous requests,
    // so we transfer as a user-defined charset and then decode it manually.

    const xhr = new XMLHttpRequest()
    xhr.open('GET', assetUrl(path), false)
    // Tell browser not to mess with the response type/encoding
    xhr.overrideMimeType('text/plain; charset=x-user-defined')
    xhr.send(null)

    if (xhr.status !== 200) throw Error(`getFileBinarySync: got status ${xhr.status} when requesting '${path}'`)

    // Convert to ArrayBuffer, and then to DataView
    const data = xhr.responseText
    const buffer = new ArrayBuffer(data.length)
    const arr = new Uint8Array(buffer)

    for (let i = 0; i < data.length; i++) arr[i] = data.charCodeAt(i) & 0xff

    return new DataView(buffer)
}

// Min inclusive, max inclusive — CE random.cc:87 randomBetween (Park-Miller, src/random.ts)
export function getRandomInt(min: number, max: number) {
    return randomBetween(min, max)
}

export function rollSkillCheck(skill: number, modifier: number, isBounded: boolean) {
    const tempSkill = skill + modifier
    const bounded = isBounded ? clamp(0, 95, tempSkill) : tempSkill // (result was previously discarded)

    // CE ref: random.cc:87 randomBetween(1, 100) — range is [1,100], not [0,100]
    const roll = getRandomInt(1, 100)
    return roll <= bounded
}

// FO2-CE ref: random.h — Roll enum
export enum RollResult {
    CriticalFailure = 0,
    Failure = 1,
    Success = 2,
    CriticalSuccess = 3,
}

// FO2-CE ref: random.cc randomRoll() + randomTranslateRoll()
// difficulty = effective skill value + modifier
// criticalSuccessModifier = critter's Critical Chance stat
// Returns: { roll: RollResult, delta: number }
//   delta = difficulty - d100 (positive = success margin, negative = failure margin)
export function randomRoll(difficulty: number, criticalSuccessModifier: number): { roll: RollResult; delta: number } {
    const delta = difficulty - getRandomInt(1, 100)
    // CE random.cc:58 randomTranslateRoll — criticals are only possible once the game
    // clock has passed its first full day (gameTimeGetTime() / TICKS_PER_DAY >= 1).
    const criticalsAllowed = Math.floor((world.gameTickTime ?? 0) / 864000) >= 1

    let roll: RollResult
    if (delta < 0) {
        roll = RollResult.Failure
        // FO2-CE: critical failure if d100 <= -delta / 10
        if (criticalsAllowed && getRandomInt(1, 100) <= Math.trunc(-delta / 10)) {
            roll = RollResult.CriticalFailure
        }
    } else {
        roll = RollResult.Success
        // FO2-CE: critical success if d100 <= delta/10 + critChance
        if (criticalsAllowed && getRandomInt(1, 100) <= Math.trunc(delta / 10) + criticalSuccessModifier) {
            roll = RollResult.CriticalSuccess
        }
    }

    return { roll, delta }
}

export function rollIsSuccess(roll: RollResult): boolean {
    return roll === RollResult.Success || roll === RollResult.CriticalSuccess
}

export function rollIsCritical(roll: RollResult): boolean {
    return roll === RollResult.CriticalFailure || roll === RollResult.CriticalSuccess
}

export function arrayRemove<T>(array: T[], value: T) {
    const index = array.indexOf(value)
    if (index !== -1) {
        array.splice(index, 1)
        return true
    }
    return false
}

export function arrayWithout<T>(array: T[], value: T): T[] {
    return array.filter((x) => x !== value)
}

export function arrayIncludes<T>(array: T[], value: T): boolean {
    return array.indexOf(value) !== -1
}

export function clamp(min: number, max: number, value: number) {
    return Math.max(min, Math.min(max, value))
}

export function getMessage(name: string, id: number): string | null {
    if (assets.messageFiles[name] !== undefined && assets.messageFiles[name][id] !== undefined)
        return assets.messageFiles[name][id]
    else {
        loadMessage(name)
        if (assets.messageFiles[name] !== undefined && assets.messageFiles[name][id] !== undefined)
            return assets.messageFiles[name][id]
        else return null
    }
}

export function getProtoMsg(id: number) {
    return getMessage('proto', id)
}

export function pad(n: any, width: number, z?: string) {
    z = z || '0'
    n = n + ''
    return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n
}

export class BinaryReader {
    data: DataView
    offset: number = 0
    length: number

    constructor(data: DataView) {
        this.data = data
        this.length = data.byteLength
    }

    seek(offset: number) {
        this.offset = offset
    }
    read8(): number {
        return this.data.getUint8(this.offset++)
    }
    read16(): number {
        const r = this.data.getUint16(this.offset)
        this.offset += 2
        return r
    }
    read32(): number {
        const r = this.data.getUint32(this.offset)
        this.offset += 4
        return r
    }

    peek8(): number {
        return this.data.getUint8(this.offset)
    }
    peek16(): number {
        return this.data.getUint16(this.offset)
    }
    peek32(): number {
        return this.data.getUint32(this.offset)
    }
}

export function assert(value: boolean, message: string) {
    if (!value) throw new Error('AssertionError: ' + message)
}

export function assertEq<T>(value: T, expected: T, message: string) {
    if (value !== expected)
        throw new Error(`AssertionError: value (${value}) does not match expected (${expected}): ${message}`)
}

declare function structuredClone(value: any, options?: StructuredSerializeOptions): any

export function deepClone<T>(obj: T): T {
    return structuredClone(obj)
}

export function isNumeric(str: string): boolean {
    return !isNaN((str as any) - parseFloat(str))
}
