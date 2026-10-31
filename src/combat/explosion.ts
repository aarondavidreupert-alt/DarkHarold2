/*
Copyright 2026

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

// Explosion helpers shared by combat (grenades, rockets, critical failures) and
// scripted explosions (actionExplode: dynamite, plastic explosives).

import { world } from '../state/world.js'
import { hexDistance, hexInDirection, Point } from '../geometry.js'
import { toTileNum } from '../tile.js'
import type { Critter } from '../object/Critter.js'
import type { Obj } from '../object/Obj.js'
import { combatIsShotBlocked } from './lineOfFire.js'

const OBJECT_SHOOT_THRU = 0x80000000
export const GRENADE_EXPLOSION_RADIUS = 2 // CE item.cc weaponGetGrenadeExplosionRadius default
export const ROCKET_EXPLOSION_RADIUS = 3 // CE item.cc weaponGetRocketExplosionRadius default

// CE combat.cc _compute_explosion_on_extras, the ring walk: rings around `center` (to
// radius 2 for a grenade, 3 otherwise) give up to 6 live critters (excluding
// `centerObj`) that are not shoot-through and have a clear line to the blast. The
// attacker may be among them (the caller makes that DAM_BACKWASH).
export function explosionRingCritters(
    center: Point,
    elevation: number,
    centerObj: Obj | null,
    isGrenade: boolean,
    maxTargets = 6,
): Critter[] {
    const gMap = world.gMap
    if (!gMap) return []
    const same = (p: Point, q: Point) => p.x === q.x && p.y === q.y
    const victims: Critter[] = []
    let radius = 0
    let rotation = 0
    let tile: Point | null = null
    let ringFirst: Point | null = center
    let ringIdx = 0
    let guard = 0
    while (victims.length < maxTargets && guard++ < 200) {
        if (radius !== 0 && (tile === null || !same((tile = hexInDirection(tile, rotation)), ringFirst!))) {
            ringIdx++
            if (ringIdx % radius === 0) {
                rotation += 1
                if (rotation === 6) rotation = 0 // ROTATION_NE
            }
        } else {
            radius++
            if (isGrenade && GRENADE_EXPLOSION_RADIUS < radius) tile = null
            else if (isGrenade || ROCKET_EXPLOSION_RADIUS >= radius)
                tile = hexInDirection(ringFirst!, 0) // ROTATION_NE
            else tile = null
            ringFirst = tile
            rotation = 2 // ROTATION_SE
            ringIdx = 0
        }
        if (tile === null) break

        const obstacle = gMap.blockingObjectAt(toTileNum(tile), elevation, 0, centerObj)
        if (obstacle === null || obstacle.type !== 'critter') continue
        const c = obstacle as Critter
        if (c.dead || (((c.flags ?? 0) >>> 0) & OBJECT_SHOOT_THRU) !== 0) continue
        if (combatIsShotBlocked(c, c.position, center, null).blocked) continue
        if (!victims.includes(c)) victims.push(c)
    }
    return victims
}

// CE actions.cc _compute_explosion_damage — d(min, max) − explosion DT, − DR%; the
// knockback is damage / 10 (none for multihex critters).
export function computeExplosionDamage(
    min: number,
    max: number,
    defender: Critter,
    roll: (a: number, b: number) => number,
): { damage: number; knockback: number } {
    let damage = roll(min, max) - (defender.getStat('DT Explosive') + defender.getArmorDT('Explosive'))
    if (damage > 0)
        damage -= Math.trunc(((defender.getStat('DR Explosive') + defender.getArmorDR('Explosive')) * damage) / 100)
    if (damage < 0) damage = 0
    const multihex = (((defender.flags ?? 0) >>> 0) & 0x800) !== 0
    return { damage, knockback: multihex ? 0 : Math.trunc(damage / 10) }
}

// CE scripts.cc _scr_explode_scenery — damage_p_proc (fixed param 20, no source, the
// explosion as target) for every item / scenery script and spatial within the rocket
// radius on the same elevation.
export function scriptsExplodeScenery(
    explosion: Obj,
    center: Point,
    elevation: number,
    run: (obj: Obj, target: Obj) => void,
): void {
    const gMap = world.gMap
    if (!gMap) return
    const objs: Obj[] = [...gMap.getObjects(elevation), ...(gMap.getSpatials(elevation) ?? [])]
    const hits = objs.filter(
        (o) =>
            o.type !== 'critter' &&
            o._script?.damage_p_proc !== undefined &&
            hexDistance(o.position, center) <= ROCKET_EXPLOSION_RADIUS,
    )
    for (const o of hits) run(o, explosion)
}
