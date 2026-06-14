// CE-style confirmation/message dialogs.
//
// CE ref: dbox.cc showDialogBox() / dialogCreate() / dialogAddButton()
// Art (FRM IDs from art_intrface.json LST):
//   217 lgdialog.frm  → art/intrface/lgdialog.png  302×127  (DIALOG_TYPE_LARGE background)
//   218 medialog.frm  → art/intrface/medialog.png  215×113  (DIALOG_TYPE_MEDIUM background)
//   209 donebox.frm   → art/intrface/donebox.png   108×24   (button label panel)
//     8 lilredup.frm  → art/intrface/lilredup.png   15×16   (button normal)
//     9 lilreddn.frm  → art/intrface/lilreddn.png   15×16   (button pressed)
//
// CE layout constants (dbox.cc, DIALOG_TYPE_LARGE):
//   _ytable  = 27   — body text top y
//   _xtable  = 29   — body text left/right margin
//   _doneY   = 98   — button row top y
//   _doneX   = 37   — first button x (two-button layout)
//   donebox gap between buttons = 24px
//
// Keyboard: Enter or Y = first button (YES/OK), Escape or N = last button (NO/Cancel).
// UIMode.dialog is set while any dialog is open, blocking game key handlers.

import globalState from './globalState.js'
import { font1, font3, FoText } from './ui_font.js'
import { UIMode, getUiContainer } from './ui_panels.js'

// ── CE layout constants (dbox.cc DIALOG_TYPE_LARGE) ──────────────────────────

const DIALOG_W      = 302
const DIALOG_H      = 127
const TEXT_Y        = 27    // _ytable[LARGE]
const TEXT_X        = 29    // _xtable[LARGE]
const TEXT_W        = DIALOG_W - TEXT_X * 2  // 244px
const TEXT_H        = 71    // _doneY - _ytable = 98 - 27
const DONE_Y        = 98    // _doneY[LARGE]
const DONE_X        = 37    // _doneX[LARGE] — first button in two-button layout
const DONEBOX_W     = 108   // donebox.png width
const DONEBOX_H     = 24    // donebox.png height
const DONEBOX_GAP   = 24    // gap between two doneboxes
const LILRED_X      = 13    // lilred button local x inside donebox
const LILRED_Y      = 4     // lilred button local y inside donebox
const LABEL_X       = 35    // text label local x inside donebox
const LABEL_Y       = 3     // text label local y inside donebox

// ── Internal DOM builders ─────────────────────────────────────────────────────

function makeOverlay(): HTMLDivElement {
    const el = document.createElement('div')
    Object.assign(el.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '1000',
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    })
    return el
}

function makeDialogBox(): HTMLDivElement {
    const el = document.createElement('div')
    Object.assign(el.style, {
        position: 'relative',
        width: DIALOG_W + 'px',
        height: DIALOG_H + 'px',
        backgroundImage: "url('art/intrface/lgdialog.png')",
        backgroundSize: '100% 100%',
        imageRendering: 'pixelated',
        flexShrink: '0',
    })
    return el
}

function makeTextArea(message: string): HTMLDivElement {
    // CE ref: dbox.cc fontSetCurrent(101) — font1 for body text; centered horizontally.
    const el = document.createElement('div')
    Object.assign(el.style, {
        position: 'absolute',
        left: TEXT_X + 'px',
        top: TEXT_Y + 'px',
        width: TEXT_W + 'px',
        height: TEXT_H + 'px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '3px',
        overflow: 'hidden',
    })
    for (const line of message.split('\n')) {
        if (line.trim()) {
            new FoText(font1, line.toUpperCase(), '#c8b466').appendTo(el)
        }
    }
    return el
}

function makeDonebox(label: string, x: number): HTMLDivElement {
    // CE ref: dbox.cc — donebox blitted at (_doneX, _doneY), lilred at (+13,+4),
    // label text (font3) at (+35, +3). Pressing lilred plays _gsound_red_butt_press.
    const el = document.createElement('div')
    Object.assign(el.style, {
        position: 'absolute',
        left: x + 'px',
        top: DONE_Y + 'px',
        width: DONEBOX_W + 'px',
        height: DONEBOX_H + 'px',
        backgroundImage: "url('art/intrface/donebox.png')",
        backgroundSize: '100% 100%',
        imageRendering: 'pixelated',
        cursor: 'pointer',
    })

    const lilred = document.createElement('img')
    lilred.src = 'art/intrface/lilredup.png'
    Object.assign(lilred.style, {
        position: 'absolute',
        left: LILRED_X + 'px',
        top: LILRED_Y + 'px',
        width: '15px',
        height: '16px',
        imageRendering: 'pixelated',
        pointerEvents: 'none',
    })
    el.appendChild(lilred)

    // CE ref: fontSetCurrent(103) — font3 for button labels
    const labelWrap = document.createElement('div')
    Object.assign(labelWrap.style, {
        position: 'absolute',
        left: LABEL_X + 'px',
        top: LABEL_Y + 'px',
        pointerEvents: 'none',
        lineHeight: '0',
    })
    new FoText(font3, label, '#c8b466').appendTo(labelWrap)
    el.appendChild(labelWrap)

    // Button press animation: switch lilred down/up
    el.addEventListener('mousedown', () => { lilred.src = 'art/intrface/lilreddn.png' })
    el.addEventListener('mouseup',   () => { lilred.src = 'art/intrface/lilredup.png' })
    el.addEventListener('mouseleave',() => { lilred.src = 'art/intrface/lilredup.png' })

    return el
}

// ── showDialog ────────────────────────────────────────────────────────────────

/**
 * Show a modal CE-style dialog box and return the label of the button clicked.
 *
 * CE ref: dbox.cc showDialogBox() — DIALOG_TYPE_LARGE layout; font1 body, font3 buttons.
 * Keyboard: Enter/Y = buttons[0], Escape/N = buttons[last].
 */
export function showDialog(message: string, buttons: string[]): Promise<string> {
    return new Promise(resolve => {
        const prevMode = globalState.uiMode
        globalState.uiMode = UIMode.dialog

        const overlay = makeOverlay()
        const box = makeDialogBox()

        box.appendChild(makeTextArea(message))

        const close = (label: string): void => {
            document.removeEventListener('keydown', keyHandler, true)
            overlay.remove()
            globalState.uiMode = prevMode
            resolve(label)
        }

        // CE ref: dbox.cc button layout —
        //   single button: centred  x = (DIALOG_W - DONEBOX_W) / 2
        //   two buttons:   left = _doneX[LARGE]=37, right = left + DONEBOX_W + gap=24
        for (let i = 0; i < buttons.length; i++) {
            let bx: number
            if (buttons.length === 1) {
                bx = Math.floor((DIALOG_W - DONEBOX_W) / 2)
            } else {
                bx = DONE_X + i * (DONEBOX_W + DONEBOX_GAP)
            }
            const doneboxEl = makeDonebox(buttons[i], bx)
            doneboxEl.addEventListener('click', () => close(buttons[i]))
            box.appendChild(doneboxEl)
        }

        overlay.appendChild(box)

        // capture=true so this fires before any game key handlers
        const keyHandler = (e: KeyboardEvent): void => {
            if (e.key === 'Enter' || e.key.toLowerCase() === 'y') {
                e.preventDefault(); e.stopPropagation(); close(buttons[0])
            } else if (e.key === 'Escape' || e.key.toLowerCase() === 'n') {
                e.preventDefault(); e.stopPropagation(); close(buttons[buttons.length - 1])
            }
        }
        document.addEventListener('keydown', keyHandler, true)

        getUiContainer().appendChild(overlay)
    })
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

/** YES/NO confirm. Returns true if YES was chosen. CE ref: DIALOG_BOX_YES_NO flag. */
export async function showConfirm(message: string): Promise<boolean> {
    return (await showDialog(message, ['YES', 'NO'])) === 'YES'
}

/** Single OK acknowledgement. CE ref: DIALOG_BOX_LARGE flag with DONE button. */
export async function showAlert(message: string): Promise<void> {
    await showDialog(message, ['DONE'])
}

// ── showInput ─────────────────────────────────────────────────────────────────

/**
 * Show a modal text-input dialog using the CE lgdialog background.
 * Returns the entered string, or null if the user cancelled (Escape / CANCEL).
 * Used to replace window.prompt() for save-slot naming.
 */
export function showInput(message: string, defaultValue = ''): Promise<string | null> {
    return new Promise(resolve => {
        const prevMode = globalState.uiMode
        globalState.uiMode = UIMode.dialog

        const overlay = makeOverlay()
        const box = makeDialogBox()

        // Message text in the upper part of the text area
        const textEl = document.createElement('div')
        Object.assign(textEl.style, {
            position: 'absolute',
            left: TEXT_X + 'px',
            top: TEXT_Y + 'px',
            width: TEXT_W + 'px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
        })
        new FoText(font1, message.toUpperCase(), '#c8b466').appendTo(textEl)
        box.appendChild(textEl)

        // Input field in the middle of the text area
        const input = document.createElement('input')
        Object.assign(input.style, {
            position: 'absolute',
            left: TEXT_X + 'px',
            top: (TEXT_Y + 32) + 'px',
            width: TEXT_W + 'px',
            background: '#141008',
            border: '1px solid #a07848',
            color: '#c8b466',
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: '12px',
            padding: '2px 6px',
            outline: 'none',
            boxSizing: 'border-box',
        })
        input.value = defaultValue
        input.setAttribute('spellcheck', 'false')
        box.appendChild(input)

        const close = (value: string | null): void => {
            document.removeEventListener('keydown', keyHandler, true)
            overlay.remove()
            globalState.uiMode = prevMode
            resolve(value)
        }

        // OK button (centred when single) — but we have two, so use CE two-button layout
        const okBox = makeDonebox('OK', DONE_X)
        okBox.addEventListener('click', () => close(input.value))
        box.appendChild(okBox)

        const cancelBox = makeDonebox('CANCEL', DONE_X + DONEBOX_W + DONEBOX_GAP)
        cancelBox.addEventListener('click', () => close(null))
        box.appendChild(cancelBox)

        overlay.appendChild(box)

        const keyHandler = (e: KeyboardEvent): void => {
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(input.value) }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null) }
        }
        document.addEventListener('keydown', keyHandler, true)

        getUiContainer().appendChild(overlay)
        setTimeout(() => input.focus(), 20)
    })
}
