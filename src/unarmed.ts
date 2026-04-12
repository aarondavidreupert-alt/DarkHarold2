// Unarmed combat modes for when no weapon is equipped (equippedWeapon === null).
// These are the base "no weapon in hand" modes, distinct from the Weapon(null)
// fist-weapon path used by UNARMED_MOVES in critter.ts.

export interface UnarmedMode {
    name: string
    icon: 'punch' | 'kick'    // icon file inside art/intrface/ (without .png)
    skillThreshold: number     // minimum Unarmed skill required to unlock
    apCost: number
    minDmg: number
    maxDmg: number
    penetrate: boolean         // piercing moves: reduce enemy armor to 20%
    critBonus: number          // added to critical chance for this mode
}

// Modes in skill-threshold order.  Punch and kick are always available.
export const UNARMED_MODES: UnarmedMode[] = [
    { name: 'punch',           icon: 'punch', skillThreshold:   0, apCost: 3, minDmg: 1, maxDmg:  2, penetrate: false, critBonus:  0 },
    { name: 'kick',            icon: 'kick',  skillThreshold:   0, apCost: 3, minDmg: 1, maxDmg:  3, penetrate: false, critBonus:  0 },
    { name: 'strong punch',    icon: 'punch', skillThreshold:  55, apCost: 4, minDmg: 3, maxDmg:  6, penetrate: false, critBonus:  0 },
    { name: 'strong kick',     icon: 'kick',  skillThreshold:  60, apCost: 4, minDmg: 3, maxDmg:  6, penetrate: false, critBonus:  0 },
    { name: 'palm strike',     icon: 'punch', skillThreshold:  70, apCost: 5, minDmg: 3, maxDmg:  6, penetrate: false, critBonus: 20 },
    { name: 'haymaker',        icon: 'punch', skillThreshold:  80, apCost: 5, minDmg: 3, maxDmg:  6, penetrate: false, critBonus:  5 },
    { name: 'piercing strike', icon: 'punch', skillThreshold:  90, apCost: 5, minDmg: 3, maxDmg:  6, penetrate: true,  critBonus: 15 },
    { name: 'hook kick',       icon: 'kick',  skillThreshold: 100, apCost: 6, minDmg: 5, maxDmg: 10, penetrate: false, critBonus: 10 },
    { name: 'piercing kick',   icon: 'kick',  skillThreshold: 110, apCost: 7, minDmg: 5, maxDmg: 10, penetrate: true,  critBonus: 15 },
]

/** Returns all modes available at the given Unarmed skill level. */
export function getAvailableUnarmedModes(skill: number): UnarmedMode[] {
    return UNARMED_MODES.filter(m => skill >= m.skillThreshold)
}

/**
 * Returns the active UnarmedMode for the given skill level and mode index.
 * modeIdx is an index into the available-modes list, not into UNARMED_MODES.
 * Falls back to the last available mode if modeIdx is out of range.
 */
export function getActiveUnarmedMode(skill: number, modeIdx: number): UnarmedMode {
    const available = getAvailableUnarmedModes(skill)
    if (available.length === 0) return UNARMED_MODES[0] // punch always available
    return available[Math.min(modeIdx, available.length - 1)]
}

/**
 * Returns the next mode index after cycling from modeIdx, wrapping around
 * the available modes for the given skill level.
 */
export function nextUnarmedModeIdx(skill: number, modeIdx: number): number {
    const available = getAvailableUnarmedModes(skill)
    if (available.length <= 1) return 0
    return (modeIdx + 1) % available.length
}
