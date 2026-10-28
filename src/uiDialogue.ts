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

// Dialogue panel: NPC dialogue reply text + selectable dialogue options,
// pop-up animation for the dialogueBox. Also exports uiAnimateBox, the
// generic CSS-transition helper used by the barter pop-up.

import { stopTalkingHead } from './talkingHead.js'
import { world } from './state/world.js'
import { uiState } from './state/uiState.js'
import { view } from './state/view.js'
import * as Events from './events.js'
import { Critter } from './object.js'
import { objectBoundingBox } from './renderer.js'
import { clampCameraPosition, getCenterTile, tileScrollTo } from './render/camera.js'
import type { Point } from './geometry.js'
import * as Scripting from './scripting.js'
import { UIMode } from './uiMode.js'
import { $id } from './uiDom.js'
import { uiBarterMode } from './uiBarter.js'
import { uiCompanionTrade } from './uiCompanionTrade.js'
import { uiCompanionControl } from './uiCompanion.js'
import { setIndicatorBarHidden } from './uiHud.js'
import { getProtoMsg } from './util.js'
import { uiShowDialogueReview } from './uiDialogueReview.js'
import { assetUrl } from './modAssets.js'

// Smoothly transition an element's top property from an origin to a target
// position over a duration. Used for the dialogue / barter slide-up animation.
export function uiAnimateBox($el: HTMLElement, origin: number | null, target: number, callback?: () => void): void {
    const style = $el.style

    // Reset to origin, instantly
    if (origin !== null) {
        style.transition = 'none'
        style.top = `${origin}px`
    }

    // We need to wait for the browser to process the updated CSS position, so we need to wait here
    setTimeout(() => {
        // Set up our transition finished callback if necessary
        if (callback) {
            let listener = () => {
                callback()
                $el.removeEventListener('transitionend', listener)
                ;(listener as any) = null // Allow listener to be GC'd
            }

            $el.addEventListener('transitionend', listener)
        }

        // Ease into the target position over 1 second
        $el.style.transition = 'top 1s ease'
        $el.style.top = `${target}px`
    }, 1)
}

/**
 * Persistent dialogue-window action buttons. CE ref: game_dialog.cc:4357-4388
 * _gdialog_window_create — Barter (always present) and, only when talking to
 * a party member, Combat Control are buttons on the window chrome itself,
 * not dialogue-list options, and the background frame swaps between
 * di_talk.frm (regular NPC) / di_talkp.frm (party member) (line 4328-4330).
 */
// CE game_dialog.cc _gdialogUpdatePartyStatus: recruited or dismissed in the middle of a
// dialogue, the speaker's window is rebuilt — di_talkp with Combat Control, or di_talk
let dialogueSpeaker: Critter | undefined
/** The critter the current dialogue is with (CE gGameDialogSpeaker). */
export function getDialogueSpeaker(): Critter | undefined {
    return dialogueSpeaker
}
Events.on('partyChanged', () => {
    if (dialogueSpeaker && $id('dialogueBox').style.visibility === 'visible')
        setupDialogueActionButtons(dialogueSpeaker)
})

function setupDialogueActionButtons(target: Critter | undefined): void {
    dialogueSpeaker = target
    const $barterBtn = $id('dialogueBarterButton')
    const $controlBtn = $id('dialogueCombatControlButton')
    $id('dialogueReviewButton').onclick = () => uiShowDialogueReview()

    if (!target) {
        $barterBtn.style.display = 'none'
        $controlBtn.style.display = 'none'
        $id('dialogueBox').style.backgroundImage = "url('" + assetUrl('art/intrface/di_talk.png') + "')"
        return
    }

    const isPartyMember = world.gParty.isPartyMember(target)
    const proFlags = target.pro?.extra?.flags ?? 0
    // CE ref: game_dialog.cc:3662 _gdCanBarter — CRITTER_BARTER flag (0x02).
    const canBarter = (proFlags & 0x02) !== 0

    $id('dialogueBox').style.backgroundImage =
        `url('${assetUrl(`art/intrface/${isPartyMember ? 'di_talkp' : 'di_talk'}.png`)}')`

    $barterBtn.style.display = ''
    $barterBtn.onclick = () => {
        if (canBarter) {
            if (isPartyMember) uiCompanionTrade(target)
            else uiBarterMode(target)
        } else {
            // CE ref: game_dialog.cc:4297-4304 gameDialogBarterButtonUpMouseUp —
            // message 903 ("This person will not barter with you") for
            // regular NPCs, 913 ("This critter can't carry anything") for
            // party members, both from proto.msg (gProtoMessageList).
            uiSetDialogueReply(getProtoMsg(isPartyMember ? 913 : 903) ?? '') // CE gameDialogRenderSupplementaryMessage
        }
    }

    // NOTE: CSS gives #dialogueCombatControlButton a stylesheet-level
    // `display: none` default (since it's hidden for most NPCs); clearing
    // the inline style with '' falls back to that stylesheet rule rather
    // than showing it, so showing it must use an explicit non-none value.
    $controlBtn.style.display = isPartyMember ? 'block' : 'none'
    if (isPartyMember) {
        $controlBtn.onclick = () => uiCompanionControl(target)
    }
}

/**
 * Player caps readout. CE ref: game_dialog.cc:1828-1853 gameDialogRenderCaps,
 * called both on dialogue window init (:2374) and — per an upstream SFALL
 * fix — after returning from Barter/Combat Control (:2821), since those
 * screens redraw over the same window area. DH2's equivalent of "redraw
 * after returning" falls out naturally: Scripting.reenterDialogue() always
 * re-runs talk_p_proc -> start_gdialog -> uiStartDialogue, so updating it
 * here covers both CE call sites with one hook.
 */
// CE game_dialog.cc gameDialogRenderCaps: itemGetTotalCaps — carried bags count too
function updateDialogueCaps(): void {
    $id('dialogueCapsDisplay').textContent = '$' + Scripting.itemGetTotalCaps(world.player!)
}

export function uiStartDialogue(force: boolean, target?: Critter) {
    if (uiState.uiMode === UIMode.barter && force !== true) {
        return
    }
    setIndicatorBarHidden(true) // CE _gdialogInitFromScript

    uiState.uiMode = UIMode.dialogue
    $id('dialogueContainer').style.visibility = 'visible'
    const $dialogueBox = $id('dialogueBox')
    // start_gdialog() (scripting.ts) calls this unconditionally every time
    // talk_p_proc runs — including when re-entering via
    // Scripting.reenterDialogue() after a Barter/Trade/Combat-Control
    // round-trip, where #dialogueBox was already slid back into place a
    // moment ago. Re-animating in that case snapped it back to the 480
    // origin and replayed the slide, producing a visible double-animation.
    // Only (re)animate from scratch if it isn't already showing.
    const alreadyShowing = $dialogueBox.style.visibility === 'visible'
    $dialogueBox.style.visibility = 'visible'
    if (!alreadyShowing) {
        uiAnimateBox($dialogueBox, 480, 290)
    }

    setupDialogueActionButtons(target)
    updateDialogueCaps()

    // Center around the dialogue target — but only on a genuinely fresh
    // dialogue entry, not when start_gdialog() re-fires this on
    // reenterDialogue() (Barter/Trade/Combat-Control return). DH2 doesn't
    // pause world ticking during dialogue the way CE's modal dialogue loop
    // does, so a companion can drift a hex via followPlayer() while a
    // sub-screen was open; recentering on its now-shifted position produced
    // a visible camera jump on return that CE doesn't have (CE only
    // centers once, at gameDialogEnter, and the world is frozen the whole
    // time besides).
    if (!target || alreadyShowing) {
        return
    }
    // CE gameDialogEnter: the centre tile and the dude's tile, for the exit
    const p = world.player
    dialogueReturn = { center: getCenterTile(), dudeTile: p ? { ...p.position } : null }
    const bbox = objectBoundingBox(target)
    if (bbox !== null) {
        const dc = $id('dialogueContainer')
        // alternatively: dc.offset().left - $(heart.canvas).offset().left
        const dx = ((dc.offsetWidth / 2) | 0) + dc.offsetLeft
        const dy = ((dc.offsetHeight / 4) | 0) + dc.offsetTop - ((bbox.h / 2) | 0)
        // dx/dy are HTML-layout (screen) pixels; divide by zoom so the
        // resulting camera offset is in world units (which is what
        // cameraPosition is stored in).
        const z = view.cameraZoom || 1.0
        view.cameraPosition.x = bbox.x - dx / z
        view.cameraPosition.y = bbox.y - dy / z
        // CE _gdialogInitFromScript → _tile_scroll_to(speaker, 2): the scroll limits hold
        clampCameraPosition()
    }
}

// CE gGameDialogOldCenterTile / gGameDialogOldDudeTile
let dialogueReturn: { center: Point; dudeTile: Point | null } | null = null

export function uiEndDialogue() {
    // TODO: Transition the dialogue box down?
    uiState.uiMode = UIMode.none
    setIndicatorBarHidden(false) // CE _gdialogExitFromScript
    // CE _gdialogExitFromScript: back to the centre tile the dialogue started from — the
    // dude's if he moved meanwhile
    if (dialogueReturn) {
        const p = world.player
        const moved =
            p &&
            dialogueReturn.dudeTile &&
            (p.position.x !== dialogueReturn.dudeTile.x || p.position.y !== dialogueReturn.dudeTile.y)
        tileScrollTo(moved ? p.position : dialogueReturn.center) // _tile_scroll_to(…, 2)
        dialogueReturn = null
    }
    stopTalkingHead() // CE _gdialogExitFromScript: head window + music

    $id('dialogueContainer').style.visibility = 'hidden'
    $id('dialogueBox').style.visibility = 'hidden'
    $id('dialogueBoxReply').innerHTML = ''
    $id('dialogueBarterButton').style.display = 'none'
    $id('dialogueCombatControlButton').style.display = 'none'
}

// CE _gdProcess: a reply too long for its window turns to the next page every 10 s
let replyPageTimer: number | null = null

export function uiSetDialogueReply(reply: string) {
    const $dialogueBoxReply = $id('dialogueBoxReply')
    // as text: .msg lines such as "<cough> <cough>" or "<zzzt>" are not markup (CE draws them as is)
    $dialogueBoxReply.textContent = reply
    $dialogueBoxReply.scrollTop = 0
    if (replyPageTimer !== null) clearInterval(replyPageTimer)
    replyPageTimer = window.setInterval(() => {
        const $r = $id('dialogueBoxReply')
        const atEnd = $r.scrollTop + $r.clientHeight >= $r.scrollHeight - 1
        if (atEnd || uiState.uiMode !== UIMode.dialogue) {
            if (replyPageTimer !== null) clearInterval(replyPageTimer)
            replyPageTimer = null
            return
        }
        $r.scrollTop += Math.max(1, $r.clientHeight)
    }, 10000)

    $id('dialogueBoxTextArea').innerHTML = ''
}

/**
 * Slide the currently-visible bottom dialogue-area panel ($hide — dialogueBox /
 * barterBox / companion control/customize box) down and out, then slide
 * $show up into place. #dialogueContainer (the persistent portrait/"TV
 * screen" background) is never touched, so it stays visible throughout —
 * mirrors CE's single shared subwindow slot (gGameDialogWindow) under the
 * persistent background window (gGameDialogBackgroundWindow), confirmed via
 * game_dialog.cc:3217,3371,3811 all reading from the same background buffer.
 */
export function uiSwapDialoguePanel($hide: HTMLElement | null, $show: HTMLElement, after?: () => void): void {
    const doShow = () => {
        $show.style.display = ''
        $show.style.visibility = 'visible'
        uiAnimateBox($show, 480, 290, after)
    }
    if ($hide && $hide.style.visibility === 'visible') {
        uiAnimateBox($hide, null, 480, () => {
            $hide.style.visibility = 'hidden'
            doShow()
        })
    } else {
        doShow()
    }
}

// The full set of mutually-exclusive 640x190 panels that occupy the bottom
// slot inside #dialogueContainer. Used by uiSwapDialoguePanel callers that
// don't statically know which one is currently showing (e.g. trade can be
// reached either from the dialogue [Barter] option or from the companion
// control screen's own Trade button).
const DIALOGUE_PANEL_IDS = ['dialogueBox', 'barterBox', 'companionControlBox', 'companionCustomizeBox']

/** Returns whichever of the dialogue-area bottom panels is currently visible, if any. */
export function getVisibleDialoguePanel(): HTMLElement | null {
    for (const id of DIALOGUE_PANEL_IDS) {
        const el = $id(id)
        if (el.style.visibility === 'visible') return el
    }
    return null
}

// CE game_dialog.cc gameDialogRenderOptions / _gdialog_highlight colours: options green
// (_colorTable[992]), the one under the mouse yellow (32747). With the Empathy perk the
// option's reaction shows: good blue (31) / hovered magenta (31775), bad red (31744) /
// hovered light red (32074), neutral as usual.
const OPTION_COLOR = {
    normal: '#00F800',
    hover: '#F8F858',
    good: '#0000F8',
    goodHover: '#F800F8',
    bad: '#F80000',
    badHover: '#F85050',
}

// CE game_dialog.cc _gdProcess keys: 1-9 pick option n (0 ignored, sfall fix), B the
// Barter button
let dialogueKeysInstalled = false
function installDialogueKeys(): void {
    if (dialogueKeysInstalled) return
    dialogueKeysInstalled = true
    window.addEventListener('keydown', (e: KeyboardEvent) => {
        if (uiState.uiMode !== UIMode.dialogue || e.ctrlKey || e.altKey || e.metaKey) return
        if ($id('dialogueBox').style.visibility === 'hidden') return
        const k = e.key.toLowerCase()
        if (k >= '1' && k <= '9') {
            const options = $id('dialogueBoxTextArea').children
            const option = options[Number(k) - 1] as HTMLElement | undefined
            option?.click()
        } else if (k === 'b') {
            const $barter = $id('dialogueBarterButton')
            if ($barter.style.display !== 'none') $barter.click()
        } else if (k === 'arrowup' || k === 'arrowdown' || k === ' ') {
            // CE _gdProcess: a reply too long for its window pages with Up / Down and Space
            const $reply = $id('dialogueBoxReply')
            const page = Math.max(1, $reply.clientHeight)
            $reply.scrollTop += k === 'arrowup' ? -page : page
        } else return
        e.preventDefault()
    })
}

export function uiAddDialogueOption(msg: string, optionID: number, reaction = 50) {
    installDialogueKeys()
    const item = document.createElement('div')
    item.textContent = `\u2022 ${msg}` // CE "%c %s" with '\x95' (cp1252 bullet)
    item.style.cursor = 'pointer'
    const empathy = !!world.player?.hasPerk?.('Empathy')
    const normal =
        empathy && reaction === 49
            ? OPTION_COLOR.good
            : empathy && reaction === 51
              ? OPTION_COLOR.bad
              : OPTION_COLOR.normal
    const hover =
        empathy && reaction === 49
            ? OPTION_COLOR.goodHover
            : empathy && reaction === 51
              ? OPTION_COLOR.badHover
              : OPTION_COLOR.hover
    item.style.color = normal
    item.onmouseenter = () => {
        item.style.color = hover
    }
    item.onmouseleave = () => {
        item.style.color = normal
    }
    item.onclick = () => Scripting.dialogueReply(optionID)
    $id('dialogueBoxTextArea').appendChild(item)
}
