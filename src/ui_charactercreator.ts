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

// Character creator entry point — delegates to showCharacterCreator() in ui_character.ts.
// This module owns the UIMode transitions and the callbacks registered by init.ts.

import globalState from './globalState.js'
import { UIMode } from './ui_panels.js'
import { showCharacterCreator as openCreatorWindow } from './ui_character.js'

let onDone: (() => void) | null = null
let onBack: (() => void) | null = null

export function initCharacterCreator(doneCb: () => void, backCb: () => void): void {
    onDone = doneCb
    onBack = backCb
}

export function showCharacterCreator(): void {
    globalState.uiMode = UIMode.characterCreator
    openCreatorWindow(
        () => {
            globalState.uiMode = UIMode.none
            onDone?.()
        },
        () => {
            globalState.uiMode = UIMode.none
            onBack?.()
        }
    )
}

export function hideCharacterCreator(): void {
    globalState.uiMode = UIMode.none
}
