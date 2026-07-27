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
import type { EventLogEntry } from './eventlog.types.js'
import { SerializedMap } from './map.js'
import { Critter, deserializeObj, SerializedObj } from './object.js'
import { Scripting } from './scripting.js'
import { getDrugByName } from './drugs.js'
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

    // CE ref: loadsave.cc — save thumbnail captured at save time. Stored
    // as a data URL of a downscaled snapshot of the WebGL canvas.
    screenshot?: string

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

    // CE ref: map.cc::mapSave — MVARs persist with the map.
    // Structure: { [scriptName: string]: { [idx: string]: any } }
    mvars?: any

    // Discovered worldmap areas (persists Set<number> across save/load).
    knownAreas?: number[]

    // CE ref: game_movie.cc gameMoviesSave — bitmask of triggered story movies.
    // Optional so older saves (without the field) load cleanly.
    seenMovies?: number[]

    // Structured event log accumulated by logger.eventLogPush. Optional so
    // older saves (without the field) continue to load cleanly.
    eventLog?: EventLogEntry[]

    // Pending timed events (script add_timer_event + drug wear-off timers).
    // CE ref: scripts.cc scriptsSaveProcedureNames — events keyed by object PID.
    // Optional so older saves (without the field) load without error.
    timedEvents?: Scripting.SerializedTimedEvent[]
}

function captureScreenshot(): string | undefined {
    // CE ref: loadsave.cc — save slot thumbnail. Capture the WebGL canvas
    // at a small size to keep saves compact. Returns undefined if the canvas
    // is missing or toDataURL throws (cross-origin, oversize).
    try {
        const cnv = document.getElementById('cnv') as HTMLCanvasElement | null
        if (!cnv) return undefined
        const thumb = document.createElement('canvas')
        thumb.width = 160
        thumb.height = 100
        const ctx = thumb.getContext('2d')
        if (!ctx) return undefined
        ctx.drawImage(cnv, 0, 0, thumb.width, thumb.height)
        return thumb.toDataURL('image/jpeg', 0.6)
    } catch {
        return undefined
    }
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
        screenshot: captureScreenshot(),
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
        mvars: Scripting.getMapVars(),
        knownAreas: [...globalState.knownAreas],
        seenMovies: [...globalState.seenMovies],
        eventLog: globalState.eventLog.slice(),
        timedEvents: Scripting.getTimedEventsSerialized(),
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

                // Restore MVARs (map variables). Older saves lack this field; those
                // will reset to the default .mvars.json values on first script run.
                if (save.mvars !== undefined) Scripting.setMapVars(save.mvars)

                // Restore discovered worldmap areas.
                if (Array.isArray(save.knownAreas)) globalState.knownAreas = new Set(save.knownAreas)

                // Restore seen-movie set (CE ref: game_movie.cc gameMoviesLoad).
                if (Array.isArray(save.seenMovies)) globalState.seenMovies = new Set(save.seenMovies)

                // Restore the structured event log. Older saves may have the field
                // under the old name (combatLog) — accept either; fall back to empty.
                globalState.eventLog = Array.isArray(save.eventLog ?? (save as any).combatLog)
                    ? ((save.eventLog ?? (save as any).combatLog) as EventLogEntry[]).slice()
                    : []

                // Restore timed events (script timers + drug wear-off timers).
                // CE ref: scripts.cc scriptsSaveProcedureNames / scriptsLoadProcedureNames.
                // Older saves without this field are silently skipped.
                if (Array.isArray(save.timedEvents)) {
                    const mapObjects = globalState.gMap.getObjects()
                    for (const ev of save.timedEvents) {
                        const obj = ev.objPid !== null
                            ? mapObjects.find(o => o.pid === ev.objPid) ?? null
                            : null
                        const { ticks, userdata } = ev
                        if (typeof userdata === 'string' && userdata.startsWith('drug:delayed:')) {
                            const drug = getDrugByName(userdata.slice('drug:delayed:'.length))
                            const user = obj as Critter | null
                            if (drug?.delayedHP !== undefined && user) {
                                const dmg = -(drug.delayedHP)
                                Scripting.timeEventList.push({ obj, ticks, userdata, fn: () => {
                                    if (dmg > 0) user.stats.modifyBase('HP', -dmg)
                                }})
                            }
                        } else if (typeof userdata === 'string' && userdata.startsWith('drug:')) {
                            const drug = getDrugByName(userdata.slice('drug:'.length))
                            const user = obj as Critter | null
                            if (drug?.timedStats && user) {
                                const stats = drug.timedStats
                                Scripting.timeEventList.push({ obj, ticks, userdata, fn: () => {
                                    for (const [stat, delta] of Object.entries(stats))
                                        user.stats.modifyBase(stat, -delta)
                                }})
                            }
                        } else if (userdata === 'poison') {
                            // CE ref: critter.cc poisonEventProcess — restore poison decay timer.
                            const player = globalState.player as Critter | null
                            if (player && !player.dead) {
                                Scripting.timeEventList.push({ obj: player, ticks, userdata,
                                    fn: () => Scripting.poisonDecayEvent(player) })
                            }
                        } else if (obj?._script) {
                            const script = obj._script
                            Scripting.timeEventList.push({ obj, ticks, userdata,
                                fn: () => Scripting.timedEvent(script, userdata)
                            })
                        }
                    }

                    // CE ref: critter.cc critterAdjustPoison — if player loaded with poisonLevel>0
                    // but no timed poison event (old save format), re-arm the decay event now.
                    const playerForPoison = globalState.player as Critter | null
                    if (playerForPoison && !playerForPoison.dead && (playerForPoison.poisonLevel ?? 0) > 0) {
                        const hasEvent = Scripting.timeEventList.some(
                            e => e.obj === playerForPoison && e.userdata === 'poison')
                        if (!hasEvent) {
                            const delay = 10 * (505 - 5 * playerForPoison.poisonLevel)
                            Scripting.timeEventList.push({ obj: playerForPoison, ticks: delay, userdata: 'poison',
                                fn: () => Scripting.poisonDecayEvent(playerForPoison) })
                        }
                    }

                    dbg('saveload', '[SaveLoad] Restored %d timed events', save.timedEvents.length)
                }

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
