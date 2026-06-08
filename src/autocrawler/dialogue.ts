// AutoCrawler — NPC dialogue crawler.

import { isCombatActive } from '../combat.js'
import { Config } from '../config.js'
import globalState from '../globalState.js'
import { Critter } from '../object.js'
import { Scripting } from '../scripting.js'
import { toTileNum } from '../tile.js'
import { UIMode, uiEndDialogue } from '../ui.js'
import { buildReport, printSummary } from './report.js'
import {
    COMBAT_ACTIVE_TIMEOUT_MS,
    DIALOGUE_OPEN_TIMEOUT_MS,
    DIALOGUE_POLL_MS,
    MAX_DIALOGUE_CLICKS,
    critterDisplayName,
    getOptionElements,
    getReplyText,
    isExitOption,
    listTalkableNPCs,
    movePlayerAdjacent,
    setLastReport,
    stepEngine,
    waitFor,
} from './shared.js'
import type { CrawlerReport, DialogueNpcResult, DialogueStatus } from './types.js'

async function crawlOneNpc(npc: Critter): Promise<DialogueNpcResult> {
    const t0 = performance.now()
    const result: DialogueNpcResult = {
        uid: npc.uid,
        name: critterDisplayName(npc),
        tileNum: toTileNum(npc.position),
        status: 'ok',
        optionsSeen: 0,
        optionLabels: [],
        replies: [],
        durationMs: 0,
    }

    if (!npc._script || typeof npc._script.talk_p_proc !== 'function') {
        result.status = 'no-talk-proc'
        result.durationMs = performance.now() - t0
        return result
    }

    if (!movePlayerAdjacent(npc)) {
        result.status = 'no-adjacent-tile'
        result.durationMs = performance.now() - t0
        return result
    }

    // Trigger the NPC's talk procedure.
    try {
        Scripting.talk(npc._script, npc)
    } catch (e) {
        result.status = 'exception-on-talk'
        result.error = String(e)
        result.durationMs = performance.now() - t0
        return result
    }

    // Immediately check whether the talk proc triggered combat (rare but possible).
    if (globalState.inCombat) {
        result.status = 'combat-triggered'
        globalState.combat?.forceEnd()
        await waitFor(() => !isCombatActive(), COMBAT_ACTIVE_TIMEOUT_MS)
        result.durationMs = performance.now() - t0
        return result
    }

    // Dialogue opens synchronously for most NPCs (VM halts at gsay_end before
    // Scripting.talk() returns). Poll every DIALOGUE_POLL_MS ms: if UIMode is
    // still UIMode.none we know no dialogue proc fired — bail with 'no-dialogue'
    // rather than burning the full 5 s cap. Keep the hard cap for scripts that
    // open dialogue asynchronously or that stall mid-transition.
    let dialogueOpened = false
    let openStatus: DialogueStatus = 'stuck-no-dialogue'
    const openDeadline = performance.now() + DIALOGUE_OPEN_TIMEOUT_MS
    while (performance.now() < openDeadline) {
        stepEngine()
        await new Promise<void>(r => setTimeout(r, DIALOGUE_POLL_MS))
        const mode = globalState.uiMode
        if (mode === UIMode.dialogue || globalState.inCombat) {
            dialogueOpened = true
            break
        }
        if (mode === UIMode.none) {
            openStatus = 'no-dialogue'
            break
        }
        // Any other UIMode (e.g. a brief transition): keep polling until deadline.
    }
    if (!dialogueOpened) {
        result.status = openStatus
        result.durationMs = performance.now() - t0
        return result
    }

    if (globalState.inCombat) {
        result.status = 'combat-triggered'
        globalState.combat?.forceEnd()
        await waitFor(() => !isCombatActive(), COMBAT_ACTIVE_TIMEOUT_MS)
        result.durationMs = performance.now() - t0
        return result
    }

    // ── Exhaustive dialogue traversal ─────────────────────────────────────────
    // State = sorted option labels joined with NUL → per-state Set of clicked labels.
    // Non-exit options are always explored before exit options so every branch
    // is exercised. When all options in a state have been visited the loop
    // exits cleanly instead of cycling until MAX_DIALOGUE_CLICKS.
    let clicks = 0
    const visitedPerState = new Map<string, Set<string>>()
    let loopMode: UIMode = globalState.uiMode
    while (loopMode === UIMode.dialogue && clicks < MAX_DIALOGUE_CLICKS) {
        const reply = getReplyText()
        if (reply && !result.replies.includes(reply)) result.replies.push(reply)

        const optEls = getOptionElements()
        if (optEls.length === 0) {
            result.status = 'stuck-no-options'
            break
        }

        // Accumulate unique labels for the report.
        for (const el of optEls) {
            const label = el.textContent?.trim() ?? ''
            if (label && !result.optionLabels.includes(label)) result.optionLabels.push(label)
        }

        // Per-state visited tracking.
        const hash = optEls
            .map(el => el.textContent?.trim() ?? '').filter(Boolean).sort().join('\x00')
        if (!visitedPerState.has(hash)) visitedPerState.set(hash, new Set())
        const visitedInState = visitedPerState.get(hash)!

        const optLabels = optEls.map(el => el.textContent?.trim() ?? '')
        const nonExitEls = optEls.filter((_, i) => !isExitOption(optLabels[i]))
        const exitEls    = optEls.filter((_, i) =>  isExitOption(optLabels[i]))

        // Pick: first unvisited non-exit, then first unvisited exit.
        const toClick =
            nonExitEls.find(el => !visitedInState.has(el.textContent?.trim() ?? '')) ??
            exitEls.find(el => !visitedInState.has(el.textContent?.trim() ?? ''))

        if (!toClick) {
            // Every option in this state has been visited — tree fully explored.
            break
        }

        visitedInState.add(toClick.textContent?.trim() ?? '')

        try {
            toClick.click()
        } catch (e) {
            result.status = 'exception-on-click'
            result.error = String(e)
            break
        }
        clicks++
        result.optionsSeen++

        // Yield so deferred async work (transitions, animation callbacks) can settle.
        await new Promise<void>(r => setTimeout(r, 0))

        if (globalState.inCombat) {
            result.status = 'combat-triggered'
            globalState.combat?.forceEnd()
            await waitFor(() => !isCombatActive(), COMBAT_ACTIVE_TIMEOUT_MS)
            break
        }

        // Re-read after yielding — TypeScript would narrow the old variable.
        loopMode = globalState.uiMode

        // Barter mode is a valid terminal state — dismiss and stop.
        if (loopMode === UIMode.barter) {
            uiEndDialogue()
            await new Promise<void>(r => setTimeout(r, 0))
            break
        }
    }

    if (clicks >= MAX_DIALOGUE_CLICKS && globalState.uiMode === UIMode.dialogue) {
        result.status = 'stuck-max-clicks'
        try { Scripting.dialogueEnd() } catch { /* best-effort cleanup */ }
        await waitFor(() => globalState.uiMode === UIMode.none, 2000)
    }

    // Final sanity: uiMode must be none after a successful run.
    if (result.status === 'ok' && globalState.uiMode !== UIMode.none) {
        result.status = 'stuck-no-exit'
        try { Scripting.dialogueEnd() } catch { /* best-effort cleanup */ }
        await waitFor(() => globalState.uiMode === UIMode.none, 2000)
    }

    result.durationMs = performance.now() - t0
    return result
}

export async function runDialogueCrawler(mapName?: string): Promise<CrawlerReport | null> {
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

    const npcs = listTalkableNPCs()
    const mapLabel = globalState.gMap.name ?? 'unknown'
    console.log(`[AutoCrawler] Dialogue crawl on "${mapLabel}": ${npcs.length} talkable NPC(s)`)

    // Silence noisy logs for the duration of the crawl.
    const prevStub = Config.scripting.debugLogShowType.stub
    const prevDialogue = Config.scripting.debugLogShowType.dialogue
    const prevCombat = Config.scripting.debugLogShowType.combat
    Config.scripting.debugLogShowType.stub = false
    Config.scripting.debugLogShowType.dialogue = false
    Config.scripting.debugLogShowType.combat = false

    const results: DialogueNpcResult[] = []
    try {
        for (const npc of npcs) {
            console.log(`[AutoCrawler]   NPC uid=${npc.uid} "${critterDisplayName(npc)}"`)
            const r = await crawlOneNpc(npc)
            results.push(r)
            setLastReport(buildReport('dialogue', mapLabel, results))
            console.log(`[AutoCrawler]     → status=${r.status}  options=${r.optionsSeen}  ${r.durationMs.toFixed(0)}ms`)
            await new Promise<void>(r2 => setTimeout(r2, 20))
        }
    } finally {
        Config.scripting.debugLogShowType.stub = prevStub
        Config.scripting.debugLogShowType.dialogue = prevDialogue
        Config.scripting.debugLogShowType.combat = prevCombat
    }

    const report = buildReport('dialogue', mapLabel, results)
    printSummary(report)
    setLastReport(report)
    return report
}
