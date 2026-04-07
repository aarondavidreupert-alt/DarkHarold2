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
import { UIMode } from './ui.js'
import { renderAutomapCanvas } from './automapData.js'

let automapContainer: HTMLDivElement | null = null

// Inset of the dark map area within automap.png (516x460 image).
// These dimensions are authoritative — do not override via CSS.
const MAP_INSET_X = 44
const MAP_INSET_Y = 38
const MAP_INSET_W = 380
const MAP_INSET_H = 360

// Per-session zoom state (shared with PipBoy AUTOMAPS tab)
let zoomLevel = 1
const ZOOM_MIN = 1
const ZOOM_MAX = 4
const ZOOM_STEP = 0.5

export function getAutomapZoom(): number { return zoomLevel }
export function setAutomapZoom(z: number): void {
    zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z))
}
export function zoomIn(): void { setAutomapZoom(zoomLevel + ZOOM_STEP) }
export function zoomOut(): void { setAutomapZoom(zoomLevel - ZOOM_STEP) }
export { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP }

export function openAutomap(): void {
    // Remove any stale container
    const existing = document.getElementById('automapContainer')
    if (existing) existing.remove()

    globalState.uiMode = UIMode.automap

    automapContainer = document.createElement('div')
    automapContainer.id = 'automapContainer'
    automapContainer.style.cssText = `
        position: absolute; left: 80px; top: 60px;
        width: 640px; height: 480px;
        z-index: 100;
    `

    // Screen area with automap background
    const screen = document.createElement('div')
    screen.id = 'automapScreen'
    screen.style.cssText = `
        position: relative;
        width: 516px; height: 460px;
        background-image: url('art/intrface/automap.png');
        background-size: contain;
        background-repeat: no-repeat;
        overflow: visible;
    `
    automapContainer.appendChild(screen)

    // Rendered map canvas, positioned inside the dark area of automap.png
    const canvasStyle = `
        position: absolute;
        left: ${MAP_INSET_X}px; top: ${MAP_INSET_Y}px;
        width: ${MAP_INSET_W}px; height: ${MAP_INSET_H}px;
        image-rendering: pixelated;
    `
    let canvas = renderAutomapCanvas(MAP_INSET_W, MAP_INSET_H, { zoom: zoomLevel })
    canvas.style.cssText = canvasStyle
    screen.appendChild(canvas)

    const refresh = () => {
        const newCanvas = renderAutomapCanvas(MAP_INSET_W, MAP_INSET_H, { zoom: zoomLevel })
        newCanvas.style.cssText = canvasStyle
        screen.replaceChild(newCanvas, canvas)
        canvas = newCanvas
    }

    // SCANNER dot button
    const scannerDot = document.createElement('div')
    scannerDot.style.cssText = `
        position: absolute;
        left: 105px; top: 435px;
        width: 15px; height: 16px;
        background-image: url('art/intrface/lilredup.png');
        cursor: pointer;
    `
    scannerDot.onclick = refresh
    screen.appendChild(scannerDot)

    // Zoom controls (top-right of the inner screen)
    const mkZoomBtn = (label: string, x: number, onClick: () => void) => {
        const btn = document.createElement('div')
        btn.textContent = label
        btn.style.cssText = `
            position: absolute;
            left: ${x}px; top: ${MAP_INSET_Y - 22}px;
            width: 22px; height: 18px;
            color: #00FF00; font-family: monospace; font-size: 14px;
            text-align: center; line-height: 18px;
            border: 1px solid #00AA00; background: rgba(0,20,0,0.7);
            cursor: pointer; user-select: none;
        `
        btn.onclick = onClick
        return btn
    }
    screen.appendChild(mkZoomBtn('-', MAP_INSET_X + MAP_INSET_W - 50, () => { zoomOut(); refresh() }))
    screen.appendChild(mkZoomBtn('+', MAP_INSET_X + MAP_INSET_W - 24, () => { zoomIn(); refresh() }))

    // CANCEL dot button
    const cancelDot = document.createElement('div')
    cancelDot.style.cssText = `
        position: absolute;
        left: 265px; top: 435px;
        width: 15px; height: 16px;
        background-image: url('art/intrface/lilredup.png');
        cursor: pointer;
    `
    cancelDot.onclick = () => {
        closeAutomap()
    }
    screen.appendChild(cancelDot)

    const gameContainer = document.getElementById('game-container')!
    gameContainer.appendChild(automapContainer)
}

export function closeAutomap(): void {
    if (!automapContainer) return

    automapContainer.remove()
    automapContainer = null
    globalState.uiMode = UIMode.none
}

export function toggleAutomap(): void {
    if (automapContainer) {
        closeAutomap()
    } else {
        openAutomap()
    }
}
