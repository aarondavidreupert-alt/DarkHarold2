/*
Copyright 2026

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

// Weight-based item exchange with a party member — the "Trade" button (key
// 'D') on the companion control screen (ui_companion.ts).
//
// CE ref: inventory.cc:5031 inventoryOpenTrade(), inventory.cc:4710-4722 the
// actual accept-check:
//   weightAvailable = STAT_CARRY_WEIGHT(dude) - currentWeight(dude)
//   if inventoryWeight(barterTable) > weightAvailable: reject
//   npcWeightAvailable = STAT_CARRY_WEIGHT(npc) - currentWeight(npc)
//   if inventoryWeight(offerTable) > npcWeightAvailable: reject
// No money/value comparison at all — unlike a shop barter (ui_barter/screen.ts,
// which computes a fair-deal price via _barter_compute_value), a party member
// trade only ever asks "does it fit," matching CE's `_gdCanBarter()` message
// 913 ("This critter can't carry anything") framing — the constraint is
// capacity, not commerce.
//
// Reuses the same #barterBox DOM structure and drag/drop wiring as the shop
// barter screen (ui_barter/screen.ts) since the only thing that differs is
// the accept-check and the amount readout (weight instead of $).

import globalState from './globalState.js'
import { Critter, cloneItem, Obj } from './object.js'
import { UIMode } from './ui_panels.js'
import { uiAnimateBox } from './ui_dialogue.js'
import { makeDropTarget, makeDraggable } from './ui_inventory.js'
import { $id, clearEl, makeEl } from './ui_dom.js'
import { uiGetAmount, uiSwapItem } from './ui_barter/swap.js'

function uiEndCompanionTrade(): void {
    const $barterBox = $id('barterBox')

    uiAnimateBox($barterBox, null, 480, () => {
        $barterBox.style.visibility = 'hidden'
        $barterBox.style.display = 'none'
    })

    globalState.uiMode = UIMode.none
}

export function uiCompanionTrade(companion: Critter): void {
    globalState.uiMode = UIMode.barter

    const $barterBox = $id('barterBox')
    $barterBox.style.display = ''
    $barterBox.style.visibility = 'visible'
    $barterBox.style.pointerEvents = 'auto'
    uiAnimateBox($barterBox, 480, 290)

    let workingPlayerInventory = globalState.player.inventory.map(cloneItem)
    let workingCompanionInventory = companion.inventory.map(cloneItem)

    let playerBarterTable: Obj[] = []
    let companionBarterTable: Obj[] = []

    function totalWeight(objects: Obj[]): number {
        let total = 0
        for (const o of objects) total += (o.pro?.extra?.weight ?? 0) * o.amount
        return total
    }

    // CE ref: inventory.cc:4710-4722 — weight-only accept check, no money.
    function offer(): void {
        const player = globalState.player

        const playerCarry = player.getStat('Carry')
        const playerCurrentWeight = workingPlayerInventory.reduce((s, o) => s + (o.pro?.extra?.weight ?? 0) * o.amount, 0)
        const playerWeightAvailable = playerCarry - playerCurrentWeight
        if (totalWeight(companionBarterTable) > playerWeightAvailable) {
            console.log('[Companion Trade] offer refused — exceeds your carry weight')
            return
        }

        const companionCarry = companion.getStat('Carry')
        const companionCurrentWeight = workingCompanionInventory.reduce((s, o) => s + (o.pro?.extra?.weight ?? 0) * o.amount, 0)
        const companionWeightAvailable = companionCarry - companionCurrentWeight
        if (totalWeight(playerBarterTable) > companionWeightAvailable) {
            console.log(`[Companion Trade] offer refused — exceeds ${companion.name ?? 'companion'}'s carry weight`)
            return
        }

        // Accepted — finalize.
        companion.inventory = workingCompanionInventory
        globalState.player.inventory = workingPlayerInventory

        for (const item of companionBarterTable) globalState.player.addInventoryItem(item, item.amount)
        for (const item of playerBarterTable) companion.addInventoryItem(item, item.amount)

        workingPlayerInventory = globalState.player.inventory.map(cloneItem)
        workingCompanionInventory = companion.inventory.map(cloneItem)
        playerBarterTable = []
        companionBarterTable = []

        redraw()
    }

    function drawInventory($el: HTMLElement, who: 'p' | 'm' | 'l' | 'r', objects: Obj[]): void {
        clearEl($el)
        for (let i = 0; i < objects.length; i++) {
            const obj = objects[i]
            const inventoryImage = obj.invArt
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

    async function uiMove(data: string, where: 'left' | 'right' | 'leftInv' | 'rightInv'): Promise<void> {
        const from = (
            {
                p: workingPlayerInventory,
                m: workingCompanionInventory,
                l: playerBarterTable,
                r: companionBarterTable,
            } as any
        )[data[0]]
        if (from === undefined) throw 'uiCompanionTrade.uiMove: wrong data: ' + data

        const idx = parseInt(data.slice(1))
        const obj = from[idx]
        if (obj === undefined) throw 'uiCompanionTrade.uiMove: obj not found in list (' + idx + ')'

        if (data[0] === 'p' && where !== 'left' && where !== 'leftInv') return
        if (data[0] === 'm' && where !== 'right' && where !== 'rightInv') return

        const to = {
            left: playerBarterTable,
            right: companionBarterTable,
            leftInv: workingPlayerInventory,
            rightInv: workingCompanionInventory,
        }[where]
        if (to === from) return

        if (obj.amount > 1) {
            uiSwapItem(from, obj, to, await uiGetAmount(obj))
        } else {
            uiSwapItem(from, obj, to, 1)
        }

        redraw()
    }

    makeDropTarget($id('barterBoxLeft'), (data: string) => { uiMove(data, 'left') })
    makeDropTarget($id('barterBoxRight'), (data: string) => { uiMove(data, 'right') })
    makeDropTarget($id('barterBoxInventoryLeft'), (data: string) => { uiMove(data, 'leftInv') })
    makeDropTarget($id('barterBoxInventoryRight'), (data: string) => { uiMove(data, 'rightInv') })

    $id('barterTalkButton').onclick = uiEndCompanionTrade
    $id('barterOfferButton').onclick = offer

    function redraw(): void {
        drawInventory($id('barterBoxInventoryLeft'), 'p', workingPlayerInventory)
        drawInventory($id('barterBoxInventoryRight'), 'm', workingCompanionInventory)
        drawInventory($id('barterBoxLeft'), 'l', playerBarterTable)
        drawInventory($id('barterBoxRight'), 'r', companionBarterTable)

        // Weight, not money — CE has no price concept in this screen at all.
        $id('barterBoxLeftAmount').innerHTML = totalWeight(playerBarterTable) + ' lbs'
        $id('barterBoxRightAmount').innerHTML = totalWeight(companionBarterTable) + ' lbs'
    }

    redraw()
}
