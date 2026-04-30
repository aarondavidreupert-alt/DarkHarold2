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

// Main HUD bar: HP / AC / AP readouts, weapon display, combat-mode buttons,
// combat hover info, and the scrolling message log.

import globalState from './globalState.js'
import { Critter } from './object.js'
import { getActiveUnarmedMode } from './unarmed.js'

// --- DOM helpers (mirrors the ones in ui.ts) -------------------------------

function $id(id: string): HTMLElement {
    return document.getElementById(id)!
}

function $img(id: string): HTMLImageElement {
    return document.getElementById(id) as HTMLImageElement
}

function $q(selector: string): HTMLElement {
    return document.querySelector(selector) as HTMLElement
}

function clearEl($el: HTMLElement): void {
    $el.innerHTML = ''
}

function show($el: HTMLElement): void {
    $el.style.display = 'block'
}

function hide($el: HTMLElement): void {
    $el.style.display = 'none'
}

function showv($el: HTMLElement): void {
    $el.style.visibility = 'visible'
}

function hidev($el: HTMLElement): void {
    $el.style.visibility = 'hidden'
}

// --- Digit readouts (shared by HP / AC / called-shot chance) ---------------

export function drawDigits(idPrefix: string, amount: number, maxDigits: number, hasSign: boolean): void {
    const CHAR_W = 9,
        CHAR_NEG = 12
    const sign = amount < 0 ? CHAR_NEG : 0
    if (amount < 0) {
        amount = -amount
    }
    const digits = amount.toString()
    const firstDigitIdx = hasSign ? 2 : 1
    if (hasSign) {
        $q(idPrefix + '1').style.backgroundPosition = 0 - CHAR_W * sign + 'px'
    } // sign
    for (
        let i = firstDigitIdx;
        i <= maxDigits - digits.length;
        i++ // left-fill with zeroes
    ) {
        $q(idPrefix + i).style.backgroundPosition = '0px'
    }
    for (let i = 0; i < digits.length; i++) {
        const idx = digits.length - 1 - i
        let digit
        if (digits[idx] === '-') {
            digit = 12
        } else {
            digit = parseInt(digits[idx])
        }
        $q(idPrefix + (maxDigits - i)).style.backgroundPosition = 0 - CHAR_W * digit + 'px'
    }
}

export function drawHP(hp: number): void {
    drawDigits('#hpDigit', hp, 4, true)
}

export function drawAC(ac: number): void {
    drawDigits('#acDigit', ac, 4, true)
}

export function drawAP(current: number, max: number, freeMove: number = 0, isPlayerTurn: boolean = true): void {
    for (let i = 0; i < 10; i++) {
        const el = document.getElementById('apLight' + (i + 1)) as HTMLImageElement | null
        if (!el) continue
        let src: string | null = null
        if (!isPlayerTurn) {
            src = 'art/intrfce/hlred.png'
        } else if (i < current) {
            src = 'art/intrfce/hlgrn.png'
        } else if (i < current + freeMove) {
            src = 'art/intrfce/hlyel.png'
        }
        if (src) {
            el.src = src
            el.style.visibility = 'visible'
        } else {
            el.style.visibility = 'hidden'
        }
    }
}

// --- Scrolling log ---------------------------------------------------------

export function uiLog(msg: string): void {
    const $log = $id('displayLog')
    $log.insertAdjacentHTML('beforeend', `<li>${msg}</li>`)
    $log.scrollTop = $log.scrollHeight
}

// --- Weapon bar ------------------------------------------------------------

export function uiDrawWeapon(): void {
    // draw the active weapon in the interface bar
    const weapon = globalState.player!.equippedWeapon
    clearEl($id('attackButton'))
    const $wepImg = $id('attackButtonWeapon') as HTMLImageElement
    const $typeImg = $img('attackButtonType')
    if (!weapon || !weapon.weapon) {
        // Unarmed HUD: show current punch/kick mode icon and AP cost
        const unarmedSkill = globalState.player!.getSkill('Unarmed')
        const mode = getActiveUnarmedMode(unarmedSkill, globalState.unarmedModeIdx)
        $wepImg.style.display = 'none'
        $typeImg.style.display = ''
        $img('attackButtonType').src = `art/intrface/${mode.icon}.png`
        const CHAR_W = 10
        if (mode.apCost <= 9) {
            $id('attackButtonAPDigit').style.backgroundPosition = 0 - CHAR_W * mode.apCost + 'px'
        }
        hide($id('attackButtonCalled'))
        return
    }
    $wepImg.style.display = ''
    $typeImg.style.display = ''

    if (weapon.weapon.type !== 'melee') {
        $wepImg.onload = null
        $wepImg.onload = function (this: HTMLImageElement) {
            if (!this.complete) {
                return
            }
            Object.assign(this.style, {
                position: 'absolute',
                top: '5px',
                left: $id('attackButton').offsetWidth / 2 - this.width / 2 + 'px',
                maxHeight: $id('attackButton').offsetHeight - 10 + 'px',
                display: '',
            })
            this.setAttribute('draggable', 'false')
        }
        $wepImg.src = weapon.invArt + '.png'
    }

    // draw weapon AP cost digit
    // reload=2, called=APCost1+1 (aiming surcharge), burst=APCost2, otherwise APCost1
    const CHAR_W = 10
    let digit: number
    const mode = weapon.weapon.mode
    if (mode === 'reload') {
        digit = 2 // TODO: read reload AP from weapon PRO
    } else if (mode === 'called') {
        digit = weapon.weapon.getAPCost(1) + 1 // base weapon cost + 1 for aiming (FO2: weaponGetActionPointCost)
    } else if (weapon.weapon.isBurst && weapon.weapon.isBurst()) {
        digit = weapon.weapon.getAPCost(2)
    } else {
        digit = weapon.weapon.getAPCost(1)
    }
    if (digit === undefined || digit > 9) {
        return
    } // TODO: Weapon AP >9?
    $id('attackButtonAPDigit').style.backgroundPosition = 0 - CHAR_W * digit + 'px'

    // draw weapon type (single, burst, called, punch, reload, ...)
    // TODO: all melee weapons
    let type: string
    if (weapon.weapon.type === 'melee') {
        type = 'punch'
    } else if (mode === 'reload') {
        type = 'reload'
    } else if (weapon.weapon.isBurst && weapon.weapon.isBurst()) {
        type = 'burst'
    } else {
        type = 'single'
    }
    $img('attackButtonType').src = `art/intrface/${type}.png`

    // hide or show called shot sigil?
    if (mode === 'called') {
        show($id('attackButtonCalled'))
    } else {
        hide($id('attackButtonCalled'))
    }
}

// --- Combat bar ------------------------------------------------------------

export function uiStartCombat(): void {
    globalState.cursorMode = 'attack'
    // play end container animation
    Object.assign($id('endContainer').style, { animationPlayState: 'running', webkitAnimationPlayState: 'running' })
    uiUpdateCombatAP()

    const player = globalState.player!
    drawHP(player.getStat('HP'))
    drawAC(player.getStat('AC'))
    drawAP(player.AP!.getAvailableMoveAP(), player.AP!.getTotalMaxAP())
}

export function uiEndCombat(): void {
    // play end container animation
    Object.assign($id('endContainer').style, { animationPlayState: 'running', webkitAnimationPlayState: 'running' })

    // disable buttons
    hidev($id('endTurnButton'))
    hidev($id('endCombatButton'))
    // reset cursor back to move mode
    globalState.cursorMode = 'move'

    // reset AP dots to off
    for (let i = 1; i <= 10; i++) {
        const el = document.getElementById('apLight' + i)
        if (el) (el as HTMLElement).style.visibility = 'hidden'
    }

    // hide combat-specific UI
    const $ap = document.getElementById('combatAPDisplay')
    if ($ap) $ap.style.display = 'none'
    const $hover = document.getElementById('combatHoverInfo')
    if ($hover) $hover.style.display = 'none'
}

export function uiUpdateCombatAP(): void {
    const $ap = document.getElementById('combatAPDisplay')
    if (!$ap) return
    if (!globalState.inCombat || !globalState.player!.AP) {
        $ap.style.display = 'none'
        return
    }
    const ap = globalState.player!.AP
    $ap.style.display = 'block'
    $ap.textContent = `AP: ${ap.getAvailableCombatAP()} / ${ap.getTotalMaxAP()}`
}

export function uiShowCombatHover(target: Critter, screenX: number, screenY: number): void {
    const $hover = document.getElementById('combatHoverInfo')
    if (!$hover) return

    let info = `${target.name || 'Unknown'}\nHP: ${target.getStat('HP')}/${target.getStat('Max HP')}`

    if (globalState.inCombat && globalState.combat && globalState.player!.equippedWeapon?.weapon) {
        const hitChance = globalState.combat.getHitChance(globalState.player!, target, 'torso')
        info += `\nHit: ${Math.max(0, hitChance.hit)}%`
    }

    $hover.style.display = 'block'
    $hover.style.left = (screenX + 16) + 'px'
    $hover.style.top = (screenY - 10) + 'px'
    $hover.textContent = info
    $hover.style.whiteSpace = 'pre'
}

export function uiHideCombatHover(): void {
    const $hover = document.getElementById('combatHoverInfo')
    if ($hover) $hover.style.display = 'none'
}

export function uiEndCombatAnimationDone(this: HTMLElement): void {
    Object.assign(this.style, { animationPlayState: 'paused', webkitAnimationPlayState: 'paused' })

    if (globalState.inCombat) {
        // enable buttons
        showv($id('endTurnButton'))
        showv($id('endCombatButton'))
    }
}
