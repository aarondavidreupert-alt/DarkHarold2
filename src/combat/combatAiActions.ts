// Combat: what the AI does in its turn - attacking, called shots, switching or reloading weapons,
// drugs, picking things up, moving closer or away, running (CE combat_ai.cc _ai_try_attack and the
// _ai_* helpers).
// Methods of the Combat class, moved here verbatim and installed on its prototype by Combat.ts
// (wiki/code_quality.md Q16).

import { Combat } from './Combat.js'
import { Config } from '../config.js'
import { Critter, Obj, cloneItem } from '../object.js'
import { PUNCH, currentUnarmed, unarmedAPCost } from '../unarmed.js'
import { Point, hexDirectionTo, hexDistance, hexInDirection, hexInDirectionDistance } from '../geometry.js'
import { ammoGetQuantity, ammoUseTopBox, findReloadAmmo, weaponReload } from '../weaponAmmo.js'
import { critterArtShouldRun } from '../pro.js'
import { critterSetWhoHitMe } from './whoHitMe.js'
import { dbg, eventLogPush } from '../logger.js'
import { getMessage } from '../util.js'
import { world } from '../state/world.js'
import { services } from '../state/services.js'
import { assets } from '../state/assets.js'
import { invenWield, invenWieldAnimated } from '../inventoryWield.js'
import { nextShootObstacle } from './lineOfFire.js'
import { pathfinderFindPathPoints } from '../map/pathfinder.js'
import { randomBetween } from '../random.js'
import { toTileNum } from '../tile.js'
import { uiLog } from '../messageLog.js'
import { useDrug } from '../drugs.js'
import { weaponAttackType } from './hitChance.js'
import {
    AiTurnState,
    HEALING_PIDS,
    actorName,
    aiCanUseItem,
    aiFindAmmo,
    ceItemType,
    combatDebug,
    defenderUnarmedNow,
    inventoryCopyOf,
} from './Combat.js'

export const combatAiActionMethods = {
    // CE combat_ai.cc _ai_try_attack — one pass of its attempt loop. 'acting': an
    // animation runs and re-enters; 'retry': try again at once; 'done': stop attacking.
    aiTryAttackStep(
        this: Combat,
        obj: Critter,
        target: Critter,
        st: AiTurnState,
        again: () => void,
        endTurn: () => void,
    ): 'acting' | 'retry' | 'done' {
        const packet = obj.ai!.packet
        const AP = obj.AP!
        if (!st.whoHitSet) {
            st.whoHitSet = true
            critterSetWhoHitMe(obj, target) // _critter_set_who_hit_me(attacker, defender)
            obj.aiLastTarget = target
            const r = this.aiWieldOrRetrieve(obj, target, again)
            if (r !== 'retry') return r
        }

        const wObj = obj.equippedWeapon
        const real = !!wObj && wObj.pid !== undefined
        const weapon: any = real ? wObj!.weapon : null
        // _ai_pick_hit_mode: primary or the secondary attack
        const prevMode = weapon?.mode
        if (weapon) {
            weapon.mode =
                this.aiPickHitMode(obj, wObj!, target) === 'secondary'
                    ? (Combat.secondaryModeName(weapon) ?? 'single')
                    : 'single'
        }
        // CE _ai_try_attack: the held weapon in the chosen hit mode is checked for the team's
        // safety (switching weapons if it would hurt a team-mate), and the attacker standing in
        // its own blast learns how far to step back (safeDistance)
        const safety = { safeDistance: 0 }
        if (weapon && !st.safetyChecked) {
            st.safetyChecked = true
            const mode: 'primary' | 'secondary' = weapon.usesSecondary?.() ? 'secondary' : 'primary'
            if (this.combatSafetyInvalidateWeapon(obj, wObj!, mode, target, true, safety)) {
                if (weapon && prevMode !== undefined) weapon.mode = prevMode
                const r = this.aiSwitchWeapons(obj, target, again)
                if (r !== 'fail') return r
            }
        }
        const minToHit = packet.minToHit
        const bad = this.checkBadShot(obj, target, false)
        const restore = () => {
            if (weapon && prevMode !== undefined && weapon.mode !== prevMode) weapon.mode = prevMode
        }

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
                if (safety.safeDistance > 0) {
                    // CE: _ai_move_away(attacker, defender, safeDistance) before the attack
                    if (
                        this.aiMoveAway(obj, target, safety.safeDistance, false, () => {
                            restore()
                            again()
                        })
                    )
                        return 'acting'
                }
                if (accuracy < minToHit) {
                    const noRange = this.getHitChance(obj, target, 'torso', obj.position, false).hit
                    if (noRange < minToHit) {
                        restore()
                        dbg('ai', `[AI] ${actorName(obj)}: FLEEING: Can't possibly Hit Target!`)
                        if (!this.aiRunAway(obj, target, endTurn)) return 'done'
                        return 'acting'
                    }
                    // Step along the path until the chance from a tile reaches min_to_hit.
                    const path = world.gMap!.recalcPath(obj.position, target.position, false, obj)
                    let steps = AP.getAvailableMoveAP()
                    if (path.length > 1) {
                        steps = 0
                        for (let i = 1; i < path.length - 1 && steps < AP.getAvailableMoveAP(); i++) {
                            steps++
                            const from = { x: path[i][0], y: path[i][1] }
                            if (this.getHitChance(obj, target, 'torso', from).hit >= minToHit) break
                        }
                    }
                    if (steps > 0) {
                        if (
                            this.aiMoveStepsCloser(obj, target, steps, true, () => {
                                restore()
                                again()
                            })
                        )
                            return 'acting'
                        // CE: _ai_move_steps_closer == -1 → "FLEEING: Can't possibly get closer"
                        restore()
                        dbg('ai', `[AI] ${actorName(obj)}: FLEEING: Can't possibly get closer to Target!`)
                        if (!this.aiRunAway(obj, target, endTurn)) return 'done'
                        return 'acting'
                    }
                }
                return this.aiAttack(obj, target, () => {
                    restore()
                    again()
                })
                    ? 'acting'
                    : (restore(), 'done')
            }
        }
    },
    // CE combat_ai.cc _ai_attack (+ _ai_called_shot): face the target, pick the hit
    // location, pay the AP and attack.
    aiAttack(this: Combat, obj: Critter, target: Critter, then: () => void): boolean {
        // CE _ai_attack: a fleeing critter doesn't attack (CRITTER_MANUEVER_FLEEING → −1)
        if (obj.fleeing) return false
        const wObj = obj.equippedWeapon
        const region = this.aiCalledShot(obj, target)
        const aimed = region !== 'torso'
        const cost = !wObj
            ? unarmedAPCost(obj, currentUnarmed(obj).mode, aimed)
            : wObj.weapon!.getAttackAPCost(obj, undefined, aimed)
        if (cost > obj.AP!.getAvailableCombatAP()) return false
        obj.AP!.subtractCombatAP(cost)
        dbg('ai', `[AI] ${actorName(obj)} → attack on ${actorName(target)} (${region}, AP cost: ${cost})`)
        eventLogPush({
            actor: actorName(obj),
            action: 'ai-decision',
            result: 'attack',
            target: actorName(target),
            distance: hexDistance(obj.position, target.position),
            AP: obj.AP!.getAvailableCombatAP(),
            weapon: wObj?.weapon?.name ?? null,
            region,
            message: `${actorName(obj)} attacks ${actorName(target)}`,
        })
        this.maybeTaunt(obj, 'attack')
        this.attack(obj, target, region, then)
        return true
    },
    // CE combat_ai.cc _ai_called_shot: with AP for the aimed attack and an aimable hit
    // mode, one in called_freq tries a random location if INT reaches 7 / 5 / 3 (easy /
    // normal / hard combat); below min_to_hit it stays on the torso.
    aiCalledShot(this: Combat, obj: Critter, target: Critter): string {
        const wObj = obj.equippedWeapon
        const packet = obj.ai!.packet
        const cost = !wObj
            ? unarmedAPCost(obj, currentUnarmed(obj).mode, true)
            : wObj.weapon!.getAttackAPCost(obj, undefined, true)
        if (cost > obj.AP!.getAvailableCombatAP()) return 'torso'
        const weapon: any = wObj?.weapon
        if (
            weapon &&
            wObj!.pid !== undefined &&
            !weapon.modes.includes(weapon.usesSecondary() ? 'secondaryCalled' : 'called')
        )
            return 'torso'
        if (randomBetween(1, packet.calledFreq) !== 1) return 'torso'
        const d = Config.combat.difficultyModifier
        const intRequired = d === 75 ? 7 : d === 125 ? 3 : 5
        if (obj.getStat('INT') < intRequired) return 'torso'
        const LOCATIONS = ['head', 'leftArm', 'rightArm', 'torso', 'rightLeg', 'leftLeg', 'eyes', 'groin', 'torso']
        const region = LOCATIONS[randomBetween(0, 8)]
        // CE calls _determine_to_hit(attacker, defender, hitMode, hitLocation) against its
        // (…, hitLocation, hitMode) signature — a vanilla bug kept: the chance tested is the
        // one for the location numbered like the hit mode (right-hand primary 2 = right arm,
        // secondary 3 = torso, a punch 4 = right leg)
        const hitModeIndex = !wObj || wObj.pid === undefined ? 4 : weapon.usesSecondary() ? 3 : 2
        if (this.getHitChance(obj, target, LOCATIONS[hitModeIndex]).hit < packet.minToHit) return 'torso'
        return region
    },
    // CE _ai_try_attack (weapon == nullptr) → _ai_switch_weapons: with nothing in hand
    // wield the best inventory weapon, else fetch one lying within reach.
    aiWieldOrRetrieve(this: Combat, obj: Critter, target: Critter, again: () => void): 'acting' | 'retry' | 'done' {
        const wielded = this.aiWieldInventoryWeapon(obj, target, again)
        if (wielded !== 'none') return wielded === 'animating' ? 'acting' : 'retry'
        const inHand = obj.equippedWeapon
        if (inHand && inHand.pid !== undefined) return 'retry'
        const defenderBiped = (target.pro?.extra?.bodyType ?? 0) === 0
        const defenderUnarmed = defenderUnarmedNow(target) // CE: the fid's weapon code is 0
        if (defenderBiped && defenderUnarmed && assets.imageInfo![obj.getBase() + 'ap']) return 'retry'
        const r = this.aiSwitchWeapons(obj, target, again)
        return r === 'fail' ? 'retry' : r
    },
    // CE combat_ai.cc _ai_switch_weapons: the best usable inventory weapon (AP checked),
    // else one from the floor (_ai_search_environ + _ai_retrieve_object), else the
    // fist if its AP fits.
    aiSwitchWeapons(this: Combat, obj: Critter, target: Critter, again: () => void): 'acting' | 'retry' | 'fail' {
        const best = Combat.aiSearchInvenWeap(obj, target)
        if (best) {
            obj.activeHand = 'rightHand'
            dbg('ai', `[AI] ${actorName(obj)} wields ${best.name} (CE _ai_switch_weapons)`)
            // _inven_wield(attacker, weapon, HAND_RIGHT): the put-away and take-out play first
            if (invenWieldAnimated(obj, best, 'rightHand', again)) return 'acting'
            return this.checkBadShot(obj, target, false) === 'notEnoughAp' ? 'fail' : 'retry'
        }
        const found = this.aiSearchEnviron(obj, 'weapon', target)
        if (found) {
            dbg('ai', `[AI] ${actorName(obj)} goes for ${found.name} on the floor`)
            // _ai_retrieve_object, then _inven_wield(attacker, weapon, HAND_RIGHT)
            const wield = (): void => {
                const got = inventoryCopyOf(obj, found)
                if (got) {
                    obj.activeHand = 'rightHand'
                    invenWield(obj, got, 'rightHand')
                }
                again()
            }
            if (this.aiRetrieveObject(obj, found, wield)) return 'acting'
        }
        // No weapon to switch to: CE goes on with HIT_MODE_PUNCH (weapon = nullptr) if a
        // punch is affordable — the item stays in the hand; DH2 punches with the free
        // hand for the rest of the turn (doAITurn restores the right hand next turn).
        // weaponGetActionPointCost(attacker, HIT_MODE_PUNCH, false)
        if (obj.AP!.getAvailableCombatAP() < unarmedAPCost(obj, PUNCH, false)) return 'fail'
        const a = obj
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
    },
    // CE _ai_try_attack, COMBAT_BAD_SHOT_NO_AMMO: reload from the inventory (reload AP,
    // READY sound, magic hands, "reloads the"), else fetch ammo from the floor, else
    // "is out of ammo for the", put the weapon away and switch weapons.
    aiNoAmmo(this: Combat, obj: Critter, wObj: Obj, target: Critter, again: () => void): 'acting' | 'retry' | 'done' {
        const ammo = aiFindAmmo(obj, wObj).ammo
        if (ammo) {
            this.aiReload(obj, wObj, ammo, again)
            return 'acting'
        }
        const floorAmmo = this.aiSearchEnviron(obj, 'ammo', target)
        if (floorAmmo && this.aiRetrieveObject(obj, floorAmmo, again)) return 'acting'
        const soundId = (wObj as any).pro?.extra?.soundID
        if (typeof soundId === 'number' && !window.__test?.fastMode) {
            services.audioEngine.playWeaponSfx(String.fromCharCode(soundId), 'empty', undefined, obj)
        }
        uiLog(`${obj.name} ${getMessage('misc', 5001) ?? 'is out of ammo for the'} ${wObj.name}.`)
        const a = obj as any
        for (const hand of ['leftHand', 'rightHand']) if (a[hand] === wObj) a[hand] = Critter.makeFist()
        obj.setIdleArt()
        const r = this.aiSwitchWeapons(obj, target, again)
        // _ai_magic_hands(attacker, weapon, 5001): the magic-hands anim goes with the line;
        // played here when the switch doesn't animate itself
        if (r === 'fail' && obj.hasAnimation('use') && !obj.inAnim()) obj.staticAnimation('use', () => obj.clearAnim())
        return r === 'fail' ? 'done' : r
    },
    aiReload(this: Combat, obj: Critter, wObj: Obj, ammo: Obj, then: () => void): void {
        // CE combat_ai.cc aiAttemptWeaponReload: one box; an emptied box is used up
        const before = ammoGetQuantity(wObj)
        if (weaponReload(wObj, ammo) === 0) ammoUseTopBox(ammo, obj.inventory)
        const loaded = ammoGetQuantity(wObj) - before
        const AP = obj.AP!
        const cost = (wObj as any).weapon?.getReloadAPCost?.() ?? 2
        if (AP.getAvailableCombatAP() < cost) AP.combat = 0
        else AP.subtractCombatAP(cost)
        const soundId = wObj.pro?.extra?.soundID
        if (typeof soundId === 'number' && !window.__test?.fastMode) {
            services.audioEngine.playWeaponSfx(String.fromCharCode(soundId), 'reload', undefined, obj)
        }
        combatDebug(`AI ${obj.name}: reloaded ${loaded} rounds`)
        this.aiMagicHands(obj, wObj, 5002, then)
    },
    // CE combat_ai.cc _ai_magic_hands: ANIM_MAGIC_HANDS_MIDDLE and "<name> <msg> <item>."
    aiMagicHands(this: Combat, obj: Critter, item: Obj | null, msgId: number, then: () => void): void {
        const msg = getMessage('misc', msgId)
        if (msg) uiLog(item ? `${obj.name} ${msg} ${item.name}.` : `${obj.name} ${msg}.`)
        if (obj.hasAnimation('use')) obj.staticAnimation('use', then)
        else then()
    },
    // CE combat_ai.cc _ai_check_drugs, one step per call (each drug is its own action).
    aiCheckDrugsStep(this: Combat, obj: Critter, st: AiTurnState, again: () => void): boolean {
        if ((obj.pro?.extra?.bodyType ?? 0) !== 0) return false // BODY_TYPE_BIPED
        const packet = obj.ai!.packet
        const AP = obj.AP!
        let hpRatio = 50
        let chance = 0
        // CE _combatNumTurns: completed combat rounds
        const turn = this.numTurns
        switch (packet.chemUse) {
            case 'clean':
                return false
            case 'stims_when_hurt_little':
                hpRatio = 60
                break
            case 'stims_when_hurt_lots':
                hpRatio = 30
                break
            case 'sometimes':
                if (turn % 3 === 0) chance = 25
                break
            case 'anytime':
                if (turn % 3 === 0) chance = 75
                break
            case 'always':
                chance = 100
                break
        }
        const maxHp = obj.getStat('Max HP') ?? obj.getStat('HP')
        // Healing items while HP is below the ratio.
        if (
            !st.healSearchDone &&
            obj.getStat('HP') < Math.trunc((maxHp * hpRatio) / 100) &&
            AP.getAvailableCombatAP() >= 2
        ) {
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
                    if (packet.chemUse === 'sometimes' || (packet.chemUse === 'anytime' && st.chemCount >= 2))
                        st.chemActive = false
                    this.aiUseDrug(obj, drug, again)
                    return true
                }
                st.chemActive = false
                st.healSearchDone = true
            }
        }
        // An item fetched last turn (aiInfoGetLastItem), or nothing usable carried: look
        // for a usable item on the floor.
        const last: Obj | null = obj.aiLastItem ?? null
        if (last && !world.gMap!.getObjects().includes(last)) obj.aiLastItem = null
        if ((obj.aiLastItem || (!st.drugUsed && st.healSearchDone)) && !st.envSearched) {
            st.envSearched = true
            const item =
                obj.aiLastItem ?? this.aiSearchEnviron(obj, 'drug', null) ?? this.aiSearchEnviron(obj, 'misc', null)
            obj.aiLastItem = null
            if (
                item &&
                this.aiRetrieveObject(obj, item, () => {
                    const got = inventoryCopyOf(obj, item)
                    if (got && got.subtype === 'drug' && obj.AP!.getAvailableCombatAP() >= 2) {
                        st.drugUsed = true
                        this.aiUseDrug(obj, got, again)
                    } else {
                        again()
                    }
                })
            )
                return true
        }
        return false
    },
    // _item_d_take_drug + _ai_magic_hands ("uses"), 2 AP.
    aiUseDrug(this: Combat, obj: Critter, drug: Obj, then: () => void): void {
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
    },
    // CE combat_ai.cc _ai_search_environ: the nearest item on the floor within PER + 5
    // of the given kind the critter can use (bipeds only).
    aiSearchEnviron(
        this: Combat,
        obj: Critter,
        kind: 'weapon' | 'ammo' | 'drug' | 'misc',
        target: Critter | null,
    ): Obj | null {
        if ((obj.pro?.extra?.bodyType ?? 0) !== 0) return null
        const gMap = world.gMap
        if (!gMap) return null
        const reach = obj.getStat('PER') + 5
        const items = gMap
            .getObjects()
            .filter((o) => o.type === 'item' && o.visible !== false && hexDistance(obj.position, o.position) <= reach)
            .sort((a, b) => hexDistance(obj.position, a.position) - hexDistance(obj.position, b.position))
        const packet = obj.ai!.packet
        const inHand = obj.equippedWeapon
        for (const item of items) {
            const type = ceItemType(item)
            if (kind === 'weapon' && type === 'weapon') {
                if (this.aiCanUseWeapon(obj, item)) return item
            } else if (kind === 'ammo' && item.subtype === 'ammo') {
                if (inHand && inHand.pid !== undefined && findReloadAmmo(inHand, [item])) return item
            } else if ((kind === 'drug' && type === 'drug') || (kind === 'misc' && type === 'misc')) {
                if (aiCanUseItem(obj, item, packet)) return item
            }
        }
        void target
        return null
    },
    // CE combat_ai.cc _ai_can_use_weapon (arms, attack FRM, skill, preferred type).
    aiCanUseWeapon(this: Combat, obj: Critter, item: Obj): boolean {
        const weapon: any = (item as any).weapon
        if (!weapon) return false
        if (obj.crippledLeftArm && obj.crippledRightArm) return false
        const twoHanded = ((item.pro?.extra?.weaponFlags ?? 0) & 0x02) !== 0
        if ((obj.crippledLeftArm || obj.crippledRightArm) && twoHanded) return false
        if (!assets.imageInfo![obj.getBase() + weapon.getAnim('attack')]) return false
        const packet = obj.ai!.packet
        if (obj.getSkill(weapon.weaponSkillType) < packet.minToHit) return false
        return (Combat.WEAP_PREF_ORDERINGS[packet.bestWeapon] ?? []).includes(weaponAttackType(item))
    },
    // CE combat_ai.cc _ai_retrieve_object (actionPickUp): walk to the item with this
    // turn's AP and pick it up; if it is out of reach this turn the walk still happens.
    aiRetrieveObject(this: Combat, obj: Critter, item: Obj, then: () => void): boolean {
        const gMap = world.gMap
        if (!gMap) return false
        const pick = (): void => {
            if (!gMap.getObjects().includes(item)) return then()
            const take = (): void => {
                obj.addInventoryItem(item, item.amount)
                gMap.destroyObject(item)
                if (!window.__test?.fastMode) services.audioEngine.playSfxByName('ipickup1')
                obj.clearAnim()
                then()
            }
            if (obj.hasAnimation('pickUp')) obj.staticAnimation('pickUp', take)
            else take()
        }
        if (hexDistance(obj.position, item.position) <= 1) {
            pick()
            return true
        }
        const AP = obj.AP!
        const steps = AP.getAvailableMoveAP()
        if (steps <= 0) return false
        const path = gMap.recalcPath(obj.position, item.position, false, obj)
        if (path.length === 0) return false
        const reach = path.length - 1 <= steps
        // (CE calls aiInfoSetLastItem here, which always stores nullptr — so an item not
        // reached this turn is not remembered; _ai_check_drugs searches again next turn)
        if (
            !obj.walkTo(
                item.position,
                false,
                () => {
                    obj.clearAnim()
                    if (reach) pick()
                    else then()
                },
                steps,
                path,
            )
        )
            return false
        if (AP.subtractMoveAP(obj.path.path.length - 1) === false) AP.combat = 0
        return true
    },
    // CE combat_ai.cc _ai_move_steps_closer: up to `steps` hexes toward the target (run
    // with at least half the max AP), not with distance 'stay', not past stay_close.
    aiMoveStepsCloser(
        this: Combat,
        obj: Critter,
        target: Critter,
        steps: number,
        taunt: boolean,
        then: () => void,
    ): boolean {
        if (steps <= 0) return false
        const packet = obj.ai!.packet
        if (packet.distance === 'stay') return false
        const player = world.player
        if (packet.distance === 'stay_close' && player && target !== player) {
            const d = hexDistance(obj.position, player.position)
            if (d > 5 && hexDistance(target.position, player.position) > 5 && d + steps > 5) return false
        }
        if (hexDistance(obj.position, target.position) <= 1) return false
        const AP = obj.AP!
        steps = Math.min(steps, AP.getAvailableMoveAP())
        const run = steps >= Math.trunc(obj.AP!.getMaxAP() / 2) && obj.canRun() && critterArtShouldRun(obj.art)
        // CE _ai_move_steps_closer: the "move" taunt comes first
        if (taunt) this.maybeTaunt(obj, 'move')
        const gMap = world.gMap!
        const elevation = obj.elevation ?? gMap.currentElevation
        // No path to the target's tile: the first critter in the way (_obj_ai_blocking_at's
        // _moveBlockObj) becomes the one to move to
        let goal: Critter = target
        if (gMap.recalcPath(obj.position, target.position, false, obj).length === 0) {
            const around = pathfinderFindPathPoints(obj, obj.position, target.position, false, 'ai')
            for (const [x, y] of around.slice(1)) {
                const c = gMap
                    .getObjects(elevation)
                    .find(
                        (o) =>
                            o.type === 'critter' &&
                            o !== obj &&
                            o !== target &&
                            !(o as Critter).dead &&
                            o.position.x === x &&
                            o.position.y === y,
                    ) as Critter | undefined
                if (c) {
                    goal = c
                    break
                }
            }
        }
        // _cai_retargetTileFromFriendlyFire on the original target's tile
        const tile = goal === target ? this.retargetTileFromFriendlyFire(obj, target, target.position) : goal.position
        // animationRegisterMoveToTile: onto the tile, a step short when it is occupied
        const path = gMap.recalcPath(obj.position, tile, false, obj)
        if (path.length === 0) return false
        if (gMap.blockingObjectAt(toTileNum(tile), elevation, 0, obj) !== null) path.pop()
        if (path.length < 2) return false
        const last = path[path.length - 1]
        if (!obj.walkTo({ x: last[0], y: last[1] }, run, then, steps, path)) return false
        eventLogPush({
            actor: actorName(obj),
            action: 'ai-decision',
            result: 'creep',
            target: actorName(goal),
            AP: AP.getAvailableMoveAP(),
            message: `${actorName(obj)} moves toward ${actorName(goal)}`,
        })
        if (AP.subtractMoveAP(obj.path.path.length - 1) === false) AP.combat = 0
        return true
    },
    // CE combat_ai.cc _ai_move_away: away from `from` (straight, or one rotation to
    // either side), at most `maxSteps` hexes, not with distance 'stay'.
    aiMoveAway(this: Combat, obj: Critter, from: Critter, maxSteps: number, run: boolean, then: () => void): boolean {
        if (obj.ai!.packet.distance === 'stay' && !run) return false
        // CE _ai_move_away: only when the other critter is within `a3` hexes
        if (!run && hexDistance(obj.position, from.position) > maxSteps) return false
        const AP = obj.AP!
        let steps = Math.min(maxSteps, AP.getAvailableMoveAP())
        const rotation = hexDirectionTo(from.position, obj.position)
        const gMap = world.gMap!
        for (; steps > 0; steps--) {
            for (const rot of [rotation, (rotation + 1) % 6, (rotation + 5) % 6]) {
                const dest = hexInDirectionDistance(obj.position, rot, steps)
                if (!dest || dest.x < 0 || dest.y < 0 || dest.x >= 200 || dest.y >= 200) continue
                const path = gMap.recalcPath(obj.position, dest, true, obj)
                if (path.length === 0) continue
                if (obj.walkTo(dest, run, then, steps, path)) {
                    if (AP.subtractMoveAP(obj.path.path.length - 1) === false) AP.combat = 0
                    return true
                }
            }
        }
        return false
    },
    // CE combat_ai.cc _ai_run_away: within max_dist of the threat the critter is
    // FLEEING and runs away with all its AP (taunt "run"); beyond it, it disengages.
    aiRunAway(this: Combat, obj: Critter, from: Critter | null, then: () => void): boolean {
        const threat = from ?? (world.player as Critter)
        if (!threat) return false
        const packet = obj.ai!.packet
        if (hexDistance(obj.position, threat.position) < packet.maxDist) {
            obj.fleeing = true
            this.maybeTaunt(obj, 'run')
            return this.aiMoveAway(obj, threat, obj.AP!.getAvailableMoveAP(), true, then)
        }
        obj.disengaging = true
        return false
    },
    // CE combat_ai.cc _cai_retargetTileFromFriendlyFire: if the critter stands in the
    // line of fire of a team-mate who rates at least as high and attacks the same target
    // (_cai_attackWouldIntersect), step aside: one hex to either side of that team-mate's
    // facing from `tile`, the free one nearest `tile`. Costs 2 INT per step (INT <= 0: none).
    retargetTileFromFriendlyFire(this: Combat, source: Critter, target: Critter | null, tile: Point): Point {
        if (!target || source.getStat('INT') <= 0) return tile
        const rating = this.combataiRating(source)
        const friends = this.combatants
            .filter(
                (c) =>
                    !c.dead &&
                    c !== source &&
                    c.teamNum === source.teamNum &&
                    c.aiLastTarget === target &&
                    this.combataiRating(c) >= rating,
            )
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
        const gMap = world.gMap!
        let best: Point | null = null
        for (const c of candidates) {
            if (gMap.blockingObjectAt(toTileNum(c), source.elevation, 0, null)) continue
            if (!best || hexDistance(tile, c) < hexDistance(tile, best)) best = c
        }
        return best ?? tile
    },
    // CE combat_ai.cc _cai_attackWouldIntersect: the attacker's shot at the defender would
    // first meet `friend`, or its spray / blast would catch a team-mate.
    attackWouldIntersect(this: Combat, attacker: Critter, defender: Critter, friend: Critter): boolean {
        const w = attacker.equippedWeapon
        if (!w || w.pid === undefined) return false
        if (this.attackRange(attacker, w) < 1) return false
        if (nextShootObstacle(attacker, attacker.position, defender.position, attacker) === friend) return true
        // _combatTestIncidentalHit(attacker, defender, friend, weapon)
        return this.combatSafetyInvalidateWeapon(attacker, w, 'primary', defender, false, undefined, friend)
    },
}
