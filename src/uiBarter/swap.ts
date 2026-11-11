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
// loot screen. Split out of uiBarter.ts. See wiki/ts-split-refactor.md
// → "Per-file split proposals" §21.

import { recordAction } from '../actionLog.js'
import { Obj } from '../object.js'
import { $id, clearEl } from '../uiDom.js'
import { services } from '../state/services.js'
import { ammoGetQuantity, ammoMergeInto, ammoSplitOff } from '../weaponAmmo.js'
import { assetUrl } from '../modAssets.js'
import { FoText, font3 } from '../uiFont.js'
import { getMessage } from '../util.js'

// CE ref: inventory.cc:5534-5568 _draw_amount — BIGNUM.frm (FRM 170,
// art/intrface/bignum.png, 336×24) is a 24-glyph sprite strip at 14px/glyph.
// Digits 0-9 are at source x = digit * 14.  Five digits displayed at (125,45).
const BIGNUM_DIGIT_W = 14
const BIGNUM_DIGIT_H = 24
const BIGNUM_DIGITS = 5
const BIGNUM_X = 125 // relative to movemult.png (259×162)
const BIGNUM_Y = 45

// CE ref: inventory.cc:5800 — item icon at (16, 46) in the INVENTORY_LARGE_SLOT, 90×61
const ICON_X = 16
const ICON_Y = 46
const ICON_W = 90
const ICON_H = 61

// CE art.cc artRender: the item centred in the slot at its own size, shrunk (keeping its
// shape) only when it does not fit
function drawItemIcon(ctx: CanvasRenderingContext2D, img: HTMLImageElement): void {
    const sw = img.naturalWidth
    const sh = img.naturalHeight
    const scale = Math.min(1, ICON_W / sw, ICON_H / sh)
    const dw = Math.round(sw * scale)
    const dh = Math.round(sh * scale)
    ctx.drawImage(img, ICON_X + Math.trunc((ICON_W - dw) / 2), ICON_Y + Math.trunc((ICON_H - dh) / 2), dw, dh)
}

// CE inventoryQuantityWindowInit: the window's title, inventry.msg 21 (MOVE ITEMS) or 23
// (SET TIMER), font 103 in _colorTable[21091]
function setWindowTitle(msg: number, fallback: string): void {
    const $title = $id('moveMultTitle')
    clearEl($title)
    new FoText(font3, getMessage('inventry', msg) ?? fallback, '#a59c18').appendTo($title)
    setAllLabel()
}

// CE inventoryQuantityWindowInit: the ALL button's label, inventry.msg 22 in font 103,
// centred, 4 px down the 94x33 button art — _colorTable[21091] up, [18977] pressed
function setAllLabel(): void {
    const $all = $id('moveMultAllText')
    clearEl($all)
    const text = getMessage('inventry', 22) ?? 'ALL'
    const up = new FoText(font3, text, '#a59c18')
    up.elem.classList.add('fo-up')
    up.appendTo($all)
    const down = new FoText(font3, text, '#908808')
    down.elem.classList.add('fo-down')
    down.appendTo($all)
}

// CE ref: inventory.cc:5816-5866 — plus at (200,46) 16×12, minus at (200,58) 17×12.
// Done at (98,128) 15×16, Cancel at (148,128) 15×16 (both baked into background art).
const PLUS_X = 200
const PLUS_Y = 46
const PLUS_W = 16
const PLUS_H = 12
const MINUS_X = 200
const MINUS_Y = 58
const MINUS_W = 17
const MINUS_H = 12
const DONE_X = 98
const DONE_Y = 128
const DONE_W = 60
const DONE_H = 16
const CANCEL_X = 148
const CANCEL_Y = 128
const CANCEL_W = 60
const CANCEL_H = 16

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
        ctx.drawImage(
            bignum,
            digits[i] * BIGNUM_DIGIT_W,
            0,
            BIGNUM_DIGIT_W,
            BIGNUM_DIGIT_H,
            BIGNUM_X + i * BIGNUM_DIGIT_W,
            BIGNUM_Y,
            BIGNUM_DIGIT_W,
            BIGNUM_DIGIT_H,
        )
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
// Replay (src/autocrawler/replay.ts): the quantities the recorded player chose, instead of asking
let amountQueue: number[] = []
export function setAmountOverrides(amounts: number[]): void {
    amountQueue = amounts.slice()
}

/** The Move Items window; the choice goes to the action recorder (actionLog.ts) as an `amount`. */
export function uiGetAmount(item: Obj): Promise<number> {
    if (amountQueue.length > 0) {
        return Promise.resolve(Math.min(amountQueue.shift()!, Math.max(1, item.amount)))
    }
    return promptAmount(item).then((n) => {
        recordAction({ t: 'amount', n })
        return n
    })
}

function promptAmount(item: Obj): Promise<number> {
    const DIALOG_W = 259
    const DIALOG_H = 162

    return new Promise((resolve) => {
        let count = 1
        const max = Math.max(1, item.amount)

        const overlay = $id('moveMultOverlay')
        const canvas = $id('moveMultCanvas') as HTMLCanvasElement
        const ctx = canvas.getContext('2d')!

        overlay.style.display = 'flex'
        setWindowTitle(21, 'MOVE ITEMS')

        // Lazy-load BIGNUM strip and item icon; redraw when each arrives.
        const bignumImg = new Image()
        const iconImg = new Image()
        let bignumReady = false
        let iconReady = false

        function redraw() {
            ctx.clearRect(0, 0, DIALOG_W, DIALOG_H)
            if (bignumReady) drawBignumDigits(ctx, bignumImg, count)
            if (iconReady && item.invArt) {
                drawItemIcon(ctx, iconImg) // CE ref: inventory.cc:5800 artRender
            }
        }

        bignumImg.onload = () => {
            bignumReady = true
            redraw()
        }
        bignumImg.src = assetUrl('art/intrface/bignum.png')
        if (item.invArt) {
            iconImg.onload = () => {
                iconReady = true
                redraw()
            }
            iconImg.src = assetUrl(item.invArt + '.png')
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
            if (holdTimer !== null) {
                clearTimeout(holdTimer)
                holdTimer = null
            }
        }

        const plusBtn = $id('moveMultPlusBtn')
        const minusBtn = $id('moveMultMinusBtn')
        const allBtn = $id('moveMultAllBtn')
        const doneBtn = $id('moveMultDoneBtn')
        const cancelBtn = $id('moveMultCancelBtn')

        // CE inventoryQuantitySelect: typing starts over on the first digit (isTyping); the
        // buttons end it
        let typing = false
        function onPlusDown(e: Event) {
            e.preventDefault()
            typing = false
            count = Math.min(max, count + 1)
            redraw()
            startHold(1)
        }
        function onMinusDown(e: Event) {
            e.preventDefault()
            typing = false
            count = Math.max(1, count - 1)
            redraw()
            startHold(-1)
        }
        function onAllClick() {
            typing = false
            count = max
            redraw()
        }
        function onDoneClick() {
            if (count >= 1 && count <= max) cleanup(count)
            else services.audioEngine?.playSfxByName?.('iisxxxx1')
        }
        function onCancelClick() {
            cleanup(0)
        }

        plusBtn.addEventListener('mousedown', onPlusDown)
        plusBtn.addEventListener('mouseup', stopHold)
        plusBtn.addEventListener('mouseleave', stopHold)
        minusBtn.addEventListener('mousedown', onMinusDown)
        minusBtn.addEventListener('mouseup', stopHold)
        minusBtn.addEventListener('mouseleave', stopHold)
        allBtn.addEventListener('click', onAllClick)
        doneBtn.addEventListener('click', onDoneClick)
        cancelBtn.addEventListener('click', onCancelClick)

        // CE ref: inventory.cc inventoryQuantitySelect (MOVE_ITEMS): a digit — the first one
        // replaces the value — makes it 10 × value % 100000 + digit, Backspace drops the last
        // digit; Return takes a value from 1 to max (ib1p1xx1), else iisxxxx1 and keeps going.
        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                if (count >= 1 && count <= max) {
                    services.audioEngine?.playSfxByName?.('ib1p1xx1')
                    cleanup(count)
                } else services.audioEngine?.playSfxByName?.('iisxxxx1')
                return
            }
            if (e.key === 'Escape') {
                cleanup(0)
                return
            }
            const d = e.key.length === 1 ? parseInt(e.key) : NaN
            if (!isNaN(d) && d >= 0 && d <= 9) {
                if (!typing) count = 0
                count = ((10 * count) % 100000) + d
                typing = true
                redraw()
            }
            if (e.key === 'Backspace') {
                if (!typing) count = 0
                count = Math.trunc(count / 10)
                typing = true
                redraw()
            }
            if (e.key === 'ArrowUp') {
                typing = false
                count = Math.min(max, count + 1)
                redraw()
            }
            if (e.key === 'ArrowDown') {
                typing = false
                count = Math.max(1, count - 1)
                redraw()
            }
        }
        document.addEventListener('keydown', keyHandler, true)

        function cleanup(amount: number) {
            overlay.style.display = 'none'
            stopHold()
            plusBtn.removeEventListener('mousedown', onPlusDown)
            plusBtn.removeEventListener('mouseup', stopHold)
            plusBtn.removeEventListener('mouseleave', stopHold)
            minusBtn.removeEventListener('mousedown', onMinusDown)
            minusBtn.removeEventListener('mouseup', stopHold)
            minusBtn.removeEventListener('mouseleave', stopHold)
            allBtn.removeEventListener('click', onAllClick)
            doneBtn.removeEventListener('click', onDoneClick)
            cancelBtn.removeEventListener('click', onCancelClick)
            document.removeEventListener('keydown', keyHandler, true)
            resolve(amount)
        }

        redraw()
    })
}

/**
 * CE "Set Timer" window — inventoryQuantitySelect(INVENTORY_WINDOW_TYPE_SET_TIMER,
 * item, 180): the move-items window (movemult) with the TIMER overlay at (113,34),
 * plus / minus at (194,64) / (194,76) stepping 10 seconds from 60 (10 … 180), the
 * time drawn as m:ss in BIGNUM digits at (133,64) and no ALL button. Resolves to the
 * seconds, or -1 on cancel. CE ref: inventory.cc:5584, :5743, :5534 _draw_amount.
 */
// Replay: the timer settings the recorded player chose, instead of asking
let timerQueue: number[] = []
export function setTimerOverrides(seconds: number[]): void {
    timerQueue = seconds.slice()
}

/** The Set Timer window; the choice goes to the action recorder (actionLog.ts) as a `timer`. */
export function uiGetTimer(item: Obj): Promise<number> {
    if (timerQueue.length > 0) {
        return Promise.resolve(timerQueue.shift()!)
    }
    return promptTimer(item).then((seconds) => {
        recordAction({ t: 'timer', n: seconds })
        return seconds
    })
}

function promptTimer(item: Obj): Promise<number> {
    const DIALOG_W = 259
    const DIALOG_H = 162
    const MIN = 10,
        MAX = 180
    return new Promise((resolve) => {
        let value = 60
        const overlay = $id('moveMultOverlay')
        const canvas = $id('moveMultCanvas') as HTMLCanvasElement
        const ctx = canvas.getContext('2d')!
        const plusBtn = $id('moveMultPlusBtn')
        const minusBtn = $id('moveMultMinusBtn')
        const allBtn = $id('moveMultAllBtn')
        const doneBtn = $id('moveMultDoneBtn')
        const cancelBtn = $id('moveMultCancelBtn')
        const saved = { plus: plusBtn.style.cssText, minus: minusBtn.style.cssText, all: allBtn.style.display }
        plusBtn.style.left = '194px'
        plusBtn.style.top = '64px'
        minusBtn.style.left = '194px'
        minusBtn.style.top = '76px'
        allBtn.style.display = 'none'
        overlay.style.display = 'flex'
        setWindowTitle(23, 'SET TIMER')

        const bignum = new Image(),
            timer = new Image(),
            icon = new Image()
        let ready = 0
        const redraw = () => {
            ctx.clearRect(0, 0, DIALOG_W, DIALOG_H)
            if (timer.complete && timer.naturalWidth) ctx.drawImage(timer, 113, 34)
            if (icon.complete && icon.naturalWidth) {
                drawItemIcon(ctx, icon)
            }
            if (bignum.complete && bignum.naturalWidth) {
                const digit = (d: number, x: number) =>
                    ctx.drawImage(
                        bignum,
                        d * BIGNUM_DIGIT_W,
                        0,
                        BIGNUM_DIGIT_W,
                        BIGNUM_DIGIT_H,
                        x,
                        64,
                        BIGNUM_DIGIT_W,
                        BIGNUM_DIGIT_H,
                    )
                digit(Math.trunc(value / 60), 133)
                digit(Math.trunc((value % 60) / 10), 133 + 14 * 2)
                digit(value % 10, 133 + 14 * 3)
            }
            void ready
        }
        for (const [img, src] of [
            [bignum, 'art/intrface/bignum.png'],
            [timer, 'art/intrface/timer.png'],
            [icon, item.invArt ? item.invArt + '.png' : ''],
        ] as [HTMLImageElement, string][]) {
            if (!src) continue
            img.onload = () => {
                ready++
                redraw()
            }
            img.src = assetUrl(src)
        }
        const sfx = (name: string) => {
            try {
                services.audioEngine?.playSfxByName(name)
            } catch (e) {
                void e
            }
        }
        const onPlus = (e: Event) => {
            e.preventDefault()
            if (value < MAX) {
                value += 10
                redraw()
            }
        }
        const onMinus = (e: Event) => {
            e.preventDefault()
            if (value > MIN) {
                value -= 10
                redraw()
            }
        }
        const accept = () => {
            if (value >= MIN && value <= MAX && value % 10 === 0) {
                sfx('ib1p1xx1')
                cleanup(value)
            } else sfx('iisxxxx1')
        }
        const onCancel = () => cleanup(-1)
        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault()
                accept()
            } else if (e.key === 'Escape') {
                e.preventDefault()
                cleanup(-1)
            }
        }
        plusBtn.addEventListener('mousedown', onPlus)
        minusBtn.addEventListener('mousedown', onMinus)
        doneBtn.addEventListener('click', accept)
        cancelBtn.addEventListener('click', onCancel)
        document.addEventListener('keydown', keyHandler, true)
        function cleanup(result: number) {
            overlay.style.display = 'none'
            plusBtn.style.cssText = saved.plus
            minusBtn.style.cssText = saved.minus
            allBtn.style.display = saved.all
            plusBtn.removeEventListener('mousedown', onPlus)
            minusBtn.removeEventListener('mousedown', onMinus)
            doneBtn.removeEventListener('click', accept)
            cancelBtn.removeEventListener('click', onCancel)
            document.removeEventListener('keydown', keyHandler, true)
            resolve(result)
        }
        redraw()
    })
}

function _uiAddItem(items: Obj[], item: Obj, count: number) {
    for (let i = 0; i < items.length; i++) {
        if (items[i].approxEq(item)) {
            // CE itemAdd: ammo stacks combine their top boxes
            if (item.subtype === 'ammo') ammoMergeInto(items[i], count, ammoGetQuantity(item))
            else items[i].amount += count
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
        throw new Error('item (' + item + ') does not exist in a')
    }

    if (amount < item.amount) {
        // deduct amount from a and give amount to b; CE itemRemove: the moved boxes take
        // the top ammo box, the ones left are full
        const moved = item.clone()
        item.amount -= amount
        ammoSplitOff(item, moved)
        _uiAddItem(b, moved, amount)
        return
    }
    // just swap them
    else {
        a.splice(idx, 1)
    }

    // add the item to b
    _uiAddItem(b, item, amount)
}
