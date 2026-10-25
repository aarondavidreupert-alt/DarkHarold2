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
// "Use Best Weapon" / "Use Best Armor" follow partyMemberControlWindowHandleEvents
// (keys w / a): _ai_search_inven_weap / _ai_search_inven_armor, then the
// _gdPickAIUpdateMsg reply.

import globalState from './globalState.js'
import { dbg } from './logger.js'
import { Combat } from './combat.js'
import { armorPerkSwap } from './perks.js'
import { ammoGetCapacity, ammoGetQuantity, ammoUseTopBox, findReloadAmmo, weaponReload } from './weaponAmmo.js'
import { getMessage, getProtoMsg } from './util.js'
import { frameCell } from './renderer.js'
import { SKILL_NAMES } from './skills.js'
import { randomBetween } from './random.js'
import { Critter, Obj } from './object.js'
import { UIMode, getUiContainer } from './ui_panels.js'
import { font1, font3 } from './ui_font.js'
import { FoText } from './ui/foText.js'
import { AiPacket, Disposition, findCompanionPacketForDisposition } from './aiPackets.js'
import {
    CustomAiCategory,
    getCompanionEffectivePacket,
    partyMemberSupports,
    setCompanionCustomSetting,
    setCompanionDisposition,
} from './party.js'
import { uiCompanionTrade } from './ui_companion_trade.js'
import { getVisibleDialoguePanel, uiSwapDialoguePanel } from './ui_dialogue.js'
import { $id } from './ui_dom.js'
import { Scripting } from './scripting.js'
import { assetUrl } from './modAssets.js'

// ── Layout constants (verified against game_dialog.cc) ───────────────────────

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
// party.txt key of each Custom category
const CUSTOM_INI_KEY: { [K in CustomAiCategory]: string } = {
    areaAttackMode: 'area_attack_mode', runAwayMode: 'run_away_mode', bestWeapon: 'best_weapon',
    distance: 'distance', attackWho: 'attack_who', chemUse: 'chem_use',
}

const CUSTOM_OPTIONS: { [K in CustomAiCategory]: { value: AiPacket[K]; label: string }[] } = {
    areaAttackMode: [
        { value: 'always', label: "Always! Don't worry about hitting me" },
        { value: 'sometimes', label: "Sometimes, don't worry about hitting me" },
        { value: 'be_sure', label: "Be sure you won't hit me" },
        { value: 'be_careful', label: 'Be careful not to hit me' },
        { value: 'be_absolutely_sure', label: "Be absolutely sure you won't hit me" },
    ],
    runAwayMode: [
        { value: 'coward', label: 'Abject coward' },
        { value: 'finger_hurts', label: 'Your finger hurts' },
        { value: 'bleeding', label: "You're bleeding a bit" },
        { value: 'not_feeling_good', label: 'Not feeling good' },
        { value: 'tourniquet', label: 'You need a tourniquet' },
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

// ── Shared Escape handling ───────────────────────────────────────────────────
//
// Control and Customize both close on Escape, and the user can bounce
// between them (Custom -> Customize -> back -> Control -> Custom -> ...)
// without ever pressing Escape. A naive per-open addEventListener would leak
// one listener per bounce. Instead there's a single document-level listener
// (installed once) that delegates to whichever close callback is currently
// "active" — set by whichever of Control/Customize is on top, cleared
// whenever the player navigates elsewhere (Trade) or the listener fires.

let activeEscapeClose: (() => void) | null = null
let escapeListenerInstalled = false

function setActiveEscapeClose(close: (() => void) | null): void {
    activeEscapeClose = close
    if (escapeListenerInstalled) return
    escapeListenerInstalled = true
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        // the screen's own keys (CE partyMemberControlWindowHandleEvents: W best weapon,
        // A best armor, D trade; the customise screen: Return like Esc)
        const action = activeScreenKeys?.[e.key.length === 1 ? e.key.toLowerCase() : e.key]
        if (action && globalState.uiMode === UIMode.companionControl) { e.preventDefault(); action(); return }
        if (e.key !== 'Escape' || !activeEscapeClose) return
        e.preventDefault()
        const fn = activeEscapeClose
        activeEscapeClose = null
        fn!()
    }, true)
}
let activeScreenKeys: { [key: string]: () => void } | null = null

// ── DOM helpers ────────────────────────────────────────────────────────────────

// Used only by uiCustomCategoryPicker — a genuine floating modal (not part
// of the persistent dialogueContainer panel-slot system), since CE has no
// dedicated window for this either (it reuses the dialogue option list).
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
        backgroundImage: `url('${assetUrl(`art/intrface/${bgImage}.png`)}')`,
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
        backgroundImage: `url('${assetUrl(`art/intrface/${img}.png`)}')`,
        backgroundSize: '100% 100%',
        imageRendering: 'pixelated',
        cursor: disabled ? 'default' : 'pointer',
        pointerEvents: disabled ? 'none' : 'auto',
    })
    if (onClick && !disabled) el.addEventListener('click', onClick)
    return el
}

// CE game_dialog.cc _gdPickAIUpdateMsg: proto.msg 670–674, or 677–678 for the dogs
// (_Dogs: 0x1000088, 0x1000156, 0x1000180). Shown with
// gameDialogRenderSupplementaryMessage in the reply window.
function showAIUpdateMsg(companion: Critter): void {
    const dog = [0x1000088, 0x1000156, 0x1000180].includes(companion.pid)
    const num = dog ? 677 + randomBetween(0, 1) : 670 + randomBetween(0, 4)
    const msg = getProtoMsg(num)
    if (msg) $id('dialogueBoxReply').textContent = msg
}

// CE game_dialog.cc partyMemberControlWindowHandleEvents, key 'w': unwield the right
// hand, wield _ai_search_inven_weap(critter, false, null) there and reload it
// (aiAttemptWeaponReload). Nothing found leaves the hand empty, as in CE.
function useBestWeapon(companion: Critter): boolean {
    const c = companion as any
    const old = c.rightHand
    if (old && old.pid !== undefined) old.flags = ((old.flags ?? 0) & ~0x2000000) >>> 0 // OBJECT_IN_RIGHT_HAND
    c.rightHand = Critter.makeFist()
    const weapon = Combat.aiSearchInvenWeap(companion, null, false)
    if (weapon) {
        ;(weapon as any).flags = (((weapon as any).flags ?? 0) | 0x2000000) >>> 0
        c.rightHand = weapon
        c.activeHand = 'rightHand'
        const cap = ammoGetCapacity(weapon as any)
        if (cap > 0 && ammoGetQuantity(weapon as any) < cap) {
            const ammo = findReloadAmmo(weapon as any, companion.inventory as any)
            if (ammo && weaponReload(weapon as any, ammo as any) === 0) ammoUseTopBox(ammo, companion.inventory)
        }
        dbg('ai', `[Companion] ${companion.name} wields ${weapon.name}`)
        showAIUpdateMsg(companion)
    }
    companion.setIdleArt()
    return true
}

// CE game_dialog.cc partyMemberControlWindowHandleEvents, key 'a': unless the critter
// is PID 0x10000A1, wear _ai_search_inven_armor (OBJECT_WORN, armor perk swap);
// the update message shows either way.
function useBestArmor(companion: Critter): void {
    if (companion.pid !== 0x10000A1) {
        const armor = Combat.aiSearchInvenArmor(companion)
        if (armor) {
            const old = companion.getEquippedArmor()
            if (old) (old as any).flags = (((old as any).flags ?? 0) & ~0x4000000) >>> 0
            ;(armor as any).flags = (((armor as any).flags ?? 0) | 0x4000000) >>> 0 // OBJECT_WORN
            armorPerkSwap(companion, old, armor)
            dbg('ai', `[Companion] ${companion.name} wears ${armor.name}`)
        }
    }
    showAIUpdateMsg(companion)
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
        backgroundImage: "url('" + assetUrl('art/intrface/di_rdbt2.png') + "')",
        backgroundSize: '100% 100%',
        imageRendering: 'pixelated',
        cursor: 'pointer',
    })
    el.addEventListener('mousedown', () => { el.style.backgroundImage = "url('" + assetUrl('art/intrface/di_rdbt1.png') + "')" })
    el.addEventListener('mouseup', () => { el.style.backgroundImage = "url('" + assetUrl('art/intrface/di_rdbt2.png') + "')" })
    el.addEventListener('mouseleave', () => { el.style.backgroundImage = "url('" + assetUrl('art/intrface/di_rdbt2.png') + "')" })
    el.addEventListener('click', onClick)
    return el
}

function makeLabel(x: number, y: number, text: string, color = '#c8b466'): HTMLDivElement {
    const wrap = document.createElement('div')
    Object.assign(wrap.style, { position: 'absolute', left: x + 'px', top: y + 'px', pointerEvents: 'none', lineHeight: '0' })
    new FoText(font1, text, color).appendTo(wrap)
    return wrap
}

// CE partyMemberControlWindowUpdate "Render preview": frame 0 of the standing animation
// facing SW, unscaled, centred at (39, 132) inside the cleared 70×98 box at (8, 84)
function makeStandingPreview(critter: Critter): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = 70
    canvas.height = 98
    Object.assign(canvas.style, { position: 'absolute', left: '8px', top: '84px', imageRendering: 'pixelated', pointerEvents: 'none' })
    const art = (critter as any).getAnimation?.('idle') ?? critter.art
    const info = art ? globalState.imageInfo?.[art] : undefined
    if (!info) return canvas
    const direction = Math.min(3, info.frameOffsets.length - 1) // ROTATION_SW
    const frame = info.frameOffsets[direction]?.[0]
    if (!frame) return canvas
    const { sx, sy } = frameCell(info, direction, 0)
    const draw = (img: HTMLImageElement) => {
        canvas.getContext('2d')?.drawImage(img, sx, sy, frame.w, frame.h,
            39 - 8 - Math.trunc(frame.w / 2), 132 - 84 - Math.trunc(frame.h / 2), frame.w, frame.h)
    }
    const cached = globalState.images?.[art] as HTMLImageElement | undefined
    if (cached?.complete) draw(cached)
    else { const img = new Image(); img.onload = () => draw(img); img.src = assetUrl(art + '.png') }
    return canvas
}

// ── Control window ────────────────────────────────────────────────────────────

/**
 * Open the party member control screen for `companion`.
 * CE ref: game_dialog.cc:3354 partyMemberControlWindowInit.
 */
export function uiCompanionControl(companion: Critter): void {
    globalState.uiMode = UIMode.companionControl

    const panel = $id('companionControlBox')

    // CE ref: game_dialog.cc:3741-3744 — the control screen's Talk button
    // (key Escape) always sets _dialogue_switch_mode=1, returning to the
    // normal dialogue/Talk window, regardless of how Control was entered.
    function close(): void {
        activeEscapeClose = null
        activeScreenKeys = null
        globalState.uiMode = UIMode.dialogue
        uiSwapDialoguePanel(panel, $id('dialogueBox'), () => Scripting.reenterDialogue())
    }

    function redraw(): void {
        // Clear and rebuild — simplest way to keep the live stat readout
        // (HP/AP/weight/equipped gear) and the disposition button rest-states
        // in sync after any action.
        panel.innerHTML = ''
        panel.style.backgroundImage = "url('" + assetUrl('art/intrface/control.png') + "')"
        panel.style.backgroundSize = '100% 100%'
        ;(panel.style as any).imageRendering = 'pixelated'

        // Stat readout. CE ref: game_dialog.cc:3542 partyMemberControlWindowUpdate — font 101,
        // green: right-hand item (or proto.msg 10) at (112,20), worn armor at (112,49), the
        // standing SW sprite centred at (39,132), HP (240,96), best skill (240,113), weight
        // (240,131, red when encumbered), melee damage (240,148), AP (240,167). (control.png
        // carries the captions.)
        const GREEN = '#00f800'
        const none = getProtoMsg(10) ?? 'None'
        const right = (companion as any).rightHand
        const rightItem = right && right.pid !== undefined ? right : null
        const armor = companion.getEquippedArmor?.()
        panel.appendChild(makeLabel(112, 20, rightItem?.name ?? none, GREEN))
        panel.appendChild(makeLabel(112, 49, armor?.name ?? none, GREEN))
        panel.appendChild(makeStandingPreview(companion))
        panel.appendChild(makeLabel(240, 96, `${companion.getStat('HP')}/${companion.getStat('Max HP')}`, GREEN))
        let bestSkill = 0, bestValue = 0 // CE partyMemberGetBestSkill
        SKILL_NAMES.forEach((name, i) => { const v = companion.getSkill(name); if (v > bestValue) { bestValue = v; bestSkill = i } })
        panel.appendChild(makeLabel(240, 113, getMessage('skill', 100 + bestSkill) ?? SKILL_NAMES[bestSkill], GREEN))
        const weight = companion.getInventoryWeight()
        const carry = companion.getStat('Carry')
        panel.appendChild(makeLabel(240, 131, `${weight}/${carry}`, weight > carry ? '#f80000' : GREEN))
        panel.appendChild(makeLabel(240, 148, String(companion.getStat('Melee')), GREEN))
        const maxAP = companion.getStat('AP')
        const ap = globalState.inCombat ? ((companion as any).AP?.getAvailableCombatAP?.() ?? maxAP) : maxAP
        panel.appendChild(makeLabel(240, 167, `${ap}/${maxAP}`, GREEN))

        const packet = getCompanionEffectivePacket(companion)

        // Action buttons — CE ref: game_dialog.cc:3388-3418.
        panel.appendChild(makeActionButton(593, 41, close))
        panel.appendChild(makeActionButton(593, 97, () => {
            // CE ref: game_dialog.cc:3757-3762 — Trade transitions straight
            // from Control to the barter window, no intermediate return to
            // dialogue (the barter window itself always exits back to Talk —
            // _barter_end_to_talk_to, game_dialog.cc:3178-3186 — not back to
            // Control, even though it was entered from here).
            activeEscapeClose = null
            uiCompanionTrade(companion)
        }))
        panel.appendChild(makeActionButton(236, 15, () => {
            if (useBestWeapon(companion)) redraw()
        }))
        panel.appendChild(makeActionButton(235, 46, () => {
            useBestArmor(companion)
            redraw()
        }))

        // Disposition buttons.
        for (const btn of DISPOSITION_BUTTONS) {
            // CE partyMemberControlWindowInit: a disposition party.txt doesn't list is disabled
            const supported = packet.disposition === btn.disposition
                || (partyMemberSupports(companion, 'disposition', btn.disposition)
                    && (btn.disposition === 'custom' || !!findSiblingPreview(companion, btn.disposition)))
            panel.appendChild(makeGraphicButton(
                DISPOSITION_BTN_X, btn.y, DISPOSITION_BTN_W, DISPOSITION_BTN_H,
                btn.frmBase + 'up', btn.frmBase + 'dn', btn.frmBase + 'off',
                packet.disposition === btn.disposition, !supported,
                () => {
                    if (btn.disposition === 'custom') {
                        setCompanionDisposition(companion, 'custom')
                        // CE ref: game_dialog.cc:3730-3734 — Custom transitions
                        // straight from Control to Customize, no return to
                        // dialogue in between (Customize's own exit returns to
                        // Control — game_dialog.cc:3968-3971).
                        uiCompanionCustomize(companion)
                        return
                    }
                    setCompanionDisposition(companion, btn.disposition)
                    redraw()
                }
            ))
        }
    }

    redraw()
    uiSwapDialoguePanel(getVisibleDialoguePanel(), panel)
    setActiveEscapeClose(close)
    activeScreenKeys = {
        w: () => { if (useBestWeapon(companion)) redraw() },
        a: () => { useBestArmor(companion); redraw() },
        d: () => { activeEscapeClose = null; activeScreenKeys = null; uiCompanionTrade(companion) },
    }
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
export function uiCompanionCustomize(companion: Critter): void {
    globalState.uiMode = UIMode.companionControl

    const panel = $id('companionCustomizeBox')

    // CE ref: game_dialog.cc:3968-3971 — Customize's Escape/Enter always
    // returns to Control (_dialogue_switch_mode=8), never straight to dialogue.
    function close(): void {
        activeEscapeClose = null
        uiSwapDialoguePanel(panel, $id('companionControlBox'), () => uiCompanionControl(companion))
    }

    function redraw(): void {
        panel.innerHTML = ''
        panel.style.backgroundImage = "url('" + assetUrl('art/intrface/custom.png') + "')"
        panel.style.backgroundSize = '100% 100%'
        ;(panel.style as any).imageRendering = 'pixelated'

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
    }

    redraw()
    uiSwapDialoguePanel(getVisibleDialoguePanel(), panel)
    setActiveEscapeClose(close)
    activeScreenKeys = { Enter: () => { activeScreenKeys = null; close() } } // CE: Return like Esc
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

    // Suspend the shared Customize-screen Escape handler while this modal is
    // open so a single Escape press doesn't close both at once; restore it
    // once the modal is gone.
    const savedEscapeClose = activeEscapeClose
    activeEscapeClose = null

    function close(): void {
        overlay.remove()
        activeEscapeClose = savedEscapeClose
        onDone()
    }

    panel.appendChild(makeLabel(20, 10, title, '#ffff80'))

    const options = CUSTOM_OPTIONS[category] as { value: AiPacket[typeof category]; label: string }[]
    const list = document.createElement('div')
    Object.assign(list.style, { position: 'absolute', left: '20px', top: '40px', width: (W - 40) + 'px' })
    for (const opt of options) {
        // CE _gdCustomSelect: values party.txt doesn't list are greyed and refused
        const allowed = partyMemberSupports(companion, CUSTOM_INI_KEY[category], String(opt.value))
        const row = document.createElement('div')
        Object.assign(row.style, { cursor: allowed ? 'pointer' : 'default', padding: '4px 0' })
        const text = new FoText(font3, opt.label, allowed ? '#c8b466' : '#606060')
        text.appendTo(row)
        if (!allowed) { list.appendChild(row); continue }
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
