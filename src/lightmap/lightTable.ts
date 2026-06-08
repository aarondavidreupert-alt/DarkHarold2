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

// Static light-offset table generation, split out of lightmap.ts.
// See wiki/ts-split-refactor.md → "Per-file split proposals" §15.

import { hexInDirectionDistance } from "../geometry.js"
import globalState from "../globalState.js"
import { fromTileNum, setCenterTile, toTileNum } from "../tile.js"
import { dbg } from "../logger.js"

function zeroArray(arr: any[]) {
    for (var i = 0; i < arr.length; i++)
        arr[i] = 0
}

// Light-propagation offsets indexed by (parity, dir, distance). Filled in by
// obj_light_table_init() on first use. Shared with lightmap.ts (consumed by
// obj_adjust_light).
export const light_offsets = new Array(532)
zeroArray(light_offsets)

// length 36
export const light_distance = [1, 2, 3, 4, 5, 6, 7, 8, 2, 3, 4, 5, 6, 7, 8, 3, 4, 5,
                               6, 7, 8, 4, 5, 6, 7, 8, 5, 6, 7, 8, 6, 7, 8, 7, 8, 8]

let isInit = false

// eax = tile, edx = direction, ebx = distance
function tile_num_in_direction(tileNum: number, dir: number, distance: number): number {
    //console.log("tileNum: " + tileNum + " (" + tileNum.toString(16) + ")")
    if (dir < 0 || dir > 5)
        throw "tile_num_in_direction: dir = " + dir
    if (distance === 0)
        return tileNum

    var hex = hexInDirectionDistance(fromTileNum(tileNum), dir, distance)
    if (!hex) {
        dbg('lighting', "hex (input tile is %s) is %o; dir=%d distance=%d", tileNum.toString(16), hex, dir, distance)
        return -1
    }

    //console.log("tile: %d,%d -> %d,%d", fromTileNum(tileNum).x, fromTileNum(tileNum).y, hex.x, hex.y)
    return toTileNum(hex)
}

export function obj_light_table_init(): void {
    setCenterTile()
    //var centerTile_: Point = getCenterTile()

    // should we use the center tile at all?
    var edi = toTileNum(globalState.centerTile)
    var edx = edi & 1
    var eax = edx*4
    eax -= edx
    eax <<= 5
    edx = eax
    eax <<= 3
    var ecx = 0
    eax += edx

    var v2c = ecx
    var v54 = eax
    var v48
    var ebx, ebp, esi, v3c, v40, v50, v20, v24, lightOffsetsStart, v58
    var v44, v4c, v38, v34, v28, v1c, v28

    do {
        eax = v54
        edx = v2c
        edx++
        v48 = eax
        eax = edx
        edx = eax % 6
        //eax = eax / 6 | 0
        ebp = 0
        esi = 8

        v3c = ebp
        v40 = esi
        v50 = edx

        do {
            ebx = v3c
            edx = v50
            eax = edi
            eax = tile_num_in_direction(eax, edx, ebx) // ?

            esi = ebp*4
            v24 = eax
            eax = v40
            ecx = 0
            v20 = eax
            eax = v48
            edx = v40
            esi += eax

            if (edx > 0) {
                do {
                    edx = v2c
                    eax = v24
                    ecx++
                    esi += 4
                    ebx = ecx
                    ebp++
                    eax = tile_num_in_direction(eax, edx, ebx)
                    eax -= edi
                    ebx = v20
                    //console.log("light_offsets[%d] = %d", (esi-4)/4|0, eax)
                    light_offsets[(esi-4)/4|0] = eax
                }
                while (ecx < ebx)
            }

            eax = v3c
            esi = v40
            eax++
            esi--
            v3c = eax
            v40 = esi
        }
        while (eax < 8)

        ebx = v2c
        ecx = v54
        ebx++
        ecx += 144
        v2c = ebx
        v54 = ecx
    }
    while (ebx < 6)

    // second part
    edi++
    edx = edi
    edx &= 1
    eax = edx*4
    eax -= edx
    eax <<= 5
    edx = eax
    eax <<= 3
    ebp = 0
    eax += edx
    lightOffsetsStart = ebp
    v58 = eax

    do {
        eax = v58
        edx = lightOffsetsStart
        edx++
        v44 = eax
        eax = edx
        edx = eax % 6
        ebp = 0
        v4c = edx
        edx = 8
        v38 = ebp
        v34 = edx

        do {
            ebx = v38
            edx = v4c
            eax = edi
            eax = tile_num_in_direction(eax, edx, ebx)
            esi = ebp*4
            ecx = 0
            ebx = v44
            v28 = eax
            eax = v34
            esi += ebx
            v1c = eax

            if (eax > 0) {
                do {
                    edx = lightOffsetsStart
                    eax = v28
                    ecx++
                    esi += 4
                    ebx = ecx
                    ebp++
                    eax = tile_num_in_direction(eax, edx, ebx)
                    eax -= edi
                    edx = v1c
                    //console.log("light_offsets[%d] = %d", (esi-4)/4|0, eax)
                    light_offsets[(esi-4)/4|0] = eax
                }
                while (ecx < edx)
            }

            ebx = v38
            ecx = v34
            ebx++
            ecx--
            v38 = ebx
            v34 = ecx
        }
        while (ebx < 8)

        eax = lightOffsetsStart
        ebp = v58
        eax++
        ebp += 144
        lightOffsetsStart = eax
        v58 = ebp
    }
    while (eax < 6)
}

// Lazy: initialize the light_offsets table once. Subsequent calls are no-ops.
// obj_adjust_light() in lightmap.ts calls this before reading light_offsets.
// resetLight() calls obj_light_table_init() directly (unconditional re-init),
// matching the pre-split behaviour.
export function ensureLightTableInit(): void {
    if (isInit) return
    dbg('lighting', "initializing light tables")
    obj_light_table_init()
    isInit = true
}
