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

// Who-hit-me bookkeeping (CE critter.cc _critter_set_who_hit_me, combat_ai.cc
// _combatai_check_retaliation / _combatai_rating). This is the one engine-side
// reaction change in CE: being hit by the player sets the victim's reaction
// (LVAR 0, reaction.cc reactionSetValue) to -3.

import globalState from '../globalState.js'
import type { Critter } from '../object.js'
import { randomBetween } from '../random.js'

const isPartyMember = (c: Critter): boolean => !!globalState.gParty?.isPartyMember(c) || c.isPlayer

// CE stat.cc statRoll(critter, STAT_INTELLIGENCE, -1) < ROLL_SUCCESS(2)
function intRollFails(c: Critter): boolean {
    return randomBetween(1, 10) > c.getStat('INT') - 1
}

// CE critter.cc:1285 _critter_set_who_hit_me.
export function critterSetWhoHitMe(a1: Critter, a2: Critter | null): void {
    if (!a1 || a1.type !== 'critter') return
    if (a2 !== null && a2.type !== 'critter') return
    if (a2 === null || a1.teamNum !== a2.teamNum || (intRollFails(a1) && (!isPartyMember(a1) || !isPartyMember(a2)))) {
        ;(a1 as any).whoHitMe = a2
        if (a2 !== null && a2.isPlayer) {
            const script: any = a1._script
            if (script) {
                if (!script.lvars) script.lvars = {}
                script.lvars[0] = -3 // reaction.cc reactionSetValue(a1, -3)
            }
        }
    }
}

// CE combat_ai.cc _combatai_rating — best of melee damage and wielded weapons' max
// damage, plus AC; 0 for non-critters and the dead/knocked out.
function combatAiRating(obj: Critter | null): number {
    if (!obj || obj.type !== 'critter') return 0
    if (obj.dead || ((obj.injuryFlags ?? 0) & 0x01) !== 0) return 0
    let damage = obj.getStat('Melee Damage')
    for (const hand of ['rightHand', 'leftHand'] as const) {
        const item: any = (obj as any)[hand]
        const max = item?.subtype === 'weapon' ? item.pro?.extra?.maxDmg : undefined
        if (typeof max === 'number' && damage < max) damage = max
    }
    return damage + obj.getStat('AC') + obj.getArmorAC()
}

// CE combat_ai.cc _combatai_check_retaliation — switch to the new attacker if it
// rates higher than whoever hit us before.
export function combatAiCheckRetaliation(a1: Critter, a2: Critter): void {
    const prev: Critter | null = (a1 as any).whoHitMe ?? null
    if (prev) {
        if (combatAiRating(a2) > combatAiRating(prev)) critterSetWhoHitMe(a1, a2)
    } else {
        critterSetWhoHitMe(a1, a2)
    }
}

// CE combat.cc:4706-4716 (_combat_attack damage application). `accidental` is CE's
// v5 (defender != attack->oops, the intended target): a victim that died or was
// knocked out records its attacker (unless it's the player hit by accident); the
// intended target, or an accidental victim on another team, considers retaliating.
export function noteHit(victim: Critter, attacker: Critter, accidental: boolean): void {
    if (victim.type !== 'critter') return
    if (victim.dead || ((victim.injuryFlags ?? 0) & 0x01) !== 0) {
        if (!accidental || !victim.isPlayer) critterSetWhoHitMe(victim, attacker)
    } else if (!accidental || victim.teamNum !== attacker.teamNum) {
        combatAiCheckRetaliation(victim, attacker)
    }
}
