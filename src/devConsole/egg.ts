// Copyright 2022 darkf
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

import { Config } from '../config.js'
import { hexDistance, hexIsInFrontOf, hexIsToRightOf } from '../geometry.js'
import globalState from '../globalState.js'
import { isCEOccludingWall, isCEOccludingWallLiteral, isBBoxOccludingWall, WebGLRenderer } from '../webglrenderer.js'

// console commands are free-form globals (play.html#dev)
const devWindow = window as unknown as Record<string, unknown>

// DH2 console commands (no CE equivalent): egg transparency, roof peek, object inspector.
// Moved out of main.ts (window.onload). See wiki/extended_flags.md §8.

export function registerEggCommands(): void {
    // Console commands for the egg transparency effect.
    // setEggMode('alpha')      — flat alpha applied to the whole wall sprite
    // setEggMode('dh2-egg')    — egg.png mask using DH2's hand-tuned occlusion test (default)
    // setEggMode('ce-egg')     — egg.png mask using the byte-for-byte literal CE occlusion
    //                            test (isCEOccludingWallLiteral) — no DH2 deviations, for A/B
    //                            comparison against 'dh2-egg'. See wiki/extended_flags.md §8.
    // setEggMode('bbox')       — egg.png mask using a screen-space bounding-box overlap +
    //                            draw-order depth test (isBBoxOccludingWall) — DH2-original,
    //                            not CE-derived. See wiki/extended_flags.md §8.
    // setEggMode('beta')       — floor hex debug overlay: colored quads on every floor tile
    //                            within eggRadius, no wall transparency
    // setEggAlpha(0.3)         — set the outer/flat alpha (0=invisible, 1=opaque, default 0.4)
    // setEggRadius(6)          — set max hex distance for egg effect (default 8)
    devWindow.setEggMode = (mode: 'alpha' | 'dh2-egg' | 'ce-egg' | 'bbox' | 'beta') => {
        if (mode !== 'alpha' && mode !== 'dh2-egg' && mode !== 'ce-egg' && mode !== 'bbox' && mode !== 'beta') {
            console.log(
                "Usage: setEggMode('alpha'), setEggMode('dh2-egg'), setEggMode('ce-egg'), setEggMode('bbox'), or setEggMode('beta')",
            )
            return
        }
        Config.ui.eggMode = mode
        console.log(`[Egg] mode="${mode}"  alpha=${Config.ui.eggAlpha ?? 0.4}  radius=${Config.ui.eggRadius ?? 8}`)
    }
    devWindow.setEggAlpha = (a: number) => {
        Config.ui.eggAlpha = Math.max(0, Math.min(1, a))
        console.log(`[Egg] alpha=${Config.ui.eggAlpha}`)
    }
    // setRoofPeek(bool) — also hide the roof of a building the player stands BEHIND
    // (north of), not just under. Roofs draw 96px up, so a building you're behind
    // occludes you with a roof whose tile is ~south of you; CE only hides the roof
    // over your own tile. Default on. Set false for CE-exact behavior.
    devWindow.setRoofPeek = (on: boolean) => {
        Config.ui.roofPeek = on !== false
        console.log(
            `[Roof] peek-behind = ${Config.ui.roofPeek} (${Config.ui.roofPeek ? 'reveal character behind buildings' : 'CE-exact: only hide roof over own tile'})`,
        )
    }
    devWindow.setEggRadius = (r: number) => {
        Config.ui.eggRadius = Math.max(1, r)
        console.log(`[Egg] radius=${Config.ui.eggRadius}`)
    }
    devWindow.debugEgg = () => {
        const r = globalState.renderer as WebGLRenderer
        // Quick sanity check that proto/pro.json's wall extendedFlags data
        // actually made it into the cached proMap — if every sampled wall
        // shows extendedFlags=0, the browser is very likely still serving a
        // stale proMap cached in IndexedDB from before that field existed.
        // Run clearAssetCache() and reload if so.
        let wallsWithFlags = 0
        let wallsSampled = 0
        const walls = (globalState.proMap as any)?.walls
        if (walls) {
            for (const id of Object.keys(walls).slice(0, 50)) {
                wallsSampled++
                if ((walls[id]?.extra?.extendedFlags ?? 0) !== 0) wallsWithFlags++
            }
        }
        console.log('[Egg] diagnostic:', {
            mode: Config.ui.eggMode,
            alpha: Config.ui.eggAlpha ?? 0.4,
            radius: Config.ui.eggRadius ?? 8,
            textureLoaded: !!r.eggTexture,
            eggWidth: r.eggWidth,
            eggHeight: r.eggHeight,
            uEggMode: !!r.uEggMode,
            uEggCenter: !!r.uEggCenter,
            uEggSize: !!r.uEggSize,
            playerPosition: globalState.player
                ? { x: globalState.player.position.x, y: globalState.player.position.y }
                : null,
            cameraPosition: globalState.cameraPosition,
            zoom: globalState.cameraZoom,
            wallExtendedFlagsSample:
                `${wallsWithFlags}/${wallsSampled} sampled walls have nonzero extendedFlags` +
                (wallsSampled > 0 && wallsWithFlags === 0 ? ' — STALE proMap cache? Try clearAssetCache()' : ''),
        })
    }

    // eggDebug() — real-time dump of every wall/scenery within egg radius of
    // the player, with all four isCEOccludingWall predicate components visible,
    // plus a side-by-side comparison of DH2's hand-tuned occlusion test ('dh2-egg'),
    // the byte-for-byte literal CE port ('ce-egg'), and the screen-space
    // bbox/depth test ('bbox') — see wiki/extended_flags.md §8 for what differs and why.
    // Example: wall pos=21718 extFlags=0x2000 fOD=false fDO=true rOD=false rDO=true → egg=true ceLiteral=false bbox=false (DIFF)
    devWindow.eggDebug = () => {
        const player = globalState.player
        if (!player) {
            console.log('[EggDebug] no player')
            return
        }
        const radius = Config.ui.eggRadius ?? 8
        const playerPos = player.position.y * 200 + player.position.x
        console.log(`[EggDebug] player pos=${playerPos} (radius=${radius}, mode=${Config.ui.eggMode})`)
        const objs = globalState.gMap?.getObjects() ?? []
        const nearby = objs.filter(
            (o) => (o.type === 'wall' || o.type === 'scenery') && hexDistance(player.position, o.position) <= radius,
        )
        if (nearby.length === 0) {
            console.log('[EggDebug] no wall/scenery within radius')
            return
        }
        for (const obj of nearby) {
            const extFlags: number = obj.pro?.extra?.extendedFlags ?? 0
            const fOD = hexIsInFrontOf(obj.position, player.position)
            const fDO = hexIsInFrontOf(player.position, obj.position)
            const rOD = hexIsToRightOf(obj.position, player.position)
            const rDO = hexIsToRightOf(player.position, obj.position)
            const dh2Egg = isCEOccludingWall(obj, player)
            const ceEgg = isCEOccludingWallLiteral(obj, player)
            const bbox = isBBoxOccludingWall(obj, player)
            const pos = obj.position.y * 200 + obj.position.x
            const diff = dh2Egg !== ceEgg || dh2Egg !== bbox ? ' (DIFF)' : ''
            console.log(
                `[EggDebug] ${obj.type} pos=${pos} extFlags=0x${extFlags.toString(16)} fOD=${fOD} fDO=${fDO} rOD=${rOD} rDO=${rDO} → dh2Egg=${dh2Egg} ceEgg=${ceEgg} bbox=${bbox}${diff}`,
            )
        }
        console.log(`[EggDebug] ${nearby.length} objects checked`)
    }

    // inspectPos(tileNum) — dump every object at a map position with all flag fields.
    // Example: inspectPos(22925)
    devWindow.inspectPos = (tileNum: number) => {
        if (!globalState.gMap) {
            console.log('[inspectPos] no map loaded')
            return
        }
        const x = tileNum % 200
        const y = Math.floor(tileNum / 200)
        const objs = globalState.gMap.objectsAtPosition({ x, y })
        if (objs.length === 0) {
            console.log(`[inspectPos] no objects at position ${tileNum}`)
            return
        }
        // Collect every key matching /flag/i with a numeric value from src,
        // prefixed so caller knows which nesting level it came from.
        function flagsFrom(src: any, prefix: string): Record<string, string> {
            const out: Record<string, string> = {}
            if (!src || typeof src !== 'object') return out
            for (const k of Object.keys(src)) {
                if (/flag/i.test(k) && typeof src[k] === 'number') {
                    const v: number = src[k]
                    out[prefix + k] = `0x${v.toString(16).padStart(8, '0')} (${v})`
                }
            }
            return out
        }
        console.log(`[inspectPos] ${objs.length} object(s) at pos=${tileNum} (x=${x}, y=${y})`)
        for (const obj of objs) {
            console.log(`[inspectPos] → ${obj.type}`, {
                type: obj.type,
                pos: tileNum,
                frmPID: obj.frmPID ?? null,
                ...flagsFrom(obj, ''),
                ...flagsFrom(obj.pro, 'pro.'),
                ...flagsFrom(obj.pro?.extra, 'pro.extra.'),
            })
        }
    }
}
