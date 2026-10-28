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

import { services } from './state/services.js'
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

// CE game_sound.h CharacterSoundEffect — the `extra` of sfxBuildCharName.
export const CHARACTER_SOUND_EFFECT = { unused: 0, knockdown: 1, passOut: 2, die: 3, contact: 4 } as const

// CE anim ids used for character sounds (animation.h).
export const ANIM = {
    climbLadder: 4,
    dodge: 13,
    hitFromFront: 14,
    hitFromBack: 15,
    throwPunch: 16,
    kickLeg: 17,
    fallBack: 20,
    fallFront: 21,
    takeOut: 38,
    putAway: 39,
} as const

// CE game_sound.cc:1318 sfxBuildCharName — critter art base name (6 chars) + the
// art code of `anim` for the weapon code currently held (fid bits 12-15). TAKE_OUT
// uses `extra` as the weapon code; falls with PASS_OUT/DIE and unarmed attacks
// with CONTACT replace the first code letter with 'Y'/'Z'.
export function sfxBuildCharName(
    critter: Obj,
    anim: number,
    extra: number = CHARACTER_SOUND_EFFECT.unused,
): string | null {
    const base = critter.art?.split('/').pop()?.slice(0, 6)
    if (!base) return null
    const code = artGetCode(anim, anim === ANIM.takeOut ? extra : critterWeaponCode(critter))
    if (!code) return null
    let first = code[0]
    if (anim === ANIM.fallFront || anim === ANIM.fallBack) {
        if (extra === CHARACTER_SOUND_EFFECT.passOut) first = 'Y'
        else if (extra === CHARACTER_SOUND_EFFECT.die) first = 'Z'
    } else if ((anim === ANIM.throwPunch || anim === ANIM.kickLeg) && extra === CHARACTER_SOUND_EFFECT.contact) {
        first = 'Z'
    }
    return (base + first + code[1]).toUpperCase()
}

// Shorthand: build and play a character sound.
export function playCharAnimSfx(critter: Obj, anim: number, extra: number = CHARACTER_SOUND_EFFECT.unused): void {
    playCharSfx(critter, sfxBuildCharName(critter, anim, extra))
}

// fid weapon code: the held weapon's proto animCode while one is in the active hand.
export function critterWeaponCode(critter: Obj): number {
    const weapon: any = (critter as any).equippedWeapon
    const animCode = weapon?.pro?.extra?.animCode
    return typeof animCode === 'number' && animCode > 0 && animCode < 11 ? animCode : 0
}

// CE game_sound.cc:1105-1150 — play `name`; if a human critter (H…/N…) has no
// sound of its own, try H<gender>XXXX<code> (HA… picks M/F by STAT_GENDER), then
// HMXXXX<code> for female critters. CE game_sound.cc:1161: the Lieutenant and the second
// mutant (MALIEU… / MAMTN2…) fall back to the generic mutant's MAMTNT….
export function playCharSfx(critter: Obj, name: string | null): void {
    const audio = services.audioEngine
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
    const head = name.slice(0, 6).toUpperCase()
    if (head === 'MALIEU' || head === 'MAMTN2') candidates.push(`MAMTNT${name.slice(6)}`)
    const found = candidates.find((c) => audio.hasSfx(c))
    dbg('audio', `[SFX] char ${name} → ${found ?? '(none)'}`)
    if (found) audio.playSfx(found.toLowerCase(), critter)
}

// Scenery/container action sound by CE name (no fallback in CE).
export function playOpenSfx(obj: Obj, action: number): void {
    const audio = services.audioEngine
    if (!audio) return
    const name = sfxBuildOpenName(obj, action)
    const ok = audio.hasSfx(name)
    dbg('audio', `[SFX] open ${name}${ok ? '' : ' (missing)'}`)
    if (ok) audio.playSfx(name.toLowerCase(), obj)
}

// CE game_sound.cc sfxBuildWeaponName: W<effect><weapon sound id><variant><material>XX1.
// effectType 0 ready / 1 attack / 2 out of ammo / 3 flame / 4 hit; variant 2 for an attack
// or hit in a mode other than the primary ones and the punch (CE hit modes 0, 2, 4);
// material X unless a hit on a target with a damage type other than plasma / EMP /
// explosion — then M / W / S from the item, scenery or wall material, F for a critter.
export function sfxBuildWeaponName(
    effectType: number,
    weapon: Obj | null | undefined,
    secondaryMode: boolean,
    target: Obj | null | undefined,
): string {
    const typeCode = 'RAOFH'[effectType] ?? 'A'
    const sid = weapon?.pro?.extra?.soundID
    const weaponCode = typeof sid === 'number' ? String.fromCharCode(sid) : 'A'
    const variant = (effectType === 1 || effectType === 4) && secondaryMode ? 2 : 1
    const dmg = weapon?.pro?.extra?.dmgType
    let material = 'X'
    if (effectType === 4 && target && dmg !== 3 /* plasma */ && dmg !== 5 /* EMP */ && dmg !== 6 /* explosion */) {
        const extra = target.pro?.extra
        const m =
            target.type === 'wall'
                ? extra?.material
                : target.type === 'item' || target.type === 'scenery'
                  ? extra?.materialID
                  : -1
        material = m === 0 || m === 1 || m === 2 ? 'M' : m === 3 ? 'W' : m === 4 || m === 5 || m === 6 ? 'S' : 'F'
    }
    return `W${typeCode}${weaponCode}${variant}${material}XX1`.toUpperCase()
}
