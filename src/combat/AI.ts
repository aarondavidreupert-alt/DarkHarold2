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
        // (only while the custom packet is in use — a named disposition keeps them for later)
        const custom = base.disposition === 'custom' ? combatant.customAiOverrides : null
        this.packet = custom
            ? {
                  ...base,
                  ...custom,
                  // a Custom best_weapon choice is an explicit setting (not CE's unset -1)
                  ...(custom.bestWeapon !== undefined ? { bestWeaponUnset: false } : {}),
              }
            : base
    }
}

// ── AI helpers ────────────────────────────────────────────────────────────────
