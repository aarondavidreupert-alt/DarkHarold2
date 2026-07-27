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
import { Critter, Obj, WeaponObj, objectIsWeapon } from './object.js'
import { getActivePunchMode, getActiveKickMode } from './unarmed.js'
import { $id, $img, $q, clearEl, show, hide, showv, hidev } from './ui_dom.js'
import { font1 } from './ui_font.js'

// --- Digit readouts (shared by HP / AC / called-shot chance) ---------------

// CE ref: numbers.frm is a single 360×17 sprite with three horizontal colour bands:
//   offset   0 = white/grey  (HP ≥ 50% maxHp)
//   offset 120 = yellow      (25% ≤ HP < 50%)
//   offset 240 = red         (HP < 25%)
// 9 px per character; chars 0-9 then down-tick, up-tick, minus, plus.
const NUM_COLOR_WHITE  = 0
const NUM_COLOR_YELLOW = 120
const NUM_COLOR_RED    = 240

export function drawDigits(idPrefix: string, amount: number, maxDigits: number, hasSign: boolean, colorOffset = 0): void {
    const CHAR_W = 9, CHAR_NEG = 12
    const sign = amount < 0 ? CHAR_NEG : 0
    if (amount < 0) amount = -amount
    const digits = amount.toString()
    const firstDigitIdx = hasSign ? 2 : 1

    const xOf = (charCode: number): string => `${-(CHAR_W * charCode + colorOffset)}px`

    if (hasSign) {
        const el = $q(idPrefix + '1')
        if (el) el.style.backgroundPosition = xOf(sign)
    }
    for (let i = firstDigitIdx; i <= maxDigits - digits.length; i++) {
        const el = $q(idPrefix + i)
        if (el) el.style.backgroundPosition = xOf(0)
    }
    for (let i = 0; i < digits.length; i++) {
        const idx = digits.length - 1 - i
        const char = digits[idx] === '-' ? 12 : parseInt(digits[idx])
        const el = $q(idPrefix + (maxDigits - i))
        if (el) el.style.backgroundPosition = xOf(char)
    }
}

// --- HP / AC animated counter -----------------------------------------------
//
// CE ref: interface.cc interfaceRenderCounter / interfaceRenderHitPoints.
// Steps one unit per tick from the last displayed value toward the new target.
// Delay between ticks = max(16, 250 / |change|) ms — total ~250 ms for large
// changes, slower for small ones (1-unit change = 125 ms).
// CE blocks the main loop synchronously; DH2 uses a non-blocking setInterval.

let _dispHp: number | null = null   // value currently shown on the HUD (null = uninit)
let _targetHp: number | null = null // target of the active or last animation
let _hpTimer: ReturnType<typeof setInterval> | null = null

let _dispAc: number | null = null
let _targetAc: number | null = null
let _acTimer: ReturnType<typeof setInterval> | null = null

function _hpColorOffset(hp: number): number {
    // CE ref: interfaceRenderHitPoints — red = maxHp*0.25, yellow = maxHp*0.50
    const maxHp = globalState.player?.getStat('Max HP') ?? 0
    if (maxHp <= 0) return NUM_COLOR_WHITE
    if (hp < Math.floor(maxHp * 0.25)) return NUM_COLOR_RED
    if (hp < Math.floor(maxHp * 0.50)) return NUM_COLOR_YELLOW
    return NUM_COLOR_WHITE
}

export function drawHP(hp: number): void {
    updateIndicatorBar()

    if (_dispHp === null) {
        // First call — initialise immediately, no animation.
        _dispHp = hp; _targetHp = hp
        drawDigits('#hpDigit', hp, 4, true, _hpColorOffset(hp))
        return
    }
    if (_targetHp === hp) return  // already animating to this target

    _targetHp = hp

    // Cancel any in-progress animation and restart from current display position.
    if (_hpTimer !== null) { clearInterval(_hpTimer); _hpTimer = null }
    if (_dispHp === hp) return

    const step  = hp > _dispHp ? 1 : -1
    const delay = Math.max(16, Math.floor(250 / Math.abs(hp - _dispHp)))

    const timerId = setInterval(() => {
        if (_dispHp === null) { clearInterval(timerId); return }
        _dispHp += step
        drawDigits('#hpDigit', _dispHp, 4, true, _hpColorOffset(_dispHp))
        if (_dispHp === _targetHp) { clearInterval(timerId); _hpTimer = null }
    }, delay)
    _hpTimer = timerId
}

export function drawAC(ac: number): void {
    if (_dispAc === null) {
        _dispAc = ac; _targetAc = ac
        drawDigits('#acDigit', ac, 4, true)
        return
    }
    if (_targetAc === ac) return

    _targetAc = ac
    if (_acTimer !== null) { clearInterval(_acTimer); _acTimer = null }
    if (_dispAc === ac) return

    const step  = ac > _dispAc ? 1 : -1
    const delay = Math.max(16, Math.floor(250 / Math.abs(ac - _dispAc)))

    const timerId = setInterval(() => {
        if (_dispAc === null) { clearInterval(timerId); return }
        _dispAc += step
        drawDigits('#acDigit', _dispAc, 4, true)
        if (_dispAc === _targetAc) { clearInterval(timerId); _acTimer = null }
    }, delay)
    _acTimer = timerId
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

// ---------------------------------------------------------------------------
// Indicator badges  —  CE ref: interface.cc indicatorBarInit / indicatorBarRefresh
// ---------------------------------------------------------------------------
// CE constants (interface.h):
//   INDICATOR_BOX_WIDTH = 130, INDICATOR_BOX_HEIGHT = 21
//   INDICATOR_BOX_CONNECTOR_WIDTH = 3  (left-side connector overlap between badges)
//   INDICATOR_SLOTS_COUNT = 6          (max slots; only 5 badge types exist)
//   RADATION_INDICATOR_THRESHOLD = 65  (badge shows when radiationLevel  > 65)
//   POISON_INDICATOR_THRESHOLD   = 0   (badge shows when poisonLevel     > 0)
// Badge sprite: FRM 126 = WARNBOX = art/intrface/warnbox.png (130×21 px)
// Colors: CE _colorTable[31744] = RGB565(31744) = #f80000 (bad/red)
//         CE _colorTable[992]   = RGB565(992)   = #00f800 (good/green)
// Badge order matches Indicator enum: ADDICT(0) SNEAK(1) LEVEL(2) POISONED(3) RADIATED(4)

const BADGE_W  = 130
const BADGE_H  = 21
const BADGE_CW = 3            // connector overlap width
const BADGE_COLOR_BAD  = '#f80000'
const BADGE_COLOR_GOOD = '#00f800'

const INDICATOR_DEFS: ReadonlyArray<{ label: string; isBad: boolean }> = [
    { label: 'ADDICT',   isBad: true  },
    { label: 'SNEAK',    isBad: false },
    { label: 'LEVEL',    isBad: false },
    { label: 'POISONED', isBad: true  },
    { label: 'RADIATED', isBad: true  },
]

// Pre-rendered source canvases (full 130×21, built once when assets load).
let badgeSrcCanvases: Map<string, HTMLCanvasElement> | null = null
let badgeBuildPending = false

// CE: indicatorBarInit — blit warnbox.png background, then fontDrawText centered.
//   x = (BADGE_W - fontGetStringWidth(text)) / 2
//   y = (BADGE_H  - fontGetHeight()          + BADGE_CW) / 2
function buildBadgeSrcCanvases(cb: () => void): void {
    if (badgeBuildPending) return
    badgeBuildPending = true
    const img = new Image()
    img.src = 'art/intrface/warnbox.png'
    img.onload = () => {
        font1.onLoad(() => {
            const map = new Map<string, HTMLCanvasElement>()
            for (const def of INDICATOR_DEFS) {
                const canvas = document.createElement('canvas')
                canvas.width  = BADGE_W
                canvas.height = BADGE_H
                const ctx = canvas.getContext('2d')!
                ctx.drawImage(img, 0, 0)
                const color     = def.isBad ? BADGE_COLOR_BAD : BADGE_COLOR_GOOD
                const textCv    = font1.renderCanvas(def.label, color)
                const textX     = Math.floor((BADGE_W - textCv.width)  / 2)
                const textY     = Math.floor((BADGE_H - textCv.height + BADGE_CW) / 2)
                ctx.drawImage(textCv, textX, textY)
                map.set(def.label, canvas)
            }
            badgeSrcCanvases = map
            cb()
        })
    }
}

let indicatorBarEl: HTMLElement | null = null

export function updateIndicatorBar(): void {
    const player = globalState.player
    if (!player) return

    if (!indicatorBarEl) {
        const bar = document.getElementById('bar')
        if (!bar) return
        indicatorBarEl = document.createElement('div')
        indicatorBarEl.id = 'indicatorBar'
        // Anchored above #bar via bottom:100%; overflow:hidden clips the first
        // badge's left connector exactly at the container edge (CE: connectorWidthCompensation).
        Object.assign(indicatorBarEl.style, {
            position:      'absolute',
            bottom:        '100%',
            left:          '0',
            height:        BADGE_H + 'px',
            overflow:      'hidden',
            pointerEvents: 'none',
            zIndex:        '15',
        })
        bar.appendChild(indicatorBarEl)
    }

    // Determine active badges in CE enum order.
    const active = new Set<string>()
    const addicts: string[] = (player as any).addictions ?? []
    if (addicts.length > 0)                              active.add('ADDICT')
    if ((player as any).isSneaking)                      active.add('SNEAK')
    if (((player as any).skills?.skillPoints ?? 0) > 0) active.add('LEVEL')
    if (((player as any).poisonLevel    ?? 0) > 0)      active.add('POISONED')
    // CE: critterGetRadiation(gDude) > RADATION_INDICATOR_THRESHOLD (65) — strictly greater
    if (((player as any).radiationLevel ?? 0) > 65)     active.add('RADIATED')

    if (!badgeSrcCanvases) {
        buildBadgeSrcCanvases(() => renderIndicatorBadges(active))
        return
    }
    renderIndicatorBadges(active)
}

// CE: indicatorBarRender — packs active badges left-to-right.
// First badge: source starts at column BADGE_CW (clips left connector).
//   → display canvas is (BADGE_W - BADGE_CW) × BADGE_H, positioned at left=0.
// Badge i≥1: full BADGE_W canvas at left = i*(BADGE_W-BADGE_CW) - BADGE_CW.
// Container width = (BADGE_W - BADGE_CW) * count; overflow:hidden clips first connector.
function renderIndicatorBadges(active: Set<string>): void {
    const el = indicatorBarEl
    if (!el || !badgeSrcCanvases) return

    while (el.firstChild) el.removeChild(el.firstChild)

    const activeDefs = INDICATOR_DEFS.filter(d => active.has(d.label))
    if (activeDefs.length === 0) {
        el.style.visibility = 'hidden'
        return
    }

    el.style.visibility = 'visible'
    // Container is exactly as wide as the packed badges (CE window width formula).
    el.style.width = (BADGE_W - BADGE_CW) * activeDefs.length + 'px'

    for (let i = 0; i < activeDefs.length; i++) {
        const src = badgeSrcCanvases.get(activeDefs[i].label)!

        // CE: first badge blits source starting at column BADGE_CW (clips left connector).
        const srcX     = i === 0 ? BADGE_CW : 0
        const dispW    = i === 0 ? BADGE_W - BADGE_CW : BADGE_W
        // CE: x position in indicator window (derived from indicatorBarRender loop):
        //   i=0 → 0;  i≥1 → i*(BADGE_W-BADGE_CW) - BADGE_CW
        const leftPx   = i === 0 ? 0 : i * (BADGE_W - BADGE_CW) - BADGE_CW

        const cv = document.createElement('canvas')
        cv.width  = dispW
        cv.height = BADGE_H
        cv.getContext('2d')!.drawImage(src, srcX, 0, dispW, BADGE_H, 0, 0, dispW, BADGE_H)
        Object.assign(cv.style, { position: 'absolute', left: leftPx + 'px', top: '0' })
        el.appendChild(cv)
    }
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
    // CE ref: interface.cc interfaceRenderActionPoints — the unaffordable state
    // tints the button (red wash). Opacity stays at 1 so the sprite is fully
    // opaque; the tint alone signals "can't afford".
    $btn.style.opacity = '1'
    $btn.style.filter = affordable ? '' : 'brightness(0.7) sepia(0.4) hue-rotate(-25deg) saturate(2)'
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
        const player = globalState.player!
        const activeHand: 'leftHand' | 'rightHand' = (player as any).activeHand ?? 'leftHand'
        const activeItem = (player as any)[activeHand] as Obj | undefined

        // CE ref: interface.cc:1067-1078,1116-1127 interfaceUpdateItems() — a
        // non-weapon item in the active hand shows its own icon in the HUD
        // (INTERFACE_ITEM_ACTION_USE), not the unarmed fists/kicks fallback.
        if (activeItem && activeItem.invArt && !objectIsWeapon(activeItem)) {
            $wepImg.style.display = ''
            $wepImg.onload = null
            $wepImg.src = activeItem.invArt + '.png'
            $typeImg.style.display = 'none'
            hide($id('attackButtonCalled'))
            return
        }

        // Unarmed HUD: left hand → punch family, right hand → kick family (both empty only)
        const unarmedSkill = player.getSkill('Unarmed')
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

// CE ref: interface.cc — endanim.frm: 285×58, 5 frames of 57×58.
// Frame 0 = panel closed; frame 4 = panel fully open.
const END_ANIM_FRAMES   = 5
const END_ANIM_FRAME_W  = 57
const END_ANIM_DELAY_MS = 66   // ~5 frames in 330ms

let _endAnimTimer: ReturnType<typeof setTimeout> | null = null
let _endAnimFrame = 0

function setEndAnimFrame(frame: number): void {
    const el = document.getElementById('endContainer')
    if (el) el.style.backgroundPositionX = -(frame * END_ANIM_FRAME_W) + 'px'
    _endAnimFrame = frame
}

function stepEndAnim(dir: 1 | -1, onDone: () => void): void {
    if (_endAnimTimer !== null) { clearTimeout(_endAnimTimer); _endAnimTimer = null }
    const target = dir === 1 ? END_ANIM_FRAMES - 1 : 0
    if (_endAnimFrame === target) { onDone(); return }
    function tick(): void {
        _endAnimFrame += dir
        setEndAnimFrame(_endAnimFrame)
        if (_endAnimFrame === target) { onDone(); return }
        _endAnimTimer = setTimeout(tick, END_ANIM_DELAY_MS)
    }
    _endAnimTimer = setTimeout(tick, END_ANIM_DELAY_MS)
}

// CE ref: interface.cc interfaceBarEndButtonsRenderRedLights / RenderGreenLights —
// Show the light overlay over the end-button container.
// Red lights = AI turn (buttons disabled); green lights = player's turn (buttons enabled).
export function uiEndButtonsRedLights(): void {
    const el = document.getElementById('endLights')
    if (!el) return
    el.style.backgroundImage = "url('art/intrface/endltred.png')"
    el.style.display = 'block'
}
export function uiEndButtonsGreenLights(): void {
    const el = document.getElementById('endLights')
    if (!el) return
    el.style.backgroundImage = "url('art/intrface/endltgrn.png')"
    el.style.display = 'block'
}
export function uiEndButtonsClearLights(): void {
    const el = document.getElementById('endLights')
    if (el) el.style.display = 'none'
}

export function uiStartCombat(): void {
    globalState.cursorMode = 'attack'
    // CE ref: interface.cc interfaceBarEndButtonsShow / RenderRedLights:
    // animate end-turn panel open (frames 0→4), then show buttons with red lights.
    stepEndAnim(1, () => {
        showv($id('endTurnButton'))
        showv($id('endCombatButton'))
        uiEndButtonsRedLights()
    })
    const player = globalState.player!
    drawHP(player.getStat('HP'))
    drawAC(player.getStat('AC'))
    drawAP(player.AP!.getAvailableMoveAP(), player.AP!.getTotalMaxAP())
    globalState.combat?.refreshHighlights()
}

export function uiEndCombat(): void {
    hidev($id('endTurnButton'))
    hidev($id('endCombatButton'))
    uiEndButtonsClearLights()
    // CE ref: interface.cc — animate end-turn panel close (frames 4→0)
    stepEndAnim(-1, () => { /* panel closed */ })

    globalState.cursorMode = 'move'

    for (let i = 1; i <= 10; i++) {
        const el = document.getElementById('apLight' + i)
        if (el) (el as HTMLElement).style.visibility = 'hidden'
    }

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

/** @deprecated — was the CSS animationend handler; panel animation now driven by JS stepEndAnim */
export function uiEndCombatAnimationDone(this: HTMLElement): void {
    // no-op: JS frame-stepping replaced the CSS animation
}
