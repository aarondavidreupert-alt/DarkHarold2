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

import { restoreAutomap, SavedAutomap, serializeAutomap } from './automapData.js'
import { killCounts } from './critter.js'
import { SCREEN_HEIGHT, SCREEN_WIDTH } from './renderer.js'
import { ensureCycleMask } from './images.js'
import { restoreRadiationEvent } from './radiation.js'
import { StatSet, SkillSet } from './char.js'
import { Point } from './geometry.js'
import globalState from './globalState.js'
import { heart } from './heart.js'
import { dbg, dbgWarn } from './logger.js'
import type { EventLogEntry } from './eventlog.types.js'
import { SerializedMap } from './map.js'
import {
    Critter,
    deserializeObj,
    PROTO_ID_LIT_FLARE,
    scheduleExplosion,
    scheduleFlareBurnOut,
    SerializedObj,
} from './object.js'
import { refreshStealthState, scheduleTrickle } from './miscItem.js'
import * as Scripting from './scripting.js'
import { scheduleSneakEvent, sneakClear, serializeSkillUsage, deserializeSkillUsage } from './skillUse.js'
import { restoreDrugEvent } from './drugs.js'
import { drawHP, drawAC, uiDrawWeapon } from './ui_hud.js'
import { getFileJSON } from './util.js'
import { gameReset } from './gameReset.js'
import * as Worldmap from './worldmap.js'
import { beginMapFade, endMapFade } from './mapFade.js'
import { deserializeSfallGlobals, serializeSfallGlobals } from './sfallGlobalScripts.js'
import {
    applyPreferences,
    currentPreferences,
    savePreferences,
    type SavedPreferences,
} from './ui_options/preferences.js'
import { scheduleKnockoutEvent } from './combat/results.js'
import { Combat, type SavedCombat } from './combat/Combat.js'

// Saving and loading support

let db: IDBDatabase

// Save game metadata + maps
export interface SaveGame {
    sfallGlobals?: [string, number][] // sfall global variables (sfallGlobalScripts.ts); older saves: none
    preferences?: SavedPreferences // CE loadsave.cc handler 17 preferencesSave; older saves: none
    combat?: SavedCombat // CE combatSave: a save made in combat; older saves: none
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
    partyLevels?: { [memberIndex: number]: import('./party.js').PartyMemberLevelUpInfo }
    savedMaps: { [mapName: string]: SerializedMap }

    playerState?: {
        stats: ReturnType<StatSet['serialize']>
        skills: ReturnType<SkillSet['serialize']>
        traits: string[]
        perks: string[]
        pendingPerkPick: boolean
        levelUpAvailable?: boolean
        editorLastLevel?: number
        dudeScriptLvars?: { [lvar: number]: any } // obj_dude's LVARs (CE: the dude's script, saved with the objects)
        name: string
        gender: string
        activeHand: string
        gameUIDisabled?: boolean // CE interfaceSave: gInterfaceBarEnabled
        isSneaking: boolean
        sneakWorking?: boolean
        leftHand: SerializedObj | null
        rightHand: SerializedObj | null
        armor: SerializedObj | null
        // Dude conditions (CE saves the dude object: crippled/blind flags, poison,
        // radiation). Optional — older saves start clean after gameReset.
        condition?: { [prop: string]: any }
        gvars: { [k: string]: number }
    }

    // CE ref: map.cc::mapSave — MVARs persist with the map.
    // Structure: { [scriptName: string]: { [idx: string]: any } }
    mvars?: any

    // Discovered worldmap areas (persists Set<number> across save/load).
    knownAreas?: number[]
    areaStates?: ReturnType<typeof Worldmap.serializeAreaStates>

    // CE ref: game_movie.cc gameMoviesSave — bitmask of triggered story movies.
    // Optional so older saves (without the field) load cleanly.
    seenMovies?: number[]
    // CE: AUTOMAP.DB is part of the save game
    automap?: SavedAutomap
    // CE critter.cc killsSave / killsLoad: kills per kill type
    kills?: [number, number][]
    // CE skill.cc skillsSave / skillsLoad: _timesSkillUsed (last 3 uses per skill)
    skillUsage?: number[][]

    // Structured event log accumulated by logger.eventLogPush. Optional so
    // older saves (without the field) continue to load cleanly.
    eventLog?: EventLogEntry[]

    // Pending timed events (script add_timer_event + drug wear-off timers).
    // CE ref: scripts.cc scriptsSaveProcedureNames — events keyed by object PID.
    // Optional so older saves (without the field) load without error.
    timedEvents?: Scripting.SerializedTimedEvent[]

    // CE ref: worldmap.h wmGenData — car ownership, fuel level, and parked area.
    // Optional so older saves (without the field) load cleanly (no car).
    isInCar?: boolean
    carFuel?: number
    // CE ref: worldmap.cc wmGenData.currentCarAreaId — area index where car is parked.
    currentCarAreaId?: number
    // CE ref: worldmap.cc wmWorldMapSave — wmGenData.worldPosX/Y.
    worldPos?: { x: number; y: number } | null
    // CE wmWorldMap_save: every subtile's state, didMeetFrankHorrigan and the
    // encounter entries' counters
    subtiles?: number[] | null
    currentAreaId?: number
    encounters?: Worldmap.SavedEncounters
    // Name of the specific local map the car is parked on (DH2 addition).
}

// CE ref: loadsave.cc:838 _QuickSnapShot — when the save screen opens, the iso window
// is redrawn and its centre 640x380 stretched to the 224x133 preview
// (LS_PREVIEW_WIDTH/HEIGHT). The WebGL canvas has no preserveDrawingBuffer, so the
// frame is rendered and read back in the same task; reading it later gives a blank.
const PLAYER_CONDITION_PROPS = [
    'dead',
    'crippledLeftArm',
    'crippledRightArm',
    'crippledLeftLeg',
    'crippledRightLeg',
    'isBlinded',
    'poisonLevel',
    'radiationLevel',
    'radiated',
    'addictedState',
]

const LS_PREVIEW_WIDTH = 224
const LS_PREVIEW_HEIGHT = 133
const ISO_W = 640,
    ISO_H = 380
const INTERFACE_BAR_HEIGHT = 99
let pendingSnapshot: string | undefined

export function takeSaveSnapshot(): void {
    pendingSnapshot = undefined
    try {
        const cnv = document.getElementById('cnv') as HTMLCanvasElement | null
        if (!cnv || !globalState.renderer) return
        globalState.renderer.render()
        const scale = cnv.width / SCREEN_WIDTH
        const isoH = SCREEN_HEIGHT - INTERFACE_BAR_HEIGHT
        const sx = ((SCREEN_WIDTH - ISO_W) / 2) * scale
        const sy = ((isoH - ISO_H) / 2) * scale
        const thumb = document.createElement('canvas')
        thumb.width = LS_PREVIEW_WIDTH
        thumb.height = LS_PREVIEW_HEIGHT
        const ctx = thumb.getContext('2d')
        if (!ctx) return
        ctx.drawImage(cnv, sx, sy, ISO_W * scale, ISO_H * scale, 0, 0, LS_PREVIEW_WIDTH, LS_PREVIEW_HEIGHT)
        pendingSnapshot = thumb.toDataURL('image/jpeg', 0.8)
    } catch {
        pendingSnapshot = undefined
    }
}

// The snapshot the open save screen previews for an empty slot.
export function getSaveSnapshot(): string | undefined {
    return pendingSnapshot
}

function captureScreenshot(): string | undefined {
    if (pendingSnapshot === undefined) takeSaveSnapshot()
    const shot = pendingSnapshot
    pendingSnapshot = undefined
    return shot
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
        partyLevels: globalState.gParty.serializeLevels(),
        savedMaps: { [curMap.name]: curMap, ...globalState.dirtyMapCache },
        playerState: {
            stats: p.stats.serialize(),
            skills: p.skills.serialize(),
            traits: p.traits.slice(),
            perks: p.perks.slice(),
            pendingPerkPick: p.pendingPerkPick,
            levelUpAvailable: p.levelUpAvailable,
            editorLastLevel: p.editorLastLevel,
            dudeScriptLvars: p._script ? Object.assign({}, p._script.lvars) : undefined,
            name: p.name,
            gender: p.gender,
            activeHand: p.activeHand,
            gameUIDisabled: globalState.gameUIDisabled,
            isSneaking: p.isSneaking,
            sneakWorking: (p as any).sneakWorking ?? false,
            leftHand: p.leftHand ? p.leftHand.serialize() : null,
            rightHand: p.rightHand ? p.rightHand.serialize() : null,
            armor: p.armor ? p.armor.serialize() : null,
            condition: Object.fromEntries(PLAYER_CONDITION_PROPS.map((k) => [k, (p as any)[k]])),
            gvars: Object.assign({}, Scripting.getGlobalVars()),
        },
        mvars: Scripting.getMapVars(),
        sfallGlobals: serializeSfallGlobals(), // CE loadsave.cc sfall_gl_vars_save
        knownAreas: [...globalState.knownAreas],
        areaStates: Worldmap.serializeAreaStates(),
        seenMovies: [...globalState.seenMovies],
        automap: serializeAutomap(),
        kills: [...killCounts.entries()],
        skillUsage: serializeSkillUsage(),
        eventLog: globalState.eventLog.slice(),
        timedEvents: Scripting.getTimedEventsSerialized(),
        // CE ref: worldmap.h wmGenData — persist car state across saves.
        isInCar: Worldmap.getIsInCar(),
        carFuel: Worldmap.getCarFuel(),
        currentCarAreaId: Worldmap.getCarAreaId(),
        worldPos: Worldmap.getPlayerWorldPos(),
        subtiles: Worldmap.serializeSquareStates(),
        currentAreaId: Worldmap.getCurrentAreaId(),
        encounters: Worldmap.serializeEncounters(),
        preferences: currentPreferences(),
        combat: globalState.inCombat && globalState.combat ? globalState.combat.serializeState() : undefined,
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

export function save(name: string, slot = -1, callback?: (id: number) => void): void {
    const save = gatherSaveData(name)

    const dirtyMapNames = Object.keys(globalState.dirtyMapCache)
    dbg(
        'saveload',
        `[SaveLoad] Saving ${1 + dirtyMapNames.length} maps (current: ${
            globalState.gMap.name
        } plus dirty maps: ${dirtyMapNames.join(', ')})`,
    )

    if (slot !== -1) {
        save.id = slot
    }

    let savedId = slot
    withTransaction(
        (trans) => {
            const req = trans.objectStore('saves').put(save)
            req.onsuccess = () => {
                savedId = Number(req.result)
            }

            dbg('saveload', "[SaveLoad] Saving game data as '%s'", name)
        },
        () => callback?.(savedId),
    )
}

// DH2 addition (CE has no delete): remove a saved game from the database.
export function deleteSave(id: number, callback?: () => void): void {
    withTransaction((trans) => {
        trans.objectStore('saves').delete(id)
    }, callback)
}

export function load(id: number): void {
    // Load stored savegame with id
    beginMapFade() // CE lsgLoadGameInSlot → mapLoadSaved: the view is blank while loading
    globalState.backgroundMapLoad = false // a loaded game's map plays its music

    withTransaction((trans) => {
        trans.objectStore('saves').get(id).onsuccess = function (e) {
            const save: SaveGame = (<any>e.target).result
            const savedMap = save.savedMaps[save.currentMap]

            dbg('saveload', "[SaveLoad] Loading save #%d ('%s') from %s", id, save.name, formatSaveDate(save))

            // Apply the save state. Called directly (same-location) or after
            // images finish loading (cross-location) via the isLoading gate.
            const applyState = () => {
                // Loading a save never resumes a live combat from the current session
                // (CE loadsave.cc tears combat down via gameReset before reading).
                // (Restored 2026-10-06; lost in b282cca.)
                if (globalState.inCombat) {
                    globalState.combat?.forceEnd()
                }
                globalState.inCombat = false
                globalState.combat = null
                // CE ref: loadsave.cc _PrepLoad — gameReset() before the save is read, so
                // nothing the save doesn't carry survives from the current session.
                gameReset()

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
                    p.levelUpAvailable = ps.levelUpAvailable ?? false
                    // (older saves granted the points at the level-up itself)
                    p.editorLastLevel = ps.editorLastLevel ?? p.stats.getBase('Level')
                    Scripting.setPendingDudeLvars(ps.dudeScriptLvars ?? null) // obj_dude reattaches at map entry
                    p.name = ps.name
                    p.gender = ps.gender
                    p.activeHand = ps.activeHand as 'leftHand' | 'rightHand'
                    Scripting.setGameUiDisabled(ps.gameUIDisabled ?? false) // CE interfaceLoad
                    p.isSneaking = ps.isSneaking
                    ;(p as any).sneakWorking = ps.sneakWorking ?? false
                    p.leftHand = ps.leftHand ? (deserializeObj(ps.leftHand) as any) : undefined
                    p.rightHand = ps.rightHand ? (deserializeObj(ps.rightHand) as any) : undefined
                    p.armor = ps.armor ? deserializeObj(ps.armor) : null
                    for (const k of PLAYER_CONDITION_PROPS) {
                        if (ps.condition?.[k] !== undefined) (p as any)[k] = ps.condition[k]
                    }
                    Scripting.setGlobalVars(ps.gvars)
                    // CE ref: item.cc:353 itemAdd() stealthBoyTurnOn — restore stealthActive
                    // after hand slots are deserialized (Stealth Boy II may have been active).
                    refreshStealthState(p as unknown as Critter)
                }

                globalState.gParty.deserialize(save.party)
                globalState.gParty.deserializeLevels(save.partyLevels)

                // Restore MVARs (map variables). Older saves lack this field; those
                // will reset to the default .mvars.json values on first script run.
                if (save.mvars !== undefined) Scripting.setMapVars(save.mvars)
                deserializeSfallGlobals(save.sfallGlobals) // CE sfall_gl_vars_load

                // Restore discovered worldmap areas.
                if (Array.isArray(save.knownAreas)) globalState.knownAreas = new Set(save.knownAreas)
                Worldmap.deserializeAreaStates(save.areaStates)

                // Restore car state. CE ref: worldmap.h wmGenData.isInCar / wmGenData.carFuel /
                // wmGenData.currentCarAreaId. Older saves lack these fields; default to no car.
                Worldmap.setIsInCar(save.isInCar ?? false)
                Worldmap.setCarFuel(save.carFuel ?? 0)
                Worldmap.setCarAreaId(save.currentCarAreaId ?? -1)
                if (save.worldPos) Worldmap.setPlayerWorldPos(save.worldPos.x, save.worldPos.y)
                Worldmap.deserializeSquareStates(save.subtiles)
                Worldmap.setCurrentAreaId(save.currentAreaId ?? -1)
                Worldmap.deserializeEncounters(save.encounters)
                // CE preferencesLoad: the save's preferences apply (_JustUpdate_) and become
                // the settings (_SavePrefs(0)); saves from before 2026-10-25 have none
                if (save.preferences) {
                    applyPreferences(save.preferences)
                    savePreferences()
                }

                // Restore seen-movie set (CE ref: game_movie.cc gameMoviesLoad).
                if (Array.isArray(save.seenMovies)) globalState.seenMovies = new Set(save.seenMovies)
                restoreAutomap(save.automap) // the save's automap (none in older saves)
                killCounts.clear()
                for (const [type, n] of save.kills ?? []) killCounts.set(type, n)
                deserializeSkillUsage(save.skillUsage)
                globalState.player?.updateNativeLook() // CE loadsave.cc:1772

                // Restore the structured event log. Older saves may have the field
                // under the old name (combatLog) — accept either; fall back to empty.
                globalState.eventLog = Array.isArray(save.eventLog ?? (save as any).combatLog)
                    ? ((save.eventLog ?? (save as any).combatLog) as EventLogEntry[]).slice()
                    : []

                // Restore timed events (script timers + drug wear-off timers).
                // CE ref: scripts.cc scriptsSaveProcedureNames / scriptsLoadProcedureNames.
                // Older saves without this field are silently skipped.
                if (Array.isArray(save.timedEvents)) {
                    // CE queueLoad: the owner by object id (objectFindById); old saves by PID
                    const mapObjects = [...globalState.gMap.getObjects(), ...(globalState.gMap.getSpatials() ?? [])]
                    const byUid = new Map<number, any>()
                    // (items too, in inventories and bags: a lit flare in a hand; uid -1 is only the dude's)
                    const visited = new Set<any>()
                    const carrier = new Map<any, any>() // an item's critter (CE objectGetOwner)
                    const addByUid = (o: any, owner: any = null) => {
                        if (!o || visited.has(o)) return
                        visited.add(o)
                        if (o.uid !== -1) byUid.set(o.uid, o)
                        if (owner) carrier.set(o, owner)
                        const own = o.type === 'critter' ? o : owner
                        for (const it of o.inventory ?? []) addByUid(it, own)
                        addByUid(o.leftHand, own)
                        addByUid(o.rightHand, own)
                    }
                    for (const o of mapObjects) addByUid(o)
                    addByUid(globalState.player)
                    if (globalState.player) byUid.set(globalState.player.uid, globalState.player)
                    for (const ev of save.timedEvents) {
                        const obj =
                            ev.objUid != null
                                ? (byUid.get(ev.objUid) ?? null)
                                : ev.objPid !== null
                                  ? (mapObjects.find((o) => o.pid === ev.objPid) ?? null)
                                  : null
                        const { ticks, userdata } = ev
                        if (
                            typeof userdata === 'string' &&
                            (userdata.startsWith('drug:') || userdata.startsWith('withdrawal:'))
                        ) {
                            // CE ref: item.cc drugEffectEventRead / withdrawalEventRead. Old-format
                            // drug events (pre-2026-10-06 'drug:<name>') don't parse and are dropped.
                            const user = (obj ?? globalState.player) as Critter | null
                            if (user && user.type === 'critter') restoreDrugEvent(user, ticks, userdata)
                        } else if (userdata === 'sneak') {
                            // CE ref: critter.cc:1194 sneakEventProcess — restore periodic sneak roll timer.
                            const playerForSneak = globalState.player
                            if (playerForSneak && (playerForSneak as any).isSneaking) {
                                Scripting.timeEventList.push({
                                    obj: playerForSneak,
                                    ticks,
                                    userdata,
                                    fn: () => {
                                        if ((playerForSneak as any).isSneaking) scheduleSneakEvent(playerForSneak)
                                    },
                                    leaveMap: () => sneakClear(playerForSneak),
                                })
                            }
                        } else if (typeof userdata === 'string' && userdata.startsWith('radiation:')) {
                            // CE ref: critter.cc radiationEventRead — restore sickness / recovery event.
                            const player = globalState.player as Critter | null
                            if (player && !player.dead) restoreRadiationEvent(player, ticks, userdata)
                        } else if (userdata === 'poison') {
                            // CE ref: critter.cc poisonEventProcess — restore poison decay timer.
                            const player = globalState.player as Critter | null
                            if (player && !player.dead) {
                                Scripting.timeEventList.push({
                                    obj: player,
                                    ticks,
                                    userdata,
                                    fn: () => Scripting.poisonDecayEvent(player),
                                    leaveMap: 'keep',
                                })
                            }
                        } else if (userdata === 'knockout') {
                            // CE queue.cc knockout event: the critter wakes up when it runs out
                            if (obj && obj.type === 'critter' && !obj.dead) scheduleKnockoutEvent(obj as Critter, ticks)
                        } else if (userdata === 'flare') {
                            // CE queue.cc flare event: the lit flare burns out when it runs out
                            if (obj && obj.pid === PROTO_ID_LIT_FLARE) scheduleFlareBurnOut(obj, ticks)
                        } else if (userdata === 'trickle') {
                            // CE queue.cc EVENT_TYPE_ITEM_TRICKLE: a switched-on Stealth Boy / Geiger
                            if (obj && obj.miscOn) scheduleTrickle(obj, carrier.get(obj) ?? null, ticks)
                        } else if (userdata === 'explosion' || userdata === 'explosionFailure') {
                            // CE queue.cc explosion events: the armed explosive goes off
                            if (obj) scheduleExplosion(obj, ticks, userdata === 'explosionFailure')
                        } else if (obj?._script) {
                            const script = obj._script
                            Scripting.timeEventList.push({
                                obj,
                                ticks,
                                userdata,
                                script: true,
                                fn: () => Scripting.timedEvent(script, userdata),
                            })
                        }
                    }

                    // CE ref: critter.cc critterAdjustPoison — if player loaded with poisonLevel>0
                    // but no timed poison event (old save format), re-arm the decay event now.
                    const playerForPoison = globalState.player as Critter | null
                    if (playerForPoison && !playerForPoison.dead && (playerForPoison.poisonLevel ?? 0) > 0) {
                        const hasEvent = Scripting.timeEventList.some(
                            (e) => e.obj === playerForPoison && e.userdata === 'poison',
                        )
                        if (!hasEvent) {
                            const delay = 10 * (505 - 5 * playerForPoison.poisonLevel)
                            Scripting.timeEventList.push({
                                obj: playerForPoison,
                                ticks: delay,
                                userdata: 'poison',
                                fn: () => Scripting.poisonDecayEvent(playerForPoison),
                                leaveMap: 'keep',
                            })
                        }
                    }

                    // CE ref: critter.cc sneakEventProcess — if player loaded with isSneaking=true
                    // but no sneak timer (old save format), re-arm the sneak event now.
                    const playerForSneak2 = globalState.player
                    if (playerForSneak2 && (playerForSneak2 as any).isSneaking) {
                        const hasSneakEvent = Scripting.timeEventList.some(
                            (e) => e.obj === playerForSneak2 && e.userdata === 'sneak',
                        )
                        if (!hasSneakEvent) scheduleSneakEvent(playerForSneak2)
                    }

                    dbg('saveload', '[SaveLoad] Restored %d timed events', save.timedEvents.length)
                }

                globalState.gMap.changeElevation(save.currentElevation, false)

                // populate dirty map cache out of non-current saved maps
                globalState.dirtyMapCache = { ...save.savedMaps }
                delete globalState.dirtyMapCache[savedMap.name]

                // CE mapLoad during a game load: start / map_enter / map_update with
                // _loadingGame set (metarule 22), then the map music.
                Scripting.ensureDudeScript() // obj_dude with its saved LVARs (setPendingDudeLvars)
                globalState.gMap.runLoadGameProcs()

                const p = globalState.player!
                drawHP(p.getStat('HP'))
                drawAC(p.getStat('AC'))
                uiDrawWeapon()

                // CE loadsave.cc combatLoad: a save made in combat resumes it
                if (save.combat) Combat.restore(save.combat)

                Scripting.startSfallGlobalScripts() // CE loadsave.cc: sfall_gl_scr_exec_start_proc
                dbg('saveload', '[SaveLoad] Finished loading map %s', savedMap.name)
                endMapFade()
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
                ensureCycleMask(img)
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
        db.createObjectStore('saves', { keyPath: 'id', autoIncrement: true })
    }

    request.onsuccess = function () {
        db = request.result

        db.onerror = function (e) {
            dbgWarn('saveload', 'Database error: ' + (<any>e.target).errorCode)
        }

        dbg('saveload', 'Established DB connection')
    }
}
