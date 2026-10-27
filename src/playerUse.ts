// Copyright 2022 darkf
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { addFloatMessage } from './floatText.js'
import { ammoGetCapacity, ammoGetQuantity, ammoSetQuantity, weaponGetBurstRounds } from './weaponAmmo.js'
import { heart } from './heart.js'
import { toTileNum } from './tile.js'
import { hexDirectionTo, hexFromScreen, hexNeighbors, hexDistance, hexInDirection } from './geometry.js'
import globalState from './globalState.js'
import { dbg, dbgWarn } from './logger.js'
import { Critter, Obj } from './object.js'
import { getZoom } from './renderer.js'
import { Scripting } from './scripting.js'
import { Skills, SKILL_NAMES } from './skills.js'
import { skillUse } from './skillUse.js'
import { drawAP, uiCalledShot, uiCloseCalledShot, uiLog, uiLoot, UIMode } from './ui.js'
import { getMessage, getProtoMsg } from './util.js'
import { Config } from './config.js'
import { randomBetween } from './random.js'
import { uiSteal } from './ui_steal.js'
import { DAM_KNOCKED_OUT } from './combat/results.js'
import { currentUnarmed, unarmedAPCost } from './unarmed.js'
import { Combat } from './combat.js'
import { sfxBuildWeaponName } from './sfxNames.js'

// Return the skill ID used by the Fallout 2 engine
export function getSkillID(skill: Skills): number {
    switch (skill) {
        case Skills.SmallGuns:
            return 0
        case Skills.BigGuns:
            return 1
        case Skills.EnergyWeapons:
            return 2
        case Skills.Unarmed:
            return 3
        case Skills.MeleeWeapons:
            return 4
        case Skills.Throwing:
            return 5
        case Skills.FirstAid:
            return 6
        case Skills.Doctor:
            return 7
        case Skills.Sneak:
            return 8
        case Skills.Lockpick:
            return 9
        case Skills.Steal:
            return 10
        case Skills.Traps:
            return 11
        case Skills.Science:
            return 12
        case Skills.Repair:
            return 13
        case Skills.Speech:
            return 14
        case Skills.Barter:
            return 15
        case Skills.Gambling:
            return 16
        case Skills.Outdoorsman:
            return 17
    }
    dbgWarn('script', '[Skill] unimplemented skill %d', skill)
    return -1
}

// CE actions.cc actionUseSkill: the skills that can't be used in combat (proto.msg 902).
const NO_COMBAT_SKILLS = [
    Skills.FirstAid,
    Skills.Doctor,
    Skills.Lockpick,
    Skills.Steal,
    Skills.Traps,
    Skills.Science,
    Skills.Repair,
]

// CE actions.cc actionUseSkill target gates: First Aid / Doctor only on critters; Lockpick
// on items and scenery; Steal on items and critters, not oneself; Traps on anything but a
// critter; Science on anything that isn't a critter, a robot or a brahmin; Repair the
// same without the brahmin (sfall ScienceOnCritters at its default)
const KILL_TYPE_BRAHMIN = 5
const KILL_TYPE_ROBOT = 10
function skillTargetAllowed(skill: Skills, obj: Obj): boolean {
    const critter = obj.type === 'critter'
    switch (skill) {
        case Skills.FirstAid:
        case Skills.Doctor:
            return critter
        case Skills.Lockpick:
            return obj.type === 'item' || obj.type === 'scenery'
        case Skills.Steal:
            return (obj.type === 'item' || critter) && obj !== globalState.player
        case Skills.Traps:
            return !critter
        case Skills.Science:
        case Skills.Repair: {
            if (!critter) return true
            const kt = (obj as Critter).killType
            return kt === KILL_TYPE_ROBOT || (kt === KILL_TYPE_BRAHMIN && skill === Skills.Science)
        }
        default:
            return true
    }
}

// CE actions.cc actionUseSkill — who performs the player's skill: the party member best
// at it in the whole party (partyMemberGetBestInSkill, the player first so ties stay
// with the player), if it is also that member's own best skill
// (partyMemberGetBestSkill), it is standing or walking, and the skill isn't Steal. The
// member says a generic line (skill.msg 1000-1005); with the player right next to the
// target the player does it after all (1100-1104).
function skillPerformer(skill: Skills, target: Obj): Critter {
    const player = globalState.player as Critter
    if (skill === Skills.Steal || skill === Skills.Sneak) return player
    const skillName = SKILL_NAMES[skill - 1]
    let best: Critter | null = null
    let bestValue = 0
    for (const c of globalState.gParty?.getPartyMembersAndPlayer() ?? [player]) {
        if (!c || c.dead || c.visible === false) continue
        const v = c.getSkill(skillName)
        if (v > bestValue) {
            bestValue = v
            best = c
        }
    }
    if (!best || best === player) return player
    let ownBest = SKILL_NAMES[0]
    let ownValue = 0
    for (const sk of SKILL_NAMES) {
        const v = best.getSkill(sk)
        if (v > ownValue) {
            ownValue = v
            ownBest = sk
        }
    }
    if (ownBest !== skillName) return player
    if (best.anim && best.anim !== 'idle' && best.anim !== 'walk' && best.anim !== 'run') return player
    const nextToPlayer = hexDistance(player.position, target.position) <= 1
    const id = nextToPlayer ? 1100 + randomBetween(0, 4) : 1000 + randomBetween(0, 5)
    const line = getMessage('skill', id)
    if (line) {
        // textObjectAdd(partyMember, msg, 101, _colorTable[32747], _colorTable[0])
        addFloatMessage({
            msg: line,
            obj: best,
            startTime: window.performance.now(),
            color: '#ffff5a',
            outline: '#000000',
        })
    }
    if (nextToPlayer) return player
    best.clearAnim()
    return best
}

export function playerUseSkill(skill: Skills, obj: Obj, performer?: Critter): void {
    // FO2-CE ref: skill.cc skillUse() — engine handles the skill effect
    // Map enum to string name for the engine skillUse function
    const skillName = SKILL_NAMES[skill - 1] // Skills enum starts at 1 (SmallGuns=1)
    const skillId = getSkillID(skill)

    dbg(
        'script',
        `[Skill] playerUseSkill: ${skillName} (enum=${skill}, scriptId=${skillId}) on ${obj.name || obj.type || 'unknown'}`,
    )

    // CE proto_instance.cc _obj_use_skill_on: a jammed lock stops it before the script
    if (obj.jammed) {
        uiLog(getMessage('misc', 2001) ?? 'The lock is jammed.')
        return
    }

    // Non-passive target skills: try script override first, then engine fallback
    const target = obj as Critter
    let scriptHandled = false
    if (obj._script) {
        dbg('script', `[Skill] Object has script — trying Scripting.useSkillOn(skillId=${skillId})`)
        try {
            // CE _obj_use_skill_on: the target's use_skill_on_p_proc with the performer as source
            scriptHandled = Scripting.useSkillOn(performer ?? (globalState.player as Critter), skillId, obj)
        } catch (e) {
            dbgWarn('script', '[Skill] useSkillOn script error:', e)
        }
        dbg('script', `[Skill] Script handled: ${scriptHandled}`)
    } else {
        dbg('script', '[Skill] Object has no script — using engine fallback directly')
    }

    if (!scriptHandled) {
        // CE ref: actions.cc:1350,1428-1431 — Steal opens the interactive per-item UI.
        // CE inventory.cc:4510 inventoryOpenStealing: _gIsSteal needs critterIsActive, so dead
        // and knocked-out targets get a plain loot window.
        if (skillName === 'Steal') {
            const inactive = target.dead === true || ((target as Critter).injuryFlags & DAM_KNOCKED_OUT) !== 0
            if (obj.type === 'critter' && !inactive) {
                uiSteal(globalState.player as Critter, target)
            } else if (obj.type === 'critter') {
                uiLoot(obj)
            } else {
                uiLog('There is nothing to steal.')
            }
            return
        }

        const user: Critter = performer ?? (globalState.player as Critter)
        dbg('script', `[Skill] Engine fallback: skillUse("${skillName}") via ${user.name ?? 'player'}`)
        skillUse(user, target, skillName)
    }
}

// Cancel skill targeting mode: resets uiMode, skillMode, and cursor
export function cancelSkillTargeting(): void {
    globalState.skillMode = Skills.None
    globalState.uiMode = UIMode.none
    globalState.cursorMode = 'move'
    // Reset CSS cursor fallback on canvas
    const cnv = document.getElementById('cnv')
    if (cnv) cnv.style.cursor = ''
}

export function playerUse(obj: Obj | null) {
    const mousePos = heart.mouse.getPosition()
    // Undo zoom when mapping screen pixels to world coordinates, then hex.
    const z = getZoom()
    const mouseHex = hexFromScreen(
        mousePos[0] / z + globalState.cameraPosition.x,
        mousePos[1] / z + globalState.cameraPosition.y,
    )
    const who = <Critter>obj

    if (globalState.uiMode === UIMode.useSkill) {
        const skill = globalState.skillMode
        cancelSkillTargeting()

        // FO2-CE ref: skill.cc — First Aid/Doctor: clicking empty ground = apply to self
        if (!obj) {
            if (skill === Skills.FirstAid || skill === Skills.Doctor) {
                playerUseSkill(skill, globalState.player as unknown as Obj)
            }
            return
        }

        // CE actions.cc actionUseSkill: no First Aid, Doctor, Lockpick, Steal, Traps,
        // Science or Repair in combat.
        if (globalState.inCombat && NO_COMBAT_SKILLS.includes(skill)) {
            uiLog(getProtoMsg(902))
            return
        }
        // CE actionUseSkill: the target-type gates, before any walk (returns −1, no message)
        if (!skillTargetAllowed(skill, obj)) return
        const performer = skillPerformer(skill, obj)

        // CE actionUseSkill: ANIM_MAGIC_HANDS_GROUND on a prone critter, else _MIDDLE, then
        // _obj_use_skill_on
        const skillCallback = function () {
            performer.clearAnim()
            const prone = obj.type === 'critter' && ((obj as Critter).isKnockedDown || (obj as Critter).dead)
            const anim = prone ? 'pickUp' : 'use'
            if (performer.hasAnimation(anim)) {
                performer.staticAnimation(anim, () => {
                    performer.clearAnim()
                    playerUseSkill(skill, obj, performer)
                })
            } else {
                playerUseSkill(skill, obj, performer)
            }
        }

        if (Config.engine.doInfiniteUse === true || hexDistance(performer.position, obj.position) <= 1) {
            skillCallback()
            return
        }

        // CE actionUseSkill in combat: an AP-limited walk (no scenery AP cost).
        if (globalState.inCombat && performer.isPlayer) {
            performer.walkInFrontOfToAct(obj.position, skillCallback, 0)
            return
        }

        // Walk to the nearest reachable hex adjacent to the target (not the
        // target tile itself, which may be blocked by the scenery object).
        const neighbors = hexNeighbors(obj.position)
        const map = globalState.gMap!
        const playerPos = performer.position
        let dest: { x: number; y: number } | null = null
        let bestDist = Infinity
        for (const n of neighbors) {
            const path = map.recalcPath(playerPos, n)
            if (path.length > 0) {
                const d = hexDistance(playerPos, n)
                if (d < bestDist) {
                    bestDist = d
                    dest = n
                }
            }
        }
        if (dest) {
            // CE: run when the target is 5 or more hexes away (the dude too)
            const run = hexDistance(playerPos, obj.position) >= 5
            performer.walkTo(dest, run, skillCallback)
        } else {
            uiLog(getMessage('misc', 2000) ?? 'You cannot get there.') // CE actions.cc _is_next_to
        }

        return
    }

    if (obj === null) {
        // walk to the destination if there is no usable object
        // Walking in combat (TODO: This should probably be in Combat...)
        if (globalState.inCombat) {
            if (!(globalState.combat.inPlayerTurn || Config.combat.allowWalkDuringAnyTurn)) {
                dbg('combat', '[Combat] wait your turn')
                return
            }

            if (globalState.player.AP.getAvailableMoveAP() === 0) {
                uiLog(getProtoMsg(700)) // "You don't have enough action points."
                return
            }

            // CE animation.cc _check_move: Ctrl held keeps the AP for one attack in the
            // current hit mode; nothing left over, no move
            let maxWalkingDist = globalState.player.AP.getAvailableMoveAP()
            if (ctrlHeld) maxWalkingDist -= currentAttackAPCost()
            if (maxWalkingDist <= 0) return
            const run = moveClickRuns(toTileNum(mouseHex))
            if (run) globalState.player.stopSneakToRun() // CE _dude_run
            if (!globalState.player.walkTo(mouseHex, run, undefined, maxWalkingDist)) {
                dbg('map', '[Main] cannot walk there')
            } else {
                if (!globalState.player.AP.subtractMoveAP(globalState.player.path.path.length - 1)) {
                    throw new Error(
                        'subtraction issue: has AP: ' +
                            globalState.player.AP.getAvailableMoveAP() +
                            ' needs AP:' +
                            globalState.player.path.path.length +
                            ' and maxDist was:' +
                            maxWalkingDist,
                    )
                }
                drawAP(
                    globalState.player.AP.getAvailableCombatAP(),
                    globalState.player.AP.getTotalMaxAP(),
                    globalState.player.AP.move,
                )
            }
            return // (it fell through to the unlimited walk below before 2026-10-26)
        }

        // Walking out of combat
        // CE _check_move: without interrupt_walk the walk isn't cleared, so the new one
        // (ANIMATION_REQUEST_RESERVED on a busy dude) doesn't start
        if (!Config.engine.interruptWalk && (globalState.player.anim === 'walk' || globalState.player.anim === 'run'))
            return
        const run = moveClickRuns(toTileNum(mouseHex))
        if (run) globalState.player.stopSneakToRun() // CE _dude_run
        if (!globalState.player.walkTo(mouseHex, run)) {
            dbg('map', '[Main] cannot walk there')
        }

        return
    }

    if (obj.type === 'critter') {
        if (obj === globalState.player) {
            return
        } // can't use yourself

        if (globalState.inCombat && !who.dead) {
            // attack a critter
            if (!globalState.combat!.inPlayerTurn || globalState.player.inAnim()) {
                dbg('combat', "[Main] can't do that yet")
                return
            }

            // TODO: move within range of target

            const weapon = globalState.player.equippedWeapon

            // Determine AP cost for this attack up-front so we can guard before acting
            const unarmed = weapon === null ? currentUnarmed(globalState.player) : null
            const attackAPCost = currentAttackAPCost()

            // CE combat.cc _combat_attack_this → _combat_check_bad_shot: refuse with
            // combat.msg 100-106 (out of ammo, out of range, AP, aim blocked, crippled arms).
            const aimingNow = unarmed ? unarmed.aiming : weapon!.weapon!.isCalled()
            const bad = globalState.combat!.checkBadShot(globalState.player, <Critter>obj, aimingNow)
            if (bad !== 'ok') {
                const BAD_SHOT_MSG: { [k: string]: number } = {
                    noAmmo: 101,
                    outOfRange: 102,
                    notEnoughAp: 100,
                    aimBlocked: 104,
                    bothArmsCrippled: 105,
                    armCrippled: 106,
                }
                const id = BAD_SHOT_MSG[bad]
                if (id !== undefined) uiLog((getMessage('combat', id) ?? '').replace('%d', String(attackAPCost)))
                if (bad === 'noAmmo' && weapon) {
                    const sid = (weapon as any).pro?.extra?.soundID
                    if (typeof sid === 'number')
                        globalState.audioEngine.playWeaponSfx(String.fromCharCode(sid), 'empty')
                }
                return
            }

            if (weapon === null) {
                // Unarmed attack — an aimed punch/kick opens the called-shot window
                // (CE INTERFACE_ITEM_ACTION_PRIMARY_AIMING / SECONDARY_AIMING).
                const strike = (region: string) => {
                    globalState.player.AP!.subtractCombatAP(attackAPCost)
                    drawAP(
                        globalState.player.AP!.getAvailableCombatAP(),
                        globalState.player.AP!.getTotalMaxAP(),
                        globalState.player.AP!.move,
                    )
                    dbg('combat', `[Combat] player unarmed attack (${unarmed!.mode.name}, ${region})`)
                    globalState.combat!.attack(globalState.player, <Critter>obj, region)
                }
                if (unarmed!.aiming) {
                    const art = who.hasAnimation('called-shot')
                        ? who.getAnimation('called-shot')
                        : 'art/critters/hmjmpsna'
                    uiCalledShot(art, who, (region: string) => {
                        if (globalState.player.AP!.getAvailableCombatAP() < attackAPCost) {
                            uiLog(getProtoMsg(700)!)
                        } else {
                            strike(region)
                        }
                        uiCloseCalledShot()
                    })
                } else {
                    strike('torso')
                }
            } else {
                // Block attack (and AP deduction) if ranged weapon has no ammo
                if (ammoGetCapacity(weapon as any) > 0 && ammoGetQuantity(weapon as any) === 0) {
                    uiLog(getMessage('combat', 101) ?? 'Out of ammo.')
                    return
                }

                if (weapon.weapon!.isCalled()) {
                    let art = 'art/critters/hmjmpsna' // default art
                    if (who.hasAnimation('called-shot')) {
                        art = who.getAnimation('called-shot')
                    }

                    dbg('combat', '[Combat] called-shot art: %s', art)

                    uiCalledShot(art, who, (region: string) => {
                        const calledAPCost = attackAPCost
                        if (globalState.player.AP!.getAvailableCombatAP() < calledAPCost) {
                            uiLog(getProtoMsg(700)!) // "You don't have enough action points."
                            uiCloseCalledShot()
                            return
                        }
                        globalState.player.AP!.subtractCombatAP(calledAPCost)
                        drawAP(
                            globalState.player.AP!.getAvailableCombatAP(),
                            globalState.player.AP!.getTotalMaxAP(),
                            globalState.player.AP!.move,
                        )
                        dbg('combat', '[Combat] player attacks %s', region)
                        globalState.combat!.attack(globalState.player, <Critter>obj, region)
                        uiCloseCalledShot()
                    })
                } else if (weapon.weapon!.isBurst()) {
                    const burstAPCost = weapon.weapon!.getAttackAPCost(globalState.player, weapon.weapon!.slot()) // a primary burst (minigun) uses slot 1
                    if (globalState.player.AP!.getAvailableCombatAP() < burstAPCost) {
                        uiLog(getProtoMsg(700)!) // "You don't have enough action points."
                        return
                    }
                    globalState.player.AP!.subtractCombatAP(burstAPCost)
                    drawAP(
                        globalState.player.AP!.getAvailableCombatAP(),
                        globalState.player.AP!.getTotalMaxAP(),
                        globalState.player.AP!.move,
                    )
                    dbg('combat', '[Combat] burst fire at %s', who.name)
                    // Route through attack() which detects isBurst() and does the multi-roll loop
                    globalState.combat!.attack(globalState.player, <Critter>obj, 'torso')
                } else {
                    globalState.player.AP!.subtractCombatAP(attackAPCost)
                    drawAP(
                        globalState.player.AP!.getAvailableCombatAP(),
                        globalState.player.AP!.getTotalMaxAP(),
                        globalState.player.AP!.move,
                    )
                    dbg('combat', '[Combat] player attacks torso')
                    globalState.combat!.attack(globalState.player, <Critter>obj, 'torso')
                }
            }

            return
        }
    }

    const callback = function () {
        globalState.player.clearAnim()

        if (!obj) {
            throw Error()
        }

        // if there's an object under the cursor, use it
        if (obj.type === 'critter') {
            if (
                who.dead !== true &&
                globalState.inCombat !== true &&
                obj._script &&
                obj._script.talk_p_proc !== undefined
            ) {
                // talk to a critter
                dbg('dialogue', '[Dialog] talking to ' + who.name)
                if (!who._script) {
                    dbgWarn('dialogue', '[Dialog] obj has no script')
                    return
                }
                Scripting.talk(who._script, who)
            } else if (who.dead === true) {
                // loot a dead body — dead critters have no use_p_proc gate
                uiLoot(obj)
            } else {
                if (!globalState.inCombat && obj._script) Scripting.noteMissingProc(obj._script, 'talk_p_proc')
                dbg('map', '[Main] cannot talk to/loot that critter')
            }
        } else {
            obj.use(globalState.player)
        }
    }

    if (Config.engine.doInfiniteUse === true) {
        callback()
    } else {
        // CE _action_climb_ladder: a ladder up is climbed from its SE neighbour
        globalState.player.walkInFrontOfToAct(
            obj.position,
            callback,
            3,
            obj.isLadder && obj.pro?.extra?.subType === 3 ? hexInDirection(obj.position, 2) : undefined,
        )
    }
}

// CE game_mouse.cc:937 _gmouse_handle_event (move mode): the running preference, inverted
// while Shift is held
let shiftHeld = false
window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') shiftHeld = true
})
window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') shiftHeld = false
})
window.addEventListener('blur', () => {
    shiftHeld = false
})
let ctrlHeld = false
window.addEventListener('keydown', (e) => {
    if (e.key === 'Control') ctrlHeld = true
})
window.addEventListener('keyup', (e) => {
    if (e.key === 'Control') ctrlHeld = false
})
window.addEventListener('blur', () => {
    ctrlHeld = false
})

// CE animation.cc _dude_move: a second walk click on the same tile runs (lastDestination;
// a run click leaves it alone)
let lastMoveDest = -2
function moveClickRuns(tile: number): boolean {
    if (Config.engine.doAlwaysRun !== shiftHeld) return true
    if (lastMoveDest === tile) return true
    lastMoveDest = tile
    return false
}

// CE interfaceGetCurrentHitMode → itemGetActionPointCost: the AP of one attack with the
// dude's current hand and mode (primary / secondary, +1 aimed; unarmed: the punch / kick)
function currentAttackAPCost(): number {
    const player = globalState.player
    const weapon = player.equippedWeapon
    const unarmed = weapon === null ? currentUnarmed(player) : null
    if (unarmed) return unarmedAPCost(player, unarmed.mode, unarmed.aiming)
    return weapon!.weapon!.getAttackAPCost(player, undefined, weapon!.weapon!.isCalled())
}

export function changeCursor(_image: string) {
    // No-op: cursor is now rendered via WebGL based on cursorMode
}

// CE game_mouse.cc (CROSSHAIR) → combat.cc _combat_attack_this on a door: an attack like any
// other — the AP, range and ammo checks (combat.msg 100-102), the attack animation and sound,
// the rounds spent — but _apply_damage gives a non-critter no damage: the door's
// damage_p_proc runs (fixed_param = the attacker's own damage, 0 here; source the attacker,
// target the weapon) and its script decides. Out of combat the attack starts the fight first.
export function playerAttackDoor(door: Obj): void {
    const player = globalState.player
    if (!player || player.inAnim()) return
    if (!globalState.inCombat) {
        Combat.start(player)
        if (!globalState.inCombat) return
    }
    if (!globalState.combat!.inPlayerTurn) return
    const weapon = player.equippedWeapon
    const unarmed = weapon === null ? currentUnarmed(player) : null
    const apCost = unarmed
        ? unarmedAPCost(player, unarmed.mode, false)
        : weapon!.weapon!.getAttackAPCost(player, undefined, false)
    const ap = player.AP!
    if (ap.getAvailableCombatAP() < apCost) {
        uiLog((getMessage('combat', 100) ?? '').replace('%d', String(apCost)))
        return
    }
    const range = unarmed ? 1 : (weapon!.weapon!.getMaximumRange(weapon!.weapon!.usesSecondary() ? 2 : 1) ?? 1)
    if (hexDistance(player.position, door.position) > range) {
        uiLog(getMessage('combat', 102) ?? '')
        return
    }
    if (weapon && ammoGetCapacity(weapon as any) > 0 && ammoGetQuantity(weapon as any) === 0) {
        uiLog(getMessage('combat', 101) ?? '')
        return
    }
    ap.subtractCombatAP(apCost)
    drawAP(ap.getAvailableCombatAP(), ap.getTotalMaxAP(), ap.move)
    const dir = hexDirectionTo(player.position, door.position)
    if (dir !== null && dir !== undefined) player.orientation = dir
    const soundId = (weapon as any)?.pro?.extra?.soundID
    if (weapon && typeof soundId === 'number') {
        globalState.audioEngine.playSfxByName(
            sfxBuildWeaponName(1, weapon, !!weapon.weapon?.usesSecondary(), null).toLowerCase(),
            player,
        )
    }
    if (weapon && ammoGetCapacity(weapon as any) > 0) {
        const rounds = weapon.weapon?.isBurst?.()
            ? Math.min(ammoGetQuantity(weapon as any), weaponGetBurstRounds(weapon as any))
            : 1
        ammoSetQuantity(weapon as any, ammoGetQuantity(weapon as any) - rounds)
    }
    const hit = () => {
        if (door._script) Scripting.damage(door, weapon ?? player, player, 0)
    }
    if (player.hasAnimation('attack'))
        player.staticAnimation('attack', () => {
            player.clearAnim()
            hit()
        })
    else hit()
}
