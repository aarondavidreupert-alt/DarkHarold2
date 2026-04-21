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

import globalState from './globalState.js'
import * as GameTime from './gametime.js'
import { UIMode } from './ui.js'
import { drawAutomapInto, getArchivedMaps, getSeenTiles } from './automapData.js'
import { getAutomapZoom, zoomIn, zoomOut, getAutomapPan, attachAutomapDragPan, attachAutomapWheelZoom } from './ui_automap.js'
import { Config } from './config.js'
import { getActiveQuests, getUnknownActiveGvars } from './questLog.js'
import { makePanelDraggable } from './ui_drag.js'

type PipBoyTab = 'STATUS' | 'AUTOMAPS' | 'ARCHIVES' | 'CLOSE'

// The screen div covers the entire PipBoy container so children using
// absolute positioning with pip.png-relative coordinates (e.g. the automap
// canvas at left:250, top:38) land in the right place without offset math.
const SCREEN_X = 0
const SCREEN_Y = 0
const SCREEN_W = 640
const SCREEN_H = 480

// Content area for text tabs (STATUS, ARCHIVES/quest log) — matches the
// green CRT screen region on pip.png.
const CONTENT_X = 250
const CONTENT_Y = 38
const CONTENT_W = 350
const CONTENT_H = 360

// Exact automap canvas placement requested — do NOT override via CSS.
const AUTOMAP_CANVAS_LEFT = 250
const AUTOMAP_CANVAS_TOP = 38
const AUTOMAP_CANVAS_W = 350
const AUTOMAP_CANVAS_H = 360

// Clickable tab dot positions (left of each label in pip.png)
const TABS: { tab: PipBoyTab; x: number; y: number }[] = [
    { tab: 'STATUS',   x: 53, y: 340 },
    { tab: 'AUTOMAPS', x: 53, y: 394 },
    { tab: 'ARCHIVES', x: 53, y: 422 },
    { tab: 'CLOSE',    x: 53, y: 448 },
]

let pipBoyContainer: HTMLDivElement | null = null
let currentTab: PipBoyTab = 'STATUS'
const dotElements: Map<string, HTMLDivElement> = new Map()
let alarmOn = false
let waitMenuDiv: HTMLDivElement | null = null

// Automap tab navigation state (3 levels: Location → Map → Rendered canvas).
// Persists across tab switches in a single PipBoy session.
let automapSelectedLocation: string | null = null
let automapViewing: { mapName: string; elevation: number; isCurrent: boolean } | null = null

// numbers.png sprite: each digit is 9x17, laid out horizontally 0-9 then extra glyphs
// Index 12 = colon character
const DIGIT_W = 9
const DIGIT_H = 17

function makeDigit(digit: number, left: number, top: number): HTMLDivElement {
    const el = document.createElement('div')
    el.style.cssText = `
        position: absolute;
        left: ${left}px; top: ${top}px;
        width: ${DIGIT_W}px; height: ${DIGIT_H}px;
        background-image: url('art/intrface/numbers.png');
        background-position-x: -${digit * DIGIT_W}px;
        background-repeat: no-repeat;
    `
    return el
}

// Thin wrapper so the existing PipBoy rendering code can still destructure
// a `{day, month, year, hours, minutes}` object. The actual math lives in
// src/gametime.ts.
function getGameDate(_ticks: number): { day: number; month: number; year: number; hours: number; minutes: number } {
    return GameTime.getDate()
}

function renderDateTimeBar(): void {
    if (!pipBoyContainer) return

    // Remove old bar if exists
    const oldBar = pipBoyContainer.querySelector('#pipboyDateTimeBar')
    if (oldBar) oldBar.remove()

    const bar = document.createElement('div')
    bar.id = 'pipboyDateTimeBar'
    bar.style.cssText = 'position: absolute; left: 0; top: 18px; width: 240px; height: 20px;'

    const { day, month, year, hours, minutes } = getGameDate(globalState.gameTickTime)

    // 1. DAY — 2 digits at left:20
    const d1 = Math.floor(day / 10)
    const d2 = day % 10
    bar.appendChild(makeDigit(d1, 20, 0))
    bar.appendChild(makeDigit(d2, 20 + DIGIT_W, 0))

    // 2. MONTH sprite at left:40, top:242 (2px offset from bar top)
    const monthEl = document.createElement('div')
    monthEl.style.cssText = `
        position: absolute;
        left: 48px; top: 2px;
        width: 38px; height: 18px;
        background-image: url('art/intrface/months.png');
        background-position-y: -${month * 18}px;
        background-repeat: no-repeat;
    `
    bar.appendChild(monthEl)

    // 3. YEAR — 4 digits at left:82
    const y1 = Math.floor(year / 1000)
    const y2 = Math.floor((year % 1000) / 100)
    const y3 = Math.floor((year % 100) / 10)
    const y4 = year % 10
    bar.appendChild(makeDigit(y1, 86, 0))
    bar.appendChild(makeDigit(y2, 86 + DIGIT_W, 0))
    bar.appendChild(makeDigit(y3, 86 + DIGIT_W * 2, 0))
    bar.appendChild(makeDigit(y4, 86 + DIGIT_W * 3, 0))

    // 4. BELL button at left:130
    const bell = document.createElement('div')
    bell.style.cssText = `
        position: absolute;
        left: 126px; top: -4px;
        width: 22px; height: 20px;
        background-image: url('art/intrface/${alarmOn ? 'alarmin' : 'alarmout'}.png');
        cursor: pointer;
    `
    bell.onclick = () => toggleWaitMenu()
    bar.appendChild(bell)

    // 5. TIME HH:MM at left:158
    const h1 = Math.floor(hours / 10)
    const h2 = hours % 10
    const m1 = Math.floor(minutes / 10)
    const m2 = minutes % 10
    bar.appendChild(makeDigit(h1, 158, 0))
    bar.appendChild(makeDigit(h2, 158 + DIGIT_W, 0))
    // Colon at index 12
    //bar.appendChild(makeDigit(12, 158 + DIGIT_W * 2, 0))
    bar.appendChild(makeDigit(m1, 158 + DIGIT_W * 2, 0))
    bar.appendChild(makeDigit(m2, 158 + DIGIT_W * 3, 0))

    pipBoyContainer.appendChild(bar)
}

function toggleWaitMenu(): void {
    if (!pipBoyContainer) return

    if (waitMenuDiv) {
        waitMenuDiv.remove()
        waitMenuDiv = null
        alarmOn = false
        renderDateTimeBar()
        return
    }

    alarmOn = true
    renderDateTimeBar()

    waitMenuDiv = document.createElement('div')
    waitMenuDiv.style.cssText = `
        position: absolute;
        left: 340px; top: 80px;
        z-index: 200;
        background-color: rgba(0, 20, 0, 0.95);
        border: 1px solid #00AA00;
        padding: 8px;
    `

    const options: { label: string; minutes: number }[] = [
        { label: '10 MIN',  minutes: 10 },
        { label: '20 MIN',  minutes: 20 },
        { label: '30 MIN',  minutes: 30 },
        { label: '1 HR',    minutes: 60 },
        { label: '2 HR',    minutes: 120 },
        { label: '3 HR',    minutes: 180 },
        { label: '6 HR',    minutes: 360 },
        { label: '1 DAY',   minutes: 1440 },
    ]

    for (const opt of options) {
        const btn = document.createElement('div')
        btn.style.cssText = `
            color: #00FF00; font-family: monospace; font-size: 12px;
            padding: 4px 12px; cursor: pointer;
        `
        btn.textContent = opt.label
        btn.onmouseenter = () => { btn.style.backgroundColor = '#004400' }
        btn.onmouseleave = () => { btn.style.backgroundColor = 'transparent' }
        btn.onclick = () => {
            advanceTime(opt.minutes)
            if (waitMenuDiv) {
                waitMenuDiv.remove()
                waitMenuDiv = null
            }
            alarmOn = false
            renderDateTimeBar()
            // Re-render current tab to update time display
            renderTab(currentTab)
        }
        waitMenuDiv.appendChild(btn)
    }

    pipBoyContainer.appendChild(waitMenuDiv)
}

function advanceTime(minutes: number): void {
    const beforeTicks = GameTime.getTime()
    const beforeAmbient = GameTime.getAmbientLightNormalized()
    GameTime.advanceMinutes(minutes)
    const afterTicks = GameTime.getTime()
    const afterAmbient = GameTime.getAmbientLightNormalized()
    console.log(
        `[PipBoy wait] +${minutes}m  ticks ${beforeTicks} → ${afterTicks}  ` +
        `time ${GameTime.getTimeString()}  ambient ${beforeAmbient.toFixed(3)} → ${afterAmbient.toFixed(3)}`
    )
    console.log(
        `[lighting] after wait — doFloorLighting=${Config.engine.doFloorLighting}, ` +
        `floorLightingMode=${Config.engine.floorLightingMode}`
    )
}

function formatGameTime(_ticks: number): string {
    return `${GameTime.getDateString()}  ${GameTime.getTimeString()}`
}

// --- Shared primitives so every tab is built the same way ---

// Base text style used throughout the PipBoy screen. All tabs use the same
// transparent DOM approach (no dark canvas background), letting pip.png show
// through.
const TEXT_STYLE = 'color: #00FF00; font-family: monospace;'

function makeHeader(title: string): HTMLDivElement {
    const h = document.createElement('div')
    h.style.cssText = TEXT_STYLE + 'font-size: 16px; padding: 2px 6px 4px 6px; border-bottom: 1px solid #00AA00; margin-bottom: 6px;'
    h.textContent = title
    return h
}

function makeRow(label: string, value: string, highlighted = false): HTMLDivElement {
    const row = document.createElement('div')
    row.style.cssText = TEXT_STYLE + 'font-size: 13px; line-height: 1.6; padding: 0 6px;'
    const v = document.createElement('span')
    v.style.color = highlighted ? '#FF4444' : '#FFFF00'
    v.textContent = value
    row.appendChild(document.createTextNode(label + ': '))
    row.appendChild(v)
    return row
}

function makeListItem(label: string, onClick: () => void): HTMLDivElement {
    const el = document.createElement('div')
    el.style.cssText = TEXT_STYLE + 'font-size: 13px; padding: 3px 8px; cursor: pointer; border-bottom: 1px solid #003300;'
    el.textContent = label
    el.onmouseenter = () => { el.style.backgroundColor = 'rgba(0,80,0,0.35)' }
    el.onmouseleave = () => { el.style.backgroundColor = 'transparent' }
    el.onclick = onClick
    return el
}

function makeButton(label: string, onClick: () => void): HTMLDivElement {
    const b = document.createElement('div')
    b.textContent = label
    b.style.cssText = TEXT_STYLE + `
        font-size: 12px; padding: 2px 8px;
        border: 1px solid #00AA00; background: rgba(0,20,0,0.6);
        cursor: pointer; display: inline-block; margin-right: 4px;
    `
    b.onclick = onClick
    return b
}

function clearScreen(screen: HTMLDivElement): void {
    while (screen.firstChild) screen.removeChild(screen.firstChild)
}

// A content area pinned to the green CRT region on pip.png. All text tabs
// render their DOM children into one of these.
function makeContentArea(): HTMLDivElement {
    const c = document.createElement('div')
    c.style.cssText = `
        position: absolute;
        left: ${CONTENT_X}px; top: ${CONTENT_Y}px;
        width: ${CONTENT_W}px; height: ${CONTENT_H}px;
        overflow-y: auto; overflow-x: hidden;
        background: transparent;
    `
    return c
}

function renderStatusTab(screen: HTMLDivElement): void {
    clearScreen(screen)
    const content = makeContentArea()
    screen.appendChild(content)
    const player = globalState.player!
    const hp = player.getStat('HP')
    const maxHP = player.getStat('Max HP')
    const poison = player.getStat('Poison Level') || 0
    const radiation = player.getStat('Radiation Level') || 0

    content.appendChild(makeHeader('STATUS'))
    content.appendChild(makeRow('Hit Points', `${hp} / ${maxHP}`))
    content.appendChild(makeRow('Poisoned', String(poison), poison > 0))
    content.appendChild(makeRow('Radiated', String(radiation), radiation > 0))

    const sep = document.createElement('div')
    sep.style.cssText = 'border-top: 1px solid #00AA00; margin: 8px 6px 4px 6px;'
    content.appendChild(sep)
    // Fallout-2-style clock: DAY N, HH:MM AM/PM, Mon DD, YYYY.
    content.appendChild(makeRow('Day', `${GameTime.getDay()}  ${GameTime.getTimeString()}`))
    content.appendChild(makeRow('Date', GameTime.getDateString()))
    const nightLabel = GameTime.isNightTime() ? 'NIGHT' : 'DAY'
    content.appendChild(makeRow('Cycle', nightLabel))
}

// --- AUTOMAPS tab: 3-level hierarchy (location → map → rendered canvas)

function locationForMap(mapName: string): string {
    const areas = globalState.mapAreas
    if (areas) {
        for (const id in areas) {
            const area = areas[id]
            for (const e of area.entrances) {
                if (e.mapName === mapName) return area.name
            }
        }
    }
    return 'Unknown'
}

interface AutomapMapEntry {
    mapName: string
    elevation: number
    isCurrent: boolean
}

// All known maps: every (mapName, elevation) for which we have seen-tile
// data, plus the currently-loaded map (marked CURRENT). Driven by the
// persistent seenData store, so the list shows EVERY visited location, not
// just the current one.
function collectAutomapEntries(): AutomapMapEntry[] {
    const out: AutomapMapEntry[] = []
    const seen = new Set<string>()

    const current = globalState.gMap
    if (current && current.name) {
        const k = `${current.name}:${current.currentElevation}`
        seen.add(k)
        out.push({ mapName: current.name, elevation: current.currentElevation, isCurrent: true })
    }
    for (const e of getArchivedMaps()) {
        const k = `${e.mapName}:${e.elevation}`
        if (seen.has(k)) continue
        seen.add(k)
        out.push({ mapName: e.mapName, elevation: e.elevation, isCurrent: false })
    }
    return out
}

// Apply the exact CSS placement requested — authoritative. Does NOT touch
// canvas.width/height (setting those clears the bitmap, which would erase any
// drawing that already happened).
function styleAutomapCanvas(canvas: HTMLCanvasElement): void {
    canvas.style.cssText =
        `position: absolute; ` +
        `left: ${AUTOMAP_CANVAS_LEFT}px; ` +
        `top: ${AUTOMAP_CANVAS_TOP}px; ` +
        `width: ${AUTOMAP_CANVAS_W}px; ` +
        `height: ${AUTOMAP_CANVAS_H}px; ` +
        `overflow: hidden; ` +
        `background: transparent;`
}

// Create + size + style + draw an automap canvas in the correct order so the
// pixels survive into the DOM (see styleAutomapCanvas comment).
function createAutomapCanvas(opts: { zoom: number; panX: number; panY: number; forMap?: string; forElevation?: number }): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = AUTOMAP_CANVAS_W
    canvas.height = AUTOMAP_CANVAS_H
    styleAutomapCanvas(canvas)
    drawAutomapInto(canvas, opts)
    return canvas
}

function renderAutomapsTab(screen: HTMLDivElement): void {
    clearScreen(screen)

    // Level 3 — rendered map view (current map render live; archived maps
    // render from the saved seen-tile data via the same renderer)
    if (automapViewing) {
        const v = automapViewing
        const header = document.createElement('div')
        header.style.cssText = TEXT_STYLE +
            `position: absolute; left: ${CONTENT_X}px; top: ${CONTENT_Y - 22}px;` +
            `width: ${CONTENT_W}px; font-size: 13px;`
        header.textContent = `${v.mapName.toUpperCase()}  L${v.elevation + 1}${v.isCurrent ? '  (CURRENT)' : ''}`
        screen.appendChild(header)

        // Back button above the canvas
        const back = makeButton('< BACK', () => {
            automapViewing = null
            renderAutomapsTab(screen)
        })
        back.style.position = 'absolute'
        back.style.left = `${CONTENT_X + CONTENT_W - 70}px`
        back.style.top = `${CONTENT_Y - 22}px`
        screen.appendChild(back)

        // Build render options. Archived maps pass forMap/forElevation so the
        // renderer pulls their saved seen-tile set instead of the live map.
        const renderOpts = () => {
            const pan = getAutomapPan(v.mapName, v.elevation)
            const opts: { zoom: number; panX: number; panY: number; forMap?: string; forElevation?: number } = {
                zoom: getAutomapZoom(), panX: pan.x, panY: pan.y,
            }
            if (!v.isCurrent) {
                opts.forMap = v.mapName
                opts.forElevation = v.elevation
            }
            return opts
        }

        const canvas = createAutomapCanvas(renderOpts())
        screen.appendChild(canvas)

        // In-place redraw on the same canvas element so drag listeners
        // attached below stay alive across refreshes (zoom, drag, etc.)
        const refresh = () => drawAutomapInto(canvas, renderOpts())

        attachAutomapDragPan(canvas, () => ({ mapName: v.mapName, elevation: v.elevation }), refresh)

        // Zoom bar sits just below the canvas within the CRT area
        const zoomBar = document.createElement('div')
        zoomBar.style.cssText =
            `position: absolute; ` +
            `left: ${AUTOMAP_CANVAS_LEFT}px; ` +
            `top: ${AUTOMAP_CANVAS_TOP + AUTOMAP_CANVAS_H + 2}px;` +
            `display: flex; align-items: center; gap: 4px;`
        const zl = document.createElement('span')
        zl.style.cssText = TEXT_STYLE + 'font-size: 11px; margin-left: 6px;'
        zl.textContent = `ZOOM ${getAutomapZoom().toFixed(1)}x`
        zoomBar.appendChild(makeButton('-', () => { zoomOut(); refresh(); zl.textContent = `ZOOM ${getAutomapZoom().toFixed(1)}x` }))
        zoomBar.appendChild(makeButton('+', () => { zoomIn(); refresh(); zl.textContent = `ZOOM ${getAutomapZoom().toFixed(1)}x` }))
        zoomBar.appendChild(zl)
        screen.appendChild(zoomBar)

        // Mouse wheel zoom — scroll up = in, scroll down = out. Hooked after
        // the zoom label exists so its text can update in sync.
        attachAutomapWheelZoom(canvas, () => { refresh(); zl.textContent = `ZOOM ${getAutomapZoom().toFixed(1)}x` })
        return
    }

    // Levels 1 and 2 use the text content area
    const content = makeContentArea()
    screen.appendChild(content)

    // Level 2 — list of maps in the selected location
    if (automapSelectedLocation) {
        content.appendChild(makeHeader(automapSelectedLocation.toUpperCase()))

        const backBar = document.createElement('div')
        backBar.style.cssText = 'padding: 2px 6px 4px 6px;'
        backBar.appendChild(makeButton('< BACK', () => {
            automapSelectedLocation = null
            renderAutomapsTab(screen)
        }))
        content.appendChild(backBar)

        const list = document.createElement('div')
        list.style.cssText = 'overflow-y: auto;'
        list.style.maxHeight = `${CONTENT_H - 80}px`

        const entries = collectAutomapEntries()
            .filter(e => locationForMap(e.mapName) === automapSelectedLocation)
            .sort((a, b) => a.mapName === b.mapName ? a.elevation - b.elevation : a.mapName.localeCompare(b.mapName))

        if (entries.length === 0) {
            const empty = document.createElement('div')
            empty.style.cssText = TEXT_STYLE + 'font-size: 12px; padding: 6px 8px;'
            empty.textContent = '(no saved maps)'
            list.appendChild(empty)
        } else {
            for (const e of entries) {
                const label = `${e.mapName}  L${e.elevation + 1}${e.isCurrent ? '  (CURRENT)' : ''}`
                list.appendChild(makeListItem(label, () => {
                    const tiles = getSeenTiles(e.mapName, e.elevation)
                    console.log(
                        `[automap] level-3 click: mapName=${e.mapName} elevation=${e.elevation} ` +
                        `isCurrent=${e.isCurrent} seenTiles=${tiles.size}`
                    )
                    automapViewing = e
                    renderAutomapsTab(screen)
                }))
            }
        }
        content.appendChild(list)
        return
    }

    // Level 1 — list of locations
    content.appendChild(makeHeader('AUTOMAPS'))

    const list = document.createElement('div')
    list.style.cssText = 'overflow-y: auto;'
    list.style.maxHeight = `${CONTENT_H - 50}px`

    const locationMapCount: Map<string, number> = new Map()
    for (const e of collectAutomapEntries()) {
        const loc = locationForMap(e.mapName)
        locationMapCount.set(loc, (locationMapCount.get(loc) || 0) + 1)
    }
    if (locationMapCount.size === 0) {
        const empty = document.createElement('div')
        empty.style.cssText = TEXT_STYLE + 'font-size: 12px; padding: 6px 8px;'
        empty.textContent = '(no maps known yet — explore the wastes)'
        list.appendChild(empty)
    } else {
        const sorted = Array.from(locationMapCount.keys()).sort()
        for (const loc of sorted) {
            const count = locationMapCount.get(loc)!
            list.appendChild(makeListItem(`${loc}  (${count})`, () => {
                automapSelectedLocation = loc
                renderAutomapsTab(screen)
            }))
        }
    }
    content.appendChild(list)
}

// --- ARCHIVES tab: Quest log / journal

function renderArchivesTab(screen: HTMLDivElement): void {
    clearScreen(screen)
    const content = makeContentArea()
    screen.appendChild(content)

    content.appendChild(makeHeader('QUEST LOG'))

    const quests = getActiveQuests()

    const list = document.createElement('div')
    list.style.cssText = TEXT_STYLE + 'font-size: 11px; padding: 2px 8px; overflow-y: auto;'
    list.style.maxHeight = `${CONTENT_H - 50}px`

    if (quests.length === 0) {
        const empty = document.createElement('div')
        empty.style.cssText = 'padding: 6px 0;'
        empty.textContent = '(no quests in progress)'
        list.appendChild(empty)
    } else {
        // Group quests by location, preserving definition order
        const grouped = new Map<string, typeof quests>()
        for (const q of quests) {
            let arr = grouped.get(q.location)
            if (!arr) { arr = []; grouped.set(q.location, arr) }
            arr.push(q)
        }

        for (const [location, locationQuests] of grouped) {
            // Location header
            const header = document.createElement('div')
            header.style.cssText = 'color: #00FF00; font-size: 13px; font-weight: bold; padding: 6px 0 2px 0; border-bottom: 1px solid #005500;'
            header.textContent = location.toUpperCase()
            list.appendChild(header)

            for (const q of locationQuests) {
                const row = document.createElement('div')
                row.style.cssText = `padding: 2px 0 2px 12px; border-bottom: 1px solid #003300; ` +
                    (q.isCompleted
                        ? 'color: #007700; text-decoration: line-through;'
                        : 'color: #00FF00;')
                row.textContent = q.description
                list.appendChild(row)
            }
        }
    }
    content.appendChild(list)

    // Debug: show non-zero GVARs that don't map to any known quest
    if (Config.scripting.debugLogShowType.gvars) {
        const unknown = getUnknownActiveGvars()
        if (unknown.length > 0) {
            const sep = document.createElement('div')
            sep.style.cssText = 'border-top: 1px solid #00AA00; margin: 8px 0 4px 0;'
            list.appendChild(sep)

            const debugHeader = document.createElement('div')
            debugHeader.style.cssText = 'color: #AAAA00; font-size: 11px; padding: 2px 0;'
            debugHeader.textContent = 'DEBUG: Unknown active GVARs'
            list.appendChild(debugHeader)

            for (const g of unknown) {
                const row = document.createElement('div')
                row.style.cssText = 'color: #888800; font-size: 10px; padding: 1px 0 1px 12px;'
                row.textContent = `GVAR ${g.index}: ${g.value}`
                list.appendChild(row)
            }
        }
    }
}

function renderTab(tab: PipBoyTab): void {
    if (!pipBoyContainer) return

    const screen = pipBoyContainer.querySelector('#pipboyScreen') as HTMLDivElement
    if (!screen) return

    currentTab = tab

    switch (tab) {
        case 'STATUS':
            renderStatusTab(screen)
            break
        case 'AUTOMAPS':
            renderAutomapsTab(screen)
            break
        case 'ARCHIVES':
            renderArchivesTab(screen)
            break
        case 'CLOSE':
            closePipBoy()
            break
    }

    // Update indicator dots
    for (const [tabName, dotEl] of dotElements) {
        dotEl.style.backgroundImage = tabName === tab
            ? "url('art/intrface/lilreddn.png')"
            : "url('art/intrface/lilredup.png')"
    }
}

export function openPipBoy(): void {
    // Remove any stale container left in the DOM
    const existing = document.getElementById('pipBoyContainer')
    if (existing) existing.remove()

    globalState.uiMode = UIMode.pipBoy

    pipBoyContainer = document.createElement('div')
    pipBoyContainer.id = 'pipBoyContainer'

    // Background image
    // Centered in the 800×600 uiStage with bottom flush against the HUD:
    // left = (800-640)/2 = 80, top = 600 - 99 - 480 = 21.
    pipBoyContainer.style.cssText = `
        position: absolute; left: 80px; top: 21px;
        width: 640px; height: 480px;
        background-image: url('art/intrface/pip.png');
        background-size: 640px 480px;
        z-index: 100;
    `

    // Screen content area (right panel)
    const screen = document.createElement('div')
    screen.id = 'pipboyScreen'
    screen.style.cssText = `
        position: absolute;
        left: ${SCREEN_X}px; top: ${SCREEN_Y}px;
        width: ${SCREEN_W}px; height: ${SCREEN_H}px;
        overflow: hidden;
        background: transparent;
    `
    pipBoyContainer.appendChild(screen)

    // Tab buttons — clickable dot indicators
    dotElements.clear()
    for (const btn of TABS) {
        const dot = document.createElement('div')
        dot.style.cssText = `
            position: absolute;
            left: ${btn.x}px; top: ${btn.y}px;
            width: 15px; height: 16px;
            background-image: url('art/intrface/lilredup.png');
            cursor: pointer;
        `
        dot.onclick = () => renderTab(btn.tab)
        dotElements.set(btn.tab, dot)
        pipBoyContainer.appendChild(dot)
    }

    // Attach to #uiStage so the 800×600-era `left: 80px; top: 60px` inline
    // offsets center in the viewport on any screen size. Fall back to
    // #game-container on the off chance the stage isn't there.
    const stage = document.getElementById('uiStage') ?? document.getElementById('game-container')!
    stage.appendChild(pipBoyContainer)

    // Allow the user to drag the panel by clicking non-interactive background
    // areas (the pip.png frame) — tab dots/buttons are skipped automatically.
    makePanelDraggable(pipBoyContainer)

    // Reset automap navigation each time PipBoy opens
    automapSelectedLocation = null
    automapViewing = null

    renderDateTimeBar()
    renderTab('STATUS')
}

export function closePipBoy(): void {
    if (!pipBoyContainer) return

    waitMenuDiv = null
    alarmOn = false
    pipBoyContainer.remove()
    pipBoyContainer = null
    globalState.uiMode = UIMode.none
}

export function togglePipBoy(): void {
    if (pipBoyContainer) {
        closePipBoy()
    } else {
        openPipBoy()
    }
}

export function isPipBoyOpen(): boolean {
    return pipBoyContainer !== null
}
