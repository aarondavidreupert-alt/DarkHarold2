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

// movemult.png quantity-selection dialog — shared by barter, loot, and
// inventory drop. Renders using bignum sprites, up/down hold-to-repeat
// buttons, and native FO2 font3 labels.

import { renderBignum, font3 } from './ui_font.js'
import { Obj } from './object.js'

const DIALOG_W = 259
const DIALOG_H = 162

export function uiGetAmount(item: Obj): Promise<number> {
    return new Promise((resolve) => {
        let currentValue = item.amount
        let keyBuffer = String(item.amount)

        // --- Full-screen flex overlay centered on #game-container ---
        const overlay = document.createElement('div')
        Object.assign(overlay.style, {
            position: 'absolute',
            left: '0', top: '0', width: '100%', height: '100%',
            zIndex: '50',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
        })

        // --- Modal: exact 259×162 movemult.png, no stretching ---
        const modal = document.createElement('div')
        Object.assign(modal.style, {
            position: 'relative',
            width: `${DIALOG_W}px`,
            height: `${DIALOG_H}px`,
            backgroundImage: "url('art/intrface/movemult.png')",
            backgroundSize: `${DIALOG_W}px ${DIALOG_H}px`,
            backgroundRepeat: 'no-repeat',
        })

        // --- Bignum display: left 125px, top 45px ---
        const bignumContainer = document.createElement('div')
        Object.assign(bignumContainer.style, {
            position: 'absolute',
            left: '125px',
            top: '45px',
            pointerEvents: 'none',
        })

        function renderValue() {
            bignumContainer.innerHTML = ''
            bignumContainer.appendChild(renderBignum(currentValue, 5))
        }

        // --- Hold-to-repeat button wiring ---
        function wireButton(btn: HTMLElement, onSprite: string, offSprite: string, inc: boolean) {
            let repeatTimer: number | null = null
            const stopRepeat = () => {
                if (repeatTimer !== null) { clearInterval(repeatTimer); repeatTimer = null }
                btn.style.backgroundImage = `url('${offSprite}')`
            }
            const fire = () => {
                currentValue = inc
                    ? Math.min(item.amount, currentValue + 1)
                    : Math.max(1, currentValue - 1)
                keyBuffer = String(currentValue)
                renderValue()
            }
            btn.onmousedown = () => {
                btn.style.backgroundImage = `url('${onSprite}')`
                fire()
                repeatTimer = window.setInterval(fire, 100)
            }
            btn.onmouseup = () => stopRepeat()
            btn.onmouseleave = () => stopRepeat()
        }

        // Plus button: left 200px, top 45px, 16×12px
        const upBtn = document.createElement('div')
        Object.assign(upBtn.style, {
            position: 'absolute',
            left: '200px',
            top: '45px',
            width: '16px',
            height: '12px',
            backgroundImage: "url('art/intrface/stplsoff.png')",
            backgroundRepeat: 'no-repeat',
            cursor: 'pointer',
        })
        wireButton(upBtn, 'art/intrface/stplson.png', 'art/intrface/stplsoff.png', true)

        // Minus button: left 201px, top 57px, 16×12px
        const downBtn = document.createElement('div')
        Object.assign(downBtn.style, {
            position: 'absolute',
            left: '201px',
            top: '57px',
            width: '16px',
            height: '12px',
            backgroundImage: "url('art/intrface/stnegoff.png')",
            backgroundRepeat: 'no-repeat',
            cursor: 'pointer',
        })
        wireButton(downBtn, 'art/intrface/stnegon.png', 'art/intrface/stnegoff.png', false)

        // --- Resolve / cleanup ---
        function cleanup(amount: number) {
            overlay.remove()
            window.removeEventListener('keydown', onKeyDown)
            resolve(amount)
        }

        // --- Helper: button with a font3 label centered inside ---
        function makeTextBtn(
            left: string,
            bottom: string,
            width: string,
            height: string,
            label: string,
            onClick: () => void
        ): HTMLElement {
            const btn = document.createElement('div')
            Object.assign(btn.style, {
                position: 'absolute',
                left,
                bottom,
                width,
                height,
                cursor: 'pointer',
                pointerEvents: 'auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            })
            const lbl = font3.renderText(label)
            lbl.style.pointerEvents = 'none'
            btn.appendChild(lbl)
            btn.onclick = onClick
            return btn
        }

        // DONE — left 10px, bottom 8px, 90×20px, resolves with currentValue
        const doneBtn = makeTextBtn('10px', '8px', '90px', '20px', 'DONE', () => cleanup(currentValue))

        // ALL — left 130px, bottom 8px, sets currentValue = item.amount without closing
        const allBtn = makeTextBtn('130px', '8px', '40px', '20px', 'ALL', () => {
            currentValue = item.amount
            keyBuffer = String(item.amount)
            renderValue()
        })

        // CANCEL — left 175px, bottom 8px, resolves with 0
        const cancelBtn = makeTextBtn('175px', '8px', '74px', '20px', 'CANCEL', () => cleanup(0))

        // --- Keyboard handler ---
        function onKeyDown(e: KeyboardEvent) {
            if (e.key >= '0' && e.key <= '9') {
                keyBuffer += e.key
                const parsed = parseInt(keyBuffer, 10)
                currentValue = Math.max(1, Math.min(item.amount, isNaN(parsed) ? 1 : parsed))
                renderValue()
                e.preventDefault()
                e.stopPropagation()
            } else if (e.key === 'Backspace') {
                keyBuffer = keyBuffer.slice(0, -1)
                const parsed = parseInt(keyBuffer, 10)
                currentValue = keyBuffer.length === 0 ? 1 : Math.max(1, Math.min(item.amount, isNaN(parsed) ? 1 : parsed))
                renderValue()
                e.preventDefault()
                e.stopPropagation()
            } else if (e.key === 'Enter') {
                cleanup(currentValue)
                e.preventDefault()
                e.stopPropagation()
            } else if (e.key === 'Escape') {
                cleanup(0)
                e.preventDefault()
                e.stopPropagation()
            }
        }

        window.addEventListener('keydown', onKeyDown)

        modal.appendChild(bignumContainer)
        modal.appendChild(upBtn)
        modal.appendChild(downBtn)
        modal.appendChild(doneBtn)
        modal.appendChild(allBtn)
        modal.appendChild(cancelBtn)
        overlay.appendChild(modal)

        document.getElementById('game-container')!.appendChild(overlay)

        renderValue()
    })
}
