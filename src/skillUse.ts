/*
 * FO2-CE ref: skill.cc skillUse(), skillRoll(), skillsPerformStealing(),
 * skillGetFreeUsageSlot(), skillUpdateLastUse(), _show_skill_use_messages()
 *
 * The engine part of using a skill on something — what runs when the target's
 * use_skill_on_p_proc doesn't override (proto_instance.cc _obj_use_skill_on) or a
 * medical kit is used (_protinst_use_item_on). Only First Aid, Doctor and Repair
 * have an engine effect; Lockpick does nothing, Traps / Science print a failure,
 * everything else is script-driven (roll_vs_skill).
 */

import { Critter, Obj } from './object.js'
import globalState from './globalState.js'
import { dbg, eventLogPush } from './logger.js'
import { RollResult, randomRoll, rollIsSuccess, getRandomInt, getMessage } from './util.js'
import { updateIndicatorBar, uiLog, drawHP } from './ui_hud.js'
import * as GameTime from './gametime.js'
import { Scripting } from './scripting.js'
import { SKILL_NAMES } from './skills.js'

function emitSkillRoll(skillName: string, user: Critter, chance: number, roll: RollResult, d100: number): void {
    const actorName: string = (user as any).name ?? (user.isPlayer ? 'you' : 'critter')
    const result = roll === RollResult.CriticalSuccess ? 'critical-success'
        : roll === RollResult.Success ? 'success'
        : roll === RollResult.CriticalFailure ? 'critical-failure' : 'failure'
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

const skillMsg = (id: number): string => getMessage('skill', id) ?? ''
const skillId = (skill: string): number => SKILL_NAMES.indexOf(skill)

// ---------------------------------------------------------------------------
// Usage slots — skill.cc _timesSkillUsed[SKILL_COUNT][SKILLS_MAX_USES_PER_DAY]:
// the game times of the last 3 successful uses (0 = free), saved with the game.
// ---------------------------------------------------------------------------
const SKILLS_MAX_USES_PER_DAY = 3
let timesSkillUsed: number[][] = SKILL_NAMES.map(() => [0, 0, 0])

// skill.cc skillGetFreeUsageSlot: a free slot, else the last one when the oldest use
// is more than 24 whole hours ago, else -1.
function skillGetFreeUsageSlot(skill: number): number {
    const times = timesSkillUsed[skill]
    for (let slot = 0; slot < SKILLS_MAX_USES_PER_DAY; slot++) {
        if (times[slot] === 0) return slot
    }
    const hoursSinceLastUsage = Math.floor((GameTime.getTime() - times[0]) / GameTime.TICKS_PER_HOUR)
    if (hoursSinceLastUsage <= 24) return -1
    return SKILLS_MAX_USES_PER_DAY - 1
}

// skill.cc skillUpdateLastUse
function skillUpdateLastUse(skill: number): void {
    const slot = skillGetFreeUsageSlot(skill)
    if (slot === -1) return
    const times = timesSkillUsed[skill]
    if (times[slot] !== 0) {
        for (let i = 0; i < slot; i++) times[i] = times[i + 1]
    }
    times[slot] = GameTime.getTime()
}

// skill.cc skill_use_slot_clear (skillsReset) / skillsSave / skillsLoad
export function resetSkillUsage(): void {
    timesSkillUsed = SKILL_NAMES.map(() => [0, 0, 0])
}
export function serializeSkillUsage(): number[][] {
    return timesSkillUsed.map((t) => t.slice())
}
export function deserializeSkillUsage(saved: number[][] | undefined): void {
    resetSkillUsage()
    if (!Array.isArray(saved)) return
    saved.forEach((t, i) => { if (timesSkillUsed[i] && Array.isArray(t)) timesSkillUsed[i] = [t[0] | 0, t[1] | 0, t[2] | 0] })
}

// ---------------------------------------------------------------------------
// XP — skill.cc gSkillDescriptions .experience / .field_28 and _show_skill_use_messages
// ---------------------------------------------------------------------------
const SKILL_EXPERIENCE: { [skill: string]: [number, boolean] } = {
    'First Aid': [25, false],
    'Doctor': [50, false],
    'Lockpick': [25, true],
    'Steal': [25, true],
    'Traps': [25, true],
    'Outdoorsman': [100, false],
}

function showSkillUseMessages(obj: Critter, skill: string, successCount: number, criticalChanceModifier: number): void {
    if (!obj.isPlayer || successCount <= 0) return
    let [baseExperience, field28] = SKILL_EXPERIENCE[skill] ?? [0, false]
    if (baseExperience === 0) return
    if (field28 && criticalChanceModifier < 0) baseExperience += Math.abs(criticalChanceModifier)
    const player = obj as any
    const before = player.stats.get('Experience')
    player.addExperience(successCount * baseExperience)
    // 505: You earn %d XP for honing your skills.
    uiLog(skillMsg(505).replace('%d', String(player.stats.get('Experience') - before)))
}

// ---------------------------------------------------------------------------
// skill.cc skillRoll: the dude's roll is made by the party member best at the skill
// if it is also that member's own best skill (partyMemberGetBestInSkill /
// partyMemberGetBestSkill), not for Steal; `modifier` is added to the skill.
// ---------------------------------------------------------------------------
function skillRoll(critter: Critter, skill: string, modifier: number): RollResult {
    if (critter.isPlayer && skill !== 'Steal') {
        let best: Critter | null = null
        let bestValue = 0
        for (const c of globalState.gParty?.getPartyMembersAndPlayer() ?? []) {
            if (!c || c.visible === false) continue
            const v = c.getSkill(skill)
            if (v > bestValue) { bestValue = v; best = c }
        }
        if (best) {
            let ownBest = SKILL_NAMES[0]
            let ownValue = 0
            for (const sk of SKILL_NAMES) {
                const v = best.getSkill(sk)
                if (v > ownValue) { ownValue = v; ownBest = sk }
            }
            if (ownBest === skill) critter = best
        }
    }
    let skillValue = critter.getSkill(skill)
    if (critter.isPlayer && skill === 'Steal' && (critter as any).isSneaking && (critter as any).sneakWorking) skillValue += 30
    const chance = skillValue + modifier
    const { roll, delta } = randomRoll(chance, critter.getStat('Critical Chance'))
    emitSkillRoll(skill, critter, chance, roll, chance - delta)
    return roll
}

// ---------------------------------------------------------------------------
// skill.cc skillUse
// ---------------------------------------------------------------------------
export interface SkillUseResult {
    // CE's return value: 0, or -1 when the skill wasn't used (daily limit, not a
    // robot, Traps / Science, an invalid skill) — a medical kit is then left alone
    // (proto_instance.cc _protinst_use_item_on).
    rc: number
    hpHealed: number
}

// skill.cc gHealableDamageFlags / gRepairableDamageFlags (same list): DAM_BLIND,
// DAM_CRIP_ARM_LEFT, DAM_CRIP_ARM_RIGHT, DAM_CRIP_LEG_RIGHT, DAM_CRIP_LEG_LEFT —
// skill.msg 530 + index names each.
const DAMAGE_FLAGS = ['isBlinded', 'crippledLeftArm', 'crippledRightArm', 'crippledRightLeg', 'crippledLeftLeg'] as const

const isCritter = (o: Obj | null): o is Critter => !!o && o.type === 'critter'
const BODY_TYPE_ROBOTIC = 2
const isRobotic = (o: Obj): boolean => isCritter(o) && ((o.pro as any)?.extra?.bodyType ?? 0) === BODY_TYPE_ROBOTIC
// critter.cc critterIsCrippled: any DAM_CRIP bit (the limbs and DAM_BLIND)
const isCrippled = (o: Obj): boolean => isCritter(o) && DAMAGE_FLAGS.some((f) => (o as any)[f])

// critter.cc critterAdjustHitPoints: HP + amount, capped at the maximum
function adjustHitPoints(target: Critter, hp: number): void {
    const maximumHp = target.getStat('Max HP')
    target.stats.setBase('HP', Math.min(target.getStat('HP') + hp, maximumHp))
}

// 590–592: You've taxed your ability … / You're too tired. / The strain might kill you.
const showTooTired = (): void => uiLog(skillMsg(590 + getRandomInt(0, 2)))

// 501 / 502: You look healthy already. / %s looks healthy already.
function showHealthy(obj: Critter, target: Obj): void {
    if (!obj.isPlayer) return
    uiLog(target.type === 'critter' && (target as Critter).isPlayer ? skillMsg(501) : skillMsg(502).replace('%s', target.name ?? ''))
}

// user = the critter using the skill; target = what it is used on.
// `criticalChanceModifier`: CE skillUse's 4th argument — the medical kits add +20 / +40.
export function skillUse(obj: Critter, target: Obj | null, skill: string, criticalChanceModifier: number = 0): SkillUseResult {
    target = target ?? obj
    const result: SkillUseResult = { rc: 0, hpHealed: 0 }
    const currentHp = isCritter(target) ? target.getStat('HP') : 0
    const maximumHp = isCritter(target) ? target.getStat('Max HP') : 0
    const dead = isCritter(target) && !!target.dead

    let minimumHpToHeal = 0
    let maximumHpToHeal = 0
    if (obj.isPlayer && (skill === 'First Aid' || skill === 'Doctor')) {
        const healerRank = ((obj as any).perks as string[] | undefined)?.filter((p) => p === 'Healer').length ?? 0
        minimumHpToHeal = 4 * healerRank
        maximumHpToHeal = 10 * healerRank
    }

    const criticalChance = obj.getStat('Critical Chance') + criticalChanceModifier
    let giveExp = true
    let damageHealingAttempts = 1
    let successCount = 0
    let skillUseSlotAdded = false
    const id = skillId(skill)

    const healHp = (hp: number): void => {
        const t = target as Critter
        adjustHitPoints(t, hp)
        if (obj.isPlayer) {
            // 500: You heal %d hit points.
            uiLog(skillMsg(500).replace('%d', String(Math.min(hp, maximumHp - currentHp))))
        }
        result.hpHealed = Math.min(hp, maximumHp - currentHp)
        ;(t as any).fleeing = false // maneuver &= ~CRITTER_MANUEVER_FLEEING
        if (t.isPlayer) drawHP(t.getStat('HP'))
    }

    // Doctor / Repair: one skillRoll per damage flag, then a plain HP roll.
    const healDamageFlags = (): void => {
        const t = target as Critter
        DAMAGE_FLAGS.forEach((flag, index) => {
            if (!(t as any)[flag]) return
            damageHealingAttempts++
            const roll = skillRoll(obj, skill, criticalChance)
            let prefix: number
            if (rollIsSuccess(roll)) {
                ;(t as any)[flag] = false
                ;(t as any).fleeing = false
                prefix = t.isPlayer ? 520 : 521 // You heal your / the %s.
                skillUpdateLastUse(id)
                successCount = 1
                skillUseSlotAdded = true
            } else {
                prefix = t.isPlayer ? 525 : 526 // You fail to heal your / the %s.
            }
            uiLog(skillMsg(prefix).replace('%s', skillMsg(530 + index)))
            showSkillUseMessages(obj, skill, successCount, criticalChanceModifier)
            giveExp = false
        })
    }

    const healHpRoll = (): void => {
        let roll: RollResult
        if (skill === 'Doctor' && isRobotic(target!)) {
            roll = RollResult.Failure
        } else {
            const skillValue = obj.getSkill(skill)
            const r = randomRoll(skillValue, criticalChance)
            emitSkillRoll(skill, obj, skillValue, r.roll, skillValue - r.delta)
            roll = r.roll
        }
        if (rollIsSuccess(roll)) {
            healHp(getRandomInt(minimumHpToHeal + 4, maximumHpToHeal + 10))
            if (!skillUseSlotAdded) skillUpdateLastUse(id)
            successCount = 1
            showSkillUseMessages(obj, skill, successCount, criticalChanceModifier)
            giveExp = false
        } else {
            uiLog(skillMsg(503)) // You fail to do any healing.
        }
        globalState.gMap?.updateMap() // scriptsExecMapUpdateProc
    }

    switch (skill) {
        case 'First Aid':
            if (skillGetFreeUsageSlot(id) === -1) { showTooTired(); return { rc: -1, hpHealed: 0 } }
            if (dead) {
                dbg('skills', skillMsg(512 + getRandomInt(0, 2))) // CE: debugPrint only
                break
            }
            if (currentHp < maximumHp) {
                const roll = isRobotic(target) ? RollResult.Failure : skillRoll(obj, skill, criticalChance)
                if (rollIsSuccess(roll)) {
                    healHp(getRandomInt(minimumHpToHeal + 1, maximumHpToHeal + 5))
                    skillUpdateLastUse(id)
                    successCount = 1
                } else {
                    uiLog(skillMsg(503))
                }
                globalState.gMap?.updateMap()
            } else {
                if (obj.isPlayer) { showHealthy(obj, target); giveExp = false }
            }
            if (obj.isPlayer) GameTime.advanceSeconds(1800)
            break

        case 'Doctor':
            if (skillGetFreeUsageSlot(id) === -1) { showTooTired(); return { rc: -1, hpHealed: 0 } }
            if (dead) { uiLog(skillMsg(512 + getRandomInt(0, 2))); break }
            if (currentHp < maximumHp || isCrippled(target)) {
                if (!isRobotic(target) && isCrippled(target)) healDamageFlags()
                healHpRoll()
            } else {
                if (obj.isPlayer) { showHealthy(obj, target); giveExp = false }
            }
            if (obj.isPlayer) GameTime.advanceSeconds(3600 * damageHealingAttempts)
            break

        case 'Sneak':
            // CE toggles sneaking in actions.cc _action_skill_use (dudeToggleState); skillUse
            // itself does nothing for Sneak.
            toggleSneak(obj)
            break

        case 'Lockpick':
            break

        case 'Steal':
            // scriptsRequestStealing — the steal screen (ui_steal.ts) opens from playerUse.ts
            break

        case 'Traps':
            uiLog(skillMsg(551)) // You fail to find any traps.
            return { rc: -1, hpHealed: 0 }

        case 'Science':
            uiLog(skillMsg(552)) // You fail to learn anything.
            return { rc: -1, hpHealed: 0 }

        case 'Repair':
            if (!isRobotic(target)) { uiLog(skillMsg(553)); return { rc: -1, hpHealed: 0 } } // You cannot repair that.
            if (skillGetFreeUsageSlot(id) === -1) { showTooTired(); return { rc: -1, hpHealed: 0 } }
            if (dead) { uiLog(skillMsg(1101)); break } // You got it?
            if (currentHp < maximumHp || isCrippled(target)) {
                healDamageFlags()
                healHpRoll()
            } else if (obj.isPlayer) {
                // CE formats 502 here even for the dude
                uiLog(skillMsg((target as Critter).isPlayer ? 501 : 502).replace('%s', target.name ?? ''))
                giveExp = false
            }
            if (obj.isPlayer) GameTime.advanceSeconds(1800 * damageHealingAttempts)
            break

        default:
            dbg('skills', skillMsg(510)) // skill_use: invalid skill used.
            return { rc: -1, hpHealed: 0 }
    }

    if (giveExp) showSkillUseMessages(obj, skill, successCount, criticalChanceModifier)
    if (skill === 'First Aid' || skill === 'Doctor') globalState.gMap?.updateMap()
    return result
}

// ---------------------------------------------------------------------------
// SNEAK
// FO2-CE ref: actions.cc _action_skill_use SKILL_SNEAK — dudeToggleState(DUDE_STATE_SNEAKING)
// FO2-CE ref: intface.cc — sneak indicator on HUD
// CE ref: critter.cc:1194 sneakEventProcess — periodic sneak-skill roll that
// sets _sneak_working. True sneaking (dudeIsSneaking) requires both the
// DUDE_STATE_SNEAKING flag AND a passing roll. The roll reschedules itself.
// ---------------------------------------------------------------------------

function clearSneakTimer(player: any): void {
    const idx = Scripting.timeEventList.findIndex(e => e.obj === player && e.userdata === 'sneak')
    if (idx !== -1) Scripting.timeEventList.splice(idx, 1)
}

export function scheduleSneakEvent(player: any): void {
    const sneak = (player as Critter).getSkill('Sneak')
    const passed = rollIsSuccess(randomRoll(sneak, 0).roll)
    player.sneakWorking = passed

    let ticks: number
    if (!passed) {
        // CE ref: critter.cc:1201-1215 — shorter retry interval at higher skill
        if (sneak > 250) ticks = 100
        else if (sneak > 200) ticks = 120
        else if (sneak > 170) ticks = 150
        else if (sneak > 135) ticks = 200
        else if (sneak > 100) ticks = 300
        else if (sneak > 80) ticks = 400
        else ticks = 600
    } else {
        ticks = 600
    }
    dbg('object', '[SNEAK] roll %s (skill=%d), working=%s, next in %d ticks', passed ? 'PASS' : 'FAIL', sneak, player.sneakWorking, ticks)

    Scripting.timeEventList.push({
        obj: player,
        ticks,
        userdata: 'sneak',
        fn: () => { if ((player as any).isSneaking) scheduleSneakEvent(player) },
        leaveMap: () => sneakClear(player),
    })
}

// CE critter.cc _critter_sneak_clear — leaving the map ends sneaking.
export function sneakClear(player: any): boolean {
    player.isSneaking = false
    player.sneakWorking = false
    updateIndicatorBar()
    return true
}

function toggleSneak(user: Critter): void {
    if (!user.isPlayer) return
    const player = user as any
    if (player.isSneaking) {
        player.isSneaking = false
        player.sneakWorking = false
        clearSneakTimer(player)
        dbg('object', '[SNEAK] Sneak mode DEACTIVATED')
    } else {
        player.isSneaking = true
        // CE ref: critter.cc:1194 — fire first sneak event immediately on activation.
        scheduleSneakEvent(player)
        dbg('object', '[SNEAK] Sneak mode ACTIVATED')
    }
    updateIndicatorBar()
}

// ---------------------------------------------------------------------------
// STEAL — per-item roll called from the interactive steal UI (ui_steal.ts).
// FO2-CE ref: skill.cc:1031 skillsPerformStealing(). One call per item dragged.
// stealCount: CE's _gStealCount — count of items attempted this session;
// every drag makes subsequent ones harder (inventory.cc:4360,4384).
// ---------------------------------------------------------------------------
export interface StealAttemptResult {
    success: boolean
    caught: boolean
}

export function performSteal(thief: Critter, target: Critter, item: Obj, stealCount: number): StealAttemptResult {
    let stealModifier = -stealCount + 1

    const hasPickpocket = thief.hasPerk?.('Pickpocket') ?? false
    if (!hasPickpocket) {
        // CE ref: skill.cc:1039 — -4% per item size
        const size = (item.pro?.extra as any)?.size ?? 0
        stealModifier -= 4 * size

        // CE ref: skill.cc:1043 — -25 if face to face
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
        // CE ref: skill.cc:1073 — catchChance uses the TARGET's Steal skill
        const catchChance = target.getSkill('Steal') - stealModifier
        caught = rollIsSuccess(randomRoll(catchChance, 0).roll)
    }

    dbg('skills', `[skill:Steal] item=%s stealCount=%d stealChance=%d%% caught=%s`,
        item.name ?? item.pid, stealCount, stealChance, caught)

    return { success: !caught, caught }
}
