// Timer-setting dialog for arming timed explosives (Dynamite, Plastic Explosive).
// Reuses the FO2 Move Items window visual language: dark panel, +/– arrows,
// odometer-style counter.  Appended to #uiStage so it participates in the
// 800×600 centered coordinate frame.

import { Obj } from './object.js'

const DYNAMITE_PID = 51
const PLASTIC_EXPLOSIVE_PID = 85

/** Show the timer dialog for an explosive item.
 *  Resolves with the chosen turn count, or null if the player cancels. */
export function showTimerDialog(item: Obj): Promise<number | null> {
    return new Promise((resolve) => {
        const isDynamite = item.pid === DYNAMITE_PID
        const maxTurns = isDynamite ? 10 : 15
        let turns = 1

        const uiStage = document.getElementById('uiStage')
        if (!uiStage) { resolve(null); return }

        // Backdrop dims the game world behind the dialog.
        const overlay = document.createElement('div')
        overlay.className = 'timerDialogOverlay'

        const dialog = document.createElement('div')
        dialog.className = 'timerDialog'

        const title = document.createElement('div')
        title.className = 'timerDialogTitle'
        title.textContent = isDynamite ? 'Arm Dynamite' : 'Arm Plastic Explosive'

        // Inventory art image (left side)
        const img = document.createElement('img')
        img.src = item.invArt + '.png'
        img.className = 'timerDialogItemImg'
        img.setAttribute('draggable', 'false')
        img.onerror = () => { img.style.display = 'none' }

        // Counter row: – [n] +
        const counterRow = document.createElement('div')
        counterRow.className = 'timerDialogCounterRow'

        const minusBtn = document.createElement('button')
        minusBtn.className = 'timerDialogBtn timerDialogStepBtn'
        minusBtn.textContent = '–'

        const counter = document.createElement('div')
        counter.className = 'timerDialogCounter'
        counter.textContent = String(turns)

        const plusBtn = document.createElement('button')
        plusBtn.className = 'timerDialogBtn timerDialogStepBtn'
        plusBtn.textContent = '+'

        minusBtn.addEventListener('click', () => {
            if (turns > 1) { turns--; counter.textContent = String(turns) }
        })
        plusBtn.addEventListener('click', () => {
            if (turns < maxTurns) { turns++; counter.textContent = String(turns) }
        })

        counterRow.appendChild(minusBtn)
        counterRow.appendChild(counter)
        counterRow.appendChild(plusBtn)

        // Action buttons
        const btnRow = document.createElement('div')
        btnRow.className = 'timerDialogBtnRow'

        const doneBtn = document.createElement('button')
        doneBtn.className = 'timerDialogBtn'
        doneBtn.textContent = 'DONE'

        const cancelBtn = document.createElement('button')
        cancelBtn.className = 'timerDialogBtn'
        cancelBtn.textContent = 'CANCEL'

        const close = (value: number | null) => {
            uiStage.removeChild(overlay)
            resolve(value)
        }

        doneBtn.addEventListener('click', () => close(turns))
        cancelBtn.addEventListener('click', () => close(null))

        btnRow.appendChild(doneBtn)
        btnRow.appendChild(cancelBtn)

        dialog.appendChild(title)
        dialog.appendChild(img)
        dialog.appendChild(counterRow)
        dialog.appendChild(btnRow)
        overlay.appendChild(dialog)
        uiStage.appendChild(overlay)
    })
}
