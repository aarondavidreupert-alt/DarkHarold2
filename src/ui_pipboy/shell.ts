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

// PipBoy shell: container, date/time bar, wait menu, shared widget helpers,
// tab dispatcher, public open/close/toggle. Split out of ui_pipboy.ts.
// See wiki/ts-split-refactor.md → "Per-file split proposals" §12.

import globalState from '../globalState.js'
import * as GameTime from '../gametime.js'
import { UIMode } from '../ui_panels.js'
import { Config } from '../config.js'
import { makePanelDraggable } from '../ui_drag.js'

export type PipBoyTab = 'STATUS' | 'AUTOMAPS' | 'ARCHIVES' | 'CLOSE'

// The screen div covers the entire PipBoy container so children using
// absolute positioning with pip.png-relative coordinates (e.g. the automap
// canvas at left:250, top:38) land in the right place without offset math.
const SCREEN_X = 0
const SCREEN_Y = 0
const SCREEN_W = 640
const SCREEN_H = 480

// Content area for text tabs (STATUS, ARCHIVES/quest log) — matches the
// green CRT screen region on pip.png.
export const CONTENT_X = 250
export const CONTENT_Y = 38
export const CONTENT_W = 350
export const CONTENT_H = 360

// Exact automap canvas placement requested — do NOT override via CSS.
export const AUTOMAP_CANVAS_LEFT = 250
export const AUTOMAP_CANVAS_TOP = 38
export const AUTOMAP_CANVAS_W = 350
export const AUTOMAP_CANVAS_H = 360

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
export const TEXT_STYLE = 'color: #00FF00; font-family: monospace;'

export function makeHeader(title: string): HTMLDivElement {
    const h = document.createElement('div')
    h.style.cssText = TEXT_STYLE + 'font-size: 16px; padding: 2px 6px 4px 6px; border-bottom: 1px solid #00AA00; margin-bottom: 6px;'
    h.textContent = title
    return h
}

export function makeRow(label: string, value: string, highlighted = false): HTMLDivElement {
    const row = document.createElement('div')
    row.style.cssText = TEXT_STYLE + 'font-size: 13px; line-height: 1.6; padding: 0 6px;'
    const v = document.createElement('span')
    v.style.color = highlighted ? '#FF4444' : '#FFFF00'
    v.textContent = value
    row.appendChild(document.createTextNode(label + ': '))
    row.appendChild(v)
    return row
}

export function makeListItem(label: string, onClick: () => void): HTMLDivElement {
    const el = document.createElement('div')
    el.style.cssText = TEXT_STYLE + 'font-size: 13px; padding: 3px 8px; cursor: pointer; border-bottom: 1px solid #003300;'
    el.textContent = label
    el.onmouseenter = () => { el.style.backgroundColor = 'rgba(0,80,0,0.35)' }
    el.onmouseleave = () => { el.style.backgroundColor = 'transparent' }
    el.onclick = onClick
    return el
}

export function makeButton(label: string, onClick: () => void): HTMLDivElement {
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

export function clearScreen(screen: HTMLDivElement): void {
    while (screen.firstChild) screen.removeChild(screen.firstChild)
}

// A content area pinned to the green CRT region on pip.png. All text tabs
// render their DOM children into one of these.
export function makeContentArea(): HTMLDivElement {
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

// Lazy tab imports — local require-style references so the side-effect import
// order in the barrel (shell.ts loaded before tabs) doesn't matter for cycles.
import { renderStatusTab } from './tabs/status.js'
import { renderAutomapsTab, resetAutomapNavState } from './tabs/automaps.js'
import { renderArchivesTab } from './tabs/archives.js'

export function renderTab(tab: PipBoyTab): void {
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
    resetAutomapNavState()

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
