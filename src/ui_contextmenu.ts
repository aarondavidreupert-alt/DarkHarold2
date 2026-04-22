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

// Right-click "what would you like to do?" context menu shown above an
// in-world Obj. Per object type/state, picks an appropriate set of action
// buttons (talk / use / look / pickup / loot) plus the always-visible
// inventory and skill (skilldex) buttons.

import globalState from './globalState.js'
import { Critter, Obj } from './object.js'
import { Scripting } from './scripting.js'
import { uiLog } from './ui_hud.js'
import { showInventory } from './ui_inventory.js'
import { uiLoot } from './ui_loot.js'
import { closeSkilldex, showSkilldex } from './ui_skilldex.js'
import { UIMode, closeAllPanels, isSkilldexOpen } from './ui_panels.js'

function $id(id: string): HTMLElement {
    return document.getElementById(id)!
}

function clearEl($el: HTMLElement): void {
    $el.innerHTML = ''
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

function makeEl(tag: string, options: ElementOptions): HTMLElement {
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

export function uiHideContextMenu() {
    globalState.uiMode = UIMode.none
    globalState.cursorMode = 'move'
    $id('itemContextMenu').style.visibility = 'hidden'
}

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
