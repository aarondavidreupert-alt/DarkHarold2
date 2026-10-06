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

import { getCarParkingEntry } from '../carParking.js'
import { Config } from '../config.js'
import { areaContainingMap, getCurrentMapInfo, loadAreas, lookupMapName } from '../data.js'
import { Events } from '../events.js'
import { Point } from '../geometry.js'
import globalState from '../globalState.js'
import { heart } from '../heart.js'
import { Lightmap } from '../lightmap.js'
import { dbg, dbgWarn } from '../logger.js'
import { Critter, deserializeObj, Obj, objFromMapObject, Scenery } from '../object.js'
import { centerCamera } from '../renderer.js'
import { setMapScrollLimits } from '../render/camera.js'
import { Scripting } from '../scripting.js'
import { fromTileNum, hexToTile, tileFromScreen, tileToScreen } from '../tile.js'
import { arrayWithout, getFileJSON } from '../util.js'
import { showAlert } from '../ui_dialog.js'
import { Worldmap } from '../worldmap.js'
import { GameMap } from './GameMap.js'

// CE ref: proto_types.h — PROTO_ID_CAR = 0x020003F1 (scenery/generic, art=carspec1)
//                         PROTO_ID_CAR_TRUNK = 455 (0x1C7, item/container)
const PROTO_ID_CAR = 0x020003F1
const PROTO_ID_CAR_TRUNK = 455

// Per-map parking tile override table (lut/car_parking.json) — see
// ../carParking.ts. Kept as its own dependency-free module so both this
// file and src/worldmap/Worldmap.ts / src/ui_worldmap.ts can use it without
// a circular import (this file already depends on the worldmap barrel).

// Resolve the car body position for the given map: use the data-file tile if it
// is ≥ 0, otherwise fall back to 3 tiles east of the area entrance tile (or map
// start if no entrance tileNum is recorded).
function resolveCarPos(mapName: string, mapObj: any): Point {
    const entry = getCarParkingEntry(mapName)
    if (entry && entry.carTile >= 0) {
        return fromTileNum(entry.carTile)
    }
    // Heuristic fallback: entrance tile + x+3
    if (globalState.mapAreas) {
        const area = areaContainingMap(mapName)
        if (area) {
            const ent = area.entrances.find(e => e.mapName === mapName)
            if (ent && ent.tileNum > 0) {
                const ep = fromTileNum(ent.tileNum)
                return { x: ep.x + 3, y: ep.y }
            }
        }
    }
    const sp = mapObj.startPosition ?? { x: 100, y: 100 }
    return { x: sp.x + 3, y: sp.y }
}

// Resolve the trunk position: data-file tile if ≥ 0, otherwise a fixed
// nearby offset from the car, applied in SCREEN space (tileToScreen/
// tileFromScreen) rather than tile-grid arithmetic. DH2's tile grid is an
// offset/staggered hex grid (src/geometry/hexGrid.ts hexNeighbors —
// neighbor deltas depend on x's parity), so simple tile-coordinate math
// like the original {x: carPos.x + 2, y: carPos.y} heuristic doesn't
// reliably land in a consistent screen-space direction from the car (it
// rendered visibly skewed — ~1 hex south + 1 hex east of the intended
// adjacent tile). Going through screen space sidesteps that: the offset
// below is picked directly in on-screen pixels (left + up from the car),
// tuned interactively in-game, and round-tripped back to a tile via
// tileFromScreen. The original game computes this relative to the car via
// tile_num_in_dir() (see wiki/car_system.md §7) but the exact per-town
// direction/distance wasn't extracted, so this is a reasonable nearby
// placement, not a faithful reproduction of that value.
// `let`, not `const` — window.setTrunkOffset(x, y) in main.ts writes these
// directly for live in-browser tuning (see that function for usage). Changes
// apply the next time a car+trunk get (re)injected — leave the parked map
// and come back, or call window.giveCar() again.
let TRUNK_OFFSET_SCREEN_X = 0   // +right / -left of the car, screen px
let TRUNK_OFFSET_SCREEN_Y = -80 // +down  / -up   of the car, screen px

export function setTrunkOffset(x: number, y: number): void {
    TRUNK_OFFSET_SCREEN_X = x
    TRUNK_OFFSET_SCREEN_Y = y
}
export function getTrunkOffset(): { x: number; y: number } {
    return { x: TRUNK_OFFSET_SCREEN_X, y: TRUNK_OFFSET_SCREEN_Y }
}

// Recomputes and moves an already-injected trunk on the currently loaded map,
// in place, using the current offset — so window.setTrunkOffset() in main.ts
// can show its effect immediately instead of requiring the leave/re-enter (or
// manual dirtyMapCache surgery) that "(re)injection" would otherwise need.
// Returns true if it found a car+trunk pair to move.
export function repositionExistingTrunk(): boolean {
    const map = globalState.gMap
    if (!map || !map.objects) return false
    const elev = map.currentElevation
    const objs = map.objects[elev]
    if (!objs) return false
    const car = objs.find((o: any) => o.pid === PROTO_ID_CAR)
    const trunk = objs.find((o: any) => o.pid === PROTO_ID_CAR_TRUNK)
    if (!car || !trunk) return false
    const idx = objs.indexOf(trunk)
    trunk.move(resolveTrunkPos(map.name, car.position), idx, false)
    return true
}

function resolveTrunkPos(mapName: string, carPos: Point): Point {
    const entry = getCarParkingEntry(mapName)
    if (entry && entry.trunkTile >= 0) {
        return fromTileNum(entry.trunkTile)
    }
    const carScreen = tileToScreen(carPos.x, carPos.y)
    return tileFromScreen(carScreen.x + TRUNK_OFFSET_SCREEN_X, carScreen.y + TRUNK_OFFSET_SCREEN_Y)
}

declare let PF: any

// Spatial type — duplicated from GameMap.ts to avoid exposing it on the barrel.
type Spatial = any

declare module './GameMap.js' {
    interface GameMap {
        loadMap(mapName: string, startingPosition?: Point, startingElevation?: number, loadedCallback?: () => void): void
        loadNewMap(mapName: string, startingPosition?: Point, startingElevation?: number, loadedCallback?: () => void): void
        loadMapByID(mapID: number, startingPosition?: Point, startingElevation?: number): void
    }
}

GameMap.prototype.loadMap = function (mapName: string, startingPosition?: Point, startingElevation = 0, loadedCallback?: () => void): void {
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

            // Set position and orientation
            if (startingPosition !== undefined) {
                globalState.player.position = startingPosition
            }
            // Use default map starting position
            else {
                globalState.player.position = map.mapObj.startPosition
            }

            globalState.player.orientation = map.mapObj.startOrientation

            // Set elevation — clamp to 0 if out of bounds (same guard as doEnterNewMap)
            const requestedElev = Number(startingElevation) || 0
            const safeElev = this.mapObj.levels[requestedElev] ? requestedElev : 0
            if (safeElev !== requestedElev) {
                dbgWarn('map', `loadMap (dirty cache): starting elevation ${requestedElev} out of bounds (map has ${this.numLevels} levels), clamping to 0`)
            }
            this.currentElevation = globalState.currentElevation = safeElev

            // Change to our new elevation (sets up map state)
            this.changeElevation(this.currentElevation, false, true)

            // Enter map
            this.doEnterNewMap(false)

            // Change elevation again
            this.changeElevation(this.currentElevation, true, false)

            // Re-inject the car body on dirty-cache revisit — the body is _transient so
            // it was stripped from the serialized snapshot. The trunk is NOT _transient,
            // so a trunk that was already present when this snapshot was taken comes back
            // on its own (with its inventory intact) — but if this map was cached BEFORE
            // the car was ever parked here (e.g. giveCar() called while already standing
            // on it, or the car got parked here after this map had already been visited
            // once), the cached snapshot never had a trunk to begin with, and dirty-cache
            // revisits used to never inject one either. Check for one and add it if it's
            // genuinely missing, exactly like the clean-load path below.
            const _dcCarParked = !Worldmap.getIsInCar() && Worldmap.getCarMapName() === this.name
            if (_dcCarParked) {
                if (!globalState.mapAreas) globalState.mapAreas = loadAreas()
                const _dcArea = areaContainingMap(this.name)
                if (_dcArea) {
                    const _dcElev = this.currentElevation
                    const _dcPos = resolveCarPos(this.name, map.mapObj)
                    const _dcObj = Scenery.fromPID(PROTO_ID_CAR)
                    _dcObj.elevation = _dcElev
                    ;(_dcObj as any)._transient = true
                    _dcObj._script = {
                        use_p_proc: () => {
                            Worldmap.setIsInCar(true)
                            Worldmap.updateCarUI()
                            Events.emit('openWorldmap')
                        }
                    } as any
                    // push() alone leaves the object at the tail of the array forever —
                    // rendering is a plain painter's-algorithm draw in array order (no
                    // depth buffer, no per-tile sort), so "last in array" means "always
                    // drawn on top of literally everything," and looked like the player
                    // could walk through the car even though pathfinding (which rescans
                    // the array fresh every call) already blocked its tile correctly.
                    // .move() is what re-splices a newly-added object into its correct
                    // z-order slot (see Obj.drop() for the same push-then-move pattern).
                    this.objects[_dcElev].push(_dcObj)
                    _dcObj.move(_dcPos, this.objects[_dcElev].length - 1, false)
                    dbg('map', `[Car] Highwayman re-injected (dirty cache) at (${_dcPos.x},${_dcPos.y}) elev=${_dcElev}`)

                    const _dcHasTrunk = this.objects[_dcElev].some((o: any) => o.pid === PROTO_ID_CAR_TRUNK)
                    if (!_dcHasTrunk) {
                        const _dcTrunkPos = resolveTrunkPos(this.name, _dcPos)
                        const _dcTrunkObj = Obj.fromPID(PROTO_ID_CAR_TRUNK)
                        _dcTrunkObj.elevation = _dcElev
                        this.objects[_dcElev].push(_dcTrunkObj)
                        _dcTrunkObj.move(_dcTrunkPos, this.objects[_dcElev].length - 1, false)
                        dbg('map', `[Car] Trunk was missing from cached snapshot — injected at (${_dcTrunkPos.x},${_dcTrunkPos.y}) elev=${_dcElev}`)
                    }
                }
            }

            // Done
			this.playMapMusic()
            dbg('map', `[Main] Loaded from dirty map cache`)
            loadedCallback && loadedCallback()

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

        // CE ref: map.cc:1440 scriptsExecMapExitProc() — run map_exit_p_proc on the
        // current map script before tearing down state.
        if (Config.engine.doLoadScripts && this.mapScript?.map_exit_p_proc !== undefined) {
            this.mapScript.self_obj = { _script: this.mapScript }
            this.mapScript.map_exit_p_proc()
        }

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

        let elevation = Number(startingElevation) || 0

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

            // change elevation with script updates
            this.changeElevation(this.currentElevation, true, true)

            // CE ref: worldmap.cc wmCarIsOutsideAnyArea / map_enter_p_proc scripts —
            // F2 places the Highwayman and its trunk via map_enter_p_proc per map.
            // DH2 replicates that here. Tile positions come from lut/car_parking.json
            // (per-map data file, pipeline-safe); -1 entries fall back to the
            // entrance-offset heuristic. carAreaId >= 0 and getCarMapName() matching
            // this.name ensures injection only on the exact parked map.
            const _carParked = !Worldmap.getIsInCar() && Worldmap.getCarMapName() === this.name
            if (_carParked) {
                if (!globalState.mapAreas) globalState.mapAreas = loadAreas()
                const _carArea = areaContainingMap(this.name)
                if (_carArea) {
                    const _carElev = this.currentElevation
                    const _carPos = resolveCarPos(this.name, map)
                    const _trunkPos = resolveTrunkPos(this.name, _carPos)

                    // Car body — transient: re-injected on every visit since it has no
                    // persistent state. use_p_proc reopens the worldmap (drive away).
                    const _carObj = Scenery.fromPID(PROTO_ID_CAR)
                    _carObj.elevation = _carElev
                    ;(_carObj as any)._transient = true
                    _carObj._script = {
                        use_p_proc: () => {
                            Worldmap.setIsInCar(true)
                            Worldmap.updateCarUI()
                            Events.emit('openWorldmap')
                        }
                    } as any
                    // push() alone leaves the object at the tail of the array forever —
                    // rendering is a plain painter's-algorithm draw in array order (no
                    // depth buffer, no per-tile sort), so "last in array" means "always
                    // drawn on top of literally everything," and looked like the player
                    // could walk through the car even though pathfinding (which rescans
                    // the array fresh every call) already blocked its tile correctly.
                    // .move() is what re-splices a newly-added object into its correct
                    // z-order slot (see Obj.drop() for the same push-then-move pattern).
                    this.objects[_carElev].push(_carObj)
                    _carObj.move(_carPos, this.objects[_carElev].length - 1, false)

                    // Trunk — CE ref: proto_types.h PROTO_ID_CAR_TRUNK=455 (item/container).
                    // NOT transient: inventory persists in the dirty-map cache across visits.
                    // Only injected on clean (first) load; dirty-cache revisits restore it
                    // from serialized state, including whatever items the player stored.
                    const _trunkObj = Obj.fromPID(PROTO_ID_CAR_TRUNK)
                    _trunkObj.elevation = _carElev
                    this.objects[_carElev].push(_trunkObj)
                    _trunkObj.move(_trunkPos, this.objects[_carElev].length - 1, false)

                    dbg('map', `[Car] Highwayman at (${_carPos.x},${_carPos.y}), trunk at (${_trunkPos.x},${_trunkPos.y}), elev=${_carElev}, area "${_carArea.name}"`)
                }
            }
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
        load('hex_outline')

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
