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

// FO2-CE ref: mainmenu.cc — Fallout 2 main menu with 6 buttons.
//
// Button layout from mainmenu.cc buttonCreate loop:
//   x = 30, y = 19 + index * 42 - index  (41px spacing)
//   Hit area: 26×26px (circular FRM indicator)
//   Label x = 126 (text rendered separately), same y + 1
//
// Keyboard bindings from gMainMenuButtonKeyBindings[]:
//   i = INTRO, n = NEW GAME, l = LOAD GAME, o = OPTIONS, c = CREDITS, e/ESC = EXIT

import { font4 } from './ui_font.js'
import { uiSaveLoad } from './ui_saveload.js'
import globalState from './globalState.js'
import { UIMode } from './ui_panels.js'

// Enum mirrors fallout2-ce MainMenuButton order exactly.
const enum MainMenuButton {
    INTRO = 0,
    NEW_GAME = 1,
    LOAD_GAME = 2,
    OPTIONS = 3,
    CREDITS = 4,
    EXIT = 5,
}

const BUTTON_DEFS: { label: string; key: string }[] = [
    { label: 'INTRO',     key: 'i' },
    { label: 'NEW GAME',  key: 'n' },
    { label: 'LOAD GAME', key: 'l' },
    { label: 'OPTIONS',   key: 'o' },
    { label: 'CREDITS',   key: 'c' },
    { label: 'EXIT',      key: 'e' },
]

// Pixel offset of the 640×480 menu frame inside the viewport-filling overlay.
// Computed dynamically so the menu stays centered as the window resizes.
let overlayElem: HTMLElement | null = null
let frameElem: HTMLElement | null = null

// Callbacks registered by init.ts to avoid circular module imports.
let onNewGame: (() => void) | null = null

export function initMainMenu(newGameCb: () => void): void {
    onNewGame = newGameCb

    // Full-screen overlay that covers everything including the HUD bar.
    overlayElem = document.createElement('div')
    overlayElem.id = 'mainMenuOverlay'
    Object.assign(overlayElem.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        width: '100%',
        height: '100%',
        backgroundColor: '#000',
        zIndex: '1000',
        display: 'none',
    })

    // 640×480 frame centered in the overlay; carries the background art.
    frameElem = document.createElement('div')
    frameElem.id = 'mainMenuFrame'
    Object.assign(frameElem.style, {
        position: 'absolute',
        width: '640px',
        height: '480px',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        backgroundImage: "url('art/intrface/mainmenu.png')",
        backgroundRepeat: 'no-repeat',
        backgroundSize: '640px 480px',
    })
    overlayElem.appendChild(frameElem)

    // Build 6 buttons.
    for (let i = 0; i < BUTTON_DEFS.length; i++) {
        const { label } = BUTTON_DEFS[i]
        const y = 19 + i * 41  // matches mainmenu.cc: 19 + index * 42 - index

        // Circular FRM indicator (26×26 hit area).
        const btn = document.createElement('div')
        Object.assign(btn.style, {
            position: 'absolute',
            left: '30px',
            top: `${y}px`,
            width: '26px',
            height: '26px',
            backgroundImage: "url('art/intrface/menuup.png')",
            backgroundRepeat: 'no-repeat',
            cursor: 'pointer',
            zIndex: '1',
        })

        const idx = i
        btn.onmousedown = () => {
            btn.style.backgroundImage = "url('art/intrface/menudown.png')"
        }
        btn.onmouseup = () => {
            btn.style.backgroundImage = "url('art/intrface/menuup.png')"
        }
        btn.onmouseleave = () => {
            btn.style.backgroundImage = "url('art/intrface/menuup.png')"
        }
        btn.onclick = () => handleButton(idx as MainMenuButton)
        frameElem.appendChild(btn)

        // Label rendered with font4 at x=126, y+1 (matches mainmenu.cc).
        const labelDiv = document.createElement('div')
        Object.assign(labelDiv.style, {
            position: 'absolute',
            left: '126px',
            top: `${y + 1}px`,
            cursor: 'pointer',
            pointerEvents: 'none',
        })
        font4.onLoad(() => {
            const textEl = font4.renderText(label)
            // font4 atlas is gold by default; no filter needed.
            labelDiv.appendChild(textEl)
        })
        frameElem.appendChild(labelDiv)
    }

    // Footer copyright/version text (font1, y≈460 from top of frame).
    const footerLeft = document.createElement('div')
    Object.assign(footerLeft.style, {
        position: 'absolute',
        left: '10px',
        bottom: '10px',
        pointerEvents: 'none',
    })
    font4.onLoad(() => {
        const el = font4.renderText('© 1998 Interplay Productions')
        footerLeft.appendChild(el)
    })
    frameElem.appendChild(footerLeft)

    document.body.appendChild(overlayElem)

    // Keyboard shortcuts from gMainMenuButtonKeyBindings[].
    document.addEventListener('keydown', handleKey)
}

function handleKey(e: KeyboardEvent): void {
    if (!overlayElem || overlayElem.style.display === 'none') return

    switch (e.key.toLowerCase()) {
        case 'i':      handleButton(MainMenuButton.INTRO);     e.preventDefault(); break
        case 'n':      handleButton(MainMenuButton.NEW_GAME);  e.preventDefault(); break
        case 'l':      handleButton(MainMenuButton.LOAD_GAME); e.preventDefault(); break
        case 'o':      handleButton(MainMenuButton.OPTIONS);   e.preventDefault(); break
        case 'c':      handleButton(MainMenuButton.CREDITS);   e.preventDefault(); break
        case 'e':
        case 'escape': handleButton(MainMenuButton.EXIT);      e.preventDefault(); break
    }
}

function handleButton(btn: MainMenuButton): void {
    switch (btn) {
        case MainMenuButton.INTRO:
            // FO2-CE: plays intro movie; stub as no-op when video unavailable.
            console.log('[MainMenu] INTRO: video not implemented')
            break

        case MainMenuButton.NEW_GAME:
            hideMainMenu()
            onNewGame?.()
            break

        case MainMenuButton.LOAD_GAME:
            hideMainMenu()
            uiSaveLoad(false)
            break

        case MainMenuButton.OPTIONS:
            // Options/preferences panel not yet implemented.
            // In-game the same panel is opened via the optionsButton HUD button.
            alert('Preferences not yet implemented.')
            break

        case MainMenuButton.CREDITS:
            // Stub — full credits screen not yet implemented.
            alert('DarkFO\n\nFallout 2 by Black Isle Studios / Interplay')
            break

        case MainMenuButton.EXIT:
            window.close()
            break
    }
}

export function showMainMenu(): void {
    if (!overlayElem) return
    overlayElem.style.display = 'block'
    globalState.uiMode = UIMode.mainMenu
}

export function hideMainMenu(): void {
    if (!overlayElem) return
    overlayElem.style.display = 'none'
    globalState.uiMode = UIMode.none
}

export function isMainMenuVisible(): boolean {
    return !!overlayElem && overlayElem.style.display !== 'none'
}
