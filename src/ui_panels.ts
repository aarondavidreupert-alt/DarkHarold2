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

// Shared panel state + mutual-exclusion helpers.
//
// This module owns the $uiContainer element (the DOM parent that
// WindowFrame.show() appends into) and exposes it via getUiContainer() so
// that ui_components.ts and the individual panel modules can read it without
// importing back from ui.ts (which would re-form the old import cycle).

import globalState from './globalState.js'
import { closeAutomap, isAutomapOpen } from './ui_automap.js'
import { closePipBoy, isPipBoyOpen } from './ui_pipboy.js'

// The top-level UI mode (uiMode.ts, a leaf module so globalState.ts can use it)
export { UIMode } from './uiMode.js'
import { UIMode } from './uiMode.js'

// --- $uiContainer ownership: uiContainer.ts (a leaf module)
export { initUiContainer, getUiContainer } from './uiContainer.js'

// --- Panel mutual-exclusion helpers -----------------------------------------
//
// These let each panel-open path close any other panels that are currently up,
// so buttons behave like tabs rather than stackable overlays. They are also
// used by the button handlers to implement toggle-to-close.

export function isInventoryOpen(): boolean {
    return globalState.uiMode === UIMode.inventory
}

// Getters for per-panel WindowFrames are installed by the owning module
// (ui_character / ui_skilldex / ui_options) at init time so that ui_panels
// can query them without importing back into those modules. This avoids the
// circular import: ui_panels → ui_character → ui_components → ui_panels.
let characterWindowGetter: (() => { showing: boolean; close(): void } | null) | null = null
let skilldexWindowGetter: (() => { showing: boolean; close(): void } | null) | null = null
let optionsWindowGetter: (() => { showing: boolean; close(): void } | null) | null = null
let closeInventoryPanelFn: (() => void) | null = null

export function registerCharacterWindow(getter: () => { showing: boolean; close(): void } | null): void {
    characterWindowGetter = getter
}
export function registerSkilldexWindow(getter: () => { showing: boolean; close(): void } | null): void {
    skilldexWindowGetter = getter
}
export function registerOptionsWindow(getter: () => { showing: boolean; close(): void } | null): void {
    optionsWindowGetter = getter
}
export function registerCloseInventoryPanel(fn: () => void): void {
    closeInventoryPanelFn = fn
}

export function isCharacterOpen(): boolean {
    const w = characterWindowGetter?.()
    return !!(w && w.showing)
}

export function isSkilldexOpen(): boolean {
    const w = skilldexWindowGetter?.()
    return !!(w && w.showing)
}

export function isOptionsOpen(): boolean {
    const w = optionsWindowGetter?.()
    return !!(w && w.showing)
}

export function closeInventoryPanel(): void {
    if (closeInventoryPanelFn) {
        closeInventoryPanelFn()
    }
}

export function closeAllPanels(): void {
    if (isPipBoyOpen()) closePipBoy()
    if (isAutomapOpen()) closeAutomap()
    const charW = characterWindowGetter?.()
    if (charW && charW.showing) charW.close()
    if (isInventoryOpen()) closeInventoryPanel()
    const skillW = skilldexWindowGetter?.()
    if (skillW && skillW.showing) skillW.close()
    const optsW = optionsWindowGetter?.()
    if (optsW && optsW.showing) optsW.close()
}
