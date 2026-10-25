// The PERKS / KARMA / KILLS folder of the character screen — CE character_editor.cc:
// characterEditorDrawPerksFolder, characterEditorDrawKarmaFolder,
// characterEditorDrawKillsFolder and the folder view (characterEditorFolderViewClear /
// DrawHeading / DrawString / DrawKillsEntry / Scroll): nine lines of font 101 from
// (34, 364), lineHeight + 1 apart; headings centred between two rules; a clicked line
// turns yellow and its card is shown; the up / down arrows at (317, 364) scroll.
// The karma folder reads data/karmavar.txt and data/genrep.txt (karmaInit,
// genericReputationInit) and the town reputations of gTownReputationEntries.

import { CE_PERK_REQS, perkNameById, PERK_COUNT } from '../perks/cePerks.js'
import { getPerkRank } from '../perks.js'
import { killCounts } from '../critter.js'
import { ADDICTION_KARMA_GVARS } from '../drugs.js'
import { Scripting } from '../scripting.js'
import { getFileJSON, getFileText, getMessage } from '../util.js'
import { Worldmap } from '../worldmap.js'
import { font1 } from '../ui_font.js'
import { TRAITS, TRAIT_DESCRIPTIONS } from './descriptions.js'
import { assetUrl } from '../modAssets.js'

const GREEN = '#3cf800' // _colorTable[992]
const YELLOW = '#fcfc7c' // _colorTable[32747]
const FOLDER_X = 34
const FOLDER_Y = 364
const FOLDER_RIGHT = 314
const MAX_LINES = 9
const GVAR_PLAYER_REPUTATION = 0

// CE trait.cc gTraitDescriptions frmIds (skilldex.lst)
const TRAIT_FRM_IDS = [55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 94, 69, 70]
// CE character_editor.cc gAddictionReputationFrmIds
const ADDICTION_FRM_IDS = [142, 126, 140, 144, 145, 52, 136, 149]
// CE gTownReputationEntries: { GVAR_TOWN_REP_*, CITY_* }
const TOWN_REPUTATION: [number, number][] = [
    [47, 0], [48, 2], [49, 1], [50, 4], [51, 5], [52, 3], [53, 8], [54, 6], [55, 7], [56, 13],
    [57, 10], [59, 11], [61, 14], [63, 17], [64, 19], [65, 18], [66, 25], [294, 9], [308, 20],
]

export interface Card { frmId: number; title: string; description: string }
export interface Line { kind: 'heading' | 'string' | 'kills'; text: string; count?: number; card: Card | null }

const editorMsg = (id: number) => getMessage('editor', id) ?? ''

function skilldexArt(frmId: number): string | undefined {
    const lst = getFileJSON('lut/lst/art_skilldex.json') as string[] | null
    const name = lst?.[frmId]
    return name ? 'art/skilldex/' + name.split('.')[0].toLowerCase() + '.png' : undefined
}

// "a, b, c, d" lines of a CE data/*.txt table (# comments)
function readTable(path: string): number[][] {
    let text = ''
    try { text = getFileText(path) } catch { return [] }
    return text.split('\n')
        .map((l) => l.replace(/#.*/, '').trim())
        .filter((l) => l !== '')
        .map((l) => l.split(/[\s,]+/).map((v) => parseInt(v, 10)))
}

let karmaEntries: number[][] | null = null // gvar, art, name, description (sorted by gvar)
let genericReputation: number[][] | null = null // threshold, name (sorted high → low)

// CE characterEditorDrawPerksFolder
function perksFolder(player: any): { lines: Line[]; fallback: Card } {
    const lines: Line[] = []
    const traits: string[] = player.traits ?? []
    if (traits.length > 0) {
        lines.push({ kind: 'heading', text: editorMsg(156), card: { frmId: 54, title: editorMsg(146), description: editorMsg(147) } })
        for (const t of traits) {
            const idx = TRAITS.indexOf(t)
            lines.push({ kind: 'string', text: t, card: { frmId: TRAIT_FRM_IDS[idx] ?? 54, title: t, description: TRAIT_DESCRIPTIONS[t] ?? '' } })
        }
    }
    const ranks: [number, number][] = []
    for (let id = 0; id < PERK_COUNT; id++) {
        const name = perkNameById(id)
        const rank = name ? getPerkRank(player, name) : 0
        if (rank !== 0) ranks.push([id, rank])
    }
    if (ranks.length > 0) {
        lines.push({ kind: 'heading', text: editorMsg(109), card: null })
        for (const [id, rank] of ranks) {
            const name = perkNameById(id) ?? ''
            lines.push({
                kind: 'string', text: rank === 1 ? name : `${name} (${rank})`,
                card: { frmId: CE_PERK_REQS[id][6], title: name, description: getMessage('perk', 1101 + id) ?? '' },
            })
        }
    }
    return { lines, fallback: { frmId: 71, title: editorMsg(124), description: editorMsg(127) } }
}

// CE characterEditorDrawKarmaFolder
export function karmaFolder(): { lines: Line[]; fallback: Card } {
    karmaEntries ??= readTable('data/data/karmavar.txt').sort((a, b) => a[0] - b[0])
    genericReputation ??= readTable('data/data/genrep.txt').sort((a, b) => b[0] - a[0])
    const gvar = (n: number) => Number(Scripting.getGlobalVar(n)) || 0
    const lines: Line[] = []
    for (const [g, art, name, description] of karmaEntries) {
        if (g === GVAR_PLAYER_REPUTATION) {
            const karma = gvar(GVAR_PLAYER_REPUTATION)
            const rep = genericReputation.find(([threshold]) => karma >= threshold)
            if (rep) {
                lines.push({
                    kind: 'string', text: `${editorMsg(125)}: ${karma} (${editorMsg(rep[1])})`,
                    card: { frmId: art, title: editorMsg(125), description: editorMsg(description) },
                })
            }
        } else if (gvar(g) !== 0) {
            lines.push({ kind: 'string', text: editorMsg(name), card: { frmId: art, title: editorMsg(name), description: editorMsg(description) } })
        }
    }

    let townHeading = false
    for (const [g, city] of TOWN_REPUTATION) {
        if (!Worldmap.areaIsKnown(city)) continue
        if (!townHeading) {
            lines.push({ kind: 'heading', text: editorMsg(4000), card: { frmId: 48, title: editorMsg(4000), description: editorMsg(4100) } })
            townHeading = true
        }
        const rep = gvar(g)
        const [frm, msg] = rep < -30 ? [150, 2006] : rep < -15 ? [153, 2005] : rep < 0 ? [153, 2004]
            : rep === 0 ? [141, 2003] : rep < 15 ? [137, 2002] : rep < 30 ? [137, 2001] : [135, 2000]
        lines.push({
            kind: 'string', text: `${getMessage('map', 1500 + city) ?? ''}: ${editorMsg(msg)}`,
            card: { frmId: frm, title: editorMsg(msg), description: editorMsg(msg + 100) },
        })
    }

    let addictionHeading = false
    ADDICTION_KARMA_GVARS.forEach((g, index) => {
        if (gvar(g) === 0) return
        if (!addictionHeading) {
            lines.push({ kind: 'heading', text: editorMsg(4001), card: { frmId: 53, title: editorMsg(4001), description: editorMsg(4101) } })
            addictionHeading = true
        }
        lines.push({
            kind: 'string', text: editorMsg(1004 + index),
            card: { frmId: ADDICTION_FRM_IDS[index], title: editorMsg(1004 + index), description: editorMsg(1104 + index) },
        })
    })
    // SFALL custom karma folder: default art 47
    return { lines, fallback: { frmId: 47, title: editorMsg(125), description: editorMsg(128) } }
}

// CE characterEditorDrawKillsFolder: the kill types with kills, by name
function killsFolder(): { lines: Line[]; fallback: Card } {
    const kills: { name: string; type: number; count: number }[] = []
    for (const [type, count] of killCounts) {
        if (count !== 0) kills.push({ name: getMessage('proto', 1450 + type) ?? `#${type}`, type, count })
    }
    kills.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    const lines: Line[] = kills.map((k) => ({
        kind: 'kills', text: k.name, count: k.count,
        card: { frmId: 46, title: `${k.name} ${editorMsg(126)}`, description: getMessage('proto', 1469 + k.type) ?? '' },
    }))
    return { lines, fallback: { frmId: 46, title: editorMsg(126), description: editorMsg(129) } }
}

export interface FolderView {
    setFolder(folder: number): void
    refresh(): void
    blur(): void // another card was shown (CE: the selected item left the folder)
}

// Builds the folder view inside `parent` (the character window). `showCard` draws a
// card (title, description, art path).
export function createFolderView(parent: HTMLElement, player: any, showCard: (title: string, desc: string, img?: string) => void): FolderView {
    const step = () => font1.lineHeight + 1
    const box = document.createElement('div')
    Object.assign(box.style, { position: 'absolute', left: FOLDER_X + 'px', top: FOLDER_Y + 'px', width: FOLDER_RIGHT - FOLDER_X + 'px' })
    parent.appendChild(box)

    let folder = 0
    const topLine = [0, 0, 0]
    let selected = -1 // visible line index, -1: none (CE characterEditorSelectedItem − 10)
    let lineCount = 0
    let active = false // the card shows the folder (CE selected item 10..42)

    const build = () => folder === 0 ? perksFolder(player) : folder === 1 ? karmaFolder() : killsFolder()

    const rule = (width: number) => {
        const r = document.createElement('div')
        Object.assign(r.style, { width: Math.max(0, width) + 'px', height: '1px', background: GREEN, alignSelf: 'center' })
        return r
    }

    const draw = () => {
        while (box.firstChild) box.removeChild(box.firstChild)
        const { lines, fallback } = build()
        lineCount = lines.length
        const top = topLine[folder]
        let card: Card | null = null
        lines.slice(top, top + MAX_LINES).forEach((line, i) => {
            const isSel = i === selected
            if (isSel && line.card) card = line.card
            const row = document.createElement('div')
            Object.assign(row.style, { display: 'flex', height: step() + 'px', width: FOLDER_RIGHT - FOLDER_X + 'px', cursor: 'pointer' })
            const color = line.kind !== 'heading' && isSel ? YELLOW : GREEN
            if (line.kind === 'heading') {
                // characterEditorFolderViewDrawHeading: x = (280 − (w + 4 gap)) / 2
                const gap = font1.letterSpacing
                const lineLen = font1.measureText(line.text) + gap * 4
                const x = Math.trunc((280 - lineLen) / 2)
                row.appendChild(rule(x))
                const t = font1.renderText(line.text, GREEN)
                t.style.margin = `0 ${gap * 2}px`
                row.appendChild(t)
                row.appendChild(rule(280 - x - lineLen))
            } else if (line.kind === 'kills') {
                // characterEditorFolderViewDrawKillsEntry: name, a rule, the count at 314
                const gap = font1.letterSpacing
                row.appendChild(font1.renderText(line.text, color))
                const r = rule(0)
                Object.assign(r.style, { flex: '1', margin: `0 ${gap}px`, background: color })
                row.appendChild(r)
                row.appendChild(font1.renderText(String(line.count), color))
            } else {
                row.appendChild(font1.renderText(line.text, color))
            }
            row.onclick = () => {
                selected = i
                active = true
                draw()
            }
            box.appendChild(row)
        })
        if (!active) return
        const shown: Card = card ?? fallback
        showCard(shown.title, shown.description, skilldexArt(shown.frmId))
    }

    // characterEditorFolderViewScroll and its arrow buttons (uparwoff/on, dnarwoff/on)
    const arrow = (y: number, off: string, on: string, dir: number) => {
        const img = document.createElement('img')
        img.src = assetUrl(off)
        Object.assign(img.style, { position: 'absolute', left: '317px', top: y + 'px', cursor: 'pointer' })
        img.onmousedown = () => { img.src = assetUrl(on) }
        img.onmouseup = img.onmouseleave = () => { img.src = assetUrl(off) }
        img.onclick = () => {
            if (dir >= 0) {
                if (MAX_LINES + topLine[folder] <= lineCount) {
                    topLine[folder]++
                    if (selected > 0) selected--
                }
            } else if (topLine[folder] > 0) {
                topLine[folder]--
                if (selected >= 0 && selected < MAX_LINES - 1) selected++
            }
            draw()
        }
        parent.appendChild(img)
        return img
    }
    const up = arrow(FOLDER_Y, 'art/intrface/uparwoff.png', 'art/intrface/uparwon.png', -1)
    up.onload = () => { down.style.top = FOLDER_Y + 1 + up.naturalHeight + 'px' }
    const down = arrow(FOLDER_Y + 1 + 14, 'art/intrface/dnarwoff.png', 'art/intrface/dnarwon.png', 1)

    font1.onLoad(() => draw())
    return {
        // CE characterEditorHandleFolderButtonPressed: a tab shows the folder's card
        setFolder(f: number) {
            folder = f
            selected = -1
            active = true
            draw()
        },
        refresh() { draw() },
        blur() {
            active = false
            selected = -1
            draw()
        },
    }
}
