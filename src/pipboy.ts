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
import { Scripting } from './scripting.js'
import { UIMode } from './ui.js'
import { renderAutomapCanvas, getArchiveEntries, ArchiveEntry } from './automapData.js'
import { getAutomapZoom, zoomIn, zoomOut } from './automap.js'

type PipBoyTab = 'STATUS' | 'AUTOMAPS' | 'ARCHIVES' | 'CLOSE'

// Renderable area inside the PipBoy HUD screen — authoritative.
// Do NOT override via CSS.
const SCREEN_X = 44
const SCREEN_Y = 38
const SCREEN_W = 380
const SCREEN_H = 360

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

// Archive navigation state (2-level hierarchy: location → sub-location)
let archiveSelectedLocation: string | null = null
let archiveViewing: ArchiveEntry | null = null

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

function getGameDate(ticks: number): { day: number; month: number; year: number; hours: number; minutes: number } {
    const totalMinutes = Math.floor(ticks / 600)
    const hours = Math.floor(totalMinutes / 60) % 24
    const minutes = totalMinutes % 60
    const totalDays = Math.floor(ticks / 864000)
    const daysInMonths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    // Start: Day 25, Month 7 (August, 0-indexed=7), Year 2241
    let year = 2241
    let month = 7 // August (0-indexed)
    let day = 25 + totalDays
    while (day > daysInMonths[month]) {
        day -= daysInMonths[month]
        month++
        if (month >= 12) {
            month = 0
            year++
        }
    }
    return { day, month, year, hours, minutes }
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
    // 1 minute = 600 ticks (1 tick = 0.1 seconds, 600 ticks = 60 seconds)
    globalState.gameTickTime += minutes * 600
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatGameTime(ticks: number): string {
    const { day, month, year, hours, minutes } = getGameDate(ticks)
    return `${MONTH_NAMES[month]} ${day}, ${year} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
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

function renderStatusTab(screen: HTMLDivElement): void {
    clearScreen(screen)
    const player = globalState.player!
    const hp = player.getStat('HP')
    const maxHP = player.getStat('Max HP')
    const poison = player.getStat('Poison Level') || 0
    const radiation = player.getStat('Radiation Level') || 0
    const gameTime = formatGameTime(globalState.gameTickTime)

    screen.appendChild(makeHeader('STATUS'))
    screen.appendChild(makeRow('Hit Points', `${hp} / ${maxHP}`))
    screen.appendChild(makeRow('Poisoned', String(poison), poison > 0))
    screen.appendChild(makeRow('Radiated', String(radiation), radiation > 0))

    const sep = document.createElement('div')
    sep.style.cssText = 'border-top: 1px solid #00AA00; margin: 8px 6px 4px 6px;'
    screen.appendChild(sep)
    screen.appendChild(makeRow('Game Time', gameTime))

    // Also show active quest variables here (was the old ARCHIVES tab contents)
    const gvars = Scripting.getGlobalVars()
    const active: string[] = []
    for (const k in gvars) { if (gvars[k] !== 0) active.push(`GVAR ${k}: ${gvars[k]}`) }
    if (active.length > 0) {
        const sep2 = document.createElement('div')
        sep2.style.cssText = 'border-top: 1px solid #00AA00; margin: 10px 6px 4px 6px;'
        screen.appendChild(sep2)
        const sub = document.createElement('div')
        sub.style.cssText = TEXT_STYLE + 'font-size: 13px; padding: 2px 6px 4px 6px;'
        sub.textContent = 'QUEST LOG'
        screen.appendChild(sub)
        const list = document.createElement('div')
        list.style.cssText = TEXT_STYLE + 'font-size: 11px; padding: 0 8px; overflow-y: auto;'
        list.style.maxHeight = `${SCREEN_H - 180}px`
        for (const entry of active) {
            const row = document.createElement('div')
            row.textContent = entry
            row.style.padding = '1px 0'
            list.appendChild(row)
        }
        screen.appendChild(list)
    }
}

// Helpers for the automap canvas embedded in a tab

function automapCanvasSize(): { w: number; h: number } {
    // Reserve space for the header + zoom bar
    return { w: SCREEN_W - 4, h: SCREEN_H - 48 }
}

function renderAutomapsTab(screen: HTMLDivElement): void {
    clearScreen(screen)
    screen.appendChild(makeHeader('AUTOMAPS'))

    // Zoom control bar
    const bar = document.createElement('div')
    bar.style.cssText = 'padding: 2px 6px 4px 6px; display: flex; align-items: center; gap: 4px;'
    const zoomLabel = document.createElement('span')
    zoomLabel.style.cssText = TEXT_STYLE + 'font-size: 11px; margin-right: 6px;'
    zoomLabel.textContent = `ZOOM ${getAutomapZoom().toFixed(1)}x`

    const refresh = () => renderAutomapsTab(screen)
    bar.appendChild(makeButton('-', () => { zoomOut(); refresh() }))
    bar.appendChild(makeButton('+', () => { zoomIn(); refresh() }))
    bar.appendChild(zoomLabel)
    screen.appendChild(bar)

    const { w, h } = automapCanvasSize()
    const canvas = renderAutomapCanvas(w, h, { zoom: getAutomapZoom() })
    canvas.style.cssText = 'display: block; margin: 2px auto; image-rendering: pixelated;'
    screen.appendChild(canvas)
}

// --- Archive tab: 2-level hierarchy (location → sub-location → rendered map)

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

function renderArchivesTab(screen: HTMLDivElement): void {
    clearScreen(screen)

    // Level 3: rendered map view
    if (archiveViewing) {
        const header = makeHeader(`ARCHIVE — ${archiveViewing.mapName.toUpperCase()} L${archiveViewing.elevation + 1}`)
        screen.appendChild(header)

        const backBar = document.createElement('div')
        backBar.style.cssText = 'padding: 2px 6px 4px 6px;'
        backBar.appendChild(makeButton('< BACK', () => {
            archiveViewing = null
            renderArchivesTab(screen)
        }))
        screen.appendChild(backBar)

        const img = document.createElement('img')
        img.src = archiveViewing.dataURL
        img.style.cssText = 'display: block; margin: 2px auto; image-rendering: pixelated; max-width: 100%;'
        screen.appendChild(img)
        return
    }

    // Level 2: list of sub-locations (maps) in the selected area
    if (archiveSelectedLocation) {
        screen.appendChild(makeHeader(`ARCHIVE — ${archiveSelectedLocation.toUpperCase()}`))

        const backBar = document.createElement('div')
        backBar.style.cssText = 'padding: 2px 6px 4px 6px;'
        backBar.appendChild(makeButton('< BACK', () => {
            archiveSelectedLocation = null
            renderArchivesTab(screen)
        }))
        screen.appendChild(backBar)

        const list = document.createElement('div')
        list.style.cssText = 'overflow-y: auto;'
        list.style.maxHeight = `${SCREEN_H - 80}px`

        const entries = getArchiveEntries().filter(e => locationForMap(e.mapName) === archiveSelectedLocation)
        entries.sort((a, b) => a.mapName === b.mapName ? a.elevation - b.elevation : a.mapName.localeCompare(b.mapName))
        if (entries.length === 0) {
            const empty = document.createElement('div')
            empty.style.cssText = TEXT_STYLE + 'font-size: 12px; padding: 6px 8px;'
            empty.textContent = '(no saved maps)'
            list.appendChild(empty)
        } else {
            for (const e of entries) {
                list.appendChild(makeListItem(`${e.mapName}  L${e.elevation + 1}`, () => {
                    archiveViewing = e
                    renderArchivesTab(screen)
                }))
            }
        }
        screen.appendChild(list)
        return
    }

    // Level 1: list of locations that have saved maps
    screen.appendChild(makeHeader('ARCHIVES'))

    const list = document.createElement('div')
    list.style.cssText = 'overflow-y: auto;'
    list.style.maxHeight = `${SCREEN_H - 50}px`

    const entries = getArchiveEntries()
    const locationMapCount: Map<string, number> = new Map()
    for (const e of entries) {
        const loc = locationForMap(e.mapName)
        locationMapCount.set(loc, (locationMapCount.get(loc) || 0) + 1)
    }
    if (locationMapCount.size === 0) {
        const empty = document.createElement('div')
        empty.style.cssText = TEXT_STYLE + 'font-size: 12px; padding: 6px 8px;'
        empty.textContent = '(no automap archives yet — explore the wastes)'
        list.appendChild(empty)
    } else {
        const sorted = Array.from(locationMapCount.keys()).sort()
        for (const loc of sorted) {
            const count = locationMapCount.get(loc)!
            list.appendChild(makeListItem(`${loc}  (${count})`, () => {
                archiveSelectedLocation = loc
                renderArchivesTab(screen)
            }))
        }
    }
    screen.appendChild(list)
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
    pipBoyContainer.style.cssText = `
        position: absolute; left: 80px; top: 60px;
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

    const gameContainer = document.getElementById('game-container')!
    gameContainer.appendChild(pipBoyContainer)

    // Reset archive navigation each time PipBoy opens
    archiveSelectedLocation = null
    archiveViewing = null

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
