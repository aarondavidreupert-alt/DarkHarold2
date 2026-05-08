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

/**
 * Load an image lazily. Callback is invoked once the image has finished loading,
 * with the loaded HTMLImageElement OR null if the load failed (e.g. 404).
 * Callers that care about success must check globalState.imageInfo[art] !==
 * undefined OR test the image argument for truthiness.
 */
export function lazyLoadImage(art: string, callback?: (x: HTMLImageElement | null) => void) {
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

    const drain = (img: HTMLImageElement | null) => {
        const callbacks = globalState.lazyAssetLoadingQueue[art]
        if (callbacks !== undefined) {
            for (let i = 0; i < callbacks.length; i++) {
                callbacks[i](img as any)
            }
            globalState.lazyAssetLoadingQueue[art] = undefined
        }
    }

    const img = new Image()
    img.onload = function () {
        globalState.images[art] = img
        drain(img)
    }
    img.onerror = function () {
        // Image not present in the asset set (e.g. FRM not exported by exportImagesPar.py).
        // Drain pending callbacks with null so awaiters can fall through gracefully.
        drain(null)
    }
    img.src = art + '.png'
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
