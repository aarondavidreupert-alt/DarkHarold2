// AutoCrawler — map smoke-test crawler.

import { isCombatActive } from '../combat.js'
import { Config } from '../config.js'
import globalState from '../globalState.js'
import { eventLogClear } from '../logger.js'
import { Scripting } from '../scripting.js'
import { UIMode } from '../ui.js'
import { buildReport, printSummary } from './report.js'
import {
    COMBAT_ACTIVE_TIMEOUT_MS,
    MAP_LOAD_TIMEOUT_MS,
    setLastReport,
    waitFor,
} from './shared.js'
import type { CrawlerReport, MapResult } from './types.js'

// Fetch the maps/ directory listing and return all base map names.
// Relies on the dev server serving directory listings (standard for local dev).
async function discoverMapNames(): Promise<string[]> {
    try {
        const res = await fetch('maps/')
        if (!res.ok) return []
        const html = await res.text()
        const names = new Set<string>()
        for (const m of html.matchAll(/href="([^"]+\.json)"/g)) {
            const filename = (m[1].split('/').pop() ?? '').replace(/^.*\//, '')
            if (!filename.endsWith('.images.json')) {
                names.add(filename.replace(/\.json$/, ''))
            }
        }
        return [...names].sort()
    } catch (e) {
        console.warn('[AutoCrawler] discoverMapNames failed:', e)
        return []
    }
}

async function crawlOneMap(mapName: string): Promise<MapResult> {
    const t0 = performance.now()
    const result: MapResult = { map: mapName, status: 'ok', durationMs: 0 }

    // Reset leftover state from the previous map before loading the next one.
    if (globalState.inCombat) {
        globalState.combat?.forceEnd()
        await waitFor(() => !isCombatActive(), COMBAT_ACTIVE_TIMEOUT_MS)
    }
    if (globalState.uiMode !== UIMode.none) {
        try { Scripting.dialogueEnd() } catch { /* ignore */ }
        await new Promise<void>(r => setTimeout(r, 0))
    }

    // Clear event log so this map's entries don't bleed into the previous map's
    // snapshot. eventLogPush() is unconditional (flag-independent), so combat/AI
    // events are always captured regardless of Config.scripting.debugLogShowType.
    eventLogClear()

    try {
        globalState.gMap!.loadMap(mapName)
    } catch (e) {
        result.status = 'exception'
        result.error = String(e)
        result.stack = e instanceof Error ? e.stack : undefined
        result.eventLog = [...globalState.eventLog]
        result.durationMs = performance.now() - t0
        return result
    }

    let loaded: boolean
    try {
        loaded = await waitFor(() => !globalState.isLoading, MAP_LOAD_TIMEOUT_MS)
    } catch (e) {
        result.status = 'exception'
        result.error = String(e)
        result.stack = e instanceof Error ? e.stack : undefined
        result.eventLog = [...globalState.eventLog]
        result.durationMs = performance.now() - t0
        return result
    }
    if (!loaded) {
        result.status = 'load-timeout'
        result.eventLog = [...globalState.eventLog]
        result.durationMs = performance.now() - t0
        return result
    }

    const pos = globalState.player?.position
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') {
        result.status = 'player-missing'
        result.eventLog = [...globalState.eventLog]
    }

    result.durationMs = performance.now() - t0
    return result
}

export async function runMapCrawler(): Promise<CrawlerReport | null> {
    if (!Config.engine.debug) {
        console.error('[AutoCrawler] Config.engine.debug must be true')
        return null
    }
    if (!globalState.gMap || !globalState.player) {
        console.error('[AutoCrawler] No active map/player — start a game first')
        return null
    }

    const mapNames = await discoverMapNames()
    if (mapNames.length === 0) {
        console.error('[AutoCrawler] No maps discovered — ensure maps/ serves a directory listing')
        return null
    }
    console.log(`[AutoCrawler] Starting crawl of ${mapNames.length} maps...`)

    const results: MapResult[] = []
    for (let i = 0; i < mapNames.length; i++) {
        const mapName = mapNames[i]
        const tag = `[${i + 1}/${mapNames.length}]`
        console.log(`[AutoCrawler] ${tag} Loading map: ${mapName}...`)
        let r: MapResult
        try {
            r = await crawlOneMap(mapName)
        } catch (e) {
            r = { map: mapName, status: 'exception', durationMs: 0, error: String(e),
                  stack: e instanceof Error ? e.stack : undefined }
        }
        results.push(r)
        // Attach failures at the top of every incremental snapshot so
        // downloadReport() during a crawl also produces a navigable file.
        const partial = buildReport('maps', '*', results)
        partial.failures = results.filter(r2 => r2.status !== 'ok')
        setLastReport(partial)
        console.log(
            `[AutoCrawler] ${tag} ${mapName} → ${r.status} (${Math.round(r.durationMs)}ms)` +
            (r.error ? ': ' + r.error : '')
        )
        await new Promise<void>(r2 => setTimeout(r2, 20))
    }

    const report = buildReport('maps', '*', results)
    report.failures = results.filter(r => r.status !== 'ok')
    printSummary(report)
    setLastReport(report)
    const s = report.summary
    const parts: string[] = [`${s.ok} ok`]
    if (s.exceptions > 0) parts.push(`${s.exceptions} exception${s.exceptions !== 1 ? 's' : ''}`)
    if ((s.timeout ?? 0) > 0) parts.push(`${s.timeout} timeout`)
    if (s.stuck > 0) parts.push(`${s.stuck} stuck`)
    if ((s.playerMissing ?? 0) > 0) parts.push(`${s.playerMissing} player-missing`)
    console.log(`[AutoCrawler] Crawl complete. ${parts.join(', ')} of ${s.total} total.`)
    return report
}
