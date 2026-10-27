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

import { createOverlay, removeOverlay, showCredits } from './endgame/slideRender.js'
import { changeBrightness, openPrefsPanel } from './ui_options.js'
import { gameMovieFadeOut, gameMoviePlay, GAME_MOVIE_STOP_MUSIC, MOVIE_CREDITS, MOVIE_INTRO } from './gameMovie.js'
import { font0, font4 } from './ui_font.js'
import { getMessage } from './util.js'

// CE mainmenu.cc main_menu_play_sound: nmselec0 on a button press, nmselec1 on a choice
function menuSound(name: string): void {
    globalState.audioEngine?.playSfxByName?.(name)
}
// _colorTable[21091] (palette 60), the menu's text colour
const MENU_TEXT = '#b89c28'
import { uiSaveLoad } from './ui_saveload.js'
import globalState from './globalState.js'
import { UIMode } from './uiMode.js'
import { assetUrl } from './modAssets.js'

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
    { label: 'INTRO', key: 'i' },
    { label: 'NEW GAME', key: 'n' },
    { label: 'LOAD GAME', key: 'l' },
    { label: 'OPTIONS', key: 'o' },
    { label: 'CREDITS', key: 'c' },
    { label: 'EXIT', key: 'e' },
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
        backgroundImage: "url('" + assetUrl('art/intrface/mainmenu.png') + "')",
        backgroundRepeat: 'no-repeat',
        backgroundSize: '640px 480px',
    })
    overlayElem.appendChild(frameElem)

    // Build 6 buttons.
    for (let i = 0; i < BUTTON_DEFS.length; i++) {
        const { label } = BUTTON_DEFS[i]
        const y = 19 + i * 41 // matches mainmenu.cc: 19 + index * 42 - index

        // Circular FRM indicator (26×26 hit area).
        const btn = document.createElement('div')
        Object.assign(btn.style, {
            position: 'absolute',
            left: '30px',
            top: `${y}px`,
            width: '26px',
            height: '26px',
            backgroundImage: "url('" + assetUrl('art/intrface/menuup.png') + "')",
            backgroundRepeat: 'no-repeat',
            cursor: 'pointer',
            zIndex: '1',
        })

        const idx = i
        btn.onmousedown = () => {
            btn.style.backgroundImage = "url('" + assetUrl('art/intrface/menudown.png') + "')"
            menuSound('nmselec0')
        }
        btn.onmouseup = () => {
            btn.style.backgroundImage = "url('" + assetUrl('art/intrface/menuup.png') + "')"
        }
        btn.onmouseleave = () => {
            btn.style.backgroundImage = "url('" + assetUrl('art/intrface/menuup.png') + "')"
        }
        btn.onclick = () => {
            menuSound('nmselec1')
            handleButton(idx as MainMenuButton)
        }
        frameElem.appendChild(btn)

        // CE mainmenu.cc: misc.msg 9 + index in font 104, centred on x 126 at y + 1
        const labelDiv = document.createElement('div')
        Object.assign(labelDiv.style, {
            position: 'absolute',
            left: '26px',
            width: '200px',
            display: 'flex',
            justifyContent: 'center',
            top: `${y + 1}px`,
            cursor: 'pointer',
            pointerEvents: 'none',
        })
        font4.onLoad(() => {
            const textEl = font4.renderText(getMessage('misc', 9 + i) ?? label)
            // font4 atlas is gold by default; no filter needed.
            labelDiv.appendChild(textEl)
        })
        frameElem.appendChild(labelDiv)
    }

    // CE mainmenu.cc: font 100, colour 21091 — the copyright (misc.msg 20) at (15, 460), the
    // version ("FALLOUT II 1.02", versionGetVersion) ending at x 615
    const footerLeft = document.createElement('div')
    Object.assign(footerLeft.style, { position: 'absolute', left: '15px', top: '460px', pointerEvents: 'none' })
    const footerRight = document.createElement('div')
    Object.assign(footerRight.style, { position: 'absolute', right: '25px', top: '460px', pointerEvents: 'none' })
    font0.onLoad(() => {
        footerLeft.appendChild(
            font0.renderText(
                getMessage('misc', 20) ?? 'Copyright(c) 1998 Interplay Productions.  All rights reserved.',
                MENU_TEXT,
            ),
        )
        footerRight.appendChild(font0.renderText('FALLOUT II 1.02', MENU_TEXT))
    })
    frameElem.appendChild(footerLeft)
    frameElem.appendChild(footerRight)

    document.body.appendChild(overlayElem)

    // Keyboard shortcuts from gMainMenuButtonKeyBindings[].
    document.addEventListener('keydown', handleKey)
}

let shiftHeld = false
document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') shiftHeld = true
})
document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') shiftHeld = false
})

function handleKey(e: KeyboardEvent): void {
    if (!overlayElem || overlayElem.style.display === 'none') return

    // CE mainmenu.cc: + / - change the brightness; a button key sounds nmselec1
    if (e.key === '+' || e.key === '=') {
        changeBrightness(1)
        e.preventDefault()
        return
    }
    if (e.key === '-' || e.key === '_') {
        changeBrightness(-1)
        e.preventDefault()
        return
    }
    if (['i', 'n', 'l', 'o', 'c', 'e', 'escape'].includes(e.key.toLowerCase())) menuSound('nmselec1')

    switch (e.key.toLowerCase()) {
        case 'i':
            handleButton(MainMenuButton.INTRO)
            e.preventDefault()
            break
        case 'n':
            handleButton(MainMenuButton.NEW_GAME)
            e.preventDefault()
            break
        case 'l':
            handleButton(MainMenuButton.LOAD_GAME)
            e.preventDefault()
            break
        case 'o':
            handleButton(MainMenuButton.OPTIONS)
            e.preventDefault()
            break
        case 'c':
            handleButton(MainMenuButton.CREDITS)
            e.preventDefault()
            break
        case 'e':
        case 'escape':
            handleButton(MainMenuButton.EXIT)
            e.preventDefault()
            break
    }
}

function handleButton(btn: MainMenuButton): void {
    switch (btn) {
        case MainMenuButton.INTRO:
            // CE main.cc:105 — gameMoviePlay(MOVIE_INTRO, STOP_MUSIC) then MOVIE_CREDITS.
            hideMainMenu()
            void gameMoviePlay(MOVIE_INTRO, GAME_MOVIE_STOP_MUSIC)
                .then(() => gameMoviePlay(MOVIE_CREDITS, 0))
                .then(() => showMainMenu())
            break

        case MainMenuButton.NEW_GAME:
            hideMainMenu()
            onNewGame?.()
            break

        case MainMenuButton.LOAD_GAME:
            hideMainMenu()
            uiSaveLoad(false, false, () => showMainMenu()) // CE main.cc:151-186: the menu resumes
            break

        case MainMenuButton.OPTIONS:
            // CE main.cc:197 — doPreferences(true): the preferences screen only.
            openPrefsPanel(true)
            break

        case MainMenuButton.CREDITS:
            // CE main.cc:202 — creditsOpen("credits.txt", -1, false); with Shift held
            // (MAIN_MENU_QUOTES) creditsOpen("quotes.txt", -1, true)
            hideMainMenu()
            void (async () => {
                const overlay = createOverlay()
                if (shiftHeld) await showCredits(overlay, 'quotes.txt', true)
                else await showCredits(overlay)
                removeOverlay()
                showMainMenu()
            })()
            break

        case MainMenuButton.EXIT:
            window.close()
            break
    }
}

export function showMainMenu(): void {
    if (!overlayElem) return
    gameMovieFadeOut() // the menu fades in its own palette (after IPLOGO's FADE_IN)
    overlayElem.style.display = 'block'
    globalState.uiMode = UIMode.mainMenu
    // CE main.cc main menu loop: _gsound_background_play_level_music("07desert") each time
    // the menu shows (a new game or a load replaces it with the map's music)
    globalState.audioEngine.playMusic('07desert')
}

export function hideMainMenu(): void {
    if (!overlayElem) return
    overlayElem.style.display = 'none'
    globalState.uiMode = UIMode.none
}

export function isMainMenuVisible(): boolean {
    return !!overlayElem && overlayElem.style.display !== 'none'
}
