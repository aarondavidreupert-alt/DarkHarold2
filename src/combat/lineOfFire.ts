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

// Line-of-fire walks used by ranged attacks (CE combat.cc). All of them step along
// _make_straight_path_func with _obj_shoot_blocking_at (GameMap.straightPathObstacle,
// blockType 1), restarting from each obstacle's tile and skipping that obstacle.

import { hexDirectionTo, hexInDirection, Point } from '../geometry.js'
import globalState from '../globalState.js'
import type { Critter, Obj } from '../object.js'

const OBJECT_MULTIHEX = 0x800
const DAM_KNOCKED_OUT = 0x01
const DAM_KNOCKED_DOWN = 0x02

const samePos = (a: Point, b: Point) => a.x === b.x && a.y === b.y
const flagsOf = (o: Obj) => (((o as any).flags ?? 0) >>> 0)

export function nextShootObstacle(source: Obj, from: Point, to: Point, prev: Obj | null): Obj | null {
    return globalState.gMap?.straightPathObstacle(source, from, to, 1, prev) ?? null
}

// CE combat.cc:5897 _combat_is_shot_blocked — true when a non-critter (other than the
// target) stands on the line; also counts the live, standing critters on it (multihex
// ones twice; SFALL fix kept by CE) for attackDetermineToHit's -10 per critter.
export function combatIsShotBlocked(source: Obj, from: Point, to: Point, target: Obj | null): { blocked: boolean; critters: number } {
    let critters = 0
    let obstacle: Obj | null = source
    let current = from
    while (obstacle !== null && !samePos(current, to)) {
        obstacle = nextShootObstacle(source, current, to, obstacle)
        if (obstacle === null) break
        if (obstacle.type !== 'critter' && obstacle !== target) return { blocked: true, critters }

        if (obstacle !== target && target !== null) {
            const c = obstacle as Critter
            const results = c.injuryFlags ?? 0
            const down = c.dead || c.isKnockedDown || (results & (DAM_KNOCKED_OUT | DAM_KNOCKED_DOWN)) !== 0
            if (!down) {
                critters += 1
                if ((flagsOf(obstacle) & OBJECT_MULTIHEX) !== 0) critters += 1
            }
        }

        current = obstacle.position
        if ((flagsOf(obstacle) & OBJECT_MULTIHEX) !== 0 && !samePos(current, to)) {
            current = hexInDirection(current, hexDirectionTo(current, to))
        }
    }
    return { blocked: false, critters }
}
