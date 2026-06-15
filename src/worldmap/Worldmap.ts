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
import { clamp, getFileText } from '../util.js'
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
export const SQUARE_SIZE = 51

export const WORLDMAP_SPEED = 2 // speed scalar
export const WORLDMAP_ENCOUNTER_CHECK_RATE = 800 // ms (TODO: find right value)

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

        const ax = x + this.scrollLeft
        const ay = y + this.scrollTop

        worldmapPlayer.target = { x: ax, y: ay }
        showv($worldmapPlayer)
        Object.assign($worldmapTarget.style, {
            backgroundImage: "url('art/intrface/wmaptarg.png')",
            left: ax + 'px',
            top: ay + 'px',
        })
        dbg('worldmap', 'targeting: ' + ax + ', ' + ay)
    }

    $worldmapTarget.onclick = function (e: MouseEvent) {
        const area = withinArea(worldmapPlayer)
        if (area !== null) {
            // we're on a hotspot, visit the area map
            e.stopPropagation()
            uiWorldMapShowArea(area)
        } else {
            // we're in an open area, do nothing
        }
    }

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

    // updateWorldmapPlayer()
}

export function start() {
    updateWorldmapPlayer()
}

export function stop() {
    clearTimeout(worldmapTimer)
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
            worldmapPlayer.x = worldmapPlayer.target.x
            worldmapPlayer.y = worldmapPlayer.target.y
            worldmapPlayer.target = null

            hidev($worldmapPlayer)
            $worldmapTarget.style.backgroundImage = "url('art/intrface/hotspot1.png')"
            centerWorldmapTarget(worldmapPlayer.x, worldmapPlayer.y)
        } else {
            // normalize direction
            dx /= len
            dy /= len

            // head towards it
            worldmapPlayer.x += dx * speed
            worldmapPlayer.y += dy * speed
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

        // center the worldmap to the player
        const width = $worldmap.offsetWidth
        const height = $worldmap.offsetHeight
        const sx = clamp(0, width, Math.floor(worldmapPlayer.x - width / 2))
        const sy = clamp(0, height, Math.floor(worldmapPlayer.y - height / 2))

        $worldmap.scrollLeft = sx
        $worldmap.scrollTop = sy

        if (currentSquare.state !== WORLDMAP_DISCOVERED) setSquareStateAt(squarePos, WORLDMAP_DISCOVERED)

        // check for encounters
        const time = window.performance.now()
        if (Config.engine.doEncounters === true && time >= lastEncounterCheck + WORLDMAP_ENCOUNTER_CHECK_RATE) {
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

    worldmapTimer = setTimeout(updateWorldmapPlayer, 75)
}
