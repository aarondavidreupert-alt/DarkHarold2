// FO2-CE ref: src/perk.h (PERK_* enum), src/perk.cc (perk data tables)
// Perk requirement checking and application — split out of perks.ts per
// wiki/ts-split-refactor.md → "Per-file split proposals" §11.

import { Player } from '../player.js'
import { PerkDef, PERKS, SPECIAL } from './perks.data.js'

/**
 * Returns all perks that the player meets the requirements for and has not
 * yet taken the maximum number of ranks.
 * FO2-CE ref: perk.cc perkIsValid() — level, stat, skill checks.
 */
export function getValidPerks(player: Player): PerkDef[] {
    const level = player.getStat('Level')
    return PERKS.filter(perk => {
        // Already at max rank — exclude
        if (getPerkRank(player, perk.name) >= perk.maxRanks) return false
        // Level requirement
        if (level < perk.minLevel) return false
        // SPECIAL stat requirements
        if (perk.minStats) {
            for (const [stat, req] of Object.entries(perk.minStats) as [SPECIAL, number][]) {
                if (player.getStat(stat) < req) return false
            }
        }
        // Skill requirements (effective value, after all bonuses)
        if (perk.minSkills) {
            for (const [skill, req] of Object.entries(perk.minSkills) as [string, number][]) {
                if (player.getSkill(skill) < req) return false
            }
        }
        return true
    })
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
    const def = PERKS.find(p => p.name === perkName)
    if (!def) throw new Error(`applyPerk: unknown perk '${perkName}'`)

    const rank = getPerkRank(player, perkName)
    if (rank >= def.maxRanks) throw new Error(`applyPerk: '${perkName}' already at max rank ${def.maxRanks}`)

    player.perks.push(perkName)
    player.pendingPerkPick = false

    // Tag! enables the 4th tagged-skill slot in SkillSet
    if (perkName === 'Tag!') {
        player.skills.hasTagPerk = true
    }
}
