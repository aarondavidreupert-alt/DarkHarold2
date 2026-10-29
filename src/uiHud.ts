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

import { setHudRefresh } from './hudRefresh.js'
import { uiLog } from './messageLog.js'
import { objExamine, objLookAt } from './examine.js'
import { ammoGetQuantity } from './weaponAmmo.js'
import { Config } from './config.js'
import { world } from './state/world.js'
import { uiState } from './state/uiState.js'
import { services } from './state/services.js'
import { assets } from './state/assets.js'
import { Critter, Obj, WeaponObj, objectIsWeapon } from './object.js'
import { getMessage } from './util.js'
import { currentUnarmed, unarmedAPCost } from './unarmed.js'
import { $id, $img, $q, clearEl, show, hide, showv, hidev } from './uiDom.js'
import { font1 } from './uiFont.js'
import { outlinedCursorText } from './floatText.js'
import { assetUrl } from './modAssets.js'

// --- Digit readouts (shared by HP / AC / called-shot chance) ---------------

// CE ref: numbers.frm is a single 360×17 sprite with three horizontal colour bands:
//   offset   0 = white/grey  (HP ≥ 50% maxHp)
//   offset 120 = yellow      (25% ≤ HP < 50%)
//   offset 240 = red         (HP < 25%)
// 9 px per character; chars 0-9 then down-tick, up-tick, minus, plus.
const NUM_COLOR_WHITE = 0
const NUM_COLOR_YELLOW = 120
const NUM_COLOR_RED = 240

export function drawDigits(
    idPrefix: string,
    amount: number,
    maxDigits: number,
    hasSign: boolean,
    colorOffset = 0,
): void {
    const CHAR_W = 9,
        CHAR_NEG = 12
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
// Delay between ticks = 250 / (|change| + 1) ms (CE) — ~250 ms in total.
// CE blocks the main loop synchronously; DH2 uses a non-blocking setInterval.

let _dispHp: number | null = null // value currently shown on the HUD (null = uninit)
let _targetHp: number | null = null // target of the active or last animation
let _hpTimer: ReturnType<typeof setInterval> | null = null

let _dispAc: number | null = null
let _targetAc: number | null = null
let _acTimer: ReturnType<typeof setInterval> | null = null

function _hpColorOffset(hp: number): number {
    // CE ref: interfaceRenderHitPoints — red = maxHp*0.25, yellow = maxHp*0.50
    const maxHp = world.player?.getStat('Max HP') ?? 0
    if (maxHp <= 0) return NUM_COLOR_WHITE
    if (hp < Math.floor(maxHp * 0.25)) return NUM_COLOR_RED
    if (hp < Math.floor(maxHp * 0.5)) return NUM_COLOR_YELLOW
    return NUM_COLOR_WHITE
}

export function drawHP(hp: number): void {
    updateIndicatorBar()

    if (_dispHp === null) {
        // First call — initialise immediately, no animation.
        _dispHp = hp
        _targetHp = hp
        drawDigits('#hpDigit', hp, 4, true, _hpColorOffset(hp))
        return
    }
    if (_targetHp === hp) return // already animating to this target

    _targetHp = hp

    // Cancel any in-progress animation and restart from current display position.
    if (_hpTimer !== null) {
        clearInterval(_hpTimer)
        _hpTimer = null
    }
    if (_dispHp === hp) return

    const step = hp > _dispHp ? 1 : -1
    const delay = Math.trunc(250 / (Math.abs(hp - _dispHp) + 1)) // CE interfaceRenderHitPoints

    const timerId = setInterval(() => {
        if (_dispHp === null) {
            clearInterval(timerId)
            return
        }
        _dispHp += step
        drawDigits('#hpDigit', _dispHp, 4, true, _hpColorOffset(_dispHp))
        if (_dispHp === _targetHp) {
            clearInterval(timerId)
            _hpTimer = null
        }
    }, delay)
    _hpTimer = timerId
}

export function drawAC(ac: number): void {
    if (_dispAc === null) {
        _dispAc = ac
        _targetAc = ac
        drawDigits('#acDigit', ac, 4, true)
        return
    }
    if (_targetAc === ac) return

    _targetAc = ac
    if (_acTimer !== null) {
        clearInterval(_acTimer)
        _acTimer = null
    }
    if (_dispAc === ac) return

    const step = ac > _dispAc ? 1 : -1
    const delay = Math.trunc(250 / (Math.abs(ac - _dispAc) + 1)) // CE interfaceRenderArmorClass

    const timerId = setInterval(() => {
        if (_dispAc === null) {
            clearInterval(timerId)
            return
        }
        _dispAc += step
        drawDigits('#acDigit', _dispAc, 4, true)
        if (_dispAc === _targetAc) {
            clearInterval(timerId)
            _acTimer = null
        }
    }, delay)
    _acTimer = timerId
}

export function drawAP(current: number, max: number, freeMove: number = 0, isPlayerTurn: boolean = true): void {
    // CE ref: interface.cc interfaceRenderActionPoints — the lights are redrawn at once
    // (green for AP left, yellow for free move, all ten red off-turn); no animation.
    const apply = (i: number, src: string | null) => {
        const el = document.getElementById('apLight' + (i + 1)) as HTMLImageElement | null
        if (!el) return
        if (src) {
            el.src = assetUrl(src)
            el.style.visibility = 'visible'
        } else {
            el.style.visibility = 'hidden'
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

const BADGE_W = 130
const BADGE_H = 21
const BADGE_CW = 3 // connector overlap width
const BADGE_COLOR_BAD = '#f80000'
const BADGE_COLOR_GOOD = '#00f800'

// CE gIndicatorDescriptions: the text is intrface.msg 100-104 (the label is the key)
const INDICATOR_DEFS: ReadonlyArray<{ label: string; isBad: boolean; msg: number }> = [
    { label: 'ADDICT', isBad: true, msg: 102 },
    { label: 'SNEAK', isBad: false, msg: 100 },
    { label: 'LEVEL', isBad: false, msg: 101 },
    { label: 'POISONED', isBad: true, msg: 103 },
    { label: 'RADIATED', isBad: true, msg: 104 },
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
    img.src = assetUrl('art/intrface/warnbox.png')
    img.onload = () => {
        font1.onLoad(() => {
            const map = new Map<string, HTMLCanvasElement>()
            for (const def of INDICATOR_DEFS) {
                const canvas = document.createElement('canvas')
                canvas.width = BADGE_W
                canvas.height = BADGE_H
                const ctx = canvas.getContext('2d')!
                ctx.drawImage(img, 0, 0)
                const color = def.isBad ? BADGE_COLOR_BAD : BADGE_COLOR_GOOD
                const textCv = font1.renderCanvas(getMessage('intrface', def.msg) ?? def.label, color)
                const textX = Math.floor((BADGE_W - textCv.width) / 2)
                const textY = Math.floor((BADGE_H - textCv.height + BADGE_CW) / 2)
                ctx.drawImage(textCv, textX, textY)
                map.set(def.label, canvas)
            }
            badgeSrcCanvases = map
            cb()
        })
    }
}

let indicatorBarEl: HTMLElement | null = null

// CE indicatorBarHide / indicatorBarShow: the warning boxes go away while the dialogue,
// the character editor or the Pip-Boy is open
export function setIndicatorBarHidden(hidden: boolean): void {
    if (indicatorBarEl) indicatorBarEl.style.display = hidden ? 'none' : ''
}

export function updateIndicatorBar(): void {
    const player = world.player
    if (!player) return

    if (!indicatorBarEl) {
        const bar = document.getElementById('bar')
        if (!bar) return
        indicatorBarEl = document.createElement('div')
        indicatorBarEl.id = 'indicatorBar'
        // Anchored above #bar via bottom:100%; overflow:hidden clips the first
        // badge's left connector exactly at the container edge (CE: connectorWidthCompensation).
        Object.assign(indicatorBarEl.style, {
            position: 'absolute',
            bottom: '100%',
            left: '0',
            height: BADGE_H + 'px',
            overflow: 'hidden',
            pointerEvents: 'none',
            zIndex: '15',
        })
        bar.appendChild(indicatorBarEl)
    }

    // Determine active badges in CE enum order.
    const active = new Set<string>()
    // CE interface.cc:2323 — dudeHasState(DUDE_STATE_ADDICTED)
    if (player.addictedState === true) active.add('ADDICT')
    if (player.isSneaking) active.add('SNEAK')
    if (player.levelUpAvailable === true) active.add('LEVEL') // CE DUDE_STATE_LEVEL_UP_AVAILABLE
    if ((player.poisonLevel ?? 0) > 0) active.add('POISONED')
    // CE: critterGetRadiation(gDude) > RADATION_INDICATOR_THRESHOLD (65) — strictly greater
    if (((player as any).radiationLevel ?? 0) > 65) active.add('RADIATED')

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

    const activeDefs = INDICATOR_DEFS.filter((d) => active.has(d.label))
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
        const srcX = i === 0 ? BADGE_CW : 0
        const dispW = i === 0 ? BADGE_W - BADGE_CW : BADGE_W
        // CE: x position in indicator window (derived from indicatorBarRender loop):
        //   i=0 → 0;  i≥1 → i*(BADGE_W-BADGE_CW) - BADGE_CW
        const leftPx = i === 0 ? 0 : i * (BADGE_W - BADGE_CW) - BADGE_CW

        const cv = document.createElement('canvas')
        cv.width = dispW
        cv.height = BADGE_H
        cv.getContext('2d')!.drawImage(src, srcX, 0, dispW, BADGE_H, 0, 0, dispW, BADGE_H)
        Object.assign(cv.style, { position: 'absolute', left: leftPx + 'px', top: '0' })
        el.appendChild(cv)
    }
}

// CE item.cc dudeIsWeaponDisabled: a weapon is unusable with both arms crippled, or a
// two-handed one with either arm crippled.
function dudeIsWeaponDisabled(item: Obj | undefined | null): boolean {
    if (!item || !objectIsWeapon(item) || (item as any).pid === undefined) return false
    const p = world.player as any
    if (p.crippledLeftArm && p.crippledRightArm) return true
    const twoHanded = (((item as any).pro?.extra?.weaponFlags ?? 0) & 0x02) !== 0 // WEAPON_TWO_HAND
    return twoHanded && (p.crippledLeftArm || p.crippledRightArm)
}

// CE interface.cc interfaceBarRefreshMainAction with isDisabled: the button is the
// unreadied art (intrface #73 SATURBUP, up and down), no hit mode or AP cost, and the
// attack button is disabled.
function setAttackButtonDisabled(disabled: boolean): void {
    const c = document.getElementById('attackButtonContainer')
    if (!c) {
        return
    }
    c.classList.toggle('weaponDisabled', disabled)
    for (const id of ['attackButtonType', 'attackButtonAP', 'attackButtonCalled']) {
        const el = document.getElementById(id)
        if (el && disabled) el.style.visibility = 'hidden'
        else if (el) el.style.visibility = ''
    }
}

export function attackButtonDisabled(): boolean {
    return document.getElementById('attackButtonContainer')?.classList.contains('weaponDisabled') ?? false
}

// --- Scrolling log: messageLog.ts (a leaf module, so game logic can log without importing the HUD)
export { uiLog, uiLogReset, uiLogCount, initLogScrollZones } from './messageLog.js'

// --- Weapon bar ------------------------------------------------------------

// CE interface.cc interfaceUpdateItems: an item new in a hand starts on its primary action
// (a weapon put back in a hand isn't still in burst or reload mode).
const lastHandItems: { leftHand: unknown; rightHand: unknown } = { leftHand: undefined, rightHand: undefined }
function resetChangedHandActions(): void {
    const p = world.player as any
    if (!p) return
    for (const hand of ['leftHand', 'rightHand'] as const) {
        const item = p[hand]
        if (item !== lastHandItems[hand]) {
            const w = item?.weapon
            if (w && Array.isArray(w.modes) && w.modes.length) w.mode = w.modes[0]
            lastHandItems[hand] = item
        }
    }
}

export function uiDrawWeapon(): void {
    resetChangedHandActions()
    // draw the active weapon in the interface bar
    const weapon = world.player!.equippedWeapon
    clearEl($id('attackButton'))
    {
        const player = world.player as any
        setAttackButtonDisabled(dudeIsWeaponDisabled(player[player.activeHand ?? 'leftHand']))
    }
    const $wepImg = $id('attackButtonWeapon') as HTMLImageElement
    const $typeImg = $img('attackButtonType')
    if (!weapon || !weapon.weapon) {
        const player = world.player!
        const activeHand: 'leftHand' | 'rightHand' = player.activeHand ?? 'leftHand'
        const activeItem = player[activeHand] as Obj | undefined

        // CE ref: interface.cc:1067-1078,1116-1127 interfaceUpdateItems() — a
        // non-weapon item in the active hand shows its own icon in the HUD
        // (INTERFACE_ITEM_ACTION_USE), not the unarmed fists/kicks fallback.
        if (activeItem && activeItem.invArt && !objectIsWeapon(activeItem)) {
            $wepImg.style.display = ''
            $wepImg.onload = null
            $wepImg.src = assetUrl(activeItem.invArt + '.png')
            $typeImg.style.display = 'none'
            hide($id('attackButtonCalled'))
            return
        }

        // CE interface.cc interfaceBarRefreshMainAction: an empty left hand punches, an
        // empty right hand kicks; the label is the hit mode's FRM (spunch, cm_jab, …),
        // the bullseye marks an aimed attack, the digit is weaponGetActionPointCost.
        const { mode, aiming } = currentUnarmed(player)
        const ap = unarmedAPCost(player, mode, aiming)
        $wepImg.style.display = 'none'
        $typeImg.style.display = ''
        $img('attackButtonType').src = assetUrl(`art/intrface/${mode.icon}.png`)
        const CHAR_W = 10
        if (ap <= 9) {
            $id('attackButtonAPDigit').style.backgroundPosition = 0 - CHAR_W * ap + 'px'
        }
        if (aiming) show($id('attackButtonCalled'))
        else hide($id('attackButtonCalled'))
        return
    }
    $wepImg.style.display = ''
    $typeImg.style.display = ''

    {
        // CE interfaceBarRefreshMainAction draws the item's inventory image for any weapon
        $wepImg.onload = null
        $wepImg.onload = function () {
            if (!$wepImg.complete) {
                return
            }
            Object.assign($wepImg.style, {
                position: 'absolute',
                top: '5px',
                left: $id('attackButton').offsetWidth / 2 - $wepImg.width / 2 + 'px',
                maxHeight: $id('attackButton').offsetHeight - 10 + 'px',
                display: '',
            })
            $wepImg.setAttribute('draggable', 'false')
        }
        $wepImg.src = assetUrl(weapon.invArt + '.png')
    }

    // draw weapon AP cost digit
    // reload=CE item.cc:1640, called=APCost1+1 (aiming surcharge), burst=APCost2, otherwise APCost1
    const CHAR_W = 10
    let digit: number
    const mode = weapon.weapon.mode
    if (mode === 'reload') {
        digit = weapon.weapon.getReloadAPCost() // CE ref: item.cc:1640
    } else {
        digit = weapon.weapon.getAttackAPCost(world.player!, undefined, weapon.weapon.isCalled()) // CE weaponGetActionPointCost
    }
    if (digit === undefined || digit > 9) {
        return
    } // TODO: Weapon AP >9?
    $id('attackButtonAPDigit').style.backgroundPosition = 0 - CHAR_W * digit + 'px'

    // CE interfaceBarRefreshMainAction: the label follows the action's attack anim —
    // punch / kick, swing, thrust, throw, single, burst (burst + continuous), reload.
    const ATTACK_LABEL: { [mode: number]: string } = {
        1: 'punch',
        2: 'kick',
        3: 'swing',
        4: 'thrust',
        5: 'throw',
        6: 'single',
        7: 'burst',
        8: 'burst',
    }
    const type = mode === 'reload' ? 'reload' : (ATTACK_LABEL[weapon.weapon.attackModeOf()] ?? 'single')
    $img('attackButtonType').src = assetUrl(`art/intrface/${type}.png`)

    // hide or show called shot sigil?
    if (weapon.weapon.isCalled()) {
        show($id('attackButtonCalled'))
    } else {
        hide($id('attackButtonCalled'))
    }

    uiUpdateAmmoBar(weapon)
}

export function uiUpdateAmmoBar(weapon: WeaponObj | null): void {
    const fill = document.getElementById('ammoBarFill')
    if (!fill) return
    // CE ref: interface.cc:1355 interfaceBarRefreshMainAction — ratio = current/max * 70
    // (weapon ammo, or a misc item's charges); interfaceUpdateAmmoBar rounds it down to even.
    let ratio = 0
    const extra = weapon?.pro?.extra
    if (extra?.maxAmmo > 0) {
        ratio = Math.trunc((ammoGetQuantity(weapon) / extra.maxAmmo) * 70)
    } else if (extra?.charges > 0) {
        // misc proto `charges` = CE miscItemGetMaxCharges
        ratio = Math.trunc(((weapon?.miscCharges ?? 0) / extra.charges) * 70)
    }
    ratio = Math.max(0, Math.min(70, ratio))
    if ((ratio & 1) !== 0) ratio -= 1
    fill.style.height = ratio + 'px'
}

// --- Combat bar ------------------------------------------------------------

// CE ref: interface.cc — endanim.frm: 285×58, 5 frames of 57×58.
// Frame 0 = panel closed; frame 4 = panel fully open.
const END_ANIM_FRAMES = 5
const END_ANIM_FRAME_W = 57
// CE interfaceBarEndButtonsShow / Hide: a frame every 1000 / the FRM's fps
const endAnimDelay = (): number => 1000 / (assets.imageInfo!['art/intrface/endanim']?.fps || 15)

let _endAnimTimer: ReturnType<typeof setTimeout> | null = null
let _endAnimFrame = 0

function setEndAnimFrame(frame: number): void {
    const el = document.getElementById('endContainer')
    if (el) el.style.backgroundPositionX = -(frame * END_ANIM_FRAME_W) + 'px'
    _endAnimFrame = frame
}

function stepEndAnim(dir: 1 | -1, onDone: () => void): void {
    if (_endAnimTimer !== null) {
        clearTimeout(_endAnimTimer)
        _endAnimTimer = null
    }
    const target = dir === 1 ? END_ANIM_FRAMES - 1 : 0
    if (_endAnimFrame === target) {
        onDone()
        return
    }
    function tick(): void {
        _endAnimFrame += dir
        setEndAnimFrame(_endAnimFrame)
        if (_endAnimFrame === target) {
            onDone()
            return
        }
        _endAnimTimer = setTimeout(tick, endAnimDelay())
    }
    _endAnimTimer = setTimeout(tick, endAnimDelay())
}

// CE ref: interface.cc interfaceBarEndButtonsRenderRedLights / RenderGreenLights —
// Show the light overlay over the end-button container.
// Red lights = AI turn (buttons disabled); green lights = player's turn (buttons enabled).
// CE ref: interface.cc interfaceBarEndButtonsRenderRed/GreenLights — the lights
// FRM and buttonDisable/buttonEnable on End Turn / End Combat.
function setEndButtonsEnabled(enabled: boolean): void {
    for (const id of ['endTurnButton', 'endCombatButton']) {
        const b = document.getElementById(id)
        if (b) b.style.pointerEvents = enabled ? '' : 'none'
    }
}
export function uiEndButtonsRedLights(): void {
    setEndButtonsEnabled(false)
    const el = document.getElementById('endLights')
    if (!el) return
    el.style.backgroundImage = "url('" + assetUrl('art/intrface/endltred.png') + "')"
    el.style.display = 'block'
}
export function uiEndButtonsGreenLights(): void {
    setEndButtonsEnabled(true)
    const el = document.getElementById('endLights')
    if (!el) return
    el.style.backgroundImage = "url('" + assetUrl('art/intrface/endltgrn.png') + "')"
    el.style.display = 'block'
}
export function uiEndButtonsClearLights(): void {
    const el = document.getElementById('endLights')
    if (el) el.style.display = 'none'
}

export function uiStartCombat(): void {
    uiState.cursorMode = 'attack'
    // CE ref: interface.cc interfaceBarEndButtonsShow / RenderRedLights:
    // animate end-turn panel open (frames 0→4), then show buttons with red lights.
    // The panel opening sounds iciboxx1.
    if (_endAnimFrame !== END_ANIM_FRAMES - 1 && !window.__test?.fastMode)
        services.audioEngine?.playSfxByName?.('iciboxx1')
    stepEndAnim(1, () => {
        showv($id('endTurnButton'))
        showv($id('endCombatButton'))
        // The panel finishes opening asynchronously — by then the first turn may
        // already be the player's (Combat.start → nextTurn), so light the buttons for
        // whoever's turn it is now instead of always red (which left End Turn / End
        // Combat disabled for the player's whole first turn).
        if (world.combat?.inPlayerTurn) uiEndButtonsGreenLights()
        else uiEndButtonsRedLights()
    })
    const player = world.player!
    drawHP(player.getStat('HP'))
    drawAC(player.getStat('AC'))
    drawAP(player.AP!.getAvailableCombatAP(), player.AP!.getTotalMaxAP(), player.AP!.move)
    world.combat?.refreshHighlights()
}

export function uiEndCombat(): void {
    hidev($id('endTurnButton'))
    hidev($id('endCombatButton'))
    uiEndButtonsClearLights()
    // CE ref: interface.cc — animate end-turn panel close (frames 4→0)
    stepEndAnim(-1, () => {
        /* panel closed */
    })

    uiState.cursorMode = 'move'

    for (let i = 1; i <= 10; i++) {
        const el = document.getElementById('apLight' + i)
        if (el) (el as HTMLElement).style.visibility = 'hidden'
    }

    const $hover = document.getElementById('combatHoverInfo')
    if ($hover) $hover.style.display = 'none'
}

// CE _colorTable[rgb555] → CSS.
const rgb555 = (v: number): string => {
    const c = (x: number) => Math.round(((x & 31) * 255) / 31)
    return `rgb(${c(v >> 10)}, ${c(v >> 5)}, ${c(v)})`
}
let _lastHoverObj: Obj | null = null

// CE ref: game_mouse.cc:745-777 — with the attack cursor over an object: "NN%" from
// _combat_to_hit (bad shot → " X "), coloured by team (non-player team 32767/31744,
// player team 32495/18161, non-critter 17969/32239); with combat_looks on, the object
// is examined (_obj_examine) when the pointed object changes.
export function uiShowCombatHover(target: Obj, screenX: number, screenY: number): void {
    const $hover = document.getElementById('combatHoverInfo')
    if (!$hover) return
    const player = world.player
    if (!player) return

    if (Config.ui.combatLooks && target !== _lastHoverObj) {
        // CE: _obj_examine, falling back to _obj_look_at.
        const lines = objExamine(player, target)
        for (const line of lines.length ? lines : objLookAt(player, target)) uiLog(line)
    }
    _lastHoverObj = target

    const isCritter = target.type === 'critter'
    const notPlayerTeam = isCritter && (target as Critter).teamNum !== player.teamNum
    let text: string
    let color: string
    // CE _combat_to_hit: " X " whenever _combat_check_bad_shot refuses (dead, crippled arms, AP,
    // range, ammo, blocked aim) for the current hit mode
    const weapon = player.equippedWeapon
    const real = !!weapon && weapon.pid !== undefined
    const aiming = real ? !!weapon.weapon?.isCalled?.() : !!currentUnarmed(player)?.aiming
    const shotOk = !!world.combat && isCritter && world.combat.checkBadShot(player, target as Critter, aiming) === 'ok'
    if (isCritter && shotOk && world.combat) {
        const hit = world.combat.getHitChance(player, target as Critter, 'torso').hit
        text = `${hit}%`
        color = rgb555(notPlayerTeam ? 32767 : 32495)
    } else if (!isCritter) {
        // CE also shows the to-hit for non-critters (colour 17969 / 32239); DH2's
        // getHitChance needs a critter target, so the hover stays hidden for those.
        uiHideCombatHover()
        return
    } else {
        text = ' X '
        color = rgb555(notPlayerTeam ? 31744 : 18161)
    }

    // CE gameMouseRenderAccuracy: font 101 with a black outline, no box, drawn into the
    // acttohit frame at (crosshair width + 1, 1) — just right of the crosshair image (21 x 21,
    // centred on the mouse, renderer.ts), its outline one pixel further out
    const canvas = outlinedCursorText(text, color)
    if (!canvas) {
        return
    }
    $hover.style.display = 'block'
    $hover.style.left = screenX - 10 + 21 + 'px'
    $hover.style.top = screenY - 10 + 'px'
    $hover.replaceChildren(canvas)
}

export function uiHideCombatHover(): void {
    _lastHoverObj = null
    const $hover = document.getElementById('combatHoverInfo')
    if ($hover) $hover.style.display = 'none'
}

/** @deprecated — was the CSS animationend handler; panel animation now driven by JS stepEndAnim */
export function uiEndCombatAnimationDone(this: HTMLElement): void {
    // no-op: JS frame-stepping replaced the CSS animation
}

// game logic calls these through hudRefresh.ts, a module without HUD imports
setHudRefresh({ drawHP, drawAC, drawAP, uiDrawWeapon, updateIndicatorBar })
