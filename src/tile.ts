// Copyright 2014-2022 darkf
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Point } from './geometry.js'
import globalState from './globalState.js'

export const TILE_WIDTH = 80
export const TILE_HEIGHT = 36

export function toTileNum(position: Point): number {
    return position.y * 200 + position.x
}

export function fromTileNum(tile: number): Point {
    return { x: tile % 200, y: Math.floor(tile / 200) } // TODO: use x|0 instead of floor for some of these
}

export function tileToScreen(x: number, y: number): Point {
    x = 99 - x // this algorithm expects x to be reversed
    const sx = 4752 + 32 * y - 48 * x
    const sy = 24 * y + 12 * x

    return { x: sx, y: sy }
}

export function tileFromScreen(x: number, y: number): Point {
    const off_x = -4800 + x
    const off_y = y
    const xx = off_x - (off_y * 4) / 3
    let tx = xx / 64

    if (xx >= 0) tx++
    tx = -tx
    const yy = off_y + off_x / 4
    let ty = yy / 32
    if (yy < 0) ty--

    return { x: 99 - Math.round(tx), y: Math.round(ty) }
}

// CE object.cc objectSetLocation: the square of a hex is (tile % 200 / 2, tile / 200 / 2);
// DH2's square arrays are mirrored in x ([y][99 - x], fomap.py). (Going through the screen
// position put every odd hex row one square too far south.)
export function hexToTile(pos: Point): Point {
    return { x: 99 - (pos.x >> 1), y: pos.y >> 1 }
}
