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

// Automap data: tracks which hex tiles the player has seen, persisted per
// map+elevation in localStorage. Provides a shared canvas renderer used by
// both the standalone automap overlay and the PipBoy AUTOMAPS tab.

import { Events } from './events.js'
import { hexDistance, Point } from './geometry.js'
import globalState from './globalState.js'

const STORAGE_KEY = 'darkfo.automap.v1'
const ARCHIVE_KEY = 'darkfo.automap.archive.v1'
const REVEAL_RADIUS = 5

// "mapName:elevation" -> Set of "x,y"
const seenData: Map<string, Set<string>> = new Map()
// "mapName:elevation" -> snapshot data URL
const archiveData: Map<string, string> = new Map()
let loaded = false
let saveTimer: number | null = null
let archiveSaveTimer: number | null = null

function key(mapName: string, elevation: number): string {
    return `${mapName}:${elevation}`
}

function load(): void {
    if (loaded) return
    loaded = true
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
            const obj = JSON.parse(raw) as Record<string, string[]>
            for (const k in obj) {
                seenData.set(k, new Set(obj[k]))
            }
        }
    } catch (e) {
        console.log('[automapData] failed to load:', e)
    }
    try {
        const raw = localStorage.getItem(ARCHIVE_KEY)
        if (raw) {
            const obj = JSON.parse(raw) as Record<string, string>
            for (const k in obj) archiveData.set(k, obj[k])
        }
    } catch (e) {
        console.log('[automapData] failed to load archive:', e)
    }
}

function save(): void {
    try {
        const obj: Record<string, string[]> = {}
        for (const [k, set] of seenData) {
            obj[k] = Array.from(set)
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
    } catch (e) {
        console.log('[automapData] failed to save:', e)
    }
}

function scheduleSave(): void {
    if (saveTimer !== null) return
    saveTimer = window.setTimeout(() => {
        save()
        saveTimer = null
    }, 2000)
}

function saveArchive(): void {
    try {
        const obj: Record<string, string> = {}
        for (const [k, v] of archiveData) obj[k] = v
        localStorage.setItem(ARCHIVE_KEY, JSON.stringify(obj))
    } catch (e) {
        console.log('[automapData] failed to save archive:', e)
    }
}

function scheduleArchiveSave(): void {
    if (archiveSaveTimer !== null) return
    archiveSaveTimer = window.setTimeout(() => {
        saveArchive()
        archiveSaveTimer = null
    }, 1000)
}

export interface ArchiveEntry {
    mapName: string
    elevation: number
    dataURL: string
}

export function getArchiveEntries(): ArchiveEntry[] {
    load()
    const out: ArchiveEntry[] = []
    for (const [k, v] of archiveData) {
        const [mapName, elevStr] = k.split(':')
        out.push({ mapName, elevation: parseInt(elevStr, 10), dataURL: v })
    }
    return out
}

export function saveMapSnapshot(mapName: string, elevation: number): void {
    load()
    try {
        // Render at a reasonable archive resolution
        const canvas = renderAutomapCanvas(380, 360, { zoom: 1, forMap: mapName, forElevation: elevation })
        const dataURL = canvas.toDataURL('image/png')
        archiveData.set(`${mapName}:${elevation}`, dataURL)
        scheduleArchiveSave()
    } catch (e) {
        console.log('[automapData] failed to snapshot:', e)
    }
}

export function getSeenTiles(mapName: string, elevation: number): Set<string> {
    load()
    return seenData.get(key(mapName, elevation)) ?? new Set()
}

export function markSeenAt(mapName: string, elevation: number, position: Point, radius = REVEAL_RADIUS): void {
    load()
    const k = key(mapName, elevation)
    let set = seenData.get(k)
    if (!set) {
        set = new Set()
        seenData.set(k, set)
    }
    // Iterate a small bounding box around the player and check hex distance
    const minX = Math.max(0, position.x - radius)
    const maxX = Math.min(199, position.x + radius)
    const minY = Math.max(0, position.y - radius)
    const maxY = Math.min(199, position.y + radius)
    for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
            if (hexDistance(position, { x, y }) <= radius) {
                set.add(`${x},${y}`)
            }
        }
    }
    scheduleSave()
}

export function initAutomapTracking(): void {
    load()
    Events.on('playerMoved', (pos: Point) => {
        const map = globalState.gMap
        if (!map || !map.name) return
        markSeenAt(map.name, map.currentElevation, pos)
    })
    // Save a snapshot of the current map into the archive just before a new
    // map is loaded.
    Events.on('loadMapPre', () => {
        const map = globalState.gMap
        if (!map || !map.name) return
        saveMapSnapshot(map.name, map.currentElevation)
    })
    // Flush archive on page unload
    window.addEventListener('beforeunload', () => {
        if (archiveSaveTimer !== null) { saveArchive() }
        if (saveTimer !== null) { save() }
    })
}

export interface RenderOptions {
    zoom?: number
    forMap?: string
    forElevation?: number
}

export function renderAutomapCanvas(width: number, height: number, opts: RenderOptions = {}): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
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
        return canvas
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
        // Clamp so we don't reveal huge empty borders
        const gridW = HEX_RANGE * scale
        const gridH = HEX_RANGE * scale
        ox = Math.min(margin, Math.max(width - margin - gridW, ox))
        oy = Math.min(margin, Math.max(height - margin - gridH, oy))
    } else {
        ox = (width - HEX_RANGE * scale) / 2
        oy = (height - HEX_RANGE * scale) / 2
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
    const objSize = Math.max(2, Math.ceil(scale * 1.6))
    const objects = (isCurrentMap && map) ? map.getObjects() : []
    for (const obj of objects) {
        if (!obj || !obj.position) continue
        const tileKey = `${obj.position.x},${obj.position.y}`
        if (!seen.has(tileKey)) continue

        let color: string | null = null
        if (obj.type === 'wall') {
            color = '#888888' // gray
        } else if (obj.type === 'scenery') {
            // Doors are scenery subType 0
            if (obj.pro && obj.pro.extra && obj.pro.extra.subType === 0) {
                color = '#FF8800' // orange — doors
            } else {
                color = '#3388FF' // blue — other scenery
            }
        } else if (obj.type === 'item') {
            color = '#FFCC00' // yellow — items
        } else if (obj.type === 'critter') {
            if ((obj as any).isPlayer) continue // player drawn separately
            color = '#FF3333' // red — critters
        }

        if (color) {
            ctx.fillStyle = color
            ctx.fillRect(
                ox + obj.position.x * scale - 1,
                oy + obj.position.y * scale - 1,
                objSize,
                objSize
            )
        }
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

    return canvas
}
