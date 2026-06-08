// AutoCrawler — report builders and download.

import { getLastReport } from './shared.js'
import type {
    CombatCritterResult,
    CrawlerReport,
    DialogueNpcResult,
    MapResult,
} from './types.js'

export function buildReport(
    type: 'dialogue' | 'combat' | 'maps',
    mapLabel: string,
    results: DialogueNpcResult[] | CombatCritterResult[] | MapResult[]
): CrawlerReport {
    // Cast to a shared base so TypeScript can unify the union for counting.
    const any = results as Array<{ status: string }>
    const ok = any.filter(r => r.status === 'ok').length
    const exceptions = any.filter(r => r.status === 'exception' || r.status.startsWith('exception-')).length
    const stuck = any.filter(r => r.status.startsWith('stuck')).length
    const combatTriggered =
        type === 'dialogue'
            ? (results as DialogueNpcResult[]).filter(r => r.status === 'combat-triggered').length
            : undefined
    const noDialogue =
        type === 'dialogue'
            ? (results as DialogueNpcResult[]).filter(r => r.status === 'no-dialogue').length
            : undefined
    const timeout =
        type === 'maps'
            ? (results as MapResult[]).filter(r => r.status === 'load-timeout').length
            : undefined
    const playerMissing =
        type === 'maps'
            ? (results as MapResult[]).filter(r => r.status === 'player-missing').length
            : undefined

    return {
        map: mapLabel,
        type,
        timestamp: Date.now(),
        results,
        summary: { total: results.length, ok, stuck, exceptions, combatTriggered, noDialogue, timeout, playerMissing },
    }
}

export function printSummary(report: CrawlerReport): void {
    const s = report.summary
    const extras: string[] = []
    if (s.combatTriggered !== undefined) extras.push(`combat-triggered=${s.combatTriggered}`)
    if (s.noDialogue !== undefined) extras.push(`no-dialogue=${s.noDialogue}`)
    if (s.timeout !== undefined) extras.push(`timeout=${s.timeout}`)
    if (s.playerMissing !== undefined) extras.push(`player-missing=${s.playerMissing}`)
    const extra = extras.map(e => `  ${e}`).join('')
    console.log(
        `[AutoCrawler] ── ${report.type.toUpperCase()} DONE on "${report.map}" ──\n` +
        `  total=${s.total}  ok=${s.ok}  stuck=${s.stuck}  exceptions=${s.exceptions}${extra}`
    )
}

/** Download a report as a timestamped JSON file.
 *  If called with no argument, downloads the most recent completed report. */
export function downloadReport(report?: CrawlerReport | null): void {
    const r = report ?? getLastReport()
    if (!r) {
        console.warn('[AutoCrawler] No report to download — run a crawl first.')
        return
    }
    const json = JSON.stringify(r, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `crawler_${r.type}_${r.map}_${r.timestamp}.json`
    a.click()
    URL.revokeObjectURL(url)
}
