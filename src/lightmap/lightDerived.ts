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

// "Derived" light-propagation mode — a DH2-original reimplementation of
// obj_adjust_light's shadowcasting, inferred from reverse-engineering the
// literal CE 36-case switch (src/lightmap.ts) rather than ported from it.
//
// This is NOT a verified bit-exact match for CE. See wiki/lighting.md →
// "Derived lighting mode (DH2 inference)" for the full derivation, the
// row-0/1 predecessor rule that was verified against the literal switch
// cases, the row-2+ divergence that was found (extra "grandparent" terms
// the simple rule doesn't predict), and the known simplification this file
// makes around wall-facing-direction partial near-side lighting. Use
// lightingDebug() in the browser console to see where this mode and the
// literal 'dh2'/CE-derived mode disagree for the current map.

import globalState from "../globalState.js"
import { Obj } from "../object.js"
import { Point } from "../geometry.js"
import { hexNeighbors, hexDistance } from "../geometry.js"
import { toTileNum } from "../tile.js"

export type LightWriter = (tileNum: number, intensity: number) => void

// Same isotropic point-light physics as the literal CE/DH2 mode (linear
// falloff per hex-distance step out to lightRadius, no inverse-square), but
// propagated via real hex-grid BFS shadowcasting instead of the precomputed
// 36-entry triangular-wedge lookup table.
//
// A cell is lit if at least one of its hex neighbors strictly closer to the
// source was itself reachable and non-opaque (OR-of-reachable-predecessors —
// the same rule verified by hand against literal switch cases 0-14). Once a
// cell is found opaque (an object without OBJECT_LIGHT_THRU sits on it),
// light still splashes onto that cell's own tile but does not propagate to
// cells beyond it, mirroring isLightBlocked's role in the literal switch.
//
// Known simplification vs the literal CE/DH2 mode: this function does not
// reproduce the literal mode's wall-facing-direction partial near-side
// exemption (the `edi` direction logic in lightmap.ts's wall branch, which
// depends on the literal table's dir/i indices and doesn't generalize
// cleanly to BFS coordinates). A non-flat, non-LightThru wall fully blocks
// propagation here regardless of which side it's approached from.
export function obj_adjust_light_derived(obj: Obj, addLight: LightWriter): void {
    if (obj.visible === false) return
    if (obj.lightRadius <= 0 || obj.lightIntensity <= 655) return

    const sourcePos = obj.position
    const sourceTileNum = toTileNum(sourcePos)
    addLight(sourceTileNum, obj.lightIntensity)

    // CE/DH2 both cap the object's own stored intensity to 65536 as a side
    // effect of the light calc — mirrored here so obj.lightIntensity reads
    // consistently regardless of which propagation mode last touched it.
    obj.lightIntensity = Math.min(obj.lightIntensity, 65536)

    const cappedIntensity = obj.lightIntensity
    const lightPerDist = ((cappedIntensity - 655) / (obj.lightRadius + 1)) | 0

    // blocked.get(tileNum) === true means light reaches this tile but does
    // not propagate past it (opaque object here, or no open predecessor).
    const blocked = new Map<number, boolean>()
    blocked.set(sourceTileNum, false)

    let frontier: Point[] = [sourcePos]

    for (let dist = 1; dist <= obj.lightRadius; dist++) {
        const layer = new Map<number, Point>()
        for (const cell of frontier) {
            for (const neighbor of hexNeighbors(cell)) {
                const tileNum = toTileNum(neighbor)
                if (tileNum <= 0 || tileNum >= 40000) continue
                if (blocked.has(tileNum) || layer.has(tileNum)) continue
                if (hexDistance(sourcePos, neighbor) !== dist) continue
                layer.set(tileNum, neighbor)
            }
        }

        if (layer.size === 0) break

        for (const [tileNum, cell] of layer) {
            let reachable = false
            for (const neighbor of hexNeighbors(cell)) {
                const nTileNum = toTileNum(neighbor)
                const nBlocked = blocked.get(nTileNum)
                if (nBlocked === false && hexDistance(sourcePos, neighbor) < dist) {
                    reachable = true
                    break
                }
            }

            if (!reachable) {
                blocked.set(tileNum, true)
                continue
            }

            let tileBlocksLight = false
            for (const curObj of globalState.gMap.objectsAtPosition(cell)) {
                if (!curObj.pro) continue
                if ((curObj.flags & 1) !== 0) continue // internal flag, same skip as literal mode
                if (!(curObj.flags & 0x20000000 /* OBJECT_LIGHT_THRU */)) {
                    tileBlocksLight = true
                }
            }

            const lightAdjustment = cappedIntensity - lightPerDist * dist
            addLight(tileNum, lightAdjustment)
            blocked.set(tileNum, tileBlocksLight)
        }

        frontier = Array.from(layer.values())
    }
}
