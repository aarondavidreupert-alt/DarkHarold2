/*
Copyright 2026 DarkHarold2 contributors

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

// Per-map Highwayman parking data (lut/car_parking.json) — kept as its own
// dependency-free module (only data.js + util.js) so both src/map/mapLoader.ts
// and src/worldmap/Worldmap.ts / src/ui_worldmap.ts can use it without a
// circular import (mapLoader.ts already depends on the worldmap barrel).

import { Area } from './data.js'
import { getFileJSON } from './util.js'

// Keys are lowercase map names. -1 = use entrance-offset heuristic.
export interface CarParkingEntry { carTile: number; trunkTile: number }

let _carParkingData: Record<string, CarParkingEntry> | null = null

export function getCarParkingEntry(mapName: string): CarParkingEntry | null {
    if (_carParkingData === null) {
        try {
            _carParkingData = getFileJSON('lut/car_parking.json') ?? {}
        } catch (_) {
            _carParkingData = {}
        }
        // Strip the _doc comment key if present
        delete (_carParkingData as any)['_doc']
    }
    const data = _carParkingData!
    return data[mapName] ?? null
}

// Multi-map towns (e.g. Den = denbus1 + denbus2) only place the Highwayman
// on ONE submap in the original game — confirmed by bytecode extraction
// (wiki/car_system.md §7): denbus2/broken2/newr2's map_enter_p_proc scripts
// contain no car-placement call at all, only denbus1/broken1/newr1 do.
// The worldmap entrance the player actually clicks (or whatever map they're
// standing on when using the giveCar() test helper) can point at any submap
// of an area, though, so parking must not just record whichever one that
// was — otherwise a car "parked in Den" via the denbus2 entrance would
// never render anywhere (denbus2 isn't in lut/car_parking.json and the
// heuristic fallback would place a phantom car there instead). Given an
// area, prefer whichever of its entrance maps has a verified (carTile >= 0)
// lut/car_parking.json entry — that is always the real per-CE placement
// map — and fall back to the originally-clicked map otherwise (unverified
// towns keep today's heuristic-fallback behavior unchanged).
export function resolveCanonicalCarMapName(area: Area, fallbackMapName: string): string {
    for (const entrance of area.entrances) {
        const entry = getCarParkingEntry(entrance.mapName)
        if (entry && entry.carTile >= 0) return entrance.mapName
    }
    return fallbackMapName
}
