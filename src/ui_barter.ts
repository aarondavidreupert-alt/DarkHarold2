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

// Bartering screen: working copies of the player + merchant inventories,
// two trade tables, value totals, drop targets for shuffling items between
// the four lists. Pops up over the dialogue container by sliding the
// dialogueBox down and the barterBox up.
//
// Also exports uiGetAmount (movemult.png slider modal) and uiSwapItem,
// the cross-list move helper, both shared with the loot screen.

import globalState from './globalState.js'
import { Critter, cloneItem, Obj } from './object.js'
import { Scripting } from './scripting.js'
import { UIMode } from './ui_panels.js'
import { uiAnimateBox } from './ui_dialogue.js'
import { makeDropTarget, makeDraggable } from './ui_inventory.js'

// --- DOM helpers (mirrors the ones in ui.ts) -------------------------------

function $id(id: string): HTMLElement {
    return document.getElementById(id)!
}

function clearEl($el: HTMLElement): void {
    $el.innerHTML = ''
}

function off($el: HTMLElement, events: string): void {
    const eventList = events.split(' ')
    for (const event of eventList) {
        ;(<any>$el)['on' + event] = null
    }
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

// --- Cross-list move helpers (also used by ui_loot) ------------------------

/**
 * Movemult.png slider modal — asks the player how many of `item` to move
 * when the stack has more than one. Resolves to 0 on cancel.
 */
export function uiGetAmount(item: Obj): Promise<number> {
    // Fallout 2 "Move Items" dialog using movemult.png as background
    // movemult.png is 169×60 in the original game
    const DIALOG_W = 169
    const DIALOG_H = 60

    return new Promise((resolve) => {
        const overlay = document.createElement('div')
        Object.assign(overlay.style, {
            position: 'absolute',
            left: '0', top: '0', width: '100%', height: '100%',
            zIndex: '50',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
        })

        const modal = document.createElement('div')
        Object.assign(modal.style, {
            position: 'relative',
            width: `${DIALOG_W}px`,
            height: `${DIALOG_H}px`,
            backgroundImage: "url('art/intrface/movemult.png')",
            backgroundSize: `${DIALOG_W}px ${DIALOG_H}px`,
            backgroundRepeat: 'no-repeat',
            fontFamily: "'VT323', monospace",
        })

        // Number display — centered near the top of the dialog
        const numDisplay = document.createElement('div')
        Object.assign(numDisplay.style, {
            position: 'absolute',
            left: '0', top: '5px', width: '100%',
            textAlign: 'center',
            color: '#00FF00',
            fontSize: '14px',
            pointerEvents: 'none',
        })
        numDisplay.textContent = String(item.amount)

        // Slider — positioned across the middle of the dialog
        const slider = document.createElement('input')
        slider.type = 'range'
        slider.min = '1'
        slider.max = String(item.amount)
        slider.value = String(item.amount)
        Object.assign(slider.style, {
            position: 'absolute',
            left: '12px', top: '22px',
            width: `${DIALOG_W - 24}px`,
            accentColor: '#00AA00',
            cursor: 'pointer',
        })
        slider.oninput = () => {
            numDisplay.textContent = slider.value
        }

        function cleanup(amount: number) {
            overlay.remove()
            resolve(amount)
        }

        // OK button — bottom left
        const okBtn = document.createElement('div')
        okBtn.textContent = 'OK'
        Object.assign(okBtn.style, {
            position: 'absolute',
            left: '20px', bottom: '4px',
            color: '#00FF00',
            fontSize: '12px',
            cursor: 'pointer',
            padding: '0 6px',
        })
        okBtn.onmouseenter = () => { okBtn.style.color = '#FCFC7C' }
        okBtn.onmouseleave = () => { okBtn.style.color = '#00FF00' }
        okBtn.onclick = () => {
            const val = parseInt(slider.value)
            if (isNaN(val) || val < 1 || val > item.amount) return
            cleanup(val)
        }

        // Cancel button — bottom right
        const cancelBtn = document.createElement('div')
        cancelBtn.textContent = 'Cancel'
        Object.assign(cancelBtn.style, {
            position: 'absolute',
            right: '20px', bottom: '4px',
            color: '#00FF00',
            fontSize: '12px',
            cursor: 'pointer',
            padding: '0 6px',
        })
        cancelBtn.onmouseenter = () => { cancelBtn.style.color = '#FF4444' }
        cancelBtn.onmouseleave = () => { cancelBtn.style.color = '#00FF00' }
        cancelBtn.onclick = () => cleanup(0)

        slider.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') okBtn.click()
            if (e.key === 'Escape') cancelBtn.click()
        }

        modal.appendChild(numDisplay)
        modal.appendChild(slider)
        modal.appendChild(okBtn)
        modal.appendChild(cancelBtn)
        overlay.appendChild(modal)
        $id('game-container').appendChild(overlay)
        slider.focus()
    })
}

function _uiAddItem(items: Obj[], item: Obj, count: number) {
    for (let i = 0; i < items.length; i++) {
        if (items[i].approxEq(item)) {
            items[i].amount += count
            return
        }
    }

    // no existing item, add new inventory object
    items.push(item.clone().setAmount(count))
}

export function uiSwapItem(a: Obj[], item: Obj, b: Obj[], amount: number) {
    // swap item from a -> b
    if (amount === 0) {
        return
    }

    let idx = -1
    for (let i = 0; i < a.length; i++) {
        if (a[i].approxEq(item)) {
            idx = i
            break
        }
    }
    if (idx === -1) {
        throw 'item (' + item + ') does not exist in a'
    }

    if (amount < item.amount) {
        // deduct amount from a and give amount to b
        item.amount -= amount
    }
    // just swap them
    else {
        a.splice(idx, 1)
    }

    // add the item to b
    _uiAddItem(b, item, amount)
}

// --- Barter screen ---------------------------------------------------------

function uiEndBarterMode() {
    const $barterBox = $id('barterBox')

    uiAnimateBox($barterBox, null, 480, () => {
        $barterBox.style.visibility = 'hidden'
        $barterBox.style.display = 'none'
        $barterBox.style.pointerEvents = 'none'
        off($id('barterBoxLeft'), 'drop dragenter dragover')
        off($id('barterBoxRight'), 'drop dragenter dragover')
        off($id('barterBoxInventoryLeft'), 'drop dragenter dragover')
        off($id('barterBoxInventoryRight'), 'drop dragenter dragover')
        off($id('barterTalkButton'), 'click')
        off($id('barterOfferButton'), 'click')

        // Re-enter dialogue: re-trigger the NPC's talk_p_proc to present
        // fresh dialogue options (the old ones were cleared when we entered barter)
        Scripting.reenterDialogue()
    })
}

export function uiBarterMode(merchant: Critter) {
    globalState.uiMode = UIMode.barter

    // Keep the TV screen (dialogueContainer) visible — only hide the dialogue panel
    $id('dialogueContainer').style.visibility = 'visible'

    // Hide dialogue panel (animate down), keep TV screen above
    const $dialogueBox = $id('dialogueBox')
    uiAnimateBox($dialogueBox, null, 480, () => {
        $dialogueBox.style.visibility = 'hidden'
        console.log('[Barter] popping up barter box')

        // Pop up the bartering screen (animate up)
        const $barterBox = $id('barterBox')
        $barterBox.style.display = ''
        $barterBox.style.visibility = 'visible'
        $barterBox.style.pointerEvents = 'auto'
        uiAnimateBox($barterBox, 480, 290)
    })

    // logic + UI for bartering
    // TODO: would it be better if we dropped the "working" copies?

    // a copy of inventories for both parties
    let workingPlayerInventory = globalState.player.inventory.map(cloneItem)
    let workingMerchantInventory = merchant.inventory.map(cloneItem)

    // and our working barter tables
    let playerBarterTable: Obj[] = []
    let merchantBarterTable: Obj[] = []

    function totalAmount(objects: Obj[]): number {
        let total = 0
        for (let i = 0; i < objects.length; i++) {
            total += objects[i].pro.extra.cost * objects[i].amount
        }
        return total
    }

    // TODO: checkOffer() or some-such
    function offer() {
        console.log('[Barter] offer')

        const merchantOffered = totalAmount(merchantBarterTable)
        const playerOffered = totalAmount(playerBarterTable)
        // apply per-dialogue barter markup set by gdialog_set_barter_mod
        // ref: fallout2-ce barter.cc — mod shifts the effective price the merchant accepts
        const barterMod = Scripting.getDialogueBarterMod()
        const merchantNeed = Math.ceil(merchantOffered * (100 + barterMod) / 100)

        if (playerOffered >= merchantNeed) {
            // OK, player offered equal to more more than the value
            console.log('[Barter] offer accepted')

            // finalize and apply the deal

            // swap to working inventories
            merchant.inventory = workingMerchantInventory
            globalState.player.inventory = workingPlayerInventory

            // add in the table items
            for (let i = 0; i < merchantBarterTable.length; i++) {
                globalState.player.addInventoryItem(merchantBarterTable[i], merchantBarterTable[i].amount)
            }
            for (let i = 0; i < playerBarterTable.length; i++) {
                merchant.addInventoryItem(playerBarterTable[i], playerBarterTable[i].amount)
            }

            // re-clone so we can continue bartering if necessary
            workingPlayerInventory = globalState.player.inventory.map(cloneItem)
            workingMerchantInventory = merchant.inventory.map(cloneItem)

            playerBarterTable = []
            merchantBarterTable = []

            redrawBarterInventory()
        } else {
            console.log('[Barter] offer refused')
        }
    }

    function drawInventory($el: HTMLElement, who: 'p' | 'm' | 'l' | 'r', objects: Obj[]) {
        clearEl($el)

        for (let i = 0; i < objects.length; i++) {
            const inventoryImage = objects[i].invArt
            const img = makeEl('img', {
                src: inventoryImage + '.png',
                attrs: { title: objects[i].name },
                style: { maxWidth: '72px', maxHeight: '60px', objectFit: 'contain', display: 'inline-block', verticalAlign: 'middle' },
            })
            $el.appendChild(img)
            $el.insertAdjacentHTML('beforeend', 'x' + objects[i].amount)
            makeDraggable(img, who + i)
        }
    }

    async function uiBarterMove(data: string, where: 'left' | 'right' | 'leftInv' | 'rightInv') {
        console.log('[Barter] move ' + data + ' to ' + where)

        const from = (
            {
                p: workingPlayerInventory,
                m: workingMerchantInventory,
                l: playerBarterTable,
                r: merchantBarterTable,
            } as any
        )[data[0]]

        if (from === undefined) {
            throw 'uiBarterMove: wrong data: ' + data
        }

        const idx = parseInt(data.slice(1))
        const obj = from[idx]
        if (obj === undefined) {
            throw 'uiBarterMove: obj not found in list (' + idx + ')'
        }

        // player inventory -> left table or player inventory
        if (data[0] === 'p' && where !== 'left' && where !== 'leftInv') {
            return
        }

        // merchant inventory -> right table or merchant inventory
        if (data[0] === 'm' && where !== 'right' && where !== 'rightInv') {
            return
        }

        const to = {
            left: playerBarterTable,
            right: merchantBarterTable,
            leftInv: workingPlayerInventory,
            rightInv: workingMerchantInventory,
        }[where]

        if (to === undefined) {
            throw 'uiBarterMove: invalid location: ' + where
        } else if (to === from) {
            // table -> same table
            return
        } else if (obj.amount > 1) {
            uiSwapItem(from, obj, to, await uiGetAmount(obj))
        } else {
            uiSwapItem(from, obj, to, 1)
        }

        redrawBarterInventory()
    }

    // bartering drop targets
    makeDropTarget($id('barterBoxLeft'), (data: string) => {
        uiBarterMove(data, 'left')
    })
    makeDropTarget($id('barterBoxRight'), (data: string) => {
        uiBarterMove(data, 'right')
    })
    makeDropTarget($id('barterBoxInventoryLeft'), (data: string) => {
        uiBarterMove(data, 'leftInv')
    })
    makeDropTarget($id('barterBoxInventoryRight'), (data: string) => {
        uiBarterMove(data, 'rightInv')
    })

    $id('barterTalkButton').onclick = uiEndBarterMode
    $id('barterOfferButton').onclick = offer

    function redrawBarterInventory() {
        drawInventory($id('barterBoxInventoryLeft'), 'p', workingPlayerInventory)
        drawInventory($id('barterBoxInventoryRight'), 'm', workingMerchantInventory)
        drawInventory($id('barterBoxLeft'), 'l', playerBarterTable)
        drawInventory($id('barterBoxRight'), 'r', merchantBarterTable)

        const moneyLeft = totalAmount(playerBarterTable)
        const moneyRight = totalAmount(merchantBarterTable)

        $id('barterBoxLeftAmount').innerHTML = '$' + moneyLeft
        $id('barterBoxRightAmount').innerHTML = '$' + moneyRight
    }

    redrawBarterInventory()
}
