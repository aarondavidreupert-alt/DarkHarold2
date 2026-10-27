/*
Copyright 2026

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

// Black screen over a map change.
//
// CE map.cc mapLoad: isoDisable() blanks the game view while the map loads and
// isoEnable() shows it once everything is in place; entering from the worldmap fades
// the palette to black and back (worldmap.cc wmFadeOut / wmFadeIn → paletteFadeTo).
// CE loads synchronously, so the first picture is complete. DH2 keeps drawing while
// textures arrive (critter animations load lazily, WebGL uploads and the floor bake
// happen on the first frames), so the view stays black until nothing is loading any
// more and a few frames have been drawn, then fades in.

import globalState from './globalState.js'
import { heart } from './heart.js'
import * as Events from './events.js'

const FADE_IN_MS = 250 // ≈ CE paletteFadeTo
const SETTLE_FRAMES = 3 // frames drawn after loading went quiet
const MAX_BLACK_MS = 5000 // never keep the screen black longer than this

let overlay: HTMLDivElement | null = null
let token = 0

function busy(): boolean {
    return (
        globalState.isLoading ||
        Object.values(globalState.lazyAssetLoadingQueue ?? {}).some((v) => v !== undefined) ||
        (heart._imagesLoading?.length ?? 0) > 0
    )
}

/** Black at once (isoDisable / wmFadeOut). */
export function beginMapFade(): void {
    if (typeof document === 'undefined') return
    token++
    if (!overlay) {
        overlay = document.createElement('div')
        overlay.id = 'mapFadeOverlay'
        Object.assign(overlay.style, {
            position: 'fixed',
            inset: '0',
            background: '#000',
            pointerEvents: 'none',
            zIndex: '9000',
        })
        document.body.appendChild(overlay)
    }
    overlay.style.transition = 'none'
    overlay.style.opacity = '1'
    // A load that fails before its end (missing map file, no save) must not leave the
    // screen black.
    const my = token
    setTimeout(() => {
        if (my === token && overlay && overlay.style.opacity === '1') endMapFade()
    }, 2 * MAX_BLACK_MS)
}

/** Fade in once the map has finished loading and drawing (isoEnable / wmFadeIn). */
export function endMapFade(): void {
    if (!overlay) return
    const my = token
    const start = performance.now()
    let quietFrames = 0
    let lastFrames = heart._numFrames ?? 0
    const poll = () => {
        if (my !== token || !overlay) return // a newer map change took over
        const frames = heart._numFrames ?? 0
        if (busy()) quietFrames = 0
        else if (frames !== lastFrames) quietFrames++
        lastFrames = frames
        if (quietFrames >= SETTLE_FRAMES || performance.now() - start > MAX_BLACK_MS) {
            const el = overlay
            el.style.transition = `opacity ${FADE_IN_MS}ms linear`
            el.style.opacity = '0'
            setTimeout(() => {
                if (my === token && overlay === el) {
                    el.remove()
                    overlay = null
                }
            }, FADE_IN_MS + 50)
            return
        }
        setTimeout(poll, 16)
    }
    setTimeout(poll, 16)
}

Events.on('loadMapPre', beginMapFade)
Events.on('loadMapPost', endMapFade)
