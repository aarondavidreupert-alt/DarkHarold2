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

import { AI, Combat, isCombatActive } from './combat.js'
import { Config } from './config.js'
import globalState from './globalState.js'
import { hexNeighbors } from './geometry.js'
import { heart } from './heart.js'
import { Critter } from './object.js'
import { Scripting } from './scripting.js'
import { toTileNum } from './tile.js'
import { centerCamera } from './renderer.js'
import { UIMode, uiEndDialogue } from './ui.js'

// ─── Report types ─────────────────────────────────────────────────────────────

export type DialogueStatus =
    | 'ok'
    | 'no-talk-proc'
    | 'no-adjacent-tile'
    | 'exception-on-talk'
    | 'no-dialogue'          // talk proc ran; UIMode confirmed none within polling window
    | 'stuck-no-dialogue'    // hit 5 s cap with UIMode never reaching none or dialogue
    | 'combat-triggered'
    | 'stuck-no-options'
    | 'exception-on-click'
    | 'stuck-max-clicks'
    | 'stuck-no-exit'

export type CombatStatus =
    | 'ok'
    | 'no-valid-ai'
    | 'no-adjacent-tile'
    | 'stuck-combat-active'
    | 'exception-on-start'
    | 'stuck-no-combat'
    | 'stuck-player-turn-timeout'
    | 'stuck-ai-turn-timeout'
    | 'exception-in-combat'

export interface DialogueNpcResult {
    uid: number
    name: string
    tileNum: number
    status: DialogueStatus
    optionsSeen: number
    optionLabels: string[]
    replies: string[]
    durationMs: number
    error?: string
}

export interface CombatCritterResult {
    uid: number
    name: string
    tileNum: number
    status: CombatStatus
    turnsObserved: number
    aiBailout: boolean
    durationMs: number
    error?: string
    notes?: string
}

export interface CrawlerSummary {
    total: number
    ok: number
    stuck: number
    exceptions: number
    combatTriggered?: number
    noDialogue?: number
}

export interface CrawlerReport {
    map: string
    type: 'dialogue' | 'combat'
    timestamp: number
    results: DialogueNpcResult[] | CombatCritterResult[]
    summary: CrawlerSummary
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DIALOGUE_OPEN_TIMEOUT_MS = 5000   // hard cap for dialogue-open wait
const DIALOGUE_POLL_MS = 200            // polling interval; UIMode.none after first poll → no-dialogue
const COMBAT_ACTIVE_TIMEOUT_MS = 2000
const PLAYER_TURN_TIMEOUT_MS = 10000
const AI_TURN_TIMEOUT_MS = 10000
const MAX_DIALOGUE_CLICKS = 50
// High HP value set on the player before each combat encounter to prevent death.
const CRAWLER_HP = 9999

// Last completed report — accessible as autoCrawler.lastReport in DevTools.
let lastReport: CrawlerReport | null = null

// ─── Engine-speed stepping ────────────────────────────────────────────────────

// Advance the engine one logical frame without waiting for rAF.
// Uses _stepOnly (not _tick) so each call does not enqueue a new rAF loop.
// We add 1 ms over the target tick time so the frame-rate accumulator
// is guaranteed to cross the target threshold on every call.
function stepEngine(): void {
    if (heart._lastTick === undefined) return
    const dt = (heart._targetTickTime ?? 33) + 1
    heart._stepOnly(heart._lastTick + dt)
}

// Poll pred() until it returns true, advancing the engine each iteration.
// Returns true if pred() became true before the deadline, false on timeout.
// Each iteration yields to the browser event loop so setTimeout callbacks
// (animation frames, walk completion) can fire between engine steps.
async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = performance.now() + timeoutMs
    while (!pred()) {
        stepEngine()
        await new Promise<void>(r => setTimeout(r, 0))
        if (performance.now() > deadline) return false
    }
    return true
}

// ─── Phase 1: map scanners ────────────────────────────────────────────────────

/** All living, visible, scripted NPCs on the current map that have a talk_p_proc. */
export function listTalkableNPCs(): Critter[] {
    const map = globalState.gMap
    if (!map) return []
    return map.getObjects().filter((obj): obj is Critter => {
        if (!(obj instanceof Critter)) return false
        if (obj.isPlayer || obj.dead || obj.visible === false) return false
        if (!obj._script || typeof obj._script.talk_p_proc !== 'function') return false
        return true
    })
}

/** All living, visible critters on the current map that have a valid AI packet.
 *  These are the targets for the combat crawler. */
export function listHostileCritters(): Critter[] {
    const map = globalState.gMap
    if (!map) return []
    // Ensure AI.TXT is loaded before checking packet info
    try { AI.init() } catch { /* already loaded or no ai.txt */ }
    return map.getObjects().filter((obj): obj is Critter => {
        if (!(obj instanceof Critter)) return false
        if (obj.isPlayer || obj.dead || obj.visible === false) return false
        if (obj.aiNum < 0) return false
        try { return AI.getPacketInfo(obj.aiNum) !== null } catch { return false }
    })
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function critterDisplayName(c: Critter): string {
    return (c.name || (c as any).art || String(c.uid))
}

// Move the player to the first hex neighbour of `target`.
// Uses direct position assignment — no pathfinding, no blocking check.
// Returns false only if the current map or player are unavailable.
function movePlayerAdjacent(target: Critter): boolean {
    const player = globalState.player
    if (!player || !globalState.gMap) return false
    const neighbors = hexNeighbors(target.position)
    if (neighbors.length === 0) return false
    player.position = neighbors[0]
    centerCamera(player.position)
    return true
}

// Collect the option div elements currently displayed in the dialogue box.
function getOptionElements(): HTMLElement[] {
    const area = document.getElementById('dialogueBoxTextArea')
    if (!area) return []
    return Array.from(area.children) as HTMLElement[]
}

function getReplyText(): string {
    return document.getElementById('dialogueBoxReply')?.textContent?.trim() ?? ''
}

// ─── Phase 2: NPC dialogue crawler ───────────────────────────────────────────

// Substrings that identify "exit" dialogue options (case-insensitive).
// These are clicked last so all substantive branches are explored first.
const EXIT_OPTION_PATTERNS = [
    'goodbye', 'farewell', 'never mind', 'nevermind',
    "i'll be going", "i'm going", "i've got to go",
    "that's all", 'nothing else', 'forget it',
]

function isExitOption(label: string): boolean {
    const lower = label.toLowerCase()
    return EXIT_OPTION_PATTERNS.some(p => lower.includes(p))
}

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
    for (const npc of npcs) {
        console.log(`[AutoCrawler]   NPC uid=${npc.uid} "${critterDisplayName(npc)}"`)
        const r = await crawlOneNpc(npc)
        results.push(r)
        console.log(`[AutoCrawler]     → status=${r.status}  options=${r.optionsSeen}  ${r.durationMs.toFixed(0)}ms`)
        await new Promise<void>(r2 => setTimeout(r2, 20))
    }

    Config.scripting.debugLogShowType.stub = prevStub
    Config.scripting.debugLogShowType.dialogue = prevDialogue
    Config.scripting.debugLogShowType.combat = prevCombat

    const report = buildReport('dialogue', mapLabel, results)
    printSummary(report)
    lastReport = report
    return report
}

// ─── Phase 3: combat crawler ──────────────────────────────────────────────────

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

        // Start combat in NPC-initiated mode (forceTurn = critter).
        // This limits team enrollment to: player's team + critter's team.
        try {
            Combat.start(critter)
        } catch (e) {
            result.status = 'exception-on-start'
            result.error = String(e)
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
    for (const critter of critters) {
        console.log(`[AutoCrawler]   Critter uid=${critter.uid} "${critterDisplayName(critter)}"`)
        const r = await crawlOneCritter(critter)
        results.push(r)
        console.log(
            `[AutoCrawler]     → status=${r.status}  turns=${r.turnsObserved}` +
            `  bailout=${r.aiBailout}  ${r.durationMs.toFixed(0)}ms` +
            (r.notes ? `  (${r.notes})` : '')
        )
        await new Promise<void>(r2 => setTimeout(r2, 20))
    }

    Config.scripting.debugLogShowType.combat = prevCombat
    Config.scripting.debugLogShowType.ai = prevAI

    const report = buildReport('combat', mapLabel, results)
    printSummary(report)
    lastReport = report
    return report
}

// ─── Phase 4: report ─────────────────────────────────────────────────────────

function buildReport(
    type: 'dialogue' | 'combat',
    mapLabel: string,
    results: DialogueNpcResult[] | CombatCritterResult[]
): CrawlerReport {
    // Cast to a shared base so TypeScript can unify the union for counting.
    const any = results as Array<{ status: string }>
    const ok = any.filter(r => r.status === 'ok').length
    const exceptions = any.filter(r => r.status.startsWith('exception')).length
    const stuck = any.filter(r => r.status.startsWith('stuck')).length
    const combatTriggered =
        type === 'dialogue'
            ? (results as DialogueNpcResult[]).filter(r => r.status === 'combat-triggered').length
            : undefined
    const noDialogue =
        type === 'dialogue'
            ? (results as DialogueNpcResult[]).filter(r => r.status === 'no-dialogue').length
            : undefined

    return {
        map: mapLabel,
        type,
        timestamp: Date.now(),
        results,
        summary: { total: results.length, ok, stuck, exceptions, combatTriggered, noDialogue },
    }
}

function printSummary(report: CrawlerReport): void {
    const s = report.summary
    const extras: string[] = []
    if (s.combatTriggered !== undefined) extras.push(`combat-triggered=${s.combatTriggered}`)
    if (s.noDialogue !== undefined) extras.push(`no-dialogue=${s.noDialogue}`)
    const extra = extras.map(e => `  ${e}`).join('')
    console.log(
        `[AutoCrawler] ── ${report.type.toUpperCase()} DONE on "${report.map}" ──\n` +
        `  total=${s.total}  ok=${s.ok}  stuck=${s.stuck}  exceptions=${s.exceptions}${extra}`
    )
}

/** Download a report as a timestamped JSON file.
 *  If called with no argument, downloads the most recent completed report. */
export function downloadReport(report?: CrawlerReport | null): void {
    const r = report ?? lastReport
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

// ─── Window exposure ──────────────────────────────────────────────────────────

if (typeof window !== 'undefined' && Config.engine.debug) {
    ;(window as any).autoCrawler = {
        runDialogueCrawler,
        runCombatCrawler,
        listTalkableNPCs,
        listHostileCritters,
        downloadReport,
        get lastReport(): CrawlerReport | null { return lastReport },
    }
}
