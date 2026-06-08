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

// Automap canvas renderer split out of automapData.ts.
// See wiki/ts-split-refactor.md → "Per-file split proposals" §18.

import globalState from '../globalState.js'
import {
    getSeenTiles,
    markSeenAt,
    getObjectSnapshot,
    ObjType,
} from './tracking.js'

export interface RenderOptions {
    zoom?: number
    forMap?: string
    forElevation?: number
    // Pan offset in canvas pixels, applied after auto-centering
    panX?: number
    panY?: number
}

export function renderAutomapCanvas(width: number, height: number, opts: RenderOptions = {}): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    drawAutomapInto(canvas, opts)
    return canvas
}

// Draw the automap onto an existing canvas, in place. Used by the drag/zoom
// refresh paths so the canvas DOM element is never replaced — that would
// detach any in-flight mouse listeners and break dragging mid-gesture.
export function drawAutomapInto(canvas: HTMLCanvasElement, opts: RenderOptions = {}): void {
    const width = canvas.width
    const height = canvas.height
    const ctx = canvas.getContext('2d')!

    // Transparent background — let whatever is behind the canvas (pip.png or
    // automap.png) show through.
    ctx.clearRect(0, 0, width, height)

    const map = globalState.gMap
    const player = globalState.player
    const mapName = opts.forMap ?? (map ? map.name : '')
    const elevation = opts.forElevation ?? (map ? map.currentElevation : 0)
    const isCurrentMap = !opts.forMap && map && map.name

    if (!mapName) {
        ctx.fillStyle = '#00FF00'
        ctx.font = '14px monospace'
        ctx.fillText('No map loaded', 20, 30)
        return
    }

    // Mark current player position so the map immediately shows where you are
    if (isCurrentMap && player) {
        markSeenAt(mapName, elevation, player.position)
    }

    const seen = getSeenTiles(mapName, elevation)

    // Hex grid is 200x200; fit it into the canvas with a small margin
    const HEX_RANGE = 200
    const margin = 24
    const drawW = width - margin * 2
    const drawH = height - margin * 2
    const baseScale = Math.min(drawW / HEX_RANGE, drawH / HEX_RANGE)
    const zoom = Math.max(1, opts.zoom ?? 1)
    const scale = baseScale * zoom

    // Center on player when zoomed in, otherwise fit the grid
    let ox: number, oy: number
    if (zoom > 1 && isCurrentMap && player) {
        ox = width / 2 - player.position.x * scale
        oy = height / 2 - player.position.y * scale
    } else {
        ox = (width - HEX_RANGE * scale) / 2
        oy = (height - HEX_RANGE * scale) / 2
    }

    // Apply user pan offset (drag), then clamp so the grid stays in view.
    ox += opts.panX ?? 0
    oy += opts.panY ?? 0
    const gridW = HEX_RANGE * scale
    const gridH = HEX_RANGE * scale
    if (gridW > width - margin * 2) {
        ox = Math.min(margin, Math.max(width - margin - gridW, ox))
    }
    if (gridH > height - margin * 2) {
        oy = Math.min(margin, Math.max(height - margin - gridH, oy))
    }

    // Clip the grid area so overdraw when zoomed doesn't leak into labels
    ctx.save()
    ctx.beginPath()
    ctx.rect(margin - 2, margin - 2, width - margin * 2 + 4, height - margin * 2 + 4)
    ctx.clip()

    // Draw seen tiles
    ctx.fillStyle = '#006600'
    const tileSize = Math.max(1, Math.ceil(scale * 1.2))
    for (const tileKey of seen) {
        const [xs, ys] = tileKey.split(',')
        const x = parseInt(xs, 10)
        const y = parseInt(ys, 10)
        ctx.fillRect(ox + x * scale, oy + y * scale, tileSize, tileSize)
    }

    // Overlay objects (walls, doors, scenery, items, critters) that lie on
    // already-seen tiles. Colored by type so the player can distinguish them.
    //
    // Live view (current map) reads objects directly from globalState.gMap,
    // exactly the way the HUD does. The archived view reads from the saved
    // object snapshot taken on the last map transition, so the SAME render
    // pipeline produces walls/doors/scenery for any map the player has
    // visited — not just the one currently loaded.
    const objSize = Math.max(2, Math.ceil(scale * 1.6))

    interface RenderObj { x: number; y: number; color: string }
    const renderObjects: RenderObj[] = []

    const colorForLive = (obj: any): string | null => {
        if (obj.type === 'wall') return '#888888'
        if (obj.type === 'scenery') {
            return (obj.pro && obj.pro.extra && obj.pro.extra.subType === 0)
                ? '#FF8800' // door
                : '#3388FF' // other scenery
        }
        if (obj.type === 'item') return '#FFCC00'
        if (obj.type === 'critter') {
            if ((obj as any).isPlayer) return null
            return '#FF3333'
        }
        return null
    }
    const colorForSnapshot = (t: ObjType): string => {
        if (t === 'w') return '#888888'
        if (t === 'd') return '#FF8800'
        if (t === 's') return '#3388FF'
        return '#FFCC00' // 'i'
    }

    if (isCurrentMap && map) {
        for (const obj of map.getObjects()) {
            if (!obj || !obj.position) continue
            const c = colorForLive(obj)
            if (!c) continue
            renderObjects.push({ x: obj.position.x, y: obj.position.y, color: c })
        }
    } else {
        for (const e of getObjectSnapshot(mapName, elevation)) {
            renderObjects.push({ x: e.x, y: e.y, color: colorForSnapshot(e.t) })
        }
    }

    for (const o of renderObjects) {
        const tileKey = `${o.x},${o.y}`
        if (!seen.has(tileKey)) continue
        ctx.fillStyle = o.color
        ctx.fillRect(ox + o.x * scale - 1, oy + o.y * scale - 1, objSize, objSize)
    }

    // Outline of explored area frame
    ctx.strokeStyle = '#00AA00'
    ctx.lineWidth = 1
    ctx.strokeRect(ox - 2, oy - 2, HEX_RANGE * scale + 4, HEX_RANGE * scale + 4)

    // Player marker (yellow cross) — only when rendering the current map
    if (isCurrentMap && player) {
        const px = ox + player.position.x * scale
        const py = oy + player.position.y * scale
        ctx.fillStyle = '#FFFF00'
        ctx.fillRect(px - 3, py - 1, 7, 3)
        ctx.fillRect(px - 1, py - 3, 3, 7)
    }

    ctx.restore()

    // Map label
    ctx.fillStyle = '#00FF00'
    ctx.font = 'bold 13px monospace'
    ctx.fillText(`${mapName.toUpperCase()}  L${elevation + 1}`, 8, 16)
    if (zoom > 1) {
        ctx.fillText(`${zoom.toFixed(1)}x`, width - 36, 16)
    }

    // Tile count
    ctx.font = '11px monospace'
    ctx.fillText(`${seen.size} tiles seen`, 8, height - 8)

    // Legend (small color swatches with labels along the right edge)
    const legend: { color: string; label: string }[] = [
        { color: '#888888', label: 'WALL' },
        { color: '#FF8800', label: 'DOOR' },
        { color: '#3388FF', label: 'SCEN' },
        { color: '#FFCC00', label: 'ITEM' },
        { color: '#FF3333', label: 'CRTR' },
    ]
    ctx.font = '9px monospace'
    let ly = height - 8 - legend.length * 11
    for (const e of legend) {
        ctx.fillStyle = e.color
        ctx.fillRect(width - 56, ly - 8, 8, 8)
        ctx.fillStyle = '#00FF00'
        ctx.fillText(e.label, width - 44, ly)
        ly += 11
    }
}
