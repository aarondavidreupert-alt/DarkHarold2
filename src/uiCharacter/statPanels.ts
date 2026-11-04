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

// The character screen's two status boxes — CE character_editor.cc
// characterEditorDrawDerivedStats. Font 101, rows lineHeight + 3 = 13 px apart:
//   upper box from y 46: "Hit Points" + value at x 263, then the 7 conditions
//   lower box from y 179: 10 derived stats, value at x 288
// Labels come from editor.msg (300-318), so they are CE's short forms
// ("Damage Res.", "Poison Res.", "Radiation Res.").
// Colours: 992 green; an inactive condition 1313 dim green.

import type { StatSet } from '../char.js'
import { CE_COLOR } from '../uiFont.js'
import { getMessage } from '../util.js'

const ROW_H = 13
const LABEL_X = 194
const HP_VALUE_X = 263
const VALUE_X = 288
const UPPER_Y = 46
const LOWER_Y = 179

// editor.msg id → fallback text, in CE drawing order.
const CONDITIONS: [number, string][] = [
    [312, 'Poisoned'],
    [313, 'Radiated'],
    [314, 'Eye Damage'],
    [315, 'Crippled Right Arm'],
    [316, 'Crippled Left Arm'],
    [317, 'Crippled Right Leg'],
    [318, 'Crippled Left Leg'],
]

// [editor.msg id, fallback, DH2 stat, value suffix] — characterEditorDrawDerivedStats order.
const DERIVED: [number, string, string, string][] = [
    [302, 'Armor Class', 'AC', ''],
    [301, 'Action Points', 'AP', ''],
    [311, 'Carry Weight', 'Carry', ''],
    [304, 'Melee Damage', 'Melee', ''],
    [305, 'Damage Res.', 'DR Normal', '%'],
    [306, 'Poison Res.', 'DR Poison', '%'],
    [307, 'Radiation Res.', 'DR Radiation', '%'],
    [308, 'Sequence', 'Sequence', ''],
    [309, 'Healing Rate', 'Healing Rate', ''],
    [310, 'Critical Chance', 'Critical Chance', '%'],
]

// Long DH2 names the info cards are keyed by (descriptions.ts).
const DERIVED_INFO_KEY: { [stat: string]: string } = {
    AC: 'Armor Class',
    AP: 'Action Points',
    Carry: 'Carry Weight',
    Melee: 'Melee Damage',
    'DR Normal': 'Damage Resistance',
    'DR Poison': 'Poison Resistance',
    'DR Radiation': 'Radiation Resistance',
    Sequence: 'Sequence',
    'Healing Rate': 'Healing Rate',
    'Critical Chance': 'Critical Chance',
}

function msg(id: number, fallback: string): string {
    return (getMessage('editor', id) ?? fallback).trim()
}

function text(parent: HTMLElement, s: string, x: number, y: number, color: string, onClick?: () => void): void {
    const el = document.createElement('div')
    el.textContent = s
    Object.assign(el.style, {
        position: 'absolute',
        left: x + 'px',
        top: y + 'px',
        color,
        whiteSpace: 'pre',
        lineHeight: ROW_H + 'px',
        cursor: onClick ? 'pointer' : 'default',
    })
    if (onClick) el.onclick = onClick
    parent.appendChild(el)
}

export interface StatPanelsInput {
    hp: number
    maxHp: number
    conditions: boolean[] // in CONDITIONS order
    stats: StatSet
    onInfo: (label: string, kind: 'condition' | 'derived') => void
}

// Draws both boxes into `layer`, an element positioned at the window's origin.
export function renderStatPanels(layer: HTMLElement, input: StatPanelsInput): void {
    while (layer.firstChild) layer.removeChild(layer.firstChild)
    let y = UPPER_Y
    text(layer, msg(300, 'Hit Points'), LABEL_X, y, CE_COLOR.green)
    text(layer, `${input.hp}/${input.maxHp}`, HP_VALUE_X, y, CE_COLOR.green)
    CONDITIONS.forEach(([id, fallback], i) => {
        y += ROW_H
        text(layer, msg(id, fallback), LABEL_X, y, input.conditions[i] ? CE_COLOR.green : CE_COLOR.dimGreen, () =>
            input.onInfo(fallback, 'condition'),
        )
    })

    y = LOWER_Y
    for (const [id, fallback, stat, suffix] of DERIVED) {
        const onClick = () => input.onInfo(DERIVED_INFO_KEY[stat], 'derived')
        text(layer, msg(id, fallback), LABEL_X, y, CE_COLOR.green, onClick)
        text(layer, `${input.stats.get(stat)}${suffix}`, VALUE_X, y, CE_COLOR.green, onClick)
        y += ROW_H
    }
}
