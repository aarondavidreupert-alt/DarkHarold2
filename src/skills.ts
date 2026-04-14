// Copyright 2022 darkf
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Config } from './config.js'

export enum Skills {
    None = 0,
    SmallGuns,
    BigGuns,
    EnergyWeapons,
    Unarmed,
    MeleeWeapons,
    Throwing,
    FirstAid,
    Doctor,
    Sneak,
    Lockpick,
    Steal,
    Traps,
    Science,
    Repair,
    Speech,
    Barter,
    Gambling,
    Outdoorsman,
}

// FO2-CE ref: skill_defs.h — NUM_TAGGED_SKILLS / DEFAULT_TAGGED_SKILLS / SKILL_COUNT
export const SKILL_COUNT = 18
export const DEFAULT_TAGGED_SKILLS = 3
export const MAX_TAGGED_SKILLS = 4 // 4th via Tag! perk
export const SKILL_MAX_VALUE = 300

// Ordered skill names matching the Skills enum (index 0 = SmallGuns = Skills.SmallGuns - 1)
export const SKILL_NAMES: string[] = [
    'Small Guns', 'Big Guns', 'Energy Weapons', 'Unarmed', 'Melee Weapons',
    'Throwing', 'First Aid', 'Doctor', 'Sneak', 'Lockpick', 'Steal', 'Traps',
    'Science', 'Repair', 'Speech', 'Barter', 'Gambling', 'Outdoorsman',
]

// Skill Dependencies system

export enum StatType {
    STR,
    PER,
    END,
    CHR,
    INT,
    AGI,
    LCK,
    One,
}

class Skill {
    constructor(public startValue: number, public dependencies: Dependency[]) {}
}

class Dependency {
    constructor(public statType: string, public multiplier: number) {}
}

class Stat {
    constructor(
        public min: number,
        public max: number,
        public defaultValue: number,
        public dependencies: Dependency[]
    ) {}
}

// Skills
// FO2-CE ref: skill.cc gSkillDescriptions[] — defaultValue, stat1, stat2, statModifier
// Fallout 2 specific, FO1 uses its own, possibly extracting this to an outside file that is loaded in would thus make sense
export const skillDependencies: { [name: string]: Skill } = {
    'Small Guns': new Skill(5, [new Dependency('AGI', 4)]),
    'Big Guns': new Skill(0, [new Dependency('AGI', 2)]),
    'Energy Weapons': new Skill(0, [new Dependency('AGI', 2)]),
    Unarmed: new Skill(30, [new Dependency('AGI', 2), new Dependency('STR', 2)]),
    'Melee Weapons': new Skill(20, [new Dependency('AGI', 2), new Dependency('STR', 2)]),
    Throwing: new Skill(0, [new Dependency('AGI', 4)]),
    'First Aid': new Skill(0, [new Dependency('PER', 2), new Dependency('INT', 2)]),
    Doctor: new Skill(5, [new Dependency('PER', 1), new Dependency('INT', 1)]),
    Sneak: new Skill(5, [new Dependency('AGI', 3)]),
    Lockpick: new Skill(10, [new Dependency('PER', 1), new Dependency('AGI', 1)]),
    Steal: new Skill(0, [new Dependency('AGI', 3)]),
    Traps: new Skill(10, [new Dependency('PER', 1), new Dependency('AGI', 1)]),
    Science: new Skill(0, [new Dependency('INT', 4)]),
    Repair: new Skill(0, [new Dependency('INT', 3)]),
    Speech: new Skill(0, [new Dependency('CHA', 5)]),
    Barter: new Skill(0, [new Dependency('CHA', 4)]),
    // FO2-CE ref: skill.cc — Gambling defaultValue is 0, not 5
    Gambling: new Skill(0, [new Dependency('LUK', 5)]),
    Outdoorsman: new Skill(0, [new Dependency('END', 2), new Dependency('INT', 2)]),
}

// Stats

export const statDependencies: { [name: string]: Stat } = {
    STR: new Stat(1, 10, 5, []),
    PER: new Stat(1, 10, 5, []),
    END: new Stat(1, 10, 5, []),
    CHA: new Stat(1, 10, 5, []),
    INT: new Stat(1, 10, 5, []),
    AGI: new Stat(1, 10, 5, []),
    LUK: new Stat(1, 10, 5, []),

    'Max HP': new Stat(0, 999, 0, [new Dependency('One', 15), new Dependency('END', 2), new Dependency('STR', 2)]),
    AP: new Stat(1, 99, 0, [new Dependency('One', 5), new Dependency('AGI', 0.5)]),
    AC: new Stat(0, 999, 0, [new Dependency('AGI', 1)]),
    Melee: new Stat(1, 500, 0, [new Dependency('One', -5), new Dependency('STR', 1)]),
    Carry: new Stat(0, 999, 0, [new Dependency('One', 25), new Dependency('STR', 25)]),
    Sequence: new Stat(0, 60, 0, [new Dependency('PER', 2)]),
    'Healing Rate': new Stat(1, 30, 0, [new Dependency('END', 1 / 3)]),
    'Critical Chance': new Stat(0, 100, 0, [new Dependency('LUK', 1)]),
    'Better Criticals': new Stat(-60, 100, 0, []),
    'DT EMP': new Stat(0, 100, 0, []),
    'DT Electrical': new Stat(0, 100, 0, []),
    'DT Explosive': new Stat(0, 100, 0, []),
    'DT Fire': new Stat(0, 100, 0, []),
    'DT Laser': new Stat(0, 100, 0, []),
    'DT Normal': new Stat(0, 100, 0, []),
    'DT Plasma': new Stat(0, 100, 0, []),
    'DR EMP': new Stat(0, 100, 0, []),
    'DR Electrical': new Stat(0, 90, 0, []),
    'DR Explosive': new Stat(0, 90, 0, []),
    'DR Fire': new Stat(0, 90, 0, []),
    'DR Laser': new Stat(0, 90, 0, []),
    'DR Normal': new Stat(0, 90, 0, []),
    'DR Plasma': new Stat(0, 90, 0, []),
    'DR Radiation': new Stat(0, 95, 0, [new Dependency('END', 2)]),
    'DR Poison': new Stat(0, 95, 0, [new Dependency('END', 5)]),
    Age: new Stat(16, 101, 25, []),
    Gender: new Stat(0, 1, 0, []),
    //todo: figure out HP.,
    HP: new Stat(0, 999, 1, []),
    'Poison Level': new Stat(0, 2000, 0, []),
    'Radiation Level': new Stat(0, 2000, 0, []),
    'Skill Points': new Stat(0, 999999, 0, []),
    Level: new Stat(1, 99, 1, []),
    Experience: new Stat(0, 99999999, 0, []),
    Reputation: new Stat(-20, 20, 0, []),
    Karma: new Stat(-99999999, 99999999, 0, []),
}

// TODO: figure out what is going on with Skill
// all the weird pseudo stats
//statDependencies['Party Limit'] = new Stat(0, 5, 0, [new Dependency('CHA', 0.5)])
//statDependencies['Skill Rate'] = new Skill(0, Math.pow(2, 31-1), 0, [new Dependency('IN', 2), new Dependency('One', 5)])
//statDependencies['Perk Rate'] = new Skill(1, Math.pow(2, 31-1), 0, [new Dependency('One', 3)])

//helper
statDependencies['One'] = new Stat(1, 1, 1, [])

// FO2-CE ref: skill.cc skillsGetCost() — cost based on *effective* (computed) skill value
export function skillImprovementCost(effectiveSkillValue: number): number {
    // Fallout 2 specific, in FO1 it's always 1
    if (effectiveSkillValue >= 201) return 6
    if (effectiveSkillValue >= 176) return 5
    if (effectiveSkillValue >= 151) return 4
    if (effectiveSkillValue >= 126) return 3
    if (effectiveSkillValue >= 101) return 2
    return 1
}

// FO2-CE ref: skill.cc skillGetGameDifficultyModifier()
// Skills affected by game difficulty: First Aid, Doctor, Sneak, Lockpick, Steal,
// Traps, Science, Repair, Outdoorsman
const DIFFICULTY_AFFECTED_SKILLS: Set<string> = new Set([
    'First Aid', 'Doctor', 'Sneak', 'Lockpick', 'Steal',
    'Traps', 'Science', 'Repair', 'Outdoorsman',
])

export function skillGetGameDifficultyModifier(skill: string): number {
    if (!DIFFICULTY_AFFECTED_SKILLS.has(skill)) return 0
    const diff = Config.combat.difficultyModifier
    // FO2-CE: Easy = +20, Normal = 0, Hard = -10
    if (diff === 75) return 20
    if (diff === 125) return -10
    return 0
}

// FO2-CE ref: skill.cc skillGetValue() → perkGetSkillModifier()
// Maps perk names to skill bonuses. Perk ranks multiply the bonus.
const PERK_SKILL_MODIFIERS: { [perk: string]: { [skill: string]: number } } = {
    'Thief':        { 'Sneak': 10, 'Lockpick': 10, 'Steal': 10, 'Traps': 10 },
    'Master Thief': { 'Lockpick': 15, 'Steal': 15 },
    'Medic':        { 'First Aid': 10, 'Doctor': 10 },
    'Mr. Fixit':    { 'Science': 10, 'Repair': 10 },
    'Speaker':      { 'Speech': 20 },
    'Survivalist':  { 'Outdoorsman': 25 },
    'Negotiator':   { 'Speech': 10, 'Barter': 10 },
    'Salesman':     { 'Barter': 20 },
    'Ranger':       { 'Outdoorsman': 15 },
    // Ghost: +20 Sneak at night — requires time-of-day check, added as flat for now
    'Ghost':        { 'Sneak': 20 },
}

export function perkGetSkillModifier(perks: string[], skill: string): number {
    let mod = 0
    for (const perk of perks) {
        const entry = PERK_SKILL_MODIFIERS[perk]
        if (entry && entry[skill] !== undefined) {
            mod += entry[skill]
        }
    }
    return mod
}

// FO2-CE ref: skill.cc skillGetValue() → traitGetSkillModifier()
// Trait modifiers applied to skill values.
const TRAIT_SKILL_MODIFIERS: { [trait: string]: { [skill: string]: number } } = {
    'Gifted': {
        'Small Guns': -10, 'Big Guns': -10, 'Energy Weapons': -10,
        'Unarmed': -10, 'Melee Weapons': -10, 'Throwing': -10,
        'First Aid': -10, 'Doctor': -10, 'Sneak': -10,
        'Lockpick': -10, 'Steal': -10, 'Traps': -10,
        'Science': -10, 'Repair': -10, 'Speech': -10,
        'Barter': -10, 'Gambling': -10, 'Outdoorsman': -10,
    },
    'Good Natured': {
        'First Aid': 15, 'Doctor': 15, 'Speech': 15, 'Barter': 15,
        'Small Guns': -10, 'Big Guns': -10, 'Energy Weapons': -10,
        'Unarmed': -10, 'Melee Weapons': -10, 'Throwing': -10,
    },
}

export function traitGetSkillModifier(traits: string[], skill: string): number {
    let mod = 0
    for (const trait of traits) {
        const entry = TRAIT_SKILL_MODIFIERS[trait]
        if (entry && entry[skill] !== undefined) {
            mod += entry[skill]
        }
    }
    return mod
}
