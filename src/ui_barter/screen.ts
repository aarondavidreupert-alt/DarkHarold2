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
import { relinkTradedHands, tradeHeldAside } from '../inventoryWield.js'
import { dbg, dbgWarn } from '../logger.js'
import { Critter, cloneItem, Obj } from '../object.js'
import { Scripting } from '../scripting.js'
import { UIMode } from '../ui_panels.js'
import { uiAnimateBox, uiSetDialogueReply } from '../ui_dialogue.js'
import { drawBagView, examineToLog, itemMenuActions, makeDropTarget, makeDraggable, MAX_OPEN_BAGS, showItemMenu, unloadWeapon, itemCountLabel } from '../ui_inventory.js'
import { Config } from '../config.js'
import { appendItemSlot, $id, clearEl, makeEl } from '../ui_dom.js'
import { uiGetAmount, uiSwapItem } from './swap.js'
import { getMessage } from '../util.js'
import { assetUrl } from '../modAssets.js'
import { frameCell } from '../renderer.js'

// CE ref: inventory.cc:1982-2070 _display_body — draws a critter's standing
// FRM sprite into a portrait slot (60×100 box). Player uses ROTATION_SW (3)
// + frame 0; NPC/barterer uses their stored orientation + last frame.
// Sprite sheets in art/critters/ are laid out as all-directions-all-frames
// left to right: frame = numFrames * direction + frameIndex.
// overrideDirection overrides the direction derived from useLastFrame (used
// by the player-spin animation loop below).
export function renderBarterPortrait(el: HTMLElement, critter: Critter, useLastFrame = false, overrideDirection?: number): void {
    const art = critter.art
    if (!art) return
    const info = globalState.imageInfo?.[art]
    if (!info) return

    // Clamp direction to the number of directions actually in this FRM (some
    // FRMs have only 1 direction — accessing index 3 would be undefined).
    const wantedDir = overrideDirection !== undefined ? overrideDirection
                    : useLastFrame ? (critter.orientation ?? 0) : 3  // 3 = ROTATION_SW for player
    const direction = Math.min(wantedDir, info.frameOffsets.length - 1)
    const frameIndex = useLastFrame ? (info.numFrames - 1) : 0

    // info.frameWidth is the MAXIMUM frame slot width across ALL directions/frames
    // (used for uniform sprite-sheet packing). The standing pose is usually much
    // narrower — use frameOffsets[d][f].w/h (actual trimmed content) for both the
    // source crop and the scale, so scale is relative to real content not padding.
    const frameInfo = info.frameOffsets[direction]?.[frameIndex]
    if (!frameInfo) return
    const fw = frameInfo.w, fh = frameInfo.h

    // The frame's cell in the sprite sheet (renderer.ts frameCell); the content is
    // pasted at the cell's top-left corner (tools/frmpixels.py cellOrigin).
    const { sx, sy } = frameCell(info, direction, frameIndex)

    el.textContent = ''
    let canvas = el.querySelector('canvas') as HTMLCanvasElement | null
    if (!canvas) {
        canvas = document.createElement('canvas')
        canvas.width = 40
        canvas.height = 67
        Object.assign(canvas.style, { width: '40px', height: '67px', display: 'block', imageRendering: 'pixelated' })
        el.appendChild(canvas)
    }
    const ctx = canvas.getContext('2d')!

    function draw(img: HTMLImageElement) {
        ctx.clearRect(0, 0, 60, 100)
        // No ,1 upscale cap — both portraits always scale to fill the 60×100 slot,
        // matching CE's _display_body which scales every critter to the fixed box.
        // Center horizontally, bottom-align vertically (isometric convention).
        const scale = Math.min(40 / fw, 67 / fh)
        const dw = fw * scale, dh = fh * scale
        const dx = (40 - dw) / 2, dy = 67 - dh
        ctx.drawImage(img, sx, sy, fw, fh, dx, dy, dw, dh)
    }

    const img = globalState.images?.[art] as HTMLImageElement | undefined
    if (img?.complete) {
        draw(img)
    } else {
        // Image not yet in cache — listen for load via a temporary img element
        const loader = new Image()
        loader.onload = () => draw(loader)
        loader.src = assetUrl(art + '.png')
    }
}

// CE ref: inventory.cc:1982 _display_body — `gInventoryWindowDudeRotation++`
// fires every ~167ms on a timer, cycling the player portrait through all 6
// directions (a slow idle spin). NPC portrait is static.
let _portraitAnimInterval: ReturnType<typeof setInterval> | null = null

export function startBarterPortraitAnimation(player: Critter): void {
    stopBarterPortraitAnimation()
    let dir = 3  // start at ROTATION_SW (CE starts at whatever the dude's current rotation is; SW is common)
    const el = $id('barterBoxPlayerPortrait')
    _portraitAnimInterval = setInterval(() => {
        dir = (dir + 1) % 6
        renderBarterPortrait(el, player, false, dir)
    }, 167)
}

export function stopBarterPortraitAnimation(): void {
    if (_portraitAnimInterval !== null) {
        clearInterval(_portraitAnimInterval)
        _portraitAnimInterval = null
    }
}

/** The open barter screen's trade logic, for the story crawler, which trades
 *  without dragging items (DH2 test tooling, not CE). */
export interface BarterControl {
    playerInventory(): Obj[]
    merchantInventory(): Obj[]
    /** what the merchant's table costs the player (CE _barter_compute_value) */
    quote(): number
    /** move `amount` of an inventory item onto its owner's table */
    put(side: 'player' | 'merchant', item: Obj, amount: number): void
    /** the Offer button; true if the trade went through */
    offer(): boolean
}
export let activeBarter: BarterControl | null = null

let barterKeyHandler: ((e: KeyboardEvent) => void) | null = null

function uiEndBarterMode() {
    activeBarter = null
    stopBarterPortraitAnimation()
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
        dbg('script', '[Barter] popping up barter box')

        // Pop up the bartering screen (animate up)
        const $barterBox = $id('barterBox')
        // #barterBox is shared with uiCompanionTrade(), which uses trade.png —
        // reset explicitly since this is always the vendor case (party
        // members are routed to uiCompanionTrade, see P7/scripting.ts).
        // CE ref: game_dialog.cc:3194-3200 (FRM 111 barter.frm).
        $barterBox.style.backgroundImage = "url('" + assetUrl('art/intrface/barter.png') + "')"
        $barterBox.style.display = ''
        $barterBox.style.visibility = 'visible'
        $barterBox.style.pointerEvents = 'auto'
        uiAnimateBox($barterBox, 480, 290)
        // CE ref: inventory.cc:2039-2052 _display_body — player at (15,25),
        // barterer at (560,25), both 60x100. Player: ROTATION_SW, frame 0,
        // then spin via 167ms timer. NPC: stored orientation, last frame.
        if (globalState.player) {
            renderBarterPortrait($id('barterBoxPlayerPortrait'), globalState.player, false)
            startBarterPortraitAnimation(globalState.player)
        }
        renderBarterPortrait($id('barterBoxMerchantPortrait'), merchant, true)
    })

    // logic + UI for bartering
    // TODO: would it be better if we dropped the "working" copies?

    // a copy of inventories for both parties
    let workingPlayerInventory = globalState.player.inventory.map(cloneItem)
    const heldAside = tradeHeldAside(merchant, false) // CE: worn armor / right-hand item not for trade
    let workingMerchantInventory = merchant.inventory.filter((it) => !heldAside.includes(it)).map(cloneItem)

    // and our working barter tables
    let playerBarterTable: Obj[] = []
    let merchantBarterTable: Obj[] = []

    // CE _container_enter in the trade window: each side's open bags (in the working copies);
    // their contents stand in for that side's list
    const playerBags: Obj[] = []
    const merchantBags: Obj[] = []
    const playerList = () => playerBags.length ? playerBags[playerBags.length - 1].inventory : workingPlayerInventory
    const merchantList = () => merchantBags.length ? merchantBags[merchantBags.length - 1].inventory : workingMerchantInventory

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
            total += objects[i].stackCost() // CE item.cc objectGetCost / itemGetCost
        }
        return total
    }

    // CE ref: inventory.cc:4673 _barter_compute_value — minimum player-offer for a fair deal.
    // balancedCost = (160 + npcBarter) / (160 + playerBarter) * costWithoutCaps * 2
    // result = trunc(barterModMult * balancedCost) + caps
    function barterMinPlayerOffer(merchantTable: Obj[]): number {
        const player = globalState.player

        const totalCost = totalAmount(merchantTable)
        const capsInTable = Scripting.itemGetTotalCaps({ inventory: merchantTable } as unknown as Obj) // itemGetTotalCaps(_btable)
        const costWithoutCaps = totalCost - capsInTable

        // CE partyGetBestSkillValue(SKILL_BARTER): the best Barter in the party (the dude
        // included, hidden members not); skillGetValue already holds the difficulty bonus.
        let playerBarter = 0
        for (const c of globalState.gParty?.getPartyMembersAndPlayer() ?? [player]) {
            if (!c || c.visible === false) continue
            playerBarter = Math.max(playerBarter, c.getSkill?.('Barter') ?? 0)
        }
        const npcBarter = (merchant as any).getSkill?.('Barter') ?? 0

        // Reaction modifier from merchant LVAR 0 (CE ref: reaction.cc:18)
        const reactionVal = (merchant as any)._script?.lvars?.[0] ?? 0
        // reactionTranslateValue: > 10 good (−15), > −10 neutral (0), else bad (+25)
        const reactionMod = reactionVal > 10 ? -15 : reactionVal > -10 ? 0 : 25

        // Combined barterMod: script mod + reaction mod
        const scriptMod = Scripting.getDialogueBarterMod()
        const perkBonus = player.hasPerk?.('Master Trader') ? 25 : 0
        const barterModMult = Math.max(0.01, (scriptMod + reactionMod + 100 - perkBonus) * 0.01)

        const balancedCost = ((160 + npcBarter) / (160 + playerBarter)) * (costWithoutCaps * 2)
        return Math.trunc(barterModMult * balancedCost) + capsInTable
    }

    // TODO: checkOffer() or some-such
    function offer(): boolean {
        dbg('script', '[Barter] offer')

        // CE inventory.cc _barter_attempt_transaction: first the weight — "Sorry, you cannot
        // carry that much." (31) — then an empty offer or one worth less is "not good enough".
        const player = globalState.player
        const tableWeight = merchantBarterTable.reduce((w, o) => w + o.stackWeight(o.amount ?? 1), 0)
        const carried = workingPlayerInventory.reduce((w, o) => w + o.stackWeight(o.amount ?? 1), 0)
            + ['leftHand', 'rightHand', 'armor'].reduce((w, h) => {
                const it = (player as any)[h]
                return w + (it && it.pid !== undefined ? it.stackWeight(it.amount ?? 1) : 0)
            }, 0)
        if (tableWeight > player.getStat('Carry') - carried) {
            uiSetDialogueReply(getMessage('inventry', 31) ?? 'Sorry, you cannot carry that much.')
            return false
        }

        const playerOffered = totalAmount(playerBarterTable)
        const merchantNeed = barterMinPlayerOffer(merchantBarterTable)

        // CE itemIsQueued(offerTable): an offered item with a pending event (a lit flare, an
        // armed explosive, a running Stealth Boy / Geiger counter), or one inside an offered
        // bag, makes the offer bad. (CE then tries miscItemTurnOff only when the *table* is a
        // Geiger counter, which it never is.) The table holds working copies — match by uid.
        const queued = new Set(Scripting.timeEventList.map((e) => (e.obj as Obj | null)?.uid).filter((u) => u !== undefined))
        const isQueued = (o: Obj): boolean => queued.has(o.uid) || (o.inventory ?? []).some(isQueued)
        const queuedOffer = playerBarterTable.some(isQueued)

        if (playerBarterTable.length > 0 && !queuedOffer && playerOffered >= merchantNeed) {
            // OK, player offered equal to more more than the value
            dbg('script', '[Barter] offer accepted')

            // finalize and apply the deal

            // swap to working inventories
            merchant.inventory = [...heldAside, ...workingMerchantInventory]
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
            relinkTradedHands(merchant, globalState.player)
            workingMerchantInventory = merchant.inventory.filter((it) => !heldAside.includes(it)).map(cloneItem)

            playerBarterTable = []
            merchantBarterTable = []
            playerBags.length = 0 // (the bags were working copies)
            merchantBags.length = 0

            redrawBarterInventory()
            // CE inventoryOpenTrade: inventry.msg 27 "Ok, that's a good trade." (not for party members)
            uiSetDialogueReply(getMessage('inventry', 27) ?? "Ok, that's a good trade.")
            return true
        } else {
            // CE ref: inventory.cc:4742-4755 _barter_attempt_transaction —
            // message 28 "No, your offer is not good enough.", rendered via
            // gameDialogRenderSupplementaryMessage into the dialogue reply
            // window (DH2: #dialogueBoxReply — see uiSetDialogueReply).
            uiSetDialogueReply(getMessage('inventry', 28) ?? 'No, your offer is not good enough.')
            return false
        }
    }

    activeBarter = {
        playerInventory: () => workingPlayerInventory,
        merchantInventory: () => workingMerchantInventory,
        quote: () => barterMinPlayerOffer(merchantBarterTable),
        put: (side, item, amount) => {
            if (side === 'player') uiSwapItem(workingPlayerInventory, item, playerBarterTable, amount)
            else uiSwapItem(workingMerchantInventory, item, merchantBarterTable, amount)
        },
        offer: () => offer(),
    }

    function drawInventory($el: HTMLElement, who: 'p' | 'm' | 'l' | 'r', objects: Obj[], scroll: number = 0) {
        clearEl($el)

        // CE inventory.cc _display_inventory: newest first (items[length − (i + offset + 1)])
        for (let k = scroll; k < objects.length; k++) {
            const i = objects.length - 1 - k
            const obj = objects[i]
            const inventoryImage = obj.invArt
            if (!inventoryImage) {
                dbgWarn('script', `[Barter] item has no invArt, skipping image: ${obj.name ?? obj.pid}`)
            }
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
                    const bags = who === 'p' ? playerBags : merchantBags
                    if (action === 'use') { if (bags.length < MAX_OPEN_BAGS) bags.push(obj) }
                    else if (action === 'look') examineToLog(obj)
                    else if (action === 'unload') unloadWeapon(obj, (ammo) => objects.push(ammo))
                    redrawBarterInventory()
                })
                return false
            }
        }
    }

    async function uiBarterMove(data: string, where: 'left' | 'right' | 'leftInv' | 'rightInv') {
        dbg('script', `[Barter] move ${data} to ${where}`)

        const from = (
            {
                p: playerList(),
                m: merchantList(),
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
            leftInv: playerList(),
            rightInv: merchantList(),
        }[where]

        if (to === undefined) {
            throw 'uiBarterMove: invalid location: ' + where
        } else if (to === from) {
            // table -> same table
            return
        }
        const amount = obj.amount > 1 ? await uiGetAmount(obj) : 1
        // back into an open bag: CE _drop_into_container's room check (inventry.msg 26)
        const toBag = where === 'leftInv' ? playerBags[playerBags.length - 1] : where === 'rightInv' ? merchantBags[merchantBags.length - 1] : undefined
        if (amount > 0 && toBag && !toBag.canCarry(obj, amount)) {
            uiSetDialogueReply(getMessage('inventry', 26) ?? 'There is no space left for that item.')
            return
        }
        uiSwapItem(from, obj, to, amount)

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
    $id('barterOfferButton').onclick = () => { offer() }
    // CE inventoryOpenTrade keys: T talk (back to the dialogue), M make the offer
    if (barterKeyHandler) window.removeEventListener('keydown', barterKeyHandler)
    barterKeyHandler = (e: KeyboardEvent) => {
        if (globalState.uiMode !== UIMode.barter) return
        const k = e.key.toLowerCase()
        if (k === 't') uiEndBarterMode()
        else if (k === 'm') offer()
        else return
        e.preventDefault()
    }
    window.addEventListener('keydown', barterKeyHandler)

    // CE ref: inventory.cc:1086-1225 — outer-inventory scroll buttons, one
    // item per click, clamped so there's always at least one item visible.
    $id('barterScrollLeftUp').onclick = () => {
        playerInvScroll = Math.max(0, playerInvScroll - 1)
        redrawBarterInventory()
    }
    $id('barterScrollLeftDown').onclick = () => {
        playerInvScroll = Math.min(Math.max(0, playerList().length - 1), playerInvScroll + 1)
        redrawBarterInventory()
    }
    $id('barterScrollRightUp').onclick = () => {
        merchantInvScroll = Math.max(0, merchantInvScroll - 1)
        redrawBarterInventory()
    }
    $id('barterScrollRightDown').onclick = () => {
        merchantInvScroll = Math.min(Math.max(0, merchantList().length - 1), merchantInvScroll + 1)
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
        playerInvScroll = Math.min(playerInvScroll, Math.max(0, playerList().length - 1))
        merchantInvScroll = Math.min(merchantInvScroll, Math.max(0, merchantList().length - 1))
        playerOfferScroll = Math.min(playerOfferScroll, Math.max(0, playerBarterTable.length - 1))
        merchantOfferScroll = Math.min(merchantOfferScroll, Math.max(0, merchantBarterTable.length - 1))

        drawInventory($id('barterBoxInventoryLeft'), 'p', playerList(), playerInvScroll)
        drawInventory($id('barterBoxInventoryRight'), 'm', merchantList(), merchantInvScroll)
        // CE _display_body: the open bag in the side's body view (inventory.cc:2039-2052)
        drawBagView($id('barterBox'), 'barterBoxPlayerBag', { left: 29, top: 45, width: 40, height: 67 }, playerBags,
            () => { playerInvScroll = 0; redrawBarterInventory() }, $id('barterBoxPlayerPortrait'))
        drawBagView($id('barterBox'), 'barterBoxMerchantBag', { left: 574, top: 45, width: 40, height: 67 }, merchantBags,
            () => { merchantInvScroll = 0; redrawBarterInventory() }, $id('barterBoxMerchantPortrait'))
        drawInventory($id('barterBoxLeft'), 'l', playerBarterTable, playerOfferScroll)
        drawInventory($id('barterBoxRight'), 'r', merchantBarterTable, merchantOfferScroll)

        // CE inventoryWindowRenderInnerInventories: the player's table at its cost, the
        // merchant's at what the merchant wants for it (_barter_compute_value)
        const moneyLeft = totalAmount(playerBarterTable)
        const moneyRight = barterMinPlayerOffer(merchantBarterTable)

        $id('barterBoxLeftAmount').innerHTML = '$' + moneyLeft
        $id('barterBoxRightAmount').innerHTML = '$' + moneyRight
    }

    redrawBarterInventory()
}
