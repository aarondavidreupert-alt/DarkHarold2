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

// PipBoy ARCHIVES tab — split out of ui_pipboy.ts. See
// wiki/ts-split-refactor.md → "Per-file split proposals" §12.

import globalState from '../../globalState.js'
import { gameMovieIsSeen, gameMoviePlay, GAME_MOVIE_FADE_IN, GAME_MOVIE_FADE_OUT, GAME_MOVIE_PAUSE_MUSIC } from '../../gameMovie.js'
import { getMessage } from '../../util.js'
import {
    TEXT_STYLE,
    clearScreen,
    makeContentArea,
    makeHeader,
} from '../shell.js'

// --- ARCHIVES tab: video archive (CE pipboy.cc:1708 pipboyRenderVideoArchive)
// Lists every movie 2..15 the player has seen (pipboy.msg 500 + movie; header 206
// "VIDEO ARCHIVES"); clicking one replays it with FADE_IN | FADE_OUT | PAUSE_MUSIC
// (pipboy.cc:1695). The quest log, which CE shows on the STATUS page, is
// appendQuestLog() below and is rendered by tabs/status.ts.

export function renderArchivesTab(screen: HTMLDivElement): void {
    clearScreen(screen)
    const content = makeContentArea()
    screen.appendChild(content)
    content.appendChild(makeHeader(getMessage('pipboy', 206) ?? 'VIDEO ARCHIVES'))

    const list = document.createElement('div')
    list.style.cssText = TEXT_STYLE + 'font-size: 13px; padding: 2px 8px; line-height: 1.6;'
    for (let movie = 2; movie < 16; movie++) {
        if (!gameMovieIsSeen(movie)) continue
        const row = document.createElement('div')
        row.textContent = getMessage('pipboy', 500 + movie) ?? `Movie ${movie}`
        row.style.cursor = 'pointer'
        row.onmouseenter = () => { row.style.color = '#fcfc7c' } // CE 32747
        row.onmouseleave = () => { row.style.color = '' }
        row.onclick = () => {
            globalState.audioEngine?.playSfxByName?.('ib1p1xx1')
            void gameMoviePlay(movie, GAME_MOVIE_FADE_IN | GAME_MOVIE_FADE_OUT | GAME_MOVIE_PAUSE_MUSIC)
        }
        list.appendChild(row)
    }
    content.appendChild(list)
}
