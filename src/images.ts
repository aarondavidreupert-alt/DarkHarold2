// Copyright 2014-2022 darkf
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import globalState from './globalState.js'
import { Config } from './config.js'

// Paths we already tried to load and got a 404 / decode error.
// Used to skip retries — we DON'T put broken Image objects in
// globalState.images because the WebGL renderer would then try to
// upload a 0x0 texture and crash with "INVALID_VALUE: texImage2D".
const failedImages = new Set<string>()

export function lazyLoadImage(art: string, callback?: (x: HTMLImageElement) => void) {
    if (globalState.images[art] !== undefined) {
        if (callback) {
            callback(globalState.images[art])
        }
        return
    }

    // Already known-bad — don't retry, don't call back (mirrors the original
    // "image not loaded yet" return path; the renderer's own missing-image
    // guard then leaves the sprite invisible until/unless something else
    // resolves it).
    if (failedImages.has(art)) {
        return
    }

    if (globalState.lazyAssetLoadingQueue[art] !== undefined) {
        if (callback) {
            globalState.lazyAssetLoadingQueue[art].push(callback)
        }
        return
    }

    if (Config.engine.doLogLazyLoads) {
        console.log('lazy loading ' + art + '...')
    }

    globalState.lazyAssetLoadingQueue[art] = callback ? [callback] : []

    const img = new Image()
    img.onload = function () {
        globalState.images[art] = img
        const callbacks = globalState.lazyAssetLoadingQueue[art]
        if (callbacks !== undefined) {
            for (let i = 0; i < callbacks.length; i++) {
                callbacks[i](globalState.images[art])
            }
            globalState.lazyAssetLoadingQueue[art] = undefined
        }
    }
    img.onerror = function () {
        // Without this, missing PNGs leave queued callbacks pending forever
        // (the image never resolves, the critter stays mid-anim, tile goes
        // black). Mark as failed and drop pending callbacks — do NOT store
        // the 0x0 broken image in globalState.images, the renderer would
        // try to upload it as a texture and crash WebGL.
        console.warn(`[lazyLoadImage] failed to load ${art}.png`)
        failedImages.add(art)
        globalState.lazyAssetLoadingQueue[art] = undefined
    }
    img.src = art + '.png'
}
