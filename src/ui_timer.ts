// Timer-setting dialog for arming timed explosives (Dynamite, Plastic Explosive).
// Reference: fallout2-ce src/game/intface.cc — timer/bomb arming dialog
// Reuses the movemult.png frame, bignum drum counter (MM:SS with colon glyph),
// splsoff/snegoff +/− buttons, SmallButton for DONE/CANCEL.

import { Obj } from './object.js'
import { renderBignum, renderBignumColon, font3, makeFontLabel } from './ui_font.js'
import { SmallButton } from './ui_components.js'

/**
 * Show the bomb timer dialog.
 * Resolves with the chosen time in total seconds (1..5999), or null if cancelled.
 * Counter displays MM:SS — max 99:59.
 */
export function showTimerDialog(item: Obj): Promise<number | null> {
    return new Promise((resolve) => {
        let minutes = 0
        let seconds = 10

        const uiStage = document.getElementById('uiStage')
        if (!uiStage) { resolve(null); return }

        // Dialog container — reuses movemult.png frame
        const dialog = document.createElement('div')
        Object.assign(dialog.style, {
            position: 'absolute',
            left: '50%', top: '50%',
            marginLeft: '-130px', marginTop: '-81px',
            width: '259px',
            height: '162px',
            backgroundImage: "url('art/intrface/movemult.png')",
            backgroundRepeat: 'no-repeat',
            imageRendering: 'pixelated',
            zIndex: '200',
            outline: 'none',
        })
        dialog.tabIndex = 0

        // Item art preview
        const img = document.createElement('img')
        Object.assign(img.style, {
            position: 'absolute',
            left: '20px', top: '49px',
            width: '85px', height: '54px',
            objectFit: 'contain',
            imageRendering: 'pixelated',
        })
        img.src = item.invArt ? item.invArt + '.png' : ''
        img.setAttribute('draggable', 'false')
        img.onerror = () => { img.style.display = 'none' }
        dialog.appendChild(img)

        // MM:SS drum counter container
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
            const mmEl = renderBignum(minutes, 2, 'yellow')
            const colonEl = renderBignumColon('yellow')
            const ssEl = renderBignum(seconds, 2, 'yellow')
            drumContainer.appendChild(mmEl)
            drumContainer.appendChild(colonEl)
            drumContainer.appendChild(ssEl)
        }
        updateDrum()

        const incrementTime = () => {
            seconds++
            if (seconds > 59) {
                seconds = 0
                if (minutes < 99) minutes++
                else seconds = 59
            }
            updateDrum()
        }

        const decrementTime = () => {
            seconds--
            if (seconds < 0) {
                if (minutes > 0) { minutes--; seconds = 59 }
                else seconds = 0
            }
            updateDrum()
        }

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
        plusBtn.onmousedown = () => {
            plusBtn.style.backgroundImage = "url('art/intrface/splson.png')"
            incrementTime()
            plusRepeat = window.setInterval(incrementTime, 100)
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
        minusBtn.onmousedown = () => {
            minusBtn.style.backgroundImage = "url('art/intrface/snegon.png')"
            decrementTime()
            minusRepeat = window.setInterval(decrementTime, 100)
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
            uiStage.removeChild(dialog)
            resolve(value)
        }

        // DONE button (text baked into movemult.png)
        const doneBtn = new SmallButton(99, 129)
        doneBtn.onClick(() => {
            const totalSeconds = minutes * 60 + seconds
            close(totalSeconds > 0 ? totalSeconds : null)
        })
        dialog.appendChild(doneBtn.elem)

        // CANCEL button (text baked into movemult.png)
        const cancelBtn = new SmallButton(148, 129)
        cancelBtn.onClick(() => close(null))
        dialog.appendChild(cancelBtn.elem)

        // Keyboard: arrows to adjust, Enter to confirm, Escape to cancel
        dialog.addEventListener('keydown', (e: KeyboardEvent) => {
            switch (e.key) {
                case 'ArrowRight':
                case 'ArrowUp':
                    e.preventDefault()
                    incrementTime()
                    break
                case 'ArrowLeft':
                case 'ArrowDown':
                    e.preventDefault()
                    decrementTime()
                    break
                case 'Enter':
                    e.preventDefault()
                    doneBtn.elem.click()
                    break
                case 'Escape':
                    e.preventDefault()
                    close(null)
                    break
            }
        })

        uiStage.appendChild(dialog)
        dialog.focus()
    })
}
