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

// Sound-effect names for object and character actions — CE game_sound.cc
// sfxBuildOpenName / sfxBuildCharName, plus the human-critter fallback of
// gameSoundPlayFile (game_sound.cc:1115).

import globalState from './globalState.js'
import { dbg } from './logger.js'
import type { Obj } from './object.js'
import { artGetCode } from './pro.js'

// CE game_sound.cc:92 _snd_lookup_scenery_action
export const SCENERY_SOUND_EFFECT = { open: 0, closed: 1, locked: 2, unlocked: 3, used: 4 } as const
const SCENERY_ACTION_CODES = ['O', 'C', 'L', 'N', 'U']

// CE game_sound.cc sfxBuildOpenName — scenery "S<action>DOORS<id>", items
// (containers) "I<action>CNTNR<id>", <id> = the proto's sound id character.
export function sfxBuildOpenName(obj: Obj, action: number): string {
    const act = SCENERY_ACTION_CODES[action] ?? 'O'
    const id = obj.pro?.extra?.soundID
    // CE uses the raw byte (0 ends the string → no such file); 'A' only without a proto.
    const idChar = typeof id === 'number' ? (id > 0 ? String.fromCharCode(id) : '') : 'A'
    return (obj.type === 'scenery' ? `S${act}DOORS${idChar}` : `I${act}CNTNR${idChar}`).toUpperCase()
}

// CE game_sound.cc:1318 sfxBuildCharName — critter art base name (6 chars) + the
// art code of `anim` for the weapon code currently held (fid bits 12-15).
export function sfxBuildCharName(critter: Obj, anim: number, weaponCode?: number): string | null {
    const base = critter.art?.split('/').pop()?.slice(0, 6)
    if (!base) return null
    const code = artGetCode(anim, weaponCode ?? critterWeaponCode(critter))
    if (!code) return null
    return (base + code[0] + code[1]).toUpperCase()
}

// fid weapon code: the held weapon's proto animCode while one is in the active hand.
function critterWeaponCode(critter: Obj): number {
    const weapon: any = (critter as any).equippedWeapon
    const animCode = weapon?.pro?.extra?.animCode
    return typeof animCode === 'number' && animCode > 0 && animCode < 11 ? animCode : 0
}

// CE game_sound.cc:1105-1150 — play `name`; if a human critter (H…/N…) has no
// sound of its own, try H<gender>XXXX<code> (HA… picks M/F by STAT_GENDER), then
// HMXXXX<code> for female critters.
export function playCharSfx(critter: Obj, name: string | null): void {
    const audio = globalState.audioEngine
    if (!audio || !name) return
    const candidates = [name]
    if (critter.type === 'critter' && (name[0] === 'H' || name[0] === 'N')) {
        let g = name[1]
        if (g === 'A' || g === 'F' || g === 'M') {
            if (g === 'A') g = (critter as any).gender === 'female' ? 'F' : 'M'
            candidates.push(`H${g}XXXX${name.slice(6)}`)
            if (g === 'F') candidates.push(`HMXXXX${name.slice(6)}`)
        }
    }
    const found = candidates.find((c) => audio.hasSfx(c))
    dbg('audio', `[SFX] char ${name} → ${found ?? '(none)'}`)
    if (found) audio.playSfx(found.toLowerCase())
}

// Scenery/container action sound by CE name (no fallback in CE).
export function playOpenSfx(obj: Obj, action: number): void {
    const audio = globalState.audioEngine
    if (!audio) return
    const name = sfxBuildOpenName(obj, action)
    const ok = audio.hasSfx(name)
    dbg('audio', `[SFX] open ${name}${ok ? '' : ' (missing)'}`)
    if (ok) audio.playSfx(name.toLowerCase())
}
