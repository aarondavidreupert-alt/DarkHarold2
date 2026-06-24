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
 * digit display, +/- buttons. CE ref: inventory.cc:5584 inventoryQuantitySelect,
 * :5743 inventoryQuantityWindowInit, :5534 _draw_amount.
 * Resolves to the chosen quantity, or 0 on cancel.
 */
export function uiGetAmount(item: Obj): Promise<number> {
    // movemult.png is actually 259×162 (the stale "169×60" comment in the old
    // code was wrong — verified via `file` command on the actual PNG).
    const DIALOG_W = 259
    const DIALOG_H = 162

    return new Promise((resolve) => {
        let count = 1
        const max = Math.max(1, item.amount)

        const overlay = document.createElement('div')
        Object.assign(overlay.style, {
            position: 'absolute',
            left: '0', top: '0', width: '100%', height: '100%',
            zIndex: '50',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
        })

        // CE ref: inventory.cc:5748 — 259×162 window centered on screen.
        const modal = document.createElement('div')
        Object.assign(modal.style, {
            position: 'relative',
            width: `${DIALOG_W}px`,
            height: `${DIALOG_H}px`,
            backgroundImage: "url('art/intrface/movemult.png')",
            backgroundSize: `${DIALOG_W}px ${DIALOG_H}px`,
            backgroundRepeat: 'no-repeat',
            imageRendering: 'pixelated',
        })

        // Canvas drawn on top of the background for digits + item icon.
        const canvas = document.createElement('canvas')
        canvas.width = DIALOG_W
        canvas.height = DIALOG_H
        Object.assign(canvas.style, {
            position: 'absolute', left: '0', top: '0',
            width: `${DIALOG_W}px`, height: `${DIALOG_H}px`,
            pointerEvents: 'none',
        })
        const ctx = canvas.getContext('2d')!
        modal.appendChild(canvas)

        // Lazy-load BIGNUM strip and item icon, redraw when ready.
        const bignumImg = new Image()
        const iconImg = new Image()
        let bignumReady = false
        let iconReady = false

        function redraw() {
            ctx.clearRect(0, 0, DIALOG_W, DIALOG_H)
            if (bignumReady) drawBignumDigits(ctx, bignumImg, count)
            if (iconReady && item.invArt) {
                // CE ref: inventory.cc:5800 artRender — item icon at (ICON_X, ICON_Y).
                ctx.drawImage(iconImg, 0, 0, iconImg.naturalWidth, iconImg.naturalHeight,
                    ICON_X, ICON_Y, ICON_W, ICON_H)
            }
        }

        bignumImg.onload = () => { bignumReady = true; redraw() }
        bignumImg.src = 'art/intrface/bignum.png'
        if (item.invArt) {
            iconImg.onload = () => { iconReady = true; redraw() }
            iconImg.src = item.invArt + '.png'
        }

        function cleanup(amount: number) {
            overlay.remove()
            document.removeEventListener('keydown', keyHandler, true)
            resolve(amount)
        }

        function makeHitZone(x: number, y: number, w: number, h: number, onClick: () => void): HTMLDivElement {
            const el = document.createElement('div')
            Object.assign(el.style, {
                position: 'absolute',
                left: `${x}px`, top: `${y}px`,
                width: `${w}px`, height: `${h}px`,
                cursor: 'pointer',
            })
            el.addEventListener('click', onClick)
            return el
        }

        // CE ref: inventory.cc:5816 — plus button at (200,46) increments count,
        // with click-and-hold acceleration (hold support via mousedown repeat).
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

        function makePlusBtn() {
            const el = makeHitZone(PLUS_X, PLUS_Y, PLUS_W, PLUS_H, () => {})
            el.addEventListener('mousedown', () => {
                count = Math.min(max, count + 1); redraw(); startHold(1)
            })
            el.addEventListener('mouseup', stopHold)
            el.addEventListener('mouseleave', stopHold)
            return el
        }

        function makeMinusBtn() {
            const el = makeHitZone(MINUS_X, MINUS_Y, MINUS_W, MINUS_H, () => {})
            el.addEventListener('mousedown', () => {
                count = Math.max(1, count - 1); redraw(); startHold(-1)
            })
            el.addEventListener('mouseup', stopHold)
            el.addEventListener('mouseleave', stopHold)
            return el
        }

        modal.appendChild(makePlusBtn())
        modal.appendChild(makeMinusBtn())
        // CE ref: inventory.cc:5876,5894 — done at (98,128), cancel at (148,128).
        modal.appendChild(makeHitZone(DONE_X, DONE_Y, DONE_W, DONE_H, () => cleanup(count)))
        modal.appendChild(makeHitZone(CANCEL_X, CANCEL_Y, CANCEL_W, CANCEL_H, () => cleanup(0)))

        // CE ref: inventory.cc:5707-5717 — direct digit key input (KEY_0-KEY_9).
        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Enter') { cleanup(count); return }
            if (e.key === 'Escape') { cleanup(0); return }
            const d = parseInt(e.key)
            if (!isNaN(d) && d >= 0 && d <= 9) {
                const typed = (count < 10000) ? count * 10 + d : d
                count = Math.max(1, Math.min(max, typed))
                redraw()
            }
            if (e.key === 'ArrowUp')   { count = Math.min(max, count + 1); redraw() }
            if (e.key === 'ArrowDown') { count = Math.max(1,   count - 1); redraw() }
        }
        document.addEventListener('keydown', keyHandler, true)

        overlay.appendChild(modal)
        $id('game-container').appendChild(overlay)
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
