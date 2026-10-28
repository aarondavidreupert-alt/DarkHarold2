// Copyright 2014-2022 darkf
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

import type { Critter, Obj } from './object.js'
import type { EventLogEntry } from './eventlog.types.js'
import type { Point } from './geometry.js'
import { assets } from './state/assets.js'
import { services } from './state/services.js'
import { uiState } from './state/uiState.js'
import { view } from './state/view.js'
import { world } from './state/world.js'

export type CursorMode = 'move' | 'command' | 'attack' | 'interface' | 'scroll' | 'useSkill' | 'useItem'

/** One art/imageMap.json entry: an FRM's frame layout (the export_images pipeline stage). */
export interface ImageInfo {
    numFrames: number // frames per direction
    totalFrames: number
    frameWidth: number // the sprite-sheet cell
    frameHeight: number
    fps: number
    actionFrame: number | number[] // one per direction where they differ
    numDirections: number
    directionOffsets: Point[]
    // per direction, per frame: offset (x, y), size (w, h), sheet position (sx, sy; sy
    // absent = 0), accumulated offset (ox, oy)
    frameOffsets: { x: number; y: number; w: number; h: number; sx: number; sy?: number; ox: number; oy: number }[][]
}

export interface FloatMessage {
    msg: string
    obj: Obj
    startTime: number
    color: string // CSS hex (floatText.ts FLOAT_MSG_COLOR) or an old colour name
    outline?: string | null // outline colour; default black, null = none
    font?: 101 | 103 // CE interface font (default 101)
    tile?: Point | null // CE textObject->tile: the owner's tile when it was added
    lines?: number // CE linesCount (after word wrap) — for the display time
}

// The engine's own runtime state. The rest lives with its owner (wiki/code_quality.md Q15):
// state/world.ts (map, player, party, combat, time, areas), state/uiState.ts (UI mode, cursor,
// hover), state/view.ts (camera), state/services.ts (renderer, audio), state/assets.ts (images,
// protos, messages, caches). Each of their fields is also a property of globalState (a getter /
// setter onto the owner), so older code, the dev console and saved-game code see one object.
const core = {
    isLoading: true, // are we currently loading a map?
    backgroundMapLoad: false, // the startup map behind the intro / main menu (no music)
    isInitializing: true, // are we initializing the engine?

    lastGameTick: 0, // real time of the last game tick
    lastUpdateTime: 0, // ms the last game tick took (FPS overlay)
    lastDrawTime: 0, // ms the last frame took to draw (FPS overlay)
    lastFPSTime: 0, // Time since FPS counter was last updated

    // Structured event log — populated by logger.eventLogPush().
    // Survives across map changes and is persisted with the save game.
    eventLog: [] as EventLogEntry[],

    // Drug use handler — set from main.ts after importing drugs.ts
    // to avoid circular import (object.ts -> scripting.ts -> object.ts)
    drugHandler: null as ((item: Obj, user: Critter) => boolean) | null,
    // First Aid Kit / Doctor's Bag handler — set from main.ts for same reason
    miscItemUseHandler: null as ((item: Obj, user: Critter) => boolean) | null,
}

type GlobalState = typeof core & typeof world & typeof uiState & typeof view & typeof services & typeof assets

const globalState = core as GlobalState
for (const owner of [world, uiState, view, services, assets] as Record<string, unknown>[]) {
    for (const key of Object.keys(owner)) {
        Object.defineProperty(globalState, key, {
            get: () => owner[key],
            set: (value: unknown) => {
                owner[key] = value
            },
            enumerable: true,
            configurable: true,
        })
    }
}

export default globalState

if (typeof window !== 'undefined') {
    window.globalState = globalState
}
