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
import { AI, Combat } from './combat.js'
import { useDrug, tickAddictions } from './drugs.js'
import { critterKill } from './critter.js'
import { getElevator } from './data.js'
import { heart } from './heart.js'
import { hexesInRadius, hexFromScreen, hexNeighbors, hexDistance } from './geometry.js'
import globalState from './globalState.js'
import { IDBCache } from './idbcache.js'
import { initGame } from './init.js'
import { dbg, dbgWarn } from './logger.js'
import { Critter, Obj } from './object.js'
import {
    getObjectUnderCursor,
    getZoom,
    SCREEN_HEIGHT,
    SCREEN_WIDTH,
    setScreenSize,
    ZOOM_MAX,
    ZOOM_MIN,
} from './renderer.js'
import { Scripting } from './scripting.js'
import { Skills, SKILL_NAMES } from './skills.js'
import { skillUse } from './skillUse.js'
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
    initLogScrollZones,
    uiLog,
    uiLoot,
    UIMode,
    uiSaveLoad,
    uiShowCombatHover,
    uiWorldMap,
} from './ui.js'
import { getFileJSON, getProtoMsg } from './util.js'
import { WebGLRenderer } from './webglrenderer.js'
import { Config } from './config.js'
import { fonUnpack } from './formats/fon.js'
import { getActiveUnarmedModeForHand } from './unarmed.js'
import { Lightmap } from './lightmap.js'
import { togglePipBoy } from './ui_pipboy.js'
import './debug.js'

// Next gameTickTime at which map_update_p_proc should fire across all map
// scripts. Fallout 2 schedules this via a 600-tick queue event, so we mirror
// the cadence here and reschedule from a local counter rather than a
// persisted field (map entry resets the cadence anyway).
let nextMapUpdateTick = 600

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
    dbgWarn('script', '[Skill] unimplemented skill %d', skill)
    return -1
}

function playerUseSkill(skill: Skills, obj: Obj): void {
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
        dbg('script', `[Skill] Engine fallback: skillUse("${skillName}")`)
        // Engine fallback: use the skill directly
        const result = skillUse(globalState.player as Critter, target, skillName)
        uiLog(result.message)
        if (result.hpHealed > 0) {
            drawHP(globalState.player!.getStat('HP'))
        }
    }
}

// Cancel skill targeting mode: resets uiMode, skillMode, and cursor
function cancelSkillTargeting(): void {
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
                // loot a dead body
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

window.onload = async function () {
    globalState.isInitializing = true

    globalState.$fpsOverlay = document.getElementById('fpsOverlay')
    initLogScrollZones()

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

    // --- Dynamic resolution ---
    //
    // Resize the game canvas to fill the browser viewport and re-fit the
    // world whenever the window changes size (or on fullscreen toggle, or
    // when CSS layout shifts during a resize). The visible world area
    // grows with the window since SCREEN_WIDTH/SCREEN_HEIGHT propagate
    // through the renderer's visibility culling and shader uniforms.
    //
    // We debounce the handler (~80ms) because resize fires on every pixel
    // of a drag in some browsers and reallocating the floor FBO each
    // event wrecks performance.
    let resizeTimer: number | null = null
    const applyViewportSize = () => {
        const w = Math.max(1, window.innerWidth | 0)
        const h = Math.max(1, window.innerHeight | 0)

        // 1. Update the logical screen dimensions exported by renderer.ts.
        //    ES-module `let` exports are live bindings, so every consumer
        //    (culling, hex picking, UI layout) picks up the new value.
        setScreenSize(w, h)

        // 2. Tell the WebGL renderer to resize its canvas + FBOs + uniforms.
        const r = globalState.renderer as WebGLRenderer
        if (r && typeof r.resize === 'function') {
            r.resize(w, h)
        }

        // 3. Keep the temp canvas (used for single-pixel picking) in sync.
        if (globalState.tempCanvas) {
            globalState.tempCanvas.width = w
            globalState.tempCanvas.height = h
        }

        // 4. Refresh heart.js's cached size + canvas-offset so mouse
        //    coordinates continue to map to canvas-local pixels.
        heart._size.w = w
        heart._size.h = h
        if (heart.canvas) {
            const rect = heart.canvas.getBoundingClientRect()
            heart._canvasOffset.x = rect.left
            heart._canvasOffset.y = rect.top
        }
    }
    // Apply once immediately so the initial canvas matches the browser
    // viewport, even if the user loaded the page at a non-default size.
    applyViewportSize()

    window.addEventListener('resize', () => {
        if (resizeTimer !== null) {
            window.clearTimeout(resizeTimer)
        }
        resizeTimer = window.setTimeout(() => {
            resizeTimer = null
            applyViewportSize()
        }, 80)
    })

    // Fullscreen API toggle — delegated from a button in the DOM. We go
    // fullscreen on the whole document so the canvas (which fills the
    // viewport) expands to the screen edges. The browser fires a resize
    // event on entry/exit, so applyViewportSize() runs automatically.
    const fullscreenBtn = document.getElementById('fullscreenBtn') as HTMLButtonElement | null
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {})
            } else {
                document.documentElement.requestFullscreen().catch(() => {})
            }
        })
        document.addEventListener('fullscreenchange', () => {
            fullscreenBtn.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen'
        })
    }

    // --- Mouse-wheel zoom ---
    //
    // Scrolling the wheel zooms the world in/out centered on the mouse
    // cursor: the world point currently under the cursor stays pinned to
    // that screen location across the zoom. UI (HUD, PipBoy, HTML overlays)
    // is not affected — the renderer only applies zoom to world draws.
    //
    // Continuous (non-snapping) zoom feels smoother for map navigation
    // than stepped levels; each wheel notch multiplies zoom by ~1.1 (or
    // divides, for zoom-out), clamped to [ZOOM_MIN, ZOOM_MAX].
    const zoomCanvas = document.getElementById('cnv') as HTMLCanvasElement | null
    if (zoomCanvas) {
        zoomCanvas.addEventListener(
            'wheel',
            (e: WheelEvent) => {
                // Prevent the browser from scrolling the page when the
                // cursor is over the game canvas.
                e.preventDefault()
                if (globalState.isInitializing || globalState.isLoading) {
                    return
                }
                // Ignore zoom while a modal UI (dialog, inventory, pipboy)
                // is up — it'd desync the underlying paused map.
                if (globalState.uiMode !== UIMode.none && globalState.uiMode !== UIMode.useSkill) {
                    return
                }

                const oldZoom = globalState.cameraZoom || 1.0
                // deltaY > 0 = scroll down = zoom out; < 0 = zoom in.
                // Use the sign only so high-resolution touchpads don't
                // make zoom jittery or too sensitive.
                const step = 1.1
                const factor = e.deltaY < 0 ? step : 1 / step
                const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, oldZoom * factor))
                if (newZoom === oldZoom) {
                    return
                }

                // Anchor the zoom on the cursor: we want the world point
                // under the mouse before zoom to stay under the mouse
                // after. With camera as world-space top-left and
                // screen = (world - cam) * zoom:
                //     world_under_mouse = cam_old + mouse/zoom_old
                //                       = cam_new + mouse/zoom_new
                // ⇒ cam_new = cam_old + mouse*(1/zoom_old − 1/zoom_new).
                const rect = zoomCanvas.getBoundingClientRect()
                const mouseX = e.clientX - rect.left
                const mouseY = e.clientY - rect.top
                globalState.cameraPosition.x += mouseX * (1 / oldZoom - 1 / newZoom)
                globalState.cameraPosition.y += mouseY * (1 / oldZoom - 1 / newZoom)
                globalState.cameraZoom = newZoom

                // The floor FBO caches a pre-zoomed snapshot of the floor;
                // invalidate it so the next frame re-bakes at the new zoom.
                const r = globalState.renderer as WebGLRenderer
                if (r && typeof r.invalidateFloorFBO === 'function') {
                    r.invalidateFloorFBO()
                }
            },
            { passive: false }
        )
    }

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
                dbg('map', '[Main] %s loaded from cache DB', key)
                callback(value)
            } else {
                value = getFileJSON(path)
                IDBCache.add(key, value)
                dbg('map', '[Main] %s loaded and cached', key)
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
                globalState.drugHandler = useDrug
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
        dbg('map', '[Lighting] floor lighting:', Config.engine.doFloorLighting)
    }

    ;(window as any).setLightingMode = (mode: 'gpu' | 'cpu') => {
        Config.engine.floorLightingMode = mode
        ;(globalState.renderer as WebGLRenderer).setLightingMode(mode)
        dbg('map', '[Lighting] switched to:', mode)
    }
}

heart.mousepressed = (x: number, y: number, btn: string) => {
    if (globalState.isInitializing || globalState.isLoading || globalState.isWaitingOnRemote) {
        return
    } else if (globalState.gameUIDisabled) {
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
        } else if (globalState.uiMode === UIMode.useSkill) {
            playerUse(getObjectUnderCursor((_: Obj) => true))
        } else {
            playerUse(getObjectUnderCursor((obj) => obj.isSelectable))
        }
    } else if (btn === 'r') {
        // Right-click cancels skill targeting mode
        if (globalState.uiMode === UIMode.useSkill) {
            cancelSkillTargeting()
            return
        }
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
    } else if (globalState.cursorMode !== 'command' && globalState.cursorMode !== 'attack' && globalState.cursorMode !== 'useSkill') {
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
    // ESC cancels skill targeting mode
    if (k === 'Escape' && globalState.uiMode === UIMode.useSkill) {
        cancelSkillTargeting()
        return
    }
    const mousePos = heart.mouse.getPosition()
    const kz = getZoom()
    const mouseHex = hexFromScreen(
        mousePos[0] / kz + globalState.cameraPosition.x,
        mousePos[1] / kz + globalState.cameraPosition.y
    )

    // Keep keyboard pan speed consistent on-screen regardless of zoom
    // (see the mouse-edge scroll block in heart.update for the same trick).
    const kbStep = 15 / kz
    if (k === Config.controls.cameraDown) {
        globalState.cameraPosition.y += kbStep
    }
    if (k === Config.controls.cameraRight) {
        globalState.cameraPosition.x += kbStep
    }
    if (k === Config.controls.cameraLeft) {
        globalState.cameraPosition.x -= kbStep
    }
    if (k === Config.controls.cameraUp) {
        globalState.cameraPosition.y -= kbStep
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
                dbg('dialogue', '[Dialog] talking to ' + critter.name)
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
                dbg(
                    'map',
                    '[Main] object is at index ' +
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
            dbg('combat', "[Main] can't do that yet")
            return
        }

        const kbWeapon = globalState.player.equippedWeapon
        const kbP = globalState.player
        const kbAPCost = kbWeapon === null
            ? getActiveUnarmedModeForHand(kbP.getSkill('Unarmed'), (kbP as any).activeHand ?? 'leftHand', globalState.punchModeIdx, globalState.kickModeIdx, !(kbP as any).leftHand?.weapon && !(kbP as any).rightHand?.weapon).apCost
            : kbWeapon.weapon!.getAPCost(1)

        if (globalState.player.AP.getAvailableCombatAP() < kbAPCost) {
            uiLog(getProtoMsg(700))
            return
        }

        for (let i = 0; i < globalState.combat!.combatants.length; i++) {
            if (
                globalState.combat.combatants[i].position.x === mouseHex.x &&
                globalState.combat.combatants[i].position.y === mouseHex.y &&
                !globalState.combat.combatants[i].dead
            ) {
                globalState.player.AP.subtractCombatAP(kbAPCost)
                drawAP(globalState.player.AP.getAvailableMoveAP(), globalState.player.AP.getTotalMaxAP())
                dbg('combat', '[Combat] attack key pressed')
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
            dbg('combat', '[Combat] player turn ended')
            globalState.combat.nextTurn()
        } else if (globalState.inCombat === true) {
            dbg('combat', '[Combat] wait your turn')
        } else {
            dbg('combat', '[Combat] begin')
            Combat.start()
        }
    }

    if (k === Config.controls.playerToTargetRaycast) {
        const obj = globalState.gMap.objectsAtPosition(mouseHex)[0]
        if (obj !== undefined) {
            const hit = globalState.gMap.hexLinecast(globalState.player.position, obj.position)
            if (!hit) {
                return
            }
            dbg('map', '[Main] hit obj: ' + hit.art)
        }
    }

    if (k === Config.controls.showTargetInventory) {
        const obj = globalState.gMap.objectsAtPosition(mouseHex)[0]
        if (obj !== undefined) {
            dbg('object', '[Main] PID: ' + obj.pid)
            dbg('object', '[Main] inventory: ' + JSON.stringify(obj.inventory))
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

    // FO2-CE ref: Skill targeting mode keeps the game loop running so the
    // player can scroll the map and see hover feedback while picking a target.
    // All other UI modes (dialogue, inventory, etc.) pause the loop.
    if (globalState.uiMode !== UIMode.none && globalState.uiMode !== UIMode.useSkill) {
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
        // Screen-edge scrolling in world units per tick. Dividing the
        // base step by zoom keeps the *on-screen* scroll rate constant
        // regardless of how zoomed in or out the player is: zoomed in,
        // a 15-px-world step would fly across half the screen; zoomed
        // out, it would barely register.
        const scrollStep = 15 / (globalState.cameraZoom || 1.0)
        if (mousePos[0] <= Config.ui.scrollPadding) {
            globalState.cameraPosition.x -= scrollStep
        }
        if (mousePos[0] >= SCREEN_WIDTH - Config.ui.scrollPadding) {
            globalState.cameraPosition.x += scrollStep
        }

        if (mousePos[1] <= Config.ui.scrollPadding) {
            globalState.cameraPosition.y -= scrollStep
        }
        if (mousePos[1] >= SCREEN_HEIGHT - Config.ui.scrollPadding) {
            globalState.cameraPosition.y += scrollStep
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
                    dbg('timer', '[Events] removing timed event for dead object')
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

        // Fallout 2 fires map_update_p_proc for every script on the map
        // every 600 ticks (60 game seconds) via an EVENT_TYPE_MAP_UPDATE_EVENT
        // queued by mapUpdateEventProcess. Mirror that cadence here so
        // scripts can check `game_time_hour` and drive NPC behavior (shop
        // hours, sleep schedules, etc.) without any engine-level gates.
        if (!globalState.inCombat && globalState.gMap) {
            if (nextMapUpdateTick < globalState.gameTickTime) {
                // Catch up after a save load or fresh start where gameTickTime
                // has jumped forward past the initial sentinel.
                nextMapUpdateTick = globalState.gameTickTime + 600
            } else if (globalState.gameTickTime >= nextMapUpdateTick) {
                nextMapUpdateTick = globalState.gameTickTime + 600
                globalState.gMap.updateMap()

                // Poison tick: -1 HP per 600-tick cycle for each 10 points of poison.
                // FO2-CE ref: critter.cc critterPoisonCheck
                const player = globalState.player as Critter | null
                if (player && !player.dead && player.poisonLevel > 0) {
                    const dmg = Math.floor(player.poisonLevel / 10)
                    if (dmg > 0) player.stats.modifyBase('HP', -dmg)
                    player.poisonLevel = Math.max(0, player.poisonLevel - 1)
                }

                // Addiction withdrawal tick for the player.
                if (player && !player.dead) tickAddictions(player)

                // Radiation symptom tick (FO2-CE ref: radiation.cc radiationEventProcess)
                if (player && !player.dead && player.radiationLevel > 0) {
                    applyRadiationSymptoms(player)
                }
            }
        }

        globalState.audioEngine.tick()
    }

    for (const obj of globalState.gMap.getObjects()) {
        if (obj.type === 'critter') {
            const critter = obj as Critter
            if (
                didTick &&
                Config.engine.doUpdateCritters &&
                !globalState.inCombat &&
                !critter.dead &&
                !obj.inAnim() &&
                obj._script
            ) {
                Scripting.updateCritter(obj._script, critter)
            }

            // Wander: move to a random neighbor every tick when not in combat
            // and the critter has a wander_type > 0 in its AI packet.
            // FO2-CE ref: ai.cc critterAttemptWander
            if (
                didTick &&
                !globalState.inCombat &&
                !critter.dead &&
                !critter.inAnim() &&
                !obj._script
            ) {
                if (AI.aiTxt === null) AI.init()
                const pkt = AI.getPacketInfo(critter.aiNum)
                if (pkt && pkt.wander_type > 0 && Math.random() < 0.05) {
                    const neighbors = hexNeighbors(critter.position)
                    const dest = neighbors[Math.floor(Math.random() * neighbors.length)]
                    if (dest) critter.walkTo(dest, false)
                }
            }
        }

        obj.updateAnim()
    }

    // Party follow: move companions toward the player each tick
    if (didTick && !globalState.inCombat && globalState.gParty.party.length > 0) {
        globalState.gParty.followPlayer()
    }

    globalState.gMap?.drainRemovalQueue()

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

// FO2-CE ref: radiation.cc radiationGetLevel
function applyRadiationSymptoms(player: Critter): void {
    const rads = player.radiationLevel
    if (rads >= 1000) {
        uiLog('Radiation: You are dying!')
        player.stats.modifyBase('HP', -10)
    } else if (rads >= 600) {
        uiLog('Radiation: Critical!')
        player.stats.modifyBase('HP', -4)
    } else if (rads >= 450) {
        uiLog('Radiation: Acute sickness')
    } else if (rads >= 300) {
        uiLog('Radiation: Nausea')
    }
    // Below 150 rads is safe — no symptoms
}

export function useElevator(): void {
    // Player walked into an elevator
    //
    // We search for the Elevator Stub (Scenery PID 1293)
    // in the range of 11. The original engine uses a square
    // of size 11x11, but we don't do that.

    dbg('map', '[Elevator] entered')

    const center = globalState.player.position
    const hexes = hexesInRadius(center, 11)
    let elevatorStub = null
    for (let i = 0; i < hexes.length; i++) {
        const objs = globalState.gMap.objectsAtPosition(hexes[i])
        for (let j = 0; j < objs.length; j++) {
            const obj = objs[j]
            if (obj.type === 'scenery' && obj.pidID === 1293) {
                dbg('map', `[Elevator] stub @ (${hexes[i].x}, ${hexes[i].y})`)
                elevatorStub = obj
                break
            }
        }
    }

    if (elevatorStub === null) {
        throw "couldn't find elevator stub near " + center.x + ', ' + center.y
    }

    dbg('map', `[Elevator] type=${elevatorStub.extra.type}, level=${elevatorStub.extra.level}`)

    const elevator = getElevator(elevatorStub.extra.type)
    if (!elevator) {
        throw 'no elevator: ' + elevatorStub.extra.type
    }

    uiElevator(elevator)
}
