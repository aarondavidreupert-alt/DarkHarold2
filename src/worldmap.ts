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

import * as _WorldmapMod from './worldmap/Worldmap.js'
import * as _Encounters from './worldmap/encounters.js'

export namespace Worldmap {
    // DOM lifecycle + travel loop (worldmap/Worldmap.ts).
    export const init = _WorldmapMod.init
    export const start = _WorldmapMod.start
    export const stop = _WorldmapMod.stop
    export const getPlayerWorldPos = _WorldmapMod.getPlayerWorldPos
    export const updateAreaMarkerPos = _WorldmapMod.updateAreaMarkerPos
    export const withinArea = _WorldmapMod.withinArea
    export const getWorldmapPlayer = _WorldmapMod.getWorldmapPlayer

    // Car system accessors (worldmap/Worldmap.ts).
    // CE ref: worldmap.cc wmCarGiveToParty / wmCarUseGas / wmCarFillGas / wmCarIsOutOfGas.
    export const CAR_FUEL_MAX = _WorldmapMod.CAR_FUEL_MAX
    export const getIsInCar = _WorldmapMod.getIsInCar
    export const setIsInCar = _WorldmapMod.setIsInCar
    export const getCarFuel = _WorldmapMod.getCarFuel
    export const setCarFuel = _WorldmapMod.setCarFuel
    export const addCarFuel = _WorldmapMod.addCarFuel
    export const fillCarFuel = _WorldmapMod.fillCarFuel
    export const getCarAreaId = _WorldmapMod.getCarAreaId
    export const setCarAreaId = _WorldmapMod.setCarAreaId
    export const setWorldmapGlobalVarHooks = _WorldmapMod.setWorldmapGlobalVarHooks
    export const setAreaVisible = _WorldmapMod.setAreaVisible
    export const setAreaVisitedState = _WorldmapMod.setAreaVisitedState
    export const areaIsKnown = _WorldmapMod.areaIsKnown
    export const markMapVisited = _WorldmapMod.markMapVisited
    export const travelToArea = _WorldmapMod.travelToArea
    export const serializeAreaStates = _WorldmapMod.serializeAreaStates
    export const deserializeAreaStates = _WorldmapMod.deserializeAreaStates
    export const resetWorldmap = _WorldmapMod.resetWorldmap
    export const setPlayerWorldPos = _WorldmapMod.setPlayerWorldPos
    export const updateCarUI = _WorldmapMod.updateCarUI
    export const serializeSquareStates = _WorldmapMod.serializeSquareStates
    export const getCurrentAreaId = _WorldmapMod.getCurrentAreaId
    export const setCurrentAreaId = _WorldmapMod.setCurrentAreaId
    export const areaVisitedState = _WorldmapMod.areaVisitedState
    export const teleportToArea = _WorldmapMod.teleportToArea
    export const revealAll = _WorldmapMod.revealAll
    export const setInstantTravel = _WorldmapMod.setInstantTravel
    export const areaIdContainingMap = _WorldmapMod.areaIdContainingMap
    export const deserializeSquareStates = _WorldmapMod.deserializeSquareStates
    export const subTileVisitedState = _WorldmapMod.subTileVisitedState
    export const markMapEntranceState = _WorldmapMod.markMapEntranceState
    export const markSubTileRadiusVisited = _WorldmapMod.markSubTileRadiusVisited
    export const giveCar = _WorldmapMod.giveCar // console helper (src/devConsole)

    // Random encounters (worldmap/encounters.ts): save / load / new game.
    export type SavedEncounters = _Encounters.SavedEncounters
    export const serializeEncounters = _Encounters.serializeEncounters
    export const deserializeEncounters = _Encounters.deserializeEncounters
    export const resetEncounters = _Encounters.resetEncounters
    export const forceEncounter = _Encounters.forceEncounter
}
