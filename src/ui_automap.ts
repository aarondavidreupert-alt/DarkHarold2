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
import { closeAllPanels } from './ui_panels.js'
import { UIMode } from './uiMode.js'
import { miscItemConsumeCharge, miscItemGetCharges, PROTO_ID_MOTION_SENSOR } from './miscItem.js'
import { uiLog } from './messageLog.js'
import { getMessage } from './util.js'
import { renderAutomapCanvas, drawAutomapInto } from './automapData.js'
import { makePanelDraggable } from './ui_drag.js'
import { assetUrl } from './modAssets.js'

let automapContainer: HTMLDivElement | null = null
// CE automap.cc AUTOMAP_WITH_SCANNER: living critters shown (motion sensor)
let scannerOn = false
// CE gAutomapFlags AUTOMAP_WTH_HIGH_DETAILS: kept between openings (Low at the start)
let highDetail = false
let automapDetailKeys: ((e: KeyboardEvent) => void) | null = null
export function automapKey(e: KeyboardEvent): void {
    automapDetailKeys?.(e)
}

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

export function getAutomapZoom(): number {
    return zoomLevel
}
export function setAutomapZoom(z: number): void {
    zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z))
}
export function zoomIn(): void {
    setAutomapZoom(zoomLevel + ZOOM_STEP)
}
export function zoomOut(): void {
    setAutomapZoom(zoomLevel - ZOOM_STEP)
}
export { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP }

// --- Pan state, keyed per (mapName, elevation). Resets when the player
// switches to a different map so each map remembers its own offset for the
// session.
const panState: Map<string, { x: number; y: number }> = new Map()

function panKey(mapName: string, elevation: number): string {
    return `${mapName}:${elevation}`
}

export function getAutomapPan(mapName: string, elevation: number): { x: number; y: number } {
    return panState.get(panKey(mapName, elevation)) ?? { x: 0, y: 0 }
}

export function setAutomapPan(mapName: string, elevation: number, x: number, y: number): void {
    panState.set(panKey(mapName, elevation), { x, y })
}

export function resetAutomapPan(mapName: string, elevation: number): void {
    panState.delete(panKey(mapName, elevation))
}

// Wire click & drag panning on a canvas.
//
// mousedown is on the canvas itself, but mousemove/mouseup are attached to
// `document` so the gesture survives even when the cursor briefly leaves the
// canvas (the common cause of "drag fires once then stops"). The delta on
// each mousemove is computed against the *previous* mouse position, not the
// initial down position, so panning stays smooth even if the canvas redraws.
//
// Listeners are guarded with `canvas.isConnected` so a removed canvas
// (closing PipBoy / Automap) cleanly stops responding without leaking work
// into a detached element.
export function attachAutomapDragPan(
    canvas: HTMLCanvasElement,
    getMap: () => { mapName: string; elevation: number } | null,
    onPanned: () => void,
): void {
    let isDragging = false
    let lastX = 0,
        lastY = 0

    canvas.style.cursor = 'grab'

    const onMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return
        if (!getMap()) return
        isDragging = true
        lastX = e.clientX
        lastY = e.clientY
        canvas.style.cursor = 'grabbing'
        e.preventDefault()
    }

    const onMouseMove = (e: MouseEvent) => {
        if (!isDragging) return
        if (!canvas.isConnected) {
            isDragging = false
            return
        }
        const m = getMap()
        if (!m) return
        const dx = e.clientX - lastX
        const dy = e.clientY - lastY
        lastX = e.clientX
        lastY = e.clientY
        if (dx === 0 && dy === 0) return
        const cur = getAutomapPan(m.mapName, m.elevation)
        setAutomapPan(m.mapName, m.elevation, cur.x + dx, cur.y + dy)
        onPanned()
    }

    const onMouseUp = () => {
        if (!isDragging) return
        isDragging = false
        canvas.style.cursor = 'grab'
    }

    canvas.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
}

// Wire mouse wheel zoom on a canvas. Scroll up zooms in, scroll down zooms
// out, using the same shared zoom state and limits as the +/- buttons. The
// refresh callback redraws in-place on the same canvas element so the drag
// listeners stay attached.
export function attachAutomapWheelZoom(canvas: HTMLCanvasElement, onZoomed: () => void): void {
    const onWheel = (e: WheelEvent) => {
        if (!canvas.isConnected) return
        e.preventDefault()
        if (e.deltaY < 0) zoomIn()
        else if (e.deltaY > 0) zoomOut()
        else return
        onZoomed()
    }
    // passive: false so preventDefault() actually blocks page scroll
    canvas.addEventListener('wheel', onWheel, { passive: false })
}

export function openAutomap(useScanner = false): void {
    // CE automapShow(isInGame, isUsingScanner) — using the Motion Sensor opens it scanning
    if (useScanner) closeAllPanels()
    scannerOn = useScanner
    // Remove any stale container
    const existing = document.getElementById('automapContainer')
    if (existing) existing.remove()

    globalState.uiMode = UIMode.automap

    automapContainer = document.createElement('div')
    automapContainer.id = 'automapContainer'
    automapContainer.style.cssText = `
        position: absolute; left: 80px; top: 21px;
        width: 640px; height: 480px;
        z-index: 100;
    `

    // Screen area with automap background
    const screen = document.createElement('div')
    screen.id = 'automapScreen'
    screen.style.cssText = `
        position: relative;
        width: 516px; height: 460px;
        background-image: url('${assetUrl('art/intrface/automap.png')}');
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
    const renderOpts = () => {
        const map = globalState.gMap
        const pan = map ? getAutomapPan(map.name!, map.currentElevation) : { x: 0, y: 0 }
        return { zoom: zoomLevel, panX: pan.x, panY: pan.y, scanner: scannerOn, highDetail }
    }

    const canvas = renderAutomapCanvas(MAP_INSET_W, MAP_INSET_H, renderOpts())
    canvas.style.cssText = canvasStyle
    screen.appendChild(canvas)

    // In-place redraw on the same canvas element so the drag listeners stay
    // attached across refreshes.
    const refresh = () => drawAutomapInto(canvas, renderOpts())

    attachAutomapDragPan(
        canvas,
        () => {
            const map = globalState.gMap
            if (!map || !map.name) return null
            return { mapName: map.name, elevation: map.currentElevation }
        },
        refresh,
    )
    attachAutomapWheelZoom(canvas, refresh)

    // SCANNER dot button
    const scannerDot = document.createElement('div')
    scannerDot.style.cssText = `
        position: absolute;
        left: 105px; top: 435px;
        width: 15px; height: 16px;
        background-image: url('${assetUrl('art/intrface/lilredup.png')}');
        cursor: pointer;
    `
    // CE automap.cc KEY_S: a Motion Sensor in a hand with charges turns the scanner on
    // (one charge), else misc.msg 17 / 18
    scannerDot.onclick = () => {
        if (!scannerOn) {
            const p = globalState.player
            const scanner = [p?.leftHand, p?.rightHand].find((it) => it?.pid === PROTO_ID_MOTION_SENSOR) ?? null
            if (scanner && miscItemGetCharges(scanner) > 0) {
                miscItemConsumeCharge(scanner)
                scannerOn = true
            } else {
                globalState.audioEngine?.playSfxByName('iisxxxx1')
                const msg = getMessage('misc', scanner ? 18 : 17)
                if (msg) uiLog(msg)
            }
        }
        refresh()
    }
    screen.appendChild(scannerDot)

    // CE automapShow: the LOW / HIGH detail switch (autoup / autodwn at 457, 340 in the 519×480
    // window; down = Low) and its keys L / H (CE's keys leave the switch art as it was; here it follows)
    const toggle = document.createElement('div')
    const drawToggle = () => {
        toggle.style.backgroundImage = `url('${assetUrl(highDetail ? 'art/intrface/autoup.png' : 'art/intrface/autodwn.png')}')`
    }
    toggle.style.cssText = `position: absolute; left: 438px; top: 326px; width: 40px; height: 71px;
        background-size: contain; background-repeat: no-repeat; cursor: pointer;`
    drawToggle()
    const setDetail = (high: boolean) => {
        if (high === highDetail) return
        highDetail = high
        globalState.audioEngine?.playSfxByName?.('toggle')
        drawToggle()
        refresh()
    }
    toggle.onclick = () => setDetail(!highDetail)
    screen.appendChild(toggle)
    automapDetailKeys = (e: KeyboardEvent) => {
        const k = e.key.toLowerCase()
        if (k === 'h') setDetail(true)
        else if (k === 'l') setDetail(false)
        else if (k === 's') scannerDot.click()
    }

    // Zoom controls (DH2): inside the top-right corner of the map inset
    const mkZoomBtn = (label: string, x: number, onClick: () => void) => {
        const btn = document.createElement('div')
        btn.textContent = label
        btn.style.cssText = `
            position: absolute;
            left: ${x}px; top: ${MAP_INSET_Y + 4}px;
            width: 22px; height: 18px;
            color: #00FF00; font-family: monospace; font-size: 14px;
            text-align: center; line-height: 18px;
            border: 1px solid #00AA00; background: rgba(0,20,0,0.7);
            cursor: pointer; user-select: none;
        `
        btn.onclick = onClick
        return btn
    }
    screen.appendChild(
        mkZoomBtn('-', MAP_INSET_X + MAP_INSET_W - 58, () => {
            zoomOut()
            refresh()
        }),
    )
    screen.appendChild(
        mkZoomBtn('+', MAP_INSET_X + MAP_INSET_W - 32, () => {
            zoomIn()
            refresh()
        }),
    )

    // CANCEL dot button
    const cancelDot = document.createElement('div')
    cancelDot.style.cssText = `
        position: absolute;
        left: 265px; top: 435px;
        width: 15px; height: 16px;
        background-image: url('${assetUrl('art/intrface/lilredup.png')}');
        cursor: pointer;
    `
    cancelDot.onclick = () => {
        closeAutomap()
    }
    screen.appendChild(cancelDot)

    // Append to #uiStage so the panel's hardcoded 800×600-era inline offsets
    // (left: 80px; top: 60px) center in the viewport regardless of size.
    const stage = document.getElementById('uiStage') ?? document.getElementById('game-container')!
    stage.appendChild(automapContainer)

    // Drag the automap panel from its frame; canvas drag-to-pan still wins
    // because makeDraggable skips elements with mousedown handlers.
    makePanelDraggable(automapContainer, 'automap')
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

export function isAutomapOpen(): boolean {
    return automapContainer !== null
}
