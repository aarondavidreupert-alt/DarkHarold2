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
import { getVisibleDialoguePanel, uiSetDialogueReply, uiSwapDialoguePanel } from './ui_dialogue.js'
import { makeDropTarget, makeDraggable } from './ui_inventory.js'
import { $id, clearEl, makeEl } from './ui_dom.js'
import { uiGetAmount, uiSwapItem } from './ui_barter/swap.js'
import { renderBarterPortrait } from './ui_barter/screen.js'
import { Scripting } from './scripting.js'
import { getMessage } from './util.js'

// CE ref: game_dialog.cc:3178-3186 _barter_end_to_talk_to — barter/trade
// always exits straight back to the normal Talk/dialogue window, even when
// entered from the companion control screen's own Trade button (not back to
// Control — game_dialog.cc:3757-3762 confirms Trade-from-Control just sets
// _dialogue_switch_mode=2, the same state barter-from-dialogue uses).
function uiEndCompanionTrade(): void {
    const $barterBox = $id('barterBox')
    $barterBox.style.pointerEvents = 'none'
    globalState.uiMode = UIMode.dialogue
    uiSwapDialoguePanel($barterBox, $id('dialogueBox'), () => Scripting.reenterDialogue())
}

export function uiCompanionTrade(companion: Critter): void {
    globalState.uiMode = UIMode.barter

    const $barterBox = $id('barterBox')
    $barterBox.style.pointerEvents = 'auto'
    // #barterBox is shared with uiBarterMode() (vendor barter, barter.png) —
    // CE ref: game_dialog.cc:3194-3200 _gdialog_barter_create_win picks FRM
    // 420 (trade.frm) instead of FRM 111 (barter.frm) for party members.
    $barterBox.style.backgroundImage = "url('art/intrface/trade.png')"
    uiSwapDialoguePanel(getVisibleDialoguePanel(), $barterBox)
    // CE ref: inventory.cc:2039-2052 _display_body — player at (15,25),
    // barterer at (560,25), both 60x100. Player: ROTATION_SW, frame 0.
    // Companion: stored orientation, last frame.
    renderBarterPortrait($id('barterBoxPlayerPortrait'), globalState.player, false)
    renderBarterPortrait($id('barterBoxMerchantPortrait'), companion, true)

    let workingPlayerInventory = globalState.player.inventory.map(cloneItem)
    let workingCompanionInventory = companion.inventory.map(cloneItem)

    let playerBarterTable: Obj[] = []
    let companionBarterTable: Obj[] = []

    // Scroll offsets — CE ref: inventory.cc _ptable_offset/_target_pud
    // (outer inventories, scroll buttons at inventory.cc:1086-1225) and the
    // separate, smaller "offered items" scroll buttons for the inner tables
    // (inventory.cc:1390-1480).
    let playerInvScroll = 0
    let companionInvScroll = 0
    let playerOfferScroll = 0
    let companionOfferScroll = 0

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
            // CE ref: inventory.cc:4710-4718 — message 31 "Sorry, you cannot
            // carry that much.", rendered via gameDialogRenderSupplementaryMessage
            // into the dialogue reply window (DH2: #dialogueBoxReply, which
            // stays visible behind the trade panel — see uiSetDialogueReply).
            uiSetDialogueReply(getMessage('inventry', 31) ?? 'Sorry, you cannot carry that much.')
            return
        }

        const companionCarry = companion.getStat('Carry')
        const companionCurrentWeight = workingCompanionInventory.reduce((s, o) => s + (o.pro?.extra?.weight ?? 0) * o.amount, 0)
        const companionWeightAvailable = companionCarry - companionCurrentWeight
        if (totalWeight(playerBarterTable) > companionWeightAvailable) {
            // CE ref: inventory.cc:4720-4728 — message 32 "Sorry, that's too
            // much to carry." (gGameDialogSpeakerIsPartyMember branch).
            uiSetDialogueReply(getMessage('inventry', 32) ?? "Sorry, that's too much to carry.")
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

    function drawInventory($el: HTMLElement, who: 'p' | 'm' | 'l' | 'r', objects: Obj[], scroll: number = 0): void {
        clearEl($el)
        for (let i = scroll; i < objects.length; i++) {
            const obj = objects[i]
            const inventoryImage = obj.invArt
            const img = makeEl('img', {
                src: inventoryImage ? inventoryImage + '.png' : '',
                attrs: { title: obj.name },
                style: { maxWidth: '72px', maxHeight: '60px', objectFit: 'contain', display: 'inline-block', verticalAlign: 'middle' },
            })
            $el.appendChild(img)
            $el.insertAdjacentHTML('beforeend', 'x' + obj.amount)
            // drag-data index is the index into the underlying array (`i`),
            // not the on-screen position, so drops/swaps still target the
            // right item regardless of scroll offset.
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

    // CE ref: inventory.cc:1086-1225 — outer-inventory scroll buttons, one
    // item per click, clamped so there's always at least one item visible.
    $id('barterScrollLeftUp').onclick = () => {
        playerInvScroll = Math.max(0, playerInvScroll - 1)
        redraw()
    }
    $id('barterScrollLeftDown').onclick = () => {
        playerInvScroll = Math.min(Math.max(0, workingPlayerInventory.length - 1), playerInvScroll + 1)
        redraw()
    }
    $id('barterScrollRightUp').onclick = () => {
        companionInvScroll = Math.max(0, companionInvScroll - 1)
        redraw()
    }
    $id('barterScrollRightDown').onclick = () => {
        companionInvScroll = Math.min(Math.max(0, workingCompanionInventory.length - 1), companionInvScroll + 1)
        redraw()
    }

    // CE ref: inventory.cc:1390-1480 — offer-table scroll buttons, same
    // one-item-per-click model as the outer inventories above.
    $id('barterOfferScrollLeftUp').onclick = () => {
        playerOfferScroll = Math.max(0, playerOfferScroll - 1)
        redraw()
    }
    $id('barterOfferScrollLeftDown').onclick = () => {
        playerOfferScroll = Math.min(Math.max(0, playerBarterTable.length - 1), playerOfferScroll + 1)
        redraw()
    }
    $id('barterOfferScrollRightUp').onclick = () => {
        companionOfferScroll = Math.max(0, companionOfferScroll - 1)
        redraw()
    }
    $id('barterOfferScrollRightDown').onclick = () => {
        companionOfferScroll = Math.min(Math.max(0, companionBarterTable.length - 1), companionOfferScroll + 1)
        redraw()
    }

    function redraw(): void {
        // Clamp scroll offsets in case items were moved out from under them.
        playerInvScroll = Math.min(playerInvScroll, Math.max(0, workingPlayerInventory.length - 1))
        companionInvScroll = Math.min(companionInvScroll, Math.max(0, workingCompanionInventory.length - 1))
        playerOfferScroll = Math.min(playerOfferScroll, Math.max(0, playerBarterTable.length - 1))
        companionOfferScroll = Math.min(companionOfferScroll, Math.max(0, companionBarterTable.length - 1))

        drawInventory($id('barterBoxInventoryLeft'), 'p', workingPlayerInventory, playerInvScroll)
        drawInventory($id('barterBoxInventoryRight'), 'm', workingCompanionInventory, companionInvScroll)
        drawInventory($id('barterBoxLeft'), 'l', playerBarterTable, playerOfferScroll)
        drawInventory($id('barterBoxRight'), 'r', companionBarterTable, companionOfferScroll)

        // Weight, not money — CE has no price concept in this screen at all.
        $id('barterBoxLeftAmount').innerHTML = totalWeight(playerBarterTable) + ' lbs'
        $id('barterBoxRightAmount').innerHTML = totalWeight(companionBarterTable) + ' lbs'
    }

    redraw()
}
