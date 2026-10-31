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
import { resetWmDebugStats, wmDebug } from '../worldmap.js'

// console commands are free-form globals (play.html#dev)
const devWindow = window as unknown as Record<string, unknown>

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits

// DH2 console commands (no CE equivalent): random-encounter and world map travel numbers
// (counters in src/worldmap/debugStats.ts), and the world map travel speed.
export function registerWorldmapDebugCommands(): void {
    // encounterLog(on = true) — one console line per encounter roll (square, chance, result)
    devWindow.encounterLog = (on: boolean = true) => {
        wmDebug.log = on !== false
        console.log(`[DH2] encounter roll log ${wmDebug.log ? 'on' : 'off'}`)
    }

    // encounterStats() — the counters since the page loaded (or resetEncounterStats()),
    // printed as one line of JSON to copy
    devWindow.encounterStats = () => {
        const walkS = wmDebug.walkMs / 1000
        const stats = {
            encounterRate: Config.engine.encounterRate,
            walkSpeed: wmDebug.walkSpeed,
            worldmapSeconds: round(wmDebug.openMs / 1000),
            fps: round(wmDebug.openMs > 0 ? (wmDebug.frames * 1000) / wmDebug.openMs : 0),
            walkingSeconds: round(walkS),
            travelPxPerSecond: round(walkS > 0 ? wmDebug.steps / walkS : 0),
            gameHoursPerWalkingSecond: round(walkS > 0 ? wmDebug.gameTicks / 36000 / walkS : 0, 2),
            rolls: wmDebug.rolls,
            rollsPerWalkingSecond: round(walkS > 0 ? wmDebug.rolls / walkS : 0, 2),
            skipped: {
                sameXAsLastEncounter: wmDebug.skipSameX,
                sameYAsLastEncounter: wmDebug.skipSameY,
                inTownCircle: wmDebug.skipInArea,
            },
            rollsByChancePercent: wmDebug.byChance,
            expectedEncounters: round(wmDebug.expected, 2),
            encounters: wmDebug.hits,
            spotted: wmDebug.spotted,
            walkingSecondsPerEncounter: wmDebug.hits > 0 ? round(walkS / wmDebug.hits) : null,
        }
        console.log('[DH2] encounterStats ' + JSON.stringify(stats))
        return stats
    }

    // resetEncounterStats() — start counting again
    devWindow.resetEncounterStats = () => {
        resetWmDebugStats()
        console.log('[DH2] encounter stats reset')
    }

    // setWalkSpeed(x) — world map travel speed, 1 = CE (0.5 half, 2 double); game time per
    // distance stays CE's, the encounter rolls stay one per 1.5 s of real time
    devWindow.setWalkSpeed = (x: number = 1) => {
        const speed = Number(x)
        if (!Number.isFinite(speed) || speed <= 0 || speed > 20) {
            console.warn('[DH2] setWalkSpeed: a number above 0 and up to 20 (1 = CE)')
            return
        }
        wmDebug.walkSpeed = speed
        console.log(`[DH2] world map walk speed ${speed}${speed === 1 ? ' (CE)' : ''}`)
    }
}
