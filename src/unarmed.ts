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

// Unarmed attacks — CE combat.cc unarmedInitVanilla (gUnarmedHitDescriptions),
// unarmedGetPunchHitMode / unarmedGetKickHitMode / unarmedGetHitModeInRange and
// interface.cc interfaceUpdateItems / interfaceCycleItemAction.
//
// An empty left hand punches, an empty right hand kicks (independent of the other
// hand). Each hand has a primary hit mode — the best non-secondary move the player
// qualifies for — and a secondary one — the best secondary move, if any. The hand's
// action cycles primary → primary aimed → secondary → secondary aimed (CE
// INTERFACE_ITEM_ACTION_*); aiming needs critterCanAim (no Fast Shot).
// Critters other than the player always use the plain punch (CE _ai_pick_hit_mode
// returns HIT_MODE_PUNCH without a weapon; the move tables read gDude's stats only).

import globalState from './globalState.js'
import type { Critter } from './object.js'

export interface UnarmedMode {
    hitMode: number // CE HIT_MODE_*
    name: string
    family: 'punch' | 'kick' // ANIM_THROW_PUNCH / ANIM_KICK_LEG
    icon: string // art/intrface/<icon>.png — interfaceBarRefreshMainAction
    requiredLevel: number
    requiredSkill: number
    requiredST: number
    requiredAG: number
    minDmg: number
    maxDmg: number
    bonusDamage: number // added to both ends of the damage range (unarmedGetDamage)
    critBonus: number // own d100 for a critical on a hit (unarmedGetBonusCriticalChance)
    apCost: number
    penetrate: boolean // DT to 20% (unarmedIsPenetrating)
    secondary: boolean
}

function hit(
    hitMode: number,
    name: string,
    family: 'punch' | 'kick',
    icon: string,
    requiredLevel: number,
    requiredSkill: number,
    requiredST: number,
    requiredAG: number,
    bonusDamage: number,
    critBonus: number,
    apCost: number,
    penetrate: boolean,
    secondary: boolean,
): UnarmedMode {
    return {
        hitMode,
        name,
        family,
        icon,
        requiredLevel,
        requiredSkill,
        requiredST,
        requiredAG,
        minDmg: 1,
        maxDmg: 2,
        bonusDamage,
        critBonus,
        apCost,
        penetrate,
        secondary,
    }
}

// CE combat.cc unarmedInitVanilla, in HIT_MODE order (the last qualifying mode of a
// range wins). Every move does 1-2 + bonus; icons are the intrface.lst entries CE draws.
export const HIT_MODE_PUNCH = 4
export const HIT_MODE_KICK = 5
export const PUNCH: UnarmedMode = hit(4, 'Punch', 'punch', 'punch', 0, 0, 0, 0, 0, 0, 3, false, false)
export const KICK: UnarmedMode = hit(5, 'Kick', 'kick', 'kick', 0, 0, 0, 0, 0, 0, 3, false, false)
export const ADVANCED_PUNCHES: UnarmedMode[] = [
    hit(8, 'Strong Punch', 'punch', 'spunch', 0, 55, 0, 6, 3, 0, 3, false, false),
    hit(9, 'Hammer Punch', 'punch', 'hampnch', 6, 75, 5, 6, 5, 5, 3, false, false),
    hit(10, 'Lightning Punch', 'punch', 'cm_hymkr', 9, 100, 5, 7, 7, 15, 3, false, false),
    hit(11, 'Chop Punch', 'punch', 'cm_jab', 5, 75, 5, 7, 3, 10, 3, false, true),
    hit(12, 'Dragon Punch', 'punch', 'cm_plmst', 12, 115, 5, 7, 7, 20, 6, true, true),
    hit(13, 'Force Punch', 'punch', 'cm_pstrk', 16, 130, 5, 7, 10, 40, 8, true, true),
]
export const ADVANCED_KICKS: UnarmedMode[] = [
    hit(14, 'Strong Kick', 'kick', 'skick', 0, 40, 0, 6, 5, 0, 4, false, false),
    hit(15, 'Snap Kick', 'kick', 'snapkick', 6, 60, 0, 6, 7, 0, 4, false, false),
    hit(16, 'Roundhouse Kick', 'kick', 'cm_pwkck', 9, 80, 6, 6, 9, 5, 4, false, false),
    hit(17, 'Kip Kick', 'kick', 'hipk', 6, 60, 6, 7, 7, 0, 7, false, true),
    hit(18, 'Jump Kick', 'kick', 'cm_hookk', 12, 100, 6, 7, 9, 10, 7, true, true),
    hit(19, 'Death Blossom Kick', 'kick', 'cm_prckk', 15, 125, 6, 8, 12, 50, 9, true, true),
]

// CE unarmedGetHitModeInRange — the last move of the family the critter qualifies for
// (Unarmed skill, level, ST, AG) with the wanted secondary flag; else punch / kick.
export function unarmedHitMode(critter: Critter, family: 'punch' | 'kick', secondary: boolean): UnarmedMode {
    const basic = family === 'punch' ? PUNCH : KICK
    if (!critter.isPlayer) return basic
    const skill = critter.getSkill('Unarmed')
    const level = critter.getStat('Level')
    const st = critter.getStat('STR')
    const ag = critter.getStat('AGI')
    let best = basic
    for (const m of family === 'punch' ? ADVANCED_PUNCHES : ADVANCED_KICKS) {
        if (m.secondary !== secondary) continue
        if (skill < m.requiredSkill || level < m.requiredLevel || st < m.requiredST || ag < m.requiredAG) continue
        best = m
    }
    return best
}

// CE INTERFACE_ITEM_ACTION_PRIMARY .. SECONDARY_AIMING for an empty hand.
export type UnarmedAction = 'primary' | 'primaryAim' | 'secondary' | 'secondaryAim'
const ACTIONS: UnarmedAction[] = ['primary', 'primaryAim', 'secondary', 'secondaryAim']

function handFamily(hand: 'leftHand' | 'rightHand'): 'punch' | 'kick' {
    return hand === 'rightHand' ? 'kick' : 'punch'
}

function playerHand(critter: Critter): 'leftHand' | 'rightHand' {
    return (critter as any).activeHand ?? 'leftHand'
}

function getAction(hand: 'leftHand' | 'rightHand'): UnarmedAction {
    const idx = hand === 'rightHand' ? globalState.kickModeIdx : globalState.punchModeIdx
    return ACTIONS[idx] ?? 'primary'
}

// CE item.cc critterCanAim for an unarmed hit mode: only Fast Shot forbids it.
function canAim(critter: Critter): boolean {
    return !(critter.isPlayer && ((critter as any).traits ?? []).includes('Fast Shot'))
}

function actionValid(critter: Critter, hand: 'leftHand' | 'rightHand', action: UnarmedAction): boolean {
    const family = handFamily(hand)
    const basic = family === 'punch' ? PUNCH : KICK
    switch (action) {
        case 'primary':
            return true
        case 'primaryAim':
            return canAim(critter)
        case 'secondary':
            return unarmedHitMode(critter, family, true) !== basic
        case 'secondaryAim':
            return unarmedHitMode(critter, family, true) !== basic && canAim(critter)
    }
}

/** The empty hand's current hit mode and whether it is aimed (CE gInterfaceItemStates). */
export function currentUnarmed(critter: Critter): { mode: UnarmedMode; aiming: boolean } {
    if (!critter.isPlayer) return { mode: PUNCH, aiming: false }
    const hand = playerHand(critter)
    let action = getAction(hand)
    if (!actionValid(critter, hand, action)) action = 'primary' // e.g. a stat dropped
    const secondary = action === 'secondary' || action === 'secondaryAim'
    return {
        mode: unarmedHitMode(critter, handFamily(hand), secondary),
        aiming: action === 'primaryAim' || action === 'secondaryAim',
    }
}

/** The hit mode an empty `hand` would use with its selected action (inventory summary). */
export function unarmedHandMode(critter: Critter, hand: 'leftHand' | 'rightHand'): UnarmedMode {
    const action = getAction(hand)
    const secondary = (action === 'secondary' || action === 'secondaryAim') && actionValid(critter, hand, action)
    return unarmedHitMode(critter, handFamily(hand), secondary)
}

/** CE interfaceCycleItemAction for the active empty hand. Returns the new state. */
export function cycleUnarmedAction(critter: Critter): { mode: UnarmedMode; aiming: boolean } {
    const hand = playerHand(critter)
    let idx = ACTIONS.indexOf(getAction(hand))
    for (let i = 0; i < ACTIONS.length; i++) {
        idx = (idx + 1) % ACTIONS.length
        if (actionValid(critter, hand, ACTIONS[idx])) break
    }
    if (hand === 'rightHand') globalState.kickModeIdx = idx
    else globalState.punchModeIdx = idx
    return currentUnarmed(critter)
}

/** CE item.cc weaponGetActionPointCost for an unarmed hit mode: the move's AP,
 *  −1 with the player's Bonus HtH Attacks, +1 aimed, minimum 1. */
export function unarmedAPCost(critter: Critter, mode: UnarmedMode, aiming: boolean): number {
    let ap = mode.apCost
    if (critter.isPlayer && critter.hasPerk('Bonus HtH Attacks')) ap -= 1
    if (aiming) ap += 1
    return Math.max(1, ap)
}
