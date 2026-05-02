// Unarmed combat modes for when no weapon is equipped (equippedWeapon === null).
// These are the base "no weapon in hand" modes, distinct from the Weapon(null)
// fist-weapon path used by UNARMED_MOVES in critter.ts.

export interface UnarmedMode {
    name: string
    family: 'punch' | 'kick'  // punch = left-hand moves, kick = right-hand moves
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
    { name: 'punch',           family: 'punch', icon: 'punch', skillThreshold:   0, apCost: 3, minDmg: 1, maxDmg:  2, penetrate: false, critBonus:  0 },
    { name: 'kick',            family: 'kick',  icon: 'kick',  skillThreshold:   0, apCost: 3, minDmg: 1, maxDmg:  3, penetrate: false, critBonus:  0 },
    { name: 'strong punch',    family: 'punch', icon: 'punch', skillThreshold:  55, apCost: 4, minDmg: 3, maxDmg:  6, penetrate: false, critBonus:  0 },
    { name: 'strong kick',     family: 'kick',  icon: 'kick',  skillThreshold:  60, apCost: 4, minDmg: 3, maxDmg:  6, penetrate: false, critBonus:  0 },
    { name: 'palm strike',     family: 'punch', icon: 'punch', skillThreshold:  70, apCost: 5, minDmg: 3, maxDmg:  6, penetrate: false, critBonus: 20 },
    { name: 'haymaker',        family: 'punch', icon: 'punch', skillThreshold:  80, apCost: 5, minDmg: 3, maxDmg:  6, penetrate: false, critBonus:  5 },
    { name: 'piercing strike', family: 'punch', icon: 'punch', skillThreshold:  90, apCost: 5, minDmg: 3, maxDmg:  6, penetrate: true,  critBonus: 15 },
    { name: 'hook kick',       family: 'kick',  icon: 'kick',  skillThreshold: 100, apCost: 6, minDmg: 5, maxDmg: 10, penetrate: false, critBonus: 10 },
    { name: 'piercing kick',   family: 'kick',  icon: 'kick',  skillThreshold: 110, apCost: 7, minDmg: 5, maxDmg: 10, penetrate: true,  critBonus: 15 },
]

/** All modes available at the given skill level regardless of family. */
export function getAvailableUnarmedModes(skill: number): UnarmedMode[] {
    return UNARMED_MODES.filter(m => skill >= m.skillThreshold)
}

/** Punch-family modes available at the given skill level. */
export function getPunchModes(skill: number): UnarmedMode[] {
    return UNARMED_MODES.filter(m => m.family === 'punch' && skill >= m.skillThreshold)
}

/** Kick-family modes available at the given skill level. */
export function getKickModes(skill: number): UnarmedMode[] {
    return UNARMED_MODES.filter(m => m.family === 'kick' && skill >= m.skillThreshold)
}

export function getActivePunchMode(skill: number, punchModeIdx: number): UnarmedMode {
    const available = getPunchModes(skill)
    if (available.length === 0) return UNARMED_MODES[0] // punch always available
    return available[Math.min(punchModeIdx, available.length - 1)]
}

export function getActiveKickMode(skill: number, kickModeIdx: number): UnarmedMode {
    const available = getKickModes(skill)
    if (available.length === 0) return UNARMED_MODES[1] // kick always available
    return available[Math.min(kickModeIdx, available.length - 1)]
}

export function nextPunchModeIdx(skill: number, punchModeIdx: number): number {
    const available = getPunchModes(skill)
    if (available.length <= 1) return 0
    return (punchModeIdx + 1) % available.length
}

export function nextKickModeIdx(skill: number, kickModeIdx: number): number {
    const available = getKickModes(skill)
    if (available.length <= 1) return 0
    return (kickModeIdx + 1) % available.length
}

/**
 * Returns the active UnarmedMode for the player based on which hand is active
 * and whether both hands are empty (required for kick access).
 */
export function getActiveUnarmedModeForHand(
    skill: number,
    activeHand: 'leftHand' | 'rightHand',
    punchModeIdx: number,
    kickModeIdx: number,
    bothHandsEmpty: boolean
): UnarmedMode {
    if (activeHand === 'rightHand' && bothHandsEmpty) {
        return getActiveKickMode(skill, kickModeIdx)
    }
    return getActivePunchMode(skill, punchModeIdx)
}

// ── Legacy API kept for NPC call sites (modeIdx=0 → first available mode) ──

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
