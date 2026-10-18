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

// worldmap.txt line parser — carved out of worldmap.ts. Pure string-in /
// typed-records-out, no game-state dependency. See wiki/ts-split-refactor.md §10.

import { isNumeric, parseIni } from '../util.js'
import { parseEncounterData } from './encounterData.js'
import { Square, Worldmap } from './types.js'
import { NUM_SQUARES_X, NUM_SQUARES_Y, WORLDMAP_UNDISCOVERED } from './Worldmap.js'

export function parseWorldmap(data: string): Worldmap {
    // 20 tiles, 7x6 squares each
    // each tile is 350x300
    // 4 tiles horizontally, 5 vertically

    function parseSquare(data: string): Square {
        // CE wmParseSubTileInfo: terrain, fill, three day-part frequencies, encounter table
        const props = data.split(',').map((x) => x.trim().toLowerCase())

        return {
            terrainType: props[0],
            fillType: props[1],
            // CE ref: worldmap.cc:1956 wmParseSubTileInfo — DAY_PART_COUNT=3 slots
            frequencies: [props[2], props[3] ?? props[2], props[4] ?? props[2]],
            encounterType: props[5],
            difficulty: null,
            state: null,
        }
    }

    // Parse a "key:value, key:value" format
    function parseKeyed(data: string) {
        const items = data.split(',').map((x) => x.trim())
        const out: { [key: string]: string | number } = {}
        for (let i = 0; i < items.length; i++) {
            const s: any = items[i].split(':')
            if (isNumeric(s[1])) s[1] = parseFloat(s[1])
            out[s[0].toLowerCase()] = s[1]
        }
        return out
    }

    const ini: any = parseIni(data)

    const squares: Square[][] = new Array(NUM_SQUARES_X) // (4*7) x (5*6) array (i.e., number of tiles -- 840)
    for (let i = 0; i < NUM_SQUARES_X; i++) squares[i] = new Array(NUM_SQUARES_Y)

    // CE ref: worldmap.cc:1337 — one optional walk_mask_name per [Tile N] section.
    const walkMaskNames: (string | null)[] = []

    // console.log(ini)

    for (const key in ini) {
        const m = key.match(/Tile (\d+)/)
        if (m !== null) {
            const tileNum = parseInt(m[1])
            const tileX = tileNum % 4
            const tileY = Math.floor(tileNum / 4)
            const difficulty = parseInt(ini[key].encounter_difficulty) || 0 // CE default 0

            walkMaskNames[tileNum] = ini[key].walk_mask_name ?? null

            for (const position in ini[key]) {
                const pos = position.match(/(\d)_(\d)/)
                if (pos === null) continue

                const x = tileX * 7 + parseInt(pos[1])
                const y = tileY * 6 + parseInt(pos[2])
                //console.log(tileX + "/" + tileY + " | " + pos[1] + ", " + pos[2] + " -> " + x + ", " + y)

                squares[x][y] = parseSquare(ini[key][position])
                squares[x][y].difficulty = difficulty
                squares[x][y].state = WORLDMAP_UNDISCOVERED
            }
        }
    }

    return {
        squares,
        encounters: parseEncounterData(ini),
        terrainSpeed: parseKeyed(ini.Data.terrain_types) as { [terrainType: string]: number },
        walkMaskNames,
    }
}
