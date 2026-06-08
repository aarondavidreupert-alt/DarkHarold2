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

// World Map system — barrel re-assembling the Worldmap namespace from
// worldmap/{types,parser,Worldmap,encounters}.ts. See
// wiki/ts-split-refactor.md §10.

import {
    EncounterTable as _EncounterTable,
    Encounter as _Encounter,
    EncounterRef as _EncounterRef,
    EncounterGroup as _EncounterGroup,
    EncounterCritter as _EncounterCritter,
    EncounterPosition as _EncounterPosition,
} from './worldmap/types.js'
import * as _WorldmapMod from './worldmap/Worldmap.js'
import * as _Encounters from './worldmap/encounters.js'

export module Worldmap {
    // Re-exported public types.
    export type EncounterTable = _EncounterTable
    export type Encounter = _Encounter
    export type EncounterRef = _EncounterRef
    export type EncounterGroup = _EncounterGroup
    export type EncounterCritter = _EncounterCritter
    export type EncounterPosition = _EncounterPosition

    // DOM lifecycle + travel loop (worldmap/Worldmap.ts).
    export const init = _WorldmapMod.init
    export const start = _WorldmapMod.start
    export const stop = _WorldmapMod.stop
    export const getPlayerWorldPos = _WorldmapMod.getPlayerWorldPos
    export const updateAreaMarkerPos = _WorldmapMod.updateAreaMarkerPos

    // Encounter dispatch (worldmap/encounters.ts).
    export const getEncounterGroup = _Encounters.getEncounterGroup
    export const doEncounter = _Encounters.doEncounter
}
