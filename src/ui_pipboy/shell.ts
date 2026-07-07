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
let isRestAnimating = false  // prevents re-entry during time-advance animation

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

    // 2. MONTH sprite — CE ref: pipboy.cc:798, PIPBOY_WINDOW_MONTH_X=46, Y=18.
    //    months.png: 29×(12×15)px, each month is 29×14px visible at stride 15.
    //    Bar is at top:18px so month top=0 lands at absolute y=18. month is 0-indexed.
    const monthEl = document.createElement('div')
    monthEl.style.cssText = `
        position: absolute;
        left: 46px; top: 0px;
        width: 29px; height: 14px;
        background-image: url('art/intrface/months.png');
        background-position-y: -${month * 15}px;
        background-repeat: no-repeat;
        image-rendering: pixelated;
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

    // 4. BELL button — CE ref: pipboy.cc:566 buttonCreate(gPipboyWindow, 124, 13, ...).
    //    Bar is at top:18px → button top = 13-18 = -5px in bar coords.
    const bell = document.createElement('div')
    bell.style.cssText = `
        position: absolute;
        left: 125px; top: -5px;
        width: 28px; height: 24px;
        background-image: url('art/intrface/${alarmOn ? 'alarmin' : 'alarmout'}.png');
        background-repeat: no-repeat;
        image-rendering: pixelated;
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

// CE ref: pipboy.cc _ClacTime — compute hours+minutes until wakeUpHour:00.
// If already at that exact time, returns 24h (rest a full day).
function calcTimeUntilHour(wakeUpHour: number): { hours: number; minutes: number } {
    const curH = GameTime.getHour()
    const curM = GameTime.getMinute()
    if (curH === wakeUpHour && curM === 0) return { hours: 24, minutes: 0 }
    let hours = wakeUpHour - curH
    let minutes = 0
    if (curM !== 0) {
        hours -= 1
        minutes = 60 - curM
    }
    if (hours < 0) hours += 24
    return { hours, minutes }
}

// CE ref: pipboy.cc:2105 PIPBOY_REST_DURATION_UNTIL_HEALED —
// hoursToHeal = floor(hpToHeal / healingRate * 3); healingRate = max(END/3, 1).
function minutesUntilHealed(): number {
    const player = globalState.player
    if (!player) return 0
    const hp    = player.getStat('HP') as number
    const maxHp = player.getStat('Max HP') as number
    if (hp >= maxHp) return 0
    const end = player.getStat('Endurance') as number
    const healingRate = Math.max(Math.floor(end / 3), 1)
    const hoursToHeal = Math.floor((maxHp - hp) / healingRate * 3)
    return Math.max(hoursToHeal, 1) * 60
}

function toggleWaitMenu(): void {
    if (!pipBoyContainer) return

    // Toggle off — restore previous tab
    if (alarmOn) {
        alarmOn = false
        waitMenuDiv = null
        renderDateTimeBar()
        renderTab(currentTab)
        return
    }

    alarmOn = true
    renderDateTimeBar()

    // CE ref: pipboy.cc pipboyWindowRenderRestOptions — rest list renders into
    // the main content view area, replacing whatever tab is shown.
    const screen = pipBoyContainer.querySelector('#pipboyScreen') as HTMLDivElement
    if (!screen) return
    while (screen.firstChild) screen.removeChild(screen.firstChild)

    const content = makeContentArea()
    content.appendChild(makeHeader('REST'))

    // CE ref: pipboy.cc PIPBOY_REST_DURATION_* — 13 options (UNTIL_PARTY_HEALED
    // omitted; requires party members which DH2 does not yet implement).
    type RestOption = { label: string; getMinutes: () => number }
    const options: RestOption[] = [
        { label: '10 minutes',     getMinutes: () => 10 },
        { label: '30 minutes',     getMinutes: () => 30 },
        { label: '1 hour',         getMinutes: () => 60 },
        { label: '2 hours',        getMinutes: () => 120 },
        { label: '3 hours',        getMinutes: () => 180 },
        { label: '4 hours',        getMinutes: () => 240 },
        { label: '5 hours',        getMinutes: () => 300 },
        { label: '6 hours',        getMinutes: () => 360 },
        { label: 'Until morning',  getMinutes: () => { const t = calcTimeUntilHour(8);  return t.hours * 60 + t.minutes } },
        { label: 'Until noon',     getMinutes: () => { const t = calcTimeUntilHour(12); return t.hours * 60 + t.minutes } },
        { label: 'Until evening',  getMinutes: () => { const t = calcTimeUntilHour(18); return t.hours * 60 + t.minutes } },
        { label: 'Until midnight', getMinutes: () => { const t = calcTimeUntilHour(0);  return t.hours * 60 + t.minutes } },
        { label: 'Until healed',   getMinutes: () => minutesUntilHealed() },
    ]

    for (const opt of options) {
        content.appendChild(makeListItem(opt.label, async () => {
            if (isRestAnimating) return
            const mins = opt.getMinutes()
            if (mins > 0) await advanceTime(mins)
            alarmOn = false
            waitMenuDiv = null
            renderDateTimeBar()
            renderTab(currentTab)
        }))
    }

    screen.appendChild(content)
    waitMenuDiv = content  // track so toggle-off knows we're in rest mode
}

// CE ref: pipboy.cc:1968 pipboyRest() — animates the date/time bar while advancing
// game time, then heals the player. Animation formula: v2 = totalMinutes/1440*3.5+0.25
// seconds total, ~20fps (50ms per frame), stepping game time proportionally each frame.
async function advanceTime(minutes: number): Promise<void> {
    if (isRestAnimating) return
    isRestAnimating = true

    const startTicks = GameTime.getTime()
    const totalTicks = minutes * GameTime.TICKS_PER_MINUTE
    const animSeconds = minutes / 1440 * 3.5 + 0.25  // CE formula
    const nSteps = Math.max(1, Math.round(animSeconds * 20))

    for (let step = 0; step < nSteps; step++) {
        const progress = (step + 1) / nSteps
        GameTime.setTime(Math.round(startTicks + progress * totalTicks))
        renderDateTimeBar()
        await new Promise<void>(res => setTimeout(res, 50))
    }

    GameTime.setTime(startTicks + totalTicks)

    // Heal player — CE ref: pipboy.cc:2029 _Check4Health() / _AddHealth()
    const player = globalState.player
    if (player) {
        const hp    = player.getStat('HP') as number
        const maxHp = player.getStat('Max HP') as number
        if (hp < maxHp) {
            const end = player.getStat('Endurance') as number
            const healingRate = Math.max(Math.floor(end / 3), 1)
            const healed = Math.floor(minutes / 60 / 3 * healingRate)
            player.stats.setBase('HP', Math.min(hp + healed, maxHp))
        }
    }

    isRestAnimating = false
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
