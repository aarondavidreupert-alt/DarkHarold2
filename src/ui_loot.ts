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
import { Obj } from './object.js'
import { UIMode } from './ui_panels.js'
import { uiGetAmount, uiSwapItem } from './ui_barter.js'
import { uiLog } from './ui_hud.js'
import { makeDropTarget, makeDraggable } from './ui_inventory.js'
import { $id, clearEl, showv, hidev, off, makeEl } from './ui_dom.js'
import { dbg } from './logger.js'

// --- Loot screen -----------------------------------------------------------

// CE ref: inventory.cc:1982 _display_body — portrait slot is 60×100.
// For LOOT window: player at (48,39), target at (426,39).
// Player: ROTATION_SW (dir 3), frame 0. Target: stored orientation, last frame.
function renderLootPortrait(el: HTMLElement, obj: Obj, useLastFrame: boolean): void {
    const art = obj.art
    if (!art) return
    const info = globalState.imageInfo?.[art]
    if (!info) return

    const wantedDir = useLastFrame ? (obj.orientation ?? 0) : 3
    const direction = Math.min(wantedDir, info.frameOffsets.length - 1)
    const frameIndex = useLastFrame ? (info.numFrames - 1) : 0

    const frameInfo = info.frameOffsets[direction]?.[frameIndex]
    if (!frameInfo) return
    const fw = frameInfo.w, fh = frameInfo.h

    const spriteCol = info.numFrames * direction + frameIndex
    const sx = spriteCol * info.frameWidth

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
        ctx.clearRect(0, 0, 40, 67)
        const scale = Math.min(40 / fw, 67 / fh)
        const dw = fw * scale, dh = fh * scale
        const dx = (40 - dw) / 2, dy = 67 - dh
        ctx.drawImage(img, sx, 0, fw, fh, dx, dy, dw, dh)
    }

    const img = globalState.images?.[art] as HTMLImageElement | undefined
    if (img?.complete) {
        draw(img)
    } else {
        const loader = new Image()
        loader.onload = () => draw(loader)
        loader.src = art + '.png'
    }
}

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
    globalState.uiMode = UIMode.loot

    // CE ref: inventory.cc:1693-1873 — scroll offsets, one item per click,
    // clamped so there's always at least one item visible.
    let leftScroll = 0
    let rightScroll = 0

    async function uiLootMove(data: string /* "l"|"r" */, where: 'left' | 'right') {
        dbg('inventory', '[Loot] move ' + data + ' to ' + where)

        const from = ({ l: globalState.player.inventory, r: object.inventory } as any)[data[0]]

        if (from === undefined) {
            throw 'uiLootMove: wrong data: ' + data
        }

        const idx = parseInt(data.slice(1))
        const obj = from[idx]
        if (obj === undefined) {
            throw 'uiLootMove: obj not found in list (' + idx + ')'
        }

        const to = { left: globalState.player.inventory, right: object.inventory }[where]

        if (to === undefined) {
            throw 'uiLootMove: invalid location: ' + where
        } else if (to === from) {
            // object -> same location
            return
        }

        const wantedAmount = obj.amount > 1 ? await uiGetAmount(obj) : 1
        // CE ref: item.cc itemAttemptAdd — enforce STAT_CARRY_WEIGHT on the receiving critter.
        const toOwner: any = where === 'left' ? globalState.player! : object
        if (wantedAmount > 0 && !toOwner.canCarry?.(obj, wantedAmount)) {
            uiLog("You can't carry any more.")
            return
        }
        uiSwapItem(from, obj, to, wantedAmount)
        drawLoot()
    }

    function drawInventory($el: HTMLElement, who: 'p' | 'm' | 'l' | 'r', objects: Obj[], scroll: number = 0) {
        clearEl($el)

        for (let i = scroll; i < objects.length; i++) {
            const inventoryImage = objects[i].invArt
            const img = makeEl('img', {
                src: inventoryImage + '.png',
                attrs: { title: objects[i].name },
                style: { maxWidth: '65px', maxHeight: '60px', objectFit: 'contain', display: 'inline-block', verticalAlign: 'middle' },
            })
            $el.appendChild(img)
            const amountEl = makeEl('span', { style: { color: '#F5C518', fontSize: '11px' } })
            amountEl.textContent = 'x' + objects[i].amount
            $el.appendChild(amountEl)
            makeDraggable(img, who + i)
        }
    }

    dbg('inventory', '[Loot] opening loot screen')

    showv($id('lootBox'))

    // CE ref: inventory.cc:2083-2089 _display_body INVENTORY_WINDOW_TYPE_LOOT —
    // player portrait at (48,39), target at (426,39), both 60×100 px.
    renderLootPortrait($id('lootBoxPlayerPortrait'), globalState.player, false)
    renderLootPortrait($id('lootBoxTargetPortrait'), object, true)

    // loot drop targets
    makeDropTarget($id('lootBoxLeft'), (data: string) => {
        uiLootMove(data, 'left')
    })
    makeDropTarget($id('lootBoxRight'), (data: string) => {
        uiLootMove(data, 'right')
    })

    $id('lootScrollLeftUp').onclick = () => {
        leftScroll = Math.max(0, leftScroll - 1)
        drawLoot()
    }
    $id('lootScrollLeftDown').onclick = () => {
        leftScroll = Math.min(Math.max(0, globalState.player.inventory.length - 1), leftScroll + 1)
        drawLoot()
    }
    $id('lootScrollRightUp').onclick = () => {
        rightScroll = Math.max(0, rightScroll - 1)
        drawLoot()
    }
    $id('lootScrollRightDown').onclick = () => {
        rightScroll = Math.min(Math.max(0, object.inventory.length - 1), rightScroll + 1)
        drawLoot()
    }

    $id('lootBoxTakeAllButton').onclick = () => {
        dbg('inventory', '[Loot] take all')
        const inv = object.inventory.slice(0) // clone inventory
        let blocked = false
        const player = globalState.player!
        for (let i = 0; i < inv.length; i++) {
            // CE ref: item.cc itemAttemptAdd — skip items that would overweigh the player.
            if (!player.canCarry(inv[i], inv[i].amount)) {
                blocked = true
                continue
            }
            uiSwapItem(object.inventory, inv[i], player.inventory, inv[i].amount)
        }
        if (blocked) uiLog("You can't carry any more.")
        drawLoot()
    }

    function drawLoot() {
        leftScroll = Math.min(leftScroll, Math.max(0, globalState.player.inventory.length - 1))
        rightScroll = Math.min(rightScroll, Math.max(0, object.inventory.length - 1))
        drawInventory($id('lootBoxLeft'), 'l', globalState.player.inventory, leftScroll)
        drawInventory($id('lootBoxRight'), 'r', object.inventory, rightScroll)
    }

    drawLoot()
}
