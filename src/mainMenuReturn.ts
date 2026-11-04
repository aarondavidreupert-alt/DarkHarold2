/*
Copyright 2026 DarkHarold2 contributors

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

// CE _game_user_wants_to_quit = 2 (quit, the endgame's "No", death, the 13-year timeout,
// Arroyo's fall): the game loop ends and main.cc goes back to the main menu. DH2 starts the
// page afresh — a clean game state — but skips the opening movies on that one load, so the
// player lands on the main menu as in CE.

const KEY = 'dh2.returnToMainMenu'

export function returnToMainMenu(): void {
    try {
        sessionStorage.setItem(KEY, '1')
    } catch (_) {
        /* private mode: the movies play */
    }
    // without the query string: play.html?<map> (and ?crawl=) would start that map again
    // instead of the menu (init.ts reads the query first); the #hash options stay. With no
    // query, a reload: a URL that only keeps its #hash would not load the page again.
    if (location.search) {
        location.replace(location.pathname + location.hash)
    } else {
        location.reload()
    }
}

/** True when this page load comes from returnToMainMenu (without taking the flag). */
export function isMainMenuReturn(): boolean {
    try {
        return sessionStorage.getItem(KEY) === '1'
    } catch (_) {
        return false
    }
}

/** True (once) when this page load comes from returnToMainMenu. */
export function takeMainMenuReturn(): boolean {
    try {
        const set = sessionStorage.getItem(KEY) === '1'
        sessionStorage.removeItem(KEY)
        return set
    } catch (_) {
        return false
    }
}
