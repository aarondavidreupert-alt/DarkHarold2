/*
Copyright 2017 darkf

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

// Event manager

export module Events {
    export type EventHandler = (e: any) => void;

    const handlers: { [msgType: string]: EventHandler[] } = {};

    export function on(msgType: string, handler: EventHandler): void {
        if(msgType in handlers)
            handlers[msgType].push(handler);
        else
            handlers[msgType] = [handler];
    }

    export function emit(msgType: string, msg?: any): void {
        if(msgType in handlers) {
            for(const handler of handlers[msgType])
                handler(msg);
        }
    }
}

import globalState from './globalState.js'

const TURN_DURATION_MS = 5000

/**
 * Find the critter currently carrying `item` in their inventory,
 * or null if the item is on the ground / not held.
 * Checks the player, then all critters on the current map.
 * Uses duck-typing to avoid circular imports with object.ts.
 */
function findCarrier(item: any): any | null {
    const player = globalState.player as any
    if (player) {
        if (player.inventory && player.inventory.indexOf(item) !== -1) return player
        if (player.leftHand === item || player.rightHand === item || player.armor === item) return player
    }
    if (globalState.gMap) {
        for (const obj of globalState.gMap.getObjects()) {
            if (obj.type !== 'critter') continue
            if (obj.inventory && obj.inventory.indexOf(item) !== -1) return obj
        }
    }
    return null
}

/**
 * Schedule an explosive to detonate after delayTurns game turns.
 * Outside combat 1 turn ~ 5 real seconds; in combat the same wall-clock
 * duration is used (TODO: advance by combat turns instead).
 *
 * At detonation time the item's actual location is resolved: if it's
 * still in someone's inventory the explosion occurs at that critter's
 * position (fallout2-ce behavior). If it's been dropped on the map,
 * it explodes where it lies.
 */
export function scheduleExplosion(obj: any, minDmg: number, maxDmg: number, radius: number, delayTurns: number): void {
    const delayMs = delayTurns * TURN_DURATION_MS
    console.log(`[Events] explosion scheduled in ${delayTurns} turn(s) (${delayMs / 1000}s)`)
    setTimeout(() => {
        const carrier = findCarrier(obj)
        if (carrier) {
            obj.position = { x: carrier.position.x, y: carrier.position.y }
            const idx = carrier.inventory.indexOf(obj)
            if (idx !== -1) carrier.inventory.splice(idx, 1)
        }
        obj.explode(null, minDmg, maxDmg, radius)
    }, delayMs)
}
