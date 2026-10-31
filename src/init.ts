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

import { gameReset } from './gameReset.js'
import { randomSeedPrerandom } from './random.js'
import {
    gameMoviePlay,
    GAME_MOVIE_FADE_IN,
    GAME_MOVIE_STOP_MUSIC,
    MOVIE_CREDITS,
    MOVIE_ELDER,
    MOVIE_INTRO,
    MOVIE_IPLOGO,
} from './gameMovie.js'
import { Config } from './config.js'
import * as CriticalEffects from './criticalEffects.js'
import * as GameTime from './gametime.js'
import globalState from './globalState.js'
import { world } from './state/world.js'
import { uiState } from './state/uiState.js'
import { assets } from './state/assets.js'
import { GameMap } from './map.js'
import { Player } from './player.js'
import { SCREEN_HEIGHT, SCREEN_WIDTH } from './renderer.js'
import { saveLoadInit } from './saveload.js'
import { initUI } from './ui.js'
import { drawAC, drawHP, uiDrawWeapon } from './hudRefresh.js'
import { uiLog } from './messageLog.js'
import { initMainMenu, showMainMenu } from './uiMainMenu.js'
import { takeMainMenuReturn } from './mainMenuReturn.js'
import { hideSplash, waitForSplashClick } from './splash.js'
import { sfallIniGetString } from './sfallIni.js'

// sfall ddraw.ini [Misc] SkipOpeningMovies (0 / 1 / 2), else Config.ui.skipOpeningMovies
export function skipOpeningMoviesLevel(): number {
    const v = parseInt(sfallIniGetString('ddraw.ini|Misc|SkipOpeningMovies') ?? '', 10)
    return !isNaN(v) ? v : Config.ui.skipOpeningMovies ? 1 : 0
}
import { initCharacterCreator } from './uiCharacterCreator.js'
import { initCharacterSelector, showCharacterSelector } from './uiCharSelect.js'
import * as Worldmap from './worldmap.js'
import { initAutomapTracking } from './automapData.js'
import { requestGlobalScriptsStart } from './sfallGlobalScripts.js'

/** The map initGame loads first: ?<map> (not with ?crawl=), else artemple behind the menu. */
export function initialMapName(): string {
    const qs = new URLSearchParams(location.search)
    return !qs.get('crawl') && location.search ? location.search.slice(1) : 'artemple'
}

export function initGame() {
    // initialize player
    world.player = new Player()

    // initialize map
    world.gMap = new GameMap()

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
    // The game has input focus while the mouse is over the map or the HUD bar (a DOM
    // layer over the canvas): moving between the two must not drop it, or edge
    // scrolling stops at the bottom edge over the HUD (CE game_mouse.cc:2334 scrolls
    // on the whole screen).
    const $cnv = document.getElementById('cnv')!
    const $bar = document.getElementById('bar')
    const inGameArea = (el: EventTarget | null) => el instanceof Node && (el === $cnv || ($bar?.contains(el) ?? false))
    for (const el of [$cnv, $bar]) {
        if (!el) continue
        el.addEventListener('mouseenter', () => {
            uiState.gameHasFocus = true
        })
        el.addEventListener('mouseleave', (e) => {
            if (!inGameArea((e as MouseEvent).relatedTarget)) uiState.gameHasFocus = false
        })
    }

    assets.tempCanvas = document.createElement('canvas') as HTMLCanvasElement
    assets.tempCanvas.width = SCREEN_WIDTH
    assets.tempCanvas.height = SCREEN_HEIGHT
    assets.tempCanvasCtx = assets.tempCanvas.getContext('2d', { willReadFrequently: true })

    saveLoadInit()

    Worldmap.init()

    initUI()
    initAutomapTracking()

    // Wire main menu + character creator after UI is ready. Callbacks break the
    // potential circular import: uiMainMenu ↔ uiCharacterCreator.
    // CE main.cc:114 — after character creation: gameMoviePlay(MOVIE_ELDER, STOP_MUSIC),
    // reseed the RNG, then load the starting map.
    const startNewGame = () => {
        // The HUD still shows the placeholder player from the background map load;
        // redraw it for the created/premade character (CE intface init on game start).
        const player = world.player!
        player.resetInventoryForNewGame()
        uiDrawWeapon()
        drawHP(player.getStat('HP'))
        drawAC(player.getStat('AC') + player.getArmorAC())
        globalState.backgroundMapLoad = false
        void gameMoviePlay(MOVIE_ELDER, GAME_MOVIE_STOP_MUSIC).then(() => {
            randomSeedPrerandom(-1)
            requestGlobalScriptsStart() // sfall: after the new game's map has loaded
            world.gMap!.loadMap('artemple')
        })
    }
    // CE main.cc:113 — NEW GAME opens the premade character selector first.
    initCharacterCreator(startNewGame, showMainMenu)
    initCharacterSelector(startNewGame, showMainMenu)
    // CE main.cc main_reset_system — gameReset() before every NEW GAME.
    initMainMenu(() => {
        gameReset()
        showCharacterSelector()
    })

    if (mapFromQuery !== null) {
        // Debug: map specified in URL query → skip main menu and load directly.
        hideSplash()
        world.gMap.loadMap(mapFromQuery)
    } else {
        // Default startup: load the starting map in the background (the main menu
        // overlay covers the canvas so the player never sees it during menu).
        // This avoids potential game-loop crashes from a completely unloaded map.
        globalState.backgroundMapLoad = true // silent: no map music under the intro / menu
        world.gMap.loadMap('artemple')
        // CE main.cc:86-91 — IPLOGO (fade in), INTRO, CREDITS before the main menu,
        // unless sfall's SkipOpeningMovies is set (Config.ui.skipOpeningMovies).
        // AutoCrawler (?crawl=): neither — the crawl plays on the background map, and the
        // movies' real-time uiMode switches would land in the middle of its steps.
        // sfall ddraw.ini [Misc] SkipOpeningMovies: 1 skips the movies (2 the splash too)
        if (crawlParam) {
            hideSplash()
            // nothing: autocrawler.ts starts the crawl once the map has loaded
        } else if (skipOpeningMoviesLevel() >= 1 || takeMainMenuReturn()) {
            hideSplash()
            showMainMenu()
        } else {
            // the movie screen covers the splash; it goes with the main menu. Before the first
            // user gesture the splash waits for a click, so the logo plays with its sound.
            void waitForSplashClick()
                .then(() => gameMoviePlay(MOVIE_IPLOGO, GAME_MOVIE_FADE_IN))
                .then(() => gameMoviePlay(MOVIE_INTRO, 0))
                .then(() => gameMoviePlay(MOVIE_CREDITS, 0))
                .then(() => {
                    hideSplash()
                    showMainMenu()
                })
        }
    }

    // CE ref: tile.cc tile_fill_roof — roof hiding is now per-building:
    // renderRoof() flood-fills from the player's tile to hide only the
    // connected roof section the player is standing under. The global
    // showRoof toggle is no longer used for this purpose.
}
