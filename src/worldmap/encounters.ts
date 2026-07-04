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

// Worldmap encounter dispatch — carved out of worldmap.ts. Reads module
// state from Worldmap.ts via accessors, delegates the heavy lifting
// (evalEncounter, positionCritters) to encounters/resolver.ts via the
// encounters.ts barrel. See wiki/ts-split-refactor.md §10.

import { Combat } from '../combat.js'
import { lookupMapFromLookup } from '../data.js'
import { Encounters } from '../encounters.js'
import * as GameTime from '../gametime.js'
import globalState from '../globalState.js'
import { Critter, WeaponObj, createObjectWithPID } from '../object.js'
import { getRandomInt } from '../util.js'
import { Config } from '../config.js'
import { dbg } from '../logger.js'
import { EncounterGroup, EncounterTable } from './types.js'
import { getWorldmap, getWorldmapPlayer, positionToSquare } from './Worldmap.js'

export function getEncounterGroup(groupName: string): EncounterGroup {
    return getWorldmap().encounterGroups[groupName]
}

export function execEncounter(encTable: EncounterTable): void {
    const enc = Encounters.evalEncounter(encTable)
    dbg('worldmap', 'final: map %s, groups %o', enc.mapName, enc.groups)

    // load map
    globalState.gMap.loadMap(enc.mapName, undefined, undefined, function () {
        // set up critters' positions in their formations
        Encounters.positionCritters(enc.groups, globalState.player.position, lookupMapFromLookup(enc.mapLookupName))

        enc.groups.forEach(function (group) {
            // CE ref: worldmap.cc wmSetupCritterObjs — group.target='player' means
            // these critters are hostile to the player (enemies in the encounter).
            const isHostileToPlayer = group.target === 'player'

            group.critters.forEach(function (critter) {
                //console.log("critter: %o", critter)
                const obj = createObjectWithPID(critter.pid, critter.script ? critter.script : undefined)

                // CE ref: encounter.cc — add encounter items to critter inventory,
                // then equip wielded weapon into leftHand slot (overrides fist default).
                if (obj instanceof Critter && critter.items.length > 0) {
                    for (const encItem of critter.items) {
                        const itemObj = createObjectWithPID(encItem.pid)
                        obj.addInventoryItem(itemObj, encItem.amount ?? 1)
                        if (encItem.wielded && itemObj instanceof WeaponObj && itemObj.weapon !== null) {
                            // addInventoryItem clones into inventory; get that reference
                            const invRef = obj.inventory[obj.inventory.length - 1] as WeaponObj
                            if (invRef instanceof WeaponObj) obj.leftHand = invRef
                        }
                    }
                    obj.art = obj.getAnimation('idle')
                }

                if (obj instanceof Critter && isHostileToPlayer) {
                    obj.hostile = true
                }

                globalState.gMap.addObject(obj)
                obj.move(critter.position)
            })
        })

        // player was ambushed, so begin combat
        if (enc.encounterType === 'ambush' && Config.engine.doCombat === true) Combat.start()
    })
}

export function doEncounter(): void {
    const worldmap = getWorldmap()
    const worldmapPlayer = getWorldmapPlayer()
    const squarePos = positionToSquare(worldmapPlayer)
    const square = worldmap.squares[squarePos.x][squarePos.y]
    const encTable = worldmap.encounterTables[square.encounterType]

    dbg('worldmap', 'enc table: %s -> %o', square.encounterType, encTable)
    execEncounter(encTable)
}

export function didEncounter(): boolean {
    const worldmap = getWorldmap()
    const worldmapPlayer = getWorldmapPlayer()
    const squarePos = positionToSquare(worldmapPlayer)
    const square = worldmap.squares[squarePos.x][squarePos.y]
    // CE ref: worldmap.cc:3395 — pick frequency by time of day (military hour)
    const militaryHour = GameTime.getHourMilitary()
    const dayPart = (militaryHour >= 1800 || militaryHour < 600) ? 2  // night
                  : militaryHour >= 1200 ? 1                           // afternoon
                  : 0                                                  // morning
    const encRate = worldmap.encounterRates[square.frequencies[dayPart]]

    //console.log("square: %o, worldmap: %o, encRate: %d", square, worldmap, encRate)

    if (encRate === 0)
        // 0% encounter rate (none)
        return false
    else if (encRate === 100)
        // 100% encounter rate (forced)
        return true
    else {
        // Adjust for game difficulty — CE ref: worldmap.cc:3322 wmRndEncounterOccurred
        // CE keys this off settings.preferences.game_difficulty, a separate preference
        // from combat_difficulty (which only affects combat damage) — see config.ts.
        let adjRate = encRate
        const diff = Config.combat.gameDifficultyModifier
        if (diff < 100) adjRate -= Math.floor(encRate / 15)       // Easy
        else if (diff > 100) adjRate += Math.floor(encRate / 15)  // Hard

        const roll = getRandomInt(0, 100)
        dbg('worldmap', 'encounter: rolled %d vs %d (adj %d)', roll, encRate, adjRate)

        if (roll < adjRate) {
            // Base encounter rolled — run Outdoorsman detection check.
            // CE ref: worldmap.cc:3450 wmRndEncounterOccurred
            const player = globalState.player
            if (player !== null) {
                let outdoorsman = player.getSkill('Outdoorsman')
                // PROTO_ID_MOTION_SENSOR = 59 (proto_types.h:146); +20 if carried
                if (player.inventory.some((item: any) => item.pid === 59)) outdoorsman += 20
                if (outdoorsman > 95) outdoorsman = 95
                outdoorsman += square.difficulty
                if (getRandomInt(1, 100) < outdoorsman) {
                    // Detected: award XP; avoidance dialog not yet implemented
                    const xp = 100 - outdoorsman
                    if (xp > 0) {
                        player.addExperience(xp)
                        dbg('worldmap', 'encounter detected: outdoorsman=%d xp=%d', outdoorsman, xp)
                    }
                }
            }
            return true
        }
    }

    return false
}
