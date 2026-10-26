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

// The Pip-Boy's start screen and its idle screensaver.
// CE pipboy.cc pipboyWindowInit: the window opens on the logo (PIPBOY_FRM_LOGO, pipx at
// 323,156) with the holiday's name under it (pipboy.msg 100-107, gHolidayDescriptions)
// until a tab is picked. pipboyRenderScreensaver: after PIPBOY_IDLE_TIMEOUT (2 min)
// without input the content view shows the bare background with bombs (BOMB1) falling
// diagonally; any key or mouse movement ends it.

import * as GameTime from '../gametime.js'
import { CE_COLOR, font1 } from '../ui_font.js'
import { getMessage } from '../util.js'
import { assetUrl } from '../modAssets.js'
import { randomBetween } from '../random.js'

const LOGO_X = 323
const LOGO_Y = 156
const LOGO_W = 204
const LOGO_H = 141

// gHolidayDescriptions: month, day, pipboy.msg id
const HOLIDAYS: [number, number, number][] = [
    [1, 1, 100], [2, 14, 101], [4, 1, 102], [7, 4, 104], [10, 6, 103], [10, 31, 105], [11, 28, 106], [12, 25, 107],
]

export function renderLogoScreen(screen: HTMLElement): void {
    while (screen.firstChild) screen.removeChild(screen.firstChild)
    const logo = document.createElement('img')
    logo.src = assetUrl('art/intrface/pipx.png')
    logo.style.cssText = `position:absolute;left:${LOGO_X}px;top:${LOGO_Y}px;width:${LOGO_W}px;height:${LOGO_H}px;pointer-events:none;`
    screen.appendChild(logo)

    const { month, day } = GameTime.getDate()
    const holiday = HOLIDAYS.find(([m, d]) => m === month && d === day)
    const text = holiday ? getMessage('pipboy', holiday[2]) : null
    if (text) {
        // centred on 6 + logo width / 2 + 323, at y logo height + 174, font 101, colour 992
        const centre = 6 + LOGO_W / 2 + LOGO_X
        const line = document.createElement('div')
        line.style.cssText = `position:absolute;left:${centre - 175}px;top:${LOGO_H + 174}px;width:350px;display:flex;justify-content:center;pointer-events:none;`
        font1.onLoad(() => line.appendChild(font1.renderText(text, CE_COLOR.green)))
        screen.appendChild(line)
    }
}

// PIPBOY_WINDOW_CONTENT_VIEW_X/Y/WIDTH/HEIGHT, PIPBOY_BOMB_COUNT, PIPBOY_RAND_MAX
const VIEW_X = 254
const VIEW_Y = 46
const VIEW_W = 374
const VIEW_H = 410
const BOMB_COUNT = 16
const RAND_MAX = 32767
const BOMB = 65 // bomb1 is 65 × 65
const IDLE_TIMEOUT = 120000

interface Bomb { x: number; y: number; speed: number; acc: number; active: boolean }

// Watches the Pip-Boy for input and runs the screensaver after two idle minutes. Returns
// the function that stops watching (the Pip-Boy closed).
export function watchPipboyIdle(container: HTMLElement): () => void {
    let last = performance.now()
    let saver: { stop: () => void } | null = null
    const activity = () => {
        last = performance.now()
        if (saver) { saver.stop(); saver = null }
    }
    window.addEventListener('mousemove', activity, true)
    window.addEventListener('mousedown', activity, true)
    window.addEventListener('keydown', activity, true)
    const timer = setInterval(() => {
        if (!saver && performance.now() - last > IDLE_TIMEOUT) saver = runScreensaver(container)
    }, 1000)
    return () => {
        clearInterval(timer)
        saver?.stop()
        window.removeEventListener('mousemove', activity, true)
        window.removeEventListener('mousedown', activity, true)
        window.removeEventListener('keydown', activity, true)
    }
}

function runScreensaver(container: HTMLElement): { stop: () => void } {
    const canvas = document.createElement('canvas')
    canvas.width = VIEW_W
    canvas.height = VIEW_H
    canvas.style.cssText = `position:absolute;left:${VIEW_X}px;top:${VIEW_Y}px;width:${VIEW_W}px;height:${VIEW_H}px;z-index:50;pointer-events:none;`
    container.appendChild(canvas)
    const ctx = canvas.getContext('2d')!
    const background = new Image()
    background.src = assetUrl('art/intrface/pip.png')
    const sprite = new Image()
    sprite.src = assetUrl('art/intrface/bomb1.png')

    const bombs: Bomb[] = Array.from({ length: BOMB_COUNT }, () => ({ x: 0, y: 0, speed: 0, acc: 0, active: false }))
    const step = (draw: boolean) => {
        if (randomBetween(0, RAND_MAX) < 3047.3311) {
            const b = bombs.find((x) => !x.active)
            if (b) {
                const span = (350 - Math.trunc(BOMB / 4)) + (406 - Math.trunc(BOMB / 4))
                const v = Math.trunc(randomBetween(0, RAND_MAX) / RAND_MAX * span)
                const edge = VIEW_H - Math.trunc(BOMB / 4)
                if (edge >= v) { b.x = 602; b.y = v + 48 } else { b.x = v - edge + VIEW_X + Math.trunc(BOMB / 4); b.y = VIEW_Y - BOMB + 2 }
                b.active = true
                b.speed = randomBetween(0, RAND_MAX) * (2.75 / RAND_MAX) + 0.15
                b.acc = 0
            }
        }
        if (draw) {
            ctx.clearRect(0, 0, VIEW_W, VIEW_H)
            if (background.complete) ctx.drawImage(background, VIEW_X, VIEW_Y, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H)
        }
        for (const b of bombs) {
            if (!b.active) continue
            if (b.x >= VIEW_X) { if (b.x + BOMB >= 604 && 604 - b.x < 1) b.active = false }
            else if (VIEW_X - b.x >= BOMB) b.active = false
            if (b.y >= VIEW_Y) { if (b.y + BOMB >= 452 && 452 - b.y < 1) b.active = false }
            else if (b.y + BOMB < VIEW_Y) b.active = false
            if (b.active && draw && sprite.complete) {
                ctx.save()
                ctx.beginPath()
                ctx.rect(0, 0, 604 - VIEW_X, 452 - VIEW_Y)
                ctx.clip()
                ctx.drawImage(sprite, b.x - VIEW_X, b.y - VIEW_Y)
                ctx.restore()
            }
            b.acc += b.speed
            if (b.acc >= 1) { b.x = Math.trunc(b.x - b.acc); b.y = Math.trunc(b.y + b.acc); b.acc = 0 }
        }
    }
    // CE runs the first 50 steps without drawing or waiting, then one step every 50 ms
    for (let i = 0; i < 50; i++) step(false)
    const timer = setInterval(() => step(true), 50)
    return { stop: () => { clearInterval(timer); canvas.remove() } }
}
