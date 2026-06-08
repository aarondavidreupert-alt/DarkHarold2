// AutoCrawler — shared constants, the lastReport binding, and the
// DOM/dialogue/engine helpers used by every crawler.

import { aiPackets, getAiPacket } from '../aiPackets.js'
import globalState from '../globalState.js'
import { hexNeighbors } from '../geometry.js'
import { heart } from '../heart.js'
import { Critter } from '../object.js'
import { centerCamera } from '../renderer.js'
import type { CrawlerReport } from './types.js'

// ─── Constants ────────────────────────────────────────────────────────────────

export const DIALOGUE_OPEN_TIMEOUT_MS = 5000   // hard cap for dialogue-open wait
export const DIALOGUE_POLL_MS = 200            // polling interval; UIMode.none after first poll → no-dialogue
export const COMBAT_ACTIVE_TIMEOUT_MS = 2000
export const PLAYER_TURN_TIMEOUT_MS = 10000
export const AI_TURN_TIMEOUT_MS = 10000
export const MAX_DIALOGUE_CLICKS = 50
export const MAP_LOAD_TIMEOUT_MS = 30000
// High HP value set on the player before each combat encounter to prevent death.
export const CRAWLER_HP = 9999

// Last completed report — accessible as autoCrawler.lastReport in DevTools.
// Exposed as a `let` re-export so consumers see live binding semantics.
export let lastReport: CrawlerReport | null = null

export function setLastReport(r: CrawlerReport | null): void {
    lastReport = r
}

export function getLastReport(): CrawlerReport | null {
    return lastReport
}

// ─── Engine-speed stepping ────────────────────────────────────────────────────

// Advance the engine one logical frame without waiting for rAF.
// Uses _stepOnly (not _tick) so each call does not enqueue a new rAF loop.
// We add 1 ms over the target tick time so the frame-rate accumulator
// is guaranteed to cross the target threshold on every call.
export function stepEngine(): void {
    if (heart._lastTick === undefined) return
    const dt = (heart._targetTickTime ?? 33) + 1
    heart._stepOnly(heart._lastTick + dt)
}

// Poll pred() until it returns true, advancing the engine each iteration.
// Returns true if pred() became true before the deadline, false on timeout.
// Each iteration yields to the browser event loop so setTimeout callbacks
// (animation frames, walk completion) can fire between engine steps.
export async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
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
    getAiPacket(0) // trigger lazy init of ai.txt before checking the map
    return map.getObjects().filter((obj): obj is Critter => {
        if (!(obj instanceof Critter)) return false
        if (obj.isPlayer || obj.dead || obj.visible === false) return false
        if (obj.aiNum < 0) return false
        return aiPackets.has(obj.aiNum)
    })
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

export function critterDisplayName(c: Critter): string {
    return (c.name || (c as any).art || String(c.uid))
}

// Move the player to the first hex neighbour of `target`.
// Uses direct position assignment — no pathfinding, no blocking check.
// Returns false only if the current map or player are unavailable.
export function movePlayerAdjacent(target: Critter): boolean {
    const player = globalState.player
    if (!player || !globalState.gMap) return false
    const neighbors = hexNeighbors(target.position)
    if (neighbors.length === 0) return false
    player.position = neighbors[0]
    centerCamera(player.position)
    return true
}

// Collect the option div elements currently displayed in the dialogue box.
export function getOptionElements(): HTMLElement[] {
    const area = document.getElementById('dialogueBoxTextArea')
    if (!area) return []
    return Array.from(area.children) as HTMLElement[]
}

export function getReplyText(): string {
    return document.getElementById('dialogueBoxReply')?.textContent?.trim() ?? ''
}

// Substrings that identify "exit" dialogue options (case-insensitive).
// These are clicked last so all substantive branches are explored first.
export const EXIT_OPTION_PATTERNS = [
    'goodbye', 'farewell', 'never mind', 'nevermind',
    "i'll be going", "i'm going", "i've got to go",
    "that's all", 'nothing else', 'forget it',
]

export function isExitOption(label: string): boolean {
    const lower = label.toLowerCase()
    return EXIT_OPTION_PATTERNS.some(p => lower.includes(p))
}
