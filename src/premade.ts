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

// Premade characters — CE character_selector.cc gPremadeCharacterDescriptions and
// critter.cc gcdLoad (the .gcd character file: critter proto data, name, tagged
// skills, traits, unspent character points; big-endian like every FO2 file).

import { SKILLS, STATS, TRAITS_BY_ID } from './ui_character.js'
import { getFileBinarySync, getFileText } from './util.js'

// CE character_selector.cc:97 — file stem and face FRM (intrface.lst index).
export const PREMADE_CHARACTERS: ReadonlyArray<{ file: string; face: string }> = [
    { file: 'premade/combat', face: 'art/intrface/combat.png' },     // Narg, FID 201
    { file: 'premade/stealth', face: 'art/intrface/stealth.png' },   // Mingan, FID 202
    { file: 'premade/diplomat', face: 'art/intrface/diplomat.png' }, // Chitsa, FID 203
]

const SAVEABLE_STAT_COUNT = 35 // stat_defs.h
const SKILL_COUNT = 18
const DUDE_NAME_MAX_LENGTH = 32
const NUM_TAGGED_SKILLS = 4
const TRAITS_MAX_SELECTED_COUNT = 2
const STAT_AGE = 33
const STAT_GENDER = 34

export interface PremadeCharacter {
    name: string
    special: { [stat: string]: number } // base SPECIAL, before trait modifiers
    age: number
    sex: 'Male' | 'Female'
    tagged: string[]
    traits: string[]
    characterPoints: number // gCharacterEditorRemainingCharacterPoints
}

// CE critter.cc:1022 gcdLoad → protoCritterDataRead, name, skillsLoad, traitsLoad.
export function parseGcd(view: DataView): PremadeCharacter {
    let o = 0
    const i32 = (): number => { const v = view.getInt32(o, false); o += 4; return v }

    i32() // flags
    const baseStats: number[] = []
    for (let i = 0; i < SAVEABLE_STAT_COUNT; i++) baseStats.push(i32())
    o += SAVEABLE_STAT_COUNT * 4 // bonusStats
    o += SKILL_COUNT * 4         // skills (no invested points in premades)
    o += 4 * 4                   // bodyType, experience, killType, damageType

    let name = ''
    for (let i = 0; i < DUDE_NAME_MAX_LENGTH; i++) {
        const c = view.getUint8(o + i)
        if (c === 0) break
        name += String.fromCharCode(c)
    }
    o += DUDE_NAME_MAX_LENGTH

    const tagged: string[] = []
    for (let i = 0; i < NUM_TAGGED_SKILLS; i++) {
        const id = i32()
        if (id >= 0 && SKILLS[id]) tagged.push(SKILLS[id])
    }
    const traits: string[] = []
    for (let i = 0; i < TRAITS_MAX_SELECTED_COUNT; i++) {
        const id = i32()
        if (id >= 0 && TRAITS_BY_ID[id]) traits.push(TRAITS_BY_ID[id])
    }
    const characterPoints = i32()

    const special: { [stat: string]: number } = {}
    STATS.forEach((s, i) => { special[s] = baseStats[i] })
    return {
        name,
        special,
        age: baseStats[STAT_AGE],
        sex: baseStats[STAT_GENDER] === 1 ? 'Female' : 'Male',
        tagged,
        traits,
        characterPoints,
    }
}

export function loadPremade(index: number): PremadeCharacter {
    return parseGcd(getFileBinarySync(`data/${PREMADE_CHARACTERS[index].file}.gcd`))
}

// The .bio text shown next to the stats (character_selector.cc characterSelectorWindowRenderBio).
export function loadPremadeBio(index: number): string[] {
    try {
        return getFileText(`data/${PREMADE_CHARACTERS[index].file}.bio`).split(/\r?\n/)
    } catch (_) {
        return []
    }
}
