/*
 * FO2-CE ref: skill.cc skillUse(), skillsPerformStealing(), skillGetFreeUsageSlot()
 *
 * Engine-side skill usage: First Aid, Doctor, Sneak, Lockpick, Steal, Traps,
 * Science, Repair.  In Fallout 2 these have hard-coded effects independent of
 * map scripts (heal HP, cure crippled limbs, advance game time, award XP, …).
 * Scripts can still override via use_skill_on_p_proc.
 */

import { Critter, Obj } from './object.js'
import globalState from './globalState.js'
import { RollResult, randomRoll, rollIsSuccess, getRandomInt } from './util.js'
import * as GameTime from './gametime.js'

// ---------------------------------------------------------------------------
// Logging helper — structured [SKILL] output for debugging
// ---------------------------------------------------------------------------
function rollName(roll: RollResult): string {
    switch (roll) {
        case RollResult.CriticalFailure: return 'CRITICAL FAILURE'
        case RollResult.Failure: return 'FAILURE'
        case RollResult.Success: return 'SUCCESS'
        case RollResult.CriticalSuccess: return 'CRITICAL SUCCESS'
        default: return 'UNKNOWN'
    }
}

function logSkillHeader(skill: string, target: Obj | Critter | null, user: Critter): void {
    const targetName = target ? ((target as any).name ?? 'object') : 'self'
    const pid = (target as any)?.pid ?? '?'
    console.log(`[SKILL] ${skill} on ${targetName} (pid: ${pid})`)
}

function logSkillRoll(baseSkill: number, modifiers: [string, number][], finalChance: number, roll: RollResult, delta: number): void {
    console.log(`[SKILL]   Base skill: ${baseSkill}`)
    for (const [name, value] of modifiers) {
        const sign = value >= 0 ? '+' : ''
        console.log(`[SKILL]   Modifier: ${sign}${value} (${name})`)
    }
    console.log(`[SKILL]   Final chance: ${finalChance}%`)
    // d100 = finalChance - delta  (since delta = finalChance - d100)
    const d100 = finalChance - delta
    console.log(`[SKILL]   Roll: ${d100}`)
    const resultStr = rollName(roll)
    if (rollIsSuccess(roll)) {
        console.log(`[SKILL]   Result: ${resultStr} (roll ${d100} <= chance ${finalChance})`)
    } else {
        console.log(`[SKILL]   Result: ${resultStr} (roll ${d100} > chance ${finalChance})`)
    }
}

function logSkillXP(xp: number): void {
    if (xp > 0) console.log(`[SKILL]   XP awarded: ${xp}`)
}

// ---------------------------------------------------------------------------
// Usage tracking: each skill can be used at most 3 times per 24-hour period.
// FO2-CE ref: skill.cc SKILLS_MAX_USES_PER_DAY, skillGetFreeUsageSlot()
// ---------------------------------------------------------------------------
const SKILLS_MAX_USES_PER_DAY = 3

// Map skill name → array of game-tick timestamps of last uses
const usageSlots: Map<string, number[]> = new Map()

function getUsageSlots(skill: string): number[] {
    let slots = usageSlots.get(skill)
    if (!slots) {
        slots = []
        usageSlots.set(skill, slots)
    }
    return slots
}

// FO2-CE ref: skill.cc skillGetFreeUsageSlot()
// Returns true if the skill can be used right now (< 3 uses in 24h).
function hasFreeUsageSlot(skill: string): boolean {
    const slots = getUsageSlots(skill)
    if (slots.length < SKILLS_MAX_USES_PER_DAY) return true

    // Check if the oldest slot is > 24h ago
    const now = GameTime.getTime()
    const oldest = slots[0]
    return (now - oldest) >= GameTime.TICKS_PER_DAY
}

// Record a usage of skill at the current game time.
function recordUsage(skill: string): void {
    const slots = getUsageSlots(skill)
    const now = GameTime.getTime()

    if (slots.length >= SKILLS_MAX_USES_PER_DAY) {
        // Rotate: remove oldest, push new
        slots.shift()
    }
    slots.push(now)
}

// Reset usage tracking (e.g. on game load)
export function resetSkillUsage(): void {
    usageSlots.clear()
}

// ---------------------------------------------------------------------------
// XP awards  (FO2-CE ref: skill.cc _show_skill_use_messages)
// ---------------------------------------------------------------------------
const SKILL_XP: { [skill: string]: number } = {
    'First Aid': 25,
    'Doctor': 50,
    'Lockpick': 50,
    'Steal': 30,
    'Traps': 50,
    'Science': 25,
    'Repair': 50,
    'Outdoorsman': 0,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export interface SkillUseResult {
    success: boolean
    roll: RollResult
    message: string
    xpAwarded: number
    hpHealed: number
}

function makeResult(success: boolean, roll: RollResult, message: string, xp: number = 0, hp: number = 0): SkillUseResult {
    return { success, roll, message, xpAwarded: xp, hpHealed: hp }
}

// FO2-CE ref: skill.cc skillUse()
// user = critter using the skill (usually globalState.player)
// target = object being acted upon (can be self for First Aid/Doctor)
// skill = skill name string ('First Aid', 'Doctor', etc.)
export function skillUse(user: Critter, target: Critter | null, skill: string): SkillUseResult {
    switch (skill) {
        case 'First Aid':
            return useFirstAid(user, target ?? user)
        case 'Doctor':
            return useDoctor(user, target ?? user)
        case 'Sneak':
            return useSneak(user)
        case 'Lockpick':
            return useLockpick(user, target)
        case 'Steal':
            return useSteal(user, target)
        case 'Traps':
            return useTraps(user, target)
        case 'Science':
            return useScience(user, target)
        case 'Repair':
            return useRepair(user, target)
        default:
            return makeResult(false, RollResult.Failure, `Skill ${skill} cannot be used directly.`)
    }
}

// ---------------------------------------------------------------------------
// FIRST AID
// FO2-CE ref: skill.cc skillUse() case SKILL_FIRST_AID
// Heals 1-5 HP on success. +30 min game time. 3/day limit. Awards 25 XP.
// ---------------------------------------------------------------------------
function useFirstAid(user: Critter, target: Critter): SkillUseResult {
    logSkillHeader('First Aid', target, user)

    if (target.dead) {
        console.log('[SKILL]   Blocked: target is dead')
        return makeResult(false, RollResult.Failure, 'You cannot heal the dead.')
    }

    if (!hasFreeUsageSlot('First Aid')) {
        console.log('[SKILL]   Blocked: 3/day limit reached')
        return makeResult(false, RollResult.Failure, 'You have already used First Aid too many times today.')
    }

    const targetHP = target.getStat('HP')
    const targetMaxHP = target.getStat('Max HP')
    if (targetHP >= targetMaxHP) {
        console.log('[SKILL]   Blocked: target already at full health (%d/%d)', targetHP, targetMaxHP)
        return makeResult(false, RollResult.Failure, 'The target is already at full health.')
    }

    // FO2-CE: skillRoll with criticalChanceModifier = 0 for skill use
    const skillValue = user.getSkill('First Aid')
    const critChance = user.getStat('Critical Chance')
    const { roll, delta } = randomRoll(skillValue, critChance)

    logSkillRoll(skillValue, [], skillValue, roll, delta)

    // Advance game time: +30 minutes
    GameTime.advanceMinutes(30)
    recordUsage('First Aid')

    if (!rollIsSuccess(roll)) {
        return makeResult(false, roll, 'First Aid was unsuccessful.')
    }

    // FO2-CE: heal randomBetween(minimumHpToHeal + 1, maximumHpToHeal + 5)
    // Healer perk: +4 min, +10 max per rank. Not implemented yet — base values only.
    const healMin = 1
    const healMax = 5
    let hpToHeal = getRandomInt(healMin, healMax)

    // Critical success: double healing
    if (roll === RollResult.CriticalSuccess) {
        hpToHeal *= 2
    }

    // Don't overheal
    const actualHeal = Math.min(hpToHeal, targetMaxHP - targetHP)
    target.stats.modifyBase('HP', actualHeal)

    // Award XP
    const xp = SKILL_XP['First Aid']
    if (user.isPlayer && xp > 0) {
        (globalState.player as any)?.addExperience?.(xp)
    }

    console.log(`[SKILL]   Healed: ${actualHeal} HP (target: ${targetHP}→${targetHP + actualHeal}/${targetMaxHP})`)
    logSkillXP(xp)

    return makeResult(true, roll, `First Aid healed ${actualHeal} hit points.`, xp, actualHeal)
}

// ---------------------------------------------------------------------------
// DOCTOR
// FO2-CE ref: skill.cc skillUse() case SKILL_DOCTOR
// Heals crippled limbs first, then 4-10 HP. +1-3 hours game time. Awards 50 XP.
// ---------------------------------------------------------------------------
function useDoctor(user: Critter, target: Critter): SkillUseResult {
    logSkillHeader('Doctor', target, user)

    if (target.dead) {
        console.log('[SKILL]   Blocked: target is dead')
        return makeResult(false, RollResult.Failure, 'You cannot heal the dead.')
    }

    if (!hasFreeUsageSlot('Doctor')) {
        console.log('[SKILL]   Blocked: 3/day limit reached')
        return makeResult(false, RollResult.Failure, 'You have already used Doctor too many times today.')
    }

    const skillValue = user.getSkill('Doctor')
    const critChance = user.getStat('Critical Chance')

    // FO2-CE ref: skill.cc — Doctor first attempts to heal each crippled limb/blindness
    // via individual rolls, then does a general HP heal.
    const healableFlags: (keyof Critter)[] = [
        'isBlinded', 'crippledLeftArm', 'crippledRightArm',
        'crippledLeftLeg', 'crippledRightLeg',
    ]

    let limbsHealed = 0
    let timeHours = 1

    for (const flag of healableFlags) {
        if (!(target as any)[flag]) continue

        // Individual roll per limb/condition
        const limbRoll = randomRoll(skillValue, critChance)
        const limbD100 = skillValue - limbRoll.delta
        if (rollIsSuccess(limbRoll.roll)) {
            ;(target as any)[flag] = false
            limbsHealed++
            console.log(`[SKILL]   Limb heal: ${String(flag)} — SUCCESS (roll ${limbD100} <= ${skillValue})`)
        } else {
            console.log(`[SKILL]   Limb heal: ${String(flag)} — FAILURE (roll ${limbD100} > ${skillValue})`)
        }
        timeHours++ // Each attempt costs extra time
    }

    // General HP healing
    const { roll, delta } = randomRoll(skillValue, critChance)

    logSkillRoll(skillValue, [], skillValue, roll, delta)

    // Advance game time
    GameTime.advanceHours(Math.min(timeHours, 3))
    recordUsage('Doctor')

    const targetHP = target.getStat('HP')
    const targetMaxHP = target.getStat('Max HP')
    let hpHealed = 0

    if (rollIsSuccess(roll) && targetHP < targetMaxHP) {
        // FO2-CE: heal randomBetween(minimumHpToHeal + 4, maximumHpToHeal + 10)
        const healMin = 4
        const healMax = 10
        let hpToHeal = getRandomInt(healMin, healMax)

        if (roll === RollResult.CriticalSuccess) {
            hpToHeal *= 2
        }

        hpHealed = Math.min(hpToHeal, targetMaxHP - targetHP)
        target.stats.modifyBase('HP', hpHealed)
    }

    // Award XP if anything was healed
    let xp = 0
    if (limbsHealed > 0 || hpHealed > 0) {
        xp = SKILL_XP['Doctor']
        if (user.isPlayer && xp > 0) {
            (globalState.player as any)?.addExperience?.(xp)
        }
    }

    const parts: string[] = []
    if (limbsHealed > 0) parts.push(`healed ${limbsHealed} condition(s)`)
    if (hpHealed > 0) parts.push(`restored ${hpHealed} HP`)
    if (parts.length === 0) parts.push('treatment was unsuccessful')

    if (hpHealed > 0) {
        console.log(`[SKILL]   Healed: ${hpHealed} HP (target: ${targetHP}→${targetHP + hpHealed}/${targetMaxHP})`)
    }
    logSkillXP(xp)

    return makeResult(limbsHealed > 0 || hpHealed > 0, roll,
        `Doctor: ${parts.join(', ')}.`, xp, hpHealed)
}

// ---------------------------------------------------------------------------
// SNEAK
// FO2-CE ref: skill.cc skillUse() case SKILL_SNEAK — toggle sneak mode
// FO2-CE ref: intface.cc — sneak indicator on HUD
// ---------------------------------------------------------------------------
function useSneak(user: Critter): SkillUseResult {
    if (user.isPlayer) {
        const player = globalState.player as any
        if (player.isSneaking) {
            player.isSneaking = false
            console.log('[SNEAK] Sneak mode DEACTIVATED')
            return makeResult(true, RollResult.Success, 'You stop sneaking.')
        } else {
            player.isSneaking = true
            console.log('[SNEAK] Sneak mode ACTIVATED')
            return makeResult(true, RollResult.Success, 'You are now sneaking.')
        }
    }
    // Non-player critters: just toggle on globalState
    const gs = globalState as any
    gs.isSneaking = !gs.isSneaking
    return makeResult(true, RollResult.Success, gs.isSneaking ? 'Sneaking.' : 'No longer sneaking.')
}

// ---------------------------------------------------------------------------
// LOCKPICK
// FO2-CE ref: skill.cc skillUse() case SKILL_LOCKPICK
// Roll skill vs. lock difficulty. Script override expected for most doors.
// ---------------------------------------------------------------------------
function useLockpick(user: Critter, target: Critter | null): SkillUseResult {
    logSkillHeader('Lockpick', target, user)

    if (!target) {
        return makeResult(false, RollResult.Failure, 'Nothing to pick.')
    }

    // Lock difficulty is stored in the object's script/pro data.
    // If the object has a lock difficulty, use it; otherwise default to 50.
    const lockDifficulty: number = (target as any).pro?.extra?.lockDifficulty ?? 50
    const skillValue = user.getSkill('Lockpick')
    const modifier = -lockDifficulty
    const finalChance = skillValue + modifier

    const critChance = user.getStat('Critical Chance')
    const { roll, delta } = randomRoll(finalChance, critChance)

    logSkillRoll(skillValue, [['lock difficulty', modifier]], finalChance, roll, delta)

    if (rollIsSuccess(roll)) {
        const xp = SKILL_XP['Lockpick']
        if (user.isPlayer && xp > 0) {
            (globalState.player as any)?.addExperience?.(xp)
        }
        logSkillXP(xp)
        return makeResult(true, roll, 'You pick the lock successfully.', xp)
    }

    return makeResult(false, roll, 'You fail to pick the lock.')
}

// ---------------------------------------------------------------------------
// STEAL
// FO2-CE ref: skill.cc skillsPerformStealing()
// Chance based on Steal skill, target facing, item size. Cap at 95%.
// ---------------------------------------------------------------------------
function useSteal(user: Critter, target: Critter | null): SkillUseResult {
    logSkillHeader('Steal', target, user)

    if (!target) {
        return makeResult(false, RollResult.Failure, 'Nothing to steal from.')
    }

    if (target.dead) {
        console.log('[SKILL]   Target is dead — looting freely')
        return makeResult(true, RollResult.Success, 'You search the body.')
    }

    const baseSkill = user.getSkill('Steal')
    let stealSkill = baseSkill
    const modifiers: [string, number][] = []

    // FO2-CE: +30 bonus if sneaking
    const isSneaking = user.isPlayer ? (globalState.player as any)?.isSneaking : false
    if (isSneaking) {
        stealSkill += 30
        modifiers.push(['sneaking bonus', 30])
    }

    // Cap at 95%
    const chance = Math.min(95, stealSkill)
    if (stealSkill > 95) {
        modifiers.push(['cap at 95%', 95 - stealSkill])
    }

    console.log(`[SKILL]   Base skill: ${baseSkill}`)
    for (const [name, value] of modifiers) {
        const sign = value >= 0 ? '+' : ''
        console.log(`[SKILL]   Modifier: ${sign}${value} (${name})`)
    }
    console.log(`[SKILL]   Final chance: ${chance}%`)

    const stealRoll = getRandomInt(1, 100)
    console.log(`[SKILL]   Roll: ${stealRoll}`)

    if (stealRoll <= chance) {
        console.log(`[SKILL]   Result: SUCCESS (roll ${stealRoll} <= chance ${chance})`)
        const xp = SKILL_XP['Steal']
        if (user.isPlayer && xp > 0) {
            (globalState.player as any)?.addExperience?.(xp)
        }
        logSkillXP(xp)
        return makeResult(true, RollResult.Success, 'You steal successfully.', xp)
    }

    // Caught: separate catch roll
    const catchChance = Math.floor((100 - chance) / 2)
    const catchRoll = getRandomInt(1, 100)
    console.log(`[SKILL]   Steal failed. Catch check: roll ${catchRoll} vs ${catchChance}% chance`)
    if (catchRoll <= catchChance) {
        console.log(`[SKILL]   Result: CRITICAL FAILURE — caught stealing!`)
        return makeResult(false, RollResult.CriticalFailure, 'You are caught stealing!')
    }

    console.log(`[SKILL]   Result: FAILURE (roll ${stealRoll} > chance ${chance})`)
    return makeResult(false, RollResult.Failure, 'You fail to steal anything.')
}

// ---------------------------------------------------------------------------
// TRAPS
// FO2-CE ref: skill.cc skillUse() case SKILL_TRAPS
// Roll vs. trap difficulty to disarm.
// ---------------------------------------------------------------------------
function useTraps(user: Critter, target: Critter | null): SkillUseResult {
    logSkillHeader('Traps', target, user)

    if (!target) {
        return makeResult(false, RollResult.Failure, 'No trap to disarm.')
    }

    const trapDifficulty: number = (target as any).pro?.extra?.trapDifficulty ?? 50
    const skillValue = user.getSkill('Traps')
    const modifier = -trapDifficulty
    const finalChance = skillValue + modifier

    const critChance = user.getStat('Critical Chance')
    const { roll, delta } = randomRoll(finalChance, critChance)

    logSkillRoll(skillValue, [['trap difficulty', modifier]], finalChance, roll, delta)

    if (rollIsSuccess(roll)) {
        const xp = SKILL_XP['Traps']
        if (user.isPlayer && xp > 0) {
            (globalState.player as any)?.addExperience?.(xp)
        }
        logSkillXP(xp)
        return makeResult(true, roll, 'You disarm the trap.', xp)
    }

    if (roll === RollResult.CriticalFailure) {
        return makeResult(false, roll, 'You trigger the trap!')
    }

    return makeResult(false, roll, 'You fail to disarm the trap.')
}

// ---------------------------------------------------------------------------
// SCIENCE
// FO2-CE ref: skill.cc skillUse() case SKILL_SCIENCE
// Mostly script-driven. Engine just provides a roll.
// ---------------------------------------------------------------------------
function useScience(user: Critter, target: Critter | null): SkillUseResult {
    logSkillHeader('Science', target, user)

    if (!target) {
        return makeResult(false, RollResult.Failure, 'Nothing to examine.')
    }

    const skillValue = user.getSkill('Science')
    const critChance = user.getStat('Critical Chance')
    const { roll, delta } = randomRoll(skillValue, critChance)

    logSkillRoll(skillValue, [], skillValue, roll, delta)

    if (rollIsSuccess(roll)) {
        const xp = SKILL_XP['Science']
        if (user.isPlayer && xp > 0) {
            (globalState.player as any)?.addExperience?.(xp)
        }
        logSkillXP(xp)
        return makeResult(true, roll, 'You learn something useful.', xp)
    }

    return makeResult(false, roll, 'You fail to learn anything useful.')
}

// ---------------------------------------------------------------------------
// REPAIR
// FO2-CE ref: skill.cc skillUse() case SKILL_REPAIR
// Only works on "robot" type critters. Heals damage flags + HP.
// +30 min to +3 hours game time. Awards 50 XP.
// ---------------------------------------------------------------------------
function useRepair(user: Critter, target: Critter | null): SkillUseResult {
    logSkillHeader('Repair', target, user)

    if (!target) {
        return makeResult(false, RollResult.Failure, 'Nothing to repair.')
    }

    if (!hasFreeUsageSlot('Repair')) {
        console.log('[SKILL]   Blocked: 3/day limit reached')
        return makeResult(false, RollResult.Failure, 'You have already used Repair too many times today.')
    }

    const skillValue = user.getSkill('Repair')
    const critChance = user.getStat('Critical Chance')
    const { roll, delta } = randomRoll(skillValue, critChance)

    logSkillRoll(skillValue, [], skillValue, roll, delta)

    // Advance game time: +30 minutes minimum
    GameTime.advanceMinutes(30)
    recordUsage('Repair')

    if (!rollIsSuccess(roll)) {
        return makeResult(false, roll, 'Repair was unsuccessful.')
    }

    // Heal HP if target is a critter
    const targetHP = target.getStat('HP')
    const targetMaxHP = target.getStat('Max HP')
    let hpHealed = 0

    if (targetHP < targetMaxHP) {
        const healMin = 4
        const healMax = 10
        let hpToHeal = getRandomInt(healMin, healMax)
        if (roll === RollResult.CriticalSuccess) hpToHeal *= 2
        hpHealed = Math.min(hpToHeal, targetMaxHP - targetHP)
        target.stats.modifyBase('HP', hpHealed)
    }

    const xp = SKILL_XP['Repair']
    if (user.isPlayer && xp > 0) {
        (globalState.player as any)?.addExperience?.(xp)
    }

    if (hpHealed > 0) {
        console.log(`[SKILL]   Repaired: ${hpHealed} HP (target: ${targetHP}→${targetHP + hpHealed}/${targetMaxHP})`)
    }
    logSkillXP(xp)

    const msg = hpHealed > 0
        ? `Repair restored ${hpHealed} HP.`
        : 'Repair was successful.'

    return makeResult(true, roll, msg, xp, hpHealed)
}
