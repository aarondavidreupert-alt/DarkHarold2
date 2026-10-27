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

import type { Proto } from './proto_types.js'
import { AudioEngine } from './audio.js'
import type { CycleMask } from './colorCycle.js'
import type { Combat } from './combat.js'
import { AreaMap } from './data.js'
import { Point } from './geometry.js'
import type { EventLogEntry } from './eventlog.types.js'
import { GameMap, SerializedMap } from './map.js'
import { Critter, Obj } from './object.js'
import { Party } from './party.js'
import { Player } from './player.js'
import { Renderer } from './renderer.js'
import { Skills } from './skills.js'
import { UIMode } from './ui.js'

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

interface FloatMessage {
    msg: string
    obj: Obj
    startTime: number
    color: string // CSS hex (floatText.ts FLOAT_MSG_COLOR) or an old colour name
    outline?: string | null // outline colour; default black, null = none
    font?: 101 | 103 // CE interface font (default 101)
    tile?: Point | null // CE textObject->tile: the owner's tile when it was added
    lines?: number // CE linesCount (after word wrap) — for the display time
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
    backgroundMapLoad: false, // the startup map behind the intro / main menu (no music)
    isInitializing: true, // are we initializing the engine?
    loadingAssetsLoaded: 0, // how many images we've loaded
    loadingAssetsTotal: 0, // out of this total
    loadingLoadedCallback: null, // loaded callback
    lazyAssetLoadingQueue: {}, // set of lazily-loaded assets being loaded

    images: {}, // Image cache
    cycleMasks: {}, // Cycling palette-index masks for animated tiles/objects (undefined=pending, null=none, CycleMask=data)
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
    lastUpdateTime: 0, // ms the last game tick took (FPS overlay)
    lastDrawTime: 0, // ms the last frame took to draw (FPS overlay)
    lastFPSTime: 0, // Time since FPS counter was last updated

    floatMessages: [],
    renderer: null!, // set during boot (main.ts / init.ts) before use
    audioEngine: null!, // set during boot (main.ts / init.ts) before use
    $fpsOverlay: null,

    centerTile: { x: 0, y: 0 },

    dirtyMapCache: {},
    gParty: new Party(),

    uiMode: UIMode.none,

    punchModeIdx: 0,
    kickModeIdx: 0,

    mapAreas: null,

    knownAreas: new Set<number>(),

    // CE ref: game_movie.cc gameMovieIsSeen — bitmask of movies that have been triggered.
    // Used by _scriptsCheckGameEvents to fire ARTIMER story events only once.
    seenMovies: new Set<number>(),

    // Structured event log — populated by logger.eventLogPush().
    // Survives across map changes and is persisted with the save game.
    eventLog: [] as EventLogEntry[],

    // Cursor system
    cursorMode: 'move' as CursorMode,
    preScrollCursorMode: 'move' as CursorMode,
    cursorPos: { x: 0, y: 0 },
    showLookCursor: false,
    hoverActionIcon: null,
    hexCursorText: null,
    commandModeTimer: null as number | null,

    // CE ref: game_config.h:37 item_highlight — held purely as runtime input
    // state, NOT a saved preference. This is a DH2-specific QoL sweep (hold
    // a key to outline every item on screen) with no CE equivalent; kept
    // separate from Config.ui.itemHighlight, which is the actual CE
    // preference (a persistent options checkbox controlling whether hovering
    // the mouse over a single item outlines it — see input.ts mousemoved).
    highlightItemsKeyHeld: false,
    // CE ref: game_mouse.cc:680 — the single item currently under the mouse
    // cursor, outlined while Config.ui.itemHighlight is on. Cleared/updated
    // on every mousemove in input.ts.
    hoveredItem: null as Obj | null,

    gameUIDisabled: false,

    drugHandler: null,
    miscItemUseHandler: null,
} as {
    gMap: GameMap | null
    combat: Combat | null
    inCombat: boolean
    messageFiles: { [msgFile: string]: { [msgID: string]: string } }
    player: Player | null
    proMap: { [type: string]: { [id: number]: Proto } } | null // proto/pro.json, by type name then proto id

    skillMode: Skills

    isLoading: boolean
    backgroundMapLoad: boolean
    isInitializing: boolean
    loadingAssetsLoaded: number
    loadingAssetsTotal: number
    loadingLoadedCallback: (() => void) | null
    lazyAssetLoadingQueue: {
        [name: string]: ((img: any) => void)[] | undefined
    }

    images: { [name: string]: HTMLImageElement } // Image cache
    // undefined = cycle mask fetch not yet started/complete; null = no cycling pixels; CycleMask = animated
    cycleMasks: { [name: string]: CycleMask | null | undefined }
    imageInfo: { [art: string]: ImageInfo } | null // art/imageMap.json: frame counts, FPS, offsets
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
    seenMovies: Set<number>

    eventLog: EventLogEntry[]

    // Cursor system
    cursorMode: CursorMode
    preScrollCursorMode: CursorMode
    cursorPos: Point
    showLookCursor: boolean
    hoverActionIcon: string | null // the ARROW cursor's primary-action icon (input.ts)
    hexCursorText: { text: string; color: string } | null // the MOVE cursor's AP / X (input.ts)
    commandModeTimer: number | null

    highlightItemsKeyHeld: boolean
    hoveredItem: Obj | null

    gameUIDisabled: boolean

    // Drug use handler — set from main.ts after importing drugs.ts
    // to avoid circular import (object.ts -> scripting.ts -> object.ts)
    drugHandler: ((item: Obj, user: Critter) => boolean) | null
    // First Aid Kit / Doctor's Bag handler — set from main.ts for same reason
    miscItemUseHandler: ((item: Obj, user: Critter) => boolean) | null
}

export default globalState

if (typeof window !== 'undefined') {
    window.globalState = globalState
}
