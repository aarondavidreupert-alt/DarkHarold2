// Script opcodes: tiles, movement, map loading and start positions, the world map, movies and the game UI (CE op_tile_num, op_move_to, op_load_map, op_play_gmovie, ...).
// Methods of the Script class (scripting.ts), kept here by topic and installed on its prototype
// there; vmBridge.ts and the Lua prelude call them as before (wiki/code_quality.md Q16).

import type { Script } from '../../scripting.js'
import { Critter, Obj } from '../../object.js'
import * as Endgame from '../../endgame.js'
import { SCRIPT_MOVIE_FLAGS, gameMoviePlay } from '../../gameMovie.js'
import * as Worldmap from '../../worldmap.js'
import { arrayRemove } from '../../util.js'
import { centerCamera } from '../../renderer.js'
import { fromTileNum, toTileNum } from '../../tile.js'
import { getCenterTile } from '../../render/camera.js'
import globalState from '../../globalState.js'
import { hexDistance, hexInDirection, hexNearestNeighbor } from '../../geometry.js'
import { lookupMapName, setMapMusicOverride } from '../../data.js'
import { uiWorldMap } from '../../ui.js'
import {
    currentMapID,
    inMapEnter,
    info,
    isGameObject,
    isSpatial,
    log,
    requestScript,
    scriptingState,
    setGameUiDisabled,
    setGlobalVar,
    startTransitionPrefetch,
    warn,
} from '../../scripting.js'

export const mapOpcodes = {
    // tiles
    tile_distance_objs(this: Script, a: Obj, b: Obj) {
        if (!isSpatial(a) && !isSpatial(b) && (!isGameObject(a) || !isGameObject(b))) {
            warn('tile_distance_objs: ' + a + ' or ' + b + ' are not game objects')
            return null
        }
        // CE opTileDistanceBetweenObjects: 9999 across elevations
        if (!isSpatial(a) && !isSpatial(b) && a.elevation !== b.elevation) return 9999
        return hexDistance(a.position, b.position)
    },
    tile_distance(this: Script, a: number, b: number) {
        if (a === -1 || b === -1) return 9999
        return hexDistance(fromTileNum(a), fromTileNum(b))
    },
    tile_num(this: Script, obj: Obj) {
        if (!isSpatial(obj) && !isGameObject(obj)) {
            warn('tile_num: not a game object: ' + obj, undefined, this)
            return null
        }
        return toTileNum(obj.position)
    },
    tile_contains_pid_obj(this: Script, tile: number, elevation: number, pid: number): any {
        const pos = fromTileNum(tile)
        const objects = globalState.gMap!.getObjects(elevation)
        for (let i = 0; i < objects.length; i++) {
            if (objects[i].position.x === pos.x && objects[i].position.y === pos.y && objects[i].pid === pid) {
                return objects[i]
            }
        }
        return 0 // it's not there
    },
    // CE interpreter_extra.cc tileIsVisible: near the view's centre tile — the tile-number
    // difference within 5 columns (% 200) or 5 rows (/ 200); CE's own loose test, kept
    tile_is_visible(this: Script, tile: number) {
        const c = getCenterTile()
        const d = Math.abs(c.y * 200 + c.x - tile)
        return d % 200 < 5 || Math.trunc(d / 200) < 5 ? 1 : 0
    },
    // CE ref: sfall_opcodes.cc:951 op_obj_blocking_at — first blocking object at
    // (tile, elevation) for block type 0=BLOCK/1=SHOOT/2=AI/3=SIGHT/4=SCROLL
    // (see GameMap.blockingObjectAt); SHOOT drops OBJECT_SHOOT_THRU obstacles.
    obj_blocking_at(this: Script, tile: number, elevation: number, blockingType: number): Obj | null {
        if (!globalState.gMap) return null
        const o = globalState.gMap.blockingObjectAt(tile, elevation, blockingType, null)
        if (o && blockingType === 1 && (((o.flags ?? 0) >>> 0) & 0x80000000) !== 0) return null
        return o
    },
    // CE ref: sfall_opcodes.cc:937 op_make_straight_path — screen-space straight line
    // from obj's tile to dest, returning the first obstacle (animation.cc
    // _make_straight_path_func; see GameMap.straightPathBlockingObject).
    make_straight_path(this: Script, obj: Obj, destTile: number, blockingType: number): Obj | null {
        if (!isGameObject(obj) || !globalState.gMap) return null
        return globalState.gMap.straightPathBlockingObject(obj, fromTileNum(destTile), blockingType)
    },
    tile_num_in_direction(this: Script, tile: number, direction: number, distance: number) {
        if (distance === 0) {
            //warn("tile_num_in_direction: distance=" + distance)
            return -1
        }
        let newTile = hexInDirection(fromTileNum(tile), direction)
        for (
            let i = 0;
            i < distance - 1;
            i++ // repeat for each further distance
        )
            newTile = hexInDirection(newTile, direction)
        return toTileNum(newTile)
    },
    // CE opTileInTileRect: only ul and lr count — lr.x <= x <= ul.x, ul.y <= y <= lr.y, inclusive
    tile_in_tile_rect(this: Script, ul: number, ur: number, ll: number, lr: number, t: number) {
        void ur
        void ll
        const x = t % 200,
            y = Math.trunc(t / 200)
        return x >= lr % 200 && x <= ul % 200 && y >= Math.trunc(ul / 200) && y <= Math.trunc(lr / 200) ? 1 : 0
    },
    // CE opTileContainsObjectWithPid: the objects on that tile of the given elevation
    tile_contains_obj_pid(this: Script, tile: number, elevation: number, pid: number) {
        const p = fromTileNum(tile)
        return globalState
            .gMap!.getObjects(elevation)
            .some((o) => o.pid === pid && o.position?.x === p.x && o.position?.y === p.y)
            ? 1
            : 0
    },
    rotation_to_tile(this: Script, srcTile: number, destTile: number) {
        const src = fromTileNum(srcTile),
            dest = fromTileNum(destTile)
        const hex = hexNearestNeighbor(src, dest)
        if (hex !== null) return hex.direction
        warn('rotation_to_tile: invalid hex: ' + srcTile + ' / ' + destTile)
        return -1 // TODO/XXX: what does this return if invalid?
    },
    move_to(this: Script, obj: Obj, tileNum: number, elevation: number): number {
        if (!isGameObject(obj)) {
            warn('move_to: not a game object: ' + obj)
            return -1
        }
        // CE opMoveTo → objectSetLocation(object, tile, elevation): the object's own
        // elevation decides; a critter leaving its elevation leaves combat; returns the tile
        const isPlayer = obj instanceof Critter && obj.isPlayer
        const fromElevation = isPlayer ? globalState.currentElevation : (obj.elevation ?? globalState.currentElevation)
        if (elevation !== fromElevation) {
            info('move_to: moving to elevation ' + elevation)
            if (isPlayer) globalState.gMap!.changeElevationFaded(elevation, true)
            else {
                const levels: Obj[][] = globalState.gMap!.objects ?? []
                if (levels[fromElevation]) arrayRemove(levels[fromElevation], obj)
                if (levels[elevation] && !levels[elevation].includes(obj)) levels[elevation].push(obj)
                obj.elevation = elevation
                if (obj.type === 'critter' && globalState.inCombat) globalState.combat?.removeCombatant(obj as Critter)
            }
        }
        obj.position = fromTileNum(tileNum)

        if (isPlayer) centerCamera(obj.position)
        return tileNum
    },
    // CE interpreter_extra.cc opSetMapStart — map_set_elevation, tile_set_center and
    // mapSetStart(tile, elevation, rotation).
    set_map_start(this: Script, x: number, y: number, elevation: number, rotation: number) {
        const gMap = globalState.gMap
        if (!gMap) return
        if (elevation !== gMap.currentElevation) gMap.changeElevation(elevation, true)
        centerCamera({ x, y })
        gMap.mapObj.startPosition = { x, y }
        gMap.mapObj.startOrientation = rotation
        gMap.mapObj.startElevation = elevation
    },
    override_map_start(this: Script, x: number, y: number, elevation: number, rotation: number) {
        log('override_map_start', [x, y, elevation, rotation])
        info(`override_map_start: ${x}, ${y} / elevation ${elevation}`)
        // CE opOverrideMapStart moves the dude at once (rotation, location, view centre).
        // In the map script's map_enter_p_proc the map loader places the party from it;
        // anywhere else the player moves now.
        if (inMapEnter) {
            scriptingState.overrideStartPos = { position: { x, y }, orientation: rotation, elevation }
            return
        }
        const player = globalState.player
        if (!player) return
        player.orientation = rotation
        this.move_to(player, 200 * y + x, elevation)
    },
    // game
    load_map(this: Script, map: number | string, startLocation: number) {
        log('load_map', [map, startLocation])
        info('load_map: ' + map)
        // CE interpreter_extra.cc opLoadMap: the entrance goes to GVAR_LOAD_MAP_INDEX (27),
        // which the new map's map_enter_p_proc reads to place the player; a negative
        // map index does nothing.
        // The load is a map transition (mapSetTransition → mapHandleTransition), which
        // puts the worldmap party on the new map's area (wmTeleportToArea).
        // CE mapSetTransition only records it: the main loop changes maps after the
        // script returns and any dialogue has closed (processMapTransition), not
        // in the middle of the running script
        if (typeof map === 'string') {
            setGlobalVar(27, startLocation)
            scriptingState.pendingMapTransition = map.split('.')[0].toLowerCase()
            startTransitionPrefetch(scriptingState.pendingMapTransition)
        } else if (map >= 0) {
            setGlobalVar(27, startLocation)
            scriptingState.pendingMapTransition = map
            startTransitionPrefetch(lookupMapName(map))
        }
    },
    // CE ref: interpreter_extra.cc opMarkAreaKnown — type 0 (town): state
    // CITY_STATE_INVISIBLE (-66) hides it, anything else shows it
    // (wmAreaSetVisibleState force) and sets the visited state (1 known, 2 visited);
    // type 1: wmMapMarkVisited(mapIdx) marks the area containing that map visited.
    mark_area_known(this: Script, areaType: number, areaID: number, state: number) {
        log('mark_area_known', [areaType, areaID, state])
        if (areaType === 0) {
            if (state === -66) {
                Worldmap.setAreaVisible(areaID, false)
            } else {
                Worldmap.setAreaVisible(areaID, true)
                Worldmap.setAreaVisitedState(areaID, state)
            }
        } else if (areaType === 1) {
            // CE wmMapMarkVisited(mapIdx): saved maps mark their area visited
            const name = lookupMapName(areaID)
            if (name) Worldmap.markMapVisited(name)
        }
    },
    wm_area_set_pos(this: Script, area: number, x: number, y: number) {
        // CE ref: worldmap.cc wmAreaSetPos() — updates world-map marker position
        if (!globalState.mapAreas) {
            warn('wm_area_set_pos: mapAreas not loaded')
            return
        }
        const areaKey = String(area)
        if (!globalState.mapAreas[areaKey]) {
            warn('wm_area_set_pos: unknown area ' + area)
            return
        }
        // CE wmAreaSetWorldPos: refused (-1) off the 1400 × 1500 world map
        if (x < 0 || x >= 1400 || y < 0 || y >= 1500) {
            warn(`wm_area_set_pos: ${x}, ${y} is off the map`)
            return
        }
        globalState.mapAreas[areaKey].worldPosition = { x, y }
        Worldmap.updateAreaMarkerPos(areaKey, x, y)
    },
    // CE opWorldmap (0x8108) — scriptsRequestWorldMap
    world_map(this: Script) {
        // CE scriptsRequestWorldMap: in combat _game_user_wants_to_quit = 1 — the fight ends
        if (globalState.inCombat) globalState.combat?.end()
        requestScript('worldMap', () => uiWorldMap()) // CE scriptsRequestWorldMap
    },
    // CE opSetMapMusic (0x80E2) — worldmap.cc wmSetMapMusic: override maps.txt music.
    set_map_music(this: Script, mapIndex: number, music: string) {
        setMapMusicOverride(mapIndex, String(music))
        // … and the current map's music changes at once (backgroundSoundDelete + wmMapMusicStart)
        if (mapIndex === currentMapID) (globalState.gMap as any)?.playMapMusic?.()
    },
    play_gmovie(this: Script, movieID: number) {
        // CE: interpreter_extra.cc:3581 opPlayGameMovie — per-movie flags table,
        // map updates and dialogue disabled while it plays (DH2: the movie sets a
        // modal uiMode, which pauses tickGame). CE blocks the script until the movie
        // ends; DH2's VM can't block, so the script continues behind the modal overlay.
        info('play_gmovie: movie ' + movieID)
        void gameMoviePlay(movieID, SCRIPT_MOVIE_FLAGS[movieID] ?? 0)
    },
    endgame_slideshow(this: Script) {
        // CE: interpreter_extra.cc:opEndgameSlideshow (0x8146) → scriptsRequestEndgame
        info('endgame_slideshow: requested')
        requestScript('endgame', () => {
            Endgame.playSlideshow().catch((e: unknown) => {
                info('endgame_slideshow error: ' + String(e))
            })
        })
    },
    endgame_movie(this: Script) {
        // CE: interpreter_extra.cc:opEndgameMovie (0x8148)
        info('endgame_movie: starting')
        Endgame.playMovie().catch((e: unknown) => {
            info('endgame_movie error: ' + String(e))
        })
    },
    // CE game.cc gameUiDisable / gameUiEnable — in-world input stops (input.ts) and
    // interfaceBarDisable: the bar stays on screen with its buttons and the message
    // log's scroll buttons disabled (new messages still arrive)
    game_ui_disable(this: Script) {
        setGameUiDisabled(true)
    },
    game_ui_enable(this: Script) {
        setGameUiDisabled(false)
    },
    // CE opGameUiIsDisabled (0x8135)
    game_ui_is_disabled(this: Script) {
        return globalState.gameUIDisabled ? 1 : 0
    },
    // CE opMakeDayTime (0x80D1) — an empty function in CE.
    make_daytime(this: Script) {},
}
