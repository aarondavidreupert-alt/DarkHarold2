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

// Cross-list transfer primitives shared between the barter screen and the
// loot screen. Split out of ui_barter.ts. See wiki/ts-split-refactor.md
// → "Per-file split proposals" §21.

import { Obj } from '../object.js'
import { $id } from '../ui_dom.js'

/**
 * Movemult.png slider modal — asks the player how many of `item` to move
 * when the stack has more than one. Resolves to 0 on cancel.
 */
export function uiGetAmount(item: Obj): Promise<number> {
    // Fallout 2 "Move Items" dialog using movemult.png as background
    // movemult.png is 169×60 in the original game
    const DIALOG_W = 169
    const DIALOG_H = 60

    return new Promise((resolve) => {
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
            fontFamily: "'VT323', monospace",
        })

        // Number display — centered near the top of the dialog
        const numDisplay = document.createElement('div')
        Object.assign(numDisplay.style, {
            position: 'absolute',
            left: '0', top: '5px', width: '100%',
            textAlign: 'center',
            color: '#00FF00',
            fontSize: '14px',
            pointerEvents: 'none',
        })
        numDisplay.textContent = String(item.amount)

        // Slider — positioned across the middle of the dialog
        const slider = document.createElement('input')
        slider.type = 'range'
        slider.min = '1'
        slider.max = String(item.amount)
        slider.value = String(item.amount)
        Object.assign(slider.style, {
            position: 'absolute',
            left: '12px', top: '22px',
            width: `${DIALOG_W - 24}px`,
            accentColor: '#00AA00',
            cursor: 'pointer',
        })
        slider.oninput = () => {
            numDisplay.textContent = slider.value
        }

        function cleanup(amount: number) {
            overlay.remove()
            resolve(amount)
        }

        // OK button — bottom left
        const okBtn = document.createElement('div')
        okBtn.textContent = 'OK'
        Object.assign(okBtn.style, {
            position: 'absolute',
            left: '20px', bottom: '4px',
            color: '#00FF00',
            fontSize: '12px',
            cursor: 'pointer',
            padding: '0 6px',
        })
        okBtn.onmouseenter = () => { okBtn.style.color = '#FCFC7C' }
        okBtn.onmouseleave = () => { okBtn.style.color = '#00FF00' }
        okBtn.onclick = () => {
            const val = parseInt(slider.value)
            if (isNaN(val) || val < 1 || val > item.amount) return
            cleanup(val)
        }

        // Cancel button — bottom right
        const cancelBtn = document.createElement('div')
        cancelBtn.textContent = 'Cancel'
        Object.assign(cancelBtn.style, {
            position: 'absolute',
            right: '20px', bottom: '4px',
            color: '#00FF00',
            fontSize: '12px',
            cursor: 'pointer',
            padding: '0 6px',
        })
        cancelBtn.onmouseenter = () => { cancelBtn.style.color = '#FF4444' }
        cancelBtn.onmouseleave = () => { cancelBtn.style.color = '#00FF00' }
        cancelBtn.onclick = () => cleanup(0)

        slider.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') okBtn.click()
            if (e.key === 'Escape') cancelBtn.click()
        }

        modal.appendChild(numDisplay)
        modal.appendChild(slider)
        modal.appendChild(okBtn)
        modal.appendChild(cancelBtn)
        overlay.appendChild(modal)
        $id('game-container').appendChild(overlay)
        slider.focus()
    })
}

function _uiAddItem(items: Obj[], item: Obj, count: number) {
    for (let i = 0; i < items.length; i++) {
        if (items[i].approxEq(item)) {
            items[i].amount += count
            return
        }
    }

    // no existing item, add new inventory object
    items.push(item.clone().setAmount(count))
}

export function uiSwapItem(a: Obj[], item: Obj, b: Obj[], amount: number) {
    // swap item from a -> b
    if (amount === 0) {
        return
    }

    let idx = -1
    for (let i = 0; i < a.length; i++) {
        if (a[i].approxEq(item)) {
            idx = i
            break
        }
    }
    if (idx === -1) {
        throw 'item (' + item + ') does not exist in a'
    }

    if (amount < item.amount) {
        // deduct amount from a and give amount to b
        item.amount -= amount
    }
    // just swap them
    else {
        a.splice(idx, 1)
    }

    // add the item to b
    _uiAddItem(b, item, amount)
}
