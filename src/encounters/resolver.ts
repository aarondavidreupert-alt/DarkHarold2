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

// Encounter resolution: picking, critter evaluation, formation positioning,
// table dispatch. Split out of encounters.ts. See wiki/ts-split-refactor.md
// → "Per-file split proposals" §20.

import { lookupMapNameFromLookup, MapInfo } from "../data.js"
import { hexInDirectionDistance, Point } from "../geometry.js"
import globalState from "../globalState.js"
import { Config } from "../config.js"
import { fromTileNum } from "../tile.js"
import { getRandomInt } from "../util.js"
import { Worldmap } from "../worldmap.js"
import { dbg } from "../logger.js"
import { evalConds } from "./conditionLang.js"

function evalEncounterCritter(critter: Worldmap.EncounterCritter): Worldmap.EncounterCritter {
    var items = []
    for(var i = 0; i < critter.items.length; i++) {
        var item = critter.items[i]
        var amount = 1

        if(item.range) {
            amount = getRandomInt(item.range.start, item.range.end)
        }

        if(amount > 0)
            items.push({pid: item.pid, wielded: item.wielded, amount: amount})
    }

    return {items: items, pid: critter.pid, script: critter.script, dead: critter.dead}
}

function evalEncounterCritters(count: number, group: Worldmap.EncounterGroup): Worldmap.EncounterCritter[] {
    var critters: Worldmap.EncounterCritter[] = []

    for(var i = 0; i < group.critters.length; i++) {
        var critter = group.critters[i]

        if(critter.cond) {
            if(!evalConds(critter.cond)) {
                dbg('encounters', "critter cond false: %o", critter.cond)
                continue
            }
            else
                dbg('encounters', "critter cond true: %o", critter.cond)
        }

        if(critter.ratio === undefined)
            critters.push(evalEncounterCritter(critter))
        else {
            var num = Math.ceil(critter.ratio/100 * count)
            // TODO: better distribution (might be +1 now)
            dbg('encounters', "critter nums: %d (%d% of %d)", num, critter.ratio, count)
            for(var j = 0; j < num; j++)
                critters.push(evalEncounterCritter(critter))
        }
    }

    return critters
}

function pickEncounter(encounters: Worldmap.Encounter[]) {
    // Pick an encounter from an encounter list based on a roll
    // CE ref: worldmap.cc:3579 — skip depleted (counter==0) encounters

    var succEncounters = encounters.filter(function(enc) {
        if (enc.counter === 0) return false
        return (enc.cond !== null) ? evalConds(enc.cond) : true
    })
    var numEncounters = succEncounters.length
    var totalChance = succEncounters.reduce(function(sum, x) { return x.chance + sum }, 0)

    if(numEncounters === 0)
        throw "pickEncounter: There were no successfully-conditioned encounters"

    dbg('encounters', "pickEncounter: num: %d, chance: %d, encounters: %o", numEncounters, totalChance, succEncounters)

    var luck = globalState.player.getStat("LUK")
    var roll = getRandomInt(0, totalChance) + (luck - 5)

    // FO2-CE ref: worldmap.cc pickEncounterTable — difficulty and perk modifiers
    const diff = Config.combat.difficultyModifier
    roll += diff === 75 ? 5 : diff === 125 ? -5 : 0
    const player = globalState.player as any
    if (player.perks?.includes('Scout'))    roll += 1
    if (player.perks?.includes('Ranger'))   roll += 1
    if (player.perks?.includes('Explorer')) roll += 2

    // Remove chances from roll until either we reach the end of the list or the roll runs out.
    // If our roll does *not* run out (i.e., its value exceeds totalChance), then
    // we will choose the last encounter in the list.

    var acc = roll
    var idx = 0
    for(; idx < succEncounters.length; idx++) {
        var chance = succEncounters[idx].chance
        if(acc < chance)
            break

        acc -= chance
    }

    dbg('encounters', "idx: %d", idx)
    const chosen = succEncounters[idx]
    // CE ref: worldmap.cc:3636 — decrement counter if > 0
    if (chosen.counter > 0) chosen.counter--
    return chosen
}

export function positionCritters(groups: Worldmap.EncounterGroup[], playerPos: Point, map: MapInfo) {
    // set up critters' positions in their formations

    groups.forEach(function(group) {
        var dir = getRandomInt(0, 5)
        var formation = group.position.type
        let pos: Point

        if(formation === "surrounding")
            pos = {x: playerPos.x, y: playerPos.y}
        else {
            // choose a random starting point from the map
            var randomPoint = map.randomStartPoints[getRandomInt(0, map.randomStartPoints.length - 1)]
            pos = fromTileNum(randomPoint.tileNum)
        }

        dbg('encounters', "positionCritters: map %o, dir %d, formation %s, pos %o", map, dir, formation, pos)

        // Two-cursor state for line/wedge/cone formations.
        // CE ref: worldmap.cc:3906-3915 wmSetupRndNextTileNumInit
        // rotOffsets[0]=1 (veer right), rotOffsets[1]=5 (veer left = -1 mod 6)
        const rotOffsets = [1, 5]
        const centers: [Point, Point] = [{ ...pos }, { ...pos }]
        const fmtDirs = [dir, dir]
        let fmtIdx = 0
        let fmtCallCount = 0

        group.critters.forEach(function(critter) {
            switch(formation) {
                case "huddle":
                    critter.position = {x: pos.x, y: pos.y}

                    dir = (dir + 1) % 6
                    pos = hexInDirectionDistance(pos, dir, group.position.spacing)
                    break
                case "surrounding":
                    var roll = globalState.player.getStat("PER") + getRandomInt(-2, 2)
                    // FO2-CE ref: worldmap.cc — Cautious Nature perk adds +3
                    if ((globalState.player as any).perks?.includes('Cautious Nature')) roll += 3

                    if(roll < 0)
                        roll = 0

                    pos = hexInDirectionDistance(pos, dir, roll)

                    dir++
                    if(dir >= 6)
                        dir = 0

                    var rndSpacing = getRandomInt(0, Math.floor(roll / 2))
                    var rndDir = getRandomInt(0, 5)
                    pos = hexInDirectionDistance(pos, (rndDir + dir) % 6, rndSpacing)

                    critter.position = {x: pos.x, y: pos.y}
                    break

                case "straight_line":
                case "double_line": {
                    // CE ref: worldmap.cc:4008-4026 wmSetupRndNextTileNum
                    // First critter at center; then alternate two arms extending
                    // in (rotOffset+dir)%6 with a double-step per arm.
                    critter.position = { ...centers[fmtIdx] }
                    if (fmtCallCount !== 0) {
                        const rot = (rotOffsets[fmtIdx] + fmtDirs[fmtIdx]) % 6
                        const origin = hexInDirectionDistance(centers[fmtIdx], rot, group.position.spacing)
                        const next = hexInDirectionDistance(origin, (rot + rotOffsets[fmtIdx]) % 6, group.position.spacing)
                        centers[fmtIdx] = next
                        fmtIdx = 1 - fmtIdx
                        critter.position = { ...next }
                    }
                    fmtCallCount++
                    break
                }

                case "wedge": {
                    // CE ref: worldmap.cc:4028-4034
                    // V-formation: two arms extend from center in (rotOffset+dir)%6
                    critter.position = { ...centers[fmtIdx] }
                    if (fmtCallCount !== 0) {
                        const rot = (rotOffsets[fmtIdx] + fmtDirs[fmtIdx]) % 6
                        const next = hexInDirectionDistance(centers[fmtIdx], rot, group.position.spacing)
                        centers[fmtIdx] = next
                        fmtIdx = 1 - fmtIdx
                        critter.position = { ...next }
                    }
                    fmtCallCount++
                    break
                }

                case "cone": {
                    // CE ref: worldmap.cc:4036-4042
                    // Fan expanding away from player (+3 reverses direction)
                    critter.position = { ...centers[fmtIdx] }
                    if (fmtCallCount !== 0) {
                        const rot = (fmtDirs[fmtIdx] + 3 + rotOffsets[fmtIdx]) % 6
                        const next = hexInDirectionDistance(centers[fmtIdx], rot, group.position.spacing)
                        centers[fmtIdx] = next
                        fmtIdx = 1 - fmtIdx
                        critter.position = { ...next }
                    }
                    fmtCallCount++
                    break
                }

                default:
                    dbg('encounters', "UNHANDLED FORMATION %s", formation)
                    critter.position = {x: pos.x, y: pos.y}
                    pos.x--
                    break
            }
        })
    })
}

export function evalEncounter(encTable: Worldmap.EncounterTable) {
    var mapIndex = getRandomInt(0, encTable.maps.length - 1)
    var mapLookupName = encTable.maps[mapIndex]
    var mapName = lookupMapNameFromLookup(mapLookupName)
    var groups: Worldmap.EncounterGroup[] = []
    var encounter = pickEncounter(encTable.encounters)

    if(encounter.special !== null) {
        // special encounter: use specific map
        mapLookupName = encounter.special
        mapName = lookupMapNameFromLookup(mapLookupName)
        dbg('encounters', "special encounter: %s", mapName)
    }

    dbg('encounters', "map: %s (from %s)", mapName, mapLookupName)
    dbg('encounters', "encounter: %o", encounter)

    // TODO: maybe unify these and just have a `.groups` in the encounter, along with a target.
    if(encounter.enc.type === "ambush") {
        // player ambush
        dbg('encounters', "(player ambush)")

        var party = encounter.enc.party
        var group = Worldmap.getEncounterGroup(party.name)
        var position = group.position

        dbg('encounters', "party: %d-%d of %s", party.start, party.end, party.name)
        dbg('encounters', "encounter group: %o", group)
        dbg('encounters', "position:", position)

        var critterCount = getRandomInt(party.start, party.end)
        var critters = evalEncounterCritters(critterCount, group)
        groups.push({critters: critters, position: position, target: "player"})
    }
    else if(encounter.enc.type === "fighting") {
        // two factions fighting
        var firstParty = encounter.enc.firstParty
        var secondParty = encounter.enc.secondParty
        dbg('encounters', "two factions: %o vs %o", firstParty, secondParty)

        if(!firstParty) throw Error();

        var firstGroup = Worldmap.getEncounterGroup(firstParty.name)
        var firstCritterCount = getRandomInt(firstParty.start, firstParty.end)
        groups.push({critters: evalEncounterCritters(firstCritterCount, firstGroup), target: 1, position: firstGroup.position})

        // one-party fighting? TODO: check what all is allowed with `fighting`
        if(secondParty && secondParty.name !== undefined) {
            var secondGroup = Worldmap.getEncounterGroup(secondParty.name)
            var secondCritterCount = getRandomInt(secondParty.start, secondParty.end)
            groups.push({critters: evalEncounterCritters(secondCritterCount, secondGroup), target: 0, position: secondGroup.position})
        }
    }
    else if(encounter.enc.type === "special") {
        //console.log("TODO: special encounter type")
    }
    else throw "unknown encounter type: " + encounter.enc.type

    dbg('encounters', "groups: %o", groups)

    return {mapName: mapName,
            mapLookupName: mapLookupName,
            encounter: encounter,
            encounterType: encounter.enc.type,
            groups: groups}
}
