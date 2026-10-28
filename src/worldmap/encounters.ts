// Random encounters on the world map — a port of CE worldmap.cc:
//  - wmRndEncounterOccurred: the roll while walking (every 1.5 s of real time, after
//    3+ px in both axes since the last encounter, never inside an area): Frank
//    Horrigan after day 35, the subtile's day-part frequency with the difficulty
//    modifier, the pick, a special encounter's area placed on the map, the car's
//    day-part modifier, the party's Outdoorsman (motion sensor +20, max 95, + the
//    tile's difficulty) to spot it first (XP 100 − skill, misc.msg 8500) and then the
//    YES/NO question (worldmap.msg 2999 / 3000 + 50 × table + entry).
//  - wmRndEncounterPick: the entries whose condition holds and counter isn't spent,
//    chance roll + (LK − 5) + Explorer 2 / Ranger 1 / Scout 1 ± 5 by difficulty, the
//    counter, and the map (the entry's, the table's or the terrain's).
//  - wmSetupRandomEncounter / wmSetupCritterObjs / wmSetupRndNextTileNumInit /
//    wmSetupRndNextTileNum / wmEvalTileNumForPlacement: on the loaded map, each group
//    gets its count (± 2 by difficulty, + 2 with more than 2 party members), its
//    critters (ratio, condition, team, script, items — money doubled by Fortune
//    Finder, the equipped one wielded) placed in the group's formation; with exactly
//    two groups they start fighting each other. A player ambush is left to the
//    critters' scripts, as in CE.

import { Combat } from '../combat.js'
import { Config } from '../config.js'
import { getMapInfoById, lookupMapName } from '../data.js'
import * as Encounters from '../encounters.js'
import * as GameTime from '../gametime.js'
import { hexDirectionTo, hexDistance, hexInDirectionDistance, Point } from '../geometry.js'
import { world } from '../state/world.js'
import { invenWield } from '../inventoryWield.js'
import { dbg } from '../logger.js'
import { pathfinderFindPath } from '../map/pathfinder.js'
import { Critter, createObjectWithPID, Obj } from '../object.js'
import { fromTileNum, toTileNum } from '../tile.js'
import { uiLog } from '../messageLog.js'
import { getMessage, getRandomInt } from '../util.js'
import {
    EncBaseType,
    EncEntry,
    FORMATION_CONE,
    FORMATION_DOUBLE_LINE,
    FORMATION_HUDDLE,
    FORMATION_STRAIGHT_LINE,
    FORMATION_SURROUNDING,
    FORMATION_WEDGE,
} from './encounterData.js'
import { Square } from './types.js'
import { areaIdContainingMap, areaPosAtParty, getWorldmap, setAreaVisible, updateAreaMarkerPos } from './Worldmap.js'

const TICKS_PER_DAY = 864000
const MAP_IN_GAME_MOVIE1 = 149 // worldmap.h — Frank Horrigan
const PROTO_ID_MONEY = 41
const PROTO_ID_MOTION_SENSOR = 59
// CE gDayPartEncounterFrequencyModifiers (morning, afternoon, night) — in the car
const DAY_PART_CAR_MODIFIERS = [40, 30, 0]

// CE wmGenData encounter fields (wmLastRndTime is reset when the worldmap opens)
let encounterMapId = -1
let encounterTableId = -1
let encounterEntryId = -1
let didMeetFrankHorrigan = false
let oldWorldPosX = 0
let oldWorldPosY = 0
let lastRndTime = 0

export interface EncounterRoll {
    mapId: number
    blink: 'random' | 'special' | null // wmBlinkRndEncounterIcon
    fadeOut: boolean
    ask: { title: string; body: string } | null // detected: YES/NO before loading
    forced?: boolean // sfall force_encounter: the map loads without the random encounter setup
}

// sfall: CE worldmap.cc wmForceEncounter (op_force_encounter / _with_flags): the next
// encounter check loads this map. Flags: 0x1 NO_CAR, 0x2 LOCK (no override until it
// happened), 0x4 NO_ICON, 0x8 ICON_SP, 0x10 FADEOUT.
let forcedEncounterMapId = -1
let forcedEncounterFlags = 0
export function forceEncounter(mapId: number, flags: number): void {
    if ((forcedEncounterFlags & 0x80000000) !== 0) return
    forcedEncounterMapId = mapId
    forcedEncounterFlags = (flags >>> 0) & ~0x80000000
    if ((forcedEncounterFlags & 0x2) !== 0) forcedEncounterFlags = (forcedEncounterFlags | 0x80000000) >>> 0
}

// CE wmInterfaceInit: wmLastRndTime = getTicks()
export function resetEncounterTimer(): void {
    lastRndTime = performance.now()
}

function difficulty(): number {
    const d = Config.combat.gameDifficultyModifier
    return d < 100 ? 0 : d > 100 ? 2 : 1 // GAME_DIFFICULTY_EASY / NORMAL / HARD
}

function hasPerk(c: Critter | null, name: string): boolean {
    return !!c && c.perks.includes(name)
}

function worldmapMsg(id: number): string {
    return getMessage('worldmap', id) ?? ''
}

// CE party_member.cc partyGetBestSkillValue: the best value among the party (the dude
// included), hidden members not counted
function partyBestSkill(skill: string): number {
    let best = 0
    for (const c of world.gParty?.getPartyMembersAndPlayer() ?? [world.player]) {
        if (!c || c.type !== 'critter' || c.visible === false) continue
        best = Math.max(best, c.getSkill(skill))
    }
    return best
}

// CE wmRndEncounterOccurred. `pos` is the party's world position, `inArea` whether it
// stands in an area, `square` its subtile. Returns null when nothing happens.
export function rndEncounterOccurred(
    pos: Point,
    inArea: boolean,
    square: Square,
    isInCar: boolean,
): EncounterRoll | null {
    const now = performance.now()
    if (now - lastRndTime < 1500) return null
    lastRndTime = now

    if (Math.abs(oldWorldPosX - pos.x) < 3) return null
    if (Math.abs(oldWorldPosY - pos.y) < 3) return null
    if (inArea) return null

    if (!didMeetFrankHorrigan && Math.trunc(world.gameTickTime / TICKS_PER_DAY) > 35) {
        encounterMapId = -1
        didMeetFrankHorrigan = true
        return { mapId: MAP_IN_GAME_MOVIE1, blink: 'special', fadeOut: true, ask: null }
    }

    // CE (sfall): the forced encounter, after the Horrigan one; fade-out and the blinking
    // icon exclude each other
    if (forcedEncounterMapId !== -1) {
        const flags = forcedEncounterFlags
        const roll: EncounterRoll = {
            mapId: forcedEncounterMapId,
            fadeOut: (flags & 0x10) !== 0,
            ask: null,
            forced: true,
            blink: (flags & 0x10) !== 0 || (flags & 0x4) !== 0 ? null : (flags & 0x8) !== 0 ? 'special' : 'random',
        }
        forcedEncounterMapId = -1
        forcedEncounterFlags = 0
        return roll
    }

    const worldmap = getWorldmap()
    const data = worldmap.encounters
    const hour = GameTime.getHourMilitary()
    const dayPart = hour >= 1800 || hour < 600 ? 2 : hour >= 1200 ? 1 : 0
    let frequency = data.freqValues[(square.frequencies[dayPart] ?? '').toLowerCase()] ?? 0
    if (frequency > 0 && frequency < 100) {
        const modifier = Math.trunc(frequency / 15)
        if (difficulty() === 0) frequency -= modifier
        else if (difficulty() === 2) frequency += modifier
    }

    const chance = getRandomInt(0, 100)
    if (chance >= frequency) return null

    rndEncounterPick(square)
    const table = data.tables[encounterTableId]
    const entry = table?.entries[encounterEntryId]
    if (!entry) return null

    if (entry.special) {
        // CE: the area of the encounter map is put at the party (worldPos + hotspot / 2 +
        // sphere / 2) and, unless locked, becomes known
        const mapName = lookupMapName(encounterMapId)
        const areaIdx = mapName ? areaIdContainingMap(mapName) : 0
        const area: any = world.mapAreas?.[areaIdx]
        if (area) {
            area.worldPosition = areaPosAtParty(area, pos.x, pos.y)
            updateAreaMarkerPos(String(areaIdx), area.worldPosition.x, area.worldPosition.y)
            if (!area.lockState) setAreaVisible(areaIdx, true)
        }
    }

    if (isInCar) frequency -= DAY_PART_CAR_MODIFIERS[dayPart]

    let detected = false
    if (frequency > chance) {
        let outdoorsman = partyBestSkill('Outdoorsman')
        const player = world.player
        if (player?.inventory.some((it) => it.pid === PROTO_ID_MOTION_SENSOR)) outdoorsman += 20
        if (outdoorsman > 95) outdoorsman = 95
        outdoorsman += square.difficulty ?? 0
        if (getRandomInt(1, 100) < outdoorsman) {
            detected = true
            const xp = 100 - outdoorsman
            if (xp > 0 && player) {
                const before = player.getStat('Experience')
                player.addExperience(xp)
                const text = getMessage('misc', 8500)
                if (text) uiLog(text.replace('%d', String(player.getStat('Experience') - before)))
            }
        }
    } else {
        detected = true
    }

    oldWorldPosX = pos.x
    oldWorldPosY = pos.y

    dbg(
        'worldmap',
        `encounter: table ${encounterTableId} entry ${encounterEntryId} map ${encounterMapId} detected=${detected}`,
    )
    return {
        mapId: encounterMapId,
        blink: entry.special ? 'special' : 'random',
        fadeOut: true,
        ask: detected
            ? { title: worldmapMsg(2999), body: worldmapMsg(3000 + 50 * encounterTableId + encounterEntryId) }
            : null,
    }
}

// The party said NO to a spotted encounter (CE: the encounter fields are cleared)
export function cancelEncounter(): void {
    encounterMapId = -1
    encounterTableId = -1
    encounterEntryId = -1
}

// CE wmRndEncounterPick
function rndEncounterPick(square: Square): void {
    const data = getWorldmap().encounters
    encounterTableId = data.tables.findIndex(
        (t) => t.lookupName.toLowerCase() === (square.encounterType ?? '').toLowerCase(),
    )
    const table = data.tables[encounterTableId]
    if (!table) {
        encounterMapId = -1
        return
    }

    const candidates: number[] = []
    let totalChance = 0
    table.entries.forEach((entry, index) => {
        let selected = entry.cond === null || Encounters.evalConds(entry.cond)
        if (entry.counter === 0) selected = false
        if (selected) {
            candidates.push(index)
            totalChance += entry.chance
        }
    })

    const player = world.player
    let chance = getRandomInt(0, totalChance) + ((player?.getStat('LUK') ?? 5) - 5)
    if (hasPerk(player, 'Explorer')) chance += 2
    if (hasPerk(player, 'Ranger')) chance += 1
    if (hasPerk(player, 'Scout')) chance += 1
    if (difficulty() === 0) {
        chance += 5
        if (chance > totalChance) chance = totalChance
    } else if (difficulty() === 2) {
        chance -= 5
        if (chance < 0) chance = 0
    }

    let index = 0
    for (; index < candidates.length; index++) {
        const entry = table.entries[candidates[index]]
        if (chance < entry.chance) break
        chance -= entry.chance
    }
    if (index === candidates.length) index = candidates.length - 1
    encounterEntryId = candidates[index] ?? -1

    const entry = table.entries[encounterEntryId]
    if (!entry) {
        encounterMapId = -1
        return
    }
    if (entry.counter > 0) entry.counter--

    if (entry.map === -1) {
        if (table.maps.length <= 0) {
            const terrain = data.terrains.find((t) => t.name === (square.terrainType ?? '').toLowerCase())
            encounterMapId =
                terrain && terrain.maps.length ? terrain.maps[getRandomInt(0, terrain.maps.length - 1)] : -1
        } else {
            encounterMapId = table.maps[getRandomInt(0, table.maps.length - 1)]
        }
    } else {
        encounterMapId = entry.map
    }
}

// CE wmSetupRandomEncounter — runs once the encounter map is loaded (map.cc mapLoad,
// after map_enter_p_proc). The encounter fields are cleared afterwards, as the worldmap
// does when it closes.
export function setupRandomEncounter(): void {
    const mapId = encounterMapId
    const table = getWorldmap()?.encounters.tables[encounterTableId]
    const entry = table?.entries[encounterEntryId]
    cancelEncounter()
    if (mapId === -1 || !entry) return

    // SFALL: the description in one line
    uiLog(
        `${worldmapMsg(2998)} ${worldmapMsg(3000 + 50 * getWorldmap().encounters.tables.indexOf(table!) + table!.entries.indexOf(entry))}`,
    )

    // CE _getPartyMemberCount: the dude and the living, visible critter members
    const party =
        1 +
        (world.gParty?.getPartyMembers() ?? []).filter((c) => c.type === 'critter' && !c.dead && c.visible !== false)
            .length
    let prevCritter: Critter | null = null
    let critter: Critter | null = null // CE's loop variable keeps its value when a group places nobody
    entry.subEntries.forEach((sub, index) => {
        let critterCount = getRandomInt(sub.min, sub.max)
        if (difficulty() === 0) {
            critterCount -= 2
            if (critterCount < sub.min) critterCount = sub.min
        } else if (difficulty() === 2) {
            critterCount += 2
        }
        if (party > 2) critterCount += 2

        if (critterCount === 0) return
        if (sub.baseType !== -1)
            critter = setupCritterObjs(getWorldmap().encounters.baseTypes[sub.baseType], critterCount)

        if (index > 0 && prevCritter !== null && prevCritter !== critter && critter !== null && !world.inCombat) {
            if (entry.subEntries.length === 2 && Config.engine.doCombat === true) {
                prevCritter.whoHitMe = critter
                critter.whoHitMe = prevCritter
                Combat.start(
                    prevCritter,
                    {
                        attacker: prevCritter,
                        defender: critter,
                        actionPointsBonus: 0,
                        accuracyBonus: 0,
                        damageBonus: 0,
                        minDamage: 0,
                        maxDamage: 500,
                        overrideAttackResults: false,
                        attackerResults: 0,
                        targetResults: 0,
                    },
                    [critter, prevCritter],
                )
            }
        }
        prevCritter = critter
    })
}

// Formation state — CE wmRndCenterTiles / wmRndTileDirs / wmRndRotOffsets / wmRndIndex
// / wmRndCallCount / wmRndOriginalCenterTile
let rndCenterTiles: [number, number] = [-1, -1]
let rndTileDirs: [number, number] = [0, 0]
const RND_ROT_OFFSETS = [1, 5]
let rndIndex = 0
let rndCallCount = 0
let rndOriginalCenterTile = -1

function tileInDirection(tile: number, rotation: number, distance: number): number {
    return toTileNum(hexInDirectionDistance(fromTileNum(tile), rotation, distance))
}
function rotationTo(from: number, to: number): number {
    return hexDirectionTo(fromTileNum(from), fromTileNum(to))
}

// CE wmSetupRndNextTileNumInit
function setupRndNextTileNumInit(base: EncBaseType): boolean {
    const dude = world.player!
    const dudeTile = toTileNum(dude.position)
    rndCenterTiles = [-1, -1]
    rndTileDirs = [0, 0]
    rndCallCount = 0
    if (base.formation === FORMATION_SURROUNDING) {
        rndCenterTiles[0] = dudeTile
        rndTileDirs[0] = getRandomInt(0, 5)
        rndOriginalCenterTile = rndCenterTiles[0]
        return true
    }
    const map = getMapInfoById(world.gMap?.mapID ?? -1)
    const points = map?.randomStartPoints ?? []
    if (points.length !== 0) {
        const rsp = points[getRandomInt(0, points.length - 1)]
        rndCenterTiles = [rsp.tileNum, rsp.tileNum]
    } else {
        rndCenterTiles = [dudeTile, dudeTile]
    }
    rndTileDirs = [rotationTo(rndCenterTiles[0], dudeTile), rotationTo(rndCenterTiles[1], dudeTile)]
    rndOriginalCenterTile = rndCenterTiles[0]
    return true
}

// CE wmEvalTileNumForPlacement: not blocked, and the dude can get there (shoot-blocking)
function evalTileNumForPlacement(tile: number): boolean {
    const dude = world.player!
    const gMap = world.gMap!
    if (gMap.blockingObjectAt(tile, dude.elevation ?? gMap.currentElevation, 0, dude) !== null) return false
    const to = fromTileNum(tile)
    if (to.x === dude.position.x && to.y === dude.position.y) return true
    return pathfinderFindPath(dude, dude.position, to, false, true).length > 0
}

// CE wmSetupRndNextTileNum: the next tile of the formation (-1: none)
function setupRndNextTileNum(base: EncBaseType, e: EncEntry): number {
    const dude = world.player!
    const dudeTile = toTileNum(dude.position)
    for (let attempt = 1; ; attempt++) {
        let tile: number
        switch (base.formation) {
            case FORMATION_SURROUNDING: {
                let distance: number
                if (e.distance !== 0) {
                    distance = e.distance
                } else {
                    distance = getRandomInt(-2, 2) + dude.getStat('PER')
                    if (hasPerk(dude, 'Cautious Nature')) distance += 3
                }
                if (distance < 0) distance = 0
                let origin = e.tile
                if (origin === -1) origin = tileInDirection(dudeTile, rndTileDirs[0], distance)
                if (++rndTileDirs[0] >= 6) rndTileDirs[0] = 0
                const randomizedDistance = getRandomInt(0, Math.trunc(distance / 2))
                const randomizedRotation = getRandomInt(0, 5)
                tile = tileInDirection(origin, (randomizedRotation + rndTileDirs[0]) % 6, randomizedDistance)
                break
            }
            case FORMATION_STRAIGHT_LINE:
            case FORMATION_DOUBLE_LINE:
                tile = rndCenterTiles[rndIndex]
                if (rndCallCount !== 0) {
                    const rotation = (RND_ROT_OFFSETS[rndIndex] + rndTileDirs[rndIndex]) % 6
                    const origin = tileInDirection(rndCenterTiles[rndIndex], rotation, base.spacing)
                    tile = tileInDirection(origin, (rotation + RND_ROT_OFFSETS[rndIndex]) % 6, base.spacing)
                    rndCenterTiles[rndIndex] = tile
                    rndIndex = 1 - rndIndex
                }
                break
            case FORMATION_WEDGE:
                tile = rndCenterTiles[rndIndex]
                if (rndCallCount !== 0) {
                    tile = tileInDirection(
                        rndCenterTiles[rndIndex],
                        (RND_ROT_OFFSETS[rndIndex] + rndTileDirs[rndIndex]) % 6,
                        base.spacing,
                    )
                    rndCenterTiles[rndIndex] = tile
                    rndIndex = 1 - rndIndex
                }
                break
            case FORMATION_CONE:
                tile = rndCenterTiles[rndIndex]
                if (rndCallCount !== 0) {
                    tile = tileInDirection(
                        rndCenterTiles[rndIndex],
                        (rndTileDirs[rndIndex] + 3 + RND_ROT_OFFSETS[rndIndex]) % 6,
                        base.spacing,
                    )
                    rndCenterTiles[rndIndex] = tile
                    rndIndex = 1 - rndIndex
                }
                break
            case FORMATION_HUDDLE:
            default:
                tile = rndCenterTiles[0]
                if (rndCallCount !== 0) {
                    rndTileDirs[0] = (rndTileDirs[0] + 1) % 6
                    tile = tileInDirection(rndCenterTiles[0], rndTileDirs[0], base.spacing)
                    rndCenterTiles[0] = tile
                }
                break
        }
        rndCallCount++
        if (evalTileNumForPlacement(tile)) return tile
        if (hexDistance(fromTileNum(rndOriginalCenterTile), fromTileNum(rndCenterTiles[rndIndex])) > 25) return -1
        if (attempt > 25) return -1
    }
}

// CE wmSetupCritterObjs: one group's critters. Returns the first critter created.
function setupCritterObjs(base: EncBaseType | undefined, critterCount: number): Critter | null {
    if (!base || !world.gMap || !world.player) return null
    dbg('worldmap', `setupCritterObjs: ${base.name}, formation ${base.formation}, ${critterCount} critters`)
    if (!setupRndNextTileNumInit(base)) return null

    const gMap = world.gMap
    const dude = world.player
    const elevation = gMap.currentElevation
    let first: Critter | null = null
    for (const e of base.entries) {
        if (e.pid === -1) continue
        if (e.cond !== null && !Encounters.evalConds(e.cond, critterCount)) continue

        let count = e.useRatio ? Math.trunc((e.ratio * critterCount) / 100) : 1
        if (count < 1) count = 1

        for (let n = 0; n < count; n++) {
            const tile = setupRndNextTileNum(base, e)
            if (tile === -1) continue

            const obj = createObjectWithPID(e.pid, e.scriptIdx !== -1 ? e.scriptIdx : undefined) as Obj
            if (first === null && obj instanceof Critter) first = obj
            if (e.team !== -1 && obj instanceof Critter) obj.teamNum = e.team

            const placeTile =
                base.formation !== FORMATION_SURROUNDING ? tile : gMap.attemptPlacement(tile, elevation, 0)
            obj.elevation = elevation
            gMap.addObject(obj, elevation)
            obj.move(fromTileNum(placeTile))
            obj.orientation = rotationTo(placeTile, toTileNum(dude.position))

            for (const item of e.items) {
                let quantity = item.max === item.min ? item.max : getRandomInt(item.min, item.max)
                if (quantity === 0) continue
                const itemObj = createObjectWithPID(item.pid) as Obj
                if (item.pid === PROTO_ID_MONEY && hasPerk(dude, 'Fortune Finder')) quantity *= 2
                obj.addInventoryItem(itemObj, quantity)
                if (item.equipped && obj instanceof Critter) {
                    const ref = obj.inventory.find((s) => s.pid === item.pid) ?? null
                    if (ref) invenWield(obj, ref, 'rightHand')
                }
            }
            if (obj instanceof Critter) obj.setIdleArt?.()
        }
    }
    return first
}

// Save / load / new game (CE wmWorldMap_save / load: didMeetFrankHorrigan and the
// encounter entries' counters)
export interface SavedEncounters {
    horrigan: boolean
    counters: [number, number, number][]
}
export function serializeEncounters(): SavedEncounters {
    const counters: [number, number, number][] = []
    getWorldmap()?.encounters.tables.forEach((t, ti) =>
        t.entries.forEach((e, ei) => {
            if (e.counter !== -1) counters.push([ti, ei, e.counter])
        }),
    )
    return { horrigan: didMeetFrankHorrigan, counters }
}
export function deserializeEncounters(data: SavedEncounters | undefined): void {
    didMeetFrankHorrigan = data?.horrigan ?? false
    const tables = getWorldmap()?.encounters.tables
    for (const [ti, ei, counter] of data?.counters ?? []) {
        const e = tables?.[ti]?.entries[ei]
        if (e) e.counter = counter
    }
}
export function resetEncounters(): void {
    didMeetFrankHorrigan = false
    forcedEncounterMapId = -1
    forcedEncounterFlags = 0
    oldWorldPosX = 0
    oldWorldPosY = 0
    cancelEncounter()
}
