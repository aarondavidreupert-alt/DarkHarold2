// geometry/hexGrid.ts and hexScreen.ts against fallout2-ce tile.cc. CE works on tile numbers
// (tile = y * 200 + x); the reference functions below are tile.cc transliterated with C integer
// division, with the view centred the way tileSetCenter leaves it (_tile_x even).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    hexNeighbors,
    hexInDirection,
    hexInDirectionDistance,
    hexDistance,
    hexDirectionTo,
} from '../js/geometry/hexGrid.js'
import { hexToScreen } from '../js/geometry/hexScreen.js'
import { cdiv } from './support/ce.mjs'

const W = 200

// tile.cc tileInit: _dir_tile[parity of tile % width][rotation] for a 200-wide grid
const CE_DIR_TILE = [
    [-1, W - 1, W, W + 1, 1, -W],
    [-W - 1, -1, W, 1, 1 - W, -W],
]

// tile.cc tileSetCenter makes _tile_x even; _tile_offx / _tile_offy only shift every result
const TILE_X = 100
const TILE_Y = 100

/** tile.cc tileToScreenXY (offsets 0). */
function ceTileToScreen(tile) {
    const v3 = W - 1 - (tile % W)
    const v4 = cdiv(tile, W)
    let x = 48 * cdiv(v3 - TILE_X, 2)
    let y = 12 * cdiv(v3 - TILE_X, -2)
    if (v3 & 1) {
        if (v3 <= TILE_X) {
            x -= 16
            y += 12
        } else {
            x += 32
        }
    }
    x += 16 * (v4 - TILE_Y)
    y += 12 * (v4 - TILE_Y)
    return { x, y }
}

/** tile.cc tileGetRotationTo. */
function ceRotationTo(tile1, tile2) {
    const a = ceTileToScreen(tile1)
    const b = ceTileToScreen(tile2)
    const dy = b.y - a.y
    const dx = b.x - a.x
    if (dx !== 0) {
        const v6 = Math.trunc(Math.atan2(-dy, dx) * 180.0 * 0.3183098862851122)
        let v7 = 360 - (v6 + 180) - 90
        if (v7 < 0) v7 += 360
        v7 = cdiv(v7, 60)
        return v7 >= 6 ? 5 : v7
    }
    return dy < 0 ? 0 : 2
}

/** tile.cc tileDistanceBetween: walks tile by tile toward tile2 (the inlined rotation_to_tile). */
function ceDistanceBetween(tile1, tile2) {
    let i = 0
    for (let v = tile1; v !== tile2; i++) v += CE_DIR_TILE[(v % W) & 1][ceRotationTo(v, tile2)]
    return i
}

const tileOf = (p) => p.y * W + p.x
const pointOf = (t) => ({ x: t % W, y: cdiv(t, W) })

// Interior sample: away from the grid edge, where CE's walk stays on valid tiles
const SAMPLE = []
for (let x = 60; x < 140; x += 3) for (let y = 60; y < 140; y += 3) SAMPLE.push({ x, y })
const TARGETS = [{ x: 100, y: 100 }, { x: 101, y: 99 }, { x: 120, y: 80 }, { x: 85, y: 130 }, { x: 99, y: 101 }, { x: 70, y: 70 }]

test('neighbours follow CE tile.cc _dir_tile for even and odd columns', () => {
    for (const p of [{ x: 50, y: 50 }, { x: 51, y: 50 }, { x: 120, y: 7 }, { x: 33, y: 180 }]) {
        const parity = p.x & 1
        const expected = CE_DIR_TILE[parity].map((d) => pointOf(tileOf(p) + d))
        assert.deepEqual(hexNeighbors(p), expected, `(${p.x},${p.y})`)
        for (let rot = 0; rot < 6; rot++) assert.deepEqual(hexInDirection(p, rot), expected[rot])
    }
})

test('hexDistance equals CE tile.cc tileDistanceBetween', () => {
    for (const a of SAMPLE) {
        for (const b of TARGETS) {
            assert.equal(hexDistance(a, b), ceDistanceBetween(tileOf(a), tileOf(b)), `(${a.x},${a.y})->(${b.x},${b.y})`)
        }
    }
})

test('hexDistance: hand-checked values', () => {
    // tileDistanceBetween: the same tile is 0 steps, every _dir_tile neighbour 1, six steps of one
    // rotation 6 (tileGetTileInDirection away from the edge)
    const p = { x: 100, y: 100 }
    assert.equal(hexDistance(p, p), 0)
    for (const n of hexNeighbors(p)) assert.equal(hexDistance(p, n), 1)
    for (let rot = 0; rot < 6; rot++) assert.equal(hexDistance(p, hexInDirectionDistance(p, rot, 6)), 6)
})

test('hexDirectionTo equals CE tile.cc tileGetRotationTo', () => {
    for (const a of SAMPLE) {
        for (const b of TARGETS) {
            if (a.x === b.x && a.y === b.y) continue
            assert.equal(hexDirectionTo(a, b), ceRotationTo(tileOf(a), tileOf(b)), `(${a.x},${a.y})->(${b.x},${b.y})`)
        }
    }
})

test('hexToScreen keeps the tile spacing of CE tile.cc tileToScreenXY', () => {
    // DH2's screen origin differs from CE's; the offset between any two tiles must not
    const origin = { ce: ceTileToScreen(0), dh2: hexToScreen(0, 0) }
    for (let tile = 0; tile < W * W; tile += 7) {
        const ce = ceTileToScreen(tile)
        const p = pointOf(tile)
        const dh2 = hexToScreen(p.x, p.y)
        assert.deepEqual(
            { x: dh2.x - origin.dh2.x, y: dh2.y - origin.dh2.y },
            { x: ce.x - origin.ce.x, y: ce.y - origin.ce.y },
            `tile ${tile}`,
        )
    }
})

test('hexInDirectionDistance stops at the grid edge like CE tile.cc tileGetTileInDirection', () => {
    // tileGetTileInDirection checks tileIsEdge before every step, the first one included.
    // (3,50) rotation 0: odd column -W-1 -> (2,49), even -1 -> (1,49), odd -W-1 -> (0,48), edge
    assert.deepEqual(hexInDirectionDistance({ x: 3, y: 50 }, 0, 10), { x: 0, y: 48 })
    assert.deepEqual(hexInDirectionDistance({ x: 0, y: 50 }, 0, 5), { x: 0, y: 50 })
    assert.deepEqual(hexInDirectionDistance({ x: 100, y: 196 }, 2, 10), { x: 100, y: 199 })
    assert.deepEqual(hexInDirectionDistance({ x: 100, y: 100 }, 4, 0), { x: 100, y: 100 })

    // tile.cc tileIsEdge: first / last row, first / last column
    const ceIsEdge = (t) => t < W || t >= W * W - W || t % W === 0 || t % W === W - 1
    const ceTileInDirection = (tile, rotation, distance) => {
        for (let i = 0; i < distance && !ceIsEdge(tile); i++) tile += CE_DIR_TILE[(tile % W) & 1][rotation]
        return tile
    }
    for (const p of [{ x: 5, y: 5 }, { x: 194, y: 3 }, { x: 2, y: 197 }, { x: 150, y: 190 }]) {
        for (let rot = 0; rot < 6; rot++) {
            assert.deepEqual(hexInDirectionDistance(p, rot, 12), pointOf(ceTileInDirection(tileOf(p), rot, 12)))
        }
    }
})
