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

// Automap tracking state + public mutation/query API.
// Split out of automapData.ts. See wiki/ts-split-refactor.md →
// "Per-file split proposals" §18.

import { dbgWarn } from '../logger.js'
import { Events } from '../events.js'
import { hexDistance, Point } from '../geometry.js'
import globalState from '../globalState.js'
import { initStorage, scheduleSave, flushAutomapSave } from './storage.js'

export const REVEAL_RADIUS = 5

// "mapName:elevation" → Set of "x,y"
export const seenData: Map<string, Set<string>> = new Map()

// "mapName:elevation" → compact object snapshot.
// typeCode: 'w' = wall, 'd' = door (scenery subType 0), 's' = scenery, 'i' = item.
// Critters are intentionally omitted — they move, so an archived snapshot would lie.
export type ObjType = 'w' | 'd' | 's' | 'i'
export interface ObjectSnapshotEntry {
    x: number
    y: number
    t: ObjType
}
export const objectSnapshots: Map<string, ObjectSnapshotEntry[]> = new Map()

// Dirty-key sets for deferred IDB writes. Keys are "mapName:elevation" strings.
export const dirtyTiles = new Set<string>()
export const dirtyObjects = new Set<string>()

export function mapKey(mapName: string, elevation: number): string {
    return `${mapName}:${elevation}`
}

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
