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

import { beginUseItemOn, itemCanUseOn } from './useItemOn.js'
import { ammoGetCapacity, ammoGetQuantity, weaponAttemptReload } from './weaponAmmo.js'
import { Combat } from './combat.js'
import globalState from './globalState.js'
import { dbg } from './logger.js'
import { Obj, objectIsWeapon } from './object.js'
import { Config } from './config.js'
import { openAutomap, closeAutomap, isAutomapOpen } from './ui_automap.js'
import { openPipBoy, closePipBoy, isPipBoyOpen } from './ui_pipboy.js'
import { cycleUnarmedAction } from './unarmed.js'
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
    drawAP,
    drawDigits,
    uiLog,
    uiDrawWeapon,
    uiEndCombatAnimationDone,
    initLogScrollZones,
    attackButtonDisabled,
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
    uiEndButtonsGreenLights,
    uiEndButtonsRedLights,
    uiEndButtonsClearLights,
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

import { $id, $img, $q, $qa, clearEl, show, hide, showv, hidev, off, appendHTML, makeEl } from './ui_dom.js'
// Preserve the existing public surface (worldmap.ts and ui_options.ts read
// these via `from './ui.js'`).
export { showv, hidev, makeEl } from './ui_dom.js'

// CE interface.cc interfaceBarSwapHands — the B key and the change-hand button.
export function swapHands(): void {
    const p = globalState.player as any
    const player = globalState.player
    const nextHand: 'leftHand' | 'rightHand' = p.activeHand === 'leftHand' ? 'rightHand' : 'leftHand'
    player.playWeaponSwapAnim(() => {
        p.activeHand = nextHand
        uiDrawWeapon()
    })
}

// CE interface.cc interfaceCycleItemAction — the N key and a right-click on the item
// button: a weapon's modes, or the unarmed hand's punch / kick moves.
export function cycleActiveItemAction(): void {
    const wep = globalState.player.equippedWeapon
    if (!wep || !wep.weapon) {
        const player = globalState.player!
        const activeHand: 'leftHand' | 'rightHand' = (player as any).activeHand ?? 'leftHand'
        const activeItem = (player as any)[activeHand] as Obj | undefined
        if (activeItem && !objectIsWeapon(activeItem)) return // non-weapon: one action
        cycleUnarmedAction(player)
        uiDrawWeapon()
        return
    }
    wep.weapon.cycleMode()
    uiDrawWeapon()
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

    $id('handSwapButton').onclick = () => swapHands()

    /** CE interface.cc _intface_item_reload — weaponAttemptReload box after box until the
     *  weapon is full or nothing fits; no message. Returns true if anything was loaded. */
    function reloadWeapon(weaponObj: Obj): boolean {
        const maxAmmo = ammoGetCapacity(weaponObj)
        if (maxAmmo <= 0 || ammoGetQuantity(weaponObj) >= maxAmmo) return false
        const inv = globalState.player.inventory
        let loaded = false
        while (weaponAttemptReload(weaponObj, inv) !== -1) loaded = true
        return loaded
    }

    $id('attackButtonContainer').onclick = () => {
        if (attackButtonDisabled()) return // CE buttonDisable(gSingleAttackButton)
        // Reload mode: immediately reload from inventory (AP cost in combat)
        const wep = globalState.player.equippedWeapon
        if (wep?.weapon?.mode === 'reload') {
            if (globalState.inCombat && globalState.player.AP) {
                const reloadAP = wep.weapon.getReloadAPCost() // CE ref: item.cc:1640
                if (globalState.player.AP.getAvailableCombatAP() < reloadAP) {
                    uiLog("You don't have enough action points.")
                    return
                }
                globalState.player.AP.subtractCombatAP(reloadAP)
                const ap = globalState.player.AP
                drawAP(ap.getAvailableCombatAP(), ap.getTotalMaxAP(), ap.move)
            }
            reloadWeapon(wep)
            wep.weapon.mode = 'single'
            uiDrawWeapon()
            return
        }

        if (!wep || !wep.weapon) {
            const player = globalState.player!
            const activeHand: 'leftHand' | 'rightHand' = (player as any).activeHand ?? 'leftHand'
            const activeItem = (player as any)[activeHand] as Obj | undefined

            // CE ref: interface.cc:1073-1078,1122-1127 — clicking a non-weapon
            // item's HUD slot fires INTERFACE_ITEM_ACTION_USE (the item's own
            // use_p_proc / engine handler), not the unarmed punch/kick cycle.
            if (activeItem && !objectIsWeapon(activeItem)) {
                // CE _intface_use_item: items used *on* something get the use
                // crosshair (USE_CROSSHAIR); others are used at once.
                if (itemCanUseOn(activeItem)) {
                    beginUseItemOn(activeItem)
                    return
                }
                activeItem.use(player)
                uiDrawWeapon()
                return
            }

            // Unarmed: the fist is a weapon in CE (isWeapon) — fall through to the
            // crosshair below; right-click cycles the punch/kick moves.
        }

        // CE ref: interface.cc _intface_use_item — a weapon (or the fist) not in reload
        // mode: crosshair cursor + GAME_MOUSE_MODE_CROSSHAIR, starting combat
        // (_combat) when not already in it.
        if (!Config.engine.doCombat) {
            return
        }
        if (!globalState.inCombat) Combat.start()
        globalState.cursorMode = 'attack'
        globalState.combat?.refreshHighlights()
    }

    $id('attackButtonContainer').oncontextmenu = () => {
        cycleActiveItemAction()
        return false
    }

    $id('endTurnButton').onclick = () => {
        if (globalState.inCombat && globalState.combat!.inPlayerTurn) {
            if (globalState.player.anim !== null && globalState.player.anim !== 'idle') {
                dbg('combat', "[Combat] can't end turn while player is in an animation")
                return
            }
            dbg('combat', '[Combat] player turn ended')
            globalState.combat!.nextTurn()
        }
    }

    $id('endCombatButton').onclick = () => {
        // CE combat.cc combatAttemptEnd
        if (globalState.inCombat) {
            globalState.combat!.attemptEnd()
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
