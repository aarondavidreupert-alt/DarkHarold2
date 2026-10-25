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

// Map loader: loadMap / loadNewMap / loadMapByID attached to GameMap.prototype.
// Split out of map.ts. See wiki/ts-split-refactor.md → "Per-file split
// proposals" §9.

import { ensureCycleMask } from '../images.js'
import { Config } from '../config.js'
import { getCurrentMapInfo, lookupMapName, mapDeadBodiesAge } from '../data.js'
import { itemDropAll } from '../critter.js'
import * as GameTime from '../gametime.js'
import { Events } from '../events.js'
import { Point } from '../geometry.js'
import globalState from '../globalState.js'
import { heart } from '../heart.js'
import { Lightmap } from '../lightmap.js'
import { dbg, dbgWarn } from '../logger.js'
import { createObjectWithPID, Critter, deserializeObj, Obj, objectUnjamAll, objFromMapObject } from '../object.js'
import { randomBetween } from '../random.js'
import { centerCamera } from '../renderer.js'
import { setMapScrollLimits } from '../render/camera.js'
import { Scripting } from '../scripting.js'
import { fromTileNum, hexToTile } from '../tile.js'
import { arrayWithout, getFileJSON } from '../util.js'
import { showAlert } from '../ui_dialog.js'
import { GameMap } from './GameMap.js'
import { globalScriptsMapProc } from '../sfallGlobalScripts.js'

declare let PF: any

const TICKS_PER_HOUR = 36000
const KILL_TYPE_RAT = 7
const KILL_TYPE_MANTIS = 12
const KILL_TYPE_ROBOT = 10
const CRITTER_NO_DROP = 0x40
const CRITTER_NO_HEAL = 0x200
const CRITTER_FLAT = 0x800
const PID_BLOOD = 0x5000004

// Put `obj` on `at`'s tile and elevation (z-ordered when that is the current one).
function placeOnLevel(gMap: GameMap, obj: Obj, at: Obj): void {
    const level = at.elevation ?? gMap.currentElevation
    obj.elevation = level
    gMap.addObject(obj, level)
    if (level === gMap.currentElevation) obj.move({ ...at.position }, gMap.getObjects().length - 1, false)
    else obj.position = { ...at.position }
}

// CE map.cc mapLoadSaved: a revisited map unjams its locks after a day and ages its
// critters (_map_age_dead_critters).
function mapLoadSavedAging(gMap: GameMap): void {
    const now = globalState.gameTickTime
    if (now < gMap.lastVisitTime) return
    if (Math.trunc((now - gMap.lastVisitTime) / TICKS_PER_HOUR) >= 24) objectUnjamAll()
    mapAgeDeadCritters(gMap, now)
}

// CE map.cc _map_age_dead_critters: on maps with dead_bodies_age, the living critters
// (not the dude or the party) stop fleeing and heal 14 HP per 3 hours away
// (_critter_heal_hours; not robots or CRITTER_NO_HEAL); after more than 6 days the
// dead ones drop their items (unless CRITTER_NO_DROP) and turn into a blood / bones
// pile (misc 0x5000004: random 0-3, +3 most critters, +6 flat ones; a frame past the
// art's last is refused by objectSetFrame and stays 0). (CE's second
// aging step, > 14 days, can never be reached — the > 6 days test comes first.)
function mapAgeDeadCritters(gMap: GameMap, now: number): void {
    if (!gMap.name || !mapDeadBodiesAge(gMap.name)) return
    const hours = Math.trunc((now - gMap.lastVisitTime) / TICKS_PER_HOUR)
    if (hours === 0) return
    const party = globalState.gParty
    const protoFlags = (c: Critter): number => ((c as any).pro?.extra?.flags ?? 0)
    const critters: Critter[] = []
    for (let level = 0; level < (gMap.objects?.length ?? 0); level++) {
        for (const o of gMap.objects![level]) if (o.type === 'critter') critters.push(o as Critter)
    }
    for (const c of critters) {
        if (c.isPlayer || party?.isPartyMember(c) || c.dead) continue
        ;(c as any).fleeing = false
        if (c.killType === KILL_TYPE_ROBOT || (protoFlags(c) & CRITTER_NO_HEAL) !== 0) continue
        const maxHp = c.getStat('Max HP')
        const hp = c.getStat('HP')
        if (hp < maxHp) c.stats.setBase('HP', Math.min(maxHp, hp + 14 * Math.trunc(hours / 3)))
    }
    if (hours <= 6 * 24) return
    for (const c of critters) {
        if (c.isPlayer || !c.dead) continue
        if (c.killType === KILL_TYPE_ROBOT || (protoFlags(c) & CRITTER_NO_HEAL) !== 0) continue
        if ((protoFlags(c) & CRITTER_NO_DROP) === 0) itemDropAll(c)
        const blood = createObjectWithPID(PID_BLOOD)
        let frame = randomBetween(0, 3)
        if ((protoFlags(c) & CRITTER_FLAT) !== 0) frame += 6
        else if (c.killType !== KILL_TYPE_RAT && c.killType !== KILL_TYPE_MANTIS) frame += 3
        if (frame < (globalState.imageInfo?.[blood.art]?.numFrames ?? 9)) blood.frame = frame
        placeOnLevel(gMap, blood, c)
        // objectDestroy — at once (nothing iterates the map yet), no destroy_p_proc
        for (const level of gMap.objects ?? []) {
            const i = level.indexOf(c)
            if (i !== -1) { level.splice(i, 1); break }
        }
    }
}

// Spatial type — duplicated from GameMap.ts to avoid exposing it on the barrel.
type Spatial = any

declare module './GameMap.js' {
    interface GameMap {
        loadMap(mapName: string, startingPosition?: Point, startingElevation?: number, loadedCallback?: () => void): void
        loadNewMap(mapName: string, startingPosition?: Point, startingElevation?: number, loadedCallback?: () => void): void
        loadMapByID(mapID: number, startingPosition?: Point, startingElevation?: number): void
    }
}

GameMap.prototype.loadMap = function (mapName: string, startingPosition?: Point, startingElevation?: number, loadedCallback?: () => void): void {
        // Fleeing to a map exit mid-combat is valid in CE: reaching an exit grid
        // (object.cc:1399-1432) makes combat.cc's turn loop quit (combat.cc:3186-3196)
        // before mapHandleTransition() (map.cc:1244-1256) loads the new map, so you
        // are never in combat on arrival. Reproduce that end state here.
        // (Restored 2026-10-06; lost in b282cca.)
        if (globalState.inCombat) {
            globalState.combat?.forceEnd()
            globalState.inCombat = false
            globalState.combat = null
        }

        // CE ref: map.cc:1427 _map_save_in_game — the party is taken off the map, then
        // scriptsExecMapExitProc runs map_exit_p_proc for the map script and every other
        // script on it (scripts.cc scriptsExecMapUpdateScripts), and only then is the map
        // saved. (The car's script removes the car this way when you drive off.)
        // CE _map_save_in_game: _queue_leaving_map first
        if (this.name !== null && this.objects !== null) Scripting.queueLeavingMap()
        if (Config.engine.doLoadScripts && this.name !== null && this.objects !== null) {
            if (this.mapScript?.map_exit_p_proc !== undefined) {
                this.mapScript.self_obj = { _script: this.mapScript }
                this.mapScript.map_exit_p_proc()
            }
            globalScriptsMapProc('map_exit_p_proc') // CE scriptsExecMapUpdateScripts
            const party = new Set<Obj>(globalState.gParty.getPartyMembersAndPlayer())
            const scripted = [...this.objects.flat(), ...((this.spatials ?? []) as any[]).flat()]
                .filter((o: any) => o && !party.has(o) && o._script?.map_exit_p_proc !== undefined)
            for (const obj of scripted) {
                if (obj.type !== undefined && obj.type !== 'spatial' && !this.objects.some((l) => l.includes(obj))) continue // destroyed meanwhile
                Scripting.objectRunProc(obj, 'map_exit_p_proc')
            }
        }
        // destroy_object only queues the removal (drained per tick); objects the exit
        // procs destroyed must be gone before the snapshot below.
        if (this.objects !== null) this.drainRemovalQueue()

        if (Config.engine.doSaveDirtyMaps && this.name !== null && this.objects !== null) {
            // if a map is already loaded, save it to the dirty map cache before loading
            dbg('map', `[Main] Serializing map ${this.name} and committing to dirty map cache`)
            globalState.dirtyMapCache[this.name] = this.serialize()
        }

        if (mapName in globalState.dirtyMapCache) {
            // Previously loaded; load from dirty map cache
            dbg('map', `[Main] Loading map ${mapName} from dirty map cache`)

            Events.emit('loadMapPre')

            const map = globalState.dirtyMapCache[mapName]
            this.deserialize(map)
            mapLoadSavedAging(this)

            // Set position and orientation
            if (startingPosition !== undefined) {
                globalState.player.position = startingPosition
            }
            // Use default map starting position
            else {
                globalState.player.position = map.mapObj.startPosition
            }

            globalState.player.orientation = map.mapObj.startOrientation

            // Set elevation: none / -1 is the map header's (CE map.cc mapLoad: gEnteringElevation
            // == -1 → gMapHeader.enteringElevation); out of bounds clamps to it as well
            const headerElev = Number(this.mapObj.startElevation) || 0
            const requestedElev = startingElevation === undefined || startingElevation < 0 ? headerElev : Number(startingElevation) || 0
            const safeElev = this.mapObj.levels[requestedElev] ? requestedElev : (this.mapObj.levels[headerElev] ? headerElev : 0)
            if (safeElev !== requestedElev) {
                dbgWarn('map', `loadMap (dirty cache): starting elevation ${requestedElev} out of bounds (map has ${this.numLevels} levels), using ${safeElev}`)
            }
            this.currentElevation = globalState.currentElevation = safeElev

            // Change to our new elevation (sets up map state)
            this.changeElevation(this.currentElevation, false, true)

            // Enter map
            this.doEnterNewMap(false)

            // Change elevation again — no script update: doEnterNewMap already ran CE
            // mapLoad's one scriptsExecMapUpdateProc
            this.changeElevation(this.currentElevation, false, false)


            // Done
			this.playMapMusic()
            dbg('map', `[Main] Loaded from dirty map cache`)
            loadedCallback && loadedCallback()

            globalState.player?.updateNativeLook() // CE map.cc:999
            Events.emit('loadMapPost')
        } else {
            dbg('map', `[Main] Loading map ${mapName} from clean load`)
            this.loadNewMap(mapName, startingPosition, startingElevation, loadedCallback)
        }
}

GameMap.prototype.loadNewMap = function (mapName: string, startingPosition?: Point, startingElevation?: number, loadedCallback?: () => void) {
        function load(file: string, callback?: (x: HTMLImageElement) => void) {
            if (globalState.images[file] !== undefined) {
                return
            } // don't load more than once
            globalState.loadingAssetsTotal++
            ensureCycleMask(file)
            heart.graphics.newImage(file + '.png', (r: HTMLImageElement) => {
                globalState.images[file] = r
                globalState.loadingAssetsLoaded++
                if (callback) {
                    callback(r)
                }
            })
        }

        this.name = mapName.toLowerCase()
        setMapScrollLimits(this.name)

        Events.emit('loadMapPre')

        globalState.isLoading = true
        globalState.loadingAssetsTotal = 1 // this will remain +1 until we load the map, preventing it from exiting early
        globalState.loadingAssetsLoaded = 0
        globalState.loadingLoadedCallback = loadedCallback || null

        // clear any previous objects/events
        this.objects = null
        this.mapScript = null
        this._isOutdoorCached = null
        this._isOutdoorCachedElevation = -1
        Scripting.reset(this.name)

        // reset player animation status (to idle)
        globalState.player.clearAnim()

        dbg('map', 'loading map ' + mapName)

        let mapImages: string[]
        try {
            mapImages = getFileJSON('maps/' + mapName + '.images.json') ?? []
        } catch (e) {
            dbgWarn('map', `[Map] No images file for ${mapName}:`, e)
            mapImages = []
        }
        for (let i = 0; i < mapImages.length; i++) {
            load(mapImages[i])
        }
        dbg('map', 'loading ' + mapImages.length + ' images')

        let map: any
        try {
            map = getFileJSON('maps/' + mapName + '.json')
        } catch (e) {
            // A missing or empty map JSON (failed/incomplete asset extraction)
            // must not crash the engine uncaught — that leaves isLoading=true
            // forever, freezing input (see input.ts:49/176) and the autocrawler
            // (which waits on isLoading with a timeout instead of failing fast).
            dbgWarn('map', `[Map] FAILED to load maps/${mapName}.json — aborting map load:`, e)
            globalState.isLoading = false
            showAlert(`Could not load map "${mapName}".\nThe map data file may be missing or corrupt.`)
            return
        }
        this.mapObj = map
        this.mapID = map.mapID
        this.numLevels = (map.levels ?? []).length

        // none / -1: the map header's entering elevation (CE map.cc mapLoad); one the map
        // lacks would leave the previous map's elevation in place (changeElevation refuses it)
        const headerElevation = Number(map.startElevation) || 0
        let elevation = startingElevation === undefined || startingElevation < 0 ? headerElevation : Number(startingElevation) || 0
        if (!(map.levels ?? [])[elevation]) {
            dbgWarn('map', `loadMap: starting elevation ${elevation} out of bounds (map has ${(map.levels ?? []).length} levels), using ${headerElevation}`)
            elevation = headerElevation
        }

        if (Config.engine.doLoadScripts) {
            Scripting.init(mapName)
            try {
                this.mapScript = Scripting.loadScript(mapName)
                Scripting.setMapScript(this.mapScript)
            } catch (e) {
                this.mapScript = null
                dbgWarn('map', 'ERROR LOADING MAP SCRIPT:', e.message)
            }
        } else {
            this.mapScript = null
        }

        // warp to the default position (may be overridden by map script)
        globalState.player.position = startingPosition || map.startPosition
        globalState.player.orientation = map.startOrientation

        if (Config.engine.doSpatials) {
            this.spatials = map.levels.map((level: any) => level.spatials)

            if (Config.engine.doLoadScripts) {
                // initialize spatial scripts
                this.spatials.forEach((level: any) =>
                    level.forEach((spatial: Spatial) => {
                        const script = Scripting.loadScript(spatial.script)
                        if (script === null) {
                            dbgWarn('map', 'load script failed for spatial ' + spatial.script)
                        } else {
                            spatial._script = script
                            // no need to initialize here because spatials only use spatial_p_proc
                        }

                        spatial.isSpatial = true
                        spatial.position = fromTileNum(spatial.tileNum)
                    })
                )
            }
        } // TODO: Spatial type
        else {
            this.spatials = map.levels.map((_: any) => [] as Spatial[])
        }

        // Load map objects. Note that these need to be loaded *after* the map so that object scripts
        // have access to the map script object.
        this.objects = new Array(map.levels.length)
        for (let level = 0; level < map.levels.length; level++) {
            this.objects[level] = (map.levels[level].objects ?? []).map((obj: any) => {
                const o = objFromMapObject(obj)
                o.elevation = level
                return o
            })
        }

        // change to our new elevation (sets up map state)
        this.changeElevation(elevation, false, true)

        // TODO: when exactly are these called?
        // TODO: when objectsAndSpatials is updated, the scripting engine won't know
        const objectsAndSpatials = this.getObjectsAndSpatials()

        if (Config.engine.doLoadScripts) {
            // party member NPCs get the new map script
            globalState.gParty.getPartyMembers().forEach((obj: Critter) => {
                obj._script._mapScript = this.mapScript
            })

            this.doEnterNewMap(true)
            elevation = this.currentElevation

            // no script update here: doEnterNewMap ran CE mapLoad's one scriptsExecMapUpdateProc
            this.changeElevation(this.currentElevation, false, true)

        }

        // CE ref: map.cc:362 mapSetElevation — only fires scriptsExecMapUpdateProc, NOT map_enter_p_proc
        dbg(
            'map',
            'loaded (' +
                map.levels.length +
                ' levels, ' +
                this.getObjects().length +
                ' objects on elevation ' +
                elevation +
                ')'
        )

        // load some testing art
        load('art/critters/hmjmpsat')
        load('img/hex_outline') // DH2's hex cursor outline (not game art)

        // load cursor assets
        load('art/intrface/stdarrow')
        load('art/intrface/actarrow')
        load('art/intrface/acrshair')
        load('art/intrface/crossuse')
        load('art/intrface/lookn')
        load('art/intrface/scrnorth')
        load('art/intrface/scrsouth')
        load('art/intrface/screast')
        load('art/intrface/scrwest')
        load('art/intrface/scrneast')
        load('art/intrface/scrnwest')
        load('art/intrface/scrseast')
        load('art/intrface/scrswest')

        globalState.loadingAssetsTotal-- // we should know all of the assets we need by now

        // clear audio and use the map music
		this.playMapMusic()

        dbg(
            'map',
            `[lighting] map '${mapName}' loaded — doFloorLighting=${Config.engine.doFloorLighting}, ` +
            `floorLightingMode=${Config.engine.floorLightingMode}`
        )

        globalState.player?.updateNativeLook() // CE map.cc:999
        Events.emit('loadMapPost')
    }


GameMap.prototype.loadMapByID = function (mapID: number, startingPosition?: Point, startingElevation?: number): void {
        const mapName = lookupMapName(mapID)
        if (mapName !== null) {
            this.loadMap(mapName, startingPosition, startingElevation)
        } else {
            dbgWarn('map', "couldn't lookup map name for map ID " + mapID)
        }
}
