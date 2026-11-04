/*
Copyright 2014 darkf

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

// CE character_editor.cc characterPrintToFile: the PRINT button's character sheet, the same
// text CE writes (editor.msg 620-657), handed to the browser as a .TXT download.

import { world } from '../state/world.js'
import * as GameTime from '../gametime.js'
import { getMessage } from '../util.js'
import { SKILL_NAMES } from '../skills.js'
import { killCounts } from '../critter.js'
import { perkNameById, PERK_COUNT } from '../perks/cePerks.js'
import { getPerkRank } from '../perks.js'
import { karmaFolder } from './folders.js'

const msg = (id: number) => getMessage('editor', id) ?? ''
const spaces = (n: number) => ' '.repeat(Math.max(0, n))
const dots = (n: number) => '.'.repeat(Math.max(0, n))
const pad = (v: number, width: number) => String(Math.trunc(v)).padStart(width, '0') // %.Nd (no sign handling needed)

// CE _itostndn: thousands separators
function thousands(value: number): string {
    return value === 0 ? '0' : Math.trunc(value).toLocaleString('en-US')
}

const centered = (text: string) => spaces(Math.trunc((80 - text.length) / 2) - 2) + text

export function characterSheetText(dude: any = world.player): string {
    const p = dude
    const stat = (s: string) => p.getStat(s)
    // CE critterGetStat: AC and the resistances include the worn armor
    const ac = () => stat('AC') + p.getArmorAC()
    const dr = (type: string) => Math.min(100, stat('DR ' + type) + p.getArmorDR(type))
    const out: string[] = ['', '']
    out.push(centered(msg(620)))
    out.push(centered(msg(621)))
    const date = GameTime.getDate()
    out.push(
        centered(
            `${pad(date.day, 2)} ${msg(500 + date.month)} ${date.year}  ${pad(GameTime.getHourMilitary(), 4)} ${msg(622)}`,
        ),
    )
    out.push('')

    let line = `${msg(642)} ${p.name ?? ''}`
    line += spaces(27 - line.length)
    const gender = p.gender === 'female' ? 1 : 0
    out.push(`${line}${msg(643)} ${stat('Age')}${msg(644)} ${msg(645 + gender)}`)
    const xp = thousands(stat('Experience'))
    const level = stat('Level')
    const nextXP = Math.floor(((level + 1) * level) / 2) * 1000
    out.push(`${msg(647)} ${pad(level, 2)} ${msg(648)} ${xp} ${spaces(12 - xp.length)}${msg(649)} ${thousands(nextXP)}`)
    out.push('')
    out.push('')

    // (CE prints ST instead of Sequence on the first line — its FIXME — kept)
    out.push(
        `${msg(624)} ${pad(stat('STR'), 2)} ${msg(625)} ${pad(stat('HP'), 3)}/${pad(stat('Max HP'), 3)} ${msg(626)} ${pad(stat('STR'), 2)}`,
    )
    out.push(
        `${msg(627)} ${pad(stat('PER'), 2)} ${msg(628)} ${pad(ac(), 3)} ${msg(629)} ${pad(stat('Healing Rate'), 2)}`,
    )
    out.push(
        `${msg(630)} ${pad(stat('END'), 2)} ${msg(631)} ${pad(stat('AP'), 2)} ${msg(632)} ${pad(stat('Critical Chance'), 3)}%`,
    )
    out.push(
        `${msg(633)} ${pad(stat('CHA'), 2)} ${msg(634)} ${pad(stat('Melee'), 2)} ${msg(635)} ${pad(stat('Carry'), 3)} lbs.`,
    )
    out.push(`${msg(636)} ${pad(stat('INT'), 2)} ${msg(637)} ${pad(dr('Normal'), 3)}%`)
    out.push(`${msg(638)} ${pad(stat('AGI'), 2)} ${msg(639)} ${pad(dr('Radiation'), 3)}%`)
    out.push(`${msg(640)} ${pad(stat('LUK'), 2)} ${msg(641)} ${pad(dr('Poison'), 3)}%`)
    out.push('')
    out.push('')

    const traits: string[] = p.traits ?? []
    if (traits.length > 0) {
        out.push(msg(650))
        for (const t of traits) out.push(`  ${t}`)
    }
    const perks: string[] = []
    for (let id = 0; id < PERK_COUNT; id++) {
        const name = perkNameById(id)
        const rank = name ? getPerkRank(p, name) : 0
        if (rank !== 0) perks.push(rank === 1 ? `  ${name}` : `  ${name} (${rank})`)
    }
    if (perks.length > 0) {
        out.push(msg(651))
        out.push(...perks)
    }
    out.push('')

    // Karma, then (with their own headings, 657 / 656 in the sheet) town reputations and addictions
    out.push(msg(652))
    const townHeading = msg(4000),
        addictionHeading = msg(4001)
    for (const l of karmaFolder().lines) {
        if (l.kind === 'heading') {
            out.push('')
            out.push(l.text === townHeading ? msg(657) : l.text === addictionHeading ? msg(656) : l.text)
        } else {
            out.push(`  ${l.text}`)
        }
    }
    out.push('')

    // Skills, with the kill types beside them (one kind of kill per skill line)
    out.push(msg(653))
    let killType = 0
    for (let skill = 0; skill < SKILL_NAMES.length; skill++) {
        let left = `${getMessage('skill', 100 + skill) ?? SKILL_NAMES[skill]} `
        left += dots(16 - left.length)
        const value = pad(p.getSkill(SKILL_NAMES[skill]), 3)
        let row = `  ${left} ${value}%`
        for (; killType < 19; killType++) {
            const count = killCounts.get(killType) ?? 0
            if (count > 0) {
                let right = `${getMessage('proto', 1450 + killType) ?? ''} `
                right += dots(16 - right.length)
                row += `        ${right} ${pad(count, 3)}`
                killType++
                break
            }
        }
        // (CE builds each row but never writes it — a porting slip; the original prints them)
        out.push(row)
    }
    out.push('')
    out.push('')

    out.push(msg(654))
    const items = [p.leftHand, p.rightHand, p.armor]
        .filter((it: any) => it && it.pid !== undefined)
        .concat(p.inventory ?? [])
    for (let i = 0; i < items.length; i += 3) {
        let row = ''
        for (const it of items.slice(i, i + 3)) {
            const cell = `  ${thousands(it.amount ?? 1)}x ${it.getName?.() ?? it.name ?? ''}`
            row += cell + spaces(25 - cell.length)
        }
        out.push(row)
    }
    out.push('')
    out.push(`${msg(655)} ${p.getInventoryWeight()} lbs.`)
    out.push('')
    return out.join('\n')
}

/** PRINT: the sheet as "<name>.TXT" (CE asks for the file name; the browser saves it) */
export function printCharacterSheet(dude: any = world.player): void {
    const text = characterSheetText(dude)
    const name = String(dude?.name ?? 'CHARACTER').replace(/[^A-Za-z0-9_-]/g, '') || 'CHARACTER'
    const url = URL.createObjectURL(new Blob([text.replace(/\n/g, '\r\n')], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name.toUpperCase() + '.TXT'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}
