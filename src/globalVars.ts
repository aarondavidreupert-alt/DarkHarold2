// Copyright 2026 DarkHarold2 contributors
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

// GVARs (CE scripts.cc / game.cc gGameGlobalVars): engine-wide script variables, persisted in saves.
// A leaf module, so perks, encounters and the death endings can read them without importing the
// scripting engine (wiki/code_quality.md Q14); scripting.ts re-exports these functions.
import { getFileJSON } from './util.js'
import { dbg } from './logger.js'

let globalVars: any = {}
let globalVarsLoaded = false

export function setGlobalVar(gvar: number, value: number): void {
    globalVars[gvar] = value
}

export function getGlobalVar(gvar: number): any {
    return globalVars[gvar] !== undefined ? globalVars[gvar] : 0
}

export function getGlobalVars(): any {
    return globalVars
}

export function setGlobalVars(vars: { [k: string]: number }): void {
    globalVars = Object.assign({}, vars)
}

// CE game.cc gameLoadGlobalVars: a new game / load starts from vault13.gam's defaults
export function resetGlobalVars(): void {
    globalVars = {}
    globalVarsLoaded = false
    loadGlobalVars()
}

export function loadGlobalVars(): void {
    if (globalVarsLoaded) return
    try {
        const data = getFileJSON('data/gvars.json')
        for (const key of Object.keys(data)) {
            const idx = Number(key)
            if (globalVars[idx] === undefined) {
                globalVars[idx] = data[key]
            }
        }
        globalVarsLoaded = true
        dbg('load', 'loadGlobalVars: loaded ' + Object.keys(data).length + ' global vars from gvars.json')
    } catch (e: any) {
        globalVarsLoaded = true
        dbg('load', 'loadGlobalVars: gvars.json not found, using defaults (' + e.message + ')')
    }
}
