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
            background-image: url('${NUM_SPRITE}');
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
            background-image: url('${NUM_SPRITE}');
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

export function renderBignum(
    value: number,
    digits: 2 | 3,
    color: 'yellow' | 'red' = 'yellow'
): HTMLElement {
    const container = document.createElement('div')
    container.style.cssText = `display: inline-flex; height: ${BIG_H}px; flex-shrink: 0;`
    const yOffset = color === 'red' ? -BIG_H : 0
    const clamped = Math.max(0, Math.min(value, digits === 3 ? 999 : 99))
    const str = String(clamped).padStart(digits, '0')
    for (const ch of str) {
        const n = parseInt(ch)
        const div = document.createElement('div')
        div.style.cssText = `width:${BIG_W}px;height:${BIG_H}px;background-image:url('${BIG_SPRITE}');background-position:${-(n * BIG_W)}px ${yOffset}px;background-repeat:no-repeat;flex-shrink:0;`
        container.appendChild(div)
    }
    return container
}
