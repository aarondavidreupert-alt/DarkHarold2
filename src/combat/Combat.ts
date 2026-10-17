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

import { ammoGetCapacity, ammoGetQuantity, ammoSetQuantity, findReloadAmmo, weaponGetBurstRounds, weaponReload } from '../weaponAmmo.js'
import { AudioEngine } from '../audio.js'
import { Config } from '../config.js'
import { CriticalEffects } from '../criticalEffects.js'
import { critterDamage, critterKill, unarmedAttackAnim } from '../critter.js'
import { tickCombatTurn } from '../events.js'
import * as GameTime from '../gametime.js'
import { hexDirectionTo, hexDistance, hexFromScreen, hexInDirection, hexInDirectionDistance, hexLine, hexLineBeyond, hexNearestNeighbor, hexNeighbors, hexToScreen, Point } from '../geometry.js'
import globalState from '../globalState.js'
import { eventLogPush, dbg, dbgWarn } from '../logger.js'
import { cloneItem, createObjectWithPID, Critter, Obj } from '../object.js'
import { Player } from '../player.js'
import { Scripting } from '../scripting.js'
import { drawAC, drawAP, drawHP, uiDrawWeapon, uiEndCombat, uiEndButtonsGreenLights, uiEndButtonsRedLights, uiLog, uiStartCombat } from '../ui.js'
import { clamp, getMessage, getProtoMsg, getRandomInt, randomRoll, RollResult, rollIsSuccess, rollSkillCheck } from '../util.js'
import { randomBetween } from '../random.js'
import { toTileNum } from '../tile.js'
import { currentUnarmed, unarmedAPCost } from '../unarmed.js'
import { useDrug } from '../drugs.js'
import type { AiPacket } from '../aiPackets.js'
import { ANIM, CHARACTER_SOUND_EFFECT, playCharAnimSfx } from '../sfxNames.js'
import { ActionPoints } from './actionPoints.js'
import { AI, fleeHpThreshold } from './AI.js'
import { computeDamage } from './damage.js'
import { combatIsShotBlocked, nextShootObstacle } from './lineOfFire.js'
import { critterSetWhoHitMe, noteHit } from './whoHitMe.js'
import { lazyLoadImage } from '../images.js'
import { isWithinPerception } from '../perception.js'
import { loadPRO, makePID } from '../pro.js'
import {
    accountForPartialCover as _accountForPartialCover,
    getAmmoStats as _getAmmoStats,
    getHitChance as _getHitChance,
    getHitDistanceModifier as _getHitDistanceModifier,
    weaponAttackType,
} from './hitChance.js'

// Turn-based combat system

// Re-entry guard: prevents Combat.start() from firing while a combat instance
// is still tearing down (e.g. map-script callbacks during end() can otherwise
// immediately restart combat).
let combatActive = false
export function isCombatActive(): boolean { return combatActive }

/** Free-form combat trace, gated by Config.scripting.debugLogShowType.combat.
 *  Player-visible combat messages go through uiLog() — never mix the two.
 *  Structured events go through eventLogPush() so they survive into the save. */
function combatDebug(...args: any[]): void {
    dbg('combat', ...args)
}

function combatWarn(...args: any[]): void {
    dbgWarn('combat', ...args)
}

function actorName(c: Critter): string {
    return c.isPlayer ? 'you' : (c.name ?? c.art ?? 'unknown')
}

/**
 * Map a Weapon to the correct criticalFailTable key.
 * Rules (FO2 reference: item_w_compute_crit_fail_critter_to_weapon_type):
 *   unarmed → 'unarmed'
 *   melee   → 'melee'
 *   energy (Laser/Plasma/Electrical/EMP) → 'energy'
 *   flame   (Fire damage type) → 'flamers'
 *   explosive (Explosive damage type) → 'grenades'
 *   big-gun animCode 10 (Rocket Launcher) → 'rocketlauncher'
 *   everything else → 'firearms'
 */
// CE item.cc weaponGetCriticalFailureType — the proto's criticalFailureType (DH2
// `critFail`) selects the _cf_table row; no weapon (or -1) is row 0.
const CRIT_FAIL_TABLES = ['unarmed', 'melee', 'firearms', 'energy', 'grenades', 'rocketlauncher', 'flamers']
function getCritFailTableType(weapon: any): string {
    const type = weapon?.weapon?.pro?.extra?.critFail ?? -1
    return CRIT_FAIL_TABLES[type] ?? 'unarmed'
}

const PERK_WEAPON_PENETRATE = 60 // perk_defs.h

// CE combat.cc attackComputeDamage — the combat-difficulty damage modifier applies
// only to attackers outside the player's team.
function combatDifficultyDamageModifier(attacker: Critter): number {
    const player = globalState.player
    if (player && attacker.teamNum === player.teamNum) return 100
    return Config.combat.difficultyModifier
}

// CE item.cc weaponGetDamage — randomBetween(min, max + Melee Damage) for melee and
// unarmed attacks; sfall's Bonus HtH Damage fix (CE default on) also raises the
// player's minimum by 2 per rank.
function rollWeaponDamage(attacker: Critter, min: number, max: number, melee: boolean): number {
    if (!melee) return getRandomInt(min, max)
    if (attacker.isPlayer) min += 2 * attacker.perks.filter((p) => p === 'Bonus HtH Damage').length
    return getRandomInt(min, max + attacker.getStat('Melee'))
}

// A ranged miss (CE attack->tile and the accidental victim); `landing` is where a
// thrown item comes to rest.
interface RangedMiss {
    tile: Point
    victim: Critter | null
    landing: Point
}

// CE _combat_check_bad_shot results.
export type BadShot = 'ok' | 'noAmmo' | 'outOfRange' | 'notEnoughAp' | 'dead' | 'aimBlocked' | 'armCrippled' | 'bothArmsCrippled'

// Per-turn state of the CE AI port (Combat.doAITurn phases).
interface AiTurnState {
    phase: 'start' | 'drugs' | 'prefs' | 'attack' | 'end'
    target: Critter | null
    attempts: number
    drugUsed: boolean
    healed: boolean
    healSearchDone: boolean
    envSearched: boolean
    chemActive: boolean | null
    chemCount: number
    endStep: number
    whoHitSet: boolean
}

// CE item.cc gHealingItemPids: stimpak, super stimpak, healing powder.
const HEALING_PIDS = [40, 144, 273]

// CE combat_ai.cc _hp_run_away_value by run_away_mode (none … tourniquet).
const RUN_AWAY_HP_PCT: { [mode: string]: number } = {
    none: 0, coward: 25, finger_hurts: 40, bleeding: 60, not_feeling_good: 75, tourniquet: 100,
}

// CE AiPacket.min_hp — the flee threshold (_combat_ai: HP < min_hp). It is the ai.txt
// value; a party member's run-away setting (aiSetRunAwayMode) sets it to
// max HP − max HP × percent / 100.
function aiMinHp(obj: Critter, packet: AiPacket): number {
    const custom = obj.customAiOverrides?.runAwayMode
    if (custom !== undefined && RUN_AWAY_HP_PCT[custom] !== undefined) {
        const maxHp = obj.getStat('Max HP') ?? obj.getStat('HP')
        return maxHp - Math.trunc(maxHp * RUN_AWAY_HP_PCT[custom] / 100)
    }
    return packet.minHp
}

// CE AiPacket.hurt_too_much (_rmatchHurtVals): blind, crippled (any limb),
// crippled_legs, crippled_arms.
function aiHurtTooMuch(obj: Critter, packet: AiPacket): boolean {
    for (const h of packet.hurtTooMuch) {
        if (h === 'blind' && obj.isBlinded) return true
        const legs = obj.crippledLeftLeg || obj.crippledRightLeg
        const arms = obj.crippledLeftArm || obj.crippledRightArm
        if (h === 'crippled' && (legs || arms)) return true
        if (h === 'crippled_legs' && legs) return true
        if (h === 'crippled_arms' && arms) return true
    }
    return false
}

// CE combat_ai.cc aiCanUseItem: a primary chem desire, or — for a human / super mutant
// / ghoul / child with INT >= 3 — a healing item when HP is at the chem_use ratio.
function aiCanUseItem(obj: Critter, item: Obj, packet: AiPacket): boolean {
    if (packet.chemPrimaryDesire.includes(item.pid)) return true
    if (((obj.pro as any)?.extra?.bodyType ?? 0) !== 0) return false
    const kt = obj.killType ?? 0
    if (kt !== 0 && kt !== 1 && kt !== 2 && kt !== 3 && kt !== 4) return false
    if (obj.getStat('INT') < 3) return false
    if (!HEALING_PIDS.includes(item.pid)) return false
    const ratio = packet.chemUse === 'clean' ? 0 : packet.chemUse === 'stims_when_hurt_little' ? 60
        : packet.chemUse === 'stims_when_hurt_lots' ? 30 : 50
    const maxHp = obj.getStat('Max HP') ?? obj.getStat('HP')
    return obj.getStat('HP') <= Math.trunc(maxHp * ratio / 100)
}

// CE _inven_find_id after _ai_retrieve_object: the picked-up item in the inventory
// (addInventoryItem may stack it into an existing entry).
function inventoryCopyOf(obj: Critter, item: Obj): Obj | null {
    return obj.inventory.find((i) => i === item) ?? obj.inventory.find((i) => i.pid === item.pid) ?? null
}

// CE _ai_try_attack: ((defender->fid & 0xF000) >> 12) == 0 — nothing in the hand the
// critter fights with (its weapon code), read from the held item, not the sprite.
function defenderUnarmedNow(c: Critter): boolean {
    const w = c.equippedWeapon
    return !w || w.pid === undefined
}

// CE weaponGetAttackTypeForHitMode: a fist (no item) or no weapon is unarmed.
function attackTypeOf(weaponObj: Obj | null): 'unarmed' | 'melee' | 'throw' | 'ranged' | 'none' {
    if (!weaponObj || weaponObj.pid === undefined) return 'unarmed'
    return weaponAttackType(weaponObj)
}

// Returns true when the weapon can be fired (melee/unarmed always ok; ranged ok if rounds > 0)
function aiHaveAmmo(weaponObj: Obj | null): boolean {
    if (!weaponObj) return true // unarmed — always valid
    if (ammoGetCapacity(weaponObj as any) === 0) return true // melee/unarmed — no ammo needed
    return ammoGetQuantity(weaponObj as any) > 0
}

// Clears the DH2-only 'blue' neutral-critter outline (see
// Combat.refreshHighlights()) map-wide. Needed on combat end since neutral
// critters are never part of `this.combatants` — the normal per-combatant
// outline-clearing loops never reach them.
function clearNeutralOutlines(): void {
    if (!globalState.gMap) return
    for (const obj of globalState.gMap.getObjects()) {
        if (obj instanceof Critter && obj.outline === 'blue') {
            obj.outline = null
        }
    }
}

// A combat encounter
export class Combat {
    combatants: Critter[]
    playerIdx: number
    player: Player
    turnNum: number
    whoseTurn: number
    inPlayerTurn: boolean
    hasAttacked = false // set true when the first attack fires this combat session
    playerHadTurn = false // set true the first time the player's turn starts
    combatExps = 0 // CE _combat_exps: kill XP collected this combat, given at its end

    constructor(objects: Obj[], triggerTeams: Set<number> = new Set()) {
        // Gather a list of combatants (critters meeting a certain criteria)
        this.combatants = objects.filter((obj) => {
            if (obj instanceof Critter) {
                if (obj.dead || !obj.visible) return false
                // Enroll if: player, on a trigger team, or already actively hostile
                // (a critter marked hostile before combat started is a participant).
                if (!obj.isPlayer && !triggerTeams.has(obj.teamNum) && !obj.hostile) return false

                // NOTE: AI is initialized here for simplicity; could be moved to Critter later
                if (!obj.isPlayer && !obj.ai) obj.ai = new AI(obj)

                if (obj.stats === undefined) throw 'no stats'
                obj.dead = false
                obj.AP = new ActionPoints(obj)
                return true
            }

            return false
        }) as Critter[]

        // CE ref: stat.cc:572 — Sequence = 2*PER. Ties: player goes first, then by original array order.
        this.combatants.sort((a, b) => {
            const seqA = a.getStat('Sequence')
            const seqB = b.getStat('Sequence')
            if (seqA !== seqB) return seqB - seqA
            if (a.isPlayer) return -1
            if (b.isPlayer) return 1
            return 0
        })

        this.playerIdx = this.combatants.findIndex((x) => x.isPlayer)
        if (this.playerIdx === -1) throw "combat: couldn't find player?"

        this.player = this.combatants[this.playerIdx] as Player
        this.turnNum = 1
        this.whoseTurn = this.playerIdx - 1
        this.inPlayerTurn = true

        // Stop the player from walking combat is initiating
        this.player.clearAnim()

        if (!(window as any).__test?.fastMode) globalState.audioEngine.playSfxByName('icombat1')
        uiStartCombat()
    }

    log(msg: any) {
        // Combat-related debug log (browser console only, never game console)
        combatDebug(msg)
    }

    /** Load ammo stats for a loaded weapon. Returns defaults (X=1,Y=1,RM=0,ACmod=0) if no ammo.
     *  Vanilla: weaponGetAmmoDamageMultiplier / weaponGetAmmoDamageDivisor return 1/1 for no ammo. */
    getAmmoStats(weaponObj: Obj): { X: number; Y: number; RM: number; ACmod: number } {
        return _getAmmoStats(weaponObj)
    }

    accountForPartialCover(obj: Critter, target: Critter): number {
        return _accountForPartialCover(obj, target)
    }

    getHitDistanceModifier(obj: Critter, target: Critter, weapon: Obj): number {
        return _getHitDistanceModifier(obj, target, weapon)
    }

    getHitChance(obj: Critter, target: Critter, region: string, from?: Point, useDistance = true) {
        return _getHitChance(obj, target, region, from ?? obj.position, useDistance)
    }

    // CE combat.cc attackCompute — one randomRoll(accuracy, critical chance) decides
    // hit / miss / critical, then the perk and trait upgrades CE applies to it.
    // `critBonus`: the unarmed move's bonus critical chance (CE
    // unarmedGetBonusCriticalChance), rolled separately on a plain hit.
    rollHit(obj: Critter, target: Critter, region: string, hitBonus: number = 0,
            attackerName?: string, defenderName?: string, critBonus?: number): any {
        const hitChance = this.getHitChance(obj, target, region)
        const accuracy = hitChance.hit + hitBonus

        const aName = attackerName ?? actorName(obj)
        const dName = defenderName ?? actorName(target)
        if (attackerName) combatDebug(`${attackerName} → ${defenderName}: hitChance=${accuracy}% critChance=${hitChance.crit}%`)
        dbg('rolls', `${aName} attacks ${dName} — hit chance: ${accuracy}%`)

        let { roll, delta } = randomRoll(accuracy, hitChance.crit)
        const attackType = attackTypeOf(obj.equippedWeapon)

        if (roll === RollResult.Failure && this.isJinxed(obj, target) && randomBetween(0, 1) === 1) {
            roll = RollResult.CriticalFailure
        }
        if (roll === RollResult.Success && obj.isPlayer && (attackType === 'melee' || attackType === 'unarmed')) {
            if (obj.hasPerk('Slayer')) roll = RollResult.CriticalSuccess
            const bonus = critBonus ?? 0
            if (bonus !== 0 && randomBetween(1, 100) <= bonus) roll = RollResult.CriticalSuccess
        }
        if (roll === RollResult.Success && obj.isPlayer && attackType === 'ranged' && obj.hasPerk('Sniper')
            && randomBetween(1, 10) <= obj.getStat('LUK')) {
            roll = RollResult.CriticalSuccess
        }

        const logged = { actor: aName, action: 'attack-roll', target: dName, region, roll: delta, hitChance: accuracy, critChance: hitChance.crit }
        if (roll === RollResult.CriticalSuccess) {
            const c = this.computeCriticalHit(obj, target, region, obj.getStat('Better Criticals'), attackerName, defenderName)
            eventLogPush({ ...logged, result: 'crit', critLevel: c.level, message: `${aName} → ${dName}: critical hit (${region})` })
            return { hit: true, crit: c.level >= 0, DM: c.DM, msgID: c.msgID }
        }
        if (roll === RollResult.Success) {
            combatDebug(`hit: delta=${delta} vs ${accuracy}%`)
            dbg('rolls', `${aName} hits ${dName}! (margin ${delta}, target ${accuracy})`)
            eventLogPush({ ...logged, result: 'hit', message: `${aName} → ${dName}: hit (${region})` })
            return { hit: true, crit: false }
        }
        const isCrit = roll === RollResult.CriticalFailure
        combatDebug(`miss: delta=${delta} vs ${accuracy}%${isCrit ? ' (crit fail)' : ''}`)
        dbg('rolls', isCrit ? `${aName} CRITICALLY FAILS!` : `${aName} misses ${dName}. (margin ${delta}, target ${accuracy})`)
        eventLogPush({ ...logged, result: isCrit ? 'crit-miss' : 'miss',
            message: `${aName} → ${dName}: ${isCrit ? 'critical miss' : 'miss'} (${region})` })
        return { hit: false, crit: isCrit }
    }

    // CE ref: combat.cc:4102 attackComputeCriticalHit — non-uniform effect bands on
    // d100 + Better Criticals; the table effect is applied to the target and its damage
    // multiplier returned (melee weapons halve it, min 2).
    computeCriticalHit(obj: Critter, target: Critter, region: string, critModifier: number,
                       attackerName?: string, defenderName?: string): { DM: number; msgID: any; level: number } {
        // CRITTER_INVULNERABLE (0x400): no critical, normal x2
        if (((target.pro as any)?.extra?.flags ?? 0) & 0x400) return { DM: 2, msgID: null, level: -1 }
        const critRoll = getRandomInt(1, 100) + critModifier
        const critLevel = critRoll <= 20 ? 0
                        : critRoll <= 45 ? 1
                        : critRoll <= 70 ? 2
                        : critRoll <= 90 ? 3
                        : critRoll <= 100 ? 4
                        : 5
        combatDebug(`crit hit: critRoll=${critRoll} level=${critLevel}`)
        dbg('rolls', `${actorName(obj)} scores a CRITICAL HIT on ${actorName(target)}! (level ${critLevel})`)
        if (attackerName) uiLog(`${attackerName} scores a CRITICAL HIT on ${defenderName}! (level ${critLevel})`)
        const crit = CriticalEffects.getCritical(target.killType ?? 0, region, critLevel)
        const critStatus = crit.doEffectsOn(target)
        return { DM: critStatus.DM, msgID: critStatus.msgID, level: critLevel }
    }

    // CE combat.cc attackComputeCriticalFailure — the weapon proto's critical-failure
    // type picks the table row, d100 - 5 x (Luck - 5) the effect. The player gets no
    // effect before game day 6 (CE's critical time limit).
    private doCriticalFailure(obj: Critter, weapon: any, who: string): boolean {
        if (((obj.pro as any)?.extra?.flags ?? 0) & 0x400) return false // CRITTER_INVULNERABLE
        if (obj.isPlayer && Math.floor((globalState.gameTickTime ?? 0) / 864000) < 6) return false
        const chance = getRandomInt(1, 100) - 5 * (obj.getStat('LUK') - 5)
        const effect = chance <= 20 ? 0 : chance <= 50 ? 1 : chance <= 75 ? 2 : chance <= 95 ? 3 : 4

        uiLog(`${who} critically fails!`)
        combatDebug(`crit fail: effect=${effect} roll=${chance}`)

        const table = getCritFailTableType(weapon)
        const critFailEffect = CriticalEffects.criticalFailTable[table]?.[effect + 1]
            ?? CriticalEffects.criticalFailTable.unarmed[effect + 1]
        if (critFailEffect.length === 0) return false // _cf_table entry 0: no DAM_CRITICAL
        CriticalEffects.temporaryDoCritFail(critFailEffect, obj)
        return true
    }

    // Damage, combat_p_proc and death for one victim of a ranged attack. Returns false
    // if combat ended (a script stopped it), so the caller stops resolving.
    // `accidental`: not the intended target (spray extras, blast victims, stray shots).
    private applyRangedDamage(attacker: Critter, victim: Critter, damage: number, dmgType: string, accidental: boolean): boolean {
        critterDamage(victim, damage, attacker, true, true, dmgType)
        noteHit(victim, attacker, accidental)
        if (victim.isPlayer) drawHP(victim.getStat('HP'))
        if (!victim.dead && victim._script?.combat_p_proc) Scripting.combatEvent(victim, 'damage')
        if (!globalState.combat) return false
        if (victim.dead) this.perish(victim, attacker, dmgType)
        return true
    }

    /** Vanilla damage calculation (fallout2-ce attackComputeDamage, lines 4578-4615).
     *  Order: bonus → multiply → divide → halve → difficultyMod → subtract DT → apply DR%.
     *  All divisions are integer-truncated. */
    getDamageDone(obj: Critter, target: Critter, critMultiplier: number) {
        var weapon = obj.equippedWeapon
        if (!weapon) throw Error('getDamageDone: No weapon')
        var wep = weapon.weapon
        if (!wep) throw Error('getDamageDone: Weapon has no weapon data')
        var damageType = wep.getDamageType()

        // DT and DR from critter stat system (base + armor + bonuses, like critterGetStat)
        var DT = target.getStat('DT ' + damageType) + target.getArmorDT(damageType)
        var DR = target.getStat('DR ' + damageType) + target.getArmorDR(damageType)

        // DAM_BYPASS: reduce both DT and DR to 20% (does NOT apply to EMP)
        if (target.bypassArmorNextHit && damageType !== 'EMP') {
            DT = Math.trunc(20 * DT / 100)
            DR = Math.trunc(20 * DR / 100)
            target.bypassArmorNextHit = false
        } else {
            if (target.bypassArmorNextHit) target.bypassArmorNextHit = false
            // PERK_WEAPON_PENETRATE: only DT to 20%, DR unchanged
            if ((weapon as any).pro?.extra?.perk === PERK_WEAPON_PENETRATE) {
                DT = Math.trunc(20 * DT / 100)
            }
            // TRAIT_FINESSE: +30 DR penalty (player only)
            if (obj.isPlayer && ((obj as any).traits ?? []).includes('Finesse')) {
                DR += 30
            }
        }

        // Bonus Ranged Damage perk: +2 per rank (player only, ATTACK_TYPE_RANGED)
        const attackType = attackTypeOf(weapon)
        var damageBonus = 0
        if (obj.isPlayer && attackType === 'ranged') {
            const brdRank = obj.perks.filter(p => p === 'Bonus Ranged Damage').length
            damageBonus = 2 * brdRank
        }

        // Ammo stats
        var ammoStats = this.getAmmoStats(weapon)

        // Ammo DR modifier: added to DR, then clamp 0-100
        DR += ammoStats.RM
        DR = clamp(0, 100, DR)

        var CD = combatDifficultyDamageModifier(obj)

        // CE item.cc weaponGetDamage: melee and unarmed attacks add Melee Damage to the
        // maximum (and, sfall's Bonus HtH Damage fix, 2 per perk rank to the minimum).
        var RD = rollWeaponDamage(obj, wep.minDmg, wep.maxDmg, attackType === 'melee' || attackType === 'unarmed')
        var damage = computeDamage({ RD, bonus: damageBonus, critMult: critMultiplier, ammoX: ammoStats.X, ammoY: ammoStats.Y, ammoRM: ammoStats.RM, DT, DR, CD })

        // Post-calculation perks (flat bonuses after main formula)
        if (obj.isPlayer) {
            if (obj.hasPerk('Living Anatomy')) {
                var kt = target.killType ?? 0
                if (kt !== 10 && kt !== 16) { // not KILL_TYPE_ROBOT or KILL_TYPE_ALIEN
                    damage += 5
                }
            }
            if (obj.hasPerk('Pyromaniac') && damageType === 'Fire') {
                damage += 5
            }
        }

        // Vanilla-formula intermediates for the damage log (approximated when a non-vanilla ruleset is active)
        const _dmgBase = Math.trunc(Math.trunc(Math.trunc(Math.trunc((RD + damageBonus) * critMultiplier * ammoStats.X) / (ammoStats.Y || 1)) / 2) * CD / 100)
        const _dmgAdj = Math.max(0, _dmgBase - DT)
        dbg('damage', `RD: ${RD} | CM: ${critMultiplier} | ADR: ${DR} | ADT: ${DT} | Base: ${_dmgBase} | Adj: ${_dmgAdj} | Type: ${damageType} | Final: ${damage} (formula: max(RD*CM/2 - ADT, 0) * (1 - (ADR+RM)/100) * CD/100)`)
        combatDebug(`damage: RD=${RD} CM=${critMultiplier} ×${ammoStats.X}/${ammoStats.Y} DT=${DT} DR=${DR}% CD=${CD} → ${damage}`)
        eventLogPush({
            actor: actorName(obj), action: 'damage', target: actorName(target), result: 'computed',
            damage, RD, critMultiplier, ammoX: ammoStats.X, ammoY: ammoStats.Y,
            DT, DR, CD, damageType,
            weapon: weapon?.name ?? null,
            message: `${actorName(obj)} → ${actorName(target)}: ${damage} ${damageType} dmg`,
        })
        return damage
    }

    /** Vanilla unarmed damage calculation (attackComputeDamage with weapon=null).
     *  Unarmed: ammoMult=1, ammoDiv=1, damageType=Normal.
     *  Same formula as weapon damage: bonus → multiply → halve → DT → DR%. */
    getUnarmedDamageDone(obj: Critter, target: Critter, critMultiplier: number): number {
        const mode = currentUnarmed(obj).mode

        // Unarmed damage type is always Normal
        var DT = target.getStat('DT Normal') + target.getArmorDT('Normal')
        var DR = target.getStat('DR Normal') + target.getArmorDR('Normal')

        // DAM_BYPASS: reduce both DT and DR to 20%
        if (target.bypassArmorNextHit) {
            DT = Math.trunc(20 * DT / 100)
            DR = Math.trunc(20 * DR / 100)
            target.bypassArmorNextHit = false
        } else {
            // unarmedIsPenetrating: only DT to 20%, DR unchanged
            if (mode.penetrate) {
                DT = Math.trunc(20 * DT / 100)
            }
            // TRAIT_FINESSE: +30 DR penalty (player only)
            if (obj.isPlayer && ((obj as any).traits ?? []).includes('Finesse')) {
                DR += 30
            }
        }

        // Clamp DR to 0-100 (no ammo DR mod for unarmed)
        DR = clamp(0, 100, DR)

        var CD = combatDifficultyDamageModifier(obj)

        // CE item.cc weaponGetDamage (no weapon): bonus + min .. bonus + Melee Damage + max
        var RD = rollWeaponDamage(obj, mode.bonusDamage + mode.minDmg, mode.bonusDamage + mode.maxDmg, true)
        var damage = computeDamage({ RD, bonus: 0, critMult: critMultiplier, ammoX: 1, ammoY: 1, ammoRM: 0, DT, DR, CD })

        // Post-calculation perks
        if (obj.isPlayer) {
            if (obj.hasPerk('Living Anatomy')) {
                var kt = target.killType ?? 0
                if (kt !== 10 && kt !== 16) {
                    damage += 5
                }
            }
            // Pyromaniac doesn't apply (unarmed is Normal damage, not Fire)
        }

        dbg('damage', `Unarmed [${mode.name}]: RD=${RD} CM=${critMultiplier} ADR=${DR} ADT=${DT} → ${damage}`)
        combatDebug(`damage(unarmed [${mode.name}]): RD=${RD} CM=${critMultiplier} DT=${DT} DR=${DR}% CD=${CD} → ${damage}`)
        eventLogPush({
            actor: actorName(obj), action: 'damage', target: actorName(target), result: 'computed',
            damage, RD, critMultiplier, ammoX: 1, ammoY: 1, DT, DR, CD,
            damageType: 'Normal', weapon: `unarmed:${mode.name}`,
            message: `${actorName(obj)} → ${actorName(target)}: ${damage} dmg (unarmed ${mode.name})`,
        })
        return damage
    }

    getCombatMsg(id: number) {
        return getMessage('combat', id)
    }

    attack(obj: Critter, target: Critter, region = 'torso', callback?: () => void) {
        this.hasAttacked = true
        // turn to face the target
        var hex = hexNearestNeighbor(obj.position, target.position)
        if (hex !== null) obj.orientation = hex.direction

        var weaponObj = obj.equippedWeapon
        var who = obj.isPlayer ? 'You' : obj.name

        // Early ammo guard — no animation, no AP loss for any attacker
        if (!aiHaveAmmo(weaponObj)) {
            uiLog(`${who}: out of ammo!`)
            if (callback) callback()
            return
        }

        // Both arms crippled: can't attack at all
        if (obj.crippledLeftArm && obj.crippledRightArm) {
            uiLog(`${who} can't attack — both arms are crippled!`)
            if (callback) callback()
            return
        }

        // CE ref: actions.cc:629 _action_melee / _action_ranged — the weapon's ATTACK
        // sound is registered with delay 0 (frame 0); only the HIT sound and the damage
        // display wait for the action frame.
        const rawAttackSoundID = weaponObj?.pro?.extra?.soundID
        const attackSoundChar = typeof rawAttackSoundID === 'number' ? String.fromCharCode(rawAttackSoundID) : null
        if (attackSoundChar && !(window as any).__test?.fastMode) {
            const isBurstAttack = !!(weaponObj?.weapon?.isBurst?.())
            globalState.audioEngine.playWeaponSfx(attackSoundChar, isBurstAttack ? 'attack_burst' : 'attack')
        }
        // CE ref: actions.cc:625 — punches and kicks use sfxBuildCharName(attacker,
        // anim, UNUSED) instead of a weapon sound.
        if (weaponObj === null && !(window as any).__test?.fastMode) playCharAnimSfx(obj, unarmedAttackAnim(obj))

        // attack!
        // FA3 — CE ref: animation.cc / combat.cc _action_melee/_action_ranged: the hit,
        // impact sound and target reaction happen on the attacker's FRM action frame,
        // not on frame 0. resolveAttack() runs then (or at animation end at the latest,
        // always before the turn-continuation callback).
        // A ranged attack's projectile flies after the action frame (CE _action_ranged);
        // the turn continues once both the attack animation and the flight are done.
        let resolved = false
        let finished = false
        let animDone = false
        const proceed = (): void => {
            if (!animDone || !finished) return
            if (callback) callback()
            else obj.clearAnim()
        }
        const resolveAttack = (): void => {
            if (resolved) return
            resolved = true
            const deferred = this.resolveAttack(obj, target, region, weaponObj, who, () => { finished = true; proceed() })
            if (!deferred) finished = true
        }
        obj.staticAnimation('attack', () => { resolveAttack(); animDone = true; proceed() },
            undefined, undefined, resolveAttack)
    }

    // Second half of attack(): rolls, damage and reactions, run on the action frame.
    // Returns true when a projectile is in flight; `done` then runs after its impact.
    private resolveAttack(obj: Critter, target: Critter, region: string, weaponObj: Critter['equippedWeapon'], who: string,
                          done: () => void): boolean {

        var audio: AudioEngine = globalState.audioEngine
        var rawSoundID = weaponObj?.pro?.extra?.soundID
        var soundIdChar = typeof rawSoundID === 'number' ? String.fromCharCode(rawSoundID) : null

        var targetName = target.isPlayer ? 'you' : target.name
        var weapon = weaponObj?.weapon
        var attackDmgType = weaponObj?.weapon?.getDamageType() ?? 'Normal'

        // ── UNARMED (no weapon equipped) ──────────────────────────────────────
        if (weaponObj === null) {
            // CE combat.cc gUnarmedHitDescriptions — the hand's current hit mode
            var unarmedMode = currentUnarmed(obj).mode
            var unarmedModeName = unarmedMode.name

            var unarmedHit = this.rollHit(obj, target, region, 0, who, targetName, unarmedMode.critBonus)

            if (unarmedHit.hit === true) {
                var unarmedCritMod = unarmedHit.crit ? unarmedHit.DM : 2
                var unarmedDmg = this.getUnarmedDamageDone(obj, target, unarmedCritMod)
                var unarmedExtraMsg = unarmedHit.crit ? this.getCombatMsg(unarmedHit.msgID) || '' : ''
                uiLog(`${who} hits ${targetName} for ${unarmedDmg} damage (${unarmedModeName})${unarmedExtraMsg}`)
                // CE ref: actions.cc:637 — the hit sound is sfxBuildCharName(attacker, anim, CONTACT).
                if (!(window as any).__test?.fastMode) playCharAnimSfx(obj, unarmedAttackAnim(obj), CHARACTER_SOUND_EFFECT.contact)
                critterDamage(target, unarmedDmg, obj, true, true, 'Normal')
                noteHit(target, obj, false) // CE combat.cc:4706
                if (target.isPlayer) drawHP(target.getStat('HP'))
                if (!target.dead && target._script?.combat_p_proc) {
                    if (Scripting.combatEvent(target, 'damage')) return false
                }
                if (!globalState.combat) return false
                if (target.dead) this.perish(target, obj, 'Normal')
            } else {
                uiLog(`${who} misses ${targetName} (${unarmedModeName})`)
                if (!target.dead && !target.inAnim() && target.hasAnimation('dodge')) {
                    // CE ref: actions.cc:660 — sfxBuildCharName(defender, ANIM_DODGE_ANIM, UNUSED).
                    playCharAnimSfx(target, ANIM.dodge)
                    target.staticAnimation('dodge', () => target.clearAnim())
                }
                if (unarmedHit.crit === true) this.doCriticalFailure(obj, null, who)
            }
            return false
        }

        // ── BURST MODE ────────────────────────────────────────────────────────
        // CE combat.cc _compute_spray + _shoot_along_path (see resolveSpray).
        if (weapon && weapon.isBurst && weapon.isBurst()) {
            return this.resolveSpray(obj, target, weaponObj!, who, targetName, attackDmgType, done)
        }

        // ── SINGLE SHOT ───────────────────────────────────────────────────────
        var hitRoll = this.rollHit(obj, target, region, 0, who, targetName)
        const attackType = attackTypeOf(weaponObj)
        const thrown = attackType === 'throw'
        const isRangedType = attackType === 'ranged' || attackType === 'throw'
        const targetTile = { ...target.position }

        // Deduct one round after the roll
        if (weapon && weapon.type !== 'melee') {
            var roundsBefore = ammoGetQuantity(weaponObj as any)
            if (roundsBefore > 0) {
                ammoSetQuantity(weaponObj as any, roundsBefore - 1)
                uiDrawWeapon()
            }
        }

        // CE attackCompute decides everything before the animation: a critical failure
        // (DAM_CRITICAL only when its table entry has an effect) stops the shot; a plain
        // miss of a ranged/thrown attack flies on (attack->tile) and may hit someone else.
        let critical = false
        let miss: RangedMiss | null = null
        if (hitRoll.hit !== true) {
            critical = hitRoll.crit === true && this.doCriticalFailure(obj, weapon, who)
            if (!critical && isRangedType) miss = this.computeRangedMiss(obj, target, weaponObj!, attackDmgType)
        }
        // CE actions.cc _action_ranged: the projectile (for a throw, the weapon itself) is
        // registered when (DAM_HIT) or not (DAM_CRITICAL).
        const flies = isRangedType && (hitRoll.hit === true || !critical)
        const projectilePid = flies ? this.projectilePid(weaponObj!) : null
        const thrownItem = flies && thrown ? this.takeThrownItem(obj, weaponObj!) : null

        const impact = (): void => {
            if (hitRoll.hit === true) {
                if (thrownItem) this.placeThrownItem(thrownItem, targetTile, weaponObj!, attackDmgType)
                var critModifier = hitRoll.crit ? hitRoll.DM : 2
                var damage = this.getDamageDone(obj, target, critModifier)
                var extraMsg = hitRoll.crit === true ? this.getCombatMsg(hitRoll.msgID) || '' : ''
                uiLog(who + ' hit ' + targetName + ' for ' + damage + ' damage' + extraMsg)

                // Play impact sound
                if (!(window as any).__test?.fastMode) audio.playWeaponSfx(soundIdChar || '#', 'impact')

                critterDamage(target, damage, obj, true, true, attackDmgType)
                noteHit(target, obj, false) // CE combat.cc:4706
                if (target.isPlayer) drawHP(target.getStat('HP'))
                if (this.isExplosiveAttack(weaponObj!, attackDmgType)) {
                    this.explosionOnExtras(obj, target, target.position, weaponObj!, attackDmgType)
                    if (!globalState.combat) return
                }
                if (!target.dead && target._script?.combat_p_proc) {
                    if (Scripting.combatEvent(target, 'damage')) return
                }
                if (!globalState.combat) return
                if (target.dead) this.perish(target, obj, attackDmgType)
            } else {
                uiLog(who + ' missed ' + targetName + (hitRoll.crit === true ? ' critically' : ''))
                if (!(window as any).__test?.fastMode) audio.playSfxByName('cmbtflx')

                // CE actions.cc: a melee miss dodges (with its sound); a ranged miss only
                // when the weapon has no visible projectile.
                if (!projectilePid && !target.dead && !target.inAnim() && target.hasAnimation('dodge')) {
                    if (weapon?.type === 'melee') playCharAnimSfx(target, ANIM.dodge)
                    target.staticAnimation('dodge', () => target.clearAnim())
                }

                if (miss) {
                    this.applyRangedMiss(obj, miss, attackDmgType)
                    if (this.isExplosiveAttack(weaponObj!, attackDmgType)) {
                        this.explosionOnExtras(obj, miss.victim, miss.victim?.position ?? miss.tile, weaponObj!, attackDmgType)
                    }
                }
                if (thrownItem) this.placeThrownItem(thrownItem, miss ? miss.landing : targetTile, weaponObj!, attackDmgType)
            }
        }

        if (projectilePid !== null) {
            const dest = hitRoll.hit === true ? targetTile : (miss?.tile ?? targetTile)
            this.flyProjectile(obj, target, dest, projectilePid, () => { try { impact() } finally { done() } })
            return true
        }
        impact()
        return false
    }

    // CE attackCompute (SFALL form): explosive damage — or a thrown Plasma/EMP grenade —
    // runs _compute_explosion_on_extras.
    private isExplosiveAttack(weaponObj: Obj, dmgType: string): boolean {
        if (dmgType === 'Explosive') return true
        return weaponAttackType(weaponObj) === 'throw' && (dmgType === 'Plasma' || dmgType === 'EMP')
    }

    // CE combat.cc _compute_explosion_on_extras — walks rings around the impact (grenades
    // radius 2, rockets 3; CE item.cc defaults) and hits up to 6 live critters with a clear
    // line to the blast, one round at x2 each; the attacker included (DAM_BACKWASH). The
    // object at the centre already took the hit and is excluded.
    private explosionOnExtras(attacker: Critter, centerObj: Obj | null, center: Point, weaponObj: Obj, dmgType: string): void {
        const gMap = globalState.gMap
        if (!gMap) return
        this.spawnExplosionSprite(center)
        const isGrenade = weaponAttackType(weaponObj) === 'throw'
        const GRENADE_RADIUS = 2, ROCKET_RADIUS = 3, MAX_TARGETS = 6
        const SHOOT_THRU = 0x80000000
        const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y

        const victims: Critter[] = []
        let radius = 0
        let rotation = 0
        let tile: Point | null = null
        let ringFirst: Point | null = center
        let ringIdx = 0
        while (victims.length < MAX_TARGETS) {
            if (radius !== 0 && (tile === null || !same(tile = hexInDirection(tile, rotation), ringFirst!))) {
                ringIdx++
                if (ringIdx % radius === 0) {
                    rotation += 1
                    if (rotation === 6) rotation = 0 // ROTATION_NE
                }
            } else {
                radius++
                if (isGrenade && GRENADE_RADIUS < radius) tile = null
                else if (isGrenade || ROCKET_RADIUS >= radius) tile = hexInDirection(ringFirst!, 0) // ROTATION_NE
                else tile = null
                ringFirst = tile
                rotation = 2 // ROTATION_SE
                ringIdx = 0
            }
            if (tile === null) break

            const obstacle = gMap.blockingObjectAt(toTileNum(tile), attacker.elevation, 0, centerObj)
            if (obstacle === null || obstacle.type !== 'critter') continue
            const c = obstacle as Critter
            if (c.dead || ((((c as any).flags ?? 0) >>> 0) & SHOOT_THRU) !== 0) continue
            if (combatIsShotBlocked(c, c.position, center, null).blocked) continue
            if (!victims.includes(c)) victims.push(c)
        }

        for (const victim of victims) {
            const damage = this.getDamageDone(attacker, victim, 2)
            uiLog(`  ${victim.isPlayer ? 'you' : victim.name} caught in the blast for ${damage} damage`)
            if (!this.applyRangedDamage(attacker, victim, damage, dmgType, true)) return
        }
    }

    // Visual only: one explosion sprite at the impact (misc proto 14, as Obj.explode uses).
    private spawnExplosionSprite(pos: Point): void {
        if ((window as any).__test?.fastMode) return
        const sprite = createObjectWithPID(makePID(5 /* misc */, 14 /* Explosion */), -1)
        sprite.position = { x: pos.x, y: pos.y }
        lazyLoadImage(sprite.art, () => {
            if (!globalState.gMap) return
            globalState.gMap.addObject(sprite)
            sprite.singleAnimation(false, () => { globalState.gMap?.destroyObject(sprite) })
        })
    }

    // CE combat.cc _compute_spray (driven from attackCompute): one roll decides the
    // burst; the rounds split into a centre line (part aimed at the target) and two side
    // lines through tiles beside the target, each walked by _shoot_along_path, so anyone
    // on a line of fire can be hit — friends included.
    private resolveSpray(obj: Critter, target: Critter, weaponObj: Obj, who: string, targetName: string, dmgType: string,
                         done: () => void): boolean {
        const audio = globalState.audioEngine
        const weapon = (weaponObj as any).weapon
        const range = weapon.getMaximumRange()

        let ammoQuantity = ammoGetQuantity(weaponObj)
        const burstRounds = weaponGetBurstRounds(weaponObj)
        if (burstRounds < ammoQuantity) ammoQuantity = burstRounds
        const roundsSpent = ammoQuantity

        let { roll, mainHits, extras } = this.computeSpray(obj, target, ammoQuantity, range)

        // attackCompute: Jinxed turns a failure into a critical failure half the time.
        if (roll === RollResult.Failure && this.isJinxed(obj, target) && randomBetween(0, 1) === 1) {
            roll = RollResult.CriticalFailure
        }
        // Sniper (player, ranged): d10 <= Luck upgrades a success to a critical.
        if (roll === RollResult.Success && obj.isPlayer && obj.hasPerk('Sniper')
            && randomBetween(1, 10) <= obj.getStat('LUK')) {
            roll = RollResult.CriticalSuccess
        }

        ammoSetQuantity(weaponObj, ammoGetQuantity(weaponObj) - roundsSpent)
        uiDrawWeapon()

        let damageMultiplier = 2
        let extraMsg = ''
        if (roll === RollResult.CriticalSuccess) {
            const c = this.computeCriticalHit(obj, target, 'torso', obj.getStat('Better Criticals'), who, targetName)
            damageMultiplier = c.DM
            extraMsg = this.getCombatMsg(c.msgID) || ''
        }

        // As for single shots: the miss / critical-failure outcome first, then the flight.
        let critical = false
        let miss: RangedMiss | null = null
        if (!rollIsSuccess(roll)) {
            if (roll === RollResult.CriticalFailure) critical = this.doCriticalFailure(obj, weapon, who)
            if (!critical) miss = this.computeRangedMiss(obj, target, weaponObj, dmgType)
        }
        const targetTile = { ...target.position }

        const impact = (): void => {
            uiLog(`${who} burst-fired at ${targetName}: ${mainHits}/${roundsSpent} rounds on target`)
            if (rollIsSuccess(roll)) {
                if (mainHits > 0) {
                    let damage = 0
                    for (let i = 0; i < mainHits; i++) damage += this.getDamageDone(obj, target, damageMultiplier)
                    uiLog(`  ${targetName} took ${damage} damage${extraMsg}`)
                    if (!this.applyRangedDamage(obj, target, damage, dmgType, false)) return
                }
            } else {
                if (!(window as any).__test?.fastMode) audio.playSfxByName('cmbtflx')
                if (miss) this.applyRangedMiss(obj, miss, dmgType)
            }

            // Extras (_shoot_along_path): each takes its rounds at ×2.
            for (const [victim, rounds] of extras) {
                if (victim.dead) continue
                let damage = 0
                for (let i = 0; i < rounds; i++) damage += this.getDamageDone(obj, victim, 2)
                const victimName = victim.isPlayer ? 'you' : victim.name
                uiLog(`  ${victimName} took ${damage} damage`)
                if (!this.applyRangedDamage(obj, victim, damage, dmgType, true)) return
            }
        }

        const projectilePid = rollIsSuccess(roll) || !critical ? this.projectilePid(weaponObj) : null
        if (projectilePid !== null) {
            const dest = rollIsSuccess(roll) ? targetTile : (miss?.tile ?? targetTile)
            this.flyProjectile(obj, target, dest, projectilePid, () => { try { impact() } finally { done() } })
            return true
        }
        impact()
        return false
    }

    // CE combat.cc _compute_spray — the roll and the rounds per victim, no damage. Also
    // used by the AI safety check (_combat_safety_invalidate_weapon), as in CE.
    private computeSpray(obj: Critter, target: Critter, ammoQuantity: number, range: number): { roll: RollResult; mainHits: number; extras: Map<Critter, number> } {
        const chance = this.getHitChance(obj, target, 'torso')
        let accuracy = chance.hit
        let { roll } = randomRoll(accuracy, chance.crit)
        combatDebug(`spray: rounds=${ammoQuantity} accuracy=${accuracy} roll=${RollResult[roll]}`)

        const extras = new Map<Critter, number>() // victim → rounds that hit (attack->extras)
        let mainHits = 0

        if (roll !== RollResult.CriticalFailure) {
            if (roll === RollResult.CriticalSuccess) accuracy += 20

            // Non-sfall split (sfall's burst mod is off by default).
            let centerRounds = Math.trunc(ammoQuantity / 3)
            if (centerRounds === 0) centerRounds = 1
            const leftRounds = Math.trunc(ammoQuantity / 3)
            const rightRounds = ammoQuantity - centerRounds - leftRounds
            let mainTargetRounds = Math.trunc(centerRounds / 2)
            if (mainTargetRounds === 0) { mainTargetRounds = 1; centerRounds -= 1 }

            for (let i = 0; i < mainTargetRounds; i++) {
                if (rollIsSuccess(randomRoll(accuracy, 0).roll)) mainHits += 1
            }
            if (mainHits === 0 && this.checkRangedMiss(obj, target, range, 'torso')) mainHits = 1

            const mainEnd = hexLineBeyond(obj.position, target.position, range)
            mainHits += this.shootAlongPath(obj, target, mainEnd, centerRounds - mainHits, extras)

            const centerTile = hexDistance(obj.position, target.position) <= 3
                ? hexLineBeyond(obj.position, target.position, 3)
                : target.position
            const rotation = hexDirectionTo(centerTile, obj.position)
            const leftEnd = hexLineBeyond(obj.position, hexInDirection(centerTile, (rotation + 1) % 6), range)
            mainHits += this.shootAlongPath(obj, target, leftEnd, leftRounds, extras)
            const rightEnd = hexLineBeyond(obj.position, hexInDirection(centerTile, (rotation + 5) % 6), range)
            mainHits += this.shootAlongPath(obj, target, rightEnd, rightRounds, extras)

            if (roll !== RollResult.Failure || (mainHits <= 0 && extras.size <= 0)) {
                if (rollIsSuccess(roll) && mainHits === 0 && extras.size === 0) roll = RollResult.Failure
            } else {
                roll = RollResult.Success
            }
        }

        return { roll, mainHits, extras }
    }

    private isJinxed(obj: Critter, target: Critter): boolean {
        // CE: traitIsSelected(TRAIT_JINXED) || perkHasRank(gDude, PERK_JINXED) — both the
        // player's; DH2 keeps the attacker/target Pariah Dog check from rollHit.
        const player = globalState.player
        return !!player && (((player as any).traits?.includes('Jinxed') ?? false) || player.hasPerk('Jinxed')
            || obj.hasPerk('Pariah Dog') || target.hasPerk('Pariah Dog'))
    }

    // CE combat_ai.cc _caiHasWeapPrefType — _weapPrefOrderings[best_weapon + 1].
    private static readonly WEAP_PREF_ORDERINGS: { [best: string]: string[] } = {
        no_pref: ['ranged', 'throw', 'melee', 'unarmed'],
        melee: ['melee'],
        melee_over_ranged: ['melee', 'ranged'],
        ranged_over_melee: ['ranged', 'melee'],
        ranged: ['ranged'],
        unarmed: ['unarmed'],
        unarmed_over_throw: ['unarmed', 'throw'],
        random: [],
        never: [],
    }

    // CE combat_ai.cc _ai_search_inven_weap: the best weapon in the inventory (other
    // than the one in hand) the attacker can use right now. Only bipeds, robots and
    // PROTO_ID_0x1000098 search; _ai_best_weapon's blast-radius and team-safety terms
    // are left out. Static: the party-member control screen uses it too (checkAP false).
    static aiSearchInvenWeap(attacker: Critter, defender: Critter | null, checkAP = true): Obj | null {
        const bodyType = (attacker.pro as any)?.extra?.bodyType ?? 0
        if (bodyType !== 0 && bodyType !== 1 && attacker.pid !== 0x1000098) return null
        const packet = attacker.ai?.packet ?? new AI(attacker).packet
        const prefs = Combat.WEAP_PREF_ORDERINGS[packet.bestWeapon] ?? []
        const inHand = attacker.equippedWeapon
        const ap = attacker.AP?.getAvailableCombatAP() ?? 0
        let best: Obj | null = null
        for (const item of attacker.inventory) {
            const weapon = (item as any).weapon
            if (item.subtype !== 'weapon' || !weapon || item === inHand) continue
            if (checkAP && weapon.getAPCost(1) > ap) continue
            // _ai_can_use_weapon: the critter has the attack FRM, enough skill, and the
            // attack type is one the packet's best_weapon allows
            const attackArt = attacker.getBase() + weapon.getAnim('attack')
            if (!globalState.imageInfo[attackArt]) continue
            if (attacker.getSkill(weapon.weaponSkillType) < packet.minToHit) continue
            const attackType = weaponAttackType(item)
            if (!prefs.includes(attackType)) continue
            if (attackType === 'ranged' && !aiHaveAmmo(item) && !findReloadAmmo(attacker as any, item as any)) continue
            best = Combat.aiBestWeapon(packet, best, item)
        }
        return best
    }

    // CE combat_ai.cc _ai_search_inven_armor: party members only — the inventory armor
    // with the highest AC + Σ(DR + DT) over all damage types, if it beats the worn one.
    static aiSearchInvenArmor(critter: Critter): Obj | null {
        if (!globalState.gParty?.isPartyMember(critter)) return null
        const DAMAGE_TYPES = ['Normal', 'Laser', 'Fire', 'Plasma', 'Electrical', 'EMP', 'Explosive']
        const score = (a: Obj): number => {
            const ex = (a as any).pro?.extra ?? {}
            let v = ex.AC ?? 0
            for (const t of DAMAGE_TYPES) v += (ex.stats?.['DR ' + t] ?? 0) + (ex.stats?.['DT ' + t] ?? 0)
            return v
        }
        const armor = critter.getEquippedArmor()
        let armorScore = armor ? score(armor) : 0
        let bestArmor: Obj | null = null
        for (const candidate of critter.inventory) {
            if (candidate.subtype !== 'armor' || candidate === armor) continue
            const v = score(candidate)
            if (v > armorScore) {
                armorScore = v
                bestArmor = candidate
            }
        }
        return bestArmor
    }

    // CE combat_ai.cc _ai_best_weapon — preference order of the attack type first, then
    // average damage (x2 with a weapon perk), then cost.
    private static aiBestWeapon(packet: AiPacket, w1: Obj | null, w2: Obj): Obj | null {
        const best = packet.bestWeapon
        if (best === 'random') return randomBetween(1, 100) <= 50 ? w1 : w2
        if (!w1) return w2
        const prefs = Combat.WEAP_PREF_ORDERINGS[best] ?? []
        const score = (w: Obj) => {
            const ex = (w as any).pro?.extra ?? {}
            let avg = Math.trunc(((ex.minDmg ?? 0) + (ex.maxDmg ?? 0)) / 2)
            if ((ex.perk ?? -1) !== -1) avg *= 2
            const order = prefs.indexOf(weaponAttackType(w))
            return { avg, order: order === -1 ? 999 : order, cost: ex.cost ?? 0 }
        }
        const a = score(w1), b = score(w2)
        if (a.order === b.order) {
            if (a.order === 999) return null
            if (Math.abs(b.avg - a.avg) <= 5) return b.cost > a.cost ? w2 : w1
            return b.avg > a.avg ? w2 : w1
        }
        if ((best === 'no_pref' || best === 'unarmed_over_throw') && Math.abs(b.avg - a.avg) > 5) {
            return b.avg > a.avg ? w2 : w1
        }
        return a.order > b.order ? w2 : w1
    }

    // CE combat_ai.cc _ai_try_attack → _ai_switch_weapons: with nothing in hand the AI
    // wields its best inventory weapon (_inven_wield, HAND_RIGHT). It keeps punching
    // only if the target is an unarmed biped it can punch (throw-punch FRM) and within
    // reach; out of reach CE switches too (COMBAT_BAD_SHOT_OUT_OF_RANGE, weapon ==
    // nullptr). Returns true if a weapon was wielded.
    private aiWieldInventoryWeapon(attacker: Critter, defender: Critter): boolean {
        const inHand = attacker.equippedWeapon
        if (inHand && inHand.pid !== undefined) return false
        const defenderBiped = ((defender.pro as any)?.extra?.bodyType ?? 0) === 0
        const defenderUnarmed = defenderUnarmedNow(defender) // CE: the fid's weapon code is 0
        const canPunch = !!globalState.imageInfo[attacker.getBase() + 'ap']
        const punchRange = inHand?.weapon?.getMaximumRange(1) ?? 1
        const inReach = hexDistance(attacker.position, defender.position) <= punchRange
        if (defenderBiped && defenderUnarmed && canPunch && inReach) return false
        const weapon = Combat.aiSearchInvenWeap(attacker, defender)
        if (!weapon) return false
        const a = attacker as any
        a.rightHand = weapon
        a.activeHand = 'rightHand'
        attacker.setIdleArt()
        dbg('ai', `[AI] ${actorName(attacker)} wields ${weapon.name} (CE _ai_switch_weapons)`)
        return true
    }

    // CE combat_ai.cc _ai_pick_hit_mode. DH2 weapons only expose a burst secondary,
    // so 'secondary' means burst.
    private aiPickHitMode(attacker: Critter, weaponObj: Obj, defender: Critter): 'primary' | 'secondary' {
        const weapon = (weaponObj as any).weapon
        // Any secondary attack (burst, a spear's throw, …) that the critter can use
        // (_ai_can_use_weapon: the attack FRM exists).
        const secondaryMode = Combat.secondaryModeName(weapon)
        if (secondaryMode === null) return 'primary'
        const packet = attacker.ai?.packet
        if (!packet) return 'primary'
        const withSecondary = <T>(fn: () => T): T => {
            const prev = weapon.mode
            weapon.mode = secondaryMode
            try { return fn() } finally { weapon.mode = prev }
        }
        if (!withSecondary(() => !!globalState.imageInfo[attacker.getAnimation('attack')])) return 'primary'

        const secondaryToHit = (): number => withSecondary(() => this.getHitChance(attacker, defender, 'torso').hit)
        const safe = () => !this.combatSafetyInvalidateWeapon(attacker, weaponObj, 'secondary', defender, false)
        const freq = Math.max(1, packet.secondaryFreq || 1)

        let useSecondary = false
        switch (packet.areaAttackMode) {
            case 'always': useSecondary = true; break
            case 'sometimes': useSecondary = randomBetween(1, freq) === 1; break
            case 'be_sure': useSecondary = secondaryToHit() >= 85 && safe(); break
            case 'be_careful': useSecondary = secondaryToHit() >= 50 && safe(); break
            case 'be_absolutely_sure': useSecondary = secondaryToHit() >= 95 && safe(); break
            default: // no_pref (-1)
                if (attacker.getStat('INT') < 6 || hexDistance(attacker.position, defender.position) < 10) {
                    useSecondary = randomBetween(1, freq) === 1
                }
        }
        if (useSecondary && !(Combat.WEAP_PREF_ORDERINGS[packet.bestWeapon] ?? []).includes('ranged')) useSecondary = false
        // SFALL fixes kept by CE: range and AP of the secondary mode.
        if (useSecondary && hexDistance(attacker.position, defender.position) > weapon.getMaximumRange(2)) useSecondary = false
        if (useSecondary && (attacker.AP?.getAvailableCombatAP() ?? 0) < weapon.getAPCost(2)) useSecondary = false
        return useSecondary ? 'secondary' : 'primary'
    }

    // The Weapon mode naming a weapon's secondary attack: 'burst' for burst /
    // continuous fire, 'secondary' for any other; null without one.
    static secondaryModeName(weapon: any): string | null {
        const mode = weapon?.attackModeOf?.(2) ?? 0
        if (mode === 0) return null
        return mode === 7 || mode === 8 ? 'burst' : 'secondary'
    }

    // CE combat.cc _combat_safety_invalidate_weapon_func — true if the attack would
    // hurt the attacker's team: a blast weapon with a team-mate (or, without a safe-
    // distance out-param, the attacker) inside its radius, or a spray whose simulated
    // extras include a team-mate. The DR × (maxDmg - DT) test is CE's literal formula.
    // `withSafeDistance` mirrors CE passing safeDistancePtr: the attacker standing in its
    // own blast then isn't disqualifying (CE would step back first; DH2 doesn't).
    private combatSafetyInvalidateWeapon(attacker: Critter, weaponObj: Obj, hitMode: 'primary' | 'secondary',
                                         defender: Critter, withSafeDistance: boolean): boolean {
        const weapon = (weaponObj as any).weapon
        if (!weapon) return false
        const team = attacker.teamNum
        const damageType = weapon.getDamageType()
        const maxDamage = weapon.maxDmg ?? 0
        const hurts = (c: Critter) => {
            const dt = c.getStat('DT ' + damageType) + c.getArmorDT(damageType)
            const dr = c.getStat('DR ' + damageType) + c.getArmorDR(damageType)
            return Math.trunc(dr * (maxDamage - dt) / 100) > 0
        }
        const isTeamMate = (c: Critter) => c.teamNum === team && c !== attacker && c !== defender && !c.dead
            && c !== (c as any).whoHitMe

        // weaponGetDamageRadius: rockets (single-fire Explosive) 3, grenades 2.
        const attackType = weaponAttackType(weaponObj)
        let damageRadius = 0
        if (hitMode === 'primary' && attackType === 'ranged' && damageType === 'Explosive') damageRadius = 3
        else if (attackType === 'throw' && this.isExplosiveAttack(weaponObj, damageType)) damageRadius = 2

        if (damageRadius > 0) {
            const intelligence = attacker.getStat('INT')
            if (intelligence < 5) damageRadius = Math.max(0, damageRadius - (5 - intelligence))
            for (const c of this.combatants) {
                if (isTeamMate(c) && hexDistance(defender.position, c.position) < damageRadius && hurts(c)) return true
            }
            if (hexDistance(defender.position, attacker.position) <= damageRadius) return !withSafeDistance
            return false
        }

        if (hitMode !== 'secondary') return false // only burst/continuous sprays
        const ammo = Math.min(ammoGetQuantity(weaponObj), weaponGetBurstRounds(weaponObj))
        const prev = weapon.mode
        weapon.mode = 'burst'
        const { extras } = this.computeSpray(attacker, defender, ammo, weapon.getMaximumRange(2))
        weapon.mode = prev
        for (const c of extras.keys()) if (isTeamMate(c) && hurts(c)) return true
        return false
    }

    // CE combat.cc _shoot_along_path — walks the line of fire from the attacker to
    // `endTile`; each critter met rolls its own to-hit per remaining round. Rounds on the
    // main target are returned; others accumulate in `extras` (max 6 victims).
    private shootAlongPath(attacker: Critter, defender: Critter, endTile: Point, rounds: number, extras: Map<Critter, number>): number {
        let remaining = rounds
        let mainHits = 0
        let current = attacker.position
        let critter: Obj | null = attacker
        while (critter !== null) {
            if (remaining <= 0 || (current.x === endTile.x && current.y === endTile.y) || extras.size >= 6) break
            critter = nextShootObstacle(attacker, current, endTile, critter)
            if (critter === null) break
            if (critter.type !== 'critter') break

            const accuracy = this.getHitChance(attacker, critter as Critter, 'torso').hit
            let roundsHit = 0
            while (randomBetween(1, 100) <= accuracy && remaining > 0) {
                remaining -= 1
                roundsHit += 1
            }
            if (roundsHit !== 0) {
                if (critter === defender) mainHits += roundsHit
                else extras.set(critter as Critter, (extras.get(critter as Critter) ?? 0) + roundsHit)
            }
            current = critter.position
        }
        return mainHits
    }

    // CE combat.cc _check_ranged_miss — looks for someone on the line of fire to take a
    // missed shot. Vanilla quirk kept by CE: the final test requires OBJECT_SHOOT_THRU on
    // the obstacle, which the shoot-mode walk never returns, so it rolls but never hits.
    private checkRangedMiss(attacker: Critter, defender: Critter, range: number, region: string): boolean {
        const to = hexLineBeyond(attacker.position, defender.position, range)
        let success = false
        let critter: Obj | null = attacker
        let curr = attacker.position
        while (curr.x !== to.x || curr.y !== to.y) {
            critter = nextShootObstacle(attacker, curr, to, critter)
            if (critter === null) break
            if (critter.type !== 'critter') { success = true; break }
            if (critter !== defender) {
                const c = critter as Critter
                const chance = c.dead ? 5 : Math.trunc(this.getHitChance(attacker, c, region).hit / 3)
                if (randomBetween(1, 100) <= chance) { success = true; break }
            }
            curr = critter.position
        }
        const SHOOT_THRU = 0x80000000
        if (!success || critter === null || ((((critter as any).flags ?? 0) >>> 0) & SHOOT_THRU) === 0) return false
        return false // unreachable in practice (see above)
    }

    // CE combat.cc attackCompute, ranged/throw tail: a shot that hit nothing flies on to
    // _tile_num_beyond(attacker, defender, range) (a grenade lands up to distance/2 away
    // in a random direction); the first shoot-blocking object past the defender — or
    // whatever blocks the landing tile — takes one round at ×2.
    // CE combat.cc attackCompute, ranged miss tail: the shot flies on to _tile_num_beyond
    // (grenades scatter up to distance/2 around the target); the first shoot-blocker past
    // the target becomes attack->tile and, if it is a live critter, the accidental victim.
    // Pure — the damage is applied by applyRangedMiss after the projectile arrived.
    private computeRangedMiss(attacker: Critter, defender: Critter, weaponObj: Obj, dmgType: string): RangedMiss | null {
        const gMap = globalState.gMap
        const weapon = (weaponObj as any).weapon
        if (!gMap || !weapon) return null
        const range = weapon.getMaximumRange()
        if (this.checkRangedMiss(attacker, defender, range, 'torso')) return null

        const isGrenade = weaponAttackType(weaponObj) === 'throw'
            && (dmgType === 'Explosive' || dmgType === 'Plasma' || dmgType === 'EMP')
        let tile: Point
        if (isGrenade) {
            const distance = hexDistance(attacker.position, defender.position)
            const throwDistance = Math.max(1, randomBetween(1, Math.max(1, Math.trunc(distance / 2))))
            tile = hexInDirectionDistance(defender.position, randomBetween(0, 5), throwDistance)
        } else {
            tile = hexLineBeyond(attacker.position, defender.position, range)
        }

        let accidental: Obj | null = gMap.straightPathObstacle(defender, defender.position, tile, 1, defender)
        if (accidental === null || accidental === defender) {
            accidental = gMap.blockingObjectAt(toTileNum(tile), defender.elevation, 0, null)
        }
        const SHOOT_THRU = 0x80000000
        if (accidental === null || ((((accidental as any).flags ?? 0) >>> 0) & SHOOT_THRU) !== 0) {
            return { tile, victim: null, landing: tile }
        }
        // A wall or scenery blocker: a thrown item comes to rest on the hex before it.
        if (accidental.type !== 'critter') {
            const line = hexLine(defender.position, accidental.position) ?? []
            const before = line.length >= 2 ? line[line.length - 2] : defender.position
            return { tile: { ...accidental.position }, victim: null, landing: { x: before.x, y: before.y } }
        }
        // Only critters take damage in DH2 (CE's damage to scenery has no effect either).
        const victim = accidental as Critter
        const pos = { ...victim.position }
        if (victim.dead || victim === attacker) return { tile: pos, victim: null, landing: pos }
        return { tile: pos, victim, landing: pos }
    }

    // attackComputeDamage(attack, 1, 2) on the accidental victim of a miss.
    private applyRangedMiss(attacker: Critter, miss: RangedMiss, dmgType: string): void {
        const victim = miss.victim
        if (!victim || victim.dead) return
        const damage = this.getDamageDone(attacker, victim, 2)
        const who = attacker.isPlayer ? 'You' : attacker.name
        uiLog(`${who} hit ${victim.isPlayer ? 'you' : victim.name} instead for ${damage} damage!`)
        this.applyRangedDamage(attacker, victim, damage, dmgType, true)
    }

    // The proto pid of the weapon's projectile when it has a visible one (CE
    // _action_ranged: weaponGetProjectilePid, projectileProto->fid != -1).
    private projectilePid(weaponObj: Obj): number | null {
        const pid = (weaponObj as any).pro?.extra?.projPID
        if (pid === undefined || pid === null || pid < 0) return null
        const pro = loadPRO(pid, pid & 0xffff)
        if (!pro || pro.frmPID === undefined || pro.frmPID === -1) return null
        return pid
    }

    // CE animation.cc _make_straight_path_func (a6 = 32 for non-critters): a Bresenham
    // line in screen pixels between the two hex centres, one node every 32 steps.
    private straightPathNodes(from: Point, to: Point): { tile: Point; x: number; y: number }[] {
        const center = (t: Point) => { const p = hexToScreen(t.x, t.y); return { x: p.x, y: p.y - 1 } }
        const a = center(from), b = center(to)
        const stepX = Math.sign(b.x - a.x), stepY = Math.sign(b.y - a.y)
        const ddx = 2 * Math.abs(b.x - a.x), ddy = 2 * Math.abs(b.y - a.y)
        let x = a.x, y = a.y, count = 0
        const nodes: { tile: Point; x: number; y: number }[] = []
        const record = () => {
            if (++count !== 32) return
            count = 0
            const tile = hexFromScreen(x, y)
            const c = center(tile)
            nodes.push({ tile, x: x - c.x, y: y - c.y })
        }
        if (ddx <= ddy) {
            let middle = ddx - ddy / 2
            for (;;) {
                record()
                if (y === b.y || nodes.length >= 200) break
                if (middle >= 0) { x += stepX; middle -= ddy }
                y += stepY
                middle += ddx
            }
        } else {
            let middle = ddy - ddx / 2
            for (;;) {
                record()
                if (x === b.x || nodes.length >= 200) break
                if (middle >= 0) { y += stepY; middle -= ddx }
                x += stepX
                middle += ddy
            }
        }
        return nodes
    }

    // CE actions.cc _action_ranged + animation.cc animateMoveObjectToTileStraight /
    // _object_straight_move: the projectile appears on the hex next to the attacker
    // (_combat_bullet_start), faces the target and moves one path node per frame at the
    // FRM's fps (+ combat speed in combat, ANIM_WALK), cycling its frames; on arrival it
    // is removed and `onArrive` applies the impact.
    private flyProjectile(attacker: Critter, target: Critter, dest: Point, pid: number, onArrive: () => void): void {
        const gMap = globalState.gMap
        if (!gMap || (window as any).__test?.fastMode) return onArrive()
        const rotation = hexDirectionTo(attacker.position, target.position)
        const start = hexInDirection(attacker.position, rotation)
        const nodes = start ? this.straightPathNodes(start, dest) : []
        if (!start || nodes.length === 0) return onArrive()

        const proj = createObjectWithPID(pid, -1)
        proj.position = { ...start }
        proj.orientation = rotation
        proj.frame = 0
        lazyLoadImage(proj.art, () => {
            if (globalState.gMap !== gMap) return onArrive()
            gMap.addObject(proj)
            proj.shift = { x: 0, y: 0 }
            const info = globalState.imageInfo[proj.art]
            const fps = (info?.fps || 10) + (globalState.inCombat ? Config.combat.combatSpeed : 0)
            // Shown on the start hex for one frame, then one node per frame; the last node
            // stays visible for a frame before the projectile is removed (CE hides it in
            // the next animation step).
            let index = 0
            let last = window.performance.now()
            proj.updateAnim = function (this: Obj): void {
                const now = window.performance.now()
                if (now - last < 1000 / fps) return
                last = now
                if (index >= nodes.length) {
                    this.updateAnim = () => {}
                    gMap.destroyObject(this)
                    onArrive()
                    return
                }
                if (info && info.numFrames > 1) this.frame = (this.frame + 1) % info.numFrames
                const node = nodes[index++]
                this.position = { x: node.tile.x, y: node.tile.y }
                this.shift = { x: node.x, y: node.y }
            }
        })
    }

    // CE actions.cc _action_ranged (ANIM_THROW_ANIM): itemRemove(attacker, weapon, 1)    // CE actions.cc _action_ranged (ANIM_THROW_ANIM): itemRemove(attacker, weapon, 1)
    // makes one item of the stack the projectile while the rest stays in the hand
    // (itemReplace); it lands on `landing` — the target's tile on a hit, where the miss
    // stopped otherwise — and stays there. Grenades (explosive / plasma / EMP) explode
    // and are gone.
    private takeThrownItem(attacker: Critter, weaponObj: Obj): Obj | null {
        if (weaponObj.pid === undefined) return null
        const a = attacker as any
        let item: Obj
        if ((weaponObj.amount ?? 1) > 1) {
            weaponObj.amount -= 1
            item = createObjectWithPID(weaponObj.pid)
            item.amount = 1
        } else {
            const idx = attacker.inventory.indexOf(weaponObj)
            if (idx !== -1) attacker.inventory.splice(idx, 1)
            for (const hand of ['leftHand', 'rightHand']) {
                if (a[hand] === weaponObj) a[hand] = attacker.isPlayer ? undefined : Critter.makeFist()
            }
            item = weaponObj
        }
        if (attacker.isPlayer) uiDrawWeapon()
        return item
    }

    private placeThrownItem(item: Obj, landing: Point, weaponObj: Obj, dmgType: string): void {
        const gMap = globalState.gMap
        if (!gMap || this.isExplosiveAttack(weaponObj, dmgType)) return
        gMap.addObject(item)
        item.move({ x: landing.x, y: landing.y }, gMap.getObjects().length - 1, false)
    }

    perish(obj: Critter, attacker?: Critter, damageType?: string) {
        const victimDisplay = obj.isPlayer ? 'You' : obj.name
        const attackerDisplay = attacker ? (attacker.isPlayer ? 'you' : attacker.name) : 'something'
        uiLog(`${victimDisplay} is killed by ${attackerDisplay}!`)
        eventLogPush({
            actor: attacker ? actorName(attacker) : null,
            action: 'death', target: actorName(obj), result: 'dead',
            damageType: damageType ?? null,
            message: `${victimDisplay} killed by ${attackerDisplay}`,
        })
        // critterDamage has normally killed it already (death anim + its CE DIE sound,
        // critter/lifecycle.ts); guard against a path that didn't.
        if (!obj.dead) critterKill(obj, attacker, undefined, { animate: true }, damageType)

        // CE combat_ai.cc _combatai_notify_onlookers: a critter not yet in the fight that
        // sees the death but not the killer remembers the body ("Somebody died and I don't
        // know why! Run!!!") and moves away from it on its turns.
        const killer: Critter | null = attacker ?? (obj as any).whoHitMe ?? null
        for (const c of this.combatants) {
            if (c === obj || c.dead || c.isPlayer || c.hostile) continue
            if (this.isWithinPerception(c, obj) && !this.isWithinPerception(c, killer)) (c as any).aiFriendlyDead = obj
        }

        // Inventory stays on the critter — the player loots it via the context menu,
        // just like a container.

        // CE combat.cc _damage_object: a kill by the player or the player's team adds
        // the victim's proto experience to _combat_exps unless its destroy_p_proc
        // overrode it; _combat_over hands it out.
        const player = globalState.player
        if (attacker && player && !obj.isPlayer && (attacker.isPlayer || attacker.teamNum === player.teamNum)
            && !obj._script?._didOverride) {
            this.combatExps += (obj.pro?.extra as any)?.XPValue ?? 0
        }
    }

    // CE combat.cc _combat_give_exps — "%s you earn %d exp. points." with a random
    // prefix (622-625), or 626 when unhurt (35%).
    private giveExps(): void {
        const xp = this.combatExps
        this.combatExps = 0
        const player = this.player
        if (xp <= 0 || !player || player.dead) return
        const before = player.stats.get('Experience')
        player.addExperience(xp)
        const gained = player.stats.get('Experience') - before
        let prefixId = 622 + randomBetween(0, 3)
        if (player.getStat('HP') === player.getStat('Max HP') && randomBetween(0, 100) > 65) prefixId = 626
        const fmt = getProtoMsg(621)
        const prefix = getProtoMsg(prefixId)
        if (fmt && prefix) uiLog(fmt.replace('%s', prefix).replace('%d', String(gained)))
    }

    getCombatAIMessage(id: number) {
        return getMessage('combatai', id)
    }

    maybeTaunt(obj: Critter, type: string, roll: boolean) {
        if (roll === false) return
        if (!Config.ui.combatTaunts) return // CE combat_ai.cc:3308 _combatai_msg
        const range = obj.ai!.packet.messageRanges[type]
        if (!range) return
        const [start, end] = range
        var msgID = getRandomInt(start, end)
        var msg = this.getCombatAIMessage(msgID)
        if (msg) {
            // CE combat_ai.cc:3401 — the AI packet's font / color / outline_color
            // (ai.txt: 101, palette 58, palette 55 for every packet).
            globalState.floatMessages.push({
                msg: msg,
                obj: obj,
                startTime: window.performance.now(),
                color: '#e4d80c',
                outline: '#1c0c18',
            })
        }
    }

    private combataiRating(c: Critter): number {
        return c.getStat('HP') + c.getStat('AC')
    }

    findTarget(obj: Critter): Critter | null {
        // CE ref: combat_ai.cc _ai_danger_source / isWithinPerception
        // Target must be within PER*5 tiles with LOS, or PER*2 tiles without.
        const targets = this.combatants.filter((x) => !x.dead && x.teamNum !== obj.teamNum && this.isWithinPerception(obj, x))
        if (targets.length === 0) return null
        const attackWho = obj.ai?.packet.attackWho ?? 'closest'
        switch (attackWho) {
            case 'strongest':
                targets.sort((a, b) => this.combataiRating(b) - this.combataiRating(a))
                return targets[0]
            case 'weakest':
                targets.sort((a, b) => this.combataiRating(a) - this.combataiRating(b))
                return targets[0]
            case 'whomever':
            case 'whomever_attacking_me': {
                const whoHitMe = (obj as any).whoHitMe
                if (whoHitMe instanceof Critter && !whoHitMe.dead && targets.includes(whoHitMe)) {
                    return whoHitMe
                }
                // Fall through to 'closest'
                targets.sort((a, b) => hexDistance(obj.position, a.position) - hexDistance(obj.position, b.position))
                return targets[0]
            }
            case 'closest':
            default:
                targets.sort((a, b) => hexDistance(obj.position, a.position) - hexDistance(obj.position, b.position))
                return targets[0]
        }
    }

    walkUpTo(obj: Critter, idx: number, target: Point, maxDistance: number, callback: () => void): boolean {
        // Walk up to `maxDistance` hexes, adjusting AP to fit
        if (obj.walkTo(target, false, callback, maxDistance)) {
            // OK
            if (obj.AP!.subtractMoveAP(obj.path.path.length - 1) === false)
                throw (
                    'subtraction issue: has AP: ' +
                    obj.AP!.getAvailableMoveAP() +
                    ' needs AP:' +
                    obj.path.path.length +
                    ' and maxDist was:' +
                    maxDistance
                )
            return true
        }

        return false
    }

    // ── CE combat_ai.cc _combat_ai ──────────────────────────────────────────────
    // One NPC turn. DH2 actions are asynchronous (animations), so CE's function runs as
    // phases across repeated doAITurn calls — every action's callback re-enters:
    //   start  — the flee test (CRITTER_MANUEVER_FLEEING, hurt_too_much, HP < min_hp)
    //   drugs  — _ai_check_drugs: healing items, chem use, items from the floor
    //   prefs  — _ai_danger_source + _cai_perform_distance_prefs
    //   attack — _ai_try_attack, at most 10 attempts (reload, switch weapons, move, attack)
    //   end    — disengage past max_dist, keep up with the team, extra-AP distance prefs
    doAITurn(obj: Critter, idx: number, depth: number): void {
        if (depth > Config.combat.maxAIDepth) {
            combatWarn(`Bailing out of ${depth}-deep AI turn recursion`)
            eventLogPush({ actor: actorName(obj), action: 'ai-bailout', depth, message: 'AI recursion bail-out' })
            return this.nextTurn()
        }
        const AP = obj.AP!
        const again = (): void => { obj.clearAnim(); this.doAITurn(obj, idx, depth + 1) }
        const endTurn = (): void => { obj.clearAnim(); this.nextTurn() }

        if (depth === 1) {
            ;(obj as any)._aiTurn = {
                phase: 'start', target: null, attempts: 0, drugUsed: false, healed: false, healSearchDone: false,
                envSearched: false, chemActive: null, chemCount: 0, endStep: 0, whoHitSet: false,
            } as AiTurnState
            dbg('ai', `[AI] ${actorName(obj)} turn start — AP: ${AP.getAvailableCombatAP()}, packet: ${obj.ai?.packet.name ?? '?'}`)
            // CE: a critter other than the player fights with its right-hand item
            const a = obj as any
            if (!obj.isPlayer && a.rightHand?.pid !== undefined && a.activeHand !== 'rightHand') {
                a.activeHand = 'rightHand'
                obj.setIdleArt()
            }
            // CE combat.cc _combat_turn: combat_p_proc once at the start of the turn
            if (Config.engine.doLoadScripts === true && obj._script !== undefined) {
                if (Scripting.combatEvent(obj, 'turnBegin') === true) return
            }
        }
        const st: AiTurnState = (obj as any)._aiTurn
        if (AP.getAvailableMoveAP() <= 0) return this.nextTurn()
        const packet = obj.ai!.packet

        switch (st.phase) {
            case 'start': {
                st.target = this.aiDangerSource(obj)
                const minHp = aiMinHp(obj, packet)
                if ((obj as any).fleeing || aiHurtTooMuch(obj, packet) || obj.getStat('HP') < minHp) {
                    dbg('ai', `[AI] ${actorName(obj)}: FLEEING: I'm Hurt!`)
                    eventLogPush({
                        actor: actorName(obj), action: 'ai-decision', result: 'flee',
                        target: st.target ? actorName(st.target) : null, hp: obj.getStat('HP'), minHp,
                        message: `${actorName(obj)} flees`,
                    })
                    if (!this.aiRunAway(obj, st.target, endTurn)) this.nextTurn()
                    return
                }
                st.phase = 'drugs'
                return this.doAITurn(obj, idx, depth + 1)
            }
            case 'drugs':
                if (this.aiCheckDrugsStep(obj, st, again)) return
                st.phase = 'prefs'
            // falls through
            case 'prefs': {
                st.phase = 'attack'
                if (!st.target || st.target.dead) st.target = this.aiDangerSource(obj)
                if (this.aiDistancePrefs(obj, st.target, again)) return
            }
            // falls through
            case 'attack': {
                const target = st.target
                if (target && !target.dead && st.attempts < 10) {
                    st.attempts++
                    const r = this.aiTryAttackStep(obj, target, st, again, endTurn)
                    if (r === 'acting') return
                    if (r === 'retry') return this.doAITurn(obj, idx, depth + 1)
                }
                st.phase = 'end'
            }
            // falls through
            case 'end': {
                if (this.aiEndOfTurn(obj, st, again)) return
                return this.nextTurn()
            }
        }
    }

    // CE combat_ai.cc _ai_danger_source. A party member follows its attack_who (and
    // ignores fleeing critters unless berserk / charging); anyone else goes for whoever
    // hit it. Otherwise the critters that attacked it, its team or were hit by its
    // team, sorted by attack_who, the first one it perceives and can reach or shoot.
    // DH2: when none qualifies, the nearest perceived enemy (Combat.findTarget) — DH2
    // doesn't set whoHitMe for every way a fight can start.
    aiDangerSource(obj: Critter): Critter | null {
        const player = globalState.player
        const party = !!globalState.gParty?.isPartyMember(obj)
        const packet = obj.ai!.packet
        const alive = (c: Critter | null | undefined): c is Critter =>
            !!c && c.type === 'critter' && !c.dead && ((c.injuryFlags ?? 0) & 0x01) === 0
        let attackWho: string | null = null
        let ignoreFleeing = false
        if (party) {
            attackWho = packet.attackWho
            ignoreFleeing = packet.disposition !== 'berserk' && packet.disposition !== 'none' && packet.distance !== 'charge'
            if (attackWho === 'whomever_attacking_me' && player) {
                const last = (obj as any).aiLastTarget as Critter | undefined
                if (alive(last) && last.teamNum !== obj.teamNum && (last as any).aiLastTarget === player
                    && !(ignoreFleeing && (last as any).fleeing)) return last
                const sorted = this.combatants.filter((c) => c !== obj && alive(c) && c.teamNum !== obj.teamNum
                    && (c as any).aiLastTarget === player && !(ignoreFleeing && (c as any).fleeing))
                sorted.sort((a, b) => hexDistance(obj.position, a.position) - hexDistance(obj.position, b.position))
                for (const c of sorted) {
                    if (this.checkBadShot(obj, c, false) === 'ok' || globalState.gMap!.recalcPath(obj.position, c.position).length > 0) return c
                }
            }
            if (attackWho === 'strongest' || attackWho === 'weakest' || attackWho === 'closest') (obj as any).whoHitMe = null
        }

        const targets: (Critter | null)[] = [null, null, null, null]
        const whoHitMe: Critter | null = (obj as any).whoHitMe ?? null
        if (whoHitMe && whoHitMe !== obj) {
            if (!whoHitMe.dead) {
                if (attackWho === 'whomever' || attackWho === null) return whoHitMe
            } else if (whoHitMe.teamNum !== obj.teamNum) {
                targets[0] = this.nearestOfTeam(obj, whoHitMe.teamNum)
            }
        }
        // aiFindAttackers: the one I attacked, my team's attacker, the one my team attacked
        const byDistance = this.combatants.slice().sort((a, b) => hexDistance(obj.position, a.position) - hexDistance(obj.position, b.position))
        for (const c of byDistance) {
            if (c === obj || c.dead) continue
            const hit: Critter | null = (c as any).whoHitMe ?? null
            if (!targets[1] && hit === obj) { targets[1] = c; continue }
            if (!targets[2] && c.teamNum === obj.teamNum && hit && hit !== obj && hit.teamNum !== obj.teamNum && !hit.dead) { targets[2] = hit; continue }
            if (!targets[3] && c.teamNum !== obj.teamNum && hit && hit.teamNum === obj.teamNum) { targets[3] = c; continue }
        }
        let list = targets.filter((t): t is Critter => !!t && !(ignoreFleeing && (t as any).fleeing))
        if (attackWho === 'strongest') list.sort((a, b) => this.combataiRating(b) - this.combataiRating(a))
        else if (attackWho === 'weakest') list.sort((a, b) => this.combataiRating(a) - this.combataiRating(b))
        else list.sort((a, b) => hexDistance(obj.position, a.position) - hexDistance(obj.position, b.position))
        for (const c of list) {
            if (!this.isWithinPerception(obj, c)) continue
            if (globalState.gMap!.recalcPath(obj.position, c.position).length > 0 || this.checkBadShot(obj, c, false) === 'ok') return c
        }
        return this.findTarget(obj)
    }

    nearestOfTeamPublic(obj: Critter, team: number): Critter | null {
        return this.nearestOfTeam(obj, team)
    }

    private nearestOfTeam(obj: Critter, team: number): Critter | null {
        let best: Critter | null = null
        for (const c of this.combatants) {
            if (c.dead || c.teamNum !== team) continue
            if (!best || hexDistance(obj.position, c.position) < hexDistance(obj.position, best.position)) best = c
        }
        return best
    }

    // CE combat_ai.cc isWithinPerception (src/perception.ts)
    isWithinPerception(obj: Critter, target: Critter | null): boolean {
        return isWithinPerception(obj, target)
    }

    // CE item.cc weaponGetRange: the action's range; a throw is capped at 3 × ST (the
    // player's ST + 2 per Heave Ho!, at most 10); no weapon reaches 1 (2 with
    // CRITTER_LONG_LIMBS).
    attackRange(critter: Critter, weaponObj: Obj | null): number {
        if (!weaponObj || weaponObj.pid === undefined) return (((critter.pro as any)?.extra?.flags ?? 0) & 0x2000) ? 2 : 1
        let range = (weaponObj as any).weapon.getMaximumRange()
        if (attackTypeOf(weaponObj) === 'throw') {
            let st = critter.getStat('STR')
            if (critter.isPlayer) st = Math.min(10, st + 2 * critter.perks.filter((p) => p === 'Heave Ho!').length)
            range = Math.min(range, 3 * st)
        }
        return range
    }

    // CE combat.cc _combat_check_bad_shot for the critter's current action.
    checkBadShot(attacker: Critter, defender: Critter, aiming: boolean): BadShot {
        if (defender.dead) return 'dead'
        const wObj = attacker.equippedWeapon
        const real = !!wObj && wObj.pid !== undefined
        if (real) {
            if (attacker.crippledLeftArm && attacker.crippledRightArm) return 'bothArmsCrippled'
            const twoHanded = ((((wObj as any).pro?.extra?.weaponFlags ?? 0) & 0x02) !== 0) // WEAPON_TWO_HAND
            if ((attacker.crippledLeftArm || attacker.crippledRightArm) && twoHanded) return 'armCrippled'
        }
        const cost = !wObj
            ? unarmedAPCost(attacker, currentUnarmed(attacker).mode, aiming)
            : wObj.weapon!.getAttackAPCost(attacker, undefined, aiming)
        if (cost > (attacker.AP?.getAvailableCombatAP() ?? 0)) return 'notEnoughAp'
        const range = this.attackRange(attacker, wObj)
        if (range < hexDistance(attacker.position, defender.position)) return 'outOfRange'
        if (real && ammoGetCapacity(wObj as any) > 0 && ammoGetQuantity(wObj as any) === 0) return 'noAmmo'
        const at = attackTypeOf(wObj)
        if ((at === 'ranged' || at === 'throw' || range > 1)
            && combatIsShotBlocked(attacker, attacker.position, defender.position, defender).blocked) return 'aimBlocked'
        return 'ok'
    }

    // CE combat_ai.cc _ai_try_attack — one pass of its attempt loop. 'acting': an
    // animation runs and re-enters; 'retry': try again at once; 'done': stop attacking.
    private aiTryAttackStep(obj: Critter, target: Critter, st: AiTurnState, again: () => void,
                            endTurn: () => void): 'acting' | 'retry' | 'done' {
        const packet = obj.ai!.packet
        const AP = obj.AP!
        if (!st.whoHitSet) {
            st.whoHitSet = true
            critterSetWhoHitMe(obj, target) // _critter_set_who_hit_me(attacker, defender)
            ;(obj as any).aiLastTarget = target
            const r = this.aiWieldOrRetrieve(obj, target, again)
            if (r !== 'retry') return r
        }

        const wObj = obj.equippedWeapon
        const real = !!wObj && wObj.pid !== undefined
        const weapon: any = real ? wObj!.weapon : null
        // _ai_pick_hit_mode: primary or the secondary attack
        const prevMode = weapon?.mode
        if (weapon) {
            weapon.mode = this.aiPickHitMode(obj, wObj!, target) === 'secondary'
                ? (Combat.secondaryModeName(weapon) ?? 'single') : 'single'
        }
        const minToHit = packet.minToHit
        const bad = this.checkBadShot(obj, target, false)
        const restore = () => { if (weapon && prevMode !== undefined && weapon.mode !== prevMode) weapon.mode = prevMode }

        switch (bad) {
            case 'dead':
                restore()
                return 'done'
            case 'noAmmo':
                restore()
                return this.aiNoAmmo(obj, wObj!, target, again)
            case 'notEnoughAp':
            case 'armCrippled':
            case 'bothArmsCrippled': {
                restore()
                const r = this.aiSwitchWeapons(obj, target, again)
                return r === 'fail' ? 'done' : r
            }
            case 'outOfRange': {
                const noRange = this.getHitChance(obj, target, 'torso', obj.position, false).hit
                if (noRange < minToHit) {
                    restore()
                    dbg('ai', `[AI] ${actorName(obj)}: FLEEING: Can't possibly Hit Target!`)
                    if (!this.aiRunAway(obj, target, endTurn)) return 'done'
                    return 'acting'
                }
                restore()
                if (real) {
                    return this.aiMoveStepsCloser(obj, target, AP.getAvailableMoveAP(), true, again) ? 'acting' : 'done'
                }
                const r = this.aiSwitchWeapons(obj, target, again)
                if (r !== 'fail' && obj.equippedWeapon?.pid !== undefined) return r
                return this.aiMoveStepsCloser(obj, target, AP.getAvailableMoveAP(), true, again) ? 'acting' : 'done'
            }
            case 'aimBlocked':
                restore()
                return this.aiMoveStepsCloser(obj, target, AP.getAvailableMoveAP(), true, again) ? 'acting' : 'done'
            case 'ok': {
                const accuracy = this.getHitChance(obj, target, 'torso').hit
                if (accuracy < minToHit) {
                    const noRange = this.getHitChance(obj, target, 'torso', obj.position, false).hit
                    if (noRange < minToHit) {
                        restore()
                        dbg('ai', `[AI] ${actorName(obj)}: FLEEING: Can't possibly Hit Target!`)
                        if (!this.aiRunAway(obj, target, endTurn)) return 'done'
                        return 'acting'
                    }
                    // Step along the path until the chance from a tile reaches min_to_hit.
                    const path = globalState.gMap!.recalcPath(obj.position, target.position)
                    let steps = AP.getAvailableMoveAP()
                    if (path.length > 1) {
                        steps = 0
                        for (let i = 1; i < path.length - 1 && steps < AP.getAvailableMoveAP(); i++) {
                            steps++
                            const from = { x: path[i][0], y: path[i][1] }
                            if (this.getHitChance(obj, target, 'torso', from).hit >= minToHit) break
                        }
                    }
                    if (steps > 0 && this.aiMoveStepsCloser(obj, target, steps, true, () => { restore(); again() })) return 'acting'
                }
                return this.aiAttack(obj, target, () => { restore(); again() }) ? 'acting' : (restore(), 'done')
            }
        }
    }

    // CE combat_ai.cc _ai_attack (+ _ai_called_shot): face the target, pick the hit
    // location, pay the AP and attack.
    private aiAttack(obj: Critter, target: Critter, then: () => void): boolean {
        const wObj = obj.equippedWeapon
        const region = this.aiCalledShot(obj, target)
        const aimed = region !== 'torso'
        const cost = !wObj ? unarmedAPCost(obj, currentUnarmed(obj).mode, aimed) : wObj.weapon!.getAttackAPCost(obj, undefined, aimed)
        if (cost > obj.AP!.getAvailableCombatAP()) return false
        obj.AP!.subtractCombatAP(cost)
        dbg('ai', `[AI] ${actorName(obj)} → attack on ${actorName(target)} (${region}, AP cost: ${cost})`)
        eventLogPush({
            actor: actorName(obj), action: 'ai-decision', result: 'attack',
            target: actorName(target), distance: hexDistance(obj.position, target.position),
            AP: obj.AP!.getAvailableCombatAP(), weapon: wObj?.weapon?.name ?? null, region,
            message: `${actorName(obj)} attacks ${actorName(target)}`,
        })
        this.maybeTaunt(obj, 'attack', rollSkillCheck(obj.ai!.packet.chance || 85, 0, false))
        this.attack(obj, target, region, then)
        return true
    }

    // CE combat_ai.cc _ai_called_shot: with AP for the aimed attack and an aimable hit
    // mode, one in called_freq tries a random location if INT reaches 7 / 5 / 3 (easy /
    // normal / hard combat); below min_to_hit it stays on the torso.
    private aiCalledShot(obj: Critter, target: Critter): string {
        const wObj = obj.equippedWeapon
        const packet = obj.ai!.packet
        const cost = !wObj ? unarmedAPCost(obj, currentUnarmed(obj).mode, true) : wObj.weapon!.getAttackAPCost(obj, undefined, true)
        if (cost > obj.AP!.getAvailableCombatAP()) return 'torso'
        const weapon: any = wObj?.weapon
        if (weapon && wObj!.pid !== undefined && !weapon.modes.includes(weapon.usesSecondary() ? 'secondaryCalled' : 'called')) return 'torso'
        if (randomBetween(1, packet.calledFreq) !== 1) return 'torso'
        const d = Config.combat.difficultyModifier
        const intRequired = d === 75 ? 7 : d === 125 ? 3 : 5
        if (obj.getStat('INT') < intRequired) return 'torso'
        const LOCATIONS = ['head', 'leftArm', 'rightArm', 'torso', 'rightLeg', 'leftLeg', 'eyes', 'groin', 'torso']
        const region = LOCATIONS[randomBetween(0, 8)]
        if (this.getHitChance(obj, target, region).hit < packet.minToHit) return 'torso'
        return region
    }

    // CE _ai_try_attack (weapon == nullptr) → _ai_switch_weapons: with nothing in hand
    // wield the best inventory weapon, else fetch one lying within reach.
    private aiWieldOrRetrieve(obj: Critter, target: Critter, again: () => void): 'acting' | 'retry' | 'done' {
        if (this.aiWieldInventoryWeapon(obj, target)) return 'retry'
        const inHand = obj.equippedWeapon
        if (inHand && inHand.pid !== undefined) return 'retry'
        const defenderBiped = ((target.pro as any)?.extra?.bodyType ?? 0) === 0
        const defenderUnarmed = defenderUnarmedNow(target) // CE: the fid's weapon code is 0
        if (defenderBiped && defenderUnarmed && globalState.imageInfo[obj.getBase() + 'ap']) return 'retry'
        const r = this.aiSwitchWeapons(obj, target, again)
        return r === 'fail' ? 'retry' : r
    }

    // CE combat_ai.cc _ai_switch_weapons: the best usable inventory weapon (AP checked),
    // else one from the floor (_ai_search_environ + _ai_retrieve_object), else the
    // fist if its AP fits.
    private aiSwitchWeapons(obj: Critter, target: Critter, again: () => void): 'acting' | 'retry' | 'fail' {
        const best = Combat.aiSearchInvenWeap(obj, target)
        if (best) {
            const a = obj as any
            a.rightHand = best
            a.activeHand = 'rightHand'
            obj.setIdleArt()
            dbg('ai', `[AI] ${actorName(obj)} wields ${best.name} (CE _ai_switch_weapons)`)
            return this.checkBadShot(obj, target, false) === 'notEnoughAp' ? 'fail' : 'retry'
        }
        const found = this.aiSearchEnviron(obj, 'weapon', target)
        if (found) {
            dbg('ai', `[AI] ${actorName(obj)} goes for ${found.name} on the floor`)
            // _ai_retrieve_object, then _inven_wield(attacker, weapon, HAND_RIGHT)
            const wield = (): void => {
                const got = inventoryCopyOf(obj, found)
                if (got) {
                    const a = obj as any
                    a.rightHand = got
                    a.activeHand = 'rightHand'
                    obj.setIdleArt()
                }
                again()
            }
            if (this.aiRetrieveObject(obj, found, wield)) return 'acting'
        }
        // No weapon to switch to: CE goes on with HIT_MODE_PUNCH (weapon = nullptr) if a
        // punch is affordable — the item stays in the hand; DH2 punches with the free
        // hand for the rest of the turn (doAITurn restores the right hand next turn).
        if (obj.AP!.getAvailableCombatAP() < 3) return 'fail'
        const a = obj as any
        if (!obj.isPlayer && a[a.activeHand ?? 'leftHand']?.pid !== undefined) {
            const other = (a.activeHand ?? 'leftHand') === 'leftHand' ? 'rightHand' : 'leftHand'
            if (!a[other] || a[other].pid === undefined) {
                if (!a[other]) a[other] = Critter.makeFist()
                a.activeHand = other
            } else {
                return 'fail'
            }
        }
        return 'retry'
    }

    // CE _ai_try_attack, COMBAT_BAD_SHOT_NO_AMMO: reload from the inventory (reload AP,
    // READY sound, magic hands, "reloads the"), else fetch ammo from the floor, else
    // "is out of ammo for the", put the weapon away and switch weapons.
    private aiNoAmmo(obj: Critter, wObj: Obj, target: Critter, again: () => void): 'acting' | 'retry' | 'done' {
        const ammo = findReloadAmmo(wObj as any, obj.inventory as any)
        if (ammo) {
            this.aiReload(obj, wObj, ammo, again)
            return 'acting'
        }
        const floorAmmo = this.aiSearchEnviron(obj, 'ammo', target)
        if (floorAmmo && this.aiRetrieveObject(obj, floorAmmo, again)) return 'acting'
        const soundId = (wObj as any).pro?.extra?.soundID
        if (typeof soundId === 'number' && !(window as any).__test?.fastMode) {
            globalState.audioEngine.playWeaponSfx(String.fromCharCode(soundId), 'empty')
        }
        uiLog(`${obj.name} ${getMessage('misc', 5001) ?? 'is out of ammo for the'} ${wObj.name}.`)
        const a = obj as any
        for (const hand of ['leftHand', 'rightHand']) if (a[hand] === wObj) a[hand] = Critter.makeFist()
        obj.setIdleArt()
        const r = this.aiSwitchWeapons(obj, target, again)
        return r === 'fail' ? 'done' : r
    }

    private aiReload(obj: Critter, wObj: Obj, ammo: Obj, then: () => void): void {
        const loaded = weaponReload(wObj as any, ammo as any)
        if ((ammo.amount ?? 0) <= 0) {
            const i = obj.inventory.indexOf(ammo)
            if (i !== -1) obj.inventory.splice(i, 1)
        }
        const AP = obj.AP!
        const cost = (wObj as any).weapon?.getReloadAPCost?.() ?? 2
        if (AP.getAvailableCombatAP() < cost) AP.combat = 0
        else AP.subtractCombatAP(cost)
        const soundId = (wObj as any).pro?.extra?.soundID
        if (typeof soundId === 'number' && !(window as any).__test?.fastMode) {
            globalState.audioEngine.playWeaponSfx(String.fromCharCode(soundId), 'reload')
        }
        combatDebug(`AI ${obj.name}: reloaded ${loaded} rounds`)
        this.aiMagicHands(obj, wObj, 5002, then)
    }

    // CE combat_ai.cc _ai_magic_hands: ANIM_MAGIC_HANDS_MIDDLE and "<name> <msg> <item>."
    private aiMagicHands(obj: Critter, item: Obj | null, msgId: number, then: () => void): void {
        const msg = getMessage('misc', msgId)
        if (msg) uiLog(item ? `${obj.name} ${msg} ${item.name}.` : `${obj.name} ${msg}.`)
        if (obj.hasAnimation('use')) obj.staticAnimation('use', then)
        else then()
    }

    // CE combat_ai.cc _ai_check_drugs, one step per call (each drug is its own action).
    private aiCheckDrugsStep(obj: Critter, st: AiTurnState, again: () => void): boolean {
        if (((obj.pro as any)?.extra?.bodyType ?? 0) !== 0) return false // BODY_TYPE_BIPED
        const packet = obj.ai!.packet
        const AP = obj.AP!
        let hpRatio = 50
        let chance = 0
        // CE _combatNumTurns: completed combat rounds
        const turn = Math.max(0, Math.ceil(this.turnNum / Math.max(1, this.combatants.length)) - 1)
        switch (packet.chemUse) {
            case 'clean': return false
            case 'stims_when_hurt_little': hpRatio = 60; break
            case 'stims_when_hurt_lots': hpRatio = 30; break
            case 'sometimes': if (turn % 3 === 0) chance = 25; break
            case 'anytime': if (turn % 3 === 0) chance = 75; break
            case 'always': chance = 100; break
        }
        const maxHp = obj.getStat('Max HP') ?? obj.getStat('HP')
        // Healing items while HP is below the ratio.
        if (!st.healSearchDone && obj.getStat('HP') < Math.trunc(maxHp * hpRatio / 100) && AP.getAvailableCombatAP() >= 2) {
            const heal = obj.inventory.find((i) => i.subtype === 'drug' && HEALING_PIDS.includes(i.pid))
            if (heal) {
                st.drugUsed = true
                st.healed = true
                this.aiUseDrug(obj, heal, again)
                return true
            }
            st.healSearchDone = true
        }
        // Random chem use (rolled once per turn), primary desires first.
        if (!st.healed && chance > 0) {
            if (st.chemActive === null) st.chemActive = randomBetween(0, 100) < chance
            if (st.chemActive && AP.getAvailableCombatAP() >= 2) {
                const drugs = obj.inventory.filter((i) => i.subtype === 'drug' && !HEALING_PIDS.includes(i.pid))
                const primary = drugs.filter((d) => packet.chemPrimaryDesire.includes(d.pid))
                const pool = primary.length > 0 ? primary : drugs
                if (pool.length > 0) {
                    const drug = pool[randomBetween(0, pool.length - 1)]
                    st.drugUsed = true
                    st.chemCount++
                    if (packet.chemUse === 'sometimes' || (packet.chemUse === 'anytime' && st.chemCount >= 2)) st.chemActive = false
                    this.aiUseDrug(obj, drug, again)
                    return true
                }
                st.chemActive = false
                st.healSearchDone = true
            }
        }
        // An item fetched last turn (aiInfoGetLastItem), or nothing usable carried: look
        // for a usable item on the floor.
        const last: Obj | null = (obj as any).aiLastItem ?? null
        if (last && !globalState.gMap!.getObjects().includes(last)) (obj as any).aiLastItem = null
        if (((obj as any).aiLastItem || (!st.drugUsed && st.healSearchDone)) && !st.envSearched) {
            st.envSearched = true
            const item = (obj as any).aiLastItem ?? this.aiSearchEnviron(obj, 'drug', null) ?? this.aiSearchEnviron(obj, 'misc', null)
            ;(obj as any).aiLastItem = null
            if (item && this.aiRetrieveObject(obj, item, () => {
                const got = inventoryCopyOf(obj, item)
                if (got && got.subtype === 'drug' && obj.AP!.getAvailableCombatAP() >= 2) {
                    st.drugUsed = true
                    this.aiUseDrug(obj, got, again)
                } else {
                    again()
                }
            })) return true
        }
        return false
    }

    // _item_d_take_drug + _ai_magic_hands ("uses"), 2 AP.
    private aiUseDrug(obj: Critter, drug: Obj, then: () => void): void {
        let used: Obj = drug
        if ((drug.amount ?? 1) > 1) {
            drug.amount -= 1
            used = cloneItem(drug)
            used.amount = 1
        } else {
            const i = obj.inventory.indexOf(drug)
            if (i !== -1) obj.inventory.splice(i, 1)
        }
        if (!useDrug(used, obj)) {
            if (used === drug) obj.inventory.push(drug)
            else drug.amount += 1
        }
        const AP = obj.AP!
        if (AP.getAvailableCombatAP() < 2) AP.combat = 0
        else AP.subtractCombatAP(2)
        this.aiMagicHands(obj, used, 5000, then)
    }

    // CE combat_ai.cc _ai_search_environ: the nearest item on the floor within PER + 5
    // of the given kind the critter can use (bipeds only).
    private aiSearchEnviron(obj: Critter, kind: 'weapon' | 'ammo' | 'drug' | 'misc', target: Critter | null): Obj | null {
        if (((obj.pro as any)?.extra?.bodyType ?? 0) !== 0) return null
        const gMap = globalState.gMap
        if (!gMap) return null
        const reach = obj.getStat('PER') + 5
        const items = gMap.getObjects()
            .filter((o) => o.type === 'item' && o.visible !== false && hexDistance(obj.position, o.position) <= reach)
            .sort((a, b) => hexDistance(obj.position, a.position) - hexDistance(obj.position, b.position))
        const packet = obj.ai!.packet
        const inHand = obj.equippedWeapon
        for (const item of items) {
            if (kind === 'weapon' && item.subtype === 'weapon') {
                if (this.aiCanUseWeapon(obj, item)) return item
            } else if (kind === 'ammo' && item.subtype === 'ammo') {
                if (inHand && inHand.pid !== undefined && findReloadAmmo(inHand as any, [item] as any)) return item
            } else if ((kind === 'drug' && item.subtype === 'drug') || (kind === 'misc' && item.subtype === 'misc')) {
                if (aiCanUseItem(obj, item, packet)) return item
            }
        }
        void target
        return null
    }

    // CE combat_ai.cc _ai_can_use_weapon (arms, attack FRM, skill, preferred type).
    private aiCanUseWeapon(obj: Critter, item: Obj): boolean {
        const weapon: any = (item as any).weapon
        if (!weapon) return false
        if (obj.crippledLeftArm && obj.crippledRightArm) return false
        const twoHanded = ((((item as any).pro?.extra?.weaponFlags ?? 0) & 0x02) !== 0)
        if ((obj.crippledLeftArm || obj.crippledRightArm) && twoHanded) return false
        if (!globalState.imageInfo[obj.getBase() + weapon.getAnim('attack')]) return false
        const packet = obj.ai!.packet
        if (obj.getSkill(weapon.weaponSkillType) < packet.minToHit) return false
        return (Combat.WEAP_PREF_ORDERINGS[packet.bestWeapon] ?? []).includes(weaponAttackType(item))
    }

    // CE combat_ai.cc _ai_retrieve_object (actionPickUp): walk to the item with this
    // turn's AP and pick it up; if it is out of reach this turn the walk still happens.
    private aiRetrieveObject(obj: Critter, item: Obj, then: () => void): boolean {
        const gMap = globalState.gMap
        if (!gMap) return false
        const pick = (): void => {
            if (!gMap.getObjects().includes(item)) return then()
            const take = (): void => {
                obj.addInventoryItem(item, item.amount)
                gMap.destroyObject(item)
                if (!(window as any).__test?.fastMode) globalState.audioEngine.playSfxByName('ipickup1')
                obj.clearAnim()
                then()
            }
            if (obj.hasAnimation('pickUp')) obj.staticAnimation('pickUp', take)
            else take()
        }
        if (hexDistance(obj.position, item.position) <= 1) { pick(); return true }
        const AP = obj.AP!
        const steps = AP.getAvailableMoveAP()
        if (steps <= 0) return false
        const path = gMap.recalcPath(obj.position, item.position)
        if (path.length === 0) return false
        const reach = path.length - 1 <= steps
        // aiInfoSetLastItem: an item not reached this turn is fetched next turn (_ai_check_drugs)
        if (!reach) (obj as any).aiLastItem = item
        if (!obj.walkTo(item.position, false, () => { obj.clearAnim(); if (reach) pick(); else then() }, steps, path)) return false
        if (AP.subtractMoveAP(obj.path.path.length - 1) === false) AP.combat = 0
        return true
    }

    // CE combat_ai.cc _ai_move_steps_closer: up to `steps` hexes toward the target (run
    // with at least half the max AP), not with distance 'stay', not past stay_close.
    private aiMoveStepsCloser(obj: Critter, target: Critter, steps: number, taunt: boolean, then: () => void): boolean {
        if (steps <= 0) return false
        const packet = obj.ai!.packet
        if (packet.distance === 'stay') return false
        const player = globalState.player
        if (packet.distance === 'stay_close' && player && target !== player) {
            const d = hexDistance(obj.position, player.position)
            if (d > 5 && hexDistance(target.position, player.position) > 5 && d + steps > 5) return false
        }
        if (hexDistance(obj.position, target.position) <= 1) return false
        const AP = obj.AP!
        steps = Math.min(steps, AP.getAvailableMoveAP())
        const run = steps >= Math.trunc(obj.AP!.getMaxAP() / 2) && obj.canRun()
        const neighbours = hexNeighbors(target.position)
            .sort((a, b) => hexDistance(obj.position, a) - hexDistance(obj.position, b))
        // _cai_retargetTileFromFriendlyFire on the destination (the target's tile)
        const retarget = this.retargetTileFromFriendlyFire(obj, target, target.position)
        if (retarget.x !== target.position.x || retarget.y !== target.position.y) neighbours.unshift(retarget)
        for (const nb of neighbours) {
            if (obj.walkTo(nb, run, then, steps)) {
                if (taunt) this.maybeTaunt(obj, 'move', rollSkillCheck(packet.chance || 85, 0, false))
                eventLogPush({
                    actor: actorName(obj), action: 'ai-decision', result: 'creep', target: actorName(target),
                    AP: AP.getAvailableMoveAP(), message: `${actorName(obj)} moves toward ${actorName(target)}`,
                })
                if (AP.subtractMoveAP(obj.path.path.length - 1) === false) AP.combat = 0
                return true
            }
        }
        return false
    }

    // CE combat_ai.cc _ai_move_away: away from `from` (straight, or one rotation to
    // either side), at most `maxSteps` hexes, not with distance 'stay'.
    private aiMoveAway(obj: Critter, from: Critter, maxSteps: number, run: boolean, then: () => void): boolean {
        if (obj.ai!.packet.distance === 'stay' && !run) return false
        const AP = obj.AP!
        let steps = Math.min(maxSteps, AP.getAvailableMoveAP())
        const rotation = hexDirectionTo(from.position, obj.position)
        const gMap = globalState.gMap!
        for (; steps > 0; steps--) {
            for (const rot of [rotation, (rotation + 1) % 6, (rotation + 5) % 6]) {
                const dest = hexInDirectionDistance(obj.position, rot, steps)
                if (!dest || dest.x < 0 || dest.y < 0 || dest.x >= 200 || dest.y >= 200) continue
                const path = gMap.recalcPath(obj.position, dest)
                if (path.length === 0) continue
                if (obj.walkTo(dest, run, then, steps, path)) {
                    if (AP.subtractMoveAP(obj.path.path.length - 1) === false) AP.combat = 0
                    return true
                }
            }
        }
        return false
    }

    // CE combat_ai.cc _ai_run_away: within max_dist of the threat the critter is
    // FLEEING and runs away with all its AP (taunt "run"); beyond it, it disengages.
    private aiRunAway(obj: Critter, from: Critter | null, then: () => void): boolean {
        const threat = from ?? (globalState.player as Critter)
        if (!threat) return false
        const packet = obj.ai!.packet
        if (hexDistance(obj.position, threat.position) < packet.maxDist) {
            ;(obj as any).fleeing = true
            this.maybeTaunt(obj, 'run', rollSkillCheck(packet.chance || 85, 0, false))
            return this.aiMoveAway(obj, threat, obj.AP!.getAvailableMoveAP(), true, then)
        }
        ;(obj as any).disengaging = true
        return false
    }

    // CE combat_ai.cc _cai_retargetTileFromFriendlyFire: if the critter stands in the
    // line of fire of a team-mate who rates at least as high and attacks the same target
    // (_cai_attackWouldIntersect), step aside: one hex to either side of that team-mate's
    // facing from `tile`, the free one nearest `tile`. Costs 2 INT per step (INT <= 0: none).
    retargetTileFromFriendlyFire(source: Critter, target: Critter | null, tile: Point): Point {
        if (!target || source.getStat('INT') <= 0) return tile
        const rating = this.combataiRating(source)
        const friends = this.combatants
            .filter((c) => !c.dead && c !== source && c.teamNum === source.teamNum
                && (c as any).aiLastTarget === target && this.combataiRating(c) >= rating)
            .sort((a, b) => hexDistance(source.position, a.position) - hexDistance(source.position, b.position))
        const candidates: Point[] = []
        for (const f of friends) {
            if (this.attackWouldIntersect(f, target, source)) {
                const r = f.orientation ?? 0
                const a = hexInDirection(tile, (r + 1) % 6)
                const b = hexInDirection(tile, (r + 5) % 6)
                if (a) candidates.push(a)
                if (b) candidates.push(b)
                break
            }
        }
        const gMap = globalState.gMap!
        let best: Point | null = null
        for (const c of candidates) {
            if (gMap.blockingObjectAt(toTileNum(c), source.elevation, 0, null)) continue
            if (!best || hexDistance(tile, c) < hexDistance(tile, best)) best = c
        }
        return best ?? tile
    }

    // CE combat_ai.cc _cai_attackWouldIntersect: the attacker's shot at the defender would
    // first meet `friend`, or its spray / blast would catch a team-mate.
    private attackWouldIntersect(attacker: Critter, defender: Critter, friend: Critter): boolean {
        const w = attacker.equippedWeapon
        if (!w || w.pid === undefined) return false
        if (this.attackRange(attacker, w) < 1) return false
        if (nextShootObstacle(attacker, attacker.position, defender.position, attacker) === friend) return true
        return this.combatSafetyInvalidateWeapon(attacker, w, 'primary', defender, false)
    }

    // CE combat_ai.cc _cai_perform_distance_prefs (sfall's snipe fix), ending with the
    // friendly-fire sidestep (_cai_retargetTileFromFriendlyFire on the critter's tile).
    private aiDistancePrefs(obj: Critter, target: Critter | null, then: () => void): boolean {
        const AP = obj.AP!
        if (AP.getAvailableCombatAP() <= 0) return false
        const packet = obj.ai!.packet
        const player = globalState.player
        switch (packet.distance) {
            case 'stay_close':
                if (player && (obj as any).whoHitMe !== player) {
                    const d = hexDistance(obj.position, player.position)
                    if (d > 5 && this.aiMoveStepsCloser(obj, player, d - 5, false, then)) return true
                }
                break
            case 'charge':
                if (target && this.aiMoveStepsCloser(obj, target, AP.getAvailableMoveAP(), true, then)) return true
                break
            case 'snipe': {
                if (!target) break
                const d = hexDistance(obj.position, target.position)
                if (d >= 10) break
                const wObj = obj.equippedWeapon
                const attackCost = wObj?.weapon ? wObj.weapon.getAttackAPCost(obj, 1, false) : 3
                const movementPoints = AP.getAvailableCombatAP() - attackCost
                if (movementPoints > 0) {
                    if (movementPoints + d - 1 < 5 && this.combataiRating(obj) < this.combataiRating(target)
                        && this.aiMoveAway(obj, target, 10, false, then)) return true
                } else if (this.aiMoveAway(obj, target, 10, false, then)) {
                    return true
                }
                break
            }
        }
        // _cai_retargetTileFromFriendlyFire on the current tile: step out of a stronger
        // team-mate's line of fire.
        const tile = this.retargetTileFromFriendlyFire(obj, target, obj.position)
        if (tile.x !== obj.position.x || tile.y !== obj.position.y) {
            if (obj.walkTo(tile, false, then, AP.getAvailableMoveAP())) {
                if (AP.subtractMoveAP(obj.path.path.length - 1) === false) AP.combat = 0
                return true
            }
        }
        return false
    }

    // The tail of CE _combat_ai, step by step (each may start a move and re-enter):
    //   1. a live target beyond max_dist: move away from a dead friend, or join a friend
    //      within PER × 2 (_ai_find_friend), else disengage
    //   2. no target (not a party member) but hit this combat by someone still alive: move
    //      away from a dead friend, else run ("somebody is shooting at me")
    //   3. away from a friend who died for no visible reason, until 10 hexes apart
    //   4. no target: keep within reach of the team (party: by distance setting);
    //      otherwise spend leftover AP on the distance preferences
    private aiEndOfTurn(obj: Critter, st: AiTurnState, then: () => void): boolean {
        const packet = obj.ai!.packet
        const target = st.target
        const AP = obj.AP!
        const a = obj as any
        const player = globalState.player
        const party = !!globalState.gParty?.isPartyMember(obj)
        const steps: (() => boolean)[] = [
            () => {
                if (!target || target.dead || AP.getAvailableCombatAP() === 0
                    || hexDistance(obj.position, target.position) <= packet.maxDist) return false
                const fd: Critter | null = a.aiFriendlyDead ?? null
                if (fd) {
                    a.aiFriendlyDead = null
                    return this.aiMoveAway(obj, fd, 10, false, then)
                }
                const friend = this.nearestOfTeamExcept(obj)
                const per = obj.getStat('PER')
                if (!friend || hexDistance(obj.position, friend.position) > per * 2) {
                    a.disengaging = true
                    return false
                }
                const d = hexDistance(obj.position, friend.position)
                return d > 5 && this.aiMoveStepsCloser(obj, friend, d - 5, false, then)
            },
            () => {
                if (target || party) return false
                const who: Critter | null = a.whoHitMe ?? null
                if (!who || who.dead || !(a.damageLastTurn > 0)) return false
                const fd: Critter | null = a.aiFriendlyDead ?? null
                if (fd) {
                    a.aiFriendlyDead = null
                    return this.aiMoveAway(obj, fd, 10, false, then)
                }
                dbg('ai', `[AI] ${actorName(obj)}: FLEEING: Somebody is shooting at me that I can't see!`)
                return this.aiRunAway(obj, null, then)
            },
            () => {
                const fd: Critter | null = a.aiFriendlyDead ?? null
                if (!fd) return false
                if (hexDistance(obj.position, fd.position) >= 10) {
                    a.aiFriendlyDead = null
                    return false
                }
                return this.aiMoveAway(obj, fd, 10, false, then)
            },
            () => {
                let teammate: Critter | null = null
                let maxTeammateDistance = 5
                if (player && obj.teamNum === player.teamNum) {
                    teammate = player
                    if (party) {
                        const PARTY_DISTANCES: { [d: string]: number } = { stay_close: 5, charge: 7, snipe: 7, on_your_own: 7, stay: 50000 }
                        maxTeammateDistance = PARTY_DISTANCES[packet.distance] ?? 5
                    }
                } else {
                    teammate = this.nearestOfTeamExcept(obj)
                }
                if (!target && teammate && hexDistance(obj.position, teammate.position) > maxTeammateDistance) {
                    const d = hexDistance(obj.position, teammate.position)
                    return this.aiMoveStepsCloser(obj, teammate, d - maxTeammateDistance, false, then)
                }
                if (AP.getAvailableCombatAP() > 0) return this.aiDistancePrefs(obj, target, then)
                return false
            },
        ]
        while (st.endStep < steps.length) {
            const step = steps[st.endStep++]
            if (step()) return true
        }
        return false
    }

    private nearestOfTeamExcept(obj: Critter): Critter | null {
        let best: Critter | null = null
        for (const c of this.combatants) {
            if (c === obj || c.dead || c.teamNum !== obj.teamNum) continue
            if (!best || hexDistance(obj.position, c.position) < hexDistance(obj.position, best.position)) best = c
        }
        return best
    }

    static start(forceTurn?: Critter): void {
        if (combatActive) {
            combatDebug('ignoring Combat.start(): already active')
            return
        }
        combatActive = true
        // begin combat
        globalState.inCombat = true
        const player = globalState.player!
        const triggerTeams = new Set([player.teamNum])
        if (forceTurn && forceTurn.teamNum >= 0) {
            // NPC-initiated: enroll only the player's team and the attacker's team.
            triggerTeams.add(forceTurn.teamNum)
        } else {
            // Player-initiated (attack button / encounter): collect all NPC teams on
            // the map so enemy critters can participate. nextTurn() gates actual
            // activity via the hostile flag, so neutral critters still do nothing.
            for (const obj of globalState.gMap!.getObjects()) {
                if (obj instanceof Critter && !obj.dead && !obj.isPlayer && obj.teamNum >= 0)
                    triggerTeams.add(obj.teamNum)
            }
            // CE ref: combat.cc combatBeginSequence enrolls all map critters.
            // teamNum=-1 (neutral — no team_num in ai.txt) critters must also be
            // enrolled so they can retaliate after being attacked (nextTurn's
            // hasAttacked+LOS gate then marks them hostile and gives them a turn).
            triggerTeams.add(-1)
        }
        combatDebug(`start: triggerTeams=[${[...triggerTeams].join(',')}]`)
        globalState.combat = new Combat(globalState.gMap.getObjects(), triggerTeams)
        // CE combat.cc _combat_begin: damageLastTurn starts at 0 for every combatant
        for (const c of globalState.combat.combatants) (c as any).damageLastTurn = 0

        if (forceTurn) {
            // CE combat_ai.cc _caiTeamCombatInit: the attacking team and the player's team
            // each start with the nearest member of the other team as whoever hit them.
            const c = globalState.combat
            for (const critter of c.combatants) {
                if (critter.dead) continue
                if (critter.teamNum === forceTurn.teamNum && !critter.isPlayer) {
                    ;(critter as any).whoHitMe = c.nearestOfTeamPublic(critter, player.teamNum)
                } else if (critter.teamNum === player.teamNum && !critter.isPlayer) {
                    ;(critter as any).whoHitMe = c.nearestOfTeamPublic(critter, forceTurn.teamNum)
                }
            }
            globalState.combat.forceTurn(forceTurn)
        }

        eventLogPush({
            actor: null, action: 'combat-start',
            triggerTeams: [...triggerTeams],
            combatants: globalState.combat.combatants.map((c) => actorName(c)),
            message: 'Combat started',
        })

        globalState.combat.nextTurn()
        globalState.gMap.updateMap()
    }

    end() {
        // Check number of active combatants to see if we can end
        var numActive = 0
        for (var i = 0; i < this.combatants.length; i++) {
            var obj = this.combatants[i]
            if (obj.dead || obj.isPlayer) continue
            if (!obj.ai || !obj.ai.packet) {
                combatWarn(`Critter ${obj.name || obj.art} has no AI info, skipping range check`)
                continue
            }
            var inRange = hexDistance(obj.position, this.player.position) <= obj.ai.packet.maxDist

            if (obj.hostile) {
                numActive++
            }
        }

        if (numActive > 0) return

        // Set all combatants to non-hostile and remove their outline
        for (const combatant of this.combatants) {
            combatant.hostile = false
            combatant.outline = null
        }
        clearNeutralOutlines()
        this.combatOver()

        combatDebug('end combat')
        eventLogPush({ actor: null, action: 'combat-end', result: 'normal', message: 'Combat ended' })
        globalState.combat = null // todo: invert control
        globalState.inCombat = false
        combatActive = false

        // CE ref: interface.cc:1455 interfaceBarEndButtonsHide — plays icibcxx1 when buttons close
        if (!(window as any).__test?.fastMode) globalState.audioEngine.playSfxByName('icibcxx1')
        this.player.AP?.resetAP()  // CE ref: combat.cc:2811
        this.giveExps()            // CE ref: combat.cc:2816
        globalState.gMap.updateMap()
        uiEndCombat()
    }

    // CE combat.cc _combat_over: living NPCs reload their weapon (aiAttemptWeaponReload,
    // no animation) and every combatant's maneuver (fleeing / disengaging) and
    // damage-last-turn are cleared.
    private combatOver(): void {
        for (const c of this.combatants) {
            ;(c as any).fleeing = false
            ;(c as any).disengaging = false
            ;(c as any).damageLastTurn = 0
            ;(c as any).aiFriendlyDead = null
            ;(c as any).aiLastItem = null
            ;(c as any)._aiTurn = undefined
            if (c.isPlayer || c.dead) continue
            const w = c.equippedWeapon
            if (!w || w.pid === undefined) continue
            const cap = ammoGetCapacity(w as any)
            if (cap <= 0 || ammoGetQuantity(w as any) >= cap) continue
            const ammo = findReloadAmmo(w as any, c.inventory as any)
            if (!ammo) continue
            weaponReload(w as any, ammo as any)
            if ((ammo.amount ?? 0) <= 0) {
                const i = c.inventory.indexOf(ammo)
                if (i !== -1) c.inventory.splice(i, 1)
            }
        }
    }

    forceEnd() {
        dbgWarn('combat', `[forceEnd] stack: ${new Error().stack?.split('\n').slice(1, 4).join(' | ')}`)
        for (const combatant of this.combatants) {
            combatant.hostile = false
            combatant.outline = null
        }
        clearNeutralOutlines()
        this.combatOver()
        combatDebug('end combat (forced by script)')
        eventLogPush({ actor: null, action: 'combat-end', result: 'forced', message: 'Combat ended (forced)' })
        globalState.combat = null
        globalState.inCombat = false
        if (!(window as any).__test?.fastMode) globalState.audioEngine.playSfxByName('icibcxx1')
        this.player.AP?.resetAP()  // CE ref: combat.cc:2811
        this.giveExps()            // CE ref: combat.cc:2816
        globalState.gMap?.updateMap()
        uiEndCombat()
        // Defer flag reset so the current script execution frame finishes
        // before a new combat can be started (prevents the map_update_p_proc
        // → attack_complex → Combat.start() re-entry loop).
        Promise.resolve().then(() => { combatActive = false })
    }

    forceTurn(obj: Critter) {
        if (obj.isPlayer) this.whoseTurn = this.playerIdx - 1
        else {
            var idx = this.combatants.indexOf(obj)
            if (idx === -1) throw "forceTurn: no combatant '" + obj.name + ''

            this.whoseTurn = idx - 1
        }
    }

    /**
     * Line-of-sight check (CE ref: object.cc:2583 _obj_sight_blocking_at).
     * Blocks on any wall- or scenery-type object lacking OBJECT_LIGHT_THRU
     * (0x20000000) along the interior hex-line. Hidden objects are ignored.
     */
    hasLineOfSight(from: Point, to: Point): boolean {
        if (!globalState.gMap) return true
        const line = hexLine(from, to) ?? []
        if (line.length <= 2) return true // adjacent — always visible
        const interior = line.slice(1, -1)
        const mapObjects = globalState.gMap.getObjects()
        const LIGHT_THRU = 0x20000000
        for (const pos of interior) {
            for (const o of mapObjects) {
                const t = (o as any).type
                if (t !== 'wall' && t !== 'scenery') continue
                if ((o as any).position?.x !== pos.x || (o as any).position?.y !== pos.y) continue
                const flags = (o as any).flags ?? 0
                if ((o as any).visible === false || (flags & 0x01) !== 0) continue // CE OBJECT_HIDDEN = 0x01
                if ((flags & LIGHT_THRU) !== 0) continue
                return false
            }
        }
        return true
    }

    nextTurn(): void {
        // Tick turn-driven scheduled events (e.g. armed grenades).
        // CE ref: combat.cc combatTurnLoop — turn-driven event queue.
        tickCombatTurn()
        // update range checks
        var numActive = 0
        for (var i = 0; i < this.combatants.length; i++) {
            var obj = this.combatants[i]
            if (obj.dead || obj.isPlayer) continue
            // Party members (same team as player) never count as active enemies.
            if (obj.teamNum === globalState.player.teamNum) continue
            if (!obj.ai || !obj.ai.packet) {
                combatWarn(`Critter ${obj.name || obj.art} has no AI info, skipping range check`)
                continue
            }
            var inRange = hexDistance(obj.position, this.player.position) <= obj.ai.packet.maxDist
            var hasLOS = inRange && this.hasLineOfSight(obj.position, this.player.position)

            if (hasLOS || obj.hostile) {
                // Only aggro via LOS if an attack has already been made this
                // combat session, or the critter was already flagged hostile
                // before combat started. Entering combat mode alone (weapon drawn,
                // movement AP spent) must not flip bystanders to hostile.
                if (this.hasAttacked || obj.hostile) {
                    if (!obj.hostile) {
                        // First time turning hostile. CE draws no weapon here: the AI wields
                        // its best one when it first attacks (_ai_try_attack →
                        // _ai_switch_weapons).
                        obj.hostile = true
                    }
                    numActive++
                }
            }
        }

        this.refreshHighlights()

        if (numActive === 0 && this.turnNum !== 1 && this.playerHadTurn) {
            // Only auto-end after the player has had at least one turn. Prevents
            // the start → nextTurn → recursive-nextTurn → forceEnd cascade when
            // an NPC initiates combat via attack_complex but no critter is
            // marked hostile yet (because hasAttacked is still false).
            this.forceEnd()
            return
        }

        // Fallout 2 combat rounds represent ~5 seconds of in-world time
        // per combatant. Advance the clock so long fights still age the
        // world (critters healing over time, scheduled events firing).
        GameTime.advanceSeconds(5)

        this.turnNum++
        this.whoseTurn++

        if (this.whoseTurn >= this.combatants.length) this.whoseTurn = 0

        // Convert unused AP to bonus AC for the critter whose turn just ended
        if (this.whoseTurn > 0 || this.turnNum > 2) {
            var prevIdx = this.whoseTurn - 1
            if (prevIdx < 0) prevIdx = this.combatants.length - 1
            var prev = this.combatants[prevIdx]
            if (!prev.dead && prev.AP) {
                prev.bonusAC = prev.AP.getAvailableCombatAP() // CE stat.cc: STAT_ARMOR_CLASS + remaining combat.ap
                // CE ref: stat.cc:203-242 — unused AP counts as AC while it isn't the critter's turn.
                if (prev.isPlayer) drawAC(prev.getStat('AC') + prev.bonusAC)
            }
        }

        if (this.combatants[this.whoseTurn].isPlayer) {
            // player turn — reset bonus AC from last turn, then reset AP
            this.playerHadTurn = true
            this.player.bonusAC = 0
            this.inPlayerTurn = true
            this.player.AP!.resetAP()
            drawAP(this.player.AP!.getAvailableCombatAP(), this.player.AP!.getTotalMaxAP(), this.player.AP!.move)
            drawHP(this.player.getStat('HP'))
            drawAC(this.player.getStat('AC'))
            // CE ref: combat.cc:3276 / interface.cc interfaceBarEndButtonsRenderGreenLights —
            // green lights + icombat2 when player's turn begins (buttons enabled)
            if (!(window as any).__test?.fastMode) globalState.audioEngine.playSfxByName('icombat2')
            uiEndButtonsGreenLights()
            eventLogPush({
                actor: actorName(this.player), action: 'turn-begin',
                AP: this.player.AP!.getAvailableMoveAP(), HP: this.player.getStat('HP'),
                message: `${actorName(this.player)}: turn begins`,
            })
        } else {
            this.inPlayerTurn = false
            drawAP(0, this.player.AP!.getTotalMaxAP(), 0, false)
            // CE ref: interface.cc interfaceBarEndButtonsRenderRedLights —
            // red lights + icombat1 during AI turns (buttons disabled)
            if (!(window as any).__test?.fastMode) globalState.audioEngine.playSfxByName('icombat1')
            uiEndButtonsRedLights()
            var critter = this.combatants[this.whoseTurn]
            // Party members (same team as player) take AI turns even without hostile flag.
            // CE ref: party.cc — party members participate fully in combat on the player's side.
            const isFriendly = critter.teamNum === globalState.player.teamNum
            if (critter.dead === true) return this.nextTurn()
            if (!critter.hostile && !isFriendly) {
                // A bystander still runs the friendlyDead step of CE _combat_ai: away from
                // a body it saw fall without seeing the killer (_combatai_notify_onlookers).
                const fd: Critter | null = (critter as any).aiFriendlyDead ?? null
                if (fd && !critter.isPlayer) {
                    critter.AP!.resetAP()
                    if (hexDistance(critter.position, fd.position) >= 10) (critter as any).aiFriendlyDead = null
                    else if (this.aiMoveAway(critter, fd, 10, false, () => this.nextTurn())) return
                }
                return this.nextTurn()
            }

            // Fire DoT: apply at the start of each critter's turn
            if (critter.onFireTurns > 0) {
                critter.onFireTurns--
                const fireDmg = getRandomInt(3, 6)
                uiLog(`${critter.name} burns for ${fireDmg} damage.`)
                combatDebug(`fire DoT: ${critter.name} took ${fireDmg} (${critter.onFireTurns} turns left)`)
                eventLogPush({
                    actor: actorName(critter), action: 'fire-dot', target: actorName(critter),
                    damage: fireDmg, turnsLeft: critter.onFireTurns, damageType: 'Fire',
                    message: `${actorName(critter)} burns for ${fireDmg}`,
                })
                critterDamage(critter, fireDmg, critter, false, false, 'Fire')
                if (critter.dead) return this.nextTurn() // fire killed them; skip to next
            }

            // Knockdown / loseNextTurn: skip this critter's turn and count down
            if (critter.skipTurns > 0) {
                critter.skipTurns--
                if (critter.skipTurns === 0) {
                    critter.isKnockedDown = false // clear flag now that they're getting up
                    // CE: ANIM_FALL_BACK → ANIM_BACK_TO_STANDING, ANIM_FALL_FRONT →
                    // ANIM_PRONE_TO_STANDING (actions.cc:425-429, combat.cc _combat_standup).
                    const getUp = critter.knockdownAnim === 'knockdownBack' ? 'getUpBack' : 'getUpFront'
                    critter.knockdownAnim = null
                    if (critter.hasAnimation(getUp)) {
                        critter.staticAnimation(getUp, () => critter.clearAnim())
                    } else {
                        // No get-up FRM — clear the anim sentinel directly so they
                        // don't stay frozen on the last knockdown frame.
                        critter.clearAnim()
                    }
                }
                return this.nextTurn()
            }

            critter.bonusAC = 0 // reset bonus AC at start of this critter's turn
            critter.AP!.resetAP()
            eventLogPush({
                actor: actorName(critter), action: 'turn-begin',
                AP: critter.AP!.getAvailableMoveAP(), HP: critter.getStat('HP'),
                message: `${actorName(critter)}: turn begins`,
            })
            this.doAITurn(critter, this.whoseTurn, 1)
        }
    }

    /** CE ref: combat.cc:2669 _combat_update_critter_outline_for_los() — red
     *  outline for hostile combatants, green for same-team (including
     *  companions); CE assigns these purely by team comparison, not a perk.
     *  Update to match the current targetHighlight preference and cursorMode.
     *  Call whenever cursorMode changes or preferences change mid-combat.
     *
     *  DH2 addition (no CE equivalent — CE's outline system only ever covers
     *  active combatants): also outline neutral critters (not hostile, not
     *  same team) in a distinct blue, so an unprovoked target can be located
     *  and attacked even through walls, the same way hostile/friendly
     *  outlines already show through occluding geometry (CI11).
     *
     *  Classifies every live critter on the current elevation in one pass —
     *  NOT restricted to `this.combatants` — because Combat.start() sweeps
     *  every team on the map into `triggerTeams` for a player-initiated
     *  fight (so enemy critters elsewhere can join in), which pulls
     *  not-yet-hostile, different-team critters into `this.combatants` too.
     *  An earlier version skipped those here (not yet hostile → no red/green)
     *  while ALSO excluding them from the neutral pass (already "a
     *  combatant" → skip), leaving them with no outline at all the moment
     *  combat started via the attack button before anyone had actually
     *  been shot. */
    refreshHighlights(): void {
        if (!globalState.player || !globalState.gMap) return
        const th = Config.ui.targetHighlight as string | boolean
        const wantHighlight = th === 'on' || th === true ||
            (th === 'targeting-only' && globalState.cursorMode === 'attack')

        for (const obj of globalState.gMap.getObjects()) {
            if (!(obj instanceof Critter)) continue
            if (obj.dead || obj.isPlayer || !obj.visible) continue
            if (!wantHighlight) { obj.outline = null; continue }
            const sameTeam = obj.teamNum === globalState.player.teamNum
            obj.outline = (obj as any).hostile ? 'red' : sameTeam ? 'green' : 'blue'
        }
    }
}

