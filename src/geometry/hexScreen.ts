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

// Hex screen projection helpers split out of geometry.ts. See
// wiki/ts-split-refactor.md → "Per-file split proposals" §25.

// geometry constants
export const HEX_GRID_SIZE = 200 // hex grid is 200x200

export const HEX_WIDTH = 32;
export const HEX_HEIGHT = 16;

export interface Point {
    x: number
    y: number
}

interface Point3 {
    x: number
    y: number
    z: number
}

export interface BoundingBox {
    x: number
    y: number
    w: number
    h: number
}

export function hexToScreen(x: number, y: number): Point {
    var sx = 4816 - ((((x + 1) >> 1) << 5) + ((x >> 1) << 4) - (y << 4))
    var sy = 12 * (x >> 1) + y * 12 + 11

    return { x: sx, y: sy }
}

// CE ref: tile.cc:854 tileIsInFrontOf — tile a is rendered in front of
// (above in z order) tile b if `dx <= dy * -4` in screen coords.
export function hexIsInFrontOf(a: Point, b: Point): boolean {
    const sa = hexToScreen(a.x, a.y)
    const sb = hexToScreen(b.x, b.y)
    const dx = sb.x - sa.x
    const dy = sb.y - sa.y
    return dx <= dy * -4
}

// CE ref: tile.cc:871 tileIsToRightOf — tile a is to the right of tile b
// if `dx <= dy * 4/3` in screen coords.
export function hexIsToRightOf(a: Point, b: Point): boolean {
    const sa = hexToScreen(a.x, a.y)
    const sb = hexToScreen(b.x, b.y)
    const dx = sb.x - sa.x
    const dy = sb.y - sa.y
    return dx <= dy * 1.3333333333333335
}

/**
 * Conversion mouse pointer pixel coordinates to float cube https://www.redblobgames.com/grids/hexagons/#coordinates-cube
 * Useful for standard vector operations and existing algorithms like distances, rotation, reflection,
 * line drawing, conversion to/from screen coordinates, etc.
 * Third coord need only for algorithms and conversion to hex grid.
 *
 * Looks like parallelogram grid:
 *     z
 *  x __\___\___\__
 *       \   \   \
 *      __\___\___\__
 *         \   \   \
 *        __\___\___\__
 *           \   \   \
 *
 * @param point pixels
 * @return float 3d cartesian coordinates
 */
export function pixelToCube(point: Point): Point3 {
    let x = point.x / HEX_WIDTH - point.y / 3 / (HEX_HEIGHT / 2);
    let z = point.y / (HEX_HEIGHT * 3 / 4);
    return { x, y: -x - z, z };
}

/**
 * Rounding 3d cartesian coordinates to conversion hexagonal grid https://www.redblobgames.com/grids/hexagons/#rounding
 *
 *
 * * Looks like hexagon grid:
 *
 *      z  ___
 *    \___/   \___/
 *  x /   \___/   \
 *    \___/   \___/
 *    /   \___/   \
 *        /   \
 *
 *
 * @param cube float 3d cartesian coordinates
 * @return int 3d hexagonal coordinates
 */
export function cubeRound(cube: Point3): Point3 {
    let round = {
        x: Math.round(cube.x),
        y: Math.round(cube.y),
        z: Math.round(cube.z)
    };

    let diff = {
        x: Math.abs(round.x - cube.x),
        y: Math.abs(round.y - cube.y),
        z: Math.abs(round.z - cube.z)
    };

    if (diff.x > diff.y && diff.x > diff.z)
        round.x = -round.y - round.z;
    else if (diff.y > diff.z)
        round.y = -round.x - round.z;
    else
        round.z = -round.x - round.y;

    return round;
}

/**
 * Conversion round Cube to Hex with offset by tiles and map https://www.redblobgames.com/grids/hexagons/#conversions-offset
 *
 * @param cubeRound int 3d hexagonal coordinates
 * @returns int 2d hexagonal offset coordinates
 */
export function сubeRoundToHex(cubeRound: Point3): Point {
    let x = (cubeRound.x - 150) * (-1);
    let isEvenX = !(cubeRound.x & 1);
    let y = (cubeRound.z + (cubeRound.x - Number(isEvenX)) / 2 - 75) | 0;

    return { x, y };
}

/**
 * Conversion mouse pointer pixel coordinates to hex-offset
 *
 * @param x pixels
 * @param y pixels
 * @returns int 2d hexagonal offset coordinates
 */
export function hexFromScreen(x: number, y: number): Point {
    return сubeRoundToHex(cubeRound(pixelToCube({ x, y })));
}
