/*
Copyright 2015 darkf

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

import globalState from "./globalState.js"
import { Obj } from "./object.js"
import { fromTileNum, toTileNum } from "./tile.js"
import { hexToScreen, worldToHexBarycentric, Point } from "./geometry.js"
import { dbg } from "./logger.js"
import { Config } from "./config.js"
import {
    light_offsets,
    light_distance,
    obj_light_table_init,
    ensureLightTableInit,
} from "./lightmap/lightTable.js"
import { obj_adjust_light_derived } from "./lightmap/lightDerived.js"
import { obj_adjust_light_naive } from "./lightmap/lightNaive.js"

// Generates a lightmap for floor lighting

// You should call obj_light_table_init whenever the tilemap
// changes (such as through elevation change, or map load.)
//
// obj_rebuild_all_light should be called whenever an object
// moves or the tilemap changes.
//
// Per wiki/ts-split-refactor.md §15, the static table generation
// (light_offsets, light_distance, obj_light_table_init,
// tile_num_in_direction, the isInit flag) lives in lightmap/lightTable.ts.

export module Lightmap {
    function light_reset(): void {
        tile_intensity.fill(655)
    }

    // Tile lightmap (Int32Array for fast .set() bulk copy)
    export var tile_intensity = new Int32Array(40000)
    light_reset()

    // Static (non-critter) light bake — populated by bakeStaticLight()
    export var staticTileIntensity = new Int32Array(40000)

    function light_subtract_from_tile(tileNum: number, intensity: number) {
        tile_intensity[tileNum] -= intensity
    }

    function light_add_to_tile(tileNum: number, intensity: number) {
        tile_intensity[tileNum] += intensity
    }

    function zeroArray(arr: any[]) {
        for(var i = 0; i < arr.length; i++)
            arr[i] = 0
    }

    // obj_adjust_light(eax=obj_ptr, ebx=0, edx=0)
    // edx controls whether light is added or subtracted

    // posOverride: stamp the cone at this hex instead of obj.position (used by the
    //   smooth moving-light modes to place the source at a fractional/animated tile).
    // scale: multiply every applied intensity by this (0..1) so a light can be split
    //   across several tiles that sum to the full cone. Both default to no-op.
    function obj_adjust_light(obj: Obj, isSub: boolean=false, posOverride: Point | null = null, scale: number = 1): void {
        // CE ref: object.cc:3969 bails if lightIntensity <= 0; 3973 bails if OBJECT_HIDDEN;
        // 3977 bails if OBJECT_LIGHTING flag absent. DH2 uses 655 as ambient baseline and
        // visible===false as the hidden-flag equivalent; OBJECT_LIGHTING is modelled as
        // lightRadius > 0 && lightIntensity > 655.
        if (obj.visible === false) return
        if (obj.lightRadius <= 0 || obj.lightIntensity <= 655) return

        const baseModifier = isSub ? light_subtract_from_tile : light_add_to_tile
        // Scale the APPLIED amount (not obj.lightIntensity — that would distort the
        // cone via the −655 falloff term); this keeps the cone shape and scales its
        // amplitude, so weighted stamps sum linearly. §player-light-smooth.
        var lightModifier = scale === 1
            ? baseModifier
            : (tile: number, amount: number) => baseModifier(tile, Math.round(amount * scale))

        if (Config.engine.lightPropagationMode === 'derived') {
            obj_adjust_light_derived(obj, lightModifier)
            return
        }

        if (Config.engine.lightPropagationMode === 'naive') {
            obj_adjust_light_naive(obj, lightModifier)
            return
        }

        var pos = posOverride ?? obj.position

        const srcTile = toTileNum(pos)
        if (srcTile < 0 || srcTile >= 40000) return   // off-grid override → skip
        lightModifier(srcTile, obj.lightIntensity)

        obj.lightIntensity = Math.min(obj.lightIntensity, 65536)

        ensureLightTableInit()

        var edx: any, eax
        edx = (pos.x%2)*3 * 32
        eax = edx*9
        //var lightOffsetsStart = light_offsets + eax // so &light_offsets[eax/4|0], we'd use an index here
        var lightOffsetsStart = eax // starting offset into light_offsets

        var light_per_dist = /* obj.lightIntensity - */ (((obj.lightIntensity - 655) / (obj.lightRadius+1)) | 0)

        //console.log("light per dist: %d", light_per_dist)

        var stackArray = new Array(36)
        var light = obj.lightIntensity

        light -= light_per_dist
        stackArray[0] = light

        light -= light_per_dist
        stackArray[4/4|0] = light
        stackArray[32/4|0] = light

        light -= light_per_dist
        stackArray[8/4|0] = light
        stackArray[36/4|0] = light
        stackArray[60/4|0] = light

        light -= light_per_dist
        stackArray[12/4|0] = light
        stackArray[40/4|0] = light
        stackArray[64/4|0] = light
        stackArray[84/4|0] = light

        light -= light_per_dist
        stackArray[16/4|0] = light
        stackArray[44/4|0] = light
        stackArray[68/4|0] = light
        stackArray[88/4|0] = light
        stackArray[104/4|0] = light

        light -= light_per_dist
        stackArray[20/4|0] = light
        stackArray[48/4|0] = light
        stackArray[72/4|0] = light
        stackArray[92/4|0] = light
        stackArray[108/4|0] = light
        stackArray[120/4|0] = light

        light -= light_per_dist
        stackArray[24/4|0] = light
        stackArray[52/4|0] = light
        stackArray[76/4|0] = light
        stackArray[96/4|0] = light
        stackArray[112/4|0] = light
        stackArray[124/4|0] = light
        stackArray[132/4|0] = light

        light -= light_per_dist
        stackArray[28/4|0] = light
        stackArray[56/4|0] = light
        stackArray[80/4|0] = light
        stackArray[100/4|0] = light
        stackArray[116/4|0] = light
        stackArray[128/4|0] = light
        stackArray[136/4|0] = light
        stackArray[140/4|0] = light

        var _light_blocked = new Array(36*6) // XXX: Is this the exact size?

        // zero arrays
        zeroArray(_light_blocked)

        var isLightBlocked // var_C

        function light_blocked(index: number) {
            return _light_blocked[index];
        }

        for(var i = 0; i < 36; i++) {
            if(obj.lightRadius >= light_distance[i]) {
                var v26, v27, v28, v29, v30, v31, v32, v33, v34 // temporaries

                for(var dir = 0; dir < 6; dir++) {
                    var nextDir = (dir + 1) % 6

                    switch(i) {
                        case 0:
                          isLightBlocked = 0;
                          break;
                        case 1:
                          isLightBlocked = light_blocked(36 * dir);
                          break
                        case 2:
                          isLightBlocked = light_blocked(36 * dir + 1);
                          break
                        case 3:
                          isLightBlocked = light_blocked(36 * dir + 2);
                          break
                        case 4:
                          isLightBlocked = light_blocked(36 * dir + 3);
                          break
                        case 5:
                          isLightBlocked = light_blocked(36 * dir + 4);
                          break
                        case 6:
                          isLightBlocked = light_blocked(36 * dir + 5);
                          break
                        case 7:
                          isLightBlocked = light_blocked(36 * dir + 6);
                          break
                        case 8:
                          isLightBlocked = light_blocked(36 * nextDir) & light_blocked(36 * dir);
                          break
                        case 9:
                          isLightBlocked = light_blocked(36 * dir + 1) & light_blocked(36 * dir + 8);
                          break
                        case 10:
                          isLightBlocked = light_blocked(36 * dir + 2) & light_blocked(36 * dir + 9);
                          break
                        case 11:
                          isLightBlocked = light_blocked(36 * dir + 3) & light_blocked(36 * dir + 10);
                          break
                        case 12:
                          isLightBlocked = light_blocked(36 * dir + 4) & light_blocked(36 * dir + 11);
                          break
                        case 13:
                          isLightBlocked = light_blocked(36 * dir + 5) & light_blocked(36 * dir + 12);
                          break
                        case 14:
                          isLightBlocked = light_blocked(36 * dir + 6) & light_blocked(36 * dir + 13);
                          break
                        case 15:
                          isLightBlocked = light_blocked(36 * nextDir + 1) & light_blocked(36 * dir + 8);
                          break
                        case 16:
                          isLightBlocked = light_blocked(36 * dir + 15) & light_blocked(36 * dir + 9) | light_blocked(36 * dir + 8);
                          break;
                        case 17:
                          v26 = light_blocked(36 * dir + 10) | light_blocked(36 * dir + 9);
                          isLightBlocked = light_blocked(36 * dir + 9) & (light_blocked(36 * dir + 15) | light_blocked(36 * dir + 10)) | light_blocked(36 * dir + 16) & v26 | v26 & light_blocked(36 * dir + 8);
                          break;
                        case 18:
                          isLightBlocked = (light_blocked(36 * dir + 11) | light_blocked(36 * dir + 10) | light_blocked(36 * dir + 9) | light_blocked(36 * dir)) & light_blocked(36 * dir + 17) | light_blocked(36 * dir + 9) | light_blocked(36 * dir + 16) & light_blocked(36 * dir + 10);
                          break;
                        case 19:
                          isLightBlocked = light_blocked(36 * dir + 18) & light_blocked(36 * dir + 12) | light_blocked(36 * dir + 10) | light_blocked(36 * dir + 9) | (light_blocked(36 * dir + 18) | light_blocked(36 * dir + 17)) & light_blocked(36 * dir + 11);
                          break;
                        case 20:
                          v27 = light_blocked(36 * dir + 12) | light_blocked(36 * dir + 11) | light_blocked(36 * dir + 2);
                          isLightBlocked = (light_blocked(36 * dir + 19) | light_blocked(36 * dir + 18) | light_blocked(36 * dir + 17) | light_blocked(36 * dir + 16)) & light_blocked(36 * dir + 11) | v27 & light_blocked(36 * dir + 8) | light_blocked(36 * dir + 9) & v27 | light_blocked(36 * dir + 10);
                          break;
                        case 21:
                          isLightBlocked = light_blocked(36 * nextDir + 2) & light_blocked(36 * dir + 15) | light_blocked(36 * dir + 8) & light_blocked(36 * nextDir + 1);
                          break;
                        case 22:
                          isLightBlocked = (light_blocked(36 * dir + 21) | light_blocked(36 * dir + 15)) & light_blocked(36 * dir + 16) | light_blocked(36 * dir + 15) & (light_blocked(36 * dir + 21) | light_blocked(36 * dir + 9)) | (light_blocked(36 * dir + 21) | light_blocked(36 * dir + 15) | light_blocked(36 * nextDir + 1)) & light_blocked(36 * dir + 8);
                          break;
                        case 23:
                          isLightBlocked = light_blocked(36 * dir + 22) & light_blocked(36 * dir + 17) | light_blocked(36 * dir + 15) & light_blocked(36 * dir + 9) | light_blocked(36 * dir + 3) | light_blocked(36 * dir + 16);
                          break;
                        case 24:
                          v28 = light_blocked(36 * dir + 23);
                          isLightBlocked = v28 & light_blocked(36 * dir + 18) | light_blocked(36 * dir + 17) & (v28 | light_blocked(36 * dir + 22) | light_blocked(36 * dir + 15)) | light_blocked(36 * dir + 8) | light_blocked(36 * dir + 9) & (light_blocked(36 * dir + 23) | light_blocked(36 * dir + 16) | light_blocked(36 * dir + 15)) | (light_blocked(36 * dir + 18) | light_blocked(36 * dir + 17) | light_blocked(36 * dir + 10) | light_blocked(36 * dir + 9) | light_blocked(36 * dir)) & light_blocked(36 * dir + 16);
                          break;
                        case 25:
                          v29 = light_blocked(36 * dir + 16) | light_blocked(36 * dir + 8);
                          isLightBlocked = light_blocked(36 * dir + 24) & (light_blocked(36 * dir + 19) | light_blocked(36 * dir)) | light_blocked(36 * dir + 18) & (light_blocked(36 * dir + 24) | light_blocked(36 * dir + 23) | v29) | light_blocked(36 * dir + 17) | light_blocked(36 * dir + 10) & (light_blocked(36 * dir + 24) | v29 | light_blocked(36 * dir + 17)) | light_blocked(36 * dir + 1) & light_blocked(36 * dir + 8) | (light_blocked(36 * dir + 24) | light_blocked(36 * dir + 23) | light_blocked(36 * dir + 16) | light_blocked(36 * dir + 15) | light_blocked(36 * dir + 8)) & light_blocked(36 * dir + 9);
                          break;
                        case 26:
                          isLightBlocked = light_blocked(36 * nextDir + 3) & light_blocked(36 * dir + 21) | light_blocked(36 * dir + 8) & light_blocked(36 * nextDir + 1) | light_blocked(36 * nextDir + 2) & light_blocked(36 * dir + 15);
                          break
                        case 27:
                          isLightBlocked = light_blocked(36 * dir + 21) & (light_blocked(36 * dir + 16) | light_blocked(36 * dir + 8)) | light_blocked(36 * dir + 15) | light_blocked(36 * nextDir + 1) & light_blocked(36 * dir + 8) | (light_blocked(36 * dir + 26) | light_blocked(36 * dir + 21) | light_blocked(36 * dir + 15) | light_blocked(36 * nextDir)) & light_blocked(36 * dir + 22);
                          break;
                        case 28:
                          isLightBlocked = light_blocked(36 * dir + 27) & light_blocked(36 * dir + 23) | light_blocked(36 * dir + 22) & (light_blocked(36 * dir + 23) | light_blocked(36 * dir + 17) | light_blocked(36 * dir + 9)) | light_blocked(36 * dir + 16) & (light_blocked(36 * dir + 27) | light_blocked(36 * dir + 22) | light_blocked(36 * dir + 21) | light_blocked(36 * nextDir)) | light_blocked(36 * dir + 8) | light_blocked(36 * dir + 15) & (light_blocked(36 * dir + 23) | light_blocked(36 * dir + 16) | light_blocked(36 * dir + 9));
                          break;
                        case 29:
                          isLightBlocked = light_blocked(36 * dir + 28) & light_blocked(36 * dir + 24) | light_blocked(36 * dir + 22) & light_blocked(36 * dir + 17) | light_blocked(36 * dir + 15) & light_blocked(36 * dir + 9) | light_blocked(36 * dir + 16) | light_blocked(36 * dir + 8) | light_blocked(36 * dir + 23);
                          break;
                        case 30:
                          isLightBlocked = light_blocked(36 * nextDir + 4) & light_blocked(36 * dir + 26) | light_blocked(36 * nextDir + 2) & light_blocked(36 * dir + 15) | light_blocked(36 * dir + 8) & light_blocked(36 * nextDir + 1) | light_blocked(36 * nextDir + 3) & light_blocked(36 * dir + 21);
                          break;
                        case 31:
                          isLightBlocked = light_blocked(36 * dir + 30) & light_blocked(36 * dir + 27) | light_blocked(36 * dir + 26) & (light_blocked(36 * dir + 27) | light_blocked(36 * dir + 22) | light_blocked(36 * dir + 8)) | light_blocked(36 * dir + 15) | light_blocked(36 * nextDir + 1) & light_blocked(36 * dir + 8) | light_blocked(36 * dir + 21);
                          break;
                        case 32:
                          // XXX: v30 here could be lightOffsetsStart, but that is unlikely
                          v30 = light_blocked(36 * nextDir + 1) & light_blocked(36 * dir + 8) | (light_blocked(36 * dir + 28) | light_blocked(36 * dir + 23) | light_blocked(36 * dir + 16) | light_blocked(36 * dir + 9) | light_blocked(36 * dir + 8)) & light_blocked(36 * dir + 15);
                          v31 = light_blocked(36 * dir + 16) | light_blocked(36 * dir + 8);
                          isLightBlocked = light_blocked(36 * dir + 28) & (light_blocked(36 * dir + 31) | light_blocked(36 * dir)) | light_blocked(36 * dir + 27) & (light_blocked(36 * dir + 28) | light_blocked(36 * dir + 23) | v31) | light_blocked(36 * dir + 22) | v30 | light_blocked(36 * dir + 21) & (v31 | light_blocked(36 * dir + 28));
                          break;
                        case 33:
                          v32 = 36 * nextDir;
                          isLightBlocked = light_blocked(v32 + 5) & light_blocked(36 * dir + 30) | light_blocked(v32 + 3) & light_blocked(36 * dir + 21) | light_blocked(v32 + 2) & light_blocked(36 * dir + 15) | light_blocked(v32 + 1) & light_blocked(36 * dir + 8) | light_blocked(v32 + 4) & light_blocked(36 * dir + 26);
                          break;
                        case 34:
                          v33 = light_blocked(36 * dir + 30) | light_blocked(36 * dir + 26) | light_blocked(36 * nextDir + 2);
                          isLightBlocked = (light_blocked(36 * dir + 31) | light_blocked(36 * dir + 27) | light_blocked(36 * dir + 22) | light_blocked(36 * dir + 16)) & light_blocked(36 * dir + 26) | light_blocked(36 * dir + 21) | light_blocked(36 * dir + 15) & v33 | v33 & light_blocked(36 * dir + 8);
                          break;
                        case 35:
                          v34 = 36 * nextDir;
                          isLightBlocked = light_blocked(v34 + 6) & light_blocked(36 * dir + 33) | light_blocked(v34 + 4) & light_blocked(36 * dir + 26) | light_blocked(v34 + 3) & light_blocked(36 * dir + 21) | light_blocked(v34 + 2) & light_blocked(36 * dir + 15) | light_blocked(36 * dir + 8) & light_blocked(v34 + 1) | light_blocked(v34 + 5) & light_blocked(36 * dir + 30);
                          break;
                    }

                    if(isLightBlocked === 0) {
                        // loc_4A7500:
                        var nextTile = toTileNum(pos) + light_offsets[(lightOffsetsStart/4|0) + 36 * dir + i]

                        if(nextTile > 0 && nextTile < 40000) { // nextTile is within valid tile range
                            var edi = 1
                            // for each object at position nextTile
                            var objs = globalState.gMap.objectsAtPosition(fromTileNum(nextTile))
                            for(var objsN = 0; objsN < objs.length; objsN++) {
                                var curObj = objs[objsN]
                                if(!curObj.pro) // XXX: why wouldn't an object have pro?
                                    continue

                                // if(curObj+24h & 1 === 0) { continue }
                                if((curObj.flags & 1) !== 0) { // internal flag?
                                    dbg('lighting', "continue (%s)", curObj.flags.toString(16))
                                    continue
                                }

                                // LightThru flag isn't set -> blocked
                                isLightBlocked =  (curObj.flags & 0x20000000 /* LightThru */) ? 0 : 1

                                // ebx = (curObj+20h) & 0x0F000000 >> 24
                                if(curObj.type === "wall") {
                                    //console.log("obj flags: " + curObj.flags.toString(16))
                                    if(!(curObj.flags & 8)) { // Flat flag? (OBJECT_FLAT, object.cc:4553)
                                        // Wall ORIENTATION bits live in the wall proto's extendedFlags
                                        // (flags_ext), NOT the common PRO header `flags`. CE reads
                                        // proto->wall.extendedFlags here (object.cc:4556); DH2 stores
                                        // it at pro.extra.extendedFlags (tools/proto.py readWall) — the
                                        // same field the egg occlusion reads. Reading pro.flags meant
                                        // every wall fell through to the default (else) branch, giving
                                        // the wrong occlusion for W-E walls (light-bleed stripes) while
                                        // NW-SE walls happened to match the default. See wiki/known_bugs
                                        // LD11 / wiki/extended_flags.md §4.
                                        var flags = curObj.pro.extra?.extendedFlags ?? 0
                                        //console.log("wall extendedFlags: " + flags.toString(16))
                                        if(flags & 0x8000000 || flags & 0x40000000) {
                                            if(dir != 4 && dir != 5 && (dir || i >= 8) && (dir != 3 || i <= 15))
                                                edi = 0
                                        }
                                        else if(flags & 0x10000000) {
                                            if(dir && dir != 5)
                                                edi = 0
                                        }
                                        else if(flags & 0x20000000) {
                                            if(dir && dir != 1 && dir != 4 && dir != 5 && (dir != 3 || i <= 15))
                                                edi = 0
                                        }
                                        else if(dir && dir != 1 && (dir != 5 || i <= 7)) {
                                            edi = 0
                                        }
                                    }
                                }
                                // XXX: Is this just an elevation check?
                                /*else { // TODO: check logic
                                    if(edx !== 0) { // XXX: what is edx?
                                        if(dir >= 2) {
                                            if(dir === 3) {
                                                edi = 0
                                            }
                                        }
                                        else if(dir === 1)
                                            edi = 0
                                    }
                                }*/
                            }

                            if(edi !== 0) {
                                var lightAdjustment = stackArray[i]
                                // eax = 0 // should be set to obj+28h, aka elevation (we don't take elevation into account so we don't need this)
                                lightModifier(nextTile, lightAdjustment)

                            }
                        }
                    }

                    _light_blocked[36 * dir + i] = isLightBlocked
                }
            }
        }

    }

    function obj_rebuild_all_light(): void {
        light_reset()

        globalState.gMap.getObjects().forEach(obj => {
            obj_adjust_light(obj, false)
        })
    }

    export function resetLight(): void {
        light_reset()
        obj_light_table_init()
    }

    export function rebuildLight(): void {
        bakeStaticLight()
    }

    // Bake static (non-critter) lighting into staticTileIntensity.
    // Call after map load or elevation change.
    export function bakeStaticLight(): void {
        light_reset()
        globalState.gMap.getObjects().forEach(obj => {
            if (obj.type !== 'critter') {
                obj_adjust_light(obj, false)
            }
        })
        staticTileIntensity.set(tile_intensity)
    }

    // Smooth moving-light: split a walking light-critter's cone across the tiles
    // under its animated position so the lightmap centre tracks the gliding sprite
    // instead of snapping on tile arrival. Returns weighted (hex, weight) stamps
    // summing to ~1, or null to stamp normally (idle / 'ce' mode / not dh2).
    // 'blend'     — 2-tile lerp between the current and next path hex by walk t.
    // 'egg-split' — barycentric split across the tiles under the animated foot
    //               (hexToScreen(position) + shift), tracking the sprite exactly.
    function playerLightSplits(obj: Obj): { x: number; y: number; w: number }[] | null {
        const mode = Config.engine.playerLightSmooth ?? 'ce'
        if (mode === 'ce') return null
        if (Config.engine.lightPropagationMode !== 'dh2') return null   // dh2-only
        const c = obj as any   // Critter (has getWalkLerp / shift)
        if (mode === 'blend') {
            const wl = typeof c.getWalkLerp === 'function' ? c.getWalkLerp() : null
            if (!wl) return null
            return [
                { x: wl.hexA.x, y: wl.hexA.y, w: 1 - wl.t },
                { x: wl.hexB.x, y: wl.hexB.y, w: wl.t },
            ]
        }
        // egg-split: animated foot world pos → barycentric split. Needs a walk shift;
        // when idle (shift null) the point is the tile centre → single stamp → == ce.
        const shift: Point | null = c.shift ?? null
        if (!shift) return null
        const scr = hexToScreen(obj.position.x, obj.position.y)
        return worldToHexBarycentric(scr.x + shift.x, scr.y + shift.y)
    }

    // Rebuild dynamic (critter) lighting on top of the static bake.
    // Call once per render frame before drawing the lit floor.
    export function rebuildDynamicLight(): void {
        tile_intensity.set(staticTileIntensity)
        for (const obj of globalState.gMap.getObjects()) {
            if (obj.type === 'critter' && obj.lightRadius > 0) {
                const splits = playerLightSplits(obj)
                if (splits) {
                    for (const s of splits) obj_adjust_light(obj, false, { x: s.x, y: s.y }, s.w)
                } else {
                    obj_adjust_light(obj, false)
                }
            }
        }
    }

    // Debug helper for lightingDebug() (src/main.ts) — fully rebakes the
    // current map's lighting under each propagation mode in turn and
    // returns both resulting tile_intensity snapshots, then restores the
    // mode and lighting that were active before the call. Not used by the
    // normal render loop.
    export function compareLightingModes(): { dh2: Int32Array; derived: Int32Array; naive: Int32Array } {
        const originalMode = Config.engine.lightPropagationMode

        Config.engine.lightPropagationMode = 'dh2'
        bakeStaticLight()
        rebuildDynamicLight()
        const dh2Result = tile_intensity.slice()

        Config.engine.lightPropagationMode = 'derived'
        bakeStaticLight()
        rebuildDynamicLight()
        const derivedResult = tile_intensity.slice()

        Config.engine.lightPropagationMode = 'naive'
        bakeStaticLight()
        rebuildDynamicLight()
        const naiveResult = tile_intensity.slice()

        Config.engine.lightPropagationMode = originalMode
        bakeStaticLight()
        rebuildDynamicLight()

        return { dh2: dh2Result, derived: derivedResult, naive: naiveResult }
    }
}
