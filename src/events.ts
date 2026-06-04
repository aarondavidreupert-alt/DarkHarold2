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

import globalState from './globalState.js'

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

const TURN_DURATION_MS = 5000

interface PendingExplosion {
    obj: any
    minDmg: number
    maxDmg: number
    radius: number
    turnsRemaining: number
}

// Explosions waiting on combat turn ticks (used only while in combat).
const pendingCombatExplosions: PendingExplosion[] = []

/**
 * Schedule an explosive to detonate after delayTurns game turns.
 * Outside combat we approximate 1 turn ≈ 5 real seconds via setTimeout.
 * In combat we register against the per-turn tick (see `tickCombatTurn`)
 * so the timer scales with actual turn count instead of wall clock.
 * obj must have an explode(source, minDmg, maxDmg, radius) method.
 */
export function scheduleExplosion(obj: any, minDmg: number, maxDmg: number, radius: number, delayTurns: number): void {
    if (globalState.inCombat) {
        console.log(`[Events] explosion scheduled in ${delayTurns} combat turn(s)`)
        pendingCombatExplosions.push({ obj, minDmg, maxDmg, radius, turnsRemaining: delayTurns })
        return
    }
    const delayMs = delayTurns * TURN_DURATION_MS
    console.log(`[Events] explosion scheduled in ${delayTurns} turn(s) (${delayMs / 1000}s)`)
    setTimeout(() => obj.explode(null, minDmg, maxDmg, radius), delayMs)
}

/**
 * Combat.nextTurn() calls this once per combatant turn so that pending
 * explosions tick down independently of wall-clock time.
 * CE ref: combat.cc combatTurnLoop — turn-driven event queue.
 */
export function tickCombatTurn(): void {
    if (pendingCombatExplosions.length === 0) return
    for (let i = pendingCombatExplosions.length - 1; i >= 0; i--) {
        const ev = pendingCombatExplosions[i]
        ev.turnsRemaining--
        if (ev.turnsRemaining <= 0) {
            pendingCombatExplosions.splice(i, 1)
            try { ev.obj.explode(null, ev.minDmg, ev.maxDmg, ev.radius) }
            catch (e) { console.warn('[Events] explosion detonation threw', e) }
        }
    }
}
