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

// CE game_sound.cc _gsound_compute_relative_volume: an item / critter / scenery sound (its
// carrier's, if carried) plays at full volume while the source is on screen; off screen,
// full up to the dude's PE in hexes, falling linearly to 1/3 at 2 x PE, 1/3 beyond.

import { world } from './state/world.js'
import { hexDistance, hexToScreen } from './geometry.js'
import type { Obj } from './object.js'
import { objectBoundingBox, SCREEN_HEIGHT, SCREEN_WIDTH, worldToScreen } from './renderer.js'

// CE _gsound_compute_relative_volume measures from objectGetOwner(obj): the top of the owner
// chain, so an item in a bag the player carries sounds from the player, one in a chest on the
// ground from the chest. DH2 objects have no owner link, so the holder is searched: the player,
// then every map object that holds it, inventories nested to any depth. An item's position does
// not tell: every object starts at { x: -1, y: -1 } and a picked-up item keeps its old map hex.
// Only items can be held.
function holds(holder: any, obj: Obj): boolean {
    if (!holder) {
        return false
    }
    if (holder.leftHand === obj || holder.rightHand === obj || holder.armor === obj) {
        return true
    }
    return (holder.inventory ?? []).some((item: any) => item === obj || holds(item, obj))
}

function carrier(obj: Obj): Obj {
    if (obj.type !== 'item') {
        return obj
    }
    const player = world.player
    if (holds(player, obj)) {
        return player!
    }
    return world.gMap?.getObjects().find((o) => o !== obj && holds(o, obj)) ?? obj
}

// Volume factor 0..1 (CE 0x7FFF = 1)
export function soundSourceVolume(obj: Obj | null | undefined): number {
    if (!obj || (obj.type !== 'item' && obj.type !== 'critter' && obj.type !== 'scenery')) return 1
    const source = carrier(obj)
    const player = world.player
    if (!player || !source.position) return 1
    let bbox = null
    try {
        bbox = objectBoundingBox(source)
    } catch {
        bbox = null
    }
    if (bbox) {
        const a = worldToScreen(bbox.x, bbox.y)
        const b = worldToScreen(bbox.x + bbox.w, bbox.y + bbox.h)
        if (b.x >= 0 && a.x < SCREEN_WIDTH && b.y >= 0 && a.y < SCREEN_HEIGHT) return 1 // on screen
    } else {
        // art not loaded yet: the hex itself
        const w = hexToScreen(source.position.x, source.position.y)
        const p = worldToScreen(w.x, w.y)
        if (p.x >= 0 && p.x < SCREEN_WIDTH && p.y >= 0 && p.y < SCREEN_HEIGHT) return 1
    }
    const distance = hexDistance(source.position, player.position)
    const perception = player.getStat('PER')
    if (distance <= perception) return 1
    if (distance < 2 * perception)
        return (0x7fff - Math.trunc((0x5554 * (distance - perception)) / perception)) / 0x7fff
    return 0x2aaa / 0x7fff
}
