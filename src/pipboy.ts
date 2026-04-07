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
import { renderAutomapCanvas } from './automapData.js'

type PipBoyTab = 'STATUS' | 'AUTOMAPS' | 'ARCHIVES' | 'CLOSE'

// Screen content area within pip.png (640x480 base)
const SCREEN_X = 256
const SCREEN_Y = 12
const SCREEN_W = 350
const SCREEN_H = 430

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

function renderStatusTab(screen: HTMLDivElement): void {
    const player = globalState.player!
    const hp = player.getStat('HP')
    const maxHP = player.getStat('Max HP')
    const poison = player.getStat('Poison Level') || 0
    const radiation = player.getStat('Radiation Level') || 0
    const gameTime = formatGameTime(globalState.gameTickTime)

    screen.innerHTML = `
        <div style="padding: 20px; color: #00FF00; font-family: monospace; font-size: 14px; line-height: 2;">
            <div style="font-size: 18px; margin-bottom: 16px; border-bottom: 1px solid #00AA00; padding-bottom: 8px;">STATUS</div>
            <div>Hit Points: <span style="color: #FFFF00;">${hp} / ${maxHP}</span></div>
            <div>Poisoned: <span style="color: ${poison > 0 ? '#FF4444' : '#00FF00'};">${poison}</span></div>
            <div>Radiated: <span style="color: ${radiation > 0 ? '#FF4444' : '#00FF00'};">${radiation}</span></div>
            <div style="margin-top: 16px; border-top: 1px solid #00AA00; padding-top: 8px;">
                Game Time: <span style="color: #FFFF00;">${gameTime}</span>
            </div>
        </div>
    `
}

function renderAutomapsTab(screen: HTMLDivElement): void {
    screen.innerHTML = ''

    const header = document.createElement('div')
    header.style.cssText = 'padding: 8px 12px; color: #00FF00; font-family: monospace; font-size: 16px; border-bottom: 1px solid #00AA00;'
    header.textContent = 'AUTOMAPS'
    screen.appendChild(header)

    const canvasW = SCREEN_W - 20
    const canvasH = SCREEN_H - 50
    const canvas = renderAutomapCanvas(canvasW, canvasH)
    canvas.style.cssText = `display: block; margin: 8px auto; image-rendering: pixelated;`
    screen.appendChild(canvas)
}

function renderArchivesTab(screen: HTMLDivElement): void {
    const gvars = Scripting.getGlobalVars()

    screen.innerHTML = ''

    const header = document.createElement('div')
    header.style.cssText = 'padding: 10px; color: #00FF00; font-family: monospace; font-size: 18px; border-bottom: 1px solid #00AA00; margin-bottom: 8px;'
    header.textContent = 'ARCHIVES'
    screen.appendChild(header)

    const list = document.createElement('div')
    list.style.cssText = 'padding: 10px; color: #00FF00; font-family: monospace; font-size: 12px; overflow-y: auto; max-height: ' + (SCREEN_H - 60) + 'px;'

    const keys = Object.keys(gvars)
    if (keys.length === 0) {
        list.textContent = 'No quest variables recorded.'
    } else {
        for (const key of keys) {
            const val = gvars[key]
            if (val !== 0) { // Only show non-zero (active) quest vars
                const entry = document.createElement('div')
                entry.style.cssText = 'margin-bottom: 4px; padding: 2px 0; border-bottom: 1px solid #003300;'
                entry.textContent = `GVAR ${key}: ${val}`
                list.appendChild(entry)
            }
        }
        if (list.children.length === 1) { // only the header
            list.textContent = 'No active quest variables.'
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
        overflow-y: auto; overflow-x: hidden;
        background-color: rgba(0, 20, 0, 0.85);
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
