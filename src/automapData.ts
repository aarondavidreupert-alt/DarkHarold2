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
// map+elevation in IndexedDB (one record per map+elevation key). Provides a
// shared canvas renderer used by the standalone automap overlay and the PipBoy
// AUTOMAPS tab.
//
// Storage is IndexedDB rather than localStorage to avoid the 5 MB quota limit
// when the crawler visits every map. Legacy localStorage data is migrated on
// first load and then cleared.

import { dbgWarn } from './logger.js'
import { Events } from './events.js'
import { hexDistance, Point } from './geometry.js'
import globalState from './globalState.js'

// Legacy localStorage keys — only used for the one-time migration.
const LS_TILES_KEY = 'darkfo.automap.v1'
const LS_OBJECTS_KEY = 'darkfo.automap.objects.v1'

const DB_NAME = 'darkfo-automap'
const DB_VERSION = 1
const TILES_STORE = 'tiles'
const OBJECTS_STORE = 'objects'

const REVEAL_RADIUS = 5

// "mapName:elevation" → Set of "x,y"
const seenData: Map<string, Set<string>> = new Map()

// "mapName:elevation" → compact object snapshot.
// typeCode: 'w' = wall, 'd' = door (scenery subType 0), 's' = scenery, 'i' = item.
// Critters are intentionally omitted — they move, so an archived snapshot would lie.
type ObjType = 'w' | 'd' | 's' | 'i'
interface ObjectSnapshotEntry {
    x: number
    y: number
    t: ObjType
}
const objectSnapshots: Map<string, ObjectSnapshotEntry[]> = new Map()

// Dirty-key sets for deferred IDB writes. Keys are "mapName:elevation" strings.
const dirtyTiles = new Set<string>()
const dirtyObjects = new Set<string>()

let saveTimer: number | null = null
let _db: IDBDatabase | null = null

function mapKey(mapName: string, elevation: number): string {
    return `${mapName}:${elevation}`
}

// ─── IDB helpers ──────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
    if (_db) return Promise.resolve(_db)
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION)
        req.onupgradeneeded = e => {
            const database = (e.target as IDBOpenDBRequest).result
            if (!database.objectStoreNames.contains(TILES_STORE)) database.createObjectStore(TILES_STORE)
            if (!database.objectStoreNames.contains(OBJECTS_STORE)) database.createObjectStore(OBJECTS_STORE)
        }
        req.onsuccess = e => {
            _db = (e.target as IDBOpenDBRequest).result
            resolve(_db)
        }
        req.onerror = () => reject(req.error)
    })
}

function idbGetAll<T>(db: IDBDatabase, storeName: string): Promise<Array<{ key: string; value: T }>> {
    return new Promise((resolve, reject) => {
        const results: Array<{ key: string; value: T }> = []
        const tx = db.transaction(storeName, 'readonly')
        const req = tx.objectStore(storeName).openCursor()
        req.onsuccess = e => {
            const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result
            if (cursor) {
                results.push({ key: cursor.key as string, value: cursor.value as T })
                cursor.continue()
            } else {
                resolve(results)
            }
        }
        req.onerror = () => reject(req.error)
    })
}

function idbPutBatch(db: IDBDatabase, storeName: string, entries: Array<{ key: string; value: unknown }>): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite')
        const store = tx.objectStore(storeName)
        for (const { key, value } of entries) store.put(value, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
    })
}

// ─── Init / migration ─────────────────────────────────────────────────────────

async function initStorage(): Promise<void> {
    try {
        const db = await openDB()

        const [tileRecords, objRecords] = await Promise.all([
            idbGetAll<string[]>(db, TILES_STORE),
            idbGetAll<ObjectSnapshotEntry[]>(db, OBJECTS_STORE),
        ])

        for (const { key, value } of tileRecords) seenData.set(key, new Set(value))
        for (const { key, value } of objRecords) objectSnapshots.set(key, value)
        dbgWarn('automap', `[automapData] loaded ${tileRecords.length} tile records, ${objRecords.length} object records from IDB`)

        // One-time migration: if IDB was empty and localStorage has data, import it.
        if (tileRecords.length === 0 && objRecords.length === 0) {
            await migrateFromLocalStorage(db)
        }
    } catch (e) {
        dbgWarn('automap', '[automapData] IDB unavailable, falling back to localStorage:', e)
        loadFromLocalStorage()
    }
}

async function migrateFromLocalStorage(db: IDBDatabase): Promise<void> {
    const tileBatch: Array<{ key: string; value: string[] }> = []
    const objBatch: Array<{ key: string; value: ObjectSnapshotEntry[] }> = []

    try {
        const raw = localStorage.getItem(LS_TILES_KEY)
        if (raw) {
            const obj = JSON.parse(raw) as Record<string, string[]>
            for (const k in obj) {
                seenData.set(k, new Set(obj[k]))
                tileBatch.push({ key: k, value: obj[k] })
            }
        }
    } catch (e) { dbgWarn('automap', '[automapData] migration: failed to read tiles:', e) }

    try {
        const raw = localStorage.getItem(LS_OBJECTS_KEY)
        if (raw) {
            const obj = JSON.parse(raw) as Record<string, ObjectSnapshotEntry[]>
            for (const k in obj) {
                objectSnapshots.set(k, obj[k])
                objBatch.push({ key: k, value: obj[k] })
            }
        }
    } catch (e) { dbgWarn('automap', '[automapData] migration: failed to read objects:', e) }

    if (tileBatch.length === 0 && objBatch.length === 0) return

    try {
        await Promise.all([
            tileBatch.length > 0 ? idbPutBatch(db, TILES_STORE, tileBatch) : Promise.resolve(),
            objBatch.length > 0 ? idbPutBatch(db, OBJECTS_STORE, objBatch) : Promise.resolve(),
        ])
        localStorage.removeItem(LS_TILES_KEY)
        localStorage.removeItem(LS_OBJECTS_KEY)
        console.log(`[automapData] migrated ${tileBatch.length} tile records, ${objBatch.length} object records from localStorage → IDB`)
    } catch (e) {
        dbgWarn('automap', '[automapData] migration: IDB write failed:', e)
    }
}

function loadFromLocalStorage(): void {
    try {
        const raw = localStorage.getItem(LS_TILES_KEY)
        if (raw) {
            const obj = JSON.parse(raw) as Record<string, string[]>
            for (const k in obj) seenData.set(k, new Set(obj[k]))
        }
    } catch (e) { dbgWarn('automap', '[automapData] failed to load from localStorage:', e) }
    try {
        const raw = localStorage.getItem(LS_OBJECTS_KEY)
        if (raw) {
            const obj = JSON.parse(raw) as Record<string, ObjectSnapshotEntry[]>
            for (const k in obj) objectSnapshots.set(k, obj[k])
        }
    } catch (e) { dbgWarn('automap', '[automapData] failed to load objects from localStorage:', e) }
}

// ─── Write helpers ────────────────────────────────────────────────────────────

function scheduleSave(k: string, which: 'tiles' | 'objects'): void {
    if (which === 'tiles') dirtyTiles.add(k)
    else dirtyObjects.add(k)
    if (saveTimer !== null) return
    saveTimer = window.setTimeout(() => {
        flushPendingWrites()
        saveTimer = null
    }, 2000)
}

function flushPendingWrites(): void {
    const tiles = [...dirtyTiles]
    const objects = [...dirtyObjects]
    dirtyTiles.clear()
    dirtyObjects.clear()
    if (tiles.length === 0 && objects.length === 0) return

    openDB().then(db => {
        const ops: Promise<void>[] = []
        if (tiles.length > 0) {
            const batch = tiles.map(k => ({ key: k, value: Array.from(seenData.get(k) ?? []) }))
            ops.push(idbPutBatch(db, TILES_STORE, batch))
        }
        if (objects.length > 0) {
            const batch = objects.map(k => ({ key: k, value: objectSnapshots.get(k) ?? [] }))
            ops.push(idbPutBatch(db, OBJECTS_STORE, batch))
        }
        return Promise.all(ops)
    }).catch(e => dbgWarn('automap', '[automapData] failed to flush pending writes:', e))
}

// ─── Public API ──────────────────────────────────────────────────────────────

// Capture every wall/door/scenery/item from every elevation of the currently
// loaded map and store it as a snapshot, so the AUTOMAPS tab can render the
// same overlay for an archived map. Critters are intentionally skipped.
export function snapshotCurrentMapObjects(): void {
    const map = globalState.gMap
    if (!map || !map.name) return
    const numLevels: number = (map as any).numLevels ?? 1
    for (let level = 0; level < numLevels; level++) {
        let objs: any[] = []
        try { objs = map.getObjects(level) || [] } catch (_e) { objs = [] }
        const out: ObjectSnapshotEntry[] = []
        for (const obj of objs) {
            if (!obj || !obj.position) continue
            let t: ObjType | null = null
            if (obj.type === 'wall') t = 'w'
            else if (obj.type === 'scenery') {
                t = (obj.pro && obj.pro.extra && obj.pro.extra.subType === 0) ? 'd' : 's'
            } else if (obj.type === 'item') t = 'i'
            if (!t) continue
            out.push({ x: obj.position.x, y: obj.position.y, t })
        }
        const k = mapKey(map.name, level)
        objectSnapshots.set(k, out)
        scheduleSave(k, 'objects')
    }
}

export function getObjectSnapshot(mapName: string, elevation: number): ObjectSnapshotEntry[] {
    return objectSnapshots.get(mapKey(mapName, elevation)) ?? []
}

// Every (mapName, elevation) for which we have seen-tile data. Drives the
// AUTOMAPS hierarchy.
export interface ArchivedMap {
    mapName: string
    elevation: number
    tileCount: number
}

export function getArchivedMaps(): ArchivedMap[] {
    const out: ArchivedMap[] = []
    for (const [k, set] of seenData) {
        const idx = k.lastIndexOf(':')
        if (idx < 0) continue
        const mapName = k.substring(0, idx)
        const elevation = parseInt(k.substring(idx + 1), 10)
        out.push({ mapName, elevation, tileCount: set.size })
    }
    return out
}

export function getSeenTiles(mapName: string, elevation: number): Set<string> {
    return seenData.get(mapKey(mapName, elevation)) ?? new Set()
}

export function markSeenAt(mapName: string, elevation: number, position: Point, radius = REVEAL_RADIUS): void {
    const k = mapKey(mapName, elevation)
    let set = seenData.get(k)
    if (!set) {
        set = new Set()
        seenData.set(k, set)
    }
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
    scheduleSave(k, 'tiles')
}

// Force-flush any pending writes immediately. Called on map transitions and
// page unload so the seen-tile data is durable.
export function flushAutomapSave(): void {
    if (saveTimer !== null) {
        clearTimeout(saveTimer)
        saveTimer = null
    }
    flushPendingWrites()
}

export function initAutomapTracking(): void {
    // Start the IDB load in the background. By the time any map finishes loading
    // and fires loadMapPost (which involves synchronous XHR + async image loads),
    // initStorage will have completed.
    initStorage().catch(e => dbgWarn('automap', '[automapData] initStorage failed:', e))

    Events.on('playerMoved', (pos: Point) => {
        const map = globalState.gMap
        if (!map || !map.name) return
        markSeenAt(map.name, map.currentElevation, pos)
    })
    Events.on('loadMapPost', () => {
        const map = globalState.gMap
        const player = globalState.player
        if (!map || !map.name) return
        if (player) markSeenAt(map.name, map.currentElevation, player.position)
        snapshotCurrentMapObjects()
        flushAutomapSave()
    })
    Events.on('loadMapPre', () => {
        const map = globalState.gMap
        if (!map || !map.name) return
        snapshotCurrentMapObjects()
        flushAutomapSave()
    })
    window.addEventListener('beforeunload', () => { flushAutomapSave() })
}

// ─── Canvas rendering (unchanged) ─────────────────────────────────────────────

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
