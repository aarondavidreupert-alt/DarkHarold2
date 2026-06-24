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
import { uiAnimateBox, uiSetDialogueReply } from '../ui_dialogue.js'
import { makeDropTarget, makeDraggable } from '../ui_inventory.js'
import { Config } from '../config.js'
import { $id, clearEl, makeEl } from '../ui_dom.js'
import { uiGetAmount, uiSwapItem } from './swap.js'
import { getMessage } from '../util.js'

// CE ref: inventory.cc:1982-2070 _display_body — draws a critter's standing
// FRM sprite into a portrait slot (60×100 box). Player uses ROTATION_SW (3)
// + frame 0; NPC/barterer uses their stored orientation + last frame.
// Sprite sheets in art/critters/ are laid out as all-directions-all-frames
// left to right: frame = numFrames * direction + frameIndex.
export function renderBarterPortrait(el: HTMLElement, critter: Critter, useLastFrame = false): void {
    const art = critter.art
    if (!art) return
    const info = globalState.imageInfo?.[art]
    if (!info) return
    const direction = useLastFrame ? (critter.orientation ?? 0) : 3  // 3 = ROTATION_SW for player
    const frameIndex = useLastFrame ? (info.numFrames - 1) : 0
    const spriteCol = info.numFrames * direction + frameIndex
    const sx = spriteCol * info.frameWidth

    el.textContent = ''
    let canvas = el.querySelector('canvas') as HTMLCanvasElement | null
    if (!canvas) {
        canvas = document.createElement('canvas')
        canvas.width = 60
        canvas.height = 100
        Object.assign(canvas.style, { width: '60px', height: '100px', display: 'block', imageRendering: 'pixelated' })
        el.appendChild(canvas)
    }
    const ctx = canvas.getContext('2d')!

    function draw(img: HTMLImageElement) {
        ctx.clearRect(0, 0, 60, 100)
        // Center the frame horizontally, bottom-align vertically (isometric standard)
        const fw = info.frameWidth, fh = info.frameHeight
        const scale = Math.min(60 / fw, 100 / fh, 1)
        const dw = fw * scale, dh = fh * scale
        const dx = (60 - dw) / 2, dy = 100 - dh
        ctx.drawImage(img, sx, 0, fw, fh, dx, dy, dw, dh)
    }

    const img = globalState.images?.[art] as HTMLImageElement | undefined
    if (img?.complete) {
        draw(img)
    } else {
        // Image not yet in cache — listen for load via a temporary img element
        const loader = new Image()
        loader.onload = () => draw(loader)
        loader.src = art + '.png'
    }
}

function uiEndBarterMode() {
    const $barterBox = $id('barterBox')

    uiAnimateBox($barterBox, null, 480, () => {
        $barterBox.style.visibility = 'hidden'
        $barterBox.style.display = 'none'
        // Restore dialogue panel
        const $dialogueBox = $id('dialogueBox')
        $dialogueBox.style.visibility = 'visible'
        uiAnimateBox($dialogueBox, 480, 290)
        // P6 fix: dialogueReply() clears dialogueOptionProcs before running
        // the [Barter] callback, and nothing repopulated it — the dialogue
        // box reappeared with no working option click-handlers (frozen).
        // reenterDialogue() re-runs talk_p_proc to rebuild the option list.
        Scripting.reenterDialogue()
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
        // #barterBox is shared with uiCompanionTrade(), which uses trade.png —
        // reset explicitly since this is always the vendor case (party
        // members are routed to uiCompanionTrade, see P7/scripting.ts).
        // CE ref: game_dialog.cc:3194-3200 (FRM 111 barter.frm).
        $barterBox.style.backgroundImage = "url('art/intrface/barter.png')"
        $barterBox.style.display = ''
        $barterBox.style.visibility = 'visible'
        $barterBox.style.pointerEvents = 'auto'
        uiAnimateBox($barterBox, 480, 290)
        // CE ref: inventory.cc:2039-2052 _display_body — player at (15,25),
        // barterer at (560,25), both 60x100. Player: ROTATION_SW, frame 0.
        // NPC: stored orientation, last frame.
        renderBarterPortrait($id('barterBoxPlayerPortrait'), globalState.player, false)
        renderBarterPortrait($id('barterBoxMerchantPortrait'), merchant, true)
    })

    // logic + UI for bartering
    // TODO: would it be better if we dropped the "working" copies?

    // a copy of inventories for both parties
    let workingPlayerInventory = globalState.player.inventory.map(cloneItem)
    let workingMerchantInventory = merchant.inventory.map(cloneItem)

    // and our working barter tables
    let playerBarterTable: Obj[] = []
    let merchantBarterTable: Obj[] = []

    // Scroll offsets — CE ref: inventory.cc _ptable_offset/_target_pud
    // (outer inventories, scroll buttons at inventory.cc:1086-1225) and the
    // separate, smaller "offered items" scroll buttons for the inner tables
    // (inventory.cc:1390-1480).
    let playerInvScroll = 0
    let merchantInvScroll = 0
    let playerOfferScroll = 0
    let merchantOfferScroll = 0

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
            // CE ref: inventory.cc:4742-4755 _barter_attempt_transaction —
            // message 28 "No, your offer is not good enough.", rendered via
            // gameDialogRenderSupplementaryMessage into the dialogue reply
            // window (DH2: #dialogueBoxReply — see uiSetDialogueReply).
            uiSetDialogueReply(getMessage('inventry', 28) ?? 'No, your offer is not good enough.')
        }
    }

    function drawInventory($el: HTMLElement, who: 'p' | 'm' | 'l' | 'r', objects: Obj[], scroll: number = 0) {
        clearEl($el)

        for (let i = scroll; i < objects.length; i++) {
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
            // drag-data index is the index into the underlying array (`i`),
            // not the on-screen position, so drops/swaps still target the
            // right item regardless of scroll offset.
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

    // CE ref: inventory.cc:1086-1225 — outer-inventory scroll buttons, one
    // item per click, clamped so there's always at least one item visible.
    $id('barterScrollLeftUp').onclick = () => {
        playerInvScroll = Math.max(0, playerInvScroll - 1)
        redrawBarterInventory()
    }
    $id('barterScrollLeftDown').onclick = () => {
        playerInvScroll = Math.min(Math.max(0, workingPlayerInventory.length - 1), playerInvScroll + 1)
        redrawBarterInventory()
    }
    $id('barterScrollRightUp').onclick = () => {
        merchantInvScroll = Math.max(0, merchantInvScroll - 1)
        redrawBarterInventory()
    }
    $id('barterScrollRightDown').onclick = () => {
        merchantInvScroll = Math.min(Math.max(0, workingMerchantInventory.length - 1), merchantInvScroll + 1)
        redrawBarterInventory()
    }

    // CE ref: inventory.cc:1390-1480 — offer-table scroll buttons, same
    // one-item-per-click model as the outer inventories above.
    $id('barterOfferScrollLeftUp').onclick = () => {
        playerOfferScroll = Math.max(0, playerOfferScroll - 1)
        redrawBarterInventory()
    }
    $id('barterOfferScrollLeftDown').onclick = () => {
        playerOfferScroll = Math.min(Math.max(0, playerBarterTable.length - 1), playerOfferScroll + 1)
        redrawBarterInventory()
    }
    $id('barterOfferScrollRightUp').onclick = () => {
        merchantOfferScroll = Math.max(0, merchantOfferScroll - 1)
        redrawBarterInventory()
    }
    $id('barterOfferScrollRightDown').onclick = () => {
        merchantOfferScroll = Math.min(Math.max(0, merchantBarterTable.length - 1), merchantOfferScroll + 1)
        redrawBarterInventory()
    }

    function redrawBarterInventory() {
        // Clamp scroll offsets in case items were moved out from under them
        // (array shrank since the last scroll click).
        playerInvScroll = Math.min(playerInvScroll, Math.max(0, workingPlayerInventory.length - 1))
        merchantInvScroll = Math.min(merchantInvScroll, Math.max(0, workingMerchantInventory.length - 1))
        playerOfferScroll = Math.min(playerOfferScroll, Math.max(0, playerBarterTable.length - 1))
        merchantOfferScroll = Math.min(merchantOfferScroll, Math.max(0, merchantBarterTable.length - 1))

        drawInventory($id('barterBoxInventoryLeft'), 'p', workingPlayerInventory, playerInvScroll)
        drawInventory($id('barterBoxInventoryRight'), 'm', workingMerchantInventory, merchantInvScroll)
        drawInventory($id('barterBoxLeft'), 'l', playerBarterTable, playerOfferScroll)
        drawInventory($id('barterBoxRight'), 'r', merchantBarterTable, merchantOfferScroll)

        const moneyLeft = totalAmount(playerBarterTable)
        const moneyRight = totalAmount(merchantBarterTable)

        $id('barterBoxLeftAmount').innerHTML = '$' + moneyLeft
        $id('barterBoxRightAmount').innerHTML = '$' + moneyRight
    }

    redrawBarterInventory()
}
