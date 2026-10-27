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

import { pathfinderFindPathPoints } from './pathfinder.js'
import { Config } from '../config.js'
import { getCurrentMapInfo } from '../data.js'
import * as Events from '../events.js'
import {
    hexDistance,
    hexFromScreen,
    hexInDirection,
    hexInDirectionDistance,
    hexLine,
    hexNeighbors,
    hexToScreen,
    HEX_GRID_SIZE,
    Point,
} from '../geometry.js'
import globalState from '../globalState.js'
import * as Lightmap from '../lightmap.js'
import { dbg, dbgWarn } from '../logger.js'
import { Critter, deserializeObj, Obj, zsortMap } from '../object.js'
import { centerCamera } from '../renderer.js'
import { computeMapContentBounds, computeObjectContentBounds, computeScrollBlockerBounds } from '../render/camera.js'
import * as Scripting from '../scripting.js'
import { fromTileNum, hexToTile, toTileNum } from '../tile.js'
import { arrayRemove } from '../util.js'

// Representation of game map and its serialized forms

// TODO: Spatial type
type Spatial = any

export interface SerializedSpatial {
    script: string
    tileNum: number
    // CE Script.sp.radius — the map data's `range`. (Saves before 2026-10-18 wrote an
    // always-0 `radius` instead; they fall back to 0 = exact tile.)
    range?: number
    radius?: number
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
        // While a map loads `objects` is null (mapLoader clears it); input handlers such as
        // the mouse-move hover test can still ask — nothing is there yet.
        if (!this.objects) return []
        return this.objects[level === undefined ? this.currentElevation : level] ?? []
    }

    getSpatials(level?: number): any[] {
        return this.spatials[level === undefined ? this.currentElevation : level]
    }

    getObjectsAndSpatials(level?: number): Obj[] {
        return this.getObjects().concat(this.getSpatials())
    }

    addObject(obj: Obj, level?: number): void {
        const elevation = level === undefined ? this.currentElevation : level
        this.objects[elevation].push(obj)
        obj.elevation = elevation // (its spatial checks and move_to read it)
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
            if (!found) dbgWarn('object', 'drainRemovalQueue: object not found on map')
        }
    }

    destroyObject(obj: Obj): void {
        // CE object.cc / opDestroyObject: _combat_delete_critter — out of the turn order
        if (obj.type === 'critter' && globalState.inCombat) globalState.combat?.removeCombatant(obj as Critter)
        Scripting.destroy(obj)
        this.removeObject(obj)
        // CE objectDestroy → _obj_turn_off_light / tileWindowRefresh: a light source, or a wall /
        // scenery that shaped the light, leaves the lightmap at once
        if (
            Config.engine.doFloorLighting &&
            ((obj.lightRadius ?? 0) > 0 || obj.type === 'wall' || obj.type === 'scenery')
        ) {
            Lightmap.rebuildLight()
        }
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
                `(${empty}/${total} empty roof tiles)`,
        )
        return result
    }

    updateMap(): void {
        // CE ref: scripts.cc:2601 scriptsExecMapUpdateScripts — iterates ALL script lists
        // regardless of elevation, so off-floor critters still tick.
        if (!this.objects) return // no map loaded yet
        const allObjs: Obj[] = (this.objects as Obj[][]).reduce((acc, level) => acc.concat(level), [])
        if (this.spatials) {
            ;(this.spatials as any[][]).forEach((level) => level.forEach((s: any) => allObjs.push(s)))
        }
        Scripting.updateMap(this.mapScript, allObjs, this.currentElevation)
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
        // the blocker ring and exit grids, before placeParty's paths ([dh2] walk_limit)
        computeScrollBlockerBounds(this.getObjects(level))
        //this.spatials = this.mapObj.levels[level]["spatials"]

        // If we're in combat, end it since we're moving off of that elevation
        if (globalState.inCombat) {
            globalState.combat.forceEnd()
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

        // CE places the party once, before map_enter_p_proc (partyMemberRestore); a
        // re-entry at the same elevation mustn't undo scripts' move_to on party members
        // (e.g. the car trunk, which its script parks next to the car).
        if (isMapLoading || level !== oldElevation) this.placeParty()

        // draw order: the arrays come from the map file / a save in their own order, and
        // the party was just appended (Obj.ts zsortMap, [dh2] object_sort)
        zsortMap(this.objects)

        // Object bbox (diagnostics); the scroll blockers were read above.
        computeObjectContentBounds(this.getObjects())

        // set up renderer data
        globalState.renderer.initData(
            this.roofMap,
            this.floorMap,
            this.getObjects(),
            this.mapObj.levels[level].tiles.roofFlags ?? null,
        )

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

    // DH2: a black overlay while the elevation switches underneath, faded out over 166 ms.
    // CE map.cc mapSetElevation switches with no fade — [dh2] elevation_fade=0.
    changeElevationFaded(level: number, updateScripts = false): void {
        if (typeof document === 'undefined' || !Config.ui.elevationFade) {
            this.changeElevation(level, updateScripts, false)
            return
        }
        const overlay = document.createElement('div')
        Object.assign(overlay.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            background: 'black',
            opacity: '1',
            pointerEvents: 'none',
            zIndex: '9000',
        })
        document.body.appendChild(overlay)
        this.changeElevation(level, updateScripts, false)
        requestAnimationFrame(() => {
            overlay.style.transition = 'opacity 166ms linear'
            overlay.style.opacity = '0'
            overlay.addEventListener('transitionend', () => overlay.remove(), { once: true })
        })
    }

    // CE ref: party_member.cc _partyMemberSyncPosition — visible critter members go
    // to alternating sides of the player (rotation +4, then +2) at distance 1, 1, 2, 2,
    // 3, … via _objPMAttemptPlacement. Non-critters (the car trunk) and hidden members
    // stay where they are; their scripts place them.
    placeParty() {
        const dude = globalState.player
        if (!dude) return
        const clockwise = (dude.orientation + 2) % 6
        const counterClockwise = (dude.orientation + 4) % 6
        let n = 0
        let distance = 2
        for (const member of globalState.gParty.getPartyMembers()) {
            if (member.type !== 'critter' || GameMap.isHiddenObj(member)) continue
            const rotation = n % 2 !== 0 ? clockwise : counterClockwise
            const tile = hexInDirectionDistance(dude.position, rotation, Math.trunc(distance / 2))
            member.position = this.attemptPartyPlacement(dude, tile)
            dbg('object', 'placed %o @ %o', member, member.position)
            distance++
            n++
        }
    }

    // CE proto_instance.cc:2184 _obj_attempt_placement: the tile when it's free, else a
    // free tile at distance 2..6 the dude can walk to — the loop runs on after a find,
    // so the last examined tile is kept, as in CE — and, when that ends farther than
    // radius + 2, any free neighbour (reachable or not). Returns the tile to use.
    attemptPlacement(tile: number, elevation: number, radius: number): number {
        if (tile === -1) return -1
        const dude = globalState.player
        let newTile = tile
        if (this.blockingObjectAt(tile, elevation, 0, null) !== null) {
            let dist = radius >= 1 ? radius : 1
            let attempts = 0
            const from = fromTileNum(tile)
            while (dist < 7) {
                attempts++
                if (attempts >= 100) break
                for (let rotation = 0; rotation < 6; rotation++) {
                    newTile = toTileNum(hexInDirectionDistance(from, rotation, dist))
                    if (
                        this.blockingObjectAt(newTile, elevation, 0, null) === null &&
                        dist > 1 &&
                        dude &&
                        this.recalcPath(dude.position, fromTileNum(newTile), false, dude).length > 0
                    )
                        break
                }
                dist++
            }
            if (radius !== 1 && dist > radius + 2) {
                for (let rotation = 0; rotation < 6; rotation++) {
                    const candidate = toTileNum(hexInDirection(from, rotation))
                    if (this.blockingObjectAt(candidate, elevation, 0, null) === null) {
                        newTile = candidate
                        break
                    }
                }
            }
        }
        return newTile
    }

    // CE ref: proto_instance.cc:2244 _objPMAttemptPlacement + worldmap.cc
    // wmEvalTileNumForPlacement (not blocked, and reachable from the player): if the
    // wanted tile fails, spiral out from the player (direction v%6, step 1) up to 100
    // steps, giving up (back to the wanted tile) once more than 8 hexes away.
    private attemptPartyPlacement(dude: Obj, tile: Point): Point {
        const ok = (p: Point): boolean => {
            if (this.blockingObjectAt(toTileNum(p), dude.elevation, 0, dude) !== null) return false
            return this.recalcPath(dude.position, p, false, dude).length > 0
        }
        if (ok(tile)) return tile
        let cur = dude.position
        for (let v = 1; v <= 100; v++) {
            cur = hexInDirection(cur, v % 6)
            if (ok(cur)) return cur
            if (hexDistance(dude.position, cur) > 8) return tile
        }
        return cur
    }

    // CE loadsave.cc lsgLoadGameInSlot → mapLoadSaved → mapLoad: with _loadingGame set,
    // every script's start (scriptsExecStartProc), then map_enter_p_proc and
    // map_update_p_proc run for the restored map — the scripts re-apply what they don't
    // save (the Lighting macro's light level …) and skip their setup through
    // is_loading_game; create / destroy / kill / visibility opcodes refuse meanwhile.
    // The map music starts as on any map load (wmMapMusicStart).
    runLoadGameProcs(): void {
        if (!Config.engine.doLoadScripts) return
        Scripting.setLoadingGame(true)
        try {
            for (const level of this.objects) {
                for (const obj of level.slice()) {
                    if (obj._script) Scripting.initScript(obj._script, obj)
                }
            }
            const overridenStartPos = Scripting.enterMap(
                this.mapScript,
                this.getObjectsAndSpatials(),
                this.currentElevation,
                this.mapID,
                false,
            )
            if (overridenStartPos && this.mapObj.levels[overridenStartPos.elevation]) {
                globalState.player.position = overridenStartPos.position
                globalState.player.orientation = overridenStartPos.orientation
            }
            this.objects.forEach((level) => {
                for (const obj of level.slice()) {
                    if (level.includes(obj)) obj.enterMap()
                }
            })
            this.spatials.forEach((level) =>
                level.forEach((spatial) => Scripting.objectEnterMap(spatial, this.currentElevation, this.mapID)),
            )
            Scripting.updateMap(this.mapScript, this.getObjectsAndSpatials(), this.currentElevation)
        } finally {
            Scripting.setLoadingGame(false)
        }
        this.playMapMusic()
    }

    doEnterNewMap(isFirstRun: boolean): void {
        // Tell scripts they've entered the new map

        const objectsAndSpatials = this.getObjectsAndSpatials()
        const overridenStartPos = Scripting.enterMap(
            this.mapScript,
            objectsAndSpatials,
            this.currentElevation,
            this.mapID,
            isFirstRun,
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
                dbgWarn(
                    'map',
                    `override_map_start: elevation ${newElev} out of bounds (map has ${this.numLevels} levels), ignoring`,
                )
            }
        }

        // place party again, so if the map script overrided the start position we're in the right place
        this.placeParty()

        Scripting.startMapScripts(this.mapScript, this.spatials.flat(), this.objects.flat())

        // Tell objects' scripts that they're now on the map. CE ref: scripts.cc
        // scriptsExecMapUpdateScripts builds the script list first and skips scripts
        // removed meanwhile — map_enter procs create and destroy objects, and a live
        // forEach would skip the entries shifted down by a removal.
        // TODO: Does this apply to all levels or just the current elevation?
        this.objects.forEach((level) => {
            for (const obj of level.slice()) {
                if (level.includes(obj)) obj.enterMap()
            }
        })
        this.spatials.forEach((level) =>
            level.forEach((spatial) => Scripting.objectEnterMap(spatial, this.currentElevation, this.mapID)),
        )

        Scripting.updateMap(this.mapScript, objectsAndSpatials, this.currentElevation)
    }

    /** @internal — used by mapLoader.ts via the prototype. */
    playMapMusic(): void {
        // The startup map DH2 loads behind the intro movies and the main menu stays silent:
        // CE has no map loaded there (main.cc), so no map music plays over the movies.
        if (globalState.backgroundMapLoad) return
        const curMapInfo = getCurrentMapInfo()
        dbg('audio', '[Music] curMapInfo:', curMapInfo)
        dbg('audio', '[Music] music field:', curMapInfo?.music)
        globalState.audioEngine.stopAll()
        // CE map.cc mapLoad starts the looping wind2; wmMapMusicStart replaces it only when
        // maps.txt gives the map music, so a map without a music= entry keeps the wind.
        const music = curMapInfo?.music || 'wind2'
        dbg('audio', '[Music] calling playMusic with:', music)
        globalState.audioEngine.playMusic(music)
    }

    objectsAtPosition(position: Point): Obj[] {
        return this.getObjects().filter((obj: Obj) => obj.position.x === position.x && obj.position.y === position.y)
    }

    critterAtPosition(position: Point): Critter | null {
        return (this.objectsAtPosition(position).find((obj) => obj.type === 'critter') as Critter) || null
    }

    // CE object flags (obj_types.h). OBJECT_HIDDEN is 0x01 — DH2 also tracks
    // script-driven hiding as `visible === false` (set_obj_visibility).
    static isHiddenObj(o: Obj): boolean {
        return o.visible === false || (((o as any).flags ?? 0) & 0x01) !== 0
    }

    // CE ref: sfall_opcodes.cc:914-934 BlockType / get_blocking_func — dispatches to one
    // of the per-tile blocking predicates in object.cc:
    //   0 BLOCK  → object.cc:2387 _obj_blocking_at
    //   1 SHOOT  → object.cc:2440 _obj_shoot_blocking_at
    //   2 AI     → object.cc:2496 _obj_ai_blocking_at (stateful: the first critter is
    //              remembered in `aiState.moveBlockObj`; only a second obstacle blocks)
    //   3 SIGHT  → object.cc:2583 _obj_sight_blocking_at
    //   4 SCROLL → CE get_blocking_func's default branch, i.e. _obj_blocking_at
    // (Restored + extended to all 5 types 2026-10-06; the 2-type version was lost in b282cca.)
    blockingObjectAt(
        tile: number,
        elevation: number,
        blockType: number,
        excludeObj?: Obj | null,
        aiState?: { moveBlockObj: Obj | null },
    ): Obj | null {
        if (tile < 0 || tile >= 40000) return null
        const pos = fromTileNum(tile)
        const objs = this.getObjects(elevation)
        const at = (p: Point) => objs.filter((o) => o.position && o.position.x === p.x && o.position.y === p.y)
        const NO_BLOCK = 0x10,
            MULTIHEX = 0x800,
            LIGHT_THRU = 0x20000000,
            SHOOT_THRU = 0x80000000
        const isBlockerType = (o: Obj) => o.type === 'critter' || o.type === 'scenery' || o.type === 'wall'
        const flagsOf = (o: Obj) => ((o as any).flags ?? 0) >>> 0
        const neighbourMultihex = (pred: (o: Obj) => boolean): Obj | null => {
            for (const nb of hexNeighbors(pos)) {
                for (const o of at(nb)) {
                    if ((flagsOf(o) & MULTIHEX) !== 0 && pred(o)) return o
                }
            }
            return null
        }

        if (blockType === 3) {
            for (const o of at(pos)) {
                if (o === excludeObj || GameMap.isHiddenObj(o)) continue
                if ((flagsOf(o) & LIGHT_THRU) !== 0) continue
                if (o.type === 'scenery' || o.type === 'wall') return o
            }
            return null
        }

        if (blockType === 1) {
            const centre = (o: Obj) => {
                const f = flagsOf(o)
                if (o === excludeObj || GameMap.isHiddenObj(o)) return false
                // CE: (flags & NO_BLOCK) == 0 || (flags & SHOOT_THRU) == 0
                if ((f & NO_BLOCK) !== 0 && (f & SHOOT_THRU) !== 0) return false
                // SFALL fix kept by CE: corpses don't block line of fire.
                if (o.type === 'critter') return !(o as Critter).dead
                return o.type === 'scenery' || o.type === 'wall'
            }
            const multihex = (o: Obj) => {
                if (o === excludeObj || GameMap.isHiddenObj(o) || (flagsOf(o) & NO_BLOCK) !== 0) return false
                if (o.type === 'critter') return !(o as Critter).dead
                return o.type === 'scenery' || o.type === 'wall'
            }
            for (const o of at(pos)) if (centre(o)) return o
            return neighbourMultihex(multihex)
        }

        const plain = (o: Obj) =>
            o !== excludeObj && !GameMap.isHiddenObj(o) && (flagsOf(o) & NO_BLOCK) === 0 && isBlockerType(o)

        if (blockType === 2) {
            const state = aiState ?? { moveBlockObj: null }
            const check = (o: Obj): boolean => {
                if (!plain(o)) return false
                if (state.moveBlockObj !== null || o.type !== 'critter') return true
                state.moveBlockObj = o
                return false
            }
            for (const o of at(pos)) if (check(o)) return o
            return neighbourMultihex(check)
        }

        // BLOCK (0) and the SCROLL (4) fallback.
        for (const o of at(pos)) if (plain(o)) return o
        return neighbourMultihex(plain)
    }

    // CE ref: animation.cc _make_straight_path_func + sfall_opcodes.cc:937
    // op_make_straight_path — screen-space Bresenham from source's tile toward `to`,
    // returning the first obstacle reported by blockingObjectAt(). The start tile is
    // checked (excluding `source` itself); the walk stops on reaching `to`'s row/column
    // without testing it. In SHOOT mode (CE a6 == 32) OBJECT_SHOOT_THRU obstacles are
    // ignored. Runs at `source`'s own elevation.
    straightPathBlockingObject(source: Obj, to: Point, blockType: number): Obj | null {
        return this.straightPathObstacle(source, source.position, to, blockType, null)
    }

    // Full CE _make_straight_path_func(obj, from, to, NULL, &obstacle, a6, callback):
    // walks from `from` (not necessarily `source`'s tile) and skips `prev`, the value
    // *obstaclePtr held on entry — combat loops pass the last obstacle so the walk
    // continues past it. Shoot mode (blockType 1 ⇔ CE a6 == 32) ignores SHOOT_THRU.
    straightPathObstacle(source: Obj, from: Point, to: Point, blockType: number, prev: Obj | null): Obj | null {
        const elev = source.elevation
        const shoot = blockType === 1
        const aiState = { moveBlockObj: null as Obj | null }
        const test = (p: Point): Obj | null => {
            const o = this.blockingObjectAt(toTileNum(p), elev, blockType, source, aiState)
            if (o === null || o === prev) return null
            if (shoot && ((((o as any).flags ?? 0) >>> 0) & 0x80000000) !== 0) return null
            return o
        }

        const first = test(from)
        if (first) return first

        const fromSc = hexToScreen(from.x, from.y)
        const toSc = hexToScreen(to.x, to.y)
        let tileX = fromSc.x + 16,
            tileY = fromSc.y + 8
        const toX = toSc.x + 16,
            toY = toSc.y + 8
        const stepX = Math.sign(toX - tileX),
            stepY = Math.sign(toY - tileY)
        const ddx = 2 * Math.abs(toX - tileX),
            ddy = 2 * Math.abs(toY - tileY)
        let prevTile = from

        if (ddx <= ddy) {
            let middle = ddx - ddy / 2
            while (true) {
                const cur = hexFromScreen(tileX, tileY)
                if (tileY === toY) return null
                if (middle >= 0) {
                    tileX += stepX
                    middle -= ddy
                }
                tileY += stepY
                middle += ddx
                if (cur.x !== prevTile.x || cur.y !== prevTile.y) {
                    const o = test(cur)
                    if (o) return o
                    prevTile = cur
                }
            }
        } else {
            let middle = ddy - ddx / 2
            while (true) {
                const cur = hexFromScreen(tileX, tileY)
                if (tileX === toX) return null
                if (middle >= 0) {
                    tileY += stepY
                    middle -= ddx
                }
                tileX += stepX
                middle += ddy
                if (cur.x !== prevTile.x || cur.y !== prevTile.y) {
                    const o = test(cur)
                    if (o) return o
                    prevTile = cur
                }
            }
        }
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
        for (let i = 0; i < line.length; i++) {
            const objs = this.objectsAtPosition(line[i])
            for (const o of objs) {
                const flags = (o as any).flags ?? 0
                if (GameMap.isHiddenObj(o)) continue
                if ((flags & SHOOT_THRU) !== 0) continue
                if ((o as any).type === 'critter' && (o as any).dead) continue
                if (!o.blocks()) continue
                return o
            }
        }
        return null
    }

    // CE animation.cc _make_path → pathfinderFindPath (src/map/pathfinder.ts). The goal
    // tile must be free unless `isGoalBlocking` is false (CE a5); `mover` (default: the
    // player) decides door use and goo cost and doesn't block itself.
    recalcPath(start: Point, goal: Point, isGoalBlocking?: boolean, mover?: Obj) {
        if (
            start.x < 0 ||
            start.x >= HEX_GRID_SIZE ||
            start.y < 0 ||
            start.y >= HEX_GRID_SIZE ||
            goal.x < 0 ||
            goal.x >= HEX_GRID_SIZE ||
            goal.y < 0 ||
            goal.y >= HEX_GRID_SIZE
        ) {
            return []
        }
        return pathfinderFindPathPoints(mover ?? globalState.player ?? null, start, goal, isGoalBlocking !== false)
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
            // The party (player, companions, the car trunk) travels with the player, so
            // it isn't part of the map snapshot — otherwise a revisit restores a second
            // copy next to the one that walked in (CE removes the party before mapSave).
            objects: this.objects.map((level: Obj[]) => {
                const party = new Set<Obj>(globalState.gParty.getPartyMembersAndPlayer())
                return level
                    .filter((obj): obj is Obj => obj !== null && !party.has(obj) && !(obj as any)._transient)
                    .map((obj) => obj.serialize())
            }),
            // FO2-CE ref: map.cc mapSave — spatials persist their LVARs across saves
            spatials: this.spatials
                ? this.spatials.map((level) =>
                      level.map((s: Spatial): SerializedSpatial => ({
                          script: s.script,
                          tileNum: s.tileNum,
                          range: s.range ?? 0,
                          lvars: s._script ? Object.assign({}, s._script.lvars) : undefined,
                      })),
                  )
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
        this.objects = obj.objects.map((level, levelIdx) =>
            level.map((o) => {
                const deserialized = deserializeObj(o)
                deserialized.elevation = levelIdx
                return deserialized
            }),
        )
        this.lastVisitTime = obj.lastVisitTime ?? 0
        // Restore spatials: re-load scripts from names, then reapply saved LVARs.
        // FO2-CE ref: map.cc mapLoad — spatials are always re-initialized from map data
        if (Array.isArray(obj.spatials)) {
            this.spatials = obj.spatials.map((level, elevation) =>
                level.map((s: SerializedSpatial) => {
                    const spatial: Spatial = {
                        script: s.script,
                        tileNum: s.tileNum,
                        range: s.range ?? s.radius ?? 0,
                        elevation,
                        isSpatial: true,
                        position: fromTileNum(s.tileNum),
                    }
                    const scr = Scripting.loadScript(s.script)
                    if (scr) {
                        if (s.lvars) scr.lvars = s.lvars
                        spatial._script = scr
                    }
                    return spatial
                }),
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
