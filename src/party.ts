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
import { dbg } from './logger.js'
import { Critter, deserializeObj, SerializedObj } from './object.js'
import { arrayIncludes, arrayRemove, getFileText, getMessage, getRandomInt, parseIni } from './util.js'
import { SkillSet } from './char.js'
import { loadPRO } from './pro.js'
import { uiLog } from './ui_hud.js'
import { AiPacket, Disposition, findCompanionPacketForDisposition, getAiPacket } from './aiPackets.js'

// Party member system for DarkFO

// CE ref: party_member.cc PartyMemberDescription (level fields) — parsed from
// data/data/party.txt `[Party Member N]` sections. N is CE's member index.
interface PartyMemberLevelDesc {
    index: number
    pid: number
    levelMinimum: number
    levelUpEvery: number
    levelPids: number[]
}

// CE ref: party_member.cc:61 PartyMemberLevelUpInfo
export interface PartyMemberLevelUpInfo {
    level: number        // party member level
    numLevelUps: number  // PC level-ups observed with this member in the party
    isEarly: number      // last level-up came early via the probability roll
}

const PARTY_MEMBER_MAX_LEVEL = 6 // CE party_member.cc:45 (SFALL fix: was 5)

let partyDescs: PartyMemberLevelDesc[] | null = null

function loadPartyDescs(): PartyMemberLevelDesc[] {
    if (partyDescs) return partyDescs
    partyDescs = []
    try {
        const ini = parseIni(getFileText('data/data/party.txt'))
        for (const section of Object.keys(ini)) {
            const m = section.match(/^Party Member (\d+)$/)
            if (!m) continue
            const sec = ini[section]
            const levelPids = String(sec.level_pids ?? '-1').split(',').map((x: string) => parseInt(x.trim(), 10))
                .filter((x: number) => !isNaN(x) && x !== -1).slice(0, PARTY_MEMBER_MAX_LEVEL)
            partyDescs.push({
                index: parseInt(m[1], 10),
                pid: parseInt(sec.party_member_pid, 10),
                levelMinimum: parseInt(sec.level_minimum ?? '0', 10) || 0,
                levelUpEvery: parseInt(sec.level_up_every ?? '0', 10) || 0,
                levelPids,
            })
        }
    } catch (e) {
        dbg('party', `party.txt not loaded: ${e}`)
    }
    return partyDescs
}

export class Party {
    // party members
    party: Critter[] = []

    // CE ref: party_member.cc:61 _partyMemberLevelUpInfoList, keyed by party.txt index.
    levelUpInfo: { [memberIndex: number]: PartyMemberLevelUpInfo } = {}

    // CE ref: party_member.cc:375 partyMemberAdd. CE has NO engine-side follower
    // cap — the CHA-based limit lives in the scripts (party.h macros), which already
    // check it (incl. Magnetic Personality) before calling party_add. The old DH2 cap
    // here could veto a recruit the script had approved. CE only rejects duplicates
    // (same object or same pid) and a hard table limit.
    addPartyMember(obj: Critter) {
        if (this.party.some((m) => m === obj || m.pid === obj.pid)) return
        if (this.party.length >= loadPartyDescs().length + 20) return
        dbg('party', `party member ${(obj as any).name ?? obj.pid} added`)
        this.party.push(obj)
        // CE: critterSetTeam(object, 0) — party members join the player's team.
        const player = globalState.player as Critter | null
        if (player) obj.teamNum = player.teamNum
    }

    // CE ref: party_member.cc:1454 _partyMemberIncLevels — called once per PC level-up
    // (stat.cc:789). Each member with level data advances on every `level_up_every`th
    // PC level, or earlier with probability 100*levelMod/level_up_every (then skips
    // until the cycle completes).
    incLevels(): void {
        const player = globalState.player as Critter | null
        if (!player) return
        const pcLevel = player.getStat('Level')
        for (const obj of this.party) {
            if (obj.type !== 'critter') continue
            const desc = loadPartyDescs().find((d) => d.pid === obj.pid)
            if (!desc || desc.levelUpEvery === 0) continue
            if (pcLevel < desc.levelMinimum) continue
            const info = (this.levelUpInfo[desc.index] ??= { level: 0, numLevelUps: 0, isEarly: 0 })
            if (info.level >= desc.levelPids.length) continue

            info.numLevelUps++
            const levelMod = info.numLevelUps % desc.levelUpEvery
            if (info.isEarly !== 0) {
                if (levelMod === 0) info.isEarly = 0
                continue
            }
            if (levelMod !== 0 && getRandomInt(0, 100) > Math.trunc(100 * levelMod / desc.levelUpEvery)) continue

            info.level++
            if (levelMod !== 0) info.isEarly = 1
            // CE indexes level_pids by the new level (level_pids[0] is the base form).
            if (!copyLevelInfo(obj, desc.levelPids[info.level])) continue

            const name = obj.name ?? ''
            const fmt = getMessage('misc', 9000) // "%s has gained in some abilities."
            if (fmt) uiLog(fmt.replace('%s', name))
            const individual = getMessage('misc', 9000 + 10 * desc.index + info.level - 1)
            if (individual) {
                globalState.floatMessages.push({ msg: individual.replace('%s', name), obj, startTime: window.performance.now(), color: 'white' })
            }
            dbg('party', `${name} reached party level ${info.level}`)
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
        dbg('party', `party member ${(obj as any).name ?? obj.pid} removed`)
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

    serializeLevels(): { [memberIndex: number]: PartyMemberLevelUpInfo } {
        return JSON.parse(JSON.stringify(this.levelUpInfo))
    }

    deserializeLevels(data: { [memberIndex: number]: PartyMemberLevelUpInfo } | undefined): void {
        this.levelUpInfo = data ? JSON.parse(JSON.stringify(data)) : {}
    }

    deserialize(objs: SerializedObj[]): void {
        this.party.length = 0
        for (const obj of objs) this.party.push(<Critter>deserializeObj(obj))
    }
}

// CE ref: party_member.cc:1563 _partyMemberCopyLevelInfo — the member takes the
// SPECIAL (base + bonus) and skills of the next-stage proto and is healed to the
// new max HP; equipped armor/weapon stay equipped.
function copyLevelInfo(critter: Critter, stagePid: number | undefined): boolean {
    if (stagePid === undefined || stagePid === -1) return false
    const stage = loadPRO(stagePid, stagePid & 0xffff)
    if (!stage?.extra?.baseStats) return false
    const special = ['STR', 'PER', 'END', 'CHA', 'INT', 'AGI', 'LUK']
    for (const s of special) {
        const base = stage.extra.baseStats[s] ?? 0
        const bonus = stage.extra.bonusStats?.[s] ?? 0
        critter.stats.setBase(s, base + bonus)
    }
    // CE copies only SPECIAL (0-6) and skills; Max HP isn't copied (the arrays are
    // assigned directly, so critterUpdateDerivedStats never runs).
    const tagged = critter.skills?.tagged ?? []
    const points = critter.skills?.skillPoints ?? 0
    const skills = SkillSet.fromPro(stage.extra.skills)
    skills.tagged = tagged
    skills.skillPoints = points
    critter.skills = skills
    critter.stats.setBase('HP', critter.getStat('Max HP'))
    return true
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
