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

// Loot screen: two-column inventory view (player on the left, container or
// dead critter on the right) with drag-and-drop and a "take all" button.

import globalState from './globalState.js'
import { dbg } from './logger.js'
import { itemIsHidden, Obj } from './object.js'
import { UIMode } from './uiMode.js'
import { uiGetAmount, uiSwapItem } from './uiBarter.js'
import { renderBarterPortrait } from './uiBarter/screen.js'
import { uiLog } from './messageLog.js'
import { getMessage } from './util.js'
import { showAlert } from './uiDialog.js'
import * as Scripting from './scripting.js'
import {
    drawBagView,
    examineToLog,
    itemMenuActions,
    makeDropTarget,
    makeDraggable,
    MAX_OPEN_BAGS,
    showItemMenu,
    unloadWeapon,
    itemCountLabel,
} from './uiInventory.js'
import { appendItemSlot, $id, clearEl, showv, hidev, off, makeEl } from './uiDom.js'

// --- Loot screen -----------------------------------------------------------

function uiEndLoot() {
    globalState.uiMode = UIMode.none

    hidev($id('lootBox'))
    off($id('lootBoxLeft'), 'drop dragenter dragover')
    off($id('lootBoxRight'), 'drop dragenter dragover')
    off($id('lootBoxTakeAllButton'), 'click')
}

/**
 * Wire static DOM event handlers (Done button) for the loot panel.
 * Call once during uiInit().
 */
export function initLoot(): void {
    $id('lootBoxDoneButton').onclick = () => {
        uiEndLoot()
    }
}

export function uiLoot(object: Obj) {
    // CE inventory.cc inventoryOpenLooting pre-checks: a CRITTER_NO_STEAL critter →
    // inventry.msg 50; then the target's pickup_p_proc (source = the looter), whose
    // script_overrides keeps the window closed.
    if (object.type === 'critter' && ((object.pro?.extra?.flags ?? 0) & 0x20) !== 0) {
        uiLog(getMessage('inventry', 50) ?? "You can't find anything to take from that.")
        return
    }
    if (object._script?.pickup_p_proc && globalState.player) {
        let overridden = false
        try {
            overridden = Scripting.pickup(object, globalState.player)
        } catch (e) {
            dbg('inventory', '[Loot] pickup_p_proc error: ' + e)
        }
        if (overridden) return
    }

    globalState.uiMode = UIMode.loot
    $id('lootBoxTakeAllButton').style.visibility = '' // shown with the window (a steal hides it)

    // CE inventory.cc _container_enter in the loot window: each side can open its bags (up to
    // 9 deep); the body view (CE INVENTORY_LOOT_LEFT / RIGHT_BODY_VIEW) shows the open one
    const leftBags: Obj[] = []
    const rightBags: Obj[] = []
    const leftList = () => (leftBags.length ? leftBags[leftBags.length - 1].inventory : globalState.player!.inventory)
    const rightList = () => (rightBags.length ? rightBags[rightBags.length - 1].inventory : object.inventory)

    async function uiLootMove(data: string /* "l"|"r" */, where: 'left' | 'right') {
        dbg('inventory', `[Loot] move ${data} to ${where}`)

        const from = { l: leftList(), r: rightList() }[data[0]]

        if (from === undefined) {
            throw new Error('uiLootMove: wrong data: ' + data)
        }

        const idx = parseInt(data.slice(1))
        const obj = from[idx]
        if (obj === undefined) {
            throw new Error('uiLootMove: obj not found in list (' + idx + ')')
        }

        const to = { left: leftList(), right: rightList() }[where]

        if (to === undefined) {
            throw new Error('uiLootMove: invalid location: ' + where)
        } else if (to === from) {
            // object -> same location
            return
        }

        const wantedAmount = obj.amount > 1 ? await uiGetAmount(obj) : 1
        // CE ref: item.cc itemAttemptAdd — enforce STAT_CARRY_WEIGHT on the receiving critter.
        const toBag = where === 'left' ? leftBags[leftBags.length - 1] : rightBags[rightBags.length - 1]
        const toOwner: any = toBag ?? (where === 'left' ? globalState.player! : object)
        // (an open bag of the dude's: its room and the dude's carry weight, CE itemAttemptAdd)
        const tooHeavy =
            toBag &&
            where === 'left' &&
            from !== globalState.player!.inventory &&
            !globalState.player!.canCarry(obj, wantedAmount)
        if (wantedAmount > 0 && (tooHeavy || !toOwner.canCarry?.(obj, wantedAmount))) {
            // CE ref: inventory.cc:4622/4657 — msg 26 when the container is full,
            // msg 25 when the player is over their weight capacity.
            uiLog(
                where === 'left'
                    ? (getMessage('inventry', 25) ??
                          'You cannot pick that up. You are at your maximum weight capacity.')
                    : (getMessage('inventry', 26) ?? 'There is no space left for that item.'),
            )
            return
        }
        uiSwapItem(from, obj, to, wantedAmount)
        drawLoot()
    }

    function drawInventory($el: HTMLElement, who: 'p' | 'm' | 'l' | 'r', objects: Obj[]) {
        clearEl($el)

        // CE inventory.cc _display_inventory: newest first (items[length − (i + offset + 1)])
        for (let i = objects.length - 1; i >= 0; i--) {
            // CE inventory.cc itemMoveAllHidden: natural weapons aren't shown
            if (itemIsHidden(objects[i])) continue
            const inventoryImage = objects[i].invArt
            const img = makeEl('img', {
                src: inventoryImage + '.png',
                attrs: { title: objects[i].name },
                style: {
                    maxWidth: '100%',
                    maxHeight: '60px',
                    objectFit: 'contain',
                    display: 'inline-block',
                    verticalAlign: 'middle',
                },
            })
            appendItemSlot($el, img, itemCountLabel(objects[i]))
            makeDraggable(img, who + i)
            // CE inventoryWindowOpenContextMenu (loot window)
            const item = objects[i]
            const ownerIsDude = who === 'l'
            img.oncontextmenu = (e: MouseEvent) => {
                e.preventDefault()
                showItemMenu(e, itemMenuActions(item, false, ownerIsDude), (action) => {
                    const bags = ownerIsDude ? leftBags : rightBags
                    const owner = bags[bags.length - 1] ?? (ownerIsDude ? globalState.player : object)
                    if (action === 'use' && item.subtype === 'container') {
                        if (bags.length < MAX_OPEN_BAGS) bags.push(item)
                    } else if (action === 'look') examineToLog(item)
                    else if (action === 'unload') unloadWeapon(item, (ammo) => owner.addInventoryItem(ammo, 1))
                    else if (action === 'drop') {
                        const list = ownerIsDude ? leftList() : rightList()
                        if (list !== globalState.player!.inventory) {
                            list.splice(list.indexOf(item), 1)
                            globalState.player!.inventory.push(item)
                        }
                        item.drop(globalState.player!)
                    }
                    drawLoot()
                })
                return false
            }
        }
    }

    dbg('inventory', '[Loot] opening loot screen')

    showv($id('lootBox'))

    // loot drop targets
    makeDropTarget($id('lootBoxLeft'), (data: string) => {
        uiLootMove(data, 'left')
    })
    makeDropTarget($id('lootBoxRight'), (data: string) => {
        uiLootMove(data, 'right')
    })

    // CE inventoryOpenLooting KEY_UPPERCASE_A (the TAKE ALL button sends it too): everything
    // or nothing — the target's whole inventory weight against the room left, else inventry.msg 31
    $id('lootBoxTakeAllButton').onclick = () => {
        dbg('inventory', '[Loot] take all')
        const player = globalState.player!
        if (object.getInventoryWeight() > player.getStat('Carry') - player.getInventoryWeight()) {
            void showAlert(getMessage('inventry', 31) ?? 'Sorry, you cannot carry that much.')
            return
        }
        for (const item of object.inventory.slice()) uiSwapItem(object.inventory, item, player.inventory, item.amount)
        drawLoot()
    }

    function drawLoot() {
        drawInventory($id('lootBoxLeft'), 'l', leftList())
        drawInventory($id('lootBoxRight'), 'r', rightList())
        drawLootBagViews(leftBags, rightBags, drawLoot, globalState.player ?? undefined, object)
    }

    drawLoot()
}

// the loot (and steal) window's body views: CE INVENTORY_LOOT_LEFT / RIGHT_BODY_VIEW. CE
// _display_body(target->fid, LOOT): the dude at (48, 39) facing south-west, frame 0; the
// target at (426, 39) in its own rotation on the last frame of its art (a corpse lies);
// an open bag takes the spot instead.
export function drawLootBagViews(leftBags: Obj[], rightBags: Obj[], redraw: () => void, left?: Obj, right?: Obj): void {
    const body = (id: string, x: number, who: Obj | undefined, lastFrame: boolean): HTMLElement | undefined => {
        if (!who) return undefined
        let $b = document.getElementById(id)
        if (!$b) {
            $b = makeEl('div', { attrs: { id }, style: { position: 'absolute', pointerEvents: 'none', zIndex: '1' } })
            $id('lootBox').appendChild($b)
        }
        Object.assign($b.style, { left: x + 'px', top: '39px', width: '60px', height: '100px' })
        clearEl($b)
        renderBarterPortrait($b, who as any, lastFrame)
        return $b
    }
    const leftBody = body('lootBoxLeftBody', 48, left, false)
    const rightBody = body('lootBoxRightBody', 426, right, true)
    drawBagView(
        $id('lootBox'),
        'lootBoxLeftBag',
        { left: 44, top: 35, width: 60, height: 100 },
        leftBags,
        redraw,
        leftBody,
    )
    drawBagView(
        $id('lootBox'),
        'lootBoxRightBag',
        { left: 422, top: 35, width: 60, height: 100 },
        rightBags,
        redraw,
        rightBody,
    )
}

// CE inventoryOpenLooting's keys (the steal window too): Esc closes, A (Shift+A) takes all
export function lootKey(e: KeyboardEvent): boolean {
    const quantity = document.getElementById('moveMultOverlay') // the quantity window has its own keys
    if (quantity && getComputedStyle(quantity).display !== 'none') return false
    if (e.key === 'Escape') {
        $id('lootBoxDoneButton').click()
        return true
    }
    if (e.key === 'A') {
        const takeAll = $id('lootBoxTakeAllButton')
        if (takeAll.style.visibility !== 'hidden') takeAll.click() // (none while stealing)
        return true
    }
    return false
}
