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

import { Encounters } from '../encounters.js'
import { isNumeric, parseIni } from '../util.js'
import {
    Encounter,
    EncounterGroup,
    EncounterItem,
    EncounterTable,
    Square,
    Worldmap,
} from './types.js'
import { NUM_SQUARES_X, NUM_SQUARES_Y, WORLDMAP_UNDISCOVERED } from './Worldmap.js'

export function parseWorldmap(data: string): Worldmap {
    // 20 tiles, 7x6 squares each
    // each tile is 350x300
    // 4 tiles horizontally, 5 vertically

    function parseSquare(data: string): Square {
        const props = data.split(',').map((x) => x.toLowerCase())

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

    function parseEncounterReference(data: string): any {
        // "(4-8) ncr_masters_army ambush player"
        if (data === 'special1') return { type: 'special' }

        const party = '(?:\\((\\d+)-(\\d+)\\) ([a-z0-9_]+))'
        const re = party + ' ?(?:(ambush player)|(fighting) ' + party + ')?'
        const m = data.match(new RegExp(re))
        if (!m) throw Error('Error parsing encounter reference')
        //console.log("%o %o", re, data)

        const firstParty = { start: parseInt(m[1]), end: parseInt(m[2]), name: m[3] }

        if (m[4] === 'ambush player') {
            return { type: 'ambush', target: 'player', party: firstParty }
        } else {
            return {
                type: 'fighting',
                firstParty: firstParty,
                secondParty: {
                    start: parseInt(m[6]),
                    end: parseInt(m[7]),
                    name: m[8],
                },
            }
        }
    }

    function parseEncounter(data: string): Encounter {
        const s = data.trim().split(',')
        const enc: any = {}
        let isSpecial = false
        let i = 0

        for (; i < s.length; i++) {
            const kv = s[i].split(':')
            if (kv.length === 2) enc[kv[0].toLowerCase()] = kv[1].toLowerCase()
            if (s[i].toLowerCase().trim() === 'special') isSpecial = true
        }

        let cond: string | null = s[i - 1].toLowerCase().trim()
        if (cond.indexOf('if') !== 0)
            // conditions start with "if"
            cond = null

        return {
            chance: parseInt(enc.chance), // integeral percentage
            scenery: enc.scenery,
            enc: enc.enc ? parseEncounterReference(enc.enc) : enc.enc,
            cond: cond ? Encounters.parseConds(cond) : null,
            special: isSpecial ? enc.map : null,
            condOrig: cond,
            // CE ref: worldmap.cc:1438 — counter:-1=unlimited, 0=depleted, >0=limited
            counter: enc.counter !== undefined ? parseInt(enc.counter) : -1,
        }
    }

    function parseEncounterItem(data: string) {
        // an item, e.g. Item:7(wielded), Item:(0-10)41
        const m = data.match(/(?:\((\d+)-(\d+)\))?(\d+)(?:\((wielded)\))?/)

        let range = null
        if (m[1] !== undefined) range = { start: parseInt(m[1]), end: parseInt(m[2]) }

        const item = { range: range, pid: parseInt(m[3]), wielded: m[4] !== undefined }

        return item
    }

    function parseEncounterCritter(data: string) {
        const s = data.trim().split(',')
        const enc: any = {}
        const items: EncounterItem[] = []
        let i = 0

        for (; i < s.length; i++) {
            const kv = s[i].split(':').map((x) => x.toLowerCase().trim())
            if (kv[0] === 'item') {
                items.push(parseEncounterItem(kv[1]))
            } else if (kv.length === 2) enc[kv[0]] = kv[1]
        }

        const isDead = s[0] === 'dead'

        let cond = s[i - 1].toLowerCase().trim()
        if (cond.indexOf('if') !== 0)
            // conditions start with "if"
            cond = null

        return {
            ratio: enc.ratio ? parseInt(enc.ratio) : null,
            pid: enc.pid ? parseInt(enc.pid) : null,
            script: enc.script ? parseInt(enc.script) : null,
            items: items,
            dead: isDead,
            cond: cond ? Encounters.parseConds(cond) : null,
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
    const encounterTables: { [name: string]: EncounterTable } = {}
    const encounterGroups: { [groupName: string]: EncounterGroup } = {}

    const squares: Square[][] = new Array(NUM_SQUARES_X) // (4*7) x (5*6) array (i.e., number of tiles -- 840)
    for (let i = 0; i < NUM_SQUARES_X; i++) squares[i] = new Array(NUM_SQUARES_Y)

    // console.log(ini)

    for (const key in ini) {
        const m = key.match(/Tile (\d+)/)
        if (m !== null) {
            const tileNum = parseInt(m[1])
            const tileX = tileNum % 4
            const tileY = Math.floor(tileNum / 4)
            const difficulty = parseInt(ini[key].encounter_difficulty)

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
        } else if (key.indexOf('Encounter Table') === 0) {
            const name = ini[key].lookup_name.toLowerCase()
            const maps = ini[key].maps.split(',').map((x: string) => x.trim())
            const encounter: EncounterTable = { maps: maps, encounters: [] }

            for (const prop in ini[key]) {
                if (prop.indexOf('enc_') === 0) {
                    encounter.encounters.push(parseEncounter(ini[key][prop]))
                }
            }
            encounterTables[name] = encounter
        } else if (key.indexOf('Encounter:') === 0) {
            const groupName = key.slice('Encounter: '.length).toLowerCase()
            let position = null

            if (ini[key].position !== undefined) {
                const position_ = ini[key].position.split(',').map((x: string) => x.trim().toLowerCase())
                position = { type: position_[0], spacing: 3 } // TODO: verify defaults (3 spacing?)
            } else {
                // default
                position = { type: 'surrounding', spacing: 5 } // TODO: What is distance: "Player(Perception)" ?
            }

            const group: EncounterGroup = { critters: [], position: position }
            for (const prop in ini[key]) {
                if (prop.indexOf('type_') === 0) {
                    group.critters.push(parseEncounterCritter(ini[key][prop]))
                }
            }
            encounterGroups[groupName] = group
        }
    }

    const encounterRates: { [frequency: string]: number } = {}
    for (const key in ini.Data) {
        encounterRates[key.toLowerCase()] = parseInt(ini.Data[key])
    }

    // console.log(squares)
    // console.log(encounterTables)
    // console.log(encounterGroups)

    return {
        squares,
        encounterTables,
        encounterGroups,
        encounterRates,
        terrainSpeed: parseKeyed(ini.Data.terrain_types) as { [terrainType: string]: number },
    }
}
