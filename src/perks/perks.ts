// FO2-CE ref: src/perk.h (PERK_* enum), src/perk.cc (perk data tables)
// Perk requirement checking and application — split out of perks.ts per
// wiki/ts-split-refactor.md → "Per-file split proposals" §11.

import { CE_PERKS, CE_PERK_REQS, PERK_COUNT, perkApplyEffect, perkIdByName, perkNameById } from './cePerks.js'
import { getFileJSON, getMessage } from '../util.js'
import { Scripting } from '../scripting.js'
import { SKILL_NAMES } from '../skills.js'
import type { Player } from '../player.js'
import { PerkDef, PERKS, SPECIAL } from './perks.data.js'

/**
 * Returns all perks that the player meets the requirements for and has not
 * yet taken the maximum number of ranks.
 * CE ref: perk.cc perkCanAdd (via perkGetAvailablePerks) — rank, level, the two
 * skill / GVAR requirements and the SPECIAL requirements; a negative requirement
 * is an upper bound (the Gain <stat> perks need the stat below 10).
 */
export function getValidPerks(player: Player): PerkDef[] {
    // perk.msg not loaded: the perks.data.ts minimums
    if (perkNameById(0) === null) return PERKS.filter(perk => legacyCanAdd(player, perk))
    const out: PerkDef[] = []
    for (let id = 0; id < PERK_COUNT; id++) {
        if (!perkCanAdd(player, id)) continue
        const def = perkDefById(id)
        if (def) out.push(def)
    }
    return out
}

// The PerkDef of CE perk `id`: the perks.data.ts entry, else one built from perk.msg
// (name 101 + id, description 1101 + id) and the CE table (the Gain <stat> perks).
export function perkDefById(id: number): PerkDef | null {
    const name = perkNameById(id)
    if (!name) return null
    const known = PERKS.find(p => p.name.toLowerCase() === name.toLowerCase())
    if (known) return known
    const frm: string | undefined = (getFileJSON('lut/lst/art_skilldex.json') as string[] | null)?.[CE_PERK_REQS[id][6]]
    return {
        id: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        name,
        description: getMessage('perk', 1101 + id) ?? '',
        maxRanks: CE_PERKS[id].maxRank,
        minLevel: CE_PERK_REQS[id][0],
        img: frm ? 'art/skilldex/' + frm.split('.')[0].toLowerCase() + '.png' : undefined,
    }
}

const SPECIAL_ORDER: SPECIAL[] = ['STR', 'PER', 'END', 'CHA', 'INT', 'AGI', 'LUK']
const PARAM_GVAR = 0x4000000

// One skill / GVAR requirement of perkCanAdd (value < 0: must be below -value).
function perkParamMet(player: Player, param: number, value: number): boolean {
    const isVariable = (param & PARAM_GVAR) !== 0
    const p = param & ~PARAM_GVAR
    const current = isVariable ? Number(Scripting.getGlobalVar(p)) : player.getSkill(SKILL_NAMES[p])
    if (value < 0) return isVariable ? current < value : current < -value
    return current >= value
}

// CE perk.cc perkCanAdd
function perkCanAdd(player: Player, id: number): boolean {
    const ce = CE_PERKS[id]
    if (!ce || ce.maxRank === -1) return false
    if (getPerkRank(player, perkDefById(id)?.name ?? '') >= ce.maxRank) return false
    const [minLevel, param1, value1, paramMode, param2, value2] = CE_PERK_REQS[id]
    if (player.getStat('Level') < minLevel) return false

    const req1Fulfilled = param1 === -1 || perkParamMet(player, param1, value1)
    if (!req1Fulfilled || paramMode === PERK_PARAM_MODE_AND) {
        if (paramMode === PERK_PARAM_MODE_FIRST_ONLY) return false
        if (!req1Fulfilled && paramMode === PERK_PARAM_MODE_AND) return false
        if (param2 === -1) return false
        if (!perkParamMet(player, param2, value2)) return false
    }

    for (let stat = 0; stat < SPECIAL_ORDER.length; stat++) {
        const req = ce.stats[stat]
        const value = player.getStat(SPECIAL_ORDER[stat])
        if (req < 0 ? value >= -req : value < req) return false
    }
    return true
}
const PERK_PARAM_MODE_FIRST_ONLY = 0
const PERK_PARAM_MODE_AND = 2
const PERK_HERE_AND_NOW = 92

// perk.msg not loaded: the perks.data.ts minimums
function legacyCanAdd(player: Player, perk: PerkDef): boolean {
    if (getPerkRank(player, perk.name) >= perk.maxRanks) return false
    if (player.getStat('Level') < perk.minLevel) return false
    for (const [stat, req] of Object.entries(perk.minStats ?? {}) as [SPECIAL, number][]) {
        if (player.getStat(stat) < req) return false
    }
    for (const [skill, req] of Object.entries(perk.minSkills ?? {}) as [string, number][]) {
        if (player.getSkill(skill) < req) return false
    }
    return true
}

/**
 * Returns the number of times the player has taken the named perk.
 * FO2-CE ref: perk.cc perkGetValue() — counts occurrences in the perk list.
 */
export function getPerkRank(player: Player, perkName: string): number {
    let count = 0
    for (const p of player.perks) {
        if (p === perkName) count++
    }
    return count
}

/**
 * Adds a perk to the player and clears pendingPerkPick.
 * Applies data-layer side-effects only (Tag! enabling 4th tag slot).
 * All other effects (Educated SP, Lifegiver HP, skill bonuses) are already
 * handled by the existing hasPerk() checks in addExperience() and getSkill().
 * FO2-CE ref: perk.cc perk_add().
 */
export function applyPerk(player: Player, perkName: string): void {
    const def = PERKS.find(p => p.name === perkName) ?? perkDefById(perkIdByName(perkName))
    if (!def) throw new Error(`applyPerk: unknown perk '${perkName}'`)

    const rank = getPerkRank(player, perkName)
    if (rank >= def.maxRanks) throw new Error(`applyPerk: '${perkName}' already at max rank ${def.maxRanks}`)

    player.perks.push(perkName)
    player.pendingPerkPick = false
    // CE perk.cc:554 perkAddEffect — per-rank stat modifier (Toughness, Action Boy…).
    perkApplyEffect(player, perkIdByName(perkName), 1)

    // Tag! enables the 4th tagged-skill slot in SkillSet
    if (perkName === 'Tag!') {
        player.skills.hasTagPerk = true
    }
    // CE character_editor.cc perkDialogHandlePerk: Lifegiver adds 4 max HP (and HP) at
    // once, Educated 2 unspent skill points.
    if (perkName === 'Lifegiver') {
        player.stats.modifyBonus('Max HP', 4) // CE critterSetBonusStat(MAX_HP, +4)
        player.stats.modifyBase('HP', 4)
    } else if (perkName === 'Educated') {
        player.skills.skillPoints += 2
    }
    // CE perk.cc perkAddEffect PERK_HERE_AND_NOW: the XP up to the next level
    // (pcGetExperienceForLevel(level + 1) - experience), Swift Learner applied.
    if (perkIdByName(perkName) === PERK_HERE_AND_NOW) {
        const level = player.getStat('Level')
        player.addExperience((player.constructor as typeof Player).xpForLevel(level + 1) - player.getStat('Experience'))
    }
}
