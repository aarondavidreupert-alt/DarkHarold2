/*
Copyright 2014-2015 darkf, Stratege

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

// The critical hit tables are CE's own (criticalEffects/ceTables.ts, generated from
// fallout2-ce combat.cc gCriticalHitTables / gPlayerCriticalHitTable). The old
// lut/criticalTables.json decode mislabelled DAM_BYPASS as "lose next turn" and
// dropped DAM_LOSE_TURN, so it is no longer read.

import {
    CRITICAL_HIT_TABLES as BASE_TABLES,
    PLAYER_CRITICAL_HIT_TABLE,
    type CriticalHitDescription,
} from './ceTables.js'
import { SFALL_CRITICAL_PATCHES } from './sfallPatches.js'
import { sfallIniGetString } from '../sfallIni.js'
import { dbgWarn } from '../logger.js'

export { PLAYER_CRITICAL_HIT_TABLE }

// CE combat.cc criticalsInit: ddraw.ini [Misc] OverrideCriticalTable (default 2). Modes 2
// and 3 apply the sfall fixes (criticalsSetValue); 1 and 3 also read CriticalOverrides.ini,
// which DH2 does not (mode 1 keeps the static tables).
function criticalMode(): number {
    const text = sfallIniGetString('ddraw.ini|Misc|OverrideCriticalTable')
    const mode = text ? parseInt(text, 10) : 2
    if (isNaN(mode) || mode < 0 || mode > 3) return 0
    if (mode === 1 || mode === 3)
        dbgWarn('combat', 'OverrideCriticalTable ' + mode + ': CriticalOverrides.ini is not read')
    return mode
}

function patchedTables(): CriticalHitDescription[][][] {
    const tables = BASE_TABLES.map((kt) =>
        kt.map((loc) => loc.map((e) => e.slice() as unknown as CriticalHitDescription)),
    )
    const mode = criticalMode()
    if (mode === 2 || mode === 3) {
        for (const [killType, location, effect, member, value] of SFALL_CRITICAL_PATCHES)
            (tables[killType][location][effect] as unknown as number[])[member] = value
    }
    return tables
}

export const CRITICAL_HIT_TABLES: readonly (readonly (readonly CriticalHitDescription[])[])[] = patchedTables()

// Kept for init.ts: the tables are compiled in, nothing to load.
export function loadTable(): void {}
