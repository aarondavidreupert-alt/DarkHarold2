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
import { Point } from '../geometry.js'
import globalState from '../globalState.js'
import { initStorage, scheduleSave, flushAutomapSave } from './storage.js'

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
        try {
            objs = map.getObjects(level) || []
        } catch (_e) {
            objs = []
        }
        const out: ObjectSnapshotEntry[] = []
        for (const obj of objs) {
            if (!obj || !obj.position) continue
            let t: ObjType | null = null
            if (obj.type === 'wall') t = 'w'
            else if (obj.type === 'scenery') {
                t = obj.pro && obj.pro.extra && obj.pro.extra.subType === 0 ? 'd' : 's'
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

// CE object.cc obj_set_seen + _obj_process_seen: the dude's tile sets one bit of the
// 5001-byte seen bitmap (8 tiles a byte, 25 bytes a 200-tile row); each set byte marks
// the bytes within ±2 on the 32 rows from 16 above to 15 below — a band of 32 rows ×
// 40 tiles around the dude's 8-tile block.
export function markSeenAt(mapName: string, elevation: number, position: Point): void {
    const k = mapKey(mapName, elevation)
    let set = seenData.get(k)
    if (!set) {
        set = new Set()
        seenData.set(k, set)
    }
    const byte = (position.y * 200 + position.x) >> 3
    for (let row = -16; row < 16; row++) {
        const center = byte + row * 25
        if (center < 0 || center >= 5001) continue
        for (let b = -2; b <= 2; b++) {
            const v = center + b
            if (v < 0 || v > 5000) continue
            for (let t = v * 8; t < v * 8 + 8 && t < 40000; t++) set.add(`${t % 200},${Math.floor(t / 200)}`)
        }
    }
    scheduleSave(k, 'tiles')
}

export function initAutomapTracking(): void {
    // Start the IDB load in the background. By the time any map finishes loading
    // and fires loadMapPost (which involves synchronous XHR + async image loads),
    // initStorage will have completed.
    initStorage().catch((e) => dbgWarn('automap', '[automapData] initStorage failed:', e))

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
    window.addEventListener('beforeunload', () => {
        flushAutomapSave()
    })
}
