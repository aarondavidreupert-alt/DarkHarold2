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

// Bitmap font rendering core — split out of ui_font.ts.
// See wiki/ts-split-refactor.md → "Per-file split proposals" §17.
//
// Reference: jsFO src/core/rendering.js blitFontString() / symbolInfo and
// AAF parser (fallout2-ce src/game/message.cc; jsFO src/loader/loader_aaf.py).
//
// Unlike pipboy.ts makeDigit() (which targets a fixed-metric numbers.png sheet),
// this renders variable-width glyphs from an AAF-derived sprite atlas + JSON
// symbol info map: { [charCode: number]: { x, y, w, h } }.

import { Widget } from '../ui_widget.js'
import { lazyLoadImage } from '../images.js'

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
    private spriteImage: HTMLImageElement | null = null
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

        lazyLoadImage(this.spritePath, (img) => {
            this.spriteImage = img
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

            // Pass 1: measure line height so every glyph can be bottom-aligned.
            // Without this, shorter glyphs (e, x) share a top edge with taller ones (t, h),
            // making ascenders appear to hang below instead of above the x-height.
            let maxH = 0
            for (let i = 0; i < currentText.length; i++) {
                const info = this.symbolInfo[currentText.charCodeAt(i)]
                if (info && info.h > maxH) maxH = info.h
            }

            // Pass 2: lay out glyphs baseline-aligned (bottom edges flush).
            let left = 0
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
                    left: ${left}px; top: ${maxH - info.h}px;
                    width: ${info.w}px; height: ${info.h}px;
                    background-image: url('${this.spriteUrl}');
                    background-position: -${info.x}px -${info.y}px;
                    background-repeat: no-repeat;
                `
                container.appendChild(glyph)
                left += info.w + GLYPH_GAP
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
     * Render `text` into a canvas using the pixel-accurate `renderBitmapText`
     * path: actual glyph heights (not JSON cell heights), proper color via
     * alpha compositing. Requires the font to be loaded; returns an empty
     * 1×1 canvas if called too early (FoText queues the call via onLoad).
     */
    renderCanvas(text: string, color?: string): HTMLCanvasElement {
        if (!this.spriteImage || !this.symbolInfo) {
            const blank = document.createElement('canvas')
            blank.width = 1
            blank.height = 1
            return blank
        }
        return renderBitmapText(
            text,
            this.spriteImage,
            this.symbolInfo as unknown as Record<string, SymbolInfo>,
            1,
            color
        )
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

interface GlyphMetrics {
    /** First pixel row from the top of the cell (0 = glyph starts at cell top). */
    topRow: number
    /** Distance from cell top to last pixel row + 1 (= bottomRow + 1). */
    actualH: number
}

// Cache per glyphMap object — scanned once per font load.
const glyphMetricsCache = new WeakMap<object, Map<string, GlyphMetrics>>()

/**
 * Scan the sprite sheet pixel-by-pixel for each glyph cell to find:
 *   topRow  — first row that contains any visible pixel (from the top)
 *   actualH — last row that contains any visible pixel + 1 (from the top)
 *
 * Needed because the generated JSONs store `h: cell_h` for every glyph, so
 * the JSON alone cannot distinguish ascenders, x-height letters, and descenders.
 */
function computeGlyphMetrics(
    spriteSheet: HTMLImageElement,
    glyphMap: Record<string, { x: number; y: number; w: number; h: number }>
): Map<string, GlyphMetrics> {
    const cached = glyphMetricsCache.get(glyphMap)
    if (cached) return cached

    const off = document.createElement('canvas')
    off.width = spriteSheet.width
    off.height = spriteSheet.height
    const offCtx = off.getContext('2d')!
    offCtx.drawImage(spriteSheet, 0, 0)

    function rowHasPixel(data: Uint8ClampedArray, py: number, w: number): boolean {
        for (let px = 0; px < w; px++) {
            const idx = (py * w + px) * 4
            if (data[idx + 3] > 0 && (data[idx] > 0 || data[idx + 1] > 0 || data[idx + 2] > 0)) {
                return true
            }
        }
        return false
    }

    const result = new Map<string, GlyphMetrics>()
    for (const code of Object.keys(glyphMap)) {
        const g = glyphMap[code]
        if (g.w <= 0 || g.h <= 0) {
            result.set(code, { topRow: 0, actualH: 0 })
            continue
        }
        let topRow = 0
        let actualH = 0
        try {
            const data = offCtx.getImageData(g.x, g.y, g.w, g.h).data
            // Find first non-empty row from the top.
            let foundTop = false
            for (let py = 0; py < g.h; py++) {
                if (rowHasPixel(data, py, g.w)) {
                    topRow = py
                    foundTop = true
                    break
                }
            }
            if (!foundTop) {
                result.set(code, { topRow: 0, actualH: 0 })
                continue
            }
            // Find last non-empty row from the bottom.
            for (let py = g.h - 1; py >= topRow; py--) {
                if (rowHasPixel(data, py, g.w)) {
                    actualH = py + 1
                    break
                }
            }
        } catch {
            topRow = 0
            actualH = g.h
        }
        result.set(code, { topRow, actualH })
    }

    glyphMetricsCache.set(glyphMap, result)
    return result
}

/**
 * Render a string into an HTMLCanvasElement by blitting glyphs from a sprite
 * sheet. Unlike FontRenderer.renderText (div-per-glyph), this draws once into
 * a single canvas — better for static labels that don't need per-glyph DOM.
 *
 * Uses true baseline alignment:
 *   - The baseline is anchored to 'A' (char 65): its actualH defines where the
 *     bottom of non-descender glyphs sits.
 *   - Each glyph is drawn at canvas y = topRow (its first pixel row), so
 *     x-height letters (e, a, r) appear lower than cap-height letters (A, T).
 *   - Descenders (g, p, y) have actualH > baseline, so they extend below it.
 *   - Canvas height = baseline + max descender depth.
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
    const metrics = computeGlyphMetrics(spriteSheet, glyphMap)

    // All glyphs are top-aligned in the sprite (topRow=0 for every glyph).
    // The AAF format stores each glyph starting at row 0, with empty rows at
    // the BOTTOM for short characters (e, a) and extra rows at the BOTTOM for
    // descenders (g, p, y).
    //
    // Strategy: use 'A' (char 65) as the baseline reference.
    //   - actualH('A') = the cap-height, which equals the baseline in this format.
    //   - Non-descenders (actualH ≤ baseline): bottom-align to baseline by drawing
    //     at canvas y = baseline - actualH.  Their bottoms all land on the same row.
    //   - Descenders (actualH > baseline): draw at canvas y = 0 (same top as 'A').
    //     Their body bottom aligns with 'A' at baseline-1; their descender pixels
    //     extend into the reserved zone below.
    const baselineH = metrics.get(String('A'.charCodeAt(0)))?.actualH
                   ?? metrics.get(String('a'.charCodeAt(0)))?.actualH
                   ?? 1

    // Pass 1: measure total width and max descender depth.
    let totalWidth = 0
    let maxDescent = 0
    for (let i = 0; i < text.length; i++) {
        const code = String(text.charCodeAt(i))
        const glyph = glyphMap[code]
        if (glyph) {
            if (i > 0) totalWidth += letterSpacing
            totalWidth += glyph.w
            const m = metrics.get(code)
            if (m) {
                const descent = Math.max(0, m.actualH - baselineH)
                if (descent > maxDescent) maxDescent = descent
            }
        } else if (text[i] === ' ') {
            if (i > 0) totalWidth += letterSpacing
            totalWidth += 4
        }
    }

    const canvasH = baselineH + maxDescent
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(totalWidth, 1)
    canvas.height = Math.max(canvasH, 1)
    const ctx = canvas.getContext('2d')!

    // Pass 2: blit each glyph.
    //   Non-descender: canvas y = baselineH - actualH  (bottom-aligned to baseline)
    //   Descender:     canvas y = 0                    (top-aligned, body matches 'A')
    // Source rect height = actualH so we skip empty rows at the bottom of each cell.
    let x = 0
    for (let i = 0; i < text.length; i++) {
        const code = String(text.charCodeAt(i))
        const glyph = glyphMap[code]
        if (glyph) {
            if (i > 0) x += letterSpacing
            const m = metrics.get(code)
            if (m && m.actualH > 0) {
                const isDescender = m.actualH > baselineH
                const canvasY = isDescender ? 0 : baselineH - m.actualH
                ctx.drawImage(spriteSheet, glyph.x, glyph.y, glyph.w, m.actualH, x, canvasY, glyph.w, m.actualH)
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
