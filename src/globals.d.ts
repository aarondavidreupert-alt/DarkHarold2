// Debug and test state the engine keeps on `window` (dev console, AutoCrawler, test pages), so it
// is read without `(window as any)` (wiki/code_quality.md Q11). Most of it is free-form debug data.

export {}

declare global {
    interface Window {
        /** test hooks; fastMode skips animations and sounds (AutoCrawler) */
        __test?: { fastMode?: boolean; [hook: string]: unknown }
        /** camera debugging (render/camera.ts, devConsole) */
        borderDebug?: boolean
        scrollLimits?: any
        _bbSide?: any
        mapContentBounds?: any
        objectContentBounds?: any
        scrollBlockerBounds?: any
        /** Safari before 14.1 */
        webkitAudioContext?: typeof AudioContext
        autoCrawler?: any
        Scripting?: unknown
        Config?: unknown
        globalState?: unknown
    }
}
