// Combat: the combat messages for the HUD log (CE combat.cc _combat_display and helpers).
// Methods of the Combat class, moved here verbatim and installed on its prototype by Combat.ts
// (wiki/code_quality.md Q16).

import type { Combat } from './Combat.js'
import { Config } from '../config.js'
import { Critter } from '../object.js'
import { DAM_CRITICAL, DAM_DEAD, DAM_HIT } from './results.js'
import { getLstJson } from '../data.js'
import { getMessage } from '../util.js'
import { world } from '../state/world.js'
import { uiLog } from '../messageLog.js'
import { Attack, HIT_LOCATIONS } from './Combat.js'

export const combatDisplayMethods = {
    getCombatMsg(this: Combat, id: number) {
        return getMessage('combat', id)
    },
    // CE combat.cc _combat_display — the attack's lines in the message window.
    combatDisplay(this: Combat, a: Attack): void {
        const msg = (id: number) => this.getCombatMsg(id) || ''
        const fmt = (s: string, ...args: (string | number)[]) => {
            let i = 0
            return s.replace(/%[sd]/g, () => String(args[i++] ?? ''))
        }
        const player = world.player
        const male = (c: Critter) => (c.isPlayer ? c.gender !== 'female' : (c.getStat('Gender') ?? 0) === 0)
        const attacker = a.attacker

        if (attacker.isPlayer && a.weapon && a.weapon.pid !== undefined) {
            let strengthRequired = a.weapon.pro?.extra?.minST ?? 0
            if (attacker.hasPerk('Weapon Handling')) strengthRequired -= 3
            if (strengthRequired > attacker.getStat('STR')) uiLog(msg(107))
        }

        const hit = (a.attackerFlags & DAM_HIT) !== 0
        const critical = (a.attackerFlags & DAM_CRITICAL) !== 0
        const mainCritter = hit ? a.defender : attacker
        const you = player && male(player) ? msg(506) : msg(556)
        let mainName = '.'
        let base = 600
        if (mainCritter.isPlayer) {
            mainName = you
            base = male(mainCritter) ? 500 : 550
        } else {
            mainName = mainCritter.name ?? ''
            base = male(mainCritter) ? 600 : 700
        }

        // Oops! someone else was hit instead.
        if (a.defender !== a.oops && hit) {
            const text = a.oops.isPlayer
                ? fmt(msg(base + 8), mainName)
                : fmt(msg(base + 9), mainName, a.oops.name ?? '')
            uiLog(text + '.')
        }

        if (
            (hit && !a.defender.dead && (a.defenderFlags & DAM_DEAD) === 0) ||
            (hit && (a.defenderFlags & DAM_DEAD) !== 0 && !a.defender.dead)
        ) {
            const v = a.defender
            const dmg = a.defenderDamage
            let text = ''
            if (a.hitLocation === 'torso' || a.hitLocation === 'uncalled') {
                if (critical) {
                    const id = dmg === 0 ? base + 28 : dmg === 1 ? base + 24 : base + 20
                    text = dmg <= 1 ? fmt(msg(id), mainName) : fmt(msg(id), mainName, dmg)
                } else {
                    text = this.damageAmountDescription(v, dmg)
                }
            } else {
                const locName = this.hitLocationName(v, a.hitLocation)
                if (locName) {
                    const id = critical
                        ? dmg === 0
                            ? base + 25
                            : dmg === 1
                              ? base + 21
                              : base + 11
                        : dmg === 0
                          ? base + 26
                          : dmg === 1
                            ? base + 22
                            : base + 12
                    text = dmg <= 1 ? fmt(msg(id), mainName, locName) : fmt(msg(id), mainName, locName, dmg)
                }
            }
            if (Config.ui.combatMessages !== 'brief' && critical && a.criticalMessageId !== -1) {
                text += msg(a.criticalMessageId)
                if ((a.defenderFlags & DAM_DEAD) !== 0) {
                    uiLog(text + '.')
                    const killed = v.isPlayer ? (male(v) ? 207 : 257) : male(v) ? 307 : 407
                    text = `${mainName} ${msg(killed)}`
                }
            } else {
                text += this.damageFlagsDescription(a.defenderFlags, v)
            }
            uiLog(text + '.')
        }

        if (!attacker.dead) {
            if (!hit) {
                let text: string
                if (critical) {
                    const d = a.attackerDamage
                    const id = d === 0 ? base + 14 : d === 1 ? base + 33 : base + 34
                    text = d <= 1 ? fmt(msg(id), mainName) : fmt(msg(id), mainName, d)
                } else {
                    text = fmt(msg(base + 15), mainName)
                }
                text += this.damageFlagsDescription(a.attackerFlags, attacker)
                uiLog(text + '.')
            }
            if ((hit || !critical) && a.attackerDamage > 0) {
                uiLog(
                    this.damageAmountDescription(attacker, a.attackerDamage) +
                        this.damageFlagsDescription(a.attackerFlags, attacker) +
                        '.',
                )
            }
        }

        for (const x of a.extras) {
            if (x.critter.dead) continue
            uiLog(
                this.damageAmountDescription(x.critter, x.damage) +
                    this.damageFlagsDescription(x.flags, x.critter) +
                    '.',
            )
        }
    },
    // CE combat.cc combatCopyDamageAmountDescription
    damageAmountDescription(this: Combat, c: Critter, damage: number): string {
        const msg = (id: number) => this.getCombatMsg(id) || ''
        const male = c.isPlayer ? c.gender !== 'female' : (c.getStat('Gender') ?? 0) === 0
        let id = c.isPlayer ? (male ? 500 : 550) : male ? 600 : 700
        const name = c.isPlayer ? msg(id + 6) : (c.name ?? '')
        id += damage === 0 ? 27 : damage === 1 ? 23 : 13
        const text = msg(id)
        let i = 0
        const args: (string | number)[] = damage <= 1 ? [name] : [name, damage]
        return text.replace(/%[sd]/g, () => String(args[i++] ?? ''))
    },
    // CE combat.cc combatAddDamageFlagsDescription — ", knocked down and blinded".
    damageFlagsDescription(this: Combat, flags: number, c: Critter): string {
        if (flags === 0) return ''
        const msg = (id: number) => this.getCombatMsg(id) || ''
        const male = c.isPlayer ? c.gender !== 'female' : (c.getStat('Gender') ?? 0) === 0
        const num = c.isPlayer ? (male ? 200 : 250) : male ? 300 : 400
        if ((flags & DAM_DEAD) !== 0) return msg(108) + msg(num + 7)
        const bits: number[] = []
        for (let i = 0; i < 32; i++) {
            const bit = (1 << i) >>> 0
            if (bit !== DAM_CRITICAL && bit !== DAM_HIT && (flags & bit) !== 0) bits.push(i)
        }
        if (bits.length === 0) return ''
        let text = ''
        for (let i = 0; i < bits.length - 1; i++) text += ', ' + msg(num + bits[i])
        return text + msg(108) + msg(num + bits[bits.length - 1])
    },
    // CE combat.cc hitLocationGetName — combat.msg 1000 + 10 × art alias + location.
    hitLocationName(this: Combat, c: Critter, region: string): string | null {
        const loc = HIT_LOCATIONS.indexOf(region)
        if (loc < 0) return null
        const entry = getLstJson('art/critters/critters', (c.frmPID ?? 0) & 0xfff)
        const alias = typeof entry?.walk === 'number' ? entry.walk : 0
        return this.getCombatMsg(1000 + 10 * alias + loc) || null
    },
}
