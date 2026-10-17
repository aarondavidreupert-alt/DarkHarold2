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

// PipBoy STATUS tab — CE pipboy.cc pipboyWindowHandleStatus: the quest locations
// (STATUS, pipboy.msg 202) on the left, the known holodisks (DATA, 211) on the right.
// A location opens its quests (pipboyWindowHandleStatus, completed ones struck through);
// a holodisk opens its text (pipboyRenderHolodiskText, 35 lines a page).

import { Config } from '../../config.js'
import globalState from '../../globalState.js'
import { Scripting } from '../../scripting.js'
import { getMessage } from '../../util.js'
import { getActiveQuests, getUnknownActiveGvars } from '../../questLog.js'
import { getHolodiskDefs, type HolodiskDef } from '../../questData.js'
import { CONTENT_H, CONTENT_W, TEXT_STYLE, clearScreen, makeContentArea } from '../shell.js'

const GREEN = '#00FF00'      // _colorTable[992]
const HIGHLIGHT = '#FFFF5A'  // _colorTable[32747]
const DONE = '#42982A'       // _colorTable[8804]
const LINE_H = 12
const PIPBOY_HOLODISK_LINES_MAX = 35

const msg = (id: number, fallback: string) => getMessage('pipboy', id) ?? fallback
const click = () => globalState.audioEngine?.playSfxByName?.('ib1p1xx1')

// Page Up / Page Down in the holodisk reader (CE 1026 / 1027)
let pageKeys: ((e: KeyboardEvent) => void) | null = null
function setPageKeys(fn: ((e: KeyboardEvent) => void) | null): void {
    if (pageKeys) window.removeEventListener('keydown', pageKeys, true)
    pageKeys = fn
    if (fn) window.addEventListener('keydown', fn, true)
}

function textLine(text: string, opts: { color?: string; underline?: boolean; strike?: boolean; align?: string; onClick?: () => void } = {}): HTMLDivElement {
    const el = document.createElement('div')
    el.style.cssText = TEXT_STYLE + `font-size: 11px; line-height: ${LINE_H}px; min-height: ${LINE_H}px; white-space: pre-wrap;` +
        `color: ${opts.color ?? GREEN}; text-align: ${opts.align ?? 'left'};` +
        (opts.underline ? 'text-decoration: underline;' : '') + (opts.strike ? 'text-decoration: line-through;' : '')
    el.textContent = text
    if (opts.onClick) {
        el.style.cursor = 'pointer'
        el.onmouseenter = () => { el.style.color = HIGHLIGHT }
        el.onmouseleave = () => { el.style.color = opts.color ?? GREEN }
        el.onclick = opts.onClick
    }
    return el
}

function knownHolodisks(): HolodiskDef[] {
    return getHolodiskDefs().filter((h) => Number(Scripting.getGlobalVar(h.gvar)) !== 0)
}

// Locations with at least one shown quest, in quests.txt order (sorted by location)
function questLocations(): { locationId: number; name: string }[] {
    const out: { locationId: number; name: string }[] = []
    for (const q of getActiveQuests()) {
        if (out.length === 0 || out[out.length - 1].locationId !== q.locationId) out.push({ locationId: q.locationId, name: q.location })
    }
    return out
}

export function renderStatusTab(screen: HTMLDivElement): void {
    setPageKeys(null)
    clearScreen(screen)
    const content = makeContentArea()
    content.style.overflowY = 'hidden'
    screen.appendChild(content)

    const disks = knownHolodisks()
    const locations = questLocations()

    const cols = document.createElement('div')
    cols.style.cssText = 'display: flex; padding: 0 4px;'
    const left = document.createElement('div')
    left.style.cssText = `width: ${disks.length ? Math.floor(CONTENT_W / 2) : CONTENT_W - 8}px;`
    const right = document.createElement('div')
    right.style.cssText = `width: ${Math.floor(CONTENT_W / 2) - 8}px;`
    cols.append(left, right)
    content.appendChild(cols)

    left.appendChild(textLine(msg(202, 'STATUS'), { underline: true, align: 'center' }))
    left.appendChild(textLine(''))
    if (locations.length === 0) left.appendChild(textLine(msg(203, 'No quests')))
    for (const loc of locations) {
        left.appendChild(textLine(loc.name, { onClick: () => { click(); renderQuestList(screen, loc.locationId) } }))
        left.appendChild(textLine(''))
    }

    if (disks.length) {
        right.appendChild(textLine(msg(211, 'DATA'), { underline: true, align: 'center' }))
        right.appendChild(textLine(''))
        for (const disk of disks) {
            right.appendChild(textLine(msg(disk.name, `Holodisk ${disk.gvar}`), { onClick: () => { click(); renderHolodisk(screen, disk, 0) } }))
            right.appendChild(textLine(''))
        }
    }

    // Debug: non-zero GVARs that don't belong to any quest
    if (Config.scripting.debugLogShowType.gvars) {
        const unknown = getUnknownActiveGvars()
        if (unknown.length) {
            const dbgBox = document.createElement('div')
            dbgBox.style.cssText = 'padding: 6px 4px; color: #888800; font-size: 10px; font-family: monospace;'
            dbgBox.textContent = 'DEBUG GVARs: ' + unknown.map((g) => `${g.index}=${g.value}`).join(' ')
            content.appendChild(dbgBox)
        }
    }
}

function backButton(screen: HTMLDivElement, label: string, onClick: () => void, align = 'left'): HTMLDivElement {
    return textLine(label, { align, onClick: () => { click(); onClick() } })
}

function footer(...items: HTMLDivElement[]): HTMLDivElement {
    const f = document.createElement('div')
    f.style.cssText = `position: absolute; left: 4px; right: 4px; top: ${CONTENT_H - LINE_H - 4}px; display: flex; justify-content: space-around;`
    f.append(...items)
    return f
}

// CE pipboyWindowHandleStatus (a location clicked): "<location> <210>", the numbered
// quests of that location, completed ones struck through in dark green; BACK (201).
function renderQuestList(screen: HTMLDivElement, locationId: number): void {
    clearScreen(screen)
    const content = makeContentArea()
    content.style.padding = '0 4px'
    screen.appendChild(content)
    const quests = getActiveQuests().filter((q) => q.locationId === locationId)
    content.appendChild(textLine(''))
    content.appendChild(textLine(`${quests[0]?.location ?? ''} ${msg(210, 'Quests')}`, { underline: true }))
    content.appendChild(textLine(''))
    quests.forEach((q, i) => {
        content.appendChild(textLine(`${i + 1}. ${q.description}`, q.isCompleted ? { color: DONE, strike: true } : {}))
        content.appendChild(textLine(''))
    })
    content.appendChild(footer(backButton(screen, msg(201, 'BACK'), () => renderStatusTab(screen))))
}

// CE pipboyRenderHolodiskText: the lines from `description` to "**END-DISK**"
// ("**END-PAR**" is an empty line), 35 a page; the title on the first page, "N of M"
// (212) when there is more than one; BACK (201) and MORE (200) / DONE (214).
function renderHolodisk(screen: HTMLDivElement, disk: HolodiskDef, page: number): void {
    const lines: string[] = []
    for (let id = disk.description; id < disk.description + 500; id++) {
        const text = getMessage('pipboy', id)
        if (text === null || text === '**END-DISK**') break
        lines.push(text)
    }
    const lastPage = Math.floor(lines.length / PIPBOY_HOLODISK_LINES_MAX)
    if (page < 0) return renderStatusTab(screen)
    if (page > lastPage) return renderStatusTab(screen)

    clearScreen(screen)
    const content = makeContentArea()
    content.style.cssText += 'overflow-y: hidden; padding: 0 4px;'
    screen.appendChild(content)

    content.appendChild(textLine(page === 0 ? msg(disk.name, '') : '', { underline: true, align: 'center' }))
    if (lastPage !== 0) {
        const of = document.createElement('div')
        of.style.cssText = TEXT_STYLE + `position: absolute; right: 6px; top: 0; font-size: 11px; color: ${GREEN};`
        of.textContent = `${page + 1} ${msg(212, 'of')} ${lastPage + 1}`
        content.appendChild(of)
    }
    content.appendChild(textLine(''))
    for (const text of lines.slice(page * PIPBOY_HOLODISK_LINES_MAX, (page + 1) * PIPBOY_HOLODISK_LINES_MAX)) {
        content.appendChild(textLine(text === '**END-PAR**' ? '' : text))
    }

    const next = () => renderHolodisk(screen, disk, page + 1)
    const prev = () => renderHolodisk(screen, disk, page - 1)
    content.appendChild(footer(
        backButton(screen, msg(201, 'BACK'), prev, 'center'),
        backButton(screen, page >= lastPage ? msg(214, 'DONE') : msg(200, 'MORE'), next, 'center'),
    ))
    setPageKeys((e) => {
        if (e.key === 'PageDown' && page < lastPage) { e.stopImmediatePropagation(); click(); next() }
        else if (e.key === 'PageUp') { e.stopImmediatePropagation(); click(); prev() }
    })
}

// The Pip-Boy closed or another tab opened: drop the reader's page keys.
export function leaveStatusTab(): void {
    setPageKeys(null)
}
