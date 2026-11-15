// A text field drawn straight onto a window's art, as CE does (loadsave.cc _get_input_str2 for
// the save description, character_editor.cc _get_input_str for the player's name): the text in
// a bitmap font, a blinking block cursor after it — fontGetStringWidth("_") - 4 wide,
// lineHeight - 2 tall, at the end of the text plus a space, toggled every 3 passes of a
// 24-a-second loop — and no box around it. Keys space .. 'z' add a character, Backspace /
// Delete take the last one off.
//
// The keys go to a real <input> laid invisibly over the text: it keeps the focus, paste and the
// game's "keys belong to a text field" rule (heart.ts isTypingTarget), and an Enter / Escape
// listener of the window around it works as with a visible field.

import { FontRenderer } from './fontCore.js'
import { FoText } from './foText.js'

const BLINK_MS = 3 * (1000 / 24) // CE: blinkCounter 3 at 24 passes a second

export class ScreenTextInput {
    /** The wrapper element (position: relative) — place it where the text starts. */
    readonly elem: HTMLElement
    /** The invisible field that takes the keys. */
    readonly input: HTMLInputElement
    private readonly text: FoText
    private readonly cursor: HTMLElement
    private readonly renderer: FontRenderer
    private blink: ReturnType<typeof setInterval> | null = null

    constructor(
        renderer: FontRenderer,
        opts: { value?: string; maxLength: number; color: string; width: number; height?: number },
    ) {
        this.renderer = renderer
        const height = opts.height ?? 14
        this.elem = document.createElement('div')
        Object.assign(this.elem.style, {
            position: 'relative',
            width: opts.width + 'px',
            height: height + 'px',
            whiteSpace: 'nowrap',
        })
        this.text = new FoText(renderer, '', opts.color)
        Object.assign(this.text.elem.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' })
        this.text.appendTo(this.elem)

        this.cursor = document.createElement('div')
        Object.assign(this.cursor.style, {
            position: 'absolute',
            top: '0',
            background: opts.color,
            pointerEvents: 'none',
        })
        this.elem.appendChild(this.cursor)

        this.input = document.createElement('input')
        Object.assign(this.input, { type: 'text', maxLength: opts.maxLength, value: opts.value ?? '' })
        this.input.setAttribute('spellcheck', 'false')
        this.input.setAttribute('autocomplete', 'off')
        Object.assign(this.input.style, {
            position: 'absolute',
            left: '0',
            top: '0',
            width: '100%',
            height: '100%',
            opacity: '0',
            border: 'none',
            padding: '0',
            margin: '0',
            background: 'transparent',
            caretColor: 'transparent',
            outline: 'none',
            cursor: 'text',
        })
        this.input.addEventListener('input', () => this.sync())
        // CE edits only at the end: keep the (unseen) caret there
        const toEnd = () => {
            const n = this.input.value.length
            if (this.input.selectionStart !== n || this.input.selectionEnd !== n) {
                this.input.setSelectionRange(n, n)
            }
        }
        this.input.addEventListener('keyup', toEnd)
        this.input.addEventListener('mouseup', toEnd)
        this.input.addEventListener('select', toEnd)
        this.elem.appendChild(this.input)

        renderer.onLoad(() => this.sync())
        this.blink = setInterval(() => {
            if (!this.elem.isConnected) {
                this.destroy()
                return
            }
            this.cursor.style.visibility = this.cursor.style.visibility === 'hidden' ? 'visible' : 'hidden'
        }, BLINK_MS)
    }

    get value(): string {
        return this.input.value
    }

    focus(): void {
        this.input.focus()
        const n = this.input.value.length
        this.input.setSelectionRange(n, n)
    }

    destroy(): void {
        if (this.blink !== null) {
            clearInterval(this.blink)
        }
        this.blink = null
    }

    // CE _get_input_str: KEY_FIRST_INPUT_CHARACTER .. KEY_LAST_INPUT_CHARACTER (space .. 'z')
    private sync(): void {
        const kept = this.input.value.replace(/[^\x20-\x7a]/g, '')
        if (kept !== this.input.value) {
            this.input.value = kept
        }
        this.text.text = kept
        if (!this.renderer.isLoaded()) {
            return
        }
        const cursorW = Math.max(1, this.renderer.measureText('_') - 4)
        this.cursor.style.width = cursorW + 'px'
        this.cursor.style.height = Math.max(1, this.renderer.lineHeight - 2) + 'px'
        this.cursor.style.left = this.renderer.measureText(kept + ' ') - cursorW + 'px'
    }
}
