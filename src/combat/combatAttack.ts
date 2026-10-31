// Combat: working out an attack - hit chance, criticals, damage, explosions, burst spray
// (CE combat.cc attackCompute, _compute_damage, _compute_explosion_on_extras, _compute_spray).
// Methods of the Combat class, moved here verbatim and installed on its prototype by Combat.ts
// (wiki/code_quality.md Q16).

import type { Combat } from './Combat.js'
import { ANIM, CHARACTER_SOUND_EFFECT, playCharAnimSfx, sfxBuildWeaponName } from '../sfxNames.js'
import { ANIM_KICK_LEG, critterDamage, isHitFromFront, unarmedAttackAnim } from '../critter.js'
import { AudioEngine } from '../audio.js'
import { Critter, Obj, createObjectWithPID } from '../object.js'
import {
    DAM_BACKWASH,
    DAM_BYPASS,
    DAM_CRIP_RANDOM,
    DAM_CRITICAL,
    DAM_DEAD,
    DAM_DESTROY,
    DAM_DROP,
    DAM_EXPLODE,
    DAM_HIT,
    DAM_HIT_SELF,
    DAM_KNOCKED_DOWN,
    DAM_KNOCKED_OUT,
    DAM_LOSE_AMMO,
    DAM_LOSE_TURN,
    DAM_RANDOM_HIT,
    attackFindInvalidFlags,
    combatStandup,
    doRandomCripple,
} from './results.js'
import * as GameTime from '../gametime.js'
import { Point, hexDirectionTo, hexDistance, hexInDirection, hexLineBeyond, hexNearestNeighbor } from '../geometry.js'
import { RollResult, getMessage, randomRoll, rollIsSuccess } from '../util.js'
import * as Scripting from '../scripting.js'
import { type UnarmedMode, currentUnarmed } from '../unarmed.js'
import {
    accountForPartialCover as _accountForPartialCover,
    getAmmoStats as _getAmmoStats,
    getHitChance as _getHitChance,
    getHitDistanceModifier as _getHitDistanceModifier,
    weaponAttackType,
} from './hitChance.js'
import { ammoGetCapacity, ammoGetQuantity, ammoSetQuantity, weaponGetBurstRounds } from '../weaponAmmo.js'
import { computeDamage } from './damage.js'
import { critterSetWhoHitMe, noteHit } from './whoHitMe.js'
import { dbg, eventLogPush } from '../logger.js'
import { drawHP, uiDrawWeapon } from '../hudRefresh.js'
import { explosionRingCritters } from './explosion.js'
import { world } from '../state/world.js'
import { services } from '../state/services.js'
import { lazyLoadImage } from '../images.js'
import { makePID } from '../pro.js'
import { randomBetween } from '../random.js'
import { uiLog } from '../messageLog.js'
import {
    Attack,
    CF_TABLE,
    CRITTER_INVULNERABLE,
    CRITTER_NO_KNOCKBACK,
    HIT_LOCATIONS,
    PERK_WEAPON_ENHANCED_KNOCKOUT,
    PERK_WEAPON_KNOCKBACK,
    PERK_WEAPON_PENETRATE,
    actorName,
    aiHaveAmmo,
    attackInit,
    attackTypeOf,
    burstModSettings,
    checkForDeath,
    combatDebug,
    combatDifficultyDamageModifier,
    combatState,
    criticalHitDescription,
    removeFromHands,
    rollWeaponDamage,
    statRoll,
    unarmedDamageType,
    weaponCriticalFailureType,
    weaponSecondaryMode,
} from './Combat.js'

export const combatAttackMethods = {
    /** Load ammo stats for a loaded weapon. Returns defaults (X=1,Y=1,RM=0,ACmod=0) if no ammo.
     *  Vanilla: weaponGetAmmoDamageMultiplier / weaponGetAmmoDamageDivisor return 1/1 for no ammo. */
    getAmmoStats(this: Combat, weaponObj: Obj): { X: number; Y: number; RM: number; ACmod: number } {
        return _getAmmoStats(weaponObj)
    },
    accountForPartialCover(this: Combat, obj: Critter, target: Critter): number {
        return _accountForPartialCover(obj, target)
    },
    getHitDistanceModifier(this: Combat, obj: Critter, target: Critter, weapon: Obj): number {
        return _getHitDistanceModifier(obj, target, weapon)
    },
    getHitChance(this: Combat, obj: Critter, target: Critter, region: string, from?: Point, useDistance = true) {
        return _getHitChance(obj, target, region, from ?? obj.position, useDistance)
    },
    // CE attackCompute (SFALL form): explosive damage — or a thrown Plasma/EMP grenade —
    // explodes.
    isExplosiveAttack(this: Combat, weaponObj: Obj, dmgType: string): boolean {
        if (dmgType === 'Explosive') return true
        return weaponAttackType(weaponObj) === 'throw' && (dmgType === 'Plasma' || dmgType === 'EMP')
    },
    // ── CE attack pipeline ────────────────────────────────────────────────────────
    // combat.cc attackInit → attackCompute (roll, criticals, damage, ranged miss,
    // explosions) → actions.cc _action_melee/_action_ranged (animation, projectile) →
    // combat.cc _combat_display + _apply_damage.

    // CE combat.cc attackCompute.
    attackCompute(this: Combat, a: Attack): void {
        const attacker = a.attacker
        const weaponObj = a.weapon
        const weapon = (weaponObj as any)?.weapon
        const attackType = attackTypeOf(weaponObj)
        const isBurst = !!weapon?.isBurst?.()
        const dmgType = a.damageType
        const isGrenade =
            attackType === 'throw' && (dmgType === 'Explosive' || dmgType === 'Plasma' || dmgType === 'EMP')
        const range = weapon?.getMaximumRange?.() ?? 1
        if (a.hitLocation === 'uncalled') a.hitLocation = 'torso'

        let ammoQuantity = 1 // rounds on the main target
        let roundsSpent = 1
        let damageMultiplier = 2
        let roll: RollResult
        const chance = this.getHitChance(attacker, a.defender, a.hitLocation)
        if (isBurst) {
            let q = ammoGetQuantity(weaponObj)
            const burst = weaponGetBurstRounds(weaponObj)
            if (burst < q) q = burst
            roundsSpent = q
            const spray = this.computeSpray(attacker, a.defender, q, range, !!weapon?.isContinuous?.())
            roll = spray.roll
            ammoQuantity = spray.mainHits
            // _shoot_along_path: each extra takes its rounds at ×2 (attackComputeDamage)
            for (const [victim, rounds] of spray.extras) {
                const d = this.damageAgainst(attacker, weaponObj, victim, rounds, 2, 0, true)
                a.extras.push({ critter: victim, damage: d.damage, flags: 0, knockback: d.knockback })
            }
        } else {
            roll = randomRoll(chance.hit, chance.crit).roll
        }
        dbg(
            'rolls',
            `${actorName(attacker)} attacks ${actorName(a.defender)} — hit chance ${chance.hit}%, roll ${RollResult[roll]}`,
        )

        if (roll === RollResult.Failure && this.isJinxed(attacker, a.defender) && randomBetween(0, 1) === 1) {
            roll = RollResult.CriticalFailure
        }
        const meleeType = attackType === 'melee' || attackType === 'unarmed'
        const silentDeath = meleeType && attacker.isPlayer && this.silentDeathApplies(attacker, a.defender)
        if (roll === RollResult.Success && meleeType && attacker.isPlayer) {
            if (attacker.hasPerk('Slayer')) roll = RollResult.CriticalSuccess
            if (silentDeath) damageMultiplier = 4
            // SFALL: the unarmed move's bonus critical chance (unarmedGetBonusCriticalChance)
            const bonus = weaponObj === null ? currentUnarmed(attacker).mode.critBonus : 0
            if (bonus !== 0 && randomBetween(1, 100) <= bonus) roll = RollResult.CriticalSuccess
        }
        if (attackType === 'ranged') {
            if (
                roll === RollResult.Success &&
                attacker.isPlayer &&
                attacker.hasPerk('Sniper') &&
                randomBetween(1, 10) <= attacker.getStat('LUK')
            ) {
                roll = RollResult.CriticalSuccess
            }
        }
        a.ammoQuantity = weaponObj && ammoGetCapacity(weaponObj) > 0 ? (attackType === 'ranged' ? roundsSpent : 1) : 0
        // CE item.cc _item_w_compute_ammo_cost: the Super Cattle Prod and the Mega Power Fist use
        // two charges a hit
        if (a.ammoQuantity > 0 && (weaponObj?.pid === 399 || weaponObj?.pid === 407)) a.ammoQuantity *= 2

        switch (roll) {
            case RollResult.CriticalSuccess:
                damageMultiplier = this.computeCriticalHit(a)
                // SFALL: Silent Death also doubles a critical
                if (silentDeath) damageMultiplier *= 2
            // falls through
            case RollResult.Success:
                a.attackerFlags |= DAM_HIT
                this.computeEnhancedKnockout(a)
                this.attackComputeDamage(a, ammoQuantity, damageMultiplier)
                break
            case RollResult.CriticalFailure:
                this.computeCriticalFailure(a)
                break
            default:
                // CE ROLL_FAILURE: _check_ranged_miss for a ranged / thrown attack (its
                // rolls only — the result is ignored, and it never hits anyway)
                if (attackType === 'ranged' || attackType === 'throw') {
                    this.checkRangedMiss(attacker, a.defender, range, 'torso')
                }
                break
        }

        // Ranged / thrown miss: the shot flies on and may hit someone else (attack->tile).
        if ((attackType === 'ranged' || attackType === 'throw') && (a.attackerFlags & (DAM_HIT | DAM_CRITICAL)) === 0) {
            const miss = this.computeRangedMiss(attacker, a.defender, weaponObj!, dmgType)
            if (miss) {
                a.tile = miss.tile
                a.landing = miss.landing
                if (miss.victim) {
                    a.attackerFlags |= DAM_HIT
                    a.defender = miss.victim
                    this.attackComputeDamage(a, 1, 2)
                }
            }
        }

        // SFALL form: explosive damage (or a thrown plasma / EMP grenade) blasts the
        // extras unless the attack critically failed; a DAM_EXPLODE failure blasts
        // around the attacker.
        if (
            (dmgType === 'Explosive' || isGrenade) &&
            ((a.attackerFlags & DAM_HIT) !== 0 || (a.attackerFlags & DAM_CRITICAL) === 0)
        ) {
            this.computeExplosionOnExtras(a, false, isGrenade)
        } else if ((a.attackerFlags & DAM_EXPLODE) !== 0) {
            this.computeExplosionOnExtras(a, true, isGrenade)
        }

        // CE combat.cc attackComputeDeathFlags / _check_for_death
        a.attackerFlags = checkForDeath(attacker, a.attackerDamage, a.attackerFlags)
        a.defenderFlags = checkForDeath(a.defender, a.defenderDamage, a.defenderFlags)
        for (const x of a.extras) x.flags = checkForDeath(x.critter, x.damage, x.flags)
    },
    // CE combat.cc attackCompute: PERK_SILENT_DEATH — the player sneaking up from behind
    // on someone who hasn't hit them.
    silentDeathApplies(this: Combat, attacker: Critter, defender: Critter): boolean {
        return (
            attacker.hasPerk('Silent Death') &&
            !isHitFromFront(attacker, defender) &&
            !!attacker.isSneaking &&
            defender.whoHitMe !== attacker
        )
    },
    // CE combat.cc attackComputeEnhancedKnockout: PERK_WEAPON_ENHANCED_KNOCKOUT knocks out
    // with d100 <= ST − 8.
    computeEnhancedKnockout(this: Combat, a: Attack): void {
        if ((a.weapon?.pro?.extra?.perk ?? -1) !== PERK_WEAPON_ENHANCED_KNOCKOUT) return
        if (randomBetween(1, 100) > a.attacker.getStat('STR') - 8) return
        const defWeapon = a.defender.isPlayer ? null : this.rightHandWeapon(a.defender)
        if ((attackFindInvalidFlags(a.defender, defWeapon) & 1) === 0) a.defenderFlags |= DAM_KNOCKED_OUT
    },
    rightHandWeapon(this: Combat, c: Critter): Obj | null {
        const w = c.rightHand
        return w && w.pid !== undefined ? w : null
    },
    // CE combat.cc attackComputeCriticalHit — d100 + Better Criticals picks the effect
    // (bands 20/45/70/90/100), the defender's table (gPlayerCriticalHitTable for the
    // player) gives the multiplier and flags; a failed stat roll adds the massive flags.
    computeCriticalHit(this: Combat, a: Attack): number {
        const defender = a.defender
        if ((defender.pro?.extra?.flags ?? 0) & CRITTER_INVULNERABLE) return 2
        a.attackerFlags |= DAM_CRITICAL
        const chance = randomBetween(1, 100) + a.attacker.getStat('Better Criticals')
        const effect = chance <= 20 ? 0 : chance <= 45 ? 1 : chance <= 70 ? 2 : chance <= 90 ? 3 : chance <= 100 ? 4 : 5
        const location = Math.max(0, HIT_LOCATIONS.indexOf(a.hitLocation))
        const desc = criticalHitDescription(defender, location, effect)
        a.defenderFlags |= desc[1]
        a.criticalMessageId = desc[5]
        if (desc[2] !== -1 && !statRoll(defender, desc[2], desc[3])) {
            a.defenderFlags |= desc[4]
            a.criticalMessageId = desc[6]
        }
        if ((a.defenderFlags & DAM_CRIP_RANDOM) !== 0) a.defenderFlags = doRandomCripple(a.defenderFlags)
        if ((a.weapon?.pro?.extra?.perk ?? -1) === PERK_WEAPON_ENHANCED_KNOCKOUT) a.defenderFlags |= DAM_KNOCKED_OUT
        const defWeapon = defender.isPlayer ? null : this.rightHandWeapon(defender)
        a.defenderFlags &= ~attackFindInvalidFlags(defender, defWeapon)
        combatDebug(`crit hit: roll=${chance} effect=${effect} flags=0x${a.defenderFlags.toString(16)} DM=${desc[0]}`)
        return desc[0]
    },
    // CE combat.cc attackComputeCriticalFailure — d100 − 5 × (LK − 5) picks the _cf_table
    // effect of the weapon's critical-failure type; no effect before game day 6 for the
    // player (CE's criticals time limit).
    computeCriticalFailure(this: Combat, a: Attack): void {
        const attacker = a.attacker
        a.attackerFlags &= ~DAM_HIT
        if ((attacker.pro?.extra?.flags ?? 0) & CRITTER_INVULNERABLE) return
        if (attacker.isPlayer && Math.floor((world.gameTickTime ?? 0) / GameTime.TICKS_PER_DAY) < 6) return
        const attackType = attackTypeOf(a.weapon)
        const typeIndex = weaponCriticalFailureType(a.weapon)
        const chance = randomBetween(1, 100) - 5 * (attacker.getStat('LUK') - 5)
        const effect = chance <= 20 ? 0 : chance <= 50 ? 1 : chance <= 75 ? 2 : chance <= 95 ? 3 : 4
        const flags = CF_TABLE[typeIndex][effect]
        combatDebug(`crit fail: type=${typeIndex} roll=${chance} effect=${effect} flags=0x${flags.toString(16)}`)
        if (flags === 0) return

        a.attackerFlags |= DAM_CRITICAL | flags
        a.attackerFlags &= ~attackFindInvalidFlags(attacker, a.weapon)

        if ((a.attackerFlags & DAM_HIT_SELF) !== 0) {
            this.attackComputeDamage(a, attackType === 'ranged' ? a.ammoQuantity : 1, 2)
        } else if ((a.attackerFlags & DAM_EXPLODE) !== 0) {
            this.attackComputeDamage(a, 1, 2)
        }
        if ((a.attackerFlags & DAM_LOSE_TURN) !== 0 && attacker.AP) attacker.AP.combat = 0
        if ((a.attackerFlags & DAM_LOSE_AMMO) !== 0) {
            if (attackType === 'ranged') a.ammoQuantity = ammoGetQuantity(a.weapon)
            else a.attackerFlags &= ~DAM_LOSE_AMMO
        }
        if ((a.attackerFlags & DAM_CRIP_RANDOM) !== 0) a.attackerFlags = doRandomCripple(a.attackerFlags)
        if ((a.attackerFlags & DAM_RANDOM_HIT) !== 0) {
            const victim = this.aiRandomTarget(a)
            if (victim) {
                a.defender = victim
                a.attackerFlags |= DAM_HIT
                a.hitLocation = 'torso'
                a.attackerFlags &= ~DAM_CRITICAL
                this.attackComputeDamage(a, attackType === 'ranged' ? a.ammoQuantity : 1, 2)
            } else {
                a.defender = a.oops
            }
            a.tile = { ...a.defender.position }
        }
    },
    // CE combat.cc attackComputeDamage — `rounds` rounds against the defender (DAM_HIT)
    // or the attacker (critical failure).
    attackComputeDamage(this: Combat, a: Attack, rounds: number, multiplier: number): void {
        const hit = (a.attackerFlags & DAM_HIT) !== 0
        const target = hit ? a.defender : a.attacker
        const flags = hit ? a.defenderFlags : a.attackerFlags
        const d = this.damageAgainst(a.attacker, a.weapon, target, rounds, multiplier, flags, hit, a.hitMode)
        if (hit) {
            a.defenderDamage = d.damage
            a.defenderKnockback = d.knockback
        } else {
            a.attackerDamage = d.damage
        }
    },
    // CE combat.cc attackComputeDamage body: per round weaponGetDamage + bonus, × multiplier
    // × ammo multiplier / divisor, / 2, × difficulty, − DT, − DR%; Living Anatomy and
    // Pyromaniac add 5 once; knockback is damage / 10 (/ 5 with PERK_WEAPON_KNOCKBACK).
    damageAgainst(
        this: Combat,
        attacker: Critter,
        weaponObj: Obj | null,
        target: Critter,
        rounds: number,
        multiplier: number,
        flags: number,
        withKnockback: boolean,
        hitMode?: UnarmedMode,
    ): { damage: number; knockback: number } {
        if (target.type !== 'critter') return { damage: 0, knockback: 0 }
        const unarmed = weaponObj === null
        const mode = hitMode ?? (unarmed ? currentUnarmed(attacker).mode : null)
        const wep = (weaponObj as any)?.weapon
        const damageType = unarmed ? unarmedDamageType(attacker) : (wep?.getDamageType?.() ?? 'Normal')
        let DT = target.getStat('DT ' + damageType) + target.getArmorDT(damageType)
        let DR = target.getStat('DR ' + damageType) + target.getArmorDR(damageType)
        if ((flags & DAM_BYPASS) !== 0 && damageType !== 'EMP') {
            DT = Math.trunc((20 * DT) / 100)
            DR = Math.trunc((20 * DR) / 100)
        } else {
            const penetrate = unarmed ? !!mode?.penetrate : weaponObj?.pro?.extra?.perk === PERK_WEAPON_PENETRATE
            if (penetrate) DT = Math.trunc((20 * DT) / 100)
            if (attacker.isPlayer && (attacker.traits ?? []).includes('Finesse')) DR += 30
        }
        const attackType = attackTypeOf(weaponObj)
        const damageBonus =
            attacker.isPlayer && attackType === 'ranged'
                ? 2 * attacker.perks.filter((p) => p === 'Bonus Ranged Damage').length
                : 0
        const ammo = unarmed ? { X: 1, Y: 1, RM: 0, ACmod: 0 } : this.getAmmoStats(weaponObj!)
        // (DR without the ammo modifier: each ruleset applies it its own way, damage.ts)
        const CD = combatDifficultyDamageModifier(attacker)
        const melee = attackType === 'melee' || attackType === 'unarmed'

        let damage = 0
        for (let i = 0; i < rounds; i++) {
            const RD = unarmed
                ? rollWeaponDamage(attacker, mode!.bonusDamage + mode!.minDmg, mode!.bonusDamage + mode!.maxDmg, true)
                : rollWeaponDamage(attacker, wep.minDmg, wep.maxDmg, melee)
            damage += computeDamage({
                RD,
                bonus: damageBonus,
                critMult: multiplier,
                ammoX: ammo.X,
                ammoY: ammo.Y,
                ammoRM: ammo.RM,
                DT,
                DR,
                CD,
            })
        }
        if (attacker.isPlayer) {
            if (attacker.hasPerk('Living Anatomy')) {
                const kt = target.killType ?? 0
                if (kt !== 10 && kt !== 16) damage += 5 // not KILL_TYPE_ROBOT / KILL_TYPE_ALIEN
            }
            if (attacker.hasPerk('Pyromaniac') && damageType === 'Fire') damage += 5
        }

        let knockback = 0
        const multihex = (((target.flags ?? 0) >>> 0) & 0x800) !== 0 // OBJECT_MULTIHEX
        if (
            withKnockback &&
            !multihex &&
            (damageType === 'Explosive' ||
                weaponObj === null ||
                weaponObj.pid === undefined ||
                attackType === 'melee') &&
            !((target.pro?.extra?.flags ?? 0) & CRITTER_NO_KNOCKBACK)
        ) {
            let should = true
            let stonewall = false
            if (target.isPlayer && target.hasPerk('Stonewall')) {
                stonewall = true
                if (randomBetween(0, 100) < 50) should = false
            }
            if (should) {
                const divisor = (weaponObj?.pro?.extra?.perk ?? -1) === PERK_WEAPON_KNOCKBACK ? 5 : 10
                knockback = Math.trunc(damage / divisor)
                if (stonewall) knockback = Math.trunc(knockback / 2)
            }
        }
        combatDebug(
            `damage: ${actorName(attacker)} → ${actorName(target)} ×${rounds} M=${multiplier} DT=${DT} DR=${DR}% CD=${CD} → ${damage} (kb ${knockback})`,
        )
        eventLogPush({
            actor: actorName(attacker),
            action: 'damage',
            target: actorName(target),
            result: 'computed',
            damage,
            rounds,
            critMultiplier: multiplier,
            DT,
            DR,
            CD,
            damageType,
            weapon: weaponObj ? (weaponObj.name ?? null) : `unarmed:${mode?.name}`,
            message: `${actorName(attacker)} → ${actorName(target)}: ${damage} ${damageType} dmg`,
        })
        return { damage, knockback }
    },
    // CE combat.cc _compute_explosion_on_extras — rings around the impact (or the
    // attacker for DAM_EXPLODE; grenades radius 2, rockets 3) hit up to 6 live critters
    // with a clear line to the blast, one round at ×2 with knockback; the attacker caught
    // in it takes the round too (DAM_BACKWASH).
    computeExplosionOnExtras(this: Combat, a: Attack, fromAttacker: boolean, isGrenade: boolean): void {
        const gMap = world.gMap
        if (!gMap) return
        const attacker = a.attacker
        let center: Point
        let centerObj: Obj | null
        if (fromAttacker) {
            centerObj = attacker
            center = attacker.position
        } else if ((a.attackerFlags & DAM_HIT) !== 0) {
            centerObj = a.defender
            center = a.defender.position
        } else {
            centerObj = null
            center = a.tile ?? a.defender.position
        }
        a.explosionTile = { ...center }
        // The attacker caught in the blast doesn't count towards the 6 extras.
        const ring = explosionRingCritters(center, attacker.elevation, centerObj, isGrenade, 6 - a.extras.length + 1)
        for (const c of ring) {
            if (c === attacker) {
                const hit = a.attackerFlags & DAM_HIT
                a.attackerFlags &= ~DAM_HIT
                this.attackComputeDamage(a, 1, 2)
                a.attackerFlags |= hit | DAM_BACKWASH
            } else if (a.extras.length < 6 && !a.extras.some((x) => x.critter === c)) {
                const d = this.damageAgainst(attacker, a.weapon, c, 1, 2, 0, true)
                a.extras.push({ critter: c, damage: d.damage, flags: 0, knockback: d.knockback })
            }
        }
    },
    // Visual only: one explosion sprite at the impact (misc proto 14, as Obj.explode uses).
    spawnExplosionSprite(this: Combat, pos: Point): void {
        if (window.__test?.fastMode) return
        const sprite = createObjectWithPID(makePID(5 /* misc */, 14 /* Explosion */), -1)
        sprite.position = { x: pos.x, y: pos.y }
        lazyLoadImage(sprite.art, () => {
            if (!world.gMap) return
            world.gMap.addObject(sprite)
            sprite.singleAnimation(false, () => {
                sprite.anim = null
                world.gMap?.destroyObject(sprite)
            })
        })
    },
    attack(this: Combat, obj: Critter, target: Critter, region = 'torso', callback?: () => void) {
        this.hasAttacked = true
        // CE _combat_sequence_init: attacker and defender are combatants and have each
        // other as who-hit-me when the fight starts with this attack.
        if (!target.isPlayer && !target.hostile && target.teamNum !== this.player.teamNum) {
            target.hostile = true
            if (!target.whoHitMe) critterSetWhoHitMe(target, obj)
        }
        // turn to face the target
        const hex = hexNearestNeighbor(obj.position, target.position)
        if (hex !== null) obj.orientation = hex.direction
        // CE actions.cc _action_attack: reg_anim_clear on the defender, so a defender still
        // busy with an animation (a dodge, a hit from the last burst) shows this attack's
        // reaction. Not a dead or knocked-down one (their lying art would be reset).
        if (target !== obj && !target.dead && !target.isKnockedDown && target.inAnim()) target.clearAnim()

        let weaponObj = obj.equippedWeapon
        // CE combat_ai.cc _ai_pick_hit_mode: an item that isn't ITEM_TYPE_WEAPON — the Shiv
        // (itemGetType MISC) — makes the AI punch (HIT_MODE_PUNCH); the Shiv stays in hand
        if (!obj.isPlayer && weaponObj && weaponObj.pid === 383) weaponObj = Critter.makeFist()
        const who = obj.isPlayer ? 'You' : obj.name

        // Early ammo guard — no animation, no AP loss for any attacker
        if (!aiHaveAmmo(weaponObj)) {
            // CE _combat_attack → combat.msg 101 "Out of ammo." (the AI checks before it attacks)
            if (obj.isPlayer) uiLog(getMessage('combat', 101) ?? 'Out of ammo.')
            if (callback) callback()
            return
        }

        // (CE _combat_check_bad_shot refuses a weapon with both arms crippled — checkBadShot;
        // punches and kicks stay possible)

        // CE combat.cc _combat_attack: attackInit + attackCompute before the animation.
        const a = attackInit(obj, target, weaponObj, region)
        combatState.mainAttack = a // CE _main_ctd (sfall combat_data)
        const gcsd = this.gcsd
        if (gcsd) a.accuracyBonus = gcsd.accuracyBonus // (sfall combat data; getHitChance adds it)
        this.attackCompute(a)
        // CE combat.cc _combat_attack: the dude remembers whom he attacks (_ai_danger_source,
        // the party's attack_who), and every attacker its last target
        if (obj.isPlayer) critterSetWhoHitMe(obj, a.defender)
        // (aiInfoSetLastTarget: a dead target is stored as none, oneself not at all)
        if (a.defender !== obj) obj.aiLastTarget = a.defender?.dead ? null : a.defender
        if (gcsd) {
            // CE _combat_attack: the attack_complex bonuses and clamps, on every attack of the
            // first combatant's turn (_gcsd is cleared when that turn ends, beginTurn)
            a.defenderDamage += gcsd.damageBonus
            if (a.defenderDamage < gcsd.minDamage) a.defenderDamage = gcsd.minDamage
            if (a.defenderDamage > gcsd.maxDamage) a.defenderDamage = gcsd.maxDamage
            if (gcsd.overrideAttackResults) a.defenderFlags = gcsd.targetResults
        }

        // CE ref: actions.cc:629 _action_melee / _action_ranged — the weapon's ATTACK
        // sound is registered with delay 0 (frame 0); only the HIT sound and the damage
        // display wait for the action frame.
        const rawAttackSoundID = weaponObj?.pro?.extra?.soundID
        const attackSoundChar = typeof rawAttackSoundID === 'number' ? String.fromCharCode(rawAttackSoundID) : null
        if (attackSoundChar && !window.__test?.fastMode) {
            // CE sfxBuildWeaponName(WEAPON_SOUND_EFFECT_ATTACK): a missing file stays silent
            services.audioEngine.playSfxByName(
                sfxBuildWeaponName(1, weaponObj, weaponSecondaryMode(weaponObj), null).toLowerCase(),
                obj,
            )
        }
        // CE combat.cc _combat_attack: a critter other than the player kicks instead of
        // punching 1 time in 4 when it has the kick art (same damage and AP).
        const fist = weaponObj === null || weaponObj.pid === undefined
        let unarmedAnim = fist ? unarmedAttackAnim(obj) : -1
        let attackAnim = 'attack'
        if (fist && !obj.isPlayer && randomBetween(1, 4) === 1 && obj.hasAnimation('anim:' + ANIM_KICK_LEG)) {
            unarmedAnim = ANIM_KICK_LEG
            attackAnim = 'anim:' + ANIM_KICK_LEG
        }
        a.unarmedAnim = unarmedAnim
        // CE ref: actions.cc:625 — punches and kicks use sfxBuildCharName(attacker,
        // anim, UNUSED) instead of a weapon sound.
        if (fist && !window.__test?.fastMode) playCharAnimSfx(obj, unarmedAnim)

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
            // CE combat.cc _combat_attack tail: an attacker its own critical failure
            // knocked down stands up at once (unless out cold or its turn is lost).
            const r = obj.injuryFlags
            if (
                !obj.dead &&
                (r & (DAM_KNOCKED_OUT | DAM_KNOCKED_DOWN)) !== 0 &&
                (r & (DAM_KNOCKED_OUT | DAM_DEAD | DAM_LOSE_TURN)) === 0
            ) {
                return combatStandup(obj, () => {
                    if (callback) callback()
                })
            }
            if (callback) callback()
            else if (!obj.isKnockedDown) obj.clearAnim()
        }
        // CE actions.cc _action_ranged: a ranged (non-throw) attack aims first (ANIM_POINT)
        // and lowers the weapon at the end (ANIM_UNPOINT) unless knocked down or dead
        const POINT = 'anim:43',
            UNPOINT = 'anim:44' // ANIM_POINT / ANIM_UNPOINT
        const aims = attackTypeOf(weaponObj) === 'ranged'
        let fireDone = false
        let unpointed = false
        const afterAttack = (): void => {
            if (!fireDone || !finished || unpointed) return
            unpointed = true
            if (aims && !obj.dead && !obj.isKnockedDown && obj.hasAnimation(UNPOINT)) {
                obj.staticAnimation(
                    UNPOINT,
                    () => {
                        animDone = true
                        proceed()
                    },
                    true,
                )
            } else {
                animDone = true
                proceed()
            }
        }
        const resolveAttack = (): void => {
            if (resolved) return
            resolved = true
            const deferred = this.resolveAttack(a, who, () => {
                finished = true
                afterAttack()
            })
            if (!deferred) finished = true
        }
        const fire = (): void =>
            obj.staticAnimation(
                attackAnim,
                () => {
                    resolveAttack()
                    fireDone = true
                    afterAttack()
                },
                attackAnim !== 'attack',
                undefined,
                resolveAttack,
            )
        if (aims && obj.hasAnimation(POINT)) obj.staticAnimation(POINT, fire, true)
        else fire()
    },
    // Second half of attack(): on the action frame — the projectile (CE _action_ranged:
    // only when the attack hit or did not critically fail), the dodge, then
    // _combat_display and _apply_damage. Returns true when a projectile is in flight;
    // `done` then runs after its impact.
    resolveAttack(this: Combat, a: Attack, who: string, done: () => void): boolean {
        const obj = a.attacker
        const weaponObj = a.weapon
        const audio: AudioEngine = services.audioEngine
        const rawSoundID = weaponObj?.pro?.extra?.soundID
        const soundIdChar = typeof rawSoundID === 'number' ? String.fromCharCode(rawSoundID) : null
        const attackType = attackTypeOf(weaponObj)
        const thrown = attackType === 'throw'
        const isRangedType = attackType === 'ranged' || attackType === 'throw'
        const hit = (a.attackerFlags & DAM_HIT) !== 0
        const critical = (a.attackerFlags & DAM_CRITICAL) !== 0
        const intended = a.oops

        // Rounds leave the magazine (CE _combat_attack: ammo − attack->ammoQuantity).
        if (weaponObj && a.ammoQuantity > 0 && ammoGetCapacity(weaponObj) > 0) {
            ammoSetQuantity(weaponObj, Math.max(0, ammoGetQuantity(weaponObj) - a.ammoQuantity))
            if (obj.isPlayer) uiDrawWeapon()
        }

        const flies = isRangedType && (hit || !critical)
        const projectilePid = flies ? this.projectilePid(weaponObj!) : null
        const thrownItem = flies && thrown ? this.takeThrownItem(obj, weaponObj!) : null
        const targetTile = { ...intended.position }

        const impact = (): void => {
            if (hit) {
                if (!window.__test?.fastMode) {
                    // CE ref: actions.cc:637 — an unarmed hit sounds sfxBuildCharName(attacker,
                    // anim, CONTACT); a weapon its HIT sound.
                    if (a.unarmedAnim >= 0) playCharAnimSfx(obj, a.unarmedAnim, CHARACTER_SOUND_EFFECT.contact)
                    else if (soundIdChar)
                        audio.playSfxByName(
                            sfxBuildWeaponName(
                                4,
                                weaponObj,
                                weaponSecondaryMode(weaponObj),
                                a.defender ?? intended,
                            ).toLowerCase(),
                            a.defender ?? intended,
                        )
                }
            } else {
                if (!window.__test?.fastMode && isRangedType) audio.playSfxByName('cmbtflx', intended)
                // CE actions.cc: a miss dodges unless prone; a ranged miss only when the
                // weapon has no visible projectile. Melee dodges play their sound.
                if (
                    !projectilePid &&
                    !intended.dead &&
                    !intended.isKnockedDown &&
                    !intended.inAnim() &&
                    intended.hasAnimation('dodge')
                ) {
                    if (!isRangedType) playCharAnimSfx(intended, ANIM.dodge)
                    intended.staticAnimation('dodge', () => intended.clearAnim())
                }
            }
            if (thrownItem)
                this.placeThrownItem(
                    thrownItem,
                    hit ? { ...a.defender.position } : (a.landing ?? targetTile),
                    weaponObj!,
                    a.damageType,
                )
            if (a.explosionTile) this.spawnExplosionSprite(a.explosionTile)
            this.combatDisplay(a)
            this.applyDamage(a)
            if (!world.combat) return
            // CE actions.cc _action_melee:676 / _action_ranged:918 — after a melee attack
            // the attacker says its hit / miss line, after a ranged one the defender
            // (vanilla); no hit line for a killing blow.
            const speaker = isRangedType ? a.defender : obj
            if (hit) {
                if ((a.defenderFlags & DAM_DEAD) === 0) this.maybeTaunt(speaker, 'hit', a.hitLocation)
            } else {
                this.maybeTaunt(isRangedType ? intended : obj, 'miss')
            }
        }

        if (projectilePid !== null) {
            const dest = hit ? { ...a.defender.position } : (a.tile ?? targetTile)
            this.flyProjectile(obj, intended, dest, projectilePid, () => {
                try {
                    impact()
                } finally {
                    done()
                }
            })
            return true
        }
        impact()
        return false
    },
    // CE combat.cc _apply_damage (+ actions.cc _show_damage_to_object for the animation):
    // the results first (_set_new_results), then the damage, the who-hit-me bookkeeping,
    // the critter's damage reaction and death.
    applyDamage(this: Combat, a: Attack): void {
        const attacker = a.attacker
        const dmgType = a.damageType
        if (!attacker.dead) {
            this.attackerWeaponEffects(a)
            if (a.attackerFlags !== 0 || a.attackerDamage > 0) {
                critterDamage(attacker, a.attackerDamage, attacker, true, true, dmgType, undefined, {
                    flags: a.attackerFlags & ~DAM_HIT,
                    weapon: a.weapon,
                    hitFromFront: true,
                    noDamageProc: a.defender === a.oops,
                }) // CE _apply_damage: a4 = defender == oops
                if (attacker.isPlayer) drawHP(attacker.getStat('HP'))
                if (!world.combat) return
                if (attacker.dead) this.perish(attacker, attacker, dmgType)
            }
        }

        const defender = a.defender
        if ((a.attackerFlags & DAM_HIT) !== 0 && !defender.dead) {
            const accidental = defender !== a.oops
            critterDamage(defender, a.defenderDamage, attacker, true, true, dmgType, undefined, {
                flags: a.defenderFlags,
                weapon: a.weapon,
                knockback: a.defenderKnockback,
                knockbackRotation: hexDirectionTo(attacker.position, defender.position),
                hitFromFront: isHitFromFront(defender, attacker),
                noDamageProc: accidental, // CE _apply_damage: a4 = defender != oops
            })
            noteHit(defender, attacker, accidental) // CE combat.cc:4706
            if (defender.isPlayer) drawHP(defender.getStat('HP'))
            this.notifyOnlookers(defender)
            // CE _apply_damage: the attacker's combat_p_proc, fixed param 2 (hit), target
            // the defender.
            if (a.defenderDamage >= 0 && attacker._script?.combat_p_proc && !attacker.dead) {
                if (Scripting.combatEvent(attacker, 'hit', defender)) return
            }
            if (!world.combat) return
            if (defender.dead) this.perish(defender, attacker, dmgType)
        } else if (defender.type === 'critter' && !defender.dead) {
            // CE _apply_damage: the defender block runs on a miss too (no damage, no flags) —
            // the intended target considers retaliating, the onlookers notice
            noteHit(defender, attacker, defender !== a.oops)
            this.notifyOnlookers(defender)
        }

        for (const x of a.extras) {
            const c = x.critter
            if (c.dead) continue
            critterDamage(c, x.damage, attacker, true, true, dmgType, undefined, {
                flags: x.flags,
                weapon: a.weapon,
                knockback: x.knockback,
                // CE _show_damage_extras: tileGetRotationTo(attacker->tile, obj->tile) — a
                // grenade's extras fly away from the thrower, not the blast
                knockbackRotation: hexDirectionTo(attacker.position, c.position),
                hitFromFront: isHitFromFront(c, attacker),
                noDamageProc: a.defender === a.oops, // CE _apply_damage: a4 = defender == oops for extras
            })
            noteHit(c, attacker, true)
            if (c.isPlayer) drawHP(c.getStat('HP'))
            this.notifyOnlookers(c)
            if (x.damage >= 0 && attacker._script?.combat_p_proc && !attacker.dead) {
                if (Scripting.combatEvent(attacker, 'hit', c)) return
            }
            if (!world.combat) return
            if (c.dead) this.perish(c, attacker, dmgType)
        }
    },
    // CE actions.cc _show_damage_to_object for the attacker of a critical failure: its
    // weapon explodes (gone, with an explosion), is destroyed, or is dropped at its feet.
    attackerWeaponEffects(this: Combat, a: Attack): void {
        const weaponObj = a.weapon
        if (!weaponObj || weaponObj.pid === undefined) return
        const attacker = a.attacker
        const flags = a.attackerFlags
        if ((flags & (DAM_EXPLODE | DAM_DESTROY | DAM_DROP)) === 0) return
        removeFromHands(attacker, weaponObj)
        if ((flags & (DAM_EXPLODE | DAM_DESTROY)) === 0) {
            // DAM_DROP: CE _obj_drop — is_dropping_p_proc / drop_p_proc may keep it
            // (then it stays in the inventory, out of the hand)
            if (!attacker.inventory.includes(weaponObj)) attacker.inventory.push(weaponObj)
            if (world.gMap) weaponObj.drop(attacker)
        } else {
            const idx = attacker.inventory.indexOf(weaponObj)
            if (idx !== -1) attacker.inventory.splice(idx, 1)
            if ((flags & DAM_EXPLODE) !== 0) this.spawnExplosionSprite(attacker.position)
        }
        if (attacker.isPlayer) uiDrawWeapon()
        else attacker.setIdleArt()
    },
    // CE combat.cc _compute_spray — the roll and the rounds per victim, no damage. Also
    // used by the AI safety check (_combat_safety_invalidate_weapon), as in CE.
    // `continuous` is CE's anim == ANIM_FIRE_CONTINUOUS (flamers): one round per line,
    // one per critter on it.
    computeSpray(
        this: Combat,
        obj: Critter,
        target: Critter,
        ammoQuantity: number,
        range: number,
        continuous = false,
    ): { roll: RollResult; mainHits: number; extras: Map<Critter, number> } {
        const chance = this.getHitChance(obj, target, 'torso')
        let accuracy = chance.hit
        let { roll } = randomRoll(accuracy, chance.crit)
        combatDebug(`spray: rounds=${ammoQuantity} accuracy=${accuracy} roll=${RollResult[roll]}`)

        const extras = new Map<Critter, number>() // victim → rounds that hit (attack->extras)
        let mainHits = 0

        if (roll !== RollResult.CriticalFailure) {
            if (roll === RollResult.CriticalSuccess) accuracy += 20

            let centerRounds = 1,
                leftRounds = 1,
                rightRounds = 1,
                mainTargetRounds = 1
            const burstMod = !continuous ? burstModSettings() : null
            if (burstMod) {
                // CE combat.cc burstModComputeRounds (sfall ddraw.ini [Misc] ComputeSprayMod=1):
                // the centre gets ceil(rounds × CenterMult / CenterDiv) (at least 1), the
                // sides split the rest, the main target ceil(centre × TargetMult / TargetDiv)
                const total = ammoQuantity
                centerRounds = Math.ceil((total * burstMod.centerMult) / burstMod.centerDiv)
                if (centerRounds === 0) centerRounds = 1
                leftRounds = Math.trunc((total - centerRounds) / 2)
                rightRounds = total - centerRounds - leftRounds
                mainTargetRounds = Math.ceil((centerRounds * burstMod.targetMult) / burstMod.targetDiv)
            } else if (!continuous) {
                centerRounds = Math.trunc(ammoQuantity / 3)
                if (centerRounds === 0) centerRounds = 1
                leftRounds = Math.trunc(ammoQuantity / 3)
                rightRounds = ammoQuantity - centerRounds - leftRounds
                mainTargetRounds = Math.trunc(centerRounds / 2)
                if (mainTargetRounds === 0) {
                    mainTargetRounds = 1
                    centerRounds -= 1
                }
            }

            for (let i = 0; i < mainTargetRounds; i++) {
                if (rollIsSuccess(randomRoll(accuracy, 0).roll)) mainHits += 1
            }
            if (mainHits === 0 && this.checkRangedMiss(obj, target, range, 'torso')) mainHits = 1

            const mainEnd = hexLineBeyond(obj.position, target.position, range)
            mainHits += this.shootAlongPath(obj, target, mainEnd, centerRounds - mainHits, extras, continuous)

            const centerTile =
                hexDistance(obj.position, target.position) <= 3
                    ? hexLineBeyond(obj.position, target.position, 3)
                    : target.position
            const rotation = hexDirectionTo(centerTile, obj.position)
            const leftEnd = hexLineBeyond(obj.position, hexInDirection(centerTile, (rotation + 1) % 6), range)
            mainHits += this.shootAlongPath(obj, target, leftEnd, leftRounds, extras, continuous)
            const rightEnd = hexLineBeyond(obj.position, hexInDirection(centerTile, (rotation + 5) % 6), range)
            mainHits += this.shootAlongPath(obj, target, rightEnd, rightRounds, extras, continuous)

            if (roll !== RollResult.Failure || (mainHits <= 0 && extras.size <= 0)) {
                if (rollIsSuccess(roll) && mainHits === 0 && extras.size === 0) roll = RollResult.Failure
            } else {
                roll = RollResult.Success
            }
        }

        return { roll, mainHits, extras }
    },
    isJinxed(this: Combat, obj: Critter, target: Critter): boolean {
        // CE: traitIsSelected(TRAIT_JINXED) || perkHasRank(gDude, PERK_JINXED) — both the
        // player's; DH2 keeps the attacker/target Pariah Dog check from rollHit.
        const player = world.player
        return (
            !!player &&
            ((player.traits?.includes('Jinxed') ?? false) ||
                player.hasPerk('Jinxed') ||
                obj.hasPerk('Pariah Dog') ||
                target.hasPerk('Pariah Dog'))
        )
    },
}
