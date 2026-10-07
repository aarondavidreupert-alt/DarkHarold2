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

import { getLstJson } from "./data.js"
import globalState from "./globalState.js"
import { dbg } from "./logger.js"

// Functions handling FO2 prototypes and lookups performed on them

function getPROType(pid: number) {
    const map: { [pid: number]: string } = {0: 'items', 1: 'critters', 2: 'scenery', 3: 'walls', 4: 'tiles', 5: 'misc'}
    return map[(pid >> 24) & 0xff]
}

export function loadPRO(pid: number, pidID: number) {
    if(!globalState.proMap)
        return null

    // use the proto/ .lst files to look up type/pid
    const type = getPROType(pid)
    const lsts: { [lst: string]: string } = {
                "items": "proto/items/items", "critters": "proto/critters/critters",
                "scenery": "proto/scenery/scenery", "misc": "proto/misc/misc",
                "walls": "proto/walls/walls"}
    const id = lsts[type] ? parseInt(getLstJson(lsts[type], pidID - 1)!.split(".")[0], 10) : pidID

    return globalState.proMap[type][id]
}

export function getPROTypeName(type: number): 'item' | 'critter' | 'scenery' | 'wall' | 'tile' | 'misc' {
    // singular
    const map: { [type: number]: 'item' | 'critter' | 'scenery' | 'wall' | 'tile' | 'misc' } = {0: 'item', 1: 'critter', 2: 'scenery', 3: 'wall', 4: 'tile', 5: 'misc'}
    return map[type]
}

export function getPROSubTypeName(type: number): string {
    const map: { [type: number]: string } = {0: 'armor', 1: 'container', 2: 'drug', 3: 'weapon', 4: 'ammo', 5: 'misc', 6: 'key'}
    return map[type]
}

export function makePID(type: number, pid: number) {
    return (type << 24) | pid
}

// Critter animations that CE redirects to the critter's alias art (critters.lst
// 2nd field — stored as `walk` in lut/lst/art_critters.json).
// CE ref: art.cc:904 artAliasFid()
const ALIASED_CRITTER_ANIMS = [27, 29, 30, 55, 57, 58, 33, 64]

// Port of CE art.cc:544 _art_get_code(). Returns [weaponCode, animCode] or null.
function artGetCode(animation: number, weaponType: number): [string, string] | null {
    const chr = (base: string, off: number) => String.fromCharCode(base.charCodeAt(0) + off)
    if (weaponType < 0 || weaponType >= 11) return null
    if (animation >= 38 && animation <= 47) { // ANIM_TAKE_OUT..ANIM_FIRE_CONTINUOUS
        if (weaponType === 0) return null
        return [chr('d', weaponType - 1), chr('c', animation - 38)]
    }
    if (animation === 36) return ['c', 'h'] // ANIM_PRONE_TO_STANDING
    if (animation === 37) return ['c', 'j'] // ANIM_BACK_TO_STANDING
    if (animation === 64) return ['n', 'a'] // ANIM_CALLED_SHOT_PIC
    if (animation >= 48) return ['r', chr('a', animation - 48)] // FIRST_SF_DEATH_ANIM
    if (animation >= 20) return ['b', chr('a', animation - 20)] // FIRST_KNOCKDOWN_AND_DEATH_ANIM
    if (animation === 18) { // ANIM_THROW_ANIM
        if (weaponType === 1) return ['d', 'm'] // knife
        if (weaponType === 4) return ['g', 'm'] // spear
        return ['a', 's']
    }
    if (animation === 13) // ANIM_DODGE_ANIM
        return weaponType <= 0 ? ['a', 'n'] : [chr('d', weaponType - 1), 'e']
    const animCode = chr('a', animation)
    if (animation <= 1 && weaponType > 0) return [chr('d', weaponType - 1), animCode]
    return ['a', animCode]
}

// Port of CE art.cc:615 artBuildFilePath() for OBJ_TYPE_CRITTER (without extension).
// Previously threw "reindex(?)" / "0x14" etc. for death, dodge and throw animations.
function getCritterArtPath(frmPID: number) {
    dbg('object', "FRM PID: " + frmPID)
    var idx = (frmPID & 0x00000fff)
    var weaponType = (frmPID & 0x0000f000) >> 12
    var anim = (frmPID & 0x00ff0000) >> 16

    if (ALIASED_CRITTER_ANIMS.includes(anim)) {
        const alias = getLstJson("art/critters/critters", idx)?.walk
        if (typeof alias === 'number' && alias > 0) idx = alias
        else {
            // CE falls back to the vault-dweller art when the lst line has no alias.
            for (let i = 1, e; (e = getLstJson("art/critters/critters", i)) !== null; i++)
                if (e.frm?.toLowerCase() === 'hmjmps') { idx = i; break }
        }
    }

    const code = artGetCode(anim, weaponType)
    if (code === null)
        throw `getCritterArtPath: no art code for anim=${anim} weapon=${weaponType}`

    return "art/critters/" + getLstJson("art/critters/critters", idx)!.frm.toLowerCase() + code[0] + code[1]
}

export function lookupInterfaceArt(idx: number) {
    return "art/intrface/" + getLstJson("art/intrface/intrface", idx)!.toLowerCase()
}

export function lookupArt(frmPID: number) {
    var type = getPROType(frmPID)
    var pidID = frmPID & 0xffff

    if(type === "critters")
        return getCritterArtPath(frmPID)

    var lsts: { [lst: string]: string } = {
                "items": "art/items/items",
                "scenery": "art/scenery/scenery",
                "walls": "art/walls/walls",
                "tiles": "art/tiles/tiles",
                "misc": "art/misc/misc"}
    var path = "art/" + type + "/" + getLstJson(lsts[type], pidID)!

    // console.log("LOOKUP ART: " + path)
    return path.toLowerCase()
}
