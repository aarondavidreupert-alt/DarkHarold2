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

// PipBoy ARCHIVES tab — split out of ui_pipboy.ts. See
// wiki/ts-split-refactor.md → "Per-file split proposals" §12.

import { Config } from '../../config.js'
import { getActiveQuests, getUnknownActiveGvars } from '../../questLog.js'
import {
    CONTENT_H,
    TEXT_STYLE,
    clearScreen,
    makeContentArea,
    makeHeader,
} from '../shell.js'

// --- ARCHIVES tab: Quest log / journal

export function renderArchivesTab(screen: HTMLDivElement): void {
    clearScreen(screen)
    const content = makeContentArea()
    screen.appendChild(content)

    content.appendChild(makeHeader('QUEST LOG'))

    const quests = getActiveQuests()

    const list = document.createElement('div')
    list.style.cssText = TEXT_STYLE + 'font-size: 11px; padding: 2px 8px; overflow-y: auto;'
    list.style.maxHeight = `${CONTENT_H - 50}px`

    if (quests.length === 0) {
        const empty = document.createElement('div')
        empty.style.cssText = 'padding: 6px 0;'
        empty.textContent = '(no quests in progress)'
        list.appendChild(empty)
    } else {
        // Group quests by location, preserving definition order
        const grouped = new Map<string, typeof quests>()
        for (const q of quests) {
            let arr = grouped.get(q.location)
            if (!arr) { arr = []; grouped.set(q.location, arr) }
            arr.push(q)
        }

        for (const [location, locationQuests] of grouped) {
            // Location header
            const header = document.createElement('div')
            header.style.cssText = 'color: #00FF00; font-size: 13px; font-weight: bold; padding: 6px 0 2px 0; border-bottom: 1px solid #005500;'
            header.textContent = location.toUpperCase()
            list.appendChild(header)

            for (const q of locationQuests) {
                const row = document.createElement('div')
                row.style.cssText = `padding: 2px 0 2px 12px; border-bottom: 1px solid #003300; ` +
                    (q.isCompleted
                        ? 'color: #007700; text-decoration: line-through;'
                        : 'color: #00FF00;')
                row.textContent = q.description
                list.appendChild(row)
            }
        }
    }
    content.appendChild(list)

    // Debug: show non-zero GVARs that don't map to any known quest
    if (Config.scripting.debugLogShowType.gvars) {
        const unknown = getUnknownActiveGvars()
        if (unknown.length > 0) {
            const sep = document.createElement('div')
            sep.style.cssText = 'border-top: 1px solid #00AA00; margin: 8px 0 4px 0;'
            list.appendChild(sep)

            const debugHeader = document.createElement('div')
            debugHeader.style.cssText = 'color: #AAAA00; font-size: 11px; padding: 2px 0;'
            debugHeader.textContent = 'DEBUG: Unknown active GVARs'
            list.appendChild(debugHeader)

            for (const g of unknown) {
                const row = document.createElement('div')
                row.style.cssText = 'color: #888800; font-size: 10px; padding: 1px 0 1px 12px;'
                row.textContent = `GVAR ${g.index}: ${g.value}`
                list.appendChild(row)
            }
        }
    }
}
