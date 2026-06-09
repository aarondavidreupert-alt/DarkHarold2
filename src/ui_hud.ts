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
import { Critter, WeaponObj } from './object.js'
import { getActivePunchMode, getActiveKickMode } from './unarmed.js'
import { $id, $img, $q, clearEl, show, hide, showv, hidev } from './ui_dom.js'

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
    updateIndicatorBar()
}

export function drawAC(ac: number): void {
    drawDigits('#acDigit', ac, 4, true)
}

export function drawAP(current: number, max: number, freeMove: number = 0, isPlayerTurn: boolean = true): void {
    // CE ref: interface.cc interfaceRenderActionPoints animates point changes
    // per-frame; when AP drops we briefly flash the deactivated lights before
    // hiding them, so the player sees which slots are being spent.
    const apply = (i: number, src: string | null) => {
        const el = document.getElementById('apLight' + (i + 1)) as HTMLImageElement | null
        if (!el) return
        if (src) {
            el.src = src
            el.style.visibility = 'visible'
            el.style.transition = 'opacity 120ms ease'
            el.style.opacity = '1'
        } else {
            el.style.transition = 'opacity 120ms ease'
            el.style.opacity = '0'
            // Hide after the fade-out completes so click hit-tests stay clean.
            setTimeout(() => { if (el.style.opacity === '0') el.style.visibility = 'hidden' }, 130)
        }
    }
    for (let i = 0; i < 10; i++) {
        let src: string | null = null
        if (!isPlayerTurn) {
            src = 'art/intrface/hlred.png'
        } else if (i < current) {
            src = 'art/intrface/hlgrn.png'
        } else if (i < current + freeMove) {
            src = 'art/intrface/hlyel.png'
        }
        apply(i, src)
    }
    updateAttackButtonAvailability(current + freeMove, isPlayerTurn)
    updateIndicatorBar()
}

// CE ref: interface.cc indicatorBarInit / indicatorBarRefresh — renders up to
// 6 status badges (ADDICT, SNEAK, LEVEL, POISONED, RADIATED, etc.) above the
// HUD. DH2 renders a compact textual indicator strip — created lazily and
// updated on each AP redraw and at end of turn.
let indicatorBarEl: HTMLElement | null = null
export function updateIndicatorBar(): void {
    const player = globalState.player
    if (!player) return
    if (!indicatorBarEl) {
        const bar = document.getElementById('bar')
        if (!bar) return
        indicatorBarEl = document.createElement('div')
        indicatorBarEl.id = 'indicatorBar'
        Object.assign(indicatorBarEl.style, {
            position: 'absolute', left: '0', right: '0',
            // Pin just above the HUD bar; bar's top is set by layout, so we
            // anchor to the bar element via a translate trick by parenting to
            // game-container and matching bar's left edge.
            bottom: (bar.offsetHeight + 4) + 'px',
            display: 'flex', justifyContent: 'center', gap: '6px',
            pointerEvents: 'none',
            fontFamily: 'monospace', fontSize: '10px', color: '#0F0',
            textShadow: '1px 1px 0 #000', zIndex: '15',
        })
        bar.parentElement?.appendChild(indicatorBarEl)
    }
    const indicators: string[] = []
    if ((player as any).isSneaking) indicators.push('SNEAK')
    const poison = (player as any).poisonLevel ?? 0
    if (poison > 0) indicators.push('POISONED')
    const rads = (player as any).radiationLevel ?? 0
    if (rads >= 150) indicators.push('RADIATED')
    const addicts: string[] = (player as any).addictions ?? []
    if (addicts.length > 0) indicators.push('ADDICT')
    indicatorBarEl.innerHTML = indicators.map(t =>
        `<span style="background:rgba(0,0,0,0.7); padding:1px 6px; border:1px solid #0F0;">${t}</span>`
    ).join('')
    indicatorBarEl.style.visibility = indicators.length > 0 ? 'visible' : 'hidden'
}

// Dim the attack button when the player can't afford the current weapon mode's
// AP cost (or when it isn't the player's turn). CE ref: interface.cc
// interfaceRenderActionPoints — attack-button colour follows AP availability.
function updateAttackButtonAvailability(availableAP: number, isPlayerTurn: boolean): void {
    const $btn = document.getElementById('attackButton') as HTMLElement | null
    if (!$btn) return
    const weapon = globalState.player?.equippedWeapon
    let cost = 0
    if (weapon && weapon.weapon) {
        const mode = (weapon.weapon as any).mode
        if (mode === 'reload') cost = (weapon.weapon as any).getReloadAPCost?.() ?? 2
        else if (mode === 'called') cost = (weapon.weapon as any).getAPCost(1) + 1
        else if (weapon.weapon.isBurst?.()) cost = (weapon.weapon as any).getAPCost(2)
        else cost = (weapon.weapon as any).getAPCost(1)
    } else {
        cost = 3 // unarmed default
    }
    const affordable = isPlayerTurn && availableAP >= cost
    $btn.style.opacity = affordable ? '1' : '0.4'
    $btn.style.filter = affordable ? '' : 'grayscale(80%)'
}

// --- Scrolling log ---------------------------------------------------------

const LOG_LINE_HEIGHT = 13 // approx px per line for 8pt font

export function uiLog(msg: string): void {
    const $log = $id('displayLog')
    $log.insertAdjacentHTML('beforeend', `<li>${msg}</li>`)
    $log.scrollTop = $log.scrollHeight
}

export function initLogScrollZones(): void {
    const log = document.getElementById('displayLog')
    const up = document.getElementById('logScrollUp')
    const down = document.getElementById('logScrollDown')
    if (!log || !up || !down) return
    up.addEventListener('click', () => { log.scrollTop -= LOG_LINE_HEIGHT })
    down.addEventListener('click', () => { log.scrollTop += LOG_LINE_HEIGHT })
}

// --- Weapon bar ------------------------------------------------------------

export function uiDrawWeapon(): void {
    // draw the active weapon in the interface bar
    const weapon = globalState.player!.equippedWeapon
    clearEl($id('attackButton'))
    const $wepImg = $id('attackButtonWeapon') as HTMLImageElement
    const $typeImg = $img('attackButtonType')
    if (!weapon || !weapon.weapon) {
        // Unarmed HUD: left hand → punch family, right hand → kick family (both empty only)
        const player = globalState.player!
        const unarmedSkill = player.getSkill('Unarmed')
        const activeHand: 'leftHand' | 'rightHand' = (player as any).activeHand ?? 'leftHand'
        const leftWeapon = (player as any).leftHand?.weapon ?? null
        const rightWeapon = (player as any).rightHand?.weapon ?? null
        const bothHandsEmpty = !leftWeapon && !rightWeapon
        const mode = activeHand === 'rightHand' && bothHandsEmpty
            ? getActiveKickMode(unarmedSkill, globalState.kickModeIdx)
            : getActivePunchMode(unarmedSkill, globalState.punchModeIdx)
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
    // reload=CE item.cc:1640, called=APCost1+1 (aiming surcharge), burst=APCost2, otherwise APCost1
    const CHAR_W = 10
    let digit: number
    const mode = weapon.weapon.mode
    if (mode === 'reload') {
        digit = weapon.weapon.getReloadAPCost() // CE ref: item.cc:1640
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

    uiUpdateAmmoBar(weapon)
}

export function uiUpdateAmmoBar(weapon: WeaponObj | null): void {
    const fill = document.getElementById('ammoBarFill')
    if (!fill) return
    let ratio = 0
    const extra = (weapon as any)?.pro?.extra
    if (extra?.maxAmmo > 0) {
        ratio = Math.floor(((extra.rounds ?? 0) / extra.maxAmmo) * 55)
    } else if (extra?.maxCharges > 0) {
        ratio = Math.floor(((extra.charges ?? 0) / extra.maxCharges) * 55)
    }
    fill.style.width = Math.max(0, Math.min(55, ratio)) + 'px'
}

// --- Combat bar ------------------------------------------------------------

export function uiStartCombat(): void {
    globalState.cursorMode = 'attack'
    // play end container animation
    Object.assign($id('endContainer').style, { animationPlayState: 'running', webkitAnimationPlayState: 'running' })
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
    const $hover = document.getElementById('combatHoverInfo')
    if ($hover) $hover.style.display = 'none'
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
