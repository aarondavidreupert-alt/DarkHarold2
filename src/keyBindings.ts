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

// Key bindings — fallout2.cfg [keys] (DH2 addition). CE has no bindings file: its game
// keys are fixed in game.cc gameHandleKey (and combat.cc _combat_input for Space / Enter),
// ported in src/hotkeys.ts. The defaults below are that layout; the [keys] section moves
// an action to another key. Ctrl combinations and the skill keys 1-8 stay fixed.
//
// The game keys are remapped in front of gameHandleKey: a pressed key bound to an action
// becomes that action's CE key (translateGameKey), a CE key whose action was moved
// elsewhere does nothing. The camera, item-highlight and developer keys are the fields of
// Config.controls (src/input.ts isKey).
//
// Keep this module free of game imports (loaded by the unit tests).

import { Config } from './config.js'

/** Action → CE's key (KeyboardEvent.key, letters lower-case). */
export const CE_GAME_KEYS: Readonly<Record<string, string>> = {
    inventory: 'i',
    character: 'c',
    skilldex: 's',
    pipboy: 'p',
    rest: 'z',
    automap: 'Tab',
    options: 'o',
    menu: 'Escape',
    combat: 'a',
    item_action: 'n',
    mouse_mode: 'm',
    swap_hands: 'b',
    center: 'Home',
    help: 'F1',
    volume_down: 'F2',
    volume_up: 'F3',
    save: 'F4',
    load: 'F5',
    quick_save: 'F6',
    quick_load: 'F7',
    quit: 'F10',
    brightness_down: '-',
    brightness_up: '=',
    rotate_left: ',',
    rotate_right: '.',
    date: '/',
    end_turn: ' ',
    end_combat: 'Enter',
}

// CE also takes the shifted key of these (gameHandleKey: '_', '+', '<', '>', '?'); they
// follow their action's binding only while it is CE's.
const SHIFTED: Readonly<Record<string, string>> = { _: '-', '+': '=', '<': ',', '>': '.', '?': '/' }

const KEY_NAMES: Readonly<Record<string, string>> = {
    space: ' ',
    enter: 'Enter',
    return: 'Enter',
    tab: 'Tab',
    escape: 'Escape',
    esc: 'Escape',
    home: 'Home',
    end: 'End',
    insert: 'Insert',
    delete: 'Delete',
    backspace: 'Backspace',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
}

/** A cfg key value as KeyboardEvent.key (letters lower-case): a single character, a name
 *  (space, enter, tab, escape, home, up, …) or F1-F12; null if it is none of those. */
export function parseKeyName(value: string): string | null {
    const v = value.trim()
    if (v.length === 1) {
        return v.toLowerCase()
    }
    const lower = v.toLowerCase()
    if (KEY_NAMES[lower] !== undefined) {
        return KEY_NAMES[lower]
    }
    const f = /^f([1-9]|1[0-2])$/.exec(lower)
    return f ? 'F' + f[1] : null
}

// heart.ts _getKeyChar names (Config.controls): arrows 'up' / 'down' / 'left' / 'right',
// letters and digits lower-case, ' ' for Space
function heartKeyName(value: string): string | null {
    const k = parseKeyName(value)
    if (k === null) {
        return null
    }
    if (k.startsWith('Arrow')) {
        return k.slice(5).toLowerCase()
    }
    return /^[a-z0-9 ]$/.test(k) ? k : null
}

let gameKeys: Record<string, string> = { ...CE_GAME_KEYS }
let byKey = new Map<string, string>() // pressed key → action

function rebuild(): void {
    byKey = new Map()
    for (const action in gameKeys) {
        byKey.set(gameKeys[action], action)
    }
}
rebuild()

/** The key bound to a game action (KeyboardEvent.key form). */
export function gameKeyOf(action: string): string | undefined {
    return gameKeys[action]
}

/** Bind a game action to a key; false for an unknown action or key name. */
export function bindGameKey(action: string, value: string): boolean {
    if (CE_GAME_KEYS[action] === undefined) {
        return false
    }
    const key = parseKeyName(value)
    if (key === null) {
        return false
    }
    gameKeys[action] = key
    rebuild()
    return true
}

/** Back to CE's layout (tests). */
export function resetGameKeys(): void {
    gameKeys = { ...CE_GAME_KEYS }
    rebuild()
}

/** The pressed key (KeyboardEvent.key, letters lower-case) as CE's key for gameHandleKey:
 *  a key bound to an action gives that action's CE key; a CE key whose action is bound
 *  elsewhere gives null (no action); any other key is passed through. */
export function translateGameKey(key: string): string | null {
    const action = byKey.get(key)
    if (action !== undefined) {
        return CE_GAME_KEYS[action]
    }
    const base = SHIFTED[key]
    if (base !== undefined) {
        const a = byKey.get(base)
        return a !== undefined && CE_GAME_KEYS[a] === base ? base : null
    }
    for (const a in CE_GAME_KEYS) {
        if (CE_GAME_KEYS[a] === key) {
            return null
        }
    }
    return key
}

/** The pressed key as CE's key when it is bound to an action, else itself — for a window's
 *  own close keys (the inventory's I, the Pip-Boy's P / Z): a moved action's new key closes
 *  its window too, and the CE keys keep their other uses there. */
export function asCeKey(key: string): string {
    const action = byKey.get(key)
    return action !== undefined ? CE_GAME_KEYS[action] : key
}

// Config.controls field ↔ cfg name: camelCase → snake_case, the developer keys (only with
// Config.engine.devKeys, src/input.ts DEV_CONTROLS) prefixed dev_.
const NOT_DEV = new Set(['cameraDown', 'cameraUp', 'cameraLeft', 'cameraRight', 'highlightItems'])
export function controlCfgName(field: string): string {
    const snake = field.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
    return NOT_DEV.has(field) ? snake : 'dev_' + snake
}

/** fallout2.cfg [keys]: game actions (CE_GAME_KEYS) and Config.controls fields
 *  (controlCfgName). Unknown names and key values are reported and skipped. */
export function applyKeysSection(keys: { [name: string]: string } | undefined): string[] {
    const bad: string[] = []
    if (!keys) {
        return bad
    }
    const controls = Config.controls as Record<string, string>
    const fieldOf = new Map(Object.keys(controls).map((f) => [controlCfgName(f), f]))
    for (const raw in keys) {
        const name = raw.trim().toLowerCase()
        const value = keys[raw]
        if (CE_GAME_KEYS[name] !== undefined) {
            if (!bindGameKey(name, value)) {
                bad.push(`${raw}=${value}`)
            }
            continue
        }
        const field = fieldOf.get(name)
        const k = field !== undefined ? heartKeyName(value) : null
        if (field === undefined || k === null) {
            bad.push(`${raw}=${value}`)
            continue
        }
        controls[field] = k
    }
    return bad
}
