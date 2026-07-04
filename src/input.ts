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

import { Combat } from './combat.js'
import { critterKill } from './critter.js'
import { heart } from './heart.js'
import { hexFromScreen, hexToScreen, hexDistance, Point } from './geometry.js'
import globalState from './globalState.js'
import { dbg, dbgWarn } from './logger.js'
import { Lightmap } from './lightmap.js'
import { Obj } from './object.js'
import {
    clampCameraPosition,
    getObjectUnderCursor,
    getZoom,
    SCREEN_HEIGHT,
    SCREEN_WIDTH,
} from './renderer.js'
import { Scripting } from './scripting.js'
import {
    drawAP,
    uiContextMenu,
    uiHideContextMenu,
    uiInventoryScreen,
    uiLog,
    uiLoot,
    UIMode,
    uiSaveLoad,
    uiWorldMap,
} from './ui.js'
import { getProtoMsg } from './util.js'
import { Config } from './config.js'
import { getActiveUnarmedModeForHand } from './unarmed.js'
import { togglePipBoy } from './ui_pipboy.js'
import { playerUse, cancelSkillTargeting } from './playerUse.js'

// Tile inspector — build a structured, copy-pasteable dump of everything the
// debug tooling knows about the hex tile under the cursor: its lighting, the
// light sources that can reach it, and every object standing on it. Invoked by
// the `inspect` key (default 'i'); the same text is logged and copied to the
// clipboard. Anchored to DH2's own data model (art paths, not FO2 FIDs;
// extendedFlags nested under pro.extra), so what it prints is what the engine
// actually reads at render time.
function hex32(n: number): string {
    return '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0')
}

function buildTileInspectorReport(mouseHex: Point): string {
    const lines: string[] = []
    const tileIndex = mouseHex.y * 200 + mouseHex.x
    const world = hexToScreen(mouseHex.x, mouseHex.y)

    lines.push('=== TILE INSPECTOR ===')
    lines.push(`Tile:       index=${tileIndex}  tileX=${mouseHex.x}  tileY=${mouseHex.y}`)
    lines.push(`World:      x=${world.x}  y=${world.y}`)
    lines.push(`Elevation:  ${globalState.currentElevation}`)
    lines.push('')

    // --- LIGHTING --- reads Lightmap.tile_intensity directly, the same array
    // the floor/object shaders sample. Raw value plus the 0..1 normalization
    // the shaders apply (min(v, 65536) / 65536).
    lines.push('--- LIGHTING ---')
    const rawIntensity = tileIndex >= 0 && tileIndex < 40000 ? Lightmap.tile_intensity[tileIndex] : 0
    const normalized = Math.min(rawIntensity, 65536) / 65536
    lines.push(`tile_intensity:   ${rawIntensity}  (${normalized.toFixed(3)} normalized)`)

    // Light sources that can reach this tile, reconstructed by hex distance —
    // CE's light.cc stores only accumulated intensity per tile, not which
    // sources contributed, so this is inferred, not authoritative. Same guard
    // as lightmap.ts obj_adjust_light() / the light-source overlay.
    const objects = globalState.gMap ? globalState.gMap.getObjects() : []
    const sources = objects
        .filter((o) => o.lightRadius > 0 && o.lightIntensity > 655)
        .map((o) => ({ o, dist: hexDistance(o.position, mouseHex) }))
        .filter((s) => s.dist <= s.o.lightRadius)
        .sort((a, b) => a.dist - b.dist)
    lines.push('Light sources in range (by hex distance):')
    if (sources.length === 0) {
        lines.push('  (none in range)')
    } else {
        sources.forEach((s, i) => {
            lines.push(
                `  [${i}] type=${s.o.type} pid=${hex32(s.o.pid)}  ` +
                    `radius=${s.o.lightRadius}  intensity=${s.o.lightIntensity}  dist=${s.dist}`
            )
        })
    }
    lines.push('')

    // --- OCCLUSION --- the "egg" is DH2's wall-transparency radius around the
    // player (Config.ui.eggRadius), an occlusion concept, NOT a lighting one —
    // kept in its own section to avoid implying it affects tile intensity.
    lines.push('--- OCCLUSION ---')
    const eggRadius = Config.ui.eggRadius ?? 8
    const insideEgg =
        globalState.player != null && hexDistance(globalState.player.position, mouseHex) <= eggRadius
    lines.push(`Inside egg (radius ${eggRadius}):  ${insideEgg ? 'yes' : 'no'}`)
    lines.push('')

    // --- OBJECTS --- every object standing exactly on this hex.
    const here = objects.filter((o) => o.position.x === mouseHex.x && o.position.y === mouseHex.y)
    lines.push(`--- OBJECTS (${here.length} at tile) ---`)
    if (here.length === 0) {
        lines.push('  (none)')
    } else {
        here.forEach((o, i) => {
            // extendedFlags lives under pro.extra (webglDraw.ts occlusion path
            // reads it there); its absence caused the LD11 wall-occlusion bug,
            // so always surface it — 'n/a' rather than silently omitting.
            const ext: number | undefined = o.pro?.extra?.extendedFlags
            lines.push(`  [${i}] type=${o.type}  pid=${hex32(o.pid)}  pidID=${o.pidID}`)
            lines.push(`      art:            ${o.art}  orient=${o.orientation ?? 'n/a'} frame=${o.frame}`)
            lines.push(`      flags:          ${hex32(o.flags)}`)
            lines.push(`      extendedFlags:  ${ext === undefined ? 'n/a' : hex32(ext)}`)
            lines.push(`      lightRadius:    ${o.lightRadius}  lightIntensity: ${o.lightIntensity}`)
            if (o.type === 'critter') {
                lines.push(`      shift:          ${o.shift ? `x=${o.shift.x}  y=${o.shift.y}` : 'null'}`)
            }
        })
    }

    return lines.join('\n')
}

export function installInputHandlers(): void {
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
                globalState.combat?.refreshHighlights()
            } else if (globalState.cursorMode === 'attack') {
                // attack (crosshair) → back to move (hex)
                globalState.cursorMode = 'move'
                globalState.showLookCursor = false
                if (globalState.commandModeTimer !== null) {
                    clearTimeout(globalState.commandModeTimer)
                    globalState.commandModeTimer = null
                }
                globalState.combat?.refreshHighlights()
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

        // CE ref: game_mouse.cc:680 — while the item_highlight preference is
        // on, outline whatever single item is currently under the mouse
        // cursor (persists outside the render loop so it also participates
        // in the post-roof outline pass, matching CE's OUTLINE_TYPE_ITEM
        // being queued the same way as combat outlines).
        const hoveredItem = Config.ui.itemHighlight
            ? getObjectUnderCursor((o: Obj) => o.type === 'item')
            : null
        if (globalState.hoveredItem !== hoveredItem) {
            if (globalState.hoveredItem && globalState.hoveredItem.outline === 'yellow') {
                globalState.hoveredItem.outline = null
            }
            if (hoveredItem && !hoveredItem.outline) {
                hoveredItem.outline = 'yellow'
            }
            globalState.hoveredItem = hoveredItem
        }

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
        // CE ref: interface.cc gameUiDisable() — block all input during cutscenes/movies
        if (globalState.gameUIDisabled) {
            return
        }
        // ESC cancels skill targeting mode
        if (k === 'Escape' && globalState.uiMode === UIMode.useSkill) {
            cancelSkillTargeting()
            return
        }
        // DH2-specific QoL sweep (no CE equivalent) — outline every item on
        // screen while held. Kept separate from Config.ui.itemHighlight,
        // which is the actual CE preference for hover-highlighting a single
        // item (see globalState.highlightItemsKeyHeld, mousemoved below).
        if (k === Config.controls.highlightItems) {
            globalState.highlightItemsKeyHeld = true
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
            clampCameraPosition()
        }
        if (k === Config.controls.cameraRight) {
            globalState.cameraPosition.x += kbStep
            clampCameraPosition()
        }
        if (k === Config.controls.cameraLeft) {
            globalState.cameraPosition.x -= kbStep
            clampCameraPosition()
        }
        if (k === Config.controls.cameraUp) {
            globalState.cameraPosition.y -= kbStep
            clampCameraPosition()
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
                // CE ref: game_dialog.cc:732 gameDialogEnter — talking to a
                // party member still enters the normal dialogue tree first;
                // gGameDialogSpeakerIsPartyMember only adds the extra
                // Barter/Combat Control buttons to that same dialogue window
                // (game_dialog.cc:4357-4388 _gdialog_window_create). The
                // Combat Control option is injected as a dialogue choice in
                // scripting.ts's gsay_end() instead of being a separate
                // pre-dialogue screen.
                if (critter._script && critter._script.talk_p_proc !== undefined) {
                    // CE ref: actions.cc:1832-1860 actionTalk — walks the
                    // player to the NPC (registers a run-to animation) before
                    // the dialogue callback fires, unless already close.
                    globalState.player.walkInFrontOf(critter.position, () => {
                        globalState.player.clearAnim()
                        dbg('dialogue', '[Dialog] talking to ' + critter.name)
                        Scripting.talk(critter._script!, critter)
                    })
                }
            }
        }
        if (k === Config.controls.inspect) {
            const report = buildTileInspectorReport(mouseHex)
            // Deliberate, user-invoked diagnostic — must print unconditionally
            // (like the eggDebug/lightingDebug console tools), not be gated
            // behind dbg() debug-log categories.
            console.log(report)
            // The keydown gesture satisfies the clipboard-write user-activation
            // requirement, so this needs no async workaround. Guard for
            // non-secure contexts where navigator.clipboard is absent.
            if (navigator.clipboard?.writeText) {
                navigator.clipboard
                    .writeText(report)
                    .catch((err) => dbgWarn('map', 'tile inspector: clipboard copy failed:', err))
            }
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
                // CE ref: proto_instance.cc _obj_use_container — run use_p_proc on
                // the container; only open loot if the script did not override.
                if ((obj as any).isContainer && obj._script) {
                    const overrode = Scripting.use(obj, globalState.player!)
                    if (overrode === true) return
                }
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

    heart.keyup = (k: string) => {
        // DH2-specific QoL sweep — release clears the outline. See note above.
        if (k === Config.controls.highlightItems) {
            globalState.highlightItemsKeyHeld = false
        }
    }
}
