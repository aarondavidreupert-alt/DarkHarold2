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

// CE game.cc showSplash — the start-up splash: art/splash/splash<n>.rix (RIX3: width and
// height as int16 after the tag, the 6-bit palette at offset 10, then the pixels), centred,
// faded in from black; n is [system] splash, and the next start shows the next one (CE
// writes splash + 1 back to fallout2.cfg; DH2 keeps it in localStorage).

import { getFileBinarySync } from './util.js'

const SPLASH_COUNT = 7
const STORAGE_KEY = 'dh2.splash'

function loadSplash(index: number): { canvas: HTMLCanvasElement; next: number } | null {
    let n = index
    for (let tries = 0; tries < SPLASH_COUNT; tries++) {
        let dv: DataView | null = null
        try {
            dv = getFileBinarySync(`data/art/splash/splash${n}.rix`)
        } catch {
            dv = null
        }
        if (
            dv &&
            dv.byteLength > 778 &&
            String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) === 'RIX3'
        ) {
            const w = dv.getInt16(4, true)
            const h = dv.getInt16(6, true)
            const canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext('2d')!
            const img = ctx.createImageData(w, h)
            for (let i = 0; i < w * h && 778 + i < dv.byteLength; i++) {
                const c = dv.getUint8(778 + i) * 3 + 10
                img.data[i * 4] = Math.min(255, dv.getUint8(c) * 4)
                img.data[i * 4 + 1] = Math.min(255, dv.getUint8(c + 1) * 4)
                img.data[i * 4 + 2] = Math.min(255, dv.getUint8(c + 2) * 4)
                img.data[i * 4 + 3] = 255
            }
            ctx.putImageData(img, 0, 0)
            return { canvas, next: n + 1 }
        }
        n = (n + 1) % SPLASH_COUNT
    }
    return null
}

let overlay: HTMLElement | null = null

/** The browser plays a movie with sound only after a user gesture. Without one yet, the
 *  splash ("Please stand by") asks for a click and resolves once it is over (on the
 *  mouse-up / key-up, so the same click can't skip the movie that follows); with one
 *  already, or no splash, at once. */
export function waitForSplashClick(): Promise<void> {
    const active = (navigator as any).userActivation?.hasBeenActive ?? true
    if (active || !overlay) return Promise.resolve()
    const label = document.createElement('div')
    label.textContent = '[click to play]'
    label.style.cssText =
        'position:absolute;left:0;bottom:24px;width:100%;text-align:center;color:#fcfcfc;font:12px monospace;text-shadow:1px 1px 0 #000;'
    overlay.appendChild(label)
    overlay.style.cursor = 'pointer'
    return new Promise((resolve) => {
        const done = (e: Event) => {
            e.preventDefault()
            e.stopPropagation()
            document.removeEventListener('mouseup', done, true)
            document.removeEventListener('keyup', done, true)
            label.remove()
            if (overlay) overlay.style.cursor = ''
            resolve()
        }
        document.addEventListener('mouseup', done, true)
        document.addEventListener('keyup', done, true)
    })
}

/** Takes the splash away (the first movie or the main menu is up). */
export function hideSplash(): void {
    overlay?.remove()
    overlay = null
}

/** Shows the splash while the game loads. */
export function showSplash(): void {
    let index = 0
    try {
        index = Math.max(0, parseInt(localStorage.getItem(STORAGE_KEY) ?? '0', 10) || 0) % SPLASH_COUNT
    } catch {
        /* private mode */
    }
    const splash = loadSplash(index)
    if (!splash) return
    try {
        localStorage.setItem(STORAGE_KEY, String(splash.next % SPLASH_COUNT))
    } catch {
        /* private mode */
    }
    overlay = document.createElement('div')
    overlay.style.cssText =
        'position:fixed;left:0;top:0;width:100%;height:100%;background:#000;z-index:5000;display:flex;align-items:center;justify-content:center;'
    splash.canvas.style.cssText = 'opacity:0;transition:opacity 700ms linear;image-rendering:pixelated;'
    overlay.appendChild(splash.canvas)
    document.body.appendChild(overlay)
    // paletteFadeTo from black (CE's fade takes about 700 ms)
    requestAnimationFrame(() => {
        splash.canvas.style.opacity = '1'
    })
}
