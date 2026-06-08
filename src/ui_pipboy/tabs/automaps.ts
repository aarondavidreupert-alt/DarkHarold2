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

// PipBoy AUTOMAPS tab — split out of ui_pipboy.ts. See
// wiki/ts-split-refactor.md → "Per-file split proposals" §12.

import globalState from '../../globalState.js'
import { drawAutomapInto, getArchivedMaps, getSeenTiles } from '../../automapData.js'
import { getAutomapZoom, zoomIn, zoomOut, getAutomapPan, attachAutomapDragPan, attachAutomapWheelZoom } from '../../ui_automap.js'
import {
    AUTOMAP_CANVAS_LEFT,
    AUTOMAP_CANVAS_TOP,
    AUTOMAP_CANVAS_W,
    AUTOMAP_CANVAS_H,
    CONTENT_X,
    CONTENT_Y,
    CONTENT_W,
    CONTENT_H,
    TEXT_STYLE,
    clearScreen,
    makeContentArea,
    makeHeader,
    makeListItem,
    makeButton,
} from '../shell.js'

// Automap tab navigation state (3 levels: Location → Map → Rendered canvas).
// Persists across tab switches in a single PipBoy session.
let automapSelectedLocation: string | null = null
let automapViewing: { mapName: string; elevation: number; isCurrent: boolean } | null = null

export function resetAutomapNavState(): void {
    automapSelectedLocation = null
    automapViewing = null
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

export function renderAutomapsTab(screen: HTMLDivElement): void {
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
