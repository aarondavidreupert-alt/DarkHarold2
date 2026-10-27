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

import { Point } from './geometry.js'
import * as GameTime from './gametime.js'
import { Lightmap } from './lightmap.js'
import { toTileNum } from './tile.js'

// Floor lighting

export namespace Lighting {
    // length 15
    let rightside_up_triangles = [2, 3, 0, 3, 4, 1, 5, 6, 3, 6, 7, 4, 8, 9, 6]
    let upside_down_triangles = [0, 3, 1, 2, 5, 3, 3, 6, 4, 5, 8, 6, 6, 9, 7]

    // length 26
    let rightside_up_table = [
        -1, 0x2, 0x4e, 0x2, 0x4c, 0x6, 0x49, 0x8, 0x47, 0x0a, 0x44, 0x0e, 0x41, 0x10, 0x3f, 0x12, 0x3d, 0x14, 0x3a,
        0x18, 0x37, 0x1a, 0x35, 0x1c, 0x32, 0x20,
    ]

    let upside_down_table = [
        0x0, 0x20, 0x30, 0x20, 0x31, 0x1e, 0x34, 0x1a, 0x37, 0x18, 0x39, 0x16, 0x3c, 0x12, 0x3f, 0x10, 0x41, 0x0e, 0x43,
        0x0c, 0x46, 0x8, 0x49, 0x6, 0x4b, 0x4,
    ]

    // length 40
    export let vertices = [
        0x10, -1, -201, 0x0, 0x30, -2, -2, 0x0, 0x3c0, 0x0, 0x0, 0x0, 0x3e0, 0x0c7, -1, 0x0, 0x400, 0x0c6, 0x0c6, 0x0,
        0x790, 0x0c8, 0x0c8, 0x0, 0x7b0, 0x18f, 0x0c7, 0x0, 0x7d0, 0x18e, 0x18e, 0x0, 0x0b60, 0x190, 0x190, 0x0, 0x0b80,
        0x257, 0x18f, 0x0,
    ]

    // Framebuffer for triangle-lit tiles
    // XXX: what size should this be?
    export let intensity_map = new Array(1024 * 12)

    // zero array
    for (let i = 0; i < intensity_map.length; i++) intensity_map[i] = 0

    // Ambient light level. Defers to the time-of-day curve in gametime.ts
    // (honors any script `set_light_level` override). Kept as a getter so
    // the triangle-lighting path samples a fresh value each frame.
    function getAmbient(): number {
        return GameTime.getAmbientLight()
    }

    // Color look-up table by light intensity
    export const intensityColorTable = (globalThis as unknown as { intensityColorTable: number[] }).intensityColorTable

    export let colorLUT: any = null // string color integer -> palette index
    export let colorRGB: any = null // palette index -> string color integer

    function light_get_tile(tilenum: number): number {
        return Math.min(65536, Lightmap.tile_intensity[tilenum])
    }

    function init(tilenum: number): boolean {
        const start = tilenum & 1 // even/odd
        const ambient = getAmbient()

        for (let i = 0, j = start; i <= 36; i += 4, j += 4) {
            const offset = vertices[1 + j]
            const t = tilenum + offset
            const light = Math.max(light_get_tile(t), ambient)

            vertices[3 + i] = light
        }

        // do a uniformly-lit check
        // true means it's triangle lit

        if (vertices[7] !== vertices[3]) return true

        let uni = 1
        for (let i = 4; i < 36; i += 4) {
            if (vertices[7 + i] === vertices[3 + i]) uni++ //return true
        }

        return uni !== 9
    }

    function renderTris(isRightsideUp: boolean): void {
        const tris = isRightsideUp ? rightside_up_triangles : upside_down_triangles
        const table = isRightsideUp ? rightside_up_table : upside_down_table

        for (let i = 0; i < 15; i += 3) {
            const a = tris[i + 0]
            const b = tris[i + 1]
            const c = tris[i + 2]

            const x = vertices[3 + 4 * a]
            const y = vertices[3 + 4 * b]
            const z = vertices[3 + 4 * c]

            let inc, intensityIdx, baseLight, lightInc

            if (isRightsideUp) {
                // rightside up triangles
                inc = ((x - z) / 13) | 0
                lightInc = ((y - x) / 32) | 0
                intensityIdx = vertices[4 * c]
                baseLight = z
            } else {
                // upside down triangles
                inc = ((y - x) / 13) | 0
                lightInc = ((z - x) / 32) | 0
                intensityIdx = vertices[4 * a]
                baseLight = x
            }

            for (let j = 0; j < 26; j += 2) {
                const edx = table[1 + j]
                intensityIdx += table[j]

                let light = baseLight
                for (let k = 0; k < edx; k++) {
                    if (intensityIdx < 0 || intensityIdx >= intensity_map.length) throw new Error('guard')
                    intensity_map[intensityIdx++] = light
                    light += lightInc
                }

                baseLight += inc
            }
        }
    }

    export function initTile(hex: Point): boolean {
        return init(toTileNum(hex))
    }

    export function computeFrame(): number[] {
        renderTris(true)
        renderTris(false)
        return intensity_map
    }
}
