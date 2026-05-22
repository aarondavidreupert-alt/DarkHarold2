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
import { hexDistance } from './geometry.js'
import { Critter, deserializeObj, SerializedObj } from './object.js'
import { arrayIncludes, arrayRemove } from './util.js'

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
    // FO2-CE ref: party.cc partyMemberFollowMoveHandler
    followPlayer(): void {
        const player = globalState.player as Critter | null
        if (!player) return
        for (const member of this.party) {
            if (member.dead || member.inAnim()) continue
            if (hexDistance(member.position, player.position) > 5) {
                member.walkTo(player.position, false)
            }
        }
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
