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

import { dbgWarn } from '../logger.js'
import { Widget } from '../ui_widget.js'

export interface SymbolInfo {
    x: number
    y: number
    w: number
    h: number
}

export type SymbolInfoMap = { [charCode: number]: SymbolInfo }

// CE font metrics (font_manager.cc InterfaceFontDescriptor), written by
// tools/exportFonts.py as the JSON's "meta" entry.
export interface FontMeta {
    maxHeight: number
    letterSpacing: number
    wordSpacing: number
    lineSpacing: number
}

// Fallback inter-glyph spacing for atlases without "meta" (CE letterSpacing is 1
// for fonts 0-3, 2 for font 4).
const DEFAULT_LETTER_SPACING = 1

// Version query for the font atlases: bumped when tools/exportFonts.py changes the
// layout, so browsers don't keep an old cached sheet (the top-aligned pre-U14
// atlas drawn with the bottom-aligned renderer puts every lower-case letter high).
export const FONT_ASSET_QUERY = '?r=2'

// CE text colours (_colorTable[<RGB555>] → color.pal entry). The names say where CE
// uses them; hex values are the palette colours.
export const CE_COLOR = {
    label: '#907824',          // 18979 — labels, headings, button text
    labelPressed: '#7c6818',   // 14723 — pressed button text, inactive tab
    green: '#3cf800',          // 992   — values / list entries
    highlight: '#fcfc7c',      // 32747 — the selected list entry
    tagged: '#a0a0a0',         // 21140 — tagged skill / picked trait
    taggedHighlight: '#fcfcfc', // 32767 — selected tagged skill / picked trait
    dimGreen: '#183018',       // 1313  — inactive condition
    dimHighlight: '#707820',   // 15845 — selected inactive condition
    dialog: '#fc9c48',         // 32328 — dialog box text
} as const

// Legacy colour names some callers pass → CE colour.
export function resolveFontColor(color: string): string {
    switch (color.toLowerCase()) {
        case 'yellow': case '#ffd700': case '#ffff00': case '#ff0': return CE_COLOR.label
        case 'green': case 'lime': case '#00ff00': return CE_COLOR.green
        case 'red': return '#fc0000'
        default: return color
    }
}

export class FontRenderer {
    /** Public URL of the sprite sheet (suitable for CSS url('...')). */
    spriteUrl: string

    private spritePath: string
    private jsonPath: string
    private symbolInfo: SymbolInfoMap | null = null
    private meta: FontMeta | null = null
    private spriteImage: HTMLImageElement | null = null
    private imageLoaded = false
    private loaded = false
    private loadStarted = false
    private loadCallbacks: (() => void)[] = []

    /**
     * @param spritePath  Path without .png extension (e.g. 'art/fonts/font0_aaf').
     *                    '.png' + FONT_ASSET_QUERY is appended.
     * @param jsonPath    Full path to the symbol info JSON (including .json).
     */
    constructor(spritePath: string, jsonPath: string) {
        this.spritePath = spritePath
        this.jsonPath = jsonPath
        this.spriteUrl = spritePath + '.png' + FONT_ASSET_QUERY
    }

    /** Kick off asset loading. Safe to call repeatedly. */
    private ensureLoadStarted(): void {
        if (this.loadStarted) {
            return
        }
        this.loadStarted = true

        const img = new Image()
        img.onload = () => {
            this.spriteImage = img
            this.imageLoaded = true
            this.checkLoaded()
        }
        img.onerror = () => dbgWarn('renderer', `FontRenderer: failed to load ${this.spriteUrl}`)
        img.src = this.spriteUrl

        fetch(this.jsonPath + FONT_ASSET_QUERY)
            .then((r) => r.json())
            .then((info: SymbolInfoMap & { meta?: FontMeta }) => {
                this.meta = info.meta ?? null
                this.symbolInfo = info
                this.checkLoaded()
            })
            .catch((err) => {
                dbgWarn('renderer', `FontRenderer: failed to load symbol info ${this.jsonPath}:`, err)
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

    /** CE letterSpacing — pixels between glyphs. */
    get letterSpacing(): number {
        return this.meta?.letterSpacing ?? DEFAULT_LETTER_SPACING
    }

    /** CE line height: maxHeight + lineSpacing (font_manager.cc:229). */
    get lineHeight(): number {
        return this.meta ? this.meta.maxHeight + this.meta.lineSpacing : 0
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
                width += info.w + this.letterSpacing
            } else if (text[i] === ' ') {
                // Fallback space width when ' ' isn't in the atlas
                width += 4 + this.letterSpacing
            }
        }
        return Math.max(0, width - this.letterSpacing)
    }

    /**
     * Build a container holding `text` drawn by renderBitmapText (exact colour
     * tint, CE glyph placement). If the font isn't loaded yet, the container is
     * returned empty and filled in once loading completes.
     *
     * @param color  CSS hex colour, or a legacy name (resolveFontColor); without
     *               one the glyphs stay white.
     */
    renderText(text: string, color?: string): HTMLElement {
        const container = document.createElement('div')
        container.style.cssText = 'position: relative; display: inline-block; line-height: 0;'
        const hex = color ? resolveFontColor(color) : undefined

        let currentText = text

        const renderInto = (): void => {
            while (container.firstChild) {
                container.removeChild(container.firstChild)
            }
            if (!this.symbolInfo || !this.spriteImage) {
                return
            }
            const canvas = renderBitmapText(
                currentText,
                this.spriteImage,
                this.symbolInfo as unknown as Record<string, SymbolInfo>,
                this.letterSpacing,
                hex
            )
            canvas.style.display = 'block'
            container.appendChild(canvas)
            container.style.width = `${canvas.width}px`
            container.style.height = `${canvas.height}px`
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
            this.letterSpacing,
            color
        )
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

    /** Re-render in another colour. */
    setColor(color: string): void {
        this.textColor = color
        const next = this.renderer.renderText(this.text, color)
        this.elem.replaceChild(next, this.fontElem)
        this.fontElem = next
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

/**
 * Render a string into an HTMLCanvasElement by blitting glyphs from a sprite
 * sheet. Unlike FontRenderer.renderText (div-per-glyph), this draws once into
 * a single canvas — better for static labels that don't need per-glyph DOM.
 *
 * CE ref: font_manager.cc interfaceFontDrawImpl — every glyph is drawn bottom-
 * aligned in a maxHeight-tall line (`ptr += (maxHeight - glyph->height) * pitch`).
 * tools/exportFonts.py already places each glyph that way inside its cell, so
 * the cells are blitted whole at y = 0: lower-case letters keep their two empty
 * bottom rows and g/p/q/y/j hang their descenders into them.
 *
 * The sprite sheet stores white pixels with glyph intensity as alpha. When a
 * `color` hex string is provided, each pixel's red channel is used as the alpha
 * value and the RGB is replaced with the target color — preserving the soft
 * AAF glyph edges.
 *
 * @param text          The string to render.
 * @param spriteSheet   The loaded sprite-sheet image.
 * @param glyphMap      Char-code (as string key) → {x, y, w, h} in the sheet.
 * @param letterSpacing Pixels between glyphs (CE letterSpacing).
 * @param color         Optional CSS hex color (e.g. '#806814') to tint glyphs.
 */
export function renderBitmapText(
    text: string,
    spriteSheet: HTMLImageElement,
    glyphMap: Record<string, { x: number; y: number; w: number; h: number }>,
    letterSpacing: number = 1,
    color?: string
): HTMLCanvasElement {
    // Pass 1: width and line height (the cell height = CE maxHeight).
    let totalWidth = 0
    let lineH = 0
    for (let i = 0; i < text.length; i++) {
        const glyph = glyphMap[String(text.charCodeAt(i))]
        if (i > 0) totalWidth += letterSpacing
        if (glyph) {
            totalWidth += glyph.w
            if (glyph.h > lineH) lineH = glyph.h
        } else {
            totalWidth += 4
        }
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(totalWidth, 1)
    canvas.height = Math.max(lineH, 1)
    const ctx = canvas.getContext('2d')!

    // Pass 2: blit each glyph cell.
    let x = 0
    for (let i = 0; i < text.length; i++) {
        const glyph = glyphMap[String(text.charCodeAt(i))]
        if (i > 0) x += letterSpacing
        if (glyph) {
            if (glyph.w > 0 && glyph.h > 0) {
                ctx.drawImage(spriteSheet, glyph.x, glyph.y, glyph.w, glyph.h, x, 0, glyph.w, glyph.h)
            }
            x += glyph.w
        } else {
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
