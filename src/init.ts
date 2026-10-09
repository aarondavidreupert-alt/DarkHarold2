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

import { randomSeedPrerandom } from './random.js'
import { gameMoviePlay, GAME_MOVIE_FADE_IN, GAME_MOVIE_STOP_MUSIC, MOVIE_CREDITS, MOVIE_ELDER, MOVIE_INTRO, MOVIE_IPLOGO } from './gameMovie.js'
import { Config } from './config.js'
import { CriticalEffects } from './criticalEffects.js'
import { Events } from './events.js'
import * as GameTime from './gametime.js'
import { Point } from './geometry.js'
import globalState from './globalState.js'
import { GameMap } from './map.js'
import { Player } from './player.js'
import { SCREEN_HEIGHT, SCREEN_WIDTH } from './renderer.js'
import { saveLoadInit } from './saveload.js'
import { drawAC, drawHP, initUI, uiDrawWeapon, uiLog } from './ui.js'
import { initMainMenu, showMainMenu } from './ui_mainmenu.js'
import { initCharacterCreator } from './ui_charactercreator.js'
import { initCharacterSelector, showCharacterSelector } from './ui_charselect.js'
import { Worldmap } from './worldmap.js'
import { initAutomapTracking } from './automapData.js'

export function initGame() {
    // initialize player
    globalState.player = new Player()

    // initialize map
    globalState.gMap = new GameMap()

    // Seed game time to Fallout 2's 8:24 AM start (matches fallout2-ce).
    GameTime.initGameTime()

    uiLog('Welcome to DarkHarold2')

    const _qs = new URLSearchParams(location.search)
    const crawlParam = _qs.get('crawl')
    const mapFromQuery = !crawlParam && location.search ? location.search.slice(1) : null

    if (Config.engine.doCombat === true) {
        CriticalEffects.loadTable()
    }

    document.oncontextmenu = () => false
    const $cnv = document.getElementById('cnv')!
    $cnv.onmouseenter = () => {
        globalState.gameHasFocus = true
    }
    $cnv.onmouseleave = () => {
        globalState.gameHasFocus = false
    }

    globalState.tempCanvas = document.createElement('canvas') as HTMLCanvasElement
    globalState.tempCanvas.width = SCREEN_WIDTH
    globalState.tempCanvas.height = SCREEN_HEIGHT
    globalState.tempCanvasCtx = globalState.tempCanvas.getContext('2d', { willReadFrequently: true })

    saveLoadInit()

    Worldmap.init()

    initUI()
    initAutomapTracking()

    // Wire main menu + character creator after UI is ready. Callbacks break the
    // potential circular import: ui_mainmenu ↔ ui_charactercreator.
    // CE main.cc:114 — after character creation: gameMoviePlay(MOVIE_ELDER, STOP_MUSIC),
    // reseed the RNG, then load the starting map.
    const startNewGame = () => {
        // The HUD still shows the placeholder player from the background map load;
        // redraw it for the created/premade character (CE intface init on game start).
        const player = globalState.player!
        player.resetInventoryForNewGame()
        uiDrawWeapon()
        drawHP(player.getStat('HP'))
        drawAC(player.getStat('AC') + player.getArmorAC())
        void gameMoviePlay(MOVIE_ELDER, GAME_MOVIE_STOP_MUSIC).then(() => {
            randomSeedPrerandom(-1)
            globalState.gMap.loadMap('artemple')
        })
    }
    // CE main.cc:113 — NEW GAME opens the premade character selector first.
    initCharacterCreator(startNewGame, showMainMenu)
    initCharacterSelector(startNewGame, showMainMenu)
    initMainMenu(() => showCharacterSelector())

    if (mapFromQuery !== null) {
        // Debug: map specified in URL query → skip main menu and load directly.
        globalState.gMap.loadMap(mapFromQuery)
    } else {
        // Default startup: load the starting map in the background (the main menu
        // overlay covers the canvas so the player never sees it during menu).
        // This avoids potential game-loop crashes from a completely unloaded map.
        globalState.gMap.loadMap('artemple')
        // CE main.cc:86-91 — IPLOGO (fade in), INTRO, CREDITS before the main menu,
        // unless sfall's SkipOpeningMovies is set (Config.ui.skipOpeningMovies).
        if (Config.ui.skipOpeningMovies) {
            showMainMenu()
        } else {
            void gameMoviePlay(MOVIE_IPLOGO, GAME_MOVIE_FADE_IN)
                .then(() => gameMoviePlay(MOVIE_INTRO, 0))
                .then(() => gameMoviePlay(MOVIE_CREDITS, 0))
                .then(() => showMainMenu())
        }
    }

    // CE ref: tile.cc tile_fill_roof — roof hiding is now per-building:
    // renderRoof() flood-fills from the player's tile to hide only the
    // connected roof section the player is standing under. The global
    // showRoof toggle is no longer used for this purpose.
}
