/*
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

import globalState from './globalState.js'
import { hexDistance, hexNeighbors } from './geometry.js'
import { Critter, deserializeObj, SerializedObj } from './object.js'
import { arrayIncludes, arrayRemove } from './util.js'
import { AiPacket, Disposition, findCompanionPacketForDisposition, getAiPacket } from './aiPackets.js'

// Party member system for DarkFO

export class Party {
    // party members
    party: Critter[] = []

    // FO2-CE ref: party.cc partyMemberGetMaxMembersToFollow — base 1 + floor(CHA/2)
    maxSize(player: Critter): number {
        return 1 + Math.floor(player.getStat('CHA') / 2)
    }

    addPartyMember(obj: Critter) {
        const player = globalState.player as Critter
        if (this.party.length >= this.maxSize(player)) return
        console.log('party member %o added', obj)
        this.party.push(obj)
    }

    // Walk each living party member toward the player if more than 5 hexes away.
    // CE ref: party.cc partyMemberFollowMoveHandler.
    // Pathfinds to the nearest free hex adjacent to the player rather than the
    // player tile itself (which is blocked), then falls back to other neighbours.
    followPlayer(): void {
        const player = globalState.player as Critter | null
        if (!player || !globalState.gMap) return
        const map = globalState.gMap
        for (const member of this.party) {
            if (member.dead || member.inAnim()) continue
            if (hexDistance(member.position, player.position) <= 5) continue

            const neighbors = hexNeighbors(player.position)
                .filter(n => !map.objectsAtPosition(n).some(o => o !== member && o.blocks?.()))
                .sort((a, b) => hexDistance(a, member.position) - hexDistance(b, member.position))

            for (const dest of neighbors) {
                if (member.walkTo(dest, false) !== false) break
            }
        }
    }

    // Remove a party member without destroying them — they remain on the map as
    // a normal NPC. CE ref: party.cc partyMemberRemove. Use this for dialogue
    // "leave my party" hooks.
    dismissPartyMember(obj: Critter): boolean {
        if (!arrayIncludes(this.party, obj)) return false
        arrayRemove(this.party, obj)
        return true
    }

    removePartyMember(obj: Critter) {
        console.log('party member %o removed', obj)
        if (!arrayRemove(this.party, obj)) throw Error('Could not remove party member')
    }

    getPartyMembers(): Critter[] {
        return this.party
    }

    getPartyMembersAndPlayer(): Critter[] {
        return [<Critter>globalState.player].concat(this.party)
    }

    isPartyMember(obj: Critter) {
        return arrayIncludes(this.party, obj)
    }

    getPartyMemberByPID(pid: number) {
        return this.party.find((obj) => obj.pid === pid) || null
    }

    serialize(): SerializedObj[] {
        return this.party.map((obj) => obj.serialize())
    }

    deserialize(objs: SerializedObj[]): void {
        this.party.length = 0
        for (const obj of objs) this.party.push(<Critter>deserializeObj(obj))
    }
}

// ── Companion behavior control (party member control/customization screens) ──
//
// CE ref: game_dialog.cc partyMemberControlWindowInit/partyMemberCustomization-
// WindowInit — the in-game "control" panel (5 disposition presets: Berserk,
// Aggressive, Defensive, Coward, Custom) and the 6-category "custom" sub-screen
// (area_attack_mode, run_away_mode, best_weapon, distance, attack_who, chem_use).
// See wiki/companion_party.md §8 for the full verified mechanics writeup.

/**
 * Switch a companion to a named disposition preset (Berserk/Aggressive/
 * Defensive/Coward) or to 'custom' (opens the door for per-field overrides
 * via setCompanionCustomSetting). Returns false if this companion has no
 * disposition-variant packets authored in ai.txt at all (ordinary NPCs
 * promoted to the party via scripts rather than scripted as companions).
 * CE ref: combat_ai.cc:903 aiSetDisposition.
 */
export function setCompanionDisposition(critter: Critter, disposition: Disposition): boolean {
    const currentPacket = critter.ai?.packet ?? getAiPacket(critter.aiNum)
    const newPacket = findCompanionPacketForDisposition(currentPacket, disposition)
    if (!newPacket) return false

    critter.aiNum = newPacket.packetNum
    if (critter.ai) critter.ai.packet = newPacket

    // Switching to a named preset uses that preset's authored values as-is —
    // any leftover per-field overrides from a previous Custom session no
    // longer apply (and would otherwise silently reappear if the player
    // switches back to Custom later expecting a clean slate... actually no,
    // CE's Custom screen always reflects the *current* packet's values, so
    // clearing here is specifically about not leaking AGGRESSIVE-session
    // overrides into a later DEFENSIVE session, etc).
    if (disposition !== 'custom') critter.customAiOverrides = null

    return true
}

export type CustomAiCategory = 'areaAttackMode' | 'runAwayMode' | 'bestWeapon' | 'distance' | 'attackWho' | 'chemUse'

/**
 * Apply one field override from the 6-category Custom screen. Switches the
 * companion onto its 'custom' packet first if it isn't already there.
 * Overrides are stored on Critter.customAiOverrides (persisted with the
 * save — see SERIALIZED_CRITTER_PROPS) and merged onto the base packet by
 * AI's constructor, so they survive AI re-creation across combats.
 * Returns false if this companion has no 'custom' packet authored in ai.txt.
 */
export function setCompanionCustomSetting<K extends CustomAiCategory>(
    critter: Critter,
    category: K,
    value: AiPacket[K]
): boolean {
    let packet = critter.ai?.packet ?? getAiPacket(critter.aiNum)
    if (packet.disposition !== 'custom') {
        const customPacket = findCompanionPacketForDisposition(packet, 'custom')
        if (!customPacket) return false
        critter.aiNum = customPacket.packetNum
        packet = customPacket
    }

    critter.customAiOverrides = { ...critter.customAiOverrides, [category]: value }
    if (critter.ai) critter.ai.packet = { ...packet, ...critter.customAiOverrides }

    return true
}

/** Read the companion's currently-effective AI packet (base + custom overrides
 *  merged), for UI display purposes — mirrors the merge AI's constructor does. */
export function getCompanionEffectivePacket(critter: Critter): AiPacket {
    const base = critter.ai?.packet ?? getAiPacket(critter.aiNum)
    return critter.customAiOverrides ? { ...base, ...critter.customAiOverrides } : base
}
