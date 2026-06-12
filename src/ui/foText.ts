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

// FoText — a drop-in DOM element that renders text using an AAF bitmap font.
//
// Intended as the long-term replacement for plain HTML text in the game UI.
// Uses FontRenderer.renderCanvas() internally, which calls renderBitmapText —
// the canvas-based path that handles proper baseline alignment (via pixel
// scanning) and pixel-accurate color compositing.
//
// Usage:
//   import { FoText } from '../ui_font.js'
//   import { font3 } from '../ui_font.js'
//
//   const label = new FoText(font3, 'HELLO', '#c8b466')
//   label.appendTo(container)
//
//   // Later updates:
//   label.text = 'WORLD'
//   label.color = '#ff0000'

import { FontRenderer } from './fontCore.js'

export class FoText {
    /** The wrapper element — append this to the DOM. */
    readonly elem: HTMLElement

    private canvas: HTMLCanvasElement | null = null
    private renderer: FontRenderer
    private _text: string
    private _color: string | undefined

    /**
     * @param renderer  A FontRenderer instance (e.g. font1, font3, font4 from ui_font.ts).
     * @param text      Initial text string.
     * @param color     Optional CSS hex color (e.g. '#c8b466'). If omitted the
     *                  sprite's native color is used (white in the atlas).
     */
    constructor(renderer: FontRenderer, text = '', color?: string) {
        this.renderer = renderer
        this._text = text
        this._color = color

        this.elem = document.createElement('div')
        this.elem.style.cssText = 'display: inline-block; line-height: 0;'

        // Queue first render — fires immediately if already loaded.
        renderer.onLoad(() => this.redraw())
    }

    // ── Text ──────────────────────────────────────────────────────────────────

    get text(): string { return this._text }
    set text(v: string) {
        if (v === this._text) return
        this._text = v
        if (this.renderer.isLoaded()) this.redraw()
    }

    /** Fluent alias for the text setter. */
    setText(v: string): this {
        this.text = v
        return this
    }

    // ── Color ─────────────────────────────────────────────────────────────────

    get color(): string | undefined { return this._color }
    set color(v: string | undefined) {
        this._color = v
        if (this.renderer.isLoaded()) this.redraw()
    }

    /** Fluent alias for the color setter. */
    setColor(v: string | undefined): this {
        this.color = v
        return this
    }

    // ── Dimensions ────────────────────────────────────────────────────────────

    /** Rendered pixel width (0 if font not yet loaded). */
    get width(): number { return this.canvas?.width ?? 0 }
    /** Rendered pixel height (0 if font not yet loaded). */
    get height(): number { return this.canvas?.height ?? 0 }

    // ── Convenience ───────────────────────────────────────────────────────────

    /** Append the wrapper element to `parent` and return `this` for chaining. */
    appendTo(parent: HTMLElement): this {
        parent.appendChild(this.elem)
        return this
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private redraw(): void {
        const newCanvas = this.renderer.renderCanvas(this._text, this._color)
        if (this.canvas && this.canvas.parentNode === this.elem) {
            this.elem.replaceChild(newCanvas, this.canvas)
        } else {
            this.elem.appendChild(newCanvas)
        }
        this.canvas = newCanvas
    }
}
