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

// Dialogue "Review" modal — scrolls back through everything said so far in
// the current conversation (every NPC line, paired with whichever reply the
// player picked). CE ref: game_dialog.cc:1512 gameDialogReviewButtonOnMouseUp
// -> gameDialogShowReview() -> gameDialogReviewWindowInit/Update (~1300-1600).
//
// Known simplification: CE pages exactly one line of wrapped text per arrow
// click via gameDialogReviewWindowUpdate(win, origin); DH2 nudges a native-
// scrolling list by a fixed pixel amount per click instead — functionally
// equivalent (whole conversation visible, scrollable both by these buttons
// and natively) but not a line-exact port of the original redraw-by-origin
// mechanism. See wiki/known_bugs.md P17/P18.

import { makePanelDraggable } from './ui_drag.js'
import * as Scripting from './scripting.js'
import globalState from './globalState.js'
import { endLips } from './talkingHead.js'
import { getDialogueSpeaker } from './ui_dialogue.js'
import { getUiContainer } from './ui_panels.js'
import { assetUrl } from './modAssets.js'

const SCROLL_STEP_PX = 32

export function uiShowDialogueReview(): void {
    const log = Scripting.getDialogueReviewLog()
    endLips() // the speech stops while the review is open

    // Mounted inside #uiStage and positioned to exactly overlay
    // #dialogueContainer (left:80,top:20,640x480 — ui.css) rather than
    // centering on the full viewport, which doesn't share the same
    // coordinate frame as the 800x600 .ui-stage and was producing a ~40px
    // vertical misalignment against the dialogue background. CE's review
    // window and dialogue background window are centered with the exact
    // same (screenW-640)/2,(screenH-480)/2 formula, i.e. they're meant to
    // overlay precisely.
    const panel = document.createElement('div')
    Object.assign(panel.style, {
        position: 'absolute',
        left: '80px',
        top: '20px',
        width: '640px',
        height: '480px',
        zIndex: '950',
        // CE ref: game_dialog.cc:1314-1321 — FRM 102 (review.frm).
        backgroundImage: "url('" + assetUrl('art/intrface/review.png') + "')",
        backgroundSize: '100% 100%',
        imageRendering: 'pixelated',
    })

    makePanelDraggable(panel, 'dialogueReview')

    // CE ref: game_dialog.cc gameDialogReviewWindowUpdate — text rect (113,76)-(422,418);
    // each entry: "<speaker>:" at x 88 (colour 992), the reply from x 113 (768), then
    // "<dude>:" (21140) and the option (15855). It opens on the oldest entry.
    const list = document.createElement('div')
    Object.assign(list.style, {
        position: 'absolute',
        left: '88px',
        top: '76px',
        width: '334px',
        height: '342px',
        overflowY: 'auto',
        fontSize: '.75em',
    })
    const speakerName = (getDialogueSpeaker()?.name ?? '') + ':'
    const dudeName = (globalState.player?.name ?? '') + ':'
    const line = (text: string, color: string, indent: number): HTMLDivElement => {
        const el = document.createElement('div')
        Object.assign(el.style, { color, paddingLeft: indent + 'px' })
        el.textContent = text
        return el
    }
    const entries: HTMLDivElement[] = []
    for (const entry of log) {
        const box = document.createElement('div')
        box.style.marginBottom = '2px'
        box.appendChild(line(speakerName, '#3cf800', 0))
        box.appendChild(line(entry.reply, '#00a400', 25))
        if (entry.option) {
            box.appendChild(line(dudeName, '#a0a0a0', 0))
            box.appendChild(line(entry.option, '#747474', 25))
        }
        list.appendChild(box)
        entries.push(box)
    }
    panel.appendChild(list)
    // CE: ↑ / ↓ move the first entry shown by one
    let origin = 0
    const showFrom = (i: number) => {
        origin = Math.max(0, Math.min(entries.length - 1, i))
        if (entries[origin]) list.scrollTop = entries[origin].offsetTop
    }

    // CE ref: inventory.cc/game_dialog.cc:296-303 gGameDialogReviewWindowButtonFrmIds —
    // verified against lut/lst/art_intrface.json (the source's own inline
    // comments mislabel which FRM number is "up" vs "down"; the actual FRM
    // IDs resolve to di_bgup1/2 for the scroll-up button and di_bgdn1/2 for
    // scroll-down, matching their filenames' visual content).
    const scrollUpBtn = document.createElement('div')
    Object.assign(scrollUpBtn.style, {
        position: 'absolute',
        left: '475px',
        top: '152px',
        width: '35px',
        height: '35px',
        cursor: 'pointer',
        backgroundImage: "url('" + assetUrl('art/intrface/di_bgup1.png') + "')",
        backgroundSize: '100% 100%',
    })
    scrollUpBtn.addEventListener('mousedown', () => {
        scrollUpBtn.style.backgroundImage = "url('" + assetUrl('art/intrface/di_bgup2.png') + "')"
    })
    scrollUpBtn.addEventListener('mouseup', () => {
        scrollUpBtn.style.backgroundImage = "url('" + assetUrl('art/intrface/di_bgup1.png') + "')"
    })
    scrollUpBtn.addEventListener('mouseleave', () => {
        scrollUpBtn.style.backgroundImage = "url('" + assetUrl('art/intrface/di_bgup1.png') + "')"
    })
    scrollUpBtn.addEventListener('click', () => {
        list.scrollTop -= SCROLL_STEP_PX
    })
    panel.appendChild(scrollUpBtn)

    const scrollDownBtn = document.createElement('div')
    Object.assign(scrollDownBtn.style, {
        position: 'absolute',
        left: '475px',
        top: '191px',
        width: '35px',
        height: '37px',
        cursor: 'pointer',
        backgroundImage: "url('" + assetUrl('art/intrface/di_bgdn1.png') + "')",
        backgroundSize: '100% 100%',
    })
    scrollDownBtn.addEventListener('mousedown', () => {
        scrollDownBtn.style.backgroundImage = "url('" + assetUrl('art/intrface/di_bgdn2.png') + "')"
    })
    scrollDownBtn.addEventListener('mouseup', () => {
        scrollDownBtn.style.backgroundImage = "url('" + assetUrl('art/intrface/di_bgdn1.png') + "')"
    })
    scrollDownBtn.addEventListener('mouseleave', () => {
        scrollDownBtn.style.backgroundImage = "url('" + assetUrl('art/intrface/di_bgdn1.png') + "')"
    })
    scrollDownBtn.addEventListener('click', () => {
        list.scrollTop += SCROLL_STEP_PX
    })
    panel.appendChild(scrollDownBtn)

    // CE ref: game_dialog.cc:1397-1409 — Done button at (499,398), 82x46,
    // di_done1.frm (up)/di_done2.frm (down), key Escape.
    const doneBtn = document.createElement('div')
    Object.assign(doneBtn.style, {
        position: 'absolute',
        left: '499px',
        top: '398px',
        width: '82px',
        height: '46px',
        cursor: 'pointer',
        backgroundImage: "url('" + assetUrl('art/intrface/di_done1.png') + "')",
        backgroundSize: '100% 100%',
    })

    function close(): void {
        panel.remove()
        document.removeEventListener('keydown', keyHandler, true)
    }

    doneBtn.addEventListener('mousedown', () => {
        doneBtn.style.backgroundImage = "url('" + assetUrl('art/intrface/di_done2.png') + "')"
    })
    doneBtn.addEventListener('mouseup', () => {
        doneBtn.style.backgroundImage = "url('" + assetUrl('art/intrface/di_done1.png') + "')"
    })
    doneBtn.addEventListener('mouseleave', () => {
        doneBtn.style.backgroundImage = "url('" + assetUrl('art/intrface/di_done1.png') + "')"
    })
    doneBtn.addEventListener('click', close)
    panel.appendChild(doneBtn)

    const keyHandler = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
            e.preventDefault()
            close()
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            showFrom(origin - 1)
        } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            showFrom(origin + 1)
        }
    }
    document.addEventListener('keydown', keyHandler, true)

    getUiContainer().appendChild(panel)

    list.scrollTop = 0 // CE: gameDialogReviewWindowUpdate(win, 0), the oldest entry first
}
