// Fallout 2 "Move Items" quantity picker dialog (move_mult / inven_hold).
// Reference: fallout2-ce inventory.cc — inventoryQuantitySelect(), _draw_amount()
// Uses art/intrface/movemult.png (259×162) as the dialog background sprite,
// renderBignum() for the drum counter, splsoff/snegoff for +/−, SmallButton
// for DONE/CANCEL.

import { Obj } from './object.js'
import { renderBignum, font3, makeFontLabel } from './ui_font.js'
import { SmallButton, AllButton } from './ui_components.js'

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

        // Semi-transparent overlay to dim the game world
        const overlay = document.createElement('div')
        Object.assign(overlay.style, {
            position: 'absolute',
            left: '0', top: '0', width: '100%', height: '100%',
            background: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: '200',
        })
        overlay.tabIndex = 0

        // Dialog container — sprite background
        const dialog = document.createElement('div')
        Object.assign(dialog.style, {
            position: 'relative',
            width: '259px',
            height: '162px',
            backgroundImage: "url('art/intrface/movemult.png')",
            backgroundRepeat: 'no-repeat',
            imageRendering: 'pixelated',
        })

        // Item art preview
        const img = document.createElement('img')
        Object.assign(img.style, {
            position: 'absolute',
            left: '8px', top: '8px',
            width: '100px', height: '100px',
            objectFit: 'contain',
            imageRendering: 'pixelated',
        })
        img.src = item.invArt ? item.invArt + '.png' : ''
        img.setAttribute('draggable', 'false')
        img.onerror = () => { img.style.display = 'none' }
        dialog.appendChild(img)

        // Drum counter container — populated by renderBignum
        const drumContainer = document.createElement('div')
        Object.assign(drumContainer.style, {
            position: 'absolute',
            left: '107px', top: '39px',
            width: '106px', height: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
        })
        dialog.appendChild(drumContainer)

        const updateDrum = () => {
            drumContainer.innerHTML = ''
            drumContainer.appendChild(renderBignum(qty, 5, 'yellow'))
        }
        updateDrum()

        // [+] button — splsoff/splson sprites
        const plusBtn = document.createElement('div')
        Object.assign(plusBtn.style, {
            position: 'absolute',
            left: '200px', top: '46px',
            width: '22px', height: '12px',
            backgroundImage: "url('art/intrface/splsoff.png')",
            backgroundRepeat: 'no-repeat',
            cursor: 'pointer',
        })
        let plusRepeat: number | null = null
        const incrementQty = () => { if (qty < maxQty) { qty++; updateDrum() } }
        plusBtn.onmousedown = () => {
            plusBtn.style.backgroundImage = "url('art/intrface/splson.png')"
            incrementQty()
            plusRepeat = window.setInterval(incrementQty, 100)
        }
        plusBtn.onmouseup = () => {
            plusBtn.style.backgroundImage = "url('art/intrface/splsoff.png')"
            if (plusRepeat !== null) { clearInterval(plusRepeat); plusRepeat = null }
        }
        plusBtn.onmouseleave = () => {
            plusBtn.style.backgroundImage = "url('art/intrface/splsoff.png')"
            if (plusRepeat !== null) { clearInterval(plusRepeat); plusRepeat = null }
        }
        dialog.appendChild(plusBtn)

        // [−] button — snegoff/snegon sprites
        const minusBtn = document.createElement('div')
        Object.assign(minusBtn.style, {
            position: 'absolute',
            left: '200px', top: '57px',
            width: '22px', height: '12px',
            backgroundImage: "url('art/intrface/snegoff.png')",
            backgroundRepeat: 'no-repeat',
            cursor: 'pointer',
        })
        let minusRepeat: number | null = null
        const decrementQty = () => { if (qty > 1) { qty--; updateDrum() } }
        minusBtn.onmousedown = () => {
            minusBtn.style.backgroundImage = "url('art/intrface/snegon.png')"
            decrementQty()
            minusRepeat = window.setInterval(decrementQty, 100)
        }
        minusBtn.onmouseup = () => {
            minusBtn.style.backgroundImage = "url('art/intrface/snegoff.png')"
            if (minusRepeat !== null) { clearInterval(minusRepeat); minusRepeat = null }
        }
        minusBtn.onmouseleave = () => {
            minusBtn.style.backgroundImage = "url('art/intrface/snegoff.png')"
            if (minusRepeat !== null) { clearInterval(minusRepeat); minusRepeat = null }
        }
        dialog.appendChild(minusBtn)

        const close = (value: number | null) => {
            if (plusRepeat !== null) clearInterval(plusRepeat)
            if (minusRepeat !== null) clearInterval(minusRepeat)
            uiStage.removeChild(overlay)
            resolve(value)
        }

        // ALL button — below drum counter, sets qty to max
        const allBtn = new AllButton(107, 80)
        allBtn.onClick(() => { qty = maxQty; updateDrum() })
        dialog.appendChild(allBtn.elem)
        const allLabel = makeFontLabel(107 + 30, 80 + 8, 'ALL', font3)
        allLabel.css({ pointerEvents: 'none' })
        dialog.appendChild(allLabel.elem)

        // DONE button (text baked into movemult.png)
        const doneBtn = new SmallButton(99, 129)
        doneBtn.onClick(() => close(qty))
        dialog.appendChild(doneBtn.elem)

        // CANCEL button (text baked into movemult.png)
        const cancelBtn = new SmallButton(148, 129)
        cancelBtn.onClick(() => close(null))
        dialog.appendChild(cancelBtn.elem)

        // Keyboard: arrows to adjust, Enter to confirm, Escape to cancel
        overlay.addEventListener('keydown', (e: KeyboardEvent) => {
            switch (e.key) {
                case 'ArrowRight':
                case 'ArrowUp':
                    e.preventDefault()
                    incrementQty()
                    break
                case 'ArrowLeft':
                case 'ArrowDown':
                    e.preventDefault()
                    decrementQty()
                    break
                case 'Enter':
                    e.preventDefault()
                    close(qty)
                    break
                case 'Escape':
                    e.preventDefault()
                    close(null)
                    break
            }
        })

        overlay.appendChild(dialog)
        uiStage.appendChild(overlay)
        overlay.focus()
    })
}
