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

function formatGameTime(ticks: number): string {
    const totalSeconds = Math.floor(ticks / 10)
    const hours = Math.floor((ticks / 600) % 24)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    // Fallout 2 starts at July 25, 2241 — day 0
    const totalDays = Math.floor(ticks / (10 * 60 * 60 * 24))
    const startMonth = 7 // July
    const startDay = 25
    const startYear = 2241
    const dayOfYear = totalDays + (startDay - 1) // 0-indexed from start of year
    const daysInMonths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    let year = startYear
    let month = startMonth - 1 // 0-indexed
    let day = startDay + totalDays
    while (day > daysInMonths[month]) {
        day -= daysInMonths[month]
        month++
        if (month >= 12) {
            month = 0
            year++
        }
    }
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                         'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${monthNames[month]} ${day}, ${year} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
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
    const map = globalState.gMap
    screen.innerHTML = ''

    const header = document.createElement('div')
    header.style.cssText = 'padding: 10px; color: #00FF00; font-family: monospace; font-size: 18px; border-bottom: 1px solid #00AA00; margin-bottom: 8px;'
    header.textContent = 'AUTOMAPS'
    screen.appendChild(header)

    if (!map || !map.floorMap) {
        const noMap = document.createElement('div')
        noMap.style.cssText = 'padding: 20px; color: #00FF00; font-family: monospace;'
        noMap.textContent = 'No map data available.'
        screen.appendChild(noMap)
        return
    }

    const canvas = document.createElement('canvas')
    const tileRows = map.floorMap.length
    const tileCols = tileRows > 0 ? map.floorMap[0].length : 0

    // Fit into the screen area
    const maxW = SCREEN_W - 20
    const maxH = SCREEN_H - 60
    const scale = Math.min(maxW / tileCols, maxH / tileRows, 4)
    canvas.width = Math.floor(tileCols * scale)
    canvas.height = Math.floor(tileRows * scale)
    canvas.style.cssText = `display: block; margin: 0 auto;`

    const ctx = canvas.getContext('2d')!
    for (let row = 0; row < tileRows; row++) {
        for (let col = 0; col < tileCols; col++) {
            const tile = map.floorMap[row][col]
            // Render tiles as colored blocks — blank/null tiles are dark, others green
            if (tile && tile !== 'art/tiles/blank.png') {
                ctx.fillStyle = '#004400'
            } else {
                ctx.fillStyle = '#001100'
            }
            ctx.fillRect(col * scale, row * scale, scale, scale)
        }
    }

    // Draw player position indicator
    const playerPos = globalState.player!.position
    if (playerPos) {
        const px = (playerPos.x / 200) * canvas.width  // rough mapping
        const py = (playerPos.y / 200) * canvas.height
        ctx.fillStyle = '#00FF00'
        ctx.fillRect(px - 2, py - 2, 5, 5)
    }

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

    renderTab('STATUS')
}

export function closePipBoy(): void {
    if (!pipBoyContainer) return

    pipBoyContainer.parentNode!.removeChild(pipBoyContainer)
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
