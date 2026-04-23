// Copyright 2026 darkf
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Stub character creator — shown when NEW GAME is selected from the main menu.
// Will be replaced with a full SPECIAL + trait + tag-skill selection screen.

import globalState from './globalState.js'
import { UIMode } from './ui_panels.js'

let ccElem: HTMLElement | null = null
let onDone: (() => void) | null = null
let onBack: (() => void) | null = null

export function initCharacterCreator(doneCb: () => void, backCb: () => void): void {
    onDone = doneCb
    onBack = backCb

    ccElem = document.createElement('div')
    ccElem.id = 'characterCreatorOverlay'
    Object.assign(ccElem.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        width: '100%',
        height: '100%',
        backgroundColor: '#000',
        zIndex: '1000',
        display: 'none',
        color: '#FFD700',
        fontFamily: 'monospace',
        fontSize: '24px',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '32px',
    })

    const title = document.createElement('div')
    title.textContent = 'CHARACTER CREATOR (WIP)'
    ccElem.appendChild(title)

    const doneBtn = document.createElement('button')
    doneBtn.textContent = 'DONE (Start Game)'
    Object.assign(doneBtn.style, {
        padding: '12px 32px',
        fontSize: '18px',
        cursor: 'pointer',
        backgroundColor: '#3a2800',
        color: '#FFD700',
        border: '2px solid #FFD700',
    })
    doneBtn.onclick = () => {
        hideCharacterCreator()
        onDone?.()
    }
    ccElem.appendChild(doneBtn)

    const backBtn = document.createElement('button')
    backBtn.textContent = 'BACK TO MAIN MENU'
    Object.assign(backBtn.style, {
        padding: '8px 24px',
        fontSize: '14px',
        cursor: 'pointer',
        backgroundColor: '#1a1000',
        color: '#806814',
        border: '1px solid #806814',
    })
    backBtn.onclick = () => {
        hideCharacterCreator()
        onBack?.()
    }
    ccElem.appendChild(backBtn)

    document.body.appendChild(ccElem)

    document.addEventListener('keydown', (e) => {
        if (!ccElem || ccElem.style.display === 'none') return
        if (e.key === 'Escape') {
            hideCharacterCreator()
            onBack?.()
            e.preventDefault()
        }
    })
}

export function showCharacterCreator(): void {
    if (!ccElem) return
    ccElem.style.display = 'flex'
    globalState.uiMode = UIMode.characterCreator
}

export function hideCharacterCreator(): void {
    if (!ccElem) return
    ccElem.style.display = 'none'
    globalState.uiMode = UIMode.none
}
