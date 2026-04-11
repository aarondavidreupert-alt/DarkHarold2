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
import { critterDamage, critterKill } from './critter.js'
import * as GameTime from './gametime.js'
import { hexDirectionTo, hexDistance, hexInDirectionDistance, hexLine, hexNearestNeighbor, hexNeighbors, Point } from './geometry.js'
import globalState from './globalState.js'
import { Critter, Obj } from './object.js'
import { Player } from './player.js'
import { loadPRO } from './pro.js'
import { Scripting } from './scripting.js'
import { drawAP, drawHP, uiDrawWeapon, uiEndCombat, uiLog, uiStartCombat } from './ui.js'
import { getFileText, getMessage, getRandomInt, parseIni, rollSkillCheck } from './util.js'

// Turn-based combat system

export class ActionPoints {
    combat: number = 0 // Combat AP
    move: number = 0 // Move AP
    attachedCritter: Critter

    constructor(obj: Critter) {
        this.attachedCritter = obj
        this.resetAP()
    }

    resetAP() {
        var AP = this.getMaxAP()
        this.combat = AP.combat
        this.move = AP.move
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
        // Bonus Move: +2 move AP per rank
        if (this.attachedCritter.hasPerk('Bonus Move')) bonus += 2
        return bonus
    }

    getMaxAP(): { combat: number; move: number } {
        return {
            combat: 5 + Math.floor(this.attachedCritter.getStat('AGI') / 2) + this.getBonusCombatAP(),
            move: this.getBonusMoveAP(),
        }
    }

    getAvailableMoveAP(): number {
        return this.combat + this.move
    }

    getAvailableCombatAP() {
        return this.combat
    }

    subtractMoveAP(value: number): boolean {
        // Crippled legs increase the AP cost of movement (FO2 reference: 4× one leg, 8× both legs)
        const critter = this.attachedCritter
        if (critter.crippledLeftLeg && critter.crippledRightLeg) value *= 8
        else if (critter.crippledLeftLeg || critter.crippledRightLeg) value *= 4

        if (this.getAvailableMoveAP() < value) return false

        this.move -= value
        if (this.move < 0) {
            if (this.subtractCombatAP(-this.move)) {
                this.move = 0
                return true
            }
            return false
        }

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

// Returns true when the weapon can be fired (melee/unarmed always ok; ranged ok if rounds > 0)
function aiHaveAmmo(weaponObj: Obj | null): boolean {
    if (!weaponObj) return true // unarmed — always valid
    const maxAmmo: number = (weaponObj as any)?.pro?.extra?.maxAmmo ?? 0
    if (maxAmmo === 0) return true // melee/unarmed — no ammo needed
    return ((weaponObj as any)?.pro?.extra?.rounds ?? 0) > 0
}

// A combat encounter
export class Combat {
    combatants: Critter[]
    playerIdx: number
    player: Player
    turnNum: number
    whoseTurn: number
    inPlayerTurn: boolean

    constructor(objects: Obj[]) {
        // Gather a list of combatants (critters meeting a certain criteria)
        this.combatants = objects.filter((obj) => {
            if (obj instanceof Critter) {
                if (obj.dead || !obj.visible) return false

                // TODO: should we initialize AI elsewhere, like in Critter?
                if (!obj.isPlayer && !obj.ai) obj.ai = new AI(obj)

                if (obj.stats === undefined) throw 'no stats'
                obj.dead = false
                obj.AP = new ActionPoints(obj)
                return true
            }

            return false
        }) as Critter[]

        this.playerIdx = this.combatants.findIndex((x) => x.isPlayer)
        if (this.playerIdx === -1) throw "combat: couldn't find player?"

        this.player = this.combatants[this.playerIdx] as Player
        this.turnNum = 1
        this.whoseTurn = this.playerIdx - 1
        this.inPlayerTurn = true

        // Stop the player from walking combat is initiating
        this.player.clearAnim()

        uiStartCombat()
    }

    log(msg: any) {
        // Combat-related debug log
        console.log(msg)
    }

    /** Load ammo stats for a loaded weapon. Returns defaults (X=2,Y=1,RM=0,ACmod=0) if no ammo. */
    getAmmoStats(weaponObj: Obj): { X: number; Y: number; RM: number; ACmod: number } {
        const defaults = { X: 2, Y: 1, RM: 0, ACmod: 0 }
        const ammoPID: number | undefined = (weaponObj as any).pro?.extra?.ammoPID
        if (ammoPID === undefined || ammoPID < 0) return defaults

        const ammoPro = loadPRO(ammoPID, ammoPID & 0xffff)
        if (!ammoPro || !ammoPro.extra) return defaults

        return {
            X: ammoPro.extra.damMult ?? 2,
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
        let count = 0
        for (const hex of interior) {
            for (const o of globalState.gMap.getObjects()) {
                if (
                    o instanceof Critter &&
                    !o.dead &&
                    o !== obj &&
                    o !== target &&
                    o.position.x === hex.x &&
                    o.position.y === hex.y
                ) {
                    count++
                }
            }
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
            if (obj.isPlayer === true) tempPER -= 2 // supposedly player gets nerfed like this. WTF?
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
        // TODO: visibility (= light conditions) and distance
        var weaponObj = obj.equippedWeapon
        if (weaponObj === null)
            // no weapon equipped (not even melee)
            return { hit: -1, crit: -1 }

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

        // Crippled-limb penalties for the attacker (FO2: -40 per arm, halved here per arm for simplicity)
        var crippledArmPenalty = 0
        if (obj.crippledLeftArm) crippledArmPenalty += 20
        if (obj.crippledRightArm) crippledArmPenalty += 20

        // Blinded attacker: additional -25 flat penalty on top of the 12× distance modifier wired above
        var blindPenalty = obj.isBlinded ? 25 : 0

        var hitChance = weaponSkill - AC - CriticalEffects.regionHitChanceDecTable[region] - hitDistanceModifier - partialCoverPenalty - crippledArmPenalty - blindPenalty
        var critChance = baseCrit + CriticalEffects.regionHitChanceDecTable[region]

        if (isNaN(hitChance)) throw 'something went wrong with hit chance calculation'

        // 1 in 20 chance of failing needs to be preserved
        hitChance = Math.min(95, hitChance)

        return { hit: hitChance, crit: critChance }
    }

    rollHit(obj: Critter, target: Critter, region: string, hitBonus: number = 0): any {
        var critModifer = obj.getStat('Better Criticals')
        var hitChance = this.getHitChance(obj, target, region)
        hitChance = { ...hitChance, hit: hitChance.hit + hitBonus }

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
                this.log('crit level: ' + critLevel)
                var crit = CriticalEffects.getCritical(target.killType ?? 0, region, critLevel)
                var critStatus = crit.doEffectsOn(target)

                return { hit: true, crit: true, DM: critStatus.DM, msgID: critStatus.msgID } // crit
            }

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

        return { hit: false, crit: isCrit } // miss
    }

    getDamageDone(obj: Critter, target: Critter, critModifer: number) {
        var weapon = obj.equippedWeapon
        if (!weapon) throw Error('getDamageDone: No weapon')
        var wep = weapon.weapon
        if (!wep) throw Error('getDamageDone: Weapon has no weapon data')
        var damageType = wep.getDamageType()

        var RD = getRandomInt(wep.minDmg, wep.maxDmg) // rand damage min..max
        var RB = 0 // ranged bonus (via perk)
        var CM = critModifer // critical hit damage multiplier
        var ADR = target.getStat('DR ' + damageType) + target.getArmorDR(damageType) // damage resistance (base + armor)
        var ADT = target.getStat('DT ' + damageType) + target.getArmorDT(damageType) // damage threshold (base + armor)

        // Bypass Armor critical effect: reduce DR/DT to 20% for this hit (FO2 reference), then consume the flag
        if (target.bypassArmorNextHit) {
            ADR = Math.floor(ADR * 0.2)
            ADT = Math.floor(ADT * 0.2)
            target.bypassArmorNextHit = false
        }

        var ammoStats = this.getAmmoStats(weapon)
        var X = ammoStats.X // ammo damage multiplier (from ammo PRO damMult)
        var Y = ammoStats.Y // ammo damage divisor (from ammo PRO damDiv)
        var RM = ammoStats.RM // ammo DR modifier (from ammo PRO "DR modifier")
        var CD = Config.combat.difficultyModifier // combat difficulty: easy=75, normal=100, hard=125

        var ammoDamageMult = X / Y

        var baseDamage = (CM / 2) * ammoDamageMult * (RD + RB) * (CD / 100)
        var adjustedDamage = Math.max(0, baseDamage - ADT)
        console.log(
            `RD: ${RD} | CM: ${CM} | ADR: ${ADR} | ADT: ${ADT} | Base Dmg: ${baseDamage} Adj Dmg: ${adjustedDamage} | Type: ${damageType}`
        )

        return Math.ceil(adjustedDamage * (1 - (ADR + RM) / 100))
    }

    getCombatMsg(id: number) {
        return getMessage('combat', id)
    }

    attack(obj: Critter, target: Critter, region = 'torso', callback?: () => void) {
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

        // Play attack sound
        if (soundIdChar) {
            audio.playWeaponSfx(soundIdChar, 'attack')
        }

        var targetName = target.isPlayer ? 'you' : target.name
        var weapon = weaponObj?.weapon
        var attackDmgType = weaponObj?.weapon?.getDamageType() ?? 'Normal'

        // ── BURST MODE ────────────────────────────────────────────────────────
        if (weapon && weapon.isBurst && weapon.isBurst()) {
            const burstCount: number = (weaponObj as any)?.pro?.extra?.burstCount ?? 10
            console.log(`[burst] burstCount=${burstCount} weapon=${weapon.name}`)

            let hits = 0
            let totalDamage = 0
            for (let b = 0; b < burstCount; b++) {
                const bRoll = this.rollHit(obj, target, region, -20) // burst penalty
                if (bRoll.hit) {
                    hits++
                    totalDamage += this.getDamageDone(obj, target, bRoll.crit ? bRoll.DM : 2)
                }
            }

            uiLog(`${who} burst-fired at ${targetName}: ${hits}/${burstCount} hit for ${totalDamage} damage`)

            if (hits > 0) {
                if (soundIdChar) audio.playWeaponSfx(soundIdChar, 'impact')
                else audio.playActionSfx('hit_flesh')
                critterDamage(target, totalDamage, obj, true, true, attackDmgType)
                if (target.isPlayer) drawHP(target.getStat('HP'))
                if (target.dead) this.perish(target, obj, attackDmgType)
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
        var hitRoll = this.rollHit(obj, target, region)
        this.log('hit% is ' + this.getHitChance(obj, target, region).hit)

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

            if (target.dead) this.perish(target, obj, attackDmgType)
        } else {
            audio.playActionSfx('miss')
            uiLog(who + ' missed ' + targetName + (hitRoll.crit === true ? ' critically' : ''))

            // Play a dodge/flinch on the target if they aren't already animating
            if (!target.dead && !target.inAnim() && target.hasAnimation('dodge')) {
                target.staticAnimation('dodge', () => target.clearAnim())
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

                uiLog(who + ' critically failed! (level ' + critFailLevel + ')')

                // TODO: map weapon type to crit fail table types
                var critFailEffect = CriticalEffects.criticalFailTable.unarmed[critFailLevel]
                CriticalEffects.temporaryDoCritFail(critFailEffect, obj)
            }
        }
    }

    attackBurst(obj: Critter, target: Critter, callback?: () => void) {
        // Face the target
        const hex = hexNearestNeighbor(obj.position, target.position)
        if (hex !== null) obj.orientation = hex.direction

        // Play attack animation
        obj.staticAnimation('attack', callback)

        const weaponObj = obj.equippedWeapon
        const weapon = weaponObj?.weapon
        const attackDmgType = weaponObj?.weapon?.getDamageType() ?? 'Normal'

        // Consume ammo: min(burstRounds, currentRounds)
        const burstRounds: number = (weaponObj as any)?.pro?.extra?.burstRounds ?? 6
        const currentRounds: number = (weaponObj as any)?.pro?.extra?.rounds ?? burstRounds
        const consumed = Math.min(burstRounds, currentRounds)
        if (weaponObj && (weaponObj as any).pro?.extra) {
            ;(weaponObj as any).pro.extra.rounds = Math.max(0, currentRounds - consumed)
        }

        // Play weapon sound
        const rawSoundID = (weaponObj as any)?.pro?.extra?.soundID
        const soundIdChar = typeof rawSoundID === 'number' ? String.fromCharCode(rawSoundID) : null
        if (soundIdChar) globalState.audioEngine.playWeaponSfx(soundIdChar, 'attack')

        // Build burst cone: hexLine from obj toward a point 2 steps beyond target in same direction
        const dir = hexDirectionTo(obj.position, target.position)
        const coneEnd = hexInDirectionDistance(target.position, dir, 2)
        const line = hexLine(obj.position, coneEnd) ?? []

        // Gather all living critters on the line (excluding the attacker)
        const mapObjects = globalState.gMap?.getObjects() ?? []
        const hit: Critter[] = []
        for (const pos of line) {
            for (const o of mapObjects) {
                if (o instanceof Critter && !o.dead && o !== obj) {
                    if (o.position.x === pos.x && o.position.y === pos.y) {
                        if (!hit.includes(o)) hit.push(o)
                    }
                }
            }
        }

        const who = obj.isPlayer ? 'You' : obj.name
        for (const victim of hit) {
            const victimName = victim.isPlayer ? 'you' : victim.name
            // Burst fire: -20 hit chance penalty
            const hitRoll = this.rollHit(obj, victim, 'torso', -20)
            if (hitRoll.hit) {
                const critMod = hitRoll.crit ? hitRoll.DM : 2
                const damage = this.getDamageDone(obj, victim, critMod)
                uiLog(`${who} burst-hit ${victimName} for ${damage} damage`)
                if (soundIdChar) globalState.audioEngine.playWeaponSfx(soundIdChar, 'impact')
                else globalState.audioEngine.playActionSfx('hit_flesh')
                critterDamage(victim, damage, obj, true, true, attackDmgType)
                if (victim.isPlayer) drawHP(victim.getStat('HP'))
                if (victim.dead) this.perish(victim, obj, attackDmgType)
            } else {
                uiLog(`${who} burst-missed ${victimName}`)
            }
        }
    }

    perish(obj: Critter, attacker?: Critter, damageType?: string) {
        uiLog('...And killed them.')
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
        // TODO: find target according to AI rules
        // Find the closest living combatant on a different team

        const targets = this.combatants.filter((x) => !x.dead && x.teamNum !== obj.teamNum)
        if (targets.length === 0) return null
        targets.sort((a, b) => hexDistance(obj.position, a.position) - hexDistance(obj.position, b.position))
        return targets[0]
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

    doAITurn(obj: Critter, idx: number, depth: number, weaponSwitchDone = false): void {
        if (depth > Config.combat.maxAIDepth) {
            console.warn(`Bailing out of ${depth}-deep AI turn recursion`)
            return this.nextTurn()
        }

        var that = this
        var target = this.findTarget(obj)
        if (!target) {
            console.log('[AI has no target]')
            return this.nextTurn()
        }
        var distance = hexDistance(obj.position, target.position)
        var AP = obj.AP!
        var messageRoll = rollSkillCheck(obj.ai!.info.chance || 85, 0, false)

        if (Config.engine.doLoadScripts === true && obj._script !== undefined) {
            // notify the critter script of a combat event
            if (Scripting.combatEvent(obj, 'turnBegin') === true) return // end of combat (script override)
        }

        if (AP.getAvailableMoveAP() <= 0)
            // out of AP
            return this.nextTurn()

        // behaviors

        if (obj.getStat('HP') <= obj.ai!.info.min_hp) {
            // hp <= min fleeing hp, so flee
            this.log('[AI FLEES]')

            // todo: pick the closest edge of the map
            this.maybeTaunt(obj, 'run', messageRoll)
            const targetPos = { x: 128, y: obj.position.y } // left edge
            const callback = () => {
                obj.clearAnim()
                that.doAITurn(obj, idx, depth + 1) // if we can, do another turn
            }

            if (!this.walkUpTo(obj, idx, targetPos, AP.getAvailableMoveAP(), callback)) {
                return this.nextTurn() // not a valid path, just move on
            }

            return
        }

        var weaponObj = obj.equippedWeapon
        if (!weaponObj) throw Error('AI has no weapon')
        var weapon = weaponObj.weapon
        if (!weapon) throw Error('AI weapon has no weapon data')

        // AI weapon switching: check if current weapon range is appropriate for distance.
        // Guard with weaponSwitchDone so we never oscillate between hands more than once per turn.
        var objAny = obj as any
        var fireDistance = weapon.getMaximumRange(1)
        if (!weaponSwitchDone && distance > fireDistance && weapon.type === 'melee') {
            // Melee weapon but target is far — switch to ranged if it has ammo
            var otherHand: 'leftHand' | 'rightHand' = (objAny.activeHand ?? 'leftHand') === 'leftHand' ? 'rightHand' : 'leftHand'
            var otherWeapon = objAny[otherHand]
            if (otherWeapon?.weapon && otherWeapon.weapon.type === 'gun' && aiHaveAmmo(otherWeapon)) {
                var newHand = otherHand
                obj.playWeaponSwapAnim(() => { objAny.activeHand = newHand }, () => {
                    obj.clearAnim()
                    that.doAITurn(obj, idx, depth + 1, true)
                })
                return
            }
        } else if (!weaponSwitchDone && distance <= 1 && weapon.type === 'gun') {
            // Ranged weapon but adjacent — switch to melee
            var otherHand2: 'leftHand' | 'rightHand' = (objAny.activeHand ?? 'leftHand') === 'leftHand' ? 'rightHand' : 'leftHand'
            var otherWeapon2 = objAny[otherHand2]
            if (otherWeapon2?.weapon && otherWeapon2.weapon.type === 'melee') {
                var newHand2 = otherHand2
                obj.playWeaponSwapAnim(() => { objAny.activeHand = newHand2 }, () => {
                    obj.clearAnim()
                    that.doAITurn(obj, idx, depth + 1, true)
                })
                return
            }
        }

        // Re-read weapon after potential swap
        weaponObj = obj.equippedWeapon
        if (!weaponObj) throw Error('AI has no weapon after swap check')
        weapon = weaponObj.weapon
        if (!weapon) throw Error('AI weapon has no weapon data after swap check')
        fireDistance = weapon.getMaximumRange(1)
        this.log(
            'DEBUG: weapon: ' +
                weapon +
                ' fireDistance: ' +
                fireDistance +
                ' obj: ' +
                obj.art +
                ' distance: ' +
                distance
        )

        // are we in firing distance?
        if (distance > fireDistance) {
            this.log('[AI CREEPS]')
            var neighbors = hexNeighbors(target.position)
            var maxDistance = Math.min(AP.getAvailableMoveAP(), distance - fireDistance)
            this.maybeTaunt(obj, 'move', messageRoll)

            // TODO: check nearest direction first
            var didCreep = false
            for (var i = 0; i < neighbors.length; i++) {
                if (
                    obj.walkTo(
                        neighbors[i],
                        false,
                        function () {
                            obj.clearAnim()
                            that.doAITurn(obj, idx, depth + 1) // if we can, do another turn
                        },
                        maxDistance
                    ) !== false
                ) {
                    // OK
                    didCreep = true
                    if (AP.subtractMoveAP(obj.path.path.length - 1) === false)
                        throw (
                            'subtraction issue: has AP: ' +
                            AP.getAvailableMoveAP() +
                            ' needs AP:' +
                            obj.path.path.length +
                            ' and maxDist was:' +
                            maxDistance
                        )
                    break
                }
            }

            if (!didCreep) {
                // no path — end this AI's turn rather than recursing infinitely
                this.log('[NO PATH]')
                return this.nextTurn()
            }
        } else if (AP.getAvailableCombatAP() >= 4) {
            // if we are in range, do we have enough AP to attack?

            // ── AI AMMO CHECK ────────────────────────────────────────────────────
            if (!aiHaveAmmo(weaponObj)) {
                const aiWeapAny = weaponObj as any
                const aiAmmoPID: number | undefined = aiWeapAny?.pro?.extra?.ammoPID
                const aiMaxAmmo: number = aiWeapAny?.pro?.extra?.maxAmmo ?? 0
                const aiInv = (obj as any).inventory as any[] | undefined
                const ammoItem = aiInv?.find((item: any) => item.pid === aiAmmoPID)
                if (ammoItem) {
                    // Reload from own inventory and continue turn
                    const available: number = ammoItem.amount ?? 1
                    const toLoad = Math.min(aiMaxAmmo, available)
                    aiWeapAny.pro.extra.rounds = toLoad
                    ammoItem.amount = available - toLoad
                    if (ammoItem.amount <= 0) {
                        const ammoIdx2 = aiInv!.indexOf(ammoItem)
                        if (ammoIdx2 !== -1) aiInv!.splice(ammoIdx2, 1)
                    }
                    console.log(`[AI] ${obj.name}: reloaded ${toLoad} rounds`)
                    that.doAITurn(obj, idx, depth + 1, weaponSwitchDone)
                    return
                }
                // No matching ammo — try the other hand (only once per turn)
                if (!weaponSwitchDone) {
                    const objAnyA = obj as any
                    const otherHandA: 'leftHand' | 'rightHand' =
                        (objAnyA.activeHand ?? 'leftHand') === 'leftHand' ? 'rightHand' : 'leftHand'
                    const otherWeaponA = objAnyA[otherHandA]
                    if (otherWeaponA?.weapon && aiHaveAmmo(otherWeaponA)) {
                        obj.playWeaponSwapAnim(
                            () => { objAnyA.activeHand = otherHandA },
                            () => { obj.clearAnim(); that.doAITurn(obj, idx, depth + 1, true) }
                        )
                        return
                    }
                }
                console.log(`[AI] ${obj.name}: weapon empty, falling back to unarmed`)
                return this.nextTurn()
            }
            // ─────────────────────────────────────────────────────────────────────

            this.log('[ATTACKING]')
            this.maybeTaunt(obj, 'attack', messageRoll)

            if (obj.equippedWeapon === null) throw 'combatant has no equipped weapon'

            // Prefer burst fire if: weapon has burst mode, ≥2 enemies in burst range, and enough AP
            const burstAPCost = weapon.getAPCost(2)
            const hasBurstMode = weapon.isBurst !== undefined && weapon.isBurst()
            const burstRange = weapon.getMaximumRange(2)
            const targetsInBurstRange = this.combatants.filter(
                (c) => c !== obj && !c.dead && hexDistance(obj.position, c.position) <= burstRange
            ).length

            const useBurst =
                !hasBurstMode && // weapon hasn't been switched to burst mode by AI yet
                String((weapon as any).attackTwo?.mode) === 'fire burst' &&
                AP.getAvailableCombatAP() >= burstAPCost &&
                targetsInBurstRange >= 2

            if (useBurst) {
                AP.subtractCombatAP(burstAPCost)
                // Temporarily set mode to 'burst' so attack() detects it, then restore
                const prevMode = weapon!.mode
                weapon!.mode = 'burst'
                this.attack(obj, target, 'torso', function () {
                    weapon!.mode = prevMode
                    obj.clearAnim()
                    that.doAITurn(obj, idx, depth + 1)
                })
            } else {
                AP.subtractCombatAP(4)
                this.attack(obj, target, 'torso', function () {
                    obj.clearAnim()
                    that.doAITurn(obj, idx, depth + 1) // if we can, do another turn
                })
            }
        } else {
            console.log('[AI IS STUMPED]')
            this.nextTurn()
        }
    }

    static start(forceTurn?: Critter): void {
        // begin combat
        globalState.inCombat = true
        globalState.combat = new Combat(globalState.gMap.getObjects())

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
                console.warn(`[COMBAT] Critter ${obj.name || obj.art} has no AI info, skipping range check`)
                continue
            }
            var inRange = hexDistance(obj.position, this.player.position) <= obj.ai.info.max_dist

            if (inRange || obj.hostile) {
                numActive++
            }
        }

        if (numActive > 0) return

        // Set all combatants to non-hostile and remove their outline
        for (const combatant of this.combatants) {
            combatant.hostile = false
            combatant.outline = null
        }

        console.log('[end combat]')
        globalState.combat = null // todo: invert control
        globalState.inCombat = false

        globalState.gMap.updateMap()
        uiEndCombat()
    }

    forceTurn(obj: Critter) {
        if (obj.isPlayer) this.whoseTurn = this.playerIdx - 1
        else {
            var idx = this.combatants.indexOf(obj)
            if (idx === -1) throw "forceTurn: no combatant '" + obj.name + ''

            this.whoseTurn = idx - 1
        }
    }

    nextTurn(): void {
        // update range checks
        var numActive = 0
        for (var i = 0; i < this.combatants.length; i++) {
            var obj = this.combatants[i]
            if (obj.dead || obj.isPlayer) continue
            if (!obj.ai || !obj.ai.info) {
                console.warn(`[COMBAT] Critter ${obj.name || obj.art} has no AI info, skipping range check`)
                continue
            }
            var inRange = hexDistance(obj.position, this.player.position) <= obj.ai.info.max_dist

            if (inRange || obj.hostile) {
                obj.hostile = true
                obj.outline = obj.teamNum !== globalState.player.teamNum ? 'red' : 'green'
                numActive++
            }
        }

        if (numActive === 0 && this.turnNum !== 1) return this.end()

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
            this.player.bonusAC = 0
            this.inPlayerTurn = true
            this.player.AP!.resetAP()
            const maxAP = this.player.AP!.getMaxAP()
            drawAP(this.player.AP!.getAvailableMoveAP() + this.player.AP!.getAvailableCombatAP(), maxAP.combat + maxAP.move)
            drawHP(this.player.getStat('HP'))
        } else {
            this.inPlayerTurn = false
            var critter = this.combatants[this.whoseTurn]
            if (critter.dead === true || critter.hostile !== true) return this.nextTurn()

            // Fire DoT: apply at the start of each critter's turn
            if (critter.onFireTurns > 0) {
                critter.onFireTurns--
                const fireDmg = getRandomInt(3, 6)
                uiLog(`${critter.name} burns for ${fireDmg} fire damage (${critter.onFireTurns} turns left)`)
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
