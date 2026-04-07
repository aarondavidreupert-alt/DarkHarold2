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

// Inset of the dark map area within automap.png (516x460 image)
const MAP_INSET_X = 24
const MAP_INSET_Y = 38
const MAP_INSET_W = 472
const MAP_INSET_H = 376

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
    let canvas = renderAutomapCanvas(MAP_INSET_W, MAP_INSET_H)
    canvas.style.cssText = canvasStyle
    screen.appendChild(canvas)

    // SCANNER dot button
    const scannerDot = document.createElement('div')
    scannerDot.style.cssText = `
        position: absolute;
        left: 105px; top: 435px;
        width: 15px; height: 16px;
        background-image: url('art/intrface/lilredup.png');
        cursor: pointer;
    `
    scannerDot.onclick = () => {
        // Refresh the rendered canvas (re-marks current player position)
        const newCanvas = renderAutomapCanvas(MAP_INSET_W, MAP_INSET_H)
        newCanvas.style.cssText = canvasStyle
        screen.replaceChild(newCanvas, canvas)
        canvas = newCanvas
    }
    screen.appendChild(scannerDot)

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
