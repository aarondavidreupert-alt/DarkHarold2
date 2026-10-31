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

// CE character_editor.cc characterEditorShowOptions (creation mode): the OPTIONS window —
// SAVE / LOAD / PRINT TO FILE / ERASE / DONE (editor.msg 600-604) on opbase.frm. CE keeps
// premade characters as .GCD files in the game folder; the browser keeps them in localStorage.

import { services } from '../state/services.js'
import { Widget } from '../uiWidget.js'
import { CE_COLOR, font1, font3, FoText } from '../uiFont.js'
import { getMessage } from '../util.js'
import { showAlert, showConfirm, showInput } from '../uiDialog.js'
import { assetUrl } from '../modAssets.js'
import { printCharacterSheet } from './printSheet.js'
import type { CreatorInitialState } from './creator.js'

const msg = (id: number, fallback: string) => getMessage('editor', id) ?? fallback
const STORE_KEY = 'dh2.premadeCharacters'

function readStore(): { [name: string]: CreatorInitialState } {
    try {
        return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') ?? {}
    } catch {
        return {}
    }
}
function writeStore(store: { [name: string]: CreatorInitialState }): boolean {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(store))
        return true
    } catch {
        return false
    }
}

export interface CreatorOptionsContext {
    snapshot(): CreatorInitialState
    reopen(state: CreatorInitialState): void
    printable(): any // a player-like view of the character being made (printSheet)
}

// CE BLANK.GCD (editor.msg 618): every SPECIAL 5, no traits or tags, 5 points
export const BLANK_CHARACTER: CreatorInitialState = {
    name: 'None',
    special: { STR: 5, PER: 5, END: 5, CHA: 5, INT: 5, AGI: 5, LUK: 5 },
    age: 25,
    sex: 'Male',
    tagged: [],
    traits: [],
    characterPoints: 5,
}

// the large button sound (CE _gsound_lrg_butt_press)
function playButtonSound(): void {
    services.audioEngine?.playSfxByName?.('ib1p1xx1')
}

export function showCreatorOptions(parent: HTMLElement, ctx: CreatorOptionsContext): void {
    const W = 164,
        H = 217,
        BTN_W = 137,
        BTN_H = 34
    // CE: 238, 90 in the 640×480 editor window
    const panel = document.createElement('div')
    Object.assign(panel.style, {
        position: 'absolute',
        left: '238px',
        top: '90px',
        width: W + 'px',
        height: H + 'px',
        zIndex: '30',
        backgroundImage: `url('${assetUrl('art/intrface/opbase.png')}')`,
        backgroundRepeat: 'no-repeat',
    })
    const blocker = document.createElement('div') // WINDOW_MODAL
    Object.assign(blocker.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '640px',
        height: '480px',
        zIndex: '29',
    })
    parent.appendChild(blocker)
    parent.appendChild(panel)

    let busy = false
    const close = () => {
        document.removeEventListener('keydown', onKey, true)
        panel.remove()
        blocker.remove()
    }
    const guard = (fn: () => Promise<void>) => async () => {
        if (busy) return
        busy = true
        try {
            await fn()
        } finally {
            busy = false
        }
    }

    const save = guard(async () => {
        const raw = await showInput(msg(600, 'SAVE'), msg(617, 'PLAYER'))
        if (raw === null) return
        const name =
            raw
                .trim()
                .toUpperCase()
                .replace(/\.GCD$/, '') || msg(617, 'PLAYER')
        const store = readStore()
        if (
            store[name] &&
            !(await showConfirm(
                `"${name}.GCD" ${msg(609, 'already exists.')}\n${msg(610, 'Do you wish to overwrite?')}`,
            ))
        )
            return
        store[name] = ctx.snapshot()
        if (writeStore(store)) await showAlert(`${name}.GCD${msg(607, ' was successfully saved.')}`)
        else await showAlert(`${msg(611, 'Error saving ')}${name}.GCD`)
    })
    const load = guard(async () => {
        const store = readStore()
        const names = Object.keys(store).sort()
        if (names.length === 0) {
            await showAlert(msg(615, 'Error reading file list!'))
            return
        }
        const picked = await pickName(parent, msg(601, 'LOAD'), names)
        if (!picked) return
        close()
        ctx.reopen(store[picked])
    })
    const print = guard(async () => {
        printCharacterSheet(ctx.printable())
    })
    const erase = guard(async () => {
        if (
            !(await showConfirm(`${msg(605, 'Are you sure you want to erase')}\n${msg(606, 'the current character?')}`))
        )
            return
        close()
        ctx.reopen(BLANK_CHARACTER)
    })
    const handlers = [
        save,
        load,
        print,
        erase,
        async () => {
            close()
        },
    ]
    const fallback = ['SAVE', 'LOAD', 'PRINT TO FILE', 'ERASE', 'DONE']

    handlers.forEach((handler, i) => {
        const btn = new Widget('art/intrface/opbtnoff.png', { x: 13, y: 17 + i * (BTN_H + 3), w: BTN_W, h: BTN_H })
            .mouseDownBG('art/intrface/opbtnon.png')
            .css({ cursor: 'pointer' })
            .onClick(() => {
                playButtonSound()
                void handler()
            })
        const text = msg(600 + i, fallback[i])
        const label = new FoText(font3, text, CE_COLOR.label)
        font3.onLoad(() => {
            Object.assign(label.elem.style, {
                position: 'absolute',
                pointerEvents: 'none',
                left: Math.max(0, Math.trunc((BTN_W - font3.measureText(text)) / 2)) + 'px',
                top: '7px',
            })
            btn.elem.appendChild(label.elem)
        })
        panel.appendChild(btn.elem)
    })

    // CE keys: S save, L load, P print, E erase, Return / D / Esc done
    const onKey = (e: KeyboardEvent) => {
        if (busy) return
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
        const i = ({ s: 0, l: 1, p: 2, e: 3, d: 4, Enter: 4, Escape: 4 } as { [k: string]: number })[k]
        if (i === undefined) return
        e.preventDefault()
        e.stopPropagation()
        void handlers[i]()
    }
    document.addEventListener('keydown', onKey, true)
}

// CE's file list for LOAD: the saved names, one per line; a click picks, Esc cancels
function pickName(parent: HTMLElement, title: string, names: string[]): Promise<string | null> {
    return new Promise((resolve) => {
        const box = document.createElement('div')
        Object.assign(box.style, {
            position: 'absolute',
            left: '170px',
            top: '100px',
            width: '300px',
            maxHeight: '260px',
            overflowY: 'auto',
            background: '#000',
            border: '2px solid #4a4a2a',
            padding: '8px',
            zIndex: '40',
        })
        const finish = (v: string | null) => {
            document.removeEventListener('keydown', esc, true)
            box.remove()
            resolve(v)
        }
        const esc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                finish(null)
            }
        }
        document.addEventListener('keydown', esc, true)
        const head = document.createElement('div')
        new FoText(font1, title, '#fcfc7c').appendTo(head)
        box.appendChild(head)
        for (const name of names) {
            const row = document.createElement('div')
            Object.assign(row.style, { cursor: 'pointer', padding: '2px 0' })
            const t = new FoText(font1, name + '.GCD', '#00f800')
            t.appendTo(row)
            row.onmouseenter = () => {
                t.color = '#fcfc7c'
            }
            row.onmouseleave = () => {
                t.color = '#00f800'
            }
            row.onclick = () => finish(name)
            box.appendChild(row)
        }
        parent.appendChild(box)
    })
}
