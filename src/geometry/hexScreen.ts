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

// Integer axial (i along screen +E=(32,0), j along +SE=(16,12)) → offset (col,row).
// Inverse of the packing used by the shader's hex-lerp; exact for integer axial.
// hexToScreen(0,0) = (4816, 11) is the lattice origin.
function axialToOffset(i: number, j: number): Point {
    const sx = 4816 + 32 * i + 16 * j
    const sy = 11 + 12 * j
    const hx = 150.0416667 - (sx / 32 - sy / 24)
    const col = Math.round(hx)
    const cy = ((((col % 2) + 2) % 2) < 0.5) ? -75.9375 : -75.4375
    const hy = sx / 64 + sy / 16 + cy
    return { x: col, y: Math.round(hy) }
}

// Distribute a world-space point across the 3 nearest hex tiles with barycentric
// weights (summing to 1) — the same axial triangle the fragment shader's hex-lerp
// uses (wiki/alignment.md §7). Used to fractionally stamp a moving light source
// (player torch) across the tiles under its animated position so the lightmap
// centre moves smoothly sub-tile instead of snapping on tile arrival. §9.
export function worldToHexBarycentric(wx: number, wy: number): { x: number; y: number; w: number }[] {
    const aj = (wy - 11) / 12
    const ai = ((wx - 4816) - 16 * aj) / 32
    const i0 = Math.floor(ai), j0 = Math.floor(aj)
    const fi = ai - i0, fj = aj - j0
    const corners: [number, number, number][] = (fi + fj <= 1)
        ? [[i0, j0, 1 - fi - fj], [i0 + 1, j0, fi], [i0, j0 + 1, fj]]
        : [[i0 + 1, j0 + 1, fi + fj - 1], [i0 + 1, j0, 1 - fj], [i0, j0 + 1, 1 - fi]]
    const out: { x: number; y: number; w: number }[] = []
    for (const [i, j, w] of corners) {
        if (w <= 1e-4) continue
        const o = axialToOffset(i, j)
        out.push({ x: o.x, y: o.y, w })
    }
    return out
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
    return tileFromScreenXY(Math.floor(x), Math.floor(y))
}

// ── CE pixel-precise hex picking (RD13) ───────────────────────────────────────
// CE ref: tile.cc:345-385 _tile_mask construction and tile.cc:718 tileFromScreenXY.
// Hexes live in 12-px bands; within a band each 64-px period holds two hex
// columns, and the 32x16 mask decides whether a pixel near a diamond edge
// belongs to a neighbouring hex (1/2 = up-left/up-right, 3/4 = down cases).
//
// Frame mapping (verified numerically): DH2 world coords equal CE screen coords
// with _tile_x = _tile_y = 0 plus a constant offset. A tile's CE top-left is
// (hexToScreen.x - 16, hexToScreen.y - 9): CE anchors objects at top-left + (16, 8)
// with an inclusive bottom row (object.cc objectGetRect), DH2 at hexToScreen with
// an exclusive bottom. CE column index is inverted (gHexGridWidth - 1 - x).
const TILE_MASK: Uint8Array = (() => {
    const mask = new Uint8Array(512)
    let i = 0
    for (let v11 = 0; v11 !== 64; v11 += 16) {
        for (let v13 = 64; v13 !== 0; v13 -= 4) mask[i++] = v13 > v11 ? 1 : 0
        for (let v13 = 0; v13 !== 64; v13 += 4) mask[i++] = v13 > v11 ? 2 : 0
    }
    for (let k = 0; k < 8 * 32; k++) mask[i++] = 0
    for (let v11 = 0; v11 !== 64; v11 += 16) {
        for (let v13 = 0; v13 !== 64; v13 += 4) mask[i++] = v13 > v11 ? 0 : 3
        for (let v13 = 64; v13 !== 0; v13 -= 4) mask[i++] = v13 > v11 ? 0 : 4
    }
    return mask
})()

const TILE_OFF_X = 16
const TILE_OFF_Y = 1190

// C integer division (truncates toward zero)
const cdiv = (a: number, b: number) => Math.trunc(a / b)

function tileFromScreenXY(screenX: number, screenY: number): Point {
    const v2 = screenY - TILE_OFF_Y
    const v3 = v2 >= 0 ? cdiv(v2, 12) : cdiv(v2 + 1, 12) - 1
    const v4 = screenX - TILE_OFF_X - 16 * v3
    const v5 = v2 - 12 * v3
    const v6 = v4 >= 0 ? cdiv(v4, 64) : cdiv(v4 + 1, 64) - 1
    let v10 = v6 + v3
    let v8 = v4 - v6 * 64
    let v11 = 2 * v6
    if (v8 >= 32) {
        v8 -= 32
        v11++
    }
    switch (TILE_MASK[32 * v5 + v8]) {
        case 2:
            v11++
            if (v11 & 1) v10--
            break
        case 1:
            v10--
            break
        case 3:
            v11--
            if (!(v11 & 1)) v10++
            break
        case 4:
            v10++
            break
    }
    // CE: tile = W * v10 + (W - 1 - v11)  →  DH2 x = W - 1 - v11, y = v10
    return { x: HEX_GRID_SIZE - 1 - v11, y: v10 }
}

// Top-left of a hex's 32x16 cell in DH2 world coords (CE tileToScreenXY result).
export function hexCellTopLeft(x: number, y: number): Point {
    const s = hexToScreen(x, y)
    return { x: s.x - 16, y: s.y - 9 }
}
