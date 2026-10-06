// Drugs, addiction and withdrawal — port of fallout2-ce item.cc:
//   _item_d_take_drug()        (item.cc:2776) — use a drug item
//   _perform_drug_effect()     (item.cc:2639) — apply a stat delta triple
//   _insert_drug_effect()      (item.cc:2598) — queue a delayed delta triple
//   _drug_effect_allowed()     (item.cc:2721) — per-drug stacking limit
//   drugEffectEventProcess()   (item.cc:2864)
//   _insert_withdrawal() / _item_wd_clear_all() / withdrawalEventProcess()
//   performWithdrawalStart() / performWithdrawalEnd()  (item.cc:2917-3104)
//   dudeSetAddiction() / dudeClearAddiction() / dudeIsAddicted()  (item.cc:3106-3150)
// Effects are driven entirely by the drug's proto data (tools/proto.py readItem
// SUBTYPE_DRUG: stat0-2, amount0-2, firstDelayed/secondDelayed, addictionRate,
// addictionEffect (= withdrawal perk), addictionOnset).
// Replaces the earlier hand-written DRUG_TABLE, whose numbers did not match
// the protos (e.g. Psycho is AGI+3/INT-3/DR+50, not "+25 DR for 3 h").
//
// Copyright 2014-2022 darkf (Apache 2.0)

import globalState from './globalState.js'
import { dbg } from './logger.js'
import { Critter, Obj } from './object.js'
import { Scripting } from './scripting.js'
import { uiLog, updateIndicatorBar } from './ui_hud.js'
import { Events } from './events.js'
import { critterKill } from './critter/lifecycle.js'
import { critterAdjustRadiation } from './radiation.js'
import { STAT_CURRENT_HIT_POINTS, STAT_CURRENT_POISON_LEVEL, STAT_CURRENT_RADIATION_LEVEL, STAT_NAME_BY_ID } from './statIds.js'
import { getMessage, getRandomInt } from './util.js'

const PROTO_ID_JET = 259
const PROTO_ID_JET_ANTIDOTE = 260
const PERK_JET_ADDICTION = 70
const PERK_FLOWER_CHILD_NAME = 'Flower Child'
const BODY_TYPE_ROBOTIC = 2

// CE item.cc:144 gDrugDescriptions — { drugPid, gvar, max concurrent doses (0 = unlimited) }
const DRUG_DESCRIPTIONS: { pid: number; gvar: number; maxDoses: number }[] = [
    { pid: 106, gvar: 21, maxDoses: 0 },  // Nuka-Cola       GVAR_NUKA_COLA_ADDICT
    { pid: 87, gvar: 22, maxDoses: 4 },   // Buffout         GVAR_BUFF_OUT_ADDICT
    { pid: 53, gvar: 23, maxDoses: 4 },   // Mentats         GVAR_MENTATS_ADDICT
    { pid: 110, gvar: 24, maxDoses: 4 },  // Psycho          GVAR_PSYCHO_ADDICT
    { pid: 48, gvar: 25, maxDoses: 0 },   // Rad-Away        GVAR_RADAWAY_ADDICT
    { pid: 124, gvar: 26, maxDoses: 0 },  // Beer            GVAR_ALCOHOL_ADDICT
    { pid: 125, gvar: 26, maxDoses: 0 },  // Booze           GVAR_ALCOHOL_ADDICT
    { pid: PROTO_ID_JET, gvar: 296, maxDoses: 4 }, // Jet     GVAR_ADDICT_JET
    { pid: 304, gvar: 295, maxDoses: 0 }, // Tragic cards    GVAR_ADDICT_TRAGIC
]

// CE perk.cc gPerkDescriptions for the withdrawal perks: { stat, statModifier, primary-stat deltas[7] }.
const WITHDRAWAL_PERKS: { [perk: number]: { stat: number; mod: number; special: number[] } } = {
    53: { stat: -1, mod: 0, special: [0, 0, 0, 0, 0, 0, 0] },     // Nuka-Cola
    54: { stat: -1, mod: 0, special: [-2, 0, -2, 0, 0, -3, 0] },  // Buffout
    55: { stat: -1, mod: 0, special: [0, 0, 0, 0, -3, -2, 0] },   // Mentats
    56: { stat: -1, mod: 0, special: [0, 0, 0, 0, -2, 0, 0] },    // Psycho
    57: { stat: 31, mod: -20, special: [0, 0, 0, 0, 0, 0, 0] },   // Rad-Away (DR Radiation -20)
    70: { stat: 8, mod: -1, special: [-1, -1, 0, 0, 0, 0, 0] },   // Jet (AP -1)
    71: { stat: -1, mod: 0, special: [0, -2, 0, 0, -1, 0, -1] },  // Tragic cards
}

const DRUG_TAG = 'drug:'             // `drug:<pid>:<s0>,<s1>,<s2>:<m0>,<m1>,<m2>`
const WITHDRAWAL_TAG = 'withdrawal:' // `withdrawal:<start 1|0>:<pid>:<perk>`

function itemMsg(id: number): string | null {
    return getMessage('item', id)
}

function isDude(c: Critter): boolean {
    return c === globalState.player
}

function hasTrait(c: Critter, name: string): boolean {
    return isDude(c) && ((c as any).traits ?? []).includes(name)
}

function gvarForPid(pid: number): number {
    return DRUG_DESCRIPTIONS.find((d) => d.pid === pid)?.gvar ?? -1
}

// CE item.cc:3142 dudeIsAddicted — NOTE the CE loop returns on the first
// matching entry, so dudeIsAddicted(-1) only ever looks at the Nuka-Cola GVAR.
// Reproduced as-is (it decides when the ADDICT indicator clears).
function dudeIsAddicted(pid: number): boolean {
    for (const d of DRUG_DESCRIPTIONS) {
        if (pid === -1 || pid === d.pid) return Scripting.getGlobalVar(d.gvar) !== 0
    }
    return false
}

function setAddictedState(on: boolean): void {
    const p = globalState.player as Critter | null
    if (!p) return
    p.addictedState = on
    updateIndicatorBar()
}

// CE item.cc:3106 dudeSetAddiction
function dudeSetAddiction(pid: number): void {
    const gvar = gvarForPid(pid)
    if (gvar !== -1) Scripting.setGlobalVar(gvar, 1)
    setAddictedState(true)
}

// CE item.cc:3119 dudeClearAddiction
function dudeClearAddiction(pid: number): void {
    const gvar = gvarForPid(pid)
    if (gvar !== -1) Scripting.setGlobalVar(gvar, 0)
    if (!dudeIsAddicted(-1)) setAddictedState(false)
}

// critterSetBonusStat() for the stats a drug can touch. DH2 keeps no separate
// bonus layer, so the delta lands on the base value (reversible by the later events).
function adjustStat(critter: Critter, stat: number, delta: number): void {
    if (delta === 0) return
    if (stat === STAT_CURRENT_HIT_POINTS) {
        const max = critter.getStat('Max HP')
        const hp = critter.getStat('HP')
        critter.stats.setBase('HP', Math.max(0, Math.min(max, hp + delta)))
    } else if (stat === STAT_CURRENT_POISON_LEVEL) {
        Scripting.adjustPoison(critter, delta)
    } else if (stat === STAT_CURRENT_RADIATION_LEVEL) {
        critterAdjustRadiation(critter, delta)
    } else {
        const name = STAT_NAME_BY_ID[stat]
        if (name) critter.stats.modifyBase(name, delta)
    }
}

function statValue(critter: Critter, stat: number): number {
    if (stat === STAT_CURRENT_HIT_POINTS) return critter.getStat('HP')
    if (stat === STAT_CURRENT_POISON_LEVEL) return critter.poisonLevel ?? 0
    if (stat === STAT_CURRENT_RADIATION_LEVEL) return critter.radiationLevel ?? 0
    const name = STAT_NAME_BY_ID[stat]
    return name ? critter.getStat(name) : 0
}

// CE item.cc:2639 _perform_drug_effect
function performDrugEffect(critter: Critter, stats: number[], mods: number[], isImmediate: boolean): void {
    let statsChanged = false
    let start = 0
    let firstStatIsMinimum = false
    if (stats[0] === -2) { // stat0 == -2: amount0..amount1 is a random range for stat1
        start = 1
        firstStatIsMinimum = true
    }

    for (let i = start; i < 3; i++) {
        const stat = stats[i]
        if (stat === -1) continue

        const before = isDude(critter) ? statValue(critter, stat) : 0
        let delta: number
        if (firstStatIsMinimum) {
            delta = getRandomInt(mods[i - 1], mods[i])
            firstStatIsMinimum = false
        } else {
            delta = mods[i]
        }

        if (stat === STAT_CURRENT_HIT_POINTS && !isDude(critter) && critter.getStat('HP') + delta <= 0) {
            const fmt = itemMsg(600) ?? '%s succumbs to the adverse effects of chems.'
            uiLog(fmt.replace('%s', critter.name ?? ''))
        }

        adjustStat(critter, stat, delta)

        if (isDude(critter)) {
            const after = statValue(critter, stat)
            if (after !== before) {
                // 1 "You gained %d %s." / 2 "You lost %d %s."
                const fmt = itemMsg(after < before ? 2 : 1)
                const statName = getMessage('stat', 100 + stat) ?? STAT_NAME_BY_ID[stat] ?? ''
                if (fmt) uiLog(fmt.replace('%d', String(Math.abs(after - before))).replace('%s', statName))
                statsChanged = true
            }
        }
    }

    if (critter.getStat('HP') > 0) {
        if (isDude(critter) && !statsChanged && isImmediate) {
            const msg = itemMsg(10) // "Nothing happens."
            if (msg) uiLog(msg)
        }
    } else if (!critter.dead) {
        // CE kills via the HP adjustment; item.msg 4 (dude) is fetched but never shown.
        critterKill(critter)
    }
    if (isDude(critter)) Events.emit('statsChanged')
}

function queuedDrugDoses(critter: Critter, pid: number): number {
    let n = 0
    for (const e of Scripting.timeEventList) {
        if (e.obj !== critter || typeof e.userdata !== 'string' || !e.userdata.startsWith(DRUG_TAG)) continue
        if (Number(e.userdata.split(':')[1]) === pid) n++
    }
    return n
}

// CE item.cc:2721 _drug_effect_allowed
function drugEffectAllowed(critter: Critter, pid: number): boolean {
    const d = DRUG_DESCRIPTIONS.find((x) => x.pid === pid)
    if (!d || d.maxDoses === 0) return true
    return queuedDrugDoses(critter, pid) < d.maxDoses
}

function scheduleDrugEvent(critter: Critter, ticks: number, pid: number, stats: number[], mods: number[]): void {
    const userdata = `${DRUG_TAG}${pid}:${stats.join(',')}:${mods.join(',')}`
    Scripting.timeEventList.push({ obj: critter, ticks, userdata, fn: () => drugEffectEventProcess(critter, stats, mods) })
}

// CE item.cc:2598 _insert_drug_effect — duration in game minutes.
function insertDrugEffect(critter: Critter, pid: number, duration: number, stats: number[], mods: number[]): void {
    if (mods.every((m) => m === 0)) return
    let delay = 600 * duration
    if (hasTrait(critter, 'Chem Resistant')) delay = Math.trunc(delay / 2)
    scheduleDrugEvent(critter, delay, pid, stats, mods)
}

// CE item.cc:2864 drugEffectEventProcess
function drugEffectEventProcess(critter: Critter, stats: number[], mods: number[]): void {
    if (!critter || critter.type !== 'critter') return
    performDrugEffect(critter, stats, mods, false)
}

function scheduleWithdrawal(critter: Critter, ticks: number, isStart: boolean, pid: number, perk: number): void {
    const userdata = `${WITHDRAWAL_TAG}${isStart ? 1 : 0}:${pid}:${perk}`
    Scripting.timeEventList.push({ obj: critter, ticks, userdata, fn: () => withdrawalEventProcess(critter, isStart, pid, perk) })
}

// CE item.cc:2917 _insert_withdrawal — duration in game minutes.
function insertWithdrawal(critter: Critter, isStart: boolean, duration: number, perk: number, pid: number): void {
    scheduleWithdrawal(critter, 600 * duration, isStart, pid, perk)
}

// CE perk.cc:554 perkAddEffect / :594 perkRemoveEffect for the withdrawal perks.
function applyWithdrawalPerk(critter: Critter, perk: number, sign: 1 | -1): void {
    const def = WITHDRAWAL_PERKS[perk]
    if (!def) return
    if (def.stat !== -1) adjustStat(critter, def.stat, sign * def.mod)
    for (let s = 0; s < 7; s++) adjustStat(critter, s, sign * def.special[s])
}

// CE item.cc:3039 performWithdrawalStart
function performWithdrawalStart(critter: Critter, perk: number, pid: number): void {
    applyWithdrawalPerk(critter, perk, 1)
    if (isDude(critter)) {
        const desc = getMessage('perk', 1101 + perk)
        if (desc) uiLog(desc)
    }
    let duration = 10080 // one week, in minutes
    if (isDude(critter)) {
        if (hasTrait(critter, 'Chem Reliant')) duration = Math.trunc(duration / 2)
        if (critter.hasPerk?.(PERK_FLOWER_CHILD_NAME)) duration = Math.trunc(duration / 2)
    }
    insertWithdrawal(critter, false, duration, perk, pid)
}

// CE item.cc:3072 performWithdrawalEnd
function performWithdrawalEnd(critter: Critter, perk: number): void {
    applyWithdrawalPerk(critter, perk, -1)
    if (isDude(critter)) {
        const msg = itemMsg(3) // "You feel better."
        if (msg) uiLog(msg)
    }
}

// CE item.cc:2977 withdrawalEventProcess
function withdrawalEventProcess(critter: Critter, isStart: boolean, pid: number, perk: number): void {
    if (isStart) {
        performWithdrawalStart(critter, perk, pid)
        return
    }
    if (perk === PERK_JET_ADDICTION) return // Jet withdrawal only ends with the antidote
    performWithdrawalEnd(critter, perk)
    if (isDude(critter)) dudeClearAddiction(pid)
}

// CE item.cc:2953 _item_wd_clear_all — taking the drug again ends an active
// withdrawal for that addiction GVAR and restarts the onset timer (first match only).
// Pending events are neutralised in place (this may run from inside the gameTick
// timed-event loop, which splices by index).
function resetWithdrawal(critter: Critter, gvar: number, onset: number): void {
    for (const e of Scripting.timeEventList) {
        if (e.obj !== critter || e.ticks <= 0) continue
        const ev = parseWithdrawal(e.userdata)
        if (!ev || gvarForPid(ev.pid) !== gvar) continue
        if (!ev.isStart) performWithdrawalEnd(critter, ev.perk)
        e.userdata = 'withdrawal-cancelled'
        e.fn = () => {}
        e.ticks = 1
        insertWithdrawal(critter, true, onset, ev.perk, ev.pid)
        return
    }
}

function parseWithdrawal(userdata: any): { isStart: boolean; pid: number; perk: number } | null {
    if (typeof userdata !== 'string' || !userdata.startsWith(WITHDRAWAL_TAG)) return null
    const [start, pid, perk] = userdata.slice(WITHDRAWAL_TAG.length).split(':').map(Number)
    return { isStart: start === 1, pid, perk }
}

/**
 * CE item.cc:2776 _item_d_take_drug. Returns true when the item is consumed.
 */
export function useDrug(item: Obj, user: Critter): boolean {
    if (!user || user.dead) return false
    if ((user.pro?.extra?.bodyType ?? 0) === BODY_TYPE_ROBOTIC) return false

    const drug = item.pro?.extra
    if (!drug || drug.stat0 === undefined) return false
    const stats = [drug.stat0, drug.stat1, drug.stat2]

    if (item.pid === PROTO_ID_JET_ANTIDOTE && dudeIsAddicted(PROTO_ID_JET)) {
        performWithdrawalEnd(user, PERK_JET_ADDICTION)
        // drop the open-ended Jet withdrawal event
        for (const e of Scripting.timeEventList) {
            const ev = e.obj === user ? parseWithdrawal(e.userdata) : null
            if (ev && ev.perk === PERK_JET_ADDICTION) { e.userdata = 'withdrawal-cancelled'; e.fn = () => {}; e.ticks = 1 }
        }
        if (isDude(user)) dudeClearAddiction(PROTO_ID_JET)
        return true // SFALL fix kept by CE: the antidote is consumed
    }

    dbg('script', `[Drug] ${user.name} used ${item.name} (pid=${item.pid})`)

    resetWithdrawal(user, gvarForPid(item.pid), drug.addictionOnset ?? 0)

    if (drugEffectAllowed(user, item.pid)) {
        performDrugEffect(user, stats, [drug.amount0, drug.amount1, drug.amount2], true)
        const d1 = drug.firstDelayed ?? { duration: 0, amount0: 0, amount1: 0, amount2: 0 }
        const d2 = drug.secondDelayed ?? { duration: 0, amount0: 0, amount1: 0, amount2: 0 }
        insertDrugEffect(user, item.pid, d1.duration, stats, [d1.amount0, d1.amount1, d1.amount2])
        insertDrugEffect(user, item.pid, d2.duration, stats, [d2.amount0, d2.amount1, d2.amount2])
    } else if (isDude(user)) {
        const msg = itemMsg(50) // "That didn't seem to do that much."
        if (msg) uiLog(msg)
    }

    if (!dudeIsAddicted(item.pid)) {
        let chance = drug.addictionRate ?? 0
        if (isDude(user)) {
            if (hasTrait(user, 'Chem Reliant')) chance *= 2
            if (hasTrait(user, 'Chem Resistant')) chance = Math.trunc(chance / 2)
            if (user.hasPerk?.(PERK_FLOWER_CHILD_NAME)) chance = Math.trunc(chance / 2)
        }
        if (getRandomInt(1, 100) <= chance) {
            insertWithdrawal(user, true, drug.addictionOnset ?? 0, drug.addictionEffect ?? -1, item.pid)
            if (isDude(user)) dudeSetAddiction(item.pid)
        }
    }

    return true
}

// Re-arm a drug / withdrawal event read from a save (saveload.ts). Returns
// false if `userdata` isn't one of ours.
export function restoreDrugEvent(critter: Critter, ticks: number, userdata: any): boolean {
    if (typeof userdata !== 'string') return false
    if (userdata.startsWith(DRUG_TAG)) {
        const [, pid, s, m] = userdata.split(':')
        const stats = s.split(',').map(Number)
        const mods = m.split(',').map(Number)
        if (stats.length !== 3 || mods.length !== 3) return false
        scheduleDrugEvent(critter, ticks, Number(pid), stats, mods)
        return true
    }
    const ev = parseWithdrawal(userdata)
    if (!ev) return false
    scheduleWithdrawal(critter, ticks, ev.isStart, ev.pid, ev.perk)
    return true
}

// CE character_editor.cc:540 gAddictionReputationVars — order of the karma-panel list
// (editor.msg 1004 + index).
export const ADDICTION_KARMA_GVARS = [21, 22, 23, 24, 25, 26, 296, 295]
