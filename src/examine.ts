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

// Look at / examine — CE proto_instance.cc _obj_look_at_func and _obj_examine_func.
// Both run the target's script proc first (look_at_p_proc / description_p_proc);
// a script that calls script_overrides suppresses the engine text. Lines are
// returned for the caller to print (CE passes the display-monitor callback).

import globalState from './globalState.js'
import type { Critter, Obj } from './object.js'
import { randomBetween } from './random.js'
import { Scripting } from './scripting.js'
import { getMessage } from './util.js'
import { ammoGetCapacity, ammoGetQuantity, weaponGetAmmoTypePid } from './weaponAmmo.js'
import { loadPRO } from './pro.js'
import { Worldmap } from './worldmap.js'

const PROTO_ID_CAR = 0x020003f1
const GVAR_PLAYER_GOT_CAR = 18
const CAR_FUEL_MAX = 80000

const protoMsg = (n: number): string => getMessage('proto', n) ?? ''
// C printf subset used by proto.msg: %s, %d, %%.
function format(fmt: string, ...args: (string | number)[]): string {
    let i = 0
    return fmt.replace(/%%|%[sd]/g, (m) => (m === '%%' ? '%' : String(args[i++] ?? '')))
}

const isCritter = (o: Obj): o is Critter => o.type === 'critter'
const isDead = (o: Obj): boolean => isCritter(o) && !!o.dead
// CE critter.cc critterIsCrippled — DAM_CRIP = any crippled leg/arm or DAM_BLIND.
const isCrippled = (c: Critter): boolean =>
    !!(c.crippledLeftLeg || c.crippledRightLeg || c.crippledLeftArm || c.crippledRightArm || c.isBlinded)

function protoName(pid: number): string {
    if (pid < 0) return ''
    const pro: any = loadPRO(pid, pid & 0xffff)
    return pro ? getMessage('pro_item', pro.textID) ?? '' : ''
}

// CE _obj_look_at_func: "You see: %s." (dead critters: 491/492 at random).
export function objLookAt(viewer: Critter, target: Obj): string[] {
    if (viewer.dead) return []
    if (Scripting.lookAt(target, viewer)) return []
    const msg = isDead(target) ? protoMsg(491 + randomBetween(0, 1)) : protoMsg(490)
    return msg ? [format(msg, target.getName())] : []
}

// CE _obj_examine_func.
export function objExamine(viewer: Critter, target: Obj): string[] {
    if (viewer.dead) return []
    const out: string[] = []

    if (!Scripting.description(target, viewer)) {
        let description: string | null = target.getDescription()
        if (description === '<None>') description = null
        if (!description) out.push(protoMsg(493))
        else if (!isDead(target)) out.push(description)
    }

    const player = globalState.player
    if (!player || viewer !== player) return out

    if (isCritter(target)) {
        const maxHp = target.getStat('Max HP')
        const hp = target.getStat('HP')
        let text: string
        if (target !== player && player.hasPerk('Awareness') && !target.dead) {
            const biped = ((target.pro?.extra?.bodyType ?? 0) as number) === 0
            const hpMsg = protoMsg(biped ? 535 + target.getStat('Gender') : 537)
            const item2: Obj | null = (target as any).rightHand ?? null
            const weapon = item2 && item2.subtype === 'weapon' ? item2 : null
            if (weapon) {
                const caliber = weapon.pro?.extra?.caliber ?? 0
                if (caliber !== 0) {
                    text = format(hpMsg + protoMsg(547), hp, maxHp, weapon.getName(),
                        ammoGetQuantity(weapon), ammoGetCapacity(weapon), protoName(weaponGetAmmoTypePid(weapon)))
                } else {
                    text = format(hpMsg + protoMsg(546), hp, maxHp, weapon.getName())
                }
            } else {
                text = format(hpMsg, hp, maxHp) + protoMsg(isCrippled(target) ? 544 : 545)
            }
        } else {
            const crippled = isCrippled(target) ? -2 : 0
            let level: number
            if (hp <= 0 || target.dead) level = 0
            else if (hp === maxHp) level = 4
            else level = Math.trunc((hp * 3) / maxHp) + 1
            if (level > 4) return out // CE: "lookup_val out of range" (debug only)
            const hpText = protoMsg(500 + level)
            text = target === player
                ? format(protoMsg(520 + crippled), hpText)
                : format(protoMsg(522 + target.getStat('Gender')), hpText)
        }
        if (isCrippled(target)) {
            let n = maxHp >= hp ? 531 : 530
            if (target === player) n += 2
            text += protoMsg(n)
        }
        out.push(text)
    } else if (target.type === 'scenery') {
        if (target.pid === PROTO_ID_CAR) {
            const gotCar = (Scripting.getGlobalVar(GVAR_PLAYER_GOT_CAR) ?? 0) !== 0
            out.push(gotCar
                ? format(protoMsg(549), Math.trunc((100 * Worldmap.getCarFuel()) / CAR_FUEL_MAX))
                : protoMsg(548))
        }
    } else if (target.type === 'item') {
        if (target.subtype === 'weapon') {
            if ((target.pro?.extra?.caliber ?? 0) !== 0) {
                out.push(format(protoMsg(526), ammoGetQuantity(target), ammoGetCapacity(target), protoName(weaponGetAmmoTypePid(target))))
            }
        } else if (target.subtype === 'ammo') {
            const e = target.pro?.extra ?? {}
            out.push(format(protoMsg(510), e['AC modifier'] ?? 0))
            out.push(format(protoMsg(511), e['DR modifier'] ?? 0))
            out.push(format(protoMsg(512), e.damMult ?? 1, e.damDiv ?? 1))
        }
    }
    return out
}
