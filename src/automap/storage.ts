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

// Automap IndexedDB layer + legacy localStorage migration.
// Split out of automapData.ts. See wiki/ts-split-refactor.md →
// "Per-file split proposals" §18.

import { dbgWarn } from '../logger.js'
import {
    seenData,
    objectSnapshots,
    dirtyTiles,
    dirtyObjects,
    ObjectSnapshotEntry,
} from './tracking.js'

// Legacy localStorage keys — only used for the one-time migration.
const LS_TILES_KEY = 'darkfo.automap.v1'
const LS_OBJECTS_KEY = 'darkfo.automap.objects.v1'

const DB_NAME = 'darkfo-automap'
const DB_VERSION = 1
const TILES_STORE = 'tiles'
const OBJECTS_STORE = 'objects'

let saveTimer: number | null = null
let _db: IDBDatabase | null = null

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

export async function initStorage(): Promise<void> {
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

export function loadFromLocalStorage(): void {
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

export function scheduleSave(k: string, which: 'tiles' | 'objects'): void {
    if (which === 'tiles') dirtyTiles.add(k)
    else dirtyObjects.add(k)
    if (saveTimer !== null) return
    saveTimer = window.setTimeout(() => {
        flushPendingWrites()
        saveTimer = null
    }, 2000)
}

export function flushPendingWrites(): void {
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

// Force-flush any pending writes immediately. Called on map transitions and
// page unload so the seen-tile data is durable.
export function flushAutomapSave(): void {
    if (saveTimer !== null) {
        clearTimeout(saveTimer)
        saveTimer = null
    }
    flushPendingWrites()
}
