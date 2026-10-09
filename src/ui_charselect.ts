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

// Premade character selection — CE character_selector.cc characterSelectorOpen.
// NEW GAME opens this first: TAKE starts with the shown premade, MODIFY opens the
// character editor on it, CREATE CHARACTER opens a blank editor, BACK returns to
// the main menu. The editor's CANCEL comes back here.

import { SkillSet, StatSet } from './char.js'
import globalState from './globalState.js'
import { dbg } from './logger.js'
import { loadPremade, loadPremadeBio, PREMADE_CHARACTERS, PremadeCharacter } from './premade.js'
import { CreatorInitialState, showCharacterCreator, STATS } from './ui_character.js'
import { font1 } from './ui_font.js'
import { UIMode } from './ui_panels.js'
import { getMessage } from './util.js'

const W = 640
const H = 480
const COLOR = '#00f800' // _colorTable[992]
const NAME_MID_X = 318
const PRIMARY_STAT_MID_X = 362
const SECONDARY_STAT_MID_X = 379
const BIO_X = 438

let overlay: HTMLElement | null = null
let canvas: HTMLCanvasElement | null = null
let current = 0
let onStart: (() => void) | null = null
let onBack: (() => void) | null = null
let premade: PremadeCharacter | null = null

export function initCharacterSelector(startCb: () => void, backCb: () => void): void {
    onStart = startCb
    onBack = backCb
}

const sfx = (name: string) => globalState.audioEngine?.playSfxByName?.(name)

function button(frame: HTMLElement, x: number, y: number, w: number, h: number, up: string, down: string,
                sound: string, action: () => void): void {
    const b = document.createElement('div')
    Object.assign(b.style, {
        position: 'absolute', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px',
        backgroundImage: `url('${up}')`, backgroundRepeat: 'no-repeat', cursor: 'pointer',
    })
    b.onmousedown = () => { b.style.backgroundImage = `url('${down}')`; sfx(sound) }
    b.onmouseup = b.onmouseleave = () => { b.style.backgroundImage = `url('${up}')` }
    b.onclick = action
    frame.appendChild(b)
}

function build(): void {
    overlay = document.createElement('div')
    overlay.id = 'charSelectOverlay'
    Object.assign(overlay.style, {
        position: 'fixed', left: '0', top: '0', width: '100%', height: '100%',
        backgroundColor: '#000', zIndex: '1000', display: 'none',
    })
    const frame = document.createElement('div')
    Object.assign(frame.style, {
        position: 'absolute', width: W + 'px', height: H + 'px', left: '50%', top: '50%',
        transform: 'translate(-50%, -50%)',
        backgroundImage: "url('art/intrface/pickchar.png')", backgroundRepeat: 'no-repeat', // FID 174
    })
    canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' })
    frame.appendChild(canvas)

    // character_selector.cc:286-480 — button geometry and FRMs (122-125 arrows, 8/9 red).
    button(frame, 292, 320, 20, 18, 'art/intrface/slu.png', 'art/intrface/sld.png', 'ib2p1xx1', () => step(-1))
    button(frame, 318, 320, 20, 18, 'art/intrface/sru.png', 'art/intrface/srd.png', 'ib2p1xx1', () => step(1))
    const red = (x: number, y: number, action: () => void) =>
        button(frame, x, y, 15, 16, 'art/intrface/lilredup.png', 'art/intrface/lilreddn.png', 'ib1p1xx1', action)
    red(81, 323, take)
    red(435, 320, modify)
    red(80, 425, create)
    red(461, 425, back)

    overlay.appendChild(frame)
    document.body.appendChild(overlay)
    document.addEventListener('keydown', onKey)
}

function onKey(e: KeyboardEvent): void {
    if (!overlay || overlay.style.display === 'none') return
    switch (e.key) {
        case 'ArrowLeft': sfx('ib2p1xx1'); step(-1); break
        case 'ArrowRight': sfx('ib2p1xx1'); step(1); break
        case 't': case 'T': take(); break
        case 'm': case 'M': modify(); break
        case 'c': case 'C': create(); break
        case 'b': case 'B': case 'Escape': back(); break
        default: return
    }
    e.preventDefault()
}

// From NEW GAME the selector starts on Narg (PREMADE_CHARACTER_NARG); returning from
// the editor keeps the premade that was shown.
export function showCharacterSelector(fromMainMenu = true): void {
    if (!overlay) build()
    globalState.uiMode = UIMode.characterCreator
    overlay!.style.display = 'block'
    if (fromMainMenu) current = 0
    refresh()
}

function hide(): void {
    if (overlay) overlay.style.display = 'none'
}

function step(delta: number): void {
    const n = PREMADE_CHARACTERS.length
    current = (current + delta + n) % n
    refresh()
}

// CE characterSelectorWindowRefresh: _proto_dude_init(<premade>.gcd), then face,
// stats and bio. Like CE, the dude itself becomes the premade.
function refresh(): void {
    premade = loadPremade(current)
    applyToPlayer(premade)
    font1.onLoad(draw)
}

function applyToPlayer(p: PremadeCharacter): void {
    const player = globalState.player!
    const stats = new StatSet()
    for (const s of STATS) stats.setBase(s, p.special[s])
    const skills = new SkillSet()
    for (const t of p.tagged) skills.tag(t)
    player.applyCreationStats(stats, skills, p.name, p.age, p.sex, p.traits)
    dbg('object', `[CharSelect] premade ${current}: ${p.name}`)
}

// Face first, then stats and bio on top of it (CE refresh order).
function draw(): void {
    if (!canvas || !premade) return
    const index = current
    const face = new Image()
    face.onload = face.onerror = () => { if (index === current) drawPage(face.naturalWidth > 0 ? face : null) }
    face.src = PREMADE_CHARACTERS[index].face
}

function drawPage(face: HTMLImageElement | null): void {
    if (!canvas || !premade) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, W, H)
    // Face — characterSelectorWindowRenderFace, blitted at (27, 23).
    if (face) ctx.drawImage(face, 27, 23)
    const player = globalState.player!
    const lineH = font1.renderCanvas('Ag', COLOR).height

    const text = (s: string, x: number, y: number, align: 'left' | 'right' | 'center' = 'left') => {
        if (!s) return
        const c = font1.renderCanvas(s, COLOR)
        const dx = align === 'right' ? x - c.width : align === 'center' ? x - Math.trunc(c.width / 2) : x
        ctx.drawImage(c, dx, y)
    }

    // characterSelectorWindowRenderStats
    let y = 40
    text(premade.name, NAME_MID_X, y, 'center')
    y += lineH * 3
    STATS.forEach((stat, i) => {
        if (i > 0) y += lineH
        const value = player.getStat(stat)
        const name = getMessage('stat', 100 + i) ?? stat
        text(`${name} ${String(value).padStart(2, '0')}`, PRIMARY_STAT_MID_X, y, 'right')
        text(`  ${getMessage('stat', 301 + Math.min(10, Math.max(1, value)) - 1) ?? ''}`, PRIMARY_STAT_MID_X, y)
    })
    y += lineH // blank line

    const secondary: [string, string][] = [
        [getMessage('misc', 16) ?? 'Hit Points', ` ${player.getStat('HP')}/${player.getStat('Max HP')}`],
        [getMessage('stat', 109) ?? 'Armor Class', ` ${player.getStat('AC')}`],
        [getMessage('misc', 15) ?? 'Action Points', ` ${player.getStat('AP')}`],
        [getMessage('stat', 111) ?? 'Melee Damage', ` ${player.getStat('Melee')}`],
    ]
    for (const [label, value] of secondary) {
        y += lineH
        text(label, SECONDARY_STAT_MID_X, y, 'right')
        text(value, SECONDARY_STAT_MID_X, y)
    }
    y += lineH // blank line

    for (const skill of premade.tagged) {
        y += lineH
        text(skill, SECONDARY_STAT_MID_X, y, 'right')
        text(` ${player.getSkill(skill)}%`, SECONDARY_STAT_MID_X, y)
    }
    for (const trait of premade.traits) {
        y += lineH
        text(trait, SECONDARY_STAT_MID_X, y, 'right')
    }

    // characterSelectorWindowRenderBio — lines from y=40 while y < 260.
    let by = 40
    for (const line of loadPremadeBio(current)) {
        if (by >= 260) break
        text(line, BIO_X, by)
        by += lineH
    }
}

function take(): void {
    hide()
    globalState.uiMode = UIMode.none
    onStart?.()
}

// MODIFY — characterEditorShow(1) on the loaded premade; DONE starts the game,
// CANCEL comes back to the selector.
function modify(): void {
    if (!premade) return
    const initial: CreatorInitialState = { ...premade, special: { ...premade.special }, tagged: [...premade.tagged], traits: [...premade.traits] }
    openEditor(initial)
}

// CREATE CHARACTER — _ResetPlayer, then the blank editor.
function create(): void {
    openEditor(undefined)
}

function openEditor(initial: CreatorInitialState | undefined): void {
    hide()
    globalState.uiMode = UIMode.characterCreator
    showCharacterCreator(
        () => { globalState.uiMode = UIMode.none; onStart?.() },
        () => showCharacterSelector(false),
        initial,
    )
}

function back(): void {
    hide()
    globalState.uiMode = UIMode.none
    onBack?.()
}
