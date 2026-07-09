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
import { parsePNGCycleMask } from './colorCycle.js'

// CE ref: cycle.cc — cycling palette entries only appear in tiles, scenery, and misc art.
// Critters, interfaces, items, heads, and skilldex never use indices 229-254.
function mightHaveCyclingPixels(art: string): boolean {
    return art.startsWith('art/tiles/') || art.startsWith('art/scenery/') || art.startsWith('art/misc/')
}

export function lazyLoadImage(art: string, callback?: (x: HTMLImageElement) => void) {
    if (globalState.images[art] !== undefined) {
        if (callback) {
            callback(globalState.images[art])
        }
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
    img.src = art + '.png'

    // Fetch cycle mask for art that might use animated palette entries (229-254).
    // Async; cycle mask textures upload lazily on first draw after this resolves.
    if (mightHaveCyclingPixels(art) && globalState.cycleMasks[art] === undefined) {
        parsePNGCycleMask(art + '.png').then(mask => {
            globalState.cycleMasks[art] = mask  // null = no cycling pixels
        })
    }
}

/**
 * Promise-returning variant of lazyLoadImage. Resolves to true if the image
 * loaded successfully (and imageInfo is populated), false on 404/error.
 */
export function artExists(art: string): Promise<boolean> {
    return new Promise(resolve => {
        lazyLoadImage(art, (img) => {
            resolve(img !== null && globalState.imageInfo[art] !== undefined)
        })
    })
}
