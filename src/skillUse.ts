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
import { dbg, eventLogPush } from './logger.js'
import { RollResult, randomRoll, rollIsSuccess, getRandomInt } from './util.js'
import { updateIndicatorBar } from './ui_hud.js'
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

function rollResultKey(roll: RollResult): 'critical-success' | 'success' | 'failure' | 'critical-failure' {
    switch (roll) {
        case RollResult.CriticalSuccess: return 'critical-success'
        case RollResult.Success: return 'success'
        case RollResult.Failure: return 'failure'
        case RollResult.CriticalFailure: return 'critical-failure'
        default: return 'failure'
    }
}

function emitSkillRoll(skillName: string, user: Critter, chance: number, roll: RollResult, d100: number): void {
    const actorName: string = (user as any).name ?? (user.isPlayer ? 'you' : 'critter')
    const result = rollResultKey(roll)
    dbg('skills', `[skill:${skillName}] ${actorName} — chance: ${chance}%  roll: ${d100}  → ${result}`)
    eventLogPush({
        actor: actorName,
        action: 'skill-roll',
        skill: skillName,
        chance,
        roll: d100,
        result,
        message: `${actorName} ${skillName}: roll ${d100} vs ${chance}% → ${result}`,
    })
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
// Steal has no flat XP value here — its real per-session bonus formula
// (skill.cc:1031-1110 stealingXpBonus, capped at 300-skillValue) lives in
// ui_steal.ts's uiSteal(), awarded once at session end.
const SKILL_XP: { [skill: string]: number } = {
    'First Aid': 25,
    'Doctor': 50,
    'Lockpick': 50,
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
            // CE ref: inventory.cc:4505 inventoryOpenStealing() — real stealing is an
            // interactive per-item UI (see ui_steal.ts's uiSteal(), wired from
            // playerUse.ts), not a single abstract roll. This engine-fallback path
            // only fires if playerUseSkill() couldn't resolve a live critter target.
            return makeResult(false, RollResult.Failure, 'There is nothing to steal.')
        case 'Traps':
            return useTraps(user, target)
        case 'Science':
            return useScience(user, target)
        case 'Repair':
            return useRepair(user, target)
        case 'Gambling':
            // CE: Gambling is only usable at gambling tables via NPC interaction, not directly.
            return makeResult(false, RollResult.Failure, 'You need to find somewhere to gamble.')
        case 'Outdoorsman':
            // CE: Outdoorsman is only relevant on the world map for encounter avoidance.
            return makeResult(false, RollResult.Failure, 'Outdoorsman skill applies when traveling.')
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
    emitSkillRoll('First Aid', user, skillValue, roll, skillValue - delta)

    // Advance game time: +30 minutes
    GameTime.advanceMinutes(30)
    recordUsage('First Aid')

    if (!rollIsSuccess(roll)) {
        return makeResult(false, roll, 'First Aid was unsuccessful.')
    }

    // FO2-CE ref: skill.cc skillUse() SKILL_FIRST_AID — heal randomBetween(1 + ranks*4, 5 + ranks*10)
    // Healer perk: +4 min and +10 max per rank.
    const healerRanks = user.perks.filter(p => p === 'Healer').length
    const healMin = 1 + healerRanks * 4
    const healMax = 5 + healerRanks * 10
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
        emitSkillRoll('Doctor', user, skillValue, limbRoll.roll, limbD100)
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
    emitSkillRoll('Doctor', user, skillValue, roll, skillValue - delta)

    // Advance game time
    GameTime.advanceHours(Math.min(timeHours, 3))
    recordUsage('Doctor')

    const targetHP = target.getStat('HP')
    const targetMaxHP = target.getStat('Max HP')
    let hpHealed = 0

    if (rollIsSuccess(roll) && targetHP < targetMaxHP) {
        // FO2-CE ref: skill.cc skillUse() SKILL_DOCTOR — heal randomBetween(4 + ranks*4, 10 + ranks*10)
        const healerRanks = user.perks.filter(p => p === 'Healer').length
        const healMin = 4 + healerRanks * 4
        const healMax = 10 + healerRanks * 10
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
            updateIndicatorBar()
            return makeResult(true, RollResult.Success, 'You stop sneaking.')
        } else {
            player.isSneaking = true
            console.log('[SNEAK] Sneak mode ACTIVATED')
            updateIndicatorBar()
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

    // CE ref: proto_instance.cc:1874 _obj_use_skill_on — bail if jammed (msg 2001: "It's jammed")
    if ((target as any).jammed) {
        return makeResult(false, RollResult.Failure, "It's jammed.")
    }

    globalState.audioEngine.playSfxByName('pickkeys')

    // Lock difficulty is stored in the object's script/pro data.
    // If the object has a lock difficulty, use it; otherwise default to 50.
    const lockDifficulty: number = (target as any).pro?.extra?.lockDifficulty ?? 50
    const skillValue = user.getSkill('Lockpick')
    const modifier = -lockDifficulty
    const finalChance = skillValue + modifier

    const critChance = user.getStat('Critical Chance')
    const { roll, delta } = randomRoll(finalChance, critChance)

    logSkillRoll(skillValue, [['lock difficulty', modifier]], finalChance, roll, delta)
    emitSkillRoll('Lockpick', user, finalChance, roll, finalChance - delta)

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
// FO2-CE ref: skill.cc:1031 skillsPerformStealing() — one roll PER ITEM,
// invoked from the interactive steal UI (ui_steal.ts's uiSteal()), not this
// module's synchronous skillUse() dispatcher. See playerUse.ts's Steal
// special-case for the entry point.
// ---------------------------------------------------------------------------
export interface StealAttemptResult {
    success: boolean // true: item may be moved; false: caught, item stays put
    caught: boolean
}

/**
 * CE ref: skill.cc:1031 skillsPerformStealing(). One call per item dragged
 * in the steal UI.
 *
 * stealCount: CE's _gStealCount — count of items attempted so far *this
 * session* (including this attempt); every drag makes subsequent ones
 * harder, success or fail (inventory.cc:4360,4384).
 *
 * Faithfully reproduces the well-known FO2 quirk where the skilldex-shown
 * Steal% isn't the true success chance: a normal (non-critical) stealRoll
 * result is discarded and a *second*, independent catchRoll actually
 * decides the outcome — only the stealRoll's critical thresholds
 * short-circuit that second roll.
 */
export function performSteal(thief: Critter, target: Critter, item: Obj, stealCount: number): StealAttemptResult {
    let stealModifier = -stealCount + 1

    const hasPickpocket = thief.hasPerk?.('Pickpocket') ?? false
    if (!hasPickpocket) {
        // CE ref: skill.cc:1039 — -4% per item size (proto.item.size)
        const size = (item.pro?.extra as any)?.size ?? 0
        stealModifier -= 4 * size

        // CE ref: skill.cc:1043 — facing check: -25 if face to face
        // _is_hit_from_front: abs(a.rotation - b.rotation) not in {0,1,5}
        const rotDiff = Math.abs(thief.orientation - target.orientation) % 6
        const faceToFace = rotDiff !== 0 && rotDiff !== 1 && rotDiff !== 5
        if (faceToFace) stealModifier -= 25
    }

    // CE ref: skill.cc:1049 — +20 if target is knocked out or down
    if ((target as any).isKnockedDown) stealModifier += 20

    const stealChance = Math.min(95, stealModifier + thief.getSkill('Steal'))

    // CE ref: skill.cc:1059 — stealing from a party member always critically succeeds
    let stealRoll: RollResult
    if (thief.isPlayer && globalState.gParty.isPartyMember(target)) {
        stealRoll = RollResult.CriticalSuccess
    } else {
        stealRoll = randomRoll(stealChance, thief.getStat('Critical Chance')).roll
    }

    let caught: boolean
    if (stealRoll === RollResult.CriticalSuccess) {
        caught = false
    } else if (stealRoll === RollResult.CriticalFailure) {
        caught = true
    } else {
        // CE ref: skill.cc:1073 — catchChance uses the TARGET's Steal skill (only
        // non-critter targets use the flat 30; DH2's steal UI only targets critters)
        const catchChance = target.getSkill('Steal') - stealModifier
        caught = rollIsSuccess(randomRoll(catchChance, 0).roll)
    }

    dbg('skills', `[skill:Steal] item=%s stealCount=%d stealChance=%d%% caught=%s`,
        item.name ?? item.pid, stealCount, stealChance, caught)

    return { success: !caught, caught }
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

    // FO2-CE ref: skill.cc — spring-trap disarm attempt sound
    globalState.audioEngine.playSfxByName('sprtrap')

    const trapDifficulty: number = (target as any).pro?.extra?.trapDifficulty ?? 50
    const skillValue = user.getSkill('Traps')
    const modifier = -trapDifficulty
    const finalChance = skillValue + modifier

    const critChance = user.getStat('Critical Chance')
    const { roll, delta } = randomRoll(finalChance, critChance)

    logSkillRoll(skillValue, [['trap difficulty', modifier]], finalChance, roll, delta)
    emitSkillRoll('Traps', user, finalChance, roll, finalChance - delta)

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
    emitSkillRoll('Science', user, skillValue, roll, skillValue - delta)

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
    emitSkillRoll('Repair', user, skillValue, roll, skillValue - delta)

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
