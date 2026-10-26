import { assetUrl } from '../modAssets.js'
// Copyright 2024-2026 darkf
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Number-dial sprite helpers split out of ui_font.ts.
// See wiki/ts-split-refactor.md → "Per-file split proposals" §17.

// ---- Sprite-based number dial (matches HUD HP/AC/AP digits) ----------------
//
// art/intrface/numbers.png — horizontal strip, 9px wide × 17px tall per glyph.
// Indices: 0-9 = digits, 12 = minus sign, 13 = dash placeholder.
const NUM_DIGIT_W = 9
const NUM_DIGIT_H = 17
const NUM_SPRITE = 'art/intrface/numbers.png'
const NUM_MINUS_IDX = 12

/**
 * Populate a container element with child divs that display `value` as a
 * sprite-based number dial using numbers.png. Clears existing children first
 * so it can be called repeatedly to update the display.
 *
 * @param container  The element to render into (its children are replaced).
 * @param value      Integer to display (may be negative).
 * @param suffix     Optional text to append (e.g. '%').
 */
export function setNumberDial(
    container: HTMLElement,
    value: number,
    suffix?: string
): void {
    while (container.firstChild) container.removeChild(container.firstChild)

    const negative = value < 0
    const digits = Math.abs(value).toString()

    let left = 0

    if (negative) {
        const sign = document.createElement('div')
        sign.style.cssText = `
            position: absolute; left: ${left}px; top: 0;
            width: ${NUM_DIGIT_W}px; height: ${NUM_DIGIT_H}px;
            background-image: url('${assetUrl(NUM_SPRITE)}');
            background-position: ${-NUM_DIGIT_W * NUM_MINUS_IDX}px 0;
        `
        container.appendChild(sign)
        left += NUM_DIGIT_W
    }

    for (let i = 0; i < digits.length; i++) {
        const d = parseInt(digits[i])
        const el = document.createElement('div')
        el.style.cssText = `
            position: absolute; left: ${left}px; top: 0;
            width: ${NUM_DIGIT_W}px; height: ${NUM_DIGIT_H}px;
            background-image: url('${assetUrl(NUM_SPRITE)}');
            background-position: ${-NUM_DIGIT_W * d}px 0;
        `
        container.appendChild(el)
        left += NUM_DIGIT_W
    }

    if (suffix) {
        const suf = document.createElement('span')
        suf.textContent = suffix
        suf.style.cssText = `
            position: absolute; left: ${left}px; top: 0;
            color: #907824; font-size: 14px; line-height: ${NUM_DIGIT_H}px;
        `
        container.appendChild(suf)
    }
}

// ---- Bignum digit sprites (art/intrface/bignum.png) ------------------------
//
// Two rows of 12 characters (0–9, comma, percent):
//   Row 0 (y=0):  yellow    Row 1 (y=28): red
//   Cell size: 14px wide × 28px tall
const BIG_W = 14
const BIG_H = 28
const BIG_SPRITE = 'art/intrface/bignum.png'

// CE character_editor.cc characterEditorDrawBigNumber: a two-digit value outside 0..99
// shows "99". With `previous` (CE's ANIMATE flag) each changed digit — the ones first,
// then the tens — shows glyph 11 for BIG_NUM_ANIMATION_DELAY (123 ms) before its value.
const BIG_NUM_ANIMATION_DELAY = 123
export function renderBignum(
    value: number,
    digits: 2 | 3,
    color: 'yellow' | 'red' = 'yellow',
    previous?: number
): HTMLElement {
    const container = document.createElement('div')
    container.style.cssText = `display: inline-flex; height: ${BIG_H}px; flex-shrink: 0;`
    const yOffset = color === 'red' ? -BIG_H : 0
    const clamped = digits === 2
        ? (value < 0 || value > 99 ? 99 : value)
        : Math.max(0, Math.min(value, 999))
    const str = String(clamped).padStart(digits, '0')
    const cells: HTMLDivElement[] = []
    const glyph = (div: HTMLDivElement, n: number) => { div.style.backgroundPosition = `${-(n * BIG_W)}px ${yOffset}px` }
    for (const ch of str) {
        const n = parseInt(ch)
        const div = document.createElement('div')
        div.style.cssText = `width:${BIG_W}px;height:${BIG_H}px;background-image:url('${assetUrl(BIG_SPRITE)}');background-position:${-(n * BIG_W)}px ${yOffset}px;background-repeat:no-repeat;flex-shrink:0;`
        container.appendChild(div)
        cells.push(div)
    }
    if (digits === 2 && previous !== undefined && previous !== value
        && value >= 0 && value <= 99 && previous >= 0 && previous <= 99) {
        const steps: [HTMLDivElement, number][] = []
        if (previous % 10 !== value % 10) steps.push([cells[1], value % 10])
        if (Math.trunc(previous / 10) !== Math.trunc(value / 10)) steps.push([cells[0], Math.trunc(value / 10)])
        steps.forEach(([div, n], i) => {
            setTimeout(() => glyph(div, 11), i * BIG_NUM_ANIMATION_DELAY)
            setTimeout(() => glyph(div, n), (i + 1) * BIG_NUM_ANIMATION_DELAY)
        })
        for (const [div] of steps) glyph(div, Math.trunc(previous / (div === cells[0] ? 10 : 1)) % 10)
    }
    return container
}

// Redraws a two-digit big number in `el`, animated when it shows a different value than
// last time (CE: the editor's +/- and level-up redraws pass ANIMATE).
export function setBignum(el: HTMLElement, value: number, color: 'yellow' | 'red' = 'yellow'): void {
    const prev = el.dataset.bignum !== undefined ? Number(el.dataset.bignum) : undefined
    while (el.firstChild) el.removeChild(el.firstChild)
    el.appendChild(renderBignum(value, 2, color, prev))
    el.dataset.bignum = String(value)
}
