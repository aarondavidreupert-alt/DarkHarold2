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

import { loadAreas } from '../data.js'
import * as GameTime from '../gametime.js'
import { Point, pointIntersectsCircle } from '../geometry.js'
import globalState from '../globalState.js'
import { hidev, makeEl, showv, uiCloseWorldMap, uiWorldMapShowArea } from '../ui.js'
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
        // CE literal path is "data\\%s.msk" (worldmap.cc:4225) — the SAME
        // "data\" prefix as worldmap.txt's own "data\\worldmap.txt"
        // (worldmap.cc:1275), which DH2 fetches from data/data/worldmap.txt.
        // tools/setup.py's DAT extraction preserves each entry's internal
        // archive path under the project's data/ folder, so any CE path
        // starting with "data\" lands at data/data/* here — .msk files
        // included. Originally fetched from data/{name}.msk (missing the
        // extraction-root prefix), which 404'd on real installs and made
        // every worldPosInvalid() check silently pass (never blocking).
        const dv = getFileBinarySync(`data/data/${name}.msk`)
        mask = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)
    } catch {
        dbg('worldmap', `[Worldmap] walk mask load failed: ${name}`)
    }
    _walkMaskCache.set(name, mask)
    return mask
}

// CE ref: worldmap.cc:4244 wmWorldPosInvalid — true if (x,y) is blocked by the
// containing tile's walk mask (impassable terrain — ocean, mountains, etc; the
// mask is a generic per-tile-image mechanism, not ocean-specific). Bit-test
// formula ported as-is from CE, including its own noted quirk (CE's comment
// right above it literally says "TODO: Check math." — matched here rather
// than "corrected", since the shipped .msk data was authored against this
// exact layout).
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

// CE ref: worldmap.cc wmAreaSetPos() — moves a town-marker DOM element to match
// updated worldPosition after a script calls wm_area_set_pos.
export function updateAreaMarkerPos(areaKey: string, x: number, y: number): void {
    if (!$worldmap) return
    const $area = $worldmap.querySelector<HTMLElement>(`[data-area-key="${areaKey}"]`)
    if (!$area) return
    const $circle = $area.querySelector<HTMLElement>('.areaCircle')
    const halfW = $circle ? $circle.offsetWidth / 2 : 0
    const halfH = $circle ? $circle.offsetHeight / 2 : 0
    $area.style.left = (x - halfW) + 'px'
    $area.style.top  = (y - halfH) + 'px'
}

function centerWorldmapTarget(x: number, y: number): void {
    $worldmapTarget.style.left = ((x - $worldmapTarget.offsetWidth / 2) | 0) + 'px'
    $worldmapTarget.style.top = ((y - $worldmapTarget.offsetHeight / 2) | 0) + 'px'
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
        Object.assign($worldmapTarget.style, {
            backgroundImage: "url('art/intrface/wmaptarg.png')",
            left: ax + 'px',
            top: ay + 'px',
        })
        dbg('worldmap', 'targeting: ' + ax + ', ' + ay)
    }

    // CE ref: worldmap.cc:3124-3157 — hotspot shows pressed image while mouse held,
    // clicking a known area hotspot opens the area map.
    $worldmapTarget.onmousedown = function () {
        const area = withinArea(worldmapPlayer)
        if (area !== null) {
            $worldmapTarget.style.backgroundImage = "url('art/intrface/hotspot2.png')"
        }
    }
    $worldmapTarget.onmouseup = function (e: MouseEvent) {
        const area = withinArea(worldmapPlayer)
        if (area !== null) {
            $worldmapTarget.style.backgroundImage = "url('art/intrface/hotspot1.png')"
            e.stopPropagation()
            uiWorldMapShowArea(area)
        }
    }
    $worldmapTarget.onmouseleave = function () {
        // revert to normal if mouse leaves without releasing
        if ($worldmapTarget.style.backgroundImage.includes('hotspot2')) {
            $worldmapTarget.style.backgroundImage = "url('art/intrface/hotspot1.png')"
        }
    }
    $worldmapTarget.onclick = null  // handled by mouseup above

    for (const key in globalState.mapAreas) {
        const area = globalState.mapAreas[key]
        if (area.state !== true) continue

        const $area = makeEl('div', { classes: ['area'], attrs: { 'data-area-key': key } })
        $worldmap.appendChild($area)

        //console.log("adding one @ " + area.worldPosition.x + ", " + area.worldPosition.y)
        const $el = makeEl('div', { classes: ['areaCircle', 'areaSize-' + area.size] })
        $area.appendChild($el)

        // transform the circle since (0,0) is the top-left instead of center
        const x = area.worldPosition.x - $el.offsetWidth / 2
        const y = area.worldPosition.y - $el.offsetHeight / 2
        //console.log("adding one @ " + x + ", " + y + " | " + $el.width() + ", " + $el.height())
        //console.log("size = " + area.size)
        $area.style.left = x + 'px'
        $area.style.top = y + 'px'

        //if(area.name==="Arroyo")console.log("ARROYO IS " + key)

        const $label = makeEl('div', {
            classes: ['areaLabel'],
            style: { left: '0px', top: 2 + $el.offsetHeight + 'px' },
        })
        $area.appendChild($label)
        $label.textContent = area.name
    }

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
    }
    $worldmapTarget.style.left = worldmapPlayer.x + 'px'
    $worldmapTarget.style.top = worldmapPlayer.y + 'px'

    setSquareStateAt(positionToSquare(worldmapPlayer), WORLDMAP_DISCOVERED)

    if (withinArea(worldmapPlayer) !== null) {
        hidev($worldmapPlayer)
        $worldmapTarget.style.backgroundImage = "url('art/intrface/hotspot1.png')"
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

export function updateWorldmapPlayer() {
    $worldmapPlayer.style.left = worldmapPlayer.x + 'px'
    $worldmapPlayer.style.top = worldmapPlayer.y + 'px'

    if (worldmapPlayer.target) {
        let dx = worldmapPlayer.target.x - worldmapPlayer.x
        let dy = worldmapPlayer.target.y - worldmapPlayer.y
        const len = Math.sqrt(dx * dx + dy * dy)

        const squarePos = positionToSquare(worldmapPlayer)
        const currentSquare = worldmap.squares[squarePos.x][squarePos.y]
        const speed = WORLDMAP_SPEED / worldmap.terrainSpeed[currentSquare.terrainType]

        if (len < speed) {
            // CE ref: worldmap.cc:4335-4341 wmPartyWalkingStep — a step into a
            // walk-mask-blocked pixel halts travel in place rather than arriving.
            if (worldPosInvalid(Math.round(worldmapPlayer.target.x), Math.round(worldmapPlayer.target.y))) {
                worldmapPlayer.target = null
            } else {
                worldmapPlayer.x = worldmapPlayer.target.x
                worldmapPlayer.y = worldmapPlayer.target.y
                worldmapPlayer.target = null

                hidev($worldmapPlayer)
                $worldmapTarget.style.backgroundImage = "url('art/intrface/hotspot1.png')"
                centerWorldmapTarget(worldmapPlayer.x, worldmapPlayer.y)
            }
        } else {
            // normalize direction
            dx /= len
            dy /= len

            const nextX = worldmapPlayer.x + dx * speed
            const nextY = worldmapPlayer.y + dy * speed

            // CE ref: worldmap.cc:4335-4341 wmPartyWalkingStep — halts travel in
            // place (rather than bouncing or rerouting) when the next step would
            // cross into walk-mask-blocked terrain (ocean, mountains, etc).
            if (worldPosInvalid(Math.round(nextX), Math.round(nextY))) {
                worldmapPlayer.target = null
                hidev($worldmapPlayer!)
                $worldmapTarget!.style.backgroundImage = "url('art/intrface/hotspot1.png')"
                centerWorldmapTarget(worldmapPlayer.x, worldmapPlayer.y)
            } else {
                // head towards it
                worldmapPlayer.x = nextX
                worldmapPlayer.y = nextY
            }
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

        // CE ref: worldmap.cc wmInterfaceScrollMap — pan viewport to keep player centred.
        applyPan(Math.floor(worldmapPlayer.x - VIEW_W / 2), Math.floor(worldmapPlayer.y - VIEW_H / 2))

        if (currentSquare.state !== WORLDMAP_DISCOVERED) setSquareStateAt(squarePos, WORLDMAP_DISCOVERED)

        // check for encounters
        // CE ref: worldmap.cc wmRndEncounterOccurred:3341 — skip if player is within any town area
        const time = window.performance.now()
        if (Config.engine.doEncounters === true && time >= lastEncounterCheck + WORLDMAP_ENCOUNTER_CHECK_RATE
                && withinArea(worldmapPlayer) === null) {
            lastEncounterCheck = time

            const hadEncounter = didEncounter()
            if (hadEncounter === true) {
                $worldmapPlayer.style.backgroundImage = "url('art/intrface/wmapfgt0.png')"

                // TODO: Disable Worldmap UI while waiting on this!

                setTimeout(function () {
                    doEncounter()
                    uiCloseWorldMap()
                    $worldmapPlayer.style.backgroundImage = "url('art/intrface/wmaploc.png')"
                }, 1000)

                clearTimeout(worldmapTimer)
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
