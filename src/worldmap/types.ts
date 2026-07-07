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

// World Map types — pure interface declarations carved out of worldmap.ts.
// See wiki/ts-split-refactor.md §10.

import { Point } from '../geometry.js'
import { Encounters } from '../encounters.js'

export interface Square {
    terrainType: string //"mountain" | "ocean" | "desert" | "city" | "ocean"
    fillType: string //"no_fill" | "fill_w"
    // CE ref: worldmap.cc:1956 — three frequency slots: [0]=morning, [1]=afternoon, [2]=night
    frequencies: string[] // [morning, afternoon, night]
    encounterType: string
    difficulty: number
    state: number // WORLDMAP_UNDISCOVERED etc (TODO: make an enum)
}

export interface WorldmapPlayer {
    x: number
    y: number
    target: Point
}

export interface Worldmap {
    squares: Square[][]
    encounterTables: { [encounterType: string]: EncounterTable }
    encounterGroups: { [groupName: string]: EncounterGroup }
    encounterRates: { [frequency: string]: number }
    terrainSpeed: { [terrainType: string]: number }
}

export interface EncounterTable {
    maps: string[]
    encounters: Encounter[]
}

export interface Encounter {
    chance: number
    scenery: any // TODO: scenery type (string?)
    enc: EncounterRef //enc.enc ? parseEncounterReference(enc.enc) : enc.enc,
    cond: any // TODO: condition type
    condOrig: string | null // Original condition string
    special: string | null
    counter: number // remaining fires: -1=unlimited, 0=depleted, >0=limited
}

export interface EncounterRef {
    type: 'ambush' | 'fighting'
    target?: 'player'
    party: EncounterParty
    firstParty?: EncounterParty
    secondParty?: EncounterParty
}

export interface EncounterParty {
    start: number
    end: number
    name: string
}

export interface EncounterGroup {
    critters: EncounterCritter[]
    position: EncounterPosition
    target?: 'player' | number
}

export interface Range {
    start: number
    end: number
}

export interface EncounterItem {
    range?: Range
    amount?: number

    pid: number
    wielded: boolean
}

export interface EncounterCritter {
    position?: Point
    cond?: Encounters.Node[]
    ratio?: number

    items: EncounterItem[]
    pid: number
    script: number
    dead: boolean
}

export interface EncounterPosition {
    type: string // Formation
    spacing: number
}
