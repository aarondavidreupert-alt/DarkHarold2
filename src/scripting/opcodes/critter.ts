// Script opcodes: critter stats, traits, skills and checks, damage, healing, poison and radiation (CE op_get_critter_stat, op_critter_dmg, op_roll_vs_skill, ...).
// Methods of the Script class (scripting.ts), kept here by topic and installed on its prototype
// there; vmBridge.ts and the Lua prelude call them as before (wiki/code_quality.md Q16).

import type { Script } from '../../scripting.js'
import { AI } from '../../combat/AI.js'
import { ANIM_FALL_BACK_SF, ANIM_FALL_FRONT_BLOOD_SF, correctDeath, critterDamage, critterKill } from '../../critter.js'
import { CE_PERKS, getPerkRank, perkApplyEffect, perkNameById } from '../../perks.js'
import { Config } from '../../config.js'
import { Critter, Obj } from '../../object.js'
import { Player } from '../../player.js'
import { RollResult, getRandomInt, rollIsCritical, rollIsSuccess } from '../../util.js'
import { SKILL_NAMES } from '../../skills.js'
import { critterAdjustRadiation } from '../../radiation.js'
import { dbg, dbgWarn } from '../../logger.js'
import { fromTileNum } from '../../tile.js'
import { world } from '../../state/world.js'
import { isWithinPerception } from '../../perception.js'
import { skillRoll } from '../../skillUse.js'
import { uiDrawWeapon } from '../../hudRefresh.js'
import { updateIndicatorBar } from '../../hudRefresh.js'
import {
    DAMAGE_TYPE_NAMES,
    adjustPoison,
    critterAdjustHitPoints,
    info,
    isGameObject,
    loadingGame,
    log,
    objCanSeeObj,
    perkRankOwner,
    statMap,
    warn,
} from '../../scripting.js'

export const critterOpcodes = {
    // critters
    get_critter_stat(this: Script, obj: Critter, stat: number) {
        if (stat === 34) {
            // STAT_GENDER — the player's choice, else the proto's
            if (obj.isPlayer) return (<Player>obj).gender === 'female' ? 1 : 0
            return obj.getStat('Gender') ?? 0
        }
        if (stat === 8) {
            // STAT_MAXIMUM_ACTION_POINTS — CE stat.cc critterGetStat (base + modifiers)
            return obj.getStat('AP')
        }
        if (stat === 9) {
            // STAT_ARMOR_CLASS — CE stat.cc critterGetStat: base + bonus (the worn armor's
            // AC, _adjust_ac) + in combat the unused AP while it isn't the critter's turn
            // (Combat.unusedApAC, HtH Evade included).
            return obj.getStat('AC') + obj.getArmorAC() + (world.combat?.unusedApAC(obj as Critter) ?? 0)
        }
        if (stat === 10) {
            // STAT_UNARMED_DAMAGE — CE ref: stat.cc critterStatBaseGetter (default 0 bonus)
            // The unarmed moves' bonus damage is per hit mode (unarmed.ts), not this stat.
            return 0
        }
        if (stat === 13) {
            // STAT_SEQUENCE — CE ref: stat.cc:572 baseStats[STAT_SEQUENCE] = 2 * perception
            return obj.getStat('Sequence')
        }
        // STAT_DAMAGE_THRESHOLD (17-23) and STAT_DAMAGE_RESISTANCE (24-30)
        // CE ref: stat.cc critterGetStat — returns critter base stat + equipped armour contribution
        const DT_DR_TYPES = ['Normal', 'Laser', 'Fire', 'Plasma', 'Electrical', 'EMP', 'Explosive']
        if (stat >= 17 && stat <= 23) {
            const dmgType = DT_DR_TYPES[stat - 17]
            return obj.getStat('DT ' + dmgType) + obj.getArmorDT(dmgType)
        }
        if (stat >= 24 && stat <= 30) {
            const dmgType = DT_DR_TYPES[stat - 24]
            return obj.getStat('DR ' + dmgType) + obj.getArmorDR(dmgType)
        }
        if (stat === 31) return obj.getStat('DR Radiation') // STAT_RADIATION_RESISTANCE
        if (stat === 32) return obj.getStat('DR Poison') // STAT_POISON_RESISTANCE
        if (stat === 33) {
            // STAT_AGE — CE stat.cc critterGetStat: base age + game years (Critter.getStat)
            return obj.getStat('Age')
        }
        if (stat === 36) return obj.poisonLevel ?? 0 // STAT_CURRENT_POISON_LEVEL
        if (stat === 37) return obj.radiationLevel ?? 0 // STAT_CURRENT_RADIATION_LEVEL
        const namedStat = statMap[stat]
        if (namedStat !== undefined) return obj.getStat(namedStat)
        dbgWarn('script', `get_critter_stat: unknown stat ${stat}`)
        return 0
    },
    set_critter_stat(this: Script, obj: Obj, stat: number, value: number) {
        // CE ref: interpreter_extra.cc:1313 opSetCritterStat — player only, additive
        // Adds `value` to base+trait-modified stat and stores as new base.
        if (!isGameObject(obj) || obj.type !== 'critter') {
            warn('set_critter_stat: not a critter')
            return -1
        }
        if (!(obj as Critter).isPlayer) {
            warn('set_critter_stat: can only modify obj_dude')
            return -1
        }
        // CE stat.cc:439 critterSetBaseStat: derived stats (STAT_MAXIMUM_HIT_POINTS 7 ..
        // STAT_POISON_RESISTANCE 32) can't be set; current HP / poison / radiation (35-37)
        // route through their adjust functions with the delta.
        if (stat > 6 && stat <= 32) return 0
        if (stat === 35) {
            critterAdjustHitPoints(obj as Critter, value)
            return 0
        }
        if (stat === 36) {
            this.poison(obj, value)
            return 0
        }
        if (stat === 37) {
            critterAdjustRadiation(obj as Critter, value)
            return 0
        }
        const statName = statMap[stat]
        if (!statName) {
            warn('set_critter_stat: unknown stat ' + stat)
            return -1
        }
        // critterGetBaseStatWithTraitModifier: the base (DH2 keeps trait SPECIAL there),
        // not drugs, perks or blindness
        const current = (obj as Critter).stats.getBase(statName)
        ;(obj as Critter).stats.setBase(statName, current + value)
        return 0
    },
    has_trait(this: Script, traitType: number, obj: Obj, trait: number) {
        if (!isGameObject(obj)) {
            warn('has_trait: not game object: ' + obj, undefined, this)
            return 0
        }

        if (traitType === 0) {
            // CRITTER_TRAIT_PERK — CE ref: interpreter_extra.cc:2570 opHasTrait
            // perkGetRank returns number of times perk acquired (0 = not present).
            // `trait` is the CE perk id (perk_defs.h), not an index into DH2's
            // selectable PERKS list (the two diverge from id 33 on).
            const name = perkNameById(trait)
            if (!name) return 0
            return getPerkRank(perkRankOwner(obj as Critter) as any, name)
        }

        if (traitType === 1) {
            // CRITTER_TRAIT_OBJECT — CE ref: interpreter_extra.cc:2570 opHasTrait
            switch (trait) {
                case 5:
                    return (<Critter>obj).aiNum ?? 0 // OBJECT_AI_PACKET
                case 6:
                    return (<Critter>obj).teamNum ?? 0 // OBJECT_TEAM_NUM
                case 10:
                    return obj.orientation // OBJECT_CUR_ROT
                case 34: // OBJECT_SEX — CE ref: critter.cc critterGetSex
                    if ((<Critter>obj).isPlayer) return (<Player>obj).gender === 'female' ? 1 : 0
                    return 0
                case 666: // OBJECT_VISIBILITY
                    return obj.visible === false ? 0 : 1 // 1 = visible, 0 = invisible
                case 667: // OBJECT_CUR_POISON — CE ref: critter.cc critterGetPoison
                    return (<Critter>obj).poisonLevel ?? 0
                case 668: // OBJECT_CUR_RADIATION — CE ref: critter.cc critterGetRadiation
                    return (<Critter>obj).radiationLevel ?? 0
                case 669: {
                    // CE ref: interpreter_extra.cc:2595 CRITTER_TRAIT_OBJECT_GET_INVENTORY_WEIGHT
                    return obj.getInventoryWeight() // item.cc objectGetInventoryWeight
                }
                default:
                    dbgWarn('script', `has_trait: unhandled OBJECT trait ${trait}`)
                    return -1
            }
        }

        if (traitType === 2) {
            // CRITTER_TRAIT_TRAIT — CE ref: interpreter_extra.cc:2600 opHasTrait
            const TRAIT_NAMES: string[] = [
                'Fast Metabolism',
                'Bruiser',
                'Small Frame',
                'One Hander',
                'Finesse',
                'Kamikaze',
                'Heavy Handed',
                'Fast Shot',
                'Bloody Mess',
                'Jinxed',
                'Good Natured',
                'Chem Reliant',
                'Chem Resistant',
                'Sex Appeal',
                'Skilled',
                'Gifted',
            ]
            const traitName = TRAIT_NAMES[trait]
            if (!traitName) return 0
            return world.player?.traits?.includes(traitName) ? 1 : 0
        }

        dbgWarn('script', `has_trait: unknown traitType ${traitType}`)
        return 0
    },
    critter_add_trait(this: Script, obj: Obj, traitType: number, trait: number, amount: number) {
        if (!isGameObject(obj)) {
            warn('critter_add_trait: not game object: ' + obj, undefined, this)
            return
        }

        if (obj.type !== 'critter') {
            warn('critter_add_trait: not a critter: ' + obj, undefined, this)
            return
        }

        if (traitType === 1) {
            // CRITTER_TRAIT_OBJECT — CE ref: interpreter_extra.cc:2869 opCritterAddTrait
            // Unknown OBJECT traits are silently ignored in CE (default: break).
            switch (trait) {
                case 5: // OBJECT_AI_PACKET — CE combat_ai.cc critterSetAiPacket
                    ;(<Critter>obj).aiNum = amount
                    // … and the proto's packet when _isPotentialPartyMember — which ignores
                    // its argument and holds whenever the dude is party member 0, i.e.
                    // always: critters of this pid made later start with the new packet
                    if ((<Critter>obj).pro?.extra) (<Critter>obj).pro!.extra.AI = amount
                    // the cached packet (combat/AI.ts) is rebuilt from the new number
                    if ((<Critter>obj).ai) (<Critter>obj).ai = new AI(<Critter>obj)
                    return
                case 6: {
                    // OBJECT_TEAM_NUM
                    // CE opCritterAddTrait: not for party members, an unchanged team, or while a
                    // game loads; then combat_ai.cc critterSetTeam — who hit it is forgotten if
                    // now on that team, and so is its last target
                    const c = <Critter>obj
                    if (world.gParty?.isPartyMember(c) || c.teamNum === amount || loadingGame) return
                    c.teamNum = amount
                    const who = c.whoHitMe
                    if (who && who.teamNum === amount) (c as any).whoHitMe = null
                    ;(c as any).aiLastTarget = null
                    return
                }
                case 10: // OBJECT_CUR_ROT
                    obj.orientation = Math.max(0, Math.min(5, amount))
                    return
                case 666: // OBJECT_VISIBILITY — 0=invisible, 1=visible
                    obj.visible = amount !== 0
                    return
                case 669: // OBJECT_CUR_WEIGHT — read-only (computed), no-op
                    return
                default:
                    dbgWarn('script', `critter_add_trait: unhandled OBJECT trait ${trait} (amount=${amount}) — ignored`)
                    return
            }
        } else if (traitType === 0) {
            // CRITTER_TRAIT_PERK — CE ref: interpreter_extra.cc:2869 opCritterAddTrait
            // amount > 0 → perkAddForce (no requirement check); amount <= 0 → perkRemove
            // CE perk.cc perkAddForce / perkRemove, by CE perk id (ids 70-118 included):
            // the ranks go to perkGetRankData's owner (the dude, a party.txt member's
            // own list, or — CE's fallback — the dude's for anyone else), the effect
            // (perkAddEffect) to the critter itself.
            const player = perkRankOwner(<Critter>obj)
            const target = <Critter>obj
            const name = perkNameById(trait)
            const ce = CE_PERKS[trait]
            if (!name || !ce) {
                warn(`critter_add_trait: unknown perk id ${trait}`)
                return
            }
            if (amount > 0) {
                const rank = getPerkRank(player as any, name)
                if (ce.maxRank !== -1 && rank >= ce.maxRank) return
                player.perks.push(name)
                perkApplyEffect(target, trait, 1)
            } else {
                const idx = player.perks.indexOf(name)
                if (idx >= 0) {
                    player.perks.splice(idx, 1)
                    perkApplyEffect(target, trait, -1)
                }
            }
            return
        }

        dbgWarn('script', `critter_add_trait: unhandled traitType ${traitType}`)
    },
    // CE opCritterRemoveTrait (0x8103) — TRAIT_PERK only: remove every rank.
    critter_rm_trait(this: Script, obj: Obj, kind: number, param: number, _value: number) {
        if (!isGameObject(obj) || obj.type !== 'critter') return -1
        if (kind !== 0) {
            warn('critter_rm_trait: trait out of range')
            return -1
        }
        const name = perkNameById(param)
        const perks: string[] = (perkRankOwner(obj as Critter) as any).perks ?? [] // perkGetRankData
        if (name)
            for (let i = perks.length - 1; i >= 0; i--) {
                if (perks[i] !== name) continue
                perks.splice(i, 1)
                perkApplyEffect(obj as Critter, param, -1) // CE perkRemove → perkRemoveEffect
            }
        return -1
    },
    critter_mod_skill(this: Script, obj: Obj, skill: number, amount: number) {
        if (!isGameObject(obj) || obj.type !== 'critter') {
            warn('critter_mod_skill: not a critter: ' + obj)
            return 0
        }
        const skillName = SKILL_NAMES[skill]
        if (!skillName) {
            warn('critter_mod_skill: unknown skill id ' + skill)
            return 0
        }
        const critter = obj as Critter
        try {
            const current = critter.skills.getBase(skillName)
            critter.skills.setBase(skillName, current + amount)
            info('critter_mod_skill: ' + obj.name + ' ' + skillName + (amount >= 0 ? '+' : '') + amount)
        } catch (e) {
            warn('critter_mod_skill: error: ' + e)
        }
        return 0
    },
    using_skill(this: Script, obj: Obj, skill: number) {
        // FO2-CE ref: interpreter_extra.cc opUsingSkill — only SKILL_SNEAK(8) on gDude returns meaningful data
        if (skill === 8 /* SKILL_SNEAK */ && (obj as any).isPlayer) {
            return (obj as Player).isSneaking ? 1 : 0
        }
        return 0
    },
    has_skill(this: Script, obj: Obj, skill: number) {
        // FO2-CE ref: skill.cc skillGetValue() — returns the critter's effective skill value
        const skillName = SKILL_NAMES[skill] ?? `Unknown(${skill})`
        const critter = obj as Critter
        const value = typeof critter.getSkill === 'function' ? critter.getSkill(skillName) : 0
        dbg('script', `has_skill(${skillName}, id=${skill}) → ${value}`)
        return value
    },
    // CE opRollVsSkill → skill.cc skillRoll(obj, skill, modifier, &script->howMuch): for
    // the dude the party member best at the skill rolls when it is also its own best
    // skill (not Steal); sneaking adds +30 to Steal. A non-critter gives
    // ROLL_CRITICAL_FAILURE.
    roll_vs_skill(this: Script, obj: Obj, skill: number, bonus: number) {
        const skillName = SKILL_NAMES[skill]
        if (!isGameObject(obj) || obj.type !== 'critter' || skillName === undefined) return RollResult.CriticalFailure
        const out = { howMuch: 0 }
        const roll = skillRoll(obj as Critter, skillName, bonus, out)
        this.howMuch = out.howMuch
        dbg(
            'script',
            `roll_vs_skill: ${skillName} (id=${skill}) bonus=${bonus} → ${RollResult[roll]}(${roll}), howMuch=${out.howMuch}`,
        )
        return roll
    },
    do_check(this: Script, obj: Obj, check: number, modifier: number) {
        // FO2-CE ref: interpreter_extra.cc opDoCheck + stat.cc statRoll
        // Only SPECIAL stats (0=STR…6=LUK) are valid; CE treats others as script errors.
        // CE: an out-of-range stat or a null object leaves the roll at 0
        // (ROLL_CRITICAL_FAILURE); statRoll sets script->howMuch = value − d10.
        if (check < 0 || check > 6 || !isGameObject(obj)) {
            dbg('script', `do_check: stat index ${check} out of range (0–6); returning critical failure`)
            return RollResult.CriticalFailure
        }
        const critter = obj as Critter
        const statName = statMap[check]!
        const value = (typeof critter.getStat === 'function' ? critter.getStat(statName) : 0) + modifier
        const chance = getRandomInt(1, 10)
        this.howMuch = value - chance
        const roll = chance <= value ? RollResult.Success : RollResult.Failure
        dbg('script', `do_check: stat=${statName} base=${value} mod=${modifier} roll=${chance} → ${RollResult[roll]}`)
        return roll
    },
    is_success(this: Script, roll: number) {
        // FO2-CE ref: random.h — Success=2, CriticalSuccess=3
        const result = rollIsSuccess(roll as RollResult) ? 1 : 0
        dbg('script', `is_success(${RollResult[roll] ?? roll}) → ${result}`)
        return result
    },
    is_critical(this: Script, roll: number) {
        // FO2-CE ref: random.h — CriticalFailure=0, CriticalSuccess=3
        const result = rollIsCritical(roll as RollResult) ? 1 : 0
        dbg('script', `is_critical(${RollResult[roll] ?? roll}) → ${result}`)
        return result
    },
    critter_attempt_placement(this: Script, obj: Obj, tileNum: number, elevation: number) {
        // CE opCritterAttemptPlacement: the critter leaves its tile (tile 0) first, then
        // proto_instance.cc _obj_attempt_placement(critter, tile, elevation, 1)
        if (!isGameObject(obj) || !world.gMap) return -1
        if (tileNum === -1) return -1
        obj.position = fromTileNum(0)
        const placed = world.gMap.attemptPlacement(tileNum, elevation, 1)
        this.move_to(obj, placed, elevation)
        return 0
    },
    critter_state(this: Script, obj: Critter) {
        // CE ref: interpreter_extra.cc:2730 opGetCritterState
        // CRITTER_STATE_DEAD=1, CRITTER_STATE_PRONE=2, CRITTER_STATE_NORMAL=0
        // Plus cripple flags: leg_left=0x10, leg_right=0x20, arm_left=0x40, arm_right=0x80
        if (!isGameObject(obj)) {
            warn('critter_state: not game object: ' + obj)
            return 0
        }

        // CE opGetCritterState: an active critter is NORMAL, PRONE while its sprite
        // is a knockdown fall, plus its DAM_CRIP bits (0x04-0x40); an inactive one
        // (knocked out) is PRONE, a dead one DEAD.
        const c = obj as Critter
        if (c.dead === true || c.getStat('HP') <= 0) return 1 // CRITTER_STATE_DEAD
        const results = c.injuryFlags ?? 0
        if ((results & 0x01) !== 0) return 2 // knocked out: !critterIsActive → PRONE
        let state = c.knockdownAnim !== null && (results & 0x02) !== 0 ? 2 : 0
        state |= results & 0x7c // DAM_CRIP
        return state
    },
    // CE opKillCritter — critterKill(obj, deathFrame) without animation: the corpse
    // is the single-frame death `deathFrame` (ANIM_*_SF; others → LAST_SF_DEATH_ANIM).
    kill_critter(this: Script, obj: Critter, deathFrame: number) {
        log('kill_critter', [obj, deathFrame])
        critterKill(obj, undefined, false, { deathFrame }) // CE critterKill never runs destroy_p_proc
    },
    // CE opKillCritterType (0x80EE) — kill (or with deathFrame 0, destroy) every live,
    // visible critter of `pid` on the map. deathFrame 1 cycles CE's ftList.
    kill_critter_type(this: Script, pid: number, deathFrame: number) {
        // CE opKillCritterType: refused while a game loads
        if (loadingGame) return
        // interpreter_extra.cc:2367 ftList (single-frame deaths)
        const FT_LIST = [62, 51, 52, 53, 63, 62, 54, 56, 59, 62, 63]
        let ft = 0
        let count = 0
        for (const obj of world.gMap!.getObjects().slice()) {
            if (obj.type !== 'critter' || obj.pid !== pid || (obj as Critter).dead || obj.visible === false) continue
            if (++count > 200) {
                warn('kill_critter_type: infinite loop destroying critters!')
                return
            }
            const c = obj as Critter
            if (deathFrame === 0) {
                world.gMap!.destroyObject(c)
            } else {
                // CE _combat_delete_critter: critterKill below drops it from combat via its dead flag.
                let frame: number
                if (deathFrame === 1) {
                    frame = correctDeath(c, FT_LIST[ft])
                    ft = (ft + 1) % FT_LIST.length
                } else {
                    frame =
                        deathFrame >= ANIM_FALL_BACK_SF && deathFrame <= ANIM_FALL_FRONT_BLOOD_SF
                            ? deathFrame
                            : ANIM_FALL_BACK_SF
                }
                critterKill(c, undefined, false, { deathFrame: frame })
            }
        }
    },
    get_poison(this: Script, obj: Obj) {
        // FO2-CE ref: critter.cc critterGetPoison
        return (obj as Critter).poisonLevel ?? 0
    },
    get_pc_stat(this: Script, pcstat: number) {
        // FO2-CE ref: stat.cc pcGetStat() — PCSTAT constants from stat_defs.h
        switch (pcstat) {
            case 0: // PCSTAT_unspent_skill_points
                return world.player?.skills?.skillPoints ?? 0
            case 1: // PCSTAT_level
                return world.player?.getStat('Level') ?? 1
            case 2: // PCSTAT_experience
                return world.player?.getStat('Experience') ?? 0
            case 3: // PCSTAT_reputation
                return world.player?.stats.getBase('Reputation') ?? 0
            case 4: // PCSTAT_karma
                return world.player?.stats.getBase('Karma') ?? 0
            case 5: // PCSTAT_max_pc_stat (sentinel, always 5)
                return 5
            default:
                throw new Error(`get_pc_stat: unhandled ${pcstat}`)
        }
    },
    set_pc_stat(this: Script, pcstat: number, value: number) {
        // FO2-CE ref: stat.cc pcSetStat()
        const p = world.player
        if (!p) return -1
        switch (pcstat) {
            case 0: // PCSTAT_unspent_skill_points
                p.skills.skillPoints = Math.max(0, value)
                return 0
            case 1: // PCSTAT_level — direct set, no side effects
                p.stats.setBase('Level', Math.max(1, Math.min(99, value)))
                return 0
            case 2: {
                // PCSTAT_experience: below 0 refused (−2); a higher value runs the level-ups
                // (pcAddExperienceWithOptions(0)), a lower one pcSetExperience (level down)
                if (value < 0) return -2
                if (value >= p.stats.getBase('Experience')) {
                    p.stats.setBase('Experience', value)
                    p.addExperience?.(0)
                } else {
                    p.setExperienceLower?.(value)
                }
                return 0
            }
            case 3: // PCSTAT_reputation
                p.stats.setBase('Reputation', Math.max(-20, Math.min(20, value)))
                return 0
            case 4: // PCSTAT_karma
                p.stats.setBase('Karma', Math.max(-99999999, Math.min(99999999, value)))
                return 0
            case 5: // PCSTAT_max_pc_stat — sentinel count; CE pcSetStat returns -1
                return -1
            default:
                dbgWarn('script', `set_pc_stat: unknown pcstat ${pcstat}`)
                return -1
        }
    },
    mod_pc_stat(this: Script, pcstat: number, delta: number) {
        // FO2-CE ref: scripts.cc opModifyPcStat()
        const p = world.player
        if (!p) return -1
        switch (pcstat) {
            case 0: // PCSTAT_unspent_skill_points
                p.skills.skillPoints = Math.max(0, p.skills.skillPoints + delta)
                return 0
            case 1: {
                // PCSTAT_level
                const cur = p.stats.getBase('Level')
                p.stats.setBase('Level', Math.max(1, Math.min(99, cur + delta)))
                return 0
            }
            case 2: // PCSTAT_experience — addExperience triggers level-up loop
                p.addExperience(delta)
                return 0
            case 3: {
                // PCSTAT_reputation
                const cur = p.stats.getBase('Reputation')
                p.stats.setBase('Reputation', Math.max(-20, Math.min(20, cur + delta)))
                return 0
            }
            case 4: {
                // PCSTAT_karma
                const cur = p.stats.getBase('Karma')
                p.stats.setBase('Karma', Math.max(-99999999, Math.min(99999999, cur + delta)))
                return 0
            }
            case 5: // PCSTAT_max_pc_stat — sentinel; CE mod returns -1
                return -1
            default:
                dbgWarn('script', `mod_pc_stat: unknown pcstat ${pcstat}`)
                return -1
        }
    },
    critter_injure(this: Script, obj: Obj, how: number) {
        if (!isGameObject(obj)) {
            warn('critter_injure: not game object: ' + obj)
            return
        }
        // CE opCritterInjure: only the DAM_CRIP bits; DAM_PERFORM_REVERSE heals them.
        const c = obj as Critter
        const reverse = (how & 0x800000) !== 0
        const flags = how & 0x7c
        c.injuryFlags = (reverse ? c.injuryFlags & ~flags : c.injuryFlags | flags) >>> 0
        if (c.isPlayer && (flags & 0x30) !== 0) uiDrawWeapon() // interfaceUpdateItems
        info('critter_injure: ' + obj.name + ' flags=0x' + how.toString(16))
    },
    critter_is_fleeing(this: Script, obj: Obj) {
        if (!isGameObject(obj)) return 0
        return (obj as any).fleeing ? 1 : 0
    },
    // CE opCritterDamage → actions.cc actionDamage: bit 0x100 of the type bypasses
    // armor, 0x200 skips the animation; otherwise _compute_dmg_damage takes the
    // target's DT for the type, then its DR percent (never below 0). No knockback:
    // CE computes it only for CRITTER_NO_KNOCKBACK critters, which can't be knocked back.
    critter_dmg(this: Script, obj: Critter, damage: number, damageTypeWithFlags: number) {
        if (!isGameObject(obj)) {
            warn('critter_dmg: not game object: ' + obj)
            return
        }
        if (obj.type !== 'critter') {
            warn("critter_dmg: can't call on non-critters")
            return
        }
        const flags = Number(damageTypeWithFlags) | 0
        const animate = (flags & 0x200) === 0
        const bypassArmor = (flags & 0x100) !== 0
        const damageType = DAMAGE_TYPE_NAMES[flags & ~0x300] ?? 'Normal'
        let amount = damage
        if (!bypassArmor) {
            amount = damage - (obj.getStat('DT ' + damageType) + obj.getArmorDT(damageType))
            if (amount > 0)
                amount -= Math.trunc(((obj.getStat('DR ' + damageType) + obj.getArmorDR(damageType)) * amount) / 100)
            if (amount < 0) amount = 0
        }
        critterDamage(obj, amount, this.self_obj as Critter, true, animate, damageType, undefined, {
            scriptDamage: true,
        })
    },
    // CE opCritterHeal → critter.cc critterAdjustHitPoints: HP + amount, capped at max;
    // at 0 or below (a negative amount) the critter dies. Returns 0.
    critter_heal(this: Script, obj: Obj, amount: number) {
        if (!isGameObject(obj)) {
            warn('critter_heal: not game object: ' + obj)
            return 0
        }
        if (obj.type !== 'critter') return 0
        const c = obj as Critter
        const maxHp = c.getStat('Max HP')
        const newHp = c.getStat('HP') + amount
        c.stats.setBase('HP', Math.min(newHp, maxHp))
        if (newHp <= 0 && !c.dead) critterKill(c, undefined, false)
        if (c.isPlayer) updateIndicatorBar()
        info('critter_heal: ' + obj.name + ' ' + amount + ' HP')
        return 0
    },
    poison(this: Script, obj: Obj, amount: number) {
        // CE ref: interpreter_extra.cc opPoison → critter.cc:327 critterAdjustPoison.
        if (!isGameObject(obj) || obj.type !== 'critter') return
        adjustPoison(obj as Critter, amount)
    },
    radiation_inc(this: Script, obj: Obj, amount: number) {
        // CE ref: interpreter_extra.cc:2777 opRadiationIncrease → critter.cc:412
        // critterAdjustRadiation (player only; resistance, geiger, CRITTER_RADIATED).
        if (!isGameObject(obj) || obj.type !== 'critter') return
        critterAdjustRadiation(obj as Critter, amount)
    },
    radiation_dec(this: Script, obj: Obj, amount: number) {
        // CE ref: interpreter_extra.cc:2792 opRadiationDecrease.
        if (!isGameObject(obj) || obj.type !== 'critter') return
        const radiation = (obj as Critter).radiationLevel ?? 0
        critterAdjustRadiation(obj as Critter, radiation >= 0 ? -amount : 0)
    },
    critter_set_flee_state(this: Script, obj: Obj, isFleeing: number) {
        if (!isGameObject(obj)) {
            warn('critter_set_flee_state: not game object: ' + obj)
            return
        }
        info('critter_set_flee_state: ' + obj.name + ' fleeing=' + isFleeing)
        ;(obj as any).fleeing = !!isFleeing
    },
    // CE opCritterStopAttacking (0x8155) — CRITTER_MANEUVER_DISENGAGING, forget target.
    critter_stop_attacking(this: Script, obj: Obj) {
        if (!isGameObject(obj)) return
        const c = obj as Critter
        c.disengaging = true
        c.whoHitMe = null
        c.hostile = false
    },
    obj_can_see_obj(this: Script, a: Critter, b: Critter) {
        log('obj_can_see_obj', [a, b])
        if (!isGameObject(a) || !isGameObject(b)) {
            warn(`obj_can_see_obj: not game object: a=${a} b=${b}`, undefined, this)
            return 0
        }
        return +objCanSeeObj(a, b)
    },
    obj_can_hear_obj(this: Script, a: Obj, b: Obj) {
        // CE ref: interpreter_extra.cc:2620 opObjectCanHearObject (sfall-fixed form CE
        // ships): same elevation, both on valid tiles, and isWithinPerception(a, b).
        if (!isGameObject(a) || !isGameObject(b)) return 0
        if (a.type !== 'critter') return 0
        if (a.elevation !== b.elevation) return 0
        if (!a.position || !b.position) return 0
        return isWithinPerception(a as Critter, b) ? 1 : 0
    },
    // CE opSkillContest (0x80AD) — "not implemented" in CE too; returns 0.
    skill_contest(this: Script, _a: number, _b: number, _c: number) {
        dbgWarn('script', 'skill_contest: not implemented in CE either (returns 0)')
        return 0
    },
    // CE opHowMuch (0x80B1) — script->howMuch
    how_much(this: Script, _data: number) {
        return this.howMuch ?? 0
    },
    // CE opReactionInfluence (0x80B3) — reaction.cc _reaction_influence_ returns 0.
    reaction_influence(this: Script, _a: number, _b: number, _c: number) {
        return 0
    },
    // CE opGetGameDifficulty (0x812A) — settings.preferences.game_difficulty (0/1/2)
    game_difficulty(this: Script) {
        const d = Config.combat.gameDifficultyModifier
        return d === 75 ? 0 : d === 125 ? 2 : 1
    },
    // CE opGetCombatDifficulty (0x814F) — settings.preferences.combat_difficulty (0/1/2)
    combat_difficulty(this: Script) {
        const d = Config.combat.difficultyModifier
        return d === 75 ? 0 : d === 125 ? 2 : 1
    },
    // CE opGetRunningBurningGuy (0x812B)
    running_burning_guy(this: Script) {
        return Config.combat.runningBurningGuy === false ? 0 : 1
    },
}
