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

// World Map module state, constants, DOM lifecycle, and travel loop —
// carved out of worldmap.ts. See wiki/ts-split-refactor.md §10.

import { scriptsCheckGameEvents } from '../gameTick.js'
import { areaContainingMap, loadAreas } from '../data.js'
import * as GameTime from '../gametime.js'
import { Point, pointIntersectsCircle } from '../geometry.js'
import globalState from '../globalState.js'
import { hidev, makeEl, showv, uiCloseWorldMap, uiWorldMapShowArea } from '../ui.js'
import { showConfirm } from '../ui_dialog.js'
import { clamp, getFileBinarySync, getFileText } from '../util.js'
import { Config } from '../config.js'
import { dbg } from '../logger.js'
import { Worldmap as WorldmapData, WorldmapPlayer } from './types.js'
import { parseWorldmap } from './parser.js'
import { didEncounter, doEncounter } from './encounters.js'

export const WORLDMAP_UNDISCOVERED = 0
export const WORLDMAP_DISCOVERED = 1
export const WORLDMAP_SEEN = 2

export const NUM_SQUARES_X = 4 * 7
export const NUM_SQUARES_Y = 5 * 6
// CE ref: worldmap.cc — worldmap.png is 1400×1500, 28×30 tiles → 50×50px per tile.
export const SQUARE_SIZE = 50

export const WORLDMAP_SPEED = 2 // speed scalar
export const WORLDMAP_ENCOUNTER_CHECK_RATE = 800 // ms (TODO: find right value)
// CE ref: worldmap.h:8 #define CAR_FUEL_MAX (80000)
export const CAR_FUEL_MAX = 80000

// CE ref: worldmap.cc:96-97 WM_TILE_WIDTH/HEIGHT, :1300 num_horizontal_tiles.
const WM_TILE_WIDTH = 7 * SQUARE_SIZE // 350 (7 subtiles wide)
const WM_TILE_HEIGHT = 6 * SQUARE_SIZE // 300 (6 subtiles tall)
const WM_NUM_HORIZONTAL_TILES = 4
const WM_WALK_MASK_ROW_BYTES = 44 // CE: 13200-byte mask = 300 rows x 44 bytes/row

const _walkMaskCache = new Map<string, Uint8Array | null>()

function loadWalkMask(name: string): Uint8Array | null {
    if (_walkMaskCache.has(name)) return _walkMaskCache.get(name)!
    let mask: Uint8Array | null = null
    try {
        // CE literal path is "data\%s.msk" (worldmap.cc:4225) — same "data\" prefix as
        // worldmap.txt, which DH2 fetches from data/data/ (DAT extraction root).
        const dv = getFileBinarySync(`data/data/${name}.msk`)
        mask = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)
    } catch {
        dbg('worldmap', `[Worldmap] walk mask load failed: ${name}`)
    }
    _walkMaskCache.set(name, mask)
    return mask
}

// CE ref: worldmap.cc:4244 wmWorldPosInvalid — true if (x,y) is blocked by the
// containing tile's walk mask (ocean, mountains...). Bit-test formula ported as-is,
// including CE's own "TODO: Check math." quirk, since the shipped .msk data was
// authored against this exact layout. (Restored 2026-10-06; lost in b282cca.)
export function worldPosInvalid(x: number, y: number): boolean {
    if (!worldmap) return false
    const tileIdx = Math.floor(y / WM_TILE_HEIGHT) * WM_NUM_HORIZONTAL_TILES
        + (Math.floor(x / WM_TILE_WIDTH) % WM_NUM_HORIZONTAL_TILES)
    const name = worldmap.walkMaskNames[tileIdx]
    if (!name) return false
    const mask = loadWalkMask(name)
    if (!mask) return false

    const lx = ((x % WM_TILE_WIDTH) + WM_TILE_WIDTH) % WM_TILE_WIDTH
    const ly = ((y % WM_TILE_HEIGHT) + WM_TILE_HEIGHT) % WM_TILE_HEIGHT
    const pos = ly * WM_WALK_MASK_ROW_BYTES + Math.floor(lx / 8)
    const bit = 1 << (Math.floor(lx / 8) & 3)
    return (mask[pos] & bit) !== 0
}

// Module-private mutable state. Exposed to sibling modules via the accessor
// helpers below.
let worldmap: WorldmapData = null
let worldmapPlayer: WorldmapPlayer = null
// CE ref: worldmap.h wmGenData.isInCar / wmGenData.carFuel — persisted across
// worldmap open/close cycles (init() recreates worldmapPlayer from these).
let _isInCar = false
let _carFuel = 0
// CE ref: worldmap.cc wmGenData.currentCarAreaId — area where the car is parked.
// Set when entering a local map while in car; returned by wmCarCurrentArea().
let _currentCarAreaId = -1
// Name of the specific local map the car is parked on (within _currentCarAreaId).
// Null = not yet parked. Used by mapLoader to inject the car only on the right map.
let $worldmap: HTMLElement | null = null
let $worldmapPlayer: HTMLElement | null = null
let $worldmapTarget: HTMLElement | null = null
let worldmapTimer: number = -1
let lastEncounterCheck = 0
let $worldMapDial: HTMLElement | null = null
let _lastDialFrame = -1
// Current viewport pan offset (pixels into the 1400×1500 worldmap).
let _panX = 0
let _panY = 0
// Keyboard/mouse-edge scroll state
const _heldKeys = new Set<string>()
let _mouseEdge = { left: false, right: false, top: false, bottom: false }
const PAN_SPEED = 8   // px per 75ms tick for manual scroll
const VIEW_W = 445    // #worldMapWorld viewport width  (CE WM_VIEW_WIDTH)
const VIEW_H = 438    // #worldMapWorld viewport height (CE WM_VIEW_HEIGHT)
const MAP_W = NUM_SQUARES_X * SQUARE_SIZE   // 1400
const MAP_H = NUM_SQUARES_Y * SQUARE_SIZE   // 1500
const EDGE_THRESHOLD = 20  // px from edge that triggers mouse-edge scroll

// Console command: window.giveCar([fuel]) — test helper standing in for the quest
// that hands over the Highwayman: sets GVAR_PLAYER_GOT_CAR (which the town map
// scripts check before placing the car) and parks the car in the current area
// (CE wmCarSetCurrentArea), or puts the party in it when outside any area.
if (typeof window !== 'undefined') {
    ;(window as any).giveCar = (fuel: number = CAR_FUEL_MAX) => {
        _carFuel = Math.min(CAR_FUEL_MAX, Math.max(0, fuel))
        if (worldmapPlayer) worldmapPlayer.carFuel = _carFuel
        setGlobalVarHook?.(GVAR_PLAYER_GOT_CAR, 1)
        const mapName = (globalState.gMap as any)?.name as string | undefined
        if (!globalState.mapAreas) {
            try { globalState.mapAreas = loadAreas() } catch (_) {}
        }
        const area = mapName && globalState.mapAreas ? areaContainingMap(mapName) : null
        if (area) {
            setIsInCar(false)
            _currentCarAreaId = area.id
            console.log(`Car parked in "${area.name}" — its map script places it on the next map load.`)
        } else {
            setIsInCar(true)
            console.log(`Car enabled (travel mode). Fuel: ${_carFuel} / ${CAR_FUEL_MAX}`)
        }
        updateCarUI()
    }
}

// game_vars.h car GVARs. Scripting registers the accessors (avoids a worldmap →
// scripting import cycle).
const GVAR_PLAYER_GOT_CAR = 18
const GVAR_CAR_BLOWER = 439
const GVAR_CAR_UPGRADE_FUEL_CELL_REGULATOR = 453
const GVAR_NEW_RENO_CAR_UPGRADE = 455
const GVAR_NEW_RENO_SUPER_CAR = 456
const CITY_CAR_OUT_OF_GAS = 21 // worldmap.h City enum
let setGlobalVarHook: ((gvar: number, value: number) => void) | null = null
let getGlobalVarHook: ((gvar: number) => number) | null = null
export function setWorldmapGlobalVarHooks(get: (gvar: number) => number, set: (gvar: number, value: number) => void): void {
    getGlobalVarHook = get
    setGlobalVarHook = set
}
const gvar = (n: number): number => getGlobalVarHook?.(n) ?? 0

// CE worldmap.cc:3025-3046 — the car takes 4 wmPartyWalkingStep()s per loop, +1 with
// the blower, +1 with the New Reno upgrade, +3 with the super car.
function carStepsPerTick(): number {
    let steps = 4
    if (gvar(GVAR_CAR_BLOWER)) steps += 1
    if (gvar(GVAR_NEW_RENO_CAR_UPGRADE)) steps += 1
    if (gvar(GVAR_NEW_RENO_SUPER_CAR)) steps += 3
    return steps
}

// CE worldmap.cc wmCarUseGas — once per loop regardless of the step count; the
// upgrades cut the cost (super car -90%, New Reno upgrade -10%, fuel cell regulator /2).
function carUseGas(amount: number): void {
    if (gvar(GVAR_NEW_RENO_SUPER_CAR) !== 0) amount -= Math.trunc(amount * 90 / 100)
    if (gvar(GVAR_NEW_RENO_CAR_UPGRADE) !== 0) amount -= Math.trunc(amount * 10 / 100)
    if (gvar(GVAR_CAR_UPGRADE_FUEL_CELL_REGULATOR) !== 0) amount = Math.trunc(amount / 2)
    _carFuel = Math.max(0, _carFuel - amount)
    worldmapPlayer.carFuel = _carFuel
}

function applyPan(px: number, py: number): void {
    _panX = clamp(0, MAP_W - VIEW_W, px)
    _panY = clamp(0, MAP_H - VIEW_H, py)
    $worldmap.style.transform = `translate(${-_panX}px, ${-_panY}px)`
}

// CE ref: worldmap.cc WM_WINDOW_DIAL_X=532/Y=48; wmInterfaceDialSyncTime.
// wmdial.png: 1392×29 — frmpixels.py writes ALL frames horizontally with maxW stride.
// wmdial.frm has 24 frames, each 58×29 (maxW=58). 24 × 58 = 1392px.
// CE artGetFrameCount = 24.  Frame formula: (gameHour/100 + 12) % 24.
const DIAL_FRAMES   = 24  // CE artGetFrameCount
const DIAL_FRAME_W  = 58  // each frame is 58px wide in the PNG (frmpixels maxW)

function updateDial(): void {
    if (!$worldMapDial) return
    // CE ref: worldmap.cc wmInterfaceDialSyncTime — frame = (gameHour/100 + 12) % artGetFrameCount
    // gameTimeGetHour() = 100*hour + minute (military time). Dividing by 100 gives fractional hours.
    // +12 shifts so noon=frame 0; % 24 wraps the full 24-hour cycle.
    const gameHour = GameTime.getHourMilitary()
    const frame = Math.floor((gameHour / 100 + 12) % DIAL_FRAMES)
    if (frame === _lastDialFrame) return
    _lastDialFrame = frame
    $worldMapDial.style.backgroundPositionX = -(frame * DIAL_FRAME_W) + 'px'
}

// CE ref: worldmap.cc wmInterfaceRefreshDate
// numbers.png: 360×17, frames packed at 9px stride (same as pipboy shell.ts DIGIT_W=9).
// Frames 0-9 = digits 0-9 (green). CE worldmap: offset = 9*digit in raw FRM data.
// months.png: 29×179, 12 entries × 15px stride, 14px visible. Month N (0-indexed) → backgroundPositionY = -(N*15)px.
const NUM_FRAME_W = 9    // matches pipboy DIGIT_W
const MON_FRAME_H = 15   // row stride in months.png

function setDigit(id: string, digit: number): void {
    const el = document.getElementById(id)
    if (el) el.style.backgroundPositionX = -(digit * NUM_FRAME_W) + 'px'
}

let _lastDateKey = ''

function updateDate(): void {
    const d = GameTime.getDate()
    const key = `${d.day}/${d.month}/${d.year}/${d.hours}/${d.minutes}`
    if (key === _lastDateKey) return
    _lastDateKey = key

    setDigit('wmDay1',  Math.floor(d.day / 10))
    setDigit('wmDay2',  d.day % 10)

    const monthEl = document.getElementById('wmMonth')
    if (monthEl) monthEl.style.backgroundPositionY = -(d.month * MON_FRAME_H) + 'px'

    const y = d.year
    setDigit('wmYear1', Math.floor(y / 1000) % 10)
    setDigit('wmYear2', Math.floor(y / 100) % 10)
    setDigit('wmYear3', Math.floor(y / 10) % 10)
    setDigit('wmYear4', y % 10)

    const h = d.hours, m = d.minutes
    setDigit('wmTime1', Math.floor(h / 10))
    setDigit('wmTime2', h % 10)
    setDigit('wmTime3', Math.floor(m / 10))
    setDigit('wmTime4', m % 10)
}

// Sibling-module accessors (used by encounters.ts).
export function getWorldmap(): WorldmapData {
    return worldmap
}
export function getWorldmapPlayer(): WorldmapPlayer {
    return worldmapPlayer
}

// CE ref: worldmap.cc wmCarGiveToParty / wmCarUseGas / wmCarFillGas / wmCarIsOutOfGas.
// The backing vars (_isInCar, _carFuel) survive worldmap open/close cycles;
// worldmapPlayer shadows them while the worldmap is open.
export function getIsInCar(): boolean { return _isInCar }
export function setIsInCar(val: boolean): void {
    _isInCar = val
    if (worldmapPlayer) worldmapPlayer.isInCar = val
}
export function getCarFuel(): number { return _carFuel }
export function setCarFuel(amount: number): void {
    _carFuel = Math.min(CAR_FUEL_MAX, Math.max(0, amount))
    if (worldmapPlayer) worldmapPlayer.carFuel = _carFuel
}
export function addCarFuel(amount: number): void {
    _carFuel = Math.min(CAR_FUEL_MAX, _carFuel + Math.max(0, amount))
    if (worldmapPlayer) worldmapPlayer.carFuel = _carFuel
}
export function fillCarFuel(): void {
    _carFuel = CAR_FUEL_MAX
    if (worldmapPlayer) worldmapPlayer.carFuel = CAR_FUEL_MAX
}
// CE ref: worldmap.cc wmGenData.currentCarAreaId / wmCarCurrentArea().
export function getCarAreaId(): number { return _currentCarAreaId }
export function setCarAreaId(areaId: number): void { _currentCarAreaId = areaId }

// wmcarmve.png: 1302×73 — 14 frames × 93px (art/imageMap.json), the same
// frmpixels.py horizontal-strip packing as wmdial.png. Cycled once per
// travel tick while actually driving, the same way updateDial() cycles on
// game-time change — see updateCarAnimation().
const CAR_ANIM_FRAMES = 14
const CAR_ANIM_FRAME_W = 93
let _carAnimFrame = 0

function updateCarAnimation(): void {
    const $car = document.getElementById('wmCarImage')
    if (!$car) return
    _carAnimFrame = (_carAnimFrame + 1) % CAR_ANIM_FRAMES
    $car.style.backgroundPositionX = -(_carAnimFrame * CAR_ANIM_FRAME_W) + 'px'
}

// Update the worldmap car overlay image + fuel bar visibility.
// CE ref: worldmap.cc:6179 wmInterfaceRefreshCarStatus — draws wmcarmve.frm or wmglobe.frm,
// plus wmInterfaceRefreshCarFuel (vertical bar at WM_WINDOW_CAR_FUEL_BAR_X=500,Y=339,H=70).
// wmScreenFrame (wmscreen.png) is the fixed bezel and is never toggled — like
// the dial's own frame, it stays visible; only the content behind it swaps.
export function updateCarUI(): void {
    const $car = document.getElementById('wmCarImage')
    const $globe = document.getElementById('wmGlobeImage')
    const $track = document.getElementById('wmCarFuelBarTrack')
    const $bar = document.getElementById('wmCarFuelBar')
    if (!$car || !$globe) return
    $car.hidden = !_isInCar
    $globe.hidden = _isInCar
    if (!_isInCar) {
        _carAnimFrame = 0
        $car.style.backgroundPositionX = '0px'
    }
    if ($track) $track.hidden = !_isInCar
    if (_isInCar && $bar) {
        // CE ref: worldmap.cc:6221 ratio = (70 * carFuel) / CAR_FUEL_MAX, rounded down to even.
        let ratio = Math.floor((70 * _carFuel) / CAR_FUEL_MAX)
        if (ratio & 1) ratio -= 1
        $bar.style.height = ratio + 'px'
    }
}

// CE ref: worldmap.cc wmGetPartyWorldPos — returns player pixel position on worldmap
export function getPlayerWorldPos(): { x: number; y: number } | null {
    if (!worldmapPlayer) return null
    return { x: Math.round(worldmapPlayer.x), y: Math.round(worldmapPlayer.y) }
}

export function positionToSquare(pos: Point): Point {
    return { x: Math.floor(pos.x / SQUARE_SIZE), y: Math.floor(pos.y / SQUARE_SIZE) }
}

export function setSquareStateAt(squarePos: Point, newState: number, seeAdjacent: boolean = true): void {
    if (squarePos.x < 0 || squarePos.x >= NUM_SQUARES_X || squarePos.y < 0 || squarePos.y >= NUM_SQUARES_Y) return

    const oldState = worldmap.squares[squarePos.x][squarePos.y].state
    worldmap.squares[squarePos.x][squarePos.y].state = newState

    if (oldState === WORLDMAP_DISCOVERED && newState === WORLDMAP_SEEN) return

    // console.log( worldmap.squares[squarePos.x][squarePos.y].fillType )

    // the square element at squarePos
    const stateName: { [state: number]: string } = {}
    stateName[WORLDMAP_UNDISCOVERED] = 'undiscovered'
    stateName[WORLDMAP_DISCOVERED] = 'discovered'
    stateName[WORLDMAP_SEEN] = 'seen'

    //console.log("square: " + squarePos.x + ", " + squarePos.y + " | " + stateName[oldState] + " | " + stateName[newState])

    const $square = document.querySelector(
        `div.worldmapSquare[square-x='${squarePos.x}'][square-y='${squarePos.y}']`
    )
    $square.classList.remove('worldmapSquare-' + stateName[oldState])
    $square.classList.add('worldmapSquare-' + stateName[newState])

    if (seeAdjacent === true) {
        setSquareStateAt({ x: squarePos.x - 1, y: squarePos.y }, WORLDMAP_SEEN, false)
        if (worldmap.squares[squarePos.x][squarePos.y].fillType === 'fill_w') return // only fill the left tile
        setSquareStateAt({ x: squarePos.x + 1, y: squarePos.y }, WORLDMAP_SEEN, false)

        setSquareStateAt({ x: squarePos.x, y: squarePos.y - 1 }, WORLDMAP_SEEN, false)
        setSquareStateAt({ x: squarePos.x, y: squarePos.y + 1 }, WORLDMAP_SEEN, false)

        // diagonals
        setSquareStateAt({ x: squarePos.x - 1, y: squarePos.y - 1 }, WORLDMAP_SEEN, false)
        setSquareStateAt({ x: squarePos.x + 1, y: squarePos.y - 1 }, WORLDMAP_SEEN, false)
        setSquareStateAt({ x: squarePos.x - 1, y: squarePos.y + 1 }, WORLDMAP_SEEN, false)
        setSquareStateAt({ x: squarePos.x + 1, y: squarePos.y + 1 }, WORLDMAP_SEEN, false)
    }
}

// Matches .areaSize-small/medium/large in ui.css. Used instead of the
// areaCircle element's live offsetWidth/offsetHeight — see the
// WORLDMAP_TARGET_W/H comment below for why: the circles are first created
// and centered from init(), while the worldmap panel is still display:none,
// where offsetWidth/offsetHeight both read 0 and silently turn "centered"
// into an uncentered top-left placement instead.
const AREA_CIRCLE_SIZE: { [size: string]: number } = { small: 8, medium: 32, large: 64 }

// CE ref: worldmap.cc wmAreaSetPos() — moves a town-marker DOM element to match
// updated worldPosition after a script calls wm_area_set_pos.
// One marker per area whose state isn't CITY_STATE_UNKNOWN (CE worldmap.cc:5225
// wmInterfaceRefresh draws exactly those). Re-run whenever an area's state changes.
export function refreshAreaMarkers(): void {
    if (!$worldmap || !globalState.mapAreas) return
    for (const key in globalState.mapAreas) {
        const area = globalState.mapAreas[key]
        const $existing = $worldmap.querySelector<HTMLElement>(`[data-area-key="${key}"]`)
        if (area.state !== true) {
            $existing?.remove()
            continue
        }
        if ($existing) continue

        const $area = makeEl('div', { classes: ['area'], attrs: { 'data-area-key': key } })
        $worldmap.appendChild($area)

        const $el = makeEl('div', { classes: ['areaCircle', 'areaSize-' + area.size] })
        $area.appendChild($el)

        // transform the circle since (0,0) is the top-left instead of center.
        // Uses the fixed CSS size (AREA_CIRCLE_SIZE), not $el.offsetWidth/
        // offsetHeight — this can run while the worldmap panel is still
        // display:none (first open), where both would read 0.
        const circleSize = AREA_CIRCLE_SIZE[area.size] ?? 0
        $area.style.left = (area.worldPosition.x - circleSize / 2) + 'px'
        $area.style.top = (area.worldPosition.y - circleSize / 2) + 'px'

        const $label = makeEl('div', {
            classes: ['areaLabel'],
            style: { left: '0px', top: 2 + circleSize + 'px' },
        })
        $area.appendChild($label)
        $label.textContent = area.name
    }
}

// CE worldmap.cc wmAreaSetVisibleState (+ force) — known/unknown on the worldmap.
// globalState.knownAreas mirrors it for the scripting/endgame checks that read it.
export function setAreaVisible(areaId: number, visible: boolean): void {
    const area = globalState.mapAreas?.[areaId]
    if (area) area.state = visible
    if (visible) globalState.knownAreas.add(areaId)
    else globalState.knownAreas.delete(areaId)
    refreshAreaMarkers()
}

// CE worldmap.cc wmAreaMarkVisitedState — 1 known, 2 visited (a first visit lands on 1).
export function setAreaVisitedState(areaId: number, state: number): void {
    const area: any = globalState.mapAreas?.[areaId]
    if (!area) return
    const old = area.visitedState ?? 0
    area.visitedState = state
    if (state === 2 && old === 0) area.visitedState = 1
}

// Save/load of the area states (CE worldmap.cc wmWorldMapSave/Load: state, visitedState, x, y).
export function serializeAreaStates(): { [id: string]: { state: boolean; visitedState: number; x: number; y: number } } {
    const out: { [id: string]: { state: boolean; visitedState: number; x: number; y: number } } = {}
    for (const key in globalState.mapAreas ?? {}) {
        const area: any = globalState.mapAreas[key]
        out[key] = { state: area.state === true, visitedState: area.visitedState ?? 0, x: area.worldPosition.x, y: area.worldPosition.y }
    }
    return out
}
export function deserializeAreaStates(data: { [id: string]: { state: boolean; visitedState: number; x: number; y: number } } | undefined): void {
    if (!data || !globalState.mapAreas) return
    for (const key in data) {
        const area: any = globalState.mapAreas[key]
        if (!area) continue
        area.state = data[key].state
        area.visitedState = data[key].visitedState
        area.worldPosition = { x: data[key].x, y: data[key].y }
        updateAreaMarkerPos(key, area.worldPosition.x, area.worldPosition.y)
    }
    refreshAreaMarkers()
}

export function updateAreaMarkerPos(areaKey: string, x: number, y: number): void {
    if (!$worldmap) return
    const $area = $worldmap.querySelector<HTMLElement>(`[data-area-key="${areaKey}"]`)
    if (!$area) return
    const size = AREA_CIRCLE_SIZE[globalState.mapAreas?.[areaKey]?.size] ?? 0
    $area.style.left = (x - size / 2) + 'px'
    $area.style.top  = (y - size / 2) + 'px'
}

// #worldmapTarget's CSS box (ui.css) is fixed at 25x13 to fit the
// hotspot1.png/hotspot2.png triangle, but it's reused for wmaptarg.png (the
// crosshair shown while walking to a just-clicked destination), which is a
// smaller, differently-shaped 11x11 image rendered at the box's top-left
// (default background-position). Centering the 25x13 BOX on a click would
// leave the smaller crosshair graphic sitting off-center within it, so each
// image needs centering against its own real pixel size, not the box's.
// Sizes are hardcoded (not measured via offsetWidth/offsetHeight) because
// centerWorldmapTarget's first call happens from init(), before the
// worldmap panel is ever shown — under a display:none ancestor,
// offsetWidth/offsetHeight both read 0, silently turning "centered" into an
// uncentered top-left placement instead.
const WORLDMAP_TARGET_W = 25
const WORLDMAP_TARGET_H = 13
const WORLDMAP_CROSSHAIR_W = 11
const WORLDMAP_CROSSHAIR_H = 11

function centerWorldmapTarget(x: number, y: number): void {
    $worldmapTarget.style.left = ((x - WORLDMAP_TARGET_W / 2) | 0) + 'px'
    $worldmapTarget.style.top = ((y - WORLDMAP_TARGET_H / 2) | 0) + 'px'
}

function centerWorldmapCrosshair(x: number, y: number): void {
    $worldmapTarget.style.left = ((x - WORLDMAP_CROSSHAIR_W / 2) | 0) + 'px'
    $worldmapTarget.style.top = ((y - WORLDMAP_CROSSHAIR_H / 2) | 0) + 'px'
}

// The hotspot1.png/hotspot2.png triangle shares one silhouette clipped via
// the wmHotspotShape CSS class (ui.css); wmaptarg.png (the crosshair shown
// while a target is still being walked to) is a different shape and must
// not be clipped the same way — toggle the class alongside the image so
// the clickable area always matches whichever graphic is actually showing.
function setTargetImage(url: string, isHotspot: boolean): void {
    $worldmapTarget.style.backgroundImage = `url('${url}')`
    $worldmapTarget.classList.toggle('wmHotspotShape', isHotspot)
}

export function init(): void {
    /*$("#worldmap").mousemove(function(e) {
        var offset = $(this).offset()
        var x = e.pageX - parseInt(offset.left)
        var y = e.pageY - parseInt(offset.top)

        var scrollLeft = $(this).scrollLeft()
        var scrollTop = $(this).scrollTop()

        console.log(scrollLeft + " | " +  $(this).width())

        if(x <= 15) $(this).scrollLeft(scrollLeft - 15)
        if(x >= $(this).width() - 15) { console.log("y"); $(this).scrollLeft(scrollLeft + 15) }

        console.log(x + ", " + y)
    })*/

    $worldmapPlayer = document.getElementById('worldmapPlayer')
    $worldmapTarget = document.getElementById('worldmapTarget')
    $worldmap = document.getElementById('worldmap')
    $worldMapDial = document.getElementById('worldMapDial')
    _lastDialFrame = -1
    _lastDateKey = ''
    updateDial()
    updateDate()

    worldmap = parseWorldmap(getFileText('data/data/worldmap.txt'))

    if (!globalState.mapAreas) globalState.mapAreas = loadAreas()

    $worldmap.onclick = function (this: HTMLElement, e: MouseEvent) {
        // Calculate viewport-relative offset
        const box = this.getBoundingClientRect()
        const offsetLeft = box.left | (0 + window.pageXOffset)
        const offsetTop = box.top | (0 + window.pageYOffset)

        const x = e.pageX - offsetLeft
        const y = e.pageY - offsetTop

        // getBoundingClientRect() returns the visual (post-transform) position of
        // #worldmap, so x/y already encode the pan offset. Adding _panX again would
        // double it — use x/y directly as worldmap coordinates.
        const ax = x
        const ay = y

        worldmapPlayer.target = { x: ax, y: ay }
        showv($worldmapPlayer)
        setTargetImage('art/intrface/wmaptarg.png', false)
        centerWorldmapCrosshair(ax, ay)
        dbg('worldmap', 'targeting: ' + ax + ', ' + ay)
    }

    // CE ref: worldmap.cc:3124-3157 — hotspot shows pressed image while mouse held,
    // clicking a known area hotspot opens the area map.
    $worldmapTarget.onmousedown = function () {
        const area = withinArea(worldmapPlayer)
        if (area !== null) {
            setTargetImage('art/intrface/hotspot2.png', true)
        }
    }
    $worldmapTarget.onmouseup = function (e: MouseEvent) {
        const area = withinArea(worldmapPlayer)
        if (area !== null) {
            setTargetImage('art/intrface/hotspot1.png', true)
            e.stopPropagation()
            uiWorldMapShowArea(area)
        }
    }
    $worldmapTarget.onmouseleave = function () {
        // revert to normal if mouse leaves without releasing
        if ($worldmapTarget.style.backgroundImage.includes('hotspot2')) {
            setTargetImage('art/intrface/hotspot1.png', true)
        }
    }
    $worldmapTarget.onclick = null  // handled by mouseup above

    refreshAreaMarkers()

    for (let x = 0; x < NUM_SQUARES_X; x++) {
        for (let y = 0; y < NUM_SQUARES_Y; y++) {
            let state: string | number = worldmap.squares[x][y].state
            if (state === WORLDMAP_UNDISCOVERED) state = 'undiscovered'
            else if (state === WORLDMAP_DISCOVERED) state = 'discovered'
            else if (state === WORLDMAP_SEEN) state = 'seen'

            const $el = makeEl('div', {
                classes: ['worldmapSquare', 'worldmapSquare-' + state],
                style: {
                    left: x * SQUARE_SIZE + 'px',
                    top: y * SQUARE_SIZE + 'px',
                },
                attrs: {
                    'square-x': x + '',
                    'square-y': y + '',
                },
            })
            $worldmap.appendChild($el)
        }
    }

    worldmapPlayer = {
        x: globalState.mapAreas[0].worldPosition.x,
        y: globalState.mapAreas[0].worldPosition.y,
        target: null,
        // CE ref: worldmap.cc wmGenData — restored from backing vars so car
        // state survives worldmap open/close and save/load cycles.
        isInCar: _isInCar,
        carFuel: _carFuel,
    }

    // CE ref: worldmap.cc — hotspot/target marker is centered on the world
    // position, matching centerWorldmapTarget()'s convention used everywhere
    // else (area circles are likewise centered on area.worldPosition). A raw
    // top-left assignment here would offset the marker by half its own size
    // relative to where every other call site places it.
    centerWorldmapTarget(worldmapPlayer.x, worldmapPlayer.y)

    setSquareStateAt(positionToSquare(worldmapPlayer), WORLDMAP_DISCOVERED)

    if (withinArea(worldmapPlayer) !== null) {
        hidev($worldmapPlayer)
        setTargetImage('art/intrface/hotspot1.png', true)
    }

    // Keyboard scroll
    document.addEventListener('keydown', _onWMKeyDown)
    document.addEventListener('keyup',   _onWMKeyUp)

    // Mouse-edge scroll — track cursor position relative to #worldMapWorld
    const $worldMapWorld = document.getElementById('worldMapWorld')
    if ($worldMapWorld) {
        $worldMapWorld.addEventListener('mousemove', _onWMMouseMove)
        $worldMapWorld.addEventListener('mouseleave', _onWMMouseLeave)
    }

    // Apply initial pan so the map starts centred on the player
    applyPan(worldmapPlayer.x - VIEW_W / 2, worldmapPlayer.y - VIEW_H / 2)

    // CE ref: worldmap.cc:6179 — sync car image + globe overlay visibility on open.
    updateCarUI()
}

function _onWMKeyDown(e: KeyboardEvent): void { _heldKeys.add(e.key) }
function _onWMKeyUp(e: KeyboardEvent): void   { _heldKeys.delete(e.key) }
function _onWMMouseMove(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    _mouseEdge = {
        left:   mx < EDGE_THRESHOLD,
        right:  mx > VIEW_W - EDGE_THRESHOLD,
        top:    my < EDGE_THRESHOLD,
        bottom: my > VIEW_H - EDGE_THRESHOLD,
    }
}
function _onWMMouseLeave(): void {
    _mouseEdge = { left: false, right: false, top: false, bottom: false }
}

export function start() {
    updateWorldmapPlayer()
}

export function stop() {
    clearTimeout(worldmapTimer)
    _heldKeys.clear()
    _mouseEdge = { left: false, right: false, top: false, bottom: false }
    document.removeEventListener('keydown', _onWMKeyDown)
    document.removeEventListener('keyup',   _onWMKeyUp)
    const $worldMapWorld = document.getElementById('worldMapWorld')
    if ($worldMapWorld) {
        $worldMapWorld.removeEventListener('mousemove', _onWMMouseMove)
        $worldMapWorld.removeEventListener('mouseleave', _onWMMouseLeave)
    }
}

// check if we're inside an area
export function withinArea(position: Point) {
    for (const areaNum in globalState.mapAreas) {
        const area = globalState.mapAreas[areaNum]
        const radius = area.size === 'large' ? 32 : 16 // guessing for now

        if (pointIntersectsCircle(area.worldPosition, radius, position)) {
            dbg('worldmap', 'intersects ' + area.name)
            return area
        }
    }

    return null
}

// CE ref: worldmap.cc:3052-3082 — out of gas: travel stops, the party leaves the car,
// and the car stays in the area here, or at CITY_CAR_OUT_OF_GAS moved to this spot
// (its map script then places the car there).
function carRanOutOfGas(): void {
    dbg('worldmap', 'Ran outta gas!')
    worldmapPlayer.target = null
    setIsInCar(false)
    const area = withinArea(worldmapPlayer)
    if (area) {
        _currentCarAreaId = area.id
    } else {
        _currentCarAreaId = CITY_CAR_OUT_OF_GAS
        const outOfGas = globalState.mapAreas?.[CITY_CAR_OUT_OF_GAS]
        if (outOfGas) {
            outOfGas.worldPosition = { x: Math.round(worldmapPlayer.x), y: Math.round(worldmapPlayer.y) }
            ;(outOfGas as any).visitedState = 1
            setAreaVisible(CITY_CAR_OUT_OF_GAS, true) // CITY_STATE_KNOWN
            updateAreaMarkerPos(String(CITY_CAR_OUT_OF_GAS), outOfGas.worldPosition.x, outOfGas.worldPosition.y)
        }
    }
}

export function updateWorldmapPlayer() {
    $worldmapPlayer.style.left = worldmapPlayer.x + 'px'
    $worldmapPlayer.style.top = worldmapPlayer.y + 'px'

    if (worldmapPlayer.target) {
        let dx = worldmapPlayer.target.x - worldmapPlayer.x
        let dy = worldmapPlayer.target.y - worldmapPlayer.y
        const len = Math.sqrt(dx * dx + dy * dy)

        const squarePos = positionToSquare(worldmapPlayer)
        const currentSquare = worldmap.squares[squarePos.x][squarePos.y]

        // CE ref: worldmap.cc:3025-3046 — the car makes carStepsPerTick() steps per
        // loop (4 base, up to 9 with upgrades); WORLDMAP_SPEED is DH2's one-step px/tick.
        const inCar = worldmapPlayer.isInCar && worldmapPlayer.carFuel > 0
        const carMult = inCar ? carStepsPerTick() : 1
        const speed = (WORLDMAP_SPEED * carMult) / worldmap.terrainSpeed[currentSquare.terrainType]

        if (inCar) updateCarAnimation()

        // CE ref: worldmap.cc:4335-4341 wmPartyWalkingStep — a step into walk-mask-
        // blocked terrain halts travel in place instead of arriving / continuing.
        const haltTravel = () => {
            worldmapPlayer.target = null
            hidev($worldmapPlayer)
            setTargetImage('art/intrface/hotspot1.png', true)
            centerWorldmapTarget(worldmapPlayer.x, worldmapPlayer.y)
        }

        if (len < speed) {
            if (worldPosInvalid(Math.round(worldmapPlayer.target.x), Math.round(worldmapPlayer.target.y))) {
                haltTravel()
            } else {
                worldmapPlayer.x = worldmapPlayer.target.x
                worldmapPlayer.y = worldmapPlayer.target.y
                haltTravel()
            }
        } else {
            // normalize direction
            dx /= len
            dy /= len

            const nextX = worldmapPlayer.x + dx * speed
            const nextY = worldmapPlayer.y + dy * speed
            if (worldPosInvalid(Math.round(nextX), Math.round(nextY))) {
                haltTravel()
            } else {
                // head towards it
                worldmapPlayer.x = nextX
                worldmapPlayer.y = nextY
            }
        }

        // CE ref: worldmap.cc:3048 wmCarUseGas(100) — once per loop, after all the steps.
        if (inCar) {
            carUseGas(100)
            if (_carFuel <= 0) carRanOutOfGas()
            updateCarUI()
        }

        // CE ref: worldmap.cc wmGameTimeIncrement(18000) — 30 game-minutes per 1-pixel step.
        // DH2 moves WORLDMAP_SPEED=2 px/tick. CE-equivalent rate = 30×2 = 60 min/tick, but
        // that makes the clock spin every frame. 10 min/tick keeps the dial visibly animated
        // (~450ms per hour-frame) while crossing the map in ~2 in-game days.
        // Time per pixel = 10 min/tick ÷ 2 px/tick = 5 min/px — terrain-independent.
        const travelScale = 1 / worldmap.terrainSpeed[currentSquare.terrainType]
        // CE ref: worldmap.cc:4180 — Pathfinder perk reduces ticks by 25% per rank
        const pathfinderRank = globalState.player?.perks.filter((p: string) => p === 'Pathfinder').length ?? 0
        const pathfinderMult = Math.max(0, 1 - pathfinderRank * 0.25)
        GameTime.advanceMinutes(Math.max(1, Math.round(10 * travelScale * pathfinderMult)))
        updateDial()
        updateDate()

        // CE ref: worldmap.cc:3017 wmCheckGameEvents — story events (ARTIMER movies,
        // Arroyo failure) are checked continuously while travelling, not only at midnight.
        scriptsCheckGameEvents(GameTime.getTotalDays())

        // CE ref: worldmap.cc wmInterfaceScrollMap — pan viewport to keep player centred.
        applyPan(Math.floor(worldmapPlayer.x - VIEW_W / 2), Math.floor(worldmapPlayer.y - VIEW_H / 2))

        if (currentSquare.state !== WORLDMAP_DISCOVERED) setSquareStateAt(squarePos, WORLDMAP_DISCOVERED)

        // check for encounters
        // CE ref: worldmap.cc wmRndEncounterOccurred:3341 — skip if player is within any town area
        const time = window.performance.now()
        if (Config.engine.doEncounters === true && time >= lastEncounterCheck + WORLDMAP_ENCOUNTER_CHECK_RATE
                && withinArea(worldmapPlayer) === null) {
            lastEncounterCheck = time

            const encResult = didEncounter()
            if (encResult !== 'none') {
                $worldmapPlayer.style.backgroundImage = "url('art/intrface/wmapfgt0.png')"
                clearTimeout(worldmapTimer)

                // CE ref: worldmap.cc:3504 wmRndEncounterOccurred — when detected,
                // show YES/NO dialog; skip encounter on NO. Msg 2999 title, 3000+
                // per-entry body. DH2: fixed message (worldmap.msg not loaded).
                const doIt = async () => {
                    if (encResult === 'avoidable') {
                        const engage = await showConfirm('You have spotted an encounter.\nDo you wish to engage?')
                        if (!engage) {
                            $worldmapPlayer.style.backgroundImage = "url('art/intrface/wmaploc.png')"
                            worldmapTimer = setTimeout(updateWorldmapPlayer, 75)
                            return
                        }
                    }
                    await new Promise<void>(r => setTimeout(r, 1000))
                    doEncounter()
                    uiCloseWorldMap()
                    $worldmapPlayer.style.backgroundImage = "url('art/intrface/wmaploc.png')"
                }
                void doIt()
                return
            }
        }
    }

    // Keyboard and mouse-edge panning (active even when player is stationary).
    // CE ref: worldmap.cc WM_SCROLL_* — map can be scrolled independently of travel.
    if (!worldmapPlayer.target) {
        let dx = 0
        let dy = 0
        if (_heldKeys.has('ArrowLeft')  || _heldKeys.has('a') || _heldKeys.has('A') || _mouseEdge.left)   dx -= PAN_SPEED
        if (_heldKeys.has('ArrowRight') || _heldKeys.has('d') || _heldKeys.has('D') || _mouseEdge.right)  dx += PAN_SPEED
        if (_heldKeys.has('ArrowUp')    || _heldKeys.has('w') || _heldKeys.has('W') || _mouseEdge.top)    dy -= PAN_SPEED
        if (_heldKeys.has('ArrowDown')  || _heldKeys.has('s') || _heldKeys.has('S') || _mouseEdge.bottom) dy += PAN_SPEED
        if (dx !== 0 || dy !== 0) applyPan(_panX + dx, _panY + dy)
    }

    worldmapTimer = setTimeout(updateWorldmapPlayer, 75)
}
