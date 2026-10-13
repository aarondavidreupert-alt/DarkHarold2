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

// Save / Load window — CE loadsave.cc lsgWindowInit / _ShowSlotList / _DrawInfoBox.
//   - lsgame.frm 640x480, lscover over the preview; title (lsgame.msg 100 / 102) font 103
//     at (48, 27); DONE / CANCEL labels at (410, 348) / (515, 348) next to the little
//     red buttons at (391, 349) / (495, 349); up / down arrows at (35, 58) / (35, 72)
//   - slot list at (55, 87), 230x353, font 101: "[   SAVE GAME 01:   ]" (109 / 110) then
//     the description or "       - EMPTY -" (111); 34 px per slot; green 992, the
//     selected slot 32747
//   - info box: character name at (396, 254), "DD MON YYYY   HHMM" at (397, 266), city +
//     map wrapped at 164 px from (399, 279), 12 px apart; "Empty." (114) at (404, 262)
// DH2 additions: any number of slots (always one free slot when saving) with a scroll
// bar and mouse wheel, and deleting a save (DELETE button / Del key, with confirmation).

import { areaContainingMap, loadAreas, mapIndexOf } from './data.js'
import * as GameTime from './gametime.js'
import globalState from './globalState.js'
import { dbg } from './logger.js'
import { deleteSave, getSaveSnapshot, load, save, SaveGame, saveList, takeSaveSnapshot } from './saveload.js'
import { Widget } from './ui_widget.js'
import { WindowFrame, SmallButton } from './ui_components.js'
import { CE_COLOR, font1, font3, FoText } from './ui_font.js'
import { UIMode } from './ui_panels.js'
import { showConfirm, showInput } from './ui_dialog.js'
import { getMessage } from './util.js'

const LIST_X = 55
const LIST_Y = 87
const LIST_W = 230
const LIST_H = 353
const SLOT_H = 34          // lineHeight + 2 * lineHeight + 4
const VISIBLE_SLOTS = 10
const MIN_SLOTS = 10

function lsg(id: number, fallback: string): string {
    return getMessage('lsgame', id) ?? fallback
}

function addText(parent: HTMLElement, text: string, x: number, y: number, font = font1, color: string = CE_COLOR.green): FoText {
    const t = new FoText(font, text, color)
    Object.assign(t.elem.style, { position: 'absolute', left: x + 'px', top: y + 'px', pointerEvents: 'none' })
    parent.appendChild(t.elem)
    return t
}

// City + map line of the info box: "%s %s" of CE mapGetCityName (map.msg 1500 + area)
// and mapGetName (map.msg 200 + 3 * map + elevation), e.g. "Arroyo Village".
function mapLine(s: SaveGame): string {
    if (!globalState.mapAreas) {
        try { globalState.mapAreas = loadAreas() } catch (_) { /* no areas */ }
    }
    let areaId = -1
    try { areaId = (globalState.mapAreas ? areaContainingMap(s.currentMap)?.id : undefined) ?? -1 } catch (_) { /* unknown */ }
    const index = mapIndexOf(s.currentMap)
    const city = areaId >= 0 ? getMessage('map', 1500 + areaId) ?? '' : ''
    const map = index >= 0 ? getMessage('map', index * 3 + (s.currentElevation ?? 0) + 200) ?? '' : ''
    return `${city} ${map}`.trim() || s.currentMap
}

function wrap(text: string, width: number): string[] {
    const lines: string[] = []
    let line = ''
    for (const word of text.split(' ')) {
        const t = line ? line + ' ' + word : word
        if (line && font1.measureText(t) > width) { lines.push(line); line = word } else line = t
    }
    if (line) lines.push(line)
    return lines
}

export function uiSaveLoad(isSave: boolean): void {
    // CE loadsave.cc lsgSaveGame: _QuickSnapShot before the save window opens.
    if (isSave) takeSaveSnapshot()
    globalState.uiMode = UIMode.saveLoad

    const win = new WindowFrame('art/intrface/lsgame.png', { x: 80, y: 20 }, 640, 480)
        .add(new Widget('art/intrface/lscover.png', { x: 340, y: 40, w: 275, h: 173 }))
        .add(new SmallButton(391, 349).onClick(() => { void confirm() }))
        .add(new SmallButton(495, 349).onClick(close))
        .add(new SmallButton(391, 323).onClick(() => { void remove() }))
        .add(new Widget('art/intrface/uparwoff.png', { x: 35, y: 58, w: 11, h: 14 }).mouseDownBG('art/intrface/uparwon.png').onClick(() => move(-1)))
        .add(new Widget('art/intrface/dnarwoff.png', { x: 35, y: 72, w: 11, h: 14 }).mouseDownBG('art/intrface/dnarwon.png').onClick(() => move(1)))
        .show()
    const el = win.elem

    font3.onLoad(() => {
        addText(el, lsg(isSave ? 102 : 100, isSave ? 'SAVE GAME' : 'LOAD GAME'), 48, 27, font3, CE_COLOR.label)
        addText(el, lsg(104, 'DONE'), 410, 348, font3, CE_COLOR.label)
        addText(el, lsg(105, 'CANCEL'), 515, 348, font3, CE_COLOR.label)
        addText(el, 'DELETE', 410, 322, font3, CE_COLOR.label) // DH2 addition
    })

    // Preview: CE loadsave.cc:479-491 — the slot thumbnail (224x133, drawn 223x132)
    // at (366, 58) over the lscover art; with nothing to show the cover stays.
    const preview = document.createElement('img')
    Object.assign(preview.style, {
        position: 'absolute', left: '366px', top: '58px', width: '223px', height: '132px',
        display: 'none', pointerEvents: 'none',
    })
    el.appendChild(preview)

    const info = document.createElement('div')
    Object.assign(info.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' })
    el.appendChild(info)

    const list = document.createElement('div')
    Object.assign(list.style, { position: 'absolute', left: LIST_X + 'px', top: LIST_Y + 'px', width: LIST_W + 'px', height: LIST_H + 'px', overflow: 'hidden', cursor: 'pointer' })
    el.appendChild(list)

    // Scroll bar (DH2): a thin track just right of the list, thumb in the list green.
    const track = document.createElement('div')
    Object.assign(track.style, { position: 'absolute', left: (LIST_X + LIST_W + 1) + 'px', top: LIST_Y + 'px', width: '4px', height: LIST_H + 'px', background: CE_COLOR.dimGreen })
    const thumb = document.createElement('div')
    Object.assign(thumb.style, { position: 'absolute', left: '0', width: '4px', background: CE_COLOR.green })
    track.appendChild(thumb)
    el.appendChild(track)

    let saves: SaveGame[] = []
    let slots: (SaveGame | null)[] = []
    let cursor = 0
    let top = 0
    let busy = false // a confirm / input dialog is open — leave its keys alone

    function rebuildSlots(): void {
        slots = [...saves]
        if (isSave || slots.length === 0) slots.push(null)
        while (slots.length < MIN_SLOTS) slots.push(null)
        cursor = Math.min(cursor, slots.length - 1)
    }

    function drawList(): void {
        while (list.firstChild) list.removeChild(list.firstChild)
        const header = lsg(isSave ? 109 : 110, isSave ? 'SAVE GAME' : 'LOAD GAME')
        for (let i = top; i < Math.min(slots.length, top + VISIBLE_SLOTS); i++) {
            const y = (i - top) * SLOT_H
            const color = i === cursor ? CE_COLOR.highlight : CE_COLOR.green
            addText(list, `[   ${header} ${String(i + 1).padStart(2, '0')}:   ]`, 0, y, font1, color)
            const s = slots[i]
            addText(list, s ? s.name : `       ${lsg(111, '- EMPTY -')}`, 0, y + font1.lineHeight, font1, color)
        }
        const max = Math.max(1, slots.length)
        const visible = Math.min(VISIBLE_SLOTS, slots.length)
        thumb.style.height = Math.max(8, Math.round(LIST_H * visible / max)) + 'px'
        thumb.style.top = Math.round(LIST_H * top / max) + 'px'
        track.style.display = slots.length > VISIBLE_SLOTS ? 'block' : 'none'
    }

    function drawInfo(): void {
        while (info.firstChild) info.removeChild(info.firstChild)
        const s = slots[cursor]
        if (!s) {
            addText(info, lsg(114, 'Empty.'), 404, 262)
            const snap = isSave ? getSaveSnapshot() : undefined // CE: an empty slot previews the current snapshot
            if (snap) { preview.src = snap; preview.style.display = 'block' } else preview.style.display = 'none'
            return
        }
        const lh = font1.lineHeight
        addText(info, s.playerState?.name ?? '', 396, 254)
        const d = GameTime.getDate(s.gameTickTime ?? 0)
        const month = lsg(117 + d.month, 'JAN')
        addText(info, `${String(d.day).padStart(2, '0')} ${month} ${String(d.year).padStart(4, '0')}   ${String(100 * d.hours + d.minutes).padStart(4, '0')}`, 397, 256 + lh)
        let y = 256 + 2 * lh + 3
        for (const line of wrap(mapLine(s), 164)) {
            addText(info, line, 399, y)
            y += lh + 2
        }
        if (s.screenshot) { preview.src = s.screenshot; preview.style.display = 'block' } else preview.style.display = 'none'
    }

    function redraw(): void {
        if (!font1.isLoaded()) { font1.onLoad(redraw); return }
        drawList()
        drawInfo()
    }

    function select(i: number): void {
        cursor = Math.max(0, Math.min(slots.length - 1, i))
        if (cursor < top) top = cursor
        if (cursor >= top + VISIBLE_SLOTS) top = cursor - VISIBLE_SLOTS + 1
        redraw()
    }

    function move(delta: number): void {
        select(cursor + delta)
    }

    list.addEventListener('click', (e) => {
        const y = e.clientY - list.getBoundingClientRect().top
        const i = top + Math.floor(y / SLOT_H)
        if (i >= slots.length) return
        select(i)
    })
    list.addEventListener('dblclick', () => { void confirm() })
    const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        const maxTop = Math.max(0, slots.length - VISIBLE_SLOTS)
        top = Math.max(0, Math.min(maxTop, top + (e.deltaY > 0 ? 1 : -1)))
        if (cursor < top) cursor = top
        if (cursor >= top + VISIBLE_SLOTS) cursor = top + VISIBLE_SLOTS - 1
        redraw()
    }
    list.addEventListener('wheel', onWheel, { passive: false })
    track.addEventListener('wheel', onWheel, { passive: false })
    track.addEventListener('mousedown', (e) => {
        const y = e.clientY - track.getBoundingClientRect().top
        select(Math.floor(slots.length * y / LIST_H))
    })

    function refresh(): void {
        saveList((all: SaveGame[]) => {
            saves = all.slice().sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
            rebuildSlots()
            select(cursor)
        })
    }

    function close(): void {
        document.removeEventListener('keydown', onKey, true)
        globalState.uiMode = UIMode.none
        win.close()
    }

    async function confirm(): Promise<void> {
        if (busy) return
        busy = true
        try { await confirmSlot() } finally { busy = false }
    }

    async function confirmSlot(): Promise<void> {
        const s = slots[cursor]
        if (isSave) {
            // CE ref: lsgame.msg 131 "Save game already exists, overwrite?"
            if (s && !(await showConfirm(lsg(131, 'Save game already exists, overwrite?')))) return
            const name = await showInput(lsg(130, 'DESCRIPTION'))
            if (name === null) return
            dbg('saveload', `[UI] Saving slot ${cursor + 1} (save #${s?.id ?? 'new'}).`)
            save(name, s?.id ?? undefined, close)
        } else {
            if (!s || s.id === undefined) return
            dbg('saveload', `[UI] Loading save #${s.id}.`)
            load(s.id)
            close()
        }
    }

    async function remove(): Promise<void> {
        const s = slots[cursor]
        if (busy || !s || s.id === undefined) return
        busy = true
        try {
            if (await showConfirm(`Delete "${s.name}"?`)) deleteSave(s.id, refresh)
        } finally { busy = false }
    }

    // CE keys: Up/Down (and the arrow buttons) move the cursor, Return confirms,
    // Esc cancels; DH2: Page Up/Down, Home/End, Del deletes.
    function onKey(e: KeyboardEvent): void {
        if (!win.showing || busy || globalState.uiMode !== UIMode.saveLoad) return
        const handled = (() => {
            switch (e.key) {
                case 'ArrowUp': move(-1); return true
                case 'ArrowDown': move(1); return true
                case 'PageUp': move(-VISIBLE_SLOTS); return true
                case 'PageDown': move(VISIBLE_SLOTS); return true
                case 'Home': select(0); return true
                case 'End': select(slots.length - 1); return true
                case 'Enter': void confirm(); return true
                case 'Escape': close(); return true
                case 'Delete': void remove(); return true
            }
            return false
        })()
        if (handled) { e.preventDefault(); e.stopPropagation() }
    }
    document.addEventListener('keydown', onKey, true)

    rebuildSlots()
    redraw()
    refresh()
}
