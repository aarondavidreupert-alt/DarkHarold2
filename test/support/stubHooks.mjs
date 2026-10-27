// Module resolution hooks (node:module register): js/logger.js and js/globalState.js -> stubs.
const STUBS = {
    '/js/logger.js': new URL('./stubLogger.mjs', import.meta.url).href,
    '/js/globalState.js': new URL('./stubGlobalState.mjs', import.meta.url).href,
}

export async function resolve(specifier, context, nextResolve) {
    const result = await nextResolve(specifier, context)
    for (const [suffix, stub] of Object.entries(STUBS)) {
        if (result.url.endsWith(suffix)) return { url: stub, shortCircuit: true }
    }
    return result
}
