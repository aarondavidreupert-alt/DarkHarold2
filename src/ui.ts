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

import { makePanelDraggable } from './uiDrag.js'
import { beginUseItemOn, cancelUseItemOn, itemCanUseOn } from './useItemOn.js'
import { ammoGetCapacity, ammoGetQuantity, weaponAttemptReload } from './weaponAmmo.js'
import { Combat } from './combat.js'
import { world } from './state/world.js'
import { uiState } from './state/uiState.js'
import { services } from './state/services.js'
import { dbg } from './logger.js'
import { Obj, objectIsWeapon } from './object.js'
import { Config } from './config.js'
import { openAutomap, closeAutomap, isAutomapOpen } from './uiAutomap.js'
import { openPipBoy, closePipBoy, isPipBoyOpen } from './uiPipBoy.js'
import { cycleUnarmedAction } from './unarmed.js'
import { initOptionsMenu, getOptionsWindow, showOptionsMenu, closeOptionsMenu } from './uiOptions.js'
import { initSkilldex, getSkilldexWindow, showSkilldex, closeSkilldex } from './uiSkilldex.js'
import { initInventory } from './uiInventory.js'
import { showCharacterScreen, closeCharacterScreen, getCharacterWindow } from './uiCharacter.js'
import { initLoot } from './uiLoot.js'
import { initCalledShot } from './uiCalledShot.js'
import { drawHP, drawAC, drawAP, uiDrawWeapon, uiEndCombatAnimationDone, attackButtonDisabled } from './uiHud.js'
import {
    closeAllPanels,
    isCharacterOpen,
    isSkilldexOpen,
    isOptionsOpen,
    registerCharacterWindow,
    registerSkilldexWindow,
    registerOptionsWindow,
} from './uiPanels.js'
import { initUiContainer } from './uiContainer.js'

// --- Re-exports for external callers (keep `from './ui.js'` import sites
// working after individual panels were extracted into ui_*.ts modules) -----
export { Widget } from './uiWidget.js'
export type { CSSBoundingBox } from './uiWidget.js'
export { WindowFrame, SmallButton, Label, List } from './uiComponents.js'
export { uiSaveLoad } from './uiSaveLoad.js'
export { showMainMenu, hideMainMenu, isMainMenuVisible, initMainMenu } from './uiMainMenu.js'
export { initCharacterCreator } from './uiCharacterCreator.js'
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
} from './uiHud.js'
export { UIMode, closeAllPanels, isInventoryOpen, isCharacterOpen, isSkilldexOpen, isOptionsOpen } from './uiPanels.js'
export { showInventory as uiInventoryScreen } from './uiInventory.js'
export { showCharacterScreen, closeCharacterScreen, getCharacterWindow } from './uiCharacter.js'
export { uiStartDialogue, uiEndDialogue, uiSetDialogueReply, uiAddDialogueOption } from './uiDialogue.js'
export { uiBarterMode } from './uiBarter.js'
export { uiLoot } from './uiLoot.js'
export { uiWorldMap, uiCloseWorldMap, uiWorldMapShowArea } from './uiWorldmap.js'
export { uiElevator } from './uiElevator.js'
export { uiCalledShot, uiCloseCalledShot } from './uiCalledShot.js'
export { uiContextMenu, uiHideContextMenu } from './uiContextMenu.js'

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

    // DH2: the remaining windows can be dragged too (fallout2.cfg [dh2] drag_*)
    makePanelDraggable($id('lootBox'), 'loot') // loot, steal
    makePanelDraggable($id('dialogueContainer'), 'dialogue') // dialogue, barter, companion screens
    makePanelDraggable($id('elevatorBox'), 'elevator')
    makePanelDraggable($id('calledShotBox'), 'calledShot')
    makePanelDraggable($id('moveMultBox'), 'moveItems')

    const chrBtn = document.getElementById('chrButton')
    if (chrBtn) {
        chrBtn.onclick = () => {
            // Toggle: pressing while open closes it.
            if (isCharacterOpen()) {
                closeCharacterScreen()
                return
            }
            closeAllPanels()
            showCharacterScreen()
        }
    }

    // CE interface.cc interfaceInit: the bar's buttons sound _gsound_med_butt_press /
    // _release (ib2p1xx1 / ib2lu1x1), the item button the large pair (ib3…); the
    // inventory button is wired in uiInventory/panel.ts
    const barSounds = (id: string, press: string, release: string) => {
        const el = document.getElementById(id)
        if (!el) return
        el.addEventListener('mousedown', (e) => {
            if (e.button === 0) services.audioEngine?.playSfxByName?.(press)
        })
        el.addEventListener('mouseup', (e) => {
            if (e.button === 0) services.audioEngine?.playSfxByName?.(release)
        })
    }
    for (const id of ['optionsButton', 'skilldexButton', 'mapButton', 'pipBoyButton', 'chrButton', 'handSwapButton']) {
        barSounds(id, 'ib2p1xx1', 'ib2lu1x1')
    }
    barSounds('attackButtonContainer', 'ib3p1xx1', 'ib3lu1x1')

    document.getElementById('pipBoyButton')!.onclick = () => {
        if (isPipBoyOpen()) {
            closePipBoy()
            return
        }
        closeAllPanels()
        openPipBoy()
    }

    document.getElementById('mapButton')!.onclick = () => {
        if (isAutomapOpen()) {
            closeAutomap()
            return
        }
        closeAllPanels()
        openAutomap()
    }
}

// Panel mutual-exclusion helpers have been moved to uiPanels.ts and are
// re-exported above. closeInventoryPanel/uiInventoryScreen now live in
// uiInventory.ts; uiInventory wires its own registerCloseInventoryPanel()
// during initInventory().
//
// initSkilldex() has moved to uiSkilldex.ts.
// initOptionsMenu() has moved to uiOptions.ts.
// initCharacterScreen() has moved to uiCharacter.ts as showCharacterScreen().

import { $id } from './uiDom.js'
// Preserve the existing public surface (worldmap.ts and uiOptions.ts read
// these via `from './ui.js'`).
export { showv, hidev, makeEl } from './uiDom.js'

// CE interface.cc interfaceBarSwapHands — the B key and the change-hand button.
export function swapHands(): void {
    const p = world.player as any
    const player = world.player
    const nextHand: 'leftHand' | 'rightHand' = p.activeHand === 'leftHand' ? 'rightHand' : 'leftHand'
    player!.playWeaponSwapAnim(() => {
        p.activeHand = nextHand
        uiDrawWeapon()
    })
    // CE: the crosshair and the use-item crosshair go back to the move cursor
    if (uiState.cursorMode === 'useItem') cancelUseItemOn()
    if (uiState.cursorMode === 'attack' || uiState.cursorMode === 'useItem') uiState.cursorMode = 'move'
}

// CE interface.cc interfaceCycleItemAction — the N key and a right-click on the item
// button: a weapon's modes, or the unarmed hand's punch / kick moves.
export function cycleActiveItemAction(): void {
    const wep = world.player!.equippedWeapon
    if (!wep || !wep.weapon) {
        const player = world.player!
        const activeHand: 'leftHand' | 'rightHand' = player.activeHand ?? 'leftHand'
        const activeItem = player[activeHand] as Obj | undefined
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

    // calledShot digit divs + cancel button live in uiCalledShot.ts → initCalledShot()

    $id('optionsButton').onclick = () => {
        if (isOptionsOpen()) {
            closeOptionsMenu()
            return
        }
        closeAllPanels()
        showOptionsMenu()
    }

    // lootBoxDoneButton wiring lives in uiLoot.ts → initLoot()

    $id('handSwapButton').onclick = () => swapHands()

    /** CE interface.cc _intface_item_reload — weaponAttemptReload box after box until the
     *  weapon is full or nothing fits; no message. Returns true if anything was loaded. */
    function reloadWeapon(weaponObj: Obj): boolean {
        const maxAmmo = ammoGetCapacity(weaponObj)
        if (maxAmmo <= 0 || ammoGetQuantity(weaponObj) >= maxAmmo) return false
        const inv = world.player!.inventory
        let loaded = false
        while (weaponAttemptReload(weaponObj, inv) !== -1) loaded = true
        return loaded
    }

    $id('attackButtonContainer').onclick = () => {
        if (attackButtonDisabled()) return // CE buttonDisable(gSingleAttackButton)
        // Reload mode: immediately reload from inventory (AP cost in combat)
        const wep = world.player!.equippedWeapon
        if (wep?.weapon?.mode === 'reload') {
            // CE interface.cc _intface_use_item (RELOAD): in combat nothing happens without the
            // AP; the AP go only when something loaded. _intface_item_reload plays the weapon's
            // ready sound.
            const ap = world.inCombat ? world.player!.AP : null
            const reloadAP = wep.weapon.getReloadAPCost() // CE ref: item.cc:1640
            if (ap && ap.getAvailableCombatAP() < reloadAP) return
            if (reloadWeapon(wep)) {
                const soundID = wep.pro?.extra?.soundID
                if (typeof soundID === 'number')
                    services.audioEngine?.playWeaponSfx(String.fromCharCode(soundID), 'reload')
                if (ap) {
                    ap.subtractCombatAP(reloadAP)
                    drawAP(ap.getAvailableCombatAP(), ap.getTotalMaxAP(), ap.move)
                }
            }
            wep.weapon.mode = 'single'
            uiDrawWeapon()
            return
        }

        if (!wep || !wep.weapon) {
            const player = world.player!
            const activeHand: 'leftHand' | 'rightHand' = player.activeHand ?? 'leftHand'
            const activeItem = player[activeHand] as Obj | undefined

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
        if (!world.inCombat) Combat.start()
        uiState.cursorMode = 'attack'
        world.combat?.refreshHighlights()
    }

    $id('attackButtonContainer').oncontextmenu = () => {
        cycleActiveItemAction()
        return false
    }

    $id('endTurnButton').onclick = () => {
        if (world.inCombat && world.combat!.inPlayerTurn) {
            if (world.player!.anim !== null && world.player!.anim !== 'idle') {
                dbg('combat', "[Combat] can't end turn while player is in an animation")
                return
            }
            dbg('combat', '[Combat] player turn ended')
            world.combat!.nextTurn()
        }
    }

    $id('endCombatButton').onclick = () => {
        // CE combat.cc combatAttemptEnd
        if (world.inCombat) {
            world.combat!.attemptEnd()
        }
    }

    $id('endContainer').addEventListener('animationiteration', uiEndCombatAnimationDone)
    $id('endContainer').addEventListener('webkitAnimationIteration', uiEndCombatAnimationDone)

    $id('skilldexButton').onclick = () => {
        // Toggle: pressing while open closes it; otherwise close any other
        // open panel first and open skilldex.
        if (isSkilldexOpen()) {
            closeSkilldex()
            return
        }
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

    // inventoryBoxList scroll wiring lives in uiInventory.ts → initInventory()

    makeScrollable($id('barterBoxInventoryLeft'))
    makeScrollable($id('barterBoxInventoryRight'))
    makeScrollable($id('barterBoxLeft'))
    makeScrollable($id('barterBoxRight'))
    makeScrollable($id('lootBoxLeft'))
    makeScrollable($id('lootBoxRight'))
    makeScrollable($id('worldMapLabels'))
    makeScrollable($id('displayLog'))
    makeScrollable($id('dialogueBoxReply'), 30)

    drawHP(world.player!.getStat('HP'))
    drawAC(world.player!.getStat('AC'))
    uiDrawWeapon()
}

// Right-click context menu (uiContextMenu / uiHideContextMenu) has moved to
// uiContextMenu.ts.
//
// HUD bar (HP/AC/AP/weapon/combat-buttons/hover/log) has moved to uiHud.ts
// and is re-exported from ui.ts above.

// Inventory panel (uiInventoryScreen, uiMoveSlot, applyArmorArt,
// makeDropTarget, makeDraggable, tryLoadAmmoIntoWeapon) has moved to
// uiInventory.ts; uiBarter and uiLoot pull the dnd helpers from there.

// drawHP / drawAC / drawAP / drawDigits have moved to uiHud.ts.

// Dialogue panel (uiStartDialogue / uiEndDialogue / uiSetDialogueReply /
// uiAddDialogueOption) and the uiAnimateBox slide-up helper have moved to
// uiDialogue.ts; uiBarter pulls the slide-up animation from there.
//
// Barter screen (uiBarterMode + uiEndBarterMode) has moved to uiBarter.ts,
// along with the cross-list move helpers uiGetAmount / uiSwapItem.
//
// Loot screen (uiLoot + uiEndLoot) has moved to uiLoot.ts; uiLoot wires
// its own lootBoxDoneButton handler from initLoot().

// uiLog has moved to uiHud.ts.
//
// World map (uiCloseWorldMap, uiWorldMap, uiWorldMapShowArea, internal
// area/world view + label-list helpers) has moved to uiWorldmap.ts.
//
// Elevator (uiElevator + internal uiElevatorDone) has moved to uiElevator.ts.
//
// Called-shot screen (uiCalledShot + uiCloseCalledShot) has moved to
// uiCalledShot.ts; the static digit-divs and cancel button live in
// initCalledShot() called from uiInit.

// uiSaveLoad has moved to uiSaveLoad.ts — re-exported below.
