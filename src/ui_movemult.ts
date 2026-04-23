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
// inventory drop. Renders using bignum sprites and up/down hold-to-repeat
// buttons matching the character screen skill buttons.

import { renderBignum } from './ui_font.js'
import { Obj } from './object.js'

const DIALOG_W = 259
const DIALOG_H = 162

export function uiGetAmount(item: Obj): Promise<number> {
    return new Promise((resolve) => {
        let currentValue = item.amount
        // Raw digit buffer for keyboard entry
        let keyBuffer = String(item.amount)

        const overlay = document.createElement('div')
        Object.assign(overlay.style, {
            position: 'absolute',
            left: '0', top: '0', width: '100%', height: '100%',
            zIndex: '50',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
        })

        const modal = document.createElement('div')
        Object.assign(modal.style, {
            position: 'relative',
            width: `${DIALOG_W}px`,
            height: `${DIALOG_H}px`,
            backgroundImage: "url('art/intrface/movemult.png')",
            backgroundSize: `${DIALOG_W}px ${DIALOG_H}px`,
            backgroundRepeat: 'no-repeat',
        })

        // Bignum display
        const bignumContainer = document.createElement('div')
        Object.assign(bignumContainer.style, {
            position: 'absolute',
            left: '148px',
            top: '18px',
        })

        function renderValue() {
            bignumContainer.innerHTML = ''
            bignumContainer.appendChild(renderBignum(currentValue, 5))
        }

        // Up button — increment with hold-to-repeat
        const upBtn = document.createElement('div')
        Object.assign(upBtn.style, {
            position: 'absolute',
            left: '228px',
            top: '18px',
            width: '15px',
            height: '14px',
            backgroundImage: "url('art/intrface/splsoff.png')",
            backgroundRepeat: 'no-repeat',
            cursor: 'pointer',
        })

        // Down button — decrement with hold-to-repeat
        const downBtn = document.createElement('div')
        Object.assign(downBtn.style, {
            position: 'absolute',
            left: '228px',
            top: '32px',
            width: '15px',
            height: '14px',
            backgroundImage: "url('art/intrface/snegoff.png')",
            backgroundRepeat: 'no-repeat',
            cursor: 'pointer',
        })

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

        wireButton(upBtn, 'art/intrface/splson.png', 'art/intrface/splsoff.png', true)
        wireButton(downBtn, 'art/intrface/snegon.png', 'art/intrface/snegoff.png', false)

        // DONE click region
        const doneBtn = document.createElement('div')
        Object.assign(doneBtn.style, {
            position: 'absolute',
            left: '10px',
            bottom: '8px',
            width: '90px',
            height: '20px',
            cursor: 'pointer',
        })

        // CANCEL click region
        const cancelBtn = document.createElement('div')
        Object.assign(cancelBtn.style, {
            position: 'absolute',
            left: '140px',
            bottom: '8px',
            width: '100px',
            height: '20px',
            cursor: 'pointer',
        })

        function cleanup(amount: number) {
            overlay.remove()
            window.removeEventListener('keydown', onKeyDown)
            resolve(amount)
        }

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

        doneBtn.onclick = () => cleanup(currentValue)
        cancelBtn.onclick = () => cleanup(0)

        modal.appendChild(bignumContainer)
        modal.appendChild(upBtn)
        modal.appendChild(downBtn)
        modal.appendChild(doneBtn)
        modal.appendChild(cancelBtn)
        overlay.appendChild(modal)

        document.getElementById('game-container')!.appendChild(overlay)

        renderValue()
    })
}
