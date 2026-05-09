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

import { AudioEngine } from './audio.js'
import { Combat } from './combat.js'
import { AreaMap } from './data.js'
import { Point } from './geometry.js'
import type { CombatLogEntry } from './logger.js'
import { GameMap, SerializedMap } from './map.js'
import { Obj } from './object.js'
import { Party } from './party.js'
import { Player } from './player.js'
import { Renderer } from './renderer.js'
import { Skills } from './skills.js'
import { UIMode } from './ui.js'

export type CursorMode = 'move' | 'command' | 'attack' | 'interface' | 'scroll' | 'useSkill'

interface FloatMessage {
    msg: string
    obj: Obj
    startTime: number
    color: string
}

const globalState = {
    combat: null,
    inCombat: false,
    gMap: null,
    messageFiles: {},
    player: null,
    proMap: null,

    skillMode: Skills.None,

    isLoading: true, // are we currently loading a map?
    isWaitingOnRemote: false, // are we waiting on the remote server to send critical info?
    isInitializing: true, // are we initializing the engine?
    loadingAssetsLoaded: 0, // how many images we've loaded
    loadingAssetsTotal: 0, // out of this total
    loadingLoadedCallback: null, // loaded callback
    lazyAssetLoadingQueue: {}, // set of lazily-loaded assets being loaded

    images: {}, // Image cache
    imageInfo: null, // Metadata about images (Number of frames, FPS, etc)
    currentElevation: 0, // current map elevation
    tempCanvas: null, // temporary canvas used for detecting single pixels
    tempCanvasCtx: null, // and the context for it

    // position of viewport camera (will be overriden by map starts or scripts)
    cameraPosition: { x: 3580, y: 1020 },
    // camera zoom factor — 1.0 means 1:1, >1 zoomed in, <1 zoomed out.
    // Affects all world-space rendering (tiles, objects, critters, walls, roofs)
    // but NOT UI/HUD elements (renderImage w/ lit=false, renderFont, HTML overlays).
    cameraZoom: 1.0,

    gameTickTime: 0, // in Fallout 2 ticks (elapsed seconds * 10)
    lastGameTick: 0, // real time of the last game tick
    gameHasFocus: false, // do we have input focus?
    lastMousePickTime: 0, // time when we last checked what's under the mouse cursor
    lastFPSTime: 0, // Time since FPS counter was last updated

    floatMessages: [],
    renderer: null,
    audioEngine: null,
    $fpsOverlay: null,

    centerTile: { x: 0, y: 0 },

    dirtyMapCache: {},
    gParty: new Party(),

    uiMode: UIMode.none,

    punchModeIdx: 0,
    kickModeIdx: 0,

    mapAreas: null,

    knownAreas: new Set<number>(),

    // Structured combat log — populated by logger.combatLogPush().
    // Survives across map changes and is persisted with the save game.
    combatLog: [] as CombatLogEntry[],

    // Cursor system
    cursorMode: 'move' as CursorMode,
    preScrollCursorMode: 'move' as CursorMode,
    cursorPos: { x: 0, y: 0 },
    showLookCursor: false,
    commandModeTimer: null as number | null,
} as {
    gMap: GameMap | null
    combat: Combat | null
    inCombat: boolean
    messageFiles: { [msgFile: string]: { [msgID: string]: string } }
    player: Player | null
    proMap: any // TODO: type

    skillMode: Skills

    isLoading: boolean
    isWaitingOnRemote: boolean
    isInitializing: boolean
    loadingAssetsLoaded: number
    loadingAssetsTotal: number
    loadingLoadedCallback: (() => void) | null
    lazyAssetLoadingQueue: {
        [name: string]: ((img: any) => void)[] | undefined
    }

    images: { [name: string]: HTMLImageElement } // Image cache
    imageInfo: any // Metadata about images (Number of frames, FPS, etc)
    currentElevation: number // current map elevation
    tempCanvas: HTMLCanvasElement | null // temporary canvas used for detecting single pixels
    tempCanvasCtx: CanvasRenderingContext2D | null // and the context for it

    cameraPosition: Point
    cameraZoom: number

    gameTickTime: number
    lastGameTick: number
    gameHasFocus: boolean
    lastMousePickTime: number
    lastUpdateTime: number
    lastDrawTime: number
    lastFPSTime: number

    floatMessages: FloatMessage[]
    renderer: Renderer
    audioEngine: AudioEngine
    $fpsOverlay: HTMLElement | null

    centerTile: Point

    dirtyMapCache: { [mapName: string]: SerializedMap }

    gParty: Party

    uiMode: UIMode

    punchModeIdx: number
    kickModeIdx: number

    mapAreas: AreaMap | null

    knownAreas: Set<number>

    combatLog: CombatLogEntry[]

    // Cursor system
    cursorMode: CursorMode
    preScrollCursorMode: CursorMode
    cursorPos: Point
    showLookCursor: boolean
    commandModeTimer: number | null
}

export default globalState

if (typeof window !== 'undefined') {
    ;(window as any).globalState = globalState
    // Convenience alias so DevTools users can grab the structured combat log
    // without typing globalState.combatLog every time.
    Object.defineProperty(window, '__combatLog', {
        get: () => globalState.combatLog,
        configurable: true,
    })
}
