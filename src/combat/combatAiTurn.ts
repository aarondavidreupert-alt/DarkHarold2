// Combat: the AI's turn - picking a target, weapon and hit mode, taunts, when to join or stop,
// the end of its turn (CE combat_ai.cc _combat_ai, _ai_danger_source, _ai_pick_hit_mode).
// Methods of the Combat class, moved here verbatim and installed on its prototype by Combat.ts
// (wiki/code_quality.md Q16).

import { Combat } from './Combat.js'
import { Config } from '../config.js'
import { Critter, Obj } from '../object.js'
import { DAM_DEAD, DAM_KNOCKED_OUT } from './results.js'
import { Point, hexDistance } from '../geometry.js'
import * as Scripting from '../scripting.js'
import { addFloatMessage } from '../floatText.js'
import { ammoGetCapacity, ammoGetQuantity, weaponGetBurstRounds } from '../weaponAmmo.js'
import { canSee } from '../perception.js'
import { combatAiRating } from './whoHitMe.js'
import { combatIsShotBlocked } from './lineOfFire.js'
import { currentUnarmed, unarmedAPCost } from '../unarmed.js'
import { dbg, eventLogPush } from '../logger.js'
import { filterBadwordsText } from '../badwords.js'
import { getMessage } from '../util.js'
import { world } from '../state/world.js'
import { uiState } from '../state/uiState.js'
import { assets } from '../state/assets.js'
import { invenWieldAnimated } from '../inventoryWield.js'
import { objectDistance, weaponAttackType } from './hitChance.js'
import { randomBetween } from '../random.js'
import {
    AiTurnState,
    Attack,
    BadShot,
    actorName,
    aiHurtTooMuch,
    aiMinHp,
    attackTypeOf,
    combatWarn,
    defenderUnarmedNow,
    statRoll,
} from './Combat.js'

export const combatAiTurnMethods = {
    // CE combat_ai.cc _combat_ai_random_target: from a random start, the first other
    // combatant the attacker faces (_can_see) and could shoot (_combat_check_bad_shot).
    aiRandomTarget(this: Combat, a: Attack): Critter | null {
        const list = this.combatants.filter((c) => !c.dead)
        if (list.length === 0) return null
        const start = randomBetween(0, list.length - 1)
        for (let i = 0; i < list.length; i++) {
            const c = list[(start + i) % list.length]
            if (c === a.attacker || c === a.defender) continue
            if (!canSee(a.attacker, c)) continue
            if (this.checkBadShot(a.attacker, c, false) === 'ok') return c
        }
        return null
    },
    // CE combat_ai.cc _ai_try_attack → _ai_switch_weapons: with nothing in hand the AI
    // wields its best inventory weapon (_inven_wield, HAND_RIGHT). It keeps punching
    // only if the target is an unarmed biped it can punch (throw-punch FRM) and within
    // reach; out of reach CE switches too (COMBAT_BAD_SHOT_OUT_OF_RANGE, weapon ==
    // nullptr). 'animating' while _inven_wield's take-out plays (then `again`), 'wielded' when
    // the weapon is in hand at once, 'none' without a switch.
    aiWieldInventoryWeapon(
        this: Combat,
        attacker: Critter,
        defender: Critter,
        again: () => void,
    ): 'none' | 'wielded' | 'animating' {
        const inHand = attacker.equippedWeapon
        if (inHand && inHand.pid !== undefined) return 'none'
        const defenderBiped = (defender.pro?.extra?.bodyType ?? 0) === 0
        const defenderUnarmed = defenderUnarmedNow(defender) // CE: the fid's weapon code is 0
        const canPunch = !!assets.imageInfo![attacker.getBase() + 'ap']
        const punchRange = inHand?.weapon?.getMaximumRange(1) ?? 1
        const inReach = hexDistance(attacker.position, defender.position) <= punchRange
        if (defenderBiped && defenderUnarmed && canPunch && inReach) return 'none'
        const weapon = Combat.aiSearchInvenWeap(attacker, defender)
        if (!weapon) return 'none'
        attacker.activeHand = 'rightHand'
        dbg('ai', `[AI] ${actorName(attacker)} wields ${weapon.name} (CE _ai_switch_weapons)`)
        // _inven_wield(attacker, weapon, HAND_RIGHT), animated
        return invenWieldAnimated(attacker, weapon, 'rightHand', again) ? 'animating' : 'wielded'
    },
    // CE combat_ai.cc _ai_pick_hit_mode. DH2 weapons only expose a burst secondary,
    // so 'secondary' means burst.
    aiPickHitMode(this: Combat, attacker: Critter, weaponObj: Obj, defender: Critter): 'primary' | 'secondary' {
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
            try {
                return fn()
            } finally {
                weapon.mode = prev
            }
        }
        if (!withSecondary(() => !!assets.imageInfo![attacker.getAnimation('attack')])) return 'primary'

        const secondaryToHit = (): number => withSecondary(() => this.getHitChance(attacker, defender, 'torso').hit)
        const safe = () => !this.combatSafetyInvalidateWeapon(attacker, weaponObj, 'secondary', defender, false)
        const freq = Math.max(1, packet.secondaryFreq || 1)

        let useSecondary = false
        switch (packet.areaAttackMode) {
            case 'always':
                useSecondary = true
                break
            case 'sometimes':
                useSecondary = randomBetween(1, freq) === 1
                break
            case 'be_sure':
                useSecondary = secondaryToHit() >= 85 && safe()
                break
            case 'be_careful':
                useSecondary = secondaryToHit() >= 50 && safe()
                break
            case 'be_absolutely_sure':
                useSecondary = secondaryToHit() >= 95 && safe()
                break
            default: // no_pref (-1)
                if (attacker.getStat('INT') < 6 || hexDistance(attacker.position, defender.position) < 10) {
                    useSecondary = randomBetween(1, freq) === 1
                }
        }
        // CE _ai_pick_hit_mode: _caiHasWeapPrefType(ai, the secondary mode's attack type)
        const secondaryType = withSecondary(() => weaponAttackType(weaponObj))
        if (useSecondary && !(Combat.WEAP_PREF_ORDERINGS[packet.bestWeapon] ?? []).includes(secondaryType))
            useSecondary = false
        // SFALL fixes kept by CE: range and AP of the secondary mode.
        if (useSecondary && hexDistance(attacker.position, defender.position) > weapon.getMaximumRange(2))
            useSecondary = false
        if (useSecondary && (attacker.AP?.getAvailableCombatAP() ?? 0) < weapon.getAPCost(2)) useSecondary = false
        // CE: a throw (the spear's, the knife's) only with another weapon to fall back on, or
        // on a failed INT roll (statRoll <= ROLL_FAILURE)
        if (
            useSecondary &&
            secondaryType === 'throw' &&
            Combat.aiSearchInvenWeap(attacker, defender, false) === null &&
            statRoll(attacker, 4, 0)
        )
            useSecondary = false
        return useSecondary ? 'secondary' : 'primary'
    },
    // CE combat.cc _combat_safety_invalidate_weapon_func — true if the attack would
    // hurt the attacker's team: a blast weapon with a team-mate (or, without a safe-
    // distance out-param, the attacker) inside its radius, or a spray whose simulated
    // extras include a team-mate. The DR × (maxDmg - DT) test is CE's literal formula.
    // `withSafeDistance` mirrors CE passing safeDistancePtr: the attacker standing in its
    // own blast then isn't disqualifying (CE would step back first; DH2 doesn't).
    // `attackerFriend` (CE _combatTestIncidentalHit): a critter of any team that must not be
    // caught — inside the blast radius or among the spray's extras.
    combatSafetyInvalidateWeapon(
        this: Combat,
        attacker: Critter,
        weaponObj: Obj,
        hitMode: 'primary' | 'secondary',
        defender: Critter,
        withSafeDistance: boolean,
        out?: { safeDistance: number },
        attackerFriend: Critter | null = null,
    ): boolean {
        if (out) out.safeDistance = 0
        const weapon = (weaponObj as any).weapon
        if (!weapon) return false
        const team = attacker.teamNum
        const damageType = weapon.getDamageType()
        const maxDamage = weapon.maxDmg ?? 0
        const hurts = (c: Critter) => {
            const dt = c.getStat('DT ' + damageType) + c.getArmorDT(damageType)
            const dr = c.getStat('DR ' + damageType) + c.getArmorDR(damageType)
            return Math.trunc((dr * (maxDamage - dt)) / 100) > 0
        }
        const isTeamMate = (c: Critter) =>
            c.teamNum === team && c !== attacker && c !== defender && !c.dead && c !== c.whoHitMe

        // weaponGetDamageRadius: rockets (single-fire Explosive) 3, grenades 2.
        const attackType = weaponAttackType(weaponObj)
        let damageRadius = 0
        if (hitMode === 'primary' && attackType === 'ranged' && damageType === 'Explosive') damageRadius = 3
        else if (attackType === 'throw' && this.isExplosiveAttack(weaponObj, damageType)) damageRadius = 2

        if (damageRadius > 0) {
            const intelligence = attacker.getStat('INT')
            if (intelligence < 5) damageRadius = Math.max(0, damageRadius - (5 - intelligence))
            if (attackerFriend && hexDistance(defender.position, attackerFriend.position) < damageRadius) return true
            for (const c of this.combatants) {
                if (isTeamMate(c) && hexDistance(defender.position, c.position) < damageRadius && hurts(c)) return true
            }
            if (hexDistance(defender.position, attacker.position) <= damageRadius) {
                // CE: *safeDistancePtr = damageRadius - distance + 1 (the steps back to take)
                if (withSafeDistance) {
                    if (out) out.safeDistance = damageRadius - hexDistance(defender.position, attacker.position) + 1
                    return false
                }
                return true
            }
            return false
        }

        // only a burst / continuous attack sprays — CE checks the hit mode's anim, primary or secondary
        const slot = hitMode === 'secondary' ? 2 : 1
        const sprayMode = weapon.attackModeOf(slot)
        if (sprayMode !== 7 && sprayMode !== 8) return false
        const ammo = Math.min(ammoGetQuantity(weaponObj), weaponGetBurstRounds(weaponObj))
        const { extras } = this.computeSpray(attacker, defender, ammo, weapon.getMaximumRange(slot), sprayMode === 8)
        if (attackerFriend && extras.has(attackerFriend)) return true
        for (const c of extras.keys()) if (isTeamMate(c) && hurts(c)) return true
        return false
    },
    getCombatAIMessage(this: Combat, id: number) {
        const text = getMessage('combatai', id)
        return text === null ? null : filterBadwordsText(text) // CE combat_ai.cc:3572 messageListFilterBadwords
    },
    // CE combat_ai.cc _combatai_msg / _ai_print_msg — a floating line for run / move /
    // attack / miss / hit (hit by hit location): not for the player or a dead / knocked-
    // out critter, only with combat taunts on, d100 <= the packet's chance, and only
    // when no other floating text is showing.
    maybeTaunt(this: Combat, obj: Critter, type: 'run' | 'move' | 'attack' | 'miss' | 'hit', region?: string) {
        if (!obj || obj.type !== 'critter' || obj.isPlayer || !obj.ai) return
        if (!Config.ui.combatTaunts) return
        if ((obj.injuryFlags & (DAM_DEAD | DAM_KNOCKED_OUT)) !== 0 || obj.dead) return
        const packet = obj.ai.packet
        if (randomBetween(1, 100) > (packet.chance ?? 0)) return
        const LOCATION_KEYS: { [region: string]: string } = {
            head: 'hit_head',
            leftArm: 'hit_left_arm',
            rightArm: 'hit_right_arm',
            torso: 'hit_torso',
            rightLeg: 'hit_right_leg',
            leftLeg: 'hit_left_leg',
            eyes: 'hit_eyes',
            groin: 'hit_groin',
            uncalled: 'hit_torso',
        }
        const key = type === 'hit' ? (LOCATION_KEYS[region ?? 'torso'] ?? 'hit_torso') : type
        const range = packet.messageRanges[key]
        if (!range) return
        const [start, end] = range
        if (end < start) return
        const msg = this.getCombatAIMessage(randomBetween(start, end))
        if (!msg) return
        if (uiState.floatMessages.length > 0) return // _ai_print_msg: textObjectsGetCount() > 0
        // CE combat_ai.cc:3401 — the AI packet's font / color / outline_color
        // (ai.txt: 101, palette 58, palette 55 for every packet).
        addFloatMessage({
            msg,
            obj,
            startTime: window.performance.now(),
            color: '#e4d80c',
            outline: '#1c0c18',
        })
    },
    // CE combat_ai.cc _combatai_rating (combat/whoHitMe.ts): best of melee damage and the
    // wielded weapons' max damage, plus AC. (DH2 used HP + AC.)
    combataiRating(this: Combat, c: Critter): number {
        return combatAiRating(c)
    },
    findTarget(this: Combat, obj: Critter): Critter | null {
        // CE ref: combat_ai.cc _ai_danger_source / isWithinPerception
        // Target must be within PER*5 tiles with LOS, or PER*2 tiles without.
        const targets = this.combatants.filter(
            (x) => !x.dead && x.teamNum !== obj.teamNum && this.isWithinPerception(obj, x),
        )
        if (targets.length === 0) return null
        const attackWho = obj.ai?.packet.attackWho ?? 'closest'
        switch (attackWho) {
            // same order as CE _compare_strength / _compare_weakness (see aiDangerSource)
            case 'strongest':
                targets.sort((a, b) => this.combataiRating(a) - this.combataiRating(b))
                return targets[0]
            case 'weakest':
                targets.sort((a, b) => this.combataiRating(b) - this.combataiRating(a))
                return targets[0]
            case 'whomever':
            case 'whomever_attacking_me': {
                const whoHitMe = obj.whoHitMe
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
    },
    walkUpTo(
        this: Combat,
        obj: Critter,
        idx: number,
        target: Point,
        maxDistance: number,
        callback: () => void,
    ): boolean {
        // Walk up to `maxDistance` hexes, adjusting AP to fit
        if (obj.walkTo(target, false, callback, maxDistance)) {
            // OK
            if (obj.AP!.subtractMoveAP(obj.path.path.length - 1) === false)
                throw new Error(
                    'subtraction issue: has AP: ' +
                        obj.AP!.getAvailableMoveAP() +
                        ' needs AP:' +
                        obj.path.path.length +
                        ' and maxDist was:' +
                        maxDistance,
                )
            return true
        }

        return false
    },
    // ── CE combat_ai.cc _combat_ai ──────────────────────────────────────────────
    // One NPC turn. DH2 actions are asynchronous (animations), so CE's function runs as
    // phases across repeated doAITurn calls — every action's callback re-enters:
    //   start  — the flee test (CRITTER_MANUEVER_FLEEING, hurt_too_much, HP < min_hp)
    //   drugs  — _ai_check_drugs: healing items, chem use, items from the floor
    //   prefs  — _ai_danger_source + _cai_perform_distance_prefs
    //   attack — _ai_try_attack, at most 10 attempts (reload, switch weapons, move, attack)
    //   end    — disengage past max_dist, keep up with the team, extra-AP distance prefs
    doAITurn(this: Combat, obj: Critter, idx: number, depth: number): void {
        if (depth > Config.combat.maxAIDepth) {
            combatWarn(`Bailing out of ${depth}-deep AI turn recursion`)
            eventLogPush({ actor: actorName(obj), action: 'ai-bailout', depth, message: 'AI recursion bail-out' })
            return this.nextTurn()
        }
        const AP = obj.AP!
        const again = (): void => {
            obj.clearAnim()
            this.doAITurn(obj, idx, depth + 1)
        }
        const endTurn = (): void => {
            obj.clearAnim()
            this.nextTurn()
        }

        if (depth === 1) {
            obj._aiTurn = {
                phase: 'start',
                target: null,
                attempts: 0,
                drugUsed: false,
                healed: false,
                healSearchDone: false,
                envSearched: false,
                chemActive: null,
                chemCount: 0,
                endStep: 0,
                whoHitSet: false,
            } as AiTurnState
            dbg(
                'ai',
                `[AI] ${actorName(obj)} turn start — AP: ${AP.getAvailableCombatAP()}, packet: ${obj.ai?.packet.name ?? '?'}`,
            )
            // CE: a critter other than the player fights with its right-hand item
            const a = obj
            if (!obj.isPlayer && a.rightHand?.pid !== undefined && a.activeHand !== 'rightHand') {
                a.activeHand = 'rightHand'
                obj.setIdleArt()
            }
            // CE combat.cc _combat_turn: combat_p_proc once at the start of the turn
            if (Config.engine.doLoadScripts === true && obj._script !== undefined) {
                if (Scripting.combatEvent(obj, 'turnBegin') === true) return
                // CE combat.cc _combat_turn: script_overrides in that combat_p_proc takes the turn
                // over — no AI turn
                if (obj._script?._didOverride) return this.nextTurn()
            }
        }
        const st: AiTurnState = obj._aiTurn
        if (AP.getAvailableMoveAP() <= 0) return this.nextTurn()
        const packet = obj.ai!.packet

        switch (st.phase) {
            case 'start': {
                st.target = this.aiDangerSource(obj)
                const minHp = aiMinHp(obj, packet)
                if (obj.fleeing || aiHurtTooMuch(obj, packet) || obj.getStat('HP') < minHp) {
                    dbg('ai', `[AI] ${actorName(obj)}: FLEEING: I'm Hurt!`)
                    eventLogPush({
                        actor: actorName(obj),
                        action: 'ai-decision',
                        result: 'flee',
                        target: st.target ? actorName(st.target) : null,
                        hp: obj.getStat('HP'),
                        minHp,
                        message: `${actorName(obj)} flees`,
                    })
                    // CE _combat_ai(a1, a2): _ai_run_away(a1, a2), a2 being the attack_complex defender
                    // or null — and null means away from the dude (the companion runs from the player)
                    const fleeFrom = this.gcsd && this.gcsd.attacker === obj ? this.gcsd.defender : null
                    if (!this.aiRunAway(obj, fleeFrom, endTurn)) this.nextTurn()
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
    },
    // CE combat_ai.cc _ai_danger_source. A party member follows its attack_who (and
    // ignores fleeing critters unless berserk / charging); anyone else goes for whoever
    // hit it. Otherwise the critters that attacked it, its team or were hit by its
    // team, sorted by attack_who, the first one it perceives and can reach or shoot.
    // DH2: when none qualifies, the nearest perceived enemy (Combat.findTarget) — DH2
    // doesn't set whoHitMe for every way a fight can start.
    aiDangerSource(this: Combat, obj: Critter, fallback = true): Critter | null {
        const player = world.player
        if (!obj.ai) return null
        const party = !!world.gParty?.isPartyMember(obj)
        const packet = obj.ai!.packet
        const alive = (c: Critter | null | undefined): c is Critter =>
            !!c && c.type === 'critter' && !c.dead && ((c.injuryFlags ?? 0) & 0x01) === 0
        let attackWho: string | null = null
        let ignoreFleeing = false
        if (party) {
            attackWho = packet.attackWho
            ignoreFleeing =
                packet.disposition !== 'berserk' && packet.disposition !== 'none' && packet.distance !== 'charge'
            if (attackWho === 'whomever_attacking_me' && player) {
                const last = obj.aiLastTarget as Critter | undefined
                if (
                    alive(last) &&
                    last.teamNum !== obj.teamNum &&
                    last.aiLastTarget === player &&
                    !(ignoreFleeing && last.fleeing)
                )
                    return last
                const sorted = this.combatants.filter(
                    (c) =>
                        c !== obj &&
                        alive(c) &&
                        c.teamNum !== obj.teamNum &&
                        c.aiLastTarget === player &&
                        !(ignoreFleeing && c.fleeing),
                )
                sorted.sort((a, b) => hexDistance(obj.position, a.position) - hexDistance(obj.position, b.position))
                for (const c of sorted) {
                    if (
                        this.checkBadShot(obj, c, false) === 'ok' ||
                        world.gMap!.recalcPath(obj.position, c.position, false, obj).length > 0
                    )
                        return c
                }
            }
            if (attackWho === 'strongest' || attackWho === 'weakest' || attackWho === 'closest') obj.whoHitMe = null
        }

        const targets: (Critter | null)[] = [null, null, null, null]
        const whoHitMe: Critter | null = obj.whoHitMe ?? null
        if (whoHitMe && whoHitMe !== obj) {
            if (!whoHitMe.dead) {
                if (attackWho === 'whomever' || attackWho === null) return whoHitMe
            } else if (whoHitMe.teamNum !== obj.teamNum) {
                targets[0] = this.nearestOfTeam(obj, whoHitMe.teamNum)
            }
        }
        // aiFindAttackers: the one I attacked, my team's attacker, the one my team attacked
        const byDistance = this.combatants
            .slice()
            .sort((a, b) => hexDistance(obj.position, a.position) - hexDistance(obj.position, b.position))
        for (const c of byDistance) {
            if (c === obj) continue
            const hit: Critter | null = c.whoHitMe ?? null
            // CE aiFindAttackers: a dead team-mate still points at its killer (slot 2)
            if (!targets[1] && !c.dead && hit === obj) {
                targets[1] = c
                continue
            }
            if (
                !targets[2] &&
                c.teamNum === obj.teamNum &&
                hit &&
                hit !== obj &&
                hit.teamNum !== obj.teamNum &&
                !hit.dead
            ) {
                targets[2] = hit
                continue
            }
            if (!targets[3] && !c.dead && c.teamNum !== obj.teamNum && hit && hit.teamNum === obj.teamNum) {
                targets[3] = c
                continue
            }
        }
        const list = targets.filter((t): t is Critter => !!t && !(ignoreFleeing && t.fleeing))
        // CE _compare_strength sorts "strongest" by rating ascending and _compare_weakness
        // "weakest" descending — a vanilla oddity CE keeps (its comments say "melee then
        // ranged" / "ranged then melee")
        if (attackWho === 'strongest') list.sort((a, b) => this.combataiRating(a) - this.combataiRating(b))
        else if (attackWho === 'weakest') list.sort((a, b) => this.combataiRating(b) - this.combataiRating(a))
        else list.sort((a, b) => hexDistance(obj.position, a.position) - hexDistance(obj.position, b.position))
        for (const c of list) {
            if (!this.isWithinPerception(obj, c)) continue
            if (
                world.gMap!.recalcPath(obj.position, c.position, false, obj).length > 0 ||
                this.checkBadShot(obj, c, false) === 'ok'
            )
                return c
        }
        return fallback ? this.findTarget(obj) : null
    },
    // CE combat_ai.cc _combatai_want_to_join — a non-combatant joins when it took damage,
    // its combat_p_proc (fixed param 5) or an onlooker / friend notice made it ENGAGING,
    // or it has a danger source; not when hidden, elsewhere, out cold, disengaging or
    // fleeing.
    wantToJoin(this: Combat, c: Critter): boolean {
        const a = c
        if (c.visible === false || (((a.flags ?? 0) >>> 0) & 0x01) !== 0) return false // OBJECT_HIDDEN
        if (world.player && c.elevation !== world.player.elevation) return false
        if ((c.injuryFlags & (DAM_DEAD | DAM_KNOCKED_OUT)) !== 0 || c.dead) return false
        if ((a.damageLastTurn ?? 0) > 0) return true
        if (c._script?.combat_p_proc) Scripting.combatEvent(c, 'wantToJoin')
        if (a.engaging) return true
        if (a.disengaging || a.fleeing) return false
        return this.aiDangerSource(c, false) !== null
    },
    // CE combat_ai.cc _combatai_want_to_stop
    wantToStop(this: Combat, c: Critter): boolean {
        const a = c
        if (a.disengaging) return true
        if ((c.injuryFlags & (DAM_KNOCKED_OUT | DAM_DEAD)) !== 0 || c.dead) return true
        if (a.fleeing) return true
        const enemy = this.aiDangerSource(c, false)
        return enemy === null || !this.isWithinPerception(c, enemy)
    },
    // CE combat_ai.cc _combatai_notify_onlookers: whoever perceives the victim of an
    // attack becomes ENGAGING; seeing it die without seeing its killer marks a friendly
    // death to move away from.
    notifyOnlookers(this: Combat, victim: Critter): void {
        for (const c of this.combatants) {
            const a = c
            if (a.engaging || c === victim || c.isPlayer || c.dead) continue
            if (!this.isWithinPerception(c, victim)) continue
            a.engaging = true
            if (victim.dead && !this.isWithinPerception(c, victim.whoHitMe ?? null)) a.aiFriendlyDead = victim
        }
    },
    // CE combat_ai.cc _combatai_notify_friends: the player's team-mates who perceive the
    // player become ENGAGING.
    notifyFriends(this: Combat, who: Critter): void {
        for (const c of this.combatants) {
            const a = c
            if (a.engaging || c === who || c.dead || c.teamNum !== who.teamNum) continue
            if (this.isWithinPerception(c, who)) a.engaging = true
        }
    },
    // CE combat.cc _combat_check_bad_shot for the critter's current action.
    checkBadShot(this: Combat, attacker: Critter, defender: Critter, aiming: boolean): BadShot {
        if (defender.dead) return 'dead'
        const wObj = attacker.equippedWeapon
        const real = !!wObj && wObj.pid !== undefined
        if (real) {
            if (attacker.crippledLeftArm && attacker.crippledRightArm) return 'bothArmsCrippled'
            const twoHanded = ((wObj.pro?.extra?.weaponFlags ?? 0) & 0x02) !== 0 // WEAPON_TWO_HAND
            if ((attacker.crippledLeftArm || attacker.crippledRightArm) && twoHanded) return 'armCrippled'
        }
        const cost = !wObj
            ? unarmedAPCost(attacker, currentUnarmed(attacker).mode, aiming)
            : wObj.weapon!.getAttackAPCost(attacker, undefined, aiming)
        if (cost > (attacker.AP?.getAvailableCombatAP() ?? 0)) return 'notEnoughAp'
        const range = this.attackRange(attacker, wObj)
        if (range < objectDistance(attacker, attacker.position, defender)) return 'outOfRange' // objectGetDistanceBetween
        if (real && ammoGetCapacity(wObj) > 0 && ammoGetQuantity(wObj) === 0) return 'noAmmo'
        const at = attackTypeOf(wObj)
        if (
            (at === 'ranged' || at === 'throw' || range > 1) &&
            combatIsShotBlocked(attacker, attacker.position, defender.position, defender).blocked
        )
            return 'aimBlocked'
        return 'ok'
    },
    // CE combat_ai.cc _cai_perform_distance_prefs (sfall's snipe fix), ending with the
    // friendly-fire sidestep (_cai_retargetTileFromFriendlyFire on the critter's tile).
    aiDistancePrefs(this: Combat, obj: Critter, target: Critter | null, then: () => void): boolean {
        const AP = obj.AP!
        if (AP.getAvailableCombatAP() <= 0) return false
        const packet = obj.ai!.packet
        const player = world.player
        switch (packet.distance) {
            case 'stay_close':
                if (player && obj.whoHitMe !== player) {
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
                    if (
                        movementPoints + d - 1 < 5 &&
                        this.combataiRating(obj) < this.combataiRating(target) &&
                        this.aiMoveAway(obj, target, 10, false, then)
                    )
                        return true
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
    },
    // The tail of CE _combat_ai, step by step (each may start a move and re-enter):
    //   1. a live target beyond max_dist: move away from a dead friend, or join a friend
    //      within PER × 2 (_ai_find_friend), else disengage
    //   2. no target (not a party member) but hit this combat by someone still alive: move
    //      away from a dead friend, else run ("somebody is shooting at me")
    //   3. away from a friend who died for no visible reason, until 10 hexes apart
    //   4. no target: keep within reach of the team (party: by distance setting);
    //      otherwise spend leftover AP on the distance preferences
    aiEndOfTurn(this: Combat, obj: Critter, st: AiTurnState, then: () => void): boolean {
        const packet = obj.ai!.packet
        const target = st.target
        const AP = obj.AP!
        const a = obj as any
        const player = world.player
        const party = !!world.gParty?.isPartyMember(obj)
        const steps: (() => boolean)[] = [
            () => {
                if (
                    !target ||
                    target.dead ||
                    AP.getAvailableCombatAP() === 0 ||
                    hexDistance(obj.position, target.position) <= packet.maxDist
                )
                    return false
                const fd: Critter | null = a.aiFriendlyDead ?? null
                if (fd) {
                    a.aiFriendlyDead = null
                    return this.aiMoveAway(obj, fd, 10, false, then)
                }
                // CE _ai_find_friend(PER × 2, 5): a friend that near keeps it engaged; the
                // "move closer" there never runs (its step count, distance − 5, is computed
                // only when distance < 5)
                const friend = this.nearestOfTeamExcept(obj)
                const per = obj.getStat('PER')
                if (!friend || hexDistance(obj.position, friend.position) > per * 2) a.disengaging = true
                return false
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
                        const PARTY_DISTANCES: { [d: string]: number } = {
                            stay_close: 5,
                            charge: 7,
                            snipe: 7,
                            on_your_own: 7,
                            stay: 50000,
                        }
                        maxTeammateDistance = PARTY_DISTANCES[packet.distance] ?? 5
                    }
                } else {
                    // CE _ai_find_nearest_team_in_combat: a combatant team-mate someone hit
                    teammate = this.nearestOfTeamExcept(obj, true)
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
    },
    beginAITurn(this: Combat, critter: Critter): void {
        eventLogPush({
            actor: actorName(critter),
            action: 'turn-begin',
            AP: critter.AP!.getAvailableMoveAP(),
            HP: critter.getStat('HP'),
            message: `${actorName(critter)}: turn begins`,
        })
        this.doAITurn(critter, this.whoseTurn, 1)
    },
}
