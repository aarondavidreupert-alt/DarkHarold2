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

// Cross-list transfer primitives shared between the barter screen and the
// loot screen. Split out of ui_barter.ts. See wiki/ts-split-refactor.md
// → "Per-file split proposals" §21.

import { Obj } from '../object.js'
import { $id } from '../ui_dom.js'

// CE ref: inventory.cc:5534-5568 _draw_amount — BIGNUM.frm (FRM 170,
// art/intrface/bignum.png, 336×24) is a 24-glyph sprite strip at 14px/glyph.
// Digits 0-9 are at source x = digit * 14.  Five digits displayed at (125,45).
const BIGNUM_DIGIT_W = 14
const BIGNUM_DIGIT_H = 24
const BIGNUM_DIGITS = 5
const BIGNUM_X = 125  // relative to movemult.png (259×162)
const BIGNUM_Y = 45

// CE ref: inventory.cc:5800 — item icon at (16, 46), INVENTORY_LARGE_SLOT 56×56.
const ICON_X = 16
const ICON_Y = 46
const ICON_W = 56
const ICON_H = 56

// CE ref: inventory.cc:5816-5866 — plus at (200,46) 16×12, minus at (200,58) 17×12.
// Done at (98,128) 15×16, Cancel at (148,128) 15×16 (both baked into background art).
const PLUS_X = 200;  const PLUS_Y = 46;  const PLUS_W = 16;  const PLUS_H = 12
const MINUS_X = 200; const MINUS_Y = 58; const MINUS_W = 17; const MINUS_H = 12
const DONE_X = 98;   const DONE_Y = 128; const DONE_W = 60;  const DONE_H = 16
const CANCEL_X = 148; const CANCEL_Y = 128; const CANCEL_W = 60; const CANCEL_H = 16

function drawBignumDigits(ctx: CanvasRenderingContext2D, bignum: HTMLImageElement, value: number): void {
    const clamped = Math.max(0, Math.min(value, 99999))
    const digits = [
        Math.floor(clamped / 10000) % 10,
        Math.floor(clamped / 1000) % 10,
        Math.floor(clamped / 100) % 10,
        Math.floor(clamped / 10) % 10,
        clamped % 10,
    ]
    for (let i = 0; i < BIGNUM_DIGITS; i++) {
        ctx.drawImage(bignum,
            digits[i] * BIGNUM_DIGIT_W, 0, BIGNUM_DIGIT_W, BIGNUM_DIGIT_H,
            BIGNUM_X + i * BIGNUM_DIGIT_W, BIGNUM_Y, BIGNUM_DIGIT_W, BIGNUM_DIGIT_H)
    }
}

/**
 * CE-accurate "Move Items" modal — movemult.png (259×162) background, BIGNUM
 * digit display, +/- buttons. Uses static #moveMultOverlay DOM declared in
 * play.html + styled in ui.css (same pattern as all other DH2 UI panels).
 * CE ref: inventory.cc:5584 inventoryQuantitySelect, :5743
 * inventoryQuantityWindowInit, :5534 _draw_amount.
 * Resolves to the chosen quantity, or 0 on cancel.
 */
export function uiGetAmount(item: Obj): Promise<number> {
    const DIALOG_W = 259
    const DIALOG_H = 162

    return new Promise((resolve) => {
        let count = 1
        const max = Math.max(1, item.amount)

        const overlay = $id('moveMultOverlay')
        const canvas  = $id('moveMultCanvas') as HTMLCanvasElement
        const ctx     = canvas.getContext('2d')!

        overlay.style.display = 'flex'

        // Lazy-load BIGNUM strip and item icon; redraw when each arrives.
        const bignumImg = new Image()
        const iconImg   = new Image()
        let bignumReady = false
        let iconReady   = false

        function redraw() {
            ctx.clearRect(0, 0, DIALOG_W, DIALOG_H)
            if (bignumReady) drawBignumDigits(ctx, bignumImg, count)
            if (iconReady && item.invArt) {
                // CE ref: inventory.cc:5800 artRender — item icon at (ICON_X, ICON_Y),
                // INVENTORY_LARGE_SLOT 56×56. Preserve aspect ratio within the slot.
                const sw = iconImg.naturalWidth, sh = iconImg.naturalHeight
                const scale = Math.min(ICON_W / sw, ICON_H / sh)
                const dw = sw * scale, dh = sh * scale
                ctx.drawImage(iconImg,
                    ICON_X + (ICON_W - dw) / 2, ICON_Y + (ICON_H - dh) / 2,
                    dw, dh)
            }
        }

        bignumImg.onload = () => { bignumReady = true; redraw() }
        bignumImg.src = 'art/intrface/bignum.png'
        if (item.invArt) {
            iconImg.onload = () => { iconReady = true; redraw() }
            iconImg.src = item.invArt + '.png'
        }

        // CE ref: inventory.cc:5816 — plus/minus buttons with click-and-hold acceleration.
        let holdTimer: ReturnType<typeof setTimeout> | null = null
        function startHold(delta: number) {
            function tick() {
                count = Math.max(1, Math.min(max, count + delta))
                redraw()
                holdTimer = setTimeout(tick, 60)
            }
            holdTimer = setTimeout(tick, 300)
        }
        function stopHold() {
            if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null }
        }

        const plusBtn   = $id('moveMultPlusBtn')
        const minusBtn  = $id('moveMultMinusBtn')
        const allBtn    = $id('moveMultAllBtn')
        const doneBtn   = $id('moveMultDoneBtn')
        const cancelBtn = $id('moveMultCancelBtn')

        function onPlusDown(e: Event)  { e.preventDefault(); count = Math.min(max, count + 1); redraw(); startHold(1) }
        function onMinusDown(e: Event) { e.preventDefault(); count = Math.max(1,   count - 1); redraw(); startHold(-1) }
        function onAllClick()          { count = max; redraw() }
        function onDoneClick()         { cleanup(count) }
        function onCancelClick()       { cleanup(0) }

        plusBtn.addEventListener('mousedown', onPlusDown)
        plusBtn.addEventListener('mouseup',   stopHold)
        plusBtn.addEventListener('mouseleave', stopHold)
        minusBtn.addEventListener('mousedown', onMinusDown)
        minusBtn.addEventListener('mouseup',   stopHold)
        minusBtn.addEventListener('mouseleave', stopHold)
        allBtn.addEventListener('click',   onAllClick)
        doneBtn.addEventListener('click',   onDoneClick)
        cancelBtn.addEventListener('click', onCancelClick)

        // CE ref: inventory.cc:5707-5717 — direct digit key input (KEY_0-KEY_9).
        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Enter')  { cleanup(count); return }
            if (e.key === 'Escape') { cleanup(0);     return }
            const d = parseInt(e.key)
            if (!isNaN(d) && d >= 0 && d <= 9) {
                const typed = count < 10000 ? count * 10 + d : d
                count = Math.max(1, Math.min(max, typed))
                redraw()
            }
            if (e.key === 'ArrowUp')   { count = Math.min(max, count + 1); redraw() }
            if (e.key === 'ArrowDown') { count = Math.max(1,   count - 1); redraw() }
        }
        document.addEventListener('keydown', keyHandler, true)

        function cleanup(amount: number) {
            overlay.style.display = 'none'
            stopHold()
            plusBtn.removeEventListener('mousedown', onPlusDown)
            plusBtn.removeEventListener('mouseup',   stopHold)
            plusBtn.removeEventListener('mouseleave', stopHold)
            minusBtn.removeEventListener('mousedown', onMinusDown)
            minusBtn.removeEventListener('mouseup',   stopHold)
            minusBtn.removeEventListener('mouseleave', stopHold)
            allBtn.removeEventListener('click',   onAllClick)
            doneBtn.removeEventListener('click',   onDoneClick)
            cancelBtn.removeEventListener('click', onCancelClick)
            document.removeEventListener('keydown', keyHandler, true)
            resolve(amount)
        }

        redraw()
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
