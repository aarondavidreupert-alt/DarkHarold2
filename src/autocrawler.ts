// AutoCrawler — automated dialogue and combat test harness.
//
// Usage from browser DevTools:
//   autoCrawler.runDialogueCrawler()           // crawl current map
//   autoCrawler.runDialogueCrawler('artemple') // load map then crawl
//   autoCrawler.runCombatCrawler()
//   autoCrawler.downloadReport()               // download lastReport (no arg needed)
//   autoCrawler.downloadReport(report)         // download a specific report
//   autoCrawler.lastReport                     // access last completed report
//
// Design: see AutoCrawler.md in the project root.
//
// This file is a BARREL — the implementation lives in `autocrawler/`:
//   types.ts    — DialogueStatus, CombatStatus, MapStatus, result interfaces
//   shared.ts   — constants, lastReport binding, engine/DOM/dialogue helpers
//   dialogue.ts — runDialogueCrawler + crawlOneNpc
//   combat.ts   — runCombatCrawler + crawlOneCritter
//   maps.ts     — runMapCrawler + discoverMapNames + crawlOneMap
//   report.ts   — buildReport, printSummary, downloadReport

import { Config } from './config.js'
import globalState from './globalState.js'
import { runCombatCrawler } from './autocrawler/combat.js'
import { runDialogueCrawler } from './autocrawler/dialogue.js'
import { runMapCrawler } from './autocrawler/maps.js'
import { downloadReport } from './autocrawler/report.js'
import { getLastReport, listHostileCritters, listTalkableNPCs, waitFor } from './autocrawler/shared.js'

// Public surface re-exports.
export { runDialogueCrawler } from './autocrawler/dialogue.js'
export { runCombatCrawler } from './autocrawler/combat.js'
export { runMapCrawler } from './autocrawler/maps.js'
export { downloadReport } from './autocrawler/report.js'
export { listTalkableNPCs, listHostileCritters } from './autocrawler/shared.js'
export type {
    DialogueStatus,
    CombatStatus,
    MapStatus,
    MapResult,
    DialogueNpcResult,
    CombatCritterResult,
    CrawlerSummary,
    CrawlerReport,
} from './autocrawler/types.js'

import type { CrawlerReport } from './autocrawler/types.js'

// ─── Window exposure ──────────────────────────────────────────────────────────

if (typeof window !== 'undefined' && Config.engine.debug) {
    ;(window as any).autoCrawler = {
        runDialogueCrawler,
        runCombatCrawler,
        runMapCrawler,
        listTalkableNPCs,
        listHostileCritters,
        downloadReport,
        get lastReport(): CrawlerReport | null { return getLastReport() },
    }

    // URL auto-start: play.html?crawl=maps  |  ?crawl=dialogue  |  ?crawl=combat
    // init.ts skips the map-from-query load when ?crawl= is present, so the
    // default map (artemple) loads normally. We wait for it to finish then run.
    const _crawlParam = new URLSearchParams(location.search).get('crawl')
    if (_crawlParam === 'maps' || _crawlParam === 'dialogue' || _crawlParam === 'combat') {
        waitFor(
            () => globalState.gMap !== null && globalState.player !== null && !globalState.isLoading,
            30000
        ).then(ready => {
            if (!ready) {
                console.error('[AutoCrawler] Timed out waiting for game to initialise')
                return
            }
            if (_crawlParam === 'maps') runMapCrawler()
            else if (_crawlParam === 'dialogue') runDialogueCrawler()
            else if (_crawlParam === 'combat') runCombatCrawler()
        })
    }
}
