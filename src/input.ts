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

import { cancelUseItemOn, usePendingItemOn } from './useItemOn.js'
import { Combat } from './combat.js'
import { critterKill } from './critter.js'
import { heart } from './heart.js'
import { hexFromScreen, hexToScreen, hexDistance, Point } from './geometry.js'
import globalState from './globalState.js'
import { dbg, dbgWarn } from './logger.js'
import { Lightmap } from './lightmap.js'
import { Obj, objectIsWeapon } from './object.js'
import {
    clampCameraPosition,
    getObjectUnderCursor,
    getZoom,
    SCREEN_HEIGHT,
    SCREEN_WIDTH,
    screenToWorld,
} from './renderer.js'
import { objLookAt } from './examine.js'
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
import { currentUnarmed, unarmedAPCost } from './unarmed.js'
import { closePipBoy } from './ui_pipboy.js'
import { gameHandleKey } from './hotkeys.js'
import { closeInventory } from './ui_inventory.js'
import { automapKey, closeAutomap } from './ui_automap.js'
import { lootKey } from './ui_loot.js'
import { elevatorKey } from './ui_elevator.js'
import { playerUse, cancelSkillTargeting } from './playerUse.js'
import { primaryActionIcon, uiPrimaryAction } from './ui_contextmenu.js'

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

// DH2 developer hotkeys — no CE equivalent; only with Config.engine.devKeys
// (console setDevKeys(true)). Camera arrows, Pip-Boy, inventory, save/load, combat
// and the item-highlight key stay on.
// A DH2 developer key that is bound (devKeys on) — then it isn't a CE game key.
function devKeyBound(key: string): boolean {
    const k = key.length === 1 ? key.toLowerCase() : key
    for (const c of DEV_CONTROLS) if ((Config.controls as any)[c] === k) return true
    return false
}

// The close keys of the window that is open (CE: each window's own input loop).
function closeWindowKey(e: KeyboardEvent): boolean {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    switch (globalState.uiMode) {
        case UIMode.pipBoy: // pipboy.cc pipboyOpen: Esc, Return, P, Z
            if (k === 'Escape' || k === 'Enter' || k === 'p' || k === 'z') { closePipBoy(); return true }
            return false
        case UIMode.elevator: // elevator.cc elevatorSelectLevel: Esc, the floor labels
            return elevatorKey(e)
        case UIMode.loot: // inventory.cc inventoryOpenLooting / Stealing: Esc, A
            return lootKey(e)
        case UIMode.inventory: // inventory.cc inventoryOpen: Esc, I
            if (k === 'Escape' || k === 'i') { closeInventory(); return true }
            return false
        case UIMode.automap: // automap.cc automapShow: Tab, Esc, A close; H / L detail; S scanner
            if (k === 'Escape' || k === 'Tab' || k === 'a') { closeAutomap(); return true }
            if (k === 'h' || k === 'l' || k === 's') { automapKey(e); return true }
            return false
    }
    return false
}

const DEV_CONTROLS = new Set([
    'elevationDown', 'elevationUp', 'showRoof', 'showFloor', 'showObjects', 'showWalls',
    'talkTo', 'inspect', 'moveTo', 'runTo', 'attack', 'playerToTargetRaycast',
    'showTargetInventory', 'use', 'kill', 'worldmap',
])

function isKey(k: string, control: keyof typeof Config.controls): boolean {
    if (k !== Config.controls[control]) return false
    return Config.engine.devKeys || !DEV_CONTROLS.has(control)
}

// CE game_mouse.cc gameMouseRefresh (ARROW mode): after the mouse rests 250 ms over an
// object the cursor shows its primary action's icon (nothing over empty ground), and
// _obj_look_at runs only when the pointed object changes (gGameMousePointedObject).
let lastPointedObject: Obj | null = null
function scheduleArrowHover(): void {
    globalState.showLookCursor = false
    if (globalState.commandModeTimer !== null) clearTimeout(globalState.commandModeTimer)
    globalState.commandModeTimer = window.setTimeout(() => {
        const hoverObj = getObjectUnderCursor((_: Obj) => true)
        globalState.hoverActionIcon = hoverObj ? primaryActionIcon(hoverObj) : null
        globalState.showLookCursor = hoverObj !== null
        if (hoverObj && hoverObj !== lastPointedObject && globalState.player) {
            lastPointedObject = hoverObj
            for (const line of objLookAt(globalState.player, hoverObj)) uiLog(line)
        }
    }, 250)
}

// CE game_mouse.cc gameMouseRefresh (MOVE mode): after a 250 ms rest the hex cursor shows
// the AP the walk costs in combat (critterGetMovementPointCostAdjustedForCrippledLegs minus
// the free move; white), or a red X when it exceeds the dude's AP or there is no path.
let hexCursorTimer: number | null = null
function scheduleHexCursorAP(): void {
    globalState.hexCursorText = null
    if (hexCursorTimer !== null) clearTimeout(hexCursorTimer)
    if (globalState.cursorMode !== 'move') return
    hexCursorTimer = window.setTimeout(() => {
        const player = globalState.player
        const gMap = globalState.gMap
        if (!player || !gMap || globalState.cursorMode !== 'move') return
        const mouse = heart.mouse.getPosition()
        const world = screenToWorld(mouse[0], mouse[1])
        const hex = hexFromScreen(world.x, world.y)
        const path = gMap.recalcPath(player.position, hex, undefined, player)
        const distance = Math.max(0, path.length - 1)
        if (distance === 0) { globalState.hexCursorText = { text: 'X', color: '#fc0000' }; return }
        if (!globalState.inCombat || !player.AP) return
        let cost = distance
        if (player.crippledLeftLeg && player.crippledRightLeg) cost *= 8
        else if (player.crippledLeftLeg || player.crippledRightLeg) cost *= 4
        const required = Math.max(0, cost - player.AP.move)
        globalState.hexCursorText = required <= player.AP.getAvailableCombatAP()
            ? { text: String(required), color: '#fcfcfc' }
            : { text: 'X', color: '#fc0000' }
    }, 250)
}

// CE game_mouse.cc gameMouseCycleMode — right-click and the M key: move (hex) → command
// (arrow) → attack (crosshair, only in combat with a weapon or empty hand) → move.
function cycleMouseMode(): void {
    if (globalState.cursorMode === 'move') {
        // move (hex) → command (arrow)
        globalState.cursorMode = 'command'
        lastPointedObject = null
        scheduleArrowHover()
    } else if (globalState.cursorMode === 'command') {
        // command (arrow) → attack (crosshair). CE ref: game_mouse.cc
        // gameMouseCycleMode — the crosshair is skipped (back to move) outside
        // combat, and in combat while the active item isn't a weapon.
        const player = globalState.player as any
        const activeItem = player?.[player?.activeHand ?? 'leftHand'] as Obj | undefined
        const skipCrosshair = !globalState.inCombat || (activeItem !== undefined && activeItem !== null && !objectIsWeapon(activeItem))
        globalState.cursorMode = skipCrosshair ? 'move' : 'attack'
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

export function installInputHandlers(): void {
    // CE game.cc gameHandleKey — the game keys on the map (src/hotkeys.ts); the open
    // window's own close keys (CE runs each window's input loop).
    window.addEventListener('keydown', (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
        if (globalState.isLoading || globalState.isInitializing || globalState.gameUIDisabled) return
        if (Config.engine.devKeys && devKeyBound(e.key)) return
        const mode = globalState.uiMode
        if (closeWindowKey(e)) { e.preventDefault(); return }
        // ESC cancels skill targeting (heart's own check compared 'Escape' with its lower-case
        // 'escape' and never fired)
        if (mode === UIMode.useSkill && e.key === 'Escape') { cancelSkillTargeting(); e.preventDefault(); return }
        if (mode !== UIMode.none && mode !== UIMode.useSkill) return
        if (gameHandleKey(e, cycleMouseMode)) e.preventDefault()
    }, true)

    // CE game_dialog.cc / gameMoviePlay / the message boxes run their own modal input loop:
    // the map gets no clicks meanwhile. DH2's dialogue window leaves map visible around it,
    // and a click there walked, opened the action menu and — on its release — reset
    // uiMode to none, after which the dialogue's last option no longer closed it.
    const MAP_MODAL = new Set([UIMode.dialogue, UIMode.barter, UIMode.companionControl, UIMode.movie, UIMode.dialog])
    // [dh2] mouse_mode=ce: an arrow-cursor press waiting for its release or the 250 ms hold
    let arrowHold: { timer: number; menu: boolean } | null = null

    heart.mousepressed = (x: number, y: number, btn: string) => {
        if (globalState.isInitializing || globalState.isLoading || globalState.isWaitingOnRemote) {
            return
        } else if (globalState.gameUIDisabled || MAP_MODAL.has(globalState.uiMode)) {
            return
        } else if (btn === 'l') {
            if (globalState.cursorMode === 'useItem') {
                // CE game_mouse.cc:1019 — use the HUD item on the object under the cursor
                // (the player included), then back to the move cursor.
                usePendingItemOn(getObjectUnderCursor((_: Obj) => true))
            } else if (globalState.cursorMode === 'command') {
                const obj = getObjectUnderCursor((_: Obj) => true)
                if (Config.ui.mouseMode === 'ce') {
                    // CE game_mouse.cc: the menu opens on LEFT_BUTTON_DOWN_REPEAT (held for
                    // BUTTON_REPEAT_TIME, 250 ms); a release before that is the primary action
                    if (arrowHold) clearTimeout(arrowHold.timer)
                    arrowHold = {
                        menu: false,
                        timer: window.setTimeout(() => {
                            if (!arrowHold) return
                            arrowHold.menu = true
                            const held = getObjectUnderCursor((_: Obj) => true)
                            if (held) uiContextMenu(held, { clientX: x, clientY: y })
                        }, 250),
                    }
                } else if (obj) {
                    // open context menu immediately on any object under cursor
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
            } else if (Config.ui.mouseMode === 'ce') {
                // CE _gmouse_handle_event (MOVE mode): always walk / run to the hex
                playerUse(null)
            } else {
                playerUse(getObjectUnderCursor((obj) => obj.isSelectable))
            }
        } else if (btn === 'r') {
            // Right-click cancels skill targeting mode
            if (globalState.uiMode === UIMode.useSkill) {
                cancelSkillTargeting()
                return
            }
            if (globalState.cursorMode === 'useItem') {
                // CE gameMouseCycleMode: (USE_CROSSHAIR + 1) % 3 = ARROW
                cancelUseItemOn()
                globalState.cursorMode = 'command'
                return
            }
            cycleMouseMode()
        }
    }

    heart.mousereleased = (x: number, y: number, btn: string) => {
        if (btn === 'l' && arrowHold) {
            // [dh2] mouse_mode=ce: released before the menu opened — the primary action; with
            // the menu open, the icon under the pointer is chosen (CE's menu follows the drag)
            const hold = arrowHold
            arrowHold = null
            clearTimeout(hold.timer)
            if (!hold.menu) {
                const obj = getObjectUnderCursor((_: Obj) => true)
                if (obj) uiPrimaryAction(obj)
                return
            }
            const el = document.elementFromPoint(x, y) as HTMLElement | null
            const icon = el?.closest('.itemContextMenuButton') as HTMLElement | null
            if (icon) icon.click()
            else if (globalState.uiMode === UIMode.contextMenu) uiHideContextMenu()
            return
        }
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
        if (globalState.cursorMode === 'command') scheduleArrowHover()
        scheduleHexCursorAP()

        // Scroll interrupts any mode; HUD/move only apply when not in command/attack
        const SCROLL_PAD = Config.ui.scrollPadding
        const anyScroll =
            y <= SCROLL_PAD ||
            y >= SCREEN_HEIGHT - SCROLL_PAD ||
            x <= SCROLL_PAD ||
            x >= SCREEN_WIDTH - SCROLL_PAD

        // The HUD shows a CSS cursor (the canvas cursor is under it): mirror the scroll
        // direction onto #bar so ui.css swaps in the matching scroll arrow there.
        const scrollDir = (y >= SCREEN_HEIGHT - SCROLL_PAD ? 's' : y <= SCROLL_PAD ? 'n' : '')
            + (x >= SCREEN_WIDTH - SCROLL_PAD ? 'e' : x <= SCROLL_PAD ? 'w' : '')
        const $bar = document.getElementById('bar')
        if ($bar && ($bar.dataset.scroll ?? '') !== scrollDir) $bar.dataset.scroll = scrollDir

        if (anyScroll) {
            if (globalState.cursorMode !== 'scroll') {
                globalState.preScrollCursorMode = globalState.cursorMode
            }
            globalState.cursorMode = 'scroll'
        } else if (globalState.cursorMode === 'scroll') {
            // leaving scroll zone — restore whatever was active before (move, command, attack, …)
            globalState.cursorMode = globalState.preScrollCursorMode
        } else if (globalState.cursorMode !== 'command' && globalState.cursorMode !== 'attack' && globalState.cursorMode !== 'useSkill' && globalState.cursorMode !== 'useItem') {
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
        // DH2-specific QoL sweep (no CE equivalent) — outline every item on
        // screen while held. Kept separate from Config.ui.itemHighlight,
        // which is the actual CE preference for hover-highlighting a single
        // item (see globalState.highlightItemsKeyHeld, mousemoved below).
        if (isKey(k, 'highlightItems')) {
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
        if (isKey(k, 'cameraDown')) {
            globalState.cameraPosition.y += kbStep
            clampCameraPosition()
        }
        if (isKey(k, 'cameraRight')) {
            globalState.cameraPosition.x += kbStep
            clampCameraPosition()
        }
        if (isKey(k, 'cameraLeft')) {
            globalState.cameraPosition.x -= kbStep
            clampCameraPosition()
        }
        if (isKey(k, 'cameraUp')) {
            globalState.cameraPosition.y -= kbStep
            clampCameraPosition()
        }
        if (isKey(k, 'elevationDown')) {
            if (globalState.currentElevation - 1 >= 0) {
                globalState.gMap.changeElevation(globalState.currentElevation - 1, true)
            }
        }
        if (isKey(k, 'elevationUp')) {
            if (globalState.currentElevation + 1 < globalState.gMap.numLevels) {
                globalState.gMap.changeElevation(globalState.currentElevation + 1, true)
            }
        }
        if (isKey(k, 'showRoof')) {
            Config.ui.showRoof = !Config.ui.showRoof
        }
        if (isKey(k, 'showFloor')) {
            Config.ui.showFloor = !Config.ui.showFloor
        }
        if (isKey(k, 'showObjects')) {
            Config.ui.showObjects = !Config.ui.showObjects
        }
        if (isKey(k, 'showWalls')) {
            Config.ui.showWalls = !Config.ui.showWalls
        }
        if (isKey(k, 'talkTo')) {
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
        if (isKey(k, 'inspect')) {
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
        if (isKey(k, 'moveTo')) {
            globalState.player.walkTo(mouseHex)
        }
        if (isKey(k, 'runTo')) {
            globalState.player.stopSneakToRun() // CE _dude_run
            globalState.player.walkTo(mouseHex, true)
        }
        if (isKey(k, 'attack')) {
            if (!globalState.inCombat || !globalState.combat.inPlayerTurn || globalState.player.anim !== 'idle') {
                dbg('combat', "[Main] can't do that yet")
                return
            }

            const kbWeapon = globalState.player.equippedWeapon
            const kbP = globalState.player
            const kbAPCost = kbWeapon === null
                ? unarmedAPCost(kbP, currentUnarmed(kbP).mode, false)
                : kbWeapon.weapon!.getAttackAPCost(kbP, undefined, kbWeapon.weapon!.isCalled())

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
                    drawAP(globalState.player.AP.getAvailableCombatAP(), globalState.player.AP.getTotalMaxAP(), globalState.player.AP.move)
                    dbg('combat', '[Combat] attack key pressed')
                    globalState.combat.attack(globalState.player, globalState.combat.combatants[i])
                    break
                }
            }
        }

        if (isKey(k, 'playerToTargetRaycast')) {
            const obj = globalState.gMap.objectsAtPosition(mouseHex)[0]
            if (obj !== undefined) {
                const hit = globalState.gMap.hexLinecast(globalState.player.position, obj.position)
                if (!hit) {
                    return
                }
                dbg('map', '[Main] hit obj: ' + hit.art)
            }
        }

        if (isKey(k, 'showTargetInventory')) {
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

        if (isKey(k, 'use')) {
            const objs = globalState.gMap.objectsAtPosition(mouseHex)
            for (let i = 0; i < objs.length; i++) {
                objs[i].use()
            }
        }

        if (Config.engine.devKeys && k === 'h') { // dev: teleport to the mouse hex
            globalState.player.move(mouseHex)
        }

        if (isKey(k, 'kill')) {
            const critter = globalState.gMap.critterAtPosition(mouseHex)
            if (critter) {
                critterKill(critter, globalState.player, undefined, { animate: true })
            }
        }

        if (isKey(k, 'worldmap')) {
            uiWorldMap()
        }

    }

    heart.keyup = (k: string) => {
        // DH2-specific QoL sweep — release clears the outline. See note above.
        if (isKey(k, 'highlightItems')) {
            globalState.highlightItemsKeyHeld = false
        }
    }
}
