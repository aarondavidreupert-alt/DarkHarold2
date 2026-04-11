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

import { HTMLAudioEngine, NullAudioEngine } from './audio.js'
import { Combat } from './combat.js'
import { critterKill } from './critter.js'
import { getElevator } from './data.js'
import { heart } from './heart.js'
import { hexesInRadius, hexFromScreen } from './geometry.js'
import globalState from './globalState.js'
import { IDBCache } from './idbcache.js'
import { initGame } from './init.js'
import { Critter, Obj } from './object.js'
import { getObjectUnderCursor, SCREEN_HEIGHT, SCREEN_WIDTH } from './renderer.js'
import { Scripting } from './scripting.js'
import { Skills } from './skills.js'
import {
    drawAP,
    drawHP,
    uiCalledShot,
    uiCloseCalledShot,
    uiContextMenu,
    uiElevator,
    uiHideCombatHover,
    uiHideContextMenu,
    uiInventoryScreen,
    uiLog,
    uiLoot,
    UIMode,
    uiSaveLoad,
    uiShowCombatHover,
    uiUpdateCombatAP,
    uiWorldMap,
} from './ui.js'
import { getFileJSON, getProtoMsg } from './util.js'
import { WebGLRenderer } from './webglrenderer.js'
import { Config } from './config.js'
import { fonUnpack } from './formats/fon.js'
import { Lightmap } from './lightmap.js'
import { togglePipBoy } from './pipboy.js'

// Return the skill ID used by the Fallout 2 engine
function getSkillID(skill: Skills): number {
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
    console.log('unimplemented skill %d', skill)
    return -1
}

// Is the skill passive (no target needed), or does it require a targeted object?
function isPassiveSkill(skill: Skills): boolean {
    switch (skill) {
        case Skills.Sneak:
        case Skills.FirstAid:
        case Skills.Doctor:
            return true
        default:
            return false
    }
}

function playerUseSkill(skill: Skills, obj: Obj): void {
    console.log('use skill %o on %o', skill, obj)

    if (!obj && !isPassiveSkill(skill)) {
        throw 'trying to use non-passive skill without a target'
    }

    if (!isPassiveSkill(skill)) {
        // use the skill on the object
        Scripting.useSkillOn(globalState.player, getSkillID(skill), obj)
    } else {
        console.log('passive skills are not implemented')
    }
}

export function playerUse(obj: Obj | null) {
    const mousePos = heart.mouse.getPosition()
    const mouseHex = hexFromScreen(
        mousePos[0] + globalState.cameraPosition.x,
        mousePos[1] + globalState.cameraPosition.y
    )
    const who = <Critter>obj

    if (globalState.uiMode === UIMode.useSkill) {
        // using a skill on object
        if (!obj) {
            return
        }
        try {
            playerUseSkill(globalState.skillMode, obj)
        } finally {
            globalState.skillMode = Skills.None
            globalState.uiMode = UIMode.none
        }

        return
    }

    if (obj === null) {
        // walk to the destination if there is no usable object
        // Walking in combat (TODO: This should probably be in Combat...)
        if (globalState.inCombat) {
            if (!(globalState.combat.inPlayerTurn || Config.combat.allowWalkDuringAnyTurn)) {
                console.log('Wait your turn.')
                return
            }

            if (globalState.player.AP.getAvailableMoveAP() === 0) {
                uiLog(getProtoMsg(700)) // "You don't have enough action points."
                return
            }

            const maxWalkingDist = globalState.player.AP.getAvailableMoveAP()
            if (!globalState.player.walkTo(mouseHex, Config.engine.doAlwaysRun, undefined, maxWalkingDist)) {
                console.log('Cannot walk there')
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
            console.log('Cannot walk there')
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
                console.log("You can't do that yet.")
                return
            }

            if (globalState.player.AP!.getAvailableCombatAP() < 4) {
                uiLog(getProtoMsg(700)!) // "You don't have enough action points."
                return
            }

            // TODO: move within range of target

            const weapon = globalState.player.equippedWeapon
            if (weapon === null) {
                console.log('You have no weapon equipped!')
                return
            }

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

                console.log('art: %s', art)

                uiCalledShot(art, who, (region: string) => {
                    const calledAPCost = weapon.weapon!.getAPCost(1) + 1 // base weapon cost + 1 aiming surcharge
                    if (globalState.player.AP!.getAvailableCombatAP() < calledAPCost) {
                        uiLog(getProtoMsg(700)!) // "You don't have enough action points."
                        uiCloseCalledShot()
                        return
                    }
                    globalState.player.AP!.subtractCombatAP(calledAPCost)
                    drawAP(globalState.player.AP!.getAvailableMoveAP(), globalState.player.AP!.getTotalMaxAP())
                    console.log('Attacking %s...', region)
                    globalState.combat!.attack(globalState.player, <Critter>obj, region)
                    uiCloseCalledShot()
                    uiUpdateCombatAP()
                })
            } else if (weapon.weapon!.isBurst()) {
                const burstAPCost = weapon.weapon!.getAPCost(2)
                if (globalState.player.AP!.getAvailableCombatAP() < burstAPCost) {
                    uiLog(getProtoMsg(700)!) // "You don't have enough action points."
                    return
                }
                globalState.player.AP!.subtractCombatAP(burstAPCost)
                drawAP(globalState.player.AP!.getAvailableMoveAP(), globalState.player.AP!.getTotalMaxAP())
                console.log('Burst fire at %s...', who.name)
                // Route through attack() which detects isBurst() and does the multi-roll loop
                globalState.combat!.attack(globalState.player, <Critter>obj, 'torso')
                uiUpdateCombatAP()
            } else {
                globalState.player.AP!.subtractCombatAP(4)
                drawAP(globalState.player.AP!.getAvailableMoveAP(), globalState.player.AP!.getTotalMaxAP())
                console.log('Attacking the torso...')
                globalState.combat!.attack(globalState.player, <Critter>obj, 'torso')
                uiUpdateCombatAP()
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
                console.log('Talking to ' + who.name)
                if (!who._script) {
                    console.warn('obj has no script')
                    return
                }
                Scripting.talk(who._script, who)
            } else if (who.dead === true) {
                // loot a dead body
                uiLoot(obj)
            } else {
                console.log('Cannot talk to/loot that critter')
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

window.onload = async function () {
    globalState.isInitializing = true

    globalState.$fpsOverlay = document.getElementById('fpsOverlay')

    const _v = '?v=' + Date.now()
    const fragment = await fetch('shaders/fragment.glsl' + _v)
    const fragmentLighting = await fetch('shaders/fragmentLighting.glsl' + _v)
    const vertex = await fetch('shaders/vertex.glsl' + _v)
    const fragmentFont = await fetch('shaders/fragmentFont.glsl' + _v)

    // initialize renderer
    globalState.renderer = new WebGLRenderer(
        {
            fragment: await fragment.text(),
            fragmentLighting: await fragmentLighting.text(),
            vertex: await vertex.text(),
            fragmentFont: await fragmentFont.text(),
        },
        await Promise.all([0, 1, 2, 3, 5].map((i) => fonUnpack(`data/font${i}.fon`)))
    )

    globalState.renderer.init()

    // initialize audio engine
    if (Config.engine.doAudio) {
        globalState.audioEngine = new HTMLAudioEngine()
    } else {
        globalState.audioEngine = new NullAudioEngine()
    }

    // initialize cached data

    function cachedJSON(key: string, path: string, callback: (value: any) => void): void {
        // load data from cache if possible, else load and cache it
        IDBCache.get(key, (value) => {
            if (value) {
                console.log('[Main] %s loaded from cache DB', key)
                callback(value)
            } else {
                value = getFileJSON(path)
                IDBCache.add(key, value)
                console.log('[Main] %s loaded and cached', key)
                callback(value)
            }
        })
    }

    IDBCache.init(() => {
        cachedJSON('imageMap', 'art/imageMap.json', (value) => {
            globalState.imageInfo = value

            cachedJSON('proMap', 'proto/pro.json', (value) => {
                globalState.proMap = value

                // continue initialization
                initGame()
                globalState.isInitializing = false

                // debug exposure for console inspection
                ;(window as any).debugLightmap = Lightmap
                ;(window as any).debugRenderer = globalState.renderer
                ;(window as any).debugGlobalState = globalState
            })
        })
    })

    heart._init()

    ;(window as any).toggleFloorLighting = () => {
        Config.engine.doFloorLighting = !Config.engine.doFloorLighting
        console.log('Floor lighting:', Config.engine.doFloorLighting)
    }

    ;(window as any).setLightingMode = (mode: 'gpu' | 'cpu') => {
        Config.engine.floorLightingMode = mode
        ;(globalState.renderer as WebGLRenderer).setLightingMode(mode)
        console.log('[Lighting] switched to:', mode)
    }
}

heart.mousepressed = (x: number, y: number, btn: string) => {
    if (globalState.isInitializing || globalState.isLoading || globalState.isWaitingOnRemote) {
        return
    } else if (btn === 'l') {
        if (globalState.cursorMode === 'command') {
            // open context menu immediately on any object under cursor
            const obj = getObjectUnderCursor((_: Obj) => true)
            if (obj) {
                uiContextMenu(obj, { clientX: x, clientY: y })
            }
        } else if (globalState.cursorMode === 'attack') {
            // only attack if there's a valid target — no walking fallthrough
            const target = getObjectUnderCursor((_: Obj) => true)
            if (target && target !== globalState.player) {
                playerUse(target)
            }
        } else {
            playerUse(getObjectUnderCursor((obj) => obj.isSelectable))
        }
    } else if (btn === 'r') {
        if (globalState.cursorMode === 'move') {
            // move (hex) → command (arrow)
            globalState.cursorMode = 'command'
            globalState.showLookCursor = false
            if (globalState.commandModeTimer !== null) clearTimeout(globalState.commandModeTimer)
            globalState.commandModeTimer = window.setTimeout(() => {
                globalState.showLookCursor = true
                const hoverObj = getObjectUnderCursor((_: Obj) => true)
                if (hoverObj) {
                    uiLog('You see: ' + hoverObj.getName())
                }
            }, 1000)
        } else if (globalState.cursorMode === 'command') {
            // command (arrow) → attack (crosshair)
            globalState.cursorMode = 'attack'
            globalState.showLookCursor = false
            if (globalState.commandModeTimer !== null) {
                clearTimeout(globalState.commandModeTimer)
                globalState.commandModeTimer = null
            }
        } else if (globalState.cursorMode === 'attack') {
            // attack (crosshair) → back to move (hex)
            globalState.cursorMode = 'move'
            globalState.showLookCursor = false
            if (globalState.commandModeTimer !== null) {
                clearTimeout(globalState.commandModeTimer)
                globalState.commandModeTimer = null
            }
        }
    }
}

heart.mousereleased = (_x: number, _y: number, btn: string) => {
    // If released on the canvas while context menu is open (no button selected), close + move mode
    if (btn === 'l' && globalState.uiMode === UIMode.contextMenu) {
        uiHideContextMenu()
    }
}

heart.mousemoved = (x: number, y: number) => {
    globalState.cursorPos = { x, y }

    // Reset look-cursor timer on movement in command mode
    if (globalState.cursorMode === 'command') {
        globalState.showLookCursor = false
        if (globalState.commandModeTimer !== null) clearTimeout(globalState.commandModeTimer)
        globalState.commandModeTimer = window.setTimeout(() => {
            globalState.showLookCursor = true
            const hoverObj = getObjectUnderCursor((_: Obj) => true)
            if (hoverObj) {
                uiLog('You see: ' + hoverObj.getName())
            }
        }, 1000)
    }

    // Scroll interrupts any mode; HUD/move only apply when not in command/attack
    const SCROLL_PAD = Config.ui.scrollPadding
    const anyScroll =
        y <= SCROLL_PAD ||
        y >= SCREEN_HEIGHT - SCROLL_PAD ||
        x <= SCROLL_PAD ||
        x >= SCREEN_WIDTH - SCROLL_PAD

    if (anyScroll) {
        if (globalState.cursorMode !== 'scroll') {
            globalState.preScrollCursorMode = globalState.cursorMode
        }
        globalState.cursorMode = 'scroll'
    } else if (globalState.cursorMode === 'scroll') {
        // leaving scroll zone — restore whatever was active before (move, command, attack, …)
        globalState.cursorMode = globalState.preScrollCursorMode
    } else if (globalState.cursorMode !== 'command' && globalState.cursorMode !== 'attack') {
        // move / interface: re-evaluate based on HUD / dialogue position
        const barEl = document.getElementById('bar')
        const barRect = barEl?.getBoundingClientRect()
        const inHUD =
            barRect != null &&
            x >= barRect.left && x <= barRect.right &&
            y >= barRect.top && y <= barRect.bottom

        const dialogueEl = document.getElementById('dialogueContainer')
        const dialogueRect = dialogueEl?.getBoundingClientRect()
        const inDialogueArea =
            dialogueEl?.style.visibility === 'visible' &&
            dialogueRect !== undefined &&
            x >= dialogueRect.left && x <= dialogueRect.right &&
            y >= dialogueRect.top && y <= dialogueRect.bottom

        if (inHUD || inDialogueArea) {
            globalState.cursorMode = 'interface'
        } else {
            globalState.cursorMode = 'move'
        }
    }
}

heart.keydown = (k: string) => {
    if (globalState.isLoading === true) {
        return
    }
    const mousePos = heart.mouse.getPosition()
    const mouseHex = hexFromScreen(
        mousePos[0] + globalState.cameraPosition.x,
        mousePos[1] + globalState.cameraPosition.y
    )

    if (k === Config.controls.cameraDown) {
        globalState.cameraPosition.y += 15
    }
    if (k === Config.controls.cameraRight) {
        globalState.cameraPosition.x += 15
    }
    if (k === Config.controls.cameraLeft) {
        globalState.cameraPosition.x -= 15
    }
    if (k === Config.controls.cameraUp) {
        globalState.cameraPosition.y -= 15
    }
    if (k === Config.controls.elevationDown) {
        if (globalState.currentElevation - 1 >= 0) {
            globalState.gMap.changeElevation(globalState.currentElevation - 1, true)
        }
    }
    if (k === Config.controls.elevationUp) {
        if (globalState.currentElevation + 1 < globalState.gMap.numLevels) {
            globalState.gMap.changeElevation(globalState.currentElevation + 1, true)
        }
    }
    if (k === Config.controls.showRoof) {
        Config.ui.showRoof = !Config.ui.showRoof
    }
    if (k === Config.controls.showFloor) {
        Config.ui.showFloor = !Config.ui.showFloor
    }
    if (k === Config.controls.showObjects) {
        Config.ui.showObjects = !Config.ui.showObjects
    }
    if (k === Config.controls.showWalls) {
        Config.ui.showWalls = !Config.ui.showWalls
    }
    if (k === Config.controls.talkTo) {
        const critter = globalState.gMap.critterAtPosition(mouseHex)
        if (critter) {
            if (critter._script && critter._script.talk_p_proc !== undefined) {
                console.log('talking to ' + critter.name)
                Scripting.talk(critter._script, critter)
            }
        }
    }
    if (k === Config.controls.inspect) {
        globalState.gMap.getObjects().forEach((obj, idx) => {
            if (obj.position.x === mouseHex.x && obj.position.y === mouseHex.y) {
                const hasScripts =
                    (obj.script !== undefined ? 'yes (' + obj.script + ')' : 'no') +
                    ' ' +
                    (obj._script === undefined ? 'and is NOT loaded' : 'and is loaded')
                console.log(
                    'object is at index ' +
                        idx +
                        ', of type ' +
                        obj.type +
                        ', has art ' +
                        obj.art +
                        ', and has scripts? ' +
                        hasScripts +
                        ' -> %o',
                    obj
                )
            }
        })
    }
    if (k === Config.controls.moveTo) {
        globalState.player.walkTo(mouseHex)
    }
    if (k === Config.controls.runTo) {
        globalState.player.walkTo(mouseHex, true)
    }
    if (k === Config.controls.attack) {
        if (!globalState.inCombat || !globalState.combat.inPlayerTurn || globalState.player.anim !== 'idle') {
            console.log("You can't do that yet.")
            return
        }

        if (globalState.player.AP.getAvailableCombatAP() < 4) {
            uiLog(getProtoMsg(700))
            return
        }

        for (let i = 0; i < globalState.combat!.combatants.length; i++) {
            if (
                globalState.combat.combatants[i].position.x === mouseHex.x &&
                globalState.combat.combatants[i].position.y === mouseHex.y &&
                !globalState.combat.combatants[i].dead
            ) {
                globalState.player.AP.subtractCombatAP(4)
                drawAP(globalState.player.AP.getAvailableMoveAP(), globalState.player.AP.getTotalMaxAP())
                console.log('Attacking...')
                globalState.combat.attack(globalState.player, globalState.combat.combatants[i])
                break
            }
        }
    }

    if (k === Config.controls.combat) {
        if (!Config.engine.doCombat) {
            return
        }
        if (globalState.inCombat === true && globalState.combat.inPlayerTurn === true) {
            console.log('[TURN]')
            globalState.combat.nextTurn()
        } else if (globalState.inCombat === true) {
            console.log('Wait your turn...')
        } else {
            console.log('[COMBAT BEGIN]')
            globalState.inCombat = true
            globalState.combat = new Combat(globalState.gMap.getObjects())
            globalState.combat.nextTurn()
        }
    }

    if (k === Config.controls.playerToTargetRaycast) {
        const obj = globalState.gMap.objectsAtPosition(mouseHex)[0]
        if (obj !== undefined) {
            const hit = globalState.gMap.hexLinecast(globalState.player.position, obj.position)
            if (!hit) {
                return
            }
            console.log('hit obj: ' + hit.art)
        }
    }

    if (k === Config.controls.showTargetInventory) {
        const obj = globalState.gMap.objectsAtPosition(mouseHex)[0]
        if (obj !== undefined) {
            console.log('PID: ' + obj.pid)
            console.log('inventory: ' + JSON.stringify(obj.inventory))
            uiLoot(obj)
        }
    }

    if (k === Config.controls.use) {
        const objs = globalState.gMap.objectsAtPosition(mouseHex)
        for (let i = 0; i < objs.length; i++) {
            objs[i].use()
        }
    }

    if (k === 'h') {
        globalState.player.move(mouseHex)
    }

    if (k === Config.controls.kill) {
        const critter = globalState.gMap.critterAtPosition(mouseHex)
        if (critter) {
            critterKill(critter, globalState.player)
        }
    }

    if (k === Config.controls.worldmap) {
        uiWorldMap()
    }

    if (k === Config.controls.pipboy) {
        togglePipBoy()
    }

    if (k === Config.controls.saveKey) {
        uiSaveLoad(true)
    }

    if (k === Config.controls.loadKey) {
        uiSaveLoad(false)
    }

    if (k === Config.controls.inventory) {
        if (globalState.uiMode === UIMode.inventory) {
            globalState.uiMode = UIMode.none
            document.getElementById('inventoryBox')!.style.visibility = 'hidden'
            globalState.player.clearAnim()
        } else {
            uiInventoryScreen()
        }
    }

    //if(k == calledShotKey)
    //	uiCalledShot()

    //if(k == 'a')
    //	Worldmap.checkEncounters()
}

function changeCursor(_image: string) {
    // No-op: cursor is now rendered via WebGL based on cursorMode
}

heart.update = function () {
    if (globalState.isInitializing || globalState.isWaitingOnRemote) {
        return
    } else if (globalState.isLoading) {
        if (globalState.loadingAssetsLoaded === globalState.loadingAssetsTotal) {
            globalState.isLoading = false
            if (globalState.loadingLoadedCallback) {
                globalState.loadingLoadedCallback()
            }
        } else {
            return
        }
    }

    if (globalState.uiMode !== UIMode.none) {
        return
    }
    const time = window.performance.now()

    if (time - globalState.lastFPSTime >= 500) {
        globalState.$fpsOverlay.textContent = 'fps: ' + heart.timer.getFPS()
        globalState.lastFPSTime = time

        if (globalState.lastUpdateTime != undefined) {
            globalState.$fpsOverlay.textContent += ' update: ' + globalState.lastUpdateTime + 'ms'
        }

        if (globalState.lastDrawTime) {
            globalState.$fpsOverlay.textContent += ' draw: ' + globalState.lastDrawTime + 'ms'
        }
    }

    if (globalState.gameHasFocus) {
        const mousePos = heart.mouse.getPosition()
        if (mousePos[0] <= Config.ui.scrollPadding) {
            globalState.cameraPosition.x -= 15
        }
        if (mousePos[0] >= SCREEN_WIDTH - Config.ui.scrollPadding) {
            globalState.cameraPosition.x += 15
        }

        if (mousePos[1] <= Config.ui.scrollPadding) {
            globalState.cameraPosition.y -= 15
        }
        if (mousePos[1] >= SCREEN_HEIGHT - Config.ui.scrollPadding) {
            globalState.cameraPosition.y += 15
        }

        if (time >= globalState.lastMousePickTime + 750) {
            // every .75 seconds, check the object under the cursor
            globalState.lastMousePickTime = time

            const obj = getObjectUnderCursor((obj) => obj.isSelectable)
            if (obj !== null) {
                changeCursor('pointer')
                // Show combat hover info for critters during combat
                if (globalState.inCombat && obj instanceof Critter && !obj.dead) {
                    uiShowCombatHover(obj as Critter, globalState.cursorPos.x, globalState.cursorPos.y)
                } else {
                    uiHideCombatHover()
                }
            } else {
                changeCursor('auto')
                uiHideCombatHover()
            }
        }

    }

    // Expire old float messages regardless of focus state
    for (let i = 0; i < globalState.floatMessages.length; i++) {
        if (time >= globalState.floatMessages[i].startTime + 1000 * Config.ui.floatMessageDuration) {
            globalState.floatMessages.splice(i--, 1)
            continue
        }
    }

    const didTick = time - globalState.lastGameTick >= 1000 / 10 // 10 Hz game tick
    if (didTick) {
        globalState.lastGameTick = time
        globalState.gameTickTime++

        if (Config.engine.doTimedEvents && !globalState.inCombat) {
            // check and update timed events
            const timedEvents = Scripting.timeEventList
            let numEvents = timedEvents.length
            for (let i = 0; i < numEvents; i++) {
                const event = timedEvents[i]
                const obj = event.obj

                // remove events for dead objects
                if (obj && obj instanceof Critter && obj.dead) {
                    console.log('removing timed event for dead object')
                    timedEvents.splice(i--, 1)
                    numEvents--
                    continue
                }

                event.ticks--
                if (event.ticks <= 0) {
                    Scripting.info('timed event triggered', 'timer')
                    event.fn()
                    timedEvents.splice(i--, 1)
                    numEvents--
                }
            }
        }

        globalState.audioEngine.tick()
    }

    for (const obj of globalState.gMap.getObjects()) {
        if (obj.type === 'critter') {
            if (
                didTick &&
                Config.engine.doUpdateCritters &&
                !globalState.inCombat &&
                !(<Critter>obj).dead &&
                !obj.inAnim() &&
                obj._script
            ) {
                Scripting.updateCritter(obj._script, obj as Critter)
            }
        }

        obj.updateAnim()
    }

    globalState.lastUpdateTime = Math.floor(window.performance.now() - time)
}

heart.draw = () => {
    const time = window.performance.now()

    if (globalState.isWaitingOnRemote) {
        return
    }
    globalState.renderer.render()

    globalState.lastDrawTime = Math.floor(window.performance.now() - time)
}

export function useElevator(): void {
    // Player walked into an elevator
    //
    // We search for the Elevator Stub (Scenery PID 1293)
    // in the range of 11. The original engine uses a square
    // of size 11x11, but we don't do that.

    console.log('[elevator]')

    const center = globalState.player.position
    const hexes = hexesInRadius(center, 11)
    let elevatorStub = null
    for (let i = 0; i < hexes.length; i++) {
        const objs = globalState.gMap.objectsAtPosition(hexes[i])
        for (let j = 0; j < objs.length; j++) {
            const obj = objs[j]
            if (obj.type === 'scenery' && obj.pidID === 1293) {
                console.log('elevator stub @ ' + hexes[i].x + ', ' + hexes[i].y)
                elevatorStub = obj
                break
            }
        }
    }

    if (elevatorStub === null) {
        throw "couldn't find elevator stub near " + center.x + ', ' + center.y
    }

    console.log('elevator type: ' + elevatorStub.extra.type + ', ' + 'level: ' + elevatorStub.extra.level)

    const elevator = getElevator(elevatorStub.extra.type)
    if (!elevator) {
        throw 'no elevator: ' + elevatorStub.extra.type
    }

    uiElevator(elevator)
}
