// skills.ts against fallout2-ce skill.cc / perk.cc / trait.cc. The skill table is parsed out of the
// CE source itself; the modifier cases follow the CE switch statements cited in each test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    SKILL_NAMES,
    SKILL_COUNT,
    skillDependencies,
    skillImprovementCost,
    skillGetGameDifficultyModifier,
    perkGetSkillModifier,
    traitGetSkillModifier,
} from '../js/skills.js'
import { Config } from '../js/config.js'
import { ceSource } from './support/ce.mjs'

const CE_STAT = {
    STAT_STRENGTH: 'STR', STAT_PERCEPTION: 'PER', STAT_ENDURANCE: 'END', STAT_CHARISMA: 'CHA',
    STAT_INTELLIGENCE: 'INT', STAT_AGILITY: 'AGI', STAT_LUCK: 'LUK',
}

// skill_defs.h enum: SKILL_SMALL_GUNS .. SKILL_OUTDOORSMAN, in order
function ceSkillEnum() {
    const body = ceSource('skill_defs.h').match(/SKILL_SMALL_GUNS[\s\S]*?SKILL_COUNT/)[0]
    return body.match(/SKILL_[A-Z_]+/g).filter((s) => s !== 'SKILL_COUNT')
}

// skill.cc gSkillDescriptions[SKILL_COUNT] rows:
// { name, description, attributes, frmId, defaultValue, statModifier, stat1, stat2, baseValueMult, experience, field_28 }
function ceSkillDescriptions() {
    const table = ceSource('skill.cc').match(/gSkillDescriptions\[SKILL_COUNT\] = \{([\s\S]*?)\n\};/)[1]
    return [...table.matchAll(/\{([^}]*)\}/g)].map((m) => {
        const f = m[1].split(',').map((s) => s.trim())
        return { defaultValue: +f[4], statModifier: +f[5], stat1: f[6], stat2: f[7] }
    })
}

test('skill list matches CE skill_defs.h, in order', () => {
    const ceNames = ceSkillEnum()
    assert.equal(ceNames.length, SKILL_COUNT)
    assert.deepEqual(SKILL_NAMES.map((n) => 'SKILL_' + n.toUpperCase().replace(/ /g, '_')), ceNames)
})

test('base values and stat dependencies match CE skill.cc gSkillDescriptions', () => {
    // CE skill.cc skillGetValue: defaultValue + statModifier * (stat1 + stat2)
    const rows = ceSkillDescriptions()
    assert.equal(rows.length, SKILL_COUNT)
    SKILL_NAMES.forEach((name, i) => {
        const ce = rows[i]
        const expected = [ce.stat1, ce.stat2]
            .filter((s) => s !== 'STAT_INVALID')
            .map((s) => ({ statType: CE_STAT[s], multiplier: ce.statModifier }))
        const dh2 = skillDependencies[name]
        assert.equal(dh2.startValue, ce.defaultValue, `${name} default`)
        assert.deepEqual(dh2.dependencies.map((d) => ({ statType: d.statType, multiplier: d.multiplier })), expected, name)
    })
})

test('skill point cost per level matches CE skill.cc skillsGetCost', () => {
    // skill.cc skillsGetCost: >= 201 -> 6, >= 176 -> 5, >= 151 -> 4, >= 126 -> 3, >= 101 -> 2, else 1
    const cases = [[0, 1], [100, 1], [101, 2], [125, 2], [126, 3], [150, 3], [151, 4],
        [175, 4], [176, 5], [200, 5], [201, 6], [300, 6]]
    for (const [value, cost] of cases) assert.equal(skillImprovementCost(value), cost, `skill ${value}`)
})

test('game difficulty modifier matches CE skill.cc skillGetGameDifficultyModifier', () => {
    // skill.cc skillGetGameDifficultyModifier: First Aid .. Outdoorsman except the six combat
    // skills get +20 on easy and -10 on hard
    const combat = ['Small Guns', 'Big Guns', 'Energy Weapons', 'Unarmed', 'Melee Weapons', 'Throwing']
    const saved = Config.combat.gameDifficultyModifier
    try {
        for (const [difficulty, bonus] of [[75, 20], [100, 0], [125, -10]]) {
            Config.combat.gameDifficultyModifier = difficulty
            for (const name of SKILL_NAMES) {
                assert.equal(skillGetGameDifficultyModifier(name), combat.includes(name) ? 0 : bonus, `${name} @ ${difficulty}`)
            }
        }
    } finally {
        Config.combat.gameDifficultyModifier = saved
    }
})

test('perk skill modifiers stack as in CE perk.cc perkGetSkillModifier', () => {
    // perk.cc perkGetSkillModifier: Doctor = Medic 10 + Living Anatomy 10 + Vault City Training 5
    assert.equal(perkGetSkillModifier(['Medic', 'Living Anatomy', 'Vault City Training'], 'Doctor'), 25)
    // First Aid: Medic 10 + Vault City Training 5 (Living Anatomy is Doctor only)
    assert.equal(perkGetSkillModifier(['Medic', 'Living Anatomy', 'Vault City Training'], 'First Aid'), 15)
    // Steal: Thief 10 + Master Thief 15 + Harmless 20; Lockpick: Thief + Master Thief; Traps: Thief
    const thief = ['Thief', 'Master Thief', 'Harmless']
    assert.equal(perkGetSkillModifier(thief, 'Steal'), 45)
    assert.equal(perkGetSkillModifier(thief, 'Lockpick'), 25)
    assert.equal(perkGetSkillModifier(thief, 'Traps'), 10)
    // Speech falls through to Barter's Negotiator: Speaker 20 + Expert Excrement Expeditor 5 +
    // Negotiator 10; Barter: Negotiator 10 + Salesman 20
    const talker = ['Speaker', 'Expert Excrement Expeditor', 'Negotiator', 'Salesman']
    assert.equal(perkGetSkillModifier(talker, 'Speech'), 35)
    assert.equal(perkGetSkillModifier(talker, 'Barter'), 30)
    // Outdoorsman: Ranger 15 + Survivalist 25; Science / Repair: Mr. Fixit 10
    assert.equal(perkGetSkillModifier(['Ranger', 'Survivalist'], 'Outdoorsman'), 40)
    assert.equal(perkGetSkillModifier(['Mr. Fixit'], 'Repair'), 10)
})

test('perk modifiers count a perk once whatever its rank (CE perkHasRank)', () => {
    assert.equal(perkGetSkillModifier(['Gambler', 'Gambler'], 'Gambling'), 20)
})

test('Ghost: +20 Sneak only when the light is above 45875 (CE perk.cc perkGetSkillModifier)', () => {
    // perk.cc: objectGetLightIntensity(gDude) > 45875, then falls through to Thief
    assert.equal(perkGetSkillModifier(['Ghost'], 'Sneak', 45876), 20)
    assert.equal(perkGetSkillModifier(['Ghost'], 'Sneak', 45875), 0)
    assert.equal(perkGetSkillModifier(['Ghost', 'Thief'], 'Sneak', 65536), 30)
})

test('trait skill modifiers match CE trait.cc traitGetSkillModifier', () => {
    // trait.cc traitGetSkillModifier: Gifted -10 on every skill; Good Natured -10 on the six
    // combat skills, +15 on First Aid, Doctor, Speech, Barter
    for (const name of SKILL_NAMES) assert.equal(traitGetSkillModifier(['Gifted'], name), -10, name)
    const both = ['Gifted', 'Good Natured']
    assert.equal(traitGetSkillModifier(both, 'Small Guns'), -20)
    assert.equal(traitGetSkillModifier(both, 'First Aid'), 5)
    assert.equal(traitGetSkillModifier(both, 'Sneak'), -10)
    assert.equal(traitGetSkillModifier(['Good Natured'], 'Science'), 0)
})
