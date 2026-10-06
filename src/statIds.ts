// CE stat indices (stat_defs.h Stat enum) → DH2 StatSet names (src/skills.ts
// statDependencies). 36/37 (current poison / radiation level) are not StatSet
// entries — callers route them through poison()/critterAdjustRadiation().
// `null` = CE stat with no DH2 StatSet equivalent.
export const STAT_NAME_BY_ID: (string | null)[] = [
    'STR', 'PER', 'END', 'CHA', 'INT', 'AGI', 'LUK', // 0-6
    'Max HP', // 7  STAT_MAXIMUM_HIT_POINTS
    'AP', // 8  STAT_MAXIMUM_ACTION_POINTS
    'AC', // 9  STAT_ARMOR_CLASS
    null, // 10 STAT_UNARMED_DAMAGE
    'Melee', // 11 STAT_MELEE_DAMAGE
    'Carry', // 12 STAT_CARRY_WEIGHT
    'Sequence', // 13
    'Healing Rate', // 14
    'Critical Chance', // 15
    'Better Criticals', // 16
    'DT Normal', 'DT Laser', 'DT Fire', 'DT Plasma', 'DT Electrical', 'DT EMP', 'DT Explosive', // 17-23
    'DR Normal', 'DR Laser', 'DR Fire', 'DR Plasma', 'DR Electrical', 'DR EMP', 'DR Explosive', // 24-30
    'DR Radiation', // 31 STAT_RADIATION_RESISTANCE
    'DR Poison', // 32 STAT_POISON_RESISTANCE
    'Age', // 33
    'Gender', // 34
    'HP', // 35 STAT_CURRENT_HIT_POINTS
    null, // 36 STAT_CURRENT_POISON_LEVEL
    null, // 37 STAT_CURRENT_RADIATION_LEVEL
]

export const STAT_CURRENT_HIT_POINTS = 35
export const STAT_CURRENT_POISON_LEVEL = 36
export const STAT_CURRENT_RADIATION_LEVEL = 37
