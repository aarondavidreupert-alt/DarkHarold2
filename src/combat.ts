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

import { AudioEngine } from './audio.js'
import { Config } from './config.js'
import { CriticalEffects } from './criticalEffects.js'
import { critterDamage, critterKill, Weapon } from './critter.js'
import * as GameTime from './gametime.js'
import { hexDirectionTo, hexDistance, hexInDirectionDistance, hexLine, hexNearestNeighbor, hexNeighbors, HEX_GRID_SIZE, Point } from './geometry.js'
import globalState from './globalState.js'
import { Critter, Obj } from './object.js'
import { Player } from './player.js'
import { loadPRO } from './pro.js'
import { Scripting } from './scripting.js'
import { drawAP, drawHP, uiDrawWeapon, uiEndCombat, uiLog, uiStartCombat } from './ui.js'
import { clamp, getFileText, getMessage, getRandomInt, parseIni, rollSkillCheck } from './util.js'
import { getActiveUnarmedMode, getActiveUnarmedModeForHand } from './unarmed.js'
import { getAiPacket, AiPacket, AreaAttackMode, BestWeapon } from './aiPackets.js'

// Turn-based combat system

// Re-entry guard: prevents Combat.start() from firing while a combat instance
// is still tearing down (e.g. map-script callbacks during end() can otherwise
// immediately restart combat).
let combatActive = false
export function isCombatActive(): boolean { return combatActive }

/**
 * Hard-reset the combat-active flag without running any teardown callbacks.
 * Call this before globalState.combat is replaced during map/game loads so
 * the re-entry guard in Combat.start() doesn't permanently block new combats.
 */
export function resetCombatState(): void {
    combatActive = false
}

/** Write a technical/debug combat message to the browser console only.
 *  Player-visible combat messages go through uiLog() — never mix the two. */
function combatDebug(...args: any[]): void {
    console.log('[Combat]', ...args)
}

function combatWarn(...args: any[]): void {
    console.warn('[Combat]', ...args)
}

export class ActionPoints {
    combat: number = 0 // Combat AP
    move: number = 0 // Move AP
    attachedCritter: Critter

    constructor(obj: Critter) {
        this.attachedCritter = obj
        this.resetAP()
    }

    resetAP() {
        // Unified AP pool: base + all perk bonuses collected into combat; move is always 0
        this.combat = this.getMaxAP() + this.getBonusCombatAP() + this.getBonusMoveAP()
        this.move = 0
    }

    getBonusCombatAP(): number {
        var bonus = 0
        // Bonus HtH Attacks: +1 combat AP per rank (melee only, but applied globally for simplicity)
        if (this.attachedCritter.hasPerk('Bonus HtH Attacks')) bonus += 1
        // Bonus Rate of Fire: +1 combat AP per rank
        if (this.attachedCritter.hasPerk('Bonus Rate of Fire')) bonus += 1
        return bonus
    }

    getBonusMoveAP(): number {
        var bonus = 0
        // Bonus Move: +2 free move AP per rank added to the unified pool
        if (this.attachedCritter.hasPerk('Bonus Move')) bonus += 2
        return bonus
    }

    /** Base AP = 5 + floor(AGI / 2), without perk bonuses. */
    getMaxAP(): number {
        return 5 + Math.floor(this.attachedCritter.getStat('AGI') / 2)
    }

    /** Full AP at turn start: base + all perk bonuses. Use this for the display max. */
    getTotalMaxAP(): number {
        return this.getMaxAP() + this.getBonusCombatAP() + this.getBonusMoveAP()
    }

    /** Total AP remaining (unified pool — movement and attacks share the same bucket). */
    getAvailableMoveAP(): number {
        return this.combat
    }

    getAvailableCombatAP() {
        return this.combat
    }

    subtractMoveAP(value: number): boolean {
        // Crippled legs increase the AP cost of movement (FO2 reference: 4× one leg, 8× both legs)
        const critter = this.attachedCritter
        if (critter.crippledLeftLeg && critter.crippledRightLeg) value *= 8
        else if (critter.crippledLeftLeg || critter.crippledRightLeg) value *= 4

        if (this.combat < value) return false
        this.combat -= value
        return true
    }

    subtractCombatAP(value: number): boolean {
        if (this.combat < value) return false

        this.combat -= value
        return true
    }
}

export class AI {
    static aiTxt: any = null // AI.TXT: packet num -> key/value
    combatant: Critter
    info: any

    // Fields in AI.TXT that should be parsed as integers
    static readonly numericFields = [
        'packet_num', 'max_dist', 'min_hp', 'min_to_hit', 'area_attack_mode',
        'run_start', 'run_end', 'move_start', 'move_end',
        'attack_start', 'attack_end', 'miss_start', 'miss_end',
        'hit_head_start', 'hit_head_end', 'hit_left_arm_start', 'hit_left_arm_end',
        'hit_right_arm_start', 'hit_right_arm_end', 'hit_torso_start', 'hit_torso_end',
        'hit_right_leg_start', 'hit_right_leg_end', 'hit_left_leg_start', 'hit_left_leg_end',
        'hit_eyes_start', 'hit_eyes_end', 'hit_groin_start', 'hit_groin_end',
        'chance',
    ]

    static init(): void {
        // load and parse AI.TXT
        if (AI.aiTxt !== null)
            // already loaded
            return

        AI.aiTxt = {}
        var ini = parseIni(getFileText('data/data/ai.txt'))
        if (ini === null) throw "couldn't load AI.TXT"
        for (var key in ini) {
            var packet = ini[key]
            // Convert numeric fields from strings to numbers
            for (var field of AI.numericFields) {
                if (packet[field] !== undefined) {
                    packet[field] = parseInt(packet[field]) || 0
                }
            }
            packet.keyName = key
            AI.aiTxt[packet.packet_num] = packet
        }
    }

    static getPacketInfo(aiNum: number): any {
        return AI.aiTxt[aiNum] || null
    }

    constructor(combatant: Critter) {
        this.combatant = combatant

        // load if necessary
        if (AI.aiTxt === null) AI.init()

        this.info = AI.getPacketInfo(this.combatant.aiNum)
        if (!this.info) throw 'no AI packet for ' + combatant.toString() + ' (packet ' + this.combatant.aiNum + ')'
    }
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
function getCritFailTableType(weapon: any): string {
    if (!weapon || weapon.weaponSkillType === 'Unarmed') return 'unarmed'
    if (weapon.type === 'melee') return 'melee'
    const dmgType: string = weapon.getDamageType?.() ?? 'Normal'
    if (dmgType === 'Explosive') return 'grenades'
    if (dmgType === 'Fire') return 'flamers'
    if (['Laser', 'Plasma', 'Electrical', 'EMP'].includes(dmgType)) return 'energy'
    const animCode: number | undefined = weapon.weapon?.pro?.extra?.animCode
    if (animCode === 10) return 'rocketlauncher'
    return 'firearms'
}

// Returns true when the weapon can be fired (melee/unarmed always ok; ranged ok if rounds > 0)
function aiHaveAmmo(weaponObj: Obj | null): boolean {
    if (!weaponObj) return true // unarmed — always valid
    const maxAmmo: number = (weaponObj as any)?.pro?.extra?.maxAmmo ?? 0
    if (maxAmmo === 0) return true // melee/unarmed — no ammo needed
    return ((weaponObj as any)?.pro?.extra?.rounds ?? 0) > 0
}

/** Context for a single damage calculation roll, fed to the active damage ruleset. */
interface DamageCalculationContext {
    RD: number        // raw die roll
    bonus: number     // flat damage bonus before multipliers
    critMult: number  // critical hit multiplier (1 = normal hit)
    ammoX: number     // ammo damage multiplier
    ammoY: number     // ammo damage divisor (≥1; vanilla adds a separate /2)
    DT: number        // damage threshold (post bypass/penetrate adjustments)
    DR: number        // damage resistance 0–100 (clamped, ammo RM already applied)
    CD: number        // combat difficulty modifier (75/100/125)
}

/** Round-half-up integer division — matches fallout2-ce damageModGlovzDivRound. */
function glovzRound(a: number, b: number): number {
    return Math.trunc((a + Math.trunc(b / 2)) / b)
}

function computeDamageVanilla(ctx: DamageCalculationContext): number {
    let d = ctx.RD + ctx.bonus
    d = Math.trunc(d * ctx.critMult * ctx.ammoX)
    if (ctx.ammoY !== 0) d = Math.trunc(d / ctx.ammoY)
    d = Math.trunc(d / 2)
    d = Math.trunc(d * ctx.CD / 100)
    d -= ctx.DT
    if (d > 0) d -= Math.trunc(d * ctx.DR / 100)
    if (d < 0) d = 0
    return d
}

function computeDamageGlovz(ctx: DamageCalculationContext): number {
    let d = ctx.RD + ctx.bonus
    d = d * ctx.critMult * ctx.ammoX
    if (ctx.ammoY !== 0) d = glovzRound(d, ctx.ammoY * 2)
    d = Math.trunc(d * ctx.CD / 100)
    // DR applied before DT (key Glovz difference); uses round-half-up
    d -= glovzRound(d * ctx.DR, 100)
    d -= ctx.DT
    if (d < 0) d = 0
    return d
}

function computeDamageGlovzTweak(ctx: DamageCalculationContext): number {
    // critMult applied after the ammo divide rather than before
    let d = ctx.RD + ctx.bonus
    if (ctx.ammoY !== 0) d = glovzRound(d * ctx.ammoX, ctx.ammoY * 2)
    d = d * ctx.critMult
    d = Math.trunc(d * ctx.CD / 100)
    d -= glovzRound(d * ctx.DR, 100)
    d -= ctx.DT
    if (d < 0) d = 0
    return d
}

function computeDamageYaam(ctx: DamageCalculationContext): number {
    let d = ctx.RD + ctx.bonus
    d = Math.trunc(d * ctx.critMult * ctx.ammoX)
    if (ctx.ammoY !== 0) d = Math.trunc(d / ctx.ammoY)
    // no /2 halving step; DT then DR (same order as vanilla)
    d = Math.trunc(d * ctx.CD / 100)
    d -= ctx.DT
    if (d > 0) d -= Math.trunc(d * ctx.DR / 100)
    if (d < 0) d = 0
    return d
}

/** Dispatch to the configured damage ruleset (Config.combat.damageCalculationType). */
function computeDamage(ctx: DamageCalculationContext): number {
    switch (Config.combat.damageCalculationType) {
        case 1: return computeDamageGlovz(ctx)
        case 2: return computeDamageGlovzTweak(ctx)
        case 5: return computeDamageYaam(ctx)
        default: return computeDamageVanilla(ctx)
    }
}

// ── AI helper: should the critter prefer a ranged weapon given its packet? ─────
function aiPreferRanged(pkt: AiPacket, distance: number): boolean {
    switch (pkt.bestWeapon) {
        case 'ranged':            return true
        case 'melee':             return false
        case 'unarmed':           return false
        case 'melee_over_ranged': return distance > 1
        case 'random':            return Math.random() < 0.5
        case 'never':             return false
        default:                  return distance > 1
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
    private hasAttacked = false // set true when the first attack fires this combat session
    private playerHadTurn = false // set true the first time the player's turn starts

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
                if (!obj.isPlayer) obj.aiPacket = getAiPacket(obj.aiNum ?? 0)

                if (obj.stats === undefined) throw 'no stats'
                obj.dead = false
                obj.AP = new ActionPoints(obj)
                return true
            }

            return false
        }) as Critter[]

        // Sort combatants by Sequence stat descending (FO2: _combat_sequence).
        // Sequence = 10 + 2*PER.  Ties: player goes first, then by original array order.
        this.combatants.sort((a, b) => {
            const seqA = 10 + 2 * a.getStat('PER')
            const seqB = 10 + 2 * b.getStat('PER')
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

        globalState.audioEngine.playActionSfx('combat_start')
        uiStartCombat()
    }

    log(msg: any) {
        // Combat-related debug log (browser console only, never game console)
        combatDebug(msg)
    }

    /** Load ammo stats for a loaded weapon. Returns defaults (X=1,Y=1,RM=0,ACmod=0) if no ammo.
     *  Vanilla: weaponGetAmmoDamageMultiplier / weaponGetAmmoDamageDivisor return 1/1 for no ammo. */
    getAmmoStats(weaponObj: Obj): { X: number; Y: number; RM: number; ACmod: number } {
        const defaults = { X: 1, Y: 1, RM: 0, ACmod: 0 }
        const ammoPID: number | undefined = (weaponObj as any).pro?.extra?.ammoPID
        if (ammoPID === undefined || ammoPID < 0) return defaults

        const ammoPro = loadPRO(ammoPID, ammoPID & 0xffff)
        if (!ammoPro || !ammoPro.extra) return defaults

        return {
            X: ammoPro.extra.damMult ?? 1,
            Y: ammoPro.extra.damDiv ?? 1,
            RM: ammoPro.extra['DR modifier'] ?? 0,
            ACmod: ammoPro.extra['AC modifier'] ?? 0,
        }
    }

    accountForPartialCover(obj: Critter, target: Critter): number {
        // Count living critters on the hex line between obj and target
        // (excluding the endpoints). Subtract 10 per intervening critter.
        if (!globalState.gMap) return 0

        const line = hexLine(obj.position, target.position)
        if (!line || line.length <= 2) return 0

        const interior = line.slice(1, -1)

        // Pre-index living critters by "x,y" hex key so the interior scan is O(lineLength)
        // instead of O(lineLength * numObjects).
        const crittersByHex = new Map<string, number>()
        for (const o of globalState.gMap.getObjects()) {
            if (
                o instanceof Critter &&
                !o.dead &&
                o !== obj &&
                o !== target
            ) {
                const key = `${o.position.x},${o.position.y}`
                crittersByHex.set(key, (crittersByHex.get(key) || 0) + 1)
            }
        }

        let count = 0
        for (const hex of interior) {
            count += crittersByHex.get(`${hex.x},${hex.y}`) || 0
        }
        return count * 10
    }

    getHitDistanceModifier(obj: Critter, target: Critter, weapon: Obj): number {
        // we calculate the distance between source and target
        // we then substract the source's per modified by the weapon from it (except for scoped weapons)

        // NOTE: this function is supposed to have weird behaviour for multihex sources and targets. Let's ignore that.

        // 4 if weapon has long_range perk
        // 5 if weapon has scope_range perk
        var distModifier = 2
        // 8 if weapon has scope_range perk
        var minDistance = 0
        var perception = obj.getStat('PER')
        var distance = hexDistance(obj.position, target.position)
        if (distance < minDistance)
            distance += minDistance // yes supposedly += not =, this means 7 grid distance is the worst
        else {
            var tempPER = perception
            if (obj.isPlayer === true) tempPER -= 2 // FO2 reference: player receives a -2 PER penalty in hit chance (hardcoded in _combat_to_hit, combat.c)
            distance -= tempPER * distModifier
        }

        // this appears not to have any effect but was found so elsewhere
        // If anyone can tell me why it exists or what it's for I'd be grateful.
        if (-2 * perception > distance) distance = -2 * perception

        // Sharpshooter perk: each rank reduces the effective distance by 2 hexes
        if (obj.hasPerk('Sharpshooter')) distance -= 2

        // then we multiply a magic number on top. More if the attacker is blinded (FO2: 12× vs 4×)
        var objHasEyeDamage = obj.isBlinded
        if (distance >= 0 && objHasEyeDamage) distance *= 12
        else distance *= 4

        // and if the result is a positive distance, we return that
        // closeness can not improve hitchance above normal, so we don't return that
        if (distance >= 0) return distance
        else return 0
    }

    getHitChance(obj: Critter, target: Critter, region: string) {
        // NOTE: distance modifier is implemented; light conditions not yet factored in
        var weaponObj = obj.equippedWeapon
        if (weaponObj === null) {
            // Unarmed (no weapon equipped): use Unarmed skill
            const unarmedSkill = obj.getSkill('Unarmed')
            const mode = obj.isPlayer
                ? getActiveUnarmedModeForHand(unarmedSkill, (obj as any).activeHand ?? 'leftHand', globalState.punchModeIdx, globalState.kickModeIdx, !(obj as any).leftHand?.weapon && !(obj as any).rightHand?.weapon)
                : getActiveUnarmedMode(unarmedSkill, 0)
            const AC = target.getStat('AC') + target.getArmorAC() + target.bonusAC
            const partialCoverPenalty = this.accountForPartialCover(obj, target)
            const crippledArmPenalty = (obj.crippledLeftArm ? 40 : 0) + (obj.crippledRightArm ? 40 : 0)
            const blindPenalty = obj.isBlinded ? 25 : 0
            const baseCrit = obj.getStat('Critical Chance') + mode.critBonus
            var hitChance = unarmedSkill - AC - CriticalEffects.regionHitChanceDecTable[region] - partialCoverPenalty - crippledArmPenalty - blindPenalty
            var critChance = baseCrit + CriticalEffects.regionHitChanceDecTable[region]
            hitChance = Math.min(95, hitChance)
            combatDebug(`hitChance(unarmed): skill=${unarmedSkill} AC=${AC} region=${CriticalEffects.regionHitChanceDecTable[region]} cover=${partialCoverPenalty} → ${hitChance}%`)
            return { hit: hitChance, crit: critChance }
        }

        var weapon = weaponObj.weapon
        var weaponSkill

        if (!weapon) throw Error('getHitChance: No weapon')

        if (weapon.weaponSkillType === undefined) {
            this.log('weaponSkillType is undefined')
            weaponSkill = 0
        } else weaponSkill = obj.getSkill(weapon.weaponSkillType)

        var hitDistanceModifier = this.getHitDistanceModifier(obj, target, weaponObj)
        var ammoStats = this.getAmmoStats(weaponObj)
        // Ammo AC modifier reduces effective AC (negative value = easier to hit, e.g. AP rounds)
        var AC = target.getStat('AC') + target.getArmorAC() + target.bonusAC + ammoStats.ACmod
        var partialCoverPenalty = this.accountForPartialCover(obj, target)
        var bonusCrit = 0 // TODO: perk bonuses, other crit influencing things
        var baseCrit = obj.getStat('Critical Chance') + bonusCrit

        // Crippled-limb penalties for the attacker (FO2: -40 per arm)
        var crippledArmPenalty = 0
        if (obj.crippledLeftArm) crippledArmPenalty += 40
        if (obj.crippledRightArm) crippledArmPenalty += 40

        // Blinded attacker: additional -25 flat penalty on top of the 12× distance modifier wired above
        var blindPenalty = obj.isBlinded ? 25 : 0

        var hitChance = weaponSkill - AC - CriticalEffects.regionHitChanceDecTable[region] - hitDistanceModifier - partialCoverPenalty - crippledArmPenalty - blindPenalty
        var critChance = baseCrit + CriticalEffects.regionHitChanceDecTable[region]

        if (isNaN(hitChance)) throw 'something went wrong with hit chance calculation'

        // 1 in 20 chance of failing needs to be preserved
        hitChance = Math.min(95, hitChance)

        return { hit: hitChance, crit: critChance }
    }

    rollHit(obj: Critter, target: Critter, region: string, hitBonus: number = 0,
            attackerName?: string, defenderName?: string): any {
        var critModifer = obj.getStat('Better Criticals')
        var hitChance = this.getHitChance(obj, target, region)
        hitChance = { ...hitChance, hit: hitChance.hit + hitBonus }

        if (attackerName) combatDebug(`${attackerName} → ${defenderName}: hitChance=${hitChance.hit}% critChance=${hitChance.crit}%`)

        // hey kids! Did you know FO only rolls the dice once here and uses the results two times?
        var roll = getRandomInt(1, 101)

        if (hitChance.hit - roll > 0) {
            var isCrit = false
            if (rollSkillCheck(Math.floor(hitChance.hit - roll) / 10, hitChance.crit, false) === true) isCrit = true

            // Slayer perk: every melee hit is automatically a critical
            // Sniper perk: on a ranged hit, roll d100 — if ≤ LUK, upgrade to critical
            if (!isCrit) {
                var wep = obj.equippedWeapon?.weapon
                if (wep && wep.type === 'melee' && obj.hasPerk('Slayer')) {
                    isCrit = true
                } else if (wep && wep.type === 'gun' && obj.hasPerk('Sniper')) {
                    if (getRandomInt(1, 100) <= obj.getStat('LUK')) {
                        isCrit = true
                    }
                }
            }
            if (isCrit === true) {
                var critLevel = Math.floor(Math.max(0, getRandomInt(critModifer, 100 + critModifer)) / 20)
                combatDebug(`crit hit: roll=${roll} level=${critLevel}`)
                if (attackerName) uiLog(`${attackerName} scores a critical hit on ${defenderName}!`)
                var crit = CriticalEffects.getCritical(target.killType ?? 0, region, critLevel)
                var critStatus = crit.doEffectsOn(target)

                return { hit: true, crit: true, DM: critStatus.DM, msgID: critStatus.msgID } // crit
            }

            combatDebug(`hit: roll=${roll} vs ${hitChance.hit}%`)
            return { hit: true, crit: false } // hit
        }

        // in reverse because miss -> roll > hitchance.hit
        var isCrit = false
        if (rollSkillCheck(Math.floor(roll - hitChance.hit) / 10, 0, false)) isCrit = true

        // Jinxed trait / Pariah Dog perk: 50% chance to upgrade any miss to a critical miss (non-stacking)
        if (!isCrit && (obj.hasPerk('Jinxed') || target.hasPerk('Jinxed') ||
                         obj.hasPerk('Pariah Dog') || target.hasPerk('Pariah Dog'))) {
            if (getRandomInt(1, 100) <= 50) isCrit = true
        }

        combatDebug(`miss: roll=${roll} vs ${hitChance.hit}%${isCrit ? ' (crit fail)' : ''}`)
        return { hit: false, crit: isCrit } // miss
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
            // PERK_WEAPON_PENETRATE or unarmed penetrating: only DT to 20%, DR unchanged
            if (wep.isPenetrating?.()) {
                DT = Math.trunc(20 * DT / 100)
            }
            // TRAIT_FINESSE: +30 DR penalty (player only)
            if (obj.isPlayer && obj.hasPerk('Finesse')) {
                DR += 30
            }
        }

        // Bonus Ranged Damage perk: +2 per rank (player only, ranged attack types)
        var damageBonus = 0
        if (obj.isPlayer && wep.type !== 'melee') {
            const brdRank = obj.perks.filter(p => p === 'Bonus Ranged Damage').length
            damageBonus = 2 * brdRank
        }

        // Ammo stats
        var ammoStats = this.getAmmoStats(weapon)

        // Ammo DR modifier: added to DR, then clamp 0-100
        DR += ammoStats.RM
        DR = clamp(0, 100, DR)

        // Combat difficulty modifier (75/100/125)
        var CD = Config.combat.difficultyModifier

        var RD = getRandomInt(wep.minDmg, wep.maxDmg)
        var damage = computeDamage({ RD, bonus: damageBonus, critMult: critMultiplier, ammoX: ammoStats.X, ammoY: ammoStats.Y, DT, DR, CD })

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

        combatDebug(`damage: RD=${RD} CM=${critMultiplier} ×${ammoStats.X}/${ammoStats.Y} DT=${DT} DR=${DR}% CD=${CD} → ${damage}`)
        return damage
    }

    /** Vanilla unarmed damage calculation (attackComputeDamage with weapon=null).
     *  Unarmed: ammoMult=1, ammoDiv=1, damageType=Normal.
     *  Same formula as weapon damage: bonus → multiply → halve → DT → DR%. */
    getUnarmedDamageDone(obj: Critter, target: Critter, critMultiplier: number): number {
        const unarmedSkill = obj.getSkill('Unarmed')
        const mode = obj.isPlayer
            ? getActiveUnarmedModeForHand(unarmedSkill, (obj as any).activeHand ?? 'leftHand', globalState.punchModeIdx, globalState.kickModeIdx, !(obj as any).leftHand?.weapon && !(obj as any).rightHand?.weapon)
            : getActiveUnarmedMode(unarmedSkill, 0)

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
            if (obj.isPlayer && obj.hasPerk('Finesse')) {
                DR += 30
            }
        }

        // Clamp DR to 0-100 (no ammo DR mod for unarmed)
        DR = clamp(0, 100, DR)

        var CD = Config.combat.difficultyModifier

        var RD = getRandomInt(mode.minDmg, mode.maxDmg)
        var damage = computeDamage({ RD, bonus: 0, critMult: critMultiplier, ammoX: 1, ammoY: 1, DT, DR, CD })

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

        combatDebug(`damage(unarmed [${mode.name}]): RD=${RD} CM=${critMultiplier} DT=${DT} DR=${DR}% CD=${CD} → ${damage}`)
        return damage
    }

    getCombatMsg(id: number) {
        return getMessage('combat', id)
    }

    attack(obj: Critter, target: Critter, region = 'torso', callback?: () => void) {
        this.hasAttacked = true
        // track who last attacked this target (used by attackWho=whomever_attacking_me)
        target.lastAttacker = obj
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

        // attack!
        obj.staticAnimation('attack', callback)

        var audio: AudioEngine = globalState.audioEngine
        var rawSoundID = weaponObj?.pro?.extra?.soundID
        var soundIdChar = typeof rawSoundID === 'number' ? String.fromCharCode(rawSoundID) : null

        // Play attack sound — burst-fire weapons have their own wa<id>2xxx1 sample.
        if (soundIdChar) {
            const isBurstAttack = !!(weaponObj?.weapon?.isBurst?.())
            audio.playWeaponSfx(soundIdChar, isBurstAttack ? 'attack_burst' : 'attack')
        }

        var targetName = target.isPlayer ? 'you' : target.name
        var weapon = weaponObj?.weapon
        var attackDmgType = weaponObj?.weapon?.getDamageType() ?? 'Normal'

        // ── UNARMED (no weapon equipped) ──────────────────────────────────────
        if (weaponObj === null) {
            var unarmedSkill = obj.getSkill('Unarmed')
            var unarmedModeName = (obj.isPlayer
                ? getActiveUnarmedModeForHand(unarmedSkill, (obj as any).activeHand ?? 'leftHand', globalState.punchModeIdx, globalState.kickModeIdx, !(obj as any).leftHand?.weapon && !(obj as any).rightHand?.weapon)
                : getActiveUnarmedMode(unarmedSkill, 0)).name

            var unarmedHit = this.rollHit(obj, target, region, 0, who, targetName)

            if (unarmedHit.hit === true) {
                var unarmedCritMod = unarmedHit.crit ? unarmedHit.DM : 2
                var unarmedDmg = this.getUnarmedDamageDone(obj, target, unarmedCritMod)
                var unarmedExtraMsg = unarmedHit.crit ? this.getCombatMsg(unarmedHit.msgID) || '' : ''
                uiLog(`${who} hits ${targetName} for ${unarmedDmg} damage (${unarmedModeName})${unarmedExtraMsg}`)
                audio.playActionSfx('hit_flesh')
                critterDamage(target, unarmedDmg, obj, true, true, 'Normal')
                if (target.isPlayer) drawHP(target.getStat('HP'))
                if (!target.dead && target._script?.combat_p_proc) {
                    if (Scripting.combatEvent(target, 'damage')) return
                }
                if (!globalState.combat) return
                if (target.dead) this.perish(target, obj, 'Normal')
            } else {
                audio.playActionSfx('miss')
                uiLog(`${who} misses ${targetName} (${unarmedModeName})`)
                if (!target.dead && !target.inAnim() && target.hasAnimation('dodge')) {
                    target.staticAnimation('dodge', () => target.clearAnim())
                }
                if (unarmedHit.crit === true) {
                    var unarmedCritFailMod = (obj.getStat('LUK') - 5) * -5
                    var unarmedCritFailRoll = Math.floor(getRandomInt(1, 100) - unarmedCritFailMod)
                    var unarmedCritFailLevel = 1
                    if (unarmedCritFailRoll <= 20) unarmedCritFailLevel = 1
                    else if (unarmedCritFailRoll <= 50) unarmedCritFailLevel = 2
                    else if (unarmedCritFailRoll <= 75) unarmedCritFailLevel = 3
                    else if (unarmedCritFailRoll <= 95) unarmedCritFailLevel = 4
                    else unarmedCritFailLevel = 5
                    uiLog(`${who} critically fails!`)
                    combatDebug(`unarmed crit fail: level=${unarmedCritFailLevel} roll=${unarmedCritFailRoll}`)
                    var unarmedCritFailEffect = CriticalEffects.criticalFailTable['unarmed']?.[unarmedCritFailLevel]
                        ?? CriticalEffects.criticalFailTable['unarmed'][1]
                    CriticalEffects.temporaryDoCritFail(unarmedCritFailEffect, obj)
                }
            }
            return
        }

        // ── BURST MODE ────────────────────────────────────────────────────────
        // 3-line cone spread (FO2: _compute_spray + _shoot_along_path).
        // Rounds split: center≈½, left≈¼, right≈¼.  All critters on each line are eligible.
        if (weapon && weapon.isBurst && weapon.isBurst()) {
            const burstCount: number = (weaponObj as any)?.pro?.extra?.burstCount ?? 10
            combatDebug(`burst: count=${burstCount} weapon=${weapon.name}`)

            const centerCount = Math.floor(burstCount / 2)
            const remaining = burstCount - centerCount
            const leftCount = Math.floor(remaining / 2)
            const rightCount = remaining - leftCount

            const dir = hexDirectionTo(obj.position, target.position)
            const cones = [
                { dir,              count: centerCount },
                { dir: (dir+1) % 6, count: leftCount   }, // left cone
                { dir: (dir+5) % 6, count: rightCount  }, // right cone
            ]

            // Accumulate damage per critter across all cone lines
            const damageMap = new Map<Critter, number>()
            let totalBulletHits = 0
            const mapObjects = globalState.gMap?.getObjects() ?? []

            for (const cone of cones) {
                if (cone.count === 0) continue
                const coneEnd = hexInDirectionDistance(target.position, cone.dir, 2)
                const line = hexLine(obj.position, coneEnd) ?? []
                for (const pos of line) {
                    for (const o of mapObjects) {
                        if (!(o instanceof Critter) || o.dead || o === obj) continue
                        if (o.position.x !== pos.x || o.position.y !== pos.y) continue
                        for (let b = 0; b < cone.count; b++) {
                            const bRoll = this.rollHit(obj, o, 'torso', -20)
                            if (bRoll.hit) {
                                totalBulletHits++
                                const dmg = this.getDamageDone(obj, o, bRoll.crit ? bRoll.DM : 2)
                                damageMap.set(o, (damageMap.get(o) ?? 0) + dmg)
                            }
                        }
                    }
                }
            }

            uiLog(`${who} burst-fired at ${targetName}: ${totalBulletHits}/${burstCount} hits`)

            if (damageMap.size > 0) {
                // Burst fire: the wa<id>2xxx1 attack sample already covers the
                // whole volley, so skip per-victim impact sounds (they stacked
                // into a rapid-fire click train).
                for (const [victim, dmg] of damageMap) {
                    const victimName = victim.isPlayer ? 'you' : victim.name
                    uiLog(`  ${victimName} took ${dmg} damage`)
                    critterDamage(victim, dmg, obj, true, true, attackDmgType)
                    if (victim.isPlayer) drawHP(victim.getStat('HP'))
                    if (!victim.dead && victim._script?.combat_p_proc) {
                        Scripting.combatEvent(victim, 'damage')
                    }
                    if (!globalState.combat) return
                    if (victim.dead) this.perish(victim, obj, attackDmgType)
                }
            } else {
                audio.playActionSfx('miss')
                if (!target.dead && !target.inAnim() && target.hasAnimation('dodge')) {
                    target.staticAnimation('dodge', () => target.clearAnim())
                }
            }

            // Deduct burst ammo
            const curRounds: number = (weaponObj as any)?.pro?.extra?.rounds ?? 0
            ;(weaponObj as any).pro.extra.rounds = Math.max(0, curRounds - burstCount)
            uiDrawWeapon()
            return
        }

        // ── SINGLE SHOT ───────────────────────────────────────────────────────
        var hitRoll = this.rollHit(obj, target, region, 0, who, targetName)

        // Deduct one round after the roll
        if (weapon && weapon.type !== 'melee') {
            var roundsBefore: number = (weaponObj as any)?.pro?.extra?.rounds
            if (roundsBefore !== undefined && roundsBefore > 0) {
                ;(weaponObj as any).pro.extra.rounds = roundsBefore - 1
                uiDrawWeapon()
            }
        }

        if (hitRoll.hit === true) {
            var critModifier = hitRoll.crit ? hitRoll.DM : 2
            var damage = this.getDamageDone(obj, target, critModifier)
            var extraMsg = hitRoll.crit === true ? this.getCombatMsg(hitRoll.msgID) || '' : ''
            uiLog(who + ' hit ' + targetName + ' for ' + damage + ' damage' + extraMsg)

            // Play impact sound
            if (soundIdChar) {
                audio.playWeaponSfx(soundIdChar, 'impact')
            } else {
                audio.playActionSfx('hit_flesh')
            }

            critterDamage(target, damage, obj, true, true, attackDmgType)
            if (target.isPlayer) drawHP(target.getStat('HP'))
            if (!target.dead && target._script?.combat_p_proc) {
                if (Scripting.combatEvent(target, 'damage')) return
            }
            if (!globalState.combat) return
            if (target.dead) this.perish(target, obj, attackDmgType)
        } else {
            audio.playActionSfx('miss')
            uiLog(who + ' missed ' + targetName + (hitRoll.crit === true ? ' critically' : ''))

            // Play a dodge/flinch on the target if they aren't already animating
            if (!target.dead && !target.inAnim() && target.hasAnimation('dodge')) {
                target.staticAnimation('dodge', () => target.clearAnim())
            }

            // Ranged miss scatter: stray shot may hit other critters behind the target (Feature 3)
            if (weapon && weapon.type !== 'melee') {
                this.checkRangedMiss(obj, target, attackDmgType)
            }

            if (hitRoll.crit === true) {
                var critFailMod = (obj.getStat('LUK') - 5) * -5
                var critFailRoll = Math.floor(getRandomInt(1, 100) - critFailMod)
                var critFailLevel = 1
                if (critFailRoll <= 20) critFailLevel = 1
                else if (critFailRoll <= 50) critFailLevel = 2
                else if (critFailRoll <= 75) critFailLevel = 3
                else if (critFailRoll <= 95) critFailLevel = 4
                else critFailLevel = 5

                uiLog(`${who} critically fails!`)
                combatDebug(`crit fail: level=${critFailLevel} roll=${critFailRoll}`)

                var critFailTableType = getCritFailTableType(weapon)
                var critFailEffect = CriticalEffects.criticalFailTable[critFailTableType]?.[critFailLevel]
                    ?? CriticalEffects.criticalFailTable.unarmed[critFailLevel]
                CriticalEffects.temporaryDoCritFail(critFailEffect, obj)
            }
        }
    }

    /**
     * Ranged miss scatter (FO2: _check_ranged_miss / _shoot_along_path).
     * Extends the shot path 5 hexes past the original target and checks every critter
     * along that extension for an accidental hit at -70 hit-chance penalty.
     */
    checkRangedMiss(attacker: Critter, missedTarget: Critter, dmgType: string): void {
        if (!globalState.gMap) return
        const dir = hexDirectionTo(attacker.position, missedTarget.position)
        const lineEnd = hexInDirectionDistance(missedTarget.position, dir, 5)
        const line = hexLine(attacker.position, lineEnd) ?? []
        const mapObjects = globalState.gMap.getObjects()

        let pastTarget = false
        for (const pos of line) {
            if (pos.x === missedTarget.position.x && pos.y === missedTarget.position.y) {
                pastTarget = true
                continue
            }
            if (!pastTarget) continue

            for (const o of mapObjects) {
                if (!(o instanceof Critter) || o.dead || o === attacker) continue
                if (o.position.x !== pos.x || o.position.y !== pos.y) continue

                // Accidental hit check with -70 penalty (FO2: _shoot_along_path)
                const roll = this.rollHit(attacker, o, 'torso', -70)
                if (roll.hit) {
                    const critMod = roll.crit ? roll.DM : 2
                    const dmg = this.getDamageDone(attacker, o, critMod)
                    const who = attacker.isPlayer ? 'You' : attacker.name
                    const victimName = o.isPlayer ? 'you' : o.name
                    uiLog(`${who}'s stray shot hit ${victimName} for ${dmg} damage!`)
                    critterDamage(o, dmg, attacker, true, true, dmgType)
                    if (o.isPlayer) drawHP(o.getStat('HP'))
                    if (o.dead) this.perish(o, attacker, dmgType)
                }
                // Projectile continues through critters (all on-path critters are checked)
            }
        }
    }

    perish(obj: Critter, attacker?: Critter, damageType?: string) {
        const victimDisplay = obj.isPlayer ? 'You' : obj.name
        const attackerDisplay = attacker ? (attacker.isPlayer ? 'you' : attacker.name) : 'something'
        uiLog(`${victimDisplay} is killed by ${attackerDisplay}!`)
        globalState.audioEngine.playActionSfx('critter_die')

        // Defensively ensure dead flag is set — critterKill (called by critterDamage
        // when HP <= 0) should have already set this, but guard against edge cases.
        obj.dead = true
        obj.outline = null

        // Only run critterKill if critterDamage didn't already do it
        // (critterDamage calls critterKill when HP <= 0, which plays the death anim)
        if (!obj.anim || obj.anim === 'idle') {
            critterKill(obj, attacker, undefined, undefined, damageType)
        }

        // Inventory stays on the critter — the player loots it via the context menu,
        // just like a container.

        // Award XP to the player if the attacker is the player (or a party member)
        if (attacker?.isPlayer) {
            // Fallout 2 XP formula: base XP from critter's pro or a default based on level
            const killXP = obj.pro?.extra?.killExp ?? 50
            Scripting.give_exp_points(killXP)
            uiLog(`Gained ${killXP} experience points.`)
        }
    }

    getCombatAIMessage(id: number) {
        return getMessage('combatai', id)
    }

    maybeTaunt(obj: Critter, type: string, roll: boolean) {
        if (roll === false) return
        var start = obj.ai!.info[type + '_start']
        var end = obj.ai!.info[type + '_end']
        if (isNaN(start) || isNaN(end)) return
        var msgID = getRandomInt(start, end)
        var msg = this.getCombatAIMessage(msgID)
        if (msg) {
            globalState.floatMessages.push({
                msg: msg,
                obj: obj,
                startTime: window.performance.now(),
                color: 'white',
            })
        }
    }

    findTarget(obj: Critter): Critter | null {
        const targets = this.combatants.filter((x) => !x.dead && x.teamNum !== obj.teamNum)
        if (targets.length === 0) return null
        targets.sort((a, b) => hexDistance(obj.position, a.position) - hexDistance(obj.position, b.position))
        return targets[0]
    }

    findTargetForCritter(obj: Critter): Critter | null {
        const targets = this.combatants.filter(x => !x.dead && x.teamNum !== obj.teamNum)
        if (targets.length === 0) return null
        const pkt = obj.aiPacket
        if (!pkt) {
            targets.sort((a, b) => hexDistance(obj.position, a.position) - hexDistance(obj.position, b.position))
            return targets[0]
        }
        switch (pkt.attackWho) {
            case 'closest':
                targets.sort((a, b) => hexDistance(obj.position, a.position) - hexDistance(obj.position, b.position))
                return targets[0]
            case 'weakest':
                targets.sort((a, b) => a.getStat('HP') - b.getStat('HP'))
                return targets[0]
            case 'strongest':
                targets.sort((a, b) => b.getStat('HP') - a.getStat('HP'))
                return targets[0]
            case 'whomever':
                return targets[Math.floor(Math.random() * targets.length)]
            case 'whomever_attacking_me': {
                const last = obj.lastAttacker
                if (last && !last.dead && targets.includes(last)) return last
                // fall back to closest
                targets.sort((a, b) => hexDistance(obj.position, a.position) - hexDistance(obj.position, b.position))
                return targets[0]
            }
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

    /** Returns true if the AI is allowed to use burst fire given its areaAttackMode. */
    private canUseBurst(obj: Critter, target: Critter, mode: AreaAttackMode): boolean {
        if (mode === 'sometimes') return Math.random() < 0.5
        const thresholds: Partial<Record<AreaAttackMode, number>> = {
            'be_careful':        3,
            'be_sure':           2,
            'be_absolutely_sure': 1,
        }
        const threshold = thresholds[mode]
        if (threshold === undefined) return true  // 'no_pref': always allow
        return !this.combatants.some(c =>
            c !== obj && !c.dead && c.teamNum === obj.teamNum &&
            hexDistance(target.position, c.position) <= threshold
        )
    }

    doAITurn(obj: Critter, idx: number, depth: number, weaponSwitchDone = false): void {
        if (depth > Config.combat.maxAIDepth) {
            combatWarn(`Bailing out of ${depth}-deep AI turn recursion`)
            return this.nextTurn()
        }

        const that = this
        const AP = obj.AP!
        const pkt = obj.aiPacket!

        // Script turn-begin event (before any AI action so scripts can override)
        if (Config.engine.doLoadScripts === true && obj._script !== undefined) {
            if (Scripting.combatEvent(obj, 'turnBegin') === true) return
        }

        if (AP.getAvailableMoveAP() <= 0) return this.nextTurn()

        const messageRoll = rollSkillCheck(pkt.chance || 85, 0, false)

        // ── FLEE CHECK ────────────────────────────────────────────────────────
        if (pkt.runAwayMode !== 'never') {
            const maxHp = Math.max(1, obj.getStat('Max HP'))
            const hpPct = (obj.getStat('HP') / maxHp) * 100
            let shouldFlee = hpPct <= pkt.minHp

            if (!shouldFlee && pkt.runAwayMode !== 'none' && pkt.hurtTooMuch.length > 0) {
                for (const cond of pkt.hurtTooMuch) {
                    switch (cond) {
                        case 'crippled':
                            if (obj.crippledLeftArm || obj.crippledRightArm || obj.crippledLeftLeg || obj.crippledRightLeg)
                                shouldFlee = true
                            break
                        case 'crippled_arms':
                            if (obj.crippledLeftArm || obj.crippledRightArm) shouldFlee = true
                            break
                        case 'crippled_legs':
                            if (obj.crippledLeftLeg || obj.crippledRightLeg) shouldFlee = true
                            break
                        case 'blind':
                            if (obj.isBlinded) shouldFlee = true
                            break
                    }
                    if (shouldFlee) break
                }
            }

            if (shouldFlee) {
                this.log('[AI FLEES]')
                this.maybeTaunt(obj, 'run', messageRoll)

                // Nearest map edge by Manhattan distance
                const pos = obj.position
                const edgeCandidates = [
                    { x: 0,                 y: pos.y },
                    { x: HEX_GRID_SIZE - 1, y: pos.y },
                    { x: pos.x,             y: 0 },
                    { x: pos.x,             y: HEX_GRID_SIZE - 1 },
                ]
                edgeCandidates.sort((a, b) => hexDistance(a, pos) - hexDistance(b, pos))
                const fleeTarget = edgeCandidates[0]

                const fleeCallback = () => {
                    obj.clearAnim()
                    if (hexDistance(obj.position, fleeTarget) <= 1) {
                        // Reached the edge — remove from active combat
                        obj.hostile = false
                        return that.nextTurn()
                    }
                    that.doAITurn(obj, idx, depth + 1)
                }

                if (!this.walkUpTo(obj, idx, fleeTarget, AP.getAvailableMoveAP(), fleeCallback)) {
                    // No path to edge — give up, drop out of combat
                    obj.hostile = false
                    return this.nextTurn()
                }
                return
            }
        }

        // ── TARGET SELECTION ─────────────────────────────────────────────────
        const target = this.findTargetForCritter(obj)
        if (!target) {
            combatDebug('AI has no target')
            return this.nextTurn()
        }
        let distance = hexDistance(obj.position, target.position)

        const objAny = obj as any

        // ── WEAPON CHOICE: respect bestWeapon preference ──────────────────────
        // Determine preferred weapon type; weapon switching below honours this.
        const preferRanged = aiPreferRanged(pkt, distance)
        const willAttack = pkt.bestWeapon !== 'never'

        var weaponObj = obj.equippedWeapon
        // ── NO INVENTORY WEAPON ───────────────────────────────────────────────────
        // Critters like Spore Plants carry no item weapon but may have a ranged
        // secondary attack encoded in their critter PRO (primary=punch, secondary=fire single).
        //
        // Critter.init() always assigns a synthetic Weapon(null) fist to leftHand and
        // rightHand (pro=null), so equippedWeapon is never null. The fist has no PRO
        // (weaponObj.pro === null), which distinguishes it from a real inventory weapon.
        if (!weaponObj || !weaponObj.pro) {
            const proExtra: any = (obj as any).pro?.extra
            const attackModes: number = proExtra?.attackMode ?? 0
            const secondaryMode = (attackModes >> 4) & 0xf  // e.g. 6 = fire single
            const naturalRange: number = proExtra?.maxRange2 ?? 1
            const hasNaturalRanged = (secondaryMode === 6 || secondaryMode === 7)
                                     && naturalRange > 1 && willAttack

            if (hasNaturalRanged && distance > 1) {
                if (distance > naturalRange) {
                    // Out of natural weapon range — can't move (handled by distance mode above)
                    combatDebug(`AI: out of natural weapon range (dist=${distance} range=${naturalRange})`)
                    return this.nextTurn()
                }
                // Synthesize a pseudo-WeaponObj from the critter's PRO ranged attack data.
                // Temporarily mount it on leftHand so equippedWeapon / attack() / getDamageDone()
                // all see a real weapon without giving the critter a permanent inventory item.
                const pseudoExtra = {
                    attackMode: secondaryMode | (secondaryMode << 4),
                    APCost1:   proExtra.APCost2  ?? 5,
                    APCost2:   proExtra.APCost2  ?? 5,
                    maxRange1: naturalRange,
                    maxRange2: naturalRange,
                    minDmg:    proExtra.minDmg   ?? 1,
                    maxDmg:    proExtra.maxDmg   ?? 6,
                    dmgType:   proExtra.dmgType  ?? 0,
                    projPID:   proExtra.projPID  ?? -1,
                    soundID:   proExtra.soundID,
                    maxAmmo:   0,   // no ammo limit — aiHaveAmmo returns true when maxAmmo=0
                    ammoPID:   -1,  // no ammo PRO — getAmmoStats returns neutral defaults
                }
                const pseudoWeaponObj: any = { art: obj.art, pro: { extra: pseudoExtra } }
                const naturalWeapon = new Weapon(pseudoWeaponObj)
                naturalWeapon.weaponSkillType = 'Unarmed'  // critters use Unarmed for natural attacks
                pseudoWeaponObj.weapon = naturalWeapon

                const savedHand   = objAny.leftHand
                const savedActive = objAny.activeHand
                objAny.leftHand   = pseudoWeaponObj
                objAny.activeHand = 'leftHand'

                const naturalAPCost = naturalWeapon.getAPCost(1)
                if (AP.getAvailableCombatAP() >= naturalAPCost) {
                    AP.subtractCombatAP(naturalAPCost)
                    this.attack(obj, target, 'torso', () => {
                        objAny.leftHand   = savedHand
                        objAny.activeHand = savedActive
                        obj.clearAnim()
                        that.doAITurn(obj, idx, depth + 1)
                    })
                } else {
                    objAny.leftHand   = savedHand
                    objAny.activeHand = savedActive
                    combatDebug(`AI: no AP for natural ranged attack (AP: ${AP.getAvailableCombatAP()}, cost: ${naturalAPCost})`)
                    return this.nextTurn()
                }
                return
            }

            // ── UNARMED (punch/kick at melee range or approaching) ────────────────
            const unarmedAPCost = 3
            combatDebug('unarmed AI:', obj.name, 'AP:', AP.getAvailableCombatAP(), 'distance:', distance)
            if (distance <= 1 && AP.getAvailableCombatAP() >= unarmedAPCost && willAttack) {
                AP.subtractCombatAP(unarmedAPCost)
                this.attack(obj, target, 'torso', () => { obj.clearAnim(); that.doAITurn(obj, idx, depth + 1) })
            } else if (distance > 1 && AP.getAvailableMoveAP() > 0) {
                const neighbors = hexNeighbors(target.position)
                const maxSteps = AP.getAvailableMoveAP()
                for (const nb of neighbors) {
                    if (obj.walkTo(nb, false, () => { obj.clearAnim(); that.doAITurn(obj, idx, depth + 1) }, maxSteps) !== false) {
                        if (AP.subtractMoveAP(obj.path.path.length - 1) === false) break
                        return
                    }
                }
                combatDebug(`AI: no path to target (unarmed): ${target?.name}`)
                return this.nextTurn()
            } else {
                combatDebug(`AI: no valid action (unarmed, AP: ${AP.getAvailableCombatAP()}, dist: ${distance})`)
                return this.nextTurn()
            }
            return
        }

        var weapon = weaponObj.weapon
        if (!weapon) throw Error('AI weapon has no weapon data')

        // ── WEAPON SWITCHING ──────────────────────────────────────────────────
        // Guard with weaponSwitchDone to prevent oscillation.
        if (!weaponSwitchDone) {
            const otherHand: 'leftHand' | 'rightHand' =
                (objAny.activeHand ?? 'leftHand') === 'leftHand' ? 'rightHand' : 'leftHand'
            const otherWeapon = objAny[otherHand]

            if (preferRanged && weapon.type === 'melee') {
                // Prefer ranged — try the other hand
                if (otherWeapon?.weapon && otherWeapon.weapon.type === 'gun' && aiHaveAmmo(otherWeapon)) {
                    const newHand = otherHand
                    obj.playWeaponSwapAnim(() => { objAny.activeHand = newHand }, () => {
                        obj.clearAnim()
                        that.doAITurn(obj, idx, depth + 1, true)
                    })
                    return
                }
            } else if (!preferRanged && weapon.type === 'gun') {
                // Prefer melee — try the other hand
                if (otherWeapon?.weapon && otherWeapon.weapon.type === 'melee' && otherWeapon.pro) {
                    const newHand = otherHand
                    obj.playWeaponSwapAnim(() => { objAny.activeHand = newHand }, () => {
                        obj.clearAnim()
                        that.doAITurn(obj, idx, depth + 1, true)
                    })
                    return
                }
            }
        }

        // Re-read weapon after potential swap
        weaponObj = obj.equippedWeapon
        if (!weaponObj) {
            combatDebug('AI: no weapon after swap check')
            return this.nextTurn()
        }
        weapon = weaponObj.weapon
        if (!weapon) throw Error('AI weapon has no weapon data after swap check')
        let fireDistance = weapon.getMaximumRange(1)
        combatDebug(`AI ${obj.art}: weapon=${weapon.name} fireRange=${fireDistance} dist=${distance} distMode=${pkt.distance}`)

        // ── PURSUIT RANGE CHECK ───────────────────────────────────────────────
        // maxDist gates movement/pursuit only. If the critter is already in weapon
        // range it attacks regardless; if it's stationary ('stay') it always attacks.
        // Only bail early when out of weapon range AND beyond pursuit range.
        if (pkt.distance !== 'stay' && distance > fireDistance && distance > pkt.maxDist) {
            combatDebug(`AI: target out of weapon and pursuit range (dist=${distance} fireRange=${fireDistance} maxDist=${pkt.maxDist}), ending turn`)
            return this.nextTurn()
        }

        // ── AMMO CHECK (before movement so we don't waste AP) ────────────────
        if (!aiHaveAmmo(weaponObj) && weapon.type !== 'melee') {
            const aiWeapAny = weaponObj as any
            const aiAmmoPID: number | undefined = aiWeapAny?.pro?.extra?.ammoPID
            const aiMaxAmmo: number = aiWeapAny?.pro?.extra?.maxAmmo ?? 0
            const aiInv = (obj as any).inventory as any[] | undefined
            const ammoItem = aiInv?.find((item: any) => item.pid === aiAmmoPID)
            if (ammoItem) {
                const available: number = ammoItem.amount ?? 1
                const toLoad = Math.min(aiMaxAmmo, available)
                aiWeapAny.pro.extra.rounds = toLoad
                ammoItem.amount = available - toLoad
                if (ammoItem.amount <= 0) {
                    const ammoIdx2 = aiInv!.indexOf(ammoItem)
                    if (ammoIdx2 !== -1) aiInv!.splice(ammoIdx2, 1)
                }
                combatDebug(`AI ${obj.name}: reloaded ${toLoad} rounds`)
                that.doAITurn(obj, idx, depth + 1, weaponSwitchDone)
                return
            }
            if (!weaponSwitchDone) {
                const otherHandA: 'leftHand' | 'rightHand' =
                    (objAny.activeHand ?? 'leftHand') === 'leftHand' ? 'rightHand' : 'leftHand'
                const otherWeaponA = objAny[otherHandA]
                if (otherWeaponA?.weapon && aiHaveAmmo(otherWeaponA)) {
                    obj.playWeaponSwapAnim(
                        () => { objAny.activeHand = otherHandA },
                        () => { obj.clearAnim(); that.doAITurn(obj, idx, depth + 1, true) }
                    )
                    return
                }
            }
            combatDebug(`AI ${obj.name}: out of ammo, ending turn`)
            return this.nextTurn()
        }

        // ── MOVEMENT STANCE ───────────────────────────────────────────────────
        const distMode = pkt.distance

        if (distMode === 'stay') {
            // Never move; fall through to attack section

        } else if (distMode === 'charge') {
            // Always close to melee range (1 hex)
            if (distance > 1) {
                this.log('[AI CHARGES]')
                this.maybeTaunt(obj, 'move', messageRoll)
                const neighbors = hexNeighbors(target.position)
                const maxMove = AP.getAvailableMoveAP()
                let charged = false
                for (const nb of neighbors) {
                    if (obj.walkTo(nb, false, () => { obj.clearAnim(); that.doAITurn(obj, idx, depth + 1) }, maxMove) !== false) {
                        if (AP.subtractMoveAP(obj.path.path.length - 1) === false) break
                        charged = true
                        break
                    }
                }
                if (!charged) { this.log('[NO PATH]'); return this.nextTurn() }
                return
            }

        } else if (distMode === 'snipe') {
            const backAwayThreshold = Math.max(2, Math.floor(fireDistance / 3))
            if (distance > fireDistance) {
                // Close to fire range (normal creep)
                this.log('[AI CREEPS (snipe)]')
                this.maybeTaunt(obj, 'move', messageRoll)
                const neighbors = hexNeighbors(target.position)
                const maxMove = Math.min(AP.getAvailableMoveAP(), distance - fireDistance)
                let crept = false
                for (const nb of neighbors) {
                    if (obj.walkTo(nb, false, () => { obj.clearAnim(); that.doAITurn(obj, idx, depth + 1) }, maxMove) !== false) {
                        if (AP.subtractMoveAP(obj.path.path.length - 1) === false) break
                        crept = true; break
                    }
                }
                if (!crept) { this.log('[NO PATH]'); return this.nextTurn() }
                return
            } else if (distance < backAwayThreshold) {
                // Back away — find a neighbour that is farther from target
                this.log('[AI BACKS AWAY (snipe)]')
                const myNeighbors = hexNeighbors(obj.position)
                const farNeighbors = myNeighbors
                    .map(nb => ({ pos: nb, d: hexDistance(nb, target.position) }))
                    .filter(n => n.d > distance)
                    .sort((a, b) => b.d - a.d)
                let backedAway = false
                for (const nb of farNeighbors) {
                    if (obj.walkTo(nb.pos, false, () => { obj.clearAnim(); that.doAITurn(obj, idx, depth + 1) }, 1) !== false) {
                        if (AP.subtractMoveAP(1) === false) break
                        backedAway = true; break
                    }
                }
                if (backedAway) return
                // Can't back away — fall through and attack anyway
            }
            // else: in ideal snipe range — fall through to attack

        } else if (distMode === 'random') {
            // Each turn randomly choose to charge to melee range or stay put
            if (Math.random() < 0.5 && distance > 1) {
                this.log('[AI CHARGES (random)]')
                const neighbors = hexNeighbors(target.position)
                const maxMove = AP.getAvailableMoveAP()
                for (const nb of neighbors) {
                    if (obj.walkTo(nb, false, () => { obj.clearAnim(); that.doAITurn(obj, idx, depth + 1) }, maxMove) !== false) {
                        if (AP.subtractMoveAP(obj.path.path.length - 1) === false) break
                        return
                    }
                }
            }
            // fall through to attack

        } else {
            // 'on_your_own' — existing behaviour: close to fire range
            if (distance > fireDistance) {
                this.log('[AI CREEPS]')
                this.maybeTaunt(obj, 'move', messageRoll)
                const neighbors = hexNeighbors(target.position)
                const maxMove = Math.min(AP.getAvailableMoveAP(), distance - fireDistance)
                let didCreep = false
                for (let i = 0; i < neighbors.length; i++) {
                    if (obj.walkTo(neighbors[i], false, () => { obj.clearAnim(); that.doAITurn(obj, idx, depth + 1) }, maxMove) !== false) {
                        didCreep = true
                        if (AP.subtractMoveAP(obj.path.path.length - 1) === false)
                            throw `AP subtraction issue: has ${AP.getAvailableMoveAP()} needs ${obj.path.path.length}`
                        break
                    }
                }
                if (!didCreep) { this.log('[NO PATH]'); return this.nextTurn() }
                return
            }
        }

        // ── ATTACK ────────────────────────────────────────────────────────────
        if (!willAttack) {
            combatDebug(`AI: bestWeapon=never, skipping attack`)
            return this.nextTurn()
        }

        if (AP.getAvailableCombatAP() >= weapon.getAPCost(1)) {
            // HIT CHANCE FLOOR — skip attack if we can't reliably hit
            const hitChance = this.getHitChance(obj, target, 'torso').hit
            if (hitChance < pkt.minToHit) {
                combatDebug(`AI: hitChance ${hitChance}% < minToHit ${pkt.minToHit}%, skipping attack`)
                return this.nextTurn()
            }

            this.log('[ATTACKING]')
            this.maybeTaunt(obj, 'attack', messageRoll)

            if (obj.equippedWeapon === null) throw 'combatant has no equipped weapon'

            // ── BURST GATING based on areaAttackMode ─────────────────────────
            const burstAPCost = weapon.getAPCost(2)
            const secondaryMode: any = (weapon as any).attackTwo?.mode
            const canBurst = (secondaryMode === 'fire burst' || secondaryMode === 7) &&
                             AP.getAvailableCombatAP() >= burstAPCost
            let useBurst = false
            if (canBurst) {
                const burstRange = weapon.getMaximumRange(2)
                const targetsInBurstRange = this.combatants.filter(
                    c => c !== obj && !c.dead && hexDistance(obj.position, c.position) <= burstRange
                ).length
                if (targetsInBurstRange >= 2) {
                    useBurst = this.canUseBurst(obj, target, pkt.areaAttackMode)
                }
            }

            if (useBurst) {
                AP.subtractCombatAP(burstAPCost)
                const prevMode = weapon!.mode
                weapon!.mode = 'burst'
                this.attack(obj, target, 'torso', () => {
                    weapon!.mode = prevMode
                    obj.clearAnim()
                    that.doAITurn(obj, idx, depth + 1)
                })
            } else {
                const singleAPCost = weapon.getAPCost(1)
                AP.subtractCombatAP(singleAPCost)
                this.attack(obj, target, 'torso', () => {
                    obj.clearAnim()
                    that.doAITurn(obj, idx, depth + 1)
                })
            }
        } else {
            combatDebug(`AI: no AP to attack (target: ${target?.name}, AP: ${AP.getAvailableCombatAP()}, cost: ${weapon?.getAPCost(1)})`)
            this.nextTurn()
        }
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
        }
        combatDebug(`start: triggerTeams=[${[...triggerTeams].join(',')}]`)
        globalState.combat = new Combat(globalState.gMap.getObjects(), triggerTeams)

        if (forceTurn) globalState.combat.forceTurn(forceTurn)

        globalState.combat.nextTurn()
        globalState.gMap.updateMap()
    }

    end() {
        // Check number of active combatants to see if we can end
        var numActive = 0
        for (var i = 0; i < this.combatants.length; i++) {
            var obj = this.combatants[i]
            if (obj.dead || obj.isPlayer) continue
            if (!obj.ai || !obj.ai.info) {
                combatWarn(`Critter ${obj.name || obj.art} has no AI info, skipping range check`)
                continue
            }
            var inRange = hexDistance(obj.position, this.player.position) <= obj.ai.info.max_dist

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

        combatDebug('end combat')
        globalState.combat = null // todo: invert control
        globalState.inCombat = false
        combatActive = false

        globalState.audioEngine.playActionSfx('combat_end')
        globalState.gMap.updateMap()
        uiEndCombat()
    }

    forceEnd() {
        console.warn(`[forceEnd] stack: ${new Error().stack?.split('\n').slice(1, 4).join(' | ')}`)
        for (const combatant of this.combatants) {
            combatant.hostile = false
            combatant.outline = null
        }
        combatDebug('end combat (forced by script)')
        globalState.combat = null
        globalState.inCombat = false
        globalState.audioEngine.playActionSfx('combat_end')
        globalState.gMap?.updateMap()
        uiEndCombat()
        combatActive = false
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
     * Simple line-of-sight check (FO2: _combat_update_critters_in_los).
     * Returns false when any wall-type object lies on the interior hex-line between `from` and `to`.
     */
    hasLineOfSight(from: Point, to: Point): boolean {
        if (!globalState.gMap) return true
        const line = hexLine(from, to) ?? []
        if (line.length <= 2) return true // adjacent — always visible
        const interior = line.slice(1, -1)
        const mapObjects = globalState.gMap.getObjects()
        for (const pos of interior) {
            for (const o of mapObjects) {
                if ((o as any).type === 'wall' &&
                    (o as any).position?.x === pos.x &&
                    (o as any).position?.y === pos.y) {
                    return false
                }
            }
        }
        return true
    }

    nextTurn(): void {
        // update range checks
        var numActive = 0
        for (var i = 0; i < this.combatants.length; i++) {
            var obj = this.combatants[i]
            if (obj.dead || obj.isPlayer) continue
            if (!obj.ai || !obj.ai.info) {
                combatWarn(`Critter ${obj.name || obj.art} has no AI info, skipping range check`)
                continue
            }
            var inRange = hexDistance(obj.position, this.player.position) <= obj.ai.info.max_dist
            var hasLOS = inRange && this.hasLineOfSight(obj.position, this.player.position)

            if (hasLOS || obj.hostile) {
                // Only aggro via LOS if an attack has already been made this
                // combat session, or the critter was already flagged hostile
                // before combat started. Entering combat mode alone (weapon drawn,
                // movement AP spent) must not flip bystanders to hostile.
                if (this.hasAttacked || obj.hostile) {
                    obj.hostile = true
                    obj.outline = obj.teamNum !== globalState.player.teamNum ? 'red' : 'green'
                    numActive++
                }
            }
        }

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
                prev.bonusAC = prev.AP.getAvailableMoveAP()
            }
        }

        if (this.combatants[this.whoseTurn].isPlayer) {
            // player turn — reset bonus AC from last turn, then reset AP
            this.playerHadTurn = true
            this.player.bonusAC = 0
            this.inPlayerTurn = true
            this.player.AP!.resetAP()
            drawAP(this.player.AP!.getAvailableMoveAP(), this.player.AP!.getTotalMaxAP())
            drawHP(this.player.getStat('HP'))
        } else {
            this.inPlayerTurn = false
            drawAP(0, this.player.AP!.getTotalMaxAP(), 0, false)
            var critter = this.combatants[this.whoseTurn]
            if (critter.dead === true || critter.hostile !== true) return this.nextTurn()

            // Fire DoT: apply at the start of each critter's turn
            if (critter.onFireTurns > 0) {
                critter.onFireTurns--
                const fireDmg = getRandomInt(3, 6)
                uiLog(`${critter.name} burns for ${fireDmg} damage.`)
                combatDebug(`fire DoT: ${critter.name} took ${fireDmg} (${critter.onFireTurns} turns left)`)
                critterDamage(critter, fireDmg, critter, false, false, 'Fire')
                if (critter.dead) return this.nextTurn() // fire killed them; skip to next
            }

            // Knockdown / loseNextTurn: skip this critter's turn and count down
            if (critter.skipTurns > 0) {
                critter.skipTurns--
                if (critter.skipTurns === 0) {
                    critter.isKnockedDown = false // clear flag now that they're getting up
                    if (critter.hasAnimation('getUpFront')) {
                        critter.staticAnimation('getUpFront', () => critter.clearAnim())
                    }
                }
                return this.nextTurn()
            }

            critter.bonusAC = 0 // reset bonus AC at start of this critter's turn
            critter.AP!.resetAP()
            this.doAITurn(critter, this.whoseTurn, 1)
        }
    }
}
