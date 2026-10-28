// Loaded game data and caches: images and their frame layout, protos, message files, the asset
// loading counters (wiki/code_quality.md Q15). A leaf module; globalState.ts keeps a getter /
// setter for every field.

import type { CycleMask } from '../colorCycle.js'
import type { ImageInfo } from '../globalState.js'
import type { Proto } from '../protoTypes.js'

export const assets = {
    images: {} as { [name: string]: HTMLImageElement }, // Image cache
    // undefined = cycle mask fetch not yet started/complete; null = no cycling pixels; CycleMask = animated
    cycleMasks: {} as { [name: string]: CycleMask | null | undefined },
    imageInfo: null as { [art: string]: ImageInfo } | null, // art/imageMap.json: frame counts, FPS, offsets
    proMap: null as { [type: string]: { [id: number]: Proto } } | null, // proto/pro.json, by type name then proto id
    messageFiles: {} as { [msgFile: string]: { [msgID: string]: string } },
    loadingAssetsLoaded: 0, // how many images we've loaded
    loadingAssetsTotal: 0, // out of this total
    loadingLoadedCallback: null as (() => void) | null, // loaded callback
    // set of lazily-loaded assets being loaded
    lazyAssetLoadingQueue: {} as { [name: string]: ((img: any) => void)[] | undefined },
    tempCanvas: null as HTMLCanvasElement | null, // temporary canvas used for detecting single pixels
    tempCanvasCtx: null as CanvasRenderingContext2D | null, // and the context for it
}
