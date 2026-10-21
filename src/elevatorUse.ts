// DH2 option [dh2] elevator_use (not in CE): a Use action on an elevator.
//
// CE elevators are spatial scripts only (ZSElev01 / ZSElev02 spatial_p_proc →
// metarule(METARULE_ELEVATOR) → scripts.cc scriptsRequestElevator → elevator.cc
// elevatorSelectLevel): the panel opens when the player steps into the car. With
// the option, the car's scenery (elev* art) and CE's elevator doors get a Use
// action that walks the player onto the spatial's tile, so the same script runs
// with the same conditions (the Military Base elevator stays out of action until
// its generator is repaired).

import { Config } from './config.js'
import { hexDistance } from './geometry.js'
import globalState from './globalState.js'
import { Obj } from './object.js'

// CE scripts.cc scriptsHandleRequests: the elevator door pids (0x2000099, 0x20001A5, 0x20001D6)
const ELEVATOR_DOOR_PIDS = new Set([153, 421, 470])
// how far the elevator's spatial may be from the clicked scenery
const MAX_SPATIAL_DISTANCE = 5

/** The elevator spatial `obj` belongs to, or null (option off, not elevator scenery,
 *  no elevator spatial nearby). */
export function elevatorSpatialFor(obj: Obj): any | null {
    if (!Config.ui.elevatorUse || obj.type !== 'scenery' || !globalState.gMap || !obj.position) return null
    const art = ((obj as any).art ?? '').split('/').pop().toLowerCase()
    if (!art.startsWith('elev') && !ELEVATOR_DOOR_PIDS.has((obj as any).pidID)) return null
    let best: any = null
    let bestDist = Infinity
    for (const s of globalState.gMap.getSpatials(obj.elevation) ?? []) {
        if (!/elev/i.test(s.script ?? '') || !s._script?.spatial_p_proc || !s.position) continue
        const d = hexDistance(s.position, obj.position)
        if (d <= MAX_SPATIAL_DISTANCE && d < bestDist) {
            best = s
            bestDist = d
        }
    }
    return best
}
