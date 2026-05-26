// Fallout 2 "Move Items" quantity picker dialog (move_mult / inven_hold).
// Reference: fallout2-ce inv.cc::inventoryQuantityDialog()

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

        const dialog = document.createElement('div')
        dialog.className = 'moveMultDialog'

        // Left panel: item art preview
        const artPanel = document.createElement('div')
        artPanel.className = 'moveMultArtPanel'
        const img = document.createElement('img')
        img.className = 'moveMultItemImg'
        img.src = item.invArt ? item.invArt + '.png' : ''
        img.setAttribute('draggable', 'false')
        img.onerror = () => { img.style.display = 'none' }
        artPanel.appendChild(img)

        // Right panel: counter + slider + buttons
        const rightPanel = document.createElement('div')
        rightPanel.className = 'moveMultRightPanel'

        // Counter row: drum display + [+] button
        const counterRow = document.createElement('div')
        counterRow.className = 'moveMultCounterRow'

        const drumDisplay = document.createElement('div')
        drumDisplay.className = 'moveMultDrum'
        const padLen = String(maxQty).length
        drumDisplay.textContent = String(qty).padStart(padLen, '0')

        const plusBtn = document.createElement('button')
        plusBtn.className = 'moveMultStepBtn'
        plusBtn.textContent = '+'

        counterRow.appendChild(drumDisplay)
        counterRow.appendChild(plusBtn)

        // Slider
        const slider = document.createElement('input')
        slider.type = 'range'
        slider.className = 'moveMultSlider'
        slider.min = '1'
        slider.max = String(maxQty)
        slider.value = String(qty)

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

        // Button row: DONE and CANCEL with decorative dots
        const btnRow = document.createElement('div')
        btnRow.className = 'moveMultBtnRow'

        const doneBtn = document.createElement('button')
        doneBtn.className = 'moveMultBtn'
        doneBtn.textContent = 'DONE'

        const cancelBtn = document.createElement('button')
        cancelBtn.className = 'moveMultBtn'
        cancelBtn.textContent = 'CANCEL'

        const close = (value: number | null) => {
            uiStage.removeChild(overlay)
            resolve(value)
        }

        doneBtn.addEventListener('click', () => close(qty))
        cancelBtn.addEventListener('click', () => close(null))

        // Keyboard support
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Enter') { e.preventDefault(); close(qty) }
            if (e.key === 'Escape') { e.preventDefault(); close(null) }
        }
        overlay.addEventListener('keydown', onKey)

        btnRow.appendChild(doneBtn)
        btnRow.appendChild(cancelBtn)

        rightPanel.appendChild(counterRow)
        rightPanel.appendChild(slider)
        rightPanel.appendChild(btnRow)

        dialog.appendChild(artPanel)
        dialog.appendChild(rightPanel)
        overlay.appendChild(dialog)
        uiStage.appendChild(overlay)
        slider.focus()
    })
}
