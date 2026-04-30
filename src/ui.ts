/*
Copyright 2014 darkf

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

import { Combat } from './combat.js'
import globalState from './globalState.js'
import { Obj } from './object.js'
import { Config } from './config.js'
import { openAutomap, closeAutomap, isAutomapOpen } from './ui_automap.js'
import { openPipBoy, closePipBoy, isPipBoyOpen } from './ui_pipboy.js'
import { getActiveUnarmedMode, nextUnarmedModeIdx } from './unarmed.js'
import { initOptionsMenu, getOptionsWindow, showOptionsMenu, closeOptionsMenu } from './ui_options.js'
import { initSkilldex, getSkilldexWindow, showSkilldex, closeSkilldex } from './ui_skilldex.js'
import {
    initInventory,
    showInventory,
    makeDropTarget,
    makeDraggable,
} from './ui_inventory.js'
import { showCharacterScreen, closeCharacterScreen, getCharacterWindow } from './ui_character.js'
import { uiBarterMode } from './ui_barter.js'
import { initLoot, uiLoot } from './ui_loot.js'
import { uiWorldMap, uiCloseWorldMap, uiWorldMapShowArea } from './ui_worldmap.js'
import { uiElevator } from './ui_elevator.js'
import { initCalledShot, uiCalledShot, uiCloseCalledShot } from './ui_calledshot.js'
import { uiContextMenu, uiHideContextMenu } from './ui_contextmenu.js'
import {
    drawHP,
    drawAC,
    drawDigits,
    uiLog,
    uiDrawWeapon,
    uiEndCombatAnimationDone,
    initLogScrollZones,
} from './ui_hud.js'
import {
    UIMode,
    initUiContainer,
    closeAllPanels,
    isCharacterOpen,
    isSkilldexOpen,
    isOptionsOpen,
    registerCharacterWindow,
    registerSkilldexWindow,
    registerOptionsWindow,
} from './ui_panels.js'

// --- Re-exports for external callers (keep `from './ui.js'` import sites
// working after individual panels were extracted into ui_*.ts modules) -----
export { Widget } from './ui_widget.js'
export type { CSSBoundingBox } from './ui_widget.js'
export { WindowFrame, SmallButton, Label, List } from './ui_components.js'
export { uiSaveLoad } from './ui_saveload.js'
export { showMainMenu, hideMainMenu, isMainMenuVisible, initMainMenu } from './ui_mainmenu.js'
export { initCharacterCreator } from './ui_charactercreator.js'
export {
    drawHP,
    drawAC,
    drawAP,
    uiLog,
    uiDrawWeapon,
    uiUpdateAmmoBar,
    uiStartCombat,
    uiEndCombat,
    uiShowCombatHover,
    uiHideCombatHover,
    initLogScrollZones,
} from './ui_hud.js'
export {
    UIMode,
    closeAllPanels,
    isInventoryOpen,
    isCharacterOpen,
    isSkilldexOpen,
    isOptionsOpen,
} from './ui_panels.js'
export { showInventory as uiInventoryScreen } from './ui_inventory.js'
export { showCharacterScreen, closeCharacterScreen, getCharacterWindow } from './ui_character.js'
export { uiStartDialogue, uiEndDialogue, uiSetDialogueReply, uiAddDialogueOption } from './ui_dialogue.js'
export { uiBarterMode } from './ui_barter.js'
export { uiLoot } from './ui_loot.js'
export { uiWorldMap, uiCloseWorldMap, uiWorldMapShowArea } from './ui_worldmap.js'
export { uiElevator } from './ui_elevator.js'
export { uiCalledShot, uiCloseCalledShot } from './ui_calledshot.js'
export { uiContextMenu, uiHideContextMenu } from './ui_contextmenu.js'

// UI system

// TODO: reduce code duplication, circular references,
//       and general badness/unmaintainability.
// TODO: combat UI on main bar
// TODO: stats/info view in inventory screen
// TODO: fix inventory image size
// TODO: fix style for inventory image amount
// TODO: option for scaling the UI

function uiInit() {
    // WindowFrame.show() appends to $uiContainer; point it at #uiStage so
    // all skilldex/character/save-load/worldmap windows inherit the 800×600
    // centered coordinate frame. Fall back to #game-container if the stage
    // div is missing (e.g. legacy HTML).
    initUiContainer()

    // Wire panel mutual-exclusion helpers to their respective WindowFrames.
    registerSkilldexWindow(getSkilldexWindow)
    registerOptionsWindow(getOptionsWindow)
    registerCharacterWindow(getCharacterWindow)

    initSkilldex()
    initOptionsMenu()
    initInventory()
    initLoot()
    initCalledShot()

    const chrBtn = document.getElementById('chrButton')
    if (chrBtn) {
        chrBtn.onclick = () => {
            // Toggle: pressing while open closes it.
            if (isCharacterOpen()) { closeCharacterScreen(); return }
            closeAllPanels()
            showCharacterScreen()
        }
    }

    document.getElementById('pipBoyButton')!.onclick = () => {
        if (isPipBoyOpen()) { closePipBoy(); return }
        closeAllPanels()
        openPipBoy()
    }

    document.getElementById('mapButton')!.onclick = () => {
        if (isAutomapOpen()) { closeAutomap(); return }
        closeAllPanels()
        openAutomap()
    }
}

// Panel mutual-exclusion helpers have been moved to ui_panels.ts and are
// re-exported above. closeInventoryPanel/uiInventoryScreen now live in
// ui_inventory.ts; ui_inventory wires its own registerCloseInventoryPanel()
// during initInventory().
//
// initSkilldex() has moved to ui_skilldex.ts.
// initOptionsMenu() has moved to ui_options.ts.
// initCharacterScreen() has moved to ui_character.ts as showCharacterScreen().

// XXX: Should this throw if the element doesn't exist?
function $id(id: string): HTMLElement {
    return document.getElementById(id)!
}

function $img(id: string): HTMLImageElement {
    return document.getElementById(id) as HTMLImageElement
}

function $q(selector: string): HTMLElement {
    return document.querySelector(selector) as HTMLElement
}

function $qa(selector: string): HTMLElement[] {
    return Array.from(document.querySelectorAll(selector))
}

function clearEl($el: HTMLElement): void {
    $el.innerHTML = ''
}

function show($el: HTMLElement): void {
    $el.style.display = 'block'
}

function hide($el: HTMLElement): void {
    $el.style.display = 'none'
}

// TODO: Examine if we actually need visibility or we can replace them all with show/hide
export function showv($el: HTMLElement): void {
    $el.style.visibility = 'visible'
}

export function hidev($el: HTMLElement): void {
    $el.style.visibility = 'hidden'
}

function off($el: HTMLElement, events: string): void {
    const eventList = events.split(' ')
    for (const event of eventList) {
        ;(<any>$el)['on' + event] = null
    }
}

function appendHTML($el: HTMLElement, html: string): void {
    $el.insertAdjacentHTML('beforeend', html)
}

interface ElementOptions {
    id?: string
    src?: string
    classes?: string[]
    click?: (e: MouseEvent) => void
    style?: { [key in keyof CSSStyleDeclaration]?: string }
    children?: HTMLElement[]
    attrs?: { [key: string]: string | number }
}

export function makeEl(tag: string, options: ElementOptions): HTMLElement {
    const $el = document.createElement(tag)

    if (options.id !== undefined) {
        $el.id = options.id
    }
    if (options.src !== undefined) {
        ;($el as HTMLImageElement).src = options.src
    }
    if (options.classes !== undefined) {
        $el.className = options.classes.join(' ')
    }
    if (options.click !== undefined) {
        $el.onclick = options.click
    }
    if (options.style !== undefined) {
        Object.assign($el.style, options.style)
    }
    if (options.children !== undefined) {
        for (const child of options.children) {
            $el.appendChild(child)
        }
    }
    if (options.attrs !== undefined) {
        for (const prop in options.attrs) {
            $el.setAttribute(prop, options.attrs[prop] + '')
        }
    }

    return $el
}

export function initUI() {
    uiInit()

    // calledShot digit divs + cancel button live in ui_calledshot.ts → initCalledShot()

    /*
    $id("worldmapViewButton").onclick = () => {
        var onAreaMap = ($("#areamap").css("visibility") === "visible")
        if(onAreaMap)
            uiWorldMapWorldView()
        else {
            var currentArea = areaContainingMap(gMap.name)
            if(currentArea)
                uiWorldMapShowArea(currentArea)
            else
                uiWorldMapAreaView()
        }
    }
    */

    $id('optionsButton').onclick = () => {
        if (isOptionsOpen()) { closeOptionsMenu(); return }
        closeAllPanels()
        showOptionsMenu()
    }

    // lootBoxDoneButton wiring lives in ui_loot.ts → initLoot()

    $id('handSwapButton').onclick = () => {
        const p = globalState.player as any
        const player = globalState.player
        const nextHand: 'leftHand' | 'rightHand' = p.activeHand === 'leftHand' ? 'rightHand' : 'leftHand'
        player.playWeaponSwapAnim(() => {
            p.activeHand = nextHand
            uiDrawWeapon()
        })
    }

    /** Attempt to reload weaponObj from inventory. Returns true if rounds were loaded. */
    function reloadWeapon(weaponObj: Obj): boolean {
        const w = weaponObj as any
        const ammoPID: number | undefined = w.pro?.extra?.ammoPID
        const maxAmmo: number = w.pro?.extra?.maxAmmo ?? 0
        const currentRounds: number = w.pro?.extra?.rounds ?? 0
        if (maxAmmo <= 0 || currentRounds >= maxAmmo) return false

        // Find compatible ammo in inventory by matching pid
        const inv = globalState.player.inventory as any[]
        const ammoIdx = inv.findIndex((item) => item.pid === ammoPID)
        if (ammoIdx === -1) {
            uiLog("No compatible ammo in inventory.")
            return false
        }

        const ammoItem = inv[ammoIdx]
        const needed = maxAmmo - currentRounds
        const available: number = ammoItem.amount ?? 1
        const toLoad = Math.min(needed, available)

        w.pro.extra.rounds = currentRounds + toLoad
        ammoItem.amount = available - toLoad
        if (ammoItem.amount <= 0) inv.splice(ammoIdx, 1)

        uiLog(`Reloaded ${toLoad} round${toLoad !== 1 ? 's' : ''}.`)
        return true
    }

    $id('attackButtonContainer').onclick = () => {
        // Reload mode: immediately reload from inventory (AP cost in combat)
        const wep = globalState.player.equippedWeapon
        if (wep?.weapon?.mode === 'reload') {
            if (globalState.inCombat && globalState.player.AP) {
                const reloadAP = 2 // TODO: read from weapon PRO (reloadAP field)
                if (globalState.player.AP.getAvailableCombatAP() < reloadAP) {
                    uiLog("You don't have enough action points.")
                    return
                }
                globalState.player.AP.subtractCombatAP(reloadAP)
            }
            reloadWeapon(wep)
            wep.weapon.mode = 'single'
            uiDrawWeapon()
            return
        }

        if (!Config.engine.doCombat) {
            return
        }
        if (globalState.inCombat) {
            // clicking gun in combat → switch to attack cursor
            globalState.cursorMode = 'attack'
        } else {
            // begin combat and switch to attack cursor
            Combat.start()
            globalState.cursorMode = 'attack'
        }
    }

    $id('attackButtonContainer').oncontextmenu = () => {
        // right mouse button (cycle weapon modes)
        const wep = globalState.player.equippedWeapon
        if (!wep || !wep.weapon) {
            // Cycle unarmed mode
            const skill = globalState.player!.getSkill('Unarmed')
            globalState.unarmedModeIdx = nextUnarmedModeIdx(skill, globalState.unarmedModeIdx)
            const mode = getActiveUnarmedMode(skill, globalState.unarmedModeIdx)
            uiLog(`Unarmed: ${mode.name}`)
            uiDrawWeapon()
            return false
        }
        wep.weapon.cycleMode()
        uiDrawWeapon()
        return false
    }

    $id('endTurnButton').onclick = () => {
        if (globalState.inCombat && globalState.combat!.inPlayerTurn) {
            if (globalState.player.anim !== null && globalState.player.anim !== 'idle') {
                console.log("[Combat] can't end turn while player is in an animation")
                return
            }
            console.log('[Combat] player turn ended')
            globalState.combat!.nextTurn()
        }
    }

    $id('endCombatButton').onclick = () => {
        if (globalState.inCombat) {
            globalState.combat!.end()
        }
    }

    $id('endContainer').addEventListener('animationiteration', uiEndCombatAnimationDone)
    $id('endContainer').addEventListener('webkitAnimationIteration', uiEndCombatAnimationDone)

    $id('skilldexButton').onclick = () => {
        // Toggle: pressing while open closes it; otherwise close any other
        // open panel first and open skilldex.
        if (isSkilldexOpen()) { closeSkilldex(); return }
        closeAllPanels()
        showSkilldex()
    }

    function makeScrollable($el: HTMLElement, scroll = 60) {
        $el.onwheel = (e: WheelEvent) => {
            const delta = e.deltaY > 0 ? 1 : -1
            $el.scrollTop = $el.scrollTop + scroll * delta
            e.preventDefault()
        }
    }

    // inventoryBoxList scroll wiring lives in ui_inventory.ts → initInventory()

    makeScrollable($id('barterBoxInventoryLeft'))
    makeScrollable($id('barterBoxInventoryRight'))
    makeScrollable($id('barterBoxLeft'))
    makeScrollable($id('barterBoxRight'))
    makeScrollable($id('lootBoxLeft'))
    makeScrollable($id('lootBoxRight'))
    makeScrollable($id('worldMapLabels'))
    makeScrollable($id('displayLog'))
    makeScrollable($id('dialogueBoxReply'), 30)

    drawHP(globalState.player.getStat('HP'))
    drawAC(globalState.player.getStat('AC'))
    uiDrawWeapon()
}

// Right-click context menu (uiContextMenu / uiHideContextMenu) has moved to
// ui_contextmenu.ts.
//
// HUD bar (HP/AC/AP/weapon/combat-buttons/hover/log) has moved to ui_hud.ts
// and is re-exported from ui.ts above.

// Inventory panel (uiInventoryScreen, uiMoveSlot, applyArmorArt,
// makeDropTarget, makeDraggable, tryLoadAmmoIntoWeapon) has moved to
// ui_inventory.ts; ui_barter and ui_loot pull the dnd helpers from there.

// drawHP / drawAC / drawAP / drawDigits have moved to ui_hud.ts.

// Dialogue panel (uiStartDialogue / uiEndDialogue / uiSetDialogueReply /
// uiAddDialogueOption) and the uiAnimateBox slide-up helper have moved to
// ui_dialogue.ts; ui_barter pulls the slide-up animation from there.
//
// Barter screen (uiBarterMode + uiEndBarterMode) has moved to ui_barter.ts,
// along with the cross-list move helpers uiGetAmount / uiSwapItem.
//
// Loot screen (uiLoot + uiEndLoot) has moved to ui_loot.ts; ui_loot wires
// its own lootBoxDoneButton handler from initLoot().

// uiLog has moved to ui_hud.ts.
//
// World map (uiCloseWorldMap, uiWorldMap, uiWorldMapShowArea, internal
// area/world view + label-list helpers) has moved to ui_worldmap.ts.
//
// Elevator (uiElevator + internal uiElevatorDone) has moved to ui_elevator.ts.
//
// Called-shot screen (uiCalledShot + uiCloseCalledShot) has moved to
// ui_calledshot.ts; the static digit-divs and cancel button live in
// initCalledShot() called from uiInit.

// uiSaveLoad has moved to ui_saveload.ts — re-exported below.
