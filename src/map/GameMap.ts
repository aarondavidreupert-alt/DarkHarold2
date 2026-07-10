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

import { Config } from '../config.js'
import { getCurrentMapInfo } from '../data.js'
import { Events } from '../events.js'
import { hexInDirectionDistance, hexLine, hexNeighbors, HEX_GRID_SIZE, Point } from '../geometry.js'
import globalState from '../globalState.js'
import { Lightmap } from '../lightmap.js'
import { dbg, dbgWarn } from '../logger.js'
import { Critter, deserializeObj, Obj } from '../object.js'
import { centerCamera } from '../renderer.js'
import { computeMapContentBounds, computeObjectContentBounds } from '../render/camera.js'
import { Scripting } from '../scripting.js'
import { fromTileNum, hexToTile } from '../tile.js'
import { arrayRemove, arrayWithout } from '../util.js'

declare let PF: any

// Representation of game map and its serialized forms

// TODO: Spatial type
type Spatial = any

export interface SerializedSpatial {
    script: string
    tileNum: number
    radius: number
    lvars?: { [lvar: number]: any }
}

export interface SerializedMap {
    name: string
    mapID: number
    numLevels: number

    mapScript: /* SerializedScript */ any
    objects: /* SerializedObj */ any[][]
    spatials: SerializedSpatial[][]

    floorMap: string[][]
    roofMap: string[][]

    mapObj: any // required?

    // CE ref: map.cc gMapHeader.lastVisitTime — ticks when player last left this map (0 = never)
    lastVisitTime?: number
}

export class GameMap {
    name: string = null
    startingPosition: Point
    startingElevation: number
    numLevels: number

    currentElevation = 0 // current map elevation

    floorMap: string[][] = null // Floor tilemap
    roofMap: string[][] = null // Roof tilemap

    mapScript: any = null // Current map script object
    objects: Obj[][] = null // Map objects on all levels
    spatials: any[][] = null // Spatials on all levels

    // CE ref: map.cc gMapHeader.lastVisitTime — ticks when player last left this map (0 = never)
    lastVisitTime: number = 0

    private _removalQueue: Obj[] = []

    mapObj: any = null
    mapID: number

    // Cached isOutdoor() result for the current map+elevation.
    // Reset whenever we (re)load a map or change elevation.
    /** @internal — exposed for mapLoader.ts; do not access externally. */
    _isOutdoorCached: boolean | null = null
    /** @internal — exposed for mapLoader.ts; do not access externally. */
    _isOutdoorCachedElevation: number = -1

    getObjects(level?: number): Obj[] {
        return this.objects[level === undefined ? this.currentElevation : level]
    }

    getSpatials(level?: number): any[] {
        return this.spatials[level === undefined ? this.currentElevation : level]
    }

    getObjectsAndSpatials(level?: number): Obj[] {
        return this.getObjects().concat(this.getSpatials())
    }

    addObject(obj: Obj, level?: number): void {
        this.objects[level === undefined ? this.currentElevation : level].push(obj)
        // CE ref: objAddToMap (obj.cc) — purely spatial placement; does NOT fire map_enter_p_proc.
        // map_enter_p_proc is fired once per map load by scriptsExecMapEnterProc, not on every add.
        // Calling enterMap() here causes infinite recursion when move_to is used inside map_enter_p_proc.
    }

    removeObject(obj: Obj): void {
        this._removalQueue.push(obj)
    }

    // Drain the deferred removal queue. Called once per heartbeat tick from main.ts
    // after all per-frame script/animation updates have run. Draining at the end of
    // the tick prevents index drift when a script removes objects during iteration.
    drainRemovalQueue(): void {
        if (this._removalQueue.length === 0) return
        const toRemove = this._removalQueue
        this._removalQueue = []
        for (const obj of toRemove) {
            let found = false
            for (let level = 0; level < this.numLevels; level++) {
                const objects = this.objects[level]
                for (let i = 0; i < objects.length; i++) {
                    if (objects[i] === obj) {
                        dbg('object', 'drainRemovalQueue: removing index %d (%o)', i, obj)
                        objects.splice(i, 1)
                        found = true
                        break
                    }
                }
                if (found) break
            }
            if (!found) dbgWarn('object', "drainRemovalQueue: object not found on map")
        }
    }

    destroyObject(obj: Obj): void {
        Scripting.destroy(obj)
        this.removeObject(obj)
    }

    hasRoofAt(pos: Point, elevation?: number): boolean {
        if (elevation === undefined) {
            elevation = this.currentElevation
        }

        const tilePos = hexToTile(pos)
        return this.mapObj.levels[elevation].tiles.roof[tilePos.y][tilePos.x] !== 'grid000'
    }

    // Heuristic: is the current elevation an "outdoor" map?
    //
    // Fallout 2 map files don't flag indoor vs outdoor, but indoor maps
    // (buildings, caves, vaults) tile their whole ceiling with roof art,
    // while outdoor maps (desert, town exteriors, worldmap encounters)
    // leave the roof layer mostly 'grid000' (no roof). We count the ratio
    // of non-'grid000' roof tiles on the current elevation: if more than
    // half the roof tiles are empty, it's outdoor.
    //
    // Used by the lighting system to decide whether a script's
    // set_light_level override should be honored. Indoor maps often dim
    // themselves to 40% in map_enter_p_proc for atmosphere; that looks
    // fine in a cave but pins the ambient below noon brightness outside.
    isOutdoor(): boolean {
        if (!this.mapObj || !this.mapObj.levels || !this.mapObj.levels[this.currentElevation]) {
            return false
        }
        if (this._isOutdoorCached !== null && this._isOutdoorCachedElevation === this.currentElevation) {
            return this._isOutdoorCached
        }

        const roof = this.mapObj.levels[this.currentElevation].tiles.roof
        let total = 0
        let empty = 0
        for (let y = 0; y < roof.length; y++) {
            const row = roof[y]
            for (let x = 0; x < row.length; x++) {
                total++
                if (row[x] === 'grid000') {
                    empty++
                }
            }
        }

        const result = total > 0 && empty / total > 0.5
        this._isOutdoorCached = result
        this._isOutdoorCachedElevation = this.currentElevation
        dbg(
            'map',
            `[lighting] isOutdoor(${this.name}, elev ${this.currentElevation}) = ${result} ` +
            `(${empty}/${total} empty roof tiles)`
        )
        return result
    }

    updateMap(): void {
        // CE ref: scripts.cc:2601 scriptsExecMapUpdateScripts — iterates ALL script lists
        // regardless of elevation, so off-floor critters still tick.
        const allObjs: Obj[] = (this.objects as Obj[][]).reduce((acc, level) => acc.concat(level), [])
        if (this.spatials) {
            (this.spatials as any[][]).forEach(level => level.forEach((s: any) => allObjs.push(s)))
        }
        Scripting.updateMap(this.mapScript, allObjs, this.currentElevation)
    }

    doEnterElevation(): void {
        if (!Config.engine.doLoadScripts) return
        const elev = this.currentElevation
        const mapID = this.mapID

        if (this.mapScript && this.mapScript.map_enter_p_proc !== undefined) {
            this.mapScript.self_obj = { _script: this.mapScript }
            this.mapScript.map_enter_p_proc()
        }

        for (const obj of this.getObjectsAndSpatials()) {
            Scripting.objectEnterMap(obj, elev, mapID)
        }
    }

    changeElevation(level: number, updateScripts = false, isMapLoading = false) {
        if (!this.mapObj.levels[level]) {
            dbgWarn('map', `changeElevation: elevation ${level} does not exist`)
            return
        }
        const oldElevation = this.currentElevation
        this.currentElevation = level
        globalState.currentElevation = level // TODO: Get rid of this global
        // Invalidate outdoor detection cache — roof layer differs per elevation.
        this._isOutdoorCached = null
        this._isOutdoorCachedElevation = -1
        this.floorMap = this.mapObj.levels[level].tiles.floor
        this.roofMap = this.mapObj.levels[level].tiles.roof
        // Floor bbox kept for diagnostics only (window.mapContentBounds).
        computeMapContentBounds(this.floorMap)
        //this.spatials = this.mapObj.levels[level]["spatials"]

        // If we're in combat, end it since we're moving off of that elevation
        if (globalState.inCombat) {
            globalState.combat.end()
        }

        globalState.player.clearAnim()

        // Remove player & party (unless we're loading a new map, in which case they're not present)
        // and place them on the new map
        for (const obj of globalState.gParty.getPartyMembersAndPlayer()) {
            if (!isMapLoading) {
                arrayRemove(this.objects[oldElevation], obj)
            }

            // Only add the member once, in case changeElevation is called multiple times
            if (this.objects[level].indexOf(obj) === -1) {
                this.objects[level].push(obj)
            }
            obj.elevation = level
        }

        this.placeParty()

        // Compute object world-space bbox — source of truth for the black edge
        // overlay and the automatic scroll clamp. Done after objects are placed.
        computeObjectContentBounds(this.getObjects())

        // set up renderer data
        globalState.renderer.initData(this.roofMap, this.floorMap, this.getObjects())

        if (updateScripts) {
            // TODO: we need some kind of active/inactive flag on scripts to toggle here,
            // since scripts should already be loaded
            //loadObjectScripts(gObjects)
            Scripting.updateMap(this.mapScript, this.getObjectsAndSpatials(), level)
        }

        // rebuild the lightmap
        if (Config.engine.doFloorLighting) {
            Lightmap.resetLight()
            Lightmap.rebuildLight()
        }

        centerCamera(globalState.player.position)

        Events.emit('elevationChanged', { elevation: level, oldElevation, isMapLoading })
    }

    placeParty() {
        // set up party members' positions
        globalState.gParty.getPartyMembers().forEach((obj: Critter) => {
            // attempt party member placement around player
            let placed = false
            for (let dist = 1; dist < 3; dist++) {
                for (let dir = 0; dir < 6; dir++) {
                    const pos = hexInDirectionDistance(globalState.player.position, dir, dist)
                    if (this.objectsAtPosition(pos).length === 0) {
                        obj.position = pos
                        dbg('object', 'placed %o @ %o', obj, pos)
                        placed = true
                        break
                    }
                }

                if (placed) {
                    break
                }
            }

            if (!placed) {
                dbg('object', "couldn't place %o (player position: %o)", obj, globalState.player.position)
            }
        })
    }

    doEnterNewMap(isFirstRun: boolean): void {
        // Tell scripts they've entered the new map

        const objectsAndSpatials = this.getObjectsAndSpatials()
        const overridenStartPos = Scripting.enterMap(
            this.mapScript,
            objectsAndSpatials,
            this.currentElevation,
            this.mapID,
            isFirstRun
        )

        if (overridenStartPos) {
            // Starting position was overridden by map_enter_p_proc -- use the new one
            dbg('map', 'Starting position overriden to %o', overridenStartPos)
            globalState.player.position = overridenStartPos.position
            globalState.player.orientation = overridenStartPos.orientation
            // FO2-CE ref: map.cc mapSetupEnter() — elevation from override_map_start is validated
            // against the number of map levels before use. Maps with fewer levels than the script
            // expects (e.g. modinn exported with 2 levels but script targets elevation 2) must not
            // corrupt currentElevation — keep the pre-load value instead.
            const newElev = overridenStartPos.elevation
            if (this.mapObj.levels[newElev]) {
                this.currentElevation = globalState.currentElevation = newElev
            } else {
                dbgWarn('map', `override_map_start: elevation ${newElev} out of bounds (map has ${this.numLevels} levels), ignoring`)
            }
        }

        // place party again, so if the map script overrided the start position we're in the right place
        this.placeParty()

        // Tell objects' scripts that they're now on the map
        // TODO: Does this apply to all levels or just the current elevation?
        this.objects.forEach((level) => level.forEach((obj) => obj.enterMap()))
        this.spatials.forEach((level) =>
            level.forEach((spatial) => Scripting.objectEnterMap(spatial, this.currentElevation, this.mapID))
        )

        Scripting.updateMap(this.mapScript, objectsAndSpatials, this.currentElevation)
    }
	
	/** @internal — used by mapLoader.ts via the prototype. */
	playMapMusic(): void {
		const curMapInfo = getCurrentMapInfo()
		dbg('audio', '[Music] curMapInfo:', curMapInfo)
		dbg('audio', '[Music] music field:', curMapInfo?.music)
		globalState.audioEngine.stopAll()
		if (curMapInfo && curMapInfo.music) {
			dbg('audio', '[Music] calling playMusic with:', curMapInfo.music)
			globalState.audioEngine.playMusic(curMapInfo.music)
		} else {
			dbg('audio', '[Music] no music to play')
		}
	}
	

    objectsAtPosition(position: Point): Obj[] {
        return this.getObjects().filter((obj: Obj) => obj.position.x === position.x && obj.position.y === position.y)
    }

    critterAtPosition(position: Point): Critter | null {
        return (this.objectsAtPosition(position).find((obj) => obj.type === 'critter') as Critter) || null
    }

    /// Draws a line between a and b, returning the first object hit
    hexLinecast(a: Point, b: Point): Obj | null {
        // CE ref: object.cc:2440 _obj_shoot_blocking_at — skips OBJECT_SHOOT_THRU
        // (0x80000000), OBJECT_HIDDEN, dead critters, and non-blocking objects.
        let line = hexLine(a, b)
        if (line === null) {
            return null
        }
        line = line.slice(1, -1)
        const SHOOT_THRU = 0x80000000
        const HIDDEN = 0x01000000
        for (let i = 0; i < line.length; i++) {
            const objs = this.objectsAtPosition(line[i])
            for (const o of objs) {
                const flags = (o as any).flags ?? 0
                if ((flags & HIDDEN) !== 0) continue
                if ((flags & SHOOT_THRU) !== 0) continue
                if ((o as any).type === 'critter' && (o as any).dead) continue
                if (!o.blocks()) continue
                return o
            }
        }
        return null
    }

    recalcPath(start: Point, goal: Point, isGoalBlocking?: boolean) {
        // FO2-CE ref: ai.cc — all pathFind() call sites guard against tile == -1;
        // tile.cc tileIsValid() checks tile >= 0 && tile < gHexGridSize (200*200).
        // Equivalent check on x,y coords: each must be in [0, HEX_GRID_SIZE).
        if (start.x < 0 || start.x >= HEX_GRID_SIZE || start.y < 0 || start.y >= HEX_GRID_SIZE ||
            goal.x < 0 || goal.x >= HEX_GRID_SIZE || goal.y < 0 || goal.y >= HEX_GRID_SIZE) {
            return []
        }
        const matrix = new Array(HEX_GRID_SIZE)

        for (let y = 0; y < HEX_GRID_SIZE; y++) {
            matrix[y] = new Array(HEX_GRID_SIZE)
        }

        for (const obj of this.getObjects()) {
            const ox = obj.position.x, oy = obj.position.y
            // Skip objects with out-of-bounds positions (off-map sentinel values).
            if (ox < 0 || ox >= HEX_GRID_SIZE || oy < 0 || oy >= HEX_GRID_SIZE) continue
            // if there are multiple, any blocking one will block
            const blocks = obj.pathBlocks()
            matrix[oy][ox] |= <any>blocks
            // CE ref: object.cc:2413 _obj_blocking_at — OBJECT_MULTIHEX (0x800)
            // objects also block all 6 adjacent hexes.
            if (blocks && (((obj as any).flags ?? 0) & 0x800) !== 0) {
                for (const nb of hexNeighbors({ x: ox, y: oy })) {
                    if (nb.x >= 0 && nb.x < HEX_GRID_SIZE && nb.y >= 0 && nb.y < HEX_GRID_SIZE) {
                        matrix[nb.y][nb.x] = 1
                    }
                }
            }
        }

        if (isGoalBlocking === false) {
            matrix[goal.y][goal.x] = 0
        }

        const grid = new PF.Grid(HEX_GRID_SIZE, HEX_GRID_SIZE, matrix)
        const finder = new PF.AStarFinder()
        return finder.findPath(start.x, start.y, goal.x, goal.y, grid)
    }

    serialize(): SerializedMap {
        return {
            name: this.name,
            mapID: this.mapID,
            numLevels: this.numLevels,
            mapObj: {
                levels: this.mapObj.levels.map((level: any) => ({ tiles: level.tiles })),
                startPosition: this.mapObj.startPosition,
                startOrientation: this.mapObj.startOrientation,
            },

            // roof/floor maps
            roofMap: this.roofMap,
            floorMap: this.floorMap,

            mapScript: this.mapScript ? this.mapScript._serialize() : null,
            objects: this.objects.map((level: Obj[]) =>
                arrayWithout(level, globalState.player).map((obj) => obj.serialize())
            ), // TODO: Should be without entire party?
            // FO2-CE ref: map.cc mapSave — spatials persist their LVARs across saves
            spatials: this.spatials
                ? this.spatials.map(level => level.map((s: Spatial): SerializedSpatial => ({
                      script: s.script,
                      tileNum: s.tileNum,
                      radius: s.radius ?? 0,
                      lvars: s._script ? Object.assign({}, s._script.lvars) : undefined,
                  })))
                : [[], [], []],
            // CE ref: map.cc gMapHeader.lastVisitTime — record exit tick so days_since_visited works
            lastVisitTime: globalState.gameTickTime,
        }
    }

    deserialize(obj: SerializedMap): void {
        this.name = obj.name
        this.mapID = obj.mapID
        this.numLevels = obj.numLevels
        this.mapObj = obj.mapObj
        this.mapScript = obj.mapScript ? Scripting.deserializeScript(obj.mapScript) : null
        this.objects = obj.objects.map((level, levelIdx) => level.map((o) => {
            const deserialized = deserializeObj(o)
            deserialized.elevation = levelIdx
            return deserialized
        }))
        this.lastVisitTime = obj.lastVisitTime ?? 0
        // Restore spatials: re-load scripts from names, then reapply saved LVARs.
        // FO2-CE ref: map.cc mapLoad — spatials are always re-initialized from map data
        if (Array.isArray(obj.spatials)) {
            this.spatials = obj.spatials.map(level =>
                level.map((s: SerializedSpatial) => {
                    const spatial: Spatial = {
                        script: s.script,
                        tileNum: s.tileNum,
                        radius: s.radius,
                        isSpatial: true,
                        position: fromTileNum(s.tileNum),
                    }
                    const scr = Scripting.loadScript(s.script)
                    if (scr) {
                        if (s.lvars) scr.lvars = s.lvars
                        spatial._script = scr
                    }
                    return spatial
                })
            )
        } else {
            this.spatials = [[], [], []]
        }
        this.roofMap = obj.roofMap
        this.floorMap = obj.floorMap
        computeMapContentBounds(this.floorMap)
        this.currentElevation = 0 // TODO

        //this.mapObj = {levels: [{tiles: {floor: this.floorMap, roof: this.roofMap}}]} // TODO: add dimension to roofMap

        // TODO: reset scriptingEngine?
    }
}
