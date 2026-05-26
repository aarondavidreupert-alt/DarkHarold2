// Fallout 2 "Move Items" quantity picker dialog (move_mult / inven_hold).
// Reference: fallout2-ce inv.cc::inventoryQuantityDialog()
// Uses art/intrface/movemult.png (259×162) as the dialog background sprite.

import { Obj } from './object.js'

/**
 * Show the canonical FO2 quantity picker.
 * Resolves with the chosen quantity (1..maxQty), or null if cancelled.
 * If maxQty === 1, skips the dialog and returns 1 immediately.
 */
export function showMoveMultDialog(item: Obj, maxQty: number): Promise<number | null> {
    if (maxQty <= 1) return Promise.resolve(1)

    return new Promise((resolve) => {
        let qty = maxQty

        const uiStage = document.getElementById('uiStage')
        if (!uiStage) { resolve(null); return }

        const overlay = document.createElement('div')
        overlay.className = 'moveMultOverlay'

        // Dialog container — sized exactly to the sprite
        const dialog = document.createElement('div')
        dialog.className = 'moveMultDialog'

        // Item art preview — positioned over the left region of the sprite
        const img = document.createElement('img')
        img.className = 'moveMultItemImg'
        img.src = item.invArt ? item.invArt + '.png' : ''
        img.setAttribute('draggable', 'false')
        img.onerror = () => { img.style.display = 'none' }
        dialog.appendChild(img)

        // Drum counter display — over the top-right region
        const padLen = String(maxQty).length
        const drumDisplay = document.createElement('div')
        drumDisplay.className = 'moveMultDrum'
        drumDisplay.textContent = String(qty).padStart(padLen, '0')
        dialog.appendChild(drumDisplay)

        // [+] increment button — right edge of counter area
        const plusBtn = document.createElement('button')
        plusBtn.className = 'moveMultStepBtn'
        plusBtn.textContent = '+'
        dialog.appendChild(plusBtn)

        // Slider — below the counter
        const slider = document.createElement('input')
        slider.type = 'range'
        slider.className = 'moveMultSlider'
        slider.min = '1'
        slider.max = String(maxQty)
        slider.value = String(qty)
        dialog.appendChild(slider)

        const updateDisplay = () => {
            drumDisplay.textContent = String(qty).padStart(padLen, '0')
            slider.value = String(qty)
        }

        slider.oninput = () => {
            qty = parseInt(slider.value)
            drumDisplay.textContent = String(qty).padStart(padLen, '0')
        }

        plusBtn.addEventListener('click', () => {
            if (qty < maxQty) { qty++; updateDisplay() }
        })

        // DONE button — bottom-left of sprite
        const doneBtn = document.createElement('button')
        doneBtn.className = 'moveMultBtn moveMultBtnDone'
        doneBtn.textContent = 'DONE'
        dialog.appendChild(doneBtn)

        // CANCEL button — bottom-right of sprite
        const cancelBtn = document.createElement('button')
        cancelBtn.className = 'moveMultBtn moveMultBtnCancel'
        cancelBtn.textContent = 'CANCEL'
        dialog.appendChild(cancelBtn)

        const close = (value: number | null) => {
            uiStage.removeChild(overlay)
            resolve(value)
        }

        doneBtn.addEventListener('click', () => close(qty))
        cancelBtn.addEventListener('click', () => close(null))

        overlay.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') { e.preventDefault(); close(qty) }
            if (e.key === 'Escape') { e.preventDefault(); close(null) }
        })

        overlay.appendChild(dialog)
        uiStage.appendChild(overlay)
        slider.focus()
    })
}
