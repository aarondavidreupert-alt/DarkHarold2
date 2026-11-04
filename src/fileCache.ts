// Files fetched ahead of time, for the synchronous loaders (util.ts getFileText /
// getFileBinarySync / fileExistsSync, aiPackets.ts). Engine code that CE runs synchronously
// (a script asking for its .msg file, a map loading its scripts) stays synchronous; the files it
// will need are fetched asynchronously before (main.ts at boot, map/prefetch.ts before a map
// load), so the synchronous call is answered from memory instead of a blocking XMLHttpRequest.
// A file nobody prefetched still loads with a synchronous request (wiki/code_quality.md Q13).
// No imports: aiPackets.ts and util.ts both use it.

interface Prefetched {
    status: number
    bytes: Uint8Array
}

const files = new Map<string, Prefetched>()
let syncFallbacks = 0

/** Fetch `paths` (keys as the loaders spell them; `urlFor` maps a path to the URL to fetch, e.g.
 *  an active mod's copy) and keep them for the synchronous loaders. A path already held is
 *  skipped. A failed request is not kept: the loader then requests it itself. */
export async function prefetchFiles(paths: string[], urlFor: (path: string) => string = (p) => p): Promise<void> {
    await Promise.all(
        [...new Set(paths)]
            .filter((p) => !files.has(p))
            .map(async (p) => {
                try {
                    const response = await fetch(urlFor(p))
                    files.set(p, { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) })
                } catch {
                    // network error: the synchronous loader tries again and reports it
                }
            }),
    )
}

/** The prefetched file: its HTTP status and body, or undefined (then load it synchronously). */
export function prefetched(path: string): Prefetched | undefined {
    const file = files.get(path)
    if (!file) {
        syncFallbacks++
    }
    return file
}

/** Text of a prefetched body, decoded as XMLHttpRequest.responseText does for these files (UTF-8). */
export function prefetchedText(file: Prefetched): string {
    return new TextDecoder().decode(file.bytes)
}

/** How many loads found nothing prefetched (debug: wiki/code_quality.md Q13). */
export function syncFallbackCount(): number {
    return syncFallbacks
}
