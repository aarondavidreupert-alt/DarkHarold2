/*
Copyright 2017 darkf

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

import { StatSet, SkillSet } from './char.js'
import { Point } from './geometry.js'
import globalState from './globalState.js'
import { heart } from './heart.js'
import { dbg, dbgWarn } from './logger.js'
import type { CombatLogEntry } from './logger.js'
import { SerializedMap } from './map.js'
import { deserializeObj, SerializedObj } from './object.js'
import { Scripting } from './scripting.js'
import { drawHP, drawAC, uiDrawWeapon } from './ui_hud.js'
import { getFileJSON } from './util.js'

// Saving and loading support

let db: IDBDatabase

// Save game metadata + maps
export interface SaveGame {
    id?: number
    version: number
    name: string
    timestamp: number
    currentMap: string
    currentElevation: number

    // In-game tick counter (Fallout 2 ticks, 10 per second). Missing on
    // older saves, so the loader tolerates `undefined`.
    gameTickTime?: number

    player: { position: Point; orientation: number; inventory: SerializedObj[] }
    party: SerializedObj[]
    savedMaps: { [mapName: string]: SerializedMap }

    playerState?: {
        stats: ReturnType<StatSet['serialize']>
        skills: ReturnType<SkillSet['serialize']>
        traits: string[]
        perks: string[]
        pendingPerkPick: boolean
        name: string
        gender: string
        activeHand: string
        isSneaking: boolean
        leftHand: SerializedObj | null
        rightHand: SerializedObj | null
        armor: SerializedObj | null
        gvars: { [k: string]: number }
    }

    // Structured combat log accumulated by logger.combatLogPush. Optional so
    // older saves (without the field) continue to load cleanly.
    combatLog?: CombatLogEntry[]
}

function gatherSaveData(name: string): SaveGame {
    // Saves the game and returns the savegame

    const curMap = globalState.gMap.serialize()

    const p = globalState.player
    return {
        version: 1,
        name,
        timestamp: Date.now(),
        currentElevation: globalState.currentElevation,
        currentMap: curMap.name,
        gameTickTime: globalState.gameTickTime,
        player: {
            position: p.position,
            orientation: p.orientation,
            inventory: p.inventory.map((obj) => obj.serialize()),
        },
        party: globalState.gParty.serialize(),
        savedMaps: { [curMap.name]: curMap, ...globalState.dirtyMapCache },
        playerState: {
            stats: p.stats.serialize(),
            skills: p.skills.serialize(),
            traits: p.traits.slice(),
            perks: p.perks.slice(),
            pendingPerkPick: p.pendingPerkPick,
            name: p.name,
            gender: p.gender,
            activeHand: p.activeHand,
            isSneaking: p.isSneaking,
            leftHand: p.leftHand ? p.leftHand.serialize() : null,
            rightHand: p.rightHand ? p.rightHand.serialize() : null,
            armor: p.armor ? p.armor.serialize() : null,
            gvars: Object.assign({}, Scripting.getGlobalVars()),
        },
        combatLog: globalState.combatLog.slice(),
    }
}

export function formatSaveDate(save: SaveGame): string {
    const date = new Date(save.timestamp)
    return `${
        date.getMonth() + 1
    }/${date.getDate()}/${date.getFullYear()} ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`
}

function withTransaction(f: (trans: IDBTransaction) => void, finished?: () => void) {
    const trans = db.transaction('saves', 'readwrite')
    if (finished) {
        trans.oncomplete = finished
    }
    trans.onerror = (e: any) => {
        dbgWarn('saveload', 'Database error: ' + (<any>e.target).errorCode)
    }
    f(trans)
}

function getAll<T>(store: IDBObjectStore, callback?: (result: T[]) => void) {
    const out: T[] = []

    store.openCursor().onsuccess = function (e) {
        const cursor = (<any>e.target).result
        if (cursor) {
            out.push(cursor.value)
            cursor.continue()
        } else if (callback) {
            callback(out)
        }
    }
}

export function saveList(callback: (saves: SaveGame[]) => void): void {
    withTransaction((trans) => {
        getAll(trans.objectStore('saves'), callback)
    })
}

export function debugSaveList(): void {
    saveList((saves: SaveGame[]) => {
        dbg('saveload', 'Save List:')
        for (const savegame of saves) {
            dbg('saveload', '  -', savegame.name, formatSaveDate(savegame), savegame)
        }
    })
}

export function debugSave(): void {
    save('debug', undefined, () => {
        dbg('saveload', '[SaveLoad] Done')
    })
}

export function save(name: string, slot = -1, callback?: () => void): void {
    const save = gatherSaveData(name)

    const dirtyMapNames = Object.keys(globalState.dirtyMapCache)
    dbg('saveload',
        `[SaveLoad] Saving ${1 + dirtyMapNames.length} maps (current: ${
            globalState.gMap.name
        } plus dirty maps: ${dirtyMapNames.join(', ')})`
    )

    if (slot !== -1) {
        save.id = slot
    }

    withTransaction((trans) => {
        trans.objectStore('saves').put(save)

        dbg('saveload', "[SaveLoad] Saving game data as '%s'", name)
    }, callback)
}

export function load(id: number): void {
    // Load stored savegame with id

    withTransaction((trans) => {
        trans.objectStore('saves').get(id).onsuccess = function (e) {
            const save: SaveGame = (<any>e.target).result
            const savedMap = save.savedMaps[save.currentMap]

            dbg('saveload', "[SaveLoad] Loading save #%d ('%s') from %s", id, save.name, formatSaveDate(save))

            // Apply the save state. Called directly (same-location) or after
            // images finish loading (cross-location) via the isLoading gate.
            const applyState = () => {
                globalState.gMap.deserialize(savedMap)
                dbg('saveload', '[SaveLoad] Finished map deserialization')

                // Restore game clock (older saves omit this field).
                if (typeof save.gameTickTime === 'number') {
                    globalState.gameTickTime = save.gameTickTime
                }

                globalState.player.position = save.player.position
                globalState.player.orientation = save.player.orientation
                globalState.player.inventory = save.player.inventory.map((obj) => deserializeObj(obj))

                if (save.playerState) {
                    const ps = save.playerState
                    const p = globalState.player
                    p.stats = StatSet.deserialize(ps.stats)
                    p.skills = SkillSet.deserialize(ps.skills)
                    p.traits = ps.traits.slice()
                    p.perks = ps.perks.slice()
                    p.pendingPerkPick = ps.pendingPerkPick
                    p.name = ps.name
                    p.gender = ps.gender
                    p.activeHand = ps.activeHand as 'leftHand' | 'rightHand'
                    p.isSneaking = ps.isSneaking
                    p.leftHand = ps.leftHand ? deserializeObj(ps.leftHand) as any : undefined
                    p.rightHand = ps.rightHand ? deserializeObj(ps.rightHand) as any : undefined
                    p.armor = ps.armor ? deserializeObj(ps.armor) : null
                    Scripting.setGlobalVars(ps.gvars)
                }

                globalState.gParty.deserialize(save.party)

                // Restore the structured combat log. Older saves omit this field —
                // start with an empty list rather than carrying entries from the
                // previous session.
                globalState.combatLog = Array.isArray(save.combatLog) ? save.combatLog.slice() : []

                globalState.gMap.changeElevation(save.currentElevation, false)

                // populate dirty map cache out of non-current saved maps
                globalState.dirtyMapCache = { ...save.savedMaps }
                delete globalState.dirtyMapCache[savedMap.name]

                const p = globalState.player!
                drawHP(p.getStat('HP'))
                drawAC(p.getStat('AC'))
                uiDrawWeapon()

                dbg('saveload', '[SaveLoad] Finished loading map %s', savedMap.name)
            }

            const changingMap = globalState.gMap?.name !== save.currentMap
            if (!changingMap) {
                applyState()
                return
            }

            // Cross-location load: clear stale WebGL textures so getTextureFromHack
            // re-uploads from globalState.images instead of serving old map's textures.
            globalState.renderer.clearTileCache()

            // Load the new map's images into globalState.images before the first
            // render frame, using the same isLoading gate as loadNewMap. This
            // prevents the floor FBO from being baked with null (missing) tiles
            // when images haven't been loaded in this session yet.
            let mapImages: string[]
            try {
                mapImages = getFileJSON('maps/' + save.currentMap + '.images.json') ?? []
            } catch {
                mapImages = []
            }
            const toLoad = mapImages.filter((img) => globalState.images[img] === undefined)

            if (toLoad.length === 0) {
                applyState()
                return
            }

            globalState.isLoading = true
            globalState.loadingAssetsTotal = toLoad.length
            globalState.loadingAssetsLoaded = 0
            globalState.loadingLoadedCallback = applyState

            for (const img of toLoad) {
                heart.graphics.newImage(img + '.png', (r: HTMLImageElement) => {
                    globalState.images[img] = r
                    globalState.loadingAssetsLoaded++
                })
            }
        }
    })
}

export function saveLoadInit(): void {
    const request = indexedDB.open('darkfo', 1)

    request.onupgradeneeded = function () {
        const db = request.result
        const store = db.createObjectStore('saves', { keyPath: 'id', autoIncrement: true })
    }

    request.onsuccess = function () {
        db = request.result

        db.onerror = function (e) {
            dbgWarn('saveload', 'Database error: ' + (<any>e.target).errorCode)
        }

        dbg('saveload', 'Established DB connection')
    }
}
