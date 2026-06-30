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

// "Naive" light-propagation mode — pure hex-distance falloff with NO
// occlusion/blocking at all. Every hex within obj.lightRadius gets lit
// purely as a function of hexDistance(source, tile); walls and opaque
// objects are not consulted.
//
// This exists solely as a comparison baseline (see lightingDebug() in
// main.ts) to make the cost/benefit of shadowcasting visible: the only
// thing 'dh2' and 'derived' add over this mode is occlusion. Distance
// falloff itself is identical across all three modes. Expect light to
// visibly bleed through walls into adjacent rooms when this mode is
// active — that's the deliberate trade-off being demonstrated, not a bug.
// See wiki/lighting.md → "Naive lighting mode (distance-only baseline)".

import { Obj } from "../object.js"
import { hexDistance } from "../geometry.js"
import { toTileNum } from "../tile.js"

export type LightWriter = (tileNum: number, intensity: number) => void

export function obj_adjust_light_naive(obj: Obj, addLight: LightWriter): void {
    if (obj.visible === false) return
    if (obj.lightRadius <= 0 || obj.lightIntensity <= 655) return

    const sourcePos = obj.position
    const sourceTileNum = toTileNum(sourcePos)
    addLight(sourceTileNum, obj.lightIntensity)

    // Same intensity-cap side effect as the literal and derived modes, so
    // obj.lightIntensity reads consistently regardless of which
    // propagation mode last touched it.
    obj.lightIntensity = Math.min(obj.lightIntensity, 65536)

    const cappedIntensity = obj.lightIntensity
    const lightPerDist = ((cappedIntensity - 655) / (obj.lightRadius + 1)) | 0

    for (let y = sourcePos.y - obj.lightRadius; y <= sourcePos.y + obj.lightRadius; y++) {
        if (y < 0 || y >= 200) continue
        for (let x = sourcePos.x - obj.lightRadius; x <= sourcePos.x + obj.lightRadius; x++) {
            if (x < 0 || x >= 200) continue
            if (x === sourcePos.x && y === sourcePos.y) continue

            const cell = { x, y }
            const dist = hexDistance(sourcePos, cell)
            if (dist <= 0 || dist > obj.lightRadius) continue

            const tileNum = toTileNum(cell)
            const lightAdjustment = cappedIntensity - lightPerDist * dist
            addLight(tileNum, lightAdjustment)
        }
    }
}
