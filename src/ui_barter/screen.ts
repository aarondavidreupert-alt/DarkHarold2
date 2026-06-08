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

// Barter screen — split out of ui_barter.ts. See wiki/ts-split-refactor.md
// → "Per-file split proposals" §21.

import globalState from '../globalState.js'
import { Critter, cloneItem, Obj } from '../object.js'
import { Scripting } from '../scripting.js'
import { UIMode } from '../ui_panels.js'
import { uiAnimateBox } from '../ui_dialogue.js'
import { makeDropTarget, makeDraggable } from '../ui_inventory.js'
import { Config } from '../config.js'
import { $id, clearEl, makeEl } from '../ui_dom.js'
import { uiGetAmount, uiSwapItem } from './swap.js'

function uiEndBarterMode() {
    const $barterBox = $id('barterBox')

    uiAnimateBox($barterBox, null, 480, () => {
        $barterBox.style.visibility = 'hidden'
        $barterBox.style.display = 'none'
        // Restore dialogue panel
        const $dialogueBox = $id('dialogueBox')
        $dialogueBox.style.visibility = 'visible'
        uiAnimateBox($dialogueBox, 480, 290)
    })

    globalState.uiMode = UIMode.dialogue
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
            total += (objects[i].pro?.extra?.cost ?? 0) * objects[i].amount
        }
        return total
    }

    // CE ref: inventory.cc:4673 _barter_compute_value — minimum player-offer for a fair deal.
    // balancedCost = (160 + npcBarter) / (160 + playerBarter) * costWithoutCaps * 2
    // result = trunc(barterModMult * balancedCost) + caps
    function barterMinPlayerOffer(merchantTable: Obj[]): number {
        const player = globalState.player
        const CAPS_PID = 41

        const totalCost = totalAmount(merchantTable)
        const capsInTable = merchantTable
            .filter(o => o.pid === CAPS_PID)
            .reduce((s, o) => s + o.amount, 0)
        const costWithoutCaps = totalCost - capsInTable

        // Barter skill: player's effective value + difficulty modifier
        const diff = Config.combat.difficultyModifier
        const diffBonus = diff < 100 ? 20 : diff > 100 ? -10 : 0
        const playerBarter = Math.max(0, (player.getSkill?.('Barter') ?? 0) + diffBonus)
        const npcBarter = (merchant as any).getSkill?.('Barter') ?? 0

        // Reaction modifier from merchant LVAR 0 (CE ref: reaction.cc:18)
        const reactionVal = (merchant as any)._script?.lvars?.[0] ?? 0
        const reactionMod = reactionVal > 10 ? -15 : reactionVal < -10 ? 25 : 0

        // Combined barterMod: script mod + reaction mod
        const scriptMod = Scripting.getDialogueBarterMod()
        const perkBonus = player.hasPerk?.('Master Trader') ? 25 : 0
        const barterModMult = Math.max(0.01, (scriptMod + reactionMod + 100 - perkBonus) * 0.01)

        const balancedCost = ((160 + npcBarter) / (160 + playerBarter)) * (costWithoutCaps * 2)
        return Math.trunc(barterModMult * balancedCost) + capsInTable
    }

    // TODO: checkOffer() or some-such
    function offer() {
        console.log('[Barter] offer')

        const playerOffered = totalAmount(playerBarterTable)
        const merchantNeed = barterMinPlayerOffer(merchantBarterTable)

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
            const obj = objects[i]
            const inventoryImage = obj.invArt
            if (!inventoryImage) {
                console.warn('[Barter] item has no invArt, skipping image:', obj.name ?? obj.pid)
            }
            const img = makeEl('img', {
                src: inventoryImage ? inventoryImage + '.png' : '',
                attrs: { title: obj.name },
                style: { maxWidth: '72px', maxHeight: '60px', objectFit: 'contain', display: 'inline-block', verticalAlign: 'middle' },
            })
            $el.appendChild(img)
            $el.insertAdjacentHTML('beforeend', 'x' + obj.amount)
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
