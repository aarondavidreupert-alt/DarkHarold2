/*
Copyright 2014 darkf, Stratege
Copyright 2015 darkf

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

import { Critter } from '../object.js'
import { getAiPacket, AiPacket } from '../aiPackets.js'

export class AI {
    combatant: Critter
    packet: AiPacket

    constructor(combatant: Critter) {
        this.combatant = combatant
        const base = getAiPacket(combatant.aiNum)
        // Per-field overrides from the companion "Custom" behavior screen
        // (see Critter.customAiOverrides / setCompanionCustomSetting in
        // party.ts) — applied on top of the base packet so individually
        // chosen settings persist even though they're not a distinct named
        // ai.txt packet of their own.
        this.packet = combatant.customAiOverrides
            ? { ...base, ...combatant.customAiOverrides }
            : base
    }
}

// ── AI helpers ────────────────────────────────────────────────────────────────

/** CE ref: combat_ai.cc — RunAwayMode percentage thresholds.
 *  'never' falls through to raw packet.minHp as an absolute HP value. */
export const HP_FLEE_PCT: Partial<Record<string, number>> = {
    none: 0,
    coward: 25,
    finger_hurts: 40,
    bleeding: 60,
    not_feeling_good: 75,
}

export function fleeHpThreshold(packet: AiPacket, maxHp: number): number {
    const pct = HP_FLEE_PCT[packet.runAwayMode]
    if (pct === undefined) return packet.minHp  // 'never' → use raw minHp from ai.txt
    return Math.floor(maxHp * pct / 100)
}
