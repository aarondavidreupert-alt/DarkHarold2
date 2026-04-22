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
import { Area, Elevator, loadAreas, lookupMapNameFromLookup } from './data.js'
import globalState from './globalState.js'
import { Critter, Obj } from './object.js'
import { lookupInterfaceArt } from './pro.js'
import { Scripting } from './scripting.js'
import { fromTileNum } from './tile.js'
import { Worldmap } from './worldmap.js'
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
import {
    drawHP,
    drawAC,
    drawDigits,
    uiLog,
    uiDrawWeapon,
    uiUpdateCombatAP,
    uiEndCombatAnimationDone,
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
export {
    drawHP,
    drawAC,
    drawAP,
    uiLog,
    uiDrawWeapon,
    uiStartCombat,
    uiEndCombat,
    uiUpdateCombatAP,
    uiShowCombatHover,
    uiHideCombatHover,
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

    for (let i = 0; i < 2; i++) {
        for (const $chance of Array.from(document.querySelectorAll('#calledShotBox .calledShotChance'))) {
            $chance.appendChild(
                makeEl('div', { classes: ['number'], style: { left: i * 9 + 'px' }, id: 'digit' + (i + 1) })
            )
        }
    }

    $id('calledShotCancelBtn').onclick = () => {
        uiCloseCalledShot()
    }

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
                uiUpdateCombatAP()
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

function uiHideContextMenu() {
    globalState.uiMode = UIMode.none
    globalState.cursorMode = 'move'
    $id('itemContextMenu').style.visibility = 'hidden'
}

export { uiHideContextMenu }

export function uiContextMenu(obj: Obj, evt: any) {
    globalState.uiMode = UIMode.contextMenu

    function button(obj: Obj, action: string, onclick: (() => void) | undefined = undefined) {
        return makeEl('div', {
            id: 'context_' + action,
            classes: ['itemContextMenuButton'],
            click: () => {
                if (onclick) {
                    onclick()
                }
                uiHideContextMenu()
            },
        })
    }

    const $menu = $id('itemContextMenu')
    clearEl($menu)
    // #itemContextMenu lives inside #uiStage, which is centered via
    // transform: translate(-50%, -50%). Convert viewport-relative click
    // coords to the stage's local frame so the menu appears under the
    // cursor regardless of viewport size. (Same transform as
    // makeItemContextMenu below.)
    const stage = document.getElementById('uiStage')
    const rect = stage?.getBoundingClientRect()
    const lx = rect ? evt.clientX - rect.left : evt.clientX
    const ly = rect ? evt.clientY - rect.top : evt.clientY
    Object.assign($menu.style, {
        visibility: 'visible',
        left: `${lx}px`,
        top: `${ly}px`,
    })
    const cancelBtn = button(obj, 'cancel')
    const lookBtn = button(obj, 'look', () => uiLog('You see: ' + obj.getLookText()))
    const useBtn = button(obj, 'use', () => {
        globalState.player.walkInFrontOf(obj.position, () => {
            globalState.player.clearAnim()
            obj.use(globalState.player)
        })
    })
    const talkBtn = button(obj, 'talk', () => {
        console.log('[Dialog] talking to ' + obj.name)
        if (!obj._script) {
            console.warn('[Dialog] obj has no script')
            return
        }
        Scripting.talk(obj._script, obj)
    })
    const pickupBtn = button(obj, 'pickup', () => obj.pickup(globalState.player))
    const inventoryBtn = button(obj, 'inventory', () => showInventory())
    const skillBtn = button(obj, 'skill', () => {
        // Route through the panel system so skilldex obeys mutual-exclusion
        // with PipBoy / inventory / character / automap.
        if (isSkilldexOpen()) { closeSkilldex(); return }
        closeAllPanels()
        showSkilldex()
    })

    const isCritter = obj.type === 'critter'
    const isDead = isCritter && (obj as Critter).dead
    const hasTalk = obj._script && obj._script.talk_p_proc !== undefined

    if (isCritter && !isDead) {
        // Living critter: Talk (if available) → Use (if available) → Look → Cancel
        if (hasTalk) $menu.appendChild(talkBtn)
        if (obj.canUse) $menu.appendChild(useBtn)
        $menu.appendChild(lookBtn)
    } else if (isCritter && isDead) {
        // Dead critter: Look → Loot → Cancel
        const lootBtn = button(obj, 'pickup', () => uiLoot(obj))
        $menu.appendChild(lookBtn)
        $menu.appendChild(lootBtn)
    } else if ((obj.type === 'scenery' || obj.type === 'misc') && obj.canUse) {
        // Container/Scenery with canUse: Use → Look → Cancel
        $menu.appendChild(useBtn)
        $menu.appendChild(lookBtn)
    } else if (obj.isContainer) {
        // Container (type=item, subType=container): always show Use → Look → Cancel
        $menu.appendChild(useBtn)
        $menu.appendChild(lookBtn)
    } else if (obj.type === 'item') {
        // Item on the ground: Pickup → Look → Cancel
        $menu.appendChild(pickupBtn)
        $menu.appendChild(lookBtn)
    } else {
        // Fallback: Look → Cancel
        $menu.appendChild(lookBtn)
    }
    $menu.appendChild(inventoryBtn)
    $menu.appendChild(skillBtn)
    $menu.appendChild(cancelBtn)
}

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

function uiElevatorDone() {
    globalState.uiMode = UIMode.none
    hidev($id('elevatorBox'))

    // flip all buttons to hidden
    for (const $elevatorButton of $qa('.elevatorButton')) {
        hidev($elevatorButton)
        $elevatorButton.onclick = null
    }
    hidev($id('elevatorLabel'))
}

export function uiElevator(elevator: Elevator) {
    globalState.uiMode = UIMode.elevator
    const art = lookupInterfaceArt(elevator.type)
    console.log('[Elevator] art: ' + art)
    console.log('[Elevator] buttons: ' + elevator.buttonCount)

    if (elevator.labels !== -1) {
        const labelArt = lookupInterfaceArt(elevator.labels)
        console.log('[Elevator] label art: ' + labelArt)

        const $elevatorLabel = $id('elevatorLabel')
        showv($elevatorLabel)
        $elevatorLabel.style.backgroundImage = `url('${labelArt}.png')`
    }

    const $elevatorBox = $id('elevatorBox')
    showv($elevatorBox)
    $elevatorBox.style.backgroundImage = `url('${art}.png')`

    // flip the buttons we need visible
    for (let i = 1; i <= elevator.buttonCount; i++) {
        const $elevatorButton = $id('elevatorButton' + i)
        showv($elevatorButton)
        $elevatorButton.onclick = () => {
            // button `i` pushed
            // todo: animate positioner/spinner (and come up with a better name for that)

            const mapID = elevator.buttons[i - 1].mapID
            const level = Number(elevator.buttons[i - 1].level) || 0
            const position = fromTileNum(elevator.buttons[i - 1].tileNum)

            if (mapID !== globalState.gMap.mapID) {
                // different map
                console.log(`[Elevator] → map ${mapID}, level ${level} @ (${position.x}, ${position.y})`)
                globalState.gMap.loadMapByID(mapID, position, level)
            } else if (level !== globalState.currentElevation) {
                // same map, different elevation
                console.log(`[Elevator] → level ${level} @ (${position.x}, ${position.y})`)
                globalState.player.move(position)
                globalState.gMap.changeElevation(level, true)
            }

            // else, same elevation, do nothing
            uiElevatorDone()
        }
    }
}

export function uiCloseCalledShot() {
    globalState.uiMode = UIMode.none
    hide($id('calledShotBox'))
}

export function uiCalledShot(art: string, target: Critter, callback?: (regionHit: string) => void) {
    globalState.uiMode = UIMode.calledShot
    show($id('calledShotBox'))

    function drawChance(region: string) {
        let chance: any = Combat.prototype.getHitChance(globalState.player, target, region).hit
        console.log('[UI] called shot: id: %s | chance: %d', '#calledShot-' + region + '-chance #digit', chance)
        if (chance <= 0) {
            chance = '--'
        }
        drawDigits('#calledShot-' + region + '-chance #digit', chance, 2, false)
    }

    drawChance('torso')
    drawChance('head')
    drawChance('eyes')
    drawChance('groin')
    drawChance('leftArm')
    drawChance('rightArm')
    drawChance('leftLeg')
    drawChance('rightLeg')

    $id('calledShotBackground').style.backgroundImage = `url('${art}.png')`

    // Map region name to the Critter's crippled flag
    const crippledFlags: { [region: string]: keyof Critter } = {
        leftArm:  'crippledLeftArm',
        rightArm: 'crippledRightArm',
        leftLeg:  'crippledLeftLeg',
        rightLeg: 'crippledRightLeg',
    }

    for (const $label of $qa('.calledShotLabel')) {
        const id = ($label as HTMLElement).id
        const regionHit = id.split('-')[1]
        const crippledKey = crippledFlags[regionHit]
        const isCrippled = crippledKey ? !!(target as any)[crippledKey] : false

        if (isCrippled) {
            // Gray out crippled parts so the player knows they're already damaged
            Object.assign(($label as HTMLElement).style, {
                color: '#666666',
                textDecoration: 'line-through',
                cursor: 'default',
                pointerEvents: 'none',
            })
            const $chance = $id('calledShot-' + regionHit + '-chance')
            if ($chance) Object.assign(($chance as HTMLElement).style, { opacity: '0.4' })
        } else {
            // Reset styles (in case uiCalledShot is called multiple times)
            Object.assign(($label as HTMLElement).style, {
                color: '',
                textDecoration: '',
                cursor: '',
                pointerEvents: '',
            })
            $label.onclick = (evt: MouseEvent) => {
                const clickedRegion = (evt.target as HTMLElement).id.split('-')[1]
                console.log('[UI] called shot: clicked region %s', clickedRegion)
                if (callback) {
                    callback(clickedRegion)
                }
            }
        }
    }
}

// uiSaveLoad has moved to ui_saveload.ts — re-exported below.
