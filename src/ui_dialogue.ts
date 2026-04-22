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

import globalState from './globalState.js'
import { Critter } from './object.js'
import { objectBoundingBox } from './renderer.js'
import { Scripting } from './scripting.js'
import { UIMode } from './ui_panels.js'

function $id(id: string): HTMLElement {
    return document.getElementById(id)!
}

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

export function uiStartDialogue(force: boolean, target?: Critter) {
    if (globalState.uiMode === UIMode.barter && force !== true) {
        return
    }

    globalState.uiMode = UIMode.dialogue
    $id('dialogueContainer').style.visibility = 'visible'
    $id('dialogueBox').style.visibility = 'visible'
    uiAnimateBox($id('dialogueBox'), 480, 290)

    // center around the dialogue target
    if (!target) {
        return
    }
    const bbox = objectBoundingBox(target)
    if (bbox !== null) {
        const dc = $id('dialogueContainer')
        // alternatively: dc.offset().left - $(heart.canvas).offset().left
        const dx = ((dc.offsetWidth / 2) | 0) + dc.offsetLeft
        const dy = ((dc.offsetHeight / 4) | 0) + dc.offsetTop - ((bbox.h / 2) | 0)
        // dx/dy are HTML-layout (screen) pixels; divide by zoom so the
        // resulting camera offset is in world units (which is what
        // cameraPosition is stored in).
        const z = globalState.cameraZoom || 1.0
        globalState.cameraPosition.x = bbox.x - dx / z
        globalState.cameraPosition.y = bbox.y - dy / z
    }
}

export function uiEndDialogue() {
    // TODO: Transition the dialogue box down?
    globalState.uiMode = UIMode.none

    $id('dialogueContainer').style.visibility = 'hidden'
    $id('dialogueBox').style.visibility = 'hidden'
    $id('dialogueBoxReply').innerHTML = ''
}

export function uiSetDialogueReply(reply: string) {
    const $dialogueBoxReply = $id('dialogueBoxReply')
    $dialogueBoxReply.innerHTML = reply
    $dialogueBoxReply.scrollTop = 0

    $id('dialogueBoxTextArea').innerHTML = ''
}

export function uiAddDialogueOption(msg: string, optionID: number) {
    const item = document.createElement('div')
    item.textContent = `- ${msg}`
    item.style.cursor = 'pointer'
    item.onclick = () => Scripting.dialogueReply(optionID)
    $id('dialogueBoxTextArea').appendChild(item)
}
