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

// PipBoy shell: container, date/time bar, wait menu, shared widget helpers,
// tab dispatcher, public open/close/toggle. Split out of ui_pipboy.ts.
// See wiki/ts-split-refactor.md → "Per-file split proposals" §12.

import { Events } from '../events.js'
import globalState from '../globalState.js'
import * as GameTime from '../gametime.js'
import { UIMode } from '../ui_panels.js'
import { Config } from '../config.js'
import { makePanelDraggable } from '../ui_drag.js'
import { getMessage } from '../util.js'
import { showAlert } from '../ui_dialog.js'
import { mapCanRestHere } from '../data.js'
import { setIndicatorBarHidden, updateIndicatorBar } from '../ui_hud.js'
import { gameMovieIsSeen, MOVIE_VSUIT } from '../gameMovie.js'
import type { Critter } from '../object.js'

// CE critter.h KILL_TYPE_ROBOT
const KILL_TYPE_ROBOT = 10

export type PipBoyTab = 'STATUS' | 'AUTOMAPS' | 'ARCHIVES' | 'CLOSE'

// The screen div covers the entire PipBoy container so children using
// absolute positioning with pip.png-relative coordinates (e.g. the automap
// canvas at left:250, top:38) land in the right place without offset math.
const SCREEN_X = 0
const SCREEN_Y = 0
const SCREEN_W = 640
const SCREEN_H = 480

// Content area for text tabs (STATUS, ARCHIVES/quest log) — matches the
// green CRT screen region on pip.png.
export const CONTENT_X = 250
export const CONTENT_Y = 38
export const CONTENT_W = 350
export const CONTENT_H = 360

// Exact automap canvas placement requested — do NOT override via CSS.
export const AUTOMAP_CANVAS_LEFT = 250
export const AUTOMAP_CANVAS_TOP = 38
export const AUTOMAP_CANVAS_W = 350
export const AUTOMAP_CANVAS_H = 360

// Clickable tab dot positions (left of each label in pip.png)
const TABS: { tab: PipBoyTab; x: number; y: number }[] = [
    { tab: 'STATUS',   x: 53, y: 340 },
    { tab: 'AUTOMAPS', x: 53, y: 394 },
    { tab: 'ARCHIVES', x: 53, y: 422 },
    { tab: 'CLOSE',    x: 53, y: 448 },
]

let pipBoyContainer: HTMLDivElement | null = null
let currentTab: PipBoyTab = 'STATUS'
const dotElements: Map<string, HTMLDivElement> = new Map()
let alarmOn = false
let waitMenuDiv: HTMLDivElement | null = null
let isRestAnimating = false  // prevents re-entry during time-advance animation

// ESC stops a rest in progress (CE pipboyRest: inputGetInput() == KEY_ESCAPE)
window.addEventListener('keydown', (e) => {
    if (isRestAnimating && e.key === 'Escape') { restCancelled = true; e.stopImmediatePropagation() }
}, true)

// numbers.png sprite: each digit is 9x17, laid out horizontally 0-9 then extra glyphs
// Index 12 = colon character
const DIGIT_W = 9
const DIGIT_H = 17

function makeDigit(digit: number, left: number, top: number): HTMLDivElement {
    const el = document.createElement('div')
    el.style.cssText = `
        position: absolute;
        left: ${left}px; top: ${top}px;
        width: ${DIGIT_W}px; height: ${DIGIT_H}px;
        background-image: url('${assetUrl('art/intrface/numbers.png')}');
        background-position-x: -${digit * DIGIT_W}px;
        background-repeat: no-repeat;
    `
    return el
}

// Thin wrapper so the existing PipBoy rendering code can still destructure
// a `{day, month, year, hours, minutes}` object. The actual math lives in
// src/gametime.ts.
function getGameDate(_ticks: number): { day: number; month: number; year: number; hours: number; minutes: number } {
    return GameTime.getDate()
}

function renderDateTimeBar(): void {
    if (!pipBoyContainer) return

    // Remove old bar if exists
    const oldBar = pipBoyContainer.querySelector('#pipboyDateTimeBar')
    if (oldBar) oldBar.remove()

    const bar = document.createElement('div')
    bar.id = 'pipboyDateTimeBar'
    bar.style.cssText = 'position: absolute; left: 0; top: 18px; width: 240px; height: 20px;'

    const { day, month, year, hours, minutes } = getGameDate(globalState.gameTickTime)

    // 1. DAY — 2 digits at left:20
    const d1 = Math.floor(day / 10)
    const d2 = day % 10
    bar.appendChild(makeDigit(d1, 20, 0))
    bar.appendChild(makeDigit(d2, 20 + DIGIT_W, 0))

    // 2. MONTH sprite — CE ref: pipboy.cc:798, PIPBOY_WINDOW_MONTH_X=46, Y=18.
    //    months.png: 29×(12×15)px, each month is 29×14px visible at stride 15.
    //    Bar is at top:18px so month top=0 lands at absolute y=18. month is 0-indexed.
    const monthEl = document.createElement('div')
    monthEl.style.cssText = `
        position: absolute;
        left: 46px; top: 0px;
        width: 29px; height: 14px;
        background-image: url('${assetUrl('art/intrface/months.png')}');
        background-position-y: -${month * 15}px;
        background-repeat: no-repeat;
        image-rendering: pixelated;
    `
    bar.appendChild(monthEl)

    // 3. YEAR — 4 digits at left:82
    const y1 = Math.floor(year / 1000)
    const y2 = Math.floor((year % 1000) / 100)
    const y3 = Math.floor((year % 100) / 10)
    const y4 = year % 10
    bar.appendChild(makeDigit(y1, 86, 0))
    bar.appendChild(makeDigit(y2, 86 + DIGIT_W, 0))
    bar.appendChild(makeDigit(y3, 86 + DIGIT_W * 2, 0))
    bar.appendChild(makeDigit(y4, 86 + DIGIT_W * 3, 0))

    // 4. BELL button — CE ref: pipboy.cc:566 buttonCreate(gPipboyWindow, 124, 13, ...).
    //    Bar is at top:18px → button top = 13-18 = -5px in bar coords.
    const bell = document.createElement('div')
    bell.style.cssText = `
        position: absolute;
        left: 125px; top: -5px;
        width: 28px; height: 24px;
        background-image: url('${assetUrl(`art/intrface/${alarmOn ? 'alarmin' : 'alarmout'}.png`)}');
        background-repeat: no-repeat;
        image-rendering: pixelated;
        cursor: pointer;
    `
    bell.onclick = () => toggleWaitMenu()
    bar.appendChild(bell)

    // 5. TIME HH:MM at left:158
    const h1 = Math.floor(hours / 10)
    const h2 = hours % 10
    const m1 = Math.floor(minutes / 10)
    const m2 = minutes % 10
    bar.appendChild(makeDigit(h1, 158, 0))
    bar.appendChild(makeDigit(h2, 158 + DIGIT_W, 0))
    // Colon at index 12
    //bar.appendChild(makeDigit(12, 158 + DIGIT_W * 2, 0))
    bar.appendChild(makeDigit(m1, 158 + DIGIT_W * 2, 0))
    bar.appendChild(makeDigit(m2, 158 + DIGIT_W * 3, 0))

    pipBoyContainer.appendChild(bar)
}

// CE pipboy.cc _ClacTime — hours and minutes until wakeUpHour:00 (24 h when it's that now).
function calcTimeUntilHour(wakeUpHour: number): { hours: number; minutes: number } {
    let hours = GameTime.getHour()
    let minutes = GameTime.getMinute()
    if (hours === wakeUpHour && minutes === 0) return { hours: 24, minutes: 0 }
    hours = wakeUpHour - hours
    if (hours < 0) {
        hours += 24
        if (minutes !== 0) { hours -= 1; minutes = 60 - minutes }
    } else if (minutes !== 0) {
        hours -= 1
        minutes = 60 - minutes
        if (hours < 0) hours = 23
    }
    return { hours, minutes }
}

// CE pipboy.h PIPBOY_REST_DURATION_*: 0-11 fixed / until an hour, 12 until healed,
// 13 until the party is healed.
const REST_UNTIL_HEALED = 12
const REST_UNTIL_PARTY_HEALED = 13

// CE pipboy.cc _rest_time — minutes rested since the last heal (reset when the Pip-Boy opens).
let restTime = 0
let restCancelled = false
let restBail = false
// CE queueProcessEvents returning 1 (poison at 5 HP or less, radiation, withdrawal,
// the midnight movie) during a rest sets _proc_bail_flag
Events.on('queueBail', () => { if (isRestAnimating) restBail = true })

// CE party_member.cc partyIsAnyoneCanBeHealedByRest / partyGetMaxWoundToHealByRest:
// living, visible, non-robot party members (the dude excluded).
function restHealableParty(): Critter[] {
    return (globalState.gParty?.getPartyMembers() ?? []).filter((c) =>
        c.type === 'critter' && !c.dead && c.visible !== false && c.killType !== KILL_TYPE_ROBOT)
}
function partyMaxWound(): number {
    let max = 0
    for (const c of restHealableParty()) max = Math.max(max, c.getStat('Max HP') - c.getStat('HP'))
    return max
}

// CE pipboy.cc _Check4Health / _AddHealth → party_member.cc _partyMemberRestingHeal(3):
// every 180 minutes rested, the dude and each party member heal their Healing Rate.
function check4Health(minutes: number): boolean {
    restTime += minutes
    if (restTime < 180) return false
    restTime = 0
    return true
}
function addHealth(): void {
    for (const c of globalState.gParty?.getPartyMembersAndPlayer() ?? [globalState.player]) {
        if (!c || c.type !== 'critter' || c.dead) continue
        const hp = Math.min(c.getStat('HP') + c.getStat('Healing Rate'), c.getStat('Max HP'))
        c.stats.setBase('HP', hp)
    }
    updateIndicatorBar()
}

// CE: queueProcessEvents during the rest returns true (_proc_bail_flag) — an event that
// starts combat, kills the dude or opens a dialogue ends the rest and closes the Pip-Boy.
function restInterrupted(): boolean {
    const mode = globalState.uiMode
    if (globalState.inCombat || globalState.player?.dead || mode === UIMode.dialogue || mode === UIMode.barter || mode === UIMode.worldMap) restBail = true
    return restBail || restCancelled
}

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms))

// CE pipboyRest: gameMouseSetCursor(MOUSE_CURSOR_WAIT_WATCH) — the animated watch (WAIT2,
// six 12 × 15 frames) while the clock runs. Returns the function that puts the cursor back.
function waitWatchCursor(el: HTMLElement): () => void {
    const frames: string[] = []
    const img = new Image()
    img.onload = () => {
        for (let i = 0; i < 6; i++) {
            const c = document.createElement('canvas')
            c.width = 12
            c.height = 15
            c.getContext('2d')!.drawImage(img, i * 12, 0, 12, 15, 0, 0, 12, 15)
            frames.push(c.toDataURL())
        }
    }
    img.src = assetUrl('art/intrface/wait2.png')
    const before = el.style.cursor
    let n = 0
    const timer = setInterval(() => {
        if (frames.length) el.style.cursor = `url(${frames[n++ % frames.length]}) 6 7, wait`
    }, 100)
    return () => { clearInterval(timer); el.style.cursor = before }
}

// CE pipboy.cc pipboyRest(hours, minutes, duration): the clock runs at ~20 frames per
// second over minutes / 1440 × 3.5 + 0.25 seconds, firing the queued events on the
// way; ESC stops it. Returns true when the rest was cut short.
async function pipboyRest(hours: number, minutes: number, duration: number): Promise<boolean> {
    let rc = false
    if (duration === 0) {
        const hoursInMinutes = hours * 60
        const v1 = hoursInMinutes + minutes
        const v2 = v1 / 1440 * 3.5 + 0.25
        const v3 = v1 > 0 ? minutes / v1 * v2 : 0
        if (minutes !== 0) {
            const start = GameTime.getTime()
            const v4 = v3 * 20
            for (let i = 0; i < Math.trunc(v4) && !rc; i++) {
                GameTime.setTime(Math.trunc(i / v4 * (minutes * 600) + start))
                rc = restInterrupted()
                if (!rc) { renderRestClock(); await sleep(50) }
            }
            if (!rc) {
                GameTime.setTime(start + 600 * minutes)
                if (check4Health(minutes)) addHealth()
            }
            renderRestClock()
        }
        if (hours !== 0 && !rc) {
            const start = GameTime.getTime()
            const v7 = (v2 - v3) * 20
            for (let h = 0; h < Math.trunc(v7) && !rc; h++) {
                rc = restInterrupted()
                if (rc) break
                GameTime.setTime(Math.trunc(h / v7 * (hours * GameTime.TICKS_PER_HOUR) + start))
                rc = restInterrupted()
                if (!rc) {
                    if (check4Health(Math.trunc(hoursInMinutes / v7))) addHealth()
                    renderRestClock()
                    await sleep(50)
                }
            }
            if (!rc) GameTime.setTime(start + GameTime.TICKS_PER_HOUR * hours)
            renderRestClock()
        }
    } else if (duration === REST_UNTIL_HEALED || duration === REST_UNTIL_PARTY_HEALED) {
        const player = globalState.player!
        const wound = () => player.getStat('Max HP') - player.getStat('HP')
        if (wound() === 0 && !(duration === REST_UNTIL_PARTY_HEALED && partyMaxWound() > 0)) return false
        // first pass: the dude
        let hoursToHeal = Math.trunc(wound() / Math.max(1, player.getStat('Healing Rate')) * 3)
        while (!rc && hoursToHeal !== 0) {
            const h = Math.min(hoursToHeal, 24)
            rc = await pipboyRest(h, 0, 0)
            hoursToHeal -= h
        }
        // second pass: what's left (and the party), 3 hours at a time. CE tests the wound
        // measured before the last block, so it rests one more block after the last heal.
        const left = () => Math.max(wound(), duration === REST_UNTIL_PARTY_HEALED ? partyMaxWound() : 0)
        let toHeal = left()
        while (!rc && toHeal !== 0) {
            toHeal = left()
            rc = await pipboyRest(3, 0, 0)
        }
    }
    return rc
}

// CE pipboy.cc pipboyDrawHitPoints + the date / time bar during the rest.
function renderRestClock(): void {
    renderDateTimeBar()
    const hpEl = pipBoyContainer?.querySelector('#pipboyRestHP')
    const player = globalState.player
    if (hpEl && player) hpEl.textContent = `${getMessage('pipboy', 301) ?? 'Hit Points'} ${player.getStat('HP')}/${player.getStat('Max HP')}`
}

// CE pipboy.cc pipboyHandleAlarmClock(1024) → pipboyWindowRenderRestOptions: ALARM CLOCK
// (pipboy.msg 300), the hit points, and the rest options 302-315 (the last one only with
// a party member that rest can heal).
function toggleWaitMenu(): void {
    if (!pipBoyContainer || isRestAnimating) return

    if (alarmOn) {
        alarmOn = false
        waitMenuDiv = null
        renderDateTimeBar()
        renderTab(currentTab)
        return
    }

    // CE critter.cc _critter_can_obj_dude_rest — "You cannot rest at this location!" (215)
    if (!critterCanDudeRest()) {
        globalState.audioEngine?.playSfxByName?.('iisxxxx1')
        void showAlert(getMessage('pipboy', 215) ?? 'You cannot rest at this location!')
        return
    }

    alarmOn = true
    renderDateTimeBar()

    const screen = pipBoyContainer.querySelector('#pipboyScreen') as HTMLDivElement
    if (!screen) return
    clearScreen(screen)

    const content = makeContentArea()
    content.appendChild(makeHeader(getMessage('pipboy', 300) ?? 'ALARM CLOCK'))
    const hpRow = document.createElement('div')
    hpRow.id = 'pipboyRestHP'
    hpRow.style.cssText = TEXT_STYLE + 'font-size: 13px; text-align: center; padding: 2px 0 8px 0;'
    content.appendChild(hpRow)

    const count = (globalState.gParty?.getPartyMembers().length ?? 0) > 0 && restHealableParty().some((c) => c.getStat('HP') < c.getStat('Max HP'))
        ? REST_UNTIL_PARTY_HEALED + 1 : REST_UNTIL_HEALED + 1
    const rows: HTMLDivElement[] = []
    for (let option = 0; option < count; option++) {
        const row = makeListItem(getMessage('pipboy', 302 + option) ?? `Rest option ${option + 1}`, async () => {
            if (isRestAnimating) return
            isRestAnimating = true
            restCancelled = false
            restBail = false
            for (const r of rows) r.style.color = '#3cf800' // CE _colorTable[992]
            row.style.color = '#fcfc7c' // 32747
            globalState.audioEngine?.playSfxByName?.('ib1p1xx1')
            const stopCursor = pipBoyContainer ? waitWatchCursor(pipBoyContainer) : () => {}
            try { await restFor(option) } finally { stopCursor() }
            globalState.audioEngine?.playSfxByName?.('ib2lu1x1')
            row.style.color = '#3cf800'
            isRestAnimating = false
            renderRestClock()
            // CE _proc_bail_flag: an event during the rest closes the Pip-Boy
            if (restBail && pipBoyContainer) closePipBoy()
        })
        rows.push(row)
        content.appendChild(row)
    }

    screen.appendChild(content)
    waitMenuDiv = content
    renderRestClock()
}

async function restFor(duration: number): Promise<void> {
    if (duration === 0) await pipboyRest(0, 10, 0)
    else if (duration === 1) await pipboyRest(0, 30, 0)
    else if (duration <= 7) await pipboyRest(duration - 1, 0, 0)
    else if (duration <= 11) {
        const t = calcTimeUntilHour([8, 12, 18, 0][duration - 8])
        await pipboyRest(t.hours, t.minutes, 0)
    } else await pipboyRest(0, 0, duration)
}

// CE critter.cc _critter_can_obj_dude_rest: no living critter on the elevation that is
// hostile to the dude (its whoHitMe is the dude); where the map forbids resting
// (maps.txt can_rest_here) every living critter of another team blocks it too.
export function critterCanDudeRest(): boolean {
    const gMap = globalState.gMap
    const player = globalState.player
    if (!gMap || !player) return true
    const restricted = !mapCanRestHere(gMap.currentElevation)
    for (const o of gMap.getObjects()) {
        if (o.type !== 'critter' || o === player) continue
        const c = o as Critter
        if (c.dead) continue
        if ((c as any).whoHitMe !== player && (!restricted || c.teamNum === player.teamNum)) continue
        return false
    }
    return true
}

function formatGameTime(_ticks: number): string {
    return `${GameTime.getDateString()}  ${GameTime.getTimeString()}`
}

// --- Shared primitives so every tab is built the same way ---

// Base text style used throughout the PipBoy screen. All tabs use the same
// transparent DOM approach (no dark canvas background), letting pip.png show
// through.
export const TEXT_STYLE = 'color: #3cf800; font-family: monospace;' // CE _colorTable[992]

export function makeHeader(title: string): HTMLDivElement {
    const h = document.createElement('div')
    h.style.cssText = TEXT_STYLE + 'font-size: 16px; padding: 2px 6px 4px 6px; border-bottom: 1px solid #00AA00; margin-bottom: 6px;'
    h.textContent = title
    return h
}

export function makeRow(label: string, value: string, highlighted = false): HTMLDivElement {
    const row = document.createElement('div')
    row.style.cssText = TEXT_STYLE + 'font-size: 13px; line-height: 1.6; padding: 0 6px;'
    const v = document.createElement('span')
    v.style.color = highlighted ? '#FF4444' : '#fcfc7c'
    v.textContent = value
    row.appendChild(document.createTextNode(label + ': '))
    row.appendChild(v)
    return row
}

export function makeListItem(label: string, onClick: () => void): HTMLDivElement {
    const el = document.createElement('div')
    el.style.cssText = TEXT_STYLE + 'font-size: 13px; padding: 3px 8px; cursor: pointer; border-bottom: 1px solid #003300;'
    el.textContent = label
    el.onmouseenter = () => { el.style.backgroundColor = 'rgba(0,80,0,0.35)' }
    el.onmouseleave = () => { el.style.backgroundColor = 'transparent' }
    el.onclick = onClick
    return el
}

export function makeButton(label: string, onClick: () => void): HTMLDivElement {
    const b = document.createElement('div')
    b.textContent = label
    b.style.cssText = TEXT_STYLE + `
        font-size: 12px; padding: 2px 8px;
        border: 1px solid #00AA00; background: rgba(0,20,0,0.6);
        cursor: pointer; display: inline-block; margin-right: 4px;
    `
    b.onclick = onClick
    return b
}

export function clearScreen(screen: HTMLDivElement): void {
    while (screen.firstChild) screen.removeChild(screen.firstChild)
}

// A content area pinned to the green CRT region on pip.png. All text tabs
// render their DOM children into one of these.
export function makeContentArea(): HTMLDivElement {
    const c = document.createElement('div')
    c.style.cssText = `
        position: absolute;
        left: ${CONTENT_X}px; top: ${CONTENT_Y}px;
        width: ${CONTENT_W}px; height: ${CONTENT_H}px;
        overflow-y: auto; overflow-x: hidden;
        background: transparent;
    `
    return c
}

// Lazy tab imports — local require-style references so the side-effect import
// order in the barrel (shell.ts loaded before tabs) doesn't matter for cycles.
import { renderStatusTab, leaveStatusTab } from './tabs/status.js'
import { renderAutomapsTab, resetAutomapNavState } from './tabs/automaps.js'
import { renderArchivesTab } from './tabs/archives.js'
import { assetUrl } from '../modAssets.js'
import { renderLogoScreen, watchPipboyIdle } from './logo.js'

let stopIdleWatch: (() => void) | null = null

export function renderTab(tab: PipBoyTab): void {
    if (!pipBoyContainer) return

    const screen = pipBoyContainer.querySelector('#pipboyScreen') as HTMLDivElement
    if (!screen) return

    currentTab = tab
    leaveStatusTab()

    switch (tab) {
        case 'STATUS':
            renderStatusTab(screen)
            break
        case 'AUTOMAPS':
            renderAutomapsTab(screen)
            break
        case 'ARCHIVES':
            renderArchivesTab(screen)
            break
        case 'CLOSE':
            closePipBoy()
            break
    }

    // Update indicator dots
    for (const [tabName, dotEl] of dotElements) {
        dotEl.style.backgroundImage = tabName === tab
            ? "url('" + assetUrl('art/intrface/lilreddn.png') + "')"
            : "url('" + assetUrl('art/intrface/lilredup.png') + "')"
    }
}

export function openPipBoy(): void {
    // CE pipboy.cc pipboyOpen: not before the Vault Suit movie (wmMapPipboyActive) —
    // "You aren't wearing the pipboy!" (misc.msg 7000).
    if (!gameMovieIsSeen(MOVIE_VSUIT) && !Config.engine.pipboyAvailableAtStart) {
        void showAlert(getMessage('misc', 7000) ?? "You aren't wearing the pipboy!")
        return
    }
    restTime = 0
    // Remove any stale container left in the DOM
    const existing = document.getElementById('pipBoyContainer')
    if (existing) existing.remove()

    globalState.uiMode = UIMode.pipBoy

    pipBoyContainer = document.createElement('div')
    pipBoyContainer.id = 'pipBoyContainer'

    // Background image
    // Centered in the 800×600 uiStage with bottom flush against the HUD:
    // left = (800-640)/2 = 80, top = 600 - 99 - 480 = 21.
    pipBoyContainer.style.cssText = `
        position: absolute; left: 80px; top: 21px;
        width: 640px; height: 480px;
        background-image: url('${assetUrl('art/intrface/pip.png')}');
        background-size: 640px 480px;
        z-index: 100;
    `

    // Screen content area (right panel)
    const screen = document.createElement('div')
    screen.id = 'pipboyScreen'
    screen.style.cssText = `
        position: absolute;
        left: ${SCREEN_X}px; top: ${SCREEN_Y}px;
        width: ${SCREEN_W}px; height: ${SCREEN_H}px;
        overflow: hidden;
        background: transparent;
    `
    pipBoyContainer.appendChild(screen)

    // Tab buttons — clickable dot indicators
    dotElements.clear()
    for (const btn of TABS) {
        const dot = document.createElement('div')
        dot.style.cssText = `
            position: absolute;
            left: ${btn.x}px; top: ${btn.y}px;
            width: 15px; height: 16px;
            background-image: url('${assetUrl('art/intrface/lilredup.png')}');
            cursor: pointer;
        `
        dot.onclick = () => renderTab(btn.tab)
        dotElements.set(btn.tab, dot)
        pipBoyContainer.appendChild(dot)
    }

    // Attach to #uiStage so the 800×600-era `left: 80px; top: 60px` inline
    // offsets center in the viewport on any screen size. Fall back to
    // #game-container on the off chance the stage isn't there.
    const stage = document.getElementById('uiStage') ?? document.getElementById('game-container')!
    stage.appendChild(pipBoyContainer)

    // Allow the user to drag the panel by clicking non-interactive background
    // areas (the pip.png frame) — tab dots/buttons are skipped automatically.
    makePanelDraggable(pipBoyContainer, 'pipboy')

    // Reset automap navigation each time PipBoy opens
    resetAutomapNavState()

    renderDateTimeBar()
    // CE pipboyWindowInit: the logo (and a holiday's name) until a tab is picked
    const screenEl = pipBoyContainer.querySelector('#pipboyScreen') as HTMLDivElement
    if (screenEl) renderLogoScreen(screenEl)
    stopIdleWatch?.()
    stopIdleWatch = watchPipboyIdle(pipBoyContainer)
    setIndicatorBarHidden(true) // CE pipboyWindowInit
}

export function closePipBoy(): void {
    if (!pipBoyContainer) return
    restCancelled = true
    leaveStatusTab()

    waitMenuDiv = null
    alarmOn = false
    stopIdleWatch?.()
    stopIdleWatch = null
    setIndicatorBarHidden(false) // CE pipboyWindowFree
    pipBoyContainer.remove()
    pipBoyContainer = null
    if (globalState.uiMode === UIMode.pipBoy) globalState.uiMode = UIMode.none

    // CE ref: pipboy.cc:712 pipboyWindowFree — scriptsExecMapUpdateProc() on close,
    // so map scripts react to time spent resting (e.g. their time-of-day lighting).
    globalState.gMap?.updateMap()
}

// CE pipboyOpen(PIPBOY_OPEN_INTENT_REST) — the Z key: the Pip-Boy straight on the
// alarm clock.
export function openPipBoyRest(): void {
    if (pipBoyContainer) return
    openPipBoy()
    if (pipBoyContainer) toggleWaitMenu()
}

export function togglePipBoy(): void {
    if (pipBoyContainer) {
        closePipBoy()
    } else {
        openPipBoy()
    }
}

export function isPipBoyOpen(): boolean {
    return pipBoyContainer !== null
}
