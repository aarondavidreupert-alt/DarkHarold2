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

// Bitmap font rendering for authentic Fallout UI text.
//
// Reference: jsFO src/core/rendering.js blitFontString() / symbolInfo and
// AAF parser (fallout2-ce src/game/message.cc; jsFO src/loader/loader_aaf.py).
//
// Unlike pipboy.ts makeDigit() (which targets a fixed-metric numbers.png sheet),
// this renders variable-width glyphs from an AAF-derived sprite atlas + JSON
// symbol info map: { [charCode: number]: { x, y, w, h } }.

import { Widget } from './widget.js'
import { lazyLoadImage } from './images.js'

export interface SymbolInfo {
    x: number
    y: number
    w: number
    h: number
}

export type SymbolInfoMap = { [charCode: number]: SymbolInfo }

// Inter-glyph spacing in pixels (fallout2-ce: FONT_SPACE_BETWEEN_SYMBOLS = 1)
const GLYPH_GAP = 1

export class FontRenderer {
    /** Public URL of the sprite sheet (suitable for CSS url('...')). */
    spriteUrl: string

    private spritePath: string
    private jsonPath: string
    private symbolInfo: SymbolInfoMap | null = null
    private imageLoaded = false
    private loaded = false
    private loadStarted = false
    private loadCallbacks: (() => void)[] = []

    /**
     * @param spritePath  Path without .png extension (e.g. 'art/fonts/font0_aaf').
     *                    Passed to lazyLoadImage which appends .png.
     * @param jsonPath    Full path to the symbol info JSON (including .json).
     */
    constructor(spritePath: string, jsonPath: string) {
        this.spritePath = spritePath
        this.jsonPath = jsonPath
        this.spriteUrl = spritePath + '.png'
    }

    /** Kick off asset loading. Safe to call repeatedly. */
    private ensureLoadStarted(): void {
        if (this.loadStarted) {
            return
        }
        this.loadStarted = true

        lazyLoadImage(this.spritePath, () => {
            this.imageLoaded = true
            this.checkLoaded()
        })

        fetch(this.jsonPath)
            .then((r) => r.json())
            .then((info: SymbolInfoMap) => {
                this.symbolInfo = info
                this.checkLoaded()
            })
            .catch((err) => {
                console.error('FontRenderer: failed to load symbol info', this.jsonPath, err)
            })
    }

    private checkLoaded(): void {
        if (this.loaded || !this.imageLoaded || !this.symbolInfo) {
            return
        }
        this.loaded = true
        const callbacks = this.loadCallbacks.slice()
        this.loadCallbacks.length = 0
        for (const cb of callbacks) {
            cb()
        }
    }

    isLoaded(): boolean {
        return this.loaded
    }

    /** Register a one-shot callback that fires as soon as the font is ready. */
    onLoad(cb: () => void): void {
        this.ensureLoadStarted()
        if (this.loaded) {
            cb()
            return
        }
        this.loadCallbacks.push(cb)
    }

    /** Total pixel width of `text` at this font's metrics, or 0 if not loaded. */
    measureText(text: string): number {
        if (!this.symbolInfo) {
            return 0
        }
        let width = 0
        for (let i = 0; i < text.length; i++) {
            const code = text.charCodeAt(i)
            const info = this.symbolInfo[code]
            if (info) {
                width += info.w + GLYPH_GAP
            } else if (text[i] === ' ') {
                // Fallback space width when ' ' isn't in the atlas
                width += 4 + GLYPH_GAP
            }
        }
        return Math.max(0, width - GLYPH_GAP)
    }

    /**
     * Build a container div with one absolutely-positioned glyph div per
     * character. If the font isn't loaded yet, the container is returned
     * empty and filled in once loading completes.
     *
     * @param color  Optional tint — applied as a CSS `filter` on the
     *               container. The sprite is already yellow; pass a value
     *               here only if you want to recolor it (e.g. green/red
     *               for skilldex skill values).
     */
    renderText(text: string, color?: string): HTMLElement {
        const container = document.createElement('div')
        container.style.cssText = 'position: relative; display: inline-block;'
        if (color) {
            container.style.filter = FontRenderer.filterForColor(color)
        }

        let currentText = text

        const renderInto = (): void => {
            while (container.firstChild) {
                container.removeChild(container.firstChild)
            }
            if (!this.symbolInfo) {
                return
            }

            let left = 0
            let maxH = 0
            for (let i = 0; i < currentText.length; i++) {
                const code = currentText.charCodeAt(i)
                const info = this.symbolInfo[code]
                if (!info) {
                    // Unknown glyph: advance like a narrow space
                    if (currentText[i] === ' ') {
                        left += 4 + GLYPH_GAP
                    } else {
                        left += 4
                    }
                    continue
                }

                const glyph = document.createElement('div')
                glyph.style.cssText = `
                    position: absolute;
                    left: ${left}px; top: 0;
                    width: ${info.w}px; height: ${info.h}px;
                    background-image: url('${this.spriteUrl}');
                    background-position: -${info.x}px -${info.y}px;
                    background-repeat: no-repeat;
                `
                container.appendChild(glyph)
                left += info.w + GLYPH_GAP
                if (info.h > maxH) {
                    maxH = info.h
                }
            }
            container.style.width = `${Math.max(0, left - GLYPH_GAP)}px`
            container.style.height = `${maxH}px`
        }

        // Render now if ready, otherwise queue for when the font loads.
        this.onLoad(renderInto)

        // Attach a re-render handle so FontWidget.setText() can rebuild the
        // contents without having to throw away the container element.
        ;(container as any).__fontRerender = (newText: string) => {
            currentText = newText
            if (this.loaded) {
                renderInto()
            } else {
                this.onLoad(renderInto)
            }
        }

        return container
    }

    /**
     * Map a CSS color keyword / hex code to an approximate CSS `filter`
     * that recolors the yellow sprite. Good enough for the small palette
     * the UI actually uses (green/red for skill values).
     */
    static filterForColor(color: string): string {
        const c = color.toLowerCase()
        if (c === 'yellow' || c === '#ffd700' || c === '#ffff00' || c === '#ff0') {
            return 'sepia(1) saturate(4) hue-rotate(5deg)'
        }
        if (c === 'green' || c === '#00ff00' || c === 'lime') {
            return 'sepia(1) saturate(4) hue-rotate(65deg)'
        }
        if (c === 'red' || c === '#ff0000') {
            return 'sepia(1) saturate(5) hue-rotate(-40deg)'
        }
        return 'sepia(1) saturate(3)'
    }
}

/**
 * Widget wrapping a FontRenderer-produced element. Subclassing Widget
 * lets it slot into WindowFrame.add() and inherit .css() / .onClick().
 */
export class FontWidget extends Widget {
    private fontElem: HTMLElement

    constructor(
        x: number,
        y: number,
        public text: string,
        public renderer: FontRenderer,
        public textColor?: string
    ) {
        super(null, { x, y, w: 'auto', h: 'auto' })
        this.fontElem = renderer.renderText(text, textColor ?? 'yellow')
        this.elem.appendChild(this.fontElem)
    }

    /** Re-render in place when the underlying text changes. */
    setText(text: string): void {
        this.text = text
        const rerender = (this.fontElem as any).__fontRerender as
            | ((t: string) => void)
            | undefined
        if (rerender) {
            rerender(text)
        }
    }

    /** Recolor by tweaking the CSS filter on the font element. */
    setColor(color: string): void {
        this.textColor = color
        this.fontElem.style.filter = FontRenderer.filterForColor(color)
    }
}

/** Build a bitmap-font label widget at the given position. */
export function makeFontLabel(
    x: number,
    y: number,
    text: string,
    fontRenderer: FontRenderer
): FontWidget {
    return new FontWidget(x, y, text, fontRenderer)
}

/**
 * Parse a CSS hex color (#RRGGBB or #RGB) into [r, g, b].
 */
function parseHexColor(hex: string): [number, number, number] {
    const h = hex.replace('#', '')
    if (h.length === 3) {
        return [
            parseInt(h[0] + h[0], 16),
            parseInt(h[1] + h[1], 16),
            parseInt(h[2] + h[2], 16),
        ]
    }
    return [
        parseInt(h.substring(0, 2), 16),
        parseInt(h.substring(2, 4), 16),
        parseInt(h.substring(4, 6), 16),
    ]
}

// Cache of "actual glyph height" (distance from top of cell to last
// non-transparent pixel row) keyed by glyphMap object. Needed because the
// generated JSONs store `h: cell_h` (max font height) for every glyph —
// so the JSON alone can't tell us where a glyph's baseline is. We scan the
// sprite sheet once per font to recover the real heights.
const actualGlyphHeightCache = new WeakMap<object, Map<string, number>>()

function computeActualGlyphHeights(
    spriteSheet: HTMLImageElement,
    glyphMap: Record<string, { x: number; y: number; w: number; h: number }>
): Map<string, number> {
    const cached = actualGlyphHeightCache.get(glyphMap)
    if (cached) return cached

    const off = document.createElement('canvas')
    off.width = spriteSheet.width
    off.height = spriteSheet.height
    const offCtx = off.getContext('2d')!
    offCtx.drawImage(spriteSheet, 0, 0)

    const result = new Map<string, number>()
    for (const code of Object.keys(glyphMap)) {
        const g = glyphMap[code]
        if (g.w <= 0 || g.h <= 0) {
            result.set(code, 0)
            continue
        }
        let actualH = 0
        try {
            const data = offCtx.getImageData(g.x, g.y, g.w, g.h).data
            // Scan from bottom row upward for the first non-transparent row.
            for (let py = g.h - 1; py >= 0; py--) {
                let rowHasPixel = false
                for (let px = 0; px < g.w; px++) {
                    const idx = (py * g.w + px) * 4
                    // Count either alpha>0 (new format: white+alpha) or any
                    // color channel>0 (old format: baked-in color, alpha=255).
                    if (data[idx + 3] > 0 && (data[idx] > 0 || data[idx + 1] > 0 || data[idx + 2] > 0)) {
                        rowHasPixel = true
                        break
                    }
                }
                if (rowHasPixel) {
                    actualH = py + 1
                    break
                }
            }
        } catch {
            actualH = g.h
        }
        result.set(code, actualH)
    }

    actualGlyphHeightCache.set(glyphMap, result)
    return result
}

/**
 * Render a string into an HTMLCanvasElement by blitting glyphs from a sprite
 * sheet. Unlike FontRenderer.renderText (div-per-glyph), this draws once into
 * a single canvas — better for static labels that don't need per-glyph DOM.
 *
 * Glyphs are baseline-aligned: each glyph is drawn at y = canvasHeight -
 * actualHeight, matching jsFO's `rF_baseline - symbolInfo[idx].height`.
 * Actual glyph heights are measured from the sprite sheet at load time since
 * the JSON stores `h: cell_h` for every glyph (see fonts.py).
 *
 * The sprite sheet stores white pixels with glyph intensity as alpha (see
 * fonts.py). When a `color` hex string is provided, each pixel's red channel
 * is used as the alpha value and the RGB is replaced with the target color —
 * preserving the soft, worn AAF glyph edges.
 *
 * @param text          The string to render.
 * @param spriteSheet   The loaded sprite-sheet image.
 * @param glyphMap      Char-code (as string key) → {x, y, w, h} in the sheet.
 * @param letterSpacing Extra pixels between glyphs (default 1, matching
 *                      fallout2-ce FONT_SPACE_BETWEEN_SYMBOLS).
 * @param color         Optional CSS hex color (e.g. '#806814') to tint glyphs.
 */
export function renderBitmapText(
    text: string,
    spriteSheet: HTMLImageElement,
    glyphMap: Record<string, { x: number; y: number; w: number; h: number }>,
    letterSpacing: number = 1,
    color?: string
): HTMLCanvasElement {
    const actualHeights = computeActualGlyphHeights(spriteSheet, glyphMap)

    // Pass 1: measure canvas size using actual glyph heights.
    let totalWidth = 0
    let maxHeight = 0
    for (let i = 0; i < text.length; i++) {
        const code = String(text.charCodeAt(i))
        const glyph = glyphMap[code]
        if (glyph) {
            if (i > 0) totalWidth += letterSpacing
            totalWidth += glyph.w
            const h = actualHeights.get(code) ?? glyph.h
            if (h > maxHeight) maxHeight = h
        } else if (text[i] === ' ') {
            if (i > 0) totalWidth += letterSpacing
            totalWidth += 4
        }
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(totalWidth, 1)
    canvas.height = Math.max(maxHeight, 1)
    const ctx = canvas.getContext('2d')!

    // Pass 2: blit each glyph baseline-aligned at y = maxHeight - actualH.
    // Source rect uses actualH (not glyph.h) so empty rows at the bottom of
    // each cell in the sprite don't get copied.
    let x = 0
    for (let i = 0; i < text.length; i++) {
        const code = String(text.charCodeAt(i))
        const glyph = glyphMap[code]
        if (glyph) {
            if (i > 0) x += letterSpacing
            const h = actualHeights.get(code) ?? glyph.h
            if (h > 0) {
                const y = maxHeight - h
                ctx.drawImage(spriteSheet, glyph.x, glyph.y, glyph.w, h, x, y, glyph.w, h)
            }
            x += glyph.w
        } else if (text[i] === ' ') {
            if (i > 0) x += letterSpacing
            x += 4
        }
    }

    // Apply color via alpha compositing: use the red channel of the white
    // sprite as alpha, replace RGB with the target color.
    if (color && canvas.width > 0 && canvas.height > 0) {
        const [cr, cg, cb] = parseHexColor(color)
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const d = imgData.data
        for (let i = 0; i < d.length; i += 4) {
            const alpha = d[i]  // red channel = intensity
            d[i]     = cr
            d[i + 1] = cg
            d[i + 2] = cb
            d[i + 3] = alpha
        }
        ctx.putImageData(imgData, 0, 0)
    }

    return canvas
}

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

// ---- Singletons (lazy: assets are only fetched on first use) ---------------

export const font1 = new FontRenderer('art/fonts/font1_aaf', 'art/fonts/font1_aaf.json')
export const font3 = new FontRenderer('art/fonts/font3_aaf', 'art/fonts/font3_aaf.json')
