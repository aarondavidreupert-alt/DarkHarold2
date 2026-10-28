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
import * as Events from '../events.js'
import { areaContainingMap, loadAreas, lookupMapName, mapIsSaved, type Area } from '../data.js'
import * as GameTime from '../gametime.js'
import { Point } from '../geometry.js'
import { world } from '../state/world.js'
import { hidev, makeEl, showv, uiCloseWorldMap, uiWorldMapShowArea } from '../ui.js'
import { showConfirm } from '../uiDialog.js'
import { clamp, getFileBinarySync, getFileText, getMessage } from '../util.js'
import { Config } from '../config.js'
import { dbg } from '../logger.js'
import { Worldmap as WorldmapData, WorldmapPlayer } from './types.js'
import { parseWorldmap } from './parser.js'
import {
    cancelEncounter,
    EncounterRoll,
    resetEncounterTimer,
    rndEncounterOccurred,
    setupRandomEncounter,
} from './encounters.js'
import { drawHP } from '../hudRefresh.js'
import { assetUrl } from '../modAssets.js'

export const WORLDMAP_UNDISCOVERED = 0
export const WORLDMAP_DISCOVERED = 1
export const WORLDMAP_SEEN = 2

export const NUM_SQUARES_X = 4 * 7
export const NUM_SQUARES_Y = 5 * 6
// CE ref: worldmap.cc — art/worldmap.png (stitch_worldmap stage) is 1400×1500, 28×30 tiles → 50×50px per tile.
export const SQUARE_SIZE = 50

// CE wmWorldMapFunc runs one loop per frame of the 60 fps limiter (sharedFpsLimiter);
// every walking frame is a wmPartyWalkingStep (1 px, terrain permitting) and 30 game
// minutes (wmGameTimeIncrement(18000)).
const FRAME_MS = 1000 / 60
const WALK_FRAME_TICKS = 18000
const WM_START_X = 173
const WM_START_Y = 122
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
    const tileIdx =
        Math.floor(y / WM_TILE_HEIGHT) * WM_NUM_HORIZONTAL_TILES +
        (Math.floor(x / WM_TILE_WIDTH) % WM_NUM_HORIZONTAL_TILES)
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
let worldmap: WorldmapData | null = null
let worldmapPlayer: WorldmapPlayer | null = null
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
// CE wmGenData walking state — wmPartyInitWalking sets up a Bresenham line,
// wmPartyWalkingStep advances it one pixel.
const walk = {
    isWalking: false,
    distance: 0,
    lineDelta: 0,
    mainAxisStep: 0,
    crossAxisStep: 0,
    mainX: 0,
    mainY: 0,
    crossX: 0,
    crossY: 0,
}
let terrainCounter = 1 // CE _terrainCounter
// CE wmGenData.currentAreaId: the area the party is at (-1 out in the wastes) —
// set when a walk ends, cleared when one starts, moved by map transitions
let currentAreaId = -1
let gameTimeIncRemainder = 0 // CE gGameTimeIncRemainder (sfall Pathfinder fix)
let partyHealTime = 0
let $worldMapDial: HTMLElement | null = null
let _lastDialFrame = -1
// Current viewport pan offset (pixels into the 1400×1500 worldmap).
let _panX = 0
let _panY = 0
// Keyboard/mouse-edge scroll state
const _heldKeys = new Set<string>()
let _mouseEdge = { left: false, right: false, top: false, bottom: false }
const PAN_SPEED = 2 // px per frame for manual scroll
const VIEW_W = 445 // #worldMapWorld viewport width  (CE WM_VIEW_WIDTH)
const VIEW_H = 438 // #worldMapWorld viewport height (CE WM_VIEW_HEIGHT)
const MAP_W = NUM_SQUARES_X * SQUARE_SIZE // 1400
const MAP_H = NUM_SQUARES_Y * SQUARE_SIZE // 1500
const EDGE_THRESHOLD = 20 // px from edge that triggers mouse-edge scroll

// Console command giveCar([fuel]) (play.html#dev, src/devConsole) — test helper standing in for the quest
// that hands over the Highwayman: sets GVAR_PLAYER_GOT_CAR (which the town map
// scripts check before placing the car) and parks the car in the current area
// (CE wmCarSetCurrentArea), or puts the party in it when outside any area.
export function giveCar(fuel: number = CAR_FUEL_MAX): void {
    _carFuel = Math.min(CAR_FUEL_MAX, Math.max(0, fuel))
    if (worldmapPlayer) worldmapPlayer.carFuel = _carFuel
    setGlobalVarHook?.(GVAR_PLAYER_GOT_CAR, 1)
    const mapName = world.gMap?.name as string | undefined
    if (!world.mapAreas) {
        try {
            world.mapAreas = loadAreas()
        } catch (_) {}
    }
    const area = mapName && world.mapAreas ? areaContainingMap(mapName) : null
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
export function setWorldmapGlobalVarHooks(
    get: (gvar: number) => number,
    set: (gvar: number, value: number) => void,
): void {
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
    if (gvar(GVAR_NEW_RENO_SUPER_CAR) !== 0) amount -= Math.trunc((amount * 90) / 100)
    if (gvar(GVAR_NEW_RENO_CAR_UPGRADE) !== 0) amount -= Math.trunc((amount * 10) / 100)
    if (gvar(GVAR_CAR_UPGRADE_FUEL_CELL_REGULATOR) !== 0) amount = Math.trunc(amount / 2)
    _carFuel = Math.max(0, _carFuel - amount)
    worldmapPlayer!.carFuel = _carFuel
}

function applyPan(px: number, py: number): void {
    _panX = clamp(0, MAP_W - VIEW_W, px)
    _panY = clamp(0, MAP_H - VIEW_H, py)
    $worldmap!.style.transform = `translate(${-_panX}px, ${-_panY}px)`
}

// CE ref: worldmap.cc WM_WINDOW_DIAL_X=532/Y=48; wmInterfaceDialSyncTime.
// wmdial.png: 1392×29 — frmpixels.py writes ALL frames horizontally with maxW stride.
// wmdial.frm has 24 frames, each 58×29 (maxW=58). 24 × 58 = 1392px.
// CE artGetFrameCount = 24.  Frame formula: (gameHour/100 + 12) % 24.
const DIAL_FRAMES = 24 // CE artGetFrameCount
const DIAL_FRAME_W = 58 // each frame is 58px wide in the PNG (frmpixels maxW)

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
const NUM_FRAME_W = 9 // matches pipboy DIGIT_W
const MON_FRAME_H = 15 // row stride in months.png

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

    setDigit('wmDay1', Math.floor(d.day / 10))
    setDigit('wmDay2', d.day % 10)

    const monthEl = document.getElementById('wmMonth')
    if (monthEl) monthEl.style.backgroundPositionY = -(d.month * MON_FRAME_H) + 'px'

    const y = d.year
    setDigit('wmYear1', Math.floor(y / 1000) % 10)
    setDigit('wmYear2', Math.floor(y / 100) % 10)
    setDigit('wmYear3', Math.floor(y / 10) % 10)
    setDigit('wmYear4', y % 10)

    const h = d.hours,
        m = d.minutes
    setDigit('wmTime1', Math.floor(h / 10))
    setDigit('wmTime2', h % 10)
    setDigit('wmTime3', Math.floor(m / 10))
    setDigit('wmTime4', m % 10)
}

// Sibling-module accessors (used by encounters.ts).
export function getWorldmap(): WorldmapData {
    return worldmap!
}
export function getWorldmapPlayer(): WorldmapPlayer {
    return worldmapPlayer!
}

// CE ref: worldmap.cc wmCarGiveToParty / wmCarUseGas / wmCarFillGas / wmCarIsOutOfGas.
// The backing vars (_isInCar, _carFuel) survive worldmap open/close cycles;
// worldmapPlayer shadows them while the worldmap is open.
export function getIsInCar(): boolean {
    return _isInCar
}
export function setIsInCar(val: boolean): void {
    _isInCar = val
    if (worldmapPlayer) worldmapPlayer.isInCar = val
}
export function getCarFuel(): number {
    return _carFuel
}
export function setCarFuel(amount: number): void {
    _carFuel = Math.min(CAR_FUEL_MAX, Math.max(0, amount))
    if (worldmapPlayer) worldmapPlayer.carFuel = _carFuel
}
// CE worldmap.cc wmCarFillGas: the fuel goes up by `amount` (a negative one takes some away);
// past CAR_FUEL_MAX the tank is full and the result is the room there was, else 0.
export function addCarFuel(amount: number): number {
    let result = 0
    if (amount + _carFuel <= CAR_FUEL_MAX) _carFuel += amount
    else {
        result = CAR_FUEL_MAX - _carFuel
        _carFuel = CAR_FUEL_MAX
    }
    if (worldmapPlayer) worldmapPlayer.carFuel = _carFuel
    return result
}
export function fillCarFuel(): void {
    _carFuel = CAR_FUEL_MAX
    if (worldmapPlayer) worldmapPlayer.carFuel = CAR_FUEL_MAX
}
// CE ref: worldmap.cc wmGenData.currentCarAreaId / wmCarCurrentArea().
export function getCarAreaId(): number {
    return _currentCarAreaId
}
export function setCarAreaId(areaId: number): void {
    _currentCarAreaId = areaId
}

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
// In the car: the car animation, its wmscreen.frm overlay and the fuel bar drawn on
// top of the overlay; otherwise only the globe overlay (no screen frame).
export function updateCarUI(): void {
    const $car = document.getElementById('wmCarImage')
    const $globe = document.getElementById('wmGlobeImage')
    const $frame = document.getElementById('wmScreenFrame')
    const $track = document.getElementById('wmCarFuelBarTrack')
    const $bar = document.getElementById('wmCarFuelBar')
    if (!$car || !$globe) return
    $car.hidden = !_isInCar
    $globe.hidden = _isInCar
    if ($frame) $frame.hidden = !_isInCar
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

// CE ref: worldmap.cc wmWorldMapLoad — wmGenData.worldPosX/Y come back from the save.
export function setPlayerWorldPos(x: number, y: number): void {
    if (!worldmapPlayer) return
    worldmapPlayer.x = x
    worldmapPlayer.y = y
    worldmapPlayer.target = null
    walk.isWalking = false
    walk.distance = 0
    centerWorldmapTarget(x, y)
    if ($worldmapPlayer) hidev($worldmapPlayer)
    setTargetImage('art/intrface/hotspot1.png', true)
}

export function positionToSquare(pos: Point): Point {
    return { x: Math.floor(pos.x / SQUARE_SIZE), y: Math.floor(pos.y / SQUARE_SIZE) }
}

const SQUARE_STATE_CLASS: { [state: number]: string } = {
    [WORLDMAP_UNDISCOVERED]: 'undiscovered',
    [WORLDMAP_DISCOVERED]: 'discovered',
    [WORLDMAP_SEEN]: 'seen',
}

// CE wmMarkSubTileOffsetVisitedFunc: a subtile becomes known (SEEN) only while still
// unknown; visited (DISCOVERED) always.
function markSquare(x: number, y: number, state: number, force = false): void {
    if (x < 0 || x >= NUM_SQUARES_X || y < 0 || y >= NUM_SQUARES_Y) return
    const square = worldmap!.squares[x][y]
    if (!force && state === WORLDMAP_SEEN && square.state !== WORLDMAP_UNDISCOVERED) return
    if (square.state === state) return
    const old = square.state
    square.state = state
    const $square = $worldmap?.querySelector(`div.worldmapSquare[square-x='${x}'][square-y='${y}']`)
    if ($square) {
        $square.classList.remove('worldmapSquare-' + SQUARE_STATE_CLASS[old!])
        $square.classList.add('worldmapSquare-' + SQUARE_STATE_CLASS[state])
    }
}

// CE wmMarkSubTileRadiusVisited / wmSubTileMarkRadiusVisited: the subtiles within 1
// (Scout: 2) become known, the party's visited; "fill_s" also visits the subtiles
// above it in its tile, "fill_w" those to its left and the whole row of the tile to the
// left. (DH2 keeps one global grid of the 4×5 tiles' 7×6 subtiles.)
export function markSubTileRadiusVisited(px: number, py: number, radiusOverride?: number): void {
    if (!worldmap) return
    // metarule3 101 (CE wmSubTileMarkRadiusVisited) passes the radius; travel uses Scout's
    const radius = radiusOverride ?? (world.player?.perks.includes('Scout') ? 2 : 1)
    const sx = Math.floor(px / SQUARE_SIZE)
    const sy = Math.floor(py / SQUARE_SIZE)
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) markSquare(sx + dx, sy + dy, WORLDMAP_SEEN)
    }
    if (sx < 0 || sx >= NUM_SQUARES_X || sy < 0 || sy >= NUM_SQUARES_Y) return
    markSquare(sx, sy, WORLDMAP_DISCOVERED)
    const tileLeft = sx - (sx % 7)
    const tileTop = sy - (sy % 6)
    const fill = worldmap.squares[sx][sy].fillType
    if (fill === 'fill_s') {
        for (let y = sy - 1; y >= tileTop; y--) markSquare(sx, y, WORLDMAP_DISCOVERED)
    } else if (fill === 'fill_w') {
        for (let x = sx - 1; x >= tileLeft - 1 && x >= 0; x--) markSquare(x, sy, WORLDMAP_DISCOVERED)
        if (tileLeft > 0) for (let x = tileLeft - 7; x < tileLeft; x++) markSquare(x, sy, WORLDMAP_DISCOVERED)
    }
}

// CE worldmap.cc wmSubTileGetVisitedState: the subtile at world pixel (x, y) as CE
// numbers it — 0 unknown, 1 known, 2 visited (DH2's SEEN is CE's known, DISCOVERED its
// visited).
export function subTileVisitedState(px: number, py: number): number {
    if (!worldmap) return 0
    const sx = Math.floor(px / SQUARE_SIZE),
        sy = Math.floor(py / SQUARE_SIZE)
    if (sx < 0 || sx >= NUM_SQUARES_X || sy < 0 || sy >= NUM_SQUARES_Y) return 0
    const state = worldmap.squares[sx][sy].state
    return state === WORLDMAP_DISCOVERED ? 2 : state === WORLDMAP_SEEN ? 1 : 0
}

// Save / load of the subtile states (CE wmWorldMap_save writes every subtile)
export function serializeSquareStates(): number[] | null {
    if (!worldmap) return null
    const out: number[] = []
    for (let y = 0; y < NUM_SQUARES_Y; y++)
        for (let x = 0; x < NUM_SQUARES_X; x++) out.push(worldmap.squares[x][y].state!)
    return out
}
export function deserializeSquareStates(states: number[] | null | undefined): void {
    if (!worldmap || !Array.isArray(states)) return
    for (let y = 0; y < NUM_SQUARES_Y; y++) {
        for (let x = 0; x < NUM_SQUARES_X; x++) {
            const state = states[y * NUM_SQUARES_X + x]
            if (state === undefined) continue
            worldmap.squares[x][y].state = state
            const $sq = $worldmap?.querySelector<HTMLElement>(`div.worldmapSquare[square-x='${x}'][square-y='${y}']`)
            if ($sq) $sq.className = 'worldmapSquare worldmapSquare-' + SQUARE_STATE_CLASS[state]
        }
    }
}

// Matches .areaSize-small/medium/large in ui.css. Used instead of the
// areaCircle element's live offsetWidth/offsetHeight — see the
// WORLDMAP_TARGET_W/H comment below for why: the circles are first created
// and centered from init(), while the worldmap panel is still display:none,
// where offsetWidth/offsetHeight both read 0 and silently turn "centered"
// into an uncentered top-left placement instead.
// CE wmSphereData: wrldspr0/1/2.frm, 12 / 25 / 49 px. city.txt world_pos is the
// sphere's top-left in window space (the view starts at WM_VIEW_X/Y), so in world
// pixels the sphere spans world_pos − (22, 21) … + size.
const AREA_CIRCLE_SIZE: { [size: string]: number } = { small: 12, medium: 25, large: 49 }
const WM_VIEW_X = 22
const WM_VIEW_Y = 21
// CE hotspot1.frm (wmGenData.hotspotNormalFrmImage)
const HOTSPOT_W = 25
const HOTSPOT_H = 13

// The centre of an area's sphere in world pixels — where wmTeleportToArea puts the
// party and the town tabs walk to (city.x + w / 2 − WM_VIEW_X).
export function areaCenter(area: { worldPosition: Point; size: string }): Point {
    const s = AREA_CIRCLE_SIZE[area.size] ?? 0
    return {
        x: area.worldPosition.x + Math.trunc(s / 2) - WM_VIEW_X,
        y: area.worldPosition.y + Math.trunc(s / 2) - WM_VIEW_Y,
    }
}

// CE: a special encounter's / the out-of-gas area is put so the party stands at
// worldPos + hotspot / 2 + sphere / 2 (city coordinates)
export function areaPosAtParty(area: { size: string }, px: number, py: number): Point {
    const s = AREA_CIRCLE_SIZE[area.size] ?? 0
    return {
        x: px + Math.trunc(HOTSPOT_W / 2) + Math.trunc(s / 2),
        y: py + Math.trunc(HOTSPOT_H / 2) + Math.trunc(s / 2),
    }
}

// CE wmInterfaceDrawCircleOverlay: the name of a known area (map.msg 1500 + id), else
// "Unknown" (worldmap.msg 1004)
function areaLabelText(area: any): string {
    return areaIsKnown(area.id)
        ? (getMessage('map', 1500 + area.id) ?? area.name)
        : (getMessage('worldmap', 1004) ?? 'Unknown')
}

// CE ref: worldmap.cc wmAreaSetPos() — moves a town-marker DOM element to match
// updated worldPosition after a script calls wm_area_set_pos.
// One marker per area whose state isn't CITY_STATE_UNKNOWN (CE worldmap.cc:5225
// wmInterfaceRefresh draws exactly those). Re-run whenever an area's state changes.
export function refreshAreaMarkers(): void {
    if (!$worldmap || !world.mapAreas) return
    for (const key in world.mapAreas) {
        const area = world.mapAreas[key]
        const $existing = $worldmap.querySelector<HTMLElement>(`[data-area-key="${key}"]`)
        if (area.state !== true) {
            $existing?.remove()
            continue
        }
        if ($existing) {
            const $label = $existing.querySelector('.areaLabel')
            if ($label) $label.textContent = areaLabelText(area)
            continue
        }

        const $area = makeEl('div', { classes: ['area'], attrs: { 'data-area-key': key } })
        $worldmap.appendChild($area)

        const $el = makeEl('div', { classes: ['areaCircle', 'areaSize-' + area.size] })
        $area.appendChild($el)

        // transform the circle since (0,0) is the top-left instead of center.
        // Uses the fixed CSS size (AREA_CIRCLE_SIZE), not $el.offsetWidth/
        // offsetHeight — this can run while the worldmap panel is still
        // display:none (first open), where both would read 0.
        const circleSize = AREA_CIRCLE_SIZE[area.size] ?? 0
        $area.style.left = area.worldPosition.x - WM_VIEW_X + 'px'
        $area.style.top = area.worldPosition.y - WM_VIEW_Y + 'px'

        const $label = makeEl('div', {
            classes: ['areaLabel'],
            style: { left: Math.trunc(circleSize / 2) + 'px', top: 3 + circleSize + 'px' },
        })
        $area.appendChild($label)
        $label.textContent = areaLabelText(area)
    }
}

// CE worldmap.cc wmAreaSetVisibleState (+ force) — known/unknown on the worldmap.
// globalState.knownAreas mirrors it for the scripting/endgame checks that read it.
export function setAreaVisible(areaId: number, visible: boolean): void {
    const area = world.mapAreas?.[areaId]
    if (area) area.state = visible
    if (visible) world.knownAreas.add(areaId)
    else world.knownAreas.delete(areaId)
    refreshAreaMarkers()
}

// CE worldmap.cc wmAreaMarkVisitedState — 1 known, 2 visited (a first visit lands on 1).
export function setAreaVisitedState(areaId: number, state: number): void {
    const area: any = world.mapAreas?.[areaId]
    if (!area) return
    const old = area.visitedState ?? 0
    // CE worldmap.cc wmAreaMarkVisitedState: a known area clears the fog around itself;
    // state 1 makes its own subtile known
    const pos = area.worldPosition
    if (area.state === true && state !== 0 && pos) markSubTileRadiusVisited(pos.x, pos.y)
    area.visitedState = state
    if (state === 1 && pos && worldmap) {
        markSquare(Math.floor(pos.x / SQUARE_SIZE), Math.floor(pos.y / SQUARE_SIZE), WORLDMAP_SEEN, true)
    } else if (state === 2 && old === 0) area.visitedState = 1
    refreshAreaMarkers()
}

// CE wmGetPartyCurArea / the saved currentAreaId
export function getCurrentAreaId(): number {
    return currentAreaId
}
export function setCurrentAreaId(areaId: number): void {
    currentAreaId = areaId
}

// CE wmAreaVisitedState: the visited state of a known area, else 0 (METARULE_AREA_KNOWN)
export function areaVisitedState(areaId: number): number {
    const area: any = world.mapAreas?.[areaId]
    if (!area || area.state !== true) return 0
    return area.visitedState ?? 0
}

// CE wmTeleportToArea (map.cc mapHandleTransition after a map change): the party is
// put on the area, the walk dropped.
export function teleportToArea(areaId: number): void {
    const area = world.mapAreas?.[areaId]
    if (!area) return
    currentAreaId = areaId
    if (!worldmapPlayer) return
    walk.isWalking = false
    walk.distance = 0
    worldmapPlayer.target = null
    const c = areaCenter(area)
    worldmapPlayer.x = c.x
    worldmapPlayer.y = c.y
    if ($worldmapPlayer) hidev($worldmapPlayer)
    if ($worldmapTarget) {
        setTargetImage('art/intrface/hotspot1.png', true)
        centerWorldmapTarget(worldmapPlayer.x, worldmapPlayer.y)
    }
}

// CE worldmap.cc wmAreaIsKnown: known (state on) and visited at least once.
export function areaIsKnown(areaId: number): boolean {
    const area: any = world.mapAreas?.[areaId]
    return !!area && area.state === true && (area.visitedState ?? 0) !== 0
}

// CE worldmap.cc map.cc:1028 wmMapMarkVisited — entering a saved map marks its area visited.
export function markMapVisited(mapName: string): void {
    if (!mapIsSaved(mapName)) return
    const area = world.mapAreas ? areaContainingMap(mapName) : null
    if (area) setAreaVisitedState(area.id, 2)
}

// CE worldmap.cc quick destinations (the town tabs, Ctrl+F1..F7): the party walks to
// the area — wmPartyInitWalking to the centre of its circle.
export function travelToArea(areaId: number): void {
    const area = world.mapAreas?.[areaId]
    if (!area || !areaIsKnown(areaId) || !worldmapPlayer || !$worldmapPlayer) return
    const here = withinArea(worldmapPlayer)
    if (here && here.id === areaId) return
    const c = areaCenter(area)
    partyInitWalking(c.x, c.y)
}

// Save/load of the area states (CE worldmap.cc wmWorldMapSave/Load: state, visitedState, x, y,
// and every entrance's state).
type SavedArea = { state: boolean; visitedState: number; x: number; y: number; entrances?: boolean[] }
export function serializeAreaStates(): { [id: string]: SavedArea } {
    const out: { [id: string]: SavedArea } = {}
    for (const key in world.mapAreas ?? {}) {
        const area: any = world.mapAreas![key]
        out[key] = {
            state: area.state === true,
            visitedState: area.visitedState ?? 0,
            x: area.worldPosition.x,
            y: area.worldPosition.y,
            entrances: area.entrances.map((e: any) => e.state === true),
        }
    }
    return out
}
export function deserializeAreaStates(data: { [id: string]: SavedArea } | undefined): void {
    if (!data || !world.mapAreas) return
    for (const key in data) {
        const area: any = world.mapAreas[key]
        if (!area) continue
        area.state = data[key].state
        area.visitedState = data[key].visitedState
        const ent = data[key].entrances
        if (Array.isArray(ent))
            area.entrances.forEach((e: any, i: number) => {
                if (i < ent.length) e.state = ent[i]
            })
        area.worldPosition = { x: data[key].x, y: data[key].y }
        updateAreaMarkerPos(key, area.worldPosition.x, area.worldPosition.y)
    }
    refreshAreaMarkers()
}

// CE ref: worldmap.cc wmWorldMap_reset / wmGenDataReset (called from game.cc gameReset):
// area states back to city.txt, party back at Arroyo, no car (fuel CAR_FUEL_MAX, no
// parking area) and the subtile fog of worldmap.txt.
export function resetWorldmap(): void {
    gameTimeIncRemainder = 0 // CE wmWorldMap_reset: gGameTimeIncRemainder = 0
    _isInCar = false
    _carFuel = CAR_FUEL_MAX
    _currentCarAreaId = -1
    currentAreaId = -1
    world.knownAreas = new Set()
    try {
        world.mapAreas = loadAreas()
    } catch (_) {
        world.mapAreas = null
    }
    if (!$worldmap || !worldmap || !world.mapAreas) return

    $worldmap.querySelectorAll('[data-area-key]').forEach((el) => el.remove())
    refreshAreaMarkers()

    worldmap = parseWorldmap(getFileText('data/data/worldmap.txt'))
    $worldmap.querySelectorAll<HTMLElement>('div.worldmapSquare').forEach(($sq) => {
        const x = Number($sq.getAttribute('square-x'))
        const y = Number($sq.getAttribute('square-y'))
        const state = worldmap!.squares[x][y].state
        $sq.className = 'worldmapSquare worldmapSquare-' + (SQUARE_STATE_CLASS[state!] ?? state)
    })
    walk.isWalking = false
    walk.distance = 0

    worldmapPlayer = {
        x: WM_START_X, // CE wmGenDataReset: 173, 122 (Arroyo)
        y: WM_START_Y,
        target: null,
        isInCar: _isInCar,
        carFuel: _carFuel,
    }
    centerWorldmapTarget(worldmapPlayer.x, worldmapPlayer.y)
    markSubTileRadiusVisited(worldmapPlayer.x, worldmapPlayer.y)
    if ($worldmapPlayer) hidev($worldmapPlayer)
    setTargetImage('art/intrface/hotspot1.png', true)
    updateCarUI()
}

export function updateAreaMarkerPos(areaKey: string, x: number, y: number): void {
    if (!$worldmap) return
    const $area = $worldmap.querySelector<HTMLElement>(`[data-area-key="${areaKey}"]`)
    if (!$area) return
    $area.style.left = x - WM_VIEW_X + 'px'
    $area.style.top = y - WM_VIEW_Y + 'px'
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
    $worldmapTarget!.style.left = ((x - WORLDMAP_TARGET_W / 2) | 0) + 'px'
    $worldmapTarget!.style.top = ((y - WORLDMAP_TARGET_H / 2) | 0) + 'px'
}

function centerWorldmapCrosshair(x: number, y: number): void {
    $worldmapTarget!.style.left = ((x - WORLDMAP_CROSSHAIR_W / 2) | 0) + 'px'
    $worldmapTarget!.style.top = ((y - WORLDMAP_CROSSHAIR_H / 2) | 0) + 'px'
}

// The hotspot1.png/hotspot2.png triangle shares one silhouette clipped via
// the wmHotspotShape CSS class (ui.css); wmaptarg.png (the crosshair shown
// while a target is still being walked to) is a different shape and must
// not be clipped the same way — toggle the class alongside the image so
// the clickable area always matches whichever graphic is actually showing.
function setTargetImage(url: string, isHotspot: boolean): void {
    $worldmapTarget!.style.backgroundImage = `url('${assetUrl(url)}')`
    $worldmapTarget!.classList.toggle('wmHotspotShape', isHotspot)
}

// CE worldmap.cc wmWorldMapFunc, hotspot release: the town map only for an area already
// visited (visitedState 2) that has town-map art (mapFid); otherwise the map of the first
// open entrance (wmAreaFindFirstValidMap — entrance 0 is opened when none is) loads at its
// map header's start (mapLoadById), and the area becomes visited.
function enterArea(area: Area): void {
    if ((area.visitedState ?? 0) === 2 && area.mapArt) {
        uiWorldMapShowArea(area)
        return
    }
    if (area.entrances.length === 0) return
    let entrance = area.entrances.find((e) => e.state)
    if (!entrance) {
        entrance = area.entrances[0]
        entrance.state = true
    }
    area.visitedState = 2
    if (_isInCar) {
        setIsInCar(false)
        setCarAreaId(area.id)
    }
    dbg('worldmap', `[Worldmap] entering ${area.name} → ${entrance.mapName} (no town map)`)
    world.gMap!.loadMap(entrance.mapName)
    uiCloseWorldMap()
}

// CE worldmap.cc wmMapMarkMapEntranceState(mapIdx, elevation, state): only a saved map
// (MAP_SAVED); the first area with an entrance to it (wmMatchAreaContainingMapIdx), and in
// it the first entrance to the map whose elevation matches, -1 on either side matching
// any (wmMatchEntranceElevFromMap). False when nothing matched (CE -1).
export function markMapEntranceState(mapName: string, elevation: number, state: boolean): boolean {
    if (!world.mapAreas || !mapIsSaved(mapName)) return false
    const name = mapName.toLowerCase()
    const sameMap = (e: any) => (e.mapName ?? '').toLowerCase() === name
    for (const key of Object.keys(world.mapAreas)) {
        const area = world.mapAreas[key]
        if (!area.entrances.some(sameMap)) continue
        const entrance = area.entrances.find(
            (e) => sameMap(e) && (elevation === -1 || e.elevation === -1 || e.elevation === elevation),
        )
        if (!entrance) return false
        entrance.state = state
        return true
    }
    return false
}

export function init(): void {
    // map.cc mapLoad → wmMapMarkVisited(gMapHeader.index) and
    // wmMapMarkMapEntranceState(gMapHeader.index, gElevation, 1): the town-map entrance
    // of the map the party reaches opens (exit grids and ladders land here too)
    Events.on('loadMapPost', () => {
        if (!world.gMap?.name) return
        markMapVisited(world.gMap.name)
        markMapEntranceState(world.gMap.name, world.gMap.currentElevation, true)
        // CE wmCheckGameAreaEvents: at CITY_FAKE_VAULT_13_A (45) the real Vault 13 entry swaps
        // in — A unknown, B (46) known and visited
        if (currentAreaId === 45) {
            setAreaVisible(45, false)
            setAreaVisible(46, true)
            setAreaVisitedState(46, 2)
        }
    })
    // map.cc mapSetElevation → wmMapMarkMapEntranceState(gMapHeader.index, elevation, 1)
    Events.on('elevationChanged', (e: { elevation: number; isMapLoading?: boolean }) => {
        if (world.gMap?.name && !e.isMapLoading) markMapEntranceState(world.gMap.name, e.elevation, true)
    })
    // map.cc mapHandleTransition: a map change by exit grid / load_map puts the party on
    // the new map's area (wmMatchAreaContainingMapIdx → wmTeleportToArea)
    Events.on('mapTransition', (mapID: number) => {
        const name = mapID >= 0 ? lookupMapName(mapID) : null
        if (name) teleportToArea(areaIdContainingMap(name))
    })

    $worldmapPlayer = document.getElementById('worldmapPlayer')
    $worldmapTarget = document.getElementById('worldmapTarget')
    $worldmap = document.getElementById('worldmap')
    $worldMapDial = document.getElementById('worldMapDial')
    _lastDialFrame = -1
    _lastDateKey = ''
    updateDial()
    updateDate()

    worldmap = parseWorldmap(getFileText('data/data/worldmap.txt'))

    if (!world.mapAreas) world.mapAreas = loadAreas()

    const worldmapEl = $worldmap!
    worldmapEl.onclick = function (e: MouseEvent) {
        // Calculate viewport-relative offset
        const box = worldmapEl.getBoundingClientRect()
        const offsetLeft = box.left | (0 + window.pageXOffset)
        const offsetTop = box.top | (0 + window.pageYOffset)

        const x = e.pageX - offsetLeft
        const y = e.pageY - offsetTop

        // getBoundingClientRect() returns the visual (post-transform) position of
        // #worldmap, so x/y already encode the pan offset. Adding _panX again would
        // double it — use x/y directly as worldmap coordinates.
        const ax = x
        const ay = y

        partyInitWalking(Math.trunc(ax), Math.trunc(ay))
        dbg('worldmap', 'targeting: ' + ax + ', ' + ay)
    }

    // CE ref: worldmap.cc:3124-3157 — hotspot shows pressed image while mouse held,
    // clicking a known area hotspot opens the area map.
    $worldmapTarget!.onmousedown = function () {
        const area = withinArea(worldmapPlayer!)
        if (area !== null || worldmapPlayer!.target === null) {
            setTargetImage('art/intrface/hotspot2.png', true)
        }
    }
    $worldmapTarget!.onmouseup = function (e: MouseEvent) {
        const area = withinArea(worldmapPlayer!)
        if (area !== null) {
            setTargetImage('art/intrface/hotspot1.png', true)
            e.stopPropagation()
            enterArea(area)
        } else if (worldmapPlayer!.target === null) {
            setTargetImage('art/intrface/hotspot1.png', true)
            e.stopPropagation()
            markerClickHandled = true
            enterWilderness()
        }
    }
    $worldmapTarget!.onmouseleave = function () {
        // revert to normal if mouse leaves without releasing
        if ($worldmapTarget!.style.backgroundImage.includes('hotspot2')) {
            setTargetImage('art/intrface/hotspot1.png', true)
        }
    }
    // Handled by mouseup above; swallow the click that follows a wilderness entry so
    // the worldmap's walk-to-click handler doesn't set a new destination.
    let markerClickHandled = false
    $worldmapTarget!.onclick = function (e: MouseEvent) {
        if (markerClickHandled) e.stopPropagation()
        markerClickHandled = false
    }

    refreshAreaMarkers()

    for (let x = 0; x < NUM_SQUARES_X; x++) {
        for (let y = 0; y < NUM_SQUARES_Y; y++) {
            let state: string | number | null = worldmap.squares[x][y].state
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
            $worldmap!.appendChild($el)
        }
    }

    worldmapPlayer = {
        x: WM_START_X, // CE wmGenDataInit: 173, 122 (Arroyo)
        y: WM_START_Y,
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

    markSubTileRadiusVisited(worldmapPlayer.x, worldmapPlayer.y)

    if (withinArea(worldmapPlayer) !== null) {
        hidev($worldmapPlayer!)
        setTargetImage('art/intrface/hotspot1.png', true)
    }

    // Keyboard scroll
    document.addEventListener('keydown', _onWMKeyDown)
    document.addEventListener('keyup', _onWMKeyUp)

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

function _onWMKeyDown(e: KeyboardEvent): void {
    _heldKeys.add(e.key)
}
function _onWMKeyUp(e: KeyboardEvent): void {
    _heldKeys.delete(e.key)
}
function _onWMMouseMove(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    _mouseEdge = {
        left: mx < EDGE_THRESHOLD,
        right: mx > VIEW_W - EDGE_THRESHOLD,
        top: my < EDGE_THRESHOLD,
        bottom: my > VIEW_H - EDGE_THRESHOLD,
    }
}
function _onWMMouseLeave(): void {
    _mouseEdge = { left: false, right: false, top: false, bottom: false }
}

export function start() {
    resetEncounterTimer() // CE wmInterfaceInit: wmLastRndTime = getTicks()
    partyHealTime = 0
    updateWorldmapPlayer()
}

export function stop() {
    clearTimeout(worldmapTimer)
    _heldKeys.clear()
    _mouseEdge = { left: false, right: false, top: false, bottom: false }
    document.removeEventListener('keydown', _onWMKeyDown)
    document.removeEventListener('keyup', _onWMKeyUp)
    const $worldMapWorld = document.getElementById('worldMapWorld')
    if ($worldMapWorld) {
        $worldMapWorld.removeEventListener('mousemove', _onWMMouseMove)
        $worldMapWorld.removeEventListener('mouseleave', _onWMMouseLeave)
    }
}

// check if we're inside an area
export function withinArea(position: Point) {
    // CE wmMatchWorldPosToArea: the first known area whose sphere rectangle holds the
    // position (window space: position + WM_VIEW_X/Y against city.txt world_pos)
    const vx = position.x + WM_VIEW_X
    const vy = position.y + WM_VIEW_Y
    for (const areaNum in world.mapAreas) {
        const area = world.mapAreas[areaNum]
        if (area.state !== true) continue
        const s = AREA_CIRCLE_SIZE[area.size] ?? 0
        if (
            vx >= area.worldPosition.x &&
            vy >= area.worldPosition.y &&
            vx <= area.worldPosition.x + s &&
            vy <= area.worldPosition.y + s
        )
            return area
    }

    return null
}

// CE ref: worldmap.cc:6541 wmMatchAreaContainingMapIdx — the area with an entrance
// to `mapName`; CE leaves area 0 when none matches.
export function areaIdContainingMap(mapName: string): number {
    if (!world.mapAreas) {
        try {
            world.mapAreas = loadAreas()
        } catch (_) {
            return 0
        }
    }
    return areaContainingMap(mapName)?.id ?? 0
}

// CE ref: worldmap.cc:3141-3172 — clicking the party marker while stopped outside
// every area enters map 0 (Desert Encounter 1, whatever the terrain). In the car the
// party gets out; the car stays in the area containing that map (Area 26 "Random"),
// whose map script places it.
function enterWilderness(): void {
    const mapName = lookupMapName(0)
    if (!mapName) return
    dbg('worldmap', `[Worldmap] party marker outside any area → map 0 (${mapName})`)
    if (_isInCar) {
        setIsInCar(false)
        _currentCarAreaId = areaIdContainingMap(mapName)
        dbg('worldmap', `car parked at area ${_currentCarAreaId}`)
    }
    world.gMap!.loadMap(mapName)
    uiCloseWorldMap()
}

// CE ref: worldmap.cc:3052-3082 — out of gas: travel stops, the party leaves the car,
// and the car stays in the area here, or at CITY_CAR_OUT_OF_GAS moved to this spot
// (its map script then places the car there).
function carRanOutOfGas(): void {
    dbg('worldmap', 'Ran outta gas!')
    worldmapPlayer!.target = null
    walk.isWalking = false
    walk.distance = 0
    setIsInCar(false)
    const area = withinArea(worldmapPlayer!)
    currentAreaId = area?.id ?? -1
    if (area) {
        _currentCarAreaId = area.id
    } else {
        _currentCarAreaId = CITY_CAR_OUT_OF_GAS
        currentAreaId = CITY_CAR_OUT_OF_GAS
        const outOfGas = world.mapAreas?.[CITY_CAR_OUT_OF_GAS]
        if (outOfGas) {
            outOfGas.worldPosition = areaPosAtParty(outOfGas, worldmapPlayer!.x, worldmapPlayer!.y)
            outOfGas.visitedState = 1
            setAreaVisible(CITY_CAR_OUT_OF_GAS, true) // CITY_STATE_KNOWN
            updateAreaMarkerPos(String(CITY_CAR_OUT_OF_GAS), outOfGas.worldPosition.x, outOfGas.worldPosition.y)
        }
    }
}

// CE wmDrawCursorStopped: the location / encounter marker centred on the party (the
// 17×17 #worldmapPlayer box centres its image)
function placePartyMarker(): void {
    $worldmapPlayer!.style.left = worldmapPlayer!.x - 8 + 'px'
    $worldmapPlayer!.style.top = worldmapPlayer!.y - 8 + 'px'
}

// CE wmPartyInitWalking: a Bresenham line from the party to (x, y)
// DH2 debug (console revealWorldmap / setInstantTravel, not in CE): a click on the
// worldmap moves the party there at once — no game time, no encounters.
let instantTravel = false
export function setInstantTravel(on: boolean): void {
    instantTravel = on
}

// DH2 debug (console revealWorldmap, not in CE): every subtile visited, every area
// known and visited with all its entrances.
export function revealAll(): void {
    if (worldmap) {
        for (let x = 0; x < NUM_SQUARES_X; x++)
            for (let y = 0; y < NUM_SQUARES_Y; y++) markSquare(x, y, WORLDMAP_DISCOVERED)
    }
    for (const key in world.mapAreas ?? {}) {
        const area: any = world.mapAreas![key]
        area.state = true
        area.visitedState = 2
        for (const e of area.entrances ?? []) e.state = true
        world.knownAreas.add(area.id)
    }
    refreshAreaMarkers()
}

function partyInitWalking(x: number, y: number): void {
    if (instantTravel && worldmapPlayer) {
        worldmapPlayer.x = x
        worldmapPlayer.y = y
        markSubTileRadiusVisited(x, y)
        stopWalking()
        applyPan(Math.floor(x - VIEW_W / 2), Math.floor(y - VIEW_H / 2))
        placePartyMarker()
        return
    }
    worldmapPlayer!.target = { x, y }
    walk.isWalking = true
    currentAreaId = -1
    const px = worldmapPlayer!.x
    const py = worldmapPlayer!.y
    const dx = Math.abs(x - px)
    const dy = Math.abs(y - py)
    if (dx < dy) {
        walk.distance = dy
        walk.mainAxisStep = 2 * dx
        walk.mainX = 0
        walk.lineDelta = 2 * dx - dy
        walk.crossAxisStep = 2 * (dx - dy)
        walk.crossX = 1
        walk.mainY = 1
        walk.crossY = 1
    } else {
        walk.distance = dx
        walk.mainAxisStep = 2 * dy
        walk.mainY = 0
        walk.lineDelta = 2 * dy - dx
        walk.crossAxisStep = 2 * (dy - dx)
        walk.mainX = 1
        walk.crossX = 1
        walk.crossY = 1
    }
    if (x < px) {
        walk.crossX = -walk.crossX
        walk.mainX = -walk.mainX
    }
    if (y < py) {
        walk.crossY = -walk.crossY
        walk.mainY = -walk.mainY
    }
    showv($worldmapPlayer!)
    setTargetImage('art/intrface/wmaptarg.png', false)
    centerWorldmapCrosshair(x, y)
}

// The walk ended (arrived, or stopped by the walk mask): the hotspot marks the party.
function stopWalking(): void {
    walk.isWalking = false
    walk.distance = 0
    worldmapPlayer!.target = null
    currentAreaId = withinArea(worldmapPlayer!)?.id ?? -1 // wmMatchWorldPosToArea
    hidev($worldmapPlayer!)
    setTargetImage('art/intrface/hotspot1.png', true)
    centerWorldmapTarget(worldmapPlayer!.x, worldmapPlayer!.y)
}

function squareAt(x: number, y: number) {
    const p = positionToSquare({ x, y })
    return worldmap!.squares[p.x]?.[p.y] ?? null
}

// CE wmPartyWalkingStep: the terrain counter cycles 1..4; a step is taken when
// counter / difficulty >= 1 (difficulty 1 every frame, 2 three frames of four, …).
// A step into walk-masked terrain ends the walk where the party stands.
function partyWalkingStep(): void {
    if (walk.distance <= 0) return
    terrainCounter++
    if (terrainCounter > 4) terrainCounter = 1
    const square = squareAt(worldmapPlayer!.x, worldmapPlayer!.y)
    let difficulty = Number(worldmap!.terrainSpeed[square?.terrainType ?? '']) || 1
    if (difficulty < 1) difficulty = 1
    if (Math.trunc(terrainCounter / difficulty) < 1) return

    const cross = walk.lineDelta >= 0
    const nx = worldmapPlayer!.x + (cross ? walk.crossX : walk.mainX)
    const ny = worldmapPlayer!.y + (cross ? walk.crossY : walk.mainY)
    if (worldPosInvalid(nx, ny)) {
        stopWalking()
        return
    }
    walk.lineDelta += cross ? walk.crossAxisStep : walk.mainAxisStep
    worldmapPlayer!.x = nx
    worldmapPlayer!.y = ny
    walk.distance -= 1
}

// CE wmGameTimeIncrement: the Pathfinder perk takes 25 % per rank off (the remainder
// carried, sfall fix); the queued events fire as the time passes.
function gameTimeIncrement(ticks: number): void {
    const rank = world.player?.perks.filter((p: string) => p === 'Pathfinder').length ?? 0
    const bonus = ticks * rank * 0.25 + gameTimeIncRemainder
    const whole = Math.trunc(bonus)
    gameTimeIncRemainder = bonus - whole
    GameTime.advanceTicks(ticks - whole)
    updateDial()
    updateDate()
}

// CE party_member.cc _partyMemberRestingHeal(3): once a second of travel every party
// member (the dude too) heals its Healing Rate.
function partyRestingHeal(): void {
    for (const c of world.gParty?.getPartyMembersAndPlayer() ?? [world.player]) {
        if (!c || c.type !== 'critter' || c.dead) continue
        const max = c.getStat('Max HP')
        c.stats.setBase('HP', Math.min(max, c.getStat('HP') + c.getStat('Healing Rate')))
    }
    if (world.player) drawHP(world.player.getStat('HP'))
}

// CE wmBlinkRndEncounterIcon: 7 frames of 200 ms, dark and bright in turn
async function blinkEncounterIcon(special: boolean): Promise<void> {
    const dark = special ? 'art/intrface/wmrnden3.png' : 'art/intrface/wmapfgt1.png'
    const bright = special ? 'art/intrface/wmrnden2.png' : 'art/intrface/wmapfgt0.png'
    showv($worldmapPlayer!)
    for (let i = 0; i < 7; i++) {
        $worldmapPlayer!.style.backgroundImage = `url('${assetUrl(i % 2 === 0 ? dark : bright)}')`
        await new Promise<void>((r) => setTimeout(r, 200))
    }
    $worldmapPlayer!.style.backgroundImage = "url('" + assetUrl('art/intrface/wmaploc.png') + "')"
}

// CE wmWorldMapFunc after wmRndEncounterOccurred returned 1: a spotted encounter asks
// first; in the car the car stays in the encounter map's area; the map is loaded and
// the encounter set up there (wmSetupRandomEncounter).
async function runEncounter(roll: EncounterRoll): Promise<void> {
    if (roll.blink) await blinkEncounterIcon(roll.blink === 'special')
    if (roll.ask) {
        const yes = await showConfirm(`${roll.ask.title}\n${roll.ask.body}`)
        if (!yes) {
            cancelEncounter()
            worldmapTimer = window.setTimeout(updateWorldmapPlayer, FRAME_MS)
            return
        }
    }
    const mapName = lookupMapName(roll.mapId)
    if (!mapName) {
        worldmapTimer = window.setTimeout(updateWorldmapPlayer, FRAME_MS)
        return
    }
    if (_isInCar) _currentCarAreaId = areaIdContainingMap(mapName)
    walk.isWalking = false
    walk.distance = 0
    worldmapPlayer!.target = null
    world.gMap!.loadMap(mapName, undefined, undefined, roll.forced ? undefined : () => setupRandomEncounter())
    uiCloseWorldMap()
}

// One frame of CE wmWorldMapFunc.
export function updateWorldmapPlayer() {
    // CE wmCheckGameEvents — story events (ARTIMER movies, Arroyo failure)
    scriptsCheckGameEvents(GameTime.getTotalDays())

    if (walk.isWalking) {
        partyWalkingStep()
        // CE: in the car 4 steps a frame (+1 blower, +1 New Reno upgrade, +3 super car)
        if (_isInCar && _carFuel > 0) {
            for (let i = 1; i < carStepsPerTick(); i++) partyWalkingStep()
            updateCarAnimation()
            carUseGas(100) // wmCarUseGas(100) once per frame
            if (_carFuel <= 0) carRanOutOfGas()
            updateCarUI()
        }

        const now = performance.now()
        if (now - partyHealTime > 1000) {
            partyRestingHeal()
            partyHealTime = now
        }

        markSubTileRadiusVisited(worldmapPlayer!.x, worldmapPlayer!.y)

        if (walk.distance <= 0 && walk.isWalking) stopWalking()

        gameTimeIncrement(WALK_FRAME_TICKS)

        // CE wmInterfaceScrollPixel — the view follows the party
        applyPan(Math.floor(worldmapPlayer!.x - VIEW_W / 2), Math.floor(worldmapPlayer!.y - VIEW_H / 2))

        if (walk.isWalking && Config.engine.doEncounters === true) {
            const square = squareAt(worldmapPlayer!.x, worldmapPlayer!.y)
            const roll = square
                ? rndEncounterOccurred(
                      { x: worldmapPlayer!.x, y: worldmapPlayer!.y },
                      withinArea(worldmapPlayer!) !== null,
                      square,
                      _isInCar,
                  )
                : null
            if (roll) {
                placePartyMarker()
                void runEncounter(roll)
                return
            }
        }
    }

    placePartyMarker()

    // Keyboard and mouse-edge panning (active even when player is stationary).
    // CE ref: worldmap.cc WM_SCROLL_* — map can be scrolled independently of travel.
    if (!walk.isWalking) {
        let dx = 0
        let dy = 0
        if (_heldKeys.has('ArrowLeft') || _heldKeys.has('a') || _heldKeys.has('A') || _mouseEdge.left) dx -= PAN_SPEED
        if (_heldKeys.has('ArrowRight') || _heldKeys.has('d') || _heldKeys.has('D') || _mouseEdge.right) dx += PAN_SPEED
        if (_heldKeys.has('ArrowUp') || _heldKeys.has('w') || _heldKeys.has('W') || _mouseEdge.top) dy -= PAN_SPEED
        if (_heldKeys.has('ArrowDown') || _heldKeys.has('s') || _heldKeys.has('S') || _mouseEdge.bottom) dy += PAN_SPEED
        if (dx !== 0 || dy !== 0) applyPan(_panX + dx, _panY + dy)
    }

    worldmapTimer = window.setTimeout(updateWorldmapPlayer, FRAME_MS)
}
