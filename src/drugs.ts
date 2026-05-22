// Drug effects and addiction system for DarkHarold2
// FO2-CE ref: proto.cc drug data, addiction.cc
//
// Copyright 2014-2022 darkf (Apache 2.0)

import globalState from './globalState.js'
import { dbg } from './logger.js'
import { Critter, Obj } from './object.js'
import { Scripting } from './scripting.js'

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
    specialEffect?: 'radaway' | 'antidote' | 'jetAddict'
}

const DRUG_TABLE: DrugEffect[] = [
    // pidID 24: Stimpak — immediate +10 HP, no addiction
    {
        pidID: 24, name: 'Stimpak',
        immediateHP: 10,
    },
    // pidID 75: Super Stimpak — immediate +75 HP, delayed -9 HP at 36000 ticks
    {
        pidID: 75, name: 'Super Stimpak',
        immediateHP: 75,
        delayedHP: -9,
        delayTicks: 36000,
    },
    // pidID 28: Psycho — +25 DR Normal for 3000 ticks, addictChance 10%
    {
        pidID: 28, name: 'Psycho',
        timedStats: { 'DR Normal': 25 },
        duration: 3000,
        addictChance: 10,
        withdrawal: { 'END': -1 },
    },
    // pidID 27: Buffout — +2 STR, +2 END for 3000 ticks, addictChance 10%
    {
        pidID: 27, name: 'Buffout',
        timedStats: { 'STR': 2, 'END': 2 },
        duration: 3000,
        addictChance: 10,
        withdrawal: { 'STR': -2, 'AGI': -1 },
    },
    // pidID 119: Jet — +2 AP for 1500 ticks, addictChance 100%
    {
        pidID: 119, name: 'Jet',
        timedStats: { 'AP': 2 },
        duration: 1500,
        addictChance: 100,
        withdrawal: { 'END': -1 },
        specialEffect: 'jetAddict',
    },
    // pidID 164: Nuka-Cola — immediate +2 HP, no addiction
    {
        pidID: 164, name: 'Nuka-Cola',
        immediateHP: 2,
    },
    // pidID 29: Rad-Away — reduce radiation, no addiction
    {
        pidID: 29, name: 'Rad-Away',
        specialEffect: 'radaway',
    },
    // pidID 51: Antidote — reduce poison, no addiction
    {
        pidID: 51, name: 'Antidote',
        specialEffect: 'antidote',
    },
]

// Build a lookup map by pidID
const drugByPID: Map<number, DrugEffect> = new Map()
for (const d of DRUG_TABLE) {
    drugByPID.set(d.pidID, d)
}

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
 * FO2-CE ref: proto.cc drug effect application, addiction.cc addictionProcess
 */
export function useDrug(item: Obj, user: Critter): boolean {
    const pidID = item.pid & 0xFFFF
    const drug = drugByPID.get(pidID)
    if (!drug) return false

    dbg('script', `[Drug] ${user.name} used ${drug.name} (pidID=${pidID})`)

    // Immediate HP
    if (drug.immediateHP !== undefined && drug.immediateHP > 0) {
        const maxHP = user.getStat('Max HP')
        const curHP = user.getStat('HP')
        const heal = Math.min(drug.immediateHP, maxHP - curHP)
        if (heal > 0) user.stats.modifyBase('HP', heal)
    }

    // Special effects
    if (drug.specialEffect === 'radaway') {
        (user as any).radiationLevel = Math.max(0, ((user as any).radiationLevel ?? 0) - 150)
        return true
    }
    if (drug.specialEffect === 'antidote') {
        (user as any).poisonLevel = Math.max(0, ((user as any).poisonLevel ?? 0) - 50)
        return true
    }

    // Jet addict perk
    if (drug.specialEffect === 'jetAddict') {
        if (!user.perks.includes('Jet Addict')) {
            user.perks.push('Jet Addict')
        }
    }

    // Delayed HP damage (e.g. Super Stimpak)
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
                    dbg('script', `[Drug] ${drug.name} delayed effect: -${dmg} HP`)
                }
            },
        })
    }

    // Timed stat bonuses
    if (drug.timedStats && drug.duration) {
        const stats = drug.timedStats
        const duration = drug.duration

        // Apply bonuses immediately
        for (const [stat, delta] of Object.entries(stats)) {
            user.stats.modifyBase(stat, delta)
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
                dbg('script', `[Drug] ${drug.name} effect wore off`)

                // Addiction check
                const addictions: string[] = (user as any).addictions ?? []
                if (drug.addictChance && drug.addictChance > 0 && !addictions.includes(drug.name)) {
                    const chance = computeAddictChance(drug, user)
                    if (Math.random() * 100 < chance) {
                        addictions.push(drug.name)
                        ;(user as any).addictions = addictions
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
