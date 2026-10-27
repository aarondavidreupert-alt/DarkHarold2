// The hex path finder — CE animation.cc pathfinderFindPath (_make_path with
// _obj_blocking_at), ported literally:
//  - a tile is taken the first time it is reached and never re-opened (no relaxation),
//  - the estimate is the screen distance _idist to the goal, every step costs 50
//    (+10 for a turn outside combat, +400 on radioactive goo, +100 for geckos),
//  - the open node with the lowest estimate + cost wins, ties to the lowest slot,
//  - 2000 open / 2000 closed nodes at most (else no path), 800 steps returned at most,
//  - a closed door only lets through a critter that canUseDoor.

import globalState from '../globalState.js'
import { hexInDirection, hexToScreen, HEX_GRID_SIZE, Point } from '../geometry.js'
import type { Obj } from '../object.js'
import { Config } from '../config.js'
import { walkBorderBounds } from '../render/camera.js'

const MAX_NODES = 2000
const MAX_STEPS = 800
const FIRST_RADIOACTIVE_GOO_PID = 0x20003d9
const LAST_RADIOACTIVE_GOO_PID = 0x20003dc
const KILL_TYPE_GECKO = 15
const BODY_TYPE_BIPED = 0
const BODY_TYPE_ROBOTIC = 2

// CE animation.cc canUseDoor: the dude only through a "walk thru" portal (proto
// scenery data & 0x04 — no F2 door has it, the player opens doors himself); other
// critters through any unlocked door if biped or robotic and not a gecko.
export function canUseDoor(critter: Obj, door: Obj): boolean {
    if (critter === globalState.player) {
        if ((((door as any).pro?.extra?.walkthroughFlag ?? 0) & 0x04) === 0) return false
    }
    if (critter.type !== 'critter') return false
    if (door.type !== 'scenery' || door.subtype !== 'door') return false
    const bodyType = (critter as any).pro?.extra?.bodyType ?? 0
    if (bodyType !== BODY_TYPE_BIPED && bodyType !== BODY_TYPE_ROBOTIC) return false
    if (door.locked) return false // objectIsLocked
    if (((critter as any).killType ?? 0) === KILL_TYPE_GECKO) return false
    return true
}

// CE _idist: an integer octagonal distance
function idist(x1: number, y1: number, x2: number, y2: number): number {
    const dx = Math.abs(x2 - x1)
    const dy = Math.abs(y2 - y1)
    const dm = dx <= dy ? dx : dy
    return dx + dy - Math.trunc(dm / 2)
}

interface PathNode {
    tile: number
    from: number
    rotation: number
    estimate: number
    cost: number
}

// The blocking object per tile (CE _obj_blocking_at: OBJECT_MULTIHEX objects also
// block the six hexes around them), and the goo tiles. `shoot`: CE
// _obj_shoot_blocking_at instead — living critters, scenery and walls that aren't
// both NO_BLOCK and SHOOT_THRU (multihex neighbours: not NO_BLOCK). 'sight': CE
// _obj_sight_blocking_at — visible scenery and walls without OBJECT_LIGHT_THRU. 'ai': the
// walking test without critters (CE _obj_ai_blocking_at lets the first critter through
// and remembers it as _moveBlockObj; the caller finds it on the path).
export type PathBlockMode = boolean | 'sight' | 'ai'
function blockingMap(
    mover: Obj | null,
    elevation: number,
    shoot: PathBlockMode = false,
): { block: Map<number, Obj>; goo: Set<number> } {
    const block = new Map<number, Obj>()
    const goo = new Set<number>()
    const W = HEX_GRID_SIZE
    for (const o of globalState.gMap?.getObjects(elevation) ?? []) {
        if (!o.position || o === mover) continue
        const { x, y } = o.position
        if (x < 0 || x >= W || y < 0 || y >= W) continue
        const pid = (o as any).pid as number | undefined
        if (pid !== undefined && pid >= FIRST_RADIOACTIVE_GOO_PID && pid <= LAST_RADIOACTIVE_GOO_PID) goo.add(y * W + x)
        if (shoot === 'sight') {
            const flags = ((o as any).flags ?? 0) >>> 0
            if (
                (o.type === 'scenery' || o.type === 'wall') &&
                (flags & 0x01) === 0 &&
                (o as any).visible !== false &&
                (flags & 0x20000000) === 0 &&
                !block.has(y * W + x)
            )
                block.set(y * W + x, o)
            continue
        }
        if (shoot === 'ai' && o.type === 'critter') continue
        if (shoot && shoot !== 'ai') {
            const flags = ((o as any).flags ?? 0) >>> 0
            const kind = o.type === 'scenery' || o.type === 'wall' || (o.type === 'critter' && !(o as any).dead)
            if (!kind || (flags & 0x01) !== 0 || (o as any).visible === false) continue // OBJECT_HIDDEN
            const noBlock = (flags & 0x10) !== 0
            if (!(noBlock && (flags & 0x80000000) !== 0) && !block.has(y * W + x)) block.set(y * W + x, o)
            if (!noBlock && (flags & 0x800) !== 0) {
                for (let r = 0; r < 6; r++) {
                    const n = hexInDirection(o.position, r)
                    if (n.x >= 0 && n.x < W && n.y >= 0 && n.y < W && !block.has(n.y * W + n.x))
                        block.set(n.y * W + n.x, o)
                }
            }
            continue
        }
        if (!o.blocks()) continue
        if (!block.has(y * W + x)) block.set(y * W + x, o)
        if ((((o as any).flags ?? 0) & 0x800) !== 0) {
            // OBJECT_MULTIHEX
            for (let r = 0; r < 6; r++) {
                const n = hexInDirection(o.position, r)
                if (n.x >= 0 && n.x < W && n.y >= 0 && n.y < W && !block.has(n.y * W + n.x)) block.set(n.y * W + n.x, o)
            }
        }
    }
    return { block, goo }
}

// Returns the rotations from `from` to `to` (empty: no path). `goalMustBeFree` is CE's
// a5: the goal tile itself must not be blocked; `shoot` checks with
// _obj_shoot_blocking_at (CE's blocking-function argument), 'sight' _obj_sight_blocking_at.
export function pathfinderFindPath(
    mover: Obj | null,
    from: Point,
    to: Point,
    goalMustBeFree: boolean,
    shoot: PathBlockMode = false,
): number[] {
    const W = HEX_GRID_SIZE
    const fromTile = from.y * W + from.x
    const toTile = to.y * W + to.x
    const elevation = (mover as any)?.elevation ?? globalState.gMap?.currentElevation ?? 0
    const { block, goo } = blockingMap(mover, elevation, shoot)

    if (goalMustBeFree && block.has(toTile)) return []

    // [dh2] walk_limit=1 (default; DH2 addition, CE has no such limit): no step from
    // inside the black map border to a hex outside it (walkBorderBounds), so
    // neither the player nor an NPC walks into the black. A mover already outside can
    // still walk; scripts' move_to doesn't path.
    const border =
        (!shoot || shoot === 'ai') && Config.ui.walkLimitToBorder && elevation === globalState.gMap?.currentElevation
            ? walkBorderBounds()
            : null
    const inside = (x: number, y: number): boolean => {
        if (!border) return true
        const s = hexToScreen(x, y)
        return s.x >= border.minX && s.x <= border.maxX && s.y >= border.minY && s.y <= border.maxY
    }
    if (border && inside(from.x, from.y) && !inside(to.x, to.y)) return []

    const isCritter = mover?.type === 'critter'
    const isGecko = isCritter && ((mover as any).killType ?? 0) === KILL_TYPE_GECKO
    const notInCombat = !globalState.inCombat

    const processed = new Uint8Array(W * W)
    processed[fromTile] = 1

    const toScreen = hexToScreen(to.x, to.y)
    const fromScreen = hexToScreen(from.x, from.y)
    const open: PathNode[] = []
    for (let i = 0; i < MAX_NODES; i++) open.push({ tile: -1, from: -1, rotation: 0, estimate: 0, cost: 0 })
    open[0] = {
        tile: fromTile,
        from: -1,
        rotation: 0,
        estimate: idist(fromScreen.x, fromScreen.y, toScreen.x, toScreen.y),
        cost: 0,
    }
    const closed: PathNode[] = []
    let openCount = 1
    let temp: PathNode = open[0]

    for (;;) {
        // the open node with the lowest estimate + cost (first one on a tie)
        let best = -1
        for (let i = 0, seen = 0; seen < openCount; i++) {
            const n = open[i]
            if (n.tile === -1) continue
            seen++
            if (best === -1 || n.estimate + n.cost < open[best].estimate + open[best].cost) best = i
        }
        temp = { ...open[best] }
        openCount -= 1
        open[best].tile = -1

        if (temp.tile === toTile) {
            if (openCount === 0) openCount = 1
            break
        }

        closed.push(temp)
        if (closed.length === MAX_NODES) return []

        const tx = temp.tile % W
        const ty = Math.trunc(temp.tile / W)
        for (let rotation = 0; rotation < 6; rotation++) {
            const n = hexInDirection({ x: tx, y: ty }, rotation)
            if (n.x < 0 || n.x >= W || n.y < 0 || n.y >= W) continue
            const tile = n.y * W + n.x
            if (processed[tile]) continue

            if (tile !== toTile) {
                const obstacle = block.get(tile)
                if (obstacle && !(mover && canUseDoor(mover, obstacle))) continue
            }
            if (border && !inside(n.x, n.y) && inside(tx, ty)) continue

            let slot = 0
            while (slot < MAX_NODES && open[slot].tile !== -1) slot++
            openCount += 1
            if (openCount === MAX_NODES || slot === MAX_NODES) return []

            processed[tile] = 1
            const s = hexToScreen(n.x, n.y)
            let cost = temp.cost + 50
            if (notInCombat && temp.rotation !== rotation) cost += 10
            if (isCritter && goo.has(tile)) cost += isGecko ? 100 : 400
            open[slot] = { tile, from: temp.tile, rotation, estimate: idist(s.x, s.y, toScreen.x, toScreen.y), cost }
        }

        if (openCount === 0) break
    }

    if (openCount === 0) return []

    const rotations: number[] = []
    for (let i = 0; i < MAX_STEPS && temp.tile !== fromTile; i++) {
        rotations.push(temp.rotation)
        const parent = closed.find((c) => c.tile === temp.from)
        if (!parent) return []
        temp = parent
    }
    return rotations.reverse()
}

// The path as hexes, start included (DH2's path format).
export function pathfinderFindPathPoints(
    mover: Obj | null,
    from: Point,
    to: Point,
    goalMustBeFree: boolean,
    mode: PathBlockMode = false,
): number[][] {
    if (from.x === to.x && from.y === to.y) return [[from.x, from.y]]
    const rotations = pathfinderFindPath(mover, from, to, goalMustBeFree, mode)
    if (rotations.length === 0) return []
    const out: number[][] = [[from.x, from.y]]
    let p = from
    for (const r of rotations) {
        p = hexInDirection(p, r)
        out.push([p.x, p.y])
    }
    return out
}
