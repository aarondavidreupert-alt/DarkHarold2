// AutoCrawler — combat crawler.

import { Combat, isCombatActive } from '../combat.js'
import { Config } from '../config.js'
import globalState from '../globalState.js'
import { Critter } from '../object.js'
import { toTileNum } from '../tile.js'
import { buildReport, printSummary } from './report.js'
import {
    AI_TURN_TIMEOUT_MS,
    COMBAT_ACTIVE_TIMEOUT_MS,
    CRAWLER_HP,
    PLAYER_TURN_TIMEOUT_MS,
    critterDisplayName,
    listHostileCritters,
    movePlayerAdjacent,
    setLastReport,
    waitFor,
} from './shared.js'
import type { CombatCritterResult, CrawlerReport } from './types.js'

async function crawlOneCritter(critter: Critter): Promise<CombatCritterResult> {
    const t0 = performance.now()
    const result: CombatCritterResult = {
        uid: critter.uid,
        name: critterDisplayName(critter),
        tileNum: toTileNum(critter.position),
        status: 'ok',
        turnsObserved: 0,
        aiBailout: false,
        durationMs: 0,
    }

    const player = globalState.player!

    // Snapshot HP before boosting so we can restore it after the encounter.
    const prevHP = player.stats.getBase('HP')
    player.stats.setBase('HP', CRAWLER_HP)

    if (!movePlayerAdjacent(critter)) {
        player.stats.setBase('HP', prevHP)
        result.status = 'no-adjacent-tile'
        result.durationMs = performance.now() - t0
        return result
    }

    // Snapshot hostile flags — include the target critter so its original value
    // is restored in finally even if it was naturally hostile before the crawl.
    const hostileSnapshots: Array<{ c: Critter; was: boolean }> = [
        { c: critter, was: critter.hostile },
    ]
    for (const obj of globalState.gMap!.getObjects()) {
        if (obj instanceof Critter && !obj.isPlayer && obj !== critter) {
            hostileSnapshots.push({ c: obj, was: obj.hostile })
            obj.hostile = false
        }
    }
    critter.hostile = true

    // Snapshot fastMode before the try block so the finally clause can restore it.
    const _prevFastMode: boolean = (window as any).__test?.fastMode ?? false

    // Restore HP and hostile flags no matter which return path is taken.
    try {
        // Wait for any previous forceEnd() to fully settle.
        // forceEnd() defers combatActive=false via Promise.resolve().then(), so we
        // need at least one microtask tick here.
        if (!await waitFor(() => !isCombatActive(), COMBAT_ACTIVE_TIMEOUT_MS)) {
            result.status = 'stuck-combat-active'
            result.durationMs = performance.now() - t0
            return result
        }

        // Snapshot the event log so we can detect AI bail-outs introduced by this encounter.
        const logLenBefore = globalState.eventLog.length

        // Enable fastMode so animations complete in zero real time during the crawl.
        ;(window as any).__test = (window as any).__test ?? {}
        ;(window as any).__test.fastMode = true

        // Start combat in NPC-initiated mode (forceTurn = critter).
        // This limits team enrollment to: player's team + critter's team.
        try {
            Combat.start(critter)
        } catch (e) {
            result.status = 'exception-on-start'
            result.error = String(e)
            // Combat.start may have set combatActive before throwing; clean up so
            // the next crawl doesn't immediately get stuck-combat-active.
            if (isCombatActive()) {
                try { globalState.combat?.forceEnd() } catch { /* ignore */ }
                await waitFor(() => !isCombatActive(), COMBAT_ACTIVE_TIMEOUT_MS)
            }
            result.durationMs = performance.now() - t0
            return result
        }

        if (!await waitFor(() => globalState.inCombat === true, COMBAT_ACTIVE_TIMEOUT_MS)) {
            result.status = 'stuck-no-combat'
            result.durationMs = performance.now() - t0
            return result
        }

        // With forceTurn = critter, the NPC acts first. Wait for the player's first turn.
        const gotPlayerTurn = await waitFor(
            () => (globalState.combat?.inPlayerTurn === true) || !globalState.inCombat,
            PLAYER_TURN_TIMEOUT_MS
        )
        if (!gotPlayerTurn) {
            result.status = 'stuck-player-turn-timeout'
            const _ptActive = (globalState.combat as any)?.combatants?.[(globalState.combat as any)?.whoseTurn]
            if (_ptActive) {
                console.warn(`[AutoCrawler] stuck-player-turn-timeout: active uid=${_ptActive.uid} name="${_ptActive.name}" inAnim=${_ptActive.inAnim?.()}`)
            }
            if (globalState.combat) globalState.combat.forceEnd()
            await waitFor(() => !isCombatActive(), COMBAT_ACTIVE_TIMEOUT_MS)
            result.durationMs = performance.now() - t0
            return result
        }

        if (!globalState.inCombat) {
            // Combat ended naturally (critter fled or died before player's turn).
            result.notes = 'combat ended before player turn'
            result.durationMs = performance.now() - t0
            return result
        }

        result.turnsObserved++

        // End the player's turn — equivalent to pressing "End Turn".
        try {
            globalState.combat!.nextTurn()
        } catch (e) {
            result.status = 'exception-in-combat'
            result.error = String(e)
            if (globalState.combat) globalState.combat.forceEnd()
            await waitFor(() => !isCombatActive(), COMBAT_ACTIVE_TIMEOUT_MS)
            result.durationMs = performance.now() - t0
            return result
        }

        // Wait for AI turns to complete and the player's next turn to start,
        // or for combat to end naturally (all enemies dead / fled).
        const aiDone = await waitFor(
            () => (globalState.combat?.inPlayerTurn === true) || !globalState.inCombat,
            AI_TURN_TIMEOUT_MS
        )
        if (!aiDone) {
            result.status = 'stuck-ai-turn-timeout'
            const _aiActive = (globalState.combat as any)?.combatants?.[(globalState.combat as any)?.whoseTurn]
            if (_aiActive) {
                console.warn(`[AutoCrawler] stuck-ai-turn-timeout: active uid=${_aiActive.uid} name="${_aiActive.name}" inAnim=${_aiActive.inAnim?.()}`)
            }
        } else if (globalState.inCombat) {
            result.turnsObserved++
        }

        // Check for AI recursion bail-outs in the entries added during this encounter.
        const newEntries = globalState.eventLog.slice(logLenBefore)
        result.aiBailout = newEntries.some(e => (e as any).action === 'ai-bailout')
        if (result.aiBailout) {
            result.notes = (result.notes ? result.notes + '; ' : '') + 'AI recursion bail-out detected'
        }

        // Force-end combat regardless of state.
        if (globalState.inCombat) {
            try { globalState.combat!.forceEnd() } catch { /* ignore */ }
            await waitFor(() => !isCombatActive(), COMBAT_ACTIVE_TIMEOUT_MS)
        }

        result.durationMs = performance.now() - t0
        return result
    } finally {
        if ((window as any).__test) (window as any).__test.fastMode = _prevFastMode
        player.stats.setBase('HP', prevHP)
        for (const snap of hostileSnapshots) snap.c.hostile = snap.was
    }
}

export async function runCombatCrawler(mapName?: string): Promise<CrawlerReport | null> {
    if (!Config.engine.debug) {
        console.error('[AutoCrawler] Config.engine.debug must be true')
        return null
    }
    if (!globalState.gMap || !globalState.player) {
        console.error('[AutoCrawler] No active map/player — start a game first')
        return null
    }

    if (mapName) {
        console.log(`[AutoCrawler] Loading map: ${mapName}`)
        globalState.gMap.loadMap(mapName)
        if (!await waitFor(() => !globalState.isLoading, 30000)) {
            console.error('[AutoCrawler] Map load timed out — aborting')
            return null
        }
    }

    const critters = listHostileCritters()
    const mapLabel = globalState.gMap.name ?? 'unknown'
    console.log(`[AutoCrawler] Combat crawl on "${mapLabel}": ${critters.length} target(s)`)

    const prevCombat = Config.scripting.debugLogShowType.combat
    const prevAI = Config.scripting.debugLogShowType.ai
    Config.scripting.debugLogShowType.combat = false
    Config.scripting.debugLogShowType.ai = false

    const results: CombatCritterResult[] = []
    try {
        for (const critter of critters) {
            console.log(`[AutoCrawler]   Critter uid=${critter.uid} "${critterDisplayName(critter)}"`)
            const r = await crawlOneCritter(critter)
            results.push(r)
            setLastReport(buildReport('combat', mapLabel, results))
            console.log(
                `[AutoCrawler]     → status=${r.status}  turns=${r.turnsObserved}` +
                `  bailout=${r.aiBailout}  ${r.durationMs.toFixed(0)}ms` +
                (r.notes ? `  (${r.notes})` : '')
            )
            await new Promise<void>(r2 => setTimeout(r2, 20))
        }
    } finally {
        Config.scripting.debugLogShowType.combat = prevCombat
        Config.scripting.debugLogShowType.ai = prevAI
    }

    const report = buildReport('combat', mapLabel, results)
    printSummary(report)
    setLastReport(report)
    return report
}
