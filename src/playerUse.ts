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

import { heart } from './heart.js'
import { hexFromScreen, hexNeighbors, hexDistance } from './geometry.js'
import globalState from './globalState.js'
import { dbg, dbgWarn } from './logger.js'
import { Critter, Obj } from './object.js'
import { getZoom } from './renderer.js'
import { Scripting } from './scripting.js'
import { Skills, SKILL_NAMES } from './skills.js'
import { skillUse } from './skillUse.js'
import {
    drawAP,
    drawHP,
    uiCalledShot,
    uiCloseCalledShot,
    uiLog,
    uiLoot,
    UIMode,
} from './ui.js'
import { getProtoMsg } from './util.js'
import { Config } from './config.js'
import { uiSteal } from './ui_steal.js'
import { getActiveUnarmedModeForHand } from './unarmed.js'

// Return the skill ID used by the Fallout 2 engine
export function getSkillID(skill: Skills): number {
    switch (skill) {
        case Skills.SmallGuns:     return 0
        case Skills.BigGuns:       return 1
        case Skills.EnergyWeapons: return 2
        case Skills.Unarmed:       return 3
        case Skills.MeleeWeapons:  return 4
        case Skills.Throwing:      return 5
        case Skills.FirstAid:      return 6
        case Skills.Doctor:        return 7
        case Skills.Sneak:         return 8
        case Skills.Lockpick:      return 9
        case Skills.Steal:         return 10
        case Skills.Traps:         return 11
        case Skills.Science:       return 12
        case Skills.Repair:        return 13
        case Skills.Speech:        return 14
        case Skills.Barter:        return 15
        case Skills.Gambling:      return 16
        case Skills.Outdoorsman:   return 17
    }
    dbgWarn('script', '[Skill] unimplemented skill %d', skill)
    return -1
}

export function playerUseSkill(skill: Skills, obj: Obj): void {
    // FO2-CE ref: skill.cc skillUse() — engine handles the skill effect
    // Map enum to string name for the engine skillUse function
    const skillName = SKILL_NAMES[skill - 1] // Skills enum starts at 1 (SmallGuns=1)
    const skillId = getSkillID(skill)

    dbg('script', `[Skill] playerUseSkill: ${skillName} (enum=${skill}, scriptId=${skillId}) on ${obj.name || obj.type || 'unknown'}`)

    // Non-passive target skills: try script override first, then engine fallback
    const target = obj as Critter
    let scriptHandled = false
    if (obj._script) {
        dbg('script', `[Skill] Object has script — trying Scripting.useSkillOn(skillId=${skillId})`)
        try {
            scriptHandled = Scripting.useSkillOn(globalState.player as Critter, skillId, obj)
        } catch (e) {
            dbgWarn('script', '[Skill] useSkillOn script error:', e)
        }
        dbg('script', `[Skill] Script handled: ${scriptHandled}`)
    } else {
        dbg('script', '[Skill] Object has no script — using engine fallback directly')
    }

    if (!scriptHandled) {
        // CE ref: actions.cc:1350,1428-1431 — Steal opens the interactive per-item UI.
        // Dead/knocked-out targets get free loot instead.
        if (skillName === 'Steal') {
            if (obj.type === 'critter' && target.dead !== true) {
                uiSteal(globalState.player as Critter, target)
            } else if (obj.type === 'critter') {
                uiLoot(obj)
            } else {
                uiLog('There is nothing to steal.')
            }
            return
        }

        // CE ref: actions.cc:1374 actionUseSkill — for First Aid and Doctor,
        // delegates to the party member with the highest skill if one beats
        // the player. Other skills always use the player.
        let user: Critter = globalState.player as Critter
        if (skillName === 'First Aid' || skillName === 'Doctor') {
            const playerSkill = user.getSkill(skillName)
            let best = user
            let bestSkill = playerSkill
            for (const member of globalState.gParty.party) {
                if (member.dead) continue
                const s = member.getSkill(skillName)
                if (s > bestSkill) { best = member; bestSkill = s }
            }
            if (best !== user) {
                uiLog(`${best.name} steps in to help.`)
                user = best
            }
        }
        dbg('script', `[Skill] Engine fallback: skillUse("${skillName}") via ${user.name ?? 'player'}`)
        const result = skillUse(user, target, skillName)
        uiLog(result.message)
        if (result.hpHealed > 0) {
            drawHP(globalState.player!.getStat('HP'))
        }
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
        mousePos[1] / z + globalState.cameraPosition.y
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

        const skillCallback = function () {
            globalState.player!.clearAnim()
            playerUseSkill(skill, obj)
        }

        if (Config.engine.doInfiniteUse === true || hexDistance(globalState.player!.position, obj.position) <= 1) {
            skillCallback()
            return
        }

        // Walk to the nearest reachable hex adjacent to the target (not the
        // target tile itself, which may be blocked by the scenery object).
        const neighbors = hexNeighbors(obj.position)
        const map = globalState.gMap!
        const playerPos = globalState.player!.position
        let dest: { x: number; y: number } | null = null
        let bestDist = Infinity
        for (const n of neighbors) {
            const path = map.recalcPath(playerPos, n)
            if (path.length > 0) {
                const d = hexDistance(playerPos, n)
                if (d < bestDist) { bestDist = d; dest = n }
            }
        }
        if (dest) {
            globalState.player!.walkTo(dest, Config.engine.doAlwaysRun, skillCallback)
        } else {
            uiLog("Can't reach that.")
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

            const maxWalkingDist = globalState.player.AP.getAvailableMoveAP()
            if (!globalState.player.walkTo(mouseHex, Config.engine.doAlwaysRun, undefined, maxWalkingDist)) {
                dbg('map', '[Main] cannot walk there')
            } else {
                if (!globalState.player.AP.subtractMoveAP(globalState.player.path.path.length - 1)) {
                    throw (
                        'subtraction issue: has AP: ' +
                        globalState.player.AP.getAvailableMoveAP() +
                        ' needs AP:' +
                        globalState.player.path.path.length +
                        ' and maxDist was:' +
                        maxWalkingDist
                    )
                }
                drawAP(globalState.player.AP.getAvailableMoveAP(), globalState.player.AP.getTotalMaxAP())
            }
        }

        // Walking out of combat
        if (!globalState.player.walkTo(mouseHex, Config.engine.doAlwaysRun)) {
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
            let attackAPCost: number
            if (weapon === null) {
                const p = globalState.player
                const unarmedSkill = p.getSkill('Unarmed')
                attackAPCost = getActiveUnarmedModeForHand(unarmedSkill, (p as any).activeHand ?? 'leftHand', globalState.punchModeIdx, globalState.kickModeIdx, !(p as any).leftHand?.weapon && !(p as any).rightHand?.weapon).apCost
            } else if (weapon.weapon!.isCalled()) {
                attackAPCost = weapon.weapon!.getAPCost(1) + 1
            } else if (weapon.weapon!.isBurst()) {
                attackAPCost = weapon.weapon!.getAPCost(2)
            } else {
                attackAPCost = weapon.weapon!.getAPCost(1)
            }

            if (globalState.player.AP!.getAvailableCombatAP() < attackAPCost) {
                uiLog(getProtoMsg(700)!) // "You don't have enough action points."
                return
            }

            if (weapon === null) {
                // Unarmed attack
                globalState.player.AP!.subtractCombatAP(attackAPCost)
                drawAP(globalState.player.AP!.getAvailableMoveAP(), globalState.player.AP!.getTotalMaxAP())
                dbg('combat', '[Combat] player unarmed attack')
                globalState.combat!.attack(globalState.player, <Critter>obj, 'torso')            } else {
            // Block attack (and AP deduction) if ranged weapon has no ammo
            const playerMaxAmmo: number = (weapon as any)?.pro?.extra?.maxAmmo ?? 0
            const playerRounds: number = (weapon as any)?.pro?.extra?.rounds ?? -1
            if (playerMaxAmmo > 0 && playerRounds === 0) {
                uiLog('You: out of ammo!')
                return
            }

            if (weapon.weapon!.isCalled()) {
                let art = 'art/critters/hmjmpsna' // default art
                if (who.hasAnimation('called-shot')) {
                    art = who.getAnimation('called-shot')
                }

                dbg('combat', '[Combat] called-shot art: %s', art)

                uiCalledShot(art, who, (region: string) => {
                    const calledAPCost = weapon.weapon!.getAPCost(1) + 1 // base weapon cost + 1 aiming surcharge
                    if (globalState.player.AP!.getAvailableCombatAP() < calledAPCost) {
                        uiLog(getProtoMsg(700)!) // "You don't have enough action points."
                        uiCloseCalledShot()
                        return
                    }
                    globalState.player.AP!.subtractCombatAP(calledAPCost)
                    drawAP(globalState.player.AP!.getAvailableMoveAP(), globalState.player.AP!.getTotalMaxAP())
                    dbg('combat', '[Combat] player attacks %s', region)
                    globalState.combat!.attack(globalState.player, <Critter>obj, region)
                    uiCloseCalledShot()
                })
            } else if (weapon.weapon!.isBurst()) {
                const burstAPCost = weapon.weapon!.getAPCost(2)
                if (globalState.player.AP!.getAvailableCombatAP() < burstAPCost) {
                    uiLog(getProtoMsg(700)!) // "You don't have enough action points."
                    return
                }
                globalState.player.AP!.subtractCombatAP(burstAPCost)
                drawAP(globalState.player.AP!.getAvailableMoveAP(), globalState.player.AP!.getTotalMaxAP())
                dbg('combat', '[Combat] burst fire at %s', who.name)
                // Route through attack() which detects isBurst() and does the multi-roll loop
                globalState.combat!.attack(globalState.player, <Critter>obj, 'torso')            } else {
                globalState.player.AP!.subtractCombatAP(attackAPCost)
                drawAP(globalState.player.AP!.getAvailableMoveAP(), globalState.player.AP!.getTotalMaxAP())
                dbg('combat', '[Combat] player attacks torso')
                globalState.combat!.attack(globalState.player, <Critter>obj, 'torso')            }
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
                dbg('map', '[Main] cannot talk to/loot that critter')
            }
        } else {
            obj.use(globalState.player)
        }
    }

    if (Config.engine.doInfiniteUse === true) {
        callback()
    } else {
        globalState.player.walkInFrontOf(obj.position, callback)
    }
}

export function changeCursor(_image: string) {
    // No-op: cursor is now rendered via WebGL based on cursorMode
}
