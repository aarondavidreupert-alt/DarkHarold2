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

// The UI windows the game logic opens (wiki/code_quality.md Q14). Combat, scripting, objects and the
// world map call them through this object instead of importing the UI modules, which import the
// game logic back; uiPortInstall.ts fills it at boot. Type-only imports: nothing here is loaded.
import type {
    uiAddDialogueOption,
    uiBarterMode,
    uiCalledShot,
    uiCloseCalledShot,
    uiCloseWorldMap,
    uiEndButtonsGreenLights,
    uiEndButtonsRedLights,
    uiEndCombat,
    uiEndDialogue,
    uiHideCombatHover,
    uiLoot,
    uiSetDialogueReply,
    uiShowCombatHover,
    uiStartCombat,
    uiStartDialogue,
    uiWorldMap,
    uiWorldMapShowArea,
} from './ui.js'
import type { openAutomap } from './uiAutomap.js'
import type { applyArmorArt } from './uiInventory/dragdrop.js'
import type { uiSteal } from './uiSteal.js'

export interface UiPort {
    applyArmorArt: typeof applyArmorArt
    openAutomap: typeof openAutomap
    uiAddDialogueOption: typeof uiAddDialogueOption
    uiBarterMode: typeof uiBarterMode
    uiCalledShot: typeof uiCalledShot
    uiCloseCalledShot: typeof uiCloseCalledShot
    uiCloseWorldMap: typeof uiCloseWorldMap
    uiEndButtonsGreenLights: typeof uiEndButtonsGreenLights
    uiEndButtonsRedLights: typeof uiEndButtonsRedLights
    uiEndCombat: typeof uiEndCombat
    uiEndDialogue: typeof uiEndDialogue
    uiHideCombatHover: typeof uiHideCombatHover
    uiLoot: typeof uiLoot
    uiSetDialogueReply: typeof uiSetDialogueReply
    uiShowCombatHover: typeof uiShowCombatHover
    uiStartCombat: typeof uiStartCombat
    uiStartDialogue: typeof uiStartDialogue
    uiSteal: typeof uiSteal
    uiWorldMap: typeof uiWorldMap
    uiWorldMapShowArea: typeof uiWorldMapShowArea
}

export const uiPort = {} as UiPort
