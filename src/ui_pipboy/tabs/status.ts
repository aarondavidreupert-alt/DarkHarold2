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

// PipBoy STATUS tab — split out of ui_pipboy.ts. See
// wiki/ts-split-refactor.md → "Per-file split proposals" §12.

import globalState from '../../globalState.js'
import * as GameTime from '../../gametime.js'
import { clearScreen, makeContentArea, makeHeader, makeRow } from '../shell.js'

export function renderStatusTab(screen: HTMLDivElement): void {
    clearScreen(screen)
    const content = makeContentArea()
    screen.appendChild(content)
    const player = globalState.player!
    const hp = player.getStat('HP')
    const maxHP = player.getStat('Max HP')
    const poison = player.getStat('Poison Level') || 0
    const radiation = player.getStat('Radiation Level') || 0

    content.appendChild(makeHeader('STATUS'))
    content.appendChild(makeRow('Hit Points', `${hp} / ${maxHP}`))
    content.appendChild(makeRow('Poisoned', String(poison), poison > 0))
    content.appendChild(makeRow('Radiated', String(radiation), radiation > 0))

    const sep = document.createElement('div')
    sep.style.cssText = 'border-top: 1px solid #00AA00; margin: 8px 6px 4px 6px;'
    content.appendChild(sep)
    // Fallout-2-style clock: DAY N, HH:MM AM/PM, Mon DD, YYYY.
    content.appendChild(makeRow('Day', `${GameTime.getDay()}  ${GameTime.getTimeString()}`))
    content.appendChild(makeRow('Date', GameTime.getDateString()))
    const nightLabel = GameTime.isNightTime() ? 'NIGHT' : 'DAY'
    content.appendChild(makeRow('Cycle', nightLabel))
}
