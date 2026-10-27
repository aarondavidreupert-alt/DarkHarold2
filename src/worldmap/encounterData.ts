// Random-encounter data from worldmap.txt — a port of the CE worldmap.cc parsers:
// wmConfigInit (the frequency values), wmParseTerrainTypes / wmParseTerrainRndMaps,
// wmReadEncounterType / wmParseEncounterTableIndex / wmParseEncounterSubEncStr (the
// [Encounter Table N] sections), wmReadEncBaseType / wmParseEncBaseSubTypeStr /
// wmParseEncounterItemType / wmParseItemType (the [Encounter: Name] sections, read
// when a table first names them, as in CE). The CE string parsers (string_parsers.cc
// strParseIntWithKey, strParseStrFromList, strParseStrFromFunc) are mirrored by a
// cursor over the lower-cased line. Conditions ("If(...) And If(...)") go through the
// encounter condition language (encounters/conditionLang.ts), which evaluates like
// wmEvalConditional.

import { mapIndexFromLookup } from '../data.js'
import * as Encounters from '../encounters.js'

// CE worldmap.cc wmFormationStrs / wmSceneryStrs (indices are the enum values)
export const FORMATIONS = ['surrounding', 'straight_line', 'double_line', 'wedge', 'cone', 'huddle']
export const FORMATION_SURROUNDING = 0
export const FORMATION_STRAIGHT_LINE = 1
export const FORMATION_DOUBLE_LINE = 2
export const FORMATION_WEDGE = 3
export const FORMATION_CONE = 4
export const FORMATION_HUDDLE = 5
const SCENERY = ['none', 'light', 'normal', 'heavy']
const SCENERY_NORMAL = 2

// CE EncounterItem
export interface EncItem {
    pid: number
    min: number
    max: number
    equipped: boolean
}

// CE EncounterEntry (one type_NN line of an [Encounter: Name] section)
export interface EncEntry {
    useRatio: boolean // ENCOUNTER_RATIO_MODE_USE_RATIO, else SINGLE
    ratio: number
    pid: number // -1: none
    dead: boolean // ENCOUNTER_SUBINFO_DEAD — parsed; CE never reads it
    distance: number
    tile: number
    items: EncItem[]
    scriptIdx: number // scripts.lst number (1-based), -1: none
    team: number // -1: keep the critter's
    cond: Encounters.Node[] | null
}

// CE Encounter ("enc base type": an [Encounter: Name] section)
export interface EncBaseType {
    name: string
    formation: number
    spacing: number
    distance: number
    entries: EncEntry[]
}

// CE EncounterTableSubEntry — "(min-max) Name [situation]"; baseType -1 = Player
export interface EncSubEntry {
    min: number
    max: number
    baseType: number
    situation: number
}

// CE EncounterTableEntry (one enc_NN line)
export interface EncTableEntry {
    chance: number
    counter: number // -1 unlimited
    special: boolean // ENCOUNTER_ENTRY_SPECIAL
    map: number // maps.txt index, -1: one of the table's / terrain's maps
    scenery: number
    subEntries: EncSubEntry[]
    cond: Encounters.Node[] | null
}

export interface EncTable {
    lookupName: string
    maps: number[]
    entries: EncTableEntry[]
}
export interface Terrain {
    name: string
    difficulty: number
    maps: number[]
}

export interface EncounterData {
    freqValues: { [name: string]: number } // [Data] forced / frequent / common / uncommon / rare / none
    terrains: Terrain[]
    tables: EncTable[]
    baseTypes: EncBaseType[]
}

const ENC_OP_STRS = ['nothing', 'ambush', 'fighting', 'and'] // CE wmEncOpStrs

// C atoi: leading spaces, sign, digits; 0 when there are none
function atoi(s: string): number {
    const m = s.match(/^\s*([+-]?\d+)/)
    return m ? parseInt(m[1], 10) : 0
}

class Cursor {
    constructor(
        public s: string,
        public i = 0,
    ) {}
    rest(): string {
        return this.s.slice(this.i)
    }
    done(): boolean {
        return this.i >= this.s.length
    }
}

// CE strParseIntWithKey: "key:value" at the cursor (after an optional comma and
// spaces) up to the next comma; on a match the cursor moves past it. A comma at the
// cursor is skipped either way.
function parseIntWithKey(c: Cursor, key: string): number | null {
    if (c.done()) return null
    if (c.s[c.i] === ',') c.i++
    let j = c.i
    while (c.s[j] === ' ') j++
    let end = c.s.indexOf(',', j)
    if (end === -1) end = c.s.length
    const field = c.s.slice(j, end)
    const colon = field.indexOf(':')
    let result: number | null = null
    if ((colon === -1 ? field : field.slice(0, colon)) === key) {
        result = atoi(colon === -1 ? '' : field.slice(colon + 1))
        c.i = end
    }
    if (c.s[c.i] === ',') c.i++
    return result
}

// CE strParseStrFromList / strParseStrFromFunc: the field up to the next comma (leading
// spaces skipped); the cursor moves past it and its comma.
function parseField(c: Cursor): string {
    let j = c.i
    while (c.s[j] === ' ') j++
    let end = c.s.indexOf(',', j)
    if (end === -1) end = c.s.length
    c.i = end < c.s.length ? end + 1 : end
    return c.s.slice(j, end)
}

// CE wmParseConditional (wmParseSubConditional needs "if" at the cursor, after an
// optional comma and spaces): the condition runs to the next comma.
function parseConditional(c: Cursor): Encounters.Node[] | null {
    if (c.done()) return null
    let j = c.i
    if (c.s[j] === ',') j++
    while (c.s[j] === ' ') j++
    if (!c.s.startsWith('if', j)) return null
    let end = c.s.indexOf(',', j)
    if (end === -1) end = c.s.length
    c.i = end
    try {
        return Encounters.parseConds(c.s.slice(j, end).trim())
    } catch {
        return null
    }
}

// CE wmParseItemType
function parseItemType(s: string): EncItem {
    let i = 0
    while (s[i] === ' ') i++
    const item: EncItem = { pid: 0, min: 1, max: 1, equipped: false }
    if (s[i] === '(') {
        i++
        item.min = atoi(s.slice(i))
        while (i < s.length && /\d/.test(s[i])) i++
        if (s[i] === '-') {
            i++
            item.max = atoi(s.slice(i))
            while (i < s.length && /\d/.test(s[i])) i++
        } else {
            item.max = item.min
        }
        if (s[i] === ')') i++
    }
    while (s[i] === ' ') i++
    item.pid = atoi(s.slice(i))
    while (i < s.length && /\d/.test(s[i])) i++
    const rest = s.slice(i)
    item.equipped =
        rest.includes('{wielded}') || rest.includes('(wielded)') || rest.includes('{worn}') || rest.includes('(worn)')
    return item
}

// CE wmParseEncounterItemType: an "item:..." field at the cursor
function parseEncounterItemType(c: Cursor, items: EncItem[]): boolean {
    if (c.done()) return false
    if (c.s[c.i] === ',') c.i++
    let j = c.i
    while (c.s[j] === ' ') j++
    let end = c.s.indexOf(',', j)
    if (end === -1) end = c.s.length
    const field = c.s.slice(j, end)
    const colon = field.indexOf(':')
    if ((colon === -1 ? field : field.slice(0, colon)) !== 'item') return false
    items.push(parseItemType(field.slice(colon + 1)))
    c.i = end < c.s.length ? end + 1 : end
    return true
}

// CE wmParseEncBaseSubTypeStr
function parseBaseSubType(str: string): EncEntry {
    const e: EncEntry = {
        useRatio: false,
        ratio: 100,
        pid: -1,
        dead: false,
        distance: 0,
        tile: -1,
        items: [],
        scriptIdx: -1,
        team: -1,
        cond: null,
    }
    const c = new Cursor(str.toLowerCase())
    const ratio = parseIntWithKey(c, 'ratio')
    if (ratio !== null) {
        e.ratio = ratio
        e.useRatio = true
    }
    if (c.rest().startsWith('dead,')) {
        e.dead = true
        c.i += 5
    }
    const pid = parseIntWithKey(c, 'pid')
    if (pid !== null) e.pid = pid === 0 ? -1 : pid
    const distance = parseIntWithKey(c, 'distance')
    if (distance !== null) e.distance = distance
    const tile = parseIntWithKey(c, 'tilenum')
    if (tile !== null) e.tile = tile
    for (let n = 0; n < 10; n++) {
        if (!c.rest().includes('item:')) break
        parseEncounterItemType(c, e.items)
    }
    const script = parseIntWithKey(c, 'script')
    if (script !== null) e.scriptIdx = script
    e.cond = parseConditional(c)
    return e
}

// CE wmParseEncounterSubEncStr: "enc:" at the cursor, then "(min-max) Name [situation]"
// groups up to the next comma.
function parseSubEncStr(entry: EncTableEntry, c: Cursor, data: EncounterData, ini: IniLookup): boolean {
    if (!c.s.startsWith('enc:', c.i)) return false
    const start = c.i + 4
    const comma = c.s.indexOf(',', start)
    const t = c.s.slice(start, comma === -1 ? c.s.length : comma)
    c.i = comma === -1 ? c.s.length : comma + 1

    let p = 0
    while (p < t.length) {
        const sub: EncSubEntry = { min: 1, max: 1, baseType: -1, situation: 0 }
        if (t[p] === '(') {
            p++
            sub.min = atoi(t.slice(p))
            while (p < t.length && t[p] !== '-') p++
            if (t[p] === '-') p++
            sub.max = atoi(t.slice(p))
            while (p < t.length && t[p] !== ')') p++
            if (t[p] === ')') p++
        }
        while (t[p] === ' ') p++
        let end = p
        while (end < t.length && t[end] !== ' ') end++
        const baseType = findSubEncType(t.slice(p, end).trim(), data, ini)
        if (baseType === null) return false
        sub.baseType = baseType
        p = end
        if (t[p] === ' ') p++
        end = p
        while (end < t.length && t[end] !== ' ') end++
        if (p < t.length) {
            const situation = ENC_OP_STRS.indexOf(t.slice(p, end))
            if (situation !== -1) sub.situation = situation
        }
        p = end
        entry.subEntries.push(sub)
        while (t[p] === ' ') p++
    }
    return true
}

// CE wmParseFindSubEncTypeMatch: "player" → -1, a known base type, or read it now
function findSubEncType(name: string, data: EncounterData, ini: IniLookup): number | null {
    if (name === 'player') return -1
    const known = data.baseTypes.findIndex((b) => b.name.toLowerCase() === name)
    if (known !== -1) return known
    return readBaseType(name, data, ini)
}

// CE wmReadEncBaseType: the [Encounter: Name] section's type_NN lines, team_num and
// "position=Formation, Spacing:n, Distance:n".
function readBaseType(name: string, data: EncounterData, ini: IniLookup): number | null {
    const section = ini.section('encounter: ' + name)
    if (!section || section.get('type_00') === undefined) return null
    const base: EncBaseType = { name, formation: FORMATION_SURROUNDING, spacing: 1, distance: -1, entries: [] }
    for (let n = 0; ; n++) {
        const line = section.get('type_' + String(n).padStart(2, '0'))
        if (line === undefined) break
        base.entries.push(parseBaseSubType(line))
    }
    // CE leaves `team` uninitialized without team_num; DH2 keeps the critters' teams.
    const team = section.get('team_num')
    if (team !== undefined) {
        for (const e of base.entries) if (((e.pid >>> 24) & 0xff) === 1) e.team = atoi(team)
    }
    const position = section.get('position')
    if (position !== undefined) {
        const c = new Cursor(position.toLowerCase())
        const f = FORMATIONS.indexOf(parseField(c).trim())
        if (f !== -1) base.formation = f
        const spacing = parseIntWithKey(c, 'spacing')
        if (spacing !== null) base.spacing = spacing
        const distance = parseIntWithKey(c, 'distance')
        if (distance !== null) base.distance = distance
    }
    data.baseTypes.push(base)
    return data.baseTypes.length - 1
}

// CE wmParseEncounterTableIndex
function parseTableEntry(str: string, data: EncounterData, ini: IniLookup): EncTableEntry {
    const e: EncTableEntry = {
        chance: 0,
        counter: -1,
        special: false,
        map: -1,
        scenery: SCENERY_NORMAL,
        subEntries: [],
        cond: null,
    }
    const c = new Cursor(str.toLowerCase())
    while (!c.done()) {
        const at = c.i
        const chance = parseIntWithKey(c, 'chance')
        if (chance !== null) e.chance = chance
        const counter = parseIntWithKey(c, 'counter')
        if (counter !== null) e.counter = counter
        if (c.rest().includes('special')) {
            e.special = true
            c.i += 7 // CE consumes "special" (+ its comma) at the cursor
            if (!c.done()) c.i++
        }
        const m = c.rest().indexOf('map:')
        if (m !== -1) {
            c.i += m + 4
            e.map = mapIndexFromLookup(parseField(c).trim())
        }
        if (!parseSubEncStr(e, c, data, ini)) break
        const sc = c.rest().indexOf('scenery:')
        if (sc !== -1) {
            c.i += sc + 8
            const s = SCENERY.indexOf(parseField(c).trim())
            if (s !== -1) e.scenery = s
        }
        e.cond = parseConditional(c) ?? e.cond
        if (c.i === at) break
    }
    return e
}

// Case-insensitive access to the parsed worldmap.txt sections
interface IniLookup {
    section(name: string): Map<string, string> | null
}
function iniLookup(ini: { [section: string]: { [key: string]: string } }): IniLookup {
    const sections = new Map<string, Map<string, string>>()
    for (const name in ini) {
        const keys = new Map<string, string>()
        for (const key in ini[name]) keys.set(key.toLowerCase(), ini[name][key])
        sections.set(name.trim().toLowerCase(), keys)
    }
    return { section: (name) => sections.get(name.toLowerCase()) ?? null }
}

// CE wmConfigInit (encounter part)
export function parseEncounterData(ini: { [section: string]: { [key: string]: string } }): EncounterData {
    const lookup = iniLookup(ini)
    const data: EncounterData = { freqValues: {}, terrains: [], tables: [], baseTypes: [] }

    const dataSection = lookup.section('data')
    for (const name of ['forced', 'frequent', 'common', 'uncommon', 'rare', 'none']) {
        const v = dataSection?.get(name)
        if (v !== undefined) data.freqValues[name] = atoi(v)
    }

    // wmParseTerrainTypes + wmParseTerrainRndMaps
    for (const part of (dataSection?.get('terrain_types') ?? '').toLowerCase().split(',')) {
        const [name, difficulty] = part.trim().split(':')
        if (!name) continue
        const terrain: Terrain = { name: name.trim(), difficulty: atoi(difficulty ?? ''), maps: [] }
        const rnd = lookup.section('random maps: ' + terrain.name)
        for (let n = 0; rnd && n < 20; n++) {
            const v = rnd.get('map_' + String(n).padStart(2, '0'))
            if (v === undefined) break
            terrain.maps.push(mapIndexFromLookup(v.trim()))
        }
        data.terrains.push(terrain)
    }

    // wmReadEncounterType for [Encounter Table 0..]
    for (let n = 0; ; n++) {
        const section = lookup.section('encounter table ' + n)
        const lookupName = section?.get('lookup_name')
        if (!section || lookupName === undefined) break
        const table: EncTable = { lookupName: lookupName.trim(), maps: [], entries: [] }
        const maps = section.get('maps')
        if (maps !== undefined) {
            const c = new Cursor(maps.toLowerCase())
            while (!c.done() && table.maps.length < 6) {
                const idx = mapIndexFromLookup(parseField(c).trim())
                if (idx === -1) break
                table.maps.push(idx)
            }
        }
        for (let e = 0; e < 40; e++) {
            const line = section.get('enc_' + String(e).padStart(2, '0'))
            if (line === undefined) break
            table.entries.push(parseTableEntry(line, data, lookup))
        }
        data.tables.push(table)
    }
    return data
}
