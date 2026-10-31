// [dh2] worldmap_entry=exit (DH2 option, not in CE; default on): a town entered from the
// world map through an entrance without its own tile (city.txt tile -1) starts the party
// just inside the map's world-map exit grid — the brown one (exit map -1 / -2) — instead
// of CE's map header start (map.cc mapLoad), which on some maps is at another exit
// (Arroyo Bridge: by the green grid to the village). No such grid: CE's start. The map
// script can still move the party (override_map_start), as in CE.

import { hexDirectionTo, hexDistance, hexInDirection, Point } from '../geometry.js'

const OBJECT_NO_BLOCK = 0x10 // CE obj flags

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

type MapObjectJSON = { type: string; flags?: number; position?: Point; extra?: { exitMapID?: number } }
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

    // from that grid hex towards the header start: the first free hex not next to the grid
    let p = near
    for (let i = 0; i < 8 && hexDistance(p, start) > 0; i++) {
        p = hexInDirection(p, hexDirectionTo(p, start))
        if (gridDistance(p) >= 2 && !blocked.has(key(p))) {
            return { position: p, orientation: hexDirectionTo(near, p) }
        }
    }
    return null
}
