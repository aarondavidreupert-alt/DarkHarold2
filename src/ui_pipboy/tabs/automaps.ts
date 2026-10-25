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
import { dbg } from '../../logger.js'
import { getMessage } from '../../util.js'
import { mapIndexOf } from '../../data.js'
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

// Automap tab navigation state (3 levels: city → map elevation → rendered canvas).
// Persists across tab switches in a single PipBoy session. The city is CE's _amcty_indx:
// the first listed map of it (its area as the key).
let automapSelectedLocation: { area: number; mapName: string } | null = null
let automapViewing: { mapName: string; elevation: number; isCurrent: boolean } | null = null

export function resetAutomapNavState(): void {
    automapSelectedLocation = null
    automapViewing = null
}

// --- AUTOMAPS tab: CE pipboy.cc pipboyWindowHandleAutomaps — cities (_PrintAMList), then the
// city's maps by elevation (_PrintAMelevList), then the map drawn (DH2 adds zoom and pan).

// CE automap.cc _displayMapList: the maps.txt indices never listed (desert / encounter maps …)
const AUTOMAP_HIDDEN_MAPS: ReadonlySet<number> = new Set([
    0, 1, 2, 52, 53, 59, 60, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91,
    94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 110, 111, 112, 113, 114, 115, 116, 117,
    118, 119, 120, 121, 122, 123, 124, 125, 127, 141, 142, 143, 144, 145, 146, 149, 150, 151, 152, 153, 154, 155,
    156, 157, 158, 159,
])

// CE worldmap.cc wmMatchAreaContainingMapIdx: the first area with an entrance to the map, or -1
function areaOfMap(mapName: string): number {
    const areas = globalState.mapAreas
    if (!areas) return -1
    const name = mapName.toLowerCase()
    for (const id of Object.keys(areas).map(Number).sort((x, y) => x - y)) {
        if (areas[id].entrances.some((e: any) => (e.mapName ?? '').toLowerCase() === name)) return id
    }
    return -1
}

// CE map.cc mapGetCityName (map.msg 1500 + area, "Error" for none) / mapGetName (map.msg
// 200 + 3 × map + elevation)
const cityName = (area: number) => (area < 0 ? null : getMessage('map', 1500 + area)) ?? 'Error'
const elevationName = (mapIndex: number, elevation: number) => getMessage('map', 200 + 3 * mapIndex + elevation) ?? ''

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
        header.textContent = elevationName(mapIndexOf(v.mapName), v.elevation) || v.mapName
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

    const header = getMessage('pipboy', 205) ?? 'AUTOMAPS'
    const entries = collectAutomapEntries()
        .map((e) => ({ ...e, mapIndex: mapIndexOf(e.mapName), area: areaOfMap(e.mapName) }))
        .filter((e) => e.mapIndex >= 0)

    // Level 2 — CE _PrintAMelevList: the chosen map's elevations, then the other maps of its
    // city, each elevation by its map.msg name
    if (automapSelectedLocation) {
        const sel = automapSelectedLocation
        content.appendChild(makeHeader(header))
        const areaName = globalState.mapAreas?.[sel.area]?.name ?? cityName(sel.area)
        const sub = document.createElement('div')
        sub.style.cssText = TEXT_STYLE + 'font-size: 12px; padding: 2px 6px; text-align: center;'
        sub.textContent = areaName
        content.appendChild(sub)

        const backBar = document.createElement('div')
        backBar.style.cssText = 'padding: 2px 6px 4px 6px;'
        backBar.appendChild(makeButton(getMessage('pipboy', 201) ?? 'Back', () => {
            automapSelectedLocation = null
            renderAutomapsTab(screen)
        }))
        content.appendChild(backBar)

        const list = document.createElement('div')
        list.style.cssText = 'overflow-y: auto;'
        list.style.maxHeight = `${CONTENT_H - 80}px`
        const first = entries.filter((e) => e.mapName === sel.mapName)
        const rest = entries.filter((e) => e.mapName !== sel.mapName && sel.area >= 0 && e.area === sel.area)
        const byMapThenElevation = (x: typeof entries[0], y: typeof entries[0]) => (x.mapIndex - y.mapIndex) || (x.elevation - y.elevation)
        for (const e of [...first.sort(byMapThenElevation), ...rest.sort(byMapThenElevation)]) {
            list.appendChild(makeListItem(elevationName(e.mapIndex, e.elevation) || e.mapName, () => {
                const tiles = getSeenTiles(e.mapName, e.elevation)
                dbg('map', `[automap] level-3 click: mapName=${e.mapName} elevation=${e.elevation} isCurrent=${e.isCurrent} seenTiles=${tiles.size}`)
                automapViewing = { mapName: e.mapName, elevation: e.elevation, isCurrent: e.isCurrent }
                renderAutomapsTab(screen)
            }))
        }
        content.appendChild(list)
        return
    }

    // Level 1 — CE _PrintAMList: one line per city (maps of the same area merged, the hidden
    // maps left out), named by map.msg, sorted by name
    content.appendChild(makeHeader(header))
    const list = document.createElement('div')
    list.style.cssText = 'overflow-y: auto;'
    list.style.maxHeight = `${CONTENT_H - 50}px`
    const cities: { name: string; area: number; mapName: string }[] = []
    for (const e of [...entries].sort((x, y) => x.mapIndex - y.mapIndex)) {
        if (AUTOMAP_HIDDEN_MAPS.has(e.mapIndex)) continue
        if (cities.some((c) => c.mapName === e.mapName || (e.area >= 0 && c.area === e.area))) continue
        cities.push({ name: cityName(e.area), area: e.area, mapName: e.mapName })
    }
    cities.sort((x, y) => x.name.localeCompare(y.name))
    for (const c of cities) {
        list.appendChild(makeListItem(c.name, () => {
            automapSelectedLocation = { area: c.area, mapName: c.mapName }
            renderAutomapsTab(screen)
        }))
    }
    content.appendChild(list)
}
