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
import { relinkTradedHands, tradeHeldAside } from './inventoryWield.js'
import { Critter, cloneItem, Obj } from './object.js'
import { UIMode } from './ui_panels.js'
import { getVisibleDialoguePanel, uiSetDialogueReply, uiSwapDialoguePanel } from './ui_dialogue.js'
import { drawBagView, examineToLog, itemMenuActions, makeDropTarget, makeDraggable, MAX_OPEN_BAGS, showItemMenu, unloadWeapon, itemCountLabel } from './ui_inventory.js'
import { appendItemSlot, $id, clearEl, makeEl } from './ui_dom.js'
import { uiGetAmount, uiSwapItem } from './ui_barter/swap.js'
import { renderBarterPortrait, startBarterPortraitAnimation, stopBarterPortraitAnimation } from './ui_barter/screen.js'
import { Scripting } from './scripting.js'
import { getMessage } from './util.js'
import { assetUrl } from './modAssets.js'

// CE ref: game_dialog.cc:3178-3186 _barter_end_to_talk_to — barter/trade
// always exits straight back to the normal Talk/dialogue window, even when
// entered from the companion control screen's own Trade button (not back to
// Control — game_dialog.cc:3757-3762 confirms Trade-from-Control just sets
// _dialogue_switch_mode=2, the same state barter-from-dialogue uses).
function uiEndCompanionTrade(): void {
    stopBarterPortraitAnimation()
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
    $barterBox.style.backgroundImage = "url('" + assetUrl('art/intrface/trade.png') + "')"
    uiSwapDialoguePanel(getVisibleDialoguePanel(), $barterBox)
    // CE ref: inventory.cc:2039-2052 _display_body — player at (15,25),
    // barterer at (560,25), both 60x100. Player: ROTATION_SW, frame 0,
    // then spin via 167ms timer. Companion: stored orientation, last frame.
    if (globalState.player) {
        renderBarterPortrait($id('barterBoxPlayerPortrait'), globalState.player, false)
        startBarterPortraitAnimation(globalState.player)
    }
    renderBarterPortrait($id('barterBoxMerchantPortrait'), companion, true)

    let workingPlayerInventory = globalState.player.inventory.map(cloneItem)
    const heldAside = tradeHeldAside(companion, true) // CE: worn armor / right-hand item not for trade
    let workingCompanionInventory = companion.inventory.filter((it) => !heldAside.includes(it)).map(cloneItem)

    let playerBarterTable: Obj[] = []
    let companionBarterTable: Obj[] = []

    // CE _container_enter in the trade window: each side's open bags (in the working copies)
    const playerBags: Obj[] = []
    const companionBags: Obj[] = []
    const playerList = () => playerBags.length ? playerBags[playerBags.length - 1].inventory : workingPlayerInventory
    const companionList = () => companionBags.length ? companionBags[companionBags.length - 1].inventory : workingCompanionInventory

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
        for (const o of objects) total += o.stackWeight() // item.cc itemGetWeight
        return total
    }

    // CE ref: inventory.cc:4710-4722 — weight-only accept check, no money.
    function offer(): void {
        const player = globalState.player

        const playerCarry = player.getStat('Carry')
        const playerCurrentWeight = totalWeight(workingPlayerInventory)
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
        const companionCurrentWeight = totalWeight(workingCompanionInventory)
        const companionWeightAvailable = companionCarry - companionCurrentWeight
        if (totalWeight(playerBarterTable) > companionWeightAvailable) {
            // CE ref: inventory.cc:4720-4728 — message 32 "Sorry, that's too
            // much to carry." (gGameDialogSpeakerIsPartyMember branch).
            uiSetDialogueReply(getMessage('inventry', 32) ?? "Sorry, that's too much to carry.")
            return
        }

        // Accepted — finalize.
        companion.inventory = [...heldAside, ...workingCompanionInventory]
        globalState.player.inventory = workingPlayerInventory

        for (const item of companionBarterTable) globalState.player.addInventoryItem(item, item.amount)
        for (const item of playerBarterTable) companion.addInventoryItem(item, item.amount)

        workingPlayerInventory = globalState.player.inventory.map(cloneItem)
        relinkTradedHands(companion, globalState.player)
        workingCompanionInventory = companion.inventory.filter((it) => !heldAside.includes(it)).map(cloneItem)
        playerBarterTable = []
        companionBarterTable = []
        playerBags.length = 0 // (the bags were working copies)
        companionBags.length = 0

        redraw()
    }

    function drawInventory($el: HTMLElement, who: 'p' | 'm' | 'l' | 'r', objects: Obj[], scroll: number = 0): void {
        clearEl($el)
        // CE inventory.cc _display_inventory: newest first (items[length − (i + offset + 1)])
        for (let k = scroll; k < objects.length; k++) {
            const i = objects.length - 1 - k
            const obj = objects[i]
            const inventoryImage = obj.invArt
            const img = makeEl('img', {
                src: inventoryImage ? inventoryImage + '.png' : '',
                attrs: { title: obj.name },
                style: { maxWidth: '100%', maxHeight: '60px', objectFit: 'contain', display: 'inline-block', verticalAlign: 'middle' },
            })
            appendItemSlot($el, img, itemCountLabel(obj))
            // drag-data index is the index into the underlying array (`i`),
            // not the on-screen position, so drops/swaps still target the
            // right item regardless of scroll offset.
            makeDraggable(img, who + i)
            // CE inventoryWindowOpenContextMenu (trade window): Look, Unload and Use on a bag in
            // either side's list (_container_enter); the rounds go to the list the weapon is in
            // (DH2 trades on working copies, so no Drop mid-trade)
            img.oncontextmenu = (e: MouseEvent) => {
                e.preventDefault()
                const inList = who === 'p' || who === 'm'
                const actions = itemMenuActions(obj, false, who === 'p' || who === 'l')
                    .filter((a) => a !== 'drop' && (a !== 'use' || (inList && obj.subtype === 'container')))
                showItemMenu(e, actions, (action) => {
                    const bags = who === 'p' ? playerBags : companionBags
                    if (action === 'use') { if (bags.length < MAX_OPEN_BAGS) bags.push(obj) }
                    else if (action === 'look') examineToLog(obj)
                    else if (action === 'unload') unloadWeapon(obj, (ammo) => objects.push(ammo))
                    redraw()
                })
                return false
            }
        }
    }

    async function uiMove(data: string, where: 'left' | 'right' | 'leftInv' | 'rightInv'): Promise<void> {
        const from = (
            {
                p: playerList(),
                m: companionList(),
                l: playerBarterTable,
                r: companionBarterTable,
            } as any
        )[data[0]]
        if (from === undefined) throw new Error('uiCompanionTrade.uiMove: wrong data: ' + data)

        const idx = parseInt(data.slice(1))
        const obj = from[idx]
        if (obj === undefined) throw new Error('uiCompanionTrade.uiMove: obj not found in list (' + idx + ')')

        if (data[0] === 'p' && where !== 'left' && where !== 'leftInv') return
        if (data[0] === 'm' && where !== 'right' && where !== 'rightInv') return

        const to = {
            left: playerBarterTable,
            right: companionBarterTable,
            leftInv: playerList(),
            rightInv: companionList(),
        }[where]
        if (to === from) return

        const amount = obj.amount > 1 ? await uiGetAmount(obj) : 1
        // back into an open bag: CE _drop_into_container's room check (inventry.msg 26)
        const toBag = where === 'leftInv' ? playerBags[playerBags.length - 1] : where === 'rightInv' ? companionBags[companionBags.length - 1] : undefined
        if (amount > 0 && toBag && !toBag.canCarry(obj, amount)) {
            uiSetDialogueReply(getMessage('inventry', 26) ?? 'There is no space left for that item.')
            return
        }
        uiSwapItem(from, obj, to, amount)

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
        playerInvScroll = Math.min(Math.max(0, playerList().length - 1), playerInvScroll + 1)
        redraw()
    }
    $id('barterScrollRightUp').onclick = () => {
        companionInvScroll = Math.max(0, companionInvScroll - 1)
        redraw()
    }
    $id('barterScrollRightDown').onclick = () => {
        companionInvScroll = Math.min(Math.max(0, companionList().length - 1), companionInvScroll + 1)
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
        playerInvScroll = Math.min(playerInvScroll, Math.max(0, playerList().length - 1))
        companionInvScroll = Math.min(companionInvScroll, Math.max(0, companionList().length - 1))
        playerOfferScroll = Math.min(playerOfferScroll, Math.max(0, playerBarterTable.length - 1))
        companionOfferScroll = Math.min(companionOfferScroll, Math.max(0, companionBarterTable.length - 1))

        drawInventory($id('barterBoxInventoryLeft'), 'p', playerList(), playerInvScroll)
        drawInventory($id('barterBoxInventoryRight'), 'm', companionList(), companionInvScroll)
        // CE _display_body: the open bag in the side's body view
        drawBagView($id('barterBox'), 'barterBoxPlayerBag', { left: 29, top: 45, width: 40, height: 67 }, playerBags,
            () => { playerInvScroll = 0; redraw() }, $id('barterBoxPlayerPortrait'))
        drawBagView($id('barterBox'), 'barterBoxMerchantBag', { left: 574, top: 45, width: 40, height: 67 }, companionBags,
            () => { companionInvScroll = 0; redraw() }, $id('barterBoxMerchantPortrait'))
        drawInventory($id('barterBoxLeft'), 'l', playerBarterTable, playerOfferScroll)
        drawInventory($id('barterBoxRight'), 'r', companionBarterTable, companionOfferScroll)

        // Weight, not money — CE has no price concept in this screen at all.
        $id('barterBoxLeftAmount').innerHTML = totalWeight(playerBarterTable) + ' lbs'
        $id('barterBoxRightAmount').innerHTML = totalWeight(companionBarterTable) + ' lbs'
    }

    redraw()
}
