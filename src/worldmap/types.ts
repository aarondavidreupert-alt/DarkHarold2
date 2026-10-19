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
import { EncounterData } from './encounterData.js'

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
    // CE ref: worldmap.h — wmGenData.isInCar / wmGenData.carFuel (CAR_FUEL_MAX=80000).
    isInCar: boolean
    carFuel: number
}

export interface Worldmap {
    squares: Square[][]
    // CE worldmap.txt random-encounter data (encounterData.ts)
    encounters: EncounterData
    terrainSpeed: { [terrainType: string]: number }
    // CE ref: worldmap.cc:1337 — per-Tile-N `walk_mask_name`, indexed by tile number
    // (0..19, 4 wide x 5 tall). `null` where a tile has no mask (fully walkable).
    walkMaskNames: (string | null)[]
}
