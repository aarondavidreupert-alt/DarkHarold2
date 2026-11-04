// CE perk table (fallout2-ce perk.cc gPerkDescriptions, indexed by the perk_defs.h
// Perk enum 0..118 that scripts use) — only the fields the engine needs at runtime:
// maxRank (-1 = unlimited / non-selectable), the per-rank stat modifier, and, for
// maxRank == -1 perks, the SPECIAL deltas applied by perkAddEffect. Generated from
// the CE source 2026-10-06. Display names come from perk.msg (101 + id).
//
// DH2 stores perks as display names in player.perks[]; perks.data.ts PERKS is the
// selectable-perk list for the level-up modal and is NOT indexed by CE id.

import type { Critter } from '../object.js'
import { STAT_NAME_BY_ID } from '../statIds.js'
import { getMessage } from '../util.js'

export interface CePerk {
    id: number
    maxRank: number
    stat: number
    statMod: number
    stats: number[]
}

export const CE_PERKS: CePerk[] = [
    { id: 0, maxRank: 1, stat: -1, statMod: 0, stats: [0, 5, 0, 0, 0, 0, 0] }, // PERK_AWARENESS
    { id: 1, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 6, 0] }, // PERK_BONUS_HTH_ATTACKS
    { id: 2, maxRank: 3, stat: 11, statMod: 2, stats: [6, 0, 0, 0, 0, 6, 0] }, // PERK_BONUS_HTH_DAMAGE
    { id: 3, maxRank: 2, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 5, 0] }, // PERK_BONUS_MOVE
    { id: 4, maxRank: 2, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 6, 6] }, // PERK_BONUS_RANGED_DAMAGE
    { id: 5, maxRank: 1, stat: -1, statMod: 0, stats: [0, 6, 0, 0, 6, 7, 0] }, // PERK_BONUS_RATE_OF_FIRE
    { id: 6, maxRank: 3, stat: 13, statMod: 2, stats: [0, 6, 0, 0, 0, 0, 0] }, // PERK_EARLIER_SEQUENCE
    { id: 7, maxRank: 3, stat: 14, statMod: 2, stats: [0, 0, 6, 0, 0, 0, 0] }, // PERK_FASTER_HEALING
    { id: 8, maxRank: 3, stat: 15, statMod: 5, stats: [0, 0, 0, 0, 0, 0, 6] }, // PERK_MORE_CRITICALS
    { id: 9, maxRank: 1, stat: -1, statMod: 0, stats: [0, 6, 0, 0, 0, 0, 0] }, // PERK_NIGHT_VISION
    { id: 10, maxRank: 3, stat: -1, statMod: 0, stats: [0, 0, 0, 6, 0, 0, 0] }, // PERK_PRESENCE
    { id: 11, maxRank: 2, stat: 31, statMod: 15, stats: [0, 0, 6, 0, 4, 0, 0] }, // PERK_RAD_RESISTANCE
    { id: 12, maxRank: 3, stat: 24, statMod: 10, stats: [0, 0, 6, 0, 0, 0, 6] }, // PERK_TOUGHNESS
    { id: 13, maxRank: 3, stat: 12, statMod: 50, stats: [6, 0, 6, 0, 0, 0, 0] }, // PERK_STRONG_BACK
    { id: 14, maxRank: 1, stat: -1, statMod: 0, stats: [0, 7, 0, 0, 6, 0, 0] }, // PERK_SHARPSHOOTER
    { id: 15, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 6, 0] }, // PERK_SILENT_RUNNING
    { id: 16, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 6, 0, 6, 0, 0] }, // PERK_SURVIVALIST
    { id: 17, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 7, 0, 0, 0] }, // PERK_MASTER_TRADER
    { id: 18, maxRank: 3, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 6, 0, 0] }, // PERK_EDUCATED
    { id: 19, maxRank: 2, stat: -1, statMod: 0, stats: [0, 7, 0, 0, 5, 6, 0] }, // PERK_HEALER
    { id: 20, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 8] }, // PERK_FORTUNE_FINDER
    { id: 21, maxRank: 1, stat: 16, statMod: 20, stats: [0, 6, 0, 0, 0, 4, 6] }, // PERK_BETTER_CRITICALS
    { id: 22, maxRank: 1, stat: -1, statMod: 0, stats: [0, 7, 0, 0, 5, 0, 0] }, // PERK_EMPATHY
    { id: 23, maxRank: 1, stat: -1, statMod: 0, stats: [8, 0, 0, 0, 0, 8, 0] }, // PERK_SLAYER
    { id: 24, maxRank: 1, stat: -1, statMod: 0, stats: [0, 8, 0, 0, 0, 8, 0] }, // PERK_SNIPER
    { id: 25, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 10, 0] }, // PERK_SILENT_DEATH
    { id: 26, maxRank: 2, stat: 8, statMod: 1, stats: [0, 0, 0, 0, 0, 5, 0] }, // PERK_ACTION_BOY
    { id: 27, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_MENTAL_BLOCK
    { id: 28, maxRank: 2, stat: -1, statMod: 0, stats: [0, 0, 4, 0, 0, 0, 0] }, // PERK_LIFEGIVER
    { id: 29, maxRank: 1, stat: 9, statMod: 5, stats: [0, 0, 0, 0, 0, 6, 0] }, // PERK_DODGER
    { id: 30, maxRank: 2, stat: 32, statMod: 25, stats: [0, 0, 3, 0, 0, 0, 0] }, // PERK_SNAKEATER
    { id: 31, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_MR_FIXIT
    { id: 32, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_MEDIC
    { id: 33, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_MASTER_THIEF
    { id: 34, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_SPEAKER
    { id: 35, maxRank: 3, stat: -1, statMod: 0, stats: [-9, 0, 0, 0, 0, 0, 0] }, // PERK_HEAVE_HO
    { id: 36, maxRank: 1, stat: -1, statMod: 0, stats: [0, 4, 0, 0, 0, 0, 0] }, // PERK_FRIENDLY_FOE
    { id: 37, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 8, 0] }, // PERK_PICKPOCKET
    { id: 38, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_GHOST
    { id: 39, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 10, 0, 0, 0] }, // PERK_CULT_OF_PERSONALITY
    { id: 40, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 8] }, // PERK_SCROUNGER
    { id: 41, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_EXPLORER
    { id: 42, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 5, 0, 0, 0, 0] }, // PERK_FLOWER_CHILD
    { id: 43, maxRank: 2, stat: -1, statMod: 0, stats: [0, 0, 6, 0, 0, 0, 0] }, // PERK_PATHFINDER
    { id: 44, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 5, 0, 0] }, // PERK_ANIMAL_FRIEND
    { id: 45, maxRank: 1, stat: -1, statMod: 0, stats: [0, 7, 0, 0, 0, 0, 0] }, // PERK_SCOUT
    { id: 46, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 4] }, // PERK_MYSTERIOUS_STRANGER
    { id: 47, maxRank: 1, stat: -1, statMod: 0, stats: [0, 6, 0, 0, 0, 0, 0] }, // PERK_RANGER
    { id: 48, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 5, 0] }, // PERK_QUICK_POCKETS
    { id: 49, maxRank: 3, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 4, 0, 0] }, // PERK_SMOOTH_TALKER
    { id: 50, maxRank: 3, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 4, 0, 0] }, // PERK_SWIFT_LEARNER
    { id: 51, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_TAG
    { id: 52, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_MUTATE
    { id: 53, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_NUKA_COLA_ADDICTION
    { id: 54, maxRank: -1, stat: -1, statMod: 0, stats: [-2, 0, -2, 0, 0, -3, 0] }, // PERK_BUFFOUT_ADDICTION
    { id: 55, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, -3, -2, 0] }, // PERK_MENTATS_ADDICTION
    { id: 56, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, -2, 0, 0] }, // PERK_PSYCHO_ADDICTION
    { id: 57, maxRank: -1, stat: 31, statMod: -20, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_RADAWAY_ADDICTION
    { id: 58, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_WEAPON_LONG_RANGE
    { id: 59, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_WEAPON_ACCURATE
    { id: 60, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_WEAPON_PENETRATE
    { id: 61, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_WEAPON_KNOCKBACK
    { id: 62, maxRank: -1, stat: 31, statMod: 30, stats: [3, 0, 0, 0, 0, 0, 0] }, // PERK_POWERED_ARMOR
    { id: 63, maxRank: -1, stat: 31, statMod: 20, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_COMBAT_ARMOR
    { id: 64, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_WEAPON_SCOPE_RANGE
    { id: 65, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_WEAPON_FAST_RELOAD
    { id: 66, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_WEAPON_NIGHT_SIGHT
    { id: 67, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_WEAPON_FLAMEBOY
    { id: 68, maxRank: -1, stat: 31, statMod: 60, stats: [4, 0, 0, 0, 0, 0, 0] }, // PERK_ARMOR_ADVANCED_I
    { id: 69, maxRank: -1, stat: 31, statMod: 75, stats: [4, 0, 0, 0, 0, 0, 0] }, // PERK_ARMOR_ADVANCED_II
    { id: 70, maxRank: -1, stat: 8, statMod: -1, stats: [-1, -1, 0, 0, 0, 0, 0] }, // PERK_JET_ADDICTION
    { id: 71, maxRank: -1, stat: -1, statMod: 0, stats: [0, -2, 0, 0, -1, 0, -1] }, // PERK_TRAGIC_ADDICTION
    { id: 72, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 2, 0, 0, 0] }, // PERK_ARMOR_CHARISMA
    { id: 73, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_GECKO_SKINNING
    { id: 74, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_DERMAL_IMPACT_ARMOR
    { id: 75, maxRank: -1, stat: 3, statMod: -1, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_DERMAL_IMPACT_ASSAULT_ENHANCEMENT
    { id: 76, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_PHOENIX_ARMOR_IMPLANTS
    { id: 77, maxRank: -1, stat: 3, statMod: -1, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_PHOENIX_ASSAULT_ENHANCEMENT
    { id: 78, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_VAULT_CITY_INOCULATIONS
    { id: 79, maxRank: 1, stat: -1, statMod: 0, stats: [-10, 0, 0, 0, 0, 0, 0] }, // PERK_ADRENALINE_RUSH
    { id: 80, maxRank: 1, stat: -1, statMod: 0, stats: [0, 6, 0, 0, 0, 0, 0] }, // PERK_CAUTIOUS_NATURE
    { id: 81, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 6, 0, 0] }, // PERK_COMPREHENSION
    { id: 82, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 4, 0] }, // PERK_DEMOLITION_EXPERT
    { id: 83, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_GAMBLER
    { id: 84, maxRank: 1, stat: -1, statMod: 0, stats: [-10, 0, 0, 0, 0, 0, 0] }, // PERK_GAIN_STRENGTH
    { id: 85, maxRank: 1, stat: -1, statMod: 0, stats: [0, -10, 0, 0, 0, 0, 0] }, // PERK_GAIN_PERCEPTION
    { id: 86, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, -10, 0, 0, 0, 0] }, // PERK_GAIN_ENDURANCE
    { id: 87, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, -10, 0, 0, 0] }, // PERK_GAIN_CHARISMA
    { id: 88, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, -10, 0, 0] }, // PERK_GAIN_INTELLIGENCE
    { id: 89, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, -10, 0] }, // PERK_GAIN_AGILITY
    { id: 90, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, -10] }, // PERK_GAIN_LUCK
    { id: 91, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_HARMLESS
    { id: 92, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_HERE_AND_NOW
    { id: 93, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_HTH_EVADE
    { id: 94, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 5, 0, 0, 5, 0] }, // PERK_KAMA_SUTRA_MASTER
    { id: 95, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 6, 0, 0, 0] }, // PERK_KARMA_BEACON
    { id: 96, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 5, 5] }, // PERK_LIGHT_STEP
    { id: 97, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_LIVING_ANATOMY
    { id: 98, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, -10, 0, 0, 0] }, // PERK_MAGNETIC_PERSONALITY
    { id: 99, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_NEGOTIATOR
    { id: 100, maxRank: 1, stat: 12, statMod: 50, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_PACK_RAT
    { id: 101, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_PYROMANIAC
    { id: 102, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 5, 0] }, // PERK_QUICK_RECOVERY
    { id: 103, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_SALESMAN
    { id: 104, maxRank: 1, stat: -1, statMod: 0, stats: [6, 0, 0, 0, 0, 0, 0] }, // PERK_STONEWALL
    { id: 105, maxRank: 1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_THIEF
    { id: 106, maxRank: 1, stat: -1, statMod: 0, stats: [-7, 0, 0, 0, 0, 5, 0] }, // PERK_WEAPON_HANDLING
    { id: 107, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_VAULT_CITY_TRAINING
    { id: 108, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_ALCOHOL_RAISED_HIT_POINTS
    { id: 109, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_ALCOHOL_RAISED_HIT_POINTS_II
    { id: 110, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_ALCOHOL_LOWERED_HIT_POINTS
    { id: 111, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_ALCOHOL_LOWERED_HIT_POINTS_II
    { id: 112, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_AUTODOC_RAISED_HIT_POINTS
    { id: 113, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_AUTODOC_RAISED_HIT_POINTS_II
    { id: 114, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_AUTODOC_LOWERED_HIT_POINTS
    { id: 115, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_AUTODOC_LOWERED_HIT_POINTS_II
    { id: 116, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_EXPERT_EXCREMENT_EXPEDITOR
    { id: 117, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_WEAPON_ENHANCED_KNOCKOUT
    { id: 118, maxRank: -1, stat: -1, statMod: 0, stats: [0, 0, 0, 0, 0, 0, 0] }, // PERK_JINXED
]

export const PERK_COUNT = 119

// CE perk.cc gPerkDescriptions — the requirements perkCanAdd checks, per perk id:
// [minLevel, param1, value1, paramMode, param2, value2, frmId (art/skilldex)]. param = skill id, or a GVAR
// when bit 0x4000000 is set; a negative value is an upper bound (must be below -value);
// paramMode 0 = first only, 1 = OR, 2 = AND. Generated from the CE source 2026-10-18.
export const CE_PERK_REQS: number[][] = [
    [3, -1, 0, 0, -1, 0, 72], // 0
    [15, -1, 0, 0, -1, 0, 73], // 1
    [3, -1, 0, 0, -1, 0, 74], // 2
    [6, -1, 0, 0, -1, 0, 75], // 3
    [6, -1, 0, 0, -1, 0, 76], // 4
    [15, -1, 0, 0, -1, 0, 77], // 5
    [3, -1, 0, 0, -1, 0, 78], // 6
    [3, -1, 0, 0, -1, 0, 79], // 7
    [6, -1, 0, 0, -1, 0, 80], // 8
    [3, -1, 0, 0, -1, 0, 81], // 9
    [3, -1, 0, 0, -1, 0, 82], // 10
    [6, -1, 0, 0, -1, 0, 83], // 11
    [3, -1, 0, 0, -1, 0, 84], // 12
    [3, -1, 0, 0, -1, 0, 85], // 13
    [9, -1, 0, 0, -1, 0, 86], // 14
    [6, 8, 50, 0, -1, 0, 87], // 15
    [3, 17, 40, 0, -1, 0, 88], // 16
    [12, 15, 75, 0, -1, 0, 89], // 17
    [6, -1, 0, 0, -1, 0, 90], // 18
    [3, 6, 40, 0, -1, 0, 91], // 19
    [6, -1, 0, 0, -1, 0, 92], // 20
    [9, -1, 0, 0, -1, 0, 93], // 21
    [6, -1, 0, 0, -1, 0, 94], // 22
    [24, 3, 80, 0, -1, 0, 95], // 23
    [24, 0, 80, 0, -1, 0, 96], // 24
    [18, 8, 80, 2, 3, 80, 97], // 25
    [12, -1, 0, 0, -1, 0, 98], // 26
    [310, -1, 0, 0, -1, 0, 99], // 27
    [12, -1, 0, 0, -1, 0, 100], // 28
    [9, -1, 0, 0, -1, 0, 101], // 29
    [6, -1, 0, 0, -1, 0, 102], // 30
    [12, 13, 40, 1, 12, 40, 103], // 31
    [12, 6, 40, 1, 7, 40, 104], // 32
    [12, 10, 50, 2, 9, 50, 105], // 33
    [9, 14, 50, 0, -1, 0, 106], // 34
    [6, -1, 0, 0, -1, 0, 107], // 35
    [310, -1, 0, 0, -1, 0, 108], // 36
    [15, 10, 80, 0, -1, 0, 109], // 37
    [6, 8, 60, 0, -1, 0, 110], // 38
    [12, -1, 0, 0, -1, 0, 111], // 39
    [310, -1, 0, 0, -1, 0, 112], // 40
    [9, -1, 0, 0, -1, 0, 113], // 41
    [310, -1, 0, 0, -1, 0, 114], // 42
    [6, 17, 40, 0, -1, 0, 115], // 43
    [310, 17, 25, 0, -1, 0, 116], // 44
    [3, -1, 0, 0, -1, 0, 117], // 45
    [9, -1, 0, 0, -1, 0, 118], // 46
    [6, -1, 0, 0, -1, 0, 119], // 47
    [3, -1, 0, 0, -1, 0, 120], // 48
    [3, -1, 0, 0, -1, 0, 121], // 49
    [3, -1, 0, 0, -1, 0, 122], // 50
    [12, -1, 0, 0, -1, 0, 123], // 51
    [9, -1, 0, 0, -1, 0, 124], // 52
    [1, -1, 0, 0, -1, 0, 125], // 53
    [1, -1, 0, 0, -1, 0, 126], // 54
    [1, -1, 0, 0, -1, 0, 127], // 55
    [1, -1, 0, 0, -1, 0, 128], // 56
    [1, -1, 0, 0, -1, 0, 129], // 57
    [1, -1, 0, 0, -1, 0, 130], // 58
    [1, -1, 0, 0, -1, 0, 131], // 59
    [1, -1, 0, 0, -1, 0, 132], // 60
    [1, -1, 0, 0, -1, 0, 133], // 61
    [1, -1, 0, 0, -1, 0, 134], // 62
    [1, -1, 0, 0, -1, 0, 135], // 63
    [1, -1, 0, 0, -1, 0, 136], // 64
    [1, -1, 0, 0, -1, 0, 137], // 65
    [1, -1, 0, 0, -1, 0, 138], // 66
    [1, -1, 0, 0, -1, 0, 139], // 67
    [1, -1, 0, 0, -1, 0, 140], // 68
    [1, -1, 0, 0, -1, 0, 141], // 69
    [1, -1, 0, 0, -1, 0, 136], // 70
    [1, -1, 0, 0, -1, 0, 149], // 71
    [1, -1, 0, 0, -1, 0, 154], // 72
    [1, -1, 0, 0, -1, 0, 158], // 73
    [1, -1, 0, 0, -1, 0, 157], // 74
    [1, -1, 0, 0, -1, 0, 157], // 75
    [1, -1, 0, 0, -1, 0, 168], // 76
    [1, -1, 0, 0, -1, 0, 168], // 77
    [1, -1, 0, 0, -1, 0, 172], // 78
    [6, -1, 0, 0, -1, 0, 155], // 79
    [3, -1, 0, 0, -1, 0, 156], // 80
    [3, -1, 0, 0, -1, 0, 122], // 81
    [9, 11, 75, 0, -1, 0, 39], // 82
    [6, 16, 50, 0, -1, 0, 44], // 83
    [12, -1, 0, 0, -1, 0, 0], // 84
    [12, -1, 0, 0, -1, 0, 1], // 85
    [12, -1, 0, 0, -1, 0, 2], // 86
    [12, -1, 0, 0, -1, 0, 3], // 87
    [12, -1, 0, 0, -1, 0, 4], // 88
    [12, -1, 0, 0, -1, 0, 5], // 89
    [12, -1, 0, 0, -1, 0, 6], // 90
    [6, 10, 50, 2, 0x4000000, 50, 160], // 91
    [3, -1, 0, 0, -1, 0, 161], // 92
    [12, 3, 75, 0, -1, 0, 159], // 93
    [3, -1, 0, 0, -1, 0, 163], // 94
    [9, -1, 0, 0, -1, 0, 162], // 95
    [9, -1, 0, 0, -1, 0, 164], // 96
    [12, 7, 60, 0, -1, 0, 165], // 97
    [6, -1, 0, 0, -1, 0, 166], // 98
    [6, 15, 50, 2, 14, 50, 43], // 99
    [6, -1, 0, 0, -1, 0, 167], // 100
    [9, 1, 75, 0, -1, 0, 169], // 101
    [6, -1, 0, 0, -1, 0, 170], // 102
    [6, 15, 50, 0, -1, 0, 121], // 103
    [3, -1, 0, 0, -1, 0, 171], // 104
    [3, -1, 0, 0, -1, 0, 38], // 105
    [12, -1, 0, 0, -1, 0, 173], // 106
    [1, 7, 75, 0, -1, 0, 104], // 107
    [1, -1, 0, 0, -1, 0, 142], // 108
    [1, -1, 0, 0, -1, 0, 142], // 109
    [1, -1, 0, 0, -1, 0, 52], // 110
    [1, -1, 0, 0, -1, 0, 52], // 111
    [1, -1, 0, 0, -1, 0, 104], // 112
    [1, -1, 0, 0, -1, 0, 104], // 113
    [1, -1, 0, 0, -1, 0, 35], // 114
    [1, -1, 0, 0, -1, 0, 35], // 115
    [1, -1, 0, 0, -1, 0, 154], // 116
    [1, -1, 0, 0, -1, 0, 154], // 117
    [1, -1, 0, 0, -1, 0, 64], // 118
]

// CE perk.cc perkGetName — perk.msg 101 + id.
export function perkNameById(id: number): string | null {
    if (!(id >= 0 && id < PERK_COUNT)) return null
    return getMessage('perk', 101 + id)
}

let nameToId: Map<string, number> | null = null
export function perkIdByName(name: string): number {
    if (!nameToId) {
        nameToId = new Map()
        for (let i = 0; i < PERK_COUNT; i++) {
            const n = perkNameById(i)
            if (n && !nameToId.has(n.toLowerCase())) nameToId.set(n.toLowerCase(), i)
        }
    }
    return nameToId.get(name.toLowerCase()) ?? -1
}

function adjust(critter: Critter, stat: number, delta: number): void {
    if (delta === 0) return
    const name = STAT_NAME_BY_ID[stat]
    if (name) critter.stats.modifyBonus(name, delta) // CE critterSetBonusStat
}

// CE perk.cc:554 perkAddEffect / :594 perkRemoveEffect (stat + SPECIAL parts;
// HERE_AND_NOW's XP is handled by the caller).
export function perkApplyEffect(critter: Critter, id: number, sign: 1 | -1): void {
    const p = CE_PERKS[id]
    if (!p) return
    // PERK_GAIN_STRENGTH … PERK_GAIN_LUCK (84-90): CE adds 1 to the SPECIAL live in
    // critterGetStat; DH2 puts it on the bonus layer, so Max HP (base only) ignores it.
    if (critter.isPlayer && id >= 84 && id <= 90) adjust(critter, id - 84, sign)
    if (p.stat !== -1) adjust(critter, p.stat, sign * p.statMod)
    if (p.maxRank === -1) for (let s = 0; s < 7; s++) adjust(critter, s, sign * p.stats[s])
}

// CE inventory.cc _adjust_ac (perk part): for party members (the player included),
// the old armor's proto perk is removed and the new one's added (Powered Armor ST +3,
// etc.). The effect lands in the bonus stats, which are saved — so never reapply on load.
export function armorPerkSwap(critter: Critter, oldArmor: any, newArmor: any): void {
    if (oldArmor === newArmor) return
    const oldPerk = oldArmor?.pro?.extra?.perk
    const newPerk = newArmor?.pro?.extra?.perk
    if (typeof oldPerk === 'number') perkApplyEffect(critter, oldPerk, -1)
    if (typeof newPerk === 'number') perkApplyEffect(critter, newPerk, 1)
}
