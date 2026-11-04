// [dh2] worldmap_entry=exit (DH2 option, not in CE; default on): a town entered from the
// world map through an entrance without its own tile (city.txt tile -1) starts the party
// just inside the map's world-map exit grid — the brown one (exit map -1 / -2) — instead
// of CE's map header start (map.cc mapLoad), which on some maps is at another exit
// (Arroyo Bridge: by the green grid to the village). No such grid: CE's start. The map
// script can still move the party (override_map_start), as in CE.
// The hex is inside the header start's scroll-blocker ring: on maps whose exit grids lie
// outside the ring (Klamath Downtown) the view, centred on the party, stayed behind the
// ring and could not scroll after them into town (known_bugs CA82).

import { hexDirectionTo, hexDistance, hexInDirection, hexNeighbors, Point } from '../geometry.js'

const OBJECT_NO_BLOCK = 0x10 // CE obj flags
const SCROLL_BLOCKER_PID = 0x500000c // CE object.cc _obj_scroll_blocking_at

// set by the world map's town entrance, read once by the next map load
let pending = false
export function setWorldmapEntryPending(on: boolean): void {
    pending = on
}
export function takeWorldmapEntryPending(): boolean {
    const was = pending
    pending = false
    return was
}

type MapObjectJSON = { type: string; pid?: number; flags?: number; position?: Point; extra?: { exitMapID?: number } }
type MapJSON = { startPosition: Point; levels: { objects?: MapObjectJSON[] }[] }

/** The hex 2+ hexes inside the world-map exit grid nearest the header start, facing away
 *  from it; null when the elevation has no such grid or no free hex near it. */
export function worldmapExitEntry(map: MapJSON, elevation: number): { position: Point; orientation: number } | null {
    const objects = map.levels[elevation]?.objects ?? []
    const grid = objects.filter((o) => o.position && (o.extra?.exitMapID ?? 0) < 0).map((o) => o.position!)
    if (grid.length === 0) {
        return null
    }
    const key = (p: Point) => `${p.x},${p.y}`
    const blocked = new Set(
        objects
            .filter((o) => o.position && o.type !== 'item' && ((o.flags ?? 0) & OBJECT_NO_BLOCK) === 0)
            .map((o) => key(o.position!)),
    )
    const start = map.startPosition
    const near = grid.reduce((a, b) => (hexDistance(b, start) < hexDistance(a, start) ? b : a))
    const gridDistance = (p: Point) => Math.min(...grid.map((g) => hexDistance(g, p)))
    const walls = scrollBlockers(objects)
    const inside = startArea(walls, start)

    // the hexes from that grid hex towards the header start
    const path: Point[] = []
    for (let p = near; path.length < 200 && hexDistance(p, start) > 0;) {
        p = hexInDirection(p, hexDirectionTo(p, start))
        path.push(p)
    }
    // the first free hex not next to the grid, inside the start's scroll-blocker ring and past
    // the last scroll blocker on the way: an open blocker line (San Francisco Chinatown's V)
    // leaves both sides one area, and the view could not scroll from the entry over it (CA85)
    let from = 0
    path.forEach((p, i) => {
        if (walls.has(p.x + p.y * 200)) {
            from = i + 1
        }
    })
    for (let i = from; i < path.length; i++) {
        const p = path[i]
        if (gridDistance(p) >= 2 && !blocked.has(key(p)) && inside.has(p.x + p.y * 200)) {
            return { position: p, orientation: hexDirectionTo(near, p) }
        }
    }
    return null
}

function scrollBlockers(objects: MapObjectJSON[]): Set<number> {
    return new Set(
        objects
            .filter((o) => o.pid === SCROLL_BLOCKER_PID && o.position)
            .map((o) => o.position!.x + o.position!.y * 200),
    )
}

// The hexes the view centre can reach from the header start: hex neighbours not through a
// scroll blocker (the whole grid on a map without blockers).
function startArea(walls: Set<number>, start: Point): Set<number> {
    const area = new Set([start.x + start.y * 200])
    const stack = [start]
    while (stack.length > 0) {
        for (const n of hexNeighbors(stack.pop()!)) {
            const t = n.x + n.y * 200
            if (n.x < 0 || n.x >= 200 || n.y < 0 || n.y >= 200 || area.has(t) || walls.has(t)) {
                continue
            }
            area.add(t)
            stack.push(n)
        }
    }
    return area
}
