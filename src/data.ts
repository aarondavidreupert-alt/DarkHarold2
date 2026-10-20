/*
Copyright 2014-2017 darkf

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

import { getFileJSON, getFileText, parseIni } from './util.js'
import globalState from './globalState.js'
import { dbg } from './logger.js'
import { Point } from './geometry.js'
import { lookupInterfaceArt } from './pro.js'

var lstFiles: { [lsgFile: string]: string[] } = {}
var lstJsonFiles: { [lstFile: string]: any[] | null } = {}
var mapInfo: { [mapID: number]: MapInfo } | null = null
var elevatorInfo: { elevators: Elevator[] } | null = null

export interface AreaMap {
    // XXX: Why does using a number key break areas?
    [areaID: string]: Area
}

export interface Area {
    name: string
    id: number
    size: string
    state: boolean
    // city.txt lock_state=On (CE LOCK_STATE_LOCKED): only forced state changes apply
    lockState: boolean
    worldPosition: Point
    mapArt?: string
    labelArt?: string
    entrances: AreaEntrance[]
}

interface AreaEntrance {
    startState: string
    state: boolean   // runtime toggle: CE wmMapMarkMapEntranceState sets entrance->state
    x: number
    y: number
    mapLookupName: string
    mapName: string
    elevation: number
    tileNum: number
    orientation: number
}

export interface MapInfo {
    name: string
    lookupName: string
    ambientSfx: [string, number][]
    music: string
    randomStartPoints: { elevation: number; tileNum: number }[]
    // CE worldmap.cc wmConfigInit: can_rest_here=Yes/No per elevation (default all Yes, flags 0x3F)
    canRestHere: boolean[]
    // saved=Yes|No (MAP_SAVED, default on) — only saved maps mark their area visited
    saved: boolean
    // dead_bodies_age=Yes|No (MAP_DEAD_BODIES_AGE, default on)
    deadBodiesAge: boolean
}

export interface Elevator {
    buttons: { tileNum: number; mapID: number; level: number }[]
    buttonCount: number
    labels: number
    type: number
}

export function getElevator(type: number): Elevator {
    if (!elevatorInfo) {
        dbg('map', 'loading elevator info')
        elevatorInfo = getFileJSON('lut/elevators.json')
    }

    return elevatorInfo!.elevators[type]
}

function parseAreas(data: string): AreaMap {
    var areas = parseIni(data)
    var out: AreaMap = {}

    for (var _area in areas) {
        var area = areas[_area]
        var match = _area.match(/Area (\d+)/)
        if (match === null) throw 'city.txt: invalid area name: ' + area.area_name
        var areaID = parseInt(match[1])
        var worldPos = area.world_pos.split(',').map((x: string) => parseInt(x))

        var newArea: Area = {
            name: area.area_name,
            id: areaID,
            size: area.size.toLowerCase(),
            state: area.start_state.toLowerCase() === 'on',
            lockState: (area.lock_state ?? 'off').trim().toLowerCase() === 'on',
            worldPosition: { x: worldPos[0], y: worldPos[1] },
            entrances: [],
        }

        // map/label art
        var mapArtIdx = parseInt(area.townmap_art_idx)
        var labelArtIdx = parseInt(area.townmap_label_art_idx)

        //console.log(mapArtIdx + " - " + labelArtIdx)

        if (mapArtIdx !== -1) newArea.mapArt = lookupInterfaceArt(mapArtIdx)
        if (labelArtIdx !== -1) newArea.labelArt = lookupInterfaceArt(labelArtIdx)

        // entrances
        for (const _key in area) {
            // entrance_N
            // e.g.: entrance_0=On,345,230,Destroyed Arroyo Bridge,-1,26719,0

            let s = _key.split('_')
            if (s[0] === 'entrance') {
                const entranceString = area[_key]
                s = entranceString.split(',')

                const mapLookupName = s[3].trim()
                const mapName = lookupMapNameFromLookup(mapLookupName)
                if (!mapName) throw Error("Couldn't look up map name")

                const entrance = {
                    startState: s[0],
                    // CE worldmap.cc wmConfigInit: entrance_N=On|Off,… — the start state;
                    // scripts open more with metarule3 104 (wmMapMarkMapEntranceState).
                    state: s[0].trim().toLowerCase() === 'on',
                    x: parseInt(s[1]),
                    y: parseInt(s[2]),
                    mapLookupName,
                    mapName,
                    elevation: Math.max(0, parseInt(s[4])),
                    tileNum: parseInt(s[5]),
                    orientation: parseInt(s[6]),
                }
                newArea.entrances.push(entrance)
            }
        }

        out[areaID] = newArea
    }

    return out
}

export function areaContainingMap(mapName: string) {
    if (!globalState.mapAreas) throw Error('globalState.mapAreas not loaded')
    for (var area in globalState.mapAreas) {
        var entrances = globalState.mapAreas[area].entrances
        for (var i = 0; i < entrances.length; i++) {
            if (entrances[i].mapName === mapName) return globalState.mapAreas[area]
        }
    }
    return null
}

export function loadAreas() {
    return parseAreas(getFileText('data/data/city.txt'))
}

function allAreas() {
    if (globalState.mapAreas === null) globalState.mapAreas = loadAreas()
    var areas = []
    for (var area in globalState.mapAreas) areas.push(globalState.mapAreas[area])
    return areas
}

export interface MsgEntry {
    num: number
    audio: string
    text: string
}

/** Parse a .msg file as CE message.cc messageListLoad does: entries are three
 *  {fields} (number, speech file, text); anything outside braces is skipped
 *  (comments, indentation, stray text), newlines inside a field are dropped, a
 *  later entry with the same number replaces the earlier one. A malformed
 *  entry (a '}' outside braces, an unclosed field, a bad number) ends the
 *  load; the entries before it are kept. */
export function parseMsgFile(src: string, fileName = ''): MsgEntry[] {
    const out: MsgEntry[] = []
    let pos = 0
    // CE _message_load_field: 0 = a field, 1 = end of file, else an error
    const field = (): string | 1 | null => {
        for (;;) {
            if (pos >= src.length) return 1
            const ch = src[pos++]
            if (ch === '}') return null
            if (ch === '{') break
        }
        let text = ''
        for (;;) {
            if (pos >= src.length) return null
            const ch = src[pos++]
            if (ch === '}') return text
            // the file is read in text mode: \r\n is a newline, and newlines are dropped
            if (ch !== '\n' && ch !== '\r') text += ch
        }
    }
    for (;;) {
        const num = field()
        if (num === 1) break
        const audio = num === null ? null : field()
        const text = typeof audio === 'string' ? field() : null
        const n = typeof num === 'string' ? Number(num.trim()) : NaN
        if (typeof text !== 'string' || typeof audio !== 'string' || !Number.isInteger(n)) {
            console.warn(`message file ${fileName}: malformed entry at offset ${pos}`)
            break
        }
        // HACK: replace unicode replacement character with an apostrophe (because the Web sucks at character encodings)
        out.push({ num: n, audio, text: text.replace(/\ufffd/g, "'") })
    }
    return out
}

export function loadMessage(name: string) {
    name = name.toLowerCase()
    var msg = getFileText('data/text/english/game/' + name + '.msg')
    if (globalState.messageFiles[name] === undefined) globalState.messageFiles[name] = {}
    for (const e of parseMsgFile(msg, name)) globalState.messageFiles[name][e.num] = e.text
}

function loadLst(lst: string): string[] {
    return getFileText('data/' + lst + '.lst').split('\n')
}

export function getLstId(lst: string, id: number): string | null {
    if (lstFiles[lst] === undefined) lstFiles[lst] = loadLst(lst)
    if (lstFiles[lst] === undefined) return null

    return lstFiles[lst][id]
}

// Collapse consecutive duplicate path components: art/critters/critters → art_critters
function lstToJsonName(lst: string): string {
    const parts = lst.split('/')
    const deduped: string[] = []
    for (const part of parts) {
        if (deduped.length === 0 || deduped[deduped.length - 1] !== part) deduped.push(part)
    }
    return deduped.join('_')
}

export function getLstJson(lst: string, id: number): any {
    if (!(lst in lstJsonFiles)) lstJsonFiles[lst] = getFileJSON('lut/lst/' + lstToJsonName(lst) + '.json') ?? null
    if (lstJsonFiles[lst] == null) return null
    return lstJsonFiles[lst]![id] ?? null
}

export function lookupScriptName(scriptID: number): string {
    dbg('script', 'SID: ' + scriptID)
    const lookupName = getLstId('scripts/scripts', scriptID - 1)
    if (lookupName === null) throw Error('lookupScriptName: failed to look up script name')
    return lookupName.split('.')[0].toLowerCase()
}

// Map info (data/data/maps.txt)

function parseMapInfo() {
    if (mapInfo !== null) return

    // parse map info from data/data/maps.txt
    mapInfo = {}
    const text = getFileText('data/data/maps.txt')
    const ini = parseIni(text)
    for (var category in ini) {
        const m = category.match(/Map (\d+)/)
        if (!m) throw Error('maps.txt: invalid category: ' + category)

        let id: string | number = m[1]
        if (id === null) throw 'maps.txt: invalid category: ' + category
        id = parseInt(id)

        var randomStartPoints = []
        for (var key in ini[category]) {
            if (key.indexOf('random_start_point_') === 0) {
                var startPoint = ini[category][key].match(/elev:(\d), tile_num:(\d+)/)
                if (startPoint === null) throw 'invalid random_start_point: ' + ini[category][key]
                randomStartPoints.push({ elevation: parseInt(startPoint[1]), tileNum: parseInt(startPoint[2]) })
            }
        }

        // parse ambient sfx list
        var ambientSfx: [string, number][] = []
        var ambient_sfx = ini[category].ambient_sfx
        if (ambient_sfx) {
            var s = ambient_sfx.split(',')
            for (var i = 0; i < s.length; i++) {
                var kv = s[i].trim().split(':')
                ambientSfx.push([kv[0].toLowerCase(), parseInt(kv[1].toLowerCase())])
            }
        }

        mapInfo[id] = {
            name: ini[category].map_name,
            lookupName: ini[category].lookup_name,
            ambientSfx: ambientSfx,
            music: (ini[category].music || '').trim().toLowerCase(),
            randomStartPoints: randomStartPoints,
            saved: (ini[category].saved ?? 'Yes').split(';')[0].trim().toLowerCase() !== 'no',
            deadBodiesAge: (ini[category].dead_bodies_age ?? 'Yes').split(';')[0].trim().toLowerCase() !== 'no',
            canRestHere: [0, 1, 2].map((e) => ((ini[category].can_rest_here ?? 'Yes,Yes,Yes').split(';')[0].split(',')[e] ?? 'Yes').trim().toLowerCase() !== 'no'),
        }
    }
}

export function lookupMapFromLookup(lookupName: string) {
    if (mapInfo === null) parseMapInfo()

    for (var mapID in mapInfo!) {
        if (mapInfo![mapID].lookupName === lookupName) return mapInfo![mapID]
    }
    return null
}

// CE worldmap.cc wmParseFindMapIdxMatch: maps.txt index by lookup_name (any case), or -1.
export function mapIndexFromLookup(lookupName: string): number {
    if (mapInfo === null) parseMapInfo()
    for (const mapID in mapInfo!) {
        if ((mapInfo![mapID].lookupName ?? '').toLowerCase() === lookupName.toLowerCase()) return Number(mapID)
    }
    return -1
}

// maps.txt entry by index
export function getMapInfoById(mapID: number): MapInfo | null {
    if (mapInfo === null) parseMapInfo()
    return mapInfo![mapID] ?? null
}

export function lookupMapNameFromLookup(lookupName: string) {
    if (mapInfo === null) parseMapInfo()

    for (var mapID in mapInfo!) {
        if (mapInfo![mapID].lookupName.toLowerCase() === lookupName.toLowerCase()) return mapInfo![mapID].name
    }
    return null
}

export function lookupMapName(mapID: number): string | null {
    if (mapInfo === null) parseMapInfo()

    return mapInfo![mapID].name || null
}

// maps.txt index of a map by file name, or -1.
export function mapIndexOf(mapName: string): number {
    if (mapInfo === null) parseMapInfo()
    for (const mapID in mapInfo!) {
        if (mapInfo![mapID].name.toLowerCase() === mapName.toLowerCase()) return Number(mapID)
    }
    return -1
}

function getMapInfo(mapName: string) {
    if (mapInfo === null) parseMapInfo()

    for (var mapID in mapInfo!) {
        if (mapInfo![mapID].name.toLowerCase() === mapName.toLowerCase()) return mapInfo![mapID]
    }
    return null
}

// CE ref: worldmap.cc wmSetMapMusic — script override of a map's music (maps.txt index).
export function setMapMusicOverride(mapIndex: number, music: string): void {
    if (mapInfo === null) parseMapInfo()
    const info = mapInfo![mapIndex]
    if (info) info.music = music.trim().toLowerCase()
}

// CE worldmap.cc wmMapMarkVisited: is MAP_SAVED set for this map?
export function mapIsSaved(mapName: string): boolean {
    const info = getMapInfo(mapName)
    return info ? info.saved : false
}

// CE worldmap.cc wmMapDeadBodiesAge
export function mapDeadBodiesAge(mapName: string): boolean {
    const info = getMapInfo(mapName)
    return info ? info.deadBodiesAge : false
}

// CE worldmap.cc wmMapCanRestHere
export function mapCanRestHere(elevation: number): boolean {
    const info = globalState.gMap?.name ? getMapInfo(globalState.gMap.name) : null
    return info ? info.canRestHere[elevation] !== false : true
}

export function getCurrentMapInfo() {
    return getMapInfo(globalState.gMap.name)
}
