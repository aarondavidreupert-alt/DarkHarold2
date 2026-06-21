/*
Copyright 2026

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

// Party member control + customization screens.
//
// CE ref: game_dialog.cc partyMemberControlWindowInit/Update/HandleEvents
// (~line 3354), partyMemberCustomizationWindowInit/Update/HandleEvents
// (~line 3780). All positions/FRM IDs below verified directly against that
// source file (not inferred) — see wiki/companion_party.md §8 for the full
// citation table.
//
// Known, documented simplification: "Use Best Weapon"/"Use Best Armor"
// (CE's _ai_search_inven_weap/_ai_search_inven_armor) are not implemented —
// CE's weapon-quality heuristic (AP cost, ammo availability, damage
// comparison) is its own substantial sub-system. The buttons are present
// (matching CE's layout) but currently just log a notice. See
// wiki/known_bugs.md.

import globalState from './globalState.js'
import { Critter, Obj } from './object.js'
import { UIMode, getUiContainer } from './ui_panels.js'
import { font1, font3 } from './ui_font.js'
import { FoText } from './ui/foText.js'
import { AiPacket, Disposition, findCompanionPacketForDisposition } from './aiPackets.js'
import {
    CustomAiCategory,
    getCompanionEffectivePacket,
    setCompanionCustomSetting,
    setCompanionDisposition,
} from './party.js'
import { uiCompanionTrade } from './ui_companion_trade.js'

// ── Layout constants (verified against game_dialog.cc) ───────────────────────

const WINDOW_W = 640
const WINDOW_H = 190

// Disposition buttons — x=438, FRM dims 109x28. CE ref: game_dialog.cc:386-390
// (gGameDialogDispositionButtonsData), key codes 2098/2103/2102/2111/2099.
const DISPOSITION_BUTTONS: { y: number; disposition: Disposition; frmBase: string }[] = [
    { y: 37, disposition: 'berserk', frmBase: 'ber' },
    { y: 67, disposition: 'aggressive', frmBase: 'agg' },
    { y: 96, disposition: 'defensive', frmBase: 'def' },
    { y: 126, disposition: 'coward', frmBase: 'cow' },
    { y: 156, disposition: 'custom', frmBase: 'cus' },
]
const DISPOSITION_BTN_W = 109
const DISPOSITION_BTN_H = 28
const DISPOSITION_BTN_X = 438

// Main action buttons — 14x14, generic red dialogue button (di_rdbt2=up,
// di_rdbt1=down). CE ref: game_dialog.cc:3388-3418.
const ACTION_BTN_SIZE = 14

// Customization category buttons — x=95/96, FRM dims 109x28.
// CE ref: game_dialog.cc:446-452 (_custom_button_info).
const CUSTOM_BUTTONS: { y: number; x: number; category: CustomAiCategory; frmUp: string; frmDn: string; label: string }[] = [
    { y: 9, x: 95, category: 'areaAttackMode', frmUp: 'burstup', frmDn: 'burstdn', label: 'Burst safety' },
    { y: 38, x: 96, category: 'runAwayMode', frmUp: 'runup', frmDn: 'rundn', label: 'Run away at' },
    { y: 68, x: 96, category: 'bestWeapon', frmUp: 'weapup', frmDn: 'weapdn', label: 'Preferred weapon' },
    { y: 98, x: 96, category: 'distance', frmUp: 'distup', frmDn: 'distdn', label: 'Combat distance' },
    { y: 127, x: 96, category: 'attackWho', frmUp: 'attackup', frmDn: 'attackdn', label: 'Attack who' },
    { y: 157, x: 96, category: 'chemUse', frmUp: 'chemup', frmDn: 'chemdn', label: 'Chem use' },
]

// Per-category value options. CE ref: game_dialog.cc:394-441 (_custom_settings) —
// message text reproduced from game/custom.msg via the CE source comments.
const CUSTOM_OPTIONS: { [K in CustomAiCategory]: { value: AiPacket[K]; label: string }[] } = {
    areaAttackMode: [
        { value: 'sometimes', label: "Always! Don't worry about hitting me" },
        { value: 'no_pref', label: "Sometimes, don't worry about hitting me" },
        { value: 'be_sure', label: "Be sure you won't hit me" },
        { value: 'be_careful', label: 'Be careful not to hit me' },
        { value: 'be_absolutely_sure', label: "Be absolutely sure you won't hit me" },
    ],
    runAwayMode: [
        { value: 'coward', label: 'Abject coward' },
        { value: 'finger_hurts', label: 'Your finger hurts' },
        { value: 'bleeding', label: "You're bleeding a bit" },
        { value: 'not_feeling_good', label: 'Not feeling good' },
        { value: 'none', label: 'You need a tourniquet' },
        { value: 'never', label: 'Never!' },
    ],
    bestWeapon: [
        { value: 'no_pref', label: 'None' },
        { value: 'melee', label: 'Melee' },
        { value: 'melee_over_ranged', label: 'Melee then ranged' },
        { value: 'ranged_over_melee', label: 'Ranged then melee' },
        { value: 'ranged', label: 'Ranged' },
        { value: 'unarmed', label: 'Unarmed' },
    ],
    distance: [
        { value: 'stay_close', label: 'Stay close to me' },
        { value: 'charge', label: 'Charge!' },
        { value: 'snipe', label: 'Snipe the enemy' },
        { value: 'on_your_own', label: 'On your own' },
        { value: 'stay', label: 'Stay where you are' },
    ],
    attackWho: [
        { value: 'whomever_attacking_me', label: 'Whomever is attacking me' },
        { value: 'strongest', label: 'The strongest' },
        { value: 'weakest', label: 'The weakest' },
        { value: 'whomever', label: 'Whomever you want' },
        { value: 'closest', label: 'Whoever is closest' },
    ],
    chemUse: [
        { value: 'clean', label: "I'm clean" },
        { value: 'stims_when_hurt_little', label: 'Stimpacks when hurt a bit' },
        { value: 'stims_when_hurt_lots', label: 'Stimpacks when hurt a lot' },
        { value: 'sometimes', label: 'Any drug some of the time' },
        { value: 'anytime', label: 'Any drug any time' },
    ],
}

// ── DOM helpers ────────────────────────────────────────────────────────────────

function makeOverlay(): HTMLDivElement {
    const el = document.createElement('div')
    Object.assign(el.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '900',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
    })
    return el
}

function makePanel(bgImage: string, w: number, h: number): HTMLDivElement {
    const el = document.createElement('div')
    Object.assign(el.style, {
        position: 'relative',
        width: w + 'px',
        height: h + 'px',
        backgroundImage: `url('art/intrface/${bgImage}.png')`,
        backgroundSize: '100% 100%',
        imageRendering: 'pixelated',
        flexShrink: '0',
    })
    return el
}

/** A graphic button with up/down image states, optionally a third disabled state. */
function makeGraphicButton(
    x: number, y: number, w: number, h: number,
    upImg: string, downImg: string, disabledImg: string | null,
    pressed: boolean, disabled: boolean,
    onClick?: () => void
): HTMLDivElement {
    const el = document.createElement('div')
    const img = disabled && disabledImg ? disabledImg : pressed ? downImg : upImg
    Object.assign(el.style, {
        position: 'absolute',
        left: x + 'px',
        top: y + 'px',
        width: w + 'px',
        height: h + 'px',
        backgroundImage: `url('art/intrface/${img}.png')`,
        backgroundSize: '100% 100%',
        imageRendering: 'pixelated',
        cursor: disabled ? 'default' : 'pointer',
        pointerEvents: disabled ? 'none' : 'auto',
    })
    if (onClick && !disabled) el.addEventListener('click', onClick)
    return el
}

/** Small 14x14 red action button (talk/trade/weapon/armor). */
function makeActionButton(x: number, y: number, onClick: () => void): HTMLDivElement {
    const el = document.createElement('div')
    Object.assign(el.style, {
        position: 'absolute',
        left: x + 'px',
        top: y + 'px',
        width: ACTION_BTN_SIZE + 'px',
        height: ACTION_BTN_SIZE + 'px',
        backgroundImage: "url('art/intrface/di_rdbt2.png')",
        backgroundSize: '100% 100%',
        imageRendering: 'pixelated',
        cursor: 'pointer',
    })
    el.addEventListener('mousedown', () => { el.style.backgroundImage = "url('art/intrface/di_rdbt1.png')" })
    el.addEventListener('mouseup', () => { el.style.backgroundImage = "url('art/intrface/di_rdbt2.png')" })
    el.addEventListener('mouseleave', () => { el.style.backgroundImage = "url('art/intrface/di_rdbt2.png')" })
    el.addEventListener('click', onClick)
    return el
}

function makeLabel(x: number, y: number, text: string, color = '#c8b466'): HTMLDivElement {
    const wrap = document.createElement('div')
    Object.assign(wrap.style, { position: 'absolute', left: x + 'px', top: y + 'px', pointerEvents: 'none', lineHeight: '0' })
    new FoText(font1, text, color).appendTo(wrap)
    return wrap
}

// ── Control window ────────────────────────────────────────────────────────────

/**
 * Open the party member control screen for `companion`.
 * CE ref: game_dialog.cc:3354 partyMemberControlWindowInit.
 */
export function uiCompanionControl(companion: Critter): void {
    const prevMode = globalState.uiMode
    globalState.uiMode = UIMode.companionControl

    const overlay = makeOverlay()
    const panel = makePanel('control', WINDOW_W, WINDOW_H)

    function close(): void {
        overlay.remove()
        globalState.uiMode = prevMode
    }

    function redraw(): void {
        // Clear and rebuild — simplest way to keep the live stat readout
        // (HP/AP/weight/equipped gear) and the disposition button rest-states
        // in sync after any action.
        panel.innerHTML = ''
        panel.style.backgroundImage = "url('art/intrface/control.png')"

        // Stat readout. CE ref: game_dialog.cc partyMemberControlWindowUpdate
        // (~line 3542) — weapon name y=20, armor name y=49, HP y=96, weight y=131.
        const weapon = (companion as any).equippedWeapon
        const armor = companion.getEquippedArmor?.()
        panel.appendChild(makeLabel(20, 4, companion.name ?? 'Companion', '#ffff80'))
        panel.appendChild(makeLabel(20, 20, 'Weapon: ' + (weapon?.name ?? 'None')))
        panel.appendChild(makeLabel(20, 38, 'Armor: ' + (armor?.name ?? 'None')))

        const hp = companion.getStat('HP')
        const maxHp = companion.getStat('Max HP')
        panel.appendChild(makeLabel(20, 60, `HP: ${hp}/${maxHp}`))

        const weight = companion.getInventoryWeight()
        const maxWeight = companion.getStat('Carry')
        const overWeight = weight > maxWeight
        panel.appendChild(makeLabel(20, 78, `Weight: ${weight}/${maxWeight}`, overWeight ? '#ff4444' : '#c8b466'))

        const packet = getCompanionEffectivePacket(companion)
        panel.appendChild(makeLabel(20, 96, 'Disposition: ' + packet.disposition))

        // Action buttons — CE ref: game_dialog.cc:3388-3418.
        panel.appendChild(makeActionButton(593, 41, () => {
            // CE's TALK button re-enters the companion's normal dialogue node.
            // DH2 has no dedicated re-entry hook here — just close the screen
            // and let the player re-initiate dialogue normally.
            close()
        }))
        panel.appendChild(makeActionButton(593, 97, () => {
            close()
            uiCompanionTrade(companion)
        }))
        panel.appendChild(makeActionButton(236, 15, () => {
            console.log('[Companion] "Use best weapon" is not implemented yet — CE\'s _ai_search_inven_weap heuristic (AP cost, ammo, damage comparison) is a separate sub-system. See wiki/known_bugs.md.')
        }))
        panel.appendChild(makeActionButton(235, 46, () => {
            console.log('[Companion] "Use best armor" is not implemented yet — see wiki/known_bugs.md.')
        }))

        // Disposition buttons.
        for (const btn of DISPOSITION_BUTTONS) {
            const supported = packet.disposition === btn.disposition
                || !!findSiblingPreview(companion, btn.disposition)
            panel.appendChild(makeGraphicButton(
                DISPOSITION_BTN_X, btn.y, DISPOSITION_BTN_W, DISPOSITION_BTN_H,
                btn.frmBase + 'up', btn.frmBase + 'dn', btn.frmBase + 'off',
                packet.disposition === btn.disposition, !supported,
                () => {
                    if (btn.disposition === 'custom') {
                        setCompanionDisposition(companion, 'custom')
                        close()
                        uiCompanionCustomize(companion, () => uiCompanionControl(companion))
                        return
                    }
                    setCompanionDisposition(companion, btn.disposition)
                    redraw()
                }
            ))
        }

        overlay.appendChild(panel)
    }

    redraw()
    overlay.appendChild(panel)

    const keyHandler = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') { e.preventDefault(); close(); document.removeEventListener('keydown', keyHandler, true) }
    }
    document.addEventListener('keydown', keyHandler, true)

    getUiContainer().appendChild(overlay)
}

/** Cheap existence check used only to decide whether to show a disposition
 *  button as enabled — does not mutate anything. */
function findSiblingPreview(companion: Critter, disposition: Disposition): boolean {
    const packet = getCompanionEffectivePacket(companion)
    return !!findCompanionPacketForDisposition(packet, disposition)
}

// ── Customization sub-screen ─────────────────────────────────────────────────

/**
 * Open the 6-category "Custom" behavior screen for `companion`.
 * CE ref: game_dialog.cc:~3780 partyMemberCustomizationWindowInit.
 */
export function uiCompanionCustomize(companion: Critter, onClose: () => void): void {
    const prevMode = globalState.uiMode
    globalState.uiMode = UIMode.companionControl

    const overlay = makeOverlay()
    const panel = makePanel('custom', WINDOW_W, WINDOW_H)

    function close(): void {
        overlay.remove()
        globalState.uiMode = prevMode
        onClose()
    }

    function redraw(): void {
        panel.innerHTML = ''
        const packet = getCompanionEffectivePacket(companion)

        panel.appendChild(makeLabel(220, 4, (companion.name ?? 'Companion') + " — Custom behavior", '#ffff80'))

        for (const btn of CUSTOM_BUTTONS) {
            panel.appendChild(makeGraphicButton(
                btn.x, btn.y, DISPOSITION_BTN_W, DISPOSITION_BTN_H,
                btn.frmUp, btn.frmDn, null,
                false, false,
                () => uiCustomCategoryPicker(companion, btn.category, btn.label, () => { redraw() })
            ))
            // Current value, next to the category button.
            const current = String((packet as any)[btn.category])
            panel.appendChild(makeLabel(btn.x + DISPOSITION_BTN_W + 8, btn.y + 8, current))
        }

        panel.appendChild(makeActionButton(593, 161, close))

        overlay.appendChild(panel)
    }

    redraw()
    overlay.appendChild(panel)

    const keyHandler = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') { e.preventDefault(); close(); document.removeEventListener('keydown', keyHandler, true) }
    }
    document.addEventListener('keydown', keyHandler, true)

    getUiContainer().appendChild(overlay)
}

// ── Per-category value picker (cussel.png) ───────────────────────────────────

/**
 * Text-option list for picking a value within one customization category.
 * CE ref: game_dialog.cc _gdCustomSelect (~line 3966) — CE reuses the normal
 * dialogue option-list rendering here; DH2 uses a small dedicated modal with
 * the same cussel.png background instead, since wiring this through the full
 * dialogue state machine would be substantially more invasive for the same
 * visual result.
 */
function uiCustomCategoryPicker(
    companion: Critter,
    category: CustomAiCategory,
    title: string,
    onDone: () => void
): void {
    const overlay = makeOverlay()
    const W = 444, H = 206
    const panel = makePanel('cussel', W, H)

    function close(): void {
        overlay.remove()
        onDone()
    }

    panel.appendChild(makeLabel(20, 10, title, '#ffff80'))

    const options = CUSTOM_OPTIONS[category] as { value: AiPacket[typeof category]; label: string }[]
    const list = document.createElement('div')
    Object.assign(list.style, { position: 'absolute', left: '20px', top: '40px', width: (W - 40) + 'px' })
    for (const opt of options) {
        const row = document.createElement('div')
        Object.assign(row.style, { cursor: 'pointer', padding: '4px 0' })
        const text = new FoText(font3, opt.label, '#c8b466')
        text.appendTo(row)
        row.addEventListener('mouseenter', () => { text.color = '#fcfc7c' })
        row.addEventListener('mouseleave', () => { text.color = '#c8b466' })
        row.addEventListener('click', () => {
            setCompanionCustomSetting(companion, category, opt.value)
            close()
        })
        list.appendChild(row)
    }
    panel.appendChild(list)

    const keyHandler = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') { e.preventDefault(); close(); document.removeEventListener('keydown', keyHandler, true) }
    }
    document.addEventListener('keydown', keyHandler, true)

    overlay.appendChild(panel)
    getUiContainer().appendChild(overlay)
}
