/*
Copyright 2014 darkf, Stratege

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

// Hex grid topology + lines + bbox predicates split out of geometry.ts.
// See wiki/ts-split-refactor.md → "Per-file split proposals" §25.

import { dbgWarn } from '../logger.js'
import {
    HEX_GRID_SIZE,
    Point,
    BoundingBox,
    hexToScreen,
    hexFromScreen,
} from './hexScreen.js'

interface Point3 {
    x: number
    y: number
    z: number
}

export function hexNeighbors(position: Point): Point[] {
    const neighbors: Point[] = []
    var x = position.x
    var y = position.y

    function n(x: number, y: number) {
        neighbors.push({ x: x, y: y })
    }

    if (x % 2 === 0) {
        n(x - 1, y)
        n(x - 1, y + 1)
        n(x, y + 1)
        n(x + 1, y + 1)
        n(x + 1, y)
        n(x, y - 1)
    } else {
        n(x - 1, y - 1)
        n(x - 1, y)
        n(x, y + 1)
        n(x + 1, y)
        n(x + 1, y - 1)
        n(x, y - 1)
    }

    return neighbors
}

export function hexInDirection(position: Point, dir: number): Point {
    return hexNeighbors(position)[dir]
}

// CE ref: tile.cc:893 tileGetTileInDirection — stops at grid edge via tileIsEdge()
function hexIsEdge(p: Point): boolean {
    return p.x <= 0 || p.y <= 0 || p.x >= HEX_GRID_SIZE - 1 || p.y >= HEX_GRID_SIZE - 1
}

export function hexInDirectionDistance(position: Point, dir: number, distance: number): Point {
    if (distance === 0) {
        return position
    }

    let tile = hexInDirection(position, dir)
    // repeat for each further distance, stopping at grid edge
    for (var i = 0; i < distance - 1; i++) {
        if (hexIsEdge(tile)) break
        tile = hexInDirection(tile, dir)
    }
    return tile
}

export function directionOfDelta(xa: number, ya: number, xb: number, yb: number): number | null {
    let neighbors = hexNeighbors({ x: xa, y: ya })
    for (var i = 0; i < neighbors.length; i++) {
        if (neighbors[i].x === xb && neighbors[i].y === yb) return i
    }

    return null
}

function hexGridToCube(grid: Point): Point3 {
    //even-q layout -> cube layout
    var z = grid.y - (grid.x + (grid.x & 1)) / 2
    var y = -grid.x - z
    return { x: grid.x, y: y, z: z }
}

export function hexDistance(a: Point, b: Point): number {
    // we convert our hex coordinates into cube coordinates and then
    // we only have to see which of the 3 axes is the longest

    var cubeA = hexGridToCube(a)
    var cubeB = hexGridToCube(b)
    return Math.max(Math.abs(cubeA.x - cubeB.x), Math.abs(cubeA.y - cubeB.y), Math.abs(cubeA.z - cubeB.z))
}

// Direction between hexes a and b
export function hexDirectionTo(a: Point, b: Point): number {
    // CE ref: tile.cc:910 tileGetRotationTo — project both tiles to screen space before atan2;
    // using grid-space delta was wrong because the grid x-axis inverts relative to screen-x.
    const sa = hexToScreen(a.x, a.y)
    const sb = hexToScreen(b.x, b.y)
    const dx = sb.x - sa.x
    const dy = sb.y - sa.y
    if (dx !== 0) {
        const angle = (Math.atan2(-dy, dx) * 180) / Math.PI
        let temp = (90 - angle) | 0
        if (temp < 0) temp += 360
        return Math.min((temp / 60) | 0, 5)
    }
    return dy < 0 ? 0 : 2 // dy<0=up=NE(0), dy>0=down=SE(2)
}

function hexOppositeDirection(direction: number) {
    return (direction + 3) % 6
}

// The adjacent hex around a nearest to b
export function hexNearestNeighbor(a: Point, b: Point) {
    var neighbors = hexNeighbors(a)
    var min = Infinity,
        minIdx = -1
    for (var i = 0; i < neighbors.length; i++) {
        var dist = hexDistance(neighbors[i], b)
        if (dist < min) {
            min = dist
            minIdx = i
        }
    }
    if (minIdx === -1) return null
    return { hex: neighbors[minIdx], distance: min, direction: minIdx }
}

// Draws a line between a and b, returning the list of coordinates (including b)
export function hexLine(a: Point, b: Point): Point[] {
    var path = []
    var position: Point = { x: a.x, y: a.y }

    while (true) {
        path.push(position)
        if (position.x === b.x && position.y === b.y) return path
        var nearest = hexNearestNeighbor(position, b)
        if (nearest === null) return null
        position = nearest.hex
    }

    // throw "unreachable"
}

/**
 * CE ref: tile.cc:944 _tile_num_beyond — walks a Bresenham screen-space line from
 * `from` toward `to` and returns the hex that is `distance` tile-transitions past `from`.
 * Used for projectile overshoot and shoot_into_the_air.
 */
export function hexLineBeyond(from: Point, to: Point, distance: number): Point {
    if (distance <= 0 || (from.x === to.x && from.y === to.y)) return from

    const fromSc = hexToScreen(from.x, from.y)
    let tileX = fromSc.x + 16
    let tileY = fromSc.y + 8
    const toSc = hexToScreen(to.x, to.y)
    const toX = toSc.x + 16
    const toY = toSc.y + 8

    const deltaX = toX - tileX
    const deltaY = toY - tileY
    const absX2 = 2 * Math.abs(deltaX)
    const absY2 = 2 * Math.abs(deltaY)
    const stepX = deltaX > 0 ? 1 : deltaX < 0 ? -1 : 0
    const stepY = deltaY > 0 ? 1 : deltaY < 0 ? -1 : 0

    let prevHex = from
    let count = 0

    if (absX2 > absY2) {
        let middle = absY2 - absX2 / 2
        while (true) {
            const cur = hexFromScreen(tileX, tileY)
            if (cur.x !== prevHex.x || cur.y !== prevHex.y) {
                count++
                if (count === distance || hexIsEdge(cur)) return cur
                prevHex = cur
            }
            if (middle >= 0) { middle -= absX2; tileY += stepY }
            middle += absY2
            tileX += stepX
        }
    } else {
        let middle = absX2 - absY2 / 2
        while (true) {
            const cur = hexFromScreen(tileX, tileY)
            if (cur.x !== prevHex.x || cur.y !== prevHex.y) {
                count++
                if (count === distance || hexIsEdge(cur)) return cur
                prevHex = cur
            }
            if (middle >= 0) { middle -= absY2; tileX += stepX }
            middle += absX2
            tileY += stepY
        }
    }
}

export function hexesInRadius(center: Point, radius: number) {
    var hexes = []
    for (var x = 0; x < 200; x++) {
        for (var y = 0; y < 200; y++) {
            if (x === center.x && y === center.y) continue
            var pos = { x: x, y: y }
            if (hexDistance(center, pos) <= radius) hexes.push(pos)
        }
    }
    return hexes
}

export function pointInBoundingBox(point: Point, bbox: BoundingBox) {
    return bbox.x <= point.x && point.x <= bbox.x + bbox.w && bbox.y <= point.y && point.y <= bbox.y + bbox.h
}

export function tile_in_tile_rect(tile: Point, a: Point, b: Point, c: Point, d: Point) {
    //our rect looks like this:
    //a - - - - b
    //.			.
    //.			.
    //.			.
    //d - - - - c
    //or like this:
    //		a
    //    .   .
    //  .       .
    //d 		  b
    //  .       .
    //    .   .
    //		c
    //these are the only possibilities that give sensical rectangles,
    // anything else involves guessing of tiles on the borders anyway
    //if I get the topmost position and check if it's below that
    //and get the downmost position and check if it's above that
    //and get the leftmost position and check if it's to the right of that
    //and the rightmost and check if it's to the left of that
    //then I do get inside a rect
    //but not a rect where my points are necessarily corner points.

    //assumption: well behaved rectangle in a grid
    //a = min x, min y
    //b = min x, max y
    //c = max x, max y
    //d = max x, min y
    var error = false
    if (c.x != d.x || a.x != b.x || a.x > c.x) error = true
    if (a.y != d.y || b.y != c.y || a.y > c.y) error = true
    if (error) {
        dbgWarn('object', `[Geometry] pointInRect: not a rectangle: (${a.x},${a.y}), (${b.x},${b.y}), (${c.x},${c.y}), (${d.x},${d.y})`)
        return false
    }
    var inside = true
    if (tile.x <= a.x || tile.x >= c.x) inside = false
    if (tile.y <= a.y || tile.y >= c.y) inside = false

    return inside
}

function tile_in_tile_rect2(tile: Point, a: Point, c: Point) {
    var b = { x: a.x, y: c.y }
    var d = { x: c.x, y: a.y }
    return tile_in_tile_rect(tile, a, b, c, d)
}

export function pointIntersectsCircle(center: Point, radius: number, point: Point): boolean {
    return Math.abs(point.x - center.x) <= radius && Math.abs(point.y - center.y) <= radius
}
