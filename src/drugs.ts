// Drug effects and addiction system for DarkHarold2
// FO2-CE ref: item.cc:_item_d_take_drug(), item.cc:_perform_drug_effect(),
//             item.cc:gDrugDescriptions[], proto_types.h, stat_defs.h
// See also wiki/drugs.md for the full system reference.
//
// Copyright 2014-2022 darkf (Apache 2.0)

import globalState from './globalState.js'
import { dbg } from './logger.js'
import { Critter, Obj } from './object.js'
import { Scripting } from './scripting.js'
import { uiLog } from './ui_hud.js'
import { Events } from './events.js'

interface DrugEffect {
    // pidID = pid & 0xFFFF
    pidID: number
    name: string
    // Immediate stat bonuses: statName -> delta
    immediate?: { [stat: string]: number }
    // Timed stat bonuses (reversed after duration): statName -> delta
    timedStats?: { [stat: string]: number }
    duration?: number // in game ticks
    // Immediate HP heal
    immediateHP?: number
    // Delayed HP damage (after delayTicks)
    delayedHP?: number
    delayTicks?: number
    // Addiction chance (0-100)
    addictChance?: number
    // Withdrawal stat penalties (applied once per tick cycle when addicted)
    withdrawal?: { [stat: string]: number }
    // Special effects
    specialEffect?: 'radaway' | 'jetCure' | 'jetAddict'
}

// Duration constants (CE ref: item.cc:2928 queueAddEvent(600 * duration, ...))
// DH2 TICKS_PER_MINUTE=600, TICKS_PER_HOUR=36000
const T_15MIN  =  9_000   // 15 game minutes
const T_30MIN  = 18_000   // 30 game minutes
const T_3H     = 108_000  // 3 game hours

const DRUG_TABLE: DrugEffect[] = [
    // ── Healing ──────────────────────────────────────────────────────────────
    // CE ref: PROTO_ID_STIMPACK=40
    // Immediate HP (CE: randomBetween(4,10); DH2: flat 10). No addiction.
    {
        pidID: 40, name: 'Stimpak',
        immediateHP: 10,
    },
    // CE ref: PROTO_ID_SUPER_STIMPACK=144
    // +75 HP immediate; −9 HP after 1 hour (CE: duration2 schedule). No addiction.
    {
        pidID: 144, name: 'Super Stimpak',
        immediateHP: 75,
        delayedHP: -9,
        delayTicks: 36_000,
    },
    // CE ref: PROTO_ID_NUKA_COLA=106
    {
        pidID: 106, name: 'Nuka-Cola',
        immediateHP: 2,
    },
    // CE ref: PROTO_ID_HEALING_POWDER=273 (Arroyo primitive)
    // +4 HP, −1 PER (timed, wears off after 30 min). No addiction.
    {
        pidID: 273, name: 'Healing Powder',
        immediateHP: 4,
        timedStats: { 'PER': -1 },
        duration: T_30MIN,
    },

    // ── Combat chems ─────────────────────────────────────────────────────────
    // CE ref: PROTO_ID_PSYCHO=110
    // +25 DR Normal for 3h. CE: gDrugDescriptions addictChance 10%, withdrawal −1 END.
    {
        pidID: 110, name: 'Psycho',
        timedStats: { 'DR Normal': 25 },
        duration: T_3H,
        addictChance: 10,
        withdrawal: { 'END': -1 },
    },
    // CE ref: PROTO_ID_BUFF_OUT=87
    // +2 STR, +2 END for 3h. CE: addictChance 10%, withdrawal −2 STR, −1 END.
    {
        pidID: 87, name: 'Buffout',
        timedStats: { 'STR': 2, 'END': 2 },
        duration: T_3H,
        addictChance: 10,
        withdrawal: { 'STR': -2, 'END': -1 },
    },

    // ── Cognitive chems ──────────────────────────────────────────────────────
    // CE ref: PROTO_ID_MENTATS=53
    // +2 INT, +2 PER for 3h. CE: addictChance 10%, withdrawal −1 INT.
    {
        pidID: 53, name: 'Mentats',
        timedStats: { 'INT': 2, 'PER': 2 },
        duration: T_3H,
        addictChance: 10,
        withdrawal: { 'INT': -1 },
    },

    // ── Action chems ─────────────────────────────────────────────────────────
    // CE ref: PROTO_ID_JET=259
    // +2 AP for 15 min. CE: addictChance 100% (guaranteed). Withdrawal −1 AGI, −1 END.
    // specialEffect 'jetAddict': marks critter as Jet Addict (required for Jet Antidote).
    {
        pidID: 259, name: 'Jet',
        timedStats: { 'AP': 2 },
        duration: T_15MIN,
        addictChance: 100,
        withdrawal: { 'AGI': -1, 'END': -1 },
        specialEffect: 'jetAddict',
    },

    // ── Alcohol ──────────────────────────────────────────────────────────────
    // CE ref: PROTO_ID_BEER=124 — CE GVAR_ALCOHOL_ADDICT; proto addictChance=0
    // +1 STR, −1 INT for 15 min.
    {
        pidID: 124, name: 'Beer',
        timedStats: { 'STR': 1, 'INT': -1 },
        duration: T_15MIN,
    },
    // CE ref: PROTO_ID_BOOZE=125 — same GVAR as Beer; proto addictChance=0
    // +2 STR, −2 INT for 15 min.
    {
        pidID: 125, name: 'Booze',
        timedStats: { 'STR': 2, 'INT': -2 },
        duration: T_15MIN,
    },

    // ── Environmental / antidotes ─────────────────────────────────────────────
    // CE ref: PROTO_ID_RADAWAY=48
    // −150 radiation. CE gDrugDescriptions: GVAR_RADAWAY_ADDICT but proto addictChance=0.
    {
        pidID: 48, name: 'Rad-Away',
        specialEffect: 'radaway',
    },
    // CE ref: PROTO_ID_JET_ANTIDOTE=260
    // Cures Jet addiction. CE: performWithdrawalEnd(PERK_JET_ADDICTION).
    {
        pidID: 260, name: 'Jet Antidote',
        specialEffect: 'jetCure',
    },
]

// Build a lookup map by pidID
const drugByPID: Map<number, DrugEffect> = new Map()
for (const d of DRUG_TABLE) {
    drugByPID.set(d.pidID, d)
}

export function getDrugByName(name: string): DrugEffect | undefined {
    return DRUG_TABLE.find(d => d.name === name)
}

export type { DrugEffect }

function computeAddictChance(drug: DrugEffect, user: Critter): number {
    let chance = drug.addictChance ?? 0
    // Chem Resistant halves the chance; Chem Reliant doubles it
    if (user.perks.includes('Chem Resistant')) chance = Math.floor(chance / 2)
    if (user.perks.includes('Chem Reliant')) chance = Math.min(100, chance * 2)
    return chance
}

/**
 * Apply a drug to a critter.
 * Returns true if the item is a recognized drug, false otherwise.
 * FO2-CE ref: item.cc:_item_d_take_drug(), item.cc:_perform_drug_effect()
 */
export function useDrug(item: Obj, user: Critter): boolean {
    const pidID = item.pid & 0xFFFF
    const drug = drugByPID.get(pidID)
    if (!drug) return false

    dbg('script', `[Drug] ${user.name} used ${drug.name} (pidID=${pidID})`)

    // Immediate HP heal — CE ref: item.cc:_perform_drug_effect STAT_CURRENT_HIT_POINTS
    if (drug.immediateHP !== undefined && drug.immediateHP > 0) {
        const maxHP = user.getStat('Max HP')
        const curHP = user.getStat('HP')
        const heal = Math.min(drug.immediateHP, maxHP - curHP)
        if (heal > 0) {
            user.stats.modifyBase('HP', heal)
            if (user.isPlayer) uiLog(`You heal ${heal} hit points.`)
        } else if (user.isPlayer) {
            uiLog("You're already at full health.")
        }
    }

    // Special effects ──────────────────────────────────────────────────────────
    // CE ref: item.cc:2789 — Jet Antidote performs withdrawalEnd and removes item
    if (drug.specialEffect === 'jetCure') {
        const addictions: string[] = (user as any).addictions ?? []
        const idx = addictions.indexOf('Jet')
        if (idx !== -1) {
            addictions.splice(idx, 1)
            ;(user as any).addictions = addictions
            const pi = user.perks.indexOf('Jet Addict')
            if (pi !== -1) user.perks.splice(pi, 1)
            if (user.isPlayer) uiLog('You no longer crave Jet.')
            dbg('script', `[Drug] ${user.name} cured of Jet addiction`)
        } else {
            if (user.isPlayer) uiLog("You don't need that right now.")
        }
        return true
    }

    // CE ref: item.cc — Rad-Away reduces radiationLevel
    if (drug.specialEffect === 'radaway') {
        const before = (user as any).radiationLevel ?? 0
        ;(user as any).radiationLevel = Math.max(0, before - 150)
        if (user.isPlayer) uiLog('You feel the radiation leaving your body.')
        dbg('script', `[Drug] ${user.name} Rad-Away: radiation ${before} → ${(user as any).radiationLevel}`)
        return true
    }

    // Jet addict perk — marks user as addicted (enables Jet Antidote target)
    if (drug.specialEffect === 'jetAddict') {
        if (!user.perks.includes('Jet Addict')) {
            user.perks.push('Jet Addict')
        }
    }

    // Delayed HP damage — CE ref: item.cc:_insert_drug_effect with duration2 schedule
    // (e.g. Super Stimpak: −9 HP after 1 hour)
    if (drug.delayedHP !== undefined && drug.delayTicks !== undefined) {
        const delayHP = drug.delayedHP
        const delayTicks = drug.delayTicks
        Scripting.timeEventList.push({
            obj: user,
            ticks: globalState.gameTickTime + delayTicks,
            userdata: 'drug:delayed:' + drug.name,
            fn: () => {
                const dmg = -delayHP // delayedHP is negative (damage)
                if (dmg > 0) {
                    user.stats.modifyBase('HP', -dmg)
                    if (user.isPlayer) uiLog(`The ${drug.name} wears off, causing ${dmg} damage.`)
                    dbg('script', `[Drug] ${drug.name} delayed effect: -${dmg} HP`)
                }
            },
        })
    }

    // Timed stat bonuses — CE ref: item.cc:_insert_drug_effect with duration1 schedule
    if (drug.timedStats && drug.duration) {
        const stats = drug.timedStats
        const duration = drug.duration

        // Apply bonuses immediately
        for (const [stat, delta] of Object.entries(stats)) {
            user.stats.modifyBase(stat, delta)
        }

        if (user.isPlayer) {
            const parts = Object.entries(stats).map(([s, d]) => `${d > 0 ? '+' : ''}${d} ${s}`)
            uiLog(`${drug.name}: ${parts.join(', ')}.`)
        }
        dbg('script', `[Drug] ${drug.name} timed effect applied, duration=${duration}`)

        // Schedule reversal + addiction check
        Scripting.timeEventList.push({
            obj: user,
            ticks: globalState.gameTickTime + duration,
            userdata: 'drug:' + drug.name,
            fn: () => {
                // Reverse stat mods
                for (const [stat, delta] of Object.entries(stats)) {
                    user.stats.modifyBase(stat, -delta)
                }
                if (user.isPlayer) uiLog(`${drug.name} wears off.`)
                dbg('script', `[Drug] ${drug.name} effect wore off`)

                // Addiction check — CE ref: item.cc:2822-2845
                const addictions: string[] = (user as any).addictions ?? []
                if (drug.addictChance && drug.addictChance > 0 && !addictions.includes(drug.name)) {
                    const chance = computeAddictChance(drug, user)
                    if (Math.random() * 100 < chance) {
                        addictions.push(drug.name)
                        ;(user as any).addictions = addictions
                        if (user.isPlayer) uiLog(`You are addicted to ${drug.name}.`)
                        dbg('script', `[Drug] ${user.name} became addicted to ${drug.name}`)
                    }
                }
            },
        })
    }

    return true
}

/**
 * Apply withdrawal stat penalties once per addiction per 600-tick cycle.
 * Called from map_update_p_proc in main.ts.
 * FO2-CE ref: addiction.cc addictionProcess
 */
export function tickAddictions(critter: Critter): void {
    const addictions: string[] = (critter as any).addictions ?? []
    if (addictions.length === 0) return

    for (const drugName of addictions) {
        const drug = DRUG_TABLE.find(d => d.name === drugName)
        if (!drug || !drug.withdrawal) continue

        // Check if any active drug timed event for this drug is in the list
        // (i.e., the drug is still in effect — no withdrawal while active)
        const isActive = Scripting.timeEventList.some(
            e => e.obj === critter && typeof e.userdata === 'string' && e.userdata === 'drug:' + drug.name
        )
        if (isActive) continue

        // Apply withdrawal penalties
        for (const [stat, delta] of Object.entries(drug.withdrawal)) {
            critter.stats.modifyBase(stat, delta)
            dbg('script', `[Drug] ${critter.name} withdrawal from ${drugName}: ${stat} ${delta}`)
        }
    }
}
